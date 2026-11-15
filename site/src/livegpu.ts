import "./style.css";
import { BenchSession, GUIDED_PHASES, Recorder, download, stamp } from "./bench";
import { CATEGORIES, GARMENTS, applyPrepared, cropToBlob, garmentFromFile, garmentUrl, UploadError, type Garment } from "./garments";
import { HOLD_MAX_MS, PREPARE_MAX_SIDE, PREPARE_URL, PRESENCE_EVERY_MS } from "./core/config";
import { fieldsFromInfo } from "./core/prepare";
import type { Rect } from "./core/crop";
import { pickCrop } from "./ui/cropper";
import { PrepareError, prepareGarment } from "./services/prepareApi";
import { bareWhereCovered, presenceAt, presenceOf, pushPresence, type Presence } from "./core/guards";
import { outfitPromptFor, promptFor } from "./core/prompts";
import { cameraCrop as cropFor, isPortraitEngine, portraitRegion as portraitRegionFor } from "./core/geometry";
import { ema, nextJpegQuality } from "./core/rateControl";
import { MAX_RECONNECTS, closeOutcome } from "./core/connection";
import { cameraPacket, encodeMessage, parseResultPacket, parseServerMessage, serverSocketUrl } from "./services/protocol";
import { garmentDataUrl, outfitDataUrl } from "./services/garmentImage";
import type { Landmark } from "./pose";
import { PoseClient } from "./poseClient";
import type { EncodeReply, EncodeRequest } from "./encodeWorker";
import { PosePredictor, PoseSmoother, Warper } from "./timewarp";

const $ = <T extends HTMLElement>(id: string): T => {
  const el = document.getElementById(id);
  if (!el) throw new Error(`Missing #${id}`);
  return el as T;
};
const show = (el: HTMLElement, on: boolean) => (el.hidden = !on);

const canvas = $<HTMLCanvasElement>("view");
const ctx = canvas.getContext("2d", { alpha: false })!;
const self = $<HTMLVideoElement>("self");
const ovStart = $("ov-start");
const ovLoading = $("ov-loading");
const ovError = $("ov-error");
const badge = $("badge");
const promptEl = $("prompt");
const tools = $("tools");
const stats = $("stats");
const grid = $("grid");
const srvUrl = $<HTMLInputElement>("srv-url");
const srvToken = $<HTMLInputElement>("srv-token");
const rSend = $<HTMLInputElement>("r-send");
const cMirror = $<HTMLInputElement>("c-mirror");
const cWarp = $<HTMLInputElement>("c-warp");
const btnGuided = $<HTMLButtonElement>("btn-guided");
const btnRecord = $<HTMLButtonElement>("btn-record");
const btnBad = $<HTMLButtonElement>("btn-mark-bad");
const btnGood = $<HTMLButtonElement>("btn-mark-good");
const benchNote = $<HTMLInputElement>("bench-note");
const benchStatus = $("bench-status");

const STORE = "fynd-studio-livegpu";
try {
  const saved = JSON.parse(localStorage.getItem(STORE) ?? "{}") as { url?: string; token?: string };
  srvUrl.value = saved.url ?? "";
  srvToken.value = saved.token ?? "";
} catch {
  /* nothing saved */
}

const MAX_INFLIGHT = 4; // camera frames sent but not yet acknowledged by the server
let jpegQuality = 0.75; // reset on every Start
let ackRttMs = 0;
let minAckMs = Infinity;
let reconnects = 0;
let userStopped = false;
const inflight = new Map<number, number>(); // client timestamp -> time sent
let garment: Garment = GARMENTS.find((g) => g.id === "jacket-puffer-grey") ?? GARMENTS[0]!;
let ws: WebSocket | null = null;
let stream: MediaStream | null = null;
let sendTimer = 0;
let pingTimer = 0;
let encoding = false;
let encodingSince = 0;
let encodeMs = 0;
const skips = { encoding: 0, inflight: 0, buffered: 0 };
let outW = 576;
let outH = 320;
const VIEW_W = 960; // the view shows the live camera, so it is drawn sharper than the AI picture

// time-warp state
const FAKE_DELAY_MS = 900; // test mode: pretend the GPU answers this late
const LIVE_TRACK_W = 384; // the live camera is tracked at this width (the model itself works at 256 px)
let liveTracker: PoseClient | null = null; // one worker per stream, so they run in parallel
let aiTracker: PoseClient | null = null;
let liveGrabbing = false;
let latestAi: { bmp: ImageBitmap; pose: Landmark[] | null } | null = null;
let aiPending: ImageBitmap | null = null; // newest AI picture, waiting for its pose
let serverPose = false; // the GPU server sends the body pose with each picture
let lastVideoTime = -1;
let renderId = 0;
let fakeMode = false;
let fakeTimer = 0;
const fakeQueue: { t: number; bmp: ImageBitmap }[] = [];
let warpedShare = 0; // share of recent frames drawn with the warp
// where the page's time goes (smoothed ms), to find what slows a weak laptop or phone
const cost = { liveTrack: 0, aiTrack: 0, draw: 0 };
let viewFrames = 0;
let viewT = performance.now();
let viewFps = 0;
const smoother = new PoseSmoother();
const predictor = new PosePredictor();
const warper = new Warper();

// rolling measurements
let recvCount = 0;
let recvT = performance.now();
let recvFps = 0;
let ageMs = 0;
let rttMs = 0;
let decodeMs = 0;
let resultTotal = 0;
let clientSent = 0;
let clientSkipped = 0;
let serverStats: Record<string, unknown> = {};
let serverInfo: Record<string, unknown> = {};

// camera frames are JPEG-encoded in a worker: a canvas's toBlob waits for idle time the time-warp never leaves
const encoder = new Worker(new URL("./encodeWorker.ts", import.meta.url), { type: "module" });
const encodeTs = new Map<number, number>(); // encode id -> camera frame timestamp
let encodeId = 0;
encoder.onmessage = (ev: MessageEvent<EncodeReply>) => {
  const { id, buf } = ev.data;
  const ts = encodeTs.get(id);
  encodeTs.delete(id);
  encoding = false;
  if (ts === undefined) return;
  encodeMs = ema(encodeMs, performance.now() - ts);
  if (!buf || ws?.readyState !== WebSocket.OPEN) return;
  inflight.set(ts, performance.now());
  ws.send(cameraPacket(ts, buf));
  clientSent++;
};

function wsUrl(): string {
  return serverSocketUrl(srvUrl.value, srvToken.value);
}

const sentPrompt = new WeakMap<WebSocket, string>();

// ---------- outfit mode: a top and bottoms at the same time ----------
// Both pictures go into ONE reference image (top above, bottoms below; the size stays 512 x 512 so the compiled
// model is not rebuilt) with one instruction. Untested on people: prints get smaller because the two share the picture.
let outfitMode = false;
let outfitTop: Garment | null = null;
let outfitBottom: Garment | null = null;

// Prompt tester (test tools, ?bench=1): a typed sentence replaces the page's own for every garment until cleared.
let promptOverride = "";
const promptTest = document.getElementById("prompt-test") as HTMLTextAreaElement | null;
const promptState = document.getElementById("prompt-state");
function currentAutoPrompt(): string {
  const both = outfitMode && outfitTop && outfitBottom;
  return both ? outfitPromptFor(outfitTop!, outfitBottom!) : promptFor(garment);
}
function setPromptState(t: string) {
  if (promptState) promptState.textContent = t;
}
document.getElementById("btn-prompt-fill")?.addEventListener("click", () => {
  if (promptTest) promptTest.value = currentAutoPrompt();
  setPromptState(`Filled with the current prompt (${currentAutoPrompt().length} characters).`);
});
document.getElementById("btn-prompt-send")?.addEventListener("click", () => {
  promptOverride = (promptTest?.value ?? "").trim().slice(0, 600);
  void sendGarment();
  setPromptState(promptOverride ? `Sending your prompt (${promptOverride.length} of 600 characters) for every garment.` : "Empty: using the page's own prompt.");
});
document.getElementById("btn-prompt-reset")?.addEventListener("click", () => {
  promptOverride = "";
  if (promptTest) promptTest.value = "";
  void sendGarment();
  setPromptState("Back to the page's own prompt.");
});

async function sendGarment() {
  if (ws?.readyState !== WebSocket.OPEN) return;
  const both = outfitMode && outfitTop && outfitBottom;
  const text = promptOverride || (both ? outfitPromptFor(outfitTop!, outfitBottom!) : promptFor(garment));
  if (sentPrompt.get(ws) !== text) {
    // only when it changed: I don't know whether the server hitches on a new instruction
    sentPrompt.set(ws, text);
    ws.send(encodeMessage({ type: "prompt", text }));
  }
  const image = both ? await outfitDataUrl(outfitTop!, outfitBottom!) : await garmentDataUrl(garment);
  ws.send(encodeMessage({ type: "garment", image }));
}

const garmentListeners: ((g: Garment) => void)[] = [];

/** The garment picked in the grid (shared with the photo try-on on the share page). */
export function currentGarment(): Garment {
  return garment;
}

export function onGarmentChange(fn: (g: Garment) => void): void {
  garmentListeners.push(fn);
}

function selectGarment(g: Garment) {
  garment = g;
  if (outfitMode) {
    if (g.category === "bottoms") outfitBottom = g;
    else outfitTop = g;
    guideOutfit();
  }
  updateOutfitNote();
  session?.event("garment", g.id);
  renderGrid();
  void sendGarment();
  garmentListeners.forEach((fn) => fn(g));
}

type GenderFilter = "men" | "women";
const FILTER_KEY = "fynd-studio-filter";
let genderFilter: GenderFilter = "men";
let categoryFilter: Garment["category"] | "all" = "all";
try {
  const f = JSON.parse(localStorage.getItem(FILTER_KEY) ?? "{}") as { gender?: GenderFilter; category?: typeof categoryFilter };
  if (f.gender === "men" || f.gender === "women") genderFilter = f.gender;
  if (f.category && CATEGORIES.some((c) => (c.id as string) === f.category)) categoryFilter = f.category;
} catch {
  /* nothing saved */
}

function setFilter(g: GenderFilter, c: typeof categoryFilter) {
  // a category that the other section doesn't have falls back to "All"
  if (c !== "all" && !GARMENTS.some((x) => x.gender === g && x.category === c)) c = "all";
  genderFilter = g;
  categoryFilter = c;
  try {
    localStorage.setItem(FILTER_KEY, JSON.stringify({ gender: g, category: c }));
  } catch {
    /* private mode */
  }
  renderGrid();
}

function chip(label: string, active: boolean, onClick: () => void): HTMLButtonElement {
  const b = document.createElement("button");
  b.type = "button";
  b.className = "chip" + (active ? " is-active" : "");
  b.textContent = label;
  b.addEventListener("click", onClick);
  return b;
}

/** Men and Women as two sections; inside the chosen one, only the categories it has. */
function renderFilters() {
  const box = document.getElementById("garment-filters");
  if (!box) return;
  const genders = document.createElement("div");
  genders.className = "chips gender-tabs";
  (["men", "women"] as const).forEach((id) => {
    const n = GARMENTS.filter((g) => g.gender === id).length;
    genders.append(chip(`${id === "men" ? "Men" : "Women"} (${n})`, genderFilter === id, () => setFilter(id, categoryFilter)));
  });
  const cats = document.createElement("div");
  cats.className = "chips chips-wrap";
  const inSection = GARMENTS.filter((g) => g.gender === genderFilter);
  cats.append(chip(`All (${inSection.length})`, categoryFilter === "all", () => setFilter(genderFilter, "all")));
  CATEGORIES.forEach((c) => {
    const n = inSection.filter((g) => g.category === c.id).length;
    if (n) cats.append(chip(`${c.label} (${n})`, categoryFilter === c.id, () => setFilter(genderFilter, c.id)));
  });
  box.replaceChildren(genders, cats);
}

const cOutfit = document.getElementById("c-outfit") as HTMLInputElement | null;
const outfitNote = document.getElementById("outfit-note");

function updateOutfitNote() {
  if (!outfitNote) return;
  if (!outfitMode) {
    outfitNote.textContent = "";
    return;
  }
  outfitNote.textContent =
    outfitTop && outfitBottom
      ? `Outfit: ${outfitTop.name} + ${outfitBottom.name}`
      : `Outfit mode: pick a top${outfitTop ? "" : " (not chosen)"} and bottoms${outfitBottom ? "" : " (not chosen)"}. Stand back so your legs are in view.`;
}

/** Outfit mode: after one half is picked, the grid shows the garments for the other half. */
function guideOutfit() {
  if (outfitTop && !outfitBottom) setFilter(genderFilter, "bottoms");
  else if (outfitBottom && !outfitTop) setFilter(genderFilter, "all");
}

cOutfit?.addEventListener("change", () => {
  outfitMode = cOutfit.checked;
  if (outfitMode) {
    // start from what is selected now
    if (garment.category === "bottoms") outfitBottom = garment;
    else outfitTop = garment;
    guideOutfit();
  }
  updateOutfitNote();
  renderGrid();
  void sendGarment();
});

const MAX_CUSTOM = 6; // uploaded garments kept in the grid (older ones are dropped)
const custom: Garment[] = [];
const preparing = new Set<string>();
let customCount = 0;
let uploadMsg = "";

function renderGrid() {
  const card = (g: Garment) => {
    const b = document.createElement("button");
    const picked = outfitMode ? g.id === outfitTop?.id || g.id === outfitBottom?.id : g.id === garment.id;
    const isPreparing = preparing.has(g.id);
    b.className = "gcard" + (picked ? " is-selected" : "");
    b.setAttribute("role", "option");
    b.setAttribute("aria-selected", String(picked));
    b.setAttribute("aria-busy", String(isPreparing));
    b.innerHTML = `<span class="gthumb"><img alt="" loading="lazy" src="${garmentUrl(g.file)}">${isPreparing ? '<span class="gprep-overlay"><span class="gprep-spinner" aria-hidden="true"></span><span>Preparing…</span></span>' : ""}</span><span class="gname"></span>`;
    (b.querySelector(".gname") as HTMLElement).textContent = g.name;
    b.addEventListener("click", () => selectGarment(g));
    return b;
  };
  const up = document.createElement("button");
  up.className = "gcard gupload";
  up.type = "button";
  up.innerHTML = `<span class="gthumb"><span class="gplus" aria-hidden="true">+</span></span><span class="gname">Upload your own</span>`;
  up.addEventListener("click", () => uploadInput.click());
  const shown = GARMENTS.filter(
    (g) => g.gender === genderFilter && (categoryFilter === "all" || g.category === categoryFilter),
  );
  grid.replaceChildren(up, ...custom.map(card), ...shown.map(card));
  renderFilters();
  renderDescribe();
  const note = document.getElementById("upload-note");
  if (note) {
    note.textContent =
      uploadMsg || (shown.length ? "Tip: a front view of one garment on a plain background works best." : "Nothing here yet. Try another category.");
  }
}

/**
 * After an upload: a few questions about the garment, because the page cannot read them off a photo. The answers go
 * into the same prompt lines the catalog garments get (sleeves, hood, open front, pattern, trouser length).
 */
function renderDescribe() {
  const box = document.getElementById("upload-describe");
  if (!box) return;
  const g = garment;
  if (!g.id.startsWith("custom-")) {
    box.hidden = true;
    return;
  }
  const change = (fn: () => void) => () => {
    fn();
    if (outfitTop === g && g.category === "bottoms") outfitTop = null;
    if (outfitBottom === g && g.category !== "bottoms") outfitBottom = null;
    selectGarment(g);
  };
  const row = (label: string, ...chips: HTMLElement[]) => {
    const r = document.createElement("div");
    r.className = "describe-row";
    const l = document.createElement("span");
    l.className = "describe-label";
    l.textContent = label;
    const c = document.createElement("div");
    c.className = "chips";
    c.append(...chips);
    r.append(l, c);
    return r;
  };
  const isBottom = g.category === "bottoms";
  const rows = [
    row(
      "This is a",
      chip("Top", !isBottom, change(() => { g.category = "tshirts"; })),
      chip("Trousers / skirt", isBottom, change(() => { g.category = "bottoms"; g.length = g.length ?? "full"; })),
    ),
  ];
  if (isBottom) {
    rows.push(
      row(
        "Length",
        chip("Full (to ankle)", g.length !== "midi", change(() => { g.length = "full"; })),
        chip("Below the knee", g.length === "midi", change(() => { g.length = "midi"; })),
        chip("Shorts", g.length === "short", change(() => { g.length = "short"; })),
      ),
    );
  } else {
    rows.push(
      row(
        "Sleeves",
        chip("Short", g.sleeves !== "long", change(() => { g.sleeves = "short"; })),
        chip("Long", g.sleeves === "long", change(() => { g.sleeves = "long"; })),
      ),
      row(
        "It has",
        chip("A hood", !!g.hood, change(() => { g.hood = !g.hood; })),
        chip("A check / stripe", !!g.pattern, change(() => { g.pattern = !g.pattern; })),
        chip("An open front", !!g.openFront, change(() => { g.openFront = !g.openFront; })),
      ),
    );
  }
  const title = document.createElement("p");
  title.className = "describe-title";
  title.textContent = "Tell us about your garment so it fits properly";
  box.replaceChildren(title, ...rows);
  box.hidden = false;
}

/** The garment preparation service's address: the page's setting, or ?prep=<address> to try one without rebuilding. */
const PREP_FROM_LINK = new URLSearchParams(location.search).get("prep") ?? ""; // read now: share.ts cleans the address bar later
const PREP_TOKEN_FROM_LINK = new URLSearchParams(location.hash.replace(/^#/, "")).get("prepToken") ?? "";
function prepareUrl(): string {
  return PREP_FROM_LINK || PREPARE_URL;
}

async function addUpload(f: File | Blob | undefined) {
  if (!f) return;
  try {
    const crop = await pickCrop(f); // the person confirms which part is the garment
    if (!crop) return; // cancelled
    const g = await garmentFromFile(f, ++customCount, crop);
    custom.unshift(g);
    while (custom.length > MAX_CUSTOM) URL.revokeObjectURL(custom.pop()!.file);
    if (prepareUrl()) preparing.add(g.id);
    uploadMsg = prepareUrl() ? "Getting your garment ready. You can use this preview while it loads." : "";
    selectGarment(g); // the cleaned-up photo is usable at once
    void prepareInBackground(g, f, crop);
  } catch (err) {
    uploadMsg = err instanceof UploadError ? err.message : "That picture could not be used. Try another one.";
    renderGrid();
  }
}

/**
 * Send the chosen part of the photo to the garment preparation service (garment only, never camera frames). When it
 * answers, the flat garment replaces the photo and the chips are filled in; if it fails, the person keeps the photo.
 */
async function prepareInBackground(g: Garment, f: Blob, crop: Rect) {
  const url = prepareUrl();
  if (!url) return;
  try {
    const part = await cropToBlob(f, crop, PREPARE_MAX_SIDE);
    const r = await prepareGarment(part, { url, token: PREP_TOKEN_FROM_LINK || srvToken.value });
    if (!custom.includes(g)) return; // pushed out of the grid meanwhile
    await applyPrepared(g, r.image, fieldsFromInfo(r.info));
    uploadMsg = `Ready: ${g.name}. Check the answers below.`;
  } catch (err) {
    uploadMsg = `${err instanceof PrepareError || err instanceof UploadError ? err.message : "Could not prepare the garment."} Using your picture as it is.`;
  } finally {
    preparing.delete(g.id);
  }
  if (garment === g) selectGarment(g); // new picture and prompt to the GPU
  else renderGrid();
}

// Paste (Ctrl+V / long-press paste) and drag-and-drop work too: a copied product image goes straight in.
document.addEventListener("paste", (ev) => {
  const item = Array.from(ev.clipboardData?.items ?? []).find((i) => i.type.startsWith("image/"));
  const f = item?.getAsFile();
  if (f) {
    ev.preventDefault();
    void addUpload(f);
  }
});
document.addEventListener("dragover", (ev) => {
  if (ev.dataTransfer?.types.includes("Files")) ev.preventDefault();
});
document.addEventListener("drop", (ev) => {
  const f = Array.from(ev.dataTransfer?.files ?? []).find((x) => x.type.startsWith("image/"));
  if (f) {
    ev.preventDefault();
    void addUpload(f);
  }
});

const uploadInput = document.createElement("input");
uploadInput.type = "file";
uploadInput.accept = "image/*";
uploadInput.hidden = true;
document.body.append(uploadInput);
uploadInput.addEventListener("change", async () => {
  const f = uploadInput.files?.[0];
  uploadInput.value = "";
  await addUpload(f);
});

// Chrome extension bridge: the extension opens this page and dispatches a selected product image as a data URL.
// The normal crop confirmation and garment-only preparation flow still apply.
window.addEventListener("fynd-extension-garment", (event) => {
  const dataUrl = (event as CustomEvent<unknown>).detail;
  if (typeof dataUrl !== "string" || !dataUrl.startsWith("data:image/")) return;
  void (async () => {
    try {
      const response = await fetch(dataUrl);
      const blob = await response.blob();
      await addUpload(new File([blob], "product-image", { type: blob.type || "image/jpeg" }));
    } catch {
      uploadMsg = "The extension image could not be opened. Try saving and uploading it instead.";
      renderGrid();
    }
  })();
});

/** The part of the camera picture that is sent (and shown on the left of the recording): centre crop at the model's aspect ratio. */
function cameraCrop(): { sx: number; sy: number; sw: number; sh: number } {
  return cropFor(self.videoWidth, self.videoHeight, outW, outH);
}

/**
 * Phone held upright: the camera picture is tall but the model's is wide. Rather than cut a thin band out of the
 * middle, the whole picture is placed in the centre of the wide frame (blurred copy on the sides), and only that
 * centre part of the AI answer is shown. Returns that centre part in AI-picture pixels, or null for a wide camera.
 */
function portraitRegion(): { rx: number; rw: number } | null {
  return portraitRegionFor(self.videoWidth, self.videoHeight, outW, outH);
}

/** A server whose own picture is tall (a "phone" server, e.g. 432x768): the whole frame is the person. */
function portraitEngine(): boolean {
  return isPortraitEngine(outW, outH);
}

/** Tall view: a phone held upright, or a server that draws tall pictures. */
function portraitView(): boolean {
  return portraitEngine() || portraitRegion() !== null;
}

/**
 * Mirror view. The camera picture is flipped BEFORE it is sent, so the AI draws the garment the right way round
 * (text and logos read correctly) and its answer is shown as it comes. Flipping the finished picture instead, as a
 * mirror does, reverses every print. (With time-warp on, the old way is kept: camera and answer are flipped on show.)
 */
function flipInput(): boolean {
  return cMirror.checked && !cWarp.checked;
}

let portraitShown = false;
const padCanvas = document.createElement("canvas");
const padCtx = padCanvas.getContext("2d")!;
const flipCanvas = document.createElement("canvas");
const flipCtx = flipCanvas.getContext("2d")!;

/** Keeps the view's shape in step with the camera's (phones can be turned mid-session). */
function syncOrientation() {
  const p = portraitView();
  if (p === portraitShown) return;
  portraitShown = p;
  sizeView();
  $("live-stage").classList.toggle("is-portrait", p);
}

/** The frame to send for an upright phone: whole camera picture, centred, with a blurred fill on the sides. */
async function portraitFrame(r: { rx: number; rw: number }, flip: boolean): Promise<ImageBitmap> {
  if (padCanvas.width !== outW || padCanvas.height !== outH) {
    padCanvas.width = outW;
    padCanvas.height = outH;
  }
  const { sx, sy, sw, sh } = cameraCrop();
  padCtx.save();
  if (flip) {
    padCtx.translate(outW, 0);
    padCtx.scale(-1, 1);
  }
  padCtx.filter = "blur(14px)";
  padCtx.drawImage(self, sx, sy, sw, sh, -20, -20, outW + 40, outH + 40);
  padCtx.filter = "none";
  padCtx.drawImage(self, r.rx, 0, r.rw, outH);
  padCtx.restore();
  return createImageBitmap(padCanvas);
}

/** The camera crop, flipped left-right, at the model's size. */
function flippedFrame(sx: number, sy: number, sw: number, sh: number): Promise<ImageBitmap> {
  if (flipCanvas.width !== outW || flipCanvas.height !== outH) {
    flipCanvas.width = outW;
    flipCanvas.height = outH;
  }
  flipCtx.save();
  flipCtx.translate(outW, 0);
  flipCtx.scale(-1, 1);
  flipCtx.drawImage(self, sx, sy, sw, sh, 0, 0, outW, outH);
  flipCtx.restore();
  return createImageBitmap(flipCanvas);
}

/** Camera frame -> JPEG at the model's aspect ratio. Skips a tick if the last frame is still encoding or the socket is backed up. */
function sendFrame() {
  if (!ws || ws.readyState !== WebSocket.OPEN || !stream) return;
  const nowMs = performance.now();
  for (const [k, t] of inflight) if (nowMs - t > 4000) inflight.delete(k); // an ack that never came
  if (encoding && nowMs - encodingSince > 1000) encoding = false; // an encode that never called back
  if (encoding || inflight.size >= MAX_INFLIGHT || ws.bufferedAmount > 60_000 || self.readyState < 2) {
    clientSkipped++; // never queue: latest frame wins
    if (encoding) skips.encoding++;
    else if (inflight.size >= MAX_INFLIGHT) skips.inflight++;
    else skips.buffered++;
    return;
  }
  const { sx, sy, sw, sh } = cameraCrop();
  encoding = true;
  encodingSince = nowMs;
  const ts = performance.now();
  const id = ++encodeId;
  encodeTs.clear(); // only the newest encode matters
  encodeTs.set(id, ts);
  syncOrientation();
  const region = portraitRegion();
  const flip = flipInput();
  (region
    ? portraitFrame(region, flip)
    : flip
      ? flippedFrame(sx, sy, sw, sh)
      : createImageBitmap(self, sx, sy, sw, sh, { resizeWidth: outW, resizeHeight: outH })
  )
    .then((bmp) => encoder.postMessage({ id, bmp, quality: jpegQuality } satisfies EncodeRequest, [bmp]))
    .catch(() => {
      encoding = false;
    });
}

async function drawResult(data: ArrayBuffer) {
  const t0 = performance.now();
  const { ts, pose, jpeg } = parseResultPacket(data, serverPose);
  const bmp = await createImageBitmap(new Blob([jpeg], { type: "image/jpeg" }));
  if (passesGuards(ts, bmp, pose)) onAiFrame(bmp, pose);
  else bmp.close();
  const now = performance.now();
  decodeMs = decodeMs * 0.8 + (now - t0) * 0.2;
  if (ts > 0) ageMs = ageMs * 0.8 + (now - ts) * 0.2;
  resultTotal++;
  recvCount++;
  session?.addResult(ageMs);
  if (now - recvT >= 1000) {
    recvFps = (recvCount * 1000) / (now - recvT);
    recvCount = 0;
    recvT = now;
    renderStats();
  }
}

/** The previous AI picture is kept for a moment and faded into the new one, so ~8 real frames/s don't look like a slideshow. */
let prevAiBmp: ImageBitmap | null = null;
let fadeStart = 0;
let fadeMs = 130;
let lastAiAt = 0;

// ---------- guards: frames that would look wrong are not shown ----------
// 1. Nobody (or only part of someone) in the camera. The model is told to dress "the person", so with nobody in view
//    it invents one: a stranger appeared at the start and end of sessions. The camera itself is tracked here (a few
//    times a second) and every AI picture is checked against the camera moment it was made from (its timestamp).
// 2. Bare forearms under long sleeves, or trousers turned into shorts. The server sends the body pose of each AI
//    picture; the colour along the arm or leg is compared: garment colour at the top, skin colour lower down = wrong.
// A wrong picture is skipped and the last good one stays; after HOLD_MAX_MS the newest is shown anyway.
const presenceLog: Presence[] = [];
let lastPresenceAt = 0;
let gateCamera = false; // show the plain camera: nobody properly in view
let gateHint = "";
let guardSince = 0;
let guardDrops = 0;
let presenceDrops = 0;

function logPresence(p: Presence) {
  pushPresence(presenceLog, p);
}

function setGateHint(h: string) {
  if (h === gateHint) return;
  gateHint = h;
  if (session || !aiShown) return; // a benchmark or the warm-up message owns that line
  promptEl.textContent = h;
  show(promptEl, !!h);
}

/** The garments on screen now: in outfit mode both, otherwise the one picked. */
function activeGarments(): { top: Garment | null; bottom: Garment | null } {
  if (outfitMode && outfitTop && outfitBottom) return { top: outfitTop, bottom: outfitBottom };
  return garment.category === "bottoms" ? { top: null, bottom: garment } : { top: garment, bottom: null };
}

const probe = document.createElement("canvas");
const probeCtx = probe.getContext("2d", { willReadFrequently: true })!;

function bareOnScreen(bmp: ImageBitmap, lm: Landmark[]): boolean {
  const { top, bottom } = activeGarments();
  const arms = top?.sleeves === "long";
  const legs = !!bottom && bottom.length !== "midi";
  if (!arms && !legs) return false;
  probe.width = 120;
  probe.height = Math.max(1, Math.round((120 * bmp.height) / bmp.width));
  probeCtx.drawImage(bmp, 0, 0, probe.width, probe.height);
  const d = probeCtx.getImageData(0, 0, probe.width, probe.height).data;
  return bareWhereCovered(lm, d, probe.width, probe.height, arms, legs);
}

/** False when this AI picture should not be shown (see above). */
function passesGuards(ts: number, bmp: ImageBitmap, pose: Landmark[] | null | undefined): boolean {
  const pr = ts > 0 ? presenceAt(presenceLog, ts) : null;
  if (pr && pr.ok !== "ok") {
    presenceDrops++;
    gateCamera = true;
    setGateHint(pr.ok === "close" ? "Step back a little so your body is in view" : "Step into view to try it on");
    return false;
  }
  gateCamera = false;
  const { bottom } = activeGarments();
  setGateHint(pr && bottom && !pr.legs ? "Step back so your legs are in view, down to the ankles" : "");
  if (pose && bareOnScreen(bmp, pose)) {
    const now = performance.now();
    if (!guardSince) guardSince = now;
    if (now - guardSince < HOLD_MAX_MS && latestAi) {
      guardDrops++;
      return false;
    }
  }
  guardSince = 0;
  return true;
}

/**
 * A GPU server that has been idle loads its model on the first visit (~30 s) and answers with black pictures
 * meanwhile. Until the first picture that is not black, keep showing the camera with a "warming up" hint.
 */
let aiShown = false;
let warmSince = 0;
const WARM_GIVE_UP_MS = 120_000; // after this, whatever arrives is shown (a genuinely dark scene)
const blackProbe = document.createElement("canvas");
blackProbe.width = 16;
blackProbe.height = 9;
const blackCtx = blackProbe.getContext("2d", { willReadFrequently: true })!;

function looksBlack(bmp: ImageBitmap): boolean {
  blackCtx.drawImage(bmp, 0, 0, 16, 9);
  const d = blackCtx.getImageData(0, 0, 16, 9).data;
  let s = 0;
  for (let i = 0; i < d.length; i += 4) s += d[i]! + d[i + 1]! + d[i + 2]!;
  return s / (16 * 9 * 3) < 4;
}

function setAi(bmp: ImageBitmap, pose: Landmark[] | null) {
  if (!aiShown) {
    if (looksBlack(bmp) && performance.now() - warmSince < WARM_GIVE_UP_MS) {
      bmp.close();
      promptEl.textContent = "Warming up the GPU… the first start takes about 30 seconds";
      show(promptEl, true);
      return;
    }
    aiShown = true;
    if (!session) show(promptEl, false); // a running benchmark shows its own prompts there
  }
  const t = performance.now();
  if (lastAiAt) fadeMs = Math.min(250, Math.max(60, fadeMs * 0.7 + (t - lastAiAt) * 0.3)); // follow the real frame gap
  lastAiAt = t;
  prevAiBmp?.close();
  prevAiBmp = latestAi?.bmp ?? null;
  fadeStart = t;
  latestAi = { bmp, pose };
}

/** A new AI picture: find the body in it (in the worker), so it can be bent to the live pose. */
function onAiFrame(bmp: ImageBitmap, known?: Landmark[] | null) {
  if (known !== undefined) {
    // pose found by the server: nothing left to do here
    if (known || !latestAi?.pose) setAi(bmp, known);
    else bmp.close(); // no body in this one: keep the last picture that has one
    return;
  }
  if (!cWarp.checked || !aiTracker) {
    setAi(bmp, null);
    return;
  }
  if (aiTracker.busy("ai")) {
    if (latestAi) bmp.close(); // keep showing the picture whose pose is known
    else setAi(bmp, null);
    return;
  }
  aiPending?.close();
  aiPending = bmp;
  createImageBitmap(bmp)
    .then((copy) => {
      if (aiPending !== bmp || !aiTracker) {
        copy.close();
        return;
      }
      aiTracker.detect("ai", copy, (pose, ms) => {
        cost.aiTrack = ema(cost.aiTrack, ms, 0.9);
        if (aiPending !== bmp) return; // replaced or stopped meanwhile
        aiPending = null;
        if (pose || !latestAi?.pose) setAi(bmp, pose);
        else bmp.close();
      });
    })
    .catch(() => undefined); // the picture was replaced and closed first
}

/** Every screen refresh: live camera, with the newest AI garment bent onto the body as it is right now. */
function render() {
  renderId = requestAnimationFrame(render);
  if (!stream || self.readyState < 2) return;
  const W = canvas.width;
  const H = canvas.height;
  const now = performance.now();

  if (fakeMode) {
    while (fakeQueue.length && fakeQueue[0]!.t <= now - FAKE_DELAY_MS) {
      onAiFrame(fakeQueue.shift()!.bmp);
      resultTotal++;
      recvCount++;
    }
    if (now - recvT >= 1000) {
      recvFps = (recvCount * 1000) / (now - recvT);
      recvCount = 0;
      recvT = now;
      ageMs = FAKE_DELAY_MS;
      renderStats();
    }
  }
  const trackNow = cWarp.checked || now - lastPresenceAt >= PRESENCE_EVERY_MS; // presence needs only a few checks a second
  if (trackNow && liveTracker && !liveGrabbing && !liveTracker.busy("live") && self.currentTime !== lastVideoTime) {
    lastVideoTime = self.currentTime;
    lastPresenceAt = now;
    liveGrabbing = true;
    const tCap = now;
    const { sx, sy, sw, sh } = cameraCrop(); // track the crop itself, so points match the view and the AI picture
    createImageBitmap(self, sx, sy, sw, sh, { resizeWidth: LIVE_TRACK_W, resizeHeight: Math.round((LIVE_TRACK_W * sh) / sw) })
      .then((b) => {
        liveGrabbing = false;
        liveTracker?.detect("live", b, (lm, ms) => {
          cost.liveTrack = ema(cost.liveTrack, ms, 0.9);
          logPresence(presenceOf(lm, tCap));
          if (!cWarp.checked) return;
          if (lm) predictor.push(smoother.apply(lm, tCap), tCap);
          else {
            smoother.reset();
            predictor.reset();
          }
        });
      })
      .catch(() => {
        liveGrabbing = false;
      });
  }
  // the pose arrives ~0.1 s after the camera frame it came from: carry it forward to this moment
  const livePose = cWarp.checked ? predictor.at(now) : null;

  const region = portraitRegion();
  if (portraitView() !== portraitShown) syncOrientation();
  const camera = (c: CanvasRenderingContext2D) => {
    if (region) {
      c.drawImage(self, 0, 0, W, H); // upright phone: the whole camera picture
      return;
    }
    const { sx, sy, sw, sh } = cameraCrop();
    c.drawImage(self, sx, sy, sw, sh, 0, 0, W, H);
  };
  // the AI picture, or for an upright phone just its centre part (the sides are blurred filler)
  const drawOne = (bmp: ImageBitmap) => {
    if (region) ctx.drawImage(bmp, region.rx, 0, region.rw, outH, 0, 0, W, H);
    else ctx.drawImage(bmp, 0, 0, W, H);
  };
  const drawAi = (bmp: ImageBitmap) => {
    const k = (now - fadeStart) / fadeMs;
    if (prevAiBmp && k < 1 && bmp === latestAi?.bmp) {
      drawOne(prevAiBmp); // old picture underneath, new one fading in on top
      ctx.globalAlpha = k;
      drawOne(bmp);
      ctx.globalAlpha = 1;
    } else drawOne(bmp);
  };
  const tDraw = performance.now();
  ctx.save();
  const mirrorDisplay = () => {
    ctx.translate(W, 0);
    ctx.scale(-1, 1);
  };
  const flip = flipInput(); // true: the AI got a flipped camera, so its answer is shown as it is
  if (cMirror.checked && !flip) mirrorDisplay(); // time-warp on: camera and answer are flipped on show
  let warped = false;
  if (!latestAi || gateCamera) {
    if (flip) {
      ctx.save();
      mirrorDisplay();
      camera(ctx); // until the first AI picture arrives: the camera, mirrored
      ctx.restore();
    } else camera(ctx);
  } else if (cWarp.checked && !region && latestAi.pose && livePose) {
    camera(ctx);
    warped = warper.draw(ctx, W, H, latestAi.bmp, latestAi.pose, livePose, camera);
    if (!warped) drawAi(latestAi.bmp);
  } else {
    drawAi(latestAi.bmp);
  }
  ctx.restore();
  warpedShare = warpedShare * 0.95 + (warped ? 0.05 : 0);
  cost.draw = ema(cost.draw, performance.now() - tDraw, 0.9);
  viewFrames++;
  if (now - viewT >= 1000) {
    viewFps = (viewFrames * 1000) / (now - viewT);
    viewFrames = 0;
    viewT = now;
  }
}

function sizeView() {
  const region = portraitRegion();
  if (portraitEngine()) {
    canvas.height = VIEW_W; // a tall picture: as tall as the wide one is wide
    canvas.width = Math.round((VIEW_W * outW) / outH);
    return;
  }
  canvas.height = Math.round((VIEW_W * outH) / outW);
  canvas.width = region ? Math.round((canvas.height * region.rw) / outH) : VIEW_W;
}

const TRACKER_TIMEOUT_MS = 15000;
let liveLoading = false;
let aiLoading = false;

/** Starts a tracker worker; resolves to null if it fails or takes too long (some phones hang on the GPU one). */
async function makeTracker(which: "live" | "ai", prefer: "GPU" | "CPU"): Promise<PoseClient | null> {
  for (const delegate of prefer === "GPU" ? (["GPU", "CPU"] as const) : (["CPU"] as const)) {
    const c = new PoseClient([which], delegate);
    const ok = await Promise.race([
      c.ready.then(() => true, () => false),
      new Promise<boolean>((r) => setTimeout(() => r(false), TRACKER_TIMEOUT_MS)),
    ]);
    if (ok) return c;
    c.close();
  }
  return null;
}

/**
 * Loads the body trackers in the background. Until they are ready (or if they never are) the view simply shows
 * the AI pictures without bending them to the live pose, so a slow phone never sits on a black screen.
 * Default "mix": the live tracker on the GPU, the AI-picture tracker on the CPU. ?tracker=gpu|cpu to compare.
 * The AI-picture tracker is only needed when the server does not send the pose itself.
 */
function loadTrackers(needAi: boolean) {
  const mode = new URLSearchParams(location.search).get("tracker") ?? "mix";
  if (!liveTracker && !liveLoading) {
    liveLoading = true;
    void makeTracker("live", mode === "cpu" ? "CPU" : "GPU").then((c) => {
      liveLoading = false;
      liveTracker = c;
      if (!c) console.warn("live body tracker unavailable: showing AI pictures without time-warp");
    });
  }
  if (needAi && !aiTracker && !aiLoading) {
    aiLoading = true;
    void makeTracker("ai", mode === "gpu" ? "GPU" : "CPU").then((c) => {
      aiLoading = false;
      aiTracker = c;
    });
  }
}

function renderStats() {
  const warpText = cWarp.checked ? ` · warp ${Math.round(warpedShare * 100)}%` : "";
  badge.textContent = `${fakeMode ? "TEST · " : ""}view ${viewFps.toFixed(0)} fps · AI ${recvFps.toFixed(0)} fps · ~${Math.round(ageMs)} ms behind${warpText}`;
  const s = serverStats;
  const num = (k: string) => (s[k] === undefined || s[k] === null ? "n/a" : String(s[k]));
  stats.innerHTML = "";
  const rows: [string, string][] = [
    ["Frames shown in browser", `${recvFps.toFixed(1)} /s`],
    ["Frames held back", `${guardDrops} bare arm/leg · ${presenceDrops} nobody in view`],
    ["Frames sent by GPU server", `${num("out_fps")} /s`],
    ["Model speed (real frames, estimate)", `${num("base_fps_est")} /s`],
    ["Camera frames reaching server", `${num("in_fps")} /s`],
    ["Network round trip", `${Math.round(rttMs)} ms`],
    ["Server: time to load a camera frame", `${num("feed_ms")} ms`],
    ["Server: time to read a result", `${num("read_ms")} ms`],
    ["Server: camera frames dropped (too old)", num("dropped")],
    ["Server: GPU busy / CPU used", `${num("gpu_util")} % / ${num("cpu_percent")} %`],
    ["Server: engine processes", num("spawn_procs")],
    ["Newest camera frame age at display", `${Math.round(ageMs)} ms`],
    ["View refresh (live motion)", `${viewFps.toFixed(0)} /s`],
    ["Page: camera frame to JPEG", `${Math.round(encodeMs)} ms`],
    ["Body tracker (live / AI picture)", liveTracker?.delegate ? `${liveTracker.delegate} / ${serverPose ? `GPU server, ${num("pose_ms")} ms` : (aiTracker?.delegate ?? "?")}` : "n/a"],
    ["Page: body tracking live / AI picture / drawing", `${cost.liveTrack.toFixed(1)} / ${cost.aiTrack.toFixed(1)} / ${cost.draw.toFixed(1)} ms`],
    ["Time-warp", cWarp.checked ? `on, ${Math.round(warpedShare * 100)}% of frames bent to the live pose` : "off"],
  ];
  for (const [k, v] of rows) {
    const p = document.createElement("p");
    p.innerHTML = `<span></span><b></b>`;
    (p.firstChild as HTMLElement).textContent = k;
    (p.lastChild as HTMLElement).textContent = v;
    stats.append(p);
  }
}

// ---------------------------------------------------------------------------------------------
// Benchmark and recording
// ---------------------------------------------------------------------------------------------
const HEADER = 40;
const MINI_W = 64;
const MINI_H = 36;
let session: BenchSession | null = null;
let recorder: Recorder | null = null;
let recordExt = "";
let composeId = 0;
let lastCompose = 0;
let sampleTimer = 0;
let phaseTimer = 0;
let promptTimer = 0;
let garmentCycleTimer = 0;
let markFlashUntil = 0;
let finishing = false;
const composite = document.createElement("canvas");
const compCtx = composite.getContext("2d")!;
const mini = document.createElement("canvas");
mini.width = MINI_W;
mini.height = MINI_H;
const miniCtx = mini.getContext("2d", { willReadFrequently: true })!;
let prevCam: Float32Array | null = null;
let prevAi: Float32Array | null = null;
let sampleBase = { results: 0, sent: 0, skipped: 0 };

function grayOf(): Float32Array {
  const d = miniCtx.getImageData(0, 0, MINI_W, MINI_H).data;
  const g = new Float32Array(MINI_W * MINI_H);
  for (let i = 0; i < g.length; i++) g[i] = 0.299 * d[i * 4]! + 0.587 * d[i * 4 + 1]! + 0.114 * d[i * 4 + 2]!;
  return g;
}

function motionBetween(a: Float32Array, b: Float32Array | null): number {
  if (!b) return 0;
  let s = 0;
  for (let i = 0; i < a.length; i++) s += Math.abs(a[i]! - b[i]!);
  return s / a.length;
}

function drawCamera(target: CanvasRenderingContext2D, dx: number, dy: number, dw: number, dh: number) {
  if (self.readyState < 2) return;
  const { sx, sy, sw, sh } = cameraCrop();
  target.save();
  if (cMirror.checked) {
    target.translate(dx + dw, dy);
    target.scale(-1, 1);
    target.drawImage(self, sx, sy, sw, sh, 0, 0, dw, dh);
  } else {
    target.drawImage(self, sx, sy, sw, sh, dx, dy, dw, dh);
  }
  target.restore();
}

function composeFrame(now: number) {
  composeId = requestAnimationFrame(composeFrame);
  if (!session || now - lastCompose < 30) return;
  lastCompose = now;
  const W = outW;
  const H = outH;
  if (composite.width !== W * 2 || composite.height !== H + HEADER) {
    composite.width = W * 2;
    composite.height = H + HEADER;
  }
  compCtx.fillStyle = "#0d0b14";
  compCtx.fillRect(0, 0, composite.width, composite.height);
  drawCamera(compCtx, 0, HEADER, W, H);
  compCtx.drawImage(canvas, W, HEADER, W, H);

  const marked = performance.now() < markFlashUntil;
  compCtx.fillStyle = marked ? "#ff3b5c" : "#ffffff";
  compCtx.font = "bold 16px ui-monospace, Menlo, monospace";
  compCtx.textBaseline = "middle";
  const label = `t=${session.elapsed().toFixed(1)}s  ${session.phaseName()}  ${recvFps.toFixed(0)} fps  ~${Math.round(ageMs)} ms  ${garment.id}${marked ? "  << MARK" : ""}`;
  compCtx.fillText(label, 8, HEADER / 2);
  compCtx.font = "13px ui-sans-serif, system-ui, sans-serif";
  compCtx.fillStyle = "#b9b4cc";
  compCtx.fillText("CAMERA (live)", 8, HEADER + 14);
  compCtx.fillText("AI RESULT", W + 8, HEADER + 14);

  // motion energy of each half, used to measure the real lag between them
  miniCtx.drawImage(composite, 0, HEADER, W, H, 0, 0, MINI_W, MINI_H);
  const cam = grayOf();
  miniCtx.drawImage(composite, W, HEADER, W, H, 0, 0, MINI_W, MINI_H);
  const ai = grayOf();
  session.addFrame(motionBetween(cam, prevCam), motionBetween(ai, prevAi));
  prevCam = cam;
  prevAi = ai;
}

function sessionSample() {
  if (!session) return;
  session.addSample({
    shown_fps: Math.round((resultTotal - sampleBase.results) * 10) / 10,
    behind_ms: Math.round(ageMs),
    rtt_ms: Math.round(rttMs),
    buffered_bytes: ws?.bufferedAmount ?? 0,
    client_sent: clientSent - sampleBase.sent,
    client_skipped: clientSkipped - sampleBase.skipped,
    decode_ms: Math.round(decodeMs * 10) / 10,
    server: { ...serverStats, client_warp_on: cWarp.checked, client_encode_ms: Math.round(encodeMs), client_skip_encoding: skips.encoding, client_skip_inflight: skips.inflight, client_skip_buffered: skips.buffered, client_server_pose: serverPose, client_tracker_delegate: `${liveTracker?.delegate ?? ""}/${aiTracker?.delegate ?? ""}`, client_view_fps: Math.round(viewFps), client_live_track_ms: Math.round(cost.liveTrack * 10) / 10, client_ai_track_ms: Math.round(cost.aiTrack * 10) / 10, client_draw_ms: Math.round(cost.draw * 10) / 10, client_warped_share: Math.round(warpedShare * 100) / 100, client_fake_mode: fakeMode, client_ack_rtt_ms: Math.round(ackRttMs), client_jpeg_quality: Math.round(jpegQuality * 100) / 100, client_inflight: inflight.size },
  });
  sampleBase = { results: resultTotal, sent: clientSent, skipped: clientSkipped };
}

function setBenchButtons(connected: boolean) {
  const idle = connected && !session;
  btnGuided.disabled = !idle;
  btnRecord.disabled = !connected || (!!session && session.guided);
  btnRecord.textContent = session && !session.guided ? "Stop and save" : "Start recording";
  btnBad.disabled = !session;
  btnGood.disabled = !session;
}

function startSession(guided: boolean) {
  if ((!ws && !fakeMode) || session || finishing) return;
  const track = stream?.getVideoTracks()[0];
  const nav = navigator as Navigator & { connection?: { effectiveType?: string; downlink?: number; rtt?: number }; deviceMemory?: number };
  let serverHost = "";
  try {
    serverHost = new URL(srvUrl.value.trim()).host;
  } catch {
    /* ignore */
  }
  session = new BenchSession(guided, GUIDED_PHASES, {
    garment_at_start: garment.id,
    send_fps_setting: Number(rSend.value),
    jpeg_quality_start: jpegQuality,
    max_inflight: MAX_INFLIGHT,
    time_warp: cWarp.checked,
    fake_mode: fakeMode,
    frame_size: `${outW}x${outH}`,
    mirror: cMirror.checked,
    camera_track: track?.getSettings(),
    server_host: serverHost,
    user_agent: navigator.userAgent,
    hardware_concurrency: navigator.hardwareConcurrency,
    device_memory_gb: nav.deviceMemory ?? null,
    screen: `${screen.width}x${screen.height}@${devicePixelRatio}`,
    network: nav.connection ? { effective_type: nav.connection.effectiveType, downlink_mbps: nav.connection.downlink, rtt_ms: nav.connection.rtt } : null,
    page: location.pathname,
  });
  session.note = benchNote.value;
  sampleBase = { results: resultTotal, sent: clientSent, skipped: clientSkipped };
  prevCam = null;
  prevAi = null;

  composite.width = outW * 2;
  composite.height = outH + HEADER;
  recorder = new Recorder();
  let ext: string | null = null;
  try {
    ext = recorder.start(composite, 30);
  } catch (err) {
    recorder.error = err instanceof Error ? err.message : String(err);
  }
  recordExt = ext ?? "";
  if (!ext) {
    session.event("video_not_recorded", recorder.error);
    benchStatus.textContent = `Video recording is not available (${recorder.error}). The numbers will still be saved.`;
  }
  lastCompose = 0;
  composeId = requestAnimationFrame(composeFrame);
  sampleTimer = window.setInterval(sessionSample, 1000);
  setBenchButtons(true);
  benchStatus.textContent = guided ? "Guided benchmark running. Follow the prompt on the video." : "Recording. Press Stop and save when you are done.";

  if (guided) runPhases();
}

function runPhases() {
  let i = 0;
  const begin = () => {
    if (!session) return;
    session.phaseIdx = i;
    const ph = GUIDED_PHASES[i]!;
    session.event("phase", ph.name);
    const endAt = performance.now() + ph.sec * 1000;
    clearInterval(promptTimer);
    const updatePrompt = () => {
      const left = Math.max(0, Math.ceil((endAt - performance.now()) / 1000));
      promptEl.textContent = `${i + 1}/${GUIDED_PHASES.length}: ${ph.label} (${left} s)`;
      show(promptEl, true);
    };
    updatePrompt();
    promptTimer = window.setInterval(updatePrompt, 250);
    clearInterval(garmentCycleTimer);
    if (ph.name === "garments") {
      const others = GARMENTS.filter((g) => g.id !== garment.id).slice(0, 3);
      const cycle = [others[0], others[1], others[2], garment].filter((g): g is Garment => !!g);
      let n = 0;
      garmentCycleTimer = window.setInterval(() => {
        const g = cycle[n++ % cycle.length];
        if (g) selectGarment(g);
      }, 3000);
    }
    phaseTimer = window.setTimeout(() => {
      i++;
      if (i < GUIDED_PHASES.length) begin();
      else void finishSession();
    }, ph.sec * 1000);
  };
  begin();
}

let lastFiles: { name: string; blob: Blob }[] = [];
const benchFiles = $("bench-files");

function renderFiles() {
  benchFiles.replaceChildren(
    ...lastFiles.map((f) => {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "btn btn-primary btn-small";
      b.textContent = `Save ${f.name.endsWith(".json") ? "numbers (.json)" : "video"} · ${(f.blob.size / 1024 / 1024).toFixed(1)} MB`;
      b.addEventListener("click", () => download(f.blob, f.name)); // a click is never blocked by the browser
      return b;
    }),
  );
}

async function finishSession() {
  if (!session || finishing) return;
  finishing = true;
  const s = session;
  clearInterval(sampleTimer);
  clearInterval(promptTimer);
  clearInterval(garmentCycleTimer);
  clearTimeout(phaseTimer);
  cancelAnimationFrame(composeId);
  show(promptEl, false);
  benchStatus.textContent = "Finishing and preparing the files…";
  try {
    sessionSample();
    const blob = await recorder?.stop();
    const recErr = recorder?.error ?? "";
    recorder = null;
    s.note = benchNote.value || s.note;
    const id = stamp();
    const videoName = blob ? `fynd-livegpu-${id}.${recordExt}` : null;
    const report = s.finish({
      server_info: serverInfo,
      server_stats_last: serverStats,
      video_file: videoName,
      video_format: blob ? blob.type : null,
      video_bytes: blob ? blob.size : 0,
      video_error: recErr || null,
      garment_at_end: garment.id,
    });
    lastFiles = [{ name: `fynd-livegpu-benchmark-${id}.json`, blob: new Blob([JSON.stringify(report, null, 1)], { type: "application/json" }) }];
    if (blob && videoName) lastFiles.push({ name: videoName, blob });
    renderFiles();
    // try to save automatically; if the browser blocks it, the buttons below still work
    lastFiles.forEach((f, i) => setTimeout(() => download(f.blob, f.name), i * 1500));
    const lag = report.measured_lag_from_video as { lag_ms?: number; reliable?: boolean };
    benchStatus.textContent =
      `Done. If the files did not download by themselves (Chrome may ask to allow multiple downloads), use the buttons below.` +
      (blob ? "" : ` No video was recorded${recErr ? ` (${recErr})` : ""}.`) +
      (lag.lag_ms !== undefined ? ` Measured lag from the video: about ${lag.lag_ms} ms${lag.reliable ? "" : " (low confidence)"}.` : "");
  } catch (err) {
    benchStatus.textContent = `Could not prepare the files: ${err instanceof Error ? err.message : String(err)}`;
  } finally {
    session = null;
    finishing = false;
    setBenchButtons(!!ws);
  }
}

function mark(kind: "problem" | "good") {
  if (!session) return;
  session.event(kind === "problem" ? "mark_problem" : "mark_good");
  if (kind === "problem") markFlashUntil = performance.now() + 1000;
}

// switching the time-warp on mid-session loads the trackers it needs
cWarp.addEventListener("change", () => {
  if (cWarp.checked && stream) loadTrackers(fakeMode || !serverPose);
});

btnGuided.addEventListener("click", () => startSession(true));
btnRecord.addEventListener("click", () => (session ? void finishSession() : startSession(false)));
btnBad.addEventListener("click", () => mark("problem"));
btnGood.addEventListener("click", () => mark("good"));
window.addEventListener("keydown", (e) => {
  if (e.target instanceof HTMLInputElement) return;
  if (e.key === "m" || e.key === "M") mark("problem");
  if (e.key === "g" || e.key === "G") mark("good");
});

// ---------------------------------------------------------------------------------------------
// Connection
// ---------------------------------------------------------------------------------------------
function fail(text: string) {
  $("error-text").textContent = text;
  show(ovLoading, false);
  show(ovError, true);
}

async function openCamera(): Promise<boolean> {
  show(ovError, false);
  show(ovLoading, true);
  $("loading-text").textContent = "Starting your camera…";
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      audio: false,
      video: { facingMode: "user", width: { ideal: 960 }, height: { ideal: 540 }, frameRate: { ideal: 30 } },
    });
    self.srcObject = stream;
    await self.play();
    loadTrackers(false); // the live tracker serves the "is someone in view" check (and the time-warp when it is on)
  } catch (err) {
    stop();
    fail(err instanceof DOMException && err.name === "NotAllowedError" ? "Camera access is blocked." : String(err));
    return false;
  }
  userStopped = false;
  lastVideoTime = -1;
  smoother.reset();
  cancelAnimationFrame(renderId);
  renderId = requestAnimationFrame(render);
  return true;
}

async function start() {
  if (!srvUrl.value.trim()) {
    fail("Enter the GPU server address and token in the panel first.");
    return;
  }
  try {
    localStorage.setItem(STORE, JSON.stringify({ url: srvUrl.value.trim(), token: srvToken.value }));
  } catch {
    /* private mode */
  }
  if (!(await openCamera())) return;
  reconnects = 0;
  aiShown = false;
  warmSince = performance.now();
  jpegQuality = 0.75;
  ackRttMs = 0;
  minAckMs = Infinity;
  connectWs();
}

/** Test mode without a GPU: your own camera picture, delayed like a GPU answer, stands in for the AI picture. */
async function startFake() {
  if (!(await openCamera())) return;
  fakeMode = true;
  loadTrackers(true);
  outW = 576;
  outH = 320;
  sizeView();
  fakeTimer = window.setInterval(() => {
    if (self.readyState < 2) return;
    const { sx, sy, sw, sh } = cameraCrop();
    const t = performance.now();
    void createImageBitmap(self, sx, sy, sw, sh, { resizeWidth: outW, resizeHeight: outH }).then((bmp) => {
      if (fakeMode) fakeQueue.push({ t, bmp });
      else bmp.close();
    });
  }, 1000 / 7); // about the GPU's real frame rate
  show(ovLoading, false);
  show(ovStart, false);
  show(tools, true);
  show(badge, true);
  setBenchButtons(true);
}

const TAB_ID = Math.random().toString(36).slice(2) + Date.now().toString(36);

function connectWs() {
  $("loading-text").textContent = "Connecting to the GPU server…";
  let url: string;
  try {
    const u = new URL(wsUrl());
    u.searchParams.set("sid", TAB_ID); // lets this tab reconnect to its own session; others get "busy"
    url = u.href;
  } catch {
    stop();
    fail("The server address isn't a valid URL.");
    return;
  }
  ws = new WebSocket(url);
  ws.binaryType = "arraybuffer";
  ws.onmessage = (ev) => {
    if (ev.data instanceof ArrayBuffer) {
      void drawResult(ev.data);
      return;
    }
    const m = parseServerMessage(ev.data as string);
    if (m.type === "ready") {
      outW = Number(m.width) || outW;
      outH = Number(m.height) || outH;
      sizeView();
      serverInfo = (m.info as Record<string, unknown> | undefined) ?? {};
      serverPose = serverInfo.server_pose === true;
      if (!serverPose && cWarp.checked) loadTrackers(true);
      show(ovLoading, false);
      show(ovStart, false);
      show(tools, true);
      show(badge, true);
      void sendGarment();
      restartSender();
      pingTimer = window.setInterval(() => ws?.send(encodeMessage({ type: "ping", t: performance.now() })), 2000);
      setBenchButtons(true);
    } else if (m.type === "ack") {
      const sentAt = inflight.get(Number(m.ts));
      inflight.delete(Number(m.ts));
      if (sentAt !== undefined) {
        const rtt = performance.now() - sentAt;
        ackRttMs = ema(ackRttMs, rtt);
        minAckMs = Math.min(minAckMs, rtt);
        jpegQuality = nextJpegQuality(jpegQuality, ackRttMs, minAckMs);
      }
    } else if (m.type === "stats") {
      serverStats = m;
    } else if (m.type === "pong") {
      rttMs = performance.now() - Number(m.t);
    } else if (m.type === "busy") {
      stop();
      fail("The GPU is serving another person right now. Try again in a minute.");
    } else if (m.type === "error") {
      stats.textContent = `Server: ${String(m.message)}`;
    }
  };
  ws.onclose = (ev) => {
    if (!ws) return; // we closed it ourselves
    session?.event("ws_close", { code: ev.code, reason: ev.reason, clean: ev.wasClean });
    inflight.clear();
    const wasLive = ovStart.hidden;
    const outcome = closeOutcome(ev.code, !!wasLive, reconnects, !!stream);
    if (outcome.kind === "reconnect") {
      reconnects++;
      clearInterval(pingTimer);
      ws = null;
      stats.textContent = `Connection dropped (code ${ev.code}). Reconnecting ${reconnects}/${MAX_RECONNECTS}…`;
      window.setTimeout(() => {
        if (stream && !userStopped) connectWs();
      }, 1000);
      return;
    }
    stop();
    if (outcome.message) fail(outcome.message);
  };
}

function restartSender() {
  clearInterval(sendTimer);
  sendTimer = window.setInterval(sendFrame, 1000 / Number(rSend.value));
}

function stop() {
  userStopped = true;
  serverPose = false;
  if (session) void finishSession(); // save whatever was recorded so far
  clearInterval(sendTimer);
  clearInterval(pingTimer);
  clearInterval(fakeTimer);
  cancelAnimationFrame(renderId);
  fakeMode = false;
  fakeQueue.splice(0).forEach((f) => f.bmp.close());
  latestAi?.bmp.close();
  latestAi = null;
  prevAiBmp?.close();
  prevAiBmp = null;
  lastAiAt = 0;
  aiPending?.close();
  aiPending = null;
  liveGrabbing = false;
  predictor.reset();
  presenceLog.length = 0;
  gateCamera = false;
  gateHint = "";
  guardSince = 0;
  const s = ws;
  ws = null;
  s?.close();
  stream?.getTracks().forEach((t) => t.stop());
  stream = null;
  self.srcObject = null;
  show(ovLoading, false);
  show(ovStart, true);
  show(tools, false);
  show(badge, false);
  if (!session) show(promptEl, false);
  stats.textContent = "Not connected.";
  setBenchButtons(false);
}

$("btn-start").addEventListener("click", () => void start());
$("btn-stop").addEventListener("click", stop);
$("btn-fake").addEventListener("click", () => void startFake());
$("btn-error-ok").addEventListener("click", () => show(ovError, false));
rSend.addEventListener("input", () => {
  $("o-send").textContent = rSend.value;
  if (ws) restartSender();
});
window.addEventListener("pagehide", stop);
// A phone hides the page for a moment all the time (camera permission pop-up, notification shade, screen dimming),
// which used to stop the session at once ("stopped" on phones). Stop only if it stays hidden, never mid-benchmark.
let hiddenTimer = 0;
document.addEventListener("visibilitychange", () => {
  clearTimeout(hiddenTimer);
  if (document.hidden && ws && !session) {
    hiddenTimer = window.setTimeout(() => {
      if (document.hidden && ws && !session) stop();
    }, 30_000);
  }
});

canvas.width = 960;
canvas.height = 540;
ctx.fillStyle = "#0d0b14";
ctx.fillRect(0, 0, canvas.width, canvas.height);
renderGrid();
setBenchButtons(false);

window.addEventListener("error", (e) => {
  benchStatus.textContent = `Page error: ${e.message}`;
});
window.addEventListener("unhandledrejection", (e) => {
  benchStatus.textContent = `Page error: ${e.reason instanceof Error ? e.reason.message : String(e.reason)}`;
});
