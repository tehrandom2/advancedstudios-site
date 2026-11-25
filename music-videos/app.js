/* Music Video Adventures: the set and the wall.
   Everything here comes from channels.json on the media host, which tools/mv-publish writes from the one
   data file. Nothing here names a channel or a video. Channel numbers are the data order; CH 00 is the
   test card. The channels are slabs you can hit; the channel that is on shows its videos as a wall of their
   own pictures. Up and down change channel (the big flip), left and right change video inside a channel.
   A video that carries a warning never starts by itself: it waits on its poster, the warning on the play
   button, until the viewer presses play. */
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
  const credit = (c) => (c.album ? 'on ' + c.album : 'by ' + c.artist);   // a game soundtrack track is ON its album, not BY it
  let ci = -1;            // channel on screen
  let formUrl = '';
  const item = () => (ci >= 0 ? chans[ci].items[chans[ci].pos] : null);
  let hls = null;
  let touched = false;    // the viewer has interacted: sound and the blip are allowed
  let actx = null;
  let flipTimer = 0, osdTimer = 0, ctlTimer = 0, digitTimer = 0, digits = '';
  let snowRaf = 0, snowUntil = 0, flipTok = 0;
  const FLIP_CAP = 4000;  // ms: the longest a flip waits for a video's first frame
  let wantPlay = false;

  const pad = (n) => String(n).padStart(2, '0');
  const same = (a, b) => String(a).trim().toLowerCase() === String(b).trim().toLowerCase();
  // a card's label, unless it only repeats the channel's name or the card's own title
  const tagOf = (ch, c) => (same(c.label, ch.name) || same(c.label, c.title) ? '' : c.label);
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
      const items = (c.videos || []).map((v) => ({ kind: 'video', id: v.id, title: v.title, artist: v.artist, album: v.album || '', concept: v.concept, warning: v.warning || '', ready: v.ready !== false, duration: v.duration || 0 }));
      if (c.next_up) items.push({ kind: 'card', id: c.id + '-next', title: c.next_up.title || 'Next up', artist: c.name, concept: c.next_up.line || '', label: 'next up' });
      if (!items.length) items.push({ kind: 'card', id: c.id + '-soon', title: 'Stand by', artist: c.name, concept: 'Nothing on this channel yet.', label: 'stand by' });
      return { num: i + 1, id: c.id, name: c.name, intro: c.intro || '', notice: c.notice || '', hidden: !!c.hidden, pos: 0, items };
    });
    const off = data.offair || {};
    chans.push({ num: 0, id: 'off-air', name: 'Off air', intro: '', notice: '', hidden: false, pos: 0, offair: true,
      items: [{ kind: 'card', id: 'test-card', title: off.title || 'Test card', artist: 'Off air', concept: off.line || (data.channels && data.channels.length ? 'Nothing on this one. Flip back.' : 'The set is warming up. Try again in a minute.'), label: 'off air' }] });
    buildDial();
    slides();
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

  const LONG = 1200;       // seconds: from here a video is a long play and gets a full row on the wall
  const pick = (ch, c, b) => { touched = true; if (chans[ci] === ch && ch.pos === b) { toggle(); } else go(chans.indexOf(ch), b, { user: true }); tv.focus({ preventScroll: true }); scrollToTv(); };
  function pic(c) { const im = el('img'); im.alt = ''; im.decoding = 'async'; im.crossOrigin = 'anonymous'; im.width = 1280; im.height = 720; return im; }

  // the channels: one slab each, all of them on the first screen
  function buildDial() {
    const g = $('dial');
    g.textContent = '';
    chans.forEach((ch, a) => {
      const li = el('li', ch.offair ? 'off' : ''), hb = el('button', 'slab' + (ch.offair ? ' off' : '')); hb.type = 'button';
      hb.dataset.ch = a;
      const vids = ch.items.filter((x) => x.kind === 'video'), nv = vids.length;
      if (ch.offair) { hb.append(el('span', 'num', pad(ch.num))); hb.setAttribute('aria-label', 'Channel ' + pad(ch.num) + ', ' + ch.name); hb.title = ch.name; }
      else {
        const pics = el('span', 'pics'), ready = vids.filter((x) => x.ready);
        const take = ready.length > 3 ? [0, Math.floor(ready.length / 3), Math.floor(ready.length * 2 / 3)] : ready.map((x, i) => i);
        take.forEach((i) => { const im = pic(ready[i]); im.src = posterOf(ready[i]); pics.append(im); });
        const meta = el('span', 'meta vt');
        meta.append(el('span', 'go', ''), el('span', 'ct', nv + (nv === 1 ? ' video' : ' videos')));
        if (ch.hidden) meta.append(el('span', 'badge', 'Hidden'));
        const tx = el('span', 'tx'); tx.append(el('span', 'nm', ch.name), meta); hb.style.setProperty('--n', Math.max(4, ch.name.length));
        hb.append(pics, el('span', 'num', pad(ch.num)), tx);
      }
      hb.addEventListener('click', () => { touched = true; go(a, ch.pos, { user: true }); tv.focus({ preventScroll: true }); });
      li.append(hb); g.append(li);
    });
    const real = chans.filter((c) => !c.offair), nv = real.reduce((n, c) => n + c.items.filter((x) => x.kind === 'video').length, 0);
    const st = $('stats'); st.textContent = '';
    if (real.length) [nv + (nv === 1 ? ' video' : ' videos'), real.length + (real.length === 1 ? ' channel' : ' channels'), '0 ads', '0 algorithms'].forEach((t) => st.append(el('span', '', t)));
    // the ticker: every title, twice over so the loop has no seam
    const tk = $('tick'); tk.textContent = '';
    for (let k = 0; k < 2; k++) real.forEach((ch) => ch.items.forEach((c, b) => { if (c.kind !== 'video') return; const bt = el('button', '', c.title); bt.type = 'button'; bt.tabIndex = -1; bt.addEventListener('click', () => pick(ch, c, b)); tk.append(bt); }));
    tk.style.animationDuration = Math.max(40, tk.childElementCount * 2.2) + 's';
  }

  // the wall: the videos of the channel that is on, as their own pictures
  // a poster is fetched when its tile comes near the screen, not before
  const lazy = 'IntersectionObserver' in window ? new IntersectionObserver((es) => es.forEach((e) => { if (!e.isIntersecting) return; lazy.unobserve(e.target); e.target.src = e.target.dataset.src; }), { rootMargin: '240px 0px' }) : null;
  let wallFor = -1;
  function buildWall() {
    const w = $('wall'), ch = chans[ci];
    if (wallFor === ci) return;
    wallFor = ci;
    pvStop();
    if (lazy) lazy.disconnect();
    w.textContent = '';
    if (ch.offair) return;
    ch.items.forEach((c, b) => {
      const isVid = c.kind === 'video', long = isVid && c.duration >= LONG;
      const li = el('li', long ? 'long' : ''), bt = el('button', 'tile' + (isVid && c.ready ? '' : ' bars')); bt.type = 'button';
      if (isVid && c.ready) {
        const im = pic(c);
        im.addEventListener('load', () => { const h = hotOf(im, c.id); if (h) bt.style.setProperty('--c', h); });
        if (lazy) { im.dataset.src = posterOf(c); lazy.observe(im); } else { im.loading = 'lazy'; im.src = posterOf(c); }
        bt.append(im);
      }
      const top = el('span', 'top vt');
      if (c.warning) top.append(el('span', 'wn', '⚠ ' + (long ? c.warning : '')));
      if (long) top.append(el('span', 'lp', 'Long play'));
      if (isVid) top.append(el('span', 'd', c.ready ? (long ? Math.round(c.duration / 60) + ' min' : clock(c.duration)) : 'Soon'));
      const tx = el('span', 'tx');
      tx.append(el('span', 'tt', c.title), el('span', 'ar vt', isVid ? credit(c) : ''));
      bt.append(top, tx);
      bt.setAttribute('aria-label', c.title + (isVid ? ', ' + credit(c) + (c.duration ? ', ' + clock(c.duration) : '') : '') + (c.warning ? '. Warning: ' + c.warning : ''));
      bt.title = (c.warning ? '⚠ ' + c.warning + '. ' : '') + c.concept;
      bt.addEventListener('click', () => { pvStop(); pick(ch, c, b); });
      pvArm(bt, c);
      li.style.setProperty('--i', Math.min(b, 24));
      li.append(bt); w.append(li);
    });
  }

  // The slabs are alive: every few seconds one of a slab's pictures changes to another of its channel's posters.
  // Still pictures only, one slow cross-fade at a time, and not at all under reduced motion.
  let slideT = 0, slideN = 0;
  function slides() {
    clearInterval(slideT);
    if (reduce.matches) return;
    slideT = setInterval(() => {
      if (document.hidden) return;
      const slabs = [...document.querySelectorAll('#dial .slab:not(.off)')]; if (!slabs.length) return;
      const hb = slabs[slideN % slabs.length], ch = chans[+hb.dataset.ch], ims = hb.querySelectorAll('.pics img'); slideN++;
      const pool = ch.items.filter((x) => x.kind === 'video' && x.ready).slice(0, 9).map(posterOf).filter((u) => ![...ims].some((i) => i.getAttribute('src') === u));
      if (!ims.length || !pool.length) return;
      const im = ims[(slideN >> 1) % ims.length], next = pool[Math.floor(Math.random() * pool.length)];
      const pre = new Image(); pre.crossOrigin = 'anonymous';
      pre.onload = () => { im.classList.add('out'); setTimeout(() => { im.src = next; im.classList.remove('out'); }, 460); };
      pre.src = next;
    }, 2600);
  }

  // Hover a picture and it moves: a silent preview from a quarter of the way in, smallest rendition.
  // Never for a video that carries a warning, never on touch, never under reduced motion.
  let pv = null, pvT = 0;
  function pvStop() {
    clearTimeout(pvT);
    if (!pv) return;
    const o = pv; pv = null;
    try { if (o.hls) o.hls.destroy(); } catch (e) {}
    try { o.v.pause(); o.v.removeAttribute('src'); o.v.load(); } catch (e) {}
    o.v.remove();
  }
  function pvArm(bt, c) {
    if (c.warning || c.kind !== 'video' || !c.ready) return;
    bt.addEventListener('pointerenter', (e) => {
      if (e.pointerType !== 'mouse' || reduce.matches) return;
      pvStop();
      pvT = setTimeout(() => pvStart(bt, c), 320);
    });
    bt.addEventListener('pointerleave', pvStop);
  }
  async function pvStart(bt, c) {
    if (c.warning || item() === c && !vid.paused) return;   // belt and braces; and no double picture of what is playing
    const v = document.createElement('video'); v.muted = true; v.defaultMuted = true; v.volume = 0; v.playsInline = true; v.loop = true; v.disablePictureInPicture = true; v.tabIndex = -1; v.setAttribute('aria-hidden', 'true');
    const o = pv = { v, hls: null }, url = `${MEDIA}/${c.id}/master.m3u8`, at = Math.max(0, (c.duration || 0) * 0.25);
    v.addEventListener('playing', () => v.classList.add('on'), { once: true });
    bt.append(v);
    try {
      if (v.canPlayType('application/vnd.apple.mpegurl') && qs.get('hlsjs') !== '1') { v.src = url + '#t=' + at.toFixed(1); }
      else {
        const Hls = await loadHls();
        if (pv !== o || !Hls || !Hls.isSupported()) { if (pv === o) pvStop(); return; }
        o.hls = new Hls({ startPosition: at, maxBufferLength: 6, maxMaxBufferLength: 8, startLevel: 0 });
        o.hls.on(Hls.Events.MANIFEST_PARSED, () => { o.hls.autoLevelCapping = 0; });
        o.hls.on(Hls.Events.ERROR, (e, d) => { if (d.fatal && pv === o) pvStop(); });
        o.hls.loadSource(url); o.hls.attachMedia(v);
      }
      await v.play();
    } catch (e) { if (pv === o) pvStop(); }
  }

  // A colour for each picture: the strongest hue in its poster. The tile glows in it, and the page takes the
  // colour of whatever is on the screen. A grey picture has none and keeps the house red.
  const hots = {};
  const hcv = document.createElement('canvas'); hcv.width = 48; hcv.height = 27;
  function hotOf(im, id) {
    if (id in hots) return hots[id];
    let out = '';
    try {
      const x = hcv.getContext('2d', { willReadFrequently: true });
      x.drawImage(im, 0, 0, 48, 27);
      const d = x.getImageData(0, 0, 48, 27).data, bins = new Float32Array(12), hx = new Float32Array(12), hy = new Float32Array(12);
      let total = 0;
      for (let i = 0; i < d.length; i += 4) {
        const r = d[i], g = d[i + 1], b = d[i + 2], mx = Math.max(r, g, b), mn = Math.min(r, g, b), sat = mx - mn;
        if (sat < 30 || mx < 60) continue;
        let h = mx === r ? ((g - b) / sat) % 6 : mx === g ? (b - r) / sat + 2 : (r - g) / sat + 4;
        h = ((h * 60) + 360) % 360;
        const wgt = sat * sat * (0.4 + mx / 425), k = Math.floor(h / 30) % 12, rad = h * Math.PI / 180;
        bins[k] += wgt; hx[k] += Math.cos(rad) * wgt; hy[k] += Math.sin(rad) * wgt; total += wgt;
      }
      let best = 0; for (let k = 1; k < 12; k++) if (bins[k] > bins[best]) best = k;
      if (total > 48 * 27 * 40 && bins[best] > 0) {
        const h = Math.round((Math.atan2(hy[best], hx[best]) * 180 / Math.PI + 360) % 360);
        out = `hsl(${h} 96% ${h > 200 && h < 290 ? 70 : 60}%)`;   // blues and violets need lifting to read on ink
      }
    } catch (e) {}
    hots[id] = out;
    return out;
  }
  // light the room from the picture that is on
  function tint(c) {
    const root = document.documentElement.style, p = posterOf(c);
    root.setProperty('--poster', p ? `url("${p}")` : 'none');
    $('hb').classList.toggle('pic', !!p);
    if (!p) { root.removeProperty('--hot'); return; }
    const im = new Image(); im.crossOrigin = 'anonymous';
    im.onload = () => { if (item() !== c) return; const h = hotOf(im, c.id); if (h) root.setProperty('--hot', h); else root.removeProperty('--hot'); };
    im.src = p;
  }
  function el(tag, cls, text) { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; }
  function scrollToTv() { const r = tv.getBoundingClientRect(); if (r.top < 0 || r.bottom > innerHeight) tv.scrollIntoView({ behavior: reduce.matches ? 'auto' : 'smooth', block: 'center' }); }

  // ---------- tuning ----------
  function posterOf(c) { return c.kind === 'video' && c.ready ? `${MEDIA}/${c.id}/poster.jpg` : ''; }
  const BARS = 'linear-gradient(90deg,#f3ead9 0 14.3%,#ffb347 0 28.6%,#ff4f3d 0 42.9%,#a82215 0 57.2%,#54463f 0 71.5%,#1e1719 0 85.8%,#0b0809 0)';
  const wrap = (i, n) => ((i % n) + n) % n;
  const chan = (d, opt) => { const a = wrap(ci + d, chans.length); go(a, chans[a].pos, opt); };          // up / down
  const step = (d, opt) => { const n = chans[ci].items.length; if (n < 2) { nope(); return; } go(ci, wrap(chans[ci].pos + d, n), opt); };   // left / right
  function nope() { flipTok++; showOsd(); if (reduce.matches) return; tv.classList.remove('flick'); void tv.offsetWidth; tv.classList.add('flick'); runSnow(300); clearTimeout(flipTimer); flipTimer = setTimeout(() => tv.classList.remove('flick'), 340); }

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
    if (!opt.first) {                          // one clean deep link: drop ?v, keep any other parameter
      const q = new URLSearchParams(location.search); q.delete('v');
      const qs2 = q.toString();
      try { history.replaceState(null, '', location.pathname + (qs2 ? '?' + qs2 : '') + '#' + c.id); } catch (e) {}
    }
    clearTimeout(flipTimer);
    tv.classList.remove('flip', 'flick', 'xfade', 'hold', 'wait');
    if (opt.first) { show(c, false); showOsd(3200); return; }
    // The flip holds (static, badge) until the animation has run AND, when a video is about to play, until it
    // has its first frame; otherwise the set would show black at 0:00. A few seconds at most.
    const willPlay = play && c.kind === 'video' && c.ready && !c.warning;
    const tok = ++flipTok;
    let minDone = false, ready = !willPlay;
    const land = () => {
      if (tok !== flipTok || !minDone || !ready) return;
      flipTok++;                               // lands once
      snowUntil = 0;
      tv.classList.remove('flip', 'flick', 'xfade', 'hold', 'wait');
      showOsd();
    };
    const begin = (cls, ms, level) => {
      if (cls === 'xfade') { tv.classList.add('xfade'); } else { void tv.offsetWidth; tv.classList.add(cls); runSnow(willPlay ? FLIP_CAP + 200 : ms + 40); blip(level); }
      const put = () => { show(c, false, true); if (willPlay) start(); else ctlShow(true); };
      if (willPlay) tv.classList.add('wait');   // the poster covers the screen until the first frame
      if (cls === 'xfade') setTimeout(() => { if (tok !== flipTok) return; put(); tv.classList.remove('xfade'); tv.classList.add('hold'); }, 200); else put();
      flipTimer = setTimeout(() => { minDone = true; land(); }, ms);
      if (willPlay) {
        const got = () => { ready = true; land(); };
        vid.addEventListener('loadeddata', got, { once: true });
        vid.addEventListener('playing', got, { once: true });
        setTimeout(got, FLIP_CAP);
      }
    };
    const p = posterOf(c);
    tv.style.setProperty('--h', tv.clientHeight + 'px');
    roll.style.backgroundImage = (bigFlip && !reduce.matches ? 'linear-gradient(#000 0 7%, transparent 7%), ' : 'linear-gradient(transparent, transparent), ') + (p ? `url("${p}")` : BARS);
    if (reduce.matches) { begin('xfade', 260, 0); return; }   // a plain crossfade
    if (bigFlip) {                             // static, then the new picture rolls in under it and locks
      begin('flip', 860, 1);
    } else {                                   // a flicker of snow and a jolt
      begin('flick', 320, 0.6);
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
    chans.forEach((ch) => ch.items.forEach((c) => { if (c.kind !== 'video') return; const o = el('option', '', c.title + ', ' + credit(c)); o.value = o.textContent; if (c === here) o.selected = true; sel.append(o); }));
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
    $('osda').textContent = c.kind === 'video' ? credit(c) : tagOf(ch, c);
    if (chanChanged) {                         // the header, intro and notice belong to the channel on screen
      rich($('voice'), ch.offair ? c.concept : ch.intro);
      rich($('notice'), ch.notice);
      $('notice').hidden = !ch.notice;
      $('chname').textContent = ch.name;
      $('chtag').hidden = false;
      $('chtagn').textContent = 'Channel ' + pad(ch.num);
    }
    const k = $('nowk');
    const vids = ch.items.filter((x) => x.kind === 'video');
    k.textContent = 'Channel ' + pad(ch.num) + ' · ' + ch.name + (c.kind === 'video' ? ' · ' + (vids.indexOf(c) + 1) + ' of ' + vids.length + (c.ready ? '' : ' · tuning in soon') : (tagOf(ch, c) ? ' · ' + tagOf(ch, c) : ''));
    if (ch.hidden) k.append(el('span', 'hid', ' · hidden, preview only'));
    $('nowt').textContent = c.title;
    const cr = $('nowc');
    cr.textContent = '';
    if (c.kind === 'video') cr.append('Song: ', el('b', '', c.title), c.album ? ', on ' : ', by ', el('b', '', c.album || c.artist), ' · Visuals: advanced studios');
    $('nowd').textContent = c.concept;
    $('noww').textContent = c.warning ? '⚠ ' + c.warning : ''; $('noww').hidden = !c.warning;
    document.title = (c.kind === 'video' ? c.title + ', ' + credit(c) + ' · ' : '') + 'Music Video Adventures';
    buildWall();
    document.querySelectorAll('#dial .slab').forEach((hb) => {
      const mine = +hb.dataset.ch === ci;
      hb.setAttribute('aria-current', mine ? 'true' : 'false');
      const g = hb.querySelector('.go'); if (g) g.textContent = mine ? 'On air' : 'Tune in ▶';
    });
    document.querySelectorAll('#wall .tile').forEach((bt, k2) => {
      const cur = k2 === ch.pos;
      bt.setAttribute('aria-current', cur ? 'true' : 'false');
      if (cur && !chanChanged) { const r = bt.getBoundingClientRect(); if (r.bottom > 0 && r.top < innerHeight && (r.top < 0 || r.bottom > innerHeight)) bt.scrollIntoView({ block: 'nearest', behavior: reduce.matches ? 'auto' : 'smooth' }); }
    });
    tint(c);
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
      big.classList.toggle('warn', !!c.warning);
      big.setAttribute('aria-label', c.warning ? 'Play. Warning: ' + c.warning : 'Play');
      { const bw = $('bigw'); bw.textContent = ''; if (c.warning) bw.append('⚠ ' + c.warning, el('small', '', 'your call. press play.')); }
      setTime(0, c.duration);
      if (play) start();
    } else {
      big.hidden = true;
      { const tg = c.kind === 'card' ? tagOf(chans[ci], c) : 'tuning in soon'; $('cardk').textContent = 'CH ' + pad(chans[ci].num) + ' · ' + chans[ci].name + (tg ? ' · ' + tg : ''); }
      $('cardh').textContent = c.title;
      $('cardl').textContent = c.kind === 'card' ? c.concept : credit(c) + '. Not on the air yet.';
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
  $('remote').addEventListener('click', (e) => { const b = e.target.closest('button'); if (b) $(b.dataset.act).click(); });
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
    // A swipe may start anywhere, the control bar too: it covers the bottom third of a phone screen.
    // On a slider only an up or down swipe counts; sideways there is the slider's own drag.
    const t = e.changedTouches[0]; t0 = { x: t.clientX, y: t.clientY, at: Date.now(), ctl: !!e.target.closest('.ctl'), slider: !!e.target.closest('input') };
  }, { passive: true });
  tv.addEventListener('touchmove', (e) => { if (t0 && !t0.slider && e.cancelable) e.preventDefault(); }, { passive: false });
  tv.addEventListener('touchend', (e) => {
    if (!t0) return;
    lastTouch = Date.now();
    const t = e.changedTouches[0], dx = t.clientX - t0.x, dy = t.clientY - t0.y, onCtl = t0.ctl, onSlider = t0.slider;
    t0 = null;
    if (Math.abs(dy) > 44 && Math.abs(dy) > Math.abs(dx) * 1.3) { chan(dy < 0 ? 1 : -1, { user: true }); return; }   // swipe up: next channel
    if (onSlider) return;
    if (Math.abs(dx) > 44 && Math.abs(dx) > Math.abs(dy) * 1.3) { step(dx < 0 ? 1 : -1, { user: true }); return; }   // swipe left: next video
    if (Math.abs(dx) > 12 || Math.abs(dy) > 12) return;
    if (onCtl) return;                                       // a tap on a control is that control's click
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
    const commit = () => {
      const n = parseInt(digits, 10); digits = '';
      const i = chans.findIndex((c) => c.num === n);
      if (i >= 0 && i !== ci) go(i, chans[i].pos, { user: true }); else { $('osdch').textContent = 'CH ' + pad(chans[ci].num); if (i < 0) nope(); else showOsd(); }
    };
    const more = chans.some((c) => c.num >= 10);
    digitTimer = setTimeout(commit, digits.length === 2 || !more ? 380 : 900);
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
    if (!k || !touched || vid.muted || vid.volume === 0) return;
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

  window.__mv = { get preview() { return pv ? pv.v : null; }, get chans() { return chans; }, get ci() { return ci; }, get item() { return item(); }, go, chan, step, media: MEDIA, get hlsjs() { return !!hls; } };
  boot();
})();
