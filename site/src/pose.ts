import { FilesetResolver, PoseLandmarker } from "@mediapipe/tasks-vision";

export type Landmark = { x: number; y: number; z: number; visibility?: number };

export type RunMode = "VIDEO" | "IMAGE";

const base = import.meta.env.BASE_URL;

function isTouchDevice(): boolean {
  return window.matchMedia("(pointer: coarse)").matches;
}

let filesetPromise: ReturnType<typeof FilesetResolver.forVisionTasks> | null = null;
function fileset() {
  filesetPromise ??= FilesetResolver.forVisionTasks(`${base}mediapipe/wasm`);
  return filesetPromise;
}

export type TrackerInfo = { delegate: "GPU" | "CPU"; model: "lite" | "full" };

export class BodyTracker {
  info: TrackerInfo = { delegate: "GPU", model: "lite" };
  private constructor(private lm: PoseLandmarker) {}

  static async create(mode: RunMode, force?: TrackerInfo["model"]): Promise<BodyTracker> {
    const vision = await fileset();
    const model: TrackerInfo["model"] = force ?? (isTouchDevice() ? "lite" : "full");
    const modelPath = `${base}models/pose_landmarker_${model}.task`;
    const make = (delegate: "GPU" | "CPU") =>
      PoseLandmarker.createFromOptions(vision, {
        baseOptions: { modelAssetPath: modelPath, delegate },
        runningMode: mode,
        numPoses: 1,
        minPoseDetectionConfidence: 0.5,
        minPosePresenceConfidence: 0.5,
        minTrackingConfidence: 0.5,
      });
    let delegate: "GPU" | "CPU" = "GPU";
    let lm: PoseLandmarker;
    try {
      lm = await make("GPU");
    } catch {
      delegate = "CPU";
      lm = await make("CPU");
    }
    const t = new BodyTracker(lm);
    t.info = { delegate, model };
    return t;
  }

  /** Returns the 33 pose landmarks (normalized) or null. */
  detectVideo(video: HTMLVideoElement, tMs: number): Landmark[] | null {
    const res = this.lm.detectForVideo(video, tMs);
    return (res.landmarks[0] as Landmark[] | undefined) ?? null;
  }

  /** Like detectVideo, for any picture (canvas, ImageBitmap…). tMs must increase between calls. */
  detectSource(src: Parameters<PoseLandmarker["detectForVideo"]>[0], tMs: number): Landmark[] | null {
    const res = this.lm.detectForVideo(src, tMs);
    return (res.landmarks[0] as Landmark[] | undefined) ?? null;
  }

  /** Same as detectVideo, but also returns the 3D "world" landmarks (metres, origin at the hips). */
  detectVideoFull(
    video: HTMLVideoElement,
    tMs: number,
  ): { lms: Landmark[] | null; world: Landmark[] | null } {
    const res = this.lm.detectForVideo(video, tMs);
    return {
      lms: (res.landmarks[0] as Landmark[] | undefined) ?? null,
      world: (res.worldLandmarks[0] as Landmark[] | undefined) ?? null,
    };
  }

  detectImage(img: HTMLImageElement | HTMLCanvasElement): Landmark[] | null {
    const res = this.lm.detect(img);
    return (res.landmarks[0] as Landmark[] | undefined) ?? null;
  }

  close(): void {
    this.lm.close();
  }
}
