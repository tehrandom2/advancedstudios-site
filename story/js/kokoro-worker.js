// Kokoro in a Web Worker, so making a line never blocks the page (the 3D scene, the UI, a line already playing).
// Messages in:  {type:"load"}  {type:"gen", id, text, voice}
// Messages out: {type:"progress", file, loaded, total}  {type:"ready", device, checks}  {type:"failed", error}
//               {type:"done", id, blob, ms, secs}  {type:"genfail", id, error}
import { KokoroTTS } from "https://cdn.jsdelivr.net/npm/kokoro-js@1.2.1/dist/kokoro.web.js";

const MODEL = "onnx-community/Kokoro-82M-v1.0-ONNX";
const SLOW_CHECK_MS = 4000; // a short line taking longer than this on WebGPU means the GPU path is worse than WASM here
let tts = null, queue = Promise.resolve();
const checks = [];

async function hasWebGPU() {
  try { return !!(self.navigator?.gpu && await navigator.gpu.requestAdapter()); } catch { return false; }
}

// A short line through the model: proves the device makes real audio (not NaN or silence), quickly enough.
async function check(t, device) {
  const t0 = performance.now();
  const a = await t.generate("Hello there.", { voice: "af_bella" });
  const ms = Math.round(performance.now() - t0);
  let peak = 0, finite = true;
  for (const v of a.audio) { if (!Number.isFinite(v)) { finite = false; break; } peak = Math.max(peak, Math.abs(v)); }
  checks.push({ device, ms, peak: +peak.toFixed(3) });
  if (!finite || peak <= 0.01) throw new Error(device + " produced no audio");
  if (device === "webgpu" && ms > SLOW_CHECK_MS) throw new Error("webgpu too slow (" + ms + " ms)");
}

async function load() {
  const progress_callback = (p) => {
    if (p.status === "progress" && p.file && p.total) postMessage({ type: "progress", file: p.file, loaded: p.loaded, total: p.total });
  };
  let lastErr;
  for (const device of (await hasWebGPU()) ? ["webgpu", "wasm"] : ["wasm"]) {
    try {
      const t = await KokoroTTS.from_pretrained(MODEL, { dtype: "q8", device, progress_callback });
      try { await check(t, device); } catch (e) { t.model?.dispose?.(); throw e; }
      tts = t;
      return postMessage({ type: "ready", device, checks });
    } catch (e) { lastErr = e; console.warn("kokoro:", device, "not used:", e?.message || e); }
  }
  postMessage({ type: "failed", error: String(lastErr?.message || lastErr || "no device"), checks });
}

self.onmessage = ({ data }) => {
  if (data.type === "load") return void load();
  if (data.type === "gen") {
    queue = queue.then(async () => {  // one line at a time, in the order asked
      try {
        const t0 = performance.now();
        const a = await tts.generate(data.text, { voice: data.voice });
        postMessage({ type: "done", id: data.id, blob: a.toBlob(), ms: Math.round(performance.now() - t0),
          secs: +(a.audio.length / a.sampling_rate).toFixed(2) });
      } catch (e) { postMessage({ type: "genfail", id: data.id, error: String(e?.message || e) }); }
    });
  }
};
