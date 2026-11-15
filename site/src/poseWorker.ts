/// <reference lib="webworker" />
/**
 * Body tracking off the main thread, so a slow detection (~50-120 ms on a weak laptop) never holds up drawing
 * the view. The page runs one worker per stream (live camera, AI pictures), so the two run in parallel.
 */
import { FilesetResolver, PoseLandmarker } from "@mediapipe/tasks-vision";

type Which = "live" | "ai";
export type WorkerRequest =
  | { type: "init"; base: string; streams: Which[]; prefer: "GPU" | "CPU" }
  | { type: "detect"; which: Which; id: number; bmp: ImageBitmap; t: number };
export type WorkerReply =
  | { type: "ready"; delegate: "GPU" | "CPU" }
  | { type: "failed"; message: string }
  | { type: "result"; which: Which; id: number; landmarks: { x: number; y: number; z: number; visibility?: number }[] | null; ms: number };

const scope = self as unknown as DedicatedWorkerGlobalScope;
const models: Partial<Record<Which, PoseLandmarker>> = {};

async function init(base: string, streams: Which[], prefer: "GPU" | "CPU") {
  // the module build of MediaPipe's loader: module workers can't use importScripts
  const vision = await FilesetResolver.forVisionTasks(`${base}mediapipe/wasm`, true);
  // MediaPipe reads a global ModuleFactory and clears it after building a model. A module is evaluated only
  // once, so it would never come back for the second model: set it again from the module before each build.
  const loader = (await import(/* @vite-ignore */ vision.wasmLoaderPath)) as { default?: unknown };
  const g = scope as unknown as { ModuleFactory?: unknown };
  const make = (delegate: "GPU" | "CPU") => {
    g.ModuleFactory = loader.default;
    return PoseLandmarker.createFromOptions(vision, {
      baseOptions: { modelAssetPath: `${base}models/pose_landmarker_lite.task`, delegate },
      runningMode: "VIDEO",
      numPoses: 1,
      minPoseDetectionConfidence: 0.5,
      minPosePresenceConfidence: 0.5,
      minTrackingConfidence: 0.5,
    });
  };
  let delegate = prefer;
  try {
    for (const s of streams) models[s] = await make(prefer);
  } catch {
    if (prefer === "CPU") throw new Error("CPU body tracker failed to load");
    delegate = "CPU";
    for (const s of streams) models[s] = await make("CPU");
  }
  scope.postMessage({ type: "ready", delegate } satisfies WorkerReply);
}

scope.onmessage = (ev: MessageEvent<WorkerRequest>) => {
  const m = ev.data;
  if (m.type === "init") {
    init(m.base, m.streams, m.prefer).catch((err: unknown) =>
      scope.postMessage({ type: "failed", message: err instanceof Error ? err.message : String(err) } satisfies WorkerReply),
    );
    return;
  }
  const t0 = performance.now();
  let landmarks = null;
  try {
    landmarks = models[m.which]?.detectForVideo(m.bmp, m.t).landmarks[0] ?? null;
  } catch {
    landmarks = null;
  } finally {
    m.bmp.close();
  }
  scope.postMessage({ type: "result", which: m.which, id: m.id, landmarks, ms: performance.now() - t0 } satisfies WorkerReply);
};
