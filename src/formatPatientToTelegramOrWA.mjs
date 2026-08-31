/*
 *
 * Helper: `formatPatientToTelegramOrWA`.
 *
 */
const formatPatientToTelegramOrWA = (patient, forTelegram) => {
  const {
    referralId,
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
  } = patient;

  const referralReasonText = Array.isArray(referralReason)
    ? referralReason.join(" - ")
    : referralReason;

  let label = `0 s`;

  if (cutoffTimeMs) {
    const nf = new Intl.NumberFormat(undefined, {
      minimumFractionDigits: 3,
      maximumFractionDigits: 3,
    });

    label = `${nf.format(cutoffTimeMs / 1000)} s`; // e.g., "6.125 s"
  }

  let message = undefined;

  if (forTelegram) {
    message =
      `🚨 <b>New Case Alert!</b> 🚨\n\n` +
      `🕐 <b>Actionable At:</b> ${referralEndDateActionablAt}\n` +
      `🕐 <b>cutoffTime:</b> ${label}\n` +
      `🕐 <b>Ends At:</b> ${referralEndDate}\n` +
      `🪟 <b>Review Window:</b> ${facilityReviewWindowMinutes ?? ""} min\n` +
      `🪟 <b>Acceptance Window:</b> ${acceptanceWindowMinutes ?? ""} min\n` +
      `🪟 <b>Extend Scope Window:</b> ${extendScopeWindowMinutes ?? ""} min\n` +
      `────────────────────────\n\n` +
      `🔢 <b>Referral ID:</b> <code>${referralId}</code>\n` +
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
      `🧾 <b>CauseNote:</b> <code>${note || ""}</code>\n`;
  } else {
    message =
      `🚨 *New Case Alert!* 🚨\n\n` +
      `🕐 *Actionable At*: ${referralEndDateActionablAt}\n` +
      `🕐 *cutoffTime*: ${label}\n` +
      `🕐 *Ends At*: ${referralEndDate}\n` +
      `🪟 *Review Window*: ${facilityReviewWindowMinutes ?? ""} min\n` +
      `🪟 *Acceptance Window*: ${acceptanceWindowMinutes ?? ""} min\n` +
      `🪟 *Extend Scope Window*: ${extendScopeWindowMinutes ?? ""} min\n` +
      `────────────────────────\n\n` +
      `🔢 *Referral ID:* \`${referralId}\`\n` +
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
      `🧾 *CauseNote:* \`${note || ""}\`\n`;
  }

  return {
    message,
    files,
    referralId,
  };
};

export default formatPatientToTelegramOrWA;
