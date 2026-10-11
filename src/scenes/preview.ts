// Preview: the finished inukshuk standing in the viewer's own hour and season, with how it was made.

import { Container, Graphics } from 'pixi.js';
import { type Scene, ctx, go, h, toast } from '../app';
import { type Env, ageDays, debug, nightness, reducedMotion } from '../env';
import { t, builtAgo, lang, formatDuration, formatDateTime, type Key } from '../i18n';
import { Scenery } from '../scenery';
import type { PlacedStone } from '../stone';
import { Rig, classify, drawBoneOverlay } from '../rig';
import { Birds } from '../birds';
import { Herd, ridgeTerrains, type Terrain } from '../animals';
import * as store from '../store';
import type { BuildStats } from '../store';
import { draft, endSession, getSession, hasOtherWork, startRework } from './session';

export type PreviewMode =
  | { kind: 'draft' }
  | { kind: 'saved'; id: string }
  | { kind: 'shared'; code: string };

export class PreviewScene implements Scene {
  root = new Container();
  private scenery: Scenery;
  private world = new Container();
  private shadow = new Graphics();
  private rigLayer = new Container();
  private animalsFront = new Container();
  private herd: Herd;
  private birdLayer = new Container();
  private overlay = new Graphics();
  private rig: Rig | null = null;
  private birds: Birds | null = null;
  private rigKey = '';
  private stones: PlacedStone[] = [];
  private stats: BuildStats | null = null;
  private created = Date.now();
  private savedId: string | null = null;
  /** Someone else built it: it arrived on this ridge through a share link. */
  private fromLink = false;
  private missing: Key | null = null;
  private removeArmed = 0;
  private editArmed = 0;
  private ageEl: HTMLElement | null = null;
  private ui: HTMLElement | null = null;
  private groundY = 0;

  constructor(private mode: PreviewMode) {
    if (mode.kind === 'draft') {
      this.stones = draft.stones;
      this.created = draft.created;
      this.stats = draft.stats;
      if (!this.stones.length) this.missing = 'notFound';
    } else if (mode.kind === 'saved') {
      const item = store.get(mode.id);
      if (item) {
        this.stones = item.stones;
        this.created = item.created;
        this.stats = item.stats ?? null;
        this.savedId = item.id;
        this.fromLink = !!item.shared;
      } else this.missing = 'notFound';
    } else {
      const shared = store.decode(mode.code);
      if (shared) {
        // Opening a link brings the inukshuk home: it joins the viewer's ridge and is theirs from here on.
        const { item, added } = store.importShared(shared);
        this.stones = item.stones;
        this.created = item.created;
        this.stats = item.stats ?? null;
        this.savedId = item.id;
        this.fromLink = !!item.shared;
        this.mode = { kind: 'saved', id: item.id };
        history.replaceState(null, '', '#/v/' + item.id);
        if (added) toast(t('imported'));
      } else this.missing = 'brokenLink';
    }
    this.scenery = new Scenery((this.created / 1000) % 9973 | 0);
    this.root.addChild(this.scenery.back, this.world, this.scenery.front);
    this.world.addChild(this.shadow, this.rigLayer, this.animalsFront, this.birdLayer, this.overlay);
    this.animalsFront.y = 4;
    this.herd = new Herd(this.terrains());
  }

  private verdict = () => classify(this.stones);

  /** Ground in front of the figure, plus the three ridges behind it (smaller with distance). */
  private terrains(): Terrain[] {
    const half = () => ctx.w / 2 / this.world.scale.x - 20;
    const ground: Terrain = {
      layer: this.animalsFront, scale: () => 1, weight: 0.35,
      lo: () => -half(), hi: () => half(), y: () => 0,
      avoid: () => {
        const w = (this.rig?.width ?? 0) / 2 + 6;
        return [-w, w];
      },
    };
    return [ground, ...ridgeTerrains(this.scenery, () => this.world.scale.x)];
  }

  private buildRig(env: Env) {
    const age = ageDays(this.created);
    const key = env.season + ':' + Math.round(age * 4);
    if (key === this.rigKey || !this.stones.length) return;
    this.rigKey = key;
    const old = this.rig;
    const rig = new Rig(this.stones, this.verdict(), { ageDays: age, season: env.season });
    this.rigLayer.addChild(rig.root);
    if (this.birds) this.birds.setRig(rig);
    else this.birds = new Birds(this.birdLayer, rig, () => ctx.w / this.world.scale.x);
    old?.destroy();
    this.rig = rig;
    this.fit();
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
    const st = this.stats;
    const facts = st
      ? h('dl.facts', {},
          h('dt', {}, t('started')), h('dd', {}, formatDateTime(st.startedAt)),
          h('dt', {}, t('took')), h('dd', {}, formatDuration(st.durationMs)),
          h('dt', {}, t('stones')), h('dd', {}, t('stonesDetail', { n: this.stones.length, m: st.moves, u: st.undos })),
        )
      : null;

    let actions: HTMLElement;
    if (this.mode.kind === 'draft') {
      actions = h('div.actions', {},
        h('button.text-btn', { onclick: () => go('#/build') }, t('keepBuilding')),
        h('button.pebble', { onclick: () => this.save() }, t(getSession().reworking ? 'saveChanges' : 'save')),
      );
    } else {
      const removeBtn = h('button.text-btn.danger', { onclick: () => this.remove(removeBtn) }, t('remove'));
      const editBtn = h('button.text-btn', { onclick: () => this.rework() }, t('edit'));
      actions = h('div.actions', {},
        h('div.bar-actions', {}, removeBtn, editBtn),
        h('button.pebble', { onclick: () => this.share() }, t('share')),
      );
    }

    ui.append(h('footer.dock', {}, this.ageEl, facts, this.fromLink ? h('p.someone', {}, t('someoneLeft')) : null, actions));
    requestAnimationFrame(() => this.resize(ctx.w, ctx.h));
  }

  private save() {
    const re = getSession().reworking;
    const id = re && store.update(re.id, this.stones, this.stats) ? re.id : store.add(this.stones, this.created, this.stats).id;
    endSession();
    toast(t(re ? 'changesSaved' : 'saved'));
    go('#/v/' + id);
  }

  /** Back onto the slab to keep working on it. An unfinished build in the way needs a second tap. */
  private rework() {
    const item = this.savedId ? store.get(this.savedId) : undefined;
    if (!item) return;
    if (hasOtherWork(item.id) && Date.now() - this.editArmed > 3000) {
      this.editArmed = Date.now();
      toast(t('editConfirm'));
      return;
    }
    startRework(item);
    go('#/build');
  }

  private async share() {
    const url = store.shareUrl({ created: this.created, stones: this.stones, ...(this.stats ? { stats: this.stats } : {}) });
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
    this.scenery.reserveTop = this.ui?.querySelector('.bar')?.getBoundingClientRect().bottom ?? 0;
    this.scenery.resize(w, hgt, this.groundY);
    this.fit();
  }

  private fit() {
    const rig = this.rig;
    const w = ctx.w;
    const room = this.groundY - 200;
    const s = rig ? Math.max(0.5, Math.min(1.9, room / (rig.height + 90), (w - 40) / (rig.width + 60))) : 1;
    this.world.scale.set(s);
    this.world.position.set(w / 2, this.groundY);
    if (rig) {
      // Centre horizontally on the figure's footprint.
      const xs = this.stones.map((p) => p.x);
      rig.root.x = -(Math.min(...xs) + Math.max(...xs)) / 2;
      this.shadow.clear().ellipse(0, 2, rig.width / 2 + 10, 5).fill({ color: 0x2a2018, alpha: 0.18 });
    }
  }

  update(dt: number, env: Env) {
    this.scenery.update(dt, env);
    this.world.tint = this.scenery.light;
    this.buildRig(env);
    const rig = this.rig;
    if (!rig) return;
    this.herd.sync(ageDays(this.created));
    this.herd.update(dt, nightness(env.hour));

    if (this.birds) {
      this.birds.allowed = nightness(env.hour) < 0.5 && !reducedMotion;
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
