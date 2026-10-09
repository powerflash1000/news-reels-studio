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
  return r;
}

await probe('nasa-search', 'https://images-api.nasa.gov/search?q=mars&media_type=image,video&page_size=3', {
  follow: async j => {
    const id = j.collection.items[0].data[0].nasa_id;
    const res = await fetch('https://images-api.nasa.gov/asset/' + encodeURIComponent(id), { headers: { Origin: 'https://powerflash1000.github.io' } });
    return { id, status: res.status, acao: res.headers.get('access-control-allow-origin'), sample: (await res.text()).slice(0, 1500) };
  },
});
await probe('commons-image', 'https://commons.wikimedia.org/w/api.php?action=query&generator=search&gsrnamespace=6&gsrsearch=heart%20anatomy&gsrlimit=3&prop=imageinfo&iiprop=url%7Cextmetadata%7Cmime%7Csize&iiurlwidth=640&format=json&origin=*');
await probe('commons-video', 'https://commons.wikimedia.org/w/api.php?action=query&generator=search&gsrnamespace=6&gsrsearch=filetype%3Avideo%20mars&gsrlimit=3&prop=imageinfo&iiprop=url%7Cextmetadata%7Cmime%7Csize%7Cduration&format=json&origin=*');
await probe('openverse', 'https://api.openverse.org/v1/images/?q=heart&page_size=3&license_type=commercial,modification');
await probe('archive-search', 'https://archive.org/advancedsearch.php?q=mars+AND+mediatype%3Amovies&fl%5B%5D=identifier&fl%5B%5D=title&fl%5B%5D=creator&fl%5B%5D=licenseurl&rows=3&output=json', {
  follow: async j => {
    const id = j.response.docs[0].identifier;
    const res = await fetch('https://archive.org/metadata/' + id, { headers: { Origin: 'https://powerflash1000.github.io' } });
    const m = await res.json();
    return { id, status: res.status, acao: res.headers.get('access-control-allow-origin'), server: m.server, dir: m.dir, files: (m.files || []).slice(0, 8).map(f => ({ name: f.name, format: f.format, size: f.size })), license: m.metadata?.licenseurl };
  },
});
await probe('pixabay-nokey', 'https://pixabay.com/api/?key=x&q=mars');
await probe('smithsonian', 'https://api.si.edu/openaccess/api/v1.0/search?q=heart+AND+online_media_type%3A%22Images%22&rows=2&api_key=DEMO_KEY');

await writeFile('data/media-probe.json', JSON.stringify({ at: new Date().toISOString(), results: out }, null, 1));
for (const r of out) console.log(r.name, r.status ?? r.error, 'ACAO=' + r.acao);
