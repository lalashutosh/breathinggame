extends CanvasLayer
class_name GameUI

signal sound_toggled(on: bool)

const INK := Color(1.0, 0.98, 0.94, 1.0)
const INK_DIM := Color(1.0, 0.98, 0.94, 0.64)
const INK_FAINT := Color(1.0, 0.98, 0.94, 0.44)
const NAVY := Color(0.03, 0.05, 0.12, 1.0)
const PANEL := Color(0.03, 0.05, 0.12, 0.55)
const PANEL_BORDER := Color(1.0, 1.0, 1.0, 0.22)
const CREAM := Color(1.0, 0.96, 0.88, 0.95)
const GOLD := Color("#ffd9a0")
const SKY := Color("#8fd3ff")

const MOODS := [
	{
		"id": "anxious",
		"name": "Anxious",
		"sub": "racing, on edge",
		"top": "#3a4a63",
		"bottom": "#b0688a",
	},
	{
		"id": "overwhelmed",
		"name": "Overwhelmed",
		"sub": "too much at once",
		"top": "#c3cbd2",
		"bottom": "#8fb0c2",
	},
	{
		"id": "low",
		"name": "Low",
		"sub": "heavy, flat",
		"top": "#39435a",
		"bottom": "#f7a072",
	},
	{
		"id": "restless",
		"name": "Restless",
		"sub": "can't switch off",
		"top": "#1c2752",
		"bottom": "#04060f",
	},
]


class MoodSwatch:
	extends Control

	var top_color: Color = Color.WHITE
	var bottom_color: Color = Color.BLACK

	func _init() -> void:
		mouse_filter = Control.MOUSE_FILTER_IGNORE

	func _notification(what: int) -> void:
		if what == NOTIFICATION_RESIZED:
			queue_redraw()

	func _draw() -> void:
		var radius := minf(size.x, size.y) * 0.5 - 1.0
		if radius <= 0.0:
			return

		var centre := size * 0.5
		var steps := maxi(16, int(ceil(radius * 2.0)))
		for i in range(steps):
			var t := (float(i) + 0.5) / float(steps)
			var y := centre.y - radius + radius * 2.0 * t
			var dy := (y - centre.y) / radius
			var half_width := radius * sqrt(maxf(0.0, 1.0 - dy * dy))
			var colour := top_color.lerp(bottom_color, t)
			draw_line(
				Vector2(centre.x - half_width, y),
				Vector2(centre.x + half_width, y),
				colour,
				radius * 2.0 / float(steps) + 0.65,
				true
			)

		draw_arc(
			centre,
			radius,
			0.0,
			TAU,
			64,
			Color(1.0, 1.0, 1.0, 0.14),
			1.0,
			true
		)


class BreathGraph:
	extends Control

	var line_width := 1.25

	func _init() -> void:
		mouse_filter = Control.MOUSE_FILTER_IGNORE

	func _draw() -> void:
		if size.x < 4.0 or size.y < 4.0:
			return

		draw_rect(
			Rect2(Vector2.ZERO, size),
			Color(0.01, 0.02, 0.055, 0.22)
		)

		for i in range(1, 4):
			var y := size.y * float(i) / 4.0
			draw_line(
				Vector2(0.0, y),
				Vector2(size.x, y),
				Color(1.0, 1.0, 1.0, 0.055),
				1.0,
				true
			)

		_draw_series(Breath.hist_world, Color(GOLD, 0.92))
		_draw_series(Breath.hist_breath, Color(SKY, 0.92))

	func _draw_series(values: PackedFloat32Array, colour: Color) -> void:
		var count := values.size()
		if count == 0:
			return

		var points := PackedVector2Array()
		var horizontal_step := (size.x - 4.0) / 239.0
		var right_edge := size.x - 2.0

		for i in range(count):
			var x := right_edge - float(count - 1 - i) * horizontal_step
			var value := clampf(values[i], 0.0, 1.0)
			var y := size.y - 3.0 - value * (size.y - 6.0)
			points.append(Vector2(x, y))

		if points.size() == 1:
			draw_circle(points[0], line_width, colour)
		else:
			draw_polyline(points, colour, line_width, true)


var _serif: SystemFont
var _serif_italic: SystemFont
var _sans: SystemFont
var _title_font: FontVariation

var _scale := 1.0
var _root: Control
var _menu: Control
var _hud: Control
var _end_screen: Control
var _hint: Label
var _demo: PanelContainer
var _graph: BreathGraph
var _chips_box: HBoxContainer

var _sound_chip: Button
var _demo_chip: Button
var _sim_button: Button
var _hold_button: Button
var _source_group: ButtonGroup
var _walk_again: Button

var _stage_value: Label
var _sync_value: Label
var _heart_value: Label
var _bpm_value: Label
var _breath_note: Label

var _end_bpm: Label
var _end_flow: Label
var _end_sheep: Label
var _end_step: Label
var _end_fine_print: Label

var _menu_buttons: Array[Button] = []
var _swatches: Array[Control] = []

var _font_specs: Array[Dictionary] = []
var _minimum_specs: Array[Dictionary] = []
var _margin_specs: Array[Dictionary] = []
var _spacing_specs: Array[Dictionary] = []
var _button_specs: Array[Dictionary] = []
var _panel_specs: Array[Dictionary] = []

var _tweens: Dictionary = {}
var _starting := false
var _demo_wanted := false
var _hint_generation := 0
var _end_generation := 0
var _label_clock := 0.0
var _last_breath_source := ""


func _ready() -> void:
	layer = 20
	_scale = maxf(0.55, get_viewport().get_visible_rect().size.y / 720.0)

	_build_fonts()
	_build_root()
	_build_menu()
	_build_hud()
	_build_hint()
	_build_demo()
	_build_end_screen()
	_configure_input_filters(_root)

	get_viewport().size_changed.connect(_on_viewport_size_changed)
	Game.started.connect(_on_game_started)
	Game.ended.connect(_on_game_ended)

	_on_viewport_size_changed()
	_update_hud_text()
	_refresh_breath_source()
	_update_demo_values()

	if Game.state == "play":
		_hide_control(_menu)
		_on_game_started(Game.mode)
	elif Game.state == "end":
		_hide_control(_menu)
		_populate_end_screen()
		_walk_again.disabled = false
		_fade_control(_end_screen, 1.0, 1.0)
	else:
		_menu.visible = true
		_menu.modulate.a = 0.0
		_fade_control(_menu, 1.0, 1.2)


func _build_fonts() -> void:
	_serif = SystemFont.new()
	_serif.font_names = PackedStringArray([
		"Cormorant Garamond",
		"EB Garamond",
		"Noto Serif",
		"DejaVu Serif",
		"serif",
	])

	_serif_italic = SystemFont.new()
	_serif_italic.font_names = _serif.font_names
	_serif_italic.font_italic = true

	_sans = SystemFont.new()
	_sans.font_names = PackedStringArray([
		"Inter",
		"Noto Sans",
		"DejaVu Sans",
		"sans-serif",
	])

	_title_font = FontVariation.new()
	_title_font.base_font = _serif
	_title_font.spacing_glyph = 2


func _build_root() -> void:
	_root = Control.new()
	_root.name = "UIRoot"
	add_child(_root)
	_full_rect(_root)


func _build_menu() -> void:
	_menu = _new_screen("Menu")
	_add_vignette(_menu)

	var centre := CenterContainer.new()
	_menu.add_child(centre)
	_full_rect(centre)

	var column := VBoxContainer.new()
	column.alignment = BoxContainer.ALIGNMENT_CENTER
	column.add_theme_constant_override("separation", 0)
	centre.add_child(column)

	var title := _make_label("ΑΝΑΣΑ", _title_font, 86.0, INK)
	title.size_flags_horizontal = Control.SIZE_SHRINK_CENTER
	column.add_child(title)

	_gap(column, 5.0)

	var subtitle := _make_label(
		"a quiet valley, a few stray sheep",
		_serif_italic,
		23.0,
		INK_DIM
	)
	subtitle.size_flags_horizontal = Control.SIZE_SHRINK_CENTER
	column.add_child(subtitle)

	_gap(column, 28.0)

	var just_walk := _make_button(
		"Just walk",
		"primary",
		16.0,
		Vector2(190.0, 52.0)
	)
	just_walk.size_flags_horizontal = Control.SIZE_SHRINK_CENTER
	just_walk.pressed.connect(_start_mode.bind("quick"))
	column.add_child(just_walk)
	_menu_buttons.append(just_walk)

	_gap(column, 27.0)

	var arriving := _make_label(
		"OR TELL IT HOW YOU'RE ARRIVING",
		_sans,
		10.5,
		INK_FAINT
	)
	arriving.size_flags_horizontal = Control.SIZE_SHRINK_CENTER
	column.add_child(arriving)

	_gap(column, 13.0)

	var grid := GridContainer.new()
	grid.columns = 2
	grid.size_flags_horizontal = Control.SIZE_SHRINK_CENTER
	_track_spacing(grid, 12.0)
	column.add_child(grid)

	for mood in MOODS:
		var button := _make_button(
			"",
			"mood",
			14.0,
			Vector2(252.0, 76.0)
		)
		var mode_id: String = mood["id"]
		button.pressed.connect(_start_mode.bind(mode_id))
		grid.add_child(button)
		_menu_buttons.append(button)

		var margin := MarginContainer.new()
		button.add_child(margin)
		_full_rect(margin)
		_track_margins(margin, 14.0, 10.0, 14.0, 10.0)

		var row := HBoxContainer.new()
		_track_spacing(row, 12.0)
		margin.add_child(row)

		var swatch := MoodSwatch.new()
		swatch.top_color = Color(mood["top"])
		swatch.bottom_color = Color(mood["bottom"])
		swatch.size_flags_vertical = Control.SIZE_SHRINK_CENTER
		_track_minimum(swatch, Vector2(35.0, 35.0))
		row.add_child(swatch)
		_swatches.append(swatch)

		var words := VBoxContainer.new()
		words.alignment = BoxContainer.ALIGNMENT_CENTER
		words.size_flags_horizontal = Control.SIZE_EXPAND_FILL
		words.add_theme_constant_override("separation", 1)
		row.add_child(words)

		var name_label := _make_label(mood["name"], _serif, 21.0, INK)
		words.add_child(name_label)

		var sub_label := _make_label(mood["sub"], _sans, 11.0, INK_DIM)
		words.add_child(sub_label)


func _build_hud() -> void:
	_hud = _new_screen("HUD")
	_hud.visible = false
	_hud.modulate.a = 0.0

	_chips_box = HBoxContainer.new()
	_chips_box.alignment = BoxContainer.ALIGNMENT_END
	_chips_box.anchor_left = 1.0
	_chips_box.anchor_right = 1.0
	_chips_box.anchor_top = 0.0
	_chips_box.anchor_bottom = 0.0
	_track_spacing(_chips_box, 8.0)
	_hud.add_child(_chips_box)

	_sound_chip = _make_button(
		"Sound on",
		"chip",
		11.5,
		Vector2(0.0, 36.0)
	)
	_sound_chip.pressed.connect(_on_sound_pressed)
	_chips_box.add_child(_sound_chip)

	_demo_chip = _make_button(
		"Hide demo view",
		"chip",
		11.5,
		Vector2(0.0, 36.0)
	)
	_demo_chip.pressed.connect(_on_demo_chip_pressed)
	_chips_box.add_child(_demo_chip)

	var finish_chip := _make_button(
		"Finish",
		"chip",
		11.5,
		Vector2(0.0, 36.0)
	)
	finish_chip.pressed.connect(Game.finish)
	_chips_box.add_child(finish_chip)


func _build_hint() -> void:
	_hint = Label.new()
	_hint.name = "Hint"
	_hint.anchor_left = 0.5
	_hint.anchor_right = 0.5
	_hint.anchor_top = 1.0
	_hint.anchor_bottom = 1.0
	_hint.grow_horizontal = Control.GROW_DIRECTION_BOTH
	_hint.grow_vertical = Control.GROW_DIRECTION_BEGIN
	_hint.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	_hint.vertical_alignment = VERTICAL_ALIGNMENT_CENTER
	_hint.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
	_hint.text = "Hold to walk · point to turn · find the stray sheep"
	_track_font(_hint, _serif_italic, 19.0)
	_hint.add_theme_color_override("font_color", Color(INK, 0.82))
	_hint.visible = false
	_hint.modulate.a = 0.0
	_root.add_child(_hint)


func _build_demo() -> void:
	_demo = PanelContainer.new()
	_demo.name = "DemoPanel"
	_demo.anchor_left = 0.0
	_demo.anchor_right = 0.0
	_demo.anchor_top = 1.0
	_demo.anchor_bottom = 1.0
	_demo.grow_vertical = Control.GROW_DIRECTION_BEGIN
	_demo.visible = false
	_demo.modulate.a = 0.0
	_track_panel(_demo, 22.0, 14.0)
	_root.add_child(_demo)

	var column := VBoxContainer.new()
	_track_spacing(column, 7.0)
	_demo.add_child(column)

	var title_row := HBoxContainer.new()
	_track_spacing(title_row, 8.0)
	column.add_child(title_row)

	var title := _make_label("Demo view", _sans, 14.0, INK)
	title_row.add_child(title)

	var qualifier := _make_label(
		"(the player never sees this)",
		_sans,
		9.5,
		INK_FAINT
	)
	qualifier.size_flags_vertical = Control.SIZE_SHRINK_CENTER
	title_row.add_child(qualifier)

	_graph = BreathGraph.new()
	_track_minimum(_graph, Vector2(260.0, 60.0))
	column.add_child(_graph)

	var legend := HBoxContainer.new()
	_track_spacing(legend, 16.0)
	column.add_child(legend)

	var world_legend := _make_label("—  valley rhythm", _sans, 9.5, GOLD)
	legend.add_child(world_legend)
	var breath_legend := _make_label("—  your breath", _sans, 9.5, SKY)
	legend.add_child(breath_legend)

	_stage_value = _add_demo_row(column, "Stage")
	_sync_value = _add_demo_row(column, "In sync")
	_bpm_value = _add_demo_row(column, "Breaths / min")
	_heart_value = _add_demo_row(column, "Heart")

	var source_row := HBoxContainer.new()
	_track_spacing(source_row, 8.0)
	column.add_child(source_row)

	_source_group = ButtonGroup.new()

	_sim_button = _make_button(
		"Simulated breath",
		"toggle",
		10.0,
		Vector2(0.0, 32.0)
	)
	_sim_button.toggle_mode = true
	_sim_button.button_group = _source_group
	_sim_button.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	_sim_button.pressed.connect(_set_breath_source.bind("sim"))
	source_row.add_child(_sim_button)

	_hold_button = _make_button(
		"Hold Space",
		"toggle",
		10.0,
		Vector2(0.0, 32.0)
	)
	_hold_button.toggle_mode = true
	_hold_button.button_group = _source_group
	_hold_button.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	_hold_button.pressed.connect(_set_breath_source.bind("manual"))
	source_row.add_child(_hold_button)

	_breath_note = _make_label("", _sans, 9.5, INK_FAINT)
	_breath_note.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
	_track_minimum(_breath_note, Vector2(286.0, 0.0))
	column.add_child(_breath_note)


func _build_end_screen() -> void:
	_end_screen = _new_screen("EndScreen")
	_end_screen.visible = false
	_end_screen.modulate.a = 0.0
	_add_vignette(_end_screen)

	var centre := CenterContainer.new()
	_end_screen.add_child(centre)
	_full_rect(centre)

	var panel := PanelContainer.new()
	_track_minimum(panel, Vector2(780.0, 0.0))
	_track_panel(panel, 30.0, 30.0)
	centre.add_child(panel)

	var column := VBoxContainer.new()
	column.alignment = BoxContainer.ALIGNMENT_CENTER
	column.add_theme_constant_override("separation", 0)
	panel.add_child(column)

	var heading := _make_label("Home for now.", _serif, 53.0, INK)
	heading.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	heading.size_flags_horizontal = Control.SIZE_SHRINK_CENTER
	column.add_child(heading)

	_gap(column, 4.0)

	var subtitle := _make_label(
		"The valley settled as you walked.",
		_serif_italic,
		21.0,
		INK_DIM
	)
	subtitle.size_flags_horizontal = Control.SIZE_SHRINK_CENTER
	column.add_child(subtitle)

	_gap(column, 25.0)

	var stats := HBoxContainer.new()
	stats.alignment = BoxContainer.ALIGNMENT_CENTER
	stats.size_flags_horizontal = Control.SIZE_SHRINK_CENTER
	_track_spacing(stats, 30.0)
	column.add_child(stats)

	_end_bpm = _add_end_stat(stats, "BREATHS / MIN")
	_end_flow = _add_end_stat(stats, "TIME IN FLOW")
	_end_sheep = _add_end_stat(stats, "SHEEP FOUND")

	_gap(column, 25.0)

	_end_step = _make_label("", _serif_italic, 20.0, Color(INK, 0.82))
	_end_step.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	_end_step.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
	_end_step.size_flags_horizontal = Control.SIZE_SHRINK_CENTER
	_track_minimum(_end_step, Vector2(640.0, 0.0))
	column.add_child(_end_step)

	_gap(column, 24.0)

	_walk_again = _make_button(
		"Back to the garden" if "--hub" in OS.get_cmdline_user_args() else "Walk again",
		"primary",
		15.0,
		Vector2(220.0, 50.0)
	)
	_walk_again.size_flags_horizontal = Control.SIZE_SHRINK_CENTER
	_walk_again.pressed.connect(_return_to_menu)
	column.add_child(_walk_again)

	_gap(column, 18.0)

	_end_fine_print = _make_label("", _sans, 10.0, INK_FAINT)
	_end_fine_print.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	_end_fine_print.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
	_end_fine_print.size_flags_horizontal = Control.SIZE_SHRINK_CENTER
	_track_minimum(_end_fine_print, Vector2(620.0, 0.0))
	column.add_child(_end_fine_print)


func _new_screen(screen_name: String) -> Control:
	var screen := Control.new()
	screen.name = screen_name
	_root.add_child(screen)
	_full_rect(screen)
	return screen


func _add_vignette(parent: Control) -> void:
	var backdrop := ColorRect.new()
	backdrop.color = Color.WHITE
	parent.add_child(backdrop)
	_full_rect(backdrop)

	var shader := Shader.new()
	shader.code = """
shader_type canvas_item;

void fragment() {
	vec2 q = (UV - vec2(0.5)) * 2.0;
	q.x *= 0.86;
	float edge = smoothstep(0.16, 1.15, length(q));
	COLOR = vec4(vec3(0.03, 0.05, 0.12), 0.6 * edge);
}
"""

	var material := ShaderMaterial.new()
	material.shader = shader
	backdrop.material = material


func _make_label(
	text: String,
	font: Font,
	font_size: float,
	colour: Color
) -> Label:
	var label := Label.new()
	label.text = text
	label.add_theme_color_override("font_color", colour)
	_track_font(label, font, font_size)
	return label


func _make_button(
	text: String,
	kind: String,
	font_size: float,
	minimum: Vector2
) -> Button:
	var button := Button.new()
	button.text = text
	button.focus_mode = Control.FOCUS_NONE
	button.mouse_default_cursor_shape = Control.CURSOR_POINTING_HAND
	_track_font(button, _sans, font_size)
	if minimum != Vector2.ZERO:
		_track_minimum(button, minimum)

	_button_specs.append({"button": button, "kind": kind})
	_apply_button_style(button, kind)
	return button


func _apply_button_style(button: Button, kind: String) -> void:
	var background: Color
	var border: Color
	var hover_background: Color
	var pressed_background: Color
	var radius: float
	var horizontal_padding: float

	match kind:
		"primary":
			background = CREAM
			border = Color(1.0, 1.0, 1.0, 0.10)
			hover_background = CREAM.lightened(0.055)
			pressed_background = CREAM.darkened(0.045)
			radius = 28.0
			horizontal_padding = 26.0
		"mood":
			background = PANEL
			border = PANEL_BORDER
			hover_background = Color(0.065, 0.085, 0.16, 0.66)
			pressed_background = Color(0.08, 0.10, 0.18, 0.72)
			radius = 20.0
			horizontal_padding = 0.0
		"toggle":
			background = Color(0.03, 0.05, 0.12, 0.30)
			border = Color(1.0, 1.0, 1.0, 0.14)
			hover_background = Color(0.08, 0.105, 0.18, 0.48)
			pressed_background = Color(0.13, 0.17, 0.24, 0.68)
			radius = 15.0
			horizontal_padding = 10.0
		_:
			background = Color(0.03, 0.05, 0.12, 0.34)
			border = Color(1.0, 1.0, 1.0, 0.16)
			hover_background = Color(0.07, 0.09, 0.16, 0.48)
			pressed_background = Color(0.09, 0.115, 0.19, 0.56)
			radius = 18.0
			horizontal_padding = 13.0

	var normal := _make_stylebox(
		background,
		border,
		radius,
		horizontal_padding,
		0.0
	)
	var hover := _make_stylebox(
		hover_background,
		Color(border, minf(0.4, border.a + 0.10)),
		radius,
		horizontal_padding,
		0.0
	)
	var pressed := _make_stylebox(
		pressed_background,
		border,
		radius,
		horizontal_padding,
		0.0
	)
	var disabled := _make_stylebox(
		Color(background, background.a * 0.55),
		Color(border, border.a * 0.45),
		radius,
		horizontal_padding,
		0.0
	)

	button.add_theme_stylebox_override("normal", normal)
	button.add_theme_stylebox_override("hover", hover)
	button.add_theme_stylebox_override("pressed", pressed)
	button.add_theme_stylebox_override("disabled", disabled)

	if kind == "primary":
		button.add_theme_color_override("font_color", NAVY)
		button.add_theme_color_override("font_hover_color", NAVY)
		button.add_theme_color_override("font_pressed_color", NAVY)
		button.add_theme_color_override(
			"font_disabled_color",
			Color(NAVY, 0.45)
		)
	else:
		button.add_theme_color_override("font_color", Color(INK, 0.84))
		button.add_theme_color_override("font_hover_color", INK)
		button.add_theme_color_override("font_pressed_color", INK)
		button.add_theme_color_override(
			"font_disabled_color",
			Color(INK, 0.34)
		)


func _make_stylebox(
	background: Color,
	border: Color,
	radius: float,
	padding_x: float,
	padding_y: float
) -> StyleBoxFlat:
	var box := StyleBoxFlat.new()
	box.bg_color = background
	box.border_color = border
	box.set_border_width_all(1)
	box.set_corner_radius_all(maxi(0, roundi(radius * _scale)))
	box.content_margin_left = padding_x * _scale
	box.content_margin_right = padding_x * _scale
	box.content_margin_top = padding_y * _scale
	box.content_margin_bottom = padding_y * _scale
	return box


func _track_panel(
	panel: PanelContainer,
	radius: float,
	padding: float
) -> void:
	_panel_specs.append({
		"panel": panel,
		"radius": radius,
		"padding": padding,
	})
	_apply_panel_style(panel, radius, padding)


func _apply_panel_style(
	panel: PanelContainer,
	radius: float,
	padding: float
) -> void:
	panel.add_theme_stylebox_override(
		"panel",
		_make_stylebox(PANEL, PANEL_BORDER, radius, padding, padding)
	)


func _track_font(control: Control, font: Font, base_size: float) -> void:
	control.add_theme_font_override("font", font)
	control.add_theme_font_size_override(
		"font_size",
		maxi(1, roundi(base_size * _scale))
	)
	_font_specs.append({"control": control, "size": base_size})


func _track_minimum(control: Control, base_size: Vector2) -> void:
	control.custom_minimum_size = base_size * _scale
	_minimum_specs.append({"control": control, "size": base_size})


func _track_margins(
	margin: MarginContainer,
	left: float,
	top: float,
	right: float,
	bottom: float
) -> void:
	_margin_specs.append({
		"margin": margin,
		"left": left,
		"top": top,
		"right": right,
		"bottom": bottom,
	})
	_apply_margins(margin, left, top, right, bottom)


func _apply_margins(
	margin: MarginContainer,
	left: float,
	top: float,
	right: float,
	bottom: float
) -> void:
	margin.add_theme_constant_override("margin_left", roundi(left * _scale))
	margin.add_theme_constant_override("margin_top", roundi(top * _scale))
	margin.add_theme_constant_override("margin_right", roundi(right * _scale))
	margin.add_theme_constant_override("margin_bottom", roundi(bottom * _scale))


func _track_spacing(control: Control, base_spacing: float) -> void:
	_spacing_specs.append({"control": control, "spacing": base_spacing})
	_apply_spacing(control, base_spacing)


func _apply_spacing(control: Control, base_spacing: float) -> void:
	var pixels := roundi(base_spacing * _scale)
	if control is GridContainer:
		var grid := control as GridContainer
		grid.add_theme_constant_override("h_separation", pixels)
		grid.add_theme_constant_override("v_separation", pixels)
	elif control is BoxContainer:
		control.add_theme_constant_override("separation", pixels)


func _gap(parent: Container, height: float) -> void:
	var gap := Control.new()
	_track_minimum(gap, Vector2(0.0, height))
	parent.add_child(gap)


func _add_demo_row(parent: Container, caption: String) -> Label:
	var row := HBoxContainer.new()
	_track_spacing(row, 12.0)
	parent.add_child(row)

	var caption_label := _make_label(caption, _sans, 10.5, INK_DIM)
	caption_label.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	row.add_child(caption_label)

	var value := _make_label("—", _sans, 10.5, INK)
	value.horizontal_alignment = HORIZONTAL_ALIGNMENT_RIGHT
	_track_minimum(value, Vector2(64.0, 0.0))
	row.add_child(value)
	return value


func _add_end_stat(parent: HBoxContainer, caption: String) -> Label:
	var column := VBoxContainer.new()
	column.alignment = BoxContainer.ALIGNMENT_CENTER
	column.add_theme_constant_override("separation", 2)
	_track_minimum(column, Vector2(196.0, 0.0))
	parent.add_child(column)

	var value := _make_label("—", _serif, 38.0, INK)
	value.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	column.add_child(value)

	var caption_label := _make_label(caption, _sans, 9.5, INK_FAINT)
	caption_label.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	column.add_child(caption_label)
	return value


func _full_rect(control: Control) -> void:
	control.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)


func _configure_input_filters(node: Node) -> void:
	if node is Control:
		var control := node as Control
		if control is Button:
			control.focus_mode = Control.FOCUS_NONE
			control.mouse_filter = Control.MOUSE_FILTER_STOP
		else:
			control.mouse_filter = Control.MOUSE_FILTER_IGNORE

	for child in node.get_children():
		_configure_input_filters(child)


func _on_viewport_size_changed() -> void:
	var viewport_size := get_viewport().get_visible_rect().size
	_scale = maxf(0.55, viewport_size.y / 720.0)
	_title_font.spacing_glyph = maxi(0, roundi(2.0 * _scale))

	for spec in _font_specs:
		var control: Control = spec["control"]
		if is_instance_valid(control):
			var base_size: float = spec["size"]
			control.add_theme_font_size_override(
				"font_size",
				maxi(1, roundi(base_size * _scale))
			)

	for spec in _minimum_specs:
		var control: Control = spec["control"]
		if is_instance_valid(control):
			var base_size: Vector2 = spec["size"]
			control.custom_minimum_size = base_size * _scale

	for spec in _margin_specs:
		var margin: MarginContainer = spec["margin"]
		if is_instance_valid(margin):
			_apply_margins(
				margin,
				spec["left"],
				spec["top"],
				spec["right"],
				spec["bottom"]
			)

	for spec in _spacing_specs:
		var control: Control = spec["control"]
		if is_instance_valid(control):
			_apply_spacing(control, spec["spacing"])

	for spec in _button_specs:
		var button: Button = spec["button"]
		if is_instance_valid(button):
			_apply_button_style(button, spec["kind"])

	for spec in _panel_specs:
		var panel: PanelContainer = spec["panel"]
		if is_instance_valid(panel):
			_apply_panel_style(panel, spec["radius"], spec["padding"])

	_chips_box.offset_left = -620.0 * _scale
	_chips_box.offset_right = -20.0 * _scale
	_chips_box.offset_top = 20.0 * _scale
	_chips_box.offset_bottom = 62.0 * _scale

	_demo.offset_left = 20.0 * _scale
	_demo.offset_right = 330.0 * _scale
	_demo.offset_top = -268.0 * _scale
	_demo.offset_bottom = -20.0 * _scale

	var hint_width := minf(
		900.0 * _scale,
		maxf(280.0, viewport_size.x - 40.0 * _scale)
	)
	_hint.offset_left = -hint_width * 0.5
	_hint.offset_right = hint_width * 0.5
	_hint.offset_top = -94.0 * _scale
	_hint.offset_bottom = -48.0 * _scale

	_graph.line_width = maxf(1.0, 1.25 * _scale)
	if _graph.is_visible_in_tree():
		_graph.queue_redraw()
	for swatch in _swatches:
		swatch.queue_redraw()


func _start_mode(mode: String) -> void:
	if _starting or Game.state != "menu":
		return

	_starting = true
	_set_menu_buttons_disabled(true)
	_fade_control(_menu, 0.0, 0.9, true)
	await get_tree().create_timer(0.9).timeout

	if not is_inside_tree():
		return

	Game.start(mode)
	_starting = false
	_set_menu_buttons_disabled(false)


func _set_menu_buttons_disabled(disabled: bool) -> void:
	for button in _menu_buttons:
		button.disabled = disabled


func _on_game_started(_mode: String) -> void:
	_end_generation += 1

	if _end_screen.visible:
		_fade_control(_end_screen, 0.0, 0.8, true)
	if _menu.visible:
		_fade_control(_menu, 0.0, 0.9, true)

	_update_hud_text()
	_update_demo_values()
	_refresh_breath_source()
	_fade_control(_hud, 1.0, 1.0)
	_sync_demo_visibility()
	_begin_hint_sequence()


func _on_game_ended() -> void:
	_hint_generation += 1
	_end_generation += 1
	var generation := _end_generation

	if _hint.visible:
		_fade_control(_hint, 0.0, 0.8, true)
	if _hud.visible:
		_fade_control(_hud, 0.0, 0.8, true)

	_sync_demo_visibility()
	_walk_again.disabled = true

	await get_tree().create_timer(0.6).timeout
	if generation != _end_generation or Game.state != "end":
		return

	_populate_end_screen()
	_walk_again.disabled = false
	_fade_control(_end_screen, 1.0, 1.1)


func _return_to_menu() -> void:
	_end_generation += 1
	_hint_generation += 1
	_starting = false
	_walk_again.disabled = true

	Game.to_menu()

	if _end_screen.visible:
		_fade_control(_end_screen, 0.0, 0.9, true)
	if _hud.visible:
		_fade_control(_hud, 0.0, 0.8, true)
	if _hint.visible:
		_fade_control(_hint, 0.0, 0.8, true)

	_sync_demo_visibility()
	_set_menu_buttons_disabled(false)
	_fade_control(_menu, 1.0, 1.0)


func _populate_end_screen() -> void:
	_end_bpm.text = "%d → %d" % [
		roundi(Game.start_bpm),
		roundi(Game.end_bpm),
	]

	var flow_percent := 100.0 * Game.sync_time / maxf(Game.play_time, 1.0)
	_end_flow.text = "%d%%" % roundi(flow_percent)
	_end_sheep.text = "%d / %d" % [Game.flock, Game.NSHEEP]
	_end_step.text = str(Game.preset["step"])

	if Breath.source == "sensor":
		_end_fine_print.text = "Breathing measured through the microphone." + (
			" Your heart settled %d times." % Breath.calm_events if Breath.calm_events > 1
			else (" Your heart settled." if Breath.calm_events == 1 else ""))
	elif Breath.source == "manual":
		_end_fine_print.text = (
			"Prototype: breathing figures are estimated from your key presses."
		)
	else:
		_end_fine_print.text = (
			"Prototype: breathing figures come from a simulated breather, not a sensor."
		)


## Heart-calm moment: a short warm line, then it fades (reward only).
func show_calm() -> void:
	if Game.state != "play":
		return
	_hint_generation += 1
	var generation := _hint_generation
	_hint.text = "Your heart is settling."
	_hint.modulate.a = 0.0
	_hint.visible = true
	_fade_control(_hint, 1.0, 0.8)
	await get_tree().create_timer(4.5).timeout
	if generation == _hint_generation:
		_fade_control(_hint, 0.0, 1.2, true)


func _begin_hint_sequence() -> void:
	_hint_generation += 1
	var generation := _hint_generation
	var show_second := Game.first_run

	_hint.text = "Hold to walk · point to turn · find the stray sheep"
	_hint.modulate.a = 0.0
	_hint.visible = true
	_fade_control(_hint, 1.0, 1.0)

	await get_tree().create_timer(9.0).timeout
	if generation != _hint_generation or Game.state != "play":
		return

	_fade_control(_hint, 0.0, 1.0, true)
	if not show_second:
		return

	await get_tree().create_timer(1.05).timeout
	if generation != _hint_generation or Game.state != "play":
		return

	_hint.text = "The valley breathes. Rise with it, settle with it."
	_hint.modulate.a = 0.0
	_hint.visible = true
	_fade_control(_hint, 1.0, 1.0)

	await get_tree().create_timer(7.0).timeout
	if generation != _hint_generation or Game.state != "play":
		return

	_fade_control(_hint, 0.0, 1.1, true)


func _on_sound_pressed() -> void:
	Game.sound_on = not Game.sound_on
	_update_hud_text()
	sound_toggled.emit(Game.sound_on)


func _on_demo_chip_pressed() -> void:
	Game.demo_view = not Game.demo_view
	_update_hud_text()
	_sync_demo_visibility()


func _update_hud_text() -> void:
	if not is_instance_valid(_sound_chip):
		return
	_sound_chip.text = "Sound on" if Game.sound_on else "Sound off"
	_demo_chip.text = "Hide demo view" if Game.demo_view else "Show demo view"


func _sync_demo_visibility() -> void:
	var should_show: bool = Game.state == "play" and Game.demo_view
	if should_show == _demo_wanted:
		return

	_demo_wanted = should_show
	if should_show:
		_update_demo_values()
		_fade_control(_demo, 1.0, 0.8)
	elif _demo.visible:
		_fade_control(_demo, 0.0, 0.8, true)


func _set_breath_source(source: String) -> void:
	Breath.source = source
	_refresh_breath_source()


func _refresh_breath_source() -> void:
	if not is_instance_valid(_sim_button):
		return

	var manual: bool = Breath.source == "manual"
	var sensor: bool = Breath.source == "sensor"
	_sim_button.set_pressed_no_signal(not manual and not sensor)
	_hold_button.set_pressed_no_signal(manual)

	if sensor:
		_breath_note.text = "Breathing from the microphone (ΑΝΑΣΑ sensor bridge)."
	elif manual:
		_breath_note.text = (
			"Hold Space as you breathe in, release as you breathe out."
		)
	else:
		_breath_note.text = (
			"Breath is simulated here. A sensor replaces it later."
		)

	_last_breath_source = Breath.source


func _update_demo_values() -> void:
	if not is_instance_valid(_stage_value):
		return

	_stage_value.text = str(Breath.stage)
	_sync_value.text = "%d%%" % roundi(Breath.sync * 100.0)
	_bpm_value.text = str(roundi(60.0 / maxf(Breath.user_period, 0.001)))
	if is_instance_valid(_heart_value):
		if Breath.heart_bpm > 0.0:
			var dl := Breath.heart_delta()
			_heart_value.text = "%d bpm%s" % [roundi(Breath.heart_bpm), "" if is_nan(dl) else " (%+d)" % roundi(dl)]
		else:
			_heart_value.text = "–"


func _process(delta: float) -> void:
	if (
		is_instance_valid(_graph)
		and _graph.is_visible_in_tree()
		and Game.state == "play"
		and Game.demo_view
	):
		_graph.queue_redraw()

	_label_clock += delta
	if _label_clock < 0.1:
		return
	_label_clock = 0.0

	if Breath.source != _last_breath_source:
		_refresh_breath_source()

	if Game.state != "play":
		return

	_update_hud_text()
	_sync_demo_visibility()
	if _demo.visible:
		_update_demo_values()


func _unhandled_input(event: InputEvent) -> void:
	if not event is InputEventKey:
		return

	var key_event := event as InputEventKey
	if not key_event.pressed or key_event.echo:
		return

	if key_event.keycode == KEY_H:
		Game.demo_view = not Game.demo_view
		_update_hud_text()
		_sync_demo_visibility()
		get_viewport().set_input_as_handled()
	elif key_event.keycode == KEY_ESCAPE and Game.state == "play":
		Game.finish()
		get_viewport().set_input_as_handled()


func _fade_control(
	control: Control,
	target_alpha: float,
	duration: float = 1.0,
	hide_after: bool = false
) -> void:
	if _tweens.has(control):
		var old_tween: Tween = _tweens[control]
		if old_tween.is_valid():
			old_tween.kill()
		_tweens.erase(control)

	if target_alpha <= 0.0 and not control.visible:
		control.modulate.a = 0.0
		return

	if target_alpha > 0.0 and not control.visible:
		control.modulate.a = 0.0
		control.visible = true

	var tween := create_tween()
	_tweens[control] = tween
	tween.set_trans(Tween.TRANS_SINE)
	tween.set_ease(Tween.EASE_IN_OUT)
	tween.tween_property(control, "modulate:a", target_alpha, duration)
	tween.tween_callback(
		_on_fade_complete.bind(control, tween, hide_after)
	)


func _on_fade_complete(
	control: Control,
	tween: Tween,
	hide_after: bool
) -> void:
	if not is_instance_valid(control):
		return
	if _tweens.get(control) != tween:
		return

	if hide_after and control.modulate.a <= 0.001:
		control.visible = false
	_tweens.erase(control)


func _hide_control(control: Control) -> void:
	if _tweens.has(control):
		var tween: Tween = _tweens[control]
		if tween.is_valid():
			tween.kill()
		_tweens.erase(control)
	control.modulate.a = 0.0
	control.visible = false
