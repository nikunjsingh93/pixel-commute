// The car radio: four generated stations with their own style, a station
// jingle when you tune in (and now and then between songs), and "My Music":
// your own audio files, kept in IndexedDB so they survive a reload.
const mtof = (m) => 440 * Math.pow(2, (m - 69) / 12);

export const STATIONS = [
  { id: 'pixel', name: 'PIXEL FM', freq: '88.1', style: 'lofi', bpm: 74 },
  { id: 'night', name: 'NIGHT DRIVE', freq: '91.4', style: 'synth', bpm: 100 },
  { id: 'smooth', name: 'SMOOTH AM', freq: '640', style: 'jazz', bpm: 116 },
  { id: 'chill', name: 'CHILL', freq: '101.9', style: 'ambient', bpm: 60 },
  { id: 'mine', name: 'MY MUSIC', freq: '', style: 'files' },
];

// ---------------------------------------------------------------- my music storage
const DB = 'pixel-commute';
function db() {
  return new Promise((res, rej) => {
    const r = indexedDB.open(DB, 1);
    r.onupgradeneeded = () => r.result.createObjectStore('tracks', { keyPath: 'id', autoIncrement: true });
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
}
async function dbAll() {
  const d = await db();
  return new Promise((res, rej) => {
    const q = d.transaction('tracks').objectStore('tracks').getAll();
    q.onsuccess = () => res(q.result);
    q.onerror = () => rej(q.error);
  });
}
async function dbPut(rec) {
  const d = await db();
  return new Promise((res, rej) => {
    const q = d.transaction('tracks', 'readwrite').objectStore('tracks').add(rec);
    q.onsuccess = () => res(q.result);
    q.onerror = () => rej(q.error);
  });
}
async function dbDel(id) {
  const d = await db();
  return new Promise((res) => {
    const q = d.transaction('tracks', 'readwrite').objectStore('tracks').delete(id);
    q.onsuccess = q.onerror = () => res();
  });
}

export class Radio {
  constructor(audio) {
    this.a = audio;
    this.index = 0;
    this.dj = true;
    this.tracks = [];
    this.trackIdx = 0;
    this.nowPlaying = '';
    this.nextTalk = 140;
    this.t = 0;
    try {
      const p = JSON.parse(localStorage.getItem('pixel-commute.radio') || '{}');
      if (typeof p.index === 'number') this.index = Math.min(p.index, STATIONS.length - 1);
      if (typeof p.dj === 'boolean') this.dj = p.dj;
    } catch (e) { /* defaults */ }
    if (window.indexedDB) dbAll().then((t) => { this.tracks = t; }).catch(() => {});
  }

  get station() {
    return STATIONS[this.index];
  }
  label() {
    const s = this.station;
    return s.style === 'files' ? (this.nowPlaying ? `MY MUSIC  ${this.nowPlaying}` : 'MY MUSIC') : `${s.name} ${s.freq}`;
  }
  short() {
    const s = this.station;
    return s.style === 'files' ? 'MINE' : s.freq;
  }
  save() {
    try { localStorage.setItem('pixel-commute.radio', JSON.stringify({ index: this.index, dj: this.dj })); } catch (e) { /* ignore */ }
  }

  // called once the AudioContext exists
  start() {
    if (this.started) return;
    this.started = true;
    const a = this.a, ctx = a.ctx;
    this.step = 0;
    this.nextT = ctx.currentTime + 0.3;
    // own music goes straight to the speakers (no radio filter), same on/off
    this.el = new window.Audio();
    this.el.addEventListener('ended', () => this.nextTrack());
    this.fileGain = ctx.createGain();
    this.fileGain.gain.value = 0;
    try {
      ctx.createMediaElementSource(this.el).connect(this.fileGain).connect(a.master);
    } catch (e) { /* older browsers: plays directly */ }
    // a short reverb-ish wash for the ambient station
    this.wash = ctx.createDelay(1.5);
    this.wash.delayTime.value = 0.62;
    const fb = ctx.createGain();
    fb.gain.value = 0.45;
    const wet = ctx.createGain();
    wet.gain.value = 0.35;
    this.wash.connect(fb).connect(this.wash);
    this.wash.connect(wet).connect(a.musicBus);
    this.timer = setInterval(() => this.schedule(), 50);
    this.tune(this.index, true);
  }

  on() {
    return this.a.music;
  }

  // ---------------------------------------------------------------- tuning
  tune(i, quiet = false) {
    this.index = (i + STATIONS.length) % STATIONS.length;
    this.save();
    this.step = 0;
    if (this.a.ctx) this.nextT = this.a.ctx.currentTime + 1.4; // leave room for the jingle
    const files = this.station.style === 'files';
    if (files) this.playTrack(this.trackIdx);
    else if (this.el) this.el.pause();
    this.applyGains();
    if (!quiet && this.a.music) this.ident();
  }
  next() {
    this.tune(this.index + 1);
  }

  applyGains() {
    if (!this.a.ctx) return;
    const t = this.a.ctx.currentTime;
    const files = this.station.style === 'files';
    const on = this.a.music;
    this.a.musicBus.gain.setTargetAtTime(on && !files ? 0.55 : 0, t, 0.25);
    this.fileGain.gain.setTargetAtTime(on && files ? 0.75 : 0, t, 0.25);
    if (files && on && this.el && this.el.paused && this.el.src) this.el.play().catch(() => {});
    if ((!on || !files) && this.el && !this.el.paused) this.el.pause();
  }

  // ---------------------------------------------------------------- jingle
  jingle() {
    const a = this.a;
    if (!a.ctx) return;
    const t = a.ctx.currentTime + 0.05;
    const base = [72, 76, 79, 84];
    base.forEach((m, k) => this.tone(mtof(m), t + k * 0.11, { dur: 0.9, vol: 0.07, type: 'triangle', dest: a.master }));
    [60, 64, 67, 71].forEach((m) => this.tone(mtof(m), t + 0.45, { dur: 1.2, vol: 0.035, type: 'sine', dest: a.master }));
  }

  ident() {
    this.jingle();
  }

  update(dt) {
    if (!this.started) return;
    this.t += dt;
    if (this.dj && this.a.music && this.t > this.nextTalk) {
      this.nextTalk = this.t + 160 + Math.random() * 120;
      this.jingle();
    }
  }

  // ---------------------------------------------------------------- my music
  async addFiles(files) {
    for (const f of files) {
      if (!/^audio\//.test(f.type) && !/\.(mp3|m4a|aac|ogg|oga|wav|flac|opus|webm)$/i.test(f.name)) continue;
      const rec = { name: f.name.replace(/\.[^.]+$/, ''), blob: f };
      try {
        rec.id = await dbPut(rec);
      } catch (e) {
        rec.id = 'mem' + Math.random(); // storage full / private mode: keep for this session
      }
      this.tracks.push(rec);
    }
  }
  async removeTrack(id) {
    this.tracks = this.tracks.filter((t) => t.id !== id);
    if (typeof id === 'number') await dbDel(id);
    if (this.station.style === 'files') this.playTrack(this.trackIdx);
  }
  playTrack(i) {
    if (!this.el) return;
    if (!this.tracks.length) {
      this.el.pause();
      this.nowPlaying = '';
      return;
    }
    this.trackIdx = ((i % this.tracks.length) + this.tracks.length) % this.tracks.length;
    const tr = this.tracks[this.trackIdx];
    if (this.url) URL.revokeObjectURL(this.url);
    this.url = URL.createObjectURL(tr.blob);
    this.el.src = this.url;
    this.nowPlaying = tr.name.toUpperCase().slice(0, 24);
    if (this.a.music) this.el.play().catch(() => {});
  }
  nextTrack() {
    if (this.station.style === 'files') this.playTrack(this.trackIdx + 1);
  }

  // ---------------------------------------------------------------- synthesis
  // a voice with its own envelope (+ optional lowpass)
  tone(freq, t, o = {}) {
    const a = this.a, ctx = a.ctx;
    const dur = o.dur ?? 1, vol = o.vol ?? 0.05, att = o.attack ?? 0.015;
    const osc = ctx.createOscillator();
    osc.type = o.type || 'sine';
    osc.frequency.value = freq;
    if (o.detune) osc.detune.value = o.detune;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(vol, t + att);
    if (o.sustain) g.gain.setValueAtTime(vol, t + Math.max(att, dur - (o.release ?? 0.3)));
    g.gain.exponentialRampToValueAtTime(0.0008, t + dur);
    let node = osc;
    if (o.cutoff) {
      const f = ctx.createBiquadFilter();
      f.type = 'lowpass';
      f.frequency.value = o.cutoff;
      f.Q.value = o.q ?? 1;
      osc.connect(f);
      node = f;
    }
    node.connect(g);
    g.connect(o.dest || a.musicBus);
    if (o.wash) g.connect(this.wash);
    if (o.echo) g.connect(a.delay);
    osc.start(t);
    osc.stop(t + dur + 0.05);
  }

  noiseHit(t, o) {
    const a = this.a, ctx = a.ctx;
    const n = ctx.createBufferSource();
    n.buffer = a.noise;
    const f = ctx.createBiquadFilter();
    f.type = o.type || 'highpass';
    f.frequency.value = o.freq || 7000;
    const g = ctx.createGain();
    g.gain.setValueAtTime(o.vol, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + o.dur);
    n.connect(f).connect(g).connect(a.musicBus);
    n.start(t, Math.random() * 1.5);
    n.stop(t + o.dur + 0.02);
  }

  kick(t, vol = 0.5) {
    const ctx = this.a.ctx;
    const o = ctx.createOscillator();
    o.frequency.setValueAtTime(115, t);
    o.frequency.exponentialRampToValueAtTime(42, t + 0.12);
    const g = ctx.createGain();
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.3);
    o.connect(g).connect(this.a.musicBus);
    o.start(t);
    o.stop(t + 0.32);
  }

  schedule() {
    const a = this.a;
    if (!a.ctx || this.station.style === 'files') return;
    const st = this.station;
    const ctx = a.ctx;
    // when muted keep the clock moving but play nothing
    while (this.nextT < ctx.currentTime + 0.25) {
      const t = this.nextT;
      if (a.music) this[st.style](t, this.step);
      const sub = st.style === 'synth' ? 4 : st.style === 'ambient' ? 1 : 2;
      this.nextT += 60 / st.bpm / sub;
      this.step++;
    }
  }

  // ---- Pixel FM: lo-fi keys, round bass, brushed beat (eighth-note grid)
  lofi(t, step) {
    const CH = [[53, 57, 60, 64, 67], [52, 55, 59, 62, 66], [50, 53, 57, 60, 64], [48, 52, 55, 59, 62],
      [46, 50, 53, 57, 60], [45, 48, 52, 55, 59], [50, 53, 57, 60, 65], [43, 47, 50, 53, 57]];
    const PR = [[0, 1, 2, 3], [0, 5, 2, 7], [4, 3, 6, 1], [2, 7, 0, 5]];
    const spb = 60 / 74 / 2;
    const s = step % 64, bar = Math.floor(s / 8), pos = s % 8;
    const prog = PR[Math.floor(step / 64) % PR.length];
    const chord = CH[prog[Math.floor(bar / 2) % 4]];
    const sw = pos % 2 === 1 ? spb * 0.18 : 0;
    if (pos === 0) {
      chord.forEach((m, i) => this.tone(mtof(m), t + i * 0.025, { dur: spb * 7, vol: 0.045, type: 'triangle', echo: 1 }));
      this.tone(mtof(chord[0] - 12), t, { dur: spb * 5, vol: 0.13 });
    }
    if (pos === 5 && bar % 2 === 1) this.tone(mtof(chord[0] - 5), t + sw, { dur: spb * 2, vol: 0.1 });
    if ((pos === 3 || pos === 6) && Math.random() < 0.45) {
      this.tone(mtof(chord[1 + ((Math.random() * 4) | 0)] + 12), t + sw, { dur: spb * 3, vol: 0.035, echo: 1 });
    }
    if (pos === 0 || (pos === 5 && Math.random() < 0.6)) this.kick(t + sw);
    if (pos === 2 || pos === 6) this.noiseHit(t + sw, { type: 'bandpass', freq: 1800, vol: 0.22, dur: 0.18 });
    this.noiseHit(t + sw, { vol: 0.05 + Math.random() * 0.03, dur: 0.05 });
  }

  // ---- Night Drive: synthwave (sixteenth grid): gated drums, saw bass, square arp, pad
  synth(t, step) {
    const CH = [[57, 60, 64], [53, 57, 60], [48, 52, 55], [55, 59, 62]]; // Am F C G
    const s16 = 60 / 100 / 4;
    const s = step % 64, bar = Math.floor(s / 16), pos = s % 16;
    const chord = CH[bar];
    if (pos % 4 === 0) this.kick(t, 0.55);
    if (pos === 4 || pos === 12) this.noiseHit(t, { type: 'bandpass', freq: 1500, vol: 0.28, dur: 0.24 });
    if (pos % 2 === 1) this.noiseHit(t, { vol: 0.04, dur: 0.04 });
    if (pos % 2 === 0) this.tone(mtof(chord[0] - 24 + (pos % 4 === 2 ? 12 : 0)), t, { dur: s16 * 1.8, vol: 0.09, type: 'sawtooth', cutoff: 520, q: 4 });
    const arp = [0, 1, 2, 1, 0, 2, 1, 2];
    this.tone(mtof(chord[arp[pos % 8]] + 12 + (pos > 7 ? 12 : 0)), t, { dur: s16 * 0.9, vol: 0.03, type: 'square', cutoff: 2400, echo: 1 });
    if (pos === 0) chord.forEach((m) => this.tone(mtof(m), t, { dur: s16 * 16, vol: 0.022, type: 'sawtooth', cutoff: 1200, attack: 0.4, sustain: 1, release: 0.6, detune: Math.random() * 12 - 6 }));
  }

  // ---- Smooth AM: swing jazz (eighth grid with heavy swing): ride, walking bass, comping
  jazz(t, step) {
    const CH = [[50, 53, 57, 60, 64], [43, 47, 53, 57, 64], [48, 52, 55, 59, 62], [45, 49, 55, 58, 61]]; // Dm9 G13 Cmaj9 A7b9
    const spb = 60 / 116 / 2;
    const s = step % 32, bar = Math.floor(s / 8), pos = s % 8;
    const chord = CH[bar];
    const sw = pos % 2 === 1 ? spb * 0.34 : 0; // triplet swing
    // ride pattern: ding (1), ding (2) da (2&), ding (3), ding (4) da (4&)
    if (pos % 2 === 0 || pos === 3 || pos === 7) this.noiseHit(t + sw, { vol: pos % 2 ? 0.035 : 0.05, dur: 0.22, freq: 5200 });
    if (pos === 2 || pos === 6) this.noiseHit(t, { type: 'bandpass', freq: 2200, vol: 0.06, dur: 0.12 }); // brushes
    // walking bass: quarter notes moving toward the next root
    if (pos % 2 === 0) {
      const next = CH[(bar + 1) % 4][0];
      const beat = pos / 2;
      const notes = [chord[0], chord[2] - 12, chord[1], next + (next > chord[0] ? -1 : 1)];
      this.tone(mtof(notes[beat] - 12), t, { dur: spb * 1.8, vol: 0.12, type: 'triangle' });
    }
    // piano comping on the off-beats
    if ((pos === 3 || pos === 6) && Math.random() < 0.6) {
      chord.slice(1).forEach((m, i) => this.tone(mtof(m), t + sw + i * 0.012, { dur: spb * 1.4, vol: 0.03, type: 'triangle' }));
    }
    // a lazy sax-ish line now and then
    if (pos % 2 === 1 && Math.random() < 0.25) {
      this.tone(mtof(chord[1 + ((Math.random() * 4) | 0)] + 12), t + sw, { dur: spb * 2.2, vol: 0.03, type: 'sawtooth', cutoff: 1400, attack: 0.05, echo: 1 });
    }
  }

  // ---- Chill: ambient (one tick per beat): slow pads, bells, no drums
  ambient(t, step) {
    const CH = [[48, 55, 62, 64], [45, 52, 57, 64], [41, 48, 55, 60], [43, 50, 55, 62]];
    const beat = step % 16, bar = Math.floor(beat / 4);
    const chord = CH[bar];
    if (beat % 4 === 0) {
      chord.forEach((m) => {
        this.tone(mtof(m), t, { dur: 4.6, vol: 0.026, type: 'triangle', attack: 1.4, sustain: 1, release: 1.8, wash: 1, detune: Math.random() * 10 - 5 });
      });
      this.tone(mtof(chord[0] - 12), t, { dur: 4.4, vol: 0.06, attack: 1.0, sustain: 1, release: 1.5 });
    }
    if (Math.random() < 0.35) {
      const pent = [72, 74, 76, 79, 81, 84];
      this.tone(mtof(pent[(Math.random() * pent.length) | 0]), t + Math.random() * 0.4, { dur: 2.6, vol: 0.03, wash: 1, echo: 1 });
    }
  }
}
