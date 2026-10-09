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

export function mixTimeline(segs, duration, music = null) {
  const n = Math.ceil(duration * SAMPLE_RATE);
  const left = new Float32Array(n), right = new Float32Array(n);
  for (const s of segs) {
    if (typeof s.buffer?.getChannelData !== 'function') continue;
    const off = Math.round(s.at * SAMPLE_RATE);
    const l = s.buffer.getChannelData(0);
    const r = s.buffer.numberOfChannels > 1 ? s.buffer.getChannelData(1) : l;
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

export class Recorder {
  async start() {
    this.stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
    this.chunks = [];
    this.rec = new MediaRecorder(this.stream);
    this.rec.ondataavailable = e => e.data.size && this.chunks.push(e.data);
    this.rec.start();
  }
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
