Write `web/js/games/drift/index.js`: a complete, polished, MINIMALIST calm browser game called **Drift**, as a plain ES module (no libraries, no build step, no external assets, no fonts loaded). It plugs into an existing site: the host calls `mount(container, { onComplete, onExit })` inside a modal and expects `{ unmount() }` back.

Start the file with:
```js
import { MOODS, MOOD_ORDER, wave } from './moods.js';
export const meta = { id: 'drift', title: 'Drift' };
export function mount(container, { onComplete, onExit } = {}) { ... return { unmount() { ... } }; }
```
`moods.js` (given as context) holds five mood presets; every numeric/colour field is a `[start, end]` pair interpolated by eased session progress `e` (0..1). Write helpers `V(key)` (lerp numbers) and `C(key)` (lerp hex colours → css rgb string). `wave(phase)` is the asymmetric world wave (40% rise, 60% fall), returns 0..1.

## Philosophy (hard rules)
- Calm, low stimulation, soft edges, low contrast, slow motion, no flashing, no sudden sounds.
- Nothing to lose: no score, no numbers, no timer, no fail state during play. Missed things simply fade. Rewards only ADD (light, warmth, harmony, life).
- NEVER tell the player to breathe, and never use breath holds. The cue is the world itself.
- Sessions END (about 2 minutes) with an arrival.
- Hands play. A hidden world rhythm shapes the path; following it with your hand naturally sets a slow rhythm.

## Layout & fullscreen
- Inject one `<style>` element inside the container with all CSS, scoped under a root `.dr` element. Root `.dr` is `position:fixed; inset:0; z-index:1000;` with a full-size `<canvas>` (render at devicePixelRatio, max 2, resize with a ResizeObserver; smooth vector look, NOT pixel art).
- On Start, call `rootEl.requestFullscreen?.()` (ignore rejections). Key `F` and a "Fullscreen" chip toggle fullscreen. unmount must exit fullscreen if active.
- Typography: headings `font-family: "Cormorant Garamond", "EB Garamond", Georgia, serif` (weight 400, italic for subtitles); UI `system-ui, sans-serif`. Text colour near-white `#f6f1e7`. Chips are pill buttons, translucent `rgba(10,14,34,.35)` with `1px solid rgba(255,255,255,.25)`, backdrop-filter blur.

## Screens
1. **Setup overlay** (over the live scene, which previews the selected mood at e=0): title "Drift" (large serif), italic subtitle "one small light, a quiet evening"; small uppercase label "how are you arriving?"; five mood chips from `MOOD_ORDER` (label + small `sub` line, a 22px circular swatch gradient `skyMid[0] → skyHor[1]`), first selected; selecting previews that mood behind the overlay. A cream pill button "Begin". A quiet line: "Hold to rise · let go to settle · follow the light". Fade the overlay out (0.9 s) on Begin.
2. **Play**: top-right chips "Sound on/off", "Fullscreen", "Finish". They sit at 45% opacity, 100% on hover. Bottom-centre italic serif hint that fades in at start then out after 8 s: the mood's `intro` line, then (first session only) "The light rises and settles with the water." No other text during play.
3. **End card** (fades in ~2 s after arrival): heading "Home for now." (serif), the mood `arrive` line in italic, three quiet stats (big serif value + tiny uppercase caption): "rhythm" `"<a> → <b> / min"` (a = 60/startPeriod rounded, b = 60/finalPeriod, use the player's measured hold rhythm when available, otherwise the world period), "in flow" percent of play time with sync > 0.55, "lights" number gathered; then the mood `step` text in italic; buttons "Collect your sapling" (cream pill) → `onComplete({ gameId: 'drift', mood, flowPct, lights, seconds })` and "Leave" (chip) → `onExit()`.

## Scene (draw every frame, canvas 2D, all from mood values at current e)
- Horizon at 66% of height. Sky above: vertical gradient skyTop → skyMid (at ~65% of sky) → skyHor (at horizon).
- Sun: disc + big soft radial glow (sunCol). `sunY` is height as fraction of the sky: 0 = top, 1 = horizon, >1 = hidden below horizon (clip to sky). Sun x at 72% width. Glow swells slightly with the world wave.
- Moon (alpha = V('moon')): small cool disc + halo at 22% width, 25% sky height.
- Stars: ~140 fixed random points in the sky, alpha by V('stars') * twinkle, hidden near the sun glow.
- Clouds: 6-8 very soft long horizontal blurred ellipses (use radial gradients / low alpha), drift speed 4 + 60*wind px/s.
- Two hill silhouettes along the horizon (far: hillFar, lighter, taller; near: hillNear), each a smooth fractal ridge (sum of 4-5 sines), parallax scrolling slowly (far 3 px/s, near 8 px/s, times 1 + 2*wind).
- Water below the horizon: gradient from `water` colour to a darker version; reflection of the sky/sun as a soft vertical gradient band under the sun; thin horizontal ripple lines whose amplitude and count grow with wind; the orb reflected as a broken shimmering vertical column of short horizontal dashes under it (like light on a lake).
- Rain (alpha V('rain')): ~120 thin slanted streaks falling fast (slant with wind) + tiny expanding ripple dashes on the water.
- Fog (V('fog')): horizontal milky gradient layers (colour = skyHor lightened) over the hills and far part of the path; strongest at the horizon and on the right (far ahead), so in heavy fog only the light and the next few seconds of path are clear.
- One living thing, alpha/count by V('life'): a single bird (two curved strokes, slow wing flap) gliding across the sky every 20-30 s; when life > 0.8 a small loose group of 3.
- Gentle overall vignette.

## The path, the light, the rhythm
- World rhythm: keep `worldPhase` (0..1) and period `P`. Mirror: for the first 15 s, P eases toward the player's measured hold rhythm (median time between the last 3 press-starts, clamped 2.5..12 s) if at least 3 presses happened, else `period[0]`. Lead: afterwards P eases toward `lerp(period[0], period[1], min(1, e*1.15))`. Always ease P smoothly (rate dt*0.4), never jump. `worldPhase += dt / P`.
- The ribbon: a soft luminous band (width ~7% of height, very low alpha fill `ribbon` colour ~0.12, brighter core line dotted) drawn from the left edge to the right edge. Screen x maps to time: the orb sits at x = 28% width = "now"; points to the right are the future of the wave, to the left the past (scroll speed 60 px/s * (1 + 0.25*sync) mapping time ↔ x). Ribbon centre y(x) = top + (1 - wave(phaseAt(x))) * span, where span covers the band between 22% and 58% of height (high = rising). phaseAt(x) = worldPhase + (x - orbX)/speed / P.
- The ribbon brightens a little on the rising part (in-phase) and softens on the falling part, so the two halves feel different: rising = lifting, airy, brighter; falling = settling, warmer, softer.
- The light (orb): at x = 28%. Hold (pointer anywhere on the canvas, Space, W or ArrowUp) → it rises; release → it settles. Kinematics: target vertical velocity = holding ? -riseSpeed : +fallSpeed, where riseSpeed = 1.15 * span / (0.4 * P) and fallSpeed = 1.15 * span / (0.6 * P); ease velocity with a 0.25 s time constant; clamp y within the span. Draw: soft radial glow (orb colour) whose radius swells with the world wave and with sync; a bright core; a thin fading trail of its recent positions to the left.
- An "Easy mode" chip (in the setup overlay as a checkbox "Let the light find its own way") makes the orb follow the ribbon automatically (for low energy; demos).
- Sync: `inst = clamp(1 - |orbY - ribbonY(orbX)| / (bandWidth * 1.2))`; `sync += (inst - sync) * min(1, dt*0.45)`. As sync rises: orb glow grows, ribbon warms, sky gets a touch warmer/brighter, a soft harmony pad fades in, scroll speed +25%.
- Lights (seeds): small soft dots placed on the ribbon centre every quarter period. When a seed passes the orb within the band, it is gathered: it floats up into the sky and becomes a permanent faint star / firefly (cap 60), with a soft bell pluck. Missed seeds just fade. Count gathered (only shown on the end card).
- Turn chime: at the top of each wave (phase crosses 0.4) a very soft bell; the bottom stays quiet.

## Session
- `p` (0..1) advances by `dt / 110 * (0.55 + 0.9*sync)`; `e = p*p*(3-2*p)`. At p >= 1 → arrival: orb drifts gently upward and the ribbon fades; show end card after 2 s. "Finish" ends early (same arrival).

## Audio (Web Audio, created on Begin; all gentle; master fades in over 2 s; Sound chip toggles master to 0)
- Root 130.81 Hz, pentatonic major ratios [1, 9/8, 5/4, 3/2, 5/3, 2].
- Drone: sine at root + root*1.5 (and quiet triangle at root*2) → lowpass (cutoff 350 + 1200*sync + 300*wave) → gain rising slightly with the wave.
- Pad: 3 sines on scale degrees that fade in at sync > 0.35 / 0.55 / 0.75.
- Pluck: sine/triangle with exponential decay ~2.5 s through a feedback delay (0.38 s, fb 0.35, wet 0.3) for seeds and the turn chime.
- Noise beds from one shared looping noise buffer: wind (lowpass 500 Hz, gain ~ 0.02 + 0.05*wind, swelling on the rising wave), rain (highpass 3000, gain 0.04*rain), water (lowpass 300, gain 0.015).
- Restless mood: scale overall level by (1 - 0.6*e) so it fades toward silence.

## Robustness
- requestAnimationFrame loop with dt clamped to 0.05 s. Handle resize. `unmount()` cancels RAF, removes all listeners (window keydown/keyup, pointer), disconnects ResizeObserver, closes the AudioContext, exits fullscreen, clears the container.
- Ignore pointerdown on buttons/chips (they must not move the orb). preventDefault on Space.
- If `location.search` includes `debug`, expose `window.__dr = { S }` where S holds p, e, sync, worldPhase, P, lights, auto, state ('setup'|'play'|'arrive'|'end') and allow tests to set `S.auto = true`.
- Must work in current Chrome/Firefox/Safari. No TypeScript, no JSX.
