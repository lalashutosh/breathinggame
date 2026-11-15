extends Node
## Breath autoload: the one hidden world rhythm + the player's breath + sync.
## Wave is asymmetric: 40% rise (in-phase), 60% fall (out-phase).
## Pushes shader globals every frame so all shaders share the same clock.

signal peak     ## top of the wave: in turns to out (the "turn chime" landmark)
signal trough   ## bottom of the wave
signal heart_calm(drop: float)  ## heart settled another step below its starting rate (reward only)

const RISE := 0.4

var world_period := 6.0
var world_phase := 0.0
var world_val := 0.0
var rising := true
var wind_theta := 0.0

var source := "sim"          # "sim" | "manual" | "sensor"

# live sensors (fed by main.gd from the ΑΝΑΣΑ sensor bridge)
var sensor_phase := "rest"   # "in" | "out" | "rest" from the microphone
var sensor_level := 0.0
var heart_bpm := 0.0
var heart_rmssd := 0.0
var calm_fx := 0.0           # 1 right after a heart-calm moment, fades over ~6 s
var calm_events := 0
var heart_start := 0.0
var heart_last := 0.0
var _hr_baseline := 0.0
var _hr_buf: Array = []      # [t, bpm] for the first 20 s of play
var _hr_hist: Array = []     # [t, bpm] over the last 10 s
var _hr_best_step := 0
var _hr_last_event := -100.0
var _sensor_prev := "rest"
var _sensor_in_times: Array[float] = []
var held := false
var user_period := 6.0
var user_phase := 0.28
var breath_val := 0.0
var sync := 0.0
var stage := "Mirror"
var _press_times: Array[float] = []
var _t := 0.0

# history for the demo graph (last ~12 s at 20 Hz)
var hist_world: PackedFloat32Array = []
var hist_breath: PackedFloat32Array = []
var _hist_acc := 0.0


static func shape(ph: float) -> float:
	if ph < RISE:
		return 0.5 - 0.5 * cos(PI * ph / RISE)
	return 0.5 + 0.5 * cos(PI * (ph - RISE) / (1.0 - RISE))


func reset_for(period: float) -> void:
	user_period = period
	world_period = period
	user_phase = 0.28
	world_phase = 0.0
	breath_val = 0.0
	sync = 0.0
	_press_times.clear()
	_sensor_in_times.clear()
	_hr_baseline = 0.0
	_hr_buf.clear()
	_hr_hist.clear()
	_hr_best_step = 0
	_hr_last_event = -100.0
	calm_events = 0
	heart_start = 0.0
	calm_fx = 0.0
	hist_world.clear()
	hist_breath.clear()


func set_held(h: bool) -> void:
	if h and not held:
		_press_times.append(_t)
		if _press_times.size() > 8:
			_press_times.pop_front()
	held = h


func _process(dt: float) -> void:
	_t += dt
	var playing: bool = Game.state == "play"
	var target := 7.0
	if playing:
		var per: Array = Game.preset["period"]
		if Game.play_time < 10.0:
			target = user_period
			stage = "Mirror"
		else:
			target = lerpf(per[0], per[1], Game.ease_s(minf(1.0, Game.p * 1.25)))
			stage = "Lead"
	else:
		stage = "Idle"
	world_period += (target - world_period) * minf(1.0, dt * 0.5)

	var prev_phase := world_phase
	world_phase = fmod(world_phase + dt / world_period, 1.0)
	world_val = shape(world_phase)
	var was_rising := rising
	rising = world_phase < RISE
	if was_rising and not rising:
		peak.emit()
	elif world_phase < prev_phase:
		trough.emit()
	# travelling wind band angle
	if world_phase < RISE:
		wind_theta = -PI / 2.0 + PI * world_phase / RISE
	else:
		wind_theta = PI / 2.0 + PI * (world_phase - RISE) / (1.0 - RISE)

	var inst := 0.0
	if source == "sim" or not playing:
		user_period += (world_period - user_period) * dt * 0.16 + (randf() - 0.5) * dt * 0.25
		user_period = clampf(user_period, 2.5, 13.0)
		var d := world_phase - user_phase
		d -= roundf(d)
		var pull := 0.05 + 0.3 * minf(1.0, Game.play_time / 40.0)
		user_phase = fposmod(user_phase + dt / user_period + d * dt * pull, 1.0)
		breath_val = shape(user_phase)
		# phase-based match (timing, not height)
		var pd := absf(world_phase - user_phase)
		pd = minf(pd, 1.0 - pd)
		inst = clampf(1.0 - pd / 0.22, 0.0, 1.0)
	elif source == "sensor":
		# microphone breath: rise while breathing in, settle while breathing out
		if sensor_phase == "in" and _sensor_prev != "in":
			_sensor_in_times.append(_t)
			if _sensor_in_times.size() > 5:
				_sensor_in_times.pop_front()
		_sensor_prev = sensor_phase
		var rate := dt / (RISE * world_period) if sensor_phase == "in" else -dt / ((1.0 - RISE) * world_period) * (1.0 if sensor_phase == "out" else 0.3)
		breath_val = clampf(breath_val + rate, 0.0, 1.0)
		if _sensor_in_times.size() > 2:
			var gaps: Array[float] = []
			for i in range(1, _sensor_in_times.size()):
				gaps.append(_sensor_in_times[i] - _sensor_in_times[i - 1])
			gaps.sort()
			user_period = clampf(gaps[gaps.size() / 2], 2.0, 15.0)
		inst = clampf(1.0 - 2.3 * absf(world_val - breath_val), 0.0, 1.0)
	else:
		breath_val = clampf(breath_val + (dt / (RISE * world_period) if held else -dt / ((1.0 - RISE) * world_period)), 0.0, 1.0)
		if _press_times.size() > 2:
			var n := _press_times.size()
			var k := mini(3, n - 1)
			user_period = clampf((_press_times[n - 1] - _press_times[n - 1 - k]) / k, 2.0, 15.0)
		inst = clampf(1.0 - 2.3 * absf(world_val - breath_val), 0.0, 1.0)
	sync += (inst - sync) * minf(1.0, dt * 0.45)
	if not playing:
		sync = minf(sync, 0.5)

	_hist_acc += dt
	if _hist_acc > 0.05:
		_hist_acc = 0.0
		hist_world.append(world_val)
		hist_breath.append(breath_val)
		if hist_world.size() > 240:
			hist_world.remove_at(0)
			hist_breath.remove_at(0)

	RenderingServer.global_shader_parameter_set("world_val", world_val)
	RenderingServer.global_shader_parameter_set("wind_theta", wind_theta)
	_update_heart(dt, playing)
	RenderingServer.global_shader_parameter_set("sync_amt", minf(1.0, sync + calm_fx * 0.6))


func _update_heart(dt: float, playing: bool) -> void:
	calm_fx = maxf(0.0, calm_fx - dt / 6.0)
	if not playing or heart_bpm <= 0.0:
		return
	heart_last = heart_bpm
	if heart_start <= 0.0:
		heart_start = heart_bpm
	_hr_hist.append([_t, heart_bpm])
	while _hr_hist.size() > 0 and _t - float(_hr_hist[0][0]) > 10.0:
		_hr_hist.pop_front()
	if _hr_baseline <= 0.0:
		_hr_buf.append([_t, heart_bpm])
		if _t - float(_hr_buf[0][0]) >= 20.0:
			var sum := 0.0
			for e in _hr_buf:
				sum += float(e[1])
			_hr_baseline = sum / _hr_buf.size()
		return
	var avg := heart_average()
	var drop := _hr_baseline - avg
	var step := int(floor(drop / 2.0))
	if step >= 1 and step > _hr_best_step and _t - _hr_last_event >= 12.0:
		_hr_best_step = step
		_hr_last_event = _t
		calm_events += 1
		calm_fx = 1.0
		heart_calm.emit(drop)


func heart_average() -> float:
	if _hr_hist.is_empty():
		return heart_bpm
	var sum := 0.0
	for e in _hr_hist:
		sum += float(e[1])
	return sum / _hr_hist.size()


## bpm change against the starting baseline (negative = calmer); NAN while still learning.
func heart_delta() -> float:
	return heart_average() - _hr_baseline if _hr_baseline > 0.0 else NAN
