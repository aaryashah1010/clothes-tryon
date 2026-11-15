import { removeBackdrop } from "../core/backdrop";
import { clampRect, fitSize, garmentBox, moveRect, resizeRect, shrinkTo, toSource, type Handle, type Rect } from "../core/crop";
import { decodeUpload } from "../garments";

/**
 * The crop box shown after an upload: the picture with a box already around the clothing, which the person can drag or
 * resize (mouse or finger), then confirm. Resolves with the chosen part in the picture's own pixels, or null on cancel.
 * All the maths is in core/crop.ts; this file only draws and listens.
 */
export async function pickCrop(file: Blob): Promise<Rect | null> {
  const bmp = await decodeUpload(file);

  // where the clothing is: look at a small copy, paint a plain background white, take the box around what is left
  const sm = shrinkTo(bmp.width, bmp.height, 256);
  const probe = document.createElement("canvas");
  probe.width = sm.w;
  probe.height = sm.h;
  const px = probe.getContext("2d", { willReadFrequently: true })!;
  px.fillStyle = "#fff";
  px.fillRect(0, 0, sm.w, sm.h);
  px.drawImage(bmp, 0, 0, sm.w, sm.h);
  const data = px.getImageData(0, 0, sm.w, sm.h);
  removeBackdrop(data.data, sm.w, sm.h);
  const guess = garmentBox(data.data, sm.w, sm.h);

  // the stage: the picture fitted to the screen
  const maxW = Math.min(window.innerWidth - 32, 560);
  const maxH = Math.max(220, Math.round(window.innerHeight * 0.55));
  const { w: W, h: H, scale } = fitSize(bmp.width, bmp.height, maxW, maxH);
  const k = W / sm.w;
  let rect = clampRect({ x: guess.x * k, y: guess.y * k, w: guess.w * k, h: guess.h * k }, W, H);

  const overlay = document.createElement("div");
  overlay.className = "crop-overlay";
  overlay.setAttribute("role", "dialog");
  overlay.setAttribute("aria-modal", "true");
  overlay.setAttribute("aria-label", "Choose the garment");
  overlay.innerHTML = `
    <div class="crop-dialog">
      <p class="crop-title">Select the garment</p>
      <p class="crop-hint">Drag the box over the garment you want to try. Leave out anything else (trousers, other items).</p>
      <div class="crop-stage"><canvas></canvas><div class="crop-box" aria-hidden="true"></div></div>
      <div class="crop-actions">
        <button type="button" class="btn btn-primary btn-small" data-act="use">Use this part</button>
        <button type="button" class="btn btn-ghost btn-small" data-act="whole">Use the whole picture</button>
        <button type="button" class="btn btn-ghost btn-small" data-act="cancel">Cancel</button>
      </div>
    </div>`;
  const stage = overlay.querySelector<HTMLDivElement>(".crop-stage")!;
  const canvas = overlay.querySelector<HTMLCanvasElement>("canvas")!;
  const box = overlay.querySelector<HTMLDivElement>(".crop-box")!;
  stage.style.width = `${W}px`;
  stage.style.height = `${H}px`;
  canvas.width = W;
  canvas.height = H;
  canvas.getContext("2d")!.drawImage(bmp, 0, 0, W, H);
  for (const hd of ["nw", "ne", "sw", "se"] as Handle[]) {
    const el = document.createElement("span");
    el.className = `crop-handle crop-handle-${hd}`;
    el.dataset.handle = hd;
    box.append(el);
  }

  const draw = () => {
    box.style.left = `${rect.x}px`;
    box.style.top = `${rect.y}px`;
    box.style.width = `${rect.w}px`;
    box.style.height = `${rect.h}px`;
  };
  draw();

  // dragging: remember where it started, apply the total movement to the rectangle it started from
  let drag: { mode: "move" | Handle; x: number; y: number; start: Rect } | null = null;
  box.addEventListener("pointerdown", (ev) => {
    const h = (ev.target as HTMLElement).dataset.handle as Handle | undefined;
    drag = { mode: h ?? "move", x: ev.clientX, y: ev.clientY, start: rect };
    box.setPointerCapture(ev.pointerId);
    ev.preventDefault();
  });
  box.addEventListener("pointermove", (ev) => {
    if (!drag) return;
    const dx = ev.clientX - drag.x;
    const dy = ev.clientY - drag.y;
    rect = drag.mode === "move" ? moveRect(drag.start, dx, dy, W, H) : resizeRect(drag.start, drag.mode, dx, dy, W, H);
    draw();
  });
  const endDrag = () => {
    drag = null;
  };
  box.addEventListener("pointerup", endDrag);
  box.addEventListener("pointercancel", endDrag);

  return new Promise<Rect | null>((resolve) => {
    const finish = (r: Rect | null) => {
      document.removeEventListener("keydown", onKey);
      overlay.remove();
      bmp.close();
      resolve(r);
    };
    const onKey = (ev: KeyboardEvent) => {
      if (ev.key === "Escape") finish(null);
    };
    document.addEventListener("keydown", onKey);
    overlay.addEventListener("click", (ev) => {
      const act = (ev.target as HTMLElement).closest<HTMLElement>("[data-act]")?.dataset.act;
      if (act === "use") finish(toSource(rect, scale, bmp.width, bmp.height));
      else if (act === "whole") finish({ x: 0, y: 0, w: bmp.width, h: bmp.height });
      else if (act === "cancel") finish(null);
    });
    document.body.append(overlay);
    overlay.querySelector<HTMLButtonElement>('[data-act="use"]')!.focus();
  });
}
