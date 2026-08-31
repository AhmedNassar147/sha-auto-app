/*
 *
 * Helper: `checkIfLoginPage`.
 *
 */
import { LOGIN_PAGE_PATH_NAME, nafathLoginLinkSelector } from "./constants.mjs";

const pathName = LOGIN_PAGE_PATH_NAME.toLowerCase();

/**
 * Checks whether the page is currently on seha.sa's login screen. True only
 * when both hold: the URL's hash matches the login route, and the Nafath
 * login link has actually rendered — the URL alone can already read as the
 * login route mid-navigation, before the page's content exists.
 *
 * @param {import("puppeteer").Page} page
 * @returns {Promise<boolean>}
 */
const checkIfLoginPage = async (page) => {
  let isLoginPageUrl = false;

  try {
    await page.waitForFunction(
      (loginPagePathName) =>
        window.location.hash.toLowerCase().includes(loginPagePathName),
      { timeout: 10_000 },
      pathName,
    );

    isLoginPageUrl = true;
  } catch (error) {
    isLoginPageUrl = false;
  }

  if (!isLoginPageUrl) return false;

  const nafathLink = await page.$(nafathLoginLinkSelector);

  return !!nafathLink;
};

export default checkIfLoginPage;
