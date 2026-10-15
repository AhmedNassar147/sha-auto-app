/*
 *
 * Helper: `handleSubmitReferral`.
 *
 * A patientsStore event listener factory (same shape as
 * handleCaseAcceptanceOrRejection.mjs: config bound at registration time,
 * e.g. `patientsStore.on(eventName, handleSubmitReferral({ eventName,
 * browser }))` - eventName isn't something Node's EventEmitter hands to a
 * listener on its own, so it's captured via closure here rather than read
 * off the emitted payload). Opens a fresh tab directly on the Wasla
 * frontend's own case-details route (not through the widget iframe) and
 * scrolls it to the bottom. Left open afterward for a human operator to
 * see/act on - this doesn't close the tab itself.
 *
 */
import { writeFile } from "fs/promises";
import { GhostCursor } from "ghost-cursor";
import {
  classifySubmissionResult,
  describeClockSample,
  writeReferralTimingEvent,
} from "./referralTimingDiagnostics.mjs";
import createConsoleMessage from "./createConsoleMessage.mjs";
import getCurrentActionLetterFile from "./getCurrentActionLetterFile.mjs";
import captureFailureArtifacts from "./captureFailureArtifacts.mjs";
import randomArrayItem from "./randomArrayItem.mjs";
import sleep from "./sleep.mjs";
import getReferralRetryDelay from "./getReferralRetryDelay.mjs";
import { updatePatients, getPatient } from "./db.mjs";
import collectCaseCompetition from "./collectCaseCompetition.mjs";
import formatWatcherCompetition from "./formatWatcherCompetition.mjs";
import buildDirectApiTelegramMessage from "./buildDirectApiTelegramMessage.mjs";
import submitWaslaReferralViaApi from "./submitWaslaReferralViaApi.mjs";
import submitWaslaAction from "./submitWaslaAction.mjs";
import buildAdmissionDetails from "./buildAdmissionDetails.mjs";
import fillWaslaRejectionReason from "./fillWaslaRejectionReason.mjs";
import waitForWaslaReferralReady from "./waitForWaslaReferralReady.mjs";
import closePageSafely from "./closePageSafely.mjs";
import showPageSnackbar from "./showPageSnackbar.mjs";
import getOrgLabel from "./getOrgLabel.mjs";
import {
  USER_ACTION_TYPES,
  API_URLS,
  WASLA_REFERRAL_VIEW_URL,
  htmlFilesPath,
} from "./constants.mjs";

const NAVIGATION_TIMEOUT_MS = 20_000;

const { ACCEPT, REJECT } = USER_ACTION_TYPES;

// Confirmed live (html/details/details-frame.html): the accept/reject
// buttons have no id/data-testid/aria-label to key off, so matched by their
// known Arabic/English text instead - both language variants listed
// explicitly. If neither is found (unrecognized UI variant, unexpected
// language, etc.) this does nothing rather than guessing which button to
// click.
const ACCEPT_BUTTON_TEXTS = ["قبول الإحالة", "Accept Referral"];
const REJECT_BUTTON_TEXTS = ["رفض الإحالة", "Reject Referral"];
const ACTION_BUTTON_TIMEOUT_MS = 10_000;

// The confirmation popup after clicking accept/reject (html/details/
// rejection-modal.html, html/details/accept-modal.html) - stable MUI base
// classes (not the hashed per-build "mui-xxxxxx" ones) and plain
// attribute selectors, no page text. We wait for the modal root itself
// first, then every other selector below is queried scoped to that
// ElementHandle (via its own .waitForSelector) rather than re-searching
// the whole document each time.
const MODAL_SELECTOR = ".MuiDialog-root";
const MODAL_FILE_INPUT_SELECTOR = "input[type='file']";
// The accept modal renders a second, hidden shadow <textarea> next to the
// real Description one (MUI's own auto-sizing mirror - aria-hidden,
// readonly, visibility:hidden) - confirmed in accept-modal.html. It only
// happens to come after the real one in that markup, so keying off plain
// `textarea` order isn't safe long-term; `name="notes"` on the real one is.
const MODAL_TEXTAREA_SELECTOR = "textarea[name='notes']";
const MODAL_TIMEOUT_MS = 15_000;

// Confirmed unique in both html/details/accept-modal.html and
// rejection-modal.html: the forward action (accept's "Confirm", reject's
// "Reject Confirmation") is the only MuiButton-containedPrimary in the
// dialog. Both acceptance and rejection use the contained variant. It starts
// disabled (disabled="" in the real markup) until the required fields
// validate, so this waits for that rather than a fixed delay.
const CONFIRM_BUTTON_SELECTOR = "button.MuiButton-contained";
const CONFIRM_BUTTON_TIMEOUT_MS = 15_000;
const SLEEP_AFTER_CONFIRMATION_MS = 15_000;

// Lookup id from the portal's own rejection-reasons list (scripts/
// reject-case.js) - "Unavailability of Required Bed" / "عدم توفر السرير
// المطلوب". Always this one reason, per instruction.
const REJECTION_REASON_ID = 18;

// Both confirmed live as transient, timing-related failures that a later
// retry for the exact same case went on to succeed past, not permanent
// rejections - "review window has elapsed" (the window itself not open
// yet) and "attachments are missing or expired" (the pre-uploaded
// attachment id not yet recognized by the accept-processing side, seen
// resolving itself ~500ms-1s after the pre-upload completed). A failure
// for any OTHER reason is treated as decisive (stops retrying) rather
// than retried, since we've only ever confirmed these two specific
// conditions to be worth retrying past.
const RETRIABLE_ERROR_SUBSTRINGS = [
  "review window has elapsed",
  "attachments are missing or expired",
];

const isRetriableFailure = (error) =>
  RETRIABLE_ERROR_SUBSTRINGS.some((substring) => error?.includes?.(substring));

// Confirmed live (results/raw-referral-responses/*.json,
// caseInfo.subReferralType): id "1" = "Inpatient" - distinct from
// referralType (Routine/Urgent/etc). Only Inpatient referrals need
// buildAdmissionDetails.mjs's extra fields to accept.
const INPATIENT_SUB_REFERRAL_TYPE_ID = "1";

// Only the accept modal has a Description field - a different random
// sentence each time rather than one fixed string.
const ACCEPTANCE_DESCRIPTION_TEMPLATES = [
  (navigationId) => `We are ready to accept this case ${navigationId}.`,
  (navigationId) =>
    `This referral ${navigationId} has been reviewed and is ready to be accepted.`,
  (navigationId) =>
    `We confirm our facility's capacity to accept referral ${navigationId} at this time.`,
  (navigationId) =>
    `Case ${navigationId} has been reviewed and meets our facility's acceptance criteria.`,
  (navigationId) =>
    `Our facility is prepared to accept and proceed with case ${navigationId}.`,
  (navigationId) =>
    `After reviewing case ${navigationId}, we confirm our acceptance.`,
  (navigationId) =>
    `Referral ${navigationId} falls within our scope and we agree to accept it.`,
  (navigationId) =>
    `We have the required capacity and specialty to accept case ${navigationId}.`,
  (navigationId) =>
    `Our team has reviewed referral ${navigationId} and approves its acceptance.`,
  (navigationId) =>
    `We hereby accept case ${navigationId} for treatment at our facility.`,
  (navigationId) =>
    `Case ${navigationId} is approved for acceptance following our internal review.`,
];

// https://weslah.seha.sa/facility-referrals/view/13466

/**
 * Logs an error, best-effort saves a failure screenshot/HTML (when a page
 * is available yet), and best-effort notifies Telegram - one place for all
 * of this file's failure branches instead of repeating the three calls at
 * each one (same shape as openNafathLoginPortal.mjs's reportFailure).
 *
 * @param {import("puppeteer").Page | null | undefined} page
 * @param {(message: string) => Promise<any>} [sendTelegramMessage]
 * @param {string} label - Short slug for the captured artifact file names.
 * @param {string} consoleMessage - Already includes its own "❌ " prefix.
 * @returns {Promise<void>}
 */
const reportFailure = async (
  page,
  sendTelegramMessage,
  label,
  consoleMessage,
) => {
  createConsoleMessage("error", consoleMessage, "handleSubmitReferral");

  await Promise.allSettled([
    page ? captureFailureArtifacts(page, label) : Promise.resolve(),
    sendTelegramMessage?.(
      `⚠️ *handleSubmitReferral failed:* ${consoleMessage}`,
    ),
  ]);
};

/**
 * Best-effort fills Wasla's Admission Details modal (only shown for
 * Inpatient referrals, see buildAdmissionDetails.mjs) with the same
 * fabricated values the direct-API path would have sent - never clicks
 * Confirm itself, since the date pickers' exact interaction mechanics and
 * the department Autocomplete's exact filtering behavior aren't fully
 * confirmed from source (see buildAdmissionDetails.mjs's own docblock for
 * what is/isn't). Returns which fields were successfully filled, so the
 * operator can see at a glance what still needs checking before they
 * review/confirm manually.
 *
 * @param {object} params
 * @param {import("puppeteer").Page} params.page
 * @param {import("puppeteer").ElementHandle} params.modalHandle
 * @param {ReturnType<typeof import("./buildAdmissionDetails.mjs").default>} params.admissionDetails
 * @param {string} [params.departmentFilterText] - The specialty's name
 *   (e.g. "Radiology") - typed into the department Autocomplete to filter
 *   it (confirmed to be a MUI Autocomplete, which filters/selects by
 *   option label, not a plain value set), since that's a name, not the
 *   numeric departmentId admissionDetails itself carries.
 * @returns {Promise<Record<string, boolean>>}
 */
const fillInpatientAdmissionDetailsModal = async ({
  page,
  modalHandle,
  admissionDetails,
  departmentFilterText,
  notes,
  letterFilePath,
  referralId,
}) => {
  const results = {};

  const fillTextField = async (name, value) => {
    try {
      const handle = await modalHandle.waitForSelector(
        `input[name="${name}"]`,
        { timeout: 5_000 },
      );
      await handle.click({ clickCount: 3 });
      await handle.type(String(value));
      results[name] = true;
    } catch {
      results[name] = false;
    }
  };

  await fillTextField("patientFileNumber", admissionDetails.patientFileNumber);
  await fillTextField("roomNumber", admissionDetails.roomNumber);
  await fillTextField("bedNumber", admissionDetails.bedNumber);
  await fillTextField(
    "transportationScheduleDate",
    admissionDetails.transportationScheduleDate,
  );
  await fillTextField("startDate", admissionDetails.startDate);
  try {
    const notesInput = await modalHandle.waitForSelector(
      MODAL_TEXTAREA_SELECTOR,
      {
        timeout: MODAL_TIMEOUT_MS,
      },
    );
    await notesInput.click({ clickCount: 3 });
    await notesInput.type(notes);
    results.notes = true;
  } catch {
    results.notes = false;
  }
  try {
    const fileInput = await modalHandle.waitForSelector(
      MODAL_FILE_INPUT_SELECTOR,
      {
        timeout: MODAL_TIMEOUT_MS,
      },
    );
    const uploadResponse = page
      .waitForResponse(
        (response) =>
          response.url().split("?")[0] === API_URLS.UPLOAD_ATTACHMENT &&
          response.request().method() === "POST" &&
          response.ok(),
        { timeout: 20_000 },
      )
      .then((response) => response.json())
      .catch(() => null);
    await fileInput.uploadFile(letterFilePath);
    const uploaded = await uploadResponse;
    results.attachment = uploaded?.id != null;
    if (results.attachment)
      updatePatients({ referralId, caseAttachmentId: String(uploaded.id) });
  } catch {
    results.attachment = false;
  }

  try {
    const departmentInput = await modalHandle.waitForSelector(
      `input[name="department"]`,
      { timeout: 5_000 },
    );
    await departmentInput.click();
    await departmentInput.type(departmentFilterText || "");

    // Confirmed from FormTextInput-28N796nx.js's bundled useAutocomplete
    // hook: options render with role="option".
    const optionHandle = await page
      .waitForSelector('[role="option"]', { timeout: 5_000 })
      .catch(() => null);

    if (optionHandle) {
      await optionHandle.click();
      results.department = true;
    } else {
      results.department = false;
    }
  } catch {
    results.department = false;
  }

  return results;
};

/**
 * Notifies the shared/admin watcher chat the moment a case is actually
 * accepted (not just scheduled) - same watcher pattern as
 * loginWithNafathCredentials.mjs/checkReferralSelectedStatus.mjs, but
 * fired right here instead of waiting for the later claim-status
 * resolution, since that can take a while and the watcher chat wants to
 * know (and be able to withdraw) as soon as the acceptance itself lands.
 * Best-effort - a notify failure shouldn't be treated as the acceptance
 * itself failing.
 *
 * @param {object} params
 * @param {(message: string, files?: any[], targetReferralIdForButtons?: string, overrideChatId?: string, skipOnlineCheckCreation?: boolean, extraReplyMarkup?: object) => Promise<any>} params.sendTelegramMessage
 * @param {string} params.referralId
 * @param {string} params.navigationId
 * @param {string} [params.patientName]
 * @param {string} [params.patientNationalId]
 * @returns {Promise<void>}
 */
const notifyWatcherOfAcceptance = async ({
  sendTelegramMessage,
  navigationId,
  referralId,
  patientName,
  patientNationalId,
  competitionPatient,
  sendToUser = false,
}) => {
  const { VERIFICATION_CODE_WATCHER_CHAT_ID } = process.env;

  const watcherMessage =
    `✅ *JUST Accepted Case At* \`${getOrgLabel()}\`\n` +
    `────────────────────────\n` +
    `🔢 *ID:* \`${navigationId}\`\n` +
    `🔢 *Referral ID:* \`${referralId}\`\n` +
    `👤 *Patient:* \`${patientName}\`\n` +
    `🪪 *National ID:* \`${patientNationalId}\`\n` +
    formatWatcherCompetition(competitionPatient);

  const withdrawButtonMarkup = {
    inline_keyboard: [
      [{ text: "🚫 Withdraw", callback_data: `withdraw_${referralId}` }],
    ],
  };

  if (sendToUser) await sendTelegramMessage?.(watcherMessage);
  if (VERIFICATION_CODE_WATCHER_CHAT_ID)
    await sendTelegramMessage?.(
      watcherMessage,
      [],
      undefined,
      VERIFICATION_CODE_WATCHER_CHAT_ID,
      true,
      withdrawButtonMarkup,
    ).catch(() => {});
};

/** Runs after timed action attempts; failure never blocks outcome tracking. */
const loadSubmissionCompetition = async (page, patient) => {
  try {
    const current = getPatient(patient.referralId) || patient;
    const result = await collectCaseCompetition(page, current);
    if (!result.success) {
      createConsoleMessage(
        "warn",
        result.error,
        "Post-submit competition read",
      );
    }
    return (
      getPatient(patient.referralId) ||
      (result.success ? { ...current, ...result } : current)
    );
  } catch (error) {
    createConsoleMessage("warn", error.message, "Post-submit competition read");
    return patient;
  }
};

/**
 * Reads a numeric env var with a safe fallback - guards against both a
 * missing/empty value (`Number("")` is `0`, not `NaN`, so an empty string
 * can't silently become a real "0" override) and a non-numeric value.
 *
 * @param {string} name - Env var name, e.g. "BOUNDARY_SAFETY_MARGIN_MS".
 * @param {number} defaultValue - Used when the env var is unset, empty, or
 *   not a finite number.
 * @returns {number}
 */
const getEnvVariableAsNumber = (name, defaultValue) => {
  const value = process.env[name];

  const _value = value ? Number(value) : defaultValue;

  return Number.isFinite(_value) ? _value : defaultValue;
};

const handleSubmitReferral = (options) => async (patient) => {
  const {
    actionType,
    sendTelegramMessage,
    // continueFetchingPatientsIfPaused,
    browser,
    patientsStore,
  } = options;

  const {
    navigationId,
    referralId,
    broadcastedAt,
    facilityReviewWindowMinutes,
    detailsClockSample,
    receiptTiming,
    referralWindowSnapshot,
    referralEndTimestamp,
    randomFileName,
    patientName,
    subReferralTypeId,
    subReferralTypeName,
    specialtyId,
    specialty,
    requestedBedType,
    patientNationalId,
  } = patient;

  if (!navigationId) {
    await reportFailure(
      null,
      sendTelegramMessage,
      "submit-referral-missing-navigation-id",
      `❌ Missing navigationId for referralId=${referralId} actionType=[${actionType}], cannot open referral view.`,
    );
    return;
  }

  const SLEEP_BEFORE_ACCEPT_OR_REJECT_MS = getEnvVariableAsNumber(
    "SLEEP_BEFORE_ACCEPT_OR_REJECT_MS",
    0,
  );

  const SLEEP_WHEN_ACCEPT_OR_REJECT_RETRY_MS = getEnvVariableAsNumber(
    "SLEEP_WHEN_ACCEPT_OR_REJECT_RETRY_MS",
    40,
  );

  const MAX_ACTION_RETRIES = getEnvVariableAsNumber("MAX_ACTION_RETRIES", 20);

  const firstAttemptBufferMs = getEnvVariableAsNumber(
    "FIRST_ATTEMPT_BUFFER_MS",
    60,
  );

  const isAcceptanceAction = actionType === ACCEPT;

  const url = `${WASLA_REFERRAL_VIEW_URL}/${navigationId}`;

  let page;

  try {
    page = await browser.newPage();

    // Land on a neutral, lightweight page first (in parallel with the
    // letter-file read) - mainly so the browser/tab is already warmed up
    // (DNS/TLS/connection) before the real case-page navigation below,
    // which is the one that matters for timing.
    const [, { filePath: letterFilePath, fileData: letterFileBase64 }] =
      await Promise.all([
        page.goto(url, {
          waitUntil: "domcontentloaded",
          timeout: NAVIGATION_TIMEOUT_MS,
        }),
        getCurrentActionLetterFile(
          referralId,
          isAcceptanceAction ? actionType : REJECT,
        ),
      ]);

    // shortcut: injects a plain MUI-styled button rather than finding a
    // real one to click - good enough to give ghost-cursor a visible,
    // human-like scroll+click before the upload; upgrade if Wasla ever
    // flags file inputs attached with no preceding on-page interaction.
    await page.evaluate(() => {
      const btn = document.createElement("button");
      btn.id = "gh-upload-trigger";
      btn.textContent = "Upload";
      btn.style.cssText =
        "background-color:#1976d2;color:#fff;border:none;border-radius:4px;" +
        "padding:6px 16px;font-family:Roboto,Arial,sans-serif;font-weight:500;" +
        "text-transform:uppercase;cursor:pointer;display:block;margin:40px auto;";
      // Plain document flow (no position:fixed) - appended as the last
      // element in body, below the fold on this page, so ghost-cursor
      // actually has to scroll to reach it instead of clicking in place.
      document.body.appendChild(btn);
    });

    const cursor = new GhostCursor(page, {
      performRandomMoves: false,
      visible: false,
      start: { x: 180 + Math.random(), y: 250 + Math.random() * 30 },
    });

    const description = isAcceptanceAction
      ? randomArrayItem(ACCEPTANCE_DESCRIPTION_TEMPLATES)(navigationId)
      : undefined;

    const targetButtonTexts = isAcceptanceAction
      ? ACCEPT_BUTTON_TEXTS
      : REJECT_BUTTON_TEXTS;

    const readinessStartedAtMs = Date.now();
    const readinessStartedMonotonicMs = performance.now();
    let readinessSucceeded = false;
    let referralReadyTiming;
    try {
      await waitForWaslaReferralReady(page, targetButtonTexts, 2_000);
      readinessSucceeded = true;
    } finally {
      referralReadyTiming = {
        startedAtMs: readinessStartedAtMs,
        finishedAtMs: Date.now(),
        durationMs: Math.round(performance.now() - readinessStartedMonotonicMs),
        success: readinessSucceeded,
      };
      await writeReferralTimingEvent({
        type: "page-readiness",
        referralId,
        navigationId,
        actionType,
        ...referralReadyTiming,
      });
    }

    // The 🔴 "inpatient, needs manual review" heads-up now lives on the
    // initial new-case notification (formatPatientToTelegramOrWA.mjs), so
    // the operator already knows before we ever get here.
    const isInpatientReferral =
      isAcceptanceAction &&
      (String(subReferralTypeId) === INPATIENT_SUB_REFERRAL_TYPE_ID ||
        (subReferralTypeName || "").toLowerCase() === "inpatient");

    // The direct-API attempt still runs for Inpatient (same as any other
    // accept) - only the UI fallback differs for it (see below): it fills
    // the Admission Details modal's fields but deliberately stops short of
    // clicking Confirm, since the exact interaction mechanics for its date
    // pickers/department Autocomplete aren't fully confirmed from source
    // (see buildAdmissionDetails.mjs's own docblock).
    const admissionDetails = isInpatientReferral
      ? buildAdmissionDetails({
          patientNationalId,
          specialtyId,
          requestedBedType,
        })
      : null;

    const currentLeftTime = referralEndTimestamp - Date.now();

    const preUploadLeadMs = 1650 + Math.round(Math.random() * 300 - 150);
    const shouldSleep = currentLeftTime > preUploadLeadMs;

    if (shouldSleep) {
      const timeToSleep = currentLeftTime - preUploadLeadMs;
      const timeToSleepMs = (timeToSleep * 3.5) / 4;
      await sleep(timeToSleepMs);
    }

    const moveDelay = shouldSleep ? 30 : 0;

    const movementStartTime = Date.now();
    if (Math.random() < 0.58 && !isAcceptanceAction) {
      if (Math.random() < 0.35) {
        await cursor
          .moveTo(
            {
              x: 120 + Math.random() + 50,
              y: 180 + Math.random() * 80,
            },
            { moveDelay: moveDelay },
          )
          .catch(() => {});
      }
      await cursor
        .click("#gh-upload-trigger", {
          moveDelay: moveDelay,
          scrollSpeed: shouldSleep ? 90 : 100,
        })
        .catch(() => {});
    } else {
      // scroll() requires a delta - called with none it threw every time
      // (silently, via the catch below), making this branch a no-op.

      if (Math.random() < 0.85) {
        await cursor
          .scroll({ y: 200 + Math.random() * 200, x: 150 + Math.random() })
          .catch(() => {});
      } else {
        await cursor
          .moveTo(
            {
              x: 180 + Math.random(),
              y: 250 + Math.random() * 40,
            },
            { moveDelay: moveDelay },
          )
          .catch(() => {});
      }
    }

    await page
      .evaluate(() => document.getElementById("gh-upload-trigger")?.remove())
      .catch(() => {});

    // A reject isn't racing anything (unlike accept, which competes against
    // other facilities for the case), so there's no timing-precision cost
    // to adding extra, more generous human-like delay here.
    if (!isAcceptanceAction) {
      await sleep(1400 + Math.random() * 400);
      await cursor
        .moveTo({
          x: 180 + Math.random(),
          y: 250 + Math.random() * 30,
        })
        .catch(() => {});
    }

    const uploadStartTime = Date.now();
    const uploadResult = await submitWaslaAction({
      page,
      fileBase64: letterFileBase64,
      fileName: randomFileName,
      postStepLabel: "accept-json",
    });

    const uploadDurationMs = Date.now() - uploadStartTime;
    if (uploadResult.attachmentId != null) {
      updatePatients({
        referralId,
        caseAttachmentId: String(uploadResult.attachmentId),
      });
    }

    const leftoverBufferForFirstRetryMs = Math.max(
      0,
      SLEEP_BEFORE_ACCEPT_OR_REJECT_MS - firstAttemptBufferMs,
    );

    const submissionContext = {
      referralId,
      navigationId,
      actionType,
      broadcastedAtRaw: broadcastedAt ?? null,
      broadcastedAtParsedMs: broadcastedAt
        ? new Date(broadcastedAt).getTime()
        : null,
      parserTimeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      facilityReviewWindowMinutes: facilityReviewWindowMinutes ?? null,
      referralEndTimestamp,
      deadlineSource:
        "broadcastedAt parsed in runtime timezone + review minutes",
      detailsClockSample: detailsClockSample ?? null,
      receiptTiming: receiptTiming ?? null,
      referralWindowSnapshot: referralWindowSnapshot ?? null,
      referralReadyTiming,
      preUpload: {
        success: uploadResult.success,
        uploadIgnored: Boolean(uploadResult.uploadIgnored),
        httpStatus: uploadResult.httpStatus ?? null,
        errorType: uploadResult.errorType ?? null,
        error: uploadResult.error ?? null,
        responseHeaders: uploadResult.responseHeaders ?? null,
        request: uploadResult.uploadRequest ?? null,
        durationMs: uploadDurationMs,
        configuredLeadMs: preUploadLeadMs,
        startedAtMs: uploadStartTime,
        finishedAtMs: uploadStartTime + uploadDurationMs,
        startedAfterEndMs: uploadStartTime - referralEndTimestamp,
        finishedAfterEndMs:
          uploadStartTime + uploadDurationMs - referralEndTimestamp,
      },
      firstAttemptBufferMs,
      leftoverBufferForFirstRetryMs,
      configuredRetryGapMs: SLEEP_WHEN_ACCEPT_OR_REJECT_RETRY_MS,
      retryTimingPolicy: "absolute-first-retry-target",
    };

    const diffMs = referralEndTimestamp - Date.now();
    const sleepMS = diffMs + (firstAttemptBufferMs || 0);

    if (sleepMS > 0) {
      await sleep(sleepMS);
    }

    let apiResult =
      uploadResult.errorType === "cloudflare-block" ? uploadResult : null;

    const realFireDelayFromBoundaryMs = Date.now() - referralEndTimestamp;

    const attempts = [];
    const actionTimeStart = Date.now();

    // One request at a time. Earlier burst tests did not establish whether
    // the backend cancels older requests, so keep sequential submission.
    let attemptCount = 0;

    while (
      attemptCount < MAX_ACTION_RETRIES &&
      uploadResult.errorType !== "cloudflare-block"
    ) {
      attemptCount++;
      const attemptStart = Date.now();

      apiResult = await submitWaslaReferralViaApi({
        page,
        navigationId,
        notes: description,
        rejectionReasonId: REJECTION_REASON_ID,
        isAccept: isAcceptanceAction,
        admissionDetails,
        attachmentId: uploadResult.attachmentId,
        // we pass these incase the letter file was not pre-uploaded, so we can upload it now
        fileBase64: letterFileBase64,
        fileName: randomFileName,
      });

      const attemptFinishedAtMs = Date.now();
      if (
        apiResult.attachmentId != null &&
        apiResult.attachmentId !== uploadResult.attachmentId
      ) {
        updatePatients({
          referralId,
          caseAttachmentId: String(apiResult.attachmentId),
        });
      }
      attempts.push({
        startedAtMs: attemptStart,
        startedAfterEndMs: attemptStart - referralEndTimestamp,
        finishedAtMs: attemptFinishedAtMs,
        durationMs: attemptFinishedAtMs - attemptStart,
        resultCategory: classifySubmissionResult(apiResult),
        requestClockSample: describeClockSample(apiResult.requestClockSample),
        // Same local-vs-server clock diff submitWaslaAction.mjs now
        // captures on every accept-json response's own Date header - kept
        // per-attempt (not just on the final one) so it can be compared
        // across every attempt in a run, not only whichever happens to be
        // last.
        clockDiffMs: apiResult.responseHeaders?.diffMs ?? null,
        outcome: apiResult.success
          ? "success"
          : isRetriableFailure(apiResult.error)
            ? `retriable (${apiResult.error})`
            : (apiResult.error ?? "unknown error"),
      });

      if (apiResult.success || !isRetriableFailure(apiResult.error)) {
        break;
      }

      if (attemptCount < MAX_ACTION_RETRIES) {
        const amountOfSleep = getReferralRetryDelay({
          attemptCount,
          nowMs: Date.now(),
          referralEndTimestamp,
          totalBufferMs: SLEEP_BEFORE_ACCEPT_OR_REJECT_MS,
          retryGapMs: SLEEP_WHEN_ACCEPT_OR_REJECT_RETRY_MS,
        });
        attempts[attempts.length - 1].scheduledRetryDelayMs = amountOfSleep;

        if (amountOfSleep > 0) {
          await sleep(amountOfSleep);
        }
      }
    }

    const actionTimeMs = Date.now() - actionTimeStart;

    const attemptsMade = attemptCount;
    let competitionPatient;

    // Outcome tracking must not depend on optional diagnostics/notifications.
    if (apiResult?.success) {
      patientsStore.addNonClaimableCase(referralId, referralEndTimestamp);
    }

    // Disk writes happen after all attempts, never between timed retries.
    await writeReferralTimingEvent({
      type: "submission",
      ...submissionContext,
      attempts,
      boundaryDiffMs: diffMs,
      sleepMs: sleepMS,
      actualFirstAttemptAfterEndMs: realFireDelayFromBoundaryMs,
      actionDurationMs: actionTimeMs,
      attemptsMade,
      configuredPreFireBufferMs: SLEEP_BEFORE_ACCEPT_OR_REJECT_MS,
      uploadTiming: uploadResult.uploadTiming ?? null,
      requestTiming: apiResult?.timing ?? null,
      finalError: apiResult?.error ?? null,
      responseMessage: apiResult?.data?.message ?? null,
      responseHeaders: Object.fromEntries(
        Object.entries(apiResult?.responseHeaders || {}).filter(
          ([key]) =>
            /^cf-/i.test(key) ||
            [
              "date",
              "server",
              "x-request-id",
              "x-router-id",
              "content-type",
              "content-length",
              "content-encoding",
              "cache-control",
              "diffms",
            ].includes(key.toLowerCase()),
        ),
      ),
      apiSuccess: Boolean(apiResult?.success),
      claimed: null,
    });

    if (apiResult) {
      // Never postpone UI fallback for a failed submit just to read rankings.
      competitionPatient = apiResult.success
        ? await loadSubmissionCompetition(page, patient)
        : getPatient(referralId) || patient;
      showPageSnackbar(page, {
        message: apiResult.success
          ? `${isAcceptanceAction ? "Accepted" : "Rejected"} via direct API`
          : apiResult.errorType === "cloudflare-block"
            ? "Cloudflare blocked the request — automatic submission stopped; manual review required"
            : `Direct API ${isAcceptanceAction ? "accept" : "reject"} failed - falling back to UI`,
        severity: apiResult.success ? "success" : "error",
      });

      const directMessage = buildDirectApiTelegramMessage({
        isAcceptanceAction,
        referralId,
        navigationId,
        apiResult,
        attemptsMade,
        competitionPatient,
        patientName,
        patientNationalId,
        uploadDurationMs,
        sleepMS,
        preUploadInteractionMs: uploadStartTime - movementStartTime,
      });
      await sendTelegramMessage?.(directMessage);
      // Acceptance has its watcher notification below. Rejection sends
      // this concise report, with the same facility times, to both chats.
      if (
        (!isAcceptanceAction || apiResult.errorType === "cloudflare-block") &&
        process.env.VERIFICATION_CODE_WATCHER_CHAT_ID
      ) {
        await sendTelegramMessage?.(
          directMessage,
          [],
          undefined,
          process.env.VERIFICATION_CODE_WATCHER_CHAT_ID,
          true,
        );
      }
    }

    if (apiResult?.errorType === "cloudflare-block") {
      await captureFailureArtifacts(page, "submit-referral-cloudflare-blocked");
      return;
    }

    if (apiResult?.success) {
      createConsoleMessage(
        "success",
        `✅ [${actionType}] ${isAcceptanceAction ? "Accepted" : "Rejected"} via direct API for referralId=${referralId} (navigationId=${navigationId})`,
        "handleSubmitReferral",
      );

      if (isAcceptanceAction) {
        await notifyWatcherOfAcceptance({
          sendTelegramMessage,
          referralId,
          patientName,
          patientNationalId,
          navigationId,
          competitionPatient,
        });
      }

      // this is now supports rejection and accteptance
      await sleep(3_000);
      await closePageSafely(page);
      return;
    }

    // Only needed now, for the UI fallback below - no reason to wait on
    // this while the direct-API attempt was still running, since it was
    // never a reliable gate for firing (see this file's own history).
    // The review-badge check is paused for now - its result was never
    // consumed by anything besides its own now-removed diagnostic.
    const actionButtonHandle = await page
      .waitForFunction(
        (texts) => {
          const normalize = (text) => (text || "").replace(/\s+/g, " ").trim();

          const buttons = [...document.querySelectorAll("button")];

          const matchedButton = buttons.find((button) =>
            texts.includes(normalize(button.textContent)),
          );

          if (matchedButton) {
            matchedButton.scrollIntoView({ block: "end" });
          }

          return matchedButton && !matchedButton.disabled
            ? matchedButton
            : null;
        },
        { timeout: ACTION_BUTTON_TIMEOUT_MS },
        targetButtonTexts,
      )
      .catch(() => null);

    if (!actionButtonHandle) {
      await reportFailure(
        page,
        sendTelegramMessage,
        "submit-referral-button-not-found",
        `❌ Neither "${targetButtonTexts.join('" nor "')}" button was found for referralId=${referralId} (navigationId=${navigationId})`,
      );
      return;
    }

    try {
      await actionButtonHandle.asElement()?.click();
    } catch (error) {
      await reportFailure(
        page,
        sendTelegramMessage,
        "submit-referral-click-failed",
        `❌ Failed to click ${isAcceptanceAction ? "accept" : "reject"} button for referralId=${referralId} (navigationId=${navigationId}): ${error.message}`,
      );
      return;
    }

    const modalHandle = await page
      .waitForSelector(MODAL_SELECTOR, { timeout: MODAL_TIMEOUT_MS })
      .catch(() => null);

    if (!modalHandle) {
      await reportFailure(
        page,
        sendTelegramMessage,
        "submit-referral-modal-not-found",
        `❌ Confirmation popup never appeared for referralId=${referralId} (navigationId=${navigationId})`,
      );
      return;
    }

    // Inpatient's UI fallback is a different modal entirely (Admission
    // Details, not the plain notes/file one below) - best-effort fill it
    // and stop, rather than click Confirm ourselves (see
    // fillInpatientAdmissionDetailsModal's own docblock for why).
    if (isInpatientReferral) {
      const fillResults = await fillInpatientAdmissionDetailsModal({
        page,
        modalHandle,
        admissionDetails,
        departmentFilterText: specialty,
        notes: description,
        letterFilePath,
        referralId,
      });

      // Captures whatever actually landed in the form (or didn't), for
      // inspecting/building real automation against later.
      await page
        .content()
        .then((html) =>
          writeFile(
            `${htmlFilesPath}/Inpatient-${referralId}.html`,
            html,
            "utf8",
          ),
        )
        .catch((error) => {
          createConsoleMessage(
            "warn",
            error?.message || error,
            `⚠️ saving page HTML for inpatient referralId=${referralId} failed`,
          );
        });

      const fieldsSummary = Object.entries(fillResults)
        .map(([field, ok]) => `${ok ? "✅" : "❌"} ${field}`)
        .join("\n");

      const admissionDetailsLine = admissionDetails
        ? `🏥 Admission Details: departmentId=\`${admissionDetails.departmentId}\`, room=\`${admissionDetails.roomNumber}\`, bed=\`${admissionDetails.bedNumber}\`, fileNumber=\`${admissionDetails.patientFileNumber}\`, startDate=\`${admissionDetails.startDate}\`\n\n`
        : "";

      await sendTelegramMessage?.(
        `🔴 *Inpatient Admission Details - Review Before Confirming*\n` +
          `────────────────────────\n` +
          `🔢 *Referral ID:* \`${referralId}\`\n` +
          `🔢 *ID:* \`${navigationId}\`\n` +
          (patientName ? `👤 *Patient:* ${patientName}\n` : "") +
          admissionDetailsLine +
          `\nBest-effort filled (not confirmed):\n${fieldsSummary}\n\n` +
          `⚠️ Please open the case and verify/confirm manually - this bot does not click Confirm for Inpatient referrals.`,
      );

      return;
    }

    // Both fields live in the same modal for the accept case, so their
    // waits run together instead of stacking up to 2x MODAL_TIMEOUT_MS
    // sequentially. Reject's modal has no textarea at all, so that wait
    // is skipped there rather than parallelized into a guaranteed timeout.
    // Scoped to modalHandle (not page) so each only searches the modal's
    // own subtree.
    const [fileInputHandle, descriptionHandle] = await Promise.all([
      modalHandle
        .waitForSelector(MODAL_FILE_INPUT_SELECTOR, {
          timeout: MODAL_TIMEOUT_MS,
        })
        .catch(() => null),
      isAcceptanceAction
        ? modalHandle
            .waitForSelector(MODAL_TEXTAREA_SELECTOR, {
              timeout: MODAL_TIMEOUT_MS,
            })
            .catch(() => null)
        : null,
    ]);

    if (!fileInputHandle) {
      await reportFailure(
        page,
        sendTelegramMessage,
        "submit-referral-attachments-input-not-found",
        `❌ Attachments file input not found in confirmation popup for referralId=${referralId} (navigationId=${navigationId})`,
      );
      return;
    }

    if (isAcceptanceAction) {
      if (!descriptionHandle) {
        await reportFailure(
          page,
          sendTelegramMessage,
          "submit-referral-description-not-found",
          `❌ Description field not found in acceptance popup for referralId=${referralId} (navigationId=${navigationId})`,
        );
        return;
      }

      await descriptionHandle.focus();
      await page.keyboard.type(description);
    }

    if (letterFilePath) {
      const uploadedAttachment = page
        .waitForResponse(
          (response) =>
            response.url().split("?")[0] === API_URLS.UPLOAD_ATTACHMENT &&
            response.request().method() === "POST" &&
            response.ok(),
          { timeout: 20_000 },
        )
        .then((response) => response.json())
        .catch(() => null);
      try {
        await fileInputHandle.uploadFile(letterFilePath);
        const uploaded = await uploadedAttachment;
        if (uploaded?.id != null) {
          updatePatients({ referralId, caseAttachmentId: String(uploaded.id) });
        }
      } catch (error) {
        await reportFailure(
          page,
          sendTelegramMessage,
          "submit-referral-attach-failed",
          `❌ Failed to attach letter file for referralId=${referralId} (navigationId=${navigationId}): ${error.message}`,
        );
        return;
      }
    }

    createConsoleMessage(
      "success",
      `✅ [${actionType}] Filled confirmation popup for referralId=${referralId} (navigationId=${navigationId})`,
      "handleSubmitReferral",
    );

    if (!isAcceptanceAction) {
      try {
        await fillWaslaRejectionReason(page, modalHandle, REJECTION_REASON_ID);
      } catch (error) {
        await reportFailure(
          page,
          sendTelegramMessage,
          "submit-referral-rejection-reason-failed",
          `❌ Rejection reason selection failed for referralId=${referralId}: ${error.message}`,
        );
        return;
      }
    }
    {
      const confirmButtonHandle = await page
        .waitForFunction(
          (dialogEl, selector) => {
            const button = dialogEl?.querySelector(selector);
            return button && !button.disabled ? button : null;
          },
          { timeout: CONFIRM_BUTTON_TIMEOUT_MS },
          modalHandle,
          CONFIRM_BUTTON_SELECTOR,
        )
        .catch(() => null);

      if (!confirmButtonHandle) {
        await reportFailure(
          page,
          sendTelegramMessage,
          "submit-referral-confirm-not-enabled",
          `❌ Confirm button never became enabled for referralId=${referralId} (navigationId=${navigationId})`,
        );
        return;
      }

      try {
        await confirmButtonHandle.asElement()?.click();
      } catch (error) {
        await reportFailure(
          page,
          sendTelegramMessage,
          "submit-referral-confirm-click-failed",
          `❌ Failed to click Confirm for referralId=${referralId} (navigationId=${navigationId}): ${error.message}`,
        );
        return;
      }

      createConsoleMessage(
        "success",
        `✅ [${actionType}] Clicked Confirm for referralId=${referralId} (navigationId=${navigationId})`,
        "handleSubmitReferral",
      );

      // Clicking Confirm isn't proof of a recorded action. Preserve the existing
      // confirmation wait, then queue its status before optional reporting.
      await sleep(SLEEP_AFTER_CONFIRMATION_MS);
      patientsStore.addNonClaimableCase(referralId, referralEndTimestamp);
      if (isAcceptanceAction) {
        await notifyWatcherOfAcceptance({
          sendTelegramMessage,
          referralId,
          patientName,
          patientNationalId,
          navigationId,
          competitionPatient: await loadSubmissionCompetition(page, patient),
          sendToUser: true,
        });
      } else {
        const message = `✅ *Submitted rejection via UI*\nReferral ID: \`${referralId}\`\nCase ID: \`${navigationId}\``;
        await sendTelegramMessage?.(message);
        if (process.env.VERIFICATION_CODE_WATCHER_CHAT_ID) {
          await sendTelegramMessage?.(
            message,
            [],
            undefined,
            process.env.VERIFICATION_CODE_WATCHER_CHAT_ID,
            true,
          );
        }
      }

      await closePageSafely(page);
    }
  } catch (error) {
    await reportFailure(
      page,
      sendTelegramMessage,
      "submit-referral-unexpected-error",
      `❌ Failed to open referral view for referralId=${referralId} (navigationId=${navigationId}): ${error.message}`,
    );
  }
};

export default handleSubmitReferral;

// {
//     "code": 200,
//     "message": "Success",
//     "data": [
//         {
//             "id": 27,
//             "nameAr": "إدمان",
//             "nameEn": "Addiction",
//             "description": null,
//             "isOther": false,
//             "name": "Addiction"
//         },
//         {
//             "id": 7,
//             "nameAr": "التخدير",
//             "nameEn": "Anesthesia",
//             "description": null,
//             "isOther": false,
//             "name": "Anesthesia"
//         },
//         {
//             "id": 22,
//             "nameAr": "طب وجراحة القلب",
//             "nameEn": "Cardiology",
//             "description": null,
//             "isOther": false,
//             "name": "Cardiology"
//         },
//         {
//             "id": 15,
//             "nameAr": "المختبرات السريرية",
//             "nameEn": "Clinical Laboratories",
//             "description": null,
//             "isOther": false,
//             "name": "Clinical Laboratories"
//         },
//         {
//             "id": 11,
//             "nameAr": "الصيدلة السريرية",
//             "nameEn": "Clinical Pharmacy",
//             "description": null,
//             "isOther": false,
//             "name": "Clinical Pharmacy"
//         },
//         {
//             "id": 18,
//             "nameAr": "سموم إكلينيكية",
//             "nameEn": "Clinical Toxicology",
//             "description": null,
//             "isOther": false,
//             "name": "Clinical Toxicology"
//         },
//         {
//             "id": 20,
//             "nameAr": "طب الفم والأسنان",
//             "nameEn": "Dentistry",
//             "description": null,
//             "isOther": false,
//             "name": "Dentistry"
//         },
//         {
//             "id": 3,
//             "nameAr": "الأمراض الجلدية",
//             "nameEn": "Dermatology",
//             "description": null,
//             "isOther": false,
//             "name": "Dermatology"
//         },
//         {
//             "id": 16,
//             "nameAr": "جراحة الأذن والأنف والحنجرة",
//             "nameEn": "Ear, Nose, and Throat Surgery",
//             "description": null,
//             "isOther": false,
//             "name": "Ear, Nose, and Throat Surgery"
//         },
//         {
//             "id": 5,
//             "nameAr": "الايكمو",
//             "nameEn": "ECMO",
//             "description": null,
//             "isOther": false,
//             "name": "ECMO"
//         },
//         {
//             "id": 10,
//             "nameAr": "الرعاية الممتدة",
//             "nameEn": "Extended Care",
//             "description": null,
//             "isOther": false,
//             "name": "Extended Care"
//         },
//         {
//             "id": 26,
//             "nameAr": "طب شرعي",
//             "nameEn": "Forensic Medicine",
//             "description": null,
//             "isOther": false,
//             "name": "Forensic Medicine"
//         },
//         {
//             "id": 24,
//             "nameAr": "رعاية منزلية",
//             "nameEn": "Home Care",
//             "description": null,
//             "isOther": false,
//             "name": "Home Care"
//         },
//         {
//             "id": 13,
//             "nameAr": "الطب المنزلي",
//             "nameEn": "Home Medicine",
//             "description": null,
//             "isOther": false,
//             "name": "Home Medicine"
//         },
//         {
//             "id": 12,
//             "nameAr": "الطب الباطني",
//             "nameEn": "Internal Medicine",
//             "description": null,
//             "isOther": false,
//             "name": "Internal Medicine"
//         },
//         {
//             "id": 6,
//             "nameAr": "التأهيل الطبي",
//             "nameEn": "Medical Rehabilitation",
//             "description": null,
//             "isOther": false,
//             "name": "Medical Rehabilitation"
//         },
//         {
//             "id": 1,
//             "nameAr": "أمراض النساء والولادة",
//             "nameEn": "Obstetrics and Gynecology",
//             "description": null,
//             "isOther": false,
//             "name": "Obstetrics and Gynecology"
//         },
//         {
//             "id": 4,
//             "nameAr": "الأورام",
//             "nameEn": "Oncology",
//             "description": null,
//             "isOther": false,
//             "name": "Oncology"
//         },
//         {
//             "id": 21,
//             "nameAr": "طب وجراحة العيون",
//             "nameEn": "Ophthalmology",
//             "description": null,
//             "isOther": false,
//             "name": "Ophthalmology"
//         },
//         {
//             "id": 17,
//             "nameAr": "زراعة الأعضاء",
//             "nameEn": "Organ Transplantation",
//             "description": null,
//             "isOther": false,
//             "name": "Organ Transplantation"
//         },
//         {
//             "id": 9,
//             "nameAr": "الرعاية التلطيفية",
//             "nameEn": "Palliative Care",
//             "description": null,
//             "isOther": false,
//             "name": "Palliative Care"
//         },
//         {
//             "id": 19,
//             "nameAr": "طب الأطفال",
//             "nameEn": "Pediatrics",
//             "description": null,
//             "isOther": false,
//             "name": "Pediatrics"
//         },
//         {
//             "id": 14,
//             "nameAr": "الطب النفسي",
//             "nameEn": "Psychiatry",
//             "description": null,
//             "isOther": false,
//             "name": "Psychiatry"
//         },
//         {
//             "id": 23,
//             "nameAr": "الأشعة",
//             "nameEn": "Radiology",
//             "description": null,
//             "isOther": false,
//             "name": "Radiology"
//         },
//         {
//             "id": 8,
//             "nameAr": "الجراحة",
//             "nameEn": "Surgery",
//             "description": null,
//             "isOther": false,
//             "name": "Surgery"
//         },
//         {
//             "id": 2,
//             "nameAr": "الإصابات المتعددة",
//             "nameEn": "Trauma Surgery",
//             "description": null,
//             "isOther": false,
//             "name": "Trauma Surgery"
//         },
//         {
//             "id": 25,
//             "nameAr": "أخرى",
//             "nameEn": "Other",
//             "description": null,
//             "isOther": true,
//             "name": "Other"
//         }
//     ]
// }

// results\special-bundle\7I8XAGEYJXQS108-1792011233720\c6fe3c69fd1e-ViewReferralCasePage-DGnWWJG5.js
// {
//     id: "actions",
//     header: e("actions"),
//     cell: ({ row: C }) => {
//     const x = C.original;

//     const canDecide =
//         !x.isDeleted && d && a &&
//         Number(x.status) === F.WaitingAcceptance &&
//         (c === k.PendingAcceptance || c === k.PendingEscalation);

//     const canReassign =
//         !x.isDeleted && d && a &&
//         Number(x.status) === F.AnotherFacilityApproved &&
//         c !== k.Closed && c !== k.ConfirmedArrival && f;

//     const T = m
//         ? e("awaitingAcceptanceWindowTooltip")
//         : e("tpaApprovalLockedNote", {
//             reviewMinutes: u,
//             acceptanceMinutes: p
//         });

//     return t.jsxs("div", {
//         className: "flex gap-2",
//         children: [
//             t.jsx(bt, {
//                 facility: x,
//                 isLocked: false,
//                 lockedTooltip: canDecide ? T : "",
//                 approveLabel: e("approve"),
//                 rejectLabel: e("reject"),
//                 onApprove: r,
//                 onReject: n
//             }),
//             t.jsx(P, {
//                 variant: "contained",
//                 size: "small",
//                 color: "success",
//                 disabled: !canReassign,
//                 startIcon: t.jsx(Fs, {
//                     size: 14
//                 }),
//                 sx: {
//                     boxShadow: "none",
//                     minWidth: "auto",
//                     fontWeight: "600",
//                     padding: "4px 12px"
//                 },
//                 onClick: () => o(x),
//                 children: e("reassignReferral")
//             })
//         ]
//     });
// }
