// ✂️ شيل الخلفية من فيديو ظهورك (presenter): cutFrame(bg, cut) → canvas شفاف فيه الشخص بس، أو null
// cut = { mode: 'off' | 'green' | 'ai', color: '#00ff00', tol: 0..1, size, pos }
// green = كروما (خلفية خضرا/لون واحد) فوري ومن غير تحميل. ai = MediaPipe Selfie Segmenter على جهازك (بيتحمّل أول مرة ~0.3 ميجا + wasm)
const MP_VER = '0.10.14';
const MP_URL = `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${MP_VER}`;
const MODEL = 'https://storage.googleapis.com/mediapipe-models/image_segmenter/selfie_segmenter/float16/latest/selfie_segmenter.tflite';

let seg = null, segLoading = null, segErr = '';
const work = document.createElement('canvas');
const out = document.createElement('canvas');
const cache = new WeakMap(); // el → {key, canvas}

export const cutReady = mode => mode === 'green' || (mode === 'ai' && !!seg);
export const cutError = () => segErr;

// تحميل نموذج الفصل (مرة واحدة)؛ لازم يتنادى قبل التصدير، والمعاينة بترسم الفيديو كامل لحد ما يخلص
export function ensureSegmenter() {
  if (seg) return Promise.resolve(seg);
  if (segLoading) return segLoading;
  segLoading = (async () => {
    const vision = await import(`${MP_URL}/vision_bundle.mjs`);
    const fileset = await vision.FilesetResolver.forVisionTasks(`${MP_URL}/wasm`);
    const make = delegate => vision.ImageSegmenter.createFromOptions(fileset, {
      baseOptions: { modelAssetPath: MODEL, delegate },
      runningMode: 'IMAGE', outputCategoryMask: false, outputConfidenceMasks: true,
    });
    try { seg = await make('GPU'); } catch { seg = await make('CPU'); }
    segErr = '';
    return seg;
  })().catch(e => { segErr = String(e?.message || e); segLoading = null; throw e; });
  return segLoading;
}

const hexRgb = h => { const n = parseInt(String(h || '#00ff00').replace('#', ''), 16) || 0x00ff00; return [n >> 16, (n >> 8) & 255, n & 255]; };

// كروما: البكسل القريب من اللون بيبقى شفاف، والحواف ناعمة، و«شيل الأخضر» من الحواف (despill)
function chroma(d, color, tol) {
  const [kr, kg, kb] = hexRgb(color);
  const t0 = 40 + tol * 160, t1 = t0 + 60;
  const greenKey = kg > kr && kg > kb;
  for (let i = 0; i < d.length; i += 4) {
    const r = d[i], g = d[i + 1], b = d[i + 2];
    const dist = Math.sqrt((r - kr) ** 2 + (g - kg) ** 2 + (b - kb) ** 2);
    if (dist < t0) { d[i + 3] = 0; continue; }
    if (dist < t1) d[i + 3] = Math.round(255 * (dist - t0) / (t1 - t0));
    if (greenKey && g > Math.max(r, b)) d[i + 1] = Math.max(r, b);
  }
}

function aiMask(d, w, h, tol) {
  let ok = false;
  const lo = 0.25 + tol * 0.4, hi = lo + 0.25;
  // النتيجة صالحة جوه الـ callback بس، فبنطبّق القناع هنا
  seg.segment(work, res => {
    const mask = res.confidenceMasks?.[0]?.getAsFloat32Array();
    if (!mask || mask.length < w * h) return;
    for (let i = 0, p = 0; p < w * h; p++, i += 4) {
      const v = mask[p];
      d[i + 3] = v <= lo ? 0 : v >= hi ? 255 : Math.round(255 * (v - lo) / (hi - lo));
    }
    ok = true;
  });
  return ok;
}

export function cutFrame(bg, cut) {
  const mode = cut?.mode;
  if (!bg?.el || !mode || mode === 'off') return null;
  if (mode === 'ai' && !seg) { ensureSegmenter().catch(() => {}); return null; }
  const el = bg.el, vid = bg.kind === 'video';
  const sw = vid ? el.videoWidth : el.naturalWidth, sh = vid ? el.videoHeight : el.naturalHeight;
  if (!sw || !sh) return null;
  const tol = Math.max(0, Math.min(1, cut.tol ?? 0.5));
  const key = `${vid ? el.currentTime.toFixed(3) : 'img'}|${mode}|${cut.color}|${tol}`;
  const hit = cache.get(el);
  if (hit && hit.key === key) return hit.canvas;
  // بنشتغل على نسخة أصغر (أطول ضلع 640) عشان يبقى سريع كل فريم
  const k = Math.min(1, 640 / Math.max(sw, sh)), w = Math.round(sw * k), h = Math.round(sh * k);
  if (work.width !== w || work.height !== h) { work.width = w; work.height = h; }
  const wc = work.getContext('2d', { willReadFrequently: true });
  wc.clearRect(0, 0, w, h);
  wc.drawImage(el, 0, 0, w, h);
  const img = wc.getImageData(0, 0, w, h);
  if (mode === 'green') chroma(img.data, cut.color, tol);
  else {
    try { if (!aiMask(img.data, w, h, tol)) return null; } catch (e) { segErr = String(e?.message || e); return null; }
  }
  const c = hit?.canvas || document.createElement('canvas');
  if (c.width !== w || c.height !== h) { c.width = w; c.height = h; }
  c.getContext('2d').putImageData(img, 0, 0);
  cache.set(el, { key, canvas: c });
  return c;
}

// لون الخلفية الغالب في أركان الفريم (عشان «التقط لون الخلفية» في الكروما)
export function cornerColor(bg) {
  const el = bg?.el; if (!el) return '#00ff00';
  const vid = bg.kind === 'video', sw = vid ? el.videoWidth : el.naturalWidth, sh = vid ? el.videoHeight : el.naturalHeight;
  if (!sw || !sh) return '#00ff00';
  out.width = 64; out.height = 64;
  const c = out.getContext('2d', { willReadFrequently: true });
  c.drawImage(el, 0, 0, 64, 64);
  const d = c.getImageData(0, 0, 64, 64).data;
  let r = 0, g = 0, b = 0, n = 0;
  for (const [x0, y0] of [[0, 0], [56, 0], [0, 56], [56, 56]]) for (let y = y0; y < y0 + 8; y++) for (let x = x0; x < x0 + 8; x++) { const i = (y * 64 + x) * 4; r += d[i]; g += d[i + 1]; b += d[i + 2]; n++; }
  const hx = v => Math.round(v / n).toString(16).padStart(2, '0');
  return '#' + hx(r) + hx(g) + hx(b);
}
