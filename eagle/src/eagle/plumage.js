import * as THREE from 'three';
import { buildVane, buildContourCard, PROFILE, SkinBuilder } from './featherGeo.js';
import { COLORS, BONES } from './anatomy.js';

function rng(seed) { let s = seed >>> 0; return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296); }
const ss = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

const C = (hex) => new THREE.Color(hex);

// colour of a feather at (t along, s across): base occluded (covered by overlying feathers),
// slight pale fringe at the margins (feather wear), per-feather variation
function featherColor(base, rand, { baseAO = 0.55, aoEnd = 0.35, fringe = 0.06, varAmt = 0.1, tipTint = null, tipFrom = 1 } = {}) {
  const v = 1 + (rand - 0.5) * 2 * varAmt;
  const b = base.clone().multiplyScalar(v);
  return (t, s, out) => {
    const ao = baseAO + (1 - baseAO) * ss(0.0, aoEnd, t);
    out.copy(b).multiplyScalar(ao * (1 + fringe * Math.abs(s) ** 4));
    if (tipTint && t > tipFrom) out.lerp(tipTint, ss(tipFrom, 1, t) * 0.7);
    return out;
  };
}

export function buildWingPlumage(rig, opts = {}) {
  const flight = new SkinBuilder();
  const covert = new SkinBuilder();
  const R = rng(4242);
  const m = new THREE.Matrix4();
  rig.root.updateMatrixWorld(true);
  for (let side = 0; side < 2; side++) {
    const S = rig.sides[side];
    const mirrored = side === 1;
    for (const f of S.feathers) {
      const rnd = R();
      let geo, target, color, kind = 0;
      const bi = f.base.userData.index, ti = f.tip ? f.tip.userData.index : bi;
      const bones = f.tip
        ? (t) => { const w = ss(0.3, 0.7, t); return [[bi, 1 - w], [ti, w]]; }
        : () => [[bi, 1]];
      switch (f.kind) {
        case 'primary': {
          const o = f.i / 9;
          geo = buildVane({
            len: f.len, width: f.width, profile: PROFILE.primary({ ...f.P, outerFrac: 0.37 - 0.13 * o }),
            nt: 40, nx: 3, curveX: 0.025 + 0.02 * o, curveY: -0.015, camber: 0.035, quill: 0.07,
          });
          color = featherColor(C(0x3b2c21), rnd, { baseAO: 0.6, aoEnd: 0.4, varAmt: 0.08 });
          target = flight; kind = 1;
          break;
        }
        case 'secondary':
          geo = buildVane({ len: f.len, width: f.width, profile: PROFILE.secondary(), nt: 22, nx: 3, curveX: -0.012, curveY: -0.03, camber: 0.03, quill: 0.08 });
          color = featherColor(C(0x4a3828), rnd, { baseAO: 0.62, aoEnd: 0.45, varAmt: 0.09 });
          target = flight; kind = 2;
          break;
        case 'tertial':
          geo = buildVane({ len: f.len, width: f.width, profile: PROFILE.tertial(), nt: 18, nx: 3, curveX: -0.03, curveY: -0.02, camber: 0.09, quill: 0.08 });
          color = featherColor(C(0x50392a), rnd, { baseAO: 0.62, aoEnd: 0.5, varAmt: 0.1 });
          target = flight; kind = 2;
          break;
        default: {
          if (!opts.coverts) continue;
          // coverts, alula, scapulars, axillaries
          const nt = f.len > 0.1 ? 10 : 7;
          const ventral = !!f.ventral;
          const asym = f.kind === 'alula' ? 0.6 : 0.15;
          geo = buildVane({ len: f.len, width: f.width, profile: PROFILE.covert(asym), nt, nx: 2, curveX: -0.02, curveY: ventral ? 0.04 : -0.05, camber: 0.1, quill: 0.1 });
          const base = ventral ? C(0x3a2b20) : f.kind === 'scap' ? C(0x4a3727) : f.kind === 'alula' ? C(0x33261c) : C(0x5a4330);
          color = featherColor(base, rnd, { baseAO: 0.45, aoEnd: 0.55, varAmt: 0.14, fringe: 0.25 });
          target = covert; kind = 3;
        }
      }
      m.copy(f.base.matrixWorld);
      target.addGrid(geo, m, bones, color, { mirrored, rand: rnd, kind });
    }
  }
  return { flight: flight.build(), covert: covert.build() };
}

export function buildTailPlumage(rig) {
  const flight = new SkinBuilder();
  const covert = new SkinBuilder();
  const R = rng(777);
  rig.root.updateMatrixWorld(true);
  const white = C(COLORS.white);
  for (const r of rig.rectrices) {
    const rnd = R();
    const u = r.i / 5;
    const geo = buildVane({ len: r.len, width: 0.074, profile: PROFILE.rectrix(u), nt: 26, nx: 3, curveX: 0.01 * u, curveY: -0.01, camber: 0.05 + 0.03 * u, quill: 0.08 });
    const bi = r.bone.userData.index, ti = r.tip.userData.index;
    flight.addGrid(geo, r.bone.matrixWorld, (t) => { const w = ss(0.3, 0.7, t); return [[bi, 1 - w], [ti, w]]; },
      featherColor(white, rnd, { baseAO: 0.62, aoEnd: 0.4, varAmt: 0.03, fringe: 0.0 }), { mirrored: r.side === 1, rand: rnd, kind: 4 });
  }
  // upper tail coverts (white, long, lie over the rectrix bases) and under tail coverts (white, fluffy)
  const tb = rig.tail.userData.index;
  const trunkI = rig.trunk.userData.index;
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler();
  for (let side = 0; side < 2; side++) {
    for (let i = 0; i < 7; i++) {
      for (const ventral of [false, true]) {
        const rnd = R();
        const u = i / 6;
        const len = ventral ? 0.13 - 0.03 * u : 0.14 - 0.045 * u;
        const geo = buildVane({ len, width: 0.05, profile: PROFILE.covert(0.1), nt: 8, nx: 2, curveY: ventral ? 0.05 : -0.05, camber: 0.1, quill: 0.12 });
        const x = (0.004 + u * 0.034) * (side ? -1 : 1);
        const psi = (2 + u * 13) * (side ? -1 : 1) * Math.PI / 180;
        e.set(ventral ? 0.10 : -0.08, Math.PI - psi, 0, 'YXZ');
        q.setFromEuler(e);
        const pos = new THREE.Vector3(x, ventral ? -0.018 - 0.004 * u : 0.016 - 0.004 * u, ventral ? 0.045 - 0.01 * u : 0.05 - 0.018 * u);
        m.compose(pos, q, new THREE.Vector3(1, 1, 1)).premultiply(rig.tail.matrixWorld);
        covert.addGrid(geo, m, (t) => [[tb, 1 - 0.35 * (1 - t)], [trunkI, 0.35 * (1 - t)]],
          featherColor(white, rnd, { baseAO: 0.7, aoEnd: 0.5, varAmt: 0.03, fringe: 0.0 }), { rand: rnd, kind: 5 });
      }
    }
  }
  return { flight: flight.build(), covert: covert.build() };
}

// ------------------------------------------------------------------------------------------------
// Arm-wing skin: propatagium (leading-edge membrane from shoulder to wrist), the skin over the
// forearm/hand, with an airfoil cross-section (thick rounded leading edge). Lesser and marginal
// coverts are placed on it (dorsal and ventral) and inherit its skin weights.



export const COLLAPSE = 0.62;
export function collapseAt(u, uWr) { return ss(uWr + 0.03, uWr - 0.05, u); }
// point on an airfoil row at chord fraction v (0 leading → 1 trailing), top or bottom surface
export function sampleRow(row, NAIR, v, top) {
  const H = NAIR / 2;
  const af = top ? (1 - Math.min(1, Math.max(0, v))) * H : H + Math.min(1, Math.max(0, v)) * H;
  const a0 = Math.min(NAIR - 1, Math.floor(af)), f = af - a0;
  return row[a0].P.clone().lerp(row[a0 + 1].P, f);
}

function mergeW(list) {
  const m = new Map();
  for (const [b, w] of list) if (w > 1e-4) m.set(b, (m.get(b) || 0) + w);
  const arr = [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, 4);
  const tot = arr.reduce((s, e) => s + e[1], 0) || 1;
  return arr.map(([b, w]) => [b, w / tot]);
}

export function buildWingSkin(rig, opts = {}) {
  rig.root.updateMatrixWorld(true);
  const rowsBySide = [];
  const morph = [];
  const pos = [], col = [], si = [], sw = [], idx = [];
  const coatA = [];
  const feathers = new SkinBuilder();
  const aBaseNormal = [], aLen = [], aMask = [];
  const R = rng(3131);
  const trunkI = rig.trunk.userData.index;
  const segs = [BONES.humerus, BONES.ulna, BONES.hand, BONES.digit * 0.85];
  const total = segs.reduce((a, b) => a + b, 0);
  const NSPAN = 44, NAIR = 26;
  let base = 0;
  for (let side = 0; side < 2; side++) {
    const S = rig.sides[side];
    const chain = [S.humerus, S.ulna, S.hand, S.digit];
    const I = (b) => b.userData.index;
    const wp = (b, x, y, z) => new THREE.Vector3(x, y, z).applyMatrix4(b.matrixWorld);
    const wd = (b, x, y, z) => new THREE.Vector3(x, y, z).transformDirection(b.matrixWorld);
    const shoulderFront = wp(S.humerus, 0.0, 0.004, 0.028);
    const wristFront = wp(S.hand, 0.0, 0.0, 0.020);
    const surfRows = [];
    for (let k = 0; k <= NSPAN; k++) {
      const u = k / NSPAN;
      let d = u * total, bi = 0;
      while (bi < 3 && d > segs[bi]) { d -= segs[bi]; bi++; }
      const bone = chain[bi];
      const xb = d;
      const uArm = Math.min(1, (u * total) / (segs[0] + segs[1]));
      // trailing line: at the feather bases just behind the bone
      const Tp = wp(bone, xb, 0, -0.012);
      // leading edge: straight propatagial line on the arm, close to the bones on the hand
      let Lp;
      if (bi < 2) Lp = shoulderFront.clone().lerp(wristFront, uArm).lerp(wp(bone, xb, 0.002, 0.03), 0.15);
      else Lp = wp(bone, xb, 0.0, lerp(0.02, 0.008, (d / segs[bi]) * (bi === 3 ? 1 : 0.5)));
      const up = wd(bone, 0, 1, 0);
      const chord = Tp.distanceTo(Lp);
      // Aerofoil depth (skin + covert layers): ≈ 6–7 cm at the wing root, ≈ 3.5 cm at the elbow,
      // ≈ 2 cm at the wrist, thin over the hand. uE = elbow station, uW = wrist station.
      const uE = segs[0] / total, uW = (segs[0] + segs[1]) / total;
      const thick = u < uE ? lerp(0.064, 0.036, ss(0, 1, u / uE) ** 0.8)
        : u < uW ? lerp(0.036, 0.021, (u - uE) / (uW - uE))
        : lerp(0.021, 0.008, ss(uW, 1, u));
      // weights: bone at this station (blended over the joints), propatagium blends humerus→ulna
      const wl = [];
      const jb = 0.022;
      const add = (b, w) => wl.push([I(b), w]);
      let wBone = 1;
      if (bi > 0 && d < jb) { const f = 0.5 * (1 - d / jb); add(chain[bi - 1], f); wBone -= f; }
      if (bi < 3 && d > segs[bi] - jb) { const f = 0.5 * (1 - (segs[bi] - d) / jb); add(chain[bi + 1], f); wBone -= f; }
      add(bone, wBone);
      const trailW = mergeW(wl);
      // rigid per segment: the propatagium collapses with a fold morph instead of being stretched between bones
      const leadW = trailW;
      const rootF = ss(0.1, 0.0, u) * 0.5;
      const row = [];
      for (let a = 0; a <= NAIR; a++) {
        // around the airfoil: a = 0 trailing (top) → leading edge (NAIR/2) → trailing (bottom)
        const q = a / NAIR;
        const top = q <= 0.5;
        const v = top ? 1 - q * 2 : (q - 0.5) * 2; // 1 at trailing, 0 at leading
        const P = Lp.clone().lerp(Tp, v);
        // bird-wing section: blunt rounded leading edge, maximum depth ~25 % chord behind it,
        // tapering to the covert-covered feather bases at the trailing line
        const e = v; // 0 at the leading edge → 1 at the trailing line
        const prof = Math.sqrt(Math.max(0, e)) * Math.max(0, 1 - e) ** 1.5 / 0.3248;
        const yv = (top ? 1 : -0.62) * thick * (prof * 0.92 + 0.08 * (1 - e));
        P.addScaledVector(up, yv + 0.004 * (1 - v));
        pos.push(P.x, P.y, P.z);
        const c = new THREE.Color(top ? 0x2c2018 : 0x241a14); // skin + down under the coverts: dark, never reads as bare
        col.push(c.r, c.g, c.b);
        let w = mergeW([...leadW.map(([b, ww]) => [b, ww * (1 - v)]), ...trailW.map(([b, ww]) => [b, ww * v])]);
        if (rootF > 0) w = mergeW([...w.map(([b, ww]) => [b, ww * (1 - rootF)]), [trunkI, rootF]]);
        for (let qq = 0; qq < 4; qq++) { si.push(w[qq] ? w[qq][0] : 0); sw.push(w[qq] ? w[qq][1] : 0); }
        row.push({ P, w, v, top, up: up.clone().multiplyScalar(top ? 1 : -1) });
      }
      surfRows.push({ row, Lp, Tp, u, chord, up });
    }
    const mirrored = side === 1;
    for (let k = 0; k < NSPAN; k++) for (let a = 0; a < NAIR; a++) {
      const i0 = base + k * (NAIR + 1) + a, i1 = i0 + 1, i2 = i0 + NAIR + 1, i3 = i2 + 1;
      // world-space construction: winding depends on side because span direction mirrors
      if (!mirrored) idx.push(i0, i1, i2, i1, i3, i2); else idx.push(i0, i2, i1, i1, i2, i3);
    }
    // feather-coat lattice (lesser/marginal coverts): x along the span, y from the trailing line
    // forward on each surface so the coverts point toward the trailing edge (see coat.js)
    {
      const fsW = 0.0105, H = NAIR / 2;
      let xs = 0;
      for (let k = 0; k <= NSPAN; k++) {
        const row = surfRows[k].row;
        if (k > 0) { const pr = surfRows[k - 1].row; xs += 0.5 * (row[H].P.distanceTo(pr[H].P) + row[0].P.distanceTo(pr[0].P)) / fsW; }
        const y = new Float32Array(NAIR + 1);
        for (let a = 1; a <= H; a++) y[a] = y[a - 1] + row[a].P.distanceTo(row[a - 1].P) / fsW;
        y[NAIR] = 0;
        for (let a = NAIR - 1; a > H; a--) y[a] = y[a + 1] + row[a].P.distanceTo(row[a + 1].P) / fsW;
        for (let a = 0; a <= NAIR; a++) coatA.push(a > H ? -xs - 50 : xs, y[a]);
      }
    }
    base += (NSPAN + 1) * (NAIR + 1);

    // fold corrective: the elastic propatagium and the covert-covered leading edge of the arm collapse
    // toward the bone line as the elbow folds (morph target 0, driven by the elbow fold fraction)
    {
      const uWr = (segs[0] + segs[1]) / total;
      for (let k = 0; k <= NSPAN; k++) {
        const r = surfRows[k];
        const c = collapseAt(r.u, uWr);
        r.collapse = c;
        for (let a = 0; a <= NAIR; a++) {
          const e = r.row[a];
          const v2 = e.v + c * COLLAPSE * (1 - e.v);
          const q = sampleRow(r.row, NAIR, v2, e.top);
          morph.push(q.x - e.P.x, q.y - e.P.y, q.z - e.P.z);
        }
      }
    }
    rowsBySide.push({ rows: surfRows, mirrored, NAIR });
    // (lesser + marginal coverts are groomed by wingCoat.js)
    for (const top of (opts.coverts ? [true, false] : [])) {
      for (let k = 0; k < NSPAN; k += 1) {
        const r0 = surfRows[k], r1 = surfRows[k + 1];
        const u = r0.u;
        const perRow = Math.max(4, Math.round(r0.chord / 0.009));
        for (let j = 0; j < perRow; j++) {
          const v = (j + 0.5 + (R() - 0.5) * 0.6) / perRow * (top ? 0.8 : 0.85);
          if (R() < 0.08) continue;
          const f = R();
          // interpolate the surface point on this face
          const a = top ? Math.round((1 - v) * NAIR / 2) : Math.round(NAIR / 2 + v * NAIR / 2);
          const p0 = r0.row[a], p1 = r1.row[a];
          const P = p0.P.clone().lerp(p1.P, f);
          const N = p0.up.clone().lerp(p1.up, f).normalize();
          // direction: chordwise toward the trailing edge, with a slight outboard lean
          const Tdir = r0.Tp.clone().lerp(r1.Tp, f).sub(r0.Lp.clone().lerp(r1.Lp, f)).normalize();
          const span = r1.Tp.clone().sub(r0.Tp).normalize();
          let d = Tdir.clone().addScaledVector(span, 0.25);
          d.addScaledVector(N, -d.dot(N)).normalize();
          const X = new THREE.Vector3().crossVectors(N, d).normalize();
          const m = new THREE.Matrix4().makeBasis(X, N, d).setPosition(P.clone().addScaledVector(N, -0.0015));
          const L = lerp(0.022, 0.055, ss(0.0, 0.8, v)) * lerp(1.1, 0.75, u) * (0.85 + 0.3 * R());
          const geo = buildContourCard({ len: L, width: L * 0.62, lift: 0.1, droop: 0.5, nt: 3, nx: 1 });
          const w = mergeW([...p0.w.map(([b, ww]) => [b, ww * (1 - f)]), ...p1.w.map(([b, ww]) => [b, ww * f])]);
          const c = new THREE.Color(top ? 0x5a4431 : 0x3a2b20).multiplyScalar(0.8 + 0.4 * R());
          feathers.addGrid(geo, m, () => w, (t, s, o) => o.copy(c).multiplyScalar(0.62 + 0.38 * ss(0, 0.5, t)), { rand: R(), kind: 6 });
          for (let q = 0; q < geo.count; q++) { aBaseNormal.push(N.x, N.y, N.z); aLen.push(L); aMask.push(0.15); }
        }
      }
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(si, 4));
  g.setAttribute('skinWeight', new THREE.Float32BufferAttribute(sw, 4));
  g.setIndex(idx);
  g.computeVertexNormals();
  g.morphAttributes.position = [new THREE.Float32BufferAttribute(morph, 3)];
  g.morphTargetsRelative = true;
  const nV = pos.length / 3;
  g.setAttribute('aCoat', new THREE.Float32BufferAttribute(coatA, 2));
  g.setAttribute('aWhite', new THREE.BufferAttribute(new Float32Array(nV), 1));
  g.setAttribute('aLance', new THREE.BufferAttribute(new Float32Array(nV), 1));
  g.setAttribute('aBare', new THREE.BufferAttribute(new Float32Array(nV), 1));
  const fg = feathers.build();
  fg.setAttribute('aBaseNormal', new THREE.Float32BufferAttribute(aBaseNormal, 3));
  fg.setAttribute('aLen', new THREE.Float32BufferAttribute(aLen, 1));
  fg.setAttribute('aMask', new THREE.Float32BufferAttribute(aMask, 1));
  return { skin: g, feathers: fg, sides: rowsBySide };
}
const lerp = (a, b, t) => a + (b - a) * t;
