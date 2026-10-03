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
import submitWaslaAction from "./submitWaslaAction.mjs";
import closePageSafely from "./closePageSafely.mjs";
import showPageSnackbar from "./showPageSnackbar.mjs";
import getOrgLabel from "./getOrgLabel.mjs";
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

// Confirmed unique in both html/details/accept-modal.html and
// rejection-modal.html: the forward action (accept's "Confirm", reject's
// "Reject Confirmation") is the only MuiButton-containedPrimary in the
// dialog - a class, not text, so it works for either language. It starts
// disabled (disabled="" in the real markup) until the required fields
// validate, so this waits for that rather than a fixed delay.
const CONFIRM_BUTTON_SELECTOR = "button.MuiButton-containedPrimary";
const CONFIRM_BUTTON_TIMEOUT_MS = 15_000;
const SLEEP_AFTER_CONFIRMATION_MS = 15_000;

// Lookup id from the portal's own rejection-reasons list (scripts/
// reject-case.js) - "Unavailability of Required Bed" / "عدم توفر السرير
// المطلوب". Always this one reason, per instruction.
const REJECTION_REASON_ID = 18;

const MAX_ACTION_RETRIES = 3;

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
 * header/footer structure (ReferralId/ID/timing diagnostics) isn't
 * hand-duplicated between them.
 *
 * @param {{
 *   isAcceptanceAction: boolean,
 *   referralId: string,
 *   navigationId: string,
 *   apiResult: Awaited<ReturnType<typeof import("./submitWaslaReferralViaApi.mjs").default>>,
 *   preUploadResult: Awaited<ReturnType<typeof import("./submitWaslaAction.mjs").default>>,
 *   diffMs: number,
 *   sleepMs: number,
 *   boundarySafetyMarginMs: number,
 *   waitingBeforeFinalActionMS: number,
 *   elapsedBeforeActionMs: number,
 *   actionTimeMs: number,
 *   actionTakenAfterEndMs: number,
 *   attemptsMade: number,
 *   retryReason: string,
 *   sleepWhenAcceptOrRejectRetryMs: number,
 * }} params
 * @returns {string}
 */
const buildDirectApiTelegramMessage = ({
  isAcceptanceAction,
  referralId,
  navigationId,
  apiResult,
  preUploadResult,
  diffMs,
  sleepMs,
  boundarySafetyMarginMs,
  waitingBeforeFinalActionMS,
  elapsedBeforeActionMs,
  actionTimeMs,
  actionTakenAfterEndMs,
  attemptsMade,
  retryReason,
  sleepWhenAcceptOrRejectRetryMs,
}) => {
  const { success } = apiResult;

  const title = success
    ? `*${isAcceptanceAction ? "Accepted" : "Rejected"} via direct API*`
    : `*Direct API ${isAcceptanceAction ? "accept" : "reject"} attempt failed*`;

  const detailLine = success
    ? `Message: ${apiResult.data?.message ?? "(no message)"}`
    : `Message: step=\`${apiResult.step}\`, attachmentId=\`${apiResult.attachmentId}\`, url=\`${apiResult.url}\`, error=\`${apiResult.error}\``;

  // Lets a failed pre-upload (silently retried inline by
  // submitWaslaReferralViaApi, since it's also given fileBase64/fileName
  // as a fallback) show up here instead of looking identical to a run
  // where the pre-upload worked as intended - useful for noticing extra
  // latency that retry adds to a given run.
  const preUploadLine = preUploadResult?.success
    ? `PreUpload: ok (attachmentId=\`${preUploadResult.attachmentId}\`)`
    : `PreUpload: failed (step=\`${preUploadResult?.step}\`, error=\`${preUploadResult?.error}\`) - retried inline`;

  // Human-readable rather than a raw key=value dump like the rest of
  // timingLine - this one's meant to be read at a glance ("did it retry,
  // and why") rather than cross-referenced against the code.
  const retryCount = attemptsMade - 1;
  const retryLine =
    retryCount > 0
      ? `🔁 Retried ${retryCount} time${retryCount > 1 ? "s" : ""} (${sleepWhenAcceptOrRejectRetryMs}ms apart) after: \`${retryReason}\`\n\n`
      : "";

  const timingLine =
    `boundaryDiffMs=${diffMs}\n` +
    `boundarySafetyMarginMs=${boundarySafetyMarginMs}\n` +
    `sleepMs=${sleepMs}\n` +
    `waitingBeforeFinalActionMS=${waitingBeforeFinalActionMS}\n` +
    `elapsedBeforeActionMs=${elapsedBeforeActionMs}ms\n` +
    `finalRequestTakenAfterEndByMS=${actionTakenAfterEndMs}ms (${(actionTakenAfterEndMs / 1000).toFixed(2)}s)\n` +
    `finalRequestTakesMs=${actionTimeMs}ms\n`;

  return (
    `ReferralId: \`${referralId}\`\n` +
    `ID: \`${navigationId}\`\n` +
    `${title}\n` +
    `${detailLine}\n\n` +
    `${preUploadLine}\n\n` +
    retryLine +
    timingLine +
    (success ? "" : "\nFalling back to the UI.")
  );
};

/**
 * Notifies the shared/admin watcher chat the moment a case is actually
 * accepted (not just scheduled) - same watcher pattern as
 * loginWithNafathCredentials.mjs/checkReferralSelectedStatus.mjs, but
 * fired right here instead of waiting for the later claim-status
 * resolution, since that can take a while and the watcher chat wants to
 * know (and be able to withdraw) as soon as the acceptance itself lands.
 * Best-effort - a notify failure shouldn't be treated as the acceptance
 * itself failing.
 *
 * @param {object} params
 * @param {(message: string, files?: any[], targetReferralIdForButtons?: string, overrideChatId?: string, skipOnlineCheckCreation?: boolean, extraReplyMarkup?: object) => Promise<any>} params.sendTelegramMessage
 * @param {string} params.referralId
 * @param {string} params.navigationId
 * @param {string} [params.patientName]
 * @returns {Promise<void>}
 */
const notifyWatcherOfAcceptance = async ({
  sendTelegramMessage,
  navigationId,
  referralId,
  patientName,
}) => {
  const { VERIFICATION_CODE_WATCHER_CHAT_ID } = process.env;

  if (!VERIFICATION_CODE_WATCHER_CHAT_ID) return;

  const watcherMessage =
    `✅ *JUST Accepted Case At* \`${getOrgLabel()}\`\n` +
    `────────────────────────\n` +
    `🔢 *ID:* \`${navigationId}\`\n` +
    `🔢 *Referral ID:* \`${referralId}\`\n` +
    (patientName ? `👤 *Patient:* ${patientName}\n` : "");

  const withdrawButtonMarkup = {
    inline_keyboard: [
      [{ text: "🚫 Withdraw", callback_data: `withdraw_${referralId}` }],
    ],
  };

  await sendTelegramMessage?.(
    watcherMessage,
    [],
    undefined,
    VERIFICATION_CODE_WATCHER_CHAT_ID,
    true,
    withdrawButtonMarkup,
  ).catch(() => {});
};

/**
 * Reads a numeric env var with a safe fallback - guards against both a
 * missing/empty value (`Number("")` is `0`, not `NaN`, so an empty string
 * can't silently become a real "0" override) and a non-numeric value.
 *
 * @param {string} name - Env var name, e.g. "BOUNDARY_SAFETY_MARGIN_MS".
 * @param {number} defaultValue - Used when the env var is unset, empty, or
 *   not a finite number.
 * @returns {number}
 */
const getEnvVariableAsNumber = (name, defaultValue) => {
  const value = process.env[name];

  const _value = value ? Number(value) : defaultValue;

  return Number.isFinite(_value) ? _value : defaultValue;
};

const handleSubmitReferral = (options) => async (patient) => {
  const {
    actionType,
    sendTelegramMessage,
    // continueFetchingPatientsIfPaused,
    browser,
    patientsStore,
  } = options;

  const {
    navigationId,
    referralId,
    referralEndTimestamp,
    randomFileName,
    patientName,
  } = patient;

  if (!navigationId) {
    await reportFailure(
      null,
      sendTelegramMessage,
      "submit-referral-missing-navigation-id",
      `❌ Missing navigationId for referralId=${referralId} actionType=[${actionType}], cannot open referral view.`,
    );
    return;
  }

  const BOUNDARY_SAFETY_MARGIN_MS = getEnvVariableAsNumber(
    "BOUNDARY_SAFETY_MARGIN_MS",
    10,
  );

  const SLEEP_BEFORE_ACCEPT_OR_REJECT_MS = getEnvVariableAsNumber(
    "SLEEP_BEFORE_ACCEPT_OR_REJECT_MS",
    280,
  );

  const SLEEP_WHEN_ACCEPT_OR_REJECT_RETRY_MS = getEnvVariableAsNumber(
    "SLEEP_WHEN_ACCEPT_OR_REJECT_RETRY_MS",
    80,
  );

  const isAcceptanceAction = actionType === ACCEPT;

  const url = `${WASLA_REFERRAL_VIEW_URL}/${navigationId}`;

  let page;

  try {
    const startTime = Date.now();
    page = await browser.newPage();

    // Land on a neutral, lightweight page first (in parallel with the
    // letter-file read) - mainly so the browser/tab is already warmed up
    // (DNS/TLS/connection) before the real case-page navigation below,
    // which is the one that matters for timing.
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

    // Computed up front (not just inside the modal-filling step below) so
    // the same text is used both for the direct-API attempt's "notes" and
    // for the UI fallback's Description field, rather than picking twice.
    // Reject has no notes/description at all (submitWaslaReferralViaApi
    // sends rejectionReasonId instead), so this stays undefined there.
    const description = isAcceptanceAction
      ? randomArrayItem(ACCEPTANCE_DESCRIPTION_TEMPLATES)(navigationId)
      : undefined;

    const targetButtonTexts = isAcceptanceAction
      ? ACCEPT_BUTTON_TEXTS
      : REJECT_BUTTON_TEXTS;

    // Upload the letter now, well ahead of the facility review-window
    // boundary - no url/payload given, so submitWaslaAction skips its own
    // POST step entirely and this is just the upload, split out of the
    // time-critical path (see submitWaslaAction.mjs's own docblock).
    const uploadResult = await submitWaslaAction({
      page,
      fileBase64: letterFileBase64,
      fileName: randomFileName,
      postStepLabel: "accept-json",
    });

    // The real synchronization point: sleep out whatever's actually left
    // until the boundary (cutoffTimeMs already gave this function a head
    // start before it, so diff is normally still positive here - if the
    // prep work above overran that head start, diff goes negative and we
    // just proceed immediately rather than sleeping a negative amount),
    // plus a small deliberate margin - see BOUNDARY_SAFETY_MARGIN_MS.
    // This is what actually guarantees landing on the right side of the
    // boundary, rather than hoping prep work happened to take long enough.
    const diffMs = referralEndTimestamp - Date.now();
    const sleepMS = Math.max(0, diffMs) + BOUNDARY_SAFETY_MARGIN_MS;

    if (diffMs > 0) {
      await sleep(sleepMS);
    }

    // If you want to fully close that gap rather than just make it unlikely,
    // the robust fix is a direct guard right before the POST fires — e.g.
    // if (Date.now() < referralEndTimestamp) await sleep(referralEndTimestamp - Date.now())
    // immediately before calling submitWaslaReferralViaApi — so correctness doesn't depend
    // on the reload/margin arithmetic lining up, no matter how fast the reload happens to be.
    // Not required if you're comfortable with the current odds, just flagging it since
    // it's the one place where timing assumptions (rather than a hard check) are still
    // doing the safety work.

    let waitingBeforeFinalActionMS = 0;

    if (diffMs > 0) {
      const reloadStartTime = Date.now();
      await sleep(SLEEP_BEFORE_ACCEPT_OR_REJECT_MS);
      waitingBeforeFinalActionMS = Date.now() - reloadStartTime;
    }

    // Not awaited - purely visual (showPageSnackbar never throws, it
    // logs and swallows internally), so it shouldn't serialize an extra
    // page.evaluate round-trip onto this time-critical path in front of
    // the actual submit call.
    showPageSnackbar(page, {
      message: `Submitting ${isAcceptanceAction ? "acceptance" : "rejection"} via direct API...`,
      severity: "info",
    });

    const elapsedBeforeActionMs = Date.now() - startTime;

    let currentRetryCount = 1;
    let retryReason = "";

    const actionTimeStart = Date.now();
    let apiResult = null;

    while (currentRetryCount <= MAX_ACTION_RETRIES) {
      apiResult = await submitWaslaReferralViaApi({
        page,
        navigationId,
        notes: description,
        rejectionReasonId: REJECTION_REASON_ID,
        isAccept: isAcceptanceAction,
        attachmentId: uploadResult.attachmentId,
        // we pass these incase the letter file was not pre-uploaded, so we can upload it now
        fileBase64: letterFileBase64,
        fileName: randomFileName,
      });

      const { success, error } = apiResult;

      if (success) {
        break;
      }

      if (error?.includes?.("review window has elapsed")) {
        retryReason = error;
        await sleep(SLEEP_WHEN_ACCEPT_OR_REJECT_RETRY_MS);
        currentRetryCount++;
      } else {
        break;
      }
    }

    const actionTimeMs = Date.now() - actionTimeStart;

    // currentRetryCount overshoots by 1 when retries are exhausted (it's
    // bumped once more before the while condition re-checks and exits),
    // so it's clamped here rather than reported as-is - otherwise an
    // exhausted-retries run would claim one more attempt than actually
    // happened.
    const attemptsMade = Math.min(currentRetryCount, MAX_ACTION_RETRIES);

    if (apiResult) {
      showPageSnackbar(page, {
        message: apiResult.success
          ? `${isAcceptanceAction ? "Accepted" : "Rejected"} via direct API`
          : `Direct API ${isAcceptanceAction ? "accept" : "reject"} failed - falling back to UI`,
        severity: apiResult.success ? "success" : "error",
      });

      const actionTakenAfterEndMs = actionTimeStart - referralEndTimestamp;

      await sendTelegramMessage?.(
        buildDirectApiTelegramMessage({
          isAcceptanceAction,
          referralId,
          navigationId,
          apiResult,
          preUploadResult: uploadResult,
          diffMs,
          sleepMs: sleepMS,
          boundarySafetyMarginMs: BOUNDARY_SAFETY_MARGIN_MS,
          waitingBeforeFinalActionMS,
          elapsedBeforeActionMs,
          actionTimeMs,
          actionTakenAfterEndMs,
          attemptsMade,
          retryReason,
          sleepWhenAcceptOrRejectRetryMs: SLEEP_WHEN_ACCEPT_OR_REJECT_RETRY_MS,
        }),
      );
    }

    if (apiResult?.success) {
      createConsoleMessage(
        "success",
        `✅ [${actionType}] ${isAcceptanceAction ? "Accepted" : "Rejected"} via direct API for referralId=${referralId} (navigationId=${navigationId})`,
        "handleSubmitReferral",
      );

      if (isAcceptanceAction) {
        await notifyWatcherOfAcceptance({
          sendTelegramMessage,
          referralId,
          patientName,
          navigationId,
        });
      }

      // this is now supports rejection and accteptance
      await sleep(3_000);
      patientsStore.addNonClaimableCase(referralId, referralEndTimestamp);
      await closePageSafely(page);
      return;
    }

    // const actionButtonTimingLine = `actionButtonHandle: ${actionButtonHandle ? "resolved" : "timed out"} after \`${actionButtonWaitMs}ms\``;

    // Scrolls the window AND any element whose own content overflows -
    // this page's layout may scroll via an inner MUI content pane rather
    // than document.body/window (confirmed live: a plain window.scrollTo
    // here stopped having any visible effect), so rather than guess at one
    // specific container's selector, this just scrolls everything that
    // can scroll. Purely for the human operator left looking at this tab
    // afterward (see file docblock) - doesn't gate the actual button
    // click below, which Puppeteer already scrolls into view itself.
    await page
      .evaluate(() => {
        window.scrollTo(0, document.body.scrollHeight);
        // document.querySelectorAll("*").forEach((el) => {
        //   if (el.scrollHeight > el.clientHeight + 10) {
        //     el.scrollTop = el.scrollHeight;
        //   }
        // });
      })
      .catch(() => {});

    // Confirmed live: the accept/reject button starts disabled and only
    // becomes clickable later (same shape as the Confirm button further
    // down) - matching by text alone found it while still disabled, so
    // the real click landed (native focus happened) but React's handler
    // no-op'd on the disabled state, and the popup never opened.
    const tActionButtonWaitStart = Date.now();

    const actionButtonHandle = await page
      .waitForFunction(
        (texts) => {
          const normalize = (text) => (text || "").replace(/\s+/g, " ").trim();

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
      await page.keyboard.type(description);
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

      await notifyWatcherOfAcceptance({
        sendTelegramMessage,
        referralId,
        patientName,
        navigationId,
      });

      // Same bookkeeping handleCaseAcceptanceOrRejection.mjs does right
      // after a real acceptance API call: mark the case as needing its
      // claimed status checked later (checkReferralSelectedStatus.mjs
      // polls patientsStore.getAllNonClaimableCases() and removes it once
      // confirmed), since clicking Confirm here doesn't itself tell us
      // whether Wasla actually accepted the submission.
      await sleep(SLEEP_AFTER_CONFIRMATION_MS);
      patientsStore.addNonClaimableCase(referralId, referralEndTimestamp);
      await closePageSafely(page);
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
