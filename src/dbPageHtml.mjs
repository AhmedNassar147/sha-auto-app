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
import { WASLA_STATUS_TYPES } from "./constants.mjs";

const COLUMN_LABELS = {
  referralDate: "Referral Date",
  navigationId: "Navigation ID",
  referralId: "Referral ID",
  referralReferenceId: "Reference ID",
  patientName: "Patient Name",
  patientNationalId: "National ID",
  status: "Status",
  userActionName: "Action",
  claimed: "Claimed",
  providerAction: "Provider Action",
  referralType: "Referral Type",
  referralReason: "Reason",
  providerRegion: "Region",
  broadcastedAt: "Broadcasted At",
  referralStartDate: "Start Date",
  referralEndDate: "End Date",
  referralEndTimestamp: "End Timestamp",
  letterType: "Letter Type",
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
};

const COLUMNS = [
  "referralDate",
  "broadcastedAt",
  "referralEndDate",
  "navigationId",
  "referralId",
  "referralReferenceId",
  "patientNationalId",
  "patientName",
  "referralType",
  "referralReason",
  "providerRegion",
  "status",
  "claimed",
  "isSent",
  "isReceived",
  "payerAction",
  "userActionName",
  "scheduledAt",
  "providerAction",
  "paid",
  "facilityReviewWindowMinutes",
  "acceptanceWindowMinutes",
  "extendScopeWindowMinutes",
  "letterType",
  "transferUrl",
  "tabName",
  "createdAt",
  "updatedAt",
];

// "status" is handled separately in renderCell (needs the WASLA_STATUS_TYPES
// code->label mapping first), so it's deliberately not in this set.
const STATUS_BADGE_COLUMNS = new Set([
  "userActionName",
  "claimed",
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

const renderCell = (column, value) => {
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

const renderRows = (rows) => {
  if (!rows.length) {
    return `<tr><td colspan="${COLUMNS.length}"><div class="state-msg">No cases match these filters.</div></td></tr>`;
  }
  return rows
    .map(
      (row) =>
        `<tr>${COLUMNS.map((col) => `<td>${renderCell(col, row[col])}</td>`).join("")}</tr>`,
    )
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
 * @param {string} [params.filters.status] - A WASLA_STATUS_TYPES code.
 * @param {string} [params.filters.referralDate] - "YYYY-MM-DD", labeled
 *   "Referral Date" in the UI.
 * @param {string} [params.filters.paid] - "1" (Yes) or "0" (No).
 * @returns {string}
 */
const renderDbPage = ({ rows, filters = {} }) => {
  const {
    referralId = "",
    patientNationalId = "",
    navigationId = "",
    status = "",
    referralDate = "",
    paid = "",
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
    min-width: 170px;
    outline: none;
  }
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
  .meta-row {
    padding: 0 24px 10px;
    color: var(--muted);
    font-size: 12px;
  }
  .table-wrap {
    margin: 0 24px 24px;
    border: 1px solid var(--panel-border);
    border-radius: 12px;
    overflow: auto;
    background: var(--panel);
    max-height: calc(100vh - 210px);
  }
  table { border-collapse: collapse; width: 100%; font-size: 12.5px; white-space: nowrap; }
  thead th {
    position: sticky;
    top: 0;
    background: #1a2136;
    color: var(--text);
    text-align: left;
    padding: 10px 12px;
    font-weight: 600;
    text-transform: uppercase;
    font-size: 10.5px;
    letter-spacing: 0.04em;
    border-bottom: 1px solid var(--panel-border);
    z-index: 1;
  }
  tbody td {
    padding: 8px 12px;
    border-bottom: 1px solid var(--panel-border);
    max-width: 260px;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  tbody tr:nth-child(even) { background: var(--row-alt); }
  tbody tr:hover { background: var(--row-hover); }
  .badge { display: inline-block; padding: 2px 8px; border-radius: 999px; font-size: 11px; font-weight: 600; }
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
      <label for="f-status">Status</label>
      <select id="f-status" name="status">${renderStatusOptions(status)}</select>
    </div>
    <div class="field">
      <label for="f-referralDate">Referral Date</label>
      <input id="f-referralDate" name="referralDate" type="date" value="${escapeHtml(referralDate)}" />
    </div>
    <div class="field">
      <label for="f-paid">Paid</label>
      <select id="f-paid" name="paid">
        <option value="">All</option>
        <option value="1"${paid === "1" ? " selected" : ""}>Yes</option>
        <option value="0"${paid === "0" ? " selected" : ""}>No</option>
      </select>
    </div>
    <div class="actions">
      <a class="btn-link secondary" href="/db">Clear</a>
      <button type="submit">Filter</button>
    </div>
  </form>

  <div class="meta-row">${rows.length} row${rows.length === 1 ? "" : "s"}</div>

  <div class="table-wrap">
    <table>
      <thead>
        <tr>${COLUMNS.map((col) => `<th>${COLUMN_LABELS[col] || col}</th>`).join("")}</tr>
      </thead>
      <tbody>${renderRows(rows)}</tbody>
    </table>
  </div>
</body>
</html>`;
};

export default renderDbPage;
