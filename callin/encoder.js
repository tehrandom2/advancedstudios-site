// Call-in: a Web Worker. Takes the raw mono recording, cleans it (dsp.js) and encodes it to MP3 with the vendored
// lamejs 1.2.1 (LGPL-3.0, see vendor/lamejs-1.2.1/). 24 kHz mono at 64 kbps (MPEG-2 Layer III).
/* global CallinDSP, lamejs */
importScripts('dsp.js' + self.location.search, 'vendor/lamejs-1.2.1/lame.min.js');   // same ?v= as this file

self.onmessage = function (e) {
  var d = e.data;
  try {
    var raw = new Float32Array(d.samples);
    var c = CallinDSP.clean(raw, d.rate);
    if (c.silent) { self.postMessage({ ok: true, silent: true, speech: c.speech }); return; }
    self.postMessage({ progress: 0.25 });
    var pcm = CallinDSP.toInt16(c.x), enc = new lamejs.Mp3Encoder(1, c.rate, 64), parts = [], size = 0, FR = 576 * 8;
    for (var i = 0; i < pcm.length; i += FR) {
      var b = enc.encodeBuffer(pcm.subarray(i, i + FR));
      if (b.length) { parts.push(new Uint8Array(b)); size += b.length; }
      if ((i / FR) % 40 === 0) self.postMessage({ progress: 0.25 + 0.75 * i / pcm.length });
    }
    var f = enc.flush();
    if (f.length) { parts.push(new Uint8Array(f)); size += f.length; }
    var mp3 = new Uint8Array(size), o = 0;
    parts.forEach(function (p) { mp3.set(p, o); o += p.length; });
    self.postMessage({ ok: true, mp3: mp3.buffer, secs: pcm.length / c.rate, lufs: c.lufsAfter, lufsBefore: c.lufsBefore,
                       peakDb: c.peakDb, gainDb: c.gainDb, trimmedStart: c.trimmedStart, trimmedEnd: c.trimmedEnd }, [mp3.buffer]);
  } catch (err) {
    self.postMessage({ ok: false, error: String(err && err.message || err) });
  }
};
