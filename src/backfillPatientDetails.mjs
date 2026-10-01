// One-off utility: backfills the patient-detail columns added to the
// `patients` table (nationality, specialty, subSpecialty, sourceProvider,
// mobileNumber, note, medicalData, attachmentUrls) for rows saved before
// those columns existed, by re-calling GET /api/referrals/{navigationId} -
// the same endpoint getWaslaPatientReferralDataFromAPI.mjs already uses for
// newly-collected cases, so this script just re-runs that for old rows.
//
// Needs a live, logged-in Wasla session, so it opens its own Puppeteer
// browser against the SAME Chrome profile the main bot uses
// (CHROME_EXECUTABLE_PATH/USER_PROFILE_PATH) - reusing that profile means
// an already-valid session skips a fresh Nafath login entirely. Chrome
// refuses to open one profile directory from two processes at once, so
// stop the main bot (`yarn start`) before running this.
//
// Usage (from the project root):
//   node scripts/backfillPatientDetails.mjs                # every row missing nationality
//   node scripts/backfillPatientDetails.mjs <referralId> [more ids...]

import dotenv from "dotenv";
dotenv.config();

import puppeteer from "puppeteer";
import { allPatientsStatement, getPatient, updatePatients } from "./db.mjs";
import makeUserLoggedInOrOpenHomePage from "./makeUserLoggedInOrOpenHomePage.mjs";
import openWaslaReferralWidget from "./openWaslaReferralWidget.mjs";
import getWaslaReferralFrame from "./getWaslaReferralFrame.mjs";
import getWaslaPatientReferralDataFromAPI from "./getWaslaPatientReferralDataFromAPI.mjs";
import sleep from "./sleep.mjs";
import { HOME_PAGE_URL } from "./constants.mjs";

const { CHROME_EXECUTABLE_PATH, USER_PROFILE_PATH } = process.env;

const requestedIds = process.argv.slice(2);

const rowsToProcess = requestedIds.length
  ? requestedIds.map((id) => getPatient(id)).filter(Boolean)
  : allPatientsStatement
      .all()
      .filter((row) => row.navigationId && row.nationality == null);

if (!rowsToProcess.length) {
  console.log("Nothing to backfill.");
  process.exit(0);
}

console.log(`Backfilling ${rowsToProcess.length} case(s)...`);

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

  let updatedCount = 0;
  let skippedCount = 0;

  for (const row of rowsToProcess) {
    const { referralId, navigationId } = row;

    if (!navigationId) {
      console.warn(`referralId=${referralId} has no navigationId, skipping.`);
      skippedCount++;
      continue;
    }

    const patientData = await getWaslaPatientReferralDataFromAPI(
      frame,
      navigationId,
      referralId,
      true, // skippAttachments - attachmentUrls metadata is captured regardless, no need for the full base64 download here
    );

    const { patientDetailsError } = patientData || {};

    if (patientDetailsError || !patientData) {
      console.warn(
        `referralId=${referralId} fetch failed: ${patientDetailsError}`,
      );
      skippedCount++;
      continue;
    }

    const {
      nationality,
      specialty,
      subSpecialty,
      sourceProvider,
      mobileNumber,
      requestedBedType,
      note,
      medicalData,
      attachmentUrls,
    } = patientData;

    updatePatients({
      referralId,
      nationality,
      specialty,
      subSpecialty,
      sourceProvider,
      mobileNumber,
      requestedBedType,
      note,
      medicalData,
      attachmentUrls,
    });

    console.log(`referralId=${referralId} updated.`);
    updatedCount++;

    await sleep(1000 + Math.random() * 1500);
  }

  console.log(
    `Done. updated=${updatedCount} skipped=${skippedCount} total=${rowsToProcess.length}`,
  );
} finally {
  await browser.close();
}
