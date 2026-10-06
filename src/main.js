import * as THREE from 'three';
import { Path } from './path.js';
import { Planner } from './planner.js';
import { World, ROAD_L, ROAD_R, LANE_D } from './world.js';
import { Sky, lookAt } from './sky.js';
import { PixelPipeline } from './pixel.js';
import { Glows, LightPool } from './fx.js';
import { Traffic } from './traffic.js';
import { Player, VMAX } from './player.js';
import { WheelPool } from './cars.js';
import { Weather } from './weather.js';
import { setupTouch, isTouchDevice } from './touch.js';
import { PhotoMode } from './photo.js';
import { Menu } from './ui.js';
import { Garage } from './garage.js';
import { Hud } from './hud.js';
import { Audio } from './audio.js';
import { Radio, STATIONS } from './radio.js';
import { Commute } from './goals.js';
import { Foot } from './foot.js';
import { Panel, button, esc } from './ui.js';

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
// colour filter: 2 = raw (default), 0 = 8-bit palette, 1 = posterize
pipe.post.uniforms.mode.value = Number(params.get('pal') ?? loadPref('palette') ?? 2);
const path = new Path(Number(params.get('seed') || 7));
const planner = new Planner(Number(params.get('seed') || 7));
path.shape = (s) => planner.shape(s, path);
const world = new World(scene, path, planner);
const sky = new Sky(scene);
const glows = new Glows(scene);
const lamps = new LightPool(scene, 10);
const carLights = new LightPool(scene, 4);
const traffic = new Traffic(world.root, path);
// every traffic / loop car's wheels: one instanced mesh, spun each frame
const wheelPool = new WheelPool(world.root);
traffic.wheels = wheelPool;
world.wheels = wheelPool;
let carSel = { car: 'saloon', paint: '#15161b', plate: '8-BIT' };
try { carSel = { ...carSel, ...JSON.parse(loadPref('car') || '{}') }; } catch (e) { /* keep defaults */ }
const player = new Player(world.root, path, carSel);
traffic.planner = planner;
player.planner = planner;
player.world = world;
player.groundP.world = world;
player.manual = loadPref('gearbox') === 'manual';
const weather = new Weather(scene);
const hud2Canvas = document.getElementById('hud2');
const hud = new Hud(hudCanvas, hud2Canvas);
const audio = new Audio();
const radio = new Radio(audio);
function startAudio() {
  audio.start();
  radio.start();
}
// commute mode (jobs, fuel, tolls, milestones); zen mode is the plain drive
const commute = new Commute({ planner, world, player, path, hud, audio });
let foot = null; // on foot (set up with the menus below)

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
const CAMS = ['TOP', 'FAR', 'COCKPIT', 'BUMPER'];
// time-of-day presets the T key / Time button steps through
const TIME_STOPS = [6.3, 10, 16.5, 18.4, 19.2, 20.5, 23];

const st = {
  mode: params.get('play') ? 'drive' : 'title',
  hour: Number(params.get('t') || 19.2),
  timeScale: 1 / 240, // game hours per real second (1 h every 4 min)
  weather: Number(params.get('w') || 0),
  cam: Math.min(3, Number(params.get('cam') ?? 1)),
  paused: false,
  time: 0,
  pixelH: Number(params.get('px') || loadPref('pixelH') || 575),
  touch: false,
  shake: 0,
};
let W = WEATHERS[st.weather];
const camState = {
  look: new THREE.Vector3(), init: false, shakeT: 0,
  // mouse look: orbit the car (chase / far) or turn the head (cockpit / bumper)
  yaw: 0, pitch: 0, idle: 9,
  low: 0, // top camera: 0 = high above the road, 1 = dropped low (tunnels)
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
  // menu text: font pixels of k device pixels (about 4 css px on a monitor)
  const kf = Math.max(2, Math.round(devH / (st.touch ? 125 : 190)));
  const fw = Math.ceil(devW / kf), fh = Math.ceil(devH / kf);
  hud.resizeFine(fw, fh);
  hud2Canvas.style.width = `${(fw * kf) / dpr}px`;
  hud2Canvas.style.height = `${(fh * kf) / dpr}px`;
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
function startDriving(goal) {
  if (goal === 'commute' && !commute.on) {
    commute.start();
    hud.say(`COMMUTE · $${commute.money.toFixed(0)} · PRESS J FOR JOBS`, 3.5);
  } else if (goal === 'zen' && commute.on) commute.stop();
  if (goal) savePref('goal', goal);
  if (st.mode === 'title') {
    st.mode = 'drive';
    player.auto = false;
    hud.help = false;
  }
  startAudio();
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
  if (photo.active) {
    // photo mode: only snap / exit / look tweaks; movement keys are read every frame
    if (k === 'Enter' || k === 'Space') photo.snap();
    else if (k === 'Escape' || k === 'KeyP') exitPhoto();
    else if (k === 'KeyO') photo.toggleOrbit();
    else if (['KeyT', 'KeyR', 'KeyG', 'BracketLeft', 'BracketRight'].includes(k)) runAction(k);
    return;
  }
  if (st.mode === 'title') {
    if (k === 'Enter') startDriving(loadPref('goal') || 'zen');
    if (k === 'KeyH') hud.help = !hud.help;
    if (k === 'KeyO') {
      startDriving();
      player.auto = true;
      player.autoLane = nearestLane();
    }
    return;
  }
  runAction(k);
}

function enterPhoto() {
  if (st.mode !== 'drive') return;
  st.paused = false;
  photo.enter(camera);
}
function exitPhoto() {
  photo.exit();
  player.mesh.visible = true;
  camState.init = false;
}

function runAction(k) {
  startAudio();
  switch (k) {
    case 'KeyP':
      enterPhoto();
      break;
    case 'KeyO':
      player.auto = !player.auto;
      player.autoLane = nearestLane();
      hud.say(player.auto ? 'AUTOPILOT ON - RELAX' : 'AUTOPILOT OFF');
      break;
    case 'KeyC':
      st.cam = (st.cam + 1) % CAMS.length;
      camState.init = false;
      camState.yaw = camState.pitch = 0;
      hud.say(`CAMERA: ${CAMS[st.cam]}`);
      break;
    case 'KeyT': {
      // jump to the next distinct look (a plain +1.5 h could land on "night" 5 times in a row)
      const cur = lookAt(st.hour).name;
      const i0 = TIME_STOPS.findIndex((h) => h > st.hour + 0.05);
      for (let i = 0; i < TIME_STOPS.length; i++) {
        const h = TIME_STOPS[((i0 < 0 ? 0 : i0) + i) % TIME_STOPS.length];
        if (lookAt(h).name !== cur || i === TIME_STOPS.length - 1) {
          st.hour = h;
          break;
        }
      }
      envKey = '';
      look = sky.apply(st.hour, scene, st.time);
      hud.say(look.name);
      break;
    }
    case 'KeyR':
      st.weather = (st.weather + 1) % WEATHERS.length;
      applyWeather();
      hud.say(`WEATHER: ${W.name}`);
      break;
    case 'KeyM':
      audio.toggleMusic();
      radio.applyGains();
      hud.say(audio.music ? 'RADIO ON  ' + radio.label() : 'RADIO OFF');
      break;
    case 'KeyN':
      if (!audio.music) audio.toggleMusic();
      radio.next();
      hud.say(radio.label());
      break;
    case 'KeyG':
      // colour filter: raw (default) -> 8-bit palette -> posterize
      pipe.post.uniforms.mode.value = (pipe.post.uniforms.mode.value + 1) % 3;
      savePref('palette', pipe.post.uniforms.mode.value);
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
    case 'KeyF':
      // on foot <-> in a car; on foot it is the action key (cars, metro, cable car)
      if (foot.active) foot.action();
      else foot.leaveCar();
      break;
    case 'KeyRun':
      foot.run = !foot.run;
      break;
    case 'KeyX':
      player.manual = !player.manual;
      savePref('gearbox', player.manual ? 'manual' : 'auto');
      hud.say(player.manual ? 'MANUAL GEARBOX: E UP  Q DOWN' : 'AUTOMATIC GEARBOX', 2.6);
      break;
    case 'KeyE':
    case 'KeyQ':
      if (player.manual && !player.auto) {
        if (k === 'KeyE') player.veh.shiftUp();
        else player.veh.shiftDown();
      }
      break;
    case 'KeyJ':
      openJobs();
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
  if (photo.active) return;
  if (st.mode === 'title') {
    if (!st.touch) startDriving();
  } else if (st.paused) st.paused = false;
  else startAudio();
});

// on-screen controls on touch screens (or as soon as a touch is seen)
function enableTouch() {
  if (st.touch) return;
  st.touch = true;
  document.body.classList.add('touch');
  resize();
  setupTouch({
    keys,
    press: (code) => action(code),
    driving: () => st.mode === 'drive' && !st.paused && !photo.active && !anyPanelOpen(),
    manual: () => player.manual && !player.auto && !(foot && foot.active),
    onFoot: () => !!(foot && foot.active),
    stick: (x, y) => { if (foot) { foot.stick.x = x; foot.stick.y = y; } },
    running: () => !!(foot && foot.run),
  });
}

function toggleFullscreen() {
  const el = document.documentElement;
  try {
    if (document.fullscreenElement || document.webkitFullscreenElement) (document.exitFullscreen || document.webkitExitFullscreen).call(document);
    else {
      (el.requestFullscreen || el.webkitRequestFullscreen).call(el);
      screen.orientation?.lock?.('landscape').catch(() => {});
    }
  } catch (e) { /* not supported (iOS Safari): the PWA runs fullscreen instead */ }
}

// ------------------------------------------------------------------ menus
// state shown on the menu buttons
function menuState() {
  return {
    cam: CAMS[st.cam], auto: player.auto, period: look.name, weather: W.name,
    radio: !!(audio.ctx && audio.music), station: radio.label(),
    res: `${st.h}p`, touch: st.touch, car: player.def ? player.def.name : '',
    commute: commute.on, manual: player.manual, job: commute.job ? `exit ${commute.job.f.no}` : 'pick one',
  };
}
const panels = [];
function anyPanelOpen() {
  return panels.some((p) => p.isOpen);
}
const pauseMenu = new Menu('pause-menu', [
  { cls: 'wide primary', label: () => 'Resume', run: () => { st.paused = false; }, spin: false },
  { label: (m) => `Garage<small>${m.car}</small>`, run: () => openGarage(), spin: false },
  { label: (m) => `Camera<small>${m.cam}</small>`, run: () => runAction('KeyC') },
  { label: (m) => `Autopilot<small>${m.auto ? 'on' : 'off'}</small>`, run: () => runAction('KeyO'), act: (m) => m.auto },
  { label: (m) => `Time<small>${m.period}</small>`, run: () => runAction('KeyT') },
  { label: (m) => `Weather<small>${m.weather}</small>`, run: () => runAction('KeyR') },
  { label: (m) => `Radio<small>${m.radio ? m.station : 'off'}</small>`, run: () => openRadio(), act: (m) => m.radio, spin: false },
  { label: () => 'Next station<small>tune</small>', run: () => runAction('KeyN') },
  { label: (m) => `Resolution<small>${m.res}</small>`, run: () => cycleResolution() },
  { label: () => 'Fullscreen<small>toggle</small>', run: () => toggleFullscreen(), spin: false },
  { label: () => 'Photo<small>mode</small>', run: () => enterPhoto(), spin: false },
  { label: (m) => `Gearbox<small>${m.manual ? 'manual' : 'auto'}</small>`, run: () => runAction('KeyX'), act: (m) => m.manual },
  { label: (m) => `Mode<small>${m.commute ? 'commute' : 'zen'}</small>`, run: () => startDriving(commute.on ? 'zen' : 'commute'), act: (m) => m.commute },
  { label: (m) => `Jobs<small>${m.job}</small>`, run: () => openJobs(), show: (m) => m.commute, spin: false },
], menuState, { right: 'max(18px, env(safe-area-inset-right))', top: '50%', transform: 'translateY(-50%)' });

const titleMenu = new Menu('title-menu', [
  { cls: 'primary', label: () => 'Drive<small>zen</small>', run: () => startDriving('zen'), spin: false },
  { cls: 'primary', label: () => 'Commute<small>jobs + fuel</small>', run: () => startDriving('commute'), spin: false },
  { label: (m) => `Garage<small>${m.car}</small>`, run: () => openGarage(), spin: false },
  { label: () => 'Controls', run: () => { hud.help = !hud.help; }, spin: false },
], menuState, { left: '50%', bottom: 'max(16px, 7vh)', transform: 'translateX(-50%)', '--cols': 2 });

// ------------------------------------------------------------------ jobs panel
panels.push(commute.panel);
Object.assign(commute.panel.root.style, { left: 'auto', right: 'max(18px, env(safe-area-inset-right))', transform: 'translateY(-50%)' });
function openJobs() {
  if (st.mode !== 'drive' || photo.active) return;
  if (!commute.on) startDriving('commute');
  hud.help = false;
  commute.open(true);
}

// ------------------------------------------------------------------ radio panel
const radioPanel = new Panel('radio');
Object.assign(radioPanel.root.style, { left: 'auto', right: 'max(18px, env(safe-area-inset-right))', transform: 'translateY(-50%)', width: 'min(460px, 92vw)' });
panels.push(radioPanel);
function openRadio() {
  startAudio();
  radioPanel.open(true);
  renderRadio();
}
function renderRadio() {
  const el = radioPanel.el;
  el.innerHTML = `<h2>Radio</h2>
    <div class="ui-list" id="r-st"></div>
    <div class="row" id="r-opt" style="margin-top:10px"></div>
    <div style="margin-top:12px">My music</div>
    <div class="muted">Add audio files from your device. They stay in this browser and play on MY MUSIC.</div>
    <div class="row" id="r-add"></div>
    <div class="ui-list" id="r-tracks"></div>
    <div class="row" id="r-done" style="margin-top:12px"></div>`;
  const btn = (parent, cls, html, fn) => {
    const b = button(parent, cls, html, null, () => { fn(); renderRadio(); });
    b.style.position = 'relative';
    return b;
  };
  STATIONS.forEach((s, i) => {
    const sel = i === radio.index && audio.music;
    const sub = s.style === 'files' ? `${radio.tracks.length} track${radio.tracks.length === 1 ? '' : 's'}` : { lofi: 'lo-fi beats', synth: 'synthwave', jazz: 'smooth jazz', ambient: 'ambient' }[s.style];
    btn(el.querySelector('#r-st'), sel ? 'act' : '', `${esc(s.name)} ${s.freq}<small>${sub}</small>`, () => {
      if (!audio.music) audio.toggleMusic();
      radio.tune(i);
    });
  });
  const opt = el.querySelector('#r-opt');
  btn(opt, audio.music ? 'act' : '', audio.music ? 'Radio on' : 'Radio off', () => runAction('KeyM'));
  btn(opt, radio.dj ? 'act' : '', radio.dj ? 'Jingles on' : 'Jingles off', () => {
    radio.dj = !radio.dj;
    radio.save();
  });
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = 'audio/*';
  input.multiple = true;
  input.style.display = 'none';
  input.addEventListener('change', async () => {
    await radio.addFiles(input.files);
    if (!audio.music) audio.toggleMusic();
    radio.tune(STATIONS.findIndex((s) => s.style === 'files'));
    renderRadio();
  });
  el.appendChild(input);
  btn(el.querySelector('#r-add'), 'primary', '+ Add music files', () => input.click());
  const tl = el.querySelector('#r-tracks');
  radio.tracks.forEach((t, i) => {
    const playing = radio.station.style === 'files' && i === radio.trackIdx && audio.music;
    btn(tl, playing ? 'act' : '', `${esc(t.name.slice(0, 40))}<small>${playing ? 'playing' : 'tap to play / x to remove'}</small>`, () => {
      if (!audio.music) audio.toggleMusic();
      radio.index = STATIONS.findIndex((s) => s.style === 'files');
      radio.trackIdx = i;
      radio.tune(radio.index, true);
    });
    const x = btn(tl, 'small', 'x remove', () => radio.removeTrack(t.id));
    x.style.alignSelf = 'flex-end';
    x.style.minHeight = '28px';
  });
  btn(el.querySelector('#r-done'), 'primary', 'Done', () => radioPanel.open(false));
}

// ------------------------------------------------------------------ garage
const garage = new Garage({
  current: () => ({ ...player.sel }),
  apply: (sel) => {
    player.setCar(sel);
    savePref('car', JSON.stringify(sel));
    commute.carChanged();
  },
  close: () => {
    garage.open(false);
    hud.say(player.def.name.toUpperCase() + '  ' + player.sel.plate);
  },
});
panels.push(garage.panel);
function openGarage() {
  hud.help = false;
  garage.open(true);
}

const helpX = button(document.body, 'ui-xbtn', '&#x2715;', null, () => { hud.help = false; });
helpX.style.display = 'none';
setInterval(() => {
  pauseMenu.open(st.mode === 'drive' && st.paused && !anyPanelOpen());
  titleMenu.open(st.mode === 'title' && !anyPanelOpen() && !hud.help);
  helpX.style.display = hud.help && !st.paused && !anyPanelOpen() ? '' : 'none';
}, 100);

// ------------------------------------------------------------------ on foot
foot = new Foot({ world, player, traffic, camera, keys, hud, audio });

// ------------------------------------------------------------------ photo mode
const photo = new PhotoMode({
  keys,
  camera,
  touch: () => st.touch,
  press: (code) => action(code),
  carPos: () => player.mesh.position,
  groundY: (x, z) => player.groundP.ground(x + world.origin.x, z + world.origin.z, {}) - world.origin.y,
  shutter: () => audio.shutter && audio.shutter(),
  snapCanvas: () => {
    render(0);
    return glCanvas;
  },
});
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
  input.handbrake = keys.has('Space') || keys.has('ShiftLeft') || keys.has('ShiftRight') ? 1 : 0;
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
  // small cube: plenty for pixel-art reflections and cheap to rebuild on phones
  envRT = pmrem.fromScene(envScene, 0, 0.1, 200, { size: 64 });
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
const _v4 = new THREE.Vector3();
const lookAllowed = () => st.mode === 'drive' && !st.paused && !photo.active && !anyPanelOpen() && !garage.isOpen;
function lookBy(mx, my) {
  const inside = CAMS[st.cam] === 'COCKPIT' || CAMS[st.cam] === 'BUMPER';
  camState.yaw -= mx * 0.006;
  if (inside) camState.yaw = Math.max(-1.9, Math.min(1.9, camState.yaw));
  else camState.yaw = Math.atan2(Math.sin(camState.yaw), Math.cos(camState.yaw));
  camState.pitch = Math.max(-0.2, Math.min(0.85, camState.pitch + my * 0.004));
  camState.idle = 0;
}
window.addEventListener('mousemove', (e) => {
  if (!lookAllowed() || (!e.movementX && !e.movementY)) return;
  if (foot.active) foot.look(e.movementX, e.movementY);
  else lookBy(e.movementX, e.movementY);
});
// on foot with a mouse: click to capture it for free looking (Esc releases)
window.addEventListener('pointerdown', (e) => {
  if (e.pointerType !== 'mouse' || !foot || !foot.active || !lookAllowed() || st.touch) return;
  if (e.target.closest && e.target.closest('.pb, .ui-panel, .ui-menu')) return;
  if (document.pointerLockElement !== glCanvas && glCanvas.requestPointerLock) {
    try { const p = glCanvas.requestPointerLock(); if (p && p.catch) p.catch(() => {}); } catch (err) { /* needs a gesture */ }
  }
});
// touch screens: swipe on the picture (not on a button) to look around
const swipes = new Map();
window.addEventListener('pointerdown', (e) => {
  if (e.pointerType === 'mouse' || !lookAllowed()) return;
  if (e.target.closest && e.target.closest('.pb, .ui-panel, .ui-menu')) return;
  swipes.set(e.pointerId, { x: e.clientX, y: e.clientY });
});
window.addEventListener('pointermove', (e) => {
  const p = swipes.get(e.pointerId);
  if (!p) return;
  if (lookAllowed()) {
    if (foot.active) foot.look((e.clientX - p.x) * 1.6, (e.clientY - p.y) * 1.6);
    else lookBy((e.clientX - p.x) * 0.9, (e.clientY - p.y) * 0.9);
  }
  p.x = e.clientX;
  p.y = e.clientY;
});
for (const ev of ['pointerup', 'pointercancel']) window.addEventListener(ev, (e) => swipes.delete(e.pointerId));
function easeMouseLook(dt) {
  camState.idle = swipes.size ? 0 : camState.idle + dt; // a finger still down holds the view
  // after 1.5 s without mouse movement the view swings back behind the car
  if (camState.idle > 1.5) {
    const k = 1 - Math.exp(-dt * 2.5);
    camState.yaw -= camState.yaw * k;
    camState.pitch -= camState.pitch * k;
  }
}

const IDLE = { throttle: 0, brake: 0.4, steer: 0, handbrake: 1, any: false, manualOverride: false, analog: false };
function updateCamera(dt, car) {
  easeMouseLook(dt);
  if (foot.active && !photo.active) {
    foot.applyCamera(camera);
    player.mesh.visible = true;
    player.cockpit.setVisible(false);
    camState.init = false;
    return;
  }
  if (photo.active) {
    photo.update(dt);
    photo.apply(camera);
    player.mesh.visible = !photo.hideCar;
    player.cockpit.setVisible(false);
    return;
  }
  const mode = CAMS[st.cam];
  const o = world.origin;
  const V = player.veh;
  if (garage.isOpen) {
    // showroom: orbit the car slowly, keeping it on the left of the panel
    player.mesh.visible = true;
    player.cockpit.setVisible(false);
    const a = st.time * 0.22;
    const cp = _v3.set(car.x, car.y + 0.6, car.z);
    const r = 5.5 + player.L * 0.95;
    camera.position.set(cp.x + Math.cos(a) * r, cp.y + 1.0, cp.z + Math.sin(a) * r);
    camera.up.copy(_up);
    // aim to the right of the car so it sits in the left half (the panel is on the right)
    const dx = cp.x - camera.position.x, dz = cp.z - camera.position.z, dl = Math.hypot(dx, dz);
    camera.lookAt(cp.x - (dz / dl) * r * 0.2, cp.y, cp.z + (dx / dl) * r * 0.2);
    camera.near = 0.3;
    camera.fov = 45;
    camera.updateProjectionMatrix();
    camState.init = false;
    return;
  }
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
  const carPos = _v3.set(car.x, car.y + V.spec.comH, car.z);
  if (mode === 'TOP' || mode === 'FAR') {
    const top = mode === 'TOP';
    // camera direction: between the car's nose and its velocity
    const fwdH = _v1.set(V.fwd.x, 0, V.fwd.z).normalize();
    const velH = _v2.set(V.vel.x, 0, V.vel.z);
    if (velH.length() > 4 && V.fwdSpeed > 0) fwdH.lerp(velH.normalize(), top ? 0.45 : 0.55).normalize();
    if (!camState.init) camState.dir.copy(fwdH);
    camState.dir.lerp(fwdH, 1 - Math.exp(-dt * (top ? 2.2 : 3.2))).normalize();
    const big = Math.sqrt(player.L / 5.2) * (0.85 + 0.15 * (player.dims.H / 1.64));
    let dist = 11.5 * big, height = 3.5 * big, lookH = 0.9, ahead = 5.5;
    if (top) {
      // top ("art of rally" style): high and far back with a narrow lens, looking well
      // ahead so the car sits in the lower third. Tunnels and overpasses
      // pull it down low, so it never looks through a roof or a bridge deck.
      let low = 0;
      for (const ds of [-30, -15, 0, 12]) if (planner.at(player.s + ds, 'tunnel', 25) || planner.at(player.s + ds, 'toll', 25)) low = 1;
      if (world.overpassIn(player.s - 28, player.s + 15 + Math.abs(player.v) * 1.4)) low = 1;
      // down in a city under (or next to) the expressway viaduct
      if (player.layer === 'city' && player.d > -32 && player.d < 34) low = 1;
      camState.low += (low - camState.low) * (1 - Math.exp(-dt * 2.5));
      const k = camState.low;
      dist = (20 - 9 * k) * big;
      height = (12 - 7.6 * k) * big;
      lookH = 0;
      ahead = 11.5 + Math.min(Math.abs(player.v) * 0.18, 8);
    }
    const dir = _v4.copy(camState.dir).applyAxisAngle(_up, camState.yaw);
    const cp = Math.cos(camState.pitch), spitch = Math.sin(camState.pitch);
    const offT = _v1.copy(dir).multiplyScalar(-dist * cp);
    offT.y = -V.spec.comH + height + dist * spitch;
    const lookT = _v2.copy(dir).multiplyScalar(ahead * cp);
    lookT.y = -V.spec.comH + lookH;
    if (!camState.init) {
      camState.off.copy(offT);
      camState.lookOff.copy(lookT);
    }
    // smooth the offset relative to the car, so it never trails at speed
    const looking = camState.idle < 0.3;
    const kh = 1 - Math.exp(-dt * (looking ? 30 : 16)), kv = 1 - Math.exp(-dt * (looking ? 30 : 6));
    camState.off.x += (offT.x - camState.off.x) * kh;
    camState.off.z += (offT.z - camState.off.z) * kh;
    camState.off.y += (offT.y - camState.off.y) * kv;
    camState.lookOff.x += (lookT.x - camState.lookOff.x) * kh;
    camState.lookOff.z += (lookT.z - camState.lookOff.z) * kh;
    camState.lookOff.y += (lookT.y - camState.lookOff.y) * kv;
    camera.position.copy(carPos).add(camState.off);
    camera.up.copy(_up);
    camera.lookAt(_v1.copy(carPos).add(camState.lookOff));
    camera.rotateZ(sx * 0.0016 * (top ? 0.4 : 1));
    camera.rotateX(sy * 0.0012 * (top ? 0.4 : 1));
    fov = top ? 45 + Math.min(Math.abs(player.v) * 0.05, 4) : 48 + Math.min(Math.abs(player.v) * 0.14, 7);
    camState.init = true;
  } else if (mode === 'COCKPIT' || mode === 'BUMPER') {
    const inside = mode === 'COCKPIT';
    const eye = inside ? player.cockpit.eye : _v2.set(0, 0.78, player.L / 2 - 0.1);
    player.toWorld(eye.x, eye.y, eye.z, camera.position);
    // look 20 m ahead, turned by the mouse-look angles
    const ly = camState.yaw, lp = camState.pitch * -0.6;
    player.toWorld(eye.x + Math.sin(ly) * 20, eye.y - (inside ? 1.5 : 0.4) + Math.sin(lp) * 20, eye.z + Math.cos(ly) * 20, _v1);
    // the head stays fairly level: blend the car's roll/pitch with world up
    camera.up.copy(_up).applyQuaternion(V.quat).lerp(_up, 0.5).normalize();
    camera.lookAt(_v1);
    camera.rotateZ(sx * 0.002);
    camera.rotateX(sy * 0.0016);
    fov = (inside ? 56 : 60) + Math.min(Math.abs(player.v) * 0.12, 6);
    near = inside ? 0.05 : 0.15;
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
function streak(x, y, z, groundY, r, g, b, size, water = false) {
  // reflection of a light on the wet road, seen from the camera
  const c = camera.position;
  const hL = y - groundY;
  const hc = Math.max(0.3, c.y - groundY);
  const t = hc / (hc + hL);
  const px = c.x + (x - c.x) * t;
  const pz = c.z + (z - c.z) * t;
  const dx = px - c.x, dz = pz - c.z;
  const dist = Math.sqrt(dx * dx + dz * dz);
  if (dist > (water ? 700 : 200) || dist < 4) return;
  // only reflections in front of the camera, and small when very close
  camera.getWorldDirection(_fwd);
  if (dx * _fwd.x + dz * _fwd.z < 0) return;
  const k = Math.min(1, Math.max(0, (dist - 7) / 22)) * (water ? 1 : Math.max(0, 1 - Math.abs(groundY - streakGround) / 1.2));
  if (k <= 0.01) return;
  glows.add(px, groundY + 0.06, pz, r * k, g * k, b * k, size * 2.2 * (0.4 + 0.6 * k), 1);
}

// a hit cone tumbles onto its side, flung ahead and away from the car
const _m4 = new THREE.Matrix4(), _q4 = new THREE.Quaternion(), _ax = new THREE.Vector3();
function knockCone(ch, k) {
  if (!ch.coneMesh) return;
  const fr = path.sample(k.s, {});
  const p = path.point(k.s + 1.2 + k.hitV * 0.12, k.d + k.hitSide * (0.8 + Math.random()), 0.17);
  _ax.set(fr.fx, 0, fr.fz);
  _q4.setFromAxisAngle(_ax, (Math.PI / 2) * k.hitSide);
  _m4.compose(_v1.set(p.x - ch.anchor.x, p.y - ch.anchor.y, p.z - ch.anchor.z), _q4, _v2.set(1, 1, 1));
  ch.coneMesh.setMatrixAt(k.i, _m4);
  ch.coneMesh.instanceMatrix.needsUpdate = true;
}

// toll barrier arms lift for whoever approaches their lane
function updateArms(dt) {
  for (const ch of world.allChunks()) {
    for (const arm of ch.arms) {
      const lc = LANE_D[arm.lane];
      const near = (s, d) => s > arm.s - 35 && s < arm.s + 4 && Math.abs(d - lc) < 2.2;
      let open = near(player.s, player.d);
      if (!open) for (const c of traffic.cars) if (c.mesh.visible && near(c.s, c.d)) { open = true; break; }
      arm.lift += ((open ? 1 : 0) - arm.lift) * Math.min(1, dt * 4);
      arm.pivot.rotation.set(0, arm.pivot.rotation.y, -arm.lift * 1.35);
    }
  }
}

// 0..1: how deep inside a tunnel s is (ramps over the first/last 35 m)
function tunnelDepth(s) {
  const f = planner.at(s, 'tunnel', 0);
  if (!f) return 0;
  return Math.min(1, Math.min(s - f.s0, f.s1 - s) / 35);
}

let lastDistrict = '';
// what the world streams around: the car, or the person on foot
function updateFocus() {
  const w = foot && foot.active ? foot : null;
  world.focus = w ? { s: w.s, d: w.d, y: w.y } : { s: player.s, d: player.d, y: player.veh.pos.y };
  world.focusInfo = { walker: w ? { s: w.s, d: w.d, y: w.y } : null };
}
const TUNNEL_FOG = new THREE.Color(0.06, 0.05, 0.04);
function step(dt) {
  st.time += dt;
  const frozen = st.paused || photo.active || garage.isOpen || commute.panel.isOpen;
  if (!frozen) {
    st.hour = (st.hour + dt * st.timeScale) % 24;
  }
  readInput();
  if (st.mode === 'title') {
    if (!player.auto) {
      player.auto = true;
      player.autoLane = 1;
    }
  }
  if (!frozen) {
    const inp = st.mode === 'title' ? { throttle: 0, brake: 0, steer: 0, any: false } : input;
    player.update(dt, foot.active ? IDLE : inp, traffic);
    if (foot.active) foot.update(dt, keys);
    traffic.update(dt, player);
    for (const net of world.nets.values()) net.update(dt, player);
    if (st.mode === 'drive') commute.update(dt);
    for (const e of player.events) {
      if (e.type === 'close') {
        hud.popup(e.combo > 1 ? `CLOSE CALL X${e.combo}` : 'CLOSE CALL', '#ffcd6e');
        audio.chime(e.combo);
      } else if (e.type === 'cone') {
        knockCone(e.chunk, e.cone);
        commute.cone();
        audio.thump(0.12);
        hud.popup('CONE!', '#ff8a4a');
      } else if (e.type === 'reset') {
        hud.say('BACK ON THE ROAD');
      } else if (e.type === 'hit') {
        st.shake = Math.max(st.shake, e.power);
        audio.thump(e.power);
        commute.hit(e.power);
        if (e.power > 0.25) hud.popup(e.kind === 'wall' ? 'SCRAPE!' : 'BUMP!', '#ee4a33');
      }
    }
    player.events.length = 0;
    updateArms(dt);
    const cz = planner.at(player.s, 'city', 0);
    const dn = cz ? cz.name : planner.district(player.s).name;
    if (dn !== lastDistrict) {
      if (lastDistrict && st.mode === 'drive') hud.say(cz ? cz.name + ' · EXIT RIGHT · F TO WALK' : dn, cz ? 3.5 : 2.2);
      lastDistrict = dn;
    }
  }
  st.shake = Math.max(0, st.shake - dt * 2.5);
  radio.update(dt);
  path.trim(player.s - 400);
}

function render(dt) {
  const o = world.origin;
  updateFocus();
  world.update(world.focus.s);
  look = sky.apply(st.hour, scene, st.time);
  const night = look.night;
  world.setNight(night, st.time);
  // high up (mountain road, cable car, summit) the view reaches further
  const viewH = world.focus ? Math.max(0, camera.position.y + world.origin.y - (planner.at(world.focus.s, 'city', 0) || { base: 1e9 }).base) : 0;
  scene.fog.density = 0.0026 * W.fog * (1 - 0.65 * Math.min(1, viewH / 120));
  // inside a tunnel the sky light is shut out and the eye adapts a little
  const tk = tunnelDepth(player.s);
  st.tunnel = tk;
  if (tk > 0) {
    sky.hemi.intensity *= 1 - 0.85 * tk;
    sky.dir.intensity *= 1 - 0.97 * tk;
    scene.fog.color.lerp(TUNNEL_FOG, 0.7 * tk);
  }
  // no bright sky reflections on the tunnel's road
  world.mRoad.envMapIntensity = world.mOpp.envMapIntensity = 0.35 * (1 - 0.9 * tk);
  // ...and the tunnel road is dry (no glossy puddles)
  world.mRoad.roughness = world.mOpp.roughness = (0.92 - W.wet * 0.6) * (1 - tk) + 0.9 * tk;
  pipe.post.uniforms.exposure.value = look.exp * (1 + 0.35 * tk);

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
      const on = Math.sin(st.time * (g.always ? 6 : 2.2) + g.blink) > 0.3;
      if (!on) continue;
      if (g.always) glows.add(x, y, z, g.r, g.g, g.b, g.size); // amber flashers
      else glows.add(x, y, z, 1.6 * night + 0.2, 0.2, 0.12, g.size); // aviation lights
      continue;
    }
    // feature lights (tunnels, booths) are on day and night
    const k = g.always ? Math.max(lampK, 1) : lampK;
    if (k <= 0.01) continue;
    glows.add(x, y, z, g.r * k, g.g * k, g.b * k, g.size);
    if (g.wy !== undefined) streak(x, y, z, g.wy - world.origin.y, g.r * k * 0.6, g.g * k * 0.6, g.b * k * 0.6, g.size * 1.6, true);
    else if (wet > 0.05 && g.h) streak(x, y, z, y - g.h, g.r * k * wet * 0.7, g.g * k * wet * 0.7, g.b * k * wet * 0.7, g.size * 1.1);
  }
  for (const l of world.allLights()) {
    const k = l.always ? Math.max(lampK, 1) : lampK;
    if (k <= 0.01) continue;
    lampCands.push({ x: l.x - world.origin.x, y: l.y - world.origin.y, z: l.z - world.origin.z, r: l.r, g: l.g, b: l.b, power: l.power * k, range: 30 });
  }
  const fx = Math.sin(carNow.h), fz = Math.cos(carNow.h);
  const focus = { x: carNow.x + fx * 30, y: carNow.y, z: carNow.z + fz * 30 };
  lamps.assign(lampCands, focus, 55);

  wheelPool.begin();
  traffic.render(world.origin, glows, wet, Math.max(0.35, night), st.time, streak);
  for (const net of world.nets.values()) net.render(world.origin, glows, Math.max(0.35, night), st.time);
  wheelPool.end();
  commute.glows(world.origin, (...a) => glows.add(...a), st.time);
  // the showroom keeps the cars around the player out of shot
  for (const tc of traffic.cars) tc.mesh.scale.setScalar(garage.isOpen && Math.abs(tc.s - player.s) < 25 ? 0 : 1);
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
  weather.amountScale = 1 - tk;
  weather.update(dt, camera, { x: fx * player.v, z: fz * player.v }, st.time, st.h, 0.5 + 0.6 * (1 - night) + night * 0.55,
    CAMS[st.cam] === 'COCKPIT' ? 2.6 : 0);

  pipe.render(scene, camera);
  hud.draw({
    onFoot: foot.active, prompt: foot.active ? foot.prompt : '',
    mode: st.mode, hour: st.hour, period: look.name, weather: W.name, odo: player.odo, closeCalls: player.closeCalls,
    speed: player.v, vmax: VMAX, auto: player.auto, music: audio.ctx && audio.music, stationName: radio.label(),
    commute: st.mode === 'drive' ? commute.hudState() : null,
    time: st.time, paused: st.paused, touch: st.touch, photo: photo.active || garage.isOpen, gear: player.gearLabel(), rpm: player.veh.rpm, redline: player.veh.spec.redline,
  }, dt);
  if (CAMS[st.cam] === 'COCKPIT') {
    const V = player.veh;
    player.cockpit.update((V.wheels[0].steerA + V.wheels[1].steerA) / 2, Math.abs(V.fwdSpeed) * 3.6, V.rpm, player.gearLabel(),
      player.veh.spec.redline, audio.ctx && audio.music ? radio.short() : 'OFF', st.time);
  }
  audio.update(Math.abs(player.v), player.veh.throttle, W.kind === 'rain' ? 1 : 0, player.scrape, player.veh.rpm, player.veh.slip);
}

// prime the world
updateFocus();
world.update(player.s, true);
traffic.init(player.s);
// compile every shader up front (rain, snow, night lights...) so the first
// weather / time change does not stall a phone while it compiles
weather.snow.visible = weather.rain.visible = true;
// (compiled against the low-res scene target: programs differ from the canvas ones)
try {
  renderer.setRenderTarget(pipe.sceneRT);
  renderer.compile(scene, camera);
  renderer.setRenderTarget(null);
} catch (e) { /* optional */ }

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
  st, player, traffic, world, planner, commute, openJobs, get foot() { return foot; }, camera, garage, openGarage, radio, openRadio, audio, pipe, sky, renderer, photo, enterPhoto, exitPhoto, pauseMenu,
  advance(sec, fps = 30) {
    const dt = 1 / fps;
    for (let t = 0; t < sec; t += dt) {
      step(dt);
      updateFocus();
      world.update(world.focus.s, true);
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
    g.drawImage(hud2Canvas, 0, 0, c.width, c.height);
    await fetch(`/__snap?name=${name}`, { method: 'POST', body: c.toDataURL('image/png') });
    return `${st.w}x${st.h}`;
  },
};

// ------------------------------------------------------------------ PWA
// offline + installable; only in production builds (the dev server must not be cached)
if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => navigator.serviceWorker.register('./sw.js').catch(() => {}));
}
