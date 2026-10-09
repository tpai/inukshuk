// Ambient sound. Wind is synthesised and follows the on-screen wind. Birds, crickets and stone
// clacks play CC0 recordings from public/sfx when present, and fall back to synthesis otherwise.

import { wind, nightness, type Env } from './env';

const SAMPLE_NAMES = ['bird-1', 'bird-2', 'bird-3', 'crickets', 'clack-1', 'clack-2'] as const;
type SampleName = (typeof SAMPLE_NAMES)[number];

class Sound {
  enabled = false;
  private ctx: AudioContext | null = null;
  private master!: GainNode;
  private windGain!: GainNode;
  private windFilter!: BiquadFilterNode;
  private cricketGain: GainNode | null = null;
  private samples = new Map<SampleName, AudioBuffer>();
  private nextChirp = 4;
  private listeners = new Set<() => void>();

  constructor() {
    try {
      this.enabled = localStorage.getItem('inukshuk.sound') === 'on';
    } catch {
      /* ignore */
    }
  }

  onChange(f: () => void) {
    this.listeners.add(f);
  }

  /** Must run inside a user gesture: browsers block audio until then. */
  async toggle() {
    this.enabled = !this.enabled;
    try {
      localStorage.setItem('inukshuk.sound', this.enabled ? 'on' : 'off');
    } catch {
      /* ignore */
    }
    if (this.enabled) await this.start();
    else this.ctx?.suspend();
    this.listeners.forEach((f) => f());
  }

  /** Resume on the first interaction if the viewer had sound on last time. */
  async resumeFromGesture() {
    if (this.enabled) await this.start();
  }

  private async start() {
    if (!this.ctx) {
      const ctx = new AudioContext();
      this.ctx = ctx;
      this.master = ctx.createGain();
      this.master.gain.value = 0.8;
      this.master.connect(ctx.destination);
      this.buildWind(ctx);
      this.loadSamples(ctx);
    }
    if (this.ctx.state !== 'running') await this.ctx.resume();
  }

  private buildWind(ctx: AudioContext) {
    // Brown-ish noise through a moving band-pass reads as wind over open ground.
    const len = ctx.sampleRate * 4;
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = buf.getChannelData(0);
    let last = 0;
    for (let i = 0; i < len; i++) {
      last = (last + 0.02 * (Math.random() * 2 - 1)) / 1.02;
      d[i] = last * 3.5;
    }
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.loop = true;
    this.windFilter = ctx.createBiquadFilter();
    this.windFilter.type = 'bandpass';
    this.windFilter.Q.value = 0.7;
    this.windFilter.frequency.value = 500;
    this.windGain = ctx.createGain();
    this.windGain.gain.value = 0;
    src.connect(this.windFilter).connect(this.windGain).connect(this.master);
    src.start();
  }

  private async loadSamples(ctx: AudioContext) {
    await Promise.all(
      SAMPLE_NAMES.map(async (name) => {
        try {
          const res = await fetch(`${import.meta.env.BASE_URL}sfx/${name}.mp3`);
          if (!res.ok) return;
          this.samples.set(name, await ctx.decodeAudioData(await res.arrayBuffer()));
        } catch {
          /* missing recording: synthesis covers it */
        }
      }),
    );
  }

  private play(name: SampleName, gain: number, rate = 1): boolean {
    const buf = this.samples.get(name);
    if (!buf || !this.ctx) return false;
    const src = this.ctx.createBufferSource();
    src.buffer = buf;
    src.playbackRate.value = rate;
    const g = this.ctx.createGain();
    g.gain.value = gain;
    src.connect(g).connect(this.master);
    src.start();
    return true;
  }

  private get live() {
    return this.enabled && this.ctx && this.ctx.state === 'running' ? this.ctx : null;
  }

  chirp() {
    const ctx = this.live;
    if (!ctx) return;
    const pick = (['bird-1', 'bird-2', 'bird-3'] as const)[Math.floor(Math.random() * 3)];
    if (this.play(pick, 0.5, 0.92 + Math.random() * 0.16)) return;
    const now = ctx.currentTime;
    const notes = 2 + Math.floor(Math.random() * 4);
    const base = 2600 + Math.random() * 1400;
    for (let i = 0; i < notes; i++) {
      const t0 = now + i * (0.09 + Math.random() * 0.05);
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.type = 'sine';
      const f = base * (0.85 + Math.random() * 0.4);
      o.frequency.setValueAtTime(f, t0);
      o.frequency.exponentialRampToValueAtTime(f * (Math.random() < 0.5 ? 1.35 : 0.75), t0 + 0.07);
      g.gain.setValueAtTime(0, t0);
      g.gain.linearRampToValueAtTime(0.06, t0 + 0.01);
      g.gain.exponentialRampToValueAtTime(0.001, t0 + 0.08);
      o.connect(g).connect(this.master);
      o.start(t0);
      o.stop(t0 + 0.1);
    }
  }

  clack(strength: number) {
    const ctx = this.live;
    if (!ctx) return;
    const s = Math.min(1, strength);
    if (this.play(Math.random() < 0.5 ? 'clack-1' : 'clack-2', 0.25 + s * 0.6, 0.85 + Math.random() * 0.3)) return;
    const now = ctx.currentTime;
    const len = Math.floor(ctx.sampleRate * 0.08);
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.exp(-i / (len * 0.12));
    const src = ctx.createBufferSource();
    src.buffer = buf;
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = 1400 + Math.random() * 1600;
    bp.Q.value = 3;
    const g = ctx.createGain();
    g.gain.value = 0.15 + s * 0.5;
    src.connect(bp).connect(g).connect(this.master);
    src.start(now);
  }

  private startCrickets(ctx: AudioContext) {
    const g = ctx.createGain();
    g.gain.value = 0;
    g.connect(this.master);
    this.cricketGain = g;
    const buf = this.samples.get('crickets');
    if (buf) {
      const src = ctx.createBufferSource();
      src.buffer = buf;
      src.loop = true;
      src.connect(g);
      src.start();
      return;
    }
    // Synth: a high tone gated by a fast pulse train, in bursts.
    const o = ctx.createOscillator();
    o.frequency.value = 4400;
    const pulse = ctx.createOscillator();
    pulse.type = 'square';
    pulse.frequency.value = 28;
    const gate = ctx.createGain();
    gate.gain.value = 0;
    const depth = ctx.createGain();
    depth.gain.value = 0.5;
    pulse.connect(depth).connect(gate.gain);
    const burst = ctx.createOscillator();
    burst.frequency.value = 1.4;
    const burstDepth = ctx.createGain();
    burstDepth.gain.value = 0.5;
    const burstGate = ctx.createGain();
    burstGate.gain.value = 0.5;
    burst.connect(burstDepth).connect(burstGate.gain);
    o.connect(gate).connect(burstGate).connect(g);
    o.start();
    pulse.start();
    burst.start();
  }

  update(dt: number, env: Env) {
    const ctx = this.live;
    if (!ctx) return;
    const now = ctx.currentTime;
    const w = wind.value;
    const winter = env.season === 'winter';
    this.windGain.gain.setTargetAtTime(0.05 + w * 0.32, now, 0.3);
    this.windFilter.frequency.setTargetAtTime((winter ? 320 : 420) + w * 700, now, 0.4);

    const night = nightness(env.hour);
    const crickets = env.season === 'summer' ? night : env.season === 'autumn' ? night * 0.4 : 0;
    if (crickets > 0 && !this.cricketGain) this.startCrickets(ctx);
    this.cricketGain?.gain.setTargetAtTime(crickets * 0.05, now, 1);

    // Distant birds in daylight, beyond the ones that visit the inukshuk.
    this.nextChirp -= dt;
    if (this.nextChirp <= 0) {
      this.nextChirp = 6 + Math.random() * 14;
      if (night < 0.3 && !winter) this.chirp();
    }
  }
}

export const sound = new Sound();
