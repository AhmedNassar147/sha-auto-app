// One-off utility: estimates how far this machine's clock is ahead of (or
// behind) Wasla's server clock, to sanity-check whether a direct-API accept
// could safely fire off local clock math alone (see handleSubmitReferral.mjs)
// instead of waiting on the page's own 1s-granularity button/badge state.
//
// Repeatedly calls the widget's own lightweight `facility/tabs` list endpoint
// (same one getWaslaCasesFromAPI.mjs uses for the main poll loop, pageSize:1
// to keep each response tiny) purely to read its `Date` response header -
// the body is never even read. For each sample this records:
//   - rttMs: how long the round trip took (lower = more trustworthy sample,
//     since less of that time could've passed between the server stamping
//     its Date header and us receiving the response)
//   - diffMs: localAfter - serverNow (positive = this machine's clock reads
//     ahead of the server's)
// Date headers only carry whole-second resolution, so any single diffMs
// includes up to ~1s of rounding noise on top of the real drift - that's why
// this takes many samples spread over a few seconds rather than trusting
// one reading (see the real result that prompted this:
// results/raw-referral-responses/*.json's responseHeaders.diffMs, a single
// ~811ms sample from getWaslaPatientReferralDataFromAPI.mjs).
//
// Needs a live, logged-in Wasla session, so it opens its own Puppeteer
// browser against the SAME Chrome profile the main bot uses
// (CHROME_EXECUTABLE_PATH/USER_PROFILE_PATH) - stop the main bot (`yarn
// start`) before running this, same as backfillPatientDetails.mjs.
//
// Usage (from the project root):
//   node src/calibrateServerClockDrift.mjs [sampleCount] [delayMs]
//   sampleCount default 40, delayMs (gap between samples) default 250

import dotenv from "dotenv";
dotenv.config();

import puppeteer from "puppeteer";
import makeUserLoggedInOrOpenHomePage from "./makeUserLoggedInOrOpenHomePage.mjs";
import openWaslaReferralWidget from "./openWaslaReferralWidget.mjs";
import getWaslaReferralFrame from "./getWaslaReferralFrame.mjs";
import sleep from "./sleep.mjs";
import { HOME_PAGE_URL, API_URLS, baseWaslaHeaders } from "./constants.mjs";

const { CHROME_EXECUTABLE_PATH, USER_PROFILE_PATH } = process.env;

const sampleCount = Number(process.argv[2]) || 40;
const delayMs = Number(process.argv[3]) || 250;

const median = (numbers) => {
  const sorted = [...numbers].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
};

const browser = await puppeteer.launch({
  headless: false,
  defaultViewport: null,
  executablePath: CHROME_EXECUTABLE_PATH,
  userDataDir: `${USER_PROFILE_PATH}/Profile 1`,
  pipe: true,
  args: ["--start-maximized", "--disable-dev-shm-usage"],
});

try {
  const { isLoggedIn, newPage, isErrorAboutLockedOut } =
    await makeUserLoggedInOrOpenHomePage({
      browser,
      startingPageUrl: HOME_PAGE_URL,
      noCursor: true,
      noBundleCheck: true,
    });

  if (isErrorAboutLockedOut || !isLoggedIn) {
    console.error(
      `Could not log in (isErrorAboutLockedOut=${isErrorAboutLockedOut}, isLoggedIn=${isLoggedIn}) - make sure the main app's profile has a valid session, then retry.`,
    );
    process.exit(1);
  }

  const { success: widgetOpened, message: widgetMessage } =
    await openWaslaReferralWidget({ page: newPage });

  if (!widgetOpened) {
    console.error(`Could not open Wasla widget: ${widgetMessage}`);
    process.exit(1);
  }

  const {
    success: frameReady,
    frame,
    message: frameMessage,
  } = await getWaslaReferralFrame(newPage);

  if (!frameReady) {
    console.error(`Could not reach Wasla widget frame: ${frameMessage}`);
    process.exit(1);
  }

  console.log(`Sampling ${sampleCount} times, ${delayMs}ms apart...\n`);

  const samples = [];

  for (let i = 1; i <= sampleCount; i++) {
    const result = await frame.evaluate(
      async ({ url, baseHeaders, body }) => {
        const getAuthHeaders = () => {
          try {
            const rawAuth = localStorage.getItem("persist:auth");
            if (!rawAuth) return {};

            const parsedAuth = JSON.parse(rawAuth);
            const token = parsedAuth?.token
              ? JSON.parse(parsedAuth.token)
              : null;

            return {
              ...(token ? { Authorization: `Bearer ${token}` } : {}),
              culture: localStorage.getItem("i18nextLng") || "en",
            };
          } catch {
            return {};
          }
        };

        const localBefore = Date.now();

        try {
          const res = await fetch(url, {
            method: "POST",
            credentials: "include",
            headers: { ...baseHeaders, ...getAuthHeaders() },
            body,
          });

          const localAfter = Date.now();

          return {
            ok: res.ok,
            localBefore,
            localAfter,
            serverDate: res.headers.get("Date"),
          };
        } catch (error) {
          return {
            ok: false,
            localBefore,
            localAfter: Date.now(),
            serverDate: null,
            error: error?.message || String(error),
          };
        }
      },
      {
        url: API_URLS.CASES_LIST,
        baseHeaders: baseWaslaHeaders,
        body: JSON.stringify({
          pageNumber: 1,
          pageSize: 1,
          sortField: "CreatedDate",
          sortDirection: "DESC",
          tab: 1,
        }),
      },
    );

    const { ok, localBefore, localAfter, serverDate, error } = result;
    const rttMs = localAfter - localBefore;
    const serverNow = serverDate ? new Date(serverDate).getTime() : null;
    const diffMs = serverNow != null ? localAfter - serverNow : null;

    if (ok && diffMs != null) {
      samples.push({ rttMs, diffMs });
      console.log(
        `#${i.toString().padStart(2, "0")}  rttMs=${rttMs.toString().padStart(4)}  diffMs=${diffMs}`,
      );
    } else {
      console.log(
        `#${i.toString().padStart(2, "0")}  skipped (ok=${ok}${error ? `, error=${error}` : ""})`,
      );
    }

    if (i < sampleCount) {
      await sleep(delayMs);
    }
  }

  if (!samples.length) {
    console.error("\nNo usable samples - couldn't reach the Date header.");
    process.exit(1);
  }

  const diffs = samples.map((s) => s.diffMs);
  const rtts = samples.map((s) => s.rttMs);

  // The lowest-RTT samples are the most trustworthy (least time could've
  // passed between the server stamping its Date header and us receiving the
  // response) - their median is a better drift estimate than the overall
  // median, which still includes slower, noisier samples.
  const byRtt = [...samples].sort((a, b) => a.rttMs - b.rttMs);
  const fastestQuarterCount = Math.max(1, Math.ceil(samples.length / 4));
  const fastestDiffs = byRtt.slice(0, fastestQuarterCount).map((s) => s.diffMs);

  console.log(`\n${samples.length}/${sampleCount} usable samples.`);
  console.log(
    `diffMs  min=${Math.min(...diffs)}  median=${median(diffs)}  max=${Math.max(...diffs)}`,
  );
  console.log(
    `rttMs   min=${Math.min(...rtts)}  median=${median(rtts)}  max=${Math.max(...rtts)}`,
  );
  console.log(
    `\nBest estimate (median of the fastest ${fastestQuarterCount} samples by rttMs): ${median(fastestDiffs)}ms` +
      ` (positive = this machine's clock is ahead of the server's).` +
      ` Still only accurate to within ~1s - the Date header has no sub-second resolution.`,
  );
} finally {
  await browser.close();
}
