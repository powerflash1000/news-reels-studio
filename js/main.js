import { load, save, getSettings, setSettings, charsUsed } from './storage.js';
import { listReels, getReel, upsertReel, deleteReel, setStatus as setReelStatus, currentId, setCurrentId, buildBackup, applyBackup } from './library.js';
import { loadConfig, loadFeeds, timeAgo, hostOf } from './feeds.js';
import { newReel, parseScript, buildTimeline, estimateWords, STATUSES } from './reel.js';
import { speakLine, peekLine, voiceFor, MODELS, fetchSubscription, lastSubscription, fetchVoices } from './tts.js';
import { audioCtx, mixTimeline, Recorder, decode, SAMPLE_RATE } from './audio.js';
import { drawFrame } from './render.js';
import { exportSupport, exportReel } from './export.js';

const $ = id => document.getElementById(id);
const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

let cfg = null;          // config/sources.json
let feeds = { items: [] };
let reel = newReel();
const audioMap = new Map(); // "A|نص" → {buffer, words}
let manualAudio = null;     // تسجيل أو ملف لكل الريل
let filterCat = 'all';
let recorder = null;
let playing = null;

const cat = id => cfg.categories.find(c => c.id === id) || cfg.categories[0];

function setStatus(msg, bad = false) {
  const el = $('status');
  el.textContent = msg;
  el.style.color = bad ? '#ff8a8a' : '';
}

/* ---------- التبويبات ---------- */
function showTab(name) {
  for (const b of document.querySelectorAll('#tabs button')) b.classList.toggle('on', b.dataset.tab === name);
  for (const id of ['feed', 'studio', 'library', 'settings']) $('tab-' + id).hidden = id !== name;
  if (name === 'studio') redraw();
  if (name === 'library') renderLibrary();
}
$('tabs').addEventListener('click', e => e.target.dataset.tab && showTab(e.target.dataset.tab));

/* ---------- الأخبار ---------- */
function renderChips() {
  const all = [{ id: 'all', label: 'الكل', color: '#3e63dd' }, ...cfg.categories];
  $('cats').innerHTML = all.map(c => `<button class="chip ${c.id === filterCat ? 'on' : ''}" data-c="${c.id}" style="--c:${c.color}">${c.label}</button>`).join('');
}
$('cats').addEventListener('click', e => { if (e.target.dataset.c) { filterCat = e.target.dataset.c; renderChips(); renderFeed(); } });
$('q').addEventListener('input', renderFeed);
$('showYt').addEventListener('change', renderFeed);

function renderFeed() {
  const q = $('q').value.trim().toLowerCase();
  const showYt = $('showYt').checked;
  const items = feeds.items.filter(i =>
    (filterCat === 'all' || i.category === filterCat) &&
    (showYt || i.kind !== 'youtube') &&
    (!q || (i.title + ' ' + i.summary + ' ' + i.source).toLowerCase().includes(q))).slice(0, 150);
  const gen = feeds.generatedAt ? `آخر تحديث: ${timeAgo(feeds.generatedAt)}` : 'لسه مفيش تحديث — شغّل الـ Action (fetch-feeds) من تبويب Actions في GitHub، أو أضف خبر يدويًا تحت.';
  const bad = (feeds.health || []).filter(h => h.status !== 'ok');
  $('feedInfo').textContent = `${gen} • ${items.length} خبر${bad.length ? ` • ⚠️ ${bad.length} مصدر فيه مشكلة (تحت)` : ''}`;
  renderHealth();
  $('feedList').innerHTML = items.map(i => {
    const c = cat(i.category);
    const yt = i.kind === 'youtube';
    return `<article class="item" style="--c:${c.color}">
      <h3 dir="auto">${esc(i.title)}</h3>
      <div class="meta"><span>${esc(i.source)}</span><span>${c.label}</span><span>${timeAgo(i.published)}</span>
        ${yt ? '<span class="tag">رادار — مش مصدر</span>' : ''}${i.lang === 'en' ? '<span>EN</span>' : ''}</div>
      ${i.summary ? `<div class="sum" dir="auto">${esc(i.summary.slice(0, 220))}</div>` : ''}
      <div class="row"><button class="btn pri" data-pick="${esc(i.id)}">اعمل ريل</button>
        <a class="btn ghost" href="${esc(i.link)}" target="_blank" rel="noopener">فتح</a>
        ${i.lang === 'en' ? `<button class="btn ghost" data-tr="${esc(i.id)}">ترجم العنوان</button>` : ''}</div>
    </article>`;
  }).join('');
}

const STAT_ICON = { ok: '✅', empty: '⚪', stale: '🕓', error: '❌' };
const STAT_TXT = { ok: 'سليم', empty: 'فاضي', stale: 'قديم', error: 'فشل' };
function renderHealth() {
  const h = feeds.health || [];
  $('health').hidden = !h.length;
  const bad = h.filter(x => x.status !== 'ok').length;
  $('healthSum').textContent = `صحة المصادر — ${h.length - bad} سليم${bad ? ` • ${bad} فيه مشكلة` : ''}`;
  $('healthList').innerHTML = [...h].sort((a, b) => (a.status === 'ok') - (b.status === 'ok')).map(x =>
    `<div class="hrow"><span>${STAT_ICON[x.status] || '•'}</span><div><b dir="auto">${esc(x.name)}</b>
      <span class="muted"> ${STAT_TXT[x.status] || x.status} • ${x.fetched ?? 0} اتجاب • ${x.kept ?? 0} فاضل${x.newest ? ' • أحدث: ' + timeAgo(x.newest) : ''}</span>
      ${x.error ? `<div class="e" dir="auto">${esc(x.error)}</div>` : ''}</div></div>`).join('');
}

$('feedList').addEventListener('click', async e => {
  const pick = e.target.dataset.pick, tr = e.target.dataset.tr;
  if (tr) return translateTitle(feeds.items.find(i => i.id === tr), e.target);
  if (!pick) return;
  const i = feeds.items.find(x => x.id === pick);
  if (!i) return;
  const yt = i.kind === 'youtube';
  startReel(yt
    ? { category: i.category, headline: i.title, fromYoutube: i.source, ytLink: i.link }
    : { category: i.category, headline: i.title, sourceName: i.source, sourceUrl: i.link });
});

async function translateTitle(item, btn) {
  try {
    if (!('Translator' in self)) throw new Error('المتصفح ده مفيهوش الترجمة المدمجة (محتاج Chrome حديث). ترجم يدويًا.');
    const t = await self.Translator.create({ sourceLanguage: 'en', targetLanguage: 'ar' });
    item.title = await t.translate(item.title);
    if (item.summary) item.summary = await t.translate(item.summary);
    item.lang = 'ar';
    renderFeed();
  } catch (err) { btn.textContent = String(err.message || err).slice(0, 60); }
}

$('mAdd').addEventListener('click', () => {
  const url = $('mUrl').value.trim();
  startReel({ category: $('mCat').value, headline: $('mTitle').value.trim(), sourceName: $('mSource').value.trim(), sourceUrl: url });
});

function startReel(over) {
  reel = newReel(over);
  audioMap.clear();
  manualAudio = null;
  persist();
  fillForm();
  showTab('studio');
  restoreAudio();
}

// بيسترجع الصوت المتولّد قبل كده من الكاش (من غير ما يستهلك رصيد)
async function restoreAudio() {
  const mine = reel.id;
  for (const l of parseScript(reel.script)) {
    if (audioMap.has(lineKey(l))) continue;
    try {
      const hit = await peekLine(l.text, l.speaker);
      if (hit && reel.id === mine) audioMap.set(lineKey(l), hit);
    } catch { /* الكاش اختياري */ }
  }
  if (reel.id === mine) { updateInfo(); redraw(); }
}

function openReel(id) {
  const r = getReel(id);
  if (!r) return;
  reel = newReel(r);
  audioMap.clear();
  manualAudio = null;
  setCurrentId(reel.id);
  fillForm();
  showTab('studio');
  restoreAudio();
}

/* ---------- الاستوديو ---------- */
function fillForm() {
  $('fCat').value = reel.category;
  $('fKind').value = reel.claimKind;
  $('fHead').value = reel.headline;
  $('fSrc').value = reel.sourceName;
  $('fUrl').value = reel.sourceUrl;
  $('fCredit').value = reel.credit;
  $('fScript').value = reel.script;
  const n = $('ytNote');
  n.hidden = !reel.fromYoutube;
  if (reel.fromYoutube) {
    n.innerHTML = `الخبر ده جاي من قناة «${esc(reel.fromYoutube)}» — اليوتيوبر مش مصدر. افتح المصدر الأصلي (بيان رسمي، دراسة، وكالة) وحط اسمه ورابطه تحت. ${reel.ytLink ? `<a href="${esc(reel.ytLink)}" target="_blank" rel="noopener" style="color:inherit">الفيديو</a>` : ''}`;
  }
  updateInfo();
  redraw();
}

function readForm() {
  reel.category = $('fCat').value;
  reel.claimKind = $('fKind').value;
  reel.headline = $('fHead').value.trim();
  reel.sourceName = $('fSrc').value.trim();
  reel.sourceUrl = $('fUrl').value.trim();
  reel.credit = $('fCredit').value.trim();
  reel.script = $('fScript').value;
}

function persist() {
  // ريل فاضي مبيتحفظش في المكتبة
  if (!reel.headline && !reel.script.trim() && !reel.sourceName) return;
  upsertReel(reel);
  setCurrentId(reel.id);
}

for (const id of ['fCat', 'fKind', 'fHead', 'fSrc', 'fUrl', 'fCredit', 'fScript']) {
  $(id).addEventListener('input', () => {
    readForm(); persist(); updateInfo(); redraw();
    if (id === 'fScript') { clearTimeout(restoreTimer); restoreTimer = setTimeout(restoreAudio, 600); }
  });
}
$('newReel').addEventListener('click', () => startReel({}));

let restoreTimer = 0;
function lineKey(l) { return l.speaker + '|' + l.text; }

// الخط الزمني: صوت حقيقي لو متاح، وإلا تقدير صامت للمعاينة
function currentTimeline() {
  const lines = parseScript(reel.script);
  if (manualAudio && lines.length) {
    const dur = manualAudio.duration;
    const text = lines.map(l => l.text).join(' ');
    const words = estimateWords(text, dur);
    return { tl: { segs: [{ speaker: 'A', text, start: 0.2, end: 0.2 + dur, at: 0.2, buffer: manualAudio, words: words.map(w => ({ ...w, s: w.s + 0.2, e: w.e + 0.2 })) }], duration: dur + 0.8 }, real: true, lines };
  }
  const real = lines.length > 0 && lines.every(l => audioMap.has(lineKey(l)));
  const auds = lines.map(l => audioMap.get(lineKey(l)) || (() => {
    const d = Math.max(1.5, l.text.length / 13);
    return { buffer: { duration: d }, words: estimateWords(l.text, d) };
  })());
  return { tl: lines.length ? buildTimeline(lines, auds) : { segs: [], duration: 3 }, real, lines };
}

function stateFor(tlInfo) {
  return { reel, cat: cat(reel.category), settings: getSettings(), tl: tlInfo.tl, hasB: tlInfo.lines.some(l => l.speaker === 'B') };
}

const ctx = $('cv').getContext('2d');
function redraw(t) {
  if (!cfg || $('tab-studio').hidden) return;
  const info = currentTimeline();
  const first = info.tl.segs[0];
  drawFrame(ctx, stateFor(info), t ?? (first ? first.start + 0.3 : 0));
}

function updateInfo() {
  const lines = parseScript(reel.script);
  const chars = lines.reduce((n, l) => n + l.text.length, 0);
  const words = lines.reduce((n, l) => n + l.text.split(/\s+/).length, 0);
  $('scriptInfo').textContent = lines.length ? `${lines.length} سطر • ${words} كلمة • ${chars} حرف • حوالي ${Math.round(words / 2.6)} ثانية` : '';
  const real = lines.length && (manualAudio || lines.every(l => audioMap.has(lineKey(l))));
  const done = lines.filter(l => audioMap.has(lineKey(l))).length;
  $('audioInfo').textContent = manualAudio ? `صوت مسجل/مرفوع (${manualAudio.duration.toFixed(1)} ث)` : real ? 'الصوت جاهز لكل السطور ✅' : `صوت ${done}/${lines.length} سطر.`;
}

/* ---------- الصوت ---------- */
$('gen').addEventListener('click', async () => {
  const lines = parseScript(reel.script);
  if (!lines.length) return setStatus('اكتب السكريبت الأول.', true);
  const todo = lines.filter(l => !audioMap.has(lineKey(l)));
  const chars = todo.reduce((n, l) => n + l.text.length, 0);
  const sub = lastSubscription();
  if (sub && sub.limit && chars > sub.limit - sub.used && !confirm(`المتبقي في رصيدك حوالي ${Math.max(0, sub.limit - sub.used)} حرف والتوليد محتاج ${chars}. تكمل؟`)) return;
  if (chars > 1500 && !confirm(`هيتولّد ${chars} حرف من رصيد ElevenLabs. تكمل؟`)) return;
  $('gen').disabled = true;
  manualAudio = null;
  try {
    let n = 0;
    for (const l of lines) {
      const k = lineKey(l);
      if (audioMap.has(k)) continue;
      setStatus(`بولّد سطر ${++n}/${todo.length}…`);
      audioMap.set(k, await speakLine(l.text, l.speaker));
    }
    setStatus('تم توليد الصوت ✅');
    if (n) fetchSubscription().then(fillUsage).catch(() => {});
  } catch (e) { setStatus(String(e.message || e), true); }
  $('gen').disabled = false;
  updateInfo();
  redraw();
});

$('rec').addEventListener('click', async () => {
  try {
    if (!recorder) {
      recorder = new Recorder();
      await recorder.start();
      $('rec').textContent = '⏹ إيقاف التسجيل';
      setStatus('بسجّل… اقرا السكريبت كله.');
    } else {
      const r = recorder; recorder = null;
      $('rec').textContent = '⏺ تسجيل بصوتي';
      manualAudio = await r.stop();
      setStatus('اتسجل ✅');
      updateInfo(); redraw();
    }
  } catch (e) { recorder = null; $('rec').textContent = '⏺ تسجيل بصوتي'; setStatus('المايك مش متاح: ' + (e.message || e), true); }
});

$('upl').addEventListener('change', async e => {
  const f = e.target.files[0];
  if (!f) return;
  try { manualAudio = await decode(await f.arrayBuffer()); setStatus('الملف اتحمل ✅'); updateInfo(); redraw(); }
  catch (err) { setStatus('مقدرتش أقرا الملف ده.', true); }
  e.target.value = '';
});

$('clearAudio').addEventListener('click', () => { manualAudio = null; audioMap.clear(); updateInfo(); redraw(); setStatus('اتمسح الصوت.'); });

async function loadFonts() {
  try { await Promise.all([600, 700, 800].flatMap(w => [document.fonts.load(`${w} 40px Cairo`, 'أبجد'), document.fonts.load(`${w} 40px Cairo`, 'Abc')])); } catch { /* هنستخدم الخط الاحتياطي */ }
}

/* ---------- المعاينة ---------- */
$('play').addEventListener('click', () => {
  if (playing) return stopPlay();
  const info = currentTimeline();
  const st = stateFor(info);
  const ac = audioCtx();
  ac.resume();
  let src = null;
  if (info.real) {
    const mix = mixTimeline(info.tl.segs, info.tl.duration);
    const buf = ac.createBuffer(2, mix.left.length, SAMPLE_RATE);
    buf.copyToChannel(mix.left, 0); buf.copyToChannel(mix.right, 1);
    src = ac.createBufferSource(); src.buffer = buf; src.connect(ac.destination);
  }
  const t0 = ac.currentTime + 0.05;
  src?.start(t0);
  $('play').textContent = '⏹ إيقاف';
  const tick = () => {
    const t = ac.currentTime - t0;
    if (t > st.tl.duration) return stopPlay();
    drawFrame(ctx, st, Math.max(0, t));
    $('time').textContent = `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, '0')}`;
    playing.raf = requestAnimationFrame(tick);
  };
  playing = { src, raf: 0 };
  tick();
});

function stopPlay() {
  if (!playing) return;
  cancelAnimationFrame(playing.raf);
  try { playing.src?.stop(); } catch { /* خلص */ }
  playing = null;
  $('play').textContent = '▶ معاينة';
  redraw();
}

/* ---------- التصدير ---------- */
function validateSource() {
  const probs = [];
  if (!reel.headline) probs.push('اكتب عنوان الريل.');
  if (!reel.sourceName) probs.push('اسم المصدر الأصلي إجباري.');
  let u = null;
  try { u = new URL(reel.sourceUrl); } catch { /* ناقص */ }
  if (!u || u.protocol !== 'https:' && u.protocol !== 'http:') probs.push('رابط المصدر لازم يكون صحيح (https://…).');
  else if (/(^|\.)(youtube\.com|youtu\.be)$/.test(u.hostname)) probs.push('رابط يوتيوب مش مصدر أصلي. حط المصدر الرسمي للخبر.');
  if (!parseScript(reel.script).length) probs.push('اكتب السكريبت.');
  return probs;
}

function checklistFor() {
  const base = ['المعلومات في السكريبت مطابقة للمصدر الأصلي المذكور.', 'السكريبت بأسلوبي، مش منقول من قناة أو موقع.'];
  if (reel.claimKind === 'opinion') base.push('واضح إن ده رأي/تحليل ومنسوب لصاحبه.');
  if (reel.category === 'health') base.push('مفيش نصيحة علاجية أو جرعات، والتنبيه الطبي ظاهر على الشاشة.');
  if (reel.category === 'politics') base.push('نقل خبري محايد من غير رأي شخصي.');
  return base;
}

function askChecklist() {
  const dlg = $('checkDlg');
  $('checkList').innerHTML = checklistFor().map((t, i) => `<label><input type="checkbox" data-i="${i}"> ${esc(t)}</label>`).join('');
  const ok = $('checkOk');
  const boxes = [...dlg.querySelectorAll('input[type=checkbox]')];
  ok.disabled = true;
  boxes.forEach(b => b.addEventListener('change', () => { ok.disabled = !boxes.every(x => x.checked); }));
  return new Promise(res => {
    dlg.addEventListener('close', () => res(dlg.returnValue === 'ok'), { once: true });
    dlg.returnValue = '';
    dlg.showModal();
  });
}

$('exp').addEventListener('click', async () => {
  readForm();
  const probs = validateSource();
  if (probs.length) return setStatus(probs.join(' '), true);
  const info = currentTimeline();
  if (!info.real) return setStatus('الصوت مش جاهز. ولّد الصوت أو سجّل/ارفع ملف الأول.', true);
  const support = await exportSupport();
  if (!support) return setStatus('المتصفح ده مبيدعمش التصدير السريع. استخدم Chrome أو Edge على الكمبيوتر.', true);
  if (!(await askChecklist())) return;
  stopPlay();
  $('exp').disabled = true;
  $('prog').hidden = false;
  try {
    await loadFonts();
    setStatus('بصدّر الفيديو…');
    const blob = await exportReel(stateFor(info), support, p => { $('prog').firstElementChild.style.width = (p * 100).toFixed(0) + '%'; });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `reel-${new Date().toISOString().slice(0, 10)}-${cat(reel.category).id}.mp4`;
    a.click();
    reel.status = 'exported';
    persist();
    setStatus(`تم ✅ (${(blob.size / 1e6).toFixed(1)} MB) — حالة الريل: متصدّر`);
  } catch (e) { setStatus('فشل التصدير: ' + (e.message || e), true); }
  $('exp').disabled = false;
  $('prog').hidden = true;
});

/* ---------- المكتبة ---------- */
let libStatus = 'all';
function renderLibrary() {
  const all = listReels();
  const q = $('libQ').value.trim().toLowerCase();
  const chips = [['all', 'الكل'], ...Object.entries(STATUSES)];
  $('libStatus').innerHTML = chips.map(([k, v]) => `<button class="chip ${k === libStatus ? 'on' : ''}" data-s="${k}">${v} ${k === 'all' ? all.length : all.filter(r => r.status === k).length}</button>`).join('');
  const rows = all.filter(r => (libStatus === 'all' || r.status === libStatus) && (!q || ((r.headline || '') + (r.script || '') + (r.sourceName || '')).toLowerCase().includes(q)));
  $('libList').innerHTML = rows.length ? rows.map(r => {
    const c = cat(r.category);
    return `<article class="item" style="--c:${c.color}">
      <h3 dir="auto">${esc(r.headline || '(من غير عنوان)')}</h3>
      <div class="meta"><span>${c.label}</span><span class="stat ${r.status}">${STATUSES[r.status] || r.status}</span><span>${esc(r.sourceName || 'من غير مصدر')}</span><span>${timeAgo(new Date(r.updatedAt).toISOString())}</span></div>
      <div class="row"><button class="btn pri" data-open="${r.id}">فتح</button>
        <select data-st="${r.id}">${Object.entries(STATUSES).map(([k, v]) => `<option value="${k}" ${k === r.status ? 'selected' : ''}>${v}</option>`).join('')}</select>
        <button class="btn ghost" data-dup="${r.id}">تكرار</button>
        <button class="btn ghost" data-del="${r.id}">حذف</button></div></article>`;
  }).join('') : '<p class="muted">مفيش ريلز لسه. ابدأ من تبويب الأخبار.</p>';
}
$('libQ').addEventListener('input', renderLibrary);
$('libStatus').addEventListener('click', e => { if (e.target.dataset.s) { libStatus = e.target.dataset.s; renderLibrary(); } });
$('libList').addEventListener('click', e => {
  const d = e.target.dataset;
  if (d.open) openReel(d.open);
  else if (d.dup) { const r = getReel(d.dup); if (r) { upsertReel(newReel({ ...r, id: undefined, status: 'draft', headline: (r.headline || '') + ' (نسخة)' })); renderLibrary(); } }
  else if (d.del && confirm('تحذف الريل ده نهائيًا؟')) { deleteReel(d.del); if (reel.id === d.del) startReel({}); renderLibrary(); }
});
$('libList').addEventListener('change', e => { if (e.target.dataset.st) { setReelStatus(e.target.dataset.st, e.target.value); if (reel.id === e.target.dataset.st) reel.status = e.target.value; renderLibrary(); } });

$('bkExport').addEventListener('click', () => {
  const blob = new Blob([JSON.stringify(buildBackup(), null, 1)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `news-reels-backup-${new Date().toISOString().slice(0, 10)}.json`;
  a.click();
  $('bkMsg').textContent = 'اتحفظت النسخة.';
});
$('bkImport').addEventListener('change', async e => {
  const f = e.target.files[0];
  e.target.value = '';
  if (!f) return;
  try {
    const r = applyBackup(JSON.parse(await f.text()));
    $('bkMsg').textContent = `تمت الاستعادة: ${r.added} جديد، ${r.updated} متحدّث، ${r.skipped} متخطّى.`;
    fillSettings(); renderLibrary();
  } catch (err) { $('bkMsg').textContent = 'فشلت الاستعادة: ' + (err.message || err); }
});

/* ---------- الإعدادات ---------- */
const TEXT_FIELDS = { sChannel: 'channelName', sHandle: 'handle', sKey: 'elevenKey', sModel: 'elevenModel', sProxy: 'proxyUrl' };
const SLIDERS = [['stability', 'الثبات', 0, 1, 0.05], ['similarity', 'التشابه', 0, 1, 0.05], ['style', 'التعبير', 0, 1, 0.05], ['speed', 'السرعة', 0.7, 1.2, 0.05]];
let voices = [];

function renderSliders(sp) {
  const v = getSettings()['vs' + sp];
  $('sl' + sp).innerHTML = SLIDERS.map(([k, label, min, max, step]) =>
    `<label>${label}<input type="range" data-sp="${sp}" data-k="${k}" min="${min}" max="${max}" step="${step}" value="${v[k]}"><output>${Number(v[k]).toFixed(2)}</output></label>`).join('');
}
document.addEventListener('input', e => {
  if (e.target.matches('.sliders input[type=range]')) e.target.nextElementSibling.textContent = Number(e.target.value).toFixed(2);
});

function renderVoiceSelect(sp) {
  const s = getSettings();
  const cur = s['voice' + sp];
  const opts = [{ id: '', name: sp === 'B' ? '— نفس صوت أ —' : '— اختار صوت —' }];
  for (const v of voices) opts.push({ id: v.id, name: `${v.name}${v.category === 'cloned' ? ' (مستنسخ)' : ''}` });
  if (cur && !opts.some(o => o.id === cur)) opts.push({ id: cur, name: s['voiceName' + sp] || cur });
  $('sVoice' + sp).innerHTML = opts.map(o => `<option value="${esc(o.id)}" ${o.id === cur ? 'selected' : ''}>${esc(o.name)}</option>`).join('');
  $('sVoice' + sp + 'Id').value = '';
}

function fillUsage(sub = lastSubscription()) {
  const bar = $('usageBar');
  if (sub && sub.limit) {
    const pct = Math.min(100, (sub.used / sub.limit) * 100);
    bar.hidden = false;
    bar.firstElementChild.style.width = pct.toFixed(0) + '%';
    const reset = sub.resetAt ? ` • بيتجدد ${new Date(sub.resetAt).toLocaleDateString('ar-EG')}` : '';
    $('usage').textContent = `استهلكت ${sub.used.toLocaleString('ar-EG')} من ${sub.limit.toLocaleString('ar-EG')} حرف (المتبقي ${(sub.limit - sub.used).toLocaleString('ar-EG')})${sub.tier ? ' • خطة ' + sub.tier : ''}${reset}`;
  } else {
    bar.hidden = true;
    $('usage').textContent = `اضغط «اختبر المفتاح» عشان يظهر رصيدك. الحروف اللي ولّدتها من الأداة الشهر ده: ${charsUsed().toLocaleString('ar-EG')}`;
  }
}

function fillSettings() {
  const s = getSettings();
  for (const [id, k] of Object.entries(TEXT_FIELDS)) $(id).value = s[k] ?? '';
  renderVoiceSelect('A'); renderVoiceSelect('B');
  renderSliders('A'); renderSliders('B');
  fillUsage();
}

function collectSettings() {
  const o = {};
  for (const [id, k] of Object.entries(TEXT_FIELDS)) o[k] = $(id).value.trim();
  for (const sp of ['A', 'B']) {
    const manual = $('sVoice' + sp + 'Id').value.trim();
    const sel = $('sVoice' + sp);
    o['voice' + sp] = manual || sel.value;
    o['voiceName' + sp] = manual ? '' : (sel.selectedOptions[0]?.textContent || '');
    const vs = {};
    for (const r of $('sl' + sp).querySelectorAll('input[type=range]')) vs[r.dataset.k] = Number(r.value);
    o['vs' + sp] = vs;
  }
  return o;
}

function saveSettings() { setSettings(collectSettings()); }

$('sSave').addEventListener('click', () => {
  saveSettings();
  $('sSaved').textContent = 'اتحفظ ✅';
  fillSettings();
  redraw();
});

$('elTest').addEventListener('click', async () => {
  saveSettings();
  $('usage').textContent = 'بتأكد من المفتاح…';
  try { fillUsage(await fetchSubscription()); } catch (e) { $('usageBar').hidden = true; $('usage').textContent = '❌ ' + (e.message || e); }
});

$('elVoices').addEventListener('click', async () => {
  saveSettings();
  $('usage').textContent = 'بحمّل الأصوات…';
  try {
    voices = await fetchVoices();
    renderVoiceSelect('A'); renderVoiceSelect('B');
    $('usage').textContent = `اتحمّل ${voices.length} صوت من حسابك. اختار صوت المذيع أ وب وبعدها «حفظ الإعدادات».`;
  } catch (e) { $('usage').textContent = '❌ ' + (e.message || e); }
});

let previewEl = null;
document.querySelector('#tab-settings').addEventListener('click', async e => {
  const sp = e.target.dataset.prev || e.target.dataset.try;
  if (!sp) return;
  try {
    if (e.target.dataset.prev) {
      const id = $('sVoice' + sp + 'Id').value.trim() || $('sVoice' + sp).value;
      const v = voices.find(x => x.id === id);
      if (!v?.preview) throw new Error('حمّل أصوات حسابك الأول (العينة بتيجي من ElevenLabs).');
      previewEl?.pause();
      previewEl = new Audio(v.preview);
      await previewEl.play();
    } else {
      saveSettings();
      e.target.disabled = true;
      const r = await speakLine('أهلاً بيكم في نشرة اليوم، ودي تجربة للصوت.', sp);
      const ac = audioCtx();
      ac.resume();
      const src = ac.createBufferSource();
      src.buffer = r.buffer; src.connect(ac.destination); src.start();
      fetchSubscription().then(fillUsage).catch(() => {});
    }
  } catch (err) { $('usage').textContent = '❌ ' + (err.message || err); }
  e.target.disabled = false;
});

/* ---------- تشغيل ---------- */
(async function init() {
  $('sModel').innerHTML = MODELS.map(m => `<option value="${m.id}">${m.name}</option>`).join('');
  cfg = await loadConfig();
  const opts = cfg.categories.map(c => `<option value="${c.id}">${c.label}</option>`).join('');
  $('fCat').innerHTML = opts;
  $('mCat').innerHTML = opts;
  renderChips();
  fillSettings();
  const cur = currentId() && getReel(currentId());
  if (cur) reel = newReel(cur);
  fillForm();
  restoreAudio();
  try { feeds = await loadFeeds(); } catch { $('feedInfo').textContent = 'تعذر تحميل data/feeds.json.'; }
  renderFeed();
  loadFonts().then(() => redraw());
  window.__nrs = { get reel() { return reel; }, audioMap, setManual: b => { manualAudio = b; updateInfo(); redraw(); } };
})();
