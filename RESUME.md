# Resume checklist: live try-on on our own GPU

> **OUT OF DATE (old Runpod setup).** The live try-on now runs on Modal. See `CLAUDE.md` (how to run) and `CONTEXT.md` (current state).

Pod: `d1jfndrk5r143b` (RTX 4090, Secure Cloud, Norway, $0.89/hr). Nothing is installed on it yet.

1. Runpod console > Pods > clothes-tryon-live-4090 > Connect > Jupyter Lab (password is `JUPYTER_PASSWORD` under Details).
2. Upload these two files into the `workspace` folder with the upload arrow:
   - `clothes_tryon\server\bootstrap.sh`
   - `clothes_tryon\server\live_server.py`
3. Open a Terminal in Jupyter and run (choose your own secret word):
```
export TRYON_TOKEN=your-secret-word
cd /workspace
nohup bash bootstrap.sh > bootstrap.log 2>&1 &
tail -f bootstrap.log
```
   Installs everything and downloads the models (about 20-30 minutes), then starts the server.
   Done when the log shows `stream processor started` and `Uvicorn running on http://0.0.0.0:7860`.
   The first start also compiles the model, which takes a few minutes. Ctrl+C stops `tail` only.
4. On your PC:
```
cd D:\Downloads\ring_virtual_tryon\clothes_tryon\site
npm run dev
```
   Open `http://127.0.0.1:5173/livegpu.html`, enter `https://d1jfndrk5r143b-7860.proxy.runpod.net` and your secret word, pick a garment, press Start.
5. The stats panel shows frames shown, frames sent by the server, round trip and delay.
   Compare with the old Gradio demo (4090): 5.85 real fps still, 3.4-4.4 moving, 14-17 shown fps moving.

Tuning flags go in `LIVE_ARGS` before step 3, e.g. `export LIVE_ARGS="--steps 1 --tiny-vae"`.

Stop the pod when done. Do not stop it between tests: a stopped pod can lose its GPU.
