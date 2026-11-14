// Game registry. Adding a game = adding an entry here (and a module exporting `mount`).
//
// A game module has the shape:
//   export function mount(container, { onComplete, onExit }) -> { unmount() }
// and calls onComplete({ ...stats }) exactly once when the player finishes.
// `reward` describes what finishing contributes to the garden; the garden store
// stores contributions generically, so future games can hand out flowers or bushes.

export const GAMES = [
  {
    id: 'breath-dive',
    title: 'Breath Dive',
    description: 'Breathe with a pixel diver and bring a quiet reef to life.',
    thumb: 'dive',
    available: true,
    reward: { type: 'tree' },
    load: () => import('../games/breathdive/index.js'),
  },
  {
    id: 'mindful-tiles',
    title: 'Mindful Tiles',
    description: 'Match. Breathe. Relax.',
    thumb: 'night',
    available: false,
    reward: { type: 'tree' },
  },
  {
    id: 'drift',
    title: 'Drift',
    description: 'Guide one small light across a quiet evening.',
    thumb: 'river',
    available: true,
    reward: { type: 'tree' },
    load: () => import('../games/drift/index.js'),
  },
];
