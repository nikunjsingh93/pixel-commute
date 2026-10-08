// The plan of a city zone, in zone coordinates: u metres along the highway
// from the zone start, v metres across it (+v = right of the highway, the
// same as the road-space d). The highway runs through the middle on a
// viaduct; the city streets are a grid around and under it, with an elevated
// metro loop, landmarks, and a mountain behind the city with a hairpin road
// and a cable car to the top. Everything here is pure geometry and queries;
// citybuild.js draws it and city.js runs it.
import { hash, vnoise } from './path.js';
import { deckAt } from './planner.js';

export const LANE = 3.3;
export const CITY_V0 = -215; // city edge (left)
export const CITY_V1 = 1150; // far edge (beyond the mountain top)
export const DECK_V0 = -15.4; // viaduct footprint across (both carriageways)
export const DECK_V1 = 18.0;

const ss = (a, b, x) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};
export const clamp = (x, a, b) => (x < a ? a : x > b ? b : x);

// nearest point on a polyline [[u, v], ...]
export function nearestOn(pts, u, v) {
  let best = { dist: Infinity, k: 0, t: 0, pu: 0, pv: 0 };
  for (let i = 0; i < pts.length - 1; i++) {
    const [u0, v0] = pts[i], [u1, v1] = pts[i + 1];
    const du = u1 - u0, dv = v1 - v0;
    const L2 = du * du + dv * dv || 1e-9;
    let t = ((u - u0) * du + (v - v0) * dv) / L2;
    t = t < 0 ? 0 : t > 1 ? 1 : t;
    const pu = u0 + du * t, pv = v0 + dv * t;
    const dist = Math.hypot(u - pu, v - pv);
    if (dist < best.dist) best = { dist, k: i, t, pu, pv };
  }
  return best;
}
export function cumLen(pts) {
  const c = [0];
  for (let i = 1; i < pts.length; i++) c.push(c[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]));
  return c;
}
// point + unit tangent at distance t along a polyline (with its cumLen)
export function along(pts, cum, t, out = {}) {
  const L = cum[cum.length - 1];
  t = clamp(t, 0, L);
  let k = 1;
  while (k < cum.length - 1 && cum[k] < t) k++;
  const a = pts[k - 1], b = pts[k];
  const seg = cum[k] - cum[k - 1] || 1;
  const x = (t - cum[k - 1]) / seg;
  out.u = a[0] + (b[0] - a[0]) * x;
  out.v = a[1] + (b[1] - a[1]) * x;
  out.tu = (b[0] - a[0]) / seg;
  out.tv = (b[1] - a[1]) / seg;
  out.k = k - 1;
  out.x = x;
  return out;
}
function arcPts(cu, cv, r, a0, a1, n) {
  const out = [];
  for (let i = 0; i <= n; i++) {
    const a = a0 + ((a1 - a0) * i) / n;
    out.push([cu + Math.cos(a) * r, cv + Math.sin(a) * r]);
  }
  return out;
}
// rounded rectangle loop (u0..u1 x v0..v1, corner radius r), counter-clockwise
function roundRect(u0, u1, v0, v1, r, n = 8) {
  const pts = [];
  const line = (a, b, m) => {
    for (let i = 0; i < m; i++) pts.push([a[0] + ((b[0] - a[0]) * i) / m, a[1] + ((b[1] - a[1]) * i) / m]);
  };
  const m = (L) => Math.max(2, Math.ceil(L / 40));
  line([u0 + r, v0], [u1 - r, v0], m(u1 - u0));
  pts.push(...arcPts(u1 - r, v0 + r, r, -Math.PI / 2, 0, n).slice(0, -1));
  line([u1, v0 + r], [u1, v1 - r], m(v1 - v0));
  pts.push(...arcPts(u1 - r, v1 - r, r, 0, Math.PI / 2, n).slice(0, -1));
  line([u1 - r, v1], [u0 + r, v1], m(u1 - u0));
  pts.push(...arcPts(u0 + r, v1 - r, r, Math.PI / 2, Math.PI, n).slice(0, -1));
  line([u0, v1 - r], [u0, v0 + r], m(v1 - v0));
  pts.push(...arcPts(u0 + r, v0 + r, r, Math.PI, Math.PI * 1.5, n).slice(0, -1));
  pts.push([u0 + r, v0]);
  return pts;
}

export class CityLayout {
  constructor(f) {
    this.f = f;
    this.L = f.s1 - f.s0;
    const L = this.L;
    const R = (k) => hash(f.id * 13.1 + k * 0.731);
    this.R = R;

    // ---------------------------------------------------------- streets
    // avenues run along u; nl = lanes each way
    this.avenues = [
      { id: 'L2', v: -150, nl: 2, u0: 150, u1: L - 150, name: 'CEDAR AVE' },
      { id: 'L1', v: -36, nl: 2, u0: 150, u1: L - 150, name: 'VIADUCT ROW' },
      { id: 'R1', v: 38, nl: 2, u0: 150, u1: L - 150, name: 'GALLERY ST' },
      { id: 'R2', v: 150, nl: 3, u0: 150, u1: L - 150, name: 'GRAND AVE' },
      { id: 'R3', v: 270, nl: 2, u0: 150, u1: L - 150, name: 'BLOSSOM ST' },
      { id: 'R4', v: 385, nl: 1, u0: 150, u1: L - 150, name: 'HILLSIDE RD' },
    ];
    // cross streets run along v; the ones in the full-height part of the
    // viaduct pass under it, the end ones stop at the frontage avenues
    const xs = [330, 520, 720, 900, 1080, 1280, 1480, 1670].map((u) => u * (L / 2000));
    this.cross = xs.map((u, i) => ({
      id: 'C' + i, u, nl: Math.abs(u - 900 * (L / 2000)) < 1 ? 3 : 2, v0: -150, v1: 385,
      name: ['ASH', 'ELM', 'OAK', 'PLAZA', 'MAPLE', 'BIRCH', 'WILLOW', 'PINE'][i] + ' ST',
    }));
    this.cross.push({ id: 'CW', u: 150, nl: 1, v0: -150, v1: -36, name: 'WEST END' }, { id: 'CWr', u: 150, nl: 1, v0: 38, v1: 385, name: 'WEST END' });
    this.cross.push({ id: 'CE', u: L - 150, nl: 1, v0: -150, v1: -36, name: 'EAST END' }, { id: 'CEr', u: L - 150, nl: 1, v0: 38, v1: 385, name: 'EAST END' });
    for (const a of this.avenues) a.hw = a.nl * LANE + 0.3;
    for (const c of this.cross) c.hw = c.nl * LANE + 0.3;
    this.mainCross = this.cross[3];
    this.scramble = { u: this.mainCross.u, v: 150 }; // the big scramble crossing (R2 x C3)
    this.PAVE = 5;

    // intersections
    this.nodes = [];
    for (const a of this.avenues) {
      for (const c of this.cross) {
        if (c.u < a.u0 - 1 || c.u > a.u1 + 1 || a.v < c.v0 - 1 || a.v > c.v1 + 1) continue;
        this.nodes.push({ u: c.u, v: a.v, a, c, id: this.nodes.length });
      }
    }

    // ---------------------------------------------------------- ramps
    // CityKit-style: the off-ramp leaves the viaduct on the right, drops beside
    // it and ends at a signal on a cross street under the viaduct; the
    // on-ramp starts at another one and climbs back up
    const cOff = this.cross[2], cOn = this.cross[5];
    this.RAMP_V = 23.2;
    this.RAMP_HW = 3.0;
    this.offRamp = { u0: cOff.u - 260, uTop: cOff.u - 230, uFoot: cOff.u - 70, u1: cOff.u - cOff.hw - 1, dir: 1, cross: cOff };
    this.onRamp = { u0: cOn.u + cOn.hw + 1, uFoot: cOn.u + 70, uTop: cOn.u + 230, u1: cOn.u + 260, dir: -1, cross: cOn };
    // aux lanes on the deck where the ramps join (u range, at deck height)
    this.aux = [[this.offRamp.u0 - 70, this.offRamp.uTop + 6], [this.onRamp.uTop - 6, this.onRamp.u1 + 70]];

    // ---------------------------------------------------------- viaduct
    // abutments where the deck is 3 m up (walled embankment below that),
    // piers every 30 m between them, clear of the cross streets
    this.abutments = [];
    for (let u = 0; u < 300; u += 0.5) if (deckAt(f, u) >= 3) { this.abutments.push(u, L - u); break; }
    this.piers = [];
    for (let u = this.abutments[0] + 16; u < this.abutments[1] - 10; u += 30) {
      if (this.cross.some((c) => Math.abs(u - c.u) < c.hw + 7)) continue;
      this.piers.push({ u });
    }

    // ---------------------------------------------------------- metro loop
    this.metro = { u0: 420 * (L / 2000), u1: 1580 * (L / 2000), v0: 95, v1: 210, r: 34, h: 7.2, hw: 5.2 };
    this.metroPts = roundRect(this.metro.u0, this.metro.u1, this.metro.v0, this.metro.v1, this.metro.r);
    this.metroCum = cumLen(this.metroPts);
    this.metroLen = this.metroCum[this.metroCum.length - 1];
    // stations: along the straight sides
    const st = (name, u, v) => {
      const n = nearestOn(this.metroPts, u, v);
      return { name, u: n.pu, v: n.pv, t: this.metroCum[n.k] + n.t * (this.metroCum[n.k + 1] - this.metroCum[n.k]) };
    };
    this.stations = [
      st('CIRCUIT', 640 * (L / 2000), 95),
      st('CROSSING', (this.scramble.u + 80), 210),
      st('SKY TOWER', 1380 * (L / 2000), 210),
      st('PARKSIDE', 1180 * (L / 2000), 95),
    ];
    // each station opens onto the nearest avenue: the station house sits beside
    // the track, a plaza runs from its door to the avenue pavement, and a tall
    // M sign stands at the pavement (so the entrances can be found)
    for (const s of this.stations) {
      let best = null;
      for (const a of this.avenues) {
        for (const side of [1, -1]) {
          const edge = a.v + side * (a.hw + this.PAVE);
          const dir = Math.sign(edge - s.v);
          if (dir !== -side) continue; // the pavement on the station's side of the avenue
          const dist = Math.abs(edge - s.v);
          if (!best || dist < best.dist) best = { dist, edge, dir };
        }
      }
      s.dir = best.dir;
      s.edgeV = best.edge;
      s.houseV = s.v + s.dir * (this.metro.hw + 7);
      s.entrance = { u: s.u, v: s.houseV + s.dir * 5.6 };
      s.plaza = { u0: s.u - 11, u1: s.u + 11, v0: Math.min(s.houseV + s.dir * 5, s.edgeV), v1: Math.max(s.houseV + s.dir * 5, s.edgeV) };
      s.sign = { u: s.u + 9, v: s.edgeV - s.dir * 1.4 };
    }

    // ---------------------------------------------------------- landmarks
    this.skytree = { u: 1380 * (L / 2000), v: 328, h: 230 };
    this.temple = { u0: 540 * (L / 2000), u1: 700 * (L / 2000), v0: -136, v1: -48 };
    this.park = { u0: 1095 * (L / 2000), u1: 1265 * (L / 2000), v0: -136, v1: -48 };

    // ---------------------------------------------------------- mountain
    // hairpin road: legs across the slope joined by hairpins, climbing at a
    // steady grade; the terrain is shaped from the road (see terrain())
    const K = L / 2000;
    const legs = [[560, 1300, 470], [1300, 700, 530], [700, 1250, 590], [1250, 750, 650], [750, 1200, 710], [1200, 820, 770], [820, 1150, 830], [1150, 1000, 890]]
      .map(([a, b, v]) => [a * K, b * K, v]);
    // up from Yamate Dori, a quarter turn into the first leg
    const u0 = legs[0][0];
    const pts = [[u0, 393], [u0, 445]];
    pts.push(...arcPts(u0 + 25, 445, 25, Math.PI, Math.PI / 2, 6).slice(1));
    for (let i = 0; i < legs.length; i++) {
      const [ua, ub, v] = legs[i];
      const dir = Math.sign(ub - ua);
      pts.push([ub, v]);
      if (i < legs.length - 1) {
        // hairpin: a semicircle beyond the end of the leg
        const r = (legs[i + 1][2] - v) / 2, cu = ub, cv = v + r, steps = 10;
        for (let k = 1; k < steps; k++) {
          const ang = -Math.PI / 2 + (Math.PI * k) / steps;
          pts.push([cu + dir * Math.cos(ang) * r, cv + Math.sin(ang) * r]);
        }
      }
    }
    const last = legs[legs.length - 1];
    this.summit = { u: last[1], v: last[2] };
    this.hill = pts;
    this.hillCum = cumLen(pts);
    this.hillLen = this.hillCum[this.hillCum.length - 1];
    this.HILL_TOP = 172;
    this.HILL_HW = 3.6;
    this.hillLegs = legs;

    // cable car: valley station by Yamate Dori, top station by the summit
    this.cable = { u: 935 * K, v0: 404, v1: 884, h0: 6, h1: 0 };
    this.cable.h1 = this.terrain(this.cable.u, this.cable.v1) + 9;
    this.cable.towers = [560, 700, 820].map((v) => ({ v, h: this.terrain(this.cable.u, v) + 34 }));
  }

  // ---------------------------------------------------------------- terrain
  // road height along the hill road (0 at the city, HILL_TOP at the summit)
  hillH(t) {
    const x = clamp(t / this.hillLen, 0, 1);
    return this.HILL_TOP * (x * 0.96 + 0.04 * x * x);
  }

  // ground height above the city base at (u, v): flat city, then the
  // mountain shaped around the hill road
  terrain(u, v) {
    if (v < 392) return 0;
    const L = this.L;
    // height of the slope from the legs: interpolate the road height of the
    // leg just below and just above at this u
    const legs = this.hillLegs;
    const legH = (i, uu) => {
      const [ua, ub, lv] = legs[i];
      const lo = Math.min(ua, ub), hi = Math.max(ua, ub);
      const uc = clamp(uu, lo, hi);
      const n = nearestOn(this.hill, uc, lv);
      const t = this.hillCum[n.k] + n.t * (this.hillCum[n.k + 1] - this.hillCum[n.k]);
      return this.hillH(t);
    };
    let h;
    if (v < legs[0][2]) {
      h = legH(0, u) * ss(392, legs[0][2], v);
    } else if (v >= legs[legs.length - 1][2]) {
      const top = legH(legs.length - 1, u);
      h = top + (this.HILL_TOP + 26 - top) * ss(legs[legs.length - 1][2], 1000, v);
    } else {
      let i = 0;
      while (i < legs.length - 2 && v > legs[i + 1][2]) i++;
      const t = (v - legs[i][2]) / (legs[i + 1][2] - legs[i][2]);
      h = legH(i, u) * (1 - t) + legH(i + 1, u) * t;
    }
    // the massif narrows toward the zone ends; a little roughness
    const env = ss(120, 520 * (L / 2000), u) * (1 - ss(L - 520 * (L / 2000), L - 120, u));
    h = h * (0.35 + 0.65 * env) + (vnoise(u / 60 + v / 90, 77) * 3 + vnoise(u / 23 - v / 31, 91) * 1.2) * ss(400, 470, v);
    // carve the road in: the ground near it sits at the road
    const n = nearestOn(this.hill, u, v);
    if (n.dist < 26) {
      const t = this.hillCum[n.k] + n.t * (this.hillCum[n.k + 1] - this.hillCum[n.k]);
      const rh = this.hillH(t);
      const w = 1 - ss(this.HILL_HW + 0.5, 26, n.dist);
      h = h + (rh - 0.08 - h) * w;
    }
    return h;
  }

  // ---------------------------------------------------------------- queries
  // is (u, v) on a street surface (avenue / cross street / hill road)?
  street(u, v) {
    for (const a of this.avenues) if (Math.abs(v - a.v) <= a.hw && u >= a.u0 - a.hw && u <= a.u1 + a.hw) return a;
    for (const c of this.cross) if (Math.abs(u - c.u) <= c.hw && v >= c.v0 - c.hw && v <= c.v1 + c.hw) return c;
    return null;
  }
  // within a street or its pavements (pad = extra margin)
  nearStreet(u, v, pad) {
    for (const a of this.avenues) if (Math.abs(v - a.v) <= a.hw + pad && u >= a.u0 - a.hw - pad && u <= a.u1 + a.hw + pad) return true;
    for (const c of this.cross) if (Math.abs(u - c.u) <= c.hw + pad && v >= c.v0 - c.hw - pad && v <= c.v1 + c.hw + pad) return true;
    return false;
  }
  onHill(u, v, pad = 0) {
    if (v < 380) return false;
    return nearestOn(this.hill, u, v).dist <= this.HILL_HW + pad;
  }
  // the corridor under / beside the viaduct (no buildings there)
  inDeckBand(u, v, pad = 0) {
    return v > DECK_V0 - 10 - pad && v < 31 + pad;
  }
  inMetro(u, v, pad = 0) {
    return nearestOn(this.metroPts, u, v).dist < this.metro.hw + pad;
  }
  // deck height (above the city ground) and whether (u, v) is under the
  // viaduct footprint
  underDeck(u, v) {
    return v > DECK_V0 && v < DECK_V1;
  }
}
