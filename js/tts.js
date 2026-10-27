// توليد الصوت من ElevenLabs مع توقيت كل كلمة، وكاش لكل سطر
import { getSettings, addChars, cacheGet, cachePut, sha1, load, save } from './storage.js?v=mvqvfx2z';
import { decode } from './audio.js?v=mvqvfx2z';
import { estimateWords } from './reel.js?v=mvqvfx2z';

const API = 'https://api.elevenlabs.io';

export const MODELS = [
  { id: 'eleven_multilingual_v2', name: 'Multilingual v2 (ثابت ومجرّب مع العربي)' },
  { id: 'eleven_v3', name: 'Eleven v3 (أحدث وأكثر تعبيرًا)' },
];

// الوسوم الصوتية (v3 بس) والتلميح باللهجة: على موديل v2 الوسوم بتتشال عشان متتقراش بصوت عالي
export const DIALECT_TAG = '[Egyptian Arabic accent]';
/* ---------- Gemini TTS (بديل ElevenLabs) ---------- */
export const GEMINI_VOICES = [
  ['Kore', 'حازم / ثابت'], ['Puck', 'مرح'], ['Charon', 'معلوماتي'], ['Fenrir', 'متحمس'], ['Zephyr', 'ساطع'], ['Leda', 'شبابي'],
  ['Orus', 'حازم'], ['Aoede', 'خفيف'], ['Callirrhoe', 'هادي'], ['Autonoe', 'ساطع'], ['Enceladus', 'ناعم'], ['Iapetus', 'واضح'],
  ['Umbriel', 'مريح'], ['Algieba', 'سلس'], ['Despina', 'سلس'], ['Erinome', 'واضح'], ['Algenib', 'خشن'], ['Rasalgethi', 'معلوماتي'],
  ['Laomedeia', 'مرح'], ['Achernar', 'ناعم'], ['Alnilam', 'حازم'], ['Schedar', 'متوازن'], ['Gacrux', 'ناضج'], ['Pulcherrima', 'صريح'],
  ['Achird', 'ودود'], ['Zubenelgenubi', 'عادي'], ['Vindemiatrix', 'لطيف'], ['Sadachbia', 'حيوي'], ['Sadaltager', 'مثقف'], ['Sulafat', 'دافئ'],
];
export const GEMINI_TTS_MODELS = [
  { id: 'gemini-2.5-flash-preview-tts', name: 'Gemini 2.5 Flash TTS (أسرع، له حصة مجانية)' },
  { id: 'gemini-2.5-pro-preview-tts', name: 'Gemini 2.5 Pro TTS (جودة أعلى)' },
];
export const GEMINI_STYLE = 'Read the following in a clear, confident Egyptian Arabic (colloquial Egyptian dialect) news-anchor voice, at a steady natural pace';
const GEM_API = 'https://generativelanguage.googleapis.com/v1beta/models/';
export const usingGemini = () => getSettings().ttsProvider === 'gemini';
// provider اختياري: 'gemini' | 'elevenlabs' (لو مش متحدد بنستخدم اللي في الإعدادات)
const isGem = p => (p || getSettings().ttsProvider) === 'gemini';

function pcmToWav(pcm, rate = 24000) {
  const n = pcm.byteLength, h = new DataView(new ArrayBuffer(44));
  const w = (o, s) => { for (let i = 0; i < s.length; i++) h.setUint8(o + i, s.charCodeAt(i)); };
  w(0, 'RIFF'); h.setUint32(4, 36 + n, true); w(8, 'WAVEfmt '); h.setUint32(16, 16, true); h.setUint16(20, 1, true); h.setUint16(22, 1, true);
  h.setUint32(24, rate, true); h.setUint32(28, rate * 2, true); h.setUint16(32, 2, true); h.setUint16(34, 16, true); w(36, 'data'); h.setUint32(40, n, true);
  const out = new Uint8Array(44 + n); out.set(new Uint8Array(h.buffer), 0); out.set(new Uint8Array(pcm), 44);
  return out.buffer;
}

async function geminiSpeak(text, voice) {
  const s = getSettings();
  if (!s.geminiKey) throw new Error('ضبط مفتاح Gemini في الإعدادات الأول (نفس مفتاح المسودات).');
  const model = s.geminiTtsModel || GEMINI_TTS_MODELS[0].id;
  const prompt = `${(s.geminiStyle || GEMINI_STYLE).trim()}: ${text}`;
  let res;
  try {
    res = await fetch(`${GEM_API}${encodeURIComponent(model)}:generateContent`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': s.geminiKey },
      body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }], generationConfig: { responseModalities: ['AUDIO'], speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: voice } } } } }),
      signal: AbortSignal.timeout(120000),
    });
  } catch { throw new Error('تعذر الاتصال بـ Gemini (النت أو المتصفح منع الطلب).'); }
  if (!res.ok) {
    let d = ''; try { d = (await res.json())?.error?.message || ''; } catch { /* ignore */ }
    if (res.status === 404) throw new Error(`موديل الصوت «${model}» مش متاح. غيّره من الإعدادات (اسمه ممكن يتغير). ${d.slice(0, 120)}`);
    if (res.status === 429) throw new Error('وصلت للحد المجاني في Gemini (طلبات في الدقيقة/اليوم). استنى شوية أو غيّر الموديل. ' + d.slice(0, 100));
    if (res.status === 400 || res.status === 403) throw new Error(`Gemini رفض الطلب (${res.status}): ${d.slice(0, 200) || 'اتأكد من المفتاح'}`);
    throw new Error(`Gemini رد بخطأ ${res.status}: ${d.slice(0, 200)}`);
  }
  const j = await res.json();
  const part = (j.candidates?.[0]?.content?.parts || []).find(p => p.inlineData?.data);
  if (!part) throw new Error('Gemini مرجّعش صوت (ممكن النص اترفض). جرّب تعدّل الجملة.');
  const rate = Number(/rate=(\d+)/.exec(part.inlineData.mimeType || '')?.[1]) || 24000;
  return pcmToWav(b64ToBuf(part.inlineData.data), rate);
}

export function prepareText(text, lang = 'ar', provider) {
  const s = getSettings();
  if (isGem(provider)) return String(text).replace(/\[[^\]]*\]/g, ' ').replace(/\s+/g, ' ').trim();
  if (s.elevenModel !== 'eleven_v3') return String(text).replace(/\[[^\]]*\]/g, ' ').replace(/\s+/g, ' ').trim();
  return (s.dialectTag && lang === 'ar' && !/^\s*\[[^\]]*accent/i.test(text) ? DIALECT_TAG + ' ' : '') + text;
}

export function voiceFor(speaker, provider) {
  const s = getSettings();
  if (isGem(provider)) return speaker === 'B' ? (s.gemVoiceB || s.gemVoiceA) : s.gemVoiceA;
  return speaker === 'B' ? (s.voiceB || s.voiceA) : s.voiceA;
}

// إعدادات الصوت للمذيع (لو صوت ب فاضي بيستخدم صوت أ فبناخد إعدادات أ)
export function voiceSettingsFor(speaker) {
  const s = getSettings();
  const useB = speaker === 'B' && s.voiceB;
  const v = (useB ? s.vsB : s.vsA) || {};
  const model = s.elevenModel;
  // Eleven v3 بياخد الثبات بس (قيم 0 / 0.5 / 1)، فبنبعته لأقرب قيمة ونسيب الباقي
  if (model === 'eleven_v3') {
    const st = v.stability ?? 0.5;
    return { stability: [0, 0.5, 1].reduce((a, b) => (Math.abs(b - st) < Math.abs(a - st) ? b : a)) };
  }
  return {
    stability: v.stability ?? 0.5,
    similarity_boost: v.similarity ?? 0.75,
    style: v.style ?? 0,
    speed: v.speed ?? 1,
    use_speaker_boost: true,
  };
}

async function call(path, init) {
  const { elevenKey, proxyUrl } = getSettings();
  // Content-Type بس مع الطلبات اللي ليها body (طلبات GET مبتحتاجوش)
  const headers = { 'xi-api-key': elevenKey, ...(init.body ? { 'Content-Type': 'application/json' } : {}), ...(init.headers || {}) };
  try {
    return await fetch(API + path, { ...init, headers });
  } catch (e) {
    if (!proxyUrl) throw new Error('المتصفح منع الاتصال بـ ElevenLabs (CORS). اضبط «رابط الوسيط» في الإعدادات.');
    return fetch(`${proxyUrl.replace(/\/+$/, '')}/?url=${encodeURIComponent(API + path)}`, { ...init, headers });
  }
}

// الـ alignment بتاع ElevenLabs بالحروف، بنجمعه لكلمات
export function wordsFromAlignment(al) {
  const ch = al.characters, st = al.character_start_times_seconds, en = al.character_end_times_seconds;
  const words = [];
  let cur = null, tag = 0;
  for (let i = 0; i < ch.length; i++) {
    // أي حاجة بين [ ] وسم صوتي مش كلام: منعرضهاش في الكابشن
    if (ch[i] === '[') { tag++; cur = null; continue; }
    if (ch[i] === ']') { tag = Math.max(0, tag - 1); cur = null; continue; }
    if (tag) continue;
    if (/\s/.test(ch[i])) { cur = null; continue; }
    if (!cur) { cur = { w: '', s: st[i], e: en[i] }; words.push(cur); }
    cur.w += ch[i];
    cur.e = en[i];
  }
  return words;
}

function b64ToBuf(b64) {
  const bin = atob(b64);
  const u = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
  return u.buffer;
}

function cacheKey(text, voiceId, vs, provider) {
  if (isGem(provider)) { const s = getSettings(); return sha1(['gemini', s.geminiTtsModel, s.geminiStyle, voiceId, text].join('|')); }
  return sha1([voiceId, getSettings().elevenModel, JSON.stringify(vs), getSettings().langCode ? 'ar' : '', text].join('|'));
}

// بيدوّر في الكاش بس (من غير أي استهلاك رصيد). بيرجع null لو السطر مش متولّد قبل كده بنفس الإعدادات
export async function peekLine(text, speaker, lang = 'ar', provider) {
  text = prepareText(text, lang, provider);
  const voiceId = voiceFor(speaker, provider);
  if (!voiceId) return null;
  const hit = await cacheGet(await cacheKey(text, voiceId, voiceSettingsFor(speaker), provider));
  return hit ? { buffer: await decode(hit.mp3), words: hit.words, cached: true, provider: isGem(provider) ? 'gemini' : 'elevenlabs' } : null;
}

// بيرجع {buffer, words, cached}
export async function speakLine(text, speaker, lang = 'ar', provider) {
  const s = getSettings();
  const gem = isGem(provider), pv = gem ? 'gemini' : 'elevenlabs';
  text = prepareText(text, lang, provider);
  const voiceId = voiceFor(speaker, provider);
  if (!gem && (!s.elevenKey || !voiceId)) throw new Error('ضبط مفتاح ElevenLabs وصوت المذيع في الإعدادات الأول.');
  const vs = voiceSettingsFor(speaker);
  const key = await cacheKey(text, voiceId, vs, provider);
  const hit = await cacheGet(key);
  if (hit) return { buffer: await decode(hit.mp3), words: hit.words, cached: true, provider: pv };
  if (gem) {
    // Gemini مبيرجّعش توقيت للكلمات: بنوزّع الكلمات على مدة الصوت بالتقدير
    const wav = await geminiSpeak(text, voiceId);
    const buffer = await decode(wav);
    const words = estimateWords(text, buffer.duration);
    await cachePut(key, { mp3: wav, words });
    return { buffer, words, cached: false, provider: pv };
  }

  const res = await call(`/v1/text-to-speech/${voiceId}/with-timestamps?output_format=mp3_44100_128`, {
    method: 'POST',
    body: JSON.stringify({ text, model_id: s.elevenModel, voice_settings: vs, ...(s.langCode ? { language_code: 'ar' } : {}) }),
  });
  if (!res.ok) throw new Error(`ElevenLabs رفض التوليد (${res.status}): ${await errDetail(res)}`);
  const j = await res.json();
  const mp3 = b64ToBuf(j.audio_base64);
  const words = wordsFromAlignment(j.alignment || j.normalized_alignment);
  addChars(text.length);
  await cachePut(key, { mp3, words });
  return { buffer: await decode(mp3), words, cached: false, provider: pv };
}

/* ---------- بيانات الحساب ---------- */
// تفاصيل الخطأ من رد ElevenLabs (detail ممكن يبقى نص أو كائن فيه message أو قايمة أخطاء تحقق)
async function errDetail(res) {
  let raw = '';
  try { raw = await res.text(); } catch { return '(مفيش تفاصيل)'; }
  try {
    const d = JSON.parse(raw)?.detail ?? JSON.parse(raw);
    if (typeof d === 'string') return d;
    if (Array.isArray(d)) return d.map(x => [(x.loc || []).join('.'), x.msg].filter(Boolean).join(': ')).join(' | ');
    if (d?.message) return d.status ? `${d.status} — ${d.message}` : d.message;
    return JSON.stringify(d).slice(0, 300);
  } catch { return raw.slice(0, 300) || '(مفيش تفاصيل)'; }
}

async function getJson(path) {
  const res = await call(path, { method: 'GET' });
  if (res.status === 401 || res.status === 403) throw new Error(`المفتاح مرفوض أو ناقصه صلاحية (${res.status}): ${await errDetail(res)}`);
  if (!res.ok) throw new Error(`ElevenLabs رد بخطأ ${res.status} على ${path.split('?')[0]}: ${await errDetail(res)}`);
  return res.json();
}

// الرصيد: {used, limit, resetAt, tier}
export async function fetchSubscription() {
  const j = await getJson('/v1/user/subscription');
  const sub = { used: j.character_count, limit: j.character_limit, resetAt: j.next_character_count_reset_unix ? j.next_character_count_reset_unix * 1000 : null, tier: j.tier, at: Date.now() };
  save('sub', sub);
  return sub;
}

export function lastSubscription() { return load('sub', null); }

// أصوات الحساب (بما فيها المستنسخ): [{id, name, category, preview, labels}]
export async function fetchVoices() {
  const map = v => ({ id: v.voice_id, name: v.name, category: v.category, preview: v.preview_url, labels: v.labels || {} });
  try {
    // الواجهة الأحدث (صفحات)، ولو فشلت بنرجع للقديمة
    const all = [];
    let token = '';
    for (let page = 0; page < 5; page++) {
      const j = await getJson(`/v2/voices?page_size=100${token ? '&next_page_token=' + encodeURIComponent(token) : ''}`);
      all.push(...(j.voices || []));
      if (!j.has_more || !j.next_page_token) break;
      token = j.next_page_token;
    }
    if (all.length) return all.map(map);
  } catch (e) {
    if (/المفتاح مرفوض/.test(e.message)) throw e;
  }
  const j = await getJson('/v1/voices');
  return (j.voices || []).map(map);
}
