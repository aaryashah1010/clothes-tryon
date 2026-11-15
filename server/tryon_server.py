"""Realistic AI try-on server. Runs on the GPU machine (the Runpod pod).

Start (inside the fluxrt conda env):
    TRYON_TOKEN=choose-a-secret python tryon_server.py

Endpoints
    GET  /health               -> {"ok": true, "model_loaded": true}
    POST /tryon  (multipart)   -> image/png
        person  : the shopper's photo (jpg/png)
        garment : the garment picture (png with transparency, or jpg)
        steps   : optional, default 4

Photos are processed in memory and never written to disk.
"""
import asyncio
import io
import os
import time
from contextlib import asynccontextmanager

import torch
from diffusers import Flux2KleinPipeline
from fastapi import FastAPI, File, Form, Header, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import Response
from PIL import Image, ImageOps

MODEL = os.environ.get("TRYON_MODEL", "/workspace/FluxRT/FLUX.2-klein-4B")
TOKEN = os.environ.get("TRYON_TOKEN", "")
PORT = int(os.environ.get("PORT", "7860"))
MAX_UPLOAD = 12 * 1024 * 1024
PERSON_SIDE = 1024
GARMENT_SIDE = 768

PROMPT = (
    "Dress the person from the first image in the garment shown in the second image. "
    "Keep the person's face, glasses, hair, skin, body shape, pose and background exactly the same. "
    "Only the clothing changes, and it should look like a real photo of the person wearing that garment."
)

state: dict = {"pipe": None}
gpu_lock = asyncio.Lock()  # one try-on at a time; the rest wait their turn


def fit(im: Image.Image, longest: int) -> Image.Image:
    s = longest / max(im.size)
    w, h = round(im.width * s / 16) * 16, round(im.height * s / 16) * 16
    return im.resize((max(w, 16), max(h, 16)), Image.LANCZOS)


def on_white(im: Image.Image) -> Image.Image:
    im = im.convert("RGBA")
    bg = Image.new("RGBA", im.size, (255, 255, 255, 255))
    bg.alpha_composite(im)
    return bg.convert("RGB")


def load_pipe() -> Flux2KleinPipeline:
    pipe = Flux2KleinPipeline.from_pretrained(MODEL, torch_dtype=torch.bfloat16)
    if os.environ.get("TRYON_OFFLOAD") == "1":
        # sharing the GPU with the live server: keep only the part in use on the GPU (a little slower)
        pipe.enable_model_cpu_offload()
        return pipe
    try:
        pipe.to("cuda")
    except torch.cuda.OutOfMemoryError:
        pipe.enable_model_cpu_offload()
    return pipe


def run_tryon(person: Image.Image, garment: Image.Image, steps: int) -> Image.Image:
    pipe = state["pipe"]
    try:
        return pipe(
            image=[person, garment],
            prompt=PROMPT,
            height=person.height,
            width=person.width,
            guidance_scale=1.0,
            num_inference_steps=steps,
            generator=torch.Generator(device="cuda").manual_seed(0),
        ).images[0]
    finally:
        torch.cuda.empty_cache()  # give the memory back to the live server between photos


@asynccontextmanager
async def lifespan(_: FastAPI):
    t = time.time()
    state["pipe"] = await asyncio.get_running_loop().run_in_executor(None, load_pipe)
    print(f"model loaded in {time.time() - t:.1f}s")
    yield


app = FastAPI(title="Fynd Studio try-on", lifespan=lifespan)
app.add_middleware(
    CORSMiddleware,
    allow_origins=os.environ.get("TRYON_ORIGINS", "*").split(","),
    allow_methods=["GET", "POST"],
    allow_headers=["*"],
)


def check_token(x_token: str | None) -> None:
    if TOKEN and x_token != TOKEN:
        raise HTTPException(status_code=401, detail="Wrong or missing token")


@app.get("/health")
async def health():
    return {"ok": True, "model_loaded": state["pipe"] is not None}


async def read_image(f: UploadFile, what: str) -> Image.Image:
    data = await f.read()
    if len(data) > MAX_UPLOAD:
        raise HTTPException(status_code=413, detail=f"{what} is too large")
    try:
        im = Image.open(io.BytesIO(data))
        return ImageOps.exif_transpose(im)
    except Exception:
        raise HTTPException(status_code=400, detail=f"{what} is not a readable image")


@app.post("/tryon")
async def tryon(
    person: UploadFile = File(...),
    garment: UploadFile = File(...),
    steps: int = Form(4),
    x_token: str | None = Header(default=None),
):
    check_token(x_token)
    if state["pipe"] is None:
        raise HTTPException(status_code=503, detail="Model is still loading")
    steps = min(max(steps, 1), 8)
    p = fit(on_white(await read_image(person, "photo")), PERSON_SIDE)
    g = fit(on_white(await read_image(garment, "garment")), GARMENT_SIDE)
    async with gpu_lock:
        t = time.time()
        out = await asyncio.get_running_loop().run_in_executor(None, run_tryon, p, g, steps)
        print(f"try-on {p.size} in {time.time() - t:.1f}s")
    buf = io.BytesIO()
    out.save(buf, format="PNG")
    return Response(buf.getvalue(), media_type="image/png", headers={"Cache-Control": "no-store"})


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(app, host="0.0.0.0", port=PORT)
