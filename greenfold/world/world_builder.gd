class_name WorldBuilder
extends RefCounted
## Builds the static valley: terrain, grass field, flower field, lake, trees, rocks, mountains.

const GRASS_TILE := 84.0
const GRASS_BLADES := 80000
const FLOWERS := 3200

static var tree_multimeshes: Array[MultiMeshInstance3D] = []


static func build(root: Node3D) -> void:
	_terrain(root, 420.0, 210, 0.0)
	_terrain(root, 2400.0, 160, -1.6)
	_grass(root)
	_flowers(root)
	_lake(root)
	_trees(root)
	_mountains(root)


static func _terrain(root: Node3D, size: float, n: int, sink: float) -> void:
	var verts := PackedVector3Array()
	var norms := PackedVector3Array()
	var idx := PackedInt32Array()
	var step := size / n
	var half := size * 0.5
	for j in n + 1:
		for i in n + 1:
			var x := -half + i * step
			var z := -half + j * step
			var h := Terrain.height(x, z)
			if sink != 0.0:
				h += sink * (1.0 - smoothstep(190.0, 215.0, sqrt(x * x + z * z)))
			verts.append(Vector3(x, h, z))
			norms.append(Terrain.normal(x, z))
	for j in n:
		for i in n:
			var a := j * (n + 1) + i
			var b := a + 1
			var c := a + n + 1
			var d := c + 1
			idx.append_array([a, b, c, b, d, c])
	var arr := []
	arr.resize(Mesh.ARRAY_MAX)
	arr[Mesh.ARRAY_VERTEX] = verts
	arr[Mesh.ARRAY_NORMAL] = norms
	arr[Mesh.ARRAY_INDEX] = idx
	var mesh := ArrayMesh.new()
	mesh.add_surface_from_arrays(Mesh.PRIMITIVE_TRIANGLES, arr)
	var mat := ShaderMaterial.new()
	mat.shader = load("res://shaders/terrain.gdshader")
	mesh.surface_set_material(0, mat)
	var mi := MeshInstance3D.new()
	mi.mesh = mesh
	mi.name = "Terrain%d" % int(size)
	root.add_child(mi)


static func _grass(root: Node3D) -> void:
	var rng := RandomNumberGenerator.new()
	rng.seed = 7
	var verts := PackedVector3Array()
	var uv := PackedVector2Array()
	var uv2 := PackedVector2Array()
	var col := PackedColorArray()
	var idx := PackedInt32Array()
	var levels := [0.0, 0.38, 0.72]
	verts.resize(GRASS_BLADES * 7)
	uv.resize(GRASS_BLADES * 7)
	uv2.resize(GRASS_BLADES * 7)
	col.resize(GRASS_BLADES * 7)
	idx.resize(GRASS_BLADES * 15)
	var vi := 0
	var ii := 0
	for b in GRASS_BLADES:
		var off := Vector2(rng.randf() * GRASS_TILE, rng.randf() * GRASS_TILE)
		var r2 := Vector2(rng.randf(), rng.randf())
		var c := Color(rng.randf(), 0, 0)
		var base := vi
		for y in levels:
			for s in [-1.0, 1.0]:
				verts[vi] = Vector3(s, y, 0)
				uv[vi] = off
				uv2[vi] = r2
				col[vi] = c
				vi += 1
		verts[vi] = Vector3(0, 1, 0)
		uv[vi] = off
		uv2[vi] = r2
		col[vi] = c
		vi += 1
		for q in 2:
			var a := base + q * 2
			idx[ii] = a; idx[ii + 1] = a + 1; idx[ii + 2] = a + 2
			idx[ii + 3] = a + 1; idx[ii + 4] = a + 3; idx[ii + 5] = a + 2
			ii += 6
		idx[ii] = base + 4; idx[ii + 1] = base + 5; idx[ii + 2] = base + 6
		ii += 3
	var arr := []
	arr.resize(Mesh.ARRAY_MAX)
	arr[Mesh.ARRAY_VERTEX] = verts
	arr[Mesh.ARRAY_TEX_UV] = uv
	arr[Mesh.ARRAY_TEX_UV2] = uv2
	arr[Mesh.ARRAY_COLOR] = col
	arr[Mesh.ARRAY_INDEX] = idx
	var mesh := ArrayMesh.new()
	mesh.add_surface_from_arrays(Mesh.PRIMITIVE_TRIANGLES, arr)
	var mat := ShaderMaterial.new()
	mat.shader = load("res://shaders/grass.gdshader")
	mat.set_shader_parameter("tile", GRASS_TILE)
	mesh.surface_set_material(0, mat)
	var mi := MeshInstance3D.new()
	mi.mesh = mesh
	mi.name = "Grass"
	mi.custom_aabb = AABB(Vector3(-2000, -200, -2000), Vector3(4000, 600, 4000))
	mi.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
	root.add_child(mi)


static func _flowers(root: Node3D) -> void:
	var rng := RandomNumberGenerator.new()
	rng.seed = 11
	var verts := PackedVector3Array()
	var uv := PackedVector2Array()
	var uv2 := PackedVector2Array()
	var col := PackedColorArray()
	var idx := PackedInt32Array()
	for f in FLOWERS:
		var off := Vector2(rng.randf() * GRASS_TILE, rng.randf() * GRASS_TILE)
		var c := Color(rng.randf(), rng.randf(), rng.randf())
		var base := verts.size()
		for k in [Vector2(-1, -1), Vector2(1, -1), Vector2(1, 1), Vector2(-1, 1)]:
			verts.append(Vector3(k.x, k.y, 0))
			uv.append(k * 0.5 + Vector2(0.5, 0.5))
			uv2.append(off)
			col.append(c)
		idx.append_array([base, base + 1, base + 2, base, base + 2, base + 3])
	var arr := []
	arr.resize(Mesh.ARRAY_MAX)
	arr[Mesh.ARRAY_VERTEX] = verts
	arr[Mesh.ARRAY_TEX_UV] = uv
	arr[Mesh.ARRAY_TEX_UV2] = uv2
	arr[Mesh.ARRAY_COLOR] = col
	arr[Mesh.ARRAY_INDEX] = idx
	var mesh := ArrayMesh.new()
	mesh.add_surface_from_arrays(Mesh.PRIMITIVE_TRIANGLES, arr)
	var mat := ShaderMaterial.new()
	mat.shader = load("res://shaders/flowers.gdshader")
	mat.set_shader_parameter("tile", GRASS_TILE)
	mesh.surface_set_material(0, mat)
	var mi := MeshInstance3D.new()
	mi.mesh = mesh
	mi.name = "Flowers"
	mi.custom_aabb = AABB(Vector3(-2000, -200, -2000), Vector3(4000, 600, 4000))
	mi.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
	root.add_child(mi)


static func _lake(root: Node3D) -> void:
	var cyl := CylinderMesh.new()
	cyl.top_radius = 64.0
	cyl.bottom_radius = 64.0
	cyl.height = 0.02
	cyl.radial_segments = 96
	cyl.rings = 1
	var mi := MeshInstance3D.new()
	mi.mesh = cyl
	mi.name = "Lake"
	mi.position = Vector3(Terrain.LAKE_C.x, Terrain.WATER_LEVEL, Terrain.LAKE_C.y)
	mi.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
	if ResourceLoader.exists("res://shaders/lake.gdshader"):
		var mat := ShaderMaterial.new()
		mat.shader = load("res://shaders/lake.gdshader")
		mi.material_override = mat
	else:
		var m := StandardMaterial3D.new()
		m.albedo_color = Color(0.1, 0.2, 0.3)
		m.roughness = 0.05
		mi.material_override = m
	root.add_child(mi)


static func _foliage_mat(sway: float, bl: float) -> ShaderMaterial:
	var m := ShaderMaterial.new()
	m.shader = load("res://shaders/foliage.gdshader")
	m.set_shader_parameter("sway", sway)
	m.set_shader_parameter("backlight_amt", bl)
	return m


static func _scatter(root: Node3D, meshes: Array, count: int, pref: Vector2, r_min: float, mat: Material, scale_rng: Vector2, seed: int, shadows := true) -> void:
	var rng := RandomNumberGenerator.new()
	rng.seed = seed
	var per := ceili(float(count) / meshes.size())
	for mesh_i in meshes.size():
		var mm := MultiMesh.new()
		mm.transform_format = MultiMesh.TRANSFORM_3D
		mm.mesh = meshes[mesh_i]
		var xforms: Array[Transform3D] = []
		var tries := 0
		while xforms.size() < per and tries < 20000:
			tries += 1
			var a := rng.randf() * TAU
			var r := r_min + pow(rng.randf(), 0.7) * 175.0
			var x := cos(a) * r
			var z := sin(a) * r
			if Terrain.is_wet(x, z, 1.2):
				continue
			if absf(x) < 9.0 and z > 40.0 and z < 95.0:
				continue
			var dens := 0.12 + 0.88 * smoothstep(pref.x, pref.y, r) * (0.5 + 0.5 * sin(x * 0.05 + 2.0) * cos(z * 0.04))
			if rng.randf() > dens:
				continue
			var s := rng.randf_range(scale_rng.x, scale_rng.y)
			var basis := Basis(Vector3.UP, rng.randf() * TAU).scaled(Vector3(s, s * rng.randf_range(0.9, 1.2), s))
			xforms.append(Transform3D(basis, Vector3(x, Terrain.height(x, z) - 0.2, z)))
		mm.instance_count = xforms.size()
		for k in xforms.size():
			mm.set_instance_transform(k, xforms[k])
		var mmi := MultiMeshInstance3D.new()
		mmi.multimesh = mm
		mmi.material_override = mat
		mmi.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_ON if shadows else GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
		root.add_child(mmi)
		tree_multimeshes.append(mmi)


static func _trees(root: Node3D) -> void:
	tree_multimeshes.clear()
	if not ResourceLoader.exists("res://world/tree_builder.gd"):
		return
	var TB = load("res://world/tree_builder.gd")
	var pines := [TB.make_pine(1), TB.make_pine(2), TB.make_pine(3)]
	var leaves := [TB.make_broadleaf(4), TB.make_broadleaf(5), TB.make_broadleaf(6)]
	var bushes := [TB.make_bush(7), TB.make_bush(8)]
	var rocks := [TB.make_rock(9), TB.make_rock(10), TB.make_rock(11)]
	_scatter(root, pines, 240, Vector2(45, 120), 22.0, _foliage_mat(0.6, 0.25), Vector2(0.7, 1.4), 21)
	_scatter(root, leaves, 120, Vector2(20, 90), 18.0, _foliage_mat(1.0, 0.4), Vector2(0.7, 1.3), 22)
	_scatter(root, bushes, 160, Vector2(10, 80), 10.0, _foliage_mat(1.0, 0.45), Vector2(0.7, 1.4), 23, false)
	_scatter(root, rocks, 70, Vector2(0, 150), 10.0, _foliage_mat(0.0, 0.0), Vector2(0.5, 1.6), 24)


static func _mountains(root: Node3D) -> void:
	if not ResourceLoader.exists("res://world/tree_builder.gd"):
		return
	var TB = load("res://world/tree_builder.gd")
	var rings := [[950.0, 560.0, 31, Color(0.36, 0.32, 0.4)], [1600.0, 980.0, 32, Color(0.46, 0.44, 0.56)]]
	for r in rings:
		var mi := MeshInstance3D.new()
		mi.mesh = TB.make_mountain_ring(r[0], r[1], r[2], 260)
		var m := ShaderMaterial.new()
		m.shader = load("res://shaders/mountain.gdshader")
		m.set_shader_parameter("rock_col", r[3])
		m.set_shader_parameter("snow_line", r[1] * 0.42)
		mi.material_override = m
		mi.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
		mi.name = "Mountains"
		root.add_child(mi)


static func set_detail(detail: float) -> void:
	for mmi in tree_multimeshes:
		if is_instance_valid(mmi):
			mmi.multimesh.visible_instance_count = int(mmi.multimesh.instance_count * clampf(detail, 0.0, 1.0))
