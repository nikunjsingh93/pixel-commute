// Low-poly vehicles built from tapered boxes with flat-shaded vertex colours.
// Local frame: +Z forward, +Y up, +X = left. Origin at ground, centre.
import * as THREE from 'three';

export class Builder {
  constructor() {
    this.p = [];
    this.c = [];
  }
  tri(a, b, c, col) {
    this.p.push(...a, ...b, ...c);
    for (let i = 0; i < 3; i++) this.c.push(col.r, col.g, col.b);
  }
  quad(a, b, c, d, col) {
    this.tri(a, c, b, col);
    this.tri(a, d, c, col);
  }
  // Tapered box. bottom: half-width wb, z from zb0 (rear) to zb1 (front)
  // top: half-width wt, z from zt0 to zt1. y from y0 to y1.
  tbox(wb, wt, y0, y1, zb0, zb1, zt0, zt1, col, opt = {}) {
    const c = new THREE.Color(col);
    const sideCol = opt.side ? new THREE.Color(opt.side) : c;
    const frontCol = opt.front ? new THREE.Color(opt.front) : c;
    const rearCol = opt.rear ? new THREE.Color(opt.rear) : c;
    const topCol = opt.top ? new THREE.Color(opt.top) : c;
    const x = opt.x || 0;
    const B = [
      [x + wb, y0, zb0], [x - wb, y0, zb0], [x - wb, y0, zb1], [x + wb, y0, zb1],
    ];
    const yf = opt.yTopFront ?? y1; // top height at the front edge (sloped hood)
    const T = [
      [x + wt, y1, zt0], [x - wt, y1, zt0], [x - wt, yf, zt1], [x + wt, yf, zt1],
    ];
    if (opt.sideOnly) {
      // just the two outer side walls (door slabs)
      this.quad(B[0], B[3], T[3], T[0], sideCol);
      this.quad(B[2], B[1], T[1], T[2], sideCol);
      return;
    }
    // CCW seen from outside
    this.quad(T[0], T[3], T[2], T[1], topCol); // top
    if (!opt.noBottom) this.quad(B[0], B[1], B[2], B[3], c.clone().multiplyScalar(0.3));
    if (!opt.noRear) this.quad(B[1], B[0], T[0], T[1], rearCol); // rear (-z)
    this.quad(B[3], B[2], T[2], T[3], frontCol); // front (+z)
    this.quad(B[0], B[3], T[3], T[0], sideCol); // +x side
    this.quad(B[2], B[1], T[1], T[2], sideCol); // -x side
  }
  box(x0, x1, y0, y1, z0, z1, col, opt) {
    const w = (x1 - x0) / 2;
    this.tbox(w, w, y0, y1, z0, z1, z0, z1, col, { ...opt, x: (x0 + x1) / 2 });
  }
  // wheel: octagonal prism along X
  wheel(x, z, r, w, col = '#16171c') {
    const c = new THREE.Color(col);
    const hub = new THREE.Color('#5b5f68');
    const n = 8;
    const x0 = x - w / 2, x1 = x + w / 2;
    for (let i = 0; i < n; i++) {
      const a0 = (i / n) * Math.PI * 2 + Math.PI / n;
      const a1 = ((i + 1) / n) * Math.PI * 2 + Math.PI / n;
      const y0 = r + Math.sin(a0) * r, z0 = z + Math.cos(a0) * r;
      const y1 = r + Math.sin(a1) * r, z1 = z + Math.cos(a1) * r;
      this.quad([x0, y1, z1], [x1, y1, z1], [x1, y0, z0], [x0, y0, z0], c);
      const outer = x > 0 ? x1 : x0;
      const cc = [outer, r, z];
      if (x > 0) this.tri(cc, [outer, y1, z1], [outer, y0, z0], i % 2 ? hub : c);
      else this.tri(cc, [outer, y0, z0], [outer, y1, z1], i % 2 ? hub : c);
    }
  }
  geometry() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.p, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.c, 3));
    g.computeVertexNormals();
    return g;
  }
}

const GLASS = '#232c3c';
const TRIM = '#202227';

// spec: dims + light positions. Returns {body, tail, head} geometries.
const TYPES = {
  sedan: { L: 4.8, W: 1.86, H: 1.44, weight: 5 },
  lux: { L: 5.2, W: 1.95, H: 1.48, weight: 1 },
  hatch: { L: 4.1, W: 1.76, H: 1.5, weight: 4 },
  suv: { L: 4.8, W: 1.95, H: 1.78, weight: 3 },
  van: { L: 5.3, W: 2.0, H: 2.15, weight: 2 },
  truck: { L: 7.6, W: 2.4, H: 3.4, weight: 1 },
  bus: { L: 11.5, W: 2.5, H: 3.2, weight: 0.4 },
  coupe: { L: 4.55, W: 1.9, H: 1.24, weight: 0.8 },
};

export const CAR_COLORS = [
  '#d8d2c2', '#e8e4da', '#a9a9a9', '#5e636e', '#2b2f38', '#16181d', '#7a1d1d',
  '#a33a2a', '#2c4a6e', '#3d5c47', '#b89b5e', '#c8c0a8', '#d6b23e', '#45556b',
];

function lights(b, L, W, y, h, side, colTail, colHead, headY, headH, opts = {}) {
  // tail pair at the rear, head pair at the front
  const z0 = -L / 2 - 0.02;
  const z1 = L / 2 + 0.02;
  const tw = opts.tailW || 0.38;
  b.tail.box(W / 2 - tw - 0.04, W / 2 - 0.04, y, y + h, z0 - 0.02, z0 + 0.03, colTail);
  b.tail.box(-W / 2 + 0.04, -W / 2 + tw + 0.04, y, y + h, z0 - 0.02, z0 + 0.03, colTail);
  if (opts.bar) b.tail.box(-W / 2 + tw + 0.04, W / 2 - tw - 0.04, y + h * 0.35, y + h * 0.6, z0 - 0.02, z0 + 0.02, '#8a1414');
  const hw = opts.headW || 0.34;
  b.head.box(W / 2 - hw - 0.08, W / 2 - 0.08, headY, headY + headH, z1 - 0.03, z1 + 0.02, colHead);
  b.head.box(-W / 2 + 0.08, -W / 2 + hw + 0.08, headY, headY + headH, z1 - 0.03, z1 + 0.02, colHead);
}

// door mirrors: a body-coloured housing on a stub, sitting on the door top
// just behind the base of the windscreen pillar (glass faces backwards)
function mirrors(B, hw, belt, zm, color, big = 1) {
  const h = 0.15 * big, d = 0.1;
  for (const s of [1, -1]) {
    const xi = s * (hw - 0.03), xo = s * (hw + 0.17 * big);
    B.box(Math.min(xi, xo), Math.max(xi, xo), belt - 0.02, belt + 0.05, zm - 0.05, zm + 0.04, color); // stub
    B.box(Math.min(s * (hw + 0.04), xo), Math.max(s * (hw + 0.04), xo), belt + 0.02, belt + 0.02 + h, zm - d / 2, zm + d / 2, color, { rear: '#4f5d78' });
  }
}

function build(type, color, opts = {}) {
  const t = TYPES[type];
  const { L, W } = t;
  const H = t.H + (opts.separateWheels ? 0.16 : 0); // a little more headroom for the cockpit view
  const b = { body: new Builder(), tail: new Builder(), head: new Builder() };
  const B = b.body;
  const col = new THREE.Color(color);
  const dark = col.clone().multiplyScalar(0.62).getStyle();
  const shade = col.clone().multiplyScalar(0.8).getStyle();
  const hw = W / 2;
  const wr = type === 'truck' || type === 'bus' ? 0.5 : type === 'van' || type === 'suv' ? 0.38 : type === 'coupe' ? 0.34 : 0.33;
  const tailLight = '#ff2a1e';
  const headLight = '#fff1c8';
  let tail = { y: 0.72, h: 0.16 };
  let head = { y: 0.62, h: 0.12 };
  let lightOpt = {};
  let plate = { y: 0.57, z: -L / 2 - 0.08 };
  let front = { y: 0.37, z: L / 2 + 0.06 }; // front plate (on the bumper)

  if (type === 'sedan' || type === 'lux' || type === 'hatch') {
    const zr = -L / 2, zf = L / 2;
    const hatch = type === 'hatch';
    const cb1Base = zf - 1.35, cb0Base = hatch ? zr + 0.25 : zr + 1.05;
    if (opts.separateWheels) {
      // hollow cabin for the cockpit view: hood + trunk + door slabs + floor,
      // so no body panel slices through the interior at sill height
      B.tbox(hw, hw - 0.05, 0.3, 0.92, cb1Base - 0.05, zf, cb1Base - 0.05, zf - 0.12, color, { side: shade, rear: color, top: color, yTopFront: 0.72 });
      B.tbox(hw, hw - 0.05, 0.3, 0.92, zr, cb0Base + 0.05, zr + 0.08, cb0Base + 0.05, color, { side: shade, rear: dark, top: color });
      B.tbox(hw, hw - 0.05, 0.3, 0.92, cb0Base, cb1Base, cb0Base, cb1Base, color, { x: 0, side: shade, top: color, front: '#202127', rear: '#202127', sideOnly: true });
      B.box(-hw + 0.1, hw - 0.1, 0.3, 0.38, cb0Base, cb1Base, '#1a1b20');
    } else {
      // lower body
      B.tbox(hw, hw - 0.05, 0.3, 0.92, zr, zf, zr + 0.08, zf - 0.12, color, { side: shade, rear: dark, top: color });
    }
    // bumpers
    B.box(-hw + 0.02, hw - 0.02, 0.26, 0.48, zr - 0.06, zr + 0.25, TRIM);
    B.box(-hw + 0.02, hw - 0.02, 0.26, 0.48, zf - 0.25, zf + 0.06, TRIM);
    // cabin (glass) + roof
    const cb0 = hatch ? zr + 0.25 : zr + 1.05;
    const cb1 = zf - 1.35;
    const ct0 = hatch ? zr + 0.45 : zr + 1.55;
    const ct1 = zf - 2.15;
    B.tbox(hw - 0.1, hw - 0.28, 0.92, H - 0.05, cb0, cb1, ct0, ct1, GLASS, { side: GLASS, rear: '#4a5670', front: '#3c4760' });
    B.tbox(hw - 0.27, hw - 0.3, H - 0.06, H, ct0 - 0.02, ct1 + 0.02, ct0 + 0.04, ct1 - 0.04, color);
    // plate
    b.head.box(-0.26, 0.26, 0.5, 0.64, zr - 0.08, zr - 0.04, '#6e5a1c');
    mirrors(B, hw, 0.92, cb1 - 0.22, color);
    if (type === 'lux') {
      B.box(-0.12, 0.12, 0.84, 0.88, zr - 0.02, zr + 0.02, '#c9c9c9'); // badge
      lightOpt = { tailW: 0.3, bar: false };
      tail = { y: 0.6, h: 0.3 };
    } else if (hatch) {
      tail = { y: 0.78, h: 0.22 };
      lightOpt = { tailW: 0.24 };
    } else {
      lightOpt = { tailW: 0.4, bar: true };
    }
    head = { y: 0.66, h: 0.12 };
  } else if (type === 'suv') {
    const zr = -L / 2, zf = L / 2;
    B.tbox(hw, hw - 0.04, 0.38, 1.05, zr, zf, zr + 0.05, zf - 0.15, color, { side: shade, rear: dark });
    B.box(-hw + 0.02, hw - 0.02, 0.32, 0.56, zr - 0.06, zr + 0.25, TRIM);
    B.box(-hw + 0.02, hw - 0.02, 0.32, 0.56, zf - 0.25, zf + 0.06, TRIM);
    B.tbox(hw - 0.08, hw - 0.18, 1.05, H - 0.06, zr + 0.15, zf - 1.15, zr + 0.3, zf - 1.75, GLASS, { rear: '#4a5670', front: '#3c4760' });
    B.tbox(hw - 0.16, hw - 0.18, H - 0.07, H, zr + 0.3, zf - 1.75, zr + 0.34, zf - 1.8, color);
    b.head.box(-0.26, 0.26, 0.6, 0.74, zr - 0.08, zr - 0.04, '#6e5a1c');
    mirrors(B, hw, 1.05, zf - 1.35, color);
    plate = { y: 0.67, z: zr - 0.08 };
    front = { y: 0.44, z: zf + 0.06 };
    tail = { y: 0.9, h: 0.2 };
    head = { y: 0.78, h: 0.14 };
    lightOpt = { tailW: 0.22 };
  } else if (type === 'van') {
    const zr = -L / 2, zf = L / 2;
    B.tbox(hw, hw - 0.05, 0.35, H, zr, zf - 1.0, zr + 0.02, zf - 1.3, color, { side: shade, rear: color });
    B.tbox(hw, hw - 0.1, 0.35, 1.05, zf - 1.0, zf, zf - 1.0, zf - 0.1, color, { side: shade });
    B.tbox(hw - 0.06, hw - 0.12, 1.05, H - 0.1, zf - 1.05, zf - 0.6, zf - 1.3, zf - 1.25, GLASS, { noRear: true }); // windscreen (open toward the cab)
    // rear windows
    B.box(-hw + 0.12, -0.05, 1.25, H - 0.2, zr - 0.03, zr + 0.01, '#2a3142');
    B.box(0.05, hw - 0.12, 1.25, H - 0.2, zr - 0.03, zr + 0.01, '#2a3142');
    B.box(-0.03, 0.03, 0.4, H - 0.08, zr - 0.04, zr, dark); // door split
    B.box(-hw + 0.02, hw - 0.02, 0.3, 0.55, zr - 0.08, zr + 0.2, TRIM);
    b.head.box(-0.26, 0.26, 0.6, 0.74, zr - 0.1, zr - 0.06, '#6e5a1c');
    mirrors(B, hw - 0.04, 1.05, zf - 1.25, color, 1.4);
    B.box(-hw + 0.04, hw - 0.04, 0.3, 0.52, zf - 0.12, zf + 0.06, TRIM); // front bumper
    plate = { y: 0.67, z: zr - 0.1 };
    front = { y: 0.41, z: zf + 0.06 };
    tail = { y: 0.85, h: 0.42 };
    head = { y: 0.8, h: 0.14 };
    lightOpt = { tailW: 0.14 };
  } else if (type === 'coupe') {
    // low wedge: long sloping bonnet, cabin set back, short tail with a lip spoiler
    const zr = -L / 2, zf = L / 2;
    const cb0 = zr + 1.0, cb1 = zf - 1.6, ct0 = zr + 1.4, ct1 = zf - 2.35;
    if (opts.separateWheels) {
      B.tbox(hw, hw - 0.06, 0.25, 0.78, cb1 - 0.05, zf, cb1 - 0.05, zf - 0.15, color, { side: shade, rear: color, top: color, yTopFront: 0.6 });
      B.tbox(hw, hw - 0.06, 0.25, 0.78, zr, cb0 + 0.05, zr + 0.1, cb0 + 0.05, color, { side: shade, rear: dark, top: color });
      B.tbox(hw, hw - 0.06, 0.25, 0.78, cb0, cb1, cb0, cb1, color, { side: shade, sideOnly: true });
      B.box(-hw + 0.1, hw - 0.1, 0.25, 0.32, cb0, cb1, '#1a1b20');
    } else {
      B.tbox(hw, hw - 0.06, 0.25, 0.78, zr, zf, zr + 0.1, zf - 0.15, color, { side: shade, rear: dark, top: color, yTopFront: 0.6 });
    }
    B.box(-hw + 0.02, hw - 0.02, 0.2, 0.4, zr - 0.06, zr + 0.22, TRIM);
    B.box(-hw + 0.02, hw - 0.02, 0.18, 0.34, zf - 0.22, zf + 0.06, TRIM);
    B.tbox(hw - 0.1, hw - 0.3, 0.78, H - 0.04, cb0, cb1, ct0, ct1, GLASS, { side: GLASS, rear: '#4a5670', front: '#3c4760' });
    B.tbox(hw - 0.29, hw - 0.31, H - 0.05, H, ct0 - 0.02, ct1 + 0.02, ct0 + 0.04, ct1 - 0.04, color);
    B.box(-hw + 0.1, hw - 0.1, 0.84, 0.89, zr + 0.04, zr + 0.34, dark); // spoiler
    for (const x of [-0.5, 0.5]) B.box(x - 0.04, x + 0.04, 0.78, 0.84, zr + 0.15, zr + 0.25, TRIM);
    b.head.box(-0.26, 0.26, 0.42, 0.56, zr - 0.08, zr - 0.04, '#6e5a1c');
    mirrors(B, hw, 0.78, cb1 - 0.2, color);
    plate = { y: 0.49, z: zr - 0.08 };
    front = { y: 0.27, z: zf + 0.06 };
    tail = { y: 0.6, h: 0.1 };
    head = { y: 0.52, h: 0.08 };
    lightOpt = { tailW: 0.5, bar: true, headW: 0.4 };
  } else if (type === 'truck') {
    const zr = -L / 2, zf = L / 2;
    const cab = 2.0;
    B.box(-hw, hw, 1.0, H, zr, zf - cab - 0.2, '#d9d6cc', { side: '#c4c0b4', rear: '#bdb8aa' });
    B.box(-hw + 0.1, hw - 0.1, 0.55, 1.0, zr, zf - cab, '#25272c');
    B.tbox(hw - 0.05, hw - 0.15, 0.55, H - 0.6, zf - cab, zf, zf - cab, zf - 0.4, color, { side: shade });
    B.tbox(hw - 0.1, hw - 0.2, 1.8, H - 0.65, zf - 0.4, zf + 0.01, zf - 0.5, zf - 0.38, GLASS);
    B.box(-hw, hw, 0.95, 1.05, zr - 0.1, zr, '#a33a2a'); // ICC bar
    b.head.box(-0.2, 0.2, 0.7, 0.82, zr - 0.08, zr - 0.04, '#6e5a1c');
    tail = { y: 0.95, h: 0.18 };
    head = { y: 0.9, h: 0.16 };
    lightOpt = { tailW: 0.22 };
  } else if (type === 'bus') {
    const zr = -L / 2, zf = L / 2;
    B.box(-hw, hw, 0.45, H, zr, zf, color, { side: shade, rear: dark });
    B.box(-hw - 0.01, hw + 0.01, 1.4, 2.4, zr + 0.6, zf - 0.8, GLASS);
    B.box(-hw + 0.15, hw - 0.15, 1.6, 2.5, zr - 0.02, zr + 0.01, '#2a3142');
    B.box(-hw + 0.1, hw - 0.1, 1.0, 2.7, zf - 0.01, zf + 0.02, GLASS);
    b.head.box(-0.26, 0.26, 0.6, 0.74, zr - 0.06, zr - 0.02, '#6e5a1c');
    tail = { y: 0.8, h: 0.3 };
    head = { y: 0.75, h: 0.16 };
    lightOpt = { tailW: 0.2 };
  }

  // wheels
  const axle = opts.axles ? opts.axles[0] : type === 'bus' ? L / 2 - 2.0 : type === 'truck' ? L / 2 - 1.2 : L / 2 - 0.85;
  const rearAxle = opts.axles ? opts.axles[1] : type === 'bus' ? -L / 2 + 2.6 : type === 'truck' ? -L / 2 + 1.4 : -L / 2 + 0.9;
  let wheelGeo = null;
  if (opts.separateWheels) {
    // wheels as their own meshes (steer + spin); geometry centred on the hub
    wheelGeo = [1, -1].map((side) => {
      const wb = new Builder();
      wb.wheel(side * 0.001, 0, wr, 0.26);
      const g = wb.geometry();
      g.translate(0, -wr, 0);
      return g;
    });
  } else {
    for (const z of [axle, rearAxle]) {
      B.wheel(hw - 0.14, z, wr, 0.26);
      B.wheel(-hw + 0.14, z, wr, 0.26);
    }
  }
  if (type !== 'truck' && type !== 'bus' && !opts.separateWheels) B.box(-0.24, 0.24, front.y - 0.065, front.y + 0.065, front.z - 0.02, front.z + 0.01, '#cfc8ac');
  // dark underbody so the gap reads from behind
  B.box(-hw + 0.15, hw - 0.15, 0.12, 0.32, -L / 2 + 0.3, L / 2 - 0.3, '#0e0f12', { noBottom: true });

  lights(b, L, W, tail.y, tail.h, 0, tailLight, headLight, head.y, head.h, lightOpt);
  return {
    body: b.body.geometry(),
    tail: b.tail.geometry(),
    head: b.head.geometry(),
    L, W, H,
    tailY: tail.y + tail.h / 2,
    tailX: W / 2 - (lightOpt.tailW || 0.38) / 2 - 0.04,
    headY: head.y + head.h / 2,
    headX: W / 2 - 0.25,
    wheelGeo, wr, axle, rearAxle, hw,
    plateY: plate.y, plateZ: plate.z, frontY: front.y, frontZ: front.z,
  };
}

const geoCache = new Map();
const bodyMat = new THREE.MeshLambertMaterial({ vertexColors: true });
const headMat = new THREE.MeshBasicMaterial({ vertexColors: true, color: new THREE.Color(2.2, 2.0, 1.6) });

export function pickType(rnd) {
  const entries = Object.entries(TYPES);
  const total = entries.reduce((a, [, t]) => a + t.weight, 0);
  let r = rnd * total;
  for (const [k, t] of entries) {
    r -= t.weight;
    if (r <= 0) return k;
  }
  return 'sedan';
}

export function makeCar(type, color) {
  const key = type + color;
  let g = geoCache.get(key);
  if (!g) {
    g = build(type, color);
    geoCache.set(key, g);
  }
  const group = new THREE.Group();
  const body = new THREE.Mesh(g.body, bodyMat);
  const tailMat = new THREE.MeshBasicMaterial({ vertexColors: true, color: new THREE.Color(1.6, 1.6, 1.6) });
  const tail = new THREE.Mesh(g.tail, tailMat);
  const head = new THREE.Mesh(g.head, headMat);
  group.add(body, tail, head);
  return { group, tailMat, dims: g, type };
}

// The player's car: same body, but separate wheel meshes positioned by the physics.
// Local frame of the returned group matches the cars above (+Z forward, +X left).
export function makePlayerCar(type, color, axles, plateTex) {
  const g = build(type, color, { separateWheels: true, axles });
  const group = new THREE.Group();
  const tailMat = new THREE.MeshBasicMaterial({ vertexColors: true, color: new THREE.Color(1.6, 1.6, 1.6) });
  group.add(new THREE.Mesh(g.body, bodyMat), new THREE.Mesh(g.tail, tailMat), new THREE.Mesh(g.head, headMat));
  if (plateTex) {
    // custom number plate just behind the plain plate block
    const plate = new THREE.Mesh(new THREE.PlaneGeometry(0.54, 0.15),
      new THREE.MeshBasicMaterial({ map: plateTex, color: new THREE.Color(1.15, 1.15, 1.15) }));
    plate.position.set(0, g.plateY, g.plateZ - 0.012);
    plate.rotation.y = Math.PI;
    group.add(plate);
    // and on the front bumper (on a dark backing block)
    const fb = new THREE.Mesh(new THREE.BoxGeometry(0.56, 0.17, 0.03), new THREE.MeshLambertMaterial({ color: '#1a1b20' }));
    fb.position.set(0, g.frontY, g.frontZ + 0.005);
    const fp = new THREE.Mesh(plate.geometry, plate.material);
    fp.position.set(0, g.frontY, g.frontZ + 0.04);
    group.add(fb, fp);
  }
  // order FL, FR, RL, RR. Mesh +X is left. The pivots are meant to be moved
  // into the physics body frame (+X right), so the hub-cap side is mirrored.
  const wheels = [];
  const spots = [[1, g.axle], [-1, g.axle], [1, g.rearAxle], [-1, g.rearAxle]];
  for (const [side, z] of spots) {
    const pivot = new THREE.Group();
    const spinner = new THREE.Mesh(g.wheelGeo[side > 0 ? 1 : 0], bodyMat);
    pivot.add(spinner);
    pivot.position.set(side * (g.hw - 0.14), g.wr, z);
    group.add(pivot);
    wheels.push({ pivot, spinner, x: side * (g.hw - 0.14), z });
  }
  return { group, tailMat, dims: g, type, wheels };
}

// number plate texture: yellow plate, dark 3x5 pixel font
export function plateTexture(text, fontObj) {
  const c = document.createElement('canvas');
  c.width = 40;
  c.height = 11;
  const g = c.getContext('2d');
  g.fillStyle = '#2a2005';
  g.fillRect(0, 0, 40, 11);
  g.fillStyle = '#e9c94a';
  g.fillRect(1, 1, 38, 9);
  const t = String(text || '').toUpperCase().slice(0, 8);
  const w = fontObj.measure(t);
  fontObj.draw(g, t, Math.floor((40 - w) / 2), 3, 1, '#2a2005');
  const tex = new THREE.CanvasTexture(c);
  tex.magFilter = tex.minFilter = THREE.NearestFilter;
  tex.generateMipmaps = false;
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

export { TYPES };
