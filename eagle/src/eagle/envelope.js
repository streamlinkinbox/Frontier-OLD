import * as THREE from 'three';
import { Sculpt, meshSDF, taubin, topWeights } from './sculpt.js';

// Builds the skinned body envelope (perched bind pose): surface-nets mesh of the sculpt, smoothed,
// projected back onto the exact field, with skin weights from the anatomical decomposition and
// a per-vertex cavity term (SDF ambient occlusion) used by the plumage shading.
export function buildEnvelope(rig, { h = 0.003 } = {}) {
  const S = new Sculpt(rig);
  const f = (x, y, z) => S.sdf(x, y, z);
  // body at 3 mm, head at 1 mm (eye socket, brow shelf, lores need the detail); the two meshes are
  // split by a plane just behind the skull (the crack lies on the same surface, under the hackles)
  const hl = new THREE.Vector3();
  // bounded to the head mesh's box: an unbounded plane would also claim the breast / fore-neck
  // (the head is pitched down) and leave them out of both meshes
  const inHead = (x, y, z) => {
    S.toHead(hl.set(x, y, z), hl);
    return hl.z > -0.022 && hl.z < 0.098 && Math.abs(hl.x) < 0.063 && hl.y > -0.068 && hl.y < 0.078;
  };
  const parts = [];
  {
    const m = meshSDF(f, new THREE.Vector3(-0.14, 0.06, -0.28), new THREE.Vector3(0.14, 0.66, 0.26), h);
    parts.push({ m, keep: (x, y, z) => !inHead(x, y, z) });
    var grid = m.grid;
  }
  {
    const bmin = new THREE.Vector3(1, 1, 1), bmax = new THREE.Vector3(-1, -1, -1);
    for (const cx of [-0.065, 0.065]) for (const cy of [-0.07, 0.08]) for (const cz of [-0.04, 0.1]) {
      const w = new THREE.Vector3(cx, cy, cz).applyMatrix4(rig.head.matrixWorld);
      bmin.min(w); bmax.max(w);
    }
    const m = meshSDF(f, bmin, bmax, 0.001);
    parts.push({ m, keep: (x, y, z) => inHead(x, y, z) });
  }
  const P = [], Ix = [], adjAll = [];
  for (const { m, keep } of parts) {
    const pp = m.positions, ii = m.indices;
    taubin(pp, ii, 4);
    const remap = new Int32Array(pp.length / 3).fill(-1);
    const base = P.length / 3;
    for (let t = 0; t < ii.length; t += 3) {
      const a = ii[t], b = ii[t + 1], c = ii[t + 2];
      const cx = (pp[a * 3] + pp[b * 3] + pp[c * 3]) / 3, cy = (pp[a * 3 + 1] + pp[b * 3 + 1] + pp[c * 3 + 1]) / 3, cz = (pp[a * 3 + 2] + pp[b * 3 + 2] + pp[c * 3 + 2]) / 3;
      if (!keep(cx, cy, cz)) continue;
      for (const v of [a, b, c]) {
        if (remap[v] < 0) { remap[v] = P.length / 3; P.push(pp[v * 3], pp[v * 3 + 1], pp[v * 3 + 2]); }
        Ix.push(remap[v]);
      }
    }
    void base;
  }
  const pos = new Float32Array(P), idx = new Uint32Array(Ix);
  const adj = taubin(pos, idx, 0);
  // project onto the exact surface (removes the small Taubin offset, keeps the brow edge sharp)
  const p = new THREE.Vector3();
  for (let i = 0; i < pos.length; i += 3) {
    p.set(pos[i], pos[i + 1], pos[i + 2]);
    S.project(p, 2);
    pos[i] = p.x; pos[i + 1] = p.y; pos[i + 2] = p.z;
  }
  const m = { grid };
  const n = pos.length / 3;
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setIndex(new THREE.BufferAttribute(idx, 1));
  g.computeVertexNormals();
  const nrm = g.attributes.normal.array;

  // skin weights (+ one Laplacian pass over the weights to remove any kink)
  const W = [];
  for (let i = 0; i < n; i++) W.push(S.weights(pos[i * 3], pos[i * 3 + 1], pos[i * 3 + 2]));
  const W2 = W.map((w, i) => {
    const mm = new Map();
    for (const [b, x] of w) mm.set(b, (mm.get(b) || 0) + x * 2);
    for (const j of adj[i]) for (const [b, x] of W[j]) mm.set(b, (mm.get(b) || 0) + x / adj[i].length * 2);
    return topWeights(mm);
  });
  const si = new Uint16Array(n * 4), sw = new Float32Array(n * 4);
  for (let i = 0; i < n; i++) for (let k = 0; k < 4; k++) { const e = W2[i][k]; si[i * 4 + k] = e ? e[0] : 0; sw[i * 4 + k] = e ? e[1] : 0; }
  g.setAttribute('skinIndex', new THREE.BufferAttribute(si, 4));
  g.setAttribute('skinWeight', new THREE.BufferAttribute(sw, 4));

  // cavity / ambient occlusion from the field: compare the field along the normal with the
  // distance travelled (5 taps, 4 mm → 6 cm) — darkens the brow socket, the throat fold, the
  // neck–breast junction and the armpits under the folded wing
  const ao = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    let occ = 0, wsum = 0;
    for (let k = 1; k <= 5; k++) {
      const d = 0.004 * Math.pow(2.0, k - 1) * 0.75;
      const x = pos[i * 3] + nrm[i * 3] * d, y = pos[i * 3 + 1] + nrm[i * 3 + 1] * d, z = pos[i * 3 + 2] + nrm[i * 3 + 2] * d;
      const s = m.grid.sample(x, y, z);
      const w = 1 / k;
      occ += w * Math.max(0, d - s) / d; wsum += w;
    }
    ao[i] = 1 - Math.min(1, (occ / wsum) * 1.6);
  }
  g.setAttribute('aAO', new THREE.BufferAttribute(ao, 1));
  g.computeBoundingSphere();
  return { geometry: g, sculpt: S, grid: m.grid, adj, weights: W2 };
}
