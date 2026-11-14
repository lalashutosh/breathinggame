extends Node3D
## Greenfold main: builds the valley, drives the player, camera, flock, weather and mood.

const WALK_SPEED := 4.3
const CAM_BACK := 9.5
const CAM_UP := 3.1
const SUN_AZIMUTH := 0.22   # sun sits ahead of the start view, slightly right

var env: Environment
var sky_mat: ShaderMaterial
var sun: DirectionalLight3D
var cam: Camera3D
var hero: Node3D
var lantern_light: OmniLight3D
var lantern_halo: Sprite3D
var motes: GPUParticles3D
var motes_mat: ParticleProcessMaterial
var rain: GPUParticles3D
var ui: Node
var audio: Node
var birds: Array[Node3D] = []

var pl_pos := Vector3(0, 0, 78)
var pl_yaw := PI
var pl_v := 0.0
var walk_phase := 0.0
var cam_yaw := PI
var walking := false
var mouse_x := 0.5
var keys := {}

var sheep: Array[Dictionary] = []
var t := 0.0
var _bell_timer := 4.0
var _shot_path := ""
var _shot_time := 6.0
var _force_p := -1.0
var _dbg_nofog := false


func _ready() -> void:
	randomize()
	_build_environment()
	WorldBuilder.build(self)
	_build_hero()
	_build_particles()
	_build_birds()
	_build_overlay()
	cam = Camera3D.new()
	cam.fov = 60.0
	cam.far = 6000.0
	cam.near = 0.2
	add_child(cam)
	cam.current = true

	if ResourceLoader.exists("res://audio/audio_engine.gd"):
		audio = load("res://audio/audio_engine.gd").new()
		add_child(audio)
	if ResourceLoader.exists("res://ui/ui.gd"):
		ui = load("res://ui/ui.gd").new()
		add_child(ui)
		if ui.has_signal("sound_toggled") and audio and audio.has_method("set_enabled"):
			ui.sound_toggled.connect(audio.set_enabled)
	Game.started.connect(_on_started)
	Game.to_menu()
	_reset_player()
	_spawn_sheep()
	# allow command-line autostart for screenshots: -- --mode=low --t=40
	for a in OS.get_cmdline_user_args():
		if a.begins_with("--mode="):
			Game.start(a.substr(7))
		elif a.begins_with("--shot="):
			_shot_path = a.substr(7)
			get_window().size = Vector2i(1280, 720)
		elif a.begins_with("--t="):
			_shot_time = float(a.substr(4))
		elif a.begins_with("--p="):
			_force_p = float(a.substr(4))
		elif a == "--walk":
			walking = true
		elif a == "--sheeptest":
			for i in sheep.size():
				sheep[i].x = 2.5 + (i % 4) * 2.2
				sheep[i].z = 70.0 - (i / 4) * 2.5
				sheep[i].hx = sheep[i].x
				sheep[i].hz = sheep[i].z
		elif a == "--noui":
			if ui: ui.visible = false
		elif a == "--nofog":
			_dbg_nofog = true
		elif a == "--novol":
			env.volumetric_fog_enabled = false
		elif a == "--noglow":
			env.glow_enabled = false


# ---------------------------------------------------------------- environment

func _build_environment() -> void:
	env = Environment.new()
	env.background_mode = Environment.BG_SKY
	var sky := Sky.new()
	sky_mat = ShaderMaterial.new()
	if ResourceLoader.exists("res://shaders/sky.gdshader"):
		sky_mat.shader = load("res://shaders/sky.gdshader")
		sky.sky_material = sky_mat
	else:
		var ps := ProceduralSkyMaterial.new()
		sky.sky_material = ps
	sky.radiance_size = Sky.RADIANCE_SIZE_128
	sky.process_mode = Sky.PROCESS_MODE_INCREMENTAL
	env.sky = sky
	env.ambient_light_source = Environment.AMBIENT_SOURCE_SKY
	env.ambient_light_sky_contribution = 0.85
	env.ambient_light_energy = 1.0
	env.reflected_light_source = Environment.REFLECTION_SOURCE_SKY
	env.tonemap_mode = Environment.TONE_MAPPER_ACES
	env.tonemap_exposure = 1.0
	env.tonemap_white = 6.0
	env.glow_enabled = true
	env.glow_intensity = 0.7
	env.glow_strength = 1.0
	env.glow_bloom = 0.06
	env.glow_hdr_threshold = 0.95
	env.glow_blend_mode = Environment.GLOW_BLEND_MODE_SOFTLIGHT
	for i in 7:
		env.set_glow_level(i, 1.0 if i in [2, 3, 4, 5] else 0.0)
	env.ssao_enabled = true
	env.ssao_radius = 1.5
	env.ssao_intensity = 1.2
	env.ssr_enabled = true
	env.ssr_max_steps = 48
	env.fog_enabled = true
	env.fog_mode = Environment.FOG_MODE_EXPONENTIAL
	env.fog_sun_scatter = 0.12
	env.fog_aerial_perspective = 0.75
	env.fog_sky_affect = 0.25
	env.fog_height = 2.0
	env.fog_height_density = 0.05
	env.volumetric_fog_enabled = true
	env.volumetric_fog_density = 0.008
	env.volumetric_fog_anisotropy = 0.25
	env.volumetric_fog_length = 140.0
	env.volumetric_fog_detail_spread = 2.0
	env.volumetric_fog_ambient_inject = 0.04
	env.volumetric_fog_sky_affect = 0.0
	env.adjustment_enabled = true
	env.adjustment_saturation = 1.15
	env.adjustment_contrast = 1.1
	var we := WorldEnvironment.new()
	we.environment = env
	add_child(we)

	sun = DirectionalLight3D.new()
	sun.shadow_enabled = true
	sun.directional_shadow_max_distance = 140.0
	sun.directional_shadow_mode = DirectionalLight3D.SHADOW_PARALLEL_4_SPLITS
	sun.shadow_blur = 1.5
	sun.light_angular_distance = 1.0
	sun.light_volumetric_fog_energy = 0.3
	add_child(sun)


func _apply_mood(dt: float) -> void:
	var top := Game.fc("sky_top")
	var mid := Game.fc("sky_mid")
	var hor := Game.fc("sky_hor")
	var sun_c := Game.fc("sun_col")
	var mist := Game.fv("mist")
	var stars := Game.fv("stars")
	var sun_y := Game.fv("sun_y")
	var restless: bool = Game.mode == "restless"
	var wv := Breath.world_val
	var sy := Breath.sync

	sky_mat.set_shader_parameter("sky_top", top)
	sky_mat.set_shader_parameter("sky_mid", mid)
	sky_mat.set_shader_parameter("sky_hor", hor)
	sky_mat.set_shader_parameter("sun_color", sun_c)
	sky_mat.set_shader_parameter("stars", stars)
	sky_mat.set_shader_parameter("clouds", Game.fv("clouds"))
	sky_mat.set_shader_parameter("mist", mist)
	sky_mat.set_shader_parameter("mist_color", hor.lerp(Color(0.85, 0.87, 0.9), 0.3))
	sky_mat.set_shader_parameter("sync", sy)
	sky_mat.set_shader_parameter("breath", wv)

	# sun placement: elevation from preset, fixed azimuth ahead of the start view
	var elev := sun_y * 0.95
	var to_sun := Vector3(sin(SUN_AZIMUTH) * cos(elev), sin(elev), -cos(SUN_AZIMUTH) * cos(elev)).normalized()
	sun.look_at_from_position(Vector3.ZERO, -to_sun, Vector3.UP if absf(to_sun.y) < 0.99 else Vector3.FORWARD)
	var vis := smoothstep(-0.06, 0.06, sun_y)
	# in-phase: scene brightens, sun swells; out-phase: softens back
	var breathe_light := 0.92 + 0.16 * wv
	sun.light_color = sun_c
	sun.light_energy = (0.35 if restless else 1.55) * vis * breathe_light * (0.85 + 0.25 * sy)
	sun.shadow_enabled = vis > 0.05

	env.fog_enabled = not _dbg_nofog
	env.fog_light_color = hor.lerp(mid, 0.5) * 0.85
	env.fog_density = 0.0002 + mist * 0.0045
	env.volumetric_fog_density = 0.0008 + mist * 0.012
	env.volumetric_fog_albedo = hor.lerp(Color.WHITE, 0.5)
	env.volumetric_fog_emission = hor * 0.02 * (1.0 - vis)
	env.ambient_light_energy = lerpf(0.5, 0.82, vis) * (0.6 if restless else 1.0) * (0.95 + 0.1 * wv)
	env.tonemap_exposure = (0.85 if restless else 1.0) * (1.0 - 0.25 * Game.e if restless else 1.0)
	env.glow_intensity = 0.55 + 0.35 * sy

	RenderingServer.global_shader_parameter_set("grass_base", Game.fc("grass_base"))
	RenderingServer.global_shader_parameter_set("grass_tip", Game.fc("grass_tip"))
	RenderingServer.global_shader_parameter_set("sun_dir", to_sun)
	RenderingServer.global_shader_parameter_set("sun_col", sun_c * vis)
	RenderingServer.global_shader_parameter_set("gust", Game.fv("wind"))
	RenderingServer.global_shader_parameter_set("player_pos", Vector2(pl_pos.x, pl_pos.z))

	WorldBuilder.set_detail(Game.fv("detail"))

	# lantern: glow expands on the in-phase, shrinks to a soft core on the out-phase
	if lantern_light:
		var dark := 1.0 - vis * 0.7
		lantern_light.light_energy = (0.4 + 1.1 * sy) * (0.6 + 0.6 * wv) * (0.6 + dark)
		lantern_light.omni_range = 9.0 + 10.0 * sy
		var hs := (0.9 + 1.4 * sy) * (0.75 + 0.45 * wv)
		lantern_halo.pixel_size = 0.0035 * hs
		lantern_halo.modulate.a = 0.35 + 0.4 * dark

	# motes drift up on the in-phase, settle down on the out-phase
	if motes:
		var life := Game.fv("life")
		motes.amount_ratio = clampf(0.15 + life, 0.0, 1.0)
		motes_mat.gravity = Vector3(0.15, 0.35 if Breath.rising else -0.22, 0.0)
		var ff := clampf(stars * 1.6, 0.0, 1.0)
		motes_mat.color = Color(1.0, 0.88, 0.55).lerp(Color(0.75, 1.0, 0.55), ff) * (1.4 + 1.2 * ff)
		motes.global_position = pl_pos + Vector3(0, 2.5, 0)
	if rain:
		rain.amount_ratio = Game.fv("rain")
		rain.emitting = rain.amount_ratio > 0.02
		rain.global_position = pl_pos + Vector3(0, 14, 0)


# ---------------------------------------------------------------- actors

func _glow_texture() -> Texture2D:
	var g := Gradient.new()
	g.set_color(0, Color(1, 1, 1, 1))
	g.set_color(1, Color(1, 1, 1, 0))
	g.add_point(0.18, Color(1, 1, 1, 0.7))
	g.add_point(0.5, Color(1, 1, 1, 0.15))
	var tex := GradientTexture2D.new()
	tex.gradient = g
	tex.fill = GradientTexture2D.FILL_RADIAL
	tex.fill_from = Vector2(0.5, 0.5)
	tex.fill_to = Vector2(1.0, 0.5)
	tex.width = 128
	tex.height = 128
	return tex


func _make_halo(color: Color, px: float) -> Sprite3D:
	var s := Sprite3D.new()
	s.texture = _glow_texture()
	s.billboard = BaseMaterial3D.BILLBOARD_ENABLED
	s.shaded = false
	s.transparent = true
	s.modulate = color
	s.pixel_size = px
	s.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
	var mat := StandardMaterial3D.new()
	mat.shading_mode = BaseMaterial3D.SHADING_MODE_UNSHADED
	mat.transparency = BaseMaterial3D.TRANSPARENCY_ALPHA
	mat.blend_mode = BaseMaterial3D.BLEND_MODE_ADD
	mat.billboard_mode = BaseMaterial3D.BILLBOARD_ENABLED
	mat.albedo_texture = s.texture
	mat.vertex_color_use_as_albedo = true
	mat.no_depth_test = false
	mat.disable_fog = true
	s.material_override = mat
	return s


func _build_hero() -> void:
	if ResourceLoader.exists("res://actors/models.gd"):
		hero = load("res://actors/models.gd").make_wanderer()
	else:
		hero = Node3D.new()
		var m := MeshInstance3D.new()
		m.mesh = CapsuleMesh.new()
		m.position.y = 1.0
		hero.add_child(m)
	add_child(hero)
	var tip: Node3D = hero.get_node_or_null("LanternTip")
	if tip == null:
		tip = Node3D.new()
		tip.position = Vector3(0.45, 2.3, 0.2)
		hero.add_child(tip)
	lantern_light = OmniLight3D.new()
	lantern_light.light_color = Color(1.0, 0.82, 0.55)
	lantern_light.shadow_enabled = false
	lantern_light.omni_attenuation = 1.4
	tip.add_child(lantern_light)
	lantern_halo = _make_halo(Color(1.0, 0.85, 0.55, 0.6), 0.008)
	tip.add_child(lantern_halo)


func _reset_player() -> void:
	pl_pos = Vector3(0, Terrain.height(0, 78), 78)
	pl_yaw = PI
	cam_yaw = PI
	pl_v = 0.0


func _spawn_sheep() -> void:
	for s in sheep:
		s.node.queue_free()
	sheep.clear()
	var M = load("res://actors/models.gd") if ResourceLoader.exists("res://actors/models.gd") else null
	var n := 0
	var tries := 0
	while n < Game.NSHEEP and tries < 4000:
		tries += 1
		var a := float(n) / Game.NSHEEP * TAU + randf() * 0.7
		var r := 28.0 + randf() * 82.0
		var x := cos(a) * r
		var z := sin(a) * r
		if Terrain.is_wet(x, z, 1.2):
			continue
		if Vector2(x - pl_pos.x, z - pl_pos.z).length_squared() < 900.0:
			continue
		var node: Node3D = M.make_sheep() if M else _fallback_sheep()
		add_child(node)
		var halo := _make_halo(Color(1.0, 0.84, 0.55, 0.7), 0.011)
		halo.position.y = 2.6
		node.scale = Vector3.ONE * 1.3
		node.add_child(halo)
		var light := OmniLight3D.new()
		light.light_color = Color(1.0, 0.85, 0.6)
		light.light_energy = 0.6
		light.omni_range = 5.0
		light.position.y = 2.6
		node.add_child(light)
		sheep.append({"node": node, "halo": halo, "light": light, "x": x, "z": z, "hx": x, "hz": z,
			"yaw": randf() * TAU, "joined": false, "ph": randf() * TAU, "walk": 0.0, "v": 0.0, "graze": 0.0})
		n += 1


func _fallback_sheep() -> Node3D:
	var n := Node3D.new()
	var m := MeshInstance3D.new()
	var s := SphereMesh.new()
	s.radius = 0.6
	s.height = 1.0
	m.mesh = s
	m.position.y = 0.8
	n.add_child(m)
	return n


func _build_particles() -> void:
	motes = GPUParticles3D.new()
	motes.amount = 420
	motes.lifetime = 9.0
	motes.local_coords = false
	motes.visibility_aabb = AABB(Vector3(-60, -20, -60), Vector3(120, 40, 120))
	motes_mat = ParticleProcessMaterial.new()
	motes_mat.emission_shape = ParticleProcessMaterial.EMISSION_SHAPE_BOX
	motes_mat.emission_box_extents = Vector3(32, 4, 32)
	motes_mat.initial_velocity_min = 0.05
	motes_mat.initial_velocity_max = 0.3
	motes_mat.direction = Vector3(0.3, 1, 0)
	motes_mat.spread = 60.0
	motes_mat.turbulence_enabled = true
	motes_mat.turbulence_noise_strength = 0.6
	motes_mat.turbulence_noise_scale = 6.0
	motes_mat.scale_min = 0.5
	motes_mat.scale_max = 1.2
	var alpha_curve := CurveTexture.new()
	var c := Curve.new()
	c.add_point(Vector2(0, 0))
	c.add_point(Vector2(0.2, 1))
	c.add_point(Vector2(0.8, 1))
	c.add_point(Vector2(1, 0))
	alpha_curve.curve = c
	motes_mat.scale_curve = alpha_curve
	motes.process_material = motes_mat
	var q := QuadMesh.new()
	q.size = Vector2(0.12, 0.12)
	var qm := StandardMaterial3D.new()
	qm.shading_mode = BaseMaterial3D.SHADING_MODE_UNSHADED
	qm.transparency = BaseMaterial3D.TRANSPARENCY_ALPHA
	qm.blend_mode = BaseMaterial3D.BLEND_MODE_ADD
	qm.billboard_mode = BaseMaterial3D.BILLBOARD_PARTICLES
	qm.albedo_texture = _glow_texture()
	qm.vertex_color_use_as_albedo = true
	qm.disable_fog = true
	q.material = qm
	motes.draw_pass_1 = q
	add_child(motes)

	rain = GPUParticles3D.new()
	rain.amount = 2500
	rain.lifetime = 1.2
	rain.local_coords = false
	rain.visibility_aabb = AABB(Vector3(-40, -30, -40), Vector3(80, 50, 80))
	var rm := ParticleProcessMaterial.new()
	rm.emission_shape = ParticleProcessMaterial.EMISSION_SHAPE_BOX
	rm.emission_box_extents = Vector3(30, 1, 30)
	rm.direction = Vector3(0.15, -1, 0.05)
	rm.spread = 3.0
	rm.initial_velocity_min = 16.0
	rm.initial_velocity_max = 20.0
	rm.gravity = Vector3(0, -6, 0)
	rm.particle_flag_align_y = true
	rain.process_material = rm
	var rq := QuadMesh.new()
	rq.size = Vector2(0.025, 0.7)
	var rqm := StandardMaterial3D.new()
	rqm.shading_mode = BaseMaterial3D.SHADING_MODE_UNSHADED
	rqm.transparency = BaseMaterial3D.TRANSPARENCY_ALPHA
	rqm.albedo_color = Color(0.85, 0.9, 1.0, 0.28)
	rqm.billboard_mode = BaseMaterial3D.BILLBOARD_FIXED_Y
	rqm.billboard_keep_scale = true
	rq.material = rqm
	rain.draw_pass_1 = rq
	rain.emitting = false
	add_child(rain)


func _build_birds() -> void:
	var mesh := ArrayMesh.new()
	var v := PackedVector3Array([Vector3(0, 0, 0.25), Vector3(-1.1, 0.1, -0.2), Vector3(0, 0, -0.25),
		Vector3(0, 0, 0.25), Vector3(0, 0, -0.25), Vector3(1.1, 0.1, -0.2)])
	var arr := []
	arr.resize(Mesh.ARRAY_MAX)
	arr[Mesh.ARRAY_VERTEX] = v
	mesh.add_surface_from_arrays(Mesh.PRIMITIVE_TRIANGLES, arr)
	var mat := StandardMaterial3D.new()
	mat.albedo_color = Color(0.12, 0.1, 0.14)
	mat.cull_mode = BaseMaterial3D.CULL_DISABLED
	mat.shading_mode = BaseMaterial3D.SHADING_MODE_UNSHADED
	for i in 6:
		var b := MeshInstance3D.new()
		b.mesh = mesh
		b.material_override = mat
		b.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
		b.set_meta("ph", randf() * TAU)
		b.set_meta("off", Vector3(randf_range(-8, 8), randf_range(-3, 3), randf_range(-8, 8)))
		add_child(b)
		birds.append(b)


func _build_overlay() -> void:
	var layer := CanvasLayer.new()
	layer.layer = 0
	var rect := ColorRect.new()
	rect.set_anchors_preset(Control.PRESET_FULL_RECT)
	rect.mouse_filter = Control.MOUSE_FILTER_IGNORE
	var sh := Shader.new()
	sh.code = """
shader_type canvas_item;
uniform float strength = 0.45;
float h(vec2 p){ return fract(sin(dot(p, vec2(12.9898,78.233))) * 43758.5453); }
void fragment(){
	vec2 uv = SCREEN_UV - 0.5;
	uv.x *= SCREEN_PIXEL_SIZE.y / SCREEN_PIXEL_SIZE.x;
	float v = smoothstep(0.35, 1.0, length(uv) * 1.25);
	float g = (h(FRAGCOORD.xy + fract(TIME) * 100.0) - 0.5) * 0.035;
	COLOR = vec4(vec3(0.02, 0.025, 0.06) + g, v * strength + abs(g));
}
"""
	var m := ShaderMaterial.new()
	m.shader = sh
	rect.material = m
	layer.add_child(rect)
	add_child(layer)


# ---------------------------------------------------------------- input

func _unhandled_input(ev: InputEvent) -> void:
	if ev is InputEventMouseButton and ev.button_index == MOUSE_BUTTON_LEFT:
		walking = ev.pressed
	elif ev is InputEventMouseMotion:
		mouse_x = ev.position.x / get_viewport().get_visible_rect().size.x
	elif ev is InputEventScreenTouch:
		walking = ev.pressed
		mouse_x = ev.position.x / get_viewport().get_visible_rect().size.x
	elif ev is InputEventScreenDrag:
		mouse_x = ev.position.x / get_viewport().get_visible_rect().size.x
	elif ev is InputEventKey and not ev.echo:
		keys[ev.physical_keycode] = ev.pressed
		if ev.physical_keycode == KEY_SPACE:
			Breath.set_held(ev.pressed)


func _key(k: int) -> bool:
	return keys.get(k, false)


func _on_started(_m: String) -> void:
	_reset_player()
	_spawn_sheep()


# ---------------------------------------------------------------- frame

func _process(dt: float) -> void:
	t += dt
	if _force_p >= 0.0 and Game.state == "play":
		Game.p = _force_p
		Game.e = Game.ease_s(_force_p)
	if _shot_path != "" and t > _shot_time:
		get_viewport().get_texture().get_image().save_png(_shot_path)
		print("SHOT ", _shot_path, " fps=", Engine.get_frames_per_second(), " size=", get_viewport().get_visible_rect().size, " pos=", pl_pos, " flock=", Game.flock)
		_shot_path = ""
		get_tree().quit()
	var playing: bool = Game.state == "play"
	_move_player(dt, playing)
	_update_flock(dt, playing)
	_update_birds(dt)
	_update_camera(dt, playing)
	_apply_mood(dt)
	Game.player_pos = pl_pos
	Game.player_yaw = pl_yaw


func _move_player(dt: float, playing: bool) -> void:
	var fwd := playing and (walking or _key(KEY_W) or _key(KEY_UP))
	var turn := 0.0
	if playing:
		if _key(KEY_A) or _key(KEY_LEFT):
			turn -= 1.0
		if _key(KEY_D) or _key(KEY_RIGHT):
			turn += 1.0
		if walking:
			var t2 := (mouse_x - 0.5) * 2.0
			if absf(t2) > 0.12:
				turn += t2 * 1.2
	pl_yaw -= clampf(turn, -1.4, 1.4) * 1.5 * dt
	pl_v += ((WALK_SPEED * (0.9 + 0.25 * Breath.sync) if fwd else 0.0) - pl_v) * minf(1.0, dt * 3.0)
	var nx := pl_pos.x + sin(pl_yaw) * pl_v * dt
	var nz := pl_pos.z + cos(pl_yaw) * pl_v * dt
	if not Terrain.is_wet(nx, nz, -0.15) and nx * nx + nz * nz < Terrain.WALK_R * Terrain.WALK_R:
		pl_pos.x = nx
		pl_pos.z = nz
	else:
		pl_v *= 0.5
	pl_pos.y = Terrain.height(pl_pos.x, pl_pos.z)
	walk_phase += pl_v * dt * 1.6
	hero.position = pl_pos
	hero.rotation.y = pl_yaw
	if hero.has_method("animate") or not ResourceLoader.exists("res://actors/models.gd"):
		return
	load("res://actors/models.gd").animate_wanderer(hero, walk_phase, clampf(pl_v / WALK_SPEED, 0.0, 1.0), t)


func _update_flock(dt: float, playing: bool) -> void:
	var M = load("res://actors/models.gd") if ResourceLoader.exists("res://actors/models.gd") else null
	var fx := sin(pl_yaw)
	var fz := cos(pl_yaw)
	var ji := 0
	_bell_timer -= dt
	for s in sheep:
		var tx: float
		var tz: float
		var sp: float
		if not s.joined:
			var dd := Vector2(s.x - pl_pos.x, s.z - pl_pos.z).length_squared()
			if playing and dd < 64.0:
				s.joined = true
				Game.add_sheep()
				var tw := create_tween()
				tw.tween_property(s.halo, "modulate:a", 0.0, 2.0)
				tw.parallel().tween_property(s.light, "light_energy", 0.0, 2.0)
			tx = s.hx + sin(t * 0.13 + s.ph) * 3.0
			tz = s.hz + cos(t * 0.11 + s.ph) * 3.0
			sp = 0.5
			s.halo.modulate.a = 0.55 + 0.3 * sin(t * 1.5 + s.ph) if not s.joined else s.halo.modulate.a
		else:
			var row := ji / 2 + 1
			var side := (1.0 if ji % 2 else -1.0) * (1.2 + row * 0.35)
			var back := row * (2.1 + (1.0 - Breath.sync) * 1.5)
			ji += 1
			tx = pl_pos.x - fx * back + fz * side
			tz = pl_pos.z - fz * back - fx * side
			sp = 5.2
		var dx: float = tx - s.x
		var dz: float = tz - s.z
		var d := sqrt(dx * dx + dz * dz)
		var want := 0.0
		if d > 0.4:
			want = minf(sp, d * 1.2)
			s.yaw = lerp_angle(s.yaw, atan2(dx, dz), minf(1.0, dt * 3.0))
		s.v = lerpf(s.v, want, minf(1.0, dt * 3.0))
		s.x += sin(s.yaw) * s.v * dt
		s.z += cos(s.yaw) * s.v * dt
		s.walk += s.v * dt * 2.4
		s.graze = lerpf(s.graze, 1.0 if s.v < 0.3 else 0.0, dt * 1.5)
		var node: Node3D = s.node
		node.position = Vector3(s.x, Terrain.height(s.x, s.z), s.z)
		node.rotation.y = s.yaw
		if M:
			M.animate_sheep(node, s.walk, clampf(s.v / 4.0, 0.0, 1.0), t + s.ph, s.graze * (0.5 + 0.5 * sin(t * 0.3 + s.ph)))
		if s.joined and _bell_timer < 0.0 and audio and audio.has_method("sheep_bell") and randf() < 0.3:
			audio.sheep_bell(1.0 + 0.25 * randf())
	if _bell_timer < 0.0:
		_bell_timer = 3.0 + randf() * 5.0


func _update_birds(dt: float) -> void:
	var life := Game.fv("life")
	for b in birds:
		var ph: float = b.get_meta("ph")
		var off: Vector3 = b.get_meta("off")
		var a := t * 0.05 + ph * 0.05
		var c := Vector3(40, 55 + 6 * sin(t * 0.2), -120)
		b.position = c + Vector3(cos(a) * 70, 0, sin(a) * 50) + off
		b.rotation.y = -a
		b.scale = Vector3(1, 1 + 0.9 * sin(t * 6.0 + ph), 1) * 1.6
		b.visible = life > 0.35


func _update_camera(dt: float, playing: bool) -> void:
	var target_yaw := pl_yaw
	if not playing:
		target_yaw = PI + sin(t * 0.04) * 0.25  # slow drifting establishing shot
	cam_yaw = lerp_angle(cam_yaw, target_yaw, minf(1.0, dt * 1.6))
	var back := CAM_BACK if playing else 14.0
	var up := CAM_UP if playing else 5.5
	var cp := pl_pos + Vector3(-sin(cam_yaw) * back, up, -cos(cam_yaw) * back)
	cp.y = maxf(cp.y, Terrain.height(cp.x, cp.z) + 1.6)
	cam.position = cam.position.lerp(cp, minf(1.0, dt * 4.0)) if t > 0.2 else cp
	var look := pl_pos + Vector3(sin(cam_yaw) * 12.0, 2.7, cos(cam_yaw) * 12.0)
	cam.look_at(look, Vector3.UP)
	var aspect := get_viewport().get_visible_rect().size
	var base_fov := 78.0 if aspect.x < aspect.y else 60.0
	cam.fov = base_fov + 0.8 * Breath.world_val  # tiny widen on the in-phase (motion comfort)
