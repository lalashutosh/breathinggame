// Wires the garden, the game panel and the reward flow together.
import { GAMES } from './config/games.js';
import { Garden, renderStageCard, randomKind } from './garden/garden.js';
import { createGardenStore, rewards, profile, run, friends, visitor, COMMUNITY } from './garden/store.js';
import { renderFriendsBlock, openInvite, openVisit, openJoin, listNames } from './community/community.js';
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
  statTitle: $('stat-title-text'), meLine: $('me'), friends: $('friends-block'),
};

const MINE_KEY = 'mindplay.mine.v1';
const mine = {
  list() { try { return JSON.parse(localStorage.getItem(MINE_KEY) || '[]'); } catch { return []; } },
  add(id) { const l = this.list(); l.push(id); try { localStorage.setItem(MINE_KEY, JSON.stringify(l)); } catch {} },
};

let store = null;             // the garden on screen (community, mine, or a friend's)
let unsubscribe = null;
let activeReward = null;      // reward being planted right now
let busy = false;

const garden = new Garden(els.canvas, { onPick: (slot) => plantAt(slot) });
document.getElementById('scene').dataset.tod = garden.tod;

// ----------------------------------------------------------- which garden is on screen
const view = () => {
  const id = store?.gardenId || COMMUNITY;
  const r = run.get();
  return { gardenId: id, meta: store?.meta, isMine: id !== COMMUNITY && id === profile.get().garden, helping: !!r && r.code === id };
};
const canPlantHere = () => { const v = view(); return v.gardenId === COMMUNITY || v.isMine || v.helping; };
const plantable = () => (canPlantHere() ? rewards.plantableIn(view().gardenId) : []);

const SEEN_KEY = 'mindplay.seen.v1';   // when I last looked at my own garden (for "while you were away")
let knownHelpers = null;

async function switchGarden(id, { quiet = false } = {}) {
  if (id === 'mine') {
    try { id = (await friends.ensureMyGarden()).code; } catch (e) { toast(`Could not open your garden: ${e.message}`); return false; }
  }
  const next = await createGardenStore(id);
  let list;
  try { list = await next.load(); }
  catch (e) {
    next.close();
    toast(e.code === 'not_found' ? 'No garden with that code. Check it with your friend.' : `Could not open that garden: ${e.message}`);
    return false;
  }
  if (garden.planting) cancelPlanting();
  unsubscribe && unsubscribe();
  store && store.close();
  store = next;
  knownHelpers = null;
  garden.setContributions(list, { animateNew: false });
  unsubscribe = store.subscribe((items) => {
    if (!busy) garden.setContributions(items); /* plantAt() applies its own update */
    noticeFriends(items);
    updateStats(); refreshFriends(); refreshFooter();
  });
  noticeFriends(list, { firstLook: true });
  const u = new URL(location.href);
  if (id === COMMUNITY) u.searchParams.delete('garden'); else u.searchParams.set('garden', id);
  u.searchParams.delete('join');
  history.replaceState(null, '', u);
  updateStats(); refreshFriends(); refreshFooter();
  if (!quiet && id !== COMMUNITY && !view().isMine) toast(view().helping ? `You’re in ${store.meta?.name || 'your friend’s garden'}.` : `Visiting ${store.meta?.name || 'a friend’s garden'}.`);
  return true;
}

/** In my own garden: greet friends who join and thank them for what they plant. */
function noticeFriends(items, { firstLook = false } = {}) {
  const v = view();
  if (!v.isMine) return;
  const helpers = v.meta?.helpers || [];
  if (knownHelpers) {
    for (const h of helpers) if (!knownHelpers.has(h.id)) toast(`${h.name} joined your garden. Their saplings will grow here.`, { icon: SPROUT_ICON });
  }
  knownHelpers = new Set(helpers.map((h) => h.id));
  let seen = {};
  try { seen = JSON.parse(localStorage.getItem(SEEN_KEY) || '{}'); } catch {}
  const since = seen[v.gardenId] || 0;
  const fresh = items.filter((c) => c.visitorId !== visitor.id && Date.parse(c.plantedAt) > since);
  if (fresh.length && since) {
    const names = [...new Set(fresh.map((c) => c.visitorName || 'A friend'))];
    toast(firstLook
      ? `While you were away, ${listNames(names)} planted ${fresh.length} ${fresh.length === 1 ? 'tree' : 'trees'} in your garden.`
      : `${listNames(names)} planted a ${KINDS[fresh[fresh.length - 1].kind]?.label.toLowerCase() || ''} tree in your garden.`,
    { icon: TREES[fresh[fresh.length - 1].kind]?.[0].img, ms: 5200 });
  }
  seen[v.gardenId] = Math.max(Date.now(), ...items.map((c) => Date.parse(c.plantedAt) || 0));
  try { localStorage.setItem(SEEN_KEY, JSON.stringify(seen)); } catch {}
}

/** Did a friend plant in my garden since I last looked? Then that is where the page opens. */
async function friendsPlantedSinceLastLook(code) {
  try {
    const s = await createGardenStore(code);
    const items = await s.load();
    s.close();
    const since = JSON.parse(localStorage.getItem(SEEN_KEY) || '{}')[code] || 0;
    return items.some((c) => c.visitorId !== visitor.id && Date.parse(c.plantedAt) > since);
  } catch { return false; }
}

function refreshFriends() {
  renderFriendsBlock(els.friends, view(), {
    onSwitch: (id) => switchGarden(id),
    onInvite: () => openInvite({ onOpenMine: (code) => switchGarden(code) }),
    onVisit: () => openVisit({ onVisit: (code) => (code === profile.get().garden ? switchGarden(code) : visitAndOffer(code)) }),
    onJoin: (code) => offerJoin(code),
    onLeave: leaveRun,
  });
}

async function offerJoin(code) {
  if (view().gardenId !== code && !(await switchGarden(code, { quiet: true }))) return;
  openJoin(store.meta || { code }, {
    onJoined: (meta) => {
      store.meta = { ...store.meta, ...meta };
      toast(`Welcome to ${meta.name}. Play a mode; your saplings grow here.`, { icon: SPROUT_ICON, ms: 5200 });
      refreshFriends(); updateStats(); refreshFooter();
    },
  });
}
async function visitAndOffer(code) {
  if (!(await switchGarden(code))) return;
  if (!view().isMine && !view().helping) offerJoin(code);
}
async function leaveRun() {
  const r = run.get();
  await friends.leave();
  const left = rewards.boundElsewhere('').find((b) => b.gardenId === r?.code);
  toast(`Thanks for helping ${r?.name || 'your friend'}.${left ? ' Saplings you already earned for them are still theirs to plant.' : ''}`);
  refreshFriends(); updateStats(); refreshFooter();
}
setInterval(() => friends.heartbeat(), 60e3);

// ----------------------------------------------------------- stats & footer
function updateStats() {
  const n = garden.count;
  els.total.textContent = String(n);
  const [sprouts, saplings, trees] = garden.stageCounts();
  const v = view();
  els.statTitle.textContent = v.gardenId === COMMUNITY ? 'Our Community Garden' : v.isMine ? (store.meta?.name || 'My garden') : (store.meta?.name || 'A friend’s garden');
  els.statLabel.textContent = v.gardenId === COMMUNITY ? (n === 1 ? 'tree planted together' : 'trees planted together') : (n === 1 ? 'tree growing here' : 'trees growing here');
  els.statLabel.textContent += ` · ${trees} blooming`;
  els.statLabel.title = `${sprouts} sprouting · ${saplings} growing · ${trees} blooming`;
  const myIds = new Set(mine.list());
  const myCount = garden.items.filter((c) => myIds.has(c.id) || c.visitorId === visitor.id).length;
  if (v.isMine) {
    const byFriends = garden.items.filter((c) => c.visitorId !== visitor.id).length;
    els.me.textContent = `${byFriends} planted by friends`;
    els.meLine.lastChild.textContent = '';
    els.meLine.hidden = byFriends === 0;
  } else {
    els.me.textContent = `${myCount} ${myCount === 1 ? 'tree' : 'trees'}`;
    els.meLine.lastChild.textContent = v.gardenId === COMMUNITY ? ' are yours' : ' from you';
    els.meLine.hidden = myCount === 0;
  }
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
  const pending = plantable().length;
  const v = view();
  const elsewhere = rewards.boundElsewhere(v.gardenId);
  els.actions.innerHTML = '';
  els.status.classList.toggle('is-live', !!garden.planting || pending > 0 || elsewhere.length > 0);
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
    const where = v.helping ? ` for ${store.meta?.name || 'your friend'}` : '';
    els.status.textContent = pending === 1 ? `You have a sapling ready to plant${where}.` : `You have ${pending} saplings ready to plant${where}.`;
    els.actions.append(button('Plant your tree', 'btn-primary', startPlanting, pending > 1 ? String(pending) : null));
    els.hint.hidden = true;
  } else if (elsewhere.length) {
    const e = elsewhere[0];
    els.status.textContent = `${e.n} ${e.n === 1 ? 'sapling is' : 'saplings are'} waiting for ${e.gardenName}.`;
    els.actions.append(button(`Go to ${e.gardenName}`, 'btn-primary', () => switchGarden(e.gardenId)));
    els.hint.hidden = true;
  } else {
    const any = rewards.count();
    els.status.textContent = v.helping ? `Finish a game to grow ${store.meta?.name || 'your friend’s garden'}.`
      : !canPlantHere() ? (any ? 'Join this garden’s run to plant your saplings here.' : 'Join this garden’s run and your saplings will grow here.')
      : 'Finish a game to earn a tree.';
    els.hint.hidden = true;
  }
}

// ----------------------------------------------------------- planting flow
function startPlanting() {
  const r = plantable()[0];
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
    rewards.take(activeReward?.id);
    mine.add(c.id);
    activeReward = null;
    garden.exitPlanting();
    garden.setContributions(store.items, { celebrateId: c.id });
    updateStats();
    const v = view();
    toast(v.helping ? `Your ${KINDS[kind].label.toLowerCase()} tree is growing in ${store.meta?.name || 'your friend’s garden'}. They’ll see it.`
      : `Your ${KINDS[kind].label.toLowerCase()} tree is in the garden. Watch it grow.`, { icon: TREES[kind][0].img });
  } catch (e) {
    if (e.code === 'slot_taken') { toast('Someone just planted there. Pick another spot.'); garden.setContributions(store.items); }
    else if (e.code === 'not_member') { toast('Your run in this garden has ended. Join again to keep planting here.'); run.end(); activeReward = null; garden.exitPlanting(); refreshFriends(); }
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
    title: `ΑΝΑΣΑ · ${game.title}`, subtitle: 'Finish to earn a sapling',
    onClose: () => { if (gameInstance) { gameInstance.unmount(); gameInstance = null; } },
  });
  modal.body.innerHTML = '<p style="padding:24px;font-weight:700">Loading…</p>';
  try {
    const mod = await game.load();
    modal.body.innerHTML = '';
    gameInstance = mod.mount(modal.body, {
      onComplete: (result) => {
        const kind = randomKind(`${game.id}:${Date.now()}`);
        const r = run.get();   // helping a friend: this sapling belongs to their garden
        rewards.add({ ...game.reward, kind, gameId: game.id, result, ...(r ? { gardenId: r.code, gardenName: r.name } : {}) });
        if (gameInstance) { gameInstance.unmount(); gameInstance = null; }
        showReward(modal, kind, r);
        refreshFooter();
      },
      onExit: () => modal.close(),
    });
  } catch (e) {
    modal.body.innerHTML = `<p style="padding:24px">Could not load this game: ${e.message}</p>`;
  }
}

function showReward(modal, kind, r) {
  modal.setTitle('You earned a sapling', r ? `for ${r.name}` : 'thank you for playing');
  const spr = TREES[kind][1].img;
  modal.body.innerHTML = `
    <div class="reward">
      <canvas width="${spr.width * 6}" height="${spr.height * 6}" aria-hidden="true"></canvas>
      <h3>One ${KINDS[kind].label.toLowerCase()} sapling</h3>
      <p>${r ? `You’re helping ${r.name.replace(/[<>&]/g, '')}, so it grows in their garden. Pick a spot and they’ll see who planted it.`
        : 'It is yours to plant. Pick a spot in the garden and it will grow as more neighbours play.'}</p>
      <div class="row">
        <button class="btn btn-primary" type="button" data-plant>Plant it now</button>
        <button class="btn" type="button" data-later>Keep it for later</button>
      </div>
    </div>`;
  const c = modal.body.querySelector('canvas');
  const ctx = c.getContext('2d'); ctx.imageSmoothingEnabled = false; ctx.drawImage(spr, 0, 0, c.width, c.height);
  modal.body.querySelector('[data-plant]').focus();
  modal.body.querySelector('[data-plant]').addEventListener('click', async () => {
    modal.close();
    if (r && view().gardenId !== r.code && !(await switchGarden(r.code, { quiet: true }))) return;
    startPlanting();
  });
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

// ----------------------------------------------------------- open the right garden
{
  const q = new URLSearchParams(location.search);
  const join = (q.get('join') || '').toUpperCase();
  const visit = (q.get('garden') || '').toUpperCase();
  const r = run.get();
  let opened = false;
  if (join) {
    if (join === profile.get().garden) opened = await switchGarden(join, { quiet: true });
    else if (r?.code === join) opened = await switchGarden(join);
    else if ((opened = await switchGarden(join, { quiet: true }))) offerJoin(join);
  } else if (visit) opened = await switchGarden(visit, { quiet: true });
  else if (r) opened = await switchGarden(r.code, { quiet: true });
  else if (profile.get().garden && await friendsPlantedSinceLastLook(profile.get().garden)) opened = await switchGarden(profile.get().garden, { quiet: true });
  if (!opened) await switchGarden(COMMUNITY, { quiet: true });
}

els.storage.textContent = store.shared
  ? 'This garden is shared: trees planted by other visitors appear here as they arrive. Friends you invite can plant in your own garden from their own devices.'
  : 'No server detected, so gardens are kept in this browser. Run python3 serve.py to share them and play with friends.';

// deep link: ?play=<game id>
const wanted = new URLSearchParams(location.search).get('play');
if (wanted) { const g = GAMES.find((x) => x.id === wanted && x.available); if (g) playGame(g); }

// dev hook (debug mode only)
if (new URLSearchParams(location.search).has('debug')) {
  window.mindplay = { garden, get store() { return store; }, rewards, run, profile, friends, switchGarden, GAMES, startPlanting, playGame, autoPlant };
}
