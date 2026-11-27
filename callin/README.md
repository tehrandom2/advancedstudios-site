# Call in: the voicemail button

A "Call in" button on the home page and /music-videos/. A tap asks for the microphone at once (getUserMedia straight
from the tap, for iOS Safari). Only once it is granted does the greeting play, then a beep, then up to 60 s of
recording with a timer, Stop, Listen back, Re-record and Send. Nothing runs on page load except showing the button.

All audio work happens in the caller's browser:

- `capture.js`: an AudioWorklet that records the mic, mixed to mono (no MediaRecorder).
- `dsp.js`: resample to 24 kHz, high-pass at 80 Hz (24 dB/oct), trim the quiet at both ends (the threshold follows the
  room and the voice), loudness to about -16 LUFS (BS.1770, gated), and a look-ahead limiter at -2.5 dBFS so the MP3's
  true peak stays under -1 dBTP. The browser's own auto-gain is off, because we normalise ourselves.
- `encoder.js`: a Web Worker that runs dsp.js and encodes MP3, 24 kHz mono at 64 kbps, with the vendored lamejs 1.2.1
  (`vendor/lamejs-1.2.1/`, LGPL-3.0, npm tarball sha256 d8d099ef…c2a2d). Listen back plays these exact bytes, and Send
  posts the same Blob.
- `greeting.mp3`: the prompt, in Winston's voice (chatterbox-turbo on monolith), at -16.8 LUFS and -1.6 dBTP.

Send passes Turnstile and POSTs the MP3 to the Worker in `worker/` (media.advancedstudios.net/callin, one exact route;
workers_dev and preview URLs off). The Worker checks it (every byte must be mono MPEG Layer III frames, at most 640 KB
and 62 s), runs Turnstile siteverify, and the rate gate (a Durable Object: 4 an hour per hashed address, our daily cap,
800 MB stored, 150 transcribed minutes a day). It transcribes with Workers AI (whisper-large-v3-turbo) and stores ONE KV
value per call: the MP3, with {at, secs, page, bytes, transcript} in its metadata. Nothing can be read back over HTTP.

The desk reads the store with `~/Services/music-videos-media/callins` (list, `--play <ref>`, `--done <ref>`,
`--notify --post`, `--stats`). The notice job `callins-notify.timer` (Winston's) posts each new call to Discord within
5 minutes.

## Changing it

- After editing anything here, run `python3 callin/stamp.py`: it versions the pages' `?v=` (callin.js passes the
  same `?v=` on to the files it loads), so the edge never mixes an old file with a new page.
- Worker tests: `cd callin/worker && node --import ./test/register.mjs --test test/` (the Turnstile paths call
  Cloudflare's real siteverify with its documented always-pass and always-fail test secrets).
- Deploy: from `callin/worker`, with the token read through op, never on a command line:
  `op run --env-file=$HOME/Services/music-videos-media/deploy.env -- npx wrangler@4.156.0 deploy`. The Turnstile secret
  goes in by `wrangler secret put TURNSTILE_SECRET` with the value on stdin.
- `SITEKEY` in callin.js is Cloudflare's always-pass test key until our widget exists. While the Worker uses the test
  secret, `DAILY_CAP = "20"` in wrangler.toml keeps the unguarded route small. The variable can only lower the
  200-a-day cap in worker.js.
