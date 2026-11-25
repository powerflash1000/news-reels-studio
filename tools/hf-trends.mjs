// ريل «ترند مصر النهارده» بـ HyperFrames: أكتر ٥ حاجات اتبحث عنها على جوجل في مصر (آخر تحديث للرادار)
// الاستخدام: node tools/hf-trends.mjs [--out out/trends-eg.mp4] [--region eg] [--dry]
// محتاج: npx hyperframes (Node 20+) و FFmpeg. الأرقام حقيقية من data/trends.json — مفيش أي كلام متألّف.
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';

const arg = (k, d) => { const i = process.argv.indexOf('--' + k); return i > 0 ? process.argv[i + 1] : d; };
const region = arg('region', 'eg');
const out = resolve(arg('out', `out/trends-${region}.mp4`));
const dry = process.argv.includes('--dry');

const NAMES = { eg: 'مصر', sa: 'السعودية', ae: 'الإمارات', ma: 'المغرب', dz: 'الجزائر', iq: 'العراق', jo: 'الأردن', lb: 'لبنان', kw: 'الكويت' };
// كلمات عامة مش «مواضيع» (صفحات رئيسية، طقس، ترجمة…)
const SKIP = /^(الرئيسية|الصفحة الرئيسة|main page|home|google|يوتيوب|youtube|فيسبوك|facebook|translate|ترجمة|الطقس|weather)$/i;
const AR = n => Number(n).toLocaleString('ar-EG');

const data = JSON.parse(readFileSync('data/trends.json', 'utf8'));
const feed = 'gt-' + region;
const all = Object.values(data.t).filter(v => v.feed === feed);
if (!all.length) throw new Error(`مفيش بيانات لـ ${feed} في data/trends.json`);
// آخر دفعة اتسحبت من جوجل = «النهارده»
const latest = all.reduce((m, v) => (v.last > m ? v.last : m), '');
const seen = new Set();
const pick = all.filter(v => v.last === latest)
  .filter(v => v.title && v.title.trim().length > 1 && !SKIP.test(v.title.trim()))
  .sort((a, b) => (b.peak || 0) - (a.peak || 0) || (a.best || 99) - (b.best || 99))
  .filter(v => { const k = v.title.trim().toLowerCase(); if (seen.has(k)) return false; seen.add(k); return true; })
  .slice(0, 5);
if (pick.length < 5) throw new Error(`لقيت ${pick.length} مواضيع بس في آخر تحديث (${latest}) — محتاجين ٥`);

const items = pick.map(v => ({ t: v.title.trim(), n: '+' + AR(v.peak || 0), w: v.peak || 1 }));
const date = new Date(latest).toLocaleDateString('ar-EG', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'Africa/Cairo' });
const vars = { items: JSON.stringify(items), date, source: `Google Trends — ${NAMES[region] || region}` };
console.log(`📅 ${date} — آخر تحديث ${latest}`);
items.forEach((it, i) => console.log(`${i + 1}. ${it.t}  (${it.n})`));
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out.replace(/\.mp4$/, '.json'), JSON.stringify({ region, latest, items }, null, 2));
if (dry) process.exit(0);
execFileSync('npx', ['--yes', 'hyperframes@0.9.94', 'render', '--variables', JSON.stringify(vars), '--quality', 'standard', '--fps', '30', '-o', out],
  { cwd: resolve('hyperframes/trends-eg'), stdio: 'inherit', env: { ...process.env, HYPERFRAMES_SKIP_SKILLS: '1', HYPERFRAMES_TELEMETRY: '0' } });
console.log('✅', out);
