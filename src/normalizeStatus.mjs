// One-off utility: normalizes the `status` column back to a clean integer
// string (e.g. "3" instead of "3.0").
//
// processCollectingPatients.mjs used to write `status` straight from the
// tabs/pending-list API with no conversion, and that endpoint returns it as
// a decimal-formatted string (e.g. "3.0") - unlike the myOrders/tab-2
// endpoint checkReferralSelectedStatus.mjs reads ("3"). A row stuck at
// "3.0" never matches WASLA_STATUS_TYPES' "3" key, so the /db page falls
// back to showing the raw value instead of a status name (see
// src/dbPageHtml.mjs's `WASLA_STATUS_TYPES[value] ?? value`). Collection now
// normalizes via Number(status) going forward (processCollectingPatients.mjs)
// - this script is for rows already written before that fix.
//
// Run from the project root (db.mjs resolves its DB path via
// process.cwd()):
//   node src/normalizeStatus.mjs              # scans every case
//   node src/normalizeStatus.mjs <referralId> [more ids...]

import { allPatientsStatement, getPatient, updatePatients } from "./db.mjs";

const requestedIds = process.argv.slice(2);

const rows = requestedIds.length
  ? requestedIds.map((id) => getPatient(id)).filter(Boolean)
  : allPatientsStatement.all();

if (!rows.length) {
  console.log("No matching patients found.");
  process.exit(0);
}

let normalizedCount = 0;
let skippedCount = 0;

for (const row of rows) {
  const { referralId, status } = row;

  if (status == null || status === "") {
    skippedCount++;
    continue;
  }

  const normalized = Number(status);

  if (!Number.isFinite(normalized)) {
    console.warn(
      `⚠️ referralId=${referralId} status=${JSON.stringify(status)} is not numeric, skipping.`,
    );
    skippedCount++;
    continue;
  }

  if (String(normalized) === String(status)) {
    skippedCount++;
    continue;
  }

  updatePatients({ referralId, status: normalized });
  console.log(
    `referralId=${referralId} status normalized: ${JSON.stringify(status)} -> ${normalized}`,
  );
  normalizedCount++;
}

console.log(
  `Done. normalized=${normalizedCount} skipped=${skippedCount} total=${rows.length}`,
);
