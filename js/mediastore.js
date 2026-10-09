// تخزين ملفات الخلفيات (صور/فيديو) في IndexedDB على جهازك. الريل بيحفظ بياناتها بس (الحقوق والرابط)
let dbp = null;
function db() {
  if (!dbp) {
    dbp = new Promise((resolve, reject) => {
      try {
        const r = indexedDB.open('nrs-media', 1);
        r.onupgradeneeded = () => r.result.createObjectStore('blobs');
        r.onsuccess = () => resolve(r.result);
        r.onerror = () => reject(r.error);
      } catch (e) { reject(e); }
    });
  }
  return dbp;
}

function tx(mode, fn) {
  return db().then(d => new Promise((res, rej) => {
    const t = d.transaction('blobs', mode);
    const out = fn(t.objectStore('blobs'));
    t.oncomplete = () => res(out?.result);
    t.onerror = () => rej(t.error);
  }));
}

export const putBlob = (id, blob) => tx('readwrite', s => s.put(blob, id));
export const getBlob = id => tx('readonly', s => s.get(id)).catch(() => null);
export const delBlob = id => tx('readwrite', s => s.delete(id)).catch(() => {});
