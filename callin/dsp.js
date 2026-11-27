// Call-in: the clean-up done in the caller's browser before anything is sent.
// Mono float samples in, mono float samples out: resample to 24 kHz, high-pass at 80 Hz, trim the silence at both
// ends, bring the loudness to about -16 LUFS (ITU-R BS.1770 with gating) and keep the peaks under -1 dBFS.
// Plain functions on Float32Arrays, no DOM: the encoder Web Worker loads this with importScripts, and the tests load
// it in Node.
/* exported CallinDSP */
var CallinDSP = (function () {
  'use strict';
  var OUT_RATE = 24000;
  var TARGET_LUFS = -16;
  var CEILING_DB = -2.5;        // sample peak after the limiter; the MP3 encoder adds a little, the file stays under -1

  // RBJ biquad, direct form I, in place on a copy.
  function biquad(x, c) {
    var y = new Float32Array(x.length), x1 = 0, x2 = 0, y1 = 0, y2 = 0;
    for (var i = 0; i < x.length; i++) {
      var v = c.b0 * x[i] + c.b1 * x1 + c.b2 * x2 - c.a1 * y1 - c.a2 * y2;
      x2 = x1; x1 = x[i]; y2 = y1; y1 = v; y[i] = v;
    }
    return y;
  }
  function norm(b0, b1, b2, a0, a1, a2) { return { b0: b0 / a0, b1: b1 / a0, b2: b2 / a0, a1: a1 / a0, a2: a2 / a0 }; }
  function lowpassC(fs, f, q) {
    var w = 2 * Math.PI * f / fs, cw = Math.cos(w), al = Math.sin(w) / (2 * q);
    return norm((1 - cw) / 2, 1 - cw, (1 - cw) / 2, 1 + al, -2 * cw, 1 - al);
  }
  function highpassC(fs, f, q) {
    var w = 2 * Math.PI * f / fs, cw = Math.cos(w), al = Math.sin(w) / (2 * q);
    return norm((1 + cw) / 2, -(1 + cw), (1 + cw) / 2, 1 + al, -2 * cw, 1 - al);
  }
  // BS.1770 K-weighting at any sample rate (the pre-filter shelf and the RLB high-pass, as in pyloudnorm).
  function kShelfC(fs) {
    var G = 3.999843853973347, f0 = 1681.974450955533, Q = 0.7071752369554196;
    var K = Math.tan(Math.PI * f0 / fs), Vh = Math.pow(10, G / 20), Vb = Math.pow(Vh, 0.4996667741545416);
    var a0 = 1 + K / Q + K * K;
    return norm(Vh + Vb * K / Q + K * K, 2 * (K * K - Vh), Vh - Vb * K / Q + K * K, a0, 2 * (K * K - 1), 1 - K / Q + K * K);
  }
  function kHighC(fs) {
    var f0 = 38.13547087602444, Q = 0.5003270373238773, K = Math.tan(Math.PI * f0 / fs);
    var a0 = 1 + K / Q + K * K;
    return norm(1, -2, 1, a0, 2 * (K * K - 1), 1 - K / Q + K * K);
  }

  // Anti-aliased resample: two low-pass passes below the new Nyquist, then linear interpolation.
  function resample(x, from, to) {
    if (from === to) return Float32Array.from(x);
    var y = x;
    if (to < from) { var c = lowpassC(from, to * 0.45, 0.7071); y = biquad(biquad(y, c), c); }
    var n = Math.floor(y.length * to / from), out = new Float32Array(n), r = from / to;
    for (var i = 0; i < n; i++) {
      var p = i * r, k = Math.floor(p), f = p - k, a = y[k] || 0, b = k + 1 < y.length ? y[k + 1] : a;
      out[i] = a + (b - a) * f;
    }
    return out;
  }

  function highpass(x, fs, f) { var c = highpassC(fs, f || 80, 0.7071); return biquad(biquad(x, c), c); }   // 24 dB/oct

  // Integrated loudness, LUFS (mono: one channel, weight 1). -Infinity when nothing passes the gates.
  function lufs(x, fs) {
    var k = biquad(biquad(x, kShelfC(fs)), kHighC(fs));
    var block = Math.round(0.4 * fs), step = Math.round(0.1 * fs), z = [];
    for (var s = 0; s + block <= k.length; s += step) {
      var sum = 0;
      for (var i = s; i < s + block; i++) sum += k[i] * k[i];
      z.push(sum / block);
    }
    var L = function (m) { return -0.691 + 10 * Math.log10(m); };
    var abs = z.filter(function (m) { return L(m) > -70; });
    if (!abs.length) return -Infinity;
    var mean = abs.reduce(function (a, b) { return a + b; }, 0) / abs.length;
    var rel = abs.filter(function (m) { return L(m) > L(mean) - 10; });
    if (!rel.length) return -Infinity;
    return L(rel.reduce(function (a, b) { return a + b; }, 0) / rel.length);
  }

  function peakDb(x) {
    var p = 0;
    for (var i = 0; i < x.length; i++) { var a = Math.abs(x[i]); if (a > p) p = a; }
    return p > 0 ? 20 * Math.log10(p) : -Infinity;
  }

  // Trim the quiet at both ends. The threshold follows the room: 12 dB over the quietest tenth of 20 ms windows,
  // kept between -55 and -35 dBFS. Keeps 0.2 s before the first word and 0.35 s after the last.
  function trim(x, fs) {
    var win = Math.round(0.02 * fs), db = [];
    for (var s = 0; s + win <= x.length; s += win) {
      var sum = 0;
      for (var i = s; i < s + win; i++) sum += x[i] * x[i];
      db.push(10 * Math.log10(sum / win + 1e-12));
    }
    if (!db.length) return { x: new Float32Array(0), speech: 0, start: 0, end: 0 };
    // The room's floor ignores digital silence (some devices hand over exact zeros); the threshold also follows the
    // voice, 30 dB under its loud windows, so noise a mic's own processing pumps up after the words is still cut.
    var live = db.filter(function (v) { return v > -100; }).sort(function (a, b) { return a - b; });
    if (!live.length) return { x: new Float32Array(0), speech: 0, start: 0, end: 0 };
    var floor = live[Math.floor(live.length * 0.1)], p95 = live[Math.min(live.length - 1, Math.floor(live.length * 0.95))];
    var thr = Math.min(-30, Math.max(-55, floor + 12, p95 - 30));
    // speech is a run of at least 4 windows (80 ms) over the threshold; a lone click is not
    var first = -1, last = -1, loud = 0, run = 0;
    for (var w = 0; w < db.length; w++) {
      run = db[w] > thr ? run + 1 : 0;
      if (run >= 4) { if (first < 0) first = w - 3; last = w; loud += run === 4 ? 4 : 1; }
    }
    if (first < 0) return { x: new Float32Array(0), speech: 0, start: 0, end: 0 };
    var a = Math.max(0, first * win - Math.round(0.2 * fs));
    var b = Math.min(x.length, (last + 1) * win + Math.round(0.35 * fs));
    var y = x.slice(a, b);
    var fade = Math.min(Math.round(0.01 * fs), y.length >> 1);     // 10 ms fades so the cut makes no click
    for (var j = 0; j < fade; j++) { var g = j / fade; y[j] *= g; y[y.length - 1 - j] *= g; }
    return { x: y, speech: loud * win / fs, start: a / fs, end: b / fs };
  }

  // Look-ahead peak limiter. The gain is the running minimum of what each sample needs over +-L, released towards 1,
  // then averaged over L: an average of values that are each <= the need at its centre never exceeds that need.
  function limit(x, fs, ceilingDb) {
    var ceil = Math.pow(10, (ceilingDb == null ? CEILING_DB : ceilingDb) / 20), n = x.length;
    var L = Math.max(1, Math.round(0.005 * fs)), need = new Float32Array(n), m = new Float32Array(n);
    for (var i = 0; i < n; i++) { var a = Math.abs(x[i]); need[i] = a > ceil ? ceil / a : 1; }
    // sliding minimum over [i-L, i+L] with a monotonic deque
    var dq = new Int32Array(n), h = 0, t = 0, r = 0;
    for (i = 0; i < n; i++) {
      while (r < n && r <= i + L) { while (t > h && need[dq[t - 1]] >= need[r]) t--; dq[t++] = r; r++; }
      while (dq[h] < i - L) h++;
      m[i] = need[dq[h]];
    }
    var rel = 1 - Math.exp(-1 / (0.08 * fs)), g = 1;
    for (i = 0; i < n; i++) { g = Math.min(m[i], g + (1 - g) * rel); m[i] = g; }
    var y = new Float32Array(n), half = L >> 1, acc = 0, cnt = 0;
    for (i = -half; i < n; i++) {                       // centred moving average of length L
      var add = i + half, drop = i - half - 1;
      if (add < n) { acc += m[add]; cnt++; }
      if (drop >= 0) { acc -= m[drop]; cnt--; }
      if (i >= 0) y[i] = x[i] * (acc / cnt);
    }
    return y;
  }

  function gain(x, db) {
    var g = Math.pow(10, db / 20), y = new Float32Array(x.length);
    for (var i = 0; i < x.length; i++) y[i] = x[i] * g;
    return y;
  }

  // Loudness to the target, peaks under the ceiling. Two rounds: the limiter takes a little loudness off.
  function loudness(x, fs) {
    var before = lufs(x, fs);
    if (!isFinite(before)) return { x: x, before: before, after: before, gainDb: 0 };
    var total = 0, y = x;
    for (var round = 0; round < 3; round++) {
      var now = lufs(y, fs), want = Math.max(-20, Math.min(30 - total, TARGET_LUFS - now));   // never more than +30 dB in all
      if (round > 0 && Math.abs(want) < 0.3) break;
      total += want;
      y = limit(gain(x, total), fs);
    }
    return { x: y, before: before, after: lufs(y, fs), gainDb: total };
  }

  function toInt16(x) {
    var out = new Int16Array(x.length);
    for (var i = 0; i < x.length; i++) { var v = Math.max(-1, Math.min(1, x[i])); out[i] = v < 0 ? v * 32768 : v * 32767; }
    return out;
  }

  // The whole chain. Returns the cleaned samples at OUT_RATE and the numbers, for the panel and the tests.
  function clean(raw, fs) {
    var x = resample(raw, fs, OUT_RATE);
    x = highpass(x, OUT_RATE, 80);
    var t = trim(x, OUT_RATE);
    if (t.speech < 0.3) return { x: new Float32Array(0), speech: t.speech, silent: true };
    var l = loudness(t.x, OUT_RATE);
    return { x: l.x, rate: OUT_RATE, speech: t.speech, trimmedStart: t.start, trimmedEnd: x.length / OUT_RATE - t.end,
             lufsBefore: l.before, lufsAfter: l.after, gainDb: l.gainDb, peakDb: peakDb(l.x), silent: false };
  }

  return { OUT_RATE: OUT_RATE, TARGET_LUFS: TARGET_LUFS, resample: resample, highpass: highpass, lufs: lufs,
           peakDb: peakDb, trim: trim, limit: limit, loudness: loudness, toInt16: toInt16, clean: clean };
})();
if (typeof module !== 'undefined') module.exports = CallinDSP;
