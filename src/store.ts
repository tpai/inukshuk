// Saved inukshuks (localStorage) and the compact share-link format.

import { type PlacedStone, type StoneStyle, clampScale } from './stone';

/** How the inukshuk came to be. */
export interface BuildStats {
  startedAt: number; // ms, first stone taken from the tray
  durationMs: number; // time spent building
  moves: number; // stones let go onto the stack
  undos: number;
}

export interface Inukshuk {
  id: string;
  created: number; // ms, when it was finished
  stones: PlacedStone[];
  stats?: BuildStats;
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

export function add(stones: PlacedStone[], created: number, stats: BuildStats | null): Inukshuk {
  const item: Inukshuk = { id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6), created, stones, ...(stats ? { stats } : {}) };
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
// v1: [1][created u32 s][count u8] stones…
// v2: [2][created u32 s][count u8][started u32 s][duration u32 s][moves u16][undos u16] stones…
// stone: [style u8][seed u32][x i16 ×10][y i16 ×10][angle i16 ×10000]
// SIZED (0x80 on the version byte): each stone also carries [scale u8 ×100].

type Shared = Pick<Inukshuk, 'created' | 'stones' | 'stats'>;

const SIZED = 0x80;

export function encode(item: Shared): string {
  const head = item.stats ? 18 : 6;
  const sized = item.stones.some((s) => (s.scale ?? 1) !== 1);
  const per = sized ? 12 : 11;
  const buf = new DataView(new ArrayBuffer(head + item.stones.length * per));
  buf.setUint8(0, (item.stats ? 2 : 1) | (sized ? SIZED : 0));
  buf.setUint32(1, Math.floor(item.created / 1000));
  buf.setUint8(5, item.stones.length);
  if (item.stats) {
    buf.setUint32(6, Math.floor(item.stats.startedAt / 1000));
    buf.setUint32(10, Math.round(item.stats.durationMs / 1000));
    buf.setUint16(14, Math.min(65535, item.stats.moves));
    buf.setUint16(16, Math.min(65535, item.stats.undos));
  }
  item.stones.forEach((s, i) => {
    const o = head + i * per;
    let a = s.angle % (Math.PI * 2);
    if (a > Math.PI) a -= Math.PI * 2;
    if (a < -Math.PI) a += Math.PI * 2;
    buf.setUint8(o, s.style);
    buf.setUint32(o + 1, s.seed >>> 0);
    buf.setInt16(o + 5, Math.round(s.x * 10));
    buf.setInt16(o + 7, Math.round(s.y * 10));
    buf.setInt16(o + 9, Math.round(a * 10000));
    if (sized) buf.setUint8(o + 11, Math.round((s.scale ?? 1) * 100));
  });
  let bin = '';
  new Uint8Array(buf.buffer).forEach((b) => (bin += String.fromCharCode(b)));
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function decode(code: string): Shared | null {
  try {
    const bin = atob(code.replace(/-/g, '+').replace(/_/g, '/'));
    const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0));
    const buf = new DataView(bytes.buffer);
    const flags = buf.getUint8(0);
    const version = flags & ~SIZED;
    const sized = (flags & SIZED) !== 0;
    if (version !== 1 && version !== 2) return null;
    const head = version === 2 ? 18 : 6;
    const per = sized ? 12 : 11;
    const created = buf.getUint32(1) * 1000;
    const count = buf.getUint8(5);
    if (bytes.length < head + count * per) return null;
    const stats: BuildStats | undefined =
      version === 2
        ? { startedAt: buf.getUint32(6) * 1000, durationMs: buf.getUint32(10) * 1000, moves: buf.getUint16(14), undos: buf.getUint16(16) }
        : undefined;
    const stones: PlacedStone[] = [];
    for (let i = 0; i < count; i++) {
      const o = head + i * per;
      const style = buf.getUint8(o);
      if (style > 2) return null;
      const stone: PlacedStone = {
        style: style as StoneStyle,
        seed: buf.getUint32(o + 1),
        x: buf.getInt16(o + 5) / 10,
        y: buf.getInt16(o + 7) / 10,
        angle: buf.getInt16(o + 9) / 10000,
      };
      if (sized) {
        const k = clampScale(buf.getUint8(o + 11) / 100);
        if (k !== 1) stone.scale = k;
      }
      stones.push(stone);
    }
    return stats ? { created, stones, stats } : { created, stones };
  } catch {
    return null;
  }
}

export function shareUrl(item: Shared): string {
  const u = new URL(location.href);
  u.search = '';
  u.hash = '#/s/' + encode(item);
  return u.toString();
}
