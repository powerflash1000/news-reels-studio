import { load, save, getSettings, setSettings, charsUsed, resetElevenSettings, cacheClear } from './storage.js?v=mv28jjt1';
import { listReels, getReel, upsertReel, deleteReel, setStatus as setReelStatus, currentId, setCurrentId, buildBackup, applyBackup } from './library.js?v=mv28jjt1';
import { loadConfig, loadFeeds, timeAgo, hostOf } from './feeds.js?v=mv28jjt1';
import { newReel, newStory, normalizeReel, isEmptyStory, parseScript, buildReelTimeline, allLines, lineKey, STATUSES, KINDS, TEMPLATES, PROOF_STATUS, newProofSource } from './reel.js?v=mv28jjt1';
import { speakLine, peekLine, voiceFor, MODELS, fetchSubscription, lastSubscription, fetchVoices } from './tts.js?v=mv28jjt1';
import { audioCtx, mixTimeline, Recorder, decode, SAMPLE_RATE, FX_PRESETS, applyFxToBuffer } from './audio.js?v=mv28jjt1';
import { buildSrt, wavBlob, download } from './exportfiles.js?v=mv28jjt1';
import { drawCover, drawFrame, FORMATS, setWorld, worldLoaded, toLatinDigits, proofSources } from './render.js?v=mv28jjt1';
import { exportSupport, exportReel } from './export.js?v=mv28jjt1';
import { PROVIDERS, searchAll, fetchBlob } from './media.js?v=mv28jjt1';
import { draftScript, listModels, CLAUDE_MODELS, AI_PROVIDERS } from './draft.js?v=mv28jjt1';
import { localMatches, searchPlaces, searchWide } from './geo.js?v=mv28jjt1';
import { buildPack, compose, summarize, engagement, PLATFORMS } from './publish.js?v=mv28jjt1';
import { putBlob, getBlob, delBlob } from './mediastore.js?v=mv28jjt1';
import { loadBg, playBg } from './bg.js?v=mv28jjt1';
import { initI18n } from './i18n.js?v=mv28jjt1';

initI18n();

const $ = id => document.getElementById(id);
const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

let cfg = null;          // config/sources.json
let feeds = { items: [] };
let reel = newReel();
let cur = 0;               // رقم الخبر اللي بنعدّله
const bgs = new Map();     // story.id → خلفية محمّلة
const shots = new Map();   // معرّف لقطة مصدر → صورة محمّلة
let cities = [];
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
  for (const id of ['feed', 'studio', 'media', 'library', 'publish', 'settings']) $('tab-' + id).hidden = id !== name;
  if (name === 'studio') redraw();
  if (name === 'library') renderLibrary();
  if (name === 'publish') renderPublish();
  if (name === 'media') renderMediaTarget();
}
$('tabs').addEventListener('click', e => e.target.dataset.tab && showTab(e.target.dataset.tab));

/* ---------- الأخبار ---------- */
const prefs = (() => { try { return JSON.parse(localStorage.getItem('nrs:feedPrefs') || '{}'); } catch { return {}; } })();
const savePrefs = () => { try { localStorage.setItem('nrs:feedPrefs', JSON.stringify({ region: filterRegion, sort: $('sortBy').value, trend: $('trendOnly').checked })); } catch { /* ممنوع التخزين */ } };
let filterRegion = prefs.region || 'all';

function renderChips() {
  const all = [{ id: 'all', label: 'الكل', color: '#3e63dd' }, ...cfg.categories];
  $('cats').innerHTML = all.map(c => `<button class="chip ${c.id === filterCat ? 'on' : ''}" data-c="${c.id}" style="--c:${c.color}">${c.label}</button>`).join('');
  const regs = [{ id: 'all', label: 'كل المناطق' }, ...(cfg.regions || [])];
  $('regions').innerHTML = regs.map(r => `<button class="chip ${r.id === filterRegion ? 'on' : ''}" data-r="${r.id}" style="--c:#6b7cff">${r.label}</button>`).join('');
}
$('cats').addEventListener('click', e => { if (e.target.dataset.c) { filterCat = e.target.dataset.c; renderChips(); renderFeed(); } });
$('regions').addEventListener('click', e => { if (e.target.dataset.r) { filterRegion = e.target.dataset.r; savePrefs(); renderChips(); renderFeed(); } });
$('q').addEventListener('input', renderFeed);
$('showYt').addEventListener('change', renderFeed);
$('sortBy').addEventListener('change', () => { savePrefs(); renderFeed(); });
$('trendOnly').addEventListener('change', () => { savePrefs(); renderFeed(); });

const TYPE_TXT = { agency: 'وكالة', public: 'إعلام عام', state: 'حكومي/موجّه', official: 'رسمي', specialist: 'متخصص', radar: 'رادار — مش مصدر أصلي', trend: 'ترند' };
const regionLabel = id => (cfg.regions || []).find(r => r.id === id)?.label || '';
function inRegion(item) {
  if (filterRegion === 'all') return true;
  const r = item.region || 'world';
  return r === filterRegion || (cfg.regions || []).find(x => x.id === r)?.in === filterRegion;
}
// أهمية الخبر دلوقتي = الأهمية وقت الجمع × تناقص مع عمر الخبر (نص العمر 24 ساعة)
const effImp = i => (i.imp || 0) * Math.pow(0.5, (i.published ? Math.max(0, Date.now() - Date.parse(i.published)) / 36e5 : 0) / 24);
const fmtBig = n => (n >= 1e6 ? (n / 1e6).toFixed(1).replace(/\.0$/, '') + ' مليون' : n >= 1e3 ? Math.round(n / 1e3) + ' ألف' : String(n));

function renderFeed() {
  const q = $('q').value.trim().toLowerCase();
  const showYt = $('showYt').checked;
  const trendOnly = $('trendOnly').checked;
  const byImp = $('sortBy').value === 'imp';
  let list = feeds.items.filter(i =>
    (filterCat === 'all' || i.category === filterCat || (filterCat === 'trending' && i.tk === 'trend')) &&
    inRegion(i) &&
    (!trendOnly || i.tk === 'trend' || i.tk === 'top' || (i.cov || 1) >= 3) &&
    (showYt || i.kind !== 'youtube') &&
    (!q || (i.title + ' ' + i.summary + ' ' + i.source).toLowerCase().includes(q)));
  if (byImp) list = list.map(i => [effImp(i), i]).sort((a, b) => b[0] - a[0] || (Date.parse(b[1].published) || 0) - (Date.parse(a[1].published) || 0)).map(x => x[1]);
  const items = list.slice(0, 150);
  const gen = feeds.generatedAt ? `آخر تحديث: ${timeAgo(feeds.generatedAt)}` : 'لسه مفيش تحديث — شغّل الـ Action (fetch-feeds) من تبويب Actions في GitHub، أو أضف خبر يدويًا تحت.';
  const bad = (feeds.health || []).filter(h => h.status !== 'ok');
  $('feedInfo').textContent = `${gen} • ${items.length} خبر${byImp ? ' (الأهم أولًا)' : ''}${bad.length ? ` • ⚠️ ${bad.length} مصدر فيه مشكلة (تحت)` : ''}`;
  renderHealth();
  renderPickBar();
  $('feedList').innerHTML = items.map((i, n) => {
    const c = cat(i.category);
    const yt = i.kind === 'youtube';
    const badges = [
      byImp ? `<span class="tag hot">#${n + 1}</span>` : '',
      i.traffic ? `<span class="tag hot">🔥 بحث ${fmtBig(i.traffic)}+</span>` : '',
      i.views ? `<span class="tag hot">👁 ${fmtBig(i.views)} مشاهدة</span>` : '',
      i.tk === 'top' && i.rank ? `<span class="tag hot">من أهم الأخبار (#${i.rank})</span>` : '',
      i.tk === 'trend' && i.rank && !i.traffic && !i.views ? `<span class="tag hot">ترند #${i.rank}</span>` : '',
      (i.cov || 1) >= 2 ? `<span class="tag">🗞 ${i.cov} مصادر</span>` : '',
    ].join('');
    return `<article class="item" style="--c:${c.color}">
      <h3 dir="auto" translate="no">${esc(i.title)}</h3>
      <div class="meta"><span translate="no">${esc(i.source)}</span><span>${c.label}</span>${regionLabel(i.region) ? `<span>${regionLabel(i.region)}</span>` : ''}<span>${timeAgo(i.published)}</span>
        ${yt ? '<span class="tag">رادار — مش مصدر</span>' : ''}${TYPE_TXT[i.type] ? `<span class="tag">${TYPE_TXT[i.type]}</span>` : ''}${i.lang && i.lang !== 'ar' ? `<span>${i.lang.toUpperCase()}</span>` : ''}${badges}</div>
      ${i.summary ? `<div class="sum" dir="auto" translate="no">${esc(i.summary.slice(0, 220))}</div>` : ''}
      <div class="row"><label class="pk"><input type="checkbox" data-chk="${esc(i.id)}" ${picked.has(i.id) ? 'checked' : ''}> حدّد</label>
        <button class="btn pri" data-pick="${esc(i.id)}">ريل جديد</button>
        <button class="btn" data-add="${esc(i.id)}">＋ للريل الحالي</button>
        <a class="btn ghost" href="${esc(i.link)}" target="_blank" rel="noopener">فتح</a>
        ${i.lang && i.lang !== 'ar' ? `<button class="btn ghost" data-tr="${esc(i.id)}">ترجم العنوان</button>` : ''}</div>
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
  ? { category: i.category, headline: i.title, fromYoutube: i.source, ytLink: i.link, ref: i.summary || '' }
  : { category: i.category, headline: i.title, sourceName: i.source, sourceUrl: i.link, ref: i.summary || '' };

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
    const t = await self.Translator.create({ sourceLanguage: item.lang || 'en', targetLanguage: 'ar' });
    item.title = await t.translate(item.title);
    if (item.summary) item.summary = await t.translate(item.summary);
    item.lang = 'ar';
    renderFeed();
  } catch (err) { btn.textContent = String(err.message || err).slice(0, 60); }
}

$('mAdd').addEventListener('click', () => {
  startReel([{ category: $('mCat').value, headline: $('mTitle').value.trim(), sourceName: $('mSource').value.trim(), sourceUrl: $('mUrl').value.trim(), ref: $('mRef').value.trim() }]);
});

// ريل جديد من قايمة أخبار (كل عنصر بيتحول لخبر)
function startReel(storyOvers = [{}]) {
  reel = newReel({ lang: getSettings().reelLang || 'ar', stories: (storyOvers.length ? storyOvers : [{}]).map(o => newStory(o)) });
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
      const hit = await peekLine(l.text, l.speaker, reel.lang);
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
    return `<button class="chip ${i === cur ? 'on' : ''}" data-i="${i}" style="--c:${c.color}">${i + 1}. ${st.kind !== 'news' ? `<small>${KINDS[st.kind]}</small> ` : ''}${st.headline ? `<span translate="no">${esc(label)}</span>` : esc(label)}</button>`;
  }).join('');
  $('stUp').disabled = cur === 0;
  $('stDown').disabled = cur === reel.stories.length - 1;
  $('stDel').disabled = reel.stories.length === 1 && isEmptyStory(story());
}

function applyFormat() {
  const f = FORMATS[reel.format] || FORMATS.v;
  const cv = $('cv');
  cv.style.aspectRatio = `${f.w} / ${f.h}`;
  if (cv.width !== f.w || cv.height !== f.h) { cv.width = f.w; cv.height = f.h; }
  $('rFormat').value = reel.format || 'v';
  $('rLang').value = reel.lang || 'ar';
  $('fmtNote').hidden = (reel.format || 'v') === 'v';
}
$('rFormat').innerHTML = Object.entries(FORMATS).map(([k, v]) => `<option value="${k}">${v.name}</option>`).join('');
$('rFormat').addEventListener('change', () => { reel.format = $('rFormat').value; persist(); applyFormat(); redraw(); });
$('rLang').addEventListener('change', () => { reel.lang = $('rLang').value; persist(); redraw(); restoreAudio(); });

function fillForm() {
  const st = story();
  applyFormat();
  fillBumpers();
  fillCoverSelects();
  refreshCover();
  $('rTitle').value = reel.title || '';
  $('fCat').value = st.category;
  $('fKind').value = st.claimKind;
  $('fHead').value = st.headline;
  $('fSrc').value = st.sourceName;
  $('fUrl').value = st.sourceUrl;
  $('fCredit').value = st.credit;
  $('fScript').value = st.script;
  fillRef();
  fillTemplateFields();
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
  st.ref = $('fRef').value;
  if (st.kind === 'news') {
    st.template = $('fTpl').value;
    st.stat = { value: $('stValue').value.trim(), unit: $('stUnit').value.trim(), label: $('stLabel').value.trim(), trend: $('stTrend').value };
    st.map = { countries: st.map?.countries || [], pins: st.map?.pins || [], label: $('mapLabel').value.trim(), zoom: st.map?.zoom || 'auto' };
    if (st.template === 'proof') {
      const first = proofSources(st)[0];
      if (first && !st.sourceName) st.sourceName = first.outlet;
      if (first && !st.sourceUrl) st.sourceUrl = first.url;
    }
  }
  reel.ticker = { on: $('tkOn').checked, label: $('tkLabel').value.trim(), text: $('tkText').value.trim() };
}

function persist() {
  // ريل فاضي مبيتحفظش في المكتبة
  if (reel.stories.every(isEmptyStory) && !reel.title) return;
  upsertReel(reel);
  setCurrentId(reel.id);
}

for (const id of ['rTitle', 'fCat', 'fKind', 'fHead', 'fSrc', 'fUrl', 'fCredit', 'fScript', 'fTpl', 'stValue', 'stUnit', 'stTrend', 'stLabel', 'mapLabel', 'tkOn', 'tkLabel', 'tkText']) {
  $(id).addEventListener('input', () => {
    readForm(); persist(); updateInfo(); redraw();
    if (id === 'fHead' || id === 'fCat') renderStrip();
    if (id === 'fTpl' || id === 'tkOn') toggleTemplateFields();
    if (id === 'fScript') { clearTimeout(restoreTimer); restoreTimer = setTimeout(restoreAudio, 600); }
  });
}
$('newReel').addEventListener('click', () => startReel([{}]));



/* ---------- ملخص الخبر المرجعي ---------- */
function fillRef() {
  const st = story();
  const news = st.kind === 'news';
  $('refBox').hidden = !news;
  $('fRef').value = st.ref || '';
  $('refBox').open = !!st.ref && !st.script.trim();
  const link = st.sourceUrl || st.ytLink || '';
  $('refLink').hidden = !link;
  if (link) $('refLink').href = link;
  $('refMsg').textContent = st.ref ? 'أعد صياغته بأسلوبك قبل التصدير. الأداة بتسحب الملخص بس، مش نص الخبر الكامل (حقوق النشر).' : 'مفيش ملخص للخبر ده. افتح الخبر الأصلي والصق النص هنا كمرجع، أو اكتب السكريبت مباشرة.';
}

// تقسيم النص لجُمل قصيرة (سطر لكل جملة)
function splitSentences(text) {
  return String(text || '').split(/(?<=[.!؟?؛])\s+|\n+/).map(x => x.trim()).filter(Boolean);
}

$('fRef').addEventListener('input', () => { story().ref = $('fRef').value; persist(); });
$('refInsert').addEventListener('click', () => {
  const lines = splitSentences($('fRef').value);
  if (!lines.length) return ($('refMsg').textContent = 'مفيش نص في الملخص.');
  const cur = $('fScript').value.trim();
  $('fScript').value = (cur ? cur + '\n' : '') + lines.join('\n');
  $('fScript').dispatchEvent(new Event('input', { bubbles: true }));
  $('refMsg').textContent = `اتضافت ${lines.length} جملة للسكريبت. عدّلها بأسلوبك.`;
});
$('refTr').addEventListener('click', async () => {
  try {
    if (!('Translator' in self)) throw new Error('المتصفح ده مفيهوش الترجمة المدمجة (محتاج Chrome حديث). ترجم يدويًا.');
    $('refMsg').textContent = 'بترجم…';
    const limit = new Promise((_, rej) => setTimeout(() => rej(new Error('الترجمة المدمجة مردّتش (ممكن تحتاج تحميل نموذج اللغة). ترجم يدويًا أو جرّب تاني.')), 20000));
    const t = await Promise.race([self.Translator.create({ sourceLanguage: 'en', targetLanguage: 'ar' }), limit]);
    $('fRef').value = await Promise.race([t.translate($('fRef').value), limit]);
    story().ref = $('fRef').value;
    persist();
    $('refMsg').textContent = 'اترجم ✅ (راجعه، الترجمة الآلية ممكن تغلط).';
  } catch (e) { $('refMsg').textContent = String(e.message || e).slice(0, 120); }
});

// مسودة بالذكاء الاصطناعي من الملخص
$('draftGo').addEventListener('click', async () => {
  readForm();
  const st = story();
  const btn = $('draftGo');
  const gs = getSettings(), AP = AI_PROVIDERS[gs.aiProvider] || AI_PROVIDERS.claude;
  if (!gs[AP.keyField]) return ($('refMsg').textContent = `محتاج مفتاح ${AP.name.split(' (')[0]}: الإعدادات ← مزوّد الذكاء الاصطناعي.`);
  if (!st.headline && !st.ref) return ($('refMsg').textContent = 'اكتب العنوان أو الملخص الأول.');
  btn.disabled = true;
  $('refMsg').textContent = `${AP.name.split(' (')[0]} بيكتب المسودة…`;
  try {
    const { lines, missing } = await draftScript({ story: st, categoryLabel: cat(st.category).label, seconds: Number($('draftLen').value), format: $('draftFmt').value, note: $('draftNote').value.trim(), lang: reel.lang });
    const text = lines.map(l => (l.speaker === 'B' ? 'ب: ' : $('draftFmt').value === 'dialogue' ? 'أ: ' : '') + l.text).join('\n');
    const has = $('fScript').value.trim();
    $('fScript').value = has && !confirm('السكريبت فيه نص. موافق = استبدله بالمسودة، إلغاء = ضيف المسودة في الآخر.') ? has + '\n' + text : text;
    $('fScript').dispatchEvent(new Event('input', { bubbles: true }));
    $('refMsg').textContent = `اتكتبت مسودة (${lines.length} سطر). راجعها وعدّلها بأسلوبك.` + (missing.length ? ` ⚠️ معلومات ناقصة تتأكد منها من المصدر: ${missing.join('، ')}` : '');
  } catch (e) { $('refMsg').textContent = '❌ ' + (e.message || e); }
  btn.disabled = false;
});

/* ---------- قوالب الخبر (عاجل / رقم / خريطة) وشريط الأخبار ---------- */
let world = null;

async function loadWorld() {
  if (world) return world;
  try {
    world = await (await fetch('assets/data/world.json')).json();
    setWorld(world);
    try { cities = await (await fetch('assets/data/cities.json')).json(); } catch { /* من غير مدن */ }
    renderMapChips();
    redraw();
  } catch { /* الخريطة مش هتظهر */ }
  return world;
}

function toggleTemplateFields() {
  const news = story().kind === 'news';
  const tpl = news ? $('fTpl').value : 'standard';
  $('tplStat').hidden = tpl !== 'stat';
  $('tplMap').hidden = tpl !== 'map';
  $('tplProof').hidden = tpl !== 'proof';
  $('tkFields').hidden = !$('tkOn').checked;
  if (tpl === 'map') loadWorld();
}

function renderMapChips() {
  renderPinChips();
  const ids = story().map?.countries || [];
  $('mapChips').innerHTML = ids.map(id => {
    const c = world?.countries.find(x => x.id === id);
    return `<button class="chip on" data-rm="${id}" style="--c:#3e63dd">${esc(c?.ar || id)} <span class="x">✕</span></button>`;
  }).join('');
}

function fillTemplateFields() {
  const st = story();
  const sel = $('fTpl');
  if (!sel.options.length) sel.innerHTML = Object.entries(TEMPLATES).map(([k, v]) => `<option value="${k}">${v}</option>`).join('');
  $('fTpl').value = st.template || 'standard';
  $('stValue').value = st.stat?.value || '';
  $('stUnit').value = st.stat?.unit || '';
  $('stTrend').value = st.stat?.trend || 'none';
  $('stLabel').value = st.stat?.label || '';
  $('mapLabel').value = st.map?.label || '';
  $('tkOn').checked = !!reel.ticker?.on;
  $('tkLabel').value = reel.ticker?.label || '';
  $('tkText').value = reel.ticker?.text || '';
  syncMusic();
  document.querySelector('.tplbox').hidden = st.kind !== 'news';
  $('mapZoom').value = st.map?.zoom || 'auto';
  if (!$('pfStatus').options.length) $('pfStatus').innerHTML = Object.entries(PROOF_STATUS).map(([k, v]) => `<option value="${k}">${v}</option>`).join('');
  $('pfStatus').value = st.proof?.status || 'none';
  toggleTemplateFields();
  renderMapChips();
  renderProofRows();
}

function renderProofRows() {
  const srcs = story().proof?.sources || [];
  $('pfRows').innerHTML = srcs.map((s, i) => `<div class="pfrow" data-i="${i}">
    <div class="grid">
      <label>الجهة / الوكالة<input data-f="outlet" value="${esc(s.outlet)}" placeholder="مثال: وكالة الأنباء السعودية (واس)"></label>
      <label>تاريخ الخبر<input data-f="date" value="${esc(s.date)}" placeholder="2026-10-09"></label>
    </div>
    <label>عنوان الخبر عند المصدر (قصير)<input data-f="title" dir="auto" value="${esc(s.title)}"></label>
    <label>رابط الخبر (https://…)<input data-f="url" dir="ltr" value="${esc(s.url)}"></label>
    <div class="row">
      <label class="btn file">🖼 لقطة من جهازي<input data-shot="${i}" type="file" accept="image/*" hidden></label>
      ${s.shot ? `<span class="muted">${esc(s.shot.name || 'لقطة')}</span> <button class="btn ghost" data-noshot="${i}">إزالة اللقطة</button>` : ''}
      <button class="btn ghost" data-rmsrc="${i}">حذف المصدر</button>
    </div>
  </div>`).join('');
  $('pfAdd').disabled = srcs.length >= 3;
}

function proofOf() { return (story().proof ||= { status: 'none', sources: [] }); }
$('pfAdd').addEventListener('click', () => { const p = proofOf(); if (p.sources.length < 3) p.sources.push(newProofSource()); persist(); renderProofRows(); redraw(); });
$('pfStatus').addEventListener('input', () => { proofOf().status = $('pfStatus').value; persist(); redraw(); });
$('pfRows').addEventListener('input', e => {
  const row = e.target.closest('.pfrow');
  if (!row || !e.target.dataset.f) return;
  proofOf().sources[Number(row.dataset.i)][e.target.dataset.f] = e.target.value.trim();
  persist(); redraw();
});
$('pfRows').addEventListener('click', e => {
  const d = e.target.dataset;
  const p = proofOf();
  if (d.rmsrc != null) p.sources.splice(Number(d.rmsrc), 1);
  else if (d.noshot != null) p.sources[Number(d.noshot)].shot = null;
  else return;
  persist(); renderProofRows(); redraw();
});
$('pfRows').addEventListener('change', async e => {
  const i = e.target.dataset.shot;
  const f = e.target.files?.[0];
  if (i == null || !f) return;
  try {
    const id = 's' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5);
    await putBlob(id, f);
    const b = await loadBg({ id, kind: 'image' });
    if (!b) throw new Error('الصورة مش مفهومة');
    shots.set(id, b);
    proofOf().sources[Number(i)].shot = { id, name: f.name };
    persist(); renderProofRows(); redraw();
  } catch (err) { setStatus('مقدرتش أقرا اللقطة: ' + (err.message || err), true); }
  e.target.value = '';
});

// دبابيس المدن + بحث الأماكن
function mapOf() { return (story().map ||= { countries: [], label: '', pins: [] }); }
function renderPinChips() {
  $('pinRows').innerHTML = (story().map?.pins || []).map((p, i) => `<div class="pinrow"><b>📍 ${esc(p.name)}</b> <span class="muted" dir="auto">${esc(p.detail || '')}</span>
    <input data-pl="${i}" dir="auto" placeholder="نص الدبوس على الشاشة (فاضي = الاسم)" value="${esc(p.label || '')}"><button class="btn ghost" data-rmpin="${i}" type="button">✕</button></div>`).join('');
}
let placeResults = [], placeSeq = 0, placeTimer = null;
function showPlaceResults(rows, note = '') {
  placeResults = rows;
  $('placeRes').innerHTML = rows.map((r, i) => `<button class="item placebtn" type="button" data-pr="${i}"><b dir="auto">${r.type === 'country' ? '🌍' : '📍'} ${esc(r.name)}</b> <span class="muted" dir="auto">${r.type === 'country' ? 'دولة — ' : ''}${esc(r.detail || '')}</span></button>`).join('');
  $('placeMsg').textContent = note;
}
async function runPlaceSearch(wide = false) {
  const q = $('placeQ').value.trim();
  const my = ++placeSeq;
  if (q.length < 2) return showPlaceResults([], '');
  await loadWorld();
  const local = localMatches(q, world, cities);
  showPlaceResults(local, 'بدوّر…');
  try {
    const online = wide ? await searchWide(q) : await searchPlaces(q);
    if (my !== placeSeq) return;
    const rows = [...local.filter(r => r.type === 'country'), ...online, ...local.filter(r => r.type !== 'country')];
    showPlaceResults(rows, rows.length ? '' : 'مفيش نتايج. جرّب كتابة الاسم بالإنجليزي أو «بحث أوسع».');
  } catch (e) {
    if (my !== placeSeq) return;
    showPlaceResults(local, `البحث على الإنترنت مش شغال دلوقتي (${e.message || e}). ${local.length ? 'دي النتايج المحلية.' : 'جرّب تاني.'}`);
  }
}
$('placeQ').addEventListener('input', () => { clearTimeout(placeTimer); placeTimer = setTimeout(() => runPlaceSearch(false), 400); });
$('placeWide').addEventListener('click', () => runPlaceSearch(true));
$('placeRes').addEventListener('click', e => {
  const r = placeResults[Number(e.target.closest('[data-pr]')?.dataset.pr)];
  if (!r) return;
  const m = mapOf();
  if (r.type === 'country') { if (!m.countries.includes(r.id)) m.countries.push(r.id); }
  else {
    (m.pins ||= []).push({ name: r.name, lat: r.lat, lon: r.lon, label: '', detail: r.detail || '' });
    if ($('placeCountry').checked && r.cc && world?.countries.some(c => c.id === r.cc) && !m.countries.includes(r.cc)) m.countries.push(r.cc);
  }
  persist(); renderMapChips(); redraw();
});
$('pinRows').addEventListener('click', e => {
  const b = e.target.closest('[data-rmpin]');
  if (!b) return;
  story().map.pins.splice(Number(b.dataset.rmpin), 1);
  persist(); renderPinChips(); redraw();
});
$('pinRows').addEventListener('input', e => {
  const i = e.target.dataset.pl;
  if (i == null) return;
  story().map.pins[Number(i)].label = e.target.value.trim();
  persist(); redraw();
});
$('mapZoom').addEventListener('input', () => { mapOf().zoom = $('mapZoom').value; persist(); redraw(); });
$('mapChips').addEventListener('click', e => {
  const btn = e.target.closest('[data-rm]');
  if (!btn) return;
  const m = story().map;
  m.countries = m.countries.filter(x => x !== btn.dataset.rm);
  persist(); renderMapChips(); redraw();
});

// أخبار الريل
$('storyTabs').addEventListener('click', e => {
  const b = e.target.closest('[data-i]');
  if (!b) return;
  readForm(); cur = Number(b.dataset.i); fillForm();
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

/* ---------- لوجو القناة ---------- */
let logoImg = null, coverTimer = 0;
async function loadLogo() {
  logoImg = null;
  try {
    const b = await getBlob('__logo');
    if (b) {
      const img = new Image();
      img.src = URL.createObjectURL(b);
      await img.decode();
      logoImg = img;
    }
  } catch { /* مفيش لوجو */ }
  $('logoInfo').textContent = logoImg ? "✅ اللوجو محمّل." : 'مفيش لوجو. ارفع صورة (PNG بخلفية شفافة أحسن).';
}
$('logoFile').addEventListener('change', async e => {
  const f = e.target.files[0];
  e.target.value = '';
  if (!f) return;
  if (!f.type.startsWith('image/')) return void ($('logoInfo').textContent = '❌ الملف ده مش صورة.');
  await putBlob('__logo', f);
  await loadLogo();
  $('logoOn').checked = true;
  saveSettings();
  redraw();
});
$('logoDel').addEventListener('click', async () => { await delBlob('__logo'); await loadLogo(); $('logoOn').checked = false; saveSettings(); redraw(); });

/* ---------- مقدمة / خاتمة ---------- */
function fillBumpers() {
  const b = reel.bumpers || {};
  $('bpIntro').checked = !!b.intro?.on; $('bpIntroText').value = b.intro?.text || '';
  $('bpOutro').checked = !!b.outro?.on; $('bpOutroText').value = b.outro?.text || '';
}
function readBumpers() {
  reel.bumpers = { intro: { on: $('bpIntro').checked, text: $('bpIntroText').value.trim() }, outro: { on: $('bpOutro').checked, text: $('bpOutroText').value.trim() } };
  persist(); redraw();
}
for (const id of ['bpIntro', 'bpIntroText', 'bpOutro', 'bpOutroText']) $(id).addEventListener('change', readBumpers);

/* ---------- ملفات للمونتاج: SRT و WAV ---------- */
function exportInfo() {
  const info = currentTimeline();
  if (!info.real) { setStatus('الصوت مش جاهز. ولّد الصوت أو سجّل/ارفع ملف الأول.', true); return null; }
  return info;
}
const fileBase = () => (reel.title || 'reel').replace(/[^\w؀-ۿ -]+/g, '').trim().replace(/\s+/g, '-').slice(0, 40) || 'reel';
$('exSrt').addEventListener('click', () => {
  const info = exportInfo(); if (!info) return;
  const srt = buildSrt(info.tl.segs);
  if (!srt.trim()) return setStatus('مفيش كلام متوقّت أطلّع منه ترجمة.', true);
  download(new Blob(['﻿' + srt], { type: 'application/x-subrip' }), fileBase() + '.srt');
  setStatus('نزلت ملف الترجمة SRT ✅');
});
function exportWav(voiceOnly) {
  const info = exportInfo(); if (!info) return;
  const t = info.tl;
  const { left, right } = mixTimeline(t.segs, t.duration, voiceOnly ? null : t.music, t.fx);
  download(wavBlob(left, right, SAMPLE_RATE), fileBase() + (voiceOnly ? '-voice' : '') + '.wav');
  setStatus('نزل ملف الصوت WAV ✅');
}
$('exWav').addEventListener('click', () => exportWav(false));
$('exVoice').addEventListener('click', () => exportWav(true));

/* ---------- غلاف / ثمبنيل ---------- */
function fillCoverSelects() {
  const f = $('cvFmt'), s = $('cvStory');
  const pf = f.value || reel.format, ps = s.value;
  f.innerHTML = Object.entries(FORMATS).map(([k, v]) => `<option value="${k}">${v.name}</option>`).join('');
  f.value = FORMATS[pf] ? pf : reel.format;
  s.innerHTML = reel.stories.map((x, i) => `<option value="${i}">${i + 1}. ${(x.headline || '(من غير عنوان)').slice(0, 40).replace(/</g, '&lt;')}</option>`).join('');
  s.value = ps && ps < reel.stories.length ? ps : String(cur);
}
function drawCoverPreview(cv) {
  const info = currentTimeline();
  drawCover(cv.getContext('2d'), stateFor(info), Number($('cvStory').value) || 0, $('cvFmt').value);
}
async function refreshCover() {
  if (!cfg || $('tab-studio').hidden) return;
  try { await ensureBgs(); await loadFonts(); drawCoverPreview($('coverCv')); } catch { /* مش حرج */ }
}
for (const id of ['cvFmt', 'cvStory']) $(id).addEventListener('change', refreshCover);
$('cvDl').addEventListener('click', async () => {
  await refreshCover();
  const jpg = $('cvType').value === 'jpg';
  const blob = await new Promise(r => $('coverCv').toBlob(r, jpg ? 'image/jpeg' : 'image/png', 0.92));
  if (blob) download(blob, `${fileBase()}-cover-${Number($('cvStory').value) + 1}.${jpg ? 'jpg' : 'png'}`);
});

// الخط الزمني: صوت حقيقي لو متاح، وإلا تقدير صامت للمعاينة
function currentTimeline() {
  const info = buildReelTimeline(reel, audioMap, manualAudio);
  info.tl.fx = getSettings().fx;
  info.tl.music = musicBuf && reel.music ? { buffer: musicBuf, gain: reel.music.vol ?? 0.15 } : null;
  return info;
}

/* ---------- موسيقى الخلفية ---------- */
let musicBuf = null, musicKey = null;
async function syncMusic() {
  const m = reel.music;
  if (!m?.id) { musicBuf = null; musicKey = null; }
  else if (musicKey !== m.id) {
    musicKey = m.id; musicBuf = null;
    try { const b = await getBlob(m.id); if (b && musicKey === m.id) musicBuf = await decode(await b.arrayBuffer()); } catch { /* الملف مش متاح على الجهاز ده */ }
  }
  $('musicInfo').textContent = !m ? 'من غير موسيقى. ارفع ملف صوت من عندك (ترخيصه عليك: استخدم موسيقى بدون حقوق أو من مكتبة بترخيصك).'
    : musicBuf ? `🎵 ${m.name}` : `🎵 ${m.name} — الملف مش موجود على الجهاز ده، ارفعه تاني.`;
  $('musicDel').hidden = !m;
  if (m) $('musicVol').value = m.vol ?? 0.15;
}
$('musicFile').addEventListener('change', async e => {
  const f = e.target.files?.[0];
  if (!f) return;
  try {
    const id = 'music' + Date.now().toString(36);
    await putBlob(id, f);
    if (reel.music?.id) delBlob(reel.music.id);
    reel.music = { id, name: f.name.slice(0, 60), vol: Number($('musicVol').value) || 0.15 };
    musicKey = null;
    await syncMusic();
    if (!musicBuf) { reel.music = null; await syncMusic(); throw new Error('الملف ده مش ملف صوت مفهوم'); }
    persist();
  } catch (err) { $('musicInfo').textContent = '❌ ' + (err.message || err); }
  e.target.value = '';
});
$('musicVol').addEventListener('input', () => { if (reel.music) { reel.music.vol = Number($('musicVol').value); persist(); } });
$('musicDel').addEventListener('click', async () => { if (reel.music?.id) delBlob(reel.music.id); reel.music = null; await syncMusic(); persist(); });

function stateFor(info) {
  return { reel, cats: cfg.categories, settings: getSettings(), tl: info.tl, hasB: info.hasB, focusIdx: cur, bgs, shots, logo: logoImg };
}

const ctx = $('cv').getContext('2d');
function redraw(t) {
  if (!cfg || $('tab-studio').hidden) return;
  const info = currentTimeline();
  const r = info.tl.stories.find(x => x.idx === cur && !x.bumper);
  const seg = info.tl.segs.find(x => x.storyIdx === cur);
  clearTimeout(coverTimer); coverTimer = setTimeout(refreshCover, 400);
  drawFrame(ctx, stateFor(info), t ?? (r ? (seg ? seg.start + 0.3 : r.start) : 0), { settled: true });
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
      audioMap.set(lineKey(l), await speakLine(l.text, l.speaker, reel.lang));
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
  if (info.real || info.tl.music) {
    const mix = mixTimeline(info.tl.segs, info.tl.duration, info.tl.music, info.tl.fx);
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
    if (st.template === 'stat' && !st.stat?.value) probs.push(pre + 'قالب الرقم محتاج رقم.');
    if (st.template === 'proof') {
      const ok = proofSources(st).filter(x => /^https?:\/\//.test(x.url || '') && x.outlet);
      if (!ok.length) probs.push(pre + 'قالب التوثيق محتاج مصدر واحد على الأقل (جهة + رابط).');
      if (proofSources(st).some(x => /(^|\.)(youtube\.com|youtu\.be)$/.test((() => { try { return new URL(x.url).hostname; } catch { return ''; } })()))) probs.push(pre + 'رابط يوتيوب مش مصدر أصلي.');
    }
    if (st.template === 'map' && !(st.map?.countries || []).length && !(st.map?.pins || []).length) probs.push(pre + 'قالب الخريطة محتاج دولة أو دبوس مدينة.');
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
  if (news.some(s => s.template === 'proof')) base.push('حالة التأكيد (رسمي / غير مؤكد) مطابقة لما قالته المصادر المعروضة، ومفيش لقطة فيها محتوى مصوّر محمي.');
  if (news.some(s => s.category === 'health' || s.category === 'healthtech')) base.push('مفيش نصيحة علاجية أو جرعات، والتنبيه الطبي ظاهر على الشاشة.');
  if (news.some(s => s.category === 'stories')) base.push('القصة من وثائق أو قضايا منتهية ومعلنة: راجعت التواريخ والأسماء، ومفيش اتهام لشخص من غير حكم، وأي ادعاء غير مثبت (UFO وغيره) متقدّم على إنه «غير مؤكد».');
  if (news.some(s => s.category === 'defense')) base.push('مفيش معلومة عن تحركات حالية أو مواقع حساسة غير معلنة رسميًا، والأرقام منسوبة لمصدرها.');
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
  if (reel.stories.some(x => x.template === 'map')) await loadWorld();
  await ensureBgs();
  const missing = reel.stories.map((st, i) => ({ st, n: i + 1 })).filter(x => x.st.media && hasContent(x.st) && !bgs.has(x.st.id));
  if (missing.length) return setStatus(`خلفية الخبر ${missing.map(x => x.n).join('، ')} مش موجودة على الجهاز ده. اختارها تاني أو شيلها.`, true);
  const info = currentTimeline();
  if (!info.real) return setStatus('الصوت مش جاهز. ولّد الصوت أو سجّل/ارفع ملف الأول.', true);
  const support = await exportSupport(reel.format);
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
    const real = info.tl.stories.filter(x => x.idx >= 0), n = real.length;
    a.download = `reel-${new Date().toISOString().slice(0, 10)}-${n > 1 ? n + 'news' : cat(reel.stories[real[0].idx].category).id}.mp4`;
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
  for (const st of reel.stories) {
    for (const src of st.proof?.sources || []) {
      if (!src.shot || shots.has(src.shot.id)) continue;
      const b = await loadBg({ id: src.shot.id, kind: 'image' });
      if (b) { shots.set(src.shot.id, b); changed = true; }
    }
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
  if (!m) { el.textContent = 'من غير خلفية (لون القسم بس).'; $('bgDim').value = 0.5; $('bgFit').value = 'auto'; $('bgZoom').value = 1; $('bgFx').value = 0.5; $('bgFy').value = 0.5; return; }
  const ok = bgs.has(story().id);
  el.innerHTML = `${m.kind === 'video' ? '🎞' : '🖼'} <b dir="auto">${esc(m.title || 'خلفية')}</b> — ${esc(m.license || '')}${m.page ? ` — <a href="${esc(m.page)}" target="_blank" rel="noopener" style="color:inherit">المصدر</a>` : ''}${ok ? '' : ' <span style="color:#ffb86b">⚠️ الملف مش موجود على الجهاز ده — اختار الخلفية تاني</span>'}`;
  $('bgDim').value = m.dim ?? 0.5;
  $('bgFit').value = m.fit || 'auto'; $('bgZoom').value = m.zoom || 1; $('bgFx').value = m.fx ?? 0.5; $('bgFy').value = m.fy ?? 0.5;
}

$('bgDim').addEventListener('input', () => { const m = story().media; if (m) { m.dim = Number($('bgDim').value); persist(); redraw(); } });
for (const [id, key] of [['bgFit', 'fit'], ['bgZoom', 'zoom'], ['bgFx', 'fx'], ['bgFy', 'fy']]) {
  $(id).addEventListener('input', () => { const m = story().media; if (m) { m[key] = id === 'bgFit' ? $(id).value : Number($(id).value); persist(); redraw(); } });
}
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
      <h3 dir="auto" translate="no">${esc(r.title || first.headline || '(من غير عنوان)')}</h3>
      <div class="meta"><span>${r.stories.length > 1 ? r.stories.length + ' أخبار' : c.label}</span><span class="stat ${r.status}">${STATUSES[r.status] || r.status}</span>${sources.length ? `<span dir="auto" translate="no">${esc(sources.slice(0, 3).join('، '))}</span>` : '<span>من غير مصدر</span>'}<span>${timeAgo(new Date(r.updatedAt).toISOString())}</span></div>
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
const TEXT_FIELDS = { sChannel: 'channelName', sHandle: 'handle', sReelLang: 'reelLang', sKey: 'elevenKey', sModel: 'elevenModel', sProxy: 'proxyUrl', sPixabay: 'pixabayKey', sClaude: 'claudeKey', sClaudeModel: 'claudeModel', sAiProv: 'aiProvider', sGemini: 'geminiKey', sGroq: 'groqKey', sOr: 'orKey', sAiModel: 'aiModel' };
const FX_SLIDERS = [['bass', 'جهارة الطبقات (Bass)', -6, 6, 0.5], ['presence', 'وضوح الكلام (Presence)', -6, 6, 0.5], ['air', 'لمعة (Air)', -6, 6, 0.5], ['comp', 'ضغط ديناميكي', 0, 1, 0.05], ['deess', 'تخفيف السين والشين', 0, 1, 0.05], ['room', 'صدى / مساحة', 0, 0.4, 0.02]];
const STYLE_PRESETS = {
  '': { name: '— اختار —' },
  formal: { name: 'نشرة رسمية هادية', stability: 0.65, similarity: 0.8, style: 0, speed: 1 },
  lively: { name: 'حماسي وسريع', stability: 0.35, similarity: 0.75, style: 0.5, speed: 1.08 },
  story: { name: 'حكاية / درامي', stability: 0.3, similarity: 0.75, style: 0.6, speed: 0.95 },
  calm: { name: 'هادي ومطمّن', stability: 0.75, similarity: 0.8, style: 0.1, speed: 0.95 },
};
const VTAGS = [
  ['مبسوط', 'happily', 1], ['حزين', 'sad', 1], ['غاضب', 'angry', 1], ['متحمس', 'excited', 0], ['قلقان', 'nervous', 0], ['هادي', 'calm', 0],
  ['همس', 'whispers', 1], ['صراخ', 'shouts', 1], ['ببطء', 'slowly', 0], ['بسرعة', 'speaking quickly', 0],
  ['ضحكة', 'laughs', 1], ['تنهيدة', 'sighs', 1], ['تنحنح', 'clears throat', 1], ['نفس سريع', 'breathing heavily', 0], ['لهثان', 'gasping', 0], ['وقفة', 'pause', 0],
];
function renderFxControls() {
  const fx = getSettings().fx;
  $('sFxPreset').innerHTML = Object.entries(FX_PRESETS).map(([k, v]) => `<option value="${k}">${v.name}</option>`).join('') + '<option value="custom">مخصص</option>';
  $('sFxPreset').value = fx.preset || 'none';
  $('slFx').innerHTML = FX_SLIDERS.map(([k, label, min, max, step]) => `<label>${label}<input type="range" data-fx="${k}" min="${min}" max="${max}" step="${step}" value="${fx[k] ?? 0}"><output>${Number(fx[k] ?? 0)}</output></label>`).join('');
  $('sFxNorm').checked = !!fx.norm;
  $('sStylePreset').innerHTML = Object.entries(STYLE_PRESETS).map(([k, v]) => `<option value="${k}">${v.name}</option>`).join('');
  const s = getSettings();
  $('sDialect').checked = !!s.dialectTag; $('sLang').checked = !!s.langCode;
  $('logoOn').checked = !!s.logo?.on; $('logoPos').value = s.logo?.pos || 'tl'; $('logoSize').value = s.logo?.size || 110;
  $('sCapSize').value = s.caps.size; $('sCapPlate').checked = s.caps.plate !== false; $('sCapStroke').checked = s.caps.stroke !== false;
}
function collectFx() {
  const fx = { preset: $('sFxPreset').value, norm: $('sFxNorm').checked, target: -16 };
  for (const r of $('slFx').querySelectorAll('input[type=range]')) fx[r.dataset.fx] = Number(r.value);
  return fx;
}
$('sFxPreset').addEventListener('change', () => {
  const p = FX_PRESETS[$('sFxPreset').value];
  if (!p) return;
  for (const r of $('slFx').querySelectorAll('input[type=range]')) { r.value = p[r.dataset.fx] ?? 0; r.nextElementSibling.textContent = r.value; }
  $('sFxNorm').checked = !!p.norm;
});
$('slFx').addEventListener('input', e => { if (e.target.type === 'range') { e.target.nextElementSibling.textContent = e.target.value; $('sFxPreset').value = 'custom'; } });
$('sStylePreset').addEventListener('change', () => {
  const p = STYLE_PRESETS[$('sStylePreset').value];
  if (!p?.stability) return;
  for (const sp of ['A', 'B']) for (const r of $('sl' + sp).querySelectorAll('input[type=range]')) { const v = { stability: p.stability, similarity: p.similarity, style: p.style, speed: p.speed }[r.dataset.k]; if (v != null) { r.value = v; r.nextElementSibling.textContent = Number(v).toFixed(2); } }
});

// وسوم الصوت في الاستوديو
function renderVoiceTags() {
  $('fxTags').innerHTML = VTAGS.map(([ar, tag, ok]) => `<button class="chip" data-vtag="${tag}">${ar} ${ok ? '✅' : '٭'}</button>`).join('');
  const v2 = getSettings().elevenModel !== 'eleven_v3';
  const has = /\[[^\]]*\]/.test($('fScript').value);
  $('fxWarn').hidden = !(v2 && has);
  $('fxWarn').textContent = 'السكريبت فيه وسوم صوتية بس الموديل الحالي مش v3: الوسوم هتتشال ومش هتأثر. غيّر الموديل من الإعدادات.';
}
$('fxTags').addEventListener('click', e => {
  const t = e.target.dataset.vtag;
  if (!t) return;
  const ta = $('fScript'), p = ta.selectionStart ?? ta.value.length;
  const ins = `[${t}] `;
  ta.value = ta.value.slice(0, p) + ins + ta.value.slice(ta.selectionEnd ?? p);
  ta.focus(); ta.selectionStart = ta.selectionEnd = p + ins.length;
  ta.dispatchEvent(new Event('input', { bubbles: true }));
});
$('fScript').addEventListener('input', () => { $('fxWarn').hidden = !(getSettings().elevenModel !== 'eleven_v3' && /\[[^\]]*\]/.test($('fScript').value)); });

// تجربة قبل/بعد تأثير الصوت
document.querySelector('#tab-settings').addEventListener('click', async e => {
  const m = e.target.dataset.fx;
  if (m !== 'raw' && m !== 'fx') return;
  try {
    saveSettings();
    e.target.disabled = true;
    const r = await speakLine('أهلاً بيكم في نشرة النهارده، وده اختبار لجودة الصوت.', 'A');
    const ac = audioCtx(); ac.resume();
    const src = ac.createBufferSource();
    src.buffer = m === 'fx' ? applyFxToBuffer(r.buffer, getSettings().fx) : r.buffer;
    src.connect(ac.destination); src.start();
  } catch (err) { $('usage').textContent = elError(err); }
  e.target.disabled = false;
});
function showAiFields() {
  const p = $('sAiProv').value || 'claude';
  document.querySelectorAll('.aiK').forEach(el => { el.hidden = !el.dataset.p.split(' ').includes(p); });
  const P = AI_PROVIDERS[p];
  $('aiModels').innerHTML = (P.models || []).map(m => `<option value="${m}">`).join('');
  $('sAiModel').placeholder = P.model || '';
}
$('sAiProv').addEventListener('change', showAiFields);
$('aiModelsLoad').addEventListener('click', async () => {
  const p = $('sAiProv').value;
  $('aiModelsMsg').textContent = 'بجيب القايمة…';
  try {
    saveSettings();
    const ids = await listModels(p);
    if (!ids.length) throw new Error('مفيش موديلات رجعت.');
    $('aiModels').innerHTML = ids.map(m => `<option value="${m}">`).join('');
    if (!$('sAiModel').value || !ids.includes($('sAiModel').value)) $('sAiModel').value = ids.find(i => /flash|instant|70b|llama/.test(i)) || ids[0];
    $('aiModelsMsg').textContent = `${ids.length} موديل. اخترت «${$('sAiModel').value}»، غيّره من الخانة لو عايز، وبعدين «حفظ الإعدادات».`;
  } catch (e) { $('aiModelsMsg').textContent = '❌ ' + (e.message || e); }
});
const SLIDERS = [['stability', 'الثبات', 0, 1, 0.05], ['similarity', 'التشابه', 0, 1, 0.05], ['style', 'التعبير', 0, 1, 0.05], ['speed', 'السرعة', 0.7, 1.2, 0.05]];
let voices = [];

// خطأ صلاحيات من ElevenLabs: المفتاح سليم بس ناقصه صلاحية اختيارية (مش بتمنع التوليد)
function elError(e) {
  const m = String(e.message || e);
  const perm = (m.match(/permission (\w+)/) || [])[1];
  if (/missing_permissions/.test(m)) {
    const what = { voices_read: 'قراءة الأصوات (Voices: Read)', user_read: 'قراءة الحساب (User: Read)' }[perm] || perm || 'غير معروفة';
    return `⚠️ المفتاح سليم، بس ناقصه صلاحية ${what}. ده مش بيمنع التوليد: الصق رقم الصوت يدويًا واضغط «حفظ الإعدادات» وبعدها «🧪 جرّب بإعداداتي».`;
  }
  return '❌ ' + m;
}

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
  renderFxControls();
  renderVoiceTags();
  showAiFields();
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
  o.fx = collectFx();
  o.dialectTag = $('sDialect').checked;
  o.langCode = $('sLang').checked;
  o.logo = { on: $('logoOn').checked, pos: $('logoPos').value, size: Number($('logoSize').value) || 110 };
  o.caps = { size: Number($('sCapSize').value) || 84, plate: $('sCapPlate').checked, stroke: $('sCapStroke').checked };
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
  try { fillUsage(await fetchSubscription()); } catch (e) { $('usageBar').hidden = true; $('usage').textContent = elError(e); }
});

$('elVoices').addEventListener('click', async () => {
  saveSettings();
  $('usage').textContent = 'بحمّل الأصوات…';
  try {
    voices = await fetchVoices();
    renderVoiceSelect('A'); renderVoiceSelect('B');
    $('usage').textContent = `اتحمّل ${voices.length} صوت من حسابك. اختار صوت المذيع أ وب وبعدها «حفظ الإعدادات».`;
  } catch (e) { $('usage').textContent = elError(e); }
});

// تشخيص كامل بضغطة: شكل المفتاح، الصوت، الرصيد، الأصوات، وتوليد فعلي لكلمة واحدة
$('elDiag').addEventListener('click', async () => {
  saveSettings();
  const s = getSettings();
  const out = [`نسخة الكود: ${new URL(import.meta.url).searchParams.get('v') || '-'}`];
  const box = $('diag');
  const log = (icon, t) => { out.push(`${icon} ${t}`); box.textContent = out.join('\n'); };
  box.hidden = false;
  box.textContent = 'بشخّص…';
  const k = s.elevenKey;
  if (!k) log('❌', 'مفيش مفتاح في الإعدادات.');
  else if (!k.startsWith('sk_')) log('❌', `المفتاح مش بيبدأ بـ sk_ (بيبدأ بـ "${k.slice(0, 4)}"، وطوله ${k.length}). غالبًا ده معرّف المفتاح مش المفتاح نفسه.`);
  else log('✅', `شكل المفتاح سليم (sk_… طوله ${k.length}).`);
  log(s.voiceA ? '✅' : '❌', s.voiceA ? `صوت المذيع أ: ${s.voiceA}` : 'مفيش صوت للمذيع أ (الصق رقم الصوت في «أو رقم الصوت يدويًا»).');
  log('ℹ️', `الموديل: ${s.elevenModel}${s.proxyUrl ? ' • بوسيط' : ''}`);
  const soft = e => (/missing_permissions/.test(e.message) ? '⚠️' : '❌');
  try { const sub = await fetchSubscription(); log('✅', `الرصيد: ${sub.used} من ${sub.limit} حرف.`); fillUsage(sub); } catch (e) { log(soft(e), 'قراءة الرصيد (اختيارية): ' + e.message); }
  try { const v = await fetchVoices(); voices = v; log('✅', `الأصوات: ${v.length} صوت.`); } catch (e) { log(soft(e), 'قراءة الأصوات (اختيارية): ' + e.message); }
  if (s.elevenKey && s.voiceA) {
    try {
      const r = await speakLine('تجربة', 'A');
      log('✅', `التوليد شغّال (${r.buffer.duration.toFixed(1)} ثانية${r.cached ? '، من الكاش' : ''}). كده الأداة جاهزة للصوت.`);
    } catch (e) { log('❌', 'التوليد: ' + e.message); }
  } else log('⏭', 'اتخطّيت اختبار التوليد (ناقص مفتاح أو صوت).');
});

$('elReset').addEventListener('click', () => {
  if (!confirm('تمسح مفتاح ElevenLabs والأصوات وإعداداتها من الأداة دي؟ (الريلز والصوت المتولّد مش هيتأثروا. رابط الوسيط ومفتاح Pixabay هيفضلوا.)')) return;
  resetElevenSettings();
  voices = [];
  $('diag').hidden = true;
  fillSettings();
  $('usage').textContent = 'اتمسحت إعدادات ElevenLabs. تقدر تلصق مفتاح جديد، أو تشتغل بتسجيل صوتك / رفع ملف صوت من غير ElevenLabs.';
});

$('elCache').addEventListener('click', async () => {
  if (!confirm('تمسح كل الصوت المتولّد المحفوظ؟ لو ولّدته تاني هيصرف حروف من رصيدك.')) return;
  await cacheClear();
  audioMap.clear();
  updateInfo();
  redraw();
  $('usage').textContent = 'اتمسح كاش الصوت.';
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
  } catch (err) { $('usage').textContent = elError(err); }
  e.target.disabled = false;
});

/* ---------- تشغيل ---------- */
// رقم النسخة: لو الصفحة والكود مختلفين يبقى فيه كاش قديم
const codeV = new URL(import.meta.url).searchParams.get('v') || '-';
const pageV = document.documentElement.dataset.v || '-';
$('ver').textContent = `نسخة ${codeV}${codeV === pageV ? '' : ` ⚠️ الصفحة ${pageV} — اعمل تحديث قوي (Ctrl+Shift+R) أو امسح الكاش`}`;

(async function init() {
  $('sModel').innerHTML = MODELS.map(m => `<option value="${m.id}">${m.name}</option>`).join('');
  $('sAiProv').innerHTML = Object.entries(AI_PROVIDERS).map(([k, v]) => `<option value="${k}">${v.name}</option>`).join('');
  $('sClaudeModel').innerHTML = CLAUDE_MODELS.map(m => `<option value="${m.id}">${m.name}</option>`).join('');
  cfg = await loadConfig();
  const opts = cfg.categories.map(c => `<option value="${c.id}">${c.label}</option>`).join('');
  $('fCat').innerHTML = opts;
  $('mCat').innerHTML = opts;
  $('sortBy').value = prefs.sort || 'new'; $('trendOnly').checked = !!prefs.trend;
  renderChips();
  fillSettings();
  await loadLogo();
  const saved = currentId() && getReel(currentId());
  if (saved) reel = normalizeReel(saved);
  fillForm();
  restoreAudio();
  if (reel.stories.some(x => x.template === 'map')) loadWorld();
  try { feeds = await loadFeeds(); } catch { $('feedInfo').textContent = 'تعذر تحميل data/feeds.json.'; }
  renderFeed();
  loadFonts().then(() => redraw());
  window.__nrs = { redraw, get reel() { return reel; }, get cur() { return cur; }, audioMap, setManual: b => { manualAudio = b; updateInfo(); redraw(); } };
})();

/* ---------- النشر: حزمة + طابور + سجل تجارب (M4) ---------- */
let pbId = null;
const today = () => new Date().toISOString().slice(0, 10);
const pbRec = () => (pbId ? getReel(pbId) : null);

// بنعدّل سجل المكتبة، ولو الريل مفتوح في الاستوديو بنعدّل نسخته في الذاكرة كمان (عشان الحفظ التلقائي ميمسحش التعديل)
function patchReel(id, fn) {
  const rec = getReel(id);
  if (!rec) return null;
  fn(rec);
  if (reel.id === id) fn(reel);
  upsertReel(rec);
  return rec;
}

function renderPublish() {
  const all = listReels().map(normalizeReel).filter(r => !r.stories.every(isEmptyStory));
  if (!pbId || !all.some(r => r.id === pbId)) pbId = (all.find(r => r.id === reel.id) || all[0])?.id || null;
  $('pbReel').innerHTML = all.length ? all.map(r => `<option translate="no" value="${r.id}" ${r.id === pbId ? 'selected' : ''}>${esc(r.title || r.stories[0].headline || '(من غير عنوان)')}</option>`).join('') : '<option value="">مفيش ريلز لسه</option>';
  $('lgPlat').innerHTML = Object.entries(PLATFORMS).map(([k, v]) => `<option value="${k}">${v}</option>`).join('');
  if (!$('lgDate').value) $('lgDate').value = today();
  const rec = pbId ? normalizeReel(getReel(pbId)) : null;
  if (rec && !rec.pack) patchReel(pbId, r => { r.pack = buildPack(normalizeReel(r), { handle: getSettings().handle }); });
  const r = rec ? normalizeReel(getReel(pbId)) : null;
  const pack = r?.pack || { title: '', titles: [], desc: '', tags: '' };
  $('pbTitle').value = pack.title || '';
  $('pbDesc').value = pack.desc || '';
  $('pbTags').value = pack.tags || '';
  $('pbTitles').innerHTML = (pack.titles || []).map((t, i) => `<button class="chip" data-t="${i}" translate="no">${esc(t.slice(0, 40))}</button>`).join('');
  $('pbDate').value = r?.plan?.date || '';
  document.querySelectorAll('[data-plat]').forEach(c => { c.checked = !!r?.plan?.platforms?.includes(c.dataset.plat); });
  renderQueue(all);
  renderLog(all, r);
}

function renderQueue(all) {
  const rows = all.filter(r => r.plan?.date && r.status !== 'published').sort((a, b) => a.plan.date.localeCompare(b.plan.date));
  $('pbQueue').innerHTML = rows.length ? rows.map(r => {
    const late = r.plan.date < today();
    return `<article class="item"><h3 dir="auto" translate="no">${esc(r.title || r.stories[0].headline || '')}</h3>
      <div class="meta"><span>${r.plan.date}${late ? ' ⚠️ متأخر' : r.plan.date === today() ? ' • النهارده' : ''}</span><span>${(r.plan.platforms || []).map(p => PLATFORMS[p]).join('، ') || 'من غير منصة'}</span><span class="stat ${r.status}">${STATUSES[r.status]}</span></div>
      <div class="row"><button class="btn" data-pbopen="${r.id}">الحزمة</button><button class="btn ghost" data-pbstudio="${r.id}">الاستوديو</button></div></article>`;
  }).join('') : '<p class="muted">الطابور فاضي. اختار ريل وتاريخ واضغط «حفظ في الطابور».</p>';
}

const fmtPct = v => (v * 100).toFixed(1) + '%';
function renderLog(all, r) {
  $('lgList').innerHTML = (r?.posts || []).map((p, i) => `<article class="item"><div class="meta"><span>${PLATFORMS[p.platform] || p.platform}</span><span>${esc(p.date)}</span><span>👁 ${p.views || 0}</span><span>❤ ${p.likes || 0}</span><span>💬 ${p.comments || 0}</span><span>↗ ${p.shares || 0}</span><span>🔖 ${p.saves || 0}</span><span>تفاعل ${fmtPct(engagement(p))}</span>${p.tag ? `<span class="tag">${esc(p.tag)}</span>` : ''}</div>
    ${p.url ? `<a href="${esc(p.url)}" target="_blank" rel="noopener" dir="ltr">${esc(p.url.slice(0, 60))}</a>` : ''}<div class="row"><button class="btn ghost" data-lgdel="${i}">حذف</button></div></article>`).join('');
  const tbl = (title, rows) => rows.length ? `<table class="tbl"><caption>${title}</caption><tr><th></th><th>منشورات</th><th>متوسط المشاهدات</th><th>متوسط التفاعل</th></tr>${rows.map(x => `<tr><td>${esc(PLATFORMS[x.key] || x.key)}</td><td>${x.n}</td><td>${x.views}</td><td>${fmtPct(x.eng)}</td></tr>`).join('')}</table>` : '';
  const withPosts = all.filter(x => x.posts?.length);
  $('lgStats').innerHTML = withPosts.length ? tbl('حسب المنصة', summarize(withPosts, 'platform')) + tbl('حسب وسم التجربة', summarize(withPosts, 'tag')) + '<p class="muted">التفاعل = (إعجابات + تعليقات + مشاركات + حفظ) ÷ مشاهدات. الأرقام الصغيرة مش دليل: استنى 5 منشورات على الأقل لكل وسم.</p>' : '<p class="muted">مفيش تسجيلات لسه.</p>';
}

$('pbReel').addEventListener('change', () => { pbId = $('pbReel').value || null; renderPublish(); });
$('pbTitles').addEventListener('click', e => { const r = pbRec(); const t = e.target.dataset.t; if (r && t != null) { $('pbTitle').value = r.pack.titles[t]; $('pbTitle').dispatchEvent(new Event('input')); } });
for (const id of ['pbTitle', 'pbDesc', 'pbTags']) {
  $(id).addEventListener('input', () => {
    if (pbId) patchReel(pbId, r => { r.pack = { ...(r.pack || {}), title: $('pbTitle').value, desc: $('pbDesc').value, tags: $('pbTags').value }; });
  });
}
$('pbRegen').addEventListener('click', () => {
  if (!pbId || !confirm('ده هيستبدل العنوان والوصف والهاشتاجات بالنسخة التلقائية. موافق؟')) return;
  patchReel(pbId, r => { r.pack = buildPack(normalizeReel(r), { handle: getSettings().handle }); });
  renderPublish();
});
document.querySelector('#tab-publish').addEventListener('click', async e => {
  const d = e.target.dataset;
  if (d.cp && pbId) {
    const text = compose({ title: $('pbTitle').value, desc: $('pbDesc').value, tags: $('pbTags').value }, d.cp);
    try { await navigator.clipboard.writeText(text); $('pbMsg').textContent = `اتنسخ نص ${PLATFORMS[d.cp]} (${text.length} حرف) ✅`; }
    catch { $('pbMsg').textContent = 'المتصفح منع النسخ، حدّد النص وانسخه يدويًا.'; }
  }
  if (d.pbopen) { pbId = d.pbopen; renderPublish(); window.scrollTo(0, 0); }
  if (d.pbstudio) openReel(d.pbstudio);
  if (d.lgdel != null && pbId && confirm('تحذف التسجيل ده؟')) { patchReel(pbId, r => { (r.posts = r.posts || []).splice(Number(d.lgdel), 1); }); renderPublish(); }
});
$('pbPlan').addEventListener('click', () => {
  if (!pbId) return;
  const platforms = [...document.querySelectorAll('[data-plat]')].filter(c => c.checked).map(c => c.dataset.plat);
  patchReel(pbId, r => { r.plan = { date: $('pbDate').value, platforms }; });
  renderPublish();
});
$('lgAdd').addEventListener('click', () => {
  if (!pbId) return;
  const p = { platform: $('lgPlat').value, date: $('lgDate').value || today(), url: $('lgUrl').value.trim(), tag: $('lgTag').value.trim() };
  for (const k of ['views', 'likes', 'comments', 'shares', 'saves']) p[k] = Math.max(0, Number($('lg' + k[0].toUpperCase() + k.slice(1)).value) || 0);
  patchReel(pbId, r => { (r.posts = r.posts || []).push(p); r.status = 'published'; });
  for (const id of ['lgUrl', 'lgViews', 'lgLikes', 'lgComments', 'lgShares', 'lgSaves']) $(id).value = '';
  renderPublish();
});
