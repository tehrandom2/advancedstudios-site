// The Neverending: game flow, narration, conversations, voice in and out.
import { World } from "./world.js";

const $ = (id) => document.getElementById(id);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const store = {
  get(k) { try { return JSON.parse(localStorage.getItem("neverending." + k)); } catch { return null; } },
  set(k, v) { try { localStorage.setItem("neverending." + k, JSON.stringify(v)); } catch { /* private mode */ } },
};

let STORY, MANIFEST = {};
// The public build (advancedstudios.net/story) is static: <body class="web">. Characters answer through the story Worker,
// speech-to-text is the browser's own, and voices for unscripted replies are made in the browser.
const WEB = document.body.classList.contains("web");
const world = new World($("c"));
window.__world = world; // for debugging from the console
const G = {
  sceneIdx: 0, phase: "title", known: new Set(), asked: new Set(), greeted: new Set(), history: {},
  talkingTo: null, hintShown: false, turns: 0, tokens: 0,
};

// ------------------------------------------------------------------ audio

let AC, musicEls = [], musicGains = [], musicCur = 0, voiceEl, voiceGain, analyser, master, levelBuf;
const settings = { music: store.get("music") ?? 0.4, voice: store.get("voice") ?? 1, mode: store.get("mode") ?? "local" };

function initAudio() {
  if (AC) return;
  AC = new (window.AudioContext || window.webkitAudioContext)();
  master = AC.createGain(); master.connect(AC.destination);
  for (let i = 0; i < 2; i++) {
    const el = new Audio(); el.loop = true; el.preload = "auto";
    const src = AC.createMediaElementSource(el), g = AC.createGain(); g.gain.value = 0;
    src.connect(g).connect(master); musicEls.push(el); musicGains.push(g);
  }
  voiceEl = new Audio(); voiceEl.preload = "auto";
  const vs = AC.createMediaElementSource(voiceEl);
  analyser = AC.createAnalyser(); analyser.fftSize = 512; levelBuf = new Uint8Array(analyser.fftSize);
  voiceGain = AC.createGain(); voiceGain.gain.value = settings.voice;
  vs.connect(analyser).connect(voiceGain).connect(master);
}
function musicLevel() { return settings.music * (G.voiceBusy ? 0.45 : 1); }
function playMusic(file) {
  if (!AC) return;
  const next = 1 - musicCur, now = AC.currentTime;
  if (musicEls[musicCur].dataset.file === file) return;
  musicEls[next].src = "music/" + file; musicEls[next].dataset.file = file;
  musicEls[next].play().catch(() => {});
  musicGains[next].gain.cancelScheduledValues(now); musicGains[next].gain.setValueAtTime(0, now); musicGains[next].gain.linearRampToValueAtTime(musicLevel(), now + 3);
  musicGains[musicCur].gain.cancelScheduledValues(now); musicGains[musicCur].gain.setValueAtTime(musicGains[musicCur].gain.value, now); musicGains[musicCur].gain.linearRampToValueAtTime(0, now + 3);
  const old = musicEls[musicCur]; setTimeout(() => { old.pause(); old.dataset.file = ""; }, 3200);
  musicCur = next;
}
function duck() { if (AC) musicGains[musicCur].gain.setTargetAtTime(musicLevel(), AC.currentTime, 0.25); }
function voiceLevel() {
  if (!analyser || voiceEl.paused) return 0;
  analyser.getByteTimeDomainData(levelBuf);
  let s = 0; for (const v of levelBuf) { const d = (v - 128) / 128; s += d * d; }
  return Math.min(1, Math.sqrt(s / levelBuf.length) * 4.5);
}

const VOICE = (who) => STORY.voices[who] || STORY.voices.narrator;
function lineUrl(who, text) {
  const key = VOICE(who) + "|" + text;
  if (MANIFEST[key]) return "audio/" + MANIFEST[key];
  return WEB ? null : "api/tts?" + new URLSearchParams({ voice: VOICE(who), text });
}

let speakCancel = null;
// Speak one line; resolves when it finishes or is skipped. onStart(duration) lets the caption pace itself.
function speak(who, text, url, onStart) {
  stopSpeaking();
  return new Promise((resolve) => {
    let done = false;
    const finish = () => { if (done) return; done = true; G.voiceBusy = false; duck(); G.speaker = null; speakCancel = null; resolve(); };
    speakCancel = () => { voiceEl?.pause(); speechSynthesis?.cancel?.(); finish(); };
    G.speaker = who; G.voiceBusy = true; duck();
    const est = Math.max(2.5, text.length / 15);
    if (settings.mode === "off" || !AC) { onStart?.(est); setTimeout(finish, est * 1000); return; }
    if (settings.mode === "browser") return browserSpeak(who, text, onStart, finish);
    url = url || lineUrl(who, text);
    if (!url) return browserSpeak(who, text, onStart, finish);
    voiceEl.src = url;
    voiceEl.onended = finish;
    voiceEl.onerror = () => { if (!done) browserSpeak(who, text, onStart, finish); };
    voiceEl.onloadedmetadata = () => onStart?.(voiceEl.duration || est);
    voiceEl.play().catch(() => browserSpeak(who, text, onStart, finish));
  });
}
function browserSpeak(who, text, onStart, finish) {
  if (!("speechSynthesis" in window)) { onStart?.(text.length / 15); setTimeout(finish, text.length / 15 * 1000); return; }
  const u = new SpeechSynthesisUtterance(text);
  const voices = speechSynthesis.getVoices().filter((v) => v.lang.startsWith("en"));
  const pick = { narrator: 0, beatrice: 1, zeina: 2, hanako: 3, mortimer: 4, emperor: 5 }[who] || 0;
  if (voices.length) u.voice = voices[pick % voices.length];
  u.pitch = { beatrice: 0.9, zeina: 1.15, mortimer: 1.3, emperor: 0.7, hanako: 1.0 }[who] || 1;
  u.rate = who === "mortimer" ? 1.12 : 0.98;
  u.onend = finish; u.onerror = finish;
  onStart?.(text.length / 14);
  speechSynthesis.speak(u);
}
function stopSpeaking() { speakCancel?.(); }
// A model reply is spoken in two parts (first sentence, then the rest) so the voice starts sooner; the second part is
// synthesised on the server while the first plays.
async function speakReply(who, text) {
  const m = text.match(/^(.{20,}?[.!?])\s+(.+)$/s);
  if (!m || settings.mode !== "local" || WEB) return speak(who, text);
  const u2 = "api/tts?" + new URLSearchParams({ voice: VOICE(who), text: m[2] });
  let cancelled = false;
  const p1 = speak(who, m[1]);
  const prev = speakCancel; speakCancel = () => { cancelled = true; prev?.(); };
  fetch(u2).catch(() => {});
  await p1;
  if (!cancelled && G.talkingTo === who) await speak(who, m[2], u2);
}

// ------------------------------------------------------------------ narration

let advance = null; // resolves the current narration wait
function waitAdvance(ms) {
  return new Promise((r) => { const t = setTimeout(() => { advance = null; r(); }, ms); advance = () => { clearTimeout(t); advance = null; r(); }; });
}
async function narrate(lines) {
  const box = $("narr"); box.classList.remove("hidden");
  for (const ln of lines) {
    const ch = STORY.characters[ln.who];
    box.classList.toggle("char", ln.who !== "narrator");
    $("narrWho").textContent = ln.who === "narrator" ? "" : ch.name;
    $("narrWho").style.color = ln.who === "narrator" ? "" : ch.color;
    const el = $("narrText");
    el.textContent = "";
    let skipped = false, typing = null;
    const reveal = (dur) => {
      const words = ln.text.split(" "); let i = 0; const step = (dur * 1000 * 0.92) / words.length;
      clearInterval(typing);
      typing = setInterval(() => { i++; el.innerHTML = esc(words.slice(0, i).join(" ")) + ' <span class="rest">' + esc(words.slice(i).join(" ")) + "</span>"; if (i >= words.length) clearInterval(typing); }, step);
    };
    if (ln.who !== "narrator" && world.chars[ln.who]) world.setFocus(ln.who); else world.setFocus(null);
    const spoken = speak(ln.who, ln.text, null, reveal);
    const tapped = new Promise((r) => { advance = () => { skipped = true; r(); }; });
    await Promise.race([spoken, tapped]);
    advance = null;
    if (skipped) stopSpeaking();
    clearInterval(typing); el.textContent = ln.text;
    if (!skipped) await waitAdvance(700);
  }
  world.setFocus(null);
  box.classList.add("hidden");
}
function next() { if (advance) advance(); }
$("narr").addEventListener("click", next);
addEventListener("keydown", (e) => {
  if (e.target.tagName === "INPUT" || e.target.tagName === "SELECT") return;
  if (e.code === "Space" || e.code === "Enter") { e.preventDefault(); next(); }
  if (e.code === "Escape") closeTalk();
});
const esc = (s) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

// ------------------------------------------------------------------ scenes

const scene = () => STORY.scenes[G.sceneIdx];

async function runScene(idx, { skipIntro = false } = {}) {
  G.sceneIdx = idx; G.phase = "intro"; G.hintShown = false;
  save();
  const sc = scene();
  closeTalk(); hideDrops();
  $("objective").classList.add("hidden"); $("tags").innerHTML = "";
  world.setScene(sc.set, sc.cast);
  playMusic(sc.music);
  $("cardEp").textContent = `Episode ${STORY.episode} · Scene ${idx + 1} of ${STORY.scenes.length}`;
  $("cardTitle").textContent = sc.title; $("cardTime").textContent = sc.time;
  const card = $("card"); card.classList.remove("hidden"); card.style.animation = "none"; void card.offsetWidth; card.style.animation = "";
  await sleep(2600);
  card.classList.add("hidden");
  if (!skipIntro) await narrate(sc.intro);
  G.phase = "play"; G.lastProgress = Date.now();
  showObjective();
  buildTags();
}

function showObjective() {
  const sc = scene();
  $("objTime").textContent = sc.time;
  $("objText").textContent = sc.objective;
  $("objHint").textContent = sc.hint; $("objHint").classList.toggle("hidden", !G.hintShown);
  $("objPips").innerHTML = sc.requires.map((r) => `<i class="${G.known.has(r) ? "on" : ""}" title="${G.known.has(r) ? esc(STORY.clues[r].title) : "?"}"></i>`).join("");
  const ready = sc.requires.every((r) => G.known.has(r));
  $("btnContinue").classList.toggle("hidden", !ready);
  $("btnContinue").classList.toggle("pulse", ready);
  $("btnContinue").textContent = G.sceneIdx === STORY.scenes.length - 1 ? "Finish the episode ▸" : "The story continues ▸";
  $("objective").classList.remove("hidden");
}

function buildTags() {
  const box = $("tags"); box.innerHTML = "";
  for (const id of world.cast) {
    const ch = STORY.characters[id];
    const t = document.createElement("div");
    t.className = "tag"; t.dataset.id = id;
    t.innerHTML = `<span class="dot" style="background:${ch.color}"></span><b>${ch.name}</b><span class="ask">Ask</span>`;
    t.addEventListener("click", (e) => { e.stopPropagation(); openTalk(id); });
    t.addEventListener("pointerenter", () => world.setHover(id));
    t.addEventListener("pointerleave", () => world.setHover(null));
    box.appendChild(t);
  }
}
world.onFrame = () => {
  // animate the speaking character from the real audio level
  const lvl = G.speaker && G.speaker !== "narrator" ? Math.max(voiceLevel(), settings.mode !== "local" ? 0.3 + Math.random() * 0.3 : 0) : 0;
  world.setTalk(G.speaker, lvl);
  if (G.phase !== "play") return;
  const a = world.anchors();
  for (const t of $("tags").children) {
    const p = a[t.dataset.id]; if (!p) continue;
    t.style.left = p.x + "px"; t.style.top = p.y + "px";
    t.style.display = p.vis && G.talkingTo !== t.dataset.id ? "" : "none";
    t.classList.toggle("hot", world.hover === t.dataset.id);
  }
};

// pick characters in the 3D view
const canvas = $("c");
canvas.addEventListener("pointermove", (e) => {
  if (G.phase !== "play") return;
  const id = world.pick(e.clientX, e.clientY);
  if (id !== world.hover) world.setHover(id);
  canvas.style.cursor = id ? "pointer" : "";
});
canvas.addEventListener("click", (e) => {
  if (G.phase === "intro") return next();
  if (G.phase !== "play") return;
  const id = world.pick(e.clientX, e.clientY);
  if (id) openTalk(id); else if (G.talkingTo) closeTalk();
});

async function continueStory() {
  if (G.phase !== "play") return;
  G.phase = "outro";
  closeTalk(); $("objective").classList.add("hidden"); $("tags").innerHTML = "";
  await narrate(scene().outro);
  if (G.sceneIdx + 1 < STORY.scenes.length) runScene(G.sceneIdx + 1);
  else endEpisode();
}
$("btnContinue").addEventListener("click", continueStory);
$("btnHint").addEventListener("click", () => { G.hintShown = true; showObjective(); });

async function endEpisode() {
  G.phase = "end"; save();
  $("endNext").textContent = STORY.next.title;
  $("endTeaser").textContent = STORY.next.teaser;
  $("endStats").textContent = `You found ${G.known.size} of ${Object.keys(STORY.clues).length} secrets` + (G.turns ? ` and asked ${G.turns} questions of your own.` : ".");
  $("end").classList.remove("hidden");
  playMusic("bastian-calm-7401-loop.ogg");
  await speak("narrator", STORY.next.title + ". " + STORY.next.teaser);
}

// ------------------------------------------------------------------ conversations

function hkey(id) { return scene().id + ":" + id; }
function openTalk(id) {
  if (G.phase !== "play") return;
  const ch = STORY.characters[id];
  const talk = scene().talk[id]; if (!talk) return;
  G.talkingTo = id; G.lastTalked = id; world.setFocus(id); world.setHover(null);
  hideDrops();
  $("talkName").textContent = ch.name; $("talkName").style.color = ch.color;
  $("talkRole").textContent = ch.role || "";
  $("talk").classList.remove("hidden"); document.body.classList.add("talking");
  const log = $("talkLog"); log.innerHTML = "";
  const hist = G.history[hkey(id)] || (G.history[hkey(id)] = []);
  for (const h of hist) addMsg(h.who === "player" ? "me" : "them", h.text, false, h.clue);
  renderChips();
  setStatus("");
  if (!G.greeted.has(hkey(id))) {
    G.greeted.add(hkey(id));
    hist.push({ who: id, text: talk.greeting });
    addMsg("them", talk.greeting);
    speak(id, talk.greeting);
  }
  if (matchMedia("(pointer: fine)").matches) setTimeout(() => $("talkText").focus(), 50);
}
function closeTalk() {
  if (!G.talkingTo) return;
  stopRec(true);
  G.talkingTo = null; $("talk").classList.add("hidden"); document.body.classList.remove("talking"); world.setFocus(null);
  if (G.speaker && G.speaker !== "narrator") stopSpeaking();
}
$("talkClose").addEventListener("click", closeTalk);

function addMsg(kind, text, scroll = true, clue) {
  const d = document.createElement("div");
  d.className = "msg " + kind;
  d.textContent = text;
  if (kind === "them" && text) {
    const b = document.createElement("button"); b.className = "play"; b.textContent = "▶"; b.title = "Hear it again";
    const who = G.talkingTo, url = d.dataset.url;
    b.addEventListener("click", () => speak(who, text, d.dataset.url || null));
    d.appendChild(b);
  }
  $("talkLog").appendChild(d);
  if (clue) addClueMsg(clue);
  if (scroll) $("talkLog").scrollTop = 1e6;
  return d;
}
function addClueMsg(id) {
  const d = document.createElement("div"); d.className = "msg clue"; d.textContent = "Notebook: " + STORY.clues[id].title;
  $("talkLog").appendChild(d);
}
function setStatus(s) { $("talkStatus").textContent = s; }

function chipAvailable(talk, chip, i) {
  const k = hkey(G.talkingTo) + "#" + i;
  if (G.asked.has(k)) return false;
  if (chip.after && !G.known.has(chip.after)) return false;
  if (chip.clue && G.known.has(chip.clue)) return false;
  if (chip.after_q !== undefined && !G.asked.has(hkey(G.talkingTo) + "#" + chip.after_q)) return false;
  return true;
}
function renderChips() {
  const box = $("chips"); box.innerHTML = "";
  const id = G.talkingTo; const talk = scene().talk[id];
  talk.chips.forEach((chip, i) => {
    if (!chipAvailable(talk, chip, i)) return;
    const b = document.createElement("button"); b.className = "chip"; b.textContent = chip.q;
    b.addEventListener("click", () => askChip(i));
    box.appendChild(b);
  });
}
async function askChip(i, typed) {
  const id = G.talkingTo, chip = scene().talk[id].chips[i];
  G.asked.add(hkey(id) + "#" + i);
  const hist = G.history[hkey(id)];
  hist.push({ who: "player", text: typed || chip.q });
  if (!typed) addMsg("me", chip.q);
  hist.push({ who: id, text: chip.a, clue: chip.clue && !G.known.has(chip.clue) ? chip.clue : undefined });
  addMsg("them", chip.a);
  if (chip.clue) learn(chip.clue);
  renderChips();
  await speak(id, chip.a);
}

let asking = false;
async function askFree(text) {
  const id = G.talkingTo; if (!id || asking) return;
  text = text.trim(); if (!text) return;
  asking = true; stopSpeaking();
  const hist = G.history[hkey(id)];
  addMsg("me", text);
  const thinking = addMsg("thinking", STORY.characters[id].name + " is thinking");
  thinking.className = "msg them thinking";
  world.setThinking(id, true);
  try {
    const r = await fetch("api/ask", { method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ scene: scene().id, char: id, text, known: [...G.known], history: hist.slice(-8) }) });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw Object.assign(new Error(j.error || "no answer"), { status: r.status });
    thinking.remove();
    hist.push({ who: "player", text });
    const fresh = (j.clues || []).find((c) => !G.known.has(c));
    hist.push({ who: id, text: j.reply, clue: fresh });
    G.turns++; G.tokens += (j.usage?.in || 0) + (j.usage?.out || 0);
    if (G.talkingTo === id) {
      const m = addMsg("them", j.reply); m.dataset.url = j.audio;
      for (const c of j.clues || []) learn(c);
      renderChips();
      setStatus(j.usage ? `~${j.usage.in + j.usage.out} tokens · $${j.usage.usd}` : "");
      world.setThinking(id, false);
      await speakReply(id, j.reply);
    } else for (const c of j.clues || []) learn(c);
  } catch (e) {
    thinking.remove();
    if (WEB && G.talkingTo === id) {
      // no live answer (no key yet, a daily cap, offline): answer from the script instead
      setStatus(e.status === 429 ? "That's a lot of questions for one day: answers come from the script until tomorrow."
        : "The storyteller is resting: this answer comes from the script.");
      world.setThinking(id, false);
      asking = false;
      return answerOffline(id, text);
    }
    addMsg("sys", `${STORY.characters[id].name} just looks at you. (Couldn't reach the story server: ${e.message}. The suggested questions still work.)`);
  } finally {
    world.setThinking(id, false);
    asking = false;
  }
}
$("talkForm").addEventListener("submit", (e) => { e.preventDefault(); const v = $("talkText").value; $("talkText").value = ""; askFree(v); });

// Offline answers: the open suggested question that best matches the typed one, else a short in-character deflection.
const STOP = new Set(("the and but for with you your yours are was were been did does what who why how when where which that " +
  "this its there here about any anything something have has had can could would will just not yes tell know see saw").split(" "));
const words = (s) => (s.toLowerCase().match(/[a-z']+/g) || []).map((w) => w.replace(/'s$/, "").replace(/(?<=..)s$/, ""))
  .filter((w) => w.length > 2 && !STOP.has(w));
function answerOffline(id, text) {
  const talk = scene().talk[id], want = new Set(words(text));
  let best = -1, score = 0;
  talk.chips.forEach((chip, i) => {
    if (!chipAvailable(talk, chip, i)) return;
    const s = new Set(words(chip.q).filter((w) => want.has(w))).size;
    if (s > score) { score = s; best = i; }
  });
  if (best >= 0) return askChip(best, text);
  const lines = STORY.characters[id].offline || ["Hm."], line = lines[(G.offline = (G.offline || 0) + 1) % lines.length];
  const hist = G.history[hkey(id)];
  hist.push({ who: "player", text }, { who: id, text: line });
  addMsg("them", line);
  return speak(id, line);
}

function learn(id) {
  if (!STORY.clues[id] || G.known.has(id)) return;
  G.known.add(id); save(); G.lastProgress = Date.now();
  const giver = G.talkingTo || G.lastTalked; if (giver) world.burst(giver);
  if (G.talkingTo) addClueMsg(id);
  toast(`Notebook: <b>${esc(STORY.clues[id].title)}</b>`);
  renderNotebook(id);
  const b = $("clueCount"); b.classList.remove("bump"); void b.offsetWidth; b.classList.add("bump");
  const sc = scene();
  const wasReady = G.readyShown;
  showObjective();
  if (sc.requires.every((r) => G.known.has(r)) && G.readyFor !== sc.id) {
    G.readyFor = sc.id;
    setTimeout(() => toast("You know enough. <b>The story can continue</b> when you're ready."), 2600);
  }
}
let toastT;
function toast(html) {
  const t = $("toast"); t.innerHTML = html; t.classList.add("show");
  clearTimeout(toastT); toastT = setTimeout(() => t.classList.remove("show"), 3400);
}
function renderNotebook(fresh) {
  const ul = $("clues");
  const ids = Object.keys(STORY.clues).filter((k) => G.known.has(k));
  $("clueCount").textContent = ids.length;
  ul.innerHTML = ids.length ? ids.map((k) => `<li class="${k === fresh ? "fresh" : ""}"><b>${esc(STORY.clues[k].title)}</b><span>${esc(STORY.clues[k].note)}</span></li>`).join("")
    : '<li class="empty">Nothing yet. Ask questions.</li>';
}

// ------------------------------------------------------------------ microphone

let rec = null, recChunks = [], recStream = null, recStart = 0, recHeld = false;
const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
function startSR() {
  stopSpeaking();
  const r = rec = new SR();
  let heard = "";
  r.lang = "en-US"; r.interimResults = true; r.continuous = true;
  r.onresult = (e) => { heard = [...e.results].map((x) => x[0].transcript).join(" ").replace(/\s+/g, " ").trim(); if (heard) setStatus("“" + heard + "”"); };
  r.onerror = (e) => { r.failed = e.error; };
  r.onend = () => {
    if (rec === r) rec = null;
    $("mic").classList.remove("rec");
    if (r.cancelled) return setStatus("");
    if (r.failed === "not-allowed" || r.failed === "service-not-allowed") return setStatus("Microphone blocked. Allow it in the address bar, or type.");
    if (!heard) return setStatus(r.failed && r.failed !== "no-speech" ? "Couldn't hear you (" + r.failed + "). Typing works." : "Didn't catch that. Try again, a little closer to the mic.");
    setStatus("You said: “" + heard + "”");
    askFree(heard);
  };
  try { r.start(); } catch (e) { rec = null; setStatus("Couldn't start the microphone. Typing works."); return; }
  recStart = performance.now();
  $("mic").classList.add("rec");
  setStatus("Listening… release (or tap again) when you're done.");
}
async function startRec() {
  if (rec) return;
  if (WEB) {
    if (SR) return startSR();
    setStatus("This browser can't listen. Typing works, or try Chrome or Safari.");
    return;
  }
  if (!navigator.mediaDevices?.getUserMedia) {
    setStatus("The microphone needs the secure (https) address. Typing works.");
    return;
  }
  stopSpeaking();
  try {
    recStream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
  } catch (e) { setStatus("Microphone blocked (" + e.name + "). Allow it in the address bar, or type."); return; }
  const type = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4", "audio/ogg"].find((t) => window.MediaRecorder?.isTypeSupported?.(t)) || "";
  rec = new MediaRecorder(recStream, type ? { mimeType: type } : undefined);
  recChunks = [];
  rec.ondataavailable = (e) => e.data.size && recChunks.push(e.data);
  rec.onstop = onRecStop;
  rec.start(); recStart = performance.now();
  $("mic").classList.add("rec");
  setStatus("Listening… release (or tap again) when you're done.");
}
function stopRec(cancel = false) {
  if (!rec) return;
  rec.cancelled = cancel;
  if (WEB) { try { rec.stop(); } catch { /* already stopped */ } if (cancel) { rec = null; $("mic").classList.remove("rec"); } return; }
  if (rec.state !== "inactive") rec.stop();
  recStream?.getTracks().forEach((t) => t.stop());
  $("mic").classList.remove("rec");
}
async function onRecStop() {
  const r = rec; rec = null;
  if (r.cancelled) { setStatus(""); return; }
  const blob = new Blob(recChunks, { type: r.mimeType || "audio/webm" });
  if (blob.size < 2000) { setStatus("Too short. Hold the button while you talk."); return; }
  $("mic").classList.add("busy"); setStatus("Hearing you…");
  try {
    const res = await fetch("api/listen", { method: "POST", headers: { "Content-Type": blob.type }, body: blob });
    const j = await res.json();
    const text = (j.text || "").trim();
    if (!text) { setStatus("Didn't catch that. Try again, a little closer to the mic."); return; }
    setStatus("You said: “" + text + "”");
    askFree(text);
  } catch (e) { setStatus("Couldn't transcribe (" + e.message + "). Typing works."); }
  finally { $("mic").classList.remove("busy"); }
}
const mic = $("mic");
mic.addEventListener("pointerdown", (e) => {
  e.preventDefault();
  if (rec) { stopRec(); return; }           // second tap of tap-to-talk
  recHeld = true; startRec();
});
const release = () => {
  if (!recHeld) return; recHeld = false;
  if (rec && performance.now() - recStart > 450) stopRec();   // hold-to-talk; a quick tap keeps listening
};
mic.addEventListener("pointerup", release);
mic.addEventListener("pointerleave", release);

// ------------------------------------------------------------------ menus, settings, save

function hideDrops() { for (const id of ["how", "settings", "notebook"]) $(id).classList.add("hidden"); }
function toggleDrop(id) { const open = $(id).classList.contains("hidden"); hideDrops(); if (open) $(id).classList.remove("hidden"); }
$("btnHow").addEventListener("click", () => toggleDrop("how"));
$("btnNotes").addEventListener("click", () => toggleDrop("notebook"));
$("btnSettings").addEventListener("click", () => toggleDrop("settings"));
$("volMusic").value = settings.music; $("volVoice").value = settings.voice; $("voiceMode").value = settings.mode;
$("volMusic").addEventListener("input", (e) => { settings.music = +e.target.value; store.set("music", settings.music); duck(); });
$("volVoice").addEventListener("input", (e) => { settings.voice = +e.target.value; store.set("voice", settings.voice); if (voiceGain) voiceGain.gain.value = settings.voice; });
$("voiceMode").addEventListener("change", (e) => { settings.mode = e.target.value; store.set("mode", settings.mode); });
$("btnSkip").addEventListener("click", () => {
  hideDrops();
  if (G.phase === "intro") return;
  for (const r of scene().requires) G.known.add(r);
  renderNotebook(); showObjective(); continueStory();
});
$("btnRestart").addEventListener("click", () => { store.set("save", null); location.reload(); });
$("btnAgain").addEventListener("click", () => { store.set("save", null); location.reload(); });

function save() {
  store.set("save", { scene: G.sceneIdx, known: [...G.known], asked: [...G.asked], ended: G.phase === "end" });
}

// ------------------------------------------------------------------ boot

async function boot() {
  [STORY, MANIFEST] = await Promise.all([
    fetch("story/ep1.json").then((r) => r.json()),
    fetch("audio/manifest.json").then((r) => r.json()).catch(() => ({})),
  ]);
  world.setScene(STORY.scenes[0].set, ["beatrice", "zeina"]);
  world.orbit = true;
  const sv = store.get("save");
  if (sv && (sv.scene > 0 || sv.known?.length) && !sv.ended) $("btnResume").classList.remove("hidden");
  $("btnBegin").addEventListener("click", () => start(null));
  $("btnResume").addEventListener("click", () => start(sv));
  if ("speechSynthesis" in window) speechSynthesis.getVoices();
}
// Phones only let a media element play later if it first played inside a tap: play a moment of silence in each now.
const SILENCE = "data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEAQB8AAIA+AAACABAAZGF0YQAAAAA=";
function unlockMedia() {
  for (const el of [voiceEl, ...musicEls]) { el.src = SILENCE; el.play().then(() => { if (el.src === SILENCE) el.pause(); }).catch(() => {}); }
}
function start(sv) {
  world.orbit = false;
  try { if (navigator.audioSession) navigator.audioSession.type = "playback"; } catch { /* Safari only */ }
  initAudio(); AC.resume?.();
  unlockMedia();
  if (!WEB) fetch("api/warm").catch(() => {});
  $("title").classList.add("hidden");
  if (sv) { G.known = new Set(sv.known || []); G.asked = new Set(sv.asked || []); renderNotebook(); }
  runScene(sv ? sv.scene : 0);
}
boot();

// stuck for a while? open the hint by itself, once per scene
setInterval(() => {
  if (G.phase !== "play" || G.hintShown || !STORY) return;
  if (scene().requires.every((r) => G.known.has(r))) return;
  if (Date.now() - (G.lastProgress || Date.now()) > 150000) { G.hintShown = true; showObjective(); toast("Stuck? <b>A hint</b> is open, top left."); }
}, 5000);
