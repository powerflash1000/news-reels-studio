// بيسحب الـ RSS من config/sources.json ويكتب data/feeds.json (بيشتغل في GitHub Actions، Node 20+ من غير مكتبات)
import { readFile, writeFile } from 'node:fs/promises';

const MAX_PER_SOURCE = 20;
const MAX_KEPT_PER_FEED = 20;
const KEEP_DAYS = 45;
const KEEP_DAYS_YT = 30;
const UA = 'Mozilla/5.0 (compatible; news-reels-studio feed fetcher)';

const ENT = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };
const decode = s => s
  .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
  .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
  .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(+d))
  .replace(/&([a-z]+);/gi, (m, n) => ENT[n.toLowerCase()] ?? m);
const clean = s => decode(decode(s || '')).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();

function tag(block, name) {
  const m = block.match(new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)</${name}>`, 'i'));
  return m ? m[1] : '';
}

export function parseFeed(xml) {
  const blocks = xml.match(/<(item|entry)[\s>][\s\S]*?<\/\1>/gi) || [];
  return blocks.map(b => {
    let link = clean(tag(b, 'link'));
    if (!link) link = (b.match(/<link[^>]+href="([^"]+)"/i) || [])[1] || '';
    const date = clean(tag(b, 'pubDate') || tag(b, 'published') || tag(b, 'updated') || tag(b, 'dc:date'));
    const t = Date.parse(date);
    return {
      title: clean(tag(b, 'title')),
      summary: clean(tag(b, 'description') || tag(b, 'summary') || tag(b, 'media:description')).slice(0, 600),
      link: decode(link).trim(),
      published: Number.isNaN(t) ? null : new Date(t).toISOString(),
    };
  }).filter(i => i.title && i.link);
}

// Google Trends (الجديد): <title>=البحث، <ht:approx_traffic>، وأخبار مرتبطة <ht:news_item>
export function parseGTrends(xml) {
  const blocks = xml.match(/<item[\s>][\s\S]*?<\/item>/gi) || [];
  return blocks.map(b => {
    const title = clean(tag(b, 'title'));
    const trafficTxt = clean(tag(b, 'ht:approx_traffic'));
    const m = trafficTxt.match(/([\d.,]+)\s*([KMB]?)/i);
    const traffic = m ? Math.round(parseFloat(m[1].replace(/,/g, '')) * ({ K: 1e3, M: 1e6, B: 1e9 }[(m[2] || '').toUpperCase()] || 1)) : 0;
    const news = (b.match(/<ht:news_item>[\s\S]*?<\/ht:news_item>/gi) || []).map(n => ({
      title: clean(tag(n, 'ht:news_item_title')), url: decode(clean(tag(n, 'ht:news_item_url'))), src: clean(tag(n, 'ht:news_item_source')),
    })).filter(n => n.title);
    const t = Date.parse(clean(tag(b, 'pubDate')));
    const link = news[0]?.url || decode(clean(tag(b, 'link')));
    return {
      title, traffic,
      summary: `حجم البحث التقريبي: ${trafficTxt || 'عالي'}. ` + news.slice(0, 3).map(n => `${n.title}${n.src ? ' (' + n.src + ')' : ''}`).join(' • '),
      link, published: Number.isNaN(t) ? null : new Date(t).toISOString(),
    };
  }).filter(i => i.title && i.link);
}

// ويكيبيديا: أكتر المقالات مشاهدة امبارح (بنتخطى الصفحة الرئيسية وصفحات النظام)
const WIKI_SKIP = /^(Main_Page|Special:|Wikipedia:|Portal:|Help:|File:|Category:|Template:|Talk:|User:|-$|الصفحة_الرئيسية|خاص:|ويكيبيديا:|بوابة:|مساعدة:|ملف:|تصنيف:|قالب:|نقاش:|مستخدم:|Accueil|Spécial:|Wikipédia:|Portada|Especial:|Wikipedia:)/;
async function wikiTop(f) {
  const lang = f.id.split('-')[1];
  for (const back of [1, 2, 3]) {
    const d = new Date(Date.now() - back * 864e5);
    const url = `https://wikimedia.org/api/rest_v1/metrics/pageviews/top/${lang}.wikipedia/all-access/${d.getUTCFullYear()}/${String(d.getUTCMonth() + 1).padStart(2, '0')}/${String(d.getUTCDate()).padStart(2, '0')}`;
    try {
      const j = JSON.parse(await get(url));
      const arts = (j.items?.[0]?.articles || []).filter(a => !WIKI_SKIP.test(a.article));
      if (arts.length) return arts.map(a => ({
        title: a.article.replace(/_/g, ' '), views: a.views,
        summary: `${a.views.toLocaleString('en')} مشاهدة على ويكيبيديا (${lang}) في يوم واحد.`,
        link: `https://${lang}.wikipedia.org/wiki/${encodeURIComponent(a.article)}`, published: d.toISOString(),
      }));
    } catch { /* جرّب اليوم اللي قبله */ }
  }
  return [];
}

// Google News: العنوان "عنوان - الناشر": بنفصل الناشر (بيتعرض كمصدر) وبنسيب الرابط
function gnewsOutlet(i) {
  const m = i.title.match(/^(.*\S)\s+[-–—]\s+([^-–—]{2,60})$/);
  return m ? { ...i, title: m[1], outlet: m[2].trim(), summary: '' } : i;
}

async function get(url) {
  const res = await fetch(url, { headers: { 'User-Agent': UA, 'Accept-Language': 'ar,en;q=0.8' }, signal: AbortSignal.timeout(25000), redirect: 'follow' });
  if (!res.ok) throw new Error('HTTP ' + res.status);
  return res.text();
}

async function resolveChannelId(handle) {
  const html = await get(`https://www.youtube.com/@${handle}`);
  const m = html.match(/"(?:channelId|externalId)":"(UC[\w-]{22})"/) || html.match(/channel_id=(UC[\w-]{22})/);
  if (!m) throw new Error('channel id not found');
  return m[1];
}

// ---- ترتيب الأهمية: موقع الخبر في مصدر «أهم الأخبار»/الترند + حجم البحث/المشاهدات + عدد الجهات اللي غطّت نفس الخبر ----
const STOP = new Set('the a an of in to for on and or is are was were at with by from as new after says say about over into this that has have will not you your it its who how why what more than 2024 2025 2026 في من على الى إلى عن مع هل ما هذا هذه ذلك التي الذي بعد قبل أن ان كان كانت يكون لا لم لن قد كل بين حتى خلال عند هو هي'.split(' '));
const toks = t => new Set(String(t).toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, ' ').split(/\s+/).filter(w => w.length >= 3 && !STOP.has(w) && !/^\d+$/.test(w)));
export function scoreItems(items, nowMs = Date.now()) {
  const recent = items.filter(i => !i.published || Date.parse(i.published) > nowMs - 72 * 36e5);
  const T = recent.map(i => toks(i.title));
  const parent = recent.map((_, n) => n);
  const find = n => (parent[n] === n ? n : (parent[n] = find(parent[n])));
  const index = new Map();
  recent.forEach((_, n) => { for (const w of T[n]) { if (!index.has(w)) index.set(w, []); index.get(w).push(n); } });
  for (let n = 0; n < recent.length; n++) {
    const shared = new Map();
    for (const w of T[n]) { const l = index.get(w); if (l.length > 60) continue; for (const m of l) if (m < n) shared.set(m, (shared.get(m) || 0) + 1); }
    for (const [m, c] of shared) {
      const j = c / (T[n].size + T[m].size - c);
      if (c >= 3 && j >= 0.3) parent[find(n)] = find(m);
    }
  }
  const groups = new Map();
  recent.forEach((i, n) => { const g = find(n); if (!groups.has(g)) groups.set(g, new Set()); groups.get(g).add(i.outlet || i.source); });
  recent.forEach((i, n) => { i.cov = groups.get(find(n)).size; });
  for (const i of items) {
    const cov = i.cov || 1;
    const pos = i.tk || i.rank && i.of && /^gn-|^gt-|^wiki-|^hn-/.test(i.feed) ? 1 - ((i.rank || 1) - 1) / Math.max(1, i.of || 15) : 0.2;
    const imp = (i.w || 1) * (0.6 + pos) + 1.6 * Math.log2(cov) + (i.traffic ? Math.log10(i.traffic) / 2.5 : 0) + (i.views ? Math.log10(i.views) / 4 : 0);
    i.imp = Math.round(imp * 100) / 100;
  }
}

const cfg = JSON.parse(await readFile('config/sources.json', 'utf8'));
let prev = { items: [] };
try { prev = JSON.parse(await readFile('data/feeds.json', 'utf8')); } catch { /* أول مرة */ }
const prevIds = JSON.parse(await readFile('data/channel-ids.json', 'utf8').catch(() => '{}'));

const health = [];
const fresh = [];

// مصدر واحد: بيسجل حالته (سليم / فاضي / فشل) وسبب أي مشكلة
async function pull(f, kind = 'official', limit = f.limit || MAX_PER_SOURCE) {
  const { id, name, category, url, lang } = f;
  const h = { id, name, category, kind, url, type: f.type || '', region: f.region || 'world', status: 'ok', fetched: 0, newest: null };
  health.push(h);
  try {
    let items;
    if (f.fmt === 'wikitop') items = await wikiTop(f);
    else {
      const body = await get(url);
      items = f.fmt === 'gtrends' ? parseGTrends(body) : parseFeed(body);
      if (f.fmt === 'gnews') items = items.map(gnewsOutlet);
      if (!items.length) {
        h.status = 'empty';
        h.error = `الرد اتقرا (${body.length} حرف) بس مفيش عناصر. أول الرد: ` + body.replace(/\s+/g, ' ').slice(0, 120);
      }
    }
    h.fetched = items.length;
    if (!items.length && h.status === 'ok') { h.status = 'empty'; h.error = 'مفيش بيانات'; }
    items.slice(0, limit).forEach((i, n) => fresh.push({
      ...i, kind, category, source: i.outlet ? `${i.outlet} (عبر Google News)` : name, lang, feed: id, type: f.type || '',
      region: f.region || 'world', rank: n + 1, of: Math.min(items.length, limit), w: f.weight || 1, ...(f.kind ? { tk: f.kind } : {}),
    }));
    h.newest = items.map(i => i.published).filter(Boolean).sort().pop() || null;
  } catch (e) {
    h.status = 'error';
    h.error = String(e.message || e);
  }
}

await Promise.all([
  ...cfg.feeds.map(f => pull(f)),
  ...(cfg.youtube || []).map(async y => {
    try {
      const id = prevIds[y.handle] || (prevIds[y.handle] = await resolveChannelId(y.handle));
      await pull({ id: 'yt-' + y.handle, name: y.name, category: y.category, url: `https://www.youtube.com/feeds/videos.xml?channel_id=${id}`, lang: 'ar', type: 'radar', region: 'eg' }, 'youtube', 15);
    } catch (e) {
      health.push({ id: 'yt-' + y.handle, name: y.name, category: y.category, kind: 'youtube', status: 'error', fetched: 0, error: String(e.message || e) });
    }
  }),
]);

// دمج مع القديم، وإزالة المكرر والأقدم من المدة المسموحة
const now = Date.now();
const seen = new Map();
const keepOf = new Map(cfg.feeds.map(f => [f.id, f.keepDays]));
for (const i of [...fresh, ...prev.items || []]) {
  if (seen.has(i.link)) continue;
  if (!keepOf.has(i.feed) && !i.feed.startsWith('yt-')) continue; // مصدر اتشال من الإعدادات
  const days = keepOf.get(i.feed) || (i.kind === 'youtube' ? KEEP_DAYS_YT : KEEP_DAYS);
  if (i.published && Date.parse(i.published) < now - days * 864e5) continue;
  seen.set(i.link, i);
}
// حد أقصى لكل مصدر عشان الملف ما يكبرش مع مدة الاحتفاظ الطويلة
const perFeed = new Map();
const items = [...seen.values()]
  .sort((a, b) => (Date.parse(b.published) || 0) - (Date.parse(a.published) || 0))
  .filter(i => { const n = (perFeed.get(i.feed) || 0) + 1; perFeed.set(i.feed, n); return n <= MAX_KEPT_PER_FEED; })
  .map((i, n) => ({ id: `${i.feed}-${n}-${Math.abs([...i.link].reduce((h, c) => (h * 31 + c.charCodeAt(0)) | 0, 7))}`, ...i }));
scoreItems(items);

for (const h of health) {
  h.kept = items.filter(i => i.feed === h.id).length;
  if (h.status === 'ok' && h.fetched && !h.kept) { h.status = 'stale'; h.error = 'العناصر كلها أقدم من المدة المسموحة (' + (h.kind === 'youtube' ? KEEP_DAYS_YT : KEEP_DAYS) + ' يوم)'; }
}
health.sort((a, b) => a.id.localeCompare(b.id));
const errors = health.filter(h => h.status !== 'ok').map(h => ({ feed: h.id, status: h.status, error: h.error }));

await writeFile('data/feeds.json', JSON.stringify({ generatedAt: new Date().toISOString(), errors, health, items }, null, 1));
await writeFile('data/channel-ids.json', JSON.stringify(prevIds, null, 1));
console.log(`items: ${items.length}, problems: ${errors.length}`);
for (const e of errors) console.log(' !', e.feed, e.status, e.error);
