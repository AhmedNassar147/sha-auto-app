/*
 *
 * Helper: `checkIfLoginPage`.
 *
 */
import { LOGIN_PAGE_PATH_NAME, nafathLoginLinkSelector } from "./constants.mjs";

const pathName = LOGIN_PAGE_PATH_NAME.toLowerCase();

const NAFATH_LINK_SETTLE_TIMEOUT_MS = 3_000;

/**
 * Checks whether the page is currently on seha.sa's login screen. True only
 * when both hold: the URL's hash matches the login route, and the Nafath
 * login link has actually rendered — the URL alone can already read as the
 * login route mid-navigation, before the page's content exists.
 *
 * The hash is read immediately rather than polled for: this is a "what's
 * the state right now" check, not a "wait for a navigation" one, and the
 * page has normally already settled into its landing state by the time this
 * runs (its one caller, makeUserLoggedInOrOpenHomePage, calls this right
 * after gotToLoginPage.mjs, which itself already waits up to 8s for either
 * the login link or the dashboard sidebar to render before returning).
 * Polling here for up to 7s for the hash to *become* login wasted that
 * entire timeout every time the page was actually already on the dashboard
 * - confirmed live (checkIfLoginPage alone accounted for ~7s of a ~10s
 * total login-check attempt). Only the content-settle wait below is still
 * a real, bounded "wait for a race" case, and only runs when the hash
 * already says login.
 *
 * @param {import("puppeteer").Page} page
 * @returns {Promise<boolean>}
 */
const checkIfLoginPage = async (page) => {
  const isLoginPageUrl = page.url().toLowerCase().includes(pathName);

  if (!isLoginPageUrl) return false;

  const nafathLink = await page
    .waitForSelector(nafathLoginLinkSelector, {
      timeout: NAFATH_LINK_SETTLE_TIMEOUT_MS,
    })
    .catch(() => null);

  return !!nafathLink;
};

export default checkIfLoginPage;
