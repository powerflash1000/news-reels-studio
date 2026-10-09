// خلفية الخبر: تحميل من التخزين، الرسم بقصّ cover مع تعتيم، والتزامن مع الفيديو
import { getBlob } from './mediastore.js';

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

// رسم الخلفية بقصّ cover على مقاس الكانفس + تعتيم عشان النص يتقري
export function drawBg(ctx, bg, W, H, dim = 0.5) {
  const el = bg.el;
  const w = bg.kind === 'video' ? el.videoWidth : el.naturalWidth;
  const h = bg.kind === 'video' ? el.videoHeight : el.naturalHeight;
  if (!w || !h) return;
  const k = Math.max(W / w, H / h);
  ctx.drawImage(el, (W - w * k) / 2, (H - h * k) / 2, w * k, h * k);
  ctx.fillStyle = `rgba(6,10,24,${dim})`;
  ctx.fillRect(0, 0, W, H);
}
