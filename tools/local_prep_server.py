"""Run the garment preparation service on THIS PC (no Modal, no secret). For testing the upload flow with a real photo.

    python tools/local_prep_server.py            # listens on http://127.0.0.1:8787, reads the key from tools/.env

Then open the page with  ?prep=http://127.0.0.1:8787/prepare  (see CONTEXT.md). It only listens on this PC (127.0.0.1),
so nobody else can use your key through it. Each new picture costs one vision call and one image call at OpenAI; the same
picture twice is answered from memory. Stop it with Ctrl+C.
"""
import base64
import hashlib
import json
import pathlib
import sys
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

HERE = pathlib.Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parent / "cloud_modal"))
import prep_core  # noqa: E402

PORT = 8787
CACHE: dict[str, dict] = {}


def load_key() -> str:
    for line in (HERE / ".env").read_text(encoding="utf-8").splitlines():
        if line.startswith("OPENAI_API_KEY="):
            return line.split("=", 1)[1].strip()
    return ""


KEY = load_key()


class Handler(BaseHTTPRequestHandler):
    def _cors(self) -> None:
        # the page runs on another local port, so the browser asks permission first
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "X-Token, Content-Type")

    def _json(self, code: int, body: dict) -> None:
        data = json.dumps(body).encode()
        self.send_response(code)
        self._cors()
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def do_OPTIONS(self) -> None:  # noqa: N802
        self.send_response(204)
        self._cors()
        self.end_headers()

    def do_POST(self) -> None:  # noqa: N802
        if self.path.split("?")[0] != "/prepare":
            return self._json(404, {"ok": False, "error": "Not found."})
        n = int(self.headers.get("Content-Length") or 0)
        if n > prep_core.MAX_BYTES:
            return self._json(400, {"ok": False, "error": "That picture is too large (8 MB at most)."})
        data = self.rfile.read(n)
        try:
            prep_core.check_image(data)
        except prep_core.PrepError as e:
            return self._json(400, {"ok": False, "error": str(e)})
        fp = hashlib.sha256(data).hexdigest()
        if fp in CACHE:
            print("cached answer for", fp[:8])
            return self._json(200, {"ok": True, **CACHE[fp], "cached": True})
        print(f"preparing {len(data) // 1024} KB picture {fp[:8]} ...", flush=True)
        try:
            out = prep_core.prepare(data, KEY)
        except prep_core.PrepError as e:
            print("refused:", e)
            return self._json(422, {"ok": False, "error": str(e)})
        answer = {"info": out["info"], "image": "data:image/png;base64," + base64.b64encode(out["png"]).decode()}
        CACHE[fp] = answer
        print("done:", out["info"])
        self._json(200, {"ok": True, **answer})

    def log_message(self, *args) -> None:  # keep the console quiet apart from our own lines
        pass


if __name__ == "__main__":
    if not KEY:
        sys.exit("No key found: paste it after OPENAI_API_KEY= in tools/.env")
    print(f"Garment preparation service on http://127.0.0.1:{PORT}/prepare  (Ctrl+C to stop)")
    ThreadingHTTPServer(("127.0.0.1", PORT), Handler).serve_forever()
