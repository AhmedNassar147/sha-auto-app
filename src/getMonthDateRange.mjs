/**
 *
 * Helper: `getMonthDateRange`.
 *
 */
import getFormattedDateForSummary from "./getFormattedDateForSummary.mjs";

const getMonthDateRange = (useCurrentMonth) => {
  const now = new Date();

  const year = now.getFullYear();
  const currentMonth = now.getMonth();

  let first;
  let lastForDb;
  let last;

  if (useCurrentMonth) {
    // ✅ Current month
    first = new Date(year, currentMonth, 1);
    lastForDb = new Date(year, currentMonth + 1, 0);
    last = new Date(year, currentMonth + 1, 1);
  } else {
    // Previous month
    first = new Date(year, currentMonth - 1, 1);
    lastForDb = new Date(year, currentMonth, 0);
    last = new Date(year, currentMonth, 1);
  }

  const summaryStart = getFormattedDateForSummary(first);
  const summaryEnd = getFormattedDateForSummary(last);

  return {
    start: `${summaryStart}T00:00:00`,
    end: `${getFormattedDateForSummary(lastForDb)}T23:59:59`,
    summaryStart: summaryStart,
    summaryEnd: summaryEnd,
  };
};

export default getMonthDateRange;
