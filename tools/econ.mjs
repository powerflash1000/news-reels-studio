// 📊 أرقام اقتصادية رسمية ببلاش → data/econ.json (بيشتغل مع fetch-feeds كل ساعة، بس كل مصدر بيتجاب كل 6 ساعات بالكتير)
// المصادر (كلها رسمية/عامة):
//  - BLS (مكتب إحصاءات العمل الأمريكي): التضخم، البطالة، الوظائف — من غير مفتاح (حد 25 طلب في اليوم، فإحنا بنطلب مرة كل 6 ساعات)
//  - CFTC (تقرير مراكز المضاربين COT): دهب، فضة، بترول، يورو، ين، إسترليني، S&P 500، بيتكوين — من غير مفتاح
//  - FRED (الفيدرالي فرع سانت لويس): الفايدة، عائد السندات 10 سنين، الدولار — محتاج FRED_API_KEY (ببلاش)
//  - EIA (إدارة معلومات الطاقة): مخزون البترول الخام الأمريكي الأسبوعي — محتاج EIA_API_KEY (ببلاش)
// آمن للاستيراد في الاختبارات: الشغل الفعلي بس لما الملف يتشغّل مباشرة.
import { readFile, writeFile } from 'node:fs/promises';

const EVERY = 6 * 36e5;
const UA = { 'user-agent': 'news-reels-studio econ bot' };
const num = v => { const n = Number(String(v ?? '').replace(/,/g, '')); return Number.isFinite(n) ? n : null; };
const round = (v, d = 1) => (v == null ? null : Math.round(v * 10 ** d) / 10 ** d);

// ---------- BLS ----------
export const BLS_SERIES = {
  CUUR0000SA0: { id: 'us-cpi', label: 'التضخم في أمريكا (سنوي)', en: 'US inflation (YoY)', unit: '%', kind: 'yoy' },
  LNS14000000: { id: 'us-unemp', label: 'البطالة في أمريكا', en: 'US unemployment', unit: '%', kind: 'level' },
  CES0000000001: { id: 'us-nfp', label: 'الوظائف الجديدة في أمريكا (الشهر ده)', en: 'US jobs added (month)', unit: 'ألف وظيفة', kind: 'diff' },
};
const BLS_URL = 'https://data.bls.gov/timeseries/';
export function parseBls(json) {
  const out = [];
  for (const s of json?.Results?.series || []) {
    const meta = BLS_SERIES[s.seriesID]; if (!meta) continue;
    const pts = (s.data || []).filter(d => /^M(0[1-9]|1[0-2])$/.test(d.period)).map(d => ({ key: `${d.year}-${d.period.slice(1)}`, y: +d.year, m: +d.period.slice(1), v: num(d.value), name: `${d.periodName} ${d.year}` }))
      .filter(p => p.v != null).sort((a, b) => b.key.localeCompare(a.key));
    if (pts.length < 2) continue;
    const at = (y, m) => pts.find(p => p.y === y && p.m === m);
    const cur = pts[0], prevM = pts[1];
    let value, prev;
    if (meta.kind === 'yoy') {
      // آخر شهر ليه نفس الشهر من السنة اللي فاتت (فيه شهور ما اتنشرتش، زي أكتوبر 2025 وقت إغلاق الحكومة الأمريكية)
      const yo = pts.map(p => ({ p, ly: at(p.y - 1, p.m) })).filter(x => x.ly);
      if (!yo.length) continue;
      const [a, b] = yo;
      value = round((a.p.v / a.ly.v - 1) * 100, 1); prev = b ? round((b.p.v / b.ly.v - 1) * 100, 1) : null;
      out.push({ id: meta.id, group: 'us', label: meta.label, en: meta.en, value, prev, change: prev == null ? null : round(value - prev, 1), unit: meta.unit, period: a.p.name, source: 'U.S. Bureau of Labor Statistics', sourceUrl: BLS_URL + s.seriesID });
      continue;
    } else if (meta.kind === 'diff') {
      const p2 = pts[2]; value = round(cur.v - prevM.v, 0); prev = p2 ? round(prevM.v - p2.v, 0) : null;
    } else { value = cur.v; prev = prevM.v; }
    out.push({ id: meta.id, group: 'us', label: meta.label, en: meta.en, value, prev, change: prev == null ? null : round(value - prev, meta.kind === 'diff' ? 0 : 1), unit: meta.unit, period: cur.name, source: 'U.S. Bureau of Labor Statistics', sourceUrl: BLS_URL + s.seriesID });
  }
  return out;
}
async function fetchBls() {
  const r = await fetch('https://api.bls.gov/publicAPI/v1/timeseries/data/', { method: 'POST', headers: { ...UA, 'content-type': 'application/json' }, body: JSON.stringify({ seriesid: Object.keys(BLS_SERIES) }) });
  if (!r.ok) throw new Error('BLS HTTP ' + r.status);
  const j = await r.json();
  if (j.status && j.status !== 'REQUEST_SUCCEEDED') throw new Error('BLS: ' + (j.message || []).join(' ').slice(0, 200));
  return parseBls(j);
}

// ---------- CFTC COT (Legacy, futures only) ----------
export const COT_MARKETS = {
  '088691': { id: 'cot-gold', label: 'الدهب' }, '084691': { id: 'cot-silver', label: 'الفضة' },
  '067651': { id: 'cot-oil', label: 'البترول (WTI)' }, '099741': { id: 'cot-eur', label: 'اليورو' },
  '097741': { id: 'cot-jpy', label: 'الين الياباني' }, '096742': { id: 'cot-gbp', label: 'الجنيه الإسترليني' },
  '13874A': { id: 'cot-spx', label: 'مؤشر S&P 500 (ميني)' }, '133741': { id: 'cot-btc', label: 'البيتكوين (CME)' },
};
export function parseCot(rows) {
  const by = new Map();
  for (const r of rows || []) {
    const code = String(r.cftc_contract_market_code || '').trim(); if (!COT_MARKETS[code]) continue;
    if (!by.has(code)) by.set(code, []);
    by.get(code).push(r);
  }
  const out = [];
  for (const [code, list] of by) {
    list.sort((a, b) => String(b.report_date_as_yyyy_mm_dd).localeCompare(String(a.report_date_as_yyyy_mm_dd)));
    const net = r => num(r.noncomm_positions_long_all) - num(r.noncomm_positions_short_all);
    const cur = list[0], prev = list[1];
    const v = net(cur); if (!Number.isFinite(v)) continue;
    const p = prev ? net(prev) : null;
    const date = String(cur.report_date_as_yyyy_mm_dd).slice(0, 10);
    out.push({ id: COT_MARKETS[code].id, group: 'cot', label: `صافي مراكز المضاربين على ${COT_MARKETS[code].label}`, en: `Speculators net position: ${COT_MARKETS[code].label}`,
      value: v, prev: p, change: p == null ? null : v - p, unit: 'عقد', period: `أسبوع ${date}`, side: v >= 0 ? 'شراء' : 'بيع',
      long: num(cur.noncomm_positions_long_all), short: num(cur.noncomm_positions_short_all), oi: num(cur.open_interest_all),
      source: 'CFTC — Commitments of Traders', sourceUrl: 'https://www.cftc.gov/MarketReports/CommitmentsofTraders/index.htm' });
  }
  return out;
}
async function fetchCot() {
  const codes = Object.keys(COT_MARKETS).map(c => `'${c}'`).join(',');
  const u = `https://publicreporting.cftc.gov/resource/6dca-aqww.json?$where=${encodeURIComponent(`cftc_contract_market_code in(${codes})`)}&$order=${encodeURIComponent('report_date_as_yyyy_mm_dd DESC')}&$limit=40`;
  const r = await fetch(u, { headers: UA });
  if (!r.ok) throw new Error('CFTC HTTP ' + r.status);
  return parseCot(await r.json());
}

// ---------- FRED ----------
export const FRED_SERIES = {
  DFEDTARU: { id: 'us-fed', label: 'الفايدة الأمريكية (الحد الأعلى)', en: 'Fed funds target (upper)', unit: '%' },
  DGS10: { id: 'us-10y', label: 'عائد السندات الأمريكية 10 سنين', en: 'US 10-year yield', unit: '%' },
  DTWEXBGS: { id: 'us-dollar', label: 'مؤشر الدولار (واسع)', en: 'Broad US dollar index', unit: 'نقطة' },
};
export function parseFred(id, json) {
  const meta = FRED_SERIES[id];
  const obs = (json?.observations || []).map(o => ({ d: o.date, v: num(o.value) })).filter(o => o.v != null);
  if (!meta || obs.length < 2) return null;
  const cur = obs[0], prev = obs.find(o => o.v !== cur.v) || obs[1];
  return { id: meta.id, group: 'us', label: meta.label, en: meta.en, value: cur.v, prev: prev.v, change: round(cur.v - prev.v, 2), unit: meta.unit, period: cur.d, prevPeriod: prev.d, source: 'FRED — Federal Reserve Bank of St. Louis', sourceUrl: 'https://fred.stlouisfed.org/series/' + id };
}
async function fetchFred(key) {
  const out = [];
  for (const id of Object.keys(FRED_SERIES)) {
    const r = await fetch(`https://api.stlouisfed.org/fred/series/observations?series_id=${id}&api_key=${encodeURIComponent(key)}&file_type=json&sort_order=desc&limit=40`, { headers: UA });
    if (!r.ok) throw new Error(`FRED ${id} HTTP ${r.status}`);
    const it = parseFred(id, await r.json()); if (it) out.push(it);
  }
  return out;
}

// ---------- EIA ----------
export function parseEia(json) {
  const rows = (json?.response?.data || []).map(d => ({ p: d.period, v: num(d.value) })).filter(d => d.v != null).sort((a, b) => String(b.p).localeCompare(String(a.p)));
  if (rows.length < 2) return [];
  const [cur, prev] = rows;
  return [{ id: 'us-crude', group: 'energy', label: 'مخزون البترول الخام الأمريكي (من غير الاحتياطي)', en: 'US commercial crude stocks', value: round(cur.v / 1000, 1), prev: round(prev.v / 1000, 1), change: round((cur.v - prev.v) / 1000, 1), unit: 'مليون برميل', period: `أسبوع ${cur.p}`, source: 'U.S. Energy Information Administration', sourceUrl: 'https://www.eia.gov/petroleum/supply/weekly/' }];
}
async function fetchEia(key) {
  const u = `https://api.eia.gov/v2/petroleum/stoc/wstk/data/?api_key=${encodeURIComponent(key)}&frequency=weekly&data[0]=value&facets[series][]=WCESTUS1&sort[0][column]=period&sort[0][direction]=desc&length=6`;
  const r = await fetch(u, { headers: UA });
  if (!r.ok) throw new Error('EIA HTTP ' + r.status);
  return parseEia(await r.json());
}

// ---------- 🏦 بيانات البنوك المركزية (RSS رسمي + نص البيان + اللي اتغيّر عن اللي قبله) ----------
export const CB_FEEDS = [
  { id: 'fed', name: 'الفيدرالي الأمريكي', en: 'Federal Reserve (FOMC)', rss: 'https://www.federalreserve.gov/feeds/press_monetary.xml', match: /FOMC statement/i },
  { id: 'ecb', name: 'البنك المركزي الأوروبي', en: 'European Central Bank', rss: 'https://www.ecb.europa.eu/rss/press.html', match: /monetary policy decisions/i },
  { id: 'boe', name: 'بنك إنجلترا', en: 'Bank of England', rss: 'https://www.bankofengland.co.uk/rss/news', match: /bank rate (maintained|increased|reduced|cut|raised|held)|monetary policy summary/i },
];
const ENT = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', rsquo: '’', lsquo: '‘', rdquo: '”', ldquo: '“', mdash: '—', ndash: '–', hellip: '…' };
const decode = t => String(t).replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1').replace(/&(#x?[0-9a-f]+|\w+);/gi, (m, e) => e[0] === '#' ? String.fromCodePoint(e[1].toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : +e.slice(1)) : ENT[e.toLowerCase()] ?? m);
export function parseRssItems(xml) {
  return [...String(xml).matchAll(/<item[\s>][\s\S]*?<\/item>/gi)].map(m => {
    const g = tag => decode((m[0].match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, 'i')) || [])[1] || '').trim();
    return { title: g('title'), link: g('link') || g('guid'), date: g('pubDate') || g('dc:date') };
  }).filter(i => i.title && /^https?:/.test(i.link));
}
// نص البيان من صفحة HTML: الفقرات الطويلة بس (من غير قوايم ولا فوتر)
export function htmlParagraphs(html) {
  const body = String(html).replace(/<(script|style|nav|header|footer|aside|form)[\s\S]*?<\/\1>/gi, ' ');
  const ps = [...body.matchAll(/<p[^>]*>([\s\S]*?)<\/p>/gi)].map(m => decode(m[1].replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim())
    .filter(p => p.length >= 60 && !/cookie|javascript|subscribe|last update|board of governors of the federal reserve system\s*$/i.test(p));
  return [...new Set(ps)].join('\n').slice(0, 9000);
}
const sentences = t => String(t).replace(/\n/g, ' ').split(/(?<=[.;])\s+(?=[A-Z])/).map(x => x.trim()).filter(x => x.length > 25);
const normS = x => x.toLowerCase().replace(/[^a-z0-9% ]+/g, ' ').replace(/\s+/g, ' ').trim();
export function diffStatements(cur, prev) {
  const a = sentences(cur), b = sentences(prev), bn = new Set(b.map(normS)), an = new Set(a.map(normS));
  return { added: a.filter(x => !bn.has(normS(x))).slice(0, 10), removed: b.filter(x => !an.has(normS(x))).slice(0, 10) };
}
async function getText(url) { const r = await fetch(url, { headers: UA }); if (!r.ok) throw new Error(`HTTP ${r.status} ${new URL(url).host}`); return r.text(); }
async function fetchBanks(prevBanks = []) {
  const out = [], errors = [];
  for (const b of CB_FEEDS) {
    try {
      const items = parseRssItems(await getText(b.rss)).filter(i => b.match.test(i.title)).slice(0, 2);
      if (!items.length) throw new Error('مفيش بيان في الـ RSS');
      const old = prevBanks.find(x => x.id === b.id);
      const docs = [];
      for (const it of items) {
        const cached = [old?.latest, old?.prev].find(d => d?.url === it.link && d.text);
        docs.push(cached || { title: it.title, url: it.link, date: it.date ? new Date(it.date).toISOString().slice(0, 10) : '', text: htmlParagraphs(await getText(it.link)) });
      }
      const [latest, prev] = docs;
      out.push({ id: b.id, name: b.name, en: b.en, latest, prev: prev || null, diff: prev ? diffStatements(latest.text, prev.text) : null });
    } catch (e) { errors.push(`${b.id}: ${e.message}`); const old = prevBanks.find(x => x.id === b.id); if (old) out.push(old); }
  }
  if (!out.length) throw new Error(errors.join(' | ') || 'مفيش بنوك');
  return { banks: out, errors };
}

// ---------- 📈 الأسواق (Stooq، من غير مفتاح): آخر إغلاق والتغيّر عن اليوم اللي قبله ----------
export const MARKETS = [
  { s: 'xauusd', label: 'الدهب (أونصة بالدولار)', unit: '$' }, { s: 'xagusd', label: 'الفضة (أونصة)', unit: '$' },
  { s: 'cb.f', label: 'برنت', unit: '$' }, { s: 'cl.f', label: 'خام أمريكي WTI', unit: '$' },
  { s: 'eurusd', label: 'اليورو/دولار', unit: '' }, { s: 'usdegp', label: 'الدولار/الجنيه المصري', unit: 'ج' },
  { s: '^spx', label: 'مؤشر S&P 500', unit: '' }, { s: 'btcusd', label: 'البيتكوين', unit: '$' },
];
export function parseStooq(csv) {
  const rows = String(csv).trim().split(/\r?\n/).slice(1).map(l => l.split(',')).filter(r => r.length >= 5 && /^\d{4}-\d\d-\d\d$/.test(r[0]) && Number.isFinite(+r[4]));
  if (rows.length < 2) return null;
  const [d1, c1] = [rows.at(-1)[0], +rows.at(-1)[4]], c0 = +rows.at(-2)[4];
  const wk = rows.length >= 6 ? +rows.at(-6)[4] : null;
  return { date: d1, close: c1, prev: c0, chg: round((c1 / c0 - 1) * 100, 2), wk: wk ? round((c1 / wk - 1) * 100, 2) : null };
}
async function fetchMarkets() {
  const out = [];
  for (const m of MARKETS) {
    try {
      const r = await fetch(`https://stooq.com/q/d/l/?s=${encodeURIComponent(m.s)}&i=d`, { headers: UA });
      if (!r.ok) continue;
      const q = parseStooq(await r.text()); if (!q) continue;
      out.push({ ...m, ...q, source: 'Stooq', sourceUrl: `https://stooq.com/q/?s=${encodeURIComponent(m.s)}` });
    } catch { /* السوق ده بس */ }
  }
  if (!out.length) throw new Error('مفيش أسعار');
  return out;
}

const mask = (s, keys) => keys.filter(Boolean).reduce((t, k) => t.split(k).join('***'), String(s));

export async function updateEcon(prevData, env = {}, now = Date.now()) {
  const data = { updated: new Date(now).toISOString(), sources: { ...(prevData?.sources || {}) }, items: [] };
  const old = new Map((prevData?.items || []).map(i => [i.id, i]));
  const jobs = [
    ['bls', () => fetchBls()],
    ['cftc', () => fetchCot()],
    ['fred', env.FRED_API_KEY ? () => fetchFred(env.FRED_API_KEY) : null],
    ['eia', env.EIA_API_KEY ? () => fetchEia(env.EIA_API_KEY) : null],
  ];
  const fresh = new Map();
  for (const [name, fn] of jobs) {
    const s = data.sources[name] || {};
    if (!fn) { data.sources[name] = { ...s, status: 'nokey' }; continue; }
    if (s.ok && now - Date.parse(s.ok) < EVERY) continue; // لسه متجاب قريب
    try {
      const items = await fn();
      if (!items.length) throw new Error('رجع فاضي');
      items.forEach(i => fresh.set(i.id, { ...i, src: name, fetched: data.updated }));
      data.sources[name] = { status: 'ok', ok: data.updated, n: items.length };
    } catch (e) {
      data.sources[name] = { ...s, status: 'error', error: mask(e.message || e, [env.FRED_API_KEY, env.EIA_API_KEY]).slice(0, 200), at: data.updated };
    }
  }
  const ids = new Set([...old.keys(), ...fresh.keys()]);
  for (const id of ids) {
    const it = fresh.get(id) || old.get(id);
    const src = data.sources[it.src];
    if (!fresh.has(id) && src?.status === 'nokey') continue;
    data.items.push(it);
  }
  const ORDER = { us: 0, energy: 1, cot: 2 };
  data.items.sort((a, b) => (ORDER[a.group] ?? 9) - (ORDER[b.group] ?? 9));
  // البنوك المركزية والأسواق (كل واحد كل 3 ساعات بالكتير)
  data.banks = prevData?.banks || []; data.markets = prevData?.markets || [];
  const due = k => { const s = data.sources[k]; return !(s?.ok && now - Date.parse(s.ok) < EVERY / 2); };
  if (due('banks')) {
    try { const r = await fetchBanks(data.banks); data.banks = r.banks; data.sources.banks = { status: r.errors.length ? 'partial' : 'ok', ok: data.updated, n: r.banks.length, ...(r.errors.length ? { error: r.errors.join(' | ').slice(0, 200) } : {}) }; }
    catch (e) { data.sources.banks = { ...(data.sources.banks || {}), status: 'error', error: String(e.message || e).slice(0, 200), at: data.updated }; }
  }
  if (due('markets')) {
    try { data.markets = await fetchMarkets(); data.sources.markets = { status: 'ok', ok: data.updated, n: data.markets.length }; }
    catch (e) { data.sources.markets = { ...(data.sources.markets || {}), status: 'error', error: String(e.message || e).slice(0, 200), at: data.updated }; }
  }
  return data;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  let prev = null;
  try { prev = JSON.parse(await readFile('data/econ.json', 'utf8')); } catch { /* أول مرة */ }
  const d = await updateEcon(prev, process.env);
  await writeFile('data/econ.json', JSON.stringify(d, null, 1));
  console.log('econ:', Object.entries(d.sources).map(([k, v]) => `${k}=${v.status}${v.error ? ' (' + v.error + ')' : ''}`).join(' '), '|', d.items.length, 'items');
}
