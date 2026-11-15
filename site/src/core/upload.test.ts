import { describe, expect, it } from "vitest";
import type { Garment } from "../garments";
import { promptFor } from "./prompts";

const upload = (over: Partial<Garment>): Garment => ({
  id: "custom-1", name: "My clothing", category: "tshirts", gender: "any", colour: "", file: "blob:x",
  width: 10, height: 10, shoulderY: 0.1, shoulderLeft: 0.2, shoulderRight: 0.8, swatch: "#888", sleeveL: null, sleeveR: null,
  ...over,
});

describe("prompt for an uploaded garment follows what the person said", () => {
  it("adds nothing extra for a plain upload", () => {
    const p = promptFor(upload({}));
    expect(p).not.toMatch(/long sleeves|hoodie|pattern|open at the front/);
  });
  it("adds the sleeve, hood, pattern and open-front lines when chosen", () => {
    const p = promptFor(upload({ sleeves: "long", hood: true, pattern: true, openFront: true }));
    expect(p).toContain("long sleeves");
    expect(p).toContain("hoodie");
    expect(p).toContain("pattern");
    expect(p).toContain("open at the front");
  });
  it("uses the trouser prompt for bottoms, with the chosen length", () => {
    expect(promptFor(upload({ category: "bottoms", length: "full" }))).toContain("full-length");
    expect(promptFor(upload({ category: "bottoms", length: "midi" }))).toContain("below the knee");
    expect(promptFor(upload({ category: "bottoms", length: "short" }))).toContain("shorts");
    expect(promptFor(upload({ category: "bottoms", length: "short" }))).not.toContain("full-length");
  });
});
