// نموذج الريل (حلقة من خبر أو أكتر): بيانات، تقطيع السكريبت لسطور (أ/ب)، وحساب التوقيت

export const MED_DISCLAIMER = 'معلومة عامة وليست استشارة طبية — استشر طبيبك';

export const STATUSES = { draft: 'مسودة', review: 'جاهز للمراجعة', exported: 'متصدّر', published: 'منشور' };
export const KINDS = { news: 'خبر', idea: 'فكرة', intro: 'افتتاحية', outro: 'خاتمة' };
export const TEMPLATES = { standard: 'عادي', breaking: 'عاجل', stat: 'بطاقة رقم', map: 'خريطة', proof: 'توثيق (مصادر)', quote: 'اقتباس', timeline: 'خط زمني' };
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
    scenes: [], // مونتاج: [{li, q, media}] صورة/فيديو لكل جملة أو أكتر
    refOrig: '', // نص المقال الأصلي بعد التلخيص (مخفي، مرجع للمحرر الذكي بس)
    media: null, // { id, kind, provider, title, credit, license, licenseUrl, page, tier, dim }
    template: 'standard', // standard | breaking | stat | map
    stat: { value: '', unit: '', label: '', trend: 'none' },
    map: { countries: [], label: '', pins: [] },
    proof: { status: 'none', sources: [] },
    quote: { text: '', who: '', role: '' },
    timeline: { events: [] },
    agent: null, // نتيجة المحرر الذكي (الادعاءات التاريخية اللي لازم تتراجع)
    lower: { on: false, name: '', role: '' },
    ...over,
  };
  s.stat = { value: '', unit: '', label: '', trend: 'none', ...(s.stat || {}) };
  s.map = { countries: [], label: '', pins: [], ...(s.map || {}) };
  s.proof = { status: 'none', sources: [], ...(s.proof || {}) };
  s.quote = { text: '', who: '', role: '', ...(s.quote || {}) };
  s.timeline = { events: [], ...(s.timeline || {}) };
  s.lower = { on: false, name: '', role: '', ...(s.lower || {}) };
  if (!s.id) s.id = rid('s');
  return s;
}

export const BUMPER = 2.2; // مدة المقدمة/الخاتمة التلقائية بالثواني
const avatarsOf = a => ({ on: false, mode: 'cartoon', scene: 'studio', who: 'both', seconds: 6, skin: 'm', hijab: false, beard: false, ...(a || {}) });
const bumpersOf = b => ({ intro: { on: false, text: '', ...(b?.intro || {}) }, outro: { on: false, text: '', style: 'simple', secs: 5, next: '', ...(b?.outro || {}) } });
// مدة الخاتمة: البسيطة ثانيتين، وشاشة النهاية المتحركة 3-8 ث (افتراضي 5)
export const outroDur = r => { const o = r?.bumpers?.outro; return !o?.style || o.style === 'simple' ? BUMPER : Math.max(3, Math.min(8, Number(o.secs) || 5)); };

export function newReel(over = {}) {
  const r = { status: 'draft', updatedAt: Date.now(), title: '', stories: [newStory()], ticker: { on: false, text: '', label: '' }, ...over };
  r.bumpers = bumpersOf(r.bumpers);
  r.avatars = avatarsOf(r.avatars);
  r.ticker = { on: false, text: '', label: '', ...(r.ticker || {}) };
  r.format = r.format || 'v';
  r.lang = r.lang || 'ar';
  if (!r.id) r.id = rid('r');
  return r;
}

// ريلز المرحلة الأولى كانت خبر واحد بحقول مسطّحة، بنحوّلها لخبر جوه stories
export function normalizeReel(r) {
  if (r && Array.isArray(r.stories) && r.stories.length) {
    r.stories = r.stories.map(s => newStory(s));
    r.ticker = { on: false, text: '', label: '', ...(r.ticker || {}) };
    r.format = r.format || 'v';
    r.lang = r.lang || 'ar';
    r.bumpers = bumpersOf(r.bumpers);
    r.avatars = avatarsOf(r.avatars);
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
    // سطر «المصدر: …» مبيتقراش ومبيظهرش ككابشن: اسم المصدر ظاهر على الشاشة أصلًا
    if (!line || /^(المصدر|المصادر|source|sources)\s*[:：]/i.test(line)) continue;
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

// صوت الجرافيك: auto = حسب النوع (عدّاد = تكتكة + جرس، سنة = ووش، نسبة = جرس، كلمة = ضربة)
export const GFX_SFX = { auto: 'أوتوماتيك', none: 'من غير صوت', tickding: 'تكتكة + جرس', ding: 'جرس', whoosh: 'ووش', boom: 'ضربة (بووم)', pop: 'بوب' };
export function gfxSfxOf(g) {
  const k = g.sfx || 'auto';
  if (k === 'none') return [];
  if (k === 'auto') return { count: ['whoosh', 'tick', 'ding'], year: ['whoosh', 'tick'], pct: ['whoosh', 'ding'], text: ['boom'] }[g.type] || [];
  if (k === 'tickding') return ['tick', 'ding'];
  return [k];
}

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

// مقدمة/خاتمة تلقائية: بتتضاف كعناصر في stories بـ idx = -1 (من غير صوت)، والمحتوى الفعلي بيبدأ بعد المقدمة
function withBumpers(reel, segs, duration0) {
  const stories = storyRanges(segs, duration0);
  const bp = reel.bumpers || {};
  let duration = duration0;
  if (bp.intro?.on) { if (stories.length) stories[0].start = BUMPER; stories.unshift({ idx: -1, bumper: 'intro', start: 0, end: BUMPER }); }
  if (bp.outro?.on) {
    const od = outroDur(reel);
    stories.push({ idx: -1, bumper: 'outro', start: duration0, end: duration0 + od }); duration = duration0 + od;
    // صوت «بوب» لحظة الضغط على زرار المتابعة (و«دينج» للجرس)، متعلّق بآخر سطر بوقت مطلق
    const st = bp.outro.style, last = segs[segs.length - 1];
    if (last && st && st !== 'simple') last.sfx = [...(last.sfx || []), { kind: 'pop', at: duration0 + 1.3 - 0.3 }, ...(st === 'subscribe' ? [{ kind: 'ding', at: duration0 + 1.7 - 1.5 }] : [])];
  }
  return { segs, stories, duration };
}

// الخط الزمني للريل كله.
// audioMap: Map(lineKey → {buffer, words}); manual: AudioBuffer لتسجيل/ملف بيغطي الريل كله
// بيرجع { tl:{segs, stories, duration}, real, lines, hasB }
export function buildReelTimeline(reel, audioMap, manual = null, clipAudio = null) {
  const lines = allLines(reel);
  const hasB = lines.some(l => l.speaker === 'B');
  if (!lines.length) return { tl: { segs: [], stories: [], duration: 3 }, real: false, lines, hasB };

  const segs = [];
  if (manual) {
    // التسجيل بيتوزّع على الأخبار بنسبة عدد الحروف
    const per = reel.stories.map((s, si) => ({ si, text: stripTags(parseScript(s.script).map(l => l.text).join(' ')) })).filter(x => x.text);
    const total = per.reduce((n, x) => n + x.text.length, 0) || 1;
    const t0 = reel.bumpers?.intro?.on ? BUMPER : 0;
    let at = LEAD + t0;
    per.forEach((x, k) => {
      const d = manual.duration * (x.text.length / total);
      const words = estimateWords(x.text, d).map(w => ({ ...w, s: w.s + at, e: w.e + at }));
      segs.push({ speaker: 'A', text: x.text, storyIdx: x.si, start: at, end: at + d, at: LEAD + t0, buffer: k === 0 ? manual : null, words });
      at += d;
    });
    return { tl: withBumpers(reel, segs, LEAD + t0 + manual.duration + 0.6), real: true, lines, hasB };
  }

  let t = LEAD + (reel.bumpers?.intro?.on ? BUMPER : 0), real = true;
  // 📺 مقاطع القنوات للتعليق: كل مقطع بيتحط قبل السطر رقم c.at (أو آخر الخبر) بصوته الأصلي
  const clipSeg = (c, si) => {
    const d = Math.max(0.5, (c.out ?? 0) - (c.in ?? 0));
    const buf = clipAudio?.get(c.id + ':' + (c.in ?? 0) + ':' + (c.out ?? 0)) || { duration: d };
    segs.push({ speaker: 'C', clip: c, text: '', storyIdx: si, start: t, end: t + d, at: t, buffer: buf, words: [] });
    t += d + GAP;
  };
  reel.stories.forEach((st, si) => {
    const ls = parseScript(st.script);
    const clips = (st.clips || []).filter(c => c.id && (c.out ?? 0) > (c.in ?? 0));
    const tail = clips.filter(c => !(c.at >= 0 && c.at < ls.length));
    if (!ls.length && clips.length) { clips.forEach(c => clipSeg(c, si)); t += STORY_GAP - GAP; return; }
    ls.forEach((l, li) => {
      clips.filter(c => c.at === li).forEach(c => clipSeg(c, si));
      let a = audioMap.get(lineKey(l));
      if (!a) {
        real = false;
        const d = Math.max(1.5, stripTags(l.text).length / 13);
        a = { buffer: { duration: d }, words: estimateWords(l.text, d) };
      }
      const dur = a.buffer.duration;
      segs.push({ speaker: l.speaker, text: l.text, storyIdx: si, start: t, end: t + dur, at: t, buffer: a.buffer, words: a.words.map(w => ({ w: w.w, s: t + w.s, e: t + w.e })) });
      t += dur + (li === ls.length - 1 && !tail.length ? STORY_GAP : GAP);
    });
    if (ls.length && tail.length) { tail.forEach(c => clipSeg(c, si)); t += STORY_GAP - GAP; }
  });
  const duration = Math.max(1, t - STORY_GAP + 0.6);
  // 🔊 أصوات الجرافيكس: بنعلّق على سطر الجرافيك نوع الصوت، و audio.js بيولّده في الميكس
  reel.stories.forEach((st, si) => {
    const mine = segs.filter(x => x.storyIdx === si && !x.clip);
    for (const g of st.gfx || []) {
      const sfx = gfxSfxOf(g);
      if (g.off || !sfx.length || !mine[g.li]) continue;
      mine[g.li].sfx = [...(mine[g.li].sfx || []), ...sfx.map(kind => ({ kind, type: g.type }))];
    }
  });
  return { tl: withBumpers(reel, segs, duration), real, lines, hasB };
}
