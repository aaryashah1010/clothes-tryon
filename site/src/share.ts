/**
 * The shareable demo page: live camera try-on and photo try-on, both on our GPU server, nothing else.
 * The page is served by the GPU server itself, so the live connection goes back to where it came from.
 * Open it once as …/?t=<token>; the token is remembered and removed from the address bar.
 */
import { currentGarment, onGarmentChange } from "./livegpu";
import { garmentUrl } from "./garments";
import { AiError, renderTryOn, type AiConfig } from "./ai";

const $ = <T extends HTMLElement>(id: string): T => {
  const el = document.getElementById(id);
  if (!el) throw new Error(`Missing #${id}`);
  return el as T;
};

// ---------- server address and token ----------
const KEY = "fynd-studio-share";
const q = new URLSearchParams(location.search);
let saved: { token?: string; photo?: string; bench?: boolean } = {};
try {
  saved = JSON.parse(localStorage.getItem(KEY) ?? "{}") as typeof saved;
} catch {
  /* nothing saved */
}
const token = q.get("t") ?? saved.token ?? "";
// photo server: same pod, port 8080 (…-7860.proxy.runpod.net -> …-8080.proxy.runpod.net), or ?photo=<url>
const photoUrl = q.get("photo") ?? saved.photo ?? location.origin.replace(/-7860\./, "-8080.");
// test tools (live numbers, recording, benchmark): ?bench=1 turns them on for this browser, ?bench=0 off
const bench = q.has("bench") ? q.get("bench") !== "0" : saved.bench === true;
try {
  localStorage.setItem(KEY, JSON.stringify({ token, photo: photoUrl, bench }));
} catch {
  /* private mode */
}
// The address bar is cleaned right away; ?prep= / ?server= and #prepToken are read by livegpu.ts before it runs.
const hasPrepToken = new URLSearchParams(location.hash.replace(/^#/, "")).has("prepToken");
if (q.has("t") || q.has("photo") || q.has("bench") || hasPrepToken) history.replaceState(null, "", location.pathname);
$("bench-panel").hidden = !bench;

// ---------- one link for laptop and phone ----------
// A phone goes to the tall "phone" server (…-pt-live…, same address with -pt): it draws a tall picture, so the whole
// frame is the person, much sharper than a slice of a wide picture. ?device=laptop keeps a phone here.
const isPhone = matchMedia("(pointer: coarse)").matches && Math.min(screen.width, screen.height) < 820;
const phoneHost = location.host.includes("-pt-live.") ? location.host : location.host.replace(/-live\./, "-pt-live.");
if (isPhone && phoneHost !== location.host && q.get("device") !== "laptop") {
  const p = new URLSearchParams({ t: token });
  if (bench) p.set("bench", "1");
  location.replace(`https://${phoneHost}/?${p.toString()}`);
}

// ?server=<address> points this page at a GPU server on another address (for testing a local build against the GPU on Modal)
let liveSettings: { url?: string } = {};
try {
  liveSettings = JSON.parse(localStorage.getItem("fynd-studio-livegpu") ?? "{}") as typeof liveSettings;
} catch {
  /* nothing saved */
}
$<HTMLInputElement>("srv-url").value = q.get("server") ?? liveSettings.url ?? location.origin;
$<HTMLInputElement>("srv-token").value = token;
const photoCfg: AiConfig = { url: photoUrl, token };

// ---------- tabs ----------
const tabLive = $("tab-live");
const tabPhoto = $("tab-photo");
function showTab(photo: boolean) {
  tabLive.classList.toggle("is-active", !photo);
  tabPhoto.classList.toggle("is-active", photo);
  tabLive.setAttribute("aria-selected", String(!photo));
  tabPhoto.setAttribute("aria-selected", String(photo));
  $("live-stage").hidden = photo;
  $("live-options").hidden = photo;
  $("photo-stage").hidden = !photo;
  $("photo-options").hidden = !photo;
  if (photo && !$("tools").hidden) $("btn-stop").click(); // one GPU job at a time
}
tabLive.addEventListener("click", () => showTab(false));
tabPhoto.addEventListener("click", () => showTab(true));

// live status line, from the page's own state
const liveStatus = $("live-status");
new MutationObserver(() => {
  if (!$("ov-error").hidden) liveStatus.textContent = $("error-text").textContent ?? "";
  else if (!$("ov-loading").hidden) liveStatus.textContent = $("loading-text").textContent ?? "";
  else if (!$("tools").hidden) liveStatus.textContent = "Live. Move, turn and try other garments.";
  else liveStatus.textContent = "Press Start camera, then move naturally.";
}).observe(document.body, { subtree: true, attributes: true, attributeFilter: ["hidden"] });

// ---------- photo try-on ----------
const fileInput = $<HTMLInputElement>("photo-file");
const drop = $("drop");
const view = $<HTMLImageElement>("photo-view");
const busy = $("photo-busy");
const btnRender = $<HTMLButtonElement>("btn-render");
const btnCompare = $<HTMLButtonElement>("btn-compare");
const btnSave = $<HTMLButtonElement>("btn-save");
const photoStatus = $("photo-status");
let person: Blob | null = null;
let personUrl = "";
let resultUrl = "";
let rendering = false;

function status(text: string, error = false) {
  photoStatus.textContent = text;
  photoStatus.classList.toggle("is-error", error);
}

/** Phone photos can be 12 MP: send at most 1280 px on the long side (the server works at 1024). */
async function shrink(file: File): Promise<Blob> {
  const bmp = await createImageBitmap(file, { imageOrientation: "from-image" });
  const k = Math.min(1, 1280 / Math.max(bmp.width, bmp.height));
  const c = document.createElement("canvas");
  c.width = Math.round(bmp.width * k);
  c.height = Math.round(bmp.height * k);
  c.getContext("2d")!.drawImage(bmp, 0, 0, c.width, c.height);
  bmp.close();
  return new Promise((resolve, reject) => c.toBlob((b) => (b ? resolve(b) : reject(new Error("encode failed"))), "image/jpeg", 0.92));
}

function showImage(url: string) {
  view.src = url;
  view.hidden = false;
  drop.hidden = true;
}

async function usePhoto(file: File) {
  try {
    person = await shrink(file);
  } catch {
    status("That file couldn't be read as a picture.", true);
    return;
  }
  if (personUrl) URL.revokeObjectURL(personUrl);
  if (resultUrl) URL.revokeObjectURL(resultUrl);
  resultUrl = "";
  personUrl = URL.createObjectURL(person);
  showImage(personUrl);
  btnRender.disabled = false;
  btnCompare.disabled = true;
  btnSave.disabled = true;
  void render();
}

async function render() {
  if (!person || rendering) return;
  rendering = true;
  btnRender.disabled = true;
  busy.hidden = false;
  const g = currentGarment();
  status(`Dressing you in the ${g.name}…`);
  try {
    const garmentBlob = await (await fetch(garmentUrl(g.file))).blob();
    const out = await renderTryOn(photoCfg, person, garmentBlob);
    if (resultUrl) URL.revokeObjectURL(resultUrl);
    resultUrl = URL.createObjectURL(out);
    showImage(resultUrl);
    btnCompare.disabled = false;
    btnSave.disabled = false;
    status(`${g.name}. Pick another garment to try it too.`);
  } catch (err) {
    status(err instanceof AiError ? err.message : "Something went wrong. Please try again.", true);
  } finally {
    rendering = false;
    busy.hidden = true;
    btnRender.disabled = !person;
  }
}

fileInput.addEventListener("change", () => {
  const f = fileInput.files?.[0];
  if (f) void usePhoto(f);
  fileInput.value = "";
});
$("btn-new-photo").addEventListener("click", () => fileInput.click());
btnRender.addEventListener("click", () => void render());
drop.addEventListener("dragover", (e) => {
  e.preventDefault();
  drop.classList.add("is-over");
});
drop.addEventListener("dragleave", () => drop.classList.remove("is-over"));
drop.addEventListener("drop", (e) => {
  e.preventDefault();
  drop.classList.remove("is-over");
  const f = e.dataTransfer?.files[0];
  if (f) void usePhoto(f);
});
const holdOn = () => personUrl && resultUrl && (view.src = personUrl);
const holdOff = () => resultUrl && (view.src = resultUrl);
btnCompare.addEventListener("pointerdown", holdOn);
["pointerup", "pointerleave", "pointercancel"].forEach((ev) => btnCompare.addEventListener(ev, holdOff));
btnSave.addEventListener("click", () => {
  if (!resultUrl) return;
  const a = document.createElement("a");
  a.href = resultUrl;
  a.download = `fynd-studio-${currentGarment().id}.png`;
  a.click();
});
// a new garment on the photo tab re-renders the same photo
onGarmentChange(() => {
  if (!$("photo-stage").hidden && person) void render();
});
