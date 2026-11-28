// Call-in voicemail inbox for advancedstudios.net. Free plan. It answers on ONE exact path
// (media.advancedstudios.net/callin) and only takes a POST of one MP3 the caller's browser already cleaned.
// It checks the file (MP3 by its frame headers, every byte of it; size; length), Turnstile, and the rate gate, asks
// Workers AI for a transcript, and stores ONE KV value: the MP3, with the index (time, length, page, transcript) in
// its metadata. Nothing can be read back over HTTP: the desk reads the store with a local command (callins).
import { DurableObject } from 'cloudflare:workers';

export const ORIGINS = ['https://advancedstudios.net', 'https://www.advancedstudios.net', 'http://localhost:8841'];
export const MAX_BYTES = 640 * 1024;   // 62 s at 64 kbps is 496 KB; this leaves room for a higher bitrate, no more
export const MAX_SECS = 62;            // the browser stops at 60 s; a little margin for the encoder's padding
export const MIN_SECS = 0.5;
export const PER_IP_PER_HOUR = 4;
export const PER_DAY = 200;            // one KV write per call; the free plan's 1,000 writes a day are shared
// env.DAILY_CAP can only lower it (20 while Turnstile runs on Cloudflare's always-pass test secret).
export const dailyCap = (env) => Math.min(PER_DAY, Math.max(0, parseInt(env.DAILY_CAP, 10) >= 0 ? parseInt(env.DAILY_CAP, 10) : PER_DAY));
export const STORE_CAP = 800 * 1024 * 1024;   // KV free storage is 1 GB for the account
export const AI_MINUTES_PER_DAY = 150; // whisper-large-v3-turbo: 46.63 neurons per audio minute; 10,000 a day are free
export const MODEL = '@cf/openai/whisper-large-v3-turbo';
const META_MAX = 1000;                 // KV metadata is at most 1024 bytes of JSON
const MPEG_RATES = { 3: [44100, 48000, 32000], 2: [22050, 24000, 16000], 0: [11025, 12000, 8000] };
const KBPS = {
  v1: [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320],
  v2: [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160],
};

// Every byte must belong to an MPEG audio Layer III frame, all frames alike (version, sample rate, mono). No ID3
// tag, no trailing data: what is stored is sound and nothing else. Returns {frames, secs, rate, kbps} or {error}.
export function parseMp3(u8) {
  let off = 0, frames = 0, first = null, maxKbps = 0;
  while (off < u8.length) {
    if (off + 4 > u8.length) return { error: 'the file ends in the middle of a frame' };
    const h = (u8[off] << 24 | u8[off + 1] << 16 | u8[off + 2] << 8 | u8[off + 3]) >>> 0;
    if ((h >>> 21) !== 0x7ff) return { error: frames ? 'something that is not audio follows the sound' : 'not an MP3' };
    const ver = (h >>> 19) & 3, layer = (h >>> 17) & 3, bi = (h >>> 12) & 15, si = (h >>> 10) & 3, pad = (h >>> 9) & 1, mode = (h >>> 6) & 3;
    if (ver === 1 || layer !== 1 || bi === 0 || bi === 15 || si === 3) return { error: 'not an MP3' };
    if (mode !== 3) return { error: 'mono only' };
    const rate = MPEG_RATES[ver][si], kbps = (ver === 3 ? KBPS.v1 : KBPS.v2)[bi];
    const spf = ver === 3 ? 1152 : 576;
    const len = Math.floor((spf / 8) * kbps * 1000 / rate) + pad;
    if (!first) first = { ver, rate, spf };
    else if (ver !== first.ver || rate !== first.rate) return { error: 'the frames change format part way' };
    if (off + len > u8.length) return { error: 'the file ends in the middle of a frame' };
    maxKbps = Math.max(maxKbps, kbps);
    off += len; frames++;
  }
  if (!frames) return { error: 'not an MP3' };
  return { frames, rate: first.rate, secs: frames * first.spf / first.rate, kbps: maxKbps };
}

// The gate: one Durable Object counts accepted calls (per hashed address in the last hour, and in all today),
// the bytes in the store, and the minutes sent to Workers AI today. When the day turns it wipes its counters and
// recounts the store from KV (one list per 1,000 calls), so calls the desk deleted free their space by the next day.
export class Gate extends DurableObject {
  async admit(who, now, bytes, secs, cap = PER_DAY) {
    const st = this.ctx.storage, day = new Date(now).toISOString().slice(0, 10);
    if ((await st.get('day')) !== day) {
      const stored = await this.recount();
      await st.deleteAll();
      await st.put({ day, stored });
    }
    const total = (await st.get('total')) || 0;
    if (total >= cap) return { verdict: 'day' };
    const stored = (await st.get('stored')) || 0;
    if (stored + bytes > STORE_CAP) return { verdict: 'full' };
    const hits = ((await st.get('ip:' + who)) || []).filter((t) => now - t < 3600e3);
    if (hits.length >= PER_IP_PER_HOUR) return { verdict: 'ip' };
    const aiMin = (await st.get('ai')) || 0, mins = secs / 60, ai = aiMin + mins <= AI_MINUTES_PER_DAY;
    await st.put({ ['ip:' + who]: [...hits, now], total: total + 1, stored: stored + bytes, ai: ai ? aiMin + mins : aiMin });
    return { verdict: 'ok', ai };
  }
  async recount() {
    let sum = 0, cursor;
    do {
      const r = await this.env.STORE.list({ prefix: 'call:', cursor });
      for (const k of r.keys) sum += (k.metadata && k.metadata.bytes) || 0;
      cursor = r.list_complete ? null : r.cursor;
    } while (cursor);
    return sum;
  }
  async peek() { return Object.fromEntries(await this.ctx.storage.list()); }   // tests only; no route reaches it
}

const cors = (req) => {
  const o = req.headers.get('Origin') || '';
  return { 'Access-Control-Allow-Origin': ORIGINS.includes(o) ? o : ORIGINS[0], 'Vary': 'Origin',
           'Access-Control-Allow-Methods': 'POST, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type, X-Turnstile, X-Callin-Page',
           'Access-Control-Max-Age': '86400' };
};
const reply = (req, status, body) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...cors(req) } });
const no = (req, status, code, words) => reply(req, status, { ok: false, code, error: words });
const hex = (buf) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');

async function readCapped(req, max) {
  const reader = req.body && req.body.getReader();
  if (!reader) return new Uint8Array(0);
  const parts = []; let n = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    n += value.length;
    if (n > max) { reader.cancel(); return null; }
    parts.push(value);
  }
  const out = new Uint8Array(n); let o = 0;
  for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
}

async function turnstile(env, token, ip) {
  const body = new FormData();
  body.append('secret', env.TURNSTILE_SECRET || '');
  body.append('response', token);
  if (ip) body.append('remoteip', ip);
  try {
    const r = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', { method: 'POST', body });
    const j = await r.json();
    if (!j.success) return false;
    // Cloudflare's test secrets answer for example.com; a real widget must be ours.
    const test = /^[123]x0{30,}AA$/.test(env.TURNSTILE_SECRET || '');
    return test || ['advancedstudios.net', 'www.advancedstudios.net', 'localhost'].includes(j.hostname);
  } catch (e) {
    return false;
  }
}

function base64(u8) {
  if (typeof u8.toBase64 === 'function') return u8.toBase64();
  let s = '';
  for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000));
  return btoa(s);
}

async function transcribe(env, u8) {
  try {
    const run = env.AI.run(MODEL, { audio: base64(u8), language: 'en', vad_filter: true });
    const out = await Promise.race([run, new Promise((_, no) => setTimeout(() => no(new Error('timeout')), 25000))]);
    return { tx: 'ok', text: String((out && out.text) || '').trim() };
  } catch (e) {
    return { tx: 'failed', text: '' };
  }
}

// The index, in the KV metadata: short keys, transcript cut to fit the 1024 bytes.
export function meta(m) {
  const o = { at: m.at, secs: m.secs, page: m.page, bytes: m.bytes, tx: m.tx, t: m.text || '' };
  while (JSON.stringify(o).length > META_MAX) { o.t = o.t.slice(0, o.t.length - 20); o.cut = 1; }
  return o;
}

export default {
  async fetch(req, env) {
    const url = new URL(req.url);
    if (url.pathname !== '/callin') return new Response('Not found', { status: 404 });
    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors(req) });
    if (req.method !== 'POST') return no(req, 405, 'method', 'Calls come in by POST only.');
    const type = (req.headers.get('Content-Type') || '').split(';')[0].trim().toLowerCase();
    if (type !== 'audio/mpeg') return no(req, 415, 'type', 'Only an MP3 message can be left here.');
    const claimed = Number(req.headers.get('Content-Length') || 0);
    if (claimed > MAX_BYTES) return no(req, 413, 'big', 'That message is too big to leave.');
    const token = req.headers.get('X-Turnstile') || '';
    if (!token) return no(req, 403, 'turnstile', "The robot check didn't come through. Please try sending again.");

    const u8 = await readCapped(req, MAX_BYTES);
    if (!u8) return no(req, 413, 'big', 'That message is too big to leave.');
    const mp3 = parseMp3(u8);
    if (mp3.error) return no(req, 415, 'type', 'That file is not a message we can take (' + mp3.error + ').');
    if (mp3.secs > MAX_SECS) return no(req, 413, 'long', 'That message runs over a minute. Please keep it under one minute.');
    if (mp3.secs < MIN_SECS) return no(req, 422, 'short', "That message is too short to hear.");

    const ip = req.headers.get('CF-Connecting-IP') || '';
    if (!(await turnstile(env, token, ip))) return no(req, 403, 'turnstile', "The robot check didn't pass. Please try sending again.");

    const now = Date.now();
    const who = hex(await crypto.subtle.digest('SHA-256', new TextEncoder().encode('callin:' + (ip || 'unknown')))).slice(0, 24);   // no raw address is kept
    const gate = await env.GATE.get(env.GATE.idFromName('gate')).admit(who, now, u8.length, mp3.secs, dailyCap(env));
    if (gate.verdict === 'ip') return no(req, 429, 'ip', "You've left a few messages already. Please try again in an hour.");
    if (gate.verdict === 'day') return no(req, 429, 'day', 'The line is full for today. Please call again tomorrow.');
    if (gate.verdict === 'full') return no(req, 507, 'full', 'The voicemail box is full right now. Please call again in a few days.');

    const t = gate.ai ? await transcribe(env, u8) : { tx: 'cap', text: '' };
    const page = /^\/[a-z0-9\-/]{0,60}$/.test(req.headers.get('X-Callin-Page') || '') ? req.headers.get('X-Callin-Page') : '';
    const ref = hex(crypto.getRandomValues(new Uint8Array(3)));
    const id = new Date(now).toISOString().replace(/[-:.TZ]/g, '').slice(0, 14) + '-' + ref;
    await env.STORE.put('call:' + id, u8, { metadata: meta({ at: new Date(now).toISOString(), secs: Math.round(mp3.secs * 10) / 10, page, bytes: u8.length, tx: t.tx, text: t.text }) });
    return reply(req, 200, { ok: true, ref, secs: Math.round(mp3.secs * 10) / 10 });
  },
};
