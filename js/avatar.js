// مذيعين 2D (راجل / ست) بمزامنة شفايف من صوت الحلقة نفسه. كله رسم بالكود: مفيش صور ولا حقوق.

const SKINS = { l: ['#f3d2b8', '#e2b896'], m: ['#e0ad82', '#c98f63'], d: ['#a8714a', '#8b5a38'] };

/* ---------- مزامنة الشفايف ---------- */
const envCache = new WeakMap();
const STEP = 0.01;
function envelope(buf) {
  let e = envCache.get(buf);
  if (e) return e;
  const d = buf.getChannelData(0), win = Math.max(1, Math.round(buf.sampleRate * STEP)), n = Math.floor(d.length / win);
  const env = new Float32Array(n);
  for (let i = 0; i < n; i++) { let s = 0; for (let j = i * win; j < (i + 1) * win; j++) s += d[j] * d[j]; env[i] = Math.sqrt(s / win); }
  const sorted = [...env].filter(v => v > 1e-4).sort((a, b) => a - b);
  const ref = (sorted[Math.floor(sorted.length * 0.92)] || 0.05) * 1.1;
  e = { env, ref };
  envCache.set(buf, e);
  return e;
}

// بيرجّع { open: 0..1, speaker } للحظة t على خط الحلقة
export function mouthAt(tl, t) {
  let open = 0, real = false;
  for (const s of tl.segs) {
    const b = s.buffer;
    if (typeof b?.getChannelData !== 'function') continue;
    const rel = t - s.at;
    if (rel < 0 || rel > b.duration) continue;
    real = true;
    const { env, ref } = envelope(b);
    const i = Math.floor(rel / STEP);
    let m = 0;
    for (let k = Math.max(0, i - 2); k <= Math.min(env.length - 1, i + 2); k++) m = Math.max(m, env[k]);
    open = Math.max(open, Math.min(1, Math.pow(m / ref, 0.7)));
  }
  const seg = tl.segs.find(s => t >= s.start - 0.05 && t <= s.end + 0.2) || null;
  if (!real && seg) {
    // من غير صوت حقيقي (معاينة صامتة): تحريك تقديري على توقيت الكلمات
    const w = seg.words?.find(x => t >= x.s && t < x.e);
    if (w) open = 0.3 + 0.5 * Math.abs(Math.sin((t - w.s) * 17));
  }
  return { open, speaker: seg?.speaker || null };
}

// نافذة ظهور المذيعين: من أول كلام لحد "seconds" ثانية، وبتكمّل لآخر الجملة لو قريب
export function avatarWindow(tl, seconds) {
  tl._avw ||= {};
  const key = String(seconds);
  if (tl._avw[key]) return tl._avw[key];
  const segs = [...tl.segs].sort((a, b) => a.start - b.start);
  let w = null;
  if (segs.length) {
    const t0 = Math.max(0, segs[0].start - 0.3), target = segs[0].start + seconds;
    const hit = segs.find(s => target >= s.start && target <= s.end);
    w = { t0, t1: hit && hit.end - target <= 4 ? hit.end + 0.15 : target };
  }
  return (tl._avw[key] = w || { t0: 0, t1: 0 });
}

/* ---------- الرسم (مساحة تصميم 400×520 لكل مذيع) ---------- */
const clamp01 = v => Math.max(0, Math.min(1, v));
function shade(hex, k) {
  const n = parseInt(hex.slice(1), 16), f = c => Math.max(0, Math.min(255, Math.round(c * k)));
  return `rgb(${f(n >> 16)},${f((n >> 8) & 255)},${f(n & 255)})`;
}

function eyes(ctx, t, seed, cy, gap, woman) {
  const ph = (t + seed) % 3.6, blink = ph < 0.12 ? Math.abs(ph - 0.06) / 0.06 : 1;
  const look = Math.sin(t * 0.7 + seed) * 3;
  for (const dx of [-gap, gap]) {
    const x = 200 + dx;
    ctx.fillStyle = '#fff';
    ctx.beginPath(); ctx.ellipse(x, cy, 17, 12 * blink + 0.5, 0, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#2a1b14';
    ctx.beginPath(); ctx.ellipse(x + look, cy, 7.5, 8 * blink + 0.4, 0, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = '#1b120d'; ctx.lineWidth = woman ? 4 : 3; ctx.lineCap = 'round';
    ctx.beginPath(); ctx.ellipse(x, cy, 17, 12 * blink + 0.5, 0, Math.PI * 1.05, Math.PI * 1.95); ctx.stroke();
    // الحواجب
    ctx.lineWidth = woman ? 5 : 8;
    ctx.beginPath(); ctx.moveTo(x - 20, cy - 26 + (dx < 0 ? 2 : 0)); ctx.quadraticCurveTo(x, cy - 36, x + 20, cy - 26 + (dx < 0 ? 0 : 2)); ctx.stroke();
  }
}

function mouth(ctx, cx, cy, open, t, lip) {
  const talk = open > 0.08;
  const w = 38 + 18 * open + (talk ? 6 * Math.sin(t * 19) : 0);
  if (!talk) {
    ctx.strokeStyle = lip; ctx.lineWidth = 6; ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(cx - w * 0.75, cy); ctx.quadraticCurveTo(cx, cy + 9, cx + w * 0.75, cy); ctx.stroke();
    return;
  }
  const h = 6 + 40 * open;
  ctx.fillStyle = '#4a1620';
  ctx.beginPath(); ctx.ellipse(cx, cy + h * 0.2, w * 0.62, h, 0, 0, Math.PI * 2); ctx.fill();
  ctx.save();
  ctx.beginPath(); ctx.ellipse(cx, cy + h * 0.2, w * 0.62, h, 0, 0, Math.PI * 2); ctx.clip();
  if (open > 0.3) { ctx.fillStyle = '#fff'; ctx.fillRect(cx - w * 0.6, cy + h * 0.2 - h, w * 1.2, h * 0.38); }
  ctx.fillStyle = '#d96a78';
  ctx.beginPath(); ctx.ellipse(cx, cy + h * 1.0, w * 0.4, h * 0.5, 0, 0, Math.PI * 2); ctx.fill();
  ctx.restore();
  ctx.strokeStyle = lip; ctx.lineWidth = 7; ctx.lineCap = 'round';
  ctx.beginPath(); ctx.ellipse(cx, cy + h * 0.2, w * 0.62, h, 0, 0, Math.PI * 2); ctx.stroke();
}

function drawMan(ctx, o) {
  const [skin, skinD] = SKINS[o.skin] || SKINS.m;
  const bob = Math.sin(o.t * 1.5 + 1) * 3 + o.open * 3;
  // الجسم
  ctx.fillStyle = '#26304d';
  ctx.beginPath(); ctx.moveTo(30, 540); ctx.quadraticCurveTo(40, 380, 130, 352); ctx.lineTo(270, 352); ctx.quadraticCurveTo(360, 380, 370, 540); ctx.closePath(); ctx.fill();
  ctx.fillStyle = '#f2f4f8';
  ctx.beginPath(); ctx.moveTo(158, 352); ctx.lineTo(242, 352); ctx.lineTo(200, 440); ctx.closePath(); ctx.fill();
  ctx.fillStyle = o.color;
  ctx.beginPath(); ctx.moveTo(190, 372); ctx.lineTo(210, 372); ctx.lineTo(218, 470); ctx.lineTo(200, 492); ctx.lineTo(182, 470); ctx.closePath(); ctx.fill();
  ctx.fillStyle = '#1c2540';
  ctx.beginPath(); ctx.moveTo(130, 352); ctx.lineTo(176, 352); ctx.lineTo(196, 430); ctx.lineTo(150, 540); ctx.lineTo(112, 540); ctx.quadraticCurveTo(116, 400, 130, 352); ctx.fill();
  ctx.beginPath(); ctx.moveTo(270, 352); ctx.lineTo(224, 352); ctx.lineTo(204, 430); ctx.lineTo(250, 540); ctx.lineTo(288, 540); ctx.quadraticCurveTo(284, 400, 270, 352); ctx.fill();
  ctx.save(); ctx.translate(0, bob);
  ctx.fillStyle = skinD; ctx.fillRect(168, 300, 64, 70);
  ctx.fillStyle = skin;
  for (const x of [108, 292]) { ctx.beginPath(); ctx.ellipse(x, 215, 15, 26, 0, 0, Math.PI * 2); ctx.fill(); }
  ctx.beginPath(); ctx.ellipse(200, 205, 92, 112, 0, 0, Math.PI * 2); ctx.fill();
  if (o.beard) {
    ctx.fillStyle = '#2a1d17';
    ctx.beginPath(); ctx.moveTo(110, 225); ctx.quadraticCurveTo(112, 330, 200, 330); ctx.quadraticCurveTo(288, 330, 290, 225); ctx.quadraticCurveTo(268, 262, 245, 262); ctx.quadraticCurveTo(200, 250, 155, 262); ctx.quadraticCurveTo(132, 262, 110, 225); ctx.fill();
  }
  // الشعر
  ctx.fillStyle = '#2a1d17';
  ctx.beginPath(); ctx.moveTo(106, 200); ctx.quadraticCurveTo(100, 84, 200, 84); ctx.quadraticCurveTo(300, 84, 294, 200); ctx.quadraticCurveTo(282, 140, 240, 128); ctx.quadraticCurveTo(190, 150, 150, 128); ctx.quadraticCurveTo(116, 140, 106, 200); ctx.fill();
  eyes(ctx, o.t, o.seed, 200, 42, false);
  ctx.strokeStyle = shade(skin.length === 7 ? skin : '#e0ad82', 0.78); ctx.lineWidth = 4; ctx.lineCap = 'round';
  ctx.beginPath(); ctx.moveTo(200, 205); ctx.quadraticCurveTo(190, 245, 204, 248); ctx.stroke();
  mouth(ctx, 200, 285, o.open, o.t, o.beard ? '#6b3a32' : '#b5575e');
  ctx.restore();
}

function drawWoman(ctx, o) {
  const [skin, skinD] = SKINS[o.skin] || SKINS.m;
  const bob = Math.sin(o.t * 1.4 + 2) * 3 + o.open * 3;
  const cloth = shade(o.color, 0.75), scarf = shade(o.color, 0.9);
  if (!o.hijab) {
    // الشعر الطويل ورا الراس
    ctx.save(); ctx.translate(0, bob);
    ctx.fillStyle = '#3a2418';
    ctx.beginPath(); ctx.moveTo(100, 200); ctx.quadraticCurveTo(92, 70, 200, 70); ctx.quadraticCurveTo(308, 70, 300, 200); ctx.quadraticCurveTo(326, 330, 292, 420); ctx.lineTo(108, 420); ctx.quadraticCurveTo(74, 330, 100, 200); ctx.fill();
    ctx.restore();
  }
  // الجسم
  ctx.fillStyle = cloth;
  ctx.beginPath(); ctx.moveTo(34, 540); ctx.quadraticCurveTo(44, 384, 134, 356); ctx.lineTo(266, 356); ctx.quadraticCurveTo(356, 384, 366, 540); ctx.closePath(); ctx.fill();
  ctx.fillStyle = '#f6f1ee';
  ctx.beginPath(); ctx.moveTo(150, 356); ctx.quadraticCurveTo(200, 430, 250, 356); ctx.closePath(); ctx.fill();
  if (o.hijab) {
    ctx.fillStyle = scarf;
    ctx.beginPath(); ctx.moveTo(110, 370); ctx.quadraticCurveTo(200, 470, 290, 370); ctx.lineTo(330, 440); ctx.quadraticCurveTo(200, 520, 70, 440); ctx.closePath(); ctx.fill();
  }
  ctx.save(); ctx.translate(0, bob);
  if (!o.hijab) { ctx.fillStyle = skinD; ctx.fillRect(172, 300, 56, 70); }
  if (o.hijab) {
    ctx.fillStyle = scarf;
    ctx.beginPath(); ctx.moveTo(86, 230); ctx.quadraticCurveTo(70, 60, 200, 62); ctx.quadraticCurveTo(330, 60, 314, 230); ctx.quadraticCurveTo(326, 340, 270, 392); ctx.lineTo(130, 392); ctx.quadraticCurveTo(74, 340, 86, 230); ctx.fill();
  }
  ctx.fillStyle = skin;
  ctx.beginPath(); ctx.ellipse(200, 208, o.hijab ? 82 : 86, o.hijab ? 102 : 106, 0, 0, Math.PI * 2); ctx.fill();
  if (!o.hijab) {
    ctx.fillStyle = '#3a2418';
    ctx.beginPath(); ctx.moveTo(112, 210); ctx.quadraticCurveTo(104, 96, 200, 96); ctx.quadraticCurveTo(296, 96, 288, 210); ctx.quadraticCurveTo(272, 150, 226, 140); ctx.quadraticCurveTo(160, 150, 112, 210); ctx.fill();
  } else {
    ctx.fillStyle = scarf;
    ctx.beginPath(); ctx.moveTo(116, 190); ctx.quadraticCurveTo(200, 96, 284, 190); ctx.quadraticCurveTo(250, 130, 200, 128); ctx.quadraticCurveTo(150, 130, 116, 190); ctx.fill();
  }
  eyes(ctx, o.t, o.seed + 1.3, 205, 38, true);
  ctx.strokeStyle = shade('#e0ad82', 0.78); ctx.lineWidth = 3.5; ctx.lineCap = 'round';
  ctx.beginPath(); ctx.moveTo(200, 212); ctx.quadraticCurveTo(192, 244, 203, 246); ctx.stroke();
  mouth(ctx, 200, 285, o.open, o.t, '#c2415a');
  ctx.restore();
}

// box: المساحة على الشاشة. opts: { who: both|m|f, t, mouth:{open,speaker}, appear, skin, hijab, beard, color, rtl, hasB }
export function drawAvatars(ctx, box, opts) {
  const { who, appear, mouth: mo, rtl } = opts;
  if (appear <= 0.01) return;
  ctx.save();
  ctx.beginPath(); ctx.rect(box.x, box.y, box.w, box.h); ctx.clip();
  ctx.globalAlpha *= appear;
  // خلفية الاستوديو
  const g = ctx.createLinearGradient(0, box.y, 0, box.y + box.h);
  g.addColorStop(0, 'rgba(255,255,255,.07)'); g.addColorStop(1, 'rgba(0,0,0,.35)');
  ctx.fillStyle = g;
  ctx.fillRect(box.x, box.y, box.w, box.h);
  ctx.translate(0, (1 - appear) * box.h * 0.3);
  const both = who === 'both';
  const people = both ? ['m', 'f'] : [who === 'f' ? 'f' : 'm'];
  const slotW = box.w / people.length;
  const sc = Math.min(box.h / 470, (slotW * 0.96) / 400);
  people.forEach((kind, i) => {
    // المذيع أ (الراجل) على اليمين في العربي، وبيتعكس في الإنجليزي
    const slot = rtl ? people.length - 1 - i : i;
    const cx = box.x + slotW * (slot + 0.5);
    const speaking = !both || (kind === 'm' ? mo.speaker !== 'B' : mo.speaker === 'B');
    const open = speaking ? mo.open : 0;
    const k = both && !speaking ? 0.93 : 1;
    ctx.save();
    ctx.globalAlpha *= both && !speaking ? 0.88 : 1;
    ctx.translate(cx - 200 * sc * k, box.y + box.h - 520 * sc * k + (both && !speaking ? 14 : 0));
    ctx.scale(sc * k, sc * k);
    (kind === 'm' ? drawMan : drawWoman)(ctx, { ...opts, open, seed: kind === 'm' ? 0.4 : 1.9 });
    ctx.restore();
  });
  ctx.restore();
}
