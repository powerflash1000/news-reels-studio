// M4: حزمة النشر (عناوين/وصف/هاشتاجات/مصادر/حقوق وسائط) + سجل التجارب. دوال خالصة من غير DOM.
import { MED_DISCLAIMER } from './reel.js?v=mv19b8x4';

export const PLATFORMS = { tiktok: 'تيك توك', instagram: 'إنستجرام', facebook: 'فيسبوك' };
export const ENGAGE = ['likes', 'comments', 'shares', 'saves'];

const TAGS = {
  politics: ['#سياسة', '#أخبار_العالم'], economy: ['#اقتصاد', '#أسواق'], sports: ['#رياضة', '#كرة_القدم'],
  science: ['#علوم', '#فضاء'], health: ['#صحة', '#طب'], healthtech: ['#تقنية_طبية', '#صحة_رقمية'],
  ai: ['#ذكاء_اصطناعي', '#AI'], defense: ['#دفاع', '#عسكري'], stories: ['#قصص', '#وثائقي'],
};
const GENERAL = ['#أخبار', '#ريلز', '#news'];
const LIMIT = { tiktok: 5, instagram: 12, facebook: 4 };

const clip = (s, n) => (s.length > n ? s.slice(0, n - 1).trimEnd() + '…' : s);
const news = reel => reel.stories.filter(s => s.kind === 'news' && (s.headline || s.script));

export function buildPack(reel, { handle = '' } = {}) {
  const items = news(reel);
  const h = clip((items[0]?.headline || reel.title || '').trim(), 90);
  const src = items[0]?.sourceName || '';
  const titles = [...new Set([
    h,
    items[0]?.template === 'breaking' ? `🔴 عاجل: ${h}` : `${h} — إيه اللي حصل؟`,
    src ? `${h} | ${src}` : '',
  ].filter(Boolean).map(t => clip(t, 100)))];
  const lines = [];
  if (items.length > 1) lines.push(...items.map((s, i) => `${i + 1}. ${s.headline}`), '');
  lines.push('المصادر:');
  for (const s of items) lines.push(`• ${s.sourceName || '—'}${s.sourceUrl ? ': ' + s.sourceUrl : ''}${s.claimKind === 'opinion' ? ' (رأي وتحليل)' : ''}`);
  const credits = [...new Set(reel.stories.map(s => s.media?.credit).filter(Boolean))];
  if (credits.length) lines.push('', 'الوسائط: ' + credits.join(' • '));
  if (items.some(s => s.category === 'health' || s.category === 'healthtech')) lines.push('', MED_DISCLAIMER);
  if (items.some(s => s.category === 'stories')) lines.push('', 'القصة مبنية على وثائق وقضايا معلنة، وأي ادعاء غير مثبت مذكور إنه غير مؤكد.');
  if (handle) lines.push('', 'تابعنا: ' + (handle.startsWith('@') ? handle : '@' + handle));
  const cats = [...new Set(items.map(s => s.category))];
  const tags = [...new Set([...cats.flatMap(c => TAGS[c] || []), ...GENERAL])];
  return { title: titles[0] || '', titles, desc: lines.join('\n'), tags: tags.join(' ') };
}

// النص الجاهز للصق في منصة معينة
export function compose(pack, platform) {
  const tags = (pack.tags || '').split(/\s+/).filter(Boolean).slice(0, LIMIT[platform] ?? 5).join(' ');
  const desc = platform === 'tiktok' ? clip(pack.desc || '', 300) : pack.desc || '';
  return [pack.title, '', desc, '', tags].join('\n').replace(/\n{3,}/g, '\n\n').trim();
}

const num = v => (Number.isFinite(Number(v)) ? Number(v) : 0);
export const engagement = p => (num(p.views) > 0 ? ENGAGE.reduce((n, k) => n + num(p[k]), 0) / num(p.views) : 0);

// ملخص حسب المنصة أو حسب وسم التجربة: [{key, n, views, eng}] مرتب بالأفضل تفاعلًا
export function summarize(reels, by) {
  const g = new Map();
  for (const r of reels) for (const p of r.posts || []) {
    const keys = by === 'tag' ? (p.tag ? p.tag.split(/[،,]/).map(x => x.trim()).filter(Boolean) : ['(من غير وسم)']) : [p.platform];
    for (const key of keys) {
      const a = g.get(key) || { key, n: 0, views: 0, eng: 0 };
      a.n++; a.views += num(p.views); a.eng += engagement(p);
      g.set(key, a);
    }
  }
  return [...g.values()].map(a => ({ key: a.key, n: a.n, views: Math.round(a.views / a.n), eng: a.eng / a.n })).sort((a, b) => b.eng - a.eng);
}
