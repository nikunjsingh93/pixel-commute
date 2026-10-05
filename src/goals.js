// Commute mode: light goals next to the pure zen drive.
//  - jobs: carry something to an address in an exit's city loop (Easy
//    Delivery style), or just pick an exit as a destination
//  - a fuel tank that empties as you drive; fill up at an exit's petrol station
//  - tolls and cone fines cost a little, every 10 km is a milestone
// Progress (cash, total km, deliveries, fuel) is kept in localStorage.
import { exitAddresses } from './exits.js';
import { ROAD_R } from './world.js';
import { Panel, button, esc } from './ui.js';

const KEY = 'pixel-commute.career';
// tank (litres) and game range on a full tank (km): shorter than real so
// petrol stops come up every so often
const TANKS = { saloon: [60, 26], hatch: [45, 32], coupe: [55, 19], van: [80, 22] };
const PRICE = 0.55; // $ per litre
const TOLL = 3;
const CONE_FINE = 5;
const MILESTONE = 10; // km
const CARGO = [
  { name: 'PARCEL', k: 1 },
  { name: 'GROCERIES', k: 1.1 },
  { name: 'FLOWERS', k: 1.3, fragile: true },
  { name: 'VINYL RECORDS', k: 1.35, fragile: true },
  { name: 'PIZZA', k: 1.2 },
  { name: 'DESK LAMP', k: 1.4, fragile: true },
  { name: 'HOUSE PLANT', k: 1.25, fragile: true },
  { name: 'BOOKS', k: 1.05 },
  { name: 'GUITAR', k: 1.6, fragile: true },
  { name: 'COFFEE BEANS', k: 1.1 },
];

export class Commute {
  // game: { planner, world, player, path, hud, audio, pause(on) }
  constructor(game) {
    this.g = game;
    this.on = false;
    this.job = null;
    this.tolls = new Set();
    this.lastOdo = 0;
    this.saveT = 0;
    this.warned = 0;
    this.fueling = null;
    this.unload = 0;
    this.offerSeed = 1;
    this.save = { money: 40, km: 0, deliveries: 0, trips: 0, fuel: null, car: null };
    try {
      Object.assign(this.save, JSON.parse(localStorage.getItem(KEY) || '{}'));
    } catch (e) { /* fresh start */ }
    this.panel = new Panel('jobs');
    Object.assign(this.panel.el.style, { width: 'min(560px, 94vw)' });
  }

  get money() { return this.save.money; }
  tank() {
    const id = this.g.player.sel ? this.g.player.sel.car : 'saloon';
    return TANKS[id] || TANKS.saloon;
  }

  persist() {
    try { localStorage.setItem(KEY, JSON.stringify(this.save)); } catch (e) { /* ignore */ }
  }

  start() {
    this.on = true;
    const [cap] = this.tank();
    const car = this.g.player.sel ? this.g.player.sel.car : 'saloon';
    // a new car (or the first drive) comes with a full tank
    if (this.save.fuel === null || this.save.car !== car) this.save.fuel = cap;
    this.save.fuel = Math.min(this.save.fuel, cap);
    this.save.car = car;
    this.lastOdo = this.g.player.odo;
    this.tolls.clear();
    this.persist();
  }

  stop() {
    this.on = false;
    this.job = null;
    this.g.player.throttleCap = 1;
    this.persist();
  }

  // the car was swapped in the garage
  carChanged() {
    if (!this.on) return;
    this.save.fuel = null;
    this.start();
  }

  // ---------------------------------------------------------------- jobs
  exitsAhead(n, minDist = 450) {
    const P = this.g.player, PL = this.g.planner;
    const out = [];
    let s = P.s + minDist;
    while (out.length < n) {
      const f = PL.ahead(s, 'exit');
      if (!f) break;
      out.push(f);
      s = f.s0 + 1;
    }
    return out;
  }

  offers() {
    const exits = this.exitsAhead(4);
    const out = [];
    exits.slice(0, 3).forEach((f, i) => {
      const r = (k) => {
        const x = Math.sin((f.id + 1) * 91.7 + (i + 1) * 13.1 + k * 7.3 + this.offerSeed * 3.1) * 43758.5453;
        return x - Math.floor(x);
      };
      const addrs = exitAddresses(f);
      const drop = Math.floor(r(1) * addrs.length);
      const cargo = CARGO[Math.floor(r(2) * CARGO.length)];
      const dist = f.s0 - this.g.player.s;
      const pay = Math.round((10 + (dist / 1000) * 7) * cargo.k + r(3) * 6);
      out.push({ kind: 'deliver', f, drop, addr: addrs[drop], cargo, pay, damage: 0 });
    });
    return out;
  }

  take(job) {
    this.job = job;
    this.unload = 0;
    const f = job.f;
    if (job.kind === 'deliver') this.g.hud.say(`${job.cargo.name} TO ${job.addr.no} ${job.addr.street} · EXIT ${f.no}`, 3.5);
    else this.g.hud.say(`HEADING FOR EXIT ${f.no} ${f.name}`, 3);
  }

  // ---------------------------------------------------------------- events
  cone() {
    if (!this.on) return;
    this.pay(-CONE_FINE, `CONE -$${CONE_FINE}`);
  }

  hit(power) {
    if (!this.on || !this.job || !this.job.cargo || !this.job.cargo.fragile || power < 0.15) return;
    this.job.damage = Math.min(0.6, this.job.damage + power * 0.25);
    this.g.hud.popup(`${this.job.cargo.name} -${Math.round(this.job.damage * 100)}%`, '#ee4a33');
  }

  pay(amount, text) {
    this.save.money = Math.round((this.save.money + amount) * 100) / 100;
    if (text) this.g.hud.popup(text, amount >= 0 ? '#9fd8b0' : '#ee4a33');
    this.persist();
  }

  // ---------------------------------------------------------------- update
  update(dt) {
    if (!this.on) return;
    const { player: P, world: W, planner: PL, hud, audio } = this.g;
    const [cap, range] = this.tank();
    const S = this.save;

    // distance: fuel, total km, milestones
    const ds = Math.max(0, P.odo - this.lastOdo);
    this.lastOdo = P.odo;
    if (ds > 0 && ds < 200) {
      const load = 0.55 + 0.9 * Math.max(0, P.veh.throttle);
      S.fuel = Math.max(0, S.fuel - (ds / 1000) * (cap / range) * load);
      const before = Math.floor(S.km / MILESTONE);
      S.km += ds / 1000;
      if (Math.floor(S.km / MILESTONE) > before) {
        const m = Math.floor(S.km / MILESTONE) * MILESTONE;
        hud.say(`MILESTONE · ${m} KM DRIVEN`, 3);
        this.pay(10, '+$10 MILESTONE');
        if (audio.chime) audio.chime(3);
      }
    }
    const frac = S.fuel / cap;
    P.throttleCap = S.fuel > 0 ? 1 : 0.22;
    if (frac < 0.2 && this.warned < 1) {
      this.warned = 1;
      const f = this.nextFuel();
      hud.say(f ? `LOW FUEL · PETROL AT EXIT ${f.no} ${f.name}` : 'LOW FUEL', 4);
    } else if (S.fuel <= 0 && this.warned < 2) {
      this.warned = 2;
      hud.say('OUT OF FUEL · LIMP TO A PETROL STATION', 4);
    } else if (frac > 0.3) this.warned = 0;

    const net = W.netAt(P.s);
    const speed = Math.abs(P.v);

    // petrol pumps: stop next to one to fill up
    this.fueling = null;
    if (net && net.pumpAt(P.s, P.d, 3.6) && speed < 1) {
      if (S.fuel < cap - 0.05) {
        let add = Math.min(cap - S.fuel, 9 * dt);
        if (S.money < add * PRICE) {
          // broke: the attendant spots you enough to reach the next job
          if (S.fuel < 12) S.money = Math.max(S.money, add * PRICE);
          else add = Math.max(0, S.money / PRICE);
        }
        if (add > 0) {
          S.fuel += add;
          S.money = Math.round((S.money - add * PRICE) * 100) / 100;
          this.fueling = { full: S.fuel >= cap - 0.05 };
          if (this.fueling.full) {
            hud.say('TANK FULL', 1.6);
            this.persist();
          }
        }
      }
      if (!this.fueling) this.fueling = { full: S.fuel >= cap - 0.05 };
    }

    // tolls
    for (const f of PL.range(P.s - 40, P.s + 10, 'toll')) {
      if (this.tolls.has(f.id) || P.s < f.s0 + 60 || P.d > ROAD_R + 1) continue;
      this.tolls.add(f.id);
      this.pay(-TOLL, `TOLL -$${TOLL}`);
    }

    // the job
    const J = this.job;
    if (J) {
      const f = J.f;
      const onNet = net && net.f === f && (net.contains(P.s, P.d) || P.d > ROAD_R + 2);
      if (J.kind === 'go') {
        if (onNet && P.d > 30) {
          S.trips++;
          hud.say(`ARRIVED · EXIT ${f.no} ${f.name}`, 3);
          if (audio.chime) audio.chime(2);
          this.job = null;
          this.persist();
        }
      } else if (onNet) {
        const dr = net.dropAt(P.s, P.d, 7.5);
        if (dr && dr.no === J.addr.no && dr.street === J.addr.street && speed < 1.6) {
          this.unload += dt;
          if (this.unload > 1.4) {
            const pay = Math.round(J.pay * (1 - J.damage));
            S.deliveries++;
            this.job = null;
            this.pay(pay, `+$${pay} DELIVERED`);
            hud.say(`DELIVERED TO ${J.addr.no} ${J.addr.street}`, 3);
            if (audio.chime) audio.chime(3);
          }
        } else this.unload = 0;
      }
      // drove past (or came back out of) the exit without finishing
      if (this.job && P.s > f.s1 - 20 && P.d < ROAD_R + 1) {
        hud.say(`MISSED EXIT ${f.no} · JOB DROPPED`, 3);
        this.job = null;
      }
    }

    this.saveT += dt;
    if (this.saveT > 5) {
      this.saveT = 0;
      this.persist();
    }
  }

  nextFuel() {
    const PL = this.g.planner, P = this.g.player;
    let s = P.s - 200;
    for (let i = 0; i < 8; i++) {
      const f = PL.ahead(s, 'exit');
      if (!f) return null;
      if (f.fuel && f.s1 > P.s + 40) return f;
      s = f.s0 + 1;
    }
    return null;
  }

  // where the HUD arrow points: the drop (or the pumps), in road space
  target() {
    const J = this.job, P = this.g.player, W = this.g.world;
    if (!J) return null;
    const net = W.netAt(P.s);
    if (!net || net.f !== J.f) return null;
    if (J.kind === 'go') return null;
    const dr = net.drops.find((d) => d.no === J.addr.no && d.street === J.addr.street);
    return dr ? { s: dr.s, d: dr.d } : null;
  }

  // HUD lines for the job + gauges
  hudState() {
    if (!this.on) return null;
    const P = this.g.player, path = this.g.path;
    const [cap] = this.tank();
    const out = { money: this.save.money, fuel: this.save.fuel / cap, lines: null, arrow: null, fueling: this.fueling };
    const J = this.job;
    if (J) {
      const f = J.f;
      const t = this.target();
      if (t) {
        const a = path.point(P.s, P.d, 0), b = path.point(t.s, t.d, 0);
        const dx = b.x - a.x, dz = b.z - a.z;
        const V = P.veh;
        const fl = Math.hypot(V.fwd.x, V.fwd.z) || 1;
        const fx = V.fwd.x / fl, fz = V.fwd.z / fl;
        const rx = V.right.x, rz = V.right.z;
        const rl = Math.hypot(rx, rz) || 1;
        out.arrow = Math.atan2((dx * rx + dz * rz) / rl, dx * fx + dz * fz);
        const m = Math.hypot(dx, dz);
        out.lines = [`${J.cargo.name} > ${J.addr.no} ${J.addr.street}`, this.unload > 0 ? 'UNLOADING...' : `${Math.round(m)} M  · STOP IN THE YELLOW BAY`];
      } else {
        const dist = f.s0 - P.s;
        const head = J.kind === 'deliver' ? `${J.cargo.name} > ${J.addr.no} ${J.addr.street}` : 'DESTINATION';
        const where = dist > 0 ? `EXIT ${f.no} ${f.name}  ${(dist / 1000).toFixed(1)} KM` : `EXIT ${f.no} ${f.name}`;
        out.lines = [head, dist < 900 && dist > -60 ? `${where} · KEEP RIGHT` : where];
      }
    } else if (this.fueling) {
      out.lines = [this.fueling.full ? 'TANK FULL' : 'FILLING UP...', `${Math.round(this.save.fuel)} / ${cap} L  · $${PRICE.toFixed(2)} A LITRE`];
    }
    return out;
  }

  // a pulsing beacon over the drop door
  glows(origin, add, time) {
    const t = this.on && this.target();
    if (!t) return;
    const p = this.g.path.point(t.s, t.d, 0);
    const k = 0.6 + 0.4 * Math.sin(time * 4);
    for (let i = 0; i < 5; i++) {
      add(p.x - origin.x, p.y - origin.y + 0.6 + i * 1.1, p.z - origin.z, 0.35 * k, 1.0 * k, 0.55 * k, 1.1 - i * 0.12);
    }
  }

  // ---------------------------------------------------------------- panel
  open(on) {
    this.panel.open(on);
    if (on) this.render();
  }

  render() {
    const el = this.panel.el;
    const S = this.save;
    const [cap] = this.tank();
    el.innerHTML = `<h2>Jobs</h2>
      <div class="row muted" style="margin-top:0">$${S.money.toFixed(0)} cash · ${S.deliveries} delivered · ${S.km.toFixed(0)} km driven
        · fuel <span class="bar" style="width:70px"><i style="width:${Math.round((S.fuel / cap) * 100)}%"></i></span></div>
      <div id="j-cur"></div>
      <div style="margin-top:10px">Deliveries</div>
      <div class="muted">Take the exit, find the address in the city loop and stop at the door. Fragile cargo pays less if you bump.</div>
      <div class="ui-list" id="j-offers" style="margin-top:6px"></div>
      <div style="margin-top:12px">Just drive to</div>
      <div class="row" id="j-exits"></div>
      <div class="row" id="j-done" style="margin-top:12px"></div>`;
    const btn = (parent, cls, html, fn) => {
      const b = button(parent, cls, html, null, () => fn());
      b.style.position = 'relative';
      return b;
    };
    const P = this.g.player;
    if (this.job) {
      const J = this.job, f = J.f;
      const cur = el.querySelector('#j-cur');
      cur.className = 'row';
      const what = J.kind === 'deliver' ? `${esc(J.cargo.name)} → ${J.addr.no} ${esc(J.addr.street)}` : 'Destination';
      cur.innerHTML = `<span style="color:#9fd8b0">Now: ${what} · Exit ${f.no} ${esc(f.name)} · ${Math.max(0, (f.s0 - P.s) / 1000).toFixed(1)} km</span>`;
      btn(cur, 'small', 'Drop job', () => {
        this.job = null;
        this.render();
      });
    }
    const list = el.querySelector('#j-offers');
    for (const o of this.offers()) {
      const f = o.f;
      const km = ((f.s0 - P.s) / 1000).toFixed(1);
      btn(list, '', `${esc(o.cargo.name)} → ${o.addr.no} ${esc(o.addr.street)}${o.cargo.fragile ? ' · fragile' : ''}<small>Exit ${f.no} ${esc(f.name)} · ${km} km · $${o.pay}${f.fuel ? ' · petrol' : ''}</small>`, () => {
        this.take(o);
        this.close();
      });
    }
    btn(list, 'small', 'New offers', () => {
      this.offerSeed++;
      this.render();
    });
    const ex = el.querySelector('#j-exits');
    for (const f of this.exitsAhead(4, 300)) {
      const km = ((f.s0 - P.s) / 1000).toFixed(1);
      btn(ex, '', `Exit ${f.no} ${esc(f.name)}<small>${km} km${f.fuel ? ' · petrol' : ''}</small>`, () => {
        this.take({ kind: 'go', f });
        this.close();
      });
    }
    btn(el.querySelector('#j-done'), 'primary', 'Done', () => this.close());
  }

  close() {
    this.open(false);
    if (this.g.onClose) this.g.onClose();
  }
}
