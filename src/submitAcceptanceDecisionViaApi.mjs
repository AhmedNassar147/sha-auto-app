import { API_URLS } from "./constants.mjs";
import submitWaslaAction from "./submitWaslaAction.mjs";

/**
 * Mirrors the bundle's confirmAcceptance mutation: POST admissions/{t.id}/
 * decision with the entire t object as the JSON body, including id.
 * The caller must supply the actual decision payload; its business fields
 * and the meaning of id have not been verified from a live request.
 * No upload or automatic retry is performed.
 *
 * @param {object} params
 * @param {import("puppeteer").Page} params.page - Wasla-origin page.
 * @param {{id: string | number, [key: string]: unknown}} params.payload
 * @returns {Promise<object>} Shared submit result, including success/error.
 */
const submitAcceptanceDecisionViaApi = async ({ page, payload }) => {
  const id = payload?.id;
  if (
    !payload ||
    Array.isArray(payload) ||
    !["string", "number"].includes(typeof id) ||
    (typeof id === "number" && !Number.isFinite(id)) ||
    String(id).trim() === ""
  ) {
    return {
      success: false,
      step: "acceptance-decision-invalid-payload",
      error: "A decision payload with a non-empty id is required.",
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
