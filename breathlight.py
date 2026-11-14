#!/usr/bin/env python3
"""
breathlight.py - make a Briturn / Zengge Wi-Fi lamp follow your breathing.

Modes
  mic    (default) breathe close to the mic; the lamp swells with each breath
  guide  the lamp leads a calm pace (in 4 s, out 6 s) - reliable demo fallback
  sim    fake breathing signal, for testing without a mic

Install
  pip install flux_led sounddevice numpy

Run (from Terminal that has Local Network + Microphone permission)
  python3 breathlight.py                      # mic mode, default lamp IP
  python3 breathlight.py --mode guide
  python3 breathlight.py --dry                # no lamp, prints level bar + flatness
  python3 breathlight.py --list-devices       # pick a mic, then --device N

Tuning on a real mic
  python3 breathlight.py --record take1.wav   # 45 s guided take (quiet/breathe/talk)
  python3 breathlight.py --analyze take1.wav  # stats per segment + suggested --flat
  python3 breathlight.py --analyze take1.wav --flat 0.3 --gate 4   # try settings

Tips
  - Hackathon venues are loud: put the mic 2-5 cm from the nose
    (earbud/headset mic works great). Stay quiet for the first 3 s
    while it measures the room noise.
  - If the light reacts to talking, raise --flat (e.g. 0.4) or --gate (e.g. 6).
"""
import argparse
import math
import sys
import threading
import time
import wave
from collections import deque

import numpy as np

DEFAULT_IP = "192.168.202.186"

# Colour at "no breath" -> colour at "full breath"
LOW_RGB = (40, 70, 255)     # cool blue
HIGH_RGB = (255, 150, 60)   # warm amber
MIN_BRIGHT, MAX_BRIGHT = 15, 255

# How fast the shown light may move (level units per second). Keeps changes
# slow and smooth (flicker sensitivity) and hides any single-block glitch.
RISE_PER_S, FALL_PER_S = 1.2, 0.6
DEADBAND = 0.03             # don't send lamp updates smaller than this

SR, BLOCK, NFFT = 16000, 512, 1024
BAND = (400.0, 3000.0)

# Guided recording timeline: (label, seconds)
TAKE = [("quiet", 5), ("breathe", 15), ("talk", 10), ("breathe", 10), ("noise", 5)]
CUES = {
    "quiet": "Stay QUIET (measuring room)",
    "breathe": "BREATHE slowly near the mic (in through nose, out through mouth)",
    "talk": "TALK normally (count, read something aloud) - not breathing at mic",
    "noise": "Make everyday noise: tap the desk, clap once, type, move around",
}


class State:
    level = 0.0      # 0..1, written by the sensor, read by the lamp thread
    flat = 0.0       # latest smoothed flatness (for --dry display)
    gate_open = False
    running = True


S = State()


def mix(level):
    level = max(0.0, min(1.0, level))
    rgb = tuple(int(lo + (hi - lo) * level) for lo, hi in zip(LOW_RGB, HIGH_RGB))
    bright = int(MIN_BRIGHT + (MAX_BRIGHT - MIN_BRIGHT) * level)
    return rgb, bright


class Slew:
    """Limit how fast the displayed level can move."""
    def __init__(self):
        self.v = 0.0

    def step(self, target, dt):
        d = target - self.v
        d = max(-FALL_PER_S * dt, min(RISE_PER_S * dt, d))
        self.v += d
        return self.v


# ---------------------------------------------------------------- lamp output
def lamp_loop(ip, hz, dry):
    """Send the latest level to the lamp at a fixed rate; reconnect on errors."""
    lamp, last_sent = None, None
    period = 1.0 / hz
    slew = Slew()
    while S.running:
        t0 = time.time()
        shown = slew.step(S.level, period)
        if dry:
            bar = "#" * int(shown * 40)
            tag = "BREATH " if S.gate_open else "voice/-"
            print(f"\r[{bar:<40}] {shown:4.2f}  noise-like {S.flat:4.2f} {tag}",
                  end="", flush=True)
        elif last_sent is None or abs(shown - last_sent) >= DEADBAND or \
                (shown in (0.0, 1.0) and shown != last_sent):
            rgb, bright = mix(shown)
            try:
                if lamp is None:
                    from flux_led import WifiLedBulb
                    lamp = WifiLedBulb(ip, timeout=1)
                    lamp.turnOn()
                lamp.setRgb(*rgb, persist=False, brightness=bright, retry=1)
                last_sent = shown
            except Exception as e:            # lamp drops packets - just retry
                print(f"\n[lamp] {e!r} - reconnecting", file=sys.stderr)
                lamp = None
                time.sleep(0.5)
        time.sleep(max(0.0, period - (time.time() - t0)))


# ---------------------------------------------------------------- breath filter
class BreathFilter:
    """Turns 512-sample mic blocks into a 0..1 breath level.

    1. band power 400-3000 Hz
    2. spectral flatness over 6 sub-bands (hiss ~0.5, voice ~0.1-0.25);
       median-smoothed, with hysteresis, so the gate doesn't chatter
    3. sound that isn't hiss-like is pulled down to the room floor
    4. median over 9 blocks (~0.3 s) kills claps/clicks
    5. fast-attack / slow-release envelope, scaled between floor and ceiling
    """

    def __init__(self, gate_db=9.0, span_db=20.0, flat=0.52, raw=False,
                 calib_s=3.0, hyst=0.05, min_breath_s=0.2):
        self.gate_db, self.span_db, self.flat_thr = gate_db, span_db, flat
        self.raw, self.hyst = raw, hyst
        self.min_open = int(round(min_breath_s * SR / BLOCK))
        self.open_run = 0             # consecutive blocks the gate has been open
        f = np.fft.rfftfreq(NFFT, 1 / SR)
        self.band = (f >= BAND[0]) & (f <= BAND[1])
        edges = np.geomspace(BAND[0], BAND[1], 7)
        self.subs = [(f >= lo) & (f < hi) for lo, hi in zip(edges[:-1], edges[1:])]
        self.win = np.hanning(NFFT)
        self.buf = np.zeros(NFFT)
        self.flat_hist = deque(maxlen=7)
        self.db_hist = deque(maxlen=9)
        self.calib, self.calib_n = [], int(calib_s * SR / BLOCK)
        self.floor = self.ceil = self.env = None
        self.room = None              # raw room level (floor without gate)
        self.gate_open = False
        self.flat = 0.0
        self.db = 0.0

    def step(self, x):
        """Process one block; return level 0..1, or None while calibrating."""
        x = np.asarray(x, dtype=np.float64)
        x = x - x.mean()
        self.buf = np.concatenate([self.buf[len(x):], x])
        p = np.abs(np.fft.rfft(self.buf * self.win)) ** 2 + 1e-12
        db = 10 * np.log10(p[self.band].sum())
        fl = float(np.mean([np.exp(np.mean(np.log(p[m]))) / np.mean(p[m])
                            for m in self.subs]))
        self.flat_hist.append(fl)
        self.flat = float(np.median(self.flat_hist))
        self.db = db

        if self.floor is None:                       # calibrate room noise
            self.calib.append(db)
            if len(self.calib) >= self.calib_n:
                self.room = float(np.percentile(self.calib, 80))
                self.floor = self.room + self.gate_db
                self.ceil = self.floor + self.span_db
                self.env = self.room
            return None

        # hiss test with hysteresis: open above thr, close below thr - hyst
        if self.raw:
            self.gate_open = True
        elif self.gate_open:
            self.gate_open = self.flat >= self.flat_thr - self.hyst
        else:
            self.gate_open = self.flat >= self.flat_thr
        # short hiss bursts ("s", "sh", "f" in speech) must last before they count
        self.open_run = self.open_run + 1 if self.gate_open else 0
        is_breath = self.gate_open and (self.raw or self.open_run >= self.min_open)
        dbg = db if is_breath else min(db, self.room)

        self.db_hist.append(dbg)
        med = float(np.median(self.db_hist))

        env = self.env
        a = 0.35 if med > env else 0.08
        env += a * (med - env)
        self.env = env

        # room level follows quiet periods slowly (only when not breathing)
        if not self.gate_open:
            self.room += 0.002 * (db - self.room) if db > self.room else 0.05 * (db - self.room)
        self.floor = max(self.room + self.gate_db, min(self.floor + 0.003, env + self.gate_db))
        self.ceil = max(env, self.ceil - 0.02, self.floor + 8)

        lvl = (env - self.floor) / (self.ceil - self.floor)
        return max(0.0, min(1.0, lvl))


# ---------------------------------------------------------------- sensors
def mic_mode(device, filt):
    import sounddevice as sd

    announced = [False]

    def callback(indata, frames, t, status):
        lvl = filt.step(indata[:, 0])
        S.flat, S.gate_open = filt.flat, filt.gate_open
        if lvl is None:
            return
        if not announced[0]:
            print(f"Room noise measured ({filt.room:.1f} dB). Breathe!")
            announced[0] = True
        S.level = lvl

    print("Measuring room noise - stay quiet for 3 s...")
    with sd.InputStream(samplerate=SR, blocksize=BLOCK, channels=1,
                        device=device, callback=callback):
        while S.running:
            time.sleep(0.1)


def guide_mode(inhale=4.0, exhale=6.0):
    cycle = inhale + exhale
    t0, last_phase = time.time(), None
    while S.running:
        t = (time.time() - t0) % cycle
        if t < inhale:
            phase, p = "breathe in ", t / inhale
            S.level = 0.5 - 0.5 * math.cos(math.pi * p)        # ease up
        else:
            phase, p = "breathe out", (t - inhale) / exhale
            S.level = 0.5 + 0.5 * math.cos(math.pi * p)        # ease down
        if phase != last_phase:
            print(f"\n{phase}", end="", flush=True)
            last_phase = phase
        time.sleep(0.03)


def sim_mode(bpm=12):
    t0 = time.time()
    while S.running:
        S.level = 0.5 - 0.5 * math.cos(2 * math.pi * (time.time() - t0) * bpm / 60)
        time.sleep(0.03)


# ---------------------------------------------------------------- tuning tools
def record_take(path, device):
    import sounddevice as sd
    total = sum(d for _, d in TAKE)
    print(f"Recording {total} s to {path}. Follow the cues:\n")
    rec = sd.rec(int(total * SR), samplerate=SR, channels=1, dtype="int16",
                 device=device)
    t0 = time.time()
    for label, dur in TAKE:
        print(f"  [{time.time() - t0:4.0f}s] {CUES[label]}  ({dur} s)", flush=True)
        end = t0 + sum(d for _, d in TAKE[:TAKE.index((label, dur)) + 1])
        while time.time() < end:
            time.sleep(0.05)
    sd.wait()
    with wave.open(path, "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(SR)
        w.writeframes(rec.tobytes())
    print(f"\nSaved {path}\n")


def read_wav(path):
    with wave.open(path, "rb") as w:
        if w.getframerate() != SR or w.getsampwidth() != 2:
            sys.exit(f"{path}: need 16 kHz 16-bit wav (use --record)")
        x = np.frombuffer(w.readframes(w.getnframes()), dtype=np.int16)
        x = x.reshape(-1, w.getnchannels())[:, 0]
    return x.astype(np.float64) / 32768.0


def run_filter(x, **kw):
    """Run the full pipeline (filter + slew) on a signal; per-block arrays."""
    f = BreathFilter(**kw)
    slew = Slew()
    dt = BLOCK / SR
    out = {"t": [], "db": [], "flat": [], "open": [], "level": [], "loud": []}
    for i in range(len(x) // BLOCK):
        lvl = f.step(x[i * BLOCK:(i + 1) * BLOCK])
        shown = slew.step(lvl or 0.0, dt)
        out["t"].append((i + 0.5) * dt)
        out["db"].append(f.db)
        out["flat"].append(f.flat)
        out["open"].append(f.gate_open)
        out["level"].append(shown)
        out["loud"].append(f.room is not None and f.db > f.room + f.gate_db)
    return {k: np.array(v) for k, v in out.items()}


def segments():
    t = 0
    for label, dur in TAKE:
        yield label, t, t + dur
        t += dur


def analyze(path, gate, span, flat, raw, min_breath=0.2):
    x = read_wav(path)
    print(f"{path}: {len(x) / SR:.1f} s   settings: --flat {flat} --gate {gate}"
          f" --span {span} --min-breath {min_breath}{' --raw' if raw else ''}\n")
    r = run_filter(x, gate_db=gate, span_db=span, flat=flat, raw=raw,
                   min_breath_s=min_breath)

    print("(noise-like and gate-open are measured only on blocks louder than the room)\n")
    print(f"{'segment':<9}{'time':>10}  {'loud':>5}  {'noise-like p10/p50/p90':>23}"
          f"  {'gate open':>9}  {'lamp avg/max':>12}")
    stats = {}
    for label, a, b in segments():
        m = (r["t"] >= a + 0.5) & (r["t"] < b)       # skip transition
        if not m.any():
            continue
        ml = m & r["loud"]
        lamp = f"{r['level'][m].mean():5.2f}/{r['level'][m].max():4.2f}"
        if ml.sum() < 5:
            print(f"{label:<9}{a:>4}-{b:<4}s  {100 * ml.sum() / m.sum():4.0f}%"
                  f"  {'(too quiet to judge)':>23}  {'-':>9}  {lamp}")
            continue
        fl = r["flat"][ml]
        p10, p50, p90 = np.percentile(fl, [10, 50, 90])
        stats.setdefault(label, []).append(fl)
        print(f"{label:<9}{a:>4}-{b:<4}s  {100 * ml.sum() / m.sum():4.0f}%  "
              f"{p10:7.2f} {p50:7.2f} {p90:7.2f}  {100 * r['open'][ml].mean():8.0f}%"
              f"  {lamp}")

    # Sweep --flat and pick the value in the middle of the "good" range:
    # voice/noise keep the lamp dark, breath still lights it.
    if "breathe" not in stats:
        return
    print("\nSweep (lamp average per segment; want breathe high, talk/noise ~0):")
    print(f"  {'--flat':>6}  {'breathe':>8}  {'talk':>6}  {'noise':>6}")
    good = []
    for thr in np.round(np.arange(0.15, 0.66, 0.05), 2):
        rr = run_filter(x, gate_db=gate, span_db=span, flat=thr, min_breath_s=min_breath)
        avg = {}
        for lab in ("breathe", "talk", "noise"):
            m = np.zeros_like(rr["t"], dtype=bool)
            for label, a, b in segments():
                if label == lab:
                    m |= (rr["t"] >= a + 0.5) & (rr["t"] < b)
            avg[lab] = rr["level"][m].mean() if m.any() else 0.0
        ok = avg["talk"] <= 0.05 and avg["noise"] <= 0.05 and avg["breathe"] >= 0.15
        if ok:
            good.append(thr)
        print(f"  {thr:6.2f}  {avg['breathe']:8.2f}  {avg['talk']:6.2f}  "
              f"{avg['noise']:6.2f}  {'ok' if ok else ''}")
    print()
    if good:
        sug = good[len(good) // 2]
        print(f"Suggested: --flat {sug}   (works from {good[0]} to {good[-1]})")
    else:
        print("No --flat value separates breath from voice/noise on this take.\n"
              "Move the mic closer to the nose (2-5 cm), breathe a bit harder,\n"
              "or raise --gate, then record again.")


# ---------------------------------------------------------------- main
def main():
    ap = argparse.ArgumentParser(description="Breathing-controlled lamp")
    ap.add_argument("--ip", default=DEFAULT_IP)
    ap.add_argument("--mode", choices=["mic", "guide", "sim"], default="mic")
    ap.add_argument("--hz", type=float, default=6, help="lamp updates per second")
    ap.add_argument("--device", type=int, default=None, help="mic index")
    ap.add_argument("--gate", type=float, default=9, help="dB above room noise to ignore")
    ap.add_argument("--span", type=float, default=20, help="initial dB range of a breath")
    ap.add_argument("--flat", type=float, default=0.52,
                    help="noise-like threshold for breath (voice ~0.1-0.25)")
    ap.add_argument("--min-breath", type=float, default=0.2,
                    help="seconds a hiss must last to count as breath")
    ap.add_argument("--raw", action="store_true", help="filter off, plain loudness")
    ap.add_argument("--dry", action="store_true", help="no lamp, print level bar")
    ap.add_argument("--list-devices", action="store_true")
    ap.add_argument("--record", metavar="WAV", help="record a guided 45 s tuning take")
    ap.add_argument("--analyze", metavar="WAV", help="replay a take and print stats")
    args = ap.parse_args()

    if args.list_devices:
        import sounddevice as sd
        print(sd.query_devices())
        return
    if args.record:
        record_take(args.record, args.device)
        analyze(args.record, args.gate, args.span, args.flat, args.raw, args.min_breath)
        return
    if args.analyze:
        analyze(args.analyze, args.gate, args.span, args.flat, args.raw, args.min_breath)
        return

    threading.Thread(target=lamp_loop, args=(args.ip, args.hz, args.dry),
                     daemon=True).start()
    try:
        if args.mode == "mic":
            mic_mode(args.device, BreathFilter(args.gate, args.span, args.flat, args.raw,
                                                 min_breath_s=args.min_breath))
        elif args.mode == "guide":
            guide_mode()
        else:
            sim_mode()
    except KeyboardInterrupt:
        pass
    finally:
        S.running = False
        print("\nStopped.")


if __name__ == "__main__":
    main()
