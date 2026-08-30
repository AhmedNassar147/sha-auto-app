/*
 *
 * Helper: `formatFilesToTelegram`.
 *
 */
import { parse } from "path";
import containsExcludedText from "./containsExcludedText.mjs";
import createConsoleMessage from "./createConsoleMessage.mjs";
import getMimeType from "./getMimeType.mjs";

const imageExtensions = ["jpg", "jpeg", "png", "gif", "webp"];

const getCleanBase64 = (base64) =>
  String(base64 || "")
    .replace(/^data:.*?base64,/i, "")
    .trim();

const getBase64SizeBytes = (base64) =>
  Math.floor((getCleanBase64(base64).length * 3) / 4);

const formatFilesToTelegram = async (files) => {
  if (!files?.length) {
    return {
      photos: [],
      docs: [],
      excelFiles: [],
    };
  }

  const validFiles = files.filter(({ downloadError, fileBase64, fileName }) => {
    if (downloadError || !fileBase64) {
      createConsoleMessage(
        "warn",
        `⚠️ Skipping file ${fileName} — ${downloadError || "no base64"}`,
      );

      return false;
    }

    return true;
  });

  const fileChecks = (
    await Promise.allSettled(
      validFiles.map(async (file) => ({
        file,
        exclude: await containsExcludedText(file),
      })),
    )
  )
    .filter(({ status }) => status === "fulfilled")
    .map(({ value }) => value);

  const formattedFiles = fileChecks
    .filter(({ exclude, file }) => {
      if (exclude) {
        createConsoleMessage("warn", `⏩ Excluding file: ${file.fileName}`);
      }

      return !exclude;
    })
    .map(({ file }) => file)
    .sort(
      (a, b) =>
        getBase64SizeBytes(b.fileBase64) - getBase64SizeBytes(a.fileBase64),
    );

  const photos = [];
  const docs = [];
  const excelFiles = [];

  for (const file of formattedFiles) {
    const cleanBase64 = getCleanBase64(file.fileBase64);

    const buffer = Buffer.from(cleanBase64, "base64");
    const extension = (file.extension || "pdf").toLowerCase();

    const rawFileName =
      file.fileName || `file-No-Name-${Date.now().toString(15)}`;

    const filename = rawFileName.toLowerCase().endsWith(`.${extension}`)
      ? rawFileName
      : `${rawFileName}.${extension}`;

    const mimeType = getMimeType(extension);

    const { name: baseName, ext } = parse(filename || "");

    const item = {
      buffer,
      filename,
      mimeType,
      caption: `📎 ${rawFileName}`,
      baseName,
      ext,
    };

    if (extension === "xlsx") {
      excelFiles.push(item);
    } else if (imageExtensions.includes(extension)) {
      photos.push(item);
    } else {
      docs.push(item);
    }
  }

  return {
    photos,
    docs,
    excelFiles,
  };
};

export default formatFilesToTelegram;
