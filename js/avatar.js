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

// مذيع بصورة حقيقية: الفم بيتفتح بتحريك الفك (الجزء اللي تحت الفم بينزل وبيتمط الجلد حواليه) ومعاه تجويف الفم
// photo = { img, mx, my, mw }: مكان مركز الفم ونسبة عرضه (من عرض الصورة)
export function drawPhoto(ctx, o) {
  const p = o.photo, img = p.img;
  const iw = img.naturalWidth || img.width, ih = img.naturalHeight || img.height;
  const fx = 20, fy = 20, fw = 360, fh = 480;
  // صورة مقصوصة (PNG بخلفية شفافة): بتتحط كاملة وقاعدها تحت، من غير إطار، فتبان قاعدة في الاستوديو
  const cut = !!img.cutout;
  const s = cut ? Math.min(fw / iw, fh / ih) * 1.1 : Math.max(fw / iw, fh / ih), dw = iw * s, dh = ih * s, ox = fx + (fw - dw) / 2, oy = cut ? fy + fh - dh + 40 : fy + (fh - dh) / 2;
  const open = o.open || 0;
  const mwPx = p.mw * iw * s, drop = open * mwPx * 0.28;
  const mySrc = p.my * ih, mxD = ox + p.mx * iw * s, myD = oy + mySrc * s;
  const band = Math.min(p.mw * iw * 0.4, ih * 0.07);
  const y1 = Math.max(0, mySrc - band), y2 = Math.min(ih, mySrc + band);
  ctx.save();
  if (!cut) { ctx.beginPath(); ctx.roundRect(fx, fy, fw, fh, 36); ctx.clip(); ctx.fillStyle = '#10151f'; ctx.fillRect(fx, fy, fw, fh); }
  const breathe = Math.sin(o.t * 1.3 + (o.seed || 0)) * 2.5 + open * 2;
  ctx.translate(0, breathe);
  if (y1 > 0) ctx.drawImage(img, 0, 0, iw, y1, ox, oy, dw, y1 * s);
  ctx.drawImage(img, 0, y1, iw, y2 - y1, ox, oy + y1 * s, dw, (y2 - y1) * s + drop);
  if (y2 < ih) ctx.drawImage(img, 0, y2, iw, ih - y2, ox, oy + y2 * s + drop, dw, (ih - y2) * s);
  if (open > 0.06) {
    const cx = mxD, cy = myD + drop * 0.45, rx = mwPx * 0.36 * (0.75 + 0.25 * open), ry = drop * 0.5 + mwPx * 0.025;
    ctx.fillStyle = '#35101a';
    ctx.beginPath(); ctx.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2); ctx.fill();
    ctx.save();
    ctx.beginPath(); ctx.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2); ctx.clip();
    if (open > 0.35) { ctx.fillStyle = '#f4f0ea'; ctx.fillRect(cx - rx, cy - ry, rx * 2, ry * 0.5); }
    ctx.fillStyle = '#b8505f';
    ctx.beginPath(); ctx.ellipse(cx, cy + ry * 0.85, rx * 0.6, ry * 0.5, 0, 0, Math.PI * 2); ctx.fill();
    ctx.restore();
    ctx.strokeStyle = 'rgba(120,40,50,.55)'; ctx.lineWidth = Math.max(2, mwPx * 0.025);
    ctx.beginPath(); ctx.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2); ctx.stroke();
  }
  ctx.restore();
  if (cut || o.noFrame) return;
  ctx.strokeStyle = o.color || '#fff'; ctx.lineWidth = 6;
  ctx.beginPath(); ctx.roundRect(fx, fy, fw, fh, 36); ctx.stroke();
}

// معاينة المعايرة في كانفس صغير
export function drawPhotoPreview(canvas, photo, open = 0, color = '#e5484d') {
  const c = canvas.getContext('2d');
  const w = canvas.width, sc = w / 400;
  canvas.height = Math.round(520 * sc);
  c.clearRect(0, 0, canvas.width, canvas.height);
  if (!photo?.img) return;
  c.save(); c.scale(sc, sc);
  drawPhoto(c, { photo, open, t: 0, color });
  c.restore();
}

// ضغطة على كانفس المعاينة (px,py بوحدات الكانفس) → مكان على الصورة كنسبة (0..1)
export function previewToImage(canvas, photo, px, py) {
  const img = photo.img, iw = img.naturalWidth || img.width, ih = img.naturalHeight || img.height;
  const sc = canvas.width / 400, fx = 20, fy = 20, fw = 360, fh = 480;
  const s = Math.max(fw / iw, fh / ih), ox = fx + (fw - iw * s) / 2, oy = fy + (fh - ih * s) / 2;
  const clamp = v => Math.max(0.02, Math.min(0.98, v));
  return { mx: clamp((px / sc - ox) / (iw * s)), my: clamp((py / sc - oy) / (ih * s)) };
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
    const ph = opts.mode === 'photo' ? opts.photos?.[kind === 'm' ? 'A' : 'B'] : null;
    if (ph?.img) drawPhoto(ctx, { ...opts, photo: ph, open, seed: kind === 'm' ? 0.4 : 1.9 });
    else (kind === 'm' ? drawMan : drawWoman)(ctx, { ...opts, open, seed: kind === 'm' ? 0.4 : 1.9 });
    ctx.restore();
  });
  ctx.restore();
}

/* ---------- مشهد استوديو أخبار: ديكور + إضاءة + حركة كاميرا ---------- */
const ease = p => (p < 0.5 ? 2 * p * p : 1 - Math.pow(-2 * p + 2, 2) / 2);
function hexA(hex, a) {
  const n = parseInt(String(hex || '#e5484d').slice(1), 16);
  return `rgba(${n >> 16},${(n >> 8) & 255},${n & 255},${a})`;
}

// الكاميرا بتروح ناحية اللي بيتكلم: -1 = المذيع أ، 1 = المذيع ب، 0 = لقطة واسعة
function focusAt(tl, t) {
  const segs = [...tl.segs].sort((a, b) => a.start - b.start);
  let i = -1;
  for (let k = 0; k < segs.length; k++) if (segs[k].start <= t) i = k;
  if (i < 0) return 0;
  const val = s => (s.speaker === 'B' ? 1 : -1);
  const cur = val(segs[i]), prev = i > 0 ? val(segs[i - 1]) : 0;
  return prev + (cur - prev) * ease(clamp01((t - segs[i].start) / 0.8));
}

// o: { t, win:{t0,t1}, tl, who, mode, photos, mouth, color, channel, handle, headline, catLabel, logo, rtl, skin, hijab, beard, font }
export function drawStudio(ctx, W, H, o) {
  const { t, win, rtl } = o;
  const vert = H > W;
  const life = t - win.t0, left = win.t1 - t, dur = win.t1 - win.t0;
  const both = o.who === 'both';
  const people = both ? ['m', 'f'] : [o.who === 'f' ? 'f' : 'm'];
  // أماكن المذيعين: أ على اليمين في العربي
  const xs = both ? (rtl ? [0.71, 0.29] : [0.29, 0.71]) : [0.5];
  const deskY = H * (vert ? 0.6 : 0.64);
  const ph = both ? Math.min(H * (vert ? 0.34 : 0.46), W * 0.42 * 520 / 400) : Math.min(H * (vert ? 0.4 : 0.52), W * 0.6 * 520 / 400);
  const sc = ph / 520;
  // الكاميرا: دخول من قريب، زووم بطيء، ميل ناحية اللي بيتكلم، وزووم خاطف في الآخر للخبر
  const focus = both ? focusAt(o.tl, t) : 0;
  const prog = clamp01(life / Math.max(1, dur));
  let z = 0.98 + 0.07 * ease(prog) + 0.05 * Math.abs(focus) + 0.14 * (1 - ease(clamp01(life / 0.9)));
  const out = clamp01(1 - left / 0.4);
  z += 0.7 * out * out;
  const sideX = focus < 0 ? xs[0] : (xs[1] ?? xs[0]);
  const camX = W / 2 + (sideX * W - W / 2) * Math.abs(focus) * 0.35 + Math.sin(t * 0.35) * W * 0.01;
  const camY = deskY - ph * (vert ? 0.42 : 0.5) + Math.sin(t * 0.27) * H * 0.004;
  ctx.save();
  ctx.globalAlpha *= clamp01(life / 0.35) * (1 - out);
  ctx.fillStyle = '#05070d';
  ctx.fillRect(0, 0, W, H);
  ctx.translate(W / 2, H * 0.47);
  ctx.scale(z, z);
  ctx.translate(-camX, -camY);
  // الحيطة
  const wall = ctx.createLinearGradient(0, -H * 0.2, 0, deskY);
  wall.addColorStop(0, '#0b1224'); wall.addColorStop(1, '#16213d');
  ctx.fillStyle = wall;
  ctx.fillRect(-W * 0.5, -H * 0.5, W * 2, H * 2);
  // ألواح الحيطة وشرايط إضاءة رأسية
  for (let i = -6; i <= 16; i++) {
    const x = i * W * 0.09;
    ctx.fillStyle = i % 2 ? 'rgba(255,255,255,.025)' : 'rgba(0,0,0,.12)';
    ctx.fillRect(x, -H * 0.5, W * 0.09, deskY + H * 0.5);
    if (i % 4 === 0) { ctx.fillStyle = hexA(o.color, 0.18 + 0.08 * Math.sin(t * 1.3 + i)); ctx.fillRect(x, -H * 0.5, 6, deskY + H * 0.5); }
  }
  // الشاشة الكبيرة ورا المذيعين
  const sw = W * (vert ? 0.86 : 0.56), sh = Math.min(H * (vert ? 0.22 : 0.3), sw * 0.5), sx = (W - sw) / 2, sy = deskY - ph * 0.98 - sh * (vert ? 0.62 : 0.45);
  ctx.fillStyle = '#02040a';
  ctx.beginPath(); ctx.roundRect(sx - 10, sy - 10, sw + 20, sh + 20, 18); ctx.fill();
  const sg = ctx.createLinearGradient(sx, sy, sx + sw, sy + sh);
  sg.addColorStop(0, hexA(o.color, 0.85)); sg.addColorStop(0.55, '#121a33'); sg.addColorStop(1, hexA(o.color, 0.5));
  ctx.fillStyle = sg;
  ctx.beginPath(); ctx.roundRect(sx, sy, sw, sh, 12); ctx.fill();
  ctx.save();
  ctx.beginPath(); ctx.roundRect(sx, sy, sw, sh, 12); ctx.clip();
  ctx.strokeStyle = 'rgba(255,255,255,.08)'; ctx.lineWidth = 2;
  for (let i = 0; i < 14; i++) { const gx = sx + ((i * sw) / 13 + t * 18) % sw; ctx.beginPath(); ctx.moveTo(gx, sy); ctx.lineTo(gx - sh * 0.4, sy + sh); ctx.stroke(); }
  const sweep = sx + ((t * 0.25) % 1.4 - 0.2) * sw;
  const sweepG = ctx.createLinearGradient(sweep - 120, 0, sweep + 120, 0);
  sweepG.addColorStop(0, 'rgba(255,255,255,0)'); sweepG.addColorStop(0.5, 'rgba(255,255,255,.12)'); sweepG.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = sweepG; ctx.fillRect(sx, sy, sw, sh);
  ctx.restore();
  ctx.fillStyle = '#fff'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.direction = rtl ? 'rtl' : 'ltr';
  let fs = Math.round(sh * 0.3);
  ctx.font = o.font(fs, 800);
  const ch = o.channel || (rtl ? 'النشرة' : 'Newsroom');
  while (ctx.measureText(ch).width > sw * 0.7 && fs > 20) { fs -= 4; ctx.font = o.font(fs, 800); }
  if (o.logo) {
    const lh = sh * 0.42, lw = Math.min(sw * 0.3, lh * (o.logo.naturalWidth || o.logo.width) / (o.logo.naturalHeight || o.logo.height));
    ctx.drawImage(o.logo, sx + sw / 2 - lw / 2, sy + sh * 0.1, lw, lh);
    ctx.fillText(ch, sx + sw / 2, sy + sh * 0.76);
  } else ctx.fillText(ch, sx + sw / 2, sy + sh / 2);
  // كشافات الإضاءة من فوق
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  for (let i = 0; i < 3; i++) {
    const lx = W * (0.2 + 0.3 * i) + Math.sin(t * 0.5 + i * 2) * W * 0.06, ly = -H * 0.1;
    const g = ctx.createRadialGradient(lx, ly, 10, lx, ly + H * 0.45, H * 0.6);
    g.addColorStop(0, `rgba(180,200,255,${0.18 + 0.04 * Math.sin(t * 2 + i)})`); g.addColorStop(1, 'rgba(180,200,255,0)');
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.moveTo(lx - 20, ly); ctx.lineTo(lx + W * 0.22, deskY); ctx.lineTo(lx - W * 0.22, deskY); ctx.closePath(); ctx.fill();
  }
  ctx.restore();
  // المذيعين
  people.forEach((kind, i) => {
    const speaking = !both || (kind === 'm' ? o.mouth.speaker !== 'B' : o.mouth.speaker === 'B');
    const cx = xs[i] * W;
    ctx.save();
    ctx.translate(cx - 200 * sc, deskY + ph * 0.2 - 520 * sc);
    ctx.scale(sc, sc);
    const ph2 = o.mode === 'photo' ? o.photos?.[kind === 'm' ? 'A' : 'B'] : null;
    const args = { ...o, open: speaking ? o.mouth.open : 0, seed: kind === 'm' ? 0.4 : 1.9, noFrame: false };
    if (ph2?.img) drawPhoto(ctx, { ...args, photo: ph2 });
    else (kind === 'm' ? drawMan : drawWoman)(ctx, args);
    ctx.restore();
  });
  // الديسك
  const dw = W * (both ? 0.94 : 0.7), dx = (W - dw) / 2, dh = H * (vert ? 0.14 : 0.2);
  const dg = ctx.createLinearGradient(0, deskY, 0, deskY + dh);
  dg.addColorStop(0, '#1d2747'); dg.addColorStop(1, '#0a0f1f');
  ctx.fillStyle = '#2b375e';
  ctx.beginPath(); ctx.ellipse(W / 2, deskY, dw / 2, dh * 0.16, 0, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = dg;
  ctx.beginPath(); ctx.moveTo(dx, deskY); ctx.lineTo(dx + dw, deskY); ctx.lineTo(dx + dw * 0.94, deskY + dh); ctx.lineTo(dx + dw * 0.06, deskY + dh); ctx.closePath(); ctx.fill();
  ctx.fillStyle = hexA(o.color, 0.9);
  ctx.fillRect(dx + dw * 0.03, deskY + dh * 0.42, dw * 0.94, Math.max(6, dh * 0.07));
  ctx.fillStyle = 'rgba(255,255,255,.85)'; ctx.font = o.font(Math.round(dh * 0.18), 800);
  ctx.fillText(ch, W / 2, deskY + dh * 0.72);
  // الأرضية
  const fg = ctx.createLinearGradient(0, deskY + dh, 0, deskY + dh + H * 0.5);
  fg.addColorStop(0, '#0a0f1f'); fg.addColorStop(1, '#020308');
  ctx.fillStyle = fg; ctx.fillRect(-W * 0.5, deskY + dh, W * 2, H);
  ctx.restore();
  // بانر العنوان تحت (ثابت على الشاشة، برّه الكاميرا)
  const bp = ease(clamp01((life - 0.5) / 0.6)) * (1 - out);
  if (bp > 0.01 && o.headline) {
    const unit = Math.round(H * (vert ? 0.062 : 0.1)), bx = W * 0.04, bw = W * 0.92;
    ctx.font = o.font(Math.round(unit * 0.36), 800);
    const lab0 = o.catLabel || '';
    const room0 = bw - (ctx.measureText(lab0).width + unit * 0.6) - unit * 0.6;
    const hs = Math.round(unit * 0.4);
    ctx.font = o.font(hs, 700);
    const words = o.headline.split(/\s+/), lines = [''];
    for (const w of words) { const tryL = lines[lines.length - 1] ? lines[lines.length - 1] + ' ' + w : w; if (ctx.measureText(tryL).width > room0 && lines[lines.length - 1]) { if (lines.length === 2) { lines[1] += '…'; break; } lines.push(w); } else lines[lines.length - 1] = tryL; }
    const bh = Math.round(unit * (lines.length > 1 ? 1.55 : 1)), by = H - bh - H * (vert ? 0.08 : 0.06);
    ctx.save();
    ctx.globalAlpha *= bp;
    ctx.translate(rtl ? (1 - bp) * 120 : -(1 - bp) * 120, 0);
    ctx.fillStyle = 'rgba(5,8,18,.85)';
    ctx.beginPath(); ctx.roundRect(bx, by, bw, bh, 14); ctx.fill();
    ctx.font = o.font(Math.round(unit * 0.36), 800);
    const lab = lab0;
    const lw = ctx.measureText(lab).width + unit * 0.6;
    ctx.fillStyle = o.color;
    ctx.beginPath(); ctx.roundRect(rtl ? bx + bw - lw : bx, by, lw, bh, 14); ctx.fill();
    ctx.fillStyle = '#fff'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.direction = rtl ? 'rtl' : 'ltr';
    ctx.fillText(lab, rtl ? bx + bw - lw / 2 : bx + lw / 2, by + bh / 2);
    ctx.font = o.font(hs, 700);
    ctx.textAlign = rtl ? 'right' : 'left';
    lines.forEach((l, i) => ctx.fillText(l, rtl ? bx + bw - lw - unit * 0.3 : bx + lw + unit * 0.3, by + bh / 2 + (i - (lines.length - 1) / 2) * hs * 1.25));
    ctx.restore();
  }
  ctx.restore();
}
