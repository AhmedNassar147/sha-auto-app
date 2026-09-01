/*
 *
 * Helper: `captureFailureArtifacts`.
 *
 */
import { writeFile } from "fs/promises";
import createConsoleMessage from "./createConsoleMessage.mjs";
import { errorsFolderDirectory } from "./constants.mjs";

/**
 * Best-effort: saves a screenshot and the current page HTML to
 * results/errors so a failure (a selector that never appeared, a step that
 * timed out, etc.) can be investigated later without having to reproduce
 * it live. Never throws — a failure here shouldn't compound the original
 * one it's trying to capture.
 *
 * @param {import("puppeteer").Page} page
 * @param {string} label - Short slug identifying what failed, e.g.
 *   "national-id-input-not-found". Used as the saved file name prefix.
 * @returns {Promise<void>}
 */
const captureFailureArtifacts = async (page, label) => {
  const baseName = `${label}-${Date.now()}`;

  const results = await Promise.allSettled([
    page.screenshot({
      path: `${errorsFolderDirectory}/${baseName}.png`,
      fullPage: true,
    }),
    page
      .content()
      .then((html) =>
        writeFile(`${errorsFolderDirectory}/${baseName}.html`, html, "utf8"),
      ),
  ]);

  const failures = results.filter((result) => result.status === "rejected");

  if (failures.length) {
    createConsoleMessage(
      "warn",
      failures.map((result) => result.reason?.message || result.reason).join(", "),
      `⚠️ captureFailureArtifacts partially failed for "${label}"`,
    );
  }
};

export default captureFailureArtifacts;
