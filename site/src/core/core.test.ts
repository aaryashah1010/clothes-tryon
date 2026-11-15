import { describe, expect, it } from "vitest";
import { GARMENTS, type Garment } from "../garments";
import { PROMPT_MAX_CHARS } from "./config";
import { presenceAt, presenceOf, pushPresence, type Presence } from "./guards";
import { hasHood, hasPattern, isOpenFront } from "./garmentRules";
import { outfitPromptFor, promptFor } from "./prompts";
import type { Landmark } from "../pose";

const byId = (id: string): Garment => {
  const g = GARMENTS.find((x) => x.id === id);
  if (!g) throw new Error(`no garment ${id}`);
  return g;
};

describe("prompts", () => {
  it("every garment's prompt fits the server's limit", () => {
    for (const g of GARMENTS) expect(promptFor(g).length, g.id).toBeLessThanOrEqual(PROMPT_MAX_CHARS);
  });

  it("every outfit prompt fits the server's limit", () => {
    const tops = GARMENTS.filter((g) => g.category !== "bottoms");
    const bottoms = GARMENTS.filter((g) => g.category === "bottoms");
    for (const t of tops) for (const b of bottoms) expect(outfitPromptFor(t, b).length, `${t.id}+${b.id}`).toBeLessThanOrEqual(PROMPT_MAX_CHARS);
  });

  it("hoodies, open fronts and patterns get their own line, plain tops do not", () => {
    expect(promptFor(byId("m-hoodie-city"))).toContain("the hood is always drawn");
    expect(promptFor(byId("m-blazer-navy"))).toContain("a shirt is always visible");
    expect(promptFor(byId("m-formal-check"))).toContain("same pattern");
    const plain = promptFor(byId("m-tee-white"));
    expect(plain).not.toContain("hood");
    expect(plain).not.toContain("pattern");
  });

  it("long-sleeve tops mention the wrists and bottoms never shorten to shorts", () => {
    expect(promptFor(byId("m-formal-white"))).toContain("long sleeves");
    const trousers = GARMENTS.find((g) => g.category === "bottoms" && g.length === "full");
    expect(promptFor(trousers!)).toContain("Never shorten");
  });
});

describe("garment rules", () => {
  it("find the hoodies, open fronts and patterns in the catalog", () => {
    expect(GARMENTS.some(hasHood)).toBe(true);
    expect(GARMENTS.some(isOpenFront)).toBe(true);
    expect(GARMENTS.some(hasPattern)).toBe(true);
    expect(isOpenFront(byId("m-hoodie-city"))).toBe(false);
  });
});

const lm = (shoulderL: number, shoulderR: number, vis = 0.9): Landmark[] => {
  const a = Array.from({ length: 33 }, () => ({ x: 0.5, y: 0.5, z: 0, visibility: 0 }));
  a[11] = { x: shoulderL, y: 0.3, z: 0, visibility: vis };
  a[12] = { x: shoulderR, y: 0.3, z: 0, visibility: vis };
  return a;
};

describe("presence", () => {
  it("nobody, too close and in view", () => {
    expect(presenceOf(null, 1).ok).toBe("none");
    expect(presenceOf(lm(0.4, 0.6, 0.1), 1).ok).toBe("none");
    expect(presenceOf(lm(0.1, 0.9), 1).ok).toBe("close");
    expect(presenceOf(lm(0.4, 0.6), 1).ok).toBe("ok");
  });

  it("one missed detection changes nothing, two in a row do", () => {
    const log: Presence[] = [];
    pushPresence(log, { t: 100, ok: "ok", legs: true });
    pushPresence(log, { t: 200, ok: "none", legs: false });
    expect(presenceAt(log, 210)?.ok).toBe("ok");
    pushPresence(log, { t: 300, ok: "none", legs: false });
    expect(presenceAt(log, 310)?.ok).toBe("none");
  });

  it("does not judge when the tracker has stalled or there is no history", () => {
    const log: Presence[] = [{ t: 100, ok: "none", legs: false }];
    expect(presenceAt(log, 5000)).toBeNull();
    expect(presenceAt([], 100)).toBeNull();
  });

  it("forgets old records", () => {
    const log: Presence[] = [];
    pushPresence(log, { t: 0, ok: "ok", legs: true });
    pushPresence(log, { t: 10000, ok: "ok", legs: true });
    expect(log.length).toBe(1);
  });
});
