"""Garment preparation: any shop photo in, a flat picture of just the garment out, plus what kind of garment it is.

Pure Python (standard library only, no Modal), so it can be tested on a laptop and wrapped by prepare_garment.py.
Only the garment picture is sent to OpenAI: never a camera frame, never a photo of the user's body.
"""
import base64
import io
import json
import urllib.error
import urllib.request
import uuid

IMAGE_MODEL = "gpt-image-2"  # the edit model; gpt-image-1 is not on this account
VISION_MODEL = "gpt-5-mini"  # reads the picture and answers the garment questions
EDIT_URL = "https://api.openai.com/v1/images/edits"
CHAT_URL = "https://api.openai.com/v1/chat/completions"
MAX_BYTES = 8 * 1024 * 1024

FLAT_PROMPT = (
    "Show only {what} from this photo, as a product picture: laid flat, front view, centred, filling most of the frame, "
    "on a plain light grey background. Remove the person, the body, hands, hair, other clothes, accessories and the original "
    "background. Keep the exact colour, fabric, pattern, collar, buttons and any print of the garment. No shadow, no text, "
    "no mannequin."
)

# What the page needs to know about a garment; the same questions the chips ask by hand.
DESCRIBE_PROMPT = (
    "Look at this shopping photo. Pick the MAIN garment (the one the picture is selling; if there is a set, the top). "
    "Answer ONLY with JSON: "
    '{"wearable": true|false, "kind": "top"|"bottom", "name": "2-4 words, e.g. Maroon Formal Shirt", '
    '"sleeves": "short"|"long"|"none", "length": "full"|"midi"|"short", "hood": true|false, "pattern": true|false, '
    '"open_front": true|false}. '
    "wearable=false if the picture shows no wearable clothing. sleeves applies to tops, length to bottoms. "
    "pattern=true only for a regular check, plaid, gingham or stripe (not a one-off print). "
    "open_front=true for a blazer, jacket, waistcoat, cardigan or other garment worn open over a shirt."
)


class PrepError(Exception):
    """A problem to show the person (bad picture, the service said no)."""


def _post(url: str, key: str, body: bytes, content_type: str, timeout: int) -> dict:
    req = urllib.request.Request(url, data=body, headers={"Authorization": f"Bearer {key}", "Content-Type": content_type})
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            return json.load(r)
    except urllib.error.HTTPError as e:
        raise PrepError(f"The AI service refused the request ({e.code}).") from e
    except urllib.error.URLError as e:
        raise PrepError("The AI service could not be reached.") from e


def _multipart(fields: dict[str, str], png: bytes) -> tuple[bytes, str]:
    boundary = uuid.uuid4().hex
    out = io.BytesIO()
    for k, v in fields.items():
        out.write(f'--{boundary}\r\nContent-Disposition: form-data; name="{k}"\r\n\r\n{v}\r\n'.encode())
    out.write(f'--{boundary}\r\nContent-Disposition: form-data; name="image"; filename="in.png"\r\nContent-Type: image/png\r\n\r\n'.encode())
    out.write(png)
    out.write(f"\r\n--{boundary}--\r\n".encode())
    return out.getvalue(), boundary


def check_image(data: bytes) -> str:
    """The picture's real type from its first bytes (never trust the name or header); raises PrepError if it is not usable."""
    if len(data) > MAX_BYTES:
        raise PrepError("That picture is too large (8 MB at most).")
    if data[:8] == b"\x89PNG\r\n\x1a\n":
        return "image/png"
    if data[:3] == b"\xff\xd8\xff":
        return "image/jpeg"
    if data[:4] == b"RIFF" and data[8:12] == b"WEBP":
        return "image/webp"
    raise PrepError("That file is not a PNG, JPG or WebP picture.")


def describe(data: bytes, key: str) -> dict:
    """Ask the vision model what the garment is. Always returns every field, with safe defaults."""
    mime = check_image(data)
    url = f"data:{mime};base64,{base64.b64encode(data).decode()}"
    body = json.dumps(
        {
            "model": VISION_MODEL,
            "response_format": {"type": "json_object"},
            "messages": [
                {
                    "role": "user",
                    "content": [
                        {"type": "text", "text": DESCRIBE_PROMPT},
                        {"type": "image_url", "image_url": {"url": url}},
                    ],
                }
            ],
        }
    ).encode()
    res = _post(CHAT_URL, key, body, "application/json", 120)
    try:
        raw = json.loads(res["choices"][0]["message"]["content"])
    except (KeyError, IndexError, ValueError) as e:
        raise PrepError("Could not read what the garment is.") from e
    pick = lambda v, ok, d: v if v in ok else d
    return {
        "wearable": raw.get("wearable") is True,
        "kind": pick(raw.get("kind"), ("top", "bottom"), "top"),
        "name": str(raw.get("name") or "My clothing")[:40],
        "sleeves": pick(raw.get("sleeves"), ("short", "long", "none"), "short"),
        "length": pick(raw.get("length"), ("full", "midi", "short"), "full"),
        "hood": raw.get("hood") is True,
        "pattern": raw.get("pattern") is True,
        "open_front": raw.get("open_front") is True,
    }


def flatten(data: bytes, key: str, what: str) -> bytes:
    """The edit model: the garment alone, flat, on plain grey. Returns PNG bytes."""
    check_image(data)
    body, boundary = _multipart(
        {"model": IMAGE_MODEL, "prompt": FLAT_PROMPT.format(what=what), "size": "1024x1024", "n": "1"}, data
    )
    res = _post(EDIT_URL, key, body, f"multipart/form-data; boundary={boundary}", 300)
    try:
        return base64.b64decode(res["data"][0]["b64_json"])
    except (KeyError, IndexError, ValueError) as e:
        raise PrepError("The AI service returned no picture.") from e


def prepare(data: bytes, key: str) -> dict:
    """Whole job: what is it, then the flat picture. {'info': {...}, 'png': bytes}."""
    info = describe(data, key)
    if not info["wearable"]:
        raise PrepError("That picture doesn't show a piece of clothing we can use. Try a photo of the garment.")
    what = f"the {info['name'].lower()}" + (" (not the trousers or belt)" if info["kind"] == "top" else " (only the trousers/skirt, not the top)")
    return {"info": info, "png": flatten(data, key, what)}
