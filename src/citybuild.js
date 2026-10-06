// Geometry for the city zones: street surfaces, pavements and crossings,
// the expressway viaduct (drawn with the highway chunks), the elevated metro,
// terrain and the hill road, and the landmarks. Everything is written into
// GeoB buckets in the city's local frame (see CityNet.wp), so a whole tile of
// the city is a handful of draw calls.
import * as THREE from 'three';
import { hash, vnoise } from './path.js';
import { LANE, DECK_V0, DECK_V1, nearestOn, clamp } from './citylayout.js';
import { deckAt } from './planner.js';
import { font } from './font.js';

// ---------------------------------------------------------------- textures
function canvas(w, h) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return [c, c.getContext('2d')];
}
function tex(c, repeat = true) {
  const t = new THREE.CanvasTexture(c);
  if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.magFilter = THREE.NearestFilter;
  t.minFilter = THREE.NearestMipmapLinearFilter;
  t.anisotropy = 4;
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
let seq = 7;
const rnd = () => hash(seq++ * 0.613 + 0.17);

function asphalt(g, W, H) {
  g.fillStyle = '#44464c';
  g.fillRect(0, 0, W, H);
  for (let i = 0; i < W * H * 0.25; i++) {
    const v = rnd();
    g.fillStyle = v < 0.5 ? '#3e4046' : v < 0.85 ? '#4b4d53' : '#55575c';
    g.fillRect((rnd() * W) | 0, (rnd() * H) | 0, 1, 1);
  }
  for (let i = 0; i < W * H / 900; i++) {
    g.fillStyle = 'rgba(20,20,26,0.25)';
    g.fillRect(rnd() * W, rnd() * H, 3 + rnd() * 8, 3 + rnd() * 10);
  }
}
// a street of nl lanes each way: u across (0..1 = full width), v along (8 m)
// 6 px per metre across, 8 px per metre along
export function laneTexture(nl) {
  const wM = nl * 2 * LANE + 0.6;
  const W = Math.ceil(wM * 6), H = 64;
  const [c, g] = canvas(W, H);
  asphalt(g, W, H);
  const x = (m) => Math.round(m * 6);
  g.fillStyle = '#d8d4c8';
  g.fillRect(x(0.25), 0, 1, H);
  g.fillRect(W - 1 - x(0.25), 0, 1, H);
  // centre: double yellow (wide streets) or a single yellow dash
  g.fillStyle = '#d9b53f';
  const mid = W / 2;
  if (nl > 1) {
    g.fillRect(Math.round(mid - 2), 0, 1, H);
    g.fillRect(Math.round(mid + 1), 0, 1, H);
  } else {
    g.fillRect(Math.round(mid - 0.5), 0, 1, H * 0.55);
  }
  // white dashed lane lines
  g.fillStyle = '#d8d4c8';
  for (let k = 1; k < nl; k++) {
    for (const sgn of [-1, 1]) {
      const xx = Math.round(mid + sgn * (0.3 + k * LANE) * 6);
      g.fillRect(xx, 0, 1, H * 0.5);
    }
  }
  return tex(c);
}
export function plainAsphalt() {
  const [c, g] = canvas(64, 64);
  asphalt(g, 64, 64);
  return tex(c);
}
// train side: cream body, orange band, windows (lit at night via emissive)
function trainTextures() {
  const W = 128, H = 32;
  const [c, g] = canvas(W, H);
  const [ce, ge] = canvas(W, H);
  ge.fillStyle = '#000';
  ge.fillRect(0, 0, W, H);
  g.fillStyle = '#d9d6cc';
  g.fillRect(0, 0, W, H);
  g.fillStyle = '#e0701e';
  g.fillRect(0, 20, W, 4);
  g.fillStyle = '#5b5e66';
  g.fillRect(0, 29, W, 3);
  for (let i = 0; i < 6; i++) {
    const x = 6 + i * 20;
    g.fillStyle = '#1f2836';
    g.fillRect(x, 6, 14, 11);
    ge.fillStyle = '#ffe7b0';
    ge.fillRect(x, 6, 14, 11);
    ge.fillStyle = 'rgba(0,0,0,0.5)';
    ge.fillRect(x + 3 + ((i * 7) % 6), 11, 3, 6);
  }
  // doors
  for (const x of [2, 62, 122]) {
    g.fillStyle = '#9a9ca2';
    g.fillRect(x - 2, 4, 6, 24);
  }
  return { map: tex(c, false), emissive: tex(ce, false) };
}
// Skytree lattice: white diagonal lattice on a pale tube, LEDs at night
function latticeTextures() {
  const W = 32, H = 64;
  const [c, g] = canvas(W, H);
  const [ce, ge] = canvas(W, H);
  g.fillStyle = '#c9ccd2';
  g.fillRect(0, 0, W, H);
  ge.fillStyle = '#000';
  ge.fillRect(0, 0, W, H);
  g.fillStyle = '#f4f4f2';
  for (let y = 0; y < H; y++) {
    const x = (y * 0.5) % W;
    g.fillRect(x | 0, y, 2, 1);
    g.fillRect((W - x) | 0, y, 2, 1);
  }
  g.fillStyle = '#8a8e96';
  for (let y = 0; y < H; y += 16) g.fillRect(0, y, W, 2);
  ge.fillStyle = '#6a8cff';
  for (let y = 0; y < H; y++) {
    const x = (y * 0.5) % W;
    ge.fillRect(x | 0, y, 1, 1);
  }
  return { map: tex(c), emissive: tex(ce) };
}
// a big shop / arcade sign with latin text (pixel font), drawn into cell
// (ox, oy) of an atlas canvas
function bigSign(g, ox, oy, lines, bg, fg, w = 64, h = 32) {
  g.save();
  g.translate(ox, oy);
  g.fillStyle = bg;
  g.fillRect(0, 0, w, h);
  g.fillStyle = 'rgba(255,255,255,0.3)';
  g.fillRect(0, 0, w, 1);
  g.fillRect(0, h - 1, w, 1);
  lines.forEach((ln, i) => {
    const sc = i === 0 ? (font.measure(ln) * 3 <= w - 4 ? 3 : 2) : 1;
    const tw = font.measure(ln) * sc;
    const y = i === 0 ? 4 : 4 + 5 * 3 + 4 + (i - 1) * 7;
    font.draw(g, ln, ((w - tw) / 2) | 0, y, sc, i === 0 ? fg : '#f4f1e8');
  });
  g.restore();
}
// all big signs in one 128 x 160 atlas (2 columns x 5 rows of 64 x 32)
function signAtlas() {
  const [c, g] = canvas(128, 160);
  SIGNS.forEach(([lines, bg, fg], i) => bigSign(g, (i % 2) * 64, Math.floor(i / 2) * 32, lines, bg, fg));
  const t = tex(c, false);
  t.minFilter = THREE.NearestFilter;
  t.generateMipmaps = false;
  return t;
}
const SIGNS = [
  [['GAMEO', 'ARCADE  5F'], '#c8402a', '#ffe9a0'], [['BOOK', 'DOFF  USED'], '#f0c23a', '#2a3a8a'],
  [['8 BIT', 'ELECTRIC'], '#1f3c7a', '#ffcf4a'], [['RAMEN', 'OPEN 24H'], '#7a1d12', '#fff3d6'],
  [['KARAOKE', 'PIXEL BOX'], '#2a7a4a', '#f4f1e8'], [['DONKI', 'DISCOUNT'], '#f0d020', '#c8202a'],
  [['TAXI', 'STAND'], '#1a1a20', '#ffcf4a'], [['MANGA', 'CAFE  2F'], '#4a2a6a', '#ffd6f0'],
  [['SUSHI', 'KAITEN'], '#e8e4da', '#c8281e'], [['HOTEL', 'BLUE HOUR'], '#23163a', '#9fd0ff'],
];

// the giant crossing screens: a small canvas redrawn a few times a second
export class Screens {
  constructor() {
    [this.c, this.g] = canvas(64, 40);
    this.tex = tex(this.c, false);
    this.tex.minFilter = THREE.NearestFilter;
    this.tex.generateMipmaps = false;
    this.t = 0;
    this.k = 0;
    this.draw(0);
  }
  update(dt) {
    this.t += dt;
    if (this.t < 0.2) return;
    this.t = 0;
    this.k++;
    this.draw(this.k);
    this.tex.needsUpdate = true;
  }
  draw(k) {
    const g = this.g, W = 64, H = 40;
    const scene = Math.floor(k / 40) % 4;
    const p = k % 40;
    if (scene === 0) {
      // a pixel idol: sky gradient, sun, waving figure
      for (let y = 0; y < H; y++) {
        g.fillStyle = `hsl(${300 - y * 2}, 70%, ${40 + y}%)`;
        g.fillRect(0, y, W, 1);
      }
      g.fillStyle = '#ffe070';
      g.fillRect(44, 6, 10, 10);
      g.fillStyle = '#2a1d3a';
      g.fillRect(18, 18, 8, 16);
      g.fillRect(19, 12, 6, 6);
      g.fillRect(p % 8 < 4 ? 26 : 14, p % 8 < 4 ? 14 : 16, 4, 2);
      font.draw(g, 'PIXEL POP', 8, 2, 1, '#ffffff');
    } else if (scene === 1) {
      // scrolling headline
      g.fillStyle = '#0b1230';
      g.fillRect(0, 0, W, H);
      g.fillStyle = '#e0701e';
      g.fillRect(0, 28, W, 12);
      font.draw(g, 'NEWS', 2, 2, 2, '#ffffff');
      const msg = 'SNOW TONIGHT IN NEO TOKYO   TRAINS ON TIME   ';
      font.draw(g, msg + msg, 2 - (p * 2) % (font.measure(msg)), 31, 1, '#0b1230');
    } else if (scene === 2) {
      // a soda can that spins
      g.fillStyle = '#c8202a';
      g.fillRect(0, 0, W, H);
      const w = 8 + Math.abs(Math.sin(p / 6)) * 10;
      g.fillStyle = '#f4f1e8';
      g.fillRect(32 - w / 2, 8, w, 26);
      g.fillStyle = '#c8202a';
      g.fillRect(32 - w / 2, 18, w, 4);
      font.draw(g, 'COLA', 4, 2, 1, '#ffffff');
      font.draw(g, 'ICE COLD', 2, 34, 1, '#ffe070');
    } else {
      // racing game ad
      g.fillStyle = '#1d2c55';
      g.fillRect(0, 0, W, H);
      g.fillStyle = '#4a4c52';
      g.fillRect(0, 24, W, 16);
      g.fillStyle = '#f4f1e8';
      for (let x = -((p * 3) % 12); x < W; x += 12) g.fillRect(x, 31, 6, 1);
      g.fillStyle = '#e0701e';
      g.fillRect(20, 24, 16, 5);
      g.fillRect(24, 20, 8, 4);
      font.draw(g, 'COMMUTE', 6, 4, 1, '#ffcd6e');
      font.draw(g, 'OUT NOW', 10, 12, 1, '#ffffff');
    }
  }
}

// ---------------------------------------------------------------- materials
export function cityMaterials(W) {
  if (W._cityMats) return W._cityMats;
  const puddles = W.mRoad.roughnessMap;
  const road = (map) => new THREE.MeshStandardMaterial({ map, roughness: 0.6, roughnessMap: puddles, envMapIntensity: 0.35 });
  const train = trainTextures();
  const lat = latticeTextures();
  const screens = new Screens();
  const m = {
    ave: { 1: road(laneTexture(1)), 2: road(laneTexture(2)), 3: road(laneTexture(3)) },
    asphalt: road(plainAsphalt()),
    terrain: new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true }),
    train: new THREE.MeshLambertMaterial({ map: train.map, emissiveMap: train.emissive, emissive: new THREE.Color(1, 1, 1), emissiveIntensity: 0.3 }),
    trainIn: null,
    lattice: new THREE.MeshLambertMaterial({ map: lat.map, emissiveMap: lat.emissive, emissive: new THREE.Color(1, 1, 1), emissiveIntensity: 0.1 }),
    screen: new THREE.MeshBasicMaterial({ map: screens.tex, color: new THREE.Color(1.5, 1.5, 1.5) }),
    bigSign: new THREE.MeshBasicMaterial({ map: signAtlas(), color: new THREE.Color(1.3, 1.3, 1.3) }),
    screens,
  };
  // trains are seen from inside too (riding the metro)
  m.trainIn = m.train.clone();
  m.trainIn.side = THREE.DoubleSide;
  W._cityMats = m;
  return m;
}
export function cityNight(m, k, snow) {
  m.train.emissiveIntensity = 0.25 + 1.4 * k;
  m.trainIn.emissiveIntensity = m.train.emissiveIntensity;
  m.lattice.emissiveIntensity = 0.05 + 2.2 * k;
  m.bigSign.color.setScalar(0.9 + 0.7 * k);
  m.screen.color.setScalar(1.1 + 0.8 * k);
  m.terrain.color.setRGB(1 + snow * 1.6, 1 + snow * 1.5, 1 + snow * 1.8);
}

// ---------------------------------------------------------------- viaduct
// Expressway deck through a city zone, drawn with each highway chunk:
// curbs + parapets, fascia and underside, piers (or a walled embankment where
// the deck is low), and the deck widening at the ramps.
export function buildViaduct(W, f, c, lay) {
  const { geo, a } = c;
  const x0 = Math.max(c.s0, f.s0), x1 = Math.min(c.s1, f.s1);
  if (x1 - x0 < 0.5) return;
  const S = f.s0;
  const dk = (s) => deckAt(f, s - S);
  const auxAt = (s) => lay.aux.some(([u0, u1]) => s - S > u0 && s - S < u1);
  const EMB = 3; // below this the deck sits on a walled embankment
  // split the chunk where the aux-lane ranges start / stop
  const cuts = [x0, x1];
  for (const [u0, u1] of lay.aux) for (const u of [u0, u1]) if (S + u > x0 && S + u < x1) cuts.push(S + u);
  cuts.sort((p, q) => p - q);
  for (let i = 0; i < cuts.length - 1; i++) {
    const p0 = cuts[i], p1 = cuts[i + 1];
    const aux = auxAt((p0 + p1) / 2);
    const bottom = (s) => (dk(s) <= EMB ? -dk(s) : -1.25);
    W.strip(geo.bridge, (s) => {
      const b = bottom(s);
      const right = aux
        ? [[19.9, -0.06], [19.9, b]]
        : [[16.9, 0], [16.9, 0.16], [17.55, 0.16], [17.55, 1.05], [18.0, 1.05], [18.0, b]];
      return [...right, [DECK_V0, b], [DECK_V0, 1.05], [-14.95, 1.05], [-14.95, 0.16], [-14.2, 0.16], [-14.2, 0]];
    }, p0, p1, a, { mode: 'world', tile: 6 });
    if (!aux) {
      // a steel rail on top of the right parapet
      W.strip(geo.metal, [[17.6, 1.25], [17.95, 1.25]], p0, p1, a);
    }
  }
  W.strip(geo.metal, [[-15.35, 1.25], [-15.0, 1.25]], x0, x1, a);
  // piers: two columns and a cap under the deck
  for (const p of lay.piers) {
    const s = S + p.u;
    if (s < x0 || s >= x1) continue;
    const h = dk(s);
    W.obox(geo.bridge, s, -8, -h, 1.7, 1.7, h - 1.2, a, 0, 0.25);
    W.obox(geo.bridge, s, 10.5, -h, 1.7, 1.7, h - 1.2, a, 0, 0.25);
    W.obox(geo.bridge, s, 1.3, -2.4, 2.2, DECK_V1 - DECK_V0 - 1, 1.2, a, 0, 0.25);
  }
  // the abutments where the embankment ends and the open span begins
  for (const u of lay.abutments) {
    const s = S + u;
    if (s < x0 || s >= x1) continue;
    W.obox(geo.bridge, s, (DECK_V0 + DECK_V1) / 2, -EMB - 0.2, 1.2, DECK_V1 - DECK_V0, EMB - 1.0, a, 0, 0.25);
  }
}

// ---------------------------------------------------------------- helpers
// All of these draw in the city's local frame: net.wp(u, v, h) -> [x, y, z].
export function upQuad(g, net, u0, u1, v0, v1, h, uvf) {
  const P = [net.wp(u0, v0, h), net.wp(u1, v0, h), net.wp(u1, v1, h), net.wp(u0, v1, h)];
  const uv = uvf ? [uvf(u0, v0), uvf(u1, v0), uvf(u1, v1), uvf(u0, v1)] : null;
  g.quadOut(P, uv, net.wp((u0 + u1) / 2, (v0 + v1) / 2, h - 1));
}
// vertical face from (ua, va) to (ub, vb), h0..h1, facing away from (ui, vi)
export function wallQuad(g, net, ua, va, ub, vb, h0, h1, ui, vi, uvScale = 0) {
  const P = [net.wp(ua, va, h0), net.wp(ub, vb, h0), net.wp(ub, vb, h1), net.wp(ua, va, h1)];
  const L = Math.hypot(ub - ua, vb - va);
  const uv = uvScale ? [[0, h0 * uvScale], [L * uvScale, h0 * uvScale], [L * uvScale, h1 * uvScale], [0, h1 * uvScale]] : null;
  g.quadOut(P, uv, net.wp(ui, vi, (h0 + h1) / 2));
}
// box centred at (u, v), du along u, dv along v (turned by yaw in the u-v plane)
export function lbox(g, net, u, v, h0, du, dv, dh, yaw = 0) {
  const c = Math.cos(yaw), s = Math.sin(yaw);
  const P = (i, j, k) => {
    const a = (du / 2) * i, b = (dv / 2) * j;
    return net.wp(u + a * c - b * s, v + a * s + b * c, h0 + dh * k);
  };
  const inside = net.wp(u, v, h0 + dh / 2);
  const faces = [
    [P(-1, -1, 0), P(1, -1, 0), P(1, -1, 1), P(-1, -1, 1)],
    [P(-1, 1, 0), P(1, 1, 0), P(1, 1, 1), P(-1, 1, 1)],
    [P(-1, -1, 0), P(-1, 1, 0), P(-1, 1, 1), P(-1, -1, 1)],
    [P(1, -1, 0), P(1, 1, 0), P(1, 1, 1), P(1, -1, 1)],
    [P(-1, -1, 1), P(1, -1, 1), P(1, 1, 1), P(-1, 1, 1)],
  ];
  for (const f of faces) g.quadOut(f, null, inside);
}
// a ribbon along a polyline at heights hf(i) (width w), upward faces, lane UVs
export function ribbon(g, net, pts, w, hf, vTile = 8) {
  let len = 0;
  const rows = [];
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i];
    const q0 = pts[Math.max(0, i - 1)], q1 = pts[Math.min(pts.length - 1, i + 1)];
    let tu = q1[0] - q0[0], tv = q1[1] - q0[1];
    const l = Math.hypot(tu, tv) || 1;
    tu /= l; tv /= l;
    if (i > 0) len += Math.hypot(p[0] - pts[i - 1][0], p[1] - pts[i - 1][1]);
    const h = hf(i, p);
    // right of travel (+v is right of +u): (-tv, tu)
    const Lp = net.wp(p[0] + tv * w / 2, p[1] - tu * w / 2, h);
    const Rp = net.wp(p[0] - tv * w / 2, p[1] + tu * w / 2, h);
    rows.push([g.v(...Lp, 0, len / vTile), g.v(...Rp, 1, len / vTile), Lp, Rp]);
  }
  for (let i = 0; i < rows.length - 1; i++) {
    const [a0, b0, La, Ra] = rows[i], [a1, b1, L1] = rows[i + 1];
    const ux = Ra[0] - La[0], uz = Ra[2] - La[2];
    const nx = L1[0] - La[0], nz = L1[2] - La[2];
    if (ux * nz - uz * nx < 0) { g.tri(a0, b0, a1); g.tri(b0, b1, a1); } else { g.tri(a0, a1, b0); g.tri(b0, a1, b1); }
  }
}

// ---------------------------------------------------------------- streets
// zebra crossing across a street arm: stripes run along the traffic
// direction (ax = 'u' or 'v'), spread across the street's width
export function zebra(g, net, ax, c0, c1, w0, w1, h = 0.035) {
  // c0..c1: extent along the traffic axis; w0..w1: across (the walking line)
  for (let w = w0 + 0.3; w < w1 - 0.3; w += 1.0) {
    if (ax === 'u') upQuad(g, net, c0, c1, w, w + 0.5, h);
    else upQuad(g, net, w, w + 0.5, c0, c1, h);
  }
}

// street surfaces, pavements, crossings, signals and lamps of one tile
export function buildStreets(net, G, tile, glows, lights) {
  const lay = net.lay, PAVE = lay.PAVE;
  const white = G.col('#e8e4da');
  for (const p of tile.pieces) {
    if (p.kind === 'ave' || p.kind === 'cross') {
      const g = G.ave(p.nl);
      const across = p.kind === 'ave' ? (u, v) => [(v - p.v0) / (p.v1 - p.v0), u / 8] : (u, v) => [(u - p.u0) / (p.u1 - p.u0), v / 8];
      upQuad(g, net, p.u0, p.u1, p.v0, p.v1, 0.02, across);
    } else if (p.kind === 'box') {
      upQuad(G.asphalt, net, p.u0, p.u1, p.v0, p.v1, 0.02, (u, v) => [u / 8, v / 8]);
    } else if (p.kind === 'pave') {
      upQuad(G.pave, net, p.u0, p.u1, p.v0, p.v1, 0.15, (u, v) => [u / 4, v / 4]);
      // kerb faces toward the street side(s)
      for (const [ua, va, ub, vb, ui, vi] of p.kerbs) wallQuad(G.kerb, net, ua, va, ub, vb, 0, 0.15, ui, vi);
    } else if (p.kind === 'zebra') {
      zebra(white, net, p.ax, p.c0, p.c1, p.w0, p.w1);
    } else if (p.kind === 'stop') {
      upQuad(white, net, p.u0, p.u1, p.v0, p.v1, 0.036);
    } else if (p.kind === 'diag') {
      // scramble diagonals: stripes along a diagonal band
      const { u0, v0, u1, v1 } = p;
      const L = Math.hypot(u1 - u0, v1 - v0), tu = (u1 - u0) / L, tv = (v1 - v0) / L;
      for (let t = 2; t < L - 2; t += 1.1) {
        const cu = u0 + tu * t, cv = v0 + tv * t;
        lbox(white, net, cu, cv, 0.03, 0.5, 4.2, 0.012, Math.atan2(tv, tu));
      }
    } else if (p.kind === 'ground') {
      upQuad(p.grass ? G.grass : G.ground, net, p.u0, p.u1, p.v0, p.v1, -0.02, (u, v) => [u / 6, v / 6]);
    }
  }
  // street lamps (avenue pavements, kerb side) and traffic signals
  for (const l of tile.lamps) {
    const yRel = -net.deck(l.u);
    net.W.cityLamp(G.raw, net.S + l.u, l.v, l.toward, yRel + 0.15, net.Aw, glows, lights);
  }
  for (const sg of tile.signals) {
    const { u, v, ax, dir } = sg;
    // pole on the corner, arm reaching over the approach lanes
    lbox(G.metal, net, u, v, 0.15, 0.22, 0.22, 5.6);
    const reach = sg.reach;
    if (ax === 'u') lbox(G.metal, net, u, v + dir * reach / 2, 5.4, 0.14, reach, 0.14);
    else lbox(G.metal, net, u + dir * reach / 2, v, 5.4, reach, 0.14, 0.14);
    const hu = ax === 'u' ? u : u + dir * (reach - 0.6), hv = ax === 'u' ? v + dir * (reach - 0.6) : v;
    lbox(G.dark, net, hu, hv, 4.6, ax === 'u' ? 0.4 : 1.4, ax === 'u' ? 1.4 : 0.4, 0.5);
    sg.head = { u: hu, v: hv, h: 4.85 };
  }
}
