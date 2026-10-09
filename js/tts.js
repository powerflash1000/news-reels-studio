// توليد الصوت من ElevenLabs مع توقيت كل كلمة، وكاش لكل سطر
import { getSettings, addChars, cacheGet, cachePut, sha1, load, save } from './storage.js?v=mv13n2xh';
import { decode } from './audio.js?v=mv13n2xh';

const API = 'https://api.elevenlabs.io';

export const MODELS = [
  { id: 'eleven_multilingual_v2', name: 'Multilingual v2 (ثابت ومجرّب مع العربي)' },
  { id: 'eleven_v3', name: 'Eleven v3 (أحدث وأكثر تعبيرًا)' },
];

export function voiceFor(speaker) {
  const s = getSettings();
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
  let cur = null;
  for (let i = 0; i < ch.length; i++) {
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

function cacheKey(text, voiceId, vs) {
  return sha1([voiceId, getSettings().elevenModel, JSON.stringify(vs), text].join('|'));
}

// بيدوّر في الكاش بس (من غير أي استهلاك رصيد). بيرجع null لو السطر مش متولّد قبل كده بنفس الإعدادات
export async function peekLine(text, speaker) {
  const voiceId = voiceFor(speaker);
  if (!voiceId) return null;
  const hit = await cacheGet(await cacheKey(text, voiceId, voiceSettingsFor(speaker)));
  return hit ? { buffer: await decode(hit.mp3), words: hit.words, cached: true } : null;
}

// بيرجع {buffer, words, cached}
export async function speakLine(text, speaker) {
  const s = getSettings();
  const voiceId = voiceFor(speaker);
  if (!s.elevenKey || !voiceId) throw new Error('ضبط مفتاح ElevenLabs وصوت المذيع في الإعدادات الأول.');
  const vs = voiceSettingsFor(speaker);
  const key = await cacheKey(text, voiceId, vs);
  const hit = await cacheGet(key);
  if (hit) return { buffer: await decode(hit.mp3), words: hit.words, cached: true };

  const res = await call(`/v1/text-to-speech/${voiceId}/with-timestamps?output_format=mp3_44100_128`, {
    method: 'POST',
    body: JSON.stringify({ text, model_id: s.elevenModel, voice_settings: vs }),
  });
  if (!res.ok) throw new Error(`ElevenLabs رفض التوليد (${res.status}): ${await errDetail(res)}`);
  const j = await res.json();
  const mp3 = b64ToBuf(j.audio_base64);
  const words = wordsFromAlignment(j.alignment || j.normalized_alignment);
  addChars(text.length);
  await cachePut(key, { mp3, words });
  return { buffer: await decode(mp3), words, cached: false };
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
