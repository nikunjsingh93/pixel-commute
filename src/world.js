// Streams the highway in 64 m chunks: carriageways, median, guard rails,
// (sometimes) retaining walls, sodium lamps, overpasses, signs and the
// roadside of the current district (downtown / suburbs / countryside), plus
// the planner's features (tunnels, harbour bridge, roadworks, toll plazas).
// Every chunk is deterministic from its index.
import * as THREE from 'three';
import { hash, vnoise } from './path.js';
import * as T from './textures.js';
import { font } from './font.js';
import { buildTunnel, buildHarbor, buildWorks, buildToll } from './features.js';
import { ExitNet } from './exits.js';

export const CHUNK = 64;
const DS = 4; // geometry step along the road
export const LANE_W = 3.6;
export const LANES = 4;
export const LANE_D = [1.8, 5.4, 9.0, 12.6]; // our carriageway lane centres
export const OPP_D = [-4.55, -8.15, -11.75]; // oncoming lane centres
export const ROAD_L = -1.35; // our asphalt left edge (median side)
export const ROAD_R = 16.9; // our asphalt right edge
export const OPP_L = -14.2;
const OPP_R = -2.05;
export const WALL_D = 17.6; // right retaining wall foot
export const GUARD_R = 17.35; // right guard rail face (our carriageway)
export const GUARD_L = -14.55; // left guard rail face (oncoming carriageway)
const UPPER_Y = 6.6; // ground level above the right wall
const LAMP_EVERY = 36;
const WALL_LAMP_EVERY = 28;

export class GeoB {
  constructor() {
    this.pos = [];
    this.uv = [];
    this.idx = [];
    this.n = 0;
    this.colors = null; // set by using .col (vertex colours)
    this._col = null;
  }
  set col(c) {
    if (!this.colors) this.colors = [];
    this._col = new THREE.Color(c);
  }
  v(x, y, z, u = 0, w = 0) {
    this.pos.push(x, y, z);
    this.uv.push(u, w);
    if (this.colors) {
      const c = this._col || { r: 1, g: 1, b: 1 };
      this.colors.push(c.r, c.g, c.b);
    }
    return this.n++;
  }
  tri(a, b, c) {
    this.idx.push(a, b, c);
  }
  // quad with outward-facing check against an "inside" point
  quadOut(p, uvs, inside) {
    const [a, b, c] = p;
    const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2];
    const vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2];
    const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    const cx = (a[0] + c[0]) / 2 - inside[0], cy = (a[1] + c[1]) / 2 - inside[1], cz = (a[2] + c[2]) / 2 - inside[2];
    const flip = nx * cx + ny * cy + nz * cz < 0;
    const i = p.map((q, k) => this.v(q[0], q[1], q[2], uvs ? uvs[k][0] : 0, uvs ? uvs[k][1] : 0));
    if (p.length === 3) {
      if (!flip) this.tri(i[0], i[1], i[2]);
      else this.tri(i[0], i[2], i[1]);
      return;
    }
    if (!flip) { this.tri(i[0], i[1], i[2]); this.tri(i[0], i[2], i[3]); }
    else { this.tri(i[0], i[2], i[1]); this.tri(i[0], i[3], i[2]); }
  }
  get empty() {
    return this.n === 0;
  }
  build() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
    if (this.colors) g.setAttribute('color', new THREE.Float32BufferAttribute(this.colors, 3));
    g.setIndex(this.idx);
    g.computeVertexNormals();
    g.computeBoundingSphere();
    return g;
  }
}

// traffic cone: orange body with a white reflective band (vertex colours)
function coneGeometry() {
  const g = new THREE.CylinderGeometry(0.03, 0.17, 0.7, 6, 3);
  g.translate(0, 0.37, 0);
  const base = new THREE.BoxGeometry(0.42, 0.04, 0.42);
  base.translate(0, 0.02, 0);
  const merged = [g, base].map((x) => x.toNonIndexed());
  const pos = [], col = [];
  const orange = new THREE.Color('#ee6a1e'), white = new THREE.Color('#f4f1e8');
  for (const m of merged) {
    const p = m.attributes.position;
    for (let i = 0; i < p.count; i++) {
      const y = p.getY(i);
      const c = y > 0.4 && y < 0.55 ? white : orange;
      pos.push(p.getX(i), y, p.getZ(i));
      col.push(c.r, c.g, c.b);
    }
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  out.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  out.computeVertexNormals();
  return out;
}

const ss = (a, b, x) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

export class World {
  constructor(scene, path, planner) {
    this.scene = scene;
    this.path = path;
    this.planner = planner;
    this.chunks = new Map();
    this.origin = { x: 0, y: 0, z: 0 };
    this.root = new THREE.Group();
    scene.add(this.root);
    this.snow = 0;
    this.wet = 1;
    this.coneGeo = coneGeometry();
    this.nets = new Map(); // exit networks by feature id
    this.makeMaterials();
  }

  makeMaterials() {
    const roadTex = T.roadTexture(ROAD_R - ROAD_L, LANES, LANE_W, -ROAD_L);
    roadTex.repeat.set(1, 1);
    const oppTex = T.roadTexture(OPP_R - OPP_L, 3, LANE_W, 0.7);
    const puddles = T.puddleTexture();
    puddles.repeat.set(3, 0.6);
    const mk = (map) =>
      new THREE.MeshStandardMaterial({ map, roughness: 0.5, metalness: 0.0, roughnessMap: puddles, envMapIntensity: 0.35 });
    this.mRoad = mk(roadTex);
    this.mOpp = mk(oppTex);
    this.mConcrete = new THREE.MeshLambertMaterial({ map: T.concreteTexture('#9a8b74') });
    this.mWall = new THREE.MeshLambertMaterial({ map: T.concreteTexture('#86735c') });
    this.mBridge = new THREE.MeshLambertMaterial({ map: T.concreteTexture('#a29480', false) });
    this.mGround = new THREE.MeshLambertMaterial({ map: T.groundTexture('#4a4a44') });
    this.mGrass = new THREE.MeshLambertMaterial({ map: T.groundTexture('#3b4a36') });
    this.mPave = new THREE.MeshLambertMaterial({ map: T.concreteTexture('#7c7a78') });
    this.mRail = new THREE.MeshLambertMaterial({ color: '#a7aebb' });
    this.mLeaf = new THREE.MeshLambertMaterial({ color: '#2f5a42', flatShading: true });
    this.mTile = new THREE.MeshLambertMaterial({ map: T.tileTexture() });
    this.mColored = new THREE.MeshLambertMaterial({ vertexColors: true });
    this.mWater = new THREE.MeshStandardMaterial({
      color: '#1d2c44', roughness: 0.14, metalness: 0.1, envMapIntensity: 1.1, roughnessMap: puddles,
    });
    this.mBooth = new THREE.MeshLambertMaterial({ color: '#2a3550', emissive: '#ffcf7a', emissiveIntensity: 0.6 });
    this.mExitSign = new THREE.MeshBasicMaterial({ color: new THREE.Color(0.2, 1.6, 0.6) });
    this.mCone = new THREE.MeshLambertMaterial({ vertexColors: true });
    this.mCable = new THREE.LineBasicMaterial({ color: '#6b7280' });
    this.mArm = new THREE.MeshBasicMaterial({ color: new THREE.Color(1.6, 0.35, 0.3) });
    const shop = T.shopTextures();
    this.mShop = new THREE.MeshLambertMaterial({
      map: shop.map, emissiveMap: shop.emissive, emissive: new THREE.Color(1, 1, 1), emissiveIntensity: 1.8,
    });
    const house = T.houseTextures();
    this.mHouse = new THREE.MeshLambertMaterial({
      map: house.map, emissiveMap: house.emissive, emissive: new THREE.Color(1, 1, 1), emissiveIntensity: 1.4,
    });
    this.mRoof = new THREE.MeshLambertMaterial({ color: '#3a2e2c', flatShading: true });
    const boards = [
      [['COLA', 'ICE COLD PIXELS'], '#7a1418', '#ffd27a'],
      [['8 BIT', 'BURGERS 24/7'], '#1d2c55', '#f0c040'],
      [['HOTEL', 'BLUE HOUR INN'], '#23163a', '#9fd0ff'],
      [['FM 88', 'LOFI RADIO'], '#0f3a3a', '#7fe8d0'],
      [['RAMEN', 'NEXT EXIT'], '#3a1a0e', '#ff8a4a'],
    ];
    this.mBoards = boards.map(([lines, bg, fg]) =>
      new THREE.MeshBasicMaterial({ map: T.billboardTexture(lines, bg, fg, font), color: new THREE.Color(1.4, 1.4, 1.4) }));
    this.mMetal = new THREE.MeshLambertMaterial({ color: '#4c5260' });
    this.mDark = new THREE.MeshLambertMaterial({ color: '#2a2c33' });
    this.mLamp = new THREE.MeshBasicMaterial({ color: new THREE.Color(3.2, 2.0, 0.9) });
    const fac = T.facadeTextures();
    this.mBuilding = new THREE.MeshLambertMaterial({
      map: fac.map, emissiveMap: fac.emissive, emissive: new THREE.Color(1, 1, 1), emissiveIntensity: 1.6,
    });
    this.mShadow = new THREE.MeshBasicMaterial({
      color: 0x000000, transparent: true, opacity: 0.24, depthWrite: false,
      polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2,
    });
    const signs = [
      ['5TH', 'EXIT 1/2 KM'], ['DOWNTOWN', 'NEXT RIGHT'], ['HARBOR', 'EXIT 14'],
      ['AIRPORT', '2 KM'], ['8-BIT', 'BLVD'], ['NORTH', 'I-88'], ['MIDTOWN', 'EXIT 21'],
    ];
    this.mSigns = signs.map((s) => new THREE.MeshLambertMaterial({ map: T.signTexture(s, font), emissive: '#203a30', emissiveIntensity: 0.4 }));
    const sign = (lines, bg, fg) => new THREE.MeshLambertMaterial({ map: T.roadSignTexture(lines, bg, fg, font), emissive: '#ffffff', emissiveIntensity: 0.25 });
    this.mWorksSigns = [sign(['ROAD WORK', 'AHEAD'], '#e8a21e', '#14151a'), sign(['RIGHT LANE', 'CLOSED'], '#e8a21e', '#14151a')];
    this.mTollSign = sign(['TOLL PLAZA', '$2  KEEP LANE'], '#1f6a4a', '#e8e8e0');
    this.mTollCanopy = new THREE.MeshBasicMaterial({ map: T.roadSignTexture(['TOLL'], '#1f6a4a', '#e8e8e0', font), color: new THREE.Color(1.3, 1.3, 1.3) });
    this.mArrow = new THREE.MeshBasicMaterial({ map: T.arrowBoardTexture(), color: new THREE.Color(1.8, 1.8, 1.8) });
    const street = T.streetTexture(true), ramp = T.streetTexture(false);
    this.mStreet = new THREE.MeshStandardMaterial({ map: street, roughness: 0.6, roughnessMap: puddles, envMapIntensity: 0.35 });
    this.mRamp = new THREE.MeshStandardMaterial({ map: ramp, roughness: 0.6, roughnessMap: puddles, envMapIntensity: 0.35 });
    this.mCanopy = new THREE.MeshLambertMaterial({ color: '#e8e4da' });
    this.exitSignMats = new Map();
  }

  // green exit sign faces, cached per exit and wording
  exitSign(key, lines) {
    if (!this.exitSignMats.has(key)) {
      this.exitSignMats.set(key, new THREE.MeshLambertMaterial({ map: T.signTexture(lines, font), emissive: '#203a30', emissiveIntensity: 0.5 }));
    }
    return this.exitSignMats.get(key);
  }

  // the exit network covering s (if any)
  netAt(s) {
    for (const n of this.nets.values()) if (s >= n.s0 && s <= n.s1) return n;
    return null;
  }

  setWeather(snow, wet) {
    this.snow = snow;
    this.wet = wet;
    const rough = 0.92 - wet * 0.6;
    this.mRoad.roughness = this.mOpp.roughness = rough;
    this.mStreet.roughness = this.mRamp.roughness = rough;
    // snow cover: tint the (dark) ground textures towards white
    const k = 1 + snow * 2.6;
    this.mGround.color.setRGB(k, k * 1.02, k * 1.08);
    this.mGrass.color.setRGB(1 + snow * 3.2, 1 + snow * 2.9, 1 + snow * 3.4);
    const kp = 1 + snow * 0.9;
    this.mPave.color.setRGB(kp, kp * 1.02, kp * 1.08);
    this.mLeaf.color.set('#2f5a42').lerp(new THREE.Color('#b9c6d6'), snow * 0.35);
    this.mRoof.color.set('#3a2e2c').lerp(new THREE.Color('#dfe6ef'), snow * 0.8);
  }

  setNight(k, time = 0) {
    // k: 0 day .. 1 full night; lamps + windows brighten at night
    this.mLamp.color.setRGB(0.8 + 2.6 * k, 0.55 + 1.6 * k, 0.25 + 0.7 * k);
    this.mBuilding.emissiveIntensity = 0.15 + 1.6 * k;
    this.mShop.emissiveIntensity = 0.3 + 1.8 * k;
    this.mHouse.emissiveIntensity = 0.1 + 1.4 * k;
    this.mBooth.emissiveIntensity = 0.3 + 0.8 * k;
    for (const m of this.mBoards) m.color.setScalar(0.75 + 0.75 * k);
    const on = Math.floor(time * 1.6) % 2 === 0; // roadworks arrow board flashes
    this.mArrow.color.setScalar(on ? 1.8 : 0.15);
  }

  // ---------------------------------------------------------------- geometry helpers
  // extrude a cross-section profile [[d, y], ...] from s0 to s1
  strip(geo, prof, s0, s1, a, uv = { mode: 'world', tile: 4 }) {
    // prof: [[d, y(, u)], ...] or a function s -> such a list (same length)
    if (s1 - s0 < 0.05) return;
    const f = {};
    const steps = Math.max(1, Math.round((s1 - s0) / DS));
    const ds = (s1 - s0) / steps;
    const vOff = (((s0 % uv.tile) + uv.tile) % uv.tile) / uv.tile;
    let prevRow = null;
    for (let j = 0; j <= steps; j++) {
      const s = s0 + j * ds;
      const P = typeof prof === 'function' ? prof(s) : prof;
      this.path.sample(s, f);
      const vv = vOff + (s - s0) / uv.tile;
      const row = [];
      let len = 0;
      for (let k = 0; k < P.length - 1; k++) {
        const pa = P[k], pb = P[k + 1];
        const seg = Math.hypot(pb[0] - pa[0], pb[1] - pa[1]);
        const ua = uv.mode === 'road' ? pa[2] : len / uv.tile;
        const ub = uv.mode === 'road' ? pb[2] : (len + seg) / uv.tile;
        len += seg;
        const A = geo.v(f.x + f.rx * pa[0] - a.x, f.y + pa[1] - a.y, f.z + f.rz * pa[0] - a.z, ua, vv);
        const B = geo.v(f.x + f.rx * pb[0] - a.x, f.y + pb[1] - a.y, f.z + f.rz * pb[0] - a.z, ub, vv);
        if (prevRow) {
          const [pA, pB] = prevRow[k];
          geo.tri(pA, pB, A);
          geo.tri(pB, B, A);
        }
        row.push([A, B]);
      }
      prevRow = row;
    }
  }

  // oriented box in the road frame at s. along = length in s, across = in d
  obox(geo, s, d, y0, along, across, h, a, yaw = 0, uvScale = 0) {
    const f = this.path.sample(s, {});
    const c = Math.cos(yaw), sn = Math.sin(yaw);
    const fx = f.fx * c + f.rx * sn, fz = f.fz * c + f.rz * sn;
    const rx = f.rx * c - f.fx * sn, rz = f.rz * c - f.fz * sn;
    const cx = f.x + f.rx * d - a.x, cz = f.z + f.rz * d - a.z, cy = f.y - a.y + y0;
    const P = (i, j, k) => [
      cx + fx * along * 0.5 * i + rx * across * 0.5 * j,
      cy + h * k,
      cz + fz * along * 0.5 * i + rz * across * 0.5 * j,
    ];
    const inside = [cx, cy + h / 2, cz];
    const faces = [
      [P(-1, -1, 0), P(1, -1, 0), P(1, -1, 1), P(-1, -1, 1)],
      [P(-1, 1, 0), P(1, 1, 0), P(1, 1, 1), P(-1, 1, 1)],
      [P(-1, -1, 0), P(-1, 1, 0), P(-1, 1, 1), P(-1, -1, 1)],
      [P(1, -1, 0), P(1, 1, 0), P(1, 1, 1), P(1, -1, 1)],
      [P(-1, -1, 1), P(1, -1, 1), P(1, 1, 1), P(-1, 1, 1)],
      [P(-1, -1, 0), P(1, -1, 0), P(1, 1, 0), P(-1, 1, 0)],
    ];
    const dims = [[along, h], [along, h], [across, h], [across, h], [along, across], [along, across]];
    faces.forEach((q, i) => {
      let uvs = null;
      if (uvScale) {
        const [w, hh] = dims[i];
        uvs = [[0, 0], [w * uvScale, 0], [w * uvScale, hh * uvScale], [0, hh * uvScale]];
      }
      geo.quadOut(q, uvs, inside);
    });
  }

  // gable roof (ridge along s) on a box of size along x across at height y0
  roof(geo, s, d, y0, along, across, rh, a) {
    const f = this.path.sample(s, {});
    const cx = f.x + f.rx * d - a.x, cz = f.z + f.rz * d - a.z, cy = f.y + y0 - a.y;
    const P = (i, j, k) => [cx + f.fx * along * 0.5 * i + f.rx * across * 0.5 * j, cy + rh * k, cz + f.fz * along * 0.5 * i + f.rz * across * 0.5 * j];
    const inside = [cx, cy + rh * 0.3, cz];
    geo.quadOut([P(-1, -1.06, 0), P(1, -1.06, 0), P(1, 0, 1), P(-1, 0, 1)], null, inside);
    geo.quadOut([P(-1, 1.06, 0), P(1, 1.06, 0), P(1, 0, 1), P(-1, 0, 1)], null, inside);
    geo.quadOut([P(-1, -1, 0), P(-1, 1, 0), P(-1, 0, 1)], null, inside);
    geo.quadOut([P(1, -1, 0), P(1, 1, 0), P(1, 0, 1)], null, inside);
  }

  // ---------------------------------------------------------------- chunks
  update(camS, all = false) {
    const i0 = Math.floor((camS - 90) / CHUNK);
    const i1 = Math.floor((camS + 680) / CHUNK);
    for (const [i, ch] of this.chunks) {
      if (i < i0 || i > i1) {
        this.root.remove(ch.group);
        ch.group.traverse((o) => o.geometry && o.geometry !== this.coneGeo && !o.userData.shared && o.geometry.dispose());
        this.chunks.delete(i);
      }
    }
    // exit networks: built as they come into view, dropped once passed
    for (const f of this.planner.range(camS - 300, camS + 900, 'exit')) {
      if (!this.nets.has(f.id)) {
        const net = new ExitNet(this, f);
        net.build(this.root, {
          ground: this.mGround, pave: this.mPave, street: this.mStreet, ramp: this.mRamp, concrete: this.mConcrete,
          rail: this.mRail, dark: this.mDark, metal: this.mMetal, lamp: this.mLamp, building: this.mBuilding, shop: this.mShop,
          colored: this.mColored, leaf: this.mLeaf, canopy: this.mCanopy,
        }, GeoB);
        this.nets.set(f.id, net);
        if (!all) return; // one heavy build per frame
      }
    }
    for (const [id, net] of this.nets) {
      if (net.s1 < camS - 300 || net.s0 > camS + 1000) {
        net.dispose(this.root);
        this.nets.delete(id);
      }
    }
    // build at most one chunk per frame (everything when asked) to avoid hitches
    let built = 0;
    for (let i = i0; i <= i1; i++) {
      if (!this.chunks.has(i)) {
        this.chunks.set(i, this.buildChunk(i));
        if (++built >= 1 && !all) break;
      }
    }
  }

  rebase(dx, dy, dz) {
    this.origin.x += dx;
    this.origin.y += dy;
    this.origin.z += dz;
    for (const ch of this.chunks.values()) {
      ch.group.position.set(ch.anchor.x - this.origin.x, ch.anchor.y - this.origin.y, ch.anchor.z - this.origin.z);
    }
    for (const n of this.nets.values()) n.rebase(this.origin);
  }

  // height of the right-hand retaining wall at s: mostly 0 (open city with a
  // guard rail), sometimes the road dips into a walled cutting. Features keep
  // the roadside open.
  wallH(s) {
    const n = vnoise(s / 650, this.path.seed + 21);
    const t = Math.min(1, Math.max(0, (n - 0.4) / 0.28));
    return UPPER_Y * t * t * (3 - 2 * t) * (1 - this.planner.mask(s, 140));
  }

  // how far the pavement reaches on each side (0 = countryside verge)
  paveR(dist) {
    return WALL_D + 1.3 + dist.town * (6.4 + dist.downtown * 5.3);
  }
  paveL(dist) {
    return -15.3 - dist.town * (6 + dist.downtown * 6.7);
  }

  // steel W-beam guard rail along d. side = which way the traffic is (-1: road
  // on the left of the rail, +1: road on the right)
  guardRail(geo, s0, s1, d, side, a) {
    const y0 = 0.5, y1 = 0.82, base = 0.16, t = 0.09;
    const back = d - side * t;
    if (side < 0) {
      this.strip(geo.rail, [[d, y0], [d, y1]], s0, s1, a);
      this.strip(geo.rail, [[back, y1], [back, y0]], s0, s1, a);
      this.strip(geo.rail, [[d, y1], [back, y1]], s0, s1, a);
    } else {
      this.strip(geo.rail, [[d, y1], [d, y0]], s0, s1, a);
      this.strip(geo.rail, [[back, y0], [back, y1]], s0, s1, a);
      this.strip(geo.rail, [[back, y1], [d, y1]], s0, s1, a);
    }
    for (let s = Math.ceil(s0 / 2) * 2; s < s1; s += 2) {
      this.obox(geo.dark, s, back - side * 0.08, base, 0.12, 0.12, y1 - base - 0.02, a);
    }
  }

  // city street light on a pavement: pole at d, arm reaching toward the road
  cityLamp(geo, s, d, toward, base, a, glows, lights) {
    this.obox(geo.metal, s, d, base, 0.16, 0.16, 7.3, a);
    this.obox(geo.metal, s, d + toward * 0.75, base + 7.2, 0.1, 1.6, 0.1, a);
    const hd = d + toward * 1.45;
    this.obox(geo.metal, s, hd, base + 6.98, 0.4, 0.6, 0.18, a);
    this.obox(geo.lamp, s, hd, base + 6.9, 0.3, 0.45, 0.08, a);
    const p = this.path.point(s, hd, base + 6.85);
    glows.push({ x: p.x, y: p.y, z: p.z, r: 1.0, g: 0.68, b: 0.32, size: 1.1, h: 6.85 + base, lamp: 1 });
    lights.push({ x: p.x, y: p.y - 0.3, z: p.z, r: 1.0, g: 0.64, b: 0.32, power: 0.55 });
  }

  // low-poly cone (apex up, or down when h < 0) centred at p (chunk-local)
  cone(geo, p, r, h, n, rot) {
    const ring = [];
    for (let i = 0; i < n; i++) {
      const t = rot + (i / n) * Math.PI * 2;
      ring.push([p[0] + Math.cos(t) * r, p[1], p[2] + Math.sin(t) * r]);
    }
    const apex = [p[0], p[1] + h, p[2]];
    for (let i = 0; i < n; i++) {
      const A = ring[i], B = ring[(i + 1) % n];
      const ia = geo.v(...A), ib = geo.v(...B), ic = geo.v(...apex);
      if (h > 0) geo.tri(ia, ic, ib);
      else geo.tri(ia, ib, ic);
    }
  }

  // low-poly pine: three stacked cones on a short trunk
  tree(geo, s, d, base, a, r) {
    const k = 0.85 + r * 0.45;
    const p = this.path.point(s, d, base);
    const c = [p.x - a.x, p.y - a.y, p.z - a.z];
    const rot = r * 6;
    this.obox(geo.dark, s, d, base, 0.24, 0.24, 1.6 * k, a);
    const slim = 0.8 + ((r * 7.3) % 1) * 0.35;
    this.cone(geo.leaf, [c[0], c[1] + 1.0 * k, c[2]], 1.6 * k * slim, 2.6 * k, 7, rot);
    this.cone(geo.leaf, [c[0], c[1] + 2.3 * k, c[2]], 1.2 * k * slim, 2.3 * k, 7, rot + 0.4);
    this.cone(geo.leaf, [c[0], c[1] + 3.5 * k, c[2]], 0.75 * k * slim, 1.8 * k, 7, rot + 0.8);
  }

  // ---------------------------------------------------------------- the chunk
  buildChunk(ci) {
    const s0 = ci * CHUNK;
    const s1 = s0 + CHUNK;
    const R = (k) => hash(ci * 13.37 + k * 7.71 + 0.5);
    const a = this.path.sample(s0, {});
    const anchor = { x: a.x, y: a.y, z: a.z };
    const geo = {
      road: new GeoB(), opp: new GeoB(), concrete: new GeoB(), wall: new GeoB(), bridge: new GeoB(),
      ground: new GeoB(), grass: new GeoB(), pave: new GeoB(), metal: new GeoB(), rail: new GeoB(), dark: new GeoB(),
      lamp: new GeoB(), building: new GeoB(), shop: new GeoB(), leaf: new GeoB(), shadow: new GeoB(),
      tile: new GeoB(), water: new GeoB(), colored: new GeoB(), booth: new GeoB(), exitSign: new GeoB(),
      house: new GeoB(), roof: new GeoB(),
    };
    geo.colored.col = '#888888';
    const c = {
      geo, a: anchor, s0, s1, glows: [], lights: [], signs: [], boards: [], obstacles: [], cones: [],
      meshes: [], lines: [], arms: [],
    };
    const { glows, lights, signs, boards } = c;
    const P = this.planner;
    const feats = P.range(s0 - 420, s1 + 20);
    // land = the parts of this chunk not covered by a tunnel or the harbour
    const holes = feats.filter((f) => f.type === 'tunnel' || f.type === 'harbor');
    const isLand = (s) => !holes.some((f) => s >= f.s0 && s <= f.s1);
    const inTunnel = (s) => feats.some((f) => f.type === 'tunnel' && s >= f.s0 && s <= f.s1);
    let land = [[s0, s1]];
    for (const f of holes) {
      const next = [];
      for (const [x0, x1] of land) {
        if (f.s1 <= x0 || f.s0 >= x1) next.push([x0, x1]);
        else {
          if (f.s0 > x0) next.push([x0, f.s0]);
          if (f.s1 < x1) next.push([f.s1, x1]);
        }
      }
      land = next;
    }
    // the right-hand roadside of an exit zone is built by its ExitNet
    const exits = feats.filter((f) => f.type === 'exit');
    const inExit = (s) => exits.some((f) => s >= f.s0 - 6 && s <= f.s1 + 6);
    const cutR = (ranges) => {
      let out = ranges;
      for (const f of exits) {
        const next = [];
        for (const [x0, x1] of out) {
          const e0 = f.s0 - 6, e1 = f.s1 + 6;
          if (e1 <= x0 || e0 >= x1) next.push([x0, x1]);
          else {
            if (e0 > x0) next.push([x0, e0]);
            if (e1 < x1) next.push([e1, x1]);
          }
        }
        out = next;
      }
      return out;
    };
    const landR = cutR(land);
    const dist = P.district(s0 + CHUNK / 2);
    const distAt = (s) => P.district(s);
    const wallMax = Math.max(this.wallH(s0), this.wallH(s0 + CHUNK / 2), this.wallH(s1));
    const hh = (s) => Math.max(this.wallH(s), 0.16); // right-hand ground level

    // overpass position (decided first so the city leaves room for it)
    let bridgeS = ci > 2 && (ci % 5 === 2 || (ci % 7 === 4 && R(1) < 0.6)) ? s0 + 30 + R(2) * 8 : null;
    if (bridgeS !== null && (P.mask(bridgeS, 90) > 0 || P.at(bridgeS, 'works', 30))) bridgeS = null;
    const nearBridge = (s, pad) => bridgeS !== null && Math.abs(s - bridgeS) < pad;

    // carriageways + median: everywhere (also through tunnels and over the water)
    this.strip(geo.road, [[ROAD_L, 0, 0], [ROAD_R, 0, 1]], s0, s1, anchor, { mode: 'road', tile: 12 });
    this.strip(geo.opp, [[OPP_L, 0, 1], [OPP_R, 0, 0]], s0, s1, anchor, { mode: 'road', tile: 12 });
    this.strip(geo.concrete, [[-2.05, 0], [-1.95, 0.28], [-1.8, 0.92], [-1.6, 0.92], [-1.45, 0.28], [-1.35, 0]], s0, s1, anchor);
    for (let s = Math.ceil(s0 / 4) * 4; s < s1; s += 4) this.obox(geo.metal, s, -1.7, 0.92, 0.08, 0.08, 0.3, anchor);
    this.strip(geo.metal, [[-1.75, 1.22], [-1.65, 1.22]], s0, s1, anchor);
    // median sodium lamps (double-armed), not inside tunnels; half as many in the countryside
    for (let s = Math.ceil(s0 / LAMP_EVERY) * LAMP_EVERY; s < s1; s += LAMP_EVERY) {
      if (inTunnel(s) || (distAt(s).town < 0.3 && Math.round(s / LAMP_EVERY) % 2)) continue;
      this.obox(geo.metal, s, -1.7, 0.9, 0.22, 0.22, 9.4, anchor);
      this.obox(geo.metal, s, -1.7, 10.0, 0.14, 5.6, 0.14, anchor);
      for (const side of [1, -1]) {
        const d = -1.7 + side * 2.6;
        this.obox(geo.metal, s, d, 9.85, 0.45, 0.9, 0.22, anchor);
        this.obox(geo.lamp, s, d, 9.75, 0.35, 0.75, 0.1, anchor);
        const p = this.path.point(s, d, 9.7);
        glows.push({ x: p.x, y: p.y, z: p.z, r: 1.0, g: 0.62, b: 0.25, size: 1.6, h: 9.7, lamp: 1 });
        lights.push({ x: p.x, y: p.y - 0.3, z: p.z, r: 1.0, g: 0.6, b: 0.28, power: 1 });
      }
    }

    // ---- the roadside on land
    for (const [x0, x1] of landR) {
      // right: curb, verge, guard rail, (sometimes) a retaining wall, pavement, then city or fields
      this.strip(geo.concrete, [[ROAD_R, 0], [ROAD_R, 0.16], [WALL_D, 0.16]], x0, x1, anchor);
      this.guardRail(geo, x0, x1, GUARD_R, -1, anchor);
      if (wallMax > 0.05) {
        this.strip(geo.wall, (s) => {
          const h = hh(s);
          return [[WALL_D, 0.16], [WALL_D + 0.55 * (h / UPPER_Y), h], [WALL_D + 1.3, h]];
        }, x0, x1, anchor, { mode: 'world', tile: 4 });
        this.strip(geo.concrete, (s) => {
          const h = hh(s), k = Math.min(1, Math.max(0, (h - 1) / 1.5));
          return [[WALL_D + 1.3, h], [WALL_D + 1.3, h + 0.25 * k], [WALL_D + 1.7, h + 0.25 * k], [WALL_D + 1.7, h]];
        }, x0, x1, anchor);
        const railY = (s, y) => {
          const h = hh(s), k = Math.min(1, Math.max(0, (h - 1) / 1.5));
          return h + (y + 0.3) * k - 0.3;
        };
        this.strip(geo.metal, (s) => [[WALL_D + 1.45, railY(s, 1.15)], [WALL_D + 1.55, railY(s, 1.15)]], x0, x1, anchor);
        this.strip(geo.metal, (s) => [[WALL_D + 1.45, railY(s, 0.7)], [WALL_D + 1.55, railY(s, 0.7)]], x0, x1, anchor);
        this.strip(geo.metal, (s) => [[WALL_D + 1.45, railY(s, 1.05)], [WALL_D + 1.45, railY(s, 1.18)]], x0, x1, anchor);
        for (let s = Math.ceil(x0 / 2.5) * 2.5; s < x1; s += 2.5) {
          if (hh(s) > 2) this.obox(geo.metal, s, WALL_D + 1.5, hh(s) + 0.25, 0.1, 0.1, 0.95, anchor);
        }
      }
      // pavement width follows the district; the countryside gets rolling fields
      const hill = (s, k) => (1 - distAt(s).town) * (0.55 + 0.45 * vnoise(s / 260 + k, this.path.seed + 51));
      this.strip(geo.pave, (s) => [[WALL_D + 1.3, hh(s)], [Math.max(WALL_D + 1.31, this.paveR(distAt(s))), hh(s)]], x0, x1, anchor, { mode: 'world', tile: 4 });
      const gR = dist.town > 0.5 ? geo.ground : geo.grass;
      this.strip(gR, (s) => {
        const pe = Math.max(WALL_D + 1.31, this.paveR(distAt(s))), h = hh(s);
        return [[pe, h], [pe + 35, h + 0.8 * hill(s, 0)], [pe + 85, h + 5 * hill(s, 3)], [WALL_D + 160, h + 16 * hill(s, 7) + 1.2]];
      }, x0, x1, anchor, { mode: 'world', tile: 6 });
    }
    for (const [x0, x1] of land) {
      const hill = (s, k) => (1 - distAt(s).town) * (0.55 + 0.45 * vnoise(s / 260 + k, this.path.seed + 51));
      // left (beyond the oncoming lanes)
      this.strip(geo.concrete, [[-15.3, 0.16], [OPP_L, 0.16], [OPP_L, 0]], x0, x1, anchor);
      this.guardRail(geo, x0, x1, GUARD_L, 1, anchor);
      this.strip(geo.pave, (s) => [[Math.min(-15.31, this.paveL(distAt(s))), 0.16], [-15.3, 0.16]], x0, x1, anchor, { mode: 'world', tile: 4 });
      const gL = dist.town > 0.5 ? geo.ground : geo.grass;
      this.strip(gL, (s) => {
        const pe = Math.min(-15.31, this.paveL(distAt(s)));
        return [[-175, 16 * hill(s, 11) + 1.2], [pe - 85, 5 * hill(s, 13)], [pe - 35, 0.8 * hill(s, 17)], [pe, 0.16]];
      }, x0, x1, anchor, { mode: 'world', tile: 6 });
    }

    // warm lamps on the retaining wall where it is tall
    for (let s = Math.ceil(s0 / WALL_LAMP_EVERY) * WALL_LAMP_EVERY + 14; s < s1; s += WALL_LAMP_EVERY) {
      if (this.wallH(s) < 5.5 || !isLand(s) || inExit(s)) continue;
      const d = WALL_D + 0.22;
      this.obox(geo.dark, s, d, 3.15, 0.5, 0.25, 0.5, anchor);
      this.obox(geo.lamp, s, d - 0.13, 3.2, 0.36, 0.05, 0.36, anchor);
      const p = this.path.point(s, d - 0.4, 3.4);
      glows.push({ x: p.x, y: p.y, z: p.z, r: 1.0, g: 0.7, b: 0.35, size: 0.9, h: 3.4, lamp: 1 });
      lights.push({ x: p.x, y: p.y, z: p.z, r: 1.0, g: 0.62, b: 0.3, power: 0.3 });
    }
    // street lights on the pavements (towns only)
    for (let s = Math.ceil((s0 - 16) / 32) * 32 + 16; s < s1; s += 32) {
      if (s < s0 || !isLand(s) || P.mask(s, 20) > 0.5) continue;
      if (distAt(s).town > 0.4 && !inExit(s)) this.cityLamp(geo, s, WALL_D + 2.6, -1, hh(s), anchor, glows, lights);
      if (isLand(s + 8) && distAt(s + 8).town > 0.4) this.cityLamp(geo, s + 8, -16.4, 1, 0.16, anchor, glows, lights);
    }
    // trees: a few along town pavements, forests in the countryside
    for (let s = s0 + 2 + R(3) * 3, k = 0; s < s1; s += 4 + R(10 + k) * 5, k++) {
      if (nearBridge(s, 9) || !isLand(s) || (P.mask(s, 30) > 0.5 && !inExit(s))) continue;
      const dd = distAt(s);
      const forest = 1 - dd.town;
      if (R(20 + k) < 0.4 + forest * 0.6) {
        if (forest > 0.5) {
          const n = 2 + Math.floor(R(30 + k) * 4);
          for (let j = 0; j < n; j++) {
            const side = R(40 + k * 5 + j) < 0.5 && !inExit(s) ? 1 : -1;
            const d = side > 0 ? 22 + R(50 + k * 5 + j) * 70 : -(20 + R(60 + k * 5 + j) * 70);
            const hill = 0.55 + 0.45 * vnoise(s / 260, this.path.seed + 51);
            const base = side > 0 ? hh(s) + (d > 50 ? hill * 0.8 * (d - 50) / 35 : 0) : 0.16;
            this.tree(geo, s + R(70 + j) * 3, d, base, anchor, R(80 + k + j));
          }
        } else if (R(90 + k) < 0.55) {
          if (!inExit(s)) this.tree(geo, s, this.paveR(dd) - 2.2, hh(s), anchor, R(50 + k));
          if (R(95 + k) < 0.5) this.tree(geo, s + 3, this.paveL(dd) + 2.2, 0.16, anchor, R(51 + k));
        }
      }
    }

    if (bridgeS !== null) this.buildBridge(geo, bridgeS, anchor, glows, lights);

    // overhead sign gantry on the right
    if (ci % 9 === 5 && !nearBridge(s0 + 20, 20) && P.mask(s0 + 20, 80) === 0) {
      const s = s0 + 20;
      this.obox(geo.metal, s, GUARD_R + 0.6, 0.16, 0.3, 0.3, 7.6, anchor);
      this.obox(geo.metal, s, 11.8, 7.0, 0.2, 11.8, 0.25, anchor);
      this.obox(geo.dark, s + 0.12, 11.6, 5.3, 0.12, 5.2, 2.6, anchor);
      signs.push({ s: s - 0.02, d: 11.6, y: 5.3, w: 5.2, h: 2.6, mat: this.mSigns[ci % this.mSigns.length] });
    }
    // exit signs: 1 km gantry, 250 m gantry, and the gore sign at the split
    for (const f of P.range(s0, s1 + 1100, 'exit')) {
      for (const [ds, lines, key] of [[-900, [f.name, `EXIT ${f.no}  1 KM`], 'km'], [-250, [f.name, `EXIT ${f.no}  >`], 'go']]) {
        const s = f.s0 + ds;
        if (s < s0 || s >= s1 || P.mask(s, 30) > 0 && !P.at(s, 'exit', 0)) continue;
        this.obox(geo.metal, s, GUARD_R + 0.6, 0.16, 0.3, 0.3, 7.6, anchor);
        this.obox(geo.metal, s, 11.8, 7.0, 0.2, 11.8, 0.25, anchor);
        this.obox(geo.dark, s + 0.12, 12.6, 5.3, 0.12, 5.6, 2.8, anchor);
        signs.push({ s: s - 0.02, d: 12.6, y: 5.3, w: 5.6, h: 2.8, mat: this.exitSign(f.no + key, lines) });
      }
      const sg = f.s0 + 96;
      if (sg >= s0 && sg < s1) {
        this.obox(geo.metal, sg, 19.6, 0.02, 0.15, 0.15, 2.4, anchor);
        signs.push({ s: sg - 0.05, d: 19.6, y: 2.3, w: 2.2, h: 1.1, mat: this.exitSign(f.no + 'g', [`EXIT ${f.no}`, '>']) });
      }
    }
    // roadside billboard (lit)
    if (R(5) < 0.4 && !nearBridge(s0 + 34, 26) && isLand(s0 + 34) && P.mask(s0 + 34, 60) === 0) {
      const side = R(6) < 0.6 ? 1 : -1;
      const s = s0 + 34;
      const d = side > 0 ? WALL_D + 9 : -24;
      const base = side > 0 ? hh(s) : 0.16;
      for (const off of [-2.6, 2.6]) this.obox(geo.metal, s + off * 0.3, d + off, base, 0.3, 0.3, 9.2, anchor);
      boards.push({ s, d, y: base + 9, side, w: 8, h: 3, mat: this.mBoards[(ci * 7) % this.mBoards.length] });
    }

    // the city / suburbs / farms beside the road
    this.buildBlocks(c, ci, isLand, bridgeS);

    // planner features
    for (const f of feats) {
      if (f.type === 'tunnel') buildTunnel(this, f, c);
      else if (f.type === 'harbor') buildHarbor(this, f, c);
      else if (f.type === 'works') buildWorks(this, f, c);
      else if (f.type === 'toll') buildToll(this, f, c);
    }

    return this.assemble(c, ci);
  }

  assemble(c, ci) {
    const { geo, a: anchor, signs, boards } = c;
    const group = new THREE.Group();
    const add = (g, mat) => {
      if (g.empty) return;
      const m = new THREE.Mesh(g.build(), mat);
      group.add(m);
      return m;
    };
    add(geo.road, this.mRoad);
    add(geo.opp, this.mOpp);
    add(geo.concrete, this.mConcrete);
    add(geo.wall, this.mWall);
    add(geo.bridge, this.mBridge);
    add(geo.ground, this.mGround);
    add(geo.grass, this.mGrass);
    add(geo.pave, this.mPave);
    add(geo.metal, this.mMetal);
    add(geo.rail, this.mRail);
    add(geo.dark, this.mDark);
    add(geo.lamp, this.mLamp);
    add(geo.building, this.mBuilding);
    add(geo.shop, this.mShop);
    add(geo.house, this.mHouse);
    add(geo.roof, this.mRoof);
    add(geo.leaf, this.mLeaf);
    add(geo.tile, this.mTile);
    add(geo.water, this.mWater);
    add(geo.colored, this.mColored);
    add(geo.booth, this.mBooth);
    add(geo.exitSign, this.mExitSign);
    const sh = add(geo.shadow, this.mShadow);
    if (sh) sh.renderOrder = 1;
    const plane = this.signGeo || (this.signGeo = new THREE.PlaneGeometry(1, 1));
    for (const sg of signs) {
      const f = this.path.sample(sg.s, {});
      const pl = new THREE.Mesh(plane, sg.mat);
      pl.userData.shared = true;
      pl.scale.set(sg.w, sg.h, 1);
      pl.position.set(f.x + f.rx * sg.d - anchor.x, f.y + sg.y + sg.h / 2 - anchor.y, f.z + f.rz * sg.d - anchor.z);
      const dir = sg.back ? 1 : -1; // faces approaching traffic unless back
      pl.lookAt(pl.position.x + dir * f.fx, pl.position.y, pl.position.z + dir * f.fz);
      group.add(pl);
    }
    for (const b of boards) {
      const f = this.path.sample(b.s, {});
      const pl = new THREE.Mesh(plane, b.mat);
      pl.userData.shared = true;
      pl.scale.set(b.w, b.h, 1);
      pl.position.set(f.x + f.rx * b.d - anchor.x, f.y + b.y + b.h / 2 - anchor.y, f.z + f.rz * b.d - anchor.z);
      if (b.face === 'back') {
        pl.lookAt(pl.position.x - f.fx, pl.position.y, pl.position.z - f.fz);
      } else {
        // panel angled toward approaching traffic
        const yaw = 0.45;
        const nx = -f.fx * Math.cos(yaw) - b.side * f.rx * Math.sin(yaw);
        const nz = -f.fz * Math.cos(yaw) - b.side * f.rz * Math.sin(yaw);
        pl.lookAt(pl.position.x + nx, pl.position.y, pl.position.z + nz);
        const backing = new THREE.Mesh(this.boardBack || (this.boardBack = new THREE.BoxGeometry(8.3, 3.3, 0.25)), this.mDark);
        backing.userData.shared = true;
        backing.position.copy(pl.position);
        backing.quaternion.copy(pl.quaternion);
        backing.translateZ(-0.16);
        group.add(backing);
      }
      group.add(pl);
    }
    // knockable cones: one instanced mesh per chunk
    let coneMesh = null;
    if (c.cones.length) {
      coneMesh = new THREE.InstancedMesh(this.coneGeo, this.mCone, c.cones.length);
      const m = new THREE.Matrix4();
      c.cones.forEach((k, i) => {
        const p = this.path.point(k.s, k.d, 0);
        m.makeTranslation(p.x - anchor.x, p.y - anchor.y, p.z - anchor.z);
        coneMesh.setMatrixAt(i, m);
        k.i = i;
      });
      group.add(coneMesh);
    }
    // stay cables
    if (c.lines.length) {
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(c.lines, 3));
      group.add(new THREE.LineSegments(g, this.mCable));
    }
    // toll barrier arms (animated by main through chunk.arms)
    for (const arm of c.arms) {
      const f = this.path.sample(arm.s, {});
      const pivot = new THREE.Group();
      pivot.position.set(f.x + f.rx * arm.d - anchor.x, f.y + 1.0 - anchor.y, f.z + f.rz * arm.d - anchor.z);
      pivot.rotation.y = f.h;
      const bar = new THREE.Mesh(this.armGeo || (this.armGeo = new THREE.BoxGeometry(1, 0.1, 0.1)), this.mArm);
      bar.userData.shared = true;
      bar.scale.x = arm.len;
      // the bar reaches toward +d (road right) from the pivot: local -X is right
      bar.position.x = -arm.len / 2;
      pivot.add(bar);
      group.add(pivot);
      arm.pivot = pivot;
      arm.lift = 0;
    }
    for (const m of c.meshes) group.add(m);
    group.position.set(anchor.x - this.origin.x, anchor.y - this.origin.y, anchor.z - this.origin.z);
    this.root.add(group);
    return {
      group, anchor, glows: c.glows, lights: c.lights, s0: c.s0, obstacles: c.obstacles, cones: c.cones, coneMesh, arms: c.arms, ci,
    };
  }

  buildBridge(geo, sb, a, glows, lights) {
    const y0 = UPPER_Y - 0.2; // deck soffit
    const thick = 1.3;
    const width = 13; // along the road
    const d0 = -60, d1 = 60;
    const len = d1 - d0;
    const dc = (d0 + d1) / 2;
    this.obox(geo.bridge, sb, dc, y0, width, len, thick, a, 0, 0.25);
    this.obox(geo.bridge, sb - width / 2 + 0.25, dc, y0 + thick, 0.5, len, 0.9, a, 0, 0.25);
    this.obox(geo.bridge, sb + width / 2 - 0.25, dc, y0 + thick, 0.5, len, 0.9, a, 0, 0.25);
    for (let d = d0 + 1; d < d1; d += 2.5) {
      this.obox(geo.metal, sb - width / 2 + 0.25, d, y0 + thick + 0.9, 0.08, 0.08, 0.8, a);
    }
    this.obox(geo.metal, sb - width / 2 + 0.25, dc, y0 + thick + 1.65, 0.1, len, 0.1, a);
    for (const off of [-4, 0, 4]) this.obox(geo.dark, sb + off, dc, y0 - 0.45, 0.9, len, 0.45, a);
    this.obox(geo.bridge, sb, -1.7, 0.9, 6, 0.9, y0 - 1.35, a, 0, 0.25);
    this.obox(geo.bridge, sb, -17.6, 0, 7, 1.4, y0, a, 0, 0.25);
    this.obox(geo.bridge, sb, WALL_D + 3.6, 0, 7, 1.4, y0, a, 0, 0.25);
    this.obox(geo.bridge, sb, 47, -0.5, width + 1, 26, y0 + thick + 0.5, a, 0, 0.25);
    this.obox(geo.bridge, sb, -47, -0.5, width + 1, 26, y0 + thick + 0.5, a, 0, 0.25);
    for (const d of [3.5, 10.5, -7.5]) {
      this.obox(geo.lamp, sb + width / 2 - 1.0, d, y0 - 0.55, 0.3, 1.2, 0.08, a);
      const p = this.path.point(sb + width / 2 - 1.0, d, y0 - 0.6);
      glows.push({ x: p.x, y: p.y, z: p.z, r: 1.0, g: 0.72, b: 0.38, size: 0.9, h: 5.8, lamp: 1 });
    }
    const p = this.path.point(sb, 7, y0 - 0.8);
    lights.push({ x: p.x, y: p.y, z: p.z, r: 1.0, g: 0.66, b: 0.34, power: 0.8 });
    for (let k = 0; k < 3; k++) {
      const half = width / 2 + 0.5 + k * 1.8;
      this.strip(geo.shadow, [[OPP_L - 2, 0.03], [WALL_D + 0.6, 0.03]], sb - half, sb + half, a);
    }
  }

  // the roadside: downtown shop rows + towers, suburban houses, farms
  buildBlocks(c, ci, isLand, bridgeS) {
    const { geo, a, glows, s0 } = c;
    const R = (k) => hash(ci * 31.7 + k * 3.13 + 9.1);
    const P = this.planner;
    let k = 0;
    const clearFor = (side) => (s, along, pad) =>
      (bridgeS === null || s + along < bridgeS - pad || s > bridgeS + pad) && isLand(s) && isLand(s + along) &&
      ((side < 0 && !P.at(s, 'tunnel', 40) && !P.at(s, 'harbor', 40) && !P.at(s, 'toll', 40)) ||
        (P.mask(s, 40) === 0 && P.mask(s + along, 40) === 0));
    for (const side of [1, -1]) {
      const clear = clearFor(side);
      // street-front row
      let s = s0 + R(k++) * 4;
      while (s < s0 + CHUNK) {
        const sm0 = s + 8;
        const dd = P.district(sm0);
        const kind = R(k++) < dd.downtown ? 'shop' : R(k++) < dd.town * 1.1 ? 'house' : 'farm';
        const pe = side > 0 ? this.paveR(dd) : this.paveL(dd);
        if (kind === 'shop') {
          const along = 10 + R(k++) * 16;
          const depth = 12 + R(k++) * 14;
          const h = R(k++) < 0.65 ? 7 + R(k++) * 14 : 22 + R(k++) * 30;
          const front = pe + side * (1 + R(k++) * 3);
          const d = front + side * (depth / 2);
          const sm = s + along / 2;
          const base = side > 0 ? Math.max(this.wallH(sm), 0) : 0;
          if (R(k++) < 0.9 && clear(s, along, 16)) {
            const uOff = Math.floor(R(k++) * 16) / 16;
            const vOff = Math.floor(R(k++) * 16) / 16;
            this.boxBuilding(geo.building, sm, d, base - 0.5, along, depth, h + 0.5, a, uOff, vOff);
            this.shopFront(geo.shop, sm, front - side * 0.12, base, along, side, a, R(k++));
            if (h > 30 && R(k++) < 0.5) {
              const p = this.path.point(sm, d, base + h + 1.5);
              glows.push({ x: p.x, y: p.y, z: p.z, r: 1, g: 0.15, b: 0.1, size: 1.4, blink: R(k++) * 6 });
              this.obox(geo.building, sm, d, base + h, 0.4, 0.4, 1.5, a);
            }
          }
          s += along + (R(k++) < 0.25 ? 8 + R(k++) * 6 : 1.5);
        } else if (kind === 'house') {
          // detached houses with gable roofs and small front gardens
          const along = 9 + R(k++) * 5;
          const depth = 8 + R(k++) * 4;
          const floors = R(k++) < 0.6 ? 2 : 1;
          const h = floors * 3.2;
          const front = pe + side * (4 + R(k++) * 3);
          const d = front + side * (depth / 2);
          const sm = s + along / 2;
          const base = side > 0 ? Math.max(this.wallH(sm), 0.16) : 0.16;
          if (R(k++) < 0.85 && clear(s, along, 14)) {
            const band = Math.floor(R(k++) * 4);
            this.houseBox(geo.house, sm, d, base, along, depth, h, a, band, floors);
            this.roof(geo.roof, sm, d, base + h, along + 0.6, depth + 0.6, 2.2 + R(k++) * 1.2, a);
            if (R(k++) < 0.5) this.tree(geo, sm + along * 0.5 + 1.5, front - side * 2, base, a, R(k++));
            // little fence along the front garden
            this.obox(geo.rail, sm, front - side * 2.5, base, along, 0.06, 0.8, a);
          }
          s += along + 4 + R(k++) * 6;
        } else {
          // countryside: an occasional farmhouse + red barn far back, otherwise fields
          if (R(k++) < 0.2 && clear(s, 30, 10)) {
            const d = side * (55 + R(k++) * 50);
            const hill = 0.55 + 0.45 * vnoise(s / 260, this.path.seed + 51);
            const base = side > 0 ? 0.16 + hill * 2.5 : 0.16 + hill * 2.5;
            this.houseBox(geo.house, s + 6, d, base, 10, 8, 6.4, a, 0, 2);
            this.roof(geo.roof, s + 6, d, base + 6.4, 10.6, 8.6, 3, a);
            geo.colored.col = '#8c2a22';
            this.obox(geo.colored, s + 24, d + side * 6, base, 14, 10, 6, a);
            this.roof(geo.roof, s + 24, d + side * 6, base + 6, 14.6, 10.6, 3.5, a);
            geo.colored.col = '#9aa2ae';
            this.obox(geo.colored, s + 34, d + side * 2, base, 3, 3, 11, a); // silo
          }
          s += 40;
        }
      }
      // towers behind (downtown) / apartment blocks (suburbs)
      s = s0 + R(k++) * 10;
      while (s < s0 + CHUNK) {
        const dd = P.district(s);
        const along = 14 + R(k++) * 18;
        const across = 14 + R(k++) * 20;
        const tall = dd.downtown > 0.3;
        const h = tall ? 28 + R(k++) * 60 : 12 + R(k++) * 12;
        const gap = 75 + R(k++) * 80;
        const d = side * (gap + across / 2);
        const sm = s + along / 2;
        const chance = 0.7 * dd.downtown + 0.22 * dd.town * (1 - dd.downtown);
        if (R(k++) < chance && clear(sm - along / 2, along, 20)) {
          const uOff = Math.floor(R(k++) * 16) / 16;
          const vOff = Math.floor(R(k++) * 16) / 16;
          this.boxBuilding(geo.building, sm, d, -1, along, across, h + 1, a, uOff, vOff);
          if (tall && R(k++) < 0.5) {
            const p = this.path.point(sm, d, h + 1.5);
            glows.push({ x: p.x, y: p.y, z: p.z, r: 1, g: 0.15, b: 0.1, size: 1.4, blink: R(k++) * 6 });
          }
        }
        s += along + 6 + R(k++) * 14;
      }
    }
  }

  // lit ground-floor shop strip on the road-facing side of a building
  shopFront(geo, s, d, base, along, side, a, r) {
    const f = this.path.sample(s, {});
    const cx = f.x + f.rx * d - a.x, cz = f.z + f.rz * d - a.z, cy = f.y + base - a.y;
    const H = 4.4;
    const P = (i, k) => [cx + f.fx * along * 0.5 * i, cy + H * k, cz + f.fz * along * 0.5 * i];
    const inside = [cx + f.rx * side * 2, cy + H / 2, cz + f.rz * side * 2];
    const u0 = Math.floor(r * 4) / 4, u1 = u0 + along / 32;
    geo.quadOut([P(-1, 0), P(1, 0), P(1, 1), P(-1, 1)], [[u0, 0], [u1, 0], [u1, 1], [u0, 1]], inside);
  }

  boxBuilding(geo, s, d, y0, along, across, h, a, uOff, vOff) {
    // world-scaled UVs: one window cell = 3 m wide x 3.2 m tall, 16 cells per texture
    const f = this.path.sample(s, {});
    const cx = f.x + f.rx * d - a.x, cz = f.z + f.rz * d - a.z, cy = f.y + y0 - a.y;
    const P = (i, j, k) => [
      cx + f.fx * along * 0.5 * i + f.rx * across * 0.5 * j,
      cy + h * k,
      cz + f.fz * along * 0.5 * i + f.rz * across * 0.5 * j,
    ];
    const inside = [cx, cy + h / 2, cz];
    const U = (m) => m / 48;
    const V = (m) => m / 51.2;
    const face = (q, w) =>
      geo.quadOut(q, [[uOff, vOff], [uOff + U(w), vOff], [uOff + U(w), vOff + V(h)], [uOff, vOff + V(h)]], inside);
    face([P(-1, -1, 0), P(1, -1, 0), P(1, -1, 1), P(-1, -1, 1)], along);
    face([P(-1, 1, 0), P(1, 1, 0), P(1, 1, 1), P(-1, 1, 1)], along);
    face([P(-1, -1, 0), P(-1, 1, 0), P(-1, 1, 1), P(-1, -1, 1)], across);
    face([P(1, -1, 0), P(1, 1, 0), P(1, 1, 1), P(1, -1, 1)], across);
    geo.quadOut([P(-1, -1, 1), P(1, -1, 1), P(1, 1, 1), P(-1, 1, 1)], [[0.01, 0.01], [0.01, 0.01], [0.01, 0.01], [0.01, 0.01]], inside);
  }

  // a house: siding band `band` of the house texture (12 m of texture across)
  houseBox(geo, s, d, y0, along, across, h, a, band, floors) {
    const f = this.path.sample(s, {});
    const cx = f.x + f.rx * d - a.x, cz = f.z + f.rz * d - a.z, cy = f.y + y0 - a.y;
    const P = (i, j, k) => [cx + f.fx * along * 0.5 * i + f.rx * across * 0.5 * j, cy + h * k, cz + f.fz * along * 0.5 * i + f.rz * across * 0.5 * j];
    const inside = [cx, cy + h / 2, cz];
    const v0 = 1 - (band + 1) / 4; // texture rows run top-down
    const v1 = v0 + (floors === 2 ? 0.25 : 0.125);
    const face = (q, w) => geo.quadOut(q, [[0, v0], [w / 12, v0], [w / 12, v1], [0, v1]], inside);
    face([P(-1, -1, 0), P(1, -1, 0), P(1, -1, 1), P(-1, -1, 1)], along);
    face([P(-1, 1, 0), P(1, 1, 0), P(1, 1, 1), P(-1, 1, 1)], along);
    face([P(-1, -1, 0), P(-1, 1, 0), P(-1, 1, 1), P(-1, -1, 1)], across);
    face([P(1, -1, 0), P(1, 1, 0), P(1, 1, 1), P(1, -1, 1)], across);
  }

  // ---------------------------------------------------------------- queries
  *allGlows() {
    for (const ch of this.chunks.values()) yield* ch.glows;
    for (const n of this.nets.values()) yield* n.glows;
  }
  *allLights() {
    for (const ch of this.chunks.values()) yield* ch.lights;
    for (const n of this.nets.values()) yield* n.lights;
  }
  *allObstacles() {
    for (const ch of this.chunks.values()) yield* ch.obstacles;
  }
  *allChunks() {
    yield* this.chunks.values();
  }
}
