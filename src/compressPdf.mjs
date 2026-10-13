/*
 *
 * Helper: `compressPdf` — moderate image compression, preserving text.
 *
 */
import { execFile } from "child_process";
import { readFile, writeFile } from "node:fs/promises";
import { PDFDocument, PDFRawStream, PDFName } from "pdf-lib";
import { inflateSync, deflateSync } from "node:zlib";
import createConsoleMessage from "./createConsoleMessage.mjs";

// 1- install Ghostscript https://ghostscript.com/releases/gsdnld.html
// 2- add C:\Program Files\gs\gs10.05.1\bin to your PATH environment variable

const compressPdf = (input, output) => {
  //  *   pdfSettings?: "/screen"|"/ebook"|"/printer"|"/prepress"|"/default",

  return new Promise((resolve) => {
    // pdfwrite keeps text/vector content sharp rather than flattening
    // the entire page into a low-resolution image.
    const args = [
      // "-sDEVICE=pdfimage8",
      "-sDEVICE=pdfwrite",
      "-r5",
      "-dCompatibilityLevel=1.4",
      "-dPDFSETTINGS=/ebook",
      "-dEmbedAllFonts=true",
      "-dSubsetFonts=true",
      "-dCompressFonts=true",
      "-dDetectDuplicateImages=true",
      "-dDownsampleColorImages=true",
      "-dDownsampleGrayImages=true",
      "-dDownsampleMonoImages=true",
      "-dColorImageResolution=75",
      "-dGrayImageResolution=75",
      "-dMonoImageResolution=140",
      "-dAutoFilterColorImages=false",
      "-dAutoFilterGrayImages=false",
      "-dColorImageFilter=/DCTEncode",
      "-dGrayImageFilter=/DCTEncode",
      "-dJPEGQ=40",
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
          // Maximize lossless compression of text, font, and other
          // Flate-encoded streams without changing their decoded content.
          for (const [, object] of pdf.context.enumerateIndirectObjects()) {
            if (
              !(object instanceof PDFRawStream) ||
              String(object.dict.get(PDFName.of("Filter"))) !== "/FlateDecode"
            )
              continue;
            try {
              const compressed = deflateSync(inflateSync(object.contents), {
                level: 9,
              });
              if (compressed.length < object.contents.length)
                object.contents = compressed;
            } catch {
              // Keep the original stream if it cannot be recompressed.
            }
          }
          const packed = await pdf.save({ useObjectStreams: true });
          if (packed.length < bytes.length) await writeFile(output, packed);
        } catch (error) {}
        resolve({ success: true, output });
      }
    });
  });
};

export default compressPdf;
