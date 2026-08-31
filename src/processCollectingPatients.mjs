/*
 *
 * Helper: `processCollectingPatients`.
 *
 */
import generateAcceptancePdfLetters from "./generatePdfs.mjs";
import getPatientReferralDataFromAPI from "./getPatientReferralDataFromAPI.mjs";
import sleep from "./sleep.mjs";
import insureFetchedPatientData from "./insureFetchedPatientData.mjs";
import formateDateToString from "./formateDateToString.mjs";
import createConsoleMessage from "./createConsoleMessage.mjs";
import uploadToTransferIt from "./uploadToTransferIt.mjs";
import randomArrayItem from "./randomArrayItem.mjs";
import { cutoffTimeMs, LETTER_LAYOUT_NAMES } from "./constants.mjs";

const getLeftMsBasedCaseMessage = (caseAlertMessage) => {
  const match = caseAlertMessage.match(
    /(\d+)\s*(?:minute(?:\(s\))?|mins?|min)\s+and\s+(\d+)\s*(?:second(?:\(s\))?|secs?|sec)/,
  );

  if (!match) {
    createConsoleMessage(
      "warn",
      `⚠️ Could not parse time from caseAlertMessage: "${caseAlertMessage}"`,
    );
  }

  const minsLeft = parseInt(match?.[1], 10) || 0;
  const secsLeft = parseInt(match?.[2], 10) || 0;

  const _leftMs = (minsLeft * 60 + secsLeft) * 1000;

  return _leftMs;
};

const getSaudiStartAndEndDate = ({
  referralDate,
  caseAlertMessage,
  cutoffTimeMs,
  detailsAPiFiresAtMS,
  detailsAPiServerResponseTimeMS,
  serverNow,
  serverDate,
}) => {
  const currentDate = new Date();
  const utcDate = new Date(referralDate);

  // Convert to Saudi time
  let saStartDate = new Date(
    utcDate.toLocaleString("en-US", { timeZone: "Asia/Riyadh" }),
  );

  const Min_15 = 15 * 60 * 1000;
  let isReferralOldDate = false;
  const leftMsBasedMessage = getLeftMsBasedCaseMessage(caseAlertMessage);

  if (saStartDate < new Date(currentDate - Min_15) && caseAlertMessage) {
    isReferralOldDate = true;
    const backExtraTime = Min_15 - leftMsBasedMessage;

    saStartDate = new Date(
      detailsAPiFiresAtMS - detailsAPiServerResponseTimeMS - backExtraTime,
    );
  }

  // Clone for end date
  const saEndDate = new Date(saStartDate);
  saEndDate.setMilliseconds(saEndDate.getMilliseconds() + Min_15);

  const endDateBasedServerDateMs =
    serverNow && leftMsBasedMessage ? serverNow + leftMsBasedMessage : null;

  // prefer server time, fall back to client time
  const referralEndTimestamp = endDateBasedServerDateMs ?? saEndDate.getTime();
  // const referralEndTimestamp = saEndDate.getTime();
  const timeWithUserReaction = cutoffTimeMs + 2000;

  const shouldCutoffTime = referralEndTimestamp > timeWithUserReaction;

  const referralEndDateActionableAtMS = shouldCutoffTime
    ? referralEndTimestamp - cutoffTimeMs
    : referralEndTimestamp;

  return {
    isReferralOldDate,
    cutoffTimeMs: shouldCutoffTime ? cutoffTimeMs : 0,
    referralDate,
    referralStartDate: formateDateToString(saStartDate),
    referralEndDate: formateDateToString(referralEndTimestamp), // server-based when available, client fallback
    referralEndTimestamp,
    referralEndDateActionableAtMS,
    referralEndDateActionablAt: formateDateToString(
      referralEndDateActionableAtMS,
    ),
    serverDate,
    serverNow,
    serverFormatedDate: serverNow ? formateDateToString(serverNow) : null,
    endDateBasedServerDateMs,
    endDateBasedServerDate: endDateBasedServerDateMs
      ? formateDateToString(endDateBasedServerDateMs)
      : null,
  };
};

const processCollectingPatients = async ({
  browser,
  patientsStore,
  page,
  patients,
}) => {
  const { USE_NTFY_AS_CASE_PROVIDER, LETTER_TYPE } = process.env;

  let newPatientAdded = false;

  try {
    const patientsLength = patients?.length ?? 0;

    let index = 0;

    for (const patient of patients) {
      index++;

      const {
        referralId: patientReferralId,
        referralDate,
        createdAt,
        referralReferenceId,
        patientName,
        patientNationalId,
        referralReason,
        providerRegion,
        referralType,
        status,
        id: idForNavigation,
        // https://weslah.seha.sa/facility-referrals/view/384325
      } = patient || {};
      const referralId = String(patientReferralId);

      if (!referralId) {
        createConsoleMessage("warn", `⏩ skipping patient without referralId`);
        continue;
      }

      createConsoleMessage(
        "info",
        `🔹 Progress: ${index}/${patientsLength} (referralId=${referralId})`,
      );

      if (patientsStore.has(referralId)) {
        createConsoleMessage(
          "warn",
          `✅ Skipping referralId=${referralId} already collected...`,
        );
        continue;
      }

      // mark as we found at least one new patient (before processing)
      if (!newPatientAdded) newPatientAdded = true;

      createConsoleMessage(
        "info",
        `📡 Fetching data for referralId=(${referralId})...`,
      );

      // Call existing API function to get detailed patient info
      const { serverDate, serverNow, ...patientData } =
        (await insureFetchedPatientData(
          () => getPatientReferralDataFromAPI(page, referralId),
          3, // attempts
          1200, // base backoff ms
        )) || {};

      const {
        patientDetailsError,
        patientInfoError,
        attachmentsError,
        caseAlertMessage,
        detailsAPiFiresAtMS,
        detailsAPiServerResponseTimeMS,
      } = patientData || {};

      const hasInternalError =
        !patientData ||
        patientDetailsError ||
        patientInfoError ||
        attachmentsError;

      if (hasInternalError) {
        createConsoleMessage(
          "error",
          `❌ Error collecting referralId=${referralId} => patientData=${!!patientData}, patientDetailsError=${patientDetailsError}, patientInfoError=${patientInfoError}, attachmentsError=${attachmentsError}`,
        );
        continue;
      }

      let transferUrl;

      if (USE_NTFY_AS_CASE_PROVIDER === "Y") {
        const uploadResult = await uploadToTransferIt({
          browser,
          files: patientData.files,
          title: `ReferralId=${referralId}-report`,
        });
        transferUrl = uploadResult.transferUrl;

        if (!uploadResult.success) {
          createConsoleMessage(
            "error",
            `❌ Error uploading files for referralId=${referralId} => uploadResult=${JSON.stringify(uploadResult)}`,
          );
        }
      }

      const letterType = LETTER_TYPE || randomArrayItem(LETTER_LAYOUT_NAMES);

      const finalData = {
        referralId,
        transferUrl,
        ...getSaudiStartAndEndDate({
          referralDate,
          detailsAPiServerResponseTimeMS,
          detailsAPiFiresAtMS,
          caseAlertMessage,
          cutoffTimeMs,
          serverDate,
          serverNow,
        }),
        ...patientData,
        letterType,
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
