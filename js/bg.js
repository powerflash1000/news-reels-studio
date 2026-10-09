// خلفية الخبر: تحميل من التخزين، الرسم بقصّ cover مع تعتيم، والتزامن مع الفيديو
import { getBlob } from './mediastore.js?v=mv1f1uk6';

const cache = new Map(); // mediaId → Promise<{kind, el, url}|null>

export function loadBg(media) {
  if (!media?.id) return Promise.resolve(null);
  if (!cache.has(media.id)) {
    cache.set(media.id, (async () => {
      const blob = await getBlob(media.id);
      if (!blob) return null;
      const url = URL.createObjectURL(blob);
      if (media.kind === 'video') {
        const el = document.createElement('video');
        el.muted = true; el.loop = true; el.playsInline = true; el.preload = 'auto';
        el.src = url;
        await new Promise((res, rej) => { el.onloadeddata = res; el.onerror = () => rej(new Error('مقدرتش أفتح الفيديو ده (الصيغة غير مدعومة؟)')); });
        el.currentTime = Math.min(0.5, (el.duration || 1) / 2);
        await new Promise(r => { el.onseeked = r; setTimeout(r, 800); });
        return { kind: 'video', el, url, duration: el.duration || 0 };
      }
      const el = new Image();
      el.src = url;
      await el.decode();
      return { kind: 'image', el, url };
    })().catch(() => null));
  }
  return cache.get(media.id);
}

export function forgetBg(id) {
  const p = cache.get(id);
  cache.delete(id);
  p?.then(b => b && URL.revokeObjectURL(b.url));
}

// للتصدير: بنروح لإطار معين من الفيديو (بيتكرر لو الفيديو أقصر من الخبر)
export async function seekBg(bg, t) {
  if (!bg || bg.kind !== 'video' || !bg.duration) return;
  const target = t % bg.duration;
  if (Math.abs(bg.el.currentTime - target) < 0.001) return;
  await new Promise(res => {
    const done = () => { bg.el.removeEventListener('seeked', done); res(); };
    bg.el.addEventListener('seeked', done);
    bg.el.currentTime = target;
    setTimeout(done, 1500);
  });
}

// للمعاينة: تشغيل الفيديو بس لما خبره هو الجاري
export function playBg(bg, active) {
  if (!bg || bg.kind !== 'video') return;
  if (active && bg.el.paused) bg.el.play().catch(() => {});
  else if (!active && !bg.el.paused) bg.el.pause();
}

// خلفية مصغّرة بتتكبّر = غباش سريع (من غير ctx.filter) لتعبئة جوانب الصورة لما مقاسها مش زي الشاشة
let small = null;

// رسم الخلفية + تعتيم عشان النص يتقري. media.fit: auto (احتواء مع غباش لو المقاس بعيد) | cover (تغطية) | contain (احتواء)
// media.zoom (1–3) و media.fx/fy (0–1) لتحريك القصّ
export function drawBg(ctx, bg, W, H, dim = 0.5, media = null) {
  const el = bg.el;
  const w = bg.kind === 'video' ? el.videoWidth : el.naturalWidth;
  const h = bg.kind === 'video' ? el.videoHeight : el.naturalHeight;
  if (!w || !h) return;
  const fit = media?.fit || 'auto', zoom = Math.max(1, Math.min(3, media?.zoom || 1));
  const fx = media?.fx ?? 0.5, fy = media?.fy ?? 0.5;
  const mismatch = Math.max(w / h / (W / H), H / W / (h / w));
  const contain = fit === 'contain' || (fit === 'auto' && mismatch > 1.45);
  if (contain) {
    const sw = Math.max(16, Math.round(W / 24)), sh = Math.max(16, Math.round(H / 24));
    if (!small) small = document.createElement('canvas');
    if (small.width !== sw || small.height !== sh) { small.width = sw; small.height = sh; }
    const sc = small.getContext('2d');
    const kb = Math.max(sw / w, sh / h);
    sc.drawImage(el, (sw - w * kb) / 2, (sh - h * kb) / 2, w * kb, h * kb);
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(small, 0, 0, W, H);
    ctx.fillStyle = 'rgba(6,10,24,0.35)';
    ctx.fillRect(0, 0, W, H);
    const k = Math.min(W / w, H / h) * zoom;
    ctx.drawImage(el, (W - w * k) / 2, (H - h * k) / 2, w * k, h * k);
  } else {
    const k = Math.max(W / w, H / h) * zoom;
    ctx.drawImage(el, -(w * k - W) * fx, -(h * k - H) * fy, w * k, h * k);
  }
  ctx.fillStyle = `rgba(6,10,24,${dim})`;
  ctx.fillRect(0, 0, W, H);
}
