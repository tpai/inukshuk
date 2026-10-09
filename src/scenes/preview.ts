// Preview: the finished inukshuk standing in the viewer's own hour and season.

import { Container, Graphics } from 'pixi.js';
import { type Scene, ctx, go, h, toast } from '../app';
import { type Env, ageDays, debug, nightness, reducedMotion } from '../env';
import { t, builtAgo, lang, type Key } from '../i18n';
import { Scenery } from '../scenery';
import type { PlacedStone } from '../stone';
import { Rig, classify, drawBoneOverlay, type Motion } from '../rig';
import { Birds } from '../birds';
import { Herd, herdRoom } from '../animals';
import * as store from '../store';
import { draft, endSession } from './session';

export type PreviewMode =
  | { kind: 'draft' }
  | { kind: 'saved'; id: string }
  | { kind: 'shared'; code: string };

const MOTIONS: { m: Motion; key: Key }[] = [
  { m: 'idle', key: 'idle' },
  { m: 'walk', key: 'walk' },
  { m: 'jump', key: 'jump' },
];

export class PreviewScene implements Scene {
  root = new Container();
  private scenery: Scenery;
  private world = new Container();
  private shadow = new Graphics();
  private animalsBack = new Container();
  private rigLayer = new Container();
  private animalsFront = new Container();
  private herd = new Herd(this.animalsBack, this.animalsFront);
  private prevRootY = 0;
  private fitAge = -1;
  private birdLayer = new Container();
  private overlay = new Graphics();
  private rig: Rig | null = null;
  private birds: Birds | null = null;
  private rigKey = '';
  private motion: Motion = 'idle';
  private stones: PlacedStone[] = [];
  private created = Date.now();
  private savedId: string | null = null;
  private missing: Key | null = null;
  private removeArmed = 0;
  private ageEl: HTMLElement | null = null;
  private ui: HTMLElement | null = null;
  private groundY = 0;

  constructor(private mode: PreviewMode) {
    if (mode.kind === 'draft') {
      this.stones = draft.stones;
      this.created = draft.created;
      if (!this.stones.length) this.missing = 'notFound';
    } else if (mode.kind === 'saved') {
      const item = store.get(mode.id);
      if (item) {
        this.stones = item.stones;
        this.created = item.created;
        this.savedId = item.id;
      } else this.missing = 'notFound';
    } else {
      const item = store.decode(mode.code);
      if (item) {
        this.stones = item.stones;
        this.created = item.created;
      } else this.missing = 'brokenLink';
    }
    this.scenery = new Scenery((this.created / 1000) % 9973 | 0);
    this.root.addChild(this.scenery.back, this.world, this.scenery.front);
    this.world.addChild(this.shadow, this.animalsBack, this.rigLayer, this.animalsFront, this.birdLayer, this.overlay);
  }

  private verdict = () => classify(this.stones);

  private buildRig(env: Env) {
    const age = ageDays(this.created);
    const key = env.season + ':' + Math.round(age * 4);
    if (key === this.rigKey || !this.stones.length) return;
    this.rigKey = key;
    const old = this.rig;
    const rig = new Rig(this.stones, this.verdict(), { ageDays: age, season: env.season });
    rig.motion = this.motion;
    this.rigLayer.addChild(rig.root);
    if (this.birds) this.birds.setRig(rig);
    else this.birds = new Birds(this.birdLayer, rig, () => ctx.w / this.world.scale.x);
    old?.destroy();
    this.rig = rig;
    this.fit();
  }

  private setMotion(m: Motion) {
    this.motion = m;
    if (this.rig) this.rig.motion = m;
    if (m !== 'idle') this.birds?.scatter();
    this.ui?.querySelectorAll<HTMLButtonElement>('.tabs .tab').forEach((b) => b.setAttribute('aria-selected', String(b.dataset.m === m)));
  }

  render(ui: HTMLElement) {
    this.ui = ui;
    ui.replaceChildren();
    const backTo = this.mode.kind === 'draft' ? '#/build' : '#/';
    ui.append(h('header.bar', {}, h('button.text-btn', { onclick: () => go(backTo) }, '‹ ' + t('back'))));

    if (this.missing) {
      ui.append(
        h('div.empty-note', {}, h('p', {}, t(this.missing))),
        h('footer.dock.home-dock', {}, h('button.pebble', { onclick: () => go('#/build') }, t('buildMine'))),
      );
      return;
    }

    this.ageEl = h('p.age');
    const tabs = h(
      'div.tabs',
      { role: 'tablist' },
      ...MOTIONS.map(({ m, key }) =>
        h('button.tab', { role: 'tab', 'aria-selected': String(this.motion === m), 'data-m': m, onclick: () => this.setMotion(m) }, t(key)),
      ),
    );

    let actions: HTMLElement;
    if (this.mode.kind === 'draft') {
      actions = h('div.actions', {},
        h('button.text-btn', { onclick: () => go('#/build') }, t('keepBuilding')),
        h('button.pebble', { onclick: () => this.save() }, t('save')),
      );
    } else if (this.mode.kind === 'saved') {
      const removeBtn = h('button.text-btn.danger', { onclick: () => this.remove(removeBtn) }, t('remove'));
      actions = h('div.actions', {},
        removeBtn,
        h('button.pebble', { onclick: () => this.share() }, t('share')),
      );
    } else {
      actions = h('div.actions', {},
        h('p.someone', {}, t('someoneLeft')),
        h('button.pebble', { onclick: () => go('#/build') }, t('buildMine')),
      );
    }

    ui.append(h('footer.dock', {}, this.ageEl, tabs, actions));
    requestAnimationFrame(() => this.resize(ctx.w, ctx.h));
  }

  private save() {
    const item = store.add(this.stones);
    endSession();
    toast(t('saved'));
    go('#/v/' + item.id);
  }

  private async share() {
    const url = store.shareUrl({ created: this.created, stones: this.stones });
    try {
      await navigator.clipboard.writeText(url);
      toast(t('copied'));
    } catch {
      history.replaceState(null, '', url);
      toast(t('copyFailed'));
    }
  }

  private remove(btn: HTMLButtonElement) {
    if (!this.savedId) return;
    if (Date.now() - this.removeArmed < 3000) {
      store.remove(this.savedId);
      go('#/');
      return;
    }
    this.removeArmed = Date.now();
    btn.textContent = t('removeConfirm');
    setTimeout(() => {
      if (btn.isConnected) btn.textContent = t('remove');
    }, 3000);
  }

  resize(w: number, hgt: number) {
    const dock = this.ui?.querySelector('.dock');
    const dockTop = dock ? dock.getBoundingClientRect().top : hgt - 160;
    this.groundY = Math.min(dockTop - 24, hgt * 0.78);
    this.scenery.resize(w, hgt, this.groundY);
    this.fit();
  }

  private fit() {
    const rig = this.rig;
    const w = ctx.w;
    const room = this.groundY - 200;
    // Leave ground on both sides for whatever animals have gathered.
    const side = rig ? rig.width / 2 + Math.max(30, herdRoom(ageDays(this.created))) : 1;
    const s = rig ? Math.max(0.4, Math.min(1.9, room / (rig.height + 90), (w / 2 - 10) / side)) : 1;
    if (rig) this.herd.avoid = rig.width / 2;
    this.world.scale.set(s);
    this.world.position.set(w / 2, this.groundY);
    if (rig) {
      // Centre horizontally on the figure's footprint.
      const xs = this.stones.map((p) => p.x);
      rig.root.x = -(Math.min(...xs) + Math.max(...xs)) / 2;
    }
  }

  update(dt: number, env: Env) {
    this.scenery.update(dt, env);
    this.world.tint = this.scenery.light;
    this.buildRig(env);
    const rig = this.rig;
    if (!rig) return;
    const keepX = rig.root.x;
    rig.update(dt);
    rig.root.x = keepX;
    const half = ctx.w / 2 / this.world.scale.x - 30;
    if (this.motion === 'walk') {
      const step = dt * (reducedMotion ? 30 : 70) * this.world.scale.x;
      this.scenery.scroll += step;
      this.herd.drift(step / this.world.scale.x, half);
    }
    // Landing from a jump startles anything nearby.
    if (this.motion === 'jump' && this.prevRootY < -20 && rig.root.y >= -20 && rig.root.y > this.prevRootY) this.herd.startle(0, half);
    this.prevRootY = rig.root.y;
    const age = ageDays(this.created);
    if (Math.round(age) !== this.fitAge) {
      this.fitAge = Math.round(age);
      this.fit();
    }
    this.herd.sync(age, half);
    this.herd.update(dt, nightness(env.hour), half);

    const lift = -rig.root.y;
    const k = Math.max(0.35, 1 - lift / 120);
    this.shadow.clear().ellipse(rig.root.x + (Math.min(...this.stones.map((p) => p.x)) + Math.max(...this.stones.map((p) => p.x))) / 2, 2, (rig.width / 2 + 10) * k, 5 * k)
      .fill({ color: 0x2a2018, alpha: 0.18 * k });

    if (this.birds) {
      this.birds.allowed = this.motion === 'idle' && nightness(env.hour) < 0.5 && !reducedMotion;
      this.birds.update(dt);
    }

    if (this.ageEl) {
      const txt = builtAgo(ageDays(this.created)) + (lang === 'zh' ? '，' : ', ') + t('seasonNow', { s: t(env.season) });
      if (this.ageEl.textContent !== txt) this.ageEl.textContent = txt;
    }

    this.overlay.clear();
    if (debug.showBones) {
      this.overlay.position.set(rig.root.x, 0);
      drawBoneOverlay(this.overlay, this.stones, this.verdict());
    }
  }

  summonBird() {
    this.birds?.summon();
  }

  destroy() {
    this.herd.destroy();
    this.birds?.destroy();
    this.rig?.destroy();
    this.scenery.destroy();
    this.root.destroy({ children: true });
  }
}
