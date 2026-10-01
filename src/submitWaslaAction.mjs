/*
 *
 * Helper: `submitWaslaAction`.
 *
 * Shared core for every direct-API submit-to-Wasla helper
 * (submitWaslaReferralViaApi.mjs's accept/reject, submitWithdrawalViaApi.mjs,
 * submitArrivalConfirmationViaApi.mjs) - optionally uploads a file via
 * API_URLS.UPLOAD_ATTACHMENT, merges its id into the caller's payload as
 * `file`, then POSTs that payload to the caller's own url. All in one
 * page.evaluate() call (not two) - upload and post are sequential either
 * way (post needs the upload's own attachment id first), so one evaluate
 * saves a Node<->browser CDP round-trip, same reasoning
 * submitWaslaReferralViaApi.mjs's original version used before this got
 * extracted.
 *
 * Pass `fileBase64`/`fileName` for actions that need an attachment first
 * (accept/reject/withdrawal); omit both to just POST `payload` as-is
 * (arrival confirmation, which takes no file at all).
 *
 */
import { API_URLS } from "./constants.mjs";

/**
 * @param {object} params
 * @param {import("puppeteer").Page} params.page - Must already be on the
 *   weslah.seha.sa origin.
 * @param {string} params.url - Final POST target.
 * @param {object} params.payload - JSON-serializable request body. When
 *   fileBase64 is given, the uploaded attachment's id is merged in as
 *   `file` (a string) after upload succeeds - don't set `file` yourself.
 * @param {string} [params.fileBase64] - Base64-encoded file; omit to skip
 *   the upload step entirely.
 * @param {string} [params.fileName]
 * @param {string} [params.postStepLabel="submit"] - Prefixed onto `step` on
 *   any failure (both the upload sub-steps and the final POST) so a shared
 *   function serving multiple actions (accept/withdraw/arrival) still
 *   reports which one failed - purely for diagnostics (e.g. Telegram
 *   failure messages), not branched on programmatically.
 * @returns {Promise<{
 *   success: boolean,
 *   attachmentId?: number | string,
 *   data?: unknown,
 *   error?: string,
 *   step?: string,
 *   url?: string,
 * }>}
 */
const submitWaslaAction = async ({
  page,
  url,
  payload,
  fileBase64,
  fileName,
  postStepLabel = "submit",
}) => {
  const uploadUrl = API_URLS.UPLOAD_ATTACHMENT;

  return await page.evaluate(
    async ({
      fileBase64,
      fileName,
      uploadUrl,
      url,
      payload,
      postStepLabel,
    }) => {
      // Same persist:auth double-JSON-parse as
      // getWaslaPatientReferralDataFromAPI.mjs's getAuthHeaders() - the
      // page calling this is on the weslah.seha.sa origin directly, not
      // through the widget iframe.
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

      const headers = getWaslaAuthHeaders();

      let attachmentId;

      if (fileBase64) {
        const byteChars = atob(fileBase64);
        const byteNumbers = new Array(byteChars.length);
        for (let i = 0; i < byteChars.length; i++) {
          byteNumbers[i] = byteChars.charCodeAt(i);
        }

        const blob = new Blob([new Uint8Array(byteNumbers)], {
          type: "application/pdf",
        });

        const formData = new FormData();
        formData.append("file", blob, fileName);

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
              step: `${postStepLabel}-upload-notOk`,
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
              step: `${postStepLabel}-upload-no-id`,
              url: uploadUrl,
              error: `No attachment id in response (hadAuthHeader=${Boolean(headers.Authorization)})`,
            };
          }
        } catch (err) {
          return {
            success: false,
            step: `${postStepLabel}-upload-catch`,
            url: uploadUrl,
            error: `${err.message} (hadAuthHeader=${Boolean(headers.Authorization)})`,
          };
        }
      }

      const finalPayload =
        attachmentId != null
          ? { ...payload, file: String(attachmentId) }
          : payload;

      try {
        const res = await fetch(url, {
          method: "POST",
          credentials: "include",
          headers: {
            "Content-Type": "application/json",
            ...headers,
          },
          body: JSON.stringify(finalPayload),
        });

        if (!res.ok) {
          const bodyText = await res.text().catch(() => "");
          return {
            success: false,
            step: `${postStepLabel}-notOk`,
            attachmentId,
            url,
            error: `Status ${res.status}${bodyText ? `: ${bodyText}` : ""} (hadAuthHeader=${Boolean(headers.Authorization)})`,
          };
        }

        return { success: true, attachmentId, data: await res.json() };
      } catch (err) {
        return {
          success: false,
          step: `${postStepLabel}-catch`,
          attachmentId,
          url,
          error: `${err.message} (hadAuthHeader=${Boolean(headers.Authorization)})`,
        };
      }
    },
    { fileBase64, fileName, uploadUrl, url, payload, postStepLabel },
  );
};

export default submitWaslaAction;
