// Greenfold (the immersive valley) inside the MindPlay hub.
// The full game is a Godot build. When this page is served by serve.py on the demo laptop, the
// server opens it fullscreen in its own window and the game reports back when the walk ends.
// Anywhere else (or if Godot is missing) the browser edition runs right here instead.

export const meta = { id: 'greenfold', title: 'Greenfold' };

const CSS = `
.gf { position: fixed; inset: 0; z-index: 1000; display: grid; place-items: center; text-align: center; color: #f6f1e7;
  background: radial-gradient(ellipse at 50% 35%, #f6b47a 0%, #c9577a 38%, #2b3a67 75%, #141a3e 100%); font-family: system-ui, sans-serif; }
.gf-card { max-width: 520px; padding: 28px; }
.gf h3 { font-family: "Cormorant Garamond", "EB Garamond", Georgia, serif; font-weight: 400; font-size: 64px; margin: 0; letter-spacing: .02em; }
.gf .sub { font-family: "Cormorant Garamond", Georgia, serif; font-style: italic; font-size: 21px; opacity: .9; margin: 6px 0 22px; }
.gf p { line-height: 1.5; opacity: .88; margin: 0 0 14px; }
.gf .row { display: flex; gap: 10px; justify-content: center; flex-wrap: wrap; margin-top: 8px; }
.gf button { font: 500 15px system-ui, sans-serif; border-radius: 999px; padding: 13px 30px; cursor: pointer; border: 1px solid rgba(255,255,255,.35); background: rgba(10,14,34,.3); color: #f6f1e7; }
.gf button.primary { background: rgba(255,244,224,.95); color: #1a1f3a; border: 0; }
.gf button:hover { filter: brightness(1.08); }
.gf .stats { display: flex; gap: 26px; justify-content: center; margin: 6px 0 18px; }
.gf .stats b { display: block; font-family: "Cormorant Garamond", Georgia, serif; font-weight: 500; font-size: 34px; }
.gf .stats span { font-size: 11px; letter-spacing: .12em; text-transform: uppercase; opacity: .7; }
.gf .wait { width: 10px; height: 10px; border-radius: 50%; background: #fff3cf; display: inline-block; margin-right: 8px; animation: gf-pulse 4s ease-in-out infinite; }
@keyframes gf-pulse { 0%, 100% { transform: scale(.6); opacity: .5 } 40% { transform: scale(1.3); opacity: 1 } }
.gf iframe { position: fixed; inset: 0; width: 100%; height: 100%; border: 0; background: #0b1024; }
.gf .back { position: fixed; top: 14px; left: 14px; z-index: 2; padding: 8px 16px; font-size: 13px; }
`;

export function mount(container, { onComplete, onExit } = {}) {
  container.innerHTML = `<style>${CSS}</style><div class="gf"><div class="gf-card"></div></div>`;
  const root = container.querySelector('.gf');
  const card = container.querySelector('.gf-card');
  let poll = 0;
  let alive = true;
  let iframe = null;

  const view = (html) => { card.innerHTML = html; };
  const on = (sel, fn) => card.querySelector(sel)?.addEventListener('click', fn);

  function intro(native) {
    view(`
      <h3>Greenfold</h3>
      <p class="sub">a quiet valley, a few stray sheep</p>
      <p>Walk the valley as it slowly breathes. About a minute: tap a mood, hold to walk, find the sheep.</p>
      ${native ? '<p style="font-size:13.5px;opacity:.7">Opens fullscreen in its own window. When the walk ends, choose “Back to the garden”.</p>' : ''}
      <div class="row">
        ${native ? '<button class="primary" data-go>Open the valley</button><button data-web>Play in the browser</button>'
                 : '<button class="primary" data-web>Begin</button>'}
        <button data-leave>Back</button>
      </div>`);
    on('[data-go]', launch);
    on('[data-web]', browser);
    on('[data-leave]', () => onExit && onExit());
  }

  async function launch() {
    let session;
    try {
      const r = await fetch('/api/greenfold/launch', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
      if (!r.ok) throw new Error((await r.json()).error || r.statusText);
      session = (await r.json()).session;
    } catch (e) {
      view(`<h3>Greenfold</h3><p class="sub">the valley window could not open</p><p>${String(e.message || e)}</p>
        <div class="row"><button class="primary" data-web>Play in the browser</button><button data-leave>Back</button></div>`);
      on('[data-web]', browser); on('[data-leave]', () => onExit && onExit());
      return;
    }
    view(`<h3>Greenfold</h3><p class="sub"><span class="wait"></span>the valley is open in its own window</p>
      <p>Walk until the valley settles. This page notices when you are done.</p>
      <div class="row"><button data-cancel>Back</button></div>`);
    on('[data-cancel]', () => { clearInterval(poll); intro(true); });
    let quietTicks = 0;
    poll = setInterval(async () => {
      if (!alive) return;
      try {
        const d = await (await fetch(`/api/greenfold/result?session=${session}`, { cache: 'no-store' })).json();
        if (d.done) { clearInterval(poll); finished(d.result); return; }
        quietTicks = d.running ? 0 : quietTicks + 1;
        if (quietTicks > 2) {
          clearInterval(poll);
          view(`<h3>Greenfold</h3><p class="sub">the valley window closed before the walk ended</p>
            <div class="row"><button class="primary" data-go>Open it again</button><button data-leave>Back</button></div>`);
          on('[data-go]', launch); on('[data-leave]', () => onExit && onExit());
        }
      } catch { /* server hiccup: keep waiting */ }
    }, 1500);
  }

  function browser() {
    iframe = document.createElement('iframe');
    iframe.src = 'games/greenfold-web/index.html';
    iframe.allow = 'fullscreen; autoplay';
    const back = document.createElement('button');
    back.className = 'back'; back.textContent = 'Back to the garden';
    back.addEventListener('click', () => onExit && onExit());
    root.append(iframe, back);
    root.requestFullscreen?.().catch(() => {});
    iframe.addEventListener('load', () => iframe.focus());
  }

  function onMessage(ev) {
    if (!iframe || ev.source !== iframe.contentWindow || ev.data?.type !== 'greenfold:end') return;
    const result = ev.data.result;
    setTimeout(() => { if (!alive) return; iframe.remove(); iframe = null; root.querySelector('.back')?.remove(); finished(result); }, 4500);
  }
  window.addEventListener('message', onMessage);

  function finished(res) {
    if (document.fullscreenElement) document.exitFullscreen?.().catch(() => {});
    const bpm = res.startBpm && res.endBpm ? `${res.startBpm} → ${res.endBpm}` : '–';
    view(`<h3 style="font-size:52px">Home for now.</h3>
      <p class="sub">The valley settled as you walked.</p>
      <div class="stats">
        <div><b>${bpm}</b><span>breaths / min</span></div>
        <div><b>${res.flowPct ?? 0}%</b><span>in flow</span></div>
        <div><b>${res.sheep ?? 0} / ${res.sheepTotal ?? 7}</b><span>sheep found</span></div>
      </div>
      <div class="row"><button class="primary" data-collect>Collect your sapling</button></div>`);
    on('[data-collect]', () => onComplete && onComplete(res));
  }

  // decide which edition to offer
  view('<p class="sub"><span class="wait"></span>opening the valley…</p>');
  fetch('/api/greenfold/status', { cache: 'no-store' })
    .then((r) => (r.ok ? r.json() : { available: false }))
    .catch(() => ({ available: false }))
    .then((s) => { if (alive) intro(!!s.available); });

  return {
    unmount() {
      alive = false;
      clearInterval(poll);
      window.removeEventListener('message', onMessage);
      if (document.fullscreenElement) document.exitFullscreen?.().catch(() => {});
      container.innerHTML = '';
    },
  };
}
