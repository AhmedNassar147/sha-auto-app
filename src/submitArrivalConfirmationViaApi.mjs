/*
 *
 * Helper: `submitArrivalConfirmationViaApi`.
 *
 * Direct-API submission for confirming a patient's physical arrival at the
 * facility - a separate action from accept/reject, only relevant once a
 * referral is already Confirmed (WASLA_STATUS_TYPES). Unlike the other
 * submit-via-api helpers, this shape wasn't reverse engineered from a live
 * network capture - it's read straight out of the Wasla frontend's own
 * bundled RTK Query slice (scripts/index-DkGuikpU.js, "confirmPatientArrival"
 * mutation), so it's exact, just not yet verified against a real response:
 *   POST /api/admissions/{navigationId}/arrival
 *   body: { nationalId, arrivalAt, notes }
 * No file/attachment field at all - unlike accept/reject or withdrawal, no
 * fileBase64/fileName given to submitWaslaAction.mjs, so it skips the
 * upload step entirely and just POSTs this payload as-is.
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
 *   build the arrival-confirmation URL.
 * @param {string} params.nationalId - Patient's national ID/iqama number.
 * @param {string} params.arrivalAt - "YYYY-MM-DD HH:mm:ss" - confirmed
 *   format from the frontend's own modal (dayjs(...).format(same)).
 * @param {string} [params.notes]
 * @returns {Promise<{ success: boolean, data?: unknown, error?: string, url?: string }>}
 */
const submitArrivalConfirmationViaApi = async ({
  page,
  navigationId,
  nationalId,
  arrivalAt,
  notes,
}) => {
  const url = API_URLS.CONFIRM_PATIENT_ARRIVAL.replace(
    "_nav_id_",
    navigationId,
  );

  return await submitWaslaAction({
    page,
    url,
    payload: { nationalId, arrivalAt, notes },
    postStepLabel: "arrival",
  });
};

export default submitArrivalConfirmationViaApi;
