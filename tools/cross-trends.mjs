// 🔀 الترند المشترك بين المنصات (مصر والسعودية): جوجل + يوتيوب + X + تيك توك → data/cross.json
// بيشتغل في GitHub Actions بعد fetch-feeds.mjs (بيقرا data/feeds.json و data/yt-trending.json اللي اتكتبوا قبله)،
// ويسحب X من getdaytrends.com (trends24 وغيره مقفولين بحماية Cloudflare من GitHub — اتجرّبوا 2026-11-27).
// تيك توك: Creative Center بيرجّع «no permission» من غير تسجيل دخول، فمفيش سحب تلقائي (الصفحة بتفتح الرابط بس). من غير مكتبات.
// الماتشنج: تطبيع عربي/إنجليزي + تطابق الكلمات أو الهاشتاج الملزوق (#الاهلي_الزمالك) — المواضيع اللي طالعة في منصتين أو أكتر فوق.
import { readFile, writeFile } from 'node:fs/promises';

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';
export const REGIONS = {
  eg: { name: 'مصر', google: 'gt-eg', yt: 'EG', x: 'egypt', tt: 'EG' },
  sa: { name: 'السعودية', google: 'gt-sa', yt: 'SA', x: 'saudi-arabia', tt: 'SA' },
};
export const PLATFORMS = { google: 'جوجل', youtube: 'يوتيوب', x: 'X', tiktok: 'تيك توك' };

// ===== تطبيع =====
const STOP = new Set(('في من على الى إلى عن مع هل ما هذا هذه ذلك التي الذي بعد قبل ان أن كان كانت لا لم لن قد كل بين حتى خلال عند هو هي او أو و يا ده دي اللي ' +
  'the a an of in to for on and or is are was were at with by from as vs new official video full live episode ep part hd 4k lyrics clip music mv مصر مصريه السعوديه سعوديه egypt saudi').split(/\s+/));
export function normAr(s) {
  return String(s || '').toLowerCase()
    .replace(/[ؐ-ًؚ-ٰٟۖ-ۭـ]/g, '')
    .replace(/[أإآٱ]/g, 'ا').replace(/ى/g, 'ي').replace(/ة/g, 'ه').replace(/ؤ/g, 'و').replace(/ئ/g, 'ي')
    .replace(/[#_]/g, ' ').replace(/[^\p{L}\p{N}\s]/gu, ' ').replace(/\s+/g, ' ').trim();
}
const stripAl = w => (/^(ال|وال|بال|لل)/.test(w) && w.length >= 5 ? w.replace(/^(وال|بال|ال|لل)/, '') : w);
export function tokensOf(s) {
  return normAr(s).split(' ').filter(w => w.length >= 2 && !STOP.has(w) && !/^\d{1,3}$/.test(w)).map(stripAl);
}
const compact = s => tokensOf(s).join('');
const tokEq = (a, b) => a === b || (a.length >= 4 && b.length >= 4 && (a.startsWith(b) || b.startsWith(a)));

// a و b من منصتين مختلفتين: نفس الموضوع؟ (لازم واحد منهم قصير — هاشتاج/بحث — عشان العناوين الطويلة ماتلزقش في بعض)
export function sameTopic(a, b) {
  const [s, l] = a.tok.length <= b.tok.length ? [a, b] : [b, a];
  if (!s.tok.length || s.tok.length > 4) return false;
  const hit = s.tok.filter(w => l.tok.some(v => tokEq(w, v))).length;
  if (hit === s.tok.length && (s.tok.length > 1 || s.tok[0].length >= 3)) return true;
  const c = s.cmp;
  return c.length >= 5 && l.cmp.includes(c);
}

// ===== المصادر =====
async function get(url, headers = {}) {
  const res = await fetch(url, { headers: { 'User-Agent': UA, 'Accept-Language': 'ar,en;q=0.8', ...headers }, signal: AbortSignal.timeout(25000), redirect: 'follow' });
  if (!res.ok) throw new Error('HTTP ' + res.status);
  return res.text();
}
const ent = s => s.replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(+d));
const strip = s => ent(String(s).replace(/<[^>]+>/g, '')).trim();

// X: أول كارت في trends24 = آخر ساعة
export function parseTrends24(html) {
  const list = html.match(/<ol[^>]*class="[^"]*trend-card__list[^"]*"[^>]*>([\s\S]*?)<\/ol>/i)?.[1] || '';
  const out = [];
  for (const li of list.match(/<li[\s\S]*?<\/li>/gi) || []) {
    const name = strip(li.match(/<a[^>]*>([\s\S]*?)<\/a>/i)?.[1] || '');
    if (!name) continue;
    const cnt = li.match(/data-count="(\d+)"/i)?.[1] || li.match(/class="[^"]*tweet-count[^"]*"[^>]*>([^<]*)</i)?.[1] || '';
    out.push({ label: name, n: cnt ? Number(String(cnt).replace(/[^\d]/g, '')) || 0 : 0, url: `https://x.com/search?q=${encodeURIComponent(name)}` });
  }
  return out;
}
// X من getdaytrends: أول جدول = «دلوقتي»؛ كل ترند لينك /<البلد>/trend/<الاسم>/
export function parseGetDayTrends(html, slug) {
  const first = html.match(/<table[\s\S]*?<\/table>/i)?.[0] || html;
  const re = new RegExp(`<a[^>]+href="/${slug}/trend/[^"]*"[^>]*>([\\s\\S]*?)</a>`, 'gi');
  const out = [], seen = new Set();
  for (const m of first.matchAll(re)) {
    const name = strip(m[1]);
    if (!name || seen.has(name)) continue;
    seen.add(name);
    out.push({ label: name, n: 0, url: `https://x.com/search?q=${encodeURIComponent(name)}` });
  }
  return out;
}
// تيك توك: صفحة Creative Center فيها __NEXT_DATA__ بالهاشتاجات (بندوّر على أي عنصر فيه hashtag_name)
export function parseTikTokCC(html) {
  const raw = html.match(/<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/i)?.[1];
  if (!raw) return [];
  let j; try { j = JSON.parse(raw); } catch { return []; }
  const found = [];
  const walk = o => {
    if (!o || typeof o !== 'object' || found.length > 200) return;
    if (Array.isArray(o)) { o.forEach(walk); return; }
    if (typeof o.hashtag_name === 'string') { found.push(o); return; }
    for (const v of Object.values(o)) walk(v);
  };
  walk(j);
  const seen = new Set();
  return found.filter(h => !seen.has(h.hashtag_name) && seen.add(h.hashtag_name))
    .sort((a, b) => (a.rank || 99) - (b.rank || 99))
    .map(h => ({ label: '#' + h.hashtag_name, n: +(h.video_views || h.publish_cnt || 0), posts: +(h.publish_cnt || 0), url: `https://www.tiktok.com/tag/${encodeURIComponent(h.hashtag_name)}`, cat: h.industry_info?.value || '' }));
}
async function tiktok(cc) {
  const pages = [
    `https://ads.tiktok.com/business/creativecenter/inspiration/popular/hashtag/pc/en?countryCode=${cc}&period=7`,
    `https://ads.tiktok.com/business/creativecenter/inspiration/popular/hashtag/pc/ar?countryCode=${cc}&period=7`,
  ];
  let last = null;
  for (const u of pages) {
    try { const r = parseTikTokCC(await get(u)); if (r.length) return r; last = new Error('الصفحة اتقرت بس مفيش هاشتاجات (تيك توك غيّر الشكل أو مانعنا)'); } catch (e) { last = e; }
  }
  throw last;
}

// ===== الماتشنج =====
export function crossMatch(entries) {
  entries.forEach(e => { e.tok = tokensOf(e.match || e.label); e.cmp = compact(e.label); });
  const parent = entries.map((_, i) => i);
  const find = i => (parent[i] === i ? i : (parent[i] = find(parent[i])));
  for (let i = 0; i < entries.length; i++) for (let k = i + 1; k < entries.length; k++) {
    if (entries[i].p === entries[k].p) continue;
    if (sameTopic(entries[i], entries[k])) parent[find(k)] = find(i);
  }
  const groups = new Map();
  entries.forEach((e, i) => { const g = find(i); if (!groups.has(g)) groups.set(g, []); groups.get(g).push(e); });
  const topics = [];
  for (const list of groups.values()) {
    const plat = {};
    for (const e of list) if (!plat[e.p] || e.rank < plat[e.p].rank) plat[e.p] = { rank: e.rank, of: e.of, label: e.label, url: e.url, n: e.n || 0 };
    const ps = Object.keys(plat);
    // الاسم: أقصر اسم من جوجل/X/تيك توك (اليوتيوب عناوين طويلة)
    const PREF = { google: 0, x: 1, tiktok: 2, youtube: 3 };
    const short = list.slice().sort((a, b) => PREF[a.p] - PREF[b.p] || a.rank - b.rank)[0];
    const pos = ps.reduce((s, p) => s + (1 - (plat[p].rank - 1) / Math.max(1, plat[p].of)), 0);
    topics.push({ label: short.label.replace(/^#/, '').replace(/_/g, ' '), tags: [...new Set(list.filter(e => e.p === 'x' || e.p === 'tiktok').map(e => e.label).filter(l => l.startsWith('#')))].slice(0, 6), platforms: plat, count: ps.length, score: Math.round((ps.length - 1) * 30 + pos * 10) });
  }
  return topics.sort((a, b) => b.count - a.count || b.score - a.score);
}

// ===== التشغيل =====
async function main() {
  const feeds = JSON.parse(await readFile('data/feeds.json', 'utf8').catch(() => '{"items":[]}'));
  const yt = JSON.parse(await readFile('data/yt-trending.json', 'utf8').catch(() => '{"regions":{}}'));
  const out = { updated: new Date().toISOString(), regions: {} };
  const now = Date.now();
  for (const [rk, R] of Object.entries(REGIONS)) {
    const src = {}, entries = [];
    const add = (p, list) => list.forEach((e, n) => entries.push({ p, rank: n + 1, of: list.length, ...e }));
    // جوجل: آخر ٣٦ ساعة، الأحدث والأعلى بحثًا
    try {
      const g = (feeds.items || []).filter(i => i.feed === R.google && (!i.published || Date.parse(i.published) > now - 36 * 36e5));
      const seen = new Set();
      const list = g.sort((a, b) => (b.traffic || 0) - (a.traffic || 0) || (Date.parse(b.published) || 0) - (Date.parse(a.published) || 0))
        .filter(i => !seen.has(normAr(i.title)) && seen.add(normAr(i.title))).slice(0, 25)
        .map(i => ({ label: i.title, n: i.traffic || 0, url: `https://trends.google.com/trends/explore?geo=${R.yt}&q=${encodeURIComponent(i.title)}` }));
      add('google', list); src.google = { ok: list.length > 0, n: list.length };
    } catch (e) { src.google = { ok: false, error: String(e.message || e) }; }
    // يوتيوب: العنوان + الوسوم
    try {
      const list = (yt.regions?.[R.yt] || []).map(v => ({ label: v.title, match: `${v.title} ${(v.tags || []).slice(0, 8).join(' ')}`, n: v.views || 0, url: `https://www.youtube.com/watch?v=${v.id}`, thumb: v.thumb }));
      add('youtube', list); src.youtube = { ok: list.length > 0, n: list.length, ...(yt.errors?.[R.yt] ? { error: yt.errors[R.yt] } : {}) };
    } catch (e) { src.youtube = { ok: false, error: String(e.message || e) }; }
    // X
    try {
      const html = await get(`https://getdaytrends.com/${R.x}/`);
      let list = parseGetDayTrends(html, R.x).slice(0, 30);
      if (!list.length) list = parseTrends24(html).slice(0, 30);
      if (!list.length) throw new Error('الصفحة اتقرت بس مفيش ترند (الشكل اتغيّر؟)');
      add('x', list); src.x = { ok: true, n: list.length };
    } catch (e) { src.x = { ok: false, error: String(e.message || e) }; }
    // تيك توك: مفيش مصدر مفتوح (Creative Center محتاج تسجيل دخول) ← رابط بس
    src.tiktok = { ok: false, error: 'تيك توك بيقفل الترند ورا تسجيل الدخول — افتح Creative Center', url: `https://ads.tiktok.com/business/creativecenter/inspiration/popular/hashtag/pc/en?countryCode=${R.tt}&period=7` };

    const topics = crossMatch(entries);
    out.regions[rk] = {
      name: R.name, sources: src,
      cross: topics.filter(t => t.count >= 2).slice(0, 40),
      // الأعلى في كل منصة لوحدها (للمقارنة)
      top: Object.fromEntries(Object.keys(PLATFORMS).map(p => [p, entries.filter(e => e.p === p).slice(0, 15).map(({ label, url, n, rank, thumb }) => ({ label, url, n, rank, ...(thumb ? { thumb } : {}) }))])),
    };
    console.log(`cross ${rk}: ${out.regions[rk].cross.length} shared topics; sources ${Object.entries(src).map(([k, v]) => `${k}:${v.ok ? v.n : 'x(' + v.error + ')'}`).join(' ')}`);
  }
  await writeFile('data/cross.json', JSON.stringify(out));
}

if (import.meta.url === `file://${process.argv[1]}`) await main();
