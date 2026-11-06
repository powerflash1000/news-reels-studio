// وسيط CORS صغير على Cloudflare Workers (مجاني حتى 100 ألف طلب في اليوم).
// لو عامله قبل كده: افتحه ← Edit code ← امسح القديم والصق ده ← Deploy (الرابط مبيتغيّرش).
// استخدمه لو المتصفح منع الاتصال بـ ElevenLabs أو تحميل ملفات NASA / Internet Archive / Pixabay (CORS).
// الطريقة: dash.cloudflare.com ← Workers & Pages ← Create ← Hello World ← Edit code
// الصق الكود ده ← Deploy ← انسخ الرابط وحطه في «رابط الوسيط» في إعدادات البرنامج.

// بيسمح بس بالمواقع دي، عشان محدش يستخدم الوسيط بتاعك في حاجة تانية
const ALLOWED_HOSTS = [
  'api.elevenlabs.io',
  'images-assets.nasa.gov', // صور وفيديو NASA
  'archive.org',            // Internet Archive (وكل النطاقات الفرعية)
  'pixabay.com',            // ملفات Pixabay (cdn.pixabay.com) وصفحاته
  'mixkit.co',              // صفحات وفيديوهات Mixkit (assets.mixkit.co)
  'coverr.co',              // بحث Coverr (api.coverr.co) وملفاته
  'pexels.com',             // بحث Pexels (api.pexels.com) وصوره وفيديوهاته وصفحاته
  'player.vimeo.com',
  'youtube.com',            // صفحة القناة وRSS آخر الفيديوهات (لتبويب «تحليل»)
  'si.edu',                 // صور Smithsonian Open Access (ids.si.edu)
  'speech.microsoft.com',   // أصوات Azure Speech (المنطقة.tts.speech.microsoft.com)
];
const hostAllowed = h => ALLOWED_HOSTS.some(a => h === a || h.endsWith('.' + a));
// صفحات مواقع الستوك بترجع صفحة ناقصة للبرامج، فبنطلب زي المتصفح العادي
const BROWSER_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';
const STOCK = ['mixkit.co', 'coverr.co', 'pexels.com', 'pixabay.com'];
// الهيدرز اللي بتتبعت للخدمة الأصلية (مفتاح ElevenLabs ونوع المحتوى)
const FORWARD_HEADERS = ['xi-api-key', 'content-type', 'accept', 'ocp-apim-subscription-key', 'x-microsoft-outputformat', 'authorization'];

export default {
  async fetch(request) {
    const cors = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, HEAD, POST, OPTIONS',
      'Access-Control-Allow-Headers': FORWARD_HEADERS.join(', '),
    };
    if (request.method === 'OPTIONS') return new Response(null, { headers: cors });

    const target = new URL(request.url).searchParams.get('url');
    let url;
    try { url = new URL(target); } catch { return new Response('missing ?url=', { status: 400, headers: cors }); }
    if (url.protocol !== 'https:' || !hostAllowed(url.hostname)) {
      return new Response('host not allowed', { status: 403, headers: cors });
    }

    let upstream;
    if (request.method === 'POST') {
      const fwd = new Headers();
      for (const h of FORWARD_HEADERS) if (request.headers.get(h)) fwd.set(h, request.headers.get(h));
      upstream = await fetch(url.toString(), { method: 'POST', headers: fwd, body: request.body });
    } else if (url.hostname === 'api.elevenlabs.io' || url.hostname === 'api.pexels.com' || url.hostname === 'api.coverr.co' || url.hostname.endsWith('.speech.microsoft.com')) {
      const fwd = new Headers();
      for (const h of FORWARD_HEADERS) if (request.headers.get(h)) fwd.set(h, request.headers.get(h));
      upstream = await fetch(url.toString(), { headers: fwd });
    } else {
      const stock = STOCK.some(d => url.hostname === d || url.hostname.endsWith('.' + d));
      upstream = await fetch(url.toString(), stock
        ? { headers: { 'user-agent': BROWSER_UA, 'accept-language': 'en-US,en;q=0.9' }, redirect: 'follow' }
        : { cf: { cacheEverything: true, cacheTtl: 86400 } });
    }
    const headers = new Headers(upstream.headers);
    for (const [k, v] of Object.entries(cors)) headers.set(k, v);
    return new Response(upstream.body, { status: upstream.status, headers });
  },
};
