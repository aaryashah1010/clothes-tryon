// How the page adapts to the network. Pure numbers in, numbers out.

/** Exponential moving average: 0 means "no value yet", so the first sample is taken as it is. */
export const ema = (prev: number, sample: number, keep = 0.8): number => (prev ? prev * keep + sample * (1 - keep) : sample);

/**
 * JPEG quality for the next camera frames. Queueing = how much slower the round trip is than the fastest one seen;
 * a long but steady round trip is not congestion. Congested: lower the quality. Clear: raise it again, slowly.
 */
export function nextJpegQuality(quality: number, ackRttMs: number, minAckMs: number): number {
  const queueing = ackRttMs - minAckMs;
  if (queueing > 200) return Math.max(0.5, quality - 0.03);
  if (queueing < 80) return Math.min(0.8, quality + 0.01);
  return quality;
}
