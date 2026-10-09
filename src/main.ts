import './style.css';
import { Application } from 'pixi.js';
import { type Scene, ctx, h } from './app';
import { getEnv, updateWind, nightness, debugEnabled } from './env';
import { t, lang, setLang, onLang } from './i18n';
import { sound } from './audio';
import { mountDebug } from './debug';
import { HomeScene } from './scenes/home';
import { PreviewScene } from './scenes/preview';

const ui = document.getElementById('ui')!;
let scene: Scene | null = null;

// Physics only matters while stacking, so Rapier loads with the Build screen.
const loadBuild = () =>
  import('./scenes/build').then(async (m) => {
    await m.initPhysics();
    return m.BuildScene;
  });

let routeId = 0;
async function route() {
  const hash = location.hash || '#/';
  const id = ++routeId;
  const Build = hash.startsWith('#/build') ? await loadBuild() : null;
  if (id !== routeId) return;
  scene?.destroy();
  let next: Scene;
  if (Build) next = new Build();
  else if (hash.startsWith('#/draft')) next = new PreviewScene({ kind: 'draft' });
  else if (hash.startsWith('#/v/')) next = new PreviewScene({ kind: 'saved', id: hash.slice(4) });
  else if (hash.startsWith('#/s/')) next = new PreviewScene({ kind: 'shared', code: hash.slice(4) });
  else next = new HomeScene();
  scene = next;
  ctx.app.stage.addChild(next.root);
  next.resize(ctx.w, ctx.h);
  next.render(ui);
  ui.dataset.route = hash.split('/')[1] || 'home';
}

function mountChrome() {
  const soundBtn = h('button.icon-btn', { onclick: () => sound.toggle() });
  const langBtn = h('button.icon-btn.lang', { onclick: () => setLang(lang === 'zh' ? 'en' : 'zh') });
  const infoLink = h('a.icon-btn', { href: 'https://thecanadianencyclopedia.ca/en/article/inuksuk-inukshuk', target: '_blank', rel: 'noopener noreferrer' });
  infoLink.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9" fill="none"/><path d="M12 11v6" fill="none"/><circle cx="12" cy="7.6" r="0.6"/></svg>';
  const sync = () => {
    soundBtn.innerHTML = sound.enabled
      ? '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 9h4l5-4v14l-5-4H4z"/><path d="M16 8.5c1.2 1 1.8 2.2 1.8 3.5s-.6 2.5-1.8 3.5M18.5 6c2 1.6 3 3.6 3 6s-1 4.4-3 6" fill="none"/></svg>'
      : '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 9h4l5-4v14l-5-4H4z"/><path d="M17 9.5l5 5M22 9.5l-5 5" fill="none"/></svg>';
    soundBtn.setAttribute('aria-label', sound.enabled ? t('soundOff') : t('soundOn'));
    soundBtn.setAttribute('aria-pressed', String(sound.enabled));
    infoLink.setAttribute('aria-label', t('about'));
    infoLink.title = t('about');
    langBtn.textContent = t('langSwitch');
    langBtn.setAttribute('aria-label', t('langLabel'));
  };
  sound.onChange(sync);
  onLang(() => {
    sync();
    scene?.render(ui);
  });
  sync();
  document.body.append(h('div.chrome', {}, infoLink, langBtn, soundBtn));
}

async function main() {
  await document.fonts.load('20px "LXGW WenKai TC"').catch(() => null);
  const app = new Application();
  await app.init({
    resizeTo: window,
    antialias: true,
    backgroundColor: 0xeadfcb,
    resolution: Math.min(window.devicePixelRatio || 1, 2),
    autoDensity: true,
  });
  ctx.app = app;
  ctx.w = app.screen.width;
  ctx.h = app.screen.height;
  document.getElementById('stage')!.append(app.canvas);

  mountChrome();
  if (debugEnabled) mountDebug(() => (scene as PreviewScene | null)?.summonBird?.());

  window.addEventListener('hashchange', route);
  window.addEventListener('resize', () => {
    requestAnimationFrame(() => {
      ctx.w = app.screen.width;
      ctx.h = app.screen.height;
      scene?.resize(ctx.w, ctx.h);
    });
  });
  window.addEventListener('pointerdown', () => sound.resumeFromGesture(), { once: true });
  // iOS Safari ignores user-scalable=no: block pinch zoom explicitly (double-tap is handled by touch-action in CSS).
  for (const type of ['gesturestart', 'gesturechange', 'gestureend']) document.addEventListener(type, (e) => e.preventDefault());
  route();

  app.ticker.add((tk) => {
    const dt = Math.min(tk.deltaMS / 1000, 0.1);
    const env = getEnv();
    updateWind(dt);
    scene?.update(dt, env);
    sound.update(dt, env);
    document.documentElement.dataset.sky = nightness(env.hour) > 0.5 ? 'night' : 'day';
  });

  document.getElementById('boot')?.remove();
}

main();
