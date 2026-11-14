shader_type spatial;
render_mode blend_mix, depth_draw_always, cull_back, diffuse_burley, specular_schlick_ggx;

global uniform float gust;
global uniform float world_val;
global uniform vec3 sun_dir;
global uniform vec4 sun_col;

uniform vec3 deep_color : source_color = vec3(0.05, 0.12, 0.2);
uniform vec3 shallow_color : source_color = vec3(0.25, 0.45, 0.45);
uniform vec3 foam_color : source_color = vec3(1.0, 0.95, 0.85);
uniform sampler2D depth_tex : hint_depth_texture, filter_linear_mipmap;
uniform sampler2D screen_tex : hint_screen_texture, filter_linear_mipmap;

varying vec3 world_position;

vec2 lake_wave_slope(vec2 p, float t) {
	float wind = clamp(gust, 0.0, 1.0);
	float amplitude = 0.035 * (0.3 + wind);
	vec2 slope = vec2(0.0);

	vec2 direction = normalize(vec2(1.0, 0.22));
	float frequency = 0.32;
	slope += direction * amplitude * frequency
		* cos(dot(p, direction) * frequency + t * 0.46);

	direction = normalize(vec2(-0.35, 1.0));
	frequency = 0.57;
	slope += direction * amplitude * 0.70 * frequency
		* cos(dot(p, direction) * frequency - t * 0.61 + 1.7);

	direction = normalize(vec2(0.72, -0.69));
	frequency = 1.05;
	slope += direction * amplitude * 0.42 * frequency
		* cos(dot(p, direction) * frequency + t * 0.83 + 3.1);

	direction = normalize(vec2(-0.82, -0.38));
	frequency = 1.83;
	slope += direction * amplitude * 0.22 * frequency
		* cos(dot(p, direction) * frequency - t * 1.07 + 4.6);

	return slope;
}

void vertex() {
	world_position = (MODEL_MATRIX * vec4(VERTEX, 1.0)).xyz;
}

void fragment() {
	float wind = clamp(gust, 0.0, 1.0);

	// Small directional waves, evaluated in world XZ so the lake remains stable
	// under camera movement and mesh subdivision is irrelevant.
	vec2 wave_slope = lake_wave_slope(world_position.xz, TIME);
	vec3 wave_normal_world = normalize(vec3(-wave_slope.x, 1.0, -wave_slope.y));
	vec3 wave_normal_view = normalize((VIEW_MATRIX * vec4(wave_normal_world, 0.0)).xyz);
	vec3 view_direction = normalize(VIEW);
	NORMAL = wave_normal_view;

	// Forward+ uses reverse-Z with depth in [0, 1]. Applying the inverse
	// projection to both depth samples gives comparable view-space distances.
	vec2 ndc_xy = SCREEN_UV * 2.0 - 1.0;
	float scene_device_depth = texture(depth_tex, SCREEN_UV).r;

	vec4 scene_view_h = INV_PROJECTION_MATRIX
		* vec4(ndc_xy, scene_device_depth, 1.0);
	vec3 scene_view_position = scene_view_h.xyz / scene_view_h.w;

	vec4 water_view_h = INV_PROJECTION_MATRIX
		* vec4(ndc_xy, FRAGCOORD.z, 1.0);
	vec3 water_view_position = water_view_h.xyz / water_view_h.w;

	float scene_linear_depth = -scene_view_position.z;
	float water_linear_depth = -water_view_position.z;
	float water_depth = max(scene_linear_depth - water_linear_depth, 0.0);
	float deep_factor = 1.0 - exp(-water_depth * 0.34);
	vec3 water_color = mix(shallow_color, deep_color, deep_factor);

	// Restrict refraction mostly to shallow water, fading it out right at the
	// terrain contact to avoid pulling foreground pixels into the shoreline.
	float shallow_refraction = (1.0 - deep_factor)
		* smoothstep(0.025, 0.30, water_depth);
	vec3 flat_normal_view = normalize((VIEW_MATRIX * vec4(0.0, 1.0, 0.0, 0.0)).xyz);
	vec2 normal_offset = wave_normal_view.xy - flat_normal_view.xy;
	vec2 refraction_uv = clamp(
		SCREEN_UV + normal_offset * (0.10 + 0.025 * wind) * shallow_refraction,
		vec2(0.001),
		vec2(0.999)
	);

	vec3 scene_behind = textureLod(screen_tex, refraction_uv, deep_factor * 1.25).rgb;
	vec3 transmission_tint = mix(
		shallow_color * 1.35,
		deep_color * 2.2,
		deep_factor
	);
	float scene_visibility = mix(0.42, 0.08, deep_factor);
	vec3 body_color = mix(
		water_color,
		scene_behind * transmission_tint,
		scene_visibility
	);

	// A narrow depth band produces the shoreline; two animated patterns keep
	// its width and coverage soft rather than drawing a hard contour.
	float shore_wobble = sin(world_position.x * 0.72 + TIME * 0.55)
		* sin(world_position.z * 0.91 - TIME * 0.43);
	float shore_width = 0.22 + 0.035 * shore_wobble + 0.025 * wind;
	float shoreline = 1.0 - smoothstep(0.01, shore_width, water_depth);
	float foam_lace = 0.5 + 0.5 * sin(
		world_position.x * 1.60
		+ world_position.z * 1.17
		+ shore_wobble * 2.0
		+ TIME * 0.72
	);
	float foam = shoreline * mix(0.35, 1.0, smoothstep(0.18, 0.88, foam_lace));

	// Reduce diffuse body color at grazing angles so the low-roughness SSR and
	// sky reflection naturally dominate through the engine's Fresnel response.
	float ndotv = clamp(dot(wave_normal_view, view_direction), 0.0, 1.0);
	float fresnel = 0.02 + 0.98 * pow(1.0 - ndotv, 5.0);
	body_color *= 1.0 - 0.55 * fresnel;
	body_color = mix(body_color, foam_color, foam * 0.60);

	// An additional reflected-sun path supplements the regular GGX highlight.
	vec3 reflected_view = reflect(-view_direction, wave_normal_view);
	vec3 sun_view_direction = normalize(
		(VIEW_MATRIX * vec4(normalize(sun_dir), 0.0)).xyz
	);
	float sun_alignment = clamp(dot(reflected_view, sun_view_direction), 0.0, 1.0);
	float sharp_glint = pow(sun_alignment, 200.0);
	float broad_glint = pow(sun_alignment, 24.0);
	float glint_breathing = 0.85 + 0.30 * clamp(world_val, 0.0, 1.0);
	float sun_above_horizon = smoothstep(-0.04, 0.08, sun_dir.y);
	vec3 sun_glint = sun_col.rgb
		* glint_breathing
		* sun_above_horizon
		* (sharp_glint * 2.4 + broad_glint * 0.14);

	ALBEDO = body_color;
	METALLIC = 0.0;
	SPECULAR = 0.6;
	ROUGHNESS = mix(0.025, 0.055, wind);
	EMISSION = sun_glint + foam_color * foam * 0.12;
	ALPHA = 1.0;
}
