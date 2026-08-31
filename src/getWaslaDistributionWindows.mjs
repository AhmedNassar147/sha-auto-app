/*
 *
 * Helper: `getWaslaDistributionWindows`.
 *
 * Fetches the facility-review/acceptance/scope-expansion window minutes the
 * portal itself uses (facilityReviewWindowMinutes, acceptanceWindowMinutes,
 * extendScopeWindowMinutes) from the real weslah.seha.sa lookup endpoint,
 * mirroring `useGetDistributionWindowsQuery` (date-BSPZ9QK5.js:244-247,
 * aliased Wt/k) which the bundle's own countdown timer
 * (ReviewWindowTimer-DAyGxrbR.js) reads facilityReviewWindowMinutes from,
 * falling back to 15/60/135 only if a field is missing.
 *
 * UNVERIFIED: the exact base path (`${BASE_WASLA_API_URL}/lookup/
 * distribution-windows`) is inferred from the bundle's relative query URL
 * ("/lookup/distribution-windows") plus BASE_WASLA_API_URL - unlike
 * facility/tabs, this hasn't been confirmed against a live response yet.
 *
 * The real query has `keepUnusedDataFor: Infinity` - the portal fetches
 * this once per session and reuses it forever, since it's a slow-changing
 * policy config, not something tied to any specific case. This module
 * mirrors that with a simple in-memory cache: call getWaslaDistributionWindows
 * as often as you like, only the first (successful) call actually hits the
 * network.
 *
 */
import createConsoleMessage from "./createConsoleMessage.mjs";
import {
  baseWaslaHeaders,
  ALLOWED_MINUTES_TO_REVIEW_PATIENTS,
  API_URLS,
} from "./constants.mjs";

const { DISTRIBUTION_WINDOWS_URL } = API_URLS;

const DEFAULT_WINDOWS = {
  facilityReviewWindowMinutes: ALLOWED_MINUTES_TO_REVIEW_PATIENTS,
  acceptanceWindowMinutes: 60,
  extendScopeWindowMinutes: 135,
};

let cachedWindows = null;

const fetchDistributionWindows = async (frame) =>
  frame.evaluate(
    async ({ url, baseHeaders }) => {
      // persist:auth is redux-persist's default per-key JSON encoding, so
      // the stored "token" field is itself a JSON-encoded string - hence
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
          method: "GET",
          credentials: "include",
          headers: { ...baseHeaders, ...getAuthHeaders() },
        });

        if (!res.ok) {
          return { success: false, message: `Status ${res.status}` };
        }

        const json = await res.json();

        return { success: true, data: json?.data ?? json };
      } catch (error) {
        return { success: false, message: error?.message || String(error) };
      }
    },
    { url: DISTRIBUTION_WINDOWS_URL, baseHeaders: baseWaslaHeaders },
  );

/**
 * Returns the portal's review/acceptance/scope-expansion window minutes,
 * fetching them once via `frame` and caching the result in memory for the
 * rest of the process lifetime (only a successful fetch is cached - a
 * failure falls back to defaults for that call but leaves the cache empty
 * so the next call retries).
 *
 * @param {import("puppeteer").Frame} frame - The Wasla widget's iframe
 *   frame, from getWaslaReferralFrame.mjs.
 * @returns {Promise<{
 *   facilityReviewWindowMinutes: number,
 *   acceptanceWindowMinutes: number,
 *   extendScopeWindowMinutes: number,
 * }>}
 */
const getWaslaDistributionWindows = async (frame) => {
  if (cachedWindows) return cachedWindows;

  const result = await fetchDistributionWindows(frame).catch((error) => ({
    success: false,
    message: error?.message || String(error),
  }));

  if (!result?.success) {
    createConsoleMessage(
      "error",
      result?.message,
      "⚠️ getWaslaDistributionWindows failed, using defaults",
    );
    return { ...DEFAULT_WINDOWS };
  }

  cachedWindows = {
    facilityReviewWindowMinutes:
      result.data?.facilityReviewWindowMinutes ??
      DEFAULT_WINDOWS.facilityReviewWindowMinutes,
    acceptanceWindowMinutes:
      result.data?.acceptanceWindowMinutes ??
      DEFAULT_WINDOWS.acceptanceWindowMinutes,
    extendScopeWindowMinutes:
      result.data?.extendScopeWindowMinutes ??
      DEFAULT_WINDOWS.extendScopeWindowMinutes,
  };

  return cachedWindows;
};

export default getWaslaDistributionWindows;
