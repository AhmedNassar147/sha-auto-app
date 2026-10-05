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
 * Pass `attachmentId` when the letter's already been uploaded ahead of
 * time (see handleSubmitReferral.mjs, which calls submitWaslaAction
 * directly with ignoreFinalAction:true to pre-upload well before the
 * facility review-window boundary opens) - submitWaslaAction then skips
 * its own upload step and does just the one fast accept-json POST, which
 * is what actually needs to happen right at/after the boundary. Pass
 * `fileBase64`/`fileName` instead for a standalone upload-then-post call
 * (not used by the time-critical path anymore, kept for flexibility/
 * testing).
 *
 * Pass `admissionDetails` for an Inpatient-type referral's accept instead
 * of `notes` - confirmed live (html/details-js-code.js's `jr`/`Rr`
 * components): Wasla's own frontend sends a completely different payload
 * shape there, `{accept:true, ...admissionDetails}`, with no `notes` and
 * (per the same trace) no `file` either - don't also pass attachmentId/
 * fileBase64 alongside it, see buildAdmissionDetails.mjs.
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
 * @param {string | number} [params.attachmentId] - Already-uploaded
 *   attachment id - when given, skips the upload step entirely. Mutually
 *   exclusive with fileBase64/fileName.
 * @param {string} [params.fileBase64] - The letter PDF, base64-encoded (e.g.
 *   getCurrentActionLetterFile()'s fileData, which is already base64 by
 *   default - no need to pass returnBuffer/re-encode for this). Only used
 *   when attachmentId isn't given.
 * @param {string} [params.fileName] - Attachment file name, e.g.
 *   `${actionType}-${referralId}.pdf`. Only used when attachmentId isn't
 *   given.
 * @param {string} [params.notes] - Accept-only notes text; ignored when
 *   isAccept is false or admissionDetails is given.
 * @param {number} [params.rejectionReasonId] - Reject-only lookup id from
 *   the portal's own rejection-reasons list; ignored when isAccept is true.
 * @param {boolean} params.isAccept - true to accept, false to reject.
 * @param {object} [params.admissionDetails] - Inpatient-only (see
 *   buildAdmissionDetails.mjs) - when given, replaces `notes` in the
 *   payload entirely. Ignored when isAccept is false.
 * @returns {Promise<{
 *   success: boolean,
 *   attachmentId?: number | string,
 *   data?: unknown,
 *   error?: string,
 *   step?: "upload" | "accept-json",
 *   url?: string,
 *   uploadIgnored: boolean,
 * }>}
 */
const submitWaslaReferralViaApi = async ({
  page,
  navigationId,
  attachmentId,
  fileBase64,
  fileName,
  notes,
  rejectionReasonId,
  isAccept,
  admissionDetails,
}) => {
  const url = API_URLS.ACCEPT_OR_REJECT_CASE.replace("_nav_id_", navigationId);

  // Confirmed live: accept and reject do NOT share a payload shape.
  // Accept sends free-text "notes"; reject has no "notes" field at all
  // and instead needs "rejectionReasonId" - a lookup id from the portal's
  // own rejection-reasons list (scripts/reject-case.js), supplied by the
  // caller. Inpatient accept is a third shape again - admissionDetails
  // fields instead of notes, no file (see this file's own docblock).
  const payload = isAccept
    ? admissionDetails
      ? { accept: true, ...admissionDetails }
      : { accept: true, notes }
    : { accept: false, rejectionReasonId };

  // submitWaslaAction skips the upload step entirely when attachmentId is
  // given (merging it into payload itself) - without one, it falls back
  // to uploading fileBase64/fileName and merging the result in instead.
  return await submitWaslaAction({
    page,
    url,
    payload,
    attachmentId,
    fileBase64,
    fileName,
    postStepLabel: "accept-json",
  });
};

export default submitWaslaReferralViaApi;
