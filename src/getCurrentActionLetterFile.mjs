/*
 *
 * helper: `getCurrentActionLetterFile`.
 *
 */
import { readFile } from "node:fs/promises";
import { join } from "path";
import {
  generatedPdfsPathForAcceptance,
  generatedPdfsPathForRejection,
  USER_ACTION_TYPES,
} from "./constants.mjs";

const getCurrentActionLetterFile = async (
  referralId,
  actionType,
  returnBuffer,
) => {
  const isAcceptanceAction = actionType === USER_ACTION_TYPES.ACCEPT;

  const folderPath = isAcceptanceAction
    ? generatedPdfsPathForAcceptance
    : generatedPdfsPathForRejection;

  const fileName = `${actionType}-${referralId}.pdf`;

  const filePath = join(folderPath, fileName);
  const buf = await readFile(filePath);

  return {
    fileName,
    fileData: returnBuffer ? buf : buf.toString("base64"),
    filePath,
  };
};

export default getCurrentActionLetterFile;
