/*
 *
 * Helper: `selectFirstLoginAccount`.
 *
 * After a successful Nafath login, seha.sa sometimes shows a role/facility
 * picker (html/session-page.html — class "login-role-picker" wrapping a
 * ul.group_menu_roles list of linked facilities/roles) when the account has
 * more than one linked session. Clicking the first entry selects it and
 * redirects to #/Dashboard. An account with only one linked facility likely
 * skips this screen entirely, so its absence isn't an error — callers should
 * treat `skipped: true` as "nothing to do here", not a failure.
 *
 */
import createConsoleMessage from "./createConsoleMessage.mjs";
import { HOME_PAGE_PATH_NAME } from "./constants.mjs";

const roleMenuSelector = ".group_menu_roles";
const firstRoleItemSelector = `${roleMenuSelector} > li:first-child`;
const dashboardPathName = HOME_PAGE_PATH_NAME.toLowerCase();

const APPEAR_TIMEOUT_MS = 5_000;
const DASHBOARD_REDIRECT_TIMEOUT_MS = 15_000;

/**
 * Clicks the first entry in the post-Nafath-login role/facility picker, if
 * it's showing, and waits for the resulting redirect to #/Dashboard.
 *
 * @param {import("puppeteer").Page} page
 * @returns {Promise<{
 *   success: boolean,
 *   skipped?: boolean,
 *   message?: string,
 * }>}
 */
const selectFirstLoginAccount = async (page) => {
  const roleMenu = await page
    .waitForSelector(roleMenuSelector, { timeout: APPEAR_TIMEOUT_MS })
    .catch(() => null);

  if (!roleMenu) {
    return { success: true, skipped: true, message: "role picker not shown" };
  }

  const firstItemClicked = await page.evaluate((selector) => {
    const item = document.querySelector(selector);
    if (!item) return false;

    const clickTarget = item.querySelector(".ant-menu-submenu-title") || item;
    clickTarget.click();

    return true;
  }, firstRoleItemSelector);

  if (!firstItemClicked) {
    createConsoleMessage(
      "error",
      `❌ Role picker appeared but no first item was found.`,
      "selectFirstLoginAccount",
    );
    return { success: false, message: "first role item not found" };
  }

  try {
    await page.waitForFunction(
      (pathName) => window.location.hash.toLowerCase().includes(pathName),
      { timeout: DASHBOARD_REDIRECT_TIMEOUT_MS },
      dashboardPathName,
    );
  } catch (error) {
    createConsoleMessage(
      "error",
      `❌ Did not redirect to dashboard after selecting account: ${error.message}`,
      "selectFirstLoginAccount",
    );
    return { success: false, message: "dashboard redirect did not happen" };
  }

  createConsoleMessage(
    "success",
    `✅ Selected first login account, redirected to dashboard.`,
    "selectFirstLoginAccount",
  );

  return { success: true };
};

export default selectFirstLoginAccount;
