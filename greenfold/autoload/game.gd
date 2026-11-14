extends Node
## Game / MoodDirector autoload.
## Holds session state and the mood presets. Every preset value is a [start, end]
## pair, interpolated by eased session progress `e` (0..1).

signal started(mode: String)
signal ended
signal sheep_joined(count: int)

const SESSION_SECONDS := 110.0
const NSHEEP := 7

const PRESETS := {
	"quick": {
		"label": "Just walk", "sub": "",
		"sky_top": ["#2b3a67", "#1d2550"], "sky_mid": ["#e8846b", "#c9577a"], "sky_hor": ["#ffd59a", "#ffb37a"],
		"grass_base": ["#4f6a2a", "#3f5a2c"], "grass_tip": ["#e6c56e", "#e0a860"],
		"mountain": ["#6a5a7a", "#3e3560"], "snow": ["#ffe6cc", "#f3b9a0"],
		"sun_y": [0.20, 0.07], "sun_col": ["#fff1c9", "#ffc27a"], "stars": [0.0, 0.35], "clouds": [0.55, 0.40],
		"wind": [0.35, 0.12], "mist": [0.15, 0.10], "rain": [0.0, 0.0], "detail": [0.8, 0.9], "life": [0.6, 0.8],
		"period": [4.6, 10.0], "root": [130.81, 130.81], "scale": ["maj", "maj"],
		"step": "One small thing: open a window and let the real sky in for a minute.",
	},
	"anxious": {
		"label": "Anxious", "sub": "racing, on edge",
		"sky_top": ["#1c2433", "#243056"], "sky_mid": ["#3a4a63", "#b0688a"], "sky_hor": ["#6f8399", "#f6b48a"],
		"grass_base": ["#2c3a30", "#46602c"], "grass_tip": ["#7d8f78", "#e2b066"],
		"mountain": ["#3a4658", "#4a3d66"], "snow": ["#c8d2dc", "#ffd2b4"],
		"sun_y": [0.02, 0.10], "sun_col": ["#b9c6d6", "#ffd9a8"], "stars": [0.0, 0.25], "clouds": [0.95, 0.30],
		"wind": [1.0, 0.12], "mist": [0.30, 0.10], "rain": [0.9, 0.0], "detail": [0.9, 0.85], "life": [0.0, 0.7],
		"period": [3.4, 10.0], "root": [110.0, 130.81], "scale": ["min", "maj"],
		"step": "One small thing: put the kettle on, and stay with it while it warms.",
	},
	"overwhelmed": {
		"label": "Overwhelmed", "sub": "too much at once",
		"sky_top": ["#aab4bf", "#8fb0c2"], "sky_mid": ["#c3cbd2", "#cfe0dc"], "sky_hor": ["#dfe3e6", "#f3ead8"],
		"grass_base": ["#6d7a6a", "#4c6e3a"], "grass_tip": ["#c9d0c4", "#d8d496"],
		"mountain": ["#b3bcc6", "#7f9aa6"], "snow": ["#f0f2f4", "#ffffff"],
		"sun_y": [0.30, 0.26], "sun_col": ["#f4f4f0", "#fff6dc"], "stars": [0.0, 0.0], "clouds": [0.10, 0.30],
		"wind": [0.10, 0.10], "mist": [0.90, 0.30], "rain": [0.0, 0.0], "detail": [0.05, 0.6], "life": [0.0, 0.4],
		"period": [4.0, 10.0], "root": [98.0, 98.0], "scale": ["maj", "maj"],
		"step": "One small thing: pick a single item near you and put it where it belongs.",
	},
	"low": {
		"label": "Low", "sub": "heavy, flat",
		"sky_top": ["#1b2233", "#3f6fb0"], "sky_mid": ["#39435a", "#f7a072"], "sky_hor": ["#5d667a", "#ffe3a3"],
		"grass_base": ["#1f2a2a", "#4f7a2a"], "grass_tip": ["#4a5a58", "#f0d070"],
		"mountain": ["#2a3042", "#7a6a8a"], "snow": ["#8a94aa", "#ffe8c8"],
		"sun_y": [-0.09, 0.20], "sun_col": ["#ffb38a", "#fff3c4"], "stars": [0.5, 0.0], "clouds": [0.50, 0.45],
		"wind": [0.15, 0.25], "mist": [0.50, 0.12], "rain": [0.0, 0.0], "detail": [0.5, 1.0], "life": [0.0, 1.0],
		"period": [4.6, 8.0], "root": [110.0, 130.81], "scale": ["min", "maj"],
		"step": "One small thing: open the curtains, or step outside for two minutes.",
	},
	"restless": {
		"label": "Restless", "sub": "can't switch off",
		"sky_top": ["#0c1230", "#04060f"], "sky_mid": ["#1c2752", "#0a0f24"], "sky_hor": ["#3a4674", "#141a36"],
		"grass_base": ["#101c28", "#0a121c"], "grass_tip": ["#3a5068", "#22324a"],
		"mountain": ["#1a2244", "#080c1c"], "snow": ["#9aa6d0", "#4a5478"],
		"sun_y": [0.34, 0.20], "sun_col": ["#e9ecff", "#c9cfee"], "stars": [0.9, 0.45], "clouds": [0.25, 0.10],
		"wind": [0.25, 0.06], "mist": [0.25, 0.20], "rain": [0.0, 0.0], "detail": [0.7, 0.5], "life": [0.0, 0.0],
		"period": [4.2, 11.0], "root": [87.31, 87.31], "scale": ["maj", "maj"],
		"step": "One small thing: put the phone face down, across the room.",
	},
}

const SCALES := {
	"maj": [1.0, 9.0 / 8.0, 5.0 / 4.0, 3.0 / 2.0, 5.0 / 3.0, 2.0],
	"min": [1.0, 6.0 / 5.0, 4.0 / 3.0, 3.0 / 2.0, 9.0 / 5.0, 2.0],
}

var state := "menu"          # "menu" | "play" | "end"
var mode := "quick"
var preset: Dictionary = PRESETS["quick"]
var p := 0.3                 # raw session progress 0..1
var e := 0.3                 # eased progress
var play_time := 0.0
var sync_time := 0.0
var flock := 0
var start_bpm := 0.0
var end_bpm := 0.0

var player_pos := Vector3(0, 0, 78)
var player_yaw := PI
var sound_on := true
var demo_view := true
var first_run := true


static func ease_s(x: float) -> float:
	return x * x * (3.0 - 2.0 * x)


func fv(key: String) -> float:
	var a: Array = preset[key]
	return lerpf(a[0], a[1], e)


func fc(key: String) -> Color:
	var a: Array = preset[key]
	return Color(a[0]).lerp(Color(a[1]), e)


func root_hz() -> float:
	return preset["root"][0 if p < 0.5 else 1]


func scale_ratios() -> Array:
	return SCALES[preset["scale"][0 if p < 0.5 else 1]]


func start(m: String) -> void:
	mode = m
	preset = PRESETS[m]
	state = "play"
	p = 0.0
	e = 0.0
	play_time = 0.0
	sync_time = 0.0
	flock = 0
	Breath.reset_for(preset["period"][0])
	start_bpm = 60.0 / preset["period"][0]
	started.emit(m)


func finish() -> void:
	if state != "play":
		return
	state = "end"
	end_bpm = 60.0 / Breath.user_period
	first_run = false
	ended.emit()


func to_menu() -> void:
	state = "menu"
	mode = "quick"
	preset = PRESETS["quick"]
	p = 0.3
	e = ease_s(p)


func add_sheep() -> void:
	flock += 1
	sheep_joined.emit(flock)


func _process(dt: float) -> void:
	if state == "play":
		play_time += dt
		p = minf(1.0, p + dt / SESSION_SECONDS * (0.55 + 0.9 * Breath.sync))
		e = ease_s(p)
		if Breath.sync > 0.55:
			sync_time += dt
		if p >= 1.0:
			finish()
