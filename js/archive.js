// تبويب الأرشيف: قصص تاريخية مختارة (ويكيبيديا) + أفلام وجرايد قديمة جاهزة للتصفح (Internet Archive) من غير بحث
import { archiveBrowse } from './media.js?v=mvw3r55t';

let data = null;
export async function loadArchive() {
  if (!data) data = await (await fetch(new URL('../assets/data/archive.json', import.meta.url))).json();
  return data;
}

const wcache = new Map();
const getJ = async url => { const r = await fetch(url); if (!r.ok) throw new Error('ويكيبيديا ردّت ' + r.status); return r.json(); };
const sumUrl = (lang, t) => `https://${lang}.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(t.replace(/ /g, '_'))}`;

const pageUrl = (lang, t) => `https://${lang}.wikipedia.org/wiki/${encodeURIComponent(t.replace(/ /g, '_'))}`;
const summ = async (lang, t) => { const j = await getJ(sumUrl(lang, t)); return { title: j.title || t, extract: j.extract || '', url: j.content_urls?.desktop?.page || pageUrl(lang, t) }; };
const otherTitle = async (from, to, t) => {
  const ll = await getJ(`https://${from}.wikipedia.org/w/api.php?action=query&prop=langlinks&lllang=${to}&redirects=1&format=json&formatversion=2&origin=*&titles=${encodeURIComponent(t)}`);
  return ll.query?.pages?.[0]?.langlinks?.[0]?.title || '';
};

// ملخص القصة والمقال كامل: الإنجليزي (out) + العربي (out.ar) لو موجود. lang = لغة العنوان اللي معانا
export async function storyInfo(t, lang = 'en') {
  const key = lang + ':' + t;
  if (wcache.has(key)) return wcache.get(key);
  let out;
  if (lang === 'ar') {
    const ar = await summ('ar', t);
    let en = null;
    try { const enT = await otherTitle('ar', 'en', ar.title); if (enT) en = await summ('en', enT); } catch { /* الإنجليزي اختياري */ }
    out = en ? { ...en, ar } : { ...ar, ar, onlyAr: true };
  } else {
    out = { ...(await summ('en', t)), ar: null };
    try { const arT = await otherTitle('en', 'ar', out.title); if (arT) out.ar = await summ('ar', arT); } catch { /* العربي اختياري */ }
  }
  // المقال كامل (نص من غير تنسيق) عشان الحلقة تبقى دسمة، مش الملخص بس
  const [fe, fa] = await Promise.all([out.onlyAr ? '' : fullText('en', out.title).catch(() => ''), out.ar ? fullText('ar', out.ar.title).catch(() => '') : '']);
  out.full = fe;
  if (out.ar) out.ar.full = fa;
  wcache.set(key, out);
  return out;
}

// حدث في مثل هذا اليوم، مباشرة من ويكيبيديا (أي يوم، عربي أو إنجليزي)، من غير ما نستنى تحديث الأخبار
export async function onThisDay(lang, date = new Date()) {
  const mm = String(date.getMonth() + 1).padStart(2, '0'), dd = String(date.getDate()).padStart(2, '0');
  let j;
  try { j = await getJ(`https://${lang}.wikipedia.org/api/rest_v1/feed/onthisday/all/${mm}/${dd}`); }
  catch { j = await getJ(`https://api.wikimedia.org/feed/v1/wikipedia/${lang}/onthisday/all/${mm}/${dd}`); }
  const seen = new Set();
  return [...(j.selected || []), ...(j.events || [])].map(e => {
    const p = (e.pages || [])[0];
    const t = p?.titles?.normalized || p?.normalizedtitle || p?.title?.replace(/_/g, ' ');
    if (!t || !e.text || seen.has(e.year + t)) return null;
    seen.add(e.year + t);
    return { t, ar: String(e.text).trim(), en: String(e.text).trim(), y: Number(e.year) || 0, lang, page: p.content_urls?.desktop?.page || pageUrl(lang, t) };
  }).filter(Boolean).sort((a, b) => a.y - b.y);
}

// نص المقال كله، من غير المراجع والوصلات الخارجية
const CUT = /\n==+\s*(References|Notes|Citations|Sources|Further reading|External links|See also|Bibliography|Footnotes|المراجع|مراجع|المصادر|مصادر|وصلات خارجية|انظر أيضًا|انظر أيضا|هوامش|ملاحظات|قراءات إضافية|روابط خارجية)\s*==+[\s\S]*$/;
export async function fullText(lang, title, max = 30000) {
  const j = await getJ(`https://${lang}.wikipedia.org/w/api.php?action=query&prop=extracts&explaintext=1&redirects=1&format=json&formatversion=2&origin=*&titles=${encodeURIComponent(title)}`);
  const txt = String(j.query?.pages?.[0]?.extract || '').replace(CUT, '').replace(/\n{3,}/g, '\n\n').trim();
  return txt.length > max ? txt.slice(0, max) + '\n…' : txt;
}
export const wordCount = t => (String(t || '').match(/\S+/g) || []).length;

export function films(f, opts) { return archiveBrowse(f.q, opts); }

// لقطات أرشيفية لقصة معيّنة: بالاسم الإنجليزي جوه مجموعات الملك العام
export function filmsFor(t) {
  const words = t.replace(/\(.*?\)/g, '').replace(/["']/g, '').trim();
  return archiveBrowse(`"${words}" AND (collection:universal_newsreels OR collection:prelinger OR collection:FedFlix OR collection:nasa)`, { rows: 12 });
}
