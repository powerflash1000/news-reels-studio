// توليد الصوت من ElevenLabs مع توقيت كل كلمة، وكاش لكل سطر
import { getSettings, addChars, cacheGet, cachePut, sha1, load, save, takePut } from './storage.js?v=mw0vkk0f';
import { decode } from './audio.js?v=mw0vkk0f';
import { estimateWords, stripTags } from './reel.js?v=mw0vkk0f';

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
export const GEMINI_FEMALE = new Set(['Zephyr', 'Kore', 'Leda', 'Aoede', 'Callirrhoe', 'Autonoe', 'Despina', 'Erinome', 'Laomedeia', 'Achernar', 'Gacrux', 'Pulcherrima', 'Vindemiatrix', 'Sulafat']);
export const GEMINI_TTS_MODELS = [
  { id: 'gemini-2.5-flash-preview-tts', name: 'Gemini 2.5 Flash TTS (أسرع، له حصة مجانية)' },
  { id: 'gemini-2.5-pro-preview-tts', name: 'Gemini 2.5 Pro TTS (جودة أعلى)' },
];
export const GEMINI_STYLE = 'Read the following in a clear, confident Egyptian Arabic (colloquial Egyptian dialect) news-anchor voice, at a steady natural pace';
const GEM_API = 'https://generativelanguage.googleapis.com/v1beta/models/';
export const usingGemini = () => getSettings().ttsProvider === 'gemini';
// provider اختياري: 'gemini' | 'elevenlabs' | 'azure' | 'openai' (لو مش متحدد بنستخدم اللي في الإعدادات)
export const TTS_PROVIDERS = ['elevenlabs', 'gemini', 'azure', 'openai'];
export const TTS_NAMES = { elevenlabs: 'ElevenLabs', gemini: 'Gemini', azure: 'Azure', openai: 'OpenAI' };
export const pvOf = p => { const x = p || getSettings().ttsProvider; return TTS_PROVIDERS.includes(x) ? x : 'elevenlabs'; };
const isGem = p => pvOf(p) === 'gemini';
// المزوّدين اللي بيرجّعوا ملف صوت من غير توقيت كلمات (الكابشن بيتقدّر، و«🎯 ظبط التوقيت» بيظبطه)
export const estimatedTiming = p => p === 'gemini' || p === 'azure' || p === 'openai';

/* ---------- Microsoft Azure Speech (فيه أصوات مصري، 500 ألف حرف ببلاش في الشهر) ---------- */
// [id, وصف, نوع]
export const AZURE_VOICES = [
  ['ar-EG-ShakirNeural', 'مصري — شاكر', 'm'], ['ar-EG-SalmaNeural', 'مصري — سلمى', 'f'],
  ['ar-SA-HamedNeural', 'سعودي — حامد', 'm'], ['ar-SA-ZariyahNeural', 'سعودي — زارية', 'f'],
  ['ar-AE-HamdanNeural', 'إماراتي — حمدان', 'm'], ['ar-AE-FatimaNeural', 'إماراتي — فاطمة', 'f'],
  ['ar-JO-TaimNeural', 'أردني — تيم', 'm'], ['ar-LB-RamiNeural', 'لبناني — رامي', 'm'], ['ar-MA-JamalNeural', 'مغربي — جمال', 'm'],
  ['en-US-AndrewMultilingualNeural', 'متعدد اللغات (أحدث، بيقرا عربي) — أندرو', 'm'], ['en-US-AvaMultilingualNeural', 'متعدد اللغات (أحدث، بيقرا عربي) — آفا', 'f'],
  ['en-US-BrianMultilingualNeural', 'متعدد اللغات (أحدث، بيقرا عربي) — براين', 'm'], ['en-US-EmmaMultilingualNeural', 'متعدد اللغات (أحدث، بيقرا عربي) — إيما', 'f'],
  ['fr-FR-RemyMultilingualNeural', 'متعدد اللغات (أحدث، بيقرا عربي) — ريمي', 'm'], ['de-DE-SeraphinaMultilingualNeural', 'متعدد اللغات (أحدث، بيقرا عربي) — سيرافينا', 'f'],
  ['en-US-GuyNeural', 'English — Guy', 'm'], ['en-US-JennyNeural', 'English — Jenny', 'f'], ['en-GB-RyanNeural', 'English UK — Ryan', 'm'], ['en-GB-SoniaNeural', 'English UK — Sonia', 'f'],
];
// المنطقة زي ما Azure بيكتبها: «Sweden Central» أو «(Europe) Sweden Central» أو رابط الـ Endpoint → swedencentral
export function azRegion(r) {
  let x = String(r || '').trim().toLowerCase();
  const m = x.match(/https?:\/\/([a-z0-9-]+)\.(?:api\.cognitive\.microsoft\.com|tts\.speech\.microsoft\.com|stt\.speech\.microsoft\.com)/);
  if (m) return m[1];
  return x.replace(/\([^)]*\)/g, '').replace(/[^a-z0-9]/g, '');
}
// طلب Azure: مباشرة، ولو المتصفح منعه (CORS) عن طريق وسيط Cloudflare بتاعك لو متظبط
async function azFetch(url, init) {
  try { return await fetch(url, init); }
  catch (e) {
    const { proxyUrl } = getSettings();
    if (proxyUrl) {
      const r = await fetch(`${proxyUrl.replace(/\/+$/, '')}/?url=${encodeURIComponent(url)}`, { ...init, signal: AbortSignal.timeout(60000) }).catch(() => null);
      if (r && r.status !== 403) return r;
      if (r?.status === 403) throw new Error('الوسيط رفض عنوان Azure: حدّث كود الوسيط على Cloudflare من tools/cors-proxy-worker.js (فيه speech.microsoft.com دلوقتي) واعمل Deploy.');
    }
    const host = new URL(url).hostname;
    throw new Error(`Azure مردّش على ${host}. اتأكد إن المنطقة مكتوبة زي ما هي في «Keys and Endpoint» ← Location/Region (مثلًا swedencentral). لو صح، يبقى المتصفح منع الاتصال: ظبط «رابط الوسيط» في الإعدادات (وسيط Cloudflare، الشرح في README). (${e.message || e})`);
  }
}
const xmlEsc = t => String(t).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
async function azureSpeak(text, voice, lang) {
  const s = getSettings();
  if (/cognitiveservices\.azure\.com/i.test(s.azureRegion || '')) throw new Error('اللي في خانة المنطقة ده رابط الـ Endpoint. حط بداله Location/Region (كلمة زي swedencentral)، موجودة في نفس صفحة «Keys and Endpoint».');
  const region = azRegion(s.azureRegion);
  if (!s.azureKey || !region) throw new Error('محتاج مفتاح Azure Speech والمنطقة (Region): الإعدادات ← مزوّد الصوت ← Azure.');
  // ريل إنجليزي بصوت عربي = لكنة: بنحوّله لصوت إنجليزي متعدد اللغات من نفس النوع
  if (lang === 'en' && /^ar-/.test(voice)) voice = AZURE_VOICES.find(v => v[0] === voice)?.[2] === 'f' ? 'en-US-AvaMultilingualNeural' : 'en-US-AndrewMultilingualNeural';
  const loc = voice.split('-').slice(0, 2).join('-');
  const rate = Number(s.azRate) || 0;
  // الأصوات متعددة اللغات: بنقولها صراحة إن النص عربي مصري (من غير كده بتقراه بلكنة إنجليزي)
  const multi = /Multilingual/i.test(voice) && lang !== 'en';
  const inner = `${rate ? `<prosody rate="${rate > 0 ? '+' : ''}${rate}%">` : ''}${xmlEsc(text)}${rate ? '</prosody>' : ''}`;
  const body = `<speak version="1.0" xmlns="http://www.w3.org/2001/10/synthesis" xml:lang="${loc}"><voice name="${xmlEsc(voice)}">${multi ? `<lang xml:lang="ar-EG">${inner}</lang>` : inner}</voice></speak>`;
  const res = await azFetch(`https://${region}.tts.speech.microsoft.com/cognitiveservices/v1`, {
    method: 'POST', signal: AbortSignal.timeout(60000),
    headers: { 'Ocp-Apim-Subscription-Key': s.azureKey.trim(), 'Content-Type': 'application/ssml+xml', 'X-Microsoft-OutputFormat': 'audio-24khz-96kbitrate-mono-mp3' },
    body,
  });
  if (!res.ok) {
    if (res.status === 400 && /Multilingual/i.test(voice)) { const e = new Error('Azure: الصوت متعدد اللغات ده مقبلش العربي في المنطقة دي. جرّب أندرو أو آفا، أو صوت مصري.'); e.status = 400; throw e; }
    const why = res.status === 401 ? `المفتاح غلط أو مش لنفس المنطقة (جرّبت «${region}»: لازم تبقى نفس Location/Region اللي جنب المفتاح في Azure)` : res.status === 429 ? 'وصلت لحد الطلبات أو الحد المجاني للشهر (الخطة المجانية F0 = 500 ألف حرف)' : res.status === 400 ? 'اسم الصوت مش موجود في المنطقة دي' : (await res.text().catch(() => '')).slice(0, 160);
    const e = new Error(`Azure رفض التوليد (${res.status}): ${why}`); e.status = res.status; throw e;
  }
  return await res.arrayBuffer();
}
export async function azureVoicesList() {
  const s = getSettings();
  const res = await azFetch(`https://${azRegion(s.azureRegion)}.tts.speech.microsoft.com/cognitiveservices/voices/list`, { headers: { 'Ocp-Apim-Subscription-Key': s.azureKey.trim() } });
  if (!res.ok) throw new Error(`Azure (${res.status}): ${res.status === 401 ? 'المفتاح غلط أو المنطقة غلط' : 'مقدرتش أجيب الأصوات'}`);
  return (await res.json()).filter(v => /^(ar|en)-/.test(v.Locale)).map(v => [v.ShortName, `${v.LocaleName || v.Locale} — ${v.DisplayName}`, v.Gender === 'Female' ? 'f' : 'm']);
}

/* ---------- OpenAI TTS (مفتاح OpenAI بتاع الإعدادات، بيتحاسب بالاستخدام) ---------- */
export const OPENAI_VOICES = [
  ['onyx', 'عميق', 'm'], ['ash', 'هادي', 'm'], ['echo', 'دافي', 'm'], ['verse', 'معبّر', 'm'], ['ballad', 'ناعم', 'm'], ['cedar', 'طبيعي', 'm'],
  ['coral', 'ودود', 'f'], ['nova', 'حيوي', 'f'], ['shimmer', 'صافي', 'f'], ['sage', 'رزين', 'f'], ['marin', 'طبيعي', 'f'], ['alloy', 'محايد', 'f'], ['fable', 'حكّاء', 'm'],
];
export const OPENAI_TTS_MODELS = [{ id: 'gpt-4o-mini-tts', name: 'gpt-4o-mini-tts (بيفهم أسلوب الإلقاء)' }, { id: 'tts-1-hd', name: 'tts-1-hd (جودة أعلى، من غير أسلوب)' }, { id: 'tts-1', name: 'tts-1 (أرخص)' }];
export const OPENAI_STYLE = 'Speak in colloquial Egyptian Arabic (Cairene accent), like a clear, confident news presenter, at a steady natural pace.';
async function openaiSpeak(text, voice, lang) {
  const s = getSettings();
  if (!s.openaiKey) throw new Error('محتاج مفتاح OpenAI: الإعدادات ← مزوّد الصوت ← OpenAI (من platform.openai.com/api-keys).');
  const model = s.oaTtsModel || OPENAI_TTS_MODELS[0].id;
  const { say, dirs } = gemDirections(text);
  const style = (s.oaStyle || '').trim() || (lang === 'en' ? 'Speak like a clear, confident news presenter, at a steady natural pace.' : OPENAI_STYLE);
  const body = { model, voice, input: say, response_format: 'mp3' };
  if (/gpt-4o/.test(model)) body.instructions = style + (dirs.length ? ` Deliver this line ${dirs.join(', ')}.` : '');
  const res = await fetch('https://api.openai.com/v1/audio/speech', {
    method: 'POST', signal: AbortSignal.timeout(90000),
    headers: { Authorization: `Bearer ${s.openaiKey.trim()}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }).catch(e => { throw new Error('OpenAI مردّش: ' + (e.message || e)); });
  if (!res.ok) {
    let msg = ''; try { msg = (await res.json()).error?.message || ''; } catch { /* مش JSON */ }
    const why = res.status === 401 ? 'المفتاح غلط' : res.status === 429 ? 'الرصيد خلص أو وصلت لحد الطلبات (اشحن رصيد من platform.openai.com/settings/organization/billing)' : msg.slice(0, 160);
    const e = new Error(`OpenAI رفض التوليد (${res.status}): ${why}`); e.status = res.status; throw e;
  }
  return await res.arrayBuffer();
}

function pcmToWav(pcm, rate = 24000) {
  const n = pcm.byteLength, h = new DataView(new ArrayBuffer(44));
  const w = (o, s) => { for (let i = 0; i < s.length; i++) h.setUint8(o + i, s.charCodeAt(i)); };
  w(0, 'RIFF'); h.setUint32(4, 36 + n, true); w(8, 'WAVEfmt '); h.setUint32(16, 16, true); h.setUint16(20, 1, true); h.setUint16(22, 1, true);
  h.setUint32(24, rate, true); h.setUint32(28, rate * 2, true); h.setUint16(32, 2, true); h.setUint16(34, 16, true); w(36, 'data'); h.setUint32(40, n, true);
  const out = new Uint8Array(44 + n); out.set(new Uint8Array(h.buffer), 0); out.set(new Uint8Array(pcm), 44);
  return out.buffer;
}

// وسوم الأداء ([sad] [whispers] …) → توجيه بالإنجليزي لـ Gemini، والنص اللي يتقري من غيرها ([pause] = وقفة …)
const GEM_DIR = {
  happily: 'happily', sad: 'in a sad tone', angry: 'angrily', excited: 'excitedly', nervous: 'nervously', calm: 'calmly',
  whispers: 'in a soft whisper', shouts: 'shouting', slowly: 'slowly', 'speaking quickly': 'quickly', laughs: 'with a short laugh',
  sighs: 'with a sigh', 'clears throat': 'after clearing the throat', 'breathing heavily': 'breathing heavily', gasping: 'gasping',
};
export function gemDirections(text) {
  const dirs = [];
  const say = String(text).replace(/\[([^\]]*)\]/g, (m, t) => {
    const k = t.trim().toLowerCase();
    if (/^(short |long )?pause$/.test(k)) return ' … ';
    if (/accent/.test(k)) return ' ';
    const d = GEM_DIR[k] || (k && k.length < 40 ? `in a ${k} manner` : '');
    if (d && !dirs.includes(d)) dirs.push(d);
    return ' ';
  }).replace(/\s+/g, ' ').trim();
  return { say, dirs };
}

// كل موديل صوت في Gemini ليه حصة يومية لوحده: لو الأول قال «وصلت للحد» بنجرّب اللي بعده
// الخطة المجانية: حوالي 3 طلبات في الدقيقة و15 في اليوم لكل موديل صوت (اليوم بيتجدد 12 بالليل بتوقيت كاليفورنيا ≈ 10 الصبح القاهرة)
export const GEM_FREE_RPD = 15;
const pacificDay = () => new Date().toLocaleDateString('en-CA', { timeZone: 'America/Los_Angeles' });
export function gemUsage() { const u = load('gemUse', null); return u && u.day === pacificDay() ? u : { day: pacificDay(), n: {} }; }
function gemCount(model) { const u = gemUsage(); u.n[model] = (u.n[model] || 0) + 1; save('gemUse', u); }
const sleep = ms => new Promise(r => setTimeout(r, ms));
async function geminiSpeak(text, voice, extra = '') {
  const s = getSettings();
  const first = s.geminiTtsModel || GEMINI_TTS_MODELS[0].id;
  const models = [first, ...GEMINI_TTS_MODELS.map(m => m.id).filter(id => id !== first)];
  let last;
  for (const model of models) {
    for (let tries = 0; tries < 4; tries++) {
      try { const out = await geminiSpeakWith(model, text, voice, extra); gemCount(model); return out; }
      catch (e) {
        last = e;
        if (e.status !== 429) throw e;
        if (e.perDay) break; // حصة اليوم للموديل ده خلصت → الموديل اللي بعده
        // حد الدقيقة: بنستنى المدة اللي Gemini قالها ونكمّل لوحدنا
        const wait = Math.min(65, Math.max(8, e.retry || 22));
        try { dispatchEvent(new CustomEvent('nrs:tts-wait', { detail: { provider: 'gemini', seconds: wait } })); } catch { /* مش في متصفح */ }
        await sleep(wait * 1000);
      }
    }
  }
  const used = Object.values(gemUsage().n).reduce((a, b) => a + b, 0);
  if (last?.free) {
    const e = new Error(`المفتاح اللي في البرنامج تبع مشروع مجاني (Free tier)، فحصته ${GEM_FREE_RPD} طلب في اليوم حتى لو دفعت في مشروع تاني. الدفع بيتحسب لكل مشروع لوحده: افتح aistudio.google.com/apikey، وانسخ المفتاح اللي جنبه «Paid tier / Tier 1» (مشروعك المدفوع)، وحطه في الإعدادات ← مفتاح Gemini ← حفظ.`);
    e.status = 429; e.cause = last; throw e;
  }
  const e = new Error(`خلصت حصة Gemini المجانية للنهارده (حوالي ${GEM_FREE_RPD} طلب في اليوم لكل موديل صوت، واستخدمت ${used} من الجهاز ده). بتتجدد حوالي الساعة 10 الصبح بتوقيت القاهرة. كمّل بـ OpenAI أو ElevenLabs أو Azure دلوقتي.`);
  e.status = 429; e.cause = last;
  throw e;
}
async function geminiSpeakWith(model, text, voice, extra) {
  const s = getSettings();
  // voice ممكن يبقى {A: 'Kore', B: 'Puck'} = حوار بصوتين في طلب واحد (Gemini بيدعم متحدثين اتنين)
  const speech = typeof voice === 'object' && voice
    ? { multiSpeakerVoiceConfig: { speakerVoiceConfigs: Object.entries(voice).map(([speaker, v]) => ({ speaker, voiceConfig: { prebuiltVoiceConfig: { voiceName: v } } })) } }
    : { voiceConfig: { prebuiltVoiceConfig: { voiceName: voice } } };
  if (!s.geminiKey) throw new Error('ضبط مفتاح Gemini في الإعدادات الأول (نفس مفتاح المسودات).');
  const { say, dirs } = gemDirections(text);
  const prompt = `${(s.geminiStyle || GEMINI_STYLE).trim()}${extra}${dirs.length ? `, and deliver this line ${dirs.join(', ')}` : ''}: ${say}`;
  let res;
  try {
    res = await fetch(`${GEM_API}${encodeURIComponent(model)}:generateContent`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': s.geminiKey },
      body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }], generationConfig: { responseModalities: ['AUDIO'], speechConfig: speech } }),
      signal: AbortSignal.timeout(120000),
    });
  } catch { throw new Error('تعذر الاتصال بـ Gemini (النت أو المتصفح منع الطلب).'); }
  if (!res.ok) {
    let d = '', err = null; try { err = (await res.json())?.error; d = err?.message || ''; } catch { /* ignore */ }
    if (res.status === 429) {
      const det = err?.details || [];
      const ids = det.flatMap(x => (x.violations || []).map(v => v.quotaId || v.quotaMetric || '')).join(' ');
      const retry = Number(/([\d.]+)s/.exec(det.find(x => x.retryDelay)?.retryDelay || '')?.[1]) || Number(/retry in ([\d.]+)s/i.exec(d)?.[1]) || 0;
      const e = new Error('Gemini: وصلت للحد. ' + d.slice(0, 100)); e.status = 429;
      e.perDay = /PerDay/i.test(ids) || (!/PerMinute/i.test(ids) && /per day|daily/i.test(d));
      e.free = /free.?tier/i.test(ids + ' ' + d); // Google بيقول صراحة لو المفتاح على الخطة المجانية
      e.retry = retry;
      throw e;
    }
    if (res.status === 404) throw new Error(`موديل الصوت «${model}» مش متاح. غيّره من الإعدادات (اسمه ممكن يتغير). ${d.slice(0, 120)}`);
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
  // Gemini: الوسوم بتفضل وبتتحول لتوجيه أداء جوه geminiSpeak (مش بتتقري)
  const pv = pvOf(provider);
  if (pv === 'gemini' || pv === 'openai') return String(text).replace(/\s+/g, ' ').trim();
  if (pv === 'azure') return String(text).replace(/\[[^\]]*\]/g, ' ').replace(/\s+/g, ' ').trim();
  if (s.elevenModel !== 'eleven_v3') return String(text).replace(/\[[^\]]*\]/g, ' ').replace(/\s+/g, ' ').trim();
  return (s.dialectTag && lang === 'ar' && !/^\s*\[[^\]]*accent/i.test(text) ? DIALECT_TAG + ' ' : '') + text;
}

export function voiceFor(speaker, provider) {
  const s = getSettings();
  const pv = pvOf(provider);
  if (pv === 'gemini') return speaker === 'B' ? (s.gemVoiceB || s.gemVoiceA) : s.gemVoiceA;
  if (pv === 'azure') return speaker === 'B' ? (s.azVoiceB || 'ar-EG-SalmaNeural') : (s.azVoiceA || 'ar-EG-ShakirNeural');
  if (pv === 'openai') return speaker === 'B' ? (s.oaVoiceB || 'coral') : (s.oaVoiceA || 'onyx');
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
  const headers = { 'xi-api-key': elevenKey, ...(typeof init.body === 'string' ? { 'Content-Type': 'application/json' } : {}), ...(init.headers || {}) };
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
  const pv = pvOf(provider), s = getSettings();
  if (pv === 'gemini') return sha1(['gemini', s.geminiTtsModel, s.geminiStyle, voiceId, text].join('|'));
  if (pv === 'azure') return sha1(['azure', voiceId, Number(s.azRate) || 0, text].join('|'));
  if (pv === 'openai') return sha1(['openai', s.oaTtsModel || OPENAI_TTS_MODELS[0].id, s.oaStyle || '', voiceId, text].join('|'));
  return sha1([voiceId, getSettings().elevenModel, JSON.stringify(vs), getSettings().langCode ? 'ar' : '', text].join('|'));
}

// بيدوّر في الكاش بس (من غير أي استهلاك رصيد). بيرجع null لو السطر مش متولّد قبل كده بنفس الإعدادات
export async function peekLine(text, speaker, lang = 'ar', provider, voice) {
  text = prepareText(text, lang, provider);
  const voiceId = voice || voiceFor(speaker, provider);
  if (!voiceId) return null;
  const hit = await cacheGet(await cacheKey(text, voiceId, voiceSettingsFor(speaker), provider));
  return hit ? { buffer: await decode(hit.mp3), words: hit.words, cached: true, aligned: !!hit.aligned, provider: pvOf(provider) } : null;
}

// حفظ توقيت كلمات متظبط (Whisper) على السطر المتخزّن، عشان ميتعملش تاني ويرجع مع فتح الريل
export async function saveWords(text, speaker, lang = 'ar', provider, words) {
  text = prepareText(text, lang, provider);
  const voiceId = voiceFor(speaker, provider);
  if (!voiceId) return false;
  const key = await cacheKey(text, voiceId, voiceSettingsFor(speaker), provider);
  const hit = await cacheGet(key);
  if (!hit) return false;
  await cachePut(key, { ...hit, words, aligned: true });
  return true;
}

// بيرجع {buffer, words, cached}
export async function speakLine(text, speaker, lang = 'ar', provider, opts = {}) {
  const s = getSettings();
  const pv = pvOf(provider), gem = pv === 'gemini', other = pv === 'azure' || pv === 'openai';
  text = prepareText(text, lang, provider);
  const voiceId = opts.voice || voiceFor(speaker, provider);
  if (pv === 'elevenlabs' && (!s.elevenKey || !voiceId)) throw new Error('ضبط مفتاح ElevenLabs وصوت المذيع في الإعدادات الأول.');
  const vs = voiceSettingsFor(speaker);
  const key = await cacheKey(text, voiceId, vs, provider);
  // opts.fresh = نسخة جديدة (من غير الكاش) — النسخة القديمة بتفضل في مكتبة الأصوات
  const hit = opts.fresh ? null : await cacheGet(key);
  if (hit) return { buffer: await decode(hit.mp3), words: hit.words, cached: true, aligned: !!hit.aligned, provider: pv };
  const take = (mp3, words) => takePut({ text, speaker, provider: pv, voiceId, voiceName: opts.voiceName || (pv !== 'elevenlabs' ? voiceId : (speaker === 'B' && s.voiceB ? s.voiceNameB : s.voiceNameA) || voiceId), model: gem ? s.geminiTtsModel : pv === 'openai' ? (s.oaTtsModel || OPENAI_TTS_MODELS[0].id) : pv === 'azure' ? 'azure-neural' : s.elevenModel, at: Date.now(), mp3, words });
  if (other) {
    const mp3 = pv === 'azure' ? await azureSpeak(text, voiceId, lang) : await openaiSpeak(text, voiceId, lang);
    const buffer = await decode(mp3.slice(0));
    const words = estimateWords(pv === 'openai' ? gemDirections(text).say : text, buffer.duration);
    await cachePut(key, { mp3, words });
    take(mp3, words);
    return { buffer, words, cached: false, provider: pv };
  }
  if (gem) {
    // Gemini مبيرجّعش توقيت للكلمات: بنوزّع الكلمات على مدة الصوت بالتقدير
    const wav = await geminiSpeak(text, voiceId);
    const buffer = await decode(wav);
    const words = estimateWords(text, buffer.duration);
    await cachePut(key, { mp3: wav, words });
    take(wav, words);
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
  take(mp3, words);
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

// استخدام نسخة من مكتبة الأصوات لسطر في الريل: بتتحط في الكاش بمفتاح السطر ده، فبترجع لوحدها لما تفتح الريل
export async function adoptTake(take, lineText, speaker, lang = 'ar', voice) {
  const provider = take.provider;
  const text = prepareText(lineText, lang, provider);
  const voiceId = voice || voiceFor(speaker, provider);
  const buffer = await decode(take.mp3.slice(0));
  const words = take.text === text ? take.words : estimateWords(stripTags(lineText), buffer.duration);
  if (voiceId) await cachePut(await cacheKey(text, voiceId, voiceSettingsFor(speaker), provider), { mp3: take.mp3, words });
  return { buffer, words, cached: true, provider };
}

// ✨ ElevenLabs Voice Isolator: بيشيل الدوشة والصدى ويسيب الصوت بس (بيخصم من رصيد ElevenLabs، تقريبًا 1000 حرف للدقيقة)
export async function isolateVoice(wav) {
  if (!getSettings().elevenKey) throw new Error('محتاج مفتاح ElevenLabs في الإعدادات.');
  const fd = new FormData();
  fd.append('audio', wav, 'voice.wav');
  const res = await call('/v1/audio-isolation', { method: 'POST', body: fd });
  if (!res.ok) throw new Error(`ElevenLabs رفض التنضيف (${res.status}): ${await errDetail(res)}`);
  return decode(await res.arrayBuffer());
}

// 📦 Gemini: كذا جملة (نفس المذيع ونفس الصوت) في طلب واحد بدل طلب لكل جملة، وبعدين بنقسم الصوت على أطول السكتات.
// بيرجّع نتايج زي speakLine لكل جملة، أو null لو التقسيم مش مضمون (والمتصل يرجع يولّد جملة جملة)
export async function speakGroupGemini(items, lang = 'ar', voice) {
  if (items.length < 2) return null;
  const texts = items.map(it => prepareText(it.text, lang, 'gemini'));
  if (texts.some(t => /\[/.test(t))) return null; // الجمل اللي فيها توجيه أداء بتتولّد لوحدها
  const two = !voice && new Set(items.map(it => it.speaker)).size > 1 && voiceFor('A', 'gemini') !== voiceFor('B', 'gemini');
  const ids = items.map(it => voice || voiceFor(it.speaker, 'gemini'));
  let wav;
  if (two) {
    // حوار: «Host:» و«Guest:» قبل كل جملة، وكل واحد بصوته
    const name = sp => (sp === 'B' ? 'Guest' : 'Host');
    wav = await geminiSpeak(items.map((it, i) => `${name(it.speaker)}: ${texts[i]}`).join('\n'), { Host: voiceFor('A', 'gemini'), Guest: voiceFor('B', 'gemini') },
      '. This is a conversation between Host and Guest: read each turn in order, never read the names aloud, and leave about one second of silence between turns');
  } else {
    wav = await geminiSpeak(texts.join('\n\n'), ids[0], '. The text has several separate sentences: read them in order and pause clearly (about one second of silence) between sentences');
  }
  const buf = await decode(wav);
  // القطع على السكتات، ولو السكتات مش واضحة بنقطع بنسبة طول كل جملة على أقرب سكتة (من غير ما نعيد التوليد ونصرف حصة)
  const cuts = splitByPauses(buf, texts.map(t => t.length)) || splitSnap(buf, texts.map(t => t.length));
  const out = [];
  for (let i = 0; i < items.length; i++) {
    const voiceId = ids[i];
    const piece = sliceWav(buf, cuts[i], cuts[i + 1]);
    const b = await decode(piece);
    const words = estimateWords(texts[i], b.duration);
    const key = await cacheKey(texts[i], voiceId, voiceSettingsFor(items[i].speaker), 'gemini');
    await cachePut(key, { mp3: piece, words });
    takePut({ text: texts[i], speaker: items[i].speaker, provider: 'gemini', voiceId, voiceName: voiceId, model: getSettings().geminiTtsModel, at: Date.now(), mp3: piece, words });
    out.push({ buffer: b, words, cached: false, provider: 'gemini' });
  }
  return out;
}
// نقط القطع (بالعينات): بداية الصوت، منتصف أطول n-1 سكتة، النهاية. بنتأكد إن كل حتة طولها مناسب لطول جملتها
function splitByPauses(buf, lens) {
  const x = buf.getChannelData(0), fs = buf.sampleRate, win = Math.round(fs * 0.01), frames = Math.floor(x.length / win);
  const lv = new Float32Array(frames);
  for (let f = 0; f < frames; f++) { let q = 0; for (let i = f * win; i < (f + 1) * win; i++) q += x[i] * x[i]; lv[f] = Math.sqrt(q / win); }
  const sorted = [...lv].sort((a, b) => a - b), thr = Math.max(0.006, (sorted[Math.floor(frames * 0.15)] || 0) * 3);
  const gaps = [];
  for (let f = 0; f < frames;) {
    if (lv[f] >= thr) { f++; continue; }
    let g = f; while (g < frames && lv[g] < thr) g++;
    if (f > 0 && g < frames && g - f >= 25) gaps.push({ len: g - f, mid: Math.round((f + g) / 2) * win });
    f = g;
  }
  const need = lens.length - 1;
  if (gaps.length < need) return null;
  const pick = gaps.sort((a, b) => b.len - a.len).slice(0, need).map(g => g.mid).sort((a, b) => a - b);
  const cuts = [0, ...pick, x.length];
  const total = lens.reduce((a, b) => a + b, 0);
  for (let i = 0; i < lens.length; i++) {
    const share = (cuts[i + 1] - cuts[i]) / x.length, want = lens[i] / total;
    if (share < want * 0.4 || share > want * 2.5) return null;
  }
  return cuts;
}
// قطع احتياطي: مكان كل نهاية جملة بالنسبة لطول النص، متزحزح لأقرب سكتة قصيرة (≥120 ms) لو فيه واحدة قريبة
function splitSnap(buf, lens) {
  const x = buf.getChannelData(0), fs = buf.sampleRate, win = Math.round(fs * 0.01), frames = Math.floor(x.length / win);
  const lv = new Float32Array(frames);
  for (let f = 0; f < frames; f++) { let q = 0; for (let i = f * win; i < (f + 1) * win; i++) q += x[i] * x[i]; lv[f] = Math.sqrt(q / win); }
  const sorted = [...lv].sort((a, b) => a - b), thr = Math.max(0.006, (sorted[Math.floor(frames * 0.15)] || 0) * 3);
  const gaps = [];
  for (let f = 0; f < frames;) { if (lv[f] >= thr) { f++; continue; } let g = f; while (g < frames && lv[g] < thr) g++; if (f > 0 && g < frames && g - f >= 12) gaps.push(Math.round((f + g) / 2) * win); f = g; }
  const total = lens.reduce((a, b) => a + b, 0), avg = x.length / lens.length;
  const cuts = [0];
  let acc = 0;
  for (let i = 0; i < lens.length - 1; i++) {
    acc += lens[i];
    const target = Math.round((acc / total) * x.length);
    const near = gaps.filter(g => g > cuts[cuts.length - 1] + avg * 0.25 && Math.abs(g - target) < avg * 0.35).sort((a, b) => Math.abs(a - target) - Math.abs(b - target))[0];
    cuts.push(near ?? target);
  }
  cuts.push(x.length);
  return cuts;
}
function sliceWav(buf, a, b) {
  const x = buf.getChannelData(0).subarray(a, b), pcm = new Int16Array(x.length);
  for (let i = 0; i < x.length; i++) pcm[i] = Math.max(-1, Math.min(1, x[i])) * 0x7fff;
  return pcmToWav(pcm.buffer, buf.sampleRate);
}
