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
import createConsoleMessage from "./createConsoleMessage.mjs";
import getCurrentActionLetterFile from "./getCurrentActionLetterFile.mjs";
import captureFailureArtifacts from "./captureFailureArtifacts.mjs";
import randomArrayItem from "./randomArrayItem.mjs";
import sleep from "./sleep.mjs";
import submitWaslaReferralViaApi from "./submitWaslaReferralViaApi.mjs";
import submitWaslaAction from "./submitWaslaAction.mjs";
import buildAdmissionDetails from "./buildAdmissionDetails.mjs";
import closePageSafely from "./closePageSafely.mjs";
import showPageSnackbar from "./showPageSnackbar.mjs";
import getOrgLabel from "./getOrgLabel.mjs";
import {
  USER_ACTION_TYPES,
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

// Confirmed live (html/details/details-page-with-review-timer.html): the
// "In Review - Ends in M:SS" badge has no id/data-testid either - matched
// by this text substring the same way the accept/reject buttons are. Used
// as a second, independent "is the review window over" signal to compare
// against the button's own disabled state - they're driven by separate
// code in Wasla's bundle and aren't guaranteed to resolve at the exact
// same instant.
const REVIEW_BADGE_TEXT_MARKER = "In Review";

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
// dialog - a class, not text, so it works for either language. It starts
// disabled (disabled="" in the real markup) until the required fields
// validate, so this waits for that rather than a fixed delay.
const CONFIRM_BUTTON_SELECTOR = "button.MuiButton-containedPrimary";
const CONFIRM_BUTTON_TIMEOUT_MS = 15_000;
const SLEEP_AFTER_CONFIRMATION_MS = 15_000;

// Lookup id from the portal's own rejection-reasons list (scripts/
// reject-case.js) - "Unavailability of Required Bed" / "عدم توفر السرير
// المطلوب". Always this one reason, per instruction.
const REJECTION_REASON_ID = 18;

const MAX_ACTION_RETRIES = 10;

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
 * Builds the Telegram message reporting the direct-API accept/reject
 * attempt's outcome - shared by the success and failure branches so the
 * header/footer structure isn't hand-duplicated between them. Operators
 * read this message too, not just whoever's debugging timing, so every
 * line is a plain-English label - the numbers themselves are all still
 * here, just not under their camelCase variable names.
 *
 * @param {{
 *   isAcceptanceAction: boolean,
 *   referralId: string,
 *   navigationId: string,
 *   apiResult: Awaited<ReturnType<typeof import("./submitWaslaReferralViaApi.mjs").default>>,
 *   preUploadResult: Awaited<ReturnType<typeof import("./submitWaslaAction.mjs").default>>,
 *   uploadDurationMs: number,
 *   diffMs: number,
 *   sleepMs: number,
 *   sleepBeforeAcceptOrRejectMs: number,
 *   preFireRaceWinner: "timer" | "button",
 *   preFireRaceDurationMs: number,
 *   realFireDelayFromBoundaryMs: number,
 *   buttonEnabledAfterMs: number | null,
 *   reviewBadgeGoneAfterMs: number | null,
 *   actionTimeMs: number,
 *   attemptDurationsMs: number[],
 *   attemptsMade: number,
 *   admissionDetails: object | null,
 * }} params
 * @returns {string}
 */
const buildDirectApiTelegramMessage = ({
  isAcceptanceAction,
  referralId,
  navigationId,
  apiResult,
  preUploadResult,
  uploadDurationMs,
  diffMs,
  sleepMs,
  sleepBeforeAcceptOrRejectMs,
  preFireRaceWinner,
  preFireRaceDurationMs,
  realFireDelayFromBoundaryMs,
  buttonEnabledAfterMs,
  reviewBadgeGoneAfterMs,
  actionTimeMs,
  attemptDurationsMs,
  attemptsMade,
  admissionDetails,
}) => {
  const { success, timing, responseHeaders } = apiResult;

  const title = success
    ? `*${isAcceptanceAction ? "Accepted" : "Rejected"} via direct API*`
    : `*Direct API ${isAcceptanceAction ? "accept" : "reject"} attempt failed*`;

  // Plain language either way - no raw step/attachmentId/url fields even
  // on failure. apiResult.error already carries Wasla's own error text,
  // which is the part that actually matters here.
  const detailLine = success
    ? `Message: ${apiResult.data?.message ?? "(no message)"}`
    : `Message: ${apiResult.error ?? "(no further detail)"}`;

  const preUploadLine = preUploadResult?.success
    ? `Letter attached in advance: ✅ Yes (took ${uploadDurationMs}ms)`
    : `Letter attached in advance: ❌ No, retried during submission (took ${uploadDurationMs}ms)`;

  // The only retriable failure is "too early" (the review window hadn't
  // elapsed yet per Wasla's own check) - the count is still worth knowing
  // at a glance, but the raw underlying error text isn't, since that's the
  // one and only reason a retry ever happens here.
  const retryCount = attemptsMade - 1;
  const retryLine =
    retryCount > 0
      ? `Retries needed: ${retryCount} (window hadn't quite opened yet)\n`
      : `Retries needed: 0\n`;

  // Shown only for an Inpatient accept - these are fabricated placeholder
  // values (no UI to collect real ones via the direct-API path), so
  // surfacing exactly what was submitted here is the only record of it.
  const admissionDetailsLine = admissionDetails
    ? `🏥 Admission Details: departmentId=\`${admissionDetails.departmentId}\`, room=\`${admissionDetails.roomNumber}\`, bed=\`${admissionDetails.bedNumber}\`, fileNumber=\`${admissionDetails.patientFileNumber}\`, startDate=\`${admissionDetails.startDate}\`\n\n`
    : "";

  // Timing from the moment the pre-upload finished to actually firing the
  // request - sleepMs/diffMs are almost always equal (sleepMs floors at 0),
  // shown separately only because a negative diffMs (already past the
  // boundary before the sleep even started) is itself a useful signal.
  const timingLines =
    `Time left before window closed (when ready to fire): ${diffMs}ms\n` +
    `Time spent sleeping until the boundary: ${sleepMs}ms\n` +
    `Pre-fire buffer configured: ${sleepBeforeAcceptOrRejectMs}ms\n` +
    `Fired because of: ${preFireRaceWinner} (took ${preFireRaceDurationMs}ms)\n` +
    `Submitted after window opened: ${(realFireDelayFromBoundaryMs / 1000).toFixed(2)}s\n` +
    (buttonEnabledAfterMs != null
      ? `Accept/Reject button became enabled after: ${buttonEnabledAfterMs}ms\n`
      : "") +
    (reviewBadgeGoneAfterMs != null
      ? `"In Review" badge disappeared after: ${reviewBadgeGoneAfterMs}ms\n`
      : "") +
    `Server response time: ${(actionTimeMs / 1000).toFixed(1)}s\n`;

  // Tells apart "every attempt is equally slow" (a network/connection
  // issue on our end) from "only the final, actually-successful attempt
  // is slow" (server-side work specific to a genuine accept - a quick 400
  // rejection would never reach that path).
  const attemptDurationsLine = attemptDurationsMs?.length
    ? `Per-attempt response times: [${attemptDurationsMs.join("ms, ")}ms]\n`
    : "";

  // Breaks the server response time down into actual network phases
  // (confirmed live: this runs 12-20+ seconds even on success, and it's
  // Wasla's own server-side processing time - ttfb carries almost all of
  // it, not dns/connect/tls/download, which is how that was confirmed to
  // not be a connection issue on our end).
  const requestBreakdownLine = timing
    ? `Request breakdown: dns=${timing.dnsMs}ms, connect=${timing.connectMs}ms, tls=${timing.tlsMs}ms, time-to-first-byte=${timing.ttfbMs}ms, download=${timing.downloadMs}ms, total=${timing.totalMs}ms (${timing.nextHopProtocol}, ${timing.transferSize} bytes)\n`
    : "";

  // Dumped in full (not cherry-picked) since it's not yet known which key,
  // if any, would actually indicate Cloudflare bot-management stepping in
  // on this specific endpoint.
  const responseHeadersLine = responseHeaders
    ? `Response headers: ${JSON.stringify(responseHeaders)}\n`
    : "";

  return (
    `ReferralId: \`${referralId}\`\n` +
    `ID: \`${navigationId}\`\n` +
    `${title}\n` +
    `${detailLine}\n\n` +
    `${preUploadLine}\n\n` +
    admissionDetailsLine +
    retryLine +
    timingLines +
    attemptDurationsLine +
    requestBreakdownLine +
    responseHeadersLine +
    (success ? "" : "\nFalling back to the UI.")
  );
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
 * @returns {Promise<void>}
 */
const notifyWatcherOfAcceptance = async ({
  sendTelegramMessage,
  navigationId,
  referralId,
  patientName,
}) => {
  const { VERIFICATION_CODE_WATCHER_CHAT_ID } = process.env;

  if (!VERIFICATION_CODE_WATCHER_CHAT_ID) return;

  const watcherMessage =
    `✅ *JUST Accepted Case At* \`${getOrgLabel()}\`\n` +
    `────────────────────────\n` +
    `🔢 *ID:* \`${navigationId}\`\n` +
    `🔢 *Referral ID:* \`${referralId}\`\n` +
    (patientName ? `👤 *Patient:* ${patientName}\n` : "");

  const withdrawButtonMarkup = {
    inline_keyboard: [
      [{ text: "🚫 Withdraw", callback_data: `withdraw_${referralId}` }],
    ],
  };

  await sendTelegramMessage?.(
    watcherMessage,
    [],
    undefined,
    VERIFICATION_CODE_WATCHER_CHAT_ID,
    true,
    withdrawButtonMarkup,
  ).catch(() => {});
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

    const description = isAcceptanceAction
      ? randomArrayItem(ACCEPTANCE_DESCRIPTION_TEMPLATES)(navigationId)
      : undefined;

    const targetButtonTexts = isAcceptanceAction
      ? ACCEPT_BUTTON_TEXTS
      : REJECT_BUTTON_TEXTS;

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

    // if (currentLeftTime > 1400) {
    //   await sleep(currentLeftTime - 1400);
    // }

    // Inpatient accept never attaches a file (confirmed live - see
    // buildAdmissionDetails.mjs/submitWaslaReferralViaApi.mjs), so there's
    // nothing to pre-upload for it.
    const uploadStartTime = Date.now();
    const uploadResult = isInpatientReferral
      ? { success: true, uploadIgnored: true }
      : await submitWaslaAction({
          page,
          fileBase64: letterFileBase64,
          fileName: randomFileName,
          postStepLabel: "accept-json",
        });
    const uploadDurationMs = Date.now() - uploadStartTime;

    const diffMs = referralEndTimestamp - Date.now();
    const sleepMS = Math.max(0, diffMs);

    if (sleepMS > 0) {
      await sleep(sleepMS);
    }

    const tActionButtonWaitStart = Date.now();

    let buttonEnabledAfterMs = null;
    let reviewBadgeGoneAfterMs = null;

    const actionButtonPromise = page
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
      .then((handle) => {
        buttonEnabledAfterMs = Date.now() - tActionButtonWaitStart;
        return handle;
      })
      .catch(() => null);

    const reviewBadgeGonePromise = isAcceptanceAction
      ? null
      : page
          .waitForFunction(
            (marker) =>
              ![...document.querySelectorAll("span")].some((el) =>
                el.textContent?.includes(marker),
              ),
            { timeout: ACTION_BUTTON_TIMEOUT_MS },
            REVIEW_BADGE_TEXT_MARKER,
          )
          .then(() => {
            reviewBadgeGoneAfterMs = Date.now() - tActionButtonWaitStart;
          })
          .catch(() => null);

    let currentRetryCount = 1;

    let apiResult = null;

    // Races the fixed pre-fire buffer against the DOM button-enabled signal
    // instead of just sleeping the buffer unconditionally - normally these
    // are gated by the exact same formula (see actionButtonPromise's own
    // setup above), so the sleep should win almost every time; this only
    // matters as a safety net for a stale referralEndTimestamp/windowMinutes
    // for this specific case, where the live page's own calculation could
    // legitimately resolve first.
    const preFireRaceStart = Date.now();

    const preFireRaceWinner = await Promise.race([
      sleep(SLEEP_BEFORE_ACCEPT_OR_REJECT_MS).then(() => "timer"),
      actionButtonPromise.then((handle) => (handle ? "button" : "timer")),
    ]);

    const preFireRaceDurationMs = Date.now() - preFireRaceStart;

    // The real-world gap between the boundary and when the request fires -
    // how late we already were when the race started, plus however long
    // the race itself took.
    const realFireDelayFromBoundaryMs =
      preFireRaceStart - referralEndTimestamp + preFireRaceDurationMs;

    const attemptDurationsMs = [];
    const actionTimeStart = Date.now();

    while (currentRetryCount <= MAX_ACTION_RETRIES) {
      const attemptStart = Date.now();

      apiResult = await submitWaslaReferralViaApi({
        page,
        navigationId,
        notes: description,
        rejectionReasonId: REJECTION_REASON_ID,
        isAccept: isAcceptanceAction,
        admissionDetails,
        ...(isInpatientReferral
          ? null
          : {
              attachmentId: uploadResult.attachmentId,
              // we pass these incase the letter file was not pre-uploaded, so we can upload it now
              fileBase64: letterFileBase64,
              fileName: randomFileName,
            }),
      });

      attemptDurationsMs.push(Date.now() - attemptStart);

      const { success, error } = apiResult;

      if (success) {
        break;
      }

      if (error?.includes?.("review window has elapsed")) {
        await sleep(SLEEP_WHEN_ACCEPT_OR_REJECT_RETRY_MS);
        currentRetryCount++;
      } else {
        break;
      }
    }

    const [actionButtonHandle] = await Promise.all(
      [actionButtonPromise, reviewBadgeGonePromise].filter(Boolean),
    );

    const actionTimeMs = Date.now() - actionTimeStart;

    // currentRetryCount overshoots by 1 when retries are exhausted (it's
    // bumped once more before the while condition re-checks and exits),
    // so it's clamped here rather than reported as-is - otherwise an
    // exhausted-retries run would claim one more attempt than actually
    // happened.
    const attemptsMade = Math.min(currentRetryCount, MAX_ACTION_RETRIES);

    if (apiResult) {
      showPageSnackbar(page, {
        message: apiResult.success
          ? `${isAcceptanceAction ? "Accepted" : "Rejected"} via direct API`
          : `Direct API ${isAcceptanceAction ? "accept" : "reject"} failed - falling back to UI`,
        severity: apiResult.success ? "success" : "error",
      });

      await sendTelegramMessage?.(
        buildDirectApiTelegramMessage({
          isAcceptanceAction,
          referralId,
          navigationId,
          apiResult,
          preUploadResult: uploadResult,
          uploadDurationMs,
          diffMs,
          sleepMs: sleepMS,
          sleepBeforeAcceptOrRejectMs: SLEEP_BEFORE_ACCEPT_OR_REJECT_MS,
          preFireRaceWinner,
          preFireRaceDurationMs,
          realFireDelayFromBoundaryMs,
          buttonEnabledAfterMs,
          reviewBadgeGoneAfterMs,
          actionTimeMs,
          attemptDurationsMs,
          attemptsMade,
          admissionDetails,
        }),
      );
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
          navigationId,
        });
      }

      // this is now supports rejection and accteptance
      await sleep(3_000);
      patientsStore.addNonClaimableCase(referralId, referralEndTimestamp);
      await closePageSafely(page);
      return;
    }

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
      try {
        await fileInputHandle.uploadFile(letterFilePath);
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

    // Reject's modal also has a required "Rejection Reason" dropdown we
    // don't fill yet, so its Confirm would stay disabled anyway - only
    // wired up for accept for now.
    if (isAcceptanceAction) {
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

      await notifyWatcherOfAcceptance({
        sendTelegramMessage,
        referralId,
        patientName,
        navigationId,
      });

      // Same bookkeeping handleCaseAcceptanceOrRejection.mjs does right
      // after a real acceptance API call: mark the case as needing its
      // claimed status checked later (checkReferralSelectedStatus.mjs
      // polls patientsStore.getAllNonClaimableCases() and removes it once
      // confirmed), since clicking Confirm here doesn't itself tell us
      // whether Wasla actually accepted the submission.
      await sleep(SLEEP_AFTER_CONFIRMATION_MS);
      patientsStore.addNonClaimableCase(referralId, referralEndTimestamp);
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
