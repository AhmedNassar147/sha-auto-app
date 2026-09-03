/*
 *
 * Helper: `generateRandomFileName`.
 *
 * Extracted out of handleSubmitReferral.mjs so the random attachment file
 * name can be generated once, at patient-collection time
 * (processCollectingPatients.mjs), and persisted on the patient record
 * (randomFileName) instead of being regenerated - randomly, differently -
 * on every later use.
 *
 */
import randomArrayItem from "./randomArrayItem.mjs";
import shuffleArray from "./shuffleArray.mjs";
import createRandomAttachmentKey from "./createRandomAttachmentKey.mjs";
import { LETTER_LAYOUT_ABBREVIATIONS } from "./constants.mjs";

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

/**
 * @param {{ patientName?: string, referralId?: string, letterType?: string }} args
 * @returns {string} e.g. "John (ABC12) Letter File 352923.pdf"
 */
const generateRandomFileName = ({ patientName, referralId, letterType }) => {
  const patientFileName =
    (patientName || "").trim().split(/\s+/)[0] || "Patient";

  const attachmentKey = createRandomAttachmentKey();

  const abbreviation =
    Math.random() < 0.8 ? LETTER_LAYOUT_ABBREVIATIONS[letterType] : undefined;

  const formattedKey =
    Math.random() < 0.67 ? `(${attachmentKey})` : attachmentKey;

  const attachmentSeparator = Math.random() < 0.52 ? "-" : " ";

  const formattedAttachmentKey = shuffleArray(
    [formattedKey, abbreviation].filter(Boolean),
  ).join(attachmentSeparator);

  const randomKey = Math.random() < 0.6 ? formattedAttachmentKey : abbreviation;

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

  return `${shuffleArray(fileNameParts).join(" ")}.pdf`;
};

export default generateRandomFileName;
