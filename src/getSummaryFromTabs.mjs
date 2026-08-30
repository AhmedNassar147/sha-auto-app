/*
 *
 * Helper: `getSummaryFromTabs`.
 *
 */
import getFormattedDateForSummary from "./getFormattedDateForSummary.mjs";
import {
  baseWaslaHeaders,
  listingApiUrl,
  PATIENT_SECTIONS_STATUS,
  TABS_COLLECTION_TYPES,
  API_URLS,
} from "./constants.mjs";

const globMedBodyData = {
  pageSize: 50_000,
  pageNumber: 1,
  providerZone: [],
  providerName: [],
  specialtyCode: [],
  referralTypeCode: [],
  referralReasonCode: [],
  genericSearch: "",
  // startDate: "2025-08-01",
  // endDate: "2025-08-30",
  sortOrder: "asc",
};

const { CASES_LIST: listingApiUrl } = API_URLS;

const { ACCEPTED, CONFIRMED, ADMITTED, DISCHARGED, DECLINED } =
  TABS_COLLECTION_TYPES;

const getSummaryFromTabs = async ({
  page,
  reportStartsAt,
  reportEndsAt,
  includeDeclined = false,
  includeConfirmed = false,
  includeAccepted = false,
  noDischarged = false,
  noAdmitted = false,
  noDates,
  extraParams,
}) => {
  const categories = [
    includeAccepted ? PATIENT_SECTIONS_STATUS[ACCEPTED] : null,
    includeConfirmed ? PATIENT_SECTIONS_STATUS[CONFIRMED] : null,
    noAdmitted ? null : PATIENT_SECTIONS_STATUS[ADMITTED],
    noDischarged ? null : PATIENT_SECTIONS_STATUS[DISCHARGED],
    includeDeclined ? PATIENT_SECTIONS_STATUS[DECLINED] : null,
  ].filter(Boolean);

  const endDate = noDates
    ? undefined
    : reportEndsAt
      ? reportEndsAt
      : getFormattedDateForSummary(new Date());

  const tabsResults = await page.evaluate(
    async ({
      listingApiUrl,
      baseWaslaHeaders,
      categories,
      globMedBodyData,
      reportStartsAt,
      endDate,
      extraParams,
    }) => {
      const responses = await Promise.allSettled(
        categories.map(async ({ categoryReference, tab }) => {
          try {
            const res = await fetch(listingApiUrl, {
              method: "POST",
              headers: baseWaslaHeaders,
              body: JSON.stringify({
                ...globMedBodyData,
                tab: tab,
                startDate: reportStartsAt || undefined,
                endDate: reportStartsAt ? endDate : undefined,
                ...(extraParams || null),
              }),
            });

            if (!res.ok) {
              return {
                success: false,
                error: `Status ${res.status}`,
                categoryReference,
              };
            }

            const data = await res.json();

            const { data: response, errorMessage } = data;
            const { result } = response || {};

            return {
              categoryReference,
              success: true,
              data: result || [],
              error: errorMessage,
            };
          } catch (err) {
            return {
              success: false,
              error: `Capture error: ${err.message}`,
              categoryReference,
            };
          }
        }),
      );

      return responses.reduce(
        (acc, result) => {
          const { categoryReference, data, error } = result.value || {};
          const isRejectedRequest = result?.status === "rejected";

          if (error || isRejectedRequest) {
            acc.errors.push(
              `❌ ${categoryReference || "unknown"} request ${
                isRejectedRequest ? "rejected" : "error"
              }: ${
                error || result.reason?.message || result.reason || "NOT DATA"
              }`,
            );
          } else {
            if (data?.length) {
              acc.patients.push(
                ...data.map((patient) => ({
                  ...patient,
                  tabName: categoryReference,
                  paid: 0,
                })),
              );
            }
          }

          return acc;
        },
        {
          patients: [],
          errors: [],
        },
      );
    },
    {
      categories,
      baseWaslaHeaders,
      listingApiUrl,
      globMedBodyData,
      reportStartsAt,
      endDate,
      extraParams,
    },
  );

  return tabsResults;
};

export default getSummaryFromTabs;
