// الرادار: تاريخ الترند (امتى طلع، بقاله قد ايه، أعلى ترتيب) + الأكثر مشاهدة على يوتيوب في كل دولة.
// بيتنادى من آخر tools/fetch-feeds.mjs. من غير مكتبات. آمن للاستيراد في الاختبارات (مفيش كود بيشتغل لوحده).

const KEEP_H = 14 * 24; // نحتفظ بالترند ١٤ يوم من آخر مرة ظهر

export const normT = s => String(s || '').toLowerCase()
  .replace(/[ً-ٰٟـ]/g, '').replace(/[أإآ]/g, 'ا').replace(/ى/g, 'ي').replace(/ة/g, 'ه')
  .replace(/[^\p{L}\p{N}]+/gu, ' ').trim();

// prev = محتوى data/trends.json القديم، items = عناصر feeds.json الجديدة
export function updateHistory(prev, items, nowIso = new Date().toISOString()) {
  const now = Date.parse(nowIso);
  const t = { ...(prev?.t || {}) };
  for (const i of items) {
    if (i.tk !== 'trend' || !/^(gt|wiki)-/.test(i.feed || '')) continue;
    const key = i.feed + '|' + normT(i.title);
    const o = t[key] || { title: i.title, feed: i.feed, first: nowIso, seen: 0, best: 999, peak: 0, ranks: [] };
    if (o.last === nowIso) continue; // نفس التشغيلة
    o.title = i.title; o.last = nowIso; o.seen++;
    o.cat = i.category; o.link = i.url || i.link; o.region = i.region;
    if (i.rank) { o.best = Math.min(o.best, i.rank); o.ranks = [...(o.ranks || []), i.rank].slice(-24); }
    o.peak = Math.max(o.peak, i.traffic || i.views || 0);
    t[key] = o;
  }
  for (const [k, o] of Object.entries(t)) if (now - Date.parse(o.last) > KEEP_H * 36e5) delete t[k];
  return { updated: nowIso, t };
}

// ترند عابر للدول: نفس العنوان (بعد التطبيع) في أكتر من دولة خلال آخر `hours` ساعة
export function crossCountry(hist, hours = 36, now = Date.now()) {
  const g = new Map();
  for (const o of Object.values(hist?.t || {})) {
    if (!o.feed.startsWith('gt-') || now - Date.parse(o.last) > hours * 36e5) continue;
    const k = normT(o.title);
    if (!g.has(k)) g.set(k, { title: o.title, feeds: new Set(), peak: 0, first: o.first });
    const x = g.get(k); x.feeds.add(o.feed); x.peak += o.peak || 0; if (o.first < x.first) x.first = o.first;
  }
  return [...g.values()].filter(x => x.feeds.size > 1).map(x => ({ ...x, feeds: [...x.feeds] }))
    .sort((a, b) => b.feeds.length - a.feeds.length || b.peak - a.peak);
}

// الأكثر مشاهدة على يوتيوب (YouTube Data API v3، مجاني لحد ١٠٠٠٠ وحدة/يوم؛ كل دولة = وحدة واحدة)
export async function ytTrending(key, regions, fetchFn = fetch) {
  const out = { updated: new Date().toISOString(), regions: {}, errors: {} };
  for (const r of regions) {
    try {
      const u = `https://www.googleapis.com/youtube/v3/videos?part=snippet,statistics&chart=mostPopular&maxResults=20&regionCode=${r}&key=${encodeURIComponent(key)}`;
      const res = await fetchFn(u);
      const j = await res.json();
      if (!res.ok) throw new Error(j?.error?.message || res.status);
      out.regions[r] = (j.items || []).map((v, n) => ({
        id: v.id, rank: n + 1, title: v.snippet?.title, channel: v.snippet?.channelTitle,
        published: v.snippet?.publishedAt, views: +(v.statistics?.viewCount || 0),
        likes: +(v.statistics?.likeCount || 0), comments: +(v.statistics?.commentCount || 0),
        thumb: v.snippet?.thumbnails?.medium?.url || '',
      }));
    } catch (e) { out.errors[r] = String(e.message || e).replace(key, '***'); }
  }
  return out;
}
