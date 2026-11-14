Write `world/tree_builder.gd` (Godot 4 GDScript): `class_name TreeBuilder extends RefCounted` with static functions that build stylised low-poly, faceted (flat-shaded) meshes for a calm painterly valley game. Use SurfaceTool. All meshes: origin at the base, +Y up.

Vertex data contract (a custom shader reads these):
- `COLOR.rgb` = albedo colour (linear-ish, pleasant muted natural tones: trunks warm grey-brown, pine foliage deep blue-green, broadleaf foliage olive/sage greens with slight variation, rocks warm grey with a hint of moss green on top-facing faces).
- `COLOR.a` = sway weight: 0.0 at ground/trunk base rising to 1.0 at the tips/top of the canopy (based on height and distance from the trunk axis). Rocks: 0.
- Flat normals: call `st.generate_normals()` with flat shading (set smooth group to -1 / use `st.set_smooth_group(-1)`), then `st.commit()`.

Functions (each takes `seed: int` and uses its own `RandomNumberGenerator` so variants differ):
1. `static func make_pine(seed: int) -> ArrayMesh` ~8-11 m: short tapered trunk + 4-6 stacked, slightly jittered, irregular cone tiers (7-9 sides) narrowing upward, tiers slightly tilted, vertices jittered for an organic silhouette (natural fractal-like, not perfectly regular).
2. `static func make_broadleaf(seed: int) -> ArrayMesh` ~6-8 m: tapered trunk with 2-3 short branches, canopy of 4-7 overlapping lumpy low-res icospheres (subdivided icosahedron with vertex noise) clustered on the branch ends. Lighter warm greens on top clusters.
3. `static func make_bush(seed: int) -> ArrayMesh` ~1-1.5 m: 2-4 lumpy icospheres, sway weight 0.3..0.8.
4. `static func make_rock(seed: int) -> ArrayMesh` ~1-2.5 m: a jittered, slightly flattened icosahedron/dodecahedron.
5. `static func make_mountain_ring(radius: float, height: float, seed: int, segments: int = 220) -> ArrayMesh` A closed ring of jagged mountain peaks surrounding the origin at `radius`, used as the distant vista: a strip of triangles from (radius+thickness, -40) at the base up to a ridgeline whose height uses fractal sum of sines (6 octaves) giving distinct sharp peaks and saddles (heights between 0.25*height and height). Make it a proper 3D band ~0.25*radius thick (outer and inner ridge vertices + top ridge) so it lights nicely from the side. COLOR.rgb: base rock colour (0.35,0.33,0.38) with a snow factor in COLOR.a = 1 near peaks (above 0.7*local max height, with jagged noisy snowline), 0 lower. (For mountains COLOR.a means snow, not sway.)

Write a private helper for building icospheres (subdivision 1) with jitter. Must run in Godot 4.4+; do not use editor-only APIs.
