/*
 *
 * Helper: `waitForWaitingCountWithInterval`.
 *
 */
import makeUserLoggedInOrOpenHomePage from "./makeUserLoggedInOrOpenHomePage.mjs";
import processCollectingPatients from "./processCollectingPatients.mjs";
import createConsoleMessage from "./createConsoleMessage.mjs";
import getWaslaCasesFromAPI from "./getWaslaCasesFromAPI.mjs";
import getWaslaReferralFrame from "./getWaslaReferralFrame.mjs";
import openWaslaReferralWidget from "./openWaslaReferralWidget.mjs";
import speakText from "./speakText.mjs";
import createReloadAndCheckIfShouldCreateNewPage from "./createReloadAndCheckIfShouldCreateNewPage.mjs";
import closePageSafely from "./closePageSafely.mjs";
import handleLockedOutRetry from "./handleLockedOutRetry.mjs";
import sleep from "./sleep.mjs";
import checkReferralSelectedStatus from "./checkReferralSelectedStatus.mjs";
import getSehaSessionExpiry from "./getSehaSessionExpiry.mjs";
import {
  pauseController,
  pause,
  continueIfPaused,
} from "./PauseController.mjs";
import {
  PATIENT_SECTIONS_STATUS,
  TABS_COLLECTION_TYPES,
  WASLA_REFERRAL_CONTENT_IFRAME_SELECTOR,
} from "./constants.mjs";

const INTERVAL = 70_000;
const NOT_LOGGED_SLEEP_TIME = 15_000;
const LOCKED_OUT_SLEEP_TIME = 30 * 60_000;
const HOURLY_REFRESH_MS = 60 * 60_000;
const SESSION_EXPIRY_SAFETY_MARGIN_MS = 5 * 60_000;

const pausableSleep = async (ms) => {
  await pauseController.waitIfPaused();
  await sleep(ms);
};

const waitForWaitingCountWithInterval = async ({
  collectionTabType,
  browser,
  patientsStore,
  sendTelegramMessage,
}) => {
  const shouldTrackLoginTiming = process.env.TRACK_LOGIN_TIMMING === "1";

  let page, cursor;

  let apiHadData = false;
  let lastPageRefreshAt = Date.now();

  const { targetText, tab } = PATIENT_SECTIONS_STATUS[collectionTabType];

  const isPending = collectionTabType === TABS_COLLECTION_TYPES.PENDING;

  const _reloadAndCheckIfShouldCreateNewPage =
    createReloadAndCheckIfShouldCreateNewPage(
      pauseController,
      pausableSleep,
      INTERVAL,
    );

  // Every reload (whatever triggered it) resets the hourly-staleness timer
  // below, so the periodic refresh only ever fires after a genuinely idle
  // hour with no other reload already covering it.
  const reloadAndCheckIfShouldCreateNewPage = async (...args) => {
    lastPageRefreshAt = Date.now();
    return _reloadAndCheckIfShouldCreateNewPage(...args);
  };

  const requestBody = {
    pageSize: isPending ? 100 : 5,
    tab,
  };

  // if (!patientsStore.hasReloadListener()) {
  //   patientsStore.on("forceReloadHomePage", async () => {
  //     createConsoleMessage(`📢 Received forceReloadHomePage event`, "info");
  //     if (page) {
  //       try {
  //         await pauseController.waitIfPaused();
  //         await page.reload({ waitUntil: "domcontentloaded" });
  //         createConsoleMessage(`🔄 Page reloaded successfully from event.`);
  //       } catch (err) {
  //         createConsoleMessage(
  //           err,
  //           "error",
  //           `❌ Error during manual homepage reload:`,
  //         );
  //       }
  //     } else {
  //       createConsoleMessage(
  //         `⚠️ forceReloadHomePage event fired but page is null`,
  //         "warn",
  //       );
  //     }
  //   });
  // }

  while (true) {
    try {
      await pauseController.waitIfPaused();

      // 🔹 Login check
      const {
        newPage,
        newCursor,
        isLoggedIn,
        isErrorAboutLockedOut,
        shouldCloseApp,
        isErrorAboutCannotBringToFront,
      } = await makeUserLoggedInOrOpenHomePage({
        browser,
        cursor,
        currentPage: page,
        sendTelegramMessage,
      });

      page = newPage;
      cursor = newCursor;

      if (shouldCloseApp) {
        const message =
          "App is Closed, Please check the app, try to open it manually";

        await sendTelegramMessage(message);

        await speakText({
          text: "App is Closed, Please check the app, try to open it manually",
          useMaleVoice: true,
          volume: 100,
          times: 10,
        });
        await browser.close();
        process.kill(process.pid);
        break;
      }

      if (isErrorAboutLockedOut) {
        await handleLockedOutRetry({
          patientsStore,
          lockSleepTime: LOCKED_OUT_SLEEP_TIME,
          page,
          pausableSleep,
          sendTelegramMessage,
        });

        page = null;
        cursor = null;
        continue;
      }

      if (!isLoggedIn && isErrorAboutCannotBringToFront) {
        const message =
          "Cannot bring app to front — please check if another window is blocking it";

        await sendTelegramMessage(message);
        await speakText({
          text: message,
          useMaleVoice: true,
          volume: 100,
          times: 8,
        });
        await pausableSleep(Math.floor(NOT_LOGGED_SLEEP_TIME / 2));
        continue;
      }

      if (!isLoggedIn) {
        createConsoleMessage("info", `isLoggedIn ${isLoggedIn}`);
        await pausableSleep(NOT_LOGGED_SLEEP_TIME);
        continue;
      }

      const isWidgetOpen = await page.$(WASLA_REFERRAL_CONTENT_IFRAME_SELECTOR);

      if (shouldTrackLoginTiming) {
        createConsoleMessage("info", `isWidgetOpen ${isWidgetOpen}`);
      }

      if (!isWidgetOpen) {
        const { success: widgetOpened, message: widgetMessage } =
          await openWaslaReferralWidget({ page, cursor });

        if (shouldTrackLoginTiming) {
          createConsoleMessage(
            "info",
            `widgetOpened ${widgetOpened} widgetMessage ${widgetMessage}`,
          );
        }

        if (!widgetOpened || widgetMessage) {
          createConsoleMessage(
            "error",
            widgetMessage,
            "❌ openWaslaReferralWidget failed",
          );
          await pausableSleep(NOT_LOGGED_SLEEP_TIME);
          continue;
        }
      }

      const {
        success: frameReady,
        frame,
        message: frameMessage,
      } = await getWaslaReferralFrame(page);

      if (!frameReady) {
        createConsoleMessage(
          "error",
          frameMessage,
          "❌ getWaslaReferralFrame failed",
        );
        await pausableSleep(NOT_LOGGED_SLEEP_TIME);
        continue;
      }

      createConsoleMessage("info", `🌀 Fetching ${targetText} collection ...`);
      const { patients, message, success, totalRowsCount, needsLogin } =
        await getWaslaCasesFromAPI(frame, requestBody);

      if (!success || message) {
        if (needsLogin) {
          createConsoleMessage(
            "warn",
            `success=${success} message=${message}`,
            "🔑 needsLogin — forcing a fresh login next iteration",
          );
          await closePageSafely(page);
          page = null;
          cursor = null;
        }

        const shouldCreateNewPage = await reloadAndCheckIfShouldCreateNewPage(
          page,
          `success=${success} message=${message}`,
          0,
        );
        if (shouldCreateNewPage) {
          page = null;
          cursor = null;
        }
        continue;
      }

      const nonClaimableCasesSize = patientsStore.getNonClaimableCasesSize();

      if (nonClaimableCasesSize && page) {
        createConsoleMessage(
          "info",
          `⏳ There are (${nonClaimableCasesSize}) cases that need to be checked`,
        );
        const haveCasesCheckedAndNeedsUpdate =
          await checkReferralSelectedStatus(
            frame,
            patientsStore,
            sendTelegramMessage,
          );

        if (haveCasesCheckedAndNeedsUpdate) {
          const shouldCreateNewPage = await reloadAndCheckIfShouldCreateNewPage(
            page,
            "accepted cases checked and needs update,",
            1000,
          );

          if (shouldCreateNewPage) {
            page = null;
            cursor = null;
          }

          continue;
        }

        const waitTime = 1500 + Math.random() * 3000;
        createConsoleMessage(
          "info",
          `📋 sleep for ${waitTime / 1000}s after checking accepted case status ...`,
        );
        await pausableSleep(waitTime);
      }

      const patientsLength = totalRowsCount;

      if (!patientsLength) {
        createConsoleMessage(
          "warn",
          `⏳ No patients found in API response, exiting...`,
        );

        if (apiHadData && patientsStore.size()) {
          apiHadData = false;
          await patientsStore.clear();
          createConsoleMessage("info", `✅ Patient store with files cleared`);
          const shouldCreateNewPage = await reloadAndCheckIfShouldCreateNewPage(
            page,
            "🛑 cleared patients store and files",
            0,
          );

          if (shouldCreateNewPage) {
            page = null;
            cursor = null;
          }
          continue;
        }

        // Nothing to collect and no other reload already fired this hour -
        // the page can otherwise sit open indefinitely with a stale session
        // that we won't notice until an API call starts failing. Only
        // reload here, on the genuinely idle path, never while patients are
        // actually being collected/processed above.
        //
        // seha.sa's own JWTUserToken (localStorage on this page, see
        // getSehaSessionExpiry.mjs) carries a real exp claim, so when it's
        // readable we refresh a few minutes ahead of that exact deadline
        // instead of guessing - but the token expiring isn't the only way
        // the session can go stale server-side, and the token can also be
        // missing/unparseable, so the hourly timer still applies as an
        // upper bound either way: whichever deadline is sooner wins.
        const sessionExpiresAtMs = await getSehaSessionExpiry(page);
        const hourlyDeadline = lastPageRefreshAt + HOURLY_REFRESH_MS;
        const expiryDeadline =
          sessionExpiresAtMs != null
            ? sessionExpiresAtMs - SESSION_EXPIRY_SAFETY_MARGIN_MS
            : Infinity;
        const nextRefreshDeadline = Math.min(hourlyDeadline, expiryDeadline);

        if (Date.now() >= nextRefreshDeadline) {
          const reason =
            expiryDeadline < hourlyDeadline
              ? "🔄 session token nearing expiry"
              : "🔄 hourly refresh";
          createConsoleMessage(
            "info",
            `${reason}: no patients to collect, refreshing page to avoid a stale session`,
          );
          const shouldCreateNewPage = await reloadAndCheckIfShouldCreateNewPage(
            page,
            reason,
            0,
          );

          if (shouldCreateNewPage) {
            page = null;
            cursor = null;
          }
          continue;
        }

        const waitingMs = INTERVAL + Math.random() * 5000;
        createConsoleMessage(
          "info",
          `📋 sleep for ${waitingMs / 1000} s before next search ...`,
        );
        await pausableSleep(waitingMs);
        continue;
      }

      createConsoleMessage(
        "info",
        `📋 Found ${patientsLength} patients from API to process`,
      );

      apiHadData = true;

      const newPatientAdded = await processCollectingPatients({
        browser,
        page,
        frame,
        patientsStore,
        patients,
      });

      const patientsInStore = patientsStore.getAllPatients();
      const patientsIds = patients.map(({ referralId }) => String(referralId));

      let hasPatientsRemoved = false;

      if (patientsInStore.length) {
        const storePatientsNotInTheApi = patientsInStore.filter(
          ({ referralId }) => !patientsIds.includes(referralId),
        );

        if (storePatientsNotInTheApi?.length) {
          try {
            createConsoleMessage(
              "info",
              `🛑 removing unsynced patients from store`,
            );
            await Promise.allSettled(
              storePatientsNotInTheApi.map(({ referralId }) =>
                patientsStore.removePatientByReferralId(referralId),
              ),
            );
            hasPatientsRemoved = true;
          } catch (error) {
            createConsoleMessage(
              "error",
              error,
              `🛑 Failed removing unsynced patients from store`,
            );
          }
        }
      }

      if (newPatientAdded || hasPatientsRemoved) {
        const shouldCreateNewPage = await reloadAndCheckIfShouldCreateNewPage(
          page,
          "showing patients",
          2000,
        );
        if (shouldCreateNewPage) {
          page = null;
          cursor = null;
        }
      } else {
        const waitingMs = INTERVAL + Math.random() * 5000;
        createConsoleMessage(
          "info",
          `📋 sleep for ${waitingMs / 1000} s before next search ...`,
        );
        await pausableSleep(waitingMs);
      }
    } catch (err) {
      createConsoleMessage("error", err, `🛑 Unexpected error during loop:`);
      await pausableSleep(INTERVAL + Math.random() * 3000);
    }
  }
};

export default waitForWaitingCountWithInterval;
export {
  pause as pauseFetchingPatients,
  continueIfPaused as continueFetchingPatientsIfPaused,
};
