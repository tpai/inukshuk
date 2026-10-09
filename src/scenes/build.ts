// Build: pull stones from the tray, stack them under real gravity.

import RAPIER from '@dimforge/rapier2d-compat';
import { Container, Graphics } from 'pixi.js';
import { type Scene, ctx, go, h } from '../app';
import { type Env, debug } from '../env';
import { t, type Key } from '../i18n';
import { Scenery } from '../scenery';
import { type PlacedStone, type StoneStyle, STYLES, stoneShape, drawStone, clampScale } from '../stone';
import { classify, drawBoneOverlay, worldPoly, type Verdict } from '../rig';
import { sound } from '../audio';
import { getSession, freshBatch, draft, saveSession, snapshot, restoreInto, pushHistory, statsOf } from './session';
import { type Vec, pointInConvex, polyDistance, rotate, darken, lighten, mulberry32 } from '../util';

const PPM = 30; // logical px per physics metre
const MAX = 20;
const HALF_W = 200;

interface Live {
  style: StoneStyle;
  seed: number;
  scale: number;
  body: RAPIER.RigidBody;
  collider: RAPIER.Collider;
  g: Graphics;
  drawnAngle: number;
  prevSpeed: number;
  order: number;
}

interface Grab {
  stone: Live;
  pointerId: number;
  offsetLocal: Vec;
  target: Vec;
  angle: number;
  scale: number;
  wheel?: number;
}

const STYLE_KEYS: Record<StoneStyle, Key> = { 0: 'river', 1: 'canyon', 2: 'slate' };

export class BuildScene implements Scene {
  root = new Container();
  private scenery = new Scenery(7);
  private world = new Container();
  private slab = new Graphics();
  private stonesLayer = new Container();
  private overlay = new Graphics();
  private physics: RAPIER.World;
  private stones: Live[] = [];
  private grab: Grab | null = null;
  private pointers = new Map<number, Vec>();
  private twist: { start: number; angle: number; dist: number; scale: number } | null = null;
  private acc = 0;
  private orderCounter = 0;
  private stillFor = 0;
  private verdict: Verdict = { ok: false, reason: 'empty' };
  private verdictKey = '';
  private scale = 1;
  private groundY = 0;
  private trayTop = 0;
  private ui: HTMLElement | null = null;
  private hintEl: HTMLElement | null = null;
  private countEl: HTMLElement | null = null;
  private doneEl: HTMLButtonElement | null = null;
  private undoEl: HTMLButtonElement | null = null;
  private trayEl: HTMLElement | null = null;
  private trashEl: HTMLElement | null = null;
  private overTrash = false;
  private lastHint = '';
  private session = getSession();

  constructor() {
    this.root.addChild(this.scenery.back, this.world, this.scenery.front);
    this.world.addChild(this.slab, this.stonesLayer, this.overlay);

    this.physics = new RAPIER.World({ x: 0, y: 32 });
    this.physics.numSolverIterations = 10;
    const ground = this.physics.createRigidBody(RAPIER.RigidBodyDesc.fixed().setTranslation(0, 5));
    this.physics.createCollider(RAPIER.ColliderDesc.cuboid(40, 5).setFriction(1), ground);
    for (const sx of [-1, 1]) {
      const wall = this.physics.createRigidBody(RAPIER.RigidBodyDesc.fixed().setTranslation((sx * (HALF_W + 20)) / PPM, -20));
      this.physics.createCollider(RAPIER.ColliderDesc.cuboid(20 / PPM, 40), wall);
    }

    for (const s of this.session.stones) this.addStone(s.style, s.seed, { x: s.x, y: s.y }, s.angle, s.scale);

    const canvas = ctx.app.canvas;
    canvas.addEventListener('pointerdown', this.onDown);
    canvas.addEventListener('wheel', this.onWheel, { passive: false });
    window.addEventListener('pointermove', this.onMove);
    window.addEventListener('pointerup', this.onUp);
    window.addEventListener('pointercancel', this.onUp);
    window.addEventListener('keydown', this.onKey);
    document.addEventListener('visibilitychange', saveSession);
  }

  // ---------- stones ----------

  private addStone(style: StoneStyle, seed: number, at: Vec, angle = 0, scale = 1): Live {
    const body = this.physics.createRigidBody(
      RAPIER.RigidBodyDesc.dynamic().setTranslation(at.x / PPM, at.y / PPM).setRotation(angle).setAngularDamping(0.8).setLinearDamping(0.1),
    );
    const collider = this.physics.createCollider(this.colliderDesc(style, seed, scale), body);
    const g = new Graphics();
    drawStone(g, stoneShape(style, seed, scale), angle, null);
    this.stonesLayer.addChild(g);
    const live: Live = { style, seed, scale, body, collider, g, drawnAngle: angle, prevSpeed: 0, order: this.orderCounter++ };
    this.stones.push(live);
    this.syncGraphic(live);
    return live;
  }

  private colliderDesc(style: StoneStyle, seed: number, scale: number) {
    const shape = stoneShape(style, seed, scale);
    const pts = new Float32Array(shape.poly.flatMap((p) => [p.x / PPM, p.y / PPM]));
    return (RAPIER.ColliderDesc.convexHull(pts) ?? RAPIER.ColliderDesc.ball(shape.w / 2 / PPM))
      .setFriction(style === 0 ? 0.7 : 0.95)
      .setRestitution(0.02)
      .setDensity(2.6);
  }

  /** Grow or shrink a stone: new collider, redrawn graphic. */
  private resizeStone(s: Live, scale: number) {
    const groups = s.collider.collisionGroups();
    this.physics.removeCollider(s.collider, true);
    s.collider = this.physics.createCollider(this.colliderDesc(s.style, s.seed, scale), s.body);
    s.collider.setCollisionGroups(groups);
    s.scale = scale;
    s.g.clear();
    drawStone(s.g, stoneShape(s.style, s.seed, scale), s.body.rotation(), null);
    s.drawnAngle = s.body.rotation();
  }

  private removeStone(s: Live, toTray: boolean) {
    if (this.grab?.stone === s) this.grab = null;
    this.physics.removeRigidBody(s.body);
    s.g.destroy();
    this.stones.splice(this.stones.indexOf(s), 1);
    if (toTray) {
      const slots = this.session.tray[s.style];
      const free = slots.indexOf(null);
      if (free >= 0) slots[free] = s.seed;
      this.renderTray();
    }
    this.persist();
  }

  private placed(): PlacedStone[] {
    return this.stones.map((s) => {
      const p = s.body.translation();
      return this.at(s, p.x * PPM, p.y * PPM);
    });
  }

  private at(s: Live, x: number, y: number): PlacedStone {
    const p: PlacedStone = { style: s.style, seed: s.seed, x, y, angle: s.body.rotation() };
    if (s.scale !== 1) p.scale = s.scale;
    return p;
  }

  private persist() {
    this.session.stones = this.placed();
    saveSession();
  }

  private syncGraphic(s: Live) {
    const p = s.body.translation();
    s.g.position.set(p.x * PPM, p.y * PPM);
    s.g.rotation = s.body.rotation();
  }

  // ---------- input ----------

  private toLogical(px: number, py: number): Vec {
    return { x: (px - ctx.w / 2) / this.scale, y: (py - this.groundY) / this.scale };
  }

  private hit(p: Vec): Live | null {
    const sorted = [...this.stones].sort((a, b) => b.order - a.order);
    for (const s of sorted) {
      const tr = s.body.translation();
      const poly = worldPoly(this.at(s, tr.x * PPM, tr.y * PPM));
      if (pointInConvex(p, poly)) return s;
    }
    return null;
  }

  private startGrab(s: Live, pointerId: number, at: Vec) {
    const tr = s.body.translation();
    const angle = s.body.rotation();
    const offWorld = { x: tr.x * PPM - at.x, y: tr.y * PPM - at.y };
    s.body.setBodyType(RAPIER.RigidBodyType.KinematicPositionBased, true);
    // Lifted stones pass over the others, like a stone held in the hand.
    s.collider.setCollisionGroups(0);
    s.g.alpha = 0.92;
    this.grab = { stone: s, pointerId, offsetLocal: rotate(offWorld, -angle), target: { x: tr.x * PPM, y: tr.y * PPM }, angle, scale: s.scale };
    s.order = this.orderCounter++;
    this.stonesLayer.addChild(s.g); // bring to front
  }

  private release() {
    const g = this.grab;
    if (!g) return;
    this.grab = null;
    this.twist = null;
    this.setOverTrash(false);
    this.liftClear(g.stone);
    this.session.moves++;
    g.stone.collider.setCollisionGroups(0xffffffff);
    g.stone.g.alpha = 1;
    g.stone.body.setBodyType(RAPIER.RigidBodyType.Dynamic, true);
    g.stone.body.setLinvel({ x: 0, y: 0 }, true);
    g.stone.body.setAngvel(0, true);
    this.persist();
  }

  /** Raise a released stone until it no longer overlaps any other, so it settles instead of exploding apart. */
  private liftClear(s: Live) {
    const tr = s.body.translation();
    const base = this.at(s, tr.x * PPM, tr.y * PPM);
    const others = this.stones.filter((o) => o !== s).map((o) => {
      const p = o.body.translation();
      return worldPoly(this.at(o, p.x * PPM, p.y * PPM));
    });
    let y = base.y;
    for (let i = 0; i < 200; i++) {
      const poly = worldPoly({ ...base, y });
      if (!others.some((o) => polyDistance(poly, o) < 0.5)) break;
      y -= 2;
    }
    if (y !== base.y) {
      s.body.setTranslation({ x: tr.x, y: y / PPM }, true);
      this.syncGraphic(s);
    }
  }

  private onDown = (e: PointerEvent) => {
    sound.resumeFromGesture();
    this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (this.grab && this.grab.pointerId !== e.pointerId) {
      this.beginTwist();
      return;
    }
    const p = this.toLogical(e.clientX, e.clientY);
    const s = this.hit(p);
    if (s) {
      e.preventDefault();
      this.startGrab(s, e.pointerId, p);
    }
  };

  private beginTwist() {
    if (!this.grab || this.pointers.size < 2) return;
    const [a, b] = [...this.pointers.values()];
    this.twist = { start: Math.atan2(b.y - a.y, b.x - a.x), angle: this.grab.angle, dist: Math.max(10, Math.hypot(b.x - a.x, b.y - a.y)), scale: this.grab.scale };
  }

  private onMove = (e: PointerEvent) => {
    if (!this.pointers.has(e.pointerId)) return;
    this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    const g = this.grab;
    if (!g) return;
    if (this.twist && this.pointers.size >= 2) {
      const [a, b] = [...this.pointers.values()];
      g.angle = this.twist.angle + (Math.atan2(b.y - a.y, b.x - a.x) - this.twist.start);
      // Pinch to resize, in the same gesture as the twist.
      g.scale = clampScale(this.twist.scale * (Math.hypot(b.x - a.x, b.y - a.y) / this.twist.dist));
    }
    if (e.pointerId === g.pointerId) {
      const p = this.toLogical(e.clientX, e.clientY);
      const off = rotate(g.offsetLocal, g.angle);
      g.target = { x: Math.max(-HALF_W + 10, Math.min(HALF_W - 10, p.x + off.x)), y: p.y + off.y };
      this.setOverTrash(this.inTrash(e.clientX, e.clientY));
    }
  };

  private onUp = (e: PointerEvent) => {
    this.pointers.delete(e.pointerId);
    const g = this.grab;
    if (!g) return;
    if (e.pointerId !== g.pointerId) {
      this.twist = null;
      return;
    }
    if (this.inTrash(e.clientX, e.clientY)) {
      this.twist = null;
      this.setOverTrash(false);
      this.removeStone(g.stone, false);
      return;
    }
    // Let go anywhere else, the tray included, and the stone drops onto the slab.
    this.release();
  };

  private onWheel = (e: WheelEvent) => {
    const p = this.toLogical(e.clientX, e.clientY);
    let g = this.grab;
    if (!g) {
      const s = this.hit(p);
      if (!s) return;
      this.startGrab(s, -1, p);
      g = this.grab!;
    }
    e.preventDefault();
    // Ctrl+wheel (also a trackpad pinch) resizes; the plain wheel turns.
    if (e.ctrlKey) g.scale = clampScale(g.scale * Math.exp(-Math.max(-40, Math.min(40, e.deltaY)) * 0.005));
    else g.angle += Math.sign(e.deltaY) * 0.08;
    if (g.pointerId === -1) {
      clearTimeout(g.wheel);
      g.wheel = window.setTimeout(() => this.grab === g && this.release(), 350);
    }
  };

  private onKey = (e: KeyboardEvent) => {
    if (!this.grab) return;
    if (e.key === 'q' || e.key === 'Q') this.grab.angle -= 0.1;
    if (e.key === 'e' || e.key === 'E') this.grab.angle += 0.1;
    if (e.key === '-' || e.key === '_') this.grab.scale = clampScale(this.grab.scale - 0.1);
    if (e.key === '=' || e.key === '+') this.grab.scale = clampScale(this.grab.scale + 0.1);
  };

  private inTrash(x: number, y: number) {
    if (!this.trashEl?.classList.contains('show')) return false;
    const r = this.trashEl.getBoundingClientRect();
    const pad = 12;
    return x >= r.left - pad && x <= r.right + pad && y >= r.top - pad && y <= r.bottom + pad;
  }

  private setOverTrash(over: boolean) {
    if (over === this.overTrash) return;
    this.overTrash = over;
    this.trashEl?.classList.toggle('hot', over);
    if (this.grab) this.grab.stone.g.alpha = over ? 0.45 : 0.92;
  }

  private spawnFromTray(style: StoneStyle, slot: number, e: PointerEvent) {
    if (this.stones.length >= MAX) return;
    const seed = this.session.tray[style][slot];
    if (seed === null) return;
    e.preventDefault();
    sound.resumeFromGesture();
    this.session.tray[style][slot] = null;
    this.session.startedAt ??= Date.now();
    const p = this.toLogical(e.clientX, e.clientY);
    const shape = stoneShape(style, seed);
    const at = { x: Math.max(-HALF_W + 20, Math.min(HALF_W - 20, p.x)), y: Math.min(p.y, -Math.max(shape.w, shape.h) / 2 - 30) };
    const s = this.addStone(style, seed, at, this.session.angle);
    this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    this.startGrab(s, e.pointerId, { x: at.x, y: at.y });
    this.renderTray();
  }

  // ---------- UI ----------

  render(ui: HTMLElement) {
    this.ui = ui;
    ui.replaceChildren();
    const s = this.session;
    this.countEl = h('span.count', { 'aria-live': 'polite' });
    this.hintEl = h('p.hint', { 'aria-live': 'polite' });
    this.doneEl = h('button.pebble.done', { onclick: () => this.finish(), disabled: true }, t('done'));
    this.trayEl = h('div.tray-stones');
    this.trashEl = h('div.trash', { role: 'img', 'aria-label': t('trash') });
    this.trashEl.innerHTML = TRASH_SVG;

    const tabs = h(
      'div.tabs',
      { role: 'tablist' },
      ...STYLES.map((st) =>
        h('button.tab', {
          role: 'tab',
          'aria-selected': String(s.style === st),
          onclick: () => {
            s.style = st;
            this.render(ui);
          },
        }, t(STYLE_KEYS[st])),
      ),
    );

    ui.append(
      h('header.bar',
        {},
        h('button.text-btn', { onclick: () => go('#/') }, '‹ ' + t('back')),
        h('div.bar-actions', {},
          (this.undoEl = h('button.text-btn', { onclick: () => this.undo() }, t('undo'))),
          h('button.text-btn', { onclick: () => this.clearAll() }, t('clear')),
        ),
      ),
      this.hintEl,
      this.trashEl,
      h('section.tray', { 'aria-label': t(STYLE_KEYS[s.style]) },
        h('div.tray-head', {}, tabs, h('button.text-btn', { onclick: () => this.reroll() }, t('reroll'))),
        this.trayEl,
        h('div.tray-foot', {},
          this.countEl,
          h('button.text-btn', { onclick: () => this.turnTray(-1) }, t('turnLeft')),
          h('button.text-btn', { onclick: () => this.turnTray(1) }, t('turnRight')),
        ),
        this.doneEl,
      ),
    );
    this.renderTray();
    this.lastHint = '';
    requestAnimationFrame(() => this.resize(ctx.w, ctx.h));
  }

  private renderTray() {
    if (!this.trayEl) return;
    const style = this.session.style;
    const full = this.stones.length >= MAX;
    this.trayEl.replaceChildren(
      ...this.session.tray[style].map((seed, i) => {
        if (seed === null) return h('div.slot.empty', { 'aria-hidden': 'true' });
        const btn = h('button.slot', {
          'aria-label': t(STYLE_KEYS[style]) + ' ' + (i + 1),
          disabled: full,
          onpointerdown: (e: PointerEvent) => this.spawnFromTray(style, i, e),
        });
        const img = thumbnail(style, seed);
        img.style.transform = `rotate(${this.session.angle}rad)`;
        btn.append(img);
        return btn;
      }),
    );
  }

  /** Turn every stone in the tray by 45°; stones come out at that angle. */
  private turnTray(dir: number) {
    const step = Math.PI / 4;
    this.session.angle = (Math.round(this.session.angle / step) + dir + 8) % 8 * step;
    this.trayEl?.querySelectorAll<HTMLImageElement>('.slot img').forEach((img) => (img.style.transform = `rotate(${this.session.angle}rad)`));
  }

  private reroll() {
    this.session.tray[this.session.style] = freshBatch();
    this.renderTray();
  }

  /** Key of a layout, coarse enough that physics jitter doesn't count as a change. */
  private layoutKey(stones: PlacedStone[]) {
    return stones.map((p) => `${p.seed}:${Math.round(p.x)}:${Math.round(p.y)}:${p.angle.toFixed(2)}:${p.scale ?? 1}`).join('|');
  }

  /** Record the current layout as a save point once the stack has settled. */
  private checkpoint() {
    const h = this.session.history;
    const snap = snapshot(this.session);
    if (h.length && this.layoutKey(h[h.length - 1].stones) === this.layoutKey(snap.stones)) return;
    pushHistory(this.session, snap);
    saveSession();
  }

  /** Go back to the last stable state, e.g. right after the stack collapsed. */
  private undo() {
    if (this.grab) this.release();
    this.persist();
    const h = this.session.history;
    const current = this.layoutKey(this.session.stones);
    // If what stands now is already saved, step back past it.
    if (h.length > 1 && this.layoutKey(h[h.length - 1].stones) === current) h.pop();
    const target = h[h.length - 1];
    if (!target) return;
    this.session.undos++;
    for (const s of [...this.stones]) this.removeStone(s, false);
    restoreInto(this.session, target);
    for (const p of this.session.stones) this.addStone(p.style, p.seed, { x: p.x, y: p.y }, p.angle, p.scale);
    this.stillFor = 0;
    this.renderTray();
    saveSession();
  }

  private clearAll() {
    for (const s of [...this.stones]) this.removeStone(s, true);
  }

  private finish() {
    if (!this.verdict.ok || this.stillFor < 2) return;
    this.persist();
    draft.stones = this.placed();
    draft.created = Date.now();
    draft.stats = statsOf(this.session, draft.created);
    go('#/draft');
  }

  resize(w: number, hgt: number) {
    const tray = this.ui?.querySelector('.tray');
    const bar = this.ui?.querySelector('.hint');
    this.trayTop = tray ? tray.getBoundingClientRect().top : hgt - 200;
    const top = bar ? bar.getBoundingClientRect().bottom : 90;
    this.groundY = this.trayTop - 22;
    if (this.trashEl) this.trashEl.style.bottom = hgt - this.trayTop + 14 + 'px';
    this.scale = Math.max(0.5, Math.min(w / (HALF_W * 2 + 30), (this.groundY - top - 10) / 470, 1.6));
    this.world.position.set(w / 2, this.groundY);
    this.world.scale.set(this.scale);
    this.scenery.reserveTop = this.ui?.querySelector('.hint')?.getBoundingClientRect().bottom ?? 0;
    this.scenery.resize(w, hgt, this.groundY + 6 * this.scale);
    this.drawSlab();
  }

  private drawSlab() {
    const r = mulberry32(4);
    const pts: number[] = [];
    const base = 0x9b8f80;
    for (let x = -HALF_W - 6; x <= HALF_W + 6; x += 20) pts.push(x, -1 + r() * 1.5);
    pts.push(HALF_W + 2, 14, HALF_W - 10, 22, -HALF_W + 8, 22, -HALF_W - 2, 13);
    this.slab.clear().poly(pts).fill(base);
    this.slab.rect(-HALF_W + 4, 0, HALF_W * 2 - 8, 3).fill({ color: lighten(base, 0.25), alpha: 0.6 });
    this.slab.poly(pts).stroke({ width: 1.2, color: darken(base, 0.4), alpha: 0.5 });
  }

  // ---------- loop ----------

  update(dt: number, env: Env) {
    // The clock runs only while someone is actually building.
    if (this.session.startedAt !== null) this.session.activeMs += dt * 1000;
    this.scenery.update(dt, env);
    this.world.tint = this.scenery.light;

    const g = this.grab;
    if (g) {
      const b = g.stone.body;
      const cur = b.translation();
      const k = 0.5;
      b.setNextKinematicTranslation({ x: (cur.x * PPM + (g.target.x - cur.x * PPM) * k) / PPM, y: (cur.y * PPM + (g.target.y - cur.y * PPM) * k) / PPM });
      b.setNextKinematicRotation(b.rotation() + (g.angle - b.rotation()) * 0.5);
      if (g.scale !== g.stone.scale) this.resizeStone(g.stone, g.scale);
      // Keep a held stone above the slab, however big it has grown.
      const shape = stoneShape(g.stone.style, g.stone.seed, g.stone.scale);
      g.target.y = Math.min(-Math.max(shape.w, shape.h) / 2 - 2, g.target.y);
    }

    this.acc += Math.min(dt, 0.1);
    const step = 1 / 60;
    while (this.acc >= step) {
      this.physics.step();
      this.acc -= step;
    }

    let moving = false;
    for (const s of [...this.stones]) {
      const tr = s.body.translation();
      if (tr.y * PPM > 60 || Math.abs(tr.x * PPM) > HALF_W + 80) {
        this.removeStone(s, true);
        continue;
      }
      this.syncGraphic(s);
      const v = s.body.linvel();
      const speed = Math.hypot(v.x, v.y);
      const held = this.grab?.stone === s;
      if (!held) {
        if (speed > 0.12 || Math.abs(s.body.angvel()) > 0.15) moving = true;
        if (s.prevSpeed > 1.4 && speed < s.prevSpeed * 0.45) sound.clack(s.prevSpeed / 7);
        if (speed < 0.05 && Math.abs(s.body.rotation() - s.drawnAngle) > 0.35) {
          s.g.clear();
          drawStone(s.g, stoneShape(s.style, s.seed, s.scale), s.body.rotation(), null);
          s.drawnAngle = s.body.rotation();
        }
      }
      s.prevSpeed = held ? 0 : speed;
    }
    if (this.grab) moving = true;
    const wasStill = this.stillFor;
    this.stillFor = moving ? 0 : this.stillFor + dt;
    if (wasStill < 0.6 && this.stillFor >= 0.6) {
      this.persist();
      this.checkpoint();
    }

    const placed = this.placed();
    const key = placed.map((p) => `${p.seed}:${Math.round(p.x)}:${Math.round(p.y)}:${p.angle.toFixed(1)}:${p.scale ?? 1}`).join('|');
    if (key !== this.verdictKey && (this.stillFor > 0.25 || !placed.length)) {
      this.verdictKey = key;
      this.verdict = classify(placed);
    }

    this.updateHud(placed.length);

    this.overlay.clear();
    if (debug.showColliders)
      for (const p of placed) this.overlay.poly(worldPoly(p).flatMap((q) => [q.x, q.y])).stroke({ width: 1, color: 0xff00ff });
    if (debug.showBones) drawBoneOverlay(this.overlay, placed, this.verdict);
  }

  private updateHud(n: number) {
    if (this.countEl) this.countEl.textContent = `${n} / ${MAX}`;
    let hint: Key;
    const ready = this.verdict.ok && this.stillFor >= 2;
    if (n === 0) hint = 'hintStart';
    else if (n >= MAX && !this.verdict.ok) hint = 'hintFull';
    else if (this.grab) hint = 'hintRotate';
    else if (!this.verdict.ok) hint = this.verdict.reason === 'body' ? 'hintBody' : 'hintLegs';
    else hint = ready ? 'hintReady' : 'hintSettle';
    if (hint !== this.lastHint && this.hintEl) {
      this.lastHint = hint;
      this.hintEl.textContent = t(hint);
      this.hintEl.dataset.state = ready ? 'ready' : 'pending';
    }
    if (this.doneEl) this.doneEl.disabled = !ready;
    if (this.undoEl) {
      // Nothing to undo: only the starting save point exists and nothing has changed since.
      const h = this.session.history;
      this.undoEl.disabled = h.length <= 1 && this.layoutKey(this.placed()) === this.layoutKey(h[0]?.stones ?? []);
    }
    this.trashEl?.classList.toggle('show', !!this.grab && this.grab.pointerId !== -1);
    const full = n >= MAX;
    this.trayEl?.classList.toggle('full', full);
    this.trayEl?.querySelectorAll<HTMLButtonElement>('button.slot').forEach((b) => (b.disabled = full));
  }

  destroy() {
    this.persist();
    const canvas = ctx.app.canvas;
    canvas.removeEventListener('pointerdown', this.onDown);
    canvas.removeEventListener('wheel', this.onWheel);
    window.removeEventListener('pointermove', this.onMove);
    window.removeEventListener('pointerup', this.onUp);
    window.removeEventListener('pointercancel', this.onUp);
    window.removeEventListener('keydown', this.onKey);
    document.removeEventListener('visibilitychange', saveSession);
    this.physics.free();
    this.scenery.destroy();
    this.root.destroy({ children: true });
  }
}

const TRASH_SVG =
  '<svg viewBox="0 0 24 24" width="26" height="26" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
  '<path d="M4 7h16"/><path d="M9.5 7V4.8c0-.5.4-.8.8-.8h3.4c.4 0 .8.3.8.8V7"/>' +
  '<path d="M6 7l1 12.2c.1.9.8 1.6 1.7 1.6h6.6c.9 0 1.6-.7 1.7-1.6L18 7"/><path d="M10 11v6"/><path d="M14 11v6"/></svg>';

// ---------- thumbnails ----------

const thumbs = new Map<string, string>();

export function thumbnail(style: StoneStyle, seed: number): HTMLImageElement {
  const key = style + ':' + seed;
  let url = thumbs.get(key);
  if (!url) {
    const g = new Graphics();
    drawStone(g, stoneShape(style, seed), 0, null);
    const canvas = ctx.app.renderer.extract.canvas({ target: g, resolution: 2, antialias: true }) as HTMLCanvasElement;
    url = canvas.toDataURL();
    g.destroy();
    thumbs.set(key, url);
  }
  const shape = stoneShape(style, seed);
  const img = h('img', { src: url, alt: '', draggable: false });
  img.style.width = Math.min(72, shape.w * 0.6 + 4) + 'px';
  return img;
}

let physicsReady: Promise<void> | null = null;
export function initPhysics() {
  physicsReady ??= RAPIER.init();
  return physicsReady;
}
