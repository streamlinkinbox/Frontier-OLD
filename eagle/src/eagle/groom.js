import * as THREE from 'three';
import { FTYPE, cellUV } from './featherTex.js';
import { topWeights } from './sculpt.js';

// ------------------------------------------------------------------------------------------------
// Contour plumage groom on the body envelope (perched bind pose).
//
// Feathers are planted by variable-radius Poisson-disc sampling over the envelope (spacing ≈ ¼ of the
// local feather length → every point of skin is covered by 3–4 overlapping vanes, as in real
// plumage). Each feather is a 3 × 6 card *draped* over the envelope: it is marched along the
// surface in the local tract direction and re-projected onto the field at every row, so it wraps
// the curvature of the neck, breast and crown. Its height above the skin rises monotonically from
// root to tip; that alone guarantees the shingle order (a feather rooted further up the tract is
// always above the one rooted below it wherever they overlap).
//
// Feather tracts (pterylae) and directions:
//   capital (head): from the bill back over the crown; on the face back-and-down; short bristly lores
//   cervical (neck): long lanceolate hackles pointing down the neck (the white "hood")
//   pectoral / ventral: down and back over the breast and belly
//   dorsal / scapular: back toward the tail
//   femoral (trousers): long loose feathers hanging down the tibia over the upper tarsus
//   crissal (vent / under-tail coverts): white, back under the tail
// ------------------------------------------------------------------------------------------------

const clamp = (x, a, b) => Math.min(b, Math.max(a, x));
const clamp01 = (x) => clamp(x, 0, 1);
const lerp = (a, b, t) => a + (b - a) * t;
const ss = (a, b, x) => { const t = clamp01((x - a) / (b - a)); return t * t * (3 - 2 * t); };
function rng(seed) { let s = seed >>> 0; return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296); }

const col = (hex) => new THREE.Color(hex);
export const PLUMAGE = {
  brown: col(0x3f2a1c),       // dark chocolate body plumage
  brownWarm: col(0x4d3321),
  brownFringe: col(0x7a5a3a), // worn paler feather margins
  white: col(0xf1efe9),
  whiteShade: col(0xd9d5cc),
};

export class PlumageField {
  constructor(rig, env) {
    this.rig = rig; this.env = env; this.S = env.sculpt; this.grid = env.grid;
    const S = this.S;
    // neck centre polyline from the head down to the neck base (bind pose), with arc length
    const pts = [rig.head.getWorldPosition(new THREE.Vector3()), ...[...S.neckPts].reverse()];
    this.neckLine = pts;
    this.neckArc = [0];
    for (let i = 1; i < pts.length; i++) this.neckArc.push(this.neckArc[i - 1] + pts[i].distanceTo(pts[i - 1]));
    this.neckLen = this.neckArc[this.neckArc.length - 1];
    this.groupOf = S.prims.map((p) => p.group);
    this._v = new THREE.Vector3(); this._h = new THREE.Vector3(); this._t = new THREE.Vector3();
    this.trunkX = new THREE.Vector3(1, 0, 0).transformDirection(rig.trunk.matrixWorld);
    this.trunkY = new THREE.Vector3(0, 1, 0).transformDirection(rig.trunk.matrixWorld);
    this.trunkZ = new THREE.Vector3(0, 0, 1).transformDirection(rig.trunk.matrixWorld);
    this.headZ = new THREE.Vector3(0, 0, 1).transformDirection(rig.head.matrixWorld);
    this.headY = new THREE.Vector3(0, 1, 0).transformDirection(rig.head.matrixWorld);
    this.legs = S.legs;
  }

  // soft group weights from the sculpt decomposition
  groups(p, tau = 0.012) {
    const S = this.S;
    S.sdf(p.x, p.y, p.z);
    const d = S._d;
    const m = { body: 1e9, neck: 1e9, head: 1e9, leg: 1e9 };
    for (let i = 0; i < d.length; i++) { const g = this.groupOf[i] === 'brow' ? 'head' : this.groupOf[i]; if (d[i] < m[g]) m[g] = d[i]; }
    const mn = Math.min(m.body, m.neck, m.head, m.leg);
    const w = {}; let tot = 0;
    for (const g in m) { w[g] = Math.exp(-(m[g] - mn) / tau); tot += w[g]; }
    for (const g in w) w[g] /= tot;
    return w;
  }

  // arc distance from the head along the neck of the nearest neck-line point, + tangent (pointing down the neck)
  neckCoord(p, tangentOut) {
    const L = this.neckLine;
    let best = 1e9, bs = 0, bi = 0;
    for (let i = 0; i < L.length - 1; i++) {
      const a = L[i], b = L[i + 1];
      const ab = this._t.subVectors(b, a); const l2 = ab.lengthSq();
      const t = clamp01(this._v.subVectors(p, a).dot(ab) / l2);
      const q = this._h.copy(a).addScaledVector(ab, t);
      const d = q.distanceTo(p);
      if (d < best) { best = d; bs = this.neckArc[i] + t * Math.sqrt(l2); bi = i; }
    }
    if (tangentOut) tangentOut.subVectors(L[bi + 1], L[bi]).normalize();
    return { s: bs, r: best };
  }

  // all plumage properties at a surface point
  at(p, n) {
    const g = this.groups(p);
    const tl = this._v.copy(p).applyMatrix4(this.S.trunkInv).clone();
    const hl = this.S.toHead(p, new THREE.Vector3()).divideScalar(1); // head-local (unscaled units)
    const ntan = new THREE.Vector3();
    const nc = this.neckCoord(p, ntan);
    // ventral-ness around the neck/body (front of the neck and breast)
    const ventral = clamp01(-n.dot(this.trunkY) * 0.7 + n.dot(this.trunkZ) * 0.6);
    // ---- direction (tract flow)
    const dir = new THREE.Vector3();
    const dBody = this.trunkZ.clone().multiplyScalar(-1).addScaledVector(this.trunkY, -0.45 * ventral);
    const dNeck = ntan.clone();
    const dHead = this.headZ.clone().multiplyScalar(-1).addScaledVector(this.headY, -0.35 * clamp01(Math.abs(hl.x) / 0.03));
    let dLeg = new THREE.Vector3(0, -1, 0);
    let legI = 0, legBest = 1e9;
    this.legs.forEach((L, i) => { const d = p.distanceTo(L.knee.clone().lerp(L.ankle, 0.5)); if (d < legBest) { legBest = d; legI = i; } });
    dLeg.subVectors(this.legs[legI].ankle, this.legs[legI].knee).normalize();
    dir.addScaledVector(dBody, g.body).addScaledVector(dNeck, g.neck).addScaledVector(dHead, g.head).addScaledVector(dLeg, g.leg);
    // ---- length / type
    let L, type, aspect;
    const headL = hl.z > 0.074 ? 0.0065 : lerp(0.009, 0.019, ss(0.07, -0.01, hl.z)) * (1 + 0.25 * ss(0.0, -0.02, hl.y));
    const neckL = lerp(0.032, 0.058, ss(0.0, this.neckLen, nc.s));
    const bodyL = lerp(0.052, 0.07, ss(0.0, -0.12, tl.z)) * (1 + 0.15 * ventral);
    const legL = 0.08;
    L = headL * g.head + neckL * g.neck + bodyL * g.body + legL * g.leg;
    const dom = Object.entries(g).sort((a, b) => b[1] - a[1])[0][0];
    if (dom === 'head') { type = FTYPE.head; aspect = 0.42; }
    else if (dom === 'neck') { type = FTYPE.hackle; aspect = 0.33; }
    else if (dom === 'leg') { type = FTYPE.fluff; aspect = 0.5; }
    else { type = FTYPE.contour; aspect = 0.62; }
    // vent / under-tail: white, loose
    const vent = ss(-0.12, -0.17, tl.z) * ss(0.02, -0.03, tl.y);
    const rump = ss(-0.14, -0.18, tl.z) * ss(-0.01, 0.02, tl.y);
    // ---- white hood: head + neck down to its base (lower on the throat/upper breast than on the nape)
    const sw = this.neckLen * (0.84 + 0.22 * ventral);
    const hood = g.head + (g.neck + g.body * 0.6) * ss(sw + 0.012, sw - 0.012, nc.s);
    const white = clamp01(Math.max(hood, vent, rump));
    if (vent > 0.5 && type === FTYPE.contour) type = FTYPE.fluff;
    return { g, dir, L, type, aspect, white, ventral, hl, tl, neckS: nc.s, dom, vent };
  }
}

// grid-field helpers
function gridNormal(grid, p, out) {
  const h = grid.h;
  out.set(grid.sample(p.x + h, p.y, p.z) - grid.sample(p.x - h, p.y, p.z), grid.sample(p.x, p.y + h, p.z) - grid.sample(p.x, p.y - h, p.z), grid.sample(p.x, p.y, p.z + h) - grid.sample(p.x, p.y, p.z - h));
  return out.normalize();
}
function project(S, p, n) {
  // exact field near the head (fine detail), grid elsewhere is not needed: use the exact SDF (cheap enough)
  for (let k = 0; k < 3; k++) {
    const d = S.sdf(p.x, p.y, p.z);
    S.gradient(p.x, p.y, p.z, n, 0.0008);
    p.addScaledVector(n, -d);
    if (Math.abs(d) < 3e-5) break;
  }
  return p;
}

export function groomEnvelope(rig, env, { density = 1, seed = 7 } = {}) {
  const S = env.sculpt, grid = env.grid;
  const F = new PlumageField(rig, env);
  const R = rng(seed);
  const geo = env.geometry;
  const pos = geo.attributes.position.array, idx = geo.index.array, nrmA = geo.attributes.normal.array;
  // ---- candidate points, area weighted
  const tri = idx.length / 3;
  const cum = new Float64Array(tri);
  let tot = 0;
  const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3(), ab = new THREE.Vector3(), ac = new THREE.Vector3();
  for (let t = 0; t < tri; t++) {
    a.fromArray(pos, idx[t * 3] * 3); b.fromArray(pos, idx[t * 3 + 1] * 3); c.fromArray(pos, idx[t * 3 + 2] * 3);
    tot += ab.subVectors(b, a).cross(ac.subVectors(c, a)).length() * 0.5;
    cum[t] = tot;
  }
  const NC = Math.round(220000 * density);
  const cand = [];
  for (let i = 0; i < NC; i++) {
    const r = R() * tot;
    let lo = 0, hi = tri - 1;
    while (lo < hi) { const m = (lo + hi) >> 1; if (cum[m] < r) lo = m + 1; else hi = m; }
    let u = R(), v = R(); if (u + v > 1) { u = 1 - u; v = 1 - v; }
    const i0 = idx[lo * 3], i1 = idx[lo * 3 + 1], i2 = idx[lo * 3 + 2];
    const p = new THREE.Vector3().fromArray(pos, i0 * 3).multiplyScalar(1 - u - v).addScaledVector(b.fromArray(pos, i1 * 3), u).addScaledVector(c.fromArray(pos, i2 * 3), v);
    const n = new THREE.Vector3().fromArray(nrmA, i0 * 3).multiplyScalar(1 - u - v).addScaledVector(b.fromArray(nrmA, i1 * 3), u).addScaledVector(c.fromArray(nrmA, i2 * 3), v).normalize();
    cand.push({ p, n });
  }
  // ---- variable-radius Poisson disc (spatial hash)
  const cell = 0.004;
  const hash = new Map();
  const ik = (kx, ky, kz) => ((kx + 1024) * 2048 + (ky + 1024)) * 2048 + (kz + 1024);
  const key = (x, y, z) => ik(Math.floor(x / cell), Math.floor(y / cell), Math.floor(z / cell));
  const accepted = [];
  for (const C of cand) {
    // quick spacing estimate from the field (computed lazily, full properties later)
    const props = F.at(C.p, C.n);
    const rad = props.L * (props.type === FTYPE.head ? 0.24 : 0.26) / Math.sqrt(density);
    const rc = Math.ceil(rad / cell);
    const kx = Math.floor(C.p.x / cell), ky = Math.floor(C.p.y / cell), kz = Math.floor(C.p.z / cell);
    let ok = true;
    for (let dx = -rc; dx <= rc && ok; dx++) for (let dy = -rc; dy <= rc && ok; dy++) for (let dz = -rc; dz <= rc && ok; dz++) {
      const L = hash.get(ik(kx + dx, ky + dy, kz + dz));
      if (!L) continue;
      for (const q of L) { const rr = Math.min(rad, q.rad); if (q.p.distanceToSquared(C.p) < rr * rr) { ok = false; break; } }
    }
    if (!ok) continue;
    const e = { p: C.p, n: C.n, rad, props };
    accepted.push(e);
    const k = key(C.p.x, C.p.y, C.p.z);
    if (!hash.has(k)) hash.set(k, []);
    hash.get(k).push(e);
  }

  // ---- build draped cards
  const NR = 6, NCOL = 3;
  const P = [], N = [], BN = [], UV = [], COL = [], TIP = [], SI = [], SW = [], AT = [], AR = [], AL = [], AM = [], AO = [], IDX = [];
  let vbase = 0;
  const n = new THREE.Vector3(), d = new THREE.Vector3(), sd = new THREE.Vector3(), q = new THREE.Vector3(), tmp = new THREE.Vector3();
  const rowP = [], rowN = [], rowD = [];
  for (let i = 0; i <= NR; i++) { rowP.push(new THREE.Vector3()); rowN.push(new THREE.Vector3()); rowD.push(new THREE.Vector3()); }
  const brown = PLUMAGE.brown, white = PLUMAGE.white;
  for (const e of accepted) {
    const pr = e.props;
    const rnd = R();
    const L = pr.L * (0.85 + 0.3 * R());
    const width = L * pr.aspect * (0.9 + 0.2 * R());
    const H = L * (pr.type === FTYPE.head ? 0.085 : pr.type === FTYPE.hackle ? 0.11 : pr.type === FTYPE.fluff ? 0.14 : 0.075) + 0.0006;
    // direction with a little natural scatter
    d.copy(pr.dir).addScaledVector(e.n, -pr.dir.dot(e.n)).normalize();
    const sc = (pr.type === FTYPE.fluff ? 0.35 : pr.type === FTYPE.hackle ? 0.22 : 0.14) * (R() - 0.5);
    d.applyAxisAngle(e.n, sc);
    // march along the surface
    rowP[0].copy(e.p); rowN[0].copy(e.n); rowD[0].copy(d);
    for (let j = 1; j <= NR; j++) {
      q.copy(rowP[j - 1]).addScaledVector(rowD[j - 1], L / NR);
      project(S, q, n);
      rowP[j].copy(q); rowN[j].copy(n);
      tmp.subVectors(rowP[j], rowP[j - 1]);
      tmp.addScaledVector(n, -tmp.dot(n)).normalize();
      rowD[j].copy(tmp);
    }
    rowD[0].copy(rowD[1]);
    // per-feather colour
    const wv = clamp01(pr.white + (R() - 0.5) * 0.25);
    const isWhite = wv > 0.5;
    const base = isWhite ? white.clone().multiplyScalar(0.92 + 0.08 * R()) : brown.clone().lerp(PLUMAGE.brownWarm, R() * 0.8).multiplyScalar(0.8 + 0.4 * R());
    const fringeAmt = isWhite ? 0 : (pr.dom === 'body' ? lerp(0.25, 0.55, 1 - pr.ventral) : 0.2) * (0.6 + 0.8 * R());
    const tipC = isWhite ? base.clone().multiplyScalar(1.02) : base.clone().lerp(PLUMAGE.brownFringe, fringeAmt);
    const variant = Math.floor(R() * 4);
    const uv = cellUV(pr.type, variant);
    // skin weights at the root
    const w = S.weights(e.p.x, e.p.y, e.p.z);
    // occlusion: field AO at the root
    let occ = 0;
    for (let k = 1; k <= 4; k++) {
      const dd = 0.006 * k;
      const s = grid.sample(e.p.x + e.n.x * dd, e.p.y + e.n.y * dd, e.p.z + e.n.z * dd);
      occ += Math.max(0, dd - s) / dd / k;
    }
    const ao = 1 - Math.min(0.8, occ * 0.9);
    const mask = clamp01(pr.g.head + pr.g.neck);
    const flip = R() < 0.5; // mirror half of the feathers (texture variety)
    for (let j = 0; j <= NR; j++) {
      const t = j / NR;
      const hgt = t === 0 ? -0.0006 : H * (0.1 + 0.9 * Math.pow(t, 0.85));
      const nn = rowN[j], dj = rowD[j];
      sd.crossVectors(nn, dj).normalize();
      for (let k = 0; k < NCOL; k++) {
        const s = (k / (NCOL - 1)) * 2 - 1;
        q.copy(rowP[j]).addScaledVector(sd, s * width * 0.5);
        if (s !== 0) project(S, q, n); else n.copy(nn);
        // the vane is slightly cambered (edges lower than the rachis)
        q.addScaledVector(n, hgt - Math.abs(s) * width * 0.06 * ss(0, 0.4, t));
        P.push(q.x, q.y, q.z);
        // card normal: the surface normal tilted along the feather's rise
        const cn = tmp.copy(n).addScaledVector(dj, -0.9 * H / L).normalize();
        N.push(cn.x, cn.y, cn.z);
        BN.push(n.x, n.y, n.z);
        const uu = flip ? 1 - (s * 0.5 + 0.5) : s * 0.5 + 0.5;
        UV.push(uv.u0 + uu * uv.c, uv.v0 + (1 - t) * uv.c);
        COL.push(base.r, base.g, base.b);
        TIP.push(tipC.r, tipC.g, tipC.b);
        for (let m = 0; m < 4; m++) { SI.push(w[m] ? w[m][0] : 0); SW.push(w[m] ? w[m][1] : 0); }
        AT.push(t); AR.push(rnd); AL.push(L); AM.push(mask); AO.push(ao);
      }
    }
    for (let j = 0; j < NR; j++) for (let k = 0; k < NCOL - 1; k++) {
      const i0 = vbase + j * NCOL + k, i1 = i0 + 1, i2 = i0 + NCOL, i3 = i2 + 1;
      IDX.push(i0, i1, i2, i1, i3, i2);
    }
    vbase += (NR + 1) * NCOL;
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(P, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(N, 3));
  g.setAttribute('aBaseNormal', new THREE.Float32BufferAttribute(BN, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(UV, 2));
  g.setAttribute('color', new THREE.Float32BufferAttribute(COL, 3));
  g.setAttribute('aTip', new THREE.Float32BufferAttribute(TIP, 3));
  g.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(SI, 4));
  g.setAttribute('skinWeight', new THREE.Float32BufferAttribute(SW, 4));
  g.setAttribute('aT', new THREE.Float32BufferAttribute(AT, 1));
  g.setAttribute('aRand', new THREE.Float32BufferAttribute(AR, 1));
  g.setAttribute('aLen', new THREE.Float32BufferAttribute(AL, 1));
  g.setAttribute('aMask', new THREE.Float32BufferAttribute(AM, 1));
  g.setAttribute('aAO', new THREE.Float32BufferAttribute(AO, 1));
  g.setIndex(vbase > 65535 ? new THREE.Uint32BufferAttribute(IDX, 1) : new THREE.Uint16BufferAttribute(IDX, 1));
  g.computeBoundingSphere();
  return { geometry: g, count: accepted.length, field: F };
}

// undercoat colour for the envelope itself (what shows through any gap): white in the hood/vent,
// near-black brown elsewhere
export function envelopeColors(env, field) {
  const g = env.geometry, pos = g.attributes.position.array, nrm = g.attributes.normal.array;
  const n = pos.length / 3;
  const colA = new Float32Array(n * 3);
  const p = new THREE.Vector3(), nn = new THREE.Vector3();
  const W = PLUMAGE.whiteShade, B = PLUMAGE.brown.clone().multiplyScalar(0.55);
  for (let i = 0; i < n; i++) {
    p.fromArray(pos, i * 3); nn.fromArray(nrm, i * 3);
    // cheap: only every vertex near the boundary needs the full evaluation, but this runs once
    const pr = field.at(p, nn);
    const c = B.clone().lerp(W, pr.white);
    colA[i * 3] = c.r; colA[i * 3 + 1] = c.g; colA[i * 3 + 2] = c.b;
  }
  g.setAttribute('color', new THREE.BufferAttribute(colA, 3));
}
