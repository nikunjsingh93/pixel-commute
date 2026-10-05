// HUD drawn into a canvas at the same low resolution as the 3D view, so
// text and gauges are real pixel art (3x5 font, no smoothing).
import { font } from './font.js';

const C = {
  ink: '#f4f1e8', dim: '#90a8c9', warm: '#ffcd6e', red: '#ee4a33', shadow: '#0c0f1a',
  panel: 'rgba(12,15,26,0.55)', green: '#5b9271',
};


export class Hud {
  constructor(canvas) {
    this.cv = canvas;
    this.g = canvas.getContext('2d');
    this.popups = [];
    this.visible = true;
    this.help = false;
    this.toast = null;
  }

  resize(w, h) {
    this.cv.width = w;
    this.cv.height = h;
    this.w = w;
    this.h = h;
  }

  popup(text, color = C.warm) {
    this.popups.push({ text, color, t: 0 });
    if (this.popups.length > 3) this.popups.shift();
  }

  say(text, dur = 2.2) {
    this.toast = { text, t: 0, dur };
  }

  panel(x, y, w, h) {
    const g = this.g;
    g.fillStyle = C.panel;
    g.fillRect(x, y, w, h);
  }

  text(str, x, y, col = C.ink, sc = 1, align = 'left') {
    const w = font.measure(str, sc);
    if (align === 'right') x -= w;
    else if (align === 'center') x -= Math.floor(w / 2);
    font.shadow(this.g, str, Math.round(x), Math.round(y), sc, col, C.shadow);
    return w;
  }

  draw(st, dt) {
    const g = this.g;
    const { w, h } = this;
    g.clearRect(0, 0, w, h);

    if (st.photo) return; // photo mode: a clean frame
    if (st.mode === 'title') return this.drawTitle(st);
    if (st.paused) return this.drawPause(st);
    if (!this.visible) return;
    const touch = st.touch; // touch layout keeps the corners free for the buttons

    const pad = 4;
    // top-left: clock + period + weather
    const hr = st.hour;
    const hh = Math.floor(hr) % 24;
    const mm = Math.floor((hr % 1) * 60);
    const h12 = ((hh + 11) % 12) + 1;
    const clock = `${h12}:${String(mm).padStart(2, '0')} ${hh < 12 ? 'AM' : 'PM'}`;
    this.text(clock, pad, pad, C.ink);
    this.text(`${st.period}  ${st.weather}`, pad, pad + 7, C.dim);

    // odometer + close calls: top-right (keyboard) or under the clock (touch)
    const km = (st.odo / 1000).toFixed(1);
    if (touch) {
      this.text(`${km} KM`, pad, pad + 40, C.ink);
      if (st.closeCalls > 0) this.text(`CLOSE CALLS ${st.closeCalls}`, pad, pad + 47, C.dim);
    } else {
      this.text(`${km} KM`, w - pad, pad, C.ink, 1, 'right');
      if (st.closeCalls > 0) this.text(`CLOSE CALLS ${st.closeCalls}`, w - pad, pad + 7, C.dim, 1, 'right');
    }

    if (st.commute) this.drawCommute(st.commute, touch, dt);

    // speedometer: bottom-left (keyboard) or top-left (touch)
    const kmh = Math.round(st.speed * 3.6);
    const sx = pad, sy = touch ? pad + 18 : h - pad - 17;
    this.text(String(kmh).padStart(3, ' '), sx, sy, C.ink, 2);
    this.text('KM/H', sx + 25, sy + 5, C.dim);
    // segmented bar
    const segs = 16;
    const lit = Math.round((st.speed / st.vmax) * segs);
    for (let i = 0; i < segs; i++) {
      g.fillStyle = i < lit ? (i > 12 ? C.red : i > 9 ? C.warm : C.ink) : 'rgba(144,168,201,0.35)';
      g.fillRect(sx + i * 3, sy + 13, 2, 3);
    }
    if (st.gear) this.text(st.gear, sx + 42, sy + 5, C.warm);
    if (st.auto) this.text('AUTO', sx + 25, sy - 1 + 0, C.green);

    // bottom-right: radio
    if (st.music && !touch) {
      const name = st.stationName || '';
      const t = st.time;
      // little equaliser
      const ex = w - pad - 9;
      for (let i = 0; i < 3; i++) {
        const bh = 1 + Math.floor((Math.sin(t * (5 + i * 2.3) + i) * 0.5 + 0.5) * 4);
        g.fillStyle = C.warm;
        g.fillRect(ex + i * 3, h - pad - bh, 2, bh);
      }
      this.text(name, ex - 3, h - pad - 5, C.warm, 1, 'right');
    }

    // popups (close calls / bumps) rising from the centre
    let py = Math.floor(h * 0.3);
    for (const p of this.popups) {
      p.t += dt;
      const a = p.t < 1.2 ? 1 : Math.max(0, 1 - (p.t - 1.2) * 2);
      if (a <= 0) continue;
      if (a > 0.3 || Math.floor(p.t * 20) % 2) this.text(p.text, w / 2, py - Math.floor(p.t * 6), p.color, 1, 'center');
      py += 8;
    }
    this.popups = this.popups.filter((p) => p.t < 1.8);

    if (this.toast) {
      this.toast.t += dt;
      if (this.toast.t > this.toast.dur) this.toast = null;
      else {
        const tw = font.measure(this.toast.text) + 8;
        const ty = touch ? Math.floor(h * 0.22) : pad - 1;
        this.panel(Math.floor(w / 2 - tw / 2), ty, tw, 9);
        this.text(this.toast.text, w / 2, ty + 2, C.ink, 1, 'center');
      }
    }

    if (this.help) this.drawHelp(touch);
  }

  // commute mode: cash + fuel gauge, the job and an arrow to the door
  drawCommute(c, touch, dt) {
    const g = this.g;
    const pad = 4;
    const x = touch ? pad : this.w - pad;
    const y = touch ? pad + 54 : pad + 16;
    const al = touch ? 'left' : 'right';
    this.blinkT = (this.blinkT || 0) + dt * 3;
    this.text(`$${Math.floor(c.money)}`, x, y, C.green, 1, al);
    // fuel: E [bar] F
    const bw = 24;
    const bx = touch ? x + 6 : x - bw - 6;
    const low = c.fuel < 0.2;
    const blink = low && Math.floor(this.blinkT) % 2;
    this.text('E', bx - 5, y + 7, low ? C.red : C.dim);
    this.text('F', bx + bw + 2, y + 7, C.dim);
    g.fillStyle = 'rgba(144,168,201,0.35)';
    g.fillRect(bx, y + 8, bw, 3);
    g.fillStyle = low ? (blink ? C.red : C.warm) : C.ink;
    g.fillRect(bx, y + 8, Math.round(bw * Math.max(0, Math.min(1, c.fuel))), 3);
    if (!c.lines) return;
    // the job, top centre
    const top = pad + 10;
    const lw = Math.max(font.measure(c.lines[0]), font.measure(c.lines[1])) + (c.arrow !== null ? 14 : 0) + 8;
    const lx = Math.floor(this.w / 2 - lw / 2);
    this.panel(lx, top - 2, lw, 16);
    const tx = c.arrow !== null ? lx + 14 : lx + 4;
    this.text(c.lines[0], tx, top, C.warm);
    this.text(c.lines[1], tx, top + 7, C.ink);
    if (c.arrow !== null) this.arrow(lx + 7, top + 5, c.arrow);
  }

  // a small pixel arrow, angle 0 = straight ahead (up), + = to the right
  arrow(cx, cy, a) {
    const g = this.g;
    const ux = Math.sin(a), uy = -Math.cos(a);
    g.fillStyle = C.green;
    const dot = (x, y) => g.fillRect(Math.round(cx + x), Math.round(cy + y), 1, 1);
    for (let t = -4; t <= 4; t += 0.5) dot(ux * t, uy * t);
    for (const side of [-1, 1]) {
      const ha = a + Math.PI + side * 0.6;
      const hx = Math.sin(ha), hy = -Math.cos(ha);
      for (let t = 0; t <= 3; t += 0.5) dot(ux * 4 + hx * t, uy * 4 + hy * t);
    }
  }

  controlLines(touch) {
    if (touch) {
      return [
        ['< >', 'STEER'], ['GAS', 'ACCELERATE'], ['BRAKE', 'BRAKE / HOLD'], ['', 'TO REVERSE'], ['HAND', 'HANDBRAKE'],
        ['≡', 'THIS MENU'], ['', 'TAP OUTSIDE TO RESUME'],
      ];
    }
    return [
      ['W / ↑', 'ACCELERATE'], ['S / ↓', 'BRAKE / HOLD TO REVERSE'], ['A D / < >', 'STEER'], ['SHIFT', 'HANDBRAKE'],
      ['SPACE', 'AUTOPILOT ON / OFF'], ['C', 'CAMERA: CHASE FAR COCKPIT'], ['', 'BUMPER CINEMA'],
      ['T', 'TIME OF DAY'], ['R', 'WEATHER'], ['M  /  N', 'RADIO / NEXT STATION'], ['[  ]', 'PIXEL RESOLUTION'],
      ['P', 'PALETTE MODE'], ['F', 'PHOTO MODE'], ['J', 'JOBS (COMMUTE MODE)'], ['U', 'HIDE HUD'], ['ESC', 'PAUSE + MENU'],
      ['PAD', 'STICK STEER  RT GAS  LT BRAKE'],
    ];
  }

  // a panel listing the controls, centred on cx (default: screen centre)
  drawControls(touch, top, cx) {
    const lines = this.controlLines(touch);
    const keyW = Math.max(...lines.map(([k]) => font.measure(k))) + 10;
    const w = keyW + Math.max(...lines.map(([, v]) => font.measure(v))) + 10;
    const h = lines.length * 7 + 8;
    const x = Math.floor((cx ?? this.w / 2) - w / 2);
    const y = top ?? Math.floor(this.h / 2 - h / 2);
    this.panel(x, y, w, h);
    lines.forEach(([k, v], i) => {
      this.text(k, x + 5, y + 5 + i * 7, C.warm);
      this.text(v, x + 5 + keyW, y + 5 + i * 7, C.ink);
    });
    return y + h;
  }

  drawHelp(touch) {
    this.drawControls(touch);
  }

  drawPause(st) {
    const { w, h } = this;
    const g = this.g;
    g.fillStyle = 'rgba(6,8,16,0.55)';
    g.fillRect(0, 0, w, h);
    const lines = this.controlLines(st.touch).length;
    const top = Math.max(18, Math.floor(h / 2 - (lines * 7 + 8) / 2) + 4);
    // the right half holds the menu buttons, so the list sits on the left
    const cx = Math.floor(w * 0.27);
    this.text('PAUSED', cx, top - 15, C.warm, 2, 'center');
    const end = this.drawControls(st.touch, top, cx);
    if (!st.touch) this.text('ESC TO RESUME', cx, Math.min(h - 8, end + 5), C.dim, 1, 'center');
  }

  drawTitle(st) {
    const { w, h } = this;
    const g = this.g;
    const cy = Math.floor(h * 0.28);
    const sc = w >= 300 ? 3 : 2;
    // soft dark bands behind the text
    g.fillStyle = 'rgba(8,10,20,0.62)';
    g.fillRect(0, cy - 8, w, 5 * sc + 32);
    this.text('PIXEL COMMUTE', w / 2, cy, C.warm, sc, 'center');
    this.text('AN ENDLESS DRIVE INTO THE BLUE HOUR', w / 2, cy + 5 * sc + 5, C.dim, 1, 'center');
    if (!st.touch && Math.floor(st.time * 1.6) % 2 === 0) this.text('ENTER TO DRIVE', w / 2, cy + 5 * sc + 14, C.ink, 1, 'center');
    g.fillStyle = C.warm;
    g.fillRect(Math.floor(w / 2 - 30), cy + 5 * sc + 2, 60, 1);
    if (this.help) this.drawHelp(st.touch);
  }
}
