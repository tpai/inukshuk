// Home: a ridge where every inukshuk you've placed keeps standing, weathering in real time.

import { Container, Text } from 'pixi.js';
import { type Scene, ctx, go, h } from '../app';
import { type Env, ageDays, nightness } from '../env';
import { Herd } from '../animals';
import { t, builtAgo } from '../i18n';
import { Scenery } from '../scenery';
import { Rig, classify } from '../rig';
import * as store from '../store';

interface Item {
  data: store.Inukshuk;
  rig: Rig;
  holder: Container;
  rigLayer: Container;
  herd: Herd;
  half: number;
  label: Text;
  x: number;
  w: number;
  key: string;
}

export class HomeScene implements Scene {
  root = new Container();
  private scenery = new Scenery(7);
  private ridge = new Container();
  private items: Item[] = [];
  private pan = 0;
  private vel = 0;
  private maxPan = 0;
  private drag: { id: number; x: number; start: number; moved: number } | null = null;
  private groundY = 0;
  private list = store.loadAll();
  private ui: HTMLElement | null = null;

  constructor() {
    this.root.addChild(this.scenery.back, this.ridge, this.scenery.front);
    const canvas = ctx.app.canvas;
    canvas.addEventListener('pointerdown', this.onDown);
    canvas.addEventListener('wheel', this.onWheel, { passive: true });
    window.addEventListener('pointermove', this.onMove);
    window.addEventListener('pointerup', this.onUp);
    window.addEventListener('pointercancel', this.onUp);
  }

  render(ui: HTMLElement) {
    this.ui = ui;
    ui.replaceChildren(
      ...[h('header.masthead', {},
        h('h1', {}, 'Inukshuk'),
        h('p.tagline', {}, t('tagline')),
      ),
      this.list.length ? null : h('p.ridge-empty', {}, t('empty')),
      h('nav.sr-only', { 'aria-label': 'Inukshuk' },
        ...this.list.map((it) => h('a', { href: '#/v/' + it.id }, builtAgo(ageDays(it.created)))),
      ),
      h('footer.dock.home-dock', {}, h('button.pebble', { onclick: () => go('#/build') }, t('newOne'))),
    ].filter((n): n is HTMLElement => !!n));
    for (const it of this.items) it.label.text = builtAgo(ageDays(it.data.created));
    requestAnimationFrame(() => this.resize(ctx.w, ctx.h));
  }

  private rebuild(env: Env) {
    for (const it of this.items) {
      const key = env.season + ':' + Math.round(ageDays(it.data.created) * 4);
      if (key === it.key) continue;
      it.key = key;
      const rig = new Rig(it.data.stones, classify(it.data.stones), { ageDays: ageDays(it.data.created), season: env.season });
      rig.motion = 'idle';
      it.rig.destroy();
      it.rig = rig;
      it.rigLayer.addChild(rig.root);
      this.place(it);
    }
  }

  private layout() {
    for (const it of this.items) {
      it.herd.destroy();
      it.holder.destroy({ children: true });
    }
    this.items = [];
    const scale = Math.max(0.35, Math.min(0.85, (this.groundY * 0.38) / 260));
    let x = Math.max(120, ctx.w * 0.28);
    const gap = Math.max(110, ctx.w * 0.2);
    for (const data of this.list) {
      const rig = new Rig(data.stones, classify(data.stones), null);
      const holder = new Container();
      const back = new Container(), rigLayer = new Container(), front = new Container();
      rigLayer.addChild(rig.root);
      holder.addChild(back, rigLayer, front);
      const herd = new Herd(back, front);
      const label = new Text({
        text: builtAgo(ageDays(data.created)),
        style: { fontFamily: 'LXGW WenKai TC, serif', fontSize: 14 / scale, fill: 0x3b3631 },
      });
      label.anchor.set(0.5, 0);
      holder.addChild(label);
      holder.scale.set(scale);
      this.ridge.addChild(holder);
      const w = rig.width * scale;
      // Animals roam about half the gap to either side of their inukshuk.
      const half = (w / 2 + gap * 0.45) / scale;
      const it: Item = { data, rig, holder, rigLayer, herd, half, label, x: x + w / 2, w, key: '' };
      herd.avoid = rig.width / 2;
      herd.sync(ageDays(data.created), half);
      this.place(it);
      this.items.push(it);
      x += w + gap;
    }
    this.maxPan = Math.max(0, x - ctx.w + 40);
  }

  private place(it: Item) {
    const xs = it.data.stones.map((p) => p.x);
    const mid = (Math.min(...xs) + Math.max(...xs)) / 2;
    it.rig.root.x = -mid;
    it.label.position.set(0, 14);
    it.holder.position.set(it.x, this.groundY + 4);
  }

  private onDown = (e: PointerEvent) => {
    this.drag = { id: e.pointerId, x: e.clientX, start: e.clientX, moved: 0 };
    this.vel = 0;
  };

  private onMove = (e: PointerEvent) => {
    const d = this.drag;
    if (!d || d.id !== e.pointerId) return;
    const dx = e.clientX - d.x;
    d.x = e.clientX;
    d.moved = Math.max(d.moved, Math.abs(e.clientX - d.start));
    this.pan = Math.max(-60, Math.min(this.maxPan + 60, this.pan - dx));
    this.vel = -dx * 60;
  };

  private onUp = (e: PointerEvent) => {
    const d = this.drag;
    if (!d || d.id !== e.pointerId) return;
    this.drag = null;
    if (d.moved < 8) {
      this.vel = 0;
      const hit = this.items.find((it) => {
        const b = it.holder.getBounds();
        return e.clientX >= b.minX - 10 && e.clientX <= b.maxX + 10 && e.clientY >= b.minY - 10 && e.clientY <= b.maxY + 10;
      });
      if (hit) go('#/v/' + hit.data.id);
    }
  };

  private onWheel = (e: WheelEvent) => {
    this.pan = Math.max(0, Math.min(this.maxPan, this.pan + (Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY)));
  };

  resize(w: number, hgt: number) {
    const dock = this.ui?.querySelector('.dock');
    const dockTop = dock ? dock.getBoundingClientRect().top : hgt - 120;
    this.groundY = Math.min(dockTop - 80, hgt * 0.72);
    this.scenery.resize(w, hgt, this.groundY);
    this.layout();
  }

  update(dt: number, env: Env) {
    this.rebuild(env);
    if (!this.drag) {
      this.pan += this.vel * dt;
      this.vel *= Math.pow(0.04, dt);
      const lo = 0, hi = this.maxPan;
      if (this.pan < lo) this.pan += (lo - this.pan) * Math.min(1, dt * 8);
      if (this.pan > hi) this.pan += (hi - this.pan) * Math.min(1, dt * 8);
    }
    this.scenery.scroll = this.pan;
    this.scenery.update(dt, env);
    this.ridge.x = -this.pan;
    this.ridge.tint = this.scenery.light;
    const night = nightness(env.hour);
    for (const it of this.items) {
      it.herd.sync(ageDays(it.data.created), it.half);
      it.herd.update(dt, night, it.half);
      it.rig.update(dt);
      it.rig.root.x = -(Math.min(...it.data.stones.map((p) => p.x)) + Math.max(...it.data.stones.map((p) => p.x))) / 2;
      it.label.style.fill = env.hour > 19 || env.hour < 5.5 ? 0xe9e2d4 : 0x3b3631;
    }
  }

  destroy() {
    for (const it of this.items) it.herd.destroy();
    const canvas = ctx.app.canvas;
    canvas.removeEventListener('pointerdown', this.onDown);
    canvas.removeEventListener('wheel', this.onWheel);
    window.removeEventListener('pointermove', this.onMove);
    window.removeEventListener('pointerup', this.onUp);
    window.removeEventListener('pointercancel', this.onUp);
    this.scenery.destroy();
    this.root.destroy({ children: true });
  }
}
