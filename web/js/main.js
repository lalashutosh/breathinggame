// Wires the garden, the game panel and the reward flow together.
import { GAMES } from './config/games.js';
import { Garden, renderStageCard, randomKind } from './garden/garden.js';
import { createGardenStore, rewards } from './garden/store.js';
import { KINDS, TREES, SPROUT_ICON } from './garden/sprites.js';
import { renderGamePanel } from './games/panel.js';
import { openModal, toast } from './ui/ui.js';

// ?debug=1 surfaces runtime errors in the page (handy for headless checks)
if (new URLSearchParams(location.search).has('debug')) {
  const dbg = document.getElementById('debug');
  const log = (m) => { dbg.hidden = false; dbg.textContent += m + '\n'; };
  window.addEventListener('error', (e) => log(`error: ${e.message} @ ${e.filename}:${e.lineno}`));
  window.addEventListener('unhandledrejection', (e) => log(`rejection: ${e.reason?.stack || e.reason}`));
}

const $ = (id) => document.getElementById(id);
const els = {
  canvas: $('garden-canvas'), hint: $('garden-hint'), status: $('garden-status'), actions: $('garden-actions'),
  total: $('stat-total'), statLabel: document.querySelector('#garden-stat .stat-label'), me: $('me-count'),
  list: $('game-list'), stages: $('stages'), storage: $('storage-note'),
};

const MINE_KEY = 'mindplay.mine.v1';
const mine = {
  list() { try { return JSON.parse(localStorage.getItem(MINE_KEY) || '[]'); } catch { return []; } },
  add(id) { const l = this.list(); l.push(id); try { localStorage.setItem(MINE_KEY, JSON.stringify(l)); } catch {} },
};

const store = await createGardenStore();
const initial = await store.load();

let activeReward = null;      // reward being planted right now
let busy = false;

const garden = new Garden(els.canvas, { onPick: (slot) => plantAt(slot) });
document.getElementById('scene').dataset.tod = garden.tod;
garden.setContributions(initial, { animateNew: false });
store.subscribe((list) => { if (busy) return; /* plantAt() applies its own update */ garden.setContributions(list); updateStats(); });

// ----------------------------------------------------------- stats & footer
function updateStats() {
  const n = garden.count;
  els.total.textContent = String(n);
  const [sprouts, saplings, trees] = garden.stageCounts();
  els.statLabel.textContent = n === 1 ? 'tree planted together' : 'trees planted together';
  els.statLabel.textContent += ` · ${trees} blooming`;
  els.statLabel.title = `${sprouts} sprouting · ${saplings} growing · ${trees} blooming`;
  const myIds = new Set(mine.list());
  const myCount = garden.items.filter((c) => myIds.has(c.id)).length;
  els.me.textContent = `${myCount} ${myCount === 1 ? 'tree' : 'trees'}`;
  document.getElementById('me').hidden = myCount === 0;
}

function button(label, cls, onClick, badge) {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = `btn ${cls}`;
  b.textContent = label;
  if (badge) { const s = document.createElement('span'); s.className = 'n'; s.textContent = badge; b.appendChild(s); }
  b.addEventListener('click', onClick);
  return b;
}

function refreshFooter() {
  const pending = rewards.count();
  els.actions.innerHTML = '';
  els.status.classList.toggle('is-live', !!garden.planting || pending > 0);
  if (garden.planting) {
    const kind = KINDS[garden.planting.kind]?.label.toLowerCase() || 'new';
    els.status.textContent = `Pick a spot inside the fence for your ${kind} tree.`;
    els.actions.append(
      button('Plant it for me', 'btn-primary', autoPlant),
      button('Not now', 'btn-ghost', cancelPlanting),
    );
    els.hint.hidden = false;
    els.hint.textContent = 'Click a spot inside the fence';
  } else if (pending > 0) {
    els.status.textContent = pending === 1 ? 'You have a sapling ready to plant.' : `You have ${pending} saplings ready to plant.`;
    els.actions.append(button('Plant your tree', 'btn-primary', startPlanting, pending > 1 ? String(pending) : null));
    els.hint.hidden = true;
  } else {
    els.status.textContent = 'Finish a game to earn a tree.';
    els.hint.hidden = true;
  }
}

// ----------------------------------------------------------- planting flow
function startPlanting() {
  const r = rewards.list()[0];
  if (!r) return refreshFooter();
  if (!garden.freeSlots.length) { toast('The garden is full for now. A new field opens soon.'); return; }
  activeReward = r;
  garden.enterPlanting(r.kind || randomKind(r.id));
  refreshFooter();
  document.getElementById('garden').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}
function cancelPlanting() {
  activeReward = null;
  garden.exitPlanting();
  refreshFooter();
}
function autoPlant() {
  const slot = garden.suggestSlot();
  if (!slot) return toast('The garden is full for now. A new field opens soon.');
  plantAt(slot);
}
async function plantAt(slot) {
  if (!garden.planting || busy) return;
  busy = true;
  const kind = garden.planting.kind;
  try {
    const c = await store.plant({ type: activeReward?.type || 'tree', kind, slot, gameId: activeReward?.gameId || null });
    rewards.take();
    mine.add(c.id);
    activeReward = null;
    garden.exitPlanting();
    garden.setContributions(store.items, { celebrateId: c.id });
    updateStats();
    toast(`Your ${KINDS[kind].label.toLowerCase()} tree is in the garden. Watch it grow.`, { icon: TREES[kind][0].img });
  } catch (e) {
    if (e.code === 'slot_taken') { toast('Someone just planted there. Pick another spot.'); garden.setContributions(store.items); }
    else toast(`Could not plant: ${e.message}`);
  } finally {
    busy = false;
    refreshFooter();
  }
}

// ----------------------------------------------------------- games
let gameInstance = null;
async function playGame(game) {
  const modal = openModal({
    title: game.title, subtitle: 'Finish to earn a sapling',
    onClose: () => { if (gameInstance) { gameInstance.unmount(); gameInstance = null; } },
  });
  modal.body.innerHTML = '<p style="padding:24px;font-weight:700">Loading…</p>';
  try {
    const mod = await game.load();
    modal.body.innerHTML = '';
    gameInstance = mod.mount(modal.body, {
      onComplete: (result) => {
        const kind = randomKind(`${game.id}:${Date.now()}`);
        rewards.add({ ...game.reward, kind, gameId: game.id, result });
        if (gameInstance) { gameInstance.unmount(); gameInstance = null; }
        showReward(modal, kind);
        refreshFooter();
      },
      onExit: () => modal.close(),
    });
  } catch (e) {
    modal.body.innerHTML = `<p style="padding:24px">Could not load this game: ${e.message}</p>`;
  }
}

function showReward(modal, kind) {
  modal.setTitle('You earned a sapling', 'thank you for playing');
  const spr = TREES[kind][1].img;
  modal.body.innerHTML = `
    <div class="reward">
      <canvas width="${spr.width * 6}" height="${spr.height * 6}" aria-hidden="true"></canvas>
      <h3>One ${KINDS[kind].label.toLowerCase()} sapling</h3>
      <p>It is yours to plant. Pick a spot in the community garden and it will grow as more neighbours play.</p>
      <div class="row">
        <button class="btn btn-primary" type="button" data-plant>Plant it now</button>
        <button class="btn" type="button" data-later>Keep it for later</button>
      </div>
    </div>`;
  const c = modal.body.querySelector('canvas');
  const ctx = c.getContext('2d'); ctx.imageSmoothingEnabled = false; ctx.drawImage(spr, 0, 0, c.width, c.height);
  modal.body.querySelector('[data-plant]').focus();
  modal.body.querySelector('[data-plant]').addEventListener('click', () => { modal.close(); startPlanting(); });
  modal.body.querySelector('[data-later]').addEventListener('click', () => { modal.close(); toast('Your sapling is waiting in the garden panel.', { icon: SPROUT_ICON }); });
}

renderGamePanel(els.list, GAMES, { onPlay: playGame });

// ----------------------------------------------------------- "every tree has a story"
for (const [stage, title, sub] of [[0, 'Day 1', 'A little start'], [1, 'Growing', 'Taking shape'], [2, 'Blooming', 'Look how far']]) {
  const card = document.createElement('div');
  card.className = 'stage-card';
  const c = document.createElement('canvas');
  renderStageCard(c, 'apple', stage);
  card.append(c);
  const h = document.createElement('h3'); h.textContent = title;
  const p = document.createElement('p'); p.textContent = sub;
  card.append(h, p);
  els.stages.append(card);
}

els.storage.textContent = store.label === 'the shared server'
  ? 'This garden is shared: trees planted by other visitors appear here as they arrive.'
  : 'No server detected, so the garden is kept in this browser. Run python3 serve.py to share it.';

updateStats();
refreshFooter();

// deep link: ?play=<game id>
const wanted = new URLSearchParams(location.search).get('play');
if (wanted) { const g = GAMES.find((x) => x.id === wanted && x.available); if (g) playGame(g); }

// dev hook (debug mode only)
if (new URLSearchParams(location.search).has('debug')) {
  window.mindplay = { garden, store, rewards, GAMES, startPlanting, playGame, autoPlant };
}
