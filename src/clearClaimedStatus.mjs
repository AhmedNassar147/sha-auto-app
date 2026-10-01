// One-off utility: resets a patient's `claimed` column back to NULL so
// getCasesWithEmptyClaimStatus() picks it up again for a fresh
// checkReferralSelectedStatus.mjs check.
//
// Run from the project root (db.mjs resolves its DB path via
// process.cwd()):
//   node scripts/clearClaimedStatus.mjs 5AW0BELHL51HPFI [more ids...]

import { clearClaimedStatus, getPatient } from "./db.mjs";

const referralIds = process.argv.slice(2);

if (!referralIds.length) {
  console.error(
    "Usage: node src/clearClaimedStatus.mjs <referralId> [more ids...]",
  );
  process.exit(1);
}

for (const referralId of referralIds) {
  const before = getPatient(referralId);

  if (!before) {
    console.warn(`⚠️ No patient found for referralId=${referralId}`);
    continue;
  }

  console.log(
    `referralId=${referralId} claimed before: ${JSON.stringify(before.claimed)}`,
  );
}

clearClaimedStatus(referralIds);

for (const referralId of referralIds) {
  const after = getPatient(referralId);
  if (after) {
    console.log(
      `referralId=${referralId} claimed after: ${JSON.stringify(after.claimed)}`,
    );
  }
}
