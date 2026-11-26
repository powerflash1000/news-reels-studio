// ريل «ترند <البلد> النهارده» بـ HyperFrames: أهم ٥ مواضيع النهارده = اللي الناس بتدوّر عليه على جوجل + اللي الأخبار كلها بتتكلم عنه
// الاستخدام: node tools/hf-trends.mjs [--out out/trends-eg.mp4] [--region eg] [--dry]
// محتاج: npx hyperframes (Node 22+) و FFmpeg. كل حاجة حقيقية من data/feeds.json و data/trends.json — مفيش أي كلام متألّف:
// العنوان = كلمة البحث أو عنوان الخبر، والسطر اللي تحته = عنوان خبر حقيقي مرتبط (من جوجل نفسه أو من المصادر).
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const NAMES = { eg: 'مصر', sa: 'السعودية', ae: 'الإمارات', ma: 'المغرب', dz: 'الجزائر', iq: 'العراق', jo: 'الأردن', lb: 'لبنان', kw: 'الكويت' };
// أخبار المصادر حسب البلد (region في config/sources.json)
// القصص اللي فيها اسم البلد بتاخد دفعة
const LOCAL = { eg: /مصر|المصري|القاهرة/, sa: /السعودي|الرياض|جدة|الهلال|النصر|الاتحاد/, ae: /الإمارات|إمارات|دبي|أبوظبي|أبو ظبي/, kw: /الكويت/, ma: /المغرب/, dz: /الجزائر/, iq: /العراق|بغداد/, jo: /الأردن|عمّان/, lb: /لبنان|بيروت/ };
const NEWS_REG = { eg: ["eg", "gulf"], sa: ['gulf', 'sa'], ae: ['gulf', 'ae'], kw: ['gulf', 'kw'] };
// كلمات عامة مش «مواضيع» (صفحات رئيسية، طقس، ترجمة…)
const SKIP = /^(مواقيت الصلاة.*|الرئيسية|الصفحة الرئيسة|main page|home|google|يوتيوب|youtube|فيسبوك|facebook|translate|ترجمة|الطقس|weather|طقس|حادث|خبر|اخبار|أخبار)$/i;
// بحث بلغات المقيمين (هندي/أردو/فارسي…) مش ترند البلد نفسه
const FOREIGN = /[ऀ-෿پچژگکیھہے]/;
const AR = n => Number(n).toLocaleString('ar-EG');
const clip = (s, n) => { s = String(s || '').replace(/\s+/g, ' ').trim(); if (s.length <= n) return s; const c = s.slice(0, n); return c.slice(0, c.lastIndexOf(' ') > n * 0.6 ? c.lastIndexOf(' ') : n) + '…'; };
const norm = s => String(s || '').toLowerCase().replace(/[ً-ٟـ]/g, '').replace(/[أإآ]/g, 'ا').replace(/ة/g, 'ه').replace(/ى/g, 'ي');
const words = s => new Set(norm(s).split(/[^\p{L}\p{N}]+/u).filter(w => w.length >= 4));
const sameStory = (a, b) => { const A = words(a), B = words(b); let n = 0; for (const w of A) if (B.has(w)) n++; return n >= 2 || (n >= 1 && Math.min(A.size, B.size) <= 2); };

// أول عنوان خبر من وصف عنصر جوجل: «حجم البحث التقريبي: 2000+. عنوان (المصدر) • عنوان تاني…»
export function gtDesc(summary) {
  const s = String(summary || '').replace(/^حجم البحث التقريبي:\s*[\d,+]+\.?\s*/, '');
  const first = s.split(' • ')[0].replace(/\s*\([^()]{1,40}\)\s*$/, '').trim();
  return clip(first, 80);
}

// أخبار روتينية بتتكرر كل يوم (مش «حدث»)
const ROUTINE = /(سعر|اسعار|أسعار)\s+(الذهب|الدولار|الصرف|العملات|الحديد|الفراخ)|مواقيت الصلاة|موعد (اذان|أذان)|حالة الطقس|درجات الحرارة|بث مباشر|ملخص (و)?اهداف|ملخص وأهداف|القنوات الناقلة|ترتيب الدوري|نتيجة مباراة|تردد قناة|^مواقيت|صحيفة|جريدة|موقع/;
const STOP = new Set('اليوم امس أمس بعد قبل خلال حول على علي الى إلى التي الذي هذا هذه ذلك بين منذ عند عام عاما كانت يكون تكون اكثر أكثر مصر مصري المصري المصرية السعودية الامارات الإمارات الخليج العربي العربية رسميا رسمياً عاجل فيديو صور شاهد تعرف تفاصيل جديد جديدة الخميس الجمعة السبت الاحد الأحد الاثنين الإثنين الثلاثاء الاربعاء الأربعاء نوفمبر ديسمبر يناير ماذا لماذا كيف متى رغم بسبب حتى ضمن مليون مليار الف ألف آلاف الاف اول أول اخر آخر قال قالت يقول بعد قبل ضد امام أمام جميع كبير كبيرة الكامل الكاملة القصة اخبار أخبار لايف مباشر نيويورك'.split(' ').map(norm));
const toks = s => norm(s).split(/[^\p{L}\p{N}]+/u).filter(w => w.length >= 4 && !STOP.has(w) && !/^\d+$/.test(w));

// القصص اللي مصادر كتير بتكتب عنها النهارده: كلمة مميزة (زي «الوراق») ظهرت فجأة في مصادر كتير مختلفة
// ومش كلمة دايمة (زي «الذكاء الاصطناعي») — بنقارن بالأيام اللي فاتت (old = نفس المصادر قبل كده، معدّل لكل ٣٠ ساعة)
export function newsClusters(items, old = [], oldHours = 0) {
  const docs = items.map(i => ({ i, w: new Set(toks(i.title)) }));
  const by = new Map(); docs.forEach((d, k) => { for (const w of d.w) { if (!by.has(w)) by.set(w, []); by.get(w).push(k); } });
  const oldN = new Map(); for (const i of old) for (const w of new Set(toks(i.title))) oldN.set(w, (oldN.get(w) || 0) + 1);
  const scale = oldHours > 0 ? 30 / oldHours : 0;
  const anchors = [...by.entries()].map(([w, ks]) => {
    const F = new Set(ks.map(k => docs[k].i.feed)).size, Rn = ks.length, On = (oldN.get(w) || 0) * scale;
    return { w, ks, F, score: F * Rn / (Rn + On) };
  }).filter(a => a.F >= 3).sort((a, b) => b.score - a.score || b.F - a.F);
  const used = new Set(), out = [];
  for (const an of anchors) {
    if (an.ks.filter(k => used.has(k)).length >= an.ks.length * 0.5) continue;
    an.ks.forEach(k => used.add(k));
    const ds = an.ks.map(k => docs[k]);
    // الاسم = أكتر كلمتين ورا بعض فيهم الكلمة دي (زي «حادث الوراق»)
    const bi = new Map();
    for (const d of ds) { const raw = d.i.title.replace(/[«»"“”'.,:،؛!?؟()\[\]|/-]/g, ' ').split(/\s+/).filter(Boolean); const seen = new Set();
      for (let k = 0; k + 1 < raw.length; k++) { const x = norm(raw[k]), y = norm(raw[k + 1]);
        if ((x !== an.w && y !== an.w) || x.length < 3 || y.length < 3 || STOP.has(x) || STOP.has(y) || /\d/.test(x + y)) continue;
        const key = x + ' ' + y; if (seen.has(key)) continue; seen.add(key);
        const e = bi.get(key) || { n: 0, txt: raw[k] + ' ' + raw[k + 1] }; e.n++; bi.set(key, e); } }
    const top = [...bi.values()].sort((x, y) => y.n - x.n)[0];
    if (!top || top.n < Math.max(2, ds.length * 0.3)) { an.ks.forEach(k => used.delete(k)); continue; } // مش قصة واحدة متماسكة
    const cw = new Map(); for (const d of ds) for (const w of d.w) cw.set(w, (cw.get(w) || 0) + 1);
    const cen = d => [...d.w].reduce((t, w) => t + (cw.get(w) || 1) - 1, 0) - (d.i.type === 'radar' ? 2 : 0) - (d.i.title.length > 95 ? 3 : 0);
    const rep = [...ds].sort((x, y) => cen(y) - cen(x))[0];
    out.push({ n: an.F, score: an.score, items: ds.map(d => d.i), name: top.txt, rep: rep.i });
    if (out.length >= 8) break;
  }
  return out;
}

// العناصر: k = search (بحث جوجل) | news (أخبار كتير بتغطيه)
export function pickTrends(feeds, trends, region, now = Date.now()) {
  const gfeed = 'gt-' + region;
  const arabGeo = region in NAMES;
  const peak = new Map(Object.values(trends?.t || {}).filter(v => v.feed === gfeed).map(v => [norm(v.title), v.peak || 0]));
  const search = (feeds.items || []).filter(i => i.feed === gfeed)
    .filter(i => { const t = (i.title || '').trim(), d = gtDesc(i.summary);
      return t.length > 1 && !SKIP.test(t) && !ROUTINE.test(t) && !FOREIGN.test(t + ' ' + d) && (!arabGeo || /[؀-ۿ]/.test(t)); })
    .map(i => { const n = Number(i.traffic) || peak.get(norm(i.title)) || 0; return { k: 'search', t: clip(i.title, 40), d: gtDesc(i.summary), num: n, score: 1 + Math.log2(Math.max(100, n) / 100) }; });
  const regs = [...(NEWS_REG[region] || []), 'arab'];
  const pool = (feeds.items || []).filter(i => regs.includes(i.region) && i.lang === 'ar' && !/^(gt|yt|wiki)/.test(i.feed) && !ROUTINE.test(i.title || ''));
  const age = i => (now - Date.parse(i.published || 0)) / 36e5;
  const recent = pool.filter(i => age(i) < 30), old = pool.filter(i => age(i) >= 30 && age(i) < 30 + 24 * 6);
  const local = LOCAL[region];
  const news = newsClusters(recent, old, 24 * 6)
    .map(c => ({ ...c, score: c.score + (local && c.items.some(i => local.test(i.title)) ? 1.5 : 0) })).sort((a, b) => b.score - a.score).slice(0, 3).map(c => ({
    k: 'news', t: clip(c.name || c.rep.title, c.name ? 40 : 64), d: clip(c.rep.title.replace(/^[^.:]{2,14}(\.\.|:)\s*/, ''), 80), num: c.n,
    words: c.items.map(i => i.title).join(' '), score: 1 + c.score * 1.1 }));
  // بحث جوجل ليه نفس موضوع خبر؟ بنخلي الخبر (أوضح) ونزوّد له عدد البحث
  const out = [...news];
  for (const s of search.sort((a, b) => b.score - a.score)) {
    const dup = out.find(x => sameStory(x.words || x.t, s.t) || sameStory(x.t, s.d) || (x.words && toks(s.t).length && toks(s.t).every(w => toks(x.words).includes(w))));
    if (dup) { if (dup.k === 'news' && !dup.srch) { dup.srch = s.num; dup.score += 0.5; } continue; }
    out.push(s);
  }
  const seen = new Set();
  return out.filter(x => { const key = norm(x.t); if (seen.has(key)) return false; seen.add(key); return true; })
    .sort((a, b) => b.score - a.score).slice(0, 5)
    .map(x => ({ k: x.k, t: x.t, d: x.d, n: x.k === 'news' ? AR(x.num) : '+' + AR(x.num || 0), unit: x.k === 'news' ? 'مصدر' : 'بحث',
      extra: x.srch ? '+' + AR(x.srch) + ' بحث' : '', w: Math.round(x.score * 10) / 10 }));
}

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const arg = (k, d) => { const i = process.argv.indexOf('--' + k); return i > 0 ? process.argv[i + 1] : d; };
  const region = arg('region', 'eg');
  const out = resolve(arg('out', `out/trends-${region}.mp4`));
  const dry = process.argv.includes('--dry');
  const feeds = JSON.parse(readFileSync('data/feeds.json', 'utf8'));
  const trends = JSON.parse(readFileSync('data/trends.json', 'utf8'));
  const items = pickTrends(feeds, trends, region);
  if (items.length < 5) throw new Error(`لقيت ${items.length} مواضيع بس لـ ${region} — محتاجين ٥`);
  const latest = feeds.generatedAt;
  const country = NAMES[region] || region;
  const date = new Date(latest).toLocaleDateString('ar-EG', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'Africa/Cairo' });
  const vars = { items: JSON.stringify(items), date, country, source: `Google Trends + المصادر الإخبارية — ${country}` };
  console.log(`📅 ${date} — ${country} — آخر تحديث ${latest}`);
  items.forEach((it, i) => console.log(`${i + 1}. [${it.k}] ${it.t}  (${it.n} ${it.unit}) — ${it.d}`));
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out.replace(/\.mp4$/, '.json'), JSON.stringify({ region, latest, items }, null, 2));
  if (dry) process.exit(0);
  execFileSync('npx', ['--yes', 'hyperframes@0.9.94', 'render', '--variables', JSON.stringify(vars), '--quality', 'standard', '--fps', '30', '-o', out],
    { cwd: resolve('hyperframes/trends-eg'), stdio: 'inherit', env: { ...process.env, HYPERFRAMES_SKIP_SKILLS: '1', HYPERFRAMES_TELEMETRY: '0' } });
  console.log('✅', out);
}
