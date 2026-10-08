// On-screen driving controls for phones / tablets, laid out like Open Road's:
//   bottom-left : steer left / right
//   bottom-right: gas (big), brake, handbrake above gas
//   top-right   : one hamburger button -> pause menu (shared with desktop, see ui.js)
// Buttons press the same key codes as the keyboard, so the game reads one input.
import { layer, button } from './ui.js';

const chev = (dir) => `<svg viewBox="0 0 24 24"><path d="${dir < 0 ? 'M15 4 7 12l8 8' : 'M9 4l8 8-8 8'}"/></svg>`;
export const burgerIcon = '<svg viewBox="0 0 24 24" style="width:46%;height:46%"><path d="M4 6h16M4 12h16M4 18h16"/></svg>';
// distance from a screen edge, respecting notches / home bars
export const edge = (side) => `max(18px, env(safe-area-inset-${side}))`;

export function isTouchDevice() {
  return (window.matchMedia && window.matchMedia('(pointer: coarse)').matches) || (navigator.maxTouchPoints > 0 && 'ontouchstart' in window);
}

// game: { keys: Set, press(code), driving() }
export function setupTouch(game) {
  const root = layer('tctl');
  const hold = (code) => [() => game.keys.add(code), () => game.keys.delete(code)];
  const S = 'clamp(64px, 17vmin, 104px)'; // steering buttons
  const G = 'clamp(84px, 24vmin, 132px)'; // gas
  const K = 'clamp(70px, 19vmin, 112px)'; // brake
  const bl = edge('left'), br = edge('right'), bb = edge('bottom');

  // driving controls (hidden on foot)
  const drive = [];
  // steering (bottom-left)
  drive.push(button(root, '', chev(-1), { width: S, height: S, left: bl, bottom: bb }, ...hold('KeyA')));
  drive.push(button(root, '', chev(1), { width: S, height: S, left: `calc(${bl} + ${S} + 16px)`, bottom: bb }, ...hold('KeyD')));
  // pedals (bottom-right)
  drive.push(button(root, '', '<span>Gas</span>', { width: G, height: G, right: br, bottom: bb }, ...hold('KeyW')));
  drive.push(button(root, '', '<span>Brake</span>', { width: K, height: K, right: `calc(${br} + ${G} + 14px)`, bottom: bb }, ...hold('KeyS')));
  const HB = 'clamp(56px, 14vmin, 84px)';
  drive.push(button(root, 'small', '<span>Hand</span><span>brake</span>', { width: HB, height: HB, right: br, bottom: `calc(${bb} + ${G} + 14px)` }, ...hold('ShiftLeft')));
  // get out of the car: directly above the handbrake
  const door = button(root, 'small', '<span>Exit</span><span>car</span>', { width: HB, height: HB, right: br, bottom: `calc(${bb} + ${G} + ${HB} + 26px)` }, () => game.press('KeyF'));

  // on foot: a move stick (bottom-left), act + run (bottom-right)
  const foot = [];
  const J = 'clamp(110px, 30vmin, 170px)';
  const joy = document.createElement('div');
  joy.className = 'joy';
  Object.assign(joy.style, { position: 'absolute', left: bl, bottom: bb, width: J, height: J, borderRadius: '50%', pointerEvents: 'auto', touchAction: 'none',
    background: 'rgba(12,15,26,.35)', border: '2px solid rgba(244,241,232,.3)' });
  const knob = document.createElement('div');
  Object.assign(knob.style, { position: 'absolute', left: '50%', top: '50%', width: '40%', height: '40%', margin: '-20% 0 0 -20%', borderRadius: '50%', background: 'rgba(244,241,232,.35)', pointerEvents: 'none' });
  joy.appendChild(knob);
  root.appendChild(joy);
  foot.push(joy);
  let jid = null;
  const jmove = (e) => {
    const r = joy.getBoundingClientRect();
    let x = (e.clientX - (r.left + r.width / 2)) / (r.width / 2), y = (e.clientY - (r.top + r.height / 2)) / (r.height / 2);
    const l = Math.hypot(x, y);
    if (l > 1) { x /= l; y /= l; }
    knob.style.transform = `translate(${x * 60}%, ${y * 60}%)`;
    if (game.stick) game.stick(x, -y);
  };
  joy.addEventListener('pointerdown', (e) => { e.preventDefault(); e.stopPropagation(); jid = e.pointerId; try { joy.setPointerCapture(jid); } catch (err) { /* */ } jmove(e); });
  joy.addEventListener('pointermove', (e) => { if (e.pointerId === jid) jmove(e); });
  const jend = (e) => { if (e.pointerId !== jid) return; jid = null; knob.style.transform = ''; if (game.stick) game.stick(0, 0); };
  joy.addEventListener('pointerup', jend);
  joy.addEventListener('pointercancel', jend);
  foot.push(button(root, '', '<span>Act</span>', { width: G, height: G, right: br, bottom: bb }, () => game.press('KeyF')));
  foot.push(button(root, 'small', '<span>Jump</span>', { width: HB, height: HB, right: br, bottom: `calc(${bb} + ${G} + 14px)` }, () => game.press('Space')));
  const runB = button(root, 'small', '<span>Run</span>', { width: HB, height: HB, right: `calc(${br} + ${G} + 14px)`, bottom: bb }, () => game.press('KeyRun'));
  foot.push(runB);
  setInterval(() => {
    const onFoot = game.onFoot ? game.onFoot() : false;
    for (const b of drive) b.style.display = onFoot ? 'none' : '';
    for (const b of foot) b.style.display = onFoot ? '' : 'none';
    door.style.display = onFoot ? 'none' : '';
    runB.classList.toggle('act', !!(game.running && game.running()));
  }, 150);

  // manual gearbox: shift up / down above the steering buttons
  const GB = 'clamp(48px, 12vmin, 66px)';
  const up = button(root, 'small', '<span>Gear</span><span>+</span>', { width: GB, height: GB, left: bl, bottom: `calc(${bb} + ${S} + 14px)` }, () => game.press('KeyE'));
  const dn = button(root, 'small', '<span>Gear</span><span>-</span>', { width: GB, height: GB, left: `calc(${bl} + ${GB} + 12px)`, bottom: `calc(${bb} + ${S} + 14px)` }, () => game.press('KeyQ'));
  setInterval(() => {
    const man = game.manual ? game.manual() : false;
    up.style.display = dn.style.display = man ? '' : 'none';
  }, 150);

  // the only top button: hamburger -> pause menu
  const T = 'clamp(44px, 11vmin, 56px)';
  button(root, 'pill', burgerIcon, { width: T, height: T, top: 'max(12px, env(safe-area-inset-top))', right: br }, () => game.press('Escape'));

  setInterval(() => root.classList.toggle('hidden', !game.driving()), 100);

  // never let the page scroll / zoom while playing
  // (panels such as the garage still scroll with a finger)
  for (const ev of ['touchmove', 'gesturestart']) {
    document.addEventListener(ev, (e) => {
      if (!(e.target && e.target.closest && e.target.closest('.ui-panel'))) e.preventDefault();
    }, { passive: false });
  }
  document.addEventListener('contextmenu', (e) => e.preventDefault());
}
