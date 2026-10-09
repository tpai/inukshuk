// Birds that drop by, perch on the inukshuk, and leave when it moves.

import { Container, Graphics } from 'pixi.js';
import type { Rig, Perch } from './rig';
import { sound } from './audio';
import { lerp } from './util';

type State = 'in' | 'perched' | 'out';

interface Bird {
  c: Container;
  body: Graphics;
  wing: Graphics;
  state: State;
  perch: Perch;
  from: { x: number; y: number };
  t: number;
  stay: number;
  dur: number;
  peck: number;
}

const COLORS = [0x4a4440, 0x6b5a4a, 0x3d4650, 0x7a5b45];

function makeBird(): { c: Container; body: Graphics; wing: Graphics } {
  const c = new Container();
  const col = COLORS[Math.floor(Math.random() * COLORS.length)];
  const body = new Graphics();
  body.poly([-7, -3, -12, -1, -7, 0]).fill(col); // tail
  body.ellipse(0, -4, 6.5, 4).fill(col);
  body.circle(5, -8, 3.4).fill(col);
  body.poly([8, -8.5, 11.5, -7.6, 8, -6.8]).fill(0xd9a441);
  body.circle(6, -8.8, 0.8).fill(0xf4efe6);
  body.ellipse(1, -2.6, 4, 2).fill({ color: 0xe8dccb, alpha: 0.5 });
  body.moveTo(-1, 0).lineTo(-2, 3).moveTo(2, 0).lineTo(2.5, 3).stroke({ width: 0.8, color: 0x5a4a3a });
  const wing = new Graphics().ellipse(0, 0, 6, 2.6).fill(mixDark(col));
  wing.position.set(-1, -5);
  c.addChild(body, wing);
  return { c, body, wing };
}

function mixDark(c: number) {
  return (((c >> 16) & 255) * 0.8) << 16 | (((c >> 8) & 255) * 0.8) << 8 | ((c & 255) * 0.8);
}

export class Birds {
  private birds: Bird[] = [];
  private timer = 3 + Math.random() * 6;
  allowed = true;

  constructor(private layer: Container, private rig: Rig, private viewW: () => number) {}

  setRig(rig: Rig) {
    this.scatter();
    this.rig = rig;
  }

  summon() {
    const free = this.rig.perches.filter((p) => !this.birds.some((b) => b.perch === p));
    if (!free.length || this.birds.length >= 3) return;
    const perch = free[Math.floor(Math.random() * free.length)];
    const { c, body, wing } = makeBird();
    const fromLeft = Math.random() < 0.5;
    const global = this.layer.toLocal(perch.part.toGlobal(perch.local));
    const from = { x: fromLeft ? -40 : this.viewW() + 40, y: global.y - 160 - Math.random() * 80 };
    c.position.set(from.x, from.y);
    c.scale.x = fromLeft ? 1 : -1;
    this.layer.addChild(c);
    this.birds.push({ c, body, wing, state: 'in', perch, from, t: 0, stay: 6 + Math.random() * 12, dur: 1.6 + Math.random() * 0.6, peck: 1 });
  }

  /** Everyone leaves, e.g. when the inukshuk starts walking. */
  scatter() {
    for (const b of this.birds) this.leave(b);
  }

  private leave(b: Bird) {
    if (b.state === 'out') return;
    const g = this.layer.toLocal(b.c.getGlobalPosition());
    const sx = b.c.scale.x;
    this.layer.addChild(b.c);
    b.c.position.set(g.x, g.y);
    b.c.rotation = 0;
    b.c.scale.x = Math.sign(sx) || 1;
    b.state = 'out';
    b.t = 0;
    b.from = { x: g.x, y: g.y };
    if (Math.random() < 0.6) sound.chirp();
  }

  update(dt: number) {
    if (this.allowed) {
      this.timer -= dt;
      if (this.timer <= 0) {
        this.timer = 9 + Math.random() * 16;
        this.summon();
      }
    }
    for (const b of [...this.birds]) {
      b.t += dt;
      if (b.state === 'in') {
        const k = Math.min(1, b.t / b.dur);
        const target = this.layer.toLocal(b.perch.part.toGlobal(b.perch.local));
        const e = 1 - (1 - k) ** 2;
        b.c.position.set(lerp(b.from.x, target.x, e), lerp(b.from.y, target.y, e) - Math.sin(k * Math.PI) * 30);
        b.wing.scale.y = Math.sin(b.t * 30) * (1 - k * 0.7);
        if (k >= 1) {
          b.state = 'perched';
          b.t = 0;
          const sx = b.c.scale.x;
          b.perch.part.addChild(b.c);
          b.c.position.set(b.perch.local.x, b.perch.local.y);
          b.c.scale.x = sx;
          b.wing.scale.y = 1;
          sound.chirp();
        }
      } else if (b.state === 'perched') {
        b.peck -= dt;
        if (b.peck <= 0) {
          b.peck = 0.6 + Math.random() * 2.2;
          const r = Math.random();
          if (r < 0.3) b.c.scale.x *= -1;
          else if (r < 0.45) sound.chirp();
        }
        b.body.rotation = b.peck < 0.18 ? 0.35 : 0;
        if (b.t > b.stay) this.leave(b);
      } else {
        const up = b.t * b.t * 120 + b.t * 60;
        b.c.position.set(b.from.x + b.c.scale.x * b.t * 180, b.from.y - up);
        b.wing.scale.y = Math.sin(b.t * 32);
        if (b.t > 2.5) {
          b.c.destroy({ children: true });
          this.birds.splice(this.birds.indexOf(b), 1);
        }
      }
    }
  }

  destroy() {
    for (const b of this.birds) b.c.destroy({ children: true });
    this.birds = [];
  }
}
