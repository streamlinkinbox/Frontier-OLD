import * as THREE from 'three';
import { buildContourCard, SkinBuilder } from './featherGeo.js';
import { COLORS } from './anatomy.js';
import { latticeCoords } from './coat.js';

// ------------------------------------------------------------------------------------------------
// Body = loft of superellipse sections along a centreline: vent → belly → chest → 13 neck rings → nape.
// The loft is the "skin + down" layer; it is fully hidden by ~1500 overlapping contour feathers.
//
// Trunk stations (trunk space): z, centre y, half-width, height above centre, depth below centre.
// Proportions from the feathered body of a bald eagle in flight (length ≈ 0.36 m chest→vent,
// ≈ 0.21 m across, ≈ 0.18 m deep at the keel).
const TRUNK_ST = [
  [-0.222, 0.030, 0.012, 0.008, 0.010],
  [-0.200, 0.024, 0.034, 0.020, 0.026],
  [-0.165, 0.012, 0.058, 0.038, 0.048],
  [-0.115, 0.002, 0.080, 0.054, 0.074],
  [-0.055, -0.006, 0.095, 0.064, 0.092],
  [0.005, -0.009, 0.102, 0.069, 0.102],
  [0.060, -0.007, 0.102, 0.072, 0.103],
  [0.100, 0.000, 0.095, 0.071, 0.096],
];
const SE = 2.4; // superellipse exponent (slightly boxy — "square-shouldered")

const ss = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
const lerp = (a, b, t) => a + (b - a) * t;
function rng(seed) { let s = seed >>> 0; return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296); }

function sePoint(a, hw, hT, hB, n = SE) {
  const s = Math.sin(a), c = Math.cos(a);
  const x = hw * Math.sign(s) * Math.abs(s) ** (2 / n);
  const y = (c >= 0 ? hT : hB) * Math.sign(c) * Math.abs(c) ** (2 / n);
  return [x, y];
}

function mergeWeights(list) { // list of [boneIndex, weight] (may repeat) → top-4 normalised
  const m = new Map();
  for (const [b, w] of list) if (w > 1e-4) m.set(b, (m.get(b) || 0) + w);
  const arr = [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, 4);
  const tot = arr.reduce((s, e) => s + e[1], 0) || 1;
  return arr.map(([b, w]) => [b, w / tot]);
}

export function buildBodyLoft(rig) {
  rig.root.updateMatrixWorld(true);
  const I = (b) => b.userData.index;
  const trunkI = I(rig.trunk), tailI = I(rig.tail);
  const st = [];
  for (const [z, yc, hw, hT, hB] of TRUNK_ST) {
    const tw = ss(-0.16, -0.215, z) * 0.85;
    st.push({ p: new THREE.Vector3(0, yc, z), up: new THREE.Vector3(0, 1, 0), hw, hT, hB, w: [[trunkI, 1 - tw], [tailI, tw]], neck: 0 });
  }
  const nv = rig.neck.length;
  const tmp = new THREE.Vector3();
  for (let i = 1; i < nv; i++) {
    const b = rig.neck[i];
    const u = (i - 1) / (nv - 2); // 0 at n1 → 1 at n13
    const up = new THREE.Vector3(0, 1, 0).transformDirection(b.matrixWorld);
    // the vertebral column runs in the dorsal part of the feathered neck near its base
    const ventral = lerp(0.036, 0.006, u ** 0.7);
    const p = b.getWorldPosition(new THREE.Vector3()).addScaledVector(up, -ventral);
    const r = lerp(0.066, 0.044, u ** 0.9); // feathered bald-eagle neck is nearly as wide as the head
    const w = i === 1 ? [[trunkI, 0.55], [I(b), 0.45]] : i === 2 ? [[trunkI, 0.2], [I(rig.neck[1]), 0.2], [I(b), 0.6]] : [[I(rig.neck[i - 1]), 0.25], [I(b), 0.75]];
    st.push({ p, up, hw: r * 1.02, hT: r * lerp(0.85, 0.98, u), hB: r * lerp(1.45, 1.05, u), w, neck: u });
  }
  // nape (inside the back of the skull)
  {
    const up = new THREE.Vector3(0, 1, 0).transformDirection(rig.head.matrixWorld);
    const p = new THREE.Vector3(0, 0.014, 0.016).applyMatrix4(rig.head.matrixWorld);
    st.push({ p, up, hw: 0.038, hT: 0.034, hB: 0.036, w: [[I(rig.head), 1]], neck: 1.05 });
  }

  // Resample the centreline (Catmull-Rom through station centres)
  const curve = new THREE.CatmullRomCurve3(st.map((s) => s.p), false, 'centripetal');
  const NS = st.length - 1;
  const RINGS = 96, AROUND = 56;
  const rings = [];
  for (let k = 0; k <= RINGS; k++) {
    const u = k / RINGS;
    // CatmullRomCurve3.getPoint(t) maps t uniformly over segments: t*NS = station coordinate
    const sc = u * NS;
    const i0 = Math.min(NS - 1, Math.floor(sc)), f = sc - i0;
    const A = st[i0], B = st[i0 + 1];
    const p = curve.getPoint(u);
    const T = curve.getTangent(u).normalize();
    const up = A.up.clone().lerp(B.up, f);
    up.addScaledVector(T, -up.dot(T)).normalize();
    const X = new THREE.Vector3().crossVectors(up, T).normalize(); // +X (bird's left) when T = +Z, up = +Y
    rings.push({
      p, T, up, X,
      hw: lerp(A.hw, B.hw, f), hT: lerp(A.hT, B.hT, f), hB: lerp(A.hB, B.hB, f),
      w: mergeWeights([...A.w.map(([b, w]) => [b, w * (1 - f)]), ...B.w.map(([b, w]) => [b, w * f])]),
      neck: lerp(A.neck, B.neck, f), sc,
    });
  }

  // ring vertices
  const pos = [], nrm = [], uv = [], col = [], si = [], sw = [], idx = [];
  const brown = new THREE.Color(0x2a1e15), white = new THREE.Color(COLORS.white).multiplyScalar(0.6);
  const shoulderL = new THREE.Vector3(...[0.052, 0.040, 0.112]);
  const hipL = new THREE.Vector3(0.046, 0.004, -0.03);
  const surf = []; // for feather placement: per ring per around: position/normal/weights
  for (let k = 0; k <= RINGS; k++) {
    const R = rings[k];
    const row = [];
    for (let a = 0; a <= AROUND; a++) {
      const ang = (a / AROUND) * Math.PI * 2;
      const [x, y] = sePoint(ang, R.hw, R.hT, R.hB);
      const P = R.p.clone().addScaledVector(R.X, x).addScaledVector(R.up, y);
      pos.push(P.x, P.y, P.z);
      uv.push(a / AROUND, k / RINGS);
      // colour: white hood down to the neck base (the boundary is a little lower on the throat)
      const throat = Math.max(0, -Math.cos(ang));
      const wv = ss(0.02 - 0.05 * throat, 0.12 - 0.05 * throat, R.neck);
      const vent = R.sc < 1.2 ? ss(0.2, -0.6, Math.cos(ang)) * ss(1.2, 0.3, R.sc) : 0;
      const c = brown.clone().lerp(white, Math.max(wv, vent));
      col.push(c.r, c.g, c.b);
      // extra influences: shoulder skin follows the humerus a little; flank skin near the hip follows the femur
      let w = R.w.slice();
      if (R.neck === 0) {
        for (let s = 0; s < 2; s++) {
          const sh = shoulderL.clone(); if (s) sh.x = -sh.x;
          const dS = P.distanceTo(sh);
          const fS = ss(0.075, 0.02, dS) * 0.45;
          if (fS > 0) { w = w.map(([b, ww]) => [b, ww * (1 - fS)]); w.push([rig.sides[s].humerus.userData.index, fS]); }
          const hp = hipL.clone(); if (s) hp.x = -hp.x;
          const dH = P.distanceTo(hp);
          const fH = ss(0.07, 0.02, dH) * (y < 0 ? 0.35 : 0.1);
          if (fH > 0) { w = w.map(([b, ww]) => [b, ww * (1 - fH)]); w.push([rig.sides[s].femur.userData.index, fH]); }
        }
      }
      w = mergeWeights(w);
      for (let q = 0; q < 4; q++) { si.push(w[q] ? w[q][0] : 0); sw.push(w[q] ? w[q][1] : 0); }
      row.push({ P, w, ang, y, x });
    }
    surf.push(row);
  }
  for (let k = 0; k < RINGS; k++) for (let a = 0; a < AROUND; a++) {
    const i0 = k * (AROUND + 1) + a, i1 = i0 + 1, i2 = i0 + AROUND + 1, i3 = i2 + 1;
    idx.push(i0, i2, i1, i1, i2, i3);
  }
  // ---- feather-coat attributes (see coat.js)
  const fsAt = (k, a) => {
    const Rg = rings[k], ang = (a / AROUND) * Math.PI * 2, c = Math.cos(ang);
    if (Rg.neck > 0) return lerp(0.0115, 0.0072, Math.min(1, Rg.neck));
    let f = 0.0165 + 0.003 * Math.max(0, c) - 0.0015 * Math.max(0, -c);
    f *= lerp(0.72, 1, ss(0.4, 1.6, Rg.sc)); // small feathers around the vent
    return f;
  };
  const coat = latticeCoords(surf.map((row) => row.map((v) => v.P)), fsAt, 0, 1);
  const aWhite = [], aLance = [], aBare = [];
  for (let k = 0; k <= RINGS; k++) {
    const Rg = rings[k];
    for (let a = 0; a <= AROUND; a++) {
      const ang = (a / AROUND) * Math.PI * 2;
      const throat = Math.max(0, -Math.cos(ang));
      // white hood reaches a little lower on the throat / upper breast than on the hind-neck
      // (station coordinate sc: 0 … 7 trunk stations vent → chest front, 8 … neck base → nape)
      const hoodB = 8.05 - 0.45 * throat ** 1.5;
      const wv = ss(hoodB - 0.45, hoodB + 0.45, Rg.sc);
      const vent = Rg.sc < 1.2 ? ss(0.2, -0.6, Math.cos(ang)) * ss(1.2, 0.3, Rg.sc) : 0;
      aWhite.push(Math.max(wv, vent));
      aLance.push(Rg.neck > 0 ? 0.85 * ss(0.0, 0.35, Rg.neck) : 0);
      aBare.push(0);
    }
  }
  // cap the vent end
  const g = new THREE.BufferGeometry();
  g.setAttribute('aCoat', new THREE.BufferAttribute(coat, 2));
  g.setAttribute('aWhite', new THREE.Float32BufferAttribute(aWhite, 1));
  g.setAttribute('aLance', new THREE.Float32BufferAttribute(aLance, 1));
  g.setAttribute('aBare', new THREE.Float32BufferAttribute(aBare, 1));
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(si, 4));
  g.setAttribute('skinWeight', new THREE.Float32BufferAttribute(sw, 4));
  g.setIndex(idx);
  g.computeVertexNormals();
  // fix the seam normals (a = 0 and a = AROUND share a position)
  const n = g.attributes.normal;
  for (let k = 0; k <= RINGS; k++) {
    const i0 = k * (AROUND + 1), i1 = i0 + AROUND;
    const nx = n.getX(i0) + n.getX(i1), ny = n.getY(i0) + n.getY(i1), nz = n.getZ(i0) + n.getZ(i1);
    const l = Math.hypot(nx, ny, nz) || 1;
    n.setXYZ(i0, nx / l, ny / l, nz / l); n.setXYZ(i1, nx / l, ny / l, nz / l);
  }
  for (let k = 0; k <= RINGS; k++) for (let a = 0; a <= AROUND; a++) {
    const i = k * (AROUND + 1) + a;
    surf[k][a].N = new THREE.Vector3(n.getX(i), n.getY(i), n.getZ(i));
  }
  return { geometry: g, rings, surf, AROUND, RINGS };
}

// ------------------------------------------------------------------------------------------------
// Contour feathers placed on the loft in rows; each card is rigidly skinned to the surface point.
export function buildContourFeathers(rig, loft, { density = 1 } = {}) {
  const { rings, surf, AROUND, RINGS } = loft;
  const B = new SkinBuilder();
  const R = rng(1337);
  const aBaseNormal = [], aLen = [], aMask = [];
  const brown = new THREE.Color(0x4d3928), brownDark = new THREE.Color(0x352619), white = new THREE.Color(COLORS.white);
  // arclength per ring
  const sArr = [0];
  for (let k = 1; k <= RINGS; k++) sArr.push(sArr[k - 1] + rings[k].p.distanceTo(rings[k - 1].p));
  const total = sArr[RINGS];
  const ringAt = (s) => { let k = 0; while (k < RINGS - 1 && sArr[k + 1] < s) k++; const f = (s - sArr[k]) / (sArr[k + 1] - sArr[k] || 1); return [k, Math.min(1, Math.max(0, f))]; };

  const featherLen = (Rg, ang) => {
    const c = Math.cos(ang), sAbs = Math.abs(Math.sin(ang));
    if (Rg.neck > 0) return lerp(0.034, 0.020, Math.min(1, Rg.neck)) * (1 + 0.1 * Math.max(0, c));
    const z = Rg.p.z;
    const back = Math.max(0, c), belly = Math.max(0, -c);
    let L = 0.068 + 0.012 * back + 0.004 * belly;
    L += 0.035 * sAbs * ss(0.3, -0.5, c) * ss(0.1, -0.05, z);      // long flank feathers
    L *= lerp(0.72, 1, ss(-0.22, -0.13, z));                        // short at the vent / tail base
    return L;
  };

  let s = 0.004, row = 0;
  const tmpC = new THREE.Color();
  while (s < total - 0.004) {
    const [k, f] = ringAt(s);
    const Rg = rings[k];
    // perimeter of this ring
    let per = 0;
    for (let a = 0; a < AROUND; a++) per += surf[k][a].P.distanceTo(surf[k][a + 1].P);
    // average feather size on this row
    const Lrow = featherLen(Rg, Math.PI / 2);
    const spacing = Lrow * 0.3 / Math.sqrt(density);
    const nAround = Math.max(8, Math.round(per / spacing));
    const off = (row % 2) * 0.5;
    for (let j = 0; j < nAround; j++) {
      let af = ((j + off + (R() - 0.5) * 0.5) / nAround) * AROUND;
      af = ((af % AROUND) + AROUND) % AROUND;
      const a0 = Math.floor(af) % AROUND, fa = af - Math.floor(af);
      const p00 = surf[k][a0], p01 = surf[k][a0 + 1], p10 = surf[k + 1][a0], p11 = surf[k + 1][a0 + 1];
      const P = p00.P.clone().lerp(p01.P, fa).lerp(p10.P.clone().lerp(p11.P, fa), f);
      const N = p00.N.clone().lerp(p01.N, fa).lerp(p10.N.clone().lerp(p11.N, fa), f).normalize();
      const ang = (af / AROUND) * Math.PI * 2;
      const L = featherLen(Rg, ang) * (0.85 + 0.3 * R());
      // direction: down the body toward the tail (−T), bent slightly ventrally on the flanks
      const T = rings[k].T.clone().lerp(rings[k + 1].T, f).normalize();
      const upv = rings[k].up;
      let d = T.clone().negate();
      const flank = Math.abs(Math.sin(ang)) * (Rg.neck > 0 ? 0.08 : 0.22);
      d.addScaledVector(upv, -flank);
      d.addScaledVector(N, -d.dot(N)).normalize();
      // random yaw about the normal (±10°)
      d.applyAxisAngle(N, (R() - 0.5) * 0.35);
      let X = new THREE.Vector3().crossVectors(N, d).normalize();
      // slight random roll about the rachis: neighbouring feathers catch the light differently
      const roll = (R() - 0.5) * 0.22;
      const Nr = N.clone().applyAxisAngle(d, roll); X.applyAxisAngle(d, roll);
      const m = new THREE.Matrix4().makeBasis(X, Nr, d).setPosition(P.clone().addScaledVector(N, -0.0025));
      const lance = Rg.neck > 0 ? 0.62 : 0.58;
      // concave regions (front of the S-curved neck, chest/neck junction): measure how far the loft
      // rises above the feather's base plane at its tip and lift the feather just enough to clear it
      // drape: the card follows the loft surface along its length (the neck and breast widen toward
      // the body, so a flat card would sink into them) with a small, feather-like lift on top
      const hs = [], ws = [];
      for (let q = 0; q <= 4; q++) {
        const tq = q / 4;
        const [kq, fq] = ringAt(Math.max(0, s - L * tq * 0.95));
        const s00 = surf[kq][a0], s01 = surf[kq][a0 + 1], s10 = surf[kq + 1][a0], s11 = surf[kq + 1][a0 + 1];
        const q0 = s00.P.clone().lerp(s01.P, fa), q1 = s10.P.clone().lerp(s11.P, fa);
        hs.push(Math.max(0, q0.lerp(q1, fq).sub(P).dot(N)));
        ws.push(mergeWeights([
          ...s00.w.map(([b, ww]) => [b, ww * (1 - fa) * (1 - fq)]), ...s01.w.map(([b, ww]) => [b, ww * fa * (1 - fq)]),
          ...s10.w.map(([b, ww]) => [b, ww * (1 - fa) * fq]), ...s11.w.map(([b, ww]) => [b, ww * fa * fq]),
        ]));
      }
      // per-vertex skin weights: each part of the feather follows the skin directly beneath it
      const wAt = (t) => { const x = t * 4, i = Math.min(3, Math.floor(x)), f2 = x - i; return mergeWeights([...ws[i].map(([b, ww]) => [b, ww * (1 - f2)]), ...ws[i + 1].map(([b, ww]) => [b, ww * f2])]); };
      const drape = (t) => { const x = t * 4, i = Math.min(3, Math.floor(x)), f2 = x - i; return (hs[i] * (1 - f2) + hs[i + 1] * f2) + 0.0035 * t; };
      const lift = (Rg.neck > 0 ? 0.06 : 0.09) * (0.9 + 0.3 * R());
      const geo = buildContourCard({ len: L, width: L * lance * (0.9 + 0.2 * R()), lift, droop: 0.62, drape });
      // weights: interpolate the four surrounding surface points
      const w = mergeWeights([
        ...p00.w.map(([b, ww]) => [b, ww * (1 - fa) * (1 - f)]), ...p01.w.map(([b, ww]) => [b, ww * fa * (1 - f)]),
        ...p10.w.map(([b, ww]) => [b, ww * (1 - fa) * f]), ...p11.w.map(([b, ww]) => [b, ww * fa * f]),
      ]);
      // colour
      const throat = Math.max(0, -Math.cos(ang));
      const wv = ss(0.03 - 0.05 * throat, 0.10 - 0.05 * throat + 0.03 * (R() - 0.5), Rg.neck + (R() - 0.5) * 0.03);
      const vent = Rg.neck > 0 ? 0 : ss(0.25, -0.55, Math.cos(ang)) * ss(-0.175, -0.205, Rg.p.z);
      const wt = Math.max(wv, vent);
      const base = brown.clone().lerp(brownDark, 0.25 + R() * 0.3).multiplyScalar(0.94 + 0.12 * R());
      const col = base.lerp(white.clone().multiplyScalar(0.84 + 0.16 * R()), wt > 0.5 ? 1 : 0);
      const rnd = R();
      B.addGrid(geo, m, (t) => wAt(t), (t, sx, out) => out.copy(col).multiplyScalar((0.42 + 0.58 * ss(0.25, 0.92, t)) * (1 - 0.12 * Math.abs(sx) * (1 - t))), { rand: rnd, kind: wt > 0.5 ? 7 : 6 });
      const mask = Rg.neck > 0 ? 1 : 0.35;
      for (let q = 0; q < geo.count; q++) { aBaseNormal.push(N.x, N.y, N.z); aLen.push(L); aMask.push(mask); }
    }
    s += spacing * 0.92;
    row++;
  }
  const g = B.build();
  g.setAttribute('aBaseNormal', new THREE.Float32BufferAttribute(aBaseNormal, 3));
  g.setAttribute('aLen', new THREE.Float32BufferAttribute(aLen, 1));
  g.setAttribute('aMask', new THREE.Float32BufferAttribute(aMask, 1));
  return g;
}
