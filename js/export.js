// تصدير MP4 سريع بالـ WebCodecs (H.264 + AAC) — بيشتغل في Chrome و Edge
import { Muxer, ArrayBufferTarget } from '../vendor/mp4-muxer/mp4-muxer.mjs';
import { SAMPLE_RATE, mixTimeline } from './audio.js';
import { W, H, drawFrame } from './render.js';

export const FPS = 30;
const AVC = ['avc1.640028', 'avc1.4d0028', 'avc1.640032', 'avc1.42e028'];
const testCodecs = () => typeof window !== 'undefined' && window.__nrsTestCodecs;

export async function exportSupport() {
  if (typeof VideoEncoder === 'undefined' || typeof AudioEncoder === 'undefined') return null;
  const cands = AVC.map(codec => ({ mux: 'avc', codec }));
  if (testCodecs()) cands.push({ mux: 'vp9', codec: 'vp09.00.40.08' });
  let video = null;
  for (const c of cands) {
    const config = { codec: c.codec, width: W, height: H, bitrate: 6_000_000, framerate: FPS, ...(c.mux === 'avc' ? { avc: { format: 'avc' } } : {}) };
    try {
      const r = await VideoEncoder.isConfigSupported(config);
      if (r.supported) { video = { mux: c.mux, config: r.config }; break; }
    } catch { /* جرّب اللي بعده */ }
  }
  if (!video) return null;
  const acands = [{ mux: 'aac', codec: 'mp4a.40.2' }];
  if (testCodecs()) acands.push({ mux: 'opus', codec: 'opus' });
  for (const a of acands) {
    const config = { codec: a.codec, sampleRate: SAMPLE_RATE, numberOfChannels: 2, bitrate: 192_000 };
    try {
      const r = await AudioEncoder.isConfigSupported(config);
      if (r.supported) return { video, audio: { mux: a.mux, config: r.config } };
    } catch { /* مش مدعوم */ }
  }
  return null;
}

export async function exportReel(st, cfg, onProgress) {
  const tl = st.tl;
  const mix = mixTimeline(tl.segs, tl.duration);
  const target = new ArrayBufferTarget();
  const muxer = new Muxer({
    target,
    video: { codec: cfg.video.mux, width: W, height: H, frameRate: FPS },
    audio: { codec: cfg.audio.mux, sampleRate: SAMPLE_RATE, numberOfChannels: 2 },
    fastStart: 'in-memory',
    firstTimestampBehavior: 'offset',
  });
  let err = null;
  const venc = new VideoEncoder({ output: (c, m) => muxer.addVideoChunk(c, m), error: e => { err = e; } });
  venc.configure(cfg.video.config);
  const aenc = new AudioEncoder({ output: (c, m) => muxer.addAudioChunk(c, m), error: e => { err = e; } });
  aenc.configure(cfg.audio.config);

  const total = mix.left.length, step = 4096;
  for (let off = 0; off < total; off += step) {
    const n = Math.min(step, total - off);
    const data = new Float32Array(n * 2);
    data.set(mix.left.subarray(off, off + n), 0);
    data.set(mix.right.subarray(off, off + n), n);
    const ad = new AudioData({ format: 'f32-planar', sampleRate: SAMPLE_RATE, numberOfFrames: n, numberOfChannels: 2, timestamp: Math.round(off / SAMPLE_RATE * 1e6), data });
    aenc.encode(ad);
    ad.close();
  }
  await aenc.flush();
  aenc.close();
  if (err) throw err;

  const canvas = document.createElement('canvas');
  canvas.width = W; canvas.height = H;
  const ctx = canvas.getContext('2d');
  const frames = Math.ceil(tl.duration * FPS), dur = 1e6 / FPS;
  for (let i = 0; i < frames; i++) {
    drawFrame(ctx, st, i / FPS);
    const vf = new VideoFrame(canvas, { timestamp: Math.round(i * dur), duration: Math.round(dur) });
    venc.encode(vf, { keyFrame: i % (FPS * 2) === 0 });
    vf.close();
    if (err) throw err;
    while (venc.encodeQueueSize > 8) await new Promise(r => setTimeout(r, 1));
    if (i % 10 === 0) { onProgress?.(i / frames); await new Promise(r => setTimeout(r, 0)); }
  }
  await venc.flush();
  venc.close();
  if (err) throw err;
  muxer.finalize();
  onProgress?.(1);
  return new Blob([target.buffer], { type: 'video/mp4' });
}
