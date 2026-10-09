// The living landscape: sky by the viewer's hour, seasons, wind, weather particles.

import { Container, Graphics } from 'pixi.js';
import { type Env, type Season, nightness, wind, reducedMotion } from './env';
import { mix, mulberry32, lerp } from './util';

interface Key {
  h: number;
  top: number;
  bot: number;
  far: number;
  mid: number;
  near: number;
  light: number;
}

const NIGHT = { top: 0x18213a, bot: 0x3a4564, far: 0x39425b, mid: 0x2d3549, near: 0x232938, light: 0x7a84a8 };
const DAWN = { top: 0x7b8db0, bot: 0xf0c09c, far: 0xb69c9c, mid: 0x8f7a7c, near: 0x6c5c5c, light: 0xf2d4c4 };
const DAY = { top: 0x9db9cb, bot: 0xefe3cd, far: 0xb9c2c6, mid: 0xa49d94, near: 0x8b7766, light: 0xffffff };
const DUSK = { top: 0x666b90, bot: 0xec9f6c, far: 0xa87f78, mid: 0x86625d, near: 0x5d4846, light: 0xf5c6a6 };

const KEYS: Key[] = [
  { h: 0, ...NIGHT }, { h: 4.8, ...NIGHT }, { h: 6.3, ...DAWN }, { h: 8.6, ...DAY },
  { h: 16.4, ...DAY }, { h: 18.4, ...DUSK }, { h: 20, ...NIGHT }, { h: 24, ...NIGHT },
];

export type Palette = Omit<Key, 'h'>;

export function paletteAt(hour: number): Palette {
  let i = 0;
  while (i < KEYS.length - 2 && hour > KEYS[i + 1].h) i++;
  const a = KEYS[i], b = KEYS[i + 1];
  const t = Math.min(1, Math.max(0, (hour - a.h) / (b.h - a.h || 1)));
  return {
    top: mix(a.top, b.top, t), bot: mix(a.bot, b.bot, t), far: mix(a.far, b.far, t),
    mid: mix(a.mid, b.mid, t), near: mix(a.near, b.near, t), light: mix(a.light, b.light, t),
  };
}

export function multiply(a: number, b: number): number {
  const r = (((a >> 16) & 255) * ((b >> 16) & 255)) / 255;
  const g = (((a >> 8) & 255) * ((b >> 8) & 255)) / 255;
  const bl = ((a & 255) * (b & 255)) / 255;
  return (Math.round(r) << 16) | (Math.round(g) << 8) | Math.round(bl);
}

const GROUND: Record<Season, number> = { spring: 0xb9b47c, summer: 0xcfb680, autumn: 0xc79a66, winter: 0xe9edf0 };
const GRASS: Record<Season, number> = { spring: 0x7f8f45, summer: 0x98944c, autumn: 0xa8783f, winter: 0x9c9583 };

interface Particle {
  g: Graphics;
  x: number;
  y: number;
  vx: number;
  vy: number;
  r: number;
  ph: number;
}

export class Scenery {
  back = new Container();
  front = new Container();
  private sky = new Graphics();
  private stars = new Graphics();
  private sun = new Graphics();
  private moon = new Graphics();
  private clouds = new Container();
  private ridges: Graphics[] = [];
  private ground = new Graphics();
  private groundDeco = new Graphics();
  private grass = new Graphics();
  private particles: Particle[] = [];
  private season: Season | null = null;
  private skyKey = '';
  private t = 0;
  private w = 0;
  private h = 0;
  groundY = 0;
  scroll = 0;
  palette: Palette = paletteAt(12);
  env: Env | null = null;
  /** Colour to tint ground-level things (stones, birds) by. */
  light = 0xffffff;

  constructor(private seed = 7) {
    this.back.addChild(this.sky, this.stars, this.sun, this.moon, this.clouds);
    for (let i = 0; i < 3; i++) {
      const g = new Graphics();
      this.ridges.push(g);
      this.back.addChild(g);
    }
    this.back.addChild(this.ground, this.groundDeco, this.grass);
    const r = mulberry32(seed + 3);
    for (let i = 0; i < 4; i++) {
      const c = new Graphics();
      const n = 3 + Math.floor(r() * 3);
      for (let k = 0; k < n; k++) c.ellipse(k * 22 - n * 11, (r() - 0.5) * 8, 20 + r() * 18, 9 + r() * 6).fill(0xffffff);
      c.position.set(r() * 1600, 0);
      c.alpha = 0.55;
      (c as Graphics & { depth: number }).depth = 0.2 + r() * 0.5;
      this.clouds.addChild(c);
    }
  }

  resize(w: number, h: number, groundY: number) {
    this.w = w;
    this.h = h;
    this.groundY = groundY;
    this.skyKey = '';
    this.drawStars();
    this.drawRidges();
    this.drawGround();
    this.clouds.children.forEach((c, i) => (c.y = h * (0.1 + i * 0.07)));
  }

  private drawStars() {
    const r = mulberry32(this.seed + 11);
    this.stars.clear();
    for (let i = 0; i < 90; i++) {
      const x = r() * this.w, y = r() * this.groundY * 0.7;
      this.stars.circle(x, y, r() < 0.1 ? 1.4 : 0.8).fill({ color: 0xfff8e8, alpha: 0.4 + r() * 0.6 });
    }
  }

  private drawRidges() {
    const W = Math.max(this.w, 600);
    const specs = [
      { base: 0.66, amp: 0.14, freqs: [1, 2, 4, 9], sharp: 1.5 },
      { base: 0.8, amp: 0.08, freqs: [2, 3, 6, 13], sharp: 1.2 },
      { base: 0.92, amp: 0.04, freqs: [2, 5, 9, 17], sharp: 1 },
    ];
    this.ridges.forEach((g, li) => {
      const s = specs[li];
      const r = mulberry32(this.seed * 31 + li);
      const phases = s.freqs.map(() => r() * Math.PI * 2);
      const amps = s.freqs.map((_, i) => 1 / (i + 1) ** 0.9);
      const total = amps.reduce((a, b) => a + b, 0);
      const pts: number[] = [];
      const step = 6;
      for (let x = 0; x <= W * 2; x += step) {
        let v = 0;
        s.freqs.forEach((f, i) => (v += amps[i] * Math.sin((x / W) * Math.PI * 2 * f + phases[i])));
        v = v / total;
        v = Math.sign(v) * Math.abs(v) ** (1 / s.sharp);
        pts.push(x, this.groundY * (s.base - s.amp * v));
      }
      pts.push(W * 2, this.groundY + 4, 0, this.groundY + 4);
      g.clear().poly(pts).fill(0xffffff);
      (g as Graphics & { period: number }).period = W;
    });
  }

  private drawGround() {
    this.ground.clear().rect(-20, this.groundY, this.w + 40, this.h - this.groundY + 20).fill(0xffffff);
    this.season = null; // force deco redraw
  }

  private drawDeco(season: Season) {
    const g = this.groundDeco.clear();
    const W = Math.max(this.w, 600);
    for (let copy = 0; copy < 2; copy++) {
      const r2 = mulberry32(this.seed + 99);
      for (let i = 0; i < 26; i++) {
        const x = r2() * W + copy * W, y = this.groundY + 6 + r2() * (this.h - this.groundY - 10);
        const rad = 1.5 + r2() * 3;
        g.ellipse(x, y, rad * 1.5, rad).fill({ color: 0x6d655c, alpha: 0.35 });
      }
      if (season === 'spring') {
        const r3 = mulberry32(this.seed + 5);
        const cols = [0xf3d3dc, 0xfaf3e6, 0xe8c45c, 0xcdb3e6];
        for (let i = 0; i < 22; i++) {
          const x = r3() * W + copy * W, y = this.groundY + 3 + r3() * 26;
          const c = cols[Math.floor(r3() * cols.length)];
          for (let k = 0; k < 5; k++) {
            const a = (k / 5) * Math.PI * 2;
            g.circle(x + Math.cos(a) * 2.2, y + Math.sin(a) * 2.2, 1.7).fill(c);
          }
          g.circle(x, y, 1.3).fill(0xe0a83a);
        }
      }
    }
    (g as Graphics & { period: number }).period = W;
  }

  private spawnParticles(season: Season) {
    for (const p of this.particles) p.g.destroy();
    this.particles = [];
    const r = mulberry32(this.seed + 41);
    const scale = reducedMotion ? 0.3 : 1;
    const make = (n: number, draw: (g: Graphics) => void) => {
      for (let i = 0; i < Math.round(n * scale); i++) {
        const g = new Graphics();
        draw(g);
        this.front.addChild(g);
        this.particles.push({ g, x: r() * this.w, y: r() * this.h, vx: 0, vy: 0, r: r(), ph: r() * 10 });
      }
    };
    if (season === 'winter') make(90, (g) => g.circle(0, 0, 1 + Math.random() * 1.6).fill({ color: 0xffffff, alpha: 0.9 }));
    if (season === 'autumn') {
      const cols = [0xc4632e, 0xd79a3a, 0x9b4a2a];
      make(14, (g) => g.ellipse(0, 0, 4, 2).fill(cols[Math.floor(Math.random() * 3)]));
    }
    if (season === 'summer') make(18, (g) => {
      g.circle(0, 0, 6).fill({ color: 0xfff1a0, alpha: 0.12 });
      g.circle(0, 0, 1.6).fill(0xfff6c0);
      g.blendMode = 'add';
    });
    if (season === 'spring') make(8, (g) => g.ellipse(0, 0, 2.4, 1.6).fill(0xf6dbe2));
  }

  update(dt: number, env: Env) {
    this.env = env;
    this.t += dt;
    const night = nightness(env.hour);
    const pal = (this.palette = paletteAt(env.hour));
    this.light = pal.light;

    const key = env.hour.toFixed(2) + this.w + 'x' + this.h;
    if (key !== this.skyKey) {
      this.skyKey = key;
      const bands = 48;
      const sky = this.sky.clear();
      const H = this.groundY;
      for (let i = 0; i < bands; i++) {
        const t = i / (bands - 1);
        sky.rect(0, (H * i) / bands, this.w, H / bands + 1).fill(mix(pal.top, pal.bot, t ** 1.3));
      }
      sky.rect(0, H, this.w, 4).fill(pal.bot);
    }

    if (env.season !== this.season) {
      this.season = env.season;
      this.drawDeco(env.season);
      this.spawnParticles(env.season);
    }

    // Sun and moon arcs.
    const arc = (k: number) => ({ x: this.w * lerp(0.08, 0.92, k), y: this.groundY * (0.66 - Math.sin(k * Math.PI) * 0.36) });
    this.sun.clear();
    if (env.hour > 5.2 && env.hour < 19.3) {
      const p = arc((env.hour - 5.2) / 14.1);
      const low = 1 - Math.sin(((env.hour - 5.2) / 14.1) * Math.PI);
      const col = mix(0xf6d9a8, 0xf0a46e, low);
      this.sun.circle(p.x, p.y, 70).fill({ color: col, alpha: 0.12 });
      this.sun.circle(p.x, p.y, 46).fill({ color: col, alpha: 0.2 });
      this.sun.circle(p.x, p.y, 30).fill({ color: col, alpha: 0.95 });
    }
    this.moon.clear();
    if (night > 0.2) {
      const k = ((env.hour + 24 - 18.5) % 24) / 12;
      if (k < 1) {
        const p = arc(k);
        this.moon.circle(p.x, p.y, 34).fill({ color: 0xeef0f5, alpha: 0.08 * night });
        this.moon.circle(p.x, p.y, 15).fill({ color: 0xf2efe2, alpha: night });
        this.moon.circle(p.x + 6, p.y - 4, 13).fill({ color: pal.top, alpha: night * 0.9 });
      }
    }
    this.stars.alpha = night * (0.85 + 0.15 * Math.sin(this.t * 2));

    // Clouds drift with the wind.
    for (const c of this.clouds.children) {
      const d = (c as Graphics & { depth: number }).depth;
      c.x += (6 + wind.value * 40) * d * dt;
      if (c.x > this.w + 120) c.x = -140;
      (c as Graphics).tint = mix(pal.bot, 0xffffff, 0.5 - night * 0.35);
      c.alpha = 0.5 - night * 0.3;
    }

    // Ridges: tinted silhouettes with parallax.
    const tints = [pal.far, pal.mid, pal.near];
    const seasonal = env.season === 'winter' ? 0.18 : 0;
    this.ridges.forEach((g, i) => {
      g.tint = mix(tints[i], 0xf4f6f8, seasonal * (1 - i * 0.3) * (1 - night * 0.6));
      const period = (g as Graphics & { period: number }).period;
      g.x = -(((this.scroll * (0.08 + i * 0.12)) % period) + period) % period;
    });

    this.ground.tint = multiply(GROUND[env.season], pal.light);
    const decoPeriod = (this.groundDeco as Graphics & { period: number }).period || 1;
    this.groundDeco.x = -((this.scroll % decoPeriod) + decoPeriod) % decoPeriod;
    this.groundDeco.tint = pal.light;

    this.drawGrass(env, pal);
    this.updateParticles(dt, env, night);
  }

  private drawGrass(env: Env, pal: Palette) {
    const g = this.grass.clear();
    const r = mulberry32(this.seed + 17);
    const W = Math.max(this.w, 600);
    const n = env.season === 'winter' ? 26 : 80;
    const col = multiply(GRASS[env.season], pal.light);
    const off = ((this.scroll % W) + W) % W;
    for (let i = 0; i < n; i++) {
      const bx = r() * W;
      let x = bx - off;
      if (x < -10) x += W;
      const h = 6 + r() * 14;
      const ph = r() * 6;
      const y = this.groundY + 2 + r() * 6;
      if (x > this.w + 10) continue;
      const sway = (wind.value * 0.7 + Math.sin(this.t * (1.3 + wind.value) + ph + x * 0.01) * (0.15 + wind.value * 0.35)) * h * 0.6;
      g.moveTo(x, y).quadraticCurveTo(x + sway * 0.3, y - h * 0.6, x + sway, y - h).stroke({ width: 1.3, color: col, alpha: 0.85 });
    }
  }

  private updateParticles(dt: number, env: Env, night: number) {
    const w = this.w, h = this.h;
    for (const p of this.particles) {
      if (env.season === 'winter') {
        p.vy = 22 + p.r * 30;
        p.vx = (wind.value * 60 + Math.sin(this.t + p.ph) * 10) * (0.5 + p.r);
      } else if (env.season === 'autumn') {
        p.vy = 24 + p.r * 18;
        p.vx = wind.value * 80 * (0.6 + p.r) + Math.sin(this.t * 2 + p.ph) * 20;
        p.g.rotation += dt * (1 + p.r * 3);
      } else if (env.season === 'summer') {
        p.vx = Math.sin(this.t * 0.6 + p.ph) * 12;
        p.vy = Math.cos(this.t * 0.5 + p.ph * 1.7) * 8;
        p.g.alpha = night * (0.4 + 0.6 * Math.max(0, Math.sin(this.t * (1.2 + p.r) + p.ph)));
      } else {
        p.vy = 14 + p.r * 10;
        p.vx = wind.value * 50 + Math.sin(this.t + p.ph) * 12;
        p.g.rotation += dt;
      }
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      if (env.season === 'summer') {
        // Fireflies stay low, near the grass.
        const top = this.groundY - 160, bottom = this.groundY + 20;
        if (p.y < top) p.y = bottom;
        if (p.y > bottom) p.y = top;
      } else if (p.y > h + 10) {
        p.y = -10;
        p.x = Math.random() * w;
      }
      if (p.x > w + 10) p.x = -10;
      if (p.x < -10) p.x = w + 10;
      p.g.position.set(p.x, p.y);
    }
  }

  destroy() {
    this.back.destroy({ children: true });
    this.front.destroy({ children: true });
  }
}
