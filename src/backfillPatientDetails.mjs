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
// Also backfills `arrived`/withdrawal state for any claimed row that still
// looks like an active acceptance - also independent of the other two, by
// checking the case's current status on the "myOrders" tab (same tab/lookup
// checkReferralSelectedStatus.mjs uses live) and comparing it against
// Wasla's own ConfirmedArrival/Withdrawn codes. Both performArrivalConfirmation.mjs
// and performWithdrawal.mjs now set this locally the moment an operator
// confirms either through the bot, but neither existed (or wasn't called)
// for older rows, and nothing else in the live flow ever re-checks a case
// once checkReferralSelectedStatus.mjs resolves it to claimed="Yes" and
// drops it from its polling queue - so without this, those rows would stay
// frozen at their original accept-time status/userActionName forever even
// if the case was later actually confirmed arrived or withdrawn.
// Also, separately and first (no browser/API needed), corrects
// userActionName for any row whose status is already Withdrawn locally but
// whose userActionName was never updated to match - checkReferralSelectedStatus.mjs
// writes status/claimed but not userActionName, so that mismatch can exist
// independently of whether a live re-check (above) is even needed.
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
import getWaslaCasesFromAPI from "./getWaslaCasesFromAPI.mjs";
import buildCaseReportFile from "./buildCaseReportFile.mjs";
import sleep from "./sleep.mjs";
import { HOME_PAGE_URL, USER_ACTION_TYPES } from "./constants.mjs";

const { CHROME_EXECUTABLE_PATH, USER_PROFILE_PATH } = process.env;

// See constants.mjs's WASLA_STATUS_TYPES - 4 = "ConfirmedArrival" (the same
// code checkReferralSelectedStatus.mjs's CLAIMED_STATUS_CODES treats as a
// claimed outcome) and 5 = "Withdrawn". Kept local rather than importing
// WASLA_STATUS_TYPES since these are the two specific codes this script
// cares about, not a lookup table.
const CONFIRMED_ARRIVAL_STATUS_CODE = 4;
const WITHDRAWN_STATUS_CODE = 5;

// Local-only fix, no browser/Wasla API needed - a row can already have the
// correct status (5 = Withdrawn) stored, set correctly by
// checkReferralSelectedStatus.mjs while it was still polling, with
// userActionName never corrected to match, since nothing in the live flow
// ever wrote userActionName except the original accept action itself
// (confirmed live: referralId 4IMB5GR1V8FL0SU and 9EVGPG6FL7V4MD0 both show
// status=5/claimed=No/userActionName=accept in the same row). Run
// unconditionally, before anything else here, since it needs no session.
const staleWithdrawnRows = allPatientsStatement
  .all()
  .filter(
    (row) =>
      Number(row.status) === WITHDRAWN_STATUS_CODE &&
      row.userActionName === USER_ACTION_TYPES.ACCEPT,
  );

for (const row of staleWithdrawnRows) {
  updatePatients({
    referralId: row.referralId,
    userActionName: USER_ACTION_TYPES.REJECT,
  });
  console.log(
    `referralId=${row.referralId} userActionName corrected to reject (status was already Withdrawn).`,
  );
}

if (staleWithdrawnRows.length) {
  console.log(
    `Fixed ${staleWithdrawnRows.length} already-withdrawn row(s) locally (no API call needed).`,
  );
}

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
            (row.claimed === "Yes" &&
              row.userActionName === USER_ACTION_TYPES.ACCEPT)),
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
    // Covers both drifts this one lookup can reveal: the case having since
    // been confirmed arrived (only relevant if arrived isn't already set),
    // or having since been withdrawn (only relevant while our own record
    // still says "accept", i.e. nothing's corrected it yet).
    const needsClaimedStatusRecheck =
      row.claimed === "Yes" &&
      (row.arrived == null || row.userActionName === USER_ACTION_TYPES.ACCEPT);

    // A separate API (the "myOrders" tab listing, not the per-case details
    // endpoint below) - checked and persisted independently so a failure
    // in the details fetch below doesn't also throw away a confirmation
    // this already found.
    const claimedStatusUpdate = {};

    if (needsClaimedStatusRecheck) {
      const { patients: ordersPatients } = await getWaslaCasesFromAPI(frame, {
        searchReferralID: referralId,
        tab: 2,
      }).catch(() => ({ patients: [] }));

      const foundOrder = ordersPatients?.find(
        (patient) => `${patient.referralId}` === String(referralId),
      );

      const foundStatus = foundOrder ? Number(foundOrder.status) : null;

      if (
        row.arrived == null &&
        foundStatus === CONFIRMED_ARRIVAL_STATUS_CODE
      ) {
        claimedStatusUpdate.arrived = "Yes";
      } else if (
        row.userActionName === USER_ACTION_TYPES.ACCEPT &&
        foundStatus === WITHDRAWN_STATUS_CODE
      ) {
        claimedStatusUpdate.status = WITHDRAWN_STATUS_CODE;
        claimedStatusUpdate.userActionName = USER_ACTION_TYPES.REJECT;
      }
    }

    // Unlike a plain failed fetch (caught inside the evaluated page function
    // and returned as patientDetailsError), a Puppeteer/CDP-level failure -
    // e.g. "Execution context was destroyed, most likely because of a
    // navigation" (confirmed live, crashed the whole backfill run) - throws
    // from frame.evaluate() itself rather than resolving, since it happens
    // outside the browser-side try/catch entirely. Caught here the same way
    // so one bad row's transient navigation doesn't take down the rest of
    // the batch.
    const patientData = await getWaslaPatientReferralDataFromAPI(
      frame,
      navigationId,
      referralId,
      !needsAttachment, // skippAttachments - only download the files when this row doesn't have a cached report yet,
    ).catch((error) => ({
      patientDetailsError: error?.message || String(error),
    }));

    const { patientDetailsError } = patientData || {};

    if (patientDetailsError || !patientData) {
      if (claimedStatusUpdate.arrived || claimedStatusUpdate.status) {
        updatePatients({ referralId, ...claimedStatusUpdate });
        console.log(
          `referralId=${referralId} ${claimedStatusUpdate.arrived ? "arrived" : "withdrawal"} updated (details fetch below failed, applied independently).`,
        );
        updatedCount++;
      } else {
        skippedCount++;
      }

      console.warn(
        `referralId=${referralId} fetch failed: ${patientDetailsError}`,
      );
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
    } = patientData;

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
      ...claimedStatusUpdate,
    });

    console.log(
      `referralId=${referralId} updated${attachmentUpdate.attachmentFileBase64 ? " (with attachment)" : ""}${claimedStatusUpdate.arrived ? " (arrived confirmed)" : ""}${claimedStatusUpdate.status ? " (withdrawal confirmed)" : ""}.`,
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
