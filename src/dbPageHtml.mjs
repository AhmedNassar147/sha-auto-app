/*
 *
 * Helper: `renderDbPage`.
 *
 * Self-contained, server-rendered admin page (inline CSS, no build step,
 * no client-side JS - matches this repo's "no bundler" setup) for a single
 * GET /db route. Renders every column of the `patients` table (db.mjs) for
 * whatever rows the caller already fetched, plus a plain GET filter form
 * (referralId/patientNationalId/navigationId as partial matches, status as
 * an exact match against the fixed WASLA_STATUS_TYPES codes) that reloads
 * the same page with new query params rather than calling out to a
 * separate API endpoint.
 *
 */
import {
  WASLA_STATUS_TYPES,
  WASLA_REFERRAL_VIEW_URL,
  WASLA_APP_URL,
} from "./constants.mjs";

const COLUMN_LABELS = {
  openCase: "",
  facilityRes: "Facility Responses",
  referralDate: "Referral Date",
  navigationId: "Navigation ID",
  referralId: "Referral ID",
  referralReferenceId: "Reference ID",
  patientName: "Patient Name",
  patientNationalId: "National ID",
  status: "Status",
  winnerFacilityName: "Winning Facility",
  ourAcceptedAt: "Our Acceptance Time (Saudi)",
  fastestFirst: "1st Acceptance (Server Time)",
  fastestSecond: "2nd Acceptance (Server Time)",
  caseAttachmentId: "Case Attachment ID",
  letterType: "Letter Type",
  userActionName: "Action",
  claimed: "Claimed",
  arrived: "Arrived",
  providerAction: "Provider Action",
  referralType: "Referral Type",
  referralReason: "Reason",
  providerRegion: "Region",
  broadcastedAt: "Broadcasted At",
  referralStartDate: "Start Date",
  referralEndDate: "End Date",
  referralEndTimestamp: "End Timestamp",
  isSent: "Sent",
  payerAction: "Payer Action",
  isReceived: "Received",
  paid: "Paid",
  scheduledAt: "Scheduled At",
  facilityReviewWindowMinutes: "Review Window (min)",
  acceptanceWindowMinutes: "Acceptance Window (min)",
  extendScopeWindowMinutes: "Extend Scope Window (min)",
  transferUrl: "Transfer",
  tabName: "Tab",
  createdAt: "Saved At",
  updatedAt: "Updated At",
  nationality: "Nationality",
  specialty: "Specialty",
  subReferralTypeName: "Sub Referral Type",
  subSpecialty: "Sub-specialty",
  sourceProvider: "Source Provider",
  mobileNumber: "Mobile",
  requestedBedType: "Requested Bed Type",
  note: "Note",
  medicalData: "Medical Data",
  attachmentTgFileId: "Attachment File ID",
  removeRow: "",
  decision: "Decision API",
};

const COLUMNS = [
  // Not a real `patients` column - renderCell builds this straight from
  // the row's navigationId (see below), ignoring row.openCase (undefined).
  "openCase",
  "facilityRes",
  "status",
  "winnerFacilityName",
  "ourAcceptedAt",
  "fastestFirst",
  "fastestSecond",
  "claimed",
  "arrived",
  "letterType",
  "caseAttachmentId",
  "paid",
  "patientName",
  "patientNationalId",
  "navigationId",
  "referralId",
  "referralDate",
  "tabName",
  "broadcastedAt",
  "referralEndDate",
  "referralReferenceId",
  "referralType",
  "referralReason",
  "providerRegion",
  "nationality",
  "specialty",
  "subReferralTypeName",
  "subSpecialty",
  "sourceProvider",
  "mobileNumber",
  "requestedBedType",
  "isSent",
  "isReceived",
  "payerAction",
  "userActionName",
  "note",
  "medicalData",
  "scheduledAt",
  "providerAction",
  "facilityReviewWindowMinutes",
  "acceptanceWindowMinutes",
  "extendScopeWindowMinutes",
  "transferUrl",
  "createdAt",
  "updatedAt",
  "attachmentTgFileId",
  // Not a real `patients` column - renderCell builds this from the row's
  // referralId (ignoring row.removeRow, undefined), same as "openCase"
  // above. Kept last so it's always the rightmost column.
  "removeRow",
  "decision",
];

// "status" is handled separately in renderCell (needs the WASLA_STATUS_TYPES
// code->label mapping first), so it's deliberately not in this set.
const STATUS_BADGE_COLUMNS = new Set([
  "userActionName",
  "claimed",
  "arrived",
  "isSent",
  "isReceived",
]);

const escapeHtml = (value) =>
  String(value).replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );

const badgeClassFor = (value) => {
  const v = String(value).toLowerCase();
  if (["accept", "accepted", "yes", "success"].includes(v))
    return "badge-green";
  if (["reject", "rejected", "no", "failed"].includes(v)) return "badge-red";
  return "badge-neutral";
};

const renderCell = (column, value, row) => {
  if (column === "winnerFacilityName") {
    if (!value && !row.winnerAcceptedAt)
      return '<span class="empty-cell">—</span>';
    return (
      `<div class="ranking-name" title="Facility ID: ${escapeHtml(row.winnerFacilityId ?? "—")}">${escapeHtml(value || "—")}</div>` +
      `<div class="ranking-time">${escapeHtml(row.winnerAcceptedAt || "—")}</div>`
    );
  }
  if (column === "facilityRes") {
    if (!row?.navigationId) return '<span class="empty-cell">—</span>';
    const url = escapeHtml(
      `${WASLA_APP_URL}/referral-cases/view/${encodeURIComponent(row.navigationId)}`,
    );
    return `<a class="btn-link secondary" href="${url}" target="_blank" rel="noopener noreferrer">View facility responses</a>`;
  }
  if (column === "fastestFirst" || column === "fastestSecond") {
    try {
      const facilities = row.fastestTwo ? JSON.parse(row.fastestTwo) : [];
      const facility = facilities[column === "fastestFirst" ? 0 : 1];
      if (!facility) return '<span class="empty-cell">—</span>';
      return (
        `<div class="ranking-name" title="Facility ID: ${escapeHtml(facility.facilityId)}">${escapeHtml(facility.facilityName)}</div>` +
        `<div class="ranking-time">${escapeHtml(facility.acceptedAt)}</div>`
      );
    } catch {
      return '<span class="empty-cell">Invalid stored timing data</span>';
    }
  }
  if (column === "decision") {
    if (!row?.referralId || !row?.navigationId) {
      return '<span class="empty-cell">—</span>';
    }
    const url = escapeHtml(
      `/db/decision/${encodeURIComponent(row.referralId)}`,
    );
    return `<button type="button" class="btn-link secondary" data-decision-url="${url}">Approve facility</button><pre class="decision-result" style="white-space:pre-wrap;max-width:400px"></pre>`;
  }
  if (column === "openCase") {
    if (!row?.navigationId) return '<span class="empty-cell">—</span>';
    const safeUrl = escapeHtml(
      `${WASLA_REFERRAL_VIEW_URL}/${row.navigationId}`,
    );
    return `<a class="btn-link secondary" href="${safeUrl}" target="_blank" rel="noopener">Open</a>`;
  }
  if (column === "removeRow") {
    if (!row?.referralId) return '<span class="empty-cell">—</span>';
    const safeUrl = `/db/delete/${encodeURIComponent(row.referralId)}`;
    // Real referralIds are always alphanumeric (validated the same way
    // elsewhere, e.g. performArrivalConfirmation.mjs) - stripped rather
    // than HTML-escaped here specifically because this value is embedded
    // inside a single-quoted JS string literal (the onsubmit attribute),
    // not plain HTML text; HTML-escaping a `'` to `&#39;` would just
    // decode back to a literal `'` once the browser parses the attribute,
    // still breaking out of the JS string.
    const jsSafeReferralId = String(row.referralId).replace(
      /[^A-Za-z0-9]/g,
      "",
    );
    // A POST form (not a GET link) since this is destructive - a GET
    // request shouldn't cause a side effect (crawlers/prefetch could
    // trigger it). The confirm() is the one bit of inline JS this
    // otherwise JS-free page uses, same tradeoff as any plain-HTML admin
    // page needing a delete confirmation.
    return (
      `<form method="POST" action="${safeUrl}" style="display:inline" ` +
      `onsubmit="return confirm('Delete referralId ${jsSafeReferralId}? This cannot be undone.')">` +
      `<button type="submit" class="btn-link danger">🗑 Remove</button>` +
      `</form>`
    );
  }
  if (value === null || value === undefined || value === "") {
    return '<span class="empty-cell">—</span>';
  }
  if (column === "status") {
    const label = WASLA_STATUS_TYPES[value] ?? value;
    return `<span class="badge ${badgeClassFor(label)}">${escapeHtml(label)}</span>`;
  }
  if (column === "paid") {
    const label = Number(value) === 1 ? "Yes" : "No";
    return `<span class="badge ${badgeClassFor(label)}">${label}</span>`;
  }
  if (STATUS_BADGE_COLUMNS.has(column)) {
    return `<span class="badge ${badgeClassFor(value)}">${escapeHtml(value)}</span>`;
  }
  if (column === "transferUrl") {
    const safe = escapeHtml(value);
    return `<a href="${safe}" target="_blank" rel="noopener" title="${safe}">link</a>`;
  }
  return `<span title="${escapeHtml(value)}">${escapeHtml(value)}</span>`;
};

// Highlights the row the referralId filter was actually looking for (exact
// match, case-insensitive) - the filter itself is a partial/LIKE match, so
// a search can still return several rows, and this makes the one that was
// actually typed in stand out among them rather than requiring a manual
// scan.
const renderRows = (rows, selectedReferralId) => {
  if (!rows.length) {
    return `<tr><td colspan="${COLUMNS.length}"><div class="state-msg">No cases match these filters.</div></td></tr>`;
  }
  const normalizedSelectedReferralId = selectedReferralId?.toLowerCase().trim();

  return rows
    .map((row) => {
      const isSelected =
        !!normalizedSelectedReferralId &&
        String(row.referralId ?? "").toLowerCase() ===
          normalizedSelectedReferralId;

      const isRejected = row.userActionName === "reject";

      const rowClasses = [
        isSelected ? "selected-row" : "",
        isRejected ? "rejected-row" : "",
      ]
        .filter(Boolean)
        .join(" ");

      return (
        `<tr class="${rowClasses}">` +
        COLUMNS.map(
          (col) =>
            `<td${["winnerFacilityName", "fastestFirst", "fastestSecond"].includes(col) ? ' class="ranking-cell"' : ""}>${renderCell(col, row[col], row)}</td>`,
        ).join("") +
        `</tr>`
      );
    })
    .join("");
};

const renderStatusOptions = (selectedStatus) =>
  `<option value="">All statuses</option>` +
  Object.entries(WASLA_STATUS_TYPES)
    .map(
      ([code, label]) =>
        `<option value="${code}"${code === String(selectedStatus) ? " selected" : ""}>${escapeHtml(label)}</option>`,
    )
    .join("");

/**
 * @param {object} params
 * @param {object[]} params.rows - Already-fetched rows to render.
 * @param {object} [params.filters]
 * @param {string} [params.filters.referralId]
 * @param {string} [params.filters.patientNationalId]
 * @param {string} [params.filters.navigationId]
 * @param {string} [params.filters.specialty] - Encoded specialty/sub-specialty pair.
 * @param {string} [params.filters.status] - A WASLA_STATUS_TYPES code.
 * @param {string} [params.filters.referralDate] - "YYYY-MM-DD", labeled
 *   "Referral Date" in the UI.
 * @param {string} [params.filters.paid] - "1" (Yes) or "0" (No).
 * @param {string} [params.filters.claimed] - "Yes" or "No".
 * @returns {string}
 */
const renderDbPage = ({
  rows,
  filters = {},
  winnerStatistics = null,
  letterStatistics = null,
  specialties = [],
  hospitals = [],
}) => {
  const {
    referralId = "",
    patientNationalId = "",
    navigationId = "",
    specialty = "",
    hospital = "",
    status = "",
    referralDate = "",
    paid = "",
    claimed = "",
  } = filters;

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<title>Cases DB</title>
<style>
  :root {
    --bg: #0f1420;
    --panel: #161d2e;
    --panel-border: #262f45;
    --text: #ffffff;
    --muted: #8b93a7;
    --accent: #4f8cff;
    --row-alt: #131a29;
    --row-hover: #1c2438;
    --badge-neutral-bg: #263047;
    --badge-neutral-text: #b9c2d9;
    --badge-green-bg: #123a2a;
    --badge-green-text: #4ade80;
    --badge-red-bg: #3a1420;
    --badge-red-text: #f87171;
  }
  * { box-sizing: border-box; }
  body {
    margin: 0;
    background: var(--bg);
    color: var(--text);
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
  }
  header { padding: 20px 24px 8px; }
  h1 { margin: 0 0 4px; font-size: 20px; font-weight: 700; letter-spacing: -0.01em; }
  .subtitle { color: var(--muted); font-size: 13px; }
  form.toolbar {
    display: flex;
    flex-wrap: wrap;
    gap: 10px;
    align-items: flex-end;
    padding: 16px 24px;
  }
  .field { display: flex; flex-direction: column; gap: 4px; }
  .field label {
    font-size: 11px;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    color: var(--muted);
  }
  .field input, .field select {
    background: var(--panel);
    border: 1px solid var(--text);
    color: var(--text);
    border-radius: 8px;
    padding: 8px 10px;
    font-size: 13px;
    outline: none;
  }
  .field input { min-width: 170px; }
  /* Dropdowns have a short, bounded set of options (Yes/No/All, a status
     name) - they don't need as much room as a free-text input. */
  .field select { min-width: 100px; }
  .field input:focus, .field select:focus { border-color: var(--accent); }
  .actions { display: flex; gap: 8px; margin-left: auto; }
  button, .btn-link {
    background: var(--accent);
    color: white;
    border: none;
    border-radius: 8px;
    padding: 9px 16px;
    font-size: 13px;
    font-weight: 600;
    cursor: pointer;
    text-decoration: none;
    display: inline-flex;
    align-items: center;
  }
  .btn-link.secondary {
    background: var(--panel);
    border: 1px solid var(--panel-border);
    color: var(--text);
  }
  .btn-link.danger {
    background: var(--badge-red-bg);
    color: var(--badge-red-text);
    border: 1px solid var(--badge-red-text);
  }
  .meta-row {
    padding: 0 24px 10px;
    font-size: 14px;
    font-weight: 700;
    color: var(--badge-green-text);
  }
  .table-wrap {
    margin: 0 24px 24px;
    border: 1px solid var(--panel-border);
    border-radius: 12px;
    overflow: auto;
    background: var(--panel);
    max-height: calc(100vh - 210px);
  }
  table { border-collapse: collapse; width: 100%; font-size: 12px; white-space: nowrap; }
  thead th {
    position: sticky;
    top: 0;
    background: #1a2136;
    color: var(--text);
    text-align: left;
    padding: 6px 8px;
    font-weight: 600;
    text-transform: uppercase;
    font-size: 10px;
    letter-spacing: 0.04em;
    border-bottom: 1px solid var(--panel-border);
    z-index: 1;
  }
  tbody td {
    padding: 4px 8px;
    border-bottom: 1px solid var(--panel-border);
    max-width: 200px;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  tbody td.ranking-cell {
    min-width: 210px;
    max-width: 260px;
    white-space: normal;
    overflow: visible;
    text-overflow: clip;
    padding: 10px 12px;
    vertical-align: top;
  }
  .ranking-name { font-weight: 600; line-height: 1.5; overflow-wrap: anywhere; }
  .ranking-time { white-space: nowrap; font-variant-numeric: tabular-nums; line-height: 1.5; }
  tbody tr:nth-child(even) { background: var(--row-alt); }
  tbody tr:hover { background: var(--row-hover); }
  tbody tr.rejected-row,
  tbody tr.rejected-row:nth-child(even) {
    background: rgba(248, 113, 113, 0.14);
  }
  tbody tr.rejected-row:hover { background: rgba(248, 113, 113, 0.22); }
  tbody tr.selected-row,
  tbody tr.selected-row:nth-child(even) {
    background: rgba(140, 180, 255, 0.4);
    box-shadow: inset 3px 0 0 var(--accent);
  }
  tbody tr.selected-row:hover { background: rgba(140, 180, 255, 0.5); }
  td .btn-link, td button { padding: 4px 10px; font-size: 12px; }
  .badge { display: inline-block; padding: 1px 7px; border-radius: 999px; font-size: 11px; font-weight: 600; }
  .badge-neutral { background: var(--badge-neutral-bg); color: var(--badge-neutral-text); }
  .badge-green { background: var(--badge-green-bg); color: var(--badge-green-text); }
  .badge-red { background: var(--badge-red-bg); color: var(--badge-red-text); }
  .empty-cell { color: var(--muted); }
  .state-msg { padding: 40px 24px; text-align: center; color: var(--muted); }
</style>
</head>
<body>
  <header>
    <h1>Cases Database</h1>
    <div class="subtitle">All referral cases stored locally (patients.db)</div>
  </header>

  <form class="toolbar" method="GET" action="/db">
    <div class="field">
      <label for="f-referralId">Referral ID</label>
      <input id="f-referralId" name="referralId" type="text" placeholder="e.g. 384325" value="${escapeHtml(referralId)}" />
    </div>
    <div class="field">
      <label for="f-patientNationalId">National ID</label>
      <input id="f-patientNationalId" name="patientNationalId" type="text" placeholder="e.g. 1234567890" value="${escapeHtml(patientNationalId)}" />
    </div>
    <div class="field">
      <label for="f-navigationId">Navigation ID</label>
      <input id="f-navigationId" name="navigationId" type="text" value="${escapeHtml(navigationId)}" />
    </div>
    <div class="field">
      <label for="f-specialty">Sub-specialty / Specialty</label>
      <select id="f-specialty" name="specialty" onchange="this.form.submit()">
        <option value="">All specialties</option>
        ${specialties.map((item) => `<option value="${escapeHtml(item.value)}"${item.value === specialty ? " selected" : ""}>${escapeHtml(item.label)}</option>`).join("")}
      </select>
    </div>
    <div class="field">
      <label for="f-hospital">Winning hospital</label>
      <select id="f-hospital" name="hospital" onchange="this.form.submit()">
        <option value="">All hospitals</option>
        ${hospitals.map((item) => `<option value="${escapeHtml(item.value)}"${String(item.value) === String(hospital) ? " selected" : ""}>${escapeHtml(item.label)}</option>`).join("")}
      </select>
    </div>
    <div class="field">
      <label for="f-status">Status</label>
      <select id="f-status" name="status" onchange="this.form.submit()">${renderStatusOptions(status)}</select>
    </div>
    <div class="field">
      <label for="f-referralDate">Referral Date</label>
      <input id="f-referralDate" name="referralDate" type="date" value="${escapeHtml(referralDate)}" />
    </div>
    <div class="field">
      <label for="f-paid">Paid</label>
      <select id="f-paid" name="paid" onchange="this.form.submit()">
        <option value="">All</option>
        <option value="1"${paid === "1" ? " selected" : ""}>Yes</option>
        <option value="0"${paid === "0" ? " selected" : ""}>No</option>
      </select>
    </div>
    <div class="field">
      <label for="f-claimed">Claimed</label>
      <select id="f-claimed" name="claimed" onchange="this.form.submit()">
        <option value="">All</option>
        <option value="Yes"${claimed === "Yes" ? " selected" : ""}>Yes</option>
        <option value="No"${claimed === "No" ? " selected" : ""}>No</option>
      </select>
    </div>
    <div class="actions">
      <a class="btn-link secondary" href="/db">Clear</a>
      <button type="submit">Filter</button>
      <button type="submit" name="statistics" value="1" class="btn-link secondary">📊 Winner statistics</button>
      <button type="submit" name="letterStatistics" value="1" class="btn-link secondary">📋 Letter type analysis</button>
      <button
        type="submit"
        formaction="/db/export-excel"
        formmethod="POST"
        class="btn-link secondary"
        title="Send an Excel export of the currently filtered cases to the active/watcher Telegram chat"
      >
        📊 Send Excel
      </button>
    </div>
  </form>

  ${
    winnerStatistics
      ? `<section style="background:var(--panel);padding:18px;border:1px solid var(--panel-border);border-radius:12px;margin-bottom:20px">
    <h2>Winning facilities — current filters</h2>
    <p>Total cases: ${winnerStatistics.total} · Checked: ${winnerStatistics.checked} · Not checked: ${winnerStatistics.unchecked} · No unique winner: ${winnerStatistics.noWinner}</p>
    <p>Percentages use ${winnerStatistics.resolved} cases with a known unique winner. These are local DB cases, not all portal cases.</p>
    <table><thead><tr><th>Facility</th><th>Cases won</th><th>Share</th></tr></thead><tbody>
    ${winnerStatistics.winners.map((item) => `<tr><td title="Facility ID: ${escapeHtml(item.facilityId)}">${escapeHtml(item.facilityName)}</td><td>${item.count}</td><td>${item.percent}%</td></tr>`).join("") || '<tr><td colspan="3">No stored winners yet. Run yarn fill-db.</td></tr>'}
    </tbody></table></section>`
      : ""
  }

  ${
    letterStatistics
      ? `<section style="background:var(--panel);padding:18px;border:1px solid var(--panel-border);border-radius:12px;margin-bottom:20px">
    <h2>Letter type analysis — acceptance cases only</h2>
    <p>${letterStatistics.total} acceptance cases matching current filters. Rejected/withdrawn rows excluded. Win rate = won / (won + lost); unresolved cases excluded from the percentage.</p>
    <table><thead><tr><th>Letter type</th><th>Acceptance cases</th><th>Won</th><th>Lost</th><th>Unresolved</th><th>Win rate</th></tr></thead><tbody>
    ${letterStatistics.groups.map((item) => `<tr><td>${escapeHtml(item.letterType)}</td><td>${item.total}</td><td>${item.won}</td><td>${item.lost}</td><td>${item.unresolved}</td><td>${item.winRate === null ? "—" : item.winRate + "%"}</td></tr>`).join("") || '<tr><td colspan="6">No acceptance cases match the filters.</td></tr>'}
    </tbody></table>
    <p>This comparison does not prove that the letter type caused a win or loss.</p>
  </section>`
      : ""
  }

  <div class="meta-row">Total Results ${rows.length}</div>

  <div class="table-wrap">
    <table>
      <thead>
        <tr>${COLUMNS.map((col) => `<th>${COLUMN_LABELS[col] || col}</th>`).join("")}</tr>
      </thead>
      <tbody>${renderRows(rows, referralId)}</tbody>
    </table>
  </div>
<script>
document.addEventListener("click", async (event) => {
  const button = event.target.closest("button[data-decision-url]");
  if (!button || button.disabled) return;
  button.disabled = true;
  const output = button.nextElementSibling;
  output.textContent = "Opening case and submitting facility approval…";
  try {
    const response = await fetch(button.dataset.decisionUrl, {
      method: "POST",
    });
    const bodyText = await response.text();
    try {
      const result = JSON.parse(bodyText);
      output.textContent = JSON.stringify(result, null, 2);
    } catch {
      output.textContent = "HTTP " + response.status + " " + response.statusText +
        "\\n" + (bodyText || "Empty response body");
    }
  } catch (error) {
    output.textContent = error.message;
  } finally {
    button.disabled = false;
  }
});
</script>
</body>
</html>`;
};

export default renderDbPage;
