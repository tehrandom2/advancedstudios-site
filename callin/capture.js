// Call-in: the AudioWorklet that captures the microphone. Mixes the input to mono and hands the main thread blocks
// of 4096 samples (transferred, not copied), plus the block's peak for the level meter. Records only while "on".
class CallinCapture extends AudioWorkletProcessor {
  constructor() {
    super();
    this.on = false;
    this.buf = new Float32Array(4096);
    this.n = 0;
    this.port.onmessage = (e) => {
      if (e.data === 'start') { this.on = true; this.n = 0; }
      if (e.data === 'stop') { this.flush(); this.on = false; this.port.postMessage({ done: true }); }
    };
  }
  flush() {
    if (!this.n) return;
    const out = this.buf.slice(0, this.n);
    this.port.postMessage({ block: out.buffer }, [out.buffer]);
    this.n = 0;
  }
  process(inputs) {
    const ch = inputs[0];
    if (!this.on || !ch || !ch.length) return true;
    const len = ch[0].length, k = ch.length;
    for (let i = 0; i < len; i++) {
      let v = 0;
      for (let c = 0; c < k; c++) v += ch[c][i];
      this.buf[this.n++] = v / k;
      if (this.n === this.buf.length) this.flush();
    }
    return true;
  }
}
registerProcessor('callin-capture', CallinCapture);
