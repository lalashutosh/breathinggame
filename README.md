# ΑΝΑΣΑ (anasa)

*Greek for “breath”.* One calm game in three modes, **minimalist**, **retro** and **immersive**,
around one shared garden. Finishing any mode earns a sapling to plant.

* **`web/`** – the landing page: a shared pixel-art community garden with one card per mode.
  Each mode takes about a minute (demo length) and ends with an arrival.
  * **Immersive** (Greenfold) – the valley walk (`greenfold/`, Godot 4). From the landing page it
    opens fullscreen in its own window when the page is served by `serve.py` on a machine with
    Godot; anywhere else the card runs the browser edition (`web/games/greenfold-web/`).
  * **Retro** (Breath Dive) – pixel diver, five moods, mic / keys / pacer, optional heart strap.
  * **Minimalist** (Drift) – one small light over a quiet lake, five moods.
* **`breathdive.py`** – the full desktop Breath Dive, driven by a real microphone and a
  Bluetooth heart-rate sensor.
* **`greenfold/`** – the Godot project (`godot --path greenfold --fullscreen` to run it alone).

## Landing page

Greenfold from the hub: `serve.py` exposes `GET /api/greenfold/status`, `POST /api/greenfold/launch`
(starts Godot fullscreen with `--report`/`--session`/`--hub`; set `GODOT_BIN` if `godot` is not on
`PATH`) and `POST|GET /api/greenfold/result`. Godot posts its result when the walk ends; the card
polls for it and hands out the sapling. In hub mode the end screen button reads "Back to the garden"
and closes the window.

```bash
python3 serve.py --open          # http://127.0.0.1:8000, garden saved to garden.json
```

The garden fills the first screen; the title, the community counter, the game cards and
the planting controls float over it. `serve.py` serves `web/` and a two-endpoint API
(`GET /api/garden`, `POST /api/garden/contributions`) so every visitor sees the same
garden; the page polls for other people's trees. Opened as plain static files it falls
back to `localStorage`. Add `?time=day|dusk|night` to preview a time of day,
`?play=breath-dive` to deep-link into the game, `?debug=1` to surface errors and get a
`window.mindplay` dev hook.

### Moods (browser Breath Dive)

The setup screen asks how you are arriving: **Just dive**, **Anxious**, **Overwhelmed**, **Low** or
**Restless** (`web/js/games/breathdive/moods.js`). Same reef, different weather; each mood starts
by matching you and drifts to its goal as you dive (iso principle):

| mood | starts as | ends as | pace (s / breath) |
|---|---|---|---|
| Just dive | dark, quiet deep | golden, fully alive reef | 4.6 → 10 |
| Anxious | storm on the surface, rain, surge, murky | still, clear turquoise | 3.4 → 10 |
| Overwhelmed | thick silt, almost nothing in view | silt settles, a few gentle things | 4 → 10 |
| Low | cold pre-dawn water, no life | sunrise, warm light, busy reef (lifts, not sedates) | 4.6 → 8 |
| Restless | moonlit night dive | dark and still, soft glowing plankton | 4.2 → 11 |

A hidden world rhythm (40 % rise, 60 % fall) mirrors your own pace for the first 20 s, then leads
toward the mood's pace; light, kelp and drifting particles move with it, and the pacer ring follows
it. Breaths move the dive on, and a slow time floor makes sure the water always reaches its calm end.
The end screen shows breaths/min start → end and one small real-world step. The game fills the
window and asks for browser fullscreen on start (`F` toggles).

### Drift (minimalist game)

`web/js/games/drift/` · `?play=drift`. One small light over a quiet lake: hold (mouse, touch,
`SPACE`) to lift it, let go to let it settle, and follow the glowing ribbon. The ribbon is the hidden
world rhythm (40 % rise, 60 % fall, mirror → lead), so following it with your hand sets a slow
rhythm without anyone being told to breathe. No holds, no numbers, nothing to lose: lights you meet
on the ribbon drift up and become stars. Same five moods as Breath Dive, as single-horizon scenes:
wind and rain clearing to a still golden evening, fog lifting, grey pre-dawn to sunrise with birds,
moonlit night to dark rest. "Let the light find its own way" is an easy mode that steers for you.
Fullscreen on start (`F` toggles); the end card shows rhythm per minute, time in flow, lights
gathered and one small real-world step. The game module was drafted by a Verda-hosted agent from
`web/js/games/drift/tasks/game.md`, then tuned.

### Sensing, breathing cues and the heart reward (all three modes)

| | breath | heart | where to switch it on |
|---|---|---|---|
| Minimalist | microphone (breath adds to sync; hands still steer) | Bluetooth strap | setup screen: "Listen to my breathing", "Connect heart sensor" |
| Retro | microphone / keys / pacer | Bluetooth strap | setup screen |
| Immersive (browser) | microphone / simulated / Space | Bluetooth strap | demo view: "Microphone", "Connect heart sensor" |
| Immersive (Godot) | microphone via `sensors/bridge.py` | Bluetooth strap via `sensors/bridge.py` | hub card checkboxes before "Open the valley" |

* **Cues:** every mode plays a soft rising sound as the world rhythm turns to the in-breath and a
  warm falling tone as it turns to the out-breath (`web/js/lib/calm.js`; Godot `audio_engine.gd`).
* **Heart reward:** a baseline is learned over the first 20 s; each further 2 bpm drop of the 10 s
  average (at most every 12 s) triggers a reward. Never a penalty. Retro: golden ripples, sparkles,
  a warm wash, a little more reef life. Minimalist: a warm bloom from the light and a shower of new
  stars. Immersive: flowers burst open, the lantern blooms, warm light and motes. All play a warm
  rising chime and show "your heart is settling" for a moment.
* **Godot bridge:** `serve.py` starts `sensors/bridge.py` (reusing `breathdive.py`'s microphone and
  Bluetooth code) next to Godot; it posts to `POST /api/sensors`, Godot polls `GET /api/sensors`.
  One-time setup:

  ```bash
  uv venv --python /usr/bin/python3 --system-site-packages sensors/.venv
  uv pip install --python sensors/.venv/bin/python sounddevice bleak
  ```

  Bluetooth must be switched on; the bridge connects to the first heart-rate strap it finds.

### Breath in/out model (microphone)

The microphone is read by a small trained model instead of a hand-tuned loudness filter, once one
exists at `web/models/breath.json` (until then the old detector is used).

1. **Record:** `python3 serve.py`, open `/tools/breath-recorder.html`. Pick the mic, check breaths show
   in the live picture, then follow the guided session (~2 or ~3½ min: quiet, three paces, your own
   pace, a sentence read aloud, quiet). **Hold SPACE while breathing in, let go to breathe out**: the
   key presses are the labels. Saves `<id>.wav` (16 kHz mono) + `<id>.json` to `dataset/raw/`
   (git-ignored: it is personal audio). Record 5+ sessions: different paces, nose/mouth, mic
   positions, rooms.
2. **Train:** the page's "Train the model" button, or `python3 ml/train_breath.py`. Holds out whole
   sessions, reports frame accuracy, switch timing error, missed/extra switches, in/out duration and
   breath period error, and writes `web/models/breath.json`.
3. **Use:** every mode's microphone option and the Godot sensor bridge pick it up automatically. It
   reports the phase (in/out/rest), seconds since the last switch, the last in and out durations
   and the breath period. "Try the model live" on the recorder page shows it.

Model: 32 ms frames, 24 log-mel bands with a running noise floor, 320 ms causal context, a 32-unit
MLP, then a phase tracker (smoothing + 0.24 s minimum dwell). Python (`ml/breath_model.py`) and JS
(`web/js/lib/breathmodel.js`) give identical outputs. `ml/make_synthetic.py` makes fake sessions to
test the pipeline only.

### Sensors in the browser game

Breath Dive's setup screen offers three breath sources and an optional heart sensor:

| source | how |
|---|---|
| Microphone | `web/js/lib/sensors.js` ports `BreathFilter` (band power 400-3000 Hz, spectral-flatness hiss gate, medians, envelope) and `BreathTracker` (alternate / exhale schemes, `P` flips in/out). Stay quiet for 3 s after starting so it can measure the room. |
| Hold a key or button | `SPACE`, the big button, or a finger on the canvas; same lung model as `--breath keys`. |
| Follow the pacer | 4 s in / 6 s out, like `--breath guide`. |
| Bluetooth heart rate | Web Bluetooth, standard Heart Rate Service, same `parse_hrm` logic. Shows bpm, HRV (RMSSD over 30 beats) and the change against the first 20 s; a heart that calms 2 bpm below that baseline multiplies the breath's reward by 1.25, as in the desktop game. |

Microphone and Bluetooth need a secure page (https or localhost). Web Bluetooth works in
Chrome and Edge on desktop and Android; Safari and Firefox fall back to the other inputs.
Apple Watch does not broadcast over Bluetooth; use a strap or a re-broadcasting app.

How it fits together (vanilla ES modules, no build step):

| file | role |
|---|---|
| `web/js/config/games.js` | game registry: title, availability, reward, lazy `load()` |
| `web/js/games/panel.js`, `thumbs.js` | the three cards and their pixel thumbnails |
| `web/js/games/breathdive/index.js` | Game 1; a module exporting `mount(container, { onComplete, onExit })` |
| `web/js/lib/sensors.js` | microphone breath filter/tracker and Bluetooth heart-rate client |
| `web/js/garden/garden.js` | canvas scene: mountains, treeline, river, fenced plot with slots, growth stages, planting/growing animations, wildlife milestones |
| `web/js/garden/sprites.js` | tree kinds (apple, cherry, birch, pine) × 3 stages, wild trees, decor |
| `web/js/garden/store.js` | contributions + rewards; `LocalGardenStore` / `RemoteGardenStore` share one interface |
| `web/js/main.js` | reward flow: game → sapling → pick a spot → tree |

A **contribution** is `{ id, type, kind, slot: {col,row}, plantedAt, visitorId, gameId }`.
Trees start as sprouts and advance a stage after 2 / 6 later plantings or 12 / 48 hours
(`GROWTH` in `garden.js`). Butterflies, flowers, birds, pond life and a bench appear as the
count grows (`MILESTONES`). To add a game, append an entry to `games.js` and have its
module call `onComplete()` once; the reward type can later be a flower or bush, since the
store and garden treat contributions generically.

# Breath Dive (desktop)

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
