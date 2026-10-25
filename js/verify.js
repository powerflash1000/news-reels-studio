// مقارنة ادعاء (مثلًا من يوتيوبر) بالأخبار المتجمّعة من المصادر: بنفس الكلمات المهمة والأرقام، من غير أي خدمة خارجية.
// ده كاشف تطابق مش حكم نهائي: النتيجة بتتراجع بإيدك قبل ما تتحط في الريل.

const AR_DIAC = /[ً-ٰٟـ]/g;
const STOP = new Set(('في من على الى إلى عن مع هذا هذه ذلك تلك هو هي هم هن ان أن إن كان كانت يكون تكون ما لا لم لن قد كل بعد قبل بين حتى او أو ثم لكن اي أي التي الذي الذين اللي ده دي دول ايه ليه ازاي كده فيه عند عندما حيث هل كيف لماذا ماذا ' +
  'the a an of to in on for and or is are was were be been by with at from as that this these those it its has have had will would can could not no new says said say after before over into about amid vs').split(/\s+/));

const DIGITS = { '٠': '0', '١': '1', '٢': '2', '٣': '3', '٤': '4', '٥': '5', '٦': '6', '٧': '7', '٨': '8', '٩': '9', '۰': '0', '۱': '1', '۲': '2', '۳': '3', '۴': '4', '۵': '5', '۶': '6', '۷': '7', '۸': '8', '۹': '9' };
export function norm(s) {
  return String(s || '').toLowerCase().replace(/[٠-٩۰-۹]/g, d => DIGITS[d]).replace(AR_DIAC, '')
    .replace(/[إأآٱ]/g, 'ا').replace(/ى/g, 'ي').replace(/ؤ/g, 'و').replace(/ئ/g, 'ي').replace(/ة/g, 'ه');
}
function stem(w) {
  if (/^[a-z0-9]+$/.test(w)) return w.length > 4 ? w.replace(/(ing|ed|es|s)$/, '') : w;
  let x = w;
  if (x.length > 4 && x.startsWith('وال')) x = x.slice(3);
  else if (x.length > 3 && (x.startsWith('ال') || x.startsWith('لل'))) x = x.slice(2);
  else if (x.length > 3 && /^[وبلكف]/.test(x) && x.length > 4) x = x.slice(1);
  if (x.length > 4 && /(ات|ون|ين|ان)$/.test(x)) x = x.slice(0, -2);
  if (x.length > 3 && x.endsWith('ه')) x = x.slice(0, -1);
  return x;
}
export function numbers(s) {
  return [...new Set((norm(s).replace(/(\d)[,٬](\d{3})(?!\d)/g, '$1$2').match(/\d+(?:[.,]\d+)?/g) || []).map(n => n.replace(',', '.')).filter(n => n.length > 1 || Number(n) > 9))];
}
export function tokens(s) {
  const out = [];
  for (const w of norm(s).split(/[^a-z0-9؀-ۿ]+/)) {
    if (!w || STOP.has(w) || STOP.has(stem(w))) continue;
    if (/^\d+$/.test(w)) continue; // الأرقام بنقارنها لوحدها
    const t = stem(w);
    if (t.length >= 2) out.push(t);
  }
  return [...new Set(out)];
}

const PRIMARY = new Set(['agency', 'public', 'state', 'official']);

export function buildIndex(items) {
  const docs = [], df = new Map();
  for (const it of items) {
    if (it.kind === 'youtube' || it.type === 'trend') continue; // اليوتيوب رادار، وعناوين الترند كلمات بحث مش ادعاءات
    const t = tokens(`${it.title} ${(it.summary || '').slice(0, 300)}`);
    for (const w of t) df.set(w, (df.get(w) || 0) + 1);
    docs.push({ it, set: new Set(t), nums: numbers(`${it.title} ${it.summary || ''}`.slice(0, 500)), titleSet: new Set(tokens(it.title)) });
  }
  const N = docs.length || 1;
  const idf = w => Math.log(1 + N / (1 + (df.get(w) || 0)));
  return { docs, idf };
}

// النتيجة: { verdict: confirmed|conflict|related|none, matches:[{item, cover, shared, numbers:'same'|'diff'|'na', primary}], outlets }
export function verifyClaim(claim, index) {
  const ct = tokens(claim), cn = numbers(claim);
  if (ct.length < 2) return { verdict: 'none', matches: [], outlets: 0, tooShort: true, claimNumbers: cn };
  const total = ct.reduce((s, w) => s + index.idf(w), 0) || 1;
  const scored = [];
  for (const d of index.docs) {
    let hit = 0; const shared = [];
    for (const w of ct) if (d.set.has(w)) { hit += index.idf(w); shared.push(w); }
    if (shared.length < 2) continue;
    const cover = hit / total;
    if (cover < 0.2) continue;
    const dn = d.nums;
    const numbersState = !cn.length || !dn.length ? 'na' : cn.some(n => dn.includes(n)) ? 'same' : 'diff';
    scored.push({ item: d.it, cover, shared, numbers: numbersState, primary: PRIMARY.has(d.it.type) });
  }
  scored.sort((a, b) => (b.cover + (b.primary ? 0.05 : 0)) - (a.cover + (a.primary ? 0.05 : 0)) || (Date.parse(b.item.published) || 0) - (Date.parse(a.item.published) || 0));
  const matches = scored.slice(0, 6);
  const strong = scored.filter(m => m.cover >= 0.5);
  const outlets = new Set(strong.map(m => m.item.source)).size;
  const best = matches[0];
  let verdict = 'none';
  if (best) {
    if (best.cover >= 0.5 && best.numbers !== 'diff') verdict = 'confirmed';
    else if (best.cover >= 0.4 && best.numbers === 'diff') verdict = 'conflict';
    else if (best.cover >= 0.3) verdict = 'related';
  }
  // "مؤكد" بدون مصدر رسمي/وكالة بيتنزّل لـ"بتقارير" عشان ما نبالغش
  if (verdict === 'confirmed' && !matches.some(m => m.primary && m.cover >= 0.5 && m.numbers !== 'diff')) verdict = 'reported';
  return { verdict, matches, outlets, claimNumbers: cn };
}

export const VERDICT_TXT = {
  confirmed: ['✅', 'متطابق مع مصدر رسمي/وكالة'],
  reported: ['🟡', 'موجود في تقارير (مفيش مصدر رسمي مطابق)'],
  conflict: ['⚠️', 'نفس الموضوع بس الأرقام مختلفة'],
  related: ['🔎', 'فيه أخبار قريبة بس مش مطابقة'],
  none: ['❌', 'مالقيتش حاجة مطابقة في الأخبار المتجمّعة'],
};
