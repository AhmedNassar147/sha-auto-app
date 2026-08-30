/*
 *
 * Helper: `generateFolderIfNotExisting`.
 *
 */
import { mkdir } from "fs/promises";
import checkPathExists from "./checkPathExists.mjs";

const generateFolderIfNotExisting = async (folderPath) => {
  const isDirectoryExists = await checkPathExists(folderPath);

  if (!isDirectoryExists) {
    await mkdir(folderPath, {
      recursive: true,
    });
  }
};

export default generateFolderIfNotExisting;
