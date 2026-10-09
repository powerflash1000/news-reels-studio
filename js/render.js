// رسم إطار الريل على canvas (مقاس 1080×1920). نفس الدالة للمعاينة والتصدير.
import { MED_DISCLAIMER, phrases } from './reel.js';
import { hostOf } from './feeds.js';

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
  ctx.fillStyle = st.cat.color;
  rrect(ctx, W - 60 - w, 90, w, 84, 42);
  ctx.fill();
  ctx.fillStyle = '#fff';
  ctx.textAlign = 'center';
  ctx.fillText(label, W - 60 - w / 2, 133);
  const name = [st.settings.channelName, st.settings.handle].filter(Boolean).join('  ');
  if (name) {
    ctx.textAlign = 'left';
    ctx.direction = 'ltr';
    ctx.font = font(36, 600);
    ctx.fillStyle = 'rgba(255,255,255,.8)';
    ctx.fillText(name, 60, 133);
  }
}

function headline(ctx, st) {
  const text = st.reel.headline || 'اكتب عنوان الريل';
  const pad = 48, maxW = W - 120 - pad * 2 - 16;
  let size = 76, lines;
  for (; size >= 48; size -= 6) {
    ctx.font = font(size, 800);
    lines = wrap(ctx, text, maxW);
    if (lines.length <= 4) break;
  }
  const lh = size * 1.35, h = lines.length * lh + pad * 2;
  const y = 250;
  ctx.fillStyle = 'rgba(255,255,255,.07)';
  rrect(ctx, 60, y, W - 120, h, 36);
  ctx.fill();
  ctx.fillStyle = st.cat.color;
  rrect(ctx, W - 60 - 16, y + 24, 16, h - 48, 8);
  ctx.fill();
  ctx.fillStyle = '#fff';
  ctx.textAlign = 'right';
  ctx.direction = 'rtl';
  ctx.textBaseline = 'middle';
  ctx.font = font(size, 800);
  lines.forEach((l, i) => ctx.fillText(l, W - 60 - pad - 16, y + pad + lh * (i + 0.5)));
  if (st.reel.claimKind === 'opinion') {
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
  const size = 84;
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
  const lh = size * 1.5, y0 = 1130 - (rows.length * lh) / 2;
  if (st.hasB) {
    ctx.font = font(34, 700);
    ctx.fillStyle = seg.speaker === 'B' ? '#ffb86b' : hexA(st.cat.color, 1);
    ctx.textAlign = 'center';
    ctx.fillText(seg.speaker === 'B' ? 'المذيع ب' : 'المذيع أ', W / 2, y0 - 60);
    ctx.font = font(size, 800);
  }
  rows.forEach((row, ri) => {
    const total = row.reduce((n, w, i) => n + w.ww + (i ? space : 0), 0);
    let x = W / 2 + total / 2; // RTL: أول كلمة على اليمين
    for (const w of row) {
      const active = t >= w.s && t < w.e + 0.02;
      const past = t >= w.e;
      ctx.textAlign = 'right';
      if (active) {
        ctx.fillStyle = hexA(st.cat.color, 0.9);
        rrect(ctx, x - w.ww - 14, y0 + ri * lh + lh / 2 - size * 0.62, w.ww + 28, size * 1.24, 18);
        ctx.fill();
      }
      ctx.fillStyle = active ? '#fff' : past ? '#fff' : 'rgba(255,255,255,.5)';
      ctx.fillText(w.w, x, y0 + ri * lh + lh / 2);
      x -= w.ww + space;
    }
  });
}

function sourceBar(ctx, st) {
  const r = st.reel;
  const y = 1560, h = 260;
  if (st.reel.category === 'health') {
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

function progress(ctx, st, t) {
  ctx.fillStyle = 'rgba(255,255,255,.12)';
  ctx.fillRect(0, H - 14, W, 14);
  ctx.fillStyle = st.cat.color;
  const p = Math.min(1, t / st.tl.duration);
  ctx.fillRect(W - W * p, H - 14, W * p, 14);
}

export function drawFrame(ctx, st, t) {
  background(ctx, st.cat.color);
  topBar(ctx, st);
  headline(ctx, st);
  captions(ctx, st, t);
  sourceBar(ctx, st);
  progress(ctx, st, t);
}
