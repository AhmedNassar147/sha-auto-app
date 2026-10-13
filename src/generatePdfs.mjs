/*
 *
 * Helper: `generateAcceptancePdfLetters`.
 *
 */
import { writeFile, unlink } from "fs/promises";
import os from "os";
import pLimit from "p-limit";
import generateAcceptanceLetterHtml from "./generateAcceptanceLetterHtml.mjs";
import chooseEnabledLetterLayout from "./chooseEnabledLetterLayout.mjs";
import compressPdf from "./compressPdf.mjs";
import renderSinglePagePdf from "./renderSinglePagePdf.mjs";
import {
  USER_ACTION_TYPES,
  generatedPdfsPathForAcceptance,
  generatedPdfsPathForRejection,
} from "./constants.mjs";

const { ACCEPT, REJECT } = USER_ACTION_TYPES;

const generateAcceptancePdfLetters = async (
  browser,
  patientsArray,
  isAcceptance,
  letterType,
  { allowAllLayouts = false } = {},
) => {
  const {
    CLIENT_IN_PDF_NAME,
    CLIENT_MANAGER_NAME,
    CLIENT_MANAGER_PHONE,
    LETTER_TYPE,
  } = process.env;

  const cpuCount = os.cpus().length; // Get the number of CPU cores

  const limit = pLimit(Math.min(4, cpuCount)); // Max 3 concurrent tabs

  const tasks = patientsArray.map((patient) =>
    limit(async () => {
      // Preview tests must be able to render disabled layouts too.
      const selectedLetterType = allowAllLayouts
        ? letterType || patient.letterType
        : chooseEnabledLetterLayout(
            LETTER_TYPE || letterType || patient.letterType,
          );
      const page = await browser.newPage();
      const html = generateAcceptanceLetterHtml({
        ...patient,
        isRejection: !isAcceptance,
        clientInPdf: CLIENT_IN_PDF_NAME || "",
        clientMangerName: CLIENT_MANAGER_NAME || "",
        clientManagerPhone: CLIENT_MANAGER_PHONE || "",
        letterType: selectedLetterType,
      }); // Assume you already have this
      await page.setContent(html, { waitUntil: "domcontentloaded" });

      await page.bringToFront();

      const { referralId } = patient;

      const fileName = `${isAcceptance ? ACCEPT : REJECT}-${referralId}`;

      const folderPath = isAcceptance
        ? generatedPdfsPathForAcceptance
        : generatedPdfsPathForRejection;

      const rawPdfPath = `${folderPath}/${fileName}-raw.pdf`;
      const finalPdfPath = `${folderPath}/${fileName}.pdf`;

      let pdfBytes;
      try {
        await page.evaluate(() => document.fonts.ready);
        pdfBytes = await renderSinglePagePdf(page, {
          format: "A4",
          // Avoid printBackground: true unless absolutely necessary — it increases size significantly
          printBackground: false,
          margin: {
            top: "10mm",
            bottom: "10mm",
            left: "10mm",
            right: "10mm",
          },
        });
      } finally {
        await page.close();
      }
      await writeFile(rawPdfPath, pdfBytes);

      // 2. Compress the PDF
      const result = await compressPdf(rawPdfPath, finalPdfPath);
      if (!result.success) throw result.error;
      await unlink(rawPdfPath);
      return { pdfPath: finalPdfPath, letterType: selectedLetterType };
    }),
  );

  return Promise.all(tasks);
};

export default generateAcceptancePdfLetters;
