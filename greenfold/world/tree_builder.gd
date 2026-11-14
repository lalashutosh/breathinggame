class_name TreeBuilder
extends RefCounted


static func make_pine(seed: int) -> ArrayMesh:
	var rng := RandomNumberGenerator.new()
	rng.seed = seed

	var st: SurfaceTool = _begin_surface()
	var height: float = rng.randf_range(8.0, 11.0)
	var sway_spread: float = height * 0.24
	var trunk_height: float = height * 0.34
	var trunk_top := Vector3(
		rng.randf_range(-0.18, 0.18),
		trunk_height,
		rng.randf_range(-0.18, 0.18)
	)

	_add_tapered_branch(
		st,
		Vector3.ZERO,
		trunk_top,
		height * 0.026,
		height * 0.010,
		7,
		Color(0.29, 0.235, 0.18),
		Color(0.37, 0.30, 0.225),
		height,
		sway_spread,
		rng,
		0.10
	)

	var tier_count: int = rng.randi_range(4, 6)
	for i in range(tier_count):
		var t: float = float(i) / float(tier_count - 1)
		var base_y: float = lerpf(height * 0.12, height * 0.66, t)
		base_y += rng.randf_range(-0.014, 0.014) * height

		var tier_height: float = lerpf(height * 0.42, height * 0.34, t)
		var top_y: float = base_y + tier_height
		if i == tier_count - 1:
			top_y = height
		else:
			top_y = minf(top_y, height * 0.94)

		var tier_radius: float = height * lerpf(0.205, 0.062, t)
		tier_radius *= rng.randf_range(0.90, 1.08)

		var trunk_alignment: float = clampf(base_y / trunk_height, 0.0, 1.0) * 0.45
		var base_center := Vector3(
			trunk_top.x * trunk_alignment + rng.randf_range(-0.08, 0.08) * tier_radius,
			base_y,
			trunk_top.z * trunk_alignment + rng.randf_range(-0.08, 0.08) * tier_radius
		)
		var apex := Vector3(
			base_center.x + rng.randf_range(-0.16, 0.16) * tier_radius,
			top_y,
			base_center.z + rng.randf_range(-0.16, 0.16) * tier_radius
		)

		var foliage := Color(
			0.105 + t * 0.025,
			0.220 + t * 0.040,
			0.200 + t * 0.030
		)
		foliage = _vary_color(foliage, rng, 0.08)

		_add_cone_tier(
			st,
			base_center,
			apex,
			tier_radius,
			rng.randi_range(7, 9),
			foliage,
			height,
			sway_spread,
			rng
		)

	return _finish_surface(st)


static func make_broadleaf(seed: int) -> ArrayMesh:
	var rng := RandomNumberGenerator.new()
	rng.seed = seed

	var st: SurfaceTool = _begin_surface()
	var height: float = rng.randf_range(6.0, 8.0)
	var sway_spread: float = height * 0.31
	var trunk_top := Vector3(
		rng.randf_range(-0.28, 0.28),
		height * 0.59,
		rng.randf_range(-0.28, 0.28)
	)

	_add_tapered_branch(
		st,
		Vector3.ZERO,
		trunk_top,
		height * 0.043,
		height * 0.014,
		8,
		Color(0.30, 0.245, 0.185),
		Color(0.39, 0.315, 0.225),
		height,
		sway_spread,
		rng,
		0.09
	)

	var blob_count: int = rng.randi_range(4, 7)
	var branch_count: int = rng.randi_range(2, 3)
	var centers: Array[Vector3] = []
	var radii: Array[Vector3] = []

	for i in range(blob_count):
		if i == 0:
			centers.append(Vector3(
				trunk_top.x * 0.35 + rng.randf_range(-0.12, 0.12) * height,
				height * 0.78,
				trunk_top.z * 0.35 + rng.randf_range(-0.12, 0.12) * height
			))
			radii.append(Vector3(
				height * rng.randf_range(0.175, 0.205),
				height * rng.randf_range(0.185, 0.205),
				height * rng.randf_range(0.170, 0.200)
			))
		else:
			var angle: float = TAU * float(i - 1) / float(blob_count - 1)
			angle += rng.randf_range(-0.30, 0.30)
			var distance: float = height * rng.randf_range(0.11, 0.19)
			centers.append(Vector3(
				cos(angle) * distance + trunk_top.x * 0.35,
				height * rng.randf_range(0.62, 0.73),
				sin(angle) * distance + trunk_top.z * 0.35
			))
			radii.append(Vector3(
				height * rng.randf_range(0.155, 0.210),
				height * rng.randf_range(0.145, 0.180),
				height * rng.randf_range(0.155, 0.210)
			))

	for i in range(branch_count):
		var start_fraction: float = 0.34 + float(i) * 0.065
		var lean_fraction: float = start_fraction / 0.59
		var branch_start := Vector3(
			trunk_top.x * lean_fraction,
			height * start_fraction,
			trunk_top.z * lean_fraction
		)
		var branch_end: Vector3 = centers[i + 1]
		branch_end.y -= radii[i + 1].y * 0.22

		_add_tapered_branch(
			st,
			branch_start,
			branch_end,
			height * (0.023 - float(i) * 0.002),
			height * 0.008,
			6,
			Color(0.32, 0.260, 0.195),
			Color(0.38, 0.310, 0.220),
			height,
			sway_spread,
			rng,
			0.08
		)

	for i in range(blob_count):
		var warmth: float = 1.0 if i == 0 else rng.randf_range(0.0, 0.30)
		var bottom_color := Color(
			rng.randf_range(0.215, 0.255),
			rng.randf_range(0.295, 0.345),
			rng.randf_range(0.135, 0.175)
		)
		var top_color := Color(
			lerpf(0.375, 0.49, warmth),
			lerpf(0.445, 0.55, warmth),
			lerpf(0.215, 0.285, warmth)
		)

		_add_lumpy_icosphere(
			st,
			centers[i],
			radii[i],
			rng,
			bottom_color,
			top_color,
			0.16,
			height,
			sway_spread,
			false
		)

	return _finish_surface(st)


static func make_bush(seed: int) -> ArrayMesh:
	var rng := RandomNumberGenerator.new()
	rng.seed = seed

	var st: SurfaceTool = _begin_surface()
	var height: float = rng.randf_range(1.0, 1.5)
	var blob_count: int = rng.randi_range(2, 4)

	for i in range(blob_count):
		var center: Vector3
		var blob_radii: Vector3

		if i == 0:
			center = Vector3(0.0, height * 0.50, 0.0)
			blob_radii = Vector3(height * 0.43, height * 0.48, height * 0.41)
		else:
			var angle: float = TAU * float(i - 1) / float(maxi(blob_count - 1, 1))
			angle += rng.randf_range(-0.45, 0.45)
			var distance: float = height * rng.randf_range(0.14, 0.23)
			center = Vector3(
				cos(angle) * distance,
				height * rng.randf_range(0.43, 0.50),
				sin(angle) * distance
			)
			blob_radii = Vector3(
				height * rng.randf_range(0.29, 0.38),
				height * rng.randf_range(0.30, 0.36),
				height * rng.randf_range(0.29, 0.38)
			)

		var bottom_color := Color(
			rng.randf_range(0.19, 0.23),
			rng.randf_range(0.28, 0.33),
			rng.randf_range(0.12, 0.16)
		)
		var top_color := Color(
			rng.randf_range(0.36, 0.42),
			rng.randf_range(0.44, 0.50),
			rng.randf_range(0.21, 0.27)
		)

		_add_lumpy_icosphere(
			st,
			center,
			blob_radii,
			rng,
			bottom_color,
			top_color,
			0.17,
			height,
			height * 0.55,
			true
		)

	return _finish_surface(st)


static func make_rock(seed: int) -> ArrayMesh:
	var rng := RandomNumberGenerator.new()
	rng.seed = seed

	var st: SurfaceTool = _begin_surface()
	var size: float = rng.randf_range(1.0, 2.5)
	var vertices: Array[Vector3] = _icosahedron_vertices()
	var faces: Array[Vector3i] = _icosahedron_faces()
	var radii := Vector3(
		size * rng.randf_range(0.68, 0.80),
		size * 0.46,
		size * rng.randf_range(0.62, 0.75)
	)

	var raw_points: Array[Vector3] = []
	var minimum_y: float = INF
	var maximum_y: float = -INF

	for unit in vertices:
		var lump: float = 1.0 + rng.randf_range(-0.15, 0.15)
		var point := Vector3(
			unit.x * radii.x,
			unit.y * radii.y,
			unit.z * radii.z
		) * lump
		raw_points.append(point)
		minimum_y = minf(minimum_y, point.y)
		maximum_y = maxf(maximum_y, point.y)

	var vertical_scale: float = size / maxf(maximum_y - minimum_y, 0.001)
	var points: Array[Vector3] = []
	for point in raw_points:
		points.append(Vector3(
			point.x,
			(point.y - minimum_y) * vertical_scale,
			point.z
		))

	var shape_center := Vector3(0.0, size * 0.5, 0.0)
	var rock_color := Color(0.38, 0.355, 0.325)
	var moss_color := Color(0.30, 0.355, 0.225)

	for face in faces:
		var a: Vector3 = points[face.x]
		var b: Vector3 = points[face.y]
		var c: Vector3 = points[face.z]
		var face_center: Vector3 = (a + b + c) / 3.0
		var normal: Vector3 = (b - a).cross(c - a).normalized()
		if normal.dot(face_center - shape_center) < 0.0:
			normal = -normal

		var moss_factor: float = smoothstep(0.25, 0.90, normal.y) * 0.55
		var face_color: Color = rock_color.lerp(moss_color, moss_factor)
		face_color = _vary_color(face_color, rng, 0.09)
		var vertex_color: Color = _rgba(face_color, 0.0)
		_add_triangle(st, a, b, c, vertex_color, vertex_color, vertex_color)

	return _finish_surface(st)


static func make_mountain_ring(
	radius: float,
	height: float,
	seed: int,
	segments: int = 220
) -> ArrayMesh:
	var rng := RandomNumberGenerator.new()
	rng.seed = seed

	var st: SurfaceTool = _begin_surface()
	var segment_count: int = maxi(segments, 12)
	var safe_radius: float = maxf(radius, 1.0)
	var safe_height: float = maxf(height, 1.0)
	var thickness: float = safe_radius * 0.25
	var base_cycles: float = float(rng.randi_range(4, 6))
	var snow_phase: float = rng.randf_range(0.0, TAU)

	var phases: Array[float] = []
	for i in range(6):
		phases.append(rng.randf_range(0.0, TAU))

	var raw_heights: Array[float] = []
	var raw_minimum: float = INF
	var raw_maximum: float = -INF
	for i in range(segment_count):
		var angle: float = TAU * float(i) / float(segment_count)
		var value: float = _ridge_value(angle, phases, base_cycles)
		raw_heights.append(value)
		raw_minimum = minf(raw_minimum, value)
		raw_maximum = maxf(raw_maximum, value)

	var top_heights: Array[float] = []
	var raw_range: float = maxf(raw_maximum - raw_minimum, 0.0001)
	for value in raw_heights:
		var normalized_height: float = clampf(
			(value - raw_minimum) / raw_range,
			0.0,
			1.0
		)
		normalized_height = pow(normalized_height, 1.12)
		top_heights.append(safe_height * lerpf(0.25, 1.0, normalized_height))

	var outer_bases: Array[Vector3] = []
	var outer_ridges: Array[Vector3] = []
	var top_ridges: Array[Vector3] = []
	var inner_ridges: Array[Vector3] = []
	var inner_bases: Array[Vector3] = []

	for i in range(segment_count):
		var angle: float = TAU * float(i) / float(segment_count)
		var top_y: float = top_heights[i]
		var top_radius: float = safe_radius + thickness * (
			0.46 + rng.randf_range(-0.035, 0.035)
		)
		var outer_y: float = top_y * 0.50
		outer_y += sin(angle * 13.0 + snow_phase) * safe_height * 0.018
		var inner_y: float = top_y * 0.58
		inner_y += sin(angle * 17.0 - snow_phase) * safe_height * 0.018

		outer_bases.append(_polar_point(safe_radius + thickness, angle, -40.0))
		outer_ridges.append(_polar_point(
			safe_radius + thickness * 0.76,
			angle,
			outer_y
		))
		top_ridges.append(_polar_point(top_radius, angle, top_y))
		inner_ridges.append(_polar_point(
			safe_radius + thickness * 0.18,
			angle,
			inner_y
		))
		inner_bases.append(_polar_point(safe_radius, angle, -40.0))

	# These five strips form a closed solid band, including its underside.
	_connect_mountain_strip(
		st, outer_bases, outer_ridges, safe_height, snow_phase, rng
	)
	_connect_mountain_strip(
		st, outer_ridges, top_ridges, safe_height, snow_phase, rng
	)
	_connect_mountain_strip(
		st, top_ridges, inner_ridges, safe_height, snow_phase, rng
	)
	_connect_mountain_strip(
		st, inner_ridges, inner_bases, safe_height, snow_phase, rng
	)
	_connect_mountain_strip(
		st, inner_bases, outer_bases, safe_height, snow_phase, rng
	)

	return _finish_surface(st)


static func _begin_surface() -> SurfaceTool:
	var st := SurfaceTool.new()
	st.begin(Mesh.PRIMITIVE_TRIANGLES)
	st.set_smooth_group(-1)
	return st


static func _finish_surface(st: SurfaceTool) -> ArrayMesh:
	st.generate_normals()
	return st.commit()


static func _add_triangle(
	st: SurfaceTool,
	a: Vector3,
	b: Vector3,
	c: Vector3,
	color_a: Color,
	color_b: Color,
	color_c: Color
) -> void:
	st.set_color(color_a)
	st.add_vertex(a)
	st.set_color(color_b)
	st.add_vertex(b)
	st.set_color(color_c)
	st.add_vertex(c)


static func _rgba(rgb: Color, alpha: float) -> Color:
	return Color(rgb.r, rgb.g, rgb.b, clampf(alpha, 0.0, 1.0))


static func _vary_color(
	rgb: Color,
	rng: RandomNumberGenerator,
	amount: float
) -> Color:
	var factor: float = rng.randf_range(1.0 - amount, 1.0 + amount)
	return Color(
		clampf(rgb.r * factor, 0.0, 1.0),
		clampf(rgb.g * factor, 0.0, 1.0),
		clampf(rgb.b * factor, 0.0, 1.0),
		1.0
	)


static func _sway_weight(
	point: Vector3,
	height: float,
	spread: float
) -> float:
	if point.y <= 0.0:
		return 0.0

	var height_fraction: float = clampf(point.y / maxf(height, 0.001), 0.0, 1.0)
	var radial_fraction: float = clampf(
		Vector2(point.x, point.z).length() / maxf(spread, 0.001),
		0.0,
		1.0
	)
	var height_weight: float = pow(height_fraction, 1.35)
	return clampf(
		height_weight + (1.0 - height_weight) * radial_fraction * 0.45,
		0.0,
		1.0
	)


static func _canopy_alpha(
	point: Vector3,
	height: float,
	spread: float,
	bush_sway: bool
) -> float:
	if bush_sway:
		var fraction: float = clampf(point.y / maxf(height, 0.001), 0.0, 1.0)
		return lerpf(0.3, 0.8, fraction)
	return _sway_weight(point, height, spread)


static func _add_tapered_branch(
	st: SurfaceTool,
	start: Vector3,
	end: Vector3,
	radius_start: float,
	radius_end: float,
	sides: int,
	start_rgb: Color,
	end_rgb: Color,
	height: float,
	sway_spread: float,
	rng: RandomNumberGenerator,
	irregularity: float
) -> void:
	var offset: Vector3 = end - start
	var branch_length: float = offset.length()
	if branch_length < 0.0001:
		return

	var axis: Vector3 = offset / branch_length
	var reference: Vector3 = (
		Vector3.RIGHT if absf(axis.dot(Vector3.UP)) > 0.9 else Vector3.UP
	)
	var tangent: Vector3 = axis.cross(reference).normalized()
	var bitangent: Vector3 = axis.cross(tangent).normalized()
	var ring_start: Array[Vector3] = []
	var ring_end: Array[Vector3] = []

	for i in range(sides):
		var angle: float = TAU * float(i) / float(sides)
		angle += rng.randf_range(-0.035, 0.035)
		var direction: Vector3 = tangent * cos(angle) + bitangent * sin(angle)
		var lump: float = 1.0 + rng.randf_range(-irregularity, irregularity)
		ring_start.append(start + direction * radius_start * lump)
		ring_end.append(end + direction * radius_end * lump)

	for i in range(sides):
		var next: int = (i + 1) % sides
		var side_start_rgb: Color = _vary_color(start_rgb, rng, 0.045)
		var side_end_rgb: Color = _vary_color(end_rgb, rng, 0.045)
		var a: Vector3 = ring_start[i]
		var b: Vector3 = ring_start[next]
		var c: Vector3 = ring_end[next]
		var d: Vector3 = ring_end[i]

		var ca: Color = _rgba(side_start_rgb, _sway_weight(a, height, sway_spread))
		var cb: Color = _rgba(side_start_rgb, _sway_weight(b, height, sway_spread))
		var cc: Color = _rgba(side_end_rgb, _sway_weight(c, height, sway_spread))
		var cd: Color = _rgba(side_end_rgb, _sway_weight(d, height, sway_spread))
		_add_triangle(st, a, b, c, ca, cb, cc)
		_add_triangle(st, a, c, d, ca, cc, cd)

		var base_center_color: Color = _rgba(
			start_rgb,
			_sway_weight(start, height, sway_spread)
		)
		_add_triangle(st, start, b, a, base_center_color, cb, ca)

		var end_center_color: Color = _rgba(
			end_rgb,
			_sway_weight(end, height, sway_spread)
		)
		_add_triangle(st, end, d, c, end_center_color, cd, cc)


static func _add_cone_tier(
	st: SurfaceTool,
	base_center: Vector3,
	apex: Vector3,
	radius: float,
	sides: int,
	rgb: Color,
	height: float,
	sway_spread: float,
	rng: RandomNumberGenerator
) -> void:
	var ring: Array[Vector3] = []
	var angle_offset: float = rng.randf_range(0.0, TAU)
	var tilt := Vector2(
		rng.randf_range(-0.11, 0.11),
		rng.randf_range(-0.11, 0.11)
	)

	for i in range(sides):
		var angle: float = TAU * float(i) / float(sides) + angle_offset
		angle += rng.randf_range(-0.055, 0.055)
		var radial_distance: float = radius * rng.randf_range(0.82, 1.17)
		var x: float = cos(angle) * radial_distance
		var z: float = sin(angle) * radial_distance
		var y: float = base_center.y + x * tilt.x + z * tilt.y
		y += rng.randf_range(-0.045, 0.045) * radius
		ring.append(Vector3(base_center.x + x, y, base_center.z + z))

	for i in range(sides):
		var next: int = (i + 1) % sides
		var a: Vector3 = ring[i]
		var b: Vector3 = ring[next]
		var face_rgb: Color = _vary_color(rgb, rng, 0.10)
		var ca: Color = _rgba(face_rgb, _sway_weight(a, height, sway_spread))
		var cb: Color = _rgba(face_rgb, _sway_weight(b, height, sway_spread))
		var apex_color: Color = _rgba(
			face_rgb,
			_sway_weight(apex, height, sway_spread)
		)
		var center_color: Color = _rgba(
			face_rgb,
			_sway_weight(base_center, height, sway_spread)
		)

		_add_triangle(st, a, apex, b, ca, apex_color, cb)
		_add_triangle(st, base_center, a, b, center_color, ca, cb)


static func _add_lumpy_icosphere(
	st: SurfaceTool,
	center: Vector3,
	radii: Vector3,
	rng: RandomNumberGenerator,
	bottom_color: Color,
	top_color: Color,
	jitter: float,
	height: float,
	sway_spread: float,
	bush_sway: bool
) -> void:
	var vertices: Array[Vector3] = _icosahedron_vertices()
	var source_faces: Array[Vector3i] = _icosahedron_faces()
	var faces: Array[Vector3i] = []
	var midpoint_cache: Dictionary = {}

	for face in source_faces:
		var ab: int = _midpoint_index(vertices, face.x, face.y, midpoint_cache)
		var bc: int = _midpoint_index(vertices, face.y, face.z, midpoint_cache)
		var ca_index: int = _midpoint_index(vertices, face.z, face.x, midpoint_cache)

		faces.append(Vector3i(face.x, ab, ca_index))
		faces.append(Vector3i(face.y, bc, ab))
		faces.append(Vector3i(face.z, ca_index, bc))
		faces.append(Vector3i(ab, bc, ca_index))

	var points: Array[Vector3] = []
	for unit in vertices:
		var lump: float = 1.0 + rng.randf_range(-jitter, jitter)
		var local_point := Vector3(
			unit.x * radii.x,
			unit.y * radii.y,
			unit.z * radii.z
		) * lump
		points.append(center + local_point)

	for face in faces:
		var a: Vector3 = points[face.x]
		var b: Vector3 = points[face.y]
		var c: Vector3 = points[face.z]
		var unit_average: Vector3 = (
			vertices[face.x] + vertices[face.y] + vertices[face.z]
		) / 3.0
		var light_factor: float = clampf(unit_average.y * 0.65 + 0.45, 0.0, 1.0)
		var face_rgb: Color = bottom_color.lerp(top_color, light_factor)
		face_rgb = _vary_color(face_rgb, rng, 0.075)

		var color_a: Color = _rgba(
			face_rgb,
			_canopy_alpha(a, height, sway_spread, bush_sway)
		)
		var color_b: Color = _rgba(
			face_rgb,
			_canopy_alpha(b, height, sway_spread, bush_sway)
		)
		var color_c: Color = _rgba(
			face_rgb,
			_canopy_alpha(c, height, sway_spread, bush_sway)
		)
		_add_triangle(st, a, b, c, color_a, color_b, color_c)


static func _midpoint_index(
	vertices: Array[Vector3],
	a: int,
	b: int,
	cache: Dictionary
) -> int:
	var key: int = mini(a, b) * 64 + maxi(a, b)
	if cache.has(key):
		return int(cache[key])

	var midpoint: Vector3 = (vertices[a] + vertices[b]).normalized()
	vertices.append(midpoint)
	var index: int = vertices.size() - 1
	cache[key] = index
	return index


static func _icosahedron_vertices() -> Array[Vector3]:
	var t: float = (1.0 + sqrt(5.0)) * 0.5
	var vertices: Array[Vector3] = [
		Vector3(-1.0, t, 0.0),
		Vector3(1.0, t, 0.0),
		Vector3(-1.0, -t, 0.0),
		Vector3(1.0, -t, 0.0),
		Vector3(0.0, -1.0, t),
		Vector3(0.0, 1.0, t),
		Vector3(0.0, -1.0, -t),
		Vector3(0.0, 1.0, -t),
		Vector3(t, 0.0, -1.0),
		Vector3(t, 0.0, 1.0),
		Vector3(-t, 0.0, -1.0),
		Vector3(-t, 0.0, 1.0)
	]
	for i in range(vertices.size()):
		vertices[i] = vertices[i].normalized()
	return vertices


static func _icosahedron_faces() -> Array[Vector3i]:
	var faces: Array[Vector3i] = [
		Vector3i(0, 11, 5),
		Vector3i(0, 5, 1),
		Vector3i(0, 1, 7),
		Vector3i(0, 7, 10),
		Vector3i(0, 10, 11),
		Vector3i(1, 5, 9),
		Vector3i(5, 11, 4),
		Vector3i(11, 10, 2),
		Vector3i(10, 7, 6),
		Vector3i(7, 1, 8),
		Vector3i(3, 9, 4),
		Vector3i(3, 4, 2),
		Vector3i(3, 2, 6),
		Vector3i(3, 6, 8),
		Vector3i(3, 8, 9),
		Vector3i(4, 9, 5),
		Vector3i(2, 4, 11),
		Vector3i(6, 2, 10),
		Vector3i(8, 6, 7),
		Vector3i(9, 8, 1)
	]
	return faces


static func _ridge_value(
	angle: float,
	phases: Array[float],
	base_cycles: float
) -> float:
	var sum: float = 0.0
	var normalization: float = 0.0
	var amplitude: float = 1.0
	var frequency: float = base_cycles

	# Absolute sine ridges create cusped peaks while the octaves add saddles.
	for octave in range(6):
		var wave: float = 1.0 - absf(sin(angle * frequency + phases[octave]))
		wave = pow(wave, 1.25)
		sum += wave * amplitude
		normalization += amplitude
		frequency *= 2.0
		amplitude *= 0.52

	return sum / normalization


static func _polar_point(radius: float, angle: float, y: float) -> Vector3:
	return Vector3(cos(angle) * radius, y, sin(angle) * radius)


static func _connect_mountain_strip(
	st: SurfaceTool,
	strip_a: Array[Vector3],
	strip_b: Array[Vector3],
	max_height: float,
	snow_phase: float,
	rng: RandomNumberGenerator
) -> void:
	var count: int = strip_a.size()
	for i in range(count):
		var next: int = (i + 1) % count
		var angle_a: float = TAU * float(i) / float(count)
		var angle_b: float = TAU * float(next) / float(count)
		var rock_rgb: Color = _vary_color(
			Color(0.35, 0.33, 0.38),
			rng,
			0.065
		)
		_add_mountain_quad(
			st,
			strip_a[i],
			strip_b[i],
			strip_b[next],
			strip_a[next],
			angle_a,
			angle_b,
			max_height,
			rock_rgb,
			snow_phase
		)


static func _add_mountain_quad(
	st: SurfaceTool,
	a: Vector3,
	b: Vector3,
	c: Vector3,
	d: Vector3,
	angle_a: float,
	angle_b: float,
	max_height: float,
	rock_rgb: Color,
	snow_phase: float
) -> void:
	var ca: Color = _mountain_vertex_color(
		a.y, angle_a, max_height, rock_rgb, snow_phase
	)
	var cb: Color = _mountain_vertex_color(
		b.y, angle_a, max_height, rock_rgb, snow_phase
	)
	var cc: Color = _mountain_vertex_color(
		c.y, angle_b, max_height, rock_rgb, snow_phase
	)
	var cd: Color = _mountain_vertex_color(
		d.y, angle_b, max_height, rock_rgb, snow_phase
	)
	_add_triangle(st, a, b, c, ca, cb, cc)
	_add_triangle(st, a, c, d, ca, cc, cd)


static func _mountain_vertex_color(
	y: float,
	angle: float,
	max_height: float,
	rock_rgb: Color,
	snow_phase: float
) -> Color:
	var snowline: float = max_height * (
		0.70
		+ sin(angle * 31.0 + snow_phase) * 0.035
		+ sin(angle * 67.0 - snow_phase * 1.7) * 0.025
	)
	var snow: float = smoothstep(
		snowline,
		snowline + max_height * 0.035,
		y
	)
	return _rgba(rock_rgb, snow)
