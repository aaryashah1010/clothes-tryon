import { garmentUrl, type Garment } from "../garments";

/**
 * The reference picture sent to the model. Always the same size: a reference of a new size makes the compiled model
 * rebuild, which froze the picture for a moment on every garment switch.
 */
export const GARMENT_REF = 512;

async function loadGarmentImage(g: Garment): Promise<HTMLImageElement> {
  const img = new Image();
  img.src = garmentUrl(g.file);
  await img.decode();
  return img;
}

function whiteSquare(): { c: HTMLCanvasElement; x: CanvasRenderingContext2D } {
  const c = document.createElement("canvas");
  c.width = GARMENT_REF;
  c.height = GARMENT_REF;
  const x = c.getContext("2d")!;
  x.fillStyle = "#fff";
  x.fillRect(0, 0, c.width, c.height);
  return { c, x };
}

/** One garment, centred on a white square, as a JPEG data URL. */
export async function garmentDataUrl(g: Garment): Promise<string> {
  const img = await loadGarmentImage(g);
  const { c, x } = whiteSquare();
  const k = (GARMENT_REF * 0.94) / Math.max(img.naturalWidth, img.naturalHeight);
  const w = img.naturalWidth * k;
  const h = img.naturalHeight * k;
  x.drawImage(img, (GARMENT_REF - w) / 2, (GARMENT_REF - h) / 2, w, h);
  return c.toDataURL("image/jpeg", 0.9);
}

/**
 * Outfit mode: the top above and the bottoms below in ONE reference image (the size stays 512 x 512 so the compiled
 * model is not rebuilt). Untested on people: prints get smaller because the two share the picture.
 */
export async function outfitDataUrl(top: Garment, bottom: Garment): Promise<string> {
  const [ti, bi] = await Promise.all([loadGarmentImage(top), loadGarmentImage(bottom)]);
  const { c, x } = whiteSquare();
  const fit = (img: HTMLImageElement, top0: number, boxH: number) => {
    const k = Math.min((GARMENT_REF * 0.94) / img.naturalWidth, boxH / img.naturalHeight);
    const w = img.naturalWidth * k;
    const h = img.naturalHeight * k;
    x.drawImage(img, (GARMENT_REF - w) / 2, top0 + (boxH - h) / 2, w, h);
  };
  fit(ti, GARMENT_REF * 0.01, GARMENT_REF * 0.47);
  fit(bi, GARMENT_REF * 0.5, GARMENT_REF * 0.49);
  return c.toDataURL("image/jpeg", 0.9);
}
