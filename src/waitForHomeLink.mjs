/*
 *
 * Helper: `waitForHomeLink`.
 *
 */
const waitForHomeLink = async (page, timeout) =>
  await page.waitForFunction(
    () =>
      window.location.pathname.toLowerCase().includes("/dashboard/referral"),
    { timeout: timeout }
  );

export default waitForHomeLink;
