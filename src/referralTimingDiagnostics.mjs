import { appendFile, readFile, writeFile } from "node:fs/promises";
import { join, dirname } from "node:path";
import createConsoleMessage from "./createConsoleMessage.mjs";
import generateFolderIfNotExisting from "./generateFolderIfNotExisting.mjs";

const EVENTS_FILE_PATH = join(
  process.cwd(),
  "results",
  "referral-timing",
  "events.jsonl",
);

/**
 * Diagnostic server-minus-client offset range, never a scheduling correction.
 * Assumes a fresh Date header generated between send and header receipt on the
 * relevant clock. Proxies/cache/backend clock differences can invalidate this.
 * Allows +/- one second for Date rounding; rejects observed wall-clock jumps.
 */
export const describeClockSample = (sample) => {
  if (!sample) return null;
  const {
    requestStartedAtMs,
    headersReceivedAtMs,
    headersElapsedMs,
    serverDate,
  } = sample;
  const serverDateMs = serverDate ? Date.parse(serverDate) : NaN;
  const wallElapsedMs = headersReceivedAtMs - requestStartedAtMs;
  const valid =
    Number.isFinite(serverDateMs) &&
    Number.isFinite(requestStartedAtMs) &&
    Number.isFinite(headersReceivedAtMs) &&
    wallElapsedMs >= 0 &&
    Number.isFinite(headersElapsedMs) &&
    Math.abs(wallElapsedMs - headersElapsedMs) <= 100;
  return {
    ...sample,
    serverDateMs: Number.isFinite(serverDateMs) ? serverDateMs : null,
    wallElapsedMs,
    usableUnderAssumptions: valid,
    serverMinusClientOffsetLowerMs: valid
      ? serverDateMs - 1000 - headersReceivedAtMs
      : null,
    serverMinusClientOffsetUpperMs: valid
      ? serverDateMs + 1000 - requestStartedAtMs
      : null,
    uncertainty:
      "Date rounding +/-1000ms plus transit; may describe proxy clock",
  };
};

/** Separates early submissions from attachment failures in diagnostic reports. */
export const classifySubmissionResult = (result) => {
  if (result?.success) return "api-success";
  const error = String(result?.error || "").toLowerCase();
  if (error.includes("review window has elapsed")) return "too-early";
  if (error.includes("attachments are missing or expired"))
    return "attachment-unavailable";
  return "other-failure";
};

/** Best-effort JSONL events containing case IDs and timing, no patient/auth data. */
export const writeReferralTimingEvent = async (event) => {
  try {
    await generateFolderIfNotExisting(dirname(EVENTS_FILE_PATH));
    await appendFile(
      EVENTS_FILE_PATH,
      JSON.stringify({ ...event, recordedAtMs: Date.now() }) + "\n",
      "utf8",
    );
  } catch (error) {
    createConsoleMessage(
      "warn",
      error?.message || String(error),
      "referral timing diagnostics",
    );
  }
};

// Looks up the earliest "case-received" event for a given referralId/source
// pair (e.g. the hidden-dashboard poll's own sighting, to compare against
// this same case's facility-tabs-poll receiptTiming already on the patient
// object) - best-effort, used for a Telegram notification line, not for
// anything that gates accept/reject.
export const getEarliestReferralTimingEvent = async (referralId, source) => {
  try {
    const raw = await readFile(EVENTS_FILE_PATH, "utf8");
    let earliest = null;

    for (const line of raw.split("\n")) {
      if (!line) continue;
      let event;
      try {
        event = JSON.parse(line);
      } catch {
        continue;
      }
      if (
        event.type === "case-received" &&
        event.source === source &&
        String(event.referralId) === String(referralId) &&
        (!earliest || event.recordedAtMs < earliest.recordedAtMs)
      ) {
        earliest = event;
      }
    }

    return earliest;
  } catch {
    return null;
  }
};

// Drops every stored event for a referralId once its case is resolved
// (accept/reject/withdraw - see PatientStore.removePatientByReferralId,
// where this is called alongside the generated-PDF cleanup) so
// events.jsonl only ever holds still-relevant, in-flight cases.
export const removeReferralTimingEvents = async (referralId) => {
  try {
    const raw = await readFile(EVENTS_FILE_PATH, "utf8");
    const kept = raw
      .split("\n")
      .filter((line) => {
        if (!line) return false;
        try {
          return String(JSON.parse(line).referralId) !== String(referralId);
        } catch {
          return true;
        }
      })
      .join("\n");

    await writeFile(EVENTS_FILE_PATH, kept ? kept + "\n" : "", "utf8");
  } catch (error) {
    if (error?.code !== "ENOENT") {
      createConsoleMessage(
        "warn",
        error?.message || String(error),
        "referral timing diagnostics (remove)",
      );
    }
  }
};
