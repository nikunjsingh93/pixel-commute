// Decides what the highway looks like along its length:
//  - districts (downtown / suburbs / countryside) as smooth weights
//  - features placed one after another: exits to a city loop, roadworks,
//    tunnels, toll plazas and the harbour bridge
// Everything is deterministic from the seed, so a road always looks the same.
import { hash, vnoise } from './path.js';

export const EXIT_NAMES = [
  'HARBOR', 'MIDTOWN', 'OLD TOWN', '5TH AVE', 'MARKET ST', 'UNION SQ', 'AIRPORT', 'RIVERSIDE',
  'CHINATOWN', 'UPTOWN', 'DOCKS', 'PARK HILL', 'STATION', 'BAYVIEW', 'ARTS DIST', 'NORTHGATE',
];

// feature lengths along s (metres)
const LEN = { exit: 560, works: 300, tunnel: 520, toll: 120, harbor: 820, city: 2000 };
// a city zone: the road is straightened and levelled CITY_PAD metres either
// side, and inside it rises onto a viaduct DECK_H above the city streets
export const CITY_PAD = 300;
export const CITY_RAMP = 300;
export const DECK_H = 9;
const ss = (a, b, x) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};
// viaduct height above the city ground at u metres into the zone
export function deckAt(f, u) {
  return DECK_H * ss(0, CITY_RAMP, u) * (1 - ss(f.s1 - f.s0 - CITY_RAMP, f.s1 - f.s0, u));
}

export class Planner {
  constructor(seed) {
    this.seed = seed;
    this.features = [];
    this.end = 900; // keep the start of the drive plain (title screen backdrop)
    this.n = 0;
    this.exitNo = 9;
  }

  // ---------------------------------------------------------------- districts
  // town: 1 = city/suburbs, 0 = countryside. downtown: 1 = towers + shops
  district(s, out = {}) {
    let n = vnoise(s / 2900, this.seed + 31) * 0.8 + vnoise(s / 900, this.seed + 37) * 0.2;
    if (s < 2200) n = Math.max(n, 0.6 - Math.max(0, s - 1600) / 600); // start downtown
    const ss = (a, b, x) => {
      const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
      return t * t * (3 - 2 * t);
    };
    out.town = ss(-0.38, -0.12, n);
    out.downtown = ss(0.05, 0.3, n);
    out.name = out.town < 0.5 ? 'COUNTRYSIDE' : out.downtown > 0.5 ? 'DOWNTOWN' : 'SUBURBS';
    return out;
  }

  // ---------------------------------------------------------------- features
  ensure(s) {
    while (this.end < s + 1500) this.next();
  }

  next() {
    const i = this.n++;
    const R = (k) => hash(this.seed * 7.13 + i * 17.3 + k * 3.7);
    // the first few showcase every feature, then it is random by district
    const intro = ['city', 'exit', 'works', 'tunnel', 'exit', 'toll', 'harbor'];
    const s0 = this.end + 420 + R(1) * 700;
    let type = intro[i];
    if (!type) {
      const d = this.district(s0);
      const lastCity = [...this.features].reverse().find((x) => x.type === 'city');
      const w = {
        city: lastCity && s0 - lastCity.s1 > 9000 ? 0.12 * d.town : 0,
        exit: 0.34 * (0.3 + d.town),
        works: 0.18,
        tunnel: 0.16 * (1.4 - d.downtown),
        toll: 0.1 * (1.3 - d.downtown),
        harbor: 0.1 * (0.4 + d.town),
      };
      // no two of the same in a row (except exits)
      const prev = this.features[this.features.length - 1];
      if (prev && prev.type !== 'exit') w[prev.type] = 0;
      const total = Object.values(w).reduce((a, b) => a + b, 0);
      let r = R(2) * total;
      for (const [k, v] of Object.entries(w)) {
        r -= v;
        if (r <= 0) {
          type = k;
          break;
        }
      }
      type = type || 'works';
    }
    const len = LEN[type] * (type === 'tunnel' || type === 'harbor' ? 0.8 + R(3) * 0.5 : 1);
    const f = { type, s0, s1: s0 + len, id: i };
    if (type === 'exit') {
      f.no = this.exitNo;
      f.name = EXIT_NAMES[this.exitNo % EXIT_NAMES.length];
      this.exitNo += 2 + Math.floor(R(4) * 3);
      f.fuel = i === 0 || R(5) < 0.7; // most exits have a petrol station
    }
    if (type === 'works') f.lane = 3; // the right-hand lane is closed
    if (type === 'city') {
      f.name = ['NEO TOKYO', 'PIXEL CITY', 'MINATO', 'SHINJUKU'][this.nCity = (this.nCity || 0) + 1, (this.nCity - 1) % 4];
      this.end = f.s1 + CITY_PAD; // keep the levelled approach clear of other features
      this.features.push(f);
      return;
    }
    this.features.push(f);
    this.end = f.s1;
  }

  // features overlapping [a, b] (optionally of one type)
  range(a, b, type) {
    this.ensure(b);
    const out = [];
    for (const f of this.features) {
      if (f.s1 < a || f.s0 > b) continue;
      if (!type || f.type === type) out.push(f);
    }
    return out;
  }

  at(s, type, pad = 0) {
    this.ensure(s);
    for (const f of this.features) {
      if (s >= f.s0 - pad && s <= f.s1 + pad && (!type || f.type === type)) return f;
    }
    return null;
  }

  // next feature of a type ahead of s (for signs / the HUD)
  ahead(s, type) {
    this.ensure(s + 4000);
    for (const f of this.features) if (f.s0 > s && (!type || f.type === type)) return f;
    return null;
  }

  // 0..1: how strongly the plain roadside (walls, city frontage, overpasses)
  // is replaced by a feature around s
  mask(s, pad = 60) {
    const f = this.at(s, null, pad);
    if (!f || f.type === 'works') return 0;
    const inside = Math.min(s - (f.s0 - pad), f.s1 + pad - s);
    return Math.min(1, inside / pad);
  }

  // is lane `lane` closed at s (roadworks), incl. the merge taper ahead
  laneClosed(s, lane) {
    const f = this.at(s, 'works', 0);
    if (f && lane === f.lane) return true;
    const g = this.at(s + 140, 'works', 0);
    return !!(g && lane === g.lane && s > g.s0 - 140);
  }

  // road shaping for the Path: straight + level around city zones
  // returns null or { k: 0..1 blend, y: target height }
  shape(s, path) {
    this.ensure(s + CITY_PAD + 50);
    for (const f of this.features) {
      if (f.type !== 'city' || s < f.s0 - CITY_PAD || s > f.s1 + CITY_PAD) continue;
      if (f.base === undefined) f.base = path.naturalHeight(f.s0);
      const k = ss(f.s0 - CITY_PAD, f.s0, s) * (1 - ss(f.s1, f.s1 + CITY_PAD, s));
      // outside the zone: blend toward the zone's base height
      const y = s < f.s0 || s > f.s1 ? f.base : f.base + deckAt(f, s - f.s0);
      return { k, y };
    }
    return null;
  }

  // traffic keeps its lane through toll plazas
  noLaneChange(s) {
    return !!this.at(s, 'toll', 90);
  }
}
