// وضع اللايف: شاشة بث مستمرة (طابور + دورة خلفية + شاشة انتظار) وبث لعدة منصات عن طريق وسيط محلي (tools/live-relay.mjs)
import { normalizeReel, buildReelTimeline, allLines, lineKey } from './reel.js?v=mvps5por';
import { peekLine } from './tts.js?v=mvps5por';
import { audioCtx, mixTimeline, decode, SAMPLE_RATE } from './audio.js?v=mvps5por';
import { drawFrame, drawSlate } from './render.js?v=mvps5por';
import { loadBg, playBg } from './bg.js?v=mvps5por';
import { getBlob } from './mediastore.js?v=mvps5por';
import { getSettings } from './storage.js?v=mvps5por';

// بيجهّز ريل للتشغيل. من غير opts: الصوت من الكاش (من غير رصيد). مع opts.audioMap/manual: من الاستوديو مباشرة (من غير حفظ)
export async function prepare(raw, opts = {}) {
  const reel = normalizeReel(structuredClone(raw));
  const title = reel.title || reel.stories.find(s => s.headline)?.headline || 'ريل من غير عنوان';
  const lines = allLines(reel);
  if (!lines.length) return { id: reel.id, title, ready: false, why: 'مفيش سكريبت' };
  let audioMap = opts.audioMap, manual = opts.manual || null;
  if (!audioMap) {
    audioMap = new Map();
    let missing = 0;
    for (const l of lines) {
      const hit = await peekLine(l.text, l.speaker, reel.lang).catch(() => null);
      if (hit) audioMap.set(lineKey(l), hit); else missing++;
    }
    if (missing) return { id: reel.id, title, ready: false, why: `${missing} سطر من غير صوت في الكاش (ولّده من الاستوديو الأول بنفس الصوت)` };
  }
  const info = buildReelTimeline(reel, audioMap, manual);
  if (!info.real) return { id: reel.id, title, ready: false, why: 'الصوت لسه مش متولّد' };
  const bgs = new Map(), shots = new Map();
  for (const st of reel.stories) {
    if (st.media) { const b = await loadBg(st.media).catch(() => null); if (b) bgs.set(st.id, b); }
    for (const src of st.proof?.sources || []) {
      if (src.shot && !shots.has(src.shot.id)) { const b = await loadBg({ id: src.shot.id, kind: 'image' }).catch(() => null); if (b) shots.set(src.shot.id, b); }
    }
  }
  let music = null;
  if (reel.music?.id) {
    try { const blob = await getBlob(reel.music.id); if (blob) music = { buffer: await decode(await blob.arrayBuffer()), gain: reel.music.vol ?? 0.15 }; } catch { /* من غير موسيقى */ }
  }
  const tl = info.tl;
  tl.fx = getSettings().fx;
  tl.music = music;
  const mix = mixTimeline(tl.segs, tl.duration, tl.music, tl.fx);
  const buf = audioCtx().createBuffer(2, mix.left.length, SAMPLE_RATE);
  buf.copyToChannel(mix.left, 0); buf.copyToChannel(mix.right, 1);
  return { uid: Math.random().toString(36).slice(2, 9), id: reel.id, title, ready: true, reel, tl, hasB: info.hasB, bgs, shots, buf, duration: tl.duration };
}

/* ---------- محرك الشاشة ---------- */
// env: { cats, getLogo(), getTicker(), getSlateText(), getFmt() }
export function createEngine(canvas, env) {
  const ctx = canvas.getContext('2d');
  let running = false, raf = 0, timer = 0, lock = null, cur = null, bgIdx = 0, startedAt = 0, maxMin = 0;
  let bg = [], queue = [], master = null, streamDest = null, monitorOn = true, listener = () => {};
  let cap = null, capSide = 0, lastDraw = 0;

  const notify = () => listener({ running, onAir: cur ? { title: cur.p.title, from: cur.from, left: Math.max(0, cur.p.duration - (audioCtx().currentTime - cur.t0)) } : null, queue: queue.map(q => ({ uid: q.uid, title: q.title })), bgCount: bg.filter(x => x.ready).length });

  function graph() {
    const ac = audioCtx();
    if (master) return;
    master = ac.createGain();
    streamDest = ac.createMediaStreamDestination();
    master.connect(streamDest);
    // مصدر صامت شغّال طول الوقت: من غيره Chrome بيوقف سحب الصوت وقت السكوت فالصوت المسجّل بيتقدّم على الصورة
    const keep = ac.createConstantSource();
    keep.offset.value = 0.00002;
    keep.connect(streamDest);
    keep.start();
    if (monitorOn) master.connect(ac.destination);
  }

  function stateFor(p) {
    const fmt = env.getFmt();
    const ticker = env.getTicker();
    const reel = { ...p.reel, format: fmt, ticker: ticker ? { on: true, text: ticker, label: p.reel.ticker?.label || '' } : p.reel.ticker };
    return { reel, cats: env.cats, settings: getSettings(), tl: p.tl, hasB: p.hasB, focusIdx: 0, bgs: p.bgs, shots: p.shots, logo: env.getLogo(), avImgs: env.getAvImgs?.() };
  }

  function begin(p, from) {
    const ac = audioCtx();
    const gain = ac.createGain();
    const src = ac.createBufferSource();
    src.buffer = p.buf; src.connect(gain); gain.connect(master);
    const t0 = ac.currentTime + 0.05;
    src.start(t0);
    cur = { p, from, src, gain, t0, st: stateFor(p) };
    notify();
  }

  function end(fast) {
    if (!cur) return;
    const { p, src, gain } = cur;
    try {
      if (fast) { gain.gain.setTargetAtTime(0, audioCtx().currentTime, 0.03); src.stop(audioCtx().currentTime + 0.2); } else src.stop();
    } catch { /* خلص */ }
    for (const b of p.bgs.values()) playBg(b, false);
    cur = null;
  }

  function pickNext() {
    if (queue.length) return { p: queue.shift(), from: 'queue' };
    const ready = bg.filter(x => x.ready);
    if (ready.length) { bgIdx = (bgIdx + 1) % ready.length; return { p: ready[bgIdx], from: 'bg' }; }
    return null;
  }

  function frame() {
    if (!running) return;
    const ac = audioCtx();
    if (maxMin && Date.now() - startedAt > maxMin * 60000 && !cur) return stop();
    if (!cur || ac.currentTime - cur.t0 > cur.p.duration) {
      end();
      const n = pickNext();
      if (n) begin(n.p, n.from); else notify();
    }
    if (cur) {
      const t = Math.max(0, ac.currentTime - cur.t0);
      const tk = env.getTicker();
      cur.st.reel.ticker = tk ? { on: true, text: tk, label: cur.p.reel.ticker?.label || '' } : cur.p.reel.ticker;
      cur.st.reel.format = env.getFmt();
      const k = cur.st.tl.stories.findIndex(x => t >= x.start && t < x.end);
      const active = k >= 0 ? cur.st.reel.stories[cur.st.tl.stories[k].idx]?.id : null;
      for (const [id, b] of cur.p.bgs) playBg(b, id === active);
      drawFrame(ctx, cur.st, t);
    } else {
      const reel = { format: env.getFmt(), lang: getSettings().reelLang || 'ar', stories: [], ticker: { on: !!env.getTicker(), text: env.getTicker(), label: '' }, bumpers: {} };
      drawSlate(ctx, { reel, cats: env.cats, settings: getSettings(), logo: env.getLogo(), slateText: env.getSlateText() }, performance.now() / 1000);
    }
  }

  // بنرسم بحد أقصى 30 إطار/ث (أخف على الجهاز) وبننسخ للكانفس الأصغر اللي بيتبعت للبث
  const loop = now => {
    if (!running) return;
    if (!lastDraw || now - lastDraw >= 31) { lastDraw = now; frame(); copyToCap(); }
    raf = requestAnimationFrame(loop);
  };
  function copyToCap() {
    if (!cap) return;
    const w = canvas.width, h = canvas.height;
    const k = capSide / Math.min(w, h);
    const cw = Math.max(2, Math.round((w * k) / 2) * 2), ch = Math.max(2, Math.round((h * k) / 2) * 2);
    if (cap.width !== cw || cap.height !== ch) { cap.width = cw; cap.height = ch; }
    cap.getContext('2d').drawImage(canvas, 0, 0, cw, ch);
  }

  async function start(opts = {}) {
    if (running) return;
    const ac = audioCtx();
    await ac.resume();
    graph();
    maxMin = opts.maxMinutes || 0;
    startedAt = Date.now();
    running = true;
    try { lock = await navigator.wakeLock?.request('screen'); } catch { lock = null; }
    raf = requestAnimationFrame(loop);
    // لو التبويب اتخبّى الـrequestAnimationFrame بيقف: بنكمّل بمؤقّت عشان البث ما يتجمّدش
    timer = setInterval(() => { if (document.hidden) { frame(); copyToCap(); } }, 100);
    notify();
  }
  function stop() {
    running = false;
    cancelAnimationFrame(raf); clearInterval(timer);
    end(true);
    try { lock?.release(); } catch { /* خلص */ }
    lock = null;
    notify();
  }

  return {
    start, stop,
    get running() { return running; },
    onChange(fn) { listener = fn; },
    setBackground(items) { bg = items; notify(); },
    enqueue(p, { now = false } = {}) { queue.push(p); if (now) { end(true); } notify(); },
    cutNow() { end(true); notify(); },
    remove(uid) { queue = queue.filter(q => q.uid !== uid); notify(); },
    setMonitor(on) {
      monitorOn = on;
      if (master) { try { master.disconnect(audioCtx().destination); } catch { /* مش موصّل */ } if (on) master.connect(audioCtx().destination); }
    },
    // shortSide: أصغر ضلع في صورة البث (720 = HD). الصورة بتتصغّر هنا في المتصفح عشان الترميز يبقى أخف
    captureStream(fps = 30, shortSide = 720) {
      graph();
      capSide = shortSide;
      cap = document.createElement('canvas');
      copyToCap();
      return new MediaStream([...cap.captureStream(fps).getVideoTracks(), ...streamDest.stream.getAudioTracks()]);
    },
    releaseCapture() { cap = null; },
  };
}

/* ---------- البث للمنصات عن طريق الوسيط المحلي ---------- */
export function createBroadcaster(engine) {
  let ws = null, rec = null, hello = null, handler = () => {};
  const send = o => ws?.readyState === 1 && ws.send(JSON.stringify(o));

  function connect(url, token) {
    return new Promise((resolve, reject) => {
      try { ws?.close(); } catch { /* مقفول */ }
      let opened = false;
      try { ws = new WebSocket(`${url.replace(/\/+$/, '')}/?token=${encodeURIComponent(token || '')}`); } catch (e) { return reject(new Error('رابط الوسيط غلط.')); }
      ws.onerror = () => { if (!opened) reject(new Error('مقدرتش أوصل للوسيط. اتأكد إنه شغّال (node tools/live-relay.mjs) والرابط والرمز السري صح.')); };
      ws.onclose = () => { stopRecorder(); const was = opened; opened = false; hello = null; handler({ type: 'closed' }); if (!was) reject(new Error('الوسيط رفض الاتصال (الرمز السري غلط أو فيه جلسة تانية مفتوحة).')); };
      ws.onmessage = e => {
        let m; try { m = JSON.parse(e.data); } catch { return; }
        if (m.type === 'hello') { opened = true; hello = m; resolve(m); }
        if (m.type === 'ended') stopRecorder();
        handler(m);
      };
    });
  }
  function stopRecorder() { try { if (rec && rec.state !== 'inactive') rec.stop(); } catch { /* خلص */ } rec = null; engine.releaseCapture(); }

  function start({ outputs, side = 720, fps = 30, bitrate = 3500 }) {
    if (!ws || ws.readyState !== 1) throw new Error('مش متصل بالوسيط.');
    if (!engine.running) throw new Error('شغّل شاشة اللايف الأول.');
    if (typeof MediaRecorder === 'undefined') throw new Error('المتصفح ده مبيدعمش تسجيل البث. استخدم Chrome أو Edge.');
    const mime = ['video/webm;codecs=h264,opus', 'video/webm;codecs=vp8,opus', 'video/webm'].find(m => MediaRecorder.isTypeSupported(m));
    send({ type: 'start', outputs, fps, bitrate });
    rec = new MediaRecorder(engine.captureStream(fps, side), { mimeType: mime, videoBitsPerSecond: bitrate * 1000, audioBitsPerSecond: 128000 });
    rec.ondataavailable = e => { if (e.data.size && ws?.readyState === 1) { if (ws.bufferedAmount > 12e6) handler({ type: 'log', line: 'الإنترنت أبطأ من البث: فيه تأخير بيتراكم.' }); ws.send(e.data); } };
    rec.start(250);
  }
  function stopStream() { send({ type: 'stop' }); stopRecorder(); }
  function disconnect() { stopStream(); try { ws?.close(); } catch { /* مقفول */ } }

  return { connect, start, stop: stopStream, disconnect, onMessage(fn) { handler = fn; }, get connected() { return ws?.readyState === 1 && !!hello; }, get streaming() { return !!rec; }, get hello() { return hello; } };
}
