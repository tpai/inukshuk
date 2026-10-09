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
import { type Vec, bounds, pointInConvex, polyDistance, rotate, darken, lighten, mulberry32 } from '../util';

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

/** The selected stone, in editor mode: it floats free of gravity until the player taps elsewhere. */
interface Grab {
  stone: Live;
  /** The pointer pressing it, or -1 while it just floats. */
  pointerId: number;
  /** Where that press began (screen px); it only starts to move once the pointer really travels. */
  downAt: Vec;
  dragging: boolean;
  offsetLocal: Vec;
  target: Vec;
  angle: number;
  scale: number;
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
  /** Two fingers: they turn or resize, whichever the gesture clearly starts as, never both. */
  private pinch: { dist: number; turn: number; scale: number; angle: number; mode: 'turn' | 'size' | null } | null = null;
  /** A press on empty ground while a stone is selected: deselects it on release, unless it became a pinch. */
  private tapOut: number | null = null;
  private editorEl: HTMLElement | null = null;
  private acc = 0;
  private orderCounter = 0;
  private stillFor = 0;
  /** Editor mode: gravity is off for every stone until the player presses Check. */
  private frozen = false;
  /** When the edit in progress should be recorded as an undo step (ms), once the stone has eased into place. */
  private stepAt: number | null = null;
  private verdict: Verdict = { ok: false, reason: 'empty' };
  private verdictKey = '';
  private scale = 1;
  private groundY = 0;
  private trayTop = 0;
  private ui: HTMLElement | null = null;
  private hintEl: HTMLElement | null = null;
  private countEl: HTMLElement | null = null;
  private doneEl: HTMLButtonElement | null = null;
  private checkEl: HTMLButtonElement | null = null;
  private undoEl: HTMLButtonElement | null = null;
  private trayEl: HTMLElement | null = null;
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
    window.addEventListener('pointerdown', this.onAnyDown, true);
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
    if (!this.stones.length) this.frozen = false;
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

  /** Select a stone. The whole world freezes: no stone feels gravity until Check. */
  private select(s: Live) {
    if (this.grab?.stone === s) return;
    this.deselect();
    this.freeze();
    const tr = s.body.translation();
    s.body.setBodyType(RAPIER.RigidBodyType.KinematicPositionBased, false);
    s.g.alpha = 0.92;
    this.grab = {
      stone: s, pointerId: -1, downAt: { x: 0, y: 0 }, dragging: false,
      offsetLocal: { x: 0, y: 0 }, target: { x: tr.x * PPM, y: tr.y * PPM }, angle: s.body.rotation(), scale: s.scale,
    };
    s.order = this.orderCounter++;
    this.stonesLayer.addChild(s.g); // bring to front
  }

  /** Press on the selected stone with a pointer at logical point `at`; it follows once the pointer travels. */
  private startDrag(pointerId: number, at: Vec, screen: Vec, now = false) {
    const g = this.grab;
    if (!g) return;
    const off = { x: g.target.x - at.x, y: g.target.y - at.y };
    g.pointerId = pointerId;
    g.downAt = screen;
    g.offsetLocal = rotate(off, -g.angle);
    if (now) this.beginDrag();
  }

  private beginDrag() {
    const g = this.grab;
    if (!g || g.dragging) return;
    g.dragging = true;
  }

  /** Put the selected stone down where it is. The world stays frozen. */
  private deselect() {
    const g = this.grab;
    if (!g) return;
    this.grab = null;
    this.pinch = null;
    this.tapOut = null;
    g.stone.g.alpha = 1;
    g.stone.body.setBodyType(RAPIER.RigidBodyType.Dynamic, false);
    g.stone.body.setLinvel({ x: 0, y: 0 }, false);
    g.stone.body.setAngvel(0, false);
    this.persist();
  }

  /** Enter editor mode: gravity stops for every stone. */
  private freeze() {
    if (this.frozen) return;
    this.frozen = true;
    // Whatever stands as editing begins is the first step to come back to.
    this.recordStep(false);
  }

  /** Leave editor mode without settling anything (clear). */
  private unfreeze() {
    this.deselect();
    this.stepAt = null;
    this.frozen = false;
  }

  /** Check: leave editor mode and let gravity decide whether the stack stands. */
  private check() {
    if (!this.frozen) return;
    this.deselect();
    this.flushStep();
    // Highest first: wherever two stones overlap, the upper one is lifted clear. Repeat, since a
    // lifted stone can come to overlap one above it.
    for (let pass = 0; pass < 6; pass++) {
      const order = [...this.stones].sort((a, b) => a.body.translation().y - b.body.translation().y);
      if (!order.map((s) => this.liftClear(s)).some(Boolean)) break;
    }
    this.frozen = false;
    this.acc = 0;
    this.stillFor = 0;
    for (const s of this.stones) s.body.wakeUp();
    this.persist();
  }

  /** Mark an edit; it becomes an undo step once things have eased into place (wheel turns etc. coalesce). */
  private markStep() {
    this.stepAt = performance.now() + 250;
  }

  private flushStep() {
    if (this.stepAt !== null) this.recordStep(true);
  }

  /**
   * Save the arrangement as an undo step, so Undo can walk back through an edit one change at a time.
   * `isEdit` false records the state editing began from: undoing to it leaves editor mode.
   */
  private recordStep(isEdit: boolean) {
    this.stepAt = null;
    this.persist();
    const h = this.session.history;
    const snap = snapshot(this.session);
    if (h.length && this.layoutKey(h[h.length - 1].stones) === this.layoutKey(snap.stones)) return;
    pushHistory(this.session, isEdit ? { ...snap, editing: true } : snap);
    if (isEdit) this.session.moves++;
    saveSession();
  }

  /** Raise a stone until it no longer overlaps any other, so it settles instead of exploding apart. Returns whether it moved. */
  private liftClear(s: Live): boolean {
    const tr = s.body.translation();
    const base = this.at(s, tr.x * PPM, tr.y * PPM);
    const others = this.stones.filter((o) => o !== s).map((o) => {
      const p = o.body.translation();
      return worldPoly(this.at(o, p.x * PPM, p.y * PPM));
    });
    // Only a real overlap counts: stones resting on one another sink in a hair, so test a slightly
    // shrunken outline first, and leave a stone that merely touches its neighbours where it is.
    const at = (y: number) => worldPoly({ ...base, y });
    const shrunk = (y: number) =>
      at(y).map((q) => {
        const dx = q.x - base.x, dy = q.y - y, d = Math.hypot(dx, dy) || 1;
        return { x: q.x - (dx / d) * 1.5, y: q.y - (dy / d) * 1.5 };
      });
    let y = base.y;
    if (others.some((o) => polyDistance(shrunk(y), o) === 0))
      for (let i = 0; i < 200; i++) {
        if (!others.some((o) => polyDistance(at(y), o) < 0.5)) break;
        y -= 2;
      }
    if (y === base.y) return false;
    s.body.setTranslation({ x: tr.x, y: y / PPM }, true);
    this.syncGraphic(s);
    return true;
  }

  private onDown = (e: PointerEvent) => {
    sound.resumeFromGesture();
    this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (this.grab && this.pointers.size >= 2) {
      this.beginPinch();
      return;
    }
    const p = this.toLogical(e.clientX, e.clientY);
    const s = this.hit(p);
    if (s) {
      e.preventDefault();
      this.select(s);
      this.startDrag(e.pointerId, p, { x: e.clientX, y: e.clientY });
    } else if (this.grab) {
      // Off the stone: dragging still moves the selected stone (handy when it's small or under a
      // finger); a tap without moving deselects it.
      e.preventDefault();
      this.tapOut = e.pointerId;
      this.startDrag(e.pointerId, p, { x: e.clientX, y: e.clientY });
    }
  };

  /** Any press outside the canvas and the editor bar (header, tray background…) deselects too. */
  private onAnyDown = (e: PointerEvent) => {
    const el = e.target as Element | null;
    if (!this.grab || el === ctx.app.canvas || el?.closest('.editor, .slot')) return;
    this.deselect();
  };

  private beginPinch() {
    if (!this.grab || this.pointers.size < 2) return;
    this.tapOut = null;
    // A drag that hadn't started yet gives way to the two-finger gesture.
    if (!this.grab.dragging) this.grab.pointerId = -1;
    const [a, b] = [...this.pointers.values()];
    this.pinch = { dist: Math.max(10, Math.hypot(b.x - a.x, b.y - a.y)), turn: Math.atan2(b.y - a.y, b.x - a.x), scale: this.grab.scale, angle: this.grab.angle, mode: null };
  }

  private onMove = (e: PointerEvent) => {
    if (!this.pointers.has(e.pointerId)) return;
    this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    const g = this.grab;
    if (!g) return;
    if (this.pinch && this.pointers.size >= 2) {
      const pn = this.pinch;
      const [a, b] = [...this.pointers.values()];
      const d = Math.atan2(b.y - a.y, b.x - a.x) - pn.turn;
      const turned = Math.atan2(Math.sin(d), Math.cos(d));
      const ratio = Math.hypot(b.x - a.x, b.y - a.y) / pn.dist;
      // Lock to whichever the fingers clearly do first, so a pinch doesn't twist and a twist doesn't resize.
      if (!pn.mode) pn.mode = Math.abs(turned) > 0.17 ? 'turn' : Math.abs(Math.log(ratio)) > 0.08 ? 'size' : null;
      if (pn.mode === 'turn') g.angle = pn.angle + turned;
      if (pn.mode === 'size') g.scale = clampScale(pn.scale * ratio);
    }
    if (e.pointerId === g.pointerId) {
      if (!g.dragging && Math.hypot(e.clientX - g.downAt.x, e.clientY - g.downAt.y) > 6) {
        this.beginDrag();
        this.tapOut = null;
      }
      if (!g.dragging) return;
      const p = this.toLogical(e.clientX, e.clientY);
      const off = rotate(g.offsetLocal, g.angle);
      g.target = { x: Math.max(-HALF_W + 10, Math.min(HALF_W - 10, p.x + off.x)), y: p.y + off.y };
    }
  };

  private onUp = (e: PointerEvent) => {
    this.pointers.delete(e.pointerId);
    const g = this.grab;
    if (!g) return;
    if (this.pinch && this.pointers.size < 2) {
      if (this.pinch.mode) this.markStep();
      this.pinch = null;
    }
    if (e.pointerId === this.tapOut) {
      this.deselect();
      return;
    }
    if (e.pointerId !== g.pointerId) return;
    // Stop dragging, but stay selected: the stone floats until a tap elsewhere lets it drop.
    g.pointerId = -1;
    if (g.dragging) this.markStep();
    g.dragging = false;
  };

  private onWheel = (e: WheelEvent) => {
    if (!this.grab) {
      const s = this.hit(this.toLogical(e.clientX, e.clientY));
      if (!s) return;
      this.select(s);
    }
    e.preventDefault();
    // Ctrl+wheel (also a trackpad pinch) resizes; the plain wheel turns.
    if (e.ctrlKey) this.resizeBy(Math.exp(-Math.max(-40, Math.min(40, e.deltaY)) * 0.005));
    else this.turn(Math.sign(e.deltaY) * 0.08);
  };

  private onKey = (e: KeyboardEvent) => {
    if (e.key === 'Enter') this.check();
    if (!this.grab) return;
    if (e.key === 'q' || e.key === 'Q') this.turn(-0.1);
    if (e.key === 'e' || e.key === 'E') this.turn(0.1);
    if (e.key === '-' || e.key === '_') this.resizeBy(1 / 1.1);
    if (e.key === '=' || e.key === '+') this.resizeBy(1.1);
    if (e.key === 'Delete' || e.key === 'Backspace') this.discard();
    if (e.key === 'Escape') this.deselect();
  };

  private turn(by: number) {
    if (!this.grab) return;
    this.grab.angle += by;
    this.markStep();
  }

  private resizeBy(k: number) {
    if (!this.grab) return;
    this.grab.scale = clampScale(this.grab.scale * k);
    this.markStep();
  }

  private discard() {
    const g = this.grab;
    if (!g) return;
    this.pinch = null;
    this.tapOut = null;
    this.removeStone(g.stone, false);
    this.markStep();
  }

  private spawnFromTray(style: StoneStyle, slot: number, e: PointerEvent) {
    if (this.stones.length >= MAX) return;
    const seed = this.session.tray[style][slot];
    if (seed === null) return;
    e.preventDefault();
    sound.resumeFromGesture();
    this.deselect();
    this.freeze();
    this.session.tray[style][slot] = null;
    this.session.startedAt ??= Date.now();
    const p = this.toLogical(e.clientX, e.clientY);
    const shape = stoneShape(style, seed);
    const at = { x: Math.max(-HALF_W + 20, Math.min(HALF_W - 20, p.x)), y: Math.min(p.y, -Math.max(shape.w, shape.h) / 2 - 30) };
    const s = this.addStone(style, seed, at);
    this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    this.select(s);
    this.startDrag(e.pointerId, at, { x: e.clientX, y: e.clientY }, true);
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
    this.checkEl = h('button.pebble.done', { onclick: () => this.check(), hidden: true }, '✓ ' + t('check'));
    this.trayEl = h('div.tray-stones');
    const tool = (label: string, aria: Key, act: () => void) => h('button.tool', { 'aria-label': t(aria), title: t(aria), onclick: act }, label);
    const bin = h('button.tool.bin', { 'aria-label': t('discard'), title: t('discard'), onclick: () => this.discard() });
    bin.innerHTML = TRASH_SVG;
    this.editorEl = h('div.editor', { role: 'toolbar' },
      tool('↺', 'rotLeft', () => this.turn(-Math.PI / 12)),
      tool('↻', 'rotRight', () => this.turn(Math.PI / 12)),
      tool('−', 'smaller', () => this.resizeBy(1 / 1.15)),
      tool('+', 'bigger', () => this.resizeBy(1.15)),
      bin,
    );

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
      this.editorEl,
      h('section.tray', { 'aria-label': t(STYLE_KEYS[s.style]) },
        h('div.tray-head', {}, tabs, h('button.text-btn', { onclick: () => this.reroll() }, t('reroll'))),
        this.trayEl,
        h('div.tray-foot', {},
          this.countEl,
        ),
        this.doneEl,
        this.checkEl,
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
        btn.append(thumbnail(style, seed));
        return btn;
      }),
    );
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

  /** Go back one step: an edit made in editor mode, or the last stable state (e.g. right after a collapse). */
  private undo() {
    this.deselect();
    this.flushStep();
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
    // A step from an edit comes back still in editor mode, frozen exactly as it was arranged.
    this.frozen = !!target.editing && this.stones.length > 0;
    this.stillFor = 0;
    this.renderTray();
    saveSession();
  }

  private clearAll() {
    this.unfreeze();
    for (const s of [...this.stones]) this.removeStone(s, true);
  }

  private finish() {
    if (this.frozen || !this.verdict.ok || this.stillFor < 2) return;
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
      // The world isn't stepping, so the selected stone is placed directly, easing toward its target.
      const b = g.stone.body;
      const cur = b.translation();
      const k = 0.5;
      b.setTranslation({ x: (cur.x * PPM + (g.target.x - cur.x * PPM) * k) / PPM, y: (cur.y * PPM + (g.target.y - cur.y * PPM) * k) / PPM }, false);
      // Rapier reports rotation wrapped to (-π, π] while the target keeps counting turns, so ease
      // along the shortest way round; otherwise after a full turn the stone chases it forever.
      const rot = b.rotation();
      const diff = Math.atan2(Math.sin(g.angle - rot), Math.cos(g.angle - rot));
      g.angle = rot + diff;
      b.setRotation(rot + diff * 0.5, false);
      if (g.scale !== g.stone.scale) this.resizeStone(g.stone, g.scale);
      // Keep the selected stone's lowest point out of the slab as it moves, turns or grows;
      // a stone already resting there stays exactly where it is.
      const low = Math.max(...worldPoly({ style: g.stone.style, seed: g.stone.seed, scale: g.stone.scale, x: g.target.x, y: g.target.y, angle: g.angle }).map((q) => q.y));
      if (low > 0) g.target.y -= low;
    }

    if (this.stepAt !== null && performance.now() >= this.stepAt && !this.grab?.dragging && !this.pinch) this.recordStep(true);

    // Frozen in editor mode: nothing falls until Check.
    if (!this.frozen) {
      this.acc += Math.min(dt, 0.1);
      const step = 1 / 60;
      while (this.acc >= step) {
        this.physics.step();
        this.acc -= step;
      }
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
    if (this.frozen) moving = true;
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
    this.drawSelection();
  }

  /** Outline the selected stone and float the editor bar above it (below, if there's no room). */
  private drawSelection() {
    const g = this.grab;
    const bar = this.editorEl;
    if (!g) {
      bar?.classList.remove('show');
      return;
    }
    const tr = g.stone.body.translation();
    const poly = worldPoly(this.at(g.stone, tr.x * PPM, tr.y * PPM));
    this.overlay.poly(poly.flatMap((q) => [q.x, q.y])).stroke({ width: 2 / this.scale, color: 0xfff6e4, alpha: 0.9 });
    if (!bar) return;
    const busy = g.dragging || this.pinch !== null;
    bar.classList.toggle('show', !busy);
    if (busy) return;
    const b = bounds(poly);
    const cx = ctx.w / 2 + (b.minX + b.w / 2) * this.scale;
    const top = this.groundY + b.minY * this.scale;
    const bottom = this.groundY + b.maxY * this.scale;
    const bw = bar.offsetWidth, bh = bar.offsetHeight;
    const roof = this.hintEl?.getBoundingClientRect().bottom ?? 0;
    const y = top - bh - 14 >= roof ? top - bh - 14 : Math.min(bottom + 14, this.trayTop - bh - 8);
    const x = Math.max(8, Math.min(ctx.w - bw - 8, cx - bw / 2));
    bar.style.transform = `translate(${Math.round(x)}px, ${Math.round(y)}px)`;
  }

  private updateHud(n: number) {
    if (this.countEl) this.countEl.textContent = `${n} / ${MAX}`;
    let hint: Key;
    const ready = this.verdict.ok && this.stillFor >= 2;
    if (n === 0) hint = 'hintStart';
    else if (n >= MAX && !this.verdict.ok) hint = 'hintFull';
    else if (this.grab) hint = 'hintEdit';
    else if (this.frozen) hint = 'hintFrozen';
    else if (!this.verdict.ok) hint = this.verdict.reason === 'body' ? 'hintBody' : 'hintLegs';
    else hint = ready ? 'hintReady' : 'hintSettle';
    if (hint !== this.lastHint && this.hintEl) {
      this.lastHint = hint;
      this.hintEl.textContent = t(hint);
      this.hintEl.dataset.state = ready ? 'ready' : 'pending';
    }
    if (this.doneEl) {
      this.doneEl.disabled = !ready;
      this.doneEl.hidden = this.frozen;
    }
    if (this.checkEl) this.checkEl.hidden = !this.frozen;
    if (this.undoEl) {
      // Nothing to undo: only the starting save point exists and nothing has changed since.
      const h = this.session.history;
      this.undoEl.disabled = h.length <= 1 && this.layoutKey(this.placed()) === this.layoutKey(h[0]?.stones ?? []);
    }
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
    window.removeEventListener('pointerdown', this.onAnyDown, true);
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
