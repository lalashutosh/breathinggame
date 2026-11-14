shader_type sky;

uniform vec3 sky_top : source_color;
uniform vec3 sky_mid : source_color;
uniform vec3 sky_hor : source_color;
uniform vec3 sun_color : source_color;

uniform float stars = 0.0;
uniform float clouds = 0.5;
uniform float mist = 0.1;
uniform vec3 mist_color : source_color;
uniform float sync = 0.0;
uniform float breath = 0.0;


float hash21(vec2 p) {
	vec3 p3 = fract(vec3(p.x, p.y, p.x) * 0.1031);
	float d = dot(p3, p3.yzx + vec3(33.33));
	p3 += vec3(d);
	return fract((p3.x + p3.y) * p3.z);
}


float value_noise(vec2 p) {
	vec2 cell = floor(p);
	vec2 f = fract(p);
	vec2 u = f * f * (3.0 - 2.0 * f);

	float a = hash21(cell);
	float b = hash21(cell + vec2(1.0, 0.0));
	float c = hash21(cell + vec2(0.0, 1.0));
	float d = hash21(cell + vec2(1.0, 1.0));

	return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}


float fbm5(vec2 p) {
	float sum = 0.0;
	float normalization = 0.0;
	float amplitude = 0.5;

	for (int i = 0; i < 5; i++) {
		sum += value_noise(p) * amplitude;
		normalization += amplitude;

		p = vec2(
			p.x * 0.80 - p.y * 0.60,
			p.x * 0.60 + p.y * 0.80
		) * 2.03 + vec2(17.17, 9.23);

		amplitude *= 0.5;
	}

	return sum / normalization;
}


void sky() {
	float h = EYEDIR.y;
	float sync_amount = clamp(sync, 0.0, 1.0);
	float breath_amount = clamp(breath, 0.0, 1.0);

	// Soft vertical gradient, with a continuous darker lower hemisphere.
	float horizon_to_mid = smoothstep(0.0, 0.2, h);
	float mid_to_top = smoothstep(0.15, 0.7, h);
	vec3 color = mix(sky_hor, sky_mid, horizon_to_mid);
	color = mix(color, sky_top, mid_to_top);

	float below_horizon = smoothstep(0.0, 0.22, -h);
	vec3 lower_color = sky_hor * vec3(0.82, 0.84, 0.88);
	color = mix(color, lower_color, below_horizon);

	vec3 sun_dir = vec3(0.0, 1.0, 0.0);
	float sun_dot = -1.0;

	if (LIGHT0_ENABLED) {
		sun_dir = normalize(LIGHT0_DIRECTION);
		sun_dot = dot(EYEDIR, sun_dir);

		float d = clamp(sun_dot, 0.0, 1.0);
		float sun_angle = acos(clamp(sun_dot, -1.0, 1.0));

		// Lower suns receive a restrained forward-scattering boost.
		float sun_horizon = 1.0 - smoothstep(
			0.02, 0.38, max(sun_dir.y, 0.0)
		);
		float mie_boost = 1.0 + 0.32 * sun_horizon;

		float glow_exponent = mix(9.0, 7.0, breath_amount);
		glow_exponent -= 0.35 * sun_horizon;
		float halo_exponent = mix(150.0, 125.0, breath_amount);

		vec3 glow_tint = sun_color * vec3(
			1.0 + 0.05 * sync_amount,
			1.0 + 0.015 * sync_amount,
			1.0 - 0.045 * sync_amount
		);

		float wide_glow = pow(d, glow_exponent);
		wide_glow *= (0.42 + 0.08 * sync_amount) * mie_boost;

		float soft_halo = pow(d, halo_exponent);
		soft_halo *= 1.1 + 0.2 * sync_amount;

		color += glow_tint * (wide_glow + soft_halo);

		// Seven very soft, slowly rotating spokes around the solar disc.
		vec3 reference_axis = vec3(0.0, 1.0, 0.0);
		if (abs(sun_dir.y) >= 0.92) {
			reference_axis = vec3(1.0, 0.0, 0.0);
		}

		vec3 tangent = normalize(cross(reference_axis, sun_dir));
		vec3 bitangent = normalize(cross(sun_dir, tangent));
		vec2 ray_plane = vec2(
			dot(EYEDIR, tangent),
			dot(EYEDIR, bitangent)
		);

		float ray_angle = atan(ray_plane.y, ray_plane.x + 0.000001);
		float ray_pattern = 0.5 + 0.5 * cos(
			ray_angle * 7.0 - TIME * 0.045
		);
		ray_pattern = pow(ray_pattern, 8.0);

		float disc_radius = 0.02;
		float ray_inner_fade = smoothstep(
			disc_radius * 1.2,
			disc_radius * 4.0,
			sun_angle
		);
		float ray_falloff = exp(-sun_angle * 18.0);
		float rays = ray_pattern * ray_inner_fade * ray_falloff;
		color += glow_tint * rays * (0.16 + 0.04 * sync_amount);

		// A narrow smoothstep gives the small disc a clean, soft edge.
		float disc = 1.0 - smoothstep(
			disc_radius - 0.0004,
			disc_radius + 0.0011,
			sun_angle
		);
		vec3 disc_color = sun_color * vec3(1.04, 1.0, 0.94) * 14.0;
		color = mix(color, disc_color, disc * 0.92);
	}

	float cloud_alpha = 0.0;
	float coverage = clamp(clouds, 0.0, 1.0);

	if (coverage > 0.001 && h > 0.005) {
		float dome_denominator = max(EYEDIR.y + 0.15, 0.035);
		vec2 dome_uv = EYEDIR.xz / dome_denominator;

		// Slow horizontal streaking and two differently scaled fbm layers.
		vec2 base_stretch = vec2(0.46, 1.38);
		vec2 drift = vec2(TIME * 0.0045, TIME * 0.0012);
		vec2 base_uv = dome_uv * base_stretch + drift;
		float base_noise = fbm5(base_uv);

		vec2 detail_uv = dome_uv * vec2(0.85, 2.85);
		detail_uv += drift * 1.7;
		detail_uv += vec2(base_noise * 0.32, -base_noise * 0.18);
		float detail_noise = fbm5(detail_uv);

		float cloud_field = mix(base_noise, detail_noise, 0.30);
		float threshold = mix(0.80, 0.30, coverage);
		float density = smoothstep(threshold, threshold + 0.18, cloud_field);
		density *= smoothstep(0.0, 0.08, coverage);

		float belly = smoothstep(0.20, 0.95, density);
		belly *= 0.75 + 0.25 * detail_noise;

		float sun_near = pow(clamp(sun_dot, 0.0, 1.0), 3.0);
		float rim = 0.0;

		// Compare density toward the sun to find its softly lit cloud edges.
		if (LIGHT0_ENABLED && density > 0.001) {
			float sun_denominator = max(sun_dir.y + 0.15, 0.035);
			vec2 sun_dome_uv = sun_dir.xz / sun_denominator;
			vec2 to_sun = sun_dome_uv - dome_uv;
			float to_sun_length = length(to_sun);
			vec2 sun_step = to_sun / max(to_sun_length, 0.0001);
			sun_step *= min(to_sun_length, 0.10);

			float toward_sun_noise = fbm5(
				base_uv + sun_step * base_stretch
			);
			rim = clamp((base_noise - toward_sun_noise) * 5.0, 0.0, 1.0);
			rim *= 1.0 - belly * 0.55;
			rim *= 0.45 + 0.55 * sun_near;
		}

		vec3 cloud_shadow = mix(sky_mid, sky_top, 0.35);
		cloud_shadow *= vec3(0.78, 0.82, 0.90);

		vec3 cloud_light = mix(
			sky_mid * 1.04,
			sun_color,
			0.32 + 0.22 * sun_near
		);
		vec3 cloud_color = mix(
			cloud_light,
			cloud_shadow,
			belly * 0.58
		);

		vec3 rim_color = mix(cloud_light, sun_color, 0.38) * 1.08;
		cloud_color = mix(cloud_color, rim_color, rim * 0.62);

		float horizon_fade = smoothstep(0.015, 0.16, h);
		float zenith_fade = 1.0 - 0.32 * smoothstep(0.55, 0.98, h);
		cloud_alpha = density * horizon_fade * zenith_fade * 0.80;

		color = mix(color, cloud_color, cloud_alpha);
	}

	// Stereographic direction grid avoids a longitude seam at the zenith.
	float star_visibility = clamp(stars, 0.0, 1.0);
	star_visibility *= smoothstep(0.025, 0.18, h);

	if (star_visibility > 0.0001) {
		vec2 star_uv = EYEDIR.xz / max(1.0 + h, 0.001);
		star_uv *= 62.0;

		vec2 star_cell = floor(star_uv);
		vec2 star_local = fract(star_uv);
		float seed = hash21(star_cell);

		vec2 star_position = vec2(
			hash21(star_cell + vec2(13.7, 2.9)),
			hash21(star_cell + vec2(47.3, 19.1))
		);
		star_position = mix(vec2(0.15), vec2(0.85), star_position);

		float star_distance = length(star_local - star_position);
		float star_shape = 1.0 - smoothstep(0.005, 0.10, star_distance);
		star_shape *= star_shape;

		float star_gate = smoothstep(0.975, 0.995, seed);
		float twinkle = 0.82 + 0.18 * sin(
			TIME * (0.45 + seed * 0.65) + seed * 41.0
		);
		float star_brightness = mix(
			0.35,
			0.75,
			hash21(star_cell + vec2(5.3, 71.9))
		);

		vec3 star_color = mix(
			vec3(0.72, 0.81, 1.0),
			vec3(1.0, 0.86, 0.69),
			hash21(star_cell + vec2(29.4, 8.6)) * 0.35
		);

		float final_star = star_shape * star_gate * twinkle;
		final_star *= star_brightness * star_visibility;
		final_star *= 1.0 - cloud_alpha;
		color += star_color * final_star * 0.55;
	}

	float mist_amount = clamp(mist, 0.0, 1.0);
	mist_amount *= exp(-max(h, 0.0) * 5.0);
	color = mix(color, mist_color, clamp(mist_amount, 0.0, 1.0));

	COLOR = max(color, vec3(0.0));
}
