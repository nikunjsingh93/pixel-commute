// Light effects that sell the night: additive glow sprites for every lamp
// and tail light (one draw call), vertical reflection streaks on the wet
// road, and a small pool of real point lights that follows the camera.
import * as THREE from 'three';

const GLOW_VS = /* glsl */ `
attribute vec3 gcol;
attribute vec2 gsize; // x = world size, y = kind (0 glow, 1 streak)
uniform float pxScale;
uniform float pxK; // render height / 200: keeps sprite sizes consistent across resolutions
uniform float fogDensity;
varying vec3 vCol;
varying float vKind;
varying float vFog;
void main() {
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  float dist = length(mv.xyz);
  // pull glows slightly toward the camera so their own lamp housing
  // does not occlude them
  if (gsize.y < 0.5) mv.xyz *= max(0.0, 1.0 - 0.7 / max(dist, 0.01));
  gl_Position = projectionMatrix * mv;
  float px = gsize.x * pxScale / max(-mv.z, 0.1);
  gl_PointSize = clamp(px, 2.0 * pxK, (gsize.y > 0.5 ? 40.0 : 18.0) * pxK);
  // tiny far lights keep a minimum brightness instead of vanishing
  float f = fogDensity * dist;
  vFog = exp(-f * f);
  vCol = gcol * (px < 2.0 * pxK ? max(px / (2.0 * pxK), 0.35) : 1.0);
  vKind = gsize.y;
}
`;
const GLOW_FS = /* glsl */ `
varying vec3 vCol;
varying float vKind;
varying float vFog;
void main() {
  vec2 p = gl_PointCoord - 0.5;
  float a;
  if (vKind < 0.5) {
    float r = length(p) * 2.0;
    a = pow(max(1.0 - r, 0.0), 2.2) * 1.4 + step(r, 0.18) * 1.2;
  } else {
    // vertical streak starting at the reflection point, smeared toward
    // the viewer (down the screen)
    float x = p.x * 11.0;
    float y = gl_PointCoord.y;
    a = exp(-x * x) * smoothstep(0.38, 0.5, y) * pow(1.0 - y, 0.7) * 1.3;
  }
  if (a < 0.01) discard;
  gl_FragColor = vec4(vCol * a * vFog, 1.0);
}
`;

export class Glows {
  constructor(scene, max = 3000) {
    this.max = max;
    this.pos = new Float32Array(max * 3);
    this.col = new Float32Array(max * 3);
    this.size = new Float32Array(max * 2);
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('gcol', new THREE.BufferAttribute(this.col, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('gsize', new THREE.BufferAttribute(this.size, 2).setUsage(THREE.DynamicDrawUsage));
    this.geo = g;
    this.mat = new THREE.ShaderMaterial({
      vertexShader: GLOW_VS,
      fragmentShader: GLOW_FS,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      uniforms: { pxScale: { value: 100 }, pxK: { value: 1 }, fogDensity: { value: 0.003 } },
    });
    this.points = new THREE.Points(g, this.mat);
    this.points.frustumCulled = false;
    this.points.renderOrder = 5;
    scene.add(this.points);
    this.n = 0;
  }
  begin() {
    this.n = 0;
  }
  add(x, y, z, r, g, b, size, kind = 0) {
    if (this.n >= this.max) return;
    const i = this.n++;
    this.pos[i * 3] = x; this.pos[i * 3 + 1] = y; this.pos[i * 3 + 2] = z;
    this.col[i * 3] = r; this.col[i * 3 + 1] = g; this.col[i * 3 + 2] = b;
    this.size[i * 2] = size; this.size[i * 2 + 1] = kind;
  }
  end(camera, viewH) {
    this.geo.setDrawRange(0, this.n);
    for (const k of ['position', 'gcol', 'gsize']) {
      const a = this.geo.attributes[k];
      a.needsUpdate = true;
      a.clearUpdateRanges();
      a.addUpdateRange(0, this.n * a.itemSize);
    }
    this.mat.uniforms.pxScale.value = viewH / (2 * Math.tan((camera.fov * Math.PI) / 360));
    this.mat.uniforms.pxK.value = Math.max(1, viewH / 200);
  }
}

// N real point lights, re-assigned every frame to the most relevant lamps
export class LightPool {
  constructor(scene, n = 10) {
    this.lights = [];
    for (let i = 0; i < n; i++) {
      const l = new THREE.PointLight(0xffb060, 0, 34, 1.6);
      scene.add(l);
      this.lights.push(l);
    }
    this.cand = [];
  }
  // cands: [{x,y,z (relative), r,g,b, power}] ; focus = point ahead of camera
  assign(cands, focus, scale) {
    const R = 120;
    for (const c of cands) {
      const dx = c.x - focus.x, dy = c.y - focus.y, dz = c.z - focus.z;
      c.dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
    }
    cands.sort((a, b) => a.dist - b.dist);
    for (let i = 0; i < this.lights.length; i++) {
      const l = this.lights[i];
      const c = cands[i];
      if (!c || c.dist > R) {
        l.intensity = 0;
        continue;
      }
      const fade = Math.min(1, Math.max(0, (R - c.dist) / (R * 0.35)));
      l.position.set(c.x, c.y, c.z);
      l.color.setRGB(c.r, c.g, c.b);
      l.intensity = c.power * scale * fade;
      l.distance = c.range || 34;
    }
  }
}
