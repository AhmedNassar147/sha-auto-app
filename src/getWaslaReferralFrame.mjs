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
 * still read as "about:blank" for a moment) AND its own SPA has finished
 * bootstrapping enough to have written its auth token to localStorage
 * (persist:auth - the same key getWaslaCasesFromAPI.mjs reads). A real URL
 * alone isn't enough: the iframe can be past about:blank while its React
 * app is still mounting, and a fetch fired in that gap fails with a bare
 * "Failed to fetch" (confirmed live - a failed fetch landed within ~1s of
 * this resolving). If the deadline passes without the token ever showing up,
 * still resolves with the frame rather than failing outright - some
 * accounts/flows may not need it - but logs a warning since callers won't
 * otherwise know auth wasn't confirmed.
 *
 * Call after openWaslaReferralWidget succeeds, or again after reloading
 * #contentIframe, to get a fresh frame reference to query/evaluate against.
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

  let navigatedFrame = null;

  while (Date.now() < deadline) {
    const iframeHandle = await page.$(WASLA_REFERRAL_CONTENT_IFRAME_SELECTOR);
    const frame = iframeHandle && (await iframeHandle.contentFrame());

    if (frame && frame.url() && frame.url() !== "about:blank") {
      navigatedFrame = frame;

      const hasAuthToken = await frame
        .evaluate(() => {
          try {
            const rawAuth = localStorage.getItem("persist:auth");
            const token = rawAuth ? JSON.parse(rawAuth)?.token : null;
            return !!token && token !== "null";
          } catch {
            return false;
          }
        })
        .catch(() => false);

      if (hasAuthToken) {
        createConsoleMessage(
          "success",
          `✅ Wasla widget frame ready.`,
          "getWaslaReferralFrame",
        );
        return { success: true, frame };
      }
    }

    await sleep(IFRAME_POLL_MS);
  }

  if (navigatedFrame) {
    createConsoleMessage(
      "warn",
      `⚠️ Wasla widget frame navigated but auth token was never confirmed in localStorage; proceeding anyway.`,
      "getWaslaReferralFrame",
    );
    return { success: true, frame: navigatedFrame };
  }

  createConsoleMessage(
    "error",
    `❌ Could not access Wasla widget iframe.`,
    "getWaslaReferralFrame",
  );
  return { success: false, message: "wasla iframe not accessible" };
};

export default getWaslaReferralFrame;
