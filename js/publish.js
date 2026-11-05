// M4: حزمة النشر (عناوين/وصف/هاشتاجات/مصادر/حقوق وسائط) + سجل التجارب. دوال خالصة من غير DOM.
import { MED_DISCLAIMER } from './reel.js?v=mw3k21un';

export const PLATFORMS = { tiktok: 'تيك توك', instagram: 'إنستجرام', facebook: 'فيسبوك', shorts: 'يوتيوب شورتس', youtube: 'يوتيوب (فيديو عريض)' };
export const ENGAGE = ['likes', 'comments', 'shares', 'saves'];

const TAGS = {
  politics: ['#سياسة', '#أخبار_العالم'], economy: ['#اقتصاد', '#أسواق'], sports: ['#رياضة', '#كرة_القدم'],
  science: ['#علوم', '#فضاء'], health: ['#صحة', '#طب'], healthtech: ['#تقنية_طبية', '#صحة_رقمية'],
  ai: ['#ذكاء_اصطناعي', '#AI'], defense: ['#دفاع', '#عسكري'], stories: ['#قصص', '#وثائقي'],
  entertainment: ['#فن', '#ترفيه'], lifestyle: ['#موضة', '#لايف_ستايل', '#جمال'], tech: ['#تقنية', '#تكنولوجيا'], trending: ['#ترند', '#تريند'],
};
const TAGS_EN = {
  politics: ['#politics', '#worldnews'], economy: ['#economy', '#markets'], sports: ['#sports', '#football'],
  science: ['#science', '#space'], health: ['#health', '#medicine'], healthtech: ['#healthtech', '#digitalhealth'],
  ai: ['#AI', '#artificialintelligence'], defense: ['#defense', '#military'], stories: ['#stories', '#documentary'],
  entertainment: ['#entertainment', '#celebrity'], lifestyle: ['#fashion', '#lifestyle', '#beauty'], tech: ['#tech', '#technology'], trending: ['#trending', '#viral'],
};
const GENERAL = ['#أخبار', '#ريلز', '#news'];
const GENERAL_EN = ['#news', '#reels', '#breakingnews'];
const EN_DISC = 'General information, not medical advice — consult your doctor';
const LIMIT = { tiktok: 5, instagram: 12, facebook: 4, shorts: 3, youtube: 3 };

const clip = (s, n) => (s.length > n ? s.slice(0, n - 1).trimEnd() + '…' : s);
const news = reel => reel.stories.filter(s => s.kind === 'news' && (s.headline || s.script));

export function buildPack(reel, { handle = '' } = {}) {
  const en = reel.lang === 'en';
  const items = news(reel);
  const h = clip((items[0]?.headline || reel.title || '').trim(), 90);
  const src = items[0]?.sourceName || '';
  const titles = [...new Set([
    h,
    items[0]?.template === 'breaking' ? (en ? `🔴 BREAKING: ${h}` : `🔴 عاجل: ${h}`) : (en ? `${h} — what happened?` : `${h} — إيه اللي حصل؟`),
    src ? `${h} | ${src}` : '',
  ].filter(Boolean).map(t => clip(t, 100)))];
  const lines = [];
  if (items.length > 1) lines.push(...items.map((s, i) => `${i + 1}. ${s.headline}`), '');
  lines.push(en ? 'Sources:' : 'المصادر:');
  for (const s of items) lines.push(`• ${s.sourceName || '—'}${s.sourceUrl ? ': ' + s.sourceUrl : ''}${s.claimKind === 'opinion' ? (en ? ' (opinion)' : ' (رأي وتحليل)') : ''}`);
  const credits = [...new Set([...reel.stories.map(s => s.media?.credit), ...reel.stories.flatMap(s => (s.scenes || []).map(x => x.media?.credit)), reel.music?.credit, reel.thumb?.bg === 'own' ? reel.thumb?.own?.credit : ''].filter(Boolean))];
  if (credits.length) lines.push('', (en ? 'Media: ' : 'الوسائط: ') + credits.join(' • '));
  const clips = reel.stories.flatMap(s => (s.clips || []).filter(c => c.channel)).map(c => [c.channel, c.date].filter(Boolean).join(' — '));
  if (clips.length) lines.push('', (en ? 'Clips shown for commentary: ' : 'مقاطع معروضة للتعليق: ') + [...new Set(clips)].join(' • '));
  if (items.some(s => s.category === 'health' || s.category === 'healthtech')) lines.push('', en ? EN_DISC : MED_DISCLAIMER);
  if (items.some(s => s.category === 'stories')) lines.push('', en ? 'Based on public records and documents; unproven claims are marked as unconfirmed.' : 'القصة مبنية على وثائق وقضايا معلنة، وأي ادعاء غير مثبت مذكور إنه غير مؤكد.');
  if (handle) lines.push('', (en ? 'Follow: ' : 'تابعنا: ') + (handle.startsWith('@') ? handle : '@' + handle));
  const cats = [...new Set(items.map(s => s.category))];
  const tags = [...new Set([...cats.flatMap(c => (en ? TAGS_EN : TAGS)[c] || []), ...(en ? GENERAL_EN : GENERAL)])];
  return { title: titles[0] || '', titles, desc: lines.join('\n'), tags: tags.join(' ') };
}

// النص الجاهز للصق في منصة معينة
export function compose(pack, platform) {
  const tags = (pack.tags || '').split(/\s+/).filter(Boolean).slice(0, LIMIT[platform] ?? 5).join(' ');
  const desc = platform === 'tiktok' ? clip(pack.desc || '', 300) : pack.desc || '';
  // يوتيوب: العنوان والوصف في خانتين منفصلين، فبنرجّع الوصف بس (العنوان بيتنسخ لوحده)
  if (platform === 'shorts' || platform === 'youtube') return [desc, '', tags].join('\n').replace(/\n{3,}/g, '\n\n').trim();
  return [pack.title, '', desc, '', tags].join('\n').replace(/\n{3,}/g, '\n\n').trim();
}

// هاشتاجات نضيفة: كل واحد كلمة أو كلمتين/تلاتة متوصّلين بـ _ وقبلهم #، والجمل الطويلة بتتشال
export function cleanTags(input, max = 15) {
  const raw = Array.isArray(input) ? input : String(input || '').split(/[\n,،]+|\s(?=#)/);
  const out = [];
  for (let t of raw) {
    t = String(t || '').trim().replace(/^#+/, '').replace(/[.،,:;!?؟"'«»()\[\]{}]/g, ' ').trim();
    if (!t) continue;
    const words = t.split(/[\s_]+/).filter(Boolean);
    if (words.length > 3) continue; // ده كلام سردي مش هاشتاج
    const tag = '#' + words.join('_');
    if (tag.length < 3 || tag.length > 31 || out.some(x => x.toLowerCase() === tag.toLowerCase())) continue;
    out.push(tag);
    if (out.length >= max) break;
  }
  return out;
}
export const TAG_COUNT = { tiktok: 5, instagram: 12, facebook: 4, shorts: 3, youtube: 3 };

// عنوان يوتيوب: 100 حرف بالكتير، والشورتس بياخد #Shorts
export function ytTitle(title, platform) {
  let t = String(title || '').trim();
  if (platform === 'shorts' && !/#shorts/i.test(t)) t = clip(t, 91) + ' #Shorts';
  return clip(t, 100);
}

// فصول يوتيوب: أول فصل 0:00، 3 فصول على الأقل، وكل فصل 10 ثواني أو أكتر (غير كده يوتيوب بيتجاهلها)
const ts = s => { s = Math.max(0, Math.floor(s)); const m = Math.floor(s / 60), h = Math.floor(m / 60); return h ? `${h}:${String(m % 60).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}` : `${m}:${String(s % 60).padStart(2, '0')}`; };
export function chaptersText(list) {
  const ch = list.filter(c => c.title).map(c => ({ ...c }));
  if (!ch.length) return '';
  ch[0].start = 0;
  const ok = ch.length >= 3 && ch.every((c, i) => (ch[i + 1] ? ch[i + 1].start : c.end ?? c.start + 10) - c.start >= 10);
  return ok ? ch.map(c => `${ts(c.start)} ${clip(c.title, 80)}`).join('\n') : '';
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
