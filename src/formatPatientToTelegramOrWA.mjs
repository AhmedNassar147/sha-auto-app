/*
 *
 * Helper: `formatPatientToTelegramOrWA`.
 *
 */
import { WASLA_REFERRAL_VIEW_URL } from "./constants.mjs";
import getOrgLabel from "./getOrgLabel.mjs";

const formatPatientToTelegramOrWA = (patient, forTelegram) => {
  const {
    referralId,
    navigationId,
    patientName,
    patientNationalId,
    referralType,
    providerRegion,
    referralReason,
    referralEndDateActionablAt,
    files,
    cutoffTimeMs,
    referralEndDate,
    facilityReviewWindowMinutes,
    acceptanceWindowMinutes,
    extendScopeWindowMinutes,
    // requestDate,
    // Not on the Wasla list-row shape - still unconfirmed whether/where the
    // per-case details API (getWaslaPatientReferralDataFromAPI, not wired
    // in yet) will surface these. Kept so this formatter doesn't need
    // another pass once that's confirmed; each prints "" until then.
    mobileNumber,
    nationality,
    gender,
    maritalStatus,
    hijriDOB,
    specialty,
    subSpecialty,
    sourceProvider,
    note,
    medicalData,
    subReferralTypeId,
    subReferralTypeName,
  } = patient;

  // id "1" = Inpatient (confirmed live, caseInfo.subReferralType - see
  // buildAdmissionDetails.mjs) - flagged here, right when the case first
  // arrives, since accepting it needs Wasla's own Admission Details form
  // filled in (not fully automatable yet), so the operator should know
  // upfront rather than finding out only once they try to accept it.
  const isInpatientReferral =
    String(subReferralTypeId) === "1" ||
    (subReferralTypeName || "").toLowerCase() === "inpatient";

  const referralReasonText = Array.isArray(referralReason)
    ? referralReason.join(" - ")
    : referralReason;

  const orgLabel = getOrgLabel();

  let label = `0 s`;

  if (cutoffTimeMs) {
    const nf = new Intl.NumberFormat(undefined, {
      minimumFractionDigits: 3,
      maximumFractionDigits: 3,
    });

    label = `${nf.format(cutoffTimeMs / 1000)} s`; // e.g., "6.125 s"
  }

  let message = undefined;

  const caseUrl = navigationId
    ? `${WASLA_REFERRAL_VIEW_URL}/${navigationId}`
    : undefined;

  const inpatientWarningHtml = isInpatientReferral
    ? `🔴 <b>INPATIENT - needs Admission Details form, review before accepting</b>\n\n`
    : "";
  const inpatientWarningMarkdown = isInpatientReferral
    ? `🔴 *INPATIENT - needs Admission Details form, review before accepting*\n\n`
    : "";

  if (forTelegram) {
    message =
      `🚨 <b>New Case Alert!</b> 🚨\n\n` +
      inpatientWarningHtml +
      `🏢 <b>ORG:</b> <code>${orgLabel}</code>\n` +
      `🕐 <b>Actionable At:</b> ${referralEndDateActionablAt}\n` +
      `🕐 <b>cutoffTime:</b> ${label}\n` +
      `🕐 <b>Ends At:</b> ${referralEndDate}\n` +
      `🪟 <b>Review Window:</b> ${facilityReviewWindowMinutes ?? ""} min\n` +
      `🪟 <b>Acceptance Window:</b> ${acceptanceWindowMinutes ?? ""} min\n` +
      `🪟 <b>Extend Scope Window:</b> ${extendScopeWindowMinutes ?? ""} min\n` +
      `────────────────────────\n\n` +
      (caseUrl ? `🔗 <b>Case Link:</b> <a href="${caseUrl}">Open</a>\n` : "") +
      `🔢 <b>Referral ID:</b> <code>${referralId}</code>\n` +
      `🆔 <b>Navigation ID:</b> <code>${navigationId || ""}</code>\n` +
      `👤 <b>Name:</b> <code>${patientName}</code>\n` +
      `📱 <b>Mobile:</b> <code>${mobileNumber || ""}</code>\n` +
      `🌐 <b>Nationality:</b> <code>${nationality || ""}</code>\n` +
      `🆔 <b>National ID:</b> <code>${patientNationalId}</code>\n` +
      `🧑‍⚕️ <b>Gender:</b> <code>${gender || ""}</code>\n` +
      `❤️ <b>Marital Status:</b> <code>${maritalStatus || ""}</code>\n` +
      `📅 <b>Hijri DOB:</b> <code>${hijriDOB || ""}</code>\n` +
      `🏷️ <b>Referral Type:</b> <code>${referralType}</code>\n` +
      `🩺 <b>Specialty:</b> <code>${specialty || ""}</code>\n` +
      `🔬 <b>Sub-Specialty:</b> <code>${subSpecialty || ""}</code>\n` +
      `🏥 <b>Provider:</b> <code>${sourceProvider || ""}</code>\n` +
      `📍 <b>Zone:</b> <code>${providerRegion}</code>\n` +
      `📝 <b>Reason:</b> <code>${referralReasonText}</code>\n` +
      `🧾 <b>CauseNote:</b> <code>${note || ""}</code>\n` +
      `🩻 <b>Medical Data:</b> <code>${medicalData || ""}</code>\n`;
  } else {
    message =
      `🚨 *New Case Alert!* 🚨\n\n` +
      inpatientWarningMarkdown +
      `🏢 *ORG:* \`${orgLabel}\`\n` +
      `🕐 *Actionable At*: ${referralEndDateActionablAt}\n` +
      `🕐 *cutoffTime*: ${label}\n` +
      `🕐 *Ends At*: ${referralEndDate}\n` +
      `🪟 *Review Window*: ${facilityReviewWindowMinutes ?? ""} min\n` +
      `🪟 *Acceptance Window*: ${acceptanceWindowMinutes ?? ""} min\n` +
      `🪟 *Extend Scope Window*: ${extendScopeWindowMinutes ?? ""} min\n` +
      `────────────────────────\n\n` +
      (caseUrl ? `🔗 *Case Link:* ${caseUrl}\n` : "") +
      `🔢 *Referral ID:* \`${referralId}\`\n` +
      `🆔 *Navigation ID:* \`${navigationId || ""}\`\n` +
      `👤 *Name:* \`${patientName}\`\n` +
      `📱 *Mobile:* \`${mobileNumber || ""}\`\n` +
      `🌐 *Nationality:* \`${nationality || ""}\`\n` +
      `🆔 *National ID:* \`${patientNationalId}\`\n` +
      `🧑‍⚕️ *Gender:* \`${gender || ""}\`\n` +
      `❤️ *Marital Status:* \`${maritalStatus || ""}\`\n` +
      `📅 *Hijri DOB:* \`${hijriDOB || ""}\`\n` +
      `🏷️ *Referral Type:* \`${referralType}\`\n` +
      `🩺 *Specialty:* \`${specialty || ""}\`\n` +
      `🔬 *Sub-Specialty:* \`${subSpecialty || ""}\`\n` +
      `🏥 *Provider:* \`${sourceProvider || ""}\`\n` +
      `📍 *Zone:* \`${providerRegion}\`\n` +
      // `🗓️ *Requested At:* \`${requestDate}\`\n` +
      `📝 *Reason:* \`${referralReasonText}\`\n` +
      `🧾 *CauseNote:* \`${note || ""}\`\n` +
      `🩻 *Medical Data:* \`${medicalData || ""}\`\n`;
  }

  return {
    message,
    files,
    referralId,
  };
};

export default formatPatientToTelegramOrWA;
