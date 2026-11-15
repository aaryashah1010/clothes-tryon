import type { Landmark } from "./pose";
import type { WorkerReply, WorkerRequest } from "./poseWorker";

type Which = "live" | "ai";
type Done = (landmarks: Landmark[] | null, ms: number) => void;

/** Main-thread side of poseWorker: one detection at a time per stream; callers skip frames while busy. */
export class PoseClient {
  delegate: "GPU" | "CPU" | "" = "";
  private worker = new Worker(new URL("./poseWorker.ts", import.meta.url), { type: "module" });
  private pending = new Map<number, Done>();
  private busyWhich = new Set<Which>();
  private nextId = 1;
  private lastT = 0;
  readonly ready: Promise<void>;

  constructor(streams: Which[], prefer: "GPU" | "CPU") {
    this.ready = new Promise((resolve, reject) => {
      this.worker.onmessage = (ev: MessageEvent<WorkerReply>) => {
        const m = ev.data;
        if (m.type === "ready") {
          this.delegate = m.delegate;
          resolve();
        } else if (m.type === "failed") {
          reject(new Error(`Body tracker failed to load: ${m.message}`));
        } else {
          this.busyWhich.delete(m.which);
          const done = this.pending.get(m.id);
          this.pending.delete(m.id);
          done?.(m.landmarks as Landmark[] | null, m.ms);
        }
      };
      this.worker.onerror = (e) => reject(new Error(`Body tracker worker error: ${e.message}`));
    });
    const base = new URL(import.meta.env.BASE_URL, location.href).href;
    this.post({ type: "init", base, streams, prefer });
  }

  close() {
    this.worker.terminate();
  }

  busy(which: Which): boolean {
    return this.busyWhich.has(which);
  }

  /** Hands the picture to the worker (it is closed there). Returns false, and closes it, if that stream is busy. */
  detect(which: Which, bmp: ImageBitmap, done: Done): boolean {
    if (this.busyWhich.has(which)) {
      bmp.close();
      return false;
    }
    this.busyWhich.add(which);
    const id = this.nextId++;
    this.pending.set(id, done);
    this.lastT = Math.max(performance.now(), this.lastT + 1); // video mode needs increasing timestamps
    this.post({ type: "detect", which, id, bmp, t: this.lastT }, [bmp]);
    return true;
  }

  private post(m: WorkerRequest, transfer: Transferable[] = []) {
    this.worker.postMessage(m, transfer);
  }
}
