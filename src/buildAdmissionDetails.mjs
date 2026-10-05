/*
 *
 * Helper: `buildAdmissionDetails`.
 *
 * Builds the extra payload fields Wasla's own frontend collects via its
 * "Admission Details" modal before accepting an Inpatient-type referral
 * (confirmed live: html/details-js-code.js's `jr`/`hr` components + `Rr`'s
 * handleAccept branch on subReferralTypeId === Inpatient) - our own
 * direct-API accept flow has no UI to fill this in, so this fabricates the
 * same shape instead, with placeholder values per instruction:
 *   - transportationScheduleDate/startDate: today.
 *   - patientFileNumber: the patient's national id.
 *   - departmentId: the referral's own specialty id, as a Number -
 *     confirmed from `hr`'s getPayload() (`departmentId: Number(t.department?.id)`),
 *     not "department" and not a string, as an earlier version of this
 *     file wrongly had it.
 *   - roomNumber/bedNumber: the SAME randomly-generated number (not two
 *     independent ones), within a range picked by the requested bed type,
 *     per instruction:
 *       ICU/CCU: 1-26, Ward: 300-400, NICU: 1-30, PICU: 1-4.
 *
 * requestedBedType names are matched exactly as Wasla's API returns them
 * (confirmed across results/raw-referral-responses/*.json). There's a real
 * canonical list beyond these 5 though (scripts/index-DkGuikpU.js's
 * getBedTypes, GET /lookup/bed-types - the ids we've actually seen, 1/2/5/
 * 6/7, skip 3 and 4), plus a free-text "Other" option
 * (requestedBedType.otherValue in scripts/arrival-min.js) that can never be
 * fully enumerated - so anything not in BED_TYPE_RANGES falls back to
 * DEFAULT_RANGE rather than failing outright.
 *
 * transportationScheduleDate/startDate's format is confirmed too -
 * scripts/date-D9qzqbG9.js's `$n` (imported as `G` in details-js-code.js,
 * `hr`'s getPayload()) builds exactly
 * `${year}-${String(month+1).padStart(2,"0")}-${String(day).padStart(2,"0")}`,
 * i.e. plain "YYYY-MM-DD" with no time component - matching
 * getTodayDateString() below.
 *
 */

const PICU_RANGE = [1, 4];

const BED_TYPE_RANGES = {
  "Adult Intensive Care Unit (ICU)": [1, 26],
  "Coronary Care Unit (CCU)": [1, 26],
  "Ward Bed": [300, 400],
  "Neonatal Intensive Care Unit (NICU)": [1, 30],
  "Pediatric Intensive Care Unit (PICU)": PICU_RANGE,
};

// Same as ICU - used for any requestedBedType not in the map above
// (an as-yet-unseen canonical type, or a free-text "Other" value).
const DEFAULT_RANGE = [1, 26];

const randomInRange = (min, max) =>
  String(min + Math.floor(Math.random() * (max - min + 1)));

// Local getters, not toISOString() - that converts to UTC and can shift the
// date by a day depending on time-of-day/system offset, wrong for "today".
const getTodayDateString = () => {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
};

/**
 * @param {object} params
 * @param {string} params.patientNationalId
 * @param {string | number} params.specialtyId
 * @param {string} params.requestedBedType - The bed type's name exactly as
 *   stored (e.g. "Ward Bed", "Adult Intensive Care Unit (ICU)").
 * @returns {{
 *   transportationScheduleDate: string,
 *   startDate: string,
 *   patientFileNumber: string,
 *   departmentId: number,
 *   roomNumber: string,
 *   bedNumber: string,
 * }}
 */
const buildAdmissionDetails = ({
  patientNationalId,
  specialtyId,
  requestedBedType,
}) => {
  const range = (requestedBedType || "").toLowerCase().includes("picu")
    ? PICU_RANGE
    : (BED_TYPE_RANGES[requestedBedType] ?? DEFAULT_RANGE);

  const [min, max] = range;
  const bedNumber = randomInRange(min, max);
  const today = getTodayDateString();

  return {
    transportationScheduleDate: today,
    startDate: today,
    patientFileNumber: String(patientNationalId),
    departmentId: Number(specialtyId),
    roomNumber: Math.random() > 0.4 ? bedNumber : `roomNo ${bedNumber}`,
    bedNumber: Math.random() > 0.6 ? bedNumber : `bedNo ${bedNumber}`,
  };
};

export default buildAdmissionDetails;
export { BED_TYPE_RANGES };
