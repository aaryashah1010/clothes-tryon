import type { Landmark } from "../pose";
import { CLOSE_SPAN, PRESENCE_HISTORY_MS, PRESENCE_STALE_MS } from "./config";

// Pure checks that decide whether an AI picture may be shown. No page, no canvas: they work on numbers and pixel arrays.

export type Presence = { t: number; ok: "ok" | "none" | "close"; legs: boolean };
type RGB = [number, number, number];

/** What one camera moment shows: nobody, someone too close, or someone properly in view (and whether the legs are in). */
export function presenceOf(lm: Landmark[] | null, t: number): Presence {
  const vis = (i: number) => (lm?.[i]?.visibility ?? 0) > 0.5;
  if (!lm || (!vis(11) && !vis(12))) return { t, ok: "none", legs: false };
  const span = Math.abs(lm[11]!.x - lm[12]!.x);
  return { t, ok: span > CLOSE_SPAN ? "close" : "ok", legs: (vis(25) || vis(26)) && (vis(27) || vis(28)) };
}

/** Adds a record and drops the old ones. */
export function pushPresence(log: Presence[], p: Presence): void {
  log.push(p);
  while (log.length && log[0]!.t < p.t - PRESENCE_HISTORY_MS) log.shift();
}

/** What the camera showed at time t. Two failed checks in a row are needed, so one missed detection changes nothing. */
export function presenceAt(log: Presence[], t: number): Presence | null {
  let i = log.length - 1;
  while (i >= 0 && log[i]!.t > t) i--;
  if (i < 0 || t - log[i]!.t > PRESENCE_STALE_MS) return null; // no tracker, or it stalled: don't judge
  const a = log[i]!;
  const b = log[i - 1];
  if (a.ok === "ok" || !b || b.ok === "ok") return { ...a, ok: "ok" };
  return a;
}

export function skinLike([r, g, b]: RGB): boolean {
  const y = 0.299 * r + 0.587 * g + 0.114 * b;
  const cr = (r - y) * 0.713 + 128;
  const cb = (b - y) * 0.564 + 128;
  return y > 40 && r > g && cr >= 135 && cr <= 180 && cb >= 80 && cb <= 135;
}

/** True when the lower part of a limb looks like skin while the upper part is garment-coloured. */
export function limbBare(lm: Landmark[], root: number, mid: number, end: number, d: Uint8ClampedArray, w: number, h: number): boolean {
  const pts = [lm[root], lm[mid], lm[end]];
  if (pts.some((p) => !p || (p.visibility ?? 0) < 0.5)) return false;
  const [A, B, C] = pts as [Landmark, Landmark, Landmark];
  const sample = (p: Landmark, q: Landmark, fr: number[]): RGB => {
    const cols: RGB[] = fr.map((f) => {
      const cx = Math.round((p.x + (q.x - p.x) * f) * (w - 1));
      const cy = Math.round((p.y + (q.y - p.y) * f) * (h - 1));
      const acc: RGB = [0, 0, 0];
      let n = 0;
      for (let dy = -1; dy <= 1; dy++)
        for (let dx = -1; dx <= 1; dx++) {
          const x = cx + dx;
          const y = cy + dy;
          if (x < 0 || y < 0 || x >= w || y >= h) continue;
          const i = (y * w + x) * 4;
          acc[0] += d[i]!;
          acc[1] += d[i + 1]!;
          acc[2] += d[i + 2]!;
          n++;
        }
      return n ? (acc.map((v) => v / n) as RGB) : [0, 0, 0];
    });
    const med = (k: 0 | 1 | 2) => cols.map((c) => c[k]).sort((x, y) => x - y)[Math.floor(cols.length / 2)]!;
    return [med(0), med(1), med(2)];
  };
  const upper = sample(A, B, [0.4, 0.55, 0.7]);
  const lower = sample(B, C, [0.3, 0.5, 0.7]);
  const dist = Math.hypot(upper[0] - lower[0], upper[1] - lower[1], upper[2] - lower[2]);
  return skinLike(lower) && !skinLike(upper) && dist > 60;
}

/** Bare forearms under long sleeves (arms) or bare lower legs under full-length trousers (legs), judged from RGBA pixels. */
export function bareWhereCovered(lm: Landmark[], d: Uint8ClampedArray, w: number, h: number, arms: boolean, legs: boolean): boolean {
  if (arms && (limbBare(lm, 11, 13, 15, d, w, h) || limbBare(lm, 12, 14, 16, d, w, h))) return true;
  if (legs && (limbBare(lm, 23, 25, 27, d, w, h) || limbBare(lm, 24, 26, 28, d, w, h))) return true;
  return false;
}
