/** Pure maths for the benchmark; no browser APIs so it can be tested in Node. */

export function mean(x: number[]): number {
  return x.length ? x.reduce((a, b) => a + b, 0) / x.length : 0;
}

export function percentile(x: number[], p: number): number {
  if (!x.length) return 0;
  const s = [...x].sort((a, b) => a - b);
  const i = Math.min(s.length - 1, Math.max(0, Math.round((p / 100) * (s.length - 1))));
  return s[i]!;
}

function pearson(a: number[], b: number[], k: number): number {
  // correlate a[i] with b[i + k]
  const n = Math.min(a.length, b.length - k);
  if (n < 5) return NaN;
  let ma = 0;
  let mb = 0;
  for (let i = 0; i < n; i++) {
    ma += a[i]!;
    mb += b[i + k]!;
  }
  ma /= n;
  mb /= n;
  let num = 0;
  let da = 0;
  let db = 0;
  for (let i = 0; i < n; i++) {
    const x = a[i]! - ma;
    const y = b[i + k]! - mb;
    num += x * y;
    da += x * x;
    db += y * y;
  }
  return da > 0 && db > 0 ? num / Math.sqrt(da * db) : NaN;
}

/**
 * How many samples does `b` trail `a` by? Both are motion signals sampled at the same rate
 * (camera motion and AI-output motion). Returns the best lag in samples and its correlation.
 */
export function estimateLag(
  a: number[],
  b: number[],
  maxLag: number,
): { lag: number; score: number; atZero: number } | null {
  if (Math.min(a.length, b.length) < maxLag * 3) return null;
  let best = { lag: 0, score: -Infinity };
  let atZero = NaN;
  for (let k = 0; k <= maxLag; k++) {
    const r = pearson(a, b, k);
    if (k === 0) atZero = r;
    if (Number.isFinite(r) && r > best.score) best = { lag: k, score: r };
  }
  return Number.isFinite(best.score) ? { ...best, atZero } : null;
}

/** Light smoothing so single noisy frames don't dominate the correlation. */
export function smooth(x: number[], radius = 2): number[] {
  return x.map((_, i) => {
    let s = 0;
    let c = 0;
    for (let j = Math.max(0, i - radius); j <= Math.min(x.length - 1, i + radius); j++) {
      s += x[j]!;
      c++;
    }
    return s / c;
  });
}
