/*
 *
 * Helper: `openSehaDashboardByProperAccount`.
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
 * The submenu title click is a toggle, and the submenu has been observed
 * live both already-open (aria-expanded="true") and closed
 * (aria-expanded="false") at the moment this runs — clicking an
 * already-open one collapses it instead, hiding the very role items being
 * waited for next and failing the whole flow (captured live in
 * results/errors/select-seha-account-failed-*). So the title is only
 * clicked when aria-expanded is "false"; an already-open submenu is left
 * alone.
 *
 * Which entries to click at each level is configurable via the
 * SEHA_ACCOUNT_PICKER_ORDER env var — a comma-separated pair of
 * 1-based indexes, e.g. "1,2" picks the 1st facility then the 2nd role
 * inside it. Unset/invalid/missing values fall back to 1 (the first item)
 * at that level, preserving the original always-pick-first behavior.
 *
 */
import createConsoleMessage from "./createConsoleMessage.mjs";
import { HOME_PAGE_PATH_NAME } from "./constants.mjs";
import captureFailureArtifacts from "./captureFailureArtifacts.mjs";

const roleMenuSelector = ".group_menu_roles";
const dashboardPathName = HOME_PAGE_PATH_NAME.toLowerCase();

const APPEAR_TIMEOUT_MS = 10_000;
const NESTED_ITEM_TIMEOUT_MS = 5_000;
const DASHBOARD_REDIRECT_TIMEOUT_MS = 30_000;

/**
 * Parses SEHA_ACCOUNT_PICKER_ORDER (e.g. "1,2") into 0-based
 * [facilityIndex, roleIndex] indexes. Each value falls back to 0 (first
 * item) individually if missing, non-numeric, or less than 1.
 *
 * @returns {[number, number]}
 */
const getConfiguredItemIndexes = () => {
  const rawOrder = process.env.SEHA_ACCOUNT_PICKER_ORDER || "";

  const [facilityOneBased, roleOneBased] = rawOrder
    .split(",")
    .map((part) => Number(part.trim()));

  const toZeroBasedOrDefault = (oneBased) =>
    Number.isInteger(oneBased) && oneBased > 0 ? oneBased - 1 : 0;

  return [
    toZeroBasedOrDefault(facilityOneBased),
    toZeroBasedOrDefault(roleOneBased),
  ];
};

/**
 * Clicks the configured entry in the post-Nafath-login role/facility
 * picker, if it's showing (descending into a nested submenu first if that
 * entry is a facility with multiple roles), and waits for the resulting
 * redirect to #/Dashboard.
 *
 * @param {import("puppeteer").Page} page
 * @returns {Promise<{
 *   success: boolean,
 *   skipped?: boolean,
 *   message?: string,
 * }>}
 */
const openSehaDashboardByProperAccount = async (page) => {
  const roleMenu = await page
    .waitForSelector(roleMenuSelector, { timeout: APPEAR_TIMEOUT_MS })
    .catch(() => null);

  if (!roleMenu) {
    return { success: true, skipped: true, message: "role picker not shown" };
  }

  const [facilityIndex, roleIndex] = getConfiguredItemIndexes();
  const facilityItemSelector = `${roleMenuSelector} > li:nth-child(${facilityIndex + 1})`;

  const facilityItemKind = await page.evaluate((selector) => {
    const item = document.querySelector(selector);
    if (!item) return null;

    if (item.classList.contains("ant-menu-submenu")) {
      const title = item.querySelector(".ant-menu-submenu-title");
      // Toggle - only click if it isn't already expanded, or clicking
      // would collapse it instead.
      if (title?.getAttribute("aria-expanded") !== "true") {
        title?.click();
      }
      return "submenu";
    }

    item.click();
    return "leaf";
  }, facilityItemSelector);

  if (!facilityItemKind) {
    createConsoleMessage(
      "error",
      `❌ Role picker appeared but facility item #${facilityIndex + 1} (SEHA_ACCOUNT_PICKER_ORDER) was not found.`,
      "openSehaDashboardByProperAccount",
    );
    await captureFailureArtifacts(page, "select-seha-facility-not-found");
    return { success: false, message: "configured facility item not found" };
  }

  if (facilityItemKind === "submenu") {
    const nestedItemHandle = await page
      .waitForFunction(
        (containerSelector, index) => {
          const items = document
            .querySelector(containerSelector)
            ?.querySelectorAll("ul.ant-menu-sub li.ant-menu-item");
          return items?.[index] || items?.[0] || null;
        },
        { timeout: NESTED_ITEM_TIMEOUT_MS },
        facilityItemSelector,
        roleIndex,
      )
      .catch(() => null);

    if (!nestedItemHandle) {
      createConsoleMessage(
        "error",
        `❌ Facility submenu opened but no role item was found inside it.`,
        "openSehaDashboardByProperAccount",
      );
      await captureFailureArtifacts(page, "select-seha-account-failed");
      return { success: false, message: "configured nested role item not found" };
    }

    try {
      await nestedItemHandle.asElement()?.click();
    } catch (error) {
      createConsoleMessage(
        "error",
        `❌ Failed to click role item #${roleIndex + 1}: ${error.message}`,
        "openSehaDashboardByProperAccount",
      );
      await captureFailureArtifacts(page, "select-seha-role-click-failed");
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
      "openSehaDashboardByProperAccount",
    );
    await captureFailureArtifacts(page, "select-seha-dashboard-redirect-failed");
    return { success: false, message: "dashboard redirect did not happen" };
  }

  createConsoleMessage(
    "success",
    `✅ Selected login account (facility #${facilityIndex + 1}, role #${roleIndex + 1}), redirected to dashboard.`,
    "openSehaDashboardByProperAccount",
  );

  return { success: true };
};

export default openSehaDashboardByProperAccount;
