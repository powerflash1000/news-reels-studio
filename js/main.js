import { load, save, getSettings, setSettings, charsUsed } from './storage.js?v=mv09r3aw';
import { listReels, getReel, upsertReel, deleteReel, setStatus as setReelStatus, currentId, setCurrentId, buildBackup, applyBackup } from './library.js?v=mv09r3aw';
import { loadConfig, loadFeeds, timeAgo, hostOf } from './feeds.js?v=mv09r3aw';
import { newReel, newStory, normalizeReel, isEmptyStory, parseScript, buildReelTimeline, allLines, lineKey, STATUSES, KINDS } from './reel.js?v=mv09r3aw';
import { speakLine, peekLine, voiceFor, MODELS, fetchSubscription, lastSubscription, fetchVoices } from './tts.js?v=mv09r3aw';
import { audioCtx, mixTimeline, Recorder, decode, SAMPLE_RATE } from './audio.js?v=mv09r3aw';
import { drawFrame } from './render.js?v=mv09r3aw';
import { exportSupport, exportReel } from './export.js?v=mv09r3aw';
import { PROVIDERS, searchAll, fetchBlob } from './media.js?v=mv09r3aw';
import { putBlob } from './mediastore.js?v=mv09r3aw';
import { loadBg, playBg } from './bg.js?v=mv09r3aw';

const $ = id => document.getElementById(id);
const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

let cfg = null;          // config/sources.json
let feeds = { items: [] };
let reel = newReel();
let cur = 0;               // رقم الخبر اللي بنعدّله
const bgs = new Map();     // story.id → خلفية محمّلة
const picked = new Set();  // أخبار متحددة من تبويب الأخبار
const story = () => reel.stories[cur];
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
  for (const id of ['feed', 'studio', 'media', 'library', 'settings']) $('tab-' + id).hidden = id !== name;
  if (name === 'studio') redraw();
  if (name === 'library') renderLibrary();
  if (name === 'media') renderMediaTarget();
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
  renderPickBar();
  $('feedList').innerHTML = items.map(i => {
    const c = cat(i.category);
    const yt = i.kind === 'youtube';
    return `<article class="item" style="--c:${c.color}">
      <h3 dir="auto">${esc(i.title)}</h3>
      <div class="meta"><span>${esc(i.source)}</span><span>${c.label}</span><span>${timeAgo(i.published)}</span>
        ${yt ? '<span class="tag">رادار — مش مصدر</span>' : ''}${i.lang === 'en' ? '<span>EN</span>' : ''}</div>
      ${i.summary ? `<div class="sum" dir="auto">${esc(i.summary.slice(0, 220))}</div>` : ''}
      <div class="row"><label class="pk"><input type="checkbox" data-chk="${esc(i.id)}" ${picked.has(i.id) ? 'checked' : ''}> حدّد</label>
        <button class="btn pri" data-pick="${esc(i.id)}">ريل جديد</button>
        <button class="btn" data-add="${esc(i.id)}">＋ للريل الحالي</button>
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

const storyFromItem = i => i.kind === 'youtube'
  ? { category: i.category, headline: i.title, fromYoutube: i.source, ytLink: i.link }
  : { category: i.category, headline: i.title, sourceName: i.source, sourceUrl: i.link };

function renderPickBar() {
  $('pickBar').hidden = !picked.size;
  $('pickCount').textContent = `محدد ${picked.size} خبر`;
}

$('feedList').addEventListener('click', e => {
  const d = e.target.dataset;
  if (d.tr) return translateTitle(feeds.items.find(i => i.id === d.tr), e.target);
  if (d.chk) { e.target.checked ? picked.add(d.chk) : picked.delete(d.chk); return renderPickBar(); }
  const i = feeds.items.find(x => x.id === (d.pick || d.add));
  if (!i) return;
  if (d.pick) startReel([storyFromItem(i)]);
  else addStories([storyFromItem(i)]);
});

$('pickGo').addEventListener('click', () => { startReel(pickedStories()); picked.clear(); renderFeed(); });
$('pickAdd').addEventListener('click', () => { addStories(pickedStories()); picked.clear(); renderFeed(); });
$('pickClear').addEventListener('click', () => { picked.clear(); renderFeed(); });
function pickedStories() { return feeds.items.filter(i => picked.has(i.id)).map(storyFromItem); }

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
  startReel([{ category: $('mCat').value, headline: $('mTitle').value.trim(), sourceName: $('mSource').value.trim(), sourceUrl: $('mUrl').value.trim() }]);
});

// ريل جديد من قايمة أخبار (كل عنصر بيتحول لخبر)
function startReel(storyOvers = [{}]) {
  reel = newReel({ stories: (storyOvers.length ? storyOvers : [{}]).map(o => newStory(o)) });
  cur = 0;
  audioMap.clear();
  manualAudio = null;
  persist();
  fillForm();
  showTab('studio');
  restoreAudio();
}

// إضافة أخبار للريل الحالي (لو الريل لسه فاضي بنستبدل الخبر الفاضي)
function addStories(overs) {
  if (reel.stories.length === 1 && isEmptyStory(reel.stories[0])) return startReel(overs);
  reel.stories.push(...overs.map(o => newStory(o)));
  cur = reel.stories.length - overs.length;
  persist();
  fillForm();
  showTab('studio');
  restoreAudio();
}

// بيسترجع الصوت المتولّد قبل كده من الكاش (من غير ما يستهلك رصيد)
async function restoreAudio() {
  const mine = reel.id;
  for (const l of allLines(reel)) {
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
  reel = normalizeReel(r);
  cur = 0;
  audioMap.clear();
  manualAudio = null;
  setCurrentId(reel.id);
  fillForm();
  showTab('studio');
  restoreAudio();
}

/* ---------- الاستوديو ---------- */
function renderStrip() {
  $('storyTabs').innerHTML = reel.stories.map((st, i) => {
    const c = st.kind === 'news' ? cat(st.category) : { color: '#6b7cff' };
    const label = (st.headline || (st.kind === 'news' ? 'خبر فاضي' : KINDS[st.kind])).slice(0, 18);
    return `<button class="chip ${i === cur ? 'on' : ''}" data-i="${i}" style="--c:${c.color}">${i + 1}. ${st.kind !== 'news' ? `<small>${KINDS[st.kind]}</small> ` : ''}${esc(label)}</button>`;
  }).join('');
  $('stUp').disabled = cur === 0;
  $('stDown').disabled = cur === reel.stories.length - 1;
  $('stDel').disabled = reel.stories.length === 1 && isEmptyStory(story());
}

function fillForm() {
  const st = story();
  $('rTitle').value = reel.title || '';
  $('fCat').value = st.category;
  $('fKind').value = st.claimKind;
  $('fHead').value = st.headline;
  $('fSrc').value = st.sourceName;
  $('fUrl').value = st.sourceUrl;
  $('fCredit').value = st.credit;
  $('fScript').value = st.script;
  const news = st.kind === 'news';
  $('newsFields1').hidden = !news;
  $('newsFields2').hidden = !news;
  const n = $('ytNote');
  n.hidden = !(news && st.fromYoutube);
  if (st.fromYoutube) {
    n.innerHTML = `الخبر ده جاي من قناة «${esc(st.fromYoutube)}» — اليوتيوبر مش مصدر. افتح المصدر الأصلي (بيان رسمي، دراسة، وكالة) وحط اسمه ورابطه فوق. ${st.ytLink ? `<a href="${esc(st.ytLink)}" target="_blank" rel="noopener" style="color:inherit">الفيديو</a>` : ''}`;
  }
  renderStrip();
  renderBgInfo();
  updateInfo();
  redraw();
  ensureBgs();
}

function readForm() {
  const st = story();
  reel.title = $('rTitle').value.trim();
  st.category = $('fCat').value;
  st.claimKind = $('fKind').value;
  st.headline = $('fHead').value.trim();
  st.sourceName = $('fSrc').value.trim();
  st.sourceUrl = $('fUrl').value.trim();
  st.credit = $('fCredit').value.trim();
  st.script = $('fScript').value;
}

function persist() {
  // ريل فاضي مبيتحفظش في المكتبة
  if (reel.stories.every(isEmptyStory) && !reel.title) return;
  upsertReel(reel);
  setCurrentId(reel.id);
}

for (const id of ['rTitle', 'fCat', 'fKind', 'fHead', 'fSrc', 'fUrl', 'fCredit', 'fScript']) {
  $(id).addEventListener('input', () => {
    readForm(); persist(); updateInfo(); redraw();
    if (id === 'fHead' || id === 'fCat') renderStrip();
    if (id === 'fScript') { clearTimeout(restoreTimer); restoreTimer = setTimeout(restoreAudio, 600); }
  });
}
$('newReel').addEventListener('click', () => startReel([{}]));

// أخبار الريل
$('storyTabs').addEventListener('click', e => {
  if (e.target.dataset.i == null) return;
  readForm(); cur = Number(e.target.dataset.i); fillForm();
});
function addKind(kind) {
  readForm();
  reel.stories.push(newStory({ kind }));
  cur = reel.stories.length - 1;
  persist(); fillForm();
}
$('addStory').addEventListener('click', () => addKind('news'));
$('addIntro').addEventListener('click', () => addKind('intro'));
$('addOutro').addEventListener('click', () => addKind('outro'));
function moveStory(d) {
  readForm();
  const j = cur + d;
  if (j < 0 || j >= reel.stories.length) return;
  [reel.stories[cur], reel.stories[j]] = [reel.stories[j], reel.stories[cur]];
  cur = j; persist(); fillForm();
}
$('stUp').addEventListener('click', () => moveStory(-1));
$('stDown').addEventListener('click', () => moveStory(1));
$('stDup').addEventListener('click', () => {
  readForm();
  reel.stories.splice(cur + 1, 0, newStory({ ...story(), id: undefined }));
  cur++; persist(); fillForm();
});
$('stDel').addEventListener('click', () => {
  if (reel.stories.length === 1) reel.stories[0] = newStory({ kind: reel.stories[0].kind });
  else { reel.stories.splice(cur, 1); cur = Math.min(cur, reel.stories.length - 1); }
  persist(); fillForm();
});

let restoreTimer = 0;

// الخط الزمني: صوت حقيقي لو متاح، وإلا تقدير صامت للمعاينة
function currentTimeline() { return buildReelTimeline(reel, audioMap, manualAudio); }

function stateFor(info) {
  return { reel, cats: cfg.categories, settings: getSettings(), tl: info.tl, hasB: info.hasB, focusIdx: cur, bgs };
}

const ctx = $('cv').getContext('2d');
function redraw(t) {
  if (!cfg || $('tab-studio').hidden) return;
  const info = currentTimeline();
  const r = info.tl.stories.find(x => x.idx === cur);
  const seg = info.tl.segs.find(x => x.storyIdx === cur);
  drawFrame(ctx, stateFor(info), t ?? (r ? (seg ? seg.start + 0.3 : r.start) : 0));
}

function updateInfo() {
  const all = allLines(reel);
  const mine = parseScript(story().script);
  const chars = mine.reduce((n, l) => n + l.text.length, 0);
  const words = mine.reduce((n, l) => n + l.text.split(/\s+/).length, 0);
  const info = currentTimeline();
  $('scriptInfo').textContent = (mine.length ? `الخبر ده: ${mine.length} سطر • ${words} كلمة • ${chars} حرف • حوالي ${Math.round(words / 2.6)} ثانية. ` : '') +
    (reel.stories.length > 1 ? `الحلقة كلها: ${reel.stories.length} أخبار • حوالي ${Math.round(info.tl.duration)} ثانية.` : '');
  const real = all.length && (manualAudio || all.every(l => audioMap.has(lineKey(l))));
  const done = all.filter(l => audioMap.has(lineKey(l))).length;
  $('audioInfo').textContent = manualAudio ? `صوت مسجل/مرفوع (${manualAudio.duration.toFixed(1)} ث) للحلقة كلها` : real ? 'الصوت جاهز لكل السطور ✅' : `صوت ${done}/${all.length} سطر في الحلقة.`;
}

/* ---------- الصوت ---------- */
$('gen').addEventListener('click', async () => {
  readForm();
  const lines = allLines(reel);
  if (!lines.length) return setStatus('اكتب السكريبت الأول.', true);
  const seen = new Set();
  const todo = lines.filter(l => { const k = lineKey(l); if (audioMap.has(k) || seen.has(k)) return false; seen.add(k); return true; });
  const chars = todo.reduce((n, l) => n + l.text.length, 0);
  const sub = lastSubscription();
  if (sub && sub.limit && chars > sub.limit - sub.used && !confirm(`المتبقي في رصيدك حوالي ${Math.max(0, sub.limit - sub.used)} حرف والتوليد محتاج ${chars}. تكمل؟`)) return;
  if (chars > 1500 && !confirm(`هيتولّد ${chars} حرف من رصيد ElevenLabs. تكمل؟`)) return;
  $('gen').disabled = true;
  manualAudio = null;
  try {
    let n = 0;
    for (const l of todo) {
      setStatus(`بولّد سطر ${++n}/${todo.length}…`);
      audioMap.set(lineKey(l), await speakLine(l.text, l.speaker));
    }
    setStatus(n ? 'تم توليد الصوت ✅' : 'الصوت كله جاهز من الكاش ✅');
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
      setStatus('بسجّل… اقرا سكريبت الحلقة كله بالترتيب.');
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
    syncPlayback(st, t);
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
  for (const b of bgs.values()) playBg(b, false);
  playing = null;
  $('play').textContent = '▶ معاينة';
  redraw();
}

/* ---------- التصدير ---------- */
const hasContent = st => parseScript(st.script).length > 0;

function validateReel() {
  const probs = [];
  const live = reel.stories.map((st, i) => ({ st, n: i + 1 })).filter(x => hasContent(x.st));
  if (!live.length) probs.push('اكتب السكريبت.');
  for (const { st, n } of reel.stories.map((st, i) => ({ st, n: i + 1 }))) {
    if (!hasContent(st) && (st.headline || st.sourceName || st.sourceUrl)) probs.push(`الخبر ${n}: مفيش سكريبت (اكتبه أو احذف الخبر).`);
  }
  for (const { st, n } of live) {
    const pre = reel.stories.length > 1 ? `الخبر ${n}: ` : '';
    if (!st.headline) probs.push(pre + 'اكتب العنوان.');
    if (st.kind !== 'news') continue;
    if (!st.sourceName) probs.push(pre + 'اسم المصدر الأصلي إجباري.');
    let u = null;
    try { u = new URL(st.sourceUrl); } catch { /* ناقص */ }
    if (!u || (u.protocol !== 'https:' && u.protocol !== 'http:')) probs.push(pre + 'رابط المصدر لازم يكون صحيح (https://…).');
    else if (/(^|\.)(youtube\.com|youtu\.be)$/.test(u.hostname)) probs.push(pre + 'رابط يوتيوب مش مصدر أصلي. حط المصدر الرسمي للخبر.');
  }
  return probs;
}

function checklistFor() {
  const news = reel.stories.filter(st => st.kind === 'news' && hasContent(st));
  const base = ['المعلومات في السكريبت مطابقة للمصدر الأصلي المذكور.', 'السكريبت بأسلوبي، مش منقول من قناة أو موقع.'];
  if (news.length > 1) base.push('كل خبر ليه مصدره الخاص على الشاشة، والترتيب والعناوين مظبوطة.');
  if (news.some(s => s.claimKind === 'opinion')) base.push('واضح إن ده رأي/تحليل ومنسوب لصاحبه.');
  if (news.some(s => s.category === 'health')) base.push('مفيش نصيحة علاجية أو جرعات، والتنبيه الطبي ظاهر على الشاشة.');
  if (news.some(s => s.category === 'politics')) base.push('نقل خبري محايد من غير رأي شخصي.');
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
  const probs = validateReel();
  if (probs.length) return setStatus(probs.join(' '), true);
  await ensureBgs();
  const missing = reel.stories.map((st, i) => ({ st, n: i + 1 })).filter(x => x.st.media && hasContent(x.st) && !bgs.has(x.st.id));
  if (missing.length) return setStatus(`خلفية الخبر ${missing.map(x => x.n).join('، ')} مش موجودة على الجهاز ده. اختارها تاني أو شيلها.`, true);
  const info = currentTimeline();
  if (!info.real) return setStatus('الصوت مش جاهز. ولّد الصوت أو سجّل/ارفع ملف الأول.', true);
  const support = await exportSupport();
  if (!support) return setStatus('المتصفح ده مبيدعمش التصدير السريع. استخدم Chrome أو Edge على الكمبيوتر.', true);
  if (info.tl.duration > 90 && !confirm(`الحلقة ${Math.round(info.tl.duration)} ثانية، وإنستجرام ريلز بيفضّل لحد 90 ثانية. تكمل؟`)) return;
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
    const n = info.tl.stories.length;
    a.download = `reel-${new Date().toISOString().slice(0, 10)}-${n > 1 ? n + 'news' : cat(reel.stories[info.tl.stories[0].idx].category).id}.mp4`;
    a.click();
    reel.status = 'exported';
    persist();
    setStatus(`تم ✅ (${(blob.size / 1e6).toFixed(1)} MB) — حالة الريل: متصدّر`);
  } catch (e) { setStatus('فشل التصدير: ' + (e.message || e), true); }
  $('exp').disabled = false;
  $('prog').hidden = true;
});

/* ---------- خلفيات الأخبار ---------- */
async function ensureBgs() {
  let changed = false;
  for (const st of reel.stories) {
    if (!st.media || bgs.has(st.id)) continue;
    const b = await loadBg(st.media);
    if (b) { bgs.set(st.id, b); changed = true; }
  }
  if (changed) redraw();
  renderBgInfo();
}

function syncPlayback(st, t) {
  const k = st.tl.stories.findIndex(x => t >= x.start && t < x.end);
  const activeId = k >= 0 ? st.reel.stories[st.tl.stories[k].idx]?.id : null;
  for (const [id, b] of bgs) playBg(b, id === activeId);
}

function renderBgInfo() {
  const m = story().media;
  const el = $('bgInfo');
  if (!m) { el.textContent = 'من غير خلفية (لون القسم بس).'; $('bgDim').value = 0.5; return; }
  const ok = bgs.has(story().id);
  el.innerHTML = `${m.kind === 'video' ? '🎞' : '🖼'} <b dir="auto">${esc(m.title || 'خلفية')}</b> — ${esc(m.license || '')}${m.page ? ` — <a href="${esc(m.page)}" target="_blank" rel="noopener" style="color:inherit">المصدر</a>` : ''}${ok ? '' : ' <span style="color:#ffb86b">⚠️ الملف مش موجود على الجهاز ده — اختار الخلفية تاني</span>'}`;
  $('bgDim').value = m.dim ?? 0.5;
}

$('bgDim').addEventListener('input', () => { const m = story().media; if (m) { m.dim = Number($('bgDim').value); persist(); redraw(); } });
$('bgClear').addEventListener('click', () => { const st = story(); st.media = null; bgs.delete(st.id); persist(); renderBgInfo(); redraw(); });
$('bgPick').addEventListener('click', () => showTab('media'));

async function attachMedia(blob, meta) {
  const st = story();
  const id = 'm' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5);
  await putBlob(id, blob);
  st.media = { id, dim: 0.5, ...meta };
  bgs.delete(st.id);
  persist();
  const b = await loadBg(st.media);
  if (!b) { st.media = null; persist(); throw new Error('الملف اتحمل بس مقدرتش أفتحه (صيغة غير مدعومة).'); }
  bgs.set(st.id, b);
}

$('bgFile').addEventListener('change', async e => {
  const f = e.target.files[0];
  e.target.value = '';
  if (!f) return;
  try {
    await attachMedia(f, { kind: f.type.startsWith('video') ? 'video' : 'image', provider: 'upload', title: f.name, credit: '', license: 'ملكي / من جهازي', tier: 'free' });
    fillForm();
    setStatus('الخلفية اتحطت ✅');
  } catch (err) { setStatus(String(err.message || err), true); }
});

/* ---------- مكتبة الوسائط ---------- */
let mProv = load('mprov', ['commons', 'openverse', 'nasa']);
let mItems = [];

function renderMediaTarget() {
  const st = story();
  $('mTarget').innerHTML = `الوسيط هيتحط خلفية للخبر <b>${cur + 1}</b>${st.headline ? ` «${esc(st.headline.slice(0, 40))}»` : ''}. غيّر الخبر من الاستوديو.`;
  $('mProv').innerHTML = Object.entries(PROVIDERS).map(([k, p]) => `<button class="chip ${mProv.includes(k) ? 'on' : ''}" data-p="${k}" title="${esc(p.area)}">${p.name}${p.cors === false ? ' 🔌' : ''}</button>`).join('') + '<span class="muted"> 🔌 = تحميل الملف محتاج الوسيط (الإعدادات)</span>';
}
$('mProv').addEventListener('click', e => {
  const k = e.target.dataset.p;
  if (!k) return;
  mProv = mProv.includes(k) ? mProv.filter(x => x !== k) : [...mProv, k];
  save('mprov', mProv);
  renderMediaTarget();
});

async function runSearch() {
  const q = $('mq').value.trim();
  if (!q) return;
  $('mInfo').textContent = 'بدوّر…';
  $('mGo').disabled = true;
  try {
    const { items, errors } = await searchAll(q, { providers: mProv, type: $('mType').value, tier: $('mTier').value });
    mItems = items;
    $('mInfo').textContent = `${items.length} نتيجة` + (errors.length ? ` • ⚠️ ${errors.map(e => `${PROVIDERS[e.provider].name}: ${e.error}`).join(' | ')}` : '');
    renderGrid();
  } catch (e) { $('mInfo').textContent = 'فشل البحث: ' + (e.message || e); }
  $('mGo').disabled = false;
}
$('mGo').addEventListener('click', runSearch);
$('mq').addEventListener('keydown', e => { if (e.key === 'Enter') runSearch(); });

function renderGrid() {
  $('mGrid').innerHTML = mItems.map((m, i) => `<div class="mcard">
    <div class="th"><img src="${esc(m.thumb)}" loading="lazy" referrerpolicy="no-referrer" alt="">${m.type === 'video' ? `<span class="vb">🎞 فيديو${m.duration ? ' ' + Math.round(m.duration) + 'ث' : ''}</span>` : ''}</div>
    <div class="bd"><b dir="auto" title="${esc(m.title)}">${esc(m.title || '—')}</b>
      <span><span class="lic ${m.tier}">${esc(m.license)}</span> <span class="muted">${esc(PROVIDERS[m.provider].name)}</span></span>
      ${m.author ? `<span class="muted" dir="auto">${esc(m.author.slice(0, 40))}</span>` : ''}
      <div class="row" style="margin:0"><button class="btn pri" data-use="${i}">استخدم</button><a class="btn ghost" href="${esc(m.page)}" target="_blank" rel="noopener">المصدر</a></div></div></div>`).join('');
}

$('mGrid').addEventListener('click', async e => {
  const i = e.target.dataset.use;
  if (i == null) return;
  const m = mItems[Number(i)];
  const btn = e.target;
  btn.disabled = true;
  try {
    btn.textContent = 'بحمّل…';
    const blob = await fetchBlob(m, p => { btn.textContent = `بحمّل ${Math.round(p * 100)}%`; });
    await attachMedia(blob, { kind: m.type, provider: m.provider, title: m.title, credit: m.tier === 'free' && m.provider !== 'nasa' ? '' : m.credit, license: m.license, licenseUrl: m.licenseUrl, page: m.page, tier: m.tier });
    showTab('studio');
    fillForm();
    setStatus('الخلفية اتحطت ✅ (الحقوق بتظهر على الشاشة لو الترخيص بيطلب نسب)');
  } catch (err) { $('mInfo').textContent = '❌ ' + (err.message || err); }
  btn.disabled = false;
  btn.textContent = 'استخدم';
});

$('uGo').addEventListener('click', async () => {
  const url = $('uUrl').value.trim();
  if (!/^https?:\/\//.test(url)) return ($('uMsg').textContent = 'اكتب رابط صحيح.');
  if (!$('uOk').checked) return ($('uMsg').textContent = 'أكّد الترخيص الأول.');
  if (!$('uCredit').value.trim() || !$('uLicense').value.trim()) return ($('uMsg').textContent = 'الحقوق والترخيص إجباريين.');
  $('uMsg').textContent = 'بحمّل…';
  try {
    const kind = /\.(mp4|webm|mov|ogv)(\?|$)/i.test(url) ? 'video' : 'image';
    const blob = await fetchBlob({ provider: 'manual', url, type: kind, thumb: '' });
    await attachMedia(blob, { kind, provider: 'manual', title: url.split('/').pop().slice(0, 50), credit: $('uCredit').value.trim(), license: $('uLicense').value.trim(), page: url, tier: 'attr' });
    $('uMsg').textContent = '';
    showTab('studio'); fillForm();
  } catch (err) { $('uMsg').textContent = '❌ ' + (err.message || err); }
});

/* ---------- المكتبة ---------- */
let libStatus = 'all';
function renderLibrary() {
  const all = listReels().map(normalizeReel);
  const q = $('libQ').value.trim().toLowerCase();
  const chips = [['all', 'الكل'], ...Object.entries(STATUSES)];
  $('libStatus').innerHTML = chips.map(([k, v]) => `<button class="chip ${k === libStatus ? 'on' : ''}" data-s="${k}">${v} ${k === 'all' ? all.length : all.filter(r => r.status === k).length}</button>`).join('');
  const text = r => (r.title + ' ' + r.stories.map(x => x.headline + ' ' + x.script + ' ' + x.sourceName).join(' ')).toLowerCase();
  const rows = all.filter(r => (libStatus === 'all' || r.status === libStatus) && (!q || text(r).includes(q)));
  $('libList').innerHTML = rows.length ? rows.map(r => {
    const first = r.stories.find(x => !isEmptyStory(x)) || r.stories[0];
    const c = first.kind === 'news' ? cat(first.category) : { label: KINDS[first.kind], color: '#6b7cff' };
    const sources = [...new Set(r.stories.filter(x => x.kind === 'news' && x.sourceName).map(x => x.sourceName))];
    return `<article class="item" style="--c:${c.color}">
      <h3 dir="auto">${esc(r.title || first.headline || '(من غير عنوان)')}</h3>
      <div class="meta"><span>${r.stories.length > 1 ? r.stories.length + ' أخبار' : c.label}</span><span class="stat ${r.status}">${STATUSES[r.status] || r.status}</span><span dir="auto">${esc(sources.slice(0, 3).join('، ') || 'من غير مصدر')}</span><span>${timeAgo(new Date(r.updatedAt).toISOString())}</span></div>
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
  else if (d.dup) {
    const r = getReel(d.dup);
    if (r) {
      const n = normalizeReel(r);
      upsertReel(newReel({ title: (n.title || n.stories[0].headline || '') + ' (نسخة)', stories: n.stories.map(x => newStory({ ...x, id: undefined })) }));
      renderLibrary();
    }
  }
  else if (d.del && confirm('تحذف الريل ده نهائيًا؟')) { deleteReel(d.del); if (reel.id === d.del) startReel([{}]); renderLibrary(); }
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
const TEXT_FIELDS = { sChannel: 'channelName', sHandle: 'handle', sKey: 'elevenKey', sModel: 'elevenModel', sProxy: 'proxyUrl', sPixabay: 'pixabayKey' };
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
// رقم النسخة: لو الصفحة والكود مختلفين يبقى فيه كاش قديم
const codeV = new URL(import.meta.url).searchParams.get('v') || '-';
const pageV = document.documentElement.dataset.v || '-';
$('ver').textContent = `نسخة ${codeV}${codeV === pageV ? '' : ` ⚠️ الصفحة ${pageV} — اعمل تحديث قوي (Ctrl+Shift+R) أو امسح الكاش`}`;

(async function init() {
  $('sModel').innerHTML = MODELS.map(m => `<option value="${m.id}">${m.name}</option>`).join('');
  cfg = await loadConfig();
  const opts = cfg.categories.map(c => `<option value="${c.id}">${c.label}</option>`).join('');
  $('fCat').innerHTML = opts;
  $('mCat').innerHTML = opts;
  renderChips();
  fillSettings();
  const saved = currentId() && getReel(currentId());
  if (saved) reel = normalizeReel(saved);
  fillForm();
  restoreAudio();
  try { feeds = await loadFeeds(); } catch { $('feedInfo').textContent = 'تعذر تحميل data/feeds.json.'; }
  renderFeed();
  loadFonts().then(() => redraw());
  window.__nrs = { get reel() { return reel; }, get cur() { return cur; }, audioMap, setManual: b => { manualAudio = b; updateInfo(); redraw(); } };
})();
