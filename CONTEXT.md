# CONTEXT: current state of the Fynd Studio try-on

**Read this first when starting or resuming.** Keep it up to date: at the end of every piece of work, edit "Current state", "Open work", "Untested" and add one line to the change log. If a session is about to run out, bring this file up to date before anything else, so the next session can continue from here. How to run, test and stop the GPU: `CLAUDE.md`.

Last updated: 2026-11-14.

## 1. What this is and why

- Live webcam virtual clothes try-on ("Fynd Studio") on a self-hosted GPU, no third-party AI API for the live picture. Photo mode also exists (not re-tested recently).
- Built by an intern for their manager (workspace `texel` on Modal, which has a spend limit). Goal: a demo that looks live, then something releasable ("anywhere AI" style Chrome extension).
- Model: FLUX.2-klein-4B through FluxRT, on a Modal B200 in Mumbai (ap-south), about $12/hour, only while a container runs (it stops 20 minutes after the last visitor, or when told).

## 2. Current state (what works)

- **Live try-on**: phone app `fynd-tryon-pt` (432x768) and laptop app `fynd-tryon` (768x432). The user confirmed the full laptop upload → AI garment preparation → webcam try-on flow on 2026-11-14 in workspace `aaryashah/main`. Modal returned 24 live frames at 768x432 during warm-up. The app is deployed at `https://aaryashah--fynd-tryon-live.ap-south.modal.run`; the active GPU container was explicitly stopped after the user's test, and Modal showed 0 active containers. The earlier apps remain deployed in workspace `texel` from 2026-11-13. To test again, open the local share page with the Modal server address; a visit starts the GPU. Stop the active GPU with `modal container stop <id>`, not `modal app stop`.
- **Catalog**: 98 garments (men 50, women 48) in T-shirts, polos, shirts, formal, sweatshirts/hoodies, jackets, bottoms (test). Generated with our own FLUX (`cloud_modal/generate_garments.py`, `tools/catalog_spec.py`), prepared by `tools/prepare_garments.py`.
- **Prompts** (`site/src/core/prompts.ts`): tops prompt plus extra lines for long sleeves, hoods, open fronts, patterns; bottoms prompt with full/midi length; outfit prompt. The server cuts prompts at 600 characters (longest is 585). The page has a prompt tester (test tools panel, `?bench=1`).
- **Guards** (`site/src/core/guards.ts`, `config.ts`): nobody in view / too close shows the plain camera with a hint; bare-limb skin check; hold-max 700 ms.
- **Code structure** (phases 1 to 3 of a restructure done): `site/src/core/` pure logic, `site/src/services/` server protocol and garment pictures, `site/src/livegpu.ts` still holds camera, WebSocket, render, stats, bench (phase 4 would move these). Stack: Vite 8, TypeScript 7, vanilla DOM, MediaPipe pose, vitest 3. 31 tests pass. `npm run build` writes `site/dist-share`, the folder the Modal deploy ships.
- **Upload your own garment** (new 2026-11-12/13, built into `dist-share`, **not yet tested on a GPU**): file picker, paste, drag-and-drop; plain background removal in the browser (`core/backdrop.ts`, any single flat colour); crop to the garment; after upload, chips ask: top or trousers, sleeve length, hood, pattern, open front, trouser length. These set the same prompt lines the catalog uses (`Garment.hood/pattern/openFront/sleeves/length`).
- **Upload crop box + preparation wiring** (built 2026-11-13, in `site/dist-share` locally, **NOT deployed**: the apps in texel still run the earlier upload build without it; `fynd-tryon-code.zip` is also from before this): after choosing/pasting/dropping a photo, `ui/cropper.ts` shows the picture with a box pre-set around the clothing (`core/crop.ts` maths, drag or resize with mouse or finger; buttons Use this part / Whole picture / Cancel). The cleaned crop is usable at once. If a service address is set (`PREPARE_URL` in `core/config.ts`, or open the page with `?prep=<address>/prepare` to try one), `services/prepareApi.ts` sends only the chosen crop (longest side 1024) with the access token; a spinner and “Preparing…” overlay now appear on the selected garment tile until the flat garment replaces the photo (`applyPrepared`) and chips are filled from the answer (`core/prepare.ts`); on failure the person keeps the photo with a message. Chips now include trouser length "Shorts" (prompt line added, untested on people). 50 tests pass; the crop box's on-screen behaviour (touch dragging, layout on a phone) is **not tested**, only its maths.
- **Garment preparation with OpenAI** (decided 2026-11-13): any shop photo, including a person wearing the garment, goes to OpenAI. `gpt-image-2` redraws just the garment flat on a plain light gray background (this is the retained, useful prompt); `gpt-5-mini` returns what it is (kind, name, sleeves, length, hood, pattern, open front). Code: `cloud_modal/prep_core.py` (standard library only) and `cloud_modal/prepare_garment.py` (Modal app `fynd-tryon-prep`, CPU only; token check, 6 pictures per person per minute, cache by picture fingerprint). **The manager approved sending garment pictures only** (never camera frames or user body photos) to OpenAI. `gpt-image-1` does not exist on the account. The OpenAI key is in `tools/.env` (not to be shared); the manager is to create the Modal secret `openai-key` later.
- **Chrome extension (local prototype, 2026-11-14)**: unpacked MV3 extension in `chrome-extension/`. The popup can select a local garment photo (up to 8 MB) or list loaded page images (180 px or larger); the image opens in the existing `livegpu.ts` upload/crop flow. Local photos show a preview and require clicking **Use this photo**. The MV3 service worker opens the Fynd tab and injects the selected image after page load, so the transfer continues after the popup closes. Try-on URL, AI preparation URL, and a local prep token are configurable. The default prep URL is the local service. `share.ts` restores the saved Modal GPU address when the extension opens a fresh local page tab. Host permission for the try-on page is requested from the Save button; product CDN access is requested when selecting the page image. Page-image listing was observed in Chrome; local-file transfer and AI prep handoff through the service worker need a browser check. CDN redirects, store adapters, and publishing remain open.

## 3. Open work, in order

1. **Garment-prep Modal deployment to `aaryashah/main` is pending**: the Modal CLI is authenticated to this workspace, but it has no `openai-key` secret and no `fynd-tryon-prep` app. The approval reviewer blocked transferring `OPENAI_API_KEY` from `tools/.env` into the Modal secret. For now, the tested local prep service at `127.0.0.1:8787/prepare` handles garment photos on the user's laptop; live webcam frames go to Modal GPU. Do not retry the blocked secret transfer without explicit approval. Each new garment can incur OpenAI API charges.
2. **Browser side of garment preparation: code written** (see section 2). Still to do: set `PREPARE_URL` once `fynd-tryon-prep` is deployed (the URL `modal deploy` prints, plus `/prepare`; check CORS works from the live page), test the crop box on the phone, then rebuild and redeploy both apps and refresh the zip. The crop box is shown on every upload (chosen default, pre-set around the clothing, one tap to confirm); change if the user prefers otherwise.
3. **Chrome extension prototype**: reload the unpacked extension in `chrome://extensions`, click Save and allow the try-on page permission, then test upload-from-computer and a product-page image. Confirm crop and local AI preparation; the GPU is currently stopped, so only test GPU handoff after the user chooses to start it. The current prototype is desktop Chrome only. After the flow works, address image/CDN edge cases, named store adapters (Amazon plus one more) and a generic fallback; then prepare the privacy policy/disclosure and Chrome Web Store listing. A policy check is needed on using other brands' product photos in a public tool.
4. **Capacity for a public release (blocker)**: one GPU serves one live viewer; `max_containers=1`. Needs a queue, per-person limits and a cost plan before many users.
5. Phase 4 of the restructure: move connection, camera and bench out of `livegpu.ts` into services, small shared store, UI components (React for components only; keep the video loop in plain TypeScript). Phase 5 visual redesign (ask first).
6. Update `README.md` and `PRODUCTION_PLAN.md` (still describe the early plan, Runpod, Decart).
7. More categories (kurtas etc.), optional.

## 4. Untested / known weak spots

- Upload chips and background removal on real photos, on the phone, on the GPU.
- Check Formal Shirt (`m-formal-check`): never seen on a person.
- Reconnect after a network drop (code written and unit-tested, never seen live).
- Stepping fully out of view and back in (hint seen, clean re-entry not).
- Black joggers sometimes look like shorts when a knee is raised in a close-up. Ghosting on fast close-up motion. A tan patch under one blazer frame (maybe skin).
- Chrome extension: page image list and local image preview were shown in Chrome. Chrome's host-permission request now comes from Save. The initial popup implementation did not reliably finish image injection after opening a new tab; transfer now runs in the MV3 service worker. This service-worker handoff needs a browser check. AI preparation handoff, image host redirects, and product-image permission prompts also need a full browser check. The Modal prep app is not deployed; use the local prep service for the prototype. The new preparation spinner on the selected garment tile is built but still needs a browser visual check.
- Gray background is intentional in the retained AI prompt; user asked to keep it. A temporary pure-white prompt edit was reverted before testing. The current garment preparation service has been restarted with the original prompt.
- Photo mode and the photo server (L40S) were not re-tested recently.
- Shorts as an uploaded bottom: the page only knows full length and below the knee.

## 5. Decisions and constraints

- Decart (hosted API) is out: company bans third-party AI APIs for the live picture. Exception, from 2026-11-13: OpenAI for **garment pictures only**.
- Only one GPU at a time (cost). Always stop the GPU when the user says "stop". Containers also stop 20 minutes after the last visitor.
- Do not change `server/live_server.py` or `server/tryon_server.py`. Do not lower JPEG quality or fps unless asked.
- Do not run heavy local browser tests (they freeze the user's laptop); the user tests on a phone.
- The Modal deploy ships `site/dist-share`: always rebuild and check the bundle before deploying.
- The user (not Claude) must revoke the old Decart API key. The manager's Modal token was shared in chat earlier: ask the manager to rotate it. Never write tokens or the OpenAI key into files that are shared.
- Lag reports so far were the network, not the GPU. Check the round-trip in the test panel first.

## 6. Facts worth remembering

- Spatial cache OFF (`FLUX_OVERRIDES`) took the speed from 3 to 27 fps. WebSocket compression must be off on Modal (code 1002). `routing_region="ap-south"` avoids extra lag.
- 768x432 and a 512 reference make printed text readable; 576x320 garbles it. The reference sent is always 512x512 (a new size makes the compiled model rebuild and freezes the picture).
- Prompt rules by garment name (catalog): hood `/hoodie|hooded/`, pattern `/check|plaid|gingham|stripe/`, open front `/blazer|waistcoat|trench|cardigan/`. Uploads use the user's chip answers instead.
- `modal app stop <app> --yes` needs `--yes`. A warm-up retry loop is needed on cold start (`tools/warm_up.py`).
- Vitest 5.1.0 crashes here; use vitest 3.

## 7. Resume checklist for a new session

1. Read this file, then `CLAUDE.md`.
2. `modal container list` should show nothing; if it shows a container, ask whether to stop it.
3. Pick the first open item in section 3 that is not blocked; ask the user before spending money or changing the visible UI.
4. When done, update sections 2 to 4 and add a line below.

## 8. Change log

- 2026-11-02: B200 setup final (22 fps shown, readable text).
- 2026-11-08 to 11-12: hood/blazer/pattern prompt lines, bold check shirts, prompt tester; found builds went to `dist` while deploy ships `dist-share`, fixed; restructure phases 1 to 3; 98 garments.
- 2026-11-12: phone test after restructure looked right (see section 2).
- 2026-11-12/13: upload feature: background removal, paste/drag-drop, garment questions (chips). 31 tests pass.
- 2026-11-13 17:24: deployed `fynd-tryon` and `fynd-tryon-pt` to texel (token fynd-BhJE8b2a, LIVE_ARGS as in CLAUDE.md), GPU left off; wrote `FYND_TRYON_DEMO.md` (standalone guide for the manager's Claude). Needed `PYTHONUTF8=1` on Windows for `modal deploy`.
- 2026-11-13: upload crop box, preparation-service client (`services/prepareApi.ts`), `core/crop.ts`, `core/prepare.ts`, shorts length chip. Built to `dist-share`, not deployed. 50 tests pass.
- 2026-11-13 evening: tested the new upload flow locally (page `npm run preview` on 127.0.0.1:4173 + `tools/local_prep_server.py` on 127.0.0.1:8787, open with `?prep=http://127.0.0.1:8787/prepare`): crop box, AI preparation and chip fill-in worked in the user's browser (maroon henley photo: flat shirt, name read correctly, ~20 s). Added `?server=<address>` to `share.ts` so a local page can use the Modal GPU; `?prep` is now read at load. **Live-GPU test not done**: the `fynd-tryon` (B200, ap-south) wake-up request waited ~10 min with no container, no tasks, no logs anywhere in texel and no Modal incident; likely no free B200 or a spend limit; cancelled, nothing billed. Retry later; fallback `LIVE_GPU=H100` (slower, ~16 fps) needs a redeploy. Also fixed `tools/warm_up.py` (certifi TLS) and the wake-up command in `FYND_TRYON_DEMO.md` (`curl -L`). Do not request the phone app URL while testing the laptop one (it starts a second GPU).
- 2026-11-13: garment preparation with OpenAI written and tested on two photos (not deployed). `CLAUDE.md` (runbook), `CONTEXT.md` (this file) and `tools/warm_up.py` created.
- 2026-11-14: started Chrome extension: added local MV3 popup/image picker, selected-image transfer into the existing garment crop flow, local file upload, and configurable AI preparation URL/token. Chrome showed the page image list. The user confirmed upload → local AI preparation → Modal GPU webcam try-on. Deployed the laptop Modal app to `aaryashah/main`, verified live frames, then stopped the GPU container at the user's request (0 active). Fixed fresh extension tabs to reuse the saved GPU address and defaulted local prep to `127.0.0.1:8787/prepare`; `npm run build` passes. Chrome reported that local-file permission was requested too late; permission now comes from Save. Added a local photo preview and explicit send button. The popup's tab-opening handoff has been moved to `service_worker.js` because it failed after the popup lost focus. `node --check` passes for popup and service worker, and manifest JSON parses; verify the handoff in Chrome after reloading. Modal prep secret setup remains blocked by automatic review; do not retry without explicit approval.
- 2026-11-14: added a spinner and “Preparing…” overlay to the selected custom garment tile while AI garment preparation runs. It disappears when the prepared image replaces the initial crop or if preparation fails. `npm run build` passes; verify the loader visually in the user's browser. GPU remains stopped.
- 2026-11-14: clarified that light grey was hard-coded in the AI image prompt, not a temporary output. Briefly changed the prompt to pure white, then reverted it at the user's direction before another test; restarted the local prep server with the original light-gray prompt.
