// رسم إطار الريل على canvas (عمودي 1080×1920 أو 4:5 أو مربع أو أفقي). نفس الدالة للمعاينة والتصدير.
import { detailTarget, tileKey, getTileMap } from './tiles.js?v=mw6bpna8';
import { MED_DISCLAIMER, phrases } from './reel.js?v=mw6bpna8';
import { drawAvatars, drawStudio, mouthAt, avatarWindow } from './avatar.js?v=mw6bpna8';
import { hostOf } from './feeds.js?v=mw6bpna8';
import QR from '../vendor/qrcode/qrcode.mjs?v=mw6bpna8';
import { drawBg } from './bg.js?v=mw6bpna8';

// مقاسات الإخراج. W/H متغيّرين (live binding) والتصدير بيقراهم وقت التصدير
export const FORMATS = {
  v: { w: 1080, h: 1920, name: 'عمودي 9:16 (ريلز / تيك توك / شورتس)' },
  p: { w: 1080, h: 1350, name: 'بورتريه 4:5 (إنستجرام / فيسبوك)' },
  s: { w: 1080, h: 1080, name: 'مربع 1:1' },
  h: { w: 1920, h: 1080, name: 'أفقي 16:9 (يوتيوب)' },
};
export let W = 1080, H = 1920;
// أماكن العناصر حسب المقاس (العمودي = القيم الأصلية بالظبط)
// مناطق آمنة للعمودي (تيك توك/ريلز/شورتس): زراير المنصة على اليمين وتحت والوصف تحت. SAFE_RTL = اتجاه الرسم (الإنجليزي معكوس)
var SAFE = true, SAFE_RTL = true, SAFE_KEY = '';
let L = layoutFor(1080, 1920);

// لغة الريل: نصوص الواجهة على الشاشة + اتجاه الكتابة (الإنجليزي = تخطيط معكوس أفقيًا بنفس العناصر)
const STR = {
  ar: { source: 'المصدر', opinion: 'رأي وتحليل', breaking: 'عاجل', hostA: 'المذيع أ', hostB: 'المذيع ب', follow: 'تابعنا للمزيد', ticker: 'آخر الأخبار', head: 'اكتب العنوان', src: '— اكتب اسم المصدر —', channel: 'النشرة', med: MED_DISCLAIMER, proof: { official: 'مؤكد رسميًا', reported: 'تقارير غير مؤكدة', pending: 'بانتظار التأكيد' }, zero: '٠' },
  en: { source: 'Source', opinion: 'Opinion & analysis', breaking: 'BREAKING', hostA: 'Host A', hostB: 'Host B', follow: 'Follow for more', ticker: 'Latest news', head: 'Write the headline', src: '— Add the source name —', channel: 'Newsroom', med: 'General information, not medical advice — consult your doctor', proof: { official: 'Officially confirmed', reported: 'Unconfirmed reports', pending: 'Awaiting confirmation' }, zero: '0' },
};
let S = STR.ar, RTL = true;
export function setLang(lang) { RTL = lang !== 'en'; S = STR[RTL ? 'ar' : 'en']; }

// غلاف للكانفس: dir فقط (اتجاه النص ltr) أو mirror (كمان بيعكس كل الإحداثيات الأفقية والمحاذاة، فالتخطيط العربي بيتحول لإنجليزي)
function wrapCtx(ctx, mirror) {
  const mx = x => W - x;
  const fns = mirror ? {
    fillText: (t, x, y, m) => ctx.fillText(t, mx(x), y, m),
    strokeText: (t, x, y, m) => ctx.strokeText(t, mx(x), y, m),
    fillRect: (x, y, w, h) => ctx.fillRect(mx(x) - w, y, w, h),
    strokeRect: (x, y, w, h) => ctx.strokeRect(mx(x) - w, y, w, h),
    rect: (x, y, w, h) => ctx.rect(mx(x) - w, y, w, h),
    moveTo: (x, y) => ctx.moveTo(mx(x), y),
    lineTo: (x, y) => ctx.lineTo(mx(x), y),
    arcTo: (x1, y1, x2, y2, r) => ctx.arcTo(mx(x1), y1, mx(x2), y2, r),
    arc: (x, y, r, a0, a1, ccw) => ctx.arc(mx(x), y, r, Math.PI - a0, Math.PI - a1, !ccw),
    drawImage: (img, ...a) => (a.length === 4 ? ctx.drawImage(img, mx(a[0]) - a[2], a[1], a[2], a[3]) : a.length === 8 ? ctx.drawImage(img, a[0], a[1], a[2], a[3], mx(a[4]) - a[6], a[5], a[6], a[7]) : ctx.drawImage(img, ...a)),
    createLinearGradient: (x0, y0, x1, y1) => ctx.createLinearGradient(mx(x0), y0, mx(x1), y1),
    createRadialGradient: (x0, y0, r0, x1, y1, r1) => ctx.createRadialGradient(mx(x0), y0, r0, mx(x1), y1, r1),
  } : {};
  return new Proxy(ctx, {
    get(t, p) { if (p === '__raw') return t; if (p === '__mirror') return mirror; if (fns[p]) return fns[p]; const v = t[p]; return typeof v === 'function' ? v.bind(t) : v; },
    set(t, p, v) {
      if (p === 'textAlign' && mirror) v = v === 'right' ? 'left' : v === 'left' ? 'right' : v;
      if (p === 'direction') v = 'ltr';
      t[p] = v; return true;
    },
  });
}
function layoutFor(w, h) {
  const vert = h >= 1900, safe = vert && SAFE;
  // الهوامش «المنطقية» قبل العكس: في الإنجليزي اليمين الحقيقي (الزراير) بيبقى شمال الرسم
  const mL = safe ? (SAFE_RTL ? 50 : 150) : 60, mR = safe ? (SAFE_RTL ? 150 : 50) : 60;
  const srcH = safe ? 170 : h >= 1900 ? 260 : h >= 1300 ? 230 : 200;
  const srcY = safe ? h - 430 - srcH : h - srcH - 100;
  return {
    vert, safe, mL, mR, srcH, srcY, tickY: safe ? srcY - 76 : srcY - 148,
    capCX: safe ? (mL + w - mR) / 2 : w / 2,
    topDy: vert ? (safe ? 75 : 0) : -40,
    headY: vert ? (safe ? 285 : 250) : 170,
    headMax: vert ? 4 : h >= 1300 ? 3 : 2,
    headSize: vert ? 76 : h >= 1300 ? 66 : 58,
    capScale: vert ? 1 : h >= 1300 ? 0.9 : 0.8,
    capMaxW: safe ? Math.round((w - mL - mR) * 0.9) : Math.min(Math.round(w * 0.8), 1400),
  };
}
export function setFormat(id) {
  const f = FORMATS[id] || FORMATS.v;
  W = f.w; H = f.h; L = layoutFor(W, H);
}
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
    const bw = ctx.measureText(S.breaking).width + 150;
    ctx.fillStyle = '#e5484d';
    rrect(ctx, right - bw, 82, bw, 100, 22);
    ctx.fill();
    ctx.fillStyle = `rgba(255,255,255,${0.45 + 0.55 * Math.abs(Math.sin(st.t * 3.2))})`;
    ctx.beginPath();
    ctx.arc(right - bw + 46, 132, 15, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#fff';
    ctx.textAlign = 'center';
    ctx.fillText(S.breaking, right - bw / 2 + 20, 136);
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
  const text = st.story.headline || S.head;
  const tpl = st.story.template;
  const compact = tpl === 'stat' || tpl === 'map' || tpl === 'proof';
  const pad = compact ? 36 : 48, maxW = W - 120 - pad * 2 - 16;
  const maxLines = compact ? 2 : L.headMax;
  let size = compact ? Math.min(64, L.headSize) : L.headSize, lines;
  for (; size >= 40; size -= 4) {
    ctx.font = font(size, 800);
    lines = wrap(ctx, text, maxW);
    if (lines.length <= maxLines) break;
  }
  const lh = size * 1.35, h = lines.length * lh + pad * 2;
  const y = L.headY;
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
    const t = S.opinion;
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
function captions(ctx, st, t, hb = 0) {
  if (st.noCaps) return; // حزمة فيلمورا: فيديو من غير كابشن (الترجمة في ملف SRT لوحدها)
  const seg = st.tl.segs.find(s => !s.clip && t >= s.start - 0.05 && t <= s.end + 0.25) || null;
  if (!seg || st.tl.segs.some(s => s.clip && t >= s.start && t < s.end)) return;
  const groups = phrases(seg.words, L.vert ? 3 : st.reel.ticker?.on ? 3 : 4);
  let gi = groups.findIndex(g => t <= g[g.length - 1].e + 0.05);
  if (gi < 0) gi = groups.length - 1;
  const g = groups[gi];
  if (!g) return;
  const tpl = st.story.template;
  const tall = tpl === 'stat' || tpl === 'map' || tpl === 'proof' || tpl === 'quote' || tpl === 'timeline';
  const cs = st.settings?.caps || {};
  const base = Math.min(110, Math.max(44, Number(cs.size) || 64));
  const size = Math.round((tall ? base * 0.88 : base) * L.capScale);
  ctx.font = font(size, 800);
  ctx.direction = 'rtl';
  ctx.textBaseline = 'middle';
  const space = ctx.measureText(' ').width;
  const maxW = L.capMaxW;
  const rows = [[]];
  let rw = 0;
  for (const w of g) {
    const ww = ctx.measureText(w.w).width;
    if (rows[rows.length - 1].length && rw + space + ww > maxW) { rows.push([]); rw = 0; }
    rows[rows.length - 1].push({ ...w, ww });
    rw += (rows[rows.length - 1].length > 1 ? space : 0) + ww;
  }
  const lh = size * 1.5;
  let cy = tpl === 'proof' ? (st.reel.ticker?.on ? 1610 : 1560) : tall ? 1300 : 1130;
  if (!L.vert) {
    // المقاسات الأصغر: الكابشن في نص المساحة الفاضية بين العنوان والتيكر/المصدر
    const disc = st.story.category === 'health' || st.story.category === 'healthtech';
    const top = hb + 24 + ltReserve(st), bot = (st.reel.ticker?.on ? L.tickY : disc ? L.srcY - 96 : L.srcY) - 24;
    cy = (top + bot) / 2;
  }
  if (L.safe && !CAP_CY) cy = Math.min(cy, (st.reel.ticker?.on ? L.tickY : L.srcY) - (rows.length * lh) / 2 - 30);
  if (CAP_CY) cy = CAP_CY;
  const CX = L.capCX;
  const y0 = cy - (rows.length * lh) / 2;
  if (st.hasB) {
    ctx.font = font(34, 700);
    ctx.fillStyle = seg.speaker === 'B' ? '#ffb86b' : hexA(st.cat.color, 1);
    ctx.textAlign = 'center';
    ctx.fillText(seg.speaker === 'B' ? S.hostB : S.hostA, CX, y0 - 60);
    ctx.font = font(size, 800);
  }
  if (cs.plate !== false) {
    const pw = Math.max(...rows.map(r => r.reduce((n, w, i) => n + w.ww + (i ? space : 0), 0))) + 80;
    ctx.fillStyle = 'rgba(5,8,18,.42)';
    rrect(ctx, CX - pw / 2, y0 - 8, pw, rows.length * lh + 16, 28);
    ctx.fill();
  }
  rows.forEach((row, ri) => {
    const total = row.reduce((n, w, i) => n + w.ww + (i ? space : 0), 0);
    let x = CX + total / 2; // RTL: أول كلمة على اليمين
    for (const w of RTL ? bidiRow(row) : row) {
      const active = t >= w.s && t < w.e + 0.02;
      const past = t >= w.e;
      const yy = y0 + ri * lh + lh / 2;
      ctx.textAlign = 'right';
      // الكلمة اللي بتتقال «بتنط»: بتكبر شوية أول ما تبدأ وترجع (حول نصها، ومعكوس في الإنجليزي)
      const pop = active ? 1.04 + 0.12 * Math.max(0, 1 - (t - w.s) / 0.16) : 1;
      if (pop !== 1) { const cxw = ctx.__mirror ? W - (x - w.ww / 2) : x - w.ww / 2; ctx.save(); ctx.translate(cxw, yy); ctx.scale(pop, pop); ctx.translate(-cxw, -yy); }
      if (active) {
        ctx.fillStyle = hexA(st.cat.color, 0.9);
        rrect(ctx, x - w.ww - 14, yy - size * 0.62, w.ww + 28, size * 1.24, 18);
        ctx.fill();
      }
      // الأرقام بلون القسم عشان تبان
      const num = /[0-9٠-٩]/.test(w.w);
      ctx.fillStyle = active ? '#fff' : num ? hexA(st.cat.color, past ? 1 : 0.75) : past ? '#fff' : 'rgba(255,255,255,.5)';
      // الكلمة الإنجليزية/الأرقام بتترسم LTR عشان حروفها متتعكسش
      ctx.direction = isLtr(w.w) ? 'ltr' : 'rtl';
      if (cs.stroke !== false && !active) { ctx.lineJoin = 'round'; ctx.lineWidth = size * 0.1; ctx.strokeStyle = 'rgba(0,0,0,.8)'; ctx.strokeText(w.w, x, yy); }
      ctx.fillText(w.w, x, yy);
      if (pop !== 1) ctx.restore();
      ctx.direction = 'rtl';
      x -= w.ww + space;
    }
  });
}

function sourceBar(ctx, st) {
  const r = st.story;
  if (r.kind !== 'news') return; // الافتتاحية والخاتمة من غير مصدر
  const y = L.srcY, h = L.srcH;
  const bw = L.safe ? W - L.mL - L.mR : Math.min(W - 120, 1100), bx = L.safe ? L.mL : W - 60 - bw, rx = bx + bw - 40; // الأفقي: الشريط أضيق ومحاذي لليمين
  if (r.category === 'health' || r.category === 'healthtech') {
    ctx.font = font(32, 700);
    ctx.direction = 'rtl';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const w = ctx.measureText(S.med).width + 56;
    ctx.fillStyle = 'rgba(18,165,148,.25)';
    rrect(ctx, L.capCX - w / 2, y - 86, w, 62, 31);
    ctx.fill();
    ctx.fillStyle = '#d9fff7';
    ctx.fillText(S.med, L.capCX, y - 55);
  }
  if (r.template === 'proof' && proofSources(r).length) return; // بطاقات التوثيق بتحل محل شريط المصدر
  ctx.fillStyle = 'rgba(255,255,255,.10)';
  rrect(ctx, bx, y, bw, h, 36);
  ctx.fill();
  ctx.textBaseline = 'middle';
  ctx.direction = 'rtl';
  ctx.textAlign = 'right';
  ctx.font = font(32, 700);
  ctx.fillStyle = st.cat.color;
  ctx.fillText(S.source, rx, y + 48);
  ctx.font = font(L.vert ? 50 : 44, 800);
  ctx.fillStyle = '#fff';
  const name = r.sourceName || S.src;
  let nm = name;
  while (ctx.measureText(nm).width > bw - 120 && nm.length > 8) nm = nm.slice(0, -2);
  ctx.fillText(nm === name ? nm : nm + '…', rx, y + (L.safe ? 98 : L.vert ? 112 : 100));
  ctx.direction = 'ltr';
  ctx.textAlign = 'right';
  ctx.font = font(34, 600);
  ctx.fillStyle = 'rgba(255,255,255,.75)';
  ctx.fillText(hostOf(r.sourceUrl) || '', rx, y + (L.safe ? 144 : L.vert ? 174 : 148));
  if (r.credit && h >= 230) {
    ctx.direction = 'rtl';
    ctx.font = font(28, 600);
    ctx.fillStyle = 'rgba(255,255,255,.6)';
    ctx.fillText(r.credit.slice(0, 70), rx, y + 204);
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
const fmtNum = (n, dec) => (RTL
  ? n.toLocaleString('ar-EG', { minimumFractionDigits: dec, maximumFractionDigits: dec, useGrouping: false }).replace(/[.,]/g, '٫')
  : n.toLocaleString('en-US', { minimumFractionDigits: dec, maximumFractionDigits: dec, useGrouping: false }));

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
  const text = numeric ? fmtNum(parseFloat(raw) * p, dec) : (s.value || S.zero);
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

// بطاقة اقتباس: علامة تنصيص كبيرة + نص الاقتباس + اسم صاحبه ووظيفته (من غير صور أشخاص)
function quotePanel(ctx, st, y0) {
  const q = st.story.quote || {};
  const x = 60, w = W - 120, h = 540;
  const p = easeOut(clamp01((st.local - 0.2) / 0.8));
  ctx.save();
  ctx.fillStyle = 'rgba(255,255,255,.07)';
  rrect(ctx, x, y0, w, h, 36);
  ctx.fill();
  ctx.fillStyle = st.cat.color;
  rrect(ctx, x + w - 14, y0 + 36, 14, h - 72, 7);
  ctx.fill();
  ctx.globalAlpha *= p;
  ctx.direction = 'rtl';
  ctx.textBaseline = 'middle';
  ctx.textAlign = 'right';
  ctx.font = font(230, 800);
  ctx.fillStyle = hexA(st.cat.color, 0.85);
  ctx.fillText('”', x + w - 56, y0 + 96);
  const text = (q.text || '').trim() || '…';
  let size = 68, lines = [];
  for (; size >= 38; size -= 4) {
    ctx.font = font(size, 700);
    lines = wrap(ctx, text, w - 190);
    if (lines.length <= Math.floor(270 / (size * 1.4))) break;
  }
  ctx.font = font(size, 700);
  ctx.fillStyle = '#fff';
  const lh = size * 1.4, top = y0 + 130 + (270 - Math.min(lines.length, 5) * lh) / 2;
  lines.slice(0, 5).forEach((l, i) => { ctx.textAlign = 'right'; ctx.fillText(l, x + w - 100, top + i * lh + lh / 2); });
  // صاحب الاقتباس: دايرة بالحرف الأول + الاسم والوظيفة
  const ay = y0 + h - 68, name = (q.who || '').trim();
  if (name) {
    ctx.fillStyle = st.cat.color;
    ctx.beginPath(); ctx.arc(x + w - 82, ay, 38, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#fff'; ctx.textAlign = 'center'; ctx.font = font(44, 800);
    ctx.fillText([...name][0] || '', x + w - 82, ay + 3);
    ctx.textAlign = 'right';
    ctx.font = font(46, 800); ctx.fillStyle = '#fff';
    ctx.fillText(name.slice(0, 40), x + w - 140, ay - (q.role ? 16 : 0));
    if (q.role) { ctx.font = font(32, 600); ctx.fillStyle = 'rgba(255,255,255,.75)'; ctx.fillText(q.role.slice(0, 48), x + w - 140, ay + 28); }
  }
  ctx.restore();
}

// خط زمني للقصة: لحد 4 أحداث (سنة + جملة قصيرة) بتظهر واحد ورا التاني
function timelinePanel(ctx, st, y0) {
  const ev = (st.story.timeline?.events || []).filter(e => e.year || e.text).slice(0, 4);
  const x = 60, w = W - 120, h = 600;
  ctx.save();
  ctx.fillStyle = 'rgba(255,255,255,.07)';
  rrect(ctx, x, y0, w, h, 36);
  ctx.fill();
  const n = Math.max(1, ev.length), rowH = Math.min(150, (h - 90) / n), top = y0 + 55 + ((h - 90) - rowH * n) / 2;
  const cx = x + w - 70, k = n <= 2 ? 1.25 : 1;
  ctx.fillStyle = 'rgba(255,255,255,.18)';
  if (ev.length > 1) rrect(ctx, cx - 3, top + rowH / 2, 6, rowH * (ev.length - 1), 3), ctx.fill();
  ctx.direction = 'rtl'; ctx.textBaseline = 'middle';
  ev.forEach((e, i) => {
    const p = easeOut(clamp01((st.local - 0.3 - i * 0.9) / 0.5));
    if (p <= 0) return;
    const cy = top + rowH * i + rowH / 2;
    ctx.save();
    ctx.globalAlpha *= p;
    ctx.translate((1 - p) * -60, 0);
    ctx.fillStyle = st.cat.color;
    ctx.beginPath(); ctx.arc(cx, cy, 24, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#fff';
    ctx.beginPath(); ctx.arc(cx, cy, 9, 0, Math.PI * 2); ctx.fill();
    ctx.textAlign = 'right';
    ctx.font = font(54 * k, 800); ctx.fillStyle = st.cat.color;
    ctx.fillText(toLatinDigits(e.year || ''), cx - 54, cy - (e.text ? rowH * 0.2 : 0));
    if (e.text) {
      ctx.font = font(36 * k, 600); ctx.fillStyle = '#fff';
      wrap(ctx, e.text, w - 220).slice(0, 2).forEach((l, j) => ctx.fillText(l, cx - 54, cy + rowH * 0.2 + j * 42 * k));
    }
    ctx.restore();
  });
  ctx.restore();
}

// شريط اسم (Lower third) للعاجل والعادي: بيدخل من الجنب ويقعد 6 ثواني
const LT_H = 100;
const ltOn = st => !!(st.story.lower?.on && (st.story.lower.name || '').trim() && !PANEL_TPLS.has(st.story.template));
const ltReserve = st => (!L.vert && ltOn(st) ? LT_H + 16 : 0);
function lowerThird(ctx, st, hb) {
  if (!ltOn(st)) return;
  const lt = st.story.lower, local = st.local ?? 0;
  const a = easeOut(clamp01((local - 0.5) / 0.5)) * clamp01((6.9 - local) / 0.4);
  if (a <= 0.01) return;
  const w = Math.min(W - 120, 780), x = W - 60 - w, y = hb + 28;
  ctx.save();
  ctx.globalAlpha *= a;
  ctx.translate((1 - a) * 220, 0);
  ctx.fillStyle = 'rgba(5,8,18,.72)';
  rrect(ctx, x, y, w, LT_H, 22);
  ctx.fill();
  ctx.fillStyle = st.cat.color;
  rrect(ctx, x + w - 16, y, 16, LT_H, 8);
  ctx.fill();
  ctx.direction = 'rtl'; ctx.textBaseline = 'middle'; ctx.textAlign = 'right';
  ctx.fillStyle = '#fff';
  ctx.font = font(lt.role ? 40 : 48, 800);
  ctx.fillText(lt.name.slice(0, 40), x + w - 40, y + (lt.role ? 32 : LT_H / 2));
  if (lt.role) { ctx.font = font(28, 600); ctx.fillStyle = 'rgba(255,255,255,.78)'; ctx.fillText(lt.role.slice(0, 54), x + w - 40, y + 72); }
  ctx.restore();
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
    const fixed = { world: world.w, wide: 260, region: 110, close: 55 }[m.zoom];
    const vw = fixed ? Math.min(world.w, fixed) : Math.min(world.w, Math.max(pins.length && !hl.length ? 110 : 150, bw * 1.8, bh * 1.8 * ar));
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
  // خريطة تفصيلية (شوارع/مدن): بعد ما التقريب البسيط يخلص، بتظهر بالتدريج وبتكمّل تقريب بطيء
  const dt = m.detail && m.detail !== 'off' ? detailTarget(m, world) : null;
  const tm = dt && getTileMap(tileKey(dt, m.detail));
  const da = tm ? (st.settledMap ? 1 : clamp01((st.local - 1.3) / 0.6)) : 0;
  let proj = null;
  if (tm && da > 0) {
    const push = 1 + 0.12 * clamp01((st.local - 1.3) / 8);
    const s0 = Math.max(w / tm.canvas.width, h / tm.canvas.height) * 1.02 * push;
    const ox = x + w / 2 - (tm.canvas.width / 2) * s0, oy = y0 + h / 2 - (tm.canvas.height / 2) * s0;
    ctx.save();
    rrect(ctx, x, y0, w, h, 36);
    ctx.clip();
    ctx.globalAlpha = da;
    ctx.drawImage(tm.canvas, ox, oy, tm.canvas.width * s0, tm.canvas.height * s0);
    ctx.globalAlpha = da * 0.85;
    ctx.font = font(20, 600);
    ctx.fillStyle = m.detail === 'light' ? 'rgba(0,0,0,.75)' : 'rgba(255,255,255,.8)';
    ctx.textAlign = 'left';
    ctx.direction = 'ltr';
    ctx.textBaseline = 'bottom';
    ctx.fillText('© OpenStreetMap contributors © CARTO', x + 22, y0 + h - 14);
    ctx.restore();
    ctx.globalAlpha = 1;
    if (da >= 0.5) proj = (la, lo) => { const [px, py] = tm.project(la, lo); return [ox + px * s0, oy + py * s0]; };
  }
  // اسم الدول المختارة (بالعربي) فوق الخريطة
  ctx.direction = 'rtl';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.save();
  rrect(ctx, x, y0, w, h, 36);
  ctx.clip();
  if (hl.length && hl.length <= 4 && !proj) {
    ctx.font = font(42, 800);
    for (const c of hl) {
      const X = x + (c.c[0] - v.vx) * sc, Y = y0 + (c.c[1] - v.vy) * sc + (pins.length ? 70 : 0);
      ctx.globalAlpha = a;
      ctx.lineWidth = 8;
      ctx.strokeStyle = 'rgba(8,12,28,.85)';
      ctx.strokeText(RTL ? c.ar : c.en, X, Y);
      ctx.fillStyle = '#fff';
      ctx.fillText(RTL ? c.ar : c.en, X, Y);
    }
    ctx.globalAlpha = 1;
  }
  // دبابيس المدن: دايرة بتنبض + اسم أو نص الدبوس
  for (const [i, p] of pins.entries()) {
    const [X, Y] = proj ? proj(p.lat, p.lon) : [x + (p.x - v.vx) * sc, y0 + (p.y - v.vy) * sc];
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

function drawQR(ctx0, url, x, y, size) {
  // الـQR مينفعش يتعكس: بنرسمه على الكانفس الأصلي في مكانه المعكوس
  const ctx = ctx0.__raw || ctx0;
  if (ctx0.__mirror) x = W - x - size;
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

const PROOF_COLOR = { official: '#30a46c', reported: '#f5a623', pending: '#8b93b0' };

// بطاقات المصادر: QR + لقطة اختيارية + اسم الجهة وعنوان الخبر والتاريخ + حالة التأكيد
function proofPanel(ctx, st, y0) {
  const pf = st.story.proof || {};
  const srcs = proofSources(st.story);
  let y = y0;
  const stt = PROOF_COLOR[pf.status] ? [S.proof[pf.status], PROOF_COLOR[pf.status]] : null;
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
  const en = (st.reel.lang || 'ar') === 'en';
  const src = tk.src || (tk.text ? 'custom' : 'reel');
  const catOf = id => (st.cats || []).find(c => c.id === id);
  // المقاطع بترتيب القراية: [اسم القسم] العنوان  •  [القسم] العنوان …
  let parts = [];
  if (src === 'feed' && tk.items?.length) {
    for (const x of tk.items.filter(x => !x.off)) {
      const c = catOf(x.cat);
      if (tk.tag !== false && c) parts.push({ tag: true, txt: (en ? c.en || c.label : c.label).replace(/^\p{Extended_Pictographic}\s*/u, ''), color: c.color || '#e5484d' });
      parts.push({ txt: x.t });
      parts.push({ sep: true, txt: '•' });
    }
  } else {
    const others = st.reel.stories.filter(s => s !== st.story && s.headline).map(s => s.headline);
    const text = ((src === 'custom' ? tk.text : '') || others.join('   •   ') || st.story.headline || '').trim();
    if (text) parts = [{ txt: text }, { sep: true, txt: '•' }];
  }
  if (!parts.length) return;
  const y = L.tickY, h = 60, x = L.safe ? L.mL : 60, w = L.safe ? W - L.mL - L.mR : W - 120;
  ctx.fillStyle = 'rgba(0,0,0,.62)';
  rrect(ctx, x, y, w, h, 20);
  ctx.fill();
  const label = tk.label || S.ticker;
  ctx.font = font(30, 800);
  ctx.direction = en ? 'ltr' : 'rtl';
  ctx.textBaseline = 'middle';
  const lw = ctx.measureText(label).width + 56;
  const lx = en ? x : x + w - lw;
  ctx.fillStyle = '#e5484d';
  rrect(ctx, lx, y, lw, h, 20);
  ctx.fill();
  ctx.fillStyle = '#fff';
  ctx.textAlign = 'center';
  ctx.fillText(label, lx + lw / 2, y + h / 2 + 2);
  const areaL = en ? x + lw + 18 : x + 18, areaR = en ? x + w - 18 : x + w - lw - 18, aw = areaR - areaL;
  ctx.save();
  ctx.beginPath();
  ctx.rect(areaL, y, aw, h);
  ctx.clip();
  const PAD = 14, GAP = 22;
  for (const p of parts) { ctx.font = p.tag ? font(26, 800) : font(32, 600); p.w = ctx.measureText(p.txt).width + (p.tag ? PAD * 2 : 0); }
  const total = parts.reduce((a, p) => a + p.w + GAP, 0);
  const cycle = Math.max(total, aw) + 120;
  const off = (t * 140 + aw) % cycle; // من أول ثانية الشريط مليان
  const cy = y + h / 2 + 2;
  const draw = (p, px) => { // px = الحافة اللي بيبدأ منها المقطع في اتجاه القراية
    const left = en ? px : px - p.w;
    if (left > areaR || left + p.w < areaL) return;
    if (p.tag) {
      ctx.fillStyle = p.color;
      rrect(ctx, left, y + 11, p.w, h - 22, 12);
      ctx.fill();
      ctx.font = font(26, 800); ctx.fillStyle = '#fff'; ctx.textAlign = 'center';
      ctx.fillText(p.txt, left + p.w / 2, cy);
      return;
    }
    ctx.font = font(32, 600);
    ctx.fillStyle = p.sep ? '#e5484d' : '#fff';
    ctx.textAlign = 'left';
    ctx.fillText(p.txt, left, cy);
  };
  for (let n = 0; n < 2; n++) {
    // عربي: الشريط بيمشي يمين (زي القنوات العربي) وأول خبر في أوله؛ إنجليزي: بيمشي شمال
    let cur = en ? areaR - off + n * cycle : areaL + off - n * cycle;
    for (const p of parts) {
      draw(p, cur);
      cur += en ? p.w + GAP : -(p.w + GAP);
    }
  }
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
  if (story.kind === 'idea') return { id: 'idea', label: RTL ? 'فكرة' : 'Idea', color: '#f59e0b' };
  if (story.kind !== 'news') return { id: story.kind, label: st.settings.channelName || S.channel, color: '#6b7cff' };
  const c = st.cats.find(x => x.id === story.category) || st.cats[0];
  return RTL ? c : { ...c, label: c.en || c.label };
}

// لوجو القناة: في ركن من الأركان الأربعة (بيتعكس تلقائيًا في الريل الإنجليزي)
function logoBox(st, scale = 1) {
  const lg = st.settings?.logo, img = st.logo;
  if (!lg?.on || !img) return null;
  const iw = img.naturalWidth || img.width, ih = img.naturalHeight || img.height;
  if (!iw || !ih) return null;
  const h0 = Math.max(40, Math.min(300, lg.size || 110)) * (L.vert ? 1 : 0.8) * scale;
  const w = Math.min((h0 * iw) / ih, W * 0.45 * scale), h = (w * ih) / iw;
  return { img, w, h, pos: lg.pos || 'tl' };
}
function drawLogo(ctx, st) {
  const b = logoBox(st);
  if (!b) return;
  const x = b.pos.endsWith('l') ? 60 : W - 60 - b.w;
  const y = b.pos.startsWith('t') ? 22 : H - 34 - b.h;
  ctx.drawImage(b.img, x, y, b.w, b.h);
}

// مقدمة/خاتمة تلقائية: لوجو + اسم القناة (أو نص مخصص) بحركة دخول ناعمة
function drawBumper(ctx, st, ent, t) {
  const kind = ent.bumper, local = t - ent.start, dur = ent.end - ent.start;
  const bp = st.reel.bumpers?.[kind] || {};
  const a = easeOut(clamp01(local / 0.55)), out = clamp01((dur - local) / 0.35);
  const col = st.cat.color;
  const box = logoBox({ ...st, settings: { ...st.settings, logo: { ...(st.settings?.logo || {}), on: !!st.logo, size: 300 } } }, 1.2);
  const cx = W / 2, cy = H * (L.vert ? 0.42 : 0.44);
  ctx.save();
  ctx.globalAlpha = a * out;
  const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, Math.max(W, H) * 0.6);
  g.addColorStop(0, hexA(col, 0.4)); g.addColorStop(1, hexA(col, 0));
  ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
  let y = cy;
  if (box) {
    const s = 0.86 + 0.14 * a;
    ctx.drawImage(box.img, cx - (box.w * s) / 2, cy - box.h * s * 0.7, box.w * s, box.h * s);
    y = cy + box.h * s * 0.3 + 90;
  }
  const main = (bp.text || '').trim() || (kind === 'intro' ? (st.settings?.channelName || S.channel) : S.follow);
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.direction = 'rtl';
  let size = L.vert ? 104 : 84;
  ctx.font = font(size, 800);
  while (ctx.measureText(main).width > W - 160 && size > 40) { size -= 4; ctx.font = font(size, 800); }
  ctx.fillStyle = '#fff';
  ctx.fillText(main, cx, y);
  const lw = Math.min(W * 0.5, 520) * a;
  ctx.fillStyle = col;
  rrect(ctx, cx - lw / 2, y + size * 0.75, lw, 10, 5);
  ctx.fill();
  const handle = st.settings?.handle || '';
  if (handle) {
    ctx.font = font(L.vert ? 52 : 42, 700);
    ctx.fillStyle = 'rgba(255,255,255,.85)';
    ctx.direction = 'ltr';
    ctx.fillText(handle, cx, y + size * 0.75 + 70);
  }
  ctx.restore();
}

// شاشة انتظار للايف (لما مفيش خبر على الهواء): لوجو + اسم القناة + شريط الأخبار الحي
export function drawSlate(ctx, st, t) {
  setFormat(st.reel.format);
  setLang(st.reel.lang);
  if (ctx.canvas && (ctx.canvas.width !== W || ctx.canvas.height !== H)) { ctx.canvas.width = W; ctx.canvas.height = H; }
  const cat = (st.cats || []).find(c => c.id === 'politics') || st.cats?.[0] || { id: 'x', color: '#e5484d' };
  background(ctx, cat.color);
  const U = RTL ? ctx : wrapCtx(ctx, true), D = RTL ? ctx : wrapCtx(ctx, false);
  const text = st.slateText || '';
  const reel = { ...st.reel, bumpers: { intro: { text }, outro: {} } };
  const s2 = { ...st, reel, cat, story: { headline: '' } };
  drawBumper(U, s2, { bumper: 'intro', start: t - 5, end: t + 1000 }, t);
  ctx.globalAlpha = 1;
  ticker(D, s2, t);
}

// مذيعين أفاتار بيقروا أول كام ثانية من الحلقة (بدل الكابشن)؛ بيرجّع true لو ظاهرين
function avatarsLayer(ctx, st, t, hb, kr) {
  const av = st.reel.avatars;
  if (!av?.on || kr !== 0 || PANEL_TPLS.has(st.story.template)) return false;
  const w = avatarWindow(st.tl, Math.max(2, Math.min(20, Number(av.seconds) || 6)));
  const appear = clamp01((t - w.t0) / 0.45) * clamp01((w.t1 - t) / 0.35);
  if (appear <= 0.01) return false;
  if ((av.scene || 'studio') === 'studio') return appear > 0.5; // المشهد الكامل بيترسم في آخر الإطار
  const disc = st.story.category === 'health' || st.story.category === 'healthtech';
  const top = hb + 24 + ltReserve(st), bot = (st.reel.ticker?.on ? L.tickY : disc ? L.srcY - 96 : L.srcY) - 24;
  const box = { x: 60, y: top, w: W - 120, h: Math.max(200, bot - top) };
  const photos = {};
  for (const k of ['A', 'B']) photos[k] = { img: st.avImgs?.[k], ...(st.settings?.avPhotos?.[k] || {}) };
  drawAvatars(ctx, box, { who: av.who, mode: av.mode, photos, t, mouth: mouthAt(st.tl, t), appear: easeOut(appear), skin: av.skin, hijab: !!av.hijab, beard: !!av.beard, color: st.cat.color, rtl: RTL });
  return true;
}

// غلاف / ثمبنيل ثابت للخبر: عنوان كبير + القسم + المصدر + اللوجو، بأي مقاس
export function drawCover(ctx, st, idx, fmt) {
  setFormat(fmt || st.reel.format);
  setLang(st.reel.lang);
  if (ctx.canvas && (ctx.canvas.width !== W || ctx.canvas.height !== H)) { ctx.canvas.width = W; ctx.canvas.height = H; }
  const story = st.reel.stories[idx] || st.reel.stories[0];
  const cat = catFor(st, story);
  const c = { ...st, story, cat, k: 0, n: 1, t: 0, local: 99, tl: { duration: 1, stories: [] } };
  background(ctx, cat.color);
  const th = st.reel.thumb || {};
  // خلفية الثمبنيل: صورة مخصوصة / مشهد من الخبر / خلفية الخبر
  const sc = /^scene:/.test(th.bg || '') ? (story.scenes || [])[Number(th.bg.slice(6))]?.media : null;
  const pick = th.bg === 'own' && th.own && st.bgs?.get(th.own.id) ? [st.bgs.get(th.own.id), th.own]
    : sc && st.bgs?.get(sc.id) ? [st.bgs.get(sc.id), sc] : [st.bgs?.get(story.id), story.media];
  const [bg, bm] = pick;
  if ((th.style || 'news') !== 'news') return thumbStyle(ctx, c, th, bg, bm);
  if (bg) drawBg(ctx, bg, W, H, Math.max(0.25, story.media?.dim ?? 0.5), bm);
  const shade = ctx.createLinearGradient(0, 0, 0, H);
  shade.addColorStop(0, 'rgba(0,0,0,.35)'); shade.addColorStop(0.5, 'rgba(0,0,0,.15)'); shade.addColorStop(1, 'rgba(0,0,0,.55)');
  ctx.fillStyle = shade; ctx.fillRect(0, 0, W, H);
  const U = RTL ? ctx : wrapCtx(ctx, true);
  ctx.save(); ctx.translate(0, L.topDy); topBar(U, c); ctx.restore();
  // العنوان بخط كبير في المساحة بين الشريط العلوي وشريط المصدر
  const text = story.headline || S.head;
  const top = L.headY + 10, bottom = L.srcY - 50, pad = 56, maxW = W - 120 - pad * 2 - 20;
  let size = L.vert ? 140 : H >= 1300 ? 118 : H >= 1070 && W < 1500 ? 104 : 96, lines;
  for (; size >= 48; size -= 4) {
    U.font = font(size, 800);
    lines = wrap(U, text, maxW);
    if (lines.length * size * 1.3 + pad * 2 <= bottom - top) break;
  }
  const lh = size * 1.3, h = lines.length * lh + pad * 2, y = top + Math.max(0, (bottom - top - h) / 2);
  U.fillStyle = 'rgba(8,12,26,.62)'; rrect(U, 60, y, W - 120, h, 40); U.fill();
  U.fillStyle = story.template === 'breaking' ? '#e5484d' : cat.color; rrect(U, W - 60 - 20, y + 28, 20, h - 56, 10); U.fill();
  U.fillStyle = '#fff'; U.textAlign = 'right'; U.direction = 'rtl'; U.textBaseline = 'middle'; U.font = font(size, 800);
  lines.forEach((l, i) => U.fillText(l, W - 60 - pad - 20, y + pad + lh * (i + 0.5)));
  sourceBar(U, c);
  drawLogo(U, st);
}

// 🖼 أشكال الثمبنيل: bold (نص ضخم بإطار + كلمة ملوّنة) / split (صورة + لوح لون) / breaking (عاجل) / minimal
// th = reel.thumb {style, text, hi, sub, tag}. النص القصير (2-5 كلمات) غير عنوان الخبر الطويل
export const THUMB_STYLES = { news: 'كارت خبر (العنوان كامل)', bold: 'نص ضخم وكلمة ملوّنة (يوتيوب)', split: 'نص ولوح لون جنب الصورة', breaking: 'عاجل أحمر', minimal: 'هادي وأنيق' };
function thumbStyle(ctx, c, th, bg, bm) {
  const { story, cat } = c;
  const U = RTL ? ctx : wrapCtx(ctx, true);
  const accent = th.style === 'breaking' ? '#e5484d' : cat.color;
  const text = (th.text || story.headline || S.head).trim();
  const vert = H > W;
  // المساحة اللي فيها الصورة
  let ix = 0, iy = 0, iw = W, ih = H;
  if (th.style === 'split') { if (vert) ih = Math.round(H * 0.52); else { iw = Math.round(W * 0.5); ix = RTL ? 0 : W - iw; } }
  if (bg) {
    ctx.save(); ctx.beginPath(); ctx.rect(ix, iy, iw, ih); ctx.clip(); ctx.translate(ix, iy);
    drawBg(ctx, bg, iw, ih, th.style === 'minimal' ? 0.55 : 0.15, { ...(bm || {}), fit: 'cover' });
    ctx.restore();
  }
  // تظليل عشان النص يبان
  if (th.style === 'split') {
    U.fillStyle = '#0b1020';
    if (vert) U.fillRect(0, ih, W, H - ih); else U.fillRect(iw, 0, W - iw, H);
    U.fillStyle = accent;
    if (vert) U.fillRect(0, ih - 10, W, 14); else U.fillRect(iw - 7, 0, 14, H);
  } else {
    const g = ctx.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, 'rgba(0,0,0,.15)'); g.addColorStop(0.45, 'rgba(0,0,0,.25)'); g.addColorStop(1, th.style === 'minimal' ? 'rgba(0,0,0,.85)' : 'rgba(0,0,0,.78)');
    ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
  }
  // منطقة النص
  let tx, ty, tw, th2;
  if (th.style === 'split') { if (vert) { tx = 70; ty = ih + 150; tw = W - 140; th2 = H - ih - 150 - 230; } else { tx = iw + 60; ty = 120; tw = W - iw - 120; th2 = H - 300; } }
  else { tx = 70; tw = W - 140; th2 = vert ? H * 0.42 : H * 0.55; ty = vert ? H * 0.38 : H * 0.3; }
  if (th.style === 'minimal') { ty = vert ? H * 0.5 : H * 0.42; th2 = vert ? H * 0.3 : H * 0.42; }
  // تاج صغير فوق النص: القسم أو «عاجل»
  const tag = th.style === 'breaking' ? (th.tag || S.breaking) : (th.tag || cat.label.replace(/^\p{Extended_Pictographic}\s*/u, ''));
  U.font = font(vert ? 54 : 46, 800); U.direction = 'rtl'; U.textBaseline = 'middle'; U.textAlign = 'center';
  const tgw = U.measureText(tag).width + 64, tgh = vert ? 86 : 74, tgx = tx + tw - tgw, tgy = ty - tgh - 26;
  U.fillStyle = accent; rrect(U, tgx, tgy, tgw, tgh, th.style === 'breaking' ? 10 : tgh / 2); U.fill();
  U.fillStyle = '#fff'; U.fillText(tag, tgx + tgw / 2, tgy + tgh / 2 + 2);
  if (th.style === 'breaking') { U.beginPath(); U.arc(tgx - 30, tgy + tgh / 2, 14, 0, Math.PI * 2); U.fillStyle = '#e5484d'; U.fill(); }
  // النص الكبير: بيصغر لحد ما يدخل في 3 سطور
  const hiWords = new Set(String(th.hi || '').split(/\s+/).filter(Boolean));
  let size = th.style === 'minimal' ? (vert ? 120 : 104) : vert ? 170 : 150, lines;
  const subH = th.sub ? (vert ? 150 : 120) : 0; // مكان السطر الصغير عشان ميركبش على المصدر
  for (; size >= 56; size -= 6) {
    U.font = font(size, 900);
    lines = wrap(U, text, tw);
    if (lines.length <= 3 && lines.length * size * 1.18 + subH <= th2) break;
  }
  const lh = size * 1.18;
  U.textAlign = 'right'; U.lineJoin = 'round';
  lines.forEach((ln, i) => {
    const y = ty + lh * (i + 0.5);
    // كلمة بكلمة عشان نلوّن الكلمة المهمة
    let x = tx + tw;
    for (const w of ln.split(/\s+/)) {
      U.font = font(size, 900);
      const ww = U.measureText(w + ' ').width, hot = hiWords.has(w) || hiWords.has(w.replace(/[؟?!.,،]/g, ''));
      if (hot && th.style !== 'minimal') { U.fillStyle = th.style === 'bold' ? '#ffd60a' : accent; const sp = U.measureText(' ').width; rrect(U, x - ww + sp - 18, y - size * 0.6, ww - sp + 36, size * 1.16, 16); U.fill(); }
      // lineWidth = 0 بيتجاهله الكانفس، فبنقرر نرسم الإطار ولا لأ بمتغيّر
      const sw = th.style === 'minimal' || (hot && th.style === 'bold') ? 0 : size * 0.12;
      if (sw) { U.strokeStyle = 'rgba(0,0,0,.85)'; U.lineWidth = sw; U.strokeText(w, x, y); }
      U.fillStyle = hot && th.style !== 'minimal' ? (th.style === 'bold' ? '#111' : '#fff') : hot ? accent : '#fff';
      U.fillText(w, x, y);
      x -= ww;
    }
  });
  // سطر صغير تحت + المصدر
  let by = ty + lh * lines.length + 30;
  if (th.sub) {
    U.font = font(vert ? 52 : 42, 700); U.fillStyle = 'rgba(255,255,255,.92)'; U.textAlign = 'right';
    for (const l of wrap(U, th.sub, tw).slice(0, 2)) { U.fillText(l, tx + tw, by + 30); by += vert ? 66 : 54; }
  }
  if (story.kind === 'news' && story.sourceName) {
    const st = `${S.source}: ${story.sourceName}`;
    U.font = font(vert ? 34 : 30, 700); U.textAlign = 'right';
    const sw = U.measureText(st).width + 40, sy = H - (vert ? 150 : 90);
    U.fillStyle = 'rgba(0,0,0,.55)'; rrect(U, tx + tw - sw, sy, sw, vert ? 60 : 52, 26); U.fill();
    U.fillStyle = '#fff'; U.fillText(st, tx + tw - 20, sy + (vert ? 31 : 27));
  }
  drawLogo(U, c);
}

// 🎬 مشاهد الخبر (مونتاج): story.scenes = [{li, media}] صورة/فيديو بيبدأ من سطر li لحد المشهد اللي بعده.
// بترجع المشهد الحالي واللي قبله (للتلاشي) ووقت البداية والنهاية
export function sceneAt(st, t, idx) {
  const story = st.reel.stories[idx];
  const list = (story?.scenes || []).filter(x => x.media && (x.media.none || st.bgs?.has(x.media.id))).sort((a, b) => a.li - b.li);
  if (!list.length) return null;
  const segs = st.tl.segs.filter(s => s.storyIdx === idx && !s.clip);
  if (!segs.length) return null;
  const li = segs.reduce((a, s, i) => (t >= s.start ? i : a), 0);
  let k = 0;
  list.forEach((x, i) => { if (x.li <= li) k = i; });
  const at = n => segs[Math.min(Math.max(0, n), segs.length - 1)].start;
  const cur = list[k], next = list[k + 1];
  const start = k === 0 ? Math.min(at(cur.li), segs[0].start) : at(cur.li);
  return { cur, prev: k > 0 ? list[k - 1] : null, start, end: next ? at(next.li) : segs[segs.length - 1].end + 0.8, k };
}
// حركة «كن بيرنز»: تكبير بطيء وإزاحة، واتجاهها بيتبدّل من مشهد للتاني
// media.presenter = فيديو ظهورك (lip-sync): من غير تعتيم ولا حركة. media.none = رجوع لخلفية الخبر العادية
function drawScene(ctx, bg, m, p, k, dim, storyBg, storyMedia) {
  if (m.none) { if (storyBg) drawBg(ctx, storyBg, W, H, dim, storyMedia); return; }
  if (m.presenter) return drawBg(ctx, bg, W, H, 0, { ...m, fit: 'cover' });
  const dir = k % 2 ? -1 : 1;
  drawBg(ctx, bg, W, H, dim, { ...m, fit: m.fit || 'cover', zoom: (m.zoom || 1) * (1.04 + 0.1 * p), fx: (m.fx ?? 0.5) + dir * 0.12 * (p - 0.5), fy: (m.fy ?? 0.5) - 0.06 * (p - 0.5) });
}

// 📊 جرافيكس على الكلام: story.gfx = [{li, type: count|year|pct|text, value, unit, label}]
// بيظهر وقت السطر رقم li (من بداية الكلام لحد بعد آخره بشوية): عدّاد بيعدّ لحد الرقم، سنة، نسبة في دايرة، أو كلمة مهمة
export function gfxAt(st, t, idx) {
  const story = st.reel.stories[idx];
  const list = (story?.gfx || []).filter(g => g && !g.off && g.li >= 0);
  if (!list.length) return null;
  const segs = st.tl.segs.filter(s => s.storyIdx === idx && !s.clip);
  for (const g of list) {
    const s = segs[g.li];
    if (!s) continue;
    const end = Math.max(s.end + 0.6, s.start + 2.6);
    if (t >= s.start && t < end) return { g, start: s.start, end };
  }
  return null;
}
function gfxLayer(ctx, c, t, hb) {
  const k0 = c.tl.stories.find(x => t >= x.start && t < x.end);
  const idx = k0 && k0.idx >= 0 ? k0.idx : null;
  if (idx == null) return;
  const hit = gfxAt(c, t, idx);
  if (!hit) return;
  const { g, start, end } = hit;
  const age = t - start, left = end - t;
  const fin = easeOut(clamp01(age / 0.35)), fout = clamp01(left / 0.3), a = Math.min(fin, fout);
  if (a <= 0) return;
  const style = g.style || 'card', big = style === 'big';
  const k = (L.vert ? 1 : Math.max(0.55, H / 1700)) * (big ? 1.35 : 1);
  const cw = Math.min(W - 2 * Math.max(L.mL, L.mR) - 20, 900 * k), ch = (g.type === 'text' ? 210 : g.type === 'pct' ? 330 : 300) * k;
  const cx = L.vert ? L.capCX : W / 2;
  const top = big ? H * 0.42 - ch / 2 : L.vert ? Math.min(hb + 50, 1130 - 190 - ch) : Math.max(hb + 20 * k, H * 0.2);
  // «كبير»: الشاشة بتغمق وراه عشان الرقم يبقى هو البطل
  if (big) { ctx.save(); ctx.globalAlpha = 0.6 * a; ctx.fillStyle = '#04060c'; ctx.fillRect(0, 0, W, H); ctx.restore(); }
  const label = [g.icon, g.label].filter(Boolean).join(' ');
  const x = cx - cw / 2, y = top + (1 - fin) * 40 * k;
  const col = c.cat?.color || '#ffb224';
  ctx.save();
  ctx.globalAlpha = a;
  ctx.translate(cx, y + ch / 2); const sc = 0.9 + 0.1 * fin; ctx.scale(sc, sc); ctx.translate(-cx, -(y + ch / 2));
  // الكارت
  if (style === 'card') {
    ctx.fillStyle = 'rgba(8,10,20,.78)'; rrect(ctx, x, y, cw, ch, 34 * k); ctx.fill();
    ctx.strokeStyle = col; ctx.lineWidth = 4 * k; rrect(ctx, x, y, cw, ch, 34 * k); ctx.stroke();
    ctx.fillStyle = col; rrect(ctx, x + 40 * k, y - 6 * k, 120 * k, 12 * k, 6 * k); ctx.fill();
  } else { ctx.shadowColor = 'rgba(0,0,0,.85)'; ctx.shadowBlur = 24 * k; }
  ctx.direction = RTL ? 'rtl' : 'ltr'; ctx.textBaseline = 'middle'; ctx.textAlign = 'center';
  const raw = toLatinDigits(g.value);
  const numeric = /^-?\d+(\.\d+)?$/.test(raw);
  const dec = numeric ? (raw.split('.')[1] || '').length : 0;
  const p = easeOut(clamp01((age - 0.2) / 1.3));
  const fitFont = (txt, size, wmax, weight = 800) => { let z = size; ctx.font = font(z, weight); while (z > 30 && ctx.measureText(txt).width > wmax) { z -= 6; ctx.font = font(z, weight); } return z; };
  if (g.type === 'pct') {
    const v = numeric ? Math.max(0, Math.min(100, parseFloat(raw))) : 0;
    const r = 105 * k, rx = RTL ? x + cw - 70 * k - r : x + 70 * k + r, ry = y + ch / 2;
    ctx.lineWidth = 26 * k; ctx.strokeStyle = 'rgba(255,255,255,.14)'; ctx.beginPath(); ctx.arc(rx, ry, r, 0, Math.PI * 2); ctx.stroke();
    ctx.strokeStyle = col; ctx.lineCap = 'round'; ctx.beginPath(); ctx.arc(rx, ry, r, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * (v / 100) * p); ctx.stroke(); ctx.lineCap = 'butt';
    ctx.fillStyle = '#fff'; fitFont(fmtNum(v * p, dec) + '٪', 70 * k, r * 1.6); ctx.fillText(fmtNum(v * p, dec) + (RTL ? '٪' : '%'), rx, ry);
    const tx0 = RTL ? x + 50 * k : rx + r + 50 * k, tw = cw - 2 * r - 170 * k;
    ctx.textAlign = RTL ? 'right' : 'left';
    const tx = RTL ? rx - r - 50 * k : tx0;
    ctx.fillStyle = 'rgba(255,255,255,.92)'; fitFont(label, 50 * k, tw, 700); ctx.fillText(label, tx, ry - (g.unit ? 30 * k : 0));
    if (g.unit) { ctx.fillStyle = col; fitFont(g.unit, 40 * k, tw, 700); ctx.fillText(g.unit, tx, ry + 40 * k); }
  } else if (g.type === 'text') {
    ctx.fillStyle = col; const z = fitFont(g.value || '', 96 * k, cw - 80 * k);
    const pop = 1 + 0.12 * Math.max(0, 1 - Math.abs(age - 0.45) / 0.25);
    ctx.save(); ctx.translate(cx, y + ch * (label ? 0.42 : 0.5)); ctx.scale(pop, pop); ctx.fillText(g.value || '', 0, 0); ctx.restore();
    if (label) { ctx.fillStyle = 'rgba(255,255,255,.85)'; fitFont(label, 42 * k, cw - 80 * k, 700); ctx.fillText(label, cx, y + ch * 0.8); }
  } else {
    // count / year: الرقم كبير بيعدّ، والوحدة جنبه، والعنوان فوقه
    const isYear = g.type === 'year';
    const target = numeric ? parseFloat(raw) : 0;
    const from = isYear && numeric ? Math.max(0, target - 40) : 0;
    const cur = numeric ? from + (target - from) * p : 0;
    const txt = numeric ? (isYear ? (RTL ? Math.round(cur).toLocaleString('ar-EG', { useGrouping: false }) : String(Math.round(cur))) : fmtNum(cur, dec)) : (g.value || '');
    const full = numeric ? (isYear ? (RTL ? Math.round(target).toLocaleString('ar-EG', { useGrouping: false }) : String(Math.round(target))) : fmtNum(target, dec)) : txt;
    if (label) { ctx.fillStyle = 'rgba(255,255,255,.85)'; fitFont(label, 46 * k, cw - 80 * k, 700); ctx.fillText(label, cx, y + 62 * k); }
    const ny = y + (label ? 175 : 150) * k;
    ctx.font = font(60 * k, 800); const uw = g.unit ? ctx.measureText(g.unit).width + 24 * k : 0;
    const nz = fitFont(full, 150 * k, cw - 80 * k - uw);
    ctx.font = font(nz, 800); const nw = ctx.measureText(full).width, tot = nw + uw;
    // الرقم ناحية بداية القراءة والوحدة بعده
    ctx.textAlign = RTL ? 'right' : 'left'; ctx.fillStyle = '#fff';
    ctx.fillText(txt, RTL ? cx + tot / 2 : cx - tot / 2, ny);
    if (g.unit) { ctx.font = font(60 * k, 800); ctx.fillStyle = col; ctx.textAlign = RTL ? 'left' : 'right'; ctx.fillText(g.unit, RTL ? cx - tot / 2 : cx + tot / 2, ny + 10 * k); }
    // شريط بيتملي مع العدّ
    ctx.fillStyle = 'rgba(255,255,255,.12)'; rrect(ctx, x + 60 * k, y + ch - 46 * k, cw - 120 * k, 10 * k, 5 * k); ctx.fill();
    ctx.fillStyle = col; const bw = (cw - 120 * k) * p; rrect(ctx, RTL ? x + cw - 60 * k - bw : x + 60 * k, y + ch - 46 * k, bw, 10 * k, 5 * k); ctx.fill();
  }
  ctx.restore();
}

const PANEL_TPLS = new Set(['stat', 'map', 'proof', 'quote', 'timeline']);

// opts.settled: المعاينة الثابتة بترسم القالب بعد انتهاء حركته (الخريطة متقرّبة، الرقم نهائي)
export function drawFrame(ctx, st, t, opts = {}) {
  SAFE = st.settings?.safeZones !== false; SAFE_RTL = st.reel.lang !== 'en';
  setFormat(st.reel.format);
  setLang(st.reel.lang);
  if (ctx.canvas && (ctx.canvas.width !== W || ctx.canvas.height !== H)) { ctx.canvas.width = W; ctx.canvas.height = H; }
  const tl = st.tl;
  let k = tl.stories.findIndex(s => t >= s.start && t < s.end);
  if (k < 0) k = tl.stories.length ? (t < tl.stories[0].start ? 0 : tl.stories.length - 1) : -1;
  const ent = k >= 0 ? tl.stories[k] : null;
  if (ent?.bumper) {
    // مقدمة/خاتمة: بتاخد لون وقسم أول/آخر خبر
    const realAll = tl.stories.filter(s => s.idx >= 0);
    const ref = st.reel.stories[(ent.bumper === 'intro' ? realAll[0] : realAll[realAll.length - 1])?.idx ?? 0];
    const bcat = catFor(st, ref);
    background(ctx, bcat.color);
    const U0 = RTL ? ctx : wrapCtx(ctx, true);
    drawBumper(U0, { ...st, cat: bcat }, ent, t);
    ctx.globalAlpha = 1;
    return;
  }
  const real = tl.stories.filter(s => s.idx >= 0);
  const kr = ent ? real.indexOf(ent) : -1;
  const idx = ent ? ent.idx : Math.min(st.focusIdx ?? 0, st.reel.stories.length - 1);
  const story = st.reel.stories[idx];
  const cat = catFor(st, story);
  // دخول الخبر الجديد بتلاشي قصير، ولون الخلفية بينتقل من لون الخبر اللي قبله
  const fade = kr > 0 ? Math.min(1, (t - ent.start) / 0.3) : 1;
  const prev = kr > 0 ? catFor(st, st.reel.stories[real[kr - 1].idx]) : cat;
  const c = { ...st, story, cat, k: Math.max(0, kr), n: real.length, t, local: ent ? t - ent.start : t };
  if (opts.settled) c.local = Math.max(c.local, 3.5);
  background(ctx, lerpHex(prev.color, cat.color, fade));
  const bg = st.bgs?.get(story.id);
  const sc = sceneAt(st, t, idx);
  const dimS = story.media?.dim ?? 0.5;
  if (sc) {
    const p = Math.min(1, Math.max(0, (t - sc.start) / Math.max(1, sc.end - sc.start)));
    const fin = opts.settled ? 1 : Math.min(1, Math.max(0, (t - sc.start) / 0.45));
    if (sc.prev && fin < 1) drawScene(ctx, st.bgs.get(sc.prev.media.id), sc.prev.media, 1, sc.k - 1, dimS, bg, story.media);
    ctx.globalAlpha = sc.prev ? fin : 1;
    drawScene(ctx, st.bgs.get(sc.cur.media.id), sc.cur.media, p, sc.k, dimS, bg, story.media);
    ctx.globalAlpha = 1;
  } else if (bg) drawBg(ctx, bg, W, H, dimS, story.media);
  ctx.globalAlpha = fade;
  if (story.template === 'breaking') {
    const g = ctx.createRadialGradient(W / 2, H / 2, H * 0.35, W / 2, H / 2, H * 0.75);
    g.addColorStop(0, 'rgba(229,72,77,0)');
    g.addColorStop(1, `rgba(229,72,77,${0.16 + 0.1 * Math.abs(Math.sin(t * 3.2))})`);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);
  }
  // قوالب الكروت (رقم/خريطة/توثيق/اقتباس/خط زمني) في المقاسات غير العمودية: الكارت كبير في جنب والعنوان والكلام في الجنب التاني
  if ((!L.vert || L.safe) && PANEL_TPLS.has(story.template)) {
    panelWide(ctx, c, t, kr);
    if (st.settings?.showCredits && (sc ? sc.cur.media.credit : bg && story.media?.credit)) mediaCredit(RTL ? ctx : wrapCtx(ctx, true), sc ? sc.cur.media.credit : story.media.credit);
    ctx.globalAlpha = 1;
    progress(RTL ? ctx : wrapCtx(ctx, true), c, t);
    clipLayer(ctx, c, t);
    storyWipe(ctx, c, kr, opts);
    return;
  }
  // الإنجليزي: U = كانفس معكوس أفقيًا (نفس التصميم بالاتجاه المعاكس)، D = اتجاه نص ltr من غير عكس (الخريطة والتيكر)
  const U = RTL ? ctx : wrapCtx(ctx, true);
  const D = RTL ? ctx : wrapCtx(ctx, false);
  ctx.save();
  ctx.translate(0, L.topDy);
  topBar(U, c);
  ctx.restore();
  drawLogo(U, st);
  const hb = headline(U, c);
  if (story.template === 'stat') statPanel(U, c, hb + 30);
  else if (story.template === 'map') mapPanel(D, c, hb + 30);
  else if (story.template === 'proof') proofPanel(U, c, hb + 30);
  else if (story.template === 'quote') quotePanel(U, c, hb + 30);
  else if (story.template === 'timeline') timelinePanel(U, c, hb + 30);
  lowerThird(U, c, hb);
  if (!avatarsLayer(D, c, t, hb, kr)) captions(U, c, t, hb);
  if (!PANEL_TPLS.has(story.template)) gfxLayer(D, c, t, hb);
  ticker(D, c, t);
  sourceBar(U, c);
  // حقوق الصور على الشاشة اختيارية (مقفولة افتراضيًا): بتتكتب في وصف البوست من حزمة النشر
  if (st.settings?.showCredits && (sc ? sc.cur.media.credit : bg && story.media?.credit)) mediaCredit(U, sc ? sc.cur.media.credit : story.media.credit);
  ctx.globalAlpha = 1;
  progress(U, c, t);
  studioScene(ctx, c, t, kr);
  clipLayer(ctx, c, t);
  storyWipe(ctx, c, kr, opts);
}

// 📺 مقطع القناة اللي بتعلّق عليه: بيتعرض في إطار (مش الشاشة كلها) فوق خلفية الخبر المعتمة،
// ومعاه اسم القناة وتاريخ البث، والشريط والمصدر بيفضلوا تحت. الفيديو نفسه في st.bgs بنفس id المقطع
export function clipSegAt(st, t) { return st.tl.segs.find(s => s.clip && t >= s.start && t < s.end) || null; }
function clipLayer(ctx, c, t) {
  const seg = clipSegAt(c, t);
  if (!seg) return;
  const cl = seg.clip, v = c.bgs?.get(cl.id);
  const U = RTL ? ctx : wrapCtx(ctx, true), D = RTL ? ctx : wrapCtx(ctx, false);
  const fin = Math.min(1, (t - seg.start) / 0.25);
  ctx.save(); ctx.globalAlpha = 0.82 * fin; ctx.fillStyle = '#05070f'; ctx.fillRect(0, 0, W, H); ctx.restore();
  // الإطار: 16:9 بعرض الشاشة تقريبًا في العمودي، و72% في العريض
  const vert = H > W;
  const scale = cl.size || 1;
  const bw = Math.round((vert ? W - 80 : W * 0.72) * scale), bh = Math.round(bw * 9 / 16);
  const bx = Math.round((W - bw) / 2), by = Math.round(vert ? H * 0.3 : (H - bh) / 2 - 20);
  ctx.save();
  ctx.globalAlpha = fin;
  ctx.fillStyle = '#000'; rrect(ctx, bx - 6, by - 6, bw + 12, bh + 12, 22); ctx.fill();
  ctx.beginPath(); rrect(ctx, bx, by, bw, bh, 16); ctx.clip();
  if (v) { ctx.translate(bx, by); drawBg(ctx, v, bw, bh, 0, { fit: 'contain' }); }
  else { ctx.fillStyle = '#111'; ctx.fillRect(bx, by, bw, bh); }
  ctx.restore();
  // شارة القناة فوق الإطار + «مقطع للتعليق»
  ctx.globalAlpha = fin;
  const ch = [cl.channel || (RTL ? 'القناة' : 'Channel'), cl.date].filter(Boolean).join(' • ');
  U.font = font(vert ? 40 : 34, 800); U.direction = RTL ? 'rtl' : 'ltr'; U.textBaseline = 'middle'; U.textAlign = 'center';
  const lw = U.measureText('📺 ' + ch).width + 50, lh = vert ? 70 : 60, ly = by - lh - 22;
  U.fillStyle = '#e5484d'; rrect(U, bx + bw - lw, ly, lw, lh, lh / 2); U.fill();
  U.fillStyle = '#fff'; U.fillText('📺 ' + ch, bx + bw - lw / 2, ly + lh / 2 + 2);
  const note = RTL ? 'مقطع للتعليق' : 'Clip for commentary';
  U.font = font(vert ? 30 : 26, 700);
  const nw = U.measureText(note).width + 36;
  U.fillStyle = 'rgba(255,255,255,.14)'; rrect(U, bx, ly + 8, nw, lh - 16, (lh - 16) / 2); U.fill();
  U.fillStyle = '#fff'; U.fillText(note, bx + nw / 2, ly + lh / 2 + 2);
  // سطر تحت الإطار: كلام المتحدث لو مكتوب (ترجمة/تفريغ)، أو تلميح
  if (cl.say) {
    U.font = font(vert ? 44 : 36, 700); U.textAlign = 'center';
    const ls = wrap(U, cl.say, bw - 40).slice(0, 3), lh2 = (vert ? 44 : 36) * 1.35;
    U.fillStyle = 'rgba(0,0,0,.6)'; rrect(U, bx, by + bh + 24, bw, ls.length * lh2 + 36, 20); U.fill();
    U.fillStyle = '#fff'; ls.forEach((l, i) => U.fillText(l, W / 2, by + bh + 24 + 18 + lh2 * (i + 0.5)));
  }
  ctx.globalAlpha = 1;
  ticker(D, c, t);
}

// انتقال بين الأخبار: مسحة مايلة بلون القسم بتعدّي على الشاشة أول نص ثانية من الخبر الجديد
function storyWipe(ctx, c, kr, opts) {
  if (kr <= 0 || opts.settled || c.local > 0.5) return;
  const p = c.local / 0.5, e = p < 0.5 ? 2 * p * p : 1 - Math.pow(-2 * p + 2, 2) / 2;
  const bw = W * 0.55, sk = H * 0.18;
  const x0 = RTL ? W * 1.15 - e * (W * 1.9) : -W * 0.15 - bw + e * (W * 1.9);
  ctx.save();
  // شريط رئيسي بلون القسم + خط أبيض رفيع وراه
  const bars = [[x0, bw, c.cat.color, 0.92], [RTL ? x0 + bw + 22 : x0 - 48, 26, '#ffffff', 0.55]];
  for (const [xs, wd, col, a] of bars) {
    ctx.globalAlpha = a * Math.sin(Math.PI * p);
    ctx.fillStyle = col;
    ctx.beginPath();
    ctx.moveTo(xs + sk, 0); ctx.lineTo(xs + sk + wd, 0); ctx.lineTo(xs + wd, H); ctx.lineTo(xs, H);
    ctx.closePath(); ctx.fill();
  }
  ctx.restore();
}

// 📱 نموذج شاشة المنصة فوق المعاينة (مش بيتصدّر): بيوضّح الحتت اللي زراير تيك توك/ريلز/شورتس بتغطيها
export function drawGuide(ctx, kind) {
  if (!kind) return;
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.direction = 'ltr'; ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
  if (H >= 1900) {
    // مناطق غير آمنة (أحمر خفيف)
    ctx.fillStyle = 'rgba(255,40,40,.14)';
    ctx.fillRect(0, 0, W, 150); ctx.fillRect(0, H - 430, W, 430); ctx.fillRect(W - 150, 860, 150, H - 430 - 860);
    ctx.setLineDash([18, 12]); ctx.lineWidth = 4; ctx.strokeStyle = 'rgba(255,90,90,.85)';
    ctx.strokeRect(50, 150, W - 200, H - 580); ctx.setLineDash([]);
    // الزراير على اليمين
    const icons = kind === 'shorts' ? ['👍', '👎', '💬', '↗', '🔁'] : kind === 'reels' ? ['♥', '💬', '➤', '⋯'] : ['●', '♥', '💬', '🔖', '↗'];
    icons.forEach((ic, i) => {
      const y = 980 + i * 135;
      ctx.fillStyle = 'rgba(0,0,0,.35)'; ctx.beginPath(); ctx.arc(W - 75, y, 44, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#fff'; ctx.font = '700 40px sans-serif'; ctx.textAlign = 'center'; ctx.fillText(ic, W - 75, y + 2);
      if (kind !== 'shorts' || i < 3) { ctx.font = '600 24px sans-serif'; ctx.fillText(['12.3K', '845', '1.2K', '320', '99'][i] || '', W - 75, y + 62); }
    });
    // الاسم والوصف تحت
    const g = ctx.createLinearGradient(0, H - 520, 0, H); g.addColorStop(0, 'rgba(0,0,0,0)'); g.addColorStop(1, 'rgba(0,0,0,.6)');
    ctx.fillStyle = g; ctx.fillRect(0, H - 520, W, 520);
    ctx.textAlign = 'left'; ctx.fillStyle = '#fff'; ctx.font = '800 38px sans-serif';
    ctx.fillText(kind === 'shorts' ? '@yourchannel   [Subscribe]' : '@yourchannel', 40, H - (kind === 'tiktok' ? 330 : 280));
    ctx.font = '500 30px sans-serif'; ctx.fillStyle = 'rgba(255,255,255,.92)';
    ctx.fillText('Caption text of the post goes here… #news', 40, H - (kind === 'tiktok' ? 275 : 225));
    ctx.fillText('♪ original sound', 40, H - (kind === 'tiktok' ? 222 : 172));
    if (kind === 'tiktok') { ctx.fillStyle = 'rgba(0,0,0,.85)'; ctx.fillRect(0, H - 130, W, 130); ctx.fillStyle = '#fff'; ctx.font = '600 28px sans-serif'; ['Home', 'Friends', '＋', 'Inbox', 'Profile'].forEach((x, i) => { ctx.textAlign = 'center'; ctx.fillText(x, W * (0.1 + i * 0.2), H - 65); }); }
    // فوق
    ctx.textAlign = 'center'; ctx.fillStyle = '#fff'; ctx.font = '700 36px sans-serif';
    ctx.fillText(kind === 'tiktok' ? 'Following   |   For You' : kind === 'reels' ? 'Reels' : 'Shorts', kind === 'tiktok' ? W / 2 : 140, 95);
  } else {
    // باقي المقاسات: هامش آمن بسيط + شريط تقدّم المشغّل تحت
    ctx.setLineDash([18, 12]); ctx.lineWidth = 4; ctx.strokeStyle = 'rgba(255,90,90,.85)';
    ctx.strokeRect(W * 0.04, H * 0.05, W * 0.92, H * 0.88); ctx.setLineDash([]);
    ctx.fillStyle = 'rgba(255,40,40,.14)'; ctx.fillRect(0, H * 0.93, W, H * 0.07);
    ctx.fillStyle = '#fff'; ctx.font = '600 28px sans-serif'; ctx.fillText('▶  0:12 / 1:05', 30, H - 30);
  }
  ctx.restore();
}

// ارتفاع الكارت في التصميم العمودي (عرض 1080)
function panelH(st) {
  const tpl = st.story.template;
  if (tpl === 'proof') { const n = Math.max(1, proofSources(st.story).length); return (PROOF_COLOR[st.story.proof?.status] ? 90 : 0) + n * 290 - 20 + 10; }
  return { stat: 580, quote: 540, timeline: 600, map: 620 }[tpl] || 600;
}
// الكارت بيترسم بتصميمه العمودي (1080 عرض) جوّه مستطيل r ومتكبّر على قده
function panelInto(ctx, st, r) {
  const fw = W, fh = H, fl = L, vh = panelH(st);
  const s = Math.min(r.w / 1080, r.h / vh);
  ctx.save();
  ctx.translate(r.x + (r.w - 1080 * s) / 2, r.y + (r.h - vh * s) / 2);
  ctx.scale(s, s);
  W = 1080; H = 1920;
  { const sv = SAFE; SAFE = false; L = layoutFor(W, H); SAFE = sv; } // الكارت نفسه بتصميمه العمودي العادي
  const U = RTL ? ctx : wrapCtx(ctx, true), D = RTL ? ctx : wrapCtx(ctx, false);
  const tpl = st.story.template;
  if (tpl === 'stat') statPanel(U, st, 0);
  else if (tpl === 'map') mapPanel(D, st, 0);
  else if (tpl === 'proof') proofPanel(U, st, 0);
  else if (tpl === 'quote') quotePanel(U, st, 0);
  else if (tpl === 'timeline') timelinePanel(U, st, 0);
  ctx.restore();
  W = fw; H = fh; L = fl;
}
// العريض والمربع: عمودين (الكلام ناحية بداية القراءة، الكارت في الناحية التانية). الطولي 4:5: الكارت بين العنوان والكابشن
var CAP_CY = 0;
function panelWide(ctx, c, t) {
  const fw = W, fh = H, fl = L;
  const U0 = RTL ? ctx : wrapCtx(ctx, true), D0 = RTL ? ctx : wrapCtx(ctx, false);
  ctx.save();
  ctx.translate(0, L.topDy);
  topBar(U0, c);
  ctx.restore();
  drawLogo(U0, c);
  const tk = !!c.reel.ticker?.on;
  if (W >= H) {
    const colW = Math.round(W * (W > H ? 0.42 : 0.46));
    const colX = RTL ? W - colW : 0;
    const bot = (tk ? L.tickY : H - 70) - 20, top = L.headY + L.topDy;
    panelInto(ctx, c, { x: RTL ? 30 : colW, y: top, w: W - colW - 30, h: bot - top });
    ctx.save();
    ctx.translate(colX, 0);
    W = colW; L = layoutFor(colW, fh);
    const U = RTL ? ctx : wrapCtx(ctx, true);
    const hb = headline(U, c);
    captions(U, c, t, hb);
    sourceBar(U, c);
    ctx.restore();
    W = fw; H = fh; L = fl;
  } else {
    const hb = headline(U0, c);
    const disc = c.story.category === 'health' || c.story.category === 'healthtech';
    const bot = (tk ? L.tickY : disc ? L.srcY - 96 : L.srcY) - 20;
    const capH = Math.round(190 * L.capScale) + (c.hasB ? 50 : 0);
    panelInto(ctx, c, L.safe ? { x: L.mL, y: hb + 16, w: W - L.mL - L.mR, h: bot - capH - hb - 16 } : { x: 40, y: hb + 16, w: W - 80, h: bot - capH - hb - 16 });
    CAP_CY = bot - capH / 2;
    captions(U0, c, t, hb);
    CAP_CY = 0;
    sourceBar(U0, c);
  }
  ticker(D0, c, t);
}

// مشهد الاستوديو: بيغطي الإطار كله أول كام ثانية (ديكور + إضاءة + كاميرا)، وبعدين زووم خاطف للخبر
function studioScene(ctx, st, t, kr) {
  const av = st.reel.avatars;
  if (!av?.on || (av.scene || 'studio') !== 'studio' || kr !== 0 || PANEL_TPLS.has(st.story.template)) return;
  const win = avatarWindow(st.tl, Math.max(2, Math.min(20, Number(av.seconds) || 6)));
  if (t < win.t0 || t > win.t1) return;
  const photos = {};
  for (const k of ['A', 'B']) photos[k] = { img: st.avImgs?.[k], ...(st.settings?.avPhotos?.[k] || {}) };
  drawStudio(ctx, W, H, {
    t, win, tl: st.tl, who: av.who, mode: av.mode, photos, mouth: mouthAt(st.tl, t), color: st.cat.color,
    channel: st.settings?.channelName || '', headline: st.story.headline || '', catLabel: RTL ? st.cat.label : (st.cat.en || st.cat.label),
    logo: st.logo, rtl: RTL, skin: av.skin, hijab: !!av.hijab, beard: !!av.beard, font,
  });
}
