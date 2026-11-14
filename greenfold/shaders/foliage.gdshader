shader_type spatial;
render_mode diffuse_lambert_wrap, specular_schlick_ggx;

global uniform vec2 player_pos;
global uniform float wind_theta;
global uniform float gust;
global uniform float world_val;

uniform vec3 tint : source_color = vec3(1.0);
uniform float sway = 1.0;
uniform float backlight_amt = 0.35;
varying vec3 v_col;

void vertex() {
	vec3 ip = MODEL_MATRIX[3].xyz;
	vec2 wd = vec2(0.928, 0.371);
	float w = (0.5 + 0.5 * sin(wind_theta - dot(ip.xz - player_pos, wd) * 0.05)) * gust + 0.05 * sin(TIME * 1.3 + ip.x * 0.7);
	float k = COLOR.a * sway;
	// leaves turn up / lift a touch on the in-phase
	VERTEX.x += w * k * 0.55;
	VERTEX.z += w * k * 0.22;
	VERTEX.y += (world_val - 0.5) * 0.08 * k;
	v_col = COLOR.rgb * tint;
}

void fragment() {
	ALBEDO = v_col;
	ROUGHNESS = 0.95;
	SPECULAR = 0.2;
	BACKLIGHT = v_col * backlight_amt;
}
