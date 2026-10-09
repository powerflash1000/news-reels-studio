// بيكتب رقم نسخة واحد (?v=…) على كل استيراد JS وملف CSS في index.html، عشان المتصفح ما يستخدمش نسخة قديمة من الكاش.
// شغّله قبل كل دمج: node tools/bump-version.mjs  (بيطبع الرقم الجديد)
import { readFile, writeFile, readdir } from 'node:fs/promises';

const v = Date.now().toString(36);
const files = (await readdir('js')).filter(f => f.endsWith('.js')).map(f => 'js/' + f);

for (const f of files) {
  const s = await readFile(f, 'utf8');
  const n = s.replace(/(from\s+['"])(\.{1,2}\/[^'"?]+\.m?js)(?:\?v=[^'"]*)?(['"])/g, `$1$2?v=${v}$3`);
  if (n !== s) await writeFile(f, n);
}

let html = await readFile('index.html', 'utf8');
html = html
  .replace(/(src|href)="((?:js|assets\/css)\/[^"?]+\.(?:js|css))(?:\?v=[^"]*)?"/g, `$1="$2?v=${v}"`)
  .replace(/<html([^>]*?)(?: data-v="[^"]*")?>/, `<html$1 data-v="${v}">`);
await writeFile('index.html', html);
console.log(v);
