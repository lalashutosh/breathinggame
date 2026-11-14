# Breath Dive

A pixel-art scuba dive that follows your breath and heart rate.

* **Breathe in** → the diver floats up. **Breathe out** → the diver sinks and blows bubbles.
* Every full breath brings the reef to life, scene by scene: sunbeams, glowing reef edges,
  a school of fish, a shipwreck, coral and kelp, reef fish, jellyfish, a sea turtle, golden light.
* Slow breaths (≥ 7 s) and long exhales earn extra; so does a heart rate that drops
  below where you started.

## Install

```bash
pip install pygame numpy sounddevice bleak
```

(`flux_led` too if you want the lamp from `breathlight.py` to follow along.)

## Run

```bash
python3 breathdive.py                          # mic breath (your trained filter), no heart sensor
```

```bash
python3 breathdive.py --hr ble                 # + any Bluetooth heart-rate strap/armband
```

```bash
python3 breathdive.py --breath keys --hr sim   # try it with no hardware: hold SPACE to inhale
```

```bash
python3 breathdive.py --breath guide --lamp 192.168.202.186 --log session.csv
```

## Breath input

`--breath mic` reuses `BreathFilter` from `breathlight.py` unchanged, so all of your
tuning flags work here too: `--flat --gate --span --min-breath --raw --device`.
Stay quiet for the first 3 s while it measures the room.

A microphone hears *that* you are breathing, not which direction, so:

| `--mic-scheme` | how it decides in vs. out |
|---|---|
| `alternate` (default) | breath sounds alternate in / out. Press **P** if it gets out of step; a pause longer than 8 s resets so the next sound is an in-breath. |
| `exhale` | only the out-breath needs to be audible (mouth exhale near the mic); the quiet gap after it counts as the in-breath. |

## Heart input

`--hr ble` connects to any sensor that speaks the standard Bluetooth Heart Rate
Service (Polar H10 / Verity Sense, Wahoo TICKR, Garmin HRM or watch in broadcast
mode, Coospo, ...). `--hr-device polar` picks one by name. It reads bpm and RR
intervals, so the HUD shows live HR, HRV (RMSSD over the last 30 beats) and the
change versus your resting baseline from the first 20 s.

Apple Watch does not broadcast HR over Bluetooth; use a chest strap or armband,
or an app that re-broadcasts (e.g. HeartCast / BlueHeart) and point `--hr-device` at it.

## Keys

`SPACE` breathe (keys mode) · `P` flip in/out · `G` pacer circle on/off · `F` fullscreen · `ESC` quit

## Log

`--log session.csv` saves 4 rows/second: time, phase, breath level, lung fill, HR, HRV,
breath count, breaths/min and scene number.
