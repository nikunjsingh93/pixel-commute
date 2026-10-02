import * as THREE from 'three';
import { Path } from './path.js';
import { World, ROAD_L, ROAD_R, LANE_D } from './world.js';
import { Sky } from './sky.js';
import { PixelPipeline } from './pixel.js';
import { Glows, LightPool } from './fx.js';
import { Traffic } from './traffic.js';
import { Player, VMAX } from './player.js';
import { Weather } from './weather.js';
import { EYE } from './cockpit.js';
import { setupTouch, isTouchDevice } from './touch.js';
import { SPEC } from './vehicle.js';
import { Hud } from './hud.js';
import { Audio } from './audio.js';

const params = new URLSearchParams(location.search);

// small persisted preferences (storage may be unavailable: private mode etc.)
function loadPref(k) {
  try { return localStorage.getItem('pixel-commute.' + k); } catch (e) { return null; }
}
function savePref(k, v) {
  try { localStorage.setItem('pixel-commute.' + k, String(v)); } catch (e) { /* ignore */ }
}
const DEV = params.has('dev');
const HOLD = params.has('hold');

// ------------------------------------------------------------------ setup
const glCanvas = document.getElementById('gl');
const hudCanvas = document.getElementById('hud');
const renderer = new THREE.WebGLRenderer({
  canvas: glCanvas, antialias: false, powerPreference: 'high-performance', preserveDrawingBuffer: DEV,
});
renderer.setPixelRatio(1);
renderer.toneMapping = THREE.NoToneMapping;
renderer.autoClear = true;

const scene = new THREE.Scene();
scene.fog = new THREE.FogExp2(0x7a92b4, 0.0034);
const camera = new THREE.PerspectiveCamera(52, 16 / 9, 0.3, 1500);

const pipe = new PixelPipeline(renderer);
const path = new Path(Number(params.get('seed') || 7));
const world = new World(scene, path);
const sky = new Sky(scene);
const glows = new Glows(scene);
const lamps = new LightPool(scene, 10);
const carLights = new LightPool(scene, 4);
const traffic = new Traffic(world.root, path);
const player = new Player(world.root, path);
const weather = new Weather(scene);
const hud = new Hud(hudCanvas);
const audio = new Audio();

// player headlights + a soft red glow behind the car
const headlight = new THREE.SpotLight(0xfff0d0, 0, 90, 0.5, 0.6, 1.2);
scene.add(headlight, headlight.target);
const tailLight = new THREE.PointLight(0xff2a1a, 0, 9, 1.6);
scene.add(tailLight);

// environment map for wet-road reflections (sky only)
const envScene = new THREE.Scene();
envScene.add(new THREE.Mesh(sky.dome.geometry, sky.mat));
const pmrem = new THREE.PMREMGenerator(renderer);
let envRT = null;
let envKey = '';

// ------------------------------------------------------------------ state
const WEATHERS = [
  { name: 'SNOW', kind: 'snow', amount: 0.55, wet: 0.55, snow: 1, overcast: 0.25, fog: 1.25 },
  { name: 'RAIN', kind: 'rain', amount: 0.4, wet: 1, snow: 0, overcast: 0.55, fog: 1.35 },
  { name: 'CLEAR', kind: 'none', amount: 0, wet: 0.2, snow: 0, overcast: 0, fog: 0.8 },
  { name: 'FOG', kind: 'none', amount: 0, wet: 0.45, snow: 0, overcast: 0.7, fog: 3.2 },
];
const CAMS = ['CHASE', 'FAR', 'COCKPIT', 'BUMPER', 'CINEMA'];

const st = {
  mode: params.get('play') ? 'drive' : 'title',
  hour: Number(params.get('t') || 19.2),
  timeScale: 1 / 240, // game hours per real second (1 h every 4 min)
  weather: Number(params.get('w') || 0),
  cam: Number(params.get('cam') ?? 1),
  paused: false,
  time: 0,
  pixelH: Number(params.get('px') || loadPref('pixelH') || 575),
  touch: false,
  shake: 0,
};
let W = WEATHERS[st.weather];
const camState = {
  look: new THREE.Vector3(), init: false, cine: null, shakeT: 0,
  dir: new THREE.Vector3(0, 0, 1), off: new THREE.Vector3(), lookOff: new THREE.Vector3(),
};

// ------------------------------------------------------------------ sizing
function resize() {
  const dpr = window.devicePixelRatio || 1;
  const devW = Math.round((window.innerWidth || 1280) * dpr);
  const devH = Math.round((window.innerHeight || 720) * dpr);
  // nearest integer pixel scale to the target height; phones never exceed it (GPU budget)
  const scale = Math.max(1, (st.touch ? Math.ceil : Math.round)(devH / st.pixelH));
  const w = Math.ceil(devW / scale);
  const h = Math.ceil(devH / scale);
  renderer.setSize(w, h, false);
  pipe.setSize(w, h);
  const hs = Math.max(1, Math.round(h / 200));
  hud.resize(Math.ceil(w / hs), Math.ceil(h / hs));
  for (const c of [glCanvas, hudCanvas]) {
    c.style.width = `${(w * scale) / dpr}px`;
    c.style.height = `${(h * scale) / dpr}px`;
  }
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
  st.w = w;
  st.h = h;
}
window.addEventListener('resize', resize);
resize();

// ------------------------------------------------------------------ input
const keys = new Set();
const input = { throttle: 0, brake: 0, steer: 0, handbrake: 0, any: false, manualOverride: false, analog: false };
function startDriving() {
  if (st.mode === 'title') {
    st.mode = 'drive';
    player.auto = false;
    hud.help = false;
  }
  audio.start();
}

function nearestLane() {
  let best = 0;
  LANE_D.forEach((d, i) => {
    if (Math.abs(d - player.d) < Math.abs(LANE_D[best] - player.d)) best = i;
  });
  return best;
}

// touch menu: step through the clean (integer) pixel scales this screen allows
function cycleResolution() {
  const devH = Math.round((window.innerHeight || 720) * (window.devicePixelRatio || 1));
  const opts = [];
  for (let s = 1; s <= 10; s++) {
    const h = Math.ceil(devH / s);
    if (h >= 160 && h <= 900 && !opts.includes(h)) opts.push(h);
  }
  opts.sort((a, b) => a - b);
  st.pixelH = opts.find((h) => h > st.h) ?? opts[0];
  savePref('pixelH', st.pixelH);
  resize();
  hud.say(`RESOLUTION ${st.w}X${st.h}`);
}

// one-shot actions, shared by the keyboard and the touch buttons
function action(k) {
  if (st.mode === 'title') {
    if (k === 'Enter') startDriving();
    if (k === 'KeyH') hud.help = !hud.help;
    if (k === 'Space') {
      startDriving();
      player.auto = true;
      player.autoLane = nearestLane();
    }
    return;
  }
  audio.start();
  switch (k) {
    case 'Space':
      player.auto = !player.auto;
      player.autoLane = nearestLane();
      hud.say(player.auto ? 'AUTOPILOT ON - RELAX' : 'AUTOPILOT OFF');
      break;
    case 'KeyC':
      st.cam = (st.cam + 1) % CAMS.length;
      camState.init = false;
      hud.say(`CAMERA: ${CAMS[st.cam]}`);
      break;
    case 'KeyT':
      st.hour = (Math.floor(st.hour * 2) / 2 + 1.5) % 24;
      envKey = '';
      hud.say(sky.apply(st.hour, scene, st.time).name);
      break;
    case 'KeyR':
      st.weather = (st.weather + 1) % WEATHERS.length;
      applyWeather();
      hud.say(`WEATHER: ${W.name}`);
      break;
    case 'KeyM':
      audio.toggleMusic();
      hud.say(audio.music ? 'RADIO ON' : 'RADIO OFF');
      break;
    case 'KeyN':
      if (!audio.music) audio.toggleMusic();
      audio.nextStation();
      hud.say('NEW STATION');
      break;
    case 'KeyP':
      pipe.post.uniforms.mode.value = (pipe.post.uniforms.mode.value + 1) % 3;
      hud.say(['PALETTE: 8-BIT', 'PALETTE: POSTERIZE', 'PALETTE: OFF (RAW)'][pipe.post.uniforms.mode.value]);
      break;
    case 'BracketLeft':
    case 'BracketRight':
      st.pixelH = Math.max(120, Math.min(900, st.pixelH * (k === 'BracketLeft' ? 0.8 : 1.25)));
      savePref('pixelH', Math.round(st.pixelH));
      resize();
      hud.say(`RESOLUTION ${st.w}X${st.h}`);
      break;
    case 'Resolution':
      cycleResolution();
      break;
    case 'KeyH':
      hud.help = !hud.help;
      break;
    case 'KeyU':
      hud.visible = !hud.visible;
      break;
    case 'Escape':
      // pause screen lists every control
      st.paused = !st.paused;
      hud.help = false;
      break;
  }
}

window.addEventListener('keydown', (e) => {
  if (e.repeat) return;
  keys.add(e.code);
  if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space'].includes(e.code)) e.preventDefault();
  action(e.code);
});
window.addEventListener('keyup', (e) => keys.delete(e.code));
window.addEventListener('blur', () => keys.clear());

// click / tap to start; a tap on the pause screen resumes
window.addEventListener('pointerdown', () => {
  if (st.mode === 'title') startDriving();
  else if (st.paused && st.touch) st.paused = false;
  else audio.start();
});

// on-screen controls on touch screens (or as soon as a touch is seen)
function enableTouch() {
  if (st.touch) return;
  st.touch = true;
  document.body.classList.add('touch');
  resize();
  setupTouch({
    keys,
    press: (code) => {
      if (st.mode === 'title') startDriving();
      action(code);
    },
    driving: () => st.mode === 'drive' && !st.paused,
    menuOpen: () => st.mode === 'drive' && st.paused,
    state: () => ({
      cam: CAMS[st.cam], auto: player.auto, period: look.name, weather: W.name,
      radio: !!(audio.ctx && audio.music), station: ['88.1', '91.4', 'AM 640', '101.9'][audio.station % 4],
      res: `${st.h}p`,
    }),
    fullscreen: () => {
      const el = document.documentElement;
      try {
        if (document.fullscreenElement || document.webkitFullscreenElement) (document.exitFullscreen || document.webkitExitFullscreen).call(document);
        else {
          (el.requestFullscreen || el.webkitRequestFullscreen).call(el);
          screen.orientation?.lock?.('landscape').catch(() => {});
        }
      } catch (e) { /* not supported (iOS Safari): the PWA runs fullscreen instead */ }
    },
  });
}
if (isTouchDevice()) enableTouch();
else window.addEventListener('touchstart', enableTouch, { once: true, passive: true });

function readInput() {
  const up = keys.has('KeyW') || keys.has('ArrowUp');
  const down = keys.has('KeyS') || keys.has('ArrowDown');
  const left = keys.has('KeyA') || keys.has('ArrowLeft');
  const right = keys.has('KeyD') || keys.has('ArrowRight');
  input.throttle = up ? 1 : 0;
  input.brake = down ? 1 : 0;
  input.steer = (right ? 1 : 0) - (left ? 1 : 0);
  input.handbrake = keys.has('ShiftLeft') || keys.has('ShiftRight') ? 1 : 0;
  input.analog = false;
  // gamepad: analog steering and pedals
  const pads = navigator.getGamepads ? navigator.getGamepads() : [];
  for (const p of pads) {
    if (!p) continue;
    const ax = p.axes[0] || 0;
    if (Math.abs(ax) > 0.12) {
      input.steer = Math.sign(ax) * ((Math.abs(ax) - 0.12) / 0.88) ** 1.5;
      input.analog = true;
    }
    if (p.buttons[7]?.value > 0.05) input.throttle = p.buttons[7].value;
    if (p.buttons[6]?.value > 0.05) input.brake = p.buttons[6].value;
    if (p.buttons[0]?.pressed) input.handbrake = 1;
  }
  input.any = up || down || left || right || input.analog || input.throttle > 0 || input.brake > 0;
  input.manualOverride = input.brake > 0.05 || input.steer !== 0;
  if (player.auto && input.manualOverride) hud.say('AUTOPILOT OFF');
}

// ------------------------------------------------------------------ weather / time
function applyWeather() {
  W = WEATHERS[st.weather];
  weather.set(W.kind, W.amount);
  world.setWeather(W.snow, W.wet);
  sky.overcast = W.overcast;
  // tyre grip: slush in snow, a water film in rain
  player.veh.snow = W.snow * 0.55;
  player.veh.wet = W.wet;
  envKey = '';
}
applyWeather();

function updateEnv() {
  const key = `${Math.round(st.hour * 4)}|${st.weather}`;
  if (key === envKey) return;
  envKey = key;
  envRT?.dispose();
  envRT = pmrem.fromScene(envScene, 0, 0.1, 200);
  scene.environment = envRT.texture;
}

// ------------------------------------------------------------------ floating origin
function maybeRebase() {
  const p = player.mesh.position;
  if (Math.abs(p.x) < 1500 && Math.abs(p.z) < 1500 && Math.abs(p.y) < 400) return;
  const dx = p.x, dy = p.y, dz = p.z;
  world.rebase(dx, dy, dz);
  weather.rebase(dx, dy, dz);
  camState.look.x -= dx; camState.look.y -= dy; camState.look.z -= dz;
  camera.position.x -= dx; camera.position.y -= dy; camera.position.z -= dz;
}

// ------------------------------------------------------------------ camera
const _v1 = new THREE.Vector3(), _v2 = new THREE.Vector3(), _v3 = new THREE.Vector3();
const _up = new THREE.Vector3(0, 1, 0);
function updateCamera(dt, car) {
  const mode = CAMS[st.cam];
  const o = world.origin;
  const V = player.veh;
  player.mesh.visible = mode !== 'BUMPER';
  player.cockpit.setVisible(mode === 'COCKPIT');
  camState.shakeT += dt;
  // road buzz grows with speed, bumps add a kick
  const buzz = Math.min(Math.abs(player.v) / 45, 1) * 0.5 + st.shake * 5;
  const T = camState.shakeT;
  const sx = (Math.sin(T * 31.1) + Math.sin(T * 17.3 + 1.3)) * 0.5 * buzz;
  const sy = (Math.sin(T * 27.7 + 2.1) + Math.sin(T * 13.1)) * 0.5 * buzz;
  let fov = 52;
  let near = 0.3;
  const carPos = _v3.set(car.x, car.y + SPEC.comH, car.z);
  if (mode === 'CHASE' || mode === 'FAR') {
    // camera direction: between the car's nose and its velocity
    const fwdH = _v1.set(V.fwd.x, 0, V.fwd.z).normalize();
    const velH = _v2.set(V.vel.x, 0, V.vel.z);
    if (velH.length() > 4 && V.fwdSpeed > 0) fwdH.lerp(velH.normalize(), 0.55).normalize();
    if (!camState.init) camState.dir.copy(fwdH);
    camState.dir.lerp(fwdH, 1 - Math.exp(-dt * 3.2)).normalize();
    const far = mode === 'FAR';
    const dist = far ? 11.5 : 6.6, height = far ? 3.5 : 1.95, lookH = far ? 0.9 : 1.15;
    const offT = _v1.copy(camState.dir).multiplyScalar(-dist);
    offT.y = -SPEC.comH + height;
    const lookT = _v2.copy(camState.dir).multiplyScalar(5.5);
    lookT.y = -SPEC.comH + lookH;
    if (!camState.init) {
      camState.off.copy(offT);
      camState.lookOff.copy(lookT);
    }
    // smooth the offset relative to the car, so it never trails at speed
    const kh = 1 - Math.exp(-dt * 16), kv = 1 - Math.exp(-dt * 6);
    camState.off.x += (offT.x - camState.off.x) * kh;
    camState.off.z += (offT.z - camState.off.z) * kh;
    camState.off.y += (offT.y - camState.off.y) * kv;
    camState.lookOff.x += (lookT.x - camState.lookOff.x) * kh;
    camState.lookOff.z += (lookT.z - camState.lookOff.z) * kh;
    camState.lookOff.y += (lookT.y - camState.lookOff.y) * kv;
    camera.position.copy(carPos).add(camState.off);
    camera.up.copy(_up);
    camera.lookAt(_v1.copy(carPos).add(camState.lookOff));
    camera.rotateZ(sx * 0.0016);
    camera.rotateX(sy * 0.0012);
    fov = (far ? 48 : 54) + Math.min(Math.abs(player.v) * 0.14, 7);
    camState.init = true;
  } else if (mode === 'COCKPIT' || mode === 'BUMPER') {
    const inside = mode === 'COCKPIT';
    const eye = inside ? EYE : _v2.set(0, 0.78, player.L / 2 - 0.1);
    player.toWorld(eye.x, eye.y, eye.z, camera.position);
    player.toWorld(eye.x, eye.y - (inside ? 1.5 : 0.4), eye.z + 20, _v1);
    // the head stays fairly level: blend the car's roll/pitch with world up
    camera.up.copy(_up).applyQuaternion(V.quat).lerp(_up, 0.5).normalize();
    camera.lookAt(_v1);
    camera.rotateZ(sx * 0.002);
    camera.rotateX(sy * 0.0016);
    fov = (inside ? 56 : 60) + Math.min(Math.abs(player.v) * 0.12, 6);
    near = inside ? 0.05 : 0.15;
    camState.init = false;
  } else {
    // cinema: a roadside camera ahead of the car that pans as it passes
    if (!camState.cine || player.s - camState.cine.s > 30 || camState.cine.s - player.s > 160) {
      const spots = [
        { d: ROAD_R + 0.4, h: 1.0 + Math.random() * 1.5 },
        { d: ROAD_R + 3.2, h: 8.2 + Math.random() * 3 },
        { d: -1.7, h: 1.4 + Math.random() * 2 },
      ];
      const sp = spots[(Math.random() * spots.length) | 0];
      camState.cine = { s: player.s + 70 + Math.random() * 50, d: sp.d, h: sp.h };
      camState.look.copy(carPos);
    }
    const c = camState.cine;
    const p = path.point(c.s, c.d, c.h);
    camera.position.set(p.x - o.x, p.y - o.y, p.z - o.z);
    camState.look.lerp(carPos, Math.min(1, dt * 6));
    camera.up.copy(_up);
    camera.lookAt(camState.look);
    fov = 34;
    camState.init = false;
  }
  camera.near = near;
  camera.fov += (fov - camera.fov) * Math.min(1, dt * 3);
  camera.updateProjectionMatrix();
}

// ------------------------------------------------------------------ frame
const lampCands = [];
const carCands = [];
let look = sky.apply(st.hour, scene, 0);

const _fwd = new THREE.Vector3();
// road height under the camera; reflections assume one flat road plane, so
// lights over a crest or a dip (different road level) fade out instead of
// producing streaks floating in the air
let streakGround = 0;
function streak(x, y, z, groundY, r, g, b, size) {
  // reflection of a light on the wet road, seen from the camera
  const c = camera.position;
  const hL = y - groundY;
  const hc = Math.max(0.3, c.y - groundY);
  const t = hc / (hc + hL);
  const px = c.x + (x - c.x) * t;
  const pz = c.z + (z - c.z) * t;
  const dx = px - c.x, dz = pz - c.z;
  const dist = Math.sqrt(dx * dx + dz * dz);
  if (dist > 200 || dist < 4) return;
  // only reflections in front of the camera, and small when very close
  camera.getWorldDirection(_fwd);
  if (dx * _fwd.x + dz * _fwd.z < 0) return;
  const k = Math.min(1, (dist - 4) / 14) * Math.max(0, 1 - Math.abs(groundY - streakGround) / 1.2);
  if (k <= 0.01) return;
  glows.add(px, groundY + 0.06, pz, r * k, g * k, b * k, size * 2.2 * (0.4 + 0.6 * k), 1);
}

function step(dt) {
  st.time += dt;
  if (!st.paused) {
    st.hour = (st.hour + dt * st.timeScale) % 24;
  }
  readInput();
  if (st.mode === 'title') {
    if (!player.auto) {
      player.auto = true;
      player.autoLane = 1;
    }
  }
  if (!st.paused) {
    const inp = st.mode === 'title' ? { throttle: 0, brake: 0, steer: 0, any: false } : input;
    player.update(dt, inp, traffic);
    traffic.update(dt, player);
    for (const e of player.events) {
      if (e.type === 'close') {
        hud.popup(e.combo > 1 ? `CLOSE CALL X${e.combo}` : 'CLOSE CALL', '#ffcd6e');
        audio.chime(e.combo);
      } else if (e.type === 'reset') {
        hud.say('BACK ON THE ROAD');
      } else if (e.type === 'hit') {
        st.shake = Math.max(st.shake, e.power);
        audio.thump(e.power);
        if (e.power > 0.25) hud.popup(e.kind === 'wall' ? 'SCRAPE!' : 'BUMP!', '#ee4a33');
      }
    }
    player.events.length = 0;
  }
  st.shake = Math.max(0, st.shake - dt * 2.5);
  path.trim(player.s - 400);
}

function render(dt) {
  const o = world.origin;
  world.update(player.s);
  look = sky.apply(st.hour, scene, st.time);
  const night = look.night;
  world.setNight(night);
  scene.fog.density = 0.0026 * W.fog;
  pipe.post.uniforms.exposure.value = look.exp;

  player.render(o);
  maybeRebase();
  const carNow = player.render(world.origin);
  streakGround = carNow.y;
  updateCamera(dt, carNow);
  sky.follow(camera);
  updateEnv();

  // glows ----------------------------------------------------------
  glows.begin();
  const wet = W.wet;
  const lampK = Math.max(0, night - 0.05) * 1.6;
  const c = camera.position;
  lampCands.length = 0;
  for (const g of world.allGlows()) {
    const x = g.x - world.origin.x, y = g.y - world.origin.y, z = g.z - world.origin.z;
    if (g.blink !== undefined) {
      const on = Math.sin(st.time * 2.2 + g.blink) > 0.3;
      if (on) glows.add(x, y, z, 1.6 * night + 0.2, 0.2, 0.12, g.size);
      continue;
    }
    if (lampK <= 0.01) continue;
    glows.add(x, y, z, g.r * lampK, g.g * lampK, g.b * lampK, g.size);
    if (wet > 0.05 && g.h) streak(x, y, z, y - g.h, g.r * lampK * wet * 0.7, g.g * lampK * wet * 0.7, g.b * lampK * wet * 0.7, g.size * 1.1);
  }
  for (const l of world.allLights()) {
    lampCands.push({ x: l.x - world.origin.x, y: l.y - world.origin.y, z: l.z - world.origin.z, r: l.r, g: l.g, b: l.b, power: l.power, range: 30 });
  }
  const fx = Math.sin(carNow.h), fz = Math.cos(carNow.h);
  const focus = { x: carNow.x + fx * 30, y: carNow.y, z: carNow.z + fz * 30 };
  lamps.assign(lampCands, focus, 55 * lampK);

  traffic.render(world.origin, glows, wet, Math.max(0.35, night), st.time, streak);
  // nearest traffic tail lights get real red lights (wet-road shine)
  carCands.length = 0;
  for (const tc of traffic.cars) {
    if (!tc.mesh.visible) continue;
    const ds = tc.s - player.s;
    if (ds < -5 || ds > 80) continue;
    const p = tc.mesh.position;
    const hx = Math.sin(tc.mesh.rotation.y), hz = Math.cos(tc.mesh.rotation.y);
    carCands.push({ x: p.x - hx * (tc.L / 2 + 0.6), y: p.y + 0.8, z: p.z - hz * (tc.L / 2 + 0.6), r: 1, g: 0.08, b: 0.04, power: 0.35 + tc.brake * 0.9, range: 10 });
  }
  carLights.assign(carCands, focus, 6 * (0.4 + night));

  // player lights, placed from the car's real pose (pitch, roll, yaw)
  const D = player.dims;
  const k = 0.7 + player.brake * 1.6;
  const tp = _v1;
  for (const side of [1, -1]) {
    player.toWorld(D.tailX * side, D.tailY, -D.L / 2 - 0.12, tp);
    glows.add(tp.x, tp.y, tp.z, 1.4 * k, 0.16 * k, 0.08 * k, 0.32 + player.brake * 0.18);
    if (wet > 0.05) streak(tp.x, tp.y, tp.z, carNow.y, k * wet, 0.1 * k * wet, 0.05 * k * wet, 0.9);
  }
  if (player.scrape > 0.2) {
    // sparks where the body rubs the barrier (mesh +X is left)
    const side = player.scrapeSide;
    for (let i = 0; i < 4; i++) {
      player.toWorld(-side * (D.W / 2 + 0.05), 0.35 + Math.random() * 0.3, (Math.random() - 0.5) * D.L, tp);
      glows.add(tp.x + (Math.random() - 0.5) * 0.6, tp.y, tp.z + (Math.random() - 0.5) * 0.6, 2, 1.3, 0.4, 0.25);
    }
  }
  player.toWorld(0, 0.7, -D.L / 2 - 1.2, tailLight.position);
  tailLight.intensity = (0.7 + player.brake * 2.2) * (0.3 + night);
  const hlOn = night > 0.25 || W.overcast > 0.5;
  headlight.intensity = hlOn ? 260 : 0;
  player.toWorld(0, 0.72, D.L / 2 - 0.3, headlight.position);
  player.toWorld(0, 0.1, 30, headlight.target.position);
  glows.end(camera, st.h);
  glows.mat.uniforms.fogDensity.value = scene.fog.density * 0.85;

  // weather
  weather.update(dt, camera, { x: fx * player.v, z: fz * player.v }, st.time, st.h, 0.5 + 0.6 * (1 - night) + night * 0.55,
    CAMS[st.cam] === 'COCKPIT' ? 2.6 : 0);

  pipe.render(scene, camera);
  hud.draw({
    mode: st.mode, hour: st.hour, period: look.name, weather: W.name, odo: player.odo, closeCalls: player.closeCalls,
    speed: player.v, vmax: VMAX, auto: player.auto, music: audio.ctx && audio.music, station: audio.station,
    time: st.time, paused: st.paused, touch: st.touch, gear: player.gearLabel(), rpm: player.veh.rpm, redline: SPEC.redline,
  }, dt);
  if (CAMS[st.cam] === 'COCKPIT') {
    const V = player.veh;
    const STN = ['88.1', '91.4', 'AM640', '101.9'];
    player.cockpit.update((V.wheels[0].steerA + V.wheels[1].steerA) / 2, Math.abs(V.fwdSpeed) * 3.6, V.rpm, player.gearLabel(),
      SPEC.redline, audio.ctx && audio.music ? STN[audio.station % 4] : 'OFF', st.time);
  }
  audio.update(Math.abs(player.v), player.veh.throttle, W.kind === 'rain' ? 1 : 0, player.scrape, player.veh.rpm, player.veh.slip);
}

// prime the world
world.update(player.s, true);
traffic.init(player.s);

let last = performance.now();
function loop(now) {
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  step(dt);
  render(dt);
  requestAnimationFrame(loop);
}
if (!HOLD) requestAnimationFrame(loop);

// ------------------------------------------------------------------ dev hooks
window.__game = {
  st, player, traffic, world, camera, pipe, sky, renderer,
  advance(sec, fps = 30) {
    const dt = 1 / fps;
    for (let t = 0; t < sec; t += dt) {
      step(dt);
      world.update(player.s, true);
      render(dt);
    }
  },
  setHour(h) { st.hour = h; envKey = ''; },
  setWeather(i) { st.weather = i; applyWeather(); },
  resize,
  async snap(name = 'shot', scale = 4) {
    render(1 / 60);
    const c = document.createElement('canvas');
    c.width = st.w * scale;
    c.height = st.h * scale;
    const g = c.getContext('2d');
    g.imageSmoothingEnabled = false;
    g.drawImage(glCanvas, 0, 0, c.width, c.height);
    g.drawImage(hudCanvas, 0, 0, c.width, c.height);
    await fetch(`/__snap?name=${name}`, { method: 'POST', body: c.toDataURL('image/png') });
    return `${st.w}x${st.h}`;
  },
};

// ------------------------------------------------------------------ PWA
// offline + installable; only in production builds (the dev server must not be cached)
if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => navigator.serviceWorker.register('./sw.js').catch(() => {}));
}
