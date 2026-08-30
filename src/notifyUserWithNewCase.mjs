/**
 *
 * Helper: `notifyUserWithNewCase`.
 *
 */
import createConsoleMessage from "./createConsoleMessage.mjs";
import sendNtfyMessage from "./sendNtfyMessage.mjs";
import speakText from "./speakText.mjs";
import formatPatientToNtfy from "./formatPatientToNtfy.mjs";

const notifyUserWithNewCase = async (patient) => {
  const { USE_NTFY_AS_CASE_PROVIDER } = process.env;

  const withActions = USE_NTFY_AS_CASE_PROVIDER === "Y";
  const message = formatPatientToNtfy(patient);

  try {
    void Promise.resolve(
      speakText({
        text: "Check the bot, there is a new patient",
      }),
    ).catch((error) => {
      createConsoleMessage("error", error, "SOUND error");
    });

    await sendNtfyMessage(message, patient.referralId, withActions);
  } catch (error) {
    createConsoleMessage(
      "error",
      error,
      `notifyUserWithNewCase referralId=${patient.referralId}`,
    );
  }
};

export default notifyUserWithNewCase;
