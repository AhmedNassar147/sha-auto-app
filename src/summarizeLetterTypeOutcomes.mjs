/** Compare recorded acceptance outcomes by letter type, within current filters.
 * Pending outcomes do not enter the win-rate denominator. Withdrawn/rejected
 * rows are excluded even if an old action field still says accept.
 */
export default function summarizeLetterTypeOutcomes(rows) {
  const groups = new Map();
  let total = 0;
  for (const row of rows) {
    if (String(row.userActionName ?? "").trim().toLowerCase() !== "accept" ||
        [2, 5].includes(Number(row.status))) continue;
    total++;
    const type = String(row.letterType ?? "").trim() || "Unspecified";
    const group = groups.get(type) || { letterType: type, total: 0, won: 0, lost: 0, unresolved: 0 };
    group.total++;
    if (row.claimed === "Yes" && ![3, 6, 7].includes(Number(row.status))) group.won++;
    else if (row.claimed === "No" && [6, 7].includes(Number(row.status))) group.lost++;
    else group.unresolved++;
    groups.set(type, group);
  }
  return { total, groups: [...groups.values()]
    .sort((a, b) => a.letterType.localeCompare(b.letterType))
    .map((group) => ({ ...group,
      winRate: group.won + group.lost
        ? (100 * group.won / (group.won + group.lost)).toFixed(1) : null,
    })),
  };
}
