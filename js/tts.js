// توليد الصوت من ElevenLabs مع توقيت كل كلمة، وكاش لكل سطر
import { getSettings, addChars, cacheGet, cachePut, sha1 } from './storage.js';
import { decode } from './audio.js';

const API = 'https://api.elevenlabs.io';

export const MODELS = [
  { id: 'eleven_multilingual_v2', name: 'Multilingual v2 (ثابت ومجرّب مع العربي)' },
  { id: 'eleven_v3', name: 'Eleven v3 (أحدث وأكثر تعبيرًا)' },
];

export function voiceFor(speaker) {
  const s = getSettings();
  return speaker === 'B' ? (s.voiceB || s.voiceA) : s.voiceA;
}

async function call(path, init) {
  const { elevenKey, proxyUrl } = getSettings();
  const headers = { 'xi-api-key': elevenKey, 'Content-Type': 'application/json', ...(init.headers || {}) };
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

// بيرجع {buffer, words, cached}
export async function speakLine(text, voiceId) {
  const s = getSettings();
  if (!s.elevenKey || !voiceId) throw new Error('ضبط مفتاح ElevenLabs ورقم الصوت في الإعدادات الأول.');
  const key = await sha1([voiceId, s.elevenModel, text].join('|'));
  const hit = await cacheGet(key);
  if (hit) return { buffer: await decode(hit.mp3), words: hit.words, cached: true };

  const res = await call(`/v1/text-to-speech/${voiceId}/with-timestamps?output_format=mp3_44100_128`, {
    method: 'POST',
    body: JSON.stringify({ text, model_id: s.elevenModel }),
  });
  if (!res.ok) {
    let msg = '';
    try { msg = (await res.json())?.detail?.message || ''; } catch { /* مفيش تفاصيل */ }
    throw new Error(`ElevenLabs رفض الطلب (${res.status}) ${msg}`);
  }
  const j = await res.json();
  const mp3 = b64ToBuf(j.audio_base64);
  const words = wordsFromAlignment(j.alignment || j.normalized_alignment);
  addChars(text.length);
  await cachePut(key, { mp3, words });
  return { buffer: await decode(mp3), words, cached: false };
}
