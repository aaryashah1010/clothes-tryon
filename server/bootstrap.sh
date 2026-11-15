#!/bin/bash
# Unattended pod setup for the live try-on server. Safe to run again: every step skips work already done.
# Conda lives on the fast container disk (reinstalled after a stop, ~10 min); models live on /workspace (kept).
set -eo pipefail
log() { echo "[bootstrap $(date +%H:%M:%S)] $*"; }
log "start"

# FluxRT runs its model in child processes that outlive the server. Kill leftovers from earlier runs
# (never Jupyter, never this script) so two engines don't fight over the GPU and CPU.
ps -eo pid,cmd | grep -E "multiprocessing|live_server|tryon_server|fluxrt|inductor" | grep -v -e jupyter -e grep -e bootstrap.sh   | awk '{print $1}' | xargs -r kill -9 || true
sleep 2

CONDA_DIR=/root/miniconda3
if [ ! -x "$CONDA_DIR/bin/conda" ]; then
  log "installing miniconda"
  wget -q https://repo.anaconda.com/miniconda/Miniconda3-latest-Linux-x86_64.sh -O /tmp/mc.sh
  bash /tmp/mc.sh -b -p "$CONDA_DIR"
fi
source "$CONDA_DIR/etc/profile.d/conda.sh"
conda tos accept --override-channels --channel https://repo.anaconda.com/pkgs/main >/dev/null 2>&1 || true
conda tos accept --override-channels --channel https://repo.anaconda.com/pkgs/r >/dev/null 2>&1 || true
if ! conda env list | grep -qE '^fluxrt\s'; then
  log "creating conda env"
  conda create -y -q -n fluxrt python=3.12 pip
fi
conda activate fluxrt

cd /workspace
[ -d FluxRT ] || { log "cloning FluxRT"; git clone -q https://github.com/tensorforger/FluxRT; }
cd FluxRT
python -c "import torch" 2>/dev/null || { log "installing torch"; pip install -q torch torchvision --index-url https://download.pytorch.org/whl/cu128; }
python -c "import diffusers" 2>/dev/null || { log "installing requirements"; pip install -q -r requirements.txt; }
python -c "import fluxrt" 2>/dev/null || { log "installing fluxrt"; pip install -q -e .; }
pip install -q websockets
# body pose of each AI picture, for the browser's time-warp (no-deps: its own opencv/numpy pins would clash)
python -c "import mediapipe" 2>/dev/null || { log "installing mediapipe"; pip install -q --no-deps mediapipe && pip install -q absl-py flatbuffers matplotlib; }
python -c "import ctypes; ctypes.CDLL('libEGL.so.1')" 2>/dev/null || { apt-get update -qq && DEBIAN_FRONTEND=noninteractive apt-get install -y -qq libegl1 libgles2; } >/dev/null 2>&1 || true
[ -f /workspace/pose_landmarker_lite.task ] || wget -q -O /workspace/pose_landmarker_lite.task https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/latest/pose_landmarker_lite.task || true

log "downloading models (skips files already present)"
python - <<'EOF'
from huggingface_hub import snapshot_download
snapshot_download("TensorForger/RIFE-safetensors", local_dir="RIFE-safetensors")
snapshot_download("black-forest-labs/FLUX.2-klein-4B", local_dir="FLUX.2-klein-4B")
snapshot_download("madebyollin/taef2", local_dir="taef2")  # small decoder for --tiny-vae
print("models ready")
EOF

python -c "import torch; print('GPU:', torch.cuda.get_device_name(0))"
[ -f /workspace/live_server.py ] || { echo "missing /workspace/live_server.py: upload it in Jupyter first"; exit 1; }
cd /workspace
if [ "${PHOTO_SERVER:-0}" = "1" ] && [ -f /workspace/tryon_server.py ]; then
  # photo try-on for the share page, on port 8080 next to the live server (falls back to CPU offload
  # if the GPU is too full for both)
  log "starting photo server on port 8080"
  (PORT=8080 TRYON_OFFLOAD=1 nohup python -u /workspace/tryon_server.py > /workspace/tryon.log 2>&1 &)
fi
log "starting live server (first start compiles the model, a few minutes)"
exec python -u live_server.py ${LIVE_ARGS:-}
