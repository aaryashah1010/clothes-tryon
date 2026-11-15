# Live try-on server image: everything bootstrap.sh installs, baked in, so a new pod is ready in minutes.
# Build:  docker build -t <registry-user>/fynd-live-tryon:1 .          (models download on first start into /workspace)
#         docker build --build-arg BAKE_MODELS=1 -t <registry-user>/fynd-live-tryon:1-models .   (adds ~25 GB)
FROM runpod/pytorch:1.0.2-cu1281-torch280-ubuntu2404

ARG BAKE_MODELS=0
ENV PYTHONUNBUFFERED=1 FLUXRT_DIR=/opt/app/FluxRT \
    OMP_NUM_THREADS=4 MKL_NUM_THREADS=4 OPENCV_FOR_THREADS_NUM=2 TORCHINDUCTOR_COMPILE_THREADS=4

WORKDIR /opt/app
RUN git clone -q https://github.com/tensorforger/FluxRT && \
    cd FluxRT && \
    pip install --no-cache-dir torch torchvision --index-url https://download.pytorch.org/whl/cu128 && \
    pip install --no-cache-dir -r requirements.txt && \
    pip install --no-cache-dir -e . websockets

RUN if [ "$BAKE_MODELS" = "1" ]; then cd FluxRT && python -c "\
from huggingface_hub import snapshot_download; \
snapshot_download('TensorForger/RIFE-safetensors', local_dir='RIFE-safetensors'); \
snapshot_download('black-forest-labs/FLUX.2-klein-4B', local_dir='FLUX.2-klein-4B')"; fi

# small decoder used by --tiny-vae (about 10 MB), always baked in
RUN cd FluxRT && python -c "from huggingface_hub import snapshot_download; snapshot_download('madebyollin/taef2', local_dir='taef2')"

COPY live_server.py /opt/app/live_server.py
COPY start_live.sh /opt/app/start_live.sh
RUN chmod +x /opt/app/start_live.sh

EXPOSE 7860
# Keeps the pod's normal services (SSH, Jupyter) and starts our server beside them.
CMD ["bash", "-c", "(/opt/app/start_live.sh > /workspace/live.log 2>&1 &) ; exec /start.sh"]
