# Clothes try-on: prototype plan

Research date: 28 October 2026. Status: planning and evaluation preparation. No GPU rented, dependencies installed, model weights downloaded, training performed, or working try-on application built yet.

## First version

Build a live upper-body garment preview: one person, one selected shirt or T-shirt, one active GPU session. Show the original camera beside the generated result. Start with recorded clips before connecting a live camera. This is a visual preview; it does not establish physical fit, body measurements, or the right clothing size.

## What the research establishes

**FluxRT is the first candidate to evaluate.** It is a streaming image-editing pipeline with webcam and reference-image support, including a try-on example. Its documented recommendation is an RTX 5090 with 32 GB VRAM, Python 3.12 and CUDA 12.8. The documented minimum uses an RTX 4090 and int8; that is a separate configuration to validate, not our initial baseline. These are upstream requirements, not measurements from our project. [FluxRT repository](https://github.com/tensorforger/FluxRT)

**The screenshot's speed claims are not a clothes benchmark.** The published detailed benchmark uses 576 x 320, two inference steps, no reference image and 4x frame interpolation. Its reported output FPS includes interpolated frames. We must measure unique generated frames and garment-conditioned latency ourselves; the published latency does not establish phone-to-cloud round-trip performance. [Benchmark configuration and results](https://github.com/tensorforger/FluxRT/blob/main/benchmark.md)

**A specialized photo baseline is available if needed.** FASHN VTON 1.5 accepts a person image and a garment image. Its authors report approximately five seconds on an H100 and approximately 8 GB VRAM. It is a comparison for still-image garment quality, not evidence of live performance. [Official model card](https://huggingface.co/fashn-ai/fashn-vton-1.5)

## Renting a GPU

Recommended first experiment: one on-demand RTX 5090, 32 GB VRAM, Linux, at least 32 GB system RAM. Provision disk after checking the pinned model and environment sizes; allow space for weights, compilation caches and selected test clips. Verify driver, PyTorch and CUDA compatibility before installing the full stack.

Runpod's public pricing page currently displays $1.19/hour for an RTX 5090 and $0.89/hour for an RTX 4090. At the displayed 5090 rate, four hours is $4.76 and eight hours is $9.52 in GPU time alone. Prices, cloud tier and availability must be checked in the deployment console before purchase. Setup, downloads and warm-up consume rented time too. [Runpod pricing](https://www.runpod.io/pricing)

Vast.ai is another rental option with market-dependent offers. Compare the actual GPU, location, connectivity and full cost rather than choosing solely by the lowest hourly listing. Prefer on-demand for the first interactive experiment. [Vast.ai pricing](https://vast.ai/pricing)

Choose the closest practical region to the testers and measure network latency. Reserve a short test window and record the cost. Stop GPU compute after testing; retained storage may still be billed. Export needed work before terminating resources, and review persistent volumes separately. [Runpod lifecycle and storage guidance](https://docs.runpod.io/pods/manage-pods)

No purchase or cloud resource creation is included in this preparation.

## Architecture to test

```text
Browser camera + selected garment
                |
       authenticated HTTPS connection
                |
       GPU session / FluxRT adapter
                |
       generated preview + timing data
```

The GPU runs on the server; users can open the interface on a phone or laptop. Camera frames leave the device, so explain this before camera use and avoid retaining raw recordings by default. A Cloudflare-hosted frontend can connect to this backend; a static deployment ZIP cannot run the CUDA model.

For the initial private experiment, use the upstream demo through a secured connection. Do not expose an unauthenticated shared demo as the product. The current Gradio example uses global processing/reference state. Our later adapter must isolate users or explicitly enforce one active session. [Upstream demo source](https://github.com/tensorforger/FluxRT/blob/main/scripts/run_gradio_demo.py)

Use a bounded buffer that keeps the latest input instead of a growing queue. Add frame identifiers and capture/receive/generate/display timestamps to establish which output corresponds to which input. Discard obsolete output on garment changes and session restarts. These are implementation requirements, not capabilities already added here.

## Work order and decision points

1. **Prepare locally before renting.** Select five representative garments, including a plain top, stripes, a logo, buttons and a loose garment. Obtain consent for evaluation clips from at least three people. Record front view, gentle turns, arms crossing the torso, motion and lighting changes. Use `evaluation-template.csv` for the test inventory; its rows are proposed cases, not collected data.
2. **Reproduce a baseline on the rented machine.** Record `nvidia-smi`, OS, Python, driver, PyTorch and CUDA versions. Pin the FluxRT commit, model revision and dependencies. First reproduce an upstream reference-image example and save its complete configuration. Avoid optional upscalers, face tools and LoRAs initially.
3. **Check garment fidelity before optimizing.** Run the same clips and reference images. Compare two versus four steps, then cache settings and interpolation separately. Establish a generation-only baseline before adding interpolation. Reject results that change the garment's identity or alter the wearer substantially, even when they look attractive.
4. **Connect a private live preview.** Add garment selection, original/result views, start/stop, session cleanup and visible connection status. Measure real browser round-trip delay and recovery after interruptions. Only then consider a wider pilot.
5. **Optimize against recorded failures.** Compare resolution, caching, interpolation and int8 one at a time. Record quality as well as speed. Do not add concurrency until one stream works; then measure GPU memory, isolation, latency and cost at each stream count.
6. **Decide whether fine-tuning is justified.** Classify persistent failures first. If product details remain wrong across people and poses, assess a specialized model or targeted fine-tuning. If delay is dominated by networking or buffering, training will not fix that cause.

The first rental succeeds if we can reproduce garment-conditioned inference, document whether important product details survive movement, and measure performance and cost. It need not prove production readiness. Agree on numerical product acceptance limits with the team after observing the baseline.

## What to measure

For every run record the model/code revisions, GPU, resolution, seed, steps, precision, reference configuration, cache and interpolation settings.

- Garment identity: logo/text, color, pattern, neckline, sleeves, buttons and silhouette.
- Person preservation: face, hands, body shape and background.
- Movement: flicker, texture drift, side-view failures and arms/hair incorrectly covering clothing.
- Performance: cold start, warm-up, unique generated FPS, interpolated/display FPS, dropped input frames, end-to-end latency P50/P95 and peak VRAM.
- Economics: total rental duration, storage/transfer charges and measured cost per active stream-hour.

Use held-out people and garments for final evaluation. Keep adjacent frames from the same recording in the same split. Do not count repeated display frames as fresh model results.

## Training and release considerations

Start with pretrained inference. Trying the app on different people is useful evaluation, but does not automatically create training data. Fine-tuning would require suitable licensed and consented examples linking the person, reference garment and desired worn result, plus a held-out evaluation set. Video consistency may require temporal methods beyond image fine-tuning.

The undistilled FLUX.2-klein-base-4B is positioned for fine-tuning; the distilled streaming model is a different checkpoint. Verify adapter compatibility and training memory requirements before choosing a trainer or renting training hardware. [Official base model card](https://huggingface.co/black-forest-labs/FLUX.2-klein-base-4B)

FluxRT code uses the Unlicense and FLUX.2-klein-4B lists Apache 2.0. Audit all pinned weights, dependencies, optional models and input-data rights before release; the top-level code license alone is insufficient. [FluxRT license](https://github.com/tensorforger/FluxRT/blob/main/LICENSE), [FLUX.2-klein-4B model card](https://huggingface.co/black-forest-labs/FLUX.2-klein-4B)

FASHN's main model is Apache 2.0, but its human parser inherits the NVIDIA SegFormer license. Review that dependency's full terms before using the complete pipeline commercially. [Parser license notice](https://github.com/fashn-AI/fashn-human-parser/blob/main/LICENSE)

## Next concrete step

Choose the rental provider and maximum test budget, then prepare the input garments and clips. We can prepare a pinned setup and smoke test before starting the GPU meter. No custom model training is required to begin this evaluation.
