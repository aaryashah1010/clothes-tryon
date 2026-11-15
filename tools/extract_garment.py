"""Test: send ONE garment picture to an image-edit API and save the flat picture of just that garment.

    python tools/extract_garment.py INPUT.png OUTPUT.png "the maroon shirt" [--crop x0,y0,x1,y1]

Reads OPENAI_API_KEY from tools/.env. Only the garment picture is sent: crop away anything else (browser, names, addresses)
first, either with --crop or beforehand. The key is never printed.
"""
import base64
import io
import json
import sys
import urllib.error
import urllib.request
import uuid
from pathlib import Path

MODEL = "gpt-image-2"  # gpt-image-1 is not on this account; gpt-image-2 is
URL = "https://api.openai.com/v1/images/edits"

PROMPT = (
    "Show only {what} from this photo, as a product picture: laid flat, front view, centred, filling most of the frame, "
    "on a plain light grey background. Remove the person, the body, hands, hair, other clothes, accessories and the original "
    "background. Keep the exact colour, fabric, pattern, collar, buttons and any print of the garment. No shadow, no text, "
    "no mannequin."
)


def load_key() -> str:
    for line in (Path(__file__).parent / ".env").read_text(encoding="utf-8").splitlines():
        if line.startswith("OPENAI_API_KEY="):
            return line.split("=", 1)[1].strip()
    return ""


def multipart(fields: dict[str, str], file_name: str, file_bytes: bytes) -> tuple[bytes, str]:
    boundary = uuid.uuid4().hex
    out = io.BytesIO()
    for k, v in fields.items():
        out.write(f'--{boundary}\r\nContent-Disposition: form-data; name="{k}"\r\n\r\n{v}\r\n'.encode())
    out.write(
        f'--{boundary}\r\nContent-Disposition: form-data; name="image"; filename="{file_name}"\r\n'
        f"Content-Type: image/png\r\n\r\n".encode()
    )
    out.write(file_bytes)
    out.write(f"\r\n--{boundary}--\r\n".encode())
    return out.getvalue(), boundary


def main() -> None:
    args = sys.argv[1:]
    crop = None
    if "--crop" in args:
        i = args.index("--crop")
        crop = tuple(int(v) for v in args[i + 1].split(","))
        del args[i : i + 2]
    if len(args) != 3:
        sys.exit(__doc__)
    src, dst, what = args

    key = load_key()
    if not key:
        sys.exit("No key found: paste it after OPENAI_API_KEY= in tools/.env")

    data = Path(src).read_bytes()
    if crop:
        from PIL import Image

        im = Image.open(io.BytesIO(data)).convert("RGB").crop(crop)
        buf = io.BytesIO()
        im.save(buf, "PNG")
        data = buf.getvalue()
        Path(dst).with_suffix(".input.png").write_bytes(data)  # what was actually sent, for you to check

    body, boundary = multipart({"model": MODEL, "prompt": PROMPT.format(what=what), "size": "1024x1024", "n": "1"}, "in.png", data)
    req = urllib.request.Request(
        URL, data=body, headers={"Authorization": f"Bearer {key}", "Content-Type": f"multipart/form-data; boundary={boundary}"}
    )
    try:
        with urllib.request.urlopen(req, timeout=300) as r:
            res = json.load(r)
    except urllib.error.HTTPError as e:
        sys.exit(f"API error {e.code}: {e.read().decode()[:500]}")
    Path(dst).write_bytes(base64.b64decode(res["data"][0]["b64_json"]))
    print("saved", dst, "usage:", res.get("usage"))


if __name__ == "__main__":
    main()
