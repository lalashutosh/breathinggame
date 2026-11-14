// Game registry. Adding a game = adding an entry here (and a module exporting `mount`).
//
// A game module has the shape:
//   export function mount(container, { onComplete, onExit }) -> { unmount() }
// and calls onComplete({ ...stats }) exactly once when the player finishes.
// `reward` describes what finishing contributes to the garden; the garden store
// stores contributions generically, so future games can hand out flowers or bushes.

// ΑΝΑΣΑ: one game, three modes. Ids stay stable so saved gardens and rewards keep working.
export const GAMES = [
  {
    id: 'drift',
    title: 'Minimalist',
    description: 'One small light over a quiet lake. Follow it home.',
    thumb: 'drift',
    available: true,
    reward: { type: 'tree' },
    load: () => import('../games/drift/index.js'),
  },
  {
    id: 'breath-dive',
    title: 'Retro',
    description: 'A pixel diver and a quiet reef that wakes as you breathe.',
    thumb: 'dive',
    available: true,
    reward: { type: 'tree' },
    load: () => import('../games/breathdive/index.js'),
  },
  {
    id: 'greenfold',
    title: 'Immersive',
    description: 'Walk a golden valley and gather a few stray sheep.',
    thumb: 'valley',
    available: true,
    reward: { type: 'tree' },
    load: () => import('../games/greenfold/index.js'),
  },
];
