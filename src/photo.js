// Photo mode: the world freezes, the HUD hides and the camera orbits the
// car (drag / A D to circle it, wheel / W S for distance), or flies freely. Snap saves the current pixel-art frame upscaled with
// nearest-neighbour sampling (crisp pixels) plus a tiny watermark.
//   desktop: orbit: drag or A/D + Q/E to circle, W/S or wheel for distance;
//            free (O): WASD move, Q/E down/up, drag or arrows to look, wheel to zoom;
//            Enter/Space snap, P filter, T time, R weather, Esc/F exit
//   touch  : d-pad + up/down + zoom buttons, drag to look, big snap button
import * as THREE from 'three';
import { layer, button, flash } from './ui.js';
import { edge } from './touch.js';
import { font } from './font.js';

const MAX_DIST = 70; // keep the camera near the car (the world streams around it)

export class PhotoMode {
  constructor(game) {
    this.g = game; // { keys, camera, carPos(), groundY(x,z), press(code), touch(), snapCanvas() -> canvas }
    this.active = false;
    this.pos = new THREE.Vector3();
    this.yaw = 0;
    this.pitch = 0;
    this.fov = 50;
    this.hideCar = false;
    this.drag = null;
    // orbit camera around the car (default) vs a free-flying one
    this.orbit = true;
    this.oYaw = 0;
    this.oPitch = 0.2;
    this.oDist = 8;
    this.buildUI();
    // look around by dragging on the picture (mouse or finger)
    window.addEventListener('pointerdown', (e) => {
      if (!this.active || this.drag) return;
      this.drag = { id: e.pointerId, x: e.clientX, y: e.clientY };
    });
    window.addEventListener('pointermove', (e) => {
      if (!this.drag || e.pointerId !== this.drag.id) return;
      const k = 0.005 * (this.fov / 50);
      if (this.orbit) {
        this.oYaw -= (e.clientX - this.drag.x) * 0.008;
        this.oPitch = Math.max(-0.1, Math.min(1.45, this.oPitch + (e.clientY - this.drag.y) * 0.006));
      } else {
        this.yaw -= (e.clientX - this.drag.x) * k;
        this.pitch = Math.max(-1.4, Math.min(1.4, this.pitch - (e.clientY - this.drag.y) * k));
      }
      this.drag.x = e.clientX;
      this.drag.y = e.clientY;
    });
    const end = (e) => {
      if (this.drag && e.pointerId === this.drag.id) this.drag = null;
    };
    window.addEventListener('pointerup', end);
    window.addEventListener('pointercancel', end);
    window.addEventListener('wheel', (e) => {
      if (!this.active) return;
      if (this.orbit) this.oDist = Math.max(2.5, Math.min(45, this.oDist * (e.deltaY > 0 ? 1.1 : 1 / 1.1)));
      else this.fov = Math.max(12, Math.min(95, this.fov * (e.deltaY > 0 ? 1.08 : 1 / 1.08)));
    }, { passive: true });
  }

  buildUI() {
    const L = layer('photo-ui');
    L.classList.add('hidden');
    this.layer = L;
    const br = edge('right'), bl = edge('left'), bb = edge('bottom');
    const top = 'max(12px, env(safe-area-inset-top))';
    const hold = (code) => [() => this.g.keys.add(code), () => this.g.keys.delete(code)];
    const P = 'clamp(42px, 10vmin, 54px)';
    // top-right bar (desktop and touch)
    const tb = (label, i, fn) =>
      button(L, 'pill small', label, { width: `calc(${P} + 22px)`, height: P, top, right: `calc(${br} + ${i} * (${P} + 30px))` }, fn);
    tb('Exit', 0, () => this.g.press('Escape'));
    this.filterBtn = tb('Filter', 1, () => this.g.press('KeyP'));
    tb('Time', 2, () => this.g.press('KeyT'));
    tb('Weather', 3, () => this.g.press('KeyR'));
    this.carBtn = tb('Car', 4, () => {
      this.hideCar = !this.hideCar;
      this.carBtn.classList.toggle('act', !this.hideCar);
    });
    this.carBtn.classList.add('act');
    this.orbitBtn = tb('Orbit', 5, () => this.toggleOrbit());
    this.orbitBtn.classList.add('act');
    // snap (bottom-right)
    const SN = 'clamp(76px, 20vmin, 110px)';
    button(L, '', '<svg viewBox="0 0 24 24"><path d="M4 8h3l2-3h6l2 3h3v11H4z"/><circle cx="12" cy="13" r="3.5"/></svg><span>Snap</span>',
      { width: SN, height: SN, right: br, bottom: bb }, () => this.snap());
    // movement pad (touch only)
    this.pad = document.createElement('div');
    this.pad.style.cssText = 'position:absolute;inset:0;pointer-events:none';
    L.appendChild(this.pad);
    const D = 'clamp(48px, 12vmin, 64px)';
    const g = '6px';
    const arrow = (d) => `<svg viewBox="0 0 24 24"><path d="${d}"/></svg>`;
    button(this.pad, 'pill', arrow('M4 15l8-8 8 8'), { width: D, height: D, left: `calc(${bl} + ${D} + ${g})`, bottom: `calc(${bb} + 2 * (${D} + ${g}))` }, ...hold('KeyW'));
    button(this.pad, 'pill', arrow('M4 9l8 8 8-8'), { width: D, height: D, left: `calc(${bl} + ${D} + ${g})`, bottom: bb }, ...hold('KeyS'));
    button(this.pad, 'pill', arrow('M15 4 7 12l8 8'), { width: D, height: D, left: bl, bottom: `calc(${bb} + ${D} + ${g})` }, ...hold('KeyA'));
    button(this.pad, 'pill', arrow('M9 4l8 8-8 8'), { width: D, height: D, left: `calc(${bl} + 2 * (${D} + ${g}))`, bottom: `calc(${bb} + ${D} + ${g})` }, ...hold('KeyD'));
    const cx = `calc(${bl} + 3 * (${D} + ${g}) + 14px)`;
    button(this.pad, 'pill small', 'Up', { width: D, height: D, left: cx, bottom: `calc(${bb} + ${D} + ${g})` }, ...hold('KeyE'));
    button(this.pad, 'pill small', 'Down', { width: D, height: D, left: cx, bottom: bb }, ...hold('KeyQ'));
    const zx = `calc(${br} + clamp(76px, 20vmin, 110px) + 16px)`;
    button(this.pad, 'pill', '+', { width: D, height: D, right: zx, bottom: `calc(${bb} + ${D} + ${g})`, fontSize: '20px' }, ...hold('Equal'));
    button(this.pad, 'pill', '-', { width: D, height: D, right: zx, bottom: bb, fontSize: '20px' }, ...hold('Minus'));
    // keyboard hint (desktop)
    this.hint = document.createElement('div');
    this.hint.style.cssText = `position:absolute;left:${bl};bottom:${bb};color:#f4f1e8;font:700 11px/1.6 'Courier New',monospace;letter-spacing:1px;
      text-shadow:0 1px 4px #000;background:rgba(10,13,24,.55);padding:6px 10px;border-radius:8px;pointer-events:none`;
    L.appendChild(this.hint);
    this.updateHint();
  }

  updateHint() {
    this.hint.innerHTML = this.orbit
      ? 'PHOTO MODE &middot; ORBIT<br>DRAG OR A / D CIRCLE THE CAR &middot; Q / E HEIGHT<br>WHEEL OR W / S DISTANCE &middot; + / - ZOOM<br>O FREE CAMERA &middot; ENTER SNAP &middot; P FILTER &middot; ESC EXIT'
      : 'PHOTO MODE &middot; FREE<br>WASD MOVE &middot; Q / E DOWN / UP &middot; SHIFT FAST<br>DRAG OR ARROWS LOOK &middot; WHEEL ZOOM<br>O ORBIT &middot; ENTER SNAP &middot; P FILTER &middot; ESC EXIT';
    this.orbitBtn.innerHTML = this.orbit ? 'Orbit' : 'Free';
    this.orbitBtn.classList.toggle('act', this.orbit);
  }

  // orbit angles from wherever the camera is now
  orbitFrom(pos) {
    const c = this.focus();
    const dx = pos.x - c.x, dy = pos.y - c.y, dz = pos.z - c.z;
    this.oDist = Math.max(2.5, Math.min(45, Math.hypot(dx, dy, dz)));
    this.oYaw = Math.atan2(dx, dz);
    this.oPitch = Math.max(-0.1, Math.min(1.45, Math.asin(Math.max(-1, Math.min(1, dy / this.oDist)))));
  }

  focus() {
    const c = this.g.carPos();
    return { x: c.x, y: c.y + 0.7, z: c.z };
  }

  toggleOrbit() {
    this.orbit = !this.orbit;
    if (this.orbit) this.orbitFrom(this.pos);
    this.updateHint();
  }

  enter(camera) {
    this.active = true;
    this.pos.copy(camera.position);
    const dir = camera.getWorldDirection(new THREE.Vector3());
    this.yaw = Math.atan2(-dir.x, -dir.z);
    this.pitch = Math.asin(Math.max(-1, Math.min(1, dir.y)));
    this.fov = camera.fov;
    this.hideCar = false;
    this.carBtn.classList.add('act');
    this.orbit = true;
    this.orbitFrom(this.pos);
    this.updateHint();
    this.layer.classList.remove('hidden');
    const touch = this.g.touch();
    this.pad.style.display = touch ? '' : 'none';
    this.hint.style.display = touch ? 'none' : '';
  }

  exit() {
    this.active = false;
    this.layer.classList.add('hidden');
    for (const k of ['KeyW', 'KeyS', 'KeyA', 'KeyD', 'KeyQ', 'KeyE', 'Equal', 'Minus']) this.g.keys.delete(k);
  }

  update(dt) {
    const K = this.g.keys;
    if (this.orbit) {
      const rs = 1.5 * dt;
      if (K.has('KeyA') || K.has('ArrowLeft')) this.oYaw -= rs;
      if (K.has('KeyD') || K.has('ArrowRight')) this.oYaw += rs;
      if (K.has('KeyE') || K.has('ArrowUp')) this.oPitch = Math.min(1.45, this.oPitch + rs * 0.6);
      if (K.has('KeyQ') || K.has('ArrowDown')) this.oPitch = Math.max(-0.1, this.oPitch - rs * 0.6);
      if (K.has('KeyW')) this.oDist = Math.max(2.5, this.oDist * (1 - dt * 1.2));
      if (K.has('KeyS')) this.oDist = Math.min(45, this.oDist * (1 + dt * 1.2));
      if (K.has('Equal')) this.fov = Math.max(12, this.fov * (1 - dt * 0.9));
      if (K.has('Minus')) this.fov = Math.min(95, this.fov * (1 + dt * 0.9));
      const c = this.focus();
      const cp = Math.cos(this.oPitch);
      this.pos.set(c.x + Math.sin(this.oYaw) * cp * this.oDist, c.y + Math.sin(this.oPitch) * this.oDist, c.z + Math.cos(this.oYaw) * cp * this.oDist);
      const gy = this.g.groundY(this.pos.x, this.pos.z) + 0.25;
      if (this.pos.y < gy) this.pos.y = gy;
      const dx = c.x - this.pos.x, dy = c.y - this.pos.y, dz = c.z - this.pos.z;
      this.yaw = Math.atan2(-dx, -dz);
      this.pitch = Math.atan2(dy, Math.hypot(dx, dz));
      return;
    }
    const fast = K.has('ShiftLeft') || K.has('ShiftRight') ? 3 : 1;
    const sp = 7 * fast * dt;
    const fx = -Math.sin(this.yaw), fz = -Math.cos(this.yaw);
    const rx = Math.cos(this.yaw), rz = -Math.sin(this.yaw);
    let mx = 0, mz = 0, my = 0;
    if (K.has('KeyW')) { mx += fx; mz += fz; }
    if (K.has('KeyS')) { mx -= fx; mz -= fz; }
    if (K.has('KeyD')) { mx += rx; mz += rz; }
    if (K.has('KeyA')) { mx -= rx; mz -= rz; }
    if (K.has('KeyE')) my += 1;
    if (K.has('KeyQ')) my -= 1;
    this.pos.x += mx * sp;
    this.pos.z += mz * sp;
    this.pos.y += my * sp;
    const rs = 1.4 * dt * (this.fov / 50);
    if (K.has('ArrowLeft')) this.yaw += rs;
    if (K.has('ArrowRight')) this.yaw -= rs;
    if (K.has('ArrowUp')) this.pitch = Math.min(1.4, this.pitch + rs);
    if (K.has('ArrowDown')) this.pitch = Math.max(-1.4, this.pitch - rs);
    if (K.has('Equal')) this.fov = Math.max(12, this.fov * (1 - dt * 0.9));
    if (K.has('Minus')) this.fov = Math.min(95, this.fov * (1 + dt * 0.9));
    // stay near the car and above the ground
    const c = this.g.carPos();
    const dx = this.pos.x - c.x, dz = this.pos.z - c.z;
    const d = Math.hypot(dx, dz);
    if (d > MAX_DIST) {
      this.pos.x = c.x + (dx / d) * MAX_DIST;
      this.pos.z = c.z + (dz / d) * MAX_DIST;
    }
    const gy = this.g.groundY(this.pos.x, this.pos.z) + 0.25;
    this.pos.y = Math.max(gy, Math.min(c.y + 60, this.pos.y));
  }

  apply(camera) {
    camera.position.copy(this.pos);
    camera.up.set(0, 1, 0);
    camera.rotation.set(this.pitch, this.yaw, 0, 'YXZ');
    camera.fov = this.fov;
    camera.near = 0.1;
    camera.updateProjectionMatrix();
  }

  // capture the current frame, upscale crisply, watermark, save / share
  async snap() {
    const src = this.g.snapCanvas();
    const k = Math.max(2, Math.ceil(1920 / src.width));
    const c = document.createElement('canvas');
    c.width = src.width * k;
    c.height = src.height * k;
    const g = c.getContext('2d');
    g.imageSmoothingEnabled = false;
    g.drawImage(src, 0, 0, c.width, c.height);
    const sc = Math.max(2, Math.round(c.height / 300));
    const label = 'PIXEL COMMUTE';
    font.shadow(g, label, c.width - font.measure(label, sc) - sc * 6, c.height - sc * 11, sc, 'rgba(244,241,232,0.85)', 'rgba(12,15,26,0.8)');
    flash();
    this.g.shutter?.();
    const blob = await new Promise((r) => c.toBlob(r, 'image/png'));
    if (!blob) return;
    const d = new Date();
    const pad = (n) => String(n).padStart(2, '0');
    const name = `pixel-commute-${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}.png`;
    const file = new File([blob], name, { type: 'image/png' });
    // phones: the share sheet (save to photos / send); otherwise a download
    if (this.g.touch() && navigator.canShare && navigator.canShare({ files: [file] })) {
      try {
        await navigator.share({ files: [file], title: 'Pixel Commute' });
        return;
      } catch (e) { /* cancelled: fall back to a download */ }
    }
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 4000);
    this.lastSaved = name;
  }
}
