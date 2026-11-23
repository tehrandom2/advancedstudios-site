/* Music Video Adventures: the set.
   Everything on the dial comes from channels.json on the media host, which tools/mv-publish writes from the
   one data file. Nothing here names a channel or a video. Channel numbers are the data order; CH 00 is the
   test card. Up and down change channel (the big flip), left and right change video inside a channel. */
(() => {
  'use strict';
  const $ = (id) => document.getElementById(id);
  const tv = $('tv'), vid = $('vid'), card = $('card'), roll = $('roll'), snow = $('snow');
  const big = $('big'), spin = $('spin'), seek = $('seek'), vol = $('vol');
  const reduce = matchMedia('(prefers-reduced-motion: reduce)');
  const qs = new URLSearchParams(location.search);

  // Where the media lives. The LAN preview (tools/mv-publish preview) serves its own copy at /_mvmedia;
  // every public host uses the media domain. ?media=live on the preview points it at the media domain too.
  const lan = /^(localhost$|127\.|192\.168\.|10\.)/.test(location.hostname);
  const MEDIA = (lan && qs.get('media') !== 'live') ? '/_mvmedia' : 'https://media.advancedstudios.net';
  const HLS_JS = 'vendor/hls.light.min.js'; // hls.js 1.6.13, vendored

  let chans = [];         // {num, id, name, intro, notice, hidden, pos, items:[{kind:'video'|'card', id, title, artist, concept, ready, duration}]}
  let ci = -1;            // channel on screen
  let formUrl = '';
  const item = () => (ci >= 0 ? chans[ci].items[chans[ci].pos] : null);
  let hls = null;
  let touched = false;    // the viewer has interacted: sound and the blip are allowed
  let actx = null;
  let flipTimer = 0, osdTimer = 0, ctlTimer = 0, digitTimer = 0, digits = '';
  let snowRaf = 0, snowUntil = 0;
  let wantPlay = false;

  const pad = (n) => String(n).padStart(2, '0');
  const clock = (s) => { s = Math.max(0, Math.floor(s || 0)); return Math.floor(s / 60) + ':' + pad(s % 60); };
  const store = { get(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }, set(k, v) { try { localStorage.setItem(k, v); } catch (e) {} } };

  // ---------- data ----------
  async function boot() {
    let data = null;
    const view = lan && qs.get('view') === 'public' ? '?view=public' : '';
    try { data = await (await fetch(MEDIA + '/channels.json' + view, { cache: 'no-cache' })).json(); } catch (e) {}
    data = data || { channels: [] };
    formUrl = data.removalForm || '';
    // A hidden channel is only ever in the LAN preview's listing. No public host is sent one.
    chans = (data.channels || []).map((c, i) => {
      const items = (c.videos || []).map((v) => ({ kind: 'video', id: v.id, title: v.title, artist: v.artist, concept: v.concept, warning: v.warning || '', ready: v.ready !== false, duration: v.duration || 0 }));
      if (c.next_up) items.push({ kind: 'card', id: c.id + '-next', title: c.next_up.title || 'Next up', artist: c.name, concept: c.next_up.line || '', label: 'next up' });
      if (!items.length) items.push({ kind: 'card', id: c.id + '-soon', title: 'Stand by', artist: c.name, concept: 'Nothing on this channel yet.', label: 'stand by' });
      return { num: i + 1, id: c.id, name: c.name, intro: c.intro || '', notice: c.notice || '', hidden: !!c.hidden, pos: 0, items };
    });
    const off = data.offair || {};
    chans.push({ num: 0, id: 'off-air', name: 'Off air', intro: '', notice: '', hidden: false, pos: 0, offair: true,
      items: [{ kind: 'card', id: 'test-card', title: off.title || 'Test card', artist: 'Off air', concept: off.line || (data.channels && data.channels.length ? 'Nothing on this one. Flip back.' : 'The set is warming up. Try again in a minute.'), label: 'off air' }] });
    buildGuide();
    const want = qs.get('v') || decodeURIComponent(location.hash.slice(1));
    const at = find(want) || [0, 0];
    go(at[0], at[1], { first: true });
  }
  function find(id) {
    for (let a = 0; a < chans.length; a++) {
      if (chans[a].id === id) return [a, chans[a].pos];
      const b = chans[a].items.findIndex((x) => x.id === id);
      if (b >= 0) return [a, b];
    }
    return null;
  }

  function buildGuide() {
    const g = $('guide');
    g.textContent = '';
    chans.forEach((ch, a) => {
      const li = el('li', 'chan');
      li.dataset.ch = a;
      const hb = el('button', 'chh'); hb.type = 'button';
      hb.append(el('span', 'n vt', pad(ch.num)), el('span', 'nm vt', ch.name));
      if (ch.hidden) hb.append(el('span', 'badge vt', 'Hidden'));
      const nv = ch.items.filter((x) => x.kind === 'video').length;
      hb.append(el('span', 'ct vt', ch.offair ? '' : nv + (nv === 1 ? ' video' : ' videos')));
      hb.addEventListener('click', () => { touched = true; go(a, ch.pos, { user: true }); tv.focus({ preventScroll: true }); scrollToTv(); });
      li.append(hb);
      const ol = el('ol', 'items');
      ch.items.forEach((c, b) => {
        if (ch.offair) return;
        const il = document.createElement('li'), bt = el('button'); bt.type = 'button';
        const p = el('span', 'p' + (c.kind === 'card' || !c.ready ? ' bars' : ''));
        if (c.kind === 'video' && c.ready) {
          p.style.backgroundImage = `url("${MEDIA}/${c.id}/poster.jpg")`;
          if (c.duration) p.append(el('span', 'd vt', clock(c.duration)));
        }
        if (c.kind === 'video' && !c.ready) p.append(el('span', 'd vt', 'Soon'));
        const tx = el('span', 'tx');
        tx.append(el('span', 'tt', c.title), el('span', 'ar', c.kind === 'video' ? 'by ' + c.artist : ''), el('span', 'cc it', c.concept));
        if (c.warning) tx.append(el('span', 'wn vt', '⚠ ' + c.warning));
        bt.append(p, tx);
        bt.addEventListener('click', () => { touched = true; go(a, b, { user: true }); tv.focus({ preventScroll: true }); scrollToTv(); });
        il.append(bt); ol.append(il);
      });
      li.append(ol);
      g.append(li);
    });
    const n = chans.filter((c) => !c.offair).length;
    $('count').textContent = n + (n === 1 ? ' channel' : ' channels');
  }
  function el(tag, cls, text) { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; }
  function scrollToTv() { const r = tv.getBoundingClientRect(); if (r.top < 0 || r.bottom > innerHeight) tv.scrollIntoView({ behavior: reduce.matches ? 'auto' : 'smooth', block: 'center' }); }

  // ---------- tuning ----------
  function posterOf(c) { return c.kind === 'video' && c.ready ? `${MEDIA}/${c.id}/poster.jpg` : ''; }
  const BARS = 'linear-gradient(90deg,#f3ead9 0 14.3%,#ffb347 0 28.6%,#ff4f3d 0 42.9%,#a82215 0 57.2%,#54463f 0 71.5%,#1e1719 0 85.8%,#0b0809 0)';
  const wrap = (i, n) => ((i % n) + n) % n;
  const chan = (d, opt) => { const a = wrap(ci + d, chans.length); go(a, chans[a].pos, opt); };          // up / down
  const step = (d, opt) => { const n = chans[ci].items.length; if (n < 2) { nope(); return; } go(ci, wrap(chans[ci].pos + d, n), opt); };   // left / right
  function nope() { showOsd(); if (reduce.matches) return; tv.classList.remove('flick'); void tv.offsetWidth; tv.classList.add('flick'); runSnow(300); clearTimeout(flipTimer); flipTimer = setTimeout(() => tv.classList.remove('flick'), 340); }

  // Tune to channel a, item b. A change of channel is the big flip; a change inside a channel is the light one.
  function go(a, b, opt = {}) {
    a = wrap(a, chans.length);
    const ch = chans[a];
    b = wrap(b, ch.items.length);
    if (a === ci && b === ch.pos && !opt.first) { showOsd(); return; }
    const bigFlip = a !== ci;
    const play = !!opt.user || (opt.auto && touched);
    ci = a; ch.pos = b;
    const c = ch.items[b];
    stopMedia();
    setLabels(ch, c, bigFlip || opt.first);
    if (!opt.first) { try { history.replaceState(null, '', '#' + c.id); } catch (e) {} }
    clearTimeout(flipTimer);
    tv.classList.remove('flip', 'flick', 'xfade');
    if (opt.first) { show(c, false); showOsd(3200); return; }
    const land = () => { tv.classList.remove('flip', 'flick', 'xfade'); showOsd(); if (play && c.kind === 'video' && c.ready) start(); };
    if (reduce.matches) {                      // a plain crossfade
      tv.classList.add('xfade');
      flipTimer = setTimeout(() => { show(c, false, true); land(); }, 260);
      return;
    }
    void tv.offsetWidth;
    if (bigFlip) {                             // static, then the new picture rolls in under it and locks
      const p = posterOf(c);
      tv.style.setProperty('--h', tv.clientHeight + 'px');
      roll.style.backgroundImage = 'linear-gradient(#000 0 7%, transparent 7%), ' + (p ? `url("${p}")` : BARS);
      tv.classList.add('flip');
      runSnow(900);
      blip(1);
      show(c, false, true);
      flipTimer = setTimeout(land, 860);
    } else {                                   // a flicker of snow and a jolt
      tv.classList.add('flick');
      runSnow(340);
      blip(0.6);
      show(c, false, true);
      flipTimer = setTimeout(land, 320);
    }
  }

  function rich(node, text) {                  // *WORD* is his emphasis; [words] open the take-down form
    node.textContent = '';
    String(text).split(/(\*[^*]+\*|\[[^\]]+\])/).forEach((part) => {
      if (/^\[[^\]]+\]$/.test(part)) {
        if (!formUrl) { node.append(part.slice(1, -1)); return; }
        const b = el('button', 'lk', part.slice(1, -1)); b.type = 'button'; b.addEventListener('click', openForm); node.append(b);
      }
      else if (/^\*[^*]+\*$/.test(part)) node.append(el('em', '', part.slice(1, -1)));
      else if (part) node.append(part);
    });
  }

  // ---------- the take-down form ----------
  const dlg = $('td'), tdf = $('tdf');
  let tdOpened = 0;
  function openForm() {
    const sel = $('tdv'), here = item();
    sel.textContent = '';
    chans.forEach((ch) => ch.items.forEach((c) => { if (c.kind !== 'video') return; const o = el('option', '', c.title + ', by ' + c.artist); o.value = o.textContent; if (c === here) o.selected = true; sel.append(o); }));
    sel.append(el('option', '', 'Something else'));
    $('tdmsg').textContent = ''; tdf.hidden = false; $('tddone').hidden = true;
    tdOpened = Date.now();
    if (!vid.paused) { wantPlay = false; vid.pause(); }
    if (dlg.showModal) dlg.showModal(); else dlg.setAttribute('open', '');
  }
  $('tdx').addEventListener('click', () => dlg.close());
  $('tdok').addEventListener('click', () => dlg.close());
  tdf.addEventListener('submit', async (e) => {
    e.preventDefault();
    const send = $('tdsend'), msg = $('tdmsg');
    send.disabled = true; msg.textContent = 'Sending…';
    const body = { video: $('tdv').value, name: $('tdn').value, contact: $('tdc').value, message: $('tdm').value, website: $('tdw').value, elapsed: Date.now() - tdOpened };
    let status = 0;
    try { status = (await fetch(formUrl, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })).status; } catch (err) {}
    send.disabled = false;
    if (status === 200) { tdf.reset(); tdf.hidden = true; $('tddone').hidden = false; $('tdok').focus(); return; }
    msg.textContent = status === 429 ? 'Too many requests from here. Try again in an hour.' : status === 413 ? 'That is too long. Shorten it and send again.' : 'That did not send. Try again in a minute.';
  });

  function setLabels(ch, c, chanChanged) {
    $('osdch').textContent = 'CH ' + pad(ch.num);
    const on = $('osdn');
    on.textContent = ch.hidden ? ch.name + ' · HIDDEN' : ch.name;
    on.classList.toggle('hid', ch.hidden);
    $('osdt').textContent = c.title;
    $('osda').textContent = c.kind === 'video' ? 'by ' + c.artist : (c.label.toLowerCase() === c.title.toLowerCase() ? '' : c.label);
    if (chanChanged && !ch.offair) {
      rich($('voice'), ch.intro);
      rich($('notice'), ch.notice);
      $('notice').hidden = !ch.notice;
      $('chname').textContent = ch.name;
      $('chtag').hidden = false;
      $('chtagn').textContent = 'Channel ' + pad(ch.num);
    }
    const k = $('nowk');
    const vids = ch.items.filter((x) => x.kind === 'video');
    k.textContent = 'Channel ' + pad(ch.num) + ' · ' + ch.name + (c.kind === 'video' ? ' · ' + (vids.indexOf(c) + 1) + ' of ' + vids.length + (c.ready ? '' : ' · tuning in soon') : ' · ' + c.label);
    if (ch.hidden) k.append(el('span', 'hid', ' · hidden, preview only'));
    $('nowt').textContent = c.title;
    const cr = $('nowc');
    cr.textContent = '';
    if (c.kind === 'video') cr.append('Song: ', el('b', '', c.title), ', by ', el('b', '', c.artist), ' · Visuals: advanced studios');
    $('nowd').textContent = c.concept;
    $('noww').textContent = c.warning ? '⚠ ' + c.warning : ''; $('noww').hidden = !c.warning;
    document.title = (c.kind === 'video' ? c.title + ', by ' + c.artist + ' · ' : '') + 'Music Video Adventures';
    document.querySelectorAll('#guide .chan').forEach((li) => {
      const mine = +li.dataset.ch === ci;
      li.classList.toggle('on', mine);
      li.querySelectorAll('.items button').forEach((bt, k2) => bt.setAttribute('aria-current', mine && k2 === ch.pos ? 'true' : 'false'));
      li.querySelector('.chh').setAttribute('aria-current', mine ? 'true' : 'false');
    });
  }

  // put channel c on the screen (not yet playing)
  function show(c, play, quiet) {
    const isVid = c.kind === 'video' && c.ready;
    vid.hidden = !isVid;
    card.hidden = isVid;
    tv.classList.toggle('idle', !isVid);
    if (isVid) {
      vid.poster = posterOf(c);
      big.hidden = false;
      setTime(0, c.duration);
      if (play) start();
    } else {
      big.hidden = true;
      $('cardk').textContent = 'CH ' + pad(chans[ci].num) + ' · ' + chans[ci].name + ' · ' + (c.kind === 'card' ? c.label : 'tuning in soon');
      $('cardh').textContent = c.title;
      $('cardl').textContent = c.kind === 'card' ? c.concept : 'by ' + c.artist + '. Not on the air yet.';
      setTime(0, 0);
      idleSnow();
    }
    spin.hidden = true;
    setPlayIcon(false);
    if (!quiet) ctlShow();
  }

  function stopMedia() {
    wantPlay = false;
    try { vid.pause(); } catch (e) {}
    if (hls) { try { hls.destroy(); } catch (e) {} hls = null; }
    if (vid.getAttribute('src')) { vid.removeAttribute('src'); try { vid.load(); } catch (e) {} }
    vid.dataset.id = '';
  }

  // ---------- playback ----------
  function loadHls() {
    if (window.Hls) return Promise.resolve(window.Hls);
    if (loadHls.p) return loadHls.p;
    loadHls.p = new Promise((ok, no) => { const s = document.createElement('script'); s.src = HLS_JS; s.onload = () => ok(window.Hls); s.onerror = no; document.head.append(s); });
    return loadHls.p;
  }

  async function attach(c) {
    if (vid.dataset.id === c.id) return;
    vid.dataset.id = c.id;
    const url = `${MEDIA}/${c.id}/master.m3u8`;
    // Safari and iOS play HLS themselves; everything else gets hls.js. ?hlsjs=1 forces hls.js for testing.
    const native = vid.canPlayType('application/vnd.apple.mpegurl') && qs.get('hlsjs') !== '1';
    if (native) { vid.src = url; return; }
    const Hls = await loadHls();
    if (vid.dataset.id !== c.id) return;       // the channel changed while the script loaded
    if (!Hls || !Hls.isSupported()) { vid.src = url; return; }
    hls = new Hls({ capLevelToPlayerSize: true, startLevel: -1, maxBufferLength: 20 });
    hls.on(Hls.Events.ERROR, (e, d) => {
      if (!d.fatal) return;
      if (d.type === Hls.ErrorTypes.NETWORK_ERROR) hls.startLoad();
      else if (d.type === Hls.ErrorTypes.MEDIA_ERROR) hls.recoverMediaError();
    });
    hls.loadSource(url);
    hls.attachMedia(vid);
  }

  async function start() {
    const c = item();
    if (!c || c.kind !== 'video' || !c.ready) return;
    wantPlay = true;
    big.hidden = true;
    spin.hidden = false;
    const p0 = attach(c);                      // keep play() inside the gesture where we can
    try { await p0; if (item() !== c) return; await vid.play(); }
    catch (e) { if (item() === c && vid.paused) { wantPlay = false; spin.hidden = true; big.hidden = false; setPlayIcon(false); ctlShow(); } }
  }
  function toggle() { const c = item(); if (!c || c.kind !== 'video' || !c.ready) return; if (vid.paused) start(); else { wantPlay = false; vid.pause(); } }

  vid.addEventListener('playing', () => { spin.hidden = true; big.hidden = true; setPlayIcon(true); ctlShow(); });
  vid.addEventListener('pause', () => { setPlayIcon(false); if (!vid.ended && !vid.seeking) ctlShow(true); });
  vid.addEventListener('waiting', () => { if (wantPlay) spin.hidden = false; });
  vid.addEventListener('canplay', () => { if (!vid.paused) spin.hidden = true; });
  vid.addEventListener('timeupdate', () => { if (!seek.matches(':active') && !seeking) setTime(vid.currentTime, vid.duration || (item() || {}).duration); });
  vid.addEventListener('durationchange', () => setTime(vid.currentTime, vid.duration));
  vid.addEventListener('ended', () => { if (chans[ci].items.length > 1) step(1, { auto: true }); else { setPlayIcon(false); big.hidden = false; ctlShow(true); } });
  vid.addEventListener('volumechange', syncVol);

  function setPlayIcon(playing) {
    $('ppi').setAttribute('d', playing ? 'M6 4h4v16H6zM14 4h4v16h-4z' : 'M6 3.5v17l14-8.5z');
    $('pp').setAttribute('aria-label', playing ? 'Pause' : 'Play');
  }
  function setTime(t, d) {
    d = isFinite(d) && d > 0 ? d : 0;
    $('time').textContent = clock(t) + ' / ' + clock(d);
    const p = d ? Math.min(1, t / d) : 0;
    seek.value = Math.round(p * 1000);
    seek.style.setProperty('--p', (p * 100).toFixed(2) + '%');
  }
  let seeking = false;
  seek.addEventListener('input', () => {
    seeking = true;
    const d = vid.duration || 0, p = seek.value / 1000;
    seek.style.setProperty('--p', (p * 100) + '%');
    if (d) { vid.currentTime = p * d; $('time').textContent = clock(p * d) + ' / ' + clock(d); }
  });
  seek.addEventListener('change', () => { seeking = false; });
  function nudge(s) { if (vid.duration) { vid.currentTime = Math.min(vid.duration - 0.2, Math.max(0, vid.currentTime + s)); ctlShow(); } }

  // volume
  function syncVol() {
    const v = vid.muted ? 0 : vid.volume;
    vol.value = Math.round(v * 100);
    vol.style.setProperty('--p', (v * 100) + '%');
    $('mw').style.display = v === 0 ? 'none' : '';
    $('mute').setAttribute('aria-label', v === 0 ? 'Unmute' : 'Mute');
    store.set('mv.vol', String(vid.volume)); store.set('mv.muted', vid.muted ? '1' : '0');
  }
  vol.addEventListener('input', () => { vid.volume = vol.value / 100; vid.muted = vol.value === '0'; });
  function mute() { vid.muted = !vid.muted; if (!vid.muted && vid.volume === 0) vid.volume = 0.6; ctlShow(); }
  { const v = parseFloat(store.get('mv.vol')); if (v >= 0 && v <= 1) vid.volume = v; vid.muted = store.get('mv.muted') === '1'; syncVol(); }

  // fullscreen: the whole set, so the flip and the display come along; iPhone only does the bare video
  function fullscreen() {
    const d = document;
    if (d.fullscreenElement || d.webkitFullscreenElement) { (d.exitFullscreen || d.webkitExitFullscreen).call(d); return; }
    const f = tv.requestFullscreen || tv.webkitRequestFullscreen;
    if (f) { try { const r = f.call(tv); if (r && r.catch) r.catch(() => {}); } catch (e) {} }
    else if (vid.webkitEnterFullscreen && !vid.hidden) { try { vid.webkitEnterFullscreen(); } catch (e) {} }
  }

  // ---------- display, controls ----------
  function showOsd(ms = 2800) { tv.classList.add('osd-on'); clearTimeout(osdTimer); osdTimer = setTimeout(() => tv.classList.remove('osd-on'), ms); }
  function ctlShow(stay) {
    tv.classList.add('ctl-on');
    clearTimeout(ctlTimer);
    if (!stay && !vid.paused && !vid.hidden) ctlTimer = setTimeout(() => { if (!tv.querySelector('.ctl :focus-visible') && !tv.querySelector('.ctl:hover')) tv.classList.remove('ctl-on'); }, 2600);
  }
  function ctlHide() { if (!vid.paused && !vid.hidden) { clearTimeout(ctlTimer); tv.classList.remove('ctl-on'); } }

  $('pp').addEventListener('click', toggle);
  big.addEventListener('click', (e) => { e.stopPropagation(); start(); });
  $('mute').addEventListener('click', mute);
  $('fs').addEventListener('click', fullscreen);
  $('chup').addEventListener('click', () => chan(1, { user: true }));
  $('chdn').addEventListener('click', () => chan(-1, { user: true }));
  $('next').addEventListener('click', () => step(1, { user: true }));
  $('prev').addEventListener('click', () => step(-1, { user: true }));
  $('ctl').addEventListener('click', (e) => e.stopPropagation());
  tv.addEventListener('mousemove', () => ctlShow());
  tv.addEventListener('mouseleave', ctlHide);
  tv.addEventListener('dblclick', (e) => { if (!e.target.closest('.ctl')) fullscreen(); });

  // mouse: a click on the picture plays or pauses. touch: a tap brings the controls, a swipe changes channel.
  let t0 = null, lastTouch = 0;
  tv.addEventListener('click', (e) => {
    if (e.target.closest('.ctl') || e.target === big) return;
    if (Date.now() - lastTouch < 700) return;             // the touch handlers dealt with it
    toggle();
  });
  tv.addEventListener('touchstart', (e) => {
    if (e.target.closest('.ctl')) { t0 = null; return; }
    const t = e.changedTouches[0]; t0 = { x: t.clientX, y: t.clientY, at: Date.now() };
  }, { passive: true });
  tv.addEventListener('touchmove', (e) => { if (t0 && e.cancelable) e.preventDefault(); }, { passive: false });
  tv.addEventListener('touchend', (e) => {
    if (!t0) return;
    lastTouch = Date.now();
    const t = e.changedTouches[0], dx = t.clientX - t0.x, dy = t.clientY - t0.y;
    t0 = null;
    if (Math.abs(dy) > 44 && Math.abs(dy) > Math.abs(dx) * 1.3) { chan(dy < 0 ? 1 : -1, { user: true }); return; }   // swipe up: next channel
    if (Math.abs(dx) > 44 && Math.abs(dx) > Math.abs(dy) * 1.3) { step(dx < 0 ? 1 : -1, { user: true }); return; }   // swipe left: next video
    if (Math.abs(dx) > 12 || Math.abs(dy) > 12) return;
    if (e.target === big || e.target.closest('.big')) { start(); return; }
    if (tv.classList.contains('ctl-on') && !vid.paused) ctlHide(); else ctlShow();
  });

  // keyboard, anywhere on the page unless you are typing into something
  addEventListener('keydown', (e) => {
    if (e.altKey || e.ctrlKey || e.metaKey || dlg.open) return;
    const t = e.target, tag = t && t.tagName;
    if (tag === 'INPUT' && t.type !== 'range' || tag === 'TEXTAREA' || tag === 'SELECT') return;
    const range = tag === 'INPUT';
    const k = e.key;
    if (k === 'ArrowUp' || k === 'PageUp') { if (range && k === 'ArrowUp') return; e.preventDefault(); chan(1, { user: true }); }
    else if (k === 'ArrowDown' || k === 'PageDown') { if (range && k === 'ArrowDown') return; e.preventDefault(); chan(-1, { user: true }); }
    else if (k === ' ' || k === 'k') { if (tag === 'BUTTON' || tag === 'A') return; e.preventDefault(); toggle(); }
    else if (k === 'ArrowLeft') { if (range) return; e.preventDefault(); step(-1, { user: true }); }
    else if (k === 'ArrowRight') { if (range) return; e.preventDefault(); step(1, { user: true }); }
    else if (k === 'j' || k === 'J') { e.preventDefault(); nudge(-10); }
    else if (k === 'l' || k === 'L') { e.preventDefault(); nudge(10); }
    else if (k === 'f' || k === 'F') { e.preventDefault(); fullscreen(); }
    else if (k === 'm' || k === 'M') { e.preventDefault(); mute(); }
    else if (/^[0-9]$/.test(k)) { e.preventDefault(); digit(k); }
  });
  // number keys work like a remote: type one or two digits, the set tunes after a beat
  function digit(k) {
    digits = (digits + k).slice(-2);
    $('osdch').textContent = 'CH ' + (digits.length === 1 ? digits + '_' : digits);
    showOsd(1500);
    clearTimeout(digitTimer);
    const go = () => {
      const n = parseInt(digits, 10); digits = '';
      const i = chans.findIndex((c) => c.num === n);
      if (i >= 0 && i !== ci) go(i, chans[i].pos, { user: true }); else { $('osdch').textContent = 'CH ' + pad(chans[ci].num); if (i < 0) nope(); else showOsd(); }
    };
    const more = chans.some((c) => c.num >= 10);
    digitTimer = setTimeout(go, digits.length === 2 || !more ? 380 : 900);
  }
  for (const ev of ['pointerdown', 'keydown', 'touchend']) addEventListener(ev, () => { touched = true; }, { capture: true, passive: true });
  addEventListener('hashchange', () => { const at = find(decodeURIComponent(location.hash.slice(1))); if (at) go(at[0], at[1], { auto: true }); });

  // ---------- snow ----------
  const sctx = snow.getContext('2d', { alpha: false });
  const simg = sctx.createImageData(snow.width, snow.height);
  const sbuf = new Uint32Array(simg.data.buffer);
  function drawSnow() {
    const w = snow.width, h = snow.height, band = (Math.random() * h) | 0, bh = 6 + (Math.random() * 14 | 0);
    for (let y = 0, i = 0; y < h; y++) {
      const hot = y >= band && y < band + bh;
      for (let x = 0; x < w; x++, i++) {
        let v = (Math.random() * 255) | 0;
        if (hot) v = Math.min(255, v + 90);
        sbuf[i] = 0xff000000 | (v << 16) | (v << 8) | v;
      }
    }
    sctx.putImageData(simg, 0, 0);
  }
  function runSnow(ms) {
    snowUntil = performance.now() + ms;
    if (snowRaf) return;
    const step = (now) => { drawSnow(); snowRaf = now < snowUntil ? requestAnimationFrame(step) : (idleSnow(), 0); };
    snowRaf = requestAnimationFrame(step);
  }
  // the stand-by card keeps a little grain alive, slowly, and only while it is on screen
  let idleT = 0;
  function idleSnow() {
    clearInterval(idleT);
    if (reduce.matches) { drawSnow(); return; }
    idleT = setInterval(() => { if (!tv.classList.contains('idle')) { clearInterval(idleT); return; } if (!snowRaf && !document.hidden) drawSnow(); }, 90);
  }

  // ---------- the blip: quiet, and never before the viewer has touched something ----------
  function blip(k) {
    if (!touched || vid.muted || vid.volume === 0) return;
    try {
      actx = actx || new (window.AudioContext || window.webkitAudioContext)();
      if (actx.state === 'suspended') actx.resume();
      const t = actx.currentTime, len = 0.22, n = Math.floor(actx.sampleRate * len);
      const buf = actx.createBuffer(1, n, actx.sampleRate), d = buf.getChannelData(0);
      for (let i = 0; i < n; i++) d[i] = Math.random() * 2 - 1;
      const src = actx.createBufferSource(); src.buffer = buf;
      const bp = actx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 2400; bp.Q.value = 0.7;
      const g = actx.createGain(); const lvl = 0.05 * k * Math.max(0.2, vid.volume);
      g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(lvl, t + 0.012); g.gain.exponentialRampToValueAtTime(0.0001, t + len);
      src.connect(bp).connect(g).connect(actx.destination); src.start(t); src.stop(t + len);
      const o = actx.createOscillator(), og = actx.createGain();
      o.type = 'sine'; o.frequency.setValueAtTime(140, t); o.frequency.exponentialRampToValueAtTime(48, t + 0.09);
      og.gain.setValueAtTime(lvl * 1.4, t); og.gain.exponentialRampToValueAtTime(0.0001, t + 0.11);
      o.connect(og).connect(actx.destination); o.start(t); o.stop(t + 0.12);
    } catch (e) {}
  }

  window.__mv = { get chans() { return chans; }, get ci() { return ci; }, get item() { return item(); }, go, chan, step, media: MEDIA, get hlsjs() { return !!hls; } };
  boot();
})();
