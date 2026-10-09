// Saved inukshuks (localStorage) and the compact share-link format.

import type { PlacedStone, StoneStyle } from './stone';

export interface Inukshuk {
  id: string;
  created: number; // ms
  stones: PlacedStone[];
}

const KEY = 'inukshuk.v1.ridge';

export function loadAll(): Inukshuk[] {
  try {
    const raw = localStorage.getItem(KEY);
    const list = raw ? (JSON.parse(raw) as Inukshuk[]) : [];
    return Array.isArray(list) ? list : [];
  } catch {
    return [];
  }
}

function saveAll(list: Inukshuk[]) {
  try {
    localStorage.setItem(KEY, JSON.stringify(list));
  } catch {
    /* storage unavailable: the ridge just won't remember */
  }
}

export function add(stones: PlacedStone[]): Inukshuk {
  const item: Inukshuk = { id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6), created: Date.now(), stones };
  saveAll([item, ...loadAll()]);
  return item;
}

export function remove(id: string) {
  saveAll(loadAll().filter((i) => i.id !== id));
}

export function get(id: string): Inukshuk | undefined {
  return loadAll().find((i) => i.id === id);
}

// ---- share codec ----
// [version u8][created u32 seconds][count u8] then per stone:
// [style u8][seed u32][x i16 ×10][y i16 ×10][angle i16 ×10000]

const VERSION = 1;

export function encode(item: Pick<Inukshuk, 'created' | 'stones'>): string {
  const buf = new DataView(new ArrayBuffer(6 + item.stones.length * 11));
  buf.setUint8(0, VERSION);
  buf.setUint32(1, Math.floor(item.created / 1000));
  buf.setUint8(5, item.stones.length);
  item.stones.forEach((s, i) => {
    const o = 6 + i * 11;
    let a = s.angle % (Math.PI * 2);
    if (a > Math.PI) a -= Math.PI * 2;
    if (a < -Math.PI) a += Math.PI * 2;
    buf.setUint8(o, s.style);
    buf.setUint32(o + 1, s.seed >>> 0);
    buf.setInt16(o + 5, Math.round(s.x * 10));
    buf.setInt16(o + 7, Math.round(s.y * 10));
    buf.setInt16(o + 9, Math.round(a * 10000));
  });
  let bin = '';
  new Uint8Array(buf.buffer).forEach((b) => (bin += String.fromCharCode(b)));
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function decode(code: string): Pick<Inukshuk, 'created' | 'stones'> | null {
  try {
    const bin = atob(code.replace(/-/g, '+').replace(/_/g, '/'));
    const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0));
    const buf = new DataView(bytes.buffer);
    if (buf.getUint8(0) !== VERSION) return null;
    const created = buf.getUint32(1) * 1000;
    const count = buf.getUint8(5);
    if (bytes.length < 6 + count * 11) return null;
    const stones: PlacedStone[] = [];
    for (let i = 0; i < count; i++) {
      const o = 6 + i * 11;
      const style = buf.getUint8(o);
      if (style > 2) return null;
      stones.push({
        style: style as StoneStyle,
        seed: buf.getUint32(o + 1),
        x: buf.getInt16(o + 5) / 10,
        y: buf.getInt16(o + 7) / 10,
        angle: buf.getInt16(o + 9) / 10000,
      });
    }
    return { created, stones };
  } catch {
    return null;
  }
}

export function shareUrl(item: Pick<Inukshuk, 'created' | 'stones'>): string {
  const u = new URL(location.href);
  u.search = '';
  u.hash = '#/s/' + encode(item);
  return u.toString();
}
