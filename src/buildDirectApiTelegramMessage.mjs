import formatWatcherCompetition from "./formatWatcherCompetition.mjs";

/** Operator summary only. Full attempt/network details are in events.jsonl. */
export default function buildDirectApiTelegramMessage({
  isAcceptanceAction,
  referralId,
  navigationId,
  patientName,
  patientNationalId,
  apiResult,
  attemptsMade,
  competitionPatient,
  sleepMS,
  preUploadInteractionMs,
}) {
  const code = (value) =>
    "`" + String(value ?? "").replace(/[`\r\n]/g, " ") + "`";
  const action = isAcceptanceAction ? "acceptance" : "rejection";
  // The error body can be a large HTML response. Keep the complete value
  // in diagnostics and bound the operator copy.
  const resultText = String(
    apiResult.success
      ? apiResult.data?.message ||
          "Submission recorded; final assignment is checked separately."
      : apiResult.errorType === "cloudflare-block"
        ? `Cloudflare blocked the ${apiResult.step?.includes("upload") ? "attachment upload" : "submission"} (HTTP 403).` +
          (apiResult.responseHeaders?.["cf-ray"]
            ? ` Ray ID: ${apiResult.responseHeaders["cf-ray"]}`
            : "")
        : apiResult.error || "No response details",
  ).slice(0, 600);
  return (
    `*${apiResult.success ? "Submitted" : "Failed"} ${action} via API*\n` +
    `Referral ID: ${code(referralId)}\nCase ID: ${code(navigationId)}\n` +
    (patientName ? `Patient: ${code(patientName)}\n` : "") +
    (patientNationalId ? `National ID: ${code(patientNationalId)}\n` : "") +
    `${resultText.replace(/[`*_\[\]]/g, " ")}\n` +
    `Attempts: ${attemptsMade}\n` +
    `PreUploadInteractionMs: ${preUploadInteractionMs}\n` +
    `Sleep: ${sleepMS}ms\n` +
    formatWatcherCompetition(competitionPatient) +
    (apiResult.success
      ? ""
      : apiResult.errorType === "cloudflare-block"
        ? "\n\nAutomatic submission stopped. The case tab remains open for manual review."
        : "\n\nFalling back to the UI.")
  );
}
