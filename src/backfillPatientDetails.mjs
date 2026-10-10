// One-off utility: backfills the patient-detail columns added to the
// `patients` table (nationality, specialty, specialtyId, subSpecialty,
// sourceProvider, mobileNumber, subReferralTypeId, subReferralTypeName,
// note, medicalData) for rows saved before those columns existed, by
// re-calling GET /api/referrals/{navigationId} - the same endpoint
// getWaslaPatientReferralDataFromAPI.mjs already uses for newly-collected
// cases, so this script just re-runs that for old rows.
// Also backfills attachmentFileBase64/attachmentFileName/
// attachmentFileMimeType (the single case-report file, see
// buildCaseReportFile.mjs) for any row missing it - independently of the
// detail-fields backfill above, since a row can already have one without
// the other.
// Also backfills `arrived` for any claimed row that doesn't have it yet -
// the same GET /api/referrals/{navigationId} call above already reports
// this (isArrived, derived from the response's own top-level `status`
// field - confirmed live: 6 means arrived), so no second endpoint/tab
// lookup is needed. Unlike the live flow (performArrivalConfirmation.mjs,
// which sets arrived="Yes" the moment an operator confirms it through the
// bot), this is the only place arrived gets inferred after the fact from
// Wasla's own record rather than our own action - old rows predating that
// feature, or ones where the confirmation step was missed/not through the
// bot, would otherwise stay NULL forever.
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
import buildCaseReportFile from "./buildCaseReportFile.mjs";
import sleep from "./sleep.mjs";
import { HOME_PAGE_URL } from "./constants.mjs";

const { CHROME_EXECUTABLE_PATH, USER_PROFILE_PATH } = process.env;

const requestedIds = process.argv.slice(2);

const rowsToProcess = requestedIds.length
  ? requestedIds.map((id) => getPatient(id)).filter(Boolean)
  : allPatientsStatement
      .all()
      .filter(
        (row) =>
          row.navigationId &&
          (row.nationality == null ||
            row.attachmentFileBase64 == null ||
            row.specialtyId == null ||
            row.subReferralTypeId == null ||
            (row.claimed === "Yes" && row.arrived == null)),
      );

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

    const needsAttachment = row.attachmentFileBase64 == null;
    const needsArrivedCheck = row.claimed === "Yes" && row.arrived == null;

    const patientData = await getWaslaPatientReferralDataFromAPI(
      frame,
      navigationId,
      referralId,
      !needsAttachment, // skippAttachments - only download the files when this row doesn't have a cached report yet,
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
      specialtyId,
      subSpecialty,
      sourceProvider,
      mobileNumber,
      requestedBedType,
      subReferralTypeId,
      subReferralTypeName,
      note,
      medicalData,
      files,
      isArrived,
    } = patientData;

    // Never downgrades an already-confirmed arrival, and only set at all
    // for rows that actually needed checking (claimed but not yet marked
    // arrived) - a row re-fetched here for an unrelated reason (e.g. the
    // nationality backfill) shouldn't have this touched either way.
    const arrivedUpdate =
      needsArrivedCheck && isArrived ? { arrived: "Yes" } : {};

    console.log({
      needsArrivedCheck,
      isArrived,
      arrivedUpdate,
    });

    // Built as a separate object (rather than destructured `let`s passed
    // directly into updatePatients) so a row that didn't need/get an
    // attachment this pass never sends an explicit `undefined` for these
    // keys - toDbRow's `oldRow` merge treats an explicitly-present
    // `undefined` key as "overwrite with null", which would wipe out an
    // already-cached attachment on a row that's only here for the
    // nationality backfill.
    const attachmentUpdate = {};

    if (needsAttachment && files?.length) {
      const reportFile = await buildCaseReportFile(files, referralId).catch(
        (error) => {
          console.warn(
            `referralId=${referralId} report build failed: ${error?.message || error}`,
          );
          return null;
        },
      );

      if (reportFile) {
        attachmentUpdate.attachmentFileBase64 =
          reportFile.buffer.toString("base64");
        attachmentUpdate.attachmentFileName = reportFile.filename;
        attachmentUpdate.attachmentFileMimeType = reportFile.mimeType;
      }
    }

    updatePatients({
      referralId,
      nationality,
      specialty,
      specialtyId,
      subSpecialty,
      sourceProvider,
      mobileNumber,
      requestedBedType,
      subReferralTypeId,
      subReferralTypeName,
      note,
      medicalData,
      ...attachmentUpdate,
      ...arrivedUpdate,
    });

    console.log(
      `referralId=${referralId} updated${attachmentUpdate.attachmentFileBase64 ? " (with attachment)" : ""}${arrivedUpdate.arrived ? " (arrived confirmed)" : ""}.`,
    );
    updatedCount++;

    await sleep(1000 + Math.random() * 1500);
  }

  console.log(
    `Done. updated=${updatedCount} skipped=${skippedCount} total=${rowsToProcess.length}`,
  );
} finally {
  await browser.close();
}
