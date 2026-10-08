// قراءة الأخبار الجاهزة من data/feeds.json (بيكتبها GitHub Action) + مصادر الأقسام

let cache = null;
let cfgCache = null;

export async function loadConfig() {
  if (!cfgCache) cfgCache = await (await fetch('config/sources.json', { cache: 'no-cache' })).json();
  return cfgCache;
}

export async function loadFeeds() {
  if (!cache) {
    const r = await fetch('data/feeds.json', { cache: 'no-cache' });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    cache = await r.json();
  }
  return cache;
}

export function timeAgo(iso) {
  if (!iso) return '';
  const m = Math.round((Date.now() - Date.parse(iso)) / 60000);
  if (m < 1) return 'دلوقتي';
  if (m < 60) return `من ${m} دقيقة`;
  const h = Math.round(m / 60);
  if (h < 24) return `من ${h} ساعة`;
  return `من ${Math.round(h / 24)} يوم`;
}

export function hostOf(url) {
  try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return ''; }
}
