/*
 *
 * Helper: `getAllWaslaCasesFromHiddenDashboard`.
 *
 * Same shape/pattern as getWaslaCasesFromAPI.mjs - calls via
 * `frame.evaluate()` so the request goes out through Chrome's real network
 * stack (real cookies via credentials: "include", real TLS fingerprint),
 * rather than a plain Node `fetch()` - but hits API_URLS.ALL_REFERRALS_TABS
 * (not facility-scoped) instead of CASES_LIST.
 *
 */
import { API_URLS, baseWaslaHeaders } from "./constants.mjs";

/**
 * @param {import("puppeteer").Frame} frame
 * @param {object} [options]
 * @param {1 | 2} [options.tab=1]
 * @param {number} [options.pageNumber=1]
 * @param {number} [options.pageSize=100]
 * @returns {Promise<{
 *   success: boolean,
 *   patients: object[],
 *   totalRowsCount: number,
 *   message?: string,
 *   requestStartedAtMs?: number,
 *   headersReceivedAtMs?: number,
 *   serverDate?: string | null,
 * }>}
 */
const getAllWaslaCasesFromHiddenDashboard = async (frame, options = {}) => {
  const {
    tab = 1,
    pageNumber = 1,
    pageSize = 100,
    sortField = "CreatedDate",
    sortDirection = "DESC",
  } = options;

  const body = JSON.stringify({
    pageNumber,
    pageSize,
    sortField,
    sortDirection,
    tab,
  });

  return await frame.evaluate(
    async ({ url, baseHeaders, body }) => {
      const getAuthHeaders = () => {
        try {
          const rawAuth = localStorage.getItem("persist:auth");
          if (!rawAuth) return {};

          const parsedAuth = JSON.parse(rawAuth);
          const token = parsedAuth?.token ? JSON.parse(parsedAuth.token) : null;

          return {
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
            culture: localStorage.getItem("i18nextLng") || "en",
          };
        } catch {
          return {};
        }
      };

      const requestStartedAtMs = Date.now();

      try {
        const res = await fetch(url, {
          method: "POST",
          credentials: "include",
          headers: { ...baseHeaders, ...getAuthHeaders() },
          body: body,
        });

        const headersReceivedAtMs = Date.now();
        const serverDate = res.headers.get("Date");

        if (!res.ok) {
          return {
            success: false,
            patients: [],
            totalRowsCount: 0,
            message: `Status ${res.status}`,
            requestStartedAtMs,
            headersReceivedAtMs,
            serverDate,
          };
        }

        const json = await res.json();
        const isSuccess = (json?.message || "") === "Success";

        return {
          success: isSuccess,
          patients: isSuccess ? json?.data || [] : [],
          totalRowsCount: json?.totalRowsCount ?? 0,
          message: json?.message,
          requestStartedAtMs,
          headersReceivedAtMs,
          serverDate,
        };
      } catch (error) {
        return {
          success: false,
          patients: [],
          totalRowsCount: 0,
          message: error?.message || String(error),
          requestStartedAtMs,
          headersReceivedAtMs: null,
          serverDate: null,
        };
      }
    },
    { url: API_URLS.ALL_REFERRALS_TABS, baseHeaders: baseWaslaHeaders, body },
  );
};

export default getAllWaslaCasesFromHiddenDashboard;
