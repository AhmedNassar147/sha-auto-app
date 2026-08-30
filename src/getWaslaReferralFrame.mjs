/*
 *
 * Helper: `getWaslaReferralFrame`.
 *
 */
import createConsoleMessage from "./createConsoleMessage.mjs";
import sleep from "./sleep.mjs";
import {
  WASLA_REFERRAL_CONTENT_IFRAME_SELECTOR,
  WASLA_REFERRAL_IFRAME_TIMEOUT_MS,
} from "./constants.mjs";

const IFRAME_POLL_MS = 300;

/**
 * Resolves the Puppeteer Frame for the Wasla widget's iframe, polling until
 * it has actually navigated (its src is set on render, but the frame can
 * still read as "about:blank" for a moment). Call after
 * openWaslaReferralWidget succeeds, or again after reloading #contentIframe,
 * to get a fresh frame reference to query/evaluate against.
 *
 * @param {import("puppeteer").Page} page
 * @returns {Promise<{ success: boolean, frame?: import("puppeteer").Frame, message?: string }>}
 */
const getWaslaReferralFrame = async (page) => {
  const deadline = Date.now() + WASLA_REFERRAL_IFRAME_TIMEOUT_MS;

  try {
    await page.waitForSelector(WASLA_REFERRAL_CONTENT_IFRAME_SELECTOR, {
      timeout: WASLA_REFERRAL_IFRAME_TIMEOUT_MS,
    });
  } catch (error) {
    createConsoleMessage(
      "error",
      `❌ Wasla widget iframe did not appear: ${error.message}`,
      "getWaslaReferralFrame",
    );
    return { success: false, message: "wasla iframe did not appear" };
  }

  while (Date.now() < deadline) {
    const iframeHandle = await page.$(WASLA_REFERRAL_CONTENT_IFRAME_SELECTOR);
    const frame = iframeHandle && (await iframeHandle.contentFrame());

    if (frame && frame.url() && frame.url() !== "about:blank") {
      createConsoleMessage(
        "success",
        `✅ Wasla widget frame ready.`,
        "getWaslaReferralFrame",
      );
      return { success: true, frame };
    }

    await sleep(IFRAME_POLL_MS);
  }

  createConsoleMessage(
    "error",
    `❌ Could not access Wasla widget iframe.`,
    "getWaslaReferralFrame",
  );
  return { success: false, message: "wasla iframe not accessible" };
};

export default getWaslaReferralFrame;
