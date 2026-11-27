// Worker tests: node --import ./test/register.mjs --test test/  (from callin/worker). Needs network for the Turnstile
// paths: they call Cloudflare's real siteverify with its documented test secrets (always passes / always fails).
// MP3 fixtures are made here with the same vendored lamejs the site uses.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import worker, { Gate, parseMp3, meta, MAX_BYTES, PER_DAY, PER_IP_PER_HOUR, STORE_CAP, AI_MINUTES_PER_DAY } from '../worker.js';

const PASS = '1x0000000000000000000000000000000AA', FAIL = '2x0000000000000000000000000000000AA';
const TOKEN = 'XXXX.DUMMY.TOKEN.XXXX';

const lctx = { self: {} }; vm.createContext(lctx);
vm.runInContext(fs.readFileSync(new URL('../../vendor/lamejs-1.2.1/lame.min.js', import.meta.url), 'utf8'), lctx);
const lame = lctx.lamejs || lctx.self.lamejs;
function mp3(secs, { rate = 24000, kbps = 64, channels = 1 } = {}) {
  const n = Math.round(secs * rate), enc = new lame.Mp3Encoder(channels, rate, kbps), l = new Int16Array(n), parts = [];
  for (let i = 0; i < n; i++) l[i] = Math.round(6000 * Math.sin(2 * Math.PI * 330 * i / rate));
  for (let i = 0; i < n; i += 4608) { const b = channels === 1 ? enc.encodeBuffer(l.subarray(i, i + 4608)) : enc.encodeBuffer(l.subarray(i, i + 4608), l.subarray(i, i + 4608)); if (b.length) parts.push(Buffer.from(b)); }
  parts.push(Buffer.from(enc.flush()));
  return new Uint8Array(Buffer.concat(parts));
}
const GOOD = mp3(5);

// In-memory stand-ins for KV, the Durable Object namespace and Workers AI.
function kv() {
  const m = new Map();
  return {
    m,
    async put(k, v, o) { m.set(k, { v: new Uint8Array(v), metadata: o && o.metadata }); },
    async list({ prefix }) { return { keys: [...m].filter(([k]) => k.startsWith(prefix)).map(([name, e]) => ({ name, metadata: e.metadata })), list_complete: true }; },
  };
}
function storage() {
  const m = new Map();
  return {
    m,
    async get(k) { return m.get(k); },
    async put(k, v) { if (typeof k === 'object') for (const [a, b] of Object.entries(k)) m.set(a, b); else m.set(k, v); },
    async deleteAll() { m.clear(); },
    async list() { return new Map(m); },
  };
}
function env(over = {}) {
  const STORE = kv(), st = storage();
  const e = { STORE, TURNSTILE_SECRET: PASS, aiCalls: 0,
    AI: { run: async (model, input) => { e.aiCalls++; e.aiInput = input; return { text: e.aiText ?? 'hello this is a test call' }; } }, ...over };
  const gate = new Gate({ storage: st }, e);
  e.GATE = { idFromName: () => 'gate', get: () => gate };
  e.st = st;
  return e;
}
function post(body, { type = 'audio/mpeg', token = TOKEN, ip = '203.0.113.7', page = '/music-videos/', len, origin = 'https://advancedstudios.net' } = {}) {
  const h = { 'Content-Type': type, 'CF-Connecting-IP': ip, 'X-Callin-Page': page, Origin: origin };
  if (token) h['X-Turnstile'] = token;
  if (len !== undefined) h['Content-Length'] = String(len);
  return new Request('https://media.advancedstudios.net/callin', { method: 'POST', headers: h, body, duplex: 'half' });
}
async function call(e, req) { const r = await worker.fetch(req, e); return { status: r.status, body: await r.json().catch(() => null), headers: r.headers }; }

test('accepted: a clean mono MP3 is stored once, bytes unchanged, index in its metadata', async () => {
  const e = env();
  const r = await call(e, post(GOOD));
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.ok, true);
  assert.match(r.body.ref, /^[0-9a-f]{6}$/);
  assert.equal(e.STORE.m.size, 1);
  const [key, val] = [...e.STORE.m][0];
  assert.match(key, new RegExp('^call:\\d{14}-' + r.body.ref + '$'));
  assert.deepEqual(val.v, GOOD);
  assert.equal(val.metadata.page, '/music-videos/');
  assert.equal(val.metadata.bytes, GOOD.length);
  assert.ok(Math.abs(val.metadata.secs - 5) < 0.2, String(val.metadata.secs));
  assert.equal(val.metadata.tx, 'ok');
  assert.equal(val.metadata.t, 'hello this is a test call');
  assert.equal(r.headers.get('Access-Control-Allow-Origin'), 'https://advancedstudios.net');
  assert.equal(typeof e.aiInput.audio, 'string');
  assert.deepEqual(new Uint8Array(Buffer.from(e.aiInput.audio, 'base64')), GOOD);
});

test('refused: no Turnstile token', async () => {
  const e = env();
  const r = await call(e, post(GOOD, { token: '' }));
  assert.equal(r.status, 403); assert.equal(r.body.code, 'turnstile'); assert.equal(e.STORE.m.size, 0);
});

test('refused: Turnstile says no (always-fail test secret)', async () => {
  const e = env({ TURNSTILE_SECRET: FAIL });
  const r = await call(e, post(GOOD));
  assert.equal(r.status, 403); assert.equal(r.body.code, 'turnstile'); assert.equal(e.STORE.m.size, 0);
});

test('refused: bad type (header, and bodies that are not a clean mono MP3)', async () => {
  const e = env();
  for (const [why, req] of [
    ['wav content type', post(GOOD, { type: 'audio/wav' })],
    ['html content type', post(GOOD, { type: 'text/html' })],
    ['multipart', post(GOOD, { type: 'multipart/form-data; boundary=x' })],
    ['script body', post(new TextEncoder().encode('<script>alert(1)</script>'))],
    ['wav body', post(new Uint8Array([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x41, 0x56, 0x45]))],
    ['ID3 tag before the sound', post(new Uint8Array([...new TextEncoder().encode('ID3'), 4, 0, 0, 0, 0, 0, 0, ...GOOD]))],
    ['data after the sound', post(new Uint8Array([...GOOD, ...new TextEncoder().encode('<?php system($_GET[1]); ?>')]))],
    ['cut off mid-frame', post(GOOD.slice(0, GOOD.length - 7))],
    ['stereo', post(mp3(3, { channels: 2 }))],
    ['empty', post(new Uint8Array(0))],
  ]) {
    const r = await call(e, req);
    assert.equal(r.status, 415, why + ': ' + JSON.stringify(r.body)); assert.equal(r.body.code, 'type', why);
  }
  assert.equal(e.STORE.m.size, 0);
});

test('refused: too big (by its Content-Length, and by what actually arrives)', async () => {
  const e = env();
  const big = new Uint8Array(MAX_BYTES + 1);
  let r = await call(e, post(big, { len: big.length }));
  assert.equal(r.status, 413); assert.equal(r.body.code, 'big');
  const stream = new ReadableStream({ start(c) { for (let i = 0; i < 12; i++) c.enqueue(new Uint8Array(64 * 1024)); c.close(); } });
  r = await call(e, post(stream));
  assert.equal(r.status, 413); assert.equal(r.body.code, 'big');
  assert.equal(e.STORE.m.size, 0);
});

test('refused: too long (65 s) and too short (0.2 s)', async () => {
  const e = env();
  let r = await call(e, post(mp3(65, { kbps: 32 })));
  assert.equal(r.status, 413, JSON.stringify(r.body)); assert.equal(r.body.code, 'long');
  r = await call(e, post(mp3(0.2)));
  assert.equal(r.status, 422); assert.equal(r.body.code, 'short');
  assert.equal(e.STORE.m.size, 0);
});

test('refused: rate-limited per address; another address still gets through', async () => {
  const e = env();
  for (let i = 0; i < PER_IP_PER_HOUR; i++) assert.equal((await call(e, post(GOOD))).status, 200);
  const r = await call(e, post(GOOD));
  assert.equal(r.status, 429); assert.equal(r.body.code, 'ip');
  assert.equal((await call(e, post(GOOD, { ip: '198.51.100.9' }))).status, 200);
  assert.equal(e.STORE.m.size, PER_IP_PER_HOUR + 1);
});

test('refused: over the daily cap', async () => {
  const e = env();
  await call(e, post(GOOD));                          // sets today's day on the gate
  await e.st.put('total', PER_DAY);
  const r = await call(e, post(GOOD, { ip: '198.51.100.10' }));
  assert.equal(r.status, 429); assert.equal(r.body.code, 'day'); assert.match(r.body.error, /tomorrow/);
});

test('DAILY_CAP lowers the daily cap and can never raise it', async () => {
  const e = env({ DAILY_CAP: '2' });
  assert.equal((await call(e, post(GOOD, { ip: '198.51.100.21' }))).status, 200);
  assert.equal((await call(e, post(GOOD, { ip: '198.51.100.22' }))).status, 200);
  const r = await call(e, post(GOOD, { ip: '198.51.100.23' }));
  assert.equal(r.status, 429); assert.equal(r.body.code, 'day');
  const e2 = env({ DAILY_CAP: '5000' });
  await call(e2, post(GOOD)); await e2.st.put('total', PER_DAY);
  assert.equal((await call(e2, post(GOOD, { ip: '198.51.100.24' }))).body.code, 'day');
});

test('refused: the store is at its 800 MB cap', async () => {
  const e = env();
  await call(e, post(GOOD));
  await e.st.put('stored', STORE_CAP - 100);
  const r = await call(e, post(GOOD, { ip: '198.51.100.11' }));
  assert.equal(r.status, 507); assert.equal(r.body.code, 'full');
});

test('past the Workers AI cap the call is kept and the transcript skipped', async () => {
  const e = env();
  await call(e, post(GOOD));
  await e.st.put('ai', AI_MINUTES_PER_DAY);
  const before = e.aiCalls;
  const r = await call(e, post(GOOD, { ip: '198.51.100.12' }));
  assert.equal(r.status, 200);
  assert.equal(e.aiCalls, before);
  const rec = [...e.STORE.m.values()].find((v) => v.metadata.tx === 'cap');
  assert.ok(rec, 'a call stored with tx=cap');
});

test('Workers AI failing still keeps the call', async () => {
  const e = env();
  e.AI.run = async () => { throw new Error('3036: account limit'); };
  const r = await call(e, post(GOOD));
  assert.equal(r.status, 200);
  assert.equal([...e.STORE.m.values()][0].metadata.tx, 'failed');
});

test('a new day recounts the store from KV and resets the counters', async () => {
  const e = env();
  await e.STORE.put('call:old', new Uint8Array(10), { metadata: { bytes: 123456 } });
  await e.st.put({ day: '2000-01-01', total: PER_DAY, ai: 999, stored: 999999999 });
  const r = await call(e, post(GOOD));
  assert.equal(r.status, 200);
  assert.equal(await e.st.get('total'), 1);
  assert.equal(await e.st.get('stored'), 123456 + GOOD.length);
});

test('the address is never stored plain', async () => {
  const e = env();
  await call(e, post(GOOD, { ip: '203.0.113.77' }));
  const all = JSON.stringify([...e.st.m]) + JSON.stringify([...e.STORE.m].map(([k, v]) => [k, v.metadata]));
  assert.ok(!all.includes('203.0.113.77'));
  assert.ok([...e.st.m.keys()].some((k) => /^ip:[0-9a-f]{24}$/.test(k)));
});

test('the page field takes a site path only', async () => {
  const e = env();
  await call(e, post(GOOD, { page: 'javascript:alert(1)' }));
  assert.equal([...e.STORE.m.values()][0].metadata.page, '');
});

test('long transcripts are cut to fit the 1024-byte metadata', () => {
  const m = meta({ at: '2026-11-27T00:00:00.000Z', secs: 59.9, page: '/music-videos/', bytes: 480000, tx: 'ok', text: 'word '.repeat(400) });
  assert.ok(JSON.stringify(m).length <= 1024); assert.equal(m.cut, 1);
});

test('other paths, methods and preflight', async () => {
  const e = env();
  assert.equal((await worker.fetch(new Request('https://media.advancedstudios.net/callin/list'), e)).status, 404);
  assert.equal((await call(e, new Request('https://media.advancedstudios.net/callin'))).status, 405);
  const o = await worker.fetch(new Request('https://media.advancedstudios.net/callin', { method: 'OPTIONS', headers: { Origin: 'https://evil.example' } }), e);
  assert.equal(o.status, 204); assert.equal(o.headers.get('Access-Control-Allow-Origin'), 'https://advancedstudios.net');
});

test('parseMp3 reads lamejs output at 24 and 48 kHz', () => {
  const a = parseMp3(mp3(10)), b = parseMp3(mp3(10, { rate: 48000 }));
  assert.equal(a.rate, 24000); assert.ok(Math.abs(a.secs - 10) < 0.1, String(a.secs));
  assert.equal(b.rate, 48000); assert.ok(Math.abs(b.secs - 10) < 0.1, String(b.secs));
});
