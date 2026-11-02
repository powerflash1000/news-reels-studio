// خريطة تفصيلية (شوارع ومدن وأسماء أماكن) من بيانات OpenStreetMap عن طريق بلاطات CARTO.
// البلاطات بتتحمّل كصور (بتسمح بـ CORS فالكانفس مبيتلوّثش) وبتتركّب على كانفس واحد حوالين المكان، والرسم بيقراها من الكاش.
const STYLES = { dark: 'dark_all', light: 'light_all' };
const R = 2; // بلاطات @2x = حروف وشوارع حادة
const cache = new Map();
const lon2x = (lon, z) => ((lon + 180) / 360) * 256 * 2 ** z;
const lat2y = (lat, z) => { const r = (Math.max(-85, Math.min(85, lat)) * Math.PI) / 180; return ((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * 256 * 2 ** z; };

export const tileKey = (t, style) => t && [t.lat.toFixed(4), t.lon.toFixed(4), t.z, style].join(',');
export const getTileMap = key => { const v = cache.get(key); return v && !v.then ? v : null; };

// المكان والتقريب: أول دبوس، أو نص الدول المظلّلة. الحجم المعروض قريب من مقاس لوحة الخريطة
export function detailTarget(m, world) {
  if (!m) return null;
  const pins = m.pins || [];
  let lat, lon, degW;
  if (pins.length) {
    const la = pins.map(p => p.lat), lo = pins.map(p => p.lon);
    lat = (Math.min(...la) + Math.max(...la)) / 2; lon = (Math.min(...lo) + Math.max(...lo)) / 2;
    // دبوس واحد: حجم المكان من نتيجة البحث (span) أو حي/مدينة صغيرة
    degW = pins.length > 1 ? Math.max(0.05, (Math.max(...lo) - Math.min(...lo)) * 1.6, (Math.max(...la) - Math.min(...la)) * 2.2) : Math.max(0.01, pins[0].span || 0.25);
  }
  else {
    const sel = new Set(m.countries || []), hl = (world?.countries || []).filter(c => sel.has(c.id));
    if (!hl.length) return null;
    const b = hl.map(c => c.fb).reduce((a, c) => [Math.min(a[0], c[0]), Math.min(a[1], c[1]), Math.max(a[2], c[2]), Math.max(a[3], c[3])], [1e9, 1e9, -1e9, -1e9]);
    lon = (((b[0] + b[2]) / 2) / world.w) * 360 - 180; lat = 84 - (((b[1] + b[3]) / 2) / world.h) * 142;
    degW = Math.max(1, ((b[2] - b[0]) / world.w) * 360 * 1.5);
  }
  const fixed = { close: 14, region: 8, wide: 5, world: 2 }[m.zoom];
  const z = fixed ?? Math.max(2, Math.min(16, Math.round(Math.log2(600 / degW))));
  return { lat, lon, z };
}

// بيحمّل البلاطات اللي بتغطي مساحة w×h (بكسل بلاطات، قريب من نص مقاس اللوحة عشان الأسامي تبقى مقروءة) حوالين المكان. بيرجّع {canvas, project(lat,lon) → [x,y] على الكانفس}
export function loadTileMap(t, style = 'dark', w = 640, h = 420) {
  const key = tileKey(t, style);
  if (!key) return Promise.resolve(null);
  if (cache.has(key)) return Promise.resolve(cache.get(key));
  const p = (async () => {
    const { lat, lon, z } = t, n = 2 ** z, cx = lon2x(lon, z), cy = lat2y(lat, z);
    const ox = cx - w / 2, oy = cy - h / 2;
    const cv = document.createElement('canvas');
    cv.width = w * R; cv.height = h * R;
    const c = cv.getContext('2d');
    c.fillStyle = style === 'light' ? '#f2efe9' : '#0e1626';
    c.fillRect(0, 0, cv.width, cv.height);
    const jobs = [];
    for (let tx = Math.floor(ox / 256); tx <= Math.floor((ox + w) / 256); tx++) {
      for (let ty = Math.floor(oy / 256); ty <= Math.floor((oy + h) / 256); ty++) {
        if (ty < 0 || ty >= n) continue;
        const wx = ((tx % n) + n) % n, sub = 'abcd'[(wx + ty) % 4];
        jobs.push((async () => {
          const res = await fetch(`https://${sub}.basemaps.cartocdn.com/${STYLES[style] || STYLES.dark}/${z}/${wx}/${ty}@2x.png`, { signal: AbortSignal.timeout(20000) });
          if (!res.ok) throw new Error(res.status);
          const img = await createImageBitmap(await res.blob());
          c.drawImage(img, (tx * 256 - ox) * R, (ty * 256 - oy) * R, 256 * R, 256 * R);
        })());
      }
    }
    const done = await Promise.allSettled(jobs);
    if (!done.some(d => d.status === 'fulfilled')) throw new Error('مقدرتش أحمّل الخريطة التفصيلية (النت أو الموقع منع التحميل).');
    const out = { canvas: cv, w, h, project: (la, lo) => [(lon2x(lo, z) - ox) * R, (lat2y(la, z) - oy) * R] };
    cache.set(key, out);
    return out;
  })();
  cache.set(key, p);
  p.catch(() => cache.delete(key));
  return p;
}
