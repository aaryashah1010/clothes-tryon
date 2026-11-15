/// <reference lib="webworker" />
/**
 * Camera frame -> JPEG off the main thread. A canvas's toBlob only encodes when the page is idle, and with the
 * time-warp redrawing every screen refresh it never is: uploads fell to ~2 frames/s at ~1.1 s per encode.
 */
export type EncodeRequest = { id: number; bmp: ImageBitmap; quality: number };
export type EncodeReply = { id: number; buf: ArrayBuffer | null };

const scope = self as unknown as DedicatedWorkerGlobalScope;
let canvas: OffscreenCanvas | null = null;
let ctx: OffscreenCanvasRenderingContext2D | null = null;

scope.onmessage = async (ev: MessageEvent<EncodeRequest>) => {
  const { id, bmp, quality } = ev.data;
  let buf: ArrayBuffer | null = null;
  try {
    if (!canvas || canvas.width !== bmp.width || canvas.height !== bmp.height) {
      canvas = new OffscreenCanvas(bmp.width, bmp.height);
      ctx = canvas.getContext("2d");
    }
    ctx?.drawImage(bmp, 0, 0);
    const blob = await canvas.convertToBlob({ type: "image/jpeg", quality });
    buf = await blob.arrayBuffer();
  } catch {
    buf = null;
  } finally {
    bmp.close();
  }
  scope.postMessage({ id, buf } satisfies EncodeReply, buf ? [buf] : []);
};
