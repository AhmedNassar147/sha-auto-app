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
import {
  API_URLS,
  USER_ACTION_TYPES,
  WASLA_REFERRAL_VIEW_URL,
} from "./constants.mjs";

const NAVIGATION_TIMEOUT_MS = 20_000;
const { ACCEPT_CASE, REJECT_CASE } = API_URLS;

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
// rejection-modal.html, plus the accept variant's screenshot) - stable MUI
// base classes (not the hashed per-build "mui-xxxxxx" ones) and plain tag
// selectors, no page text.
const MODAL_FILE_INPUT_SELECTOR = ".MuiDialog-root input[type='file']";
const MODAL_TEXTAREA_SELECTOR = ".MuiDialog-root textarea";
const MODAL_TIMEOUT_MS = 15_000;
const DESCRIPTION_TYPE_DELAY_MS = 20;
const DESCRIPTION_TYPE_DELAY_JITTER_MS = 20;

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

// https://weslah.seha.sa/facility-referrals/view/OWPFET926JK5V4T

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
      createConsoleMessage(
        "error",
        `❌ Missing navigationId for referralId=${referralId} actionType=[${actionType}], cannot open referral view.`,
        "handleSubmitReferral",
      );
      return;
    }

    const isAcceptanceAction = actionType === ACCEPT;

    const url = `${WASLA_REFERRAL_VIEW_URL}/${navigationId}`;

    try {
      const page = await browser.newPage();

      const [, { fileData: filebase64, filePath: letterFilePath }] =
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

      // const files = [
      //   {
      //     fileName: randomFileName,
      //     fileData: filebase64,
      //     fileExtension: 0,
      //     userCode: CLIENT_NAME,
      //     idAttachmentType: 14,
      //     languageCode: 1,
      //   },
      // ];

      const targetButtonTexts = isAcceptanceAction
        ? ACCEPT_BUTTON_TEXTS
        : REJECT_BUTTON_TEXTS;

      const actionButtonHandle = await page
        .waitForFunction(
          (texts) => {
            const normalize = (text) =>
              (text || "").replace(/\s+/g, " ").trim();

            const buttons = [...document.querySelectorAll("button")];

            return (
              buttons.find((button) =>
                texts.includes(normalize(button.textContent)),
              ) || null
            );
          },
          { timeout: ACTION_BUTTON_TIMEOUT_MS },
          targetButtonTexts,
        )
        .catch(() => null);

      if (!actionButtonHandle) {
        createConsoleMessage(
          "error",
          `❌ Neither "${targetButtonTexts.join('" nor "')}" button was found for referralId=${referralId} (navigationId=${navigationId})`,
          "handleSubmitReferral",
        );
        await captureFailureArtifacts(page, "submit-referral-button-not-found");
        return;
      }

      try {
        await actionButtonHandle.asElement()?.click();
      } catch (error) {
        createConsoleMessage(
          "error",
          `❌ Failed to click ${isAcceptanceAction ? "accept" : "reject"} button for referralId=${referralId} (navigationId=${navigationId}): ${error.message}`,
          "handleSubmitReferral",
        );
        await captureFailureArtifacts(page, "submit-referral-click-failed");
        return;
      }

      createConsoleMessage(
        "success",
        `✅ [${actionType}] Clicked ${isAcceptanceAction ? "accept" : "reject"} button for referralId=${referralId} (navigationId=${navigationId})`,
        "handleSubmitReferral",
      );

      // Both fields live in the same modal for the accept case, so their
      // waits run together instead of stacking up to 2x MODAL_TIMEOUT_MS
      // sequentially. Reject's modal has no textarea at all, so that wait
      // is skipped there rather than parallelized into a guaranteed timeout.
      const [fileInputHandle, descriptionHandle] = await Promise.all([
        page
          .waitForSelector(MODAL_FILE_INPUT_SELECTOR, {
            timeout: MODAL_TIMEOUT_MS,
          })
          .catch(() => null),
        isAcceptanceAction
          ? page
              .waitForSelector(MODAL_TEXTAREA_SELECTOR, {
                timeout: MODAL_TIMEOUT_MS,
              })
              .catch(() => null)
          : null,
      ]);

      if (!fileInputHandle) {
        createConsoleMessage(
          "error",
          `❌ Confirmation popup never appeared for referralId=${referralId} (navigationId=${navigationId})`,
          "handleSubmitReferral",
        );
        await captureFailureArtifacts(page, "submit-referral-modal-not-found");
        return;
      }

      if (isAcceptanceAction) {
        if (!descriptionHandle) {
          createConsoleMessage(
            "error",
            `❌ Description field not found in acceptance popup for referralId=${referralId} (navigationId=${navigationId})`,
            "handleSubmitReferral",
          );
          await captureFailureArtifacts(
            page,
            "submit-referral-description-not-found",
          );
          return;
        }

        const description = randomArrayItem(ACCEPTANCE_DESCRIPTION_TEMPLATES)(
          navigationId,
        );

        await descriptionHandle.click();
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
          createConsoleMessage(
            "error",
            `❌ Failed to attach letter file for referralId=${referralId} (navigationId=${navigationId}): ${error.message}`,
            "handleSubmitReferral",
          );
          await captureFailureArtifacts(page, "submit-referral-attach-failed");
          return;
        }
      }

      createConsoleMessage(
        "success",
        `✅ [${actionType}] Filled confirmation popup for referralId=${referralId} (navigationId=${navigationId})`,
        "handleSubmitReferral",
      );
    } catch (error) {
      createConsoleMessage(
        "error",
        error,
        `❌ Failed to open referral view for referralId=${referralId} (navigationId=${navigationId})`,
      );
    }
  };

export default handleSubmitReferral;
