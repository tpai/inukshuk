export type Lang = 'zh' | 'en';

const dict = {
  tagline: { zh: '一顆一顆疊起來，讓它替你守著這片山。', en: 'Stack it stone by stone, and let it keep watch here.' },
  empty: { zh: '山脊上還沒有石人。', en: 'No inukshuk on the ridge yet.' },
  newOne: { zh: '疊一座新的', en: 'Build a new one' },
  back: { zh: '返回', en: 'Back' },
  undo: { zh: '復原', en: 'Undo' },
  clear: { zh: '清空', en: 'Clear' },
  river: { zh: '河石', en: 'River' },
  canyon: { zh: '峽谷石', en: 'Canyon' },
  slate: { zh: '板岩', en: 'Slate' },
  turnLeft: { zh: '左轉 45°', en: 'Left 45°' },
  turnRight: { zh: '右轉 45°', en: 'Right 45°' },
  reroll: { zh: '換一批', en: 'New batch' },
  done: { zh: '完成', en: 'Done' },
  hintStart: { zh: '從下方拖一顆石頭上來', en: 'Drag a stone up from below' },
  hintLegs: { zh: '需要兩隻分開、著地的腳', en: 'It needs two separate legs on the ground' },
  hintBody: { zh: '放一塊石頭橫跨兩隻腳，當作身體', en: 'Lay a stone across both legs for a body' },
  hintSettle: { zh: '等它站穩…', en: 'Waiting for it to settle…' },
  hintReady: { zh: '站穩了', en: 'It stands' },
  hintFull: { zh: '最多 20 顆石頭', en: '20 stones at most' },
  hintRotate: { zh: '雙指或滾輪可以旋轉', en: 'Two fingers or the scroll wheel rotate' },
  started: { zh: '開始疊', en: 'Started' },
  took: { zh: '花了', en: 'Took' },
  stones: { zh: '石頭', en: 'Stones' },
  stonesDetail: { zh: '{n} 顆，放了 {m} 次，復原 {u} 次', en: '{n}, placed {m} times, {u} undos' },
  hours: { zh: '{n} 小時', en: '{n} h' },
  minutes: { zh: '{n} 分', en: '{n} min' },
  seconds: { zh: '{n} 秒', en: '{n} s' },
  keepBuilding: { zh: '繼續疊', en: 'Keep building' },
  save: { zh: '放上山脊', en: 'Place on the ridge' },
  saved: { zh: '已放上山脊', en: 'Placed on the ridge' },
  share: { zh: '複製分享連結', en: 'Copy share link' },
  copied: { zh: '已複製分享連結', en: 'Share link copied' },
  copyFailed: { zh: '無法自動複製，請長按網址列複製', en: 'Could not copy automatically; copy the address bar instead' },
  remove: { zh: '移除', en: 'Remove' },
  removeConfirm: { zh: '再按一次移除', en: 'Tap again to remove' },
  buildMine: { zh: '我也來疊一座', en: 'Build my own' },
  someoneLeft: { zh: '有人在這裡留下了它', en: 'Someone left this here' },
  builtToday: { zh: '今天疊的', en: 'Built today' },
  builtDays: { zh: '{n} 天前疊的', en: 'Built {n} days ago' },
  builtDay: { zh: '1 天前疊的', en: 'Built 1 day ago' },
  brokenLink: { zh: '這個連結無法讀取，可能被截斷了。', en: 'This link could not be read. It may have been cut short.' },
  notFound: { zh: '找不到這座石人，可能已經移除。', en: 'This inukshuk is gone. It may have been removed.' },
  soundOn: { zh: '開啟聲音', en: 'Turn sound on' },
  soundOff: { zh: '關閉聲音', en: 'Turn sound off' },
  about: { zh: '關於 Inuksuk（YouTube 影片，在新視窗開啟）', en: 'About the inuksuk (YouTube video, opens in a new window)' },
  langSwitch: { zh: 'EN', en: '中文' },
  langLabel: { zh: 'Switch to English', en: '切換為中文' },
  spring: { zh: '春', en: 'spring' },
  summer: { zh: '夏', en: 'summer' },
  autumn: { zh: '秋', en: 'autumn' },
  winter: { zh: '冬', en: 'winter' },
  seasonNow: { zh: '你那裡正是{s}天', en: "it's {s} where you are" },
} satisfies Record<string, Record<Lang, string>>;

export type Key = keyof typeof dict;

function detect(): Lang {
  try {
    const saved = localStorage.getItem('inukshuk.lang');
    if (saved === 'zh' || saved === 'en') return saved;
  } catch {
    /* ignore */
  }
  return navigator.language.toLowerCase().startsWith('zh') ? 'zh' : 'en';
}

export let lang: Lang = detect();
const listeners = new Set<() => void>();

export function setLang(l: Lang) {
  lang = l;
  try {
    localStorage.setItem('inukshuk.lang', l);
  } catch {
    /* ignore */
  }
  document.documentElement.lang = l === 'zh' ? 'zh-Hant' : 'en';
  listeners.forEach((f) => f());
}

export function onLang(f: () => void) {
  listeners.add(f);
  return () => listeners.delete(f);
}

export function t(k: Key, vars?: Record<string, string | number>): string {
  let s: string = dict[k][lang];
  if (vars) for (const [a, b] of Object.entries(vars)) s = s.replace('{' + a + '}', String(b));
  return s;
}

export function builtAgo(days: number): string {
  const d = Math.floor(days);
  if (d < 1) return t('builtToday');
  if (d === 1) return t('builtDay');
  return t('builtDays', { n: d });
}

export function formatDuration(ms: number): string {
  const total = Math.max(1, Math.round(ms / 1000));
  const h = Math.floor(total / 3600), m = Math.floor((total % 3600) / 60), s = total % 60;
  const parts: string[] = [];
  if (h) parts.push(t('hours', { n: h }));
  if (m) parts.push(t('minutes', { n: m }));
  if (s && !h) parts.push(t('seconds', { n: s }));
  return parts.join(' ');
}

export function formatDateTime(ms: number): string {
  return new Intl.DateTimeFormat(lang === 'zh' ? 'zh-Hant' : 'en', { dateStyle: 'medium', timeStyle: 'short' }).format(ms);
}

document.documentElement.lang = lang === 'zh' ? 'zh-Hant' : 'en';
