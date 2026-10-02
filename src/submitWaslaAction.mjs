/*
 *
 * Helper: `submitWaslaAction`.
 *
 * Shared core for every direct-API submit-to-Wasla helper
 * (submitWaslaReferralViaApi.mjs's accept/reject, submitWithdrawalViaApi.mjs,
 * submitArrivalConfirmationViaApi.mjs) - optionally uploads a file via
 * API_URLS.UPLOAD_ATTACHMENT, merges its id into the caller's payload as
 * `file`, then POSTs that payload to the caller's own url. Always one
 * page.evaluate() call - upload and post are sequential either way when
 * both happen here, so one evaluate saves a Node<->browser CDP round-trip.
 *
 * Three modes, picked by which params are given:
 *   - fileBase64/fileName + url/payload, no attachmentId: upload then post
 *     (withdrawal's only use - no timing pressure, so there's no reason to
 *     split its upload out ahead of time).
 *   - attachmentId + url/payload (already uploaded earlier - see
 *     handleSubmitReferral.mjs pre-uploading well ahead of the facility
 *     review-window boundary): skips the upload step entirely, just posts
 *     with that id merged in - the one fast call that actually needs to
 *     happen right at/after the boundary.
 *   - fileBase64/fileName, no url: no url to post to means there's nothing
 *     to do but the upload, so that's all this does, returning just the
 *     upload outcome - the other half of the pre-upload split, run well
 *     ahead of time. (Not a separate flag - inferred from url being
 *     absent, since that's the actual thing that matters: whichever
 *     caller doesn't pass url/payload never intended a POST in the first
 *     place.)
 *   - neither fileBase64 nor attachmentId: posts `payload` as-is, no file
 *     at all (arrival confirmation).
 *
 */
import { API_URLS } from "./constants.mjs";

/**
 * @param {object} params
 * @param {import("puppeteer").Page} params.page - Must already be on the
 *   weslah.seha.sa origin.
 * @param {string} [params.url] - Final POST target; required unless
 *   ignoreFinalAction is true.
 * @param {object} [params.payload] - JSON-serializable request body;
 *   required unless ignoreFinalAction is true. The resolved attachment id
 *   (from fileBase64 upload or the given attachmentId) is merged in as
 *   `file` (a string) - don't set `file` yourself.
 * @param {string} [params.fileBase64] - Base64-encoded file; omit to skip
 *   the upload step entirely (requires attachmentId instead, or no file at
 *   all).
 * @param {string} [params.fileName]
 * @param {string | number} [params.attachmentId] - Already-uploaded
 *   attachment id; when given, the upload step (and fileBase64/fileName)
 *   is skipped entirely.
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
  attachmentId,
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
      knownAttachmentId,
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

      let attachmentId = knownAttachmentId;

      if (!attachmentId && fileBase64) {
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

      // No url means no POST was ever intended - whichever caller left it
      // out only wanted the upload (see this file's own docblock).
      if (!url) {
        return { success: true, attachmentId };
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
    {
      fileBase64,
      fileName,
      uploadUrl,
      url,
      payload,
      postStepLabel,
      knownAttachmentId: attachmentId,
    },
  );
};

export default submitWaslaAction;
