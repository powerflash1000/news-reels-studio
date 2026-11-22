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
  return data;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  let prev = null;
  try { prev = JSON.parse(await readFile('data/econ.json', 'utf8')); } catch { /* أول مرة */ }
  const d = await updateEcon(prev, process.env);
  await writeFile('data/econ.json', JSON.stringify(d, null, 1));
  console.log('econ:', Object.entries(d.sources).map(([k, v]) => `${k}=${v.status}${v.error ? ' (' + v.error + ')' : ''}`).join(' '), '|', d.items.length, 'items');
}
