// مكتبة الوسائط: بحث في مصادر مفتوحة، وكل نتيجة بترجع بنفس الشكل مع الترخيص والحقوق.
// شكل النتيجة: { id, provider, type:'image'|'video', title, thumb, url, page, author, license, licenseUrl, tier, credit, width, height, duration, size }
//   tier: 'free' = ملك عام / CC0 / سياسة NASA (من غير شرط)، 'attr' = لازم نسب (CC BY / BY-SA / Pixabay)
// أي ترخيص فيه NC أو ND أو مش واضح بيتستبعد.
import { getSettings } from './storage.js?v=mw5l428a';

const strip = html => String(html || '').replace(/<[^>]+>/g, ' ').replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#0?39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/\s+/g, ' ').trim();
const https = u => String(u || '').replace(/^http:\/\//i, 'https://');

async function getJson(url, init) {
  const res = await fetch(url, { ...init, signal: AbortSignal.timeout(20000) });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

// تصنيف الترخيص: بيرجع { tier, label } أو null لو مرفوض
export function classifyLicense(raw) {
  const t = String(raw || '').toLowerCase().replace(/[_\s]+/g, '-').trim();
  if (!t) return null;
  if (/(^|-)n[cd](-|$)/.test(t) || /noncommercial|no-derivs|noderiv/.test(t)) return null;
  if (/^(cc0|cc-zero|pdm|pd|public-domain|publicdomain)/.test(t) || /public-domain|cc0|cc-zero|pd-/.test(t)) return { tier: 'free', label: 'ملك عام / CC0' };
  const m = t.match(/^(?:cc-)?by(-sa)?(?:-([\d.]+))?$/);
  if (m) return { tier: 'attr', label: `CC BY${m[1] ? '-SA' : ''}${m[2] ? ' ' + m[2] : ''}` };
  return null;
}

function mk(o) {
  return { width: 0, height: 0, duration: 0, size: 0, author: '', page: '', licenseUrl: '', ...o };
}

function creditLine(o) {
  if (o.provider === 'nasa') return 'NASA' + (o.author && o.author !== 'NASA' ? ' / ' + o.author : '');
  const by = o.author ? `${o.author} — ` : '';
  return `${by}${o.title ? '«' + o.title.slice(0, 50) + '» — ' : ''}${o.license}${o.provider === 'commons' ? ' — Wikimedia Commons' : o.provider === 'openverse' ? ' — Openverse' : o.provider === 'archive' ? ' — Internet Archive' : o.provider === 'smithsonian' ? ' — Smithsonian' : ''}`;
}

/* ---------------- NASA ---------------- */
async function nasa(q, type) {
  const mt = type === 'video' ? 'video' : type === 'image' ? 'image' : 'image,video';
  const j = await getJson(`https://images-api.nasa.gov/search?q=${encodeURIComponent(q)}&media_type=${mt}&page_size=24`);
  return (j.collection?.items || []).map(it => {
    const d = it.data?.[0] || {};
    const thumb = (it.links || []).find(l => l.rel === 'preview')?.href;
    if (!d.nasa_id || !thumb) return null;
    const o = mk({
      id: 'nasa:' + d.nasa_id, provider: 'nasa', type: d.media_type === 'video' ? 'video' : 'image',
      title: d.title || '', thumb: https(thumb), url: null, assetsHref: d.nasa_id,
      page: 'https://images.nasa.gov/details/' + encodeURIComponent(d.nasa_id),
      author: d.photographer || d.secondary_creator || d.center || '', license: 'NASA', licenseUrl: 'https://www.nasa.gov/nasa-brand-center/images-and-media/', tier: 'free',
    });
    o.credit = creditLine(o);
    return o;
  }).filter(Boolean);
}

// الرابط الفعلي لملف NASA بيتجاب وقت الاختيار (الصور: large، الفيديو: medium عشان الحجم)
async function nasaResolve(o) {
  const j = await getJson('https://images-api.nasa.gov/asset/' + encodeURIComponent(o.assetsHref));
  const hrefs = (j.collection?.items || []).map(i => https(i.href).replace(/ /g, '%20'));
  const pick = (...keys) => { for (const k of keys) { const h = hrefs.find(x => x.includes(`~${k}.`) && /\.(jpe?g|png|mp4)$/i.test(x)); if (h) return h; } return null; };
  const url = o.type === 'video' ? pick('medium', 'large', 'small', 'mobile') : pick('large', 'medium', 'orig', 'small');
  if (!url) throw new Error('مفيش نسخة مناسبة للملف ده عند NASA');
  return url;
}

/* ---------------- Wikimedia Commons ---------------- */
async function commons(q, type) {
  const extra = type === 'video' ? 'filetype:video ' : type === 'image' ? 'filetype:bitmap ' : '';
  const url = 'https://commons.wikimedia.org/w/api.php?action=query&generator=search&gsrnamespace=6&gsrlimit=30&format=json&origin=*' +
    `&gsrsearch=${encodeURIComponent(extra + q)}&prop=imageinfo&iiprop=url%7Cextmetadata%7Cmime%7Csize&iiurlwidth=480`;
  const j = await getJson(url);
  const out = [];
  for (const p of Object.values(j.query?.pages || {}).sort((a, b) => a.index - b.index)) {
    const ii = p.imageinfo?.[0];
    if (!ii) continue;
    const mime = ii.mime || '';
    const vid = /^video\//.test(mime), img = /^image\/(jpeg|png|webp)$/.test(mime);
    if (!vid && !img) continue;
    const em = ii.extmetadata || {};
    const lic = classifyLicense(em.LicenseShortName?.value || em.License?.value);
    if (!lic) continue;
    const o = mk({
      id: 'commons:' + p.pageid, provider: 'commons', type: vid ? 'video' : 'image',
      title: strip(em.ObjectName?.value || p.title.replace(/^File:/, '')), thumb: ii.thumburl || (vid ? '' : ii.url),
      url: vid ? ii.url : (ii.thumburl && ii.width > 1600 ? ii.thumburl.replace(/\/\d+px-/, '/1600px-') : ii.url),
      page: ii.descriptionurl, author: strip(em.Artist?.value), license: strip(em.LicenseShortName?.value) || lic.label,
      licenseUrl: em.LicenseUrl?.value || '', tier: lic.tier, width: ii.width, height: ii.height, size: ii.size, duration: ii.duration || 0,
    });
    o.credit = creditLine(o);
    out.push(o);
  }
  return out;
}

/* ---------------- Openverse (صور بس) ---------------- */
async function openverse(q, type) {
  if (type === 'video') return [];
  const j = await getJson(`https://api.openverse.org/v1/images/?q=${encodeURIComponent(q)}&page_size=24&license_type=commercial,modification&mature=false`);
  return (j.results || []).map(r => {
    const lic = classifyLicense(r.license ? (r.license + (r.license_version ? '-' + r.license_version : '')) : '');
    if (!lic || !r.url) return null;
    const o = mk({
      id: 'openverse:' + r.id, provider: 'openverse', type: 'image', title: r.title || '', thumb: r.thumbnail || r.url, url: https(r.url),
      page: r.foreign_landing_url || '', author: r.creator || '', license: lic.label, licenseUrl: r.license_url || '', tier: lic.tier, width: r.width || 0, height: r.height || 0,
    });
    o.credit = r.attribution ? r.attribution.replace(/ To view a copy of this license.*$/, '') : creditLine(o);
    return o;
  }).filter(Boolean);
}

/* ---------------- Internet Archive (فيديو) ---------------- */
async function archive(q, type) {
  if (type === 'image') return [];
  return archiveDocs(`(${q}) AND mediatype:movies AND (licenseurl:*creativecommons.org/publicdomain* OR licenseurl:*creativecommons.org/licenses/by/* OR collection:prelinger OR collection:universal_newsreels OR collection:nasa OR collection:FedFlix)`, { rows: 20 });
}

// تصفح مجموعة جاهزة من غير بحث (تبويب الأرشيف): الأكتر مشاهدة الأول، وفلتر عقد اختياري
export function archiveBrowse(q, { page = 1, rows = 24, decade = 0 } = {}) {
  const query = `(${q}) AND mediatype:movies` + (decade ? ` AND year:[${decade} TO ${decade + 9}]` : '');
  return archiveDocs(query, { rows, page, sort: 'downloads desc' });
}

const plain = h => String(Array.isArray(h) ? h[0] : h || '').replace(/<[^>]*>/g, ' ').replace(/&nbsp;|&amp;|&quot;|&#39;/g, m => ({ '&nbsp;': ' ', '&amp;': '&', '&quot;': '"', '&#39;': "'" })[m]).replace(/\s+/g, ' ').trim();

async function archiveDocs(query, { rows = 20, page = 1, sort = '' } = {}) {
  const fl = ['identifier', 'title', 'creator', 'licenseurl', 'year', 'description', 'downloads'].map(f => `&fl%5B%5D=${f}`).join('');
  const j = await getJson(`https://archive.org/advancedsearch.php?q=${encodeURIComponent(query)}${fl}${sort ? '&sort%5B%5D=' + encodeURIComponent(sort) : ''}&rows=${rows}&page=${page}&output=json`);
  return (j.response?.docs || []).map(d => {
    const lu = d.licenseurl || '';
    const lic = /publicdomain/.test(lu) ? { tier: 'free', label: 'ملك عام / CC0' } : /\/licenses\/by\/([\d.]+)/.test(lu) ? { tier: 'attr', label: 'CC BY ' + lu.match(/\/licenses\/by\/([\d.]+)/)[1] } : { tier: 'free', label: 'أرشيف عام (Prelinger / Universal Newsreels / NASA / FedFlix) — راجع صفحة المصدر' };
    const o = mk({
      id: 'archive:' + d.identifier, provider: 'archive', type: 'video', title: Array.isArray(d.title) ? d.title[0] : d.title || d.identifier,
      thumb: `https://archive.org/services/img/${d.identifier}`, url: null, assetsHref: d.identifier, page: `https://archive.org/details/${d.identifier}`,
      author: Array.isArray(d.creator) ? d.creator.join('، ') : d.creator || '', license: lic.label, licenseUrl: lu, tier: lic.tier,
    });
    o.year = Number(d.year) || 0;
    o.desc = plain(d.description).slice(0, 600);
    o.views = Number(d.downloads) || 0;
    o.credit = creditLine(o);
    return o;
  });
}

async function archiveResolve(o) {
  const m = await getJson('https://archive.org/metadata/' + encodeURIComponent(o.assetsHref));
  const files = (m.files || []).filter(f => /\.mp4$/i.test(f.name) && !/_(?:thumb|preview)/i.test(f.name));
  files.sort((a, b) => Number(a.size || 0) - Number(b.size || 0));
  // أصغر mp4 معقول (عشان التحميل في الذاكرة)
  const f = files.find(x => Number(x.size) > 300_000) || files[0];
  if (!f) throw new Error('مفيش ملف mp4 للعنصر ده');
  o.size = Number(f.size) || 0;
  return `https://archive.org/download/${encodeURIComponent(o.assetsHref)}/${f.name.split('/').map(encodeURIComponent).join('/')}`;
}

/* ---------------- Smithsonian Open Access (CC0 بس: متاحف وتاريخ وغرائب) ---------------- */
async function smithsonian(q, type) {
  if (type === 'video') return [];
  const key = getSettings().siKey || 'DEMO_KEY';
  const j = await getJson(`https://api.si.edu/openaccess/api/v1.0/search?q=${encodeURIComponent(`${q} AND online_media_type:Images AND media_usage:CC0`)}&rows=30&api_key=${encodeURIComponent(key)}`);
  const out = [];
  for (const r of j.response?.rows || []) {
    const d = r.content?.descriptiveNonRepeating || {};
    const m = (d.online_media?.media || []).find(x => x.type === 'Images' && /cc0/i.test(x.usage?.access || ''));
    if (!m?.content) continue;
    const o = mk({
      id: 'si:' + (r.id || m.idsId || m.content), provider: 'smithsonian', type: 'image', title: d.title?.content || r.title || '',
      thumb: https(m.thumbnail || m.content + '&max=300'), url: https(m.content + (m.content.includes('?') ? '&max=2000' : '')),
      page: d.record_link || '', author: d.data_source || 'Smithsonian', license: 'CC0 — Smithsonian Open Access', licenseUrl: 'https://creativecommons.org/publicdomain/zero/1.0/', tier: 'free',
    });
    o.credit = `${o.author} — Smithsonian Open Access (CC0)`;
    out.push(o);
  }
  return out;
}

/* ---------------- Pixabay (محتاج مفتاح مجاني) ---------------- */
async function pixabay(q, type) {
  const key = getSettings().pixabayKey;
  if (!key) throw new Error('محتاج مفتاح Pixabay (مجاني) في الإعدادات.');
  const base = type === 'video' ? 'https://pixabay.com/api/videos/' : 'https://pixabay.com/api/';
  const j = await getJson(`${base}?key=${encodeURIComponent(key)}&q=${encodeURIComponent(q)}&per_page=24&safesearch=true`);
  return (j.hits || []).map(h => {
    const vid = type === 'video';
    const v = h.videos?.medium || h.videos?.small || h.videos?.large;
    const o = mk({
      id: 'pixabay:' + (vid ? 'v' : 'i') + h.id, provider: 'pixabay', type: vid ? 'video' : 'image', title: (h.tags || '').split(',')[0],
      thumb: vid ? (h.videos?.tiny?.thumbnail || h.userImageURL) : h.webformatURL, url: vid ? v?.url : (h.largeImageURL || h.webformatURL),
      page: h.pageURL, author: h.user || '', license: 'Pixabay License', licenseUrl: 'https://pixabay.com/service/license-summary/', tier: 'attr',
      width: vid ? v?.width : h.imageWidth, height: vid ? v?.height : h.imageHeight, duration: h.duration || 0,
    });
    o.credit = `${o.author ? o.author + ' — ' : ''}Pixabay`;
    return o.url ? o : null;
  }).filter(Boolean);
}

/* ---------------- Pexels (مفتاح مجاني لو عندك مفتاح) ---------------- */
// أصغر ملف mp4 ضلعه الصغير >= 720 (التحميل والتصدير يفضلوا سريعين)
function pexelsFile(files) {
  const mp4 = (files || []).filter(f => f.file_type === 'video/mp4' && f.width && f.height).sort((a, b) => Math.min(a.width, a.height) - Math.min(b.width, b.height));
  return mp4.find(f => Math.min(f.width, f.height) >= 720) || mp4[mp4.length - 1];
}
async function pexels(q, type) {
  const key = getSettings().pexelsKey;
  if (!key) throw new Error('محتاج مفتاح Pexels في الإعدادات.');
  const vid = type === 'video';
  const api = `${vid ? 'https://api.pexels.com/videos/search' : 'https://api.pexels.com/v1/search'}?query=${encodeURIComponent(q)}&per_page=24`;
  // مباشرة الأول، ولو المتصفح منع الاتصال (CORS/شبكة) نعدّي على الوسيط بنفس المفتاح
  let res;
  try { res = await fetch(api, { headers: { Authorization: key } }); }
  catch (e) {
    const { proxyUrl } = getSettings();
    if (!proxyUrl) throw new Error('Pexels: المتصفح منع الاتصال. حط «رابط الوسيط» في الإعدادات.');
    res = await fetch(`${proxyUrl.replace(/\/+$/, '')}/?url=${encodeURIComponent(api)}`, { headers: { Authorization: key } }).catch(() => null);
    if (!res) throw new Error('Pexels: مقدرتش أوصل حتى عن طريق الوسيط.');
    if (res.status === 403 && /host not allowed/.test(await res.clone().text().catch(() => ''))) throw new Error('Pexels: الوسيط محتاج النسخة الجديدة من الكود (فيها api.pexels.com). الصقها في Cloudflare ودوس Deploy.');
  }
  if (!res.ok) throw new Error('Pexels: HTTP ' + res.status + (res.status === 401 || res.status === 403 ? ' (المفتاح غلط)' : ''));
  const j = await res.json();
  const lic = { license: 'Pexels License', licenseUrl: 'https://www.pexels.com/license/', tier: 'free' };
  const out = vid
    ? (j.videos || []).map(v => { const f = pexelsFile(v.video_files); return f && mk({ id: 'pexels:v' + v.id, provider: 'pexels', type: 'video', title: (v.url || '').split('/').filter(Boolean).pop()?.replace(/-\d+$/, '').replace(/-/g, ' ') || 'Pexels video', thumb: v.image, url: f.link, page: v.url, author: v.user?.name || '', width: f.width, height: f.height, duration: v.duration || 0, ...lic }); })
    : (j.photos || []).map(ph => mk({ id: 'pexels:i' + ph.id, provider: 'pexels', type: 'image', title: ph.alt || 'Pexels photo', thumb: ph.src?.medium, url: ph.src?.large2x || ph.src?.original, page: ph.url, author: ph.photographer || '', width: ph.width, height: ph.height, ...lic }));
  return out.filter(Boolean).map(o => (o.credit = `${o.author ? o.author + ' — ' : ''}Pexels`, o));
}

/* ---------------- Coverr (مفتاح مجاني، حوالي 50 طلب في الساعة) ---------------- */
// شكل الرد اتكتب من الذاكرة (api.coverr.co مكانش متاح من بيئة التطوير): المحلّل متسامح مع أكتر من شكل
async function apiFetch(api, headers) {
  try { return await fetch(api, { headers }); }
  catch {
    const { proxyUrl } = getSettings();
    if (!proxyUrl) throw new Error('المتصفح منع الاتصال. حط «رابط الوسيط» في الإعدادات.');
    const res = await fetch(`${proxyUrl.replace(/\/+$/, '')}/?url=${encodeURIComponent(api)}`, { headers }).catch(() => null);
    if (!res) throw new Error('مقدرتش أوصل حتى عن طريق الوسيط.');
    if (res.status === 403 && /host not allowed/.test(await res.clone().text().catch(() => ''))) throw new Error('الوسيط محتاج النسخة الجديدة من الكود. الصقها في Cloudflare ودوس Deploy.');
    return res;
  }
}
async function coverr(q, type) {
  const key = getSettings().coverrKey;
  if (!key) throw new Error('محتاج مفتاح Coverr في الإعدادات.');
  if (type === 'image') return [];
  const api = `https://api.coverr.co/videos?query=${encodeURIComponent(q)}&page_size=24&urls=true&api_key=${encodeURIComponent(key)}`;
  const res = await apiFetch(api, { Authorization: 'Bearer ' + key });
  if (res.status === 429) throw new Error('خلص حد الطلبات (حوالي 50 في الساعة). استنى شوية.');
  if (!res.ok) throw new Error('HTTP ' + res.status + (res.status === 401 || res.status === 403 ? ' (المفتاح غلط أو لسه مش متفعّل)' : ''));
  const j = await res.json();
  const list = j.hits || j.videos || j.data || j.results || (Array.isArray(j) ? j : []);
  return list.map(v => {
    const u = v.urls || v.url || {};
    const file = (typeof u === 'string' ? u : u.mp4_download || u.mp4 || u.mp4_preview) || v.mp4 || v.video_url || '';
    if (!file) return null;
    const o = mk({ id: 'coverr:' + (v.id || v.slug || file), provider: 'coverr', type: 'video', title: v.title || v.name || 'Coverr video', thumb: v.thumbnail || v.poster || v.thumbnail_url || v.image || '', url: file,
      page: v.url_page || (v.slug ? `https://coverr.co/videos/${v.slug}` : 'https://coverr.co'), author: v.author?.name || v.user?.name || '', width: v.max_width || v.width || 0, height: v.max_height || v.height || 0,
      duration: Number(v.duration) || 0, license: 'Coverr License', licenseUrl: 'https://coverr.co/license', tier: 'free' });
    o.credit = 'Coverr';
    return o;
  }).filter(Boolean);
}

// 🔗 لينك صفحة فيديو من موقع ستوك (Mixkit / Coverr / Pexels / Pixabay): بنجيب الصفحة دي بس (مش نتايج بحث) ونطلّع منها ملف mp4
export const STOCK_PAGE_HOSTS = { 'mixkit.co': 'Mixkit', 'coverr.co': 'Coverr', 'pexels.com': 'Pexels', 'pixabay.com': 'Pixabay' };
export const stockSiteOf = url => { let h = ''; try { h = new URL(url).hostname; } catch { return null; } const k = Object.keys(STOCK_PAGE_HOSTS).find(d => h === d || h.endsWith('.' + d)); return k ? STOCK_PAGE_HOSTS[k] : null; };
async function getVia(url) {
  try { const r = await fetch(url, { signal: AbortSignal.timeout(60000) }); if (r.ok) return r; } catch { /* نجرب الوسيط */ }
  const r = await viaProxy(url).catch(() => null);
  if (r?.ok) return r;
  if (r?.status === 403 && /host not allowed/.test(await r.clone().text().catch(() => ''))) throw new Error('الوسيط محتاج النسخة الجديدة من الكود (فيها Mixkit و Coverr). الصقها في Cloudflare ودوس Deploy.');
  throw new Error(getSettings().proxyUrl ? `الموقع رفض (HTTP ${r?.status || '؟'}).` : 'الموقع منع التحميل من المتصفح. حط «رابط الوسيط» في الإعدادات.');
}
export async function fileFromStockPage(url) {
  const site = stockSiteOf(url) || '';
  const name = u => (u.split(/[?#]/)[0].split('/').filter(Boolean).pop() || 'stock').replace(/[^\w.-]+/g, '_');
  const r = await getVia(url);
  const type = r.headers.get('content-type') || '';
  if (/^(video|image)\//.test(type)) { const b = await r.blob(); return { file: new File([b], name(url), { type: b.type }), site, page: url }; }
  const html = await r.text();
  const found = [...new Set((html.match(/https?:\/\/[^"'\s<>\\]+?\.mp4(?:\?[^"'\s<>\\]*)?/gi) || []).map(u => u.replace(/&amp;/g, '&')))];
  const og = /<meta[^>]+property=["']og:video(?::url|:secure_url)?["'][^>]+content=["']([^"']+)/i.exec(html)?.[1];
  if (og && /\.mp4/i.test(og)) found.unshift(og.replace(/&amp;/g, '&'));
  if (!found.length) throw new Error('مالقيتش ملف فيديو في الصفحة دي. افتح الفيديو نفسه، وكليك يمين عليه ← «Copy video address»، والصق الرابط ده.');
  const rank = u => (/2160|4k/i.test(u) ? 1 : /1080/.test(u) ? 4 : /720|large|hd/i.test(u) ? 3 : /360|small|preview|tiny/i.test(u) ? 1 : 2);
  found.sort((a, b) => rank(b) - rank(a));
  let last;
  for (const u of found.slice(0, 4)) {
    try { const b = await (await getVia(u)).blob(); if (b.size > 50000) return { file: new File([b], name(u), { type: b.type.startsWith('video/') ? b.type : 'video/mp4' }), site, page: url }; }
    catch (e) { last = e; }
  }
  throw last || new Error('الملف ما اتحمّلش.');
}

// cors:false = البحث شغّال من المتصفح، لكن ملفات المصدر مبتسمحش بتحميلها من المتصفح (اتفحصت من GitHub Actions)،
// فتحميلها محتاج «الوسيط» (Cloudflare Worker) — المعاينة والبحث والرابط الأصلي شغّالين من غيره.
export const PROVIDERS = {
  nasa: { name: 'NASA', types: ['image', 'video'], search: nasa, resolve: nasaResolve, area: 'علوم وفضاء', cors: false },
  commons: { name: 'Wikimedia Commons', types: ['image', 'video'], search: commons, area: 'عام: خرائط، أماكن، علوم، طب', cors: true },
  openverse: { name: 'Openverse', types: ['image'], search: openverse, area: 'صور عامة (CC)', cors: true },
  archive: { name: 'Internet Archive', types: ['video'], search: archive, resolve: archiveResolve, area: 'فيديو أرشيفي: أفلام Prelinger وجرايد Universal Newsreels القديمة', cors: false },
  smithsonian: { name: 'Smithsonian', types: ['image'], search: smithsonian, area: 'متاحف وتاريخ وغرائب (CC0)', cors: false },
  coverr: { name: 'Coverr', types: ['video'], search: coverr, area: 'فيديو ستوك (مفتاح مجاني، ~50 بحث في الساعة)', cors: true, key: 'coverrKey' },
  pexels: { name: 'Pexels', types: ['image', 'video'], search: pexels, area: 'صور وفيديو عامة (مفتاح)', cors: true, key: 'pexelsKey' },
  pixabay: { name: 'Pixabay', types: ['image', 'video'], search: pixabay, area: 'خلفيات عامة (مفتاح مجاني)', cors: true, key: 'pixabayKey' },
};

// بيدور في المصادر المختارة بالتوازي، وأي مصدر يفشل بيتسجل خطؤه من غير ما يوقف الباقي
export async function searchAll(q, { providers, type = 'any', tier = 'all' }) {
  const names = providers.filter(p => PROVIDERS[p] && (type === 'any' || PROVIDERS[p].types.includes(type)));
  const results = await Promise.allSettled(names.map(p => PROVIDERS[p].search(q, type)));
  const items = [], errors = [];
  results.forEach((r, i) => {
    if (r.status === 'fulfilled') items.push(...r.value); else errors.push({ provider: names[i], error: String(r.reason?.message || r.reason) });
  });
  const keep = items.filter(x => (type === 'any' || x.type === type) && (tier === 'all' || x.tier === 'free'));
  return { items: keep, errors };
}

export async function viaProxy(url) {
  const { proxyUrl } = getSettings();
  if (!proxyUrl) return null;
  return fetch(`${proxyUrl.replace(/\/+$/, '')}/?url=${encodeURIComponent(url)}`, { signal: AbortSignal.timeout(180000) });
}

// بيجهّز الملف للاستخدام: بيجيب الرابط الفعلي لو لسه، وبينزّله كـBlob (لازم يسمح بـCORS أو يعدّي على الوسيط، عشان الكانفس ما يتلوّثش)
export async function fetchBlob(item, onProgress) {
  const prov = PROVIDERS[item.provider];
  let url = item.url;
  if (!url) url = item.url = await prov.resolve(item);
  // دايمًا بنجرب مباشرة الأول (الفحص من GitHub Actions مش دليل: بعض المواقع زي Pixabay بتسمح للمتصفح الحقيقي)، وبعدين الوسيط
  let res = null;
  try { res = await fetch(url, { signal: AbortSignal.timeout(120000) }); if (!res.ok) throw new Error('http'); }
  catch {
    res = await viaProxy(url).catch(() => null);
    if (!res?.ok && item.thumb && item.provider === 'openverse') res = await fetch(item.thumb).catch(() => null); // نسخة مصغّرة من Openverse بتسمح بـCORS
    if (!res?.ok) throw new Error(`${prov?.name || 'الموقع'}: منع تحميل الملف من المتصفح (CORS)${getSettings().proxyUrl ? ' وحتى عن طريق الوسيط' : '. اضبط «رابط الوسيط» في الإعدادات (الشرح في README)'}، أو افتح الصفحة الأصلية ونزّل الملف وارفعه من جهازك.`);
  }
  if (!res.ok) throw new Error(`تعذر تحميل الملف (HTTP ${res.status})`);
  const total = Number(res.headers.get('content-length')) || item.size || 0;
  if (total > 80e6 && !confirm(`الملف كبير (${(total / 1e6).toFixed(0)} MB) وهيتحمّل في الذاكرة. تكمل؟`)) throw new Error('اتلغى التحميل.');
  const reader = res.body.getReader();
  const chunks = [];
  let got = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value); got += value.length;
    onProgress?.(total ? got / total : 0);
  }
  const type = (res.headers.get('content-type') || '').split(';')[0] || (item.type === 'video' ? 'video/mp4' : 'image/jpeg');
  return new Blob(chunks, { type });
}
