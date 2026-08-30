/*
 *
 * Helper: `getLastThursdayToWednesdayRange`.
 *
 */
import getFormattedDateForSummary from "./getFormattedDateForSummary.mjs";

// this for weekly report dates

const getLastThursdayToWednesdayRange = (baseDate = new Date()) => {
  // baseDate should be the Thursday run time
  const end = new Date(baseDate);
  end.setDate(end.getDate() - 1); // Wednesday
  end.setHours(23, 59, 59, 999);

  const start = new Date(baseDate);
  start.setDate(start.getDate() - 7); // last Thursday
  start.setHours(0, 0, 0, 0);

  // Match your stored format: "YYYY-MM-DDTHH:mm:ss" (no milliseconds, no Z)
  const toDbIso = (d) => d.toISOString().slice(0, 19);

  return {
    start: toDbIso(start),
    end: toDbIso(end),
    summaryStart: getFormattedDateForSummary(start),
    summaryEnd: getFormattedDateForSummary(new Date()),
  };
};

export default getLastThursdayToWednesdayRange;
