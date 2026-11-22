// 🧩 بيبني مكتبة الأيقونات المحلية لقالب «شرح علمي»: assets/data/icons.json
// المصادر: Tabler Icons (MIT) + Health Icons (CC0) + مجموعة مرسومة باليد (بتاعتنا).
// التشغيل: npm pack @tabler/icons healthicons وفك الضغط، وبعدين:
//   node tools/build-icons.mjs <فولدر فيه tabler-icons-*/package و healthicons-*/package>
import { readFileSync, readdirSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const root = process.argv[2];
if (!root) { console.error('usage: node tools/build-icons.mjs <packs dir>'); process.exit(1); }
const find = pre => join(root, readdirSync(root).find(d => d.startsWith(pre) && !d.endsWith('.tgz')), 'package');
const TAB = find('tabler-icons'), HEA = find('healthicons');

const r2 = s => s.replace(/-?\d*\.\d+/g, m => String(Math.round(parseFloat(m) * 100) / 100));
const num = v => Number(v || 0);
// عناصر SVG ← path d
function toD(tag, a) {
  if (tag === 'path') return a.d;
  if (tag === 'circle' || tag === 'ellipse') {
    const cx = num(a.cx), cy = num(a.cy), rx = num(a.rx ?? a.r), ry = num(a.ry ?? a.r);
    return `M${cx - rx} ${cy}a${rx} ${ry} 0 1 0 ${rx * 2} 0a${rx} ${ry} 0 1 0 ${-rx * 2} 0`;
  }
  if (tag === 'rect') {
    const x = num(a.x), y = num(a.y), w = num(a.width), h = num(a.height), r = Math.min(num(a.rx ?? a.ry), w / 2, h / 2);
    if (!r) return `M${x} ${y}h${w}v${h}h${-w}z`;
    return `M${x + r} ${y}h${w - 2 * r}a${r} ${r} 0 0 1 ${r} ${r}v${h - 2 * r}a${r} ${r} 0 0 1 ${-r} ${r}h${-(w - 2 * r)}a${r} ${r} 0 0 1 ${-r} ${-r}v${-(h - 2 * r)}a${r} ${r} 0 0 1 ${r} ${-r}z`;
  }
  if (tag === 'line') return `M${a.x1} ${a.y1}L${a.x2} ${a.y2}`;
  if (tag === 'polyline' || tag === 'polygon') return 'M' + String(a.points).trim().replace(/\s+/g, ' ') + (tag === 'polygon' ? 'z' : '');
  return '';
}

const icons = {}, alias = {};
const addAlias = (w, name) => { w = String(w).toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim(); if (w && !alias[w] && !icons[w]) alias[w] = name; };

// ✍️ المرسومة باليد (شبكة 24، خط) — أشكال علمية مش موجودة كويس في المكتبات
const HAND = {
  cell: ['M12 3c5 0 9 3.5 9 9s-4 9-9 9-9-4-9-9 4-9 9-9z', 'M12 9a3 3 0 1 0 0 6a3 3 0 1 0 0-6z', 'M6.5 8.5h.01M17 15.5h.01M16 7.5h.01M7.5 16h.01'],
  neuron: ['M12 9a3 3 0 1 0 0 6a3 3 0 1 0 0-6z', 'M12 9V4M9.5 10.5L5 7M14.5 10.5L19 7M12 15v3l-3 3M12 18l3 3M4 7l-1-2M5 7H3M19 7l1-2M19 7h2'],
  molecule: ['M7 6a2 2 0 1 0 0 .01zM17 6a2 2 0 1 0 0 .01zM12 18a2.5 2.5 0 1 0 0 .01z', 'M8.7 7.2l2.3 8.6M15.3 7.2l-2.3 8.6M9 6h6'],
  wave: ['M2 12c2-5 4-5 6 0s4 5 6 0 4-5 6 0 2 3 2 3'],
  mitochondria: ['M4 12c0-4 4-7 8-7s8 3 8 7-4 7-8 7-8-3-8-7z', 'M7 12c1-2 2 2 3 0s2 2 3 0 2 2 3 0 1 0 1 0'],
  bacteria: ['M7 8h10a4 4 0 0 1 0 8H7a4 4 0 0 1 0-8z', 'M3 9l-1-1M3 15l-1 1M21 9l1-1M21 15l1 1M9 12h.01M13 11h.01M15 13h.01'],
  electron: ['M12 12h.01', 'M12 4a8 3 0 1 0 0 16a8 3 0 1 0 0-16z', 'M19 6.5a1.5 1.5 0 1 0 0 .01z'],
  photon: ['M3 12c1.5-3 3-3 4.5 0s3 3 4.5 0 3-3 4.5 0', 'M18 12h3M19.5 10.5L21 12l-1.5 1.5'],
  gene: ['M7 3c0 4 10 5 10 9s-10 5-10 9M17 3c0 4-10 5-10 9s10 5 10 9', 'M8 6h8M8 18h8M10 12h4'],
  blood: ['M12 3c3 4 6 7.5 6 11a6 6 0 0 1-12 0c0-3.5 3-7 6-11z', 'M9 14a3 3 0 0 0 3 3'],
  sugar: ['M6 6h12v12H6z', 'M6 6l3-3h12l-3 3M18 18l3-3V3'],
  lungs: ['M12 4v8M12 12c-1 0-2 1-3 1M12 12c1 0 2 1 3 1', 'M9 7C6 7 4 12 4 17c0 2 1 3 3 3s3-1 3-3V9M15 7c3 0 5 5 5 10 0 2-1 3-3 3s-3-1-3-3V9'],
};
for (const [n, ps] of Object.entries(HAND)) icons[n] = { s: 'h', st: 1, p: ps };

// Tabler: فئات علمية + أسماء مختارة
const tj = JSON.parse(readFileSync(join(TAB, 'icons.json'), 'utf8'));
const tn = JSON.parse(readFileSync(join(TAB, 'tabler-nodes-outline.json'), 'utf8'));
const CATS = new Set(['Health', 'Nature', 'Weather', 'Animals', 'Food', 'Charts', 'Electrical', 'Math', 'Symbols', 'Shapes', 'Vehicles', 'Buildings', 'Sport', 'Mood', 'Gestures']);
const PICK = new Set('atom atom-2 dna dna-2 microscope flask flask-2 test-pipe test-pipe-2 planet rocket satellite brain bolt flame droplet droplets wind sun moon magnet battery battery-charging cpu virus bacteria bug pill vaccine stethoscope heartbeat activity eye ear dental bone skull ripple wave-sine wave-square temperature temperature-celsius snowflake cloud-rain earth world globe tree leaf seedling plant plant-2 mountain volcano ocean fish bird paw butterfly cell cell-signal-5 radioactive telescope ruler scale clock hourglass calendar calculator chart-bar chart-line chart-pie trending-up trending-down arrow-right arrow-left arrow-up arrow-down refresh recycle bulb lightbulb gas-station oil car plane bike walk run user users man woman baby old school book books notes search zoom-in zoom-out hand-stop hand-finger target bolt-off question-mark exclamation-mark check x plus minus equal infinity percentage currency-dollar coin coins building-factory home building-hospital truck ship train wheel engine settings tool hammer flower apple carrot meat bread egg milk coffee glass bottle ice-cream salt sugar candy pizza'.split(' '));
let tCount = 0;
for (const [name, meta] of Object.entries(tj)) {
  if (!meta.styles?.outline || !tn[name]) continue;
  if (!CATS.has(meta.category) && !PICK.has(name)) continue;
  if (icons[name]) continue;
  const p = tn[name].map(([tag, a]) => r2(toD(tag, a))).filter(Boolean);
  if (!p.length) continue;
  icons[name] = { s: 't', st: 1, p }; tCount++;
}
for (const [name, meta] of Object.entries(tj)) if (icons[name]?.s === 't') { addAlias(name.replace(/-\d+$/, ''), name); for (const tg of meta.tags || []) addAlias(tg, name); }

// Health Icons (outline، مساحات مليانة)
const HDIRS = ['body', 'blood', 'devices', 'diagnostics', 'medications', 'nutrition', 'conditions', 'objects', 'zoonoses', 'exercise', 'people'];
let hCount = 0;
for (const d of HDIRS) {
  const dir = join(HEA, 'public/icons/svg/outline-24px', d);
  if (!existsSync(dir)) continue;
  for (const f of readdirSync(dir).filter(x => x.endsWith('.svg'))) {
    const raw = f.replace(/\.svg$/, '').replace(/_/g, '-').toLowerCase();
    const name = icons[raw] ? 'h-' + raw : raw;
    const svg = readFileSync(join(dir, f), 'utf8');
    const p = [];
    for (const m of svg.matchAll(/<(path|circle|rect|ellipse|polygon)\b([^>]*)\/?>/g)) {
      const a = {}; for (const kv of m[2].matchAll(/([\w-]+)="([^"]*)"/g)) a[kv[1]] = kv[2];
      const dd = toD(m[1], a); if (dd) p.push(r2(dd));
    }
    if (!p.length) continue;
    icons[name] = { s: 'e', st: 0, p }; hCount++;
    addAlias(raw, name); for (const w of raw.split('-')) if (w.length > 3) addAlias(w, name);
  }
}

// كلمات شائعة ← أيقونات (لو المكتبة مفيهاش الكلمة بالظبط)
const EXTRA = { energy: 'bolt', electricity: 'bolt', heat: 'flame', fire: 'flame', water: 'droplet', rain: 'cloud-rain', light: 'bulb', idea: 'bulb', star: 'star', space: 'planet', galaxy: 'planet', earth: 'world', planet: 'planet', time: 'clock', money: 'coins', speed: 'gauge', pressure: 'gauge', growth: 'trending-up', decline: 'trending-down', person: 'user', people: 'users', human: 'user', body: 'user', food: 'apple', medicine: 'pill', drug: 'pill', doctor: 'stethoscope', hospital: 'building-hospital', research: 'microscope', science: 'flask', lab: 'flask', experiment: 'test-pipe', chemistry: 'flask', physics: 'atom', biology: 'dna', germ: 'bacteria', microbe: 'bacteria', sound: 'wave', vibration: 'wave', signal: 'wave', protein: 'molecule', chemical: 'molecule', sleep: 'moon', exercise: 'run', muscle: 'barbell', plant: 'plant', oxygen: 'wind', air: 'wind', co2: 'cloud', carbon: 'molecule', cold: 'snowflake', ice: 'snowflake', hot: 'temperature', temperature: 'temperature', data: 'chart-bar', question: 'question-mark', warning: 'alert-triangle', check: 'check' };
for (const [w, n] of Object.entries(EXTRA)) if (icons[n] && !icons[w]) alias[w] = n;

const out = {
  licenses: {
    h: 'Hand-drawn set — part of news-reels-studio',
    t: 'Tabler Icons — MIT License, Copyright (c) 2020-2025 Paweł Kuna — https://tabler.io/icons',
    e: 'Health Icons — CC0 1.0 (public domain) — https://healthicons.org',
  },
  grid: 24, icons, alias,
};
writeFileSync('assets/data/icons.json', JSON.stringify(out));
console.log(`icons: ${Object.keys(icons).length} (tabler ${tCount}, health ${hCount}, hand ${Object.keys(HAND).length}), aliases ${Object.keys(alias).length}`);
