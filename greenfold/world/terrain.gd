class_name Terrain
extends RefCounted
## Shared valley height function (metres). Bowl ~300 m across, rim rising past r=75 m,
## a lake hollow centred at LAKE_C. Mirrored in shaders/terrain_inc.gdshaderinc.

const WATER_LEVEL := -2.3
const LAKE_C := Vector2(42.0, -34.0)
const LAKE_R := 40.0
const WALK_R := 138.0


static func height(x: float, z: float) -> float:
	var r := sqrt(x * x + z * z) / 150.0
	var rim := smoothstep(0.5, 1.15, r)
	var h := rim * rim * 38.0
	h += (sin(x * 0.031 + 1.3) * cos(z * 0.027 + 0.4) * 3.2 + sin(x * 0.074 + z * 0.05 + 2.0) * 1.1 + sin(z * 0.11 - x * 0.06) * 0.5) * (0.35 + 0.65 * smoothstep(0.1, 0.6, r))
	var d := Vector2(x, z).distance_to(LAKE_C)
	h -= 4.5 * (1.0 - smoothstep(0.0, 34.0, d))
	var far := smoothstep(1.15, 3.2, r)
	h += far * (55.0 + 28.0 * sin(x * 0.006 + 1.0) * cos(z * 0.0071) + 14.0 * sin(x * 0.017 - z * 0.013 + 2.0) + 6.0 * sin(z * 0.041 + x * 0.02))
	return h


static func is_wet(x: float, z: float, margin: float) -> bool:
	return Vector2(x, z).distance_squared_to(LAKE_C) < LAKE_R * LAKE_R and height(x, z) < WATER_LEVEL + margin


static func normal(x: float, z: float) -> Vector3:
	var e := 0.5
	return Vector3(height(x - e, z) - height(x + e, z), 2.0 * e, height(x, z - e) - height(x, z + e)).normalized()
