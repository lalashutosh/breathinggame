#!/usr/bin/env python3
"""
ml/make_synthetic.py - fake breathing sessions in the recorder's format, to test the pipeline
(training, export, Python/JS parity) before real recordings exist. NOT for training a real model.

    python3 ml/make_synthetic.py --out dataset/synthetic --n 4
"""
import argparse
import json
import os
import wave

import numpy as np
from scipy.signal import butter, sosfilt

SR = 16000


def band_noise(rng, n, lo, hi):
    sos = butter(4, [lo, hi], btype="band", fs=SR, output="sos")
    return sosfilt(sos, rng.standard_normal(n))


def envelope(n, attack=0.25):
    t = np.linspace(0, 1, n)
    return np.minimum(1, t / attack) * np.minimum(1, (1 - t) / attack)


def session(rng, sid, out):
    gain = rng.uniform(0.3, 1.5)
    segs, chunks, t = [], [], 0.0

    def add(sig, label):
        nonlocal t
        dur = len(sig) / SR
        segs.append({"t0": round(t, 3), "t1": round(t + dur, 3), "label": label})
        chunks.append(sig)
        t += dur

    add(np.zeros(int(5 * SR)), "quiet")
    for _ in range(rng.integers(14, 20)):
        n_in, n_out = int(rng.uniform(1.8, 4.5) * SR), int(rng.uniform(2.5, 7) * SR)
        add(0.05 * band_noise(rng, n_in, 2000, 6500) * envelope(n_in), "in")       # airy, high
        add(0.08 * band_noise(rng, n_out, 250, 1800) * envelope(n_out, 0.15), "out")  # softer, lower
        if rng.random() < 0.3:
            add(np.zeros(int(rng.uniform(0.3, 1.2) * SR)), "pause")
    n = int(8 * SR)
    tt = np.arange(n) / SR
    f0 = 140 + 30 * np.sin(2 * np.pi * 0.7 * tt)
    speech = sum(np.sin(2 * np.pi * k * np.cumsum(f0) / SR) / k for k in range(1, 8)) * (0.5 + 0.5 * np.sin(2 * np.pi * 3 * tt) > 0.2)
    add(0.05 * speech, "talk")
    add(np.zeros(int(4 * SR)), "quiet")

    x = np.concatenate(chunks)
    x = gain * (x + 0.004 * rng.uniform(0.5, 2) * rng.standard_normal(len(x)))   # room noise + mic gain
    x = np.clip(x, -1, 1)
    with wave.open(os.path.join(out, sid + ".wav"), "wb") as w:
        w.setnchannels(1); w.setsampwidth(2); w.setframerate(SR)
        w.writeframes((x * 32767).astype("<i2").tobytes())
    json.dump({"session": sid, "sampleRate": SR, "synthetic": True, "segments": segs}, open(os.path.join(out, sid + ".json"), "w"))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", default=os.path.join("dataset", "synthetic"))
    ap.add_argument("--n", type=int, default=4)
    a = ap.parse_args()
    os.makedirs(a.out, exist_ok=True)
    rng = np.random.default_rng(7)
    for i in range(a.n):
        session(rng, f"synthetic-{i + 1:02d}", a.out)
    print(f"{a.n} synthetic sessions in {a.out}")


if __name__ == "__main__":
    main()
