/*
 *
 * Helper: `selectFirstLoginAccount`.
 *
 * After a successful Nafath login, seha.sa sometimes shows a role/facility
 * picker (html/session-page.html — class "login-role-picker" wrapping a
 * ul.group_menu_roles list of linked facilities/roles) when the account has
 * more than one linked session. An account with only one linked facility
 * likely skips this screen entirely, so its absence isn't an error —
 * callers should treat `skipped: true` as "nothing to do here", not a
 * failure.
 *
 * The top-level list holds one entry per facility. A facility with more
 * than one role renders as an AntD submenu (li.ant-menu-submenu) — clicking
 * its title only expands it, revealing a nested ul.ant-menu-sub with the
 * actual selectable li.ant-menu-item role entries inside (confirmed live:
 * a facility rendered a single submenu titled with the hospital's name,
 * containing 5 role items). A facility with a single role renders as a
 * plain li.ant-menu-item directly at the top level instead, with no
 * submenu to expand — this function handles both shapes.
 *
 */
import createConsoleMessage from "./createConsoleMessage.mjs";
import { HOME_PAGE_PATH_NAME } from "./constants.mjs";

const roleMenuSelector = ".group_menu_roles";
const firstRoleItemSelector = `${roleMenuSelector} > li:first-child`;
const dashboardPathName = HOME_PAGE_PATH_NAME.toLowerCase();

const APPEAR_TIMEOUT_MS = 10_000;
const NESTED_ITEM_TIMEOUT_MS = 5_000;
const DASHBOARD_REDIRECT_TIMEOUT_MS = 30_000;

/**
 * Clicks the first entry in the post-Nafath-login role/facility picker, if
 * it's showing (descending into a nested submenu first if the first entry
 * is a facility with multiple roles), and waits for the resulting redirect
 * to #/Dashboard.
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

  const firstItemKind = await page.evaluate((selector) => {
    const item = document.querySelector(selector);
    if (!item) return null;

    if (item.classList.contains("ant-menu-submenu")) {
      item.querySelector(".ant-menu-submenu-title")?.click();
      return "submenu";
    }

    item.click();
    return "leaf";
  }, firstRoleItemSelector);

  if (!firstItemKind) {
    createConsoleMessage(
      "error",
      `❌ Role picker appeared but no first item was found.`,
      "selectFirstLoginAccount",
    );
    return { success: false, message: "first role item not found" };
  }

  if (firstItemKind === "submenu") {
    const nestedItemHandle = await page
      .waitForFunction(
        (containerSelector) =>
          document
            .querySelector(containerSelector)
            ?.querySelector("ul.ant-menu-sub li.ant-menu-item") || null,
        { timeout: NESTED_ITEM_TIMEOUT_MS },
        firstRoleItemSelector,
      )
      .catch(() => null);

    if (!nestedItemHandle) {
      createConsoleMessage(
        "error",
        `❌ Facility submenu opened but no role item was found inside it.`,
        "selectFirstLoginAccount",
      );
      return { success: false, message: "first nested role item not found" };
    }

    try {
      await nestedItemHandle.asElement()?.click();
    } catch (error) {
      createConsoleMessage(
        "error",
        `❌ Failed to click first role item: ${error.message}`,
        "selectFirstLoginAccount",
      );
      return { success: false, message: "failed to click nested role item" };
    }
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
