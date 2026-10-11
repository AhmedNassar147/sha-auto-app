import { WASLA_REFERRAL_VIEW_URL } from "./constants.mjs";
import submitAcceptanceDecisionViaApi from "./submitAcceptanceDecisionViaApi.mjs";

/** Opens the case and submits one explicit facility-approval payload. */
export default async function runDbAcceptanceDecisions({ browser, patient }) {
  if (!/^\d+$/.test(String(patient.caseAttachmentId))) {
    throw new Error(
      "No valid caseAttachmentId saved for this case. Run backfill or check its upload result.",
    );
  }
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

  const facilityId = process.env.WASLA_ORG_ID;
  if (!facilityId)
    throw new Error("WASLA_ORG_ID is missing. Run the main polling flow to cache it first.");
  if (patient.ownFacilityId && String(patient.ownFacilityId) !== facilityId) {
    throw new Error(
      "The case belongs to a different saved facility than the current Wasla session.",
    );
  }
  const payload = {
    id: patient.navigationId,
    accept: 1,
    facilityId,
    attachmentIds: [Number(patient.caseAttachmentId)],
  };
  const result = await submitAcceptanceDecisionViaApi({ page, payload });
  return [
    {
      payload,
      success: result.success,
      httpStatus: result.requestClockSample?.httpStatus ?? null,
      data: result.data ?? null,
      error: result.error ?? null,
    },
  ];
}
