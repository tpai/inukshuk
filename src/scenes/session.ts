// In-progress build. Survives Build ⇄ Preview and page reloads, and keeps the stable
// states it passed through so a collapse can be undone.

import type { PlacedStone, StoneStyle } from '../stone';
import { randomSeed } from '../util';

const TRAY_SIZE = 8;
const KEY = 'inukshuk.v1.build';
const MAX_HISTORY = 40;

export type Tray = Record<StoneStyle, (number | null)[]>;

/** A settled moment of the build: what stood, and what was left in the tray. */
export interface Snapshot {
  stones: PlacedStone[];
  tray: Tray;
}

export interface Session {
  stones: PlacedStone[];
  tray: Tray;
  style: StoneStyle;
  angle: number; // tray rotation, radians, in 45° steps
  history: Snapshot[];
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
    return { ...s, style: s.style ?? 0, angle: s.angle ?? 0 };
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
  if (!session) {
    session = { stones: [], tray: { 0: freshBatch(), 1: freshBatch(), 2: freshBatch() }, style: 0, angle: 0, history: [] };
    pushHistory(session, snapshot(session));
  }
  return session;
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
export const draft = { stones: [] as PlacedStone[], created: 0 };
