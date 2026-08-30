/*
 *
 * Helper: `handleLockedOutRetry`.
 *
 */

import closePageSafely from "./closePageSafely.mjs";
import createConsoleMessage from "./createConsoleMessage.mjs";

const createSendLockedMessage =
  (sendTelegramMessage, patientsStore, clientPhoneNumber, patient) =>
  async (message) => {
    if (patient) {
      patientsStore.setLastActionablePatient({
        ...patient,
        hasLockMessageSent: true,
      });
    }

    await sendTelegramMessage(message);
  };

async function handleLockedOutRetry({
  patientsStore,
  lockSleepTime,
  page,
  pausableSleep,
  sendTelegramMessage,
}) {
  const { CLIENT_WHATSAPP_NUMBER, APP_LOCK_HOURS } = process.env;
  const now = Date.now();
  const candidateNextAttempt = now + Number(lockSleepTime || 0);

  // Try to get last patient and a numeric deadline if present
  const lastPatient = patientsStore?.getLastActionablePatient?.();

  const sendMessage = createSendLockedMessage(
    sendTelegramMessage,
    patientsStore,
    CLIENT_WHATSAPP_NUMBER,
    lastPatient,
  );

  const { referralEndTimestamp, hasLockMessageSent } = lastPatient || {};

  const rawDeadline = referralEndTimestamp || NaN;

  const hasValidDeadline =
    Number.isFinite(rawDeadline) && !Number.isNaN(rawDeadline);

  // If there's a deadline, enforce "do not retry after deadline"
  if (hasValidDeadline) {
    const appLockHours = APP_LOCK_HOURS || 0;
    // hours * minutes * seconds * milliseconds
    const deadline = rawDeadline + appLockHours * 60 * 60 * 1000;

    // If the next candidate attempt would be after the deadline -> skip retrying
    if (candidateNextAttempt > deadline) {
      const deadlineDate = new Date(deadline);
      const message = `🔐 Locked out — next retry would be AFTER referral deadline (${deadlineDate.toLocaleString()}). Skipping further retries (deadlineReached-noRetry)`;

      createConsoleMessage("warn", message);
      await closePageSafely(page);

      if (!hasLockMessageSent) {
        await sendMessage(message);
      }

      const sleepTime = deadline - Date.now();

      if (sleepTime > 0) {
        await pausableSleep(sleepTime);
      }

      // clear references (caller can rely on returned page/cursor)
      return { page: null, cursor: null, reason: "deadlineReached-noRetry" };
    }

    const nextAttemptAt = Math.min(candidateNextAttempt, deadline);
    const nextAttemptDate = new Date(nextAttemptAt);

    const message = `🔐 We are locked out. Will retry in ${Math.round(
      (nextAttemptAt - now) / 60000,
    )} minutes at ${nextAttemptDate.toLocaleTimeString("en-US", {
      hour12: false,
    })} (deadline ${new Date(deadline).toLocaleString()}).`;

    createConsoleMessage("info", message);
    await closePageSafely(page);

    if (!hasLockMessageSent) {
      await sendMessage(message);
    }
    // Sleep until nextAttemptAt (guaranteed <= deadline)
    const sleepMs = Math.max(0, nextAttemptAt - Date.now());
    await pausableSleep(sleepMs);

    return { page: null, cursor: null, reason: "slept-until-nextAttempt" };
  }

  // No valid deadline -> keep retrying every lockSleepTime
  const nextRetryDate = new Date(candidateNextAttempt);

  const message = `🔐 Locked out. No last patient deadline found. Retrying in ${Math.round(
    lockSleepTime / 60000,
  )} minutes at ${nextRetryDate.toLocaleTimeString("en-US", {
    hour12: false,
  })}.`;

  createConsoleMessage("info", message);
  await closePageSafely(page);
  if (!hasLockMessageSent) {
    await sendMessage(message);
  }
  await pausableSleep(lockSleepTime);

  return { page: null, cursor: null, reason: "slept-normal-interval" };
}

export default handleLockedOutRetry;
