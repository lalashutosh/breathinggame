shader_type spatial;
render_mode diffuse_lambert_wrap, specular_disabled;
#include "res://shaders/terrain_inc.gdshaderinc"

uniform vec3 rock_col : source_color = vec3(0.4, 0.36, 0.45);
uniform vec3 snow_col : source_color = vec3(1.0, 0.92, 0.85);
uniform float snow_line = 200.0;
varying vec3 v_wp;
varying float v_snow;
varying vec3 v_wn;

void vertex() {
	v_wp = (MODEL_MATRIX * vec4(VERTEX, 1.0)).xyz;
	v_wn = normalize((MODEL_MATRIX * vec4(NORMAL, 0.0)).xyz);
	v_snow = COLOR.a;
}

void fragment() {
	float n = fbm2(v_wp.xz * 0.01 + v_wp.y * 0.02);
	float streak = fbm2(vec2(v_wp.x * 0.02 + v_wp.z * 0.02, v_wp.y * 0.08));
	float up = smoothstep(0.2, 0.75, v_wn.y + 0.3 * streak);
	float line = snow_line + (n - 0.5) * snow_line * 0.5 + (streak - 0.5) * snow_line * 0.35;
	float snow = smoothstep(line - 15.0, line + 15.0, v_wp.y) * mix(0.75, 1.0, up);
	snow = max(snow, v_snow * 0.8 * up);
	snow = smoothstep(0.25, 0.55, snow);
	vec3 c = mix(rock_col * (0.75 + 0.5 * streak), snow_col, snow);
	ALBEDO = c;
	ROUGHNESS = 1.0;
	BACKLIGHT = snow_col * 0.08;
	EMISSION = snow_col * snow * 0.22;
}
