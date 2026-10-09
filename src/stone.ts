// Procedural stones: every (style, seed) pair is one unique stone.

import { Graphics } from 'pixi.js';
import {
  type Vec, mulberry32, convexHull, centroid, darken, lighten, mix, hex, rotate, bounds,
  pointInConvex, outwardNormal, smoothstep,
} from './util';
import type { Season } from './env';

export type StoneStyle = 0 | 1 | 2; // river, canyon, slate
export const STYLES: StoneStyle[] = [0, 1, 2];

export interface StoneShape {
  style: StoneStyle;
  seed: number;
  poly: Vec[]; // centred on centroid, logical px
  color: number;
  w: number;
  h: number;
}

/** A stone at rest in an inukshuk. Coordinates are logical px: origin at ground centre, y down. */
export interface PlacedStone {
  style: StoneStyle;
  seed: number;
  x: number;
  y: number;
  angle: number;
}

const PALETTES: string[][] = [
  ['#8f8b85', '#9b968e', '#7e8487', '#a39b90', '#737679', '#8a8f8c'],
  ['#ad6843', '#a35f3d', '#bd8058', '#985a3e', '#b67c5b', '#c2946c'],
  ['#676b70', '#5d6267', '#787670', '#575a5f', '#6a6963', '#4f5a5e'],
];

const cache = new Map<string, StoneShape>();

export function stoneShape(style: StoneStyle, seed: number): StoneShape {
  const key = style + ':' + seed;
  const hit = cache.get(key);
  if (hit) return hit;
  const r = mulberry32(seed);
  let pts: Vec[] = [];
  if (style === 0) {
    // River: rounded, egg-ish, smooth.
    const rx = 17 + r() * 17;
    const ry = rx * (0.5 + r() * 0.4);
    const egg = (r() - 0.5) * 0.25;
    const n = 30;
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2;
      const j = 1 + (r() - 0.5) * 0.05;
      const x = Math.cos(a) * rx * j;
      pts.push({ x: x * (1 + egg * Math.sin(a)), y: Math.sin(a) * ry * j });
    }
  } else if (style === 1) {
    // Canyon: few vertices, sharp, chunky.
    const R = 18 + r() * 18;
    const n = 6 + Math.floor(r() * 4);
    const sx = 0.8 + r() * 0.5;
    const angles = Array.from({ length: n }, (_, i) => ((i + r() * 0.7) / n) * Math.PI * 2);
    for (const a of angles) {
      const rad = R * (0.72 + r() * 0.42);
      pts.push({ x: Math.cos(a) * rad * sx, y: Math.sin(a) * rad });
    }
  } else {
    // Slate: long, flat, slightly broken corners.
    const L = 62 + r() * 62;
    const T = 11 + r() * 13;
    const hl = L / 2, ht = T / 2;
    const cut = () => 2 + r() * 7;
    pts.push(
      { x: -hl + cut(), y: -ht }, { x: -hl, y: -ht + cut() * 0.4 },
      { x: -hl + r() * 3, y: ht - cut() * 0.4 }, { x: -hl + cut(), y: ht },
      { x: hl - cut(), y: ht }, { x: hl - r() * 3, y: ht - cut() * 0.4 },
      { x: hl, y: -ht + cut() * 0.4 }, { x: hl - cut(), y: -ht },
    );
    for (let i = 1; i < 4; i++) {
      const x = -hl + (L * i) / 4 + (r() - 0.5) * 8;
      pts.push({ x, y: -ht - r() * 2.5 }, { x, y: ht + r() * 2 });
    }
    const tilt = (r() - 0.5) * 0.12;
    pts = pts.map((p) => rotate(p, tilt));
  }
  let poly = convexHull(pts);
  const c = centroid(poly);
  poly = poly.map((p) => ({ x: p.x - c.x, y: p.y - c.y }));
  const pal = PALETTES[style];
  let color = hex(pal[Math.floor(r() * pal.length)]);
  const shade = (r() - 0.5) * 0.16;
  color = shade > 0 ? lighten(color, shade) : darken(color, -shade);
  const b = bounds(poly);
  const shape: StoneShape = { style, seed, poly, color, w: b.w, h: b.h };
  cache.set(key, shape);
  return shape;
}

export interface Weather {
  ageDays: number;
  season: Season | null; // null: fresh, no seasonal dressing
}

const MOSS = [0x6f7d36, 0x7f8c40, 0x8e9a4a, 0x66733a].map((c) => c);
const LICHEN = [0xcfc79a, 0xbdb98a, 0xd8d3b4, 0xa9ab7a];
const LEAVES = [0xc4632e, 0xd79a3a, 0x9b4a2a, 0xb87a2f];

/**
 * Draw a stone into `g` in its own local frame. `angle` is the stone's world rotation, used so that
 * light comes from the sky and moss/snow settle on faces that point up in the world.
 */
export function drawStone(g: Graphics, s: StoneShape, angle: number, weather: Weather | null) {
  const age = weather?.ageDays ?? 0;
  const aged = smoothstep(0, 30, age);
  const base = mix(s.color, 0x55553f, aged * 0.14);
  const flat = s.poly.flatMap((p) => [p.x, p.y]);
  const toLocal = (v: Vec) => rotate(v, -angle);

  // Base silhouette in shadow tone.
  g.poly(flat).fill(darken(base, 0.24));

  // Lit body, nudged toward the sky.
  const up = toLocal({ x: -0.6, y: -1.4 });
  g.poly(s.poly.flatMap((p) => [p.x * 0.95 + up.x, p.y * 0.95 + up.y])).fill(base);

  // Soft highlight from the upper left.
  const hl = toLocal({ x: -s.w * 0.12, y: -s.h * 0.16 });
  const hs = s.style === 2 ? 0.7 : 0.55;
  g.poly(s.poly.flatMap((p) => [p.x * hs + hl.x, p.y * hs + hl.y])).fill({ color: lighten(base, 0.2), alpha: 0.45 });

  const r = mulberry32(s.seed ^ 0x9e3779b9);
  const inside = (p: Vec) => pointInConvex(p, s.poly.map((q) => ({ x: q.x * 0.88, y: q.y * 0.88 })));
  const randomInside = (): Vec | null => {
    for (let k = 0; k < 12; k++) {
      const p = { x: (r() - 0.5) * s.w, y: (r() - 0.5) * s.h };
      if (inside(p)) return p;
    }
    return null;
  };

  // Grain.
  const grain = s.style === 1 ? 16 : 10;
  for (let i = 0; i < grain; i++) {
    const p = randomInside();
    if (!p) continue;
    const dark = r() < 0.5;
    g.circle(p.x, p.y, 0.6 + r() * 0.9).fill({ color: dark ? darken(base, 0.3) : lighten(base, 0.3), alpha: 0.5 });
  }

  // Strata for slate and canyon stones.
  if (s.style !== 0) {
    const lines = s.style === 2 ? 2 : 1 + Math.floor(r() * 2);
    for (let i = 0; i < lines; i++) {
      const y = (r() - 0.5) * s.h * 0.6;
      const pts: number[] = [];
      for (let x = -s.w / 2; x <= s.w / 2; x += 4) {
        const p = { x, y: y + Math.sin(x * 0.15 + i) * 0.8 };
        if (inside(p)) pts.push(p.x, p.y);
      }
      if (pts.length >= 4) g.poly(pts, false).stroke({ width: 0.8, color: darken(base, 0.18), alpha: 0.55 });
    }
  }

  g.poly(flat).stroke({ width: 1.1, color: darken(base, 0.42), alpha: 0.55 });

  if (!weather) return;

  // Lichen speckles arrive first.
  const lichenCount = Math.round(smoothstep(0.5, 14, age) * (2 + s.w / 20));
  for (let i = 0; i < lichenCount; i++) {
    const p = randomInside();
    if (!p) continue;
    const rad = 0.8 + r() * 1.6;
    const col = LICHEN[Math.floor(r() * LICHEN.length)];
    g.circle(p.x, p.y, rad).fill({ color: col, alpha: 0.6 });
    if (r() < 0.6) g.circle(p.x + rad * 0.9, p.y + rad * 0.4, rad * 0.7).fill({ color: col, alpha: 0.5 });
  }

  // Moss and snow gather on faces that point toward the sky.
  const center = { x: 0, y: 0 };
  const moss = smoothstep(4, 30, age);
  const top: [Vec, Vec, Vec][] = [];
  for (let i = 0; i < s.poly.length; i++) {
    const a = s.poly[i], b = s.poly[(i + 1) % s.poly.length];
    const n = outwardNormal(a, b, center);
    const wn = rotate(n, angle);
    if (wn.y < -0.45) top.push([a, b, n]);
  }

  if (moss > 0) {
    for (const [a, b, n] of top) {
      const len = Math.hypot(b.x - a.x, b.y - a.y);
      const steps = Math.max(1, Math.floor(len / 2.6));
      for (let i = 0; i <= steps; i++) {
        if (r() > moss) continue;
        const t = i / steps;
        const x = a.x + (b.x - a.x) * t - n.x * 1.2;
        const y = a.y + (b.y - a.y) * t - n.y * 1.2;
        g.circle(x, y, 1.6 + r() * 2.2 * (0.5 + moss)).fill(MOSS[Math.floor(r() * MOSS.length)]);
      }
    }
  }

  if (weather.season === 'winter') {
    const upL = toLocal({ x: 0, y: -1 });
    for (const [a, b] of top) {
      const th = 4 + r() * 3;
      const mid = { x: (a.x + b.x) / 2 + upL.x * th * 0.6, y: (a.y + b.y) / 2 + upL.y * th * 0.6 };
      g.poly([
        a.x, a.y,
        a.x + upL.x * th * 0.6, a.y + upL.y * th * 0.6,
        mid.x + upL.x * th * 0.5, mid.y + upL.y * th * 0.5,
        b.x + upL.x * th * 0.6, b.y + upL.y * th * 0.6,
        b.x, b.y,
      ]).fill(0xf3f5f6);
      g.circle(a.x, a.y, th * 0.45).fill(0xf3f5f6);
      g.circle(b.x, b.y, th * 0.45).fill(0xf3f5f6);
    }
  }

  if (weather.season === 'autumn' && r() < 0.4 && top.length) {
    const [a, b] = top[Math.floor(r() * top.length)];
    const t = 0.2 + r() * 0.6;
    const x = a.x + (b.x - a.x) * t, y = a.y + (b.y - a.y) * t;
    const rot = r() * Math.PI;
    const leaf: number[] = [];
    for (let i = 0; i < 10; i++) {
      const p = rotate({ x: Math.cos((i / 10) * Math.PI * 2) * 3.6, y: Math.sin((i / 10) * Math.PI * 2) * 1.8 }, rot);
      leaf.push(x + p.x, y + p.y);
    }
    g.poly(leaf).fill(LEAVES[Math.floor(r() * LEAVES.length)]);
  }
}
