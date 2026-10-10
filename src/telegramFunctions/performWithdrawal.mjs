/*
 *
 * Helper: `performWithdrawal`.
 *
 * Shared core for both installTelegramBotApi.mjs's `/withdraw` slash
 * command and its inline "Withdraw" button (sent alongside the
 * watcher-chat status update once a case is Confirmed/claimed, see
 * checkReferralSelectedStatus.mjs) - withdraws a facility's own earlier
 * acceptance. Only allowed on a case whose last action was actually
 * "accept" and that hasn't already been finalized as not-ours
 * (claimed === "No") - still-pending (claimed empty/null) or Confirmed
 * (claimed === "Yes") are both fine. Uses the rejection letter PDF as the
 * required attachment - a withdrawal is conceptually "we're un-accepting
 * this", so the rejection letter is the right document, not the
 * acceptance one. That file is almost always already deleted by the time
 * withdrawal is relevant (PatientStore removes both the accept/reject
 * PDFs once a case leaves the Wasla pending list, which happens right
 * after acceptance), so this regenerates it on demand when missing.
 *
 */
import createConsoleMessage from "../createConsoleMessage.mjs";
import {
  getPatientByNavigationId,
  getPatient,
  updatePatients,
} from "../db.mjs";
import { USER_ACTION_TYPES, WASLA_REFERRAL_VIEW_URL } from "../constants.mjs";
import submitWithdrawalViaApi from "../submitWithdrawalViaApi.mjs";
import closePageSafely from "../closePageSafely.mjs";
import getCurrentActionLetterFile from "../getCurrentActionLetterFile.mjs";
import generateAcceptancePdfLetters from "../generatePdfs.mjs";
import randomArrayItem from "../randomArrayItem.mjs";

// Picked at random when no notes are given, rather than always the same
// fixed string.
const DEFAULT_WITHDRAWAL_NOTES = ["Withdrawal", "Bed not available"];

/**
 * @param {object} params
 * @param {import("puppeteer").Browser} params.browser
 * @param {string} params.idArg - navigationId or referralId.
 * @param {string} [params.notes]
 * @returns {Promise<{ success: boolean, message: string }>}
 */
const performWithdrawal = async ({ browser, idArg, notes }) => {
  if (!idArg || !/^[A-Za-z0-9]+$/.test(idArg)) {
    return { success: false, message: `⛔ Invalid ID \`${idArg}\`.` };
  }

  const storedPatient = getPatientByNavigationId(idArg) || getPatient(idArg);

  if (!storedPatient) {
    return {
      success: false,
      message: `⛔ No record found for ID \`${idArg}\`.`,
    };
  }

  const { referralId, navigationId, userActionName, claimed } = storedPatient;

  if (!navigationId) {
    return {
      success: false,
      message: `⛔ No navigationId on record for referralId=\`${referralId}\` - can't open its Wasla case page.`,
    };
  }

  const wasAccepted = userActionName === USER_ACTION_TYPES.ACCEPT;
  const claimedOk = !claimed || claimed === "Yes";

  if (!wasAccepted || !claimedOk) {
    return {
      success: false,
      message: `⛔ referralId=\`${referralId}\` (navigationId=\`${navigationId}\`) can't be withdrawn (userActionName=\`${userActionName}\`, claimed=\`${claimed}\`) - only an accepted case that isn't already finalized as not-ours qualifies.`,
    };
  }

  let fileData;
  let fileName;

  try {
    // No third arg (returnBuffer) - submitWithdrawalViaApi needs the
    // base64 string form, not a raw Buffer.
    ({ fileData, fileName } = await getCurrentActionLetterFile(
      referralId,
      USER_ACTION_TYPES.REJECT,
    ));
  } catch {
    // The reject letter generated at collection time is almost always
    // gone by now: PatientStore.removePatientByReferralId unlinks both
    // the accept and reject PDFs for any case that drops off the Wasla
    // pending list, which happens on the very next ~70s poll after
    // acceptance (waitForWaitingCountWithInterval.mjs) - and withdrawal
    // only makes sense well after that. Regenerate it on demand instead,
    // same fallback makeLetterGenerationAndReturnFile uses for /letter.
    try {
      await generateAcceptancePdfLetters(
        browser,
        [{ ...storedPatient, createdAt: storedPatient.referralDate }],
        false,
        storedPatient.letterType,
      );

      ({ fileData, fileName } = await getCurrentActionLetterFile(
        referralId,
        USER_ACTION_TYPES.REJECT,
      ));
    } catch (error) {
      return {
        success: false,
        message: `⛔ Could not generate/read the rejection letter for referralId=\`${referralId}\` (needed as the withdrawal's attachment): ${error?.message || error}`,
      };
    }
  }

  let newPage;

  try {
    newPage = await browser.newPage();
    await newPage.goto(`${WASLA_REFERRAL_VIEW_URL}/${navigationId}`, {
      waitUntil: "domcontentloaded",
    });

    const result = await submitWithdrawalViaApi({
      page: newPage,
      navigationId,
      fileBase64: fileData,
      fileName,
      notes: notes || randomArrayItem(DEFAULT_WITHDRAWAL_NOTES),
    });

    if (!result.success) {
      return {
        success: false,
        message: `⛔ Withdrawal failed for referralId=\`${referralId}\` (navigationId=\`${navigationId}\`): ${result.error}`,
      };
    }

    // Set directly here, at the moment we know the withdrawal actually
    // succeeded - same reasoning as performArrivalConfirmation.mjs's own
    // status update: nothing else in the live flow ever re-checks a case
    // once it's already claimed (checkReferralSelectedStatus.mjs stops
    // polling the moment claimed resolves to "Yes"), so without this, our
    // stored userActionName/status would stay frozen at "accept"/Confirmed
    // forever even after we've actually withdrawn. status 5 is
    // WASLA_STATUS_TYPES[5] = "Withdrawn".
    updatePatients({
      referralId,
      userActionName: USER_ACTION_TYPES.REJECT,
      status: 5,
    });

    return {
      success: true,
      message: `✅ Withdrawal submitted for referralId=\`${referralId}\` (navigationId=\`${navigationId}\`) \nMessage: ${result.data?.message ?? "(no message)"}.`,
    };
  } catch (error) {
    createConsoleMessage(
      "error",
      error,
      `❌ withdrawal failed for navigationId=${navigationId}:`,
    );
    return {
      success: false,
      message: `⛔ Unexpected error submitting withdrawal: ${error?.message || error}`,
    };
  } finally {
    await closePageSafely(newPage);
  }
};

export default performWithdrawal;
