export class Sfx {
  ctx: AudioContext | null = null;
  master: GainNode | null = null;
  enabled = true;

  unlock() {
    if (!this.ctx) {
      const AC = window.AudioContext || (window as any).webkitAudioContext;
      if (!AC) return;
      this.ctx = new AC();
      this.master = this.ctx.createGain();
      this.master.gain.value = 0.55;
      this.master.connect(this.ctx.destination);
    }
    if (this.ctx.state === 'suspended') this.ctx.resume();
  }

  private ok() { return this.enabled && this.ctx && this.master ? this.ctx : null; }

  private env(g: GainNode, t: number, a: number, peak: number, d: number) {
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(peak, t + a);
    g.gain.exponentialRampToValueAtTime(0.0001, t + a + d);
  }

  boing(pitch = 1) {
    const c = this.ok(); if (!c) return;
    const t = c.currentTime;
    const o = c.createOscillator(), g = c.createGain(), lfo = c.createOscillator(), lg = c.createGain();
    o.type = 'triangle';
    o.frequency.setValueAtTime(180 * pitch, t);
    o.frequency.exponentialRampToValueAtTime(620 * pitch, t + 0.18);
    lfo.frequency.value = 28; lg.gain.value = 40 * pitch;
    lfo.connect(lg).connect(o.frequency);
    this.env(g, t, 0.01, 0.35, 0.3);
    o.connect(g).connect(this.master!);
    o.start(t); lfo.start(t); o.stop(t + 0.35); lfo.stop(t + 0.35);
  }

  squish(strength = 1) {
    const c = this.ok(); if (!c) return;
    const t = c.currentTime;
    const len = 0.16;
    const buf = c.createBuffer(1, Math.floor(c.sampleRate * len), c.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / d.length);
    const src = c.createBufferSource(); src.buffer = buf;
    const f = c.createBiquadFilter(); f.type = 'lowpass';
    f.frequency.setValueAtTime(900, t); f.frequency.exponentialRampToValueAtTime(160, t + len);
    f.Q.value = 6;
    const g = c.createGain(); this.env(g, t, 0.005, 0.5 * Math.min(1.5, strength), len);
    src.connect(f).connect(g).connect(this.master!);
    src.start(t);
    const o = c.createOscillator(), og = c.createGain();
    o.type = 'sine'; o.frequency.setValueAtTime(140, t); o.frequency.exponentialRampToValueAtTime(55, t + 0.12);
    this.env(og, t, 0.004, 0.45 * Math.min(1.5, strength), 0.13);
    o.connect(og).connect(this.master!); o.start(t); o.stop(t + 0.2);
  }

  plop() {
    const c = this.ok(); if (!c) return;
    const t = c.currentTime;
    const o = c.createOscillator(), g = c.createGain();
    o.type = 'sine'; o.frequency.setValueAtTime(220, t); o.frequency.exponentialRampToValueAtTime(90, t + 0.07);
    this.env(g, t, 0.003, 0.12, 0.08);
    o.connect(g).connect(this.master!); o.start(t); o.stop(t + 0.12);
  }

  bell() {
    const c = this.ok(); if (!c) return;
    const t = c.currentTime;
    [1, 2.76, 5.4].forEach((m, i) => {
      const o = c.createOscillator(), g = c.createGain();
      o.type = 'sine'; o.frequency.value = 880 * m;
      this.env(g, t, 0.004, [0.22, 0.09, 0.04][i], 0.5 - i * 0.12);
      o.connect(g).connect(this.master!); o.start(t); o.stop(t + 0.6);
    });
  }

  moo() {
    const c = this.ok(); if (!c) return;
    const t = c.currentTime, dur = 1.25;
    const o = c.createOscillator(), o2 = c.createOscillator();
    o.type = 'sawtooth'; o2.type = 'sawtooth';
    o.frequency.setValueAtTime(120, t);
    o.frequency.linearRampToValueAtTime(150, t + 0.25);
    o.frequency.linearRampToValueAtTime(95, t + dur);
    o2.frequency.setValueAtTime(121.5, t);
    o2.frequency.linearRampToValueAtTime(151, t + 0.25);
    o2.frequency.linearRampToValueAtTime(96, t + dur);
    const vib = c.createOscillator(), vg = c.createGain();
    vib.frequency.value = 5.5; vg.gain.value = 3; vib.connect(vg); vg.connect(o.frequency); vg.connect(o2.frequency);
    const f1 = c.createBiquadFilter(); f1.type = 'bandpass'; f1.Q.value = 4;
    f1.frequency.setValueAtTime(350, t); f1.frequency.linearRampToValueAtTime(800, t + 0.35); f1.frequency.linearRampToValueAtTime(420, t + dur);
    const f2 = c.createBiquadFilter(); f2.type = 'lowpass'; f2.frequency.value = 1400;
    const g = c.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.9, t + 0.12);
    g.gain.setValueAtTime(0.9, t + dur - 0.35);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(f1); o2.connect(f1); f1.connect(f2).connect(g).connect(this.master!);
    [o, o2, vib].forEach(n => { n.start(t); n.stop(t + dur + 0.05); });
  }
}
