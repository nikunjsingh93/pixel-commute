// An exit off the highway into a small city loop - the first road-network
// test. Everything is laid out in the highway's road space (s along, d
// across), so drawing, ground height and collisions all agree:
//   deceleration lane -> off-ramp -> T-junction (traffic light) ->
//   a two-way street loop around a city block (petrol station, shops,
//   delivery drop-offs) -> on-ramp -> acceleration lane back onto the highway.
import * as THREE from 'three';
import { makeCar, CAR_COLORS } from './cars.js';
import { hash } from './path.js';
import { Tokyo } from './tokyo.js';

const NEAR = 48; // near street centre line (d)
const FAR = 118; // far street centre line (d)
const ST_HW = 4.0; // street half width (two lanes)
const RAMP_HW = 2.6;
const AUX_D = 17.8; // decel / accel lane centre (d)
const AUX_HW = 1.7;
const STREETS = [
  ['HARBOR WAY', 'MAPLE ST', '1ST AVE', '2ND AVE'],
  ['RIVER RD', 'OAK ST', 'MAIN ST', 'PARK AVE'],
  ['CANAL ST', 'ELM ST', '3RD AVE', '4TH AVE'],
  ['MARKET ST', 'PINE ST', 'KING ST', 'QUEEN ST'],
];

// delivery addresses of an exit (same order as ExitNet.drops), known before it is built
export function exitAddresses(f) {
  const n = STREETS[f.no % STREETS.length];
  return [[n[1], 12], [n[1], 48], [n[0], 7], [n[2], 3], [n[3], 21]].map(([street, no]) => ({ street, no }));
}

// ---------------------------------------------------------------- polylines
function bez(p0, p1, p2, n) {
  const out = [];
  for (let i = 0; i <= n; i++) {
    const t = i / n, u = 1 - t;
    out.push([u * u * p0[0] + 2 * u * t * p1[0] + t * t * p2[0], u * u * p0[1] + 2 * u * t * p1[1] + t * t * p2[1]]);
  }
  return out;
}
function arc(cs, cd, r, a0, a1, n) {
  const out = [];
  for (let i = 0; i <= n; i++) {
    const a = a0 + ((a1 - a0) * i) / n;
    out.push([cs + Math.cos(a) * r, cd + Math.sin(a) * r]);
  }
  return out;
}
// rounded rectangle in road space, counter-clockwise when viewed with
// s to the right and d up: near street (+s), side street, far street (-s), side street
function loopPts(sA, sB, dN, dF, r) {
  const pts = [];
  const line = (a, b, n) => {
    for (let i = 0; i < n; i++) pts.push([a[0] + ((b[0] - a[0]) * i) / n, a[1] + ((b[1] - a[1]) * i) / n]);
  };
  line([sA + r, dN], [sB - r, dN], 24);
  pts.push(...arc(sB - r, dN + r, r, -Math.PI / 2, 0, 6).slice(0, -1));
  line([sB, dN + r], [sB, dF - r], 10);
  pts.push(...arc(sB - r, dF - r, r, 0, Math.PI / 2, 6).slice(0, -1));
  line([sB - r, dF], [sA + r, dF], 24);
  pts.push(...arc(sA + r, dF - r, r, Math.PI / 2, Math.PI, 6).slice(0, -1));
  line([sA, dF - r], [sA, dN + r], 10);
  pts.push(...arc(sA + r, dN + r, r, Math.PI, Math.PI * 1.5, 6).slice(0, -1));
  pts.push([sA + r, dN]);
  return pts;
}
// distance from (s, d) to a polyline: { dist, k (segment), t, ps, pd (closest point) }
function nearest(pts, s, d) {
  let best = { dist: Infinity };
  for (let i = 0; i < pts.length - 1; i++) {
    const [s0, d0] = pts[i], [s1, d1] = pts[i + 1];
    const vs = s1 - s0, vd = d1 - d0;
    const L2 = vs * vs + vd * vd || 1e-9;
    let t = ((s - s0) * vs + (d - d0) * vd) / L2;
    t = t < 0 ? 0 : t > 1 ? 1 : t;
    const ps = s0 + vs * t, pd = d0 + vd * t;
    const dist = Math.hypot(s - ps, d - pd);
    if (dist < best.dist) best = { dist, k: i, t, ps, pd };
  }
  return best;
}
function polyLen(pts) {
  const cum = [0];
  for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]));
  return cum;
}

export class ExitNet {
  constructor(world, f) {
    this.W = world;
    this.f = f;
    const S = f.s0;
    this.S = S;
    this.sA = S + 150;
    this.sB = S + 430;
    const names = STREETS[f.no % STREETS.length];
    this.names = { near: names[0], far: names[1], sideA: names[2], sideB: names[3] };
    // drivable pieces
    this.loop = loopPts(this.sA, this.sB, NEAR, FAR, 18);
    this.offRamp = [[S + 62, AUX_D], ...bez([S + 80, AUX_D], [S + 150, AUX_D + 1], [S + 186, NEAR - 1.5], 16).slice(1)];
    this.onRamp = [...bez([S + 394, NEAR - 1.5], [S + 432, AUX_D + 1], [S + 494, AUX_D], 16), [S + 520, AUX_D]];
    // junction pads where the ramps meet the near street (room to turn)
    this.pads = [{ s: S + 186, d: NEAR - 2.5, r: 9 }, { s: S + 394, d: NEAR - 2.5, r: 9 }];
    this.segs = [
      { pts: this.loop, hw: ST_HW, kind: 'street' },
      { pts: this.offRamp, hw: RAMP_HW, kind: 'ramp' },
      { pts: this.onRamp, hw: RAMP_HW, kind: 'ramp' },
      { pts: [[S - 6, AUX_D], [S + 90, AUX_D]], hw: AUX_HW, kind: 'aux' },
      { pts: [[S + 478, AUX_D], [S + 545, AUX_D], [S + 566, 15.6]], hw: AUX_HW, kind: 'aux' },
    ];
    this.areas = [];
    this.fuel = !!f.fuel;
    if (this.fuel) {
      this.forecourt = { s0: S + 252, s1: S + 334, d0: NEAR + ST_HW - 0.5, d1: NEAR + 28 };
      this.areas.push(this.forecourt);
      this.pumps = [[S + 278, NEAR + 14], [S + 306, NEAR + 14], [S + 278, NEAR + 20], [S + 306, NEAR + 20]];
    }
    // delivery addresses (door positions, just off the kerb)
    this.drops = [
      { s: S + 220, d: FAR + ST_HW + 2, street: this.names.far, no: 12 },
      { s: S + 370, d: FAR + ST_HW + 2, street: this.names.far, no: 48 },
      { s: S + 300, d: NEAR - ST_HW - 2, street: this.names.near, no: 7 },
      { s: this.sA - ST_HW - 2, d: 86, street: this.names.sideA, no: 3 },
      { s: this.sB + ST_HW + 2, d: 80, street: this.names.sideB, no: 21 },
    ];
    // traffic light at the off-ramp junction (controls the near street)
    this.light = { s: S + 176, d: NEAR + ST_HW + 1.2, stopS: S + 172, state: 'green', t: Math.random() * 10 };
    this.cars = [];
    this.obstacles = []; // building footprints, trees, crash cushions (solid)
    this.shrubSpots = [];
    this.treeSpots = [];
    this.wires = [];
    this.built = false;
    this.glows = [];
    this.lights = [];
    this.loopLen = polyLen(this.loop);
  }

  // ---------------------------------------------------------------- queries
  // largest along-highway extent of the exit (for building / disposal)
  get s0() { return this.S - 20; }
  get s1() { return this.S + 580; }

  // the right-hand highway edge here (the aux lanes widen it)
  hwMax(s, guard) {
    const S = this.S;
    if ((s > S - 6 && s < S + 92) || (s > S + 476 && s < S + 568)) return AUX_D + AUX_HW - 0.05;
    return guard;
  }

  // open ground beside the ramps and around the loop (beyond the rails)
  openD0(s) {
    const S = this.S;
    return s > S + 64 && s < S + 500 ? 19.3 : 21.5;
  }
  inOpen(s, d) {
    return s >= this.S - 6 && s <= this.S + 566 && d >= this.openD0(s) && d <= 170;
  }

  contains(s, d) {
    if (this.inOpen(s, d)) return true;
    for (const g of this.segs) {
      if (nearest(g.pts, s, d).dist <= g.hw) return true;
    }
    for (const a of this.areas) if (s >= a.s0 && s <= a.s1 && d >= a.d0 && d <= a.d1) return true;
    for (const p of this.pads) if (Math.hypot(s - p.s, d - p.d) <= p.r) return true;
    return false;
  }

  // how to push a point outside every drivable piece back in:
  // returns { ds, dd, pen } (unit direction in road space + depth)
  pushOut(s, d) {
    let best = null;
    for (const g of this.segs) {
      const n = nearest(g.pts, s, d);
      const pen = n.dist - g.hw;
      if (!best || pen < best.pen) {
        const l = n.dist || 1;
        best = { ds: (n.ps - s) / l, dd: (n.pd - d) / l, pen };
      }
    }
    for (const a of this.areas) {
      const cs = Math.max(a.s0, Math.min(a.s1, s)), cd = Math.max(a.d0, Math.min(a.d1, d));
      const dist = Math.hypot(cs - s, cd - d);
      if (dist < best.pen) best = { ds: (cs - s) / (dist || 1), dd: (cd - d) / (dist || 1), pen: dist };
    }
    for (const p of this.pads) {
      const dist = Math.hypot(s - p.s, d - p.d), pen = dist - p.r;
      if (pen < best.pen) best = { ds: (p.s - s) / (dist || 1), dd: (p.d - d) / (dist || 1), pen };
    }
    {
      // the open ground
      const cs = Math.max(this.S - 6, Math.min(this.S + 566, s));
      const cd = Math.max(this.openD0(cs), Math.min(170, d));
      const dist = Math.hypot(cs - s, cd - d);
      if (dist < best.pen) best = { ds: (cs - s) / (dist || 1), dd: (cd - d) / (dist || 1), pen: dist };
    }
    return best;
  }

  // the nearest drivable lane centre (street, ramp or aux lane) to a point,
  // with its direction in road space (for putting a car back on the road)
  nearestLane(s, d) {
    let best = null;
    for (const g of this.segs) {
      const n = nearest(g.pts, s, d);
      if (!best || n.dist < best.dist) {
        const a = g.pts[n.k], b = g.pts[n.k + 1];
        const l = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
        best = { dist: n.dist, s: n.ps, d: n.pd, ts: (b[0] - a[0]) / l, td: (b[1] - a[1]) / l, twoWay: g.kind === 'street' };
      }
    }
    return best;
  }

  // traffic light: green 12 s, amber 3 s, red 12 s (for the loop's near street)
  update(dt, player) {
    const L = this.light;
    L.t = (L.t + dt) % 27;
    L.state = L.t < 12 ? 'green' : L.t < 15 ? 'amber' : 'red';
    // loop cars: follow the loop on the right-hand side, keep their distance,
    // stop at the red light and for the player
    const n = this.cars.length;
    for (let i = 0; i < n; i++) {
      const c = this.cars[i];
      let vWant = 8.5;
      // the car ahead on the loop
      for (const o of this.cars) {
        if (o === c) continue;
        let gap = o.t - c.t;
        if (gap < 0) gap += this.loopLen[this.loopLen.length - 1];
        if (gap < 14) vWant = Math.min(vWant, Math.max(0, (gap - 7) * 0.9));
      }
      // red light (only on the near street before the junction)
      if (L.state !== 'green' && c.s < L.stopS && L.stopS - c.s < 22 && Math.abs(c.d - NEAR) < 5) {
        vWant = Math.min(vWant, Math.max(0, (L.stopS - c.s - 2) * 0.8));
      }
      // don't run the player over
      if (player && Math.abs(player.s - c.s) < 30 && Math.abs(player.d - c.d) < 30) {
        const dx = player.s - c.s, dy = player.d - c.d;
        const ahead = dx * c.ts + dy * c.td;
        const side = Math.abs(-dx * c.td + dy * c.ts);
        if (ahead > 0 && ahead < 12 && side < 3) vWant = Math.min(vWant, Math.max(0, (ahead - 6) * 0.8));
      }
      c.v += Math.max(-6, Math.min(2, (vWant - c.v) * 1.5)) * dt;
      c.v = Math.max(0, c.v);
      c.t = (c.t + c.v * dt) % this.loopLen[this.loopLen.length - 1];
      this.placeOnLoop(c);
    }
  }

  placeOnLoop(c) {
    const cum = this.loopLen;
    let k = 1;
    while (k < cum.length - 1 && cum[k] < c.t) k++;
    const a = this.loop[k - 1], b = this.loop[k];
    const seg = cum[k] - cum[k - 1] || 1;
    const u = (c.t - cum[k - 1]) / seg;
    const ts = (b[0] - a[0]) / seg, td = (b[1] - a[1]) / seg;
    // drive on the right: right of travel direction (+s,+d frame) is (-td, ts) rotated: (td, -ts)? use +d for +s travel
    const rs = -td, rd = ts; // for travel along +s this points to +d (right)
    c.s = a[0] + (b[0] - a[0]) * u + rs * 1.9;
    c.d = a[1] + (b[1] - a[1]) * u + rd * 1.9;
    c.ts = ts;
    c.td = td;
    c.yaw = Math.atan2(-td, ts);
  }

  // ---------------------------------------------------------------- build
  build(root, mats, GeoB) {
    const W = this.W, P = W.path, S = this.S;
    const a = P.sample(S, {});
    this.anchor = { x: a.x, y: a.y, z: a.z };
    const A = this.anchor;
    const geo = {
      street: new GeoB(), ramp: new GeoB(), ground: new GeoB(), pave: new GeoB(), concrete: new GeoB(), rail: new GeoB(),
      dark: new GeoB(), metal: new GeoB(), lamp: new GeoB(), building: new GeoB(), shop: new GeoB(), colored: new GeoB(),
      leaf: new GeoB(), canopy: new GeoB(), tkFacade: new GeoB(), tkShop: new GeoB(), tkSign: new GeoB(), leafTk: new GeoB(),
    };
    geo.colored.col = '#888888';
    geo.leafTk.col = '#4f8a3e';
    geo.leaf.col = '#2f5a42';
    const glows = this.glows, lights = this.lights;
    const R = (k) => hash(this.f.id * 19.7 + k * 3.31);
    const wp = (s, d, y) => {
      const p = P.point(s, d, y);
      return [p.x - A.x, p.y - A.y, p.z - A.z];
    };
    // ribbon along a polyline in road space, width w, at height y (upward faces)
    const ribbon = (g, pts, w, y, closed = false) => {
      const n = pts.length;
      let len = 0;
      const rows = [];
      for (let i = 0; i < n; i++) {
        const p = pts[i];
        const q0 = pts[Math.max(0, i - 1)], q1 = pts[Math.min(n - 1, i + 1)];
        let ts = q1[0] - q0[0], td = q1[1] - q0[1];
        const l = Math.hypot(ts, td) || 1;
        ts /= l; td /= l;
        if (i > 0) len += Math.hypot(p[0] - pts[i - 1][0], p[1] - pts[i - 1][1]);
        const L = wp(p[0] - td * w / 2, p[1] + ts * w / 2, y);
        const Rr = wp(p[0] + td * w / 2, p[1] - ts * w / 2, y);
        rows.push([g.v(...L, 0, len / 8), g.v(...Rr, 1, len / 8), L, Rr]);
      }
      for (let i = 0; i < n - 1; i++) {
        const [a0, b0, La, Ra] = rows[i], [a1, b1] = rows[i + 1];
        // keep the faces pointing up
        const ux = Ra[0] - La[0], uz = Ra[2] - La[2];
        const nx = rows[i + 1][2][0] - La[0], nz = rows[i + 1][2][2] - La[2];
        const up = ux * nz - uz * nx; // y of (R-L) x (L1-L)
        if (up < 0) { g.tri(a0, b0, a1); g.tri(b0, b1, a1); } else { g.tri(a0, a1, b0); g.tri(b0, a1, b1); }
      }
    };

    // ground under the whole exit (between the highway and the city beyond)
    W.strip(geo.ground, [[18.9, -0.03], [175, -0.03]], S - 8, S + 572, A, { mode: 'world', tile: 6 });
    // flat shoulder between the highway edge and the ramps (the highway curb is cut out here)
    W.strip(geo.concrete, [[16.9, 0.012], [19.0, 0.012]], S + 88, S + 480, A, { mode: 'world', tile: 4 });
    // kerbed pavements beside the loop (inner and outer), raised 15 cm
    ribbon(geo.pave, this.loop.map(([s, d]) => [s, d]), ST_HW * 2 + 9, 0.02);
    // streets, ramps, aux lanes on top
    ribbon(geo.street, this.loop, ST_HW * 2, 0.05);
    ribbon(geo.ramp, this.offRamp, RAMP_HW * 2, 0.05);
    for (const p of this.pads) {
      const c = wp(p.s, p.d, 0.045);
      const ci = geo.street.v(...c, 0.5, 0.5);
      const ring = [];
      for (let i = 0; i <= 16; i++) {
        const a = (i / 16) * Math.PI * 2;
        ring.push(geo.street.v(...wp(p.s + Math.cos(a) * p.r, p.d + Math.sin(a) * p.r, 0.045), 0.5, 0.5));
      }
      for (let i = 0; i < 16; i++) {
        // pick the winding that faces up
        const A0 = wp(p.s + Math.cos((i / 16) * Math.PI * 2) * p.r, p.d + Math.sin((i / 16) * Math.PI * 2) * p.r, 0);
        const A1 = wp(p.s + Math.cos(((i + 1) / 16) * Math.PI * 2) * p.r, p.d + Math.sin(((i + 1) / 16) * Math.PI * 2) * p.r, 0);
        const up = (A0[0] - c[0]) * (A1[2] - c[2]) - (A0[2] - c[2]) * (A1[0] - c[0]);
        if (up < 0) geo.street.tri(ci, ring[i], ring[i + 1]);
        else geo.street.tri(ci, ring[i + 1], ring[i]);
      }
    }
    ribbon(geo.ramp, this.onRamp, RAMP_HW * 2, 0.05);
    W.strip(geo.ramp, [[16.9, 0.004, 0], [AUX_D + AUX_HW, 0.004, 1]], S - 6, S + 92, A, { mode: 'road', tile: 8 });
    W.strip(geo.ramp, [[16.9, 0.004, 0], [AUX_D + AUX_HW, 0.004, 1]], S + 476, S + 566, A, { mode: 'road', tile: 8 });
    if (this.fuel) {
      const fc = this.forecourt;
      W.strip(geo.concrete, [[fc.d0, 0.05], [fc.d1, 0.05]], fc.s0, fc.s1, A, { mode: 'world', tile: 4 });
    }
    // guard rails: along the aux lanes and between the ramps
    const rail = (s0, s1, d) => W.guardRail(geo, s0, s1, d, -1, A);
    rail(S - 6, S + 64, AUX_D + AUX_HW + 0.05);
    // the gores: where each ramp parts from the highway. The highway's guard
    // rail runs between them; each nose gets a crash cushion, the off-ramp
    // gore its exit sign, and the triangles are planted
    const dAt = (pts, s) => {
      for (let i = 0; i < pts.length - 1; i++) {
        const [sa, da] = pts[i], [sb, db] = pts[i + 1];
        if (s >= sa && s <= sb) return da + ((db - da) * (s - sa)) / (sb - sa || 1);
      }
      return null;
    };
    const inner = (pts, s) => dAt(pts, s) - RAMP_HW;
    let gOff = S + 120, gOn = S + 460;
    for (let s = S + 80; s < S + 186; s += 0.5) if (inner(this.offRamp, s) > 18.4) { gOff = s; break; }
    for (let s = S + 494; s > S + 394; s -= 0.5) if (inner(this.onRamp, s) > 18.4) { gOn = s; break; }
    this.gores = [gOff, gOn];
    rail(gOff, gOn, 17.35);
    for (const [gs, dir, pts] of [[gOff, 1, this.offRamp], [gOn, -1, this.onRamp]]) {
      const cs = gs + dir * 1.6;
      const dm = (17.45 + inner(pts, cs)) / 2;
      geo.colored.col = '#e8b020';
      W.obox(geo.colored, cs, dm, 0.02, 2.6, 0.85, 0.85, A);
      geo.colored.col = '#1c1d22';
      for (const k of [-0.7, 0, 0.7]) W.obox(geo.colored, cs + k, dm, 0.25, 0.22, 0.88, 0.32, A);
      this.obstacles.push({ s: cs, d: dm, L: 2.6, W: 0.85, kind: 'cushion' });
      // shrubs and a couple of small trees in the triangle
      for (let s = gs + dir * 6; dir > 0 ? s < S + 200 : s > S + 380; s += dir * (4 + R(700 + s) * 3)) {
        const di = inner(pts, s);
        if (di === null) break;
        const gap = di - 17.6;
        if (gap < 1.6) continue;
        const d = 17.9 + gap / 2;
        if (gap > 5 && R(800 + s) < 0.35) {
          this.treeSpots.push([s, d]);
        } else {
          this.shrubSpots.push([s, d, Math.min(1.1, gap * 0.28)]);
        }
      }
    }
    {
      // the gore sign: just past the off-ramp nose, between rail and ramp
      const sg = gOff + 12, dg = (17.45 + inner(this.offRamp, sg)) / 2;
      W.obox(geo.metal, sg, dg, 0.02, 0.15, 0.15, 2.4, A);
      const f = P.sample(sg, {});
      const sign = new THREE.Mesh(new THREE.PlaneGeometry(2.2, 1.1), W.exitSign(this.f.no + 'g', [`EXIT ${this.f.no}`, '>']));
      const q = P.point(sg - 0.1, dg, 2.85);
      sign.position.set(q.x - A.x, q.y - A.y, q.z - A.z);
      sign.rotation.y = Math.atan2(-f.fx, -f.fz); // faces the approaching traffic
      this.extra = this.extra || [];
      this.extra.push(sign);
    }
    rail(S + 500, S + 566, AUX_D + AUX_HW + 0.05);

    // street lamps along the near and far streets (outside edge)
    for (let s = this.sA + 20; s < this.sB - 10; s += 34) {
      W.cityLamp(geo, s, NEAR - ST_HW - 1.6, 1, 0.02, A, glows, lights);
      W.cityLamp(geo, s + 17, FAR + ST_HW + 1.6, -1, 0.02, A, glows, lights);
    }
    // traffic light at the junction
    const L = this.light;
    W.obox(geo.metal, L.s, L.d, 0.02, 0.18, 0.18, 4.4, A);
    W.obox(geo.dark, L.s, L.d - 0.1, 3.6, 0.4, 0.5, 1.3, A);
    this.lightGlows = ['red', 'amber', 'green'].map((col, i) => {
      const p = P.point(L.s - 0.24, L.d - 0.1, 4.6 - i * 0.42);
      return { x: p.x, y: p.y, z: p.z, col };
    });

    // ---- the town around the loop, in the same Tokyo style as the highway.
    // Every footprint is checked against the streets, ramps, junctions, the
    // forecourt and the delivery bays (with room for the pavements), and
    // becomes a solid obstacle: you can drive off the streets here.
    const PAVE = 4.5;
    const tk = new Tokyo(W, { geo, a: A, glows, wires: this.wires, foot: (s, d, along, across) => this.obstacles.push({ s, d, L: along, W: across, kind: 'building' }) }, R);
    const margin = { street: ST_HW + PAVE - 0.1, ramp: RAMP_HW + 2.5, aux: AUX_HW + 2.5 };
    const blocked = (s, d) => {
      if (d < 20.5 || d > 172) return true;
      for (const g of this.segs) if (nearest(g.pts, s, d).dist < margin[g.kind]) return true;
      for (const p of this.pads) if (Math.hypot(s - p.s, d - p.d) < p.r + 3) return true;
      if (this.fuel) {
        const fc = this.forecourt;
        if (s > fc.s0 - 3 && s < fc.s1 + 3 && d > fc.d0 - 3 && d < fc.d1 + 14) return true;
      }
      for (const dr of this.drops) if (Math.hypot(s - dr.s, d - dr.d) < 3.5) return true;
      return false;
    };
    // is the rectangle [sm +- along/2] x [d0 .. d1] clear?
    const free = (sm, along, d0, d1) => {
      const ns = Math.max(2, Math.ceil(along / 2.5)), nd = Math.max(2, Math.ceil(Math.abs(d1 - d0) / 2.5));
      for (let i = 0; i <= ns; i++) {
        for (let j = 0; j <= nd; j++) {
          if (blocked(sm - along / 2 + (along * i) / ns, d0 + ((d1 - d0) * j) / nd)) return false;
        }
      }
      return true;
    };
    if (this.fuel) this.buildStation(geo, glows, lights, A);
    let k = 0;
    // a row of street-facing buildings from s0 to s1; front d, facing side
    // (-1: the building lies toward smaller d)
    const row = (s0, s1, front, side, mix) => {
      let s = s0 + R(k++) * 2;
      while (s < s1 - 4) {
        const shop = R(k++) < mix;
        const along = Math.min(shop ? 5.5 + R(k++) * 4.5 : 9 + R(k++) * 4, s1 - s);
        if (along < 4.5) break;
        const sm = s + along / 2;
        if (shop) {
          const depth = 9 + R(k++) * 4;
          if (free(sm, along, front, front + side * depth)) tk.shopHouse(sm, along, front, side, 0.02, { depth, shop: R(k++) < 0.8 });
        } else if (free(sm, along, front, front + side * 14)) {
          tk.house(sm, along, front, side, 0.02);
        }
        s += along + (R(k++) < 0.2 ? 1 + R(k++) * 2 : 0);
      }
    };
    // a field of apartment / office blocks filling [s0, s1] x [d0, d1]
    const blocks = (s0, s1, d0, d1, floorsMin, floorsMax) => {
      for (let d = d0; d < d1 - 8; d += 20 + R(k++) * 4) {
        let s = s0 + R(k++) * 4;
        while (s < s1 - 8) {
          const along = Math.min(10 + R(k++) * 9, s1 - s);
          const depth = Math.min(10 + R(k++) * 7, d1 - d);
          const sm = s + along / 2;
          if (along > 7 && depth > 7 && R(k++) < 0.85 && free(sm, along, d, d + depth)) {
            tk.backBlock(sm, along, d, 1, 0.02, floorsMin + Math.floor(R(k++) * (floorsMax - floorsMin + 1)), R(k++) < 0.25, depth);
          }
          s += along + 1.5 + R(k++) * 4;
        }
      }
    };
    const sNear = NEAR - ST_HW - PAVE, sFar = FAR + ST_HW + PAVE;
    const inS0 = this.sA + ST_HW + PAVE, inS1 = this.sB - ST_HW - PAVE;
    // between the highway and the near street: shops facing the near street
    row(S + 186, S + 396, sNear, -1, 0.75);
    // outside the far street: shops facing it
    row(this.sA - 6, this.sB + 6, sFar, 1, 0.85);
    // inside the block: shops facing both streets (the forecourt is skipped)
    row(inS0, inS1, NEAR + ST_HW + PAVE, 1, 0.8);
    row(inS0, inS1, FAR - ST_HW - PAVE, -1, 0.7);
    // the middle of the block: a little park, then apartments
    const parkS = inS0 + 18 + R(k++) * (inS1 - inS0 - 60);
    for (let i = 0; i < 9; i++) {
      const s = parkS + R(k++) * 30, d = 72 + R(k++) * 22;
      if (!blocked(s, d)) W.tree(geo, s, d, 0.02, A, R(k++));
    }
    blocks(inS0, parkS - 4, 70, 98, 3, 6);
    blocks(parkS + 34, inS1, 70, 98, 3, 6);
    // beyond the far street and on both sides of the loop: rows of blocks
    blocks(S - 6, S + 566, sFar + 16, 172, 4, 9);
    blocks(S - 6, this.sA - ST_HW - PAVE, 24, sFar + 14, 3, 7);
    blocks(this.sB + ST_HW + PAVE, S + 566, 24, sFar + 14, 3, 7);
    // gore planting, then trees and shrubs on any open ground left near the
    // ramps (solid trunks, so you can't drive through them)
    for (const [s, d, r] of this.shrubSpots) tk.bush(s, d, 0.02, r, r * 1.5);
    const treeAt = (s, d) => {
      tk.streetTree(s, d, 0.02, 0.9 + R(900 + s) * 0.4);
      this.obstacles.push({ s, d, L: 0.6, W: 0.6, kind: 'tree' });
    };
    for (const [s, d] of this.treeSpots) treeAt(s, d);
    const hitsBuilding = (s, d, pad) => this.obstacles.some((o) => Math.abs(o.s - s) < o.L / 2 + pad && Math.abs(o.d - d) < o.W / 2 + pad);
    for (let s = S + 10; s < S + 560; s += 6.5) {
      for (let d = 23; d < NEAR - ST_HW - PAVE - 1; d += 6.5) {
        const js = s + (R(k++) - 0.5) * 3, jd = d + (R(k++) - 0.5) * 3;
        if (blocked(js, jd) || hitsBuilding(js, jd, 2.5)) continue;
        const r = R(k++);
        if (r < 0.45) treeAt(js, jd);
        else if (r < 0.8) tk.bush(js, jd, 0.02, 0.7 + R(k++) * 0.4, 1.1);
      }
    }
    // a hedge and street trees between the highway rail and the near row
    for (let s = S + 200; s < S + 382; s += 6 + R(k++) * 5) if (!blocked(s, 22)) tk.bush(s, 22 + R(k++) * 2, 0.4, 1.1, 1.6);
    // utility poles + wires along the near and far streets, clear of the lamps
    const nearLamp = (s, off) => Math.abs(((s - (this.sA + 20 + off)) % 34 + 34) % 34) < 3 || Math.abs(((s - (this.sA + 20 + off)) % 34 + 34) % 34) > 31;
    const flat = () => 0.02;
    tk.poles(this.sA + 20, this.sB - 20, NEAR - ST_HW - 0.7, flat, (s) => s > this.sA + 20 && s < this.sB - 20 && !nearLamp(s, 0));
    tk.poles(this.sA + 20, this.sB - 20, FAR + ST_HW + 0.7, flat, (s) => s > this.sA + 20 && s < this.sB - 20 && !nearLamp(s, 17));
    // delivery spots: a yellow loading bay on the pavement and a lit number post
    for (const dr of this.drops) {
      geo.colored.col = '#d9a62e';
      W.obox(geo.colored, dr.s, dr.d, 0.02, 3.2, 3.2, 0.04, A);
      geo.colored.col = '#2a2d36';
      W.obox(geo.colored, dr.s, dr.d, 0.03, 2.6, 2.6, 0.04, A);
      W.obox(geo.metal, dr.s + 1.7, dr.d + 1.7, 0.1, 0.12, 0.12, 1.9, A);
      W.obox(geo.lamp, dr.s + 1.7, dr.d + 1.7, 2.0, 0.5, 0.5, 0.4, A);
    }
    // highway signage handled by the world's chunks; a gore sign at the split
    // assemble
    const group = new THREE.Group();
    const add = (g, mat) => {
      if (!g.empty) group.add(new THREE.Mesh(g.build(), mat));
    };
    add(geo.ground, mats.ground);
    add(geo.pave, mats.pave);
    add(geo.street, mats.street);
    add(geo.ramp, mats.ramp);
    add(geo.concrete, mats.concrete);
    add(geo.rail, mats.rail);
    add(geo.dark, mats.dark);
    add(geo.metal, mats.metal);
    add(geo.lamp, mats.lamp);
    add(geo.building, mats.building);
    add(geo.shop, mats.shop);
    add(geo.colored, mats.colored);
    add(geo.leaf, mats.leaf);
    add(geo.canopy, mats.canopy);
    add(geo.tkFacade, mats.tk.facade);
    add(geo.tkShop, mats.tk.shop);
    add(geo.tkSign, mats.tk.sign);
    add(geo.leafTk, mats.tk.leaf);
    if (this.wires.length) {
      const wg = new THREE.BufferGeometry();
      wg.setAttribute('position', new THREE.Float32BufferAttribute(this.wires, 3));
      group.add(new THREE.LineSegments(wg, mats.tk.wire));
    }
    for (const m of this.extra || []) group.add(m);
    group.position.set(A.x - W.origin.x, A.y - W.origin.y, A.z - W.origin.z);
    root.add(group);
    this.group = group;
    // loop traffic
    const len = this.loopLen[this.loopLen.length - 1];
    for (let i = 0; i < 4; i++) {
      const type = ['sedan', 'hatch', 'suv', 'sedan'][i];
      const m = makeCar(type, CAR_COLORS[(this.f.id * 3 + i * 5) % CAR_COLORS.length]);
      root.add(m.group);
      const c = { t: (len * i) / 4 + R(90 + i) * 20, v: 6, mesh: m.group, tailMat: m.tailMat, L: m.dims.L, W: m.dims.W, type, dims: m.dims, yaw: 0 };
      this.placeOnLoop(c);
      this.cars.push(c);
    }
    this.built = true;
  }

  buildStation(geo, glows, lights, A) {
    const W = this.W, P = W.path;
    const fc = this.forecourt;
    const sm = (fc.s0 + fc.s1) / 2;
    const dm = NEAR + 17;
    // canopy on four columns with a lit underside
    W.obox(geo.canopy, sm, dm, 5.0, 46, 14, 0.8, A);
    geo.colored.col = '#c62a25';
    W.obox(geo.colored, sm, dm, 5.8, 46.4, 14.4, 0.35, A);
    for (const [ds, dd] of [[-20, -6], [20, -6], [-20, 6], [20, 6]]) W.obox(geo.metal, sm + ds, dm + dd, 0.05, 0.4, 0.4, 5, A);
    for (const ds of [-15, 0, 15]) {
      W.obox(geo.lamp, sm + ds, dm, 4.95, 6, 1.2, 0.06, A);
      const p = P.point(sm + ds, dm, 4.8);
      lights.push({ x: p.x, y: p.y, z: p.z, r: 1, g: 0.95, b: 0.85, power: 0.7, always: 1 });
    }
    // pumps
    for (const [ps, pd] of this.pumps) {
      W.obox(geo.concrete, ps, pd, 0.05, 5, 1.2, 0.2, A);
      this.obstacles.push({ s: ps, d: pd, L: 5, W: 1.2, kind: 'island' });
      geo.colored.col = '#e8e4da';
      W.obox(geo.colored, ps, pd, 0.25, 0.9, 0.6, 1.6, A);
      geo.colored.col = '#c62a25';
      W.obox(geo.colored, ps, pd, 1.6, 0.92, 0.62, 0.3, A);
      const p = P.point(ps, pd - 0.32, 1.2);
      glows.push({ x: p.x, y: p.y, z: p.z, r: 0.4, g: 1.2, b: 0.6, size: 0.35, always: 1 });
    }
    // shop behind the pumps
    W.boxBuilding(geo.building, sm, fc.d1 + 5, -0.5, 30, 10, 4.6, A, 0, 0);
    this.obstacles.push({ s: sm, d: fc.d1 + 5, L: 30, W: 10, kind: 'building' });
    W.shopFront(geo.shop, sm, fc.d1 - 0.12, 0, 30, 1, A, 0.25);
    // tall price sign at the street
    W.obox(geo.metal, fc.s0 + 4, NEAR + ST_HW + 1.5, 0.05, 0.3, 0.3, 7, A);
    geo.colored.col = '#1d2c55';
    W.obox(geo.colored, fc.s0 + 4, NEAR + ST_HW + 1.5, 7, 0.4, 2.6, 2.2, A);
    const p = P.point(fc.s0 + 4, NEAR + ST_HW + 0.9, 8.1);
    glows.push({ x: p.x, y: p.y, z: p.z, r: 1.3, g: 1.0, b: 0.3, size: 1.2, always: 1 });
  }

  render(origin, glows, night, time) {
    for (const c of this.cars) {
      const p = this.W.path.sample(c.s, {});
      const x = p.x + p.rx * c.d - origin.x, y = p.y - origin.y, z = p.z + p.rz * c.d - origin.z;
      c.mesh.position.set(x, y, z);
      const heading = p.h + c.yaw;
      c.mesh.rotation.set(0, heading, 0);
      if (this.W.wheels) this.W.wheels.add(c.mesh, c.dims, c.t / c.dims.wr);
      const fx = Math.sin(heading), fz = Math.cos(heading);
      const lx = Math.cos(heading), lz = -Math.sin(heading);
      const braking = c.v < 3;
      c.tailMat.color.setScalar(braking ? 3 : 1.3);
      const D = c.dims;
      for (const side of [1, -1]) {
        glows.add(x - fx * (D.L / 2 + 0.12) + lx * D.tailX * side, y + D.tailY, z - fz * (D.L / 2 + 0.12) + lz * D.tailX * side,
          1.4 * (braking ? 1.8 : 1), 0.16, 0.08, 0.32);
        glows.add(x + fx * (D.L / 2 + 0.15) + lx * D.headX * side, y + D.headY, z + fz * (D.L / 2 + 0.15) + lz * D.headX * side,
          1.6 * night + 0.25, 1.45 * night + 0.25, 1.1 * night + 0.2, 0.55);
      }
    }
    // traffic light
    if (this.lightGlows) {
      const cols = { red: [2.2, 0.15, 0.1], amber: [2.2, 1.2, 0.15], green: [0.2, 2.0, 0.6] };
      for (const g of this.lightGlows) {
        const on = g.col === this.light.state;
        const c = cols[g.col];
        const k = on ? 1 : 0.08;
        glows.add(g.x - origin.x, g.y - origin.y, g.z - origin.z, c[0] * k, c[1] * k, c[2] * k, on ? 0.7 : 0.4);
      }
    }
  }

  dispose(root) {
    if (this.group) {
      root.remove(this.group);
      this.group.traverse((o) => o.geometry && !o.userData.shared && o.geometry.dispose());
    }
    for (const c of this.cars) root.remove(c.mesh);
    this.cars = [];
  }

  rebase(origin) {
    if (this.group) this.group.position.set(this.anchor.x - origin.x, this.anchor.y - origin.y, this.anchor.z - origin.z);
  }

  // which drop is the player stopped at (within r metres)?
  dropAt(s, d, r = 5) {
    return this.drops.find((dr) => Math.hypot(dr.s - s, dr.d - d) < r) || null;
  }
  pumpAt(s, d, r = 3.2) {
    return this.fuel ? this.pumps.find(([ps, pd]) => Math.hypot(ps - s, pd - d) < r) || null : null;
  }
}
