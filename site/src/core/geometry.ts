// Picture geometry for the camera -> model -> screen path. Pure: sizes in, rectangles out.

export type Crop = { sx: number; sy: number; sw: number; sh: number };

/** A server whose own picture is tall (a "phone" server, e.g. 432x768): the whole frame is the person. */
export const isPortraitEngine = (outW: number, outH: number): boolean => outH > outW;

/** The part of the camera picture that is sent: centre crop at the model's aspect ratio. */
export function cameraCrop(vw: number, vh: number, outW: number, outH: number): Crop {
  const target = outW / outH;
  let sw = vw;
  let sh = Math.round(vw / target);
  if (sh > vh) {
    sh = vh;
    sw = Math.round(vh * target);
  }
  return { sx: (vw - sw) / 2, sy: (vh - sh) / 2, sw, sh };
}

/**
 * Phone held upright: the camera picture is tall but the model's is wide. Rather than cut a thin band out of the
 * middle, the whole picture is placed in the centre of the wide frame (blurred copy on the sides), and only that
 * centre part of the AI answer is shown. Returns that centre part in AI-picture pixels, or null for a wide camera
 * (or when the model's own picture is already tall: nothing to pad or cut).
 */
export function portraitRegion(vw: number, vh: number, outW: number, outH: number): { rx: number; rw: number } | null {
  if (isPortraitEngine(outW, outH)) return null;
  if (!vw || !vh || vh <= vw) return null;
  const rw = Math.round((outH * vw) / vh);
  return { rx: Math.round((outW - rw) / 2), rw };
}
