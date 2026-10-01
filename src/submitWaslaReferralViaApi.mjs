/*
 *
 * Helper: `submitWaslaReferralViaApi`.
 *
 * Direct-API alternative to clicking Confirm in the referral-details
 * confirmation popup (see handleSubmitReferral.mjs) - tried first for the
 * accept case there, falling back to the UI flow on any failure. Uploads
 * the letter PDF, then POSTs accept-json referencing the uploaded
 * attachment's own numeric id, for either accept or reject (same endpoint
 * both ways, but NOT the same payload shape - confirmed live from two
 * separate real requests, scripts/reject-case.js for reject:
 *   accept -> {"accept":true,"notes":"...","file":"31284"}
 *   reject -> {"accept":false,"rejectionReasonId":18,"file":"31465"}
 * i.e. reject has no "notes" field at all, and needs rejectionReasonId
 * instead - a lookup id from the portal's own rejection-reasons list (also
 * captured in scripts/reject-case.js, see id 18 there, "Unavailability of
 * Required Bed" / "عدم توفر السرير المطلوب") - supplied by the caller
 * rather than hardcoded here.
 *
 * Upload + accept-json share one page.evaluate() call via
 * submitWaslaAction.mjs (also used by submitWithdrawalViaApi.mjs/
 * submitArrivalConfirmationViaApi.mjs) rather than duplicating that dance
 * here.
 *
 */
import { API_URLS } from "./constants.mjs";
import submitWaslaAction from "./submitWaslaAction.mjs";

/**
 * @param {object} params
 * @param {import("puppeteer").Page} params.page - Must already be on the
 *   weslah.seha.sa origin (e.g. the referral-details page
 *   handleSubmitReferral.mjs opens).
 * @param {string} params.navigationId - The internal Wasla case id used to
 *   build the accept-json URL.
 * @param {string} params.fileBase64 - The letter PDF, base64-encoded (e.g.
 *   getCurrentActionLetterFile()'s fileData, which is already base64 by
 *   default - no need to pass returnBuffer/re-encode for this).
 * @param {string} params.fileName - Attachment file name, e.g.
 *   `${actionType}-${referralId}.pdf`.
 * @param {string} [params.notes] - Accept-only notes text; ignored when
 *   isAccept is false.
 * @param {number} [params.rejectionReasonId] - Reject-only lookup id from
 *   the portal's own rejection-reasons list; ignored when isAccept is true.
 * @param {boolean} params.isAccept - true to accept, false to reject.
 * @returns {Promise<{
 *   success: boolean,
 *   attachmentId?: number | string,
 *   data?: unknown,
 *   error?: string,
 *   step?: "upload" | "accept-json",
 *   url?: string,
 * }>}
 */
const submitWaslaReferralViaApi = async ({
  page,
  navigationId,
  fileBase64,
  fileName,
  notes,
  rejectionReasonId,
  isAccept,
}) => {
  const url = API_URLS.ACCEPT_OR_REJECT_CASE.replace("_nav_id_", navigationId);

  // Confirmed live: accept and reject do NOT share a payload shape.
  // Accept sends free-text "notes"; reject has no "notes" field at all
  // and instead needs "rejectionReasonId" - a lookup id from the portal's
  // own rejection-reasons list (scripts/reject-case.js), supplied by the
  // caller. `file` gets merged in by submitWaslaAction once the upload
  // succeeds - don't set it here.
  const payload = isAccept
    ? { accept: true, notes }
    : { accept: false, rejectionReasonId };

  return await submitWaslaAction({
    page,
    url,
    payload,
    fileBase64,
    fileName,
    postStepLabel: "accept-json",
  });
};

export default submitWaslaReferralViaApi;
