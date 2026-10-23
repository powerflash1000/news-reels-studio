// وضع اللايف: بيشغّل ريلز من المكتبة في دورة مستمرة على كانفس واحد (تشاركه في OBS أو أي برنامج بث)
import { normalizeReel, buildReelTimeline, allLines, lineKey } from './reel.js?v=mvlkiyq9';
import { peekLine } from './tts.js?v=mvlkiyq9';
import { audioCtx, mixTimeline, decode, SAMPLE_RATE } from './audio.js?v=mvlkiyq9';
import { drawFrame } from './render.js?v=mvlkiyq9';
import { loadBg, playBg } from './bg.js?v=mvlkiyq9';
import { getBlob } from './mediastore.js?v=mvlkiyq9';
import { getSettings } from './storage.js?v=mvlkiyq9';

// بيجهّز ريل للتشغيل: الصوت من الكاش (من غير رصيد)، الخلفيات، الموسيقى، والميكس الجاهز
export async function prepare(raw) {
  const reel = normalizeReel(raw);
  const title = reel.title || reel.stories.find(s => s.headline)?.headline || 'ريل من غير عنوان';
  const lines = allLines(reel);
  if (!lines.length) return { id: reel.id, title, ready: false, why: 'مفيش سكريبت' };
  const audioMap = new Map();
  let missing = 0;
  for (const l of lines) {
    const hit = await peekLine(l.text, l.speaker, reel.lang).catch(() => null);
    if (hit) audioMap.set(lineKey(l), hit); else missing++;
  }
  if (missing) return { id: reel.id, title, ready: false, why: `${missing} سطر من غير صوت في الكاش (ولّده من الاستوديو الأول بنفس الصوت)` };
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
  const info = buildReelTimeline(reel, audioMap, null);
  const tl = info.tl;
  tl.fx = getSettings().fx;
  tl.music = music;
  const mix = mixTimeline(tl.segs, tl.duration, tl.music, tl.fx);
  const ac = audioCtx();
  const buf = ac.createBuffer(2, mix.left.length, SAMPLE_RATE);
  buf.copyToChannel(mix.left, 0); buf.copyToChannel(mix.right, 1);
  return { id: reel.id, title, ready: true, reel, tl, hasB: info.hasB, bgs, shots, buf, duration: tl.duration };
}

// cfg: { items: [prepared], fmt, mode: 'loop'|'count'|'minutes', limit, cats, logo, tickerText: () => string, onStatus }
export function createRunner(canvas) {
  const ctx = canvas.getContext('2d');
  let stopped = true, raf = 0, timer = 0, src = null, lock = null, current = null, abort = null;

  async function playOne(p, cfg) {
    const ac = audioCtx();
    await ac.resume();
    const tk = cfg.tickerText?.();
    const reel = { ...p.reel, format: cfg.fmt, ticker: tk ? { on: true, text: tk, label: p.reel.ticker?.label || '' } : p.reel.ticker };
    const st = { reel, cats: cfg.cats, settings: getSettings(), tl: p.tl, hasB: p.hasB, focusIdx: 0, bgs: p.bgs, shots: p.shots, logo: cfg.logo };
    src = ac.createBufferSource(); src.buffer = p.buf; src.connect(ac.destination);
    const t0 = ac.currentTime + 0.05;
    src.start(t0);
    await new Promise(resolve => {
      const frame = () => {
        if (stopped) return finish();
        const t = ac.currentTime - t0;
        if (t > p.duration) return finish();
        const k = st.tl.stories.findIndex(x => t >= x.start && t < x.end);
        const active = k >= 0 ? reel.stories[st.tl.stories[k].idx]?.id : null;
        for (const [id, b] of p.bgs) playBg(b, id === active);
        drawFrame(ctx, st, Math.max(0, t));
      };
      const finish = () => { cancelAnimationFrame(raf); clearInterval(timer); abort = null; resolve(); };
      abort = finish;
      raf = 0;
      const loop = () => { frame(); if (!stopped) raf = requestAnimationFrame(loop); };
      loop();
      // لو التبويب اتخبّى الـrequestAnimationFrame بيقف، فبنكمّل بمؤقّت بطيء عشان الدورة ما تتجمّدش
      timer = setInterval(() => { if (document.hidden) frame(); }, 200);
    });
    for (const b of p.bgs.values()) playBg(b, false);
    try { src.stop(); } catch { /* خلص */ }
    src = null;
  }

  async function run(cfg) {
    const items = cfg.items.filter(p => p.ready);
    if (!items.length) throw new Error('مفيش ريلز جاهزة للتشغيل.');
    stopped = false;
    try { lock = await navigator.wakeLock?.request('screen'); } catch { lock = null; }
    const startedAt = Date.now();
    let round = 0;
    while (!stopped) {
      round++;
      for (let i = 0; i < items.length && !stopped; i++) {
        current = items[i];
        const left = cfg.mode === 'minutes' ? Math.max(0, Math.round((cfg.limit * 60000 - (Date.now() - startedAt)) / 60000)) : null;
        cfg.onStatus?.(`▶ ${current.title.slice(0, 40)} — ريل ${i + 1}/${items.length} • دورة ${round}${left != null ? ` • متبقي ~${left} دقيقة` : ''}${cfg.mode === 'count' ? ` من ${cfg.limit}` : ''}`);
        await playOne(current, cfg);
        if (cfg.mode === 'minutes' && Date.now() - startedAt >= cfg.limit * 60000) stopped = true;
      }
      if (cfg.mode === 'count' && round >= cfg.limit) stopped = true;
    }
    stop();
    cfg.onStatus?.('⏹ اللايف وقف.');
  }

  function stop() {
    stopped = true;
    cancelAnimationFrame(raf); clearInterval(timer);
    abort?.();
    try { src?.stop(); } catch { /* خلص */ }
    try { lock?.release(); } catch { /* خلص */ }
    lock = null; src = null;
  }
  return { run, stop, get running() { return !stopped; } };
}
