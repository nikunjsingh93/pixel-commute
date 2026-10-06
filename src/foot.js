// On foot: get out of the car anywhere (F), walk / run around in first
// person, get into any car (your own, a parked one, city or highway traffic -
// mini GTA style), take the metro from a station, or the cable car up the
// mountain. Positions are absolute world coordinates like the car's.
import * as THREE from 'three';
import { ROAD_L, GUARD_R } from './world.js';
import { carById } from './garage.js';

const WALK = 2.2, RUN = 6.5, EYE = 1.62, RAD = 0.32;
// traffic models -> the player car whose physics they borrow
const PHYS = { sedan: 'saloon', lux: 'saloon', hatch: 'hatch', coupe: 'coupe', suv: 'saloon', van: 'van', truck: 'van', bus: 'van' };

export class Foot {
  // game: { world, player, traffic, camera, keys, hud, audio, touch() }
  constructor(game) {
    this.g = game;
    this.active = false;
    this.pos = new THREE.Vector3();
    this.y = 0;
    this.s = 0;
    this.d = 0;
    this.yaw = 0;
    this.pitch = 0;
    this.vy = 0;
    this.ride = null;
    this.stick = { x: 0, y: 0 };
    this.run = false;
    this.bob = 0;
    this.prompt = '';
    this._q = {};
    this._g = {};
  }

  // ---------------------------------------------------------------- in / out
  // step out of the player's car at the driver's door
  leaveCar() {
    const P = this.g.player, V = P.veh;
    if (Math.abs(V.fwdSpeed) > 4) {
      this.g.hud.say('SLOW DOWN TO GET OUT', 1.4);
      return false;
    }
    const left = new THREE.Vector3(-V.right.x, 0, -V.right.z).normalize();
    const base = new THREE.Vector3(V.pos.x, 0, V.pos.z);
    let spot = null;
    for (const side of [1, -1]) {
      const p = base.clone().addScaledVector(left, side * (P.W / 2 + 0.75));
      if (!this.blocked(p.x, p.z, V.pos.y)) { spot = p; break; }
    }
    if (!spot) spot = base.clone().addScaledVector(left, P.W / 2 + 0.75);
    this.pos.set(spot.x, 0, spot.z);
    this.y = this.groundAt(spot.x, spot.z, V.pos.y + 0.5);
    this.yaw = Math.atan2(-V.fwd.x, -V.fwd.z);
    this.pitch = 0;
    this.active = true;
    this.ride = null;
    P.onFoot = true;
    P.auto = false;
    this.locate();
    this.g.hud.say('ON FOOT', 1.6);
    return true;
  }

  // the cars you could get into from here (nearest first)
  nearbyCars() {
    const W = this.g.world, P = this.g.player, T = this.g.traffic;
    const out = [];
    const x = this.pos.x, z = this.pos.z;
    const consider = (c, kind, cx, cz, hx, hz, L, Wd, y) => {
      // distance from the walker to the car's footprint
      const dx = x - cx, dz = z - cz;
      const u = dx * hx + dz * hz, w = -dx * hz + dz * hx;
      const ex = Math.max(0, Math.abs(u) - L / 2), ew = Math.max(0, Math.abs(w) - Wd / 2);
      const dist = Math.hypot(ex, ew);
      if (dist < 1.6 && Math.abs(y - this.y) < 2.5) out.push({ c, kind, dist });
    };
    const V = P.veh;
    const fl = Math.hypot(V.fwd.x, V.fwd.z) || 1;
    consider(P, 'own', V.pos.x, V.pos.z, V.fwd.x / fl, V.fwd.z / fl, P.L, P.W, V.pos.y - V.spec.comH);
    const roadBox = (c, kind) => {
      const p = W.path.sample(c.s, this._q);
      const h = p.h + (c.yaw || 0);
      consider(c, kind, p.x + p.rx * c.d, p.z + p.rz * c.d, Math.sin(h), Math.cos(h), c.L, c.W, c.y !== undefined ? c.y : p.y);
    };
    for (const n of W.nets.values()) for (const c of n.cars) if (Math.abs(c.s - this.s) < 14) roadBox(c, n.city ? 'city' : 'exit');
    for (const c of T.cars) if (c.mesh.visible && Math.abs(c.s - this.s) < 14) roadBox(c, 'traffic');
    for (const c of W.parked || []) if (Math.abs(c.s - this.s) < 14) roadBox(c, 'parked');
    // parked cars in a city's parking bays
    for (const n of W.nets.values()) {
      if (!n.tiles) continue;
      for (const t of n.tiles.values()) {
        if (!t.built || !t.parked) continue;
        for (const c of t.parked) if (Math.abs(c.s - this.s) < 14) roadBox(c, 'cityParked');
      }
    }
    out.sort((a, b) => a.dist - b.dist);
    return out;
  }

  // get into a car; anything but your own car is taken over (your old car
  // stays parked where you left it)
  enterCar(hit) {
    const P = this.g.player, W = this.g.world;
    const V = P.veh;
    if (hit.kind === 'own') {
      this.active = false;
      P.onFoot = false;
      this.g.hud.say(P.def.name.toUpperCase(), 1.2);
      return;
    }
    const c = hit.c;
    // where the new car is now
    const p = W.path.sample(c.s, this._q);
    const h = p.h + (c.yaw || 0);
    const x = p.x + p.rx * c.d, z = p.z + p.rz * c.d;
    const y = c.y !== undefined ? c.y : W.path.point(c.s, c.d, 0).y;
    let sel;
    if (hit.kind === 'parked') {
      sel = c.sel;
      W.root.remove(c.mesh);
      W.parked.splice(W.parked.indexOf(c), 1);
    } else {
      const type = c.type || 'sedan';
      sel = { car: PHYS[type] || 'saloon', paint: c.color || '#d8d2c2', plate: P.sel.plate, model: type };
      this.removeNpc(hit);
    }
    // park the old car where it stands
    this.parkPlayerCar();
    P.setCar(sel, false);
    P.veh.placeAt(x, y, z, Math.sin(h), Math.cos(h), 0);
    P.groundP.hint = c.s;
    P.s = c.s;
    P.d = c.d;
    this.active = false;
    P.onFoot = false;
    this.g.hud.say(hit.kind === 'parked' ? 'BACK IN YOUR CAR' : 'TOOK A ' + (c.type || 'CAR').toUpperCase(), 1.8);
    this.g.audio.thump && this.g.audio.thump(0.15);
  }

  removeNpc(hit) {
    const c = hit.c, W = this.g.world;
    if (hit.kind === 'cityParked') {
      const t = c.tile, net = c.net;
      if (c.mesh.parent) c.mesh.parent.remove(c.mesh);
      t.parked.splice(t.parked.indexOf(c), 1);
      const i = t.obstacles.indexOf(c.ob);
      if (i >= 0) t.obstacles.splice(i, 1);
      net.collect();
      return;
    }
    if (hit.kind === 'city' || hit.kind === 'exit') {
      for (const n of W.nets.values()) {
        const i = n.cars.indexOf(c);
        if (i < 0) continue;
        n.cars.splice(i, 1);
        if (c.e) {
          const j = c.e.cars.indexOf(c);
          if (j >= 0) c.e.cars.splice(j, 1);
        }
        c.mesh.parent && c.mesh.parent.remove(c.mesh);
      }
    } else if (hit.kind === 'traffic') {
      // highway traffic: it reappears further on
      c.mesh.visible = false;
    }
  }

  // leave the player's current car as a static, re-enterable prop
  parkPlayerCar() {
    const P = this.g.player, W = this.g.world, V = P.veh;
    const mesh = P.mesh;
    P.mesh = null; // keep setCar from disposing it
    W.parked = W.parked || [];
    const q = P.groundP.project(V.pos.x, V.pos.z, {});
    const p = W.path.sample(q.s, {});
    const heading = Math.atan2(V.fwd.x, V.fwd.z);
    const feet = V.pos.y - V.spec.comH;
    W.parked.push({ mesh, sel: { ...P.sel }, s: q.s, d: q.d, L: P.L, W: P.W, yaw: heading - p.h, y: feet, y0: feet - 0.5, y1: feet + 1.5, kind: 'parked' });
    if (W.parked.length > 6) {
      const old = W.parked.shift();
      W.root.remove(old.mesh);
      old.mesh.traverse((o) => o.geometry && !o.userData.shared && o.geometry.dispose());
    }
  }

  // ---------------------------------------------------------------- ground
  groundAt(x, z, refY) {
    const G = this.g.player.groundP;
    this._g.refY = refY;
    return G.ground(x, z, this._g);
  }
  locate() {
    const q = this.g.player.groundP.project(this.pos.x, this.pos.z, this._q);
    this.s = q.s;
    this.d = q.d;
    return q;
  }
  // is a circle at (x, z) inside something solid?
  blocked(x, z, y) {
    const W = this.g.world;
    const q = this.g.player.groundP.project(x, z, {});
    for (const ob of W.allObstacles()) {
      if (Math.abs(ob.s - q.s) > ob.L / 2 + 2 || Math.abs(ob.d - q.d) > ob.W / 2 + 2) continue;
      if (ob.y1 !== undefined && (y > ob.y1 - 0.2 || y + 1.7 < ob.y0)) continue;
      if (Math.abs(ob.s - q.s) < ob.L / 2 + RAD && Math.abs(ob.d - q.d) < ob.W / 2 + RAD) return true;
    }
    return false;
  }

  // ---------------------------------------------------------------- update
  look(dx, dy) {
    this.yaw -= dx * 0.0032;
    this.pitch = Math.max(-1.35, Math.min(1.35, this.pitch - dy * 0.0028));
  }

  update(dt, keys) {
    if (this.ride) return this.updateRide(dt);
    const W = this.g.world;
    // input: keys or the touch stick
    let mx = 0, mz = 0;
    if (keys.has('KeyW') || keys.has('ArrowUp')) mz += 1;
    if (keys.has('KeyS') || keys.has('ArrowDown')) mz -= 1;
    if (keys.has('KeyD') || keys.has('ArrowRight')) mx += 1;
    if (keys.has('KeyA') || keys.has('ArrowLeft')) mx -= 1;
    mx += this.stick.x;
    mz += this.stick.y;
    const ml = Math.hypot(mx, mz);
    if (ml > 1) { mx /= ml; mz /= ml; }
    const run = this.run || keys.has('ShiftLeft') || keys.has('ShiftRight');
    const sp = (run ? RUN : WALK) * Math.min(1, ml);
    const fx = -Math.sin(this.yaw), fz = -Math.cos(this.yaw);
    const rx = Math.cos(this.yaw), rz = -Math.sin(this.yaw);
    const vx = (fx * mz + rx * mx) * sp, vz = (fz * mz + rz * mx) * sp;
    // move each axis separately so walls let you slide along them
    for (const [ax, az] of [[vx * dt, 0], [0, vz * dt]]) {
      if (!ax && !az) continue;
      const nx = this.pos.x + ax, nz = this.pos.z + az;
      const gy = this.groundAt(nx, nz, this.y + 0.6);
      if (gy > this.y + 0.65) continue; // a step too high
      if (this.blocked(nx, nz, this.y)) continue;
      if (this.hitsCar(nx, nz)) continue;
      this.pos.x = nx;
      this.pos.z = nz;
    }
    this.fences();
    // gravity / stick to the ground
    const gy = this.groundAt(this.pos.x, this.pos.z, this.y + 0.6);
    if (this.y > gy + 0.05) {
      this.vy -= 9.8 * dt;
      this.y = Math.max(gy, this.y + this.vy * dt);
    } else {
      this.y = gy;
      this.vy = 0;
    }
    this.bob += sp * dt * 1.9;
    this.locate();
    // what can we do here?
    this.prompt = this.findAction() ? this.findAction().label : '';
    void W;
  }

  // keep off the opposite carriageway / outside the highway rails, inside
  // a city's bounds
  fences() {
    const W = this.g.world;
    const q = this.locate();
    const net = W.netAt(q.s);
    if (net && net.city) {
      const layer = net.layerAt(q.s - net.S, q.d, this.y);
      if (layer === 'city') {
        const { du, dv } = net.cityPush(q.s - net.S, q.d);
        this.pos.x += q.fx * du + q.rx * dv;
        this.pos.z += q.fz * du + q.rz * dv;
        return;
      }
    }
    let dd = 0;
    if (q.d < ROAD_L + 0.35) dd = ROAD_L + 0.35 - q.d;
    const maxD = net ? net.hwMax(q.s, GUARD_R - 0.35) : GUARD_R - 0.35;
    if (q.d > maxD && !(net && net.contains(q.s, q.d))) {
      if (net) {
        const po = net.pushOut(q.s, q.d);
        if (po.pen < q.d - maxD) {
          this.pos.x += (q.fx * po.ds + q.rx * po.dd) * po.pen;
          this.pos.z += (q.fz * po.ds + q.rz * po.dd) * po.pen;
          return;
        }
      }
      dd = maxD - q.d;
    }
    this.pos.x += q.rx * dd;
    this.pos.z += q.rz * dd;
  }

  // cars are solid too (a person can't walk through them)
  hitsCar(x, z) {
    const P = this.g.player, V = P.veh;
    const fl = Math.hypot(V.fwd.x, V.fwd.z) || 1;
    const hx = V.fwd.x / fl, hz = V.fwd.z / fl;
    const dx = x - V.pos.x, dz = z - V.pos.z;
    const u = dx * hx + dz * hz, w = -dx * hz + dz * hx;
    if (Math.abs(u) < P.L / 2 + RAD && Math.abs(w) < P.W / 2 + RAD && Math.abs(V.pos.y - V.spec.comH - this.y) < 2) return true;
    for (const n of this.g.world.nets.values()) {
      for (const c of n.cars) {
        if (Math.abs(c.s - this.s) > 10) continue;
        const p = this.g.world.path.sample(c.s, this._q);
        const h = p.h + (c.yaw || 0);
        const cx = p.x + p.rx * c.d, cz = p.z + p.rz * c.d;
        const ddx = x - cx, ddz = z - cz, chx = Math.sin(h), chz = Math.cos(h);
        const uu = ddx * chx + ddz * chz, ww = -ddx * chz + ddz * chx;
        if (Math.abs(uu) < c.L / 2 + RAD && Math.abs(ww) < c.W / 2 + RAD && (c.y === undefined || Math.abs(c.y - this.y) < 2)) return true;
      }
    }
    return false;
  }

  // ---------------------------------------------------------------- actions
  // the thing F does here, if anything: { label, run }
  findAction() {
    const W = this.g.world;
    const net = W.netAt(this.s);
    if (net && net.city && net.lay && net.gEdges) {
      const u = this.s - net.S, v = this.d, lay = net.lay;
      for (const st of lay.stations) {
        if (st.entrance && Math.hypot(u - st.entrance.u, v - st.entrance.v) < 7 && this.y < net.base + 3) {
          return { label: 'F  TAKE THE METRO · ' + st.name, run: () => this.startRide({ kind: 'train', net, st, phase: 'platform' }) };
        }
      }
      const C = lay.cable;
      for (const [end, v0] of [['bottom', C.v0], ['top', C.v1]]) {
        const h = net.mountainH(C.u, v0);
        if (Math.hypot(u - C.u, v - (v0 + (end === 'bottom' ? -9 : 9))) < 9 && Math.abs(this.y - (net.base + h)) < 4) {
          return { label: end === 'bottom' ? 'F  CABLE CAR TO THE SUMMIT' : 'F  CABLE CAR DOWN TO THE CITY', run: () => this.startRide({ kind: 'cable', net, end, phase: 'wait' }) };
        }
      }
    }
    const cars = this.nearbyCars();
    if (cars.length) {
      const h = cars[0];
      const what = h.kind === 'own' ? 'GET IN' : h.kind === 'parked' ? 'GET IN YOUR CAR' : 'TAKE THIS ' + (h.c.type || 'CAR').toUpperCase();
      return { label: 'F  ' + what, run: () => this.enterCar(h) };
    }
    return null;
  }

  action() {
    if (this.ride) return this.rideAction();
    const a = this.findAction();
    if (a) a.run();
  }

  // ---------------------------------------------------------------- rides
  startRide(r) {
    this.ride = r;
    r.t = 0;
    this.g.hud.say(r.kind === 'train' ? r.st.name + ' STATION' : 'CABLE CAR', 1.8);
  }

  rideAction() {
    const r = this.ride;
    if (r.kind === 'train') {
      if (r.phase === 'platform') {
        if (r.ready) { r.phase = 'onboard'; r.train = r.ready; r.boardedAt = r.st; this.g.hud.say('ALL ABOARD', 1.2); }
        else { this.endRide(r.st); }
      } else if (r.phase === 'onboard') {
        if (r.train.state === 'dwell' && r.train.at && r.train.at !== r.boardedAt) this.endRide(r.train.at);
        else { r.getOff = !r.getOff; this.g.hud.say(r.getOff ? 'GETTING OFF AT THE NEXT STOP' : 'STAYING ON', 1.4); }
      }
    } else if (r.kind === 'cable') {
      if (r.phase === 'wait' && r.ready) { r.phase = 'onboard'; r.cabin = r.ready; this.g.hud.say('ENJOY THE VIEW', 1.4); }
      else if (r.phase === 'wait') this.endCable(r.end);
    }
  }

  // back on the street at a station entrance
  endRide(st) {
    const net = this.ride.net;
    this.ride = null;
    const w = net.wp(st.entrance.u, st.entrance.v + (st.v < 150 ? -2.5 : 2.5), 0);
    this.pos.set(net.A.x + w[0], 0, net.A.z + w[2]);
    this.y = net.base;
    this.locate();
    this.g.hud.say(st.name, 1.6);
  }
  endCable(end) {
    const net = this.ride.net, C = net.lay.cable;
    this.ride = null;
    const v = end === 'bottom' ? C.v0 - 10 : C.v1 + 10;
    const w = net.wp(C.u, v, 0);
    this.pos.set(net.A.x + w[0], 0, net.A.z + w[2]);
    this.y = this.groundAt(this.pos.x, this.pos.z, net.base + 400);
    this.locate();
  }

  updateRide(dt) {
    const r = this.ride, net = r.net;
    r.t += dt;
    if (r.kind === 'train') {
      if (r.phase === 'platform') {
        // stand on the platform beside the track of the next train due here
        const due = net.trains.find((tr) => tr.state === 'dwell' && tr.at === r.st) || net.trains.find((tr) => tr.next === r.st) || net.trains[0];
        const pl = due.off > 0 ? r.st.platformR : r.st.platformL;
        const w = net.wp(pl.u, pl.v, net.lay.metro.h + 0.45);
        this.pos.set(net.A.x + w[0], 0, net.A.z + w[2]);
        this.y = net.A.y + w[1];
        r.ready = net.trains.find((tr) => tr.state === 'dwell' && tr.at === r.st) || null;
        this.prompt = r.ready ? 'F  BOARD THE TRAIN' : 'WAITING FOR A TRAIN...  (F LEAVE)';
      } else {
        const tr = r.train;
        // seated inside the leading car, by the window
        const p = net.trainPos(tr, tr.t - tr.dir * 6, {});
        const w = net.wp(p.u, p.v, net.lay.metro.h + 0.75);
        this.pos.set(net.A.x + w[0], 0, net.A.z + w[2]);
        this.y = net.A.y + w[1];
        this.trainDir = Math.atan2(net.F.x * p.tu + net.Rv.x * p.tv, net.F.z * p.tu + net.Rv.z * p.tv);
        if (tr.state === 'dwell' && tr.at && tr.at !== r.boardedAt && r.getOff) return this.endRide(tr.at);
        if (tr.state === 'run') r.boardedAt = null;
        this.prompt = tr.state === 'dwell' && tr.at && tr.at !== r.boardedAt ? tr.at.name + '  · F GET OFF' : 'NEXT: ' + (tr.next ? tr.next.name : '') + (r.getOff ? '  · GETTING OFF' : '  · F GET OFF NEXT STOP');
      }
    } else {
      const C = net.lay.cable;
      if (r.phase === 'wait') {
        const v = r.end === 'bottom' ? C.v0 - 4 : C.v1 + 4;
        const h = net.mountainH(C.u, r.end === 'bottom' ? C.v0 : C.v1) + 0.6;
        const w = net.wp(C.u, v, h);
        this.pos.set(net.A.x + w[0], 0, net.A.z + w[2]);
        this.y = net.A.y + w[1];
        const x = r.end === 'bottom' ? 0 : 1;
        r.ready = net.cableDocked === r.end ? net.cabins.find((cb) => Math.abs(cb.x - x) < 0.01) : null;
        this.prompt = r.ready ? 'F  BOARD THE CABLE CAR' : 'THE NEXT CABIN IS ON ITS WAY...  (F LEAVE)';
      } else {
        const cb = r.cabin;
        const q = net.cablePos(cb.x);
        const w = net.wp(C.u + cb.off, q.v, q.h - 3.25);
        this.pos.set(net.A.x + w[0], 0, net.A.z + w[2]);
        this.y = net.A.y + w[1];
        this.prompt = 'CABLE CAR  ' + Math.round(q.h) + ' M';
        // arrived at the other end
        const arrived = (r.end === 'bottom' && cb.x > 0.999 && net.cableDocked === 'top') || (r.end === 'top' && cb.x < 0.001 && net.cableDocked === 'bottom');
        if (arrived) this.endCable(r.end === 'bottom' ? 'top' : 'bottom');
      }
    }
    this.locate();
  }

  // ---------------------------------------------------------------- camera
  applyCamera(camera) {
    const bob = this.ride ? 0 : Math.sin(this.bob * 2) * 0.035;
    camera.position.set(this.pos.x - this.g.world.origin.x, this.y + EYE + bob - this.g.world.origin.y, this.pos.z - this.g.world.origin.z);
    camera.up.set(0, 1, 0);
    let yaw = this.yaw;
    if (this.ride && this.ride.kind === 'train' && this.ride.phase === 'onboard' && this.trainDir !== undefined) {
      // the look is relative to the train's heading
      yaw = this.trainDir + Math.PI + this.yaw;
    }
    camera.rotation.set(this.pitch, yaw, 0, 'YXZ');
    camera.near = 0.08;
    camera.fov += (68 - camera.fov) * 0.2;
    camera.updateProjectionMatrix();
  }
}

export { PHYS, carById };
