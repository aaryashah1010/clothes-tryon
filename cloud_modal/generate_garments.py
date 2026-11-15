"""Makes catalog garment pictures with our own FLUX.2-klein-4B (Apache 2.0, text to image): no photos taken from shops.

    modal run cloud_modal/generate_garments.py                     # every item in tools/catalog_spec.py, 3 tries each
    modal run cloud_modal/generate_garments.py --only m-tee-white  # just some (comma separated ids)

Pictures go to garments/generated/<id>_s<seed>.jpg. Pick the good ones by eye, copy them to garments/flat-source/<id>.jpg
and run tools/prepare_garments.py.
"""
import io
import pathlib
import sys

import modal

ROOT = pathlib.Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "tools"))
MODEL = "/models/FLUX.2-klein-4B"  # the same Volume the live server uses

app = modal.App("fynd-tryon-gen")
models = modal.Volume.from_name("fynd-tryon-models")
image = (
    modal.Image.debian_slim(python_version="3.12")
    .pip_install("torch", "torchvision", index_url="https://download.pytorch.org/whl/cu128")
    .apt_install("git")
    .pip_install("git+https://github.com/huggingface/diffusers.git")
    .pip_install("transformers", "accelerate", "sentencepiece", "protobuf", "safetensors")
)

STYLE = (
    "Flat lay product photo of {what}, laid flat on a table and photographed from directly above, centred, the whole "
    "garment visible with the sleeves spread naturally, isolated on {bg}, soft studio light, sharp fabric detail and "
    "crisp, correctly spelled lettering where there is any. No mannequin, no neck piece, no person, no hanger."
)
BOTTOM_STYLE = (
    "Flat lay product photo of {what}, laid flat on a table and photographed from directly above, waistband at the top, "
    "both legs straight and fully visible, centred, isolated on {bg}, soft studio light, sharp fabric detail. "
    "No mannequin, no person, no hanger, no belt, no text."
)
BACKDROPS = {"": "a pure white background", "grey": "a plain solid medium grey (#9a9a9a) background"}


@app.function(image=image, gpu="L40S", volumes={"/models": models}, timeout=3600)
def generate(items: list[tuple[str, str, str, str]], seeds: tuple[int, ...]) -> dict[str, bytes]:
    """items: (id, picture description, backdrop key, category)"""
    import torch
    from diffusers import Flux2KleinPipeline

    pipe = Flux2KleinPipeline.from_pretrained(MODEL, torch_dtype=torch.bfloat16).to("cuda")
    out: dict[str, bytes] = {}
    for gid, what, backdrop, category in items:
        for seed in seeds:
            im = pipe(
                prompt=(BOTTOM_STYLE if category == "bottoms" else STYLE).format(what=what, bg=BACKDROPS[backdrop]),
                height=1024,
                width=1024,
                guidance_scale=1.0,
                num_inference_steps=4,
                generator=torch.Generator(device="cuda").manual_seed(seed),
            ).images[0]
            buf = io.BytesIO()
            im.convert("RGB").save(buf, "JPEG", quality=95)
            out[f"{gid}_s{seed}.jpg"] = buf.getvalue()
            print("made", gid, seed, flush=True)
    return out


@app.local_entrypoint()
def main(only: str = "", seeds: int = 3):
    from catalog_spec import NEW_ITEMS

    wanted = set(only.split(",")) if only else None
    items = [(i[0], i[5], i[6], i[2]) for i in NEW_ITEMS if not wanted or i[0] in wanted]
    dest = ROOT / "garments" / "generated"
    dest.mkdir(parents=True, exist_ok=True)
    for name, data in generate.remote(items, tuple(range(seeds))).items():
        (dest / name).write_bytes(data)
    print("saved", len(items) * seeds, "pictures to", dest)
