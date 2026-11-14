class_name Models
extends RefCounted

static var _material_cache: Dictionary = {}
static var _sheep_serial: int = 0

const WOOL_TINTS: Array[Color] = [
	Color(0.88, 0.85, 0.77),
	Color(0.92, 0.87, 0.76),
	Color(0.86, 0.83, 0.75),
	Color(0.94, 0.89, 0.79),
	Color(0.89, 0.84, 0.72),
]


static func _material(
	key: String,
	color: Color,
	wool: bool = false,
	emission_strength: float = 0.0
) -> StandardMaterial3D:
	if _material_cache.has(key):
		return _material_cache[key] as StandardMaterial3D

	var material := StandardMaterial3D.new()
	material.albedo_color = color
	material.roughness = 1.0
	material.rim_enabled = true
	material.rim = 0.5
	material.rim_tint = 0.5

	if wool:
		material.backlight_enabled = true
		material.backlight = Color(0.32, 0.22, 0.13, 1.0)

	if emission_strength > 0.0:
		material.emission_enabled = true
		material.emission = Color(1.0, 0.52, 0.16, 1.0)
		material.emission_energy_multiplier = emission_strength

	_material_cache[key] = material
	return material


static func _wool_material(index: int) -> StandardMaterial3D:
	var safe_index := clampi(index, 0, WOOL_TINTS.size() - 1)
	return _material(
		"sheep_wool_%d" % safe_index,
		WOOL_TINTS[safe_index],
		true
	)


static func _add_mesh(
	parent: Node3D,
	mesh: Mesh,
	material: StandardMaterial3D,
	at: Vector3,
	scl: Vector3 = Vector3.ONE,
	euler: Vector3 = Vector3.ZERO
) -> MeshInstance3D:
	var instance := MeshInstance3D.new()
	instance.mesh = mesh
	instance.material_override = material
	instance.position = at
	instance.scale = scl
	instance.rotation = euler
	instance.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_ON
	parent.add_child(instance)
	return instance


static func _ellipsoid(
	parent: Node3D,
	at: Vector3,
	radii: Vector3,
	material: StandardMaterial3D,
	segments: int = 10,
	rings: int = 5,
	euler: Vector3 = Vector3.ZERO
) -> MeshInstance3D:
	var mesh := SphereMesh.new()
	mesh.radius = 1.0
	mesh.height = 2.0
	mesh.radial_segments = segments
	mesh.rings = rings
	return _add_mesh(parent, mesh, material, at, radii, euler)


static func _cylinder(
	parent: Node3D,
	at: Vector3,
	top_radius: float,
	bottom_radius: float,
	height: float,
	material: StandardMaterial3D,
	segments: int = 10,
	scl: Vector3 = Vector3.ONE,
	euler: Vector3 = Vector3.ZERO
) -> MeshInstance3D:
	var mesh := CylinderMesh.new()
	mesh.top_radius = top_radius
	mesh.bottom_radius = bottom_radius
	mesh.height = height
	mesh.radial_segments = segments
	mesh.rings = 1
	return _add_mesh(parent, mesh, material, at, scl, euler)


static func _capsule(
	parent: Node3D,
	at: Vector3,
	radius: float,
	height: float,
	material: StandardMaterial3D,
	segments: int = 8,
	scl: Vector3 = Vector3.ONE,
	euler: Vector3 = Vector3.ZERO
) -> MeshInstance3D:
	var mesh := CapsuleMesh.new()
	mesh.radius = radius
	mesh.height = height
	mesh.radial_segments = segments
	mesh.rings = 2
	return _add_mesh(parent, mesh, material, at, scl, euler)


static func _box(
	parent: Node3D,
	at: Vector3,
	size: Vector3,
	material: StandardMaterial3D,
	euler: Vector3 = Vector3.ZERO
) -> MeshInstance3D:
	var mesh := BoxMesh.new()
	mesh.size = size
	return _add_mesh(parent, mesh, material, at, Vector3.ONE, euler)


static func _torus(
	parent: Node3D,
	at: Vector3,
	inner_radius: float,
	outer_radius: float,
	material: StandardMaterial3D,
	scl: Vector3 = Vector3.ONE,
	euler: Vector3 = Vector3.ZERO
) -> MeshInstance3D:
	var mesh := TorusMesh.new()
	mesh.inner_radius = inner_radius
	mesh.outer_radius = outer_radius
	mesh.rings = 12
	mesh.ring_segments = 6
	return _add_mesh(parent, mesh, material, at, scl, euler)


static func make_wanderer() -> Node3D:
	var root := Node3D.new()
	root.name = "Wanderer"

	var cloak_mat := _material(
		"wanderer_cloak",
		Color(0.58, 0.29, 0.21)
	)
	var hood_shadow_mat := _material(
		"wanderer_hood_shadow",
		Color(0.25, 0.12, 0.10)
	)
	var scarf_mat := _material(
		"wanderer_scarf",
		Color(0.88, 0.81, 0.66)
	)
	var skin_mat := _material(
		"wanderer_skin",
		Color(0.62, 0.40, 0.28)
	)
	var boot_mat := _material(
		"wanderer_boots",
		Color(0.115, 0.095, 0.09)
	)
	var leather_mat := _material(
		"wanderer_leather",
		Color(0.30, 0.16, 0.09)
	)
	var leather_dark_mat := _material(
		"wanderer_leather_dark",
		Color(0.20, 0.105, 0.065)
	)
	var wood_mat := _material(
		"wanderer_staff_wood",
		Color(0.29, 0.18, 0.10)
	)
	var frame_mat := _material(
		"lantern_frame",
		Color(0.085, 0.08, 0.07)
	)
	var brass_mat := _material(
		"shared_brass",
		Color(0.58, 0.39, 0.13)
	)
	var glass_mat := _material(
		"lantern_warm_glass",
		Color(1.0, 0.69, 0.25),
		false,
		1.8
	)

	var body := Node3D.new()
	body.name = "Body"
	root.add_child(body)

	_cylinder(
		body,
		Vector3(0.0, 0.85, 0.0),
		0.21,
		0.40,
		1.14,
		cloak_mat,
		12,
		Vector3(1.0, 1.0, 0.78)
	).name = "Cloak"

	_ellipsoid(
		body,
		Vector3(0.0, 1.31, -0.015),
		Vector3(0.29, 0.21, 0.22),
		cloak_mat,
		12,
		5
	).name = "RoundedShoulders"

	_torus(
		body,
		Vector3(0.0, 1.415, 0.0),
		0.13,
		0.19,
		scarf_mat,
		Vector3(1.0, 1.0, 0.82)
	).name = "ScarfCollar"

	_capsule(
		body,
		Vector3(-0.065, 1.22, 0.22),
		0.047,
		0.30,
		scarf_mat,
		8,
		Vector3(1.0, 1.0, 0.55),
		Vector3(0.0, 0.0, 0.08)
	).name = "ScarfTailLong"

	_capsule(
		body,
		Vector3(0.065, 1.27, 0.205),
		0.041,
		0.22,
		scarf_mat,
		8,
		Vector3(1.0, 1.0, 0.55),
		Vector3(0.0, 0.0, -0.10)
	).name = "ScarfTailShort"

	_ellipsoid(
		body,
		Vector3(0.0, 1.53, -0.035),
		Vector3(0.245, 0.23, 0.225),
		cloak_mat,
		12,
		6
	).name = "Hood"

	_ellipsoid(
		body,
		Vector3(0.0, 1.515, 0.15),
		Vector3(0.17, 0.178, 0.055),
		hood_shadow_mat,
		10,
		5
	).name = "HoodOpening"

	_ellipsoid(
		body,
		Vector3(0.0, 1.49, 0.18),
		Vector3(0.125, 0.142, 0.04),
		skin_mat,
		10,
		5
	).name = "Face"

	_torus(
		body,
		Vector3(0.0, 1.515, 0.185),
		0.145,
		0.19,
		cloak_mat,
		Vector3.ONE,
		Vector3(PI * 0.5, 0.0, 0.0)
	).name = "HoodRim"

	_box(
		body,
		Vector3(-0.02, 1.09, 0.235),
		Vector3(0.04, 0.72, 0.018),
		leather_dark_mat,
		Vector3(0.0, 0.0, -0.72)
	).name = "SatchelStrap"

	_ellipsoid(
		body,
		Vector3(-0.31, 0.82, 0.10),
		Vector3(0.14, 0.15, 0.075),
		leather_mat,
		10,
		5,
		Vector3(0.0, 0.0, 0.08)
	).name = "Satchel"

	_box(
		body,
		Vector3(-0.31, 0.90, 0.14),
		Vector3(0.24, 0.085, 0.12),
		leather_dark_mat,
		Vector3(0.0, 0.0, 0.08)
	).name = "SatchelFlap"

	_ellipsoid(
		body,
		Vector3(-0.31, 0.89, 0.207),
		Vector3(0.018, 0.018, 0.012),
		brass_mat,
		8,
		4
	).name = "SatchelButton"

	_ellipsoid(
		body,
		Vector3(0.275, 1.055, 0.11),
		Vector3(0.12, 0.17, 0.11),
		cloak_mat,
		10,
		5,
		Vector3(0.0, 0.0, -0.35)
	).name = "StaffSleeve"

	_ellipsoid(
		body,
		Vector3(0.415, 1.03, 0.19),
		Vector3(0.055, 0.06, 0.05),
		skin_mat,
		8,
		4
	).name = "StaffHand"

	for i in range(2):
		var side: float = -1.0 if i == 0 else 1.0
		var leg := Node3D.new()
		leg.name = "LegL" if i == 0 else "LegR"
		leg.position = Vector3(side * 0.125, 0.70, 0.0)
		root.add_child(leg)

		_capsule(
			leg,
			Vector3(0.0, -0.24, 0.0),
			0.06,
			0.52,
			boot_mat,
			8
		)

		_box(
			leg,
			Vector3(0.0, -0.60, 0.065),
			Vector3(0.15, 0.20, 0.26),
			boot_mat
		)

	var staff := Node3D.new()
	staff.name = "Staff"
	staff.position = Vector3(0.45, 0.0, 0.18)
	staff.rotation.x = 0.025
	body.add_child(staff)

	_cylinder(
		staff,
		Vector3(0.0, 0.81, 0.0),
		0.022,
		0.026,
		1.62,
		wood_mat,
		8
	).name = "WoodenStaff"

	_ellipsoid(
		staff,
		Vector3(0.0, 1.62, 0.0),
		Vector3(0.031, 0.036, 0.031),
		wood_mat,
		8,
		4
	).name = "StaffKnob"

	_torus(
		staff,
		Vector3(0.0, 1.585, 0.065),
		0.035,
		0.047,
		frame_mat,
		Vector3.ONE,
		Vector3(PI * 0.5, 0.0, 0.0)
	).name = "LanternHandle"

	_cylinder(
		staff,
		Vector3(0.0, 1.425, 0.065),
		0.065,
		0.065,
		0.135,
		glass_mat,
		8
	).name = "LanternGlass"

	_cylinder(
		staff,
		Vector3(0.0, 1.345, 0.065),
		0.08,
		0.08,
		0.025,
		frame_mat,
		8
	).name = "LanternBase"

	_cylinder(
		staff,
		Vector3(0.0, 1.505, 0.065),
		0.08,
		0.08,
		0.025,
		frame_mat,
		8
	).name = "LanternTop"

	_cylinder(
		staff,
		Vector3(0.0, 1.54, 0.065),
		0.0,
		0.085,
		0.055,
		frame_mat,
		8
	).name = "LanternRoof"

	var lantern_corners: Array[Vector2] = [
		Vector2(-1.0, -1.0),
		Vector2(-1.0, 1.0),
		Vector2(1.0, -1.0),
		Vector2(1.0, 1.0),
	]
	for corner in lantern_corners:
		_box(
			staff,
			Vector3(
				corner.x * 0.055,
				1.425,
				0.065 + corner.y * 0.055
			),
			Vector3(0.012, 0.15, 0.012),
			frame_mat
		)

	var lantern_tip := Node3D.new()
	lantern_tip.name = "LanternTip"
	lantern_tip.position = Vector3(0.0, 1.425, 0.065)
	staff.add_child(lantern_tip)

	return root


static func make_sheep() -> Node3D:
	var root := Node3D.new()
	root.name = "Sheep"

	var rng := RandomNumberGenerator.new()
	var sheep_id := _sheep_serial
	_sheep_serial += 1
	rng.seed = 0x5EED + sheep_id * 7919

	var tint_index := rng.randi_range(0, WOOL_TINTS.size() - 1)
	var head_wool_mat := _wool_material(tint_index)
	var face_mat := _material(
		"sheep_charcoal",
		Color(0.075, 0.07, 0.065)
	)
	var muzzle_mat := _material(
		"sheep_muzzle",
		Color(0.105, 0.095, 0.082)
	)
	var eye_mat := _material(
		"sheep_eyes",
		Color(0.91, 0.82, 0.61)
	)
	var brass_mat := _material(
		"shared_brass",
		Color(0.58, 0.39, 0.13)
	)

	var body := Node3D.new()
	body.name = "Body"
	body.position = Vector3(0.0, 0.63, 0.0)
	root.add_child(body)

	var clump_positions: Array[Vector3] = [
		Vector3(0.0, 0.02, 0.0),
		Vector3(-0.19, 0.04, -0.22),
		Vector3(0.19, 0.04, -0.22),
		Vector3(-0.22, 0.02, 0.02),
		Vector3(0.22, 0.02, 0.02),
		Vector3(-0.17, 0.015, 0.23),
		Vector3(0.17, 0.015, 0.23),
		Vector3(0.0, 0.17, -0.22),
		Vector3(0.0, 0.18, 0.01),
		Vector3(0.0, 0.14, 0.25),
		Vector3(-0.12, -0.14, -0.08),
		Vector3(0.13, -0.13, 0.12),
	]
	var clump_radii: Array[Vector3] = [
		Vector3(0.29, 0.245, 0.36),
		Vector3(0.17, 0.17, 0.19),
		Vector3(0.17, 0.17, 0.19),
		Vector3(0.16, 0.17, 0.18),
		Vector3(0.16, 0.17, 0.18),
		Vector3(0.17, 0.16, 0.18),
		Vector3(0.17, 0.16, 0.18),
		Vector3(0.19, 0.15, 0.19),
		Vector3(0.19, 0.15, 0.20),
		Vector3(0.18, 0.16, 0.17),
		Vector3(0.17, 0.13, 0.18),
		Vector3(0.17, 0.14, 0.18),
	]

	for i in range(clump_positions.size()):
		var at: Vector3 = clump_positions[i] + Vector3(
			rng.randf_range(-0.018, 0.018),
			rng.randf_range(-0.014, 0.014),
			rng.randf_range(-0.018, 0.018)
		)
		var radii: Vector3 = clump_radii[i] * rng.randf_range(0.93, 1.07)
		radii.x *= rng.randf_range(0.96, 1.04)
		radii.y *= rng.randf_range(0.96, 1.04)
		radii.z *= rng.randf_range(0.96, 1.04)

		var clump_tint := clampi(
			tint_index + rng.randi_range(-1, 1),
			0,
			WOOL_TINTS.size() - 1
		)
		var segments := 8 + rng.randi_range(0, 1) * 2
		var rings := 4 + rng.randi_range(0, 1)
		var euler := Vector3(
			rng.randf_range(-0.12, 0.12),
			rng.randf_range(-PI, PI),
			rng.randf_range(-0.12, 0.12)
		)

		_ellipsoid(
			body,
			at,
			radii,
			_wool_material(clump_tint),
			segments,
			rings,
			euler
		).name = "WoolClump%02d" % i

	var head := Node3D.new()
	head.name = "Head"
	head.position = Vector3(0.0, 0.80, 0.32)
	root.add_child(head)

	_ellipsoid(
		head,
		Vector3(0.0, -0.015, 0.18),
		Vector3(0.145, 0.16, 0.235),
		face_mat,
		10,
		5
	).name = "Face"

	_ellipsoid(
		head,
		Vector3(0.0, -0.055, 0.345),
		Vector3(0.105, 0.095, 0.105),
		muzzle_mat,
		10,
		4
	).name = "Muzzle"

	_ellipsoid(
		head,
		Vector3(-0.17, 0.035, 0.095),
		Vector3(0.13, 0.04, 0.065),
		face_mat,
		8,
		4,
		Vector3(0.0, 0.0, -0.18)
	).name = "EarL"

	_ellipsoid(
		head,
		Vector3(0.17, 0.035, 0.095),
		Vector3(0.13, 0.04, 0.065),
		face_mat,
		8,
		4,
		Vector3(0.0, 0.0, 0.18)
	).name = "EarR"

	_ellipsoid(
		head,
		Vector3(-0.105, 0.025, 0.292),
		Vector3(0.017, 0.020, 0.014),
		eye_mat,
		8,
		4
	).name = "EyeL"

	_ellipsoid(
		head,
		Vector3(0.105, 0.025, 0.292),
		Vector3(0.017, 0.020, 0.014),
		eye_mat,
		8,
		4
	).name = "EyeR"

	_ellipsoid(
		head,
		Vector3(0.0, 0.18, 0.07),
		Vector3(0.095, 0.11, 0.09),
		head_wool_mat,
		8,
		4
	).name = "WoolTuftCentre"

	_ellipsoid(
		head,
		Vector3(-0.065, 0.145, 0.095),
		Vector3(0.075, 0.08, 0.075),
		head_wool_mat,
		8,
		4
	).name = "WoolTuftL"

	_ellipsoid(
		head,
		Vector3(0.06, 0.15, 0.08),
		Vector3(0.075, 0.08, 0.075),
		head_wool_mat,
		8,
		4
	).name = "WoolTuftR"

	_cylinder(
		head,
		Vector3(0.0, -0.19, 0.19),
		0.025,
		0.045,
		0.055,
		brass_mat,
		8
	).name = "Bell"

	_ellipsoid(
		head,
		Vector3(0.0, -0.225, 0.19),
		Vector3(0.014, 0.014, 0.014),
		face_mat,
		8,
		4
	).name = "BellClapper"

	var leg_positions: Array[Vector3] = [
		Vector3(-0.17, 0.43, 0.23),
		Vector3(0.17, 0.43, 0.23),
		Vector3(-0.17, 0.43, -0.22),
		Vector3(0.17, 0.43, -0.22),
	]

	for i in range(leg_positions.size()):
		var leg := Node3D.new()
		leg.name = "Leg%d" % i
		leg.position = leg_positions[i]
		root.add_child(leg)

		_cylinder(
			leg,
			Vector3(0.0, -0.18, 0.0),
			0.032,
			0.038,
			0.36,
			face_mat,
			8
		)

		_box(
			leg,
			Vector3(0.0, -0.395, 0.015),
			Vector3(0.075, 0.07, 0.10),
			face_mat
		)

	return root


static func animate_wanderer(
	n: Node3D,
	walk_phase: float,
	speed01: float,
	t: float
) -> void:
	if n == null:
		return

	var speed := clampf(speed01, 0.0, 1.0)
	var idle := 1.0 - speed
	var stride := sin(walk_phase)
	var swing := stride * 0.5 * speed
	var body_bob := 0.022 * (
		0.5 - 0.5 * cos(walk_phase * 2.0)
	) * speed

	var leg_l := n.get_node_or_null("LegL") as Node3D
	var leg_r := n.get_node_or_null("LegR") as Node3D
	if leg_l != null:
		leg_l.rotation = Vector3(swing, 0.0, 0.0)
	if leg_r != null:
		leg_r.rotation = Vector3(-swing, 0.0, 0.0)

	var body := n.get_node_or_null("Body") as Node3D
	if body != null:
		var breath := sin(t * 1.45) * 0.006 * idle
		body.position = Vector3(0.0, body_bob, 0.0)
		body.rotation = Vector3(
			0.008 * sin(walk_phase * 2.0) * speed,
			0.0,
			0.022 * stride * speed + 0.004 * sin(t * 0.7) * idle
		)
		body.scale = Vector3(
			1.0 + breath,
			1.0 + breath * 0.35,
			1.0 + breath
		)

	var staff: Node3D = null
	if body != null:
		staff = body.get_node_or_null("Staff") as Node3D
	if staff == null:
		staff = n.get_node_or_null("Staff") as Node3D

	if staff != null:
		staff.rotation = Vector3(
			0.025
				+ 0.012 * sin(t * 1.1) * idle
				+ 0.015 * sin(walk_phase + 0.4) * speed,
			0.0,
			0.012 * sin(t * 0.9 + 1.0) * idle
				+ 0.02 * stride * speed
		)


static func animate_sheep(
	n: Node3D,
	walk_phase: float,
	speed01: float,
	t: float,
	graze: float
) -> void:
	if n == null:
		return

	var speed := clampf(speed01, 0.0, 1.0)
	var graze_amount := clampf(graze, 0.0, 1.0)
	var idle := 1.0 - speed
	var stride := sin(walk_phase)
	var swing := stride * 0.48 * speed
	var body_bob := 0.018 * (
		0.5 - 0.5 * cos(walk_phase * 2.0)
	) * speed

	for i in range(4):
		var leg := n.get_node_or_null("Leg%d" % i) as Node3D
		if leg != null:
			var direction: float = 1.0 if i == 0 or i == 3 else -1.0
			leg.rotation = Vector3(swing * direction, 0.0, 0.0)

	var body := n.get_node_or_null("Body") as Node3D
	if body != null:
		var breath := sin(t * 1.3) * 0.004 * idle
		body.position = Vector3(0.0, 0.63 + body_bob, 0.0)
		body.rotation = Vector3(
			0.0,
			0.0,
			0.015 * stride * speed + 0.004 * sin(t * 0.8) * idle
		)
		body.scale = Vector3(
			1.0 + breath,
			1.0 + breath * 0.5,
			1.0 + breath
		)

	var head := n.get_node_or_null("Head") as Node3D
	if head != null:
		var head_bob := (
			0.025 * sin(walk_phase * 2.0 + 0.5) * speed
			+ 0.012 * sin(t * 1.7) * idle
		)
		var free_head := 1.0 - graze_amount
		var head_nod := free_head * (
			0.035 * sin(walk_phase + 0.3) * speed
			+ 0.015 * sin(t * 1.15) * idle
		)

		head.position = Vector3(
			0.0,
			0.80 + body_bob + head_bob * free_head - 0.32 * graze_amount,
			0.32 + 0.10 * graze_amount
		)
		head.rotation = Vector3(
			1.15 * graze_amount + head_nod,
			0.0,
			0.018 * sin(t * 0.9) * idle * free_head
		)
