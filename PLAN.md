# Fynd Studio Virtual Try-On: build plan

Date: 28 October 2026. Written for you to share with your manager. Estimates marked (estimate) are guesses, not measurements.

## What we are building

One responsive website that works on phones and computers. Shoppers pick a garment and choose how to try it on:

| | Mode 1: Live camera | Mode 2: Upload a photo |
|---|---|---|
| Shopper does | Turns on the camera and moves | Uploads (or takes) one photo |
| Result | Garment follows them live | Realistic image of them wearing it, in a few seconds |
| Runs where | Inside the shopper's browser (like the ring try-on) | On a cloud GPU |
| Look | Garment photo fitted to the body; a little flat | Realistic; folds, shading and fit look natural |
| Cost per shopper | Almost nothing (static hosting) | A few seconds of GPU per click (to be measured) |

The two modes use different technology on purpose. What we tested on the rented GPU (FluxRT live video) was too laggy and costs a GPU per shopper, so it is not used for live video.

## What we already know (tested 28 October 2026)
- FLUX.2 Klein can put a chosen garment on a person while keeping face, glasses, pose and background. Worn-on-model garment photos worked well; a folded flat shirt failed.
- Live video through the cloud ran at about 4 to 6 real frames per second with visible delay. Not suitable for the live mode.
- The ring try-on already proves the in-browser live approach on a phone-class device (hand tracking). Phones were never tested for it.

## Phases

**Phase 0: Decisions (before building).** Ask the manager: which garment types first (tops and jackets first is recommended); standalone site or embedded in Fynd pages; privacy rules for shopper photos; target countries.

**Phase 1: Site foundation and garment catalog.** Page layout, garment picker, two-mode switch, loading and error states. Prepare 10 to 20 garments: transparent cut-outs for live mode, plain product images for photo mode. Reuse the 10 men's and 10 women's garments already prepared in the garments folder.

**Phase 2: Live camera mode.** Same approach as the ring project: body tracking in the browser, garment placed on shoulders and torso, smoothing so it does not shake. Test on a laptop, then on a real phone. Success looks like: smooth on a mid-range phone (target: at least 24 frames per second, to be measured), stays on the body during normal movement, clear message when the body is not visible.

**Phase 3: Photo upload mode.** Compare two models on the same photos and garments: FLUX.2 Klein (already tested) and FASHN VTON 1.5 (made specifically for try-on; its authors report about 5 seconds on a data-centre GPU and about 8 GB of GPU memory; to be checked against our results). Pick the better one, deploy it as a pay-per-use cloud GPU service, and connect the upload screen. Success looks like: result in under about 10 seconds (estimate), face and garment details preserved on most test cases.

**Phase 4: Polish.** Before and after view, quick garment switching, save or share the result, helpful tips (stand straight, good light), privacy notice, clear failure messages.

**Phase 5: Connect to Fynd.** Embed or link from product pages, load garments from the real catalog, login and rate limits so strangers cannot run up GPU costs, security and legal review of how shopper photos are handled.

**Phase 6: Pilot and measure.** Small group of real users. Measure speed on real phones, cost per try-on, and how often results look wrong.

## Rough effort (estimate)
| Phase | Time |
|---|---|
| 1 | 2 to 3 days |
| 2 | 1 to 2 weeks |
| 3 | 1 week |
| 4 | 3 to 5 days |
| 5 | depends on Fynd's systems |
| 6 | 1 to 2 weeks |

## Cost (estimate until measured)
- Development GPU rental: roughly $5 to $20 in total.
- Live mode in production: static hosting only.
- Photo mode in production: if one try-on takes about 4 seconds on a rented RTX 4090 at the serverless rate of $1.10 per hour listed by Runpod, that is roughly $0.001 to $0.002 per try-on. We will replace this with a measured figure in Phase 3.

## Risks
- **Live mode looks less realistic** than the AI photo mode. Sleeves, arms crossing the body and side views are the hardest cases.
- **Phone speed is untested** for body tracking. Cheaper phones may be slower.
- **Catalog image quality:** flat or folded product shots gave wrong results in the photo mode test. May need on-model photos or a clean-up step.
- **Privacy:** shopper selfies are personal data. Needs consent text, no storage by default, fast deletion, and review under India's data protection rules.
- **Licenses:** FLUX.2 Klein 4B is listed as Apache 2.0. FASHN's body-part parser uses a separate NVIDIA license that must be checked before commercial use. The test garment images come from a dataset with unclear licensing and must not be shown publicly.
- **Fit is a preview only.** It does not show size or physical fit.

## Where to start
Build Phase 2 (live camera mode) first, because it is the main thing the manager asked for and the biggest unknown on phones. Run Phase 3's model comparison on the cloud GPU at the same time.
