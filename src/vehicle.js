// Simcade rigid-body car, ported from the Open Road project: four raycast
// wheels with spring/damper suspension and anti-roll bars, a combined-slip
// tyre model, engine torque curve + automatic gearbox, ABS, traction control
// and a light yaw-stability assist. Body frame: forward = -Z, right = +X.
import * as THREE from 'three';

const G = 9.81;
const Y_UP = new THREE.Vector3(0, 1, 0);
const V3 = THREE.Vector3, Q = THREE.Quaternion;
const clamp = (x, a, b) => (x < a ? a : x > b ? b : x);
const smoothstep = (a, b, x) => {
  const t = clamp((x - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
};

// engine torque curve (normalised)
const CURVE = [[700, 0.3], [1000, 0.6], [1500, 0.8], [2000, 0.94], [2500, 1.0], [4800, 1.0], [5600, 0.93], [6400, 0.8], [7000, 0.6]];
function torqueCurve(rpm) {
  if (rpm <= CURVE[0][0]) return CURVE[0][1];
  for (let i = 1; i < CURVE.length; i++) {
    if (rpm <= CURVE[i][0]) {
      const a = CURVE[i - 1], b = CURVE[i];
      return a[1] + ((b[1] - a[1]) * (rpm - a[0])) / (b[0] - a[0]);
    }
  }
  return 0.4;
}

// a big, comfortable rear-drive saloon
export const SPEC = {
  mass: 1780,
  inertia: new V3(2700, 2650, 720), // pitch(x), yaw(y), roll(z)
  wheelbase: 3.1, track: 1.6, comH: 0.55,
  radius: 0.33, wheelInertia: 1.6,
  kF: 38000, kR: 35000, cBump: 3000, cReb: 4600, arbF: 16000, arbR: 9500,
  rayLen: 0.62, maxComp: 0.26,
  gears: [4.7, 3.1, 2.1, 1.67, 1.29, 1.0, 0.84, 0.67], finalDrive: 2.8, reverse: 3.4, eff: 0.9,
  maxTorque: 560, idle: 700, redline: 6400,
  brakeTorque: 3900, brakeBias: 0.64,
  cdA: 0.6, rollRes: 0.011,
  drive: [0, 0, 0.5, 0.5],
  steerRate: 9, angDamp: 90,
  hull: [
    [-0.85, -0.3, -2.3], [0.85, -0.3, -2.3], [-0.85, -0.3, 2.3], [0.85, -0.3, 2.3], [0, -0.32, 0],
    [-0.75, 0.55, -0.4], [0.75, 0.55, -0.4], [-0.75, 0.55, 1.2], [0.75, 0.55, 1.2], [0, 0.6, 0.4],
  ],
};

function tireCurve(s) {
  const B = 10.5, C = 1.55, E = 0.25;
  const bs = B * s;
  return Math.sin(C * Math.atan(bs - E * (bs - Math.atan(bs))));
}

export class Vehicle {
  // ground: { ground(x, z, out) -> height, sets out.h / out.surf }
  constructor(ground, spec = SPEC) {
    this.g = ground;
    const S = (this.spec = spec);
    this.pos = new V3(); this.quat = new Q(); this.vel = new V3(); this.omega = new V3();
    this.right = new V3(1, 0, 0); this.up = new V3(0, 1, 0); this.fwd = new V3(0, 0, -1);
    const hw = S.track / 2, hl = S.wheelbase / 2;
    // suspension mounts sit at the same height above the road for every car
    // (tuned on the saloon: comH 0.55 -> -0.08), so taller cars still reach it
    const wy = -S.comH + 0.47 + (S.radius - 0.33);
    // order: FL, FR, RL, RR (forward is -Z in body space)
    this.wheels = [
      this._wheel(-hw, wy, -hl, true, S.drive[0], S.kF, S.arbF),
      this._wheel(+hw, wy, -hl, true, S.drive[1], S.kF, S.arbF),
      this._wheel(-hw, wy, +hl, false, S.drive[2], S.kR, S.arbR),
      this._wheel(+hw, wy, +hl, false, S.drive[3], S.kR, S.arbR),
    ];
    this.gh = { h: 0, surf: 0 };
    this.steerInput = 0; this.steerAngle = 0;
    this.throttle = 0; this.brake = 0; this.handbrake = 0;
    this.snow = 0; this.wet = 0; this.assist = 0.7; this.tcOn = true;
    this.gear = 1; this.rpm = S.idle; this.shiftTimer = 0;
    this.speed = 0; this.fwdSpeed = 0;
    this.onGround = 0; this.slip = 0;
    this.accel = new V3(); this._lastVel = new V3();
    this._org = new V3(); this._cp = new V3(); this._r = new V3(); this._vc = new V3();
    this._wf = new V3(); this._wl = new V3(); this._tv = new V3(); this._tot = new V3(); this._trq = new V3();
    this._tv2 = new V3(); this._q = new Q(); this._dq = new Q(); this._wb = new V3(); this._tb = new V3();
  }

  _wheel(x, y, z, steer, drive, k, arb) {
    return {
      local: new V3(x, y, z), steer, drive, rear: z > 0, k, arb,
      comp: 0, prevComp: 0, contact: false, omega: 0, spin: 0, steerA: 0,
      hub: new V3(), normal: new V3(0, 1, 0), fz: 0, fx: 0, fy: 0, slipRatio: 0, slipAngle: 0, surf: 0,
      _o0: [0, 0, 0, 0, 0], _o1: [0, 0, 0, 0, 0],
    };
  }

  // speed-sensitive lock: full lock asks for ~2 g (kinematic: a = v^2 *
  // tan(delta) / wheelbase), more than the tyres give, so full lock always
  // turns as hard as grip allows while small inputs stay smooth at speed
  maxSteer(v) {
    const S = this.spec;
    const vv = Math.max(v, 1) ** 2;
    return Math.max(0.025, Math.min(0.7, (21 * S.wheelbase * (S.steerK || 1)) / vv));
  }

  // place upright at (x, y = ground, z) heading along (dx, dz)
  placeAt(x, y, z, dx, dz, speed = 0) {
    const S = this.spec;
    const th = Math.atan2(dx, -dz);
    this.pos.set(x, y + S.comH + 0.1, z);
    this.quat.setFromAxisAngle(new V3(0, 1, 0), -th);
    this.vel.set(Math.sin(th) * speed, 0, -Math.cos(th) * speed);
    this.omega.set(0, 0, 0);
    for (const wh of this.wheels) { wh.omega = speed / S.radius; wh.comp = 0.09; wh.prevComp = 0.09; }
    this.gear = 1;
    for (let g = 1; g <= S.gears.length; g++) {
      this.gear = g;
      if ((speed / S.radius) * 9.55 * S.gears[g - 1] * S.finalDrive < S.redline * 0.42) break;
    }
    this.rpm = S.idle; this.steerAngle = 0; this.shiftTimer = 0;
    this.updateBasis();
  }

  updateBasis() {
    this.right.set(1, 0, 0).applyQuaternion(this.quat);
    this.up.set(0, 1, 0).applyQuaternion(this.quat);
    this.fwd.set(0, 0, -1).applyQuaternion(this.quat);
  }

  ground(x, z, out) {
    return this.g.ground(x, z, out);
  }

  groundNormal(x, z, out, e = 0.4) {
    const g = this.gh;
    const hl = this.ground(x - e, z, g), hr = this.ground(x + e, z, g);
    const hd = this.ground(x, z - e, g), hu = this.ground(x, z + e, g);
    out.set(hl - hr, 2 * e, hd - hu).normalize();
  }

  step(dt, sub = 3) {
    const h = dt / sub;
    this._lastVel.copy(this.vel);
    for (let i = 0; i < sub; i++) this._sub(h);
    this.accel.copy(this.vel).sub(this._lastVel).divideScalar(dt);
    this.speed = this.vel.length();
    this.fwdSpeed = this.vel.dot(this.fwd);
  }

  // W/S style input with automatic reverse
  drive(accelKey, brakeKey, steer, handbrake) {
    if (this.gear >= 1) {
      this.throttle = accelKey; this.brake = brakeKey;
      if (brakeKey > 0.1 && accelKey < 0.1 && this.fwdSpeed < 0.6 && this.onGround >= 2) this.gear = -1;
    } else {
      this.throttle = brakeKey; this.brake = accelKey;
      if (accelKey > 0.1 && brakeKey < 0.1) this.gear = 1;
    }
    this.steerInput = steer; this.handbrake = handbrake;
  }

  _sub(dt) {
    const S = this.spec;
    this.updateBasis();
    const { right, up, fwd } = this;
    const v = this.speed;
    let target = this.steerInput * this.maxSteer(v);
    // slip-angle limiter: never turn the fronts far past the grip peak
    if (this.assist > 0 && v > 3) {
      const fa = Math.max(Math.abs(this.wheels[0].slipAngle), Math.abs(this.wheels[1].slipAngle));
      if (fa > 0.2) target *= clamp(0.2 / fa, 0.5, 1);
    }
    this.steerAngle += clamp(target - this.steerAngle, -S.steerRate * dt, S.steerRate * dt);

    const totalF = this._tot.set(0, -S.mass * G, 0);
    const torque = this._trq.set(0, 0, 0);
    const org = this._org, cp = this._cp, r = this._r, vc = this._vc, wf = this._wf, wl = this._wl, tv = this._tv;

    // ---- engine / gearbox ----
    const rearOmega = (this.wheels[2].omega + this.wheels[3].omega) * 0.5;
    const ratioAbs = (this.gear > 0 ? S.gears[this.gear - 1] : this.gear < 0 ? S.reverse : 0) * S.finalDrive;
    const ratio = this.gear > 0 ? ratioAbs : this.gear < 0 ? -ratioAbs : 0;
    const wheelRpm = ((Math.abs(rearOmega) * 60) / (2 * Math.PI)) * ratioAbs;
    const clutchRpm = S.idle + 1300 * this.throttle;
    const grip = (this.wheels[2].contact || this.wheels[3].contact) && this.up.y > 0.35 ? 1 : 0;
    const engaged = grip * smoothstep(clutchRpm * 0.9, clutchRpm * 1.35, wheelRpm);
    let rpm = Math.max(S.idle, wheelRpm * engaged + clutchRpm * (1 - engaged));
    if (this.shiftTimer > 0) { this.shiftTimer -= dt; rpm = Math.max(S.idle, rpm * 0.96); }
    this.rpm += (rpm - this.rpm) * clamp(dt * 25, 0, 1);
    let engT = 0;
    if (this.shiftTimer <= 0) {
      const thr = this.throttle;
      const full = S.maxTorque * torqueCurve(this.rpm);
      const drag = -S.maxTorque * 0.12 * (this.rpm / 6000) * (1 - thr);
      engT = thr * full + drag;
      if (this.rpm > S.redline) engT = Math.min(engT, 0) - 30;
    }
    const drivenTorque = engT * ratio * S.eff;

    const holdK = this.throttle < 0.05 && this.brake < 0.05 ? 1 - smoothstep(0.5, 1.6, this.speed) : 0;
    let contacts = 0, slipMax = 0;
    for (let wi = 0; wi < 4; wi++) {
      const wh = this.wheels[wi];
      let sa = 0;
      if (wh.steer) {
        const inner = (wi === 0) === (this.steerAngle > 0);
        sa = this.steerAngle * (inner ? 1.1 : 0.92); // Ackermann
      }
      wh.steerA += (sa - wh.steerA) * clamp(dt * 40, 0, 1);

      org.copy(wh.local).applyQuaternion(this.quat).add(this.pos);
      const t0 = this._raycast(org, up, S.rayLen);
      wh.prevComp = wh.comp;
      const contact = t0 >= 0;
      wh.contact = contact;
      if (!contact) {
        wh.comp = 0; wh.fz = 0;
        wh.hub.copy(org).addScaledVector(up, -(S.rayLen - S.radius));
        wh.omega += (dt * drivenTorque * wh.drive) / S.wheelInertia;
        wh.omega = clamp(wh.omega * (1 - dt * (this.throttle > 0.05 ? 0.25 : 2.2)), -420, 420);
        continue;
      }
      contacts++;
      const comp = clamp(S.rayLen - t0, 0, S.maxComp * 1.7);
      wh.comp = comp;
      wh.hub.copy(org).addScaledVector(up, -(t0 - S.radius));
      const vComp = (wh.comp - wh.prevComp) / dt;
      const other = this.wheels[wi ^ 1];
      let f = wh.k * comp + (vComp > 0 ? S.cBump : S.cReb) * vComp + wh.arb * (comp - other.comp);
      if (comp > S.maxComp) f += 60000 * (comp - S.maxComp);
      if (f < 0) f = 0;
      f = Math.min(f, 18000) * Math.min(1, Math.max(0, (up.y - 0.25) * 3));
      wh.fz = f;
      cp.copy(org).addScaledVector(up, -t0);
      this.groundNormal(cp.x, cp.z, wh.normal);
      this.ground(cp.x, cp.z, this.gh);
      wh.surf = this.gh.surf;
      const gn = wh.normal;
      tv.copy(up).multiplyScalar(f);
      totalF.add(tv);
      r.copy(cp).sub(this.pos);
      torque.add(this._tv2.copy(r).cross(tv));

      // tyre frame
      const cs = Math.cos(wh.steerA), sn = Math.sin(wh.steerA);
      wf.copy(fwd).multiplyScalar(cs).addScaledVector(right, sn);
      wf.addScaledVector(gn, -wf.dot(gn)).normalize();
      wl.copy(gn).cross(wf).normalize().negate();
      vc.copy(this.omega).cross(r).add(this.vel);
      const vx = vc.dot(wf), vy = vc.dot(wl);
      // grippy road tyres; snow and rain take a little off (arcade-friendly)
      const mu0 = (wh.surf === 0 ? 1.62 : 1.3) * (1 - 0.2 * this.snow) * (1 - 0.08 * this.wet);
      const mu = mu0 * (1 - 0.07 * (f / (S.mass * 2.45) - 1)) * (wh.rear ? 1.12 : 1.0) * (S.gripK || 1);
      const Fz = f;
      const vref = Math.max(Math.abs(vx), 1.6);
      const R = S.radius, I = S.wheelInertia;

      let brakeT = this.brake * S.brakeTorque * (wh.steer ? S.brakeBias : 1 - S.brakeBias) * 0.5;
      if (this.handbrake > 0 && wh.rear) brakeT = Math.max(brakeT, this.handbrake * 2600);
      const holdT = holdK * 900;
      brakeT = Math.max(brakeT, holdT);
      let Td = drivenTorque * wh.drive;
      if (this.tcOn && Td > 0) {
        // traction control: never ask for more drive than the friction circle allows
        const cap = Math.max(0.22 * mu * Fz, Math.sqrt(Math.max(0, Math.pow(0.97 * mu * Fz, 2) - wh.fy * wh.fy))) * R;
        if (Td > cap) Td = cap;
      }
      const evalF = (om, out) => {
        const kap = (om * R - vx) / vref;
        const ta = vy / vref;
        const sm = Math.hypot(kap, ta);
        const fm = sm < 1e-6 ? 0 : tireCurve(sm) * mu * Fz;
        out[0] = (fm * kap) / (sm || 1); out[1] = (-fm * ta) / (sm || 1); out[2] = kap; out[3] = ta; out[4] = sm;
      };
      const o0 = wh._o0, o1 = wh._o1;
      evalF(wh.omega, o0);
      evalF(wh.omega + 0.5, o1);
      const dFx = Math.max((o1[0] - o0[0]) / 0.5, 0);
      let wNew = wh.omega + (dt * (Td - R * o0[0])) / I / (1 + (dt * R * dFx) / I);
      if (brakeT > 0) {
        // simple ABS: release when the wheel is about to lock (off at a crawl,
        // like real ABS, so the car can actually come to a stop)
        const abs = o0[2] < -0.22 && this.handbrake < 0.5 && holdT < 1 && Math.abs(vx) > 2.5;
        const bt = abs ? brakeT * 0.25 : brakeT;
        const dwB = (dt * bt) / I;
        if (Math.abs(wNew) <= dwB) wNew = 0;
        else wNew -= Math.sign(wNew) * dwB;
      }
      evalF(wNew, o1);
      const fx = o1[0], fy = o1[1];
      wh.omega = clamp(wNew, -420, 420);
      wh.fx = fx; wh.fy = fy; wh.slipRatio = o1[2]; wh.slipAngle = o1[3];
      if (o1[4] > slipMax) slipMax = o1[4];
      const rr = (wh.surf === 0 ? S.rollRes : 0.02) * Fz;
      const frr = -Math.tanh(vx * 2) * rr;
      tv.copy(wf).multiplyScalar(fx + frr).addScaledVector(wl, fy);
      totalF.add(tv);
      // steering scrub relief for launches out of tight turns
      if (wh.steer && this.throttle > 0.05) {
        const back = -fy * wl.dot(fwd);
        if (back < 0) totalF.addScaledVector(fwd, -back * 0.75 * this.throttle * (1 - smoothstep(7, 18, this.speed)));
      }
      // tyre forces act as if from a point 65% of the way up to the centre of
      // mass: the grip stays, but the roll (and dive) they cause is much
      // smaller, so a hard turn leans the car instead of tipping it over
      this._tv2.copy(r).addScaledVector(up, -0.65 * r.dot(up));
      torque.add(this._tv2.cross(tv));
    }
    // aerodynamics
    const sp = this.speed;
    if (sp > 0.01) {
      totalF.addScaledVector(this.vel, -0.5 * 1.2 * S.cdA * sp);
      totalF.addScaledVector(up, -0.5 * 1.2 * 0.28 * sp * sp);
    }
    torque.addScaledVector(this.omega, -S.angDamp);
    // roll stabiliser: pull the body back upright about its long axis and damp
    // the roll rate (not when it is already upside down)
    if (up.y > 0.2) {
      const mk = S.mass / 1780;
      const rollErr = this._tv2.copy(up).cross(Y_UP).dot(fwd); // ~ sin(roll)
      const rollRate = this.omega.dot(fwd);
      torque.addScaledVector(fwd, (rollErr * 14000 - rollRate * 2600) * mk);
    }
    if (this.assist > 0 && this.speed > 4 && this.onGround > 2) {
      // yaw stability assist toward the kinematic (bicycle model) yaw rate
      const yaw = this.omega.dot(up);
      // (a right turn is a negative yaw rate about +Y with forward = -Z, hence the minus)
      const want = -((this.fwdSpeed * Math.tan(this.steerAngle)) / S.wheelbase) * 0.97;
      const err = yaw - want;
      const ak = S.assistK || 1; // per car: how hard the assist helps it rotate
      const tq = clamp(-err * 5200 * this.assist * ak, -4200 * ak, 4200 * ak);
      torque.addScaledVector(up, tq);
    }
    // integrate linear
    this.vel.addScaledVector(totalF, dt / S.mass);
    // integrate angular (body-frame Euler equations)
    const qi = this._q.copy(this.quat).invert();
    const wb = this._wb.copy(this.omega).applyQuaternion(qi);
    const tb = this._tb.copy(torque).applyQuaternion(qi);
    const I = S.inertia;
    wb.x += (dt * (tb.x - (I.z - I.y) * wb.y * wb.z)) / I.x;
    wb.y += (dt * (tb.y - (I.x - I.z) * wb.z * wb.x)) / I.y;
    wb.z += (dt * (tb.z - (I.y - I.x) * wb.x * wb.y)) / I.z;
    this.omega.copy(wb).applyQuaternion(this.quat);
    // integrate pose
    this.pos.addScaledVector(this.vel, dt);
    const om = this.omega, hq = 0.5 * dt;
    const dq = this._dq.set(om.x * hq, om.y * hq, om.z * hq, 0).multiply(this.quat);
    this.quat.set(this.quat.x + dq.x, this.quat.y + dq.y, this.quat.z + dq.z, this.quat.w + dq.w).normalize();
    this._bodyCollide(dt);
    this.onGround = contacts;
    this.slip = slipMax;
    for (const wh of this.wheels) wh.spin += wh.omega * dt;
    this._gearbox();
  }

  // rigid chassis points vs the ground, so the body can never sink through it
  _bodyCollide(dt) {
    const S = this.spec;
    const H = this._hull || (this._hull = S.hull.map((a) => new V3(...a)));
    const p = this._hp || (this._hp = new V3()), rr = this._hr || (this._hr = new V3());
    const n = this._hn || (this._hn = new V3()), t1 = this._ht || (this._ht = new V3()), rxn = this._hx || (this._hx = new V3());
    const g0 = this.ground(this.pos.x, this.pos.z, this.gh);
    if (this.pos.y < g0 - 1.2) { this.pos.y = g0 + 0.9; if (this.vel.y < 0) this.vel.y *= -0.1; }
    for (let i = 0; i < H.length; i++) {
      rr.copy(H[i]).applyQuaternion(this.quat);
      p.copy(this.pos).add(rr);
      const gh = this.ground(p.x, p.z, this.gh);
      const pen = gh - p.y;
      if (pen <= 0) continue;
      this.groundNormal(p.x, p.z, n);
      if (n.y < 0.2) n.set(0, 1, 0);
      this.pos.addScaledVector(n, Math.min(pen, 2.5) * 0.9);
      t1.copy(this.omega).cross(rr).add(this.vel);
      const vn = t1.dot(n);
      if (vn < 0) {
        rxn.copy(rr).cross(n);
        const k = 1 / S.mass + rxn.lengthSq() / 2600;
        const j = Math.min(-(1.06 * vn) / k, S.mass * 26) * (vn < -1.5 ? 0.62 : 1);
        this.vel.addScaledVector(n, j / S.mass);
        this.omega.addScaledVector(rxn, (j / 2600) * 0.8);
        const vt = t1.copy(this.vel).addScaledVector(n, -this.vel.dot(n));
        this.vel.addScaledVector(vt, -Math.min(0.06 + 0.4 * dt * 10, 0.5) * (i >= 5 ? 1.5 : 1));
        this.omega.multiplyScalar(0.985);
      }
    }
    const ol = this.omega.length();
    if (ol > 9) this.omega.multiplyScalar(9 / ol);
    const vl = this.vel.length();
    if (vl > 130) this.vel.multiplyScalar(130 / vl);
    if (!(vl < 1e6) || !(ol < 1e6) || !isFinite(this.pos.x + this.pos.y + this.pos.z + this.quat.w)) {
      this.vel.set(0, 0, 0); this.omega.set(0, 0, 0); this.quat.set(0, 0, 0, 1);
      this.pos.y = this.ground(this.pos.x || 0, this.pos.z || 0, this.gh) + 1;
    }
  }

  // impulse at a world point (used for barrier / traffic contacts).
  // n = unit normal (world), j = impulse magnitude along n
  applyImpulse(point, n, j) {
    const S = this.spec;
    this.vel.addScaledVector(n, j / S.mass);
    const r = this._tv2.copy(point).sub(this.pos);
    const tq = r.cross(n).multiplyScalar(j);
    // angular impulse through the yaw axis only (keeps contacts stable)
    const yaw = tq.dot(this.up) / S.inertia.y;
    this.omega.addScaledVector(this.up, yaw);
  }

  // effective inverse mass at a point for a horizontal normal (yaw only)
  invMassAt(point, n) {
    const S = this.spec;
    const r = this._tv2.copy(point).sub(this.pos);
    const c = r.cross(n).dot(this.up);
    return 1 / S.mass + (c * c) / S.inertia.y;
  }

  // put the wheel hubs on the ground without stepping (a freshly swapped car
  // is drawn before its first physics step, e.g. in the paused garage)
  settleHubs() {
    const S = this.spec, org = this._org, up = this.up;
    for (const wh of this.wheels) {
      org.copy(wh.local).applyQuaternion(this.quat).add(this.pos);
      const t0 = this._raycast(org, up, S.rayLen);
      wh.hub.copy(org).addScaledVector(up, -((t0 >= 0 ? t0 : S.rayLen) - S.radius));
    }
  }

  pointVel(point, out) {
    const r = this._tv2.copy(point).sub(this.pos);
    return out.copy(this.omega).cross(r).add(this.vel);
  }

  _raycast(org, up, maxLen) {
    const dy = up.y;
    if (dy < 0.25) return -1;
    let t = Math.max(org.y - this.ground(org.x, org.z, this.gh), 0) / dy;
    for (let i = 0; i < 3; i++) {
      const px = org.x - up.x * t, pz = org.z - up.z * t, py = org.y - up.y * t;
      const h = this.ground(px, pz, this.gh);
      t += (py - h) / dy;
      if (t < -0.6) return -1;
    }
    if (t > maxLen) return -1;
    return Math.max(t, 0);
  }

  _gearbox() {
    const S = this.spec;
    if (this.gear < 1 || this.shiftTimer > 0) return;
    const rearOmega = Math.abs(this.fwdSpeed) / S.radius;
    // shift points scale with the engine (a diesel van revs far lower than the coupe)
    const upRpm = S.redline * (0.41 + 0.47 * this.throttle * this.throttle);
    const downRpm = S.redline * (0.18 + 0.14 * this.throttle);
    const rpmIn = (g) => ((rearOmega * 60) / (2 * Math.PI)) * S.gears[g - 1] * S.finalDrive;
    if (this.gear < S.gears.length && rpmIn(this.gear) > upRpm) { this.gear++; this.shiftTimer = 0.22; }
    else if (this.gear > 1 && rpmIn(this.gear) < downRpm && rpmIn(this.gear - 1) < upRpm - S.redline * 0.11) { this.gear--; this.shiftTimer = 0.18; }
  }
}
