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
import {
  API_URLS,
  USER_ACTION_TYPES,
  WASLA_REFERRAL_VIEW_URL,
} from "./constants.mjs";

const NAVIGATION_TIMEOUT_MS = 20_000;
const { ACCEPT_CASE, REJECT_CASE } = API_URLS;

const { ACCEPT, REJECT } = USER_ACTION_TYPES;

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

      const [, { fileData: filebase64 }] = await Promise.all([
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
    } catch (error) {
      createConsoleMessage(
        "error",
        error,
        `❌ Failed to open referral view for referralId=${referralId} (navigationId=${navigationId})`,
      );
    }
  };

export default handleSubmitReferral;
