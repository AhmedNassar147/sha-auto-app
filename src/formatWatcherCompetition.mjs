/** Formats stored server acceptance timestamps for the watcher (Saudi time).
 * Ranking reflects acceptedAt, not proof of assignment priority.
 */
export default function formatWatcherCompetition(patient) {
  const code = (value) =>
    "`" + String(value ?? "Not available").replace(/[`\r\n]/g, " ") + "`";
  if (!patient?.competitionCheckedAt)
    return "\n\n⏱ Competition timings not available yet.";
  let fastest = [];
  try {
    const parsed = JSON.parse(patient.fastestTwo || "[]");
    if (Array.isArray(parsed)) fastest = parsed.slice(0, 2);
  } catch {}
  return (
    "\n\n⏱ *Acceptance times — Saudi server timestamps*\n" +
    (patient.navigationId
      ? `🔢 Case ID: ${code(patient.navigationId)}\n`
      : "") +
    `🏥 Our acceptance: ${code(patient.ourAcceptedAt)}\n` +
    `🏆 Winner: ${code(patient.winnerFacilityName)}\n` +
    `🕒 Winner acceptance: ${code(patient.winnerAcceptedAt)}\n` +
    "🏁 *Fastest two recorded acceptances:*\n" +
    (fastest.length
      ? fastest
          .map(
            (facility, index) =>
              `${index + 1}. ${code(facility.facilityName)} — ${code(facility.acceptedAt)}`,
          )
          .join("\n")
      : "Not available")
  );
}
