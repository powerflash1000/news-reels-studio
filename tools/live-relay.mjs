#!/usr/bin/env node
// وسيط البث: بيستقبل الصورة والصوت من استوديو ريلز الأخبار (WebSocket محلي) وبيبعتهم بـ ffmpeg
// لكذا منصة في نفس الوقت (YouTube / Facebook / TikTok ...). بيشتغل على جهازك بس، ومفاتيح البث
// بتفضل في ملف الإعداد المحلي ومش بتروح للمتصفح ولا للريبو. من غير أي مكتبات: node + ffmpeg بس.
//
//   node tools/live-relay.mjs            (أول مرة بيعمل ملف الإعداد ويطبع الرمز السري)
//
import http from 'node:http';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const CONFIG = process.env.LIVE_RELAY_CONFIG || path.join(HERE, 'live-relay.config.json');
const GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';
const MAX_MSG = 16 * 1024 * 1024;

/* ---------- الإعداد ---------- */
function loadConfig() {
  if (!fs.existsSync(CONFIG)) {
    const cfg = {
      port: 8787,
      token: crypto.randomBytes(12).toString('hex'),
      allowedOrigins: ['https://powerflash1000.github.io'],
      ffmpegPath: 'ffmpeg',
      outputs: [
        { name: 'youtube', url: 'rtmp://a.rtmp.youtube.com/live2/ضع-مفتاح-البث-هنا' },
        { name: 'facebook', url: 'rtmps://live-api-s.facebook.com:443/rtmp/ضع-مفتاح-البث-هنا' },
        { name: 'tiktok', url: 'rtmp://ضع-سيرفر-تيك-توك-هنا/ضع-المفتاح-هنا' },
      ],
    };
    fs.writeFileSync(CONFIG, JSON.stringify(cfg, null, 2));
    console.log(`اتعمل ملف الإعداد: ${CONFIG}\nافتحه وحط روابط البث (السيرفر + المفتاح) لكل منصة، وامسح المنصات اللي مش عايزها، وبعدين شغّل الأمر تاني.`);
    console.log(`الرمز السري (الصقه في البرنامج): ${cfg.token}`);
    process.exit(0);
  }
  return JSON.parse(fs.readFileSync(CONFIG, 'utf8'));
}
const cfg = loadConfig();
const ready = o => o?.name && /^rtmps?:\/\//i.test(o.url || '') && !/ضع-/.test(o.url);
const outputs = (cfg.outputs || []).filter(ready);

/* ---------- WebSocket بسيط (RFC 6455) ---------- */
function frame(opcode, payload) {
  const len = payload.length;
  const head = len < 126 ? Buffer.from([0x80 | opcode, len]) : len < 65536 ? Buffer.from([0x80 | opcode, 126, len >> 8, len & 255]) : (() => { const b = Buffer.alloc(10); b[0] = 0x80 | opcode; b[1] = 127; b.writeBigUInt64BE(BigInt(len), 2); return b; })();
  return Buffer.concat([head, payload]);
}
function wsHandle(sock, onMessage, onClose) {
  let buf = Buffer.alloc(0), parts = [], partsOp = 0, closed = false;
  const close = () => { if (!closed) { closed = true; onClose(); } };
  sock.on('data', d => {
    buf = Buffer.concat([buf, d]);
    for (;;) {
      if (buf.length < 2) return;
      const fin = !!(buf[0] & 0x80), op = buf[0] & 15, masked = !!(buf[1] & 0x80);
      let len = buf[1] & 127, off = 2;
      if (len === 126) { if (buf.length < 4) return; len = buf.readUInt16BE(2); off = 4; }
      else if (len === 127) { if (buf.length < 10) return; len = Number(buf.readBigUInt64BE(2)); off = 10; }
      if (len > MAX_MSG) { sock.destroy(); return close(); }
      if (buf.length < off + (masked ? 4 : 0) + len) return;
      const mask = masked ? buf.subarray(off, off + 4) : null;
      if (masked) off += 4;
      const p = Buffer.from(buf.subarray(off, off + len));
      buf = buf.subarray(off + len);
      if (mask) for (let i = 0; i < p.length; i++) p[i] ^= mask[i & 3];
      if (op === 8) { try { sock.write(frame(8, Buffer.alloc(0))); } catch { /* مقفول */ } sock.end(); return close(); }
      if (op === 9) { sock.write(frame(10, p)); continue; }
      if (op === 10) continue;
      if (op === 1 || op === 2) { parts = [p]; partsOp = op; } else if (op === 0) parts.push(p);
      if (fin && parts.length) { const m = Buffer.concat(parts); parts = []; onMessage(partsOp === 1 ? m.toString('utf8') : m); }
    }
  });
  sock.on('close', close); sock.on('error', close);
  return { send: o => { if (!closed && !sock.destroyed) sock.write(frame(1, Buffer.from(JSON.stringify(o)))); } };
}

/* ---------- ffmpeg ---------- */
function startFfmpeg(opts, names, send) {
  const chosen = outputs.filter(o => names.includes(o.name));
  if (!chosen.length) throw new Error('مفيش منصات مختارة (أو روابطها لسه مش مضبوطة في ملف الإعداد).');
  const kbps = Math.max(800, Math.min(12000, Number(opts.bitrate) || 3500));
  const fps = Math.max(15, Math.min(60, Number(opts.fps) || 30));
  const vf = `fps=${fps}`;
  const tee = chosen.map(o => `[f=flv:onfail=ignore]${o.url}`).join('|');
  const args = ['-hide_banner', '-loglevel', 'info', '-stats', '-fflags', '+genpts', '-f', 'webm', '-i', 'pipe:0',
    '-map', '0:v:0', '-map', '0:a:0', '-vf', vf,
    '-c:v', 'libx264', '-preset', 'veryfast', '-tune', 'zerolatency', '-profile:v', 'main', '-pix_fmt', 'yuv420p',
    '-b:v', `${kbps}k`, '-maxrate', `${kbps}k`, '-bufsize', `${kbps * 2}k`, '-g', String(fps * 2), '-keyint_min', String(fps * 2), '-sc_threshold', '0',
    '-c:a', 'aac', '-b:a', '128k', '-ar', '44100', '-ac', '2', '-f', 'tee', tee];
  const p = spawn(cfg.ffmpegPath || 'ffmpeg', args, { stdio: ['pipe', 'ignore', 'pipe'] });
  let last = 0;
  p.stderr.on('data', d => {
    for (const line of d.toString().split(/[\r\n]+/)) {
      if (!line.trim()) continue;
      const m = /frame=\s*(\d+)\s+fps=\s*([\d.]+).*?time=(\S+)\s+bitrate=\s*(\S+).*?speed=\s*(\S+)/.exec(line);
      if (m) { if (Date.now() - last > 1000) { last = Date.now(); send({ type: 'stats', frame: +m[1], fps: +m[2], time: m[3], bitrate: m[4], speed: m[5] }); } }
      else if (/error|failed|refused|invalid|unable|could not|broken pipe/i.test(line)) send({ type: 'log', line: line.slice(0, 300) });
    }
  });
  p.on('error', e => send({ type: 'ended', error: e.code === 'ENOENT' ? 'ffmpeg مش متسطّب أو مش في PATH (ثبّته أو حط مساره في ffmpegPath).' : String(e.message) }));
  p.on('close', code => send({ type: 'ended', code }));
  p.stdin.on('error', () => { /* اتقفل */ });
  return { p, names: chosen.map(o => o.name) };
}

/* ---------- السيرفر ---------- */
let session = null;
const server = http.createServer((req, res) => { res.writeHead(200, { 'content-type': 'text/plain; charset=utf-8' }); res.end('news-reels-studio live relay: شغّال.\n'); });
server.on('upgrade', (req, sock) => {
  const url = new URL(req.url, 'http://x');
  const origin = req.headers.origin || '';
  const okOrigin = !origin || (cfg.allowedOrigins || []).includes(origin);
  const tokenOk = cfg.token && url.searchParams.get('token') && crypto.timingSafeEqual(Buffer.from(String(url.searchParams.get('token')).padEnd(64).slice(0, 64)), Buffer.from(String(cfg.token).padEnd(64).slice(0, 64)));
  const key = req.headers['sec-websocket-key'];
  if (!okOrigin || !tokenOk || !key) { sock.write('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n'); return sock.destroy(); }
  if (session) { sock.write('HTTP/1.1 409 Conflict\r\nConnection: close\r\n\r\n'); return sock.destroy(); }
  sock.write(`HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${crypto.createHash('sha1').update(key + GUID).digest('base64')}\r\n\r\n`);
  let ff = null;
  const stopFf = () => { if (ff) { try { ff.p.stdin.end(); } catch { /* خلص */ } const p = ff.p; setTimeout(() => { try { p.kill('SIGTERM'); } catch { /* خلص */ } }, 1500); ff = null; } };
  const ws = wsHandle(sock, msg => {
    if (typeof msg !== 'string') { if (ff && ff.p.stdin.writable) ff.p.stdin.write(msg); return; }
    let m; try { m = JSON.parse(msg); } catch { return; }
    if (m.type === 'start' && !ff) {
      try { ff = startFfmpeg(m, Array.isArray(m.outputs) ? m.outputs : [], ws.send); ws.send({ type: 'started', outputs: ff.names }); }
      catch (e) { ws.send({ type: 'ended', error: String(e.message) }); }
    } else if (m.type === 'stop') stopFf();
  }, () => { stopFf(); session = null; console.log('البرنامج فصل.'); });
  session = ws;
  console.log('البرنامج اتصل.');
  ws.send({ type: 'hello', outputs: outputs.map(o => o.name), skipped: (cfg.outputs || []).filter(o => !ready(o)).map(o => o.name) });
});

server.listen(cfg.port || 8787, '127.0.0.1', () => {
  console.log(`وسيط البث شغّال على ws://localhost:${cfg.port || 8787}`);
  console.log(`المنصات الجاهزة: ${outputs.map(o => o.name).join('، ') || '(مفيش — اضبط الروابط في ' + CONFIG + ')'}`);
  console.log('سيبه مفتوح وارجع للبرنامج → تبويب لايف.');
});
