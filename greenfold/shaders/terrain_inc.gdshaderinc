// Mirror of Terrain.height() in world/terrain.gd. Keep in sync.
float valley_height(vec2 p) {
	float r = length(p) / 150.0;
	float rim = smoothstep(0.5, 1.15, r);
	float h = rim * rim * 38.0;
	h += (sin(p.x * 0.031 + 1.3) * cos(p.y * 0.027 + 0.4) * 3.2 + sin(p.x * 0.074 + p.y * 0.05 + 2.0) * 1.1 + sin(p.y * 0.11 - p.x * 0.06) * 0.5) * (0.35 + 0.65 * smoothstep(0.1, 0.6, r));
	float d = length(p - vec2(42.0, -34.0));
	h -= 4.5 * (1.0 - smoothstep(0.0, 34.0, d));
	float far = smoothstep(1.15, 3.2, r);
	h += far * (55.0 + 28.0 * sin(p.x * 0.006 + 1.0) * cos(p.y * 0.0071) + 14.0 * sin(p.x * 0.017 - p.y * 0.013 + 2.0) + 6.0 * sin(p.y * 0.041 + p.x * 0.02));
	return h;
}

float hash12(vec2 p) {
	vec3 p3 = fract(vec3(p.xyx) * 0.1031);
	p3 += dot(p3, p3.yzx + 33.33);
	return fract((p3.x + p3.y) * p3.z);
}
float vnoise(vec2 p) {
	vec2 i = floor(p); vec2 f = fract(p);
	vec2 u = f * f * (3.0 - 2.0 * f);
	return mix(mix(hash12(i), hash12(i + vec2(1, 0)), u.x), mix(hash12(i + vec2(0, 1)), hash12(i + vec2(1, 1)), u.x), u.y);
}
float fbm2(vec2 p) {
	float s = 0.0; float a = 0.5;
	for (int i = 0; i < 4; i++) { s += a * vnoise(p); p = p * 2.03 + 17.1; a *= 0.5; }
	return s;
}
