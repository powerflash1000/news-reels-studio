// بيسحب الـ RSS من config/sources.json ويكتب data/feeds.json (بيشتغل في GitHub Actions، Node 20+ من غير مكتبات)
import { readFile, writeFile } from 'node:fs/promises';

const MAX_PER_SOURCE = 25;
const KEEP_DAYS = 10;
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
      summary: clean(tag(b, 'description') || tag(b, 'summary') || tag(b, 'media:description')).slice(0, 400),
      link: decode(link).trim(),
      published: Number.isNaN(t) ? null : new Date(t).toISOString(),
    };
  }).filter(i => i.title && i.link);
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

const cfg = JSON.parse(await readFile('config/sources.json', 'utf8'));
let prev = { items: [] };
try { prev = JSON.parse(await readFile('data/feeds.json', 'utf8')); } catch { /* أول مرة */ }
const prevIds = JSON.parse(await readFile('data/channel-ids.json', 'utf8').catch(() => '{}'));

const health = [];
const fresh = [];

// مصدر واحد: بيسجل حالته (سليم / فاضي / فشل) وسبب أي مشكلة
async function pull(id, name, category, url, lang, kind, limit) {
  const h = { id, name, category, kind, url, status: 'ok', fetched: 0, newest: null };
  health.push(h);
  try {
    const body = await get(url);
    const items = parseFeed(body);
    h.fetched = items.length;
    if (!items.length) {
      h.status = 'empty';
      h.error = `الرد اتقرا (${body.length} حرف) بس مفيش عناصر. أول الرد: ` + body.replace(/\s+/g, ' ').slice(0, 120);
    }
    for (const i of items.slice(0, limit)) fresh.push({ ...i, kind, category, source: name, lang, feed: id });
    h.newest = items.map(i => i.published).filter(Boolean).sort().pop() || null;
  } catch (e) {
    h.status = 'error';
    h.error = String(e.message || e);
  }
}

await Promise.all([
  ...cfg.feeds.map(f => pull(f.id, f.name, f.category, f.url, f.lang, 'official', MAX_PER_SOURCE)),
  ...(cfg.youtube || []).map(async y => {
    try {
      const id = prevIds[y.handle] || (prevIds[y.handle] = await resolveChannelId(y.handle));
      await pull('yt-' + y.handle, y.name, y.category, `https://www.youtube.com/feeds/videos.xml?channel_id=${id}`, 'ar', 'youtube', 15);
    } catch (e) {
      health.push({ id: 'yt-' + y.handle, name: y.name, category: y.category, kind: 'youtube', status: 'error', fetched: 0, error: String(e.message || e) });
    }
  }),
]);

// دمج مع القديم، وإزالة المكرر والأقدم من المدة المسموحة
const now = Date.now();
const seen = new Map();
for (const i of [...fresh, ...prev.items || []]) {
  if (seen.has(i.link)) continue;
  const days = i.kind === 'youtube' ? KEEP_DAYS_YT : KEEP_DAYS;
  if (i.published && Date.parse(i.published) < now - days * 864e5) continue;
  seen.set(i.link, i);
}
const items = [...seen.values()]
  .sort((a, b) => (Date.parse(b.published) || 0) - (Date.parse(a.published) || 0))
  .map((i, n) => ({ id: `${i.feed}-${n}-${Math.abs([...i.link].reduce((h, c) => (h * 31 + c.charCodeAt(0)) | 0, 7))}`, ...i }));

for (const h of health) {
  h.kept = items.filter(i => i.feed === h.id).length;
  if (h.status === 'ok' && h.fetched && !h.kept) { h.status = 'stale'; h.error = 'العناصر كلها أقدم من المدة المسموحة'; }
}
health.sort((a, b) => a.id.localeCompare(b.id));
const errors = health.filter(h => h.status !== 'ok').map(h => ({ feed: h.id, status: h.status, error: h.error }));

await writeFile('data/feeds.json', JSON.stringify({ generatedAt: new Date().toISOString(), errors, health, items }, null, 1));
await writeFile('data/channel-ids.json', JSON.stringify(prevIds, null, 1));
console.log(`items: ${items.length}, problems: ${errors.length}`);
for (const e of errors) console.log(' !', e.feed, e.status, e.error);
