import * as THREE from 'three';
import { buildContourCard, SkinBuilder } from './featherGeo.js';
import { COLORS, HEAD } from './anatomy.js';
import { latticeCoords } from './coat.js';

// Head frame: origin at the occipital condyle/atlas, +Z toward the bill, +Y dorsal.
// Head length (occiput → bill tip) ≈ 0.155 m; width across the supraorbital ridges ≈ 0.072 m.

const ss = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
const lerp = (a, b, t) => a + (b - a) * t;
function rng(seed) { let s = seed >>> 0; return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296); }

const CENTER = new THREE.Vector3(0, 0.020, 0.042);
export const EYE_C = new THREE.Vector3(0.0222, 0.0215, 0.0540);

// skull / feathered head volume as a smooth union of ellipsoids (centre, radii)
const PRIMS = [
  [[0, 0.022, 0.032], [0.0365, 0.0285, 0.045]],  // cranium (flat-topped)
  [[0, 0.013, 0.006], [0.033, 0.033, 0.030]],   // occiput / nape
  [[0.0185, 0.0372, 0.053], [0.0195, 0.0095, 0.027], 0.024], // supraorbital shelf L ("brow" — gives the eagle its frown)
  [[-0.0185, 0.0372, 0.053], [0.0195, 0.0095, 0.027], 0.024],
  [[0, 0.0335, 0.058], [0.026, 0.0135, 0.034], 0.02],   // forehead: fills between the brows, slopes down to the cere // R
  [[0, 0.006, 0.047], [0.0345, 0.022, 0.040]],  // cheeks / jaw muscles
  [[0, 0.021, 0.079], [0.0175, 0.0185, 0.022]], // lores, meets the cere
  [[0, -0.006, 0.030], [0.025, 0.021, 0.040]],  // throat
];

function rayEllipsoid(o, d, c, r) { // far intersection distance or −1
  const ox = (o.x - c[0]) / r[0], oy = (o.y - c[1]) / r[1], oz = (o.z - c[2]) / r[2];
  const dx = d.x / r[0], dy = d.y / r[1], dz = d.z / r[2];
  const A = dx * dx + dy * dy + dz * dz, B = 2 * (ox * dx + oy * dy + oz * dz), Cc = ox * ox + oy * oy + oz * oz - 1;
  const disc = B * B - 4 * A * Cc;
  if (disc < 0) return -1;
  return (-B + Math.sqrt(disc)) / (2 * A);
}
function raySphereNear(o, d, c, r) {
  const ox = o.x - c.x, oy = o.y - c.y, oz = o.z - c.z;
  const b = ox * d.x + oy * d.y + oz * d.z, cc = ox * ox + oy * oy + oz * oz - r * r;
  const disc = b * b - cc;
  if (disc < 0) return -1;
  const t = -b - Math.sqrt(disc);
  return t > 0 ? t : -1;
}
const smax = (a, b, k) => { const h = Math.max(k - Math.abs(a - b), 0) / k; return Math.max(a, b) + h * h * k * 0.25; };
const smin = (a, b, k) => -smax(-a, -b, k);

export function headRadius(d) {
  let r = 0;
  for (const [c, rr, k] of PRIMS) { const t = rayEllipsoid(CENTER, d, c, rr); if (t > 0) r = r === 0 ? t : smax(r, t, k || 0.009); }
  // eyes: the skin wraps the eyeball and forms the lid margins; only an almond-shaped aperture
  // (flat, hooded upper margin under the supraorbital ridge) exposes the cornea and iris.
  _rim = 0;
  for (const sx of [1, -1]) {
    const ec = _ec.set(EYE_C.x * sx, EYE_C.y, EYE_C.z);
    const hit = raySphere2(CENTER, d, ec, HEAD.eyeRadius + 0.0006);
    if (!hit) continue;
    const [tn, tf] = hit;
    const pf = _pf.copy(CENTER).addScaledVector(d, tf).sub(ec).normalize();
    const gz = _gz.set(Math.sin(EYE_YAW) * sx, 0, Math.cos(EYE_YAW));
    const theta = Math.acos(Math.max(-1, Math.min(1, pf.dot(gz))));
    const up = pf.y; // eye-local up is head up
    const ap = (up > 0 ? lerp(43, 31, Math.min(1, up / 0.35)) : 43) * Math.PI / 180;
    if (theta < ap) r = Math.min(r, tn + 0.0005);
    else {
      r = Math.max(r, tf + 0.0013);
      _rim = Math.max(_rim, 1 - Math.min(1, (theta - ap) / (6 * Math.PI / 180)));
    }
  }
  return r;
}
export const EYE_YAW = 0.99;
let _rim = 0;
export const lastRim = () => _rim;
const _ec = new THREE.Vector3(), _pf = new THREE.Vector3(), _gz = new THREE.Vector3();
function raySphere2(o, d, c, r) {
  const ox = o.x - c.x, oy = o.y - c.y, oz = o.z - c.z;
  const b = ox * d.x + oy * d.y + oz * d.z, cc = ox * ox + oy * oy + oz * oz - r * r;
  const disc = b * b - cc;
  if (disc < 0) return null;
  const s = Math.sqrt(disc);
  return [-b - s, -b + s];
}

function mergeWeights(list) {
  const m = new Map();
  for (const [b, w] of list) if (w > 1e-4) m.set(b, (m.get(b) || 0) + w);
  const arr = [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, 4);
  const tot = arr.reduce((s, e) => s + e[1], 0) || 1;
  return arr.map(([b, w]) => [b, w / tot]);
}

function finishGeo(pos, idx, extra = {}) {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  for (const [k, [arr, n, T]] of Object.entries(extra)) g.setAttribute(k, new (T || THREE.Float32BufferAttribute)(arr, n));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

// Transform a head-local geometry into bind space and attach skin attributes.
function toBind(g, matrix, weightsFn) {
  g.applyMatrix4(matrix);
  const n = g.attributes.position.count;
  const si = new Uint16Array(n * 4), sw = new Float32Array(n * 4);
  const p = new THREE.Vector3();
  for (let i = 0; i < n; i++) {
    p.fromBufferAttribute(g.attributes.position, i);
    const w = weightsFn(i, p);
    for (let q = 0; q < 4; q++) { si[i * 4 + q] = w[q] ? w[q][0] : 0; sw[i * 4 + q] = w[q] ? w[q][1] : 0; }
  }
  g.setAttribute('skinIndex', new THREE.BufferAttribute(si, 4));
  g.setAttribute('skinWeight', new THREE.BufferAttribute(sw, 4));
  return g;
}

// ------------------------------------------------------------------------------------------------
export function buildHead(rig) {
  rig.root.updateMatrixWorld(true);
  const HM = rig.head.matrixWorld.clone();
  const headI = rig.head.userData.index, n13 = rig.neck[rig.neck.length - 1].userData.index, n12 = rig.neck[rig.neck.length - 2].userData.index;
  const out = {};

  // ---------- skull / feathered head surface (lat-long around the Z axis)
  const NU = 180, NV = 140; // around, along (dense enough to resolve the lid margins)
  const pos = [], col = [], idx = [], dirs = [];
  const white = new THREE.Color(COLORS.white).multiplyScalar(0.62);
  for (let j = 0; j <= NV; j++) {
    const th = (j / NV) * Math.PI; // 0 = +Z (bill) … π = −Z (nape)
    for (let i = 0; i <= NU; i++) {
      const ph = (i / NU) * Math.PI * 2;
      const d = new THREE.Vector3(Math.sin(th) * Math.cos(ph), Math.sin(th) * Math.sin(ph), Math.cos(th));
      const r = headRadius(d);
      const p = CENTER.clone().addScaledVector(d, r);
      pos.push(p.x, p.y, p.z); dirs.push(d);
      // bare lid margin: dark grey-olive skin at the aperture rim
      const c = white.clone().lerp(new THREE.Color(0x3d3528), _rim ** 1.5);
      col.push(c.r, c.g, c.b);
    }
  }
  for (let j = 0; j < NV; j++) for (let i = 0; i < NU; i++) {
    const a = j * (NU + 1) + i, b = a + 1, c = a + NU + 1, d = c + 1;
    idx.push(a, c, b, b, c, d);
  }
  // feather-coat attributes: feathers stream from the bill (θ = 0) back over the head to the nape (θ = π)
  const rimArr = [];
  for (let j = 0; j <= NV; j++) for (let i = 0; i <= NU; i++) { headRadius(dirs[j * (NU + 1) + i]); rimArr.push(lastRim()); }
  const Pgrid = [];
  for (let j = 0; j <= NV; j++) { const row = []; for (let i = 0; i <= NU; i++) { const o = (j * (NU + 1) + i) * 3; row.push(new THREE.Vector3(pos[o], pos[o + 1], pos[o + 2])); } Pgrid.push(row); }
  const fsH = (j) => lerp(0.0032, 0.0068, ss(0.25, 2.0, (j / NV) * Math.PI));
  const coat = latticeCoords(Pgrid, (j) => fsH(j), NU / 4, -1);
  const aWhite = [], aLance = [], aBare = [];
  for (let j = 0; j <= NV; j++) for (let i = 0; i <= NU; i++) {
    const th = (j / NV) * Math.PI;
    aWhite.push(1); aLance.push(0.85 * ss(1.7, 2.6, th));
    aBare.push(Math.min(1, rimArr[j * (NU + 1) + i] * 1.6));
  }
  const skull = finishGeo(pos, idx, { color: [col, 3], aCoat: [coat, 2], aWhite: [aWhite, 1], aLance: [aLance, 1], aBare: [aBare, 1] });
  toBind(skull, HM, (i, p) => {
    const lp = new THREE.Vector3(pos[i * 3], pos[i * 3 + 1], pos[i * 3 + 2]);
    const f = ss(0.02, -0.012, lp.z) * 0.6;
    return mergeWeights([[headI, 1 - f], [n13, f]]);
  });
  out.skull = skull;

  // ---------- head feathers (small, white; lanceolate and longer on the nape — the "hackles")
  {
    const B = new SkinBuilder();
    const R = rng(91);
    const aBaseNormal = [], aLen = [], aMask = [];
    const tmp = skull.clone(); // bind space
    const hp = [];
    // sample points on the head surface in head-local space (lat-long with area-aware jitter)
    const accepted = [];
    const cell = 0.004, grid = new Map();
    const key = (p) => `${Math.floor(p.x / cell)},${Math.floor(p.y / cell)},${Math.floor(p.z / cell)}`;
    const beakRef = new THREE.Vector3(0, 0.012, 0.13);
    const sizeAt = (p) => {
      // small on the face, larger on crown, longest on the nape and throat
      const back = ss(0.05, -0.01, p.z);
      return lerp(0.0075, 0.017, back) * (1 + 0.15 * ss(0.03, -0.01, p.y));
    };
    for (let tries = 0; tries < 90000 && accepted.length < 1100; tries++) {
      const th = Math.acos(1 - 2 * R()), ph = R() * Math.PI * 2;
      const d = new THREE.Vector3(Math.sin(th) * Math.cos(ph), Math.sin(th) * Math.sin(ph), Math.cos(th));
      const p = CENTER.clone().addScaledVector(d, headRadius(d));
      // skip: eye aperture, cere/bill, far inside the neck
      let skip = false;
      for (const sx of [1, -1]) if (p.distanceTo(new THREE.Vector3(EYE_C.x * sx, EYE_C.y, EYE_C.z)) < HEAD.eyeRadius + 0.0045) skip = true;
      if (p.z > 0.083 && p.y > -0.012) skip = true;       // cere & bill base
      if (p.z > 0.066 && p.y < 0.002 && Math.abs(p.x) < 0.024) skip = true; // gape / lower bill base
      if (p.z < -0.004 && p.y < 0.02) skip = true;        // inside the neck (neck feathers cover this)
      if ((p.z > 0.022 && p.y > -0.004) || p.y > 0.03) skip = true; // face and crown: coat shader; cards only where the neck joins (nape, throat)
      if (skip) continue;
      const L = sizeAt(p);
      const rmin = L * 0.26;
      const kx = Math.floor(p.x / cell), ky = Math.floor(p.y / cell), kz = Math.floor(p.z / cell);
      let ok = true;
      const rc = Math.ceil(rmin / cell);
      for (let a = -rc; a <= rc && ok; a++) for (let b = -rc; b <= rc && ok; b++) for (let c = -rc; c <= rc && ok; c++) {
        const lst = grid.get(`${kx + a},${ky + b},${kz + c}`);
        if (lst) for (const q of lst) if (q.distanceTo(p) < rmin) { ok = false; break; }
      }
      if (!ok) continue;
      const k = key(p); if (!grid.has(k)) grid.set(k, []); grid.get(k).push(p);
      accepted.push({ p, d, L });
    }
    const m = new THREE.Matrix4();
    for (const { p, d, L } of accepted) {
      // normal from a finite difference of the radial function
      const e = 0.01;
      const t1 = new THREE.Vector3().crossVectors(d, Math.abs(d.y) < 0.9 ? new THREE.Vector3(0, 1, 0) : new THREE.Vector3(1, 0, 0)).normalize();
      const t2 = new THREE.Vector3().crossVectors(d, t1).normalize();
      const pa = CENTER.clone().addScaledVector(d.clone().addScaledVector(t1, e).normalize(), headRadius(d.clone().addScaledVector(t1, e).normalize()));
      const pb = CENTER.clone().addScaledVector(d.clone().addScaledVector(t2, e).normalize(), headRadius(d.clone().addScaledVector(t2, e).normalize()));
      const N = new THREE.Vector3().crossVectors(pa.clone().sub(p), pb.clone().sub(p)).normalize();
      if (N.dot(d) < 0) N.negate();
      // feathers stream back from the bill over the crown to the nape, and down the throat
      let dir = p.clone().sub(beakRef).normalize();
      dir.y -= 0.25;
      dir.addScaledVector(N, -dir.dot(N)).normalize();
      dir.applyAxisAngle(N, (R() - 0.5) * 0.3);
      const X = new THREE.Vector3().crossVectors(N, dir).normalize();
      m.makeBasis(X, N, dir).setPosition(p.clone().addScaledVector(N, 0.0003));
      m.premultiply(HM);
      const back = ss(0.04, -0.01, p.z);
      const geo = buildContourCard({ len: L * (0.85 + 0.3 * R()) * 1.2, width: L * lerp(0.55, 0.40, back), lift: 0.05, droop: 0.6, nt: 3, nx: 1 });
      const f = ss(0.02, -0.012, p.z) * 0.6;
      const w = mergeWeights([[headI, 1 - f], [n13, f]]);
      const c = new THREE.Color(COLORS.white).multiplyScalar(0.84 + 0.16 * R());
      B.addGrid(geo, m, () => w, (t, s, o) => o.copy(c).multiplyScalar(0.8 + 0.2 * ss(0.25, 0.92, t)), { rand: R(), kind: 8 });
      const Nw = N.clone().transformDirection(HM);
      for (let q = 0; q < geo.count; q++) { aBaseNormal.push(Nw.x, Nw.y, Nw.z); aLen.push(L); aMask.push(1.0 * back + 0.2); }
    }
    const g = B.build();
    g.setAttribute('aBaseNormal', new THREE.Float32BufferAttribute(aBaseNormal, 3));
    g.setAttribute('aLen', new THREE.Float32BufferAttribute(aLen, 1));
    g.setAttribute('aMask', new THREE.Float32BufferAttribute(aMask, 1));
    out.headFeathers = g;
    tmp.dispose();
  }

  // ---------- upper mandible (rhamphotheca + cere): two-curve loft culmen / tomium
  const upperI = rig.upperBill.userData.index, jawI = rig.jaw.userData.index;
  {
    const culmen = new THREE.CatmullRomCurve3([
      [0.0300, 0.084], [0.0322, 0.099], [0.0316, 0.114], [0.0272, 0.129], [0.0170, 0.1425], [0.0020, 0.1502], [-0.0110, 0.1505], [-0.0205, 0.1455], [-0.0240, 0.1420],
    ].map(([y, z]) => new THREE.Vector3(0, y, z)), false, 'centripetal');
    const tomium = new THREE.CatmullRomCurve3([
      [-0.0035, 0.061], [-0.0058, 0.084], [-0.0078, 0.104], [-0.0098, 0.120], [-0.0128, 0.1325], [-0.0170, 0.1395], [-0.0212, 0.1425], [-0.0240, 0.1420],
    ].map(([y, z]) => new THREE.Vector3(0, y, z)), false, 'centripetal');
    const hwAt = (s) => lerp(0.0205, 0.0005, ss(0, 1, s) ** 0.9) * (1 - 0.18 * Math.sin(Math.PI * s * 0.9) * 0) + 0.0006;
    const NS = 64, NA = 22;
    const pos = [], col = [], idx = [], rough = [];
    const beak = new THREE.Color(COLORS.beak), cere = new THREE.Color(COLORS.beak).multiplyScalar(0.94), tipC = new THREE.Color(0xc98e12), nare = new THREE.Color(0x2a1a08);
    const ringLen = NA * 2;
    for (let k = 0; k <= NS; k++) {
      const s = k / NS;
      const Cp = culmen.getPointAt(s), Tp = tomium.getPointAt(s);
      const hw = hwAt(s) * (1 - s * s * 0.3);
      for (let a = 0; a < ringLen; a++) {
        let x, y, z, inner = a >= NA;
        const q = inner ? (ringLen - 1 - a) / (NA - 1) : a / (NA - 1); // 0 → 1 across (left → right)
        const beta = (q - 0.5) * Math.PI; // −π/2 … π/2
        const cb = Math.cos(beta);
        if (!inner) {
          const lift = Math.pow(cb, 1.35);
          x = hw * Math.sign(beta) * Math.pow(Math.abs(Math.sin(beta)), 0.5);
          y = lerp(Tp.y, Cp.y, lift); z = lerp(Tp.z, Cp.z, lift);
        } else { // palate: shallower arch inside the bill
          const lift = 0.45 * Math.pow(cb, 0.8) * ss(0.0, 0.25, 1 - s);
          x = hw * 0.78 * Math.sin(beta);
          y = lerp(Tp.y, Cp.y, lift) + 0.0006; z = lerp(Tp.z, Cp.z, lift);
        }
        // nostril: oval pit on the side of the cere
        let c = beak.clone();
        const onCere = !inner && s < 0.26 && (y - Tp.y) > 0.25 * (Cp.y - Tp.y);
        if (!inner) {
          const nz = z - 0.0915, ny = y - 0.0175;
          const nd = (nz / 0.0062) ** 2 + (ny / 0.0032) ** 2;
          if (Math.abs(x) > 0.006 && nd < 1) { c = nare.clone(); x *= 1 - 0.12 * (1 - nd); }
          // cere boundary: slight step where the keratin sheath begins
          const edge = ss(0.235, 0.25, s);
          if (onCere) { c = cere.clone(); }
          x *= 1 + 0.03 * edge * (onCere ? 0 : 1);
          c.lerp(tipC, ss(0.7, 1, s) * 0.8);
        } else c = new THREE.Color(0xb88a6e); // palate (fleshy)
        pos.push(x, y, z); col.push(c.r, c.g, c.b); rough.push(onCere ? 0.62 : inner ? 0.7 : 0.28);
      }
    }
    for (let k = 0; k < NS; k++) for (let a = 0; a < ringLen; a++) {
      const i0 = k * ringLen + a, i1 = k * ringLen + (a + 1) % ringLen, i2 = i0 + ringLen, i3 = i1 + ringLen;
      idx.push(i0, i2, i1, i1, i2, i3);
    }
    const g = finishGeo(pos, idx, { color: [col, 3], aRough: [rough, 1] });
    toBind(g, HM, () => [[upperI, 1]]);
    out.upperBill = g;
  }

  // ---------- lower mandible (+ floor of mouth) and tongue
  {
    const tom = new THREE.CatmullRomCurve3([[-0.0040, 0.056], [-0.0070, 0.084], [-0.0098, 0.108], [-0.0125, 0.126], [-0.0148, 0.1355], [-0.0160, 0.1385]].map(([y, z]) => new THREE.Vector3(0, y, z)), false, 'centripetal');
    const bot = new THREE.CatmullRomCurve3([[-0.0215, 0.052], [-0.0245, 0.082], [-0.0246, 0.104], [-0.0228, 0.121], [-0.0190, 0.1335], [-0.0160, 0.1385]].map(([y, z]) => new THREE.Vector3(0, y, z)), false, 'centripetal');
    const NS = 48, NA = 18, ringLen = NA * 2;
    const pos = [], col = [], idx = [], rough = [];
    const beak = new THREE.Color(COLORS.beak), floor = new THREE.Color(0xa9786a);
    for (let k = 0; k <= NS; k++) {
      const s = k / NS;
      const Tp = tom.getPointAt(s), Bp = bot.getPointAt(s);
      const hw = lerp(0.0195, 0.0006, s ** 0.95);
      for (let a = 0; a < ringLen; a++) {
        const inner = a >= NA;
        const q = inner ? (ringLen - 1 - a) / (NA - 1) : a / (NA - 1);
        const beta = (q - 0.5) * Math.PI;
        const cb = Math.cos(beta);
        let x, y, z;
        if (!inner) { const d = Math.pow(cb, 1.2); x = hw * Math.sign(beta) * Math.pow(Math.abs(Math.sin(beta)), 0.55); y = lerp(Tp.y, Bp.y, d); z = lerp(Tp.z, Bp.z, d); }
        else { const d = 0.4 * Math.pow(cb, 0.8) * ss(0, 0.2, 1 - s); x = hw * 0.8 * Math.sin(beta); y = lerp(Tp.y, Bp.y, d) - 0.0005; z = lerp(Tp.z, Bp.z, d); }
        const c = inner ? floor : beak.clone().lerp(new THREE.Color(0xc98e12), ss(0.75, 1, s) * 0.5);
        pos.push(x, y, z); col.push(c.r, c.g, c.b); rough.push(inner ? 0.7 : 0.32);
      }
    }
    for (let k = 0; k < NS; k++) for (let a = 0; a < ringLen; a++) {
      const i0 = k * ringLen + a, i1 = k * ringLen + (a + 1) % ringLen, i2 = i0 + ringLen, i3 = i1 + ringLen;
      idx.push(i0, i1, i2, i1, i3, i2);
    }
    const g = finishGeo(pos, idx, { color: [col, 3], aRough: [rough, 1] });
    toBind(g, HM, () => [[jawI, 1]]);
    out.lowerBill = g;

    // tongue: fleshy, grooved, pointed — lies in the floor of the lower mandible
    const tg = new THREE.SphereGeometry(1, 24, 12);
    tg.scale(0.0085, 0.0035, 0.024);
    tg.translate(0, -0.0145, 0.098);
    const tp = tg.attributes.position;
    for (let i = 0; i < tp.count; i++) { // pointed tip + central groove
      const z = tp.getZ(i), x = tp.getX(i), y = tp.getY(i);
      const f = ss(0.098, 0.122, z);
      tp.setX(i, x * (1 - 0.7 * f));
      if (y > -0.0145) tp.setY(i, y - 0.0012 * Math.exp(-((x / 0.002) ** 2)));
    }
    tg.computeVertexNormals();
    const tcol = []; for (let i = 0; i < tp.count; i++) tcol.push(0.55, 0.33, 0.3);
    tg.setAttribute('color', new THREE.Float32BufferAttribute(tcol, 3));
    toBind(tg, HM, () => [[jawI, 1]]);
    out.tongue = tg;

    // mouth lining: gape skin at the rictus + the back of the oral cavity (stretches between head and jaw)
    const ml = new THREE.SphereGeometry(1, 32, 16, 0, Math.PI * 2, 0, Math.PI);
    ml.scale(0.0125, 0.0075, 0.021);
    ml.translate(0, -0.0072, 0.060);
    const mp = ml.attributes.position;
    const mcol = [];
    for (let i = 0; i < mp.count; i++) mcol.push(0.42, 0.24, 0.23);
    ml.setAttribute('color', new THREE.Float32BufferAttribute(mcol, 3));
    toBind(ml, HM, (i, p) => {
      const lp = new THREE.Vector3(mp.getX(i), mp.getY(i), mp.getZ(i)).applyMatrix4(HM.clone().invert());
      const f = ss(-0.004, -0.016, lp.y) * ss(0.045, 0.085, lp.z);
      return mergeWeights([[headI, 1 - f], [jawI, f]]);
    });
    out.mouth = ml;
  }

  // ---------- eyes, lids, nictitating membranes
  {
    const R = HEAD.eyeRadius;
    const eyeGeoL = new THREE.SphereGeometry(R, 48, 32);
    eyeGeoL.rotateX(Math.PI / 2); // pole → +Z (gaze)
    // corneal bulge
    const ep = eyeGeoL.attributes.position;
    for (let i = 0; i < ep.count; i++) {
      const v = new THREE.Vector3().fromBufferAttribute(ep, i);
      const th = Math.acos(Math.min(1, v.z / R));
      const bulge = 0.0016 * Math.max(0, Math.cos(th * (Math.PI / 2) / 0.78)) ** 1.5;
      v.multiplyScalar(1 + bulge / R);
      ep.setXYZ(i, v.x, v.y, v.z);
    }
    eyeGeoL.computeVertexNormals();
    const eyes = [], lids = [], nicts = [];
    for (let s = 0; s < 2; s++) {
      const E = rig.eyes[s];
      const M = E.eye.matrixWorld;
      const mirrored = s === 1;
      const eg = eyeGeoL.clone();
      toBind(eg, M, () => [[E.eye.userData.index, 1]]);
      if (mirrored) flipWinding(eg);
      eyes.push(eg);
      // lids: spherical patches around the eye; aperture radius 42° around the gaze
      const lid = (upper, radius) => {
        const ap = (upper ? 31 : 43) * Math.PI / 180;
        const pos = [], idx = [], col = [];
        const NB = 28, NA = 14;
        for (let bi = 0; bi <= NB; bi++) {
          const beta = (-1 + 2 * bi / NB) * 1.35; // ±77°
          const cbeta = Math.cos(beta);
          const aEdge = Math.abs(beta) < ap * 0.999 ? Math.acos(Math.min(1, Math.cos(ap) / cbeta)) : 0;
          for (let ai = 0; ai <= NA; ai++) {
            const f = ai / NA;
            const al = lerp(aEdge, 2.4, f ** 1.2) * (upper ? 1 : -1);
            // rim thickening: lid edge rolls outward slightly
            const rr = radius + 0.0009 * (1 - ss(0, 0.2, f)) + 0.0012 * ss(0.1, 1, f);
            pos.push(rr * Math.sin(beta) * Math.cos(al), rr * Math.sin(al), rr * Math.cos(beta) * Math.cos(al));
            const rim = 1 - ss(0.0, 0.06, f);
            const c = new THREE.Color(0xd8d4ca).lerp(new THREE.Color(0x8a7c56), rim * 0.8);
            col.push(c.r, c.g, c.b);
          }
        }
        for (let bi = 0; bi < NB; bi++) for (let ai = 0; ai < NA; ai++) {
          const a = bi * (NA + 1) + ai, b = a + 1, c = a + NA + 1, d = c + 1;
          if (upper) idx.push(a, b, c, b, d, c); else idx.push(a, c, b, b, c, d);
        }
        return finishGeo(pos, idx, { color: [col, 3] });
      };
      const up = lid(true, R + 0.0010), lo = lid(false, R + 0.0014);
      toBind(up, M, () => [[E.up.userData.index, 1]]);
      toBind(lo, M, () => [[E.lo.userData.index, 1]]);
      if (mirrored) { flipWinding(up); flipWinding(lo); }
      lids.push(up, lo);
      // nictitating membrane: rests in the anterior corner (−X in eye space), sweeps across the cornea
      const ng = (() => {
        const pos = [], idx = [];
        const NB = 16, NA = 16, rr = R + 0.0005;
        for (let bi = 0; bi <= NB; bi++) {
          const beta = lerp(-2.7, -0.80, bi / NB);
          for (let ai = 0; ai <= NA; ai++) {
            const al = lerp(-1.25, 1.25, ai / NA);
            pos.push(rr * Math.sin(beta) * Math.cos(al), rr * Math.sin(al), rr * Math.cos(beta) * Math.cos(al));
          }
        }
        for (let bi = 0; bi < NB; bi++) for (let ai = 0; ai < NA; ai++) {
          const a = bi * (NA + 1) + ai, b = a + 1, c = a + NA + 1, d = c + 1;
          idx.push(a, c, b, b, c, d);
        }
        return finishGeo(pos, idx);
      })();
      toBind(ng, M, () => [[E.ni.userData.index, 1]]);
      if (mirrored) flipWinding(ng);
      nicts.push(ng);
    }
    out.eyes = mergeGeos(eyes);
    out.lids = mergeGeos(lids);
    out.nict = mergeGeos(nicts);
  }
  return out;
}

export function flipWinding(g) {
  const idx = g.index.array;
  for (let i = 0; i < idx.length; i += 3) { const t = idx[i + 1]; idx[i + 1] = idx[i + 2]; idx[i + 2] = t; }
  g.index.needsUpdate = true;
}

export function mergeGeos(list) {
  const out = new THREE.BufferGeometry();
  const names = Object.keys(list[0].attributes);
  let total = 0; for (const g of list) total += g.attributes.position.count;
  for (const n of names) {
    const a0 = list[0].attributes[n];
    const Arr = a0.array.constructor;
    const arr = new Arr(total * a0.itemSize);
    let o = 0;
    for (const g of list) { arr.set(g.attributes[n].array, o); o += g.attributes[n].array.length; }
    out.setAttribute(n, new THREE.BufferAttribute(arr, a0.itemSize, a0.normalized));
  }
  const idx = []; let base = 0;
  for (const g of list) { const ia = g.index.array; for (let i = 0; i < ia.length; i++) idx.push(ia[i] + base); base += g.attributes.position.count; }
  out.setIndex(idx);
  return out;
}
