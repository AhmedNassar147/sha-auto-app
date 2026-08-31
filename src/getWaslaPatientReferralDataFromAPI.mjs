/*
 *
 * Helper: `getWaslaPatientReferralDataFromAPI`.
 *
 * Fetches per-case details/patient-info/attachments for a single Wasla
 * referral, mirroring the old GlobMed `getPatientReferralDataFromAPI.mjs`
 * (same endpoint-path shape: /details, /patient-info, /attachments,
 * /download-attachment/:id — both are Saudi MOH referral portals).
 *
 * IMPORTANT — unlike `getWaslaCasesFromAPI.mjs` (whose `facility/tabs`
 * shape is confirmed against the real weslah.seha.sa bundle), the bundle
 * chunks we have don't include the case-details page, so the request body
 * key (`referralId`) and each endpoint's response shape below are
 * UNVERIFIED — best-effort mirrors of the old system. `details`,
 * `patientInfo`, and `attachmentList` are returned as raw API `data`
 * rather than mapped into named fields, on purpose: don't invent field
 * names (patientName, mobileNumber, etc.) until they're confirmed against
 * a live response. Map them once verified.
 *
 */
import { API_URLS, baseWaslaHeaders } from "./constants.mjs";

const urls = [
  API_URLS.CASEE_ATTACHMENTS,
  API_URLS.CASEE_INFO,
  API_URLS.CASEE_DETAILS,
];

/**
 * @param {import("puppeteer").Frame} frame - The Wasla widget's iframe
 *   frame, from getWaslaReferralFrame.mjs.
 * @param {string} referralId
 * @param {boolean} [skippAttachments] - Skip the attachments call/download.
 * @returns {Promise<{
 *   referralId: string,
 *   details: unknown,
 *   patientInfo: unknown,
 *   attachmentList: unknown,
 *   files?: object[],
 *   patientDetailsError?: string,
 *   patientInfoError?: string,
 *   attachmentsError?: string,
 *   detailsAPiFiresAtMS?: number,
 *   detailsAPiServerResponseTimeMS?: number,
 *   serverDate?: string,
 *   serverNow?: number,
 * }>}
 */
const getWaslaPatientReferralDataFromAPI = async (
  frame,
  referralId,
  skippAttachments,
) => {
  return await frame.evaluate(
    async ({
      urls: _urls,
      baseHeaders,
      referralId,
      downloadAttachmentUrl,
      skippAttachments,
    }) => {
      // persist:auth is redux-persist's default per-key JSON encoding, so
      // the stored "token" field is itself a JSON-encoded string — hence
      // the double JSON.parse. Runs inside the frame, can't import helpers.
      const getAuthHeaders = () => {
        try {
          const rawAuth = localStorage.getItem("persist:auth");
          if (!rawAuth) return {};

          const parsedAuth = JSON.parse(rawAuth);
          const token = parsedAuth?.token
            ? JSON.parse(parsedAuth.token)
            : null;

          return {
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
            culture: localStorage.getItem("i18nextLng") || "en",
          };
        } catch {
          return {};
        }
      };

      const urls = skippAttachments
        ? _urls.filter((url) => !url.includes("attachments"))
        : _urls;

      const headers = { ...baseHeaders, ...getAuthHeaders() };

      const responses = await Promise.allSettled(
        urls.map(async (url) => {
          const apiFiresAtMS = Date.now();

          try {
            const res = await fetch(url, {
              method: "POST",
              credentials: "include",
              headers,
              body: JSON.stringify({ referralId }),
            });

            const finishedDateMS = Date.now();
            const serverResponseTimeMS = (finishedDateMS - apiFiresAtMS) / 2;

            let serverDate;
            let serverNow;

            if (url.endsWith("details")) {
              serverDate = res.headers.get("Date");
              serverNow = serverDate ? new Date(serverDate).getTime() : null;
            }

            if (!res.ok) {
              return {
                apiFiresAtMS,
                serverResponseTimeMS,
                serverDate,
                serverNow,
                success: false,
                error: `Status ${res.status}`,
              };
            }

            const json = await res.json();

            return {
              success: true,
              data: json?.data,
              apiFiresAtMS,
              serverResponseTimeMS,
              serverDate,
              serverNow,
            };
          } catch (err) {
            return {
              success: false,
              error: err.message,
              apiFiresAtMS,
              serverResponseTimeMS: (Date.now() - apiFiresAtMS) / 2,
            };
          }
        }),
      );

      const normalizeSettled = (settled) => {
        if (!settled) {
          return { success: false, data: null, error: "no-result" };
        }

        if (settled.status === "fulfilled") {
          return (
            settled.value || { success: false, data: null, error: "no-value" }
          );
        }

        const reason = settled.reason;
        return {
          success: false,
          data: null,
          error: (reason && reason.message) || String(reason),
        };
      };

      const [attachmentResponse, patientInfoResponse, detailsResponse] =
        skippAttachments ? [null, ...responses] : responses;

      const {
        data: details,
        error: patientDetailsError,
        apiFiresAtMS,
        serverResponseTimeMS,
        serverDate,
        serverNow,
      } = normalizeSettled(detailsResponse);

      const { data: patientInfo, error: patientInfoError } =
        normalizeSettled(patientInfoResponse);

      const { data: attachmentList, error: attachmentsError } =
        normalizeSettled(attachmentResponse);

      let files;

      if (Array.isArray(attachmentList) && attachmentList.length) {
        function arrayBufferToBase64(buffer) {
          const bytes = new Uint8Array(buffer);
          const base64abc =
            "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
          const result = [];
          let i;

          for (i = 2; i < bytes.length; i += 3) {
            result.push(base64abc[bytes[i - 2] >> 2]);
            result.push(
              base64abc[((bytes[i - 2] & 3) << 4) | (bytes[i - 1] >> 4)],
            );
            result.push(
              base64abc[((bytes[i - 1] & 15) << 2) | (bytes[i] >> 6)],
            );
            result.push(base64abc[bytes[i] & 63]);
          }

          if (i === bytes.length + 1) {
            result.push(base64abc[bytes[i - 2] >> 2]);
            result.push(base64abc[(bytes[i - 2] & 3) << 4]);
            result.push("==");
          }

          if (i === bytes.length) {
            result.push(base64abc[bytes[i - 2] >> 2]);
            result.push(
              base64abc[((bytes[i - 2] & 3) << 4) | (bytes[i - 1] >> 4)],
            );
            result.push(base64abc[(bytes[i - 1] & 15) << 2]);
            result.push("=");
          }

          return result.join("");
        }

        const downloadTasks = attachmentList
          .filter((item) => !!(item.fileName && item.idAttachment))
          .map(async ({ fileName, idAttachment }) => {
            const downloadUrl = `${downloadAttachmentUrl}/${idAttachment}`;

            try {
              const fileRes = await fetch(downloadUrl, {
                credentials: "include",
                headers: { ...headers, accept: "*/*" },
              });

              if (!fileRes.ok) {
                return {
                  idAttachment,
                  fileName,
                  downloadUrl,
                  downloadError: `Failed with status ${fileRes.status}`,
                };
              }

              const blob = await fileRes.blob();
              const arrayBuffer = await blob.arrayBuffer();
              const base64 = arrayBufferToBase64(arrayBuffer);

              const parts = (fileName || "").split(".");
              const extension = parts.length > 1 ? parts.pop() : "pdf";
              const name = parts.join(".");

              return {
                fileName: `${referralId}_${name}`,
                extension,
                fileBase64: base64,
                idAttachment,
              };
            } catch (error) {
              return {
                fileName,
                downloadUrl,
                downloadError:
                  error instanceof Error ? error.message : String(error),
              };
            }
          });

        const settledFiles = await Promise.allSettled(downloadTasks);

        files = settledFiles
          .filter((item) => item.status === "fulfilled")
          .map((item) => item.value)
          .filter(Boolean);
      }

      return {
        referralId,
        details,
        patientInfo,
        attachmentList,
        files,
        patientDetailsError,
        patientInfoError,
        attachmentsError,
        detailsAPiFiresAtMS: apiFiresAtMS,
        detailsAPiServerResponseTimeMS:
          typeof serverResponseTimeMS === "number"
            ? Math.trunc(serverResponseTimeMS)
            : undefined,
        serverDate,
        serverNow,
      };
    },
    {
      urls,
      baseHeaders: baseWaslaHeaders,
      referralId,
      downloadAttachmentUrl: API_URLS.CASEE_DOWNLOAD_ATTACHMENT,
      skippAttachments,
    },
  );
};

export default getWaslaPatientReferralDataFromAPI;
