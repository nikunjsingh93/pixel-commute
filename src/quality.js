// Graphics quality: LOW / MEDIUM / HIGH / ULTRA. Each level sets how much
// the world is filled with: city traffic and pedestrians, street furniture,
// the forest on the mountain, and how far the city and highway are built.
// Ultra is the densest; each step down thins it out. Saved per browser.
const KEY = 'pixel-commute.quality';
export const QUALITY_NAMES = ['LOW', 'MEDIUM', 'HIGH', 'ULTRA'];

const coarse = typeof window !== 'undefined' && window.matchMedia && window.matchMedia('(pointer: coarse)').matches;
let level = coarse ? 1 : 2;
try {
  const v = localStorage.getItem(KEY);
  if (v !== null && !Number.isNaN(Number(v))) level = Math.max(0, Math.min(3, Number(v)));
} catch (e) { /* default */ }

export const quality = {
  get level() { return level; },
  set level(v) {
    level = Math.max(0, Math.min(3, v));
    try { localStorage.setItem(KEY, String(level)); } catch (e) { /* ignore */ }
  },
  get name() { return QUALITY_NAMES[level]; },
  // pick the value for the current level from [low, medium, high, ultra]
  pick(t) { return t[level]; },
};
