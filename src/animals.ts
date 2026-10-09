// Animals that gather around an inukshuk the longer it stands.
// Each is a small side-view rig (body, head, tail, four legs) with idle / walk / run / sleep.

import { Container, Graphics } from 'pixi.js';
import { debug } from './env';
import type { Scenery } from './scenery';
import { darken, lighten, lerp, rotate } from './util';

export type Species = 'squirrel' | 'beaver' | 'bison' | 'moose' | 'wolf' | 'grizzly';
export type AnimalState = 'idle' | 'walk' | 'run' | 'sleep';

/** Age (days) at which each animal arrives, and how many come. */
export const ARRIVALS: { species: Species; days: number; count: number }[] = [
  { species: 'squirrel', days: 1, count: 1 },
  { species: 'beaver', days: 7, count: 1 },
  { species: 'bison', days: 30, count: 1 },
  { species: 'moose', days: 90, count: 1 },
  { species: 'wolf', days: 180, count: 3 },
  { species: 'grizzly', days: 360, count: 1 },
];

interface Look {
  len: number;
  bodyH: number;
  leg: number;
  legW: number;
  coat: number;
  belly: number;
  legColor?: number;
  walk: number;
  run: number;
  gait: 'walk' | 'bound';
  grazes: boolean;
  nightOwl: number; // chance to stay up at night
  napper: number; // chance to nap in daylight
  neck: { x: number; y: number };
  tailAt: { x: number; y: number };
  body?: (g: Graphics, L: Look) => void;
  head: (g: Graphics, L: Look) => { x: number; y: number }; // returns eye position
  tail: (g: Graphics, L: Look) => void;
}

function blob(g: Graphics, cx: number, cy: number, rx: number, ry: number, rot: number, color: number, alpha = 1) {
  const pts: number[] = [];
  for (let i = 0; i < 20; i++) {
    const a = (i / 20) * Math.PI * 2;
    const p = rotate({ x: Math.cos(a) * rx, y: Math.sin(a) * ry }, rot);
    pts.push(cx + p.x, cy + p.y);
  }
  g.poly(pts).fill({ color, alpha });
}

const LOOKS: Record<Species, Look> = {
  squirrel: {
    len: 16, bodyH: 9, leg: 5, legW: 2.4, coat: 0xb0612f, belly: 0xead9bd,
    walk: 26, run: 80, gait: 'bound', grazes: true, nightOwl: 0, napper: 0.05,
    neck: { x: 6.5, y: -3 }, tailAt: { x: -7, y: -1 },
    head: (g, L) => {
      blob(g, 2.5, 0, 5, 4.2, 0, L.coat);
      blob(g, 3, 1.6, 2.8, 2, 0, L.belly);
      g.poly([0, -3, 1.2, -8.5, 3.2, -3.4]).fill(darken(L.coat, 0.15));
      g.circle(7.2, 0.4, 0.9).fill(0x2a1d14);
      return { x: 4, y: -1 };
    },
    tail: (g, L) => {
      const pts = [[0, 0, 3], [-4, -3, 4], [-7, -8, 5], [-6, -14, 5.5], [-2, -18, 4.6], [1, -20, 3]];
      for (const [x, y, r] of pts) g.circle(x, y, r).fill(L.coat);
      for (const [x, y, r] of pts.slice(2)) g.circle(x - 0.8, y - 0.6, r * 0.55).fill({ color: lighten(L.coat, 0.2), alpha: 0.6 });
    },
  },
  beaver: {
    len: 34, bodyH: 18, leg: 5, legW: 4.5, coat: 0x6e4a2e, belly: 0x8c6844,
    walk: 16, run: 46, gait: 'walk', grazes: true, nightOwl: 0.5, napper: 0.15,
    neck: { x: 13, y: -2 }, tailAt: { x: -15, y: 3 },
    head: (g, L) => {
      blob(g, 5, 0, 9, 7.5, 0.1, L.coat);
      g.circle(-0.5, -6, 2.2).fill(darken(L.coat, 0.2));
      blob(g, 10, 2, 4.5, 3.6, 0, L.belly);
      g.circle(13.6, 0, 1.5).fill(0x2a1d14);
      g.rect(10.6, 4.4, 2.6, 3.2).fill(0xe2a04a);
      g.circle(6.6, -2.6, 1.1).fill(0x1d140e);
      return { x: 6.6, y: -2.6 };
    },
    tail: (g) => {
      blob(g, -9, 1, 10.5, 3.4, 0.08, 0x3b3530);
      for (let x = -16; x < -3; x += 3) g.moveTo(x, -1.6).lineTo(x + 2, 3).stroke({ width: 0.6, color: 0x57504a });
    },
  },
  bison: {
    len: 78, bodyH: 40, leg: 22, legW: 7, coat: 0x5a3f2c, belly: 0x4a3322,
    walk: 14, run: 70, gait: 'walk', grazes: true, nightOwl: 0, napper: 0.1,
    neck: { x: 33, y: 4 }, tailAt: { x: -38, y: -10 },
    body: (g, L) => {
      blob(g, 0, 0, L.len / 2, L.bodyH / 2, 0, L.coat);
      blob(g, 14, -9, 24, 21, -0.15, 0x3e2b1c);
      blob(g, 22, 8, 14, 14, 0, 0x36261a);
      blob(g, -18, -6, 12, 6, 0, lighten(L.coat, 0.12), 0.35);
    },
    head: (g) => {
      blob(g, 6, 6, 11, 12.5, 0.15, 0x33241a);
      g.poly([1, 14, 7, 25, 12, 14]).fill(0x2c1f15);
      blob(g, 14, 12, 4.5, 4, 0, 0x22170f);
      g.moveTo(1, -3).quadraticCurveTo(-4, -7, -1, -11).stroke({ width: 2.6, color: 0xd9cbb0, cap: 'round' });
      g.circle(9.5, 2.5, 1.4).fill(0x0f0a06);
      return { x: 9.5, y: 2.5 };
    },
    tail: (g) => {
      g.moveTo(0, 0).quadraticCurveTo(-4, 8, -3, 16).stroke({ width: 1.6, color: 0x3a2819 });
      blob(g, -3, 18, 2.2, 3.6, 0, 0x2e2015);
    },
  },
  moose: {
    len: 70, bodyH: 34, leg: 42, legW: 5, coat: 0x3e2f25, belly: 0x3e2f25, legColor: 0x8c7b67,
    walk: 18, run: 64, gait: 'walk', grazes: true, nightOwl: 0.2, napper: 0.1,
    neck: { x: 30, y: -10 }, tailAt: { x: -34, y: -8 },
    body: (g, L) => {
      blob(g, 0, 0, L.len / 2, L.bodyH / 2, 0, L.coat);
      blob(g, 20, -10, 16, 12, -0.3, darken(L.coat, 0.1));
      g.poly([22, -10, 36, -26, 44, -18, 34, 2]).fill(L.coat);
    },
    head: (g, L) => {
      g.poly([0, -16, 4, -24, 16, -26, 34, -18, 37, -12, 30, -8, 12, -8, 2, -10]).fill(L.coat);
      g.circle(33, -14, 4.4).fill(darken(L.coat, 0.3));
      g.poly([8, -9, 10, 4, 14, -8]).fill(darken(L.coat, 0.15));
      blob(g, 2, -27, 5, 2, -0.6, darken(L.coat, 0.1));
      g.poly([4, -26, -10, -38, -8, -44, -2, -39, 0, -47, 4, -40, 9, -48, 11, -40, 17, -44, 18, -37, 8, -26]).fill(0xcdb592);
      g.circle(15, -20, 1.4).fill(0x0f0a06);
      return { x: 15, y: -20 };
    },
    tail: (g, L) => {
      blob(g, -2, 3, 2.4, 4, 0.3, L.coat);
    },
  },
  wolf: {
    len: 46, bodyH: 17, leg: 20, legW: 4, coat: 0x8d8a83, belly: 0xdcd5c6,
    walk: 24, run: 110, gait: 'walk', grazes: false, nightOwl: 0.5, napper: 0.15,
    neck: { x: 20, y: -6 }, tailAt: { x: -22, y: -4 },
    body: (g, L) => {
      blob(g, 0, 0, L.len / 2, L.bodyH / 2, 0, L.coat);
      blob(g, 2, 4, L.len * 0.38, L.bodyH * 0.28, 0, L.belly, 0.8);
      blob(g, 14, -3, 12, 9, -0.2, lighten(L.coat, 0.08));
      blob(g, -6, -6, 14, 3.4, 0, darken(L.coat, 0.18), 0.55);
    },
    head: (g, L) => {
      blob(g, 3, -1, 7.5, 6.2, 0.1, L.coat);
      g.poly([6, -3, 17, 0.5, 16, 4, 6, 4.4]).fill(L.coat);
      g.poly([7, 2.4, 16, 3, 15.5, 4.4, 7, 4.8]).fill(L.belly);
      g.circle(16.2, 1, 1.5).fill(0x1d1a17);
      g.poly([-3, -5, -1, -14, 3, -6]).fill(darken(L.coat, 0.15));
      g.poly([1, -6, 4.5, -14, 6.5, -5]).fill(L.coat);
      g.circle(7, -2.6, 1.2).fill(0xd9a441);
      return { x: 7, y: -2.6 };
    },
    tail: (g, L) => {
      blob(g, -5, 5, 9, 3.6, 0.95, L.coat);
      blob(g, -9.5, 11, 3.4, 2.3, 0.95, darken(L.coat, 0.35));
    },
  },
  grizzly: {
    len: 70, bodyH: 38, leg: 19, legW: 10, coat: 0x7b5636, belly: 0x6b4a2e,
    walk: 14, run: 84, gait: 'walk', grazes: false, nightOwl: 0.1, napper: 0.3,
    neck: { x: 30, y: 0 }, tailAt: { x: -34, y: -6 },
    body: (g, L) => {
      blob(g, 0, 0, L.len / 2, L.bodyH / 2, 0, L.coat);
      blob(g, 14, -13, 18, 12, -0.1, L.coat);
      blob(g, 12, -18, 13, 6, -0.1, 0xa07a50, 0.55);
      blob(g, -12, -12, 16, 4, 0.05, 0x9a7048, 0.3);
    },
    head: (g, L) => {
      g.circle(1, -9, 3.6).fill(darken(L.coat, 0.15));
      blob(g, 6, 1, 12, 10, 0.1, L.coat);
      g.circle(7, -8.5, 3.2).fill(darken(L.coat, 0.1));
      blob(g, 15, 4.5, 6.5, 4.6, 0.1, 0x9c7a55);
      g.circle(20.5, 3, 2.1).fill(0x1d140e);
      g.circle(10, -1.5, 1.3).fill(0x0f0a06);
      return { x: 10, y: -1.5 };
    },
    tail: (g, L) => {
      g.circle(0, 0, 3.2).fill(L.coat);
    },
  },
};

/**
 * A strip of land animals can roam: the ground in front of the inukshuk, or the top of a ridge.
 * Coordinates are the layer's own; `y` follows the land's contour.
 */
export interface Terrain {
  layer: Container;
  /** Size multiplier; read every frame so zoom changes apply. */
  scale: () => number;
  weight: number;
  lo: () => number;
  hi: () => number;
  y: (x: number) => number;
  /** Keep-out interval (the inukshuk's footprint) animals rest beside rather than inside. */
  avoid?: () => [number, number];
  /** Ridge land repeats with this period; animals that leave the view come round again. */
  period?: () => number;
}

/** A spot in the terrain's range, clear of its keep-out interval when there is room. */
function pickX(t: Terrain, near?: number): number {
  const lo = t.lo(), hi = t.hi();
  const av = t.avoid?.();
  if (!av || av[0] - lo < 24 || hi - av[1] < 24) {
    if (near === undefined) return lo + Math.random() * (hi - lo);
    // Wander a little from where we are.
    const span = (hi - lo) * 0.35;
    return Math.max(lo, Math.min(hi, near + (Math.random() * 2 - 1) * span));
  }
  const left = near !== undefined && Math.random() < 0.7 ? near < (av[0] + av[1]) / 2 : Math.random() < 0.5;
  return left ? lo + Math.random() * (av[0] - 8 - lo) : av[1] + 8 + Math.random() * (hi - av[1] - 8);
}

const WOLF_COATS = [0x8d8a83, 0x6f6c66, 0xa8a49b];
const SPECIES_SCALE: Record<Species, number> = { squirrel: 1, beaver: 1, bison: 0.85, moose: 0.85, wolf: 1, grizzly: 0.85 };

export class Animal {
  root = new Container();
  private body = new Container();
  private head = new Container();
  private tail = new Container();
  private legs: Container[] = []; // nearFront, nearBack, farFront, farBack
  private eyeOpen = new Graphics();
  private eyeShut = new Graphics();
  private zzz = new Graphics();
  private L: Look;
  state: AnimalState = 'idle';
  x = 0;
  dir = 1;
  private target = 0;
  private timer = 0;
  private ph = Math.random() * 10;
  private t = Math.random() * 10;
  private crouch = 0;
  private graze = 0;
  private blink = 2;
  private scale = 1;
  private readonly baseScale: number;
  private baseY: number;
  terrain!: Terrain;

  readonly id: string;

  constructor(public species: Species, variant: number) {
    this.id = species + variant;
    const base = LOOKS[species];
    this.L = species === 'wolf' ? { ...base, coat: WOLF_COATS[variant % 3] } : base;
    const L = this.L;
    this.baseScale = SPECIES_SCALE[species] * (species === 'wolf' ? [1, 0.92, 0.86][variant % 3] : 1);
    this.baseY = -(L.leg + L.bodyH * 0.3);

    const legColor = L.legColor ?? darken(L.coat, 0.08);
    const makeLeg = (x: number, far: boolean) => {
      const c = new Container();
      const g = new Graphics()
        .roundRect(-L.legW / 2, 0, L.legW, L.leg + 1, L.legW / 2)
        .fill(far ? darken(legColor, 0.28) : legColor)
        .rect(-L.legW / 2, L.leg - L.legW * 0.5, L.legW, L.legW * 0.5 + 1)
        .fill(darken(legColor, far ? 0.45 : 0.3));
      c.addChild(g);
      c.position.set(x, L.bodyH * 0.3);
      return c;
    };
    const fx = L.len * 0.3, bx = -L.len * 0.3;
    const nearFront = makeLeg(fx, false), nearBack = makeLeg(bx, false);
    const farFront = makeLeg(fx - 3, true), farBack = makeLeg(bx + 3, true);
    this.legs = [nearFront, nearBack, farFront, farBack];

    const bodyG = new Graphics();
    if (L.body) L.body(bodyG, L);
    else {
      blob(bodyG, 0, 0, L.len / 2, L.bodyH / 2, 0, L.coat);
      blob(bodyG, 2, L.bodyH * 0.2, L.len * 0.34, L.bodyH * 0.26, 0, L.belly, 0.85);
    }
    const tailG = new Graphics();
    L.tail(tailG, L);
    this.tail.addChild(tailG);
    this.tail.position.set(L.tailAt.x, L.tailAt.y);

    const headG = new Graphics();
    const eye = L.head(headG, L);
    this.eyeShut.moveTo(eye.x - 1.6, eye.y).lineTo(eye.x + 1.6, eye.y + 0.4).stroke({ width: 0.9, color: 0x1d140e });
    this.eyeShut.visible = false;
    this.eyeOpen.circle(eye.x + 0.4, eye.y - 0.4, 0.45).fill({ color: 0xffffff, alpha: 0.8 });
    this.head.addChild(headG, this.eyeOpen, this.eyeShut);
    this.head.position.set(L.neck.x, L.neck.y);

    this.body.addChild(farFront, farBack, this.tail, bodyG, this.head, nearFront, nearBack);
    this.body.y = this.baseY;
    this.root.addChild(this.body);

    for (let i = 0; i < 3; i++) {
      const s = 2 + i * 0.8, ox = i * 5, oy = -i * 6;
      this.zzz.moveTo(ox, oy).lineTo(ox + s, oy).lineTo(ox, oy + s).lineTo(ox + s, oy + s).stroke({ width: 0.9, color: 0xf3eee4, alpha: 0.9 - i * 0.2 });
    }
    this.zzz.visible = false;
    this.zzz.position.set(L.neck.x + 6, this.baseY - L.bodyH * 0.6 - 6);
    this.root.addChild(this.zzz);
  }

  /** Put the animal on a strip of land. */
  placeOn(t: Terrain) {
    this.terrain = t;
    this.scale = this.baseScale * t.scale();
    t.layer.addChild(this.root);
  }

  setState(s: AnimalState) {
    this.state = s;
    if (s === 'idle') this.timer = 3 + Math.random() * 6;
    if (s === 'sleep') this.timer = 20 + Math.random() * 40;
    if (s === 'walk' || s === 'run') {
      // Walks stay near; runs may go anywhere.
      this.target = pickX(this.terrain, s === 'walk' ? this.x : undefined);
      this.timer = 30;
    }
    this.graze = this.L.grazes && s === 'idle' && Math.random() < 0.6 ? 1 : 0;
  }

  /** Walk in from just outside the view. */
  enter() {
    const t = this.terrain;
    const left = Math.random() < 0.5;
    this.x = left ? t.lo() - 40 : t.hi() + 40;
    this.state = 'walk';
    this.target = pickX(t, left ? t.lo() : t.hi());
    this.timer = 60;
  }

  private decide(night: number) {
    const L = this.L;
    const r = Math.random();
    if (night > 0.6 && Math.random() > L.nightOwl) return this.setState('sleep');
    if (r < L.napper) return this.setState('sleep');
    if (r < L.napper + (this.species === 'squirrel' ? 0.25 : 0.08)) return this.setState('run');
    if (r < 0.55) return this.setState('walk');
    this.setState('idle');
  }

  update(dt: number, night: number) {
    const L = this.L;
    const t = this.terrain;
    this.t += dt;
    this.scale = this.baseScale * t.scale();
    const forced = debug.animalState;
    if (forced && this.state !== forced) this.setState(forced);

    // Ridge land repeats: whoever wanders out of view comes round from the other side.
    const period = t.period?.();
    if (period) {
      if (this.x < t.lo() - 80) {
        this.x += period;
        this.target += period;
      } else if (this.x > t.hi() + 80) {
        this.x -= period;
        this.target -= period;
      }
    }

    // Behaviour.
    if (!forced) {
      this.timer -= dt;
      if (this.state === 'sleep' && night < 0.3 && this.timer > 5 && Math.random() < dt * 0.2) this.timer = 0;
      if (this.timer <= 0) this.decide(night);
    }
    let speed = 0;
    if (this.state === 'walk' || this.state === 'run') {
      const v = this.state === 'run' ? L.run : L.walk;
      if (Math.abs(this.target - this.x) < 2) {
        // A forced gait paces back and forth; otherwise arriving means resting.
        if (forced) this.target = pickX(t);
        else this.setState('idle');
      }
      if (this.state === 'walk' || this.state === 'run') {
        this.dir = Math.sign(this.target - this.x) || this.dir;
        speed = v;
        this.x += this.dir * Math.min(Math.abs(this.target - this.x), v * this.scale * dt);
      }
    }

    // Pose.
    const sleeping = this.state === 'sleep';
    this.crouch = lerp(this.crouch, sleeping ? 1 : 0, Math.min(1, dt * 3));
    const k = 1 - this.crouch * 0.78;
    let bob = 0, bodyRot = 0, headRot = 0, tailRot = 0;
    const legRot = [0, 0, 0, 0];

    if (this.state === 'walk' || this.state === 'run') {
      const run = this.state === 'run';
      const freq = speed / (L.leg * (run ? 2.2 : 1.6) + 4);
      this.ph += dt * freq * Math.PI * 2;
      const amp = run ? 0.85 : 0.4;
      if (L.gait === 'bound' || (run && (this.species === 'squirrel' || this.species === 'beaver'))) {
        const f = Math.sin(this.ph) * amp, b = Math.sin(this.ph + Math.PI * 0.7) * amp;
        legRot[0] = legRot[2] = f;
        legRot[1] = legRot[3] = b;
        bob = -Math.abs(Math.sin(this.ph)) * L.leg * (run ? 1.4 : 0.6);
        bodyRot = Math.cos(this.ph) * 0.12;
      } else {
        const s = Math.sin(this.ph) * amp;
        legRot[0] = s;
        legRot[3] = s;
        legRot[1] = -s;
        legRot[2] = -s;
        bob = -Math.abs(Math.cos(this.ph)) * (run ? L.leg * 0.18 : 1.2);
        bodyRot = run ? Math.sin(this.ph * 2) * 0.03 : 0;
      }
      headRot = Math.sin(this.ph * 2) * (run ? 0.06 : 0.04) - (run ? 0.08 : 0);
      tailRot = run ? -0.35 + Math.sin(this.ph * 2) * 0.1 : Math.sin(this.ph) * 0.12;
    } else if (this.state === 'idle') {
      headRot = this.graze ? 0.55 + Math.sin(this.t * 3) * 0.04 : Math.sin(this.t * 0.6) * 0.12;
      tailRot = Math.sin(this.t * (this.species === 'squirrel' ? 6 : 2)) * (this.species === 'wolf' ? 0.18 : 0.08);
      if (this.graze && Math.random() < dt * 0.15) this.graze = 0;
      else if (!this.graze && L.grazes && Math.random() < dt * 0.1) this.graze = 1;
    } else {
      headRot = 0.32;
      tailRot = 0.25;
    }

    this.body.y = this.baseY + L.leg * (1 - k) + bob * (1 - this.crouch);
    this.body.rotation = bodyRot * (1 - this.crouch);
    this.body.scale.y = 1 + Math.sin(this.t * (sleeping ? 0.9 : 1.6)) * (sleeping ? 0.03 : 0.012);
    this.legs.forEach((leg, i) => {
      leg.rotation = legRot[i] * (1 - this.crouch);
      leg.scale.y = k;
    });
    this.head.rotation = lerp(this.head.rotation, headRot, Math.min(1, dt * 6));
    this.tail.rotation = lerp(this.tail.rotation, tailRot, Math.min(1, dt * 8));

    // Eyes and zzz.
    this.blink -= dt;
    const blinking = this.blink < 0.12;
    if (this.blink <= 0) this.blink = 2 + Math.random() * 4;
    const shut = this.crouch > 0.6 || blinking;
    this.eyeShut.visible = shut;
    this.eyeOpen.visible = !shut;
    this.zzz.visible = this.crouch > 0.9;
    if (this.zzz.visible) {
      this.zzz.alpha = 0.5 + 0.5 * Math.sin(this.t * 1.5);
      this.zzz.y = this.baseY + L.leg * 0.6 - L.bodyH * 0.6 - 6 - ((this.t * 4) % 6);
    }

    this.root.x = this.x;
    this.root.y = t.y(this.x);
    // Lean with the slope a little.
    const slope = (t.y(this.x + 6 * this.scale) - t.y(this.x - 6 * this.scale)) / (12 * this.scale);
    this.root.rotation = Math.max(-0.35, Math.min(0.35, Math.atan(slope) * 0.6));
    this.root.scale.set(this.dir * this.scale, this.scale);
    this.zzz.scale.x = this.dir;
  }

  destroy() {
    this.root.destroy({ children: true });
  }
}

/** All the animals that have gathered, spread over the ground and the ridges. */
export class Herd {
  private animals: Animal[] = [];
  private started = false;

  constructor(private terrains: Terrain[]) {}

  private pickTerrain(): Terrain {
    const total = this.terrains.reduce((a, t) => a + t.weight, 0);
    let r = Math.random() * total;
    for (const t of this.terrains) if ((r -= t.weight) <= 0) return t;
    return this.terrains[0];
  }

  /** Match the herd to an inukshuk's age. New arrivals walk in once the view is live. */
  sync(age: number) {
    const want: string[] = [];
    for (const a of ARRIVALS) if (age >= a.days) for (let i = 0; i < a.count; i++) want.push(a.species + i);
    for (const a of [...this.animals])
      if (!want.includes(a.id)) {
        a.destroy();
        this.animals.splice(this.animals.indexOf(a), 1);
      }
    for (const a of ARRIVALS)
      for (let i = 0; i < a.count; i++) {
        if (age < a.days || this.animals.some((x) => x.id === a.species + i)) continue;
        const animal = new Animal(a.species, i);
        // A wolf pack keeps together.
        const pack = a.species === 'wolf' && i > 0 ? this.animals.find((x) => x.id === 'wolf0')?.terrain : undefined;
        animal.placeOn(pack ?? this.pickTerrain());
        if (this.started) animal.enter();
        else {
          animal.x = pickX(animal.terrain);
          animal.setState('idle');
        }
        this.animals.push(animal);
      }
    this.started = true;
  }

  update(dt: number, night: number) {
    for (const a of this.animals) a.update(dt, night);
  }

  destroy() {
    for (const a of this.animals) a.destroy();
    this.animals = [];
  }
}

/**
 * The three ridges as terrain, far to near. Ridge animals are drawn in screen pixels, so they are
 * sized by the figure's zoom (`zoom`) and shrink with distance.
 */
export function ridgeTerrains(scenery: Scenery, zoom: () => number): Terrain[] {
  const depth = [0.24, 0.34, 0.46];
  return [0.13, 0.22, 0.3].map((weight, i) => ({
    layer: scenery.ridgeAnimals[i],
    weight,
    scale: () => zoom() * depth[i],
    lo: () => scenery.ridgeView(i)[0],
    hi: () => scenery.ridgeView(i)[1],
    y: (x: number) => scenery.ridgeY(i, x),
    period: () => scenery.period,
  }));
}
