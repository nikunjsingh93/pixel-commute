// A city zone at runtime (the CityNet): it plugs into the world like an exit
// network (netAt / contains / pushOut / update / render), but is far larger,
// so its geometry is streamed in 160 m tiles around the focus (the car or the
// person on foot). It also answers the layered ground query: the expressway
// deck, the ramps, and the city streets / mountain below them.
import * as THREE from 'three';
import { hash } from './path.js';
import { deckAt } from './planner.js';
import { CityLayout, LANE, DECK_V0, DECK_V1, CITY_V0, CITY_V1, nearestOn, cumLen, along, clamp } from './citylayout.js';
import { cityMaterials, cityNight, buildStreets, upQuad, wallQuad, lbox, ribbon } from './citybuild.js';
import { CityKit, kitMaterials } from './citykit.js';
import { ROAD_R } from './world.js';

const TILE = 160;
import { quality } from './quality.js';
// tiles whose centre is closer than the build radius get built (by quality)
const buildR = () => quality.pick([320, 420, 540, 700]);
const dropR = () => quality.pick([460, 580, 760, 920]);

// one layout per city feature (the highway chunks need it too)
export function cityLayout(f) {
  if (!f._lay) f._lay = new CityLayout(f);
  return f._lay;
}

export class CityNet {
  constructor(world, f, GeoB) {
    this.W = world;
    this.f = f;
    this.GeoB = GeoB;
    this.city = true;
    this.S = f.s0;
    this.L = f.s1 - f.s0;
    if (f.base === undefined) f.base = world.path.naturalHeight(f.s0);
    this.base = f.base;
    this.lay = cityLayout(f);
    this.name = f.name;
    const p = world.path.sample(this.S, {});
    // the zone is straight: a fixed frame (F along, Rv across)
    this.O = { x: p.x, z: p.z };
    this.F = { x: p.fx, z: p.fz };
    this.Rv = { x: p.rx, z: p.rz };
    this.A = { x: p.x, y: this.base, z: p.z }; // anchor of all city geometry
    this.Aw = this.A;
    this.R = (k) => hash(f.id * 7.77 + k * 0.917);
    this.cars = [];
    this.obstacles = [];
    this.glows = [];
    this.lights = [];
    this.drops = [];
    this.fuel = false;
    this.tiles = new Map();
    this.root = new THREE.Group();
    world.root.add(this.root);
    this.root.position.set(this.A.x - world.origin.x, this.A.y - world.origin.y, this.A.z - world.origin.z);
    this.mats = cityMaterials(world);
    this.tkMats = world.tk;
    this.time = 0;
    this.layoutStreets();
    this.planBuildings();
    this.structureObstacles();
    this.buildAlways();
  }

  // ---------------------------------------------------------------- frame
  get s0() { return this.S - 4; }
  get s1() { return this.S + this.L + 4; }
  // local point (relative to the anchor) for zone coords + height above base
  wp(u, v, h) {
    return [this.F.x * u + this.Rv.x * v, h, this.F.z * u + this.Rv.z * v];
  }
  deck(u) {
    return deckAt(this.f, u);
  }
  terrain(u, v) {
    return this.lay.terrain(u, v);
  }

  // ---------------------------------------------------------------- streets
  // the street surface pieces, pavements, crossings, lamps and signals, each
  // assigned to the tile its centre falls in
  layoutStreets() {
    const lay = this.lay, PAVE = lay.PAVE;
    const pieces = [];
    const lamps = [];
    const signals = [];
    const nodesOn = (a) => lay.nodes.filter((n) => n.a === a).sort((p, q) => p.u - q.u);
    const nodesOnC = (c) => lay.nodes.filter((n) => n.c === c).sort((p, q) => p.v - q.v);
    for (const a of lay.avenues) {
      const ns = nodesOn(a);
      for (let i = 0; i < ns.length - 1; i++) {
        const u0 = ns[i].u + ns[i].c.hw, u1 = ns[i + 1].u - ns[i + 1].c.hw;
        pieces.push({ kind: 'ave', nl: a.nl, u0, u1, v0: a.v - a.hw, v1: a.v + a.hw });
        // pavements both sides (kerb faces the street)
        pieces.push({ kind: 'pave', u0, u1, v0: a.v + a.hw, v1: a.v + a.hw + PAVE, kerbs: [[u0, a.v + a.hw, u1, a.v + a.hw, (u0 + u1) / 2, a.v + a.hw + 1]] });
        pieces.push({ kind: 'pave', u0, u1, v0: a.v - a.hw - PAVE, v1: a.v - a.hw, kerbs: [[u0, a.v - a.hw, u1, a.v - a.hw, (u0 + u1) / 2, a.v - a.hw - 1]] });
        // lamps every 34 m on both kerbs (skip the deck band side under the viaduct)
        for (let u = u0 + 14; u < u1 - 8; u += 34) {
          for (const side of [1, -1]) {
            const v = a.v + side * (a.hw + 0.9);
            if (lay.underDeck(u, v)) continue;
            lamps.push({ u, v, toward: -side });
          }
        }
      }
    }
    for (const c of lay.cross) {
      const ns = nodesOnC(c);
      for (let i = 0; i < ns.length - 1; i++) {
        const v0 = ns[i].v + ns[i].a.hw, v1 = ns[i + 1].v - ns[i + 1].a.hw;
        // pavements stop short of the avenue pavements (those take the corners)
        const pv0 = v0 + PAVE, pv1 = v1 - PAVE;
        pieces.push({ kind: 'cross', nl: c.nl, u0: c.u - c.hw, u1: c.u + c.hw, v0, v1 });
        if (pv1 > pv0) {
          pieces.push({ kind: 'pave', u0: c.u + c.hw, u1: c.u + c.hw + PAVE, v0: pv0, v1: pv1, kerbs: [[c.u + c.hw, pv0, c.u + c.hw, pv1, c.u + c.hw + 1, (pv0 + pv1) / 2]] });
          pieces.push({ kind: 'pave', u0: c.u - c.hw - PAVE, u1: c.u - c.hw, v0: pv0, v1: pv1, kerbs: [[c.u - c.hw, pv0, c.u - c.hw, pv1, c.u - c.hw - 1, (pv0 + pv1) / 2]] });
          // the bits of pavement beside the avenue pavements' ends
          for (const [pa, pb] of [[v0, pv0], [pv1, v1]]) {
            pieces.push({ kind: 'pave', u0: c.u + c.hw, u1: c.u + c.hw + PAVE, v0: pa, v1: pb, kerbs: [[c.u + c.hw, pa, c.u + c.hw, pb, c.u + c.hw + 1, (pa + pb) / 2]] });
            pieces.push({ kind: 'pave', u0: c.u - c.hw - PAVE, u1: c.u - c.hw, v0: pa, v1: pb, kerbs: [[c.u - c.hw, pa, c.u - c.hw, pb, c.u - c.hw - 1, (pa + pb) / 2]] });
          }
        }
      }
    }
    // intersections: plain asphalt, zebra crossings on every arm, stop lines,
    // a signal on each corner for the approach on its right
    for (const n of lay.nodes) {
      const a = n.a, c = n.c;
      pieces.push({ kind: 'box', u0: n.u - c.hw, u1: n.u + c.hw, v0: n.v - a.hw, v1: n.v + a.hw });
      const arms = this.armsOf(n);
      for (const arm of arms) {
        if (arm === 'u+' || arm === 'u-') {
          const sg = arm === 'u+' ? 1 : -1;
          const e = n.u + sg * c.hw;
          pieces.push({ kind: 'zebra', ax: 'u', c0: Math.min(e + sg * 0.6, e + sg * 4.2), c1: Math.max(e + sg * 0.6, e + sg * 4.2), w0: n.v - a.hw, w1: n.v + a.hw });
          // stop line on the approach lanes (traffic heading -sg drives on the -sg*... side)
          const sv = sg > 0 ? [n.v - a.hw + 0.3, n.v - 0.2] : [n.v + 0.2, n.v + a.hw - 0.3];
          pieces.push({ kind: 'stop', u0: Math.min(e + sg * 4.6, e + sg * 5.0), u1: Math.max(e + sg * 4.6, e + sg * 5.0), v0: sv[0], v1: sv[1] });
        } else {
          const sg = arm === 'v+' ? 1 : -1;
          const e = n.v + sg * a.hw;
          pieces.push({ kind: 'zebra', ax: 'v', c0: Math.min(e + sg * 0.6, e + sg * 4.2), c1: Math.max(e + sg * 0.6, e + sg * 4.2), w0: n.u - c.hw, w1: n.u + c.hw });
          const su = sg > 0 ? [n.u + 0.2, n.u + c.hw - 0.3] : [n.u - c.hw + 0.3, n.u - 0.2];
          pieces.push({ kind: 'stop', u0: su[0], u1: su[1], v0: Math.min(e + sg * 4.6, e + sg * 5.0), v1: Math.max(e + sg * 4.6, e + sg * 5.0) });
        }
      }
      if (n.u === lay.scramble.u && n.v === lay.scramble.v) {
        pieces.push({ kind: 'diag', u0: n.u - c.hw, v0: n.v - a.hw, u1: n.u + c.hw, v1: n.v + a.hw });
        pieces.push({ kind: 'diag', u0: n.u - c.hw, v0: n.v + a.hw, u1: n.u + c.hw, v1: n.v - a.hw });
      }
      // signals (not at the quiet end streets)
      if (c.nl > 1 && !lay.underDeck(n.u, n.v)) {
        for (const [du, dv, ax, dir] of [[1, 1, 'u', -1], [-1, -1, 'u', 1], [-1, 1, 'v', 1], [1, -1, 'v', -1]]) {
          // corner pole: reaches over the lanes approaching that corner
          const u = n.u + du * (c.hw + 0.8), v = n.v + dv * (a.hw + 0.8);
          const reach = ax === 'u' ? a.hw * 0.9 : c.hw * 0.9;
          signals.push({ u, v, ax, dir, reach, node: n, approach: ax === 'u' ? 'a' : 'c' });
        }
      }
    }
    // ground: lots and the deck band (grass for parks)
    const isPark = (u, v) => [lay.park, lay.temple].some((r) => u > r.u0 && u < r.u1 && v > r.v0 && v < r.v1);
    for (let u = 0; u < this.L; u += TILE / 2) {
      for (let v = CITY_V0 - 60; v < 392; v += TILE / 2) {
        const v1 = Math.min(392, v + TILE / 2);
        pieces.push({ kind: 'ground', u0: u, u1: u + TILE / 2, v0: v, v1, grass: isPark(u + TILE / 4, (v + v1) / 2) });
      }
    }
    this.pieces = pieces;
    this.lamps = lamps;
    this.signals = signals;
    // posts on the pavements (furniture keeps clear of them)
    this.posts = [...lamps.map((l) => [l.u, l.v]), ...signals.map((s) => [s.u, s.v])];
  }

  // which arms (directions) leave intersection n
  armsOf(n) {
    const arms = [];
    const a = n.a, c = n.c;
    if (n.u > a.u0 + 1) arms.push('u-');
    if (n.u < a.u1 - 1) arms.push('u+');
    if (n.v > c.v0 + 1) arms.push('v-');
    if (n.v < c.v1 - 1) arms.push('v+');
    return arms;
  }

  // ---------------------------------------------------------------- planning
  // Every building is planned up front (deterministic, no overlaps, using an
  // occupancy grid); tiles draw the records whose centre they hold.
  planBuildings() {
    const lay = this.lay, PAVE = lay.PAVE, R = this.R, L = this.L;
    const CELL = 2, V0 = CITY_V0 - 40;
    const nu = Math.ceil(L / CELL), nv = Math.ceil((395 - V0) / CELL);
    const occ = new Uint8Array(nu * nv);
    const idx = (u, v) => {
      const i = Math.floor(u / CELL), j = Math.floor((v - V0) / CELL);
      return i < 0 || j < 0 || i >= nu || j >= nv ? -1 : i * nv + j;
    };
    // reserve streets + pavements, the deck band, metro corridor, landmarks
    for (let i = 0; i < nu; i++) {
      for (let j = 0; j < nv; j++) {
        const u = (i + 0.5) * CELL, v = V0 + (j + 0.5) * CELL;
        // the viaduct footprint (+1 m), the ramps beside it, and the metro
        let r = lay.nearStreet(u, v, PAVE + 0.4) || (v > DECK_V0 - 1.2 && v < DECK_V1 + 1.2) || lay.inMetro(u, v, 1.5);
        for (const rp of [lay.offRamp, lay.onRamp]) {
          if (u > Math.min(rp.u0, rp.u1) - 4 && u < Math.max(rp.u0, rp.u1) + 4 && v > 17 && v < lay.RAMP_V + lay.RAMP_HW + 2.5) r = true;
        }
        r = r || u < 20 || u > L - 20;
        for (const z of [lay.temple, lay.park]) if (u > z.u0 - 2 && u < z.u1 + 2 && v > z.v0 - 2 && v < z.v1 + 2) r = true;
        if (Math.hypot(u - lay.skytree.u, v - lay.skytree.v) < 40) r = true;
        for (const st of lay.stations) {
          // the platforms + station house, and the plaza out to the avenue
          if (Math.abs(u - st.u) < 52 && (v - st.v) * st.dir > -12 && (v - st.houseV) * st.dir < 6) r = true;
          if (u > st.plaza.u0 - 1 && u < st.plaza.u1 + 1 && v > st.plaza.v0 - 1 && v < st.plaza.v1 + 1) r = true;
        }
        if (Math.abs(u - lay.cable.u) < 18 && v > 380) r = true;
        if (r) occ[i * nv + j] = 1;
      }
    }
    const free = (u0, u1, v0, v1) => {
      for (let u = Math.min(u0, u1); u <= Math.max(u0, u1); u += CELL) {
        for (let v = Math.min(v0, v1); v <= Math.max(v0, v1); v += CELL) {
          const k = idx(u, v);
          if (k < 0 || occ[k]) return false;
        }
      }
      return true;
    };
    const mark = (u0, u1, v0, v1) => {
      for (let u = Math.min(u0, u1); u <= Math.max(u0, u1) + 0.01; u += CELL) {
        for (let v = Math.min(v0, v1); v <= Math.max(v0, v1) + 0.01; v += CELL) {
          const k = idx(u, v);
          if (k >= 0) occ[k] = 1;
        }
      }
    };
    // how busy the city is here: 1 by the crossing / Meiji Dori, low by the hills
    const busy = (u, v) => {
      const dS = Math.hypot((u - lay.scramble.u) / 420, (v - lay.scramble.v) / 220);
      return clamp(1.15 - dS - Math.max(0, v - 280) / 260 - Math.max(0, -v - 120) / 200, 0.1, 1);
    };
    const recs = [];
    let k = 1;
    // a row of street-facing buildings along one side of a street piece
    // frame: rot 0 (street along u: a = u, b = v) or PI/2 (street along v:
    // a = v, b = pivotU - u)
    const row = (rot, pivotU, a0, a1, bFront, side) => {
      let a = a0 + R(k++) * 2;
      while (a < a1 - 5) {
        const toUV = (aa, bb) => (rot ? [pivotU - bb, aa] : [aa, bb]);
        const [cu, cv] = toUV(a + 6, bFront + side * 6);
        const B = busy(cu, cv);
        const r = R(k++);
        let kind, along, depth, floors;
        if (B > 0.62 && r < 0.45) { kind = 'tower'; along = 14 + R(k++) * 16; depth = 16 + R(k++) * 10; floors = Math.round(8 + B * 14 + R(k++) * 12); }
        else if (B > 0.45 && r < 0.6) { kind = 'dept'; along = 18 + R(k++) * 14; depth = 18 + R(k++) * 8; floors = Math.round(5 + R(k++) * 5); }
        else if (B < 0.3 && r < 0.4) { kind = 'house'; along = 9 + R(k++) * 4; depth = 14; floors = 2; }
        else { kind = 'shop'; along = 5.5 + R(k++) * 4.5; depth = 9 + R(k++) * 5; floors = Math.max(2, Math.round(2 + B * 3 + R(k++) * 2)); }
        along = Math.min(along, a1 - a);
        if (along < 4.5) break;
        const am = a + along / 2;
        const [u0, v0] = toUV(a, bFront), [u1, v1] = toUV(a + along, bFront + side * depth);
        if (free(u0, u1, v0, v1)) {
          mark(u0, u1, v0, v1);
          recs.push({ kind, rot, pivotU, am, along, bFront, side, depth, floors, u: (u0 + u1) / 2, v: (v0 + v1) / 2, seed: R(k++) * 1e4 });
          a += along + (R(k++) < 0.12 ? 1 + R(k++) * 3 : 0.2);
        } else {
          a += 2;
        }
      }
    };
    for (const a of lay.avenues) {
      for (const side of [1, -1]) {
        const front = a.v + side * (a.hw + PAVE);
        row(0, 0, a.u0, a.u1, front, side);
      }
    }
    for (const c of lay.cross) {
      for (const side of [1, -1]) {
        // west side (u < c.u): b = c.u - u > 0, building extends to larger b
        const bFront = side * (c.hw + PAVE);
        row(Math.PI / 2, c.u, c.v0, c.v1, bFront, side);
      }
    }
    // shop rows backing onto the viaduct, facing the avenues beside it
    for (const a of lay.avenues.filter((q) => q.id === 'L1' || q.id === 'R1')) {
      const side = a.v < 0 ? 1 : -1; // toward the viaduct
      const front = a.v + side * (a.hw + PAVE + 1.4); // clear of the pavement cells
      const back = side > 0 ? DECK_V0 - 1.4 : DECK_V1 + 1.4;
      let s = a.u0 + 2;
      while (s < a.u1 - 5) {
        const along = 5.5 + R(k++) * 4.5;
        const depth = Math.min(10, Math.abs(back - front) - 0.2);
        const [u0, v0, u1, v1] = [s, front, s + along, front + side * depth];
        if (depth > 5 && free(u0, u1, v0, v1)) {
          mark(u0, u1, v0, v1);
          const B = busy(s, front);
          recs.push({ kind: 'shop', rot: 0, pivotU: 0, am: s + along / 2, along, bFront: front, side, depth, floors: Math.max(2, Math.round(2 + B * 2 + R(k++) * 2)), u: s + along / 2, v: front + side * depth / 2, seed: R(k++) * 1e4 });
          s += along + 0.2;
        } else s += 2;
      }
    }
    // the inside of the blocks: apartment / office blocks wherever they fit
    for (let u = 24; u < L - 24; u += 3) {
      for (let v = CITY_V0 - 36; v < 392; v += 3) {
        if (occ[idx(u, v)]) continue;
        const along = 10 + R(k++) * 12, depth = 10 + R(k++) * 10;
        if (!free(u, u + along, v, v + depth)) continue;
        mark(u, u + along, v, v + depth);
        const B = busy(u, v);
        const floors = Math.round(3 + B * 9 + R(k++) * 6);
        recs.push({ kind: 'block', rot: 0, pivotU: 0, am: u + along / 2, along, bFront: v, side: 1, depth, floors, u: u + along / 2, v: v + depth / 2, seed: R(k++) * 1e4 });
      }
    }
    this.recs = recs;
  }

  // the deck structure as solid boxes for the streets below
  structureObstacles() {
    const lay = this.lay, base = this.base;
    const add = (u, v, du, dv, y1, kind) => this.obstacles.push({ s: this.S + u, d: v, L: du, W: dv, y0: base - 1, y1: base + y1, kind, layer: 'city' });
    for (const p of lay.piers) {
      add(p.u, -8, 1.8, 1.8, this.deck(p.u) - 1.2, 'pier');
      add(p.u, 10.5, 1.8, 1.8, this.deck(p.u) - 1.2, 'pier');
    }
    // the walled embankments at both ends of the viaduct
    for (const [ua, ub] of [[0, lay.abutments[0]], [lay.abutments[1], this.L]]) {
      for (let u = ua; u < ub; u += 10) {
        const h = Math.min(this.deck(u), this.deck(Math.min(ub, u + 10)));
        add(u + 5, (DECK_V0 + DECK_V1) / 2, 10, DECK_V1 - DECK_V0, h - 0.4, 'embankment');
      }
    }
    // ramps: solid where they are too low to drive under
    for (const r of [lay.offRamp, lay.onRamp]) {
      const ua = Math.min(r.uTop, r.uFoot), ub = Math.max(r.uTop, r.uFoot);
      for (let u = ua; u < ub; u += 8) {
        // just the deck slab (from its soffit to just under the road surface):
        // streets and cars pass under high parts, cars on the ramp ride over it
        const h = Math.min(this.rampH(r, u), this.rampH(r, u + 8));
        if (h < 0.2) continue;
        this.obstacles.push({ s: this.S + u + 4, d: lay.RAMP_V, L: 8, W: lay.RAMP_HW * 2 + 0.6, y0: base + Math.max(-1, h - 1.3), y1: base + h - 1.0, kind: 'ramp', layer: 'city' });
      }
    }
    // ramp piers (the same spots as drawn in buildRamps)
    for (const p of this.rampPiers()) add(p.u, lay.RAMP_V, 1.4, 1.4, p.h - 1.1, 'pier');
    // metro piers (between the street crossings)
    for (let t = 6; t < lay.metroLen; t += 24) {
      const p = along(lay.metroPts, lay.metroCum, t);
      if (lay.nearStreet(p.u, p.v, 1)) continue;
      add(p.u, p.v, 2.2, 2.2, lay.metro.h - 0.6, 'mpier');
    }
  }

  // ---------------------------------------------------------------- ramps
  // pier spots under the elevated part of both ramps, clear of the streets
  rampPiers() {
    const lay = this.lay, out = [];
    for (const r of [lay.offRamp, lay.onRamp]) {
      for (let u = Math.min(r.uTop, r.uFoot) + 20; u < Math.max(r.uTop, r.uFoot) - 10; u += 30) {
        const h = this.rampH(r, u);
        if (h > 2.5 && !lay.cross.some((c) => Math.abs(u - c.u) < c.hw + lay.PAVE + 1.5)) out.push({ u, h });
      }
    }
    return out;
  }
  // ramp height above the city base at u (the deck height up top)
  rampH(r, u) {
    const top = this.deck(u);
    const t = clamp((u - r.uTop) / (r.uFoot - r.uTop), 0, 1);
    return top * (1 - (t * t * (3 - 2 * t)));
  }
  rampPts(r) {
    if (!r._pts) {
      const lay = this.lay, V = lay.RAMP_V, aux = 17.8;
      const pts = [];
      if (r.dir > 0) {
        // aux lane -> swing out -> straight down -> slip road
        for (let i = 0; i <= 8; i++) {
          const t = i / 8, x = t * t * (3 - 2 * t);
          pts.push([r.u0 + (r.uTop - r.u0) * t, aux + (V - aux) * x]);
        }
        pts.push([r.uFoot, V], [r.u1, V]);
      } else {
        pts.push([r.u0, V], [r.uFoot, V]);
        for (let i = 0; i <= 8; i++) {
          const t = i / 8, x = t * t * (3 - 2 * t);
          pts.push([r.uTop + (r.u1 - r.uTop) * t, V + (aux - V) * x]);
        }
      }
      r._pts = pts;
    }
    return r._pts;
  }

  // ---------------------------------------------------------------- ground
  // absolute ground height at (u, v) for something whose underside is at
  // refY (the expressway deck, a ramp, or the city / mountain below)
  groundAbs(u, v, refY, out) {
    const lay = this.lay, base = this.base;
    let best = -Infinity, surf = 0;
    const consider = (h, sf) => {
      if ((refY === undefined || h <= refY + 0.7) && h > best) { best = h; surf = sf; }
    };
    const dk = this.deck(u);
    // the deck (incl. the aux lanes where the ramps join)
    const auxW = lay.aux.some(([a0, a1]) => u > a0 && u < a1) ? 19.8 : DECK_V1;
    if (v > DECK_V0 && v < auxW) consider(base + dk, 0);
    for (const r of [lay.offRamp, lay.onRamp]) {
      if (u < Math.min(r.u0, r.u1) - 1 || u > Math.max(r.u0, r.u1) + 1) continue;
      const n = nearestOn(this.rampPts(r), u, v);
      if (n.dist <= lay.RAMP_HW + 0.7) consider(base + this.rampH(r, u), 0);
    }
    // the city ground / mountain (always a candidate)
    const t = this.terrain(u, v);
    const road = v < 392 ? 0 : lay.onHill(u, v, 0.4) ? 0 : 1;
    consider(base + t, road);
    if (best === -Infinity) { best = base + t; surf = road; }
    if (out) { out.h = best; out.surf = surf; }
    return best;
  }

  // which level is something with its underside at y on: 'hw', 'ramp' or 'city'
  layerAt(u, v, y) {
    const lay = this.lay, dk = this.deck(u);
    const auxW = lay.aux.some(([a0, a1]) => u > a0 && u < a1) ? 19.8 : DECK_V1;
    // the carriageway (incl. the levelled ends of the zone, where the deck is
    // down at street level: there the road is the expressway, walled in)
    if (v > DECK_V0 && v < auxW && (dk <= 3 || y > this.base + dk - 2.2)) return 'hw';
    for (const r of [lay.offRamp, lay.onRamp]) {
      if (u < Math.min(r.u0, r.u1) - 1 || u > Math.max(r.u0, r.u1) + 1) continue;
      const n = nearestOn(this.rampPts(r), u, v);
      const h = this.rampH(r, u);
      // (on the ramp proper: beyond the deck edge)
      if (n.dist <= lay.RAMP_HW + 1.2 && y > this.base + h - 2.2 && h > 0.6 && v > 19.6) return 'ramp';
    }
    return 'city';
  }

  // ---------------------------------------------------------------- barriers
  // for the deck level (highway + ramps): the right-hand edge
  hwMax(s, guard) {
    const u = s - this.S;
    return this.lay.aux.some(([a0, a1]) => u > a0 && u < a1) ? 19.5 : guard;
  }
  // deck-level drivable pieces outside the carriageway: ramps + aux lanes
  contains(s, d) {
    const u = s - this.S, lay = this.lay;
    if (lay.aux.some(([a0, a1]) => u > a0 && u < a1) && d < 19.5) return true;
    for (const r of [lay.offRamp, lay.onRamp]) {
      if (u < Math.min(r.u0, r.u1) - 1 || u > Math.max(r.u0, r.u1) + 1) continue;
      if (nearestOn(this.rampPts(r), u, d).dist <= lay.RAMP_HW) return true;
    }
    return false;
  }
  pushOut(s, d) {
    const u = s - this.S, lay = this.lay;
    let best = { ds: 0, dd: -1, pen: Math.max(0, d - 19.5) };
    for (const r of [lay.offRamp, lay.onRamp]) {
      const n = nearestOn(this.rampPts(r), u, d);
      const pen = n.dist - lay.RAMP_HW;
      if (pen < best.pen) {
        const l = n.dist || 1;
        best = { ds: (n.pu - u) / l, dd: (n.pv - d) / l, pen };
      }
    }
    return best;
  }
  // city level: stay inside the zone
  cityPush(u, v) {
    let du = 0, dv = 0;
    if (u < 2) du = 2 - u;
    if (u > this.L - 2) du = this.L - 2 - u;
    if (v < CITY_V0 - 40) dv = CITY_V0 - 40 - v;
    if (v > CITY_V1 - 4) dv = CITY_V1 - 4 - v;
    return { du, dv };
  }
  // the nearest street lane to put a car back on (respawn)
  nearestLane(s, d) {
    const u = s - this.S, lay = this.lay;
    let best = null;
    const consider = (pu, pv, tu, tv, twoWay, dist) => {
      if (!best || dist < best.dist) best = { s: this.S + pu, d: pv, ts: tu, td: tv, twoWay, dist };
    };
    for (const a of lay.avenues) {
      const pu = clamp(u, a.u0, a.u1);
      consider(pu, a.v, 1, 0, true, Math.hypot(u - pu, d - a.v));
    }
    for (const c of lay.cross) {
      const pv = clamp(d, c.v0, c.v1);
      if (lay.underDeck(c.u, pv) && false) continue;
      consider(c.u, pv, 0, 1, true, Math.hypot(u - c.u, d - pv));
    }
    if (d > 380) {
      const n = nearestOn(lay.hill, u, d);
      const a = lay.hill[n.k], b = lay.hill[n.k + 1];
      const l = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
      consider(n.pu, n.pv, (b[0] - a[0]) / l, (b[1] - a[1]) / l, true, n.dist);
    }
    return best;
  }
  dropAt() { return null; }
  pumpAt() { return null; }

  // ---------------------------------------------------------------- tiles
  tileKey(u, v) {
    return Math.floor(u / TILE) + ',' + Math.floor((v - CITY_V0 + 80) / TILE);
  }
  tileOf(key) {
    let t = this.tiles.get(key);
    if (!t) {
      const [i, j] = key.split(',').map(Number);
      t = { key, i, j, u: (i + 0.5) * TILE, v: CITY_V0 - 80 + (j + 0.5) * TILE, pieces: [], lamps: [], signals: [], recs: [], built: false, group: null, glows: [], lights: [], obstacles: [] };
      this.tiles.set(key, t);
    }
    return t;
  }
  // stream tiles around the focus (zone coords)
  stream(fu, fv, force = false) {
    if (!this._assigned) {
      this._assigned = true;
      const at = (u, v) => this.tileOf(this.tileKey(u, v));
      for (const p of this.pieces) at((p.u0 + p.u1) / 2, (p.v0 + p.v1) / 2).pieces.push(p);
      for (const l of this.lamps) at(l.u, l.v).lamps.push(l);
      for (const sg of this.signals) at(sg.u, sg.v).signals.push(sg);
      for (const r of this.recs) at(r.u, r.v).recs.push(r);
    }
    let changed = false;
    // nearest unbuilt tile first; one per call (unless forced)
    let best = null, bestD = Infinity;
    for (const t of this.tiles.values()) {
      const dist = Math.hypot(t.u - fu, t.v - fv);
      const bR = this.wide ? 2400 : buildR(), dR = this.wide ? 2600 : dropR();
      if (!t.built && dist < bR && dist < bestD) { best = t; bestD = dist; }
      if (t.built && dist > dR) { this.dropTile(t); changed = true; }
    }
    if (best) {
      this.buildTile(best);
      changed = true;
      if (force) return this.stream(fu, fv, true);
    }
    if (changed) this.collect();
  }
  collect() {
    this.glows = [...this.alwaysGlows];
    this.lights = [...this.alwaysLights];
    this.tileObstacles = [];
    for (const t of this.tiles.values()) {
      if (!t.built) continue;
      for (const g of t.glows) this.glows.push(g);
      for (const l of t.lights) this.lights.push(l);
      for (const o of t.obstacles) this.tileObstacles.push(o);
    }
    this.obstaclesAll = [...this.obstacles, ...this.tileObstacles];
  }
  dropTile(t) {
    if (t.group) {
      this.root.remove(t.group);
      t.group.traverse((o) => o.geometry && !o.userData.shared && o.geometry.dispose());
    }
    t.group = null;
    t.built = false;
    t.extraMeshes = [];
    t.parked = [];
    t.wires = [];
    t.glows = [];
    t.lights = [];
    t.obstacles = [];
  }

  // geometry buckets for one tile (or the always-built set)
  newGeo() {
    const G = this.GeoB;
    const raw = {
      ground: new G(), grass: new G(), pave: new G(), kerb: new G(), asphalt: new G(), ave1: new G(), ave2: new G(), ave3: new G(),
      metal: new G(), lamp: new G(), dark: new G(), colored: new G(), leaf: new G(), building: new G(), shop: new G(),
      roof: new G(), rail: new G(), concrete: new G(), bridge: new G(), tkFacade: new G(), tkShop: new G(), tkSign: new G(), leafTk: new G(),
      terrain: new G(), train: new G(), lattice: new G(), screen: new G(), bigSign: new G(), water: new G(), street: new G(), house: new G(), ramp: new G(),
    };
    raw.colored.col = '#888888';
    raw.leaf.col = '#2f5a42';
    raw.leafTk.col = '#4f8a3e';
    raw.terrain.col = '#4a6a3a';
    const net = this;
    return {
      raw,
      ave: (nl) => raw['ave' + nl],
      get asphalt() { return raw.asphalt; },
      get pave() { return raw.pave; },
      get kerb() { return raw.kerb; },
      get ground() { return raw.ground; },
      get grass() { return raw.grass; },
      get metal() { return raw.metal; },
      get dark() { return raw.dark; },
      col(c) { raw.colored.col = c; return raw.colored; },
      net,
    };
  }
  meshesFor(raw) {
    const W = this.W, m = this.mats, tk = this.tkMats;
    const group = new THREE.Group();
    const add = (g, mat) => {
      if (g.empty) return;
      group.add(new THREE.Mesh(g.build(), mat));
    };
    add(raw.ground, W.mGround); add(raw.grass, W.mGrass); add(raw.pave, W.mPave); add(raw.kerb, W.mConcrete);
    add(raw.asphalt, m.asphalt); add(raw.ave1, m.ave[1]); add(raw.ave2, m.ave[2]); add(raw.ave3, m.ave[3]);
    add(raw.street, W.mStreet);
    add(raw.ramp, W.mRamp);
    add(raw.metal, W.mMetal); add(raw.lamp, W.mLamp); add(raw.dark, W.mDark); add(raw.colored, W.mColored);
    add(raw.leaf, W.mLeaf); add(raw.building, W.mBuilding); add(raw.shop, W.mShop); add(raw.roof, W.mRoof);
    add(raw.house, W.mHouse); add(raw.rail, W.mRail); add(raw.concrete, W.mConcrete); add(raw.bridge, W.mBridge);
    add(raw.tkFacade, tk.facade); add(raw.tkShop, tk.shop); add(raw.tkSign, tk.sign); add(raw.leafTk, tk.leaf);
    add(raw.terrain, m.terrain); add(raw.train, m.train); add(raw.lattice, m.lattice); add(raw.screen, m.screen);
    add(raw.bigSign, m.bigSign); add(raw.water, W.mWater);
    return group;
  }

  buildTile(t) {
    const G = this.newGeo();
    const glows = [], lights = [], obstacles = [];
    buildStreets(this, G, t, glows, lights);
    this.buildRecs(G, t, glows, obstacles);
    if (this.extraTile) this.extraTile(G, t, glows, lights, obstacles);
    const group = this.meshesFor(G.raw);
    for (const m of t.extraMeshes || []) group.add(m);
    if (t.wires && t.wires.length) {
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(t.wires, 3));
      group.add(new THREE.LineSegments(g, this.tkMats.wire));
    }
    this.root.add(group);
    t.group = group;
    t.built = true;
    t.glows = glows;
    t.lights = lights;
    t.obstacles = obstacles;
  }

  // the planned buildings of a tile, drawn with the CityKit builders (in road
  // space: a = s, b = d, turned for the cross streets)
  buildRecs(G, t, glows, obstacles) {
    if (!t.recs.length) return;
    const base = this.base;
    let kk = 0;
    const R = (k) => hash(t.i * 31.7 + t.j * 17.3 + k * 0.371 + this.f.id);
    const ctx = {
      geo: G.raw, a: this.A, glows, wires: this.wiresFor(t), posts: null,
      foot: (s, d, L, W) => obstacles.push({ s, d, L, W, y0: base - 1, y1: base + 60, kind: 'building', layer: 'city' }),
    };
    const tk = new CityKit(this.W, ctx, (k) => R(k + kk));
    for (const r of t.recs) {
      kk += 97;
      tk.k = 1000 + Math.floor(r.seed);
      const yRel = -this.deck(r.u); // the city ground, relative to the road
      if (r.rot) tk.setFrame(this.S + r.pivotU, 0, Math.PI / 2);
      else tk.setFrame(this.S, 0, 0);
      const front = r.rot ? r.bFront : r.bFront;
      if (r.kind === 'shop') {
        tk.shopHouse(r.am, r.along, front, r.side, yRel + 0.02, { depth: r.depth, floors: r.floors, shop: true });
      } else if (r.kind === 'house') {
        tk.house(r.am, r.along, front, r.side, yRel + 0.02);
      } else if (r.kind === 'block') {
        tk.backBlock(r.am, r.along, front, r.side, yRel + 0.02, r.floors, R(kk) < 0.35, r.depth);
      } else {
        // towers and department stores: a facade box with a ground-floor shop
        // strip, signs up the corners and a big sign on top
        const h = r.floors * 3.4;
        const dc = front + r.side * r.depth / 2;
        tk.boxBuilding(G.raw.building, r.am, dc, yRel - 0.5, r.along, r.depth, h + 0.5, this.A, Math.floor(R(kk + 1) * 16) / 16, Math.floor(R(kk + 2) * 16) / 16);
        tk.foot(r.am, dc, r.along, r.depth);
        const f = tk.frame(r.am);
        tk.face(G.raw.tkShop, tk.pt(f, 0, front - r.side * 0.06, yRel + 0.02), -r.side * f.rx, -r.side * f.rz, r.along - 0.4, 3.15, [R(kk + 3), 1 - (Math.floor(R(kk + 4) * 8) * 64 + 64) / 512, R(kk + 3) + r.along / 6.4, 1 - Math.floor(R(kk + 4) * 8) * 64 / 512]);
        tk.awning(f, r.along, front, r.side, yRel + 0.02);
        for (let i = 0; i < (r.kind === 'dept' ? 3 : 2); i++) {
          const y = yRel + 5.5 + i * 5;
          if (y + 4 > yRel + h) break;
          tk.vsign(f, (i % 2 ? 1 : -1) * (r.along / 2 - 0.6), front, r.side, y, 3.6 + R(kk + 5 + i) * 1.4);
        }
        // a big lit sign on the roof (dept stores: across the front)
        const sw = Math.min(r.along - 2, 14), sh = sw / 2;
        const si = Math.floor(R(kk + 9) * 10);
        if (r.kind === 'dept') {
          this.bigSign(G.raw, tk, f, 0, front - r.side * 0.12, yRel + h - sh - 1.2, sw, sh, -r.side, si);
        } else if (R(kk + 10) < 0.6) {
          for (const j of [-1, 1]) tk.box(G.raw.dark, r.am + j * sw * 0.35, dc - r.side * (r.depth / 2 - 1.5), yRel + h, 0.25, 0.25, 2.2, this.A);
          this.bigSign(G.raw, tk, f, 0, dc - r.side * (r.depth / 2 - 1.6), yRel + h + 2, sw, sh, -r.side, si);
        }
        if (h > 40 && R(kk + 11) < 0.6) {
          const p = tk.point(r.am, dc, yRel + h + 1.5);
          glows.push({ x: p.x, y: p.y, z: p.z, r: 1, g: 0.15, b: 0.1, size: 1.4, blink: R(kk + 12) * 6 });
        }
      }
    }
    tk.setFrame();
  }

  // a big sign quad (atlas cell si) facing direction nside across the street frame
  bigSign(raw, tk, f, ds, d, y, w, h, nside, si) {
    const p = tk.pt(f, ds, d, y);
    const u0 = (si % 2) * 0.5, v1 = 1 - Math.floor(si / 2) * 0.2;
    tk.face(raw.bigSign, p, nside * f.rx, nside * f.rz, w, h, [u0, v1 - 0.2, u0 + 0.5, v1]);
  }

  wiresFor(t) {
    if (!t.wires) t.wires = [];
    return t.wires;
  }

  // things built once for the whole zone (visible from afar): set up by the
  // later passes (landmarks, terrain, metro); see city2.js
  buildAlways() {
    this.alwaysGlows = [];
    this.alwaysLights = [];
    this.obstaclesAll = [...this.obstacles];
    this.tileObstacles = [];
    if (this.buildFixed) this.buildFixed();
  }

  // ---------------------------------------------------------------- runtime
  update(dt, player) {
    this.time += dt;
    this.mats.screens.update(dt);
    const fo = this.W.focus || { s: player.s, d: player.d };
    // riding high up (cable car) or at the summit: the whole city is in view
    const high = fo.y !== undefined && fo.y - this.base > 25;
    this.wide = high;
    this.stream(fo.s - this.S, fo.d);
    if (this.tick) this.tick(dt, player);
  }

  render(origin, glows, night, time) {
    cityNight(this.mats, night, this.W.snow || 0);
    if (this.draw) this.draw(origin, glows, night, time);
  }

  dispose(root) {
    for (const t of this.tiles.values()) if (t.built) this.dropTile(t);
    this.W.root.remove(this.root);
    this.root.traverse((o) => o.geometry && !o.userData.shared && o.geometry.dispose());
    if (this.cleanup) this.cleanup();
  }

  rebase(origin) {
    this.root.position.set(this.A.x - origin.x, this.A.y - origin.y, this.A.z - origin.z);
  }
}
