// Pixel sprites for the community garden.
// Every plant kind has three growth stages: 0 sprout, 1 sapling, 2 full tree.
import { makeSprite } from '../lib/pixel.js';

export const OUTLINE = '#2f2b26';

const COMMON = { K: OUTLINE, S: '#8c5b3b', s: '#a97250' };

/** Per-kind palettes. L highlight · G main · g mid · d shade · T/t trunk · F accent */
export const KINDS = {
  apple:  { label: 'Apple',  L: '#c3e39a', G: '#86bd5f', g: '#64a04a', d: '#44763a', T: '#9a6a3b', t: '#6f4a28', F: '#e2574a', petal: '#e2574a' },
  cherry: { label: 'Cherry', L: '#fbd6e4', G: '#f0a7c1', g: '#d97fa2', d: '#b35f84', T: '#8a5a3b', t: '#62402a', F: '#fff0f5', petal: '#f7c2d6' },
  birch:  { label: 'Birch',  L: '#e6f0a3', G: '#b7d36b', g: '#93b84f', d: '#6d8f3c', T: '#ece6d6', t: '#8d887a', F: '#b7d36b', petal: '#e6f0a3' },
  pine:   { label: 'Pine',   L: '#a6d67f', G: '#5f9d55', g: '#447f3f', d: '#2f5f33', T: '#7c5230', t: '#563720', F: '#5f9d55', petal: '#a6d67f' },
};
export const KIND_NAMES = Object.keys(KINDS);

const ROUND_FULL = [
  '.....KKKKK.....',
  '...KKLLLggKK...',
  '..KLLLGGGGgdK..',
  '.KLLGGGGGGGgdK.',
  '.KLGGGGFGGGgdK.',
  'KLGGGGGGGGGGgdK',
  'KGGGFGGGGGGFgdK',
  'KGGGGGGGGGGGgdK',
  'KgGGGGGGGGGgddK',
  '.KgGGGGFGGgddK.',
  '.KdgGGGGGgdddK.',
  '..KddgggdddK...',
  '...KKdddKKK....',
  '.....KTtK......',
  '.....KTtK......',
  '.....KTtK......',
  '....KTTtK......',
  '...KTTTttK.....',
];
const ROUND_SAPLING = [
  '...KKK...',
  '..KLLgK..',
  '.KLGGGgK.',
  '.KGGGGdK.',
  '..KgGdK..',
  '...KTK...',
  '...KTK...',
  '..KTtK...',
];
const SPROUT = [
  '.KK.KK.',
  'KLGKGgK',
  '.KGKGK.',
  '..KTK..',
  '..KTK..',
  '.KsSsK.',
  'KsSSSsK',
];
const PINE_FULL = [
  '......K......',
  '.....KLK.....',
  '.....KGK.....',
  '....KLGgK....',
  '....KGGgK....',
  '...KLGGggK...',
  '...KGGGggK...',
  '..KLGGGgggK..',
  '..KGGGGgggK..',
  '.KLGGGGggggK.',
  '.KGGGGGgggdK.',
  'KLGGGGGggdddK',
  'KGGGGggggdddK',
  '.KKKKKKKKKKK.',
  '.....KTtK....',
  '.....KTtK....',
  '....KTTtK....',
];
const PINE_SAPLING = [
  '...K...',
  '..KLK..',
  '..KGgK.',
  '.KLGgK.',
  '.KGGgdK',
  'KLGGggK',
  '.KKKKK.',
  '..KTtK.',
];

/** Sprite sheets by kind and stage, plus where the swaying canopy ends. */
export const TREES = {};
for (const [name, pal] of Object.entries(KINDS)) {
  const P = { ...COMMON, ...pal };
  const isPine = name === 'pine';
  // birch gets bark marks on the full trunk
  const full = isPine ? PINE_FULL : ROUND_FULL;
  TREES[name] = [
    { img: makeSprite(SPROUT, P), split: 3 },
    { img: makeSprite(isPine ? PINE_SAPLING : ROUND_SAPLING, P), split: isPine ? 7 : 5 },
    { img: makeSprite(full, P), split: isPine ? 14 : 13 },
  ];
  if (name === 'birch') {
    const ctx = TREES[name][2].img.getContext('2d');
    ctx.fillStyle = '#5a554b';
    ctx.fillRect(6, 14, 1, 1);
    ctx.fillRect(5, 16, 1, 1);
    ctx.fillRect(6, 17, 2, 1);
  }
}

/** Wild trees around the garden (not community contributions). */
const WILD_PALS = {
  oak:   { L: '#a9d37e', G: '#6ea65a', g: '#4f8a46', d: '#36683a', T: '#8a5a30', t: '#60401f', F: '#6ea65a' },
  pine:  { L: '#8fc771', G: '#4f8f4d', g: '#3a713b', d: '#285430', T: '#6e4a2a', t: '#4d321b', F: '#4f8f4d' },
  dark:  { L: '#7fb569', G: '#4a8a4c', g: '#356c3c', d: '#244f30', T: '#7a4f2a', t: '#52351c', F: '#4a8a4c' },
};
export const WILD_TREES = {
  oak:  { img: makeSprite(ROUND_FULL, { ...COMMON, ...WILD_PALS.oak }), split: 13 },
  dark: { img: makeSprite(ROUND_FULL, { ...COMMON, ...WILD_PALS.dark }), split: 13 },
  pine: { img: makeSprite(PINE_FULL, { ...COMMON, ...WILD_PALS.pine }), split: 14 },
  pineSmall: { img: makeSprite(PINE_SAPLING, { ...COMMON, ...WILD_PALS.pine }), split: 7 },
};

export const MOUND = makeSprite(['..ssSs..', '.sSSSSs.', 'sSSSSSSs'], { S: '#8c5b3b', s: '#a97250' });

export const ROCKS = [
  makeSprite(['..KKK..', '.KLGGK.', 'KLGGgdK', 'KGGgddK', '.KKKKK.'], { K: OUTLINE, L: '#cfcfc4', G: '#a9ab9f', g: '#8a8f84', d: '#646a63' }),
  makeSprite(['.KKK.', 'KLGgK', 'KGgdK', '.KKK.'], { K: OUTLINE, L: '#cfcfc4', G: '#a9ab9f', g: '#8a8f84', d: '#646a63' }),
];

export const BUSH = makeSprite([
  '...KKKKK...',
  '..KLLGGgK..',
  '.KLGGGGGgK.',
  'KLGGGGGggdK',
  'KGGGGGgggdK',
  '.KgGGggddK.',
  '..KKKKKKK..',
], { K: OUTLINE, L: '#b9dd8f', G: '#78b05b', g: '#5a9147', d: '#3f6e38' });

export const SIGN = makeSprite([
  'KKKKKKKKKKKKK',
  'KWWWWWWWWWWWK',
  'KWccccccWWWWK',
  'KWWWWWWWWWWWK',
  'KWWccccWcccWK',
  'KWWWWWWWWWWWK',
  'KKKKKKKKKKKKK',
  '.....KTtK....',
  '.....KTtK....',
  '.....KTtK....',
], { K: OUTLINE, W: '#ecdcb6', c: '#8a6a46', T: '#9a6a3b', t: '#6f4a28' });

export const BENCH = makeSprite([
  'KKKKKKKKKKKKKKK',
  'KTTTTTTTTTTTTTK',
  'KttKKKKKKKKKttK',
  '.KTTTTTTTTTTTK.',
  '.KtttttttttttK.',
  '.KtK.......KtK.',
  '.KtK.......KtK.',
], { K: OUTLINE, T: '#c99c62', t: '#9a6a3b' });

export const LANTERN = makeSprite([
  '.KKK.',
  'KYyYK',
  'KyyyK',
  'KYyYK',
  '.KKK.',
  '..K..',
  '..K..',
  '..K..',
  '..K..',
  '.KKK.',
], { K: OUTLINE, Y: '#f7d774', y: '#fff2b8' });

export const CLOUDS = [
  makeSprite([
    '......WWWW.......',
    '....WWWWWWWW.....',
    '..WWWWWWWWWWWWW..',
    '.WWWWWWWWWWWWWWW.',
    'WWWWWWWWWWWWWWWWW',
    '.wwwwwwwwwwwwwww.',
  ], { W: '#ffffff', w: '#dfeef2' }),
  makeSprite([
    '...WWWW....',
    '.WWWWWWWWW.',
    'WWWWWWWWWWW',
    '.wwwwwwwww.',
  ], { W: '#ffffff', w: '#dfeef2' }),
];

export const BIRD = [
  makeSprite(['K...K', '.K.K.', '..K..'], { K: '#3a4a5c' }),
  makeSprite(['..K..', '.K.K.', 'K...K'], { K: '#3a4a5c' }),
];

export function butterfly(color) {
  const P = { K: OUTLINE, O: color, o: '#fff6d6' };
  return [
    makeSprite(['O.K.O', 'OoKoO', '.OKO.'], P),
    makeSprite(['..K..', '.OKO.', '.OKO.'], P),
  ];
}

export const FROG = makeSprite(['.KK.KK.', 'KGWKGWK', 'KGGGGGK', '.KgggK.'], { K: OUTLINE, G: '#7fbf63', g: '#5d9b4c', W: '#ffffff' });

export const SPROUT_ICON = TREES.apple[0].img;
