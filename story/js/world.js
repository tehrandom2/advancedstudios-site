// The Neverending: the 3D world. Procedural dioramas (no model files), stylised characters with breathing, blinking,
// tails, look-at and talk animation. Everything here is built from three.js primitives and canvas textures.
import * as THREE from "../vendor/three.module.min.js";

const TAU = Math.PI * 2;
const rand = (a, b) => a + Math.random() * (b - a);
const lerp = (a, b, t) => a + (b - a) * t;

// ------------------------------------------------------------------ textures

function canvasTex(w, h, paint, repeat) {
  const c = document.createElement("canvas");
  c.width = w; c.height = h;
  const g = c.getContext("2d");
  paint(g, w, h);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  if (repeat) { t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(repeat[0], repeat[1]); }
  return t;
}

// blob on an equirect sphere texture, drawn at u and u±1 so it wraps
function blob(g, w, h, u, v, ru, rv, color, rot = 0) {
  g.fillStyle = color;
  for (const du of [-1, 0, 1]) {
    g.beginPath();
    g.ellipse((u + du) * w, (1 - v) * h, ru * w, rv * h, rot, 0, TAU);
    g.fill();
  }
}

const GREY = "#55575f", WHITE = "#f3f1ec";

function beatriceBodyTex() {
  return canvasTex(512, 256, (g, w, h) => {
    g.fillStyle = WHITE; g.fillRect(0, 0, w, h);
    g.filter = "blur(5px)";
    blob(g, w, h, 0.75, 0.86, 0.30, 0.22, GREY);           // saddle over the back
    blob(g, w, h, 0.62, 0.62, 0.10, 0.17, GREY, 0.4);       // right flank
    blob(g, w, h, 0.90, 0.58, 0.11, 0.15, GREY, -0.3);      // left flank (wraps)
    blob(g, w, h, 0.02, 0.55, 0.07, 0.10, GREY, 0.2);
    blob(g, w, h, 0.47, 0.50, 0.05, 0.08, GREY);
    blob(g, w, h, 0.79, 0.45, 0.06, 0.07, GREY);
    g.filter = "none";
    noise(g, w, h, 0.05);
  });
}
function beatriceHeadTex() {
  return canvasTex(512, 256, (g, w, h) => {
    g.fillStyle = "#4f5159"; g.fillRect(0, 0, w, h);
    g.filter = "blur(4px)";
    blob(g, w, h, 0.25, 0.18, 0.15, 0.30, WHITE);           // muzzle and chin
    blob(g, w, h, 0.25, 0.45, 0.035, 0.18, WHITE);          // blaze up the nose
    g.filter = "none";
    noise(g, w, h, 0.05);
  });
}
function zeinaTex(head) {
  return canvasTex(512, 256, (g, w, h) => {
    const grd = g.createLinearGradient(0, 0, 0, h);
    grd.addColorStop(0, "#b8401a"); grd.addColorStop(0.55, "#d35a26"); grd.addColorStop(1, "#f0b48a");
    g.fillStyle = grd; g.fillRect(0, 0, w, h);
    g.filter = "blur(3px)";
    g.strokeStyle = "rgba(120,30,8,0.35)"; g.lineWidth = head ? 7 : 9;
    if (head) {
      for (const du of [-0.04, 0, 0.04]) { g.beginPath(); g.moveTo((0.25 + du) * w, 0.05 * h); g.lineTo((0.25 + du * 0.6) * w, 0.32 * h); g.stroke(); }
      blob(g, w, h, 0.25, 0.2, 0.12, 0.2, "#f3c9a4");
    } else {
      for (let i = 0; i < 16; i++) {
        const u = i / 16 + 0.02; if (Math.abs(u - 0.25) < 0.08) continue;
        g.beginPath(); g.moveTo(u * w, 0); g.quadraticCurveTo((u + 0.03) * w, 0.3 * h, (u - 0.01) * w, 0.55 * h); g.stroke();
      }
    }
    g.filter = "none";
    noise(g, w, h, 0.06);
  });
}
function koiTex(base, patches) {
  return canvasTex(256, 128, (g, w, h) => {
    g.fillStyle = base; g.fillRect(0, 0, w, h);
    g.filter = "blur(2px)";
    for (const p of patches) blob(g, w, h, p[0], p[1], p[2], p[3], p[4]);
    g.filter = "none";
  });
}
function noise(g, w, h, a) {
  const img = g.getImageData(0, 0, w, h), d = img.data;
  for (let i = 0; i < d.length; i += 4) { const n = (Math.random() - 0.5) * 255 * a; d[i] += n; d[i + 1] += n; d[i + 2] += n; }
  g.putImageData(img, 0, 0);
}
function softDot() {
  return canvasTex(64, 64, (g) => {
    const r = g.createRadialGradient(32, 32, 0, 32, 32, 32);
    r.addColorStop(0, "rgba(255,255,255,1)"); r.addColorStop(0.35, "rgba(255,255,255,0.55)"); r.addColorStop(1, "rgba(255,255,255,0)");
    g.fillStyle = r; g.fillRect(0, 0, 64, 64);
  });
}
function bricksTex(c1, c2) {
  return canvasTex(256, 256, (g, w, h) => {
    g.fillStyle = c2; g.fillRect(0, 0, w, h);
    const bh = 32, bw = 64;
    for (let y = 0; y < h; y += bh) for (let x = -(y / bh % 2) * bw / 2; x < w; x += bw) {
      const l = rand(-12, 12);
      g.fillStyle = shade(c1, l); g.fillRect(x + 3, y + 3, bw - 6, bh - 6);
    }
    noise(g, w, h, 0.08);
  }, [3, 1.5]);
}
function cobbleTex() {
  return canvasTex(512, 512, (g, w, h) => {
    g.fillStyle = "#4d4946"; g.fillRect(0, 0, w, h);
    for (let i = 0; i < 900; i++) {
      g.fillStyle = shade("#6f6a65", rand(-10, 10));
      g.beginPath(); g.ellipse(rand(0, w), rand(0, h), rand(9, 14), rand(7, 11), rand(0, 3), 0, TAU); g.fill();
    }
    noise(g, w, h, 0.04);
  }, [4, 4]);
}
function tileTex(a, b) {
  return canvasTex(256, 256, (g, w, h) => {
    for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) { g.fillStyle = (x + y) % 2 ? a : b; g.fillRect(x * 32, y * 32, 32, 32); }
    noise(g, w, h, 0.06);
  }, [4, 4]);
}
function signTex(text, bg, fg, w = 512, h = 128, font = "bold 54px Inter, sans-serif") {
  return canvasTex(w, h, (g) => {
    g.fillStyle = bg; g.fillRect(0, 0, w, h);
    g.fillStyle = fg; g.font = font; g.textAlign = "center"; g.textBaseline = "middle";
    g.fillText(text, w / 2, h / 2 + 2);
  });
}
function shade(hex, d) {
  const c = new THREE.Color(hex); const k = d / 255;
  return "#" + new THREE.Color(Math.min(1, Math.max(0, c.r + k)), Math.min(1, Math.max(0, c.g + k)), Math.min(1, Math.max(0, c.b + k))).getHexString();
}

// ------------------------------------------------------------------ materials

const std = (color, o = {}) => new THREE.MeshStandardMaterial({ color, roughness: 0.8, ...o });
function furMat(map, color = 0xffffff) {
  return new THREE.MeshPhysicalMaterial({ map, color, roughness: 0.92, sheen: 1, sheenRoughness: 0.45, sheenColor: new THREE.Color(0xffffff).multiplyScalar(0.5) });
}

function mesh(geo, mat, pos, scale, parent, shadow = true) {
  const m = new THREE.Mesh(geo, mat);
  if (pos) m.position.set(...pos);
  if (scale) typeof scale === "number" ? m.scale.setScalar(scale) : m.scale.set(...scale);
  m.castShadow = shadow; m.receiveShadow = true;
  if (parent) parent.add(m);
  return m;
}
const SPH = new THREE.SphereGeometry(1, 40, 28);
const SPH_LO = new THREE.SphereGeometry(1, 16, 12);

// ------------------------------------------------------------------ characters

class Rig {
  constructor(id) {
    this.id = id;
    this.root = new THREE.Group();
    this.inner = new THREE.Group();     // bob / breathe
    this.root.add(this.inner);
    this.head = null;
    this.eyes = [];
    this.mouth = null;
    this.tail = [];
    this.anchor = new THREE.Object3D(); // where the name tag floats
    this.talk = 0; this.talkTarget = 0;
    this.blinkT = rand(1, 4);
    this.lookTarget = null;
    this.mats = [];
    this.phase = rand(0, 10);
    this.highlight = 0; this.highlightTarget = 0;
    this.thinking = false;
  }
  tagAll() { this.root.traverse((o) => { if (o.isMesh) o.userData.charId = this.id; }); }
  setHighlight(on) { this.highlightTarget = on ? 1 : 0; }
  update(t, dt, camera) {
    const p = t + this.phase;
    this.talk = lerp(this.talk, this.talkTarget, Math.min(1, dt * 18));
    this.highlight = lerp(this.highlight, this.highlightTarget, Math.min(1, dt * 8));
    for (const m of this.mats) m.emissive.setRGB(0.09 * this.highlight, 0.08 * this.highlight, 0.05 * this.highlight);
    // blink
    this.blinkT -= dt;
    let lid = 1;
    if (this.blinkT < 0) { lid = Math.max(0.08, Math.abs(this.blinkT + 0.07) / 0.07); if (this.blinkT < -0.14) this.blinkT = rand(2, 5.5); }
    for (const e of this.eyes) e.scale.y = e.userData.sy * lid;
    if (this.mouth) this.mouth.scale.y = this.mouth.userData.sy * (0.2 + this.talk * 3.2);
    // head: look at the camera (or target), nod when talking
    if (this.head) {
      const tgt = this.lookTarget || camera.position;
      const hp = new THREE.Vector3(); this.head.getWorldPosition(hp);
      const local = this.root.worldToLocal(tgt.clone());
      const hl = this.root.worldToLocal(hp.clone());
      const d = local.sub(hl);
      let yaw = Math.atan2(d.x, d.z), pitch = -Math.atan2(d.y, Math.hypot(d.x, d.z));
      yaw = THREE.MathUtils.clamp(yaw, -0.9, 0.9); pitch = THREE.MathUtils.clamp(pitch, -0.4, 0.35);
      const nod = this.talk * Math.sin(t * 13) * 0.08;
      const tilt = this.thinking ? Math.sin(t * 1.5) * 0.25 : Math.sin(p * 0.6) * 0.05;
      this.head.rotation.y = lerp(this.head.rotation.y, yaw, Math.min(1, dt * 3));
      this.head.rotation.x = lerp(this.head.rotation.x, pitch + nod, Math.min(1, dt * 5));
      this.head.rotation.z = lerp(this.head.rotation.z, tilt, Math.min(1, dt * 3));
    }
    this.animate?.(t, dt, p);
  }
}

function catEye(parent, x, y, z, r, iris, rig) {
  const g = new THREE.Group(); g.position.set(x, y, z); parent.add(g);
  const white = mesh(SPH, new THREE.MeshPhysicalMaterial({ color: iris, roughness: 0.15, clearcoat: 1, clearcoatRoughness: 0.05 }), [0, 0, 0], [r, r * 1.08, r * 0.7], g, false);
  mesh(SPH_LO, std(0x0b0b0e, { roughness: 0.2 }), [0, 0, r * 0.5], [r * 0.4, r * 0.82, r * 0.25], g, false);
  mesh(SPH_LO, new THREE.MeshBasicMaterial({ color: 0xffffff }), [r * 0.32, r * 0.4, r * 0.66], r * 0.2, g, false);
  g.lookAt(g.position.clone().add(new THREE.Vector3(x * 0.6, 0, 1)));
  g.userData.sy = 1; rig.eyes.push(g);
  return white;
}

function makeCat(id, o) {
  const rig = new Rig(id);
  const I = rig.inner;
  const bodyMat = furMat(o.bodyTex), headMat = furMat(o.headTex), accent = furMat(null, o.accent), white = furMat(null, o.paw);
  rig.mats.push(bodyMat, headMat, accent, white);
  // body: belly + chest + haunches + paws
  mesh(SPH, bodyMat, [0, o.bh, 0], [o.bw, o.bh, o.bd], I);
  mesh(SPH, o.chestMat === "body" ? bodyMat : white, [0, o.bh * 1.55, o.bd * 0.32], [o.bw * 0.66, o.bh * 0.8, o.bd * 0.55], I);
  for (const s of [-1, 1]) {
    mesh(SPH, bodyMat, [s * o.bw * 0.62, o.bh * 0.62, -o.bd * 0.15], [o.bw * 0.48, o.bh * 0.6, o.bd * 0.62], I);
    if (o.legs) mesh(new THREE.CapsuleGeometry(0.075, o.legs, 6, 12), white, [s * 0.13, o.legs / 2 + 0.07, o.bd * 0.62], null, I);
    mesh(SPH, white, [s * (o.legs ? 0.13 : o.bw * 0.32), 0.07, o.bd * (o.legs ? 0.72 : 0.92)], [0.12 * o.pawS, 0.08, 0.16 * o.pawS], I);
  }
  // head
  const H = new THREE.Group(); H.position.set(0, o.headY, o.headZ); I.add(H); rig.head = H;
  const r = o.hr;
  if (o.neck) mesh(SPH, bodyMat, [0, o.headY - r * 0.75, o.headZ - r * 0.15], [r * 0.7, r * 1.0, r * 0.68], I);
  mesh(SPH, headMat, [0, 0, 0], [r * 1.12, r * 0.95, r], H);
  for (const s of [-1, 1]) {
    mesh(SPH, headMat, [s * r * 0.55, -r * 0.3, r * 0.35], [r * 0.55, r * 0.45, r * 0.5], H);         // cheeks
    mesh(SPH, white, [s * r * 0.2, -r * 0.33, r * 0.83], [r * 0.24, r * 0.2, r * 0.2], H, false);    // whisker pads
    // ears
    const ear = new THREE.Group(); ear.position.set(s * r * 0.55, r * 0.68, -r * 0.05); ear.rotation.z = -s * 0.38; ear.rotation.x = -0.12; H.add(ear);
    mesh(new THREE.ConeGeometry(r * 0.36, r * o.earH, 4), accent, [0, r * o.earH / 2, 0], null, ear).rotation.y = Math.PI / 4;
    mesh(new THREE.ConeGeometry(r * 0.24, r * o.earH * 0.7, 4), std(0xe8a0a8), [0, r * o.earH * 0.38, r * 0.07], null, ear, false).rotation.y = Math.PI / 4;
    catEye(H, s * r * 0.4, r * 0.06, r * 0.8, r * 0.235, o.eye, rig);
    // whiskers
    const wg = new THREE.BufferGeometry(); const pts = [];
    for (let k = 0; k < 3; k++) { pts.push(s * r * 0.3, -r * 0.3, r * 0.92, s * r * 1.4, -r * (0.25 + k * 0.12) + r * 0.1, r * 0.8 - k * r * 0.05); }
    wg.setAttribute("position", new THREE.Float32BufferAttribute(pts, 3));
    H.add(new THREE.LineSegments(wg, new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.7 })));
  }
  mesh(new THREE.ConeGeometry(r * 0.1, r * 0.09, 3), std(0xd8858f, { roughness: 0.4 }), [0, -r * 0.12, r * 0.98], null, H, false).rotation.x = Math.PI / 2 + 0.3;
  rig.mouth = mesh(SPH_LO, std(0x3a1418), [0, -r * 0.47, r * 0.85], [r * 0.12, r * 0.05, r * 0.06], H, false);
  rig.mouth.userData.sy = r * 0.05;
  rig.anchor.position.set(0, r * 1.7, 0); H.add(rig.anchor);
  // tail: a chain of spheres along a curling curve
  const tailMat = o.tailMat === "accent" ? accent : bodyMat;
  const tailBase = o.tailPath.map((q) => new THREE.Vector3(...q));
  const tailPts = tailBase.map((v) => v.clone());
  const tailCurve = new THREE.CatmullRomCurve3(tailPts);
  let tailMesh = mesh(new THREE.TubeGeometry(tailCurve, 24, o.tailR, 10), tailMat, null, null, I);
  const tip = mesh(SPH_LO, tailMat, null, o.tailR, I);
  const root = mesh(SPH_LO, tailMat, null, o.tailR * 1.1, I);
  rig.animate = (t, dt, p) => {
    const breathe = 1 + Math.sin(p * 1.6) * 0.018;
    I.scale.set(1 / Math.sqrt(breathe), breathe, 1 / Math.sqrt(breathe));
    const swish = o.tailSwish * (rig.talk > 0.05 ? 1.6 : 1);
    for (let i = 0; i < tailPts.length; i++) {
      const k = i / (tailPts.length - 1), w = Math.sin(p * o.tailSpeed - k * 2.2);
      tailPts[i].copy(tailBase[i]).add(new THREE.Vector3(w * swish * k * k * o.tailAmp[0], w * k * k * o.tailAmp[1], Math.cos(p * o.tailSpeed - k * 2.2) * swish * k * k * o.tailAmp[2]));
    }
    tailCurve.updateArcLengths();
    const ng = new THREE.TubeGeometry(tailCurve, 24, o.tailR, 10);
    tailMesh.geometry.dispose(); tailMesh.geometry = ng;
    tip.position.copy(tailPts[tailPts.length - 1]); root.position.copy(tailPts[0]);
  };
  rig.tagAll();
  return rig;
}

export function makeBeatrice() {
  return makeCat("beatrice", {
    bodyTex: beatriceBodyTex(), headTex: beatriceHeadTex(), accent: 0x51535b, paw: 0xf5f3ee, eye: 0xe8a028,
    bw: 0.82, bh: 0.6, bd: 0.8, hr: 0.44, headY: 1.42, headZ: 0.3, earH: 0.7, pawS: 1.25, legs: 0,
    tailR: 0.11, tailPath: [[0, 0.2, -0.7], [0.45, 0.13, -0.78], [0.86, 0.11, -0.42], [0.98, 0.11, 0.08], [0.82, 0.11, 0.55], [0.5, 0.12, 0.86], [0.2, 0.16, 0.98]],
    tailAmp: [0.5, 0.25, 0.2], tailSpeed: 0.9, tailSwish: 0.6, tailMat: "accent",
  });
}
export function makeZeina() {
  return makeCat("zeina", {
    bodyTex: zeinaTex(false), headTex: zeinaTex(true), accent: 0xb53f17, paw: 0xf0b48a, eye: 0x86c84a, chestMat: "body",
    bw: 0.44, bh: 0.5, bd: 0.58, hr: 0.31, headY: 1.42, headZ: 0.26, earH: 1.05, pawS: 0.8, legs: 0.62, neck: true,
    tailR: 0.065, tailPath: [[0, 0.25, -0.45], [-0.2, 0.12, -0.78], [-0.45, 0.3, -0.95], [-0.56, 0.75, -0.9], [-0.46, 1.15, -0.78], [-0.25, 1.32, -0.66], [-0.08, 1.28, -0.6]],
    tailAmp: [0.45, 0.15, 0.25], tailSpeed: 1.3, tailSwish: 0.7, tailMat: "accent",
  });
}

export function makeCrow() {
  const rig = new Rig("mortimer");
  const I = rig.inner;
  const black = new THREE.MeshPhysicalMaterial({ color: 0x1b1e2a, roughness: 0.35, clearcoat: 0.7, clearcoatRoughness: 0.3, sheen: 1, sheenColor: new THREE.Color(0x3a4cff), sheenRoughness: 0.3 });
  rig.mats.push(black);
  const body = mesh(SPH, black, [0, 0.55, 0], [0.38, 0.42, 0.55], I); body.rotation.x = -0.4;
  const wings = [];
  for (const s of [-1, 1]) {
    const w = new THREE.Group(); w.position.set(s * 0.33, 0.68, -0.05); I.add(w);
    mesh(SPH, black, [s * 0.02, -0.05, -0.15], [0.1, 0.3, 0.5], w).rotation.x = -0.5;
    wings.push(w);
    mesh(new THREE.CylinderGeometry(0.025, 0.02, 0.32), std(0x2a2a2a), [s * 0.12, 0.15, 0.05], null, I);
    mesh(SPH_LO, std(0x2a2a2a), [s * 0.12, 0.02, 0.12], [0.05, 0.02, 0.12], I);
  }
  mesh(new THREE.BoxGeometry(0.34, 0.04, 0.5), black, [0, 0.35, -0.6], null, I).rotation.x = 0.5;
  const H = new THREE.Group(); H.position.set(0, 1.0, 0.28); I.add(H); rig.head = H;
  mesh(SPH, black, [0, 0, 0], [0.27, 0.26, 0.29], H);
  const beak = mesh(new THREE.ConeGeometry(0.08, 0.38, 12), std(0x30302f, { roughness: 0.3 }), [0, -0.04, 0.38], [1, 1, 0.75], H); beak.rotation.x = Math.PI / 2;
  rig.mouth = mesh(new THREE.ConeGeometry(0.06, 0.26, 10), std(0x30302f, { roughness: 0.3 }), [0, -0.1, 0.33], null, H); rig.mouth.rotation.x = Math.PI / 2 + 0.2;
  rig.mouth.userData.sy = 1;
  for (const s of [-1, 1]) catEye(H, s * 0.15, 0.07, 0.2, 0.075, 0x1a1208, rig);
  const mono = mesh(new THREE.TorusGeometry(0.1, 0.014, 8, 24), std(0xe0b84a, { metalness: 1, roughness: 0.25 }), [0.15, 0.07, 0.27], null, H, false);
  mono.rotation.y = 0.5;
  rig.anchor.position.set(0, 0.6, 0); H.add(rig.anchor);
  let hopT = rand(2, 5), hop = 0, flap = 0;
  rig.animate = (t, dt, p) => {
    hopT -= dt; if (hopT < 0) { hop = 1; hopT = rand(3, 7); if (Math.random() < 0.6) flap = 1; }
    hop = Math.max(0, hop - dt * 3); flap = Math.max(0, flap - dt * 1.5);
    I.position.y = Math.sin(hop * Math.PI) * 0.15;
    const f = Math.sin(t * 22) * flap * 0.9 + rig.talk * Math.sin(t * 9) * 0.25;
    wings[0].rotation.z = -f; wings[1].rotation.z = f;
    rig.mouth.rotation.x = Math.PI / 2 + 0.15 + rig.talk * 0.5;
    rig.mouth.scale.y = 1;
  };
  rig.tagAll();
  return rig;
}

export function makeKoi(id, base, patches, size = 1) {
  const rig = new Rig(id);
  const I = rig.inner;
  const swimmer = new THREE.Group(); I.add(swimmer);
  const skin = new THREE.MeshPhysicalMaterial({ map: koiTex(base, patches), roughness: 0.3, clearcoat: 1, clearcoatRoughness: 0.15 });
  rig.mats.push(skin);
  mesh(SPH, skin, [0, 0, 0], [0.24 * size, 0.2 * size, 0.62 * size], swimmer);
  const finMat = new THREE.MeshPhysicalMaterial({ color: patches[0]?.[4] || base, transparent: true, opacity: 0.6, side: THREE.DoubleSide, roughness: 0.4 });
  const tail = new THREE.Group(); tail.position.set(0, 0, -0.55 * size); swimmer.add(tail);
  mesh(SPH_LO, finMat, [0, 0, -0.22 * size], [0.02, 0.2 * size, 0.28 * size], tail, false);
  const fins = [];
  for (const s of [-1, 1]) {
    const f = mesh(SPH_LO, finMat, [s * 0.26 * size, -0.08 * size, 0.18 * size], [0.16 * size, 0.015, 0.1 * size], swimmer, false); fins.push(f);
    catEye(swimmer, s * 0.16 * size, 0.06 * size, 0.5 * size, 0.045 * size, 0x111111, rig);
    mesh(new THREE.CylinderGeometry(0.008, 0.004, 0.18 * size), std(0xddbb99), [s * 0.06 * size, -0.07 * size, 0.62 * size], null, swimmer, false).rotation.x = 1.2;
  }
  rig.mouth = mesh(SPH_LO, std(0x552222), [0, -0.03 * size, 0.6 * size], [0.06 * size, 0.04 * size, 0.04 * size], swimmer, false);
  rig.mouth.userData.sy = 0.02 * size;
  rig.head = null;
  rig.anchor.position.set(0, 0.6, 0); I.add(rig.anchor);
  rig.swim = { mode: "circle", r: 1.0, speed: 0.35, y: -0.18, cx: 0, cz: 0 };
  let ang = rand(0, TAU);
  rig.animate = (t, dt, p) => {
    tail.rotation.y = Math.sin(t * (rig.talk > 0.05 ? 9 : 4) + p) * 0.45;
    fins[0].rotation.z = Math.sin(t * 3) * 0.3; fins[1].rotation.z = -Math.sin(t * 3) * 0.3;
    const sw = rig.swim;
    if (sw.mode === "circle") {
      ang += dt * sw.speed;
      const x = sw.cx + Math.cos(ang) * sw.r, z = sw.cz + Math.sin(ang) * sw.r;
      swimmer.position.x = lerp(swimmer.position.x, x, Math.min(1, dt * 2));
      swimmer.position.z = lerp(swimmer.position.z, z, Math.min(1, dt * 2));
      swimmer.position.y = lerp(swimmer.position.y, sw.y + Math.sin(p) * 0.03, Math.min(1, dt * 2));
      swimmer.rotation.y = lerp(swimmer.rotation.y, -ang, Math.min(1, dt * 2)) ;
      swimmer.rotation.x = 0;
    } else { // face the camera at the surface
      swimmer.position.x = lerp(swimmer.position.x, sw.fx, Math.min(1, dt * 2));
      swimmer.position.z = lerp(swimmer.position.z, sw.fz, Math.min(1, dt * 2));
      swimmer.position.y = lerp(swimmer.position.y, sw.fy + Math.sin(t * 2) * 0.02 + rig.talk * 0.04, Math.min(1, dt * 2));
      swimmer.rotation.y = lerp(swimmer.rotation.y, sw.fr, Math.min(1, dt * 3));
      swimmer.rotation.x = lerp(swimmer.rotation.x, -0.55, Math.min(1, dt * 2));
    }
    rig.anchor.position.set(swimmer.position.x, swimmer.position.y + 0.65, swimmer.position.z);
  };
  rig.tagAll();
  return rig;
}

// ------------------------------------------------------------------ set pieces

function sky(top, bottom) {
  const m = new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false, fog: false,
    uniforms: { top: { value: new THREE.Color(top) }, bottom: { value: new THREE.Color(bottom) } },
    vertexShader: "varying vec3 vp; void main(){ vp = normalize(position); gl_Position = projectionMatrix*modelViewMatrix*vec4(position,1.0);} ",
    fragmentShader: "uniform vec3 top; uniform vec3 bottom; varying vec3 vp; void main(){ float h = smoothstep(-0.15, 0.7, vp.y); gl_FragColor = vec4(mix(bottom, top, h), 1.0);\n#include <colorspace_fragment>\n}",
  });
  const s = new THREE.Mesh(new THREE.SphereGeometry(80, 32, 16), m);
  s.renderOrder = -10;
  return s;
}
function stars(n, r = 60, minY = 0.1) {
  const pos = [];
  for (let i = 0; i < n; i++) {
    const v = new THREE.Vector3(rand(-1, 1), rand(minY, 1), rand(-1, 1)).normalize().multiplyScalar(r);
    pos.push(v.x, v.y, v.z);
  }
  const g = new THREE.BufferGeometry(); g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  return new THREE.Points(g, new THREE.PointsMaterial({ size: 0.35, map: DOT, transparent: true, depthWrite: false, fog: false, color: 0xfff6e0 }));
}
function moon(pos, color = 0xfff3d6, size = 3) {
  const g = new THREE.Group();
  g.add(new THREE.Mesh(new THREE.SphereGeometry(size, 24, 16), new THREE.MeshBasicMaterial({ color, fog: false })));
  const halo = new THREE.Sprite(new THREE.SpriteMaterial({ map: DOT, color, transparent: true, opacity: 0.45, depthWrite: false, fog: false }));
  halo.scale.setScalar(size * 7); g.add(halo);
  g.position.set(...pos);
  return g;
}
function skyline(parent, count, radius, color, windowColor, seed = 1) {
  const winMat = new THREE.MeshBasicMaterial({ color: windowColor, fog: false });
  const bMat = new THREE.MeshBasicMaterial({ color, fog: false });
  for (let i = 0; i < count; i++) {
    const a = Math.PI * 0.15 + (i / count) * Math.PI * 1.25 + Math.PI * 0.5 + rand(-0.03, 0.03);
    const h = rand(5, 16), w = rand(2.5, 5);
    const b = new THREE.Mesh(new THREE.BoxGeometry(w, h, 3), bMat);
    const rr = radius + rand(-3, 4);
    b.position.set(Math.cos(a) * rr, h / 2 - 6, Math.sin(a) * rr);
    b.lookAt(0, b.position.y, 0);
    parent.add(b);
    for (let k = 0; k < 10; k++) {
      if (Math.random() < 0.45) continue;
      const wm = new THREE.Mesh(new THREE.PlaneGeometry(0.35, 0.45), winMat);
      wm.position.set(rand(-w / 2 + 0.4, w / 2 - 0.4), rand(-h / 2 + 1, h / 2 - 0.5), 1.51);
      b.add(wm);
    }
  }
}
function particles(n, box, color, size, opacity, drift) {
  const pos = new Float32Array(n * 3), seeds = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    pos[i * 3] = rand(box[0], box[1]); pos[i * 3 + 1] = rand(box[2], box[3]); pos[i * 3 + 2] = rand(box[4], box[5]); seeds[i] = rand(0, 100);
  }
  const g = new THREE.BufferGeometry(); g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  const p = new THREE.Points(g, new THREE.PointsMaterial({ size, map: DOT, color, transparent: true, opacity, depthWrite: false, blending: THREE.AdditiveBlending }));
  p.userData.tick = (t, dt) => {
    const a = g.attributes.position.array;
    for (let i = 0; i < n; i++) {
      a[i * 3] += Math.sin(t * 0.7 + seeds[i]) * dt * drift[0];
      a[i * 3 + 1] += dt * drift[1] + Math.cos(t * 0.5 + seeds[i]) * dt * drift[0] * 0.5;
      a[i * 3 + 2] += Math.cos(t * 0.6 + seeds[i] * 2) * dt * drift[0];
      if (a[i * 3 + 1] > box[3]) a[i * 3 + 1] = box[2];
      if (a[i * 3 + 1] < box[2]) a[i * 3 + 1] = box[3];
    }
    g.attributes.position.needsUpdate = true;
  };
  return p;
}
function waterMat(deep, light) {
  return new THREE.ShaderMaterial({
    transparent: true, depthWrite: false,
    uniforms: { t: { value: 0 }, deep: { value: new THREE.Color(deep) }, light: { value: new THREE.Color(light) } },
    vertexShader: "varying vec2 vu; void main(){ vu = uv; gl_Position = projectionMatrix*modelViewMatrix*vec4(position,1.0);} ",
    fragmentShader: `uniform float t; uniform vec3 deep; uniform vec3 light; varying vec2 vu;
      void main(){ vec2 p = vu*8.0; float w = sin(p.x*1.7+t*1.1)*sin(p.y*1.3-t*0.8) + sin((p.x+p.y)*2.3+t*1.7)*0.5;
        float r = length(vu-0.5)*2.0; float c = smoothstep(0.55, 1.0, w*0.5+0.5);
        vec3 col = mix(deep, light, c*0.55 + r*0.25); gl_FragColor = vec4(col, 0.5 + c*0.2);
        #include <colorspace_fragment>
      }`,
  });
}
function grate(parent, pos, w = 1.9, d = 1.4) {
  const g = new THREE.Group(); g.position.set(...pos); parent.add(g);
  mesh(new THREE.BoxGeometry(w, 0.08, d), std(0x2d2b2a, { metalness: 0.6, roughness: 0.5 }), [0, 0.04, 0], null, g);
  const glow = std(0x2a1004, { emissive: 0xff6a20, emissiveIntensity: 0.9 });
  for (let i = -3; i <= 3; i++) mesh(new THREE.BoxGeometry(0.07, 0.02, d * 0.85), glow, [i * w / 8, 0.085, 0], null, g, false);
  return g;
}
function pondAt(parent, R, pos) {
  const g = new THREE.Group(); g.position.set(...pos); parent.add(g);
  mesh(new THREE.TorusGeometry(R, 0.22, 10, 48), std(0x8b8580, { roughness: 0.95 }), [0, 0.05, 0], [1, 1, 0.6], g).rotation.x = Math.PI / 2;
  mesh(new THREE.CircleGeometry(R, 48), std(0x0d1e22), [0, -0.5, 0], null, g).rotation.x = -Math.PI / 2;
  const water = new THREE.Mesh(new THREE.CircleGeometry(R - 0.05, 48), waterMat(0x123a40, 0x7fc8c0));
  water.rotation.x = -Math.PI / 2; water.position.y = 0.02; water.renderOrder = 2; g.add(water);
  for (let i = 0; i < 4; i++) {
    const a = rand(0, TAU), rr = rand(0.4, R - 0.45);
    const pad = mesh(new THREE.CircleGeometry(rand(0.22, 0.34), 20, 0.3, TAU - 0.5), std(0x4f8a3c, { side: THREE.DoubleSide }), [Math.cos(a) * rr, 0.04, Math.sin(a) * rr], null, g, false);
    pad.rotation.x = -Math.PI / 2; pad.rotation.z = rand(0, TAU);
  }
  g.userData.water = water;
  return g;
}
function lamp(parent, pos, color = 0xffc87a, intensity = 6) {
  const g = new THREE.Group(); g.position.set(...pos); parent.add(g);
  mesh(new THREE.CylinderGeometry(0.06, 0.09, 3.2), std(0x1d1f24, { metalness: 0.5 }), [0, 1.6, 0], null, g);
  mesh(new THREE.SphereGeometry(0.22, 16, 12), new THREE.MeshBasicMaterial({ color }), [0, 3.3, 0], null, g, false);
  const halo = new THREE.Sprite(new THREE.SpriteMaterial({ map: DOT, color, transparent: true, opacity: 0.6, depthWrite: false, blending: THREE.AdditiveBlending }));
  halo.scale.setScalar(2.2); halo.position.y = 3.3; g.add(halo);
  const l = new THREE.PointLight(color, intensity, 9, 1.6); l.position.y = 3.2; g.add(l);
  return g;
}
function platform(parent, r, mat, h = 0.6) {
  const top = mesh(new THREE.CylinderGeometry(r, r, 0.1, 64), mat, [0, -0.05, 0], null, parent);
  top.castShadow = false;
  mesh(new THREE.CylinderGeometry(r, r * 0.92, h, 64), std(0x23252b, { roughness: 1 }), [0, -0.1 - h / 2, 0], null, parent, false);
  return top;
}
function pot(parent, pos, leaf = 0x3f7a45) {
  const g = new THREE.Group(); g.position.set(...pos); parent.add(g);
  mesh(new THREE.CylinderGeometry(0.32, 0.24, 0.5, 16), std(0xa0583a), [0, 0.25, 0], null, g);
  for (let i = 0; i < 7; i++) mesh(SPH_LO, std(leaf), [rand(-0.2, 0.2), 0.6 + rand(0, 0.35), rand(-0.2, 0.2)], [rand(0.15, 0.25), rand(0.25, 0.4), rand(0.12, 0.2)], g).rotation.z = rand(-0.5, 0.5);
  return g;
}
function tub(parent, pos, lidOff = false) {
  const g = new THREE.Group(); g.position.set(...pos); parent.add(g);
  const blue = std(0x2d6fb8, { roughness: 0.45 });
  mesh(new THREE.CylinderGeometry(0.85, 0.7, 0.9, 32, 1, true), new THREE.MeshStandardMaterial({ color: 0x2d6fb8, roughness: 0.45, side: THREE.DoubleSide }), [0, 0.45, 0], null, g);
  mesh(new THREE.CylinderGeometry(0.7, 0.7, 0.04, 32), blue, [0, 0.02, 0], null, g);
  mesh(new THREE.TorusGeometry(0.85, 0.05, 8, 40), blue, [0, 0.9, 0], null, g).rotation.x = Math.PI / 2;
  const w = new THREE.Mesh(new THREE.CircleGeometry(0.82, 32), waterMat(0x14444c, 0x9fe0d8));
  w.rotation.x = -Math.PI / 2; w.position.y = 0.78; w.renderOrder = 2; g.add(w);
  g.userData.water = w;
  if (lidOff) mesh(new THREE.CylinderGeometry(0.9, 0.9, 0.06, 32), blue, [1.1, 0.15, 0.4], null, g).rotation.z = 0.25;
  return g;
}

const DOT = softDot();

// ------------------------------------------------------------------ the sets

const SETS = {
  courtyard(night = true) {
    const S = new THREE.Group();
    const dawn = !night;
    platform(S, 7.5, std(0xffffff, { map: cobbleTex(), roughness: 0.95 }));
    const wall = mesh(new THREE.BoxGeometry(15, 4.2, 0.6), std(0xffffff, { map: bricksTex("#8a5a48", "#3d2f2b") }), [0, 2.1, -5.4], null, S);
    wall.receiveShadow = true;
    mesh(new THREE.BoxGeometry(15.4, 0.25, 0.9), std(0x6c6660), [0, 4.3, -5.4], null, S);
    mesh(new THREE.BoxGeometry(2.0, 3.2, 0.2), std(0x3b4a3e, { roughness: 0.6 }), [4.5, 1.6, -5.05], null, S);  // back gate
    mesh(new THREE.BoxGeometry(1.2, 2.3, 0.2), std(0x2b2f36), [-5.2, 1.15, -5.05], null, S);                    // basement door
    mesh(new THREE.BoxGeometry(1.1, 0.25, 0.25), std(0xffe8a0, { emissive: 0xffc860, emissiveIntensity: dawn ? 0.2 : 1 }), [-5.2, 2.6, -5.0], null, S, false);
    const pond = pondAt(S, 2.0, [0.9, 0, 0.2]);
    grate(S, [-2.6, 0, 0.4]);
    mesh(SPH_LO, furMat(null, 0xf3f1ec), [2.75, 0.24, 1.2], [0.16, 0.08, 0.13], S);   // the planted fur
    pot(S, [-5.4, 0, -3.6]); pot(S, [5.8, 0, -3.2], 0x557a3a); pot(S, [-6.3, 0, 1.8]);
    lamp(S, [-4.6, 0, -2.6], 0xffc27a, dawn ? 0 : 7);
    // bins
    for (const x of [6.0, 6.9]) mesh(new THREE.CylinderGeometry(0.42, 0.38, 1.1, 16), std(0x3a4c3c, { metalness: 0.3 }), [x, 0.55, -4.4], null, S);
    S.add(sky(dawn ? 0x8fb8e8 : 0x1e2c62, dawn ? 0xffc89a : 0xe89a7e));
    if (!dawn) { S.add(stars(400)); S.add(moon([-18, 26, -40], 0xfff1d0, 2.6)); }
    else S.add(moon([22, 14, -45], 0xfff0c0, 4));
    const fx = particles(70, [-7, 7, 0.2, 5, -5, 6], dawn ? 0xfff2c0 : 0xffd27a, 0.12, dawn ? 0.5 : 0.8, [0.15, 0.05]);
    S.add(fx);
    const steam = particles(40, [-3.4, -1.8, 0.1, 2.6, -0.2, 1.0], 0xffffff, 0.5, 0.12, [0.2, 0.5]);
    S.add(steam);
    return {
      group: S, fog: [dawn ? 0xe8c8b0 : 0x4a4a78, 14, 44],
      hemi: dawn ? [0xfff0dd, 0x6b5a50, 1.4] : [0xa8b4ee, 0x3a2c3a, 1.15],
      key: dawn ? [0xffd2a0, 3.2, [9, 9, 5]] : [0xd0dcff, 1.9, [-6, 10, 4]],
      rim: dawn ? [0xff9b70, 1.5, [-6, 4, -8]] : [0xff9a5a, 1.2, [6, 3, -6]],
      cam: { pos: [0, 4.3, 10.5], target: [0, 1.0, 0] },
      spots: {
        beatrice: { pos: [-2.6, 0.08, 0.4], rot: 0.45 },
        zeina: { pos: [-1.3, 0.0, 1.1], rot: 0.2 },
        mortimer: { pos: [3.2, 4.42, -5.3], rot: 0.2 },
        hanako: { pond: [0.9, 0, 0.2], r: 1.2 },
        emperor: { pond: [0.9, 0, 0.2], r: 0.9 },
      },
      water: [pond.userData.water], fx: [fx, steam],
    };
  },

  rooftop() {
    const S = new THREE.Group();
    platform(S, 7.5, std(0x4a4652, { roughness: 1 }));
    for (const [x, z, w, d] of [[0, -6.2, 13, 0.5], [-6.3, -1, 0.5, 10], [6.3, -1, 0.5, 10]]) mesh(new THREE.BoxGeometry(w, 0.8, d), std(0x5a5049), [x, 0.4, z], null, S);
    // water tower
    const T = new THREE.Group(); T.position.set(2.6, 0, -2.4); S.add(T);
    for (const [x, z] of [[-0.9, -0.9], [0.9, -0.9], [-0.9, 0.9], [0.9, 0.9]]) mesh(new THREE.CylinderGeometry(0.08, 0.1, 2.4), std(0x4a3a30), [x, 1.2, z], null, T);
    mesh(new THREE.BoxGeometry(2.6, 0.12, 2.6), std(0x5a4636), [0, 2.4, 0], null, T);
    mesh(new THREE.CylinderGeometry(1.25, 1.25, 2.4, 24), std(0x8a5e3e, { roughness: 0.9 }), [0, 3.65, 0], null, T);
    for (const y of [2.9, 3.6, 4.3]) mesh(new THREE.TorusGeometry(1.27, 0.035, 6, 32), std(0x2a2a2a, { metalness: 0.7 }), [0, y, 0], null, T).rotation.x = Math.PI / 2;
    mesh(new THREE.ConeGeometry(1.45, 1.0, 24), std(0x5a3a2a), [0, 5.35, 0], null, T);
    // vents, crates, a skylight
    mesh(new THREE.BoxGeometry(1.2, 0.9, 1.2), std(0x6b5b4a), [-1.0, 0.45, 0.4], null, S);
    mesh(new THREE.CylinderGeometry(0.3, 0.3, 1.1, 16), std(0x7a7f88, { metalness: 0.6, roughness: 0.4 }), [-4.2, 0.55, -3.0], null, S);
    mesh(new THREE.BoxGeometry(2.2, 0.3, 1.4), std(0x2a3442, { emissive: 0xffb860, emissiveIntensity: 0.35, roughness: 0.15, metalness: 0.3 }), [-3.6, 0.15, 1.8], null, S);
    S.add(sky(0x0a1030, 0x3a2a5a));
    S.add(stars(700, 60, 0.0));
    S.add(moon([14, 22, -38], 0xfff2d8, 3.4));
    skyline(S, 26, 34, 0x141830, 0xffd88a);
    const fx = particles(60, [-7, 7, 0.5, 6, -6, 6], 0xbfd8ff, 0.08, 0.7, [0.1, 0.02]);
    S.add(fx);
    return {
      group: S, fog: [0x1a1c3a, 14, 48],
      hemi: [0x8090d0, 0x201828, 0.85], key: [0xc8d8ff, 1.6, [8, 12, 2]], rim: [0xffb070, 1.0, [-8, 3, -4]],
      cam: { pos: [-0.5, 4.6, 10.2], target: [0.5, 1.6, -0.5] },
      spots: { zeina: { pos: [1.8, 2.46, -1.2], rot: -0.2 }, beatrice: { pos: [-1.2, 0.0, 2.0], rot: 0.35 } },
      fx: [fx], water: [],
    };
  },

  nest() {
    const S = new THREE.Group();
    platform(S, 6.5, std(0x48444f, { roughness: 1 }));
    mesh(new THREE.BoxGeometry(2.4, 2.2, 2.0), std(0xffffff, { map: bricksTex("#7a4a3a", "#2f2622") }), [-1.9, 1.1, -0.6], null, S);    // chimney
    mesh(new THREE.BoxGeometry(2.6, 0.2, 2.2), std(0x5d5550), [-1.9, 2.3, -0.6], null, S);
    const metal = std(0x9aa0aa, { metalness: 0.8, roughness: 0.35 });
    mesh(new THREE.CylinderGeometry(0.06, 0.06, 6.2), metal, [1.6, 3.1, -1.2], null, S);
    for (const [y, w] of [[3.0, 3.2], [3.8, 2.5], [4.6, 1.8], [5.3, 1.2]]) mesh(new THREE.CylinderGeometry(0.035, 0.035, w), metal, [1.6, y, -1.2], null, S).rotation.z = Math.PI / 2;
    // the nest
    const N = new THREE.Group(); N.position.set(1.6, 2.6, -1.2); S.add(N);
    mesh(new THREE.TorusGeometry(0.85, 0.32, 10, 28), std(0x5b4430, { roughness: 1 }), [0, 0, 0], [1, 1, 0.55], N).rotation.x = Math.PI / 2;
    for (let i = 0; i < 40; i++) {
      const a = rand(0, TAU), r = rand(0.75, 1.1);
      mesh(new THREE.CylinderGeometry(0.015, 0.015, rand(0.5, 0.9)), std(0x6b4f35), [Math.cos(a) * r, rand(-0.1, 0.15), Math.sin(a) * r], null, N, false).rotation.set(rand(0, 3), rand(0, 3), rand(0, 3));
    }
    const shinies = [];
    for (let i = 0; i < 16; i++) {
      const a = rand(0, TAU), r = rand(0.55, 1.05);
      const gold = Math.random() < 0.5;
      const m = mesh(new THREE.CylinderGeometry(0.07, 0.07, 0.015, 16), new THREE.MeshStandardMaterial({ color: gold ? 0xffcf5a : 0xdfe6ee, metalness: 1, roughness: 0.2, emissive: gold ? 0x553300 : 0x334455 }),
        [Math.cos(a) * r, 0.22 + rand(0, 0.08), Math.sin(a) * r], null, N, false);
      m.rotation.set(rand(-0.6, 0.6), 0, rand(-0.6, 0.6)); shinies.push(m);
    }
    const sp = particles(18, [0.6, 2.6, 2.6, 3.4, -2.2, -0.2], 0xfff0b0, 0.18, 0.9, [0.05, 0.0]);
    S.add(sp);
    S.add(sky(0x0c1232, 0x40305a));
    S.add(stars(600, 60, 0.0));
    S.add(moon([-16, 20, -40], 0xfff2d8, 3));
    skyline(S, 26, 30, 0x12162c, 0xffcf80);
    return {
      group: S, fog: [0x1c1d3c, 14, 46],
      hemi: [0x8090d0, 0x201828, 0.9], key: [0xd0dcff, 1.5, [6, 12, 6]], rim: [0xffc070, 1.4, [-6, 4, -6]],
      cam: { pos: [-0.6, 4.6, 9.2], target: [0.2, 2.3, -0.8] },
      spots: { mortimer: { pos: [1.6, 2.62, -1.2], rot: -0.25 }, zeina: { pos: [-1.9, 2.4, -0.4], rot: 0.35 }, beatrice: { pos: [-0.2, 0, 1.6], rot: 0.2 } },
      fx: [sp], water: [], shinies,
    };
  },

  laundry() {
    const S = new THREE.Group();
    platform(S, 7, std(0xffffff, { map: tileTex("#c9c2b4", "#8f8778"), roughness: 0.6 }));
    const wallMat = std(0xb8a68e, { roughness: 0.95 });
    mesh(new THREE.BoxGeometry(13, 5.5, 0.3), wallMat, [0, 2.75, -5.0], null, S);
    mesh(new THREE.BoxGeometry(0.3, 5.5, 9), wallMat, [-6.4, 2.75, -0.6], null, S);
    // dryers with warm round windows
    const drums = [];
    for (let i = 0; i < 3; i++) {
      const x = -4.6 + i * 1.75;
      mesh(new THREE.BoxGeometry(1.6, 1.8, 1.4), std(0xe8e4dc, { roughness: 0.4 }), [x, 0.9, -4.1], null, S);
      mesh(new THREE.TorusGeometry(0.45, 0.07, 10, 32), std(0x9aa0a8, { metalness: 0.8, roughness: 0.3 }), [x, 0.95, -3.39], null, S);
      const d = mesh(new THREE.CircleGeometry(0.42, 32), std(0x3a2410, { emissive: 0xff9a40, emissiveIntensity: 0.9 }), [x, 0.95, -3.38], null, S, false);
      drums.push(d);
      const l = new THREE.PointLight(0xffa050, 1.2, 4, 2); l.position.set(x, 0.95, -2.9); S.add(l);
    }
    // folding table, sink, boiler door, coal chute hatch
    mesh(new THREE.BoxGeometry(3.0, 0.12, 1.5), std(0x8a6a4a), [0.9, 1.15, -0.2], null, S);
    for (const [x, z] of [[-0.45, -0.8], [2.25, -0.8], [-0.45, 0.4], [2.25, 0.4]]) mesh(new THREE.CylinderGeometry(0.05, 0.05, 1.1), std(0x444444, { metalness: 0.6 }), [x, 0.55, z], null, S);
    mesh(new THREE.BoxGeometry(1.4, 0.9, 1.0), std(0xd8d8d8, { roughness: 0.3 }), [3.2, 0.9, -4.3], null, S);
    mesh(new THREE.BoxGeometry(1.6, 3.0, 0.15), std(0x5a636e, { metalness: 0.6, roughness: 0.45 }), [-6.2, 1.5, 1.6], null, S).rotation.y = Math.PI / 2;
    const sign = mesh(new THREE.PlaneGeometry(1.1, 0.3), new THREE.MeshStandardMaterial({ map: signTex("BOILER ROOM", "#b8261c", "#fff"), roughness: 0.5 }), [-6.03, 2.55, 1.6], null, S, false);
    sign.rotation.y = Math.PI / 2;
    mesh(new THREE.BoxGeometry(1.3, 0.9, 0.12), std(0x3a3a3c, { metalness: 0.7 }), [4.8, 3.6, -4.85], null, S);   // coal chute hatch
    const hl = mesh(new THREE.PlaneGeometry(1.0, 0.24), new THREE.MeshStandardMaterial({ map: signTex("COAL", "#2a2a2c", "#d8c890", 256, 64, "bold 40px Inter, sans-serif") }), [4.8, 3.6, -4.78], null, S, false);
    // a lone hanging bulb
    mesh(new THREE.SphereGeometry(0.18, 16, 12), new THREE.MeshBasicMaterial({ color: 0xffe2a8 }), [0.9, 4.4, -0.6], null, S, false);
    mesh(new THREE.CylinderGeometry(0.012, 0.012, 2.0), std(0x222222), [0.9, 5.5, -0.6], null, S, false);
    const bl = new THREE.PointLight(0xffd29a, 9, 12, 1.5); bl.position.set(0.9, 4.2, -0.6); bl.castShadow = true; bl.shadow.mapSize.set(512, 512); S.add(bl);
    const lint = particles(90, [-6, 6, 0.3, 5, -4.5, 4], 0xfff4e0, 0.1, 0.6, [0.12, 0.03]);
    S.add(lint);
    S.add(sky(0x2a2018, 0x2a2018));
    return {
      group: S, fog: [0x2a2018, 12, 34],
      hemi: [0xffe6c8, 0x403020, 0.9], key: [0xffd8a8, 0.8, [4, 9, 6]], rim: [0xff9050, 1.0, [-6, 3, -6]],
      cam: { pos: [1.4, 4.2, 9.0], target: [0.2, 1.4, -0.8] },
      spots: { beatrice: { pos: [0.9, 1.21, -0.2], rot: 0.15 }, zeina: { pos: [-1.6, 0, 0.9], rot: 0.4 } },
      fx: [lint], water: [], drums,
    };
  },

  boiler() {
    const S = new THREE.Group();
    platform(S, 7, std(0x3a302c, { roughness: 1 }));
    const wallMat = std(0x4a3a34, { roughness: 1 });
    mesh(new THREE.BoxGeometry(13, 5.5, 0.3), std(0xffffff, { map: bricksTex("#5a3428", "#1e1512") }), [0, 2.75, -5.0], null, S);
    mesh(new THREE.BoxGeometry(0.3, 5.5, 9), wallMat, [6.4, 2.75, -0.6], null, S);
    // the boiler
    const B = new THREE.Group(); B.position.set(-2.8, 0, -2.4); S.add(B);
    mesh(new THREE.CylinderGeometry(1.5, 1.6, 3.4, 32), std(0x6a4a3a, { metalness: 0.5, roughness: 0.55 }), [0, 1.7, 0], null, B);
    mesh(new THREE.SphereGeometry(1.5, 32, 16, 0, TAU, 0, Math.PI / 2), std(0x6a4a3a, { metalness: 0.5, roughness: 0.55 }), [0, 3.4, 0], null, B);
    const fire = mesh(new THREE.BoxGeometry(1.1, 0.7, 0.1), std(0x400800, { emissive: 0xff5a10, emissiveIntensity: 1.6 }), [0.3, 0.9, 1.52], null, B, false);
    fire.rotation.y = 0.2;
    for (const y of [1.2, 2.2, 3.0]) mesh(new THREE.TorusGeometry(1.56, 0.05, 8, 40), std(0x2e2420, { metalness: 0.8 }), [0, y, 0], null, B).rotation.x = Math.PI / 2;
    const pipe = std(0x8a6a50, { metalness: 0.7, roughness: 0.4 });
    for (const [x, y] of [[0, 4.4], [0.9, 4.0]]) mesh(new THREE.CylinderGeometry(0.15, 0.15, 9), pipe, [x + 1, y, -4.6], null, S).rotation.z = Math.PI / 2;
    mesh(new THREE.CylinderGeometry(0.2, 0.2, 2.5), pipe, [-2.8, 4.6, -2.4], null, S);
    const fl = new THREE.PointLight(0xff5a20, 14, 11, 1.4); fl.position.set(-2.0, 1.2, -0.4); fl.castShadow = true; fl.shadow.mapSize.set(512, 512); S.add(fl);
    const T = tub(S, [1.2, 0, -0.7]);
    // pump
    mesh(new THREE.BoxGeometry(0.4, 0.25, 0.3), std(0x222222), [2.3, 0.12, -0.3], null, S);
    const bubbles = particles(30, [0.7, 1.7, 0.5, 1.1, -1.1, -0.3], 0xddffff, 0.09, 0.8, [0.05, 0.5]);
    S.add(bubbles);
    const steam = particles(50, [-5, 5, 0.5, 5, -4.5, 1], 0xffb090, 0.6, 0.08, [0.2, 0.25]);
    S.add(steam);
    S.add(sky(0x1a0a08, 0x1a0a08));
    return {
      group: S, fog: [0x1c0c08, 10, 30],
      hemi: [0xff9070, 0x200808, 0.45], key: [0xffa080, 0.5, [4, 9, 6]], rim: [0x60a0ff, 1.2, [6, 4, -4]],
      cam: { pos: [0.6, 4.0, 8.6], target: [0.2, 1.1, -0.6] },
      spots: { emperor: { tub: [1.2, 0, -0.7] }, beatrice: { pos: [-1.2, 0, 1.0], rot: 0.35 }, zeina: { pos: [2.9, 0, 0.6], rot: -0.45 } },
      fx: [bubbles, steam], water: [T.userData.water], fireLight: fl, fire,
    };
  },
};

SETS.dawn = function () {
  const s = SETS.courtyard(false);
  const S = s.group;
  tub(S, [-5.1, 0, 2.0], true);
  // the van in the lane, seen over the gate
  const van = new THREE.Group(); van.position.set(4.5, 0, -7.4); S.add(van);
  mesh(new THREE.BoxGeometry(4.6, 2.6, 2.2), std(0xf2f2ee, { roughness: 0.5 }), [0, 1.9, 0], null, van);
  const lbl = mesh(new THREE.PlaneGeometry(3.4, 0.6), new THREE.MeshStandardMaterial({ map: signTex("FENWICK AQUATICS", "#f2f2ee", "#1f5f8a") }), [0, 2.4, 1.11], null, van, false);
  const rays = new THREE.Mesh(new THREE.ConeGeometry(5, 14, 32, 1, true), new THREE.MeshBasicMaterial({ color: 0xffe0a0, transparent: true, opacity: 0.06, side: THREE.DoubleSide, depthWrite: false, blending: THREE.AdditiveBlending }));
  rays.position.set(8, 7, -4); rays.rotation.z = 0.9; S.add(rays);
  s.spots = {
    beatrice: { pos: [-2.75, 0.08, 0.35], rot: 0.5 }, zeina: { pos: [-1.55, 0.08, 0.55], rot: 0.2 },
    mortimer: { pos: [6.0, 1.11, -4.4], rot: -0.6 },
    hanako: { pond: [0.9, 0, 0.2], r: 1.3 }, emperor: { pond: [0.9, 0, 0.2], r: 0.9 },
  };
  s.cam = { pos: [0.2, 4.6, 10.8], target: [0, 1.4, -0.4] };
  return s;
};

// ------------------------------------------------------------------ the world

export class World {
  constructor(canvas) {
    const r = this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: "high-performance" });
    r.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    r.shadowMap.enabled = true; r.shadowMap.type = THREE.PCFSoftShadowMap;
    r.toneMapping = THREE.ACESFilmicToneMapping; r.toneMappingExposure = 1.05;
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(42, 1, 0.1, 200);
    this.hemi = new THREE.HemisphereLight(0xffffff, 0x222222, 1); this.scene.add(this.hemi);
    this.key = new THREE.DirectionalLight(0xffffff, 2); this.key.castShadow = true;
    this.key.shadow.mapSize.set(2048, 2048); this.key.shadow.bias = -0.0005; this.key.shadow.normalBias = 0.02;
    Object.assign(this.key.shadow.camera, { left: -9, right: 9, top: 9, bottom: -9, near: 1, far: 40 });
    this.scene.add(this.key); this.scene.add(this.key.target);
    this.rim = new THREE.DirectionalLight(0xffffff, 1); this.scene.add(this.rim);
    this.scene.fog = new THREE.Fog(0x000000, 10, 40);
    this.chars = {
      beatrice: makeBeatrice(), zeina: makeZeina(), mortimer: makeCrow(),
      hanako: makeKoi("hanako", "#f4f1ea", [[0.3, 0.7, 0.12, 0.2, "#d8401c"], [0.65, 0.5, 0.1, 0.25, "#16161a"], [0.85, 0.75, 0.08, 0.15, "#d8401c"], [0.1, 0.4, 0.06, 0.12, "#16161a"]], 1.0),
      emperor: makeKoi("emperor", "#fbf8f0", [[0.25, 0.8, 0.14, 0.22, "#ee6a1e"], [0.55, 0.65, 0.16, 0.28, "#ee6a1e"], [0.85, 0.75, 0.1, 0.2, "#e85a18"]], 1.25),
    };
    this.sets = {};
    this.active = null;
    this.camPos = new THREE.Vector3(0, 5, 12); this.camTarget = new THREE.Vector3(0, 1, 0);
    this.camGoalPos = this.camPos.clone(); this.camGoalTarget = this.camTarget.clone();
    this.pointer = new THREE.Vector2(); this.parallax = new THREE.Vector2();
    this.focus = null; this.hover = null;
    this.ray = new THREE.Raycaster();
    this.clock = new THREE.Clock();
    this.fade = 0;
    this.resize();
    addEventListener("resize", () => this.resize());
    addEventListener("pointermove", (e) => { this.pointer.set(e.clientX / innerWidth * 2 - 1, -(e.clientY / innerHeight) * 2 + 1); });
    r.setAnimationLoop(() => this.frame());
  }
  resize() {
    const w = innerWidth, h = innerHeight;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.fov = w / h < 0.8 ? 50 : 42;
    this.camera.updateProjectionMatrix();
  }
  setScene(setName, cast) {
    if (this.active) this.scene.remove(this.active.group);
    for (const c of Object.values(this.chars)) this.scene.remove(c.root);
    const s = this.sets[setName] || (this.sets[setName] = SETS[setName]());
    this.active = s; this.scene.add(s.group);
    this.scene.fog.color.set(s.fog[0]); this.scene.fog.near = s.fog[1]; this.scene.fog.far = s.fog[2];
    this.hemi.color.set(s.hemi[0]); this.hemi.groundColor.set(s.hemi[1]); this.hemi.intensity = s.hemi[2];
    this.key.color.set(s.key[0]); this.key.intensity = s.key[1]; this.key.position.set(...s.key[2]);
    this.rim.color.set(s.rim[0]); this.rim.intensity = s.rim[1]; this.rim.position.set(...s.rim[2]);
    const present = new Set(cast);
    // background swimmers: koi in a pond scene swim even when not in the cast
    if (s.spots.hanako && setName !== "boiler") present.add("hanako");
    if (setName === "dawn") present.add("emperor");
    for (const id of present) {
      const c = this.chars[id], sp = s.spots[id];
      if (!c || !sp) continue;
      this.scene.add(c.root);
      c.root.rotation.set(0, 0, 0); c.root.scale.setScalar(1);
      if (sp.pos) { c.root.position.set(...sp.pos); c.root.rotation.y = sp.rot; }
      else if (sp.pond) { c.root.position.set(...sp.pond); c.swim = { mode: "circle", r: sp.r, speed: 0.3 + Math.random() * 0.1, y: -0.1, cx: 0, cz: 0 }; }
      else if (sp.tub) { c.root.position.set(...sp.tub); c.swim = { mode: "circle", r: 0.25, speed: 0.6, y: 0.62, cx: 0, cz: 0 }; c.root.scale.setScalar(0.8); }
    }
    this.cast = cast.filter((id) => s.spots[id]);
    this.camGoalPos.set(...s.cam.pos); this.camGoalTarget.set(...s.cam.target);
    // a little fly-in
    this.camPos.set(s.cam.pos[0] * 1.4 + 3, s.cam.pos[1] + 3, s.cam.pos[2] + 6);
    this.camTarget.set(...s.cam.target);
    this.focus = null;
  }
  // bring a character "forward": camera moves toward them; koi surface to talk
  setFocus(id) {
    this.focus = id;
    const s = this.active; if (!s) return;
    for (const [cid, c] of Object.entries(this.chars)) {
      if (c.swim && c.swim.mode === "face" && cid !== id) {
        const sp = s.spots[cid];
        c.swim.mode = "circle";
      }
    }
    if (!id) { this.camGoalPos.set(...s.cam.pos); this.camGoalTarget.set(...s.cam.target); return; }
    const c = this.chars[id];
    if (c.swim) {
      // surface at the front edge of the pond / tub, facing the camera
      const toCam = new THREE.Vector3(...s.cam.pos).sub(c.root.position).setY(0).normalize();
      const r = s.spots[id].tub ? 0.25 : 1.1;
      Object.assign(c.swim, { mode: "face", fx: toCam.x * r, fz: toCam.z * r, fy: s.spots[id].tub ? 0.72 : -0.02, fr: Math.atan2(toCam.x, toCam.z) });
    }
    const p = new THREE.Vector3(); c.anchor.getWorldPosition(p);
    if (c.swim) p.copy(c.root.position).add(new THREE.Vector3(c.swim.fx, 0.5, c.swim.fz));
    const base = new THREE.Vector3(...s.cam.pos), tgt = new THREE.Vector3(...s.cam.target);
    const narrow = innerWidth < 760;
    if (narrow) { // portrait: the talk sheet covers the lower half, so frame the character high and close
      const dir = base.clone().sub(p).normalize();
      this.camGoalTarget.copy(p).add(new THREE.Vector3(0, -1.5, 0));
      this.camGoalPos.copy(p).addScaledVector(dir, 4.2).add(new THREE.Vector3(0, -0.6, 0));
      return;
    }
    this.camGoalTarget.copy(tgt.clone().lerp(p, 0.65)).add(new THREE.Vector3(0.9, 0, 0));
    this.camGoalPos.copy(base.clone().lerp(p, 0.42)).add(new THREE.Vector3(0, 0.2, 1.4));
  }
  speaker(id) { this.speaking = id; }
  // a little golden burst and a hop when a character gives up a secret
  burst(id) {
    const c = this.chars[id]; if (!c || !c.root.parent) return;
    const at = new THREE.Vector3(); c.anchor.getWorldPosition(at); at.y -= 0.35;
    const n = 46, pos = new Float32Array(n * 3), vel = [];
    for (let i = 0; i < n; i++) { pos.set([at.x, at.y, at.z], i * 3); vel.push(new THREE.Vector3(rand(-1, 1), rand(0.2, 1.6), rand(-1, 1)).normalize().multiplyScalar(rand(1.2, 2.6))); }
    const g = new THREE.BufferGeometry(); g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    const m = new THREE.PointsMaterial({ size: 0.16, map: DOT, color: 0xffd27a, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending });
    const pts = new THREE.Points(g, m); this.scene.add(pts);
    let life = 0;
    this.bursts = this.bursts || [];
    this.bursts.push((dt) => {
      life += dt; const a = g.attributes.position.array;
      for (let i = 0; i < n; i++) { vel[i].y -= dt * 2.2; a[i * 3] += vel[i].x * dt; a[i * 3 + 1] += vel[i].y * dt; a[i * 3 + 2] += vel[i].z * dt; }
      g.attributes.position.needsUpdate = true; m.opacity = Math.max(0, 1 - life / 1.4);
      if (life > 1.4) { this.scene.remove(pts); g.dispose(); m.dispose(); return false; }
      return true;
    });
    c.hop = 1;
  }
  setTalk(id, level) { for (const [k, c] of Object.entries(this.chars)) c.talkTarget = k === id ? level : 0; }
  setThinking(id, on) { if (this.chars[id]) this.chars[id].thinking = on; }
  pick(clientX, clientY) {
    if (!this.cast?.length) return null;
    const v = new THREE.Vector2(clientX / innerWidth * 2 - 1, -(clientY / innerHeight) * 2 + 1);
    this.ray.setFromCamera(v, this.camera);
    const objs = this.cast.map((id) => this.chars[id].root);
    const hit = this.ray.intersectObjects(objs, true)[0];
    return hit?.object.userData.charId || null;
  }
  setHover(id) { for (const [k, c] of Object.entries(this.chars)) c.setHighlight(k === id); this.hover = id; }
  // screen position of each cast member's tag anchor
  anchors() {
    const out = {};
    for (const id of this.cast || []) {
      const p = new THREE.Vector3(); this.chars[id].anchor.getWorldPosition(p);
      p.project(this.camera);
      out[id] = { x: (p.x + 1) / 2 * innerWidth, y: (1 - p.y) / 2 * innerHeight, vis: p.z < 1 };
    }
    return out;
  }
  frame() {
    const dt = Math.min(0.05, this.clock.getDelta()), t = this.clock.elapsedTime;
    const s = this.active;
    this.parallax.lerp(this.pointer, Math.min(1, dt * 2));
    this.camPos.lerp(this.camGoalPos, Math.min(1, dt * 1.6));
    this.camTarget.lerp(this.camGoalTarget, Math.min(1, dt * 1.8));
    const sway = new THREE.Vector3(Math.sin(t * 0.13) * 0.35 + this.parallax.x * 0.6, Math.sin(t * 0.21) * 0.15 + this.parallax.y * 0.3, 0);
    // portrait screens: pull back so the whole diorama fits the width
    const a = this.camera.aspect, k = a < 1 ? Math.min(1.65, 0.9 / a) : 1;
    this.camera.position.copy(this.camPos).sub(this.camTarget).multiplyScalar(this.focus ? 1 : k).add(this.camTarget).add(sway);
    this.camera.lookAt(this.camTarget);
    if (s) {
      for (const f of s.fx || []) f.userData.tick(t, dt);
      for (const w of s.water || []) w.material.uniforms.t.value = t;
      if (s.fireLight) { s.fireLight.intensity = 12 + Math.sin(t * 7) * 2 + Math.sin(t * 13.3) * 1.5; s.fire.material.emissiveIntensity = 1.4 + Math.sin(t * 9) * 0.3; }
      if (s.drums) s.drums.forEach((d, i) => { d.material.emissiveIntensity = 0.8 + Math.sin(t * 2 + i) * 0.15; });
      if (s.shinies) s.shinies.forEach((m, i) => { m.material.emissiveIntensity = 0.6 + Math.max(0, Math.sin(t * 2.3 + i * 1.7)) * 2; });
    }
    for (const c of Object.values(this.chars)) if (c.root.parent) {
      c.update(t, dt, this.camera);
      if (c.hop > 0) { c.hop = Math.max(0, c.hop - dt * 2.2); c.inner.position.y = Math.sin((1 - c.hop) * Math.PI) * 0.22; }
    }
    if (this.bursts) this.bursts = this.bursts.filter((f) => f(dt));
    if (this.orbit && s) { const a = t * 0.06; this.camGoalPos.set(Math.sin(a) * 3 + s.cam.pos[0], s.cam.pos[1] + 0.5, s.cam.pos[2] + Math.cos(a) * 1.2); }
    this.renderer.render(this.scene, this.camera);
    this.onFrame?.(t, dt);
  }
}
