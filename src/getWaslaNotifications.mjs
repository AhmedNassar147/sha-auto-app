/*
 *
 * Helper: `getWaslaNotifications`.
 *
 * Calls the Wasla widget's own `/notifications` endpoint directly via
 * `frame.evaluate`, the same way getWaslaCasesFromAPI.mjs does. Confirmed
 * against the real weslah.seha.sa bundle (useReferralListNotifications-
 * Ddem8nev.js, injected into the same "referralApi" RTK slice as the cases
 * list — same https://weslah.seha.sa/api base, NOT under /referrals):
 *
 *   GET  /notifications
 *   POST /notifications/:id/dismiss
 *
 * The response shape itself is UNVERIFIED beyond "has a data array" - the
 * bundle only shows the client reading `notification.type` (a numeric enum:
 * 1 = Withdrawal, 2 = TransferRejected, 3 = TransferReturned),
 * `referralId`, `facilityName`, `referralReferenceId`, `title`, `message`/
 * `details`/`notes`, and `id` (used for dismissal) - these are read as raw
 * fields here rather than fully typed, same caution as
 * getWaslaPatientReferralDataFromAPI.mjs.
 *
 * These are administrative alerts about cases already in progress
 * (withdrawn facility, a transfer rejected/returned) - NOT a feed of new
 * incoming referrals, so this doesn't replace the facility/tabs poll.
 *
 */
import { API_URLS, baseWaslaHeaders } from "./constants.mjs";

export const NOTIFICATION_TYPES = {
  WITHDRAWAL: 1,
  TRANSFER_REJECTED: 2,
  TRANSFER_RETURNED: 3,
};

/**
 * @param {import("puppeteer").Frame} frame - The Wasla widget's iframe
 *   frame, from getWaslaReferralFrame.mjs.
 * @returns {Promise<{
 *   success: boolean,
 *   notifications: object[],
 *   message?: string,
 * }>}
 */
const getWaslaNotifications = async (frame) => {
  return await frame.evaluate(
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
          return {
            success: false,
            notifications: [],
            message: `Status ${res.status}`,
          };
        }

        const json = await res.json();

        return {
          success: true,
          notifications: Array.isArray(json?.data) ? json.data : [],
        };
      } catch (error) {
        return {
          success: false,
          notifications: [],
          message: error?.message || String(error),
        };
      }
    },
    { url: API_URLS.NOTIFICATIONS_LIST, baseHeaders: baseWaslaHeaders },
  );
};

export default getWaslaNotifications;
