// Traffic on both carriageways. Our side uses a simple IDM car-following
// model with polite lane changes; oncoming traffic just cruises past.
import * as THREE from 'three';
import { makeCar, pickType, CAR_COLORS } from './cars.js';
import { LANE_D, OPP_D } from './world.js';

const AMAX = 1.5, BCOMF = 2.4, HEADWAY = 1.25, S0 = 3.5;

let rs = 12345;
function rnd() {
  rs = (rs * 1664525 + 1013904223) >>> 0;
  return rs / 4294967296;
}

export class Traffic {
  constructor(root, path) {
    this.root = root;
    this.path = path;
    this.cars = [];
    this.opp = [];
    this.density = 1;
    this.f = {};
  }

  makeVehicle(dir) {
    const type = pickType(rnd());
    let color = CAR_COLORS[(rnd() * CAR_COLORS.length) | 0];
    if (type === 'van' && rnd() < 0.6) color = '#e4dfd2';
    if (type === 'bus') color = rnd() < 0.5 ? '#c9a23a' : '#3d6aa0';
    const m = makeCar(type, color);
    this.root.add(m.group);
    return {
      mesh: m.group, tailMat: m.tailMat, dims: m.dims, type,
      L: m.dims.L, W: m.dims.W, dir,
      s: 0, d: 0, lane: 0, target: 0, v: 20, v0: 24, acc: 0, brake: 0,
      blink: 0, blinkSide: 0, cool: rnd() * 5, passed: false,
    };
  }

  init(playerS, n = 30, nOpp = 16) {
    for (let i = 0; i < n; i++) {
      const c = this.makeVehicle(1);
      this.cars.push(c);
      this.place(c, playerS - 120 + rnd() * 760, true);
    }
    for (let i = 0; i < nOpp; i++) {
      const c = this.makeVehicle(-1);
      this.opp.push(c);
      this.placeOpp(c, playerS - 80 + rnd() * 780);
    }
  }

  desiredSpeed(type) {
    const base = type === 'truck' ? 21 : type === 'bus' ? 20 : type === 'van' ? 23 : 25.5;
    return base + (rnd() - 0.5) * 7;
  }

  place(c, s, initial = false) {
    // pick a lane with room around s
    for (let tries = 0; tries < 8; tries++) {
      let lane = (rnd() * 4) | 0;
      if ((c.type === 'truck' || c.type === 'bus') && lane === 0) lane = 2 + ((rnd() * 2) | 0);
      let ok = !(this.planner && this.planner.laneClosed(s, lane));
      for (const o of this.cars) {
        if (o === c) continue;
        if (Math.abs(o.d - LANE_D[lane]) < 2.5 && Math.abs(o.s - s) < 22 + (o.L + c.L) / 2) {
          ok = false;
          break;
        }
      }
      if (this.player && Math.abs(this.player.d - LANE_D[lane]) < 2.5 && Math.abs(this.player.s - s) < 30) ok = false;
      if (ok) {
        c.s = s;
        c.lane = c.target = lane;
        c.d = LANE_D[lane];
        c.v0 = this.desiredSpeed(c.type) - lane * 0.8 * (lane < 2 ? -1 : 1);
        c.v = c.v0 * (initial ? 0.9 : 1);
        c.passed = false;
        c.mesh.visible = true;
        return true;
      }
      s += 15;
    }
    c.mesh.visible = false;
    c.s = -1e9;
    return false;
  }

  placeOpp(c, s) {
    const lane = (rnd() * 3) | 0;
    c.lane = lane;
    c.d = OPP_D[lane];
    c.s = s;
    c.v = 22 + rnd() * 8;
    for (const o of this.opp) {
      if (o !== c && o.lane === lane && Math.abs(o.s - s) < 25) c.s += 30;
    }
  }

  // nearest vehicle ahead in the lateral band around d
  leader(c, d, list, player) {
    let best = null, gap = 1e9;
    for (const o of list) {
      if (o === c || Math.abs(o.d - d) > 2.3) continue;
      const g = o.s - c.s - (o.L + c.L) / 2;
      if (o.s > c.s && g < gap) { gap = g; best = o; }
    }
    if (player && Math.abs(player.d - d) < 2.3 && player.s > c.s) {
      const g = player.s - c.s - (player.L + c.L) / 2;
      if (g < gap) { gap = g; best = player; }
    }
    return { o: best, gap };
  }
  follower(c, d, list, player) {
    let best = null, gap = 1e9;
    for (const o of list) {
      if (o === c || Math.abs(o.d - d) > 2.3) continue;
      const g = c.s - o.s - (o.L + c.L) / 2;
      if (o.s < c.s && g < gap) { gap = g; best = o; }
    }
    if (player && Math.abs(player.d - d) < 2.3 && player.s < c.s) {
      const g = c.s - player.s - (player.L + c.L) / 2;
      if (g < gap) { gap = g; best = player; }
    }
    return { o: best, gap };
  }

  idm(v, v0, gap, vLead) {
    if (gap <= 0.1) return -9;
    const dv = v - vLead;
    const sStar = S0 + Math.max(0, v * HEADWAY + (v * dv) / (2 * Math.sqrt(AMAX * BCOMF)));
    return Math.max(-9, AMAX * (1 - Math.pow(v / v0, 4) - (sStar / gap) ** 2));
  }

  update(dt, player) {
    this.player = player;
    const pS = player.s;
    for (const c of this.cars) {
      if (!c.mesh.visible) {
        // retry placing hidden cars ahead
        this.place(c, pS + 480 + rnd() * 200);
        continue;
      }
      const { o, gap } = this.leader(c, c.d, this.cars, player);
      const PL = this.planner;
      // slow through toll plazas
      const vWant = PL && PL.at(c.s, 'toll', 70) ? Math.min(c.v0, 12) : c.v0;
      let a = this.idm(c.v, vWant, gap, o ? o.v : vWant);

      // roadworks: leave a closed lane (merge left, squeezing in if needed)
      if (PL && c.lane === c.target && PL.laneClosed(c.s, c.lane) && c.lane > 0) {
        c.target = c.lane - 1;
        c.blinkSide = -1;
        c.blink = 1.8;
      }
      // lane changes
      c.cool -= dt;
      const keep = PL && PL.noLaneChange(c.s);
      if (!keep && c.cool <= 0 && c.lane === c.target && o && gap < 45 && o.v < c.v0 - 2.5) {
        c.cool = 3 + rnd() * 4;
        const opts = [c.lane - 1, c.lane + 1].filter((l) => l >= 0 && l < 4);
        if (rnd() < 0.5) opts.reverse();
        for (const l of opts) {
          if ((c.type === 'truck' || c.type === 'bus') && l === 0) continue;
          if (PL && (PL.laneClosed(c.s, l) || PL.laneClosed(c.s + 60, l))) continue;
          const ld = LANE_D[l];
          const fwd = this.leader(c, ld, this.cars, player);
          const back = this.follower(c, ld, this.cars, player);
          const backV = back.o ? back.o.v : 0;
          if (fwd.gap > gap + 12 && back.gap > 12 + Math.max(0, backV - c.v) * 2.5) {
            c.target = l;
            c.blinkSide = l > c.lane ? 1 : -1;
            c.blink = 2.4;
            break;
          }
        }
      }
      // lateral motion toward the target lane
      const td = LANE_D[c.target];
      const ddiff = td - c.d;
      const latV = Math.sign(ddiff) * Math.min(Math.abs(ddiff) * 1.2, 1.3);
      if (c.blink > 1.6 && c.lane !== c.target) {
        // signal before moving
      } else {
        c.d += latV * dt;
      }
      if (Math.abs(ddiff) < 0.05) c.lane = c.target;
      c.blink = Math.max(0, c.blink - dt);
      c.yaw = -Math.atan2(c.blink > 1.6 ? 0 : latV, Math.max(c.v, 3));

      c.acc = a;
      c.v = Math.max(0, c.v + a * dt);
      c.s += c.v * dt;
      const target = a < -0.8 ? 1 : 0;
      c.brake += (target - c.brake) * Math.min(1, dt * 8);

      // recycle cars that drifted out of range
      if (c.s < pS - 170) {
        if (player.v > 18 || rnd() < 0.5) this.place(c, pS + 480 + rnd() * 220);
        else this.place(c, pS - 160 + rnd() * 20);
      } else if (c.s > pS + 760) {
        this.place(c, player.v < 15 ? pS - 165 : pS + 480 + rnd() * 200);
      }
    }
    for (const c of this.opp) {
      c.s -= c.v * dt;
      c.yaw = 0;
      if (c.s < pS - 120) this.placeOpp(c, pS + 560 + rnd() * 240);
    }
  }

  // write mesh transforms (relative to the floating origin) and emit glows
  render(origin, glows, wet, night, time, streak) {
    const f = this.f;
    for (const list of [this.cars, this.opp]) {
      for (const c of list) {
        if (!c.mesh.visible) continue;
        const p = this.path.sample(c.s, f);
        const x = p.x + p.rx * c.d - origin.x;
        const y = p.y - origin.y;
        const z = p.z + p.rz * c.d - origin.z;
        c.mesh.position.set(x, y, z);
        const heading = p.h + (c.dir > 0 ? 0 : Math.PI) + c.yaw * c.dir;
        c.mesh.rotation.set(-Math.atan(p.grade) * c.dir, heading, 0, 'YXZ');
        if (this.wheels) this.wheels.add(c.mesh, c.dims, (c.s * c.dir) / c.dims.wr);
        // lights
        const fx = Math.sin(heading), fz = Math.cos(heading);
        const lx = Math.cos(heading), lz = -Math.sin(heading); // local +X (left)
        const D = c.dims;
        if (c.dir > 0) {
          const k = 0.55 + c.brake * 1.6;
          c.tailMat.color.setRGB(1.2 + c.brake * 2.2, 1.2 + c.brake * 1.2, 1.2 + c.brake * 1.2);
          for (const side of [1, -1]) {
            const gx = x - fx * (D.L / 2 + 0.12) + lx * D.tailX * side;
            const gz = z - fz * (D.L / 2 + 0.12) + lz * D.tailX * side;
            const gy = y + D.tailY;
            glows.add(gx, gy, gz, 1.4 * k, 0.16 * k, 0.08 * k, 0.36 + c.brake * 0.2);
            if (wet > 0.05) streak(gx, gy, gz, y, 1.0 * k * wet, 0.1 * k * wet, 0.05 * k * wet, 1.0);
          }
          // indicator
          if (c.blink > 0 && Math.floor(time * 3) % 2 === 0) {
            const side = -c.blinkSide; // local +X is left
            const gx = x - fx * (D.L / 2 + 0.1) + lx * (D.W / 2 - 0.08) * side;
            const gz = z - fz * (D.L / 2 + 0.1) + lz * (D.W / 2 - 0.08) * side;
            glows.add(gx, y + D.tailY + 0.12, gz, 1.8, 0.9, 0.15, 0.3);
          }
        } else {
          for (const side of [1, -1]) {
            const gx = x + fx * (D.L / 2 + 0.15) + lx * D.headX * side;
            const gz = z + fz * (D.L / 2 + 0.15) + lz * D.headX * side;
            const gy = y + D.headY;
            glows.add(gx, gy, gz, 1.8 * night + 0.3, 1.6 * night + 0.3, 1.2 * night + 0.2, 0.7);
            if (wet > 0.05) streak(gx, gy, gz, y, 0.9 * wet * night, 0.8 * wet * night, 0.6 * wet * night, 1.5);
          }
        }
      }
    }
  }
}
