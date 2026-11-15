#!/bin/bash
# Container start: download any missing models (kept on /workspace), then run the server. TRYON_TOKEN must be set.
set -eo pipefail
cd /opt/app/FluxRT
if [ ! -d FLUX.2-klein-4B ] || [ ! -d RIFE-safetensors ]; then
  python - <<'EOF'
from huggingface_hub import snapshot_download
snapshot_download("TensorForger/RIFE-safetensors", local_dir="RIFE-safetensors")
snapshot_download("black-forest-labs/FLUX.2-klein-4B", local_dir="FLUX.2-klein-4B")
EOF
fi
exec python -u /opt/app/live_server.py ${LIVE_ARGS:-}
