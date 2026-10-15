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
 * @param {{ patientName?: string, referralId?: string, letterType?: string, navigationId: string, referralReferenceId?: number }} args
 * @returns {string} e.g. "John (ABC12) Letter File 352923.pdf"
 */
const generateRandomFileName = ({
  patientName,
  referralId,
  letterType,
  navigationId,
  referralReferenceId,
}) => {
  const patientFileName =
    (patientName || "").trim().split(/\s+/)[0] || "Patient";

  const attachmentKey = createRandomAttachmentKey();

  const abbreviation =
    Math.random() < 0.35 ? LETTER_LAYOUT_ABBREVIATIONS[letterType] : undefined;

  const formattedKey =
    Math.random() < 0.67 ? `(${attachmentKey})` : attachmentKey;

  const attachmentSeparator = Math.random() < 0.52 ? "-" : " ";

  const formattedAttachmentKey = shuffleArray(
    [formattedKey, abbreviation].filter(Boolean),
  ).join(attachmentSeparator);

  // abbreviation is itself undefined ~20% of the time (see above), so
  // falling back to it unconditionally could silently drop the key
  // entirely - formattedAttachmentKey is always a valid, non-empty string.
  const randomKey =
    (Math.random() < 0.6 ? formattedAttachmentKey : abbreviation) ??
    formattedAttachmentKey;

  const shouldUseRandomKeyAsSeparatePart = Math.random() < 0.7;
  const documentName = randomArrayItem(FILE_NAMES);

  const formattedDocumentName = [
    documentName,
    shouldUseRandomKeyAsSeparatePart ? undefined : randomKey,
  ]
    .filter(Boolean)
    .join(" ");

  // Fixed field order (name -> key -> document type -> id) rather than
  // shuffled - varying the words/separators/which pieces appear already
  // gives per-case variety; also randomizing which field comes first would
  // make the name structurally incoherent (e.g. the id before the patient
  // name), which reads as a different kind of obviously-generated rather
  // than more human.
  const fileNameParts = [
    patientFileName,
    shouldUseRandomKeyAsSeparatePart ? randomKey : undefined,
    formattedDocumentName,
    randomArrayItem(
      [referralReferenceId, navigationId, referralId].filter(Boolean),
    ),
  ].filter(Boolean);

  return `${fileNameParts.join(" ")}.pdf`;
};

export default generateRandomFileName;
