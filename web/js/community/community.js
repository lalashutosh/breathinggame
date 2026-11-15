// Garden friends: switch between the community garden, my own garden and a friend's,
// invite a friend, visit one by code, and join / leave a collaboration run.
//
// A run is the heart of it: while I help a friend's garden, every sapling I earn is planted
// there. Nothing is lost by leaving; the friend's garden simply keeps what we grew together.
import { openModal, toast } from '../ui/ui.js';
import { COMMUNITY, friends, profile, run, parseGardenCode, RUN_HOURS } from '../garden/store.js';

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export function listNames(names) {
  if (names.length <= 1) return names.join('');
  if (names.length === 2) return `${names[0]} and ${names[1]}`;
  return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
}

/** Fill the friends block. `view` = { gardenId, meta, isMine, helping }. */
export function renderFriendsBlock(root, view, { onSwitch, onInvite, onVisit, onJoin, onLeave }) {
  const p = profile.get();
  const r = run.get();
  root.innerHTML = '';

  // garden tabs
  const tabs = document.createElement('div');
  tabs.className = 'garden-tabs';
  tabs.setAttribute('role', 'tablist');
  tabs.setAttribute('aria-label', 'Which garden');
  const addTab = (id, label, extra = '') => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = `garden-tab ${extra}`;
    b.setAttribute('role', 'tab');
    b.setAttribute('aria-selected', String(view.gardenId === id));
    b.textContent = label;
    b.addEventListener('click', () => { if (view.gardenId !== id) onSwitch(id); });
    tabs.append(b);
  };
  addTab(COMMUNITY, 'Community');
  addTab(p.garden || 'mine', 'My garden');
  if (r && r.code !== p.garden) addTab(r.code, shortName(r.name), 'is-run');
  else if (!view.isMine && view.gardenId !== COMMUNITY) addTab(view.gardenId, shortName(view.meta?.name || 'Friend'));
  root.append(tabs);

  // what is happening in this garden
  const note = document.createElement('p');
  note.className = 'friends-note';
  const helpers = view.meta?.helpers || [];
  if (view.gardenId === COMMUNITY) {
    note.innerHTML = 'Everyone’s garden. Invite a friend to grow <b>yours</b> together.';
  } else if (view.isMine) {
    note.innerHTML = helpers.length
      ? `<span class="pulse" aria-hidden="true"></span><b>${esc(listNames(helpers.map((h) => h.name)))}</b> ${helpers.length === 1 ? 'is' : 'are'} helping you this run · ${helpers.reduce((n, h) => n + h.planted, 0)} planted`
      : 'Invite a friend. While they play, every sapling they earn grows here.';
  } else if (view.helping) {
    const others = helpers.filter((h) => h.name !== p.name);
    note.innerHTML = `<span class="pulse" aria-hidden="true"></span>You’re helping <b>${esc(view.meta?.name || 'a friend')}</b>. Saplings you earn grow here.${others.length ? ` With ${esc(listNames(others.map((h) => h.name)))}.` : ''}`;
  } else {
    note.innerHTML = `Visiting <b>${esc(view.meta?.name || 'a friend’s garden')}</b>. Join their run to plant here.`;
  }
  root.append(note);

  // actions
  const actions = document.createElement('div');
  actions.className = 'friends-actions';
  const btn = (label, cls, fn) => { const b = document.createElement('button'); b.type = 'button'; b.className = `btn btn-sm ${cls}`; b.textContent = label; b.addEventListener('click', fn); actions.append(b); };
  if (!view.isMine && view.gardenId !== COMMUNITY && !view.helping) btn('Help this garden', 'btn-primary', () => onJoin(view.gardenId));
  if (view.helping) btn('Done helping', '', onLeave);
  else btn('Invite a friend', view.isMine ? 'btn-primary' : '', onInvite);
  btn('Visit a friend', 'btn-ghost', onVisit);
  root.append(actions);
}

function shortName(name) {
  const n = String(name || 'Friend');
  return n.length > 18 ? `${n.slice(0, 17)}…` : n;
}

/** Ask for a first name once; it is what friends see next to your trees. */
function nameField(value) {
  return `<label class="field"><span>Your first name, so friends know it’s you</span>
    <input type="text" name="name" maxlength="20" autocomplete="given-name" placeholder="e.g. Sam" value="${esc(value)}" required></label>`;
}

export async function openInvite({ onOpenMine }) {
  const shared = await friends.shared();
  const p = profile.get();
  const modal = openModal({ title: 'Invite a friend', subtitle: 'grow your garden together' });
  const showLink = (meta) => {
    const link = friends.inviteLink(meta.code);
    modal.body.innerHTML = `
      <div class="friends-modal">
        <p>Send this link. When your friend opens it and joins, <b>every sapling they earn for the next ${RUN_HOURS} hours is planted in your garden</b>. You’ll see them arrive.</p>
        <div class="invite-row">
          <input class="invite-link" type="text" readonly value="${esc(link)}" aria-label="Invite link">
          <button class="btn btn-primary" type="button" data-copy>Copy link</button>
        </div>
        <p class="invite-code">Or tell them your garden code: <b>${esc(meta.code)}</b></p>
        ${shared ? '' : '<p class="muted">No server is running, so this only works in this browser (try it in another tab). Run <code>python3 serve.py</code> to play with friends on other devices.</p>'}
        <div class="row">
          <button class="btn" type="button" data-share hidden>Share…</button>
          <button class="btn btn-ghost" type="button" data-open>Go to my garden</button>
        </div>
      </div>`;
    const input = modal.body.querySelector('.invite-link');
    input.addEventListener('focus', () => input.select());
    modal.body.querySelector('[data-copy]').addEventListener('click', async (e) => {
      try { await navigator.clipboard.writeText(link); e.target.textContent = 'Copied'; }
      catch { input.focus(); input.select(); e.target.textContent = 'Press Ctrl+C'; }
    });
    const share = modal.body.querySelector('[data-share]');
    if (navigator.share) {
      share.hidden = false;
      share.addEventListener('click', () => navigator.share({ title: 'Grow my ΑΝΑΣΑ garden with me', text: 'Play a calm minute with me. What you earn grows in my garden.', url: link }).catch(() => {}));
    }
    modal.body.querySelector('[data-open]').addEventListener('click', () => { modal.close(); onOpenMine(meta.code); });
    modal.body.querySelector('[data-copy]').focus();
  };

  if (p.name && p.garden) {
    modal.body.innerHTML = '<p class="friends-modal">Getting your garden…</p>';
    try { showLink(await friends.ensureMyGarden()); } catch (e) { modal.body.innerHTML = `<p class="friends-modal">Could not make your garden: ${esc(e.message)}</p>`; }
    return;
  }
  modal.body.innerHTML = `
    <form class="friends-modal">
      <p>You’ll get your own garden. Friends you invite can plant in it while they play.</p>
      ${nameField(p.name)}
      <div class="row"><button class="btn btn-primary" type="submit">Make my invite link</button></div>
    </form>`;
  const form = modal.body.querySelector('form');
  form.name.focus();
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const name = form.name.value.trim();
    if (!name) return form.name.focus();
    try { showLink(await friends.ensureMyGarden(name)); } catch (err) { toast(`Could not make your garden: ${err.message}`); }
  });
}

export function openVisit({ onVisit }) {
  const modal = openModal({ title: 'Visit a friend', subtitle: 'see their garden' });
  modal.body.innerHTML = `
    <form class="friends-modal">
      <label class="field"><span>Their garden code or invite link</span>
        <input type="text" name="code" placeholder="e.g. K7QM2P" autocomplete="off" spellcheck="false" required></label>
      <div class="row"><button class="btn btn-primary" type="submit">Visit</button></div>
    </form>`;
  const form = modal.body.querySelector('form');
  form.code.focus();
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const code = parseGardenCode(form.code.value);
    if (!code) { toast('That doesn’t look like a garden code.'); return form.code.focus(); }
    modal.close();
    onVisit(code);
  });
}

/** Shown when someone opens an invite link, or presses "Help this garden". */
export function openJoin(meta, { onJoined, onJustLook }) {
  const p = profile.get();
  const host = meta.name || 'A friend’s garden';
  const modal = openModal({ title: host, subtitle: 'you’re invited' });
  const helpers = (meta.helpers || []).map((h) => h.name);
  modal.body.innerHTML = `
    <form class="friends-modal">
      <p><b>Grow this garden together.</b> For the next ${RUN_HOURS} hours, every sapling you earn by playing is planted here instead of your own garden.</p>
      ${helpers.length ? `<p class="muted">${esc(listNames(helpers))} ${helpers.length === 1 ? 'is' : 'are'} already helping.</p>` : ''}
      ${nameField(p.name)}
      <div class="row">
        <button class="btn btn-primary" type="submit">Join the run</button>
        <button class="btn btn-ghost" type="button" data-look>Just look around</button>
      </div>
    </form>`;
  const form = modal.body.querySelector('form');
  form.name.focus();
  modal.body.querySelector('[data-look]').addEventListener('click', () => { modal.close(); onJustLook && onJustLook(); });
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const name = form.name.value.trim();
    if (!name) return form.name.focus();
    profile.set({ name });
    try {
      const m = await friends.join(meta.code);
      modal.close();
      onJoined(m);
    } catch (err) {
      if (err.code === 'own_garden') { modal.close(); toast('That’s your own garden. Send the link to a friend.'); onJustLook && onJustLook(); }
      else toast(`Could not join: ${err.message}`);
    }
  });
}
