// The viewer's world: time of day, season, hemisphere, wind, plus debug overrides.

export type Season = 'spring' | 'summer' | 'autumn' | 'winter';

export interface DebugOverrides {
  hour: number | null;
  season: Season | null;
  hemisphere: 'north' | 'south' | null;
  ageDays: number | null;
  showColliders: boolean;
  showBones: boolean;
  animalState: 'idle' | 'walk' | 'run' | 'sleep' | null;
}

export const debug: DebugOverrides = {
  hour: null,
  season: null,
  hemisphere: null,
  ageDays: null,
  showColliders: false,
  showBones: false,
  animalState: null,
};

export const debugEnabled = new URLSearchParams(location.search).has('debug');

const SOUTHERN_ZONES = [
  'Australia/', 'Antarctica/', 'Pacific/Auckland', 'Pacific/Chatham', 'Pacific/Fiji', 'Pacific/Tongatapu',
  'Pacific/Apia', 'Pacific/Noumea', 'Pacific/Efate', 'Pacific/Tahiti', 'Pacific/Easter', 'Pacific/Galapagos',
  'America/Argentina', 'America/Buenos_Aires', 'America/Santiago', 'America/Sao_Paulo', 'America/Montevideo',
  'America/Asuncion', 'America/La_Paz', 'America/Lima', 'America/Punta_Arenas', 'America/Cuiaba',
  'America/Campo_Grande', 'America/Porto_Velho', 'America/Recife', 'America/Bahia', 'America/Maceio',
  'America/Fortaleza', 'America/Belem', 'America/Manaus', 'America/Noronha', 'America/Rio_Branco',
  'Africa/Johannesburg', 'Africa/Maputo', 'Africa/Harare', 'Africa/Lusaka', 'Africa/Windhoek',
  'Africa/Gaborone', 'Africa/Maseru', 'Africa/Mbabane', 'Africa/Luanda', 'Africa/Lubumbashi',
  'Africa/Blantyre', 'Africa/Dar_es_Salaam', 'Indian/Antananarivo', 'Indian/Mauritius', 'Indian/Reunion',
  'Atlantic/Stanley', 'Atlantic/South_Georgia', 'Asia/Jakarta', 'Asia/Makassar', 'Asia/Jayapura', 'Asia/Dili',
];

function detectSouthern(): boolean {
  try {
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone || '';
    return SOUTHERN_ZONES.some((z) => tz.startsWith(z));
  } catch {
    return false;
  }
}

const southernByZone = detectSouthern();

export interface Env {
  hour: number; // 0..24, fractional
  season: Season;
  southern: boolean;
}

const NORTH: Season[] = ['winter', 'winter', 'spring', 'spring', 'spring', 'summer', 'summer', 'summer', 'autumn', 'autumn', 'autumn', 'winter'];
const FLIP: Record<Season, Season> = { spring: 'autumn', summer: 'winter', autumn: 'spring', winter: 'summer' };

export function getEnv(): Env {
  const d = new Date();
  const hour = debug.hour ?? d.getHours() + d.getMinutes() / 60 + d.getSeconds() / 3600;
  const southern = debug.hemisphere ? debug.hemisphere === 'south' : southernByZone;
  let season = NORTH[d.getMonth()];
  if (southern) season = FLIP[season];
  if (debug.season) season = debug.season;
  return { hour, season, southern };
}

export function ageDays(created: number): number {
  if (debug.ageDays !== null) return debug.ageDays;
  return Math.max(0, (Date.now() - created) / 86_400_000);
}

/** 0 at full day, 1 at deep night. */
export function nightness(hour: number): number {
  if (hour >= 7 && hour <= 17.5) return 0;
  if (hour >= 20 || hour <= 4.5) return 1;
  if (hour < 7) return 1 - (hour - 4.5) / 2.5;
  return (hour - 17.5) / 2.5;
}

// ---- wind ----

let gust = 0;
let gustTarget = 0;
let nextGust = 8 + Math.random() * 15;
let t = 0;

export const wind = { value: 0.3 };

export function triggerGust() {
  gustTarget = 1;
}

export function updateWind(dt: number) {
  t += dt;
  nextGust -= dt;
  if (nextGust <= 0) {
    triggerGust();
    nextGust = 12 + Math.random() * 25;
  }
  gust += (gustTarget - gust) * Math.min(1, dt * 1.6);
  if (gust > 0.95) gustTarget = 0;
  wind.value = 0.22 + 0.12 * Math.sin(t * 0.13) + 0.06 * Math.sin(t * 0.71) + gust * 0.75;
}

export const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
