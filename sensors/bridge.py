#!/usr/bin/env python3
"""
sensors/bridge.py - ΑΝΑΣΑ sensor bridge for the Godot (immersive) mode.

Reuses the proven desktop sensing from breathdive.py / breathlight.py:
  --mic          breath from the microphone (BreathFilter + BreathTracker)
  --hr           heart rate + RR from any standard Bluetooth heart strap (bleak)
and POSTs the live state ~10x a second to serve.py, which Godot polls.

    sensors/.venv/bin/python sensors/bridge.py --post http://127.0.0.1:8010/api/sensors --mic --hr

Setup once:  uv venv --python /usr/bin/python3 --system-site-packages sensors/.venv
             uv pip install --python sensors/.venv/bin/python sounddevice bleak
"""
import argparse
import json
import os
import sys
import time
import urllib.request
from types import SimpleNamespace

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)
os.environ.setdefault("PYGAME_HIDE_SUPPORT_PROMPT", "1")
import breathdive as bd  # noqa: E402  (Bio, start_mic, start_ble)


def start_model_mic(bio, path, device):
    """Microphone through the trained in/out model (ml/breath_model.py), 16 kHz."""
    import threading
    sys.path.insert(0, os.path.join(ROOT, "ml"))
    from breath_model import BreathModel, SR, HOP
    model = BreathModel.load(path)
    bio.breath_status = "mic (trained model)"

    def callback(indata, frames, t, status):
        st = model.push(indata[:, 0])
        if st is None:
            return
        with bio.lock:
            bio.phase = st["phase"]
            bio.level = min(1.0, st["pIn"] + st["pOut"])
            bio.breath_status = "mic"
            bio.detail = st

    def run():
        try:
            import sounddevice as sd
            with sd.InputStream(samplerate=SR, blocksize=HOP * 2, channels=1, device=device, callback=callback):
                while bio.running:
                    time.sleep(0.1)
        except Exception as e:
            bio.breath_status = f"mic error: {e}"
    threading.Thread(target=run, daemon=True).start()


def main():
    ap = argparse.ArgumentParser(description="ΑΝΑΣΑ sensor bridge")
    ap.add_argument("--post", required=True, help="serve.py /api/sensors URL")
    ap.add_argument("--mic", action="store_true", help="breath from the microphone")
    ap.add_argument("--hr", action="store_true", help="heart rate from a Bluetooth strap")
    ap.add_argument("--hr-device", default=None, help="BLE name (part) or address")
    ap.add_argument("--device", type=int, default=None, help="mic index")
    ap.add_argument("--source", default=None, help="PipeWire/PulseAudio source name (see: pactl list short sources)")
    ap.add_argument("--mic-scheme", choices=["alternate", "exhale"], default="alternate")
    ap.add_argument("--gate", type=float, default=9)
    ap.add_argument("--span", type=float, default=20)
    ap.add_argument("--flat", type=float, default=0.52)
    ap.add_argument("--min-breath", type=float, default=0.2)
    ap.add_argument("--raw", action="store_true")
    a = ap.parse_args()

    if a.source:
        # open the chosen mic through PipeWire (resamples to 16 kHz; JACK device indexes cannot)
        os.environ["PIPEWIRE_NODE"] = a.source
        os.environ["PULSE_SOURCE"] = a.source
        if a.device is None:
            a.device = "pipewire"

    bio = bd.Bio()
    model_path = os.path.join(ROOT, "web", "models", "breath.json")
    if a.mic and os.path.exists(model_path):
        start_model_mic(bio, model_path, a.device)
    elif a.mic:
        bd.start_mic(bio, SimpleNamespace(gate=a.gate, span=a.span, flat=a.flat, raw=a.raw,
                                          min_breath=a.min_breath, mic_scheme=a.mic_scheme, device=a.device))
    if a.hr:
        bio.hr_status = "starting Bluetooth..."
        bd.start_ble(bio, a.hr_device)

    fails = 0
    while True:
        with bio.lock:
            fresh = bio.hr is not None and time.time() - bio.hr_time < 5
            state = {
                "mic": a.mic, "micReady": a.mic and bio.breath_status == "mic",
                "phase": bio.phase, "level": round(bio.level, 3), "breathStatus": bio.breath_status,
                "hrOn": a.hr, "hr": bio.hr if fresh else None, "hrStatus": bio.hr_status,
            }
        state["rmssd"] = bio.rmssd_ms()
        detail = getattr(bio, "detail", None)
        if detail:
            state.update({k: detail[k] for k in ("since", "lastIn", "lastOut", "period")})
        try:
            req = urllib.request.Request(a.post, data=json.dumps(state).encode(),
                                         headers={"Content-Type": "application/json"})
            urllib.request.urlopen(req, timeout=1).read()
            fails = 0
        except Exception:
            fails += 1
            if fails > 100:          # server gone for ~10 s: stop
                bio.running = False
                return
        time.sleep(0.1)


if __name__ == "__main__":
    main()
