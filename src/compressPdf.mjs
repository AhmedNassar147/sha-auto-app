/*
 *
 * Helper: `compressPdf` — moderate image compression, preserving text.
 *
 */
import { execFile } from "child_process";
import { readFile, writeFile } from "node:fs/promises";
import { PDFDocument } from "pdf-lib";
import createConsoleMessage from "./createConsoleMessage.mjs";

// 1- install Ghostscript https://ghostscript.com/releases/gsdnld.html
// 2- add C:\Program Files\gs\gs10.05.1\bin to your PATH environment variable

const compressPdf = (input, output) => {
  return new Promise((resolve) => {
    // pdfwrite keeps text/vector content sharp rather than flattening
    // the entire page into a low-resolution image.
    const args = [
      "-sDEVICE=pdfwrite",
      "-r10",
      "-dCompatibilityLevel=1.4",
      "-dPDFSETTINGS=/ebook",
      "-dEmbedAllFonts=true",
      "-dSubsetFonts=true",
      "-dCompressFonts=true",
      "-dDetectDuplicateImages=true",
      "-dDownsampleColorImages=true",
      "-dDownsampleGrayImages=true",
      "-dDownsampleMonoImages=true",
      "-dColorImageResolution=150",
      "-dGrayImageResolution=150",
      "-dMonoImageResolution=200",
      "-dAutoFilterColorImages=false",
      "-dAutoFilterGrayImages=false",
      "-dColorImageFilter=/DCTEncode",
      "-dGrayImageFilter=/DCTEncode",
      "-dJPEGQ=70",
      "-dCompressPages=true",
      "-dNOPAUSE",
      "-dQUIET",
      "-dBATCH",
      `-sOutputFile=${output}`,
      input,
    ];

    execFile("gswin64c", args, { windowsHide: true }, async (err) => {
      if (err) {
        resolve({ success: false, error: err });
      } else {
        try {
          // Lossless object packing reduces PDF overhead without
          // rasterizing text or removing embedded fonts.
          const bytes = await readFile(output);
          const pdf = await PDFDocument.load(bytes, { updateMetadata: false });
          const packed = await pdf.save({ useObjectStreams: true });
          if (packed.length < bytes.length) await writeFile(output, packed);
        } catch (error) {
          createConsoleMessage(
            "warn",
            `PDF object packing failed; keeping the Ghostscript output: ${error.message}`,
            "compressPdf",
          );
        }
        resolve({ success: true, output });
      }
    });
  });
};

export default compressPdf;
