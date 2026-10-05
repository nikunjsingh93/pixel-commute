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

  // steering (bottom-left)
  button(root, '', chev(-1), { width: S, height: S, left: bl, bottom: bb }, ...hold('KeyA'));
  button(root, '', chev(1), { width: S, height: S, left: `calc(${bl} + ${S} + 16px)`, bottom: bb }, ...hold('KeyD'));
  // pedals (bottom-right)
  button(root, '', '<span>Gas</span>', { width: G, height: G, right: br, bottom: bb }, ...hold('KeyW'));
  button(root, '', '<span>Brake</span>', { width: K, height: K, right: `calc(${br} + ${G} + 14px)`, bottom: bb }, ...hold('KeyS'));
  const HB = 'clamp(56px, 14vmin, 84px)';
  button(root, 'small', '<span>Hand</span><span>brake</span>', { width: HB, height: HB, right: br, bottom: `calc(${bb} + ${G} + 14px)` }, ...hold('ShiftLeft'));

  // the only top button: hamburger -> pause menu
  const T = 'clamp(44px, 11vmin, 56px)';
  button(root, 'pill', burgerIcon, { width: T, height: T, top: 'max(12px, env(safe-area-inset-top))', right: br }, () => game.press('Escape'));

  setInterval(() => root.classList.toggle('hidden', !game.driving()), 100);

  // never let the page scroll / zoom while playing
  for (const ev of ['touchmove', 'gesturestart']) document.addEventListener(ev, (e) => e.preventDefault(), { passive: false });
  document.addEventListener('contextmenu', (e) => e.preventDefault());
}
