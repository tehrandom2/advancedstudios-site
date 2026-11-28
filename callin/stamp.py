#!/usr/bin/env python3
"""stamp.py: version the call-in files. One hash over everything the panel loads goes into ?v= on the pages, and
callin.js passes the same ?v= to the worklet, the encoder, dsp.js and the greeting, so a new page never runs a cached
old file (the edge caches each file on its own clock). Run after any change under callin/."""
import hashlib, os, re
ROOT = os.path.dirname(os.path.dirname(os.path.realpath(__file__)))
FILES = ['callin.js', 'callin.css', 'capture.js', 'encoder.js', 'dsp.js', 'greeting.mp3', 'vendor/lamejs-1.2.1/lame.min.js']
h = hashlib.sha256()
for f in FILES:
    h.update(open(os.path.join(ROOT, 'callin', f), 'rb').read())
v = h.hexdigest()[:10]
for page in ['index.html', 'music-videos/index.html']:
    p = os.path.join(ROOT, page); s = open(p).read()
    n = re.sub(r'(/callin/callin\.(?:js|css))\?v=[0-9a-z]+', r'\1?v=' + v, s)
    if n != s:
        open(p, 'w').write(n)
print(v)
