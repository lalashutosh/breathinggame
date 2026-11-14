shader_type spatial;
render_mode diffuse_lambert_wrap, specular_schlick_ggx;
#include "res://shaders/terrain_inc.gdshaderinc"

global uniform vec4 grass_base;
global uniform vec4 grass_tip;
global uniform vec2 player_pos;

uniform vec3 rock_col : source_color = vec3(0.42, 0.38, 0.36);
uniform vec3 sand_col : source_color = vec3(0.62, 0.55, 0.42);
uniform vec3 snow_col : source_color = vec3(0.95, 0.92, 0.9);
uniform float snow_amt = 0.6;

varying vec3 v_wp;
varying vec3 v_wn;

void vertex() {
	v_wp = (MODEL_MATRIX * vec4(VERTEX, 1.0)).xyz;
	v_wn = normalize((MODEL_MATRIX * vec4(NORMAL, 0.0)).xyz);
}

void fragment() {
	vec2 p = v_wp.xz;
	float h = v_wp.y;
	float n = fbm2(p * 0.05);
	float n2 = fbm2(p * 0.4);
	// meadow: far grass looks like the tips, near ground is darker under the blades
	float near = 1.0 - smoothstep(18.0, 40.0, length(p - player_pos));
	vec3 meadow = mix(mix(grass_base.rgb, grass_tip.rgb, 0.62 + 0.25 * n), grass_base.rgb * 0.7, near);
	meadow *= 0.88 + 0.24 * n2;
	float slope = 1.0 - v_wn.y;
	vec3 c = meadow;
	float lake_d = length(p - vec2(42.0, -34.0));
	c = mix(c, sand_col * (0.9 + 0.2 * n2), (1.0 - smoothstep(-2.0, -1.2, h)) * (1.0 - smoothstep(38.0, 46.0, lake_d)));
	float rock = smoothstep(0.3, 0.55, slope + 0.15 * n) + smoothstep(85.0, 120.0, h + 20.0 * n) * 0.85;
	float forest = smoothstep(0.52, 0.62, fbm2(p * 0.012 + 3.0)) * smoothstep(30.0, 60.0, length(p) * 0.25);
	c = mix(c, vec3(0.1, 0.16, 0.12) * (0.8 + 0.4 * n2), forest * 0.85);
	c = mix(c, rock_col * (0.8 + 0.4 * n2), clamp(rock, 0.0, 1.0));
	float snow = smoothstep(95.0, 120.0, h + 20.0 * n) * (1.0 - smoothstep(0.35, 0.7, slope)) * snow_amt;
	c = mix(c, snow_col, snow);
	ALBEDO = c;
	ROUGHNESS = 0.95;
	SPECULAR = 0.15;
	BACKLIGHT = grass_tip.rgb * 0.15 * (1.0 - rock);
}
