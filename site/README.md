# Fynd Studio Try-On (prototype)

Two ways to try tops and jackets on:

1. **Live camera / quick preview** runs entirely in the browser (MediaPipe body tracking, garment drawn over you). No server.
2. **Realistic AI render** sends one photo and one garment to a GPU server running FLUX.2 Klein 4B and shows the result (about 3 seconds of GPU time on an RTX 4090).

## Run the website on your PC

```
cd clothes_tryon\site
npm install
npm run dev          # open http://127.0.0.1:5173 in Chrome
```

`npm run build` makes the static site in `dist/`.

## Turn on the realistic render

On the Runpod pod (JupyterLab terminal), after the pod is started:

```
source /workspace/miniconda3/etc/profile.d/conda.sh
conda activate fluxrt
cd /workspace
TRYON_TOKEN=pick-a-secret python tryon_server.py
```

Upload `server/tryon_server.py` to `/workspace` first. Wait for `model loaded in ...s`.
The server listens on port 7860 (already exposed on the pod), so its address is
`https://<pod-id>-7860.proxy.runpod.net`.

In the site, open **AI server (developer setup)** in the right-hand panel, enter that address and the same secret, press **Test**, then **Save**.
Alternatively open the site once with `?ai=https://<pod-id>-7860.proxy.runpod.net&token=pick-a-secret`.
The settings are kept in the browser, and the token is removed from the address bar.

Then add a photo (or start the camera) and press **Realistic AI render**. With the camera on, the current frame is frozen and rendered.

## Notes and limits

- Stop the pod when finished; it bills by the hour while running.
- The server handles one render at a time; others wait. It is a prototype, not a production service.
- The first request after the pod starts waits for the model to load.
- Fine print on garments (small lettering) can come out slightly distorted.
- Garment pictures under `public/garments/` are placeholder test images for development only. Replace them before any public release.
- `?debug` on the site address draws the tracked body points.

## Rebuilding the garment cut-outs

Put flat product photos in `garments/flat-source/` (white background), list them in
`tools/prepare_garments.py`, adjust shoulder points in `tools/garment_overrides.json`, then:

```
python tools/prepare_garments.py
```
