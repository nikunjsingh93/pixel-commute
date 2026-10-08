// The living city: street traffic on a lane graph with signals (and a
// scramble-crossing phase), pedestrians on every block's pavements and at the
// crossing, the metro trains and the cable car. Installed onto CityNet.
import * as THREE from 'three';
import { hash } from './path.js';
import { CityNet } from './city.js';
import { LANE, nearestOn, along, cumLen, clamp } from './citylayout.js';
import { makeCar, pickType, CAR_COLORS, Builder } from './cars.js';
import { quality } from './quality.js';

const P = CityNet.prototype;
P.makeCar = makeCar;

// ---------------------------------------------------------------- signals
// 50 s cycle: avenue green 22 + amber 3 + red 2, cross green 18 + amber 3 + red 2
// the scramble adds an 18 s all-walk phase (70 s cycle)
P.lightState = function lightState(node, axis) {
  const scr = node.scramble;
  const T = scr ? 70 : 50;
  const t = (this.time + node.off) % T;
  if (axis === 'u') return t < 22 ? 'g' : t < 25 ? 'a' : 'r';
  if (t < 27) return 'r';
  return t < 45 ? 'g' : t < 48 ? 'a' : 'r';
};
P.walkPhase = function walkPhase(node) {
  const t = (this.time + node.off) % 70;
  return t >= 50 && t < 68;
};

// ---------------------------------------------------------------- graph
P.buildGraph = function buildGraph() {
  const lay = this.lay;
  const nodes = lay.nodes.map((n) => ({ ...n, edges: [], off: hash(n.u * 0.13 + n.v * 0.07) * 50, signal: n.c.nl > 1 && !lay.underDeck(n.u, n.v), scramble: n.u === lay.scramble.u && n.v === lay.scramble.v }));
  // the hill road starts at a T on Yamate Dori
  const r4 = lay.avenues.find((a) => a.id === 'R4');
  const hillNode = { u: lay.hill[0][0], v: r4.v, a: r4, c: { hw: lay.HILL_HW, nl: 1 }, edges: [], off: 0, signal: false, hill: true };
  nodes.push(hillNode);
  const summitNode = { u: lay.summit.u, v: lay.summit.v, edges: [], deadEnd: true, c: { hw: 4 }, a: { hw: 4 } };
  nodes.push(summitNode);
  const edges = [];
  const link = (n0, n1, pts, kind, nl, hw, sp) => {
    const cum = cumLen(pts);
    const e = { id: edges.length, n0, n1, pts, cum, len: cum[cum.length - 1], kind, nl, hw, sp, cars: [] };
    // clear distances (half intersection) at both ends along this street
    const clear = (n) => (n.deadEnd ? 3 : kind === 'cross' ? n.a.hw + 1.2 : n.c.hw + 1.2);
    e.c0 = clear(n0);
    e.c1 = clear(n1);
    n0.edges.push(e);
    n1.edges.push(e);
    edges.push(e);
  };
  for (const a of lay.avenues) {
    const ns = nodes.filter((n) => n.a === a && !n.deadEnd).sort((p, q) => p.u - q.u);
    for (let i = 0; i < ns.length - 1; i++) link(ns[i], ns[i + 1], [[ns[i].u, a.v], [ns[i + 1].u, a.v]], 'ave', a.nl, a.hw, a.nl > 2 ? 15 : 13);
  }
  for (const c of lay.cross) {
    const ns = nodes.filter((n) => n.c === c).sort((p, q) => p.v - q.v);
    for (let i = 0; i < ns.length - 1; i++) link(ns[i], ns[i + 1], [[c.u, ns[i].v], [c.u, ns[i + 1].v]], 'cross', c.nl, c.hw, c.nl > 2 ? 13 : 10);
  }
  link(hillNode, summitNode, lay.hill.map((p) => [p[0], p[1]]), 'hill', 1, lay.HILL_HW, 10.5);
  this.gNodes = nodes;
  this.gEdges = edges;
};

// position on an edge: travelling dir (+1 from n0), lane li, distance t from
// the start node in the travel direction
P.edgePos = function edgePos(e, dir, li, t, out) {
  const tt = dir > 0 ? t : e.len - t;
  along(e.pts, e.cum, tt, out);
  let tu = out.tu * dir, tv = out.tv * dir;
  const off = (li + 0.5) * LANE + 0.15;
  out.u += -tv * off; // right of travel is (-tv, tu)
  out.v += tu * off;
  out.tu = tu;
  out.tv = tv;
  out.h = e.kind === 'hill' ? this.lay.hillH(tt) : 0;
  return out;
};

// ---------------------------------------------------------------- traffic
const TYPES_CITY = ['sedan', 'sedan', 'hatch', 'hatch', 'suv', 'van', 'lux', 'sedan', 'taxi', 'taxi', 'bus', 'truck'];
P.spawnTraffic = function spawnTraffic() {
  this.buildGraph();
  const n = quality.pick([26, 46, 76, 120]);
  const R = (k) => hash(this.f.id * 3.3 + k * 0.917);
  let k = 0;
  const pool = this.gEdges.filter((e) => e.len > 40);
  for (let i = 0; i < n; i++) {
    const e = pool[Math.floor(R(k++) * pool.length)];
    const dir = R(k++) < 0.5 ? 1 : -1;
    const li = Math.floor(R(k++) * e.nl);
    let type = TYPES_CITY[Math.floor(R(k++) * TYPES_CITY.length)];
    let color = CAR_COLORS[Math.floor(R(k++) * CAR_COLORS.length)];
    if (type === 'taxi') { type = 'sedan'; color = R(k++) < 0.5 ? '#e8b020' : '#2a5a3a'; }
    if (type === 'bus') color = '#3d6aa0';
    if (e.kind === 'hill' && (type === 'bus' || type === 'truck')) type = 'hatch';
    const m = makeCar(type, color);
    this.root.add(m.group);
    const c = {
      e, dir, li, t: e.c0 + R(k++) * Math.max(1, e.len - e.c0 - e.c1 - 8), v: 0, mesh: m.group, tailMat: m.tailMat, dims: m.dims,
      L: m.dims.L, W: m.dims.W, type, color, turn: null, brake: 0, dist: 0, city: true,
    };
    // don't stack on another car
    if (e.cars.some((o) => o.dir === dir && o.li === li && Math.abs(o.t - c.t) < 12)) {
      this.root.remove(m.group);
      continue;
    }
    e.cars.push(c);
    this.cars.push(c);
  }
};

// leader gap on the same edge / direction / lane (and the player, the
// walker, and red lights)
P.gapAhead = function gapAhead(c, player) {
  let gap = 999, vL = 20;
  const e = c.e;
  for (const o of e.cars) {
    if (o === c || o.dir !== c.dir || o.li !== c.li || o.turn) continue;
    const d = o.t - c.t;
    if (d > 0 && d < gap) { gap = d - (o.L + c.L) / 2; vL = o.v; }
  }
  // the end of the edge: signal / dead end
  const stopAt = e.len - (c.dir > 0 ? e.c1 : e.c0) - 4.8;
  const nEnd = c.dir > 0 ? e.n1 : e.n0;
  let mustStop = false;
  if (nEnd.deadEnd) mustStop = false;
  else if (nEnd.signal) {
    const ax = e.kind === 'cross' ? 'v' : 'u';
    const st = this.lightState(nEnd, ax);
    if (st === 'r' || (st === 'a' && stopAt - c.t > c.v * 0.9)) mustStop = true;
  }
  if (mustStop && c.t < stopAt + 0.5) {
    const g = stopAt - c.t - c.L / 2;
    if (g < gap) { gap = Math.max(0, g); vL = 0; }
  }
  // the player's car / the person on foot, if in the lane ahead
  for (const q of this.blockers || []) {
    const p = this.edgePos(e, c.dir, c.li, c.t, this._ep || (this._ep = {}));
    const du = q.u - p.u, dv = q.v - p.v;
    const ahead = du * p.tu + dv * p.tv;
    const side = Math.abs(-du * p.tv + dv * p.tu);
    if (ahead > 0 && ahead < 30 && side < 1.9 && Math.abs(q.h - p.h) < 3) {
      const g = ahead - c.L / 2 - q.r;
      if (g < gap) { gap = Math.max(0, g); vL = 0; }
    }
  }
  return { gap, vL };
};

const idm = (v, v0, gap, vL) => {
  const a = 2.0, b = 3.5, T = 1.2, s0 = 2.2;
  const dv = v - vL;
  const sStar = s0 + Math.max(0, v * T + (v * dv) / (2 * Math.sqrt(a * b)));
  return a * (1 - Math.pow(v / v0, 4) - Math.pow(sStar / Math.max(gap, 0.1), 2));
};

P.updateTraffic = function updateTraffic(dt, player) {
  for (const c of this.cars) {
    if (c.turn) {
      // crossing the intersection on a quadratic curve
      const T = c.turn;
      c.v = Math.min(c.v + 2 * dt, T.vMax);
      T.t += c.v * dt;
      c.dist += c.v * dt;
      if (T.t >= T.len) {
        c.turn = null;
        c.e = T.e;
        c.dir = T.dir;
        c.li = T.li;
        c.t = T.t0;
        c.e.cars.push(c);
      }
      continue;
    }
    const e = c.e;
    const { gap, vL } = this.gapAhead(c, player);
    const acc = idm(c.v, e.sp, gap, vL);
    c.brake = acc < -1 ? 1 : 0;
    c.v = Math.max(0, c.v + Math.max(-7, acc) * dt);
    c.t += c.v * dt;
    c.dist += c.v * dt;
    const endT = e.len - (c.dir > 0 ? e.c1 : e.c0);
    if (c.t >= endT) this.chooseTurn(c);
  }
};

// at the end of an edge: pick the next street and build the turn curve
P.chooseTurn = function chooseTurn(c) {
  const e = c.e, n = c.dir > 0 ? e.n1 : e.n0;
  const i = e.cars.indexOf(c);
  if (i >= 0) e.cars.splice(i, 1);
  let next, ndir;
  if (n.deadEnd) {
    // turn around (summit car park)
    next = e;
    ndir = -c.dir;
  } else {
    const opts = n.edges.filter((x) => x !== e);
    if (!opts.length) { next = e; ndir = -c.dir; } else {
      // prefer straight on, sometimes turn
      const p = this.edgePos(e, c.dir, c.li, c.t, {});
      const score = (x) => {
        const xd = x.n0 === n ? 1 : -1;
        const q = this.edgePos(x, xd, 0, 6, {});
        const dot = p.tu * q.tu + p.tv * q.tv;
        return dot + hash(this.time * 0.37 + c.t * 3.1 + x.id) * 1.3;
      };
      next = opts.reduce((a, b) => (score(b) > score(a) ? b : a));
      ndir = next.n0 === n ? 1 : -1;
    }
  }
  const li = Math.min(c.li, next.nl - 1);
  const t0 = ndir > 0 ? next.c0 : next.c1;
  const p0 = this.edgePos(e, c.dir, c.li, e.len - (c.dir > 0 ? e.c1 : e.c0), {});
  const p2 = this.edgePos(next, ndir, li, t0, {});
  // control point: where the two driving lines meet (or the midpoint)
  const den = p0.tu * p2.tv - p0.tv * p2.tu;
  let p1;
  if (Math.abs(den) > 0.2) {
    const dx = p2.u - p0.u, dy = p2.v - p0.v;
    const s = (dx * p2.tv - dy * p2.tu) / den;
    p1 = { u: p0.u + p0.tu * s, v: p0.v + p0.tv * s };
  } else {
    p1 = { u: (p0.u + p2.u) / 2, v: (p0.v + p2.v) / 2 };
    if (n.deadEnd || next === e) {
      // U-turn: swing out
      p1 = { u: (p0.u + p2.u) / 2 + p0.tu * 9, v: (p0.v + p2.v) / 2 + p0.tv * 9 };
    }
  }
  const len = Math.hypot(p1.u - p0.u, p1.v - p0.v) + Math.hypot(p2.u - p1.u, p2.v - p1.v);
  c.turn = { p0, p1, p2, len: Math.max(1, len), t: 0, e: next, dir: ndir, li, t0, vMax: Math.abs(den) > 0.2 ? 7 : 11 };
};

// where a car is now: {u, v, h, tu, tv}
P.carPos = function carPos(c, out) {
  if (c.turn) {
    const T = c.turn, x = clamp(T.t / T.len, 0, 1), y = 1 - x;
    out.u = y * y * T.p0.u + 2 * y * x * T.p1.u + x * x * T.p2.u;
    out.v = y * y * T.p0.v + 2 * y * x * T.p1.v + x * x * T.p2.v;
    const du = 2 * y * (T.p1.u - T.p0.u) + 2 * x * (T.p2.u - T.p1.u);
    const dv = 2 * y * (T.p1.v - T.p0.v) + 2 * x * (T.p2.v - T.p1.v);
    const l = Math.hypot(du, dv) || 1;
    out.tu = du / l;
    out.tv = dv / l;
    out.h = T.p0.h + (T.p2.h - T.p0.h) * x;
    return out;
  }
  return this.edgePos(c.e, c.dir, c.li, c.t, out);
};

// ---------------------------------------------------------------- people
P.spawnPeople = function spawnPeople() {
  const lay = this.lay, PAVE = lay.PAVE;
  const loops = [];
  const avs = [...lay.avenues].sort((a, b) => a.v - b.v);
  for (let i = 0; i < avs.length - 1; i++) {
    const a1 = avs[i], a2 = avs[i + 1];
    const cs = lay.cross.filter((c) => c.v0 <= a1.v + 0.5 && c.v1 >= a2.v - 0.5).sort((p, q) => p.u - q.u);
    for (let j = 0; j < cs.length - 1; j++) {
      const c1 = cs[j], c2 = cs[j + 1];
      const r = { u0: c1.u + c1.hw + 2.4, u1: c2.u - c2.hw - 2.4, v0: a1.v + a1.hw + 2.4, v1: a2.v - a2.hw - 2.4 };
      if (r.u1 - r.u0 < 10 || r.v1 - r.v0 < 10) continue;
      r.len = 2 * (r.u1 - r.u0 + r.v1 - r.v0);
      loops.push(r);
    }
  }
  this.pedLoops = loops;
  const peds = [];
  const R = (k) => hash(this.f.id * 5.1 + k * 0.613);
  let k = 0;
  const shirts = ['#c8402a', '#2a5ab0', '#e8e4da', '#1c1d22', '#e8b020', '#2a7a4a', '#7a3a6a', '#8a8c90', '#d87a3a', '#3a8ad8'];
  const skins = ['#e8c8a8', '#d8b08a', '#c89a78', '#f0d8c0', '#a87a5a'];
  for (const loop of loops) {
    const busy = clamp(1.2 - Math.hypot((((loop.u0 + loop.u1) / 2) - lay.scramble.u) / 500, (((loop.v0 + loop.v1) / 2) - lay.scramble.v) / 260), 0.3, 1);
    const n = Math.round((3 + busy * 7) * quality.pick([0.35, 0.65, 1, 1.7]));
    for (let i = 0; i < n; i++) {
      peds.push({
        loop, t: R(k++) * loop.len, dir: R(k++) < 0.5 ? 1 : -1, sp: 1.1 + R(k++) * 0.6, off: (R(k++) - 0.5) * 2.6,
        shirt: shirts[Math.floor(R(k++) * shirts.length)], skin: skins[Math.floor(R(k++) * skins.length)], ph: R(k++) * 6, u: 0, v: 0, yaw: 0, moving: true,
      });
    }
  }
  // crowd at the scramble: they wait at the corners and cross on the walk phase
  const X = lay.scramble, a = lay.avenues.find((q) => q.id === 'R2'), c = lay.mainCross;
  this.scrCorners = [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([du, dv]) => ({ u: X.u + du * (c.hw + 2.6), v: X.v + dv * (a.hw + 2.6) }));
  for (let i = 0, nc = quality.pick([24, 40, 64, 100]); i < nc; i++) {
    const ci = i % 4;
    peds.push({
      scr: true, corner: ci, target: ci, ju: (R(k++) - 0.5) * 4, jv: (R(k++) - 0.5) * 4, sp: 1.2 + R(k++) * 0.6,
      shirt: shirts[Math.floor(R(k++) * shirts.length)], skin: skins[Math.floor(R(k++) * skins.length)], ph: R(k++) * 6,
      u: this.scrCorners[ci].u, v: this.scrCorners[ci].v, yaw: 0, moving: false, x: 1,
    });
  }
  this.peds = peds;
  this.scrNode = this.gNodes.find((n) => n.scramble);
  // instanced figures: body (shirt), head (skin), legs (two per person)
  const mk = (geo, n, colors) => {
    const m = new THREE.InstancedMesh(geo, new THREE.MeshLambertMaterial({ vertexColors: false }), n);
    m.frustumCulled = false;
    m.count = 0;
    m.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(n * 3), 3);
    if (colors) for (let i = 0; i < n; i++) m.setColorAt(i, new THREE.Color(colors(i)));
    this.root.add(m);
    return m;
  };
  const N = peds.length;
  const body = new THREE.BoxGeometry(0.46, 0.62, 0.26); body.translate(0, 1.18, 0);
  const head = new THREE.BoxGeometry(0.24, 0.26, 0.24); head.translate(0, 1.64, 0);
  const leg = new THREE.BoxGeometry(0.17, 0.85, 0.18); leg.translate(0, -0.43, 0);
  const hair = new THREE.BoxGeometry(0.26, 0.1, 0.26); hair.translate(0, 1.79, 0);
  // arms hang from the shoulders (sleeve), hands at their ends (skin)
  const arm = new THREE.BoxGeometry(0.11, 0.5, 0.13); arm.translate(0, -0.25, 0);
  const hand = new THREE.BoxGeometry(0.1, 0.12, 0.11); hand.translate(0, -0.56, 0);
  this.pedMesh = {
    body: mk(body, N, (i) => peds[i].shirt),
    head: mk(head, N, (i) => peds[i].skin),
    hair: mk(hair, N, (i) => (hash(i * 3.7) < 0.7 ? '#1c1810' : '#6a4a2a')),
    leg: mk(leg, N * 2, (i) => (hash(i * 1.3) < 0.5 ? '#2a2c34' : '#3a4a6a')),
    arm: mk(arm, N * 2, (i) => peds[i >> 1].shirt),
    hand: mk(hand, N * 2, (i) => peds[i >> 1].skin),
  };
};

// a point on a block's pavement loop (counter-clockwise), with its heading
function loopPos(r, t, off, out) {
  const W = r.u1 - r.u0, H = r.v1 - r.v0;
  t = ((t % r.len) + r.len) % r.len;
  if (t < W) { out.u = r.u0 + t; out.v = r.v0 - off; out.tu = 1; out.tv = 0; }
  else if (t < W + H) { out.u = r.u1 + off; out.v = r.v0 + (t - W); out.tu = 0; out.tv = 1; }
  else if (t < 2 * W + H) { out.u = r.u1 - (t - W - H); out.v = r.v1 + off; out.tu = -1; out.tv = 0; }
  else { out.u = r.u0 - off; out.v = r.v1 - (t - 2 * W - H); out.tu = 0; out.tv = -1; }
  return out;
}

P.updatePeople = function updatePeople(dt) {
  const lp = {};
  const walk = this.scrNode ? this.walkPhase(this.scrNode) : false;
  if (walk && !this._walk) {
    // the walk phase starts: everyone picks a corner to cross to
    for (const p of this.peds) if (p.scr) { p.target = (p.corner + 1 + Math.floor(hash(p.ph * 9.1 + this.time) * 3)) % 4; p.x = 0; }
  }
  this._walk = walk;
  for (const p of this.peds) {
    if (p.scr) {
      const a = this.scrCorners[p.corner], b = this.scrCorners[p.target];
      if (p.x < 1) {
        const L = Math.hypot(b.u - a.u, b.v - a.v) || 1;
        p.x = Math.min(1, p.x + (p.sp * dt) / L);
        p.u = a.u + (b.u - a.u) * p.x + p.ju;
        p.v = a.v + (b.v - a.v) * p.x + p.jv;
        p.yaw = Math.atan2(b.v - a.v, b.u - a.u);
        p.moving = true;
        if (p.x >= 1) p.corner = p.target;
      } else {
        p.u = a.u + p.ju; p.v = a.v + p.jv;
        p.moving = false;
      }
      continue;
    }
    p.t += p.sp * p.dir * dt;
    loopPos(p.loop, p.t, p.off, lp);
    p.u = lp.u; p.v = lp.v;
    p.yaw = Math.atan2(lp.tv * p.dir, lp.tu * p.dir);
    p.moving = true;
  }
};

// ---------------------------------------------------------------- transit
// train car 2.9 x 3.4 x 18.4 m: livery texture on the sides (u along the car,
// v up), a cream roof / ends / floor, six window openings per side
function trainCarGeometry() {
  const pos = [], uv = [], idx = [];
  let n = 0;
  const W = 1.45, L = 9.2, Y0 = 0.4, Y1 = 3.8;
  const quad = (A, B, C, D, ua, va, ub, vb) => {
    pos.push(...A, ...B, ...C, ...D);
    uv.push(ua, va, ub, va, ub, vb, ua, vb);
    idx.push(n, n + 1, n + 2, n, n + 2, n + 3);
    n += 4;
  };
  // texture: 128 x 32 over the car; windows at v 6..17 px from the top
  const vt = (y) => 1 - (1 - (y - Y0) / (Y1 - Y0)) * 1; // y -> v (0 bottom .. 1 top)
  const wy0 = Y0 + (Y1 - Y0) * (1 - 17 / 32), wy1 = Y0 + (Y1 - Y0) * (1 - 6 / 32);
  const zt = (z) => (z + L) / (2 * L); // z -> u
  for (const x of [W, -W]) {
    const P = (z, y) => [x, y, z];
    // below and above the window band, full length
    quad(P(-L, Y0), P(L, Y0), P(L, wy0), P(-L, wy0), zt(-L), vt(Y0), zt(L), vt(wy0));
    quad(P(-L, wy1), P(L, wy1), P(L, Y1), P(-L, Y1), zt(-L), vt(wy1), zt(L), vt(Y1));
    // posts between the six windows (window i spans px 6 + i*20 .. +14 of 128)
    const edges = [-L];
    for (let i = 0; i < 6; i++) {
      const za = -L + ((6 + i * 20) / 128) * 2 * L, zb = -L + ((20 + i * 20) / 128) * 2 * L;
      edges.push(za, zb);
    }
    edges.push(L);
    for (let i = 0; i < edges.length; i += 2) quad(P(edges[i], wy0), P(edges[i + 1], wy0), P(edges[i + 1], wy1), P(edges[i], wy1), zt(edges[i]), vt(wy0), zt(edges[i + 1]), vt(wy1));
  }
  const cream = (A, B, C, D) => quad(A, B, C, D, 0.5, 0.9, 0.5, 0.9);
  cream([-W, Y1, -L], [W, Y1, -L], [W, Y1, L], [-W, Y1, L]); // roof
  cream([-W, Y0, -L], [W, Y0, -L], [W, Y0, L], [-W, Y0, L]); // floor
  cream([-W, Y0, L], [W, Y0, L], [W, Y1, L], [-W, Y1, L]); // ends
  cream([-W, Y0, -L], [W, Y0, -L], [W, Y1, -L], [-W, Y1, -L]);
  // dark seat rows inside
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}
P.spawnTransit = function spawnTransit() {
  const lay = this.lay;
  // trains: one on each track, opposite directions
  const box = (len, w, h) => {
    const b = new Builder();
    b.box(-w / 2, w / 2, 0.3, h, -len / 2, len / 2, '#d9d6cc', { top: '#b8bcc4' });
    return b.geometry();
  };
  // the body uses the train texture on its long sides: a box with UVs
  // a car body with real window openings (you can ride inside and look out):
  // sides are wall strips below / above the windows and posts between them
  const bodyGeo = trainCarGeometry();
  this.trains = [];
  // three trains each way, spaced around the loop
  for (const [dir, off, start] of [[1, 1.85, 0.1], [1, 1.85, 0.43], [1, 1.85, 0.76], [-1, -1.85, 0.6], [-1, -1.85, 0.93], [-1, -1.85, 0.27]]) {
    const cars = [];
    for (let i = 0; i < 4; i++) {
      const m = new THREE.Mesh(bodyGeo, this.mats.trainIn);
      m.userData.shared = true;
      this.root.add(m);
      cars.push(m);
    }
    this.trains.push({ dir, off, t: start * lay.metroLen, v: 14, cars, state: 'run', dwell: 0, at: null, next: null });
  }
  void box;
  // cable car cabins
  // cabin: a red floor tub and roof joined by corner posts, open windows all
  // round (riders see the view), hanger arm up to the cable
  const cab = new Builder();
  cab.box(-1.6, 1.6, -3.4, -2.6, -2.4, 2.4, '#c8402a', { side: '#b8301e' });
  cab.box(-1.6, 1.6, -0.8, -0.4, -2.4, 2.4, '#c8402a', { side: '#b8301e' });
  for (const [x, z] of [[-1.5, -2.3], [1.5, -2.3], [-1.5, 2.3], [1.5, 2.3], [-1.5, 0], [1.5, 0]]) cab.box(x - 0.1, x + 0.1, -2.6, -0.8, z - 0.1, z + 0.1, '#e8e4da');
  cab.box(-0.1, 0.1, -0.4, 0.6, -0.1, 0.1, '#4c5260');
  const cabGeo = cab.geometry();
  const cabMat = new THREE.MeshLambertMaterial({ vertexColors: true });
  this.cabins = [0, 1].map((i) => {
    const m = new THREE.Mesh(cabGeo, cabMat);
    this.root.add(m);
    return { mesh: m, off: i ? 3.2 : -3.2, x: i, dir: i ? -1 : 1 };
  });
  this.cableT = 0;
};

// train position: distance t along the loop on the track offset `off`
P.trainPos = function trainPos(tr, t, out) {
  const lay = this.lay;
  const L = lay.metroLen;
  along(lay.metroPts, lay.metroCum, ((t % L) + L) % L, out);
  const tu = out.tu * tr.dir, tv = out.tv * tr.dir;
  out.u += -out.tv * tr.off; // offsets are relative to the loop direction
  out.v += out.tu * tr.off;
  out.tu = tu;
  out.tv = tv;
  return out;
};

P.updateTransit = function updateTransit(dt) {
  const lay = this.lay, L = lay.metroLen;
  for (const tr of this.trains) {
    // distance to the next stop point ahead (the front of the train stops 36 m
    // past the platform centre); the station just served counts from behind
    let best = null, bestD = Infinity;
    for (const st of lay.stations) {
      let d = ((st.t + tr.dir * 36 - tr.t) * tr.dir) % L;
      if (d < 0) d += L;
      if (st === tr.last && d < 3) d += L;
      if (d < bestD) { bestD = d; best = st; }
    }
    tr.next = best;
    if (tr.state === 'dwell') {
      tr.dwell -= dt;
      tr.v = 0;
      if (tr.dwell <= 0) { tr.state = 'run'; tr.at = null; }
      continue;
    }
    // the train ahead on the same track (keep 140 m apart)
    let gapT = Infinity;
    for (const o of this.trains) {
      if (o === tr || o.dir !== tr.dir) continue;
      let d = ((o.t - tr.t) * tr.dir) % L;
      if (d < 0) d += L;
      gapT = Math.min(gapT, d - 140);
    }
    const room = Math.max(0, Math.min(bestD, gapT));
    const vMax = Math.min(17, Math.sqrt(Math.max(0, 2 * 1.1 * room)) + (gapT < bestD ? 0 : 0.3));
    tr.v = Math.min(vMax, tr.v + 1.0 * dt);
    const step = Math.min(tr.v * dt, bestD, Math.max(0, gapT));
    tr.t += step * tr.dir;
    if (bestD - step < 0.05) {
      tr.state = 'dwell';
      tr.dwell = 14;
      tr.at = best;
      tr.last = best;
      tr.v = 0;
    }
  }
  // cable car: 70 s ride, 12 s at each end
  this.cableT += dt;
  const C = lay.cable;
  const cyc = (this.cableT % 164);
  const x = cyc < 12 ? 0 : cyc < 82 ? (cyc - 12) / 70 : cyc < 94 ? 1 : 1 - (cyc - 94) / 70;
  const ease = x * x * (3 - 2 * x);
  this.cabins[0].x = ease;
  this.cabins[1].x = 1 - ease;
  this.cableDocked = cyc < 12 ? 'bottom' : cyc >= 82 && cyc < 94 ? 'top' : null;
  void C;
};

// cable position at fraction x from the valley station: {v, h}
P.cablePos = function cablePos(x) {
  const C = this.lay.cable, pr = C.prof;
  if (!pr) return { v: C.v0, h: 10 };
  const v = C.v0 + (C.v1 - C.v0) * x;
  let i = 0;
  while (i < pr.length - 2 && v > pr[i + 1][0]) i++;
  const [va, ha] = pr[i], [vb, hb] = pr[i + 1];
  const t = clamp((v - va) / (vb - va), 0, 1);
  return { v, h: ha + (hb - ha) * t - Math.sin(t * Math.PI) * (vb - va) * 0.02 };
};

// ---------------------------------------------------------------- hooks
P.tick = function tick(dt, player) {
  if (!this.gEdges) {
    this.spawnTraffic();
    this.spawnPeople();
    this.spawnTransit();
  }
  // things the city traffic must not drive into: the player's car, the walker
  const b = [];
  const fo = this.W.focusInfo;
  if (player && player.layer === 'city' && player.s > this.s0 && player.s < this.s1) b.push({ u: player.s - this.S, v: player.d, h: player.veh.pos.y - player.veh.spec.comH - this.base, r: player.L / 2 });
  if (fo && fo.walker) b.push({ u: fo.walker.s - this.S, v: fo.walker.d, h: fo.walker.y - this.base, r: 0.6 });
  this.blockers = b;
  this.updateTraffic(dt, player);
  this.updatePeople(dt);
  this.updateTransit(dt);
};

const _cp = {};
const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _p = new THREE.Vector3(), _s = new THREE.Vector3(1, 1, 1), _e = new THREE.Euler();
P.draw = function draw(origin, glows, night, time) {
  if (!this.gEdges) return;
  const A = this.A;
  const ox = A.x - origin.x, oy = A.y - origin.y, oz = A.z - origin.z;
  const fo = this.W.focus;
  const fu = fo ? fo.s - this.S : 0, fv = fo ? fo.d : 0;
  const hw = Math.atan2(this.F.x, this.F.z); // heading of +u
  this.root.updateMatrix();
  // cars
  for (const c of this.cars) {
    const p = this.carPos(c, _cp);
    const far = Math.abs(p.u - fu) > 260 || Math.abs(p.v - fv) > 260;
    c.mesh.visible = !far;
    // keep the collision fields current
    c.s = this.S + p.u;
    c.d = p.v;
    c.yaw = Math.atan2(p.tv, p.tu) * -1;
    c.y = this.base + p.h;
    if (far) continue;
    const w = this.wp(p.u, p.v, p.h);
    c.mesh.position.set(w[0], w[1], w[2]);
    const yaw = hw - Math.atan2(p.tv, p.tu);
    c.mesh.rotation.set(0, yaw, 0);
    if (this.W.wheels) this.W.wheels.add(c.mesh, c.dims, c.dist / c.dims.wr, this.root);
    // lights
    const fx = Math.sin(yaw), fz = Math.cos(yaw), lx = Math.cos(yaw), lz = -Math.sin(yaw);
    const D = c.dims;
    const X = w[0] + ox, Y = w[1] + oy, Z = w[2] + oz;
    for (const side of [1, -1]) {
      glows.add(X - fx * (D.L / 2 + 0.12) + lx * D.tailX * side, Y + D.tailY, Z - fz * (D.L / 2 + 0.12) + lz * D.tailX * side, 1.4 * (c.brake ? 1.9 : 1), 0.16, 0.08, 0.34);
      glows.add(X + fx * (D.L / 2 + 0.15) + lx * D.headX * side, Y + D.headY, Z + fz * (D.L / 2 + 0.15) + lz * D.headX * side, 1.7 * night + 0.25, 1.5 * night + 0.25, 1.1 * night + 0.2, 0.6);
    }
    c.tailMat.color.setScalar(c.brake ? 3 : 1.3);
  }
  // signals: one head per corner pole, showing its approach's state
  for (const t of this.tiles.values()) {
    if (!t.built) continue;
    for (const sg of t.signals) {
      if (!sg.head) continue;
      const n = this.gNodes.find((q) => q.u === sg.node.u && q.v === sg.node.v);
      if (!n) continue;
      const st = this.lightState(n, sg.ax === 'u' ? 'u' : 'v');
      const w = this.wp(sg.head.u, sg.head.v, sg.head.h);
      const col = st === 'g' ? [0.2, 2.0, 0.7] : st === 'a' ? [2.2, 1.2, 0.15] : [2.2, 0.15, 0.1];
      glows.add(w[0] + ox, w[1] + oy, w[2] + oz, col[0], col[1], col[2], 0.55);
    }
  }
  // pedestrians
  const PM = this.pedMesh;
  let n = 0;
  for (const p of this.peds) {
    if (Math.abs(p.u - fu) > 260 || Math.abs(p.v - fv) > 260) continue;
    const w = this.wp(p.u, p.v, 0.15 * 0 + (this.lay.street(p.u, p.v) ? 0.02 : 0.15));
    const yaw = hw - p.yaw + 0; // figure faces +z
    _e.set(0, yaw, 0);
    _q.setFromEuler(_e);
    const bob = p.moving ? Math.abs(Math.sin(this.time * 7 * p.sp + p.ph)) * 0.05 : 0;
    _p.set(w[0], w[1] + bob, w[2]);
    _m.compose(_p, _q, _s);
    PM.body.setMatrixAt(n, _m);
    PM.head.setMatrixAt(n, _m);
    PM.hair.setMatrixAt(n, _m);
    PM.body.setColorAt(n, _col.set(p.shirt));
    PM.head.setColorAt(n, _col.set(p.skin));
    // legs swing about the hips
    const sw = p.moving ? Math.sin(this.time * 7 * p.sp + p.ph) * 0.5 : 0;
    for (const [i, side] of [[0, 1], [1, -1]]) {
      _e.set(sw * side, yaw, 0, 'YXZ');
      _q.setFromEuler(_e);
      const lx = Math.cos(yaw) * 0.11 * side, lz = -Math.sin(yaw) * 0.11 * side;
      _p.set(w[0] + lx, w[1] + 0.87 + bob, w[2] + lz);
      _m.compose(_p, _q, _s);
      PM.leg.setMatrixAt(n * 2 + i, _m);
      // arms swing the other way, from the shoulders just outside the body
      _e.set(-sw * side * 0.8, yaw, side * 0.06, 'YXZ');
      _q.setFromEuler(_e);
      const ax = Math.cos(yaw) * 0.29 * side, az = -Math.sin(yaw) * 0.29 * side;
      _p.set(w[0] + ax, w[1] + 1.46 + bob, w[2] + az);
      _m.compose(_p, _q, _s);
      PM.arm.setMatrixAt(n * 2 + i, _m);
      PM.hand.setMatrixAt(n * 2 + i, _m);
      PM.arm.setColorAt(n * 2 + i, _col.set(p.shirt));
      PM.hand.setColorAt(n * 2 + i, _col.set(p.skin));
    }
    n++;
  }
  for (const k of ['body', 'head', 'hair']) {
    PM[k].count = n;
    PM[k].instanceMatrix.needsUpdate = true;
    if (PM[k].instanceColor) PM[k].instanceColor.needsUpdate = true;
  }
  for (const k of ['leg', 'arm', 'hand']) {
    PM[k].count = n * 2;
    PM[k].instanceMatrix.needsUpdate = true;
    if (k !== 'leg' && PM[k].instanceColor) PM[k].instanceColor.needsUpdate = true;
  }
  // trains
  const lay = this.lay, M = lay.metro;
  for (const tr of this.trains) {
    tr.cars.forEach((m, i) => {
      const p = this.trainPos(tr, tr.t - tr.dir * (i * 19 + 9.2), _cp);
      const w = this.wp(p.u, p.v, M.h + 0.2);
      m.position.set(w[0], w[1], w[2]);
      m.rotation.set(0, hw - Math.atan2(p.tv, p.tu), 0);
      if (i === 0) {
        const f = this.wp(p.u + p.tu * 9.4, p.v + p.tv * 9.4, M.h + 1.4);
        glows.add(f[0] + ox, f[1] + oy, f[2] + oz, 1.6, 1.5, 1.2, 0.8);
      }
      if (i === tr.cars.length - 1) {
        const b = this.wp(p.u - p.tu * 9.4, p.v - p.tv * 9.4, M.h + 1.4);
        glows.add(b[0] + ox, b[1] + oy, b[2] + oz, 1.5, 0.15, 0.1, 0.6);
      }
    });
  }
  // cable cars
  const C = lay.cable;
  for (const cb of this.cabins) {
    const q = this.cablePos(cb.x);
    const w = this.wp(C.u + cb.off, q.v, q.h);
    cb.mesh.position.set(w[0], w[1], w[2]);
    cb.mesh.rotation.set(0, hw + Math.PI / 2, 0);
    cb.pos = { u: C.u + cb.off, v: q.v, h: q.h };
    glows.add(w[0] + ox, w[1] - 1.8 + oy, w[2] + oz, 1.2, 1.0, 0.7, 0.7);
  }
};
const _col = new THREE.Color();

P.cleanup = function cleanup() {
  for (const c of this.cars) this.root.remove(c.mesh);
};
