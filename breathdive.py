#!/usr/bin/env python3
"""
breathdive.py - a pixel-art scuba dive driven by your breath and heart rate.

  Breathe in  -> the diver floats up.     Breathe out -> the diver sinks, bubbles rise.
  Every full breath brings the reef more to life: sunbeams, glowing reef edges,
  a fish school, a shipwreck, coral and kelp, reef fish, jellyfish, a sea turtle,
  and finally golden light. Slow breaths with long exhales count extra, and so
  does a heart rate that drops below where you started.

Breath input  (--breath)
  mic    (default) your trained BreathFilter from breathlight.py, same flags
         (--flat --gate --span --min-breath --raw --device)
  guide  the game breathes for you (in 4 s / out 6 s) - follow the diver
  keys   hold SPACE while breathing in, let go to breathe out (no mic needed)

  With a mic the game can't hear which way the air moves, so it uses
  --mic-scheme:
    alternate (default)  breath sounds alternate: in (nose), out (mouth).
                         Press P if it gets out of step. A pause > 8 s resets
                         it so the next sound counts as an in-breath.
    exhale               only the out-breath needs to be audible; the quiet gap
                         after it counts as the in-breath.

Heart input  (--hr)
  ble    any standard Bluetooth heart-rate sensor (Polar H10/Verity, Wahoo,
         Garmin with "broadcast HR", Coospo ...). --hr-device NAME picks one.
  sim    simulated heart rate (calms down as you breathe slowly)
  off    (default)

Install
  pip install pygame numpy sounddevice bleak      (flux_led too for --lamp)

Run
  python3 breathdive.py                          # mic breath, no heart sensor
  python3 breathdive.py --hr ble                 # + Bluetooth heart strap
  python3 breathdive.py --breath keys --hr sim   # try it with no hardware
  python3 breathdive.py --breath guide --lamp 192.168.202.186   # lamp follows too
  python3 breathdive.py --log session.csv        # save vitals for later

Keys in game:  SPACE breathe (keys mode)   P flip in/out   G pacer on/off
               F fullscreen   ESC quit
"""
import argparse
import asyncio
import csv
import math
import random
import sys
import threading
import time
from collections import deque

import pygame

W, H = 320, 180                 # low-res canvas, scaled up for the pixel look
WIN_W, WIN_H = 1280, 720


def clamp(v, lo=0.0, hi=1.0):
    return lo if v < lo else hi if v > hi else v


def lerp(a, b, t):
    return a + (b - a) * t


def lerpc(a, b, t):
    return tuple(int(lerp(x, y, t)) for x, y in zip(a, b))


# ============================================================ shared bio state
class Bio:
    def __init__(self):
        self.lock = threading.Lock()
        self.level = 0.0            # 0..1 breath sound / guide depth
        self.phase = "rest"         # "in" | "out" | "rest"
        self.breath_status = ""
        self.hr = None              # bpm
        self.hr_time = 0.0
        self.rr = deque(maxlen=60)  # RR intervals, seconds
        self.hr_status = "off"
        self.running = True
        self.tracker = None

    def push_hr(self, hr, rr):
        with self.lock:
            if hr:
                self.hr = hr
                self.hr_time = time.time()
            for r in rr:
                if 0.25 < r < 2.0:
                    self.rr.append(r)

    def rmssd_ms(self):
        with self.lock:
            rr = list(self.rr)[-30:]
        if len(rr) < 6:
            return None
        d = [(b - a) ** 2 for a, b in zip(rr, rr[1:])]
        return 1000 * math.sqrt(sum(d) / len(d))


# ============================================================ breath input
class BreathTracker:
    """Turns the 0..1 mic level into in / out / rest phases."""
    ON, OFF, OFF_HOLD, RESYNC = 0.12, 0.06, 0.35, 8.0

    def __init__(self, scheme):
        self.scheme = scheme
        self.active = False
        self.below_since = None
        self.n = 0
        self.last_end = None
        self.phase = "rest"

    def flip(self):
        self.n += 1
        if self.active:
            self.phase = "out" if self.phase == "in" else "in"

    def update(self, lvl, t):
        if not self.active:
            if lvl >= self.ON:
                self.active, self.below_since = True, None
                if self.last_end is None or t - self.last_end > self.RESYNC:
                    self.n = 0
                if self.scheme == "alternate":
                    self.phase = "in" if self.n % 2 == 0 else "out"
                else:
                    self.phase = "out"
        elif lvl < self.OFF:
            if self.below_since is None:
                self.below_since = t
            elif t - self.below_since > self.OFF_HOLD:
                self.active = False
                self.n += 1
                self.last_end = t
        else:
            self.below_since = None

        if not self.active:
            gap = t - self.last_end if self.last_end else 1e9
            self.phase = "in" if (self.scheme == "exhale" and gap < 6.0) else "rest"
        return self.phase


def start_mic(bio, args):
    from breathlight import BreathFilter, SR, BLOCK
    filt = BreathFilter(args.gate, args.span, args.flat, args.raw,
                        min_breath_s=args.min_breath)
    tracker = BreathTracker(args.mic_scheme)
    bio.tracker = tracker
    bio.breath_status = "mic: measuring room - stay quiet 3 s"

    def callback(indata, frames, t, status):
        lvl = filt.step(indata[:, 0])
        if lvl is None:
            return
        now = time.time()
        with bio.lock:
            bio.level = lvl
            bio.phase = tracker.update(lvl, now)
            bio.breath_status = "mic"

    def run():
        try:
            import sounddevice as sd
            with sd.InputStream(samplerate=SR, blocksize=BLOCK, channels=1,
                                device=args.device, callback=callback):
                while bio.running:
                    time.sleep(0.1)
        except Exception as e:
            bio.breath_status = f"mic error: {e}  (try --breath keys)"
            print(f"[mic] {e!r}", file=sys.stderr)

    threading.Thread(target=run, daemon=True).start()


# ============================================================ heart input (BLE)
HRS_UUID = "0000180d-0000-1000-8000-00805f9b34fb"
HRM_UUID = "00002a37-0000-1000-8000-00805f9b34fb"


def parse_hrm(data):
    """Standard Heart Rate Measurement characteristic -> (bpm, [rr seconds])."""
    flags, i = data[0], 1
    if flags & 0x01:
        hr, i = int.from_bytes(data[1:3], "little"), 3
    else:
        hr, i = data[1], 2
    if flags & 0x08:                     # energy expended present
        i += 2
    rr = []
    if flags & 0x10:                     # RR intervals, 1/1024 s
        while i + 1 < len(data):
            rr.append(int.from_bytes(data[i:i + 2], "little") / 1024.0)
            i += 2
    return hr, rr


async def ble_loop(bio, name):
    from bleak import BleakClient, BleakScanner
    while bio.running:
        bio.hr_status = "scanning for heart sensor..."
        found = None
        try:
            seen = await BleakScanner.discover(timeout=6.0, return_adv=True)
        except Exception as e:
            bio.hr_status = f"Bluetooth error: {e}"
            await asyncio.sleep(3)
            continue
        for dev, adv in seen.values():
            dn = (dev.name or adv.local_name or "")
            if name:
                ok = name.lower() in dn.lower() or name.lower() == dev.address.lower()
            else:
                ok = HRS_UUID in [u.lower() for u in (adv.service_uuids or [])]
            if ok:
                found = (dev, dn or dev.address)
                break
        if not found:
            bio.hr_status = "no heart sensor found - is it on / broadcasting?"
            await asyncio.sleep(2)
            continue
        dev, label = found
        bio.hr_status = f"connecting to {label}..."
        try:
            async with BleakClient(dev) as client:
                await client.start_notify(
                    HRM_UUID, lambda _, d: bio.push_hr(*parse_hrm(bytearray(d))))
                bio.hr_status = label
                while bio.running and client.is_connected:
                    await asyncio.sleep(0.5)
        except Exception as e:
            bio.hr_status = f"lost {label}: {e}"
            await asyncio.sleep(2)


def scan_ble():
    from bleak import BleakScanner
    print("Scanning 8 s... (on the watch: start a workout with heart-rate broadcast on)")
    seen = asyncio.run(BleakScanner.discover(timeout=8.0, return_adv=True))
    makers = {0x0157: "Huami/Amazfit", 0x004C: "Apple", 0x006B: "Polar", 0x0087: "Garmin",
              0x0075: "Samsung", 0x00E0: "Google", 0x0310: "Wahoo", 0x0059: "Nordic"}
    rows = []
    for dev, adv in seen.values():
        uuids = [u.lower() for u in (adv.service_uuids or [])]
        hrs = HRS_UUID in uuids
        mk = ", ".join(makers.get(k, f"0x{k:04X}") for k in (adv.manufacturer_data or {}))
        name = dev.name or adv.local_name or "?"
        tag = "HEART" if hrs else "WATCH?" if "Amazfit" in mk else ""
        rows.append((not hrs, "Amazfit" not in mk, name == "?", adv.rssi, tag, name, dev.address, mk))
    for _, _, _, rssi, tag, name, addr, mk in sorted(rows):
        if tag or name != "?":
            print(f"  {tag:<6} {rssi:4d} dBm  {name:<26} {addr}  {mk}")
    print(f"  ... {sum(1 for r in rows if r[2] and not r[4])} unnamed devices hidden")
    if not any(r[4] == "HEART" for r in rows):
        print("\nNo heart-rate sensor seen. On the watch, start a workout with "
              "'Heart rate broadcast' on, keep it near, and scan again.")
        if any(r[4] == "WATCH?" for r in rows):
            print("An Amazfit device IS nearby (WATCH?) but is not broadcasting heart rate.")
    else:
        print("\nRun:  python3 breathdive.py --hr ble --hr-device <name or address>")


def start_ble(bio, name):
    def run():
        try:
            asyncio.run(ble_loop(bio, name))
        except Exception as e:
            bio.hr_status = f"Bluetooth unavailable: {e}"
    threading.Thread(target=run, daemon=True).start()


# ============================================================ pixel sprites
PAL = {
    "K": (18, 18, 28), "B": (40, 110, 235), "b": (60, 150, 255),
    "G": (150, 152, 165), "L": (215, 218, 228), "D": (85, 88, 100),
    "O": (245, 135, 40), "C": (55, 140, 255), "W": (255, 255, 255),
}

# Facing right. Fins left, tank on the back, orange-framed mask on the right.
DIVER = [
    [
        "........................KKKK....",
        "...............DDDDDDD.KKKKKK...",
        "..............DLLLLLLLDKKOOOOOO.",
        "..............DGGGGGGGDKOCCCWCO.",
        "..............DGGGGGGGDKOCCCCCO.",
        "...........KKKKKKKKKKKKKKOOOOOO.",
        "bbb...KKKKKKBBBBBBBBBBBKKKKKDD..",
        ".bbbbKKKKKKKKKKKKKKKKKKKBBKKDDD.",
        "..bbbbKKKKK......KKKKKKKKBBOO...",
        "......................OO....OO..",
    ],
    [
        "........................KKKK....",
        "...............DDDDDDD.KKKKKK...",
        "..............DLLLLLLLDKKOOOOOO.",
        "..............DGGGGGGGDKOCCCWCO.",
        "..............DGGGGGGGDKOCCCCCO.",
        "...........KKKKKKKKKKKKKKOOOOOO.",
        "......KKKKKKBBBBBBBBBBBKKKKKDD..",
        "..bbbKKKKKKKKKKKKKKKKKKKBBKKDDD.",
        "bbbbbbKKKKK......KKKKKKKKBBOO...",
        "bbb...................OO....OO..",
    ],
]

FISH = [
    "T..XX..",
    "TTXXXX.",
    "TXXXXEX",
    "TTXXXX.",
    "T..XX..",
]

TURTLE = [
    [
        ".....SSSSSS.......",
        "...SSsSSsSSsS.....",
        "..SsSSsSSsSSsSHHH.",
        ".SSSSSSSSSSSSSHHEH",
        "..SSSSSSSSSSSS.HH.",
        ".FF.........FF....",
        "FF...........FF...",
    ],
    [
        ".....SSSSSS.......",
        "...SSsSSsSSsS.....",
        "FFSsSSsSSsSSsSHHH.",
        ".SSSSSSSSSSSSSHHEH",
        "..SSSSSSSSSSSS.HH.",
        "..FF........FF....",
        "..............F...",
    ],
]
TURTLE_PAL = {"S": (96, 128, 60), "s": (165, 185, 85), "H": (125, 180, 110),
              "E": (15, 15, 20), "F": (110, 165, 95)}

HEART = [".XX.XX.", "XXXXXXX", "XXXXXXX", ".XXXXX.", "..XXX..", "...X..."]


def sprite(rows, pal):
    w = max(len(r) for r in rows)
    s = pygame.Surface((w, len(rows)), pygame.SRCALPHA)
    for y, row in enumerate(rows):
        for x, ch in enumerate(row):
            if ch in pal:
                s.set_at((x, y), pal[ch])
    return s


def fish_sprite(body):
    tail = lerpc(body, (0, 0, 0), 0.35)
    return sprite(FISH, {"X": body, "T": tail, "E": (10, 10, 15)})


# ============================================================ the scene
STAGES = [
    (0.0, "The deep is dark and quiet. Breathe."),
    (1.0, "Sunbeams reach down to you"),
    (2.0, "The reef edges begin to glow"),
    (3.0, "A school of fish passes by"),
    (5.0, "An old shipwreck appears"),
    (7.0, "Coral and kelp bloom on the reef"),
    (9.0, "Bright reef fish come to say hello"),
    (11.0, "Jellyfish drift in the blue"),
    (14.0, "A sea turtle swims alongside you"),
    (17.0, "Golden light - the reef is fully alive"),
]
MAX_BEAUTY = 18.0
PERIOD = 640                     # width of the repeating scenery strip


def heightmap(rng, lo, hi, step=2):
    terms = [(k, rng.uniform(0.3, 1.0) / k ** 0.6, rng.uniform(0, 6.28))
             for k in (1, 2, 3, 5, 7, 11)]
    raw = []
    for x in range(PERIOD):
        v = sum(a * math.sin(2 * math.pi * k * x / PERIOD + p) for k, a, p in terms)
        raw.append(v)
    mn, mx = min(raw), max(raw)
    out = []
    for v in raw:
        h = lo + (hi - lo) * (v - mn) / (mx - mn)
        out.append(H - int(h) // step * step)
    return out


def rock_layer(rng, tops, body, rim, speck):
    s = pygame.Surface((PERIOD, H), pygame.SRCALPHA)
    for x, y in enumerate(tops):
        pygame.draw.line(s, body, (x, y), (x, H))
        s.set_at((x, y), rim)
        s.set_at((x, y + 1), rim)
        if tops[x - 1] < y or tops[(x + 1) % PERIOD] < y:   # step edges
            s.set_at((x, y + 2), lerpc(rim, body, 0.5))
    for _ in range(PERIOD * 2):
        x = rng.randrange(PERIOD)
        y = rng.randrange(tops[x] + 4, H + 4)
        if y < H:
            s.fill(speck, (x, y, 2, 1))
    return s


class Scene:
    def __init__(self, seed=7):
        rng = random.Random(seed)
        self.rng = random.Random(seed + 1)
        self.layers = []
        specs = [  # (lo, hi, parallax, body dull, body bright, rim dull, rim bright)
            (60, 118, 0.18, (16, 36, 66), (28, 86, 130), (26, 58, 86), (90, 210, 220)),
            (34, 84, 0.45, (10, 26, 52), (16, 62, 108), (34, 74, 100), (70, 230, 220)),
            (14, 44, 1.0, (5, 14, 32), (10, 40, 82), (36, 84, 110), (110, 255, 235)),
        ]
        for lo, hi, par, b0, b1, r0, r1 in specs:
            tops = heightmap(rng, lo, hi)
            st = rng.getstate()
            dull = rock_layer(rng, tops, b0, r0, lerpc(b0, (0, 0, 0), 0.3))
            rng.setstate(st)
            bright = rock_layer(rng, tops, b1, r1, lerpc(b1, (255, 255, 255), 0.12))
            self.layers.append({"tops": tops, "par": par, "dull": dull, "bright": bright})

        self.ship = self.make_ship(self.layers[1]["tops"])
        self.coral, self.kelp = self.make_reef(rng, self.layers[2]["tops"])
        self.school = [(rng.uniform(-22, 22), rng.uniform(-10, 10), rng.uniform(0, 6.28))
                       for _ in range(34)]
        self.snow = [[rng.uniform(0, W), rng.uniform(0, H), rng.uniform(2, 6)]
                     for _ in range(45)]
        self.sparkles = [[rng.uniform(0, W), rng.uniform(60, H), rng.uniform(0, 6.28)]
                         for _ in range(40)]
        self.fish, self.fish_timer = [], 0.0
        self.fish_sprites = [fish_sprite(c) for c in
                             [(255, 200, 40), (255, 110, 70), (90, 220, 255),
                              (255, 120, 200), (140, 255, 140), (250, 250, 250)]]
        self.jellies = [{"x": rng.uniform(40, 300), "y": rng.uniform(40, 150),
                         "p": rng.uniform(0, 6.28), "vx": rng.uniform(-3, 3)}
                        for _ in range(5)]
        self.turtle_x, self.turtle_y = -40.0, 70.0
        self.turtle_imgs = [sprite(r, TURTLE_PAL) for r in TURTLE]

    # ---------------------------------------------------------------- builders
    @staticmethod
    def make_ship(tops):
        s = pygame.Surface((PERIOD, H), pygame.SRCALPHA)
        x0 = 330
        base = max(tops[x0:x0 + 90]) - 4
        hull = (10, 20, 40)
        pts = [(x0, base - 18), (x0 + 12, base - 12), (x0 + 70, base - 10),
               (x0 + 86, base - 16), (x0 + 80, base + 6), (x0 + 6, base + 6)]
        pygame.draw.polygon(s, hull, pts)
        for i in range(6):                                   # planks / holes
            s.fill(lerpc(hull, (0, 0, 0), 0.4), (x0 + 18 + i * 9, base - 6, 3, 2))
        pygame.draw.line(s, hull, (x0 + 30, base - 11), (x0 + 22, base - 52), 2)
        pygame.draw.line(s, hull, (x0 + 12, base - 40), (x0 + 36, base - 44), 1)
        pygame.draw.line(s, hull, (x0 + 58, base - 10), (x0 + 66, base - 36), 2)
        pygame.draw.line(s, hull, (x0 + 54, base - 30), (x0 + 74, base - 26), 1)
        pygame.draw.line(s, hull, (x0 + 66, base - 36), (x0 + 72, base - 31), 1)
        return s

    @staticmethod
    def make_reef(rng, tops):
        s = pygame.Surface((PERIOD, H), pygame.SRCALPHA)
        cols = [(240, 120, 200), (180, 100, 235), (255, 145, 90), (255, 200, 120),
                (220, 90, 140)]
        for _ in range(34):
            x = rng.randrange(PERIOD)
            y = tops[x] + 1
            c = rng.choice(cols)
            kind = rng.random()
            for dx in (0, -PERIOD, PERIOD):
                cx = x + dx
                if kind < 0.45:                              # brain/blob coral
                    r = rng.randint(3, 6)
                    pygame.draw.circle(s, c, (cx, y), r)
                    pygame.draw.circle(s, lerpc(c, (255, 255, 255), 0.4), (cx - 1, y - r + 1), 1)
                elif kind < 0.8:                             # branching coral
                    for b in range(rng.randint(3, 5)):
                        bx = cx + rng.randint(-4, 4)
                        hh = rng.randint(4, 10)
                        pygame.draw.line(s, c, (cx, y), (bx, y - hh))
                        s.set_at((bx, y - hh), lerpc(c, (255, 255, 255), 0.5))
                else:                                        # fan coral
                    for a in range(-3, 4):
                        pygame.draw.line(s, c, (cx, y), (cx + a * 2, y - 8 + abs(a)))
        kelp = [(rng.randrange(PERIOD), rng.randint(14, 34), rng.uniform(0, 6.28))
                for _ in range(26)]
        return s, kelp

    # ---------------------------------------------------------------- per frame
    def update(self, dt, t, beauty):
        for p in self.snow:
            p[1] += p[2] * dt * 0.6
            p[0] += math.sin(t * 0.5 + p[2]) * dt * 2
            if p[1] > H:
                p[0], p[1] = self.rng.uniform(0, W), -2
        f = clamp(beauty - 9)
        self.fish_timer -= dt
        if f > 0 and self.fish_timer <= 0 and len(self.fish) < 3 + int(f * 7):
            right = self.rng.random() < 0.5
            self.fish.append({
                "x": -10.0 if right else W + 10.0, "y": self.rng.uniform(40, 150),
                "v": self.rng.uniform(10, 24) * (1 if right else -1),
                "img": self.rng.choice(self.fish_sprites), "p": self.rng.uniform(0, 6.28)})
            self.fish_timer = self.rng.uniform(0.6, 2.0)
        for fi in self.fish:
            fi["x"] += fi["v"] * dt
        self.fish = [fi for fi in self.fish if -20 < fi["x"] < W + 20]
        for j in self.jellies:
            pulse = max(0.0, math.sin(t * 1.6 + j["p"]))
            j["y"] -= (2 + 9 * pulse) * dt
            j["x"] += j["vx"] * dt
            if j["y"] < -20:
                j["y"], j["x"] = H + 15, self.rng.uniform(30, 290)
        if clamp(beauty - 14) > 0:
            self.turtle_x += 7 * dt
            if self.turtle_x > W + 40:
                self.turtle_x, self.turtle_y = -60.0, self.rng.uniform(45, 95)

    def draw_strip(self, canvas, surf, cam, par, alpha=255):
        if alpha <= 0:
            return
        off = int(cam * par) % PERIOD
        surf.set_alpha(alpha)
        canvas.blit(surf, (-off, 0))
        canvas.blit(surf, (PERIOD - off, 0))
        surf.set_alpha(255)

    def draw_back(self, canvas, t, cam, beauty):
        b = clamp(beauty / MAX_BEAUTY)
        # banded water gradient
        top = lerpc((20, 36, 66), (70, 190, 215), b)
        bot = lerpc((4, 10, 24), (14, 60, 118), b)
        bands = 18
        for i in range(bands):
            canvas.fill(lerpc(top, bot, i / (bands - 1)), (0, i * H // bands, W, H // bands + 1))

        # surface shimmer
        shimmer = lerpc((40, 70, 110), (200, 250, 255), b)
        for row in range(5):
            y = 2 + row * 4
            for k in range(14):
                x = (k * 29 + row * 13 + int(math.sin(t * 0.8 + k + row) * 6) + int(t * (3 + row))) % (W + 30) - 15
                canvas.fill(shimmer, (x, y + int(math.sin(t + k) * 1.5), 10 - row, 1))

        # sun rays
        f = clamp(beauty - 1)
        if f > 0:
            rays = pygame.Surface((W, H), pygame.SRCALPHA)
            for i in range(6):
                x = 30 + i * 52 + math.sin(t * 0.25 + i * 1.7) * 14
                w = 8 + (i % 3) * 5
                pygame.draw.polygon(rays, (200, 245, 255, int(26 * f)),
                                    [(x, 0), (x + w, 0), (x + w * 2.4 - 30, H), (x - 40, H)])
            canvas.blit(rays, (0, 0))

        # far rocks
        L = self.layers
        g = clamp(beauty / 6)                 # rock rims brighten over the first breaths
        self.draw_strip(canvas, L[0]["dull"], cam, L[0]["par"])
        self.draw_strip(canvas, L[0]["bright"], cam, L[0]["par"], int(255 * g))

        # fish school silhouette
        f = clamp(beauty - 3)
        if f > 0:
            cx = (t * 12) % (W + 120) - 60
            cy = 50 + math.sin(t * 0.2) * 12
            col = lerpc(top, (10, 25, 50), 0.55)
            for i, (dx, dy, p) in enumerate(self.school[:int(f * len(self.school))]):
                x = int(cx + dx + math.sin(t * 1.3 + p) * 2)
                y = int(cy + dy + math.cos(t * 1.1 + p) * 1.5)
                canvas.fill(col, (x, y, 3, 2))
                canvas.set_at((x - 1, y), col)

        self.draw_strip(canvas, L[1]["dull"], cam, L[1]["par"])
        self.draw_strip(canvas, L[1]["bright"], cam, L[1]["par"], int(255 * g))
        # shipwreck (rests on the middle rocks)
        self.draw_strip(canvas, self.ship, cam, L[1]["par"], int(255 * clamp(beauty - 5)))

        # jellyfish
        f = clamp(beauty - 11)
        if f > 0:
            glow = pygame.Surface((W, H), pygame.SRCALPHA)
            for j in self.jellies[:max(1, int(f * len(self.jellies)))]:
                pulse = max(0.0, math.sin(t * 1.6 + j["p"]))
                x, y = int(j["x"]), int(j["y"])
                r = 5 + int(pulse * 1.5)
                pygame.draw.circle(glow, (255, 150, 230, int(40 * f)), (x, y), r + 5)
                pygame.draw.ellipse(glow, (255, 170, 235, int(220 * f)), (x - r, y - 4, r * 2, 8))
                glow.fill((0, 0, 0, 0), (x - r, y + 1, r * 2, 4))
                glow.fill((255, 230, 250, int(255 * f)), (x - 2, y - 2, 2, 1))
                for k in range(4):
                    tx = x - r + 2 + k * (2 * r - 3) // 3
                    for s in range(9):
                        glow.set_at((tx + int(math.sin(t * 2 + s * 0.6 + k) * 1.2), y + 1 + s),
                                    (255, 160, 220, int((180 - s * 14) * f)))
            canvas.blit(glow, (0, 0))

        # sea turtle
        f = clamp(beauty - 14)
        if f > 0:
            img = self.turtle_imgs[int(t * 2) % 2]
            img.set_alpha(int(255 * f))
            y = self.turtle_y + math.sin(t * 0.7) * 3
            canvas.blit(pygame.transform.scale(img, (img.get_width() * 2, img.get_height() * 2)),
                        (int(self.turtle_x), int(y)))

    def draw_front(self, canvas, t, cam, beauty):
        L = self.layers
        g = clamp(beauty / 6)
        near = L[2]
        off = int(cam * near["par"]) % PERIOD

        # kelp grows behind the near rocks
        f = clamp(beauty - 7)
        if f > 0:
            for x, hgt, p in self.kelp:
                sx = (x - off) % PERIOD
                if sx > W + 4:
                    continue
                base = near["tops"][x] + 2
                n = int(hgt * f)
                for s in range(n):
                    sway = math.sin(t * 1.2 + p + s * 0.18) * (s * 0.12)
                    c = (40, 170, 90) if s % 4 else (90, 215, 120)
                    canvas.fill(c, (int(sx + sway), base - s, 2, 1))

        self.draw_strip(canvas, near["dull"], cam, near["par"])
        self.draw_strip(canvas, near["bright"], cam, near["par"], int(255 * g))
        self.draw_strip(canvas, self.coral, cam, near["par"], int(255 * clamp(beauty - 7)))

        # reef fish
        for fi in self.fish:
            img = fi["img"] if fi["v"] > 0 else pygame.transform.flip(fi["img"], True, False)
            canvas.blit(img, (int(fi["x"]), int(fi["y"] + math.sin(t * 2 + fi["p"]) * 2)))

        # marine snow
        snow = lerpc((60, 90, 120), (220, 250, 255), clamp(beauty / MAX_BEAUTY))
        for x, y, _ in self.snow:
            canvas.set_at((int(x), int(y)), snow)

        # golden light + bioluminescent sparkles
        f = clamp(beauty - 17)
        if f > 0:
            warm = pygame.Surface((W, H), pygame.SRCALPHA)
            for i in range(6):
                warm.fill((255, 210, 120, int((30 - i * 5) * f)), (0, i * 12, W, 12))
            for x, y, p in self.sparkles:
                a = (math.sin(t * 2 + p) + 1) / 2
                warm.set_at((int(x), int(y)), (150, 255, 240, int(255 * a * f)))
            canvas.blit(warm, (0, 0))


# ============================================================ diver + bubbles
class Diver:
    def __init__(self):
        self.frames = [sprite(f, PAL) for f in DIVER]
        self.x, self.y, self.vy = 92.0, 110.0, 0.0
        self.kick = 0.0
        self.bubbles = []
        self.bubble_acc = 0.0

    def update(self, dt, t, lung, phase, level):
        target = 138 - lung * 82                 # inhale floats up, exhale sinks
        target += math.sin(t * 0.9) * 2           # gentle bob
        prev = self.y
        self.y += (target - self.y) * min(1.0, dt * 2.5)
        self.vy = (self.y - prev) / max(dt, 1e-3)
        self.x = 92 + math.sin(t * 0.3) * 6
        self.kick += dt * (2.2 + abs(self.vy) * 0.08)

        if phase == "out":                        # exhale -> bubbles
            self.bubble_acc += dt * (5 + 12 * level)
            while self.bubble_acc > 1:
                self.bubble_acc -= 1
                self.bubbles.append([self.x + 29, self.y - 2, random.choice((1, 1, 2, 2, 3)),
                                     random.uniform(0, 6.28)])
        for b in self.bubbles:
            b[1] -= (14 + b[2] * 6) * dt
            b[0] += math.sin(t * 4 + b[3]) * 6 * dt
        self.bubbles = [b for b in self.bubbles if b[1] > 4]

    def draw(self, canvas):
        img = self.frames[int(self.kick) % 2]
        ang = clamp(-self.vy * 0.9, -14, 14)
        if abs(ang) > 1:
            img = pygame.transform.rotate(img, ang)
        canvas.blit(img, img.get_rect(center=(int(self.x + 16), int(self.y + 5))))
        for x, y, r, _ in self.bubbles:
            x, y = int(x), int(y)
            if r == 1:
                canvas.set_at((x, y), (190, 230, 255))
            else:
                pygame.draw.circle(canvas, (70, 140, 245), (x, y), r)
                pygame.draw.circle(canvas, (200, 235, 255), (x, y), r, 1)
                canvas.set_at((x - 1, y - 1), (255, 255, 255))


# ============================================================ breath counting
class BreathCounter:
    """Counts full breaths (an in-phase followed by an out-phase) and scores them."""

    def __init__(self):
        self.phase, self.since = "rest", time.time()
        self.in_dur = 0.0
        self.count = 0
        self.ends = deque(maxlen=6)
        self.last_cycle = None

    def update(self, phase, t):
        if phase == self.phase:
            return None
        dur = t - self.since
        result = None
        if self.phase == "in":
            self.in_dur = dur
        elif self.phase == "out" and self.in_dur > 0.6 and dur > 0.8:
            self.count += 1
            self.ends.append(t)
            self.last_cycle = (self.in_dur, dur)
            result = (self.in_dur, dur)
            self.in_dur = 0.0
        self.phase, self.since = phase, t
        return result

    def rate(self):
        if len(self.ends) < 2:
            return None
        e = list(self.ends)
        return 60.0 * (len(e) - 1) / (e[-1] - e[0])


# ============================================================ HUD
class Hud:
    def __init__(self):
        pygame.font.init()
        self.big = pygame.font.Font(None, 40)
        self.mid = pygame.font.Font(None, 30)
        self.small = pygame.font.Font(None, 22)
        self.heart = sprite(HEART, {"X": (255, 70, 90)})

    def text(self, screen, s, pos, font=None, col=(235, 245, 255), shadow=True, center=False):
        font = font or self.mid
        img = font.render(s, False, col)
        r = img.get_rect()
        if center:
            r.center = pos
        else:
            r.topleft = pos
        if shadow:
            screen.blit(font.render(s, False, (0, 10, 25)), r.move(2, 2))
        screen.blit(img, r)

    def panel(self, screen, rect):
        p = pygame.Surface(rect.size, pygame.SRCALPHA)
        p.fill((0, 15, 35, 150))
        pygame.draw.rect(p, (110, 230, 235, 200), p.get_rect(), 2)
        screen.blit(p, rect.topleft)


# ============================================================ main
def main():
    ap = argparse.ArgumentParser(description="Breath-controlled pixel scuba dive")
    ap.add_argument("--breath", choices=["mic", "guide", "keys"], default="mic")
    ap.add_argument("--mic-scheme", choices=["alternate", "exhale"], default="alternate")
    ap.add_argument("--inhale", type=float, default=4.0, help="pacer / guide inhale seconds")
    ap.add_argument("--exhale", type=float, default=6.0, help="pacer / guide exhale seconds")
    ap.add_argument("--hr", choices=["off", "ble", "sim"], default="off")
    ap.add_argument("--hr-device", default=None, help="BLE name (part) or address")
    ap.add_argument("--lamp", metavar="IP", default=None,
                    help="also drive the Wi-Fi lamp from breathlight.py")
    ap.add_argument("--log", metavar="CSV", default=None, help="save vitals to CSV")
    ap.add_argument("--fullscreen", action="store_true")
    ap.add_argument("--scan-ble", action="store_true",
                    help="list nearby Bluetooth devices (marks heart-rate sensors) and exit")
    ap.add_argument("--list-devices", action="store_true", help="list microphones and exit")
    # your BreathFilter tuning (same as breathlight.py)
    ap.add_argument("--device", type=int, default=None, help="mic index")
    ap.add_argument("--gate", type=float, default=9)
    ap.add_argument("--span", type=float, default=20)
    ap.add_argument("--flat", type=float, default=0.52)
    ap.add_argument("--min-breath", type=float, default=0.2)
    ap.add_argument("--raw", action="store_true")
    # testing helpers
    ap.add_argument("--start-beauty", type=float, default=0.0, help=argparse.SUPPRESS)
    ap.add_argument("--snap", default=None, help=argparse.SUPPRESS)
    ap.add_argument("--snap-after", type=float, default=3.0, help=argparse.SUPPRESS)
    args = ap.parse_args()

    if args.list_devices:
        import sounddevice as sd
        print(sd.query_devices())
        return
    if args.scan_ble:
        scan_ble()
        return

    bio = Bio()
    if args.breath == "mic":
        start_mic(bio, args)
    elif args.breath == "keys":
        bio.breath_status = "keys: hold SPACE to breathe in"
    else:
        bio.breath_status = f"guide: in {args.inhale:g}s / out {args.exhale:g}s"
    if args.hr == "ble":
        start_ble(bio, args.hr_device)
    elif args.hr == "sim":
        bio.hr_status = "simulated"

    lamp = None
    if args.lamp:
        import breathlight as lamp
        threading.Thread(target=lamp.lamp_loop, args=(args.lamp, 6, False), daemon=True).start()

    log_f = log_w = None
    if args.log:
        log_f = open(args.log, "w", newline="")
        log_w = csv.writer(log_f)
        log_w.writerow(["t_s", "phase", "breath_level", "lung", "hr_bpm", "rmssd_ms",
                        "breaths", "breaths_per_min", "scene"])

    pygame.init()
    flags = pygame.SCALED | pygame.RESIZABLE | (pygame.FULLSCREEN if args.fullscreen else 0)
    screen = pygame.display.set_mode((WIN_W, WIN_H), flags)
    pygame.display.set_caption("Breath Dive")
    canvas = pygame.Surface((W, H))
    clock = pygame.time.Clock()

    scene, diver, counter, hud = Scene(), Diver(), BreathCounter(), Hud()
    beauty = beauty_target = args.start_beauty
    stage_idx = max(i for i, (th, _) in enumerate(STAGES) if beauty >= th)
    message, message_t = STAGES[stage_idx][1], time.time()
    lung, cam = 0.3, 0.0
    show_pacer = args.breath != "guide"
    t0 = time.time()
    last_log = 0.0
    hr_hist = deque()                     # (t, hr)
    baseline, baseline_buf = None, []     # resting HR from the first ~20 s
    sim_next_beat, sim_hr = t0, 76.0
    reward_flash, reward_text = 0.0, ""

    running = True
    while running:
        dt = min(clock.tick(60) / 1000.0, 0.1)
        now = time.time()
        t = now - t0

        for e in pygame.event.get():
            if e.type == pygame.QUIT:
                running = False
            elif e.type == pygame.KEYDOWN:
                if e.key in (pygame.K_ESCAPE, pygame.K_q):
                    running = False
                elif e.key == pygame.K_f:
                    pygame.display.toggle_fullscreen()
                elif e.key == pygame.K_g:
                    show_pacer = not show_pacer
                elif e.key == pygame.K_p and bio.tracker:
                    with bio.lock:
                        bio.tracker.flip()
                        bio.phase = bio.tracker.phase

        # ---------------------------------------------------- breath -> phase/level
        cycle = args.inhale + args.exhale
        pt = t % cycle
        pacer_phase = "in" if pt < args.inhale else "out"
        pacer_v = (0.5 - 0.5 * math.cos(math.pi * pt / args.inhale) if pt < args.inhale
                   else 0.5 + 0.5 * math.cos(math.pi * (pt - args.inhale) / args.exhale))

        if args.breath == "guide":
            phase, level = pacer_phase, 0.6
            lung = pacer_v
        else:
            if args.breath == "keys":
                held = pygame.key.get_pressed()[pygame.K_SPACE]
                if held:
                    phase = "in"
                elif counter.phase == "in" or (counter.phase == "out" and now - counter.since < 8 and lung > 0.02):
                    phase = "out"
                else:
                    phase = "rest"
                level = 0.6 if phase != "rest" else 0.0
                with bio.lock:
                    bio.phase, bio.level = phase, level
            else:
                with bio.lock:
                    phase, level = bio.phase, bio.level
            drive = max(0.35, level)
            if phase == "in":
                lung += dt * (0.12 + 0.3 * drive)
            elif phase == "out":
                lung -= dt * (0.08 + 0.22 * drive)
            lung = clamp(lung)
        if lamp:
            lamp.S.level = lung

        done = counter.update(phase, now)
        if done:
            ind, outd = done
            gain = 1.0
            notes = []
            if outd >= ind:
                gain += 0.4
                notes.append("long exhale")
            if ind + outd >= 7.0:
                gain += 0.4
                notes.append("slow")
            if baseline and hr_hist and sum(h for _, h in hr_hist) / len(hr_hist) < baseline - 2:
                gain *= 1.25
                notes.append("heart calming")
            beauty_target = min(MAX_BEAUTY, beauty_target + gain)
            reward_flash = 1.0
            reward_text = f"+{gain:.1f}" + (f"  {' · '.join(notes)}" if notes else "")

        beauty += clamp(beauty_target - beauty, 0, dt * 0.6)
        new_idx = max(i for i, (th, _) in enumerate(STAGES) if beauty >= th)
        if new_idx != stage_idx:
            stage_idx = new_idx
            message, message_t = STAGES[new_idx][1], now
        reward_flash = max(0.0, reward_flash - dt * 0.5)

        # ---------------------------------------------------- heart
        if args.hr == "sim" and now >= sim_next_beat:
            calm = 76 - 12 * clamp(beauty / MAX_BEAUTY)
            sim_hr += (calm - sim_hr) * 0.05
            inst = sim_hr + 5 * (lung - 0.5) + random.gauss(0, 0.8)   # RSA: up on inhale
            rr = 60.0 / inst
            bio.push_hr(round(inst), [rr])
            sim_next_beat = now + rr
        with bio.lock:
            hr = bio.hr if bio.hr and now - bio.hr_time < 5 else None
        if hr:
            hr_hist.append((now, hr))
        while hr_hist and now - hr_hist[0][0] > 10:
            hr_hist.popleft()
        if baseline is None and hr:
            baseline_buf.append((now, hr))
            if now - baseline_buf[0][0] > 20:
                baseline = sum(h for _, h in baseline_buf) / len(baseline_buf)
        rmssd = bio.rmssd_ms()

        # ---------------------------------------------------- world
        cam += dt * 10
        scene.update(dt, t, beauty)
        diver.update(dt, t, lung, phase, level)

        scene.draw_back(canvas, t, cam, beauty)
        diver.draw(canvas)
        scene.draw_front(canvas, t, cam, beauty)
        sw, sh = screen.get_size()
        screen.blit(pygame.transform.scale(canvas, (sw, sh)), (0, 0))

        # ---------------------------------------------------- HUD
        rate = counter.rate()
        hud.panel(screen, pygame.Rect(16, 16, 330, 150))
        label = {"in": "BREATHE IN  ^", "out": "BREATHE OUT v", "rest": "resting"}[phase]
        hud.text(screen, label, (30, 28), hud.big,
                 (255, 210, 120) if phase == "in" else (140, 210, 255) if phase == "out" else (180, 190, 200))
        pygame.draw.rect(screen, (20, 40, 70), (30, 68, 300, 14))
        pygame.draw.rect(screen, (255, 200, 110), (30, 68, int(300 * lung), 14))
        pygame.draw.rect(screen, (110, 230, 235), (30, 68, 300, 14), 2)
        hud.text(screen, f"breaths {counter.count}", (30, 92))
        hud.text(screen, f"{rate:4.1f} /min" if rate else "  -- /min", (200, 92))
        hud.text(screen, f"scene {stage_idx + 1}/{len(STAGES)}", (30, 122))
        hud.text(screen, bio.breath_status[:34], (150, 128), hud.small, (170, 200, 220))

        hud.panel(screen, pygame.Rect(sw - 290, 16, 274, 150))
        if hr:
            beat = (t * hr / 60.0) % 1.0
            k = 7 if beat < 0.15 else 6
        else:
            k = 6
        heart = pygame.transform.scale(hud.heart, (7 * k, 6 * k))
        screen.blit(heart, heart.get_rect(center=(sw - 245, 62)))
        hud.text(screen, f"{hr:3d} bpm" if hr else " -- bpm", (sw - 200, 46), hud.big)
        hud.text(screen, f"HRV {rmssd:3.0f} ms" if rmssd else "HRV  -- ms", (sw - 270, 96))
        if baseline and hr_hist:
            d = sum(h for _, h in hr_hist) / len(hr_hist) - baseline
            hud.text(screen, f"{d:+.0f} vs start", (sw - 120, 96), hud.small,
                     (140, 255, 170) if d < 0 else (255, 190, 150))
        hud.text(screen, ("heart: " + bio.hr_status)[:34], (sw - 270, 128), hud.small, (170, 200, 220))

        age = now - message_t
        if age < 6:
            a = clamp(min(age, 6 - age))
            hud.text(screen, message, (sw // 2, sh - 70), hud.big,
                     lerpc((0, 20, 40), (255, 245, 210), a), center=True)
        if reward_flash > 0:
            hud.text(screen, reward_text, (int(diver.x * sw / W) + 70, int(diver.y * sh / H) - 40),
                     hud.mid, lerpc((0, 30, 60), (255, 240, 150), reward_flash), center=True)

        if show_pacer:
            cx, cy = sw - 80, sh - 90
            r = int(20 + 34 * pacer_v)
            pygame.draw.circle(screen, (110, 230, 235), (cx, cy), 56, 2)
            pygame.draw.circle(screen, (60, 140, 245), (cx, cy), r)
            pygame.draw.circle(screen, (210, 240, 255), (cx, cy), r, 2)
            hud.text(screen, "in" if pacer_phase == "in" else "out", (cx, cy), hud.mid, center=True)
        hud.text(screen, "SPACE breathe (keys)  P flip in/out  G pacer  F fullscreen  ESC quit",
                 (18, sh - 28), hud.small, (150, 180, 205))

        pygame.display.flip()

        if log_w and now - last_log >= 0.25:
            last_log = now
            log_w.writerow([f"{t:.2f}", phase, f"{level:.3f}", f"{lung:.3f}", hr or "",
                            f"{rmssd:.1f}" if rmssd else "", counter.count,
                            f"{rate:.2f}" if rate else "", stage_idx + 1])
        if args.snap and t >= args.snap_after:
            pygame.image.save(screen, args.snap)
            running = False

    bio.running = False
    if lamp:
        lamp.S.running = False
    if log_f:
        log_f.close()
    pygame.quit()
    print(f"Dive over: {counter.count} breaths, reached scene {stage_idx + 1}/{len(STAGES)}.")


if __name__ == "__main__":
    main()
