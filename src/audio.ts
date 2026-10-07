type Clip = 'boing' | 'moo' | 'squish' | 'squeak' | 'bell' | 'spray';
const CLIPS: Clip[] = ['boing', 'moo', 'squish', 'squeak', 'bell', 'spray'];

/** Recorded CC0 sound effects (see public/audio/LICENSE.md), played through Web Audio for pitch variation. */
export class Sfx {
  ctx: AudioContext | null = null;
  master: GainNode | null = null;
  enabled = true;
  private buffers = new Map<Clip, AudioBuffer>();
  private loading: Promise<void> | null = null;
  private lastPlay = new Map<Clip, number>();
  private loop: { src: AudioBufferSourceNode; g: GainNode } | null = null;
  private loopWant: { name: Clip; gain: number } | null = null;

  /** Continuous looping clip (milk geyser); starts as soon as the buffer is decoded. */
  startLoop(name: Clip, gain = 0.5) {
    this.loopWant = { name, gain };
    const buf = this.buffers.get(name);
    if (this.loop || !this.enabled || !this.ctx || !this.master || !buf) return;
    const src = this.ctx.createBufferSource(), g = this.ctx.createGain();
    src.buffer = buf; src.loop = true;
    const t = this.ctx.currentTime;
    g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(gain, t + 0.15);
    src.connect(g).connect(this.master); src.start(t);
    this.loop = { src, g };
  }
  stopLoop() {
    this.loopWant = null;
    if (!this.loop || !this.ctx) return;
    const { src, g } = this.loop, t = this.ctx.currentTime;
    g.gain.cancelScheduledValues(t); g.gain.setValueAtTime(g.gain.value, t); g.gain.linearRampToValueAtTime(0, t + 0.2);
    src.stop(t + 0.25);
    this.loop = null;
  }
  /** retry a wanted loop whose buffer wasn't decoded yet */
  tickLoop() { if (this.loopWant && !this.loop) this.startLoop(this.loopWant.name, this.loopWant.gain); }

  unlock() {
    if (!this.ctx) {
      const AC = window.AudioContext || (window as any).webkitAudioContext;
      if (!AC) return;
      this.ctx = new AC();
      this.master = this.ctx.createGain();
      this.master.gain.value = 0.8;
      this.master.connect(this.ctx.destination);
    }
    if (this.ctx.state === 'suspended') void this.ctx.resume();
    this.load();
  }

  private load() {
    if (this.loading || !this.ctx) return;
    const c = this.ctx;
    this.loading = Promise.all(CLIPS.map(async name => {
      try {
        const res = await fetch(`audio/${name}.mp3`);
        if (!res.ok) return;
        const data = await res.arrayBuffer();
        this.buffers.set(name, await c.decodeAudioData(data));
      } catch { /* keep the game playable if one clip fails */ }
    })).then(() => undefined);
  }

  private play(name: Clip, rate = 1, gain = 1, minGap = 0.04, offset = 0, dur?: number) {
    const c = this.ctx, buf = this.buffers.get(name);
    if (!this.enabled || !c || !this.master || !buf) return;
    const t = c.currentTime;
    if (t - (this.lastPlay.get(name) ?? -1) < minGap) return;
    this.lastPlay.set(name, t);
    const src = c.createBufferSource(), g = c.createGain();
    src.buffer = buf;
    src.playbackRate.value = rate;
    const len = Math.min(dur ?? buf.duration, buf.duration - offset) / rate;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(Math.max(0.0002, gain), t + 0.008);
    g.gain.setValueAtTime(Math.max(0.0002, gain), t + Math.max(0.01, len - 0.08));
    g.gain.exponentialRampToValueAtTime(0.0001, t + len);
    src.connect(g).connect(this.master);
    src.start(t, offset, len * rate);
  }

  boing(pitch = 1) { this.play('boing', pitch * (0.96 + Math.random() * 0.08), 0.55, 0.06); }
  squish(strength = 1) { this.play('squish', 1.15 - Math.min(1.5, strength) * 0.15 + Math.random() * 0.08, 0.35 + Math.min(1.5, strength) * 0.3, 0.07); }
  bell() { this.play('bell', 1.15 + Math.random() * 0.1, 0.45, 0.05); }
  moo(pitch = 1, dur = 2.2) { this.play('moo', pitch, 0.8, 0.3, 0, dur * pitch); }
  squeak() { this.play('squeak', 0.95 + Math.random() * 0.2, 0.45, 0.06); }
  /** crash gag: a slow, low recorded boing */
  whistle(_up = false) { this.play('boing', 0.62, 0.5, 0.2); }
}
