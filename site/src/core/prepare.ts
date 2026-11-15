import type { Garment } from "../garments";

// What the garment preparation service says about a picture, and how that becomes the page's garment fields.
// The same questions the chips ask by hand: top or bottoms, sleeves, length, hood, pattern, open front.

export type PreparedInfo = {
  wearable: boolean;
  kind: "top" | "bottom";
  name: string;
  sleeves: "short" | "long" | "none";
  length: "full" | "midi" | "short";
  hood: boolean;
  pattern: boolean;
  open_front: boolean;
};

export type GarmentFields = Pick<Garment, "name" | "category" | "sleeves" | "length" | "hood" | "pattern" | "openFront">;

const pick = <T extends string>(v: unknown, ok: readonly T[], fallback: T): T => (ok.includes(v as T) ? (v as T) : fallback);

/** Read the service's answer defensively: anything missing or odd becomes a safe default. Returns null if it is not an object. */
export function parseInfo(raw: unknown): PreparedInfo | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  return {
    wearable: o.wearable === true,
    kind: pick(o.kind, ["top", "bottom"], "top"),
    name: typeof o.name === "string" && o.name.trim() ? o.name.trim().slice(0, 40) : "My clothing",
    sleeves: pick(o.sleeves, ["short", "long", "none"], "short"),
    length: pick(o.length, ["full", "midi", "short"], "full"),
    hood: o.hood === true,
    pattern: o.pattern === true,
    open_front: o.open_front === true,
  };
}

/** The garment fields for an answer. Tops carry sleeves, hood, pattern, open front; bottoms carry a length. */
export function fieldsFromInfo(info: PreparedInfo): GarmentFields {
  if (info.kind === "bottom") {
    return { name: info.name, category: "bottoms", sleeves: undefined, length: info.length, hood: false, pattern: info.pattern, openFront: false };
  }
  return {
    name: info.name,
    category: "tshirts",
    sleeves: info.sleeves,
    length: undefined,
    hood: info.hood,
    pattern: info.pattern,
    openFront: info.open_front,
  };
}
