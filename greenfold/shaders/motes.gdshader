shader_type spatial;
render_mode unshaded, blend_add, depth_draw_never, cull_disabled, fog_disabled;
// Pollen / fireflies. Fade out near the camera (no big blobs) and far away
// (sub-pixel specks shimmer), and never get bright enough to bloom hard.
uniform sampler2D glow_tex : source_color, filter_linear;

varying float v_fade;

void vertex() {
	// particle billboard
	MODELVIEW_MATRIX = VIEW_MATRIX * mat4(INV_VIEW_MATRIX[0], INV_VIEW_MATRIX[1], INV_VIEW_MATRIX[2], MODEL_MATRIX[3]);
	MODELVIEW_MATRIX = MODELVIEW_MATRIX * mat4(vec4(length(MODEL_MATRIX[0].xyz), 0.0, 0.0, 0.0), vec4(0.0, length(MODEL_MATRIX[1].xyz), 0.0, 0.0), vec4(0.0, 0.0, length(MODEL_MATRIX[2].xyz), 0.0), vec4(0.0, 0.0, 0.0, 1.0));
	float d = length((MODELVIEW_MATRIX * vec4(0.0, 0.0, 0.0, 1.0)).xyz);
	v_fade = smoothstep(2.0, 6.0, d) * (1.0 - smoothstep(16.0, 26.0, d));
}

void fragment() {
	float g = texture(glow_tex, UV).a;
	ALBEDO = COLOR.rgb * g * v_fade * 0.8;
}
