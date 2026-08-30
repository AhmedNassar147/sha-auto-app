/*
 *
 * Helper: `uploadToTransferIt`.
 *
 */
import closePageSafely from "./closePageSafely.mjs";
import compressPdfGentlly, { unlinkFiles } from "./compressPdfGentlly.mjs";
import formatFilesToTelegram from "./formatFilesToTelgram.mjs";
import mergeAllToPdf from "./mergeFilesToOne.mjs";
import sleep from "./sleep.mjs";

const uploadToTransferIt = async ({ files = [], message = "", browser }) => {
  if (!browser) {
    return {
      success: false,
      message: "Browser instance is required",
    };
  }

  const page = await browser.newPage();

  let inFile;
  let outFile;

  try {
    await page.goto("https://transfer.it/start", {
      waitUntil: "networkidle2",
      timeout: 60000,
    });

    await sleep(3000);

    const fileInput = await page.waitForSelector('input[name="select-file"]', {
      timeout: 30000,
    });

    const { docs = [], photos = [] } = await formatFilesToTelegram(files);

    if (!docs.length && !photos.length) {
      return {
        success: false,
        message: "No files to upload",
      };
    }

    const { baseName } =
      [...docs, ...photos].find(
        ({ filename, baseName }) => !!(filename && baseName),
      ) ?? {};

    const finalMergedFileName = `${baseName || "Gm-File"}_merged.pdf`;

    const mergedFile = await mergeAllToPdf(photos, docs, finalMergedFileName);

    const compressionResult = await compressPdfGentlly(mergedFile, {
      unlinkFilesFinally: false,
    });

    const compressedMerged = compressionResult.compressedMerged;
    inFile = compressionResult.inFile;
    outFile = compressionResult.outFile;

    if (!compressedMerged) {
      return {
        success: false,
        message: "Failed to compress merged PDF",
      };
    }

    const uploadFilePath = compressionResult.usedCompressed ? outFile : inFile;
    await fileInput.uploadFile(uploadFilePath);

    await page.waitForSelector(".js-added-files-section:not(.hidden)", {
      timeout: 30000,
    });

    await page.waitForSelector("#glb-title-input", {
      timeout: 30000,
    });

    await page.click("#glb-title-input", { clickCount: 3 });
    await page.type("#glb-title-input", finalMergedFileName);

    if (message) {
      await page.waitForSelector("#glb-msg-area", {
        timeout: 30000,
      });

      await page.click("#glb-msg-area", { clickCount: 3 });
      await page.type("#glb-msg-area", message);
    }

    await page.click(".js-get-link-button");

    await page.waitForSelector(".transferring-box.completed .js-copy-link", {
      timeout: 1000 * 60 * 30,
    });

    await page.click(".transferring-box.completed .js-copy-link");

    await page.waitForSelector(".js-link-ready-section:not(.hidden)", {
      timeout: 30000,
    });

    let isTransferUrlCopied = false;

    let transferUrl = await page.$eval('input[name="lrb-link"]', (input) =>
      input.value.trim(),
    );

    if (!transferUrl) {
      transferUrl = await page.evaluate(async () =>
        navigator.clipboard.readText(),
      );

      transferUrl = transferUrl.trim();
      isTransferUrlCopied = true;
    }

    return {
      success: true,
      transferUrl,
      isTransferUrlCopied,
    };
  } catch (error) {
    return {
      success: false,
      message: `Failed to upload file to Transfer.it ${error.message}`,
    };
  } finally {
    await unlinkFiles(inFile, outFile).catch(() => {});
    await closePageSafely(page);
  }
};

export default uploadToTransferIt;
