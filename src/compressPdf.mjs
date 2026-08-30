/*
 *
 * Helper: `compressPdfAggressive`.
 *
 */
import { exec } from "child_process";

// 1- install Ghostscript https://ghostscript.com/releases/gsdnld.html
// 2- add C:\Program Files\gs\gs10.05.1\bin to your PATH environment variable

const compressPdfAggressive = (input, output) => {
  return new Promise((resolve) => {
    const cmd = `gswin64c -sDEVICE=pdfimage8 -r67 -dCompatibilityLevel=1.3 \
      -dPDFSETTINGS=/screen -dEmbedAllFonts=false -dSubsetFonts=true -dCompressFonts=true \
      -dDetectDuplicateImages=true -dDownsampleColorImages=true \
      -dColorImageResolution=35 -dGrayImageResolution=35 -dMonoImageResolution=35 \
      -dAutoFilterColorImages=false -dColorImageFilter=/DCTEncode -dJPEGQ=35 \
      -dCompressPages=true \
      -dPreserveAnnots=false -dPreserveMarkedContent=false -dPreserveOverprintSettings=false \
      -dPreserveOPIComments=false -dPreserveEPSInfo=false \
      -dNOPAUSE -dQUIET -dBATCH -sOutputFile="${output}" "${input}"`;

    exec(cmd, (err) => {
      if (err) {
        resolve({ success: false, error: err });
      } else {
        resolve({ success: true, output });
      }
    });
  });
};

export default compressPdfAggressive;
