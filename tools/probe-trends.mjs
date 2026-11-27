// تجربة مؤقتة: أنهي مصدر لترند X وتيك توك بيرد من GitHub Actions (بيطبع الحالة وأول حاجات في الرد)
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';
const C = [
  'https://trends24.in/egypt/', 'https://getdaytrends.com/egypt/', 'https://www.twitter-trending.com/egypt/en', 'https://archive.twitter-trending.com/egypt/',
  'https://xtrends.iamrohit.in/egypt', 'https://twitter-trends.iamrohit.in/egypt', 'https://trendogate.com/', 'https://twittrends.com/eg/', 'https://www.trendsmap.com/',
  'https://ads.tiktok.com/business/creativecenter/inspiration/popular/hashtag/pc/en?countryCode=EG&period=7',
  'https://ads.tiktok.com/creative_radar_api/v1/popular_trend/hashtag/list?page=1&limit=20&period=7&country_code=EG&sort_by=popular',
  'https://ads.tiktok.com/creative_radar_api/v1/popular_trend/list?period=7&page=1&limit=20&country_code=EG',
  'https://tokchart.com/dashboard/hashtags/most-views', 'https://www.tiktok.com/api/discover/hashtag/?count=20',
];
for (const u of C) {
  try {
    const r = await fetch(u, { headers: { 'User-Agent': UA, 'Accept-Language': 'ar,en;q=0.8', Accept: 'text/html,application/json' }, signal: AbortSignal.timeout(20000), redirect: 'follow' });
    const t = await r.text();
    const tags = (t.match(/#[\p{L}\p{N}_]{3,40}/gu) || []).slice(0, 12);
    const scripts = (t.match(/<script[^>]+id="([^"]+)"/g) || []).slice(0, 6);
    console.log(`\n== ${u}\n   ${r.status} len=${t.length} title=${(t.match(/<title>([^<]*)/) || [])[1]?.slice(0, 80)}\n   tags=${tags.join(' ')}\n   scripts=${scripts.join(' ')}\n   hashtag_name=${(t.match(/hashtag_name/g) || []).length} start=${t.replace(/\s+/g, ' ').slice(0, 220)}`);
  } catch (e) { console.log(`\n== ${u}\n   ERR ${e.message}`); }
}
