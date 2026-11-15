"""Wake a freshly deployed live server so the first real visitor doesn't wait.

The first start compiles the model (several minutes); the engine then loads on the first client connection (about 25 s).
This connects like a browser would, sends a moving test picture for a few seconds, and prints the result.

    pip install websockets opencv-python numpy
    python tools/warm_up.py <host> <token> [seconds]
    e.g. python tools/warm_up.py texel--fynd-tryon-pt-live.ap-south.modal.run fynd-BhJE8b2a 12

It retries for up to ~10 minutes while the server is still starting. Success looks like:  "... | first frame after N s | frames M" with M > 0.
Run from the clothes_tryon folder. It sends no personal data: only a grey picture with a moving circle.
"""
import asyncio
import json
import base64
import pathlib
import ssl
import struct
import sys
import time

import cv2
import numpy as np
import websockets

ROOT = pathlib.Path(__file__).resolve().parent.parent
GARMENT = (ROOT / "site" / "public" / "garments" / "tee-doodle-yellow.png").read_bytes()


def frame(t: float) -> bytes:
    img = np.full((320, 576, 3), 90, np.uint8)
    cv2.circle(img, (int(288 + 150 * np.sin(t * 2)), 160), 60, (40, 90, 200), -1)
    return cv2.imencode(".jpg", img)[1].tobytes()


def tls_context() -> ssl.SSLContext:
    """Verify the server's certificate with certifi's list (some Windows Pythons cannot find the system's)."""
    try:
        import certifi

        return ssl.create_default_context(cafile=certifi.where())
    except ImportError:
        return ssl.create_default_context()


async def once(host: str, token: str, secs: float) -> None:
    url = f"wss://{host}/ws?token={token}&sid=warm"
    async with websockets.connect(
        url, ssl=tls_context(), max_size=None, open_timeout=600, ping_interval=None, ping_timeout=None
    ) as ws:
        await ws.send(json.dumps({"type": "garment", "image": base64.b64encode(GARMENT).decode()}))
        t0 = time.time()
        frames, first, size = 0, None, None

        async def send() -> None:
            while time.time() - t0 < secs:
                await ws.send(struct.pack("<d", time.time() * 1000) + frame(time.time() - t0))
                await asyncio.sleep(0.05)

        task = asyncio.create_task(send())
        while time.time() - t0 < secs + 2:
            try:
                m = await asyncio.wait_for(ws.recv(), 2)
            except asyncio.TimeoutError:
                continue
            if isinstance(m, bytes):
                frames += 1
                first = first if first is not None else time.time() - t0
            else:
                j = json.loads(m)
                if j.get("type") == "ready":
                    size = (j.get("width"), j.get("height"))
        await task
        print(host.split(".")[0], "| size", size, "| first frame after", None if first is None else round(first, 1), "s | frames", frames)
        if frames == 0:
            raise RuntimeError("connected but no frames yet")


async def main() -> None:
    host, token = sys.argv[1], sys.argv[2]
    secs = float(sys.argv[3]) if len(sys.argv) > 3 else 12
    for attempt in range(1, 31):
        try:
            await once(host, token, secs)
            return
        except Exception as e:  # still starting: handshake errors and timeouts are normal for the first minutes
            print(f"attempt {attempt}: not ready yet ({type(e).__name__}); retrying in 20 s")
            await asyncio.sleep(20)
    sys.exit("Gave up after ~10 minutes. Check: modal app logs <app-name>")


asyncio.run(main())
