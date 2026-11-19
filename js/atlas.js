/* advanced studios: the full score.
   1. The baton's stave: lines that leave the conductor picture and run under the six works.
   2. The orchestra: an explorer drawn from data/atlas.json, where every node and line carries its source.
   Hand-written, no dependencies. If any of this fails, the page's plain index still has every link. */
(function () {
  'use strict';
  var D = document, root = D.documentElement;
  var RM = matchMedia('(prefers-reduced-motion: reduce)');
  var PHONE = matchMedia('(max-width: 700px)');
  var NS = 'http://www.w3.org/2000/svg';
  var byId = function (id) { return D.getElementById(id); };

  function mk(ns, tag, attrs, kids) {
    var e = ns ? D.createElementNS(ns, tag) : D.createElement(tag), k;
    for (k in attrs || {}) { if (attrs[k] === null || attrs[k] === undefined || attrs[k] === false) continue; if (k === 'text') e.textContent = attrs[k]; else e.setAttribute(k, attrs[k]); }
    (kids || []).forEach(function (c) { if (c) e.appendChild(typeof c === 'string' ? D.createTextNode(c) : c); });
    return e;
  }
  var h = function (t, a, k) { return mk(null, t, a, k); };
  var s = function (t, a, k) { return mk(NS, t, a, k); };

  /* ---------- arrivals ---------- */
  (function () {
    var els = D.querySelectorAll('.rv');
    if (!('IntersectionObserver' in window) || RM.matches) { els.forEach(function (e) { e.classList.add('in'); }); return; }
    var io = new IntersectionObserver(function (es) { es.forEach(function (e) { if (e.isIntersecting) { e.target.classList.add('in'); io.unobserve(e.target); } }); }, { rootMargin: '0px 0px -8% 0px' });
    els.forEach(function (e) { io.observe(e); });
  })();

  /* a soft dot of light, drawn once and stamped wherever a pulse is */
  function glow(rgb, size) {
    var c = D.createElement('canvas'); c.width = c.height = size * 2;
    var x = c.getContext('2d'), g = x.createRadialGradient(size, size, 0, size, size, size);
    g.addColorStop(0, 'rgba(255,255,255,1)'); g.addColorStop(0.16, 'rgba(' + rgb + ',.95)'); g.addColorStop(0.45, 'rgba(' + rgb + ',.28)'); g.addColorStop(1, 'rgba(' + rgb + ',0)');
    x.fillStyle = g; x.fillRect(0, 0, size * 2, size * 2); return c;
  }
  function measure(pts) { var L = [0], i; for (i = 1; i < pts.length; i++) L.push(L[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1])); return L; }
  function at(pts, L, d) { // point at distance d along a sampled line
    var n = pts.length, lo = 0, hi = n - 1, m, f;
    if (d <= 0) return pts[0]; if (d >= L[n - 1]) return pts[n - 1];
    while (hi - lo > 1) { m = (lo + hi) >> 1; if (L[m] <= d) lo = m; else hi = m; }
    f = (d - L[lo]) / ((L[hi] - L[lo]) || 1);
    return [pts[lo][0] + (pts[hi][0] - pts[lo][0]) * f, pts[lo][1] + (pts[hi][1] - pts[lo][1]) * f];
  }
  function onScreen(el, cb) { // run cb(true/false) as el enters or leaves the viewport
    if (!('IntersectionObserver' in window)) { cb(true); return; }
    new IntersectionObserver(function (es) { cb(es[es.length - 1].isIntersecting); }, { rootMargin: '80px' }).observe(el);
  }

  /* ---------- 1. the baton's stave ---------- */
  (function heroLines() {
    var hero = byId('top'), img = byId('conductor'); if (!hero || !img) return;
    var cv = hero.querySelector('.hero-lines'), prog = hero.querySelector('.programme ul'), ticket = byId('studio'), copy = hero.querySelector('.hero-copy');
    if (!cv || !cv.getContext || !prog) return;
    var ctx = cv.getContext('2d'), W = 0, H = 0, dpr = 1, staves = [], raf = 0, vis = true, t0 = 0, spr = glow('255,79,61', 14);

    function imgPoint(fx, fy) { // a spot in the picture -> hero coordinates, honouring object-fit: cover
      var r = img.getBoundingClientRect(), hr = hero.getBoundingClientRect(), iw = 1920, ih = 1080;
      var sc = Math.max(r.width / iw, r.height / ih), op = getComputedStyle(img).objectPosition.split(' ').map(parseFloat);
      return [r.left - hr.left + (r.width - iw * sc) * ((op[0] || 0) / 100) + fx * iw * sc, r.top - hr.top + (r.height - ih * sc) * ((op[1] || 0) / 100) + fy * ih * sc];
    }
    function spline(p, step) { // Catmull-Rom through the waypoints, sampled
      var out = [], i, k, n, t, t2, t3, a, b, c, d2, j;
      for (i = 0; i < p.length - 1; i++) {
        a = p[Math.max(0, i - 1)]; b = p[i]; c = p[i + 1]; d2 = p[Math.min(p.length - 1, i + 2)];
        n = Math.max(2, Math.ceil(Math.hypot(c[0] - b[0], c[1] - b[1]) / step));
        for (k = 0; k < n; k++) { t = k / n; t2 = t * t; t3 = t2 * t; var q = [0, 0];
          for (j = 0; j < 2; j++) q[j] = 0.5 * (2 * b[j] + (-a[j] + c[j]) * t + (2 * a[j] - 5 * b[j] + 4 * c[j] - d2[j]) * t2 + (-a[j] + 3 * b[j] - 3 * c[j] + d2[j]) * t3);
          out.push(q); }
      }
      out.push(p[p.length - 1]); return out;
    }
    function stave(way, lines, gap, notes, speed) {
      var c = spline(way, 7), L = measure(c), nrm = [], i, a, b, l;
      for (i = 0; i < c.length; i++) { a = c[Math.max(0, i - 1)]; b = c[Math.min(c.length - 1, i + 1)]; l = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1; nrm.push([-(b[1] - a[1]) / l, (b[0] - a[0]) / l]); }
      return { c: c, L: L, n: nrm, lines: lines, gap: gap, notes: notes, speed: speed, len: L[L.length - 1] };
    }
    function layout() {
      var hr = hero.getBoundingClientRect(); W = Math.round(hr.width); H = Math.round(hr.height);
      dpr = Math.min(window.devicePixelRatio || 1, 1.5); cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr);
      var T = imgPoint(0.477, 0.078), pr = prog.getBoundingClientRect(), cr = copy.getBoundingClientRect();
      var py = pr.top - hr.top + 30, cl = cr.left - hr.left;
      staves = [];
      if (PHONE.matches) {
        var gx = 7; py = pr.top - hr.top - 9;
        staves.push(stave([T, [T[0] - 60, T[1] - 16], [W * 0.3, 14], [40, 30], [gx + 4, 80], [gx, 180], [gx, py - 80], [gx + 6, py - 16], [36, py], [W * 0.5, py], [W + 20, py]], 3, 3, 5, 46));
      } else {
        var g = Math.max(22, cl - 34);
        staves.push(stave([T, [T[0] - 130, T[1] - 30], [W * 0.38, 20], [g + 110, 22], [g + 22, 50], [g, 140], [g, py - 150], [g + 16, py - 46], [g + 86, py], [W * 0.5, py], [W + 40, py]], 5, 6, 9, 62));
      }
    }
    function frame(now) {
      raf = 0; if (!t0) t0 = now;
      var el = (now - t0) / 1000, p = RM.matches ? 1 : Math.min(1, el / 2.2); p = 1 - Math.pow(1 - p, 3);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.clearRect(0, 0, W, H);
      staves.forEach(function (S) {
        var upto = S.len * p, j, i, o, x, y, half = (S.lines - 1) / 2;
        ctx.lineWidth = 1; ctx.strokeStyle = 'rgba(255,79,61,.62)';
        for (j = 0; j < S.lines; j++) {
          o = (j - half) * S.gap; ctx.beginPath();
          for (i = 0; i < S.c.length && S.L[i] <= upto; i++) { x = S.c[i][0] + S.n[i][0] * o; y = S.c[i][1] + S.n[i][1] * o; if (i) ctx.lineTo(x, y); else ctx.moveTo(x, y); }
          ctx.stroke();
        }
        // the notes: direction, travelling from the baton to the works
        for (j = 0; j < S.notes; j++) {
          var d = RM.matches ? (S.len * (j + 0.5) / S.notes) : ((el * S.speed + j * S.len / S.notes) % S.len);
          if (d > upto) continue;
          var q = at(S.c, S.L, d), k = Math.min(S.c.length - 1, Math.round(d / 7)), row = ((j * 2) % S.lines) - half;
          x = q[0] + S.n[k][0] * row * S.gap; y = q[1] + S.n[k][1] * row * S.gap;
          var fade = Math.min(1, d / 60, (S.len - d) / 60);
          ctx.globalAlpha = Math.max(0, fade); ctx.drawImage(spr, x - 14, y - 14);
          ctx.fillStyle = '#f3ead9'; ctx.beginPath(); ctx.ellipse(x, y, S.gap * 0.72 + 1, S.gap * 0.5 + 0.8, -0.4, 0, 6.3); ctx.fill(); ctx.globalAlpha = 1;
        }
      });
      if (!RM.matches && vis && !D.hidden) raf = requestAnimationFrame(frame);
    }
    function kick() { if (!raf) raf = requestAnimationFrame(frame); }
    var rt; function relayout() { clearTimeout(rt); rt = setTimeout(function () { layout(); kick(); }, 120); }
    function start() { layout(); kick(); }
    if (img.complete) start(); else img.addEventListener('load', start);
    if (D.fonts && D.fonts.ready) D.fonts.ready.then(relayout);
    addEventListener('resize', relayout);
    onScreen(hero, function (v) { vis = v; if (v) kick(); });
    D.addEventListener('visibilitychange', function () { if (!D.hidden) kick(); });
    if (RM.addEventListener) RM.addEventListener('change', kick);
  })();

  /* ---------- 2. the orchestra ---------- */
  var ICON = {
    fork: 'M8 4.5v5c0 3.2 4 3 4 6.5v3.5M16 4.5v5c0 3.2-4 3-4 6.5',
    pen: 'M5 19l1.2-4.2L16 5l3 3-9.8 9.8zM14 7l3 3',
    film: 'M4.5 6.5h15v11h-15zM10 9.6v4.8l4.4-2.4z',
    tape: 'M4 7h16v10H4zM9 13.4a1.6 1.6 0 1 0 0-3.2 1.6 1.6 0 0 0 0 3.2zM15 13.4a1.6 1.6 0 1 0 0-3.2 1.6 1.6 0 0 0 0 3.2z',
    cards: 'M5 9.2l8.6-2.8 3.6 10.4-8.6 2.8zM9.6 12.6l4-1.3',
    code: 'M9 8l-4 4 4 4M15 8l4 4-4 4',
    tag: 'M4.5 5h7l8 8-7 7-8-8zM8.4 9h.1',
    box: 'M12 4v9M8.5 9.5L12 13l3.5-3.5M5 15.5V19h14v-3.5'
  };
  var VERB = {
    Play: 'M8 5v14l11-7z', Watch: 'M8 5v14l11-7z', Studio: 'M8 5v14l11-7z',
    Download: 'M12 3v11.2l3.6-3.6 1.4 1.4-6 6-6-6 1.4-1.4 3.6 3.6V3h2zM5 19h14v2H5z',
    Listen: 'M12 3a8 8 0 0 0-8 8v6a3 3 0 0 0 3 3h2v-7H6v-2a6 6 0 0 1 12 0v2h-3v7h2a3 3 0 0 0 3-3v-6a8 8 0 0 0-8-8z',
    Read: 'M5 4h10l4 4v12H5zM14 4v5h5M8 13h8M8 16.5h6'
  };

  function atlas(data) {
    var svg = byId('fan'), stage = byId('stage'), note = byId('note'), cv = byId('pulse');
    if (!svg || !stage || !note) return;
    var N = {}, E = {}; data.nodes.forEach(function (n) { N[n.id] = n; }); data.edges.forEach(function (e) { E[e.id] = e; });
    var works = data.nodes.filter(function (n) { return n.ring === 'work'; }), seats = data.nodes.filter(function (n) { return n.ring === 'seat'; });
    var R = { desk0: 92, desk1: 166, work0: 186, work1: 410, seat: 508, seatR: 27 }, GAP = 1.5;
    var geo, ang = {}, els = {}, lineEls = {}, rays = {}, tracks = [], sel = { type: 'home' }, batonA = 62, batonTo = 62, baton, batonTip;
    var peek = null, ctx = cv && cv.getContext ? cv.getContext('2d') : null, cw = 0, chh = 0, dpr = 1, raf = 0, vis = false, wantReveal = false, first = true;
    var SPR = { direction: glow('255,79,61', 16), music: glow('255,179,71', 16), family: glow('243,234,217', 16), page: glow('181,168,154', 16) };

    function P(r, a) { var t = a * Math.PI / 180; return [r * geo.kx * Math.cos(t), -r * geo.ky * Math.sin(t)]; }
    function f(n) { return Math.round(n * 10) / 10; }
    function arc(r, a0, a1) { var p = P(r, a0), q = P(r, a1); return 'M' + f(p[0]) + ' ' + f(p[1]) + 'A' + f(r * geo.kx) + ' ' + f(r * geo.ky) + ' 0 0 ' + (a0 > a1 ? 1 : 0) + ' ' + f(q[0]) + ' ' + f(q[1]); }
    function sector(r0, r1, a0, a1) { var q = P(r0, a1), z = P(r0, a0); return arc(r1, a0, a1) + 'L' + f(q[0]) + ' ' + f(q[1]) + 'A' + f(r0 * geo.kx) + ' ' + f(r0 * geo.ky) + ' 0 0 0 ' + f(z[0]) + ' ' + f(z[1]) + 'Z'; }
    function box(r0, r1, a0, a1) { var xs = [], ys = [], a, p, i; for (i = 0; i <= 12; i++) { a = a0 + (a1 - a0) * i / 12; p = P(r0, a); xs.push(p[0]); ys.push(p[1]); p = P(r1, a); xs.push(p[0]); ys.push(p[1]); } var x = Math.min.apply(0, xs), y = Math.min.apply(0, ys); return { x: f(x), y: f(y), w: f(Math.max.apply(0, xs) - x), h: f(Math.max.apply(0, ys) - y) }; }
    function polar(r, a0, a1, lift) { var pts = [], i, t; for (i = 0; i <= 28; i++) { t = i / 28; pts.push(P(r + lift * Math.sin(Math.PI * t), a0 + (a1 - a0) * t)); } return pts; }
    function poly(pts) { return 'M' + pts.map(function (p) { return f(p[0]) + ' ' + f(p[1]); }).join('L'); }
    function dir(a) { var p = P(1, a), l = Math.hypot(p[0], p[1]) || 1; return [p[0] / l, p[1] / l]; }

    function angles() {
      var cur = 180;
      works.forEach(function (w) { ang[w.id] = { a0: cur - GAP / 2, a1: cur - w.span + GAP / 2, mid: cur - w.span / 2 }; cur -= w.span; });
      works.forEach(function (w) {
        var kids = seats.filter(function (x) { return x.parent === w.id; }), plain = kids.filter(function (x) { return !x.also; }), shared = kids.filter(function (x) { return x.also; });
        var a = ang[w.id], span = (a.a0 - a.a1) * (shared.length ? 0.62 : 1);
        plain.forEach(function (k, i) { ang[k.id] = { mid: a.a0 - span * (i + 0.5) / plain.length }; });
        shared.forEach(function (k) { ang[k.id] = { mid: a.a1 - GAP / 2 }; });
      });
      ang.studio = { mid: 90 }; ang.owner = { mid: 90 };
    }

    function build() {
      geo = PHONE.matches ? { phone: true, vb: [-195, -396, 390, 464], kx: 0.45, ky: 0.82, pod: 36, lblR: 336, stick: 20 }
                          : { phone: false, vb: [-652, -580, 1218, 680], kx: 1, ky: 1, pod: 60, lblR: 352, stick: 44 };
      stage.style.aspectRatio = geo.vb[2] + ' / ' + geo.vb[3];
      svg.setAttribute('viewBox', geo.vb.join(' '));
      while (svg.firstChild) svg.removeChild(svg.firstChild);
      els = {}; lineEls = {}; rays = {}; tracks = [];
      angles();
      var defs = s('defs'), gRows = s('g'), gRays = s('g'), gWorks = s('g'), gDesk = s('g'), gEdges = s('g'), gSeats = s('g'), gPod = s('g'), gBaton = s('g');
      defs.appendChild(s('radialGradient', { id: 'g-desk', cx: 0, cy: 0, r: R.desk1 * Math.max(geo.kx, geo.ky), gradientUnits: 'userSpaceOnUse' }, [s('stop', { offset: 0.5, 'stop-color': '#ffcf7a' }), s('stop', { offset: 0.82, 'stop-color': '#ffb347' }), s('stop', { offset: 1, 'stop-color': '#e98a1f' })]));
      defs.appendChild(s('radialGradient', { id: 'g-never', cx: 0, cy: 0, r: R.work1 * Math.max(geo.kx, geo.ky), gradientUnits: 'userSpaceOnUse' }, [s('stop', { offset: 0.45, 'stop-color': '#120f1c' }), s('stop', { offset: 0.8, 'stop-color': '#2b2140' }), s('stop', { offset: 1, 'stop-color': '#3b2d5a' })]));
      defs.appendChild(s('clipPath', { id: 'c-pod' }, [s('circle', { cx: 0, cy: 0, r: geo.pod })]));
      svg.appendChild(defs);
      // the back rows: a curved five-line stave that the offshoots sit on like notes
      for (var q = 0; q < 5; q++) gRows.appendChild(s('path', { d: arc(R.work1 + 18 + q * 11, 180, 0), 'class': 'row' }));

      // the works: six wedges of real art
      works.forEach(function (w, i) {
        var a = ang[w.id], d = sector(R.work0, R.work1, a.a0, a.a1), bb = box(R.work0, R.work1, a.a0, a.a1), c = P(geo.lblR, a.mid);
        defs.appendChild(s('clipPath', { id: 'c-' + w.id }, [s('path', { d: d })]));
        var g = s('a', { href: '#/' + w.id, 'class': 'node seated', 'data-id': w.id, 'aria-label': w.name + ': ' + w.tag, style: '--acc:' + w.accent + ';--i:' + (i + 2) });
        if (w.wedge) g.appendChild(s('image', { href: w.wedge, x: bb.x, y: bb.y, width: bb.w, height: bb.h, preserveAspectRatio: 'xMidYMid slice', 'clip-path': 'url(#c-' + w.id + ')' }));
        else { g.appendChild(s('path', { d: d, fill: 'url(#g-never)' })); var ip = P((R.work0 + R.work1) / 2 - 40, a.mid); g.appendChild(s('text', { x: f(ip[0]), y: f(ip[1] + (geo.phone ? 14 : 30)), 'text-anchor': 'middle', 'class': 'inf', text: '∞' })); }
        g.appendChild(s('path', { d: d, 'class': 'scrim', fill: '#0b0809' }));
        g.appendChild(s('path', { d: arc(R.work1, a.a0, a.a1), 'class': 'rim' }));
        var words = w.short.split(' '), lines = (words.length > 1 && (geo.phone || w.short.length > 11)) ? [words[0], words.slice(1).join(' ')] : [w.short], lh = geo.phone ? 15 : 28;
        lines.forEach(function (t, k) { g.appendChild(s('text', { x: f(c[0]), y: f(c[1] + (k - (lines.length - 1) / 2) * lh + lh * 0.34), 'text-anchor': 'middle', 'class': 'lbl', text: t })); });
        g.appendChild(s('path', { d: d, 'class': 'hit' }));
        var u = dir(a.mid); g._lift = 'translate(' + f(u[0] * (geo.phone ? 6 : 12)) + 'px,' + f(u[1] * (geo.phone ? 6 : 12)) + 'px)';
        gWorks.appendChild(g); els[w.id] = g;
        // its ray: direction, from the podium through the first desk
        var p0 = [u[0] * (geo.pod + 4), u[1] * (geo.pod + 4)], p1 = P(R.work0 - 3, a.mid);
        var ray = s('path', { d: poly([p0, p1]), 'class': 'edge direction' }); gRays.appendChild(ray); rays[w.id] = ray;
        tracks.push({ id: 'studio--' + w.id, kind: 'direction', pts: [p0, p1], ray: true });
      });

      // the first desk: The Studio
      var st = N.studio, dd = sector(R.desk0, R.desk1, 180, 0), tr = (R.desk0 + R.desk1) / 2 - (geo.phone ? 11 : 15);
      defs.appendChild(s('path', { id: 'p-desk', d: arc(tr, 172, 8) }));
      var dg = s('a', { href: '#/studio', 'class': 'node seated', 'data-id': 'studio', 'aria-label': st.name + ': ' + st.tag, style: '--acc:#fff3d6;--i:1' });
      dg.appendChild(s('path', { d: dd, fill: 'url(#g-desk)', 'class': 'desk-fill' }));
      dg.appendChild(s('path', { d: arc(R.desk1, 180, 0), 'class': 'rim' }));
      dg.appendChild(s('text', { 'class': 'desk-t' }, [s('textPath', { href: '#p-desk', startOffset: '50%', 'text-anchor': 'middle', text: 'The Studio' })]));
      dg.appendChild(s('path', { d: dd, 'class': 'hit' }));
      gDesk.appendChild(dg); els.studio = dg;

      // the offshoots: seats behind their parent (desktop and tablet; on a phone they live in the programme note)
      if (!geo.phone) seats.forEach(function (n, i) {
        var a = ang[n.id].mid, c = P(R.seat, a);
        var g = s('a', { href: '#/' + n.id, 'class': 'node seated', 'data-id': n.id, 'aria-label': n.name + ': ' + n.tag, style: '--acc:' + (N[n.parent].accent || '#b5a89a') + ';--i:' + (i + 8) });
        g.appendChild(s('circle', { cx: f(c[0]), cy: f(c[1]), r: R.seatR, 'class': 'seat-c' }));
        g.appendChild(s('path', { d: ICON[n.icon] || ICON.tag, 'class': 'seat-i', transform: 'translate(' + f(c[0] - 18) + ' ' + f(c[1] - 18) + ') scale(1.5)' }));
        var flank = Math.cos(a * Math.PI / 180) < -0.75;
        g.appendChild(s('text', flank ? { x: f(c[0] - R.seatR - 10), y: f(c[1] + 7), 'text-anchor': 'end', 'class': 'slbl', text: n.short } : { x: f(c[0]), y: f(c[1] - R.seatR - 10), 'text-anchor': 'middle', 'class': 'slbl', text: n.short }));
        g.appendChild(s('circle', { cx: f(c[0]), cy: f(c[1]), r: R.seatR + 14, 'class': 'hit' }));
        gSeats.appendChild(g); els[n.id] = g;
      });

      // the lines: slurs between works, stems to seats; each one is a sourced edge
      var slots = {}; // spread several slurs along one wedge's rim
      data.edges.forEach(function (e) { if (e.kind === 'direction') return; [e.from, e.to].forEach(function (id) { if (N[id].ring === 'work' && N[e.from].ring === 'work' && N[e.to].ring === 'work') (slots[id] = slots[id] || []).push(e); }); });
      Object.keys(slots).forEach(function (id) { slots[id].sort(function (x, y) { var ox = x.from === id ? x.to : x.from, oy = y.from === id ? y.to : y.from; return ang[oy].mid - ang[ox].mid; }); });
      function rimAngle(id, e) { var L = slots[id], a = ang[id], i = L.indexOf(e), w = (a.a0 - a.a1) * 0.56; return L.length < 2 ? a.mid : a.mid + w / 2 - w * i / (L.length - 1); }
      data.edges.forEach(function (e) {
        if (e.kind === 'direction') return;
        var A = N[e.from], B = N[e.to], pts, a0, a1;
        var crescent = null;
        if (A.ring === 'work' && B.ring === 'work') { a0 = rimAngle(A.id, e); a1 = rimAngle(B.id, e); var lift = Math.min(58, 24 + Math.abs(a0 - a1) * 0.6); pts = polar(R.work1 + 8, a0, a1, lift); crescent = poly(polar(R.work1 + 8, a0, a1, lift + 4.5)) + 'L' + polar(R.work1 + 8, a0, a1, lift - 4.5).reverse().map(function (p) { return f(p[0]) + ' ' + f(p[1]); }).join('L') + 'Z'; }
        else if (geo.phone) return;
        else if (A.ring === 'seat' && B.ring === 'seat') { a0 = ang[A.id].mid; a1 = ang[B.id].mid; var pad = (a0 > a1 ? -1 : 1) * 3.4; pts = polar(R.seat + 4, a0 + pad, a1 - pad, 20); }
        else { var seat = A.ring === 'seat' ? A : B, work = A.ring === 'seat' ? B : A, sa = ang[seat.id].mid, wa = Math.max(ang[work.id].a1 + 2, Math.min(ang[work.id].a0 - 2, sa)); pts = [P(R.work1 + 4, wa), P(R.seat - R.seatR - 3, sa)]; if (A.ring === 'seat') pts.reverse(); }
        var g = s('a', { href: '#/line/' + e.id, 'class': 'line k-' + e.kind, 'data-id': e.id, tabindex: -1, 'aria-label': A.name + ' ' + e.label + ' ' + B.name });
        g.appendChild(crescent ? s('path', { d: crescent, 'class': 'slur' }) : s('path', { d: poly(pts), 'class': 'edge ' + e.kind }));
        if (e.kind === 'music') [pts[0], pts[pts.length - 1]].forEach(function (p) { g.appendChild(s('circle', { cx: f(p[0]), cy: f(p[1]), r: geo.phone ? 3 : 4.5, 'class': 'dot' })); });
        g.appendChild(s('path', { d: poly(pts), 'class': 'ehit' }));
        gEdges.appendChild(g); lineEls[e.id] = g;
        tracks.push({ id: e.id, kind: e.kind, pts: pts });
      });

      // the podium: one human, and the baton that points at whatever you pick
      var pg = s('a', { href: '#/owner', 'class': 'node', 'data-id': 'owner', 'aria-label': N.owner.name + ': ' + N.owner.tag });
      pg.appendChild(s('circle', { cx: 0, cy: 0, r: geo.pod + 7, fill: '#0b0809' }));
      pg.appendChild(s('image', { 'class': 'pod-img', href: 'img/atlas/conductor-240.webp', x: -geo.pod, y: -geo.pod, width: geo.pod * 2, height: geo.pod * 2, 'clip-path': 'url(#c-pod)', preserveAspectRatio: 'xMidYMid slice' }));
      pg.appendChild(s('circle', { cx: 0, cy: 0, r: geo.pod, 'class': 'pod-ring' }));
      pg.appendChild(s('text', { x: 0, y: geo.pod + (geo.phone ? 20 : 27), 'text-anchor': 'middle', 'class': 'pod-t', text: 'The owner' }));
      pg.appendChild(s('circle', { cx: 0, cy: 0, r: geo.pod + 6, 'class': 'hit' }));
      gPod.appendChild(pg); els.owner = pg;
      baton = s('line', { 'class': 'baton' }); batonTip = s('circle', { r: geo.phone ? 3 : 4.5, 'class': 'baton-tip' });
      gBaton.appendChild(baton); gBaton.appendChild(batonTip);
      // document order is also keyboard order: podium, first desk, works, lines, seats
      [gRows, gRays, gPod, gDesk, gWorks, gEdges, gSeats, gBaton].forEach(function (g) { svg.appendChild(g); });
      tracks.forEach(function (t) { t.L = measure(t.pts); t.len = t.L[t.L.length - 1]; });
      setBaton(batonA); sizeCanvas(); mark();
    }

    function setBaton(a) { var u = dir(a), r0 = geo.pod + 5, r1 = geo.pod + 5 + geo.stick; baton.setAttribute('x1', f(u[0] * r0)); baton.setAttribute('y1', f(u[1] * r0)); baton.setAttribute('x2', f(u[0] * r1)); baton.setAttribute('y2', f(u[1] * r1)); batonTip.setAttribute('cx', f(u[0] * r1)); batonTip.setAttribute('cy', f(u[1] * r1)); }

    /* who is lit: the selection (or whatever the pointer rests on) and everything one line away from it */
    function related(c) {
      var on = {}, lines = {};
      if (c.type === 'node') { on[c.id] = 1; data.edges.forEach(function (e) { if (e.from === c.id || e.to === c.id) { on[e.from] = on[e.to] = 1; lines[e.id] = 1; } }); var n = N[c.id]; if (n.parent) on[n.parent] = 1; if (n.also) on[n.also] = 1; }
      else if (c.type === 'edge') { var e = E[c.id]; on[e.from] = on[e.to] = 1; lines[e.id] = 1; }
      return { on: on, lines: lines };
    }
    function mark() {
      var c = peek || sel, home = c.type === 'home', rel = related(c), id;
      svg.classList.toggle('has-sel', !home);
      for (id in els) { var isSel = sel.type === 'node' && sel.id === id; els[id].classList.toggle('off', !home && !rel.on[id]); els[id].classList.toggle('on', isSel); els[id].style.transform = (isSel && els[id]._lift) || ''; if (isSel) els[id].setAttribute('aria-current', 'true'); else els[id].removeAttribute('aria-current'); }
      for (id in lineEls) { lineEls[id].classList.toggle('off', !home && !rel.lines[id]); lineEls[id].classList.toggle('on', !home && !!rel.lines[id]); }
      for (id in rays) { var lit = home || rel.lines['studio--' + id] || (c.type === 'node' && c.id === 'owner'); rays[id].style.opacity = lit ? '' : '.12'; }
      tracks.forEach(function (t) { t.live = home ? !!t.ray : (!!rel.lines[t.id] || (t.ray && c.type === 'node' && c.id === 'owner')); });
      var target = 62; if (c.type === 'node') target = ang[c.id].mid; else if (c.type === 'edge') target = (E[c.id].kind === 'direction' && E[c.id].from === 'owner') ? 90 : ang[E[c.id].to].mid;
      batonTo = target; if (RM.matches) { batonA = target; setBaton(target); }
      kick();
    }
    /* pointing is conducting: resting the pointer on a seat or a line swings the baton there and lights its lines */
    function peekOn(ev) { var a = ev.target.closest && ev.target.closest('a[data-id]'); if (!a || !svg.contains(a)) return; var id = a.getAttribute('data-id'), p = a.classList.contains('line') ? { type: 'edge', id: id } : { type: 'node', id: id }; if (peek && peek.id === p.id) return; peek = p; mark(); }
    function peekOff() { if (peek) { peek = null; mark(); } }
    if (matchMedia('(hover: hover)').matches) { svg.addEventListener('mouseover', peekOn); svg.addEventListener('mouseleave', peekOff); }
    svg.addEventListener('focusin', peekOn); svg.addEventListener('focusout', peekOff);

    /* the pulses: small lights that travel each live line in the direction the fact runs */
    function sizeCanvas() { if (!ctx) return; dpr = Math.min(window.devicePixelRatio || 1, 1.5); cw = stage.clientWidth; chh = stage.clientHeight; cv.width = Math.round(cw * dpr); cv.height = Math.round(chh * dpr); }
    function frame(now) {
      raf = 0; var moving = Math.abs(batonTo - batonA) > 0.2;
      if (moving) { batonA += (batonTo - batonA) * 0.16; setBaton(batonA); } else if (batonA !== batonTo) { batonA = batonTo; setBaton(batonA); }
      if (ctx) {
        var k = cw / geo.vb[2], home = (peek || sel).type === 'home', t = now / 1000, sz = geo.phone ? 9 : 13;
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.clearRect(0, 0, cw, chh);
        if (!RM.matches) { ctx.globalCompositeOperation = 'lighter';
          tracks.forEach(function (tr, i) {
            if (!tr.live) return;
            var n = tr.ray ? 1 : 2, speed = tr.ray ? (home ? 44 : 90) : 120, j, d, p, fade;
            for (j = 0; j < n; j++) { d = (t * speed + i * 53 + j * tr.len / n) % (tr.len + 40); if (d > tr.len) continue; p = at(tr.pts, tr.L, d); fade = Math.min(1, d / 14, (tr.len - d) / 14); ctx.globalAlpha = Math.max(0, fade) * (home ? 0.8 : 1); ctx.drawImage(SPR[tr.kind], (p[0] - geo.vb[0]) * k - sz, (p[1] - geo.vb[1]) * k - sz, sz * 2, sz * 2); }
          });
          ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over'; }
      }
      if ((moving || (!RM.matches && vis)) && !D.hidden) raf = requestAnimationFrame(frame);
    }
    function kick() { if (!raf) raf = requestAnimationFrame(frame); }

    /* ---- the programme note ---- */
    function icon(verb) { return s('svg', { viewBox: '0 0 24 24', 'aria-hidden': 'true' }, [s('path', verb === 'Read' ? { d: VERB.Read, fill: 'none', stroke: 'currentColor', 'stroke-width': 1.8, 'stroke-linejoin': 'round' } : { d: VERB[verb] || VERB.Play, fill: 'currentColor' })]); }
    function act(a, primary) { return h('a', { 'class': 'btn' + (primary ? ' p' : ''), href: a.href }, [icon(a.verb), h('span', {}, [a.label, a.sub ? h('small', { text: a.sub }) : null])]); }
    function lineRow(e, me) { var other = me ? N[e.from === me ? e.to : e.from] : null; return h('li', { 'class': 'k-' + e.kind }, [h('a', { href: '#/line/' + e.id }, [h('i'), h('span', {}, me ? [(e.from === me ? e.label + ' ' : ''), h('b', { text: other.name }), (e.from === me ? '' : ' ' + e.label + ' this')] : [h('b', { text: N[e.from].short }), ' ' + e.label + ' ', h('b', { text: N[e.to].name })]), h('span', { 'class': 'go', 'aria-hidden': 'true', text: '→' })])]); }
    function src(o, word) { return h('p', { 'class': 'src' }, [(word || 'Source') + ': ', h('a', { href: o.url, text: o.label })]); }
    function back() { return h('a', { 'class': 'back', href: '#/' }, [h('span', { 'aria-hidden': 'true', text: '←' }), 'The whole orchestra']); }

    function render() {
      var kids = [], n, e, acc = '#ff4f3d';
      if (sel.type === 'node') {
        n = N[sel.id]; acc = n.accent || (n.parent && N[n.parent].accent) || acc;
        kids.push(h('p', { 'class': 'kick', text: n.tag }), h('h3', { tabindex: -1, text: n.name }));
        if (n.art) kids.push(h('div', { 'class': 'art' }, [h('img', { src: n.art, alt: '', width: n.artW, height: n.artH })]));
        kids.push(h('p', { 'class': 'blurb', text: n.blurb }));
        if (n.facts) kids.push(h('ul', { 'class': 'facts' }, n.facts.map(function (x) { return h('li', { text: x }); })));
        if (n.note) kids.push(h('p', { 'class': 'aside', text: n.note }));
        kids.push(h('div', { 'class': 'acts' }, n.actions.map(function (a) { return act(a, a.primary); })));
        var offs = seats.filter(function (k) { return k.parent === n.id || k.also === n.id; });
        if (offs.length) kids.push(h('h4', { text: 'Its offshoots' }), h('ul', { 'class': 'offs' }, offs.map(function (k) {
          return h('li', {}, [h('a', { 'class': 'off-a', href: '#/' + k.id }, [h('b', { text: k.name }), h('small', { text: k.tag })])].concat(k.actions.map(function (a, i) { return h('a', { 'class': 'btn mini', href: a.href, 'aria-label': a.label, text: i ? 'Feed' : a.verb }); })));
        })));
        (n.quotes || []).forEach(function (q) { kids.push(h('p', { 'class': 'quote' }, [h('q', { text: q.text }), h('br'), h('a', { href: q.url, text: q.label })])); });
        var mine = data.edges.filter(function (x) { return x.from === n.id || x.to === n.id; });
        if (mine.length) kids.push(h('h4', { text: 'Its lines' }), h('ul', { 'class': 'lines' }, mine.map(function (x) { return lineRow(x, n.id); })));
        kids.push(src(n.source), back());
      } else if (sel.type === 'edge') {
        e = E[sel.id]; var A = N[e.from], B = N[e.to]; acc = e.kind === 'music' ? '#ffb347' : e.kind === 'direction' ? '#ff4f3d' : (B.accent || A.accent || '#f3ead9');
        kids.push(h('p', { 'class': 'kick', text: data.kinds[e.kind].label + ' · a sourced line' }), h('h3', { tabindex: -1 }, [A.name, h('em', { text: e.label }), B.name]));
        kids.push(h('p', { 'class': 'statement', text: e.statement }), src(e.source, 'Says who'));
        kids.push(h('div', { 'class': 'ends' }, [A, B].map(function (x) { return h('div', { 'class': 'end' }, [h('b', { text: x.name }), h('small', { text: x.tag }), h('div', { 'class': 'acts' }, [act(x.actions[0], true), h('a', { 'class': 'btn', href: '#/' + x.id }, [h('span', {}, ['More about ' + x.name])])])]); })));
        kids.push(back());
      } else {
        kids.push(h('p', { 'class': 'kick', text: 'Programme note' }), h('h3', { tabindex: -1, text: 'Reading the fan' }));
        kids.push(h('p', { 'class': 'how', text: 'The owner stands at the podium. The first desk is The Studio: the fleet, live. Behind it sit the six works, and behind those their offshoots.' }));
        kids.push(h('p', { 'class': 'how' }, [h('b', { text: 'Pick a seat' }), ' for what it is and where to go. ', h('b', { text: 'Pick a line' }), ' for what connects two things, and who says so.']));
        kids.push(h('div', { 'class': 'acts' }, [act(N.studio.actions[0], true)]));
        kids.push(h('h4', { text: 'Lines worth following' }), h('ul', { 'class': 'lines' }, data.edges.filter(function (x) { return x.kind === 'music' || x.kind === 'family'; }).map(function (x) { return lineRow(x); })));
        kids.push(h('p', { 'class': 'src' }, ['All ' + data.edges.length + ' connections, each with its source, are in ', h('a', { href: '#lines', text: 'the index' }), '.']));
      }
      while (note.firstChild) note.removeChild(note.firstChild);
      kids.forEach(function (k) { note.appendChild(k); });
      note.classList.remove('turn'); void note.offsetWidth; note.classList.add('turn');
      note.style.setProperty('--acc', acc);
      D.title = (sel.type === 'node' ? N[sel.id].name + ' · ' : sel.type === 'edge' ? N[E[sel.id].from].name + ' → ' + N[E[sel.id].to].name + ' · ' : '') + 'advanced studios';
    }

    /* ---- routes: #/ is the whole fan, #/greytide a seat, #/line/a--b a line. Back is the browser's own. ---- */
    function parse() {
      var hsh = location.hash, p; if (hsh.indexOf('#/') !== 0) return null;
      try { p = decodeURIComponent(hsh.slice(2)); } catch (x) { p = ''; }
      if (p.indexOf('line/') === 0 && E[p.slice(5)]) return { type: 'edge', id: p.slice(5) };
      if (N[p]) return { type: 'node', id: p };
      return { type: 'home' };
    }
    function reveal(instant) { // bring the fan (with its heading whenever both fit, phone included) clear of the sticky bar
      var bar = parseFloat(getComputedStyle(root).getPropertyValue('--bar')) || 56, a = byId('atlas').getBoundingClientRect(), hd = byId('explore').querySelector('.head').getBoundingClientRect(), st = stage.getBoundingClientRect();
      var wide = !PHONE.matches && innerWidth > 1180, nt = note.getBoundingClientRect().top, withHead = wide ? (st.bottom - hd.top) <= innerHeight - bar - 20 : (nt - hd.top + 96) <= innerHeight - bar - 12; // stacked layouts keep the note's title on screen too
      if (wide && st.top >= bar + 4 && st.bottom <= innerHeight) return;
      var off = withHead ? hd.top - bar - (PHONE.matches ? 12 : 18) : a.top - bar - 10;
      if (Math.abs(off) > 6) scrollTo({ top: scrollY + off, behavior: (instant === true || RM.matches) ? 'instant' : 'smooth' });
    }
    function go(r, user) {
      sel = r; peek = null; mark(); render();
      if (user) { reveal(); var t = note.querySelector('h3'); if (t) try { t.focus({ preventScroll: true }); } catch (x) {} }
    }
    addEventListener('hashchange', function () { var r = parse(); if (!r) { if (!location.hash && sel.type !== 'home') go({ type: 'home' }, false); wantReveal = false; return; } go(r, wantReveal); wantReveal = false; });
    D.addEventListener('click', function (ev) { var a = ev.target.closest && ev.target.closest('a[href^="#/"]'); if (a) wantReveal = true; }, true);
    D.addEventListener('keydown', function (ev) { if (ev.key === 'Escape' && sel.type !== 'home' && byId('atlas').contains(D.activeElement)) { wantReveal = true; location.hash = '#/'; } });
    D.querySelectorAll('a[data-go]').forEach(function (a) { a.setAttribute('href', '#/' + a.getAttribute('data-go')); });

    build();
    var r0 = parse(); sel = r0 || { type: 'home' }; mark(); render();
    if (r0 && r0.type !== 'home') { // a deep link: land on the view at once, and once more when late fonts and pictures have settled, unless the visitor has moved
      var moved = false, land = function () { if (!moved) reveal(true); };
      ['wheel', 'touchstart', 'keydown', 'mousedown'].forEach(function (t) { addEventListener(t, function () { moved = true; }, { once: true, passive: true }); });
      setTimeout(land, 60); addEventListener('load', function () { setTimeout(land, 80); }); if (D.fonts && D.fonts.ready) D.fonts.ready.then(function () { setTimeout(land, 80); });
    }
    if (RM.matches || !('IntersectionObserver' in window)) svg.classList.add('in');
    onScreen(stage, function (v) { vis = v; if (v) { svg.classList.add('in'); kick(); } });
    D.addEventListener('visibilitychange', function () { if (!D.hidden) kick(); });
    var wasPhone = PHONE.matches, rt;
    addEventListener('resize', function () { clearTimeout(rt); rt = setTimeout(function () { if (PHONE.matches !== wasPhone) { wasPhone = PHONE.matches; build(); } else sizeCanvas(); kick(); }, 150); });
  }

  if (byId('fan')) {
    fetch('data/atlas.json').then(function (r) { if (!r.ok) throw new Error(r.status); return r.json(); }).then(atlas).catch(function () { root.classList.add('atlas-failed'); });
  }
})();
