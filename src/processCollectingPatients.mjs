/*
 *
 * Helper: `processCollectingPatients`.
 *
 */
import generateAcceptancePdfLetters from "./generatePdfs.mjs";
import getWaslaPatientReferralDataFromAPI from "./getWaslaPatientReferralDataFromAPI.mjs";
import sleep from "./sleep.mjs";
import insureFetchedPatientData from "./insureFetchedPatientData.mjs";
import formateDateToString from "./formateDateToString.mjs";
import createConsoleMessage from "./createConsoleMessage.mjs";
import uploadToTransferIt from "./uploadToTransferIt.mjs";
import randomArrayItem from "./randomArrayItem.mjs";
import generateRandomFileName from "./generateRandomFileName.mjs";
import getWaslaDistributionWindows from "./getWaslaDistributionWindows.mjs";
import { cutoffTimeMs, LETTER_LAYOUT_NAMES } from "./constants.mjs";

// Wasla gives an exact broadcastedAt timestamp directly on the facility/tabs
// list row (confirmed against the real weslah.seha.sa bundle,
// scripts/ReviewWindowTimer-DAyGxrbR.js: deadline = broadcastedAt +
// windowMinutes * 60_000) — unlike the old GlobMed system, there's no
// countdown message to parse and no server-clock-skew reconciliation needed,
// since this comes straight from the list call rather than a delayed
// per-case details fetch. windowMinutes itself comes from
// getWaslaDistributionWindows (facilityReviewWindowMinutes), matching how
// the portal's own countdown badge (SubmissionValidityCell-DF_QRL2y.js)
// derives it, rather than a hardcoded constant.
const getWaslaCaseWindow = (broadcastedAt, cutoffTimeMs, windowMinutes) => {
  const referralEndTimestamp =
    new Date(broadcastedAt).getTime() + windowMinutes * 60 * 1000;

  const timeWithUserReaction = cutoffTimeMs + 2000;
  const shouldCutoffTime = referralEndTimestamp > timeWithUserReaction;

  const referralEndDateActionableAtMS = shouldCutoffTime
    ? referralEndTimestamp - cutoffTimeMs
    : referralEndTimestamp;

  return {
    cutoffTimeMs: shouldCutoffTime ? cutoffTimeMs : 0,
    broadcastedAt,
    referralStartDate: formateDateToString(new Date(broadcastedAt)),
    referralEndDate: formateDateToString(referralEndTimestamp),
    referralEndTimestamp,
    referralEndDateActionableAtMS,
    referralEndDateActionablAt: formateDateToString(
      referralEndDateActionableAtMS,
    ),
  };
};

const processCollectingPatients = async ({
  browser,
  patientsStore,
  frame,
  patients,
}) => {
  const { USE_NTFY_AS_CASE_PROVIDER, LETTER_TYPE } = process.env;

  let newPatientAdded = false;

  try {
    const patientsLength = patients?.length ?? 0;

    const {
      facilityReviewWindowMinutes,
      acceptanceWindowMinutes,
      extendScopeWindowMinutes,
    } = await getWaslaDistributionWindows(frame);

    let index = 0;

    for (const patient of patients) {
      index++;

      createConsoleMessage("info", patient, "patient");

      const {
        referralId: patientReferralId,
        createdAt,
        referralReferenceId,
        patientName,
        patientNationalId,
        referralReason: rawReferralReason,
        providerRegion: rawProviderRegion,
        referralType: rawReferralType,
        status,
        broadcastedAt,
        id: navigationId,
        // https://weslah.seha.sa/facility-referrals/view/navigationId
      } = patient || {};
      const referralId = String(patientReferralId);

      // Wasla represents region/reason/type fields as lookup objects
      // ({id, name, description}, referralReason as an array of them) -
      // confirmed live in scripts/apis.mjs's case-details recon. SQLite can
      // only bind primitives (numbers/strings/bigints/buffers/null), so
      // these have to be flattened to plain strings here, at the external
      // API boundary, before they ever reach patientsStore/db.mjs - passing
      // an object/array straight through crashed insertPatients live.
      const nameOfLookup = (value) =>
        value && typeof value === "object" ? (value.name ?? null) : value;

      const providerRegion = nameOfLookup(rawProviderRegion);
      const referralType = nameOfLookup(rawReferralType);
      const referralReason = Array.isArray(rawReferralReason)
        ? rawReferralReason.map(nameOfLookup).filter(Boolean).join(" - ")
        : nameOfLookup(rawReferralReason);

      if (!referralId) {
        createConsoleMessage("warn", `⏩ skipping patient without referralId`);
        continue;
      }

      createConsoleMessage(
        "info",
        `🔹 Progress: ${index}/${patientsLength} (referralId=${referralId} navigationId=${navigationId})`,
      );

      if (patientsStore.has(referralId)) {
        createConsoleMessage(
          "warn",
          `✅ Skipping referralId=${referralId} navigationId=${navigationId} already collected...`,
        );
        continue;
      }

      // mark as we found at least one new patient (before processing)
      if (!newPatientAdded) newPatientAdded = true;

      createConsoleMessage(
        "info",
        `📡 Fetching data for referralId=${referralId} navigationId=${navigationId}...`,
      );

      // Call existing API function to get detailed patient info
      const { serverDate, serverNow, ...patientData } =
        (await insureFetchedPatientData(
          () =>
            getWaslaPatientReferralDataFromAPI(frame, navigationId, referralId),
          3, // attempts
          1200, // base backoff ms
        )) || {};

      const { patientDetailsError, attachmentsError } = patientData || {};

      const hasInternalError =
        !patientData || patientDetailsError || attachmentsError;

      if (hasInternalError) {
        createConsoleMessage(
          "error",
          `❌ Error collecting referralId=${referralId} navigationId=${navigationId} => patientData=${!!patientData}, patientDetailsError=${patientDetailsError}, attachmentsError=${attachmentsError}`,
        );
        continue;
      }

      let transferUrl;

      if (USE_NTFY_AS_CASE_PROVIDER === "Y") {
        const uploadResult = await uploadToTransferIt({
          browser,
          files: patientData.files,
          title: `ReferralId=${referralId}-navigationId=${navigationId}-report`,
        });
        transferUrl = uploadResult.transferUrl;

        if (!uploadResult.success) {
          createConsoleMessage(
            "error",
            `❌ Error uploading files for referralId=${referralId}-navigationId=${navigationId} => uploadResult=${JSON.stringify(uploadResult)}`,
          );
        }
      }

      const letterType = LETTER_TYPE || randomArrayItem(LETTER_LAYOUT_NAMES);

      const randomFileName = generateRandomFileName({
        patientName,
        referralId,
        letterType,
      });

      const finalData = {
        referralId,
        createdAt,
        randomFileName,
        ...getWaslaCaseWindow(
          broadcastedAt,
          cutoffTimeMs,
          facilityReviewWindowMinutes,
        ),
        facilityReviewWindowMinutes,
        acceptanceWindowMinutes,
        extendScopeWindowMinutes,
        referralReferenceId,
        patientName,
        patientNationalId,
        referralReason,
        providerRegion,
        referralType,
        status,
        navigationId,
        transferUrl,
        ...patientData,
        letterType,
        tab: 1,
        tabName: "Referrals",
        paid: 0,
      };

      await patientsStore.addPatients(finalData);

      // Generate acceptance PDFs concurrently
      await Promise.allSettled([
        generateAcceptancePdfLetters(browser, [finalData], true, letterType),
        generateAcceptancePdfLetters(browser, [finalData], false, letterType),
      ]);

      await sleep(2000 + Math.random() * 2000);
    }
  } catch (err) {
    createConsoleMessage(
      "error",
      err,
      `🛑 Fatal error during processing patients:`,
    );
  }

  await sleep(2500 + Math.random() * 3000);

  return newPatientAdded;
};

export default processCollectingPatients;
