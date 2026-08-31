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
 */
import createConsoleMessage from "./createConsoleMessage.mjs";
import { nafathLoginLinkSelector, NAFATH_HOSTNAME } from "./constants.mjs";

const REDIRECT_SCREEN_TIMEOUT_MS = 20_000;
const SSO_REDIRECT_TIMEOUT_MS = 40_000;

/**
 * Clicks the Nafath login link and waits through the interstitial + the
 * server-side SAML redirect chain until the browser actually lands on
 * Nafath's SSO login page.
 *
 * @param {import("puppeteer").Page} page
 * @returns {Promise<{ success: boolean, message?: string }>}
 */
const openNafathLoginPortal = async (page) => {
  const nafathLink = await page.$(nafathLoginLinkSelector);

  if (!nafathLink) {
    createConsoleMessage(
      "error",
      `❌ Could not find the "نفاذ" login link.`,
      "openNafathLoginPortal",
    );
    return { success: false, message: "nafath login link not found" };
  }

  const nafathHref = await page.evaluate(
    (link) => link.getAttribute("href"),
    nafathLink,
  );

  if (!nafathHref) {
    createConsoleMessage(
      "error",
      `❌ Nafath login link has no href.`,
      "openNafathLoginPortal",
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
    createConsoleMessage(
      "error",
      `❌ seha.sa did not reach the Nafath redirect screen: ${error.message}`,
      "openNafathLoginPortal",
    );
    return { success: false, message: "redirect screen did not appear" };
  }

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
    createConsoleMessage(
      "error",
      `❌ Never redirected to Nafath SSO: ${error.message}`,
      "openNafathLoginPortal",
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
