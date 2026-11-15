"""Fynd Studio try-on on Modal: the same live and photo servers as on the Runpod pod, unchanged.

server/live_server.py and server/tryon_server.py run here exactly as bootstrap.sh starts them on a pod;
this file only replaces the pod setup (install, model download, start command).

One time:
    pip install modal
    modal setup                                              # log in (opens the browser)
    modal run cloud_modal/modal_app.py::download             # models into a Modal Volume (~15 GB, CPU only)

Each test session (from the clothes_tryon folder):
    set TRYON_TOKEN=pick-a-secret    (PowerShell: $env:TRYON_TOKEN="pick-a-secret")
    modal deploy cloud_modal/modal_app.py   # prints the live and photo URLs
    share link: <live URL>/?t=<token>&photo=<photo URL>
    modal app stop fynd-tryon        # stop billing when done

Knobs (environment variables read when you deploy):
    LIVE_GPU    GPU for the live server, default H100 (also L40S, RTX-PRO-6000, H200, B200)
    PHOTO_GPU   GPU for the photo server, default L40S
    REGION      Modal region, default ap-south (Mumbai). Narrow regions cost 1.75x, broad ones ("ap") 1.15x
    LIVE_ARGS   extra live_server.py flags, default "--steps 2 --tiny-vae --interp 1"
"""
import os
import pathlib
import subprocess

import modal

ROOT = pathlib.Path(__file__).resolve().parent.parent  # the clothes_tryon folder
MODELS = "/models"  # Modal Volume: model weights and the compiled-kernel cache, kept between runs
FLUXRT = "/opt/FluxRT"
MODEL_DIRS = {  # same downloads as bootstrap.sh
    "RIFE-safetensors": "TensorForger/RIFE-safetensors",
    "FLUX.2-klein-4B": "black-forest-labs/FLUX.2-klein-4B",
    "taef2": "madebyollin/taef2",
}
# Tried and not used (no help for text, or slower): "FlowUpscaler": "TensorForger/FlowUpscaler" (enable_flow_upscaler),
# "FLUX.2-klein-4B-int8": "aydin99/FLUX.2-klein-4B-int8" (--int8). Add them back here to repeat those tests.

LIVE_GPU = os.environ.get("LIVE_GPU", "B200")  # B200: 22 fps shown with the settings below, H100: 16
PHOTO_GPU = os.environ.get("PHOTO_GPU", "L40S")
REGION = os.environ.get("REGION", "ap-south")
ROUTING = os.environ.get("ROUTING_REGION", "ap-south")  # valid: us-east, us-west, eu-west, ap-south
LIVE_CPU = (float(os.environ.get("LIVE_CPU", "8")), 16.0)  # cores reserved, cores allowed (billed per core-second)
# 768x432 (and the 512 garment reference below) is what makes printed text readable; 576x320 garbles it
LIVE_ARGS = os.environ.get("LIVE_ARGS", "--steps 2 --tiny-vae --interp 2 --jpeg-quality 78 --send-fps 20 --width 768 --height 432").split()
# FluxRT's spatial cache (on by default) re-computes only the parts of the picture that moved. On Modal it made
# a moving person run at 2 real frames/s (engine 2.1 fps, 3.4 shown) against 10.7 (23 to 30 shown) with it off.
FLUX_OVERRIDES = os.environ.get(
    "FLUX_OVERRIDES", '{"enable_spatial_cache": false, "reference_image_resolution": {"height": 512, "width": 512}}'
)
TOKEN = os.environ.get("TRYON_TOKEN", "")

app = modal.App(os.environ.get("APP_NAME", "fynd-tryon"))  # a second copy (APP_NAME=fynd-tryon-hd) gets its own link
models = modal.Volume.from_name("fynd-tryon-models", create_if_missing=True)
# The file is imported again inside the container, where this PC's environment variables don't exist: anything the
# server needs at run time (token, server flags, FluxRT overrides) travels in the secret.
token = modal.Secret.from_dict(
    {
        "TRYON_TOKEN": TOKEN,
        "LIVE_ARGS": " ".join(LIVE_ARGS),
        "FLUX_OVERRIDES": FLUX_OVERRIDES,
        "FLUX_PROMPT": os.environ.get("FLUX_PROMPT", ""),  # empty: the server's own sentence
    }
)

# the pod's conda env, as an image (built in Modal's cloud, not on this PC)
image = (
    modal.Image.debian_slim(python_version="3.12")
    .apt_install("git", "wget", "build-essential", "libgl1", "libglib2.0-0", "libegl1", "libgles2")
    .pip_install("torch", "torchvision", index_url="https://download.pytorch.org/whl/cu128")
    .run_commands(
        f"git clone -q https://github.com/tensorforger/FluxRT {FLUXRT}",
        f"cd {FLUXRT} && pip install -q -r requirements.txt && pip install -q -e .",
    )
    .pip_install("websockets", "huggingface_hub", "psutil")
    # same as bootstrap.sh: mediapipe's own opencv/numpy pins would clash
    .run_commands("pip install -q --no-deps mediapipe && pip install -q absl-py flatbuffers matplotlib")
    .env({"FLUXRT_DIR": FLUXRT, "TORCHINDUCTOR_CACHE_DIR": f"{MODELS}/inductor-cache", "PYTHONUNBUFFERED": "1"})
    .add_local_file(ROOT / "server" / "live_server.py", "/app/live_server.py")
    .add_local_file(ROOT / "cloud_modal" / "launch_live.py", "/app/launch_live.py")
    .add_local_file(ROOT / "server" / "tryon_server.py", "/app/tryon_server.py")
    .add_local_file(ROOT / "site" / "public" / "models" / "pose_landmarker_lite.task", "/app/pose_landmarker_lite.task")
    .add_local_dir(ROOT / "site" / "dist-share", "/app/site")
)


def link_models() -> None:
    """FluxRT looks for model folders inside its repo: point them at the Volume."""
    for name in MODEL_DIRS:
        dst = os.path.join(FLUXRT, name)
        if not os.path.exists(dst):
            os.symlink(os.path.join(MODELS, name), dst)


@app.function(image=image, volumes={MODELS: models}, region=REGION, timeout=3600)
def download():
    from huggingface_hub import snapshot_download

    for name, repo in MODEL_DIRS.items():
        snapshot_download(repo, local_dir=os.path.join(MODELS, name))
        print("ready:", name)
    models.commit()


@app.function(
    image=image,
    gpu=LIVE_GPU,
    # Modal gives a container a sliver of a CPU by default. FluxRT runs ~20 processes (the model, RIFE,
    # encoding, pose), so a 1st test on an idle H100 showed it only 12% busy and 3 fps: CPU-starved.
    cpu=LIVE_CPU,
    memory=(32 * 1024, 64 * 1024),  # MiB: reserved, limit
    region=REGION,
    routing_region=ROUTING,  # the web address enters in this region too (default would be us-east: extra lag)
    volumes={MODELS: models},
    secrets=[token],
    timeout=24 * 3600,
    max_containers=1,  # one GPU, one live viewer at a time (the server turns a second viewer away)
    scaledown_window=20 * 60,  # stay warm 20 min after the last visitor, then stop billing
)
@modal.concurrent(max_inputs=100)  # page files, health checks and the live socket share the one container
@modal.web_server(7860, startup_timeout=30 * 60)  # first start compiles the model: several minutes
def live():
    link_models()
    subprocess.Popen(
        ["python", "-u", "/app/launch_live.py", *LIVE_ARGS,
         "--site", "/app/site", "--pose-model", "/app/pose_landmarker_lite.task"],
        cwd="/app",
        env={**os.environ, "FLUX_OVERRIDES": FLUX_OVERRIDES},
    )


@app.function(
    image=image,
    gpu=PHOTO_GPU,
    region=REGION,
    routing_region=ROUTING,
    volumes={MODELS: models},
    secrets=[token],
    timeout=3600,
    max_containers=1,
    scaledown_window=10 * 60,
)
@modal.concurrent(max_inputs=20)
@modal.web_server(8080, startup_timeout=20 * 60)
def photo():
    # its own GPU, so it never fights the live server for memory (no TRYON_OFFLOAD needed)
    link_models()
    subprocess.Popen(
        ["python", "-u", "/app/tryon_server.py"],
        cwd="/app",
        env={**os.environ, "PORT": "8080", "TRYON_MODEL": os.path.join(FLUXRT, "FLUX.2-klein-4B")},
    )
