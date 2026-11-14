Write `shaders/lake.gdshader`: a Godot 4 `shader_type spatial;` water shader for a small calm lake (a flat disc mesh, radius 64 m, at y=-2.3) in a stylised, painterly valley game. Forward+ renderer; Screen-space reflections are enabled in the Environment, so keep ROUGHNESS low and let SSR + sky reflection do the reflecting.

Global uniforms already declared in project settings (use `global uniform`):
- `global uniform float gust;` 0..1 wind strength (choppier when high)
- `global uniform float world_val;` 0..1 slow breathing wave of the world
- `global uniform vec3 sun_dir;` normalized direction TO the sun
- `global uniform vec4 sun_col;`
Instance uniforms:
- `uniform vec3 deep_color : source_color = vec3(0.05,0.12,0.2);`
- `uniform vec3 shallow_color : source_color = vec3(0.25,0.45,0.45);`
- `uniform vec3 foam_color : source_color = vec3(1.0,0.95,0.85);`
- `uniform sampler2D depth_tex : hint_depth_texture, filter_linear_mipmap;`
- `uniform sampler2D screen_tex : hint_screen_texture, filter_linear_mipmap;`

Requirements:
- render_mode: `blend_mix, depth_draw_always, cull_back, diffuse_burley, specular_schlick_ggx`. Opaque-looking water (ALPHA 1.0) but tint by scene depth behind it: compute linear depth difference from DEPTH_TEXTURE vs FRAGCOORD.z (Godot 4 reverse-Z: use INV_PROJECTION_MATRIX properly), mix shallow->deep by depth, refract a little by sampling screen_tex with a normal-based UV offset for shallow edges.
- Soft foam/shoreline glow where water meets terrain (thin, soft, animated).
- Procedural animated normals (sum of 3-4 directional sine/noise waves in world xz, small amplitude, amplitude scaled by 0.3 + gust). Set NORMAL_MAP or perturb NORMAL in view space correctly.
- Fresnel: more reflective at grazing angles (ROUGHNESS ~0.02-0.06, METALLIC 0.0, SPECULAR 0.6).
- Extra warm sun glint path: add EMISSION of sun_col * sharp specular from sun_dir reflected about the perturbed normal (dot of reflected view and sun_dir, pow ~200) plus a softer broader glint, intensity gently breathing with world_val (0.85..1.15).
- No VERTEX displacement needed. Must compile in Godot 4.4+.
