// نموذج الريل (حلقة من خبر أو أكتر): بيانات، تقطيع السكريبت لسطور (أ/ب)، وحساب التوقيت

export const MED_DISCLAIMER = 'معلومة عامة وليست استشارة طبية — استشر طبيبك';

export const STATUSES = { draft: 'مسودة', exported: 'متصدّر', published: 'منشور' };
export const KINDS = { news: 'خبر', intro: 'افتتاحية', outro: 'خاتمة' };
export const TEMPLATES = { standard: 'عادي', breaking: 'عاجل', stat: 'بطاقة رقم', map: 'خريطة', proof: 'توثيق (مصادر)' };
export const PROOF_STATUS = { none: 'من غير حالة', official: 'مؤكد رسميًا', reported: 'تقارير غير مؤكدة', pending: 'بانتظار التأكيد' };
export const newProofSource = () => ({ outlet: '', title: '', date: '', url: '', shot: null });

const rid = p => p + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);

export function newStory(over = {}) {
  const s = {
    kind: 'news',
    category: 'politics',
    headline: '',
    script: '',
    sourceName: '',
    sourceUrl: '',
    credit: '',
    claimKind: 'fact',
    fromYoutube: '',
    ytLink: '',
    ref: '', // ملخص/نص مرجعي من المصدر (مش بيظهر في الفيديو)
    media: null, // { id, kind, provider, title, credit, license, licenseUrl, page, tier, dim }
    template: 'standard', // standard | breaking | stat | map
    stat: { value: '', unit: '', label: '', trend: 'none' },
    map: { countries: [], label: '', pins: [] },
    proof: { status: 'none', sources: [] },
    ...over,
  };
  s.stat = { value: '', unit: '', label: '', trend: 'none', ...(s.stat || {}) };
  s.map = { countries: [], label: '', pins: [], ...(s.map || {}) };
  s.proof = { status: 'none', sources: [], ...(s.proof || {}) };
  if (!s.id) s.id = rid('s');
  return s;
}

export function newReel(over = {}) {
  const r = { status: 'draft', updatedAt: Date.now(), title: '', stories: [newStory()], ticker: { on: false, text: '', label: '' }, ...over };
  r.ticker = { on: false, text: '', label: '', ...(r.ticker || {}) };
  if (!r.id) r.id = rid('r');
  return r;
}

// ريلز المرحلة الأولى كانت خبر واحد بحقول مسطّحة، بنحوّلها لخبر جوه stories
export function normalizeReel(r) {
  if (r && Array.isArray(r.stories) && r.stories.length) {
    r.stories = r.stories.map(s => newStory(s));
    r.ticker = { on: false, text: '', label: '', ...(r.ticker || {}) };
    return r;
  }
  const { id, status, updatedAt, title, ...rest } = r || {};
  return newReel({ id, status: status || 'draft', updatedAt: updatedAt || Date.now(), title: title || '', stories: [newStory(rest)] });
}

export const isEmptyStory = s => !s.headline && !s.script.trim() && !s.sourceName && !s.sourceUrl;

// "أ: نص" / "ب: نص" / سطر من غير حرف = المذيع أ. بيرجع [{speaker:'A'|'B', text}]
export function parseScript(text) {
  const out = [];
  for (const raw of String(text || '').split(/\n+/)) {
    const line = raw.trim();
    if (!line) continue;
    const m = line.match(/^\s*(أ|ا|a|ب|b)\s*[:：]\s*(.*)$/i);
    if (m) {
      const sp = /^(ب|b)$/i.test(m[1]) ? 'B' : 'A';
      if (m[2].trim()) out.push({ speaker: sp, text: m[2].trim() });
    } else out.push({ speaker: 'A', text: line });
  }
  return out;
}

// وسوم ElevenLabs v3 زي [sad] مبتتقراش ومبتظهرش على الشاشة
export const stripTags = t => String(t || '').replace(/\[[^\]]*\]/g, ' ').replace(/\s+/g, ' ').trim();

export const lineKey = l => l.speaker + '|' + l.text;

// كل سطور الريل (من كل الأخبار) مع رقم الخبر
export function allLines(reel) {
  return reel.stories.flatMap((s, si) => parseScript(s.script).map(l => ({ ...l, storyIdx: si })));
}

const GAP = 0.3;       // بين سطرين في نفس الخبر
const STORY_GAP = 0.8; // بين خبرين
const LEAD = 0.2;

// توزيع كلمات بالتساوي (حسب عدد الحروف) لما الصوت من تسجيل أو ملف ومفيش توقيت حقيقي
export function estimateWords(text, duration) {
  const ws = stripTags(text).split(/\s+/).filter(Boolean);
  const total = ws.reduce((n, w) => n + w.length + 1, 0) || 1;
  let c = 0;
  return ws.map(w => {
    const s = (c / total) * duration;
    c += w.length + 1;
    return { w, s, e: (c / total) * duration };
  });
}

// تقسيم الكلمات لعبارات قصيرة للكابشن
export function phrases(words, max = 5) {
  const out = [];
  for (let i = 0; i < words.length; i += max) out.push(words.slice(i, i + max));
  return out;
}

// حدود كل خبر على الخط الزمني: من منتصف الفاصل قبله لمنتصف الفاصل بعده
function storyRanges(segs, duration) {
  const first = new Map(), last = new Map();
  for (const s of segs) {
    if (!first.has(s.storyIdx)) first.set(s.storyIdx, s.start);
    last.set(s.storyIdx, s.end);
  }
  const idxs = [...first.keys()];
  return idxs.map((idx, k) => ({
    idx,
    start: k === 0 ? 0 : (last.get(idxs[k - 1]) + first.get(idx)) / 2,
    end: k === idxs.length - 1 ? duration : (last.get(idx) + first.get(idxs[k + 1])) / 2,
  }));
}

// الخط الزمني للريل كله.
// audioMap: Map(lineKey → {buffer, words}); manual: AudioBuffer لتسجيل/ملف بيغطي الريل كله
// بيرجع { tl:{segs, stories, duration}, real, lines, hasB }
export function buildReelTimeline(reel, audioMap, manual = null) {
  const lines = allLines(reel);
  const hasB = lines.some(l => l.speaker === 'B');
  if (!lines.length) return { tl: { segs: [], stories: [], duration: 3 }, real: false, lines, hasB };

  const segs = [];
  if (manual) {
    // التسجيل بيتوزّع على الأخبار بنسبة عدد الحروف
    const per = reel.stories.map((s, si) => ({ si, text: stripTags(parseScript(s.script).map(l => l.text).join(' ')) })).filter(x => x.text);
    const total = per.reduce((n, x) => n + x.text.length, 0) || 1;
    let at = LEAD;
    per.forEach((x, k) => {
      const d = manual.duration * (x.text.length / total);
      const words = estimateWords(x.text, d).map(w => ({ ...w, s: w.s + at, e: w.e + at }));
      segs.push({ speaker: 'A', text: x.text, storyIdx: x.si, start: at, end: at + d, at: LEAD, buffer: k === 0 ? manual : null, words });
      at += d;
    });
    return { tl: { segs, stories: storyRanges(segs, LEAD + manual.duration + 0.6), duration: LEAD + manual.duration + 0.6 }, real: true, lines, hasB };
  }

  let t = LEAD, real = true;
  reel.stories.forEach((st, si) => {
    const ls = parseScript(st.script);
    ls.forEach((l, li) => {
      let a = audioMap.get(lineKey(l));
      if (!a) {
        real = false;
        const d = Math.max(1.5, stripTags(l.text).length / 13);
        a = { buffer: { duration: d }, words: estimateWords(l.text, d) };
      }
      const dur = a.buffer.duration;
      segs.push({ speaker: l.speaker, text: l.text, storyIdx: si, start: t, end: t + dur, at: t, buffer: a.buffer, words: a.words.map(w => ({ w: w.w, s: t + w.s, e: t + w.e })) });
      t += dur + (li === ls.length - 1 ? STORY_GAP : GAP);
    });
  });
  const duration = Math.max(1, t - STORY_GAP + 0.6);
  return { tl: { segs, stories: storyRanges(segs, duration), duration }, real, lines, hasB };
}
