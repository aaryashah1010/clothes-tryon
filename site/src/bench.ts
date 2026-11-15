import { estimateLag, mean, percentile, smooth } from "./lagmath";

export type Phase = { name: string; label: string; sec: number };

export const GUIDED_PHASES: Phase[] = [
  { name: "still", label: "Stand still and look at the camera", sec: 10 },
  { name: "move", label: "Move side to side and lean forward and back", sec: 12 },
  { name: "hands", label: "Wave your hands in front of you", sec: 10 },
  { name: "garments", label: "Keep still: the garments switch by themselves", sec: 12 },
];

export type Sample = {
  t: number;
  phase: string;
  shown_fps: number;
  behind_ms: number;
  rtt_ms: number;
  buffered_bytes: number;
  client_sent: number;
  client_skipped: number;
  decode_ms: number;
  server: Record<string, unknown>;
};

type Ev = { t: number; type: string; detail?: unknown };

const round = (v: number, d = 1) => Math.round(v * 10 ** d) / 10 ** d;

/** One recording session: per-second samples, events, and the camera/AI motion signals used to measure real lag. */
export class BenchSession {
  readonly startedAt = performance.now();
  readonly startedIso = new Date().toISOString();
  readonly samples: Sample[] = [];
  readonly events: Ev[] = [];
  readonly frameT: number[] = [];
  readonly camMotion: number[] = [];
  readonly aiMotion: number[] = [];
  readonly framePhase: number[] = [];
  readonly resultT: number[] = [];
  readonly resultAge: number[] = [];
  phaseIdx = 0;
  note = "";

  constructor(
    readonly guided: boolean,
    readonly phases: Phase[],
    readonly meta: Record<string, unknown>,
  ) {
    this.event("start", { guided });
  }

  elapsed(): number {
    return (performance.now() - this.startedAt) / 1000;
  }

  phaseName(): string {
    return this.guided ? (this.phases[this.phaseIdx]?.name ?? "done") : "free";
  }

  event(type: string, detail?: unknown): void {
    this.events.push({ t: round(this.elapsed(), 2), type, detail });
  }

  addSample(s: Omit<Sample, "t" | "phase">): void {
    this.samples.push({ t: round(this.elapsed(), 2), phase: this.phaseName(), ...s });
  }

  addFrame(camMotion: number, aiMotion: number): void {
    this.frameT.push(Math.round((performance.now() - this.startedAt) * 10) / 10);
    this.camMotion.push(round(camMotion, 3));
    this.aiMotion.push(round(aiMotion, 3));
    this.framePhase.push(this.phaseIdx);
  }

  addResult(ageMs: number): void {
    this.resultT.push(Math.round((performance.now() - this.startedAt) * 10) / 10);
    this.resultAge.push(Math.round(ageMs));
  }

  /** Real lag: how far the AI picture's motion trails the camera's motion, from the recorded video frames. */
  private lagReport(): Record<string, unknown> {
    const n = this.frameT.length;
    if (n < 60) return { note: "too few frames recorded" };
    const spanMs = this.frameT[n - 1]! - this.frameT[0]!;
    const frameMs = spanMs / (n - 1);
    const pick = (names: string[]) => {
      const idx: number[] = [];
      for (let i = 0; i < n; i++) {
        const name = this.guided ? (this.phases[this.framePhase[i]!]?.name ?? "") : "free";
        if (names.includes(name)) idx.push(i);
      }
      return idx;
    };
    const region = this.guided ? pick(["move", "hands"]) : pick(["free"]);
    if (region.length < 60) return { note: "not enough moving frames to measure" };
    const a = smooth(region.map((i) => this.camMotion[i]!));
    const b = smooth(region.map((i) => this.aiMotion[i]!));
    const r = estimateLag(a, b, Math.min(90, Math.floor(region.length / 3)));
    if (!r) return { note: "could not estimate" };
    return {
      lag_ms: Math.round(r.lag * frameMs),
      lag_frames: r.lag,
      correlation: round(r.score, 2),
      correlation_at_zero_lag: round(r.atZero, 2),
      composite_frame_ms: round(frameMs, 1),
      frames_used: region.length,
      reliable: r.score >= 0.35,
    };
  }

  private phaseSummary(): Record<string, unknown> {
    const out: Record<string, unknown> = {};
    const names = [...new Set(this.samples.map((s) => s.phase))];
    for (const name of names) {
      const ss = this.samples.filter((s) => s.phase === name);
      const num = (f: (s: Sample) => number) => ss.map(f).filter((v) => Number.isFinite(v));
      const srv = (k: string) => num((s) => Number(s.server[k]));
      out[name] = {
        seconds: ss.length,
        shown_fps_avg: round(mean(num((s) => s.shown_fps))),
        shown_fps_min: round(Math.min(...num((s) => s.shown_fps))),
        behind_ms_median: Math.round(percentile(num((s) => s.behind_ms), 50)),
        behind_ms_p95: Math.round(percentile(num((s) => s.behind_ms), 95)),
        rtt_ms_median: Math.round(percentile(num((s) => s.rtt_ms), 50)),
        server_out_fps_avg: round(mean(srv("out_fps"))),
        server_base_fps_est_avg: round(mean(srv("base_fps_est"))),
        server_in_fps_avg: round(mean(srv("in_fps"))),
        server_feed_ms_avg: round(mean(srv("feed_ms"))),
        server_read_ms_avg: round(mean(srv("read_ms"))),
        server_gpu_util_avg: round(mean(srv("gpu_util"))),
        server_cpu_percent_avg: round(mean(srv("cpu_percent"))),
        client_skipped_total: ss.reduce((a, s) => a + s.client_skipped, 0),
      };
    }
    return out;
  }

  finish(extra: Record<string, unknown>): Record<string, unknown> {
    this.event("stop");
    return {
      schema: "fynd-livegpu-benchmark-1",
      started: this.startedIso,
      duration_s: round(this.elapsed(), 1),
      guided: this.guided,
      note: this.note,
      meta: this.meta,
      ...extra,
      summary_by_phase: this.phaseSummary(),
      measured_lag_from_video: this.lagReport(),
      events: this.events,
      samples: this.samples,
      results_timeline: { t_ms: this.resultT, age_ms: this.resultAge },
      composite_frames: { t_ms: this.frameT, cam_motion: this.camMotion, ai_motion: this.aiMotion, phase_index: this.framePhase },
    };
  }
}

/** Records one canvas to a video file with MediaRecorder. Tries several formats; reports why it could not. */
export class Recorder {
  private rec: MediaRecorder | null = null;
  private chunks: Blob[] = [];
  mime = "";
  ext = "";
  error = "";

  static candidates(): [string, string][] {
    const all: [string, string][] = [
      ["video/mp4;codecs=avc1", "mp4"],
      ["video/webm;codecs=vp8", "webm"],
      ["video/webm;codecs=vp9", "webm"],
      ["video/webm", "webm"],
    ];
    return typeof MediaRecorder === "undefined" ? [] : all.filter(([m]) => MediaRecorder.isTypeSupported(m));
  }

  /** Returns the file extension, or null (see `error`). */
  start(canvas: HTMLCanvasElement, fps: number): string | null {
    if (typeof MediaRecorder === "undefined") {
      this.error = "This browser has no MediaRecorder";
      return null;
    }
    const stream = canvas.captureStream(fps);
    for (const [mime, ext] of Recorder.candidates()) {
      try {
        const rec = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: 4_000_000 });
        this.chunks = [];
        rec.ondataavailable = (e) => {
          if (e.data.size) this.chunks.push(e.data);
        };
        rec.onerror = (e) => {
          this.error = `recorder error: ${String((e as ErrorEvent).error ?? e)}`;
        };
        rec.start(1000);
        this.rec = rec;
        this.mime = mime;
        this.ext = ext;
        return ext;
      } catch (err) {
        this.error = `${mime}: ${err instanceof Error ? err.message : String(err)}`;
      }
    }
    return null;
  }

  stop(): Promise<Blob | null> {
    const rec = this.rec;
    this.rec = null;
    const make = () => (this.chunks.length ? new Blob(this.chunks, { type: this.mime }) : null);
    if (!rec || rec.state === "inactive") return Promise.resolve(make());
    return new Promise((resolve) => {
      const timer = setTimeout(() => resolve(make()), 4000); // never hang
      rec.onstop = () => {
        clearTimeout(timer);
        resolve(make());
      };
      try {
        rec.stop();
      } catch {
        clearTimeout(timer);
        resolve(make());
      }
    });
  }
}

export function download(blob: Blob, name: string): void {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = name;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 4000);
}

export function stamp(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}
