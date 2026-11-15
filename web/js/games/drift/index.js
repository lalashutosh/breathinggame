import { MOODS, MOOD_ORDER, wave } from './moods.js';
import { MicBreath, BleHeart, support } from '../../lib/sensors.js';
import { HeartCalm, CalmAudio, BreathFollower } from '../../lib/calm.js';
export const meta = { id: 'drift', title: 'ΑΝΑΣΑ · Minimalist' };

let hasPlayedDrift = false;

export function mount(container, { onComplete, onExit } = {}) {
	const doc = container.ownerDocument;
	const win = doc.defaultView || window;
	const TAU = Math.PI * 2;
	const clamp = (v, lo = 0, hi = 1) => Math.max(lo, Math.min(hi, v));
	const lerp = (a, b, t) => a + (b - a) * t;
	const smooth = (t) => t * t * (3 - 2 * t);
	const listeners = [];
	const hexCache = new Map();

	let selectedMood = MOOD_ORDER[0];
	let mood = MOODS[selectedMood];
	let destroyed = false;
	let raf = 0;
	let resizeObserver = null;
	let W = 1;
	let H = 1;
	let dpr = 1;
	let sceneTime = 0;
	let lastFrame = win.performance.now();
	let orbY = 0;
	let orbV = 0;
	let holding = false;
	let pointerHeld = false;
	let activePointer = null;
	let playTime = 0;
	let flowTime = 0;
	let arriveTime = 0;
	let result = null;
	let seedClock = 0;
	let hillFarOffset = 0;
	let hillNearOffset = 0;
	let totalPresses = 0;
	let measuredPeriod = 0;
	let firstMeasuredPeriod = 0;
	let latestMeasuredPeriod = 0;
	let soundOn = true;
	let audio = null;
	let audioMixClock = 0;
	let trail = [];
	let seeds = [];
	let motes = [];
	let skyLights = [];

	const heldCodes = new Set();
	const pressStarts = [];

	const S = {
		p: 0,
		e: 0,
		sync: 0,
		worldPhase: 0,
		P: mood.period[0],
		lights: 0,
		auto: false,
		state: 'setup',
	};

	function listen(target, type, fn, options) {
		target.addEventListener(type, fn, options);
		listeners.push(() => target.removeEventListener(type, fn, options));
	}

	function element(tag, className, text) {
		const node = doc.createElement(tag);
		if (className) node.className = className;
		if (text !== undefined) node.textContent = text;
		return node;
	}

	const rootEl = element('div', 'dr');
	rootEl.tabIndex = -1;
	rootEl.setAttribute('aria-label', 'Anasa, minimalist mode');

	const style = doc.createElement('style');
	style.textContent = `
		.dr {
			position: fixed;
			inset: 0;
			z-index: 1000;
			overflow: hidden;
			background: #11172c;
			color: #f6f1e7;
			font-family: system-ui, sans-serif;
			font-weight: 400;
			user-select: none;
			-webkit-user-select: none;
			outline: none;
		}
		.dr *, .dr *::before, .dr *::after { box-sizing: border-box; }
		.dr-canvas {
			position: absolute;
			inset: 0;
			display: block;
			width: 100%;
			height: 100%;
			touch-action: none;
		}
		.dr-setup, .dr-end {
			position: absolute;
			inset: 0;
			display: flex;
			align-items: center;
			justify-content: center;
			overflow: auto;
			padding: 36px 22px;
		}
		.dr-setup {
			background: linear-gradient(180deg, rgba(7,10,25,.13), rgba(7,10,25,.28));
			transition: opacity .9s ease;
		}
		.dr-setup.dr-leaving {
			opacity: 0;
			pointer-events: none;
		}
		.dr-setup-inner {
			width: min(720px, 100%);
			margin: auto;
			text-align: center;
		}
		.dr-title {
			margin: 0;
			font-family: "Cormorant Garamond", "EB Garamond", Georgia, serif;
			font-size: clamp(64px, 10vw, 108px);
			font-weight: 400;
			line-height: .95;
			letter-spacing: -.035em;
			text-shadow: 0 2px 28px rgba(5,8,22,.2);
		}
		.dr-subtitle {
			margin: 15px 0 35px;
			font-family: "Cormorant Garamond", "EB Garamond", Georgia, serif;
			font-size: clamp(19px, 2.5vw, 25px);
			font-style: italic;
			font-weight: 400;
			opacity: .82;
		}
		.dr-label {
			margin: 0 0 14px;
			font-size: 10px;
			font-weight: 500;
			letter-spacing: .2em;
			text-transform: uppercase;
			opacity: .68;
		}
		.dr-moods {
			display: flex;
			flex-wrap: wrap;
			justify-content: center;
			gap: 9px;
		}
		.dr-chip, .dr-mood {
			border: 1px solid rgba(255,255,255,.25);
			background: rgba(10,14,34,.35);
			backdrop-filter: blur(12px);
			-webkit-backdrop-filter: blur(12px);
			color: #f6f1e7;
			border-radius: 999px;
			cursor: pointer;
			font-family: system-ui, sans-serif;
			transition: background .35s ease, border-color .35s ease, opacity .35s ease;
		}
		.dr-chip {
			padding: 9px 15px;
			font-size: 12px;
			line-height: 1.2;
		}
		.dr-chip:hover, .dr-mood:hover { background: rgba(20,25,48,.5); }
		.dr-chip:focus-visible, .dr-mood:focus-visible, .dr-cream:focus-visible {
			outline: 1px solid rgba(255,255,255,.8);
			outline-offset: 3px;
		}
		.dr-mood {
			display: grid;
			grid-template-columns: 22px auto;
			grid-template-rows: auto auto;
			column-gap: 10px;
			align-items: center;
			min-width: 116px;
			padding: 10px 14px 10px 11px;
			text-align: left;
			border-radius: 20px;
		}
		.dr-mood[aria-pressed="true"] {
			border-color: rgba(246,241,231,.72);
			background: rgba(32,35,57,.5);
		}
		.dr-swatch {
			grid-row: 1 / 3;
			width: 22px;
			height: 22px;
			border-radius: 50%;
			box-shadow: inset 0 0 0 1px rgba(255,255,255,.18);
		}
		.dr-mood-name { font-size: 12px; line-height: 1.25; }
		.dr-mood-sub {
			font-size: 9px;
			line-height: 1.35;
			opacity: .58;
			white-space: nowrap;
		}
		.dr-setup-actions {
			display: flex;
			flex-direction: column;
			align-items: center;
			gap: 16px;
			margin-top: 28px;
		}
		.dr-cream {
			border: 0;
			border-radius: 999px;
			padding: 13px 29px;
			background: #f6f1e7;
			color: #29263a;
			font-family: system-ui, sans-serif;
			font-size: 13px;
			cursor: pointer;
			box-shadow: 0 5px 30px rgba(5,8,20,.12);
			transition: background .3s ease, transform .3s ease;
		}
		.dr-cream:hover { background: #fffaf0; transform: translateY(-1px); }
		.dr-cream:disabled { cursor: default; opacity: .55; transform: none; }
		.dr-easy {
			display: inline-flex;
			align-items: center;
			gap: 8px;
			font-size: 11px;
			opacity: .72;
			cursor: pointer;
		}
		.dr-easy input {
			width: 13px;
			height: 13px;
			margin: 0;
			accent-color: #f6f1e7;
			cursor: pointer;
		}
		.dr-sense { display: flex; gap: 10px; justify-content: center; flex-wrap: wrap; margin-top: 12px; }
		.dr-sense .dr-chip { font-size: 12.5px; }
		.dr-sense-status { width: 100%; text-align: center; font-size: 11.5px; opacity: .7; min-height: 1.2em; margin-top: 4px; }
		.dr-heart { position: absolute; left: 18px; top: 22px; width: 9px; height: 9px; border-radius: 50%; background: #ffb4a8; opacity: 0; transition: opacity .6s; box-shadow: 0 0 10px #ffb4a8; }
		.dr-heart.on { opacity: .75; animation: dr-beat var(--beat, 1s) ease-in-out infinite; }
		@keyframes dr-beat { 0%, 100% { transform: scale(.8); } 15% { transform: scale(1.25); } }
		.dr-quiet {
			margin: 23px 0 0;
			font-size: 11px;
			letter-spacing: .025em;
			opacity: .58;
		}
		.dr-play {
			position: absolute;
			inset: 0;
			pointer-events: none;
			opacity: 0;
			transition: opacity 1.2s ease;
		}
		.dr-play.dr-show { opacity: 1; }
		.dr-top {
			position: absolute;
			top: max(18px, env(safe-area-inset-top));
			right: max(18px, env(safe-area-inset-right));
			display: flex;
			gap: 8px;
			pointer-events: auto;
		}
		.dr-play:not(.dr-show) .dr-top { pointer-events: none; }
		.dr-top .dr-chip { opacity: .45; }
		.dr-top .dr-chip:hover, .dr-top .dr-chip:focus-visible { opacity: 1; }
		.dr-hint {
			position: absolute;
			left: 20px;
			right: 20px;
			bottom: max(6vh, env(safe-area-inset-bottom));
			text-align: center;
			font-family: "Cormorant Garamond", "EB Garamond", Georgia, serif;
			font-size: clamp(17px, 2.2vw, 22px);
			font-style: italic;
			font-weight: 400;
			line-height: 1.55;
			opacity: 0;
			transform: translateY(5px);
			transition: opacity 1.6s ease, transform 1.6s ease;
			text-shadow: 0 1px 15px rgba(5,8,20,.3);
		}
		.dr-hint.dr-hint-show { opacity: .72; transform: translateY(0); }
		.dr-hint span { display: block; }
		.dr-end {
			background: rgba(6,9,22,.13);
			opacity: 0;
			pointer-events: none;
			transition: opacity 1.6s ease;
		}
		.dr-end.dr-show { opacity: 1; pointer-events: auto; }
		.dr-end-card {
			width: min(620px, 100%);
			margin: auto;
			padding: 34px 30px;
			text-align: center;
			border-radius: 28px;
			background: rgba(10,14,34,.25);
			backdrop-filter: blur(16px);
			-webkit-backdrop-filter: blur(16px);
		}
		.dr-end-title {
			margin: 0;
			font-family: "Cormorant Garamond", "EB Garamond", Georgia, serif;
			font-size: clamp(40px, 6vw, 58px);
			font-weight: 400;
			line-height: 1.1;
		}
		.dr-arrive {
			margin: 14px auto 28px;
			font-family: "Cormorant Garamond", "EB Garamond", Georgia, serif;
			font-size: 20px;
			font-style: italic;
			line-height: 1.45;
			opacity: .8;
		}
		.dr-stats {
			display: grid;
			grid-template-columns: repeat(3, 1fr);
			gap: 14px;
			margin: 0 auto 28px;
		}
		.dr-stat-value {
			display: block;
			font-family: "Cormorant Garamond", "EB Garamond", Georgia, serif;
			font-size: clamp(24px, 4vw, 34px);
			font-weight: 400;
			white-space: nowrap;
		}
		.dr-stat-caption {
			display: block;
			margin-top: 5px;
			font-size: 9px;
			letter-spacing: .18em;
			text-transform: uppercase;
			opacity: .55;
		}
		.dr-step {
			max-width: 440px;
			margin: 0 auto 28px;
			font-family: "Cormorant Garamond", "EB Garamond", Georgia, serif;
			font-size: 18px;
			font-style: italic;
			line-height: 1.5;
			opacity: .75;
		}
		.dr-end-actions {
			display: flex;
			flex-wrap: wrap;
			align-items: center;
			justify-content: center;
			gap: 12px;
		}
		@media (max-width: 600px) {
			.dr-setup { padding: 25px 15px; }
			.dr-subtitle { margin-bottom: 25px; }
			.dr-moods { gap: 7px; }
			.dr-mood { min-width: 104px; padding: 8px 10px 8px 9px; }
			.dr-top { top: 12px; right: 12px; gap: 5px; }
			.dr-top .dr-chip { padding: 8px 11px; font-size: 11px; }
			.dr-end-card { padding: 28px 17px; }
			.dr-stats { gap: 7px; }
			.dr-stat-value { font-size: 23px; }
		}
		@media (max-height: 650px) {
			.dr-title { font-size: 58px; }
			.dr-subtitle { margin: 9px 0 19px; }
			.dr-setup-actions { margin-top: 18px; gap: 10px; }
			.dr-quiet { margin-top: 14px; }
			.dr-end-card { padding-top: 22px; padding-bottom: 22px; }
			.dr-arrive, .dr-stats, .dr-step { margin-bottom: 18px; }
		}
	`;

	const canvas = element('canvas', 'dr-canvas');
	canvas.setAttribute('aria-hidden', 'true');
	const ctx = canvas.getContext('2d');

	const setup = element('section', 'dr-setup');
	const setupInner = element('div', 'dr-setup-inner');
	const title = element('h1', 'dr-title', 'ΑΝΑΣΑ');
	const subtitle = element('p', 'dr-subtitle', 'one small light, a quiet evening');
	const moodLabel = element('p', 'dr-label', 'how are you arriving?');
	const moodRow = element('div', 'dr-moods');
	const moodButtons = new Map();

	for (const id of MOOD_ORDER) {
		const preset = MOODS[id];
		const button = element('button', 'dr-mood');
		button.type = 'button';
		button.setAttribute('aria-pressed', String(id === selectedMood));
		button.setAttribute('aria-label', `${preset.label}: ${preset.sub}`);
		const swatch = element('span', 'dr-swatch');
		swatch.style.background = `linear-gradient(135deg, ${preset.skyMid[0]}, ${preset.skyHor[1]})`;
		const name = element('span', 'dr-mood-name', preset.label);
		const sub = element('span', 'dr-mood-sub', preset.sub);
		button.append(swatch, name, sub);
		moodRow.append(button);
		moodButtons.set(id, button);
		listen(button, 'click', () => {
			if (S.state !== 'setup') return;
			selectedMood = id;
			mood = MOODS[id];
			S.p = 0;
			S.e = 0;
			S.P = mood.period[0];
			for (const [key, node] of moodButtons) {
				node.setAttribute('aria-pressed', String(key === id));
			}
		});
	}

	const setupActions = element('div', 'dr-setup-actions');
	const beginButton = element('button', 'dr-cream', 'Begin');
	beginButton.type = 'button';
	const easyLabel = element('label', 'dr-chip dr-easy');
	easyLabel.title = 'Easy mode';
	const easyInput = doc.createElement('input');
	easyInput.type = 'checkbox';
	easyInput.setAttribute('aria-label', 'Easy mode: Let the light find its own way');
	easyLabel.append(easyInput, element('span', '', 'Let the light find its own way'));
	setupActions.append(beginButton, easyLabel);
	const quietLine = element('p', 'dr-quiet', 'Hold to rise · let go to settle · follow the light');
	// optional sensing: breath through the microphone, heart through a Bluetooth strap
	const senseRow = element('div', 'dr-sense');
	const micLabel = element('label', 'dr-chip dr-easy');
	const micInput = doc.createElement('input');
	micInput.type = 'checkbox';
	micInput.disabled = !support.mic;
	micLabel.append(micInput, element('span', '', 'Listen to my breathing'));
	const heartButton = element('button', 'dr-chip', 'Connect heart sensor');
	heartButton.type = 'button';
	heartButton.disabled = !support.bluetooth;
	const senseStatus = element('p', 'dr-sense-status', support.mic || support.bluetooth ? '' : 'Microphone and Bluetooth need a secure page (localhost or https).');
	senseRow.append(micLabel, heartButton, senseStatus);
	setupInner.append(title, subtitle, moodLabel, moodRow, setupActions, senseRow, quietLine);
	setup.append(setupInner);

	const playUI = element('div', 'dr-play');
	const topChips = element('div', 'dr-top');
	const soundButton = element('button', 'dr-chip', 'Sound on');
	const fullscreenButton = element('button', 'dr-chip', 'Fullscreen');
	const finishButton = element('button', 'dr-chip', 'Finish');
	for (const button of [soundButton, fullscreenButton, finishButton]) button.type = 'button';
	soundButton.setAttribute('aria-label', 'Toggle sound');
	soundButton.setAttribute('aria-pressed', 'true');
	topChips.append(soundButton, fullscreenButton, finishButton);
	const hint = element('div', 'dr-hint');
	const heartDot = element('div', 'dr-heart');
	playUI.append(topChips, hint, heartDot);

	const endOverlay = element('section', 'dr-end');
	endOverlay.setAttribute('aria-hidden', 'true');
	const endCard = element('div', 'dr-end-card');
	const endTitle = element('h2', 'dr-end-title', 'Home for now.');
	const arriveText = element('p', 'dr-arrive');
	const stats = element('div', 'dr-stats');

	function makeStat(caption) {
		const wrap = element('div', 'dr-stat');
		const value = element('span', 'dr-stat-value');
		const label = element('span', 'dr-stat-caption', caption);
		wrap.append(value, label);
		stats.append(wrap);
		return value;
	}

	const rhythmValue = makeStat('rhythm');
	const flowValue = makeStat('in flow');
	const lightsValue = makeStat('lights');
	const stepText = element('p', 'dr-step');
	const endActions = element('div', 'dr-end-actions');
	const collectButton = element('button', 'dr-cream', 'Collect your sapling');
	const leaveButton = element('button', 'dr-chip', 'Leave');
	collectButton.type = 'button';
	leaveButton.type = 'button';
	endActions.append(collectButton, leaveButton);
	endCard.append(endTitle, arriveText, stats, stepText, endActions);
	endOverlay.append(endCard);

	rootEl.append(style, canvas, setup, playUI, endOverlay);
	container.replaceChildren(rootEl);

	function hexToRgb(hex) {
		if (hexCache.has(hex)) return hexCache.get(hex);
		const clean = hex.replace('#', '');
		const value = clean.length === 3
			? clean.split('').map((c) => c + c).join('')
			: clean;
		const rgb = [
			parseInt(value.slice(0, 2), 16),
			parseInt(value.slice(2, 4), 16),
			parseInt(value.slice(4, 6), 16),
		];
		hexCache.set(hex, rgb);
		return rgb;
	}

	function V(key) {
		const pair = mood[key];
		return lerp(pair[0], pair[1], S.e);
	}

	function colour(key) {
		const pair = mood[key];
		const a = hexToRgb(pair[0]);
		const b = hexToRgb(pair[1]);
		return [
			lerp(a[0], b[0], S.e),
			lerp(a[1], b[1], S.e),
			lerp(a[2], b[2], S.e),
		];
	}

	function cssRgb(rgb) {
		return `rgb(${Math.round(rgb[0])}, ${Math.round(rgb[1])}, ${Math.round(rgb[2])})`;
	}

	function C(key) {
		return cssRgb(colour(key));
	}

	function rgba(rgb, alpha) {
		return `rgba(${Math.round(rgb[0])}, ${Math.round(rgb[1])}, ${Math.round(rgb[2])}, ${clamp(alpha, 0, 1)})`;
	}

	function mixRgb(a, b, amount) {
		return [
			lerp(a[0], b[0], amount),
			lerp(a[1], b[1], amount),
			lerp(a[2], b[2], amount),
		];
	}

	function shade(rgb, amount) {
		return [rgb[0] * amount, rgb[1] * amount, rgb[2] * amount];
	}

	const stars = Array.from({ length: 140 }, () => ({
		x: Math.random(),
		y: Math.random(),
		r: 0.45 + Math.random() * 0.9,
		phase: Math.random() * TAU,
		speed: 0.18 + Math.random() * 0.35,
	}));

	const clouds = Array.from({ length: 7 }, () => ({
		x: Math.random(),
		y: 0.12 + Math.random() * 0.65,
		w: 0.2 + Math.random() * 0.24,
		h: 0.018 + Math.random() * 0.026,
		speed: 0.35 + Math.random() * 0.75,
		travel: 0,
		alpha: 0.035 + Math.random() * 0.04,
	}));

	const rainDrops = Array.from({ length: 120 }, () => ({
		x: Math.random(),
		y: Math.random(),
		speed: 0.7 + Math.random() * 0.65,
		length: 9 + Math.random() * 15,
		alpha: 0.45 + Math.random() * 0.55,
	}));

	const bird = {
		active: false,
		clock: 0,
		next: 12 + Math.random() * 8,
		t: 0,
		duration: 23,
		direction: 1,
		y: 0.3,
		phase: Math.random() * TAU,
	};

	function orbX() {
		return W * 0.28;
	}

	function horizonY() {
		return H * 0.66;
	}

	function bandWidth() {
		return H * 0.07;
	}

	function pathTop() {
		return H * 0.22;
	}

	function pathSpan() {
		return H * 0.36;
	}

	function pathSpeed() {
		// one slow swell spans most of the screen: calm, not busy
		return Math.max(120, W * 0.14) * (1 + 0.25 * S.sync);
	}

	function phaseAt(x) {
		const phase = S.worldPhase + (x - orbX()) / pathSpeed() / Math.max(0.1, S.P);
		return ((phase % 1) + 1) % 1;
	}

	function ribbonYAt(x) {
		return pathTop() + (1 - wave(phaseAt(x))) * pathSpan();
	}

	function ribbonVisibility() {
		return S.state === 'arrive' || S.state === 'end'
			? clamp(1 - arriveTime / 1.9)
			: 1;
	}

	function resize() {
		if (destroyed) return;
		const oldH = H;
		const rect = rootEl.getBoundingClientRect();
		W = Math.max(1, rect.width || win.innerWidth || 1);
		H = Math.max(1, rect.height || win.innerHeight || 1);
		dpr = Math.min(2, Math.max(1, win.devicePixelRatio || 1));
		canvas.width = Math.max(1, Math.round(W * dpr));
		canvas.height = Math.max(1, Math.round(H * dpr));
		ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
		if (oldH > 1) orbY *= H / oldH;
		else orbY = H * 0.4;
		orbY = clamp(orbY, pathTop(), pathTop() + pathSpan());
	}

	function median(values) {
		const sorted = values.slice().sort((a, b) => a - b);
		const middle = Math.floor(sorted.length / 2);
		return sorted.length % 2
			? sorted[middle]
			: (sorted[middle - 1] + sorted[middle]) * 0.5;
	}

	function registerPress() {
		totalPresses += 1;
		pressStarts.push(playTime);
		if (pressStarts.length > 5) pressStarts.shift();
		if (pressStarts.length >= 3) {
			const recent = pressStarts.slice(-3);
			const gaps = [
				recent[1] - recent[0],
				recent[2] - recent[1],
			].filter((gap) => gap > 0.15);
			if (gaps.length) {
				measuredPeriod = clamp(median(gaps), 2.5, 12);
				if (!firstMeasuredPeriod) firstMeasuredPeriod = measuredPeriod;
				latestMeasuredPeriod = measuredPeriod;
			}
		}
	}

	function refreshHolding() {
		const next = pointerHeld || heldCodes.size > 0;
		if (next === holding) return;
		holding = next;
		if (holding && S.state === 'play' && !S.auto) registerPress();
	}

	function clearInput() {
		pointerHeld = false;
		activePointer = null;
		heldCodes.clear();
		holding = false;
	}

	function requestRootFullscreen() {
		try {
			const promise = rootEl.requestFullscreen?.();
			if (promise && promise.catch) promise.catch(() => {});
		} catch (_) {
			// Fullscreen is optional.
		}
	}

	function toggleFullscreen() {
		try {
			if (doc.fullscreenElement) {
				const promise = doc.exitFullscreen?.();
				if (promise && promise.catch) promise.catch(() => {});
			} else {
				requestRootFullscreen();
			}
		} catch (_) {
			// Fullscreen is optional.
		}
	}

	function createAudio() {
		const AudioContextClass = win.AudioContext || win.webkitAudioContext;
		if (!AudioContextClass) return null;

		try {
			const ac = new AudioContextClass();
			const now = ac.currentTime;
			const master = ac.createGain();
			master.gain.setValueAtTime(0, now);
			master.connect(ac.destination);

			const root = 130.81;
			const ratios = [1, 9 / 8, 5 / 4, 3 / 2, 5 / 3, 2];
			const droneFilter = ac.createBiquadFilter();
			droneFilter.type = 'lowpass';
			droneFilter.frequency.value = 350;
			droneFilter.Q.value = 0.35;
			const droneGain = ac.createGain();
			droneGain.gain.value = 0.55;
			droneFilter.connect(droneGain);
			droneGain.connect(master);

			const droneParts = [
				{ frequency: root, type: 'sine', gain: 0.045 },
				{ frequency: root * 1.5, type: 'sine', gain: 0.024 },
				{ frequency: root * 2, type: 'triangle', gain: 0.007 },
			];
			for (const part of droneParts) {
				const oscillator = ac.createOscillator();
				const gain = ac.createGain();
				oscillator.type = part.type;
				oscillator.frequency.value = part.frequency;
				gain.gain.value = part.gain;
				oscillator.connect(gain);
				gain.connect(droneFilter);
				oscillator.start();
			}

			const pads = [];
			const padDegrees = [0, 2, 4];
			const thresholds = [0.35, 0.55, 0.75];
			for (let i = 0; i < 3; i += 1) {
				const oscillator = ac.createOscillator();
				const gain = ac.createGain();
				oscillator.type = 'sine';
				oscillator.frequency.value = root * 2 * ratios[padDegrees[i]];
				gain.gain.value = 0;
				oscillator.connect(gain);
				gain.connect(master);
				oscillator.start();
				pads.push({ gain, threshold: thresholds[i], level: [0.016, 0.013, 0.01][i] });
			}

			const pluckBus = ac.createGain();
			pluckBus.gain.value = 0.8;
			pluckBus.connect(master);
			const delay = ac.createDelay(1);
			delay.delayTime.value = 0.38;
			const feedback = ac.createGain();
			feedback.gain.value = 0.35;
			const wet = ac.createGain();
			wet.gain.value = 0.3;
			pluckBus.connect(delay);
			delay.connect(feedback);
			feedback.connect(delay);
			delay.connect(wet);
			wet.connect(master);

			const noiseBuffer = ac.createBuffer(1, ac.sampleRate * 2, ac.sampleRate);
			const data = noiseBuffer.getChannelData(0);
			let previous = 0;
			for (let i = 0; i < data.length; i += 1) {
				const white = Math.random() * 2 - 1;
				previous = previous * 0.12 + white * 0.88;
				data[i] = previous;
			}

			function noiseBed(type, frequency) {
				const source = ac.createBufferSource();
				source.buffer = noiseBuffer;
				source.loop = true;
				const filter = ac.createBiquadFilter();
				filter.type = type;
				filter.frequency.value = frequency;
				const gain = ac.createGain();
				gain.gain.value = 0;
				source.connect(filter);
				filter.connect(gain);
				gain.connect(master);
				source.start();
				return gain;
			}

			const windGain = noiseBed('lowpass', 500);
			const rainGain = noiseBed('highpass', 3000);
			const waterGain = noiseBed('lowpass', 300);

			if (ac.state === 'suspended') {
				const promise = ac.resume();
				if (promise && promise.catch) promise.catch(() => {});
			}

			return {
				ctx: ac,
				master,
				root,
				ratios,
				droneFilter,
				droneGain,
				pads,
				pluckBus,
				windGain,
				rainGain,
				waterGain,
				startedAt: now,
			};
		} catch (_) {
			return null;
		}
	}

	function pluck(degree, volume, chime = false) {
		if (!audio || audio.ctx.state === 'closed') return;
		const ac = audio.ctx;
		const now = ac.currentTime;
		const oscillator = ac.createOscillator();
		const gain = ac.createGain();
		oscillator.type = chime ? 'sine' : (S.lights % 2 ? 'triangle' : 'sine');
		oscillator.frequency.value = audio.root * 2 * audio.ratios[degree % audio.ratios.length];
		gain.gain.setValueAtTime(0.0001, now);
		gain.gain.linearRampToValueAtTime(volume, now + 0.035);
		gain.gain.exponentialRampToValueAtTime(0.0001, now + 2.5);
		oscillator.connect(gain);
		gain.connect(audio.pluckBus);
		oscillator.start(now);
		oscillator.stop(now + 2.55);
		oscillator.onended = () => {
			oscillator.disconnect();
			gain.disconnect();
		};
	}

	function applyMaster(fast = false) {
		if (!audio) return;
		const ac = audio.ctx;
		const fadeIn = clamp((ac.currentTime - audio.startedAt) / 2);
		const restlessScale = selectedMood === 'restless' ? 1 - 0.6 * S.e : 1;
		const arrivalScale = S.state === 'play' || S.state === 'setup'
			? 1
			: Math.max(0.28, 1 - arriveTime * 0.09);
		const target = soundOn ? 0.62 * fadeIn * restlessScale * arrivalScale : 0;
		audio.master.gain.setTargetAtTime(target, ac.currentTime, fast ? 0.06 : 0.18);
	}

	function updateAudio(dt) {
		if (!audio) return;
		audioMixClock += dt;
		if (audioMixClock < 0.1) return;
		audioMixClock = 0;

		const ac = audio.ctx;
		const now = ac.currentTime;
		const worldWave = wave(S.worldPhase);
		const wind = V('wind');
		const rain = V('rain');
		applyMaster();
		audio.droneFilter.frequency.setTargetAtTime(
			350 + 1200 * S.sync + 300 * worldWave,
			now,
			0.25,
		);
		audio.droneGain.gain.setTargetAtTime(0.5 + 0.2 * worldWave, now, 0.35);

		for (const pad of audio.pads) {
			const amount = smooth(clamp((S.sync - pad.threshold) / 0.2));
			pad.gain.gain.setTargetAtTime(pad.level * amount, now, 0.5);
		}

		const windLevel = (0.02 + 0.05 * wind) * (0.75 + 0.35 * worldWave);
		audio.windGain.gain.setTargetAtTime(windLevel, now, 0.35);
		audio.rainGain.gain.setTargetAtTime(0.04 * rain, now, 0.35);
		audio.waterGain.gain.setTargetAtTime(0.015, now, 0.5);
	}

	const mic = new MicBreath();
	const heart = new BleHeart();
	const follower = new BreathFollower();
	let cues = null;
	let micOn = false;
	let wasRising = false;
	let calmFx = 0;
	let calmBursts = [];
	const calm = new HeartCalm({
		onCalm: () => {
			// reward only: a warm bloom from the light, a shower of new stars, a soft chime
			calmFx = 1;
			const ox = orbX();
			for (let i = 0; i < 26; i += 1) {
				calmBursts.push({ x: ox, y: orbY, vx: (Math.random() - 0.5) * W * 0.12, vy: -H * (0.05 + Math.random() * 0.12), life: 2.5 + Math.random() * 2 });
			}
			for (let i = 0; i < 6 && skyLights.length < 60; i += 1) {
				skyLights.push({ nx: Math.random(), ny: 0.1 + Math.random() * 0.6, size: 1 + Math.random() * 1.5, phase: Math.random() * TAU });
			}
			cues?.calmChime();
			if (S.state === 'play') {
				hint.replaceChildren(element('span', '', 'Your heart is settling.'));
				hint.classList.remove('dr-hint-show');
				void hint.offsetWidth;
				hint.classList.add('dr-hint-show');
				win.setTimeout(() => hint.classList.remove('dr-hint-show'), 4500);
			}
		},
	});
	heart.onChange = () => {
		senseStatus.textContent = heart.connected ? `heart: ${heart.status}` : heart.status;
		if (heart.connected) heartButton.textContent = 'Heart connected';
	};
	listen(heartButton, 'click', async () => {
		heartButton.disabled = true;
		try { await heart.connect(); }
		catch (e) { senseStatus.textContent = e.name === 'NotFoundError' ? 'No sensor chosen.' : String(e.message || e); }
		finally { heartButton.disabled = heart.connected || !support.bluetooth; }
	});

	function toggleSound() {
		soundOn = !soundOn;
		soundButton.textContent = soundOn ? 'Sound on' : 'Sound off';
		soundButton.setAttribute('aria-pressed', String(soundOn));
		applyMaster(true);
		cues?.setEnabled(soundOn);
	}

	function initialiseSeeds() {
		seeds = [];
		seedClock = 0;
		const spacing = pathSpeed() * S.P / 4;
		for (let x = orbX() + spacing; x < W + spacing; x += spacing) {
			seeds.push({ x, age: 1.5, fade: 1, missed: false, gathered: false });
		}
	}

	function begin() {
		if (S.state !== 'setup') return;
		S.state = 'play';
		S.p = 0;
		S.e = 0;
		S.sync = 0;
		S.P = mood.period[0];
		S.lights = 0;
		S.auto = easyInput.checked || S.auto;
		playTime = 0;
		flowTime = 0;
		arriveTime = 0;
		totalPresses = 0;
		measuredPeriod = 0;
		firstMeasuredPeriod = 0;
		latestMeasuredPeriod = 0;
		pressStarts.length = 0;
		motes = [];
		skyLights = [];
		trail = [];
		orbV = 0;
		orbY = ribbonYAt(orbX());
		clearInput();
		initialiseSeeds();

		setup.classList.add('dr-leaving');
		setup.setAttribute('aria-hidden', 'true');
		playUI.classList.add('dr-show');
		hint.replaceChildren();
		hint.append(element('span', '', mood.intro));
		if (!hasPlayedDrift) {
			hint.append(element('span', '', 'The light rises and settles with the water.'));
		}
		hasPlayedDrift = true;
		hint.classList.remove('dr-hint-show');
		void hint.offsetWidth;
		hint.classList.add('dr-hint-show');

		beginButton.blur();
		rootEl.focus({ preventScroll: true });
		requestRootFullscreen();
		audio = createAudio();
		audioMixClock = 1;
		applyMaster(true);
		cues = new CalmAudio({ root: 130.81 });
		cues.resume();
		cues.setEnabled(soundOn);
		calm.reset();
		if (micInput.checked) {
			mic.start().then(() => { micOn = true; }).catch(() => { micOn = false; });
		}
	}

	function startArrival() {
		if (S.state !== 'play') return;
		S.state = 'arrive';
		arriveTime = 0;
		clearInput();
		playUI.classList.remove('dr-show');
		hint.classList.remove('dr-hint-show');
	}

	function revealEnd() {
		if (S.state !== 'arrive') return;
		S.state = 'end';

		// When available, the rhythm reflects the player's hands; otherwise it
		// reflects the world's opening and current periods.
		const startPeriod = firstMeasuredPeriod || mood.period[0];
		const finalPeriod = latestMeasuredPeriod || S.P;
		const a = Math.round(60 / Math.max(2.5, startPeriod));
		const b = Math.round(60 / Math.max(2.5, finalPeriod));
		const flowPct = Math.round(clamp(flowTime / Math.max(0.001, playTime)) * 100);
		const seconds = Math.max(0, Math.round(playTime));

		rhythmValue.textContent = `${a} → ${b} / min`;
		flowValue.textContent = `${flowPct}%`;
		lightsValue.textContent = String(S.lights);
		arriveText.textContent = mood.arrive + (calm.events && calm.baseline ? ` Your heart settled ${Math.max(2, Math.round(calm.baseline - (calm.average() ?? calm.baseline)))} bpm.` : '');
		stepText.textContent = mood.step;
		result = {
			gameId: 'drift',
			mood: selectedMood,
			flowPct,
			lights: S.lights,
			seconds,
			breathSource: micOn ? 'mic' : 'hands',
			heart: calm.startBpm ? { start: calm.startBpm, end: calm.lastBpm, calmMoments: calm.events, sensor: heart.name } : null,
		};

		endOverlay.classList.add('dr-show');
		endOverlay.setAttribute('aria-hidden', 'false');
	}

	function advanceWorld(dt, allowChime) {
		const before = S.worldPhase;
		const after = before + dt / Math.max(2.5, S.P);
		if (
			allowChime &&
			Math.floor(after - 0.4) > Math.floor(before - 0.4)
		) {
			pluck(5, 0.022, true);
		}
		S.worldPhase = after % 1;
	}

	function updatePeriod(dt) {
		let target;
		if (playTime < 15) {
			const breathP = micOn ? follower.period() : null;
			target = breathP
				? Math.max(2.5, Math.min(12, breathP))
				: totalPresses >= 3 && measuredPeriod
					? measuredPeriod
					: mood.period[0];
		} else {
			target = lerp(
				mood.period[0],
				mood.period[1],
				Math.min(1, S.e * 1.15),
			);
		}
		S.P += (target - S.P) * Math.min(1, dt * 0.4);
	}

	function updateOrb(dt) {
		const top = pathTop();
		const span = pathSpan();
		if (S.auto) {
			const previous = orbY;
			orbY = ribbonYAt(orbX());
			orbV = dt > 0 ? (orbY - previous) / dt : 0;
			return;
		}

		const riseSpeed = 1.15 * span / (0.4 * S.P);
		const fallSpeed = 1.15 * span / (0.6 * S.P);
		const targetVelocity = holding ? -riseSpeed : fallSpeed;
		orbV += (targetVelocity - orbV) * (1 - Math.exp(-dt / 0.25));
		orbY += orbV * dt;

		if (orbY < top) {
			orbY = top;
			if (orbV < 0) orbV = 0;
		}
		if (orbY > top + span) {
			orbY = top + span;
			if (orbV > 0) orbV = 0;
		}
	}

	function gatherSeed(seed, y) {
		seed.gathered = true;
		S.lights += 1;
		const nx = clamp((orbX() + (Math.random() - 0.5) * W * 0.38) / W, 0.06, 0.94);
		const ny = 0.08 + Math.random() * 0.42;
		motes.push({
			sx: orbX(),
			sy: y,
			x: orbX(),
			y,
			nx,
			ny,
			t: 0,
			phase: Math.random() * TAU,
		});
		pluck([0, 1, 2, 3, 4, 5][S.lights % 6], 0.055);
	}

	function updateSeeds(dt) {
		seedClock += dt;
		const interval = Math.max(0.5, S.P / 4);
		while (seedClock >= interval) {
			seedClock -= interval;
			seeds.push({
				x: W + 24,
				age: 0,
				fade: 1,
				missed: false,
				gathered: false,
			});
		}

		const xNow = orbX();
		const speed = pathSpeed();
		for (const seed of seeds) {
			const previousX = seed.x;
			seed.x -= speed * dt;
			seed.age += dt;
			if (!seed.missed && !seed.gathered && previousX >= xNow && seed.x <= xNow) {
				const y = ribbonYAt(xNow);
				if (Math.abs(orbY - y) <= bandWidth() * 0.65) {
					gatherSeed(seed, y);
				} else {
					seed.missed = true;
				}
			}
			if (seed.missed) seed.fade -= dt / 2.4;
		}
		seeds = seeds.filter((seed) => (
			!seed.gathered && seed.fade > 0 && seed.x > -70
		));
	}

	function updateMotes(dt) {
		for (const mote of motes) {
			mote.t += dt / 2.8;
			const u = smooth(clamp(mote.t));
			const tx = mote.nx * W;
			const ty = mote.ny * horizonY();
			mote.x = lerp(mote.sx, tx, u) + Math.sin(mote.t * Math.PI) * 12;
			mote.y = lerp(mote.sy, ty, u) - Math.sin(mote.t * Math.PI) * 24;
			if (mote.t >= 1 && skyLights.length < 60) {
				skyLights.push({
					nx: mote.nx,
					ny: mote.ny,
					phase: mote.phase,
					size: 0.8 + Math.random() * 0.8,
				});
			}
		}
		motes = motes.filter((mote) => mote.t < 1);
	}

	function updateAmbient(dt) {
		const wind = V('wind');
		const life = V('life');
		const rain = V('rain');
		hillFarOffset += dt * 3 * (1 + 2 * wind);
		hillNearOffset += dt * 8 * (1 + 2 * wind);

		for (const cloud of clouds) {
			cloud.travel += dt * (4 + 60 * wind) * cloud.speed;
		}

		if (rain > 0.002) {
			for (const drop of rainDrops) {
				drop.y += dt * drop.speed;
				drop.x += dt * (0.025 + 0.12 * wind) * drop.speed;
				if (drop.y > 1.05) {
					drop.y = -0.04 - Math.random() * 0.15;
					drop.x = Math.random();
				}
				if (drop.x > 1.1) drop.x = -0.1;
			}
		}

		bird.clock += dt;
		if (!bird.active && bird.clock >= bird.next && life > 0.03) {
			bird.active = true;
			bird.t = 0;
			bird.duration = 20 + Math.random() * 7;
			bird.direction = Math.random() < 0.5 ? 1 : -1;
			bird.y = 0.16 + Math.random() * 0.42;
			bird.phase = Math.random() * TAU;
		}
		if (bird.active) {
			bird.t += dt / bird.duration;
			if (bird.t >= 1) {
				bird.active = false;
				bird.clock = 0;
				bird.next = 20 + Math.random() * 10;
			}
		}
	}

	function update(dt) {
		sceneTime += dt;
		calmFx = Math.max(0, calmFx - dt / 6);
		for (const b of calmBursts) { b.x += b.vx * dt; b.y += b.vy * dt; b.vy *= 0.985; b.life -= dt; }
		calmBursts = calmBursts.filter((b) => b.life > 0);

		if (S.state === 'setup') {
			S.P = mood.period[0];
			advanceWorld(dt, false);
			orbY = ribbonYAt(orbX());
			orbV = 0;
		} else if (S.state === 'play') {
			playTime += dt;
			updatePeriod(dt);
			advanceWorld(dt, true);
			updateOrb(dt);

			let inst = clamp(
				1 - Math.abs(orbY - ribbonYAt(orbX())) / (bandWidth() * 1.2),
			);
			// breath enriches, never steers: breathing with the world adds to the hands' sync
			const rising = (((S.worldPhase % 1) + 1) % 1) < 0.4;
			if (micOn) {
				mic.poll(performance.now());
				follower.update(mic.phase, dt, sceneTime, S.P);
				const p = follower.period();
				if (p) { if (!firstMeasuredPeriod) firstMeasuredPeriod = p; latestMeasuredPeriod = p; }
				const breathInst = mic.phase === 'rest' ? 0.3 : (mic.phase === 'in') === rising ? 1 : 0;
				inst = Math.max(inst, 0.5 * inst + 0.5 * breathInst);
			}
			if (cues && rising !== wasRising) {
				if (rising) cues.inhale(0.4 * S.P);
				else cues.exhale(0.6 * S.P);
			}
			wasRising = rising;
			const bpm = heart.bpm;
			if (bpm) calm.push(bpm, performance.now() / 1000); // heart runs on real time
			heartDot.classList.toggle('on', !!bpm);
			if (bpm) heartDot.style.setProperty('--beat', `${(60 / bpm).toFixed(2)}s`);
			S.sync += (inst - S.sync) * Math.min(1, dt * 0.45);
			if (S.sync > 0.55) flowTime += dt;

			// demo length: about a minute (50-75 s); following the light gets you home sooner
			S.p = Math.min(1, S.p + dt / 60 * (0.8 + 0.4 * S.sync));
			S.e = S.p * S.p * (3 - 2 * S.p);
			updateSeeds(dt);

			if (playTime > 8) hint.classList.remove('dr-hint-show');
			if (S.p >= 1) startArrival();
		} else {
			arriveTime += dt;
			advanceWorld(dt * 0.18, false);
			orbY = Math.max(H * 0.09, orbY - dt * 15);
			orbV = -15;
			for (const seed of seeds) {
				seed.x -= pathSpeed() * dt * 0.15;
				seed.fade -= dt * 0.55;
			}
			seeds = seeds.filter((seed) => seed.fade > 0);
			if (S.state === 'arrive' && arriveTime >= 2) revealEnd();
		}

		if (S.state === 'setup' || S.state === 'play') {
			trail.push({ y: orbY, time: sceneTime });
		}
		trail = trail.filter((point) => sceneTime - point.time < 1.45);
		if (trail.length > 220) trail.splice(0, trail.length - 220);

		updateAmbient(dt);
		updateMotes(dt);
		updateAudio(dt);
	}

	function radialGlow(x, y, radius, rgb, alpha, innerAlpha = 0) {
		if (radius <= 0 || alpha <= 0) return;
		const gradient = ctx.createRadialGradient(x, y, 0, x, y, radius);
		gradient.addColorStop(0, rgba(rgb, innerAlpha || alpha));
		gradient.addColorStop(0.18, rgba(rgb, alpha * 0.75));
		gradient.addColorStop(1, rgba(rgb, 0));
		ctx.fillStyle = gradient;
		ctx.beginPath();
		ctx.arc(x, y, radius, 0, TAU);
		ctx.fill();
	}

	function drawSky() {
		const horizon = horizonY();
		const warmth = S.sync;
		const top = mixRgb(colour('skyTop'), [255, 224, 188], warmth * 0.035);
		const middle = mixRgb(colour('skyMid'), [255, 224, 188], warmth * 0.065);
		const horizonColour = mixRgb(colour('skyHor'), [255, 229, 195], warmth * 0.085);
		const gradient = ctx.createLinearGradient(0, 0, 0, horizon);
		gradient.addColorStop(0, cssRgb(top));
		gradient.addColorStop(0.65, cssRgb(middle));
		gradient.addColorStop(1, cssRgb(horizonColour));
		ctx.fillStyle = gradient;
		ctx.fillRect(0, 0, W, horizon + 1);
	}

	function drawCelestialBodies() {
		const horizon = horizonY();
		const sunX = W * 0.72;
		const sunY = V('sunY') * horizon;
		const worldWave = wave(S.worldPhase);
		const sunRgb = colour('sunCol');
		const size = Math.min(W, H);
		const glowRadius = size * (0.25 + 0.025 * worldWave + 0.025 * S.sync);
		const discRadius = Math.max(10, size * 0.035);

		ctx.save();
		ctx.beginPath();
		ctx.rect(0, 0, W, horizon);
		ctx.clip();

		const starAlpha = V('stars');
		if (starAlpha > 0.002) {
			for (const star of stars) {
				const x = star.x * W;
				const y = star.y * horizon * 0.96;
				const twinkle = 0.72 + 0.28 * Math.sin(sceneTime * star.speed + star.phase);
				const distance = Math.hypot(x - sunX, y - sunY);
				const hidden = V('sunY') < 1.08
					? clamp(1 - distance / (glowRadius * 1.15)) * 0.96
					: 0;
				const alpha = starAlpha * twinkle * (1 - hidden) * 0.62;
				if (alpha < 0.005) continue;
				ctx.fillStyle = `rgba(242,240,229,${alpha})`;
				ctx.beginPath();
				ctx.arc(x, y, star.r, 0, TAU);
				ctx.fill();
			}
		}

		const hiddenSun = V('sunY') > 1
			? clamp((1.25 - V('sunY')) / 0.25)
			: 1;
		if (hiddenSun > 0) {
			radialGlow(sunX, sunY, glowRadius, sunRgb, 0.25 * hiddenSun, 0.34 * hiddenSun);
			ctx.fillStyle = rgba(sunRgb, 0.82 * hiddenSun);
			ctx.beginPath();
			ctx.arc(sunX, sunY, discRadius, 0, TAU);
			ctx.fill();
		}

		const moonAlpha = V('moon');
		if (moonAlpha > 0.002) {
			const moonX = W * 0.22;
			const moonY = horizon * 0.25;
			const moonRadius = Math.max(7, size * 0.017);
			radialGlow(moonX, moonY, moonRadius * 5.5, [205, 216, 246], moonAlpha * 0.13);
			ctx.fillStyle = `rgba(224,230,246,${moonAlpha * 0.72})`;
			ctx.beginPath();
			ctx.arc(moonX, moonY, moonRadius, 0, TAU);
			ctx.fill();
			ctx.fillStyle = `rgba(245,246,241,${moonAlpha * 0.2})`;
			ctx.beginPath();
			ctx.arc(moonX - moonRadius * 0.25, moonY - moonRadius * 0.25, moonRadius * 0.55, 0, TAU);
			ctx.fill();
		}
		ctx.restore();
	}

	function drawClouds() {
		const horizon = horizonY();
		const cloudRgb = mixRgb(colour('skyHor'), [245, 244, 239], 0.45);
		for (const cloud of clouds) {
			const width = W * cloud.w;
			const height = H * cloud.h;
			const wrap = W + width * 2;
			let x = (cloud.x * W + cloud.travel) % wrap;
			if (x < 0) x += wrap;
			x -= width;
			const y = cloud.y * horizon;

			ctx.save();
			ctx.translate(x, y);
			ctx.scale(width * 0.5, height);
			const gradient = ctx.createRadialGradient(0, 0, 0, 0, 0, 1);
			gradient.addColorStop(0, rgba(cloudRgb, cloud.alpha));
			gradient.addColorStop(0.55, rgba(cloudRgb, cloud.alpha * 0.65));
			gradient.addColorStop(1, rgba(cloudRgb, 0));
			ctx.fillStyle = gradient;
			ctx.beginPath();
			ctx.arc(0, 0, 1, 0, TAU);
			ctx.fill();
			ctx.restore();
		}
	}

	function drawBird() {
		if (!bird.active) return;
		const life = V('life');
		if (life <= 0.01) return;
		const progress = clamp(bird.t);
		const fade = Math.sin(progress * Math.PI);
		const baseX = bird.direction > 0
			? lerp(-45, W + 45, progress)
			: lerp(W + 45, -45, progress);
		const baseY = horizonY() * bird.y + Math.sin(progress * TAU) * H * 0.012;
		const count = life > 0.8 ? 3 : 1;
		const rgb = mixRgb(colour('hillNear'), [225, 226, 224], 0.2);
		ctx.strokeStyle = rgba(rgb, life * 0.48 * fade);
		ctx.lineWidth = 1.15;
		ctx.lineCap = 'round';

		for (let i = 0; i < count; i += 1) {
			const offsetX = i === 0 ? 0 : (i === 1 ? -27 : 25) * bird.direction;
			const offsetY = i === 0 ? 0 : (i === 1 ? 15 : 24);
			const x = baseX + offsetX;
			const y = baseY + offsetY;
			const flap = Math.sin(sceneTime * 1.8 + bird.phase + i * 0.7) * 3.2;
			ctx.beginPath();
			ctx.moveTo(x - 13, y + 2 + flap);
			ctx.quadraticCurveTo(x - 7, y - 5 - flap, x, y);
			ctx.quadraticCurveTo(x + 7, y - 5 - flap, x + 13, y + 2 + flap);
			ctx.stroke();
		}
	}

	function ridge(x, offset, seed) {
		const u = x + offset;
		return 0.5
			+ 0.24 * Math.sin(u * 0.0037 + seed)
			+ 0.12 * Math.sin(u * 0.0089 + seed * 1.7)
			+ 0.07 * Math.sin(u * 0.0181 + seed * 2.3)
			+ 0.04 * Math.sin(u * 0.037 + seed * 0.8)
			+ 0.02 * Math.sin(u * 0.071 + seed * 3.1);
	}

	function drawHill(rgb, amplitude, offset, seed) {
		const horizon = horizonY();
		ctx.fillStyle = cssRgb(rgb);
		ctx.beginPath();
		ctx.moveTo(0, horizon + 3);
		for (let x = 0; x <= W + 8; x += 8) {
			const height = (0.2 + 0.8 * ridge(x, offset, seed)) * amplitude;
			ctx.lineTo(x, horizon - height);
		}
		ctx.lineTo(W, horizon + 3);
		ctx.closePath();
		ctx.fill();
	}

	function drawHills() {
		drawHill(colour('hillFar'), H * 0.19, hillFarOffset, 1.7);
		drawHill(colour('hillNear'), H * 0.115, hillNearOffset, 4.2);
	}

	function drawWater() {
		const horizon = horizonY();
		const waterHeight = H - horizon;
		const waterRgb = colour('water');
		const gradient = ctx.createLinearGradient(0, horizon, 0, H);
		gradient.addColorStop(0, cssRgb(mixRgb(waterRgb, colour('skyHor'), 0.08)));
		gradient.addColorStop(1, cssRgb(shade(waterRgb, 0.48)));
		ctx.fillStyle = gradient;
		ctx.fillRect(0, horizon, W, waterHeight);

		const sunY = V('sunY');
		if (sunY <= 1.02) {
			const sunX = W * 0.72;
			const sunRgb = colour('sunCol');
			const reflectionWidth = W * 0.18;
			const strips = 22;
			for (let i = 0; i < strips; i += 1) {
				const unit = (i + 0.5) / strips * 2 - 1;
				const softness = Math.exp(-unit * unit * 2.8);
				const x = sunX + unit * reflectionWidth * 0.5;
				const stripWidth = reflectionWidth / strips + 1;
				const reflection = ctx.createLinearGradient(0, horizon, 0, H);
				reflection.addColorStop(0, rgba(sunRgb, 0.12 * softness));
				reflection.addColorStop(0.55, rgba(sunRgb, 0.035 * softness));
				reflection.addColorStop(1, rgba(sunRgb, 0));
				ctx.fillStyle = reflection;
				ctx.fillRect(x - stripWidth * 0.5, horizon, stripWidth, waterHeight);
			}
		}

		const wind = V('wind');
		const rippleCount = 8 + Math.floor(wind * 22);
		ctx.strokeStyle = rgba(mixRgb(waterRgb, colour('skyHor'), 0.45), 0.12 + wind * 0.05);
		ctx.lineWidth = 0.65;
		for (let i = 0; i < rippleCount; i += 1) {
			const depth = (i + 1) / (rippleCount + 1);
			const y = horizon + depth * waterHeight;
			const amplitude = (0.25 + 2.1 * wind) * (0.4 + depth);
			ctx.beginPath();
			for (let x = 0; x <= W + 30; x += 30) {
				const py = y + Math.sin(x * 0.018 + sceneTime * (0.25 + wind) + i * 1.9) * amplitude;
				if (x === 0) ctx.moveTo(x, py);
				else ctx.lineTo(x, py);
			}
			ctx.stroke();
		}

		const orbRgb = colour('orb');
		const dashCount = Math.max(12, Math.floor(waterHeight / 13));
		for (let i = 0; i < dashCount; i += 1) {
			const depth = (i + 0.5) / dashCount;
			const shimmer = 0.55 + 0.45 * Math.sin(sceneTime * 1.1 + i * 2.37);
			const y = horizon + 7 + depth * (waterHeight - 12);
			const spread = 3 + depth * 19;
			const x = orbX() + Math.sin(sceneTime * 0.65 + i * 1.71) * spread;
			const length = (7 + 22 * (1 - depth) + S.sync * 7) * (0.65 + shimmer * 0.35);
			ctx.strokeStyle = rgba(orbRgb, (0.045 + 0.1 * shimmer) * (1 - depth * 0.55));
			ctx.lineWidth = 0.8 + (1 - depth) * 0.55;
			ctx.beginPath();
			ctx.moveTo(x - length * 0.5, y);
			ctx.lineTo(x + length * 0.5, y);
			ctx.stroke();
		}
	}

	function drawRain() {
		const rain = V('rain');
		if (rain <= 0.002) return;
		const wind = V('wind');
		const slant = 0.08 + wind * 0.32;
		ctx.lineCap = 'round';
		for (const drop of rainDrops) {
			const x = drop.x * W;
			const y = drop.y * H;
			ctx.strokeStyle = `rgba(220,229,238,${rain * drop.alpha * 0.2})`;
			ctx.lineWidth = 0.65;
			ctx.beginPath();
			ctx.moveTo(x, y);
			ctx.lineTo(x - drop.length * slant, y - drop.length);
			ctx.stroke();
		}

		const horizon = horizonY();
		const waterHeight = H - horizon;
		ctx.strokeStyle = `rgba(225,232,238,${rain * 0.18})`;
		ctx.lineWidth = 0.7;
		for (let i = 0; i < 18; i += 1) {
			const seedX = ((i * 0.61803398875) % 1);
			const seedY = ((i * 0.38196601125 + 0.17) % 1);
			const age = (sceneTime * (0.55 + (i % 4) * 0.07) + i * 0.173) % 1;
			const x = seedX * W;
			const y = horizon + (0.08 + seedY * 0.86) * waterHeight;
			const radius = 2 + age * 12;
			ctx.globalAlpha = 1 - age;
			ctx.beginPath();
			ctx.ellipse(x, y, radius, radius * 0.19, 0, Math.PI * 0.08, Math.PI * 0.92);
			ctx.stroke();
			ctx.beginPath();
			ctx.ellipse(x, y, radius * 0.7, radius * 0.13, 0, Math.PI * 1.1, Math.PI * 1.85);
			ctx.stroke();
		}
		ctx.globalAlpha = 1;
	}

	function fillRibbon(width, rgb, alpha) {
		const step = Math.max(5, W / 180);
		ctx.beginPath();
		let first = true;
		for (let x = -step; x <= W + step; x += step) {
			const y = ribbonYAt(x) - width * 0.5;
			if (first) {
				ctx.moveTo(x, y);
				first = false;
			} else {
				ctx.lineTo(x, y);
			}
		}
		for (let x = W + step; x >= -step; x -= step) {
			ctx.lineTo(x, ribbonYAt(x) + width * 0.5);
		}
		ctx.closePath();
		ctx.fillStyle = rgba(rgb, alpha);
		ctx.fill();
	}

	function strokeRibbonPhase(rising, width, rgb, alpha, dotted) {
		const step = Math.max(4, W / 240);
		ctx.beginPath();
		let open = false;
		for (let x = -step; x <= W + step; x += step) {
			const matches = (phaseAt(x) < 0.4) === rising;
			if (!matches) {
				open = false;
				continue;
			}
			const y = ribbonYAt(x);
			if (!open) {
				ctx.moveTo(x, y);
				open = true;
			} else {
				ctx.lineTo(x, y);
			}
		}
		ctx.strokeStyle = rgba(rgb, alpha);
		ctx.lineWidth = width;
		ctx.lineCap = 'round';
		ctx.lineJoin = 'round';
		ctx.setLineDash(dotted ? [1.5, 9] : []);
		ctx.stroke();
		ctx.setLineDash([]);
	}

	function drawRibbon() {
		const visibility = ribbonVisibility();
		if (visibility <= 0.002) return;
		const base = mixRgb(colour('ribbon'), [255, 218, 169], S.sync * 0.32);
		const rising = mixRgb(base, [255, 252, 237], 0.16);
		const falling = mixRgb(base, [255, 185, 145], 0.25);
		const width = bandWidth();

		fillRibbon(width * 1.65, base, 0.022 * visibility);
		fillRibbon(width * 1.25, base, 0.038 * visibility);
		fillRibbon(width, base, (0.05 + S.sync * 0.018) * visibility);
		strokeRibbonPhase(true, width * 0.82, rising, 0.025 * visibility, false);
		strokeRibbonPhase(false, width * 0.82, falling, 0.016 * visibility, false);
		strokeRibbonPhase(true, 1.35, rising, 0.5 * visibility, true);
		strokeRibbonPhase(false, 1.1, falling, 0.29 * visibility, true);
	}

	function drawSeeds() {
		const visibility = ribbonVisibility();
		if (visibility <= 0.002) return;
		const rgb = colour('orb');
		for (const seed of seeds) {
			if (seed.x < -20 || seed.x > W + 35) continue;
			const y = ribbonYAt(seed.x);
			const fadeIn = clamp(seed.age / 1.2);
			const alpha = fadeIn * clamp(seed.fade) * visibility;
			radialGlow(seed.x, y, 9 + S.sync * 2, rgb, alpha * 0.19, alpha * 0.5);
			ctx.fillStyle = rgba(rgb, alpha * 0.65);
			ctx.beginPath();
			ctx.arc(seed.x, y, 1.5, 0, TAU);
			ctx.fill();
		}
	}

	function drawFog() {
		const fog = V('fog');
		if (fog <= 0.002) return;
		const fogRgb = mixRgb(colour('skyHor'), [245, 244, 238], 0.55);
		const horizon = horizonY();

		const vertical = ctx.createLinearGradient(0, 0, 0, H);
		vertical.addColorStop(0, rgba(fogRgb, 0));
		vertical.addColorStop(0.3, rgba(fogRgb, fog * 0.035));
		vertical.addColorStop(0.59, rgba(fogRgb, fog * 0.28));
		vertical.addColorStop(0.66, rgba(fogRgb, fog * 0.52));
		vertical.addColorStop(0.74, rgba(fogRgb, fog * 0.24));
		vertical.addColorStop(1, rgba(fogRgb, fog * 0.035));
		ctx.fillStyle = vertical;
		ctx.fillRect(0, 0, W, H);

		const ahead = ctx.createLinearGradient(0, 0, W, 0);
		ahead.addColorStop(0, rgba(fogRgb, 0));
		ahead.addColorStop(0.24, rgba(fogRgb, fog * 0.015));
		ahead.addColorStop(0.43, rgba(fogRgb, fog * 0.13));
		ahead.addColorStop(0.7, rgba(fogRgb, fog * 0.42));
		ahead.addColorStop(1, rgba(fogRgb, fog * 0.72));
		ctx.fillStyle = ahead;
		// fade the far-ahead fog in from the top (no hard edge): stacked strips with eased alpha
		const strips = 24;
		const prevAlpha = ctx.globalAlpha;
		for (let i = 0; i < strips; i += 1) {
			const y0 = (H * i) / strips;
			const mid = (i + 0.5) / strips;
			const w = mid < 0.66 ? Math.pow(mid / 0.66, 1.6) : 1 - 0.55 * ((mid - 0.66) / 0.34);
			ctx.globalAlpha = prevAlpha * clamp(w);
			ctx.fillRect(0, y0, W, H / strips + 1);
		}
		ctx.globalAlpha = prevAlpha;

		for (let i = 0; i < 3; i += 1) {
			const y = horizon + (i - 1) * H * 0.055
				+ Math.sin(sceneTime * 0.035 + i * 2) * H * 0.012;
			const layer = ctx.createLinearGradient(0, y - H * 0.055, 0, y + H * 0.055);
			layer.addColorStop(0, rgba(fogRgb, 0));
			layer.addColorStop(0.5, rgba(fogRgb, fog * (0.055 + i * 0.018)));
			layer.addColorStop(1, rgba(fogRgb, 0));
			ctx.fillStyle = layer;
			ctx.fillRect(0, y - H * 0.055, W, H * 0.11);
		}
	}

	function drawCalmReward() {
		if (calmFx <= 0 && !calmBursts.length) return;
		const warm = [255, 214, 150];
		if (calmFx > 0) {
			radialGlow(orbX(), orbY, H * (0.12 + 0.35 * (1 - calmFx)), warm, 0.22 * calmFx, 0.35 * calmFx);
			radialGlow(W * 0.5, horizonY(), W * 0.6, warm, 0.1 * calmFx, 0.14 * calmFx);
		}
		for (const b of calmBursts) {
			const a = Math.min(1, b.life / 1.5);
			radialGlow(b.x, b.y, 7, warm, 0.18 * a, 0.6 * a);
		}
	}

	function drawGatheredLights() {
		const rgb = colour('orb');
		for (const light of skyLights) {
			const x = light.nx * W + Math.sin(sceneTime * 0.18 + light.phase) * 3;
			const y = light.ny * horizonY() + Math.cos(sceneTime * 0.14 + light.phase) * 2;
			const pulse = 0.75 + 0.25 * Math.sin(sceneTime * 0.45 + light.phase);
			radialGlow(x, y, 6 + light.size * 2, rgb, 0.07 * pulse, 0.22 * pulse);
			ctx.fillStyle = rgba(rgb, 0.3 * pulse);
			ctx.beginPath();
			ctx.arc(x, y, light.size * 0.65, 0, TAU);
			ctx.fill();
		}
		for (const mote of motes) {
			const alpha = clamp(1 - Math.max(0, mote.t - 0.8) / 0.2);
			radialGlow(mote.x, mote.y, 14, rgb, 0.2 * alpha, 0.55 * alpha);
			ctx.fillStyle = rgba([255, 250, 231], 0.72 * alpha);
			ctx.beginPath();
			ctx.arc(mote.x, mote.y, 1.8, 0, TAU);
			ctx.fill();
		}
	}

	function drawOrb() {
		const x = orbX();
		const rgb = mixRgb(colour('orb'), [255, 229, 187], S.sync * 0.18);
		const worldWave = wave(S.worldPhase);

		if (trail.length > 1) {
			ctx.lineCap = 'round';
			for (let i = 1; i < trail.length; i += 1) {
				const a = trail[i - 1];
				const b = trail[i];
				const ageA = sceneTime - a.time;
				const ageB = sceneTime - b.time;
				const fade = clamp(1 - ageA / 3) * 0.35;
				ctx.strokeStyle = rgba(rgb, fade);
				ctx.lineWidth = 2;
				ctx.beginPath();
				ctx.moveTo(x - ageA * pathSpeed(), a.y);
				ctx.lineTo(x - ageB * pathSpeed(), b.y);
				ctx.stroke();
			}
		}

		const glowRadius = bandWidth() * (1.05 + 0.28 * worldWave + 0.55 * S.sync);
		radialGlow(
			x,
			orbY,
			glowRadius,
			rgb,
			0.18 + S.sync * 0.1,
			0.32 + S.sync * 0.12,
		);

		const coreRadius = H * 0.011 + worldWave * 2.2 + S.sync * 2.5;
		const core = ctx.createRadialGradient(
			x - coreRadius * 0.25,
			orbY - coreRadius * 0.3,
			0,
			x,
			orbY,
			coreRadius * 1.8,
		);
		core.addColorStop(0, 'rgba(255,253,243,.96)');
		core.addColorStop(0.35, rgba(rgb, 0.92));
		core.addColorStop(1, rgba(rgb, 0));
		ctx.fillStyle = core;
		ctx.beginPath();
		ctx.arc(x, orbY, coreRadius * 1.8, 0, TAU);
		ctx.fill();
	}

	function drawVignette() {
		const radius = Math.max(W, H) * 0.76;
		const gradient = ctx.createRadialGradient(
			W * 0.5,
			H * 0.43,
			Math.min(W, H) * 0.2,
			W * 0.5,
			H * 0.43,
			radius,
		);
		gradient.addColorStop(0, 'rgba(4,7,18,0)');
		gradient.addColorStop(0.72, 'rgba(4,7,18,.025)');
		gradient.addColorStop(1, 'rgba(4,7,18,.2)');
		ctx.fillStyle = gradient;
		ctx.fillRect(0, 0, W, H);
	}

	function draw() {
		ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
		ctx.globalAlpha = 1;
		ctx.globalCompositeOperation = 'source-over';
		ctx.setLineDash([]);
		ctx.clearRect(0, 0, W, H);

		drawSky();
		drawCelestialBodies();
		drawClouds();
		drawBird();
		drawHills();
		drawWater();
		drawHome();
		drawRibbon();
		drawSeeds();
		drawRain();
		drawFog();
		drawGatheredLights();
		drawCalmReward();
		drawOrb();
		drawVignette();
	}

	// The destination: a small warm light on the far shore that draws closer as the session
	// goes on, so the walk visibly has an end. It sits on the horizon and is mirrored in the water.
	function drawHome() {
		if (S.state === 'setup') return;
		const horizon = horizonY();
		const x = W * (1.06 - 0.4 * S.e);
		const y = horizon - H * 0.012;
		const warm = [255, 214, 150];
		const near = 0.55 + 0.45 * S.e;
		radialGlow(x, y, H * (0.035 + 0.05 * S.e), warm, 0.22 * near, 0.5 * near);
		ctx.fillStyle = rgba([255, 244, 220], 0.9 * near);
		ctx.beginPath();
		ctx.arc(x, y, Math.max(1.5, H * 0.0035 * (1 + S.e)), 0, TAU);
		ctx.fill();
		for (let i = 0; i < 7; i += 1) {
			const ry = horizon + H * 0.012 + i * H * 0.014;
			const w = H * (0.018 - i * 0.0016) * (1 + 0.4 * Math.sin(sceneTime * 1.3 + i));
			ctx.fillStyle = rgba(warm, (0.32 - i * 0.04) * near);
			ctx.fillRect(x - w / 2, ry, w, Math.max(1, H * 0.003));
		}
	}

	function frame(now) {
		if (destroyed) return;
		const dt = clamp((now - lastFrame) / 1000, 0, 0.05);
		lastFrame = now;
		update(dt);
		draw();
		raf = win.requestAnimationFrame(frame);
	}

	listen(beginButton, 'click', begin);
	listen(finishButton, 'click', startArrival);
	listen(soundButton, 'click', toggleSound);
	listen(fullscreenButton, 'click', toggleFullscreen);
	listen(easyInput, 'change', () => {
		if (S.state === 'setup') S.auto = easyInput.checked;
	});

	listen(collectButton, 'click', () => {
		if (!result) return;
		collectButton.disabled = true;
		if (typeof onComplete === 'function') onComplete({ ...result });
	});
	listen(leaveButton, 'click', () => {
		leaveButton.disabled = true;
		if (typeof onExit === 'function') onExit();
	});

	listen(canvas, 'pointerdown', (event) => {
		if (S.state !== 'play') return;
		if (event.pointerType === 'mouse' && event.button !== 0) return;
		event.preventDefault();
		activePointer = event.pointerId;
		pointerHeld = true;
		try {
			canvas.setPointerCapture(event.pointerId);
		} catch (_) {
			// Pointer capture is not essential.
		}
		rootEl.focus({ preventScroll: true });
		refreshHolding();
	});

	function releasePointer(event) {
		if (activePointer === null || event.pointerId !== activePointer) return;
		pointerHeld = false;
		activePointer = null;
		refreshHolding();
	}

	listen(win, 'pointerup', releasePointer);
	listen(win, 'pointercancel', releasePointer);
	listen(win, 'blur', clearInput);

	listen(win, 'keydown', (event) => {
		if (event.code === 'KeyF' && !event.repeat) {
			event.preventDefault();
			toggleFullscreen();
			return;
		}
		if (S.state !== 'play') return;
		if (!['Space', 'KeyW', 'ArrowUp'].includes(event.code)) return;
		const target = event.target;
		if (target && target.closest && target.closest('button, input, label')) return;
		if (event.code === 'Space' || event.code === 'ArrowUp') event.preventDefault();
		if (!heldCodes.has(event.code)) {
			heldCodes.add(event.code);
			refreshHolding();
		}
	});

	listen(win, 'keyup', (event) => {
		if (event.code === 'Space' && S.state === 'play') {
			const target = event.target;
			if (!target || !target.closest || !target.closest('button, input, label')) {
				event.preventDefault();
			}
		}
		if (heldCodes.delete(event.code)) refreshHolding();
	});

	if (win.ResizeObserver) {
		resizeObserver = new win.ResizeObserver(resize);
		resizeObserver.observe(rootEl);
	}
	listen(win, 'resize', resize);

	if (win.location && win.location.search.includes('debug')) {
		win.__dr = { S, mic, heart, calm };
	}

	resize();
	orbY = ribbonYAt(orbX());
	raf = win.requestAnimationFrame(frame);

	return {
		unmount() {
			if (destroyed) return;
			destroyed = true;
			win.cancelAnimationFrame(raf);
			mic.stop();
			heart.disconnect();
			cues?.close();
			for (const remove of listeners.splice(0)) remove();
			if (resizeObserver) {
				resizeObserver.disconnect();
				resizeObserver = null;
			}
			if (audio) {
				try {
					const promise = audio.ctx.close();
					if (promise && promise.catch) promise.catch(() => {});
				} catch (_) {
					// The context may already be closed.
				}
				audio = null;
			}
			if (doc.fullscreenElement === rootEl) {
				try {
					const promise = doc.exitFullscreen?.();
					if (promise && promise.catch) promise.catch(() => {});
				} catch (_) {
					// Fullscreen may already have been exited by the host.
				}
			}
			if (win.__dr && win.__dr.S === S) delete win.__dr;
			rootEl.remove();
			container.replaceChildren();
		},
	};
}
