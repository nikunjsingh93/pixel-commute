// Tokyo-style street detail, after pixel-art city scenes: narrow mixed-use
// shop-houses packed side by side, vertical kanji-style signs, awnings, red
// lanterns, vending machines, AC units, balconies, rooftop water tanks and
// frames, concrete utility poles with sagging wires, low tiled-roof houses
// behind block walls, and rows of apartments filling the land behind.
//
// Everything is placed in road space (s along, d across) like world.js, and
// written into the chunk's merged geometry buckets, so it costs a handful of
// draw calls per chunk.
import * as THREE from 'three';
import { hash } from './path.js';

// ---------------------------------------------------------------- foliage
// A lumpy leaf ball: an icosphere whose vertices are pushed in and out by a
// hash of their direction (shared vertices move together, so no cracks).
const ICO = new THREE.IcosahedronGeometry(1, 1).attributes.position.array;
const LEAF_GREENS = ['#3d6e34', '#4a7d38', '#355f33', '#56883c', '#44733f'].map((c) => new THREE.Color(c));
const _lc = new THREE.Color();
export function leafBall(geo, cx, cy, cz, rx, ry, seed, tint = 0) {
  const base = LEAF_GREENS[Math.floor(hash(seed * 3.1) * LEAF_GREENS.length)];
  const P = [];
  for (let i = 0; i < ICO.length; i += 3) {
    const x = ICO[i], y = ICO[i + 1], z = ICO[i + 2];
    const j = 0.8 + 0.4 * hash(Math.round(x * 97) * 0.131 + Math.round(y * 89) * 0.173 + Math.round(z * 83) * 0.191 + seed);
    P.push([cx + x * rx * j, cy + y * ry * j, cz + z * rx * j]);
  }
  for (let i = 0; i < P.length; i += 3) {
    const [A, B, C] = [P[i], P[i + 1], P[i + 2]];
    // face height in the ball: darker underneath, lighter on top
    const ny = ((A[1] + B[1] + C[1]) / 3 - cy) / ry;
    const k = (0.55 + 0.55 * (ny * 0.5 + 0.5)) * (0.88 + 0.24 * hash(seed + i * 0.37)) * (1 + tint);
    _lc.copy(base).multiplyScalar(k);
    geo._col = _lc.clone();
    const ia = geo.v(...A), ib = geo.v(...B), ic = geo.v(...C);
    geo.tri(ia, ib, ic);
  }
}

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
let seq = 1;
const rnd = () => hash(seq++ * 0.917 + 0.31);

// a made-up kanji-like glyph on an 8x8 grid: a few strokes and boxes
function glyph(g, x, y, size, col) {
  const u = size / 8;
  g.fillStyle = col;
  const H = (r, c0, c1) => g.fillRect(x + c0 * u, y + r * u, (c1 - c0 + 1) * u, u);
  const V = (c, r0, r1) => g.fillRect(x + c * u, y + r0 * u, u, (r1 - r0 + 1) * u);
  const kind = Math.floor(rnd() * 4);
  if (kind === 0) {
    // left radical + right part
    V(1, 1, 7);
    H(2, 0, 2);
    if (rnd() < 0.5) H(5, 0, 2);
    H(1, 4, 7);
    V(5 + Math.floor(rnd() * 2), 1, 7);
    H(4, 4, 7);
    if (rnd() < 0.6) H(7, 4, 7);
  } else if (kind === 1) {
    // top + box below
    H(0, 1, 6);
    V(3 + Math.floor(rnd() * 2), 0, 3);
    H(3, 0, 7);
    H(5, 2, 5);
    V(2, 5, 7);
    V(5, 5, 7);
    H(7, 2, 5);
  } else if (kind === 2) {
    // stacked horizontals with a spine
    H(1, 1, 6);
    H(3, 2, 5);
    H(5, 0, 7);
    V(3 + Math.floor(rnd() * 2), 0, 7);
    if (rnd() < 0.5) { V(1, 5, 7); V(6, 5, 7); }
  } else {
    // enclosure
    V(0, 1, 7);
    V(7, 1, 7);
    H(1, 0, 7);
    H(7, 0, 7);
    H(4, 2, 5);
    V(3 + Math.floor(rnd() * 2), 2, 6);
  }
}

const SIGN_STYLES = [
  ['#c8402a', '#fff3d6', '#7a1d12'], ['#e07a2e', '#fff8ec', '#8a3a10'], ['#f2ead8', '#b8281e', '#8a7a60'],
  ['#1f3c7a', '#f2ead8', '#0f1e40'], ['#1d6b45', '#f2ead8', '#0d3a24'], ['#f0c23a', '#2a1d10', '#8a6a10'],
  ['#1a1a20', '#ffcf4a', '#4a4a50'], ['#7a1d3a', '#ffd6e0', '#3a0d1a'],
];

// Atlas (512 x 512): vertical signs (32 x 128, 2 rows of 16), horizontal
// signs (128 x 32, 4 x 4), vending machine fronts (32 x 64, 16).
export const ATLAS = {
  vsign: (i) => rect((i % 16) * 32, Math.floor(i / 16) % 2 * 128, 32, 128),
  hsign: (i) => rect((i % 4) * 128, 256 + Math.floor(i / 4) % 4 * 32, 128, 32),
  vend: (i) => rect((i % 16) * 32, 384, 32, 64),
  styleOfV: (i) => SIGN_STYLES[(i * 5) % SIGN_STYLES.length],
};
function rect(x, y, w, h) {
  return [x / 512, 1 - (y + h) / 512, (x + w) / 512, 1 - y / 512];
}

function atlasTexture() {
  const [c, g] = canvas(512, 512);
  g.fillStyle = '#202228';
  g.fillRect(0, 0, 512, 512);
  // vertical signs
  for (let i = 0; i < 32; i++) {
    const x = (i % 16) * 32, y = Math.floor(i / 16) * 128;
    const [bg, fg, edge] = SIGN_STYLES[(i * 5) % SIGN_STYLES.length];
    g.fillStyle = edge;
    g.fillRect(x, y, 32, 128);
    g.fillStyle = bg;
    g.fillRect(x + 2, y + 2, 28, 124);
    for (let k = 0; k < 4; k++) glyph(g, x + 4, y + 6 + k * 30, 24, fg);
  }
  // horizontal signs
  for (let i = 0; i < 16; i++) {
    const x = (i % 4) * 128, y = 256 + Math.floor(i / 4) * 32;
    const [bg, fg, edge] = SIGN_STYLES[(i * 3 + 1) % SIGN_STYLES.length];
    g.fillStyle = edge;
    g.fillRect(x, y, 128, 32);
    g.fillStyle = bg;
    g.fillRect(x + 2, y + 2, 124, 28);
    const n = 3 + (i % 3);
    const w = Math.floor(116 / n);
    for (let k = 0; k < n; k++) glyph(g, x + 6 + k * w + Math.floor((w - 22) / 2), y + 5, 22, fg);
  }
  // vending machines: body colour, lit panel of drinks, buttons, dark slot
  const bodies = ['#c8202a', '#f0f0ea', '#2a5ab0', '#e8e8e0', '#1e7a4a', '#d8d2c0'];
  for (let i = 0; i < 16; i++) {
    const x = i * 32, y = 384;
    g.fillStyle = bodies[i % bodies.length];
    g.fillRect(x, y, 32, 64);
    g.fillStyle = '#e9f2ff';
    g.fillRect(x + 3, y + 4, 26, 30);
    for (let r = 0; r < 3; r++) {
      for (let k = 0; k < 5; k++) {
        g.fillStyle = ['#d83a2a', '#f0c040', '#3a8ad8', '#4ab06a', '#e8e8e8', '#8a4a2a'][Math.floor(rnd() * 6)];
        g.fillRect(x + 5 + k * 5, y + 7 + r * 10, 3, 6);
      }
    }
    g.fillStyle = '#20232a';
    g.fillRect(x + 4, y + 37, 24, 3);
    g.fillStyle = '#ffe070';
    for (let k = 0; k < 5; k++) g.fillRect(x + 5 + k * 5, y + 38, 2, 1);
    g.fillStyle = '#15171c';
    g.fillRect(x + 6, y + 50, 20, 8);
  }
  return tex(c, false);
}

// Facades: 8 styles stacked vertically, 4 floors each (64 px = 3.2 m per
// floor and per window bay); u repeats along the wall.
export const FAC_STYLES = 8;
function facadeTextures() {
  const W = 64, H = FAC_STYLES * 256;
  const [c, g] = canvas(W, H);
  const [ce, ge] = canvas(W, H);
  ge.fillStyle = '#000';
  ge.fillRect(0, 0, W, H);
  const walls = ['#cdbfa3', '#9a4b3a', '#8f939a', '#4a382c', '#e4e2dc', '#9fb7c4', '#d8cba8', '#55585f'];
  for (let s = 0; s < FAC_STYLES; s++) {
    const y0 = s * 256;
    g.fillStyle = walls[s];
    g.fillRect(0, y0, W, 256);
    // texture speckle
    for (let i = 0; i < 300; i++) {
      g.fillStyle = rnd() < 0.5 ? 'rgba(0,0,0,0.06)' : 'rgba(255,255,255,0.05)';
      g.fillRect(Math.floor(rnd() * W), y0 + Math.floor(rnd() * 256), 2, 1);
    }
    if (s === 1) {
      // brick courses
      g.fillStyle = 'rgba(0,0,0,0.16)';
      for (let y = y0; y < y0 + 256; y += 4) {
        g.fillRect(0, y, W, 1);
        for (let x = (y / 4) % 2 ? 0 : 4; x < W; x += 8) g.fillRect(x, y, 1, 4);
      }
    } else if (s === 5) {
      g.fillStyle = 'rgba(0,0,0,0.1)';
      for (let y = y0; y < y0 + 256; y += 6) g.fillRect(0, y, W, 1);
      for (let x = 0; x < W; x += 6) g.fillRect(x, y0, 1, 256);
    } else if (s === 3) {
      g.fillStyle = 'rgba(0,0,0,0.25)';
      for (let x = 1; x < W; x += 4) g.fillRect(x, y0, 1, 256); // wooden slats
    }
    for (let f = 0; f < 4; f++) {
      const fy = y0 + 256 - (f + 1) * 64; // floor f from the bottom
      // floor line
      g.fillStyle = 'rgba(0,0,0,0.18)';
      g.fillRect(0, fy + 62, W, 2);
      if (f === 0) {
        // ground floor: a door and a small window
        g.fillStyle = '#3a2a22';
        g.fillRect(8, fy + 26, 14, 36);
        g.fillStyle = '#c9c3b5';
        g.fillRect(8, fy + 24, 14, 2);
        g.fillStyle = '#26303f';
        g.fillRect(34, fy + 22, 20, 16);
        g.fillStyle = '#d8d4c8';
        g.fillRect(34, fy + 29, 20, 1);
        if (rnd() < 0.5) {
          ge.fillStyle = '#ffcf80';
          ge.fillRect(34, fy + 22, 20, 16);
        }
        continue;
      }
      const lit = rnd() < 0.5;
      const warm = rnd() < 0.75 ? '#ffd08a' : '#cfe6ff';
      const win = (x, y, w, h) => {
        g.fillStyle = '#e2ded2';
        g.fillRect(x - 1, y - 1, w + 2, h + 2);
        g.fillStyle = '#2a3446';
        g.fillRect(x, y, w, h);
        g.fillStyle = 'rgba(255,255,255,0.12)';
        g.fillRect(x, y, w, 2);
        if (lit) {
          ge.fillStyle = warm;
          ge.fillRect(x, y, w, h);
          // curtain / blinds
          ge.fillStyle = 'rgba(0,0,0,0.45)';
          if (s === 6) for (let k = y + 2; k < y + h; k += 3) ge.fillRect(x, k, w, 1);
          else ge.fillRect(x + Math.floor(w * 0.6), y, Math.ceil(w * 0.4), h);
        }
      };
      if (s === 2 || s === 4) {
        // apartment: balcony door + window, balcony railing drawn as a band
        win(6, fy + 12, 24, 40);
        win(38, fy + 18, 20, 20);
        g.fillStyle = s === 4 ? '#c9ccd2' : '#6d7178';
        g.fillRect(0, fy + 40, W, 14);
        g.fillStyle = 'rgba(0,0,0,0.25)';
        for (let x = 2; x < W; x += 4) g.fillRect(x, fy + 40, 1, 14);
        if (rnd() < 0.4) {
          // laundry
          const cols = ['#e8e0d0', '#7aa0d8', '#d87a7a', '#f0d070'];
          for (let k = 0; k < 4; k++) {
            g.fillStyle = cols[Math.floor(rnd() * cols.length)];
            g.fillRect(8 + k * 6, fy + 30, 4, 10);
          }
        }
      } else if (s === 7) {
        win(2, fy + 18, 60, 20); // ribbon window
      } else if (s === 3) {
        // old wooden house: shoji window with a lattice
        win(16, fy + 16, 32, 26);
        g.fillStyle = '#3a2a1e';
        for (let x = 16; x < 48; x += 6) g.fillRect(x, fy + 16, 1, 26);
        g.fillRect(16, fy + 28, 32, 1);
      } else {
        win(17, fy + 16, 30, 26);
        g.fillStyle = 'rgba(0,0,0,0.15)';
        g.fillRect(16, fy + 43, 32, 2); // sill shadow
      }
      // AC unit on some floors (drawn flat; real boxes are added too)
      if (rnd() < 0.25) {
        g.fillStyle = '#d6d6cf';
        g.fillRect(48, fy + 46, 12, 9);
        g.fillStyle = '#7a7c80';
        g.fillRect(50, fy + 48, 6, 5);
      }
    }
  }
  return { map: tex(c), emissive: tex(ce) };
}

// Ground-floor shop strips: 8 kinds (64 px tall = 3.2 m), u repeats every 6.4 m
export const SHOP_KINDS = 8;
function shopTextures() {
  const W = 128, H = SHOP_KINDS * 64;
  const [c, g] = canvas(W, H);
  const [ce, ge] = canvas(W, H);
  ge.fillStyle = '#000';
  ge.fillRect(0, 0, W, H);
  const kinds = [
    // [interior lit colour, frame, top band (noren / fascia), shutter?]
    ['#ffcf86', '#3a2a1e', '#1f2c5a'], // ramen: warm, navy noren
    ['#f4f6ff', '#d8dadf', '#2a8a4a'], // convenience store: bright white, green band
    ['#ffb870', '#2a1d14', '#7a1d12'], // izakaya: amber, dark wood, red noren
    [null, '#8a8c90', '#5a5c62'], // closed shop: roller shutter
    ['#ffd9a0', '#4a3a2a', '#c8a060'], // cafe
    ['#e8fff4', '#e0e4e0', '#1d6b45'], // pharmacy
    ['#d8ecff', '#b8bcc4', '#2a5ab0'], // laundromat
    ['#ffe0b0', '#2a2a30', '#e07a2e'], // bike / general shop
  ];
  kinds.forEach(([lit, frame, band], k) => {
    const y0 = k * 64;
    g.fillStyle = frame;
    g.fillRect(0, y0, W, 64);
    if (!lit) {
      // roller shutter with a little graffiti tag
      g.fillStyle = '#9a9ca2';
      g.fillRect(4, y0 + 12, W - 8, 52);
      g.fillStyle = 'rgba(0,0,0,0.18)';
      for (let y = y0 + 14; y < y0 + 64; y += 3) g.fillRect(4, y, W - 8, 1);
      g.fillStyle = band;
      g.fillRect(0, y0, W, 12);
      return;
    }
    // big windows with an interior
    g.fillStyle = '#1c2230';
    g.fillRect(4, y0 + 14, W - 8, 46);
    ge.fillStyle = lit;
    ge.fillRect(4, y0 + 14, W - 8, 46);
    // shelves / counter / people silhouettes
    for (let x = 6; x < W - 6; x += 4) {
      const h = 3 + Math.floor(rnd() * 3);
      ge.fillStyle = `rgba(0,0,0,${0.15 + rnd() * 0.3})`;
      ge.fillRect(x, y0 + 30, 3, h);
      ge.fillRect(x, y0 + 42, 3, h);
    }
    ge.fillStyle = 'rgba(0,0,0,0.5)';
    ge.fillRect(4, y0 + 50, W - 8, 10); // counter
    for (let p = 0; p < 2; p++) {
      const px = 10 + Math.floor(rnd() * (W - 30));
      ge.fillRect(px, y0 + 34, 6, 16);
      ge.fillRect(px + 1, y0 + 30, 4, 4);
    }
    g.fillStyle = 'rgba(255,255,255,0.08)';
    g.fillRect(4, y0 + 14, W - 8, 46);
    // mullions + door
    g.fillStyle = frame;
    for (let x = 4; x < W; x += 30) g.fillRect(x, y0 + 14, 2, 50);
    g.fillRect(56, y0 + 14, 16, 50);
    ge.fillStyle = lit;
    ge.fillRect(58, y0 + 18, 12, 46);
    // fascia / noren curtain with glyphs
    g.fillStyle = band;
    g.fillRect(0, y0, W, 12);
    if (k === 0 || k === 2) {
      // noren: split curtain panels hanging over the door
      g.fillRect(48, y0 + 12, 32, 12);
      g.fillStyle = 'rgba(0,0,0,0.3)';
      for (let x = 56; x < 80; x += 8) g.fillRect(x, y0 + 12, 1, 12);
    }
    for (let i = 0; i < 5; i++) glyph(g, 8 + i * 24, y0 + 2, 8, '#f4efe0');
    ge.fillStyle = 'rgba(255,240,220,0.35)';
    ge.fillRect(0, y0, W, 12);
  });
  return { map: tex(c), emissive: tex(ce) };
}

export function tokyoMaterials() {
  const atlas = atlasTexture();
  const fac = facadeTextures();
  const shop = shopTextures();
  return {
    sign: new THREE.MeshLambertMaterial({ map: atlas, emissiveMap: atlas, emissive: new THREE.Color(1, 1, 1), emissiveIntensity: 0.5 }),
    facade: new THREE.MeshLambertMaterial({ map: fac.map, emissiveMap: fac.emissive, emissive: new THREE.Color(1, 1, 1), emissiveIntensity: 0.2 }),
    shop: new THREE.MeshLambertMaterial({ map: shop.map, emissiveMap: shop.emissive, emissive: new THREE.Color(1, 1, 1), emissiveIntensity: 0.5 }),
    wire: new THREE.LineBasicMaterial({ color: '#202228' }),
    leaf: new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true }),
  };
}

export function tokyoNight(m, k) {
  m.sign.emissiveIntensity = 0.45 + 1.5 * k;
  m.facade.emissiveIntensity = 0.12 + 1.5 * k;
  m.shop.emissiveIntensity = 0.45 + 1.9 * k;
}

// ---------------------------------------------------------------- builders
// The builder works in one chunk: W = world, c = chunk context (geo, a, glows,
// lines, wires). R(k) is the chunk's deterministic random.
export class Tokyo {
  constructor(W, c, R) {
    this.W = W;
    this.c = c;
    this.R = R;
    this.k = 1000;
  }
  r() {
    return this.R(this.k++);
  }

  // chunk-local point at road coords
  pt(f, ds, d, y) {
    const a = this.c.a;
    return [f.x + f.fx * ds + f.rx * d - a.x, f.y + y - a.y, f.z + f.fz * ds + f.rz * d - a.z];
  }

  // a textured rectangle facing direction n = (nx, nz) (horizontal), bottom
  // centre at p; uv = [u0, v0, u1, v1]
  face(geo, p, nx, nz, w, h, uv) {
    const rx = nz, rz = -nx; // viewer's right
    const BL = [p[0] - rx * w / 2, p[1], p[2] - rz * w / 2];
    const BR = [p[0] + rx * w / 2, p[1], p[2] + rz * w / 2];
    const TR = [BR[0], BR[1] + h, BR[2]];
    const TL = [BL[0], BL[1] + h, BL[2]];
    const inside = [p[0] - nx * 0.5, p[1] + h / 2, p[2] - nz * 0.5];
    const [u0, v0, u1, v1] = uv;
    geo.quadOut([BL, BR, TR, TL], [[u0, v0], [u1, v0], [u1, v1], [u0, v1]], inside);
  }

  col(c) {
    this.c.geo.colored.col = c;
    return this.c.geo.colored;
  }

  // ---- a narrow shop-house: facade box, ground-floor shop, awning, signs,
  // AC units, balconies and something on the roof. side: +1 right of the
  // road, -1 left. front: d of the street face. Returns nothing.
  shopHouse(sm, along, front, side, base, opts = {}) {
    const W = this.W, geo = this.c.geo, a = this.c.a;
    const f = W.path.sample(sm, {});
    f.s = sm;
    const floors = opts.floors || 2 + Math.floor(this.r() * 3);
    const depth = opts.depth || 9 + this.r() * 4;
    const style = opts.style ?? Math.floor(this.r() * 8);
    const h = floors * 3.2;
    const d = front + side * depth / 2;
    if (this.c.foot) this.c.foot(sm, d, along, depth);
    // walls (facade texture on all four sides)
    const v0 = 1 - (style * 256 + 256) / (FAC_STYLES * 256);
    const v1 = v0 + floors * 64 / (FAC_STYLES * 256);
    const nF = [-side * f.rx, -side * f.rz]; // toward the road
    const uA = along / 3.2, uD = depth / 3.2;
    const fo = this.r() * 4;
    this.face(geo.tkFacade, this.pt(f, 0, front, base), nF[0], nF[1], along, h, [fo, v0, fo + uA, v1]);
    this.face(geo.tkFacade, this.pt(f, 0, front + side * depth, base), -nF[0], -nF[1], along, h, [fo, v0, fo + uA, v1]);
    this.face(geo.tkFacade, this.pt(f, -along / 2, d, base), -f.fx, -f.fz, depth, h, [0, v0, uD, v1]);
    this.face(geo.tkFacade, this.pt(f, along / 2, d, base), f.fx, f.fz, depth, h, [0, v0, uD, v1]);
    // flat roof slab with a parapet lip
    W.obox(this.col(['#5a5c62', '#6d6a64', '#4a4d55'][style % 3]), sm, d, base + h, along + 0.2, depth + 0.2, 0.35, a);
    // ground floor shop
    const shop = opts.shop ?? this.r() < 0.75;
    if (shop) {
      const kind = Math.floor(this.r() * 8);
      const sv0 = 1 - (kind * 64 + 64) / (SHOP_KINDS * 64), sv1 = sv0 + 1 / SHOP_KINDS;
      const su = this.r();
      this.face(geo.tkShop, this.pt(f, 0, front - side * 0.04, base), nF[0], nF[1], along - 0.3, 3.15, [su, sv0, su + along / 6.4, sv1]);
      if (kind !== 3 && this.r() < 0.6) this.awning(f, along, front, side, base);
      if (kind === 0 || kind === 2 || this.r() < 0.15) this.lanterns(f, along, front, side, base);
      if (this.r() < 0.55) this.hsign(f, along, front, side, base + 3.25);
      if (this.r() < 0.35) this.vending(f, along / 2 - 0.7, front, side, base);
      if (this.r() < 0.3) this.aBoard(f, (this.r() - 0.5) * (along - 2), front - side * 1.6, side, base);
      if (this.r() < 0.35) this.bikes(f, -along / 2 + 1.2, front - side * 0.9, side, base, 1 + Math.floor(this.r() * 3));
    } else if (this.r() < 0.5) {
      this.plants(f, along, front, side, base);
    }
    // vertical sign hanging off one corner
    if (floors >= 2 && this.r() < (opts.signs ?? 0.6)) {
      const end = this.r() < 0.5 ? -1 : 1;
      const sh = Math.min(h - 3.4, 2.4 + this.r() * 3.2);
      if (sh > 1.6) this.vsign(f, end * (along / 2 - 0.5), front, side, base + 3.5, sh);
    }
    // AC units and balconies on the upper floors
    for (let fl = 1; fl < floors; fl++) {
      if (this.r() < 0.45) {
        const ds = (this.r() - 0.5) * (along - 1.6);
        this.acUnit(f, ds, front, side, base + fl * 3.2 + 0.3);
      }
      if ((style === 2 || style === 4) && along > 4) {
        // balcony slab + solid front panel
        const bc = this.col(style === 4 ? '#c9ccd2' : '#7c8088');
        W.obox(bc, sm, front - side * 0.45, base + fl * 3.2 - 0.05, along - 0.4, 0.9, 0.12, a);
        W.obox(bc, sm, front - side * 0.88, base + fl * 3.2 + 0.07, along - 0.4, 0.06, 1.0, a);
      }
    }
    this.rooftop(sm, d, along, depth, base + h + 0.35);
  }

  awning(f, along, front, side, base) {
    const cols = ['#b8322a', '#2a5a9a', '#2a7a4a', '#d8a030', '#e8e4da', '#7a3a2a', '#c86a2a'];
    const geo = this.col(cols[Math.floor(this.r() * cols.length)]);
    const w = (along - 0.6) / 2, out = 1.2 + this.r() * 0.5;
    const y0 = base + 3.2, y1 = base + 2.7;
    const A = this.pt(f, -w, front, y0), B = this.pt(f, w, front, y0);
    const C = this.pt(f, w, front - side * out, y1), D = this.pt(f, -w, front - side * out, y1);
    const inside = this.pt(f, 0, front + side * 1, base + 1);
    geo.quadOut([A, B, C, D], null, inside);
    // underside (seen from below) and the front lip
    geo.quadOut([A, D, C, B], null, this.pt(f, 0, front - side * out * 0.5, y0 + 2));
    const E = this.pt(f, w, front - side * out, y1 - 0.3), F = this.pt(f, -w, front - side * out, y1 - 0.3);
    geo.quadOut([D, C, E, F], null, inside);
  }

  lanterns(f, along, front, side, base) {
    const n = 1 + Math.floor(this.r() * 2);
    for (let i = 0; i < n; i++) {
      const ds = (i - (n - 1) / 2) * 1.6;
      const d = front - side * 0.5;
      this.W.obox(this.col('#c8281e'), f.s + ds, d, base + 2.15, 0.36, 0.36, 0.55, this.c.a);
      this.W.obox(this.col('#202020'), f.s + ds, d, base + 2.7, 0.2, 0.2, 0.08, this.c.a);
      const p = this.W.path.point(f.s + ds, d, base + 2.42);
      this.c.glows.push({ x: p.x, y: p.y, z: p.z, r: 1.0, g: 0.28, b: 0.14, size: 0.75, h: base + 2.42 });
    }
  }

  hsign(f, along, front, side, y) {
    const w = Math.min(along - 0.8, 2.6 + this.r() * 2.4), h = w / 4;
    const geo = this.c.geo;
    this.W.obox(geo.dark, f.s, front - side * 0.08, y, w + 0.1, 0.12, h + 0.1, this.c.a);
    this.face(geo.tkSign, this.pt(f, 0, front - side * 0.19, y + 0.05), -side * f.rx, -side * f.rz, w, h, ATLAS.hsign(Math.floor(this.r() * 16)));
  }

  // vertical sign sticking out from the facade, readable from along the road
  vsign(f, ds, front, side, y, h) {
    const geo = this.c.geo;
    const w = 0.9, dc = front - side * 0.75;
    const i = Math.floor(this.r() * 32);
    const [u0, v0, u1, v1] = ATLAS.vsign(i);
    const uv = [u0, v1 - (v1 - v0) * Math.min(1, h / 3.6), u1, v1];
    this.W.obox(geo.dark, f.s + ds, dc, y - 0.05, 0.16, w + 0.08, h + 0.1, this.c.a);
    this.W.obox(geo.metal, f.s + ds, front - side * 0.15, y + h * 0.75, 0.08, 0.3, 0.08, this.c.a);
    for (const dir of [-1, 1]) {
      this.face(geo.tkSign, this.pt(f, ds + dir * 0.12, dc, y), dir * f.fx, dir * f.fz, w, h, uv);
    }
    // a soft coloured glow so it reflects in the wet road at night
    const [bg] = ATLAS.styleOfV(i);
    const cl = new THREE.Color(bg);
    const p = this.W.path.point(f.s + ds, dc, y + h / 2);
    this.c.glows.push({ x: p.x, y: p.y, z: p.z, r: cl.r * 0.9, g: cl.g * 0.9, b: cl.b * 0.9, size: 0.9, h: y + h / 2 });
  }

  vending(f, ds, front, side, base) {
    const geo = this.c.geo;
    const d = front - side * 0.45;
    const i = Math.floor(this.r() * 16);
    const body = ['#c8202a', '#f0f0ea', '#2a5ab0', '#e8e8e0', '#1e7a4a', '#d8d2c0'][i % 6];
    this.W.obox(this.col(body), f.s + ds, d, base, 0.95, 0.8, 1.85, this.c.a);
    this.face(geo.tkSign, this.pt(f, ds, d - side * 0.44, base + 0.02), -side * f.rx, -side * f.rz, 0.95, 1.8, ATLAS.vend(i));
    const p = this.W.path.point(f.s + ds, d - side * 0.6, base + 1.4);
    this.c.glows.push({ x: p.x, y: p.y, z: p.z, r: 0.75, g: 0.85, b: 1.0, size: 0.6, h: base + 1.4 });
  }

  // a standing A-frame sign on the pavement
  aBoard(f, ds, d, side, base) {
    const geo = this.c.geo;
    this.W.obox(geo.dark, f.s + ds, d, base, 0.62, 0.3, 0.95, this.c.a);
    const uv = ATLAS.hsign(Math.floor(this.r() * 16));
    // the 4:1 board texture, cropped to the left square-ish part
    const crop = [uv[0], uv[1], uv[0] + (uv[2] - uv[0]) * 0.45, uv[3]];
    this.face(geo.tkSign, this.pt(f, ds, d - side * 0.18, base + 0.15), -side * f.rx, -side * f.rz, 0.56, 0.75, crop);
  }

  // parked bicycles side by side, nose-in toward the shop front
  bikes(f, ds, d, side, base, n) {
    const W = this.W, a = this.c.a, geo = this.c.geo;
    const frames = ['#b8322a', '#2a5a9a', '#d8d4c8', '#2a2a30', '#d8a030'];
    for (let i = 0; i < n; i++) {
      const s = f.s + ds + i * 0.75;
      for (const w of [-0.55, 0.55]) W.obox(geo.dark, s, d + side * w, base, 0.06, 0.62, 0.62, a);
      const fc = this.col(frames[Math.floor(this.r() * frames.length)]);
      W.obox(fc, s, d, base + 0.42, 0.05, 1.0, 0.07, a);
      W.obox(fc, s, d - side * 0.4, base + 0.3, 0.05, 0.06, 0.62, a);
      W.obox(this.c.geo.dark, s, d - side * 0.4, base + 0.9, 0.5, 0.06, 0.05, a); // handlebar
      W.obox(this.c.geo.dark, s, d + side * 0.25, base + 0.75, 0.12, 0.25, 0.05, a); // saddle
    }
  }

  plants(f, along, front, side, base) {
    const n = 1 + Math.floor(this.r() * 3);
    for (let i = 0; i < n; i++) {
      const ds = (this.r() - 0.5) * (along - 1);
      const d = front - side * 0.45;
      this.W.obox(this.col(this.r() < 0.5 ? '#8a5a3a' : '#7a7c80'), f.s + ds, d, base, 0.5, 0.5, 0.45, this.c.a);
      this.bush(f.s + ds, d, base + 0.42, 0.38, 0.6);
    }
  }

  acUnit(f, ds, front, side, y) {
    const d = front - side * 0.2;
    this.W.obox(this.col('#d4d4cc'), f.s + ds, d, y, 0.8, 0.36, 0.6, this.c.a);
    this.W.obox(this.c.geo.dark, f.s + ds - 0.12, d - side * 0.19, y + 0.12, 0.38, 0.03, 0.38, this.c.a);
  }

  rooftop(sm, d, along, depth, y) {
    const W = this.W, a = this.c.a, r = this.r();
    if (r < 0.3) {
      // water tank on legs
      const ds = (this.r() - 0.5) * (along - 3), dd = d + (this.r() - 0.5) * (depth - 3);
      for (const [i, j] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) W.obox(this.c.geo.metal, sm + ds + i * 0.6, dd + j * 0.6, y, 0.1, 0.1, 1.0, a);
      W.obox(this.col('#9aa0a6'), sm + ds, dd, y + 1.0, 1.6, 1.6, 1.5, a);
    } else if (r < 0.5 && along > 6) {
      // steel frame (old rooftop sign structure)
      const ds = (this.r() - 0.5) * 2, hh = 2.5 + this.r() * 2;
      const g = this.c.geo.dark;
      for (const [i, j] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) W.obox(g, sm + ds + i * 1.6, d + j * 1.6, y, 0.12, 0.12, hh, a);
      W.obox(g, sm + ds, d - 1.6, y + hh, 3.3, 0.12, 0.12, a);
      W.obox(g, sm + ds, d + 1.6, y + hh, 3.3, 0.12, 0.12, a);
      W.obox(g, sm + ds - 1.6, d, y + hh, 0.12, 3.3, 0.12, a);
      W.obox(g, sm + ds + 1.6, d, y + hh, 0.12, 3.3, 0.12, a);
      W.obox(g, sm + ds, d - 1.6, y + hh * 0.5, 3.3, 0.1, 0.1, a);
    } else if (r < 0.75) {
      // a few AC condensers / a stair hut
      if (this.r() < 0.5) W.obox(this.col('#b8b4aa'), sm + (this.r() - 0.5) * (along - 3), d, y, 2.2, 2.4, 2.3, a);
      for (let i = 0; i < 2; i++) W.obox(this.col('#d4d4cc'), sm + (this.r() - 0.5) * (along - 2), d + (this.r() - 0.5) * (depth - 2), y, 0.9, 0.5, 0.7, a);
    }
  }

  // ---- a low Japanese house behind a block wall, tiled roof
  house(sm, along, front, side, base) {
    const W = this.W, geo = this.c.geo, a = this.c.a;
    const f = W.path.sample(sm, {});
    f.s = sm;
    const setback = 2.2 + this.r() * 1.5;
    const depth = 7 + this.r() * 3;
    const hf = front + side * setback;
    const d = hf + side * depth / 2;
    if (this.c.foot) this.c.foot(sm, d, along - 1.2, depth);
    const floors = this.r() < 0.75 ? 2 : 1;
    const style = [0, 3, 5, 6, 1][Math.floor(this.r() * 5)];
    const h = floors * 3.0;
    const v0 = 1 - (style * 256 + 256) / (FAC_STYLES * 256);
    const v1 = v0 + floors * 64 / (FAC_STYLES * 256);
    const nF = [-side * f.rx, -side * f.rz];
    const w = along - 1.2;
    this.face(geo.tkFacade, this.pt(f, 0, hf, base), nF[0], nF[1], w, h, [0, v0, w / 3.2, v1]);
    this.face(geo.tkFacade, this.pt(f, 0, hf + side * depth, base), -nF[0], -nF[1], w, h, [0, v0, w / 3.2, v1]);
    this.face(geo.tkFacade, this.pt(f, -w / 2, d, base), -f.fx, -f.fz, depth, h, [0, v0, depth / 3.2, v1]);
    this.face(geo.tkFacade, this.pt(f, w / 2, d, base), f.fx, f.fz, depth, h, [0, v0, depth / 3.2, v1]);
    // low tiled roof with eaves
    const roofCol = ['#3d4a5c', '#4a4038', '#2f3a48', '#5a3a30'][Math.floor(this.r() * 4)];
    W.roof(this.col(roofCol), sm, d, base + h, w + 0.9, depth + 0.9, 1.3 + this.r() * 0.6, a);
    // concrete block wall along the front with a gate gap
    const wc = this.col(this.r() < 0.5 ? '#a8a49a' : '#8f8b82');
    const gate = (this.r() - 0.5) * (along - 3);
    const segA = (gate - 1) - (-along / 2), segB = along / 2 - (gate + 1);
    if (segA > 0.3) W.obox(wc, sm - along / 2 + segA / 2, front + side * 0.15, base, segA, 0.2, 1.25, a);
    if (segB > 0.3) W.obox(wc, sm + gate + 1 + segB / 2, front + side * 0.15, base, segB, 0.2, 1.25, a);
    // garden shrub / small tree peeking over the wall, AC unit on the side
    if (this.r() < 0.7) this.bush(sm + (this.r() - 0.5) * (along - 3), front + side * 1.2, base + 0.6, 1.0, 1.8 + this.r());
    if (floors === 2 && this.r() < 0.6) this.acUnit(f, (this.r() - 0.5) * (w - 1.6), hf, side, base + 3.3);
    if (this.r() < 0.3) this.vending(f, gate + (this.r() < 0.5 ? -1.6 : 1.6), front, side, base);
  }

  // ---- a plain block behind the street (apartments / small offices)
  backBlock(sm, along, near, side, base, floors, building, depthIn) {
    const W = this.W, geo = this.c.geo, a = this.c.a;
    const f = W.path.sample(sm, {});
    const depth = depthIn || 10 + this.r() * 8;
    const d = near + side * depth / 2;
    if (this.c.foot) this.c.foot(sm, d, along, depth);
    const h = floors * 3.2;
    if (building) {
      const uOff = Math.floor(this.r() * 16) / 16, vOff = Math.floor(this.r() * 16) / 16;
      W.boxBuilding(geo.building, sm, d, base - 0.5, along, depth, h + 0.5, a, uOff, vOff);
    } else {
      const style = [2, 4, 0, 5, 6, 7, 1][Math.floor(this.r() * 7)];
      const v0 = 1 - (style * 256 + 256) / (FAC_STYLES * 256);
      const fl = Math.min(4, floors);
      const v1 = v0 + fl * 64 / (FAC_STYLES * 256);
      const nF = [-side * f.rx, -side * f.rz];
      // stack the 4-floor band when taller
      for (let y = 0; y < floors; y += 4) {
        const n = Math.min(4, floors - y);
        const vv1 = v0 + n * 64 / (FAC_STYLES * 256);
        const yb = base + y * 3.2, hh = n * 3.2;
        const vs = y === 0 ? v0 : v0 + 64 / (FAC_STYLES * 256); // upper stacks skip the ground-floor row
        const ve = y === 0 ? vv1 : Math.min(v0 + 4 * 64 / (FAC_STYLES * 256), vs + n * 64 / (FAC_STYLES * 256));
        this.face(geo.tkFacade, this.pt(f, 0, near, yb), nF[0], nF[1], along, hh, [0, vs, along / 3.2, ve]);
        this.face(geo.tkFacade, this.pt(f, 0, near + side * depth, yb), -nF[0], -nF[1], along, hh, [0, vs, along / 3.2, ve]);
        this.face(geo.tkFacade, this.pt(f, -along / 2, d, yb), -f.fx, -f.fz, depth, hh, [0, vs, depth / 3.2, ve]);
        this.face(geo.tkFacade, this.pt(f, along / 2, d, yb), f.fx, f.fz, depth, hh, [0, vs, depth / 3.2, ve]);
      }
      W.obox(this.col('#55585e'), sm, d, base + h, along + 0.2, depth + 0.2, 0.35, a);
      void v1;
    }
    if (this.r() < 0.35) {
      // rooftop billboard / sign facing the road
      const w = Math.min(along - 1, 6), hh = w / 4;
      const y = base + h + 0.35;
      for (const j of [-1, 1]) W.obox(geo.dark, sm + j * w * 0.35, near + side * 1.2, y, 0.15, 0.15, 1.2, a);
      W.obox(geo.dark, sm, near + side * 1.0, y + 1.1, w + 0.1, 0.12, hh + 0.1, a);
      this.face(geo.tkSign, this.pt(f, 0, near + side * 0.9, y + 1.15), -side * f.rx, -side * f.rz, w, hh, ATLAS.hsign(Math.floor(this.r() * 16)));
    } else {
      this.rooftop(sm, d, along, depth, base + h + 0.35);
    }
    return depth;
  }

  // a leafy blob: an octagonal double cone (wide in the middle), in the
  // "tree" bucket so it shares the vertex-coloured leaf greens
  bush(s, d, y, r, h) {
    // a shrub: two to four overlapping leaf balls
    const W = this.W, a = this.c.a, geo = this.c.geo.leafTk;
    const n = r > 0.8 ? 4 : r > 0.5 ? 3 : 2;
    for (let i = 0; i < n; i++) {
      const t = this.r() * 6.28, o = i === 0 ? 0 : r * 0.45;
      const p = W.path.point(s + Math.cos(t) * o, d + Math.sin(t) * o, y + h * (0.45 + 0.12 * this.r()));
      const rr = r * (i === 0 ? 0.8 : 0.6 + 0.15 * this.r());
      leafBall(geo, p.x - a.x, p.y - a.y, p.z - a.z, rr, Math.min(rr, h * 0.5), this.r() * 1000);
    }
  }

  // a leafy street tree: trunk, two branches and a crown of leaf balls
  streetTree(s, d, base, k) {
    const W = this.W, a = this.c.a, geo = this.c.geo;
    const th = 2.4 * k;
    W.obox(geo.dark, s, d, base, 0.24, 0.24, th + 0.4, a);
    W.obox(geo.dark, s + 0.35, d, base + th - 0.5, 0.7, 0.12, 0.12, a, 0.6);
    W.obox(geo.dark, s - 0.3, d + 0.2, base + th - 0.2, 0.6, 0.12, 0.12, a, -0.8);
    const crown = [[0, 0, 0.9, 1.35], [0.9, 0.2, 0.55, 0.95], [-0.8, -0.3, 0.6, 0.95], [0.2, 0.85, 0.5, 0.9], [-0.2, -0.85, 0.45, 0.9], [0.1, 0, 1.45, 0.85]];
    for (const [ds, dd, dy, r] of crown) {
      const p = W.path.point(s + ds * k, d + dd * k, base + th + dy * k);
      leafBall(geo.leafTk, p.x - a.x, p.y - a.y, p.z - a.z, r * k, r * k * 0.85, this.r() * 1000, dy > 1 ? 0.12 : 0);
    }
  }

  // ---- pavement furniture in the band [dIn, dOut] (road side .. shop side)
  furniture(s, dIn, dOut, side, base, busy) {
    const W = this.W, a = this.c.a, geo = this.c.geo;
    const f = W.path.sample(s, {});
    f.s = s;
    const band = (dOut - dIn) * side;
    const at = (w) => dIn + side * (w / 2 + Math.max(0, band - w) * this.r());
    const nF = [-side * f.rx, -side * f.rz];
    const r = this.r();
    if (band > 2.2 && r < (busy ? 0.12 : 0.06)) {
      // bus stop: shelter with a lit advert panel and a stop sign
      const d = at(1.8);
      for (const j of [-1.8, 1.8]) W.obox(geo.metal, s + j, d + side * 0.6, base, 0.1, 0.1, 2.5, a);
      W.obox(this.col('#3a4250'), s, d, base + 2.5, 4.2, 1.8, 0.12, a);
      W.obox(geo.dark, s, d + side * 0.7, base + 0.4, 3.8, 0.08, 1.9, a);
      this.face(geo.tkSign, this.pt(f, 1.2, d + side * 0.64, base + 0.5), nF[0], nF[1], 1.2, 1.6, ATLAS.vsign(Math.floor(this.r() * 32)));
      W.obox(this.col('#6a6d72'), s - 0.6, d + side * 0.2, base + 0.45, 2.2, 0.4, 0.08, a); // bench
      W.obox(geo.metal, s - 2.6, d - side * 0.5, base, 0.08, 0.08, 2.6, a);
      W.obox(this.col('#2a7ad0'), s - 2.6, d - side * 0.5, base + 2.4, 0.06, 0.6, 0.6, a);
      const p = W.path.point(s + 1.2, d + side * 0.4, base + 1.3);
      this.c.glows.push({ x: p.x, y: p.y, z: p.z, r: 0.9, g: 0.9, b: 1.0, size: 0.7, h: base + 1.3 });
    } else if (r < 0.32) {
      // street tree in a square planter
      const d = at(1.4);
      W.obox(this.col('#8f8b82'), s, d, base, 1.4, 1.4, 0.35, a);
      this.streetTree(s, d, base + 0.35, 0.85 + this.r() * 0.4);
    } else if (r < 0.45) {
      // long planter with shrubs
      const d = at(0.8);
      W.obox(this.col('#a8a49a'), s, d, base, 2.6, 0.8, 0.5, a);
      for (const j of [-0.8, 0, 0.8]) this.bush(s + j, d, base + 0.45, 0.45, 0.6);
    } else if (r < 0.56) {
      // bench
      const d = at(0.6);
      const bc = this.col(['#7a5a3a', '#4a5a6a', '#6a6d72'][Math.floor(this.r() * 3)]);
      W.obox(bc, s, d, base + 0.42, 1.8, 0.5, 0.08, a);
      W.obox(bc, s, d + side * 0.24, base + 0.5, 1.8, 0.06, 0.45, a);
      for (const j of [-0.75, 0.75]) W.obox(geo.dark, s + j, d, base, 0.08, 0.45, 0.42, a);
    } else if (r < 0.68) {
      // bicycle rack
      const d = at(1.3);
      this.bikes(f, -1.2, d, side, base, 2 + Math.floor(this.r() * 4));
    } else if (r < 0.78) {
      // a pair of vending machines facing the road
      const d = at(0.8);
      for (const j of [-0.5, 0.5]) {
        const i = Math.floor(this.r() * 16);
        const body = ['#c8202a', '#f0f0ea', '#2a5ab0', '#e8e8e0', '#1e7a4a', '#d8d2c0'][i % 6];
        W.obox(this.col(body), s + j, d, base, 0.95, 0.8, 1.85, a);
        this.face(geo.tkSign, this.pt(f, j, d - side * 0.44, base + 0.02), nF[0], nF[1], 0.95, 1.8, ATLAS.vend(i));
      }
      const p = W.path.point(s, d - side * 0.7, base + 1.4);
      this.c.glows.push({ x: p.x, y: p.y, z: p.z, r: 0.75, g: 0.85, b: 1.0, size: 0.75, h: base + 1.4 });
    } else if (r < 0.85) {
      // green phone booth
      const d = at(1.0);
      W.obox(this.col('#2a7a4a'), s, d, base, 1.0, 1.0, 0.25, a);
      W.obox(this.col('#9ab8c8'), s, d, base + 0.25, 0.92, 0.92, 1.85, a);
      W.obox(this.col('#2a7a4a'), s, d, base + 2.1, 1.0, 1.0, 0.25, a);
      const p = W.path.point(s, d, base + 1.9);
      this.c.glows.push({ x: p.x, y: p.y, z: p.z, r: 0.8, g: 1.0, b: 0.85, size: 0.5, h: base + 1.9 });
    } else {
      // rubbish / recycling bins
      const d = at(0.5);
      ['#2a5ab0', '#d8a030', '#2a7a4a'].forEach((cl, i) => W.obox(this.col(cl), s + (i - 1) * 0.55, d, base, 0.5, 0.5, 0.9, a));
    }
  }

  // ---- concrete utility poles every ~26 m along d, with sagging wires to the next
  poles(s0, s1, d, baseAt, ok) {
    const W = this.W, geo = this.c.geo, a = this.c.a;
    const SP = 26;
    for (let k = Math.ceil((s0 - 7) / SP); k * SP + 7 < s1; k++) {
      const s = k * SP + 7;
      if (s < s0 || !ok(s) || !ok(s + SP)) continue;
      const base = baseAt(s), base2 = baseAt(s + SP);
      W.obox(this.col('#8d8a84'), s, d, base, 0.34, 0.34, 10.2, a);
      W.obox(geo.dark, s, d, base + 9.2, 0.14, 1.9, 0.14, a);
      W.obox(geo.dark, s, d, base + 8.3, 0.14, 1.4, 0.14, a);
      if (hash(k * 3.7 + d) < 0.35) {
        W.obox(this.col('#6a6d72'), s, d + 0.45, base + 6.6, 0.6, 0.6, 1.1, a); // transformer
        W.obox(geo.dark, s, d + 0.45, base + 7.7, 0.4, 0.4, 0.1, a);
      }
      if (hash(k * 5.1 + d) < 0.4) W.obox(this.col('#e8e2c8'), s, d - 0.2, base + 3.2, 0.06, 0.32, 1.1, a); // address plate
      // wires: three on the top arm, two lower, one thick cable
      const runs = [[-0.85, 9.32], [0, 9.32], [0.85, 9.32], [-0.6, 8.42], [0.6, 8.42], [0.25, 6.4]];
      for (const [dd, y] of runs) this.wire(s, d + dd, base + y, s + SP, d + dd, base2 + y, 0.45 + hash(k + dd) * 0.35);
    }
  }

  wire(sA, dA, yA, sB, dB, yB, sag) {
    const W = this.W, a = this.c.a, L = this.c.wires;
    const N = 8;
    let prev = null;
    for (let i = 0; i <= N; i++) {
      const t = i / N;
      const s = sA + (sB - sA) * t, d = dA + (dB - dA) * t;
      const y = yA + (yB - yA) * t - sag * 4 * t * (1 - t);
      const p = W.path.point(s, d, y);
      const q = [p.x - a.x, p.y - a.y, p.z - a.z];
      if (prev) L.push(...prev, ...q);
      prev = q;
    }
  }
}
