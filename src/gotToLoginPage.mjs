/*
 *
 * Helper: `gotToLoginPage`.
 *
 */
import {
  LOGIN_PAGE_PATH_NAME,
  LOGIN_PAGE_URL,
  nafathLoginLinkSelector,
  sidebarMenuItemSelector,
} from "./constants.mjs";

const LOGIN_TIMEOUT = 1.5 * 60 * 1000;
const SETTLE_TIMEOUT_MS = 8_000;
const pathName = LOGIN_PAGE_PATH_NAME.toLowerCase();

/**
 * Navigates to seha.sa's login URL and reports whether we're actually
 * looking at the login page afterward. seha.sa client-side redirects an
 * already authenticated session straight to the dashboard right after this
 * URL loads, so ending up elsewhere is expected, not an error — callers
 * decide what that means. Waits for either landing state to actually render
 * (the Nafath link, or the dashboard sidebar) before reading the URL, since
 * `networkidle2` alone can resolve just before that redirect lands, which
 * would otherwise race a same-instant `page.url()` read.
 *
 * @param {import("puppeteer").Page} page
 * @returns {Promise<boolean>} Whether the page's URL is the login route.
 */
const gotToLoginPage = async (page) => {
  await page.goto(LOGIN_PAGE_URL, {
    waitUntil: "networkidle2",
    timeout: LOGIN_TIMEOUT,
  });

  await page
    .waitForFunction(
      (loginSelector, dashboardSelector) =>
        !!document.querySelector(loginSelector) ||
        !!document.querySelector(dashboardSelector),
      { timeout: SETTLE_TIMEOUT_MS },
      nafathLoginLinkSelector,
      sidebarMenuItemSelector,
    )
    .catch(() => {});

  const currentUrl = page.url().toLowerCase();

  return currentUrl.includes(pathName);
};

export default gotToLoginPage;
