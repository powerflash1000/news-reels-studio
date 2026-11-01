// فك تشفير الصوت، تسجيل بالمايك، ودمج السطور على خط زمني واحد
export const SAMPLE_RATE = 48000;

let actx = null;
export function audioCtx() {
  if (!actx) actx = new (window.AudioContext || window.webkitAudioContext)({ sampleRate: SAMPLE_RATE });
  return actx;
}

export async function decode(arrayBuffer) {
  // decodeAudioData بياخد الـ buffer، فبنديله نسخة
  return audioCtx().decodeAudioData(arrayBuffer.slice(0));
}

export function mixTimeline(segs, duration, music = null, fx = null) {
  const n = Math.ceil(duration * SAMPLE_RATE);
  const left = new Float32Array(n), right = new Float32Array(n);
  for (const s of segs) {
    if (typeof s.buffer?.getChannelData !== 'function') continue;
    const off = Math.round(s.at * SAMPLE_RATE);
    const [l, r] = voiceChannels(s.buffer, fx);
    for (let i = 0; i < l.length && off + i < n; i++) { left[off + i] += l[i]; right[off + i] += r[i]; }
  }
  if (music?.buffer?.getChannelData) addMusic(left, right, segs, duration, music);
  return { left, right, duration };
}

// موسيقى خلفية: تتكرر لحد آخر الحلقة، fade in/out، وتنزل لـ35% وقت الكلام (ducking) بانتقال ناعم
function addMusic(left, right, segs, duration, { buffer, gain = 0.15 }) {
  const n = left.length;
  const l = buffer.getChannelData(0), r = buffer.numberOfChannels > 1 ? buffer.getChannelData(1) : l;
  if (!l.length) return;
  const STEP = 480; // 10ms
  const env = new Float32Array(Math.ceil(n / STEP) + 1).fill(1);
  for (const s of segs) {
    if (typeof s.buffer?.getChannelData !== 'function') continue;
    const a = Math.floor((s.at * SAMPLE_RATE) / STEP), b = Math.ceil(((s.at * SAMPLE_RATE) + s.buffer.length) / STEP);
    for (let i = Math.max(0, a); i < Math.min(env.length, b); i++) env[i] = 0.35;
  }
  let cur = 1;
  const k = 1 - Math.exp(-1 / 30); // ~300ms
  for (let i = 0; i < env.length; i++) { cur += (env[i] - cur) * k; env[i] = cur; }
  const fadeIn = Math.min(SAMPLE_RATE, n / 4), fadeOut = Math.min(1.5 * SAMPLE_RATE, n / 3);
  for (let i = 0; i < n; i++) {
    const g = gain * env[(i / STEP) | 0] * Math.min(1, i / fadeIn, (n - i) / fadeOut);
    const j = i % l.length;
    left[i] += l[j] * g; right[i] += r[j] * g;
  }
}

/* ---------- تحسين الصوت (بعد التوليد، محليًا ومن غير رصيد) ---------- */
export const FX_PRESETS = {
  none: { name: 'بدون تأثير', bass: 0, presence: 0, air: 0, comp: 0, deess: 0, room: 0, norm: false },
  news: { name: 'نشرة أخبار (واضح وقوي)', bass: 1, presence: 3, air: 1.5, comp: 0.6, deess: 0.4, room: 0, norm: true },
  warm: { name: 'دافئ (حكايات وقصص)', bass: 3, presence: 1, air: -1, comp: 0.5, deess: 0.5, room: 0.12, norm: true },
  clear: { name: 'واضح على الموبايل', bass: -2, presence: 4, air: 3, comp: 0.7, deess: 0.5, room: 0, norm: true },
  radio: { name: 'راديو / تقرير ميداني', bass: -4, presence: 5, air: -4, comp: 0.8, deess: 0.3, room: 0, norm: true },
  cinematic: { name: 'سينمائي (مساحة وعمق)', bass: 4, presence: 0, air: 1, comp: 0.4, deess: 0.3, room: 0.22, norm: true },
  podcast: { name: 'بودكاست نضيف (قريب ودافي)', bass: 2, presence: 2, air: 1, comp: 0.7, deess: 0.5, room: 0, norm: true },
  hall: { name: 'قاعة كبيرة (صدى واسع)', bass: 2, presence: 1, air: 0, comp: 0.4, deess: 0.3, room: 0.38, norm: true },
  echo: { name: 'صدى متكرر (Echo) — للحظات الدرامية', bass: 1, presence: 2, air: 0, comp: 0.5, deess: 0.4, room: 0.08, echo: 0.35, norm: true },
};

// معادلات الـbiquad (RBJ cookbook)
function biquad(type, f0, gainDb, q, fs) {
  const A = 10 ** (gainDb / 40), w = (2 * Math.PI * f0) / fs, c = Math.cos(w), sn = Math.sin(w), al = sn / (2 * q);
  let b0, b1, b2, a0, a1, a2;
  if (type === 'hp') { b0 = (1 + c) / 2; b1 = -(1 + c); b2 = (1 + c) / 2; a0 = 1 + al; a1 = -2 * c; a2 = 1 - al; }
  else if (type === 'peak') { b0 = 1 + al * A; b1 = -2 * c; b2 = 1 - al * A; a0 = 1 + al / A; a1 = -2 * c; a2 = 1 - al / A; }
  else {
    const sq = 2 * Math.sqrt(A) * al;
    if (type === 'low') { b0 = A * ((A + 1) - (A - 1) * c + sq); b1 = 2 * A * ((A - 1) - (A + 1) * c); b2 = A * ((A + 1) - (A - 1) * c - sq); a0 = (A + 1) + (A - 1) * c + sq; a1 = -2 * ((A - 1) + (A + 1) * c); a2 = (A + 1) + (A - 1) * c - sq; }
    else { b0 = A * ((A + 1) + (A - 1) * c + sq); b1 = -2 * A * ((A - 1) + (A + 1) * c); b2 = A * ((A + 1) + (A - 1) * c - sq); a0 = (A + 1) - (A - 1) * c + sq; a1 = 2 * ((A - 1) - (A + 1) * c); a2 = (A + 1) - (A - 1) * c - sq; }
  }
  return [b0 / a0, b1 / a0, b2 / a0, a1 / a0, a2 / a0];
}
function filt(x, [b0, b1, b2, a1, a2]) {
  const y = new Float32Array(x.length);
  let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
  for (let i = 0; i < x.length; i++) {
    const v = b0 * x[i] + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2;
    x2 = x1; x1 = x[i]; y2 = y1; y1 = v; y[i] = v;
  }
  return y;
}
const db = v => 20 * Math.log10(Math.max(v, 1e-9));

// ضغط ديناميكي بسيط (feed-forward): بيقرّب الأصوات العالية والواطية من بعض
function compress(x, amount, fs) {
  const ratio = 1 + 3 * amount, thr = -24;
  const at = Math.exp(-1 / (0.005 * fs)), rl = Math.exp(-1 / (0.09 * fs));
  let env = 0;
  const y = new Float32Array(x.length);
  for (let i = 0; i < x.length; i++) {
    const a = Math.abs(x[i]);
    env = a > env ? at * env + (1 - at) * a : rl * env + (1 - rl) * a;
    const over = db(env) - thr;
    const g = over > 0 ? 10 ** ((-over * (1 - 1 / ratio)) / 20) : 1;
    y[i] = x[i] * g;
  }
  return y;
}

// de-esser: بيخفض الترددات العالية (السين والشين) لما تعلى زيادة
function deess(x, amount, fs) {
  const hp = biquad('hp', 5500, 0, 0.707, fs);
  const hb = filt(x, hp);
  const at = Math.exp(-1 / (0.002 * fs)), rl = Math.exp(-1 / (0.03 * fs));
  let env = 0;
  const thr = 0.03;
  const y = new Float32Array(x.length);
  for (let i = 0; i < x.length; i++) {
    const a = Math.abs(hb[i]);
    env = a > env ? at * env + (1 - at) * a : rl * env + (1 - rl) * a;
    const g = env > thr ? (thr / env) ** (0.4 + amount) : 1;
    y[i] = x[i] - hb[i] * (1 - g);
  }
  return y;
}

// صدى خفيف (Schroeder: 4 comb + 2 allpass). بيرجّع نسخة أطول شوية عشان الذيل
function room(x, amount, fs) {
  const tail = Math.round(0.35 * fs);
  const n = x.length + tail;
  const inp = new Float32Array(n); inp.set(x);
  const combs = [0.0297, 0.0371, 0.0411, 0.0437].map(t => ({ d: Math.round(t * fs), fb: 0.8, buf: null }));
  const wet = new Float32Array(n);
  for (const c of combs) {
    const buf = new Float32Array(c.d);
    for (let i = 0, p = 0; i < n; i++, p = (p + 1) % c.d) { const o = buf[p]; wet[i] += o * 0.25; buf[p] = inp[i] + o * c.fb; }
  }
  for (const t of [0.005, 0.0017]) {
    const d = Math.round(t * fs), buf = new Float32Array(d);
    for (let i = 0, p = 0; i < n; i++, p = (p + 1) % d) { const b = buf[p]; const v = wet[i] + (-0.7) * b; buf[p] = wet[i] + 0.7 * b; wet[i] = b - 0.7 * v; }
  }
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) out[i] = inp[i] + wet[i] * amount * 1.6;
  return out;
}

// صدى متكرر (Echo): نسخة متأخرة 280 ملي ثانية بتتكرر وبتخفت. بيرجّع نسخة أطول عشان الذيل
function echo(x, amount, fs) {
  const d = Math.round(0.28 * fs), tail = Math.round(1.4 * fs);
  const n = x.length + tail, out = new Float32Array(n);
  out.set(x);
  for (let i = d; i < n; i++) out[i] += out[i - d] * 0.42 * (i - d < x.length ? amount * 1.6 : 1);
  return out;
}

// رفع/خفض الصوت لمستوى ثابت (RMS على الأجزاء المسموعة) مع limiter ناعم
function normalize(x, targetDb) {
  let sum = 0, cnt = 0;
  for (let i = 0; i < x.length; i++) if (Math.abs(x[i]) > 0.003) { sum += x[i] * x[i]; cnt++; }
  if (!cnt) return x;
  const gain = Math.min(10 ** ((targetDb - db(Math.sqrt(sum / cnt))) / 20), 12);
  const y = new Float32Array(x.length);
  for (let i = 0; i < x.length; i++) {
    const v = x[i] * gain, a = Math.abs(v);
    y[i] = a < 0.8 ? v : Math.sign(v) * (0.8 + 0.19 * Math.tanh((a - 0.8) / 0.19));
  }
  return y;
}

export function fxActive(fx) {
  return !!fx && (fx.bass || fx.presence || fx.air || fx.comp || fx.deess || fx.room || fx.echo || fx.norm) ? true : false;
}

export function processChannel(x, fx, fs = SAMPLE_RATE) {
  let y = filt(x, biquad('hp', 70, 0, 0.707, fs));
  if (fx.bass) y = filt(y, biquad('low', 140, fx.bass, 0.8, fs));
  if (fx.presence) y = filt(y, biquad('peak', 3200, fx.presence, 1, fs));
  if (fx.air) y = filt(y, biquad('high', 9000, fx.air, 0.7, fs));
  if (fx.deess) y = deess(y, fx.deess, fs);
  if (fx.comp) y = compress(y, fx.comp, fs);
  if (fx.room) y = room(y, fx.room, fs);
  if (fx.echo) y = echo(y, fx.echo, fs);
  if (fx.norm) y = normalize(y, fx.target ?? -16);
  return y;
}

// قنوات الصوت بعد التأثير (بتتخزن لكل buffer عشان المعاينة والتصدير ميعيدوش الحساب)
const fxCache = new WeakMap();
function voiceChannels(buffer, fx) {
  const l = buffer.getChannelData(0), r = buffer.numberOfChannels > 1 ? buffer.getChannelData(1) : l;
  if (!fxActive(fx)) return [l, r];
  const key = JSON.stringify([fx.bass, fx.presence, fx.air, fx.comp, fx.deess, fx.room, fx.echo, fx.norm, fx.target]);
  const hit = fxCache.get(buffer);
  if (hit?.key === key) return hit.ch;
  const pl = processChannel(l, fx, buffer.sampleRate || SAMPLE_RATE);
  const ch = [pl, r === l ? pl : processChannel(r, fx, buffer.sampleRate || SAMPLE_RATE)];
  fxCache.set(buffer, { key, ch });
  return ch;
}
// للتجربة في الإعدادات: بيرجّع AudioBuffer معالج
export function applyFxToBuffer(buffer, fx) {
  if (!fxActive(fx)) return buffer;
  const [l, r] = voiceChannels(buffer, fx);
  const out = audioCtx().createBuffer(2, l.length, buffer.sampleRate || SAMPLE_RATE);
  out.copyToChannel(l, 0); out.copyToChannel(r, 1);
  return out;
}

export class Recorder {
  async start() {
    this.stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
    this.chunks = [];
    this.rec = new MediaRecorder(this.stream);
    this.rec.ondataavailable = e => e.data.size && this.chunks.push(e.data);
    this.rec.start();
  }
  pause() { if (this.rec?.state === 'recording') this.rec.pause(); }
  resume() { if (this.rec?.state === 'paused') this.rec.resume(); }
  cancel() { try { this.rec.onstop = null; this.rec.stop(); } catch { /* خلص */ } this.stream?.getTracks().forEach(t => t.stop()); }
  stop() {
    return new Promise(resolve => {
      this.rec.onstop = async () => {
        this.stream.getTracks().forEach(t => t.stop());
        const blob = new Blob(this.chunks, { type: this.rec.mimeType });
        resolve(await decode(await blob.arrayBuffer()));
      };
      this.rec.stop();
    });
  }
}

// قص السكتات: أي سكتة أطول من maxGap بتتقصّر لـ maxGap، وسكتة الأول والآخر بتتقصّر لـ edge.
// بيرجّع {buffer, removed} (removed = الثواني اللي اتشالت)
export function trimSilence(buffer, { thrDb = -42, maxGap = 0.35, edge = 0.12 } = {}) {
  const fs = buffer.sampleRate, win = Math.round(fs * 0.01), n = buffer.length;
  const chans = [...Array(buffer.numberOfChannels)].map((_, c) => buffer.getChannelData(c));
  // مستوى السكتة: أعلى من أهدى 10% من الصوت بشوية، ومش أقل من thrDb
  const frames = Math.ceil(n / win), lv = new Float32Array(frames);
  for (let f = 0; f < frames; f++) {
    let sum = 0;
    for (let i = f * win; i < Math.min(n, (f + 1) * win); i++) sum += chans[0][i] * chans[0][i];
    lv[f] = Math.sqrt(sum / win);
  }
  const sorted = [...lv].sort((a, b) => a - b), floor = sorted[Math.floor(frames * 0.1)] || 0;
  const thr = Math.max(10 ** (thrDb / 20), floor * 2.5);
  const keep = [];
  let f = 0;
  while (f < frames) {
    if (lv[f] >= thr) { keep.push([f, f + 1]); f++; continue; }
    let g = f;
    while (g < frames && lv[g] < thr) g++;
    const len = (g - f) * 0.01, lim = f === 0 || g >= frames ? edge : maxGap;
    if (len <= lim) keep.push([f, g]);
    else { const half = Math.round(lim / 0.01 / 2); if (f > 0) keep.push([f, f + half]); if (g < frames) keep.push([g - half, g]); }
    f = g;
  }
  let total = 0;
  for (const [a, b] of keep) total += (Math.min(n, b * win) - a * win);
  const out = audioCtx().createBuffer(buffer.numberOfChannels, Math.max(1, total), fs);
  for (let c = 0; c < chans.length; c++) {
    const dst = out.getChannelData(c);
    let o = 0;
    for (const [a, b] of keep) { const seg = chans[c].subarray(a * win, Math.min(n, b * win)); dst.set(seg, o); o += seg.length; }
  }
  return { buffer: out, removed: Math.max(0, (n - total) / fs) };
}

// تسجيل بمقاطع: المايك بيفضل مفتوح، وكل مقطع MediaRecorder لوحده (وقفة = المقطع خلص)
export class SegRecorder {
  async open() {
    if (!this.stream) this.stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
    return this.stream;
  }
  begin() {
    this.chunks = [];
    this.rec = new MediaRecorder(this.stream);
    this.rec.ondataavailable = e => e.data.size && this.chunks.push(e.data);
    this.rec.start();
  }
  get active() { return this.rec?.state === 'recording'; }
  end() {
    return new Promise(resolve => {
      const rec = this.rec;
      this.rec = null;
      if (!rec || rec.state === 'inactive') return resolve(null);
      rec.onstop = async () => {
        const blob = new Blob(this.chunks, { type: rec.mimeType });
        try { resolve(await decode(await blob.arrayBuffer())); } catch { resolve(null); }
      };
      rec.stop();
    });
  }
  close() { try { if (this.rec) { this.rec.onstop = null; this.rec.stop(); } } catch { /* خلص */ } this.stream?.getTracks().forEach(t => t.stop()); this.stream = null; this.rec = null; }
}

// لزق مقاطع ورا بعض بفاصل صغير
export function concatBuffers(list, gap = 0.15) {
  const bufs = list.filter(Boolean);
  if (!bufs.length) return null;
  const fs = bufs[0].sampleRate, ch = Math.max(...bufs.map(b => b.numberOfChannels)), g = Math.round(gap * fs);
  const total = bufs.reduce((n, b) => n + b.length, 0) + g * (bufs.length - 1);
  const out = audioCtx().createBuffer(ch, total, fs);
  for (let c = 0; c < ch; c++) {
    const dst = out.getChannelData(c);
    let o = 0;
    for (const b of bufs) { dst.set(b.getChannelData(Math.min(c, b.numberOfChannels - 1)), o); o += b.length + g; }
  }
  return out;
}

// FFT مركّب in-place (الطول لازم يبقى 2^n)
function fft(re, im, inv = false) {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) { [re[i], re[j]] = [re[j], re[i]]; [im[i], im[j]] = [im[j], im[i]]; }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = (inv ? 2 : -2) * Math.PI / len, wr = Math.cos(ang), wi = Math.sin(ang);
    for (let i = 0; i < n; i += len) {
      let cr = 1, ci = 0;
      for (let k = 0; k < len / 2; k++) {
        const a = i + k, b = a + len / 2;
        const tr = re[b] * cr - im[b] * ci, ti = re[b] * ci + im[b] * cr;
        re[b] = re[a] - tr; im[b] = im[a] - ti; re[a] += tr; im[a] += ti;
        const t = cr * wr - ci * wi; ci = cr * wi + ci * wr; cr = t;
      }
    }
  }
  if (inv) for (let i = 0; i < n; i++) { re[i] /= n; im[i] /= n; }
}

// 🧽 تنضيف الدوشة الثابتة (مروحة، تكييف، زنّة الأوضة): بيقيس «بصمة» الدوشة من أهدى أجزاء التسجيل
// ويطرحها من كل حتة (spectral subtraction) مع تنعيم عشان ميطلعش صوت معدني. محلي وببلاش.
export function denoise(buffer, { strength = 1 } = {}) {
  const fs = buffer.sampleRate, N = 1024, H = 256, K = N / 2 + 1;
  const x0 = filt(buffer.getChannelData(0), biquad('hp', 80, 0, 0.707, fs)); // بنشيل الزنّة الواطية الأول
  const len = x0.length, frames = Math.max(1, Math.ceil(len / H));
  const w = new Float32Array(N).map((_, i) => 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / N));
  const re = new Float64Array(N), im = new Float64Array(N);
  const frameAt = f => { for (let i = 0; i < N; i++) { const j = f * H + i - N / 2; re[i] = j >= 0 && j < len ? x0[j] * w[i] : 0; im[i] = 0; } };
  // 1) بصمة الدوشة = متوسط طيف أهدى 10% من الإطارات
  const energy = new Float32Array(frames);
  for (let f = 0; f < frames; f++) { let e = 0; for (let i = 0; i < N; i += 4) { const j = f * H + i - N / 2; if (j >= 0 && j < len) e += x0[j] * x0[j]; } energy[f] = e; }
  const quiet = [...energy.keys()].sort((a, b) => energy[a] - energy[b]).slice(0, Math.max(4, Math.floor(frames * 0.1)));
  const noise = new Float64Array(K);
  for (const f of quiet) { frameAt(f); fft(re, im); for (let k = 0; k < K; k++) noise[k] += Math.hypot(re[k], im[k]) / quiet.length; }
  // 2) الطرح + تنعيم الكسب مع الوقت + إعادة التركيب
  const out = new Float32Array(len), norm = new Float32Array(len);
  const alpha = 1.6 * strength, floor = 0.06, prev = new Float64Array(K).fill(1);
  for (let f = 0; f < frames; f++) {
    frameAt(f); fft(re, im);
    for (let k = 0; k < K; k++) {
      const mag = Math.hypot(re[k], im[k]) || 1e-12;
      let g = Math.max(floor, 1 - (alpha * noise[k]) / mag);
      g = 0.55 * prev[k] + 0.45 * g; prev[k] = g;
      re[k] *= g; im[k] *= g;
      if (k > 0 && k < N / 2) { re[N - k] = re[k]; im[N - k] = -im[k]; }
    }
    fft(re, im, true);
    for (let i = 0; i < N; i++) { const j = f * H + i - N / 2; if (j >= 0 && j < len) { out[j] += re[i] * w[i]; norm[j] += w[i] * w[i]; } }
  }
  for (let j = 0; j < len; j++) out[j] = norm[j] > 1e-6 ? out[j] / norm[j] : 0;
  const res = audioCtx().createBuffer(buffer.numberOfChannels, len, fs);
  for (let c = 0; c < buffer.numberOfChannels; c++) res.copyToChannel(out, c);
  return res;
}
