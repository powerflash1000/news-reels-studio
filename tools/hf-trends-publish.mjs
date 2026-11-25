// بعد ما الريل يترندر: يكتب data/daily-reels.json عشان الاستوديو يعرضه (التاريخ + المواضيع + رابط الفيديو)
// node tools/hf-trends-publish.mjs eg owner/repo
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
const [region = 'eg', repo = 'powerflash1000/news-reels-studio'] = process.argv.slice(2);
const meta = JSON.parse(readFileSync(`out/trends-${region}.json`, 'utf8'));
const f = 'data/daily-reels.json';
const all = existsSync(f) ? JSON.parse(readFileSync(f, 'utf8')) : {};
all[region] = { at: new Date().toISOString(), latest: meta.latest, items: meta.items.map(({ t, n }) => ({ t, n })), url: `https://github.com/${repo}/releases/download/daily-reels/trends-${region}.mp4` };
writeFileSync(f, JSON.stringify(all, null, 1) + '\n');
console.log('✅', f, region);
