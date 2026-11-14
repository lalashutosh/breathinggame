extends Node
class_name AudioEngine
## Fully procedural, breath-linked soundscape. All PCM is rendered once at startup;
## runtime work is limited to player pitches, smoothed gains, and sparse note events.

const SAMPLE_RATE: int = 22050
const PAD_BASE_HZ: float = 220.0
const BELL_BASE_HZ: float = 440.0
const SILENCE_DB: float = -80.0
const POOL_SIZE: int = 10

const MUSIC_BUS := "Music"
const NATURE_BUS := "Nature"
const SHOT_BELL: int = 0
const SHOT_BIRD: int = 1

const DRONE_RATIOS := [1.0, 1.5, 2.0]
const DRONE_TRIM_DB := [0.0, -3.0, -6.0]
const HARMONY_SCALE_INDICES := [2, 3, 5]
const HARMONY_THRESHOLDS := [0.3, 0.5, 0.7]
const HARMONY_DB := [-27.0, -28.0, -29.0]

var _rng: RandomNumberGenerator = RandomNumberGenerator.new()

var _noise_stream: AudioStreamWAV
var _rain_stream: AudioStreamWAV
var _bell_stream: AudioStreamWAV
var _pad_stream: AudioStreamWAV
var _bird_stream: AudioStreamWAV

var _music_lpf: AudioEffectLowPassFilter
var _nature_lpf: AudioEffectLowPassFilter
var _music_cutoff: float = 400.0
var _nature_cutoff: float = 1200.0

var _drone: Array[AudioStreamPlayer] = []
var _harmony: Array[AudioStreamPlayer] = []
var _whoosh: AudioStreamPlayer
var _out_pad: AudioStreamPlayer
var _water: AudioStreamPlayer
var _rain: AudioStreamPlayer

var _pool: Array[AudioStreamPlayer] = []
var _shot_base_db: Array[float] = []
var _pool_index: int = 0
var _pending: Array[Dictionary] = []

var _root_hz: float = 110.0
var _session_fade: float = 0.0
var _bird_timer: float = 5.0

var _master_db: float = SILENCE_DB
var _master_from_db: float = SILENCE_DB
var _master_target_db: float = SILENCE_DB
var _master_fade_t: float = 1.0


func _ready() -> void:
	_rng.randomize()
	_setup_buses()

	_noise_stream = _make_noise_loop(4.0, false)
	_rain_stream = _make_noise_loop(3.0, true)
	_bell_stream = _make_bell()
	_pad_stream = _make_pad()
	_bird_stream = _make_chirp()

	_root_hz = float(Game.root_hz())
	_build_players()

	_master_db = 0.0 if Game.sound_on else SILENCE_DB
	_master_from_db = _master_db
	_master_target_db = _master_db
	AudioServer.set_bus_volume_db(0, _master_db)

	Breath.peak.connect(_on_breath_peak)
	Game.sheep_joined.connect(_on_sheep_joined)
	Game.started.connect(_on_game_started)
	_bird_timer = _rng.randf_range(3.0, 9.0)


func _process(dt: float) -> void:
	_update_master_fade(dt)
	_session_fade = move_toward(_session_fade, 1.0, dt * 0.5)

	_update_pending(dt)
	_update_birds(dt)

	var world_val: float = clampf(Breath.world_val, 0.0, 1.0)
	var sync: float = clampf(Breath.sync, 0.0, 1.0)
	var rain_amount: float = clampf(Game.fv("rain"), 0.0, 1.0)
	var wind_amount: float = clampf(Game.fv("wind"), 0.0, 1.0)
	var duck: float = _current_duck()

	_root_hz = lerpf(
		_root_hz,
		float(Game.root_hz()),
		1.0 - exp(-dt * 1.8)
	)

	# The pads open very gently with the world breath and with breath synchrony.
	var drone_db: float = lerpf(-30.0, -18.0, world_val)
	for i in range(_drone.size()):
		var target_pitch: float = (
			_root_hz * float(DRONE_RATIOS[i]) / PAD_BASE_HZ
		)
		_smooth_pitch(_drone[i], target_pitch, dt, 1.8)
		_set_layer_db(
			_drone[i],
			drone_db + float(DRONE_TRIM_DB[i]),
			dt,
			duck,
			2.8
		)

	var music_target: float = 400.0 + sync * 1300.0 + world_val * 400.0
	_music_cutoff = lerpf(
		_music_cutoff, music_target, 1.0 - exp(-dt * 2.5)
	)
	if _music_lpf != null:
		_music_lpf.cutoff_hz = _music_cutoff

	var nature_target: float = (
		1000.0
		+ world_val * 1200.0
		+ wind_amount * 500.0
		+ rain_amount * 1800.0
	)
	_nature_cutoff = lerpf(
		_nature_cutoff, nature_target, 1.0 - exp(-dt * 2.0)
	)
	if _nature_lpf != null:
		_nature_lpf.cutoff_hz = _nature_cutoff

	# Inhale: a soft, rising band of air. Exhale: the air recedes and a warm
	# sub-pad appears, then falls away over the longer out-phase.
	var phase: float = clampf(Breath.world_phase, 0.0, 1.0)
	var whoosh_db: float = SILENCE_DB
	var whoosh_pitch: float = 0.8
	var out_db: float = SILENCE_DB

	if Breath.rising:
		var rise_u: float = clampf(phase / 0.4, 0.0, 1.0)
		var swell: float = sin(PI * rise_u)
		whoosh_db = lerpf(-38.0, -26.0, swell)
		whoosh_db -= (1.0 - wind_amount) * 4.0
		whoosh_pitch = lerpf(0.8, 1.1, rise_u)
	else:
		var fall_u: float = clampf((phase - 0.4) / 0.6, 0.0, 1.0)
		whoosh_pitch = lerpf(1.1, 0.8, fall_u)
		out_db = lerpf(-25.0, -38.0, fall_u)

	_whoosh.pitch_scale = lerpf(
		_whoosh.pitch_scale, whoosh_pitch, 1.0 - exp(-dt * 8.0)
	)
	_set_layer_db(_whoosh, whoosh_db, dt, duck, 3.5)

	_smooth_pitch(
		_out_pad, _root_hz * 0.5 / PAD_BASE_HZ, dt, 1.8
	)
	_set_layer_db(_out_pad, out_db, dt, duck, 2.2)

	var scale: Array = Game.scale_ratios()
	for i in range(_harmony.size()):
		var scale_index: int = int(HARMONY_SCALE_INDICES[i])
		var harmony_pitch: float = (
			_root_hz * 2.0 * float(scale[scale_index]) / PAD_BASE_HZ
		)
		_smooth_pitch(_harmony[i], harmony_pitch, dt, 1.8)

		var harmony_db: float = SILENCE_DB
		if Game.state == "play":
			var gate: float = _soft_gate(
				sync, float(HARMONY_THRESHOLDS[i]), 0.15
			)
			if gate > 0.0:
				harmony_db = lerpf(
					SILENCE_DB, float(HARMONY_DB[i]), gate
				)
		_set_layer_db(_harmony[i], harmony_db, dt, duck, 2.4)

	_set_layer_db(
		_water, -29.0 + world_val * 3.0, dt, duck, 2.0
	)

	var rain_db: float = SILENCE_DB
	if rain_amount > 0.0:
		rain_db = clampf(
			-23.0 + linear_to_db(maxf(rain_amount, 0.0001)),
			SILENCE_DB,
			-23.0
		)
	_set_layer_db(_rain, rain_db, dt, duck, 2.0)

	_update_shot_volumes(dt, duck)


## Fades only the Master bus; generative layers continue running silently.
func set_enabled(on: bool) -> void:
	var target: float = 0.0 if on else SILENCE_DB
	if is_equal_approx(target, _master_target_db):
		return
	_master_from_db = _master_db
	_master_target_db = target
	_master_fade_t = 0.0


## Occasional distant sheep bell. pitch_mul is relative to the high root chime.
func sheep_bell(pitch_mul: float) -> void:
	var mul: float = clampf(pitch_mul, 0.5, 2.0)
	_play_bell(float(Game.root_hz()) * 4.0 * mul, -27.0)


func _on_breath_peak() -> void:
	var root: float = float(Game.root_hz())
	_play_bell(root * 4.0, -24.0)

	if Game.state == "play" and Breath.sync > 0.55:
		var scale: Array = Game.scale_ratios()
		var index: int = _rng.randi_range(0, 4)
		_play_bell(root * 4.0 * float(scale[index]), -20.0)


func _on_sheep_joined(count: int) -> void:
	var root: float = float(Game.root_hz())
	var scale: Array = Game.scale_ratios()
	var first_hz: float = root * 4.0 * float(scale[count % 6])
	var second_hz: float = root * 8.0 * float(scale[(count + 2) % 6])

	_play_bell(first_hz, -22.0)
	_schedule_bell(0.18, second_hz, -26.0)


func _on_game_started(_mode: String) -> void:
	_pending.clear()
	_session_fade = 0.0
	_bird_timer = _rng.randf_range(3.0, 9.0)


func _setup_buses() -> void:
	var music_index: int = _ensure_bus(MUSIC_BUS)
	var nature_index: int = _ensure_bus(NATURE_BUS)
	var music_reverb: AudioEffectReverb = null

	for i in range(AudioServer.get_bus_effect_count(music_index)):
		var effect: AudioEffect = AudioServer.get_bus_effect(music_index, i)
		if effect is AudioEffectReverb and music_reverb == null:
			music_reverb = effect as AudioEffectReverb
		if effect is AudioEffectLowPassFilter and _music_lpf == null:
			_music_lpf = effect as AudioEffectLowPassFilter

	if music_reverb == null:
		music_reverb = AudioEffectReverb.new()
		AudioServer.add_bus_effect(music_index, music_reverb, 0)
	music_reverb.room_size = 0.8
	music_reverb.wet = 0.35

	if _music_lpf == null:
		_music_lpf = AudioEffectLowPassFilter.new()
		AudioServer.add_bus_effect(music_index, _music_lpf)
	_music_lpf.cutoff_hz = _music_cutoff

	for i in range(AudioServer.get_bus_effect_count(nature_index)):
		var effect: AudioEffect = AudioServer.get_bus_effect(nature_index, i)
		if effect is AudioEffectLowPassFilter and _nature_lpf == null:
			_nature_lpf = effect as AudioEffectLowPassFilter

	if _nature_lpf == null:
		_nature_lpf = AudioEffectLowPassFilter.new()
		AudioServer.add_bus_effect(nature_index, _nature_lpf)
	_nature_lpf.cutoff_hz = _nature_cutoff


func _ensure_bus(bus_name: String) -> int:
	var index: int = AudioServer.get_bus_index(bus_name)
	if index == -1:
		AudioServer.add_bus()
		index = AudioServer.bus_count - 1
		AudioServer.set_bus_name(index, bus_name)
	AudioServer.set_bus_send(index, "Master")
	return index


func _build_players() -> void:
	for i in range(DRONE_RATIOS.size()):
		var pitch: float = (
			_root_hz * float(DRONE_RATIOS[i]) / PAD_BASE_HZ
		)
		_drone.append(_make_loop_player(_pad_stream, MUSIC_BUS, pitch))

	_whoosh = _make_loop_player(_noise_stream, NATURE_BUS, 0.8)
	_out_pad = _make_loop_player(
		_pad_stream, MUSIC_BUS, _root_hz * 0.5 / PAD_BASE_HZ
	)

	var scale: Array = Game.scale_ratios()
	for i in range(HARMONY_SCALE_INDICES.size()):
		var scale_index: int = int(HARMONY_SCALE_INDICES[i])
		var pitch: float = (
			_root_hz * 2.0 * float(scale[scale_index]) / PAD_BASE_HZ
		)
		_harmony.append(_make_loop_player(_pad_stream, MUSIC_BUS, pitch))

	_water = _make_loop_player(_noise_stream, NATURE_BUS, 0.67)
	_rain = _make_loop_player(_rain_stream, NATURE_BUS, 1.0)

	for i in range(POOL_SIZE):
		var player := AudioStreamPlayer.new()
		player.volume_db = SILENCE_DB
		player.bus = MUSIC_BUS
		add_child(player)
		_pool.append(player)
		_shot_base_db.append(SILENCE_DB)


func _make_loop_player(
	stream: AudioStreamWAV, bus_name: String, pitch: float
) -> AudioStreamPlayer:
	var player := AudioStreamPlayer.new()
	player.stream = stream
	player.bus = bus_name
	player.pitch_scale = pitch
	player.volume_db = SILENCE_DB
	add_child(player)
	player.play()
	return player


func _update_master_fade(dt: float) -> void:
	if _master_fade_t >= 1.0:
		return
	_master_fade_t = minf(1.0, _master_fade_t + dt / 0.8)
	var u: float = _master_fade_t * _master_fade_t * (
		3.0 - 2.0 * _master_fade_t
	)
	_master_db = lerpf(_master_from_db, _master_target_db, u)
	AudioServer.set_bus_volume_db(0, _master_db)


func _current_duck() -> float:
	if Game.mode == "restless":
		return 1.0 - 0.6 * clampf(Game.e, 0.0, 1.0)
	return 1.0


func _global_db(base_db: float, duck: float) -> float:
	if base_db <= SILENCE_DB + 0.01:
		return SILENCE_DB
	var gain: float = clampf(_session_fade * duck, 0.0, 1.0)
	if gain <= 0.0001:
		return SILENCE_DB
	return maxf(SILENCE_DB, base_db + linear_to_db(gain))


func _set_layer_db(
	player: AudioStreamPlayer,
	base_db: float,
	dt: float,
	duck: float,
	speed: float
) -> void:
	var target: float = _global_db(base_db, duck)
	player.volume_db = lerpf(
		player.volume_db, target, 1.0 - exp(-dt * speed)
	)


func _smooth_pitch(
	player: AudioStreamPlayer, target: float, dt: float, speed: float
) -> void:
	player.pitch_scale = lerpf(
		player.pitch_scale, target, 1.0 - exp(-dt * speed)
	)


func _soft_gate(value: float, threshold: float, width: float) -> float:
	var u: float = clampf((value - threshold) / width, 0.0, 1.0)
	return u * u * (3.0 - 2.0 * u)


func _update_shot_volumes(dt: float, duck: float) -> void:
	var blend: float = 1.0 - exp(-dt * 4.0)
	for i in range(_pool.size()):
		var player: AudioStreamPlayer = _pool[i]
		if not player.playing:
			continue
		var target: float = _global_db(_shot_base_db[i], duck)
		player.volume_db = lerpf(player.volume_db, target, blend)


func _play_bell(hz: float, volume_db: float) -> void:
	_play_shot(
		SHOT_BELL, maxf(0.01, hz / BELL_BASE_HZ), volume_db
	)


func _schedule_bell(delay: float, hz: float, volume_db: float) -> void:
	_schedule_shot(
		delay, SHOT_BELL, maxf(0.01, hz / BELL_BASE_HZ), volume_db
	)


func _schedule_shot(
	delay: float, kind: int, pitch: float, volume_db: float
) -> void:
	if delay <= 0.0:
		_play_shot(kind, pitch, volume_db)
		return
	_pending.append({
		"left": delay,
		"kind": kind,
		"pitch": pitch,
		"db": volume_db,
	})


func _update_pending(dt: float) -> void:
	for i in range(_pending.size() - 1, -1, -1):
		var event: Dictionary = _pending[i]
		var left: float = float(event["left"]) - dt
		if left <= 0.0:
			_play_shot(
				int(event["kind"]),
				float(event["pitch"]),
				float(event["db"])
			)
			_pending.remove_at(i)
		else:
			event["left"] = left


func _play_shot(kind: int, pitch: float, volume_db: float) -> void:
	if _pool.is_empty():
		return

	var index: int = _pool_index
	_pool_index = (_pool_index + 1) % _pool.size()
	var player: AudioStreamPlayer = _pool[index]

	player.stop()
	if kind == SHOT_BIRD:
		player.stream = _bird_stream
		player.bus = NATURE_BUS
	else:
		player.stream = _bell_stream
		player.bus = MUSIC_BUS

	player.pitch_scale = clampf(pitch, 0.05, 8.0)
	_shot_base_db[index] = volume_db
	player.volume_db = _global_db(volume_db, _current_duck())
	player.play()


func _update_birds(dt: float) -> void:
	_bird_timer -= dt
	if _bird_timer > 0.0:
		return

	_bird_timer = _rng.randf_range(3.0, 9.0)
	var life: float = clampf(Game.fv("life"), 0.0, 1.0)
	if life <= 0.45 or _rng.randf() >= life:
		return

	var chirp_count: int = _rng.randi_range(2, 4)
	for i in range(chirp_count):
		_schedule_shot(
			float(i) * 0.13,
			SHOT_BIRD,
			_rng.randf_range(0.9, 1.4),
			-28.0
		)


func _make_noise_loop(seconds: float, white_noise: bool) -> AudioStreamWAV:
	var count: int = int(seconds * SAMPLE_RATE)
	var xfade: int = int(0.25 * SAMPLE_RATE)
	var raw := PackedFloat32Array()
	raw.resize(count + xfade)

	if white_noise:
		for i in range(raw.size()):
			raw[i] = _rng.randf_range(-1.0, 1.0)
	else:
		# Paul Kellet-style pink filtering, mixed with a slower brown component.
		var b0: float = 0.0
		var b1: float = 0.0
		var b2: float = 0.0
		var b3: float = 0.0
		var b4: float = 0.0
		var b5: float = 0.0
		var b6: float = 0.0
		var brown: float = 0.0

		for i in range(raw.size()):
			var white: float = _rng.randf_range(-1.0, 1.0)
			b0 = 0.99886 * b0 + white * 0.0555179
			b1 = 0.99332 * b1 + white * 0.0750759
			b2 = 0.96900 * b2 + white * 0.1538520
			b3 = 0.86650 * b3 + white * 0.3104856
			b4 = 0.55000 * b4 + white * 0.5329522
			b5 = -0.7616 * b5 - white * 0.0168980
			var pink: float = (
				b0 + b1 + b2 + b3 + b4 + b5 + b6 + white * 0.5362
			) * 0.11
			b6 = white * 0.115926
			brown = (brown + 0.018 * white) / 1.018
			raw[i] = pink * 0.75 + brown * 3.0

	# The beginning crossfades from the extra tail. Thus raw[count - 1]
	# flows into raw[count] at the wrap, with no edge click or gap.
	var looped := PackedFloat32Array()
	looped.resize(count)
	for i in range(count):
		if i < xfade:
			var u: float = float(i) / float(xfade - 1)
			u = u * u * (3.0 - 2.0 * u)
			looped[i] = lerpf(raw[count + i], raw[i], u)
		else:
			looped[i] = raw[i]

	looped = _normalize(looped, 0.65 if white_noise else 0.78)
	return _samples_to_wav(looped, true)


func _make_bell() -> AudioStreamWAV:
	var duration: float = 3.0
	var count: int = int(duration * SAMPLE_RATE)
	var samples := PackedFloat32Array()
	samples.resize(count)

	var ratios: Array[float] = [1.0, 2.005, 2.73, 4.08]
	var amplitudes: Array[float] = [1.0, 0.36, 0.16, 0.07]
	var decays: Array[float] = [1.55, 2.55, 3.35, 4.25]

	for i in range(count):
		var t: float = float(i) / float(SAMPLE_RATE)
		var attack: float = clampf(t / 0.012, 0.0, 1.0)
		attack = attack * attack * (3.0 - 2.0 * attack)
		var release: float = clampf((duration - t) / 0.12, 0.0, 1.0)
		var value: float = 0.0

		for j in range(ratios.size()):
			value += (
				amplitudes[j]
				* sin(TAU * BELL_BASE_HZ * ratios[j] * t)
				* exp(-decays[j] * t)
			)

		samples[i] = value * attack * release * 0.42

	return _samples_to_wav(samples, false)


func _make_pad() -> AudioStreamWAV:
	var duration: float = 2.0
	var count: int = int(duration * SAMPLE_RATE)
	var samples := PackedFloat32Array()
	samples.resize(count)

	# 220 Hz for 2 seconds is exactly 440 cycles, so no end correction is needed.
	for i in range(count):
		var t: float = float(i) / float(SAMPLE_RATE)
		var phase: float = TAU * PAD_BASE_HZ * t
		var soft_triangle: float = (2.0 / PI) * asin(sin(phase))
		samples[i] = (
			0.88 * sin(phase) + 0.12 * soft_triangle
		) * 0.62

	return _samples_to_wav(samples, true)


func _make_chirp() -> AudioStreamWAV:
	var duration: float = 0.12
	var count: int = int(duration * SAMPLE_RATE)
	var samples := PackedFloat32Array()
	samples.resize(count)

	var start_hz: float = 1600.0
	var end_hz: float = 2700.0
	for i in range(count):
		var u: float = float(i) / float(maxi(1, count - 1))
		var t: float = u * duration
		# Integral of a linearly rising frequency gives continuous phase.
		var phase: float = TAU * (
			start_hz * t
			+ 0.5 * (end_hz - start_hz) * t * t / duration
		)
		var envelope: float = sin(PI * u)
		envelope *= envelope
		samples[i] = sin(phase) * envelope * 0.36

	return _samples_to_wav(samples, false)


func _normalize(
	samples: PackedFloat32Array, target_peak: float
) -> PackedFloat32Array:
	var peak: float = 0.0
	for i in range(samples.size()):
		peak = maxf(peak, absf(samples[i]))
	if peak > 0.0001:
		var gain: float = target_peak / peak
		for i in range(samples.size()):
			samples[i] *= gain
	return samples


func _samples_to_wav(
	samples: PackedFloat32Array, looped: bool
) -> AudioStreamWAV:
	var data := PackedByteArray()
	data.resize(samples.size() * 2)

	for i in range(samples.size()):
		var value: int = int(roundf(
			clampf(samples[i], -1.0, 1.0) * 32767.0
		))
		data.encode_s16(i * 2, value)

	var stream := AudioStreamWAV.new()
	stream.format = AudioStreamWAV.FORMAT_16_BITS
	stream.mix_rate = SAMPLE_RATE
	stream.stereo = false
	stream.data = data
	if looped:
		stream.loop_mode = AudioStreamWAV.LOOP_FORWARD
		stream.loop_begin = 0
		stream.loop_end = samples.size()
	return stream
