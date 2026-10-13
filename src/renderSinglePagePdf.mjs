import { PDFDocument } from "pdf-lib";
import createConsoleMessage from "./createConsoleMessage.mjs";

/** Prefer one page; fall back to the full-size PDF if it cannot fit. */
export default async function renderSinglePagePdf(page, options) {
  let fullSizeBytes;
  try {
    // Keep RTL content inside the printable width when Chromium scales it.
    await page.addStyleTag({
      content: `
      @page { size: A4; margin: 10mm; }
      @media print {
        html { direction: ltr !important; }
        body {
          direction: rtl;
          width: 190mm !important;
          max-width: 190mm !important;
          box-sizing: border-box;
          margin: 0 auto !important;
        }
      }
    `,
    });
    for (const scale of [1, 0.9, 0.8, 0.7, 0.6, 0.5]) {
      const bytes = await page.pdf({ ...options, scale });
      if (scale === 1) fullSizeBytes = bytes;
      const pdf = await PDFDocument.load(bytes);
      if (pdf.getPageCount() === 1) return bytes;
    }
    return fullSizeBytes;
  } catch (error) {
    // createConsoleMessage(
    //   "warn",
    //   `One-page fitting failed; using the full-size PDF: ${error.message}`,
    //   "renderSinglePagePdf",
    // );
    if (fullSizeBytes) return fullSizeBytes;
    // A real printing failure (e.g. a closed browser) must still reach
    // the caller rather than returning undefined or an empty PDF.
    return page.pdf({ ...options, scale: 1 });
  }
}
