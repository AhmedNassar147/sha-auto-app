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
    mobileNumber,
    nationality,
    nationalId,
    referralType,
    gender,
    maritalStatus,
    hijriDOB,
    specialty,
    subSpecialty,
    sourceProvider,
    providerZone,
    referralCause,
    note,
    referralEndDateActionablAt,
    cutoffTimeMs,
    referralEndDate,
    transferUrl,
  } = patient;

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
    `🔗 Client: ${safe(clientOrBranchName)}\n\n` +
    `🔗 Report: ${safe(transferUrl)}\n\n` +
    `────────────────────────\n\n` +
    `👤 Name: ${safe(patientName)}\n` +
    `📱 Mobile: ${safe(mobileNumber)}\n` +
    `🌐 Nationality: ${safe(nationality)}\n` +
    `🆔 National ID: ${safe(nationalId)}\n` +
    `🧑‍⚕️ Gender: ${safe(gender)}\n` +
    `❤️ Marital Status: ${safe(maritalStatus)}\n` +
    `📅 Hijri DOB: ${safe(hijriDOB)}\n` +
    `🏷️ Referral Type: ${safe(referralType)}\n` +
    `🩺 Specialty: ${safe(specialty)}\n` +
    `🔬 Sub-Specialty: ${safe(subSpecialty)}\n` +
    `🏥 Provider: ${safe(sourceProvider)}\n` +
    `📍 Zone: ${safe(providerZone)}\n` +
    `📝 Reason: ${safe(referralCause)}\n` +
    `🧾 Cause Note: ${safe(note)}`;

  return message;
};

export default formatPatientToNtfy;
