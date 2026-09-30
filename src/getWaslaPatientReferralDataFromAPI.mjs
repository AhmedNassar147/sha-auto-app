/*
 *
 * Helper: `getWaslaPatientReferralDataFromAPI`.
 *
 * Confirmed live against the real Wasla frontend (scripts/apis.mjs, "when
 * patient row eye icon clicked" section - the request fired by opening a
 * case's own details page): a single
 *   GET https://weslah.seha.sa/api/referrals/{id}
 * returns patientInfo/caseInfo/medicalData/attachments already joined in
 * one response - unlike the old GlobMed portal (and the earlier, wrong
 * guess this file used to make), there are no separate
 * attachments/patient-info/details endpoints to call. `{id}` is the
 * internal Wasla case id (`navigationId` - the `id` field on a
 * facility/tabs list row), NOT the display `referralId` code; the response
 * even carries its own different-looking `referralId` field, confirming
 * these are two distinct values.
 *
 * Attachments already carry a ready-to-fetch, pre-signed S3 `fileUrl` -
 * no separate /download-attachment/:id call or auth header needed for
 * that part.
 *
 * Must run against the widget's iframe frame (getWaslaReferralFrame.mjs),
 * not the main seha.sa `page` - the Wasla `persist:auth` bearer token only
 * exists in weslah.seha.sa's own localStorage, a different origin from
 * seha.sa.
 *
 */
import { writeFile } from "fs/promises";
import createConsoleMessage from "./createConsoleMessage.mjs";
import {
  baseReferraAPiUrl,
  baseWaslaHeaders,
  rawReferralResponsesFolderDirectory,
} from "./constants.mjs";

/**
 * @param {import("puppeteer").Frame} frame - The Wasla widget's iframe
 *   frame, from getWaslaReferralFrame.mjs.
 * @param {string} navigationId - The internal Wasla case id (`patient.id`
 *   on a facility/tabs list row), used to build the request URL.
 * @param {string} referralId - Our own display referralId, only used to
 *   prefix downloaded attachment file names for consistency with the rest
 *   of the pipeline.
 * @param {boolean} [skippAttachments] - Skip downloading attachment files.
 * On success, also best-effort saves the full untouched API response to
 * results/raw-referral-responses/{referralId}-{navigationId}.json for later
 * inspection (not included in the returned object - the caller's patient
 * record shouldn't be bloated with the raw nested payload).
 * @returns {Promise<{
 *   mobileNumber?: string,
 *   nationality?: string,
 *   gender?: number,
 *   specialty?: string,
 *   subSpecialty?: string,
 *   sourceProvider?: string,
 *   note?: string,
 *   files?: object[],
 *   patientDetailsError?: string,
 *   attachmentsError?: string,
 *   detailsAPiFiresAtMS?: number,
 *   detailsAPiServerResponseTimeMS?: number,
 *   serverDate?: string,
 *   serverNow?: number,
 * }>}
 */
const getWaslaPatientReferralDataFromAPI = async (
  frame,
  navigationId,
  referralId,
  skippAttachments,
) => {
  const { rawResponse, ...result } = await frame.evaluate(
    async ({ url, baseHeaders, referralId, skippAttachments }) => {
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

      const headers = { ...baseHeaders, ...getAuthHeaders() };
      const apiFiresAtMS = Date.now();

      function arrayBufferToBase64(buffer) {
        const bytes = new Uint8Array(buffer);
        const base64abc =
          "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
        const result = [];
        let i;

        for (i = 2; i < bytes.length; i += 3) {
          result.push(base64abc[bytes[i - 2] >> 2]);
          result.push(base64abc[((bytes[i - 2] & 3) << 4) | (bytes[i - 1] >> 4)]);
          result.push(base64abc[((bytes[i - 1] & 15) << 2) | (bytes[i] >> 6)]);
          result.push(base64abc[bytes[i] & 63]);
        }

        if (i === bytes.length + 1) {
          result.push(base64abc[bytes[i - 2] >> 2]);
          result.push(base64abc[(bytes[i - 2] & 3) << 4]);
          result.push("==");
        }

        if (i === bytes.length) {
          result.push(base64abc[bytes[i - 2] >> 2]);
          result.push(base64abc[((bytes[i - 2] & 3) << 4) | (bytes[i - 1] >> 4)]);
          result.push(base64abc[(bytes[i - 1] & 15) << 2]);
          result.push("=");
        }

        return result.join("");
      }

      try {
        const res = await fetch(url, {
          method: "GET",
          credentials: "include",
          headers,
        });

        const finishedDateMS = Date.now();
        const serverResponseTimeMS = (finishedDateMS - apiFiresAtMS) / 2;
        const serverDate = res.headers.get("Date");
        const serverNow = serverDate ? new Date(serverDate).getTime() : null;

        if (!res.ok) {
          return {
            patientDetailsError: `Status ${res.status}`,
            detailsAPiFiresAtMS: apiFiresAtMS,
            detailsAPiServerResponseTimeMS: Math.trunc(serverResponseTimeMS),
            serverDate,
            serverNow,
          };
        }

        const data = await res.json();

        const { patientInfo, caseInfo, attachments } = data || {};

        const { mobileNumber, gender, nationality } = patientInfo || {};

        const { speciality, subSpeciality, providerName, additionalInformation } =
          caseInfo || {};

        let files;
        let attachmentsError;

        if (!skippAttachments && Array.isArray(attachments) && attachments.length) {
          const downloadTasks = attachments
            .filter((item) => !!(item.fileName && item.fileUrl))
            .map(async ({ fileName, fileUrl, id: idAttachment }) => {
              try {
                const fileRes = await fetch(fileUrl);

                if (!fileRes.ok) {
                  return {
                    idAttachment,
                    fileName,
                    downloadUrl: fileUrl,
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
                  downloadUrl: fileUrl,
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

          if (files.length && files.every((file) => file.downloadError)) {
            attachmentsError = "All attachment downloads failed";
          }
        }

        return {
          mobileNumber,
          gender,
          nationality: nationality?.name,
          specialty: speciality?.name,
          subSpecialty: subSpeciality?.name,
          sourceProvider: providerName?.name,
          note: additionalInformation,
          files,
          attachmentsError,
          detailsAPiFiresAtMS: apiFiresAtMS,
          detailsAPiServerResponseTimeMS: Math.trunc(serverResponseTimeMS),
          serverDate,
          serverNow,
          rawResponse: data,
        };
      } catch (err) {
        return {
          patientDetailsError: err.message,
          detailsAPiFiresAtMS: apiFiresAtMS,
          detailsAPiServerResponseTimeMS: (Date.now() - apiFiresAtMS) / 2,
        };
      }
    },
    {
      url: `${baseReferraAPiUrl}/${navigationId}`,
      baseHeaders: baseWaslaHeaders,
      referralId,
      skippAttachments,
    },
  );

  if (rawResponse) {
    const rawResponseFile = `${rawReferralResponsesFolderDirectory}/${referralId}-${navigationId}.json`;

    await writeFile(
      rawResponseFile,
      JSON.stringify(rawResponse, null, 2),
    ).catch((error) => {
      createConsoleMessage(
        "warn",
        error,
        `⚠️ Failed to save raw referral response to ${rawResponseFile}`,
      );
    });
  }

  return result;
};

export default getWaslaPatientReferralDataFromAPI;
