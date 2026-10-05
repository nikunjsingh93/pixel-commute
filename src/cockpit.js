// Interior for the cockpit camera: dashboard, binnacle with a live pixel
// instrument cluster, radio screen, steering wheel, pillars, headliner,
// door cards and mirrors. Built in the car mesh frame (+Z forward, +X left),
// left-hand drive, sized for the 'lux' saloon.
import * as THREE from 'three';
import { Builder } from './cars.js';
import { font } from './font.js';

export const EYE = new THREE.Vector3(0.38, 1.33, -0.22);

const interiorMat = new THREE.MeshLambertMaterial({ vertexColors: true });

function beam(b, a, c, t, col) {
  // thin 4-sided strut from a to c (used for the A-pillars)
  const A = new THREE.Vector3(...a), C = new THREE.Vector3(...c);
  const dir = C.clone().sub(A).normalize();
  const side = new THREE.Vector3(0, 1, 0).cross(dir).normalize().multiplyScalar(t);
  const up = dir.clone().cross(side).normalize().multiplyScalar(t);
  const P = (p, s, u) => p.clone().addScaledVector(side, s).addScaledVector(up, u).toArray();
  const ring = (p) => [P(p, -1, -1), P(p, 1, -1), P(p, 1, 1), P(p, -1, 1)];
  const r0 = ring(A), r1 = ring(C);
  const color = new THREE.Color(col);
  for (let i = 0; i < 4; i++) {
    const j = (i + 1) % 4;
    // both windings: the strut is seen from inside and outside
    b.tri(r0[i], r0[j], r1[j], color); b.tri(r0[i], r1[j], r1[i], color);
    b.tri(r0[i], r1[j], r0[j], color); b.tri(r0[i], r1[i], r1[j], color);
  }
}

export class Cockpit {
  // cfg.dy / cfg.dz shift the whole interior (and the eye) to fit each car
  constructor(cfg = { dy: 0, dz: 0 }) {
    this.group = new THREE.Group();
    this.exterior = new THREE.Group();
    this.group.position.set(0, cfg.dy, cfg.dz);
    this.exterior.position.set(0, cfg.dy, cfg.dz);
    this.eye = EYE.clone().add(new THREE.Vector3(0, cfg.dy, cfg.dz));
    const b = new Builder();
    const DASH = '#33353d', DASH_TOP = '#3d4049', TRIMC = '#50535d', HEAD = '#5e5a52', DOOR = '#3a3c44';

    // dashboard: faces the driver, top runs to the windscreen base
    b.tbox(0.86, 0.84, 0.55, 0.84, 0.55, 1.3, 0.62, 1.3, DASH, { top: DASH_TOP, rear: '#1d1e23' });
    // binnacle: the cluster sits in the gap above the wheel hub, seen through the rim
    b.tbox(0.2, 0.19, 0.84, 1.07, 0.6, 0.72, 0.6, 0.72, '#1b1c21', { x: 0.38 });
    b.box(0.2, 0.56, 1.06, 1.08, 0.52, 0.72, '#16171b'); // visor over the display
    // centre console + stack
    b.box(-0.18, 0.18, 0.35, 0.83, 0.45, 0.9, '#202127');
    b.box(-0.14, 0.14, 0.42, 0.7, -0.6, 0.45, '#26272d');
    // air vents
    b.box(0.68, 0.8, 0.76, 0.81, 0.54, 0.56, '#111216');
    b.box(-0.8, -0.68, 0.76, 0.81, 0.54, 0.56, '#111216');
    // door cards with a lighter window sill
    b.box(0.8, 0.86, 0.45, 0.92, -1.5, 1.0, DOOR);
    b.box(0.76, 0.86, 0.92, 0.95, -1.5, 1.0, TRIMC);
    b.box(-0.86, -0.8, 0.45, 0.92, -1.5, 1.0, DOOR);
    b.box(-0.86, -0.76, 0.92, 0.95, -1.5, 1.0, TRIMC);
    // headliner + windscreen header + B-pillars
    b.box(-0.7, 0.7, 1.58, 1.63, -1.15, 0.5, HEAD);
    b.box(-0.68, 0.68, 1.57, 1.62, 0.44, 0.56, '#2a2b31');
    b.box(0.68, 0.8, 0.95, 1.58, -0.85, -0.7, '#2a2b31');
    b.box(-0.8, -0.68, 0.95, 1.58, -0.85, -0.7, '#2a2b31');
    // rear-view mirror (stem + glass)
    b.box(-0.02, 0.02, 1.5, 1.57, 0.47, 0.5, '#1b1c21');
    b.box(-0.12, 0.12, 1.44, 1.51, 0.45, 0.48, '#1b1c21', { rear: '#5a6a86' });
    // A-pillars along the windscreen edges
    beam(b, [0.82, 0.93, 1.24], [0.66, 1.58, 0.46], 0.045, '#24252b');
    beam(b, [-0.82, 0.93, 1.24], [-0.66, 1.58, 0.46], 0.045, '#24252b');
    // seats (seen in the side of the frame when looking around)
    b.box(0.15, 0.68, 0.35, 0.55, -1.05, -0.45, '#3a2f28');
    b.box(-0.68, -0.15, 0.35, 0.55, -1.05, -0.45, '#3a2f28');
    b.box(-0.68, -0.15, 0.55, 1.25, -1.15, -1.0, '#3a2f28');
    this.group.add(new THREE.Mesh(b.geometry(), interiorMat));

    // instrument cluster + radio: canvas screens facing the driver
    this.cv = document.createElement('canvas');
    this.cv.width = 48;
    this.cv.height = 16;
    this.g = this.cv.getContext('2d');
    this.tex = new THREE.CanvasTexture(this.cv);
    this.tex.magFilter = this.tex.minFilter = THREE.NearestFilter;
    this.tex.generateMipmaps = false;
    this.tex.colorSpace = THREE.SRGBColorSpace;
    const scr = new THREE.Mesh(
      new THREE.PlaneGeometry(0.3, 0.1),
      new THREE.MeshBasicMaterial({ map: this.tex, color: new THREE.Color(1.5, 1.5, 1.5) }),
    );
    scr.position.set(0.38, 0.995, 0.592);
    scr.rotation.set(0.15, Math.PI, 0);
    this.group.add(scr);

    this.rcv = document.createElement('canvas');
    this.rcv.width = 32;
    this.rcv.height = 12;
    this.rg = this.rcv.getContext('2d');
    this.rtex = new THREE.CanvasTexture(this.rcv);
    this.rtex.magFilter = this.rtex.minFilter = THREE.NearestFilter;
    this.rtex.generateMipmaps = false;
    this.rtex.colorSpace = THREE.SRGBColorSpace;
    const radio = new THREE.Mesh(
      new THREE.PlaneGeometry(0.26, 0.1),
      new THREE.MeshBasicMaterial({ map: this.rtex, color: new THREE.Color(1.3, 1.3, 1.3) }),
    );
    radio.position.set(0, 0.72, 0.448);
    radio.rotation.set(0.2, Math.PI, 0);
    this.group.add(radio);

    // steering wheel: rim + three spokes, tilted toward the driver
    this.wheel = new THREE.Group();
    const wb = new Builder();
    const n = 14, R = 0.15, t = 0.02;
    const rim = new THREE.Color('#3a3c45');
    for (let i = 0; i < n; i++) {
      const a0 = (i / n) * Math.PI * 2, a1 = ((i + 1) / n) * Math.PI * 2;
      const p = (a, r, z) => [Math.cos(a) * r, Math.sin(a) * r, z];
      for (const [r0, r1, z0, z1] of [[R - t, R + t, -t, -t], [R + t, R + t, -t, t], [R + t, R - t, t, t], [R - t, R - t, t, -t]]) {
        wb.tri(p(a0, r0, z0), p(a1, r0, z0), p(a1, r1, z1), rim);
        wb.tri(p(a0, r0, z0), p(a1, r1, z1), p(a0, r1, z1), rim);
      }
    }
    wb.box(-0.04, 0.04, -0.04, 0.04, -0.035, 0.025, '#4a4d57'); // hub
    wb.box(-0.135, -0.035, -0.012, 0.012, -0.018, 0.018, '#43464f');
    wb.box(0.035, 0.135, -0.012, 0.012, -0.018, 0.018, '#43464f');
    wb.box(-0.012, 0.012, -0.135, -0.035, -0.018, 0.018, '#43464f');
    const wheelMesh = new THREE.Mesh(wb.geometry(), new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide }));
    this.wheelSpin = new THREE.Group();
    this.wheelSpin.add(wheelMesh);
    this.wheel.add(this.wheelSpin);
    this.wheel.position.set(0.38, 1.0, 0.35);
    this.wheel.rotation.x = 0.42; // top of the rim leans away from the driver
    // steering column
    const col = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.05, 0.26), interiorMat.clone());
    col.material.vertexColors = false;
    col.material.color.set('#1b1c21');
    col.position.set(0, -0.0, 0.17);
    this.wheel.add(col);
    this.group.add(this.wheel);

    // exterior door mirrors (always visible)
    const mb = new Builder();
    mb.box(0.93, 1.12, 0.98, 1.12, 1.0, 1.16, '#15161b', { rear: '#4f5d78' });
    mb.box(-1.12, -0.93, 0.98, 1.12, 1.0, 1.16, '#15161b', { rear: '#4f5d78' });
    this.exterior.add(new THREE.Mesh(mb.geometry(), interiorMat));

    this.group.visible = false;
    this._last = '';
  }

  setVisible(v) {
    this.group.visible = v;
  }

  update(steerA, kmh, rpm, gear, redline, station, time) {
    // steering ratio ~14:1 (front wheel angle -> wheel rotation)
    this.wheelSpin.rotation.z = steerA * 14;
    const key = `${Math.round(kmh)}|${Math.round(rpm / 100)}|${gear}|${station}|${Math.floor(time * 2)}`;
    if (key === this._last) return;
    this._last = key;
    const g = this.g;
    g.fillStyle = '#05070c';
    g.fillRect(0, 0, 48, 16);
    // rpm bar
    const segs = 12;
    const lit = Math.round((rpm / redline) * segs);
    for (let i = 0; i < segs; i++) {
      g.fillStyle = i < lit ? (i >= 10 ? '#ee4a33' : '#ffcd6e') : '#1b2236';
      g.fillRect(2 + i * 3, 2, 2, 2);
    }
    font.draw(g, String(Math.round(kmh)).padStart(3, ' '), 3, 7, 1, '#f4f1e8');
    font.draw(g, 'KM/H', 17, 9, 1, '#627ba0');
    font.draw(g, gear, 40, 7, 1, '#ffcd6e');
    this.tex.needsUpdate = true;

    const r = this.rg;
    r.fillStyle = '#071018';
    r.fillRect(0, 0, 32, 12);
    font.draw(r, station, 2, 4, 1, '#7fc8e8');
    this.rtex.needsUpdate = true;
  }
}
