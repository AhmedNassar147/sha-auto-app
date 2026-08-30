/*
 *
 * Helper: `gotToLoginPage`.
 *
 */
import { APP_URL } from "./constants.mjs";
import createConsoleMessage from "./createConsoleMessage.mjs";

const LOGIN_TIMEOUT = 1.5 * 60 * 1000;

const gotToLoginPage = async (page) => {
  await page.goto(APP_URL, {
    waitUntil: "networkidle2",
    timeout: LOGIN_TIMEOUT,
  });

  await page.waitForNavigation({
    waitUntil: ["load", "networkidle2"],
    timeout: 28_000,
  });

  const currentUrl = page.url().toLowerCase();

  const hasAnotherNavigation =
    currentUrl.includes("account/login") || currentUrl.includes("signin");

  if (hasAnotherNavigation) {
    try {
      await page.waitForNavigation({
        waitUntil: ["load", "networkidle2"],
        timeout: 3_000,
      });
    } catch (error) {
      createConsoleMessage("error", error.message, "gotToLoginPage");
    }
  }
};

export default gotToLoginPage;
