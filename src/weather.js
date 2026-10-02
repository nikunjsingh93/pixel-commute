// Snow (1-2 px points) and rain (short slanted line segments) living in a
// box that wraps around the camera, so the car drives through them.
import * as THREE from 'three';

const BOX = { x: 34, y: 18, zf: 70, zb: 8 };

const SNOW_VS = /* glsl */ `
attribute float tint;
uniform float pxScale;
uniform float pxK;
varying float vTint;
varying float vFade;
void main() {
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * mv;
  float d = -mv.z;
  gl_PointSize = clamp(0.07 * pxScale / max(d, 0.1), pxK, 2.0 * pxK);
  vTint = tint;
  vFade = smoothstep(55.0, 12.0, d) * smoothstep(0.3, 1.5, d) * 0.8;
}
`;
const SNOW_FS = /* glsl */ `
uniform vec3 cold;
uniform vec3 warm;
uniform float bright;
varying float vTint;
varying float vFade;
void main() {
  gl_FragColor = vec4(mix(cold, warm, vTint) * bright * vFade, 1.0);
}
`;

export class Weather {
  constructor(scene) {
    this.scene = scene;
    const N = 6000;
    this.N = N;
    this.p = new Float32Array(N * 3); // positions relative to camera box
    this.vel = new Float32Array(N);
    this.phase = new Float32Array(N);
    const tint = new Float32Array(N);
    for (let i = 0; i < N; i++) {
      this.p[i * 3] = (Math.random() * 2 - 1) * BOX.x;
      this.p[i * 3 + 1] = (Math.random() * 2 - 1) * BOX.y;
      this.p[i * 3 + 2] = -BOX.zb + Math.random() * (BOX.zf + BOX.zb);
      this.vel[i] = 0.7 + Math.random() * 0.6;
      this.phase[i] = Math.random() * 100;
      tint[i] = Math.random() < 0.1 ? 1 : 0;
    }
    // snow
    this.snowPos = new Float32Array(N * 3);
    const sg = new THREE.BufferGeometry();
    sg.setAttribute('position', new THREE.BufferAttribute(this.snowPos, 3).setUsage(THREE.DynamicDrawUsage));
    sg.setAttribute('tint', new THREE.BufferAttribute(tint, 1));
    this.snowMat = new THREE.ShaderMaterial({
      vertexShader: SNOW_VS,
      fragmentShader: SNOW_FS,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      uniforms: {
        pxScale: { value: 100 }, pxK: { value: 1 }, cold: { value: new THREE.Color(0.75, 0.82, 0.95) },
        warm: { value: new THREE.Color(1.0, 0.55, 0.25) }, bright: { value: 1 },
      },
    });
    this.snow = new THREE.Points(sg, this.snowMat);
    this.snow.frustumCulled = false;
    this.snow.renderOrder = 6;
    scene.add(this.snow);
    // rain
    this.rainPos = new Float32Array(N * 6);
    const rg = new THREE.BufferGeometry();
    rg.setAttribute('position', new THREE.BufferAttribute(this.rainPos, 3).setUsage(THREE.DynamicDrawUsage));
    this.rainMat = new THREE.LineBasicMaterial({ color: new THREE.Color(0.45, 0.55, 0.7), transparent: true, opacity: 0.3, depthWrite: false });
    this.rain = new THREE.LineSegments(rg, this.rainMat);
    this.rain.frustumCulled = false;
    scene.add(this.rain);
    this.kind = 'snow';
    this.amount = 1;
    this.drift = 0;
  }

  set(kind, amount) {
    this.kind = kind;
    this.amount = amount;
  }

  // vel: camera velocity (world), so flakes stream past the windscreen
  // clearR: keep a particle-free bubble around the camera (cockpit view)
  update(dt, camera, carVel, time, viewH, light, clearR = 0) {
    const n = Math.floor(this.N * Math.min(1, this.amount));
    const cam = camera.position;
    this.drift += dt;
    const snow = this.kind === 'snow';
    const rain = this.kind === 'rain';
    this.snow.visible = snow && n > 0;
    this.rain.visible = rain && n > 0;
    if (!snow && !rain) return;
    const fall = snow ? 1.4 : 16;
    const wind = snow ? 0.8 : 2.5;
    // a square, world-aligned box centred a little ahead of the camera
    const fx = carVel.x, fz = carVel.z;
    const sp = Math.hypot(fx, fz) || 1;
    const cx = cam.x + (fx / sp) * 20;
    const cz = cam.z + (fz / sp) * 20;
    const H = 32, Y0 = cam.y - 7, YH = 22;
    const wrap = (v, c, h) => c + ((((v - c + h) % (2 * h)) + 2 * h) % (2 * h)) - h;
    const P = this.p;
    for (let i = 0; i < n; i++) {
      const k = i * 3;
      const v = this.vel[i];
      const x = P[k] + (wind + (snow ? Math.sin(time * 1.3 + this.phase[i]) * 0.9 : 0)) * dt;
      const y = P[k + 1] - fall * v * dt;
      const z = P[k + 2] + (snow ? Math.cos(time * 0.9 + this.phase[i]) * 0.5 * dt : 0);
      P[k] = wrap(x, cx, H);
      P[k + 1] = Y0 + ((((y - Y0) % YH) + YH) % YH);
      P[k + 2] = wrap(z, cz, H);
    }
    if (snow) {
      this.snowPos.set(P.subarray(0, n * 3));
      if (clearR > 0) this.clear(this.snowPos, n, 3, cam, clearR);
      const a = this.snow.geometry.attributes.position;
      a.needsUpdate = true;
      this.snow.geometry.setDrawRange(0, n);
      this.snowMat.uniforms.pxScale.value = viewH / (2 * Math.tan((camera.fov * Math.PI) / 360));
      this.snowMat.uniforms.pxK.value = Math.max(1, Math.round(viewH / 200));
      this.snowMat.uniforms.bright.value = light;
    } else {
      const R = this.rainPos;
      const sx = wind * 0.02 - fx * 0.012, sy = -fall * 0.028, sz = -fz * 0.012;
      for (let i = 0; i < n; i++) {
        const k = i * 3, r = i * 6;
        R[r] = P[k]; R[r + 1] = P[k + 1]; R[r + 2] = P[k + 2];
        R[r + 3] = P[k] + sx; R[r + 4] = P[k + 1] + sy * this.vel[i]; R[r + 5] = P[k + 2] + sz;
      }
      if (clearR > 0) this.clear(R, n, 6, cam, clearR);
      this.rain.geometry.attributes.position.needsUpdate = true;
      this.rain.geometry.setDrawRange(0, n * 2);
      this.rainMat.color.setRGB(0.3 * light + 0.08, 0.36 * light + 0.1, 0.46 * light + 0.12);
    }
  }

  // hide particles that would be inside the car around the camera
  clear(arr, n, stride, cam, r) {
    const r2 = r * r;
    for (let i = 0; i < n; i++) {
      const k = i * stride;
      const dx = arr[k] - cam.x, dy = arr[k + 1] - cam.y, dz = arr[k + 2] - cam.z;
      if (dx * dx + dy * dy + dz * dz < r2) {
        for (let j = 0; j < stride; j += 3) arr[k + j + 1] -= 1000;
      }
    }
  }

  // shift stored positions after a floating-origin rebase
  rebase(dx, dy, dz) {
    for (let i = 0; i < this.N; i++) {
      this.p[i * 3] -= dx;
      this.p[i * 3 + 1] -= dy;
      this.p[i * 3 + 2] -= dz;
    }
  }
}
