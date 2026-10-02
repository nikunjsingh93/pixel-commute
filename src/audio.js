// Everything is synthesised with WebAudio: engine hum, tyre roar, rain hiss,
// bumps, and a generative lo-fi "radio" with soft keys, bass and brushed beats.

const CHORDS = [
  // Fmaj9, Em7, Dm9, Cmaj7 (+ a little variation)
  [53, 57, 60, 64, 67], [52, 55, 59, 62, 66], [50, 53, 57, 60, 64], [48, 52, 55, 59, 62],
  [46, 50, 53, 57, 60], [45, 48, 52, 55, 59], [50, 53, 57, 60, 65], [43, 47, 50, 53, 57],
];
const PROGS = [[0, 1, 2, 3], [0, 5, 2, 7], [4, 3, 6, 1], [2, 7, 0, 5]];
const mtof = (m) => 440 * Math.pow(2, (m - 69) / 12);

export class Audio {
  constructor() {
    this.ctx = null;
    this.music = true;
    this.muted = false;
    this.station = 0;
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

    // engine: two detuned saws -> lowpass
    this.eng = ctx.createGain();
    this.eng.gain.value = 0.0;
    this.engLP = ctx.createBiquadFilter();
    this.engLP.type = 'lowpass';
    this.engLP.frequency.value = 300;
    this.engLP.Q.value = 2;
    this.o1 = ctx.createOscillator();
    this.o1.type = 'sawtooth';
    this.o2 = ctx.createOscillator();
    this.o2.type = 'sawtooth';
    this.o2.detune.value = 9;
    this.sub = ctx.createOscillator();
    this.sub.type = 'sine';
    const sg = ctx.createGain();
    sg.gain.value = 0.6;
    this.o1.connect(this.engLP);
    this.o2.connect(this.engLP);
    this.sub.connect(sg).connect(this.engLP);
    this.engLP.connect(this.eng).connect(this.master);
    this.o1.start(); this.o2.start(); this.sub.start();

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

    this.bpm = 74;
    this.step = 0;
    this.nextT = ctx.currentTime + 0.2;
    this.prog = PROGS[0];
    this.timer = setInterval(() => this.schedule(), 50);
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
    this.music = !this.music;
    if (this.musicBus) this.musicBus.gain.setTargetAtTime(this.music ? 0.55 : 0, this.ctx.currentTime, 0.3);
  }
  nextStation() {
    this.station = (this.station + 1) % PROGS.length;
    this.prog = PROGS[this.station];
    this.bpm = [74, 68, 80, 71][this.station];
  }

  update(speed, throttle, rain, scrape, engineRpm = 2000, slip = 0) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    // the engine note follows the simulated rpm
    const rpm = Math.min(1, engineRpm / 6400);
    const f = 22 + engineRpm / 26;
    this.o1.frequency.setTargetAtTime(f, t, 0.08);
    this.o2.frequency.setTargetAtTime(f * 1.003, t, 0.08);
    this.sub.frequency.setTargetAtTime(f / 2, t, 0.08);
    this.engLP.frequency.setTargetAtTime(220 + throttle * 500 + rpm * 300, t, 0.1);
    this.eng.gain.setTargetAtTime(0.05 + throttle * 0.05, t, 0.1);
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

  schedule() {
    const ctx = this.ctx;
    const spb = 60 / this.bpm / 2; // eighth notes
    while (this.nextT < ctx.currentTime + 0.25) {
      const t = this.nextT;
      const st = this.step % 64; // 4 bars of 16 eighths? (8 eighths per bar, 8 bars)
      const bar = Math.floor(st / 8);
      const pos = st % 8;
      const chord = CHORDS[this.prog[Math.floor(bar / 2) % 4]];
      // swing
      const sw = pos % 2 === 1 ? spb * 0.18 : 0;
      if (pos === 0) {
        // soft keys chord, slightly strummed
        chord.forEach((m, i) => this.note(mtof(m), t + i * 0.025, spb * 7, 0.045, 'triangle'));
        this.note(mtof(chord[0] - 12), t, spb * 5, 0.13, 'sine');
      }
      if (pos === 5 && bar % 2 === 1) this.note(mtof(chord[0] - 12 + 7), t + sw, spb * 2, 0.1, 'sine');
      // sparse melody
      if ((pos === 3 || pos === 6) && Math.random() < 0.45) {
        const m = chord[1 + ((Math.random() * 4) | 0)] + 12;
        this.note(mtof(m), t + sw, spb * 3, 0.035, 'sine');
      }
      // drums
      if (pos === 0 || (pos === 5 && Math.random() < 0.6)) this.drum('k', t + sw);
      if (pos === 2 || pos === 6) this.drum('s', t + sw);
      this.drum('h', t + sw);
      this.nextT += spb;
      this.step++;
    }
  }
}
