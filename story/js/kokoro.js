// Kokoro-82M in the browser (kokoro-js, ONNX q8, about 92 MB): the public build's voice for unscripted replies.
// The model starts downloading on the title screen and is kept in the browser's Cache Storage after the first visit
// (transformers.js "transformers-cache", voices in "kokoro-voices"). WebGPU where the browser has it and it's quick,
// WASM otherwise; if neither works the page falls back to the browser's own speechSynthesis. The model runs in a Web
// Worker (kokoro-worker.js) so making a line never stalls the page.
export const state = { status: "idle", device: null, loaded: 0, total: 0, error: null, t0: 0, loadMs: 0, checks: [], synths: [] };
let worker = null, nextId = 0;
const waiting = new Map(), listeners = new Set();
export const onChange = (fn) => listeners.add(fn);
const emit = () => listeners.forEach((fn) => { try { fn(state); } catch { /* a listener's problem */ } });

let loading = null;
export function load() {
  if (loading) return loading;
  state.status = "loading"; state.t0 = performance.now(); emit();
  loading = new Promise((resolve, reject) => {
    const files = {};
    try { worker = new Worker(new URL("./kokoro-worker.js", import.meta.url), { type: "module" }); }
    catch (e) { state.status = "failed"; state.error = String(e?.message || e); emit(); return reject(e); }
    worker.onerror = (e) => {
      if (state.status !== "loading") return;
      state.status = "failed"; state.error = e.message || "worker error"; emit(); reject(new Error(state.error));
    };
    worker.onmessage = ({ data: m }) => {
      if (m.type === "progress") {
        files[m.file] = m;
        state.loaded = Object.values(files).reduce((s, f) => s + (f.loaded || 0), 0);
        state.total = Object.values(files).reduce((s, f) => s + (f.total || 0), 0);
        emit();
      } else if (m.type === "ready") {
        Object.assign(state, { status: "ready", device: m.device, checks: m.checks, loadMs: Math.round(performance.now() - state.t0) });
        emit(); resolve();
      } else if (m.type === "failed") {
        Object.assign(state, { status: "failed", error: m.error, checks: m.checks }); emit(); reject(new Error(m.error));
      } else if (m.type === "done" || m.type === "genfail") {
        const w = waiting.get(m.id); waiting.delete(m.id);
        if (!w) return;
        if (m.type === "genfail") return w.reject(new Error(m.error));
        state.synths.push({ chars: w.chars, ms: m.ms, secs: m.secs });
        w.resolve(URL.createObjectURL(m.blob));
      }
    };
    worker.postMessage({ type: "load" });
  });
  return loading;
}

export const ready = () => state.status === "ready";

// -> a promise of an object URL (WAV) for this line in this voice. The worker makes lines one at a time, in the order
// asked, so a reply's later pieces are made while its first plays. Recent lines are kept for "hear it again".
const made = new Map();
export function synthUrl(text, voice) {
  const key = voice + "|" + text;
  if (made.has(key)) return made.get(key);
  const id = ++nextId;
  const p = new Promise((resolve, reject) => waiting.set(id, { resolve, reject, chars: text.length }));
  worker.postMessage({ type: "gen", id, text, voice });
  made.set(key, p);
  p.catch(() => made.delete(key));
  if (made.size > 24) {
    const [oldKey, oldP] = made.entries().next().value;
    made.delete(oldKey); oldP.then((u) => URL.revokeObjectURL(u), () => {});
  }
  return p;
}
