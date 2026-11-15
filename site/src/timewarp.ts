/**
 * Time-warp: hide the GPU round trip by bending the newest AI picture onto the body's pose right now.
 *
 * The AI frame arrives ~0.5-1 s late. Its pose is detected on the AI picture itself, the live pose on the
 * camera. A triangle mesh over torso and arms maps one onto the other (piecewise affine), so the garment
 * follows the body with no network delay; only the garment's look (folds, light) refreshes at the AI rate.
 * Everything outside the garment (face, hands, background) is the live camera.
 *
 * All points are normalized to the sent camera crop (0..1), which is also the AI picture's frame.
 */
import type { Landmark } from "./pose";
import { PointFilter } from "./filter";

export type Pt = { x: number; y: number };
type Tri = [Pt, Pt, Pt];

const LS = 11, RS = 12, LE = 13, RE = 14, LW = 15, RW = 16, LH = 23, RH = 24;
const VIS = 0.5;
// elbows are often just outside the picture; MediaPipe's estimate is still good enough to carry a sleeve
const ELBOW_VIS = 0.15;
const WRIST_VIS = 0.3;

// garment shape around the skeleton, in shoulder widths (tuned for jackets and tops)
const SHOULDER_OUT = 0.3;
const SHOULDER_UP = 0.1; // the garment covers the top of the shoulders, not only the chest below them
const NECK_UP = 0.16;
const HIP_OUT = 0.28;
const HEM_DOWN = 0.18; // below the hips, in torso lengths
const UPPER_ARM_HALF = 0.22;
const FOREARM_HALF = 0.17;
const CUFF_PAST_WRIST = 0.08; // in forearm lengths
const MASK_DOWN = 6; // garment mask resolution divisor; sets how soft the garment's edge is

export type Flags = { torso: boolean; leftUpper: boolean; leftFore: boolean; rightUpper: boolean; rightFore: boolean };

// past these, bending the old picture distorts it more than its age hurts: show it as it is instead
const MAX_WIDTH_CHANGE = 1.45; // shoulder width, live vs AI picture (turning sideways)
const MAX_TILT_CHANGE = 0.6; // radians of shoulder-line rotation

const vis = (lm: Landmark[], i: number) => lm[i]?.visibility ?? 1;

/** Which parts can be warped: they must be seen in both the AI picture and the live camera. */
export function flagsFor(a: Landmark[], b: Landmark[]): Flags {
  const ok = (i: number, min = VIS) => vis(a, i) > min && vis(b, i) > min;
  const torso = ok(LS) && ok(RS);
  const leftUpper = torso && ok(LE, ELBOW_VIS);
  const rightUpper = torso && ok(RE, ELBOW_VIS);
  return {
    torso,
    leftUpper,
    leftFore: leftUpper && ok(LW, WRIST_VIS),
    rightUpper,
    rightFore: rightUpper && ok(RW, WRIST_VIS),
  };
}

/** Triangle mesh in normalized crop coordinates. Same flags give the same topology for both poses. */
export function buildMesh(lm: Landmark[], f: Flags, aspect: number): Tri[] {
  // work in aspect-corrected space so widths and normals are true distances
  const P = (i: number): Pt => ({ x: lm[i]!.x * aspect, y: lm[i]!.y });
  const add = (a: Pt, b: Pt, k = 1): Pt => ({ x: a.x + b.x * k, y: a.y + b.y * k });
  const sub = (a: Pt, b: Pt): Pt => ({ x: a.x - b.x, y: a.y - b.y });
  const len = (a: Pt) => Math.hypot(a.x, a.y) || 1e-6;
  const unit = (a: Pt): Pt => ({ x: a.x / len(a), y: a.y / len(a) });
  const mid = (a: Pt, b: Pt): Pt => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });

  const ls = P(LS), rs = P(RS), lh = P(LH), rh = P(RH);
  const sw = len(sub(ls, rs));
  const ms = mid(ls, rs);
  const mh = mid(lh, rh);
  const torsoLen = len(sub(mh, ms));
  const down = unit(sub(mh, ms));
  const across = unit(sub(ls, rs)); // from the right shoulder towards the left one

  const tris: Tri[] = [];
  if (f.torso) {
    const tl = add(add(ls, across, SHOULDER_OUT * sw), down, -SHOULDER_UP * sw);
    const tr = add(add(rs, across, -SHOULDER_OUT * sw), down, -SHOULDER_UP * sw);
    const neck = add(ms, down, -NECK_UP * sw);
    const bl = add(add(lh, across, HIP_OUT * sw), down, HEM_DOWN * torsoLen);
    const br = add(add(rh, across, -HIP_OUT * sw), down, HEM_DOWN * torsoLen);
    const c = mid(ms, mh);
    tris.push([tl, neck, c], [neck, tr, c], [tr, br, c], [br, bl, c], [bl, tl, c]);
  }
  const limb = (a: Pt, b: Pt, half: number, extend: number) => {
    const d = unit(sub(b, a));
    const n: Pt = { x: -d.y, y: d.x };
    const b2 = add(b, d, extend * len(sub(b, a)));
    const q0 = add(a, n, half * sw), q1 = add(b2, n, half * sw), q2 = add(b2, n, -half * sw), q3 = add(a, n, -half * sw);
    tris.push([q0, q1, q2], [q0, q2, q3]);
  };
  if (f.leftUpper) limb(ls, P(LE), UPPER_ARM_HALF, 0.05);
  if (f.leftFore) limb(P(LE), P(LW), FOREARM_HALF, CUFF_PAST_WRIST);
  if (f.rightUpper) limb(rs, P(RE), UPPER_ARM_HALF, 0.05);
  if (f.rightFore) limb(P(RE), P(RW), FOREARM_HALF, CUFF_PAST_WRIST);
  return tris.map((t) => t.map((p) => ({ x: p.x / aspect, y: p.y })) as Tri);
}

/** True when the body turned or tilted so much that bending the old picture would distort it. */
function tooDifferent(a: Landmark[], b: Landmark[], aspect: number): boolean {
  const line = (lm: Landmark[]) => ({ x: (lm[LS]!.x - lm[RS]!.x) * aspect, y: lm[LS]!.y - lm[RS]!.y });
  const la = line(a);
  const lb = line(b);
  const wa = Math.hypot(la.x, la.y);
  const wb = Math.hypot(lb.x, lb.y);
  if (wa < 1e-4 || wb < 1e-4) return true;
  const ratio = wb / wa;
  if (ratio > MAX_WIDTH_CHANGE || ratio < 1 / MAX_WIDTH_CHANGE) return true;
  let tilt = Math.abs(Math.atan2(lb.y, lb.x) - Math.atan2(la.y, la.x));
  if (tilt > Math.PI) tilt = 2 * Math.PI - tilt;
  return tilt > MAX_TILT_CHANGE;
}

/** Affine transform taking triangle s onto triangle d, as canvas transform(a, b, c, d, e, f) arguments. */
function affine(s: Tri, d: Tri): [number, number, number, number, number, number] | null {
  const [s0, s1, s2] = s;
  const [d0, d1, d2] = d;
  const den = s0.x * (s1.y - s2.y) + s1.x * (s2.y - s0.y) + s2.x * (s0.y - s1.y);
  if (Math.abs(den) < 1e-6) return null;
  const solve = (u0: number, u1: number, u2: number) => [
    (u0 * (s1.y - s2.y) + u1 * (s2.y - s0.y) + u2 * (s0.y - s1.y)) / den,
    (u0 * (s2.x - s1.x) + u1 * (s0.x - s2.x) + u2 * (s1.x - s0.x)) / den,
    (u0 * (s1.x * s2.y - s2.x * s1.y) + u1 * (s2.x * s0.y - s0.x * s2.y) + u2 * (s0.x * s1.y - s1.x * s0.y)) / den,
  ];
  const [a, c, e] = solve(d0.x, d1.x, d2.x);
  const [b, dd, f] = solve(d0.y, d1.y, d2.y);
  return [a!, b!, c!, dd!, e!, f!];
}

/** Grows a triangle by `px` around its centre, so neighbouring triangles overlap and leave no seams. */
function inflate(t: Tri, px: number): Tri {
  const cx = (t[0].x + t[1].x + t[2].x) / 3;
  const cy = (t[0].y + t[1].y + t[2].y) / 3;
  return t.map((p) => {
    const dx = p.x - cx, dy = p.y - cy;
    const l = Math.hypot(dx, dy) || 1;
    return { x: p.x + (dx / l) * px, y: p.y + (dy / l) * px };
  }) as Tri;
}

const scale = (t: Tri, w: number, h: number): Tri => t.map((p) => ({ x: p.x * w, y: p.y * h })) as Tri;

/** Smooths live landmarks a little (One Euro: steady when still, no added lag when moving fast). */
export class PoseSmoother {
  private filters = new Map<number, PointFilter>();
  apply(lm: Landmark[], tMs: number): Landmark[] {
    return lm.map((p, i) => {
      let f = this.filters.get(i);
      if (!f) this.filters.set(i, (f = new PointFilter(2.0, 0.6)));
      const s = f.filter(p.x, p.y, tMs);
      return { ...p, x: s.x, y: s.y };
    });
  }
  reset(): void {
    this.filters.clear();
  }
}

const MAX_PREDICT_MS = 200; // never guess further ahead than this

/**
 * Carries the newest live pose forward to "now" at each joint's recent speed. Body tracking lags the camera
 * by ~0.1 s and updates only a few times a second on a weak laptop; this hides both.
 */
export class PosePredictor {
  private last: Landmark[] | null = null;
  private t = 0;
  private vel: Pt[] = [];

  push(lm: Landmark[], t: number): void {
    const prev = this.last;
    if (prev && t > this.t) {
      const dt = (t - this.t) / 1000;
      this.vel = lm.map((p, i) => {
        const o = prev[i]!;
        const v = this.vel[i] ?? { x: 0, y: 0 };
        return { x: v.x * 0.4 + ((p.x - o.x) / dt) * 0.6, y: v.y * 0.4 + ((p.y - o.y) / dt) * 0.6 };
      });
    } else {
      this.vel = lm.map(() => ({ x: 0, y: 0 }));
    }
    this.last = lm;
    this.t = t;
  }

  at(now: number): Landmark[] | null {
    const last = this.last;
    if (!last) return null;
    const h = Math.min(Math.max(now - this.t, 0), MAX_PREDICT_MS) / 1000;
    return last.map((p, i) => ({ ...p, x: p.x + (this.vel[i]?.x ?? 0) * h, y: p.y + (this.vel[i]?.y ?? 0) * h }));
  }

  reset(): void {
    this.last = null;
    this.vel = [];
  }
}

/** Draws the AI garment, bent from its own pose to the live pose, over the live camera already on `out`. */
export class Warper {
  private layer = document.createElement("canvas");
  private lctx = this.layer.getContext("2d")!;
  private mask = document.createElement("canvas");
  private mctx = this.mask.getContext("2d")!;

  /** Returns false when the pose can't be used; the caller then shows the AI picture as it is. */
  draw(
    out: CanvasRenderingContext2D,
    W: number,
    H: number,
    ai: CanvasImageSource & { width: number; height: number },
    aiPose: Landmark[],
    livePose: Landmark[],
    camera: (ctx: CanvasRenderingContext2D) => void,
  ): boolean {
    const flags = flagsFor(aiPose, livePose);
    if (!flags.torso || tooDifferent(aiPose, livePose, W / H)) return false;
    const aspect = W / H;
    const src = buildMesh(aiPose, flags, aspect);
    const dst = buildMesh(livePose, flags, aspect);

    if (this.layer.width !== W || this.layer.height !== H) {
      this.layer.width = W;
      this.layer.height = H;
    }
    // the mask is drawn small; scaling it up gives the soft edge for free (a blur filter costs too much per frame)
    const mw = Math.ceil(W / MASK_DOWN);
    const mh = Math.ceil(H / MASK_DOWN);
    if (this.mask.width !== mw || this.mask.height !== mh) {
      this.mask.width = mw;
      this.mask.height = mh;
    }
    const L = this.lctx;
    L.setTransform(1, 0, 0, 1, 0, 0);
    L.globalCompositeOperation = "source-over";
    L.clearRect(0, 0, W, H);
    const M = this.mctx;
    M.setTransform(1 / MASK_DOWN, 0, 0, 1 / MASK_DOWN, 0, 0);
    M.clearRect(0, 0, W, H);
    M.fillStyle = "#fff";

    for (let i = 0; i < src.length; i++) {
      const s = scale(src[i]!, ai.width, ai.height);
      const d = scale(dst[i]!, W, H);
      const m = affine(s, d);
      if (!m) continue;
      const di = inflate(d, 1);
      L.save();
      L.beginPath();
      L.moveTo(di[0].x, di[0].y);
      L.lineTo(di[1].x, di[1].y);
      L.lineTo(di[2].x, di[2].y);
      L.closePath();
      L.clip();
      L.transform(...m);
      L.drawImage(ai, 0, 0);
      L.restore();
      M.beginPath();
      M.moveTo(di[0].x, di[0].y);
      M.lineTo(di[1].x, di[1].y);
      M.lineTo(di[2].x, di[2].y);
      M.closePath();
      M.fill();
    }
    // soft edge where the garment meets the live camera
    L.globalCompositeOperation = "destination-in";
    L.imageSmoothingEnabled = true;
    L.drawImage(this.mask, 0, 0, W, H);
    L.globalCompositeOperation = "source-over";
    out.drawImage(this.layer, 0, 0);

    // live hands on top, so a hand in front of the jacket is never hidden or delayed
    for (const [wrist, index, pinky, armOk] of [
      [LW, 19, 17, flags.leftFore],
      [RW, 20, 18, flags.rightFore],
    ] as const) {
      if (!armOk || vis(livePose, wrist) < VIS) continue;
      const w = livePose[wrist]!, ix = livePose[index]!, pk = livePose[pinky]!;
      const cx = ((w.x + ix.x + pk.x) / 3) * W;
      const cy = ((w.y + ix.y + pk.y) / 3) * H;
      const r = Math.max(10, 1.6 * Math.hypot((ix.x - w.x) * W, (ix.y - w.y) * H));
      out.save();
      out.beginPath();
      out.arc(cx, cy, r, 0, Math.PI * 2);
      out.clip();
      camera(out);
      out.restore();
    }
    return true;
  }
}
