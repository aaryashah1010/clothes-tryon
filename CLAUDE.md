# Fynd Studio virtual try-on: how to run, test and stop it

This file is for you (Claude Code) and for the person running the demo. Do the steps in order. **Before any step that costs money (deploy, warm-up), say what it costs and wait for a yes. Always finish by stopping the GPU.**

What it is: a live webcam clothes try-on. The browser sends camera frames to a GPU on Modal; our own model (FLUX.2-klein-4B through FluxRT, self-hosted) redraws the person wearing the chosen garment and sends the picture back. No third-party AI API is used for the live picture. Current state, decisions and open work: read `CONTEXT.md` first (it is kept up to date).

## 0. What is running right now

Nothing, unless you started it. Check, any time (free):

```
modal app list                # look for fynd-tryon and fynd-tryon-pt with state "deployed"
modal container list          # a row here = a GPU is running and billing (about $12/hour for the B200)
```

If `modal container list` shows no rows, no GPU is billing. After `modal app stop`, the app disappears from the list.

## 1. One-time setup on your PC

1. Install Python 3.12+ and Node 22+ (Node only if you will change the web page).
2. `pip install modal websockets opencv-python numpy`
3. `modal setup` (opens the browser; log in to the workspace **texel**). Check: `modal profile list`, the row for `texel` must be the active one. If not: `modal profile activate texel`.
4. Open a terminal in the `clothes_tryon` folder (the one containing this file, `cloud_modal/`, `server/`, `site/`). All commands below run from there.
5. The model files (~15 GB) are already stored in the Modal volume `fynd-tryon-models` of workspace texel. Nothing to download. (Only if that volume is ever missing: `modal run cloud_modal/modal_app.py::download`, CPU only, takes a while.)
6. (If you got this as a zip: `site/public/garments/` and `site/public/mediapipe/` were left out to save size. They are only needed to rebuild the page; to rebuild, copy `site/dist-share/garments` and `site/dist-share/mediapipe` into `site/public/` first. `tools/.env` is also not included, by design.)
7. The web page is already built into `site/dist-share`, and the deploy copies that folder. No Node step is needed to demo. Only if you change files under `site/src`: `cd site && npm install && npm run build`, then check the new text is in `site/dist-share/assets/share-*.js` **before** deploying (a deploy can succeed and still serve an old page).

## 2. Start it (deploy, then wake the GPU)

Pick **one** app. Only one GPU should run at a time (cost). Each GPU serves **one viewer at a time**.

- **Phone app** (portrait picture): app name `fynd-tryon-pt`
- **Laptop app** (landscape picture): app name `fynd-tryon`

Choose your own access token (anyone with the link and token can use the GPU). The examples use `fynd-BhJE8b2a`, the one in the links already shared; change it if you like, but use the same word everywhere below.

On Windows, first run `$env:PYTHONUTF8 = "1"` (otherwise `modal deploy` can fail with a `'charmap' codec can't encode character` error from its checkmarks).

PowerShell, phone app:

```
$env:TRYON_TOKEN = "fynd-BhJE8b2a"
$env:APP_NAME = "fynd-tryon-pt"
$env:LIVE_ARGS = "--steps 2 --tiny-vae --interp 2 --jpeg-quality 92 --send-fps 20 --width 432 --height 768"
modal deploy cloud_modal/modal_app.py
```

PowerShell, laptop app (note: no APP_NAME, and the size is landscape):

```
$env:TRYON_TOKEN = "fynd-BhJE8b2a"
Remove-Item Env:APP_NAME -ErrorAction SilentlyContinue
$env:LIVE_ARGS = "--steps 2 --tiny-vae --interp 2 --jpeg-quality 92 --send-fps 20 --width 768 --height 432"
modal deploy cloud_modal/modal_app.py
```

Bash equivalent: `TRYON_TOKEN=fynd-BhJE8b2a APP_NAME=fynd-tryon-pt LIVE_ARGS="..." modal deploy cloud_modal/modal_app.py`.

`modal deploy` prints the web addresses. The live address has the shape `https://texel--<app-name>-live.ap-south.modal.run` (texel = the workspace name). So:

- phone: `https://texel--fynd-tryon-pt-live.ap-south.modal.run`
- laptop: `https://texel--fynd-tryon-live.ap-south.modal.run`

Deploying alone does not start a GPU; the first request does (and billing starts then). The **first start compiles the model and takes several minutes**; the engine then loads on the first client connection (about 25 s). Wake it yourself before showing anyone:

```
python tools/warm_up.py texel--fynd-tryon-pt-live.ap-south.modal.run fynd-BhJE8b2a 12
```

(use the laptop host for the laptop app). It retries while the server starts and prints `first frame after N s | frames M` with M above 0 when ready. If it gives up after ~10 minutes: `modal app logs fynd-tryon-pt` (or `fynd-tryon`).

Settings that matter (already the defaults above; do not change unless asked): B200 GPU, region ap-south (Mumbai), 768x432 (phone 432x768), `--interp 2`, FluxRT spatial cache **off** (that one change took the speed from 3 to 27 fps), garment reference 512x512. These come from `cloud_modal/modal_app.py` and its environment variables `LIVE_GPU`, `REGION`, `LIVE_ARGS`, `FLUX_OVERRIDES`.

## 3. Test it

Open on the device with the camera:

```
https://texel--fynd-tryon-pt-live.ap-south.modal.run/?t=fynd-BhJE8b2a&bench=1      (phone)
https://texel--fynd-tryon-live.ap-south.modal.run/?t=fynd-BhJE8b2a&bench=1         (laptop)
```

`&bench=1` shows the test tools panel (live numbers, recording, prompt tester). Leave it off for people who are only looking. The laptop link, opened on a phone, redirects to the phone app (so the phone app must be the one deployed for that to work).

What to do on the page:

1. Press **Start camera**, allow the camera, stand so your upper body is in view (for trousers, step back until your legs show down to the ankles).
2. Pick a garment in the grid (Men / Women, category chips). The live picture shows you wearing it after a moment.
3. **Outfit mode** (toggle under the grid): pick a top and trousers together.
4. **Upload your own**: a front-view photo of one garment on a plain background works best. Then answer the small questions that appear (top or trousers, sleeves, hood, pattern, open front). Photos of a person wearing it are not handled well yet (see `CONTEXT.md`, garment preparation).
5. Test tools (`bench=1`): fps, round-trip time, a prompt box to change the instruction sent to the model and see the effect, and recording.

What good looks like: smooth video (about 20+ frames/s shown), the garment follows the body, long sleeves cover the arms, hoods show, blazers show a shirt underneath. Known weak spots: fast motion can ghost; lifting a leg can make trousers look like shorts; nobody in view shows the plain camera and a hint.

Lag is almost always the network (college Wi-Fi, hotspots), not the GPU. Check the round-trip number in the test panel before blaming the GPU.

## 4. Stop it (always)

```
modal app stop fynd-tryon-pt --yes
modal app stop fynd-tryon --yes
modal container list          # must show no rows
```

`modal app stop` removes the deployment (a redeploy is needed to start again). To switch only the GPU off and keep the app deployed: `modal container stop <container-id>` for each row of `modal container list`. `FYND_TRYON_DEMO.md` is the short guide for someone who only wants to switch it on and test, without the code.

`--yes` is required (no interactive terminal). Containers also stop by themselves 20 minutes after the last visitor, but do not rely on that: the B200 costs about $12/hour (about 20 cents a minute).

## 5. Rules

- One GPU at a time. One viewer per GPU: a second viewer is turned away ("busy"); opening the link in another tab or device takes over the session (close code 4410).
- Never print, paste or commit tokens: the Modal token from `modal setup`, the OpenAI key in `tools/.env`, or the access token in anything public. **Do not hand `tools/.env` to anyone.**
- Do not change `server/live_server.py` or `server/tryon_server.py` (they are run unchanged on purpose). Do not lower the JPEG quality or fps unless asked.
- Do not run heavy browser automation on a laptop (it freezes it); let a person test.
- Ask before destructive actions.
- At the end of any piece of work, **update `CONTEXT.md`** (what changed, what is next, what is untested), so the work can continue in a new session.

## 6. If something goes wrong

| What you see | Cause and fix |
|---|---|
| `Workspace ... has exceeded its spend limit` on deploy | The workspace limit is used up. Only the workspace owner can raise it in the Modal dashboard. |
| Warm-up or page: handshake error / 502 in the first minutes | The server is still starting (compiling). Wait, the warm-up script retries. |
| "Wrong access token" (code 4401) | The `t=` in the link differs from the `TRYON_TOKEN` used at deploy. |
| "Another tab or device took over" (4410) | A second viewer connected. Close the other one. |
| Page shows old behaviour after a change | Page not rebuilt into `site/dist-share` before deploy. Rebuild, check the bundle text, redeploy. |
| `modal` says not logged in / wrong workspace | `modal setup`, then `modal profile activate texel`. |
| Video choppy but numbers fine | Network. Try another connection. |
| Deploy hangs on image build | First build is slow (several minutes); later deploys reuse the cache. |

## 7. Where things are

| Path | What it is |
|---|---|
| `cloud_modal/modal_app.py` | The Modal app: GPU live server (and a photo server on an L40S) |
| `cloud_modal/launch_live.py` | Starts `server/live_server.py` with Modal fixes (WebSocket compression off, FluxRT overrides) |
| `server/live_server.py`, `server/tryon_server.py` | The servers, unchanged |
| `site/src/` | The web page (Vite + TypeScript). `core/` = pure logic (prompts, guards, geometry, protocol), `services/` = server messages and garment pictures, `livegpu.ts` = the page |
| `site/dist-share/` | The built page that the deploy ships |
| `site/public/garments/`, `site/src/garments.json` | The 98 catalog garments |
| `tools/` | Catalog tools, `warm_up.py`, garment extraction test |
| `cloud_modal/prep_core.py`, `cloud_modal/prepare_garment.py` | Garment preparation with OpenAI (written, **not deployed**, needs a Modal secret; see `CONTEXT.md`) |
| `CONTEXT.md` | Current state: read this first when resuming |

Tests for the page logic: `cd site && npm test` (31 tests). Typecheck: `npm run typecheck`.

The old `README.md`, `PLAN.md`, `PRODUCTION_PLAN.md` and `RESUME.md` describe earlier plans (planning stage, Runpod, Decart) and are out of date. Trust `CONTEXT.md` and this file.
