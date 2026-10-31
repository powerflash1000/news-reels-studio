// تخزين محلي آمن (المتصفح ممكن يمنع localStorage في الوضع الخاص) + كاش صوت في IndexedDB

export function load(key, fallback) {
  try {
    const raw = localStorage.getItem('nrs:' + key);
    return raw == null ? fallback : JSON.parse(raw);
  } catch {
    return fallback;
  }
}

export function save(key, value) {
  try {
    localStorage.setItem('nrs:' + key, JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
}

const DEFAULT_SETTINGS = {
  channelName: '',
  handle: '',
  elevenKey: '',
  elevenModel: 'eleven_multilingual_v2',
  ttsProvider: 'elevenlabs',
  gemVoiceA: 'Kore',
  gemVoiceB: 'Puck',
  geminiTtsModel: 'gemini-2.5-flash-preview-tts',
  geminiStyle: '',
  voiceA: '',
  voiceB: '',
  voiceNameA: '',
  voiceNameB: '',
  vsA: { stability: 0.5, similarity: 0.75, style: 0, speed: 1 },
  vsB: { stability: 0.5, similarity: 0.75, style: 0, speed: 1 },
  proxyUrl: '',
  pixabayKey: '',
  siKey: '',
  freesoundKey: '',
  claudeKey: '',
  claudeModel: 'claude-opus-5-5',
  reelLang: 'ar',
  logo: { on: false, pos: 'tl', size: 110, name: '' },
  avPhotos: { A: { mx: 0.5, my: 0.68, mw: 0.28, has: false }, B: { mx: 0.5, my: 0.68, mw: 0.28, has: false } },
  dialectTag: false,
  langCode: false,
  fx: { preset: 'none', bass: 0, presence: 0, air: 0, comp: 0, deess: 0, room: 0, norm: false, target: -16 },
  caps: { size: 64, plate: true, stroke: true },
  aiProvider: 'claude',
  geminiKey: '',
  groqKey: '',
  orKey: '',
  aiModel: '',
};

export function getSettings() {
  const s = load('settings', {});
  return { ...DEFAULT_SETTINGS, ...s, fx: { ...DEFAULT_SETTINGS.fx, ...(s.fx || {}) }, caps: { ...DEFAULT_SETTINGS.caps, ...(s.caps || {}) }, logo: { ...DEFAULT_SETTINGS.logo, ...(s.logo || {}) }, avPhotos: { A: { ...DEFAULT_SETTINGS.avPhotos.A, ...(s.avPhotos?.A || {}) }, B: { ...DEFAULT_SETTINGS.avPhotos.B, ...(s.avPhotos?.B || {}) } } };
}

export function setSettings(s) {
  save('settings', { ...getSettings(), ...s });
}

// عداد الحروف المستهلكة في ElevenLabs الشهر ده
const monthKey = () => new Date().toISOString().slice(0, 7);

export function charsUsed() {
  const u = load('chars', {});
  return u.month === monthKey() ? u.n : 0;
}

export function addChars(n) {
  save('chars', { month: monthKey(), n: charsUsed() + n });
}

// كاش الصوت: مفتاح = صوت + موديل + نص، عشان تعديل سطر واحد ما يعيدش توليد الباقي
let dbp = null;
function db() {
  if (!dbp) {
    dbp = new Promise((resolve, reject) => {
      try {
        const r = indexedDB.open('nrs-audio', 2);
        r.onupgradeneeded = () => {
          if (!r.result.objectStoreNames.contains('lines')) r.result.createObjectStore('lines');
          // كل توليد بيتحفظ هنا كنسخة (حتى لو اتولّد نفس السطر تاني) عشان تقدر ترجعله
          if (!r.result.objectStoreNames.contains('takes')) r.result.createObjectStore('takes', { keyPath: 'id', autoIncrement: true });
        };
        r.onsuccess = () => resolve(r.result);
        r.onerror = () => reject(r.error);
      } catch (e) { reject(e); }
    });
  }
  return dbp;
}

export async function cacheGet(key) {
  try {
    const d = await db();
    return await new Promise((res, rej) => {
      const q = d.transaction('lines').objectStore('lines').get(key);
      q.onsuccess = () => res(q.result || null);
      q.onerror = () => rej(q.error);
    });
  } catch { return null; }
}

export async function cachePut(key, value) {
  try {
    const d = await db();
    await new Promise((res, rej) => {
      const tx = d.transaction('lines', 'readwrite');
      tx.objectStore('lines').put(value, key);
      tx.oncomplete = res;
      tx.onerror = () => rej(tx.error);
    });
  } catch { /* الكاش اختياري */ }
}

export async function sha1(text) {
  const b = await crypto.subtle.digest('SHA-1', new TextEncoder().encode(text));
  return [...new Uint8Array(b)].map(x => x.toString(16).padStart(2, '0')).join('');
}

// إعادة ضبط ElevenLabs: بيمسح المفتاح والأصوات وإعدادات الصوت والرصيد المحفوظ (الباقي زي الوسيط ومفتاح Pixabay بيفضل)
export function resetElevenSettings() {
  const d = DEFAULT_SETTINGS;
  setSettings({ elevenKey: d.elevenKey, elevenModel: d.elevenModel, voiceA: '', voiceB: '', voiceNameA: '', voiceNameB: '', vsA: d.vsA, vsB: d.vsB });
  try { localStorage.removeItem('nrs:sub'); localStorage.removeItem('nrs:chars'); } catch { /* مفيش تخزين */ }
}

// مسح كاش الصوت المتولّد (التوليد بعده بيصرف حروف تاني)
export async function cacheClear() {
  try {
    const d = await db();
    await new Promise((res, rej) => {
      const tx = d.transaction('lines', 'readwrite');
      tx.objectStore('lines').clear();
      tx.oncomplete = res;
      tx.onerror = () => rej(tx.error);
    });
  } catch { /* الكاش اختياري */ }
}

// مكتبة الأصوات المتولّدة: {id, text, speaker, provider, voiceId, voiceName, model, at, mp3, words}
const TAKES_MAX = 300;
function takesTx(mode, fn) {
  return db().then(d => new Promise((res, rej) => {
    const tx = d.transaction('takes', mode), st = tx.objectStore('takes');
    let out;
    Promise.resolve(fn(st, v => { out = v; })).catch(rej);
    tx.oncomplete = () => res(out);
    tx.onerror = () => rej(tx.error);
  }));
}
export async function takePut(take) {
  try {
    await takesTx('readwrite', st => { st.add(take); });
    // نسيب آخر 300 نسخة بس
    await takesTx('readwrite', st => {
      const q = st.getAllKeys();
      q.onsuccess = () => { const keys = q.result; for (const k of keys.slice(0, Math.max(0, keys.length - TAKES_MAX))) st.delete(k); };
    });
  } catch { /* المكتبة اختيارية */ }
}
// الأحدث الأول، من غير ملف الصوت (عشان القايمة تبقى خفيفة)
export async function takeList(limit = 100) {
  try {
    return await takesTx('readonly', (st, done) => {
      const out = [];
      const q = st.openCursor(null, 'prev');
      q.onsuccess = () => {
        const c = q.result;
        if (!c || out.length >= limit) return done(out);
        const { mp3, ...meta } = c.value;
        out.push({ ...meta, size: mp3?.byteLength || 0 });
        c.continue();
      };
    });
  } catch { return []; }
}
export async function takeGet(id) {
  try { return await takesTx('readonly', (st, done) => { const q = st.get(id); q.onsuccess = () => done(q.result || null); }); } catch { return null; }
}
export async function takeDel(id) {
  try { await takesTx('readwrite', st => { st.delete(id); }); } catch { /* مش مهم */ }
}
