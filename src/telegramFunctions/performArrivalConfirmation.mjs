/*
 *
 * Helper: `performArrivalConfirmation`.
 *
 * Shared core for both installTelegramBotApi.mjs's `/arrived` slash command
 * and the inline "Confirm Arrival" button (sent alongside the watcher-chat
 * status update once a case is Confirmed/claimed, see
 * checkReferralSelectedStatus.mjs) - looks up the case, validates it's
 * actually Confirmed/claimed, then submits the arrival confirmation via
 * submitArrivalConfirmationViaApi. Returns a result message rather than
 * sending one itself, since the two callers reply differently (one via
 * sendBotMessage with reply_to_message_id, the other via the
 * callback_query's own reply()).
 *
 */
import createConsoleMessage from "../createConsoleMessage.mjs";
import { getPatientByNavigationId, getPatient } from "../db.mjs";
import { WASLA_STATUS_TYPES, WASLA_REFERRAL_VIEW_URL } from "../constants.mjs";
import submitArrivalConfirmationViaApi from "../submitArrivalConfirmationViaApi.mjs";
import closePageSafely from "../closePageSafely.mjs";
import randomArrayItem from "../randomArrayItem.mjs";

// Picked at random when no notes are given, rather than always the same
// fixed string.
const DEFAULT_ARRIVAL_NOTES = [
  "Patient arrived",
  "Patient arrives",
  "Patient arrives at the facility",
  "Patient has arrived at the facility",
  "Patient arrival confirmed",
  "confirmed Patient arrival",
];

/**
 * @param {object} params
 * @param {import("puppeteer").Browser} params.browser
 * @param {string} params.idArg - navigationId or referralId.
 * @param {string} [params.maybeTime] - "HHmm", only used if it actually
 *   looks like one (3-4 digits) - otherwise ignored (current time is
 *   used instead), matching /arrived's own time-vs-notes disambiguation.
 * @param {string} [params.notes]
 * @returns {Promise<{ success: boolean, message: string }>}
 */
const performArrivalConfirmation = async ({
  browser,
  idArg,
  maybeTime,
  notes,
}) => {
  if (!idArg || !/^[A-Za-z0-9]+$/.test(idArg)) {
    return { success: false, message: `⛔ Invalid ID \`${idArg}\`.` };
  }

  // Time only, no date (always "today") - 3 or 4 digits, HHmm, e.g.
  // "1210" for 12:10 or "930" for 09:30. Optional - omit it to use the
  // current time (the common case: confirming arrival as it happens).
  const timeGiven = !!maybeTime && /^\d{3,4}$/.test(maybeTime);

  let hours;
  let minutes;

  if (timeGiven) {
    const paddedTime = maybeTime.padStart(4, "0");
    hours = paddedTime.slice(0, 2);
    minutes = paddedTime.slice(2, 4);

    if (Number(hours) > 23 || Number(minutes) > 59) {
      return {
        success: false,
        message: `⛔ Invalid time \`${maybeTime}\` - hours must be 00-23 and minutes 00-59.`,
      };
    }
  }

  // Accepts either id - navigationId (Wasla's internal numeric case id)
  // or referralId (the alphanumeric id shown everywhere else, e.g. in
  // Telegram notifications and the /db page) - whichever is found first.
  const storedPatient = getPatientByNavigationId(idArg) || getPatient(idArg);

  if (!storedPatient) {
    return {
      success: false,
      message: `⛔ No record found for ID \`${idArg}\`.`,
    };
  }

  const { referralId, navigationId, patientNationalId, status, claimed } =
    storedPatient;

  if (!navigationId) {
    return {
      success: false,
      message: `⛔ No navigationId on record for referralId=\`${referralId}\` - can't open its Wasla case page.`,
    };
  }

  const statusLabel = WASLA_STATUS_TYPES[Number(status)];
  const isClaimed = claimed === "Yes";

  // CLAIMED_STATUS_CODES (constants.mjs) treats both status 1 (Confirmed)
  // and 4 (ConfirmedArrival) as claimed==="Yes" - the Confirm
  // Arrival/Withdraw buttons (checkReferralSelectedStatus.mjs) show for
  // either, so this needs to tell them apart: arrival is only actually
  // confirmable from "Confirmed"; "ConfirmedArrival" means it already
  // was, and the generic "not Confirmed/claimed yet" message would be
  // actively wrong there (it IS claimed).
  if (statusLabel === "ConfirmedArrival") {
    return {
      success: false,
      message: `⚠️ referralId=\`${referralId}\` (navigationId=\`${navigationId}\`) already has its arrival confirmed (status=ConfirmedArrival) - nothing to do.`,
    };
  }

  if (statusLabel !== "Confirmed" || !isClaimed) {
    return {
      success: false,
      message: `⛔ referralId=\`${referralId}\` (navigationId=\`${navigationId}\`) is not Confirmed/claimed yet (status=\`${status}\`, claimed=\`${claimed}\`) - cannot confirm arrival.`,
    };
  }

  // Local getters, not toISOString() - that converts to UTC and can
  // shift the date by a day depending on time-of-day/system offset,
  // wrong for "today" here.
  const now = new Date();

  if (!timeGiven) {
    hours = String(now.getHours()).padStart(2, "0");
    minutes = String(now.getMinutes()).padStart(2, "0");
  }

  const todayDateString = `${now.getFullYear()}-${String(
    now.getMonth() + 1,
  ).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
  // Seconds are never part of the HHmm input - always the current
  // second, not a hardcoded "00".
  const seconds = String(now.getSeconds()).padStart(2, "0");
  const arrivalAt = `${todayDateString} ${hours}:${minutes}:${seconds}`;

  let newPage;

  try {
    newPage = await browser.newPage();
    await newPage.goto(`${WASLA_REFERRAL_VIEW_URL}/${navigationId}`, {
      waitUntil: "domcontentloaded",
    });

    const result = await submitArrivalConfirmationViaApi({
      page: newPage,
      navigationId,
      nationalId: patientNationalId,
      arrivalAt,
      notes: notes || randomArrayItem(DEFAULT_ARRIVAL_NOTES),
    });

    if (!result.success) {
      return {
        success: false,
        message: `⛔ Arrival confirmation failed for referralId=\`${referralId}\` (navigationId=\`${navigationId}\`): ${result.error}`,
      };
    }

    return {
      success: true,
      message: `✅ Patient arrival confirmed for referralId=\`${referralId}\` (navigationId=\`${navigationId}\`) at \`${arrivalAt}\` \nMessage: ${result.message}.`,
    };
  } catch (error) {
    createConsoleMessage(
      "error",
      error,
      `❌ arrival confirmation failed for navigationId=${navigationId}:`,
    );
    return {
      success: false,
      message: `⛔ Unexpected error confirming arrival: ${error?.message || error}`,
    };
  } finally {
    await closePageSafely(newPage);
  }
};

export default performArrivalConfirmation;
