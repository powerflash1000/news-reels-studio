// لغة الواجهة (عربي / English): قاموس عربي → إنجليزي + ترجمة تلقائية للنصوص في الصفحة وقت التشغيل.
// تغيير اللغة = حفظ التفضيل وإعادة تحميل الصفحة. نصوص الريل نفسها (على الفيديو) بلغة الريل مش لغة الواجهة.
import EN from './i18n-en.js?v=mv28jjt1';

const LS = 'nrs:ui';
const AR = /[؀-ٟٮ-ۿ]/; // حروف عربي (من غير الأرقام الهندية والنجمة ٭)
const norm = s => s.replace(/&#10;/g, ' ').replace(/\s+/g, ' ').trim();
export const ui = (() => { try { return localStorage.getItem(LS) === 'en' ? 'en' : 'ar'; } catch { return 'ar'; } })();

const exact = new Map(Object.entries(EN).map(([k, v]) => [norm(k), v]));
// قوالب فيها {} (جزء متغير): بتتحول لـ regex، الأطول (الأدق) الأول
const pats = [...exact.entries()].filter(([k]) => k.includes('{}')).map(([k, v]) => ({
  re: new RegExp('^' + k.split('{}').map(p => p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('(.*?)') + '$', 's'), v, len: k.length,
})).sort((a, b) => b.len - a.len);

const BOUNDARY = /[.؟?!]\s|\s[❌✅⚠ℹ]/u;
export function tr(s) {
  if (ui === 'ar' || !s || typeof s !== 'string' || !AR.test(s)) return s;
  const lead = s.match(/^\s*/)[0], trail = s.match(/\s*$/)[0];
  const core = norm(s);
  let out = exact.get(core);
  // رموز في الأول (❌ ⚠️ ✅ ℹ️ • ▶ …): بنترجم الباقي ونرجّعها
  const sym = out === undefined && core.match(/^[\p{Extended_Pictographic}\uFE0F\u200d\u2022\s]+/u);
  if (sym && sym[0].trim() && core.length > sym[0].length) { const rest = core.slice(sym[0].length), t = tr(rest); if (t !== rest) return lead + sym[0] + t + trail; }
  if (out === undefined) {
    // قالب {} (بشرط إن الجزء المتغير ميكونش فيه حدود جملة، عشان جملتين ورا بعض ميتلخبطوش)
    for (const p of pats) {
      const m = core.match(p.re);
      if (m && !m.slice(1).some(c => BOUNDARY.test(c))) { let i = 1; out = p.v.replace(/\{\}/g, () => tr(m[i++] ?? '')); break; }
    }
  }
  if (out === undefined && BOUNDARY.test(core)) {
    // رسايل كتير ورا بعض: بنترجم كل جملة لوحدها
    const parts = core.split(/(?<=[.؟?!])\s+|\s+(?=[❌✅⚠ℹ])/u);
    if (parts.length > 1) { const t = parts.map(x => tr(x)); if (t.some((x, i) => x !== parts[i])) out = t.join(' '); }
  }
  if (out === undefined) {
    // نص مركّب (كلمات عربي متفرقة بين رموز/أرقام): بنترجم كل مقطع عربي معروف لوحده
    let hit = false;
    const r = core.replace(/[\u0600-\u065F\u066E-\u06FF][\u0600-\u065F\u066E-\u06FF\s]*[\u0600-\u065F\u066E-\u06FF]|[\u0600-\u065F\u066E-\u06FF]/g, run => { const e = exact.get(run); if (e === undefined) return run; hit = true; return e; });
    if (hit) out = r;
  }
  return out === undefined ? s : lead + out + trail;
}

const ATTRS = ['placeholder', 'title', 'aria-label', 'alt'];
const skip = el => !el || /^(SCRIPT|STYLE|TEXTAREA|CODE)$/.test(el.tagName) || el.closest?.('[translate="no"]');

function text(n) {
  if (!AR.test(n.nodeValue) || skip(n.parentElement)) return;
  const t = tr(n.nodeValue);
  if (t !== n.nodeValue) n.nodeValue = t;
}
function attrs(el) {
  if (!el || /^(SCRIPT|STYLE)$/.test(el.tagName) || el.closest?.('[translate="no"]')) return;
  for (const a of ATTRS) { const v = el.getAttribute?.(a); if (v && AR.test(v)) { const t = tr(v); if (t !== v) el.setAttribute(a, t); } }
}
function walk(root) {
  if (root.nodeType === 3) return text(root);
  if (root.nodeType !== 1 && root.nodeType !== 9) return;
  if (root.nodeType === 1) attrs(root);
  const w = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT);
  for (let n = w.nextNode(); n; n = w.nextNode()) (n.nodeType === 3 ? text(n) : attrs(n));
}

export function initI18n() {
  const btn = document.getElementById('uiLang');
  if (btn) {
    btn.textContent = ui === 'en' ? 'عربي' : 'EN';
    btn.addEventListener('click', () => { try { localStorage.setItem(LS, ui === 'en' ? 'ar' : 'en'); } catch { /* ممنوع التخزين */ } location.reload(); });
  }
  if (ui !== 'en') return;
  document.documentElement.lang = 'en';
  document.documentElement.dir = 'ltr';
  for (const f of ['confirm', 'alert']) { const o = window[f].bind(window); window[f] = m => o(tr(String(m))); }
  walk(document);
  new MutationObserver(muts => {
    for (const m of muts) {
      if (m.type === 'childList') m.addedNodes.forEach(walk);
      else if (m.type === 'characterData') text(m.target);
      else if (m.type === 'attributes') attrs(m.target);
    }
  }).observe(document.documentElement, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ATTRS });
}
