/**
 *
 * Helper: `checkReferralSelectedStatus`.
 *
 */
import createConsoleMessage from "./createConsoleMessage.mjs";
import getWaslaCasesFromAPI from "./getWaslaCasesFromAPI.mjs";
import sleep from "./sleep.mjs";
import { updatePatients } from "./db.mjs";
import {
  CLAIMED_STATUS_CODES,
  WASLA_STATUS_TYPES,
  WAITING_ACCEPTANCE_STATUS_CODES,
} from "./constants.mjs";

/**
 * Looks up a single referral on the Wasla "myOrders" tab (tab 2) to see
 * whether its acceptance has been finalized, and if so, with what outcome.
 * While the case is still sitting at `WAITING_ACCEPTANCE_STATUS_CODES`
 * (WaitingAcceptance), this returns `shouldUpdateAndNotify: false` so the
 * caller leaves it queued and checks again later - nothing has resolved yet.
 *
 * @param {import("puppeteer").Frame} waslaFrame - The Wasla widget's iframe
 *   frame, from getWaslaReferralFrame.mjs.
 * @param {string | number} referralId
 * @returns {Promise<{
 *   referralId: string | number,
 *   status: number | undefined,
 *   claimed: "Yes" | "No" | null,
 *   hints: string[],
 *   statusID?: string,
 *   shouldUpdateAndNotify: boolean,
 *   tabName?: string,
 * }>}
 */
const fetchCase = async (waslaFrame, referralId) => {
  const patientIdString = String(referralId);

  // Claimed/finalized outcomes only ever show up on tab 2 ("myOrders") -
  // tab 1 ("referralCases") is the pending-broadcast list this case already
  // left once we accepted it.
  const { patients, message, totalRowsCount } = await getWaslaCasesFromAPI(
    waslaFrame,
    {
      searchReferralID: patientIdString,
      tab: 2,
    },
  );

  const foundPatient = totalRowsCount
    ? patients?.find((patient) => `${patient.referralId}` === patientIdString)
    : null;

  if (foundPatient) {
    const { status } = foundPatient;
    const isStillInAcceptance =
      `${WAITING_ACCEPTANCE_STATUS_CODES}` === `${status}`;

    const isClaimed = CLAIMED_STATUS_CODES.includes(status);
    const statusID = WASLA_STATUS_TYPES[status];

    return {
      referralId,
      status,
      claimed: isStillInAcceptance ? null : isClaimed ? "Yes" : "No",
      hints: [message].filter(Boolean),
      statusID,
      shouldUpdateAndNotify: isStillInAcceptance ? false : true,
      tabName: "orders",
    };
  }

  // Not found in any tab
  return {
    referralId,
    status: undefined,
    claimed: "No",
    shouldUpdateAndNotify: true,
    hints: ["Referral not found in any status tab."],
  };
};

/**
 * Persists a finalized case outcome to the sqlite `patients` row and
 * notifies the operator over Telegram. Doesn't touch PatientStore's
 * in-memory/disk-snapshot copy - by the time this runs, the case has
 * already been dropped from there by the pending-list reconciliation in
 * waitForWaitingCountWithInterval.mjs (an accepted case no longer appears
 * on tab 1, so it's treated as unsynced and removed).
 *
 * @param {object} params
 * @param {(message: string) => Promise<any>} params.sendTelegramMessage
 * @param {string | number} params.referralId
 * @param {number | undefined} params.status - Raw Wasla status code.
 * @param {string[]} [params.hints]
 * @param {string} [params.statusID] - Human-readable status name, e.g.
 *   "Confirmed" (see WASLA_STATUS_TYPES).
 * @param {"Yes" | "No"} params.claimed
 * @param {string} [params.tabName]
 * @returns {Promise<void>}
 */
const updateAndNotifyUser = async ({
  sendTelegramMessage,
  referralId,
  status,
  hints,
  statusID,
  claimed,
  tabName,
}) => {
  const isClaimed = claimed === "Yes";
  const statusEmoji = isClaimed ? "✅" : "❌";
  const statusText = isClaimed
    ? `We have been selected (${statusID})`
    : `We have NOT been selected${statusID ? ` (${statusID})` : ""}`;

  const telegramMessage =
    `${statusEmoji} *Referral Status Update*\n` +
    `────────────────────────\n` +
    `🔢 *Referral ID:* \`${referralId}\`\n` +
    `📋 *Status:* ${statusText}` +
    `${!!hints?.length ? `\n⚠️ *Hints:* ${hints.join("\n\n")}` : ""}`;

  const updates = { referralId, status, claimed, tabName };

  updatePatients(updates);
  await sendTelegramMessage(telegramMessage);
};

/**
 * Drains PatientStore's "non-claimable" queue (cases we accepted but whose
 * final Wasla outcome isn't known yet) - re-checks each one against the
 * "myOrders" tab, and for any that have finalized (accepted/confirmed,
 * rejected, withdrawn, etc.), updates storage and pings the operator. Cases
 * still stuck at WaitingAcceptance are left in the queue for the next pass.
 *
 * @param {import("puppeteer").Frame} waslaFrame - The Wasla widget's iframe
 *   frame, from getWaslaReferralFrame.mjs.
 * @param {import("./PatientStore.mjs").default} patientsStore
 * @param {(message: string) => Promise<any>} sendTelegramMessage
 * @returns {Promise<boolean>} True if at least one case was resolved and
 *   updated this pass.
 */
const checkReferralSelectedStatus = async (
  waslaFrame,
  patientsStore,
  sendTelegramMessage,
) => {
  try {
    const cases = patientsStore.getAllNonClaimableCases();

    if (!cases?.length) return false;

    const settledResults = [];
    for (const { referralId } of cases) {
      await sleep(1500 + Math.random() * 1500);

      const result = await fetchCase(waslaFrame, referralId).catch((err) => {
        createConsoleMessage(
          "error",
          "Error when fetching case status: " + err?.message,
          `❌ fetchCase failed for ${referralId}:`,
        );
        return null;
      });
      if (result) settledResults.push(result);
    }

    const results = settledResults.filter((item) => item.shouldUpdateAndNotify);

    for (const item of results) {
      await updateAndNotifyUser({
        sendTelegramMessage,
        ...item,
      });

      patientsStore.removeNonClaimableCase(item.referralId);
    }

    return results.length > 0;
  } catch (error) {
    return false;
  }
};

export default checkReferralSelectedStatus;
