// ظبط توقيت كلمات الكابشن بـ Whisper جوه المتصفح (transformers.js) — للصوت اللي مالوش توقيت حقيقي (صوت Gemini).
// الموديل بيتنزّل مرة واحدة من Hugging Face (حوالي 80 ميجا) والمتصفح بيحفظه. مفيش أي صوت بيطلع من الجهاز.
// Whisper بيسمع الصوت ويطلّع كلمات بتوقيتها، وبعدين بنطابقها على كلمات السكريبت (السكريبت هو النص الصح دايمًا).
const TF_URL = 'https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.5.1';
const MODEL = 'onnx-community/whisper-base_timestamped';

let asrP = null;
export function loadAsr(onProgress) {
  if (!asrP) {
    asrP = (async () => {
      const tf = await import(TF_URL);
      const device = navigator.gpu ? 'webgpu' : 'wasm';
      return tf.pipeline('automatic-speech-recognition', MODEL, {
        device, dtype: device === 'webgpu' ? 'fp32' : 'q8',
        progress_callback: p => { if (p.status === 'progress' && p.total) onProgress?.(p.loaded / p.total, p.file); },
      });
    })().catch(e => { asrP = null; throw e; });
  }
  return asrP;
}

// Whisper عايز صوت mono بتردد 16 كيلو
export async function to16k(buffer) {
  const len = Math.max(1, Math.ceil(buffer.duration * 16000));
  const oc = new OfflineAudioContext(1, len, 16000);
  const src = oc.createBufferSource();
  src.buffer = buffer;
  src.connect(oc.destination);
  src.start();
  return (await oc.startRendering()).getChannelData(0);
}

export async function transcribeWords(buffer, lang = 'ar', onProgress) {
  const asr = await loadAsr(onProgress);
  const out = await asr(await to16k(buffer), { language: lang === 'en' ? 'english' : 'arabic', task: 'transcribe', return_timestamps: 'word', chunk_length_s: 30 });
  return (out.chunks || []).map(c => ({ w: String(c.text || '').trim(), s: c.timestamp?.[0], e: c.timestamp?.[1] ?? c.timestamp?.[0] }))
    .filter(c => c.w && Number.isFinite(c.s));
}

// توحيد الكتابة للمقارنة (تشكيل، همزات، ة/ه، ى/ي، علامات)
export const normWord = w => String(w || '').toLowerCase()
  .replace(/[ً-ْٰـ]/g, '').replace(/[أإآٱ]/g, 'ا').replace(/ى/g, 'ي').replace(/ة/g, 'ه').replace(/ؤ/g, 'و').replace(/ئ/g, 'ي')
  .replace(/[^\p{L}\p{N}]/gu, '');

// نسبة التشابه (1 = نفس الكلمة) بمسافة Levenshtein
export function similarity(a, b) {
  a = normWord(a); b = normWord(b);
  if (!a || !b) return 0;
  if (a === b) return 1;
  const m = a.length, n = b.length;
  let prev = Array.from({ length: n + 1 }, (_, j) => j);
  for (let i = 1; i <= m; i++) {
    const cur = [i];
    for (let j = 1; j <= n; j++) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    prev = cur;
  }
  return 1 - prev[n] / Math.max(m, n);
}

// مطابقة كلمات السكريبت (words: [{w,s,e}] تقديري) على كلمات Whisper (asr) بالبرمجة الديناميكية،
// والكلمات اللي ملهاش مقابل بتتوزّع بين أقرب كلمتين متطابقتين حسب طولها. بيرجّع نفس الكلمات بتوقيت جديد.
export function alignWords(words, asr, duration) {
  const n = words.length, m = asr.length;
  if (!n || !m) return { words, matched: 0 };
  const MIN = 0.5;
  const S = Array.from({ length: n + 1 }, () => new Float32Array(m + 1));
  const B = Array.from({ length: n + 1 }, () => new Uint8Array(m + 1)); // 1 = مطابقة، 2 = تخطّي كلمة سكريبت، 3 = تخطّي كلمة Whisper
  for (let i = 1; i <= n; i++) B[i][0] = 2;
  for (let j = 1; j <= m; j++) B[0][j] = 3;
  for (let i = 1; i <= n; i++) {
    for (let j = 1; j <= m; j++) {
      let sc = similarity(words[i - 1].w, asr[j - 1].w);
      // الكلمات القصيرة (عن، في، من) لازم تبقى نفس الكلمة بالظبط
      if (sc < 1 && Math.min(normWord(words[i - 1].w).length, normWord(asr[j - 1].w).length) <= 2) sc = 0;
      let best = S[i - 1][j], b = 2;
      if (S[i][j - 1] > best) { best = S[i][j - 1]; b = 3; }
      if (sc >= MIN && S[i - 1][j - 1] + sc > best) { best = S[i - 1][j - 1] + sc; b = 1; }
      S[i][j] = best; B[i][j] = b;
    }
  }
  const anchor = new Array(n).fill(null);
  for (let i = n, j = m; i > 0 || j > 0;) {
    const b = B[i][j];
    if (b === 1) { anchor[i - 1] = asr[j - 1]; i--; j--; } else if (b === 2) i--; else j--;
  }
  const out = words.map(w => ({ ...w }));
  let matched = 0;
  for (let i = 0; i < n; i++) if (anchor[i]) { out[i].s = anchor[i].s; out[i].e = Math.max(anchor[i].e, anchor[i].s + 0.05); matched++; }
  if (!matched) return { words, matched: 0 };
  // الكلمات اللي في النص من غير مقابل: بين نهاية آخر مطابقة وبداية اللي بعدها
  for (let i = 0; i < n;) {
    if (anchor[i]) { i++; continue; }
    let j = i;
    while (j < n && !anchor[j]) j++;
    const t0 = i > 0 ? out[i - 1].e : 0;
    const t1 = j < n ? out[j].s : Math.max(t0, duration);
    const run = out.slice(i, j), total = run.reduce((a, w) => a + w.w.length + 1, 0) || 1;
    let c = 0;
    for (const w of run) { w.s = t0 + (c / total) * (t1 - t0); c += w.w.length + 1; w.e = t0 + (c / total) * (t1 - t0); }
    i = j;
  }
  // ترتيب سليم: مفيش كلمة تبدأ قبل اللي قبلها
  for (let i = 1; i < n; i++) { if (out[i].s < out[i - 1].s) out[i].s = out[i - 1].s; if (out[i].e < out[i].s) out[i].e = out[i].s + 0.05; }
  return { words: out, matched };
}
