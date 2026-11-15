"""Low-latency live try-on server around FluxRT (runs on the GPU pod).

Why this exists: FluxRT's Gradio demo handles the webcam as one request/response per frame, so the
browser can only receive as many frames as network round trips allow (a few per second from India to
a European GPU), even when the GPU produces ~23 frames/s. Here the camera streams up and the results
stream down over one WebSocket, independently, so the GPU's full output rate reaches the browser.

Start (inside the fluxrt conda env, from anywhere):
    pip install websockets            # once per pod start; uvicorn needs it for WebSockets
    TRYON_TOKEN=pick-a-secret python live_server.py [--steps 2] [--height 320 --width 576] [--interp 2]

Protocol on  wss://<host>/ws?token=...
    browser -> server  binary: 8-byte float64 client timestamp + JPEG camera frame
                       text:   {"type":"garment","image":"<base64 jpeg/png>"}  |  {"type":"prompt","text":"..."}
                               {"type":"ping","t":<number>}
    server -> browser  binary: 8-byte float64 timestamp of the newest camera frame fed in + JPEG result
                       text:   {"type":"stats",...} | {"type":"pong","t":...} | {"type":"busy"} | {"type":"ready",...}
Only one shopper at a time per GPU; others get {"type":"busy"}.
Camera frames are processed in memory and never stored.
"""
import argparse
import asyncio
import base64
import json
import os
import platform
import struct
import subprocess
import sys
import tempfile
import threading
import time

import cv2
import numpy as np

FLUXRT_DIR = os.environ.get("FLUXRT_DIR", "/workspace/FluxRT")
TOKEN = os.environ.get("TRYON_TOKEN", "")
DEFAULT_PROMPT = (
    "The person is wearing the clothing item from the reference image. "
    "Keep the face, pose and background unchanged."
)


def parse_args():
    ap = argparse.ArgumentParser()
    ap.add_argument("--port", type=int, default=7860)
    ap.add_argument("--steps", type=int, default=None, help="denoising steps per frame (config default 2)")
    ap.add_argument("--height", type=int, default=None)
    ap.add_argument("--width", type=int, default=None)
    ap.add_argument("--interp", type=int, default=None, help="RIFE interpolation exponent: 0=off, 1=x2, 2=x4")
    ap.add_argument("--int8", action="store_true", help="needs the FLUX.2-klein-4B-int8 folder")
    ap.add_argument("--tiny-vae", action="store_true")
    ap.add_argument("--no-compile", action="store_true", help="faster start, slower frames")
    ap.add_argument("--send-fps", type=float, default=30.0, help="max frames/s sent to the browser")
    ap.add_argument("--jpeg-quality", type=int, default=80)
    return ap.parse_args()


def build_config(args) -> str:
    with open(os.path.join(FLUXRT_DIR, "configs", "config_with_reference.json"), encoding="utf-8") as f:
        cfg = json.load(f)
    cfg["default_prompt"] = DEFAULT_PROMPT
    cfg["use_reference_image"] = True
    if args.steps is not None:
        cfg["default_steps"] = args.steps
    if args.height is not None:
        cfg["resolution"]["height"] = args.height
    if args.width is not None:
        cfg["resolution"]["width"] = args.width
    if args.interp is not None:
        cfg["interpolation_exp"] = args.interp
    if args.int8:
        cfg["enable_int8_quantization"] = True
    if args.tiny_vae:
        cfg["enable_tiny_vae"] = True
    if args.no_compile:
        cfg["compile_models"] = False
    path = os.path.join(tempfile.gettempdir(), "live_tryon_config.json")
    with open(path, "w", encoding="utf-8") as f:
        json.dump(cfg, f, indent=2)
    print("config:", json.dumps({k: cfg[k] for k in ("default_steps", "resolution", "interpolation_exp",
                                                      "enable_int8_quantization", "enable_tiny_vae",
                                                      "compile_models")}))
    return path


class SysStats:
    """Once a second: GPU load (nvidia-smi), CPU use of this server and its model processes, and how many model
    engine processes exist (a leftover engine from an earlier run slows everything down)."""

    def __init__(self):
        self.values = {}
        self.gpu_name = None
        self._gpu_ok = True
        threading.Thread(target=self._loop, daemon=True).start()

    def _gpu(self):
        if not self._gpu_ok:
            return {}
        try:
            out = subprocess.run(
                ["nvidia-smi", "--query-gpu=name,utilization.gpu,clocks.sm,power.draw,memory.used,temperature.gpu",
                 "--format=csv,noheader,nounits"],
                capture_output=True, text=True, timeout=3,
            ).stdout.strip().splitlines()[0]
            name, util, clock, power, mem, temp = [x.strip() for x in out.split(",")]
            self.gpu_name = name
            return {"gpu_util": float(util), "gpu_clock_mhz": float(clock), "gpu_power_w": float(power),
                    "gpu_mem_mb": float(mem), "gpu_temp_c": float(temp)}
        except Exception:
            self._gpu_ok = False
            return {}

    def _loop(self):
        try:
            import psutil
        except Exception:
            psutil = None
        procs = {}
        n = 0
        while True:
            v = self._gpu()
            if psutil:
                try:
                    me = psutil.Process()
                    group = [me] + me.children(recursive=True)
                    total = 0.0
                    for pr in group:
                        if pr.pid not in procs:
                            procs[pr.pid] = pr
                            pr.cpu_percent(None)
                        total += procs[pr.pid].cpu_percent(None)
                    v["cpu_percent"] = round(total, 1)
                    v["server_child_procs"] = len(group) - 1
                    v["load_avg_1m"] = round(os.getloadavg()[0], 1) if hasattr(os, "getloadavg") else None
                    if n % 2 == 0:
                        v["spawn_procs"] = sum(
                            1 for pr in psutil.process_iter(["cmdline"])
                            if "spawn_main" in " ".join(pr.info.get("cmdline") or [])
                        )
                    else:
                        v["spawn_procs"] = self.values.get("spawn_procs")
                    v["cpu_count"] = psutil.cpu_count()
                except Exception:
                    pass
            self.values = v
            n += 1
            time.sleep(1.0)


class Live:
    """Thread-safe access to FluxRT's shared input/output tensors.

    Camera frames never queue: the network side drops each one into a single slot (replacing any older frame
    that has not been fed yet) and a feeder thread feeds only the newest.
    """

    def __init__(self, sp, crop):
        self.sp = sp
        self.crop = crop
        self.inp = sp.get_input_tensor()
        self.out = sp.get_output_tensor()
        r = sp.get_resolution()
        self.h, self.w = r["height"], r["width"]
        self.lock = threading.Lock()
        self.last_in_ts = 0.0
        self.busy = False
        self.frames_in = 0
        self.slot = None  # (jpeg, client_ts, arrival_time)
        self.slot_lock = threading.Lock()
        self.slot_event = threading.Event()
        self.dropped = 0
        self.feed_ms = 0.0
        self.read_ms = 0.0
        self.wait_ms = 0.0  # how long the newest fed frame sat in the slot

    def offer(self, jpeg: bytes, ts: float) -> None:
        with self.slot_lock:
            if self.slot is not None:
                self.dropped += 1
            self.slot = (jpeg, ts, time.perf_counter())
            self.slot_event.set()

    def feeder_loop(self, stop: threading.Event) -> None:
        while not stop.is_set():
            if not self.slot_event.wait(0.2):
                continue
            with self.slot_lock:
                item, self.slot = self.slot, None
                self.slot_event.clear()
            if item is None:
                continue
            jpeg, ts, arrived = item
            t = time.perf_counter()
            self.wait_ms = self.wait_ms * 0.8 + (t - arrived) * 1000 * 0.2
            try:
                self.feed(jpeg, ts)
            except Exception as e:  # one bad frame must not stop the session
                print("feed error:", e)
            self.feed_ms = self.feed_ms * 0.8 + (time.perf_counter() - t) * 1000 * 0.2

    def feed(self, jpeg: bytes, ts: float) -> None:
        frame = cv2.imdecode(np.frombuffer(jpeg, np.uint8), cv2.IMREAD_COLOR)  # BGR, as FluxRT expects
        if frame is None:
            return
        frame = self.crop(frame, self.h, self.w)
        if frame.shape[0] != self.h or frame.shape[1] != self.w:
            frame = cv2.resize(frame, (self.w, self.h), interpolation=cv2.INTER_AREA)
        with self.lock:
            self.inp.copy_from(np.ascontiguousarray(frame))
            self.last_in_ts = ts
        self.frames_in += 1

    def read(self):
        t = time.perf_counter()
        with self.lock:
            arr = self.out.to_numpy()
            ts = self.last_in_ts
        self.read_ms = self.read_ms * 0.8 + (time.perf_counter() - t) * 1000 * 0.2
        return arr, ts

    def set_garment(self, b64: str) -> None:
        raw = base64.b64decode(b64.split(",", 1)[-1])
        img = cv2.imdecode(np.frombuffer(raw, np.uint8), cv2.IMREAD_UNCHANGED)
        if img is None:
            raise ValueError("garment is not a readable image")
        if img.ndim == 3 and img.shape[2] == 4:  # cut-out: put it on white
            a = img[:, :, 3:4].astype(np.float32) / 255.0
            img = (img[:, :, :3].astype(np.float32) * a + 255.0 * (1 - a)).astype(np.uint8)
        rgb = cv2.cvtColor(img, cv2.COLOR_BGR2RGB)  # the Gradio demo passes RGB here
        self.sp.set_reference_image(rgb)


def main():
    args = parse_args()
    os.chdir(FLUXRT_DIR)  # FluxRT resolves model folders relative to its repo root
    sys.path.insert(0, FLUXRT_DIR)
    # torch.compile recompiles for every new input size; the default limit (8) is hit quickly here and
    # the model then falls back to slow uncompiled code. Raise it before the model is built.
    try:
        import torch._dynamo as _dynamo

        for _name in ("recompile_limit", "cache_size_limit"):
            if hasattr(_dynamo.config, _name):
                setattr(_dynamo.config, _name, 64)
    except Exception as e:  # keep running with defaults
        print("could not raise the torch.compile recompile limit:", e)
    from fluxrt import StreamProcessor
    from fluxrt.utils import crop_maximal_rectangle

    cfg_path = build_config(args)
    sp = StreamProcessor(cfg_path)
    if args.int8:
        sp.enable_quantization()
    t = time.time()
    sp.start()
    sp.set_prompt(DEFAULT_PROMPT)
    live = Live(sp, crop_maximal_rectangle)
    print(f"stream processor started in {time.time() - t:.1f}s at {live.w}x{live.h}")

    with open(cfg_path, encoding="utf-8") as f:
        cfg_used = json.load(f)
    sysstats = SysStats()
    interp_factor = 2 ** int(cfg_used.get("interpolation_exp") or 0)
    try:
        import torch

        torch_version = torch.__version__
    except Exception:
        torch_version = None
    info = {
        "server_args": vars(args),
        "steps": cfg_used.get("default_steps"),
        "resolution": cfg_used.get("resolution"),
        "interpolation_exp": cfg_used.get("interpolation_exp"),
        "interpolation_factor": interp_factor,
        "int8": cfg_used.get("enable_int8_quantization"),
        "tiny_vae": cfg_used.get("enable_tiny_vae"),
        "compile_models": cfg_used.get("compile_models"),
        "torch": torch_version,
        "python": platform.python_version(),
        "env_threads": {k: os.environ.get(k) for k in ("OMP_NUM_THREADS", "MKL_NUM_THREADS", "OPENCV_FOR_THREADS_NUM", "TORCHINDUCTOR_COMPILE_THREADS")},
        "started": time.strftime("%Y-%m-%dT%H:%M:%S"),
    }

    from fastapi import FastAPI, WebSocket
    from fastapi.middleware.cors import CORSMiddleware
    import uvicorn

    app = FastAPI(title="Fynd Studio live try-on")
    app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["GET"], allow_headers=["*"])

    @app.get("/health")
    async def health():
        return {"ok": True, "busy": live.busy, "width": live.w, "height": live.h}

    @app.websocket("/ws")
    async def ws(websocket: WebSocket):
        await websocket.accept()
        if TOKEN and websocket.query_params.get("token", "") != TOKEN:
            await websocket.send_text(json.dumps({"type": "error", "message": "Wrong or missing token"}))
            await websocket.close(code=4401)
            return
        if live.busy:
            await websocket.send_text(json.dumps({"type": "busy"}))
            await websocket.close(code=4409)
            return
        live.busy = True
        loop = asyncio.get_running_loop()
        stop = asyncio.Event()
        stop_thread = threading.Event()
        live.dropped = 0
        live.slot = None
        threading.Thread(target=live.feeder_loop, args=(stop_thread,), daemon=True).start()
        await websocket.send_text(json.dumps({"type": "ready", "width": live.w, "height": live.h,
                                              "info": {**info, "gpu_name": sysstats.gpu_name}}))

        async def sender():
            period = 1.0 / args.send_fps
            last_sig = None
            last_send = 0.0
            sent = 0
            in0 = live.frames_in
            t0 = time.perf_counter()
            while not stop.is_set():
                start = time.perf_counter()
                arr, ts = await loop.run_in_executor(None, live.read)
                sig = arr[::24, ::24].tobytes()
                if sig != last_sig or start - last_send > 0.5:  # skip unchanged frames, but keep-alive twice a second
                    last_sig = sig
                    last_send = start
                    ok, buf = cv2.imencode(".jpg", arr, [cv2.IMWRITE_JPEG_QUALITY, args.jpeg_quality])
                    if ok:
                        await websocket.send_bytes(struct.pack("<d", ts) + buf.tobytes())
                        sent += 1
                now = time.perf_counter()
                if now - t0 >= 1.0:
                    out_fps = round(sent / (now - t0), 1)
                    await websocket.send_text(json.dumps({
                        **sysstats.values,
                        "type": "stats",
                        "out_fps": out_fps,
                        "base_fps_est": round(out_fps / interp_factor, 1),
                        "in_fps": round((live.frames_in - in0) / (now - t0), 1),
                        "feed_ms": round(live.feed_ms),
                        "read_ms": round(live.read_ms),
                        "wait_ms": round(live.wait_ms),
                        "dropped": live.dropped,
                    }))
                    sent, in0, t0 = 0, live.frames_in, now
                # never hog the lock: rest at least 1.5x as long as the last read took, so camera frames always get a turn
                await asyncio.sleep(max(0.004, live.read_ms * 0.0015, period - (time.perf_counter() - start)))

        task = asyncio.create_task(sender())
        try:
            while True:
                msg = await websocket.receive()
                if msg["type"] == "websocket.disconnect":
                    break
                data = msg.get("bytes")
                if data and len(data) > 8:
                    ts = struct.unpack("<d", data[:8])[0]
                    live.offer(data[8:], ts)  # never waits: newest frame wins
                    continue
                text = msg.get("text")
                if not text:
                    continue
                m = json.loads(text)
                if m.get("type") == "ping":
                    await websocket.send_text(json.dumps({"type": "pong", "t": m.get("t")}))
                elif m.get("type") == "prompt":
                    sp.set_prompt(str(m.get("text") or DEFAULT_PROMPT)[:600])
                elif m.get("type") == "garment":
                    try:
                        await loop.run_in_executor(None, live.set_garment, m.get("image", ""))
                        await websocket.send_text(json.dumps({"type": "garment_ok"}))
                    except Exception as e:  # bad image from the client
                        await websocket.send_text(json.dumps({"type": "error", "message": str(e)}))
        except Exception as e:
            print("session ended:", e)
        finally:
            stop.set()
            stop_thread.set()
            task.cancel()
            live.busy = False

    uvicorn.run(app, host="0.0.0.0", port=args.port, ws_max_size=8 * 1024 * 1024)


if __name__ == "__main__":
    main()
