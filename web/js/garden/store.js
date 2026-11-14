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

export const SCHEMA_VERSION = 1;
const LS_KEY = `mindplay.garden.v${SCHEMA_VERSION}`;
const LS_REWARDS = 'mindplay.rewards.v1';
const LS_VISITOR = 'mindplay.visitor.v1';
const POLL_MS = 12000;

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
  take() {
    const l = this.list();
    const r = l.shift();
    safeSet(LS_REWARDS, l);
    return r;
  },
};

class BaseStore {
  constructor() { this._subs = new Set(); this.items = []; }
  subscribe(fn) { this._subs.add(fn); return () => this._subs.delete(fn); }
  _emit() { for (const fn of this._subs) fn(this.items.slice()); }
}

export class LocalGardenStore extends BaseStore {
  constructor() { super(); this.label = 'this browser'; }
  async load() {
    const data = safeGet(LS_KEY, null);
    if (!data) {
      this.items = SEED_CONTRIBUTIONS.slice();
      safeSet(LS_KEY, { version: SCHEMA_VERSION, contributions: this.items });
    } else {
      this.items = data.contributions || [];
    }
    // another tab planted something
    window.addEventListener('storage', (e) => {
      if (e.key === LS_KEY && e.newValue) {
        this.items = (JSON.parse(e.newValue).contributions) || [];
        this._emit();
      }
    });
    return this.items.slice();
  }
  async plant(partial) {
    if (this.items.some((c) => c.slot.col === partial.slot.col && c.slot.row === partial.slot.row)) {
      throw Object.assign(new Error('That spot was just taken'), { code: 'slot_taken' });
    }
    const c = { id: uid(), type: 'tree', plantedAt: new Date().toISOString(), visitorId: visitor.id, ...partial };
    this.items.push(c);
    safeSet(LS_KEY, { version: SCHEMA_VERSION, contributions: this.items });
    this._emit();
    return c;
  }
}

export class RemoteGardenStore extends BaseStore {
  constructor(base = '/api') { super(); this.base = base; this.label = 'the shared server'; }
  async load() {
    const r = await fetch(`${this.base}/garden`, { cache: 'no-store' });
    if (!r.ok) throw new Error(`garden api ${r.status}`);
    this.items = (await r.json()).contributions || [];
    this._timer = setInterval(() => this.refresh().catch(() => {}), POLL_MS);
    document.addEventListener('visibilitychange', () => { if (!document.hidden) this.refresh().catch(() => {}); });
    return this.items.slice();
  }
  async refresh() {
    const r = await fetch(`${this.base}/garden`, { cache: 'no-store' });
    if (!r.ok) return;
    const next = (await r.json()).contributions || [];
    if (next.length !== this.items.length || next.some((c, i) => c.id !== this.items[i]?.id)) {
      this.items = next;
      this._emit();
    }
  }
  async plant(partial) {
    const r = await fetch(`${this.base}/garden/contributions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ visitorId: visitor.id, ...partial }),
    });
    const body = await r.json().catch(() => ({}));
    if (r.status === 409) throw Object.assign(new Error('That spot was just taken'), { code: 'slot_taken' });
    if (!r.ok) throw new Error(body.error || `plant failed (${r.status})`);
    this.items.push(body);
    this._emit();
    return body;
  }
}

/** Use the server when it is there, otherwise fall back to localStorage. */
export async function createGardenStore() {
  try {
    const r = await fetch('/api/garden', { cache: 'no-store' });
    if (r.ok && (r.headers.get('content-type') || '').includes('json')) {
      const s = new RemoteGardenStore();
      return s;
    }
  } catch { /* static hosting */ }
  return new LocalGardenStore();
}
