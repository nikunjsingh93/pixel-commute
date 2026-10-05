// Geometry for the highway features the planner places: tunnels, the
// harbour bridge, roadworks and toll plazas. Each builder adds to the chunk
// being built (c = chunk context from World.buildChunk) and only produces
// the part of the feature that falls inside the chunk's [s0, s1].
import * as THREE from 'three';
import { makeCar } from './cars.js';

// cross-section constants (kept in sync with world.js)
const OPP_L = -14.2;
const ROAD_R = 16.9;

const clip = (c, a, b) => [Math.max(c.s0, a), Math.min(c.s1, b)];

// ---------------------------------------------------------------- tunnel
export function buildTunnel(W, f, c) {
  const { geo, a } = c;
  const [x0, x1] = clip(c, f.s0, f.s1);
  const TOP = 6.6, LW = -15.6, RW = 18.0;
  if (x0 < x1) {
    // inside faces: tiled walls, dark ceiling, raised walkways
    W.strip(geo.tile, [[LW, TOP], [LW, 0.35]], x0, x1, a, { mode: 'world', tile: 4 });
    W.strip(geo.tile, [[RW, 0.35], [RW, TOP]], x0, x1, a, { mode: 'world', tile: 4 });
    W.strip(geo.dark, [[RW, TOP], [LW, TOP]], x0, x1, a);
    W.strip(geo.concrete, [[ROAD_R, 0], [ROAD_R, 0.35], [RW, 0.35]], x0, x1, a);
    W.strip(geo.concrete, [[LW, 0.35], [OPP_L, 0.35], [OPP_L, 0]], x0, x1, a);
    // earth mound over the tube (seen from outside / from the portals)
    W.strip(geo.grass, [[-120, 0.2], [-46, 13], [50, 13], [124, 0.2]], x0, x1, a, { mode: 'world', tile: 6 });
    // light strips along both walls + ceiling fans + green exit signs
    for (let s = Math.ceil(x0 / 6) * 6; s < x1; s += 6) {
      W.obox(geo.lamp, s, RW - 0.08, TOP - 1.0, 2.2, 0.1, 0.16, a);
      W.obox(geo.lamp, s + 3, LW + 0.08, TOP - 1.0, 2.2, 0.1, 0.16, a);
      if (Math.round(s / 6) % 2 === 0) {
        for (const [d, s2] of [[RW - 0.4, s], [LW + 0.4, s + 3]]) {
          const p = W.path.point(s2, d, TOP - 1.05);
          c.glows.push({ x: p.x, y: p.y, z: p.z, r: 1.0, g: 0.74, b: 0.4, size: 0.55, h: TOP - 1.05, always: 1 });
        }
      }
      if (Math.round(s / 6) % 3 === 0) {
        const p = W.path.point(s, 2, TOP - 1.4);
        c.lights.push({ x: p.x, y: p.y, z: p.z, r: 1.0, g: 0.7, b: 0.4, power: 0.5, always: 1 });
      }
    }
    for (let s = Math.ceil(x0 / 60) * 60; s < x1; s += 60) {
      for (const d of [6, -7]) W.obox(geo.metal, s, d, TOP - 1.1, 2.6, 1.2, 1.0, a);
      W.obox(geo.exitSign, s + 30, RW - 0.06, 2.0, 0.6, 0.06, 0.35, a);
    }
  }
  // portals: concrete face above the opening + wing walls, at both ends
  for (const ps of [f.s0, f.s1]) {
    if (ps < c.s0 - 1 || ps > c.s1 + 1) continue;
    const out = ps === f.s0 ? -1 : 1; // which side is outside
    const sc = ps + out * 1.0;
    W.obox(geo.bridge, sc, 1.2, TOP, 2.0, 40, 7.2, a, 0, 0.25);
    W.obox(geo.bridge, sc, -32, 0, 2.0, 28, 13.8, a, 0, 0.25);
    W.obox(geo.bridge, sc, 34.5, 0, 2.0, 29, 13.8, a, 0, 0.25);
    W.obox(geo.dark, sc + out * 1.02, 1.2, TOP + 0.4, 0.05, 36, 0.6, a); // shadow line
    for (const d of [-20, 0, 20, 40]) {
      const p = W.path.point(sc + out * 1.1, d, TOP + 3.4);
      c.glows.push({ x: p.x, y: p.y, z: p.z, r: 1, g: 0.72, b: 0.4, size: 0.9, h: TOP + 3.4, lamp: 1 });
    }
  }
}

// ---------------------------------------------------------------- harbour bridge
export function harborWaterY(W, f) {
  if (f.waterY === undefined) {
    let lo = Infinity;
    for (let s = f.s0 - 60; s <= f.s1 + 60; s += 20) lo = Math.min(lo, W.path.sample(s, {}).y);
    f.waterY = lo - 13;
  }
  return f.waterY;
}

export function buildHarbor(W, f, c) {
  const { geo, a } = c;
  const wy = harborWaterY(W, f);
  const rel = (s) => wy - W.path.sample(s, {}).y; // water level relative to the road at s
  // open water across the whole harbour (a little beyond the shores)
  const [w0, w1] = clip(c, f.s0 - 2, f.s1 + 2);
  if (w0 < w1) W.strip(geo.water, (s) => [[-900, rel(s)], [900, rel(s)]], w0, w1, a, { mode: 'world', tile: 12 });
  // seawalls where the land ends
  for (const [ps, dir] of [[f.s0, -1], [f.s1, 1]]) {
    if (ps < c.s0 - 3 || ps > c.s1 + 3) continue;
    const r = rel(ps);
    W.obox(geo.bridge, ps + dir * 2, 0, r, 4, 900, -r + 0.2, a, 0, 0.25);
  }
  const [x0, x1] = clip(c, f.s0, f.s1);
  if (x0 < x1) {
    // deck: outer faces, parapets, underside
    W.strip(geo.bridge, [[-15.6, -1.6], [-15.6, 0.95]], x0, x1, a, { mode: 'world', tile: 4 });
    W.strip(geo.bridge, [[-15.6, 0.95], [-15.1, 0.95], [-15.1, 0], [OPP_L, 0]], x0, x1, a, { mode: 'world', tile: 4 });
    W.strip(geo.bridge, [[ROAD_R, 0], [17.7, 0], [17.7, 0.95], [18.2, 0.95]], x0, x1, a, { mode: 'world', tile: 4 });
    W.strip(geo.bridge, [[18.2, 0.95], [18.2, -1.6]], x0, x1, a, { mode: 'world', tile: 4 });
    W.strip(geo.dark, [[18.2, -1.6], [-15.6, -1.6]], x0, x1, a);
    // railings on the parapets
    for (let s = Math.ceil(x0 / 2.5) * 2.5; s < x1; s += 2.5) {
      W.obox(geo.metal, s, -15.35, 0.95, 0.08, 0.08, 0.6, a);
      W.obox(geo.metal, s, 17.95, 0.95, 0.08, 0.08, 0.6, a);
    }
    W.strip(geo.metal, [[-15.4, 1.55], [-15.3, 1.55]], x0, x1, a);
    W.strip(geo.metal, [[17.9, 1.55], [18.0, 1.55]], x0, x1, a);
    // piers into the water
    for (let s = Math.ceil((x0 - f.s0) / 70) * 70 + f.s0; s < x1; s += 70) {
      if (s - f.s0 < 20 || f.s1 - s < 20) continue;
      const r = rel(s);
      W.obox(geo.bridge, s, 1.3, r, 4, 24, -r - 1.6, a, 0, 0.25);
    }
    // two cable-stayed pylons
    const L = f.s1 - f.s0;
    for (const ps of [f.s0 + L * 0.34, f.s0 + L * 0.68]) {
      if (ps < x0 - 130 || ps > x1 + 130) continue;
      if (ps >= x0 && ps < x1) {
        const r = rel(ps);
        for (const d of [-17.4, 20]) W.obox(geo.bridge, ps, d, r, 3, 2.4, 60 - r, a, 0, 0.25);
        W.obox(geo.bridge, ps, 1.3, 38, 3, 40, 2.2, a, 0, 0.25);
        W.obox(geo.bridge, ps, 1.3, 56, 3, 40, 2.0, a, 0, 0.25);
        for (const d of [-17.4, 20]) {
          const p = W.path.point(ps, d, 60.6);
          c.glows.push({ x: p.x, y: p.y, z: p.z, r: 1, g: 0.15, b: 0.1, size: 1.6, blink: d });
        }
      }
      // stay cables fanning out to the deck edges (1-pixel lines)
      for (let k = 1; k <= 9; k++) {
        for (const dir of [-1, 1]) {
          const sd = ps + dir * k * 13;
          if (sd < x0 || sd >= x1) continue;
          for (const [dp, dd] of [[-17.4, -15.4], [20, 18.0]]) {
            const top = W.path.point(ps, dp, 57 - k * 1.6);
            const bot = W.path.point(sd, dd, 1.0);
            c.lines.push(top.x - a.x, top.y - a.y, top.z - a.z, bot.x - a.x, bot.y - a.y, bot.z - a.z);
          }
        }
      }
    }
  }
  // harbour scenery beside the bridge: a container terminal with cranes on
  // the left, ships at anchor on the right
  const mid = (f.s0 + f.s1) / 2;
  const [t0, t1] = clip(c, f.s0 + 60, f.s1 - 60);
  if (t0 < t1) {
    const R = (k) => {
      const x = Math.sin((f.id * 31.7 + k) * 12.9898) * 43758.5453;
      return x - Math.floor(x);
    };
    // terminal quay
    W.strip(geo.concrete, (s) => [[-330, rel(s) + 3], [-150, rel(s) + 3], [-150, rel(s)]], t0, t1, a, { mode: 'world', tile: 8 });
    const COLS = ['#a33a2a', '#2c4a6e', '#d6b23e', '#3d5c47', '#8c8f99', '#e58a35'];
    for (let s = Math.ceil(t0 / 14) * 14; s < t1; s += 14) {
      for (let row = 0; row < 5; row++) {
        const n = 1 + Math.floor(R(s * 0.37 + row) * 4);
        for (let h = 0; h < n; h++) {
          geo.colored.col = COLS[Math.floor(R(s + row * 7 + h * 3) * COLS.length)];
          W.obox(geo.colored, s, -190 - row * 9, rel(s) + 3 + h * 2.6, 12, 2.5, 2.55, a);
        }
      }
    }
    // gantry cranes
    for (let s = Math.ceil(t0 / 90) * 90 + 30; s < t1; s += 90) {
      const r = rel(s) + 3;
      geo.colored.col = '#c9a23a';
      for (const ds of [-6, 6]) for (const dd of [-163, -179]) W.obox(geo.colored, s + ds, dd, r, 1.2, 1.2, 40, a);
      W.obox(geo.colored, s, -150, r + 40, 2.4, 70, 2.2, a);
      W.obox(geo.colored, s, -171, r + 42, 14, 6, 4, a);
      const p = W.path.point(s, -118, r + 41);
      c.glows.push({ x: p.x, y: p.y, z: p.z, r: 1, g: 0.15, b: 0.1, size: 1.5, blink: s * 0.01 });
    }
    // ships
    if (mid >= c.s0 && mid < c.s1) {
      for (const [ds, dd, len] of [[-60, 210, 150], [120, 380, 110], [-160, -420, 130]]) {
        const s = mid + ds;
        const r = rel(s);
        geo.colored.col = '#3a1a1e';
        W.obox(geo.colored, s, dd, r - 3, len, 22, 9, a);
        geo.colored.col = '#d8d2c2';
        W.obox(geo.colored, s - len * 0.36, dd, r + 6, 18, 18, 12, a);
        W.obox(geo.colored, s - len * 0.36, dd, r + 18, 8, 6, 6, a);
        for (let k = 0; k < 6; k++) {
          const p = W.path.point(s - len * 0.36 + (k - 2.5) * 2.5, dd - 9.2, r + 10 + (k % 2) * 4);
          c.glows.push({ x: p.x, y: p.y, z: p.z, r: 1, g: 0.85, b: 0.55, size: 0.9, lamp: 1, wy });
        }
        for (const off of [-0.5, 0.5]) {
          const p = W.path.point(s + off * len, dd, r + 8);
          c.glows.push({ x: p.x, y: p.y, z: p.z, r: 1, g: 0.95, b: 0.8, size: 1.2, lamp: 1, wy });
        }
      }
    }
  }
}

// ---------------------------------------------------------------- roadworks
function coneD(f, s) {
  // taper from the lane line into the closed lane, run along, taper back out
  const open = 14.4, shut = 10.95;
  if (s < f.s0 + 60) return open + (shut - open) * ((s - f.s0) / 60);
  if (s > f.s1 - 40) return shut + (open - shut) * ((s - (f.s1 - 40)) / 40);
  return shut;
}

export function buildWorks(W, f, c) {
  const { geo, a } = c;
  // warning signs before the zone
  for (const [ds, lines] of [[-320, ['ROAD WORK', 'AHEAD']], [-160, ['RIGHT LANE', 'CLOSED']]]) {
    const s = f.s0 + ds;
    if (s < c.s0 || s >= c.s1) continue;
    W.obox(geo.metal, s, 18.6, 0.16, 0.12, 0.12, 2.4, a);
    c.signs.push({ s: s - 0.05, d: 18.6, y: 2.1, w: 2.4, h: 1.2, mat: W.mWorksSigns[ds < -200 ? 0 : 1] });
  }
  const [x0, x1] = clip(c, f.s0, f.s1);
  if (x0 >= x1) return;
  // cones every 4 m (knockable), amber flashers on every third
  for (let s = Math.ceil(x0 / 4) * 4; s < x1; s += 4) {
    const d = coneD(f, s);
    c.cones.push({ s, d, knocked: false });
    if (Math.round(s / 4) % 3 === 0) {
      const p = W.path.point(s, d, 0.95);
      c.glows.push({ x: p.x, y: p.y, z: p.z, r: 2.2, g: 1.2, b: 0.15, size: 0.45, blink: s * 0.37, always: 1 });
    }
  }
  // arrow board trailer at the start of the taper
  const sa = f.s0 + 8;
  if (sa >= x0 && sa < x1) {
    W.obox(geo.dark, sa, 12.6, 0.3, 2.4, 1.8, 0.8, a);
    W.obox(geo.metal, sa, 12.6, 1.1, 0.2, 0.2, 1.4, a);
    c.boards.push({ s: sa - 0.2, d: 12.6, y: 2.2, w: 2.6, h: 1.3, mat: W.mArrow, face: 'back', flash: true });
    const p = W.path.point(sa - 1.6, 12.6, 2.85);
    c.glows.push({ x: p.x, y: p.y, z: p.z, r: 2.4, g: 1.3, b: 0.2, size: 1.1, blink: 0, always: 1 });
  }
  // concrete barrier blocks + a parked work truck inside the closed lane
  const run0 = Math.max(x0, f.s0 + 70), run1 = Math.min(x1, f.s1 - 50);
  for (let s = Math.ceil(run0 / 3) * 3; s < run1; s += 3) {
    geo.colored.col = Math.round(s / 3) % 2 ? '#e8e4da' : '#c62a25';
    W.obox(geo.colored, s, 11.5, 0, 2.8, 0.5, 0.85, a);
  }
  if (run1 - run0 > 1) c.obstacles.push({ s: (run0 + run1) / 2, d: 11.5, L: run1 - run0, W: 0.5, kind: 'barrier' });
  const st = f.s0 + 150;
  if (st >= x0 && st < x1) {
    const car = makeCar('truck', '#e8762a', true);
    const p = W.path.sample(st, {});
    car.group.position.set(p.x + p.rx * 13.2 - a.x, p.y - a.y, p.z + p.rz * 13.2 - a.z);
    car.group.rotation.y = p.h;
    c.meshes.push(car.group);
    c.obstacles.push({ s: st, d: 13.2, L: 7.6, W: 2.4, kind: 'truck' });
    const q = W.path.point(st + 2, 13.2, 3.6);
    c.glows.push({ x: q.x, y: q.y, z: q.z, r: 2.4, g: 1.3, b: 0.2, size: 0.8, blink: 1.3, always: 1 });
  }
  // a lit work area: a few portable floodlights
  for (let s = Math.ceil(x0 / 60) * 60 + 20; s < x1; s += 60) {
    if (s < f.s0 + 70 || s > f.s1 - 50) continue;
    W.obox(geo.metal, s, 15.6, 0.16, 0.12, 0.12, 4.2, a);
    W.obox(geo.lamp, s, 15.2, 4.2, 0.4, 0.8, 0.3, a);
    const p = W.path.point(s, 15.0, 4.3);
    c.glows.push({ x: p.x, y: p.y, z: p.z, r: 1.1, g: 1.05, b: 0.95, size: 1.2, h: 4.3, lamp: 1 });
    c.lights.push({ x: p.x, y: p.y, z: p.z, r: 1, g: 0.95, b: 0.85, power: 0.6 });
  }
}

// ---------------------------------------------------------------- toll plaza
export const TOLL_ISLANDS = [3.6, 7.2, 10.8, -6.35, -9.95];

export function buildToll(W, f, c) {
  const { geo, a } = c;
  const sT = (f.s0 + f.s1) / 2;
  // advance sign
  const sp = f.s0 - 380;
  if (sp >= c.s0 && sp < c.s1) {
    W.obox(geo.metal, sp, 18.6, 0.16, 0.14, 0.14, 2.6, a);
    c.signs.push({ s: sp - 0.05, d: 18.6, y: 2.2, w: 2.6, h: 1.3, mat: W.mTollSign });
  }
  if (sT < c.s0 - 20 || sT > c.s1 + 20) return;
  if (sT >= c.s0 && sT < c.s1) {
    // canopy over both carriageways
    W.obox(geo.bridge, sT, 1.4, 6.2, 16, 36, 1.3, a, 0, 0.25);
    geo.colored.col = '#c62a25';
    W.obox(geo.colored, sT, 1.4, 7.5, 16.4, 36.4, 0.25, a);
    for (const d of [-12, -6, 0, 6, 12]) {
      W.obox(geo.lamp, sT, d + 1.4, 6.1, 10, 0.5, 0.08, a);
      const p = W.path.point(sT, d + 1.4, 6.0);
      c.lights.push({ x: p.x, y: p.y, z: p.z, r: 1, g: 0.9, b: 0.75, power: 0.5, always: 1 });
    }
    for (const side of [-1, 1]) {
      const s = sT + side * 8.1;
      c.signs.push({ s, d: 1.4, y: 6.3, w: 7, h: 1.0, mat: W.mTollCanopy, back: side > 0 });
    }
    // islands with booths and lifting barrier arms
    for (const d of TOLL_ISLANDS) {
      geo.colored.col = '#d6b23e';
      W.obox(geo.colored, sT - 12.6, d, 0, 1.2, 1.1, 0.3, a);
      W.obox(geo.concrete, sT, d, 0, 24, 1.1, 0.28, a);
      W.obox(geo.bridge, sT + 2, d, 0.28, 3.2, 1.0, 2.3, a, 0, 0.25);
      W.obox(geo.dark, sT + 2, d, 2.58, 3.6, 1.3, 0.15, a);
      W.obox(geo.booth, sT + 2, d, 1.2, 2.2, 1.04, 0.9, a);
      W.obox(geo.metal, sT, d, 0.28, 0.25, 0.25, 6, a); // canopy column
      const p = W.path.point(sT + 2, d, 1.7);
      c.glows.push({ x: p.x, y: p.y, z: p.z, r: 1, g: 0.85, b: 0.55, size: 0.7, always: 1 });
      c.obstacles.push({ s: sT, d, L: 26, W: 1.1, kind: 'island' });
    }
    // barrier arms over our 4 lanes (animated in main)
    for (let lane = 0; lane < 4; lane++) {
      const pivotD = lane === 0 ? 0.25 : [3.6, 7.2, 10.8][lane - 1] + 0.55;
      c.arms.push({ s: sT + 5, d: pivotD, lane, len: lane === 0 ? 3.0 : 2.4 });
    }
  }
}
