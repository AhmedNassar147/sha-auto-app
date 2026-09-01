/*
 *
 * Helper: `openNafathLoginPortal`.
 *
 * seha.sa's login page (#/account/login) offers Nafath SSO as the only
 * visible sign-in method — no username/password fields exist there. Clicking
 * "الدخول عبر نفاذ" (href="#/iamredirection/3") lands on an in-app
 * interstitial ("جاري تحويلكم الآن إلى بوابة النفاذ الوطني الموحد ...")
 * which, after a short delay, triggers a real (non-SPA) navigation through a
 * server-side redirect chain (Login -> index -> SignIn -> samlsso) that ends
 * on Nafath's own SSO login page at www.iam.gov.sa/sso.
 *
 * Every failure path captures a screenshot + the page HTML into
 * results/errors (captureFailureArtifacts) and, when sendTelegramMessage is
 * given, notifies the operator over Telegram and out loud (speakText) —
 * these failures block the whole login pipeline, so they need a human's
 * attention promptly rather than sitting silent in the console.
 *
 */
import createConsoleMessage from "./createConsoleMessage.mjs";
import { nafathLoginLinkSelector, NAFATH_HOSTNAME } from "./constants.mjs";
import captureFailureArtifacts from "./captureFailureArtifacts.mjs";
import speakText from "./speakText.mjs";

const REDIRECT_SCREEN_TIMEOUT_MS = 20_000;
const SSO_REDIRECT_TIMEOUT_MS = 40_000;

// html/page-after-login-with-nafath-button.html: the interstitial has its
// own countdown ("... خلال 1 ثواني") that auto-redirects via JS, plus this
// manual link as a fallback for when that doesn't fire. It has no href
// (a React onClick, not a real anchor) - clicking it immediately rather
// than waiting out the timer saves time in an app where every second of
// the acceptance window matters, and gives us an active step instead of
// depending on a timer we don't control.
const manualRedirectLinkSelector = ".iam-redirct a.btn.btn-primary";

/**
 * Logs a failure, captures a screenshot + page HTML for later
 * investigation, and — when sendTelegramMessage is given — notifies the
 * operator over Telegram and out loud, since these failures block the
 * whole login pipeline until someone intervenes.
 *
 * @param {import("puppeteer").Page} page
 * @param {(message: string) => Promise<any>} [sendTelegramMessage]
 * @param {string} label - Short slug for the captured artifact file names.
 * @param {string} consoleMessage
 * @returns {Promise<void>}
 */
const reportFailure = async (page, sendTelegramMessage, label, consoleMessage) => {
  createConsoleMessage("error", consoleMessage, "openNafathLoginPortal");

  await Promise.allSettled([
    captureFailureArtifacts(page, label),
    sendTelegramMessage?.(`⚠️ *openNafathLoginPortal failed:* ${consoleMessage}`),
    speakText({
      text: "Nafath login portal failed, please check the app",
      useMaleVoice: true,
      volume: 100,
      times: 5,
      delayMs: 3_000,
    }),
  ]);
};

/**
 * Clicks the Nafath login link and waits through the interstitial + the
 * server-side SAML redirect chain until the browser actually lands on
 * Nafath's SSO login page.
 *
 * @param {import("puppeteer").Page} page
 * @param {(message: string) => Promise<any>} [sendTelegramMessage]
 * @returns {Promise<{ success: boolean, message?: string }>}
 */
const openNafathLoginPortal = async (page, sendTelegramMessage) => {
  const nafathLink = await page.$(nafathLoginLinkSelector);

  if (!nafathLink) {
    await reportFailure(
      page,
      sendTelegramMessage,
      "nafath-login-link-not-found",
      `❌ Could not find the "نفاذ" login link.`,
    );
    return { success: false, message: "nafath login link not found" };
  }

  const nafathHref = await page.evaluate(
    (link) => link.getAttribute("href"),
    nafathLink,
  );

  if (!nafathHref) {
    await reportFailure(
      page,
      sendTelegramMessage,
      "nafath-login-link-no-href",
      `❌ Nafath login link has no href.`,
    );
    return { success: false, message: "nafath login link has no href" };
  }

  await nafathLink.click();

  try {
    await page.waitForFunction(
      (href) => location.hash === href,
      { timeout: REDIRECT_SCREEN_TIMEOUT_MS },
      nafathHref,
    );
  } catch (error) {
    await reportFailure(
      page,
      sendTelegramMessage,
      "nafath-redirect-screen-not-found",
      `❌ seha.sa did not reach the Nafath redirect screen: ${error.message}`,
    );
    return { success: false, message: "redirect screen did not appear" };
  }

  // Best-effort: don't fail the flow if it's missing or the page has
  // already moved on by the time we look for it - the auto-redirect timer
  // is still there as a fallback either way.
  await page
    .evaluate((selector) => {
      document.querySelector(selector)?.click();
    }, manualRedirectLinkSelector)
    .catch(() => {});

  // waitForFunction survives the frame's execution context being torn down
  // mid-poll by the actual cross-origin navigation below — a manual
  // evaluate()-based poll would throw "Execution context was destroyed".
  try {
    await page.waitForFunction(
      (hostname) => location.hostname.includes(hostname),
      { timeout: SSO_REDIRECT_TIMEOUT_MS },
      NAFATH_HOSTNAME,
    );
  } catch (error) {
    await reportFailure(
      page,
      sendTelegramMessage,
      "nafath-sso-not-reached",
      `❌ Never redirected to Nafath SSO: ${error.message}`,
    );
    return { success: false, message: "did not reach iam.gov.sa" };
  }

  await page
    .waitForNetworkIdle({ idleTime: 500, timeout: 5_000 })
    .catch(() => {});

  createConsoleMessage(
    "success",
    `✅ Reached Nafath SSO login page (${page.url()}).`,
    "openNafathLoginPortal",
  );

  return { success: true };
};

export default openNafathLoginPortal;
