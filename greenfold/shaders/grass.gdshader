shader_type spatial;
render_mode cull_disabled, world_vertex_coords, diffuse_lambert_wrap, specular_schlick_ggx;
#include "res://shaders/terrain_inc.gdshaderinc"

global uniform vec2 player_pos;
global uniform float wind_theta;
global uniform float gust;
global uniform float world_val;
global uniform float sync_amt;
global uniform vec4 grass_base;
global uniform vec4 grass_tip;
global uniform vec4 sun_col;

uniform float tile = 84.0;
uniform float blade_h = 1.05;

varying float v_y;
varying float v_wave;
varying float v_rnd;
varying float v_patch;

void vertex() {
	vec2 off = UV;
	vec2 p = mod(off - player_pos + tile * 0.5, tile) - tile * 0.5 + player_pos;
	float h = valley_height(p);
	float d = length(p - player_pos);
	vec3 rnd = vec3(UV2, COLOR.r);
	float lake_d = length(p - vec2(42.0, -34.0));
	float dry = clamp(step(-2.3 + 0.6, h) + step(40.0, lake_d), 0.0, 1.0);
	float patch = fbm2(p * 0.035);
	float sc = (0.55 + 0.75 * rnd.x) * (0.45 + 0.9 * patch);
	sc *= (1.0 - smoothstep(tile * 0.34, tile * 0.49, d)) * dry * (1.0 - smoothstep(22.0, 30.0, h));
	// path near the start so the hero stays readable
	sc *= mix(0.35, 1.0, smoothstep(1.2, 3.5, abs(p.x + 3.0 * sin(p.y * 0.05))) );
	float an = rnd.y * TAU;
	vec2 side = vec2(cos(an), sin(an));
	float y = VERTEX.y;
	float hgt = sc * blade_h;
	vec2 wd = vec2(0.928, 0.371);
	float w = 0.5 + 0.5 * sin(wind_theta - dot(p - player_pos, wd) * 0.05);
	// in-phase: grass lifts upright; out-phase: bows and settles
	float lean = (1.0 - world_val) * 0.28;
	float bend = (w * gust * 1.2 + lean + 0.07 * sin(TIME * 1.9 + rnd.z * 6.28 + p.x * 0.3)) * y * y;
	vec3 wp = vec3(p.x + VERTEX.x * side.x * 0.075 * (1.0 - y * 0.85), h - 0.08 + y * hgt, p.y + VERTEX.x * side.y * 0.075 * (1.0 - y * 0.85));
	// part around the player
	vec2 away = p - player_pos;
	float push = (1.0 - smoothstep(0.4, 1.6, length(away))) * y;
	wp.xz += normalize(away + 0.001) * push * 0.6;
	wp.xz += (wd + side * 0.25) * bend * hgt * 0.9;
	wp.y -= bend * bend * hgt * 0.35 + push * 0.25 * hgt;
	VERTEX = wp;
	NORMAL = normalize(vec3(side.y * 0.35, 1.0, -side.x * 0.35));
	v_y = y;
	v_wave = w;
	v_rnd = rnd.z;
	v_patch = patch;
}

void fragment() {
	vec3 base = grass_base.rgb;
	vec3 tip = grass_tip.rgb * (0.85 + 0.3 * v_rnd);
	tip = mix(tip, tip * vec3(1.08, 0.95, 0.8), smoothstep(0.4, 0.8, v_patch));
	vec3 c = mix(base * 0.8, tip, pow(v_y, 1.6));
	c += sun_col.rgb * v_wave * v_y * v_y * 0.12 * (0.6 + world_val);
	ALBEDO = c;
	BACKLIGHT = tip * 0.3 * v_y;
	ROUGHNESS = 0.85;
	SPECULAR = 0.25;
	AO = mix(0.35, 1.0, v_y);
	AO_LIGHT_AFFECT = 0.5;
	if (!FRONT_FACING) { NORMAL = -NORMAL; }
}
