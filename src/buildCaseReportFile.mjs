/*
 *
 * Helper: `buildCaseReportFile`.
 *
 * Builds the single "case report" file representing all of a case's
 * attachments (one file whether that's the only attachment as-is, or
 * several merged into one PDF) - the same shape
 * installTelegramBotApi.mjs's sendTelegramMessage sends to the operator and
 * caches as attachmentFileBase64/attachmentFileName/attachmentFileMimeType
 * (see db.mjs) - factored out here so backfillPatientDetails.mjs can build/
 * cache it for old rows too, without re-deriving the single-doc/
 * single-photo/merge decision separately.
 *
 */
import mergeAllToPdf from "./mergeFilesToOne.mjs";
import compressPdfGentlly from "./compressPdfGentlly.mjs";
import formatFilesToTelegram from "./formatFilesToTelgram.mjs";

/**
 * @param {object[]} files - Raw downloaded attachment entries (fileBase64/
 *   fileName/extension/downloadError), as returned by
 *   getWaslaPatientReferralDataFromAPI.mjs's `files`.
 * @param {string} [fallbackName] - Used for the merged filename when none of
 *   the files carry their own baseName (e.g. the referralId).
 * @returns {Promise<{ buffer: Buffer, filename: string, mimeType: string } | null>}
 *   null when there's nothing to build (no docs/photos - xlsx-only or empty).
 */
const buildCaseReportFile = async (files, fallbackName = "report") => {
  const { docs, photos } = await formatFilesToTelegram(files);

  if (!docs.length && !photos.length) {
    return null;
  }

  if (photos.length === 0 && docs.length === 1) {
    const [{ buffer, filename, mimeType }] = docs;
    return { buffer, filename, mimeType };
  }

  if (photos.length === 1 && docs.length === 0) {
    const [{ buffer, filename, mimeType }] = photos;
    return { buffer, filename, mimeType };
  }

  const { baseName } =
    [...docs, ...photos].find(
      ({ filename, baseName }) => !!(filename && baseName),
    ) ?? {};

  const finalMergedFileName = `${baseName || fallbackName}_merged.pdf`;

  const merged = await mergeAllToPdf(
    photos || [],
    docs || [],
    finalMergedFileName,
  );

  const { compressedMerged } = await compressPdfGentlly(merged, {
    unlinkFilesFinally: true,
  });

  return {
    buffer: compressedMerged,
    filename: finalMergedFileName,
    mimeType: "application/pdf",
  };
};

export default buildCaseReportFile;
