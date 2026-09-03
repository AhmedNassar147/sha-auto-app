/*
 *
 * Helper: `getWaslaCasesFromAPI`.
 *
 * Calls the Wasla widget's own `facility/tabs` list endpoint directly via
 * `frame.evaluate`, bypassing the UI. Confirmed against the real
 * weslah.seha.sa bundle (FacilityReferralsPage-B_XHVj97.js): tab 1 =
 * "referralCases" (incoming/pending), tab 2 = "myOrders" (already acted on,
 * carries a `status` field). Auth is a Bearer token the widget itself
 * persists to its own localStorage under the redux-persist key
 * "persist:auth" — read from there rather than passed in, since it only
 * exists inside the iframe's own origin.
 *
 */
import { API_URLS, baseWaslaHeaders } from "./constants.mjs";

/**
 * @param {import("puppeteer").Frame} frame - The Wasla widget's iframe
 *   frame, from getWaslaReferralFrame.mjs.
 * @param {object} [options]
 * @param {1 | 2} [options.tab=1] - 1 = referralCases (pending), 2 = myOrders.
 * @param {number} [options.pageNumber=1]
 * @param {number} [options.pageSize=100]
 * @param {string} [options.sortField="CreatedDate"]
 * @param {"ASC" | "DESC"} [options.sortDirection="DESC"]
 * @param {string} [options.searchReferralID]
 * @returns {Promise<{
 *   success: boolean,
 *   patients: object[],
 *   totalRowsCount: number,
 *   message?: string,
 *   needsLogin?: boolean
 * }>}
 */
const getWaslaCasesFromAPI = async (frame, options = {}) => {
  const {
    tab = 1,
    pageNumber = 1,
    pageSize = 100,
    sortField = "CreatedDate",
    sortDirection = "DESC",
    ...filters
  } = options;

  const body = JSON.stringify({
    pageNumber,
    pageSize,
    sortField,
    sortDirection,
    tab,
    ...filters,
  });

  return await frame.evaluate(
    async ({ url, baseHeaders, body }) => {
      // persist:auth is redux-persist's default per-key JSON encoding, so
      // the stored "token" field is itself a JSON-encoded string — hence
      // the double JSON.parse. Runs inside the frame, can't import helpers.
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

      try {
        const res = await fetch(url, {
          method: "POST",
          credentials: "include",
          headers: { ...baseHeaders, ...getAuthHeaders() },
          body: body,
        });

        if (!res.ok) {
          return {
            success: false,
            patients: [],
            // needsLogin: true,
            totalRowsCount: 0,
            message: `Response was not valid JSON, session expired, Status ${res.status}`,
          };
        }

        const json = await res.json();
        const message = json?.message || "listing api didn't return a message";
        const isSuccess = message === "Success";

        if (!isSuccess) {
          return {
            success: isSuccess,
            patients: [],
            totalRowsCount: json?.totalRowsCount ?? 0,
            message: message,
            // needsLogin: true,
          };
        }

        return {
          success: isSuccess,
          patients: json?.data || [],
          totalRowsCount: json?.totalRowsCount ?? 0,
          needsLogin: false,
        };
      } catch (error) {
        // A bare fetch() throw (e.g. "Failed to fetch") means the request
        // never got an HTTP response at all - network blip, frame torn down
        // mid-request, etc. That's not evidence the session expired (unlike
        // the !res.ok branch above, which did get a response and can reject
        // it), so don't force a fresh login off of it - let the caller just
        // retry.
        return {
          success: false,
          patients: [],
          needsLogin: false,
          message: error?.message || String(error),
          totalRowsCount: 0,
        };
      }
    },
    { url: API_URLS.CASES_LIST, baseHeaders: baseWaslaHeaders, body },
  );
};

export default getWaslaCasesFromAPI;
