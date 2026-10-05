// DOM overlay widgets shared by desktop and touch: pixel-styled buttons, the
// menu grid (title / pause), modal panels (garage, jobs, radio) and the
// photo-mode bar. Everything is plain DOM over the canvas.
const CSS = `
.ui-layer { position: fixed; z-index: 12; pointer-events: none; -webkit-user-select: none; user-select: none; -webkit-touch-callout: none; }
.ui-layer.hidden { display: none !important; }
.pb { position: absolute; pointer-events: auto; touch-action: none; display: flex; align-items: center; justify-content: center; flex-direction: column; gap: 2px;
  color: #f4f1e8; font: 700 12px/1 'Courier New', ui-monospace, monospace; letter-spacing: 1.5px; text-transform: uppercase; cursor: pointer;
  background: rgba(12,15,26,.55); border: 2px solid rgba(244,241,232,.35); border-radius: 50%;
  box-shadow: 0 4px 18px rgba(0,0,0,.3); transition: background .08s; box-sizing: border-box; }
.pb:hover { border-color: rgba(255,205,110,.8); }
.pb.on { background: rgba(255,205,110,.55); border-color: #ffcd6e; }
.pb svg { width: 38%; height: 38%; fill: none; stroke: currentColor; stroke-width: 3; stroke-linecap: square; stroke-linejoin: miter; }
.pb.pill { border-radius: 10px; }
.pb.small { font-size: 10px; letter-spacing: 1px; }
.pb.act { background: rgba(91,146,113,.6); border-color: #9fd8b0; }
.pb small { font-size: 10px; color: #ffcd6e; letter-spacing: 1px; }
.pb.busy small { visibility: hidden; }
.pb.busy::after { content: ''; position: absolute; bottom: 6px; left: 50%; width: 10px; height: 10px; margin-left: -7px;
  border: 2px solid #ffcd6e; border-right-color: transparent; border-radius: 50%; animation: uispin .6s linear infinite; }
@keyframes uispin { to { transform: rotate(360deg); } }

.ui-menu { position: fixed; z-index: 13; display: none; gap: 10px; pointer-events: auto;
  grid-template-columns: repeat(var(--cols, 2), minmax(132px, 26vmin)); }
.ui-menu.open { display: grid; }
.ui-menu .pb { position: relative; height: clamp(38px, 10vmin, 56px); border-radius: 10px; font-size: 14px; padding: 0 8px; text-align: center; }
.ui-menu .pb small { font-size: 11px; }
.ui-menu .pb.wide { grid-column: 1 / -1; }
.ui-menu .pb.primary { background: rgba(255,205,110,.25); border-color: #ffcd6e; }

.ui-panel { position: fixed; z-index: 14; left: 50%; top: 50%; transform: translate(-50%, -50%); display: none; pointer-events: auto;
  max-width: min(94vw, 760px); max-height: 92vh; overflow: auto; box-sizing: border-box; padding: 14px 16px;
  color: #f4f1e8; font: 700 14px/1.45 'Courier New', ui-monospace, monospace; letter-spacing: 1px; text-transform: uppercase;
  background: rgba(10,13,24,.88); border: 2px solid rgba(255,205,110,.6); border-radius: 12px; box-shadow: 0 10px 40px rgba(0,0,0,.5); }
.ui-panel.open { display: block; }
/* the frame stays put (close X pinned top-right); only the body scrolls */
.ui-panel { overflow: hidden; }
.ui-panel > .ui-body { max-height: calc(92vh - 28px); overflow-y: auto; touch-action: pan-y; -webkit-overflow-scrolling: touch; overscroll-behavior: contain; padding-right: 4px; }
.ui-panel .pb.ui-x { position: absolute; top: 8px; right: 8px; z-index: 2; width: 40px; height: 40px; min-width: 40px; padding: 0;
  border-radius: 50%; font-size: 18px; line-height: 1; }
.ui-xbtn { position: fixed !important; z-index: 15; width: 48px; height: 48px; border-radius: 50%; font-size: 20px;
  top: max(12px, env(safe-area-inset-top)); right: max(18px, env(safe-area-inset-right)); }
.ui-panel h2 { margin: 0 0 10px; font-size: 16px; letter-spacing: 3px; color: #ffcd6e; }
.ui-panel .row { display: flex; gap: 10px; align-items: center; flex-wrap: wrap; margin: 8px 0; }
.ui-panel .pb { position: relative; height: 40px; min-width: 44px; padding: 0 12px; border-radius: 8px; font-size: 13px; }
.ui-panel .muted { color: #90a8c9; font-size: 12px; }
.ui-panel .bar { display: inline-block; width: 120px; height: 8px; background: rgba(144,168,201,.25); vertical-align: middle; }
.ui-panel .bar i { display: block; height: 100%; background: #ffcd6e; }
.ui-panel input[type=text] { font: 700 16px 'Courier New', monospace; letter-spacing: 3px; text-transform: uppercase; width: 9.5em;
  background: #e9c94a; color: #2a2005; border: 2px solid #2a2005; border-radius: 4px; padding: 4px 8px; text-align: center; }
.ui-swatch { width: 30px; height: 30px; border-radius: 6px; border: 2px solid rgba(255,255,255,.35); cursor: pointer; pointer-events: auto; }
.ui-swatch.sel { border-color: #ffcd6e; box-shadow: 0 0 0 2px #ffcd6e; }
.ui-list { display: flex; flex-direction: column; gap: 8px; }
.ui-list .pb { height: auto; min-height: 40px; padding: 8px 12px; border-radius: 8px; align-items: flex-start; text-align: left; }
.ui-flash { position: fixed; inset: 0; z-index: 20; background: #fff; opacity: 0; pointer-events: none; transition: opacity .25s; }
`;

let injected = false;
function inject() {
  if (injected) return;
  injected = true;
  const s = document.createElement('style');
  s.textContent = CSS;
  document.head.appendChild(s);
}

export function layer(id) {
  inject();
  let el = document.getElementById(id);
  if (!el) {
    el = document.createElement('div');
    el.id = id;
    el.className = 'ui-layer';
    el.style.inset = '0';
    document.body.appendChild(el);
  }
  return el;
}

// a pressable element. onDown fires on press, onUp when the last pointer lifts
export function button(parent, cls, html, css, onDown, onUp) {
  inject();
  const b = document.createElement('div');
  b.className = 'pb ' + (cls || '');
  b.innerHTML = html;
  if (css) Object.assign(b.style, css);
  if (parent.closest && parent.closest('.ui-panel')) return tapButton(b, parent, onDown);
  const ids = new Set();
  b.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    e.stopPropagation();
    try { b.setPointerCapture(e.pointerId); } catch (err) { /* ignore */ }
    ids.add(e.pointerId);
    b.classList.add('on');
    if (onDown) onDown(e);
  });
  const up = (e) => {
    if (!ids.delete(e.pointerId)) return;
    if (!ids.size) {
      b.classList.remove('on');
      if (onUp) onUp(e);
    }
  };
  b.addEventListener('pointerup', up);
  b.addEventListener('pointercancel', up);
  b.addEventListener('lostpointercapture', up);
  b.addEventListener('contextmenu', (e) => e.preventDefault());
  parent.appendChild(b);
  return b;
}

// a button that runs on a tap: a finger that moves (scrolls) cancels it
function tapButton(b, parent, run) {
  b.style.touchAction = 'pan-y';
  let start = null;
  b.addEventListener('pointerdown', (e) => {
    e.stopPropagation();
    start = { x: e.clientX, y: e.clientY, id: e.pointerId };
    b.classList.add('on');
  });
  b.addEventListener('pointermove', (e) => {
    if (start && e.pointerId === start.id && Math.hypot(e.clientX - start.x, e.clientY - start.y) > 10) {
      start = null;
      b.classList.remove('on');
    }
  });
  b.addEventListener('pointerup', (e) => {
    b.classList.remove('on');
    if (start && e.pointerId === start.id && run) run(e);
    start = null;
  });
  b.addEventListener('pointercancel', () => {
    start = null;
    b.classList.remove('on');
  });
  b.addEventListener('contextmenu', (e) => e.preventDefault());
  parent.appendChild(b);
  return b;
}

// spinner on a pressed button until the change has been drawn
export function busy(b) {
  b.classList.add('busy');
  const t0 = performance.now();
  const done = () => (performance.now() - t0 > 250 ? b.classList.remove('busy') : requestAnimationFrame(done));
  requestAnimationFrame(() => requestAnimationFrame(done));
}

// A grid of buttons. entries: { label(s) -> html, run(), act?(s), show?(s), cls, spin }
export class Menu {
  constructor(id, entries, getState, css = {}) {
    inject();
    this.el = document.createElement('div');
    this.el.id = id;
    this.el.className = 'ui-menu';
    Object.assign(this.el.style, css);
    document.body.appendChild(this.el);
    this.getState = getState;
    this.items = entries.map((e) => {
      const b = button(this.el, e.cls || '', '', null, () => {
        if (e.spin !== false) busy(b);
        e.run();
        this.refresh();
      });
      return { e, b, html: '' };
    });
    this.isOpen = false;
  }
  open(on) {
    if (on === this.isOpen) {
      if (on) this.refresh();
      return;
    }
    this.isOpen = on;
    this.el.classList.toggle('open', on);
    if (on) this.refresh();
  }
  refresh() {
    const s = this.getState();
    for (const it of this.items) {
      const show = it.e.show ? it.e.show(s) : true;
      it.b.style.display = show ? '' : 'none';
      if (!show) continue;
      const html = it.e.label(s);
      if (html !== it.html) {
        it.html = html;
        it.b.innerHTML = html;
      }
      if (it.e.act) it.b.classList.toggle('act', !!it.e.act(s));
    }
  }
}

// A modal panel whose body is rebuilt by render(panel)
// root = the scrolling box (with a close X pinned top-right), el = the body
// that each panel rebuilds. onClose runs when the X is tapped.
export class Panel {
  constructor(id) {
    inject();
    this.root = document.createElement('div');
    this.root.id = id;
    this.root.className = 'ui-panel';
    this.root.addEventListener('pointerdown', (e) => e.stopPropagation());
    document.body.appendChild(this.root);
    const x = button(this.root, 'ui-x', '&#x2715;', null, () => (this.onClose ? this.onClose() : this.open(false)));
    x.setAttribute('aria-label', 'Close');
    this.el = document.createElement('div');
    this.el.className = 'ui-body';
    this.root.appendChild(this.el);
    this.isOpen = false;
  }
  open(on) {
    this.isOpen = on;
    this.root.classList.toggle('open', on);
    if (on) this.el.scrollTop = 0;
  }
}

export function flash() {
  inject();
  let f = document.querySelector('.ui-flash');
  if (!f) {
    f = document.createElement('div');
    f.className = 'ui-flash';
    document.body.appendChild(f);
  }
  f.style.transition = 'none';
  f.style.opacity = '0.85';
  void f.offsetWidth; // apply the flash before starting the fade
  setTimeout(() => {
    f.style.transition = 'opacity .35s';
    f.style.opacity = '0';
  }, 30);
}

export const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
