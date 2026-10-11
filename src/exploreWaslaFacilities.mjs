import puppeteer from "puppeteer";
import { mkdir, writeFile, access } from "node:fs/promises";
import { resolve, join } from "node:path";
import Database from "better-sqlite3";

/** Every unique case with a usable navigation ID, regardless of outcome. */
export function selectExplorationCases(rows) {
  const seen = new Set();
  return rows.filter((patient) => {
    const id = String(patient.navigationId ?? "");
    if (!/^\d+$/.test(id) || seen.has(id)) return false;
    seen.add(id);
    return true;
  }).map((patient) => {
    const action = String(patient.userActionName ?? "").trim().toLowerCase();
    const outcome = patient.claimed === "Yes" ? "won"
      : patient.claimed === "No" && Number(patient.status) === 7 && action === "accept"
        ? "lost" : action === "reject" ? "rejected" : "other";
    return { patient, outcome };
  });
}

/** Read-only facilities comparison for all cases in patients.db. */
export default async function exploreWaslaFacilities() {
  if (!process.env.USER_PROFILE_PATH) throw new Error("USER_PROFILE_PATH is required.");
  await access(resolve("patients.db"));
  const database = new Database(resolve("patients.db"), { readonly: true, fileMustExist: true });
  let allRows;
  try { allRows = database.prepare("SELECT * FROM patients ORDER BY id DESC").all(); }
  finally { database.close(); }
  const cases = selectExplorationCases(allRows);
  if (!cases.length) throw new Error("No eligible cases found in patients.db.");
  console.log(`DB total: ${allRows.length} rows. Exploring ${cases.length} unique cases; ${allRows.length - cases.length} rows skipped (missing/invalid/duplicate navigation ID).`);
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
            acceptedAt: f.acceptedAt ?? null,
            facilityAcceptanceAttachmentIds: (f.attachments || [])
              .map((attachment) => attachment.id),
            tpaAcceptanceAttachment: f.tpaAcceptanceAttachment
              ? {
                  id: f.tpaAcceptanceAttachment.id,
                  uploadedAt: f.tpaAcceptanceAttachment.uploadedAt ?? null,
                }
              : null,
            // Stored approval attachment, not a capture of the POST body.
            approvalAttachmentEvidence: "facilities response; decision request not captured",
          })),
        });
        console.log(`${id}: HTTP ${response.httpStatus}; saved ${file}`);
      } catch (error) {
        results.push({ outcome, navigationId: id, success: false, error: error.message });
        console.error(`${id}: ${error.message}`);
      }
    }
  } finally {
    const winnerCounts = new Map();
    let noConfirmedWinner = 0;
    let multipleConfirmedWinners = 0;
    for (const result of results.filter((r) => r.success)) {
      const winners = result.facilities.filter((f) => [1, 4].includes(Number(f.status)));
      if (!winners.length) { noConfirmedWinner++; continue; }
      if (winners.length !== 1) { multipleConfirmedWinners++; continue; }
      const winner = winners[0];
      const key = String(winner.facilityId);
      const entry = winnerCounts.get(key) || { facilityId: key, facilityName: winner.facilityName, count: 0 };
      entry.count++;
      winnerCounts.set(key, entry);
    }
    const statistics = {
      dbRows: allRows.length,
      eligibleUniqueCases: cases.length,
      skippedRows: allRows.length - cases.length,
      attemptedCases: results.length,
      successfulReads: results.filter((r) => r.success).length,
      failedReads: results.filter((r) => !r.success).length,
      noConfirmedWinner,
      multipleConfirmedWinners,
      winners: [...winnerCounts.values()].sort((a, b) => b.count - a.count),
      scope: "Cases stored in this DB; not all portal cases. Winner inferred from status 1 or 4 at collection time.",
    };
    await writeFile(join(output, "summary.json"), JSON.stringify({ collectedAt: new Date().toISOString(), statistics, results }, null, 2));
    console.log(JSON.stringify(statistics, null, 2));
    await browser?.close();
    console.log(`Exploration results: ${output}`);
  }
  if (results.some((r) => !r.success)) process.exitCode = 1;
}
