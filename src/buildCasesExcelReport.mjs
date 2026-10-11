/*
 *
 * Helper: `buildCasesExcelReport`.
 *
 * Builds an .xlsx report of the given patient rows (whatever the /db page's
 * filters currently match, see index.mjs's /db/export-excel route) for its
 * "Send Excel" button - one row per case, in the fixed column order:
 * Order, Referral ID, National ID, Patient Name, Referral Date, Specialty,
 * Region, Status. Status is shown as its human-readable name
 * (WASLA_STATUS_TYPES), not the raw numeric code, with a background fill
 * mirroring the /db page's own badge colors (green for a claimed-like
 * outcome, red for a rejected/withdrawn-like one, grey otherwise).
 *
 */
import ExcelJS from "exceljs";
import { WASLA_STATUS_TYPES } from "./constants.mjs";

// Same green/red/neutral split as dbPageHtml.mjs's badgeClassFor, just
// keyed on the WASLA_STATUS_TYPES label instead of a generic value, and
// expressed as ARGB hex (ExcelJS's fill/font color format) instead of CSS
// variables.
const GREEN_STATUS_LABELS = new Set(["Confirmed", "ConfirmedArrival"]);
const RED_STATUS_LABELS = new Set([
  "Rejected",
  "RejectedByCNHI",
  "Withdrawn",
  "AnotherFacilityApproved",
]);

const FILL_ARGB = {
  green: "FF123A2A",
  red: "FF3A1420",
  neutral: "FF263047",
};
const FONT_ARGB = {
  green: "FF4ADE80",
  red: "FFF87171",
  neutral: "FFB9C2D9",
};

const statusColorKeyFor = (statusLabel) => {
  if (GREEN_STATUS_LABELS.has(statusLabel)) return "green";
  if (RED_STATUS_LABELS.has(statusLabel)) return "red";
  return "neutral";
};

/**
 * @param {object[]} rows - Patient rows (patients.db shape), already
 *   filtered by the caller.
 * @returns {Promise<Buffer>}
 */
const buildCasesExcelReport = async (rows) => {
  const workbook = new ExcelJS.Workbook();
  const worksheet = workbook.addWorksheet("Cases");

  worksheet.columns = [
    { header: "Order", key: "order", width: 8 },
    { header: "Referral Date", key: "referralDate", width: 20 },
    { header: "Referral ID", key: "referralId", width: 20 },
    { header: "National ID", key: "patientNationalId", width: 16 },
    { header: "Patient Name", key: "patientName", width: 24 },
    { header: "Specialty", key: "specialty", width: 18 },
    { header: "Region", key: "providerRegion", width: 16 },
    { header: "Status", key: "status", width: 20 },
  ];

  worksheet.getRow(1).font = { bold: true };
  worksheet.getRow(1).alignment = { vertical: "middle" };

  rows.forEach((row, index) => {
    const statusLabel =
      WASLA_STATUS_TYPES[Number(row.status)] || row.status || "";

    const excelRow = worksheet.addRow({
      order: index + 1,
      referralDate: row.referralDate,
      referralId: row.referralId,
      patientNationalId: row.patientNationalId,
      patientName: row.patientName,
      specialty: row.specialty,
      providerRegion: row.providerRegion,
      status: statusLabel,
    });

    const colorKey = statusColorKeyFor(statusLabel);
    const statusCell = excelRow.getCell("status");

    statusCell.fill = {
      type: "pattern",
      pattern: "solid",
      fgColor: { argb: FILL_ARGB[colorKey] },
    };
    statusCell.font = { color: { argb: FONT_ARGB[colorKey] }, bold: true };
  });

  return workbook.xlsx.writeBuffer();
};

export default buildCasesExcelReport;
