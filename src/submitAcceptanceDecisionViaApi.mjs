import { API_URLS } from "./constants.mjs";
import submitWaslaAction from "./submitWaslaAction.mjs";

/**
 * Mirrors the bundle's confirmAcceptance mutation: POST admissions/{t.id}/
 * decision with the entire t object as the JSON body, including id.
 * Bundle approval shape: { id: caseId, accept: 1, facilityId, attachmentIds }.
 * This is the approving organization's operation, not facility acceptance.
 * No upload or automatic retry is performed.
 *
 * @param {object} params
 * @param {import("puppeteer").Page} params.page - Wasla-origin page.
 * @param {{id: string | number, accept: 1, facilityId: string | number, attachmentIds: (string | number)[]}} params.payload
 * @returns {Promise<object>} Shared submit result, including success/error.
 */
const submitAcceptanceDecisionViaApi = async ({ page, payload }) => {
  const id = payload?.id;
  if (
    !payload ||
    Array.isArray(payload) ||
    !["string", "number"].includes(typeof id) ||
    (typeof id === "number" && !Number.isFinite(id)) ||
    !/^\d+$/.test(String(id)) ||
    payload.accept !== 1 ||
    !/^\d+$/.test(String(payload.facilityId)) ||
    !Array.isArray(payload.attachmentIds) ||
    payload.attachmentIds.some((value) => !/^\d+$/.test(String(value)))
  ) {
    return {
      success: false,
      step: "acceptance-decision-invalid-payload",
      error: "Required: numeric case id, accept=1, numeric facilityId and attachmentIds array.",
    };
  }

  return await submitWaslaAction({
    page,
    url: API_URLS.CONFIRM_ACCEPTANCE.replace("_id_", encodeURIComponent(id)),
    payload,
    postStepLabel: "acceptance-decision",
  });
};

export default submitAcceptanceDecisionViaApi;
