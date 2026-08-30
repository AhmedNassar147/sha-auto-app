/*
 *
 * Helper: `mergeFilesToOne`.
 *
 */
import { PDFDocument } from "pdf-lib";

const mergeAllToPdf = async (photos, docs, name = "merged") => {
  const merged = await PDFDocument.create();

  // Add PDF pages first
  for (const doc of docs) {
    const pdf = await PDFDocument.load(doc.buffer);
    const pages = await merged.copyPages(pdf, pdf.getPageIndices());
    pages.forEach((page) => merged.addPage(page));
  }

  // Add photos after
  for (const photo of photos) {
    const extension = photo.filename.split(".").pop().toLowerCase();

    let image;
    if (extension === "png") {
      image = await merged.embedPng(photo.buffer);
    } else {
      image = await merged.embedJpg(photo.buffer);
    }

    const page = merged.addPage([image.width, image.height]);
    page.drawImage(image, {
      x: 0,
      y: 0,
      width: image.width,
      height: image.height,
    });
  }

  return Buffer.from(await merged.save());
};

export default mergeAllToPdf;
