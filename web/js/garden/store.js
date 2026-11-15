// Garden data layer.
//
// A contribution is one thing someone added to the shared garden:
//   { id, type: 'tree', kind: 'apple'|'cherry'|'birch'|'pine',
//     slot: { col, row }, plantedAt: ISO string, visitorId, gameId }
//
// Two interchangeable stores implement the same interface:
//   load()            -> Promise<Contribution[]>
//   plant(partial)    -> Promise<Contribution>   (rejects with { code: 'slot_taken' } if raced)
//   subscribe(fn)     -> unsubscribe;  fn(contributions) on any change (including other visitors')
//
// RemoteGardenStore talks to serve.py (/api/garden). LocalGardenStore keeps everything in
// localStorage so the page also works as plain static files.
//
// Every store is bound to one garden: 'community' (the shared one) or a friend's / my own
// personal garden, addressed by its short code. See `friends` below for invites and runs.

export const SCHEMA_VERSION = 1;
const LS_KEY = `mindplay.garden.v${SCHEMA_VERSION}`;
const LS_REWARDS = 'mindplay.rewards.v1';
const LS_VISITOR = 'mindplay.visitor.v1';
const LS_PROFILE = 'mindplay.profile.v1';
const LS_RUN = 'mindplay.run.v1';
const LS_GARDENS = 'mindplay.gardens.v1';   // local fallback: personal gardens kept in this browser
const POLL_MS = 12000;
const FRIEND_POLL_MS = 6000;               // friends' gardens refresh faster so helpers feel present
export const RUN_HOURS = 3;
export const COMMUNITY = 'community';

const hoursAgo = (h) => new Date(Date.now() - h * 3600e3).toISOString();

/** A handful of "neighbours" so the first visitor does not arrive to a bare field. */
export const SEED_CONTRIBUTIONS = [
  { id: 'seed-1', type: 'tree', kind: 'apple',  slot: { col: 1, row: 1 }, plantedAt: hoursAgo(300), visitorId: 'seed', gameId: 'breath-dive' },
  { id: 'seed-2', type: 'tree', kind: 'pine',   slot: { col: 7, row: 0 }, plantedAt: hoursAgo(260), visitorId: 'seed', gameId: 'breath-dive' },
  { id: 'seed-3', type: 'tree', kind: 'cherry', slot: { col: 4, row: 2 }, plantedAt: hoursAgo(200), visitorId: 'seed', gameId: 'breath-dive' },
  { id: 'seed-4', type: 'tree', kind: 'birch',  slot: { col: 8, row: 3 }, plantedAt: hoursAgo(150), visitorId: 'seed', gameId: 'breath-dive' },
  { id: 'seed-5', type: 'tree', kind: 'apple',  slot: { col: 2, row: 4 }, plantedAt: hoursAgo(60),  visitorId: 'seed', gameId: 'breath-dive' },
  { id: 'seed-6', type: 'tree', kind: 'pine',   slot: { col: 6, row: 3 }, plantedAt: hoursAgo(20),  visitorId: 'seed', gameId: 'breath-dive' },
  { id: 'seed-7', type: 'tree', kind: 'cherry', slot: { col: 0, row: 3 }, plantedAt: hoursAgo(3),   visitorId: 'seed', gameId: 'breath-dive' },
  { id: 'seed-8', type: 'tree', kind: 'birch',  slot: { col: 8, row: 1 }, plantedAt: hoursAgo(0.5), visitorId: 'seed', gameId: 'breath-dive' },
];

function uid(prefix = 'c') {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}
function safeGet(key, fallback) {
  try { const v = localStorage.getItem(key); return v ? JSON.parse(v) : fallback; } catch { return fallback; }
}
function safeSet(key, value) {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* private mode etc. */ }
}

/** Stable anonymous id for this browser. */
export const visitor = {
  get id() {
    let v = safeGet(LS_VISITOR, null);
    if (!v) { v = uid('v'); safeSet(LS_VISITOR, v); }
    return v;
  },
};

/** Rewards earned but not yet planted (kept across reloads). */
export const rewards = {
  list() { return safeGet(LS_REWARDS, []); },
  count() { return this.list().length; },
  add(reward) {
    const l = this.list();
    l.push({ id: uid('r'), type: 'tree', earnedAt: new Date().toISOString(), ...reward });
    safeSet(LS_REWARDS, l);
    return l.length;
  },
  take(id) {
    const l = this.list();
    const i = id ? l.findIndex((r) => r.id === id) : 0;
    const [r] = i >= 0 ? l.splice(i, 1) : [];
    safeSet(LS_REWARDS, l);
    return r;
  },
  /** Saplings that can be planted in `gardenId`: ones earned for it, plus unbound ones when it is mine/community. */
  plantableIn(gardenId, { canUseFree = true } = {}) {
    return this.list().filter((r) => (r.gardenId ? r.gardenId === gardenId : canUseFree));
  },
  /** Saplings promised to some other garden, grouped: [{ gardenId, gardenName, n }] */
  boundElsewhere(gardenId) {
    const m = new Map();
    for (const r of this.list()) {
      if (!r.gardenId || r.gardenId === gardenId) continue;
      const e = m.get(r.gardenId) || { gardenId: r.gardenId, gardenName: r.gardenName || 'a friend', n: 0 };
      e.n++; m.set(r.gardenId, e);
    }
    return [...m.values()];
  },
};

/** Who I am to my friends, and my own garden's code (once made). */
export const profile = {
  get() { return safeGet(LS_PROFILE, { name: '', garden: null }); },
  set(patch) { const p = { ...this.get(), ...patch }; safeSet(LS_PROFILE, p); return p; },
};

/**
 * The collaboration run I am in: { code, name, joinedAt, expiresAt } while helping a friend's
 * garden. Everything I earn during a run is planted in that garden, not mine.
 */
export const run = {
  get() {
    const r = safeGet(LS_RUN, null);
    if (r && Date.parse(r.expiresAt) > Date.now()) return r;
    if (r) safeSet(LS_RUN, null);
    return null;
  },
  start(code, name) {
    const now = Date.now();
    const r = { code, name, joinedAt: new Date(now).toISOString(), expiresAt: new Date(now + RUN_HOURS * 3600e3).toISOString() };
    safeSet(LS_RUN, r);
    return r;
  },
  end() { safeSet(LS_RUN, null); },
};

class BaseStore {
  constructor(gardenId = COMMUNITY) { this._subs = new Set(); this.items = []; this.gardenId = gardenId; this.meta = null; }
  subscribe(fn) { this._subs.add(fn); return () => this._subs.delete(fn); }
  _emit() { for (const fn of this._subs) fn(this.items.slice(), this.meta); }
  close() { this._subs.clear(); }
}

export class LocalGardenStore extends BaseStore {
  constructor(gardenId) { super(gardenId); this.label = 'this browser'; this.shared = false; }
  async load() {
    if (this.gardenId !== COMMUNITY) return this._loadPersonal();
    const data = safeGet(LS_KEY, null);
    if (!data) {
      this.items = SEED_CONTRIBUTIONS.slice();
      safeSet(LS_KEY, { version: SCHEMA_VERSION, contributions: this.items });
    } else {
      this.items = data.contributions || [];
    }
    // another tab planted something
    this._onStorage = (e) => {
      if (e.key === LS_KEY && e.newValue) {
        this.items = (JSON.parse(e.newValue).contributions) || [];
        this._emit();
      }
    };
    window.addEventListener('storage', this._onStorage);
    return this.items.slice();
  }
  _loadPersonal() {
    const all = safeGet(LS_GARDENS, {});
    const g = all[this.gardenId];
    if (!g) throw Object.assign(new Error('No garden with that code in this browser'), { code: 'not_found' });
    this.items = g.contributions || [];
    this.meta = localMeta(g);
    this._onStorage = (e) => {
      if (e.key !== LS_GARDENS || !e.newValue) return;
      const ng = JSON.parse(e.newValue)[this.gardenId];
      if (ng) { this.items = ng.contributions || []; this.meta = localMeta(ng); this._emit(); }
    };
    window.addEventListener('storage', this._onStorage);
    return this.items.slice();
  }
  close() { super.close(); if (this._onStorage) window.removeEventListener('storage', this._onStorage); }
  async plant(partial) {
    if (this.items.some((c) => c.slot.col === partial.slot.col && c.slot.row === partial.slot.row)) {
      throw Object.assign(new Error('That spot was just taken'), { code: 'slot_taken' });
    }
    const c = { id: uid(), type: 'tree', plantedAt: new Date().toISOString(), visitorId: visitor.id, visitorName: profile.get().name || null, ...partial };
    delete c.gardenId;
    this.items.push(c);
    if (this.gardenId === COMMUNITY) {
      safeSet(LS_KEY, { version: SCHEMA_VERSION, contributions: this.items });
    } else {
      const all = safeGet(LS_GARDENS, {});
      const g = all[this.gardenId];
      g.contributions = this.items;
      const h = g.helpers?.[visitor.id];
      if (h && g.ownerId !== visitor.id) h.planted = (h.planted || 0) + 1;
      safeSet(LS_GARDENS, all);
      this.meta = localMeta(g);
    }
    this._emit();
    return c;
  }
}

function localMeta(g) {
  const cutoff = Date.now() - RUN_HOURS * 3600e3;
  const helpers = Object.entries(g.helpers || {})
    .filter(([, h]) => !h.left && h.lastSeen > cutoff)
    .map(([id, h]) => ({ name: h.name, planted: h.planted || 0, joinedAt: h.joinedAt, id: id.slice(-6) }));
  return { code: g.code, name: g.name, owner: g.ownerId.slice(-6), created: g.created, helpers, count: g.contributions.length };
}

export class RemoteGardenStore extends BaseStore {
  constructor(gardenId, base = '/api') { super(gardenId); this.base = base; this.label = 'the shared server'; this.shared = true; }
  get _url() { return `${this.base}/garden${this.gardenId === COMMUNITY ? '' : `?g=${encodeURIComponent(this.gardenId)}`}`; }
  async load() {
    const r = await fetch(this._url, { cache: 'no-store' });
    if (r.status === 404) throw Object.assign(new Error('No garden with that code'), { code: 'not_found' });
    if (!r.ok) throw new Error(`garden api ${r.status}`);
    const body = await r.json();
    this.items = body.contributions || [];
    this.meta = body.garden || null;
    this._timer = setInterval(() => this.refresh().catch(() => {}), this.gardenId === COMMUNITY ? POLL_MS : FRIEND_POLL_MS);
    this._onVis = () => { if (!document.hidden) this.refresh().catch(() => {}); };
    document.addEventListener('visibilitychange', this._onVis);
    return this.items.slice();
  }
  close() { super.close(); clearInterval(this._timer); document.removeEventListener('visibilitychange', this._onVis); }
  async refresh() {
    const r = await fetch(this._url, { cache: 'no-store' });
    if (!r.ok) return;
    const body = await r.json();
    const next = body.contributions || [];
    const meta = body.garden || null;
    const metaChanged = JSON.stringify(meta) !== JSON.stringify(this.meta);
    if (metaChanged || next.length !== this.items.length || next.some((c, i) => c.id !== this.items[i]?.id)) {
      this.items = next;
      this.meta = meta;
      this._emit();
    }
  }
  async plant(partial) {
    const r = await fetch(`${this.base}/garden/contributions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ visitorId: visitor.id, visitorName: profile.get().name || null, ...partial, gardenId: this.gardenId }),
    });
    const body = await r.json().catch(() => ({}));
    if (r.status === 409) throw Object.assign(new Error('That spot was just taken'), { code: 'slot_taken' });
    if (r.status === 403) throw Object.assign(new Error(body.error || 'Join this garden to plant here'), { code: 'not_member' });
    if (!r.ok) throw new Error(body.error || `plant failed (${r.status})`);
    this.items.push(body);
    if (this.meta) this.meta = { ...this.meta, count: this.items.length };
    this._emit();
    if (this.meta) this.refresh().catch(() => {});   // pick up my updated helper tally
    return body;
  }
}

let serverAvailable = null;
async function hasServer() {
  if (serverAvailable !== null) return serverAvailable;
  try {
    const r = await fetch('/api/garden', { cache: 'no-store' });
    serverAvailable = r.ok && (r.headers.get('content-type') || '').includes('json');
  } catch { serverAvailable = false; /* static hosting */ }
  return serverAvailable;
}

/** Use the server when it is there, otherwise fall back to localStorage. */
export async function createGardenStore(gardenId = COMMUNITY) {
  return (await hasServer()) ? new RemoteGardenStore(gardenId) : new LocalGardenStore(gardenId);
}

/** Normalise a typed or pasted code / invite link to a garden code (or null). */
export function parseGardenCode(text) {
  const t = String(text || '').trim();
  const m = t.match(/[?&](?:join|garden)=([A-Za-z0-9]{4,8})/) || t.match(/^([A-Za-z0-9]{4,8})$/);
  return m ? m[1].toUpperCase() : null;
}

async function post(path, body) {
  const r = await fetch(`/api${path}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  const out = await r.json().catch(() => ({}));
  if (!r.ok) throw Object.assign(new Error(out.error || `request failed (${r.status})`), { status: r.status, code: r.status === 404 ? 'not_found' : r.status === 409 ? 'own_garden' : 'error' });
  return out;
}

/** Personal gardens, invites and runs. Works against serve.py, or within one browser without it. */
export const friends = {
  async shared() { return hasServer(); },

  /** Create (or rename) my personal garden; returns its meta and remembers the code. */
  async ensureMyGarden(name) {
    const p = profile.get();
    name = (name ?? p.name ?? '').trim();
    let meta;
    if (await hasServer()) {
      meta = await post('/gardens', { visitorId: visitor.id, name: name ? `${name}'s garden` : '' });
    } else {
      const all = safeGet(LS_GARDENS, {});
      let g = Object.values(all).find((x) => x.ownerId === visitor.id);
      if (!g) {
        let code; do { code = Array.from({ length: 6 }, () => 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'[Math.floor(Math.random() * 31)]).join(''); } while (all[code]);
        g = { code, name: 'My garden', ownerId: visitor.id, created: new Date().toISOString(), contributions: [], helpers: {} };
        all[code] = g;
      }
      if (name) g.name = `${name}'s garden`;
      safeSet(LS_GARDENS, all);
      meta = localMeta(g);
    }
    profile.set({ name, garden: meta.code });
    return meta;
  },

  inviteLink(code) {
    const u = new URL(location.href);
    u.search = ''; u.hash = '';
    u.searchParams.set('join', code);
    return u.toString();
  },

  /** Join a friend's garden for a run: what I earn goes to them until I leave or it expires. */
  async join(code) {
    const name = profile.get().name || 'A friend';
    let meta;
    if (await hasServer()) {
      meta = await post(`/gardens/${encodeURIComponent(code)}/join`, { visitorId: visitor.id, name });
    } else {
      const all = safeGet(LS_GARDENS, {});
      const g = all[code];
      if (!g) throw Object.assign(new Error('No garden with that code in this browser'), { code: 'not_found' });
      if (g.ownerId === visitor.id) throw Object.assign(new Error('this is your own garden'), { code: 'own_garden' });
      g.helpers = g.helpers || {};
      const h = g.helpers[visitor.id];
      g.helpers[visitor.id] = { name, planted: h && !h.left ? h.planted : 0, joinedAt: h && !h.left ? h.joinedAt : new Date().toISOString(), lastSeen: Date.now(), left: false };
      safeSet(LS_GARDENS, all);
      meta = localMeta(g);
    }
    run.start(meta.code, meta.name);
    return meta;
  },

  async leave() {
    const r = run.get();
    run.end();
    if (!r) return;
    try {
      if (await hasServer()) await post(`/gardens/${encodeURIComponent(r.code)}/leave`, { visitorId: visitor.id });
      else {
        const all = safeGet(LS_GARDENS, {});
        const h = all[r.code]?.helpers?.[visitor.id];
        if (h) { h.left = true; safeSet(LS_GARDENS, all); }
      }
    } catch { /* leaving locally is what matters */ }
  },

  /** Keep my helper slot fresh while the page is open (the host sees who is around). */
  async heartbeat() {
    const r = run.get();
    if (!r || !(await hasServer())) return;
    try { await post(`/gardens/${encodeURIComponent(r.code)}/join`, { visitorId: visitor.id, name: profile.get().name || 'A friend' }); } catch { /* offline */ }
  },
};
