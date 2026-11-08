/* ============================================================================
   FRONTIER · LEVEL C — OVERGROWN BIO-LAB / CARNIVOROUS JUNGLE CANOPY
   Greybox ("shadow-box") prototype v1 — playable 3D level blockout.

   Design pillars:
   1) The lab is the antagonist: every system exists to stop / stall the car.
   2) Simplified "pack-driving": auto-drive always ON — steer, boost, brake, cut.
   3) Track-space physics (distance s + lateral offset) = rock-solid arcade feel.

   See LEVEL_DESIGN.md for the full zone-by-zone shadow-box breakdown.
   ============================================================================ */
import * as THREE from 'three';

/* ------------------------------- utils ---------------------------------- */
const $ = id => document.getElementById(id);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const lerp = (a, b, t) => a + (b - a) * t;
const smooth = t => t * t * (3 - 2 * t);
const rand = (a, b) => a + Math.random() * (b - a);
const damp = (a, b, lambda, dt) => lerp(a, b, 1 - Math.exp(-lambda * dt));
/* stable pseudo-random in [0,1) keyed off a number — keeps prop layout
   identical between reloads while still looking scattered */
const hashRnd = n => { const x = Math.sin(n * 127.1 + 311.7) * 43758.5453; return x - Math.floor(x); };
function fmtTime(t) {
  if (!isFinite(t)) return '—';
  const m = Math.floor(t / 60), s = t - m * 60;
  return m + ':' + (s < 10 ? '0' : '') + s.toFixed(1);
}

/* --------------------------- level definition ---------------------------- */
/* The lab drove a DEAD STRAIGHT service causeway through the canopy. The road
   is flat and true; everything interesting is what has grown and spilled onto
   it. Track-space = distance s (world -Z) + lateral offset.                    */
const TRACK_LEN = 1440;
const FINISH_S = 1400;

function centerX() { return 0; }                       // straight road, on purpose

const ZONES = [
  { name: 'AIRLOCK · DECON',   sub: 'Loading apron. Auto-drive holds the line — just steer.',              from: 0,    to: 200,  half: 8.0 },
  { name: 'CONTAINMENT WING',  sub: 'Specimen beds crowd the tarmac. Some of the flowers are awake.',      from: 200,  to: 470,  half: 8.6 },
  { name: 'RAVINE BRIDGE',     sub: 'Narrow span. Vines hang low over the gap — boost through or be taken.', from: 470, to: 710,  half: 4.8 },
  { name: 'SPORE GREENHOUSE',  sub: 'Vents, spills and toppled drums. Stay out of the yellow clouds.',      from: 710,  to: 960,  half: 8.4 },
  { name: 'HEART CHAMBER',     sub: 'The Mother Maw. Thread her tentacles. Do not stop.',                  from: 960,  to: 1190, half: 8.5 },
  { name: 'EXTRACTION SPRINT', sub: 'Debris everywhere. The pad is close — burn the cell.',                 from: 1190, to: 1440, half: 7.0 },
];

/* Local widenings: the causeway opens out and a mass in the middle splits it
   into TWO passages. Pick a side; each has its own trouble.                   */
const WIDENS = [
  { s: 300,  len: 92, add: 3.5 },   // Z2 · specimen island
  { s: 800,  len: 82, add: 3.2 },   // Z4 · collapsed ceiling column
  { s: 1225, len: 84, add: 3.6 },   // Z6 · collapsed truss
];
function widenAdd(s) {
  let a = 0;
  for (const w of WIDENS) {
    const d = Math.abs(s - w.s) / (w.len / 2);
    if (d < 1) a = Math.max(a, w.add * smooth(clamp((1 - d) * 2.4, 0, 1)));
  }
  return a;
}

function halfAt(s) {
  const sc = clamp(s, 0, TRACK_LEN);
  for (let i = 0; i < ZONES.length; i++) {
    const z = ZONES[i];
    if (s < z.to || i === ZONES.length - 1) {
      const blend = 26;
      if (i > 0 && s < z.from + blend) return lerp(ZONES[i - 1].half, z.half, smooth(clamp((s - z.from) / blend, 0, 1))) + widenAdd(sc);
      return z.half + widenAdd(sc);
    }
  }
  return 7;
}
function zoneAt(s) {
  for (let i = ZONES.length - 1; i >= 0; i--) if (s >= ZONES[i].from) return i;
  return 0;
}

/* scratch vectors */
const _tan = new THREE.Vector3(), _nor = new THREE.Vector3(), _pos = new THREE.Vector3();
function frameAt(s) {
  const dx = (centerX(s + 1) - centerX(s - 1)) / 2;
  _tan.set(dx, 0, -1).normalize();
  _nor.set(-_tan.z, 0, _tan.x);                    // right-hand side of travel
  return { tan: _tan, nor: _nor, yaw: Math.atan2(-_tan.x, -_tan.z) };
}
function trackPos(s, lat, y, out) {
  const f = frameAt(s);
  out.set(centerX(s) + f.nor.x * lat, y || 0, -s + f.nor.z * lat);
  return out;
}

/* Hazard / pickup placement table — the "shadow-box" in data form.
   type: snapper | flower | grabber | puffer | sap | chem | bramble | growbar |
         door | divider | tentacle | pad | nitro | repair
   Plants are NOT laid out in neat rows: they grow out of beds, cracks, drums
   and toppled tanks, at whatever angle the jungle put them.
   flower.mimic = true  -> carnivorous bloom disguised as garden flora         */
const PLACEMENTS = [
  // Z1 · Airlock apron — steering only. Flowers here are all DECOYS (that's the trick).
  { type: 'pad', s: 60, lat: 0 }, { type: 'nitro', s: 120, lat: -3.2 },
  { type: 'flower', s: 118, side: -1, mimic: false },
  { type: 'flower', s: 152, side: 1, mimic: false }, { type: 'pad', s: 168, lat: 3.2 },
  { type: 'flower', s: 186, side: -1, mimic: false },

  // Z2 · Containment Wing — first snapper, first mimic, first fork
  { type: 'flower', s: 224, side: -1, mimic: false },
  { type: 'snapper', s: 248, side: 1 },
  { type: 'flower', s: 264, side: 1, mimic: true },        // you are *told* flowers are safe here
  { type: 'sap', s: 276, lat: -3.4, r: 2.9 },
  { type: 'divider', s: 300, len: 54, latA: -1.8, latB: 1.8, name: 'SPECIMEN ISLAND' },
  { type: 'flower', s: 284, lat: -1.45, mimic: true, onIsland: true },   // planted on the island
  { type: 'flower', s: 316, lat: 1.45, mimic: false, onIsland: true },
  { type: 'chem', s: 336, lat: -4.8, r: 2.7 },
  { type: 'flower', s: 352, side: -1, mimic: true },
  { type: 'snapper', s: 366, side: 1 },
  { type: 'nitro', s: 388, lat: 3.6 },
  { type: 'flower', s: 404, side: 1, mimic: false },
  { type: 'snapper', s: 420, side: -1 },
  { type: 'sap', s: 442, lat: 2.8, r: 3.0 },
  { type: 'repair', s: 458, lat: -4.2 },

  // Z3 · Ravine Bridge — narrow span, grabbers, bramble
  { type: 'grabber', s: 512 }, { type: 'bramble', s: 556, side: -1 },
  { type: 'puffer', s: 586, side: 1 }, { type: 'nitro', s: 606, lat: 0 },
  { type: 'flower', s: 622, side: -1, mimic: true },       // rail planter, leaning in
  { type: 'grabber', s: 648 }, { type: 'bramble', s: 682, side: 1 },

  // Z4 · Spore Greenhouse — puffers, spills, fork through a collapsed column
  { type: 'puffer', s: 730, side: -1 }, { type: 'chem', s: 750, lat: -2.6, r: 3.2 },
  { type: 'flower', s: 768, side: 1, mimic: true },
  { type: 'divider', s: 800, len: 50, latA: -1.6, latB: 1.6, name: 'COLLAPSED COLUMN' },
  { type: 'sap', s: 788, lat: -4.2, r: 2.9 },
  { type: 'flower', s: 814, lat: 1.45, mimic: false, onIsland: true },
  { type: 'snapper', s: 832, side: 1 }, { type: 'puffer', s: 856, side: -1 },
  { type: 'chem', s: 872, lat: 3.2, r: 3.0 },
  { type: 'flower', s: 886, side: -1, mimic: true },
  { type: 'puffer', s: 906, side: 1 },
  { type: 'repair', s: 928, lat: 0 }, { type: 'door', s: 945, phase: 0 },

  // Z5 · Heart Chamber — the Maw
  { type: 'repair', s: 968, lat: -4.2 }, { type: 'nitro', s: 988, lat: 4.2 },
  { type: 'flower', s: 1002, side: 1, mimic: false },
  { type: 'tentacle', s: 1032, phase: 0 }, { type: 'tentacle', s: 1064, phase: 2.2 },
  { type: 'snapper', s: 1088, side: 1, big: true },
  { type: 'tentacle', s: 1098, phase: 4.1 },
  { type: 'grabber', s: 1132 }, { type: 'growbar', s: 1158, side: -1 },

  // Z6 · Extraction Sprint — debris fork, then the glory run
  { type: 'divider', s: 1225, len: 50, latA: -1.7, latB: 1.7, name: 'COLLAPSED TRUSS' },
  { type: 'flower', s: 1208, lat: -1.45, mimic: true, onIsland: true },
  { type: 'snapper', s: 1250, side: 1 }, { type: 'chem', s: 1266, lat: -3.2, r: 2.8 },
  { type: 'flower', s: 1282, side: -1, mimic: true },
  { type: 'puffer', s: 1298, side: -1 }, { type: 'grabber', s: 1318 },
  { type: 'flower', s: 1334, side: 1, mimic: false },
  { type: 'snapper', s: 1356, side: -1 },
  { type: 'pad', s: 1372, lat: 0 }, { type: 'pad', s: 1390, lat: 0 },
];

/* ------------------------------ three setup ------------------------------ */
const container = $('game');
const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.setSize(innerWidth, innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
container.appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x0a2b16);
scene.fog = new THREE.Fog(0x0a2413, 55, 235);

const camera = new THREE.PerspectiveCamera(62, innerWidth / innerHeight, 0.1, 600);
camera.position.set(0, 6, 14);

scene.add(new THREE.HemisphereLight(0xaee6b0, 0x16241a, 0.95));
const sun = new THREE.DirectionalLight(0xfff1c4, 1.9);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
sun.shadow.camera.left = -55; sun.shadow.camera.right = 55;
sun.shadow.camera.top = 55; sun.shadow.camera.bottom = -55;
sun.shadow.camera.far = 220; sun.shadow.bias = -0.0006;
scene.add(sun); scene.add(sun.target);
const fill = new THREE.DirectionalLight(0x6fb7ff, 0.35);
fill.position.set(-30, 40, 30); scene.add(fill);

/* ------------------------------ materials -------------------------------- */
const M = {
  labWhite: new THREE.MeshStandardMaterial({ color: 0xd9e0e6, roughness: .55, metalness: .25 }),
  labGrey: new THREE.MeshStandardMaterial({ color: 0x394047, roughness: .7, metalness: .3 }),
  labDark: new THREE.MeshStandardMaterial({ color: 0x1d2226, roughness: .8, metalness: .2 }),
  blueGlow: new THREE.MeshStandardMaterial({ color: 0x1f5eff, emissive: 0x1f5eff, emissiveIntensity: 1.6 }),
  amberGlow: new THREE.MeshStandardMaterial({ color: 0xffb020, emissive: 0xffb020, emissiveIntensity: 1.4 }),
  leaf: new THREE.MeshStandardMaterial({ color: 0x2fae5f, roughness: .95, flatShading: true }),
  leafDark: new THREE.MeshStandardMaterial({ color: 0x176b34, roughness: .95, flatShading: true }),
  stem: new THREE.MeshStandardMaterial({ color: 0x2e6b34, roughness: .9 }),
  vine: new THREE.MeshStandardMaterial({ color: 0x245c2c, roughness: .9 }),
  jawOut: new THREE.MeshStandardMaterial({ color: 0x3fae4a, roughness: .7, flatShading: true }),
  teeth: new THREE.MeshStandardMaterial({ color: 0xf4f1e4, roughness: .4 }),
  puffer: new THREE.MeshStandardMaterial({ color: 0xe8dfa0, roughness: .85, flatShading: true }),
  spore: new THREE.MeshStandardMaterial({ color: 0xd8e64a, transparent: true, opacity: .34, depthWrite: false, emissive: 0x8a9a1e, emissiveIntensity: .5 }),
  sap: new THREE.MeshStandardMaterial({ color: 0x9b4dff, transparent: true, opacity: .88, roughness: .12, emissive: 0x44157e, emissiveIntensity: .7 }),
  thorn: new THREE.MeshStandardMaterial({ color: 0x4a3521, roughness: .95, flatShading: true }),
  glass: new THREE.MeshStandardMaterial({ color: 0x9fd8ff, transparent: true, opacity: .22, roughness: .1, metalness: .1 }),
  nitro: new THREE.MeshStandardMaterial({ color: 0x35c8ff, emissive: 0x1f8fff, emissiveIntensity: 1.5, roughness: .3 }),
  repair: new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: .4 }),
  cross: new THREE.MeshStandardMaterial({ color: 0x2fe07a, emissive: 0x17b356, emissiveIntensity: 1.2 }),
  ground: new THREE.MeshStandardMaterial({ color: 0x0d2314, roughness: 1 }),
  apron: new THREE.MeshStandardMaterial({ color: 0x27313a, roughness: .95 }),
  concrete: new THREE.MeshStandardMaterial({ color: 0x6d7479, roughness: .95, flatShading: true }),
  concreteDark: new THREE.MeshStandardMaterial({ color: 0x3d4348, roughness: .98, flatShading: true }),
  slab: new THREE.MeshStandardMaterial({ color: 0x4a5157, roughness: .96 }),
  steel: new THREE.MeshStandardMaterial({ color: 0x6c7681, roughness: .45, metalness: .65 }),
  rust: new THREE.MeshStandardMaterial({ color: 0x7a4b2a, roughness: .95 }),
  soil: new THREE.MeshStandardMaterial({ color: 0x2c2118, roughness: 1 }),
  islandSoil: new THREE.MeshStandardMaterial({ color: 0x3b2c1f, roughness: 1 }),
  bark: new THREE.MeshStandardMaterial({ color: 0x3a2b1d, roughness: 1, flatShading: true }),
  chem: new THREE.MeshStandardMaterial({ color: 0x7dff4d, transparent: true, opacity: .82, roughness: .1, emissive: 0x2f9a12, emissiveIntensity: 1.1 }),
  chemGlow: new THREE.MeshStandardMaterial({ color: 0xa6ff7a, emissive: 0x74ff3a, emissiveIntensity: 1.6 }),
  petalA: new THREE.MeshStandardMaterial({ color: 0xff5fa3, roughness: .7, emissive: 0x5a0b2c, emissiveIntensity: .35, flatShading: true, side: THREE.DoubleSide }),
  petalB: new THREE.MeshStandardMaterial({ color: 0xf7e6c4, roughness: .78, emissive: 0x3a2f1c, emissiveIntensity: .25, flatShading: true, side: THREE.DoubleSide }),
  petalC: new THREE.MeshStandardMaterial({ color: 0xb47bff, roughness: .7, emissive: 0x2a0f52, emissiveIntensity: .3, flatShading: true, side: THREE.DoubleSide }),
  throat: new THREE.MeshStandardMaterial({ color: 0x5b0d22, roughness: .5, emissive: 0x2a0310, emissiveIntensity: .8 }),
  gore: new THREE.MeshStandardMaterial({ color: 0x8c1230, roughness: .6 }),
  lightStrip: new THREE.MeshStandardMaterial({ color: 0xdff3ff, emissive: 0xa8e4ff, emissiveIntensity: 1.5 }),
  screenGreen: new THREE.MeshStandardMaterial({ color: 0x0a2418, emissive: 0x37e08b, emissiveIntensity: 1.2 }),
  screenBlue: new THREE.MeshStandardMaterial({ color: 0x0a1c30, emissive: 0x4d9dff, emissiveIntensity: 1.1 }),
  drumBlue: new THREE.MeshStandardMaterial({ color: 0x2f6fa8, roughness: .5, metalness: .45 }),
  drumRed: new THREE.MeshStandardMaterial({ color: 0xa8342f, roughness: .5, metalness: .4 }),
  drumYellow: new THREE.MeshStandardMaterial({ color: 0xc8a52b, roughness: .55, metalness: .35 }),
};

/* --------------------------- geometry helpers ---------------------------- */
function box(w, h, d, mat, x, y, z) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
  m.position.set(x || 0, y || 0, z || 0); m.castShadow = true; m.receiveShadow = true; return m;
}
function cyl(r1, r2, h, mat, x, y, z, seg) {
  const m = new THREE.Mesh(new THREE.CylinderGeometry(r1, r2, h, seg || 10), mat);
  m.position.set(x || 0, y || 0, z || 0); m.castShadow = true; m.receiveShadow = true; return m;
}
function sph(r, mat, x, y, z, sx, sy, sz) {
  const m = new THREE.Mesh(new THREE.SphereGeometry(r, 14, 10), mat);
  m.position.set(x || 0, y || 0, z || 0); m.scale.set(sx || 1, sy || 1, sz || 1);
  m.castShadow = true; m.receiveShadow = true; return m;
}
function cone(r, h, mat, x, y, z) {
  const m = new THREE.Mesh(new THREE.ConeGeometry(r, h, 7), mat);
  m.position.set(x || 0, y || 0, z || 0); m.castShadow = true; return m;
}
function blob(r, mat, x, y, z, s) {
  const m = new THREE.Mesh(new THREE.IcosahedronGeometry(r, 0), mat);
  m.position.set(x || 0, y || 0, z || 0); m.scale.setScalar(s || 1);
  m.rotation.set(rand(0, 3), rand(0, 3), rand(0, 3)); m.castShadow = true; return m;
}
/* stretch a unit cylinder between two world points (stems / vines) */
const _a = new THREE.Vector3(), _b = new THREE.Vector3(), _d = new THREE.Vector3(), _up = new THREE.Vector3(0, 1, 0), _q = new THREE.Quaternion();
function stemBetween(mesh, a, b) {
  _d.subVectors(b, a);
  const len = Math.max(0.01, _d.length());
  mesh.position.copy(a).addScaledVector(_d, 0.5);
  mesh.scale.set(1, len, 1);
  _q.setFromUnitVectors(_up, _d.normalize());
  mesh.quaternion.copy(_q);
}
function makeSign(text, sub, fg, bg, wide) {
  const W = wide ? 2048 : 1024, H = wide ? 200 : 256;
  const c = document.createElement('canvas'); c.width = W; c.height = H;
  const g = c.getContext('2d');
  g.fillStyle = bg; g.fillRect(0, 0, W, H);
  g.strokeStyle = fg; g.lineWidth = wide ? 8 : 10; g.strokeRect(12, 12, W - 24, H - 24);
  g.fillStyle = fg; g.textAlign = 'center';
  const fit = (txt, weight, px, family) => {
    let size = px;
    g.font = weight + ' ' + size + 'px ' + family;
    const w = g.measureText(txt).width;
    if (w > W * 0.92) { size = Math.floor(size * (W * 0.92) / w); g.font = weight + ' ' + size + 'px ' + family; }
    return size;
  };
  fit(text, '800', wide ? 96 : 96, 'system-ui, sans-serif');
  g.fillText(text, W / 2, sub ? H * 0.48 : H * 0.63);
  if (sub) { fit(sub, '600', wide ? 46 : 44, 'ui-monospace, monospace'); g.globalAlpha = .85; g.fillText(sub, W / 2, H * 0.8); }
  const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return new THREE.MeshBasicMaterial({ map: tex });
}

/* ------------------------------- the road -------------------------------- */
/* Poured concrete causeway. Dead straight — the lab built it, the jungle is
   eating it: expansion joints, hairline cracks, moss in the low spots.       */
function roadTexture() {
  const c = document.createElement('canvas'); c.width = 512; c.height = 512;
  const g = c.getContext('2d');
  g.fillStyle = '#2a3034'; g.fillRect(0, 0, 512, 512);
  g.fillStyle = '#2f363b'; g.fillRect(6, 6, 500, 500);
  /* poured slab joints */
  g.strokeStyle = '#1d2327'; g.lineWidth = 4;
  g.beginPath(); g.moveTo(0, 132); g.lineTo(512, 132); g.moveTo(0, 388); g.lineTo(512, 388); g.stroke();
  g.strokeStyle = 'rgba(255,255,255,.045)'; g.lineWidth = 2;
  g.beginPath(); g.moveTo(0, 136); g.lineTo(512, 136); g.moveTo(0, 392); g.lineTo(512, 392); g.stroke();
  /* hairline cracks */
  g.strokeStyle = 'rgba(13,17,19,.85)';
  for (let i = 0; i < 10; i++) {
    g.lineWidth = rand(0.7, 2.1);
    let x = rand(0, 512), y = rand(0, 512);
    g.beginPath(); g.moveTo(x, y);
    for (let k = 0; k < 5; k++) { x += rand(-40, 40); y += rand(-40, 40); g.lineTo(x, y); }
    g.stroke();
  }
  /* half-worn guidance dashes */
  g.fillStyle = 'rgba(31,94,255,.42)';
  for (let y = 46; y < 512; y += 128) {
    if (g.roundRect) { g.beginPath(); g.roundRect(251, y, 11, 54, 5); g.fill(); } else g.fillRect(251, y, 11, 54);
  }
  /* moss in the joints + old oil */
  g.fillStyle = 'rgba(48,196,120,.05)';
  for (let i = 0; i < 14; i++) { g.beginPath(); g.arc(rand(0, 512), rand(0, 512), rand(9, 34), 0, 7); g.fill(); }
  g.fillStyle = 'rgba(7,9,11,.3)';
  for (let i = 0; i < 6; i++) { g.beginPath(); g.ellipse(rand(0, 512), rand(0, 512), rand(7, 22), rand(4, 13), rand(0, 3), 0, 7); g.fill(); }
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping; t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}
function buildRibbon(y, extraFn, mat, vScale) {
  const step = 5, from = -40, to = TRACK_LEN + 30;
  const n = Math.floor((to - from) / step) + 1;
  const pos = new Float32Array(n * 2 * 3), uv = new Float32Array(n * 2 * 2), norA = new Float32Array(n * 2 * 3);
  const idx = [];
  const p = new THREE.Vector3();
  for (let i = 0; i < n; i++) {
    const s = from + i * step;
    const w = halfAt(clamp(s, 0, TRACK_LEN)) + extraFn(s);
    trackPos(s, -w, y, p); pos.set([p.x, p.y, p.z], i * 6);
    trackPos(s, w, y, p); pos.set([p.x, p.y, p.z], i * 6 + 3);
    uv.set([0, s / (vScale || 10)], i * 4); uv.set([1, s / (vScale || 10)], i * 4 + 2);
    norA.set([0, 1, 0], i * 6); norA.set([0, 1, 0], i * 6 + 3);
    if (i < n - 1) { const a = i * 2; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  geo.setAttribute('normal', new THREE.BufferAttribute(norA, 3));
  geo.setIndex(idx);
  const mesh = new THREE.Mesh(geo, mat);
  mesh.receiveShadow = true;
  return mesh;
}
const roadMat = new THREE.MeshStandardMaterial({ map: roadTexture(), roughness: .82, metalness: .06 });
scene.add(buildRibbon(0, () => 0.7, roadMat, 11));
const inBridge = s => s > 470 && s < 710;
/* concrete apron = the lab's hard-standing, cracked and half-swallowed */
scene.add(buildRibbon(-0.08, s => inBridge(s) ? 1.7 : 8.6, M.apron, 13));

const jungleFloor = new THREE.Mesh(new THREE.PlaneGeometry(700, TRACK_LEN + 500), M.ground);
jungleFloor.rotation.x = -Math.PI / 2; jungleFloor.position.set(0, -7, -(TRACK_LEN / 2));
jungleFloor.receiveShadow = true; scene.add(jungleFloor);

/* ------------------- overgrowth, lab props & passages -------------------- */
const worldGroup = new THREE.Group(); scene.add(worldGroup);
/* side passages: real corridors branching off the causeway (set dressing, but
   you can see the lab is a whole building, not a corridor painted on a wall) */
const PASSAGES = [
  { s: 96, side: 1, len: 20, name: 'INTAKE 1' },
  { s: 262, side: -1, len: 24, name: 'SPECIMEN STORE' },
  { s: 424, side: 1, len: 18, name: 'COOLANT LOOP' },
  { s: 742, side: -1, len: 22, name: 'CHEM STORE B' },
  { s: 872, side: 1, len: 26, name: 'WARD 4' },
  { s: 1108, side: -1, len: 20, name: 'MAINTENANCE' },
  { s: 1330, side: 1, len: 18, name: 'EXIT 9' },
];
{
  const p = new THREE.Vector3(), p2 = new THREE.Vector3(), dummy = new THREE.Object3D();
  let _seed = 20261021;
  const srnd = () => ((_seed = (Math.imul(_seed, 1103515245) + 12345) & 0x7fffffff) / 0x7fffffff);
  const sr = (a, b) => a + srnd() * (b - a);
  const pick = arr => arr[Math.floor(srnd() * arr.length)];
  const col = new THREE.Color();

  /* ---------------- shared prop meshes ---------------- */
  const drumGeo = new THREE.CylinderGeometry(0.42, 0.42, 1.12, 12);
  const hoopGeo = new THREE.TorusGeometry(0.44, 0.05, 4, 10);
  const drumMats = { blue: M.drumBlue, red: M.drumRed, yellow: M.drumYellow, rust: M.rust };
  function drum(parent, x, y, z, key, tipped, rot) {
    const g = new THREE.Group();
    const body = new THREE.Mesh(drumGeo, drumMats[key]); body.castShadow = body.receiveShadow = true;
    g.add(body);
    for (const yy of [-0.22, 0.22]) {
      const hp = new THREE.Mesh(hoopGeo, M.rust); hp.rotation.x = Math.PI / 2; hp.position.y = yy; g.add(hp);
    }
    g.position.set(x, y + (tipped ? 0.42 : 0.56), z);
    if (tipped) { g.rotation.z = Math.PI / 2; g.rotation.y = rot || 0; }
    else g.rotation.y = rot || 0;
    parent.add(g);
    return g;
  }
  function crate(parent, x, z, s) {
    const c = box(s, s * 0.8, s * 0.9, pick([M.labGrey, M.rust, M.concreteDark]), x, s * 0.4, z);
    c.rotation.y = sr(0, 3.1); parent.add(c);
    if (srnd() < .5) parent.add(box(s * 0.9, 0.06, s * 0.7, M.labDark, x, s * 0.81, z));
    return c;
  }
  function consoleUnit(parent, x, z, rotY, screenMat) {
    const g = new THREE.Group(); g.position.set(x, 0, z); g.rotation.y = rotY;
    g.add(box(1.15, 1.3, 0.68, M.labGrey, 0, 0.65, 0));
    g.add(box(1.28, 0.1, 0.82, M.labDark, 0, 1.34, 0));
    const scr = new THREE.Mesh(new THREE.PlaneGeometry(0.86, 0.52), screenMat || M.screenGreen);
    scr.position.set(0, 0.98, 0.35); g.add(scr);
    g.add(box(0.54, 0.05, 0.26, M.labDark, 0, 0.86, 0.42));
    parent.add(g); return g;
  }
  function gurney(parent, x, z, rot) {
    const g = new THREE.Group(); g.position.set(x, 0, z); g.rotation.y = rot;
    g.add(box(0.86, 0.1, 1.9, M.steel, 0, 0.78, 0));
    for (const dx of [-0.35, 0.35]) for (const dz of [-0.8, 0.8]) g.add(box(0.06, 0.76, 0.06, M.steel, dx, 0.38, dz));
    const body = sph(0.44, M.gore, 0, 0.92, sr(-0.2, 0.2), 0.85, 0.5, 2.0);
    g.add(body);
    parent.add(g); return g;
  }
  function gasCyl(parent, x, z) {
    const g = new THREE.Group(); g.position.set(x, 0, z); g.rotation.y = sr(0, 3.1);
    g.add(cyl(0.19, 0.19, 1.35, pick([M.drumBlue, M.drumRed]), 0, 0.68, 0, 10));
    g.add(cyl(0.06, 0.06, 0.22, M.steel, 0, 1.45, 0, 6));
    g.add(sph(0.12, M.amberGlow, 0, 1.58, 0));
    parent.add(g); return g;
  }
  function specimenTank(parent, x, z, rot, broken) {
    const g = new THREE.Group(); g.position.set(x, 0, z); g.rotation.y = rot;
    g.add(box(2.3, 0.42, 2.3, M.labDark, 0, 0.21, 0));
    if (!broken) {
      const glass = cyl(1.05, 1.05, 3.2, M.glass, 0, 2.0, 0, 16); g.add(glass);
      g.add(cyl(0.13, 0.2, 2.0, M.stem, 0, 1.5, 0, 6));
      g.add(blob(0.85, M.leaf, sr(-.2, .2), sr(2.4, 2.9), 0, 1));
    }
    g.add(box(2.3, 0.3, 2.3, M.labGrey, 0, 3.7, 0));
    g.add(sph(0.1, M.amberGlow, 0, 3.95, 0));
    if (broken) {                                    // it got out
      for (let i = 0; i < 4; i++) g.add(blob(sr(.6, 1.2), pick([M.leaf, M.leafDark, M.stem]), sr(-1.3, 1.3), sr(.4, 1.6), sr(-1.3, 1.3), 1));
      g.add(cyl(0.11, 0.17, sr(2, 3.4), M.stem, sr(-.5, .5), sr(1.6, 2.2), sr(-.5, .5), 6));
    }
    parent.add(g); return g;
  }

  /* ---------------- broken concrete shoulders ---------------- */
  const NSL = 300;
  const slabMesh = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), M.concrete, NSL);
  for (let i = 0; i < NSL; i++) {
    const s = sr(-20, TRACK_LEN + 20), half = halfAt(clamp(s, 0, TRACK_LEN));
    const side = srnd() < .5 ? -1 : 1;
    trackPos(s, side * (half + sr(0.5, 8.2)), sr(-0.17, 0.05), p);
    dummy.position.copy(p);
    dummy.rotation.set(sr(-.05, .05), sr(0, 6.28), sr(-.05, .05));
    dummy.scale.set(sr(0.8, 3.2), sr(0.14, 0.38), sr(0.8, 3.8));
    dummy.updateMatrix(); slabMesh.setMatrixAt(i, dummy.matrix);
    slabMesh.setColorAt(i, col.setHSL(0.55, 0.05, sr(0.22, 0.42)));
  }
  slabMesh.receiveShadow = true; worldGroup.add(slabMesh);

  /* ---------------- cracks & puddles on the tarmac ---------------- */
  const crackTex = (() => {
    const c = document.createElement('canvas'); c.width = 256; c.height = 256;
    const g = c.getContext('2d'); g.clearRect(0, 0, 256, 256);
    g.strokeStyle = 'rgba(10,13,15,.9)';
    for (let i = 0; i < 5; i++) {
      g.lineWidth = rand(1, 3.2); g.beginPath();
      let x = rand(30, 226), y = rand(30, 226); g.moveTo(x, y);
      for (let k = 0; k < 5; k++) { x += rand(-52, 52); y += rand(-52, 52); g.lineTo(x, y); }
      g.stroke();
    }
    g.fillStyle = 'rgba(55,224,139,.14)';
    for (let i = 0; i < 14; i++) { g.beginPath(); g.arc(rand(0, 256), rand(0, 256), rand(3, 11), 0, 7); g.fill(); }
    const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
  })();
  const crackMat = new THREE.MeshBasicMaterial({ map: crackTex, transparent: true, depthWrite: false, opacity: .85 });
  const crackGeo = new THREE.PlaneGeometry(1, 1); crackGeo.rotateX(-Math.PI / 2);
  for (let i = 0; i < 34; i++) {
    const s = sr(10, FINISH_S), lat = sr(-4.5, 4.5);
    const m = new THREE.Mesh(crackGeo, crackMat);
    m.position.set(0, 0.022, 0); const g = new THREE.Group();
    trackPos(s, lat, 0.022, p); g.position.copy(p); g.rotation.y = sr(0, 6.28);
    m.scale.set(sr(5, 13), 1, sr(5, 13)); g.add(m); worldGroup.add(g);
  }
  const puddleMat = new THREE.MeshStandardMaterial({ color: 0x18322c, roughness: .04, metalness: .35, transparent: true, opacity: .85 });
  const puddleGeo = new THREE.CircleGeometry(1, 18); puddleGeo.rotateX(-Math.PI / 2);
  for (let i = 0; i < 16; i++) {
    const s = sr(30, FINISH_S), lat = sr(-5, 5), r = sr(0.9, 2.6);
    const m = new THREE.Mesh(puddleGeo, puddleMat);
    trackPos(s, lat, 0.015, p); m.position.copy(p);
    m.scale.set(r, 1, r * sr(.5, .9)); m.rotation.y = sr(0, 3.1);
    worldGroup.add(m);
  }

  /* ---------------- grass pushing through the cracks ---------------- */
  const bladeGeo = new THREE.ConeGeometry(0.075, 1, 4);
  const NBLADE = 420;
  const blades = new THREE.InstancedMesh(bladeGeo, M.leafDark, NBLADE);
  for (let i = 0; i < NBLADE; i++) {
    const s = sr(-10, TRACK_LEN + 10), half = halfAt(clamp(s, 0, TRACK_LEN));
    const edge = srnd() < .55;
    const lat = edge ? (srnd() < .5 ? -1 : 1) * (half + sr(-1.4, 3.4)) : sr(-half + 1, half - 1);
    trackPos(s, lat, 0, p);
    dummy.position.set(p.x, sr(0, 0.05), p.z);
    dummy.rotation.set(sr(-.25, .25), sr(0, 6.28), sr(-.25, .25));
    dummy.scale.set(sr(.7, 1.5), sr(.35, 1.2), sr(.7, 1.5));
    dummy.updateMatrix(); blades.setMatrixAt(i, dummy.matrix);
    blades.setColorAt(i, col.setHSL(sr(.24, .34), sr(.45, .8), sr(.16, .34)));
  }
  worldGroup.add(blades);

  /* ---------------- the jungle itself, beyond the walls ---------------- */
  const jungleGeo = new THREE.IcosahedronGeometry(1, 0);
  const NJ = 180;
  const jungle = new THREE.InstancedMesh(jungleGeo, M.leafDark, NJ);
  for (let i = 0; i < NJ; i++) {
    const s = sr(-30, TRACK_LEN + 30), half = halfAt(clamp(s, 0, TRACK_LEN));
    const side = srnd() < .5 ? -1 : 1;
    const lat = side * (half + sr(9, 34));
    trackPos(s, lat, sr(-6, 11), p);
    dummy.position.copy(p);
    dummy.rotation.set(sr(0, 3), sr(0, 3), sr(0, 3));
    dummy.scale.set(sr(3, 9), sr(2, 6), sr(3, 9));
    dummy.updateMatrix(); jungle.setMatrixAt(i, dummy.matrix);
    jungle.setColorAt(i, col.setHSL(sr(.27, .36), sr(.4, .7), sr(.10, .24)));
  }
  worldGroup.add(jungle);

  /* ---------------- wall segments, broken and overgrown ---------------- */
  const winMat = new THREE.MeshStandardMaterial({ color: 0x8fd8ff, emissive: 0x2f7fd8, emissiveIntensity: .85 });
  const roomMat = new THREE.MeshStandardMaterial({ color: 0x070e12, roughness: 1 });
  const stopper = (s, side) => PASSAGES.some(pg => pg.side === side && Math.abs(pg.s - s) < 15);
  const STEP = 20;
  for (let s0 = -20; s0 < TRACK_LEN + 26; s0 += STEP) {
    const s = s0 + sr(-2, 2), mid = s + STEP / 2;
    const half = halfAt(clamp(mid, 0, TRACK_LEN)), f = frameAt(mid);
    for (const side of [-1, 1]) {
      if (inBridge(mid)) {
        /* bridge: steel rail + pier, jungle below */
        const rail = new THREE.Group();
        trackPos(mid, side * (half + 1.4), 0, p); rail.position.copy(p); rail.rotation.y = f.yaw;
        rail.add(box(0.2, 0.2, STEP - 1, M.steel, 0, 1.15, 0));
        rail.add(box(0.13, 0.13, STEP - 1, M.steel, 0, 0.62, 0));
        for (let k = -8; k <= 8; k += 4) rail.add(box(0.15, 1.25, 0.15, M.labDark, 0, 0.62, k));
        rail.add(box(1.7, 8, 1.7, M.concreteDark, 0, -4.1, 0));
        /* railing planters — where the epiphyte blooms sit */
        if (srnd() < .6) rail.add(box(1.0, 0.4, 1.5, M.rust, -side * 0.2, 1.35, sr(-6, 6)));
        if (srnd() < .5) for (let k = 0; k < 3; k++) rail.add(blob(sr(.3, .7), pick([M.leaf, M.leafDark]), sr(-.3, .3), sr(1.4, 2.1), sr(-8, 8), 1));
        worldGroup.add(rail);
        continue;
      }
      if (stopper(mid, side)) continue;               // passage punches a hole here
      const g = new THREE.Group();
      trackPos(mid, side * (half + 6.8), 0, p); g.position.copy(p); g.rotation.y = f.yaw;
      const kind = srnd();
      if (kind < .5) {
        /* intact lab wall: panel, pipe run, window into a dark room */
        const hgt = sr(5.6, 7.4);
        g.add(box(0.85, hgt, STEP - 1.4, srnd() < .55 ? M.labWhite : M.labGrey, 0, hgt / 2, 0));
        const pipe = cyl(0.13, 0.13, STEP - 1.2, M.steel, -side * 0.55, hgt * .74, 0, 6);
        pipe.rotation.x = Math.PI / 2; g.add(pipe);
        if (srnd() < .62) {
          const w = sr(6, 14), y = sr(3.1, 4.5);
          g.add(box(w + 0.5, 2.5, 0.3, M.labDark, -side * 0.42, y, 0));
          const glass = new THREE.Mesh(new THREE.PlaneGeometry(w, 2.1), winMat);
          glass.position.set(-side * 0.56, y, 0); glass.rotation.y = side > 0 ? -Math.PI / 2 : Math.PI / 2;
          g.add(glass);
          const back = new THREE.Mesh(new THREE.PlaneGeometry(w, 2.4), roomMat);
          back.position.set(-side * 0.5, y - 0.1, 0); back.rotation.y = side > 0 ? -Math.PI / 2 : Math.PI / 2;
          back.position.y = y;
          g.add(back);
        }
        if (srnd() < .55) g.add(blob(sr(1.2, 2.8), pick([M.leaf, M.leafDark]), sr(-.5, .5), hgt + sr(-.3, .5), sr(-8, 8), 1));
        if (srnd() < .5) { const v = cyl(0.07, 0.1, sr(2, 4.6), M.vine, -side * 0.7, sr(3.4, 4.6), sr(-9, 9), 6); g.add(v); }
        if (srnd() < .35) consoleUnit(g, -side * 0.7, sr(-7, 7), side > 0 ? -Math.PI / 2 : Math.PI / 2, srnd() < .5 ? M.screenGreen : M.screenBlue);
      } else if (kind < .82) {
        /* the wall is half-eaten: a low broken stub with jungle pouring over it */
        const hgt = sr(1.2, 3.4);
        g.add(box(0.9, hgt, STEP - 2.2, M.concreteDark, 0, hgt / 2, 0));
        for (let k = 0; k < 5; k++) g.add(blob(sr(.8, 1.9), pick([M.leafDark, M.leaf, M.stem]), sr(-.6, .6), hgt + sr(-.2, 2.2), sr(-8, 8), 1));
        for (let k = 0; k < 2; k++) g.add(cyl(0.1, 0.16, sr(2, 4.2), M.stem, sr(-.5, .5), hgt + 1.4, sr(-7, 7), 6));
        if (srnd() < .5) g.add(box(sr(1.4, 2.6), 0.5, sr(1.4, 2.6), M.concreteDark, sr(-.4, .4), hgt + 0.2, sr(-6, 6)));
      } else {
        /* fully collapsed: only a doorway frame and hanging cables remain */
        for (const dz of [-1, 1]) g.add(box(0.6, sr(4, 6.4), 0.6, M.labDark, 0, 2.4, dz * (STEP / 2 - 2)));
        g.add(box(0.55, 0.4, STEP - 3.5, M.labDark, 0, 5.2, 0));
        for (let k = 0; k < 3; k++) g.add(cyl(0.05, 0.05, sr(2, 5), M.labDark, sr(-.4, .4), sr(3.4, 4.8), sr(-8, 8), 5));
        for (let k = 0; k < 4; k++) g.add(blob(sr(1, 2.4), pick([M.leaf, M.leafDark]), sr(-1, 1), sr(.4, 3.6), sr(-9, 9), 1));
      }
      worldGroup.add(g);
    }
  }

  /* ---------------- lab props scattered along the apron ---------------- */
  const screenKeys = ['green', 'blue'];
  for (let s = 40; s < FINISH_S - 30; s += sr(26, 44)) {
    const half = halfAt(s), side = srnd() < .5 ? -1 : 1;
    const lat = side * (half + sr(1.4, 6.2));
    const f = frameAt(s);
    const g = new THREE.Group(); trackPos(s, lat, 0, p); g.position.copy(p); g.rotation.y = f.yaw;
    const kind = srnd();
    if (kind < .34) {
      /* drum cluster, one tipped and leaking */
      drum(g, sr(-.5, .5), 0, sr(-1.4, 1.4), pick(['blue', 'red', 'yellow']), false, sr(0, 3));
      drum(g, sr(-1.4, 1.4), 0, sr(-1.6, 1.6), pick(['rust', 'yellow', 'blue']), srnd() < .5, sr(0, 3));
      if (srnd() < .5) drum(g, sr(-1, 1), 0, sr(-2, 2), 'red', true, sr(0, 3));
      if (srnd() < .4) g.add(box(1.1, 0.7, 1.0, M.rust, sr(-.8, .8), .35, sr(-1.2, 1.2)));
    } else if (kind < .55) {
      crate(g, sr(-1, 1), sr(-1.5, 1.5), sr(.9, 1.7));
      crate(g, sr(-1.4, 1.4), sr(-1.5, 1.5), sr(.7, 1.3));
      if (srnd() < .5) gasCyl(g, sr(-1, 1), sr(-1.5, 1.5));
    } else if (kind < .72) {
      consoleUnit(g, 0, 0, sr(-.4, .4), srnd() < .5 ? M.screenGreen : M.screenBlue);
      if (srnd() < .6) gurney(g, side * sr(1.5, 3), sr(-2, 2), sr(0, 3.1));
    } else if (kind < .88) {
      specimenTank(g, 0, 0, f.yaw + sr(-.3, .3), srnd() < .55);
    } else {
      gurney(g, 0, 0, sr(0, 3.1));
      if (srnd() < .6) gurney(g, side * sr(1.6, 3.2), sr(-2.2, 2.2), sr(0, 3.1));
      for (let k = 0; k < 3; k++) g.add(box(sr(.3, .7), sr(.2, .8), sr(.3, .7), M.labDark, sr(-2, 2), .3, sr(-2, 2)));
    }
    worldGroup.add(g);
  }

  /* ---------------- side passages ---------------- */
  function sidePassage(pg) {
    const f = frameAt(pg.s), half = halfAt(pg.s), side = pg.side, len = pg.len;
    const g = new THREE.Group();
    trackPos(pg.s, side * (half + 6.8), 0, p);
    g.position.copy(p); g.rotation.y = f.yaw; worldGroup.add(g);
    const midX = side * len / 2;
    /* slab floor + walls + ceiling running away from the causeway */
    g.add(box(len, 0.5, 8.1, M.concrete, midX, -0.25, 0));
    for (const dz of [-4, 4]) g.add(box(len, 4.4, 0.55, M.labGrey, midX, 2.2, dz));
    g.add(box(len, 0.45, 8.3, M.labDark, midX, 4.5, 0));
    /* ceiling light strips */
    for (let i = 0; i < 3; i++) g.add(box(len * .22, 0.07, 0.42, M.lightStrip, side * (len * (0.2 + i * 0.28)), 4.24, 0));
    /* supports down into the ravine */
    for (const dz of [-3, 3]) g.add(box(0.8, 7, 0.8, M.concreteDark, side * (len - 1.2), -3.5, dz));
    /* doorway frame + hazard chevrons at the mouth */
    for (const dz of [-4.2, 4.2]) g.add(box(0.5, 5.0, 0.5, M.labDark, 0, 2.5, dz));
    g.add(box(0.55, 0.6, 9, M.labDark, 0, 5.2, 0));
    const stripeTex = (() => {
      const c = document.createElement('canvas'); c.width = 128; c.height = 32;
      const gg = c.getContext('2d'); gg.fillStyle = '#ffb020'; gg.fillRect(0, 0, 128, 32);
      gg.fillStyle = '#141414';
      for (let x = -32; x < 128; x += 24) { gg.beginPath(); gg.moveTo(x, 32); gg.lineTo(x + 12, 0); gg.lineTo(x + 24, 0); gg.lineTo(x + 12, 32); gg.fill(); }
      const t = new THREE.CanvasTexture(c); t.wrapS = THREE.RepeatWrapping; t.repeat.x = 4; return t;
    })();
    const stripe = new THREE.Mesh(new THREE.PlaneGeometry(8.2, 0.5), new THREE.MeshBasicMaterial({ map: stripeTex }));
    stripe.position.set(side * 0.3, 0.42, 0); stripe.rotation.y = -side * Math.PI / 2; g.add(stripe);
    /* hanging sign over the mouth, angled to the driver */
    const sign = new THREE.Mesh(new THREE.PlaneGeometry(6.2, 1.5), makeSign(pg.name, 'AUTHORISED PERSONNEL', '#ffb020', '#101418'));
    sign.position.set(-side * 1.3, 4.3, 0); g.add(sign);
    /* contents: a lit room, equipment piled inside, roots coming through the roof */
    g.add(box(0.2, 3.6, 7.4, roomMat, side * (len - 0.4), 1.9, 0));
    if (hashRnd(pg.s) < 0.5) {
      const lamp = new THREE.PointLight(0x9fe6ff, 26, 34, 2);
      lamp.position.set(side * (len * 0.6), 3.4, 0); g.add(lamp);
    }
    for (let i = 0; i < 3; i++) drum(g, side * sr(3, len - 2), 0, sr(-2.6, 2.6), pick(['blue', 'yellow', 'rust']), srnd() < .35, sr(0, 3));
    if (srnd() < .8) consoleUnit(g, side * sr(4, len - 3), sr(-2, 2), side * Math.PI / 2, M.screenGreen);
    if (srnd() < .7) specimenTank(g, side * sr(5, len - 3), sr(-2.2, 2.2), sr(0, 3), srnd() < .6);
    if (srnd() < .6) gurney(g, side * sr(6, len - 4), sr(-2.0, 2.0), sr(0, 3.1));
    for (let i = 0; i < 5; i++) {
      const rz = sr(-3.8, 3.8), rx = side * sr(1, len - 1);
      const root = cyl(0.08, 0.14, sr(1.5, 4), M.stem, rx, 4.1 - sr(0, 1.5), rz, 5);
      root.rotation.x = sr(-.3, .3); root.rotation.z = sr(-.3, .3); g.add(root);
    }
    for (let i = 0; i < 4; i++) g.add(blob(sr(.7, 1.6), pick([M.leaf, M.leafDark]), sr(-2, 2) + side * sr(0, 2), sr(0, .8), sr(-3.6, 3.6), 1));
    return g;
  }
  PASSAGES.forEach(sidePassage);

  /* ---------------- overhead canopy, cables, lamps, light shafts ---------------- */
  const leafGeo = new THREE.IcosahedronGeometry(1, 0);
  const leafMat = new THREE.MeshStandardMaterial({ roughness: .95, flatShading: true });
  const NL = 620, leaves = new THREE.InstancedMesh(leafGeo, leafMat, NL);
  for (let i = 0; i < NL; i++) {
    const s = sr(-10, TRACK_LEN + 10), half = halfAt(clamp(s, 0, TRACK_LEN));
    const overhead = srnd() < .7;
    const lat = overhead ? sr(-half - 3, half + 3) : (srnd() < .5 ? -1 : 1) * (half + sr(4, 16));
    const y = overhead ? sr(7.4, 13.2) : sr(-6.2, -3.4);
    trackPos(s, lat, y, p);
    dummy.position.copy(p);
    dummy.rotation.set(sr(0, 3), sr(0, 3), sr(0, 3));
    dummy.scale.set(sr(1.2, 3.4), sr(.5, 1.1), sr(1.2, 3.4));
    dummy.updateMatrix(); leaves.setMatrixAt(i, dummy.matrix);
    leaves.setColorAt(i, col.setHSL(sr(.26, .38), sr(.5, .8), sr(.18, .4)));
  }
  worldGroup.add(leaves);

  /* hanging vines — some thick enough to grab you (that's the grabbers) */
  const vineGeo = new THREE.CylinderGeometry(0.07, 0.1, 1, 5);
  const NV = 230, vines = new THREE.InstancedMesh(vineGeo, M.vine, NV);
  for (let i = 0; i < NV; i++) {
    const s = sr(0, TRACK_LEN), half = halfAt(s);
    const lat = (srnd() < .5 ? -1 : 1) * sr(half - 2.2, half + 6);
    const len = sr(1.6, 6);
    trackPos(s, lat, 9.6 - len / 2, p);
    dummy.position.copy(p); dummy.rotation.set(sr(-.08, .08), 0, sr(-.08, .08));
    dummy.scale.set(1, len, 1); dummy.updateMatrix(); vines.setMatrixAt(i, dummy.matrix);
  }
  worldGroup.add(vines);

  /* roots crossing the verge, cracking the apron */
  const NR = 70, roots = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.16, 0.26, 1, 6), M.bark, NR);
  for (let i = 0; i < NR; i++) {
    const s = sr(0, TRACK_LEN), half = halfAt(s), side = srnd() < .5 ? -1 : 1;
    trackPos(s, side * (half + sr(1.5, 5.5)), 0.16, p);
    dummy.position.copy(p);
    dummy.rotation.set(0, sr(0, 3.14), Math.PI / 2 + sr(-.12, .12));
    dummy.scale.set(1, sr(2, 5.5), 1);
    dummy.updateMatrix(); roots.setMatrixAt(i, dummy.matrix);
  }
  worldGroup.add(roots);

  /* ceiling trusses: every span intact, plus a handful that came down */
  for (let s = 14; s < TRACK_LEN; s += sr(24, 36)) {
    const half = halfAt(s), f = frameAt(s);
    trackPos(s, 0, 9.3 + sr(-.4, .5), p);
    const beam = box((half + 7) * 2, 0.5, 0.9, M.labDark, p.x, p.y, p.z);
    beam.rotation.y = f.yaw; worldGroup.add(beam);
    if (srnd() < .5) {
      const lampGrp = new THREE.Group();
      trackPos(s, sr(-half * .5, half * .5), 9.0, p2); lampGrp.position.copy(p2);
      lampGrp.add(cyl(0.035, 0.035, 1.6, M.labDark, 0, 0.8, 0, 4));
      const shade = cyl(0.55, 0.22, 0.35, M.labDark, 0, 0, 0, 10);
      lampGrp.add(shade);
      const bulb = sph(0.3, M.amberGlow, 0, -0.18, 0); bulb.castShadow = false; lampGrp.add(bulb);
      lampGrp.rotation.z = sr(-.16, .16);
      worldGroup.add(lampGrp);
    }
  }
  /* four collpased spans, hand-placed so they never overlap a fork or a door */
  const FALLEN = [
    { s: 348, side: 1, tilt: 0.62 },
    { s: 612, side: -1, tilt: 0.78 },
    { s: 1004, side: 1, tilt: 0.55 },
    { s: 1291, side: -1, tilt: 0.7 },
  ];
  for (const fb of FALLEN) {
    const half = halfAt(fb.s), f = frameAt(fb.s);
    trackPos(fb.s, fb.side * (half - 1.5), 0.32, p);           // resting on the shoulder
    trackPos(fb.s - 4.5, fb.side * (half + 1.6), 6.4, p2);     // torn from the ceiling
    const g = new THREE.Group();
    const beam = new THREE.Mesh(new THREE.BoxGeometry(0.55, 1, 0.85), M.rust);
    beam.castShadow = beam.receiveShadow = true;
    stemBetween(beam, p2.clone(), p);                          // point b -> point a
    worldGroup.add(beam);
    g.position.copy(p);
    for (let k = 0; k < 5; k++) {                              // debris where it hit
      const chunk = box(sr(.5, 1.3), sr(.2, .5), sr(.5, 1.2), M.concreteDark, sr(-1.4, 1.4), sr(.08, .2), sr(-1.6, 1.6));
      chunk.rotation.y = sr(0, 3); g.add(chunk);
    }
    for (let k = 0; k < 3; k++) {                              // snapped cable whipping about
      const c2 = cyl(0.035, 0.035, sr(2.4, 5), M.labDark, sr(-.4, .4), sr(0.3, 1.6), sr(-.6, .6), 4);
      c2.rotation.set(sr(-1.2, 1.2), 0, sr(-.6, .6)); g.add(c2);
    }
    g.add(sph(0.14, M.amberGlow, 0, 0.2, 0));
    worldGroup.add(g);
  }

  /* shafts of daylight through the broken roof */
  const shaftMat = new THREE.MeshBasicMaterial({ color: 0xd6ffe6, transparent: true, opacity: .026, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide });
  for (let i = 0; i < 12; i++) {
    const s = sr(40, FINISH_S), half = halfAt(s);
    const h = sr(12, 19);
    const shaft = new THREE.Mesh(new THREE.ConeGeometry(sr(2.2, 4.4), h, 9, 1, true), shaftMat);
    trackPos(s, sr(-half * .7, half * .7), h / 2 + 1.5, p);
    shaft.position.copy(p); shaft.rotation.z = sr(-.07, .07);
    worldGroup.add(shaft);
  }

  /* ---------------- gantries, finish pad, zone signs ---------------- */
  function gantry(s, title, sub, fg, bg) {
    const g = new THREE.Group(), f = frameAt(s), half = halfAt(s);
    trackPos(s, 0, 0, p); g.position.copy(p); g.rotation.y = f.yaw;
    for (const side of [-1, 1]) g.add(box(0.9, 7.6, 0.9, M.labGrey, side * (half + 1.4), 3.8, 0));
    g.add(box((half + 1.4) * 2 + 1, 1.9, 0.7, M.labDark, 0, 7.4, 0));
    const sign = new THREE.Mesh(new THREE.PlaneGeometry((half + 1.4) * 2, 1.7), makeSign(title, sub, fg, bg, true));
    sign.position.set(0, 7.4, 0.38); g.add(sign);        // faces back down-track at the driver
    for (let k = 0; k < 4; k++) g.add(blob(sr(.8, 1.8), pick([M.leaf, M.leafDark]), sr(-half, half), 7.6 + sr(0, .6), sr(-.5, .5), 1));
    worldGroup.add(g);
  }
  gantry(4, 'BIO-LAB · C', 'CARNIVOROUS CANOPY — AUTHORISED VEHICLES ONLY', '#8dff57', '#0a140d');
  gantry(FINISH_S, '✦ EXTRACTION ✦', 'DECONTAMINATION BEYOND THIS POINT', '#ffffff', '#1f5eff');
  {
    const f = frameAt(FINISH_S + 8);
    trackPos(FINISH_S + 8, 0, 0.05, p);
    const pad = box(halfAt(FINISH_S) * 2, 0.1, 14, M.blueGlow, p.x, p.y, p.z);
    pad.rotation.y = f.yaw; pad.castShadow = false; worldGroup.add(pad);
  }
  ZONES.forEach((z, i) => {
    if (i === 0) return;
    const s = z.from + 6, f = frameAt(s), half = halfAt(s);
    trackPos(s, half + 2.2, 0, p);
    const g = new THREE.Group(); g.position.copy(p); g.rotation.y = f.yaw;
    g.add(box(0.25, 4.6, 0.25, M.labDark, 0, 2.3, 0));
    const sign = new THREE.Mesh(new THREE.PlaneGeometry(5.4, 1.35), makeSign('ZONE ' + (i + 1), z.name, '#8dff57', '#0a140d'));
    sign.position.set(-0.2, 4.4, 0); sign.rotation.y = -Math.PI / 2 + 0.5; g.add(sign);
    worldGroup.add(g);
  });
}

/* keep only the part of the causeway near the camera in the render list —
   with a dead-straight road three would otherwise submit the whole level */
const CULLABLES = [];
for (const o of worldGroup.children) {
  if (o.isInstancedMesh) continue;
  o.userData.cullS = -o.position.z;
  CULLABLES.push(o);
}
function cullWorld() {
  for (let i = 0; i < CULLABLES.length; i++) {
    const o = CULLABLES[i];
    const d = o.userData.cullS - P.s;
    o.visible = d > -70 && d < 185;
  }
}

/* ------------------------------ the vehicle ------------------------------ */
const car = new THREE.Group(); car.rotation.order = 'YXZ'; scene.add(car);
const carBodyMat = new THREE.MeshStandardMaterial({ color: 0xe8edf2, roughness: .35, metalness: .35, emissive: 0x000000 });
let wheels = [], frontAxleL, frontAxleR, brakeMat, vineWrap, cutterRing, cutterT = 99, headlight;
{
  const body = box(1.95, 0.55, 3.7, carBodyMat, 0, 0.62, 0); car.add(body);
  const nose = box(1.7, 0.34, 0.9, carBodyMat, 0, 0.5, -2.05); car.add(nose);
  const stripe = box(2.0, 0.2, 3.75, M.blueGlow, 0, 0.78, 0); stripe.castShadow = false; car.add(stripe);
  const cabin = box(1.55, 0.62, 1.7, new THREE.MeshStandardMaterial({ color: 0x12242e, roughness: .12, metalness: .4 }), 0, 1.18, 0.35);
  car.add(cabin);
  const spoiler = box(2.1, 0.09, 0.55, M.labDark, 0, 1.28, 1.95); car.add(spoiler);
  car.add(box(0.12, 0.5, 0.3, M.labDark, -0.85, 1.0, 1.95)); car.add(box(0.12, 0.5, 0.3, M.labDark, 0.85, 1.0, 1.95));
  /* front cutter bar — this thing mows plants for a living */
  const bar = box(2.4, 0.22, 0.35, M.labGrey, 0, 0.38, -2.55); car.add(bar);
  for (let i = -5; i <= 5; i++) { const t = cone(0.09, 0.42, M.teeth, i * 0.22, 0.38, -2.85); t.rotation.x = -Math.PI / 2; car.add(t); }
  /* headlights + spotlight */
  const hlMat = new THREE.MeshStandardMaterial({ color: 0xfff6cc, emissive: 0xffe98a, emissiveIntensity: 2.2 });
  car.add(box(0.34, 0.14, 0.06, hlMat, -0.62, 0.62, -2.5)); car.add(box(0.34, 0.14, 0.06, hlMat, 0.62, 0.62, -2.5));
  headlight = new THREE.SpotLight(0xfff2bb, 55, 62, 0.5, 0.55, 1.4);
  headlight.position.set(0, 0.8, -2.2); car.add(headlight);
  headlight.target.position.set(0, 0.2, -26); car.add(headlight.target);
  brakeMat = new THREE.MeshStandardMaterial({ color: 0xff2233, emissive: 0xff2233, emissiveIntensity: 0.5 });
  car.add(box(1.7, 0.13, 0.06, brakeMat, 0, 0.72, 1.87));
  /* wheels */
  const tireMat = new THREE.MeshStandardMaterial({ color: 0x14181c, roughness: .9 });
  const hubMat = new THREE.MeshStandardMaterial({ color: 0x9aa6b1, roughness: .3, metalness: .6 });
  function wheel(x, z, steerable) {
    const pivot = new THREE.Group(); pivot.position.set(x, 0.42, z);
    const w = new THREE.Group();
    const tire = cyl(0.42, 0.42, 0.34, tireMat, 0, 0, 0, 16); tire.rotation.z = Math.PI / 2; w.add(tire);
    const hub = cyl(0.2, 0.2, 0.37, hubMat, 0, 0, 0, 10); hub.rotation.z = Math.PI / 2; w.add(hub);
    pivot.add(w); car.add(pivot); wheels.push(w);
    return steerable ? pivot : null;
  }
  frontAxleL = wheel(-0.98, -1.45, true); frontAxleR = wheel(0.98, -1.45, true);
  wheel(-0.98, 1.45, false); wheel(0.98, 1.45, false);
  /* vine wrap (shown while grabbed) */
  vineWrap = new THREE.Group(); vineWrap.visible = false;
  for (let i = 0; i < 3; i++) {
    const ring = new THREE.Mesh(new THREE.TorusGeometry(1.25, 0.11, 7, 16), M.vine);
    ring.position.set(0, 0.75, -1 + i); ring.rotation.set(rand(0, .4), rand(0, .4), rand(0, .4));
    ring.scale.set(1, 0.72, 1); ring.castShadow = true; vineWrap.add(ring);
    vineWrap.add(blob(0.4, M.leaf, rand(-1, 1), 1.2, -1 + i, 1));
  }
  car.add(vineWrap);
  /* cutter pulse ring */
  cutterRing = new THREE.Mesh(new THREE.TorusGeometry(1, 0.055, 8, 44),
    new THREE.MeshBasicMaterial({ color: 0x8dff57, transparent: true, opacity: 0 }));
  cutterRing.rotation.x = Math.PI / 2; cutterRing.position.y = 0.5; car.add(cutterRing);
}

/* ------------- disguised blooms: showy flowers, some of them hungry ------ */
function buildBloom(petalMat, big, throatMat) {
  const grp = new THREE.Group();
  const k = big ? 1.24 : 0.9;
  const stemH = (big ? 1.9 : 1.45) * (0.86 + rand(0, 0.35));
  const stem = cyl(0.07 * k, 0.11 * k, stemH, M.stem, 0, stemH / 2, 0, 6);
  stem.rotation.z = rand(-0.13, 0.13);
  grp.add(stem);
  for (let i = 0; i < 2; i++) {
    const leaf = blob(rand(0.28, 0.46) * k, i % 2 ? M.leaf : M.leafDark,
      rand(-0.4, 0.4) * k, rand(0.3, stemH * 0.75), rand(-0.4, 0.4) * k, 1);
    leaf.scale.set(1, 0.32, 1.7); leaf.rotation.y = rand(0, 3);
    grp.add(leaf);
  }
  const head = new THREE.Group(); head.position.y = stemH; grp.add(head);
  /* six cupped outer petals — purely decorative */
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * Math.PI * 2;
    const petal = sph(0.44 * k, petalMat, Math.cos(a) * 0.34 * k, -0.02, Math.sin(a) * 0.34 * k, 1.15, 0.3, 1.6);
    petal.rotation.y = -a + Math.PI / 2; petal.rotation.z = 0.42;
    petal.castShadow = false;
    head.add(petal);
  }
  const throat = sph(0.33 * k, throatMat || M.throat, 0, 0.02, 0, 1, 0.62, 1);
  head.add(throat);
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * Math.PI * 2 + 0.4;
    const t = cone(0.055 * k, 0.2 * k, M.teeth, Math.cos(a) * 0.25 * k, 0.08, Math.sin(a) * 0.25 * k);
    t.rotation.x = Math.PI; t.castShadow = false; head.add(t);
  }
  /* inner petal jaw — folds shut when it bites */
  const jaw = new THREE.Group(); jaw.position.y = 0.06; head.add(jaw);
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2 + 0.5;
    const p = sph(0.32 * k, petalMat, Math.cos(a) * 0.24 * k, 0.1, Math.sin(a) * 0.24 * k, 1, 0.26, 1.2);
    p.rotation.y = -a + Math.PI / 2; p.rotation.z = 0.3; p.castShadow = false;
    jaw.add(p);
  }
  grp.userData = { head, jaw, throat, k };
  return grp;
}

/* ------------------------- hazard factory -------------------------------- */
const hazards = [];
const _p = new THREE.Vector3(), _p2 = new THREE.Vector3();

function buildJawHead(k) {
  const head = new THREE.Group();
  const mouthMat = new THREE.MeshStandardMaterial({ color: 0xd81f3c, emissive: 0x7a0a1e, emissiveIntensity: .6, roughness: .6 });
  const lower = sph(0.95 * k, M.jawOut, 0, -0.16 * k, 0.35 * k, 1, 0.42, 1.25); head.add(lower);
  const mouth = sph(0.8 * k, mouthMat, 0, 0.02 * k, 0.42 * k, 0.94, 0.3, 1.15); mouth.castShadow = false; head.add(mouth);
  const jawTop = new THREE.Group(); jawTop.position.set(0, 0.12 * k, -0.45 * k); head.add(jawTop);
  const upper = sph(0.98 * k, M.jawOut, 0, 0.1 * k, 0.85 * k, 1, 0.45, 1.3); jawTop.add(upper);
  for (let i = -3; i <= 3; i++) {
    const t = cone(0.09 * k, 0.42 * k, M.teeth, i * 0.26 * k, -0.12 * k, 1.55 * k); t.rotation.x = Math.PI; jawTop.add(t);
    const b = cone(0.08 * k, 0.34 * k, M.teeth, i * 0.26 * k, 0.14 * k, 1.15 * k); head.add(b);
  }
  for (const sx of [-1, 1]) {  // eye stalks
    const stalk = cyl(0.05 * k, 0.07 * k, 0.7 * k, M.stem, sx * 0.5 * k, 0.75 * k, -0.2 * k, 6); head.add(stalk);
    head.add(sph(0.13 * k, M.amberGlow, sx * 0.5 * k, 1.12 * k, -0.2 * k));
  }
  head.add(blob(0.65 * k, M.leafDark, 0, 0.15 * k, -0.75 * k, 1));
  return { head, jawTop, mouthMat };
}

function thornBar(len, r, mat) {
  const g = new THREE.Group();
  const log = cyl(r, r * 1.15, len, mat || M.vine, 0, 0, 0, 8); log.rotation.z = Math.PI / 2; g.add(log);
  const n = Math.max(3, Math.floor(len / 1.5));
  for (let i = 0; i < n; i++) {
    const t = cone(0.13, rand(0.5, 0.9), M.thorn, -len / 2 + (i + .5) * (len / n), rand(-.1, .3), rand(-.15, .15));
    t.rotation.set(rand(-.5, .5), 0, rand(-.5, .5)); g.add(t);
    if (Math.random() < .4) g.add(blob(rand(.3, .55), M.leafDark, -len / 2 + i * (len / n), 0.25, 0, 1));
  }
  return g;
}

function buildHazards() {
  for (const def of PLACEMENTS) {
    const h = Object.assign({ state: 'idle', t: 0, cd: 0 }, def);
    const half = halfAt(Math.min(h.s, TRACK_LEN));
    const grp = new THREE.Group();

    if (h.type === 'snapper') {
      const k = h.big ? 2.15 : 1;
      h.k = k;
      /* It grew wherever the jungle could get a root in — a burst planter, a
         cracked slab, a rusted drum — and leans in over the tarmac from there.
         Layout is keyed to h.s so it is the same every run.                     */
      const r1 = hashRnd(h.s), r2 = hashRnd(h.s + 17.3), r3 = hashRnd(h.s + 41.7);
      const baseLat = h.side * (half + (h.big ? 4.4 : 2.2 + r1 * 2.9));
      h.lat = h.side * (half + 0.2 + r2 * 1.9);            // strike line hugs the verge
      const f0 = frameAt(h.s);
      trackPos(h.s, baseLat, 0, _p);
      const base = new THREE.Group(); base.position.copy(_p);
      base.rotation.set((r3 - .5) * .16, f0.yaw + (r2 - .5) * 1.1, (r1 - .5) * .2);
      base.add(sph(1.05 * k, M.leafDark, 0, 0.45 * k, 0, 1, 0.6, 1));
      base.add(blob(0.85 * k, M.leaf, 0.7 * k, 0.35 * k, 0.5 * k, 1));
      base.add(blob(0.7 * k, M.leaf, -0.7 * k, 0.3 * k, -0.4 * k, 1));
      if (r3 < 0.6) base.add(box(1.5 * k, 0.45, 1.5 * k, M.concreteDark, 0, 0.06, 0));   // burst planter
      else if (r3 < 0.85) base.add(cyl(0.42, 0.42, 1.1, M.rust, 0.5, 0.3, 0, 10));      // old drum
      for (let rr = 0; rr < 4; rr++) {
        const root = cyl(0.06, 0.14, 0.9 + hashRnd(h.s + rr * 7) * 1.6, M.bark,
          (hashRnd(h.s + rr * 3.1) - .5) * 2.2 * k, 0.12, (hashRnd(h.s + rr * 5.7) - .5) * 2.2 * k, 5);
        root.rotation.set(Math.PI / 2 + (hashRnd(h.s + rr) - .5) * .5, hashRnd(h.s + rr * 9) * 6.28, 0);
        base.add(root);
      }
      scene.add(base);
      h.basePos = _p.clone().setY(0.8 * k);
      trackPos(h.s, h.lat, (h.big ? 3.4 : 1.9) + (r2 - .5) * 0.5, _p2);
      h.homePos = _p2.clone();
      const { head, jawTop, mouthMat } = buildJawHead(k);
      head.position.copy(h.homePos);
      trackPos(h.s, 0, 0.7, _p); head.lookAt(_p);
      scene.add(head);
      h.head = head; h.jawTop = jawTop; h.mouthMat = mouthMat; h.homeQuat = head.quaternion.clone();
      h.stemMesh = new THREE.Mesh(new THREE.CylinderGeometry(0.16 * k, 0.24 * k, 1, 8), M.stem);
      h.stemMesh.castShadow = true; scene.add(h.stemMesh);
      h.strikeLat = 0; h.hitDone = false;
      if (h.big) buildMaw(h);
    }
    else if (h.type === 'flower') {
      /* Showy garden bloom. Identical to its harmless neighbours — until it
         turns to follow you and folds shut on your wing mirror.              */
      const onIsland = !!h.onIsland;
      const f = frameAt(h.s);
      h.mimic = !!h.mimic; h.spent = 0; h.biting = 0; h.hitCd = 0;
      if (!onIsland) h.lat = h.side * (half - 0.35 - hashRnd(h.s) * 0.35);
      const baseY = onIsland ? 1.6 : 0;
      trackPos(h.s, h.lat, baseY, _p);
      grp.position.copy(_p); grp.rotation.y = f.yaw + (hashRnd(h.s + 3) - .5) * 0.5;
      if (onIsland) {
        grp.add(box(2.1, 0.1, 1.9, M.islandSoil, 0, 0.02, 0));       // planted into the island bed
      } else if (inBridge(h.s)) {
        grp.add(box(1.8, 0.62, 1.5, M.rust, 0, 0.31, 0));            // rail planter
        grp.add(box(1.6, 0.12, 1.25, M.soil, 0, 0.66, 0));
      } else {
        grp.add(box(1.8, 0.55, 2.2, M.concreteDark, 0, 0.275, 0));   // verge planter
        grp.add(box(1.6, 0.14, 1.95, M.soil, 0, 0.59, 0));
      }
      for (let i = 0; i < 4; i++) {
        grp.add(blob(rand(0.32, 0.82), i % 2 ? M.leaf : M.leafDark,
          rand(-0.9, 0.9), 0.55 + (onIsland ? 0.1 : 0) + rand(0, 0.25), rand(-1.0, 1.0), 1));
      }
      const petalMat = [M.petalA, M.petalB, M.petalC][Math.floor(Math.random() * 3)];
      const throatMat = M.throat.clone();
      h.blooms = [];
      for (let i = 0; i < 2; i++) {
        const b = buildBloom(petalMat, i === 1 && !onIsland, throatMat);
        if (onIsland) b.scale.setScalar(0.92);
        b.position.set(i ? 0.34 : -0.34, onIsland ? 0.16 : 0.56, i ? 0.18 : -0.2);
        b.rotation.y = rand(0, 6.28);
        grp.add(b); h.blooms.push(b);
      }
      const big = h.blooms[1];
      h.head = big.userData.head;
      h.jaw = big.userData.jaw;
      h.throat = big.userData.throat;
      scene.add(grp); h.grp = grp;
    }
    else if (h.type === 'divider') {
      /* A mass in the middle of the causeway: specimen island, collapsed slab
         or fallen truss. It splits the road into two passages.               */
      const f = frameAt(h.s);
      const w = h.latB - h.latA, midLat = (h.latA + h.latB) / 2;
      trackPos(h.s, midLat, 0, _p);
      grp.position.copy(_p); grp.rotation.y = f.yaw;
      grp.add(box(w + 0.4, 1.5, h.len, M.concrete, 0, 0.75, 0));
      grp.add(box(w + 0.7, 0.3, h.len + 0.3, M.concreteDark, 0, 1.5, 0));
      grp.add(box(w - 0.5, 0.16, h.len - 0.8, M.soil, 0, 1.62, 0));
      /* rounded-off noses so neither end is a hole you can see under */
      for (const end of [-1, 1]) {
        const nose = box(w + 0.4, 1.5, w + 0.4, M.concrete, 0, 0.75, end * h.len / 2);
        nose.rotation.y = Math.PI / 4; grp.add(nose);
        const noseCap = box(w + 0.7, 0.3, w + 0.7, M.concreteDark, 0, 1.5, end * h.len / 2);
        noseCap.rotation.y = Math.PI / 4; grp.add(noseCap);
        for (let k = 0; k < 4; k++) {
          grp.add(blob(rand(.4, 1.0), k % 2 ? M.leaf : M.leafDark,
            rand(-w / 2, w / 2), 1.55 + rand(0, .5), end * (h.len / 2 - rand(0, .9)), 1));
        }
      }
      /* rubble and jungle spilling out of it */
      for (let i = 0; i < 12; i++) {
        const zz = rand(-h.len / 2 + 1.5, h.len / 2 - 1.5), xx = rand(-w / 2 + .3, w / 2 - .3);
        grp.add(blob(rand(0.5, 1.5), i % 3 === 0 ? M.leafDark : i % 3 === 1 ? M.leaf : M.stem,
          xx, 1.62 + rand(0, 0.75), zz, 1));
        if (i % 4 === 0) grp.add(box(rand(.4, 1.1), rand(.3, .75), rand(.4, 1.1), M.concreteDark, xx, 1.62, zz));
        if (i % 6 === 0) {
          const root = cyl(0.08, 0.17, rand(1.4, 2.6), M.bark, xx, 1.9, zz, 5);
          root.rotation.set(rand(-1.4, 1.4), rand(0, 3), rand(-1.4, 1.4)); grp.add(root);
        }
      }
      /* a broken pipe and a dead light stack so it reads as lab wreckage */
      const pipe = cyl(0.16, 0.16, w + 0.6, M.steel, 0, 2.1, rand(-h.len / 4, h.len / 4), 6);
      pipe.rotation.z = Math.PI / 2; grp.add(pipe);
      const plaque = new THREE.Mesh(new THREE.PlaneGeometry(w + 0.5, 1.5), makeSign(h.name || 'KEEP CLEAR', 'PASS EITHER SIDE', '#ffb020', '#101418'));
      plaque.position.set(0, 2.75, h.len / 2 + 0.15);          // faces back at the driver
      grp.add(plaque);
      const post = box(0.16, 1.5, 0.16, M.labDark, 0, 1.9, h.len / 2 - 0.15);
      grp.add(post);
      scene.add(grp); h.grp = grp; h.hitCd = 0;
    }
    else if (h.type === 'grabber') {
      const f = frameAt(h.s);
      trackPos(h.s, 0, 0, _p); grp.position.copy(_p); grp.rotation.y = f.yaw;
      for (const side of [-1, 1]) {
        grp.add(cyl(0.32, 0.5, 6.4, M.thorn, side * (half + 1.2), 3.2, 0, 8));
        grp.add(blob(rand(1.2, 1.7), M.leaf, side * (half + 1.2), 6.6, 0, 1));
      }
      const beam = cyl(0.17, 0.17, (half + 1.2) * 2, M.vine, 0, 6.1, 0, 8); beam.rotation.z = Math.PI / 2; grp.add(beam);
      h.tendrils = [];
      for (let i = -2; i <= 2; i++) {
        const pivot = new THREE.Group(); pivot.position.set(i * (half / 2.4), 6.1, 0);
        const td = cyl(0.07, 0.12, 3.1, M.vine, 0, -1.55, 0, 6); pivot.add(td);
        pivot.add(blob(0.34, M.leaf, 0, -3.1, 0, 1));
        grp.add(pivot); h.tendrils.push(pivot);
      }
      h.disabledT = 0; scene.add(grp); h.grp = grp;
    }
    else if (h.type === 'puffer') {
      h.lat = h.side * (half + 2.4);
      h.laneLat = h.side * rand(0.5, 2.6) * (Math.random() < .5 ? 1 : -0.4);
      const f = frameAt(h.s);
      trackPos(h.s, h.lat, 0, _p); grp.position.copy(_p); grp.rotation.y = f.yaw;
      grp.add(cyl(0.35, 0.55, 1.1, M.stem, 0, 0.55, 0));
      h.bulb = sph(1.25, M.puffer, 0, 1.75, 0, 1, 0.85, 1); grp.add(h.bulb);
      for (let i = 0; i < 6; i++) grp.add(sph(0.16, M.spore, rand(-.8, .8), rand(1.3, 2.4), rand(-.8, .8)));
      grp.add(blob(0.8, M.leafDark, 0.8, 0.3, 0.6, 1));
      scene.add(grp); h.grp = grp;
      /* the cloud it belches onto the road */
      h.cloud = new THREE.Group();
      for (let i = 0; i < 8; i++) {
        const puff = sph(rand(1.4, 2.6), M.spore, rand(-3, 3), rand(0, 1.4), rand(-2.6, 2.6));
        puff.castShadow = false; h.cloud.add(puff);
      }
      trackPos(h.s, h.laneLat, 1.1, _p); h.cloud.position.copy(_p);
      h.cloud.visible = false; scene.add(h.cloud);
      h.cycleT = rand(0, 5.4); h.cloudOn = false;
    }
    else if (h.type === 'sap' || h.type === 'chem') {
      const isChem = h.type === 'chem';
      const mat = isChem ? M.chem : M.sap;
      const f = frameAt(h.s);
      trackPos(h.s, h.lat, 0.04, _p); grp.position.copy(_p); grp.rotation.y = f.yaw;
      const disc = new THREE.Mesh(new THREE.CircleGeometry(h.r, 26), mat);
      disc.rotation.x = -Math.PI / 2; disc.receiveShadow = true; grp.add(disc);
      h.disc = disc;
      for (let i = 0; i < 7; i++) {
        const a = rand(0, Math.PI * 2), rr = rand(h.r * .55, h.r * 1.05);
        const b = sph(rand(.3, .7), mat, Math.cos(a) * rr, 0.08, Math.sin(a) * rr, 1, 0.35, 1);
        b.castShadow = false; grp.add(b);
      }
      if (isChem) {
        /* the drum it came out of, on its side, still dribbling */
        const drumGrp = new THREE.Group();
        const body = cyl(0.42, 0.42, 1.12, M.drumYellow, 0, 0, 0, 12);
        body.rotation.z = Math.PI / 2; drumGrp.add(body);
        drumGrp.add(sph(0.1, M.chemGlow, 0.62, 0.05, 0.3));
        drumGrp.position.set(h.r * 0.85, 0.42, -h.r * 0.25);
        drumGrp.rotation.y = rand(0, 3);
        grp.add(drumGrp);
        for (let i = 0; i < 5; i++) {
          const g2 = sph(rand(.12, .26), M.chemGlow, rand(-h.r, h.r) * .8, 0.28, rand(-h.r, h.r) * .8);
          g2.castShadow = false; grp.add(g2);
        }
      }
      scene.add(grp); h.grp = grp;
    }
    else if (h.type === 'bramble' || h.type === 'growbar') {
      const cover = half + 0.5;                     // from one edge past centre
      h.latA = h.side < 0 ? -half - 0.5 : -0.4;
      h.latB = h.side < 0 ? 0.4 : half + 0.5;
      const w = h.latB - h.latA;
      const f = frameAt(h.s);
      trackPos(h.s, (h.latA + h.latB) / 2, 0, _p); grp.position.copy(_p); grp.rotation.y = f.yaw;
      const bar1 = thornBar(w, 0.55); bar1.position.y = 0.55; grp.add(bar1);
      const bar2 = thornBar(w * 0.94, 0.42); bar2.position.y = 1.25; bar2.rotation.y = 0.06; grp.add(bar2);
      scene.add(grp); h.grp = grp; h.phase = rand(0, 6);
      if (h.type === 'growbar') { h.baseA = h.latA; h.baseB = h.latB; }
    }
    else if (h.type === 'tentacle') {
      const f = frameAt(h.s);
      trackPos(h.s, 0, 0.55, _p); grp.position.copy(_p); grp.rotation.y = f.yaw;
      const flesh = new THREE.MeshStandardMaterial({ color: 0xb04472, roughness: .65, emissive: 0x4a1028, emissiveIntensity: .55, flatShading: true });
      const arm = thornBar(5.4, 0.52, flesh); grp.add(arm);
      const tip = sph(0.8, flesh, 2.7, 0.18, 0, 1, 0.85, 1); grp.add(tip);
      grp.add(sph(0.3, M.amberGlow, 2.95, 0.45, 0));
      h.arm = arm; scene.add(grp); h.grp = grp;
      h.latA = -2.7; h.latB = 2.7; h.centerLat = 0;
    }
    else if (h.type === 'door') {
      const f = frameAt(h.s);
      trackPos(h.s, 0, 0, _p); grp.position.copy(_p); grp.rotation.y = f.yaw;
      for (const side of [-1, 1]) grp.add(box(1.1, 8.4, 1.4, M.labGrey, side * (half + 1.1), 4.2, 0));
      const lintel = box((half + 1.1) * 2 + 1.2, 1.5, 1.4, M.labDark, 0, 8.2, 0); grp.add(lintel);
      const stripeTex = (() => {
        const c = document.createElement('canvas'); c.width = 256; c.height = 64;
        const g = c.getContext('2d'); g.fillStyle = '#ffb020'; g.fillRect(0, 0, 256, 64);
        g.fillStyle = '#141414'; for (let x = -64; x < 256; x += 42) { g.beginPath(); g.moveTo(x, 64); g.lineTo(x + 21, 0); g.lineTo(x + 42, 0); g.lineTo(x + 21, 64); g.fill(); }
        const t = new THREE.CanvasTexture(c); t.wrapS = THREE.RepeatWrapping; t.repeat.x = 3; return t;
      })();
      const stripe = new THREE.Mesh(new THREE.PlaneGeometry((half + 1.1) * 2, 0.9), new THREE.MeshBasicMaterial({ map: stripeTex }));
      stripe.position.set(0, 8.2, 0.72); grp.add(stripe); // faces approaching driver
      h.panel = box((half + 0.7) * 2, 7.4, 0.5, new THREE.MeshStandardMaterial({ color: 0x5a646e, roughness: .45, metalness: .55 }), 0, 11, 0);
      grp.add(h.panel);
      h.lights = [];
      for (const side of [-1, 1]) {
        const lm = new THREE.MeshStandardMaterial({ color: 0x37e08b, emissive: 0x37e08b, emissiveIntensity: 2 });
        const dot = sph(0.22, lm, side * (half + 1.1), 7.3, 0.85); dot.castShadow = false;
        grp.add(dot); h.lights.push(lm);
      }
      grp.add(blob(1.6, M.leaf, -(half + 1), 8.9, 0, 1)); grp.add(blob(1.3, M.leafDark, half + 0.6, 8.8, 0, 1));
      scene.add(grp); h.grp = grp; h.closed = 0;
    }
    else if (h.type === 'pad') {
      const f = frameAt(h.s);
      trackPos(h.s, h.lat, 0.05, _p); grp.position.copy(_p); grp.rotation.y = f.yaw;
      const texC = document.createElement('canvas'); texC.width = 128; texC.height = 256;
      const g = texC.getContext('2d'); g.fillStyle = '#0b2a8f'; g.fillRect(0, 0, 128, 256);
      g.fillStyle = '#7db4ff';
      for (let i = 0; i < 3; i++) { const y = 30 + i * 75; g.beginPath(); g.moveTo(24, y + 44); g.lineTo(64, y); g.lineTo(104, y + 44); g.lineTo(104, y + 70); g.lineTo(64, y + 26); g.lineTo(24, y + 70); g.fill(); }
      const tex = new THREE.CanvasTexture(texC); tex.colorSpace = THREE.SRGBColorSpace;
      h.padMat = new THREE.MeshStandardMaterial({ map: tex, emissive: 0x1f5eff, emissiveMap: tex, emissiveIntensity: 1.1 });
      const pad = new THREE.Mesh(new THREE.BoxGeometry(3.2, 0.1, 5.4), h.padMat);
      pad.receiveShadow = true; grp.add(pad);
      scene.add(grp); h.grp = grp;
    }
    else if (h.type === 'nitro' || h.type === 'repair') {
      const f = frameAt(h.s);
      trackPos(h.s, h.lat, 1.05, _p); grp.position.copy(_p); grp.rotation.y = f.yaw;
      if (h.type === 'nitro') {
        grp.add(cyl(0.42, 0.42, 1.15, M.nitro, 0, 0, 0, 14));
        grp.add(cyl(0.16, 0.16, 0.3, M.labGrey, 0, 0.72, 0, 8));
        const ring = new THREE.Mesh(new THREE.TorusGeometry(0.75, 0.05, 6, 24), M.blueGlow);
        ring.rotation.x = Math.PI / 2; ring.position.y = -0.75; grp.add(ring);
      } else {
        grp.add(box(1.15, 0.85, 0.5, M.repair, 0, 0, 0));
        grp.add(box(0.62, 0.2, 0.54, M.cross, 0, 0, 0)); grp.add(box(0.2, 0.62, 0.54, M.cross, 0, 0, 0));
        const ring = new THREE.Mesh(new THREE.TorusGeometry(0.85, 0.05, 6, 24), M.cross);
        ring.rotation.x = Math.PI / 2; ring.position.y = -0.75; grp.add(ring);
      }
      h.taken = false; h.baseY = 1.05;
      scene.add(grp); h.grp = grp;
    }
    hazards.push(h);
  }
}

/* the Mother Maw — huge body looming over the Heart Chamber */
function buildMaw(h) {
  const grp = new THREE.Group();
  const half = halfAt(h.s);
  trackPos(1062, half + 9, 0, _p); grp.position.copy(_p);
  grp.add(sph(5.2, M.leafDark, 0, 2.4, 0, 1, 0.62, 1));
  grp.add(sph(3.6, M.leaf, -2.6, 3.4, 1.8, 1, 0.7, 1));
  grp.add(sph(3.0, M.leaf, 2.8, 3.1, -2, 1, 0.7, 1));
  for (let i = 0; i < 7; i++) {
    const petal = cone(rand(1, 1.7), rand(3.5, 5.5), new THREE.MeshStandardMaterial({ color: 0xff2f7e, roughness: .6, flatShading: true }), rand(-4, 4), rand(4.5, 6.5), rand(-4, 4));
    petal.rotation.set(rand(-.7, .7), 0, rand(-.7, .7)); grp.add(petal);
  }
  for (let i = 0; i < 5; i++) grp.add(blob(rand(1, 2), M.leaf, rand(-6, 6), rand(.5, 1.5), rand(-6, 6), 1));
  scene.add(grp);
  const glow = new THREE.PointLight(0xff2f7e, 60, 55, 1.6);
  trackPos(1075, 3, 6, _p); glow.position.copy(_p); scene.add(glow);
}
buildHazards();

/* grab vine that drops onto the car */
const grabVine = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.13, 1, 7), M.vine);
grabVine.visible = false; grabVine.castShadow = true; scene.add(grabVine);

/* ------------------------------ particles -------------------------------- */
const PMAX = 260;
const pGeo = new THREE.BufferGeometry();
const pPos = new Float32Array(PMAX * 3), pCol = new Float32Array(PMAX * 3);
const pVel = new Float32Array(PMAX * 3), pLife = new Float32Array(PMAX);
pGeo.setAttribute('position', new THREE.BufferAttribute(pPos, 3));
pGeo.setAttribute('color', new THREE.BufferAttribute(pCol, 3));
const pPoints = new THREE.Points(pGeo, new THREE.PointsMaterial({ size: 0.32, vertexColors: true, transparent: true, opacity: .95, depthWrite: false }));
pPoints.frustumCulled = false; scene.add(pPoints);
let pCursor = 0;
const _c = new THREE.Color();
function burst(pos, hex, n, spread, up) {
  _c.set(hex);
  for (let i = 0; i < n; i++) {
    const j = pCursor; pCursor = (pCursor + 1) % PMAX;
    pPos.set([pos.x + rand(-.4, .4), pos.y + rand(-.3, .5), pos.z + rand(-.4, .4)], j * 3);
    pVel.set([rand(-spread, spread), rand(1, up || 5), rand(-spread, spread)], j * 3);
    pCol.set([_c.r * rand(.6, 1.2), _c.g * rand(.6, 1.2), _c.b * rand(.6, 1.2)], j * 3);
    pLife[j] = rand(0.45, 0.95);
  }
}
function updateParticles(dt) {
  for (let j = 0; j < PMAX; j++) {
    if (pLife[j] <= 0) { pPos[j * 3 + 1] = -50; continue; }
    pLife[j] -= dt;
    pVel[j * 3 + 1] -= 9 * dt;
    pPos[j * 3] += pVel[j * 3] * dt; pPos[j * 3 + 1] += pVel[j * 3 + 1] * dt; pPos[j * 3 + 2] += pVel[j * 3 + 2] * dt;
  }
  pGeo.attributes.position.needsUpdate = true;
  pGeo.attributes.color.needsUpdate = true;
}
/* ambient drifting spores around the car */
const sporeGroup = new THREE.Group(); scene.add(sporeGroup);
{
  const N = 320, arr = new Float32Array(N * 3);
  for (let i = 0; i < N; i++) arr.set([rand(-34, 34), rand(0.2, 13), rand(-34, 34)], i * 3);
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(arr, 3));
  const pts = new THREE.Points(g, new THREE.PointsMaterial({ color: 0xd8f79a, size: 0.13, transparent: true, opacity: .75, depthWrite: false }));
  pts.frustumCulled = false; sporeGroup.add(pts);
  sporeGroup.userData.update = (dt, t) => {
    const a = g.attributes.position.array;
    for (let i = 0; i < N; i++) {
      a[i * 3 + 1] -= dt * 0.55; a[i * 3] += Math.sin(t * 0.7 + i) * dt * 0.5;
      if (a[i * 3 + 1] < 0.1) a[i * 3 + 1] = 13;
      if (a[i * 3] > 34) a[i * 3] = -34; if (a[i * 3] < -34) a[i * 3] = 34;
    }
    g.attributes.position.needsUpdate = true;
  };
}

/* -------------------------------- audio ---------------------------------- */
const AU = {
  ctx: null, engGain: null, engOsc: null, engSub: null,
  init() {
    if (this.ctx) { this.ctx.resume(); return; }
    try {
      const C = window.AudioContext || window.webkitAudioContext;
      this.ctx = new C();
      this.master = this.ctx.createGain(); this.master.gain.value = 0.5; this.master.connect(this.ctx.destination);
      const o = this.ctx.createOscillator(); o.type = 'sawtooth'; o.frequency.value = 52;
      const sub = this.ctx.createOscillator(); sub.type = 'sine'; sub.frequency.value = 26;
      const f = this.ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 380; f.Q.value = 2;
      this.engGain = this.ctx.createGain(); this.engGain.gain.value = 0;
      o.connect(f); sub.connect(f); f.connect(this.engGain); this.engGain.connect(this.master);
      o.start(); sub.start(); this.engOsc = o; this.engSub = sub;
    } catch (e) { this.ctx = null; }
  },
  engine(norm, on) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    this.engOsc.frequency.setTargetAtTime(50 + norm * 115, t, 0.08);
    this.engSub.frequency.setTargetAtTime(25 + norm * 58, t, 0.08);
    this.engGain.gain.setTargetAtTime(on ? 0.05 + norm * 0.05 : 0, t, 0.1);
  },
  tone(freq, dur, type, gain, slideTo) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime, o = this.ctx.createOscillator(), g = this.ctx.createGain();
    o.type = type || 'sine'; o.frequency.setValueAtTime(freq, t);
    if (slideTo) o.frequency.exponentialRampToValueAtTime(Math.max(20, slideTo), t + dur);
    g.gain.setValueAtTime(gain || 0.18, t); g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    o.connect(g); g.connect(this.master); o.start(t); o.stop(t + dur + 0.02);
  },
  thud() { this.tone(120, 0.22, 'sine', 0.5, 38); },
  snap() { this.tone(900, 0.07, 'square', 0.22, 160); this.tone(180, 0.14, 'sine', 0.35, 60); },
  warn() { this.tone(660, 0.1, 'triangle', 0.14); },
  chop() { this.tone(rand(500, 800), 0.06, 'square', 0.16, 200); },
  free() { this.tone(320, 0.25, 'sawtooth', 0.2, 900); },
  pickup() { this.tone(880, 0.09, 'sine', 0.2); setTimeout(() => this.tone(1320, 0.14, 'sine', 0.2), 70); },
  pad() { this.tone(240, 0.32, 'sawtooth', 0.18, 1100); },
  grab() { this.tone(220, 0.4, 'sawtooth', 0.3, 55); },
  count(final) { this.tone(final ? 990 : 550, final ? 0.45 : 0.16, 'square', 0.22); },
  win() { [523, 659, 784, 1046].forEach((f, i) => setTimeout(() => this.tone(f, 0.3, 'triangle', 0.24), i * 120)); },
  lose() { [392, 330, 262, 196].forEach((f, i) => setTimeout(() => this.tone(f, 0.35, 'triangle', 0.22), i * 150)); },
};

/* ------------------------------- input ----------------------------------- */
const keys = { left: false, right: false, boost: false, brake: false };
addEventListener('keydown', e => {
  const k = e.code;
  if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Space'].includes(k)) e.preventDefault();
  if (k === 'ArrowLeft' || k === 'KeyA') keys.left = true;
  if (k === 'ArrowRight' || k === 'KeyD') keys.right = true;
  if (k === 'ArrowUp' || k === 'KeyW' || k === 'ShiftLeft' || k === 'ShiftRight') keys.boost = true;
  if (k === 'ArrowDown' || k === 'KeyS') keys.brake = true;
  if (k === 'Space' && !e.repeat) pulsePressed();
  if ((k === 'KeyP' || k === 'Escape')) {
    /* on the brief, Esc backs out to the level roster instead of pausing */
    if (state === 'menu') { location.href = '../index.html'; return; }
    togglePause();
  }
  if (k === 'KeyR' && (state === 'race' || state === 'pause' || state === 'end')) startRun();
  if (k === 'KeyL' && (state === 'menu' || state === 'pause' || state === 'end')) location.href = '../index.html';
  if (k === 'Enter') { if (state === 'menu') startRun(); else if (state === 'end') startRun(); }
});
addEventListener('keyup', e => {
  const k = e.code;
  if (k === 'ArrowLeft' || k === 'KeyA') keys.left = false;
  if (k === 'ArrowRight' || k === 'KeyD') keys.right = false;
  if (k === 'ArrowUp' || k === 'KeyW' || k === 'ShiftLeft' || k === 'ShiftRight') keys.boost = false;
  if (k === 'ArrowDown' || k === 'KeyS') keys.brake = false;
});
function bindTouch(id, prop, isPulse) {
  const el = $(id);
  const on = e => { e.preventDefault(); el.classList.add('held'); if (isPulse) pulsePressed(); else keys[prop] = true; };
  const off = e => { e.preventDefault(); el.classList.remove('held'); if (!isPulse) keys[prop] = false; };
  el.addEventListener('pointerdown', on); el.addEventListener('pointerup', off);
  el.addEventListener('pointerleave', off); el.addEventListener('pointercancel', off);
}
bindTouch('tLeft', 'left'); bindTouch('tRight', 'right');
bindTouch('tBoost', 'boost'); bindTouch('tBrake', 'brake'); bindTouch('tPulse', null, true);

/* ----------------------------- game state -------------------------------- */
let state = 'menu';               // menu | count | race | pause | end
let prevState = 'race';
const P = {                        // player in track-space
  s: 2, lat: 0, latVel: 0, speed: 0,
  hull: 100, boost: 60,
  chokedT: 0, padT: 0, invulnT: 0, pulseCd: 0,
  grabbed: false, grabH: null, grabProg: 0, inSap: false, inChem: false, doorHeld: false,
};
const CRUISE = 27, BOOSTV = 42, BRAKEV = 9;
const GRAB_NEED = 6;
let raceTime = 0, countT = 0, lastCount = 4, zoneIdx = -1, shake = 0, menuS = 0, endOrbit = 0;
let stats = {};
let best = NaN;
try { best = parseFloat(localStorage.getItem('frontier_biolab_best') || 'NaN'); } catch (e) { /* storage unavailable */ }

function resetStats() { stats = { hits: 0, escapes: 0, nearMiss: 0, pickups: 0, burns: 0, stuns: 0 }; }
resetStats();

function resetRun() {
  P.s = 2; P.lat = 0; P.latVel = 0; P.speed = 0; P.hull = 100; P.boost = 60;
  P.chokedT = P.padT = P.invulnT = P.pulseCd = 0;
  P.grabbed = false; P.grabH = null; P.grabProg = 0; P.inSap = false; P.inChem = false; P.doorHeld = false;
  raceTime = 0; zoneIdx = -1; shake = 0; resetStats();
  vineWrap.visible = false; grabVine.visible = false;
  for (const h of hazards) {
    h.state = 'idle'; h.t = 0; h.cd = 0;
    if (h.type === 'snapper') { h.head.position.copy(h.homePos); h.hitDone = false; h.mouthMat.emissiveIntensity = .6; }
    if (h.type === 'puffer') { h.cycleT = rand(0, 5.4); h.cloudOn = false; h.cloud.visible = false; }
    if (h.type === 'grabber') h.disabledT = 0;
    if (h.type === 'nitro' || h.type === 'repair') { h.taken = false; h.grp.visible = true; }
    if (h.type === 'pad') h.padMat.emissiveIntensity = 1.1;
    if (h.type === 'flower') {
      h.spent = 0; h.biting = 0; h.hitCd = 0;
      if (h.head) { h.head.rotation.x = 0; h.head.rotation.y = 0; h.jaw.scale.setScalar(1); h.throat.scale.setScalar(1); }
    }
    if (h.type === 'divider') h.hitCd = 0;
  }
  $('grabPrompt').classList.remove('on');
  $('grabFx').style.opacity = 0;
  $('sporeFx').style.opacity = 0; $('dmgFx').style.opacity = 0;
  el.banner.classList.remove('on'); el.toast.classList.remove('on');
  bannerT = 0; toastT = 0; hurtChipT = 0;
  updatePips();
}

/* --------------------------------- HUD ----------------------------------- */
const el = {
  hud: $('hud'), zone: $('zoneName'), timer: $('timer'), best: $('bestLine'),
  progFill: $('progFill'), progCar: $('progCar'), hullFill: $('hullFill'), hullVal: $('hullVal'),
  boostFill: $('boostFill'), boostVal: $('boostVal'), fx: $('fxLine'), vitals: $('vitals'),
  speed: $('speedVal'), gear: $('gear'), banner: $('banner'), bKick: $('bKick'), bTitle: $('bTitle'), bSub: $('bSub'),
  toast: $('toast'), cd: $('countDown'), grab: $('grabPrompt'), pips: $('pips'),
  chipSpore: $('chipSpore'), chipSap: $('chipSap'), chipChem: $('chipChem'), chipDoor: $('chipDoor'), chipHurt: $('chipHurt'),
  sporeFx: $('sporeFx'), dmgFx: $('dmgFx'), grabFx: $('grabFx'),
};
for (const z of ZONES.slice(1)) {
  const t = document.createElement('div'); t.className = 'tick';
  t.style.left = (z.from / FINISH_S * 100) + '%'; $('progWrap').appendChild(t);
}
for (let i = 0; i < GRAB_NEED; i++) { const d = document.createElement('div'); d.className = 'pip'; el.pips.appendChild(d); }
function updatePips() { [...el.pips.children].forEach((d, i) => d.classList.toggle('hit', i < Math.floor(P.grabProg))); }

let bannerT = 0, toastT = 0, hurtChipT = 0;
function showBanner(kick, title, sub) {
  el.bKick.textContent = kick; el.bTitle.textContent = title; el.bSub.textContent = sub || '';
  el.banner.classList.add('on'); bannerT = 2.7;
}
function toast(msg, color) {
  el.toast.textContent = msg; el.toast.style.color = color || '#fff';
  el.toast.classList.add('on'); toastT = 1.7;
}

/* ----------------------------- core actions ------------------------------ */
function damage(amount, knockDir) {
  if (P.invulnT > 0 || state !== 'race') return;
  P.hull = Math.max(0, P.hull - amount);
  P.invulnT = 1.0; stats.hits++;
  shake = Math.min(1.2, shake + 0.55);
  el.dmgFx.style.opacity = 1; setTimeout(() => el.dmgFx.style.opacity = 0, 160);
  hurtChipT = 1.1;
  if (knockDir) P.latVel += knockDir * 7;
  trackPos(P.s, P.lat, 0.8, _p); burst(_p, 0xff4455, 12, 3.5, 4);
  AU.thud();
  if (P.hull <= 0) wreck();
}
function startGrab(h) {
  P.grabbed = true; P.grabH = h; P.grabProg = 0; P.speed *= 0.25;
  vineWrap.visible = true; grabVine.visible = true;
  el.grab.classList.add('on'); el.grabFx.style.opacity = 1;
  updatePips(); shake = Math.min(1.2, shake + 0.5);
  trackPos(P.s, P.lat, 1, _p); burst(_p, 0x37e08b, 16, 3, 5);
  AU.grab();
}
function endGrab(escaped) {
  if (P.grabH) P.grabH.disabledT = 8;
  P.grabbed = false; P.grabH = null;
  vineWrap.visible = false; grabVine.visible = false;
  el.grab.classList.remove('on'); el.grabFx.style.opacity = 0;
  if (escaped) {
    stats.escapes++; P.invulnT = Math.max(P.invulnT, 2); P.boost = Math.min(100, P.boost + 10);
    trackPos(P.s, P.lat, 1, _p); burst(_p, 0x8dff57, 26, 5, 7);
    toast('✂ CUT FREE! +BOOST', '#8dff57'); AU.free();
  }
}
function pulsePressed() {
  if (state !== 'race') return;
  const pulseFromP = { s: P.s };              // frozen for the whole pulse
  if (P.grabbed) {
    P.grabProg = Math.min(GRAB_NEED, P.grabProg + 1);
    updatePips(); AU.chop(); cutterT = 0;
    trackPos(P.s, P.lat, 1, _p); burst(_p, 0x37e08b, 5, 2.5, 4);
    vineWrap.scale.setScalar(1 - P.grabProg / GRAB_NEED * 0.25);
    if (P.grabProg >= GRAB_NEED) endGrab(true);
    return;
  }
  if (P.pulseCd > 0) return;
  if (P.boost < 15) { toast('⚠ CUTTER NEEDS 15% BOOST', '#ffb020'); return; }
  P.boost -= 15; P.pulseCd = 1.2; cutterT = 0;
  P.chokedT = 0;
  let stunnedAny = false, wokeAny = false;
  for (const h of hazards) {
    if (h.type === 'snapper' && Math.abs(h.s - P.s) < 17 && h.state !== 'stunned') {
      h.state = 'stunned'; h.t = 3.5; stunnedAny = true; stats.stuns++;
    }
    /* the cutter is also your detector: hungry blooms thrash when it fires */
    if (h.type === 'flower' && h.mimic && h.spent <= 0 && Math.abs(h.s - pulseFromP.s) < 22) {
      h.spent = 9; h.biting = 0.5; h.throat.material.emissiveIntensity = 2.6; wokeAny = true; stats.stuns++;
      trackPos(h.s, h.lat, 1.8, _p); burst(_p, 0xff5fa3, 10, 2.4, 4);
    }
  }
  toast(wokeAny ? '✂ CUTTER PULSE — A BLOOM FLINCHED!' : stunnedAny ? '✂ CUTTER PULSE — PLANT STUNNED!' : '✂ CUTTER PULSE', '#8dff57');
  AU.free();
}
function barrierCheck(h, latA, latB, thick, dmg) {
  if (Math.abs(P.s - h.s) > thick) return;
  if (P.lat > latA - 0.85 && P.lat < latB + 0.85) {
    const toLeft = Math.abs(P.lat - (latA - 0.85)), toRight = Math.abs(P.lat - (latB + 0.85));
    const dir = toLeft < toRight ? -1 : 1;
    P.lat = dir < 0 ? latA - 1.05 : latB + 1.05;
    P.speed *= 0.3;
    damage(dmg, dir);
    trackPos(P.s, P.lat, 0.8, _p); burst(_p, 0x8a6b3a, 14, 3.5, 4);
  }
}

/* ------------------------------ flow control ----------------------------- */
function show(id) { for (const s of ['startScreen', 'pauseScreen', 'endScreen']) $(s).classList.toggle('on', s === id); }
function startRun() {
  AU.init();
  resetRun();
  show(null);
  el.hud.classList.add('on'); $('touch').classList.add('on'); $('pauseBtn').classList.add('on');
  state = 'count'; countT = 3.2; lastCount = 4;
  el.cd.textContent = '3'; el.cd.classList.add('on');
  trackPos(P.s - 9.6, 0, 4.7, camPos); camera.position.copy(camPos);
  trackPos(P.s + 15, 0, 1.05, camLook); camera.lookAt(camLook);
  camera.fov = 62; camera.updateProjectionMatrix();
  el.best.textContent = 'BEST ' + fmtTime(best);
}
function togglePause() {
  if (state === 'race' || state === 'count') {
    prevState = state; state = 'pause'; show('pauseScreen'); AU.engine(0, false);
  } else if (state === 'pause') {
    state = prevState; show(null);
  }
}
function finishRun() {
  state = 'end'; el.banner.classList.remove('on'); bannerT = 0;
  if (P.grabbed) endGrab(false);
  const t = raceTime;
  const isBest = !isFinite(best) || t < best;
  if (isBest) { best = t; try { localStorage.setItem('frontier_biolab_best', String(best)); } catch (e) { } }
  const medal = t <= 80 ? ['◆ GOLD', '#ffd24d'] : t <= 105 ? ['◆ SILVER', '#dfe6ee'] : ['◆ BRONZE', '#e0954d'];
  const score = Math.max(0, Math.round(12000 - t * 55 + P.hull * 25 + stats.nearMiss * 150 + stats.escapes * 120 + stats.burns * 150 + stats.stuns * 80 - stats.hits * 250));
  $('endTag').textContent = 'EXTRACTION REACHED' + (isBest ? ' · NEW BEST!' : '');
  $('endTitle').innerHTML = 'YOU OUTRAN<br /><em>THE GREEN</em>';
  const mb = $('medalBig'); mb.textContent = medal[0]; mb.style.color = medal[1];
  $('stTime').textContent = fmtTime(t); $('stHull').textContent = Math.round(P.hull) + '%';
  $('stHits').textContent = stats.hits; $('stEscapes').textContent = stats.escapes;
  $('stNear').textContent = stats.nearMiss; $('stPick').textContent = stats.pickups;
  $('stBest').textContent = fmtTime(best); $('stScore').textContent = score.toLocaleString();
  setTimeout(() => show('endScreen'), 900);
  AU.win(); AU.engine(0, false);
}
function wreck() {
  if (state !== 'race') return;
  state = 'end'; el.banner.classList.remove('on'); bannerT = 0;
  if (P.grabbed) endGrab(false);
  trackPos(P.s, P.lat, 1, _p); burst(_p, 0xff7722, 40, 6, 8); burst(_p, 0x555555, 24, 3, 6);
  shake = 1.4;
  $('endTag').textContent = 'VEHICLE LOST · ZONE ' + (zoneAt(P.s) + 1);
  $('endTitle').innerHTML = 'THE CANOPY<br /><em style="color:#ff3b47">KEEPS IT</em>';
  const mb = $('medalBig'); mb.textContent = '✖ WRECKED AT ' + Math.round(P.s / FINISH_S * 100) + '%'; mb.style.color = '#ff3b47';
  $('stTime').textContent = fmtTime(raceTime); $('stHull').textContent = '0%';
  $('stHits').textContent = stats.hits; $('stEscapes').textContent = stats.escapes;
  $('stNear').textContent = stats.nearMiss; $('stPick').textContent = stats.pickups;
  $('stBest').textContent = fmtTime(best); $('stScore').textContent = '—';
  setTimeout(() => show('endScreen'), 1200);
  AU.lose(); AU.engine(0, false);
}

$('startBtn').addEventListener('click', startRun);
$('againBtn').addEventListener('click', startRun);
$('restartBtn1').addEventListener('click', startRun);
$('resumeBtn').addEventListener('click', togglePause);
$('pauseBtn').addEventListener('click', togglePause);
$('menuBtn').addEventListener('click', () => {
  state = 'menu'; show('startScreen');
  el.hud.classList.remove('on'); $('touch').classList.remove('on'); $('pauseBtn').classList.remove('on');
  resetRun();
});

/* --------------------------- hazard update -------------------------------- */
function doorClosedness(h, time) {
  const t = (time + (h.phase || 0)) % 6;
  if (t < 2.6) return 0;
  if (t < 3.4) return smooth((t - 2.6) / 0.8);
  if (t < 5.2) return 1;
  return 1 - smooth((t - 5.2) / 0.8);
}

function updateHazards(dt, time, playing) {
  const half = halfAt(clamp(P.s, 0, TRACK_LEN));
  for (const h of hazards) {
    const ds = h.s - P.s;
    const near = Math.abs(ds) < 170;

    if (h.type === 'snapper') {
      if (!near) continue;
      h.t -= dt; if (h.cd > 0) h.cd -= dt;
      const k = h.k;
      const f = frameAt(h.s);
      if (h.state === 'idle') {
        trackPos(h.s, h.lat, h.homePos.y, _p);
        _p.x += Math.sin(time * 1.3 + h.s) * 0.25; _p.y += Math.sin(time * 1.7 + h.s * 2) * 0.18;
        h.head.position.lerp(_p, 1 - Math.exp(-4 * dt));
        h.jawTop.rotation.x = damp(h.jawTop.rotation.x, -0.38 - Math.sin(time * 2 + h.s) * 0.08, 5, dt);
        h.mouthMat.emissiveIntensity = damp(h.mouthMat.emissiveIntensity, 0.6, 5, dt);
        const lead = clamp(P.speed * (h.big ? 1.12 : 0.88), 11, 40);  // strike lands as the car arrives
        if (playing && h.cd <= 0 && ds > 1.5 && ds < lead) {
          h.state = 'tele'; h.t = h.big ? 0.95 : 0.72;
          h.strikeLat = clamp(P.lat + P.latVel * 0.25, -half + 1, half - 1);  // aim commits NOW — dodge after the tell
          AU.warn();
        }
      } else if (h.state === 'tele') {
        trackPos(h.s, h.lat + h.side * 0.9, h.homePos.y + 0.75 * k, _p);
        _p.x += rand(-.05, .05); _p.y += rand(-.05, .05);
        h.head.position.lerp(_p, 1 - Math.exp(-8 * dt));
        h.jawTop.rotation.x = damp(h.jawTop.rotation.x, -1.15, 8, dt);
        h.mouthMat.emissiveIntensity = 2.2 + Math.sin(time * 30) * 0.8;
        if (h.t <= 0) {
          h.state = 'strike'; h.t = 0.2; h.hitDone = false;
          h.fromPos = h.head.position.clone();
          trackPos(h.s, h.strikeLat, 0.75 * k, _p); h.strikePos = _p.clone();
        }
      } else if (h.state === 'strike') {
        const pr = 1 - Math.max(0, h.t) / 0.2;
        h.head.position.lerpVectors(h.fromPos, h.strikePos, pr * pr);
        h.jawTop.rotation.x = lerp(-1.15, -0.05, Math.max(0, pr - 0.45) / 0.55);
        if (pr > 0.55 && !h.hitDone) {
          h.hitDone = true; AU.snap();
          burst(h.strikePos, 0xd81f3c, 6, 2, 3);
          if (playing && !P.grabbed) {
            const latErr = Math.abs(P.lat - h.strikeLat), sErr = Math.abs(P.s - h.s);
            if (sErr < 2.8 && latErr < 1.8 * k) {
              P.speed *= 0.55;
              damage(h.big ? 17 : 12, h.side < 0 ? 1 : -1);
              toast(h.big ? '💥 THE MAW BIT YOU!' : '💥 SNAPPER BITE!', '#ff5b64');
            } else if (sErr < 4 && latErr < 3.6 * k && P.invulnT <= 0) {
              stats.nearMiss++; toast('⚡ NEAR MISS +150', '#ffd24d');
            }
          }
        }
        if (h.t <= 0) { h.state = 'recover'; h.t = 1.15; h.fromPos = h.head.position.clone(); }
      } else if (h.state === 'recover') {
        const pr = 1 - Math.max(0, h.t) / 1.15;
        h.head.position.lerpVectors(h.fromPos, h.homePos, smooth(pr));
        h.jawTop.rotation.x = damp(h.jawTop.rotation.x, -0.4, 4, dt);
        h.mouthMat.emissiveIntensity = damp(h.mouthMat.emissiveIntensity, 0.6, 4, dt);
        if (h.t <= 0) { h.state = 'idle'; h.cd = 1.6; }
      } else if (h.state === 'stunned') {
        trackPos(h.s, h.lat, h.homePos.y - 0.8 * k, _p);
        h.head.position.lerp(_p, 1 - Math.exp(-5 * dt));
        h.jawTop.rotation.x = damp(h.jawTop.rotation.x, -0.15, 5, dt);
        h.mouthMat.emissiveIntensity = 0.25;
        h.head.quaternion.copy(h.homeQuat); h.head.rotateZ(Math.sin(time * 6) * 0.09);
        if (h.t <= 0) { h.state = 'idle'; h.head.quaternion.copy(h.homeQuat); h.cd = 1; }
      }
      stemBetween(h.stemMesh, h.basePos, h.head.position);
    }
    else if (h.type === 'flower') {
      if (h.hitCd > 0) h.hitCd -= dt;
      if (h.biting > 0) h.biting = Math.max(0, h.biting - dt);
      if (h.spent > 0) h.spent -= dt;
      h.grp.visible = Math.abs(ds) < 165;
      /* every bloom sways in the same wind. Nothing to read here. */
      if (Math.abs(ds) < 70) for (let i = 0; i < h.blooms.length; i++) {
        const b = h.blooms[i];
        b.rotation.z = Math.sin(time * 1.25 + h.s * 0.7 + i) * 0.05;
        b.rotation.x = Math.sin(time * 0.9 + i * 2.1) * 0.03;
      }
      if (!h.mimic) continue;
      /* the tell is behavioural and last-second: a hungry bloom tracks the car */
      if (Math.abs(ds) < 24) {
        const aim = clamp((P.lat - h.lat) * 0.2, -0.5, 0.5) + (h.side > 0 ? -0.12 : 0.12);
        h.head.rotation.y = damp(h.head.rotation.y, aim, 2.2, dt);
        const shut = h.spent > 0;
        h.head.rotation.x = damp(h.head.rotation.x, shut ? 0.5 : Math.sin(time * 2.6) * 0.025, 3, dt);
        h.throat.scale.setScalar(damp(h.throat.scale.x, shut ? 0.7 : 1.12, 3, dt));
        if (h.biting > 0) {
          const q = Math.sin((1 - h.biting / 0.5) * Math.PI);
          h.jaw.scale.setScalar(1 + q * 0.6);
          h.throat.material.emissiveIntensity = 2.4;
        } else {
          h.jaw.scale.setScalar(damp(h.jaw.scale.x, shut ? 0.5 : 1, 6, dt));
          h.throat.material.emissiveIntensity = damp(h.throat.material.emissiveIntensity, 0.8, 4, dt);
        }
      }
      if (!playing || h.spent > 0 || h.hitCd > 0 || P.invulnT > 0 || P.grabbed || P.speed < 4) continue;
      const dl = Math.abs(P.lat - h.lat);
      if (Math.abs(ds) < 2.9 && dl < 2.9) {
        h.spent = 8; h.biting = 0.5; h.hitCd = 1;
        const away = P.lat >= h.lat ? 1 : -1;
        trackPos(h.s, h.lat, 1.8, _p);
        if (dl < 2.2) {
          P.speed *= 0.42;
          damage(9, away * 0.9);
          toast('🌺 IT WAS A MIMIC!', '#ff5fa3');
          burst(_p, 0xff5fa3, 20, 3.6, 6); AU.snap();
        } else {
          stats.nearMiss++;
          toast('🌺 MIMIC — IT MISSED +150', '#ffd24d');
          burst(_p, 0xff5fa3, 9, 2.4, 4); AU.snap();
        }
      }
    }
    else if (h.type === 'divider') {
      if (h.hitCd > 0) h.hitCd -= dt;
    }
    else if (h.type === 'grabber') {
      if (h.disabledT > 0) h.disabledT -= dt;
      const retracted = h.disabledT > 0;
      if (near) for (let i = 0; i < h.tendrils.length; i++) {
        const td = h.tendrils[i];
        const target = retracted ? 0.18 : 1;
        td.scale.y = damp(td.scale.y, target, 5, dt);
        td.rotation.x = Math.sin(time * 1.6 + i * 1.3 + h.s) * 0.13;
        td.rotation.z = Math.cos(time * 1.3 + i) * 0.1;
      }
    }
    else if (h.type === 'puffer') {
      h.cycleT = (h.cycleT + dt) % 5.4;
      const swell = h.cycleT < 2.4 ? 1 + (h.cycleT / 2.4) * 0.3 : 1;
      if (near) h.bulb.scale.set(swell, swell * 0.85, swell);
      h.cloudOn = h.cycleT >= 2.4;
      if (h.cloudOn && !h.cloud.visible && near) {
        h.cloud.visible = true;
        trackPos(h.s, h.laneLat, 1.1, _p); burst(_p, 0xd8e64a, 10, 2, 2);
      }
      if (!h.cloudOn) h.cloud.visible = false;
      if (h.cloud.visible) {
        const life = (h.cycleT - 2.4) / 3;                       // 0..1
        const sc = 0.5 + Math.sin(Math.min(1, life) * Math.PI) * 0.85;
        h.cloud.scale.setScalar(sc);
        h.cloud.rotation.y += dt * 0.35;
        if (playing && !P.grabbed && Math.abs(P.s - h.s) < 6.5 * sc && Math.abs(P.lat - h.laneLat) < 4.6 * sc) {
          if (P.chokedT <= 0) toast('◉ SPORES IN THE INTAKE!', '#d8e64a');
          P.chokedT = Math.max(P.chokedT, 1.6);
        }
      }
    }
    else if (h.type === 'sap' || h.type === 'chem') {
      if (near && h.disc) {
        const p = 1 + Math.sin(time * (h.type === 'chem' ? 3.4 : 2.2) + h.s) * 0.05;
        h.disc.scale.set(p, p, 1);
      }
    }
    else if (h.type === 'bramble') {
      if (playing) barrierCheck(h, h.latA, h.latB, 1.7, 8);
    }
    else if (h.type === 'growbar') {
      const ext = 0.5 + 0.5 * Math.sin(time * 0.55 + (h.phase || 0));   // grows & shrinks
      const fullA = h.baseA, fullB = h.baseB;
      if (h.side < 0) { h.latA = fullA; h.latB = lerp(fullA + 2.2, fullB + half * 0.55, ext); }
      else { h.latB = fullB; h.latA = lerp(fullB - 2.2, fullA - half * 0.55, ext); }
      if (near) {
        const f = frameAt(h.s);
        trackPos(h.s, (h.latA + h.latB) / 2, 0, _p);
        h.grp.position.copy(_p); h.grp.rotation.y = f.yaw;
        h.grp.scale.x = (h.latB - h.latA) / (fullB - fullA);
      }
      if (playing) barrierCheck(h, h.latA, h.latB, 1.7, 8);
    }
    else if (h.type === 'tentacle') {
      h.centerLat = Math.sin(time * 0.6 + (h.phase || 0)) * (half - 3.1);
      if (near) {
        const f = frameAt(h.s);
        trackPos(h.s, h.centerLat, 0.55 + Math.sin(time * 2.4 + h.phase) * 0.12, _p);
        h.grp.position.copy(_p); h.grp.rotation.y = f.yaw;
        h.arm.rotation.y = Math.sin(time * 1.1 + h.phase) * 0.22;
      }
      if (playing) barrierCheck(h, h.centerLat - 2.7, h.centerLat + 2.7, 1.8, 10);
    }
    else if (h.type === 'door') {
      h.closed = doorClosedness(h, time);
      if (near) {
        h.panel.position.y = lerp(11.2, 3.7, h.closed);
        const colr = h.closed < 0.08 ? 0x37e08b : h.closed > 0.92 ? 0xff3b47 : 0xffb020;
        for (const lm of h.lights) { lm.color.setHex(colr); lm.emissive.setHex(colr); }
      }
    }
    else if (h.type === 'pad') {
      if (h.cd > 0) { h.cd -= dt; if (h.cd <= 0) h.padMat.emissiveIntensity = 1.1; }
      if (playing && h.cd <= 0 && Math.abs(P.s - h.s) < 2.7 && Math.abs(P.lat - h.lat) < 2.1) {
        h.cd = 4; h.padMat.emissiveIntensity = 0.25; P.padT = 1.15;
        toast('▲ BOOST PAD!', '#7db4ff'); AU.pad();
        trackPos(P.s, P.lat, 0.5, _p); burst(_p, 0x1f5eff, 12, 2, 3);
      }
    }
    else if (h.type === 'nitro' || h.type === 'repair') {
      if (!h.taken && near) {
        h.grp.rotation.y += dt * 1.8;
        h.grp.position.y = h.baseY + Math.sin(time * 2.4 + h.s) * 0.16;
        if (playing && Math.abs(P.s - h.s) < 2.3 && Math.abs(P.lat - h.lat) < 1.9) {
          h.taken = true; h.grp.visible = false; stats.pickups++;
          if (h.type === 'nitro') { P.boost = Math.min(100, P.boost + 45); toast('⚡ NITRO CELL +45', '#7db4ff'); burst(h.grp.position, 0x35c8ff, 14, 2.5, 4); }
          else { P.hull = Math.min(100, P.hull + 22); toast('✚ HULL PATCH +22', '#2fe07a'); burst(h.grp.position, 0x2fe07a, 14, 2.5, 4); }
          AU.pickup();
        }
      }
    }
  }
}

/* sap / chem pools + grabber trigger, all in track-space */
function checkPools() {
  let inSap = false, inChem = false;
  for (const h of hazards) {
    if (h.type !== 'sap' && h.type !== 'chem') continue;
    const ds = P.s - h.s, dl = P.lat - h.lat;
    if (ds * ds + dl * dl < h.r * h.r) { if (h.type === 'chem') inChem = true; else inSap = true; }
  }
  if (inSap && !P.inSap && state === 'race') toast('◉ SAP! BOOST TO POWER THROUGH', '#b46bff');
  if (inChem && !P.inChem && state === 'race') toast('☣ CHEM SLICK — NO GRIP', '#7dff4d');
  P.inSap = inSap; P.inChem = inChem;
}
function checkGrabbers(prevS) {
  if (P.grabbed) return;
  const boostingNow = (keys.boost && P.boost > 1) || P.padT > 0;
  for (const h of hazards) {
    if (h.type !== 'grabber' || h.disabledT > 0) continue;
    if (prevS < h.s && P.s >= h.s) {
      if (boostingNow && P.speed > 30) {
        h.disabledT = 8; stats.burns++;
        trackPos(h.s, P.lat, 2, _p); burst(_p, 0xffa022, 22, 4, 5);
        toast('🔥 BURNED THROUGH THE VINE! +150', '#ffb020'); AU.free();
      } else {
        startGrab(h);
      }
      break;
    }
  }
}

/* ------------------------------ player update ---------------------------- */
function updatePlayer(dt, time) {
  const prevS = P.s;
  const half = halfAt(clamp(P.s, 0, TRACK_LEN));
  const steer = (keys.right ? 1 : 0) - (keys.left ? 1 : 0);

  /* timers */
  if (P.chokedT > 0) P.chokedT -= dt;
  if (P.padT > 0) P.padT -= dt;
  if (P.invulnT > 0) P.invulnT -= dt;
  if (P.pulseCd > 0) P.pulseCd -= dt;

  /* --- simplified PACK-DRIVING: auto-drive picks the target speed --- */
  let target = CRUISE;
  const wantBoost = keys.boost && P.boost > 0.5 && !P.grabbed;
  if (P.padT > 0) target = BOOSTV + 4;
  else if (wantBoost) { target = BOOSTV; P.boost = Math.max(0, P.boost - 21 * dt); }
  else if (keys.brake) target = BRAKEV;
  if (!wantBoost && P.padT <= 0) P.boost = Math.min(100, P.boost + 3.2 * dt);   // slow regen
  if (P.chokedT > 0) target *= 0.45;                                            // spores choke engine
  checkPools();
  if (P.inSap) target *= (wantBoost || P.padT > 0) ? 0.58 : 0.33;               // sap drag
  if (P.inChem) target *= 0.8;                                                  // slick: little drag…
  if (P.grabbed) {
    target = 0;
    P.hull = Math.max(0, P.hull - 1.1 * dt);                                   // it's digesting you…
    P.grabProg = Math.max(0, P.grabProg - dt * 0.35); updatePips();
    if (P.hull <= 0) { wreck(); }
  }
  const rate = target > P.speed ? 0.62 : 2.1;
  P.speed += (target - P.speed) * Math.min(1, dt * rate * (P.grabbed ? 6 : 1));
  if (P.speed < 0.02 && target === 0) P.speed = 0;

  /* steering — lateral velocity, sluggish in sap */
  const maxLat = 13.5 * clamp(P.speed / CRUISE, 0.3, 1.12) * (P.inSap ? 0.55 : 1) * (P.inChem ? 0.32 : 1);  // …but no grip
  const steerRate = P.grabbed ? 0 : maxLat;
  P.latVel = damp(P.latVel, steer * steerRate, P.inSap ? 5 : 9, dt);
  P.lat += P.latVel * dt;
  const latLim = half - 1.15;
  if (P.lat > latLim) { if (P.latVel > 6) shake = Math.min(1, shake + .18); P.lat = latLim; P.latVel = Math.min(P.latVel, 0); }
  if (P.lat < -latLim) { if (P.latVel < -6) shake = Math.min(1, shake + .18); P.lat = -latLim; P.latVel = Math.max(P.latVel, 0); }

  /* central islands fork the causeway — clipping one shoves you into a passage */
  for (const h of hazards) {
    if (h.type !== 'divider') continue;
    const hs = h.len / 2 + 1.2;
    if (P.s < h.s - hs || P.s > h.s + hs) continue;
    if (P.lat <= h.latA - 0.8 || P.lat >= h.latB + 0.8) continue;
    const dir = (P.lat - h.latA) < (h.latB - P.lat) ? -1 : 1;
    P.lat = dir < 0 ? h.latA - 1.0 : h.latB + 1.0;
    P.latVel = dir * 4.5;
    P.speed *= 0.6;
    shake = Math.min(1, shake + 0.3);
    if (h.hitCd <= 0) { h.hitCd = 1.4; damage(7, dir); toast('▮ ISLAND CLIP!', '#ffb020'); }
  }

  /* advance + blast-door blocking (the lab literally holds you still) */
  let nextS = P.s + P.speed * dt;
  P.doorHeld = false;
  if (!P.grabbed) for (const h of hazards) {
    if (h.type !== 'door' || h.closed < 0.5) continue;
    const stopS = h.s - 3.1;
    if (P.s <= stopS + 0.01 && nextS > stopS) { nextS = stopS; P.speed = 0; P.doorHeld = true; }
  }
  P.s = nextS;
  checkGrabbers(prevS);

  /* zone banners */
  const zi = zoneAt(P.s);
  if (zi !== zoneIdx) {
    zoneIdx = zi;
    showBanner('ZONE ' + (zi + 1) + ' / 6', ZONES[zi].name, ZONES[zi].sub);
  }
  raceTime += dt;

  if (P.s >= FINISH_S && state === 'race') finishRun();

  /* audio */
  AU.engine(clamp(P.speed / BOOSTV, 0, 1) * (P.chokedT > 0 ? 0.55 : 1), true);
  return { wantBoost };
}

/* car + camera visuals */
const camPos = new THREE.Vector3(0, 6, 16), camLook = new THREE.Vector3();
function poseCar(dt, time, wantBoost) {
  const f = frameAt(P.s);
  trackPos(P.s, P.lat, 0, _p);
  car.position.copy(_p);
  car.position.y = Math.sin(time * 22) * 0.012 * clamp(P.speed / 20, 0, 1) + (P.grabbed ? Math.sin(time * 30) * 0.03 : 0);
  car.rotation.y = f.yaw - P.latVel * 0.017;
  car.rotation.z = damp(car.rotation.z, -P.latVel * 0.016, 8, dt);
  car.rotation.x = damp(car.rotation.x, clamp((wantBoost ? 0.02 : 0) + (keys.brake ? -0.02 : 0), -.05, .05), 6, dt);
  const spin = P.speed * dt / 0.42;
  for (const w of wheels) w.rotation.x -= spin;
  const steerVis = clamp(P.latVel * 0.028, -0.42, 0.42);
  frontAxleL.rotation.y = frontAxleR.rotation.y = -steerVis;
  brakeMat.emissiveIntensity = keys.brake || P.doorHeld ? 3.2 : 0.5;
  carBodyMat.emissive.setRGB(P.invulnT > 0 ? (Math.sin(time * 34) > 0 ? 0.35 : 0.05) : 0, 0.02, 0.02);
  /* cutter ring animation */
  cutterT += dt;
  if (cutterT < 0.55) {
    const pr = cutterT / 0.55;
    cutterRing.scale.set(1 + pr * 5.5, 1 + pr * 5.5, 1);
    cutterRing.material.opacity = (1 - pr) * 0.85;
  } else cutterRing.material.opacity = 0;
  /* grab vine from canopy to roof */
  if (P.grabbed && P.grabH) {
    trackPos(P.grabH.s, P.lat * 0.6, 6.1, _a);
    _b.copy(car.position).setY(1.35);
    stemBetween(grabVine, _a, _b);
    vineWrap.rotation.y += dt * 1.2;
  }
  /* hazard-adjacent props follow */
  sporeGroup.position.copy(car.position);
  sun.position.set(car.position.x + 34, 52, car.position.z + 22);
  sun.target.position.copy(car.position);
}
function updateCamera(dt, time, wantBoost) {
  if (state === 'menu') {
    menuS = (menuS + dt * 10.5) % 480;
    trackPos(menuS, Math.sin(time * 0.3) * 3, 5.4, _p);
    camera.position.lerp(_p, 1 - Math.exp(-2.2 * dt));
    trackPos(menuS + 22, 0, 1.2, _p); camera.lookAt(_p);
    return;
  }
  if (state === 'end') {
    endOrbit += dt * 0.45;
    _p.set(car.position.x + Math.sin(endOrbit) * 9, 3.6, car.position.z + Math.cos(endOrbit) * 9);
    camera.position.lerp(_p, 1 - Math.exp(-2.5 * dt));
    camera.lookAt(car.position.x, 1, car.position.z);
    return;
  }
  const back = 9.6 + clamp(P.speed / BOOSTV, 0, 1) * 1.6;
  trackPos(P.s - back, P.lat * 0.55, 4.7, _p);
  camPos.lerp(_p, 1 - Math.exp(-5.5 * dt));
  camera.position.copy(camPos);
  if (shake > 0.003) {
    camera.position.x += rand(-1, 1) * shake * 0.22;
    camera.position.y += rand(-1, 1) * shake * 0.18;
    shake = Math.max(0, shake - dt * 1.9);
  }
  trackPos(P.s + 15, P.lat * 0.8, 1.05, _p);
  camLook.lerp(_p, 1 - Math.exp(-8 * dt));
  camera.lookAt(camLook);
  const targetFov = (wantBoost || P.padT > 0) ? 72 : 62;
  camera.fov = damp(camera.fov, targetFov, 4, dt); camera.updateProjectionMatrix();
}

/* ------------------------------- HUD sync --------------------------------- */
function updateHUD(wantBoost) {
  el.zone.textContent = 'ZONE ' + (zoneAt(P.s) + 1) + ' · ' + ZONES[zoneAt(P.s)].name;
  el.timer.innerHTML = fmtTime(raceTime) + (isFinite(best) ? ' <small>/ ' + fmtTime(best) + '</small>' : '');
  const pr = clamp(P.s / FINISH_S, 0, 1);
  el.progFill.style.width = (pr * 100) + '%';
  el.progCar.style.left = 'calc(' + (pr * 100) + '% - 1px)';
  el.hullFill.style.width = P.hull + '%'; el.hullVal.textContent = Math.round(P.hull) + '%';
  el.boostFill.style.width = P.boost + '%'; el.boostVal.textContent = Math.round(P.boost) + '%';
  el.vitals.classList.toggle('low', P.hull < 30);
  el.speed.textContent = Math.round(P.speed * 3.6);
  let gear = 'AUTO-DRIVE', gc = '';
  if (P.grabbed) { gear = '!! GRABBED !!'; gc = 'stuck'; }
  else if (P.doorHeld) { gear = 'DOOR HOLD'; gc = 'stuck'; }
  else if (P.padT > 0 || wantBoost) { gear = 'BOOST ▲▲'; gc = 'boost'; }
  else if (keys.brake) { gear = 'BRAKE ▼'; gc = 'brake'; }
  else if (P.chokedT > 0) { gear = 'CHOKED'; gc = 'brake'; }
  else if (P.inSap) { gear = 'IN SAP'; gc = 'brake'; }
  else if (P.inChem) { gear = 'SLIDING'; gc = 'brake'; }
  el.gear.textContent = gear; el.gear.className = gc;
  el.fx.textContent = P.grabbed ? 'GRABBED' : P.inSap ? 'SAP DRAG' : P.inChem ? 'CHEM SLICK' : P.chokedT > 0 ? 'SPORE CHOKE' : P.doorHeld ? 'HELD BY DOOR' : 'CLEAR';
  el.fx.style.color = P.grabbed ? '#ff5b64' : P.inSap ? '#b46bff' : P.inChem ? '#7dff4d' : P.chokedT > 0 ? '#d8e64a' : P.doorHeld ? '#ffb020' : '#37e08b';
  el.chipSpore.classList.toggle('on', P.chokedT > 0);
  el.chipSap.classList.toggle('on', P.inSap);
  el.chipChem.classList.toggle('on', P.inChem);
  el.chipDoor.classList.toggle('on', P.doorHeld);
  el.chipHurt.classList.toggle('on', hurtChipT > 0);
  el.sporeFx.style.opacity = P.chokedT > 0 ? 1 : 0;
}

/* ------------------------- shadow-box plan map ---------------------------- */
function drawMap() {
  const cv = $('mapCanvas'), g = cv.getContext('2d');
  const W = cv.width, H = cv.height;
  const x0 = 46, x1 = W - 46, midY = 168, latScale = 5.2;
  const X = s => x0 + (s / TRACK_LEN) * (x1 - x0);
  const Y = (s, lat) => midY + (centerX(s) + lat) * latScale;
  g.fillStyle = '#06120a'; g.fillRect(0, 0, W, H);
  /* zone bands */
  ZONES.forEach((z, i) => {
    g.fillStyle = i % 2 ? 'rgba(255,255,255,.045)' : 'rgba(55,224,139,.05)';
    g.fillRect(X(z.from), 24, X(z.to) - X(z.from), 300);
    g.strokeStyle = 'rgba(255,255,255,.14)'; g.strokeRect(X(z.from), 24, X(z.to) - X(z.from), 300);
    g.fillStyle = '#8dff57'; g.font = '800 19px ui-monospace, monospace'; g.textAlign = 'left';
    g.fillText('Z' + (i + 1), X(z.from) + 8, 52);
    g.fillStyle = 'rgba(255,255,255,.75)'; g.font = '600 12.5px ui-monospace, monospace';
    const words = z.name.replace(' · ', ' ').split(' ');
    words.forEach((w, j) => g.fillText(w, X(z.from) + 8, 342 + j * 17));
    g.fillStyle = 'rgba(255,255,255,.38)'; g.font = '11px ui-monospace, monospace';
    g.fillText('W' + (z.half * 2).toFixed(0) + 'm', X(z.from) + 8, 312);
  });
  /* road ribbon */
  g.beginPath();
  for (let s = 0; s <= TRACK_LEN; s += 8) { const x = X(s), y = Y(s, -halfAt(s)); s === 0 ? g.moveTo(x, y) : g.lineTo(x, y); }
  for (let s = TRACK_LEN; s >= 0; s -= 8) g.lineTo(X(s), Y(s, halfAt(s)));
  g.closePath(); g.fillStyle = '#232b31'; g.fill();
  g.strokeStyle = '#4d80ff'; g.lineWidth = 2; g.stroke();
  g.beginPath();
  for (let s = 0; s <= TRACK_LEN; s += 8) { const x = X(s), y = Y(s, 0); s === 0 ? g.moveTo(x, y) : g.lineTo(x, y); }
  g.strokeStyle = 'rgba(31,94,255,.65)'; g.setLineDash([7, 6]); g.stroke(); g.setLineDash([]);
  /* hazards */
  const COLORS = { snapper: '#ff3b47', flower: '#ff5fa3', grabber: '#37e08b', puffer: '#d8e64a', sap: '#b46bff', chem: '#7dff4d', bramble: '#ffb020', growbar: '#ffb020', door: '#ffb020', tentacle: '#ff2f7e', pad: '#4d80ff', nitro: '#35c8ff', repair: '#2fe07a' };
  for (const h of hazards) {
    const half = halfAt(Math.min(h.s, TRACK_LEN));
    if (h.type === 'divider') {                     // playable fork: two passages
      const x = X(h.s - h.len / 2), w = Math.max(4, X(h.s + h.len / 2) - x);
      const y0 = Y(h.s, h.latA), y1 = Y(h.s, h.latB);
      g.fillStyle = 'rgba(255,176,32,.8)'; g.fillRect(x, y0, w, y1 - y0);
      g.strokeStyle = '#ffb020'; g.lineWidth = 1.5; g.strokeRect(x, y0, w, y1 - y0);
      g.fillStyle = 'rgba(255,255,255,.65)'; g.font = '600 9px ui-monospace, monospace'; g.textAlign = 'center';
      g.fillText('FORK', x + w / 2, y0 - 5);
      continue;
    }
    const lat = h.type === 'snapper' ? h.lat
      : h.type === 'puffer' ? h.side * (half + 2.4)
        : h.type === 'bramble' || h.type === 'growbar' ? h.side * (half * 0.5)
          : h.type === 'grabber' || h.type === 'door' || h.type === 'tentacle' ? 0 : (h.lat || 0);
    const x = X(h.s), y = Y(h.s, lat);
    g.fillStyle = COLORS[h.type] || '#fff';
    if (h.type === 'door' || h.type === 'grabber') { g.fillRect(x - 2, Y(h.s, -half), 4, Y(h.s, half) - Y(h.s, -half)); }
    else if (h.type === 'sap' || h.type === 'chem') { g.beginPath(); g.arc(x, y, h.r * latScale * .8, 0, 7); g.globalAlpha = .55; g.fill(); g.globalAlpha = 1; }
    else if (h.type === 'flower') {                 // all blooms identical — that's the point
      g.beginPath(); g.arc(x, y, 4.6, 0, 7); g.fill();
      g.strokeStyle = 'rgba(255,255,255,.5)'; g.lineWidth = 1; g.stroke();
    }
    else { g.beginPath(); g.arc(x, y, h.big ? 9 : 5.5, 0, 7); g.fill(); g.strokeStyle = 'rgba(0,0,0,.6)'; g.lineWidth = 1.5; g.stroke(); }
    if (h.big) { g.fillStyle = '#ff2f7e'; g.font = '800 13px ui-monospace, monospace'; g.textAlign = 'center'; g.fillText('★ MOTHER MAW', x, Y(h.s, -half) - 12); }
  }
  /* side passages branching off the causeway */
  g.strokeStyle = 'rgba(255,176,32,.5)'; g.lineWidth = 2;
  for (const pg of PASSAGES) {
    const half = halfAt(pg.s), y0 = Y(pg.s, pg.side * half), y1 = Y(pg.s, pg.side * (half + 7));
    g.beginPath(); g.moveTo(X(pg.s), y0); g.lineTo(X(pg.s) + 10, y1); g.stroke();
  }
  g.fillStyle = 'rgba(255,176,32,.7)'; g.font = '600 10px ui-monospace, monospace'; g.textAlign = 'left';
  g.fillText('↗ SIDE PASSAGES', W - 232, H - 42);
  /* start / finish */
  g.font = '800 15px ui-monospace, monospace'; g.textAlign = 'center';
  g.fillStyle = '#fff'; g.fillText('▶ START · AIRLOCK', X(0) + 54, Y(0, 0) - 34);
  g.fillStyle = '#7db4ff'; g.fillText('🏁 EXTRACTION', X(FINISH_S) - 62, Y(FINISH_S, 0) - 36);
  g.fillStyle = 'rgba(255,255,255,.4)'; g.font = '11px ui-monospace, monospace';
  g.fillText('track length 1.44 km · greybox blockout — all art is placeholder primitives', W / 2, H - 10);
}
drawMap();

/* -------------------------------- main loop ------------------------------- */
const clock = new THREE.Clock();
resetRun();
trackPos(P.s, 0, 0, _p); car.position.copy(_p);
el.best.textContent = 'BEST ' + fmtTime(best);

let gameTime = 0;
function animate() {
  const dt = Math.min(0.05, clock.getDelta());
  if (state !== 'pause') gameTime += dt;
  const time = gameTime;
  let wantBoost = false;

  if (state === 'count') {
    countT -= dt;
    const n = Math.ceil(countT);
    if (n !== lastCount && n >= 1) { lastCount = n; el.cd.textContent = n; AU.count(false); }
    if (countT <= 0) {
      state = 'race'; el.cd.textContent = 'GO!'; AU.count(true);
      setTimeout(() => el.cd.classList.remove('on'), 550);
      showBanner('ZONE 1 / 6', ZONES[0].name, ZONES[0].sub); zoneIdx = 0;
    }
    P.speed = damp(P.speed, 0, 4, dt);
    poseCar(dt, time, false); updateCamera(dt, time, false);
    updateHazards(dt, time, false);
    updateHUD(false);
  }
  else if (state === 'race') {
    const r = updatePlayer(dt, time);
    wantBoost = r.wantBoost;
    updateHazards(dt, time, true);
    poseCar(dt, time, wantBoost); updateCamera(dt, time, wantBoost);
    updateHUD(wantBoost);
  }
  else if (state === 'menu') {
    P.s = 2; P.lat = 0;
    poseCar(dt, time, false); updateCamera(dt, time, false);
    /* animate plants vs. the fly-through camera position */
    const saveS = P.s; P.s = menuS; updateHazards(dt, time, false); P.s = saveS;
  }
  else if (state === 'end') {
    P.speed = damp(P.speed, 0, 0.8, dt);
    P.s += P.speed * dt;
    poseCar(dt, time, false); updateCamera(dt, time, false);
    updateHazards(dt, time, false);
    if (P.hull <= 0 && Math.random() < 0.3) { trackPos(P.s, P.lat, 1, _p); burst(_p, Math.random() < .5 ? 0xff7722 : 0x444444, 2, 1, 3); }
  }
  /* pause: freeze the world, keep rendering */

  if (bannerT > 0) { bannerT -= dt; if (bannerT <= 0) el.banner.classList.remove('on'); }
  if (toastT > 0) { toastT -= dt; if (toastT <= 0) el.toast.classList.remove('on'); }
  if (hurtChipT > 0) hurtChipT -= dt;

  cullWorld();
  sporeGroup.userData.update(dt, time);
  updateParticles(state === 'pause' ? 0 : dt);
  renderer.render(scene, camera);
}
renderer.setAnimationLoop(animate);

addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
});
addEventListener('contextmenu', e => { if (state === 'race') e.preventDefault(); });

/* Debug / tuning hook — e.g. in devtools: __BIOLAB__.P.s = 1050 (jump to the Maw),
   __BIOLAB__.P.hull = 100, __BIOLAB__.hazards.filter(h=>h.type==='snapper')        */
window.__BIOLAB__ = {
  P, hazards, ZONES, startRun,
  get state() { return state; }, get time() { return raceTime; }, get gameTime() { return gameTime; },
  get info() { return { calls: renderer.info.render.calls, tris: renderer.info.render.triangles, culled: CULLABLES.length }; },
};
