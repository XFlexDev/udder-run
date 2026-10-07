type Clip = 'boing' | 'moo' | 'squish' | 'squeak' | 'bell';
const CLIPS: Clip[] = ['boing', 'moo', 'squish', 'squeak', 'bell'];

/** Recorded CC0 sound effects (see public/audio/LICENSE.md), played through Web Audio for pitch variation. */
export class Sfx {
  ctx: AudioContext | null = null;
  master: GainNode | null = null;
  enabled = true;
  private buffers = new Map<Clip, AudioBuffer>();
  private loading: Promise<void> | null = null;
  private lastPlay = new Map<Clip, number>();

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
