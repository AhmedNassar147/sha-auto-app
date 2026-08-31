/*
 *
 * Helper: `waitForHomeLink`.
 *
 */
import { HOME_PAGE_PATH_NAME } from "./constants.mjs";

const pathName = HOME_PAGE_PATH_NAME.toLowerCase();

const waitForHomeLink = async (page, timeout) => {
  try {
    await page.waitForFunction(
      (homePagePathName) =>
        window.location.hash.toLowerCase().includes(homePagePathName),
      { timeout: timeout },
      pathName,
    );

    return true;
  } catch (error) {
    return false;
  }
};

export default waitForHomeLink;
