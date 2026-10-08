// نموذج الريل: بيانات، تقطيع السكريبت لسطور (أ/ب)، وحساب التوقيت

export const MED_DISCLAIMER = 'معلومة عامة وليست استشارة طبية — استشر طبيبك';

export function newReel(over = {}) {
  return {
    category: 'politics',
    headline: '',
    script: '',
    sourceName: '',
    sourceUrl: '',
    credit: '',
    fromYoutube: '',
    claimKind: 'fact',
    checks: {},
    ...over,
  };
}

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

const GAP = 0.3;

// بياخد السطور + بيانات الصوت لكل سطر ({buffer, words:[{w,s,e}]}) ويرجّع خط زمني مطلق
export function buildTimeline(lines, audios) {
  let t = 0.2;
  const segs = [];
  lines.forEach((ln, i) => {
    const a = audios[i];
    if (!a) return;
    const words = a.words.map(x => ({ w: x.w, s: t + x.s, e: t + x.e }));
    segs.push({ speaker: ln.speaker, text: ln.text, start: t, end: t + a.buffer.duration, words, buffer: a.buffer, at: t });
    t += a.buffer.duration + GAP;
  });
  return { segs, duration: Math.max(1, t - GAP + 0.6) };
}

// توزيع كلمات بالتساوي (حسب عدد الحروف) لما الصوت من تسجيل أو ملف ومفيش توقيت حقيقي
export function estimateWords(text, duration) {
  const ws = text.split(/\s+/).filter(Boolean);
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
