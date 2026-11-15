// The maths of the crop box on the upload screen. Pure: rectangles in, rectangles out (no page, no pictures).

export type Rect = { x: number; y: number; w: number; h: number };
export type Handle = "nw" | "ne" | "sw" | "se";

/** The smallest the box may get, in the same units as the rectangle (display pixels). */
export const MIN_BOX = 48;

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/** Keep a rectangle inside a W x H area and at least `min` wide and tall. */
export function clampRect(r: Rect, W: number, H: number, min = MIN_BOX): Rect {
  const m = Math.min(min, W, H);
  const w = clamp(r.w, m, W);
  const h = clamp(r.h, m, H);
  return { x: clamp(r.x, 0, W - w), y: clamp(r.y, 0, H - h), w, h };
}

/** Drag the whole box. It stops at the edges and keeps its size. */
export function moveRect(r: Rect, dx: number, dy: number, W: number, H: number): Rect {
  return { ...r, x: clamp(r.x + dx, 0, W - r.w), y: clamp(r.y + dy, 0, H - r.h) };
}

/** Drag one corner; the opposite corner stays where it is. */
export function resizeRect(r: Rect, handle: Handle, dx: number, dy: number, W: number, H: number, min = MIN_BOX): Rect {
  const m = Math.min(min, W, H);
  let left = r.x;
  let top = r.y;
  let right = r.x + r.w;
  let bottom = r.y + r.h;
  if (handle === "nw" || handle === "sw") left = clamp(left + dx, 0, right - m);
  if (handle === "ne" || handle === "se") right = clamp(right + dx, left + m, W);
  if (handle === "nw" || handle === "ne") top = clamp(top + dy, 0, bottom - m);
  if (handle === "sw" || handle === "se") bottom = clamp(bottom + dy, top + m, H);
  return { x: left, y: top, w: right - left, h: bottom - top };
}

/** A rectangle in display pixels -> the same part of the original picture, in whole source pixels. */
export function toSource(r: Rect, scale: number, srcW: number, srcH: number): Rect {
  const x = clamp(Math.round(r.x * scale), 0, srcW - 1);
  const y = clamp(Math.round(r.y * scale), 0, srcH - 1);
  const w = clamp(Math.round(r.w * scale), 1, srcW - x);
  const h = clamp(Math.round(r.h * scale), 1, srcH - y);
  return { x, y, w, h };
}

/** The size to draw a picture at so it fits a box without cropping, never larger than it is (scale <= 1 only shrinks). */
export function fitSize(srcW: number, srcH: number, maxW: number, maxH: number): { w: number; h: number; scale: number } {
  const k = Math.min(1, maxW / srcW, maxH / srcH);
  return { w: Math.max(1, Math.round(srcW * k)), h: Math.max(1, Math.round(srcH * k)), scale: 1 / k };
}

/** The size to shrink a picture to so its longer side is at most `maxSide` (never enlarges). */
export function shrinkTo(w: number, h: number, maxSide: number): { w: number; h: number } {
  const k = Math.min(1, maxSide / Math.max(w, h));
  return { w: Math.max(1, Math.round(w * k)), h: Math.max(1, Math.round(h * k)) };
}

/**
 * Where the clothing is, as a starting box: the bounding box of everything that is not (nearly) white, with a little
 * padding. Works on a picture whose plain background has already been painted white. Returns the whole picture when
 * nothing clear is found (a speck, or the clothing fills the frame).
 */
export function garmentBox(rgba: Uint8ClampedArray, w: number, h: number): Rect {
  let x0 = w, y0 = h, x1 = -1, y1 = -1;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      if (rgba[i]! < 242 || rgba[i + 1]! < 242 || rgba[i + 2]! < 242) {
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
        if (y < y0) y0 = y;
        if (y > y1) y1 = y;
      }
    }
  }
  const whole: Rect = { x: 0, y: 0, w, h };
  if (x1 < x0 || y1 < y0) return whole;
  if ((x1 - x0 + 1) * (y1 - y0 + 1) <= w * h * 0.04) return whole; // a speck, not clothing
  const pad = Math.round(Math.max(x1 - x0, y1 - y0) * 0.04);
  const x = Math.max(0, x0 - pad);
  const y = Math.max(0, y0 - pad);
  return { x, y, w: Math.min(w, x1 + pad + 1) - x, h: Math.min(h, y1 + pad + 1) - y };
}
