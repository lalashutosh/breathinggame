shader_type spatial;
render_mode cull_disabled, world_vertex_coords, diffuse_lambert_wrap;
#include "res://shaders/terrain_inc.gdshaderinc"

global uniform vec2 player_pos;
global uniform float sync_amt;
global uniform float world_val;
global uniform float wind_theta;
global uniform float gust;

uniform float tile = 84.0;
uniform float bloom_mul = 1.0;
varying vec3 v_col;
varying float v_center;

void vertex() {
	vec2 p = mod(UV2 - player_pos + tile * 0.5, tile) - tile * 0.5 + player_pos;
	float h = valley_height(p);
	float d = length(p - player_pos);
	float R = 3.0 + sync_amt * 42.0;
	float lake_d = length(p - vec2(42.0, -34.0));
	float dry = clamp(step(-2.3 + 0.6, h) + step(40.0, lake_d), 0.0, 1.0);
	float bl = smoothstep(R, R - 7.0, d) * dry * (1.0 - smoothstep(18.0, 24.0, h)) * bloom_mul;
	float s = (0.12 + 0.1 * COLOR.g) * bl;
	vec2 wd = vec2(0.928, 0.371);
	float w = 0.5 + 0.5 * sin(wind_theta - dot(p - player_pos, wd) * 0.05);
	vec3 centre = vec3(p.x, h + 0.55 + COLOR.b * 0.35, p.y);
	centre.xz += wd * w * gust * 0.25;
	// billboard quad: VERTEX.xy in -1..1
	vec3 right = normalize(INV_VIEW_MATRIX[0].xyz);
	vec3 up = normalize(INV_VIEW_MATRIX[1].xyz);
	VERTEX = centre + (right * VERTEX.x + up * VERTEX.y) * s;
	NORMAL = vec3(0.0, 1.0, 0.0);
	float k = COLOR.r;
	v_col = k < 0.4 ? vec3(1.0, 0.96, 0.88) : (k < 0.72 ? vec3(1.0, 0.8, 0.35) : vec3(0.92, 0.58, 0.82));
}

void fragment() {
	vec2 q = UV * 2.0 - 1.0;
	float r = length(q);
	float ang = atan(q.y, q.x);
	float petal = 0.75 + 0.25 * cos(ang * 5.0);
	if (r > petal) discard;
	vec3 c = mix(vec3(1.0, 0.78, 0.25), v_col, smoothstep(0.18, 0.32, r));
	ALBEDO = c;
	EMISSION = c * (0.15 + 0.25 * world_val) * sync_amt;
	ROUGHNESS = 0.9;
	BACKLIGHT = c * 0.5;
}
