"""
ml/breath_model.py - ΑΝΑΣΑ breath phase model: features + runtime (numpy only).

The exact same feature pipeline is ported to web/js/lib/breathmodel.js; keep them in sync.

Audio: 16 kHz mono float32 in [-1, 1].
Frames: 512 samples (32 ms), hop 256 (16 ms), periodic Hann, power spectrum.
Bands: 24 HTK-mel triangles 80..7600 Hz, log10.
Noise floor: per band, causal tracker (drops fast toward quieter frames, rises slowly), so the
features are relative to the room and the mic gain.
Context: the last 20 frames (320 ms): mean, std, mean of the last 5, energy slope, centroid -> 74 dims.
Classifier: standardise -> small MLP (relu) -> softmax over [rest, in, out].
Tracker: smoothed probabilities -> phase with a minimum dwell -> durations and breath period.
"""
import json
from collections import deque

import numpy as np

SR = 16000
N = 512
HOP = 256
NMEL = 24
FMIN = 80.0
FMAX = 7600.0
W = 20
WS = 5
FLOOR_DOWN = 0.1
FLOOR_UP = 0.0015
CLASSES = ["rest", "in", "out"]
FRAME_S = HOP / SR


def _hz_to_mel(f):
    return 2595.0 * np.log10(1.0 + f / 700.0)


def _mel_to_hz(m):
    return 700.0 * (10.0 ** (m / 2595.0) - 1.0)


def mel_filters(sr=SR, n=N, nmel=NMEL, fmin=FMIN, fmax=FMAX):
    bins = np.arange(n // 2 + 1) * sr / n
    pts = _mel_to_hz(np.linspace(_hz_to_mel(fmin), _hz_to_mel(fmax), nmel + 2))
    fb = np.zeros((nmel, n // 2 + 1))
    for m in range(nmel):
        lo, c, hi = pts[m], pts[m + 1], pts[m + 2]
        up = (bins - lo) / (c - lo)
        down = (hi - bins) / (hi - c)
        fb[m] = np.maximum(0.0, np.minimum(up, down))
    return fb


FB = mel_filters()
WIN = 0.5 - 0.5 * np.cos(2 * np.pi * np.arange(N) / N)


def logmel_frames(pcm):
    """All full frames of a float signal -> (T, NMEL) log10 mel energies."""
    pcm = np.asarray(pcm, dtype=np.float64)
    if len(pcm) < N:
        return np.zeros((0, NMEL))
    t = 1 + (len(pcm) - N) // HOP
    idx = np.arange(N)[None, :] + HOP * np.arange(t)[:, None]
    spec = np.abs(np.fft.rfft(pcm[idx] * WIN, axis=1)) ** 2
    return np.log10(spec @ FB.T + 1e-10)


class FeatureStream:
    """Causal frame -> feature vector, identical to the JS port."""

    def __init__(self):
        self.floor = None
        self.hist = deque(maxlen=W)

    def push_frame(self, lm):
        if self.floor is None:
            self.floor = lm.copy()
        else:
            down = lm < self.floor
            self.floor = np.where(down, (1 - FLOOR_DOWN) * self.floor + FLOOR_DOWN * lm, self.floor + FLOOR_UP)
        z = lm - self.floor
        self.hist.append(z)
        if len(self.hist) < W:
            return None
        h = np.array(self.hist)
        mean = h.mean(0)
        std = h.std(0)
        last = h[-WS:].mean(0)
        e = h.mean(1)
        j = np.arange(W) - (W - 1) / 2
        slope = float((j * (e - e.mean())).sum() / (j * j).sum())
        m = np.maximum(mean, 0.0)
        cen = float((np.arange(NMEL) * m).sum() / (m.sum() + 1e-6) / NMEL)
        return np.concatenate([mean, std, last, [slope, cen]])


def features_for_signal(pcm):
    """Whole recording -> (frame_times, features) with one row per frame once the context is full."""
    lms = logmel_frames(pcm)
    fs = FeatureStream()
    times, feats = [], []
    for i, lm in enumerate(lms):
        f = fs.push_frame(lm)
        if f is not None:
            times.append((i * HOP + N / 2) / SR)
            feats.append(f)
    return np.array(times), np.array(feats)


class PhaseTracker:
    """Smoothed class probabilities -> phase + timing (identical in JS)."""

    def __init__(self, alpha=0.25, thr=0.55, min_frames=15):
        self.alpha, self.thr, self.min_frames = alpha, thr, min_frames
        self.p = np.array([1.0, 0.0, 0.0])
        self.phase = "rest"
        self.cand, self.cand_n = None, 0
        self.t = 0.0
        self.phase_start = 0.0
        self.last_in = None
        self.last_out = None
        self.last_in_start = None
        self.period = None

    def update(self, probs, dt=FRAME_S):
        self.t += dt
        self.p = (1 - self.alpha) * self.p + self.alpha * np.asarray(probs)
        k = int(np.argmax(self.p))
        name = CLASSES[k]
        if name != self.phase and self.p[k] >= self.thr:
            if self.cand == name:
                self.cand_n += 1
            else:
                self.cand, self.cand_n = name, 1
            if self.cand_n >= self.min_frames:
                start = self.t - self.cand_n * dt  # the switch happened when the candidate began
                dur = start - self.phase_start
                if self.phase == "in":
                    self.last_in = dur
                elif self.phase == "out":
                    self.last_out = dur
                if name == "in":
                    if self.last_in_start is not None:
                        self.period = start - self.last_in_start
                    self.last_in_start = start
                self.phase, self.phase_start = name, start
                self.cand, self.cand_n = None, 0
        else:
            self.cand, self.cand_n = None, 0
        return self.state()

    def state(self):
        return {
            "phase": self.phase, "since": self.t - self.phase_start,
            "lastIn": self.last_in, "lastOut": self.last_out, "period": self.period,
            "pIn": float(self.p[1]), "pOut": float(self.p[2]), "pRest": float(self.p[0]),
        }


class BreathModel:
    def __init__(self, spec):
        self.spec = spec
        self.mean = np.array(spec["scaler"]["mean"])
        self.scale = np.array(spec["scaler"]["scale"])
        self.layers = [(np.array(l["W"]), np.array(l["b"])) for l in spec["layers"]]
        post = spec.get("post", {})
        self.feat = FeatureStream()
        self.tracker = PhaseTracker(post.get("alpha", 0.25), post.get("thr", 0.55), post.get("minFrames", 15))
        self.buf = np.zeros(0)

    @classmethod
    def load(cls, path):
        with open(path) as f:
            return cls(json.load(f))

    def predict_proba(self, feats):
        x = (np.atleast_2d(feats) - self.mean) / self.scale
        for i, (w, b) in enumerate(self.layers):
            x = x @ w + b
            if i < len(self.layers) - 1:
                x = np.maximum(x, 0.0)
        x = x - x.max(1, keepdims=True)
        e = np.exp(x)
        return e / e.sum(1, keepdims=True)

    def push(self, pcm):
        """Feed any amount of 16 kHz audio; returns the latest state (or None before the first frame)."""
        self.buf = np.concatenate([self.buf, np.asarray(pcm, dtype=np.float64)])
        state = None
        while len(self.buf) >= N:
            frame = self.buf[:N]
            self.buf = self.buf[HOP:]
            lm = np.log10((np.abs(np.fft.rfft(frame * WIN)) ** 2) @ FB.T + 1e-10)
            f = self.feat.push_frame(lm)
            if f is None:
                continue
            state = self.tracker.update(self.predict_proba(f)[0])
        return state
