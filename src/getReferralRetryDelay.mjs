/**
 * Time spent receiving the first response counts toward its retry target.
 * Later retries use the normal gap, always after the previous response.
 */
export default function getReferralRetryDelay({
  attemptCount,
  nowMs,
  referralEndTimestamp,
  totalBufferMs,
  retryGapMs,
}) {
  const gapMs = Math.max(0, retryGapMs);
  return attemptCount === 1
    ? Math.max(gapMs, referralEndTimestamp + totalBufferMs - nowMs)
    : gapMs;
}
