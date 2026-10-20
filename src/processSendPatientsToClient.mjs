/*
 *
 * Helper: `processSendPatientsToClient`.
 *
 */
import createConsoleMessage from "./createConsoleMessage.mjs";
import formatPatientToTelegramOrWA from "./formatPatientToTelegramOrWA.mjs";
import notifyUserWithNewCase from "./notifyUserWithNewCase.mjs";

const processSendPatientsToClient =
  (patientsStore, sendTelegramMessage) =>
  async (addedPatients = []) => {
    const { FAKE_REJECTION_ENABLED } = process.env;
    const fakeRejectionEnabled = FAKE_REJECTION_ENABLED === "Y";

    const validPatients = addedPatients.filter(Boolean);

    const tasks = validPatients.flatMap((patient) => {
      const { message, files, referralId } = formatPatientToTelegramOrWA(
        patient,
        true,
      );

      const patientTasks = [sendTelegramMessage(message, files, referralId)];

      if (referralId && fakeRejectionEnabled) {
        patientTasks.unshift(
          patientsStore.scheduleFakeRejectProbe(referralId, false),
        );
      }

      return patientTasks;
    });

    const results = await Promise.allSettled(tasks);

    for (const result of results) {
      if (result.status === "rejected") {
        const reason = result.reason?.message || result.reason;

        createConsoleMessage(
          "error",
          reason,
          "processSendPatientsToClient task failed",
        );

        await sendTelegramMessage(
          `⚠️ Failed to process patient send task:\n${reason}\n\nat processSendPatientsToClient task`,
        ).catch((err) => {
          createConsoleMessage(
            "error",
            err?.message || err,
            "failed to send processSendPatientsToClient error report",
          );
        });
      }
    }

    await Promise.allSettled(validPatients.map(notifyUserWithNewCase));
  };

export default processSendPatientsToClient;
