/*
 *
 * Helper: `submitWaslaReferralViaApi`.
 *
 * Direct-API alternative to clicking Confirm in the referral-details
 * confirmation popup (see handleSubmitReferral.mjs) - tried first for the
 * accept case there, falling back to the UI flow on any failure. Uploads
 * the letter PDF, then POSTs accept-json referencing the uploaded
 * attachment's own numeric id, for either accept or reject (same endpoint
 * both ways, but NOT the same payload shape - confirmed live from two
 * separate real requests, scripts/reject-case.js for reject:
 *   accept -> {"accept":true,"notes":"...","file":"31284"}
 *   reject -> {"accept":false,"rejectionReasonId":18,"file":"31465"}
 * i.e. reject has no "notes" field at all, and needs rejectionReasonId
 * instead - a lookup id from the portal's own rejection-reasons list (also
 * captured in scripts/reject-case.js, see id 18 there, "Unavailability of
 * Required Bed" / "عدم توفر السرير المطلوب") - supplied by the caller
 * rather than hardcoded here.
 *
 * Confirmed live (real request headers pasted in chat) for the upload
 * endpoint: content-type is multipart/form-data with a browser-generated
 * boundary - set automatically when the body is a FormData instance, must
 * NOT be set manually (that would strip the boundary param and break
 * parsing) - plus an explicit `authorization: Bearer <JWT>` header.
 * credentials: "include" only carries cookies automatically; the Bearer
 * token still has to be read from localStorage and attached by hand,
 * exactly like getWaslaPatientReferralDataFromAPI.mjs's getAuthHeaders()
 * already does for the Wasla widget frame - this mirrors that same
 * persist:auth double-JSON-parse, since the page calling this is on the
 * weslah.seha.sa origin directly (not through the widget iframe).
 *
 * Both requests run inside one page.evaluate() call (rather than two) -
 * they're sequential either way (accept-json needs the upload's own
 * attachment id first), so one evaluate saves a Node<->browser CDP
 * round-trip and only needs getWaslaAuthHeaders defined once.
 *
 */
import { API_URLS } from "./constants.mjs";

/**
 * @param {object} params
 * @param {import("puppeteer").Page} params.page - Must already be on the
 *   weslah.seha.sa origin (e.g. the referral-details page
 *   handleSubmitReferral.mjs opens).
 * @param {string} params.navigationId - The internal Wasla case id used to
 *   build the accept-json URL.
 * @param {string} params.fileBase64 - The letter PDF, base64-encoded (e.g.
 *   getCurrentActionLetterFile()'s fileData, which is already base64 by
 *   default - no need to pass returnBuffer/re-encode for this).
 * @param {string} params.fileName - Attachment file name, e.g.
 *   `${actionType}-${referralId}.pdf`.
 * @param {string} [params.notes] - Accept-only notes text; ignored when
 *   isAccept is false.
 * @param {number} [params.rejectionReasonId] - Reject-only lookup id from
 *   the portal's own rejection-reasons list; ignored when isAccept is true.
 * @param {boolean} params.isAccept - true to accept, false to reject.
 * @returns {Promise<{
 *   success: boolean,
 *   attachmentId?: number | string,
 *   data?: unknown,
 *   error?: string,
 *   step?: "upload" | "accept-json",
 *   url?: string,
 * }>}
 */
const submitWaslaReferralViaApi = async ({
  page,
  navigationId,
  fileBase64,
  fileName,
  notes,
  rejectionReasonId,
  isAccept,
}) => {
  const acceptUrl = API_URLS.ACCEPT_OR_REJECT_CASE.replace(
    "_nav_id_",
    navigationId,
  );
  const uploadAPI = API_URLS.UPLOAD_ATTACHMENT;

  return await page.evaluate(
    async ({
      fileBase64,
      name,
      uploadUrl,
      url,
      notesText,
      rejectionReasonIdValue,
      accept,
    }) => {
      const getWaslaAuthHeaders = () => {
        try {
          const rawAuth = localStorage.getItem("persist:auth");
          if (!rawAuth) return {};

          const parsedAuth = JSON.parse(rawAuth);
          const token = parsedAuth?.token ? JSON.parse(parsedAuth.token) : null;

          return {
            Accept: "application/json",
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
            culture: localStorage.getItem("i18nextLng") || "en",
          };
        } catch {
          return {};
        }
      };

      const byteChars = atob(fileBase64);
      const byteNumbers = new Array(byteChars.length);
      for (let i = 0; i < byteChars.length; i++) {
        byteNumbers[i] = byteChars.charCodeAt(i);
      }

      const blob = new Blob([new Uint8Array(byteNumbers)], {
        type: "application/pdf",
      });

      const formData = new FormData();
      formData.append("file", blob, name);

      const headers = getWaslaAuthHeaders();

      let attachmentId;

      try {
        const uploadRes = await fetch(uploadUrl, {
          method: "POST",
          credentials: "include",
          headers: headers,
          body: formData,
        });

        if (!uploadRes.ok) {
          const bodyText = await uploadRes.text().catch(() => "");
          return {
            success: false,
            step: "upload",
            url: uploadUrl,
            error: `Status ${uploadRes.status}${bodyText ? `: ${bodyText}` : ""} (hadAuthHeader=${Boolean(headers.Authorization)})`,
          };
        }

        const uploadData = await uploadRes.json();
        attachmentId = uploadData.id;

        if (!attachmentId) {
          // Never echo `headers` here - it carries the live Authorization
          // Bearer token, and this error can end up in a Telegram message.
          return {
            success: false,
            step: "upload",
            url: uploadUrl,
            error: `No attachment id in response (hadAuthHeader=${Boolean(headers.Authorization)})`,
          };
        }
      } catch (err) {
        return {
          success: false,
          step: "upload",
          url: uploadUrl,
          error: `${err.message} (hadAuthHeader=${Boolean(headers.Authorization)})`,
        };
      }

      // Confirmed live: accept and reject do NOT share a payload shape.
      // Accept sends free-text "notes"; reject has no "notes" field at all
      // and instead needs "rejectionReasonId" - a lookup id from the
      // portal's own rejection-reasons list (scripts/reject-case.js),
      // supplied by the caller.
      const payload = accept
        ? { accept, notes: notesText, file: String(attachmentId) }
        : {
            accept,
            rejectionReasonId: rejectionReasonIdValue,
            file: String(attachmentId),
          };

      try {
        const acceptRes = await fetch(url, {
          method: "POST",
          credentials: "include",
          headers: {
            "Content-Type": "application/json",
            ...headers,
          },
          body: JSON.stringify(payload),
        });

        if (!acceptRes.ok) {
          const bodyText = await acceptRes.text().catch(() => "");
          return {
            success: false,
            step: "accept-json",
            attachmentId,
            url,
            error: `Status ${acceptRes.status}${bodyText ? `: ${bodyText}` : ""} (hadAuthHeader=${Boolean(headers.Authorization)})`,
          };
        }

        return { success: true, attachmentId, data: await acceptRes.json() };
      } catch (err) {
        return {
          success: false,
          step: "accept-json",
          attachmentId,
          url,
          error: `${err.message} (hadAuthHeader=${Boolean(headers.Authorization)})`,
        };
      }
    },
    {
      fileBase64,
      name: fileName,
      uploadUrl: uploadAPI,
      url: acceptUrl,
      notesText: notes,
      rejectionReasonIdValue: rejectionReasonId,
      accept: isAccept,
    },
  );
};

export default submitWaslaReferralViaApi;
