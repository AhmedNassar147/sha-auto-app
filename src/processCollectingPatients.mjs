/*
 *
 * Helper: `processCollectingPatients`.
 *
 */
import generateAcceptancePdfLetters from "./generatePdfs.mjs";
import getWaslaPatientReferralDataFromAPI from "./getWaslaPatientReferralDataFromAPI.mjs";
import insureFetchedPatientData from "./insureFetchedPatientData.mjs";
import formateDateToString from "./formateDateToString.mjs";
import createConsoleMessage from "./createConsoleMessage.mjs";
import uploadToTransferIt from "./uploadToTransferIt.mjs";
import chooseEnabledLetterLayout from "./chooseEnabledLetterLayout.mjs";
import generateRandomFileName from "./generateRandomFileName.mjs";
import { writeReferralTimingEvent } from "./referralTimingDiagnostics.mjs";
import getWaslaDistributionWindows from "./getWaslaDistributionWindows.mjs";
import sleep from "./sleep.mjs";

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
    let newPatientsSeen = 0;

    for (const patient of patients) {
      index++;

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
        requestedBedType,
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

      // Breaks up the otherwise identical back-to-back API-call rhythm
      // across different genuinely-new cases in the same batch - counted
      // separately from the raw loop index so already-collected cases
      // (skipped above) don't burn jitter time before ever reaching the
      // real work, and skipped so the first new case in a batch isn't
      // delayed either.
      if (newPatientsSeen > 0) {
        await sleep(150 + Math.random() * 300);
      }
      newPatientsSeen++;

      // createConsoleMessage("info", patient, "patient");

      const receivedAtMs = patient.listReceiptTiming?.listReceivedAtMs;
      const broadcastedAtParsedMs = broadcastedAt
        ? new Date(broadcastedAt).getTime()
        : NaN;
      const receiptTiming = {
        ...patient.listReceiptTiming,
        broadcastedAtRaw: broadcastedAt ?? null,
        broadcastedAtParsedMs: Number.isFinite(broadcastedAtParsedMs)
          ? broadcastedAtParsedMs
          : null,
        parserTimeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        receivedSaudiTime: Number.isFinite(receivedAtMs)
          ? new Intl.DateTimeFormat("en-GB", {
              timeZone: "Asia/Riyadh",
              hour12: false,
              hour: "2-digit",
              minute: "2-digit",
              second: "2-digit",
              fractionalSecondDigits: 3,
            }).format(receivedAtMs)
          : null,
        receivedMillisecondPart: Number.isFinite(receivedAtMs)
          ? ((receivedAtMs % 1000) + 1000) % 1000
          : null,
        receivedAfterBroadcastMs:
          Number.isFinite(receivedAtMs) &&
          Number.isFinite(broadcastedAtParsedMs)
            ? receivedAtMs - broadcastedAtParsedMs
            : null,
        collectionStartedAtMs: Date.now(),
        measurement:
          "list body received locally; includes polling/network delay",
      };
      await writeReferralTimingEvent({
        type: "case-received",
        referralId,
        navigationId,
        ...receiptTiming,
      });
      createConsoleMessage(
        "info",
        `Case ${navigationId}: received=${receiptTiming.receivedSaudiTime ?? "unknown"} Saudi, millisecond=${receiptTiming.receivedMillisecondPart ?? "unknown"}, broadcastedAt=${broadcastedAt ?? "unknown"}, receivedAfterBroadcastMs=${receiptTiming.receivedAfterBroadcastMs ?? "unknown"}`,
        "referral timing",
      );

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

      const letterType = chooseEnabledLetterLayout(LETTER_TYPE);

      const randomFileName = generateRandomFileName({
        patientName,
        referralId,
        letterType,
        navigationId,
        referralReferenceId,
      });

      // Randomized per case (rather than one fixed constant for every
      // case) - the same offset before every deadline, every time, is
      // itself a mechanical/bot-like pattern.
      const randomCutoffTimeMs = (10 + Math.floor(Math.random() * 7)) * 1000;

      const finalData = {
        referralId,
        createdAt,
        receiptTiming,
        randomFileName,
        ...getWaslaCaseWindow(
          broadcastedAt,
          randomCutoffTimeMs,
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
        // The tabs/pending-list API returns this as a decimal-formatted
        // string (e.g. "3.0"), unlike the myOrders/tab-2 endpoint used by
        // checkReferralSelectedStatus.mjs (which returns "3") - stored
        // as-is, "3.0" never matches WASLA_STATUS_TYPES' "3" key, so the
        // /db page falls back to showing the raw value instead of a status
        // name. Normalize to a number here too, matching the Number()
        // conversion already done in checkReferralSelectedStatus.mjs.
        status: Number(status),
        navigationId,
        transferUrl,
        ...patientData,
        requestedBedType: requestedBedType || patientData.requestedBedType,
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

      await sleep(2000 + Math.random() * 2000 - 100);
    }
  } catch (err) {
    createConsoleMessage(
      "error",
      err,
      `🛑 Fatal error during processing patients:`,
    );
  }

  return newPatientAdded;
};

export default processCollectingPatients;
