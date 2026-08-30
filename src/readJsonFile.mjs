/*
 *
 * Helper: `readJsonFile`.
 *
 */
import { readFile } from "fs/promises";
import checkPathExists from "./checkPathExists.mjs";

/**
 * Reads a JSON file if it exists.
 * @param {string} jsonFilePath - Path to the JSON file.
 * @param {boolean} [parse=true] - Whether to parse the JSON content.
 * @returns {Promise<object|string|undefined>} Parsed JSON, raw string, or undefined if file doesn't exist.
 */
const readJsonFile = async (jsonFilePath, parse = true) => {
  if (!(await checkPathExists(jsonFilePath))) {
    return undefined;
  }

  const content = await readFile(jsonFilePath, { encoding: "utf8" });
  return parse && !!content ? JSON.parse(content) : content;
};

export default readJsonFile;
