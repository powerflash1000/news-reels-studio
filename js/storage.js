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
  voiceA: '',
  voiceB: '',
  voiceNameA: '',
  voiceNameB: '',
  vsA: { stability: 0.5, similarity: 0.75, style: 0, speed: 1 },
  vsB: { stability: 0.5, similarity: 0.75, style: 0, speed: 1 },
  proxyUrl: '',
  pixabayKey: '',
  claudeKey: '',
  claudeModel: 'claude-opus-5-5',
  reelLang: 'ar',
  logo: { on: false, pos: 'tl', size: 110, name: '' },
  dialectTag: false,
  langCode: false,
  fx: { preset: 'none', bass: 0, presence: 0, air: 0, comp: 0, deess: 0, room: 0, norm: false, target: -16 },
  caps: { size: 84, plate: true, stroke: true },
  aiProvider: 'claude',
  geminiKey: '',
  groqKey: '',
  orKey: '',
  aiModel: '',
};

export function getSettings() {
  const s = load('settings', {});
  return { ...DEFAULT_SETTINGS, ...s, fx: { ...DEFAULT_SETTINGS.fx, ...(s.fx || {}) }, caps: { ...DEFAULT_SETTINGS.caps, ...(s.caps || {}) }, logo: { ...DEFAULT_SETTINGS.logo, ...(s.logo || {}) } };
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
        const r = indexedDB.open('nrs-audio', 1);
        r.onupgradeneeded = () => r.result.createObjectStore('lines');
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
