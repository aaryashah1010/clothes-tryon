// Takes a plain background off a product photo (the kind shops use: white, light grey, or one flat colour) and paints it
// white, so the model gets the garment alone. No model, no network: it looks at the picture's border, and floods inward
// from the border over pixels of the same colour.

/** How far a pixel may differ from the background colour (sum of the three channel differences) and still count as background. */
const TOLERANCE = 54;
/** The border must be this uniform to be called a plain background: the share of border pixels close to the median colour. */
const BORDER_UNIFORM = 0.8;
/** If more than this share of the picture would be removed, the "garment" has been eaten (white on white): do nothing. */
const MAX_REMOVED = 0.9;

export type BackdropResult = {
  /** The picture had a plain background and it was removed. */
  removed: boolean;
  /** Share of the picture turned white (0 to 1). */
  share: number;
};

const median = (v: number[]) => v.slice().sort((a, b) => a - b)[Math.floor(v.length / 2)]!;

/** Edits `rgba` in place (w x h pixels). */
export function removeBackdrop(rgba: Uint8ClampedArray, w: number, h: number): BackdropResult {
  const none: BackdropResult = { removed: false, share: 0 };
  if (w < 8 || h < 8) return none;
  const at = (x: number, y: number) => (y * w + x) * 4;

  // 1. the border pixels: every edge, one pixel in from the edge
  const border: number[] = [];
  for (let x = 0; x < w; x++) border.push(at(x, 0), at(x, h - 1));
  for (let y = 1; y < h - 1; y++) border.push(at(0, y), at(w - 1, y));
  const r0 = median(border.map((i) => rgba[i]!));
  const g0 = median(border.map((i) => rgba[i + 1]!));
  const b0 = median(border.map((i) => rgba[i + 2]!));
  const near = (i: number) =>
    Math.abs(rgba[i]! - r0) + Math.abs(rgba[i + 1]! - g0) + Math.abs(rgba[i + 2]! - b0) <= TOLERANCE;

  // 2. a plain background has an almost single-coloured border; a photo of a room or a person does not
  if (border.filter(near).length / border.length < BORDER_UNIFORM) return none;

  // 3. flood inward from the border pixels that match
  const seen = new Uint8Array(w * h);
  const stack: number[] = [];
  const push = (x: number, y: number) => {
    const p = y * w + x;
    if (seen[p] || !near(p * 4)) return;
    seen[p] = 1;
    stack.push(p);
  };
  for (let x = 0; x < w; x++) {
    push(x, 0);
    push(x, h - 1);
  }
  for (let y = 0; y < h; y++) {
    push(0, y);
    push(w - 1, y);
  }
  let count = 0;
  while (stack.length) {
    const p = stack.pop()!;
    count++;
    const x = p % w;
    const y = (p - x) / w;
    if (x > 0) push(x - 1, y);
    if (x < w - 1) push(x + 1, y);
    if (y > 0) push(x, y - 1);
    if (y < h - 1) push(x, y + 1);
  }
  const share = count / (w * h);
  if (share > MAX_REMOVED) return { removed: false, share };

  // 4. paint it white (the reference image is on a white square)
  for (let p = 0; p < seen.length; p++) {
    if (seen[p]) {
      const i = p * 4;
      rgba[i] = 255;
      rgba[i + 1] = 255;
      rgba[i + 2] = 255;
    }
  }
  return { removed: true, share };
}
