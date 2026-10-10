// بحث موسيقى/مؤثرات بترخيص آمن: Freesound (بمفتاح مجاني) + Openverse صوت (من غير مفتاح)
import { getSettings } from './storage.js?v=mv2kwqdz';
import { classifyLicense, viaProxy } from './media.js?v=mv2kwqdz';

const https = u => String(u || '').replace(/^http:\/\//i, 'https://');
async function getJson(url) {
  const res = await fetch(url, { signal: AbortSignal.timeout(20000) });
  if (res.status === 401 || res.status === 403) throw new Error('المفتاح مرفوض (تأكد من مفتاح Freesound في الإعدادات).');
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

// ترخيص Freesound بييجي كرابط: .../publicdomain/zero/1.0/ أو .../licenses/by/4.0/
export function licenseOfUrl(u) {
  const s = String(u || '').toLowerCase();
  if (/publicdomain\/zero|\/cc0/.test(s)) return classifyLicense('cc0');
  const m = s.match(/licenses\/(by(?:-[a-z]+)?)\/([\d.]+)/);
  return m ? classifyLicense(`${m[1]}-${m[2]}`) : null;
}

export const MUSIC_SOURCES = {
  freesound: { name: 'Freesound (محتاج مفتاح مجاني)' },
  openverse: { name: 'Openverse (من غير مفتاح)' },
};

async function freesound(q, key) {
  if (!key) throw new Error('حط مفتاح Freesound في الإعدادات (مجاني من freesound.org/apiv2/apply).');
  const f = 'id,name,username,license,duration,previews,url,tags';
  const j = await getJson(`https://freesound.org/apiv2/search/text/?query=${encodeURIComponent(q)}&token=${encodeURIComponent(key)}&fields=${f}&page_size=30&filter=${encodeURIComponent('duration:[8 TO 400]')}`);
  return (j.results || []).map(r => {
    const lic = licenseOfUrl(r.license);
    const url = https(r.previews?.['preview-hq-mp3'] || r.previews?.['preview-lq-mp3']);
    if (!lic || !url) return null;
    return { id: 'fs:' + r.id, provider: 'freesound', title: r.name || '', author: r.username || '', duration: r.duration || 0, url, license: lic.label, page: r.url || '', tags: (r.tags || []).slice(0, 4) };
  }).filter(Boolean);
}

async function openverseAudio(q) {
  const j = await getJson(`https://api.openverse.org/v1/audio/?q=${encodeURIComponent(q)}&page_size=30&license_type=commercial,modification&mature=false`);
  return (j.results || []).map(r => {
    const lic = classifyLicense(`${r.license}${r.license_version ? '-' + r.license_version : ''}`);
    const url = https(r.url);
    if (!lic || !url) return null;
    return { id: 'ov:' + r.id, provider: 'openverse', title: r.title || '', author: r.creator || '', duration: (r.duration || 0) / 1000, url, license: lic.label, page: r.foreign_landing_url || '', tags: (r.tags || []).map(t => t.name).slice(0, 4) };
  }).filter(Boolean);
}

export async function searchMusic(q, source) {
  return source === 'openverse' ? openverseAudio(q) : freesound(q, getSettings().freesoundKey);
}

export function musicCredit(it) {
  const by = it.author ? `${it.author} — ` : '';
  return `${by}«${(it.title || '').slice(0, 50)}» — ${it.license} — ${it.provider === 'freesound' ? 'Freesound' : 'Openverse'}`;
}

// بينزّل التراك كـBlob: مباشرة الأول، وبعدين الوسيط
export async function fetchTrack(it) {
  let res = null;
  try { res = await fetch(it.url, { signal: AbortSignal.timeout(90000) }); if (!res.ok) throw new Error('http'); }
  catch {
    res = await viaProxy(it.url).catch(() => null);
    if (!res?.ok) throw new Error(`منع تحميل الملف من المتصفح (CORS)${getSettings().proxyUrl ? ' وحتى عن طريق الوسيط' : '. اضبط «رابط الوسيط» في الإعدادات'}، أو افتح الصفحة الأصلية ونزّله وارفعه من جهازك.`);
  }
  return res.blob();
}
