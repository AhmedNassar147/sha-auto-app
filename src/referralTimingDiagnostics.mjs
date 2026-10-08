import { appendFile } from "node:fs/promises";
import { join } from "node:path";
import createConsoleMessage from "./createConsoleMessage.mjs";
import generateFolderIfNotExisting from "./generateFolderIfNotExisting.mjs";

/**
 * Diagnostic server-minus-client offset range, never a scheduling correction.
 * Assumes a fresh Date header generated between send and header receipt on the
 * relevant clock. Proxies/cache/backend clock differences can invalidate this.
 * Allows +/- one second for Date rounding; rejects observed wall-clock jumps.
 */
export const describeClockSample = (sample) => {
  if (!sample) return null;
  const { requestStartedAtMs, headersReceivedAtMs, headersElapsedMs, serverDate } = sample;
  const serverDateMs = serverDate ? Date.parse(serverDate) : NaN;
  const wallElapsedMs = headersReceivedAtMs - requestStartedAtMs;
  const valid = Number.isFinite(serverDateMs) &&
    Number.isFinite(requestStartedAtMs) && Number.isFinite(headersReceivedAtMs) &&
    wallElapsedMs >= 0 && Number.isFinite(headersElapsedMs) &&
    Math.abs(wallElapsedMs - headersElapsedMs) <= 100;
  return {
    ...sample,
    serverDateMs: Number.isFinite(serverDateMs) ? serverDateMs : null,
    wallElapsedMs,
    usableUnderAssumptions: valid,
    serverMinusClientOffsetLowerMs: valid ? serverDateMs - 1000 - headersReceivedAtMs : null,
    serverMinusClientOffsetUpperMs: valid ? serverDateMs + 1000 - requestStartedAtMs : null,
    uncertainty: "Date rounding +/-1000ms plus transit; may describe proxy clock",
  };
};

/** Separates early submissions from attachment failures in diagnostic reports. */
export const classifySubmissionResult = (result) => {
  if (result?.success) return "api-success";
  const error = String(result?.error || "").toLowerCase();
  if (error.includes("review window has elapsed")) return "too-early";
  if (error.includes("attachments are missing or expired")) return "attachment-unavailable";
  return "other-failure";
};

/** Best-effort JSONL events containing case IDs and timing, no patient/auth data. */
export const writeReferralTimingEvent = async (event) => {
  try {
    const directory = join(process.cwd(), "results", "referral-timing");
    await generateFolderIfNotExisting(directory);
    await appendFile(join(directory, "events.jsonl"),
      JSON.stringify({ ...event, recordedAtMs: Date.now() }) + "\n", "utf8");
  } catch (error) {
    createConsoleMessage("warn", error?.message || String(error), "referral timing diagnostics");
  }
};
