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

// الريبو بتاع البرنامج (من رابط GitHub Pages، وإلا الافتراضي)
export function repoSlug() {
  const h = location.hostname, seg = location.pathname.split('/').filter(Boolean)[0];
  return h.endsWith('.github.io') && seg ? `${h.split('.')[0]}/${seg}` : 'powerflash1000/news-reels-studio';
}
// أحدث نسخة من الأخبار: من GitHub مباشرة (أسرع من GitHub Pages اللي بياخد دقايق بعد كل تحديث)
export async function reloadFeeds() {
  const urls = [`https://raw.githubusercontent.com/${repoSlug()}/main/data/feeds.json?t=${Date.now()}`, `data/feeds.json?t=${Date.now()}`];
  let last;
  for (const u of urls) {
    try { const r = await fetch(u, { cache: 'no-store' }); if (!r.ok) throw new Error('HTTP ' + r.status); cache = await r.json(); return cache; } catch (e) { last = e; }
  }
  throw last;
}
// تشغيل تحديث الأخبار على GitHub دلوقتي (محتاج توكن GitHub بصلاحية Actions على الريبو ده بس) ومستني لحد ما يخلص
export async function runFeedsNow(token, onStep) {
  const api = `https://api.github.com/repos/${repoSlug()}/actions`;
  const h = { Authorization: `Bearer ${token.trim()}`, Accept: 'application/vnd.github+json' };
  const since = Date.now() - 5000;
  const r = await fetch(`${api}/workflows/fetch-feeds.yml/dispatches`, { method: 'POST', headers: { ...h, 'Content-Type': 'application/json' }, body: JSON.stringify({ ref: 'main' }) });
  if (r.status === 401 || r.status === 403) throw new Error('توكن GitHub مرفوض: لازم يكون Fine-grained للريبو ده وفيه صلاحية Actions: Read and write.');
  if (!r.ok) throw new Error(`GitHub رفض تشغيل التحديث (${r.status}).`);
  const t0 = Date.now();
  while (Date.now() - t0 < 300000) {
    await new Promise(res => setTimeout(res, 8000));
    onStep?.(Math.round((Date.now() - t0) / 1000));
    const j = await (await fetch(`${api}/workflows/fetch-feeds.yml/runs?event=workflow_dispatch&per_page=3`, { headers: h, cache: 'no-store' })).json().catch(() => ({}));
    const run = (j.workflow_runs || []).find(x => Date.parse(x.created_at) >= since);
    if (run?.status === 'completed') {
      if (run.conclusion !== 'success') throw new Error('التحديث على GitHub فشل (افتح تبويب Actions تشوف السبب).');
      await new Promise(res => setTimeout(res, 3000)); // نستنى الحفظ يوصل
      return reloadFeeds();
    }
  }
  throw new Error('التحديث لسه شغال على GitHub بعد 5 دقايق. جرّب «هات أحدث أخبار» كمان شوية.');
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
