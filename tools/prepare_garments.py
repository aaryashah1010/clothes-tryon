"""Cut garment photos out of their white background and write the site's garment manifest.

Usage: python tools/prepare_garments.py
Reads  garments/flat-source/*.jpg
Writes site/public/garments/*.png and site/src/garments.json
"""
import json, os, sys
import numpy as np
from PIL import Image
from scipy import ndimage as ndi

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(ROOT, "garments", "flat-source")
OUT = os.path.join(ROOT, "site", "public", "garments")
MANIFEST = os.path.join(ROOT, "site", "src", "garments.json")
OVERRIDES = os.path.join(ROOT, "tools", "garment_overrides.json")
overrides = json.load(open(OVERRIDES, encoding="utf-8")) if os.path.exists(OVERRIDES) else {}

# file stem -> (id, display name, category, colour name)
ITEMS = {
    "Tshirts_38600_Yellow": ("tee-doodle-yellow", "Doodle Graphic Tee", "tops", "Yellow"),
    "Tshirts_38638_Black": ("tee-city-black", "City Crest Tee", "tops", "Black"),
    "Sweatshirts_15602_Black": ("sweatshirt-crew-black", "Everyday Crew Sweatshirt", "tops", "Black"),
    "Sweatshirts_13225_Blue": ("hoodie-varsity-blue", "Varsity Hoodie", "tops", "Blue"),
    "Sweaters_22625_Black": ("sweater-vneck-black", "Merino V-Neck Sweater", "tops", "Black"),
    "Jackets_14000_Blue": ("jacket-track-blue", "Track Jacket", "jackets", "Blue"),
    "Jackets_15322_Black": ("jacket-puffer-block", "Colour-Block Puffer", "jackets", "Black & Red"),
    "Jackets_15603_Black": ("jacket-sport-black", "Sport Zip Jacket", "jackets", "Black"),
    "Jackets_4461_Black": ("jacket-club-brown", "Club Track Jacket", "jackets", "Brown"),
    "Jackets_28540_Red": ("jacket-wind-red", "Hooded Windbreaker", "jackets", "Red"),
    "Jackets_15323_Grey": ("jacket-puffer-grey", "Grey Puffer Jacket", "jackets", "Grey"),
    "Jackets_18201_Olive": ("jacket-puffer-olive", "Olive & Cyan Puffer", "jackets", "Olive"),
    "0014_blazer_green": ("blazer-sage", "Sage Wrap Blazer", "jackets", "Green"),
    "0033_blazer_beige": ("blazer-sand", "Sand Belted Blazer", "jackets", "Beige"),
    "0047_sweater_pattern_logo": ("sweater-crop-monogram", "Cropped Monogram Sweater", "tops", "Brown"),
    # women's tops, made with our own FLUX.2-klein-4B (cloud_modal/generate_garments.py)
    "w_tee-pink-flower": ("w-tee-pink-flower", "Pink Flower Tee", "tops", "Pink"),
    "w_tee-black-vneck": ("w-tee-black-vneck", "Black V-Neck Tee", "tops", "Black"),
    "w_tee-sage-sun": ("w-tee-sage-sun", "Sage Sun Tee", "tops", "Green"),
    "w_tee-cream-stripe": ("w-tee-cream-stripe", "Breton Stripe Tee", "tops", "Cream & Navy"),
    "w_sweatshirt-grey-crew": ("w-sweatshirt-grey", "Grey Crew Sweatshirt", "tops", "Grey"),
    "w_sweatshirt-mustard": ("w-sweatshirt-mustard", "Mustard Stripe Sweatshirt", "tops", "Mustard"),
    "w_hoodie-lavender": ("w-hoodie-lavender", "Lavender Hoodie", "tops", "Lavender"),
    "w_hoodie-navy-zip": ("w-hoodie-navy-zip", "Navy Zip Hoodie", "tops", "Navy"),
    "w_sweater-beige-knit": ("w-sweater-beige", "Beige Knit Sweater", "tops", "Beige"),
    "w_top-red-ribbed": ("w-top-red-ribbed", "Red Ribbed Top", "tops", "Red"),
    "w_top-lightblue-shirt": ("w-top-blue-shirt", "Light Blue Shirt", "tops", "Light Blue"),
}

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from catalog_spec import NEW_ITEMS  # generated items: garments/flat-source/<id>.jpg

# gender and category of the first 26 garments (the filter on the page uses these)
OLD_TAGS = {
    "tee-doodle-yellow": ("men", "tshirts"), "tee-city-black": ("men", "tshirts"),
    "sweatshirt-crew-black": ("men", "sweats"), "hoodie-varsity-blue": ("men", "sweats"),
    "sweater-vneck-black": ("men", "sweats"),
    "jacket-track-blue": ("men", "jackets"), "jacket-puffer-block": ("men", "jackets"),
    "jacket-sport-black": ("men", "jackets"), "jacket-club-brown": ("men", "jackets"),
    "jacket-wind-red": ("men", "jackets"), "jacket-puffer-grey": ("men", "jackets"),
    "jacket-puffer-olive": ("men", "jackets"),
    "blazer-sage": ("women", "formal"), "blazer-sand": ("women", "formal"),
    "sweater-crop-monogram": ("women", "sweats"),
    "w-tee-pink-flower": ("women", "tshirts"), "w-tee-black-vneck": ("women", "tshirts"),
    "w-tee-sage-sun": ("women", "tshirts"), "w-tee-cream-stripe": ("women", "tshirts"),
    "w-sweatshirt-grey": ("women", "sweats"), "w-sweatshirt-mustard": ("women", "sweats"),
    "w-hoodie-lavender": ("women", "sweats"), "w-hoodie-navy-zip": ("women", "sweats"),
    "w-sweater-beige": ("women", "sweats"), "w-top-red-ribbed": ("women", "tshirts"),
    "w-top-blue-shirt": ("women", "shirts"),
}
def guess_sleeves(gid, category, what=""):
    """long / short / none, from the category and the picture description (tops only)."""
    w = what.lower()
    if category == "bottoms":
        return None
    if "sleeveless" in w or "waistcoat" in gid:
        return "none"
    if category in ("jackets", "sweats") or "long sleeve" in w or "long-sleeve" in w:
        return "long"
    if any(k in gid for k in ("blazer", "formal", "blouse", "sweater", "shirt", "ribbed", "knit")) and "tee" not in gid:
        return "long"
    return "short"


jobs = [(stem, gid, name, cat, colour, "", *OLD_TAGS[gid], "") for stem, (gid, name, cat, colour) in ITEMS.items()]
for gid, gender, category, name, colour, _what, backdrop in NEW_ITEMS:
    if os.path.exists(os.path.join(SRC, gid + ".jpg")):
        jobs.append((gid, gid, name, category, colour, backdrop, gender, category, _what))

os.makedirs(OUT, exist_ok=True)
manifest = []
for stem, gid, name, cat, colour, backdrop, gender, category, what in jobs:
    im = Image.open(os.path.join(SRC, stem + ".jpg")).convert("RGB")
    a = np.asarray(im).astype(np.int16)
    if backdrop == "grey":  # white garments: key out the plain grey backdrop instead of white
        corners = np.concatenate([a[:24, :24].reshape(-1, 3), a[:24, -24:].reshape(-1, 3), a[-24:, :24].reshape(-1, 3), a[-24:, -24:].reshape(-1, 3)])
        bg_col = np.median(corners, axis=0)
        near_white = np.abs(a - bg_col).max(axis=2) < 34
    else:
        near_white = a.min(axis=2) > 236
    lab, n = ndi.label(near_white)
    border = set(np.unique(np.concatenate([lab[0], lab[-1], lab[:, 0], lab[:, -1]]))) - {0}
    bg = np.isin(lab, list(border))
    fg = ~bg
    fg = ndi.binary_opening(fg, iterations=4 if backdrop == "grey" else 1)  # grey backdrops leave thin bridges to vignette patches
    lab2, n2 = ndi.label(fg)
    if n2 > 1:  # keep the biggest blob only
        sizes = ndi.sum(fg, lab2, range(1, n2 + 1))
        fg = lab2 == (1 + int(np.argmax(sizes)))
    fg = ndi.binary_erosion(fg, iterations=1)
    alpha = ndi.gaussian_filter(fg.astype(np.float32), 0.8)
    alpha = np.clip((alpha - 0.2) / 0.6, 0, 1)
    ys, xs = np.where(fg)
    pad = int(0.02 * max(fg.shape))
    y0, y1 = max(ys.min() - pad, 0), min(ys.max() + pad + 1, fg.shape[0])
    x0, x1 = max(xs.min() - pad, 0), min(xs.max() + pad + 1, fg.shape[1])
    rgba = np.dstack([np.asarray(im), (alpha * 255).astype(np.uint8)])[y0:y1, x0:x1]
    out = Image.fromarray(rgba, "RGBA")
    scale = 1000 / max(out.size)
    if scale < 1:
        out = out.resize((round(out.width * scale), round(out.height * scale)), Image.LANCZOS)
    H, W = out.height, out.width
    mask = np.asarray(out)[:, :, 3] > 128
    widths = np.array([ (np.where(r)[0].max() - np.where(r)[0].min() + 1) if r.any() else 0 for r in mask ])
    maxw = widths.max()
    sh_y = int(np.argmax(widths >= 0.62 * maxw))
    sh_y = min(sh_y + int(0.025 * H), H - 1)
    left = int(np.where(mask[sh_y])[0].min()); right = int(np.where(mask[sh_y])[0].max())
    rgb = np.asarray(out)[:, :, :3][mask]
    manifest.append({
        "id": gid, "name": name, "category": category, "gender": gender, "colour": colour,
        "file": f"garments/{gid}.png", "width": W, "height": H,
        "shoulderY": round(sh_y / H, 4),
        "shoulderLeft": round(left / W, 4), "shoulderRight": round(right / W, 4),
        "swatch": "#%02x%02x%02x" % tuple(int(v) for v in rgb.mean(axis=0)),
    })
    if category == "bottoms":
        manifest[-1]["length"] = "midi" if "culotte" in what.lower() else "full"
    sl = guess_sleeves(gid, category, what)
    if sl:
        manifest[-1]["sleeves"] = sl
    manifest[-1].update(overrides.get(gid, {}))  # hand-tuned shoulder points win over the estimate
    entry = manifest[-1]
    xl, xr, ys = entry["shoulderLeft"] * W, entry["shoulderRight"] * W, entry["shoulderY"] * H
    span = xr - xl
    cxg = (xl + xr) / 2
    # Same constants as the site: BASE_FIT 1.42 and the 0.12 lift, expressed in garment pixels.
    jx, jy = 0.5 / 1.42 * span, ys + 0.12 / 1.42 * span
    pivots = {"L": (cxg - jx, jy), "R": (cxg + jx, jy)}
    # Torso edges from a low row, where sleeves hang apart from the body.
    r1 = min(int(ys + 0.72 * (H - ys)), H - 1)
    row = mask[r1]
    runs, start_x = [], None
    for x in range(W + 1):
        on = x < W and row[x]
        if on and start_x is None:
            start_x = x
        if not on and start_x is not None:
            if x - start_x > 0.02 * W:
                runs.append((start_x, x - 1))
            start_x = None
    torso = next((r for r in runs if r[0] <= cxg <= r[1]), None)
    yy, xx = np.mgrid[0:H, 0:W]
    entry["sleeveL"] = entry["sleeveR"] = None
    if torso and len(runs) >= 3 and (torso[1] - torso[0]) > 0.3 * W:
        for side, split in (("L", torso[0]), ("R", torso[1])):
            has_neighbour = any(r[1] < torso[0] for r in runs) if side == "L" else any(r[0] > torso[1] for r in runs)
            if not has_neighbour:
                continue
            region = mask & ((xx < split) if side == "L" else (xx > split)) & (yy > jy)
            if region.sum() < 0.03 * mask.sum():
                continue
            piv = pivots[side]
            ry, rx = np.where(region)
            d = np.hypot(rx - piv[0], ry - piv[1])
            far = d >= np.quantile(d, 0.93)  # the cuff end
            ang = float(np.arctan2(ry[far].mean() - piv[1], rx[far].mean() - piv[0]))
            entry["sleeve" + side] = {"angle": round(ang, 4), "split": round(split / W, 4)}
    out.save(os.path.join(OUT, gid + ".png"), optimize=True)
    print(gid, out.size, "shoulderY", round(sh_y / H, 3), "span", round((right - left) / W, 3))

with open(MANIFEST, "w", encoding="utf-8") as f:
    json.dump(manifest, f, indent=2)
print("wrote", len(manifest), "garments")
