const MAX_BACKOFF_MS = 5 * 60_000;
const JITTER_FRACTION = 0.2;

/** Returns a bounded poll delay with jitter to spread clients across the interval. */
export function notificationPollDelay(
  baseMs: number,
  consecutiveFailures: number,
  random: () => number = Math.random,
): number {
  const exponent = Math.min(10, Math.max(0, Math.floor(consecutiveFailures)));
  const backoff = Math.min(MAX_BACKOFF_MS, baseMs * 2 ** exponent);
  const sample = Math.min(1, Math.max(0, random()));
  const jitter = (sample * 2 - 1) * JITTER_FRACTION;
  return Math.max(1_000, Math.round(backoff * (1 + jitter)));
}
