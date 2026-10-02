// Sky dome, moon, distant skyline band, hemisphere/moon lights and the
// time-of-day keyframes that drive all of them.
import * as THREE from 'three';
import { moonTexture, skylineTexture } from './textures.js';

// hour -> look. Colours are sRGB hex (THREE.Color converts to linear).
const KEYS = [
  { h: 0.0, name: 'NIGHT', zen: '#05070f', hor: '#18203a', glow: '#2a2f4a', fog: '#111727', hs: '#26324f', hg: '#0d0c0c', hi: 0.55, dc: '#6a7fb0', di: 0.18, night: 1, stars: 1, exp: 1.25 },
  { h: 5.0, name: 'NIGHT', zen: '#070a16', hor: '#1d2541', glow: '#3a3550', fog: '#151b2d', hs: '#2a3654', hg: '#0e0d0d', hi: 0.6, dc: '#6a7fb0', di: 0.2, night: 1, stars: 0.9, exp: 1.25 },
  { h: 6.2, name: 'DAWN', zen: '#3e5687', hor: '#e8b49a', glow: '#ffb27a', fog: '#9a98a8', hs: '#8a98c0', hg: '#3a302a', hi: 1.0, dc: '#ffc7a0', di: 0.6, night: 0.5, stars: 0.1, exp: 1.0 },
  { h: 8.0, name: 'DAYTIME', zen: '#5d84bd', hor: '#c9d8ea', glow: '#ffe2bc', fog: '#a9b8cc', hs: '#b5c8e6', hg: '#4c4438', hi: 1.6, dc: '#fff0d8', di: 1.4, night: 0.0, stars: 0, exp: 0.85 },
  { h: 16.5, name: 'AFTERNOON', zen: '#5a7fb6', hor: '#cdd6e2', glow: '#ffe0b8', fog: '#aab6c6', hs: '#b8c6e0', hg: '#4c4438', hi: 1.55, dc: '#fff0d8', di: 1.3, night: 0.0, stars: 0, exp: 0.85 },
  { h: 18.3, name: 'SUNSET', zen: '#3a4a82', hor: '#f0a27a', glow: '#ff9a5a', fog: '#a48a96', hs: '#9a8fb8', hg: '#3a2c26', hi: 1.15, dc: '#ffb07a', di: 0.8, night: 0.45, stars: 0.0, exp: 0.95 },
  { h: 19.2, name: 'BLUE HOUR', zen: '#3b5a8e', hor: '#9fb6d4', glow: '#c9b8c4', fog: '#7a92b4', hs: '#7c94bf', hg: '#2c2622', hi: 1.05, dc: '#9fb2d8', di: 0.45, night: 0.85, stars: 0.12, exp: 1.05 },
  { h: 20.4, name: 'EVENING', zen: '#18233f', hor: '#4a5f86', glow: '#6a6a8a', fog: '#36466a', hs: '#4a5a84', hg: '#16130f', hi: 0.8, dc: '#7d90c0', di: 0.3, night: 1, stars: 0.6, exp: 1.15 },
  { h: 21.5, name: 'NIGHT', zen: '#070a16', hor: '#1d2541', glow: '#3a3550', fog: '#151b2d', hs: '#2a3654', hg: '#0e0d0d', hi: 0.6, dc: '#6a7fb0', di: 0.2, night: 1, stars: 0.9, exp: 1.25 },
  { h: 24.0, name: 'NIGHT', zen: '#05070f', hor: '#18203a', glow: '#2a2f4a', fog: '#111727', hs: '#26324f', hg: '#0d0c0c', hi: 0.55, dc: '#6a7fb0', di: 0.18, night: 1, stars: 1, exp: 1.25 },
];
const COLS = ['zen', 'hor', 'glow', 'fog', 'hs', 'hg', 'dc'];
const NUMS = ['hi', 'di', 'night', 'stars', 'exp'];
for (const k of KEYS) for (const c of COLS) k[c] = new THREE.Color(k[c]);

export function lookAt(hour) {
  hour = ((hour % 24) + 24) % 24;
  let i = 0;
  while (i < KEYS.length - 2 && KEYS[i + 1].h <= hour) i++;
  const a = KEYS[i], b = KEYS[i + 1];
  const t = (hour - a.h) / (b.h - a.h);
  const s = t * t * (3 - 2 * t);
  const out = { name: t < 0.5 ? a.name : b.name };
  for (const c of COLS) out[c] = a[c].clone().lerp(b[c], s);
  for (const n of NUMS) out[n] = a[n] + (b[n] - a[n]) * s;
  return out;
}

const SKY_VS = /* glsl */ `
varying vec3 vDir;
void main() {
  vDir = normalize(position);
  vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  gl_Position = p.xyww;
}
`;
const SKY_FS = /* glsl */ `
uniform vec3 zen, hor, glow, ground;
uniform float stars, time, overcast;
uniform vec3 glowDir;
varying vec3 vDir;
float h3(vec3 p) { return fract(sin(dot(p, vec3(127.1, 311.7, 74.7))) * 43758.5453); }
float n2(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  float a = h3(vec3(i, 0.0)), b = h3(vec3(i + vec2(1, 0), 0.0));
  float c = h3(vec3(i + vec2(0, 1), 0.0)), d = h3(vec3(i + vec2(1, 1), 0.0));
  return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
}
void main() {
  vec3 d = normalize(vDir);
  float y = d.y;
  vec3 col;
  if (y > 0.0) {
    col = mix(hor, zen, pow(min(y * 1.6, 1.0), 0.65));
    // warm glow near the horizon toward the sun / city
    float g = pow(max(dot(normalize(vec3(d.x, 0.0, d.z)), glowDir), 0.0), 3.0);
    col = mix(col, glow, g * exp(-y * 7.0) * 0.85);
    // wispy cloud bands
    vec2 uv = d.xz / (y + 0.12) * 1.6;
    float c = n2(uv * 1.3 + vec2(time * 0.01, 0.0)) * 0.6 + n2(uv * 3.1) * 0.4;
    c = smoothstep(0.55 - overcast * 0.4, 0.95, c) * smoothstep(0.0, 0.25, y);
    col = mix(col, mix(hor, glow, 0.35) * 1.05, c * (0.25 + overcast * 0.5));
    // stars
    vec3 cell = floor(d * 260.0);
    float s = h3(cell);
    float tw = 0.7 + 0.3 * sin(time * 3.0 + s * 50.0);
    col += vec3(0.85, 0.9, 1.0) * step(0.9965, s) * stars * tw * smoothstep(0.05, 0.3, y) * (1.0 - c);
  } else {
    col = mix(hor, ground, min(-y * 6.0, 1.0));
  }
  gl_FragColor = vec4(col, 1.0);
}
`;

const RING_VS = /* glsl */ `
varying vec2 vUv;
void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }
`;
const RING_FS = /* glsl */ `
uniform sampler2D map;
uniform vec3 hor, sil, win;
uniform float night;
varying vec2 vUv;
void main() {
  vec4 t = texture2D(map, vUv);
  if (t.r < 0.05) discard;
  float far = t.b;
  vec3 c = mix(sil, hor, far > 0.5 ? 0.62 : 0.38);
  vec3 w = win * night * (far > 0.5 ? 0.55 : 0.9);
  c = mix(c, w + c * 0.5, step(0.5, t.g) * night);
  gl_FragColor = vec4(c, 1.0);
}
`;

export class Sky {
  constructor(scene) {
    this.scene = scene;
    this.group = new THREE.Group();
    scene.add(this.group);

    this.mat = new THREE.ShaderMaterial({
      vertexShader: SKY_VS,
      fragmentShader: SKY_FS,
      side: THREE.BackSide,
      depthWrite: false,
      uniforms: {
        zen: { value: new THREE.Color() }, hor: { value: new THREE.Color() }, glow: { value: new THREE.Color() },
        ground: { value: new THREE.Color('#0b0e18') }, stars: { value: 0 }, time: { value: 0 }, overcast: { value: 0 },
        glowDir: { value: new THREE.Vector3(0.3, 0, 1).normalize() },
      },
    });
    this.dome = new THREE.Mesh(new THREE.SphereGeometry(100, 24, 16), this.mat);
    this.dome.renderOrder = -10;
    this.dome.frustumCulled = false;
    this.group.add(this.dome);

    this.moonMat = new THREE.MeshBasicMaterial({
      map: moonTexture(), alphaTest: 0.5, depthWrite: false, fog: false, color: new THREE.Color(1.6, 1.6, 1.7),
    });
    this.moon = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), this.moonMat);
    this.moon.renderOrder = -9;
    this.group.add(this.moon);
    this.moonDir = new THREE.Vector3(-0.55, 0.42, 0.72).normalize();

    this.ringMat = new THREE.ShaderMaterial({
      vertexShader: RING_VS,
      fragmentShader: RING_FS,
      side: THREE.BackSide,
      depthWrite: false,
      uniforms: {
        map: { value: skylineTexture() }, hor: { value: new THREE.Color() }, sil: { value: new THREE.Color() },
        win: { value: new THREE.Color(1.0, 0.75, 0.4) }, night: { value: 1 },
      },
    });
    this.ringMat.uniforms.map.value.repeat.set(3, 1);
    const ring = new THREE.CylinderGeometry(90, 90, 14, 64, 1, true);
    // uv.x repeats 3 times around
    const uv = ring.attributes.uv;
    for (let i = 0; i < uv.count; i++) uv.setX(i, uv.getX(i) * 3);
    this.ring = new THREE.Mesh(ring, this.ringMat);
    this.ring.renderOrder = -8;
    this.ring.frustumCulled = false;
    this.group.add(this.ring);

    this.hemi = new THREE.HemisphereLight(0xffffff, 0x222222, 1);
    this.dir = new THREE.DirectionalLight(0xffffff, 0.5);
    this.dir.position.set(-0.5, 1, 0.6);
    scene.add(this.hemi, this.dir, this.dir.target);
    this.look = null;
    this.overcast = 0;
  }

  apply(hour, scene, t) {
    const L = lookAt(hour);
    this.look = L;
    const u = this.mat.uniforms;
    const dim = 1 - this.overcast * 0.35;
    u.zen.value.copy(L.zen).lerp(L.hor, this.overcast * 0.6);
    u.hor.value.copy(L.hor).multiplyScalar(dim);
    u.glow.value.copy(L.glow);
    u.stars.value = L.stars * (1 - this.overcast);
    u.time.value = t;
    u.overcast.value = this.overcast;
    this.ringMat.uniforms.hor.value.copy(L.fog);
    this.ringMat.uniforms.sil.value.copy(L.zen).multiplyScalar(0.55);
    this.ringMat.uniforms.night.value = L.night;
    const mb = Math.min(1, 0.25 + L.night) * (1 - this.overcast * 0.8);
    this.moonMat.color.setRGB(1.6 * mb, 1.6 * mb, 1.7 * mb).lerp(L.hor, 1 - mb);
    if (scene.fog) scene.fog.color.copy(L.fog).multiplyScalar(dim);
    this.hemi.color.copy(L.hs);
    this.hemi.groundColor.copy(L.hg);
    this.hemi.intensity = L.hi * (1 - this.overcast * 0.2);
    this.dir.color.copy(L.dc);
    this.dir.intensity = L.di * (1 - this.overcast * 0.6);
    return L;
  }

  follow(camera) {
    // the dome, ring and moon are parallax-free: they ride with the camera
    this.group.position.copy(camera.position);
    this.ring.position.y = 4;
    this.moon.position.copy(this.moonDir).multiplyScalar(80);
    this.moon.scale.setScalar(5.2);
    this.moon.lookAt(camera.position);
    this.dir.target.position.copy(camera.position);
    this.dir.position.copy(camera.position).add(new THREE.Vector3(-30, 60, 40));
  }
}
