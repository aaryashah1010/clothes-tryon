"""Starts server/live_server.py unchanged, with two things set from outside it.

1. WebSocket compression (permessage-deflate) switched off. Modal's gateway does not support it (it answers
   a compressed connection with a protocol error, code 1002), and uvicorn turns it on by default.
   JPEG frames don't compress anyway.
2. FluxRT settings that live_server.py has no flag for, from the FLUX_OVERRIDES environment variable (JSON),
   for example FLUX_OVERRIDES='{"enable_spatial_cache": false, "interpolation_exp": 2}'.
"""
import json
import os
import runpy
import sys

import uvicorn.config

_orig_init = uvicorn.config.Config.__init__


def _init(self, *args, **kwargs):
    kwargs.setdefault("ws_per_message_deflate", False)
    _orig_init(self, *args, **kwargs)


uvicorn.config.Config.__init__ = _init

_overrides = json.loads(os.environ.get("FLUX_OVERRIDES", "{}") or "{}")
if _overrides:
    _orig_load = json.load

    def _load(fp, *args, **kwargs):
        data = _orig_load(fp, *args, **kwargs)
        if isinstance(data, dict) and "default_steps" in data:  # FluxRT's config file, nothing else
            data.update(_overrides)
            print("FluxRT config overrides:", _overrides, flush=True)
        return data

    json.load = _load

# 3. The instruction the model gets with every frame. live_server.py writes its own sentence into the config file;
#    FLUX_PROMPT replaces it just before the file is written (so the server file stays as it is).
_prompt = os.environ.get("FLUX_PROMPT", "").strip()
if _prompt:
    _orig_dump = json.dump

    def _dump(obj, fp, *args, **kwargs):
        if isinstance(obj, dict) and "default_prompt" in obj:
            obj = {**obj, "default_prompt": _prompt}
            print("FluxRT prompt override:", _prompt, flush=True)
        return _orig_dump(obj, fp, *args, **kwargs)

    json.dump = _dump

sys.argv = ["/app/live_server.py", *sys.argv[1:]]
runpy.run_path("/app/live_server.py", run_name="__main__")
