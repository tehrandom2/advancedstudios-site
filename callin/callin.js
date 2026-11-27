// Call-in: the "Call in" button and its phone panel. Any element with [data-callin] opens it.
// The flow: the tap asks for the microphone at once (getUserMedia straight from the tap, for iOS Safari); only once
// it is granted does the greeting play, then the beep, then up to 60 s of recording through an AudioWorklet. The
// recording is cleaned and encoded to MP3 in this browser (encoder.js, a Web Worker); Listen back plays those exact
// bytes, and Send posts the same bytes, after Turnstile, to the one Worker route. Nothing runs on page load except
// un-hiding the button: no microphone, no network.
(function () {
  'use strict';
  var BASE = new URL('.', document.currentScript.src);
  var V = new URL(document.currentScript.src).search;            // the same ?v= for the files this one loads
  var ENDPOINT = 'https://media.advancedstudios.net/callin';
  var SITEKEY = '1x00000000000000000000AA';                      // Cloudflare's always-pass test key until our widget exists
  var MAX_SECS = 60;

  var dlg, els = {}, sess = 0, s = {};     // s: the live call (context, stream, nodes, samples, mp3)

  function h(tag, attrs, kids) {
    var e = document.createElement(tag);
    for (var k in attrs || {}) { if (k === 'text') e.textContent = attrs[k]; else e.setAttribute(k, attrs[k]); }
    (kids || []).forEach(function (c) { e.appendChild(c); });
    return e;
  }
  function fmt(t) { t = Math.max(0, Math.floor(t)); return Math.floor(t / 60) + ':' + String(t % 60).padStart(2, '0'); }

  function build() {
    dlg = h('dialog', { class: 'ci', 'aria-labelledby': 'ci-title', 'data-state': 'idle' });
    dlg.innerHTML =
      '<div class="ci-phone">' +
        '<div class="ci-top"><span class="ci-line">Line 1 &middot; Advanced Studios voicemail</span>' +
          '<button type="button" class="ci-x" data-act="hangup" aria-label="Hang up and close">&times;</button></div>' +
        '<div class="ci-screen" role="status" aria-live="polite">' +
          '<p class="ci-kick" id="ci-kick"></p>' +
          '<h2 class="ci-title" id="ci-title"></h2>' +
          '<p class="ci-time" id="ci-time" hidden></p>' +
          '<div class="ci-meter" id="ci-meter" hidden><i></i></div>' +
          '<div class="ci-wave" id="ci-wave" hidden aria-hidden="true"><i></i><i></i><i></i><i></i><i></i></div>' +
          '<p class="ci-sub" id="ci-sub"></p>' +
          '<div class="ci-ts" id="ci-ts" hidden></div>' +
        '</div>' +
        '<div class="ci-keys" id="ci-keys"></div>' +
        '<p class="ci-note">Your message is recorded and kept. To have it removed, call back with its reference.</p>' +
      '</div>';
    document.body.appendChild(dlg);
    ['kick', 'title', 'time', 'meter', 'wave', 'sub', 'ts', 'keys'].forEach(function (k) { els[k] = dlg.querySelector('#ci-' + k); });
    dlg.addEventListener('click', function (e) {
      var b = e.target.closest('[data-act]');
      if (b && !b.disabled) act(b.getAttribute('data-act'));
      else if (e.target === dlg) act('hangup');      // a tap on the backdrop
    });
    dlg.addEventListener('cancel', function (e) { e.preventDefault(); act('hangup'); });
  }

  var KEYS = {
    tryagain: ['Try again', 'go'], hangup: ['Hang up', 'end'], skip: ['Skip to the beep', ''], stop: ['Stop', 'go'],
    listen: ['Listen back', ''], rerecord: ['Re-record', ''], send: ['Send', 'go'], resend: ['Send again', 'go'], close: ['Close', 'go'],
  };
  function view(state, o) {
    dlg.setAttribute('data-state', state);
    els.kick.textContent = o.kick || '';
    els.title.textContent = o.title || '';
    els.sub.textContent = o.sub || '';
    els.time.hidden = !o.time; els.meter.hidden = !o.meter; els.wave.hidden = !o.wave; els.ts.hidden = !o.ts;
    els.keys.textContent = '';
    (o.keys || []).forEach(function (k) {
      var b = h('button', { type: 'button', class: 'ci-k ' + KEYS[k][1], 'data-act': k, text: KEYS[k][0] });
      if (k === 'send') b.disabled = !s.token;
      els.keys.appendChild(b);
    });
    var first = els.keys.querySelector('.go:not([disabled])') || els.keys.querySelector('button:not([disabled])');
    if (first) first.focus();
  }

  // ---- the call -------------------------------------------------------------------------------------------------
  function open() {
    if (!dlg) build();
    if (!dlg.open) dlg.showModal();
    dial();
  }

  // Straight from a tap (Call in, or Try again): ask for the microphone first, before anything else.
  function dial() {
    var my = ++sess;
    teardown();
    s = {};
    var md = navigator.mediaDevices;
    if (!window.isSecureContext || !md || !md.getUserMedia || !window.AudioWorkletNode || !window.Worker) {
      return view('unsupported', { kick: 'No line', title: "This browser can't take the call",
        sub: 'Try an up-to-date Chrome, Safari, Firefox or Edge, on your phone or computer.', keys: ['hangup'] });
    }
    var ask = md.getUserMedia({ audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: false } });
    var AC = window.AudioContext || window.webkitAudioContext;
    s.ctx = new AC();                                              // made in the tap, so it may play on iOS
    if (s.ctx.resume) s.ctx.resume();
    view('asking', { kick: 'Calling', title: 'Allow the microphone', sub: 'Your browser will ask to use the microphone so you can leave a message. Nothing is recorded until the beep.', keys: ['hangup'] });
    var greeting = fetch(BASE + 'greeting.mp3' + V).then(function (r) { return r.arrayBuffer(); })
      .then(function (b) { return new Promise(function (ok, no) { s.ctx.decodeAudioData(b, ok, no); }); });
    greeting.catch(function () {});
    loadTurnstile();
    ask.then(function (stream) {
      if (my !== sess) { stream.getTracks().forEach(function (t) { t.stop(); }); return; }
      s.stream = stream;
      return Promise.all([s.ctx.audioWorklet.addModule(BASE + 'capture.js' + V), greeting.catch(function () { return null; })])
        .then(function (r) { if (my === sess) ring(my, r[1]); });
    }, function (err) {
      if (my !== sess) return;
      denied(err && err.name);
    }).catch(function () {
      if (my === sess) view('error', { kick: 'Line trouble', title: "The call couldn't start", sub: 'Something went wrong setting up the call. Please try again.', keys: ['tryagain', 'hangup'] });
    });
  }

  function denied(name) {
    teardown();
    var sub;
    if (name === 'NotFoundError' || name === 'OverconstrainedError') sub = "We couldn't find a microphone on this device. Plug one in, or call from your phone, then try again.";
    else if (name === 'NotSupportedError' || name === 'SecurityError') sub = "This browser won't let the page use a microphone. Try an up-to-date Chrome, Safari, Firefox or Edge.";
    else if (name === 'NotReadableError' || name === 'AbortError') sub = 'Another app seems to be using the microphone. Close it, then try again.';
    else sub = 'The call needs your microphone. To allow it for advancedstudios.net, tap the icon beside the address (the lock, or aA on iPhone), set Microphone to Allow, then try again.';
    view('denied', { kick: 'No microphone', title: 'We need your microphone to take the call', sub: sub, keys: ['tryagain', 'hangup'] });
  }

  function ring(my, buf) {
    if (s.ctx.resume) s.ctx.resume();
    view('greeting', { kick: 'Connected', title: 'Advanced Studios', sub: 'Listen for the beep, then speak. You have one minute.', wave: true, keys: ['skip', 'hangup'] });
    if (!buf) return beep(my);
    var src = s.ctx.createBufferSource();
    src.buffer = buf; src.connect(s.ctx.destination);
    src.onended = function () { if (my === sess && s.greet === src) { s.greet = null; beep(my); } };
    s.greet = src; src.start();
  }

  function beep(my) {
    var c = s.ctx, t = c.currentTime + 0.05, o = c.createOscillator(), g = c.createGain();
    o.frequency.value = 1000; g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(0.25, t + 0.01); g.gain.setValueAtTime(0.25, t + 0.44); g.gain.linearRampToValueAtTime(0, t + 0.45);
    o.connect(g); g.connect(c.destination); o.start(t); o.stop(t + 0.46);
    view('beep', { kick: 'Beep', title: 'Speak after the tone', sub: '', keys: ['hangup'] });
    o.onended = function () { if (my === sess) record(my); };
  }

  function record(my) {
    var c = s.ctx;
    s.src = c.createMediaStreamSource(s.stream);
    s.node = new AudioWorkletNode(c, 'callin-capture', { numberOfInputs: 1, numberOfOutputs: 0 });
    s.blocks = []; s.n = 0; s.rate = c.sampleRate; s.level = 0;
    s.node.port.onmessage = function (e) {
      if (my !== sess) return;
      if (e.data.block) {
        var b = new Float32Array(e.data.block), room = MAX_SECS * s.rate - s.n;
        if (room <= 0) return;
        if (b.length > room) b = b.subarray(0, room);
        s.blocks.push(b); s.n += b.length;
        var p = 0; for (var i = 0; i < b.length; i++) { var a = Math.abs(b[i]); if (a > p) p = a; }
        s.level = Math.max(p, s.level * 0.85);
        if (s.n >= MAX_SECS * s.rate) stop(my);
      }
      if (e.data.done && s.onDone) s.onDone();
    };
    s.src.connect(s.node);
    s.node.port.postMessage('start');
    view('recording', { kick: 'Recording', title: 'Leave your message', sub: 'Tap Stop when you are done. The call ends by itself at one minute.', time: true, meter: true, keys: ['stop', 'hangup'] });
    tick(my);
  }

  function tick(my) {
    if (my !== sess || dlg.getAttribute('data-state') !== 'recording') return;
    var t = s.n / s.rate;
    els.time.textContent = fmt(t) + ' / ' + fmt(MAX_SECS);
    els.time.setAttribute('aria-label', fmt(t) + ' recorded of one minute');
    els.meter.firstChild.style.transform = 'scaleX(' + Math.min(1, s.level * 1.6).toFixed(3) + ')';
    s.raf = requestAnimationFrame(function () { tick(my); });
  }

  function stop(my) {
    if (s.stopping) return;
    s.stopping = true;
    view('cleaning', { kick: 'One moment', title: 'Cleaning up your message', sub: 'Evening out the volume and trimming the quiet. This stays on your device until you send it.', keys: ['hangup'] });
    s.onDone = function () {
      s.onDone = null;
      releaseMic();
      var all = new Float32Array(s.n), o = 0;
      s.blocks.forEach(function (b) { all.set(b, o); o += b.length; });
      s.blocks = null;
      encode(my, all);
    };
    s.node.port.postMessage('stop');
  }

  function encode(my, samples) {
    var w = new Worker(BASE + 'encoder.js' + V);
    s.worker = w;
    w.onmessage = function (e) {
      if (my !== sess) return;
      var d = e.data;
      if (d.progress != null) { els.sub.textContent = 'Evening out the volume and trimming the quiet: ' + Math.round(d.progress * 100) + '%'; return; }
      w.terminate(); s.worker = null;
      if (!d.ok) return view('error', { kick: 'Line trouble', title: "We couldn't save that", sub: 'Something went wrong preparing your message. Please record it again.', keys: ['rerecord', 'hangup'] });
      if (d.silent) return view('silent', { kick: 'Nothing heard', title: "We didn't hear anything", sub: 'Check that your microphone is not muted, then record again.', keys: ['rerecord', 'hangup'] });
      s.mp3 = new Blob([d.mp3], { type: 'audio/mpeg' });
      s.secs = d.secs;
      dlg.setAttribute('data-secs', d.secs.toFixed(2));
      dlg.setAttribute('data-lufs', d.lufs.toFixed(1));
      dlg.setAttribute('data-peak', d.peakDb.toFixed(1));
      dlg.setAttribute('data-gain', d.gainDb.toFixed(1) + ' dB from ' + d.lufsBefore.toFixed(1) + ' LUFS; trimmed ' + d.trimmedStart.toFixed(2) + ' s + ' + d.trimmedEnd.toFixed(2) + ' s');
      dlg.setAttribute('data-bytes', String(d.mp3.byteLength));
      if (crypto.subtle) crypto.subtle.digest('SHA-256', d.mp3).then(function (x) {
        dlg.setAttribute('data-sha256', Array.prototype.map.call(new Uint8Array(x), function (b) { return b.toString(16).padStart(2, '0'); }).join(''));
      });
      s.audio = new Audio(URL.createObjectURL(s.mp3));               // Listen back plays the very bytes Send posts
      dlg.setAttribute('data-listen', s.audio.src);                  // (so a check can hash what Listen back plays)
      s.audio.onended = s.audio.onpause = function () { var b = els.keys.querySelector('[data-act="listen"]'); if (b) b.textContent = 'Listen back'; };
      review();
    };
    w.postMessage({ samples: samples.buffer, rate: s.rate }, [samples.buffer]);
  }

  function review() {
    view('review', { kick: 'Your message', title: 'Ready to send · ' + fmt(Math.round(s.secs)), sub: 'Listen back if you like, then Send. A quick robot check runs first.', ts: true, keys: ['listen', 'rerecord', 'send'] });
    renderTurnstile();
  }

  function send() {
    var my = sess;
    if (s.audio) s.audio.pause();
    view('sending', { kick: 'Sending', title: 'Leaving your message', sub: '', keys: [] });
    fetch(ENDPOINT, { method: 'POST', body: s.mp3, headers: { 'Content-Type': 'audio/mpeg', 'X-Turnstile': s.token, 'X-Callin-Page': location.pathname } })
      .then(function (r) { return r.json().catch(function () { return { ok: false }; }); })
      .then(function (j) {
        if (my !== sess) return;
        s.token = null;
        if (j.ok) {
          dlg.setAttribute('data-ref', j.ref);
          return view('sent', { kick: 'Message left', title: 'Thanks for calling', sub: 'Your message is in. Your reference is ' + j.ref.toUpperCase() + '.', keys: ['close'] });
        }
        failed(j.error || 'The line dropped. Please try sending again.');
      }, function () { if (my === sess) { s.token = null; failed('The line dropped. Check your connection and try sending again.'); } });
  }

  function failed(words) {
    view('error', { kick: 'Not sent', title: "Your message didn't go through", sub: words, ts: true, keys: ['resend', 'rerecord', 'hangup'] });
    var b = els.keys.querySelector('[data-act="resend"]');
    if (b) b.disabled = true;
    renderTurnstile();
  }

  // ---- Turnstile ---------------------------------------------------------------------------------------------------
  var tsReady = null;
  function loadTurnstile() {
    if (tsReady) return tsReady;
    tsReady = new Promise(function (ok, no) {
      window.__callinTs = ok;
      var sc = document.createElement('script');
      sc.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit&onload=__callinTs';
      sc.async = true; sc.onerror = no;
      document.head.appendChild(sc);
    });
    tsReady.catch(function () { tsReady = null; });
    return tsReady;
  }
  function renderTurnstile() {
    var my = sess;
    els.ts.textContent = '';
    var box = h('div', {}); els.ts.appendChild(box);
    loadTurnstile().then(function () {
      if (my !== sess) return;
      window.turnstile.render(box, {
        sitekey: SITEKEY, action: 'callin', theme: 'dark', size: 'flexible',
        callback: function (t) { s.token = t; ['send', 'resend'].forEach(function (k) { var b = els.keys.querySelector('[data-act="' + k + '"]'); if (b) b.disabled = false; }); },
        'expired-callback': function () { s.token = null; ['send', 'resend'].forEach(function (k) { var b = els.keys.querySelector('[data-act="' + k + '"]'); if (b) b.disabled = true; }); },
      });
    }, function () {
      if (my === sess) els.ts.textContent = "The robot check didn't load. Check your connection, then record again.";
    });
  }

  // ---- buttons -----------------------------------------------------------------------------------------------------
  function act(a) {
    if (a === 'tryagain') return dial();
    if (a === 'hangup' || a === 'close') { sess++; teardown(); s = {}; return dlg.close(); }
    if (a === 'skip' && s.greet) { var g = s.greet; s.greet = null; g.onended = null; g.stop(); return beep(sess); }
    if (a === 'stop') return stop(sess);
    if (a === 'listen' && s.audio) {
      var b = els.keys.querySelector('[data-act="listen"]');
      if (s.audio.paused) { s.audio.currentTime = 0; s.audio.play(); b.textContent = 'Pause'; } else { s.audio.pause(); }
      return;
    }
    if (a === 'rerecord') return redo();
    if ((a === 'send' || a === 'resend') && s.token && s.mp3) return send();
  }

  // Record again: the greeting was heard already, so straight to the beep. It is a tap, so the mic may be asked again.
  function redo() {
    var my = ++sess, ctx = s.ctx;
    if (s.audio) { s.audio.pause(); URL.revokeObjectURL(s.audio.src); }
    s = { ctx: ctx };
    if (ctx && ctx.resume) ctx.resume();
    view('asking', { kick: 'Calling', title: 'One moment', sub: '', keys: ['hangup'] });
    navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: false } })
      .then(function (stream) {
        if (my !== sess) { stream.getTracks().forEach(function (t) { t.stop(); }); return; }
        s.stream = stream;
        if (!s.ctx || s.ctx.state === 'closed') return dial();
        beep(my);
      }, function (err) { if (my === sess) denied(err && err.name); });
  }

  function releaseMic() {
    if (s.node) { try { s.node.port.onmessage = null; s.node.disconnect(); } catch (e) {} s.node = null; }
    if (s.src) { try { s.src.disconnect(); } catch (e) {} s.src = null; }
    if (s.stream) { s.stream.getTracks().forEach(function (t) { t.stop(); }); s.stream = null; }
  }
  function teardown() {
    if (s.raf) cancelAnimationFrame(s.raf);
    if (s.greet) { try { s.greet.onended = null; s.greet.stop(); } catch (e) {} s.greet = null; }
    releaseMic();
    if (s.worker) { s.worker.terminate(); s.worker = null; }
    if (s.audio) { s.audio.pause(); URL.revokeObjectURL(s.audio.src); s.audio = null; }
    if (s.ctx && s.ctx.close) { try { s.ctx.close(); } catch (e) {} }
    s.ctx = null;
    if (dlg) ['data-secs', 'data-lufs', 'data-peak', 'data-gain', 'data-bytes', 'data-sha256', 'data-ref', 'data-listen'].forEach(function (k) { dlg.removeAttribute(k); });
  }

  // On load: only show the buttons. No microphone, no fetch.
  document.querySelectorAll('.callin[hidden]').forEach(function (e) { e.hidden = false; });
  document.addEventListener('click', function (e) {
    var b = e.target.closest('[data-callin]');
    if (b) { e.preventDefault(); open(); }
  });
})();
