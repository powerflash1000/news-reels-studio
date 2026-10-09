// مكتبة الوسائط: بحث في مصادر مفتوحة، وكل نتيجة بترجع بنفس الشكل مع الترخيص والحقوق.
// شكل النتيجة: { id, provider, type:'image'|'video', title, thumb, url, page, author, license, licenseUrl, tier, credit, width, height, duration, size }
//   tier: 'free' = ملك عام / CC0 / سياسة NASA (من غير شرط)، 'attr' = لازم نسب (CC BY / BY-SA / Pixabay)
// أي ترخيص فيه NC أو ND أو مش واضح بيتستبعد.
import { getSettings } from './storage.js?v=mv0by2gm';

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
  return `${by}${o.title ? '«' + o.title.slice(0, 50) + '» — ' : ''}${o.license}${o.provider === 'commons' ? ' — Wikimedia Commons' : o.provider === 'openverse' ? ' — Openverse' : o.provider === 'archive' ? ' — Internet Archive' : ''}`;
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
  const query = `(${q}) AND mediatype:movies AND (licenseurl:*creativecommons.org/publicdomain* OR licenseurl:*creativecommons.org/licenses/by/* OR collection:prelinger OR collection:nasa)`;
  const j = await getJson(`https://archive.org/advancedsearch.php?q=${encodeURIComponent(query)}&fl%5B%5D=identifier&fl%5B%5D=title&fl%5B%5D=creator&fl%5B%5D=licenseurl&rows=20&output=json`);
  return (j.response?.docs || []).map(d => {
    const lu = d.licenseurl || '';
    const lic = /publicdomain/.test(lu) ? { tier: 'free', label: 'ملك عام / CC0' } : /\/licenses\/by\/([\d.]+)/.test(lu) ? { tier: 'attr', label: 'CC BY ' + lu.match(/\/licenses\/by\/([\d.]+)/)[1] } : { tier: 'free', label: 'أرشيف عام (Prelinger/NASA) — راجع صفحة المصدر' };
    const o = mk({
      id: 'archive:' + d.identifier, provider: 'archive', type: 'video', title: Array.isArray(d.title) ? d.title[0] : d.title || d.identifier,
      thumb: `https://archive.org/services/img/${d.identifier}`, url: null, assetsHref: d.identifier, page: `https://archive.org/details/${d.identifier}`,
      author: Array.isArray(d.creator) ? d.creator.join('، ') : d.creator || '', license: lic.label, licenseUrl: lu, tier: lic.tier,
    });
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

// cors:false = البحث شغّال من المتصفح، لكن ملفات المصدر مبتسمحش بتحميلها من المتصفح (اتفحصت من GitHub Actions)،
// فتحميلها محتاج «الوسيط» (Cloudflare Worker) — المعاينة والبحث والرابط الأصلي شغّالين من غيره.
export const PROVIDERS = {
  nasa: { name: 'NASA', types: ['image', 'video'], search: nasa, resolve: nasaResolve, area: 'علوم وفضاء', cors: false },
  commons: { name: 'Wikimedia Commons', types: ['image', 'video'], search: commons, area: 'عام: خرائط، أماكن، علوم، طب', cors: true },
  openverse: { name: 'Openverse', types: ['image'], search: openverse, area: 'صور عامة (CC)', cors: true },
  archive: { name: 'Internet Archive', types: ['video'], search: archive, resolve: archiveResolve, area: 'فيديو أرشيفي', cors: false },
  pixabay: { name: 'Pixabay', types: ['image', 'video'], search: pixabay, area: 'خلفيات عامة (مفتاح مجاني)', cors: false },
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

async function viaProxy(url) {
  const { proxyUrl } = getSettings();
  if (!proxyUrl) return null;
  return fetch(`${proxyUrl.replace(/\/+$/, '')}/?url=${encodeURIComponent(url)}`, { signal: AbortSignal.timeout(180000) });
}

// بيجهّز الملف للاستخدام: بيجيب الرابط الفعلي لو لسه، وبينزّله كـBlob (لازم يسمح بـCORS أو يعدّي على الوسيط، عشان الكانفس ما يتلوّثش)
export async function fetchBlob(item, onProgress) {
  const prov = PROVIDERS[item.provider];
  let url = item.url;
  if (!url) url = item.url = await prov.resolve(item);
  let res = null;
  if (prov && prov.cors === false) {
    res = await viaProxy(url);
    if (!res) throw new Error(`${prov.name}: الموقع ده مبيسمحش بتحميل ملفاته من المتصفح. اضبط «رابط الوسيط» في الإعدادات (الشرح في README)، أو افتح الصفحة الأصلية ونزّل الملف وارفعه من جهازك.`);
  } else {
    try { res = await fetch(url, { signal: AbortSignal.timeout(120000) }); if (!res.ok) throw new Error('http'); }
    catch {
      res = await viaProxy(url).catch(() => null);
      if (!res?.ok && item.thumb && item.provider === 'openverse') res = await fetch(item.thumb).catch(() => null); // نسخة مصغّرة من Openverse بتسمح بـCORS
      if (!res?.ok) throw new Error('الموقع منع تحميل الملف من المتصفح (CORS). جرّب نتيجة تانية أو ارفع الملف من جهازك.');
    }
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
