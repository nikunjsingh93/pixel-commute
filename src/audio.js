// Everything is synthesised with WebAudio: engine hum, tyre roar, rain hiss,
// bumps and chimes. The music (stations, DJ, your own files) lives in radio.js
// and plays through the music bus set up here.

const mtof = (m) => 440 * Math.pow(2, (m - 69) / 12);

export class Audio {
  constructor() {
    this.ctx = null;
    this.music = true;
    this.muted = false;
  }

  start() {
    if (this.ctx) {
      this.ctx.resume();
      return;
    }
    const ctx = (this.ctx = new (window.AudioContext || window.webkitAudioContext)());
    this.master = ctx.createGain();
    this.master.gain.value = 0.8;
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -16;
    this.master.connect(comp).connect(ctx.destination);

    // noise buffer shared by many voices
    const len = ctx.sampleRate * 2;
    this.noise = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = this.noise.getChannelData(0);
    let b = 0;
    for (let i = 0; i < len; i++) {
      const w = Math.random() * 2 - 1;
      b = 0.97 * b + 0.03 * w; // slightly pink
      d[i] = w * 0.5 + b * 2.5;
    }

    // engine: a four-stroke four-cylinder. The base tone is the crank
    // frequency (rpm / 60) with a custom harmonic spectrum: the firing order
    // (2nd harmonic) and its multiples strong, the odd ones weak (the
    // "lumpy" character), rolled off high up. Two copies a hair apart beat
    // like real cylinders. A noise "combustion" layer is pulsed at the firing
    // rate. Throttle opens the lowpass (intake / exhaust bark), and a peak
    // around 120 Hz gives the exhaust body.
    const N = 40;
    const re = new Float32Array(N), im = new Float32Array(N);
    for (let k = 1; k < N; k++) {
      const firing = k % 2 === 0; // multiples of the firing frequency (2x crank)
      const order4 = k % 4 === 0;
      const a = (firing ? 1 : 0.22) * (order4 ? 1.25 : 1) / Math.pow(k, 0.85);
      im[k] = a * (0.7 + 0.3 * Math.sin(k * 1.7)); // varied phases: less buzzy
      re[k] = a * 0.3 * Math.cos(k * 2.3);
    }
    const wave = ctx.createPeriodicWave(re, im, { disableNormalization: false });
    this.eng = ctx.createGain();
    this.eng.gain.value = 0.0;
    this.engLP = ctx.createBiquadFilter();
    this.engLP.type = 'lowpass';
    this.engLP.frequency.value = 400;
    this.engLP.Q.value = 0.6;
    this.engBody = ctx.createBiquadFilter();
    this.engBody.type = 'peaking';
    this.engBody.frequency.value = 120;
    this.engBody.Q.value = 1.1;
    this.engBody.gain.value = 7;
    this.engHP = ctx.createBiquadFilter();
    this.engHP.type = 'highpass';
    this.engHP.frequency.value = 28;
    this.o1 = ctx.createOscillator();
    this.o1.setPeriodicWave(wave);
    this.o2 = ctx.createOscillator();
    this.o2.setPeriodicWave(wave);
    this.o2.detune.value = 6;
    const g1 = ctx.createGain(), g2 = ctx.createGain();
    g1.gain.value = 0.6;
    g2.gain.value = 0.45;
    this.o1.connect(g1).connect(this.engLP);
    this.o2.connect(g2).connect(this.engLP);
    // a low sub at the firing rate
    this.sub = ctx.createOscillator();
    this.sub.type = 'sine';
    const sg = ctx.createGain();
    sg.gain.value = 0.35;
    this.sub.connect(sg).connect(this.engLP);
    // combustion noise, amplitude-modulated at the firing rate
    const nsrc = ctx.createBufferSource();
    nsrc.buffer = this.noise;
    nsrc.loop = true;
    const nbp = ctx.createBiquadFilter();
    nbp.type = 'bandpass';
    nbp.frequency.value = 180;
    nbp.Q.value = 0.8;
    this.combBP = nbp;
    this.comb = ctx.createGain();
    this.comb.gain.value = 0;
    this.pulse = ctx.createOscillator();
    this.pulse.type = 'sine';
    this.pulseDepth = ctx.createGain();
    this.pulseDepth.gain.value = 0;
    this.pulse.connect(this.pulseDepth).connect(this.comb.gain);
    nsrc.connect(nbp).connect(this.comb).connect(this.engLP);
    nsrc.start(0, Math.random());
    this.engLP.connect(this.engBody).connect(this.engHP).connect(this.eng).connect(this.master);
    this.o1.start(); this.o2.start(); this.sub.start(); this.pulse.start();

    // tyre / wind roar
    this.roar = this.loopNoise('lowpass', 500, 0);
    // rain hiss
    this.rainN = this.loopNoise('highpass', 1800, 0);
    // scrape
    this.scrapeN = this.loopNoise('bandpass', 2600, 0);
    this.squeal = this.loopNoise('bandpass', 1000, 0);
    this.squeal.f.Q.value = 9;

    // music bus with a gentle lowpass "radio" tone + vinyl crackle
    this.musicBus = ctx.createGain();
    this.musicBus.gain.value = this.music ? 0.55 : 0;
    const tone = ctx.createBiquadFilter();
    tone.type = 'lowpass';
    tone.frequency.value = 3800;
    this.musicBus.connect(tone).connect(this.master);
    this.delay = ctx.createDelay(1);
    this.delay.delayTime.value = 0.36;
    const fb = ctx.createGain();
    fb.gain.value = 0.28;
    const dl = ctx.createGain();
    dl.gain.value = 0.25;
    this.delay.connect(fb).connect(this.delay);
    this.delay.connect(dl).connect(this.musicBus);
    this.crackle = this.loopNoise('highpass', 3000, 0, this.musicBus);

  }

  loopNoise(type, freq, gain, dest = this.master) {
    const ctx = this.ctx;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    src.loop = true;
    const f = ctx.createBiquadFilter();
    f.type = type;
    f.frequency.value = freq;
    const g = ctx.createGain();
    g.gain.value = gain;
    src.connect(f).connect(g).connect(dest);
    src.start(0, Math.random() * 1.5);
    return { g, f };
  }

  setMuted(m) {
    this.muted = m;
    if (this.master) this.master.gain.setTargetAtTime(m ? 0 : 0.8, this.ctx.currentTime, 0.1);
  }
  toggleMusic() {
    this.music = !this.music; // the radio applies the gains
  }

  update(speed, throttle, rain, scrape, engineRpm = 2000, slip = 0) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    // the engine follows the simulated rpm and the throttle
    const rpm = Math.max(600, engineRpm);
    const crank = rpm / 60, firing = crank * 2;
    const x = Math.min(1, rpm / 6800);
    this.o1.frequency.setTargetAtTime(crank, t, 0.05);
    this.o2.frequency.setTargetAtTime(crank * 1.004, t, 0.05);
    this.sub.frequency.setTargetAtTime(firing, t, 0.05);
    this.pulse.frequency.setTargetAtTime(firing, t, 0.05);
    // closed throttle: muffled; open: the exhaust opens up and gets louder
    this.engLP.frequency.setTargetAtTime(260 + throttle * 900 + x * 700, t, 0.08);
    this.engBody.frequency.setTargetAtTime(95 + x * 90, t, 0.1);
    this.combBP.frequency.setTargetAtTime(120 + firing * 1.5, t, 0.08);
    const load = 0.25 + throttle * 0.75;
    this.comb.gain.setTargetAtTime(0.05 * load, t, 0.08);
    this.pulseDepth.gain.setTargetAtTime(0.05 * load, t, 0.08);
    this.eng.gain.setTargetAtTime(0.11 + throttle * 0.08 + x * 0.04, t, 0.08);
    this.roar.g.gain.setTargetAtTime(Math.min(0.12, speed * 0.0028), t, 0.2);
    this.roar.f.frequency.setTargetAtTime(300 + speed * 18, t, 0.2);
    this.rainN.g.gain.setTargetAtTime(rain * 0.05, t, 0.5);
    this.scrapeN.g.gain.setTargetAtTime(scrape * 0.12, t, 0.05);
    // tyre squeal when the tyres slide
    const sq = Math.max(0, Math.min(1, (slip - 0.18) * 3)) * Math.min(1, speed / 6);
    this.squeal.g.gain.setTargetAtTime(sq * 0.05, t, 0.05);
    this.squeal.f.frequency.setTargetAtTime(900 + sq * 500, t, 0.1);
    this.crackle.g.gain.value = 0.004 + (Math.random() < 0.02 ? 0.04 : 0);
  }

  // camera shutter for photo mode
  shutter() {
    if (!this.ctx) return;
    const ctx = this.ctx, t = ctx.currentTime;
    for (const [dt, f] of [[0, 2400], [0.07, 1600]]) {
      const n = ctx.createBufferSource();
      n.buffer = this.noise;
      const bp = ctx.createBiquadFilter();
      bp.type = 'bandpass';
      bp.frequency.value = f;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.25, t + dt);
      g.gain.exponentialRampToValueAtTime(0.001, t + dt + 0.05);
      n.connect(bp).connect(g).connect(this.master);
      n.start(t + dt, Math.random());
      n.stop(t + dt + 0.06);
    }
  }

  thump(power) {
    if (!this.ctx) return;
    const ctx = this.ctx, t = ctx.currentTime;
    const o = ctx.createOscillator();
    o.type = 'sine';
    o.frequency.setValueAtTime(120, t);
    o.frequency.exponentialRampToValueAtTime(40, t + 0.25);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.5 * power + 0.15, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.35);
    o.connect(g).connect(this.master);
    o.start(t);
    o.stop(t + 0.4);
    const n = ctx.createBufferSource();
    n.buffer = this.noise;
    const nf = ctx.createBiquadFilter();
    nf.type = 'bandpass';
    nf.frequency.value = 900;
    const ng = ctx.createGain();
    ng.gain.setValueAtTime(0.35 * power + 0.1, t);
    ng.gain.exponentialRampToValueAtTime(0.001, t + 0.2);
    n.connect(nf).connect(ng).connect(this.master);
    n.start(t, Math.random());
    n.stop(t + 0.25);
  }

  chime(n = 0) {
    if (!this.ctx) return;
    const ctx = this.ctx, t = ctx.currentTime;
    [76, 79, 83, 88].slice(0, 2 + Math.min(2, n)).forEach((m, i) => {
      this.note(mtof(m + 0), t + i * 0.07, 0.6, 0.08, 'triangle', this.master);
    });
  }

  note(freq, t, dur, vol, type = 'sine', dest = this.musicBus) {
    const ctx = this.ctx;
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.value = freq;
    const o2 = ctx.createOscillator();
    o2.type = 'sine';
    o2.frequency.value = freq * 2.001;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(vol, t + 0.015);
    g.gain.exponentialRampToValueAtTime(vol * 0.4, t + dur * 0.3);
    g.gain.exponentialRampToValueAtTime(0.0008, t + dur);
    const g2 = ctx.createGain();
    g2.gain.value = 0.18;
    o.connect(g);
    o2.connect(g2).connect(g);
    g.connect(dest);
    if (dest === this.musicBus) g.connect(this.delay);
    o.start(t); o2.start(t);
    o.stop(t + dur + 0.05); o2.stop(t + dur + 0.05);
  }

  drum(kind, t) {
    const ctx = this.ctx;
    if (kind === 'k') {
      const o = ctx.createOscillator();
      o.frequency.setValueAtTime(110, t);
      o.frequency.exponentialRampToValueAtTime(42, t + 0.12);
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.5, t);
      g.gain.exponentialRampToValueAtTime(0.001, t + 0.3);
      o.connect(g).connect(this.musicBus);
      o.start(t);
      o.stop(t + 0.32);
      return;
    }
    const n = ctx.createBufferSource();
    n.buffer = this.noise;
    const f = ctx.createBiquadFilter();
    f.type = kind === 's' ? 'bandpass' : 'highpass';
    f.frequency.value = kind === 's' ? 1800 : 7000;
    const g = ctx.createGain();
    const v = kind === 's' ? 0.22 : 0.05 + Math.random() * 0.03;
    const dur = kind === 's' ? 0.18 : 0.05;
    g.gain.setValueAtTime(v, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    n.connect(f).connect(g).connect(this.musicBus);
    n.start(t, Math.random() * 1.5);
    n.stop(t + dur + 0.02);
  }


}
