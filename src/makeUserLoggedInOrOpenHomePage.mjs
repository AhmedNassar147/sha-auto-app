/*
 *
 * helper: `makeUserLoggedInOrOpenHomePage`.
 *
 */
import { createCursor } from "ghost-cursor";
import checkIfLoginPage from "./checkIfLoginPage.mjs";
import sleep from "./sleep.mjs";
import waitForHomeLink from "./waitForHomeLink.mjs";
import gotToLoginPage from "./gotToLoginPage.mjs";
import shouldCloseAppWhenLogin from "./shouldCloseAppWhenLogin.mjs";
import { homePageTableSelector } from "./constants.mjs";
import createConsoleMessage from "./createConsoleMessage.mjs";
import patchBundleFromPage from "./patchBundleFromPage.mjs";
import getIdProviderFromSession from "./getIdProviderFromSession.mjs";
import updateEnvFile from "./updateEnvFile.mjs";

const MAX_RETRIES = 3;
const loginButtonSelector = 'button[name="Input.Button"][value="login"]';

const checkHomePageFullyLoaded = async (page) => {
  try {
    await waitForHomeLink(page, 20_000);
    await page.waitForSelector(homePageTableSelector, {
      timeout: 20_000,
    });
    return true;
  } catch (err) {
    await page.screenshot({
      path: `screenshots/check-not-in-home-error-${Date.now()}.png`,
    });
    return false;
  }
};

const makeUserLoggedInOrOpenHomePage = async ({
  browser,
  cursor: _cursor,
  currentPage,
  startingPageUrl,
  noCursor,
  noBundleCheck,
}) => {
  const userName = process.env.CLIENT_NAME;
  const password = process.env.CLIENT_PASSWORD;

  let page = currentPage || (await browser.newPage());

  let cursor;

  if (!noCursor) {
    cursor =
      _cursor && currentPage
        ? _cursor
        : createCursor(
            page,
            { x: 180 + Math.random(), y: 250 + Math.random() * 20 },
            false,
          );
  }

  let retries = 0;

  while (retries <= MAX_RETRIES) {
    try {
      if ((!currentPage && !startingPageUrl) || retries > 0) {
        await gotToLoginPage(page);
      }

      let hasEnteredStartingPage = false;

      if (startingPageUrl && retries === 0) {
        await page.goto(startingPageUrl, {
          waitUntil: "networkidle2",
          timeout: 10_000,
        });

        const pageUrl = page.url();

        if (pageUrl.toLowerCase().includes(startingPageUrl.toLowerCase())) {
          await page.waitForSelector(homePageTableSelector, {
            timeout: 20_000,
          });

          hasEnteredStartingPage = true;
        }
      }

      if (!hasEnteredStartingPage) {
        const isLoginPage = await checkIfLoginPage(page);

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

          await page.focus("#Input_Username");
          await page.keyboard.type(userName, {
            delay: 100 + Math.random() * 20,
          });

          await page.focus("#Input_Password");
          await page.keyboard.type(password, {
            delay: 100 + Math.random() * 20,
          });

          await sleep(120 + Math.random() * 100);
          await page.click(loginButtonSelector);

          try {
            await page.waitForNavigation({
              waitUntil: ["load", "networkidle2"],
              timeout: 8_000,
            });
          } catch (error) {
            createConsoleMessage(
              "error",
              error.message,
              `🛑 AFTER SUBMITTING LOGIN ...`,
            );
          }
        }

        const currentPageUrl = page.url();

        const isStillInLoginPage = currentPageUrl
          .toLowerCase()
          .includes("/account/login");

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

      const isHomeLoaded =
        hasEnteredStartingPage || (await checkHomePageFullyLoaded(page));

      if (isHomeLoaded) {
        if (!noBundleCheck) {
          createConsoleMessage("info", `✅ User ${userName} is in home page.`);
          await patchBundleFromPage(page);
        }

        if (!process.env.ID_PROVIDER) {
          const idProvider = await getIdProviderFromSession(page);

          if (idProvider) {
            updateEnvFile({ ID_PROVIDER: idProvider });
            createConsoleMessage(
              "info",
              `✅ Cached ID_PROVIDER=${idProvider} from session.`,
            );
          }
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
