// Breath Dive moods: same reef, different weather.
// Each mood starts by matching how the player arrives (iso principle) and drifts toward
// its goal as the dive goes on. Every value is a [start, end] pair, eased by progress e.
// Nature cues, not instructions: storms pass, silt settles, the sun rises, night deepens.

export const MOODS = {
  dive: {
    label: 'Just dive', sub: 'a quiet reef',
    water: [
      ['#123a5e', '#0f3254', '#0c2a49', '#0a233e', '#081c33', '#06162a', '#051022'],
      ['#3a9ad9', '#2f88c8', '#2676b5', '#1e64a0', '#17528a', '#114175', '#0c3260'],
    ],
    murkCol: '#0a2a44', murk: [0, 0], surge: [0.2, 0.08], rain: [0, 0], silt: [1, 1],
    beams: [0.6, 1.0], beamCol: ['#fff2c0', '#ffe0a0'], sun: [0, 0.6], moon: [0, 0], glow: [0, 0],
    life: [0.7, 1], dark: [0.4, 0], period: [4.6, 10],
    intro: 'The deep is dark and quiet.',
    arrive: 'Golden light. The reef is fully alive.',
    step: 'One small thing: open a window and let the real air in for a minute.',
  },
  anxious: {
    label: 'Anxious', sub: 'racing, on edge',
    water: [
      ['#3d5552', '#33494a', '#2a3e41', '#223438', '#1b2b30', '#152328', '#0f1b20'],
      ['#49b8d6', '#36a3c8', '#2a8dba', '#2077a8', '#196394', '#134f7e', '#0e3d68'],
    ],
    murkCol: '#3a4a48', murk: [0.35, 0], surge: [1, 0.06], rain: [1, 0], silt: [1.6, 0.8],
    beams: [0, 1.0], beamCol: ['#d8e4e8', '#fff0c8'], sun: [0, 0.5], moon: [0, 0], glow: [0, 0],
    life: [0.15, 0.9], dark: [0.25, 0], period: [3.4, 10],
    intro: 'A storm is rolling over the surface. Down here, it is quieter.',
    arrive: 'The storm has passed. The water is still and clear.',
    step: 'One small thing: put the kettle on, and stay with it while it warms.',
  },
  overwhelmed: {
    label: 'Overwhelmed', sub: 'too much at once',
    water: [
      ['#9fb3a8', '#93a89e', '#879c93', '#7a8f88', '#6d827c', '#5f7470', '#526763'],
      ['#7cc6d6', '#62b3c9', '#4b9fbb', '#3a8aab', '#2d7598', '#225f83', '#194c6e'],
    ],
    murkCol: '#c9d6cc', murk: [0.62, 0.04], surge: [0.12, 0.04], rain: [0, 0], silt: [3.2, 0.5],
    beams: [0.25, 0.6], beamCol: ['#f4f4ec', '#fff6dc'], sun: [0.15, 0.3], moon: [0, 0], glow: [0, 0],
    life: [0, 0.5], dark: [0, 0], period: [4, 10],
    intro: 'The water is thick with drifting silt. Nothing needs doing.',
    arrive: 'The silt has settled. Only a few things, gently in view.',
    step: 'One small thing: pick a single item near you and put it where it belongs.',
  },
  low: {
    label: 'Low', sub: 'heavy, flat',
    water: [
      ['#1a2a3a', '#162433', '#121f2c', '#0f1a26', '#0c1520', '#09111a', '#070d15'],
      ['#f2c38a', '#c9b392', '#8fb7c4', '#4f9cc0', '#2e7fae', '#1d6596', '#134e7c'],
    ],
    murkCol: '#0c1520', murk: [0.1, 0], surge: [0.1, 0.14], rain: [0, 0], silt: [0.6, 1.2],
    beams: [0, 1.3], beamCol: ['#c8d8e8', '#ffd28a'], sun: [0, 1], moon: [0, 0], glow: [0, 0],
    life: [0, 1], dark: [0.5, 0], period: [4.6, 8],
    intro: 'Cold, still water before dawn.',
    arrive: 'The sun is up. Warm light, and the reef is busy with life.',
    step: 'One small thing: open the curtains, or step outside for two minutes.',
  },
  restless: {
    label: 'Restless', sub: "can't switch off",
    water: [
      ['#1f3358', '#1a2c4e', '#152544', '#111f3a', '#0d1930', '#0a1426', '#070f1d'],
      ['#0a1224', '#08101f', '#070d1a', '#050b16', '#040812', '#03060e', '#02040a'],
    ],
    murkCol: '#02040a', murk: [0, 0], surge: [0.25, 0.04], rain: [0, 0], silt: [1, 0.4],
    beams: [0.4, 0.04], beamCol: ['#c9d6ff', '#8a98c8'], sun: [0, 0], moon: [1, 0.25], glow: [0.4, 1],
    life: [0.4, 0], dark: [0.2, 0.62], period: [4.2, 11],
    intro: 'A night dive. Moonlight on the water.',
    arrive: 'Dark and still. Only the soft glow of the plankton.',
    step: 'One small thing: put the phone face down, across the room.',
  },
};

export const MOOD_ORDER = ['dive', 'anxious', 'overwhelmed', 'low', 'restless'];

/** Asymmetric world wave: 40% rise (in), 60% fall (out). */
export function wave(ph) {
  const r = 0.4;
  return ph < r ? 0.5 - 0.5 * Math.cos((Math.PI * ph) / r) : 0.5 + 0.5 * Math.cos((Math.PI * (ph - r)) / (1 - r));
}
