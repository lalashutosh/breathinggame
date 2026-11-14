// Toasts and the game modal.

export function toast(message, { icon = null, ms = 3800 } = {}) {
  const root = document.getElementById('toasts');
  const el = document.createElement('div');
  el.className = 'toast';
  if (icon) { const c = document.createElement('canvas'); c.className = 'sprout'; c.width = icon.width; c.height = icon.height; c.getContext('2d').drawImage(icon, 0, 0); el.appendChild(c); }
  el.appendChild(document.createTextNode(message));
  root.appendChild(el);
  setTimeout(() => { el.classList.add('is-leaving'); setTimeout(() => el.remove(), 320); }, ms);
}

/**
 * Open a modal. `render(body, close)` fills the body. Returns { close, body, setTitle }.
 */
export function openModal({ title, subtitle = '', onClose }) {
  const root = document.getElementById('modal-root');
  const wrap = document.createElement('div');
  wrap.className = 'modal';
  wrap.setAttribute('role', 'dialog');
  wrap.setAttribute('aria-modal', 'true');
  wrap.setAttribute('aria-label', title);
  wrap.innerHTML = `
    <div class="modal-box">
      <div class="modal-head">
        <h2 class="modal-title"></h2>
        <p class="modal-sub"></p>
        <button class="modal-close" type="button" aria-label="Close">×</button>
      </div>
      <div class="modal-body"></div>
    </div>`;
  const titleEl = wrap.querySelector('.modal-title');
  const subEl = wrap.querySelector('.modal-sub');
  titleEl.textContent = title;
  subEl.textContent = subtitle;
  const body = wrap.querySelector('.modal-body');
  const prevFocus = document.activeElement;
  let closed = false;
  const close = () => {
    if (closed) return;
    closed = true;
    document.removeEventListener('keydown', onKey);
    wrap.remove();
    document.body.style.overflow = '';
    onClose && onClose();
    prevFocus && prevFocus.focus && prevFocus.focus();
  };
  const onKey = (e) => { if (e.key === 'Escape') close(); };
  document.addEventListener('keydown', onKey);
  wrap.querySelector('.modal-close').addEventListener('click', close);
  wrap.addEventListener('pointerdown', (e) => { if (e.target === wrap) close(); });
  document.body.style.overflow = 'hidden';
  root.appendChild(wrap);
  wrap.querySelector('.modal-close').focus();
  return {
    close, body,
    setTitle(t, s = '') { titleEl.textContent = t; subEl.textContent = s; },
  };
}
