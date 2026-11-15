# Fynd Studio try-on: demo guide (give this file to Claude)

You are helping the owner of the Modal workspace **texel** run a live demo of the Fynd Studio virtual try-on. The try-on is **already deployed** in that workspace. The person does not need any code or project folder, and you must not ask for one. You do the Modal commands yourself and tell them in plain words what you are doing. The person only has to answer two questions, then use their own camera device. **Always end by switching the GPU off.**

What it is: a live webcam clothes try-on. The browser sends camera frames to a GPU (an NVIDIA B200 on Modal, Mumbai); our own model redraws the person wearing the garment they pick. No third-party AI is used for the live picture. The GPU costs about **$12 per hour (about 20 cents a minute)** while it runs, and it runs only while someone is using it (plus 20 minutes after the last visitor).

## Step 0. Ask the person which device they will test on (just one)

Ask, and wait for the answer:

> "Which device will you use the camera on for the test: **your phone** or **your laptop**? Pick one. Each GPU serves one person at a time, and using both would start two GPUs and double the cost."

Then use **only** that row from here on:

| They chose | App name (`<APP>`) | Link (`<LINK>`) |
|---|---|---|
| **Phone** (portrait picture) | `fynd-tryon-pt` | https://texel--fynd-tryon-pt-live.ap-south.modal.run/?t=fynd-BhJE8b2a |
| **Laptop** (landscape picture) | `fynd-tryon` | https://texel--fynd-tryon-live.ap-south.modal.run/?t=fynd-BhJE8b2a |

Do not touch the other app. (The laptop link opened on a phone sends the phone to the phone app by itself; that would start the phone GPU. So if they chose laptop, tell them to open the link on the laptop only.)

## Step 1. Make sure Modal works on this PC

```
pip install modal
modal profile current
```

It must print `texel`. If Modal is not set up: `modal setup` (opens the browser, they log in), then `modal profile activate texel`.

## Step 2. Is it ready? Is a GPU running?

```
modal app list
modal container list
```

Read the result like this:

- `<APP>` is listed as **deployed** and `modal container list` shows **no rows**: it is **ready and the GPU is off** (nothing billing). Go to step 3.
- `modal container list` **shows a row**: a GPU is running now and billing. Tell the person; it can be used right away, and step 5 switches it off.
- `<APP>` is **not in `modal app list`**: it is not deployed, so it cannot be switched on from here. Tell the person to ask Aarya (the developer) to deploy it. Do not try to rebuild or redeploy it yourself.

## Step 3. Switch it on

Ask: "This starts the GPU, about 20 cents a minute until we stop it. OK to start?" Wait for a yes. Then wake it with one request to `<LINK>`:

```
curl -sL -o NUL -w "%{http_code}\n" --max-time 900 "<LINK>"
```

(On Mac/Linux use `-o /dev/null`. The `-L` matters: Modal answers `303` after about 150 seconds meaning "still starting", and `-L` keeps waiting through it.) This request starts the GPU and waits until the server answers. The first start can take **several minutes** (the model loads); tell the person it is normal. `200` means it is up. Check: `modal container list` now shows a row. If it printed `303`, you forgot `-L`: run it again with `-L`.

If it times out, wait a minute and run it again, then look at `modal app logs <APP>`.

## Step 4. Tell the person to test (they do this on their own device)

Give them `<LINK>` (and say: add `&bench=1` to the end to also see the test numbers). They open it on the device they chose, then:

1. Press **Start camera** and allow the camera. The first start takes about 25 seconds while the engine loads.
2. Stand so your upper body is in view (for trousers, step back until your legs show to the ankles).
3. Pick a garment in the grid. Use the Men / Women switch and the category chips. After a moment you see yourself wearing it.
4. Try **Outfit mode** (a switch under the grid): pick a top and trousers together.
5. Try **Upload your own**: a front-view photo of one garment on a plain background works best. Answer the small questions that appear (top or trousers, sleeves, hood, pattern, open front).

Good looks like: smooth video, the garment follows the body, long sleeves cover the arms, hoods show, blazers show a shirt underneath. Known weak spots: fast movement can ghost; lifting a leg can make trousers look like shorts; nobody in view shows the plain camera with a hint. If it looks laggy, that is usually the network (Wi-Fi, hotspot): the test panel's round-trip number shows it.

Stay available while they test. When they say they are done, go to step 5.

## Step 5. Switch it off (always)

Ask them to close the try-on page first, otherwise it can start the GPU again. Then:

```
modal container list
```

For each row, copy the container ID (starts with `ta-`) and run:

```
modal container stop <container-id>
```

Check again: `modal container list` must show **no rows**. Tell the person the GPU is off and nothing is billing. The app stays deployed, so it can be switched on again later with step 3. (Do **not** run `modal app stop`: that removes the deployment, and then it cannot be switched on again without the developer.)

If it is forgotten, the GPU stops by itself about 20 minutes after the last visitor.

## Notes

- Anyone with the link can start a GPU by opening it. Share it only with people who should have it, and switch off after use.
- If a start fails with "exceeded its spend limit", the workspace spending limit is used up. Only the workspace owner can raise it in the Modal dashboard.
- "Wrong access token" means the `t=` part of the link is missing or changed. Use the link from the table.
- "Another tab or device took over" means a second device connected. Close the other one.
- Never print or share any Modal token.
