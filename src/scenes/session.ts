// In-progress build. Survives Build ⇄ Preview and page reloads, and keeps the stable
// states it passed through so a collapse can be undone.

import type { PlacedStone, StoneStyle } from '../stone';
import type { BuildStats, Inukshuk } from '../store';
import { randomSeed } from '../util';

const TRAY_SIZE = 8;
const KEY = 'inukshuk.v1.build';
const MAX_HISTORY = 100;

export type Tray = Record<StoneStyle, (number | null)[]>;

/** A settled moment of the build: what stood, and what was left in the tray. */
export interface Snapshot {
  stones: PlacedStone[];
  tray: Tray;
  /** Recorded during editor mode: restoring it brings editor mode back, frozen. */
  editing?: boolean;
}

export interface Session {
  stones: PlacedStone[];
  tray: Tray;
  style: StoneStyle;
  history: Snapshot[];
  /** When the first stone came out of the tray (ms), or null before that. */
  startedAt: number | null;
  /** Time actually spent on the Build screen since then. */
  activeMs: number;
  /** Times a stone was let go onto the stack. */
  moves: number;
  undos: number;
  /** Reworking an inukshuk already on the ridge: saving replaces it, and it keeps its age. */
  reworking: { id: string; created: number } | null;
}

export const freshBatch = () => Array.from({ length: TRAY_SIZE }, randomSeed);
let session: Session | null = null;

const copyTray = (t: Tray): Tray => ({ 0: [...t[0]], 1: [...t[1]], 2: [...t[2]] });

export function snapshot(s: Session): Snapshot {
  return { stones: s.stones.map((p) => ({ ...p })), tray: copyTray(s.tray) };
}

export function restoreInto(s: Session, snap: Snapshot) {
  s.stones = snap.stones.map((p) => ({ ...p }));
  s.tray = copyTray(snap.tray);
}

export function pushHistory(s: Session, snap: Snapshot) {
  s.history.push(snap);
  if (s.history.length > MAX_HISTORY) s.history.splice(0, s.history.length - MAX_HISTORY);
}

function load(): Session | null {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const s = JSON.parse(raw) as Session;
    if (!Array.isArray(s.stones) || !s.tray || !Array.isArray(s.history)) return null;
    return { ...s, style: s.style ?? 0, startedAt: s.startedAt ?? null, activeMs: s.activeMs ?? 0, moves: s.moves ?? 0, undos: s.undos ?? 0, reworking: s.reworking ?? null };
  } catch {
    return null;
  }
}

export function saveSession() {
  if (!session) return;
  try {
    localStorage.setItem(KEY, JSON.stringify(session));
  } catch {
    /* storage unavailable: the build lives only in memory */
  }
}

export function getSession(): Session {
  if (!session) session = load();
  if (!session) session = fresh(null);
  return session;
}

function fresh(from: Inukshuk | null): Session {
  const st = from?.stats;
  const s: Session = {
    stones: from ? from.stones.map((p) => ({ ...p })) : [],
    tray: { 0: freshBatch(), 1: freshBatch(), 2: freshBatch() },
    style: 0,
    history: [],
    // Its story so far carries on: the time, moves and undos it took keep adding up.
    startedAt: from ? (st?.startedAt ?? from.created) : null,
    activeMs: st?.durationMs ?? 0,
    moves: st?.moves ?? 0,
    undos: st?.undos ?? 0,
    reworking: from ? { id: from.id, created: from.created } : null,
  };
  pushHistory(s, snapshot(s));
  return s;
}

/** An unfinished build that isn't a rework of `id`, which starting that rework would replace. */
export function hasOtherWork(id: string): boolean {
  const s = getSession();
  return s.reworking?.id !== id && s.stones.length > 0;
}

/** Take an inukshuk off the ridge and back onto the Build slab, replacing any unfinished build. */
export function startRework(item: Inukshuk) {
  if (session?.reworking?.id === item.id) return;
  session = fresh(item);
  saveSession();
}

export function endSession() {
  session = null;
  try {
    localStorage.removeItem(KEY);
  } catch {
    /* ignore */
  }
}

/** What Done hands to the preview. */
export const draft = { stones: [] as PlacedStone[], created: 0, stats: null as BuildStats | null };

export function statsOf(s: Session, finishedAt: number): BuildStats {
  return { startedAt: s.startedAt ?? finishedAt, durationMs: s.activeMs, moves: s.moves, undos: s.undos };
}
