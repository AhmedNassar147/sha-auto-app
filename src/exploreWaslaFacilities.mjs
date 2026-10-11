import puppeteer from "puppeteer";
import { mkdir, writeFile, access } from "node:fs/promises";
import { resolve, join } from "node:path";

/** Prefer ten wins and ten losses, filling shortages from the other group. */
export function selectExplorationCases(wonRows, lostRows) {
  const validId = (p) => /^\d+$/.test(String(p.navigationId));
  const won = wonRows.filter(validId);
  const lost = lostRows.filter((p) => validId(p) &&
    String(p.userActionName ?? "").trim().toLowerCase() === "accept");
  const candidates = [
    ...won.slice(0, 10).map((patient) => ({ outcome: "won", patient })),
    ...lost.slice(0, 10).map((patient) => ({ outcome: "lost", patient })),
    ...lost.slice(10).map((patient) => ({ outcome: "lost", patient })),
    ...won.slice(10).map((patient) => ({ outcome: "won", patient })),
  ];
  const seen = new Set();
  return candidates.filter(({ patient }) => {
    const id = String(patient.navigationId);
    if (seen.has(id)) return false;
    seen.add(id);
    return true;
  }).slice(0, 20);
}

/** Read-only facilities comparison for up to twenty cases from patients.db. */
export default async function exploreWaslaFacilities() {
  if (!process.env.USER_PROFILE_PATH) throw new Error("USER_PROFILE_PATH is required.");
  await access(resolve("patients.db"));
  const { getPatientsFiltered } = await import("./db.mjs");
  const cases = selectExplorationCases(
    getPatientsFiltered({ claimed: "Yes", limit: 2000 }),
    getPatientsFiltered({ claimed: "No", status: "7", limit: 2000 }),
  );
  if (!cases.length) throw new Error("No eligible cases found in patients.db.");
  console.log(`Selected ${cases.length}/20 cases: ${cases.filter((c) => c.outcome === "won").length} won, ${cases.filter((c) => c.outcome === "lost").length} lost after acceptance.`);
  const output = resolve(`results/facilities-exploration/${Date.now()}`);
  await mkdir(output, { recursive: true });
  let browser;
  const results = [];
  try {
    browser = await puppeteer.launch({
      headless: false,
      pipe: true,
      defaultViewport: null,
      userDataDir: resolve(join(process.env.USER_PROFILE_PATH, "Profile 1")),
      ...(process.env.CHROME_EXECUTABLE_PATH ? { executablePath: process.env.CHROME_EXECUTABLE_PATH } : {}),
    });
    const page = await browser.newPage();
    for (const [index, { outcome, patient }] of cases.entries()) {
      const id = String(patient.navigationId);
      console.log(`[${index + 1}/${cases.length}] Reading ${outcome} case ${id} facilities…`);
      try {
        await page.goto(`https://weslah.seha.sa/facility-referrals/view/${id}`, {
          waitUntil: "domcontentloaded", timeout: 60_000,
        });
        await page.waitForFunction(() => {
          try {
            const auth = JSON.parse(localStorage.getItem("persist:auth"));
            return Boolean(auth?.token && JSON.parse(auth.token));
          } catch { return false; }
        }, { timeout: 20_000 });
        const response = await page.evaluate(async (id) => {
          const auth = JSON.parse(localStorage.getItem("persist:auth"));
          const token = JSON.parse(auth.token);
          // Decode only the organization identifier for diagnostic matching.
          // JWT claims are unverified here and never used to authorize actions.
          let tokenOrganizationId = null;
          try {
            const encoded = token.split(".")[1].replace(/-/g, "+").replace(/_/g, "/");
            const claims = JSON.parse(atob(encoded.padEnd(Math.ceil(encoded.length / 4) * 4, "=")));
            tokenOrganizationId = claims.organization_id ?? claims.org ?? null;
          } catch {}
          const startedAtMs = Date.now();
          const res = await fetch(`/api/referrals/${id}/facilities`, {
            method: "GET", credentials: "include",
            headers: { Accept: "application/json", Authorization: `Bearer ${token}`, culture: localStorage.getItem("i18nextLng") || "en" },
          });
          const bodyText = await res.text();
          let data = null;
          try { data = JSON.parse(bodyText); } catch {}
          return { success: res.ok, httpStatus: res.status, contentType: res.headers.get("content-type"), startedAtMs, receivedAtMs: Date.now(), tokenOrganizationId, data, bodyText };
        }, id);
        const file = `${outcome}-${id}.json`;
        await writeFile(join(output, file), JSON.stringify({ outcome, referralId: patient.referralId, navigationId: id, ...response }, null, 2));
        const facilities = Array.isArray(response.data)
          ? response.data
          : (Array.isArray(response.data?.data) ? response.data.data : []);
        results.push({
          outcome, navigationId: id, httpStatus: response.httpStatus,
          success: response.success, file,
          tokenOrganizationId: response.tokenOrganizationId,
          facilities: facilities.map((f) => ({
            facilityId: f.facilityId ?? null,
            facilityName: f.facilityName ?? null,
            organizationId: f.organizationId ?? null,
            dailyConfirmedCount: f.dailyConfirmedCount ?? null,
            isApprovalCandidate: f.isApprovalCandidate ?? null,
            status: f.status ?? null,
          })),
        });
        console.log(`${id}: HTTP ${response.httpStatus}; saved ${file}`);
      } catch (error) {
        results.push({ outcome, navigationId: id, success: false, error: error.message });
        console.error(`${id}: ${error.message}`);
      }
    }
  } finally {
    await writeFile(join(output, "summary.json"), JSON.stringify({ collectedAt: new Date().toISOString(), results }, null, 2));
    await browser?.close();
    console.log(`Exploration results: ${output}`);
  }
  if (results.some((r) => !r.success)) process.exitCode = 1;
}
