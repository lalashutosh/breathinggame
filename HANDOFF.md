# Greenfold: handoff for the Godot build

Project: Aalto "Beyond the Clinic" hackathon (Nov 2026). The challenge is keeping people well at home after depression treatment (TMS). It is judged 25% each on usefulness, ease of use, smart sensing, and creativity.

This file is the source of truth for **what the game must feel like and why**. It also explains how the browser prototype works, so it can be rebuilt in Godot 4 (GDScript). A separate section sets the shared intent for the two sister games (retro and minimalist).

---

## 1. The product in one paragraph

People who are anxious or low escape into things that numb them now and make them worse later, such as doomscrolling. Greenfold redirects that urge into a calm game. You wander a valley, gently gather stray sheep, and the world around you moves to a slow, hidden breathing rhythm. **Breathing is a side effect of play, not a task.** The player's attention stays on the world, not on their body. A sensor, plugged in later, reads breathing passively. When the player's breath falls into step with the world, the world gets richer and warmer. Nothing ever punishes them.

**Takeaway line:** *Play the game; calm breathing happens on its own.*

---

## 2. Non-negotiable design rules

Every feature, asset and line of copy is checked against these.

1. **Nothing to lose.** No score, no fail state, no timer pressure, no streaks, no guilt notifications. A miss is "the world is plainer", never "you did it wrong". The audience is people for whom failing confirms "I'm bad at this".
2. **Breath is never the controller.** Hands move the player; breath only changes how the world responds. If breath steered, attention would go back to the body.
3. **Never tell them to breathe.** The cue is the world itself: wind, light, sound. At most, one optional line the first time: *"The valley breathes. Rise with it, settle with it."*
4. **Low effort to start, okay to stop.** Playable in under 10 seconds, and 90 seconds counts as a full session. Sessions **end** (about 2 to 3 min) with an arrival. This is the opposite of an infinite feed.
5. **Low stimulation.** Slow movement, soft edges, low contrast, no pop-ups, no numbers on screen, no flashing, no sudden sounds.
6. **Start where they are, guide them somewhere better** (the "iso principle" from music therapy). The world first matches the player's state and pace, then drifts gently toward calm. This applies to breath pace, visuals and music alike.
7. **Low mood needs lifting, not sedating.** Anxiety is calmed down, low mood is warmed up. This distinction matters to the TMS judges.
8. **Safety.** Slow breathing only, no breath holds, no fast patterns. An easy exit at any time. Framed as a complement to care, never a treatment claim. Motion comfort: no head bob, smooth camera.

---

## 3. Core loop: cue, feedback, control

Three separate loops. **Hands move you. The world sets a rhythm. Breath shows up only in how the world responds.**

### 3.1 The cue: one hidden rhythm drives the world

- There is one global clock, `worldPhase` (0 to 1), with period `worldP` seconds.
- The wave shape is asymmetric: **40% rise (in-phase), 60% fall (out-phase)**, so a longer exhale is built in.
  - Prototype: `shape(ph) = ph<0.4 ? 0.5-0.5cos(π·ph/0.4) : 0.5+0.5cos(π·(ph-0.4)/0.6)`, giving `worldVal` from 0 to 1.
- **Pacing:**
  - **Mirror** (first ~10 s): `worldP` equals the player's measured breath period, so they are in sync from the first second.
  - **Lead** (rest of the session): the target eases from the mood's `period[0]` to `period[1]` as the session progresses. `worldP` follows the target smoothly, never jumps.
  - Typical: 4.6 s down to 10 s, i.e. about 13 down to 6 breaths/min. Check the target pace with the lab mentors.
- **What the rhythm drives today:**
  - A band of wind sweeps across the valley, bending grass and swaying trees.
  - A drone gets louder and brighter on the rise.
  - A soft note plays at the peak when the player is in flow, and the flock's bells answer it.

**Gap to fix first:** in-phase and out-phase are currently only distinguishable by direction of change, so players can't easily tell them apart. Give them opposite qualities, using all channels together:

| Channel | In-phase (inhale): rise, open, brighten, build | Out-phase (exhale, longer): fall, settle, soften, release |
|---|---|---|
| Sound | Airy whoosh builds, pitch slides up | Warm low tone falls away |
| Light | Scene brightens, sun glow swells | Softens back down |
| Grass and trees | Grass lifts upright, leaves turn up | Grass bows and settles |
| Particles | Pollen and fireflies drift upward | Drift slowly down |
| Player lantern | Glow expands | Shrinks to a soft core |
| Camera | FOV widens a tiny fraction | Eases back (keep this tiny: motion comfort) |

**The turn is the landmark.** A soft chime at the top of each wave, where in becomes out, gives the body one clear beat to lock onto. The bottom of the wave stays quiet.

### 3.2 The feedback: how closely breath matches the wind

- **Instant match:** `inst = clamp(1 - 2.3·|worldVal - breathVal|, 0, 1)`.
- **Smoothed:** `sync += (inst - sync)·min(1, dt·0.45)`. This gives about 2 s of smoothing, so one off breath doesn't flicker anything.
- **Improve in the Godot build:** compare **phase** (timing), not wave height. Height-only matching can score a slightly lagging breath well at some points in the cycle.
- `sync` **only adds**. Low sync means a plainer world, never a penalty sound.

| As sync rises (0 to 1) | Effect |
|---|---|
| Flowers | A circle of flowers opens around the player, radius `3 + 42·sync` m |
| Lantern | Glow scale `2.6 + 5·sync`, point light `0.4 + 1.1·sync` |
| Music | Harmony pads fade in at sync > 0.3, 0.5 and 0.7; drone filter brightens |
| Flock | Sheep walk closer (follow distance shrinks with sync) |
| Pace | Walk speed up to about +25%; the weather moves to its calm end state faster (session progress rate `0.55 + 0.9·sync`, so the world still reaches calm even at zero sync) |
| Flow note | A soft note at each wave peak when sync > 0.55 |
| Time in flow | Counted when sync > 0.55 (shown on the end screen) |

### 3.3 Player control: hands only, deliberately simple

- **Walk:** hold the mouse button, a finger, or W. Release to stop. Base speed is 4.3 m/s.
- **Turn:** the pointer's distance from screen centre sets the turn rate. A/D and arrow keys also turn.
- **Sheep:** walk within about 8 m of a stray and it joins the flock with a bell note. Strays wander slowly and have a soft light above them, visible from afar.
- **Camera:** third person, about 9.5 m behind and 4.3 m above, smooth yaw follow, no head bob, and it stays above the terrain.
- **To add:** a "walk the path" mode where holding one button follows a gentle path loop. This is for low-energy users and phones.

### 3.4 Breath input interface

Build breath as a swappable source from day one so the sensor plugs in later. GDScript has no interfaces, so use a base class:

```gdscript
# breath_source.gd
class_name BreathSource extends Node
func get_value() -> float: return 0.0          # 0..1, current point in the breath
func get_period() -> float: return 5.0         # seconds per breath
func is_valid() -> bool: return true
```

The game holds one `BreathSource` node and never cares which subclass it is.

- **SimulatedBreath:** starts at the mood's pace, drifts and gradually locks onto the world rhythm. Used for hands-free demos.
- **ManualBreath:** hold a key to breathe in, release to breathe out (debug).
- **SensorBreath (later):** a Bluetooth heart-rate strap, where heart rate rises and falls with each breath (respiratory sinus arrhythmia) and yields both breath and HRV. Alternatives are a pendant (motion sensor plus contact mic) or a camera.

---

## 4. Moods: same valley, different weather

The menu is one screen: **"Just walk"** (quick play), plus four mood chips. One tap and you're in.

- **Smart touch (later):** read breath in the first 20 s and pre-highlight a suggested mood ("Anxious?"). The user still chooses.
- **Learning loop:** track which mood, scene, pace and time of day actually shift each person's breath and HRV.

Each mood is a **start preset and an end preset**. Every parameter interpolates by eased session progress `e`. In Godot this is one `MoodPreset` custom `Resource` (a `.tres` file) per mood, with a `MoodDirector` autoload that lerps everything; adding a mood means adding data, not code.

| Mood | Starts as (match) | Ends as (goal) | Pace (s/breath) | Music |
|---|---|---|---|---|
| **Just walk** | Late golden afternoon | Sunset, a few stars | 4.6 → 10 | C, major |
| **Anxious** | Grey, windy, rain, fast clouds, choppy lake | Still golden evening, rain gone | 3.4 → 10 | A minor → C major |
| **Overwhelmed** | Thick fog, almost nothing visible, very sparse | Fog lifts, gentle detail returns slowly | 4 → 10 | G, major, sparse |
| **Low** | Grey-blue pre-dawn, stars, quiet, no life | **Sunrise**, birdsong, flowers, warmth, more life | 4.6 → 8 (lifts, doesn't sedate) | A minor → C major |
| **Restless** | Dim moonlit meadow | Darker, quieter, ends near black and silence | 4.2 → 11 | F, major, drone fading |

### Preset parameters (from the prototype; tune freely)

`[start, end]` pairs. Colours are hex.

| Param | Just walk | Anxious | Overwhelmed | Low | Restless |
|---|---|---|---|---|---|
| sky top/mid/horizon (start) | 2b3a67 / e8846b / ffd59a | 1c2433 / 3a4a63 / 6f8399 | aab4bf / c3cbd2 / dfe3e6 | 1b2233 / 39435a / 5d667a | 0c1230 / 1c2752 / 3a4674 |
| sky top/mid/horizon (end) | 1d2550 / c9577a / ffb37a | 243056 / b0688a / f6b48a | 8fb0c2 / cfe0dc / f3ead8 | 3f6fb0 / f7a072 / ffe3a3 | 04060f / 0a0f24 / 141a36 |
| grass | 7aa24c → 6a9048 | 4c6258 → 789c50 | a9b8a6 → 8fb486 | 3d4b46 → 86b454 | 22364a → 16243a |
| sun height (0 = horizon) | .20 → .07 | .02 → .10 | .30 → .26 | −.09 → .20 | .34 → .20 (moon) |
| sun colour | fff1c9 → ffd08a | b9c6d6 → ffd9a8 | f4f4f0 → fff6dc | ffb38a → fff3c4 | e9ecff → c9cfee |
| stars | 0 → .35 | 0 → .25 | 0 → 0 | .5 → 0 | .9 → .45 |
| clouds | .55 → .40 | .95 → .30 | .10 → .30 | .50 → .45 | .25 → .10 |
| wind/chop | .35 → .12 | 1.0 → .12 | .10 → .10 | .15 → .25 | .25 → .06 |
| mist/fog | .15 → .10 | .30 → .10 | .90 → .30 | .50 → .12 | .25 → .20 |
| rain | 0 | .90 → 0 | 0 | 0 | 0 |
| scene detail | .80 → .90 | .90 → .85 | .05 → .60 | .50 → 1.0 | .70 → .50 |
| life (birds, pollen) | .60 → .80 | 0 → .70 | 0 → .40 | 0 → 1.0 | 0 |
| root note (Hz) | 130.81 | 110 → 130.81 | 98 | 110 → 130.81 | 87.31 |

### End screen and the real-world step

The end screen shows breaths/min (start → end), time in flow, and sheep found, plus **one tiny real-world step** per mood. Small steps like these (behavioural activation) are an established depression treatment, and they stop the game being an escape of its own:

- Just walk: *open a window and let the real sky in for a minute.*
- Anxious: *put the kettle on, and stay with it while it warms.*
- Overwhelmed: *pick a single item near you and put it where it belongs.*
- Low: *open the curtains, or step outside for two minutes.*
- Restless: *put the phone face down, across the room.*

---

## 5. Visual direction: what the world must contain, and why

The principle: **show the environments humans evolved in and still find restorative.** Every element below is there for a documented reason, so don't drop them for style.

| Element | Why | How to use it in Godot |
|---|---|---|
| **Natural fractals** (branching trees, ridgelines, clouds, coastlines) | Stress recovery is notably better when viewing mid-complexity natural fractals (fractal dimension about 1.3 to 1.5, Taylor). Too simple bores; too complex overloads. | Layered ridgelines on the horizon, branching trees, varied clouds. Avoid flat repeating textures and busy noise. |
| **Soft fascination** (drifting clouds, swaying grass, rippling water, sunsets) | Gentle, moderate stimuli hold attention without effort and let the mind rest (attention restoration theory, Kaplan). This is the opposite of a feed's "hard fascination". | Something should always be slowly moving somewhere in view. Nothing should demand attention. |
| **Water** | Views of water are linked to lower psychological distress, partly through light on water and its sound. | A lake in the valley with reflections and a sun path; a stream later. Water sound in the mix. |
| **Green, natural vegetation** | Nature imagery aids stress recovery. Green works best as *wild* vegetation, not lawns or sports fields. | Meadow grass, mixed forest, wildflowers. No manicured or built spaces. |
| **Golden-hour light** (sunrise / sunset) | The classic soft-fascination scene. Warm, low light carries most of the mood. | Sunrise is the "lift" arc (Low). Sunset is the "settle" arc (Anxious, Just walk). Use the sky gradient and fog colour heavily. |
| **Prospect and refuge** | People feel safest with an open view plus a sheltered spot nearby. | Open meadows with tree edges. A sheltered start point looking out over the valley. |
| **Low stimulation** | Restorative scenes avoid harsh contrast and rapid movement. | Soft fog for depth, low contrast, limited palette per mood, slow everything. |
| **Living things, gently** | Birds, sheep and fireflies signal a safe environment. | A small flock, distant birds, pollen and fireflies. No threats or predators, nothing startling. |

**Art style:** an original stylised low-poly look with painterly light (soft gradients, atmospheric fog layers, warm rim light). Firewatch and Herdling are reference points for *mood and atmosphere* only. Don't copy their assets, characters or signature art.

**Hard "never" list:** jump scares, enemies, harsh red warnings, flashing, loud stingers, on-screen counters or scores, damage or health, darkness the player can't get out of (except the deliberate Restless wind-down).

---

## 6. Audio direction

- **Tempo carries the effect** (Bernardi et al.). Slow music slows breathing; tempo matters more than key. Music tempo and the breath target are one parameter.
- **About 10-second phrases**, so each musical swell is one breath at 6 breaths/min.
- **Pauses help.** Moments where the music drops to just nature sound.
- **Nature bed:** water plus birdsong at a gentle level (about 50 dB equivalent, never loud). Rain only in Anxious, and it fades.
- **Generative, no lyrics.** Layers fade in and out, and react to sync and the wave. Use a pentatonic scale so any layer combines without clashing.
- **Rewards are notes, not stingers.** Soft plucks and bells, consonant, with long decays.
- **Iso principle per mood:** minor and sparse to major and fuller for Anxious and Low; near-silence to a few layers for Overwhelmed; a drone fading to silence for Restless.
- **Godot:** `AudioStreamPlayer` layers on separate audio buses, with volumes and filter effects driven by `sync`, `worldVal`, mood and session progress. Generated tones can use `AudioStreamGenerator`. CC0 nature recordings from Freesound (`.ogg`).

---

## 7. Godot build plan

Target **Godot 4.4+ (standard build, GDScript)** with the **Forward+** renderer. Claude Code drives the editor through the Coding-Solo `godot-mcp` server (launch editor, run project, read debug output, create scenes and nodes) and writes `.gd`, `.tscn`, `.tres` and `.gdshader` files directly.

**Suggested layout**

```
res://
  autoload/   breath_rhythm.gd, mood_director.gd, sync_meter.gd
  breath/     breath_source.gd, simulated_breath.gd, manual_breath.gd
  moods/      mood_preset.gd, quick.tres, anxious.tres, overwhelmed.tres, low.tres, restless.tres
  world/      valley.tscn, terrain, lake, grass.gdshader, foliage.gdshader
  actors/     wanderer.tscn, sheep.tscn, flock.gd
  ui/         menu.tscn, end_screen.tscn, demo_overlay.tscn
  audio/      nature beds, bells, pads
```

**Steps**

1. **Greybox:** one valley about 300 m across: a terrain mesh (a heightmap via `ArrayMesh`, or a plane displaced in a shader), a lake, a path loop. A `CharacterBody3D` wanderer and a `Camera3D` that follows smoothly behind. Hills and fog hide the edges ("open world" means one small, dense valley).
2. **MoodDirector + MoodPreset:** an autoload that lerps everything from the preset `Resource`s: `WorldEnvironment` (`ProceduralSkyMaterial` or a custom sky shader, fog / volumetric fog, glow, tonemap and colour adjustment), `DirectionalLight3D` angle and colour, wind, particle rates, audio bus volumes.
3. **BreathRhythm autoload:** the global `world_phase`/`world_val` with Mirror → Lead pacing. Push them every frame as **global shader uniforms** (`RenderingServer.global_shader_parameter_set("breath_phase", ...)`, declared in Project Settings > Shader Globals) so grass, foliage, lake, lantern and particles all read the same clock.
4. **Wind shader** for grass (a `MultiMeshInstance3D` of blades placed around the player) and trees: a travelling band driven by `breath_phase`, plus the in/out-phase differences from 3.1.
5. **BreathSource** subclasses (simulated, manual; sensor later) and a **SyncMeter** autoload that computes phase-based sync.
6. **Feedback hooks:** flowers (`MultiMeshInstance3D` or `GPUParticles3D` in a circle around the player), lantern (`OmniLight3D` + glow), flock spacing, music layers.
7. **Flock:** 5 to 8 sheep, simple follow behaviour with a slight lag, bells.
8. **Shell:** mood picker, first-time hint line, end screen, demo overlay (breath vs world graph, stage, sync, breaths/min) with a hide toggle.
9. **Polish:** a proper character and sheep in the original style (low-poly, modelled in Blender and imported as `.glb`), the turn chime, wildlife, performance pass, an export for the demo laptop (Project > Export > Linux).

**Keep the browser prototype as the fallback demo** until the Godot build is clearly better.

### Demo for judges (about 90 s)

1. Tap **Low** or **Anxious**.
2. Someone walks while (simulated or real) breath settles.
3. The world visibly transforms.
4. The end screen shows breaths/min dropping *without anyone being asked to breathe*.
5. Then show the clinician view concept: breath and HRV trends, drop in use, "who needs a call".

---

## 8. Shared intent for the sister games (retro and minimalist)

The retro and minimalist games are separate titles with their own visual styles, and they're not specified here. **They must follow the same intent and pass the same checklist.** Every game in the family is a calm place whose atmosphere biologically signals safety and lowers stress.

**The calm contract (each game must meet all of these):**

1. **Signals safety to the body:** natural forms and rhythms (organic shapes, gentle fractal-like complexity, water, plants, sky, warm low light), even when stylised into pixels or flat shapes. A minimalist game can do this with a single horizon, a slow gradient and one living thing. A retro game can do it with a pixel valley, a dusk palette and drifting clouds.
2. **One hidden breathing rhythm** drives the world, asymmetric (shorter rise, longer fall), Mirror → Lead pacing. The cue is never an instruction.
3. **Breath is a side effect, never the controller.** Hands play; breath enriches.
4. **Reward only adds:** warmth, light, harmony, life. Never a loss, score penalty, fail state or timer.
5. **Soft fascination, low stimulation:** slow motion, low contrast, no flashing, no sudden sounds, no feed-like novelty loops.
6. **Iso principle moods:** the same four moods plus quick play, each matching the player's state and then drifting to its goal. Low lifts toward warmth; it doesn't sedate.
7. **Slow audio:** about 10-second phrases, consonant, nature sound, pauses, no lyrics.
8. **Short sessions that end,** with an arrival and one tiny real-world step.
9. **Shared plumbing:** the same `BreathSource`, `BreathRhythm`, `SyncMeter` and mood presets (as data). Session logs feed the same learning loop and clinician view.
10. **Safety:** slow breathing only, no holds, easy exit, motion comfort, no treatment claims.

If a design choice in any game makes it more exciting but less calm, calm wins.

---

## 9. Evidence notes (for the pitch; cite carefully)

- Breath-controlled games already exist (DEEP VR, Flowy). **Our difference:** breath is a side effect of play inside a relapse-prevention loop (sense, respond, learn, clinician view) built for life after TMS.
- HRV biofeedback / slow breathing: a meta-analysis of 14 trials found a medium effect on depressive symptoms (g ≈ 0.38).
- Fractal stress recovery (Taylor), attention restoration and soft fascination (Kaplan), blue space and distress, slow-tempo music and breathing (Bernardi), nature sound recovery (Alvarsson), iso principle (music therapy).
- **Caveat:** most of this is short lab studies with small samples. Present it as research-backed design principles, not proven treatment, and say that the learning loop handles individual differences.

---

## 10. Known issues carried over from the prototype

- In-phase and out-phase are not yet distinguishable. Implement section 3.1 first.
- Sync uses wave height, not phase.
- Manual breath (hold Space) is a rough stand-in.
- One finger does both walking and turning on phones; add a "walk the path" mode.
- Character and sheep are placeholder shapes. Grass uses 70k blades, so watch performance on the demo laptop.
- The browser prototype's audio and full walking session were not tested end to end.