// ملفات مساعدة للتصدير: ترجمة SRT (من توقيت الكلمات) وصوت WAV (للمونتاج في برنامج تاني زي Filmora)
import { phrases } from './reel.js?v=mv28jjt1';

const pad = (n, w = 2) => String(Math.floor(n)).padStart(w, '0');
function tc(t) {
  const ms = Math.max(0, Math.round(t * 1000));
  return `${pad(ms / 3600000)}:${pad((ms / 60000) % 60)}:${pad((ms / 1000) % 60)},${pad(ms % 1000, 3)}`;
}

// كل عبارة (حتى maxWords كلمة) = سطر ترجمة. الوقت من أول كلمة لآخر كلمة (مش بيتداخل مع اللي بعده)
export function buildSrt(segs, maxWords = 6) {
  const cues = [];
  for (const s of segs) {
    for (const g of phrases(s.words || [], maxWords)) {
      if (!g.length) continue;
      cues.push({ start: g[0].s, end: g[g.length - 1].e, text: g.map(w => w.w).join(' ') });
    }
  }
  cues.sort((a, b) => a.start - b.start);
  cues.forEach((c, i) => { const next = cues[i + 1]; c.end = Math.max(c.start + 0.3, Math.min(c.end + 0.15, next ? next.start - 0.02 : c.end + 0.15)); });
  return cues.map((c, i) => `${i + 1}\n${tc(c.start)} --> ${tc(c.end)}\n${c.text}\n`).join('\n');
}

// WAV ستيريو 16-bit من قناتين Float32
export function wavBlob(left, right, sampleRate) {
  const n = left.length, buf = new ArrayBuffer(44 + n * 4), v = new DataView(buf);
  const str = (o, s) => { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)); };
  str(0, 'RIFF'); v.setUint32(4, 36 + n * 4, true); str(8, 'WAVE'); str(12, 'fmt ');
  v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 2, true);
  v.setUint32(24, sampleRate, true); v.setUint32(28, sampleRate * 4, true); v.setUint16(32, 4, true); v.setUint16(34, 16, true);
  str(36, 'data'); v.setUint32(40, n * 4, true);
  const clip = x => Math.max(-1, Math.min(1, x));
  for (let i = 0, o = 44; i < n; i++, o += 4) {
    v.setInt16(o, Math.round(clip(left[i]) * 32767), true);
    v.setInt16(o + 2, Math.round(clip(right[i]) * 32767), true);
  }
  return new Blob([buf], { type: 'audio/wav' });
}

export function download(blob, name) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 10000);
}
