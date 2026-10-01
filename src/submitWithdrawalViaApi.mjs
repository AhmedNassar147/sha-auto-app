/*
 *
 * Helper: `submitWithdrawalViaApi`.
 *
 * Direct-API submission for withdrawing a facility's own acceptance of a
 * referral (a separate action from reject - this is for un-accepting a case
 * we already accepted, see the frontend's own "withdrawal" copy: "Your
 * acceptance will be withdrawn..."). Read straight out of the Wasla
 * frontend's own bundled RTK Query slice (scripts/index-DkGuikpU.js,
 * "withdrawFromReferral" mutation), not a live network capture like
 * submitWaslaReferralViaApi.mjs, so exact but not yet verified against a
 * real response:
 *   POST /api/admissions/{navigationId}/withdraw
 *   body: { notes, file }
 * Needs a file first, same upload-then-post shape as
 * submitWaslaReferralViaApi.mjs (the frontend's own withdrawal modal
 * requires an attachment) - shares that shape via submitWaslaAction.mjs.
 *
 */
import { API_URLS } from "./constants.mjs";
import submitWaslaAction from "./submitWaslaAction.mjs";

/**
 * @param {object} params
 * @param {import("puppeteer").Page} params.page - Must already be on the
 *   weslah.seha.sa origin.
 * @param {string} params.navigationId - The internal Wasla case id used to
 *   build the withdraw URL.
 * @param {string} params.fileBase64 - Supporting document, base64-encoded.
 * @param {string} params.fileName
 * @param {string} params.notes - Withdrawal reason text.
 * @returns {Promise<{
 *   success: boolean,
 *   attachmentId?: number | string,
 *   data?: unknown,
 *   error?: string,
 *   step?: "upload" | "withdraw",
 *   url?: string,
 * }>}
 */
const submitWithdrawalViaApi = async ({
  page,
  navigationId,
  fileBase64,
  fileName,
  notes,
}) => {
  const url = API_URLS.WITHDRAW_FROM_REFERRAL.replace("_nav_id_", navigationId);

  return await submitWaslaAction({
    page,
    url,
    payload: { notes },
    fileBase64,
    fileName,
    postStepLabel: "withdraw",
  });
};

export default submitWithdrawalViaApi;
