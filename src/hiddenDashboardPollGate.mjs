/*
 *
 * Helper: hidden-dashboard poll gate.
 *
 * Lets handleSubmitReferral.mjs tell pollHiddenWaslaDashboardForTiming.mjs
 * to sit out the accept/reject window - diagnostics-only traffic has no
 * reason to run while a time-critical submission is in flight. A counter,
 * not a boolean, so two overlapping submissions (different patients'
 * deadlines landing close together) don't let the first one finishing
 * resume polling while the second is still critical.
 *
 */
let activeCount = 0;

export const pauseHiddenDashboardPoll = () => {
  activeCount++;
};

export const resumeHiddenDashboardPoll = () => {
  activeCount = Math.max(0, activeCount - 1);
};

export const isHiddenDashboardPollPaused = () => activeCount > 0;
