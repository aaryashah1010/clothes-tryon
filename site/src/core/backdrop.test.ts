import { describe, expect, it } from "vitest";
import { removeBackdrop } from "./backdrop";

function picture(w: number, h: number, bg: [number, number, number]) {
  const d = new Uint8ClampedArray(w * h * 4);
  for (let i = 0; i < w * h; i++) {
    d[i * 4] = bg[0];
    d[i * 4 + 1] = bg[1];
    d[i * 4 + 2] = bg[2];
    d[i * 4 + 3] = 255;
  }
  return d;
}
function paint(d: Uint8ClampedArray, w: number, x0: number, y0: number, x1: number, y1: number, c: [number, number, number]) {
  for (let y = y0; y < y1; y++)
    for (let x = x0; x < x1; x++) {
      const i = (y * w + x) * 4;
      d[i] = c[0];
      d[i + 1] = c[1];
      d[i + 2] = c[2];
    }
}
const px = (d: Uint8ClampedArray, w: number, x: number, y: number) => Array.from(d.slice((y * w + x) * 4, (y * w + x) * 4 + 3));

describe("removeBackdrop", () => {
  it("turns a light grey background white and keeps the garment", () => {
    const w = 40, h = 40;
    const d = picture(w, h, [236, 236, 238]);
    paint(d, w, 10, 10, 30, 30, [30, 60, 120]);
    const r = removeBackdrop(d, w, h);
    expect(r.removed).toBe(true);
    expect(px(d, w, 2, 2)).toEqual([255, 255, 255]);
    expect(px(d, w, 20, 20)).toEqual([30, 60, 120]);
  });

  it("works on a flat coloured background too", () => {
    const w = 40, h = 40;
    const d = picture(w, h, [120, 130, 125]);
    paint(d, w, 8, 8, 32, 32, [200, 40, 40]);
    expect(removeBackdrop(d, w, h).removed).toBe(true);
    expect(px(d, w, 0, 0)).toEqual([255, 255, 255]);
    expect(px(d, w, 20, 20)).toEqual([200, 40, 40]);
  });

  it("leaves a same-coloured patch enclosed by the garment alone", () => {
    const w = 40, h = 40;
    const d = picture(w, h, [255, 255, 255]);
    paint(d, w, 5, 5, 35, 35, [20, 20, 20]); // dark ring...
    paint(d, w, 15, 15, 25, 25, [255, 255, 255]); // ...with a white hole inside (not reachable from the border)
    const r = removeBackdrop(d, w, h);
    expect(r.removed).toBe(true);
    expect(px(d, w, 20, 20)).toEqual([255, 255, 255]);
    expect(px(d, w, 10, 10)).toEqual([20, 20, 20]);
  });

  it("does nothing when the border is not a plain colour (a photo of a room)", () => {
    const w = 40, h = 40;
    const d = picture(w, h, [255, 255, 255]);
    for (let x = 0; x < w; x++) paint(d, w, x, 0, x + 1, 1, [(x * 37) % 256, (x * 91) % 256, (x * 53) % 256]);
    for (let y = 0; y < h; y++) paint(d, w, 0, y, 1, y + 1, [(y * 71) % 256, (y * 29) % 256, (y * 113) % 256]);
    for (let y = 0; y < h; y++) paint(d, w, w - 1, y, w, y + 1, [(y * 17) % 256, (y * 211) % 256, (y * 7) % 256]);
    for (let x = 0; x < w; x++) paint(d, w, x, h - 1, x + 1, h, [(x * 3) % 256, (x * 151) % 256, (x * 83) % 256]);
    expect(removeBackdrop(d, w, h).removed).toBe(false);
  });

  it("does nothing when the picture is all one colour", () => {
    const w = 40, h = 40;
    const d = picture(w, h, [250, 250, 250]);
    expect(removeBackdrop(d, w, h).removed).toBe(false);
  });
});
