/*
 *
 * Helper: `checkIfInDashboardPage`.
 *
 */
import { sidebarMenuItemSelector } from "./constants.mjs";
import waitForHomeLink from "./waitForHomeLink.mjs";

/**
 * seha.sa is hash-routed (e.g. https://seha.sa/#/Dashboard), so
 * `location.pathname` alone stays constant regardless of the visible page —
 * checking the full URL (via page.url(), same as gotToLoginPage.mjs /
 * makeUserLoggedInOrOpenHomePage.mjs's "/account/login" checks) is what
 * actually reflects the route. Paired with the sidebar selector so a URL
 * that merely looks right mid-navigation isn't mistaken for a loaded page.
 *
 * @param {import("puppeteer").Page} page
 * @returns {Promise<boolean>}
 */
const checkIfInDashboardPage = async (page) => {
  const isDashboardUrl = await waitForHomeLink(page, 10_000);

  if (!isDashboardUrl) return false;

  const sidebarMenuItem = await page.$(sidebarMenuItemSelector);

  return !!sidebarMenuItem;
};

export default checkIfInDashboardPage;
