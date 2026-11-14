# Greenfold (Godot 4 demo)

A calm valley-walk game where breathing settles as a side effect of play. Spec: [../HANDOFF.md](../HANDOFF.md).

## Run
```bash
godot --path greenfold            # play
godot --path greenfold --fullscreen
```
Godot 4.4+ (built and tested on 4.7.2, Forward+). Everything is procedural: no imported assets.

## Controls
- Hold mouse / touch / W: walk. Pointer offset from centre or A/D: turn.
- Space: manual breath (when "Hold Space" is chosen in the demo view).
- H: toggle demo view. Esc: finish session.

## Layout
| Path | What |
|---|---|
| `autoload/game.gd` | Session state + mood presets (start/end pairs lerped by eased progress) |
| `autoload/breath.gd` | Hidden world rhythm (40% rise / 60% fall, Mirror → Lead), simulated + manual breath, phase-based sync, shader globals |
| `main.gd` | Environment, sun, player, camera, flock, particles, mood application |
| `world/world_builder.gd`, `world/terrain.gd` | Terrain, grass/flower fields that wrap around the player, lake, trees, mountains |
| `world/tree_builder.gd`, `actors/models.gd` | Procedural low-poly trees/rocks/mountains, wanderer + sheep |
| `shaders/` | grass, flowers, foliage, terrain, mountains, sky, lake |
| `audio/audio_engine.gd` | Generative soundscape (pre-rendered tones, buses, breath-driven layers) |
| `ui/ui.gd` | Menu, HUD, demo panel, end screen |
| `tasks/` | Specs handed to the Verda agents that wrote the sky, lake, audio, UI, models and tree builder |

## Debug flags (after `--`)
`--mode=low --p=0.5 --walk --noui --novol --nofog --sheeptest --t=6 --shot=/tmp/x.png`
