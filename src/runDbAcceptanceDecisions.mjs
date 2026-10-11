import { WASLA_REFERRAL_VIEW_URL } from "./constants.mjs";
import submitAcceptanceDecisionViaApi from "./submitAcceptanceDecisionViaApi.mjs";

/** Opens the case and runs the two explicitly requested ID-only decisions. */
export default async function runDbAcceptanceDecisions({ browser, patient }) {
  const page = await browser.newPage();
  await page.goto(
    `${WASLA_REFERRAL_VIEW_URL}/${encodeURIComponent(patient.navigationId)}`,
    { waitUntil: "domcontentloaded", timeout: 30_000 },
  );
  await page.bringToFront();
  await page.waitForFunction(
    () => {
      try {
        const auth = JSON.parse(localStorage.getItem("persist:auth"));
        return Boolean(auth?.token && JSON.parse(auth.token));
      } catch {
        return false;
      }
    },
    { timeout: 20_000 },
  );

  const results = [];
  for (const [idType, id] of [
    ["referralId", patient.referralId],
    ["navigationId", patient.navigationId],
  ]) {
    try {
      const result = await submitAcceptanceDecisionViaApi({
        page,
        payload: { id },
      });
      results.push({
        idType,
        id,
        success: result.success,
        httpStatus: result.requestClockSample?.httpStatus ?? null,
        data: result.data ?? null,
        error: result.error ?? null,
      });
    } catch (error) {
      results.push({ idType, id, success: false, error: error.message });
    }
  }
  return results;
}
