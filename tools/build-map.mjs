// أداة تطوير (مش بتشتغل في المتصفح): بتبني assets/data/world.json = خريطة العالم أوفلاين بأسماء الدول بالعربي.
// البيانات: Natural Earth (ملك عام) عن طريق world-atlas. الاستخدام:
//   npm install world-atlas topojson-client i18n-iso-countries d3-geo   (في مجلد مؤقت)
//   node tools/build-map.mjs <مجلد-node_modules-الأب> > assets/data/world.json
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const base = resolve(process.argv[2] || '.');
const require = createRequire(base + '/');
const topo = require('world-atlas/countries-110m.json');
const { feature } = require('topojson-client');
const iso = require('i18n-iso-countries');
const d3 = await import(pathToFileURL(require.resolve('d3-geo')).href);
iso.registerLocale(require('i18n-iso-countries/langs/ar.json'));
iso.registerLocale(require('i18n-iso-countries/langs/en.json'));

const W = 1000, LAT_TOP = 84, LAT_BOTTOM = -58;           // بنقصّ القطب الجنوبي
const H = Math.round(W * (LAT_TOP - LAT_BOTTOM) / 360);
const k = W / (2 * Math.PI);
const make = (x0 = 0) => d3.geoEquirectangular().scale(k).translate([W / 2, (LAT_TOP * Math.PI / 180) * k]).clipExtent([[x0, 0], [W, H]]);
const proj = make();                                      // رسم كامل (d3 بيقطع الدول عند خط التاريخ)
const projFocus = make(((-168 + 180) / 360) * W);          // لحدود التقريب: من غير تشوكوتكا عشان روسيا ما تبقاش عرض العالم كله
const path = d3.geoPath(proj).digits(1);
const pathFocus = d3.geoPath(projFocus);

const fc = feature(topo, topo.objects.countries);
const r1 = v => +v.toFixed(1);
const countries = [];
for (const f of fc.features) {
  const a2 = iso.numericToAlpha2(String(f.id).padStart(3, '0'));
  if (!a2 || a2 === 'AQ') continue;
  const d = path(f);
  if (!d) continue;
  const polys = f.geometry.type === 'Polygon' ? [f.geometry.coordinates] : f.geometry.coordinates;
  let best = null;
  for (const coordinates of polys) {
    const g = { type: 'Polygon', coordinates };
    const area = pathFocus.area(g);
    if (area > 0 && (!best || area > best.area)) best = { area, b: pathFocus.bounds(g) };
  }
  if (!best) best = { b: path.bounds(f) };
  const [[x0, y0], [x1, y1]] = best.b;
  countries.push({ id: a2, ar: iso.getName(a2, 'ar') || f.properties.name, en: iso.getName(a2, 'en') || f.properties.name, d, fb: [r1(x0), r1(y0), r1(x1), r1(y1)], c: [r1((x0 + x1) / 2), r1((y0 + y1) / 2)] });
}
countries.sort((a, b) => a.ar.localeCompare(b.ar, 'ar'));
process.stdout.write(JSON.stringify({ w: W, h: H, source: 'Natural Earth (public domain) via world-atlas 110m', countries }));
