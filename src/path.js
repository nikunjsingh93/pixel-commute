// Endless highway centre line. Positions are absolute (JS doubles); the
// renderer subtracts a floating origin before anything reaches the GPU.
//
// Frame at s:  forward f = (sin h, 0, cos h)
//              right   r = (-cos h, 0, sin h)   (f x up)
//              world(s, d, y) = C(s) + r*d + up*y

export const STEP = 2; // metres between stored samples

function hash(n) {
  const x = Math.sin(n * 127.1 + 311.7) * 43758.5453;
  return x - Math.floor(x);
}

// smooth 1D value noise, roughly in [-1, 1]
function vnoise(x, seed) {
  const i = Math.floor(x);
  const f = x - i;
  const u = f * f * (3 - 2 * f);
  const a = hash(i + seed * 101.3) * 2 - 1;
  const b = hash(i + 1 + seed * 101.3) * 2 - 1;
  return a + (b - a) * u;
}

export class Path {
  constructor(seed = 1) {
    this.seed = seed;
    this.base = 0; // index of first stored sample
    this.x = [0];
    this.y = [this.height(0)];
    this.z = [0];
    this.h = [0];
  }

  curvature(s) {
    // long sweeping bends with straights in between (radius >= ~260 m)
    const n = vnoise(s / 520, this.seed) * 0.7 + vnoise(s / 210, this.seed + 7) * 0.3;
    const shaped = Math.sign(n) * Math.max(0, Math.abs(n) - 0.12) / 0.88;
    const c = shaped * 0.0038;
    // a shaper (the planner) can straighten and level the road (city zones)
    const sh = this.shape ? this.shape(s) : null;
    return sh ? c * (1 - sh.k) : c;
  }

  naturalHeight(s) {
    return vnoise(s / 380, this.seed + 3) * 7 + vnoise(s / 140, this.seed + 9) * 1.6;
  }

  height(s) {
    const n = this.naturalHeight(s);
    const sh = this.shape ? this.shape(s) : null;
    return sh ? n + (sh.y - n) * sh.k : n;
  }

  get end() {
    return (this.base + this.x.length - 1) * STEP;
  }

  ensure(s) {
    while (this.end < Math.max(s, (this.base + 1) * STEP) + STEP * 2) {
      const n = this.x.length - 1;
      const sCur = (this.base + n) * STEP;
      const hd = this.h[n] + this.curvature(sCur + STEP * 0.5) * STEP;
      this.h.push(hd);
      this.x.push(this.x[n] + Math.sin(hd) * STEP);
      this.z.push(this.z[n] + Math.cos(hd) * STEP);
      this.y.push(this.height(sCur + STEP));
    }
  }

  // drop samples well behind the player (keeps arrays small on long drives)
  trim(sMin) {
    const drop = Math.floor(sMin / STEP) - this.base - 8;
    if (drop > 4096) {
      this.x.splice(0, drop); this.y.splice(0, drop);
      this.z.splice(0, drop); this.h.splice(0, drop);
      this.base += drop;
    }
  }

  // fills `out` with {x,y,z,h,fx,fz,rx,rz,grade}
  sample(s, out = {}) {
    this.ensure(s);
    const fi = s / STEP - this.base;
    let i = Math.floor(fi);
    if (i < 0) i = 0;
    const t = fi - i;
    const x = this.x[i] + (this.x[i + 1] - this.x[i]) * t;
    const y = this.y[i] + (this.y[i + 1] - this.y[i]) * t;
    const z = this.z[i] + (this.z[i + 1] - this.z[i]) * t;
    const h = this.h[i] + (this.h[i + 1] - this.h[i]) * t;
    out.x = x; out.y = y; out.z = z; out.h = h;
    out.fx = Math.sin(h); out.fz = Math.cos(h);
    out.rx = -Math.cos(h); out.rz = Math.sin(h);
    out.grade = (this.y[i + 1] - this.y[i]) / STEP;
    return out;
  }

  // absolute world point at (s, d, up)
  point(s, d, up = 0, out = {}) {
    const f = this.sample(s, _tmp);
    out.x = f.x + f.rx * d;
    out.y = f.y + up;
    out.z = f.z + f.rz * d;
    return out;
  }
}

const _tmp = {};
export { hash, vnoise };
