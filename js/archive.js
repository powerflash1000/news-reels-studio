// تبويب الأرشيف: قصص تاريخية مختارة (ويكيبيديا) + أفلام وجرايد قديمة جاهزة للتصفح (Internet Archive) من غير بحث
import { archiveBrowse } from './media.js?v=mvquk8vm';

let data = null;
export async function loadArchive() {
  if (!data) data = await (await fetch(new URL('../assets/data/archive.json', import.meta.url))).json();
  return data;
}

const wcache = new Map();
const getJ = async url => { const r = await fetch(url); if (!r.ok) throw new Error('ويكيبيديا ردّت ' + r.status); return r.json(); };
const sumUrl = (lang, t) => `https://${lang}.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(t.replace(/ /g, '_'))}`;

// ملخص القصة: الإنجليزي + النسخة العربية لو موجودة (عن طريق روابط اللغات)
export async function storyInfo(t) {
  if (wcache.has(t)) return wcache.get(t);
  const en = await getJ(sumUrl('en', t));
  const out = { title: en.title || t, extract: en.extract || '', url: en.content_urls?.desktop?.page || `https://en.wikipedia.org/wiki/${encodeURIComponent(t.replace(/ /g, '_'))}`, ar: null };
  try {
    const ll = await getJ(`https://en.wikipedia.org/w/api.php?action=query&prop=langlinks&lllang=ar&redirects=1&format=json&formatversion=2&origin=*&titles=${encodeURIComponent(out.title)}`);
    const arT = ll.query?.pages?.[0]?.langlinks?.[0]?.title;
    if (arT) {
      const ar = await getJ(sumUrl('ar', arT));
      out.ar = { title: ar.title || arT, extract: ar.extract || '', url: ar.content_urls?.desktop?.page || `https://ar.wikipedia.org/wiki/${encodeURIComponent(arT.replace(/ /g, '_'))}` };
    }
  } catch { /* العربي اختياري */ }
  // المقال كامل (نص من غير تنسيق) عشان الحلقة تبقى دسمة، مش الملخص بس
  const [fe, fa] = await Promise.all([fullText('en', out.title).catch(() => ''), out.ar ? fullText('ar', out.ar.title).catch(() => '') : '']);
  out.full = fe;
  if (out.ar) out.ar.full = fa;
  wcache.set(t, out);
  return out;
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
