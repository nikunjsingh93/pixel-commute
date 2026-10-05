// The player's cars: model, physics spec, cockpit placement and the garage
// panel (car choice, paint, number plate). The choice is remembered.
import * as THREE from 'three';
import { SPEC } from './vehicle.js';
import { Panel, button, esc } from './ui.js';

const V3 = THREE.Vector3;

// physics specs build on the saloon (SPEC) and override what differs
export const CARS = [
  {
    id: 'saloon', name: 'Saloon', model: 'lux', blurb: 'Big, calm, rear-drive. Made for the night commute.',
    stats: { speed: 4, accel: 3, grip: 3, weight: 4 },
    cockpit: { dy: 0, dz: 0 },
    spec: {},
  },
  {
    id: 'hatch', name: 'Hatch', model: 'hatch', blurb: 'Light and nimble front-driver. Darts through traffic.',
    stats: { speed: 2, accel: 2, grip: 4, weight: 1 },
    cockpit: { dy: 0, dz: -0.55 },
    spec: {
      mass: 1180, inertia: new V3(1500, 1650, 420), wheelbase: 2.55, track: 1.5, comH: 0.5, radius: 0.31, wheelInertia: 1.2,
      kF: 30000, kR: 26000, cBump: 2500, cReb: 3800, arbF: 14000, arbR: 11000,
      gears: [3.6, 2.1, 1.45, 1.1, 0.9, 0.76], finalDrive: 3.9, maxTorque: 240, idle: 800, redline: 6800,
      brakeTorque: 2800, brakeBias: 0.68, cdA: 0.62, drive: [0.5, 0.5, 0, 0], gripK: 1.04, steerK: 1.05, assistK: 1.1,
    },
  },
  {
    id: 'coupe', name: 'Coupe', model: 'coupe', blurb: 'Low, stiff and fast. Rear-drive with a lot of grip.',
    stats: { speed: 5, accel: 5, grip: 5, weight: 2 },
    cockpit: { dy: -0.14, dz: -0.575 },
    spec: {
      mass: 1470, inertia: new V3(2000, 2150, 520), wheelbase: 2.68, track: 1.62, comH: 0.45, radius: 0.34,
      kF: 52000, kR: 50000, cBump: 3800, cReb: 5600, arbF: 22000, arbR: 14000,
      gears: [3.2, 2.2, 1.6, 1.25, 1.0, 0.82, 0.68], finalDrive: 3.6, maxTorque: 640, idle: 900, redline: 7600,
      brakeTorque: 4800, brakeBias: 0.62, cdA: 0.55, gripK: 1.12, steerRate: 10, steerK: 1.12, assistK: 1.25,
    },
  },
  {
    id: 'van', name: 'Van', model: 'van', blurb: 'The delivery van. Heavy, tall and slow, but it carries anything.',
    stats: { speed: 2, accel: 1, grip: 2, weight: 5 },
    cockpit: { dy: 0.5, dz: 0.35 },
    spec: {
      mass: 2350, inertia: new V3(3800, 4300, 1150), wheelbase: 3.3, track: 1.72, comH: 0.85, radius: 0.37, wheelInertia: 2.2,
      kF: 52000, kR: 62000, cBump: 4200, cReb: 6200, arbF: 20000, arbR: 12000,
      gears: [4.2, 2.6, 1.7, 1.25, 1.0, 0.8], finalDrive: 3.4, maxTorque: 430, idle: 700, redline: 4800,
      brakeTorque: 4400, brakeBias: 0.6, cdA: 0.95, gripK: 1.06, steerRate: 7.5, steerK: 0.8, assistK: 0.85,
    },
  },
];

export const PAINTS = ['#15161b', '#e8e4da', '#7a1d1d', '#2c4a6e', '#3d5c47', '#d6b23e', '#e8762a', '#5e636e', '#9fb5d3', '#4a2a55'];

// full physics spec for a car: saloon base + overrides + a hull matched to its size
export function specFor(car, dims) {
  const sp = { ...SPEC, ...car.spec };
  const hx = dims.W / 2 - 0.12, hz = dims.L / 2 - 0.25;
  const yb = 0.3 - sp.comH, yt = dims.H * 0.85 - sp.comH;
  sp.hull = [
    [-hx, yb, -hz], [hx, yb, -hz], [-hx, yb, hz], [hx, yb, hz], [0, yb - 0.02, 0],
    [-hx * 0.9, yt, -hz * 0.3], [hx * 0.9, yt, -hz * 0.3], [-hx * 0.9, yt, hz * 0.4], [hx * 0.9, yt, hz * 0.4], [0, yt + 0.04, 0],
  ];
  return sp;
}

export function carById(id) {
  return CARS.find((c) => c.id === id) || CARS[0];
}

export class Garage {
  // game: { current() -> {car, paint, plate}, apply(sel), close() }
  constructor(game) {
    this.g = game;
    this.panel = new Panel('garage');
    this.panel.onClose = () => this.g.close();
    Object.assign(this.panel.root.style, { left: 'auto', right: 'max(18px, env(safe-area-inset-right))', transform: 'translateY(-50%)', width: 'min(440px, 92vw)' });
  }

  get isOpen() {
    return this.panel.isOpen;
  }

  open(on = true) {
    this.panel.open(on);
    if (on) this.render();
  }

  render() {
    const sel = this.g.current();
    const car = carById(sel.car);
    const el = this.panel.el;
    const bars = (n) => `<span class="bar"><i style="width:${n * 20}%"></i></span>`;
    el.innerHTML = `
      <h2>Garage</h2>
      <div class="row" id="g-cars"></div>
      <div class="muted">${esc(car.blurb)}</div>
      <div class="row" style="display:grid;grid-template-columns:auto auto;gap:4px 12px;margin-top:10px">
        <span>Top speed</span>${bars(car.stats.speed)}
        <span>Acceleration</span>${bars(car.stats.accel)}
        <span>Grip</span>${bars(car.stats.grip)}
        <span>Weight</span>${bars(car.stats.weight)}
      </div>
      <div style="margin-top:10px">Paint</div>
      <div class="row" id="g-paint"></div>
      <div style="margin-top:6px">Number plate</div>
      <div class="row"><input type="text" id="g-plate" maxlength="8" spellcheck="false" autocomplete="off"></div>
      <div class="row" id="g-done" style="margin-top:12px"></div>`;
    const cars = el.querySelector('#g-cars');
    for (const c of CARS) {
      const b = button(cars, c.id === car.id ? 'pill act' : 'pill', esc(c.name), { position: 'relative' }, () => {
        this.g.apply({ ...this.g.current(), car: c.id });
        this.render();
      });
      b.style.position = 'relative';
    }
    const paints = el.querySelector('#g-paint');
    for (const p of PAINTS) {
      const sw = document.createElement('div');
      sw.className = 'ui-swatch' + (p === sel.paint ? ' sel' : '');
      sw.style.background = p;
      // click (not pointerdown): a finger scrolling the panel doesn't pick a paint
      sw.addEventListener('click', (e) => {
        e.stopPropagation();
        this.g.apply({ ...this.g.current(), paint: p });
        this.render();
      });
      paints.appendChild(sw);
    }
    const plate = el.querySelector('#g-plate');
    plate.value = sel.plate;
    plate.addEventListener('keydown', (e) => e.stopPropagation());
    plate.addEventListener('keyup', (e) => e.stopPropagation());
    plate.addEventListener('input', () => {
      const v = plate.value.toUpperCase().replace(/[^A-Z0-9 -]/g, '').slice(0, 8);
      if (v !== plate.value) plate.value = v;
      this.g.apply({ ...this.g.current(), plate: v || '8-BIT' }, true);
    });
    const done = el.querySelector('#g-done');
    const d = button(done, 'pill primary', 'Drive', { position: 'relative', minWidth: '140px' }, () => this.g.close());
    d.style.position = 'relative';
  }
}
