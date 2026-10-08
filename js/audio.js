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

export function mixTimeline(segs, duration) {
  const n = Math.ceil(duration * SAMPLE_RATE);
  const left = new Float32Array(n), right = new Float32Array(n);
  for (const s of segs) {
    if (typeof s.buffer?.getChannelData !== 'function') continue;
    const off = Math.round(s.at * SAMPLE_RATE);
    const l = s.buffer.getChannelData(0);
    const r = s.buffer.numberOfChannels > 1 ? s.buffer.getChannelData(1) : l;
    for (let i = 0; i < l.length && off + i < n; i++) { left[off + i] += l[i]; right[off + i] += r[i]; }
  }
  return { left, right, duration };
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
