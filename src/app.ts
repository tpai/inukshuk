// Shared app context: the Pixi application, the DOM overlay, routing helpers.

import type { Application, Container } from 'pixi.js';
import type { Env } from './env';

export interface Scene {
  root: Container;
  /** Build DOM controls inside `ui`; called again when the language changes. */
  render(ui: HTMLElement): void;
  resize(w: number, h: number): void;
  update(dt: number, env: Env): void;
  destroy(): void;
}

export const ctx = {
  app: null as unknown as Application,
  w: 0,
  h: 0,
};

export function go(hash: string) {
  if (location.hash === hash) window.dispatchEvent(new HashChangeEvent('hashchange'));
  else location.hash = hash;
}

type Tag<T extends string> = T extends `${infer K}.${string}` ? K : T;
type El<T extends string> = Tag<T> extends keyof HTMLElementTagNameMap ? HTMLElementTagNameMap[Tag<T>] : HTMLElement;

/** Tiny DOM builder: h('button.pebble', {onclick}, 'text'). */
export function h<T extends string>(
  tag: T,
  props: Partial<Record<string, unknown>> = {},
  ...children: (Node | string | null | false)[]
): El<T> {
  const [name, ...classes] = tag.split('.');
  const el = document.createElement(name) as El<T>;
  if (classes.length) el.className = classes.join(' ');
  for (const [k, v] of Object.entries(props)) {
    if (v === undefined || v === null || v === false) continue;
    if (k.startsWith('on')) el.addEventListener(k.slice(2), v as EventListener);
    else if (k === 'style') Object.assign(el.style, v);
    else if (k in el && typeof v !== 'string') (el as unknown as Record<string, unknown>)[k] = v;
    else el.setAttribute(k, String(v));
  }
  for (const c of children) if (c !== null && c !== false) el.append(c);
  return el;
}

let toastTimer = 0;
export function toast(msg: string) {
  let el = document.querySelector<HTMLElement>('.toast');
  if (!el) {
    el = h('div.toast', { role: 'status', 'aria-live': 'polite' });
    document.body.append(el);
  }
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => el!.classList.remove('show'), 2200);
}
