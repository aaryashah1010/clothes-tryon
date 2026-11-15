# Fynd Studio try-on: production readiness and plan (2026-11-03)

## Where we are
A working demo: live webcam try-on and photo try-on on our own GPU (B200 on Modal, Mumbai), no outside API.
Not production ready yet. It is a good prototype, not a product.

## What is solid
- Small server (about 690 lines Python: `server/live_server.py`, `server/tryon_server.py`), documented socket protocol.
- TypeScript site that type-checks, pinned dependency versions, reproducible Modal deployment (`cloud_modal/`).
- Measured results and saved working configurations (`cloud_modal/saved/`).

## What blocks production
| Area | Problem | Fix |
|---|---|---|
| Version control | The folder is not a git repo. No history, no review, no rollback. | `git init`, `.gitignore`, first commit. |
| Secrets | A Decart key sits in `site/.env.local`; the Decart SDK and a token proxy are still in `vite.config.ts` and `package.json`. Company policy bans third-party APIs. | Rotate the key, delete the file, remove the Decart code and the `liveai` page. |
| Repo hygiene | `people/` (photos of real people), `benchmarks/` (205 MB), `results/`, logs and screenshots sit in the project. | Move to external storage or a private data folder; keep only small samples. |
| Dead code | Old experiments: `index.html` + `main.ts` (in-browser overlay), `lab3d`, `liveai`, `timewarp`. | Delete, or move to an `archive/` branch. |
| Code structure | `livegpu.ts` is 1184 lines: camera, socket, drawing, garment grid, benchmark and recording in one file. | Split into modules; benchmark/recording become a dev-only module. |
| Server hacks | `launch_live.py` patches `json.load`/`json.dump` and uvicorn to change FluxRT settings. Works, but fragile. | Replace with explicit config in our server, or a small FluxRT patch we own. |
| Tests / CI | None. Only `tsc`. | pytest for the server protocol, unit tests for pure functions, GitHub Actions: type-check, build, lint, tests. |
| Auth | One shared token in the URL, plain string compare, CORS `*`, no rate limit. | Per-brand API keys, short-lived session tokens, origin allow-list, rate limits, constant-time compare. |
| Scaling | One viewer per GPU, 1 to 2 minute cold start, no queue, no autoscale, no monitoring. | Several containers, a queue with a clear "busy" screen, session time limit, metrics and alerts. |
| Legal and privacy | Garment photos carry brand logos (Fendi, Chanel). Camera frames are processed live. | Use garments we have rights to; privacy notice and consent text; confirm every model licence. |

## Framework decision
Keep Vite + TypeScript. Do not move to React or Next.js now.
- Our difficulty is the GPU pipeline, not the screens. A framework would not make it faster or clearer.
- The product we pitch to brands is a "Try it on" button inside their own site (Shopify, custom stores). That needs a small, framework-free widget (a web component), which Vite + TypeScript builds well.
- Use Next.js (or similar) only for a brand dashboard later: catalog upload, API keys, usage. That is a separate app.
- Backend: keep FastAPI. Add a queue and per-brand keys; consider WebRTC instead of JPEG-over-WebSocket only if bandwidth stays a problem.

## Plan
**Phase 0: today to 1 day. Make it safe and shareable**
git init and `.gitignore`; rotate the Decart key and remove Decart code; move `people/` and `benchmarks/` out; delete dead pages.

**Phase 1: 2 to 3 days. Clean code**
Folders: `server/`, `web/`, `deploy/modal/`, `garments/`, `docs/`. Split `livegpu.ts`. One config file. README with a one-command deploy. CI with type-check, build and tests.

**Phase 2: 3 to 5 days. Categories and women**
Test set: 10 garments x several people (men and women), same recorded clips for every run. Decide the 2 to 3 categories we do best (tops, sweatshirts, jackets). Add garment upload with a crop step. Compare CatVTON and similar image models for photo mode.

**Phase 3: about 1 week. Production hardening**
Per-brand API keys and short-lived tokens, rate limits, origin allow-list, logs and metrics, queue and autoscale, session time limit, privacy and consent text.

**Phase 4: after a brand says yes**
Embeddable widget, brand catalog import, dashboard.

## Women's garments (status)
- Women were never tested on camera, only men.
- In the grid: two women's blazers already existed (sage blazer-dress, sand blazer). Added one women's top: Cropped Monogram Sweater.
- Left out: a white cropped shirt (the automatic cut-out removed the white fabric), and dresses and the jumpsuit (upper body first).
- Next: about 10 clean women's top photos we have rights to, and test with women on camera.
