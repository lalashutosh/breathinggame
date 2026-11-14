// Drift moods: one horizon, a slow gradient, one living thing.
// Every value is a [start, end] pair, eased by session progress e. The scene starts where the
// player is (iso principle) and drifts toward its goal: wind drops, fog lifts, the sun rises,
// the night deepens.

export const MOODS = {
  quick: {
    label: 'Just drift', sub: 'a quiet evening',
    skyTop: ['#2b3a67', '#141a3e'], skyMid: ['#c9708a', '#8a4f7a'], skyHor: ['#ffc98f', '#ff9f6e'],
    hillFar: ['#5a4a72', '#3a2f58'], hillNear: ['#2e2648', '#1c1734'], water: ['#3a3560', '#1e1a3c'],
    ribbon: ['#fff1d6', '#ffe2b0'], orb: ['#ffd38a', '#ffb070'],
    sunY: [0.62, 0.86], sunCol: ['#ffe1a8', '#ffb37a'], moon: [0, 0], stars: [0, 0.5],
    fog: [0.1, 0.05], wind: [0.3, 0.1], rain: [0, 0], life: [0.6, 0.9],
    period: [4.6, 10],
    intro: 'Evening over still water.',
    arrive: 'The sun is down. The first stars are out.',
    step: 'One small thing: open a window and let the real sky in for a minute.',
  },
  anxious: {
    label: 'Anxious', sub: 'racing, on edge',
    skyTop: ['#1c2433', '#243056'], skyMid: ['#3a4a63', '#b0688a'], skyHor: ['#6f8399', '#f6b48a'],
    hillFar: ['#3a4658', '#5a4a72'], hillNear: ['#1e2632', '#2a2244'], water: ['#2a3444', '#3a3560'],
    ribbon: ['#d6e2ee', '#fff0d0'], orb: ['#dfe8f2', '#ffcf8a'],
    sunY: [1.2, 0.8], sunCol: ['#b9c6d6', '#ffd9a8'], moon: [0, 0], stars: [0, 0.2],
    fog: [0.25, 0.05], wind: [1, 0.08], rain: [0.9, 0], life: [0, 0.7],
    period: [3.4, 10],
    intro: 'Wind and rain over the water.',
    arrive: 'The wind has dropped. A still, golden evening.',
    step: 'One small thing: put the kettle on, and stay with it while it warms.',
  },
  overwhelmed: {
    label: 'Overwhelmed', sub: 'too much at once',
    skyTop: ['#c3cbd2', '#8fb0c2'], skyMid: ['#d4dadf', '#cfe0dc'], skyHor: ['#e4e7ea', '#f3ead8'],
    hillFar: ['#d0d6db', '#9fb6be'], hillNear: ['#c6cdd3', '#6f8f9c'], water: ['#d7dde1', '#9ab6c0'],
    ribbon: ['#ffffff', '#ffffff'], orb: ['#fffaf0', '#fff1d6'],
    sunY: [1.2, 1.2], sunCol: ['#ffffff', '#fff6dc'], moon: [0, 0], stars: [0, 0],
    fog: [0.9, 0.15], wind: [0.1, 0.05], rain: [0, 0], life: [0, 0.4],
    period: [4, 10],
    intro: 'Thick fog. Only the light, and the next few steps.',
    arrive: 'The fog has lifted. One hill, the water, the sky.',
    step: 'One small thing: pick a single item near you and put it where it belongs.',
  },
  low: {
    label: 'Low', sub: 'heavy, flat',
    skyTop: ['#1b2233', '#3f6fb0'], skyMid: ['#39435a', '#f7a072'], skyHor: ['#5d667a', '#ffe3a3'],
    hillFar: ['#2a3042', '#7a6a8a'], hillNear: ['#161b28', '#3a3560'], water: ['#1e2433', '#5a6fa0'],
    ribbon: ['#c8d0dc', '#fff3d0'], orb: ['#c8d0dc', '#ffd38a'],
    sunY: [1.15, 0.5], sunCol: ['#ffb38a', '#fff3c4'], moon: [0, 0], stars: [0.5, 0],
    fog: [0.4, 0.05], wind: [0.12, 0.2], rain: [0, 0], life: [0, 1],
    period: [4.6, 8],
    intro: 'Grey water before dawn.',
    arrive: 'The sun is up. Warm light, and birds over the water.',
    step: 'One small thing: open the curtains, or step outside for two minutes.',
  },
  restless: {
    label: 'Restless', sub: "can't switch off",
    skyTop: ['#0c1230', '#04060f'], skyMid: ['#1c2752', '#0a0f24'], skyHor: ['#3a4674', '#141a36'],
    hillFar: ['#1a2244', '#0a0e1e'], hillNear: ['#0c1128', '#04060f'], water: ['#141c3a', '#05070f'],
    ribbon: ['#d8def8', '#7a84a8'], orb: ['#eef0ff', '#b8c0e8'],
    sunY: [1.2, 1.2], sunCol: ['#e9ecff', '#c9cfee'], moon: [1, 0.35], stars: [0.9, 0.4],
    fog: [0.15, 0.1], wind: [0.25, 0.04], rain: [0, 0], life: [0.3, 0],
    period: [4.2, 11],
    intro: 'A moonlit lake, late at night.',
    arrive: 'Dark and still. Time to rest.',
    step: 'One small thing: put the phone face down, across the room.',
  },
};

export const MOOD_ORDER = ['quick', 'anxious', 'overwhelmed', 'low', 'restless'];

/** Asymmetric world wave: 40% rise, 60% fall. Returns 0..1. */
export function wave(ph) {
  const r = 0.4;
  return ph < r ? 0.5 - 0.5 * Math.cos((Math.PI * ph) / r) : 0.5 + 0.5 * Math.cos((Math.PI * (ph - r)) / (1 - r));
}
