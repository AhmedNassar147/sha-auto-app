/** Counts confirmed winners among the filtered local cases, not portal totals. */
export default function summarizeDbWinners(rows) {
  const winners = new Map();
  let checked = 0;
  let noWinner = 0;
  for (const row of rows) {
    if (!row.competitionCheckedAt) continue;
    checked++;
    if (!row.winnerFacilityId) {
      noWinner++;
      continue;
    }
    const key = String(row.winnerFacilityId);
    const item = winners.get(key) || {
      facilityId: key,
      facilityName: row.winnerFacilityName || key,
      count: 0,
    };
    item.count++;
    winners.set(key, item);
  }
  const resolved = checked - noWinner;
  return {
    total: rows.length,
    checked,
    unchecked: rows.length - checked,
    noWinner,
    resolved,
    winners: [...winners.values()]
      .sort((a, b) => b.count - a.count)
      .map((item) => ({
        ...item,
        percent: resolved ? ((100 * item.count) / resolved).toFixed(1) : "0.0",
      })),
  };
}
