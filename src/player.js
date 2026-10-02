// The player's car: the simcade rigid-body vehicle (vehicle.js) driving on
// the streamed highway, with impulse collisions against the barriers and
// traffic, close-call detection and a pure-pursuit autopilot.
import * as THREE from 'three';
import { makePlayerCar } from './cars.js';
import { Vehicle, SPEC } from './vehicle.js';
import { Cockpit } from './cockpit.js';
import { LANE_D, ROAD_L, ROAD_R, WALL_D, GUARD_R } from './world.js';

export const VMAX = 70; // gauge scale only (m/s)
const clamp = (x, a, b) => (x < a ? a : x > b ? b : x);
const MASS = { sedan: 1500, lux: 1900, hatch: 1250, suv: 2100, van: 2300, truck: 9000, bus: 12000 };

// ground under the car: the road surface (flat cross-section), curb + verge
class RoadGround {
  constructor(path) {
    this.path = path;
    this.hint = 0;
    this.f = {};
    this.out = {};
    this.g = {};
  }
  project(x, z, out = this.out) {
    const f = this.f;
    let s = this.hint;
    for (let i = 0; i < 4; i++) {
      this.path.sample(s, f);
      const ds = (x - f.x) * f.fx + (z - f.z) * f.fz;
      s += ds;
      if (Math.abs(ds) < 0.005) break;
    }
    this.path.sample(s, f);
    out.s = s;
    out.d = (x - f.x) * f.rx + (z - f.z) * f.rz;
    out.y = f.y;
    out.fx = f.fx; out.fz = f.fz; out.rx = f.rx; out.rz = f.rz;
    return out;
  }
  ground(x, z, out) {
    const p = this.project(x, z, this.g);
    let h = p.y;
    let surf = 0;
    if (p.d > ROAD_R) {
      h += Math.min(1, (p.d - ROAD_R) / 0.08) * 0.16; // curb up onto the verge
      surf = 1;
    }
    out.h = h;
    out.surf = surf;
    return h;
  }
}

export class Player {
  constructor(root, path) {
    this.path = path;
    this.groundP = new RoadGround(path);
    this.veh = new Vehicle(this.groundP);
    const car = makePlayerCar('lux', '#15161b', [SPEC.wheelbase / 2, -SPEC.wheelbase / 2]);
    this.dims = car.dims;
    this.L = car.dims.L;
    this.W = car.dims.W;
    this.tailMat = car.tailMat;
    // physics body frame (-Z forward) -> car mesh frame (+Z forward)
    this.mesh = new THREE.Group();
    this.inner = car.group;
    this.inner.rotation.y = Math.PI;
    this.inner.position.y = -SPEC.comH;
    this.mesh.add(this.inner);
    this.wheels = car.wheels;
    for (const w of this.wheels) {
      this.inner.remove(w.pivot);
      this.mesh.add(w.pivot);
    }
    this.cockpit = new Cockpit();
    this.inner.add(this.cockpit.group, this.cockpit.exterior);
    root.add(this.mesh);

    this.v = 0;
    this.latV = 0;
    this.brake = 0;
    this.scrape = 0;
    this.scrapeSide = 1;
    this.auto = false;
    this.autoLane = 1;
    this.autoCool = 0;
    this.autoSteer = 0;
    this.steerSmooth = 0;
    this.closeCalls = 0;
    this.combo = 0;
    this.events = [];
    this.odo = 0;
    this.stuck = 0;
    this.heading = 0;
    this._p = new THREE.Vector3();
    this._n = new THREE.Vector3();
    this._t = new THREE.Vector3();
    this._vp = new THREE.Vector3();
    this._q = new THREE.Quaternion();
    this._pr = {};
    this._cq = {};
    this._cf = {};
    this.place(300, LANE_D[1], 24);
  }

  place(s, d, speed) {
    const f = this.path.sample(s, {});
    this.groundP.hint = s;
    this.veh.placeAt(f.x + f.rx * d, f.y, f.z + f.rz * d, f.fx, f.fz, speed);
    this.s = s;
    this.d = d;
    this.v = speed;
    this.heading = f.h;
  }

  // ----------------------------------------------------------------- update
  update(dt, input, traffic) {
    const V = this.veh;
    let throttle = input.throttle, brake = input.brake, steer, hb = input.handbrake || 0;
    if (input.any && input.manualOverride) this.auto = false;
    if (this.auto) {
      const c = this.autopilot(dt, traffic);
      throttle = c.throttle; brake = c.brake; steer = c.steer; hb = 0;
      this.steerSmooth = steer;
    } else if (input.analog) {
      steer = input.steer;
      this.steerSmooth = steer;
    } else {
      // keyboard: ramp the steering like a real wheel (quicker back to centre)
      const target = input.steer;
      const sameDir = Math.sign(target) === Math.sign(this.steerSmooth) || this.steerSmooth === 0;
      const rate = target === 0 ? 8 : sameDir ? 6.0 : 10;
      this.steerSmooth += clamp(target - this.steerSmooth, -rate * dt, rate * dt);
      steer = this.steerSmooth;
    }
    V.drive(throttle, brake, steer, hb);
    V.step(dt, Math.max(3, Math.ceil(dt / 0.0056)));

    // road-space state
    const pr = this.groundP.project(V.pos.x, V.pos.z, this._pr);
    this.groundP.hint = pr.s;
    this.odo += Math.abs(pr.s - this.s);
    this.s = pr.s;
    this.d = pr.d;
    this.v = V.fwdSpeed;
    this.latV = V.vel.x * pr.rx + V.vel.z * pr.rz;
    this.heading = Math.atan2(V.fwd.x, V.fwd.z);

    this.scrape = Math.max(0, this.scrape - dt * 3);
    this.barriers();
    this.collideTraffic(traffic);

    const tb = V.brake > 0.1 || (V.gear < 0 && V.throttle > 0.1) ? 1 : 0;
    this.brake += (tb - this.brake) * Math.min(1, dt * 12);

    // never get stuck: flipped, or somehow outside the walls
    const lost = V.up.y < 0.35 || this.d < ROAD_L - 3 || this.d > WALL_D + 2;
    this.stuck = lost ? this.stuck + dt : 0;
    if (this.stuck > 2.5) {
      this.stuck = 0;
      this.place(this.s, LANE_D[this.nearestLane()], 15);
      this.events.push({ type: 'reset' });
    }
  }

  nearestLane() {
    let best = 0;
    LANE_D.forEach((d, i) => {
      if (Math.abs(d - this.d) < Math.abs(LANE_D[best] - this.d)) best = i;
    });
    return best;
  }

  // body corners (body frame: forward -Z, right +X), a little above the ground
  corner(i, out) {
    const hx = this.W / 2 - 0.02, hz = this.L / 2 - 0.05;
    return out.set(i & 1 ? hx : -hx, -0.2, i & 2 ? hz : -hz).applyQuaternion(this.veh.quat).add(this.veh.pos);
  }

  barriers() {
    const V = this.veh, P = this._p, n = this._n, vp = this._vp, t = this._t;
    const minD = ROAD_L - 0.04; // median barrier face
    const maxD = GUARD_R - 0.04; // guard rail (the wall, where there is one, sits behind it)
    for (let i = 0; i < 4; i++) {
      this.corner(i, P);
      const q = this.groundP.project(P.x, P.z, this._cq);
      let pen = 0, side = 0;
      if (q.d < minD) { pen = minD - q.d; side = -1; }
      else if (q.d > maxD) { pen = q.d - maxD; side = 1; }
      if (!side) continue;
      n.set(-side * q.rx, 0, -side * q.rz); // back toward the road
      V.pos.addScaledVector(n, pen);
      V.pointVel(P, vp);
      const vn = vp.dot(n);
      t.set(q.fx, 0, q.fz);
      const vt = vp.dot(t);
      if (vn < 0) {
        const j = (-1.25 * vn) / V.invMassAt(P, n);
        V.applyImpulse(P, n, j);
        // scraping friction along the wall
        const jt = Math.min(Math.abs(vt) / V.invMassAt(P, t), 0.3 * j);
        V.applyImpulse(P, t, -Math.sign(vt) * jt);
        if (-vn > 1.2) this.hit(-vn / 10, 'wall');
      }
      if (Math.abs(vt) > 3) {
        this.scrape = 1;
        this.scrapeSide = side;
      }
    }
  }

  collideTraffic(traffic) {
    const V = this.veh, P = this._p, n = this._n, vp = this._vp;
    // player box axes (horizontal)
    let fl = Math.hypot(V.fwd.x, V.fwd.z) || 1;
    const pfx = V.fwd.x / fl, pfz = V.fwd.z / fl;
    fl = Math.hypot(V.right.x, V.right.z) || 1;
    const prx = V.right.x / fl, prz = V.right.z / fl;
    const hL = this.L / 2, hW = this.W / 2;
    const cf = this._cf;
    for (const c of traffic.cars) {
      if (!c.mesh.visible) continue;
      const dsr = c.s - this.s;
      // close calls: overtaking with a small gap at speed
      if (dsr < -(c.L + this.L) / 2 && !c.passed) {
        c.passed = true;
        const gap = Math.abs(c.d - this.d) - (c.W + this.W) / 2;
        if (gap > 0 && gap < 0.9 && this.v - c.v > 4 && this.v > 22) {
          this.closeCalls++;
          this.combo++;
          this.events.push({ type: 'close', combo: this.combo });
        }
      } else if (dsr > (c.L + this.L) / 2) {
        c.passed = false;
      }
      if (Math.abs(dsr) > 14 || Math.abs(c.d - this.d) > 4.5) continue;

      // traffic car box (absolute world coordinates)
      const p = this.path.sample(c.s, cf);
      const hc = p.h + (c.yaw || 0);
      const fx = Math.sin(hc), fz = Math.cos(hc);
      const rx = -Math.cos(hc), rz = Math.sin(hc);
      const cx = p.x + p.rx * c.d, cz = p.z + p.rz * c.d;
      const cL = c.L / 2, cW = c.W / 2;
      const M = MASS[c.type] || 1500;
      const vcx = fx * c.v, vcz = fz * c.v;
      let worst = 0;

      // n points from the traffic car toward the player
      const resolve = (px, pz, nx, nz, pen) => {
        V.pos.x += nx * pen * 0.9;
        V.pos.z += nz * pen * 0.9;
        P.set(px, V.pos.y - 0.2, pz);
        n.set(nx, 0, nz);
        V.pointVel(P, vp);
        const vrn = (vp.x - vcx) * nx + (vp.z - vcz) * nz;
        if (vrn < 0) {
          const j = (-1.2 * vrn) / (V.invMassAt(P, n) + 1 / M);
          V.applyImpulse(P, n, j);
          // and push the traffic car the other way
          const dvx = (-nx * j) / M, dvz = (-nz * j) / M;
          c.v = Math.max(0, c.v + dvx * fx + dvz * fz);
          c.d += (dvx * rx + dvz * rz) * 0.25;
          worst = Math.max(worst, -vrn);
        }
      };

      // player corners inside the traffic car
      for (let i = 0; i < 4; i++) {
        this.corner(i, P);
        const ux = P.x - cx, uz = P.z - cz;
        const u = ux * fx + uz * fz, w = ux * rx + uz * rz;
        if (Math.abs(u) >= cL || Math.abs(w) >= cW) continue;
        const pu = cL - Math.abs(u), pw = cW - Math.abs(w);
        if (pu < pw) resolve(P.x, P.z, fx * Math.sign(u), fz * Math.sign(u), pu);
        else resolve(P.x, P.z, rx * Math.sign(w), rz * Math.sign(w), pw);
      }
      // traffic car corners inside the player
      for (let i = 0; i < 4; i++) {
        const su = i & 1 ? 1 : -1, sw = i & 2 ? 1 : -1;
        const qx = cx + fx * cL * su + rx * cW * sw;
        const qz = cz + fz * cL * su + rz * cW * sw;
        const ux = qx - V.pos.x, uz = qz - V.pos.z;
        const u = ux * pfx + uz * pfz, w = ux * prx + uz * prz;
        if (Math.abs(u) >= hL || Math.abs(w) >= hW) continue;
        const pu = hL - Math.abs(u), pw = hW - Math.abs(w);
        // move the player away from the corner along its nearest face normal
        if (pu < pw) resolve(qx, qz, -pfx * Math.sign(u), -pfz * Math.sign(u), pu);
        else resolve(qx, qz, -prx * Math.sign(w), -prz * Math.sign(w), pw);
      }
      if (worst > 0.6) {
        this.hit(worst / 9, 'car');
        this.combo = 0;
      }
    }
  }

  hit(power, kind) {
    power = Math.min(1, power);
    if (power < 0.08) return;
    this.events.push({ type: 'hit', power, kind });
  }

  // pure pursuit on the chosen lane + IDM speed keeping
  autopilot(dt, traffic) {
    const V = this.veh;
    const cruise = 27;
    const laneD = LANE_D[this.autoLane];
    const lead = traffic.leader(this, laneD, traffic.cars, null);
    const vLead = lead.o ? lead.o.v : cruise;
    const speed = Math.max(V.fwdSpeed, 0);
    const acc = traffic.idm(speed, cruise, lead.gap, vLead);
    let throttle = 0, brake = 0;
    if (acc < -0.8) brake = clamp(-acc / 8, 0, 0.8);
    else throttle = clamp(0.14 + acc * 0.35 + (cruise - speed) * 0.04, 0, 1);

    this.autoCool -= dt;
    if (this.autoCool <= 0 && lead.o && lead.gap < 50 && vLead < cruise - 3) {
      this.autoCool = 4;
      for (const l of [this.autoLane - 1, this.autoLane + 1]) {
        if (l < 0 || l > 3) continue;
        const f = traffic.leader(this, LANE_D[l], traffic.cars, null);
        const b = traffic.follower(this, LANE_D[l], traffic.cars, null);
        if (f.gap > lead.gap + 15 && b.gap > 14) {
          this.autoLane = l;
          break;
        }
      }
    }
    const look = clamp(speed * 0.9 + 8, 10, 45);
    const T = this.path.point(this.s + look, laneD);
    const dx = T.x - V.pos.x, dz = T.z - V.pos.z;
    const fl = Math.hypot(V.fwd.x, V.fwd.z) || 1, rl = Math.hypot(V.right.x, V.right.z) || 1;
    const lon = (dx * V.fwd.x + dz * V.fwd.z) / fl;
    const lat = (dx * V.right.x + dz * V.right.z) / rl;
    const ang = Math.atan2(lat, Math.max(lon, 0.5));
    const delta = Math.atan2(2 * SPEC.wheelbase * Math.sin(ang), Math.hypot(lat, lon));
    const target = clamp(delta / V.maxSteer(speed), -1, 1);
    this.autoSteer += (target - this.autoSteer) * clamp(dt * 8, 0, 1);
    return { throttle, brake, steer: this.autoSteer };
  }

  // ----------------------------------------------------------------- render
  render(origin) {
    const V = this.veh;
    this.mesh.position.set(V.pos.x - origin.x, V.pos.y - origin.y, V.pos.z - origin.z);
    this.mesh.quaternion.copy(V.quat);
    const qi = this._q.copy(V.quat).invert();
    for (let i = 0; i < 4; i++) {
      const wh = V.wheels[i];
      const w = this.wheels[i];
      w.pivot.position.copy(wh.hub).sub(V.pos).applyQuaternion(qi);
      w.pivot.rotation.set(0, -wh.steerA, 0);
      w.spinner.rotation.x = -wh.spin;
    }
    this.tailMat.color.setRGB(1.3 + this.brake * 2.4, 1.3 + this.brake * 1.2, 1.3 + this.brake * 1.2);
    this.mesh.updateMatrixWorld(true);
    return {
      x: V.pos.x - origin.x,
      y: V.pos.y - SPEC.comH - origin.y,
      z: V.pos.z - origin.z,
      h: this.heading,
    };
  }

  // a point in the car mesh frame (+Z forward, +X left) -> render space
  toWorld(x, y, z, out) {
    return this.inner.localToWorld(out.set(x, y, z));
  }

  gearLabel() {
    const V = this.veh;
    if (V.gear < 0) return 'R';
    if (Math.abs(V.fwdSpeed) < 0.3 && V.throttle < 0.05) return 'N';
    return String(V.gear);
  }
}
