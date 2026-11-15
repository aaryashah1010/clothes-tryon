"""Realistic AI try-on for still photos (runs on the GPU pod).

Usage (inside the fluxrt conda env):
    python tryon_still.py --person img3.png --garments flat-source --out results [--steps 4]

Every garment image in --garments is tried on --person. Prints seconds per image.
"""
import argparse
import glob
import os
import time

import torch
from diffusers import Flux2KleinPipeline
from PIL import Image

MODEL = "/workspace/FluxRT/FLUX.2-klein-4B"
PROMPT = (
    "Dress the person from the first image in the garment shown in the second image. "
    "Keep the person's face, glasses, hair, skin, body shape, pose and background exactly the same. "
    "Only the clothing changes, and it should look like a real photo of the person wearing that garment."
)


def fit(im: Image.Image, longest: int) -> Image.Image:
    s = longest / max(im.size)
    w, h = round(im.width * s / 16) * 16, round(im.height * s / 16) * 16
    return im.resize((max(w, 16), max(h, 16)), Image.LANCZOS)


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--person", required=True)
    ap.add_argument("--garments", required=True, help="folder of garment images")
    ap.add_argument("--out", default="results")
    ap.add_argument("--steps", type=int, default=4)
    ap.add_argument("--size", type=int, default=1024, help="longest side of the result")
    ap.add_argument("--seed", type=int, default=0)
    ap.add_argument("--prompt", default=PROMPT)
    args = ap.parse_args()

    os.makedirs(args.out, exist_ok=True)
    t0 = time.time()
    pipe = Flux2KleinPipeline.from_pretrained(MODEL, torch_dtype=torch.bfloat16)
    try:
        pipe.to("cuda")
    except torch.cuda.OutOfMemoryError:
        pipe.enable_model_cpu_offload()
    print(f"model loaded in {time.time() - t0:.1f}s")

    person = fit(Image.open(args.person).convert("RGB"), args.size)
    files = sorted(
        f for ext in ("*.jpg", "*.jpeg", "*.png") for f in glob.glob(os.path.join(args.garments, ext))
    )
    pname = os.path.splitext(os.path.basename(args.person))[0]
    for i, f in enumerate(files):
        garment = fit(Image.open(f).convert("RGB"), 768)
        t = time.time()
        img = pipe(
            image=[person, garment],
            prompt=args.prompt,
            height=person.height,
            width=person.width,
            guidance_scale=1.0,
            num_inference_steps=args.steps,
            generator=torch.Generator(device="cuda").manual_seed(args.seed),
        ).images[0]
        dt = time.time() - t
        name = os.path.splitext(os.path.basename(f))[0]
        # person | garment | result, for easy comparison
        sheet = Image.new("RGB", (person.width + garment.width * person.height // garment.height + img.width, person.height), "white")
        g2 = garment.resize((garment.width * person.height // garment.height, person.height))
        sheet.paste(person, (0, 0))
        sheet.paste(g2, (person.width, 0))
        sheet.paste(img, (person.width + g2.width, 0))
        sheet.save(os.path.join(args.out, f"{pname}__{name}__compare.jpg"), quality=90)
        img.save(os.path.join(args.out, f"{pname}__{name}.png"))
        print(f"[{i + 1}/{len(files)}] {name}: {dt:.1f}s  peak VRAM {torch.cuda.max_memory_allocated() / 1e9:.1f} GB")


if __name__ == "__main__":
    main()
