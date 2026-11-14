import * as THREE from 'three';
import { FTYPE, cellUV } from './featherTex.js';
import { buildWingSkin, COLLAPSE } from './plumage.js';

// ------------------------------------------------------------------------------------------------
// Wing coat (built in the extended flight bind pose, skinned to the wing bones):
//   • airfoil skin of the arm wing + hand (propatagium, thick rounded leading edge)
//   • marginal + lesser coverts groomed over it in chordwise rows: tiny at the leading edge, growing
//     toward the median-covert row, all pointing to the trailing edge with a slight outboard lean
//   • median / greater secondary coverts, greater primary coverts, alula, scapulars and the underwing
//     coverts as textured feather cards on their own feather bones (they fold with the wing)
// Adult bald-eagle wing coverts: dark chocolate with warmer, paler worn margins — the tips of each
// covert row read as the fine scalloped pattern over the folded wing.
// ------------------------------------------------------------------------------------------------

const clamp01 = (x) => Math.min(1, Math.max(0, x));
const lerp = (a, b, t) => a + (b - a) * t;
const ss = (a, b, x) => { const t = clamp01((x - a) / (b - a)); return t * t * (3 - 2 * t); };
function rng(seed) { let s = seed >>> 0; return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296); }
const C = (h) => new THREE.Color(h);

// growing buffer with the plumage attribute layout (same as groom.js)
export class CardBuffer {
  constructor() {
    this.P = []; this.N = []; this.BN = []; this.UV = []; this.COL = []; this.TIP = []; this.SI = []; this.SW = [];
    this.AT = []; this.AR = []; this.AL = []; this.AM = []; this.AO = []; this.IDX = []; this.MO = []; this.n = 0; this.cards = 0;
  }
  // rows: array over t of { c: centre, x: half-width vector, n: normal, w: skin weights, h: height }
  add(rows, { uv, base, tip, rnd, len, mask = 0, ao = 1, ncol = 3 }) {
    const base0 = this.n;
    const NR = rows.length - 1;
    const p = new THREE.Vector3(), cn = new THREE.Vector3();
    for (let j = 0; j <= NR; j++) {
      const r = rows[j], t = j / NR;
      for (let k = 0; k < ncol; k++) {
        const s = (k / (ncol - 1)) * 2 - 1;
        p.copy(r.c).addScaledVector(r.x, s).addScaledVector(r.n, r.h - Math.abs(s) * r.x.length() * 0.12 * ss(0, 0.4, t));
        this.P.push(p.x, p.y, p.z);
        if (r.m) this.MO.push(r.m.x, r.m.y, r.m.z); else this.MO.push(0, 0, 0);
        cn.copy(r.n).addScaledVector(r.d, -r.slope).normalize();
        this.N.push(cn.x, cn.y, cn.z);
        this.BN.push(r.n.x, r.n.y, r.n.z);
        this.UV.push(uv.u0 + (s * 0.5 + 0.5) * uv.c, uv.v0 + (1 - t) * uv.c);
        this.COL.push(base.r, base.g, base.b);
        this.TIP.push(tip.r, tip.g, tip.b);
        const w = r.w;
        let tot = 0; for (let m = 0; m < 4; m++) tot += w[m] ? w[m][1] : 0;
        for (let m = 0; m < 4; m++) { this.SI.push(w[m] ? w[m][0] : 0); this.SW.push(w[m] ? w[m][1] / tot : 0); }
        this.AT.push(t); this.AR.push(rnd); this.AL.push(len); this.AM.push(mask); this.AO.push(ao * lerp(0.75, 1, t));
      }
    }
    for (let j = 0; j < NR; j++) for (let k = 0; k < ncol - 1; k++) {
      const i0 = base0 + j * ncol + k, i1 = i0 + 1, i2 = i0 + ncol, i3 = i2 + 1;
      this.IDX.push(i0, i1, i2, i1, i3, i2);
    }
    this.n += (NR + 1) * ncol; this.cards++;
  }
  build() {
    const g = new THREE.BufferGeometry();
    const F = (a, n) => new THREE.Float32BufferAttribute(a, n);
    g.setAttribute('position', F(this.P, 3)); g.setAttribute('normal', F(this.N, 3)); g.setAttribute('aBaseNormal', F(this.BN, 3));
    g.setAttribute('uv', F(this.UV, 2)); g.setAttribute('color', F(this.COL, 3)); g.setAttribute('aTip', F(this.TIP, 3));
    g.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(this.SI, 4)); g.setAttribute('skinWeight', F(this.SW, 4));
    g.setAttribute('aT', F(this.AT, 1)); g.setAttribute('aRand', F(this.AR, 1)); g.setAttribute('aLen', F(this.AL, 1));
    g.setAttribute('aMask', F(this.AM, 1)); g.setAttribute('aAO', F(this.AO, 1));
    g.setIndex(this.n > 65535 ? new THREE.Uint32BufferAttribute(this.IDX, 1) : new THREE.Uint16BufferAttribute(this.IDX, 1));
    if (this.MO.some((x) => x !== 0)) { g.morphAttributes.position = [F(this.MO, 3)]; g.morphTargetsRelative = true; }
    g.computeBoundingSphere();
    return g;
  }
}

function mixW(lists) {
  const m = new Map();
  for (const [w, f] of lists) for (const [b, x] of w) m.set(b, (m.get(b) || 0) + x * f);
  const arr = [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, 4);
  const tot = arr.reduce((s, e) => s + e[1], 0) || 1;
  return arr.map(([b, x]) => [b, x / tot]);
}

const PAL = {
  lesser: { base: C(0x3d2a1b), fringe: C(0x8f6c45) },
  median: { base: C(0x3a281a), fringe: C(0x7d5d3b) },
  greater: { base: C(0x35251a), fringe: C(0x6a4e33) },
  scap: { base: C(0x392719), fringe: C(0x705237) },
  alula: { base: C(0x2e2118), fringe: C(0x4a3727) },
  under: { base: C(0x2c2019), fringe: C(0x3d2d22) },
};

function featherCols(pal, R, fringeAmt) {
  const base = pal.base.clone().multiplyScalar(0.85 + 0.3 * R());
  const tip = base.clone().lerp(pal.fringe, fringeAmt * (0.55 + 0.6 * R()));
  return { base, tip };
}

export function buildWingCoat(rig) {
  rig.root.updateMatrixWorld(true);
  const skin = buildWingSkin(rig);
  const nV = skin.skin.attributes.position.count;
  // undercoat cavity term: darker toward the trailing line (feather bases) and on the underside
  const ao = new Float32Array(nV);
  for (let i = 0; i < nV; i++) ao[i] = 0.7;
  skin.skin.setAttribute('aAO', new THREE.BufferAttribute(ao, 1));
  const B = new CardBuffer();
  const R = rng(9091);

  // ---- marginal + lesser coverts on the airfoil skin
  for (const side of skin.sides) {
    const rows = side.rows, NA = side.NAIR, H = NA / 2;
    // continuous surface evaluation: k (span row, fractional), v (0 leading → 1 trailing), top/bottom
    const evalS = (kf, v, top) => {
      kf = Math.min(rows.length - 1.001, Math.max(0, kf));
      const k0 = Math.floor(kf), fk = kf - k0;
      const af = top ? (1 - clamp01(v)) * H : H + clamp01(v) * H;
      const a0 = Math.min(NA - 1, Math.floor(af)), fa = af - a0;
      const q = (k, a) => rows[k].row[a];
      const P = new THREE.Vector3(), N = new THREE.Vector3();
      const ws = [];
      for (const [k, wk] of [[k0, 1 - fk], [k0 + 1, fk]]) for (const [a, wa] of [[a0, 1 - fa], [a0 + 1, fa]]) {
        const e = q(k, a), w = wk * wa;
        P.addScaledVector(e.P, w); N.addScaledVector(e.up, w); ws.push([e.w, w]);
      }
      return { P, N: N.normalize(), w: mixW(ws), chord: lerp(rows[k0].chord, rows[k0 + 1].chord, fk), u: lerp(rows[k0].u, rows[k0 + 1].u, fk), col: lerp(rows[k0].collapse, rows[k0 + 1].collapse, fk) };
    };
    for (const top of [true, false]) {
      for (let k = 0; k < rows.length - 1; k++) {
        const r0 = rows[k];
        const perRow = Math.max(5, Math.round(r0.chord / 0.0075));
        const vmax = top ? 0.82 : 0.86;
        for (let j = 0; j < perRow; j++) {
          const kf = k + R();
          const v = (j + 0.5 + (R() - 0.5) * 0.7) / perRow * vmax;
          const S0 = evalS(kf, v, top);
          const u = S0.u;
          // marginal (leading edge) → lesser (mid) coverts
          const L = lerp(0.016, 0.05, ss(0.0, 0.75, v)) * lerp(1.12, 0.7, u) * (0.85 + 0.3 * R());
          const width = L * lerp(0.58, 0.72, v) * (0.9 + 0.2 * R());
          const lean = (0.18 + 0.1 * R()) * (top ? 1 : 1);
          const NR = 5;
          const spanStep = 0.63 / (rows.length - 1);
          const card = [];
          let prev = null;
          for (let t = 0; t <= NR; t++) {
            const tt = t / NR;
            const kt = kf + lean * tt * L / spanStep, vt = v + tt * L / S0.chord;
            const S = t === 0 ? S0 : evalS(kt, vt, top);
            // fold morph: same chordwise collapse as the skin under it
            const Sc = evalS(kt, vt + S.col * COLLAPSE * (1 - clamp01(vt)), top);
            card.push({ c: S.P, n: S.N, w: S0.w, t: tt, m: Sc.P.clone().sub(S.P) });
          }
          for (let t = 0; t <= NR; t++) {
            const e = card[t];
            const nxt = card[Math.min(NR, t + 1)], prv = card[Math.max(0, t - 1)];
            const d = nxt.c.clone().sub(prv.c); d.addScaledVector(e.n, -d.dot(e.n)).normalize();
            const x = new THREE.Vector3().crossVectors(e.n, d).normalize().multiplyScalar(width * 0.5);
            const Hh = L * 0.1;
            e.d = d; e.x = x; e.h = e.t === 0 ? -0.0004 : Hh * (0.12 + 0.88 * Math.pow(e.t, 0.85)); e.slope = 0.9 * Hh / L;
          }
          const pal = top ? PAL.lesser : PAL.under;
          const { base, tip } = featherCols(pal, R, top ? lerp(0.35, 0.85, ss(0.1, 0.7, v)) : 0.4);
          B.add(card, { uv: cellUV(FTYPE.covert, Math.floor(R() * 2)), base, tip, rnd: R(), len: L, ao: top ? 0.92 : 0.7 });
        }
      }
    }
  }

  // ---- large coverts on their own feather bones
  const tmpM = new THREE.Matrix4();
  for (let si = 0; si < 2; si++) {
    const S = rig.sides[si];
    for (const f of S.feathers) {
      if (['primary', 'secondary', 'tertial'].includes(f.kind)) continue;
      const ventral = !!f.ventral;
      const bi = f.base.userData.index;
      const w = [[bi, 1]];
      tmpM.copy(f.base.matrixWorld);
      const ny = ventral ? -1 : 1;
      const nW = new THREE.Vector3(0, ny, 0).transformDirection(tmpM);
      const dW = new THREE.Vector3(0, 0, 1).transformDirection(tmpM);
      const xW = new THREE.Vector3(1, 0, 0).transformDirection(tmpM);
      const L = f.len * (0.95 + 0.1 * R());
      const width = f.width * (0.95 + 0.1 * R());
      const NR = f.len > 0.1 ? 7 : 5;
      const lift = f.kind === 'scap' ? 0.1 : f.kind === 'alula' ? 0.06 : 0.07;
      const card = [];
      for (let t = 0; t <= NR; t++) {
        const tt = t / NR;
        const c = new THREE.Vector3().setFromMatrixPosition(tmpM).addScaledVector(dW, tt * L);
        // the feather bows away from the skin then lies down toward its tip
        const h = L * (lift * tt - 0.45 * lift * tt * tt);
        card.push({ c, n: nW, d: dW, x: xW.clone().multiplyScalar(width * 0.5), w, h, slope: lift * (1 - 0.9 * tt) });
      }
      let pal = PAL.greater, fr = 0.6, type = FTYPE.covert;
      if (f.kind === 'msc') { pal = PAL.median; fr = 0.8; }
      else if (f.kind === 'scap') { pal = PAL.scap; fr = 0.7; type = FTYPE.contour; }
      else if (f.kind === 'alula') { pal = PAL.alula; fr = 0.4; }
      else if (ventral) { pal = PAL.under; fr = 0.35; }
      const { base, tip } = featherCols(pal, R, fr);
      B.add(card, { uv: cellUV(type, Math.floor(R() * (type === FTYPE.covert ? 2 : 4))), base, tip, rnd: R(), len: L, ao: ventral ? 0.75 : 0.95 });
    }
  }
  return { skin: skin.skin, coverts: B.build(), count: B.cards };
}

// ------------------------------------------------------------------------------------------------
// Tail coverts (flight bind pose, tail bone): three overlapping rows of white upper coverts over the
// rectrix bases (longest row behind, shorter rows toward the rump) and two rows of soft, loose white
// under-tail coverts. Same feather atlas / plumage shading as the body.
export function buildTailCoverts(rig) {
  rig.root.updateMatrixWorld(true);
  const B = new CardBuffer();
  const R = rng(5150);
  const tb = rig.tail.userData.index, trunkI = rig.trunk.userData.index;
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler();
  const white = C(0xf0eee8), shade = C(0xd8d4cb);
  const rows = [
    // [ventral, count per side, length (inner→outer), z (forward offset), y, lift, x spread]
    [false, 8, [0.15, 0.105], 0.05, 0.016, 0.07, 0.04],
    [false, 7, [0.11, 0.08], 0.085, 0.022, 0.08, 0.036],
    [false, 6, [0.075, 0.06], 0.115, 0.026, 0.1, 0.03],
    [true, 7, [0.14, 0.09], 0.05, -0.018, 0.1, 0.036],
    [true, 6, [0.1, 0.07], 0.085, -0.024, 0.14, 0.03],
  ];
  for (const [ventral, n, [l0, l1], z0, y0, lift, xs] of rows) {
    for (let side = 0; side < 2; side++) for (let i = 0; i < n; i++) {
      const u = (i + 0.5 * R()) / n;
      const len = lerp(l0, l1, u) * (0.92 + 0.16 * R());
      const x = (0.003 + u * xs) * (side ? -1 : 1);
      const psi = (2 + u * 16 + (R() - 0.5) * 4) * (side ? -1 : 1) * Math.PI / 180;
      e.set(ventral ? 0.1 : -0.07, Math.PI - psi, 0, 'YXZ');
      q.setFromEuler(e);
      m.compose(new THREE.Vector3(x, y0 - 0.004 * u, z0 - 0.016 * u), q, new THREE.Vector3(1, 1, 1)).premultiply(rig.tail.matrixWorld);
      const nW = new THREE.Vector3(0, ventral ? -1 : 1, 0).transformDirection(m);
      const dW = new THREE.Vector3(0, 0, 1).transformDirection(m);
      const xW = new THREE.Vector3(1, 0, 0).transformDirection(m);
      const width = len * (ventral ? 0.55 : 0.48) * (0.9 + 0.2 * R());
      const card = [];
      const NR = 6;
      for (let t = 0; t <= NR; t++) {
        const tt = t / NR;
        const c = new THREE.Vector3().setFromMatrixPosition(m).addScaledVector(dW, tt * len);
        const h = len * (lift * tt - 0.5 * lift * tt * tt);
        const wT = 0.35 * (1 - tt);
        card.push({ c, n: nW, d: dW, x: xW.clone().multiplyScalar(width * 0.5), w: [[tb, 1 - wT], [trunkI, wT]], h, slope: lift * (1 - tt) });
      }
      const base = white.clone().multiplyScalar(0.94 + 0.06 * R());
      const tip = base.clone().lerp(shade, 0.15);
      B.add(card, { uv: cellUV(ventral ? FTYPE.fluff : FTYPE.covert, Math.floor(R() * 2)), base, tip, rnd: R(), len, ao: ventral ? 0.8 : 0.95 });
    }
  }
  return B.build();
}
