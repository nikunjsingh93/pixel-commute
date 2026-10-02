// Pixel-art pipeline: the 3D scene renders into a tiny HDR target, then a
// post pass tonemaps, grades, outlines (depth edges), applies a 4x4 Bayer
// dither and snaps every pixel to a fixed palette, straight into a canvas
// of the same size that CSS upscales with nearest-neighbour sampling.
import * as THREE from 'three';

// Palette tuned on the blue-hour reference: navy sky ramps, warm concrete,
// cool asphalt, sodium oranges, tail-light reds, a few greens + creams.
export const PALETTE = [
  // night blues
  '#07090f', '#0c0f1a', '#131827', '#1b2236', '#252e47', '#313d5a', '#3f4e70',
  '#506488', '#627ba0', '#7891b6', '#90a8c9', '#a9bfd9', '#c5d4e8', '#e2eaf4',
  // dusk purples / mauves
  '#2a2236', '#3c2f48', '#55405c', '#755470', '#9a6b80', '#c48a8e',
  // warm concrete
  '#1c1916', '#28231f', '#37302a', '#483f36', '#5c5145', '#716455', '#887866',
  '#a08f79', '#b9a88e', '#d2c4a8',
  // cool asphalt
  '#1f2128', '#2a2d35', '#363a44', '#454a55', '#585e6a', '#6d7380',
  // sodium / warm light
  '#3d2116', '#66331b', '#94491f', '#c26527', '#e58a35', '#f6ad4b', '#ffcd6e',
  '#ffe39e', '#fff3d2',
  // reds
  '#2e0b10', '#561216', '#8c1b1d', '#c62a25', '#ee4a33', '#ff7a55', '#ffae8a',
  // greens
  '#11221c', '#1a362b', '#26503d', '#3a7055', '#5b9271',
  // yellow + white
  '#a58322', '#d6b23e', '#f0d870', '#f4f1e8', '#ffffff',
];

const BLIT_VS = /* glsl */ `
varying vec2 vUv;
void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }
`;

const POST_FS = /* glsl */ `
precision highp float;
uniform sampler2D tColor;
uniform sampler2D tDepth;
uniform vec2 res;
uniform vec3 pal[${PALETTE.length}];
uniform float near;
uniform float far;
uniform float exposure;
uniform float dither;
uniform float outline;
uniform int mode;          // 0 palette, 1 posterize, 2 raw
uniform vec3 lift;         // shadow tint
uniform vec3 gain;         // highlight tint
uniform float saturation;
uniform float vignette;
varying vec2 vUv;

float linDepth(vec2 p) {
  float z = texture2D(tDepth, (p + 0.5) / res).x;
  float ndc = z * 2.0 - 1.0;
  return (2.0 * near * far) / (far + near - ndc * (far - near));
}

float bayer4(vec2 p) {
  int x = int(mod(p.x, 4.0));
  int y = int(mod(p.y, 4.0));
  int i = x + y * 4;
  float m[16];
  m[0]=0.;m[1]=8.;m[2]=2.;m[3]=10.;m[4]=12.;m[5]=4.;m[6]=14.;m[7]=6.;
  m[8]=3.;m[9]=11.;m[10]=1.;m[11]=9.;m[12]=15.;m[13]=7.;m[14]=13.;m[15]=5.;
  for (int k = 0; k < 16; k++) if (k == i) return (m[k] + 0.5) / 16.0;
  return 0.5;
}

vec3 aces(vec3 x) {
  return clamp((x * (2.51 * x + 0.03)) / (x * (2.43 * x + 0.59) + 0.14), 0.0, 1.0);
}

vec3 toSRGB(vec3 c) {
  return mix(c * 12.92, 1.055 * pow(c, vec3(1.0 / 2.4)) - 0.055, step(0.0031308, c));
}

void main() {
  vec2 px = floor(vUv * res);
  vec3 c = texture2D(tColor, (px + 0.5) / res).rgb;

  // depth outline: darken the near side of strong depth discontinuities
  float d = linDepth(px);
  float e = 0.0;
  if (d < 220.0) {
    float n1 = linDepth(px + vec2(1.0, 0.0));
    float n2 = linDepth(px - vec2(1.0, 0.0));
    float n3 = linDepth(px + vec2(0.0, 1.0));
    float n4 = linDepth(px - vec2(0.0, 1.0));
    float m = max(max(n1, n2), max(n3, n4)) - d;
    e = step(0.6 + d * 0.12, m);
  }
  c *= 1.0 - e * outline;

  c = aces(c * exposure);
  c = toSRGB(c);
  // grade
  float l = dot(c, vec3(0.299, 0.587, 0.114));
  c = mix(vec3(l), c, saturation);
  c = c * gain + lift * (1.0 - c);
  vec2 q = vUv - 0.5;
  c *= 1.0 - vignette * dot(q, q) * 2.2;
  c = clamp(c, 0.0, 1.0);

  if (mode == 2) { gl_FragColor = vec4(c, 1.0); return; }

  float b = bayer4(px) - 0.5;
  if (mode == 1) {
    float lv = 7.0;
    c = floor(c * lv + 0.5 + b * dither * 6.0) / lv;
    gl_FragColor = vec4(clamp(c, 0.0, 1.0), 1.0);
    return;
  }

  vec3 t = c + b * dither;
  float best = 1e9;
  vec3 bc = vec3(0.0);
  for (int i = 0; i < ${PALETTE.length}; i++) {
    vec3 p = pal[i];
    vec3 dd = t - p;
    float rm = (t.r + p.r) * 0.5;
    float dist = (2.0 + rm) * dd.r * dd.r + 4.0 * dd.g * dd.g + (3.0 - rm) * dd.b * dd.b;
    if (dist < best) { best = dist; bc = p; }
  }
  gl_FragColor = vec4(bc, 1.0);
}
`;


export class PixelPipeline {
  constructor(renderer) {
    this.renderer = renderer;
    this.w = 320;
    this.h = 180;
    this.scene = new THREE.Scene();
    this.cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    this.quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2));
    this.quad.frustumCulled = false;
    this.scene.add(this.quad);

    // quantization happens in sRGB space, so use the raw hex values
    const pal = PALETTE.map((h) => {
      const n = parseInt(h.slice(1), 16);
      return new THREE.Vector3((n >> 16) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255);
    });

    this.post = new THREE.ShaderMaterial({
      vertexShader: BLIT_VS,
      fragmentShader: POST_FS,
      depthTest: false,
      depthWrite: false,
      uniforms: {
        tColor: { value: null },
        tDepth: { value: null },
        res: { value: new THREE.Vector2() },
        pal: { value: pal },
        near: { value: 0.1 },
        far: { value: 3000 },
        exposure: { value: 1.0 },
        dither: { value: 0.07 },
        outline: { value: 0.45 },
        mode: { value: 0 },
        lift: { value: new THREE.Vector3(0.02, 0.03, 0.07) },
        gain: { value: new THREE.Vector3(1, 1, 1) },
        saturation: { value: 1.05 },
        vignette: { value: 0.35 },
      },
    });
    this.alloc();
  }

  alloc() {
    this.sceneRT?.dispose();
    const depth = new THREE.DepthTexture(this.w, this.h);
    depth.type = THREE.UnsignedIntType;
    this.sceneRT = new THREE.WebGLRenderTarget(this.w, this.h, {
      type: THREE.HalfFloatType,
      minFilter: THREE.NearestFilter,
      magFilter: THREE.NearestFilter,
      depthTexture: depth,
      samples: 0,
    });
  }

  setSize(w, h) {
    if (w === this.w && h === this.h) return;
    this.w = w;
    this.h = h;
    this.alloc();
  }

  render(scene, camera) {
    const r = this.renderer;
    r.setRenderTarget(this.sceneRT);
    r.clear();
    r.render(scene, camera);

    const u = this.post.uniforms;
    u.tColor.value = this.sceneRT.texture;
    u.tDepth.value = this.sceneRT.depthTexture;
    u.res.value.set(this.w, this.h);
    u.near.value = camera.near;
    u.far.value = camera.far;
    // the canvas itself is low-res; CSS upscales it with pixelated sampling
    this.quad.material = this.post;
    r.setRenderTarget(null);
    r.render(this.scene, this.cam);
  }
}
