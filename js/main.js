import { load, save, getSettings, setSettings, charsUsed } from './storage.js';
import { loadConfig, loadFeeds, timeAgo, hostOf } from './feeds.js';
import { newReel, parseScript, buildTimeline, estimateWords } from './reel.js';
import { speakLine, voiceFor, MODELS } from './tts.js';
import { audioCtx, mixTimeline, Recorder, decode, SAMPLE_RATE } from './audio.js';
import { drawFrame } from './render.js';
import { exportSupport, exportReel } from './export.js';

const $ = id => document.getElementById(id);
const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

let cfg = null;          // config/sources.json
let feeds = { items: [] };
let reel = newReel(load('draft', {}));
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
  for (const id of ['feed', 'studio', 'settings']) $('tab-' + id).hidden = id !== name;
  if (name === 'studio') redraw();
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
  const errs = feeds.errors?.length ? ` • مصادر فشلت: ${feeds.errors.map(e => e.feed).join('، ')}` : '';
  $('feedInfo').textContent = `${gen} • ${items.length} خبر${errs}`;
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

function persist() { save('draft', reel); }

for (const id of ['fCat', 'fKind', 'fHead', 'fSrc', 'fUrl', 'fCredit', 'fScript']) {
  $(id).addEventListener('input', () => { readForm(); persist(); updateInfo(); redraw(); });
}
$('newReel').addEventListener('click', () => { if (confirm('تبدأ ريل جديد؟ المسودة الحالية هتتمسح.')) startReel({}); });

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
  const s = getSettings();
  if (s.monthlyChars && charsUsed() + chars > s.monthlyChars && !confirm(`ده هيعدّي رصيد الشهر (${charsUsed()} + ${chars} من ${s.monthlyChars}). تكمل؟`)) return;
  $('gen').disabled = true;
  manualAudio = null;
  try {
    let n = 0;
    for (const l of lines) {
      const k = lineKey(l);
      if (audioMap.has(k)) continue;
      setStatus(`بولّد سطر ${++n}/${todo.length}…`);
      audioMap.set(k, await speakLine(l.text, voiceFor(l.speaker)));
    }
    setStatus('تم توليد الصوت ✅');
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
    await document.fonts.load('800 80px Cairo').catch(() => {});
    setStatus('بصدّر الفيديو…');
    const blob = await exportReel(stateFor(info), support, p => { $('prog').firstElementChild.style.width = (p * 100).toFixed(0) + '%'; });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `reel-${new Date().toISOString().slice(0, 10)}-${cat(reel.category).id}.mp4`;
    a.click();
    setStatus(`تم ✅ (${(blob.size / 1e6).toFixed(1)} MB)`);
  } catch (e) { setStatus('فشل التصدير: ' + (e.message || e), true); }
  $('exp').disabled = false;
  $('prog').hidden = true;
});

/* ---------- الإعدادات ---------- */
const SETTING_FIELDS = { sChannel: 'channelName', sHandle: 'handle', sKey: 'elevenKey', sModel: 'elevenModel', sVoiceA: 'voiceA', sVoiceB: 'voiceB', sMonthly: 'monthlyChars', sProxy: 'proxyUrl' };

function fillSettings() {
  const s = getSettings();
  for (const [id, k] of Object.entries(SETTING_FIELDS)) $(id).value = s[k] ?? '';
  const used = charsUsed();
  $('usage').textContent = `الحروف المستهلكة الشهر ده: ${used}${s.monthlyChars ? ` من ${s.monthlyChars}` : ''}`;
}
$('sSave').addEventListener('click', () => {
  const o = {};
  for (const [id, k] of Object.entries(SETTING_FIELDS)) o[k] = k === 'monthlyChars' ? Number($(id).value) || 0 : $(id).value.trim();
  setSettings(o);
  $('sSaved').textContent = 'اتحفظ ✅';
  fillSettings();
  redraw();
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
  fillForm();
  try { feeds = await loadFeeds(); } catch { $('feedInfo').textContent = 'تعذر تحميل data/feeds.json.'; }
  renderFeed();
  document.fonts?.load('800 80px Cairo').then(() => redraw()).catch(() => {});
  window.__nrs = { get reel() { return reel; }, audioMap, setManual: b => { manualAudio = b; updateInfo(); redraw(); } };
})();
