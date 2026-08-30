/*
 *
 * Helper: `unlinkAllFastGlob`.
 *
 */
import collectFolderFiles from "./collectFolderFiles.mjs";
import { unlink } from "fs/promises";

const unlinkAllFastGlob = async (folderPath) => {
  const files = await collectFolderFiles(folderPath);

  if (!files?.length) return false;

  await Promise.allSettled(files.map((file) => unlink(file)));
};

export default unlinkAllFastGlob;
