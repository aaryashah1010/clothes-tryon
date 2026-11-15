"""Modal endpoint: POST a garment photo, get back the flat garment picture and what kind of garment it is.

Deployment: create a Modal secret named "openai-key" (holds OPENAI_API_KEY) in the target workspace, then set TRYON_TOKEN in the shell:

    modal secret create openai-key OPENAI_API_KEY=... --env main
    set TRYON_TOKEN=...   then   modal deploy cloud_modal/prepare_garment.py --env main

Request:  POST /prepare   header X-Token: <token>   body = the picture's bytes (PNG, JPG or WebP)
Response: {"ok": true, "info": {...}, "image": "data:image/png;base64,..."}   or   {"ok": false, "error": "..."}
CPU only: the AI work happens at OpenAI, so no GPU is used or billed here.
"""
import hashlib
import os
import time

import modal

TOKEN = os.environ.get("TRYON_TOKEN", "")
PER_MINUTE = 6  # prepared pictures per person per minute (each one costs money)

app = modal.App("fynd-tryon-prep")
image = (
    modal.Image.debian_slim(python_version="3.12")
    .pip_install("fastapi[standard]==0.115.6")
    .add_local_file("cloud_modal/prep_core.py", "/root/prep_core.py")
)
cache = modal.Dict.from_name("fynd-prep-cache", create_if_missing=True)  # picture fingerprint -> finished answer


@app.function(
    image=image,
    secrets=[modal.Secret.from_name("openai-key"), modal.Secret.from_dict({"TRYON_TOKEN": TOKEN})],
    scaledown_window=120,
    timeout=400,
)
@modal.asgi_app()
def web():
    import base64

    from fastapi import FastAPI, Request
    from fastapi.middleware.cors import CORSMiddleware
    from fastapi.responses import JSONResponse

    import prep_core

    api = FastAPI()
    # the page and the Chrome extension call from other origins; the token is what protects the endpoint
    api.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["POST"], allow_headers=["X-Token", "Content-Type"])
    recent: dict[str, list[float]] = {}  # per container: caller -> times of recent requests

    def fail(msg: str, code: int) -> JSONResponse:
        return JSONResponse({"ok": False, "error": msg}, status_code=code)

    @api.post("/prepare")
    async def prepare(request: Request):
        token = os.environ.get("TRYON_TOKEN", "")
        if token and request.headers.get("x-token", "") != token:
            return fail("Wrong or missing access token.", 401)

        caller = request.client.host if request.client else "?"
        now = time.time()
        times = [t for t in recent.get(caller, []) if now - t < 60]
        if len(times) >= PER_MINUTE:
            return fail("Too many pictures in a minute. Wait a moment and try again.", 429)
        recent[caller] = times + [now]

        data = await request.body()
        try:
            prep_core.check_image(data)
        except prep_core.PrepError as e:
            return fail(str(e), 400)

        fingerprint = hashlib.sha256(data).hexdigest()
        hit = cache.get(fingerprint)
        if hit:
            return {"ok": True, **hit, "cached": True}
        try:
            out = prep_core.prepare(data, os.environ["OPENAI_API_KEY"])
        except prep_core.PrepError as e:
            return fail(str(e), 422)
        answer = {"info": out["info"], "image": "data:image/png;base64," + base64.b64encode(out["png"]).decode()}
        cache[fingerprint] = answer
        return {"ok": True, **answer}

    return api
