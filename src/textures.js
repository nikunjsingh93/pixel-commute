// Small hand-made canvas textures. Everything is drawn at "pixel art"
// resolution and sampled nearest so texels stay crisp after the palette pass.
import * as THREE from 'three';
import { hash } from './path.js';

function canvas(w, h) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return [c, c.getContext('2d')];
}

function tex(c, { repeat = true, nearest = true, srgb = true } = {}) {
  const t = new THREE.CanvasTexture(c);
  if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.magFilter = THREE.NearestFilter;
  t.minFilter = nearest ? THREE.NearestMipmapLinearFilter : THREE.LinearMipmapLinearFilter;
  t.anisotropy = 4;
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

let seedN = 1;
function rnd() {
  seedN++;
  return hash(seedN * 0.731);
}

// Carriageway: u across (0 = left edge, 1 = right edge), v along (one tile =
// 12 m). Yellow solid line on the left edge, dashed white lane lines.
// `layout` = [{u0,u1} lanes...], given in metres via width.
export function roadTexture(widthM, lanes, laneW, leftShoulder) {
  const PPM = 8; // pixels per metre across
  const W = Math.ceil(widthM * PPM);
  const H = 96; // 12 m along at 8 px/m
  const [c, g] = canvas(W, H);
  // asphalt with speckle
  g.fillStyle = '#4a4c52';
  g.fillRect(0, 0, W, H);
  for (let i = 0; i < W * H * 0.22; i++) {
    const x = (rnd() * W) | 0;
    const y = (rnd() * H) | 0;
    const v = rnd();
    g.fillStyle = v < 0.5 ? '#43454b' : v < 0.85 ? '#52545a' : '#5c5d62';
    g.fillRect(x, y, 1, 1);
  }
  // wheel tracks (slightly darker, polished)
  for (let l = 0; l < lanes; l++) {
    const cx = (leftShoulder + laneW * (l + 0.5)) * PPM;
    g.fillStyle = 'rgba(30,30,36,0.28)';
    g.fillRect(cx - 0.95 * PPM, 0, 0.45 * PPM, H);
    g.fillRect(cx + 0.5 * PPM, 0, 0.45 * PPM, H);
  }
  // patches
  for (let i = 0; i < 3; i++) {
    g.fillStyle = rnd() < 0.5 ? 'rgba(20,20,26,0.35)' : 'rgba(110,110,120,0.18)';
    g.fillRect(rnd() * W, rnd() * H, 4 + rnd() * 18, 4 + rnd() * 26);
  }
  // left yellow line
  const yl = leftShoulder * PPM;
  g.fillStyle = '#d9b53f';
  g.fillRect(yl - 1, 0, 2, H);
  // dashed lanes: 3 m dash, 9 m gap
  g.fillStyle = '#e9e6dc';
  for (let l = 1; l < lanes; l++) {
    const x = (leftShoulder + laneW * l) * PPM;
    g.fillRect(x - 1, 0, 2, 3 * PPM);
  }
  // right edge solid white
  const xr = (leftShoulder + laneW * lanes) * PPM;
  g.fillRect(xr - 1, 0, 2, H);
  return tex(c);
}

// roughness map to fake puddles on the wet road (white = rough)
export function puddleTexture() {
  const W = 64, H = 64;
  const [c, g] = canvas(W, H);
  g.fillStyle = '#9a9a9a';
  g.fillRect(0, 0, W, H);
  for (let i = 0; i < 18; i++) {
    const r = 2 + rnd() * 7;
    g.fillStyle = `rgba(20,20,20,${0.35 + rnd() * 0.5})`;
    g.beginPath();
    g.ellipse(rnd() * W, rnd() * H, r * 1.6, r, 0, 0, Math.PI * 2);
    g.fill();
  }
  const t = tex(c, { srgb: false, nearest: false });
  return t;
}

// Concrete with horizontal formwork lines and dithered grime.
export function concreteTexture(base = '#8c7d68', lines = true) {
  const W = 64, H = 64;
  const [c, g] = canvas(W, H);
  g.fillStyle = base;
  g.fillRect(0, 0, W, H);
  for (let i = 0; i < W * H * 0.3; i++) {
    const v = rnd();
    g.fillStyle = v < 0.5 ? 'rgba(0,0,0,0.10)' : 'rgba(255,255,255,0.06)';
    g.fillRect((rnd() * W) | 0, (rnd() * H) | 0, 1, 1);
  }
  if (lines) {
    g.fillStyle = 'rgba(0,0,0,0.18)';
    for (let y = 0; y < H; y += 16) g.fillRect(0, y, W, 1);
    g.fillStyle = 'rgba(0,0,0,0.10)';
    for (let x = 0; x < W; x += 32) g.fillRect(x, 0, 1, H);
  }
  // water streaks
  for (let i = 0; i < 6; i++) {
    g.fillStyle = 'rgba(30,25,20,0.16)';
    g.fillRect((rnd() * W) | 0, 0, 1 + (rnd() * 2) | 0, H * (0.3 + rnd() * 0.7));
  }
  return tex(c);
}

// Building facades. RGB = wall colour, emissive map separate (lit windows).
export function facadeTextures() {
  const W = 128, H = 128; // 16 x 16 window cells of 8 px
  const [c, g] = canvas(W, H);
  const [ce, ge] = canvas(W, H);
  g.fillStyle = '#8a8f9a';
  g.fillRect(0, 0, W, H);
  ge.fillStyle = '#000';
  ge.fillRect(0, 0, W, H);
  for (let i = 0; i < W * H * 0.2; i++) {
    g.fillStyle = rnd() < 0.5 ? 'rgba(0,0,0,0.08)' : 'rgba(255,255,255,0.06)';
    g.fillRect((rnd() * W) | 0, (rnd() * H) | 0, 1, 1);
  }
  for (let cy = 0; cy < 16; cy++) {
    for (let cx = 0; cx < 16; cx++) {
      const x = cx * 8 + 2, y = cy * 8 + 2;
      g.fillStyle = '#2b3242';
      g.fillRect(x, y, 5, 4);
      const r = rnd();
      if (r < 0.34) {
        const warm = rnd();
        const col = warm < 0.6 ? '#ffcf7a' : warm < 0.85 ? '#ffe9b8' : '#9fd0ff';
        ge.fillStyle = col;
        ge.fillRect(x, y, 5, 4);
        if (rnd() < 0.5) {
          ge.fillStyle = 'rgba(0,0,0,0.45)';
          ge.fillRect(x + ((rnd() * 4) | 0), y, 2, 4);
        }
      }
    }
  }
  return { map: tex(c), emissive: tex(ce) };
}

// Far skyline band (wraps around the horizon). R = building, G = window.
export function skylineTexture() {
  const W = 1024, H = 128;
  const [c, g] = canvas(W, H);
  g.clearRect(0, 0, W, H);
  const layer = (yBase, minH, maxH, col, winCol, density) => {
    let x = 0;
    while (x < W) {
      const bw = 8 + ((rnd() * 26) | 0);
      const bh = minH + rnd() * (maxH - minH);
      const top = H - yBase - bh;
      g.fillStyle = col;
      g.fillRect(x, top, bw, bh + yBase);
      if (rnd() < 0.3) g.fillRect(x + bw / 2 - 1, top - 6 - rnd() * 10, 2, 16); // antenna
      if (rnd() < 0.25) g.fillRect(x + 2, top - 4, bw - 4, 4); // setback
      for (let wy = top + 3; wy < H - 4; wy += 4) {
        for (let wx = x + 2; wx < x + bw - 2; wx += 3) {
          if (rnd() < density) {
            g.fillStyle = winCol;
            g.fillRect(wx, wy, 1, 1);
          }
        }
      }
      x += bw + ((rnd() * 6) | 0);
    }
  };
  layer(0, 20, 70, 'rgb(150,0,255)', 'rgb(150,255,255)', 0.12); // far layer: B=1
  layer(0, 8, 40, 'rgb(255,0,0)', 'rgb(255,255,0)', 0.2); // near layer
  const t = tex(c, { srgb: false });
  t.wrapT = THREE.ClampToEdgeWrapping;
  t.minFilter = THREE.NearestFilter;
  t.generateMipmaps = false;
  return t;
}

export function moonTexture() {
  const S = 32;
  const [c, g] = canvas(S, S);
  g.clearRect(0, 0, S, S);
  g.fillStyle = '#dfe6f0';
  g.beginPath();
  g.arc(S / 2, S / 2, S / 2 - 1, 0, Math.PI * 2);
  g.fill();
  g.fillStyle = 'rgba(120,135,160,0.55)';
  const craters = [[11, 10, 4], [20, 17, 5], [13, 21, 3], [22, 9, 2], [9, 16, 2]];
  for (const [x, y, r] of craters) {
    g.beginPath();
    g.arc(x, y, r, 0, Math.PI * 2);
    g.fill();
  }
  const t = tex(c, { repeat: false });
  t.minFilter = THREE.NearestFilter;
  t.generateMipmaps = false;
  return t;
}

// Green motorway sign with a chunky 3x5 pixel font
export function signTexture(lines, font) {
  const W = 64, H = 32;
  const [c, g] = canvas(W, H);
  g.fillStyle = '#e8e8e0';
  g.fillRect(0, 0, W, H);
  g.fillStyle = '#1f6a4a';
  g.fillRect(1, 1, W - 2, H - 2);
  g.fillStyle = '#e8e8e0';
  lines.forEach((ln, i) => {
    const sc = i === 0 ? 2 : 1;
    const w = font.measure(ln) * sc;
    font.draw(g, ln, ((W - w) / 2) | 0, 4 + i * 14, sc, '#e8e8e0');
  });
  const t = tex(c, { repeat: false });
  t.minFilter = THREE.NearestFilter;
  t.generateMipmaps = false;
  return t;
}

// Ground-floor shopfronts: 4 shop units per texture (each 32 px = 8 m).
// map = frontage colours, emissive = lit windows + sign bands.
export function shopTextures() {
  const W = 128, H = 32;
  const [c, g] = canvas(W, H);
  const [ce, ge] = canvas(W, H);
  ge.fillStyle = '#000';
  ge.fillRect(0, 0, W, H);
  const signs = ['#e0362a', '#2f9a8a', '#f0c040', '#7a5ab8', '#e8762a', '#3a78c8'];
  const glass = ['#ffd890', '#ffe9c0', '#bfe4ff', '#ffc070'];
  for (let u = 0; u < 4; u++) {
    const x = u * 32;
    g.fillStyle = rnd() < 0.5 ? '#5a5650' : '#4a4e58';
    g.fillRect(x, 0, 32, H);
    // sign band
    const sc = signs[(rnd() * signs.length) | 0];
    g.fillStyle = '#22242a';
    g.fillRect(x + 1, 2, 30, 6);
    ge.fillStyle = sc;
    for (let k = 0; k < 6; k++) ge.fillRect(x + 4 + k * 4, 4, 2 + ((rnd() * 2) | 0), 2);
    // awning
    g.fillStyle = sc;
    g.fillRect(x + 1, 9, 30, 2);
    // shop window + door
    const lit = rnd() < 0.85;
    g.fillStyle = '#1d2230';
    g.fillRect(x + 2, 12, 20, 16);
    g.fillRect(x + 24, 14, 6, 14);
    if (lit) {
      ge.fillStyle = glass[(rnd() * glass.length) | 0];
      ge.fillRect(x + 2, 12, 20, 16);
      ge.fillStyle = 'rgba(0,0,0,0.55)';
      for (let k = 0; k < 4; k++) ge.fillRect(x + 3 + ((rnd() * 17) | 0), 18 + ((rnd() * 8) | 0), 2, 10); // people / shelves
      ge.fillRect(x + 12, 12, 1, 16); // mullion
      ge.fillStyle = 'rgba(255,220,160,0.6)';
      ge.fillRect(x + 25, 15, 4, 12);
    }
  }
  return { map: tex(c), emissive: tex(ce) };
}

// Billboard faces: bright pixel slogans on dark panels (emissive)
export function billboardTexture(lines, bg, fg, font) {
  const W = 64, H = 24;
  const [c, g] = canvas(W, H);
  g.fillStyle = bg;
  g.fillRect(0, 0, W, H);
  g.fillStyle = 'rgba(255,255,255,0.25)';
  g.fillRect(0, 0, W, 1);
  g.fillRect(0, H - 1, W, 1);
  lines.forEach((ln, i) => {
    const sc = i === 0 ? 2 : 1;
    const w = font.measure(ln) * sc;
    font.draw(g, ln, ((W - w) / 2) | 0, i === 0 ? 3 : 16, sc, i === 0 ? fg : '#f4f1e8');
  });
  const t = tex(c, { repeat: false });
  t.minFilter = THREE.NearestFilter;
  t.generateMipmaps = false;
  return t;
}

// City street / ramp asphalt: u across (0..1), v along (one tile = 8 m).
// White edge lines; two-way streets get a double yellow centre line.
export function streetTexture(twoWay) {
  const W = 64, H = 64;
  const [c, g] = canvas(W, H);
  g.fillStyle = '#45474d';
  g.fillRect(0, 0, W, H);
  for (let i = 0; i < W * H * 0.25; i++) {
    const v = rnd();
    g.fillStyle = v < 0.5 ? '#3f4147' : v < 0.85 ? '#4c4e54' : '#56585d';
    g.fillRect((rnd() * W) | 0, (rnd() * H) | 0, 1, 1);
  }
  for (let i = 0; i < 4; i++) {
    g.fillStyle = 'rgba(20,20,26,0.3)';
    g.fillRect(rnd() * W, rnd() * H, 3 + rnd() * 8, 3 + rnd() * 10);
  }
  g.fillStyle = '#d8d4c8';
  g.fillRect(2, 0, 1, H);
  g.fillRect(W - 3, 0, 1, H);
  if (twoWay) {
    g.fillStyle = '#d9b53f';
    g.fillRect(W / 2 - 2, 0, 1, H);
    g.fillRect(W / 2 + 1, 0, 1, H);
  }
  return tex(c);
}

// Tunnel wall tiles: cream ceramic grid with a dark kick strip at the bottom
export function tileTexture() {
  const W = 64, H = 64;
  const [c, g] = canvas(W, H);
  g.fillStyle = '#c9c0a8';
  g.fillRect(0, 0, W, H);
  for (let i = 0; i < W * H * 0.15; i++) {
    g.fillStyle = rnd() < 0.5 ? 'rgba(0,0,0,0.06)' : 'rgba(255,255,255,0.05)';
    g.fillRect((rnd() * W) | 0, (rnd() * H) | 0, 1, 1);
  }
  g.fillStyle = 'rgba(60,50,40,0.35)';
  for (let y = 0; y < H; y += 8) g.fillRect(0, y, W, 1);
  for (let x = 0; x < W; x += 8) g.fillRect(x, 0, 1, H);
  // grime toward the bottom (v = 0 is the floor)
  for (let y = H - 16; y < H; y++) {
    g.fillStyle = `rgba(40,34,28,${((y - (H - 16)) / 16) * 0.55})`;
    g.fillRect(0, y, W, 1);
  }
  return tex(c);
}

// Suburban house fronts: 4 colour bands (one per house style), two floors
// of windows per band. map + emissive (lit windows).
export function houseTextures() {
  const W = 128, H = 128;
  const [c, g] = canvas(W, H);
  const [ce, ge] = canvas(W, H);
  ge.fillStyle = '#000';
  ge.fillRect(0, 0, W, H);
  const sidings = ['#c9bfa7', '#8a9bb0', '#a35a46', '#7f9479'];
  sidings.forEach((col, b) => {
    const y0 = b * 32;
    g.fillStyle = col;
    g.fillRect(0, y0, W, 32);
    g.fillStyle = 'rgba(0,0,0,0.12)';
    for (let y = y0 + 2; y < y0 + 32; y += 3) g.fillRect(0, y, W, 1); // siding lines
    for (let x = 4; x < W; x += 16) {
      for (const wy of [y0 + 4, y0 + 19]) {
        g.fillStyle = '#e8e4da';
        g.fillRect(x - 1, wy - 1, 8, 9);
        g.fillStyle = '#26303f';
        g.fillRect(x, wy, 6, 7);
        if (rnd() < 0.45) {
          ge.fillStyle = rnd() < 0.7 ? '#ffd08a' : '#ffe9c0';
          ge.fillRect(x, wy, 6, 7);
          ge.fillStyle = 'rgba(0,0,0,0.5)';
          ge.fillRect(x + 3, wy, 1, 7);
        }
      }
    }
    // a front door every other house width
    g.fillStyle = '#4a2f22';
    g.fillRect(60, y0 + 21, 6, 11);
  });
  return { map: tex(c), emissive: tex(ce) };
}

// Amber flashing arrow board for roadworks (points left: merge left)
export function arrowBoardTexture() {
  const W = 32, H = 16;
  const [c, g] = canvas(W, H);
  g.fillStyle = '#0c0d10';
  g.fillRect(0, 0, W, H);
  g.fillStyle = '#ffb02a';
  const px = [
    '................................',
    '..........#.....................',
    '.........##.....................',
    '........###.....................',
    '.......####################.....',
    '......#####################.....',
    '.....######################.....',
    '......#####################.....',
    '.......####################.....',
    '........###.....................',
    '.........##.....................',
    '..........#.....................',
  ];
  px.forEach((row, y) => [...row].forEach((ch, x) => ch === '#' && g.fillRect(x, y + 2, 1, 1)));
  const t = tex(c, { repeat: false });
  t.minFilter = THREE.NearestFilter;
  t.generateMipmaps = false;
  return t;
}

// Simple road sign faces: yellow diamond-ish (works) or green (toll / exits)
export function roadSignTexture(lines, bg, fg, font) {
  const W = 64, H = 32;
  const [c, g] = canvas(W, H);
  g.fillStyle = fg;
  g.fillRect(0, 0, W, H);
  g.fillStyle = bg;
  g.fillRect(2, 2, W - 4, H - 4);
  lines.forEach((ln, i) => {
    const sc = lines.length === 1 ? 2 : 1;
    const w = font.measure(ln) * sc;
    const y = lines.length === 1 ? 11 : 6 + i * 8;
    font.draw(g, ln, ((W - w) / 2) | 0, y, sc, fg);
  });
  const t = tex(c, { repeat: false });
  t.minFilter = THREE.NearestFilter;
  t.generateMipmaps = false;
  return t;
}

export function groundTexture(base) {
  const W = 64, H = 64;
  const [c, g] = canvas(W, H);
  g.fillStyle = base;
  g.fillRect(0, 0, W, H);
  for (let i = 0; i < W * H * 0.35; i++) {
    g.fillStyle = rnd() < 0.5 ? 'rgba(0,0,0,0.12)' : 'rgba(255,255,255,0.07)';
    g.fillRect((rnd() * W) | 0, (rnd() * H) | 0, 1, 1);
  }
  return tex(c);
}
