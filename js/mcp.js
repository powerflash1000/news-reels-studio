// 🔌 عميل MCP صغير من المتصفح (Streamable HTTP + JSON-RPC) — بيتكلم مع أي سيرفر MCP بمفتاح Bearer.
// أول مرة بيحاول مباشر؛ لو المتصفح منع (CORS) وفيه «رابط الوسيط» بيعدّي عليه (الوسيط لازم يسمح بالموقع).
const PROTO = '2025-06-18';

// الرد ممكن يكون JSON عادي أو SSE (event-stream) فيه سطور data:
async function readRpc(res, id) {
  const type = res.headers.get('content-type') || '';
  const text = await res.text();
  if (type.includes('text/event-stream')) {
    let found = null;
    for (const block of text.split(/\r?\n\r?\n/)) {
      const data = block.split(/\r?\n/).filter(l => l.startsWith('data:')).map(l => l.slice(5).trim()).join('\n');
      if (!data) continue;
      try { const j = JSON.parse(data); if (j.id === id || (found == null && (j.result || j.error))) found = j; } catch { /* سطر مش JSON */ }
    }
    return found;
  }
  if (!text.trim()) return null;
  try { return JSON.parse(text); } catch { throw new Error('رد مش مفهوم من السيرفر: ' + text.slice(0, 120)); }
}

// تنضيف المفتاح الملزوق: مسافات، علامات تنصيص، كلمة Bearer، حروف مخفية
export const cleanKey = k => String(k || '').replace(/[\u200B-\u200F\u202A-\u202E\u2066-\u2069\uFEFF]/g, '').replace(/^\s*(authorization\s*:\s*)?bearer\s+/i, '').replace(/^["'«“\s]+|["'»”\s]+$/g, '').trim();
export function mcpClient({ url, key, proxy = '' }) {
  key = cleanKey(key);
  let session = '', n = 0, via = '';
  const base = (proxy || '').replace(/\/+$/, '');
  async function post(body, isNotify) {
    const headers = { 'content-type': 'application/json', accept: 'application/json, text/event-stream', 'mcp-protocol-version': PROTO };
    if (key) headers.authorization = 'Bearer ' + key;
    if (session) headers['mcp-session-id'] = session;
    const send = target => fetch(target, { method: 'POST', headers, body: JSON.stringify(body) });
    let res;
    if (via !== 'proxy') {
      try { res = await send(url); via = 'direct'; }
      catch (e) { if (!base) throw new Error('المتصفح منع الاتصال المباشر (CORS). حط «رابط الوسيط» في الإعدادات (ونزّل آخر نسخة من كود الوسيط).'); }
    }
    if (!res) {
      // «Failed to fetch» من الوسيط = غالبًا نسخة قديمة من كود الوسيط (مش سامحة بـ mcp.el7.ai ولا بهيدرز MCP)
      try { res = await send(`${base}/?url=${encodeURIComponent(url)}`); via = 'proxy'; }
      catch { throw new Error('الاتصال المباشر اتمنع، والوسيط كمان ما ردّش (Failed to fetch). ده معناه إن كود الوسيط على Cloudflare قديم: افتح الـ Worker ← Edit code ← الصق آخر نسخة من tools/cors-proxy-worker.js ← Deploy، وبعدين جرّب تاني.'); }
      if (res.status === 403 && /host not allowed/i.test(await res.clone().text().catch(() => ''))) throw new Error('الوسيط شغال بس مش سامح بـ mcp.el7.ai: حط آخر نسخة من tools/cors-proxy-worker.js على Cloudflare (Deploy) وجرّب تاني.');
    }
    const sid = res.headers.get('mcp-session-id'); if (sid) session = sid;
    if (res.status === 401 || res.status === 403) {
      // سبب الرفض من السيرفر نفسه (بيساعد نعرف: مفتاح غلط/منتهي/من غير اشتراك)
      let why = '';
      try { const t = await res.clone().text(); try { const j = JSON.parse(t); why = j.error_description || j.error?.message || j.message || j.error || ''; } catch { why = t; } } catch { /* */ }
      why = String(why || res.headers.get('www-authenticate') || '').replace(/\s+/g, ' ').slice(0, 160);
      throw Object.assign(new Error((res.status === 401
        ? 'EL7 رفض المفتاح (401). اتأكد إنه مفتاح MCP اللي بيبدأ بـ el7_mcp_ (مش كلمة السر ولا مفتاح تاني)، وإنك نسخته كامل، ولو مش متأكد اعمل مفتاح جديد من el7.ai/en/mcp ← «Your connection».'
        : 'مرفوض (403): يمكن الأداة دي محتاجة اشتراك مدفوع، أو الوسيط مش سامح بالموقع.') + (why ? ` — رد السيرفر: ${why}` : '')), { status: res.status });
    }
    if (isNotify) return null;
    if (!res.ok) throw Object.assign(new Error(`السيرفر رد بخطأ ${res.status}: ${(await res.text()).slice(0, 160)}`), { status: res.status });
    const j = await readRpc(res, body.id);
    if (!j) throw new Error('السيرفر ما ردّش بحاجة.');
    if (j.error) throw Object.assign(new Error(j.error.message || 'خطأ من السيرفر'), { code: j.error.code });
    return j.result;
  }
  const rpc = (method, params = {}) => post({ jsonrpc: '2.0', id: ++n, method, params });
  return {
    get via() { return via; },
    async init() {
      const r = await rpc('initialize', { protocolVersion: PROTO, capabilities: {}, clientInfo: { name: 'news-reels-studio', version: '1' } });
      await post({ jsonrpc: '2.0', method: 'notifications/initialized' }, true).catch(() => {});
      return r;
    },
    async listTools() {
      const out = []; let cursor;
      for (let i = 0; i < 10; i++) {
        const r = await rpc('tools/list', cursor ? { cursor } : {});
        out.push(...(r.tools || []));
        if (!r.nextCursor) break; cursor = r.nextCursor;
      }
      return out;
    },
    async call(name, args = {}) {
      const r = await rpc('tools/call', { name, arguments: args });
      const text = (r.content || []).map(c => c.type === 'text' ? c.text : c.type === 'resource' ? (c.resource?.text || c.resource?.uri || '') : '').filter(Boolean).join('\n\n')
        || (r.structuredContent ? JSON.stringify(r.structuredContent, null, 1) : '');
      if (r.isError) throw new Error(text.slice(0, 300) || 'الأداة رجّعت خطأ');
      return text;
    },
  };
}
