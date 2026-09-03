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
import randomArrayItem from "./randomArrayItem.mjs";
import shuffleArray from "./shuffleArray.mjs";
import createRandomAttachmentKey from "./createRandomAttachmentKey.mjs";
import {
  API_URLS,
  LETTER_LAYOUT_ABBREVIATIONS,
  USER_ACTION_TYPES,
  WASLA_REFERRAL_VIEW_URL,
} from "./constants.mjs";

const NAVIGATION_TIMEOUT_MS = 30_000;
const { ACCEPT_CASE, REJECT_CASE } = API_URLS;

const { ACCEPT, REJECT } = USER_ACTION_TYPES;

const FILE_NAMES = [
  "Letter",
  "Form",
  "File",
  "Acceptance",
  "ViewAcc",
  "Document",
  "Letter Form",
  "Letter Acc",
  "Letter File",
  "DocFile",
  "ReportAcc",
  "patientAcc",
  "CaseLetter",
  "ItemFile",
  "Case Acceptance",

  "Approval",
  "Approval Letter",
  "Approval Form",
  "Approval File",
  "Acceptance Form",
  "Acceptance Letter",
  "Acceptance Report",
  "Acceptance Document",
  "Acceptance File",
  "Referral Letter",
  "Referral Form",
  "Referral File",
  "Referral Document",
  "Medical Letter",
  "Patient Letter",
  "Case File",
  "Case Approval",
  "Referral Approval",
  "Confirmation",
  "Confirmation Letter",
  "Confirmation Form",
  "Confirmation File",
  "Referral Acc",
  "Patient Report",

  "Acquire Document",
  "Acquire Letter",
  "Acquire Form",
  "Acquire Report",
];

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
    patientName,
    letterType,
  }) => {
    if (!navigationId) {
      createConsoleMessage(
        "error",
        `❌ Missing navigationId for referralId=${referralId} actionType=[${actionType}], cannot open referral view.`,
        "handleSubmitReferral",
      );
      return;
    }

    const url = `${WASLA_REFERRAL_VIEW_URL}/${navigationId}`;

    try {
      const page = await browser.newPage();

      await page.goto(url, {
        waitUntil: "domcontentloaded",
        timeout: NAVIGATION_TIMEOUT_MS,
      });

      await page.evaluate(() => {
        window.scrollTo(0, document.body.scrollHeight);
      });

      const isAcceptanceAction = actionType === ACCEPT;

      const { fileData: filebase64 } = await getCurrentActionLetterFile(
        referralId,
        isAcceptanceAction ? actionType : REJECT,
      );

      const patientFileName =
        (patientName || "").trim().split(/\s+/)[0] || "Patient";

      const attachmentKey = createRandomAttachmentKey();

      const abbreviation =
        Math.random() < 0.8
          ? LETTER_LAYOUT_ABBREVIATIONS[letterType]
          : undefined;

      const formattedKey =
        Math.random() < 0.67 ? `(${attachmentKey})` : attachmentKey;

      const attachmentSeparator = Math.random() < 0.52 ? "-" : " ";

      const formattedAttachmentKey = shuffleArray(
        [formattedKey, abbreviation].filter(Boolean),
      ).join(attachmentSeparator);

      const randomKey =
        Math.random() < 0.6 ? formattedAttachmentKey : abbreviation;

      const shouldUseRandomKeyAsSeparatePart = Math.random() < 0.7;
      const documentName = randomArrayItem(FILE_NAMES);

      const formattedDocumentName = [
        documentName,
        shouldUseRandomKeyAsSeparatePart ? undefined : randomKey,
      ]
        .filter(Boolean)
        .join(" ");

      const fileNameParts = [
        patientFileName,
        shouldUseRandomKeyAsSeparatePart ? randomKey : undefined,
        formattedDocumentName,
        referralId,
      ].filter(Boolean);

      // const files = [
      //   {
      //     fileName: `${shuffleArray(fileNameParts).join(" ")}.pdf`,
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
