/*
 *
 * Helper: `getPatientReferralDataFromAPI`.
 *
 */

import {
  baseWaslaHeaders,
  BASE_WASLA_API_URL,
  API_URLS,
} from "./constants.mjs";

const urls = [
  API_URLS.CASEE_ATTACHMENTS,
  API_URLS.CASEE_INFO,
  API_URLS.CASEE_DETAILS,
];

const getPatientReferralDataFromAPI = async (
  page,
  idReferral,
  skippAttachments,
) => {
  const results = await page.evaluate(
    async ({
      urls: _urls,
      baseWaslaHeaders,
      idReferral,
      BASE_WASLA_API_URL,
      skippAttachments,
    }) => {
      const urls = skippAttachments
        ? _urls.filter((url) => !url.includes("attachments"))
        : _urls;

      const responses = await Promise.allSettled(
        urls.map(async (url) => {
          const apiFiresAtMS = new Date().getTime();
          try {
            const res = await fetch(url, {
              method: "POST",
              headers: baseWaslaHeaders,
              body: JSON.stringify({ idReferral }),
            });

            const finishedDateMS = new Date().getTime();
            const serverResponseTimeMS = (finishedDateMS - apiFiresAtMS) / 2;

            let serverDate = undefined;
            let serverNow = undefined;

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

            const data = await res.json();

            return {
              success: true,
              data: data?.data,
              apiFiresAtMS,
              serverResponseTimeMS,
              serverDate,
              serverNow,
            };
          } catch (err) {
            const finishedDateMS = new Date().getTime();

            return {
              success: false,
              error: err.message,
              apiFiresAtMS,
              serverResponseTimeMS: (finishedDateMS - apiFiresAtMS) / 2,
            };
          }
        }),
      );

      const normalizeSettled = (settled) => {
        if (!settled) return { success: false, data: null, error: "no-result" };
        if (settled.status === "fulfilled") {
          return (
            settled.value || { success: false, data: null, error: "no-value" }
          );
        } else {
          // rejected
          const reason = settled.reason;
          const msg = (reason && reason.message) || String(reason);
          return { success: false, data: null, error: msg };
        }
      };

      const [attachmentResponse, patientInfoResponse, detailsResponse] =
        skippAttachments
          ? [null, ...responses] // pad with null for attachments
          : responses;

      const {
        data: detailsData,
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

      const {
        requiredSpecialty,
        specialty,
        mobileNumber: mobileNumberFromDetails,
        refType,
        message,
        referralCauseDetails,
        ...otherDetailsData
      } = detailsData || {};

      const {
        firstName,
        fatherName,
        lastName,
        mobileNumber,
        alternativeMobileNumber,
        patientType,
        passportNbr,
        email,
        weight,
        ...otherPatientInfo
      } = patientInfo || {};

      const patientName = [firstName, lastName].filter(Boolean).join(" ");
      const _mobileNumber =
        mobileNumber || alternativeMobileNumber || mobileNumberFromDetails;

      const _specialty = requiredSpecialty || specialty;
      const subSpecialty = specialty || requiredSpecialty;

      const { note } = referralCauseDetails || {};

      let finalData = {
        patientName,
        mobileNumber: _mobileNumber,
        patientType: patientType || undefined,
        passportNbr: passportNbr || undefined,
        email: email || undefined,
        weight: weight || undefined,
        ...otherPatientInfo,
        patientInfoError: patientInfoError,
        specialty: _specialty,
        subSpecialty: subSpecialty,
        referralType: refType,
        note: note,
        referralCauseDetails,
        serverDate,
        serverNow,
        ...otherDetailsData,
        detailsAPiFiresAtMS: apiFiresAtMS,
        detailsAPiServerResponseTimeMS:
          !!serverResponseTimeMS || typeof serverResponseTimeMS === "number"
            ? Math.trunc(serverResponseTimeMS)
            : undefined,
        caseAlertMessage: message,
        patientDetailsError,
        attachmentsError,
      };

      const saveName = (name) =>
        (name || "")
          .replace(/\s+/g, "_") // spaces → underscore
          .replace(/[^\w\-_.]/g, "") // remove anything not alphanumeric, dash, dot, underscore
          .trim();

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
            const downloadUrl = `${BASE_WASLA_API_URL}/download-attachment/${idAttachment}`;

            try {
              const fileRes = await fetch(downloadUrl, {
                credentials: "include",
                headers: {
                  "x-csrf": "1",
                  accept: "*/*",
                },
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
                fileName: `${idReferral}_${saveName(_specialty)}_${saveName(name)}`,
                extension: extension,
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

        const files = await Promise.allSettled(downloadTasks);

        finalData.files = files
          .filter((item) => item.status === "fulfilled")
          .map((item) => item.value)
          .filter(Boolean);
      }

      return finalData;
    },
    {
      urls,
      baseWaslaHeaders,
      idReferral,
      BASE_WASLA_API_URL,
      skippAttachments,
    },
  );

  return results;
};

export default getPatientReferralDataFromAPI;

// const baseWaslaHeaders = {
//   Accept: "application/json, text/plain, */*",
//   "Content-Type": "application/json",
//   "Accept-Language": "en-US,en;q=0.9",
//   "X-CSRF": "1",
// };

// const responsex = await fetch("https://referralprogram.globemedsaudi.com/referrals/details", {
//                 method: "POST",
//               headers: baseWaslaHeaders,
//               body: JSON.stringify({ idReferral: "352923" }),
// })

// const datax = await responsex.json();

// https://referralprogram.globemedsaudi.com/referrals/attachments
// Request Method
// POST
// Status Code

// headers
// POST /referrals/attachments HTTP/1.1
// Accept: application/json, text/plain, */*
// Accept-Encoding: gzip, deflate, br, zstd
// Accept-Language: en-US,en;q=0.9
// Connection: keep-alive
// Content-Length: 21
// Content-Type: application/json
// Cookie: __moh-bff=CfDJ8EhdFmr9dTdLn-VtvO2lgcQzauXJeL5oEhEd5BOwowd10JwPvFW9LKfgbr0dXHUUArv0JJJ-UrZL8R_h7Z_-unLYYBRKcGeJLgv_vsy2lr3TlTCpbTbA4nv5Q38reS6Lm4ikKvC2n_qBg2FnHHr9KKh_sx_2NnDZKnQufNwrl5iBT20x132fCHlwFnOe5aPfzEnAcWsjrG7xeenWMUPz2bZeb7z0gHuivTuaIFWPC3zl7nKk6X2-W7eyN4pS6zYuYzuP3TyHBDfJg-w1Qzq_9qax2t90i20kxQ0vLMs0mgtAfhPpt0JPTehMz1LRkaEV3lxhV4FlGLDeA_YmdgjG_Vs; cookiesession1=678A3E66BF05226F904E3EDE31EBF09B
// Host: referralprogram.globemedsaudi.com
// Origin: https://referralprogram.globemedsaudi.com
// Referer: https://referralprogram.globemedsaudi.com/referral/details
// Sec-Fetch-Dest: empty
// Sec-Fetch-Mode: cors
// Sec-Fetch-Site: same-origin
// User-Agent: Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/138.0.0.0 Safari/537.36
// X-CSRF: 1
// sec-ch-ua: "Not)A;Brand";v="8", "Chromium";v="138", "Google Chrome";v="138"
// sec-ch-ua-mobile: ?0
// sec-ch-ua-platform: "Windows"
// https://referralprogram.globemedsaudi.com/referrals/download-attachment/17572

// {
//     "data": [
//         {
//             "idProvider": null,
//             "canAttach": true,
//             "idAttachment": "17572",
//             "fileName": "1174461036.pdf",
//             "fileExtension": 0,
//             "attachmentType": "Medical Report",
//             "attachmentDate": "0001-01-01T00:00:00",
//             "content": null
//         },
//         {
//             "idProvider": null,
//             "canAttach": true,
//             "idAttachment": "17573",
//             "fileName": "حور05082025112534.pdf",
//             "fileExtension": 0,
//             "attachmentType": "Medical Report",
//             "attachmentDate": "0001-01-01T00:00:00",
//             "content": null
//         }
//     ],
//     "statusCode": "Success",
//     "errorMessage": null
// }

// https://referralprogram.globemedsaudi.com/referrals/patient-info
// Request Method
// POST
// Status Code

// headers:
// POST /referrals/patient-info HTTP/1.1
// Accept: application/json, text/plain, */*
// Accept-Encoding: gzip, deflate, br, zstd
// Accept-Language: en-US,en;q=0.9
// Connection: keep-alive
// Content-Length: 21
// Content-Type: application/json
// Cookie: __moh-bff=CfDJ8EhdFmr9dTdLn-VtvO2lgcQzauXJeL5oEhEd5BOwowd10JwPvFW9LKfgbr0dXHUUArv0JJJ-UrZL8R_h7Z_-unLYYBRKcGeJLgv_vsy2lr3TlTCpbTbA4nv5Q38reS6Lm4ikKvC2n_qBg2FnHHr9KKh_sx_2NnDZKnQufNwrl5iBT20x132fCHlwFnOe5aPfzEnAcWsjrG7xeenWMUPz2bZeb7z0gHuivTuaIFWPC3zl7nKk6X2-W7eyN4pS6zYuYzuP3TyHBDfJg-w1Qzq_9qax2t90i20kxQ0vLMs0mgtAfhPpt0JPTehMz1LRkaEV3lxhV4FlGLDeA_YmdgjG_Vs; cookiesession1=678A3E66BF05226F904E3EDE31EBF09B
// Host: referralprogram.globemedsaudi.com
// Origin: https://referralprogram.globemedsaudi.com
// Referer: https://referralprogram.globemedsaudi.com/referral/details
// Sec-Fetch-Dest: empty
// Sec-Fetch-Mode: cors
// Sec-Fetch-Site: same-origin
// User-Agent: Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/138.0.0.0 Safari/537.36
// X-CSRF: 1
// sec-ch-ua: "Not)A;Brand";v="8", "Chromium";v="138", "Google Chrome";v="138"
// sec-ch-ua-mobile: ?0
// sec-ch-ua-platform: "Windows"

// {
//     "data": {
// "nationalId": "1174461036",
// "firstName": "HOUR ",
// "lastName": "ALAMRI",
// "fatherName": "SALEH ",
// "weight": null,
// "alternativeMobileNumber": null,
// "mobileNumber": "+966557294611",
// "hijriDOB": "Shawwal 26, 1436 AH",
// "nationality": "SAUDI",
// "patientType": null,
// "gender": "Female",
// "dob": "2015-08-11T00:00:00",
// "maritalStatus": "Single",
// "passportNbr": null,
//         "email": null
//     },
//     "statusCode": "Success",
//     "errorMessage": null
// }

// https://referralprogram.globemedsaudi.com/referrals/details
// POST
// headers
// POST /referrals/details HTTP/1.1
// Accept: application/json, text/plain, */*
// Accept-Encoding: gzip, deflate, br, zstd
// Accept-Language: en-US,en;q=0.9
// Connection: keep-alive
// Content-Length: 21
// Content-Type: application/json
// Cookie: __moh-bff=CfDJ8EhdFmr9dTdLn-VtvO2lgcQzauXJeL5oEhEd5BOwowd10JwPvFW9LKfgbr0dXHUUArv0JJJ-UrZL8R_h7Z_-unLYYBRKcGeJLgv_vsy2lr3TlTCpbTbA4nv5Q38reS6Lm4ikKvC2n_qBg2FnHHr9KKh_sx_2NnDZKnQufNwrl5iBT20x132fCHlwFnOe5aPfzEnAcWsjrG7xeenWMUPz2bZeb7z0gHuivTuaIFWPC3zl7nKk6X2-W7eyN4pS6zYuYzuP3TyHBDfJg-w1Qzq_9qax2t90i20kxQ0vLMs0mgtAfhPpt0JPTehMz1LRkaEV3lxhV4FlGLDeA_YmdgjG_Vs; cookiesession1=678A3E66BF05226F904E3EDE31EBF09B
// Host: referralprogram.globemedsaudi.com
// Origin: https://referralprogram.globemedsaudi.com
// Referer: https://referralprogram.globemedsaudi.com/referral/details
// Sec-Fetch-Dest: empty
// Sec-Fetch-Mode: cors
// Sec-Fetch-Site: same-origin
// User-Agent: Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/138.0.0.0 Safari/537.36
// X-CSRF: 1
// sec-ch-ua: "Not)A;Brand";v="8", "Chromium";v="138", "Google Chrome";v="138"
// sec-ch-ua-mobile: ?0
// sec-ch-ua-platform: "Windows"

// response
// {
//     "data": {
//         "requestDate": "2025-08-06T10:10:22",
//         "creationDate": "2025-08-06T07:14:11",
//         "ihalatyReference": "32039990",
//         "providerName": "TADAWI MEDICALhospital- khamis Mushayt",
//         "longitude": null,
//         "latitude": null,
//         "providerCode": "H523748",
//         "providerZoneCode": "15",
//         "providerCityCode": null,
//         "providerRegionCode": null,
//         "providerZone": "Asir",
//         "referralCause": "Bed Unavailable",
//         "requestedBedType": "Ward",
//         "claimType": null,
//         "doctor": null,
//         "estimationCost": 0,
//         "category": "HP",
//         "sourceProvider": "Al Namaas Hospital",
//         "referralTypeCode": "3",
//         "refType": "Inpatient",
//         "requiredSpecialtyCode": "320",
//         "er": false,
//         "specialtyCode": "320",
//         "specialty": "Pediatric Surgery",
//         "mobileNumber": null,
//         "claimReference": null,
//         "lengthOfStay": 0,
//         "referralCauseDetails": {
//             "id": 3393,
//             "note": "WARD",
//             "isPublic": true,
//             "isActive": true,
//             "owner": null,
//             "canDelete": null
//         },
//         "referralAdditionalInformation": null,
//         "status": "P",
//         "canUpdate": true,
//         "requiredSpecialty": "Pediatric Surgery",
//         "message": "",
//         "isPrivate": false,
//         "canTakeAction": true,
//         "quotaExceededMessage": ""
//     },
//     "statusCode": "Success",
//     "errorMessage": null
// }
