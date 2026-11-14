Write `shaders/sky.gdshader`: a Godot 4 `shader_type sky;` shader for a calm, painterly, atmospheric valley game (golden-hour mood, soft haze, low contrast, nothing harsh).

Uniforms (set from GDScript each frame):
- `uniform vec3 sky_top : source_color; uniform vec3 sky_mid : source_color; uniform vec3 sky_hor : source_color;` gradient colours
- `uniform vec3 sun_color : source_color;`
- `uniform float stars = 0.0;` 0..1 star visibility
- `uniform float clouds = 0.5;` 0..1 cloud coverage
- `uniform float mist = 0.1;` 0..1 haze hugging the horizon
- `uniform vec3 mist_color : source_color;`
- `uniform float sync = 0.0;` 0..1, warms/brightens the sun glow slightly
- `uniform float breath = 0.0;` 0..1 slow world breathing wave; sun glow radius swells a little with it
Sun direction: use built-in `LIGHT0_DIRECTION` (and `LIGHT0_ENABLED`). Time: `TIME`.

Requirements:
1. Vertical gradient: horizon->mid over elevation 0..0.2, mid->top over 0.15..0.7. Below horizon (EYEDIR.y<0) fade to a slightly darker horizon colour (no hard line).
2. Sun: wide soft glow (pow(d, 6..10)) + tighter halo + crisp but anti-aliased disc, plus very subtle soft starburst rays (6-8 rays, low intensity, slowly rotating) to give a cinematic glare. Glow tinted by sun_color, a little stronger near horizon (Mie-like forward scattering). Never pure white blowout over large areas.
3. Clouds: layered fbm noise (write your own hash/value noise, 5 octaves) projected onto a dome (uv = EYEDIR.xz / (EYEDIR.y + 0.15)), drifting slowly with TIME. Coverage from `clouds`. Clouds lit: bright warm rim on the side facing the sun, darker cooler bellies, softly blended into sky (painterly, wispy streaks stretched horizontally). Fade out toward horizon and toward zenith slightly.
4. Stars: only above horizon, hashed cell grid on the direction, gentle twinkle, scaled by `stars`, hidden behind clouds.
5. Mist: mix toward mist_color near horizon: mist * exp(-max(h,0)*5).
6. In `void sky()` write COLOR. Must compile in Godot 4.4+. Avoid `AT_CUBEMAP_PASS` complexities; keep it a single pass. Keep it reasonably cheap (it's evaluated per-pixel; radiance size is small).
