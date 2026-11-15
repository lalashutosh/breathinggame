// Vercel serverless version of serve.py's garden API (community + friends' gardens).
//
// Storage: Upstash Redis over its REST API (no npm deps). Add the Upstash Redis integration
// to the Vercel project; it sets KV_REST_API_URL / KV_REST_API_TOKEN (or UPSTASH_REDIS_REST_*).
// Without it, /api/garden answers 503 and the page falls back to per-browser gardens.
//
//   GET  /api/garden[?g=CODE]              -> {version, contributions, garden?}
//   POST /api/garden/contributions         -> 201 contribution | 409 slot taken | 403 not a helper
//   POST /api/gardens                      -> create / rename my garden
//   POST /api/gardens/CODE/join|leave      -> garden meta
//
// Keys:  g:<id>:meta (JSON) · g:<id>:slots (hash "col,row" -> contribution JSON)
//        g:<id>:helpers (hash visitorId -> JSON) · owner:<visitorId> -> code
// <id> is "community" or a 6-letter code. HSETNX on the slot field makes planting race-safe.
const crypto = require('crypto');

const COLS = 9, ROWS = 5;
const KINDS = new Set(['apple', 'cherry', 'birch', 'pine']);
const SCHEMA_VERSION = 2;
const HELPER_TTL = 3 * 3600 * 1000;
const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
const CODE_RE = /^[A-Z0-9]{4,8}$/;

const URL_ = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
const TOKEN = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;

async function redis(...cmd) {
  const r = await fetch(URL_, { method: 'POST', headers: { Authorization: `Bearer ${TOKEN}` }, body: JSON.stringify(cmd) });
  const out = await r.json();
  if (out.error) throw new Error(out.error);
  return out.result;
}
const hgetallObj = async (key) => {
  const flat = (await redis('HGETALL', key)) || [];
  const o = {};
  for (let i = 0; i < flat.length; i += 2) o[flat[i]] = JSON.parse(flat[i + 1]);
  return o;
};

const ago = (h) => new Date(Date.now() - h * 3600e3).toISOString();
const cleanName = (v, fallback = 'A friend') => (String(v ?? '').split(/\s+/).join(' ').trim().slice(0, 24) || fallback);
const isCommunity = (id) => !id || id === 'community';

/** Mirror of SEED_CONTRIBUTIONS in web/js/garden/store.js (planted once, on first read). */
async function ensureCommunity() {
  if (!(await redis('SET', 'g:community:seeded', '1', 'NX'))) return;
  const rows = [['apple', 1, 1, 300], ['pine', 7, 0, 260], ['cherry', 4, 2, 200], ['birch', 8, 3, 150],
    ['apple', 2, 4, 60], ['pine', 6, 3, 20], ['cherry', 0, 3, 3], ['birch', 8, 1, 0.5]];
  const args = [];
  rows.forEach(([kind, col, row, h], i) => args.push(`${col},${row}`, JSON.stringify({
    id: `seed-${i + 1}`, type: 'tree', kind, slot: { col, row }, plantedAt: ago(h), visitorId: 'seed', gameId: 'breath-dive' })));
  await redis('HSET', 'g:community:slots', ...args);
}

async function contributions(id) {
  const slots = await hgetallObj(`g:${id}:slots`);
  return Object.values(slots).sort((a, b) => a.plantedAt.localeCompare(b.plantedAt));
}

async function getMeta(code) {
  const raw = await redis('GET', `g:${code}:meta`);
  return raw ? JSON.parse(raw) : null;
}

function activeHelper(h) { return h && !h.left && Date.now() - (h.lastSeen || 0) <= HELPER_TTL; }

async function publicMeta(g, count) {
  const helpers = Object.entries(await hgetallObj(`g:${g.code}:helpers`))
    .filter(([, h]) => activeHelper(h))
    .map(([vid, h]) => ({ name: h.name, planted: h.planted || 0, joinedAt: h.joinedAt, id: vid.slice(-6) }))
    .sort((a, b) => (a.joinedAt || '').localeCompare(b.joinedAt || ''));
  if (count == null) count = await redis('HLEN', `g:${g.code}:slots`);
  return { code: g.code, name: g.name, owner: g.ownerId.slice(-6), created: g.created, helpers, count };
}

// ------------------------------------------------------------------ handlers
async function getGarden(code) {
  if (isCommunity(code)) {
    await ensureCommunity();
    return [200, { version: SCHEMA_VERSION, contributions: await contributions('community') }];
  }
  code = code.toUpperCase();
  const g = await getMeta(code);
  if (!g) return [404, { error: 'no garden with that code' }];
  const list = await contributions(code);
  return [200, { version: SCHEMA_VERSION, contributions: list, garden: await publicMeta(g, list.length) }];
}

async function ensureGarden(body) {
  const vid = String(body.visitorId || '').slice(0, 64);
  if (!vid) return [400, { error: 'missing visitorId' }];
  const name = cleanName(body.name, '');
  let code = await redis('GET', `owner:${vid}`);
  let g = code && (await getMeta(code));
  if (!g) {
    do { code = Array.from(crypto.randomBytes(6), (b) => CODE_ALPHABET[b % CODE_ALPHABET.length]).join(''); }
    while (await redis('EXISTS', `g:${code}:meta`));
    g = { code, name: name || 'My garden', ownerId: vid, created: new Date().toISOString() };
    if (!(await redis('SET', `owner:${vid}`, code, 'NX'))) return ensureGarden(body); // raced with another tab
  } else if (name) g.name = name;
  await redis('SET', `g:${code}:meta`, JSON.stringify(g));
  return [200, await publicMeta(g)];
}

async function joinOrLeave(code, action, body) {
  const vid = String(body.visitorId || '').slice(0, 64);
  if (!vid) return [400, { error: 'missing visitorId' }];
  const g = await getMeta(code);
  if (!g) return [404, { error: 'no garden with that code' }];
  if (g.ownerId === vid) return [409, { error: 'this is your own garden' }];
  const key = `g:${code}:helpers`;
  const raw = await redis('HGET', key, vid);
  const h = raw ? JSON.parse(raw) : { planted: 0 };
  if (action === 'leave') {
    if (raw) { h.left = true; await redis('HSET', key, vid, JSON.stringify(h)); }
  } else {
    const fresh = !activeHelper(h) || !h.joinedAt;
    Object.assign(h, { name: cleanName(body.name), lastSeen: Date.now(), left: false });
    if (fresh) { h.joinedAt = new Date().toISOString(); h.planted = 0; }
    await redis('HSET', key, vid, JSON.stringify(h));
  }
  return [200, await publicMeta(g)];
}

async function plant(body) {
  const { kind } = body;
  const slot = body.slot || {};
  const { col, row } = slot;
  if ((body.type || 'tree') !== 'tree' || !KINDS.has(kind)) return [400, { error: 'unknown contribution type or kind' }];
  if (!Number.isInteger(col) || !Number.isInteger(row) || col < 0 || col >= COLS || row < 0 || row >= ROWS) return [400, { error: 'slot out of range' }];
  const vid = String(body.visitorId || 'anon').slice(0, 64);
  let id = 'community', helperRaw = null, g = null;
  if (!isCommunity(body.gardenId)) {
    id = String(body.gardenId).toUpperCase();
    g = await getMeta(id);
    if (!g) return [404, { error: 'no garden with that code' }];
    helperRaw = await redis('HGET', `g:${id}:helpers`, vid);
    if (g.ownerId !== vid && !activeHelper(helperRaw && JSON.parse(helperRaw))) return [403, { error: "join this garden's run to plant here" }];
  } else await ensureCommunity();
  const item = {
    id: 'c_' + crypto.randomBytes(6).toString('hex'), type: 'tree', kind, slot: { col, row },
    plantedAt: new Date().toISOString(), visitorId: vid,
    visitorName: cleanName(body.visitorName, '') || null,
    gameId: body.gameId ? String(body.gameId).slice(0, 64) : null,
  };
  if (!(await redis('HSETNX', `g:${id}:slots`, `${col},${row}`, JSON.stringify(item)))) return [409, { error: 'slot taken' }];
  if (g && g.ownerId !== vid) {
    const h = JSON.parse(helperRaw);
    h.planted = (h.planted || 0) + 1; h.lastSeen = Date.now();
    await redis('HSET', `g:${id}:helpers`, vid, JSON.stringify(h));
  }
  return [201, item];
}

// ------------------------------------------------------------------ router
module.exports = async (req, res) => {
  const send = (status, payload) => { res.setHeader('Cache-Control', 'no-store'); res.status(status).json(payload); };
  const route = String((req.query && req.query.route) || '').replace(/^\/+|\/+$/g, '');
  if (!URL_ || !TOKEN) return send(503, { error: 'garden storage is not configured' });
  try {
    if (req.method === 'GET' && route === 'garden') return send(...(await getGarden(String(req.query.g || ''))));
    if (req.method !== 'POST') return send(404, { error: 'not found' });
    let body = req.body;
    if (typeof body === 'string') { try { body = JSON.parse(body); } catch { return send(400, { error: 'bad json' }); } }
    if (!body || typeof body !== 'object' || Array.isArray(body)) return send(400, { error: 'expected a json object' });
    if (route === 'garden/contributions') return send(...(await plant(body)));
    if (route === 'gardens') return send(...(await ensureGarden(body)));
    const m = route.match(/^gardens\/([^/]+)\/(join|leave)$/);
    if (m) {
      const code = m[1].toUpperCase();
      if (!CODE_RE.test(code)) return send(400, { error: 'bad garden code' });
      return send(...(await joinOrLeave(code, m[2], body)));
    }
    return send(404, { error: 'not found' });
  } catch (e) {
    return send(500, { error: 'storage error' });
  }
};
