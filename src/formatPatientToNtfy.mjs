/*
 *
 * Helper: `formatPatientToNtfy`.
 *
 */
const safe = (value) => value ?? "";

const formatPatientToNtfy = (patient) => {
  const {
    referralId,
    patientName,
    patientNationalId,
    referralType,
    providerRegion,
    referralReason,
    referralEndDateActionablAt,
    cutoffTimeMs,
    referralEndDate,
    transferUrl,
    facilityReviewWindowMinutes,
    acceptanceWindowMinutes,
    extendScopeWindowMinutes,
    // Not on the Wasla list-row shape - still unconfirmed whether/where the
    // per-case details API (getWaslaPatientReferralDataFromAPI, not wired
    // in yet) will surface these. Kept so this formatter doesn't need
    // another pass once that's confirmed; safe() prints "" until then.
    mobileNumber,
    nationality,
    gender,
    maritalStatus,
    hijriDOB,
    specialty,
    subSpecialty,
    sourceProvider,
    note,
  } = patient;

  const referralReasonText = Array.isArray(referralReason)
    ? referralReason.join(" - ")
    : referralReason;

  const { BRANCH_NAME, CLIENT_ID, USE_NTFY_AS_CASE_PROVIDER } = process.env;

  const useFullMessage = USE_NTFY_AS_CASE_PROVIDER === "Y";

  const clientOrBranchName = BRANCH_NAME || CLIENT_ID || "Unknown";

  if (!useFullMessage) {
    return `At ${clientOrBranchName} NEW Patient ${referralId}`;
  }

  let cutoffLabel = "0 s";

  if (cutoffTimeMs) {
    const nf = new Intl.NumberFormat(undefined, {
      minimumFractionDigits: 3,
      maximumFractionDigits: 3,
    });

    cutoffLabel = `${nf.format(cutoffTimeMs / 1000)} s`;
  }

  const message =
    `🚨 New Case Alert!\n\n` +
    `🔢 Referral ID: ${safe(referralId)}\n` +
    `🕐 Actionable At: ${safe(referralEndDateActionablAt)}\n` +
    `🕐 Cutoff Time: ${cutoffLabel}\n` +
    `🕐 Ends At: ${safe(referralEndDate)}\n` +
    `🪟 Review Window: ${safe(facilityReviewWindowMinutes)} min\n` +
    `🪟 Acceptance Window: ${safe(acceptanceWindowMinutes)} min\n` +
    `🪟 Extend Scope Window: ${safe(extendScopeWindowMinutes)} min\n` +
    `🔗 Client: ${safe(clientOrBranchName)}\n\n` +
    `🔗 Report: ${safe(transferUrl)}\n\n` +
    `────────────────────────\n\n` +
    `👤 Name: ${safe(patientName)}\n` +
    `📱 Mobile: ${safe(mobileNumber)}\n` +
    `🌐 Nationality: ${safe(nationality)}\n` +
    `🆔 National ID: ${safe(patientNationalId)}\n` +
    `🧑‍⚕️ Gender: ${safe(gender)}\n` +
    `❤️ Marital Status: ${safe(maritalStatus)}\n` +
    `📅 Hijri DOB: ${safe(hijriDOB)}\n` +
    `🏷️ Referral Type: ${safe(referralType)}\n` +
    `🩺 Specialty: ${safe(specialty)}\n` +
    `🔬 Sub-Specialty: ${safe(subSpecialty)}\n` +
    `🏥 Provider: ${safe(sourceProvider)}\n` +
    `📍 Zone: ${safe(providerRegion)}\n` +
    `📝 Reason: ${safe(referralReasonText)}\n` +
    `🧾 Cause Note: ${safe(note)}`;

  return message;
};

export default formatPatientToNtfy;
