// فحص لمرة واحدة: بيجيب رد كل API وسائط ويسجّل الحالة وهيدر CORS وعيّنة من الرد (بيشتغل في GitHub Actions)
import { writeFile } from 'node:fs/promises';

const UA = 'Mozilla/5.0 (compatible; news-reels-studio media probe)';
const out = [];

async function probe(name, url, { follow } = {}) {
  const r = { name, url };
  try {
    const res = await fetch(url, { headers: { 'User-Agent': UA, Origin: 'https://powerflash1000.github.io', Accept: 'application/json' }, signal: AbortSignal.timeout(25000) });
    const body = await res.text();
    Object.assign(r, { status: res.status, contentType: res.headers.get('content-type'), acao: res.headers.get('access-control-allow-origin'), bytes: body.length, sample: body.slice(0, 2500) });
    if (follow && res.ok) { try { r.next = await follow(JSON.parse(body)); } catch (e) { r.nextError = String(e.message || e); } }
  } catch (e) { r.error = String(e.message || e); }
  out.push(r);
  await writeFile('data/media-probe.json', JSON.stringify({ at: new Date().toISOString(), results: out }, null, 1));
  console.log(r.name, r.status ?? r.error, 'ACAO=' + r.acao);
  return r;
}

// المرحلة 2: هل مواقع الملفات نفسها (صور/فيديو) بتسمح بالقراءة من المتصفح؟ (ضروري عشان الكانفس ما يتلوّثش)
async function head(name, url) {
  const r = { name, url };
  try {
    const res = await fetch(url, { method: 'HEAD', redirect: 'follow', headers: { 'User-Agent': UA, Origin: 'https://powerflash1000.github.io' }, signal: AbortSignal.timeout(20000) });
    Object.assign(r, { status: res.status, finalUrl: res.url, acao: res.headers.get('access-control-allow-origin'), type: res.headers.get('content-type'), length: res.headers.get('content-length') });
  } catch (e) { r.error = String(e.message || e); }
  out.push(r);
  await writeFile('data/media-probe.json', JSON.stringify({ at: new Date().toISOString(), results: out }, null, 1));
  console.log(r.name, r.status ?? r.error, 'ACAO=' + r.acao, r.finalUrl || '');
}
const nasa = 'https://images-assets.nasa.gov/video/JPL-20190606-TECHf-0001-Mars%20Chopper%20Ready%20for%20a%20Spin%20on%20Mars/JPL-20190606-TECHf-0001-Mars%20Chopper%20Ready%20for%20a%20Spin%20on%20Mars';
await head('nasa-thumb', nasa + '~thumb.jpg');
await head('nasa-video-medium', nasa + '~medium.mp4');
await head('nasa-video-large', nasa + '~large.mp4');
await head('commons-original', 'https://upload.wikimedia.org/wikipedia/commons/5/57/Heart_frontally_PDA.jpg');
await head('commons-thumb', 'https://thumb.wikimedia.org/wikipedia/commons/thumb/5/57/Heart_frontally_PDA.jpg/960px-Heart_frontally_PDA.jpg');
await head('commons-webm', 'https://upload.wikimedia.org/wikipedia/commons/0/05/Mars_360.webm');
await head('openverse-thumb', 'https://api.openverse.org/v1/images/413bf4cb-ad4a-49c9-84f6-fda46dbc1fd7/thumb/');
await head('flickr-original', 'https://live.staticflickr.com/4068/4397711604_2afe581dcc.jpg');
await head('archive-mp4', 'https://archive.org/download/youtube-cUwYCgRY3ZM/cUwYCgRY3ZM.mp4');
await head('archive-thumb', 'https://archive.org/services/img/youtube-cUwYCgRY3ZM');
await head('pixabay-cdn-image', 'https://cdn.pixabay.com/photo/2015/04/23/22/00/tree-736885_1280.jpg');
