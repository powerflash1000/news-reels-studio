// بحث الأماكن لقالب الخريطة: دول من الداتا المحلية، ومدن/أماكن من Open-Meteo Geocoding (من غير مفتاح، بيسمح بالمتصفح)
// وOpenStreetMap Nominatim للبحث الأوسع (مطارات ومعالم)، وبيتطلب مرة واحدة لكل ضغطة (سياسة الاستخدام: طلب في الثانية)
const KINDS = {
  PPLC: 'عاصمة', PPLA: 'مركز إداري', PPLA2: 'مركز إداري', PPLA3: 'مركز إداري', PPLA4: 'مركز إداري', PPLG: 'مقر حكومة',
  PPL: 'مدينة / بلدة', PPLL: 'قرية', PPLX: 'حي', AIRP: 'مطار', ADM1: 'ولاية / محافظة', ADM2: 'مقاطعة', ISL: 'جزيرة', PRK: 'منتزه', MT: 'جبل', LK: 'بحيرة', STM: 'نهر',
};
const OSM_KINDS = { aerodrome: 'مطار', city: 'مدينة', town: 'بلدة', village: 'قرية', administrative: 'منطقة إدارية', state: 'ولاية', port: 'ميناء', island: 'جزيرة' };

const norm = s => String(s || '').toLowerCase().replace(/[ًٌٍَُِّْـ]/g, '').replace(/[أإآ]/g, 'ا').replace(/ة/g, 'ه').replace(/ى/g, 'ي');

// دول ومدن من الملفات المحلية (من غير إنترنت)
export function localMatches(q, world, cities) {
  const n = norm(q);
  if (n.length < 2) return [];
  const out = [];
  for (const c of world?.countries || []) {
    if (norm(c.ar).includes(n) || c.en.toLowerCase().includes(n)) out.push({ type: 'country', id: c.id, name: c.ar, detail: c.en });
  }
  for (const c of cities || []) {
    if (norm(c.ar).includes(n)) out.push({ type: 'place', name: c.ar, lat: c.lat, lon: c.lon, detail: 'من القايمة المحلية', cc: c.cc || '' });
  }
  return out.slice(0, 8);
}

async function getJson(url, ms = 15000) {
  const res = await fetch(url, { signal: AbortSignal.timeout(ms) });
  if (!res.ok) throw new Error('HTTP ' + res.status);
  return res.json();
}

// Open-Meteo: أسماء عربي، مع الولاية والدولة وعدد السكان
export async function searchPlaces(q) {
  const j = await getJson(`https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(q)}&count=10&language=ar&format=json`);
  return (j.results || []).map(r => ({
    type: 'place', name: r.name, lat: r.latitude, lon: r.longitude, cc: r.country_code || '',
    detail: [[r.admin1, r.country].filter(Boolean).join('، '), KINDS[r.feature_code] || '', r.population ? `${r.population.toLocaleString('ar-EG')} نسمة` : ''].filter(Boolean).join(' • '),
  }));
}

// OpenStreetMap: مطارات ومعالم وأي مكان
export async function searchWide(q) {
  const j = await getJson(`https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(q)}&format=jsonv2&accept-language=ar&limit=8&addressdetails=1`);
  return j.map(r => ({
    type: 'place', name: r.name || r.display_name.split(',')[0], lat: Number(r.lat), lon: Number(r.lon), cc: (r.address?.country_code || '').toUpperCase(),
    detail: [r.display_name.split(',').slice(1, 3).join('،').trim(), OSM_KINDS[r.type] || OSM_KINDS[r.addresstype] || ''].filter(Boolean).join(' • '),
  }));
}
