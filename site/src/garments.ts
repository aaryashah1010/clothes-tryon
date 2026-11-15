import manifest from "./garments.json";
import { removeBackdrop } from "./core/backdrop";
import { garmentBox, shrinkTo, type Rect } from "./core/crop";
import type { GarmentFields } from "./core/prepare";

export type Garment = {
  id: string;
  name: string;
  category: "tshirts" | "polos" | "shirts" | "formal" | "sweats" | "jackets" | "bottoms";
  gender: "men" | "women" | "any";
  /** Sleeve length, used to tell the model that long sleeves cover the arms. Absent for uploads. */
  sleeves?: "long" | "short" | "none";
  /** Bottoms only: how far down the legs the garment reaches. */
  length?: "full" | "midi" | "short";
  /**
   * What the person said about an uploaded garment (the catalog is told apart by name instead). When set, these win
   * over the name rules in core/garmentRules.ts.
   */
  hood?: boolean;
  pattern?: boolean;
  openFront?: boolean;
  colour: string;
  file: string;
  width: number;
  height: number;
  /** Shoulder line, as a fraction of the picture height. */
  shoulderY: number;
  /** Left and right shoulder tips, as fractions of the picture width. */
  shoulderLeft: number;
  shoulderRight: number;
  swatch: string;
  /**
   * Sleeve swing data, or null when the sleeve is not separate from the torso.
   * angle: direction (radians, canvas convention) from the shoulder joint to the cuff.
   * split: x of the torso side edge, as a fraction of the picture width.
   */
  sleeveL: { angle: number; split: number } | null;
  sleeveR: { angle: number; split: number } | null;
};

export const GARMENTS = manifest as Garment[];

export const CATEGORIES: { id: Garment["category"]; label: string }[] = [
  { id: "tshirts", label: "T-shirts" },
  { id: "polos", label: "Polos" },
  { id: "shirts", label: "Shirts" },
  { id: "formal", label: "Formal" },
  { id: "sweats", label: "Sweatshirts & hoodies" },
  { id: "jackets", label: "Jackets" },
  { id: "bottoms", label: "Bottoms (test)" },
];

export function garmentUrl(file: string): string {
  if (file.startsWith("blob:") || file.startsWith("data:")) return file; // a garment the user uploaded
  return `${import.meta.env.BASE_URL}${file}`;
}

const MAX_UPLOAD_BYTES = 15 * 1024 * 1024;
const UPLOAD_SIDE = 1024;

export class UploadError extends Error {}

/** Decode a picture the person chose, upright (phone photos carry their rotation in the file). */
export async function decodeUpload(file: Blob): Promise<ImageBitmap> {
  if (!file.type.startsWith("image/")) throw new UploadError("That file is not a picture. Choose a JPG or PNG photo.");
  if (file.size > MAX_UPLOAD_BYTES) throw new UploadError("That picture is too large (15 MB at most).");
  try {
    return await createImageBitmap(file, { imageOrientation: "from-image" });
  } catch {
    throw new UploadError("That picture could not be opened. Try a JPG or PNG.");
  }
}

/** The chosen part of a picture (source pixels), shrunk so its longer side is at most `maxSide`, as a JPEG. */
export async function cropToBlob(file: Blob, rect: Rect, maxSide: number): Promise<Blob> {
  const bmp = await decodeUpload(file);
  const { w, h } = shrinkTo(rect.w, rect.h, maxSide);
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  const x = c.getContext("2d")!;
  x.fillStyle = "#fff";
  x.fillRect(0, 0, w, h);
  x.drawImage(bmp, rect.x, rect.y, rect.w, rect.h, 0, 0, w, h);
  bmp.close();
  const blob = await new Promise<Blob | null>((r) => c.toBlob(r, "image/jpeg", 0.92));
  if (!blob) throw new UploadError("That picture could not be used. Try another one.");
  return blob;
}

/**
 * A garment from a photo the user picked (optionally only the part inside `crop`, in source pixels). The photo never
 * leaves the browser until it is sent as the live reference. It is shrunk, a plain background is painted white
 * (transparent PNGs too) and it is cropped to the clothing, so a photo with a lot of empty background still fills
 * the reference the model gets.
 */
export async function garmentFromFile(file: Blob, n: number, crop?: Rect): Promise<Garment> {
  const bmp = await decodeUpload(file);
  const src = crop ?? { x: 0, y: 0, w: bmp.width, h: bmp.height };
  const { w, h } = shrinkTo(src.w, src.h, UPLOAD_SIDE);
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  const x = c.getContext("2d", { willReadFrequently: true })!;
  x.fillStyle = "#fff";
  x.fillRect(0, 0, w, h);
  x.drawImage(bmp, src.x, src.y, src.w, src.h, 0, 0, w, h);
  bmp.close();
  // a plain background (shop photos: white, light grey, one flat colour) is painted white first
  const img = x.getImageData(0, 0, w, h);
  if (removeBackdrop(img.data, w, h).removed) x.putImageData(img, 0, 0);
  // crop to the clothing (only when it clearly helps)
  const box = garmentBox(img.data, w, h);
  const out = document.createElement("canvas");
  out.width = box.w;
  out.height = box.h;
  out.getContext("2d")!.drawImage(c, box.x, box.y, box.w, box.h, 0, 0, box.w, box.h);
  const blob = await new Promise<Blob | null>((r) => out.toBlob(r, "image/jpeg", 0.92));
  if (!blob) throw new UploadError("That picture could not be used. Try another one.");
  return {
    id: `custom-${n}`,
    name: "My clothing",
    category: "tshirts",
    gender: "any",
    colour: "",
    file: URL.createObjectURL(blob),
    width: box.w,
    height: box.h,
    shoulderY: 0.11,
    shoulderLeft: 0.18,
    shoulderRight: 0.82,
    swatch: "#888888",
    sleeveL: null,
    sleeveR: null,
  };
}

/**
 * The garment preparation service returned the garment alone, flat. Put it in place of the picture the person gave
 * (same garment, so the grid and the selection stay), and take over what the service says the garment is.
 */
export async function applyPrepared(g: Garment, flat: Blob, fields: GarmentFields): Promise<void> {
  const clean = await garmentFromFile(flat, 0); // paints the grey backdrop white and crops, like any upload
  const old = g.file;
  Object.assign(g, fields, { file: clean.file, width: clean.width, height: clean.height });
  if (old.startsWith("blob:")) URL.revokeObjectURL(old);
}

const cache = new Map<string, Promise<HTMLImageElement>>();

export function loadGarmentImage(g: Garment): Promise<HTMLImageElement> {
  let p = cache.get(g.id);
  if (!p) {
    p = new Promise((resolve, reject) => {
      const img = new Image();
      img.decoding = "async";
      img.onload = () => resolve(img);
      img.onerror = () => {
        cache.delete(g.id); // allow a retry later
        reject(new Error(`Could not load ${g.file}`));
      };
      img.src = garmentUrl(g.file);
    });
    cache.set(g.id, p);
  }
  return p;
}
