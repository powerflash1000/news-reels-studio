// رسم إطار الريل على canvas (مقاس 1080×1920). نفس الدالة للمعاينة والتصدير.
import { MED_DISCLAIMER, phrases } from './reel.js?v=mv1e3uci';
import { hostOf } from './feeds.js?v=mv1e3uci';
import QR from '../vendor/qrcode/qrcode.mjs?v=mv1e3uci';
import { drawBg } from './bg.js?v=mv1e3uci';

export const W = 1080, H = 1920;
const FONT = 'Cairo, Tajawal, "Noto Naskh Arabic", "Segoe UI", Tahoma, sans-serif';
const font = (size, weight = 700) => `${weight} ${size}px ${FONT}`;

function rrect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function wrap(ctx, text, maxW) {
  const lines = [];
  let cur = '';
  for (const w of text.split(/\s+/).filter(Boolean)) {
    const t = cur ? cur + ' ' + w : w;
    if (cur && ctx.measureText(t).width > maxW) { lines.push(cur); cur = w; } else cur = t;
  }
  if (cur) lines.push(cur);
  return lines;
}

function hexA(hex, a) {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${n >> 16},${(n >> 8) & 255},${n & 255},${a})`;
}

function background(ctx, color) {
  const g = ctx.createLinearGradient(0, 0, 0, H);
  g.addColorStop(0, '#0b1020');
  g.addColorStop(0.55, '#0f1730');
  g.addColorStop(1, '#070a14');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, H);
  const r = ctx.createRadialGradient(W * 0.85, 260, 0, W * 0.85, 260, 720);
  r.addColorStop(0, hexA(color, 0.35));
  r.addColorStop(1, hexA(color, 0));
  ctx.fillStyle = r;
  ctx.fillRect(0, 0, W, H);
}

function topBar(ctx, st) {
  ctx.direction = 'rtl';
  ctx.textBaseline = 'middle';
  ctx.font = font(44);
  const label = st.cat.label;
  const w = ctx.measureText(label).width + 80;
  let right = W - 60;
  if (st.story.template === 'breaking') {
    // شريط «عاجل» بنقطة بتنبض، والقسم بيروح على يساره
    ctx.font = font(56, 800);
    const bw = ctx.measureText('عاجل').width + 150;
    ctx.fillStyle = '#e5484d';
    rrect(ctx, right - bw, 82, bw, 100, 22);
    ctx.fill();
    ctx.fillStyle = `rgba(255,255,255,${0.45 + 0.55 * Math.abs(Math.sin(st.t * 3.2))})`;
    ctx.beginPath();
    ctx.arc(right - bw + 46, 132, 15, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#fff';
    ctx.textAlign = 'center';
    ctx.fillText('عاجل', right - bw / 2 + 20, 136);
    right -= bw + 16;
    ctx.font = font(44);
  }
  ctx.fillStyle = st.cat.color;
  rrect(ctx, right - w, 90, w, 84, 42);
  ctx.fill();
  ctx.fillStyle = '#fff';
  ctx.textAlign = 'center';
  ctx.fillText(label, right - w / 2, 133);
  if (st.n > 1) {
    ctx.direction = 'ltr';
    ctx.textAlign = 'center';
    ctx.font = font(40, 800);
    ctx.fillStyle = 'rgba(255,255,255,.9)';
    ctx.fillText(`${st.k + 1} / ${st.n}`, st.story.template === 'breaking' ? 330 : W / 2 - 40, 133);
  }
  const name = [st.settings.channelName, st.settings.handle].filter(Boolean).join('  ');
  if (name) {
    ctx.textAlign = 'left';
    ctx.direction = 'ltr';
    ctx.font = font(36, 600);
    ctx.fillStyle = 'rgba(255,255,255,.8)';
    ctx.fillText(name, 60, 133);
  }
}

// بيرجّع أسفل نقطة وصلها العنوان (عشان القوالب اللي تحته)
function headline(ctx, st) {
  const text = st.story.headline || 'اكتب العنوان';
  const tpl = st.story.template;
  const compact = tpl === 'stat' || tpl === 'map' || tpl === 'proof';
  const pad = compact ? 36 : 48, maxW = W - 120 - pad * 2 - 16;
  const maxLines = compact ? 2 : 4;
  let size = compact ? 64 : 76, lines;
  for (; size >= 44; size -= 4) {
    ctx.font = font(size, 800);
    lines = wrap(ctx, text, maxW);
    if (lines.length <= maxLines) break;
  }
  const lh = size * 1.35, h = lines.length * lh + pad * 2;
  const y = 250;
  ctx.fillStyle = 'rgba(255,255,255,.07)';
  rrect(ctx, 60, y, W - 120, h, 36);
  ctx.fill();
  ctx.fillStyle = tpl === 'breaking' ? '#e5484d' : st.cat.color;
  rrect(ctx, W - 60 - 16, y + 24, 16, h - 48, 8);
  ctx.fill();
  ctx.fillStyle = '#fff';
  ctx.textAlign = 'right';
  ctx.direction = 'rtl';
  ctx.textBaseline = 'middle';
  ctx.font = font(size, 800);
  lines.forEach((l, i) => ctx.fillText(l, W - 60 - pad - 16, y + pad + lh * (i + 0.5)));
  let bottom = y + h;
  if (st.story.kind === 'news' && st.story.claimKind === 'opinion') {
    bottom += 88;
    ctx.font = font(36);
    const t = 'رأي وتحليل';
    const w = ctx.measureText(t).width + 56;
    ctx.fillStyle = '#f5a623';
    rrect(ctx, W - 60 - w, y + h + 24, w, 64, 32);
    ctx.fill();
    ctx.fillStyle = '#1a1200';
    ctx.textAlign = 'center';
    ctx.fillText(t, W - 60 - w / 2, y + h + 56);
  }
  return bottom;
}

// كلمة لاتينية/أرقام من غير حروف عربي = LTR
const isLtr = w => /[A-Za-z0-9]/.test(w) && !/[\u0600-\u06FF]/.test(w);
// ترتيب الرسم من اليمين للشمال: أي عبارة إنجليزي متتالية بتتعكس عشان تتقرا من الشمال لليمين (Chat GPT مش GPT Chat)
function bidiRow(row) {
  const out = [];
  let run = [];
  const flush = () => { out.push(...run.reverse()); run = []; };
  for (const w of row) { if (isLtr(w.w)) run.push(w); else { flush(); out.push(w); } }
  flush();
  return out;
}

// الكابشن: العبارة الحالية بكلماتها، والكلمة الجارية مضيئة
function captions(ctx, st, t) {
  const seg = st.tl.segs.find(s => t >= s.start - 0.05 && t <= s.end + 0.25) || null;
  if (!seg) return;
  const groups = phrases(seg.words, 5);
  let gi = groups.findIndex(g => t <= g[g.length - 1].e + 0.05);
  if (gi < 0) gi = groups.length - 1;
  const g = groups[gi];
  if (!g) return;
  const tpl = st.story.template;
  const tall = tpl === 'stat' || tpl === 'map' || tpl === 'proof';
  const cs = st.settings?.caps || {};
  const base = Math.min(110, Math.max(56, Number(cs.size) || 84));
  const size = tall ? Math.round(base * 0.88) : base;
  ctx.font = font(size, 800);
  ctx.direction = 'rtl';
  ctx.textBaseline = 'middle';
  const space = ctx.measureText(' ').width;
  const maxW = W - 160;
  const rows = [[]];
  let rw = 0;
  for (const w of g) {
    const ww = ctx.measureText(w.w).width;
    if (rows[rows.length - 1].length && rw + space + ww > maxW) { rows.push([]); rw = 0; }
    rows[rows.length - 1].push({ ...w, ww });
    rw += (rows[rows.length - 1].length > 1 ? space : 0) + ww;
  }
  const lh = size * 1.5, y0 = (tpl === 'proof' ? (st.reel.ticker?.on ? 1610 : 1560) : tall ? 1300 : 1130) - (rows.length * lh) / 2;
  if (st.hasB) {
    ctx.font = font(34, 700);
    ctx.fillStyle = seg.speaker === 'B' ? '#ffb86b' : hexA(st.cat.color, 1);
    ctx.textAlign = 'center';
    ctx.fillText(seg.speaker === 'B' ? 'المذيع ب' : 'المذيع أ', W / 2, y0 - 60);
    ctx.font = font(size, 800);
  }
  if (cs.plate !== false) {
    const pw = Math.max(...rows.map(r => r.reduce((n, w, i) => n + w.ww + (i ? space : 0), 0))) + 80;
    ctx.fillStyle = 'rgba(5,8,18,.55)';
    rrect(ctx, (W - pw) / 2, y0 - 10, pw, rows.length * lh + 20, 36);
    ctx.fill();
  }
  rows.forEach((row, ri) => {
    const total = row.reduce((n, w, i) => n + w.ww + (i ? space : 0), 0);
    let x = W / 2 + total / 2; // RTL: أول كلمة على اليمين
    for (const w of bidiRow(row)) {
      const active = t >= w.s && t < w.e + 0.02;
      const past = t >= w.e;
      ctx.textAlign = 'right';
      if (active) {
        ctx.fillStyle = hexA(st.cat.color, 0.9);
        rrect(ctx, x - w.ww - 14, y0 + ri * lh + lh / 2 - size * 0.62, w.ww + 28, size * 1.24, 18);
        ctx.fill();
      }
      ctx.fillStyle = active ? '#fff' : past ? '#fff' : 'rgba(255,255,255,.5)';
      // الكلمة الإنجليزية/الأرقام بتترسم LTR عشان حروفها متتعكسش
      ctx.direction = isLtr(w.w) ? 'ltr' : 'rtl';
      if (cs.stroke !== false && !active) { ctx.lineJoin = 'round'; ctx.lineWidth = size * 0.1; ctx.strokeStyle = 'rgba(0,0,0,.8)'; ctx.strokeText(w.w, x, y0 + ri * lh + lh / 2); }
      ctx.fillText(w.w, x, y0 + ri * lh + lh / 2);
      ctx.direction = 'rtl';
      x -= w.ww + space;
    }
  });
}

function sourceBar(ctx, st) {
  const r = st.story;
  if (r.kind !== 'news') return; // الافتتاحية والخاتمة من غير مصدر
  const y = 1560, h = 260;
  if (r.category === 'health' || r.category === 'healthtech') {
    ctx.font = font(32, 700);
    ctx.direction = 'rtl';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const w = ctx.measureText(MED_DISCLAIMER).width + 56;
    ctx.fillStyle = 'rgba(18,165,148,.25)';
    rrect(ctx, (W - w) / 2, y - 86, w, 62, 31);
    ctx.fill();
    ctx.fillStyle = '#d9fff7';
    ctx.fillText(MED_DISCLAIMER, W / 2, y - 55);
  }
  if (r.template === 'proof' && proofSources(r).length) return; // بطاقات التوثيق بتحل محل شريط المصدر
  ctx.fillStyle = 'rgba(255,255,255,.10)';
  rrect(ctx, 60, y, W - 120, h, 36);
  ctx.fill();
  ctx.textBaseline = 'middle';
  ctx.direction = 'rtl';
  ctx.textAlign = 'right';
  ctx.font = font(32, 700);
  ctx.fillStyle = st.cat.color;
  ctx.fillText('المصدر', W - 100, y + 48);
  ctx.font = font(50, 800);
  ctx.fillStyle = '#fff';
  const name = r.sourceName || '— اكتب اسم المصدر —';
  let nm = name;
  while (ctx.measureText(nm).width > W - 240 && nm.length > 8) nm = nm.slice(0, -2);
  ctx.fillText(nm === name ? nm : nm + '…', W - 100, y + 112);
  ctx.direction = 'ltr';
  ctx.textAlign = 'right';
  ctx.font = font(34, 600);
  ctx.fillStyle = 'rgba(255,255,255,.75)';
  ctx.fillText(hostOf(r.sourceUrl) || '', W - 100, y + 174);
  if (r.credit) {
    ctx.direction = 'rtl';
    ctx.font = font(28, 600);
    ctx.fillStyle = 'rgba(255,255,255,.6)';
    ctx.fillText(r.credit.slice(0, 70), W - 100, y + 224);
  }
}

/* ---------- قوالب: خريطة، بطاقة رقم، شريط أخبار ---------- */
let world = null;
const pathCache = new Map();
export function setWorld(w) { world = w; pathCache.clear(); }
export const worldLoaded = () => !!world;

const clamp01 = v => Math.max(0, Math.min(1, v));
const easeOut = p => 1 - Math.pow(1 - p, 3);
const easeInOut = p => (p < 0.5 ? 4 * p * p * p : 1 - Math.pow(-2 * p + 2, 3) / 2);

const AR_DIGITS = '٠١٢٣٤٥٦٧٨٩';
export const toLatinDigits = v => String(v ?? '').replace(/[٠-٩]/g, d => AR_DIGITS.indexOf(d)).replace(/٫/g, '.').replace(/[٬,\s]/g, '');
const fmtNum = (n, dec) => n.toLocaleString('ar-EG', { minimumFractionDigits: dec, maximumFractionDigits: dec, useGrouping: false }).replace(/[.,]/g, '٫');

function statPanel(ctx, st, y0) {
  const s = st.story.stat || {};
  const x = 60, w = W - 120, h = 580;
  ctx.fillStyle = 'rgba(255,255,255,.07)';
  rrect(ctx, x, y0, w, h, 36);
  ctx.fill();
  const raw = toLatinDigits(s.value);
  const numeric = /^-?\d+(\.\d+)?$/.test(raw);
  const dec = numeric ? (raw.split('.')[1] || '').length : 0;
  const p = easeOut(clamp01((st.local - 0.3) / 1.5));
  const text = numeric ? fmtNum(parseFloat(raw) * p, dec) : (s.value || '٠');
  ctx.direction = 'rtl';
  ctx.textBaseline = 'middle';
  ctx.textAlign = 'center';
  let size = 250;
  ctx.font = font(size, 800);
  const unit = s.unit || '';
  const unitSize = 110;
  const gap = unit ? 24 : 0;
  while (size > 90) {
    ctx.font = font(size, 800);
    const uw = unit ? (ctx.font = font(unitSize, 800), ctx.measureText(unit).width) : 0;
    ctx.font = font(size, 800);
    if (ctx.measureText(numeric ? fmtNum(parseFloat(raw), dec) : text).width + uw + gap <= w - 120) break;
    size -= 10;
  }
  ctx.font = font(size, 800);
  const nw = ctx.measureText(numeric ? fmtNum(parseFloat(raw), dec) : text).width;
  ctx.font = font(unitSize, 800);
  const uw = unit ? ctx.measureText(unit).width : 0;
  const total = nw + (unit ? gap + uw : 0);
  const cx = x + w / 2, cy = y0 + 255;
  // الرقم على اليمين والوحدة على يساره (ترتيب القراءة العربي)
  ctx.fillStyle = '#fff';
  ctx.font = font(size, 800);
  ctx.textAlign = 'right';
  ctx.fillText(text, cx + total / 2, cy);
  if (unit) {
    ctx.font = font(unitSize, 800);
    ctx.fillStyle = st.cat.color;
    ctx.textAlign = 'left';
    ctx.fillText(unit, cx - total / 2, cy + 14);
  }
  if (s.trend === 'up' || s.trend === 'down') {
    ctx.font = font(84, 800);
    ctx.fillStyle = s.trend === 'up' ? '#30a46c' : '#e5484d';
    ctx.textAlign = 'center';
    ctx.globalAlpha *= clamp01((st.local - 1.4) / 0.4);
    ctx.fillText(s.trend === 'up' ? '▲' : '▼', cx, y0 + 88);
    ctx.globalAlpha = 1;
  }
  if (s.label) {
    ctx.font = font(50, 700);
    ctx.fillStyle = 'rgba(255,255,255,.88)';
    ctx.textAlign = 'center';
    wrap(ctx, s.label, w - 140).slice(0, 2).forEach((l, i) => ctx.fillText(l, cx, y0 + 435 + i * 70));
  }
}

function countryPath(c) {
  let p = pathCache.get(c.id);
  if (!p) { p = new Path2D(c.d); pathCache.set(c.id, p); }
  return p;
}

function mapPanel(ctx, st, y0) {
  if (!world) return;
  const m = st.story.map || {};
  const x = 60, w = W - 120, h = 620, ar = w / h;
  const sel = new Set(m.countries || []);
  const hl = world.countries.filter(c => sel.has(c.id));
  const pins = (m.pins || []).map(p => ({ ...p, x: ((p.lon + 180) / 360) * world.w, y: ((84 - p.lat) / 142) * world.h }));
  // الشاشة النهائية: على الدول المختارة، أو العالم كله لو مفيش
  const fit = (cx, cy, vw) => { const vh = vw / ar; return { vx: cx - vw / 2, vy: cy - vh / 2, vw }; };
  const full = fit(world.w / 2, world.h / 2, world.w);
  let target = full;
  if (hl.length || pins.length) {
    const boxes = [...hl.map(c => c.fb), ...pins.map(p => [p.x, p.y, p.x, p.y])];
    const b = boxes.reduce((a, c) => [Math.min(a[0], c[0]), Math.min(a[1], c[1]), Math.max(a[2], c[2]), Math.max(a[3], c[3])], [1e9, 1e9, -1e9, -1e9]);
    const bw = b[2] - b[0], bh = b[3] - b[1];
    const vw = Math.min(world.w, Math.max(pins.length && !hl.length ? 110 : 150, bw * 1.8, bh * 1.8 * ar));
    const t0 = fit((b[0] + b[2]) / 2, (b[1] + b[3]) / 2, vw);
    // ما نخرجش برّه حدود الخريطة
    t0.vx = Math.max(0, Math.min(world.w - vw, t0.vx));
    const vh = vw / ar;
    t0.vy = vh >= world.h ? (world.h - vh) / 2 : Math.max(0, Math.min(world.h - vh, t0.vy));
    target = t0;
  }
  const z = easeInOut(clamp01((st.local - 0.2) / 1.3));
  const v = { vx: full.vx + (target.vx - full.vx) * z, vy: full.vy + (target.vy - full.vy) * z, vw: full.vw + (target.vw - full.vw) * z };
  const sc = w / v.vw;
  ctx.save();
  rrect(ctx, x, y0, w, h, 36);
  ctx.clip();
  ctx.fillStyle = '#0c1630';
  ctx.fillRect(x, y0, w, h);
  ctx.translate(x, y0);
  ctx.scale(sc, sc);
  ctx.translate(-v.vx, -v.vy);
  ctx.lineJoin = 'round';
  ctx.lineWidth = 0.9 / sc;
  ctx.strokeStyle = '#0a1128';
  ctx.fillStyle = '#26396b';
  for (const c of world.countries) { const p = countryPath(c); ctx.fill(p); ctx.stroke(p); }
  const a = clamp01((st.local - 0.9) / 0.6);
  for (const c of hl) {
    const p = countryPath(c);
    ctx.globalAlpha = a;
    ctx.fillStyle = st.cat.color;
    ctx.fill(p);
    ctx.lineWidth = 2.2 / sc;
    ctx.strokeStyle = '#fff';
    ctx.stroke(p);
  }
  ctx.globalAlpha = 1;
  ctx.restore();
  // اسم الدول المختارة (بالعربي) فوق الخريطة
  ctx.direction = 'rtl';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.save();
  rrect(ctx, x, y0, w, h, 36);
  ctx.clip();
  if (hl.length && hl.length <= 4) {
    ctx.font = font(42, 800);
    for (const c of hl) {
      const X = x + (c.c[0] - v.vx) * sc, Y = y0 + (c.c[1] - v.vy) * sc + (pins.length ? 70 : 0);
      ctx.globalAlpha = a;
      ctx.lineWidth = 8;
      ctx.strokeStyle = 'rgba(8,12,28,.85)';
      ctx.strokeText(c.ar, X, Y);
      ctx.fillStyle = '#fff';
      ctx.fillText(c.ar, X, Y);
    }
    ctx.globalAlpha = 1;
  }
  // دبابيس المدن: دايرة بتنبض + اسم أو نص الدبوس
  for (const [i, p] of pins.entries()) {
    const X = x + (p.x - v.vx) * sc, Y = y0 + (p.y - v.vy) * sc;
    const pa = clamp01((st.local - 1.3 - i * 0.15) / 0.4);
    if (pa <= 0) continue;
    ctx.globalAlpha = pa;
    const ring = 20 + 16 * ((st.t * 1.4) % 1);
    ctx.strokeStyle = `rgba(229,72,77,${1 - ((st.t * 1.4) % 1)})`;
    ctx.lineWidth = 5;
    ctx.beginPath(); ctx.arc(X, Y, ring, 0, Math.PI * 2); ctx.stroke();
    ctx.fillStyle = '#e5484d';
    ctx.beginPath(); ctx.arc(X, Y, 15, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#fff';
    ctx.beginPath(); ctx.arc(X, Y, 6, 0, Math.PI * 2); ctx.fill();
    const txt = p.label || p.name;
    ctx.font = font(36, 800);
    const tw = ctx.measureText(txt).width + 36;
    const bx = Math.min(x + w - 12 - tw, Math.max(x + 12, X - tw / 2)), by = Y - 78;
    ctx.fillStyle = 'rgba(8,12,28,.88)';
    rrect(ctx, bx, Math.max(y0 + 12, by), tw, 54, 27);
    ctx.fill();
    ctx.fillStyle = '#fff';
    ctx.textAlign = 'center';
    ctx.fillText(txt, bx + tw / 2, Math.max(y0 + 12, by) + 29);
    ctx.globalAlpha = 1;
  }
  ctx.restore();
  if (m.label) {
    ctx.font = font(36, 700);
    const tw = ctx.measureText(m.label).width + 48;
    ctx.fillStyle = 'rgba(0,0,0,.6)';
    rrect(ctx, x + w - 24 - tw, y0 + 24, tw, 64, 32);
    ctx.fill();
    ctx.fillStyle = '#fff';
    ctx.fillText(m.label, x + w - 24 - tw / 2, y0 + 57);
  }
}

const qrCache = new Map();
function qrMatrix(url) {
  if (!qrCache.has(url)) {
    let m = null;
    try { const q = QR(0, 'M'); q.addData(url); q.make(); const n = q.getModuleCount(); m = Array.from({ length: n }, (_, r) => Array.from({ length: n }, (_, c) => q.isDark(r, c))); } catch { /* رابط طويل جدًا */ }
    qrCache.set(url, m);
  }
  return qrCache.get(url);
}

function drawQR(ctx, url, x, y, size) {
  ctx.fillStyle = '#fff';
  rrect(ctx, x, y, size, size, 14);
  ctx.fill();
  const m = qrMatrix(url);
  if (!m) return;
  const pad = size * 0.08, cell = (size - pad * 2) / m.length;
  ctx.fillStyle = '#0b1020';
  for (let r = 0; r < m.length; r++) for (let c = 0; c < m.length; c++) if (m[r][c]) ctx.fillRect(x + pad + c * cell, y + pad + r * cell, Math.ceil(cell), Math.ceil(cell));
}

export const proofSources = story => (story.proof?.sources || []).filter(s => s.outlet || s.url).slice(0, 3);

const PROOF_STATUS_UI = { official: ['مؤكد رسميًا', '#30a46c'], reported: ['تقارير غير مؤكدة', '#f5a623'], pending: ['بانتظار التأكيد', '#8b93b0'] };

// بطاقات المصادر: QR + لقطة اختيارية + اسم الجهة وعنوان الخبر والتاريخ + حالة التأكيد
function proofPanel(ctx, st, y0) {
  const pf = st.story.proof || {};
  const srcs = proofSources(st.story);
  let y = y0;
  const stt = PROOF_STATUS_UI[pf.status];
  ctx.direction = 'rtl';
  ctx.textBaseline = 'middle';
  if (stt) {
    ctx.font = font(36, 800);
    const tw = ctx.measureText(stt[0]).width + 96;
    const a = clamp01((st.local - 0.15) / 0.3);
    ctx.globalAlpha = a;
    ctx.fillStyle = stt[1] + '33';
    rrect(ctx, W - 60 - tw, y, tw, 66, 33);
    ctx.fill();
    ctx.strokeStyle = stt[1];
    ctx.lineWidth = 3;
    ctx.stroke();
    ctx.fillStyle = stt[1];
    ctx.beginPath();
    ctx.arc(W - 60 - tw + 36, y + 33, 11, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#fff';
    ctx.textAlign = 'center';
    ctx.fillText(stt[0], W - 60 - tw / 2 + 14, y + 35);
    ctx.globalAlpha = 1;
    y += 90;
  }
  const h = 270, gap = 20, x = 60, w = W - 120;
  srcs.forEach((s, i) => {
    const a = clamp01((st.local - 0.3 - 0.35 * i) / 0.4);
    if (a <= 0) return;
    const yy = y + i * (h + gap) + (1 - easeOut(a)) * 34;
    ctx.globalAlpha = a;
    ctx.fillStyle = 'rgba(255,255,255,.08)';
    rrect(ctx, x, yy, w, h, 28);
    ctx.fill();
    let left = x + 20;
    if (/^https?:\/\//.test(s.url || '')) { drawQR(ctx, s.url, left, yy + 40, 190); left += 190 + 20; }
    const shot = s.shot && st.shots?.get(s.shot.id);
    if (shot) {
      const sw = 280, sh = 190, sx = left, sy = yy + 40;
      ctx.save();
      rrect(ctx, sx, sy, sw, sh, 14);
      ctx.clip();
      const iw = shot.el.naturalWidth || sw, ih = shot.el.naturalHeight || sh;
      const k = Math.max(sw / iw, sh / ih);
      ctx.drawImage(shot.el, sx + (sw - iw * k) / 2, sy + (sh - ih * k) / 2, iw * k, ih * k);
      ctx.restore();
      ctx.strokeStyle = 'rgba(255,255,255,.35)';
      ctx.lineWidth = 2;
      rrect(ctx, sx, sy, sw, sh, 14);
      ctx.stroke();
      left += sw + 20;
    }
    const right = x + w - 26;
    const tw = right - left;
    ctx.textAlign = 'right';
    ctx.direction = 'rtl';
    ctx.fillStyle = '#fff';
    let outlet = s.outlet || '—';
    let osz = 44;
    for (; osz > 30; osz -= 2) { ctx.font = font(osz, 800); if (ctx.measureText(outlet).width <= tw) break; }
    ctx.font = font(osz, 800);
    while (ctx.measureText(outlet).width > tw && outlet.length > 6) outlet = outlet.slice(0, -2);
    ctx.fillText(outlet === (s.outlet || '—') ? outlet : outlet + '…', right, yy + 52);
    if (s.date) {
      ctx.font = font(32, 600);
      ctx.fillStyle = 'rgba(255,255,255,.6)';
      ctx.fillText(s.date, right, yy + 104);
    }
    if (s.title) {
      ctx.font = font(36, 600);
      ctx.fillStyle = 'rgba(255,255,255,.92)';
      wrap(ctx, s.title, tw).slice(0, 3).forEach((l, li) => ctx.fillText(l, right, yy + (s.date ? 156 : 112) + li * 46));
    }
    ctx.globalAlpha = 1;
  });
}

// شريط الأخبار السفلي: بيمشي من اليمين لليسار. النص الافتراضي = عناوين باقي الأخبار في الحلقة
function ticker(ctx, st, t) {
  const tk = st.reel.ticker;
  if (!tk?.on) return;
  const others = st.reel.stories.filter(s => s !== st.story && s.headline).map(s => s.headline);
  const text = (tk.text || others.join('   •   ') || st.story.headline || '').trim();
  if (!text) return;
  const y = 1412, h = 60, x = 60, w = W - 120;
  ctx.fillStyle = 'rgba(0,0,0,.62)';
  rrect(ctx, x, y, w, h, 20);
  ctx.fill();
  const label = tk.label || 'آخر الأخبار';
  ctx.font = font(30, 800);
  ctx.direction = 'rtl';
  ctx.textBaseline = 'middle';
  const lw = ctx.measureText(label).width + 56;
  ctx.fillStyle = '#e5484d';
  rrect(ctx, x + w - lw, y, lw, h, 20);
  ctx.fill();
  ctx.fillStyle = '#fff';
  ctx.textAlign = 'center';
  ctx.fillText(label, x + w - lw / 2, y + h / 2 + 2);
  const areaR = x + w - lw - 18, areaL = x + 18, aw = areaR - areaL;
  ctx.save();
  ctx.beginPath();
  ctx.rect(areaL, y, aw, h);
  ctx.clip();
  ctx.font = font(32, 600);
  ctx.textAlign = 'left';
  ctx.fillStyle = '#fff';
  const tw = ctx.measureText(text).width;
  const cycle = Math.max(tw, aw) + 160;
  const off = (t * 150) % cycle;
  for (let n = 0; n < 2; n++) ctx.fillText(text, areaR - off + n * cycle, y + h / 2 + 2);
  ctx.restore();
}

// سطر حقوق الصورة/الفيديو (لازم يظهر لما الترخيص بيطلب نسب)
function mediaCredit(ctx, text) {
  ctx.font = font(26, 600);
  ctx.direction = 'rtl';
  ctx.textAlign = 'right';
  ctx.textBaseline = 'middle';
  let t = '🖼 ' + text;
  while (ctx.measureText(t).width > W - 160 && t.length > 12) t = t.slice(0, -2);
  ctx.fillStyle = 'rgba(0,0,0,.45)';
  const w = ctx.measureText(t).width + 36;
  rrect(ctx, W - 60 - w, H - 78, w, 44, 22);
  ctx.fill();
  ctx.fillStyle = 'rgba(255,255,255,.85)';
  ctx.fillText(t, W - 78, H - 56);
}

function progress(ctx, st, t) {
  const d = st.tl.duration;
  ctx.fillStyle = 'rgba(255,255,255,.12)';
  ctx.fillRect(0, H - 14, W, 14);
  ctx.fillStyle = st.cat.color;
  const p = Math.min(1, t / d);
  ctx.fillRect(W - W * p, H - 14, W * p, 14);
  // فواصل بين الأخبار
  ctx.fillStyle = '#0b1020';
  for (const s of st.tl.stories.slice(1)) ctx.fillRect(W - W * (s.start / d) - 2, H - 14, 4, 14);
}

function lerpHex(a, b, p) {
  const x = parseInt(a.slice(1), 16), y = parseInt(b.slice(1), 16);
  const ch = sh => Math.round(((x >> sh) & 255) * (1 - p) + ((y >> sh) & 255) * p);
  return '#' + [16, 8, 0].map(sh => ch(sh).toString(16).padStart(2, '0')).join('');
}

// الافتتاحية والخاتمة ليها لون ثابت واسم القناة بدل القسم
function catFor(st, story) {
  if (story.kind !== 'news') return { id: story.kind, label: st.settings.channelName || 'النشرة', color: '#6b7cff' };
  return st.cats.find(c => c.id === story.category) || st.cats[0];
}

export function drawFrame(ctx, st, t) {
  const tl = st.tl;
  let k = tl.stories.findIndex(s => t >= s.start && t < s.end);
  if (k < 0) k = tl.stories.length ? (t < tl.stories[0].start ? 0 : tl.stories.length - 1) : -1;
  const idx = k >= 0 ? tl.stories[k].idx : Math.min(st.focusIdx ?? 0, st.reel.stories.length - 1);
  const story = st.reel.stories[idx];
  const cat = catFor(st, story);
  // دخول الخبر الجديد بتلاشي قصير، ولون الخلفية بينتقل من لون الخبر اللي قبله
  const fade = k > 0 ? Math.min(1, (t - tl.stories[k].start) / 0.3) : 1;
  const prev = k > 0 ? catFor(st, st.reel.stories[tl.stories[k - 1].idx]) : cat;
  const c = { ...st, story, cat, k: Math.max(0, k), n: tl.stories.length, t, local: k >= 0 ? t - tl.stories[k].start : t };
  background(ctx, lerpHex(prev.color, cat.color, fade));
  const bg = st.bgs?.get(story.id);
  if (bg) drawBg(ctx, bg, W, H, story.media?.dim ?? 0.5);
  ctx.globalAlpha = fade;
  if (story.template === 'breaking') {
    const g = ctx.createRadialGradient(W / 2, H / 2, H * 0.35, W / 2, H / 2, H * 0.75);
    g.addColorStop(0, 'rgba(229,72,77,0)');
    g.addColorStop(1, `rgba(229,72,77,${0.16 + 0.1 * Math.abs(Math.sin(t * 3.2))})`);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);
  }
  topBar(ctx, c);
  const hb = headline(ctx, c);
  if (story.template === 'stat') statPanel(ctx, c, hb + 30);
  else if (story.template === 'map') mapPanel(ctx, c, hb + 30);
  else if (story.template === 'proof') proofPanel(ctx, c, hb + 30);
  captions(ctx, c, t);
  ticker(ctx, c, t);
  sourceBar(ctx, c);
  if (bg && story.media?.credit) mediaCredit(ctx, story.media.credit);
  ctx.globalAlpha = 1;
  progress(ctx, c, t);
}
