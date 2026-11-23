// Take-down requests for the music videos page. POST only. Nothing here can be read back over HTTP:
// requests go into KV and the desk reads them with a local command.
const ORIGINS = ['https://advancedstudios.net', 'https://www.advancedstudios.net', 'http://192.168.4.75:8832'];
const CAPS = { video: 120, name: 120, contact: 200, message: 2000 };
const MAX_BODY = 6000;        // bytes
const MIN_FILL_MS = 3000;     // a person takes longer than this to fill four fields
const PER_IP_PER_HOUR = 3;
const PER_DAY = 150;          // every accepted request is 3 KV writes; the free plan allows 1,000 a day

const cors = (req) => {
  const o = req.headers.get('Origin') || '';
  return { 'Access-Control-Allow-Origin': ORIGINS.includes(o) ? o : ORIGINS[0], 'Vary': 'Origin', 'Access-Control-Allow-Methods': 'POST, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type', 'Access-Control-Max-Age': '86400' };
};
const reply = (req, status, body) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...cors(req) } });
const hex = (buf) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');

export default {
  async fetch(req, env) {
    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors(req) });
    if (req.method !== 'POST') return reply(req, 405, { ok: false, error: 'post only' });
    if (!(req.headers.get('Content-Type') || '').startsWith('application/json')) return reply(req, 415, { ok: false, error: 'json only' });
    const raw = await req.text();
    if (raw.length > MAX_BODY) return reply(req, 413, { ok: false, error: 'too long' });
    let d;
    try { d = JSON.parse(raw); } catch (e) { return reply(req, 400, { ok: false, error: 'bad json' }); }
    if (!d || typeof d !== 'object') return reply(req, 400, { ok: false, error: 'bad json' });
    // the honeypot: a field no person sees. And nobody fills the form in under three seconds.
    if (d.website) return reply(req, 422, { ok: false, error: 'rejected' });
    if (!(Number(d.elapsed) >= MIN_FILL_MS)) return reply(req, 422, { ok: false, error: 'too fast' });
    const f = {};
    for (const k of Object.keys(CAPS)) {
      const v = typeof d[k] === 'string' ? d[k].trim() : '';
      if (v.length > CAPS[k]) return reply(req, 413, { ok: false, error: k + ' is too long' });
      f[k] = v;
    }
    if (!f.video || !f.contact || !f.message) return reply(req, 400, { ok: false, error: 'video, contact and message are needed' });

    const now = Date.now(), day = new Date(now).toISOString().slice(0, 10);
    const ip = req.headers.get('CF-Connecting-IP') || 'unknown';
    const who = hex(await crypto.subtle.digest('SHA-256', new TextEncoder().encode('mv-takedown:' + ip))).slice(0, 24);   // no raw address is kept
    const hits = ((await env.INBOX.get('rl:' + who, 'json')) || []).filter((t) => now - t < 3600e3);
    if (hits.length >= PER_IP_PER_HOUR) return reply(req, 429, { ok: false, error: 'too many requests, try again in an hour' });
    const today = parseInt((await env.INBOX.get('day:' + day)) || '0', 10);
    if (today >= PER_DAY) return reply(req, 429, { ok: false, error: 'the inbox is full for today, try again tomorrow' });

    const id = new Date(now).toISOString().replace(/[-:.TZ]/g, '').slice(0, 14) + '-' + hex(crypto.getRandomValues(new Uint8Array(3)));
    await env.INBOX.put('req:' + id, JSON.stringify({ id, at: new Date(now).toISOString(), ...f, from: who, ua: (req.headers.get('User-Agent') || '').slice(0, 200) }), { metadata: { done: false, video: f.video.slice(0, 60) } });
    await env.INBOX.put('rl:' + who, JSON.stringify([...hits, now]), { expirationTtl: 3600 });
    await env.INBOX.put('day:' + day, String(today + 1), { expirationTtl: 2 * 86400 });
    return reply(req, 200, { ok: true });
  },
};
