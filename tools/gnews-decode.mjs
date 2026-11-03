// فك روابط Google News (news.google.com/rss/articles/CBMi…) للرابط الحقيقي للمقال.
// الروابط دي صفحة تحويل بجافاسكريبت، فقرّاء المقالات بيجيبوا صفحة جوجل مش المقال.
// الصيغة القديمة: الرابط مكتوب جوه الـ id (base64). الجديدة (AU_yqL…): لازم نسأل جوجل (batchexecute) بالتوقيع اللي في صفحة المقال.
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';

export const isGnews = u => /^https?:\/\/news\.google\.com\/(rss\/)?articles\//.test(u || '');
export const gnewsId = u => { try { return new URL(u).pathname.split('/').pop(); } catch { return ''; } };

// الصيغة القديمة بس (من غير شبكة). بيرجّع null لو الـ id من الصيغة الجديدة
export function decodeOld(id) {
  try {
    const raw = Buffer.from(id.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('latin1');
    if (/AU_yqL/.test(raw)) return null;
    const m = raw.match(/https?:\/\/[\x21-\x7e]+/);
    return m ? m[0].replace(/[\x00-\x1f\x7f-\xff].*$/, '') : null;
  } catch { return null; }
}

export async function decodeGnews(url, fetchImpl = fetch) {
  const id = gnewsId(url);
  if (!id) return null;
  const old = decodeOld(id);
  if (old) return old;
  const page = await fetchImpl(`https://news.google.com/articles/${id}`, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(15000) });
  const html = await page.text();
  const sg = html.match(/data-n-a-sg="([^"]+)"/)?.[1], ts = html.match(/data-n-a-ts="([^"]+)"/)?.[1];
  if (!sg || !ts) return null;
  const inner = `["garturlreq",[["X","X",["X","X"],null,null,1,1,"US:en",null,1,null,null,null,null,null,0,1],"X","X",1,[1,1,1],1,1,null,0,0,null,0],"${id}",${ts},"${sg}"]`;
  const body = 'f.req=' + encodeURIComponent(JSON.stringify([[['Fbv4je', inner]]]));
  const r = await fetchImpl('https://news.google.com/_/DotsSplashUi/data/batchexecute', {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8', 'User-Agent': UA }, body, signal: AbortSignal.timeout(15000),
  });
  return parseBatch(await r.text());
}

// الرد: سطر غريب في الأول، وبعدين JSON؛ الرابط جوه نص JSON تاني
export function parseBatch(text) {
  try {
    const part = text.split('\n\n')[1] || text.replace(/^\)\]\}'\s*/, '');
    const arr = JSON.parse(part);
    const row = arr.find(x => Array.isArray(x) && x[1] === 'Fbv4je') || arr[0];
    const res = JSON.parse(row[2]);
    return typeof res[1] === 'string' && /^https?:/.test(res[1]) ? res[1] : null;
  } catch { return null; }
}
