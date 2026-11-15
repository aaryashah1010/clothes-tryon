import { describe, expect, it } from "vitest";
import { clampRect, fitSize, garmentBox, moveRect, resizeRect, shrinkTo, toSource } from "./crop";

describe("crop box", () => {
  it("keeps a rectangle inside the area and above the minimum size", () => {
    expect(clampRect({ x: -10, y: 500, w: 30, h: 20 }, 200, 300)).toEqual({ x: 0, y: 252, w: 48, h: 48 });
    expect(clampRect({ x: 0, y: 0, w: 900, h: 900 }, 200, 300)).toEqual({ x: 0, y: 0, w: 200, h: 300 });
  });

  it("moves the whole box and stops at the edges", () => {
    const r = { x: 10, y: 10, w: 100, h: 80 };
    expect(moveRect(r, 20, -50, 300, 200)).toEqual({ x: 30, y: 0, w: 100, h: 80 });
    expect(moveRect(r, 999, 999, 300, 200)).toEqual({ x: 200, y: 120, w: 100, h: 80 });
  });

  it("resizes from a corner while the opposite corner stays put", () => {
    const r = { x: 50, y: 50, w: 100, h: 100 };
    expect(resizeRect(r, "se", 30, 20, 400, 400)).toEqual({ x: 50, y: 50, w: 130, h: 120 });
    expect(resizeRect(r, "nw", -20, -10, 400, 400)).toEqual({ x: 30, y: 40, w: 120, h: 110 });
  });

  it("never lets a corner cross the other or leave the area", () => {
    const r = { x: 50, y: 50, w: 100, h: 100 };
    const a = resizeRect(r, "se", -500, -500, 400, 400);
    expect(a.x).toBe(50);
    expect(a.w).toBe(48);
    expect(a.h).toBe(48);
    const b = resizeRect(r, "nw", -500, -500, 400, 400);
    expect(b).toEqual({ x: 0, y: 0, w: 150, h: 150 });
    const c = resizeRect(r, "ne", 999, 0, 400, 400);
    expect(c.x + c.w).toBe(400);
  });

  it("turns a display rectangle into source pixels, staying inside the picture", () => {
    expect(toSource({ x: 10, y: 20, w: 100, h: 50 }, 4, 1000, 800)).toEqual({ x: 40, y: 80, w: 400, h: 200 });
    const r = toSource({ x: 240, y: 190, w: 100, h: 100 }, 4, 1000, 800);
    expect(r.x + r.w).toBeLessThanOrEqual(1000);
    expect(r.y + r.h).toBeLessThanOrEqual(800);
    expect(r.w).toBeGreaterThanOrEqual(1);
  });

  it("fits a picture in a box without enlarging, and gives the scale back to source pixels", () => {
    expect(fitSize(2000, 1000, 500, 500)).toEqual({ w: 500, h: 250, scale: 4 });
    expect(fitSize(100, 80, 500, 500)).toEqual({ w: 100, h: 80, scale: 1 });
  });

  it("shrinks the longer side to a limit and never enlarges", () => {
    expect(shrinkTo(3000, 1500, 1024)).toEqual({ w: 1024, h: 512 });
    expect(shrinkTo(600, 400, 1024)).toEqual({ w: 600, h: 400 });
  });
});

describe("garmentBox", () => {
  const white = (w: number, h: number) => new Uint8ClampedArray(w * h * 4).fill(255);
  const dark = (d: Uint8ClampedArray, w: number, x0: number, y0: number, x1: number, y1: number) => {
    for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) d.set([20, 20, 20, 255], (y * w + x) * 4);
  };

  it("boxes the clothing with a little padding", () => {
    const w = 100, h = 100;
    const d = white(w, h);
    dark(d, w, 30, 20, 70, 80);
    const b = garmentBox(d, w, h);
    expect(b.x).toBeLessThan(30);
    expect(b.x + b.w).toBeGreaterThan(70);
    expect(b.y).toBeLessThan(20);
    expect(b.y + b.h).toBeGreaterThan(80);
    expect(b.x).toBeGreaterThanOrEqual(0);
    expect(b.x + b.w).toBeLessThanOrEqual(w);
  });

  it("returns the whole picture for a blank page or a speck", () => {
    const w = 100, h = 100;
    expect(garmentBox(white(w, h), w, h)).toEqual({ x: 0, y: 0, w, h });
    const d = white(w, h);
    dark(d, w, 50, 50, 54, 54);
    expect(garmentBox(d, w, h)).toEqual({ x: 0, y: 0, w, h });
  });
});
