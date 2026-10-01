/*
 *
 * Helper: `handleSubmitReferral`.
 *
 * A patientsStore event listener factory (same shape as
 * handleCaseAcceptanceOrRejection.mjs: config bound at registration time,
 * e.g. `patientsStore.on(eventName, handleSubmitReferral({ eventName,
 * browser }))` - eventName isn't something Node's EventEmitter hands to a
 * listener on its own, so it's captured via closure here rather than read
 * off the emitted payload). Opens a fresh tab directly on the Wasla
 * frontend's own case-details route (not through the widget iframe) and
 * scrolls it to the bottom. Left open afterward for a human operator to
 * see/act on - this doesn't close the tab itself.
 *
 */
import createConsoleMessage from "./createConsoleMessage.mjs";
import getCurrentActionLetterFile from "./getCurrentActionLetterFile.mjs";
import captureFailureArtifacts from "./captureFailureArtifacts.mjs";
import randomArrayItem from "./randomArrayItem.mjs";
import sleep from "./sleep.mjs";
import submitWaslaReferralViaApi from "./submitWaslaReferralViaApi.mjs";
import showPageSnackbar from "./showPageSnackbar.mjs";
import { USER_ACTION_TYPES, WASLA_REFERRAL_VIEW_URL } from "./constants.mjs";

const NAVIGATION_TIMEOUT_MS = 20_000;

const { ACCEPT, REJECT } = USER_ACTION_TYPES;

// Confirmed live (html/details/details-frame.html): the accept/reject
// buttons have no id/data-testid/aria-label to key off, so matched by their
// known Arabic/English text instead - both language variants listed
// explicitly. If neither is found (unrecognized UI variant, unexpected
// language, etc.) this does nothing rather than guessing which button to
// click.
const ACCEPT_BUTTON_TEXTS = ["قبول الإحالة", "Accept Referral"];
const REJECT_BUTTON_TEXTS = ["رفض الإحالة", "Reject Referral"];
const ACTION_BUTTON_TIMEOUT_MS = 15_000;

// The confirmation popup after clicking accept/reject (html/details/
// rejection-modal.html, html/details/accept-modal.html) - stable MUI base
// classes (not the hashed per-build "mui-xxxxxx" ones) and plain
// attribute selectors, no page text. We wait for the modal root itself
// first, then every other selector below is queried scoped to that
// ElementHandle (via its own .waitForSelector) rather than re-searching
// the whole document each time.
const MODAL_SELECTOR = ".MuiDialog-root";
const MODAL_FILE_INPUT_SELECTOR = "input[type='file']";
// The accept modal renders a second, hidden shadow <textarea> next to the
// real Description one (MUI's own auto-sizing mirror - aria-hidden,
// readonly, visibility:hidden) - confirmed in accept-modal.html. It only
// happens to come after the real one in that markup, so keying off plain
// `textarea` order isn't safe long-term; `name="notes"` on the real one is.
const MODAL_TEXTAREA_SELECTOR = "textarea[name='notes']";
const MODAL_TIMEOUT_MS = 15_000;
const DESCRIPTION_TYPE_DELAY_MS = 8;
const DESCRIPTION_TYPE_DELAY_JITTER_MS = 20;

// Confirmed unique in both html/details/accept-modal.html and
// rejection-modal.html: the forward action (accept's "Confirm", reject's
// "Reject Confirmation") is the only MuiButton-containedPrimary in the
// dialog - a class, not text, so it works for either language. It starts
// disabled (disabled="" in the real markup) until the required fields
// validate, so this waits for that rather than a fixed delay.
const CONFIRM_BUTTON_SELECTOR = "button.MuiButton-containedPrimary";
const CONFIRM_BUTTON_TIMEOUT_MS = 15_000;
const SLEEP_AFTER_CONFIRMATION_MS = 17_000;

// Lookup id from the portal's own rejection-reasons list (scripts/
// reject-case.js) - "Unavailability of Required Bed" / "عدم توفر السرير
// المطلوب". Always this one reason, per instruction.
const REJECTION_REASON_ID = 18;

// Only the accept modal has a Description field - a different random
// sentence each time rather than one fixed string.
const ACCEPTANCE_DESCRIPTION_TEMPLATES = [
  (navigationId) => `We are ready to accept this case ${navigationId}.`,
  (navigationId) =>
    `This referral ${navigationId} has been reviewed and is ready to be accepted.`,
  (navigationId) =>
    `We confirm our facility's capacity to accept referral ${navigationId} at this time.`,
  (navigationId) =>
    `Case ${navigationId} has been reviewed and meets our facility's acceptance criteria.`,
  (navigationId) =>
    `Our facility is prepared to accept and proceed with case ${navigationId}.`,
  (navigationId) =>
    `After reviewing case ${navigationId}, we confirm our acceptance.`,
  (navigationId) =>
    `Referral ${navigationId} falls within our scope and we agree to accept it.`,
  (navigationId) =>
    `We have the required capacity and specialty to accept case ${navigationId}.`,
  (navigationId) =>
    `Our team has reviewed referral ${navigationId} and approves its acceptance.`,
  (navigationId) =>
    `We hereby accept case ${navigationId} for treatment at our facility.`,
  (navigationId) =>
    `Case ${navigationId} is approved for acceptance following our internal review.`,
];

// https://weslah.seha.sa/facility-referrals/view/13466

/**
 * Logs an error, best-effort saves a failure screenshot/HTML (when a page
 * is available yet), and best-effort notifies Telegram - one place for all
 * of this file's failure branches instead of repeating the three calls at
 * each one (same shape as openNafathLoginPortal.mjs's reportFailure).
 *
 * @param {import("puppeteer").Page | null | undefined} page
 * @param {(message: string) => Promise<any>} [sendTelegramMessage]
 * @param {string} label - Short slug for the captured artifact file names.
 * @param {string} consoleMessage - Already includes its own "❌ " prefix.
 * @returns {Promise<void>}
 */
const reportFailure = async (
  page,
  sendTelegramMessage,
  label,
  consoleMessage,
) => {
  createConsoleMessage("error", consoleMessage, "handleSubmitReferral");

  await Promise.allSettled([
    page ? captureFailureArtifacts(page, label) : Promise.resolve(),
    sendTelegramMessage?.(
      `⚠️ *handleSubmitReferral failed:* ${consoleMessage}`,
    ),
  ]);
};

/**
 * Builds the Telegram message reporting the direct-API accept/reject
 * attempt's outcome - shared by the success and failure branches so the
 * header/footer structure (ReferralId/ID/actionButtonTimingLine) isn't
 * hand-duplicated between them.
 *
 * @param {{
 *   success: boolean,
 *   isAcceptanceAction: boolean,
 *   referralId: string,
 *   navigationId: string,
 *   apiResult: Awaited<ReturnType<typeof import("./submitWaslaReferralViaApi.mjs").default>>,
 *   actionButtonTimingLine: string,
 * }} params
 * @returns {string}
 */
const buildDirectApiTelegramMessage = ({
  success,
  isAcceptanceAction,
  referralId,
  navigationId,
  apiResult,
  actionButtonTimingLine,
}) => {
  const title = success
    ? `*${isAcceptanceAction ? "Accepted" : "Rejected"} via direct API*`
    : `*Direct API ${isAcceptanceAction ? "accept" : "reject"} attempt failed*`;

  const detailLine = success
    ? `Message: ${apiResult.data?.message ?? "(no message)"}`
    : `Message: step=\`${apiResult.step}\`, attachmentId=\`${apiResult.attachmentId}\`, url=\`${apiResult.url}\`, error=\`${apiResult.error}\``;

  return (
    `ReferralId: \`${referralId}\`\n` +
    `ID: \`${navigationId}\`\n` +
    `${title}\n` +
    `${detailLine}\n\n` +
    actionButtonTimingLine +
    (success ? "" : "\nFalling back to the UI.")
  );
};

const handleSubmitReferral =
  ({
    actionType,
    sendTelegramMessage,
    continueFetchingPatientsIfPaused,
    browser,
    patientsStore,
  }) =>
  async ({
    navigationId,
    referralId,
    referralEndTimestamp,
    providerName,
    randomFileName,
  }) => {
    if (!navigationId) {
      await reportFailure(
        null,
        sendTelegramMessage,
        "submit-referral-missing-navigation-id",
        `❌ Missing navigationId for referralId=${referralId} actionType=[${actionType}], cannot open referral view.`,
      );
      return;
    }

    const isAcceptanceAction = actionType === ACCEPT;

    const url = `${WASLA_REFERRAL_VIEW_URL}/${navigationId}`;

    let page;

    try {
      page = await browser.newPage();

      const [, { filePath: letterFilePath, fileData: letterFileBase64 }] =
        await Promise.all([
          page.goto(url, {
            waitUntil: "domcontentloaded",
            timeout: NAVIGATION_TIMEOUT_MS,
          }),
          getCurrentActionLetterFile(
            referralId,
            isAcceptanceAction ? actionType : REJECT,
          ),
        ]);

      await page.evaluate(() => {
        window.scrollTo(0, document.body.scrollHeight);
      });

      const targetButtonTexts = isAcceptanceAction
        ? ACCEPT_BUTTON_TEXTS
        : REJECT_BUTTON_TEXTS;

      // Confirmed live: the accept/reject button starts disabled and only
      // becomes clickable later (same shape as the Confirm button further
      // down) - matching by text alone found it while still disabled, so
      // the real click landed (native focus happened) but React's handler
      // no-op'd on the disabled state, and the popup never opened.
      const tActionButtonWaitStart = Date.now();

      const actionButtonHandle = await page
        .waitForFunction(
          (texts) => {
            const normalize = (text) =>
              (text || "").replace(/\s+/g, " ").trim();

            const buttons = [...document.querySelectorAll("button")];

            return (
              buttons.find(
                (button) =>
                  texts.includes(normalize(button.textContent)) &&
                  !button.disabled,
              ) || null
            );
          },
          { timeout: ACTION_BUTTON_TIMEOUT_MS },
          targetButtonTexts,
        )
        .catch(() => null);

      const actionButtonWaitMs = Date.now() - tActionButtonWaitStart;

      // createConsoleMessage(
      //   "info",
      //   `⏱️ actionButtonHandle ${actionButtonHandle ? "resolved" : "timed out"} after ${actionButtonWaitMs}ms for referralId=${referralId} (navigationId=${navigationId})`,
      //   "handleSubmitReferral",
      // );

      // Computed up front (not just inside the modal-filling step below) so
      // the same text is used both for the direct-API attempt's "notes" and
      // for the UI fallback's Description field, rather than picking twice.
      // Reject has no notes/description at all (submitWaslaReferralViaApi
      // sends rejectionReasonId instead), so this stays undefined there.
      const description = isAcceptanceAction
        ? randomArrayItem(ACCEPTANCE_DESCRIPTION_TEMPLATES)(navigationId)
        : undefined;

      // Not awaited - purely visual (showPageSnackbar never throws, it
      // logs and swallows internally), so it shouldn't serialize an extra
      // page.evaluate round-trip onto this time-critical path in front of
      // the actual submit call.
      showPageSnackbar(page, {
        message: `Submitting ${isAcceptanceAction ? "acceptance" : "rejection"} via direct API...`,
        severity: "info",
      });

      const apiResult = await submitWaslaReferralViaApi({
        page,
        navigationId,
        fileBase64: letterFileBase64,
        fileName: randomFileName,
        notes: description,
        rejectionReasonId: REJECTION_REASON_ID,
        isAccept: isAcceptanceAction,
      });

      showPageSnackbar(page, {
        message: apiResult.success
          ? `${isAcceptanceAction ? "Accepted" : "Rejected"} via direct API`
          : `Direct API ${isAcceptanceAction ? "accept" : "reject"} failed - falling back to UI`,
        severity: apiResult.success ? "success" : "error",
      });

      const actionButtonTimingLine = `actionButtonHandle: ${actionButtonHandle ? "resolved" : "timed out"} after \`${actionButtonWaitMs}ms\``;

      await sendTelegramMessage?.(
        buildDirectApiTelegramMessage({
          success: apiResult.success,
          isAcceptanceAction,
          referralId,
          navigationId,
          apiResult,
          actionButtonTimingLine,
        }),
      );

      if (apiResult.success) {
        createConsoleMessage(
          "success",
          `✅ [${actionType}] ${isAcceptanceAction ? "Accepted" : "Rejected"} via direct API for referralId=${referralId} (navigationId=${navigationId})`,
          "handleSubmitReferral",
        );

        // this is not supports rejection and accteptance
        await sleep(SLEEP_AFTER_CONFIRMATION_MS);
        patientsStore.addNonClaimableCase(referralId, referralEndTimestamp);

        return;
      }

      if (!actionButtonHandle) {
        await reportFailure(
          page,
          sendTelegramMessage,
          "submit-referral-button-not-found",
          `❌ Neither "${targetButtonTexts.join('" nor "')}" button was found for referralId=${referralId} (navigationId=${navigationId})`,
        );
        return;
      }

      try {
        await actionButtonHandle.asElement()?.click();
      } catch (error) {
        await reportFailure(
          page,
          sendTelegramMessage,
          "submit-referral-click-failed",
          `❌ Failed to click ${isAcceptanceAction ? "accept" : "reject"} button for referralId=${referralId} (navigationId=${navigationId}): ${error.message}`,
        );
        return;
      }

      createConsoleMessage(
        "success",
        `✅ [${actionType}] Clicked ${isAcceptanceAction ? "accept" : "reject"} button for referralId=${referralId} (navigationId=${navigationId})`,
        "handleSubmitReferral",
      );

      const modalHandle = await page
        .waitForSelector(MODAL_SELECTOR, { timeout: MODAL_TIMEOUT_MS })
        .catch(() => null);

      if (!modalHandle) {
        await reportFailure(
          page,
          sendTelegramMessage,
          "submit-referral-modal-not-found",
          `❌ Confirmation popup never appeared for referralId=${referralId} (navigationId=${navigationId})`,
        );
        return;
      }

      // Both fields live in the same modal for the accept case, so their
      // waits run together instead of stacking up to 2x MODAL_TIMEOUT_MS
      // sequentially. Reject's modal has no textarea at all, so that wait
      // is skipped there rather than parallelized into a guaranteed timeout.
      // Scoped to modalHandle (not page) so each only searches the modal's
      // own subtree.
      const [fileInputHandle, descriptionHandle] = await Promise.all([
        modalHandle
          .waitForSelector(MODAL_FILE_INPUT_SELECTOR, {
            timeout: MODAL_TIMEOUT_MS,
          })
          .catch(() => null),
        isAcceptanceAction
          ? modalHandle
              .waitForSelector(MODAL_TEXTAREA_SELECTOR, {
                timeout: MODAL_TIMEOUT_MS,
              })
              .catch(() => null)
          : null,
      ]);

      if (!fileInputHandle) {
        await reportFailure(
          page,
          sendTelegramMessage,
          "submit-referral-attachments-input-not-found",
          `❌ Attachments file input not found in confirmation popup for referralId=${referralId} (navigationId=${navigationId})`,
        );
        return;
      }

      if (isAcceptanceAction) {
        if (!descriptionHandle) {
          await reportFailure(
            page,
            sendTelegramMessage,
            "submit-referral-description-not-found",
            `❌ Description field not found in acceptance popup for referralId=${referralId} (navigationId=${navigationId})`,
          );
          return;
        }

        await descriptionHandle.focus();
        await page.keyboard.type(description, {
          delay:
            DESCRIPTION_TYPE_DELAY_MS +
            Math.random() * DESCRIPTION_TYPE_DELAY_JITTER_MS,
        });
      }

      if (letterFilePath) {
        try {
          await fileInputHandle.uploadFile(letterFilePath);
        } catch (error) {
          await reportFailure(
            page,
            sendTelegramMessage,
            "submit-referral-attach-failed",
            `❌ Failed to attach letter file for referralId=${referralId} (navigationId=${navigationId}): ${error.message}`,
          );
          return;
        }
      }

      createConsoleMessage(
        "success",
        `✅ [${actionType}] Filled confirmation popup for referralId=${referralId} (navigationId=${navigationId})`,
        "handleSubmitReferral",
      );

      // Reject's modal also has a required "Rejection Reason" dropdown we
      // don't fill yet, so its Confirm would stay disabled anyway - only
      // wired up for accept for now.
      if (isAcceptanceAction) {
        const confirmButtonHandle = await page
          .waitForFunction(
            (dialogEl, selector) => {
              const button = dialogEl?.querySelector(selector);
              return button && !button.disabled ? button : null;
            },
            { timeout: CONFIRM_BUTTON_TIMEOUT_MS },
            modalHandle,
            CONFIRM_BUTTON_SELECTOR,
          )
          .catch(() => null);

        if (!confirmButtonHandle) {
          await reportFailure(
            page,
            sendTelegramMessage,
            "submit-referral-confirm-not-enabled",
            `❌ Confirm button never became enabled for referralId=${referralId} (navigationId=${navigationId})`,
          );
          return;
        }

        try {
          await confirmButtonHandle.asElement()?.click();
        } catch (error) {
          await reportFailure(
            page,
            sendTelegramMessage,
            "submit-referral-confirm-click-failed",
            `❌ Failed to click Confirm for referralId=${referralId} (navigationId=${navigationId}): ${error.message}`,
          );
          return;
        }

        createConsoleMessage(
          "success",
          `✅ [${actionType}] Clicked Confirm for referralId=${referralId} (navigationId=${navigationId})`,
          "handleSubmitReferral",
        );

        // Same bookkeeping handleCaseAcceptanceOrRejection.mjs does right
        // after a real acceptance API call: mark the case as needing its
        // claimed status checked later (checkReferralSelectedStatus.mjs
        // polls patientsStore.getAllNonClaimableCases() and removes it once
        // confirmed), since clicking Confirm here doesn't itself tell us
        // whether Wasla actually accepted the submission.
        await sleep(SLEEP_AFTER_CONFIRMATION_MS);
        patientsStore.addNonClaimableCase(referralId, referralEndTimestamp);
      }
    } catch (error) {
      await reportFailure(
        page,
        sendTelegramMessage,
        "submit-referral-unexpected-error",
        `❌ Failed to open referral view for referralId=${referralId} (navigationId=${navigationId}): ${error.message}`,
      );
    }
  };

export default handleSubmitReferral;
