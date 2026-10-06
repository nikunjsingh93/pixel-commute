// The parts of a city built once for the whole zone (visible from afar):
// the ramps, the elevated metro and its stations, the landmarks (Skytree,
// temple, park, crossing screens), the mountain with its hairpin road, forest
// and cable car. Plus the per-tile extras (pavement furniture, the space
// under the expressway). Installed onto CityNet.prototype.
import * as THREE from 'three';
import { hash } from './path.js';
import { CityNet } from './city.js';
import { CITY_V0, CITY_V1, DECK_V0, DECK_V1, nearestOn, along, cumLen, clamp } from './citylayout.js';
import { upQuad, wallQuad, lbox, ribbon } from './citybuild.js';
import { Tokyo, leafBall, ATLAS } from './tokyo.js';
import { billboardTexture } from './textures.js';
import { font } from './font.js';

const P = CityNet.prototype;

// a polyline resampled every `step` metres
function resample(pts, step) {
  const cum = cumLen(pts);
  const L = cum[cum.length - 1];
  const out = [];
  const o = {};
  for (let t = 0; t <= L + 0.01; t += step) {
    along(pts, cum, Math.min(t, L), o);
    out.push([o.u, o.v, t]);
  }
  return out;
}

P.buildFixed = function buildFixed() {
  const G = this.newGeo();
  const raw = G.raw;
  const glows = this.alwaysGlows, lights = this.alwaysLights;
  this.wiresFixed = [];
  this.buildRamps(G, glows);
  this.buildMetro(G, glows, lights);
  this.buildSkytree(G, glows);
  this.buildTemple(G, glows, lights);
  this.buildPark(G);
  this.buildScramble(G, glows);
  this.buildMountain(G, glows, lights);
  this.buildEdges(G);
  const group = this.meshesFor(raw);
  if (this.wiresFixed.length) {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.wiresFixed, 3));
    group.add(new THREE.LineSegments(g, this.tkMats.wire));
  }
  for (const m of this.fixedMeshes || []) group.add(m);
  this.root.add(group);
  this.fixedGroup = group;
  this.obstaclesAll = [...this.obstacles];
};

// ---------------------------------------------------------------- ramps
P.buildRamps = function buildRamps(G, glows) {
  const lay = this.lay, raw = G.raw;
  for (const r of [lay.offRamp, lay.onRamp]) {
    const pts = resample(this.rampPts(r), 4).map(([u, v]) => [u, v]);
    const hAt = (p) => this.rampH(r, p[0]) + 0.05;
    // one-way ramp surface (white edge lines, no centre line)
    ribbon(raw.ramp, this, pts, lay.RAMP_HW * 2, (i, p) => hAt(p), 8);
    // walls on both sides where the ramp is up in the air, and the deck
    // under it (fascia down to a soffit 1.1 m below the surface)
    for (let i = 0; i < pts.length - 1; i++) {
      const [ua, va] = pts[i], [ub, vb] = pts[i + 1];
      const ha = this.rampH(r, ua), hb = this.rampH(r, ub);
      if (Math.max(ha, hb) < 0.25) continue;
      const tu = ub - ua, tv = vb - va, l = Math.hypot(tu, tv) || 1;
      const nu = -tv / l, nv = tu / l; // +normal (right of travel)
      for (const side of [1, -1]) {
        const w = lay.RAMP_HW + 0.25;
        const aU = ua + nu * w * side, aV = va + nv * w * side, bU = ub + nu * w * side, bV = vb + nv * w * side;
        const inner = [(ua + ub) / 2, (va + vb) / 2];
        // the aux-lane end joins the deck: no wall on the deck side there
        const onDeck = (aV + bV) / 2 < 19.9 && side * nv < 0;
        if (!onDeck) {
          // concrete parapet: outer face (with the fascia below the deck),
          // inner face toward the road, a flat top, and a steel rail on it
          const wi = w - 0.3;
          const iU = ua + nu * wi * side, iV = va + nv * wi * side, jU = ub + nu * wi * side, jV = vb + nv * wi * side;
          const away = [aU + nu * side * 3, aV + nv * side * 3];
          const quad = (g, P4, insideUV, h) => g.quadOut(P4, null, this.wp(insideUV[0], insideUV[1], h));
          quad(raw.bridge, [this.wp(aU, aV, Math.max(0, ha - 1.1)), this.wp(bU, bV, Math.max(0, hb - 1.1)), this.wp(bU, bV, hb + 0.95), this.wp(aU, aV, ha + 0.95)], inner, ha);
          quad(raw.bridge, [this.wp(iU, iV, ha), this.wp(jU, jV, hb), this.wp(jU, jV, hb + 0.95), this.wp(iU, iV, ha + 0.95)], away, ha);
          quad(raw.bridge, [this.wp(aU, aV, ha + 0.95), this.wp(bU, bV, hb + 0.95), this.wp(jU, jV, hb + 0.95), this.wp(iU, iV, ha + 0.95)], [inner[0], inner[1]], ha - 5);
          const rU = ua + nu * (w - 0.15) * side, rV = va + nv * (w - 0.15) * side, sU = ub + nu * (w - 0.15) * side, sV = vb + nv * (w - 0.15) * side;
          for (const fh of [1.22, 1.3]) {
            quad(raw.metal, [this.wp(rU - nu * 0.06, rV - nv * 0.06, ha + fh), this.wp(sU - nu * 0.06, sV - nv * 0.06, hb + fh), this.wp(sU + nu * 0.06, sV + nv * 0.06, hb + fh), this.wp(rU + nu * 0.06, rV + nv * 0.06, ha + fh)], inner, ha - 5);
          }
          if (i % 2 === 0) lbox(raw.metal, this, rU, rV, ha + 0.95, 0.1, 0.1, 0.35);
        }
      }
      // soffit
      const w = lay.RAMP_HW + 0.25;
      const A = this.wp(ua - nu * w, va - nv * w, Math.max(0, ha - 1.1)), B = this.wp(ua + nu * w, va + nv * w, Math.max(0, ha - 1.1));
      const C = this.wp(ub + nu * w, vb + nv * w, Math.max(0, hb - 1.1)), D = this.wp(ub - nu * w, vb - nv * w, Math.max(0, hb - 1.1));
      raw.bridge.quadOut([A, B, C, D], null, this.wp((ua + ub) / 2, (va + vb) / 2, Math.max(ha, hb) + 1));
    }
    // piers under the elevated part
    for (let u = Math.min(r.uTop, r.uFoot) + 20; u < Math.max(r.uTop, r.uFoot) - 10; u += 30) {
      const h = this.rampH(r, u);
      if (h > 2.5) lbox(raw.bridge, this, u, lay.RAMP_V, 0, 1.4, 1.4, h - 1.1);
    }
  }
  // aux lanes on the deck: surface + outer parapet with the ramp mouth open
  for (const [a0, a1] of lay.aux) {
    const yA = (u) => this.deck(u) + 0.01;
    const pts = [];
    for (let u = a0; u <= a1 + 0.01; u += 4) pts.push([u, 18.2]);
    ribbon(raw.ramp, this, pts, 3.2, (i, p) => yA(p[0]), 8);
    // parapet on the outside, except where the ramp leaves / joins
    const mouth = a0 < lay.offRamp.uTop + 10 && a1 > lay.offRamp.uTop - 10 ? [lay.offRamp.u0, lay.offRamp.uTop + 8] : [lay.onRamp.uTop - 8, lay.onRamp.u1];
    for (let u = a0; u < a1; u += 4) {
      const ub = Math.min(a1, u + 4);
      if (ub > mouth[0] && u < mouth[1]) continue;
      wallQuad(raw.bridge, this, u, 19.85, ub, 19.85, this.deck(u) - 1.25, this.deck(u) + 1.05, u + 2, 18);
      upQuad(raw.bridge, this, u, ub, 19.55, 19.85, this.deck(u) + 1.05);
      wallQuad(raw.bridge, this, u, 19.55, ub, 19.55, this.deck(u) + 0.02, this.deck(u) + 1.05, u + 2, 21);
    }
    // soffit under the aux lane
    for (let u = a0; u < a1; u += 4) {
      const ub = Math.min(a1, u + 4);
      const h = this.deck(u) - 1.25;
      raw.bridge.quadOut([this.wp(u, 18.0, h), this.wp(ub, 18.0, h), this.wp(ub, 19.85, h), this.wp(u, 19.85, h)], null, this.wp(u + 2, 19, h + 1));
    }
  }
  // Shuto-style green signs: over the aux lane before the off-ramp, and at
  // the on-ramp's foot
  const exitSign = this.W.exitSign('city' + this.f.id, [this.name, 'EXIT  >']);
  const sign = (u, v, h, w, hh, mat, face = -1) => {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w, hh), mat);
    const p = this.wp(u, v, h);
    m.position.set(p[0], p[1], p[2]);
    m.rotation.y = Math.atan2(face * this.F.x, face * this.F.z);
    (this.fixedMeshes = this.fixedMeshes || []).push(m);
  };
  const u = lay.offRamp.u0 - 120;
  lbox(raw.metal, this, u, 18.9, this.deck(u), 0.3, 0.3, 7.6);
  lbox(raw.metal, this, u + 0.2, 13.5, this.deck(u) + 7.0, 0.2, 11, 0.25);
  lbox(raw.dark, this, u + 0.15, 15.2, this.deck(u) + 5.3, 0.12, 5.8, 3.0);
  sign(u - 0.05, 15.2, this.deck(u) + 6.8, 5.6, 2.8, exitSign);
  void net;
};
function net(n, u, v, h) {
  return n.wp(u, v, h);
}

// ---------------------------------------------------------------- metro
P.buildMetro = function buildMetro(G, glows, lights) {
  const lay = this.lay, raw = G.raw, M = lay.metro;
  const pts = resample(lay.metroPts, 6).map(([u, v]) => [u, v]);
  pts.push(pts[0]);
  const H = M.h;
  // deck: top, fascia both sides with a parapet, soffit
  ribbon(raw.concrete, this, pts, M.hw * 2, () => H, 6);
  for (let i = 0; i < pts.length - 1; i++) {
    const [ua, va] = pts[i], [ub, vb] = pts[i + 1];
    const tu = ub - ua, tv = vb - va, l = Math.hypot(tu, tv) || 1;
    const nu = -tv / l, nv = tu / l;
    const mid = [(ua + ub) / 2, (va + vb) / 2];
    for (const side of [1, -1]) {
      const w = M.hw;
      const a = [ua + nu * w * side, va + nv * w * side], b = [ub + nu * w * side, vb + nv * w * side];
      wallQuad(raw.bridge, this, a[0], a[1], b[0], b[1], H - 1.3, H + 1.0, mid[0], mid[1]);
      const ai = [ua + nu * (w - 0.3) * side, va + nv * (w - 0.3) * side], bi = [ub + nu * (w - 0.3) * side, vb + nv * (w - 0.3) * side];
      wallQuad(raw.bridge, this, ai[0], ai[1], bi[0], bi[1], H, H + 1.0, a[0] + (a[0] - mid[0]) * 2, a[1] + (a[1] - mid[1]) * 2);
      raw.bridge.quadOut([this.wp(a[0], a[1], H + 1), this.wp(b[0], b[1], H + 1), this.wp(bi[0], bi[1], H + 1), this.wp(ai[0], ai[1], H + 1)], null, this.wp(mid[0], mid[1], H));
    }
    const w = M.hw;
    raw.bridge.quadOut([this.wp(ua - nu * w, va - nv * w, H - 1.3), this.wp(ua + nu * w, va + nv * w, H - 1.3), this.wp(ub + nu * w, vb + nv * w, H - 1.3), this.wp(ub - nu * w, vb - nv * w, H - 1.3)], null, this.wp(mid[0], mid[1], H));
    // shops in the arches under the track (Yurakucho style), not over streets
    const over = lay.nearStreet(mid[0], mid[1], 0.5);
    if (!over && l > 3) {
      for (const side of [1, -1]) {
        const a = [ua + nu * (w - 0.6) * side, va + nv * (w - 0.6) * side], b = [ub + nu * (w - 0.6) * side, vb + nv * (w - 0.6) * side];
        wallQuad(raw.tkFacade, this, a[0], a[1], b[0], b[1], 0, H - 1.3, mid[0], mid[1]);
        // the shop front in the arch (lit at night)
        const kind = Math.floor(hash(i * 3.1 + side) * 8);
        const v0 = 1 - (kind * 64 + 64) / 512;
        const Pq = [this.wp(a[0] + (b[0] - a[0]) * 0.1, a[1] + (b[1] - a[1]) * 0.1, 0.05), this.wp(a[0] + (b[0] - a[0]) * 0.9, a[1] + (b[1] - a[1]) * 0.9, 0.05)];
        const Q = [Pq[0], Pq[1], [Pq[1][0], 3.2, Pq[1][2]], [Pq[0][0], 3.2, Pq[0][2]]];
        // nudge outward so it sits in front of the wall
        const ox = (this.F.x * nu + this.Rv.x * nv) * side * 0.05, oz = (this.F.z * nu + this.Rv.z * nv) * side * 0.05;
        for (const q of Q) { q[0] += ox; q[2] += oz; }
        raw.tkShop.quadOut(Q, [[0, v0], [l * 0.8 / 6.4, v0], [l * 0.8 / 6.4, v0 + 1 / 8], [0, v0 + 1 / 8]], this.wp(mid[0], mid[1], 1.5));
      }
      // the end walls of the arches are the next segment's; fill the top
    }
    // rails (two tracks) and the overhead line every ~48 m
    for (const off of [-2.6, -1.1, 1.1, 2.6]) {
      const a = [ua + nu * off, va + nv * off], b = [ub + nu * off, vb + nv * off];
      raw.metal.quadOut([this.wp(a[0] - nu * 0.06, a[1] - nv * 0.06, H + 0.18), this.wp(b[0] - nu * 0.06, b[1] - nv * 0.06, H + 0.18), this.wp(b[0] + nu * 0.06, b[1] + nv * 0.06, H + 0.18), this.wp(a[0] + nu * 0.06, a[1] + nv * 0.06, H + 0.18)], null, this.wp(mid[0], mid[1], H));
    }
    if (i % 8 === 0) {
      for (const side of [1, -1]) {
        const pu = ua + nu * (M.hw - 0.5) * side, pv = va + nv * (M.hw - 0.5) * side;
        lbox(raw.metal, this, pu, pv, H + 1, 0.2, 0.2, 5);
      }
      lbox(raw.metal, this, ua, va, H + 5.8, 0.15 + Math.abs(nu) * M.hw * 2, 0.15 + Math.abs(nv) * M.hw * 2, 0.15);
    }
  }
  // overhead wires
  for (const off of [-1.85, 1.85]) {
    for (let i = 0; i < pts.length - 1; i++) {
      const [ua, va] = pts[i], [ub, vb] = pts[i + 1];
      const tu = ub - ua, tv = vb - va, l = Math.hypot(tu, tv) || 1;
      const nu = -tv / l, nv = tu / l;
      const a = this.wp(ua + nu * off, va + nv * off, H + 5.6), b = this.wp(ub + nu * off, vb + nv * off, H + 5.6);
      this.wiresFixed.push(...a, ...b);
    }
  }
  // stations: two side platforms with canopies, a station house below with
  // the entrance and a big name sign
  const nameMat = (name) => new THREE.MeshBasicMaterial({ map: billboardTexture([name, 'STATION'], '#1d6b45', '#f4f1e8', font), color: new THREE.Color(1.3, 1.3, 1.3) });
  for (const st of lay.stations) {
    const n = nearestOn(lay.metroPts, st.u, st.v);
    const a = lay.metroPts[n.k], b = lay.metroPts[n.k + 1];
    const l = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
    const tu = (b[0] - a[0]) / l, tv = (b[1] - a[1]) / l;
    const nu = -tv, nv = tu;
    st.tu = tu; st.tv = tv;
    const yaw = Math.atan2(tv, tu);
    for (const side of [1, -1]) {
      const cu = st.u + nu * (M.hw + 2.2) * side, cv = st.v + nv * (M.hw + 2.2) * side;
      lbox(raw.concrete, this, cu, cv, H - 0.4, 90, 4.2, 1.4, yaw);
      lbox(raw.colored, this, cu, cv, H + 1.0, 90, 0.2, 0.02, yaw);
      // canopy on posts
      for (let k = -40; k <= 40; k += 10) lbox(raw.metal, this, cu + tu * k + nu * side * 1.6, cv + tv * k + nv * side * 1.6, H + 1, 0.2, 0.2, 3.2, yaw);
      lbox(raw.roof, this, cu, cv, H + 4.2, 92, 5.2, 0.3, yaw);
      // platform lamps
      for (let k = -36; k <= 36; k += 18) {
        const p = this.wp(cu + tu * k, cv + tv * k, H + 4.0);
        glows.push({ x: p[0] + this.A.x, y: p[1] + this.A.y, z: p[2] + this.A.z, r: 0.9, g: 0.95, b: 1.0, size: 0.8, h: 4, always: 1 });
      }
      st['platform' + (side > 0 ? 'R' : 'L')] = { u: cu, v: cv };
    }
    // station house below (one side), entrance facing the street
    const hu = st.u, hv = st.v + (st.v < 150 ? -1 : 1) * (M.hw + 9);
    lbox(raw.building, this, hu, hv, -0.5, 26, 10, 6.5, yaw);
    lbox(raw.colored, this, hu, hv, 6, 27, 11, 0.4, yaw);
    st.entrance = { u: hu, v: hv + (st.v < 150 ? -5.6 : 5.6) };
    this.obstacles.push({ s: this.S + hu, d: hv, L: 26, W: 10, y0: this.base - 1, y1: this.base + 6.5, kind: 'building', layer: 'city' });
    // the name sign over the entrance (both faces)
    const mat = nameMat(st.name);
    for (const face of [1, -1]) {
      const m = new THREE.Mesh(new THREE.PlaneGeometry(9, 3.4), mat);
      const p = this.wp(hu, st.entrance.v + face * 0.02 * 0, 7.2);
      const nside = st.v < 150 ? -1 : 1;
      m.position.set(p[0] + this.Rv.x * nside * 0.2, p[1], p[2] + this.Rv.z * nside * 0.2);
      m.rotation.y = Math.atan2(this.Rv.x * nside * face, this.Rv.z * nside * face);
      (this.fixedMeshes = this.fixedMeshes || []).push(m);
    }
    const p = this.wp(st.entrance.u, st.entrance.v, 3);
    glows.push({ x: p[0] + this.A.x, y: p[1] + this.A.y, z: p[2] + this.A.z, r: 0.3, g: 1.2, b: 0.6, size: 1.2, h: 3, always: 1 });
  }
};

// ---------------------------------------------------------------- landmarks
P.buildSkytree = function buildSkytree(G, glows) {
  const raw = G.raw, T = this.lay.skytree;
  // a tapered 12-sided tube with the lattice texture
  const ring = (h, r) => {
    const out = [];
    for (let i = 0; i <= 12; i++) {
      const a = (i / 12) * Math.PI * 2;
      out.push([T.u + Math.cos(a) * r, T.v + Math.sin(a) * r, h, i / 12]);
    }
    return out;
  };
  const prof = [[0, 17], [40, 12.5], [100, 8.5], [150, 6.4], [200, 5.0], [228, 3.6]];
  for (let k = 0; k < prof.length - 1; k++) {
    const [h0, r0] = prof[k], [h1, r1] = prof[k + 1];
    const A = ring(h0, r0), B = ring(h1, r1);
    for (let i = 0; i < 12; i++) {
      const q = [this.wp(A[i][0], A[i][1], h0), this.wp(A[i + 1][0], A[i + 1][1], h0), this.wp(B[i + 1][0], B[i + 1][1], h1), this.wp(B[i][0], B[i][1], h1)];
      const uv = [[A[i][3] * 4, h0 / 16], [A[i + 1][3] * 4, h0 / 16], [A[i + 1][3] * 4, h1 / 16], [A[i][3] * 4, h1 / 16]];
      raw.lattice.quadOut(q, uv, this.wp(T.u, T.v, (h0 + h1) / 2));
    }
  }
  // observation decks: wide glassy rings
  const deck = (h, r, dh) => {
    const A = ring(h, r), B = ring(h + dh, r * 1.04);
    for (let i = 0; i < 12; i++) {
      raw.colored.col = '#9fb7c8';
      raw.colored.quadOut([this.wp(A[i][0], A[i][1], h), this.wp(A[i + 1][0], A[i + 1][1], h), this.wp(B[i + 1][0], B[i + 1][1], h + dh), this.wp(B[i][0], B[i][1], h + dh)], null, this.wp(T.u, T.v, h + dh / 2));
    }
    lbox(G.col('#d8dce2'), this, T.u, T.v, h + dh, r * 1.9, r * 1.9, 0.6);
    lbox(G.col('#d8dce2'), this, T.u, T.v, h - 0.6, r * 1.9, r * 1.9, 0.6);
    for (let i = 0; i < 12; i += 2) {
      const p = this.wp(A[i][0], A[i][1], h + dh / 2);
      glows.push({ x: p[0] + this.A.x, y: p[1] + this.A.y, z: p[2] + this.A.z, r: 0.5, g: 0.6, b: 1.2, size: 2.2 });
    }
  };
  deck(146, 9.6, 8);
  deck(188, 6.8, 5);
  lbox(G.col('#c9ccd2'), this, T.u, T.v, 228, 2.2, 2.2, 20);
  lbox(G.col('#e8e8ea'), this, T.u, T.v, 248, 0.8, 0.8, 8);
  const top = this.wp(T.u, T.v, 257);
  glows.push({ x: top[0] + this.A.x, y: top[1] + this.A.y, z: top[2] + this.A.z, r: 1, g: 0.15, b: 0.1, size: 3, blink: 0 });
  // the base complex
  lbox(G.raw.building, this, T.u, T.v, -0.5, 56, 46, 12);
  lbox(G.col('#c9ccd2'), this, T.u, T.v, 11.5, 58, 48, 0.6);
  this.obstacles.push({ s: this.S + T.u, d: T.v, L: 56, W: 46, y0: this.base - 1, y1: this.base + 260, kind: 'building', layer: 'city' });
};

P.buildTemple = function buildTemple(G, glows, lights) {
  const raw = G.raw, Z = this.lay.temple;
  const VER = '#c8402a', ROOF = '#2f3440', WALL = '#ece6d6', STONE = '#9a958a';
  const cu = (Z.u0 + Z.u1) / 2;
  // stone path from the street through both gates to the main hall
  upQuad(G.col(STONE), this, cu - 4, cu + 4, Z.v0 + 12, Z.v1, 0.06);
  // a gate: two (or four) vermilion pillars, a beam and a wide dark roof
  const gate = (v, w, h, big) => {
    for (const du of big ? [-w / 2, -w / 6, w / 6, w / 2] : [-w / 2, w / 2]) lbox(G.col(VER), this, cu + du, v, 0.06, 0.7, 0.7, h);
    lbox(G.col(VER), this, cu, v, h - 0.6, w + 1.4, 1.0, 0.8);
    this.roofL(G, cu, v, h + 0.2, w + 5, 5.5, 2.2, ROOF);
    if (big) this.roofL(G, cu, v, h + 3.4, w + 3, 4.5, 2.0, ROOF);
    this.obstacles.push({ s: this.S + cu - w / 2, d: v, L: 0.8, W: 0.8, y0: this.base - 1, y1: this.base + h, layer: 'city' });
    this.obstacles.push({ s: this.S + cu + w / 2, d: v, L: 0.8, W: 0.8, y0: this.base - 1, y1: this.base + h, layer: 'city' });
  };
  gate(Z.v1 - 4, 9, 6.5, false);
  // the big red lantern under the first gate
  lbox(G.col('#b8201a'), this, cu, Z.v1 - 4, 2.6, 2.4, 2.4, 3.2);
  lbox(G.col('#1c1d22'), this, cu, Z.v1 - 4, 2.4, 2.6, 2.6, 0.25);
  lbox(G.col('#1c1d22'), this, cu, Z.v1 - 4, 5.8, 2.6, 2.6, 0.25);
  const lp = this.wp(cu, Z.v1 - 4, 4.2);
  glows.push({ x: lp[0] + this.A.x, y: lp[1] + this.A.y, z: lp[2] + this.A.z, r: 1.2, g: 0.3, b: 0.15, size: 2.4, h: 4.2 });
  // Nakamise: two rows of small stalls along the approach
  const tk = new Tokyo(this.W, { geo: raw, a: this.A, glows, wires: [], foot: (s, d, L, W) => this.obstacles.push({ s, d, L, W, y0: this.base - 1, y1: this.base + 8, layer: 'city' }) }, (k) => hash(k * 0.37 + this.f.id));
  tk.setFrame(this.S + cu, 0, Math.PI / 2);
  for (const side of [1, -1]) {
    for (let v = Z.v1 - 12; v > Z.v1 - 42; v -= 5) {
      tk.shopHouse(v - 2.4, 4.6, side * 5, side, -this.deck(cu) + 0.02, { floors: 1, depth: 5, shop: true, signs: 0 });
      tk.lanterns(tk.frame(v - 2.4), 4.6, side * 5, side, -this.deck(cu));
    }
  }
  tk.setFrame();
  // inner gate (two storeys)
  gate(Z.v1 - 48, 11, 7.5, true);
  // main hall: raised base, red walls, huge two-tier roof
  const hv = Z.v0 + 18;
  lbox(G.col(STONE), this, cu, hv, 0.06, 30, 20, 1.6);
  lbox(G.col(VER), this, cu, hv, 1.6, 24, 15, 7);
  lbox(G.col(WALL), this, cu, hv + 7.6, 2.4, 18, 0.2, 5);
  this.roofL(G, cu, hv, 8.6, 34, 24, 6, ROOF);
  this.roofL(G, cu, hv, 13.6, 22, 15, 5, ROOF);
  this.obstacles.push({ s: this.S + cu, d: hv, L: 30, W: 20, y0: this.base - 1, y1: this.base + 20, layer: 'city' });
  // five-storey pagoda beside it
  const pu = Z.u0 + 18, pv = Z.v0 + 24;
  lbox(G.col(STONE), this, pu, pv, 0.06, 10, 10, 1.2);
  for (let i = 0; i < 5; i++) {
    const s = 7 - i * 0.6, h = 1.2 + i * 4.4;
    lbox(G.col(VER), this, pu, pv, h, s, s, 3.2);
    this.roofL(G, pu, pv, h + 3.0, s + 3.6, s + 3.6, 1.6, ROOF);
  }
  lbox(G.col('#c8a040'), this, pu, pv, 24.6, 0.4, 0.4, 7);
  this.obstacles.push({ s: this.S + pu, d: pv, L: 10, W: 10, y0: this.base - 1, y1: this.base + 30, layer: 'city' });
  // incense burner, stone lanterns, trees round the edge
  lbox(G.col('#4a4038'), this, cu, hv + 18, 0.06, 2.4, 2.4, 1.6);
  this.roofL(G, cu, hv + 18, 1.7, 3.2, 3.2, 1.0, '#4a4038');
  for (const du of [-6, 6]) {
    lbox(G.col(STONE), this, cu + du, Z.v1 - 30, 0.06, 0.8, 0.8, 1.8);
    lbox(G.col(STONE), this, cu + du, Z.v1 - 30, 1.8, 1.3, 1.3, 0.7);
  }
  for (let i = 0; i < 26; i++) {
    const u = Z.u0 + 4 + hash(i * 1.7) * (Z.u1 - Z.u0 - 8), v = Z.v0 + 4 + hash(i * 2.9) * (Z.v1 - Z.v0 - 8);
    if (Math.abs(u - cu) < 18 && v > Z.v0 + 6) continue;
    if (Math.hypot(u - pu, v - pv) < 9) continue;
    this.leafTree(G, u, v, 0, 0.9 + hash(i * 4.1) * 0.4);
  }
};

// a hip roof: a slab with sloped sides (gable along u)
P.roofL = function roofL(G, u, v, h, du, dv, rh, col) {
  const g = G.col(col);
  const P = (i, j, k) => this.wp(u + (du / 2) * i, v + (dv / 2) * j, h + rh * k);
  const inside = this.wp(u, v, h + rh * 0.3);
  g.quadOut([P(-1, -1, 0), P(1, -1, 0), P(0.55, -0.15, 1), P(-0.55, -0.15, 1)], null, inside);
  g.quadOut([P(-1, 1, 0), P(1, 1, 0), P(0.55, 0.15, 1), P(-0.55, 0.15, 1)], null, inside);
  g.quadOut([P(-1, -1, 0), P(-1, 1, 0), P(-0.55, 0.15, 1), P(-0.55, -0.15, 1)], null, inside);
  g.quadOut([P(1, -1, 0), P(1, 1, 0), P(0.55, 0.15, 1), P(0.55, -0.15, 1)], null, inside);
  g.quadOut([P(-0.55, -0.15, 1), P(0.55, -0.15, 1), P(0.55, 0.15, 1), P(-0.55, 0.15, 1)], null, this.wp(u, v, h));
  g.quadOut([P(-1, -1, 0), P(1, -1, 0), P(1, 1, 0), P(-1, 1, 0)], null, this.wp(u, v, h + 1));
};

// a leafy tree at (u, v) on the ground h
P.leafTree = function leafTree(G, u, v, h, k, pink = false) {
  const raw = G.raw;
  lbox(raw.dark, this, u, v, h, 0.3 * k, 0.3 * k, 2.6 * k);
  const crown = [[0, 0, 0.9, 1.5], [0.9, 0.3, 0.6, 1.0], [-0.8, -0.3, 0.6, 1.0], [0.2, 0.9, 0.5, 0.95], [-0.2, -0.9, 0.45, 0.95], [0.1, 0, 1.5, 0.9]];
  for (const [du, dv, dh, r] of crown) {
    const p = this.wp(u + du * k, v + dv * k, h + 2.6 * k + dh * k);
    leafBall(raw.leafTk, p[0], p[1], p[2], r * k, r * k * 0.85, hash(u * 3.1 + v * 7.7 + du) * 1000, pink ? 0.25 : 0);
    if (pink) {
      // repaint the last ball pink (cherry blossom)
      const cols = raw.leafTk.colors;
      const n = 80 * 3 * 3;
      for (let i = cols.length - n; i < cols.length; i += 3) {
        const g = cols[i + 1];
        cols[i] = 0.95 * (0.6 + g);
        cols[i + 1] = 0.45 * (0.6 + g);
        cols[i + 2] = 0.6 * (0.6 + g);
      }
    }
  }
  this.obstacles.push({ s: this.S + u, d: v, L: 0.6, W: 0.6, y0: this.base + h - 1, y1: this.base + h + 6, layer: 'city' });
};

P.buildPark = function buildPark(G) {
  const raw = G.raw, Z = this.lay.park;
  const cu = (Z.u0 + Z.u1) / 2, cv = (Z.v0 + Z.v1) / 2;
  // a pond with a stone rim, gravel paths, cherry trees and benches
  upQuad(raw.water, this, cu - 24, cu + 24, cv - 14, cv + 14, 0.04);
  for (const [a, b, c, d] of [[cu - 25, cu + 25, cv - 15, cv - 14], [cu - 25, cu + 25, cv + 14, cv + 15], [cu - 25, cu - 24, cv - 14, cv + 14], [cu + 24, cu + 25, cv - 14, cv + 14]]) {
    upQuad(G.col('#8f8b82'), this, a, b, c, d, 0.25);
  }
  upQuad(G.col('#b8ab90'), this, Z.u0 + 2, Z.u1 - 2, cv - 21, cv - 17, 0.04);
  upQuad(G.col('#b8ab90'), this, cu - 2, cu + 2, Z.v0 + 2, Z.v1 - 2, 0.03);
  this.obstacles.push({ s: this.S + cu, d: cv, L: 50, W: 30, y0: this.base - 1, y1: this.base + 0.6, layer: 'city', kind: 'pond' });
  for (let i = 0; i < 34; i++) {
    const u = Z.u0 + 4 + hash(i * 5.3 + 1) * (Z.u1 - Z.u0 - 8), v = Z.v0 + 4 + hash(i * 6.1 + 2) * (Z.v1 - Z.v0 - 8);
    if (Math.abs(u - cu) < 28 && Math.abs(v - cv) < 18) continue;
    if (Math.abs(u - cu) < 3 || Math.abs(v - (cv - 19)) < 3) continue;
    this.leafTree(G, u, v, 0, 0.8 + hash(i * 3.3) * 0.5, hash(i * 7.7) < 0.6);
  }
  for (const du of [-14, -6, 6, 14]) {
    lbox(G.col('#7a5a3a'), this, cu + du, cv - 22.6, 0.42, 1.8, 0.5, 0.08);
    lbox(G.col('#7a5a3a'), this, cu + du, cv - 22.85, 0.5, 1.8, 0.06, 0.45);
  }
};

// the crossing: four corner towers with giant screens facing it
P.buildScramble = function buildScramble(G, glows) {
  const raw = G.raw, lay = this.lay, X = lay.scramble;
  const a = lay.avenues.find((q) => q.id === 'R2'), c = lay.mainCross;
  const off = (s) => s + lay.PAVE + 0.6;
  for (const [du, dv] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
    const u = X.u + du * (off(c.hw) + 11), v = X.v + dv * (off(a.hw) + 9);
    const h = 34 + hash(du * 3 + dv * 7 + this.f.id) * 30;
    // the tower itself was planned (or this corner is empty): add the screen
    // on the face toward the crossing, both street faces
    const fu = u - du * 11, fv = v - dv * 9;
    const sw = 14, sh = 9;
    const P0 = this.wp(fu - du * 0.05, v - sw / 2 * 0.0, 0);
    void P0;
    // screen on the u-face (facing the crossing along u)
    const qu = (uu, v0, v1, h0, h1, face) => {
      const Q = [this.wp(uu, v0, h0), this.wp(uu, v1, h0), this.wp(uu, v1, h1), this.wp(uu, v0, h1)];
      raw.screen.quadOut(Q, [[0, 0], [1, 0], [1, 1], [0, 1]], this.wp(uu - face, (v0 + v1) / 2, (h0 + h1) / 2));
    };
    const qv = (vv, u0, u1, h0, h1, face) => {
      const Q = [this.wp(u0, vv, h0), this.wp(u1, vv, h0), this.wp(u1, vv, h1), this.wp(u0, vv, h1)];
      raw.screen.quadOut(Q, [[0, 0], [1, 0], [1, 1], [0, 1]], this.wp((u0 + u1) / 2, vv - face, (h0 + h1) / 2));
    };
    // a building block for the screen to hang on (the corner lot is reserved)
    lbox(raw.building, this, u, v, -0.5, 22, 18, h);
    this.obstacles.push({ s: this.S + u, d: v, L: 22, W: 18, y0: this.base - 1, y1: this.base + h, layer: 'city', kind: 'building' });
    qu(fu - du * 0.06, v - sw / 2 * dv * 0 - 7, v + 7, h * 0.45, h * 0.45 + sh, -du);
    qv(fv - dv * 0.06, u - 8, u + 8, h * 0.62, h * 0.62 + sh * 0.9, -dv);
    const p = this.wp(fu - du * 1.5, v, h * 0.45 + sh / 2);
    glows.push({ x: p[0] + this.A.x, y: p[1] + this.A.y, z: p[2] + this.A.z, r: 0.9, g: 0.7, b: 1.1, size: 4, h: h * 0.45, always: 1 });
  }
};

// ---------------------------------------------------------------- mountain
P.buildMountain = function buildMountain(G, glows, lights) {
  const raw = G.raw, lay = this.lay, L = this.L;
  const STEP = 10;
  const U0 = 0, U1 = L, V0 = 390, V1 = 1400;
  const nu = Math.round((U1 - U0) / STEP), nv = Math.round((V1 - V0) / STEP);
  const H = [];
  for (let i = 0; i <= nu; i++) {
    H.push([]);
    for (let j = 0; j <= nv; j++) H[i].push(this.mountainH(U0 + i * STEP, V0 + j * STEP));
  }
  const col = new THREE.Color();
  const g = raw.terrain;
  for (let i = 0; i < nu; i++) {
    for (let j = 0; j < nv; j++) {
      const u = U0 + i * STEP, v = V0 + j * STEP;
      const h00 = H[i][j], h10 = H[i + 1][j], h01 = H[i][j + 1], h11 = H[i + 1][j + 1];
      const tri = (a, b, c) => {
        // slope + height colouring: fields low down, forest, rock, snow
        const hm = (a[1] + b[1] + c[1]) / 3;
        const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2];
        const vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2];
        const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
        const slope = 1 - Math.abs(ny) / (Math.hypot(nx, ny, nz) || 1);
        const n = hash(a[0] * 0.13 + a[2] * 0.071);
        if (slope > 0.35) col.set('#6f6a60');
        else if (hm > 175) col.set('#d8dde6');
        else if (hm > 30 && n < 0.7) col.set(n < 0.35 ? '#2f4a32' : '#38553a');
        else col.set(n < 0.5 ? '#4f6e3c' : '#5a7a42');
        col.multiplyScalar(0.9 + n * 0.2);
        g._col = col.clone();
        const ia = g.v(...a), ib = g.v(...b), ic = g.v(...c);
        // upward facing
        if (ny > 0) g.tri(ia, ib, ic); else g.tri(ia, ic, ib);
      };
      const A = this.wp(u, v, h00), B = this.wp(u + STEP, v, h10), C = this.wp(u, v + STEP, h01), D = this.wp(u + STEP, v + STEP, h11);
      tri(A, B, D);
      tri(A, D, C);
    }
  }
  // the hill road: a two-way ribbon at the road height, guard rails on the
  // downhill side of each leg, a car park and viewpoint at the summit
  const pts = resample(lay.hill, 4);
  const pp = pts.map(([u, v]) => [u, v]);
  ribbon(raw.street, this, pp, lay.HILL_HW * 2, (i) => lay.hillH(pts[i][2]) + 0.06, 8);
  for (const [ua, ub, v] of lay.hillLegs) {
    const lo = Math.min(ua, ub), hi = Math.max(ua, ub);
    const rv = v - lay.HILL_HW - 0.6;
    for (let u = lo; u < hi; u += 4) {
      const hA = this.mountainH(u, v), hB = this.mountainH(Math.min(hi, u + 4), v);
      const r0 = this.wp(u, rv, hA + 0.5), r1 = this.wp(Math.min(hi, u + 4), rv, hB + 0.5);
      const r2 = this.wp(Math.min(hi, u + 4), rv, hB + 0.82), r3 = this.wp(u, rv, hA + 0.82);
      raw.rail.quadOut([r0, r1, r2, r3], null, this.wp(u + 2, rv + 1, hA + 0.6));
      raw.rail.quadOut([r0, r1, r2, r3], null, this.wp(u + 2, rv - 1, hA + 0.6));
      if (Math.round(u) % 8 === 0) lbox(raw.dark, this, u, rv, hA, 0.12, 0.12, 0.8);
    }
    // solid in 12 m pieces (each at its own height), clear of the hairpin ends
    for (let u = lo + 14; u < hi - 14; u += 12) {
      const ue = Math.min(hi - 14, u + 12);
      const hs = [u, ue].map((uu) => this.mountainH(uu, v));
      this.obstacles.push({ s: this.S + (u + ue) / 2, d: rv, L: ue - u, W: 0.3, y0: this.base + Math.min(...hs) - 0.6, y1: this.base + Math.max(...hs) + 1.0, layer: 'city', kind: 'rail' });
    }
  }
  const sm = lay.summit, sh = lay.hillH(lay.hillLen);
  upQuad(raw.asphalt, this, sm.u - 46, sm.u + 4, sm.v - 6, sm.v + 18, sh + 0.06);
  // viewpoint deck + telescope
  lbox(G.col('#8a6a4a'), this, sm.u - 30, sm.v + 22, sh, 18, 6, 0.4);
  for (const du of [-38, -22]) lbox(raw.metal, this, sm.u + du + 8, sm.v + 25, sh + 0.4, 0.15, 0.15, 1.2);
  // forest: conifers on the slopes (not on the road, not on the rock)
  let k = 0;
  for (let i = 0; i < 2000 && k < 900; i++) {
    const u = 120 + hash(i * 1.37 + 3) * (L - 240), v = 410 + hash(i * 2.11 + 7) * 900;
    if (lay.onHill(u, v, 6)) continue;
    if (Math.abs(u - lay.cable.u) < 10 && v < lay.cable.v1 + 20) continue;
    const h = this.mountainH(u, v);
    if (h > 172) continue;
    const h2 = this.mountainH(u + 3, v), h3 = this.mountainH(u, v + 3);
    if (Math.hypot(h2 - h, h3 - h) > 2.4) continue;
    const forest = hash(Math.floor(u / 90) * 3.7 + Math.floor(v / 90) * 1.9);
    if (forest < 0.35 && hash(i * 9.1) < 0.7) continue;
    this.W.tree(raw, this.S + u, v, h - this.deck(u), this.A, hash(i * 5.7), 1);
    k++;
  }
  // cable car: stations, towers, two cable pairs
  const C = lay.cable;
  const sta = (v, h, face) => {
    lbox(raw.building, this, C.u, v, h - 0.5, 16, 12, 7.5);
    lbox(G.col('#c8402a'), this, C.u, v, h + 7, 17, 13, 0.5);
    lbox(raw.metal, this, C.u, v + face * 7, h + 6, 10, 2, 0.6);
    this.obstacles.push({ s: this.S + C.u, d: v, L: 16, W: 12, y0: this.base + h - 1, y1: this.base + h + 8, layer: 'city' });
  };
  const hv0 = this.mountainH(C.u, C.v0);
  sta(C.v0, hv0, 1);
  const hv1 = this.mountainH(C.u, C.v1);
  sta(C.v1, hv1, -1);
  C.hb = hv0 + 7.2;
  C.ht = hv1 + 7.2;
  for (const t of C.towers) {
    const h0 = this.mountainH(C.u, t.v);
    lbox(raw.metal, this, C.u, t.v, h0, 1.2, 1.2, t.h - h0);
    lbox(raw.metal, this, C.u, t.v, t.h - 0.4, 9, 1.2, 0.6);
  }
  // cable profile: stations and tower tops, with a little sag between
  const prof = [[C.v0, C.hb], ...C.towers.map((t) => [t.v, t.h]), [C.v1, C.ht]];
  C.prof = prof;
  for (const off of [-3.2, 3.2]) {
    for (let i = 0; i < prof.length - 1; i++) {
      const [va, ha] = prof[i], [vb, hb] = prof[i + 1];
      const n = 10;
      for (let j = 0; j < n; j++) {
        const t0 = j / n, t1 = (j + 1) / n;
        const y0 = ha + (hb - ha) * t0 - Math.sin(t0 * Math.PI) * (vb - va) * 0.02;
        const y1 = ha + (hb - ha) * t1 - Math.sin(t1 * Math.PI) * (vb - va) * 0.02;
        this.wiresFixed.push(...this.wp(C.u + off, va + (vb - va) * t0, y0), ...this.wp(C.u + off, va + (vb - va) * t1, y1));
      }
    }
  }
};

// mountain height: the layout's terrain, falling away beyond the ridge and
// to nothing at the zone ends
P.mountainH = function mountainH(u, v) {
  const t = this.lay.terrain(u, v);
  const sm = (a, b, x) => {
    const q = clamp((x - a) / (b - a), 0, 1);
    return q * q * (3 - 2 * q);
  };
  return t * sm(0, 260, u) * (1 - sm(this.L - 260, this.L, u)) * (1 - sm(1150, 1400, v));
};

// low backdrop beyond the city's left edge so the zone doesn't just stop
P.buildEdges = function buildEdges(G) {
  const raw = G.raw;
  upQuad(raw.ground, this, 0, this.L, CITY_V0 - 160, CITY_V0 - 60, -0.02, (u, v) => [u / 6, v / 6]);
  for (let u = 10; u < this.L - 10; u += 26) {
    const h = 18 + hash(u * 0.37) * 40;
    lbox(raw.building, this, u + 12, CITY_V0 - 90 - hash(u) * 30, -0.5, 22, 20, h);
  }
};

// ---------------------------------------------------------------- tile extras
// pavement furniture along the avenues, the space under the expressway
P.extraTile = function extraTile(G, t, glows, lights, obstacles) {
  const lay = this.lay, raw = G.raw;
  const R = (k) => hash(t.i * 13.3 + t.j * 7.1 + k * 0.53 + this.f.id * 3);
  let k = 0;
  const posts = this.posts;
  const clearPost = (u, v) => !posts.some(([pu, pv]) => Math.abs(pu - u) < 2.6 && Math.abs(pv - v) < 2.6);
  const tk = new Tokyo(this.W, { geo: raw, a: this.A, glows, wires: this.wiresFor(t), posts: null, foot: null }, (q) => R(q + 500));
  const u0 = t.u - 80, u1 = t.u + 80, v0 = t.v - 80, v1 = t.v + 80;
  for (const a of lay.avenues) {
    for (const side of [1, -1]) {
      const kerb = a.v + side * a.hw;
      if (kerb < v0 || kerb > v1) continue;
      if (lay.underDeck(t.u, kerb)) continue;
      tk.setFrame(this.S, 0, 0);
      for (let u = Math.max(u0, a.u0) + R(k++) * 6; u < Math.min(u1, a.u1); u += 7 + R(k++) * 7) {
        if (lay.nearStreet(u, kerb + side * 2.5, 0) && lay.street(u, kerb + side * 2.5)) continue;
        if (lay.cross.some((c) => Math.abs(u - c.u) < c.hw + 7)) continue;
        if (!clearPost(u, kerb + side * 2)) continue;
        tk.furniture(this.S + u, kerb + side * 0.8, kerb + side * (lay.PAVE - 1.2), side, -this.deck(u) + 0.15, true);
      }
    }
  }
  tk.setFrame();
  // under the expressway: parking bays, bike racks and the odd food stall
  if (v0 < DECK_V1 + 8 && v1 > DECK_V0 - 8) {
    for (let u = u0 + 4; u < u1 - 4; u += 6) {
      if (u < lay.abutments[0] + 4 || u > lay.abutments[1] - 4) continue;
      if (lay.cross.some((c) => Math.abs(u - c.u) < c.hw + lay.PAVE + 2)) continue;
      if (lay.piers.some((p) => Math.abs(p.u - u) < 2.5)) continue;
      const r = R(k++);
      for (const vv of [-3, 4]) {
        // white bay lines
        upQuad(G.col('#d8d4c8'), this, u - 0.06, u + 0.06, vv - 2.6, vv + 2.6, 0.03);
        if (r < 0.45) {
          // a parked car (static, with its wheels baked in)
          this.parkedCar(t, u + 3, vv, R(k++), obstacles);
        }
      }
      if (r > 0.9) {
        // a yatai food stall with a red lantern
        lbox(G.col('#8a5a3a'), this, u + 3, -10, 0.02, 2.6, 1.6, 1.0);
        lbox(G.col('#c8281e'), this, u + 3, -10, 2.0, 3.0, 2.0, 0.15);
        for (const du of [-1.2, 1.2]) lbox(raw.dark, this, u + 3 + du, -10.7, 1.0, 0.08, 0.08, 1.0);
        const p = this.wp(u + 3, -10.9, 1.7);
        glows.push({ x: p[0] + this.A.x, y: p[1] + this.A.y, z: p[2] + this.A.z, r: 1.1, g: 0.3, b: 0.15, size: 0.8, h: 1.7 });
        obstacles.push({ s: this.S + u + 3, d: -10, L: 2.6, W: 1.6, y0: this.base - 1, y1: this.base + 2.2, layer: 'city' });
      }
    }
    // lamps under the deck
    for (let u = Math.ceil(u0 / 30) * 30; u < u1; u += 30) {
      if (u < lay.abutments[0] || u > lay.abutments[1]) continue;
      const h = this.deck(u) - 1.35;
      lbox(raw.lamp, this, u, 1.5, h, 2.0, 0.3, 0.06);
      const p = this.wp(u, 1.5, h - 0.2);
      glows.push({ x: p[0] + this.A.x, y: p[1] + this.A.y, z: p[2] + this.A.z, r: 1.0, g: 0.85, b: 0.6, size: 0.9, h: h - 0.2, always: 1 });
      lights.push({ x: p[0] + this.A.x, y: p[1] + this.A.y - 0.3, z: p[2] + this.A.z, r: 1, g: 0.8, b: 0.55, power: 0.5, always: 1 });
    }
  }
};

// a parked car mesh (shared geometry) at (u, v), facing +-u
P.parkedCar = function parkedCar(t, u, v, r, obstacles) {
  const types = ['sedan', 'hatch', 'suv', 'van', 'sedan', 'hatch'];
  const type = types[Math.floor(r * types.length)];
  const color = ['#d8d2c2', '#16181d', '#a9a9a9', '#7a1d1d', '#2c4a6e', '#e8e4da'][Math.floor(r * 37) % 6];
  const car = this.makeCar(type, color, true);
  const p = this.wp(u, v, 0);
  car.group.position.set(p[0], p[1], p[2]);
  car.group.rotation.y = Math.atan2(this.F.x, this.F.z) + (r < 0.5 ? 0 : Math.PI);
  car.group.traverse((o) => { if (o.isMesh) o.userData.shared = true; });
  (t.extraMeshes = t.extraMeshes || []).push(car.group);
  const ob = { s: this.S + u, d: v, L: car.dims.L, W: car.dims.W, y0: this.base - 1, y1: this.base + 1.6, layer: 'city', kind: 'car' };
  obstacles.push(ob);
  // a car you can get into (on foot)
  const ps = this.W.path.sample(this.S + u, {});
  (t.parked = t.parked || []).push({
    s: this.S + u, d: v, L: car.dims.L, W: car.dims.W, yaw: car.group.rotation.y - ps.h, y: this.base,
    type, color, mesh: car.group, ob, tile: t, net: this,
  });
};
