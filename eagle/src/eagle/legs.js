import * as THREE from 'three';
import { BONES, COLORS } from './anatomy.js';
import { buildContourCard, SkinBuilder } from './featherGeo.js';
import { flipWinding, mergeGeos } from './head.js';
import { latticeCoords } from './coat.js';

const ss = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
const lerp = (a, b, t) => a + (b - a) * t;
function rng(seed) { let s = seed >>> 0; return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296); }

function mergeWeights(list) {
  const m = new Map();
  for (const [b, w] of list) if (w > 1e-4) m.set(b, (m.get(b) || 0) + w);
  const arr = [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, 4);
  const tot = arr.reduce((s, e) => s + e[1], 0) || 1;
  return arr.map(([b, w]) => [b, w / tot]);
}

// Generic tube loft in bind space: stations {p, T, N, w, h, weights, color, v}
function tube(stations, around, { capStart = true, capEnd = true, profile = null } = {}) {
  const pos = [], nrm = [], uv = [], col = [], si = [], sw = [], idx = [];
  const n = stations.length;
  for (let k = 0; k < n; k++) {
    const S = stations[k];
    const B = new THREE.Vector3().crossVectors(S.T, S.N).normalize();
    for (let a = 0; a <= around; a++) {
      const ang = (a / around) * Math.PI * 2;
      let cx = Math.cos(ang), cy = Math.sin(ang);
      let rw = S.w, rh = S.h;
      if (profile) { const r = profile(ang, S); rw *= r; rh *= r; }
      // N = "up/dorsal" of the section, B = lateral
      const P = S.p.clone().addScaledVector(B, cx * rw).addScaledVector(S.N, cy * rh + (S.off || 0));
      pos.push(P.x, P.y, P.z);
      uv.push(a / around, S.v);
      const c = typeof S.color === 'function' ? S.color(ang) : S.color;
      col.push(c.r, c.g, c.b);
      for (let q = 0; q < 4; q++) { si.push(S.weights[q] ? S.weights[q][0] : 0); sw.push(S.weights[q] ? S.weights[q][1] : 0); }
    }
  }
  for (let k = 0; k < n - 1; k++) for (let a = 0; a < around; a++) {
    const i0 = k * (around + 1) + a, i1 = i0 + 1, i2 = i0 + around + 1, i3 = i2 + 1;
    idx.push(i0, i2, i1, i1, i2, i3);
  }
  const addCap = (k, flip) => {
    const S = stations[k];
    const ci = pos.length / 3;
    pos.push(S.p.x, S.p.y, S.p.z); uv.push(0.5, S.v);
    const c = typeof S.color === 'function' ? S.color(0) : S.color; col.push(c.r, c.g, c.b);
    for (let q = 0; q < 4; q++) { si.push(S.weights[q] ? S.weights[q][0] : 0); sw.push(S.weights[q] ? S.weights[q][1] : 0); }
    for (let a = 0; a < around; a++) {
      const i0 = k * (around + 1) + a;
      if (flip) idx.push(ci, i0, i0 + 1); else idx.push(ci, i0 + 1, i0);
    }
  };
  if (capStart) addCap(0, true);
  if (capEnd) addCap(n - 1, false);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(si, 4));
  g.setAttribute('skinWeight', new THREE.Float32BufferAttribute(sw, 4));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

const worldPt = (bone, x, y, z) => new THREE.Vector3(x, y, z).applyMatrix4(bone.matrixWorld);
const worldDir = (bone, x, y, z) => new THREE.Vector3(x, y, z).transformDirection(bone.matrixWorld);

export function buildLegs(rig) {
  rig.root.updateMatrixWorld(true);
  const skin = [], talons = [], shanks = [];
  const featherB = new SkinBuilder();
  const aBaseNormal = [], aLen = [], aMask = [];
  const R = rng(55);
  const yellow = new THREE.Color(COLORS.feet), yellowDark = new THREE.Color(0xc79a22);
  const brown = new THREE.Color(0x3d2c1f);
  for (let s = 0; s < 2; s++) {
    const S = rig.sides[s];
    const mirrored = s === 1;
    const I = (b) => b.userData.index;
    // ---- "trousers": the feathered tibiotarsus. A closed coat of long, soft tibial feathers that
    // hang down over the intertarsal joint; fuller behind (the feathers droop backward) and merging
    // into the belly at the top. Rendered with the coat shader (see coat.js) + a ragged hem of cards.
    {
      const st = [];
      const N = 16, AR = 36;
      for (let k = 0; k <= N; k++) {
        const f = k / N;
        const y = lerp(0.03, -BONES.tibiotarsus * 1.06, f);
        const T = worldDir(S.tib, 0, -1, 0), Nn = worldDir(S.tib, 0, 0, 1);
        // the feather mass hangs behind the bone and its axis drifts backward toward the hem
        const p = worldPt(S.tib, 0, y, -0.006 - 0.008 * f);
        const w = mergeWeights([[I(S.femur), ss(0.3, 0, f) * 0.6], [I(S.tib), 1 - ss(0.3, 0, f) * 0.6 - ss(0.88, 1.0, f) * 0.35], [I(S.tmt), ss(0.88, 1.0, f) * 0.35]]);
        const r = lerp(0.054, 0.03, Math.pow(f, 1.1)) * (1 - 0.3 * ss(0.85, 1.0, f));
        st.push({ p, T, N: Nn, w: r * 0.95, h: r * 1.15, weights: w, color: brown, v: f });
      }
      const g = tube(st, AR, { capStart: false, capEnd: true, profile: (ang) => 1 + 0.12 * Math.max(0, -Math.sin(ang)) });
      // lattice coordinates (front = ang π/2 is the midline; feathers point down the leg)
      const pa = g.attributes.position, P = [];
      for (let k = 0; k <= N; k++) { const row = []; for (let a = 0; a <= AR; a++) row.push(new THREE.Vector3().fromBufferAttribute(pa, k * (AR + 1) + a)); P.push(row); }
      const fs = (k) => lerp(0.0125, 0.0105, k / N);
      const lc = latticeCoords(P, fs, AR / 4, -1);
      const n = pa.count;
      const coat = new Float32Array(n * 2); coat.set(lc);
      for (let i = lc.length / 2; i < n; i++) { coat[i * 2] = 0; coat[i * 2 + 1] = lc[lc.length - 1]; }
      g.setAttribute('aCoat', new THREE.BufferAttribute(coat, 2));
      g.setAttribute('aWhite', new THREE.BufferAttribute(new Float32Array(n), 1));
      g.setAttribute('aLance', new THREE.BufferAttribute(new Float32Array(n).fill(0.35), 1));
      g.setAttribute('aBare', new THREE.BufferAttribute(new Float32Array(n), 1));
      shanks.push(g);
    }
    // ---- tarsometatarsus: bare, yellow, reticulate scales; transverse scutes on the front of the lower half
    {
      const st = [];
      const N = 22;
      for (let k = 0; k <= N; k++) {
        const f = k / N;
        const y = -BONES.tarsometatarsus * lerp(-0.08, 1.02, f);
        const p = worldPt(S.tmt, 0, y, 0);
        const T = worldDir(S.tmt, 0, -1, 0), Nn = worldDir(S.tmt, 0, 0, 1);
        const joint = Math.exp(-(((f - 0.02) / 0.1) ** 2)) * 0.35 + Math.exp(-(((f - 0.98) / 0.08) ** 2)) * 0.45;
        const w = mergeWeights([[I(S.tib), ss(0.12, 0.0, f) * 0.5], [I(S.tmt), 1 - ss(0.12, 0.0, f) * 0.5 - ss(0.88, 1.02, f) * 0.5], [I(S.foot), ss(0.88, 1.02, f) * 0.5]]);
        const hw = 0.0085 * (1 + joint) * lerp(1.05, 1.0, f);
        const hd = 0.0100 * (1 + joint * 0.8);
        st.push({ p, T, N: Nn, w: hw, h: hd, weights: w, v: f * 2.2, color: yellow });
      }
      const g = tube(st, 20);
      skin.push(g);
    }
    // ---- toes: loft through the phalanx chain with plantar pads
    for (const toe of S.toes) {
      const chain = toe.chain, T = toe.def;
      const nPh = T.lens.length - 1; // last length is the claw
      const total = T.lens.slice(0, nPh).reduce((a, b) => a + b, 0);
      const st = [];
      const N = 10 * nPh;
      for (let k = 0; k <= N; k++) {
        const f = k / N;
        // locate along the chain
        let d = f * total, ph = 0;
        while (ph < nPh - 1 && d > T.lens[ph]) { d -= T.lens[ph]; ph++; }
        const bone = chain[ph];
        const p = worldPt(bone, 0, 0, d);
        const dir = worldDir(bone, 0, 0, 1), up = worldDir(bone, 0, 1, 0);
        // weights blend across the joint
        const u = d / T.lens[ph];
        const wl = [[I(bone), 1]];
        if (u < 0.2 && ph > 0) { const b = ss(0.2, 0, u) * 0.5; wl[0][1] -= b; wl.push([I(chain[ph - 1]), b]); }
        if (u > 0.8 && ph < chain.length - 1) { const b = ss(0.8, 1, u) * 0.5; wl[0][1] -= b; wl.push([I(chain[ph + 1]), b]); }
        if (ph === 0 && u < 0.25) { const b = ss(0.25, 0, u) * 0.4; wl[0][1] -= b; wl.push([I(S.foot), b]); }
        // pads: bulge under each joint
        const padAt = (x) => Math.exp(-((x / 0.18) ** 2));
        let pad = 0;
        for (let q = 0; q <= nPh; q++) pad = Math.max(pad, padAt((f * nPh - q)));
        const w0 = T.width * 0.5 * lerp(1.0, 0.7, f);
        st.push({ p, T: dir, N: up, w: w0, h: w0 * 0.95, weights: mergeWeights(wl), v: f * 3, color: yellow, pad, off: 0.0032 });
      }
      const g = tube(st, 16, {
        profile: (ang, S) => {
          // flattened top, bulbous pads underneath (with papillae via the scale texture)
          const sn = Math.sin(ang);
          return sn < 0 ? 1 + S.pad * 0.45 * (-sn) : 1 - 0.12 * sn;
        },
      });
      skin.push(g);
      // talon — curved, laterally compressed keratin cone
      {
        const cb = chain[chain.length - 1];
        const L = T.lens[T.lens.length - 1];
        const baseH = T.name === 'hallux' ? 0.0118 : T.name === 'inner' ? 0.0112 : 0.0094;
        const st2 = [];
        const NC = 16;
        const arc = 1.95; // total curvature (rad)
        const Rr = L / arc;
        for (let k = 0; k <= NC; k++) {
          const f = k / NC;
          const a = f * arc;
          // arc in the toe's y-z plane curving down
          const lz = Rr * Math.sin(a), ly = Rr * (Math.cos(a) - 1) + 0.0035;
          const p = worldPt(cb, 0, ly, lz);
          const dir = worldDir(cb, 0, -Math.sin(a), Math.cos(a));
          const up = worldDir(cb, 0, Math.cos(a), Math.sin(a));
          const h = baseH * 0.5 * Math.pow(1 - f, 0.75) + 0.0002;
          const w = h * 0.62;
          st2.push({ p, T: dir, N: up, w, h, weights: [[I(cb), 1]], v: f, color: new THREE.Color(0x121110).lerp(new THREE.Color(0x3a3834), ss(0.25, 0, f) * 0.6) });
        }
        const g2 = tube(st2, 12, { capStart: true, capEnd: false, profile: (ang) => 1 - 0.25 * Math.max(0, -Math.sin(ang)) });
        talons.push(g2);
      }
    }
    // ---- "trousers": tibial feathers (long, dark brown, hang to the upper tarsus) and the feathered top of the tarsus
    {
      const addRing = (bone, yFrom, yTo, rows, perRow, lenFn, radius, droopOut, weightsFn, mask) => {
        for (let r = 0; r < rows; r++) {
          const f = r / Math.max(1, rows - 1);
          const y = lerp(yFrom, yTo, f);
          for (let j = 0; j < perRow; j++) {
            const ang = ((j + (r % 2) * 0.5) / perRow) * Math.PI * 2 + (R() - 0.5) * 0.2;
            const nx = Math.cos(ang), nz = Math.sin(ang);
            const rad = radius(f);
            const pLocal = new THREE.Vector3(nx * rad, y, nz * rad * 1.1);
            const P = pLocal.clone().applyMatrix4(bone.matrixWorld);
            const Nw = worldDir(bone, nx, 0, nz);
            const down = worldDir(bone, 0, -1, 0);
            const d = down.clone().addScaledVector(Nw, droopOut).normalize();
            const X = new THREE.Vector3().crossVectors(Nw, d).normalize();
            const Nn = new THREE.Vector3().crossVectors(d, X).normalize();
            const m = new THREE.Matrix4().makeBasis(X, Nn, d).setPosition(P);
            const L = lenFn(f) * (0.85 + 0.3 * R());
            const geo = buildContourCard({ len: L, width: L * 0.5, lift: 0.06, droop: 0.5, nt: 4, nx: 2 });
            const c = brown.clone().multiplyScalar(0.62 + 0.2 * R());
            const w = weightsFn(f);
            featherB.addGrid(geo, m, () => w, (t, sx, o) => o.copy(c).multiplyScalar(0.8 + 0.2 * ss(0, 0.5, t)), { mirrored, rand: R(), kind: 6 });
            for (let q = 0; q < geo.count; q++) { aBaseNormal.push(Nn.x, Nn.y, Nn.z); aLen.push(L); aMask.push(mask); }
          }
        }
      };
      // tibial feathers
      // ragged hem of the trousers: the longest tibial feathers hang over the intertarsal joint
      addRing(S.tib, -BONES.tibiotarsus * 0.72, -BONES.tibiotarsus * 0.86, 2, 16, (f) => lerp(0.05, 0.045, f), (f) => lerp(0.024, 0.02, f), 0.18,
        () => [[I(S.tib), 1]], 0.4);
      // upper tarsus: short feathers cover the upper ~40 % (the lower tarsus is bare)
      addRing(S.tmt, 0.004, -BONES.tarsometatarsus * 0.4, 4, 10, (f) => lerp(0.04, 0.03, f), () => 0.010, 0.14,
        () => [[I(S.tmt), 1]], 0.2);
    }
  }
  const featherG = featherB.build();
  featherG.setAttribute('aBaseNormal', new THREE.Float32BufferAttribute(aBaseNormal, 3));
  featherG.setAttribute('aLen', new THREE.Float32BufferAttribute(aLen, 1));
  featherG.setAttribute('aMask', new THREE.Float32BufferAttribute(aMask, 1));
  return { skin: mergeGeos(skin), talons: mergeGeos(talons), shank: mergeGeos(shanks), feathers: featherG };
}
