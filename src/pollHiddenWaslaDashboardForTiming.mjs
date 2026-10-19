/*
 *
 * Helper: `startHiddenDashboardTimingPoll`.
 *
 * Polls API_URLS.ALL_REFERRALS_TABS (the non-facility-scoped "hidden
 * dashboard" endpoint) on a jittered ~150-250ms interval, purely to record
 * how soon each referralId is first seen here relative to its broadcastedAt
 * - written to the same results/referral-timing/events.jsonl file as
 * processCollectingPatients.mjs's own "case-received" event (tagged
 * source: "facility-tabs-poll" there, "hidden-dashboard-poll" here), so the
 * two can be compared per referralId to see which one notices a case
 * first/closer to the real broadcast moment. Never drives accept/reject -
 * diagnostics only.
 *
 */
import getAllWaslaCasesFromHiddenDashboard from "./getAllWaslaCasesFromHiddenDashboard.mjs";
import { writeReferralTimingEvent } from "./referralTimingDiagnostics.mjs";
import createConsoleMessage from "./createConsoleMessage.mjs";
import sleep from "./sleep.mjs";

/**
 * @param {{ getFrame: () => import("puppeteer").Frame | null }} params
 *   getFrame is called fresh on every tick - the caller is expected to keep
 *   it pointed at the current live frame (see waitForWaitingCountWithInterval.mjs),
 *   since the main loop tears down and replaces it on reloads/relogin.
 * @returns {void} Runs forever in the background - not meant to be awaited.
 */
const startHiddenDashboardTimingPoll = ({ getFrame }) => {
  let seenReferralIds = new Set();

  (async () => {
    while (true) {
      const intervalMs = 150 + Math.random() * 100;
      await sleep(intervalMs);

      try {
        const frame = getFrame?.();
        if (!frame || frame.detached) continue;

        const { success, patients } =
          await getAllWaslaCasesFromHiddenDashboard(frame);

        if (!success || !patients?.length) {
          continue;
        }

        const currentReferralIds = new Set();

        for (const patient of patients) {
          const referralId = String(patient.referralId);
          currentReferralIds.add(referralId);

          if (seenReferralIds.has(referralId)) continue;

          const seenAtMs = Date.now();
          const broadcastedAtParsedMs = patient.broadcastedAt
            ? new Date(patient.broadcastedAt).getTime()
            : null;

          await writeReferralTimingEvent({
            type: "case-received",
            source: "hidden-dashboard-poll",
            referralId,
            navigationId: patient.id,
            broadcastedAtRaw: patient.broadcastedAt ?? null,
            broadcastedAtParsedMs,
            receivedAtMs: seenAtMs,
            receivedAfterBroadcastMs:
              broadcastedAtParsedMs != null
                ? seenAtMs - broadcastedAtParsedMs
                : null,
          });
        }

        // Drop ids that fell out of this poll (resolved/claimed elsewhere)
        // rather than ever-growing - a referralId reappearing later (e.g.
        // page wrap) just gets recorded again, which is fine for this
        // diagnostic-only comparison.
        seenReferralIds = currentReferralIds;
      } catch (error) {
        createConsoleMessage(
          "warn",
          error?.message || String(error),
          "pollHiddenWaslaDashboardForTiming",
        );
      }
    }
  })();
};

export default startHiddenDashboardTimingPoll;
