/*
 *
 * helper: `makeUserLoggedInOrOpenHomePage`.
 *
 */
import { GhostCursor } from "ghost-cursor";
import checkIfLoginPage from "./checkIfLoginPage.mjs";
import sleep from "./sleep.mjs";
import gotToLoginPage from "./gotToLoginPage.mjs";
import shouldCloseAppWhenLogin from "./shouldCloseAppWhenLogin.mjs";
import { LOGIN_PAGE_PATH_NAME } from "./constants.mjs";
import createConsoleMessage from "./createConsoleMessage.mjs";
import checkIfInDashboardPage from "./checkIfInDashboardPage.mjs";
import openNafathLoginPortal from "./openNafathLoginPortal.mjs";
import loginWithNafathCredentials from "./loginWithNafathCredentials.mjs";

const MAX_RETRIES = 3;
const loginPathName = LOGIN_PAGE_PATH_NAME.toLowerCase();

/**
 * Ensures a page is logged into seha.sa and sitting on the dashboard,
 * driving the full Nafath SSO flow (openNafathLoginPortal ->
 * loginWithNafathCredentials) when the login page is showing. Retries the
 * whole attempt up to MAX_RETRIES times on any thrown error.
 *
 * @param {object} params
 * @param {import("puppeteer").Browser} params.browser - Used to open a new
 *   page when `currentPage` isn't supplied.
 * @param {import("ghost-cursor").GhostCursor} [params.cursor] - Reused when
 *   provided alongside `currentPage`; otherwise a new one is created unless
 *   `noCursor` is set.
 * @param {import("puppeteer").Page} [params.currentPage] - Reuse an existing
 *   page instead of opening a new one.
 * @param {string} [params.startingPageUrl] - Skip the login page entirely
 *   and go straight here on the first attempt (retries still go through
 *   gotToLoginPage). Only honored when `retries === 0`.
 * @param {boolean} [params.noCursor] - Skip creating a ghost-cursor.
 * @param {boolean} [params.noBundleCheck] - Suppress the "is in home page"
 *   success log.
 * @param {(message: string) => Promise<any>} [params.sendTelegramMessage] -
 *   Forwarded to loginWithNafathCredentials to report a Nafath
 *   verification code, if one shows up mid-login.
 * @returns {Promise<{
 *   newPage: import("puppeteer").Page,
 *   newCursor?: import("ghost-cursor").GhostCursor,
 *   isLoggedIn: boolean,
 *   isErrorAboutLockedOut?: boolean,
 *   isErrorAboutCannotBringToFront?: boolean,
 *   shouldCloseApp?: boolean,
 * }>}
 */
const makeUserLoggedInOrOpenHomePage = async ({
  browser,
  cursor: _cursor,
  currentPage,
  startingPageUrl,
  noCursor,
  noBundleCheck,
  sendTelegramMessage,
}) => {
  const userName = process.env.CLIENT_NAME;

  let page = currentPage || (await browser.newPage());

  let cursor;

  if (!noCursor) {
    cursor =
      _cursor && currentPage
        ? _cursor
        : new GhostCursor(page, {
            performRandomMoves: false,
            start: { x: 180 + Math.random(), y: 250 + Math.random() * 20 },
            visible: false,
          });
  }

  let retries = 0;

  while (retries <= MAX_RETRIES) {
    const tStart = Date.now();
    createConsoleMessage(
      "info",
      `attempt #${retries + 1} start, currentPage=${!!currentPage} startingPageUrl=${startingPageUrl} url=${page.url()}`,
      "makeUserLoggedInOrOpenHomePage",
    );

    try {
      if ((!currentPage && !startingPageUrl) || retries > 0) {
        const tGotoLogin0 = Date.now();
        await gotToLoginPage(page);
        createConsoleMessage(
          "info",
          `gotToLoginPage done in ${Date.now() - tGotoLogin0}ms, url=${page.url()}`,
          "makeUserLoggedInOrOpenHomePage",
        );
      }

      let hasEnteredStartingPage = false;

      if (startingPageUrl && retries === 0) {
        await page.goto(startingPageUrl, {
          waitUntil: "networkidle2",
          timeout: 10_000,
        });

        const pageUrl = page.url();

        if (pageUrl.toLowerCase().includes(startingPageUrl.toLowerCase())) {
          hasEnteredStartingPage = await checkIfInDashboardPage(page);
        }
      }

      if (!hasEnteredStartingPage) {
        const tCheckLoginPage0 = Date.now();
        const isLoginPage = await checkIfLoginPage(page);
        createConsoleMessage(
          "info",
          `checkIfLoginPage=${isLoginPage} in ${Date.now() - tCheckLoginPage0}ms`,
          "makeUserLoggedInOrOpenHomePage",
        );

        if (isLoginPage) {
          try {
            await page.bringToFront();
          } catch (err) {
            createConsoleMessage(
              "warn",
              err.message,
              "⚠️ bringToFront failed:",
            );

            return {
              newPage: page,
              newCursor: cursor,
              isLoggedIn: false,
              isErrorAboutLockedOut: false,
              isErrorAboutCannotBringToFront: true,
            };
          }

          const tNafathPortal0 = Date.now();
          const { success: reachedNafath, message: nafathPortalMessage } =
            await openNafathLoginPortal(page, sendTelegramMessage);
          createConsoleMessage(
            "info",
            `openNafathLoginPortal reachedNafath=${reachedNafath} in ${Date.now() - tNafathPortal0}ms`,
            "makeUserLoggedInOrOpenHomePage",
          );

          if (!reachedNafath) {
            createConsoleMessage(
              "error",
              nafathPortalMessage,
              "❌ openNafathLoginPortal failed",
            );
          } else {
            const tNafathLogin0 = Date.now();
            const {
              success: nafathLoginSucceeded,
              message: nafathLoginMessage,
              shouldCloseApp: shouldCloseAppFromNafath,
            } = await loginWithNafathCredentials(page, sendTelegramMessage);
            createConsoleMessage(
              "info",
              `loginWithNafathCredentials nafathLoginSucceeded=${nafathLoginSucceeded} in ${Date.now() - tNafathLogin0}ms`,
              "makeUserLoggedInOrOpenHomePage",
            );

            if (shouldCloseAppFromNafath) {
              return {
                newPage: page,
                newCursor: cursor,
                isLoggedIn: false,
                isErrorAboutLockedOut: false,
                shouldCloseApp: true,
              };
            }

            if (!nafathLoginSucceeded) {
              createConsoleMessage(
                "error",
                nafathLoginMessage,
                "❌ loginWithNafathCredentials failed",
              );
            }
          }
        }

        const isStillInLoginPage = page
          .url()
          .toLowerCase()
          .includes(loginPathName);

        if (isStillInLoginPage) {
          const { shouldCloseApp, isErrorAboutLockedOut } =
            await shouldCloseAppWhenLogin(page);

          if (isErrorAboutLockedOut) {
            return {
              newPage: page,
              newCursor: cursor,
              isLoggedIn: false,
              isErrorAboutLockedOut: true,
            };
          }

          if (shouldCloseApp) {
            return {
              newPage: page,
              newCursor: cursor,
              isLoggedIn: false,
              isErrorAboutLockedOut: false,
              shouldCloseApp: true,
            };
          }
        }
      }

      const tDashboardCheck0 = Date.now();
      const isHomeLoaded =
        hasEnteredStartingPage || (await checkIfInDashboardPage(page));
      createConsoleMessage(
        "info",
        `checkIfInDashboardPage isHomeLoaded=${isHomeLoaded} (hasEnteredStartingPage=${hasEnteredStartingPage}) in ${Date.now() - tDashboardCheck0}ms, attempt total ${Date.now() - tStart}ms`,
        "makeUserLoggedInOrOpenHomePage",
      );

      if (isHomeLoaded) {
        if (!noBundleCheck) {
          createConsoleMessage("info", `✅ User ${userName} is in home page.`);
        }

        return {
          newPage: page,
          newCursor: cursor,
          isLoggedIn: true,
        };
      }
    } catch (error) {
      createConsoleMessage(
        "error",
        error.message,
        `❌ Attempt #${retries + 1} failed`,
      );
    }

    retries++;
    await sleep(400 + retries * 220);
  }

  createConsoleMessage("error", `❌ Failed to login after max retries`);
  return {
    newPage: page,
    newCursor: cursor,
    isLoggedIn: false,
  };
};

export default makeUserLoggedInOrOpenHomePage;
