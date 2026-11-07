// ملفات مساعدة للتصدير: ترجمة SRT (من توقيت الكلمات) وصوت WAV (للمونتاج في برنامج تاني زي Filmora)
import { phrases } from './reel.js?v=mw6bhrts';

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

// ZIP بسيط من غير ضغط (store) — كفاية للحزمة لأن الفيديو والصور مضغوطين أصلًا
const CRC = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
function crc32(u8) { let c = 0xffffffff; for (let i = 0; i < u8.length; i++) c = CRC[(c ^ u8[i]) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; }
export async function zipBlob(files) { // files: [{name, data: Blob|string}]
  const enc = new TextEncoder(), parts = [], central = [];
  let off = 0;
  const now = new Date(), dt = ((now.getHours() << 11) | (now.getMinutes() << 5) | (now.getSeconds() >> 1)) & 0xffff, dd = (((now.getFullYear() - 1980) << 9) | ((now.getMonth() + 1) << 5) | now.getDate()) & 0xffff;
  for (const f of files) {
    const data = typeof f.data === 'string' ? enc.encode(f.data) : new Uint8Array(await f.data.arrayBuffer());
    const name = enc.encode(f.name), crc = crc32(data);
    const h = new DataView(new ArrayBuffer(30));
    h.setUint32(0, 0x04034b50, true); h.setUint16(4, 20, true); h.setUint16(6, 0x0800, true); h.setUint16(8, 0, true);
    h.setUint16(10, dt, true); h.setUint16(12, dd, true); h.setUint32(14, crc, true); h.setUint32(18, data.length, true); h.setUint32(22, data.length, true);
    h.setUint16(26, name.length, true); h.setUint16(28, 0, true);
    parts.push(h.buffer, name, data);
    const c = new DataView(new ArrayBuffer(46));
    c.setUint32(0, 0x02014b50, true); c.setUint16(4, 20, true); c.setUint16(6, 20, true); c.setUint16(8, 0x0800, true); c.setUint16(10, 0, true);
    c.setUint16(12, dt, true); c.setUint16(14, dd, true); c.setUint32(16, crc, true); c.setUint32(20, data.length, true); c.setUint32(24, data.length, true);
    c.setUint16(28, name.length, true); c.setUint32(42, off, true);
    central.push(c.buffer, name);
    off += 30 + name.length + data.length;
  }
  const csize = central.reduce((n, b) => n + (b.byteLength ?? b.length), 0);
  const e = new DataView(new ArrayBuffer(22));
  e.setUint32(0, 0x06054b50, true); e.setUint16(8, files.length, true); e.setUint16(10, files.length, true); e.setUint32(12, csize, true); e.setUint32(16, off, true);
  return new Blob([...parts, ...central, e.buffer], { type: 'application/zip' });
}
export const tcShort = t => { const s = Math.max(0, t); return `${pad(s / 60)}:${pad(s % 60)}.${pad((s % 1) * 100)}`; };
