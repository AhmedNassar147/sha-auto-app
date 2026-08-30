/*
 *
 * Helper: `containsExcludedText`.
 *
 */
import { PDFParse } from "pdf-parse";
// import formatFilesToTelegram from "./formatFilesToTelgram.mjs";
// import createConsoleMessage from "./createConsoleMessage.mjs";
// import { readFile } from "fs/promises";
// import { basename, extname } from "path";

const EXCLUDED_TEXT_PATTERNS = [
  "https://www.chi.gov.sa", // insurance inquiry website URL
  "مجلس الضمان الصحي", // Council of Health Insurance in Arabic
  "checkinsurance", // URL pattern
  "ليس لديك تأمين", // "You have no insurance" in Arabic
  "الاستعلام عن معلومات التأمين", // Page title in Arabic
  "جميع الحقوق محفوظة لمجلس الضمان", // Copyright footer
  "ضمان يهتم", // App name in footer
];

const EXCLUDED_TITLES = [
  "'D'3*9D'E 9F E9DHE'* 'D*#EJF", // Arabizi encoding
  "Ø§Ù—Ø§Ø³ØªØ¹Ù—Ø§Ù– Ø¹Ùƒ Ù–Ø¹Ù—Ù‹Ù–Ø§Øª Ø§Ù—ØªØ£Ù–Ù−Ùƒ", // URL-encoded Arabic
  ...EXCLUDED_TEXT_PATTERNS,
];

// ─── NORMALIZE ────────────────────────────────────────────────────────────────

const normalizeStr = (str) => str.toLowerCase().trim();

// ─── PDF EXCLUSION CHECK ──────────────────────────────────────────────────────

const containsExcludedText = async ({ fileBase64, extension }) => {
  // Only parse PDFs — keep photos/excel as is
  if (extension !== "pdf" || !fileBase64) return false;

  try {
    const cleanBase64 = fileBase64.replace(/^data:.*?base64,/, "").trim();
    const buffer = Buffer.from(cleanBase64, "base64");
    const parser = new PDFParse({ data: buffer });

    // Check metadata first — faster than full text extraction
    const info = await parser.getInfo();
    const nonNormalizedTitle = info.info?.Title || "";
    const title = normalizeStr(nonNormalizedTitle || "");
    const producer = (info.info?.Producer || "").toLowerCase().trim();

    // createConsoleMessage(
    //   `PDF Title: "${title}" | Producer: "${producer || ""} | nonNormalizedTitle: "${nonNormalizedTitle}"`,
    //   "info",
    // );

    // Garbled title = contains ? characters (encoding failure)
    const isGarbledTitle =
      nonNormalizedTitle.includes("?") &&
      !nonNormalizedTitle.match(/[\u0600-\u06FFa-zA-Z0-9]/);

    const isExcludedByProducer =
      // Acrobat Distiller + garbled title = insurance file printed via PostScript
      producer.includes("acrobat distiller") && isGarbledTitle;

    if (isExcludedByProducer) {
      await parser.destroy();
      return true;
    }

    const _isExcludedByTitle = EXCLUDED_TITLES.some(
      (t) => nonNormalizedTitle.includes(t), // no normalizeStr — keep raw to match encoding
    );

    // Primary check — encoded title unique to chi.gov.sa insurance page
    const isExcludedByTitle =
      _isExcludedByTitle ||
      EXCLUDED_TITLES.some((t) => title.includes(normalizeStr(t)));

    if (isExcludedByTitle) {
      await parser.destroy();
      return true;
    }

    // Fallback — check extracted text + links (for non-image PDFs)
    const result = await parser.getText({ first: 3 });
    const text = result.text || "";
    const links = result.pages?.flatMap((p) => p.links || []) || [];
    const urls = links.map((l) => l.url || "").join(" ");
    const combined = normalizeStr(`${text} ${urls}`);

    await parser.destroy();

    return EXCLUDED_TEXT_PATTERNS.some((pattern) =>
      combined.includes(normalizeStr(pattern)),
    );
  } catch {
    return false; // on error keep the file
  }
};

export default containsExcludedText;

// const testExcludedText = async (filePaths) => {
//   const _files = await Promise.all(
//     filePaths.map(async (filePath) => {
//       const buffer = await readFile(filePath);
//       const base64 = buffer.toString("base64");
//       const extension = extname(filePath).replace(".", ""); // "pdf"
//       const fileName = basename(filePath, extname(filePath)); // "350824_report"

//       return {
//         fileBase64: base64,
//         extension,
//         fileName,
//       };
//     }),
//   );

//   const files = await formatFilesToTelegram(_files);

//   return files.map(({ fileName }) => fileName);
// };

// const filePaths = [
//   // "D:/work/future/clone-icare/automize-icare/results/test-insurance/4_5767184761109881224.pdf",
//   // "D:/work/future/clone-icare/automize-icare/results/test-insurance/4_5769392597638325783.pdf",
//   // "D:/work/future/clone-icare/automize-icare/results/test-insurance/4_5778414691839652703.pdf",
//   // "D:/work/future/clone-icare/automize-icare/results/test-insurance/377144_Internal Medicine_1030700098.pdf",
// ];
// const res = await testExcludedText(filePaths);

// console.log("res", res);
