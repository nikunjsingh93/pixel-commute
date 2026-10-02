// On-screen touch controls (phones / tablets), laid out like Open Road's:
//   bottom-left : steer left / right
//   bottom-right: gas (big), brake, handbrake above gas
//   top-right   : one hamburger button -> pauses and opens the menu
//                 (camera, autopilot, time, weather, radio, fullscreen)
// Buttons press the same key codes as the keyboard, so the game reads one input.
const CSS = `
#tctl, #tmenu { position: fixed; z-index: 12; pointer-events: none; display: none; -webkit-user-select: none; user-select: none; -webkit-touch-callout: none; touch-action: none; }
#tctl { inset: 0; }
body.touch #tctl { display: block; }
#tctl.hidden { display: none !important; }
body.touch canvas { touch-action: none; }
.tb { position: absolute; pointer-events: auto; touch-action: none; display: flex; align-items: center; justify-content: center; flex-direction: column; gap: 2px;
  color: #f4f1e8; font: 700 12px/1 'Courier New', ui-monospace, monospace; letter-spacing: 1.5px; text-transform: uppercase;
  background: rgba(12,15,26,.45); border: 2px solid rgba(244,241,232,.35); border-radius: 50%;
  box-shadow: 0 4px 18px rgba(0,0,0,.3); transition: background .08s; }
.tb.on { background: rgba(255,205,110,.55); border-color: #ffcd6e; }
.tb svg { width: 38%; height: 38%; fill: none; stroke: currentColor; stroke-width: 3; stroke-linecap: square; stroke-linejoin: miter; }
.tb.pill { border-radius: 10px; }
.tb.small { font-size: 10px; letter-spacing: 1px; }
.tb.burger svg { width: 46%; height: 46%; }
#tmenu { right: max(18px, env(safe-area-inset-right)); top: 50%; transform: translateY(-50%);
  grid-template-columns: repeat(2, minmax(118px, 26vmin)); gap: 10px; }
#tmenu.open { display: grid; pointer-events: auto; }
#tmenu .tb { position: static; height: clamp(40px, 11vmin, 54px); border-radius: 10px; font-size: 11px; padding: 0 8px; text-align: center; }
#tmenu .tb small { font-size: 9px; color: #ffcd6e; letter-spacing: 1px; }
#tmenu .tb.act { background: rgba(91,146,113,.6); border-color: #9fd8b0; }
#tmenu .tb.resume { grid-column: 1 / -1; background: rgba(255,205,110,.25); border-color: #ffcd6e; }
`;

const chev = (dir) => `<svg viewBox="0 0 24 24"><path d="${dir < 0 ? 'M15 4 7 12l8 8' : 'M9 4l8 8-8 8'}"/></svg>`;
const burger = '<svg viewBox="0 0 24 24"><path d="M4 6h16M4 12h16M4 18h16"/></svg>';

export function isTouchDevice() {
  return (window.matchMedia && window.matchMedia('(pointer: coarse)').matches) || (navigator.maxTouchPoints > 0 && 'ontouchstart' in window);
}

// game: { keys: Set, press(code), driving(), menuOpen(), state() -> labels, fullscreen() }
export function setupTouch(game) {
  const style = document.createElement('style');
  style.textContent = CSS;
  document.head.appendChild(style);
  const root = document.createElement('div');
  root.id = 'tctl';
  document.body.appendChild(root);
  const menu = document.createElement('div');
  menu.id = 'tmenu';
  document.body.appendChild(menu);

  const inset = 'max(18px, env(safe-area-inset-';
  const mk = (parent, cls, html, css, onDown, onUp) => {
    const b = document.createElement('div');
    b.className = 'tb ' + cls;
    b.innerHTML = html;
    Object.assign(b.style, css);
    const ids = new Set();
    b.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      e.stopPropagation();
      try { b.setPointerCapture(e.pointerId); } catch (err) { /* ignore */ }
      ids.add(e.pointerId);
      b.classList.add('on');
      if (onDown) onDown();
    });
    const up = (e) => {
      if (!ids.delete(e.pointerId)) return;
      if (!ids.size) {
        b.classList.remove('on');
        if (onUp) onUp();
      }
    };
    b.addEventListener('pointerup', up);
    b.addEventListener('pointercancel', up);
    b.addEventListener('lostpointercapture', up);
    b.addEventListener('contextmenu', (e) => e.preventDefault());
    parent.appendChild(b);
    return b;
  };
  const hold = (code) => [() => game.keys.add(code), () => game.keys.delete(code)];
  const S = 'clamp(64px, 17vmin, 104px)'; // steering buttons
  const G = 'clamp(84px, 24vmin, 132px)'; // gas
  const K = 'clamp(70px, 19vmin, 112px)'; // brake
  const bl = `calc(${inset}left) + 0px)`, br = `calc(${inset}right) + 0px)`, bb = `calc(${inset}bottom) + 0px)`;

  // steering (bottom-left)
  mk(root, '', chev(-1), { width: S, height: S, left: bl, bottom: bb }, ...hold('KeyA'));
  mk(root, '', chev(1), { width: S, height: S, left: `calc(${bl} + ${S} + 16px)`, bottom: bb }, ...hold('KeyD'));
  // pedals (bottom-right)
  mk(root, '', '<span>Gas</span>', { width: G, height: G, right: br, bottom: bb }, ...hold('KeyW'));
  mk(root, '', '<span>Brake</span>', { width: K, height: K, right: `calc(${br} + ${G} + 14px)`, bottom: bb }, ...hold('KeyS'));
  const HB = 'clamp(56px, 14vmin, 84px)';
  mk(root, 'small', '<span>Hand</span><span>brake</span>', { width: HB, height: HB, right: br, bottom: `calc(${bb} + ${G} + 14px)` }, ...hold('ShiftLeft'));

  // the only top button: hamburger -> menu
  const T = 'clamp(44px, 11vmin, 56px)';
  mk(root, 'pill burger', burger, { width: T, height: T, top: 'max(12px, env(safe-area-inset-top))', right: br }, () => game.press('Escape'));

  // menu (shown while paused); each entry shows its current setting
  const entries = [
    { cls: 'resume', label: () => 'Resume', code: 'Escape' },
    { label: (s) => `Camera<small>${s.cam}</small>`, code: 'KeyC' },
    { label: (s) => `Autopilot<small>${s.auto ? 'on' : 'off'}</small>`, code: 'Space', act: (s) => s.auto },
    { label: (s) => `Time<small>${s.period}</small>`, code: 'KeyT' },
    { label: (s) => `Weather<small>${s.weather}</small>`, code: 'KeyR' },
    { label: (s) => `Radio<small>${s.radio ? 'on' : 'off'}</small>`, code: 'KeyM', act: (s) => s.radio },
    { label: (s) => `Station<small>${s.station}</small>`, code: 'KeyN' },
    { label: () => `Fullscreen<small>toggle</small>`, fn: () => game.fullscreen() },
  ];
  const items = entries.map((e) => {
    const b = mk(menu, e.cls || '', '', {}, () => (e.fn ? e.fn() : game.press(e.code)));
    return { e, b, html: '' };
  });
  const refresh = () => {
    const s = game.state();
    for (const it of items) {
      const html = it.e.label(s);
      if (html !== it.html) {
        it.html = html;
        it.b.innerHTML = html;
      }
      if (it.e.act) it.b.classList.toggle('act', !!it.e.act(s));
    }
  };

  // drive buttons only while driving; the menu only while paused
  setInterval(() => {
    root.classList.toggle('hidden', !game.driving());
    const open = game.menuOpen();
    menu.classList.toggle('open', open);
    if (open) refresh();
  }, 100);

  // never let the page scroll / zoom while playing
  for (const ev of ['touchmove', 'gesturestart']) document.addEventListener(ev, (e) => e.preventDefault(), { passive: false });
  document.addEventListener('contextmenu', (e) => e.preventDefault());
}
