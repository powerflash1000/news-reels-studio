// مكتبة الريلز (نصوص وبيانات بس، الصوت بيتسترجع من الكاش) + نسخة احتياطية
import { load, save, getSettings, setSettings } from './storage.js?v=mv2kwqdz';

export function listReels() {
  return load('reels', []).sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
}

export function getReel(id) {
  return load('reels', []).find(r => r.id === id) || null;
}

export function upsertReel(reel) {
  const all = load('reels', []);
  const i = all.findIndex(r => r.id === reel.id);
  const rec = { ...reel, updatedAt: Date.now() };
  if (i >= 0) all[i] = rec; else all.push(rec);
  save('reels', all);
  return rec;
}

export function deleteReel(id) {
  save('reels', load('reels', []).filter(r => r.id !== id));
}

export function setStatus(id, status) {
  const all = load('reels', []);
  const r = all.find(x => x.id === id);
  if (r) { r.status = status; r.updatedAt = Date.now(); save('reels', all); }
}

export function currentId() { return load('currentId', null); }
export function setCurrentId(id) { save('currentId', id); }

// الإعدادات في النسخة الاحتياطية من غير المفاتيح السرية
const SECRETS = ['elevenKey', 'claudeKey', 'geminiKey', 'groqKey', 'orKey', 'freesoundKey', 'pixabayKey'];

export function buildBackup() {
  const settings = { ...getSettings() };
  for (const k of SECRETS) delete settings[k];
  return { app: 'news-reels-studio', version: 1, exportedAt: new Date().toISOString(), reels: load('reels', []), settings };
}

// بيرجّع {added, updated, skipped}
export function applyBackup(data) {
  if (!data || data.app !== 'news-reels-studio' || !Array.isArray(data.reels)) throw new Error('الملف ده مش نسخة احتياطية من الأداة.');
  const all = load('reels', []);
  const res = { added: 0, updated: 0, skipped: 0 };
  for (const r of data.reels) {
    if (!r || !r.id) { res.skipped++; continue; }
    const i = all.findIndex(x => x.id === r.id);
    if (i < 0) { all.push(r); res.added++; }
    else if ((r.updatedAt || 0) > (all[i].updatedAt || 0)) { all[i] = r; res.updated++; }
    else res.skipped++;
  }
  save('reels', all);
  const settings = { ...(data.settings || {}) };
  for (const k of SECRETS) delete settings[k];
  setSettings(settings);
  return res;
}
