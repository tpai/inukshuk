// Turns a free-form stack of stones into a six-bone figure, and animates it.

import { Container, Graphics } from 'pixi.js';
import { type PlacedStone, stoneShape, drawStone, type Weather } from './stone';
import { type Vec, transform, bounds, polyDistance, outwardNormal, pointInConvex, clamp } from './util';

export type Bone = 'body' | 'head' | 'armL' | 'armR' | 'legL' | 'legR';
export const BONES: Bone[] = ['legL', 'legR', 'body', 'armL', 'armR', 'head'];

export type Verdict =
  | { ok: true; bones: Bone[]; pivots: Record<Bone, Vec | null> }
  | { ok: false; reason: 'empty' | 'legs' | 'body' };

const TOUCH = 2.2;

interface Info {
  poly: Vec[];
  cx: number;
  cy: number;
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
  w: number;
}

export function worldPoly(s: PlacedStone): Vec[] {
  return transform(stoneShape(s.style, s.seed).poly, s.x, s.y, s.angle);
}

/** Pure geometry, so it works the same on a live build and on a stack decoded from a link. */
export function classify(stones: PlacedStone[]): Verdict {
  if (!stones.length) return { ok: false, reason: 'empty' };
  const info: Info[] = stones.map((s) => {
    const poly = worldPoly(s);
    const b = bounds(poly);
    return { poly, cx: s.x, cy: s.y, minX: b.minX, maxX: b.maxX, minY: b.minY, maxY: b.maxY, w: b.w };
  });
  const n = info.length;
  const touch: boolean[][] = info.map(() => new Array(n).fill(false));
  for (let i = 0; i < n; i++)
    for (let j = i + 1; j < n; j++) {
      const near =
        info[i].maxX + TOUCH >= info[j].minX && info[j].maxX + TOUCH >= info[i].minX &&
        info[i].maxY + TOUCH >= info[j].minY && info[j].maxY + TOUCH >= info[i].minY;
      if (near && polyDistance(info[i].poly, info[j].poly) < TOUCH) touch[i][j] = touch[j][i] = true;
    }

  // Ground clusters: stones on the ground that touch each other count as one foot.
  const grounded = info.map((s) => s.maxY > -TOUCH);
  const cluster = new Array(n).fill(-1);
  let clusters = 0;
  for (let i = 0; i < n; i++) {
    if (!grounded[i] || cluster[i] >= 0) continue;
    const stack = [i];
    cluster[i] = clusters;
    while (stack.length) {
      const k = stack.pop()!;
      for (let j = 0; j < n; j++)
        if (grounded[j] && cluster[j] < 0 && touch[k][j]) {
          cluster[j] = clusters;
          stack.push(j);
        }
    }
    clusters++;
  }
  if (clusters < 2) return { ok: false, reason: 'legs' };

  // Which ground clusters ultimately hold each stone up.
  const order = [...info.keys()].sort((a, b) => info[b].cy - info[a].cy);
  const roots: Set<number>[] = info.map(() => new Set());
  const supporters = (j: number) => [...info.keys()].filter((i) => touch[i][j] && info[i].cy > info[j].cy + 1);
  for (const j of order) {
    if (grounded[j]) roots[j].add(cluster[j]);
    for (const i of supporters(j)) roots[i].forEach((r) => roots[j].add(r));
  }

  // A body bridges a gap: it sits clear of the ground with a foot cluster on either side of it.
  const clusterX = Array.from({ length: clusters }, (_, c) => {
    const ids = [...info.keys()].filter((i) => cluster[i] === c);
    return ids.reduce((a, i) => a + info[i].cx, 0) / ids.length;
  });
  const candidates = order.filter((j) => {
    if (grounded[j] || roots[j].size < 2 || info[j].maxY > -12) return false;
    const xs = [...roots[j]].map((c) => clusterX[c]);
    return xs.some((x) => x < info[j].cx) && xs.some((x) => x > info[j].cx);
  });
  if (!candidates.length) return { ok: false, reason: 'body' };
  const body = candidates[0];
  const B = info[body];

  // Everything resting on the body (transitively).
  const above = new Set<number>();
  const queue = [body];
  while (queue.length) {
    const i = queue.shift()!;
    for (let j = 0; j < n; j++)
      if (j !== body && !above.has(j) && touch[i][j] && info[j].cy < info[i].cy - 1) {
        above.add(j);
        queue.push(j);
      }
  }

  const bones: Bone[] = new Array(n).fill('body');
  const half = B.w / 2;
  for (let i = 0; i < n; i++) {
    if (i === body || above.has(i)) continue;
    bones[i] = info[i].cx < B.cx ? 'legL' : 'legR';
  }

  const central: number[] = [];
  for (const i of above) {
    const off = info[i].cx - B.cx;
    if (Math.abs(off) > half * 0.55 && (off < 0 ? info[i].maxX < B.cx : info[i].minX > B.cx)) {
      bones[i] = off < 0 ? 'armL' : 'armR';
    } else central.push(i);
  }
  // Stones resting only on an arm move with that arm.
  for (const i of above) {
    if (bones[i] !== 'body') continue;
    const sup = supporters(i);
    if (sup.length && sup.every((k) => bones[k] === 'armL')) bones[i] = 'armL';
    else if (sup.length && sup.every((k) => bones[k] === 'armR')) bones[i] = 'armR';
  }

  // The head: the narrow stone(s) at the very top of the central column.
  const centralTop = central.filter((i) => bones[i] === 'body').sort((a, b) => info[a].cy - info[b].cy);
  const widest = Math.max(B.w, ...centralTop.map((i) => info[i].w));
  const head: number[] = [];
  for (const i of centralTop) {
    if (info[i].w > widest * 0.8) break;
    if (head.length && !head.some((h) => touch[h][i])) break;
    head.push(i);
  }
  for (const i of head) bones[i] = 'head';

  // Pivots.
  const of = (b: Bone) => [...info.keys()].filter((i) => bones[i] === b);
  const pivots: Record<Bone, Vec | null> = { body: { x: B.cx, y: B.cy }, head: null, armL: null, armR: null, legL: null, legR: null };
  for (const leg of ['legL', 'legR'] as const) {
    const ids = of(leg);
    if (!ids.length) continue;
    const top = Math.min(...ids.map((i) => info[i].minY));
    const cx = ids.reduce((a, i) => a + info[i].cx, 0) / ids.length;
    pivots[leg] = { x: cx, y: top + 3 };
  }
  for (const arm of ['armL', 'armR'] as const) {
    const ids = of(arm);
    if (!ids.length) continue;
    const cy = ids.reduce((a, i) => a + info[i].cy, 0) / ids.length;
    const inner = arm === 'armL' ? Math.max(...ids.map((i) => info[i].maxX)) : Math.min(...ids.map((i) => info[i].minX));
    pivots[arm] = { x: arm === 'armL' ? Math.min(inner, B.cx - half * 0.3) : Math.max(inner, B.cx + half * 0.3), y: cy };
  }
  if (head.length) {
    const bottom = Math.max(...head.map((i) => info[i].maxY));
    const cx = head.reduce((a, i) => a + info[i].cx, 0) / head.length;
    pivots.head = { x: cx, y: bottom };
  }
  return { ok: true, bones, pivots };
}

// ---------------------------------------------------------------------------

export type Motion = 'idle' | 'walk' | 'jump' | 'still';

interface Part {
  bone: Bone;
  c: Container;
  pivot: Vec;
  wob: number;
  wobV: number;
  side: number;
  stones: number[];
}

export interface Perch {
  part: Container;
  bone: Bone;
  local: Vec; // in part-local coords
}

/**
 * Container hierarchy: root (bob/jump) → body part → [arms, head]; legs sit under root too,
 * so the body can lift between steps while the feet stay planted.
 */
export class Rig {
  root = new Container();
  private parts = new Map<Bone, Part>();
  private t = 0;
  private prevY = 0;
  private prevV = 0;
  motion: Motion = 'idle';
  jumpPhase = 0;
  readonly height: number;
  readonly width: number;
  readonly perches: Perch[] = [];
  readonly stoneGraphics: Graphics[] = [];

  constructor(public stones: PlacedStone[], public verdict: Verdict, weather: Weather | null) {
    const bones: Bone[] = verdict.ok ? verdict.bones : stones.map(() => 'body');
    const pivots = verdict.ok ? verdict.pivots : null;

    const order = [...stones.keys()].sort((a, b) => stones[b].y - stones[a].y);
    const bodyPivot = pivots?.body ?? { x: 0, y: -40 };

    const make = (bone: Bone, pivot: Vec, parent: Container, parentOrigin: Vec): Part => {
      const c = new Container();
      c.position.set(pivot.x - parentOrigin.x, pivot.y - parentOrigin.y);
      parent.addChild(c);
      const side = bone === 'armL' || bone === 'legL' ? -1 : bone === 'armR' || bone === 'legR' ? 1 : 0;
      const p: Part = { bone, c, pivot, wob: 0, wobV: 0, side, stones: [] };
      this.parts.set(bone, p);
      return p;
    };

    const rootOrigin = { x: 0, y: 0 };
    // Legs first (drawn behind), then body with arms & head.
    for (const leg of ['legL', 'legR'] as const) if (pivots?.[leg]) make(leg, pivots[leg]!, this.root, rootOrigin);
    const body = make('body', bodyPivot, this.root, rootOrigin);
    for (const b of ['armL', 'armR', 'head'] as const) if (pivots?.[b]) make(b, pivots[b]!, body.c, bodyPivot);

    for (const i of order) {
      const part = this.parts.get(bones[i]) ?? body;
      const s = stones[i];
      const g = new Graphics();
      drawStone(g, stoneShape(s.style, s.seed), s.angle, weather);
      g.position.set(s.x - part.pivot.x, s.y - part.pivot.y);
      g.rotation = s.angle;
      part.c.addChild(g);
      part.stones.push(i);
      this.stoneGraphics[i] = g;
    }

    const all = stones.map(worldPoly);
    const b = bounds(all.flat());
    this.height = -b.minY;
    this.width = b.w;

    // Perches: wide, flat, upward faces that are not covered by another stone.
    stones.forEach((s, i) => {
      const poly = all[i];
      for (let k = 0; k < poly.length; k++) {
        const a = poly[k], c2 = poly[(k + 1) % poly.length];
        const len = Math.hypot(c2.x - a.x, c2.y - a.y);
        if (len < 9) continue;
        const nrm = outwardNormal(a, c2, { x: s.x, y: s.y });
        if (nrm.y > -0.88) continue;
        const mid = { x: (a.x + c2.x) / 2, y: (a.y + c2.y) / 2 };
        const probe = { x: mid.x, y: mid.y - 7 };
        if (all.some((q, j) => j !== i && pointInConvex(probe, q))) continue;
        const part = this.parts.get(bones[i]) ?? body;
        this.perches.push({ part: part.c, bone: part.bone, local: { x: mid.x - part.pivot.x, y: mid.y - part.pivot.y } });
      }
    });
  }

  part(b: Bone) {
    return this.parts.get(b);
  }

  /** A small knock, e.g. when a bird lands. */
  nudge(bone: Bone, amount = 0.05) {
    const p = this.parts.get(bone);
    if (p) p.wobV += amount * (p.side || (Math.random() < 0.5 ? -1 : 1)) * 12;
  }

  update(dt: number) {
    this.t += dt;
    const t = this.t;
    let rootY = 0;
    const pose: Partial<Record<Bone, number>> = {};

    if (this.motion === 'idle') {
      rootY = Math.sin(t * 1.4) * 0.8;
      pose.head = Math.sin(t * 0.7) * 0.03;
      pose.armL = Math.sin(t * 1.1) * 0.025;
      pose.armR = -Math.sin(t * 1.1 + 0.6) * 0.025;
    } else if (this.motion === 'walk') {
      const ph = t * 5.2;
      const sw = Math.sin(ph) * 0.2;
      pose.legL = sw;
      pose.legR = -sw;
      rootY = -Math.abs(Math.cos(ph)) * 5;
      pose.body = Math.sin(ph) * 0.035;
      pose.armL = -sw * 0.6;
      pose.armR = sw * 0.6;
      pose.head = Math.sin(ph * 2) * 0.025;
    } else if (this.motion === 'jump') {
      // crouch 0.22 → air 0.62 → land 0.25 → rest 0.7
      const cycle = 1.79;
      const p = (t % cycle);
      this.jumpPhase = p;
      if (p < 0.22) {
        const k = p / 0.22;
        rootY = Math.sin(k * Math.PI * 0.5) * 7;
        pose.legL = -0.08 * k;
        pose.legR = 0.08 * k;
        pose.armL = 0.12 * k;
        pose.armR = -0.12 * k;
      } else if (p < 0.84) {
        const k = (p - 0.22) / 0.62;
        rootY = 7 * (1 - k) - Math.sin(k * Math.PI) * 78;
        const tuck = Math.sin(k * Math.PI);
        pose.legL = 0.22 * tuck;
        pose.legR = -0.22 * tuck;
        pose.armL = -0.32 * tuck;
        pose.armR = 0.32 * tuck;
        pose.body = Math.sin(k * Math.PI * 2) * 0.04;
      } else if (p < 1.09) {
        const k = (p - 0.84) / 0.25;
        rootY = Math.sin(k * Math.PI) * 6;
        pose.legL = -0.06 * Math.sin(k * Math.PI);
        pose.legR = 0.06 * Math.sin(k * Math.PI);
      }
    }

    // Secondary motion: parts lag behind the root's vertical acceleration.
    const v = (rootY - this.prevY) / Math.max(dt, 1e-3);
    const acc = clamp((v - this.prevV) / Math.max(dt, 1e-3), -6000, 6000);
    this.prevY = rootY;
    this.prevV = v;
    for (const p of this.parts.values()) {
      if (p.bone === 'legL' || p.bone === 'legR') continue;
      const lever = p.side !== 0 ? p.side : p.bone === 'head' ? 0.6 : 0.25;
      const force = -acc * 0.000035 * lever;
      p.wobV += (force - p.wob * 160 - p.wobV * 9) * dt;
      p.wob = clamp(p.wob + p.wobV * dt, -0.16, 0.16);
    }

    this.root.position.set(0, rootY);
    for (const p of this.parts.values()) p.c.rotation = (pose[p.bone] ?? 0) + p.wob;
  }

  destroy() {
    this.root.destroy({ children: true });
  }
}

/** Debug overlay: colour each stone by its bone and mark the pivots. */
export function drawBoneOverlay(g: Graphics, stones: PlacedStone[], verdict: Verdict) {
  const colors: Record<Bone, number> = { body: 0xf2c14e, head: 0x5bc0eb, armL: 0x9bc53d, armR: 0x3cb371, legL: 0xe55934, legR: 0xfa7921 };
  stones.forEach((s, i) => {
    const poly = worldPoly(s).flatMap((p) => [p.x, p.y]);
    const bone = verdict.ok ? verdict.bones[i] : 'body';
    g.poly(poly).stroke({ width: 2, color: colors[bone] });
  });
  if (verdict.ok)
    for (const b of BONES) {
      const p = verdict.pivots[b];
      if (p) g.circle(p.x, p.y, 3.5).fill(colors[b]).circle(p.x, p.y, 3.5).stroke({ width: 1, color: 0x000000 });
    }
}
