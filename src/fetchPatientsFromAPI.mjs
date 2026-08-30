/*
 *
 * Helper: `fetchPatientsFromAPI`.
 *
 */
import { baseWaslaHeaders, API_URLS } from "./constants.mjs";

const apiUrl = API_URLS.CASES_LIST;

const fetchPatientsFromAPI = async (page, requestBody) => {
  try {
    const result = await page.evaluate(
      async ({ baseWaslaHeaders, requestBody, apiUrl }) => {
        try {
          const response = await fetch(apiUrl, {
            method: "POST",
            headers: baseWaslaHeaders,
            body: requestBody,
          });

          let data,
            message = null;

          try {
            data = await response.json();
          } catch {
            message = "Response was not valid JSON, session expired";
            return { success: false, data, message };
          }

          return { success: true, data, message };
        } catch (err) {
          return { success: false, data: null, message: err.message };
        }
      },
      { baseWaslaHeaders, requestBody, apiUrl },
    );

    const { success, data, message } = result;

    const isDataString = typeof data === "string";

    if (isDataString || !success || message) {
      return {
        success: false,
        patients: [],
        data,
        message: isDataString ? data : message || "API fetch failed",
      };
    }

    if (data?.statusCode !== "Success") {
      return {
        success: false,
        patients: [],
        data,
        message: `API returned non-success status: ${
          isDataString ? data : data?.statusCode
        }`,
      };
    }

    return {
      success: true,
      patients: data?.data?.result || [],
      data,
      message: null,
    };
  } catch (err) {
    return { success: false, patients: [], data: null, message: err.message };
  }
};

export default fetchPatientsFromAPI;
