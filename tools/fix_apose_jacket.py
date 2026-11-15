"""Repair Apose_Jacket.glb (a script-generated garment) so it works in the try-on page.

Fixes
  1. The scene never reached the mesh node (JacketRoot listed the right hand instead of JacketMesh).
  2. The skeleton's joints were nowhere near the sleeves they control, so any arm rotation would swing
     the sleeve about a point over a metre away. Joints are moved to the real shoulder and elbow positions
     and the inverse bind matrices are rewritten to match.

The original file is never modified.

Usage: python tools/fix_apose_jacket.py <in.glb> <out.glb>
"""
import json
import struct
import sys

import numpy as np

# Joint positions in model space (metres), measured from the mesh. "Left" is the model's x < 0 side.
WORLD = {
    "Root": (0.0, 0.90, 0.0),
    "Spine": (0.0, 1.20, 0.0),
    "LeftShoulder": (-0.245, 1.50, 0.0),
    "LeftArm": (-0.290, 1.46, 0.0),
    "LeftForeArm": (-0.653, 1.182, 0.0),
    "LeftHand": (-0.850, 1.020, 0.0),
}
for k in ("Shoulder", "Arm", "ForeArm", "Hand"):
    x, y, z = WORLD["Left" + k]
    WORLD["Right" + k] = (-x, y, z)

JSON_CHUNK, BIN_CHUNK = 0x4E4F534A, 0x004E4942


def read_glb(path):
    data = open(path, "rb").read()
    if data[:4] != b"glTF":
        raise SystemExit("not a GLB file")
    off, js, binc = 12, None, None
    while off < len(data):
        n, t = struct.unpack("<II", data[off : off + 8])
        chunk = data[off + 8 : off + 8 + n]
        if t == JSON_CHUNK:
            js = json.loads(chunk)
        elif t == BIN_CHUNK:
            binc = bytearray(chunk)
        off += 8 + n
    return js, binc


def write_glb(path, js, binc):
    body = json.dumps(js, separators=(",", ":")).encode()
    body += b" " * (-len(body) % 4)
    binb = bytes(binc) + b"\0" * (-len(binc) % 4)
    total = 12 + 8 + len(body) + 8 + len(binb)
    with open(path, "wb") as f:
        f.write(struct.pack("<4sII", b"glTF", 2, total))
        f.write(struct.pack("<II", len(body), JSON_CHUNK) + body)
        f.write(struct.pack("<II", len(binb), BIN_CHUNK) + binb)


def main(src, dst):
    g, binc = read_glb(src)
    nodes = g["nodes"]
    by_name = {n["name"]: i for i, n in enumerate(nodes)}
    parent = {c: i for i, n in enumerate(nodes) for c in n.get("children", [])}

    # 1. make sure the mesh node is reachable: it hangs off JacketRoot next to the skeleton root
    root = nodes[by_name["JacketRoot"]]
    mesh_node = by_name["JacketMesh"]
    root["children"] = [by_name["Root"], mesh_node]
    parent = {c: i for i, n in enumerate(nodes) for c in n.get("children", [])}

    # 2. joints: local translation = world position minus parent world position
    for name, pos in WORLD.items():
        i = by_name[name]
        p = parent.get(i)
        parent_pos = np.array(WORLD[nodes[p]["name"]]) if p is not None and nodes[p]["name"] in WORLD else np.zeros(3)
        nodes[i]["translation"] = [round(float(v), 5) for v in np.array(pos) - parent_pos]

    # 3. inverse bind matrices: identity rotation, translation = -world position (column-major)
    skin = g["skins"][0]
    acc = g["accessors"][skin["inverseBindMatrices"]]
    view = g["bufferViews"][acc["bufferView"]]
    base = view.get("byteOffset", 0) + acc.get("byteOffset", 0)
    for k, joint in enumerate(skin["joints"]):
        m = np.eye(4, dtype="<f4")
        m[:3, 3] = -np.array(WORLD[nodes[joint]["name"]], dtype="<f4")
        binc[base + 64 * k : base + 64 * (k + 1)] = m.T.astype("<f4").tobytes()  # column-major

    g["asset"]["generator"] = "Procedural garment model, repaired by tools/fix_apose_jacket.py"
    write_glb(dst, g, binc)
    print("wrote", dst)


if __name__ == "__main__":
    if len(sys.argv) != 3:
        raise SystemExit(__doc__)
    main(sys.argv[1], sys.argv[2])
