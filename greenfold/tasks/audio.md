Write `audio/audio_engine.gd` (Godot 4 GDScript, `extends Node`, `class_name AudioEngine`): a fully generative, calm soundscape for a breathing-paced valley game. No audio files. It will be added as a child of the main scene. Autoloads `Game` and `Breath` exist (source below as context) — read state from them.

Design rules: calm, consonant, low stimulation. No sudden or loud sounds. Rewards are soft plucks and bells with long decays (pentatonic so anything combines). About 10-second phrases. Nature bed of water + wind + birds; rain only when Game.fv("rain") > 0.

Implementation approach (performance matters, GDScript is slow per sample):
- At `_ready()`, PRE-RENDER short PCM buffers into `AudioStreamWAV` (16-bit, mono, 22050 Hz): (a) a 4 s seamless-looping pink/brown noise for water/wind, (b) a 3 s looping white noise for rain, (c) a soft bell/pluck tone at 440 Hz (sum of 3-4 inharmonic partials with exponential decay, ~3 s), (d) a sine+soft triangle pad loop at 220 Hz (seamless: whole number of cycles, ~2 s), (e) a short bird chirp (frequency sweep up, ~0.12 s). Then play notes by setting `pitch_scale = target_hz / base_hz` on pooled `AudioStreamPlayer`s.
- Create buses at runtime with AudioServer: "Music" (Reverb with room_size 0.8, wet 0.35 + a LowPassFilter whose cutoff you drive) and "Nature" (LowPassFilter driven too). Both send to Master. Don't duplicate buses if they already exist.
- Layers (each an AudioStreamPlayer, volumes in dB smoothed every frame toward targets; never jump):
  * Drone: 3 pad players at root, root*1.5, root*2 (root = Game.root_hz()). Louder and brighter as Breath.world_val rises: vol ~ lerp(-30,-18, world_val); Music LPF cutoff = 400 + sync*1300 + world_val*400 Hz.
  * In-phase whoosh: the noise loop on Nature bus whose volume swells while Breath.rising and pitch_scale slides up slightly (0.8 -> 1.1) over the rise; out-phase: a warm low pad (root*0.5) that falls away gently over the longer exhale. These make inhale vs exhale audibly different.
  * Harmony pads: 3 pad players at root*2*scale[2], [3], [5] (scale = Game.scale_ratios()) that fade in only when Breath.sync > 0.3, 0.5, 0.7 respectively (and Game.state == "play").
  * Water bed: noise loop, low volume (~-26 dB) with gentle swell by world_val.
  * Rain: rain loop volume by Game.fv("rain").
  * Restless mode (Game.mode == "restless"): multiply everything by (1 - 0.6*Game.e) so it fades toward silence.
- Events:
  * `Breath.peak` signal: a very soft "turn chime" (bell at root*4, ~-24 dB) every wave; if Game.state=="play" and Breath.sync > 0.55, also a slightly brighter flow note from the scale (root*4*scale[randi()%5], -20 dB).
  * `Game.sheep_joined(count)` signal: two bell plucks (root*4*scale[count%6] and root*8*scale[(count+2)%6]), the second 0.18 s later and quieter. Sheep bells: also expose `func sheep_bell(pitch_mul: float)` for the flock to call occasionally.
  * Birds: every 3-9 s, if Game.fv("life") > 0.45 and randf() < Game.fv("life"), play 2-4 chirps 0.13 s apart at random pitch_scale 0.9-1.4, quiet (-28 dB), random pan is not needed.
- Master: `func set_enabled(on: bool)` fades Master bus volume to -80 dB/0 dB over ~0.8 s; respects Game.sound_on at start. Fade everything in over 2 s on Game.started.
- Use a pool of ~10 AudioStreamPlayers for one-shot notes (round robin).
- Must run in Godot 4.4+. Only GDScript, no C#.
