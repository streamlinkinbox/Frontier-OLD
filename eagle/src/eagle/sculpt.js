import * as THREE from 'three';

// ------------------------------------------------------------------------------------------------
// Body envelope of the bald eagle as a signed distance field, sculpted in the PERCHED bind pose.
//
// The envelope is the surface the contour feathers lie on (≈ 3–6 mm under the visible plumage).
// It is a smooth union of anatomical masses, each attached to the bone that carries it:
//   trunk  : torso, breast (pectoralis + crop), belly, mantle/shoulders, vent, rump
//   neck   : a chain of round cones along the 14 cervical vertebrae (S-curve when perched)
//   head   : cranium, jowls, face, supraorbital shelves (brow), lores, chin, nape
//   tibia  : the feathered "trousers"
// Proportions are taken from measured photos of adult bald eagles (side / front / head profiles)
// scaled to culmen 5.8 cm, eye 1.5 cm exposed, head 7.2 cm across the brows.
// The same decomposition gives smooth skin weights (each mass belongs to one bone).
// ------------------------------------------------------------------------------------------------

const clamp = (x, a, b) => Math.min(b, Math.max(a, x));
const lerp = (a, b, t) => a + (b - a) * t;

// polynomial smooth min (iq)
function smin(a, b, k) {
  if (k <= 0) return Math.min(a, b);
  const h = Math.max(k - Math.abs(a - b), 0) / k;
  return Math.min(a, b) - h * h * k * 0.25;
}
function smax(a, b, k) { return -smin(-a, -b, k); }

// ellipsoid (iq's bound-corrected approximation)
function sdEllipsoid(x, y, z, rx, ry, rz) {
  const k0 = Math.hypot(x / rx, y / ry, z / rz);
  const k1 = Math.hypot(x / (rx * rx), y / (ry * ry), z / (rz * rz));
  return k1 > 1e-9 ? (k0 * (k0 - 1)) / k1 : -Math.min(rx, ry, rz);
}
// round cone between a (radius ra) and b (radius rb)
function sdRoundCone(px, py, pz, a, b, ra, rb) {
  const bx = b.x - a.x, by = b.y - a.y, bz = b.z - a.z;
  const qx = px - a.x, qy = py - a.y, qz = pz - a.z;
  const l2 = bx * bx + by * by + bz * bz;
  const t = clamp((qx * bx + qy * by + qz * bz) / l2, 0, 1);
  const dx = qx - bx * t, dy = qy - by * t, dz = qz - bz * t;
  return Math.hypot(dx, dy, dz) - lerp(ra, rb, t);
}

// A primitive: { frame: Matrix4 inverse (world → local) or null, fn(x,y,z) → d, bone, group, k }
export class Sculpt {
  constructor(rig) {
    this.rig = rig;
    rig.root.updateMatrixWorld(true);
    const inv = (b) => b.matrixWorld.clone().invert();
    this.trunkInv = inv(rig.trunk);
    this.headInv = inv(rig.head);
    this.headM = rig.head.matrixWorld.clone();
    this.trunkM = rig.trunk.matrixWorld.clone();
    const I = (b) => b.userData.index;
    this.boneIndex = { trunk: I(rig.trunk), tail: I(rig.tail), head: I(rig.head) };
    const prims = this.prims = [];
    const P = (group, bone, frame, k, fn) => prims.push({ group, bone, frame, k, fn });

    // ---------------- trunk (trunk-local: +z forward along the spine, +y dorsal, +x left)
    const T = this.trunkInv, tb = I(rig.trunk), tl = I(rig.tail);
    P('body', tb, T, 0.0, (x, y, z) => sdEllipsoid(x, y + 0.008, z + 0.02, 0.086, 0.088, 0.168));        // torso
    P('body', tb, T, 0.05, (x, y, z) => sdEllipsoid(x, y + 0.036, z - 0.056, 0.084, 0.098, 0.092));      // breast
    P('body', tb, T, 0.05, (x, y, z) => sdEllipsoid(x, y + 0.058, z + 0.088, 0.074, 0.068, 0.104));      // belly
    P('body', tb, T, 0.04, (x, y, z) => sdEllipsoid(Math.abs(x) - 0.048, y - 0.034, z - 0.058, 0.05, 0.038, 0.074)); // mantle / shoulders
    P('body', tb, T, 0.05, (x, y, z) => sdEllipsoid(x, y - 0.026, z - 0.112, 0.056, 0.05, 0.05));       // neck base / crop
    P('body', tl, T, 0.04, (x, y, z) => sdEllipsoid(x, y + 0.012, z + 0.178, 0.04, 0.028, 0.06));       // vent / undertail
    P('body', tl, T, 0.04, (x, y, z) => sdEllipsoid(x, y - 0.026, z + 0.168, 0.046, 0.022, 0.068));     // rump / uppertail coverts

    // ---------------- neck: round cones along the vertebral chain (the column runs in the dorsal
    // half of the feathered neck → the feathered tube is offset ventrally)
    const nv = rig.neck.length;
    const pts = [], up = [];
    for (let i = 0; i < nv; i++) {
      pts.push(rig.neck[i].getWorldPosition(new THREE.Vector3()));
      up.push(new THREE.Vector3(0, 1, 0).transformDirection(rig.neck[i].matrixWorld));
    }
    pts.push(rig.head.getWorldPosition(new THREE.Vector3()));
    up.push(new THREE.Vector3(0, 1, 0).transformDirection(rig.head.matrixWorld));
    const rad = (u) => lerp(0.062, 0.041, Math.pow(u, 0.7));
    const off = (u) => lerp(0.02, 0.006, u);
    this.neckPts = [];
    for (let i = 0; i < nv; i++) {
      const u0 = i / nv, u1 = (i + 1) / nv;
      const a = pts[i].clone().addScaledVector(up[i], -off(u0));
      const b = pts[i + 1].clone().addScaledVector(up[i + 1], -off(u1));
      this.neckPts.push(a);
      const ra = rad(u0), rb = rad(u1);
      P('neck', I(rig.neck[i]), null, 0.03, (x, y, z) => sdRoundCone(x, y, z, a, b, ra, rb));
    }

    // ---------------- head (head-local: origin at the occipital condyle, +z toward the bill, +y up)
    const H = this.headInv, hb = I(rig.head);
    const hs = this.headScale = new THREE.Vector3().setFromMatrixScale(rig.head.matrixWorld).x;
    const EX = 0.0222, EY = 0.0215, EZ = 0.054;
    this.eye = { x: EX - 0.0015 * 0.836, y: EY, z: EZ - 0.0015 * 0.549, r: 0.0105 };
    const rot = (y, z, a) => [y * Math.cos(a) - z * Math.sin(a), y * Math.sin(a) + z * Math.cos(a)];
    // Head loft digitised from an adult bald-eagle side profile + front view (cm, relative to the eye
    // centre, world scale; plumage surface minus ≈3.5 mm). [dz, top, bottom, half-width, widest-level]
    const HS = [
      [-10.0, 0.6, -4.2, 2.2, -1.6],
      [-8.5, 1.9, -5.2, 2.9, -1.4],
      [-7.0, 2.8, -5.6, 3.2, -1.2],
      [-5.0, 3.75, -5.1, 3.35, -1.0],
      [-3.0, 4.05, -4.6, 3.4, -0.8],
      [-1.0, 3.8, -4.05, 3.3, -0.6],
      [0.6, 3.15, -3.6, 2.95, -0.6],
      [1.8, 2.2, -3.3, 2.2, -0.7],
      [2.8, 1.25, -3.1, 1.55, -0.8],
      [3.6, 0.6, -2.9, 1.1, -0.9],
    ].map(([dz, t, b, w, yc]) => ({ z: EZ + dz / 110, top: EY + t / 110, bot: EY + b / 110, hw: w / 110, yc: EY + yc / 110 }));
    const z0 = HS[0].z, z1 = HS[HS.length - 1].z;
    P('head', hb, H, 0.0, (x, y, z) => {
      const zc = clamp(z, z0, z1);
      let i = 0; while (i < HS.length - 2 && HS[i + 1].z < zc) i++;
      const A = HS[i], B = HS[i + 1];
      let t = (zc - A.z) / (B.z - A.z); t = t * t * (3 - 2 * t);
      const top = lerp(A.top, B.top, t), bot = lerp(A.bot, B.bot, t), hw = lerp(A.hw, B.hw, t), yc = lerp(A.yc, B.yc, t);
      const dy = y - yc;
      const ry = dy > 0 ? top - yc : yc - bot;
      // egg section: the crown is narrower than the jowls
      const rx = hw * (dy > 0 ? 1 - 0.18 * Math.min(1, dy / ry) ** 2 : 1);
      const k0 = Math.hypot(x / rx, dy / ry), k1 = Math.hypot(x / (rx * rx), dy / (ry * ry));
      const d2 = k1 > 1e-9 ? k0 * (k0 - 1) / k1 : -Math.min(rx, ry);
      const dz = z - zc;
      return dz === 0 ? d2 : (d2 > 0 ? Math.hypot(d2, dz) : Math.max(d2, Math.abs(dz)));
    });
    // supraorbital shelf: a flattened lobe over each eye, tilted down toward the bill (the "glare")
    P('brow', hb, H, 0.008, (x, y, z) => {
      const [ry, rz] = rot(y - (EY + 1.12 / 110), z - (EZ + 0.25 / 110), 0.24);
      return sdEllipsoid(Math.abs(x) - 2.55 / 110, ry, rz, 1.0 / 110, 0.42 / 110, 2.3 / 110);
    });

    // ---------------- tibiae ("trousers"): long feathered tubes, knee hidden in the belly
    this.legs = [];
    for (const S of rig.sides) {
      const knee = S.tib.getWorldPosition(new THREE.Vector3());
      const ankle = S.tmt.getWorldPosition(new THREE.Vector3());
      const a = knee.clone().lerp(ankle, 0.05), b = knee.clone().lerp(ankle, 0.82);
      this.legs.push({ knee, ankle });
      P('leg', I(S.tib), null, 0.035, (x, y, z) => sdRoundCone(x, y, z, a, b, 0.036, 0.024));
    }
    this._v = new THREE.Vector3();
    this._d = new Float32Array(prims.length);
  }

  // distance + (optionally) the per-primitive distances in this._d
  sdf(x, y, z) {
    const v = this._v, prims = this.prims, d = this._d;
    let body = 1e9, head = 1e9, brow = 1e9;
    let lastFrame = null, lx = 0, ly = 0, lz = 0;
    for (let i = 0; i < prims.length; i++) {
      const p = prims[i];
      if (p.frame !== lastFrame) {
        lastFrame = p.frame;
        if (p.frame) { v.set(x, y, z).applyMatrix4(p.frame); lx = v.x; ly = v.y; lz = v.z; } else { lx = x; ly = y; lz = z; }
      }
      const di = p.frame === this.headInv ? p.fn(lx, ly, lz) * this.headScale : p.fn(lx, ly, lz);
      d[i] = di;
      if (p.group === 'head') head = smin(head, di, p.k);
      else if (p.group === 'brow') brow = Math.min(brow, di);
      else body = smin(body, di, p.k);
    }
    // brow shelf merges with the head with a tight blend (keeps the ridge crisp)
    head = smin(head, brow, 0.009);
    // eye sockets: the plumage wraps round the exposed eye
    v.set(x, y, z).applyMatrix4(this.headInv);
    const E = this.eye;
    const de = (Math.hypot(Math.abs(v.x) - E.x, v.y - E.y, v.z - E.z) - (E.r + 0.0012)) * this.headScale;
    head = smax(head, -de, 0.004);
    // head ↔ neck: generous blend (the white hood is one continuous mass)
    return smin(body, head, 0.03);
  }

  gradient(x, y, z, out, h = 0.0006) {
    const dx = this.sdf(x + h, y, z) - this.sdf(x - h, y, z);
    const dy = this.sdf(x, y + h, z) - this.sdf(x, y - h, z);
    const dz = this.sdf(x, y, z + h) - this.sdf(x, y, z - h);
    return out.set(dx, dy, dz).normalize();
  }

  // project a point onto the zero level set (Newton steps along the gradient)
  project(p, iters = 4) {
    const g = new THREE.Vector3();
    for (let k = 0; k < iters; k++) {
      const d = this.sdf(p.x, p.y, p.z);
      if (Math.abs(d) < 2e-5) break;
      this.gradient(p.x, p.y, p.z, g);
      p.addScaledVector(g, -d);
    }
    return p;
  }

  // head-local coordinates of a world point
  toHead(p, out = new THREE.Vector3()) { return out.copy(p).applyMatrix4(this.headInv); }
  toTrunk(p, out = new THREE.Vector3()) { return out.copy(p).applyMatrix4(this.trunkInv); }

  // skin weights from the decomposition: every primitive votes for its bone with a softmin of
  // its distance (τ ≈ 1.2 cm) → smooth blends exactly where the masses were blended
  weights(x, y, z, tau = 0.012) {
    this.sdf(x, y, z);
    const d = this._d, prims = this.prims;
    let dmin = 1e9;
    for (let i = 0; i < d.length; i++) dmin = Math.min(dmin, d[i]);
    const m = new Map();
    for (let i = 0; i < d.length; i++) {
      const w = Math.exp(-(d[i] - dmin) / tau);
      if (w < 1e-3) continue;
      m.set(prims[i].bone, (m.get(prims[i].bone) || 0) + w);
    }
    return topWeights(m);
  }

  // which anatomical group dominates at a point (for plumage regions)
  groupAt(x, y, z) {
    this.sdf(x, y, z);
    const d = this._d;
    let bi = 0;
    for (let i = 1; i < d.length; i++) if (d[i] < d[bi]) bi = i;
    return this.prims[bi].group;
  }
}

export function topWeights(m) {
  const arr = [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, 4);
  const tot = arr.reduce((s, e) => s + e[1], 0) || 1;
  return arr.map(([b, w]) => [b, w / tot]);
}

// ------------------------------------------------------------------------------------------------
// Surface nets mesher with a coarse pre-pass (only voxels near the surface are evaluated exactly).
// Returns { positions: Float32Array, indices: Uint32Array, grid } and keeps the sampled grid so that
// later passes (feather draping, AO) can query the field quickly by trilinear interpolation.
export function meshSDF(sdf, bmin, bmax, h) {
  const nx = Math.ceil((bmax.x - bmin.x) / h) + 1;
  const ny = Math.ceil((bmax.y - bmin.y) / h) + 1;
  const nz = Math.ceil((bmax.z - bmin.z) / h) + 1;
  const N = nx * ny * nz;
  const F = new Float32Array(N);
  const id = (i, j, k) => (k * ny + j) * nx + i;
  // coarse pass (every C-th sample)
  const C = 4;
  const cx = Math.ceil((nx - 1) / C) + 1, cy = Math.ceil((ny - 1) / C) + 1, cz = Math.ceil((nz - 1) / C) + 1;
  const G = new Float32Array(cx * cy * cz);
  for (let k = 0; k < cz; k++) for (let j = 0; j < cy; j++) for (let i = 0; i < cx; i++) {
    G[(k * cy + j) * cx + i] = sdf(bmin.x + i * C * h, bmin.y + j * C * h, bmin.z + k * C * h);
  }
  const band = C * h * 1.8;
  for (let k = 0; k < nz; k++) {
    const fk = k / C, k0 = Math.min(cz - 2, Math.floor(fk)), tk = fk - k0;
    for (let j = 0; j < ny; j++) {
      const fj = j / C, j0 = Math.min(cy - 2, Math.floor(fj)), tj = fj - j0;
      for (let i = 0; i < nx; i++) {
        const fi = i / C, i0 = Math.min(cx - 2, Math.floor(fi)), ti = fi - i0;
        const g = (a, b, c) => G[((k0 + c) * cy + (j0 + b)) * cx + (i0 + a)];
        const v = lerp(lerp(lerp(g(0, 0, 0), g(1, 0, 0), ti), lerp(g(0, 1, 0), g(1, 1, 0), ti), tj),
          lerp(lerp(g(0, 0, 1), g(1, 0, 1), ti), lerp(g(0, 1, 1), g(1, 1, 1), ti), tj), tk);
        F[id(i, j, k)] = Math.abs(v) > band ? v : sdf(bmin.x + i * h, bmin.y + j * h, bmin.z + k * h);
      }
    }
  }
  // surface nets: one vertex per sign-changing cell at the mean of the edge crossings
  const vid = new Int32Array(N).fill(-1);
  const pos = [];
  const E = [[0, 1], [2, 3], [4, 5], [6, 7], [0, 2], [1, 3], [4, 6], [5, 7], [0, 4], [1, 5], [2, 6], [3, 7]];
  const cOff = [[0, 0, 0], [1, 0, 0], [0, 1, 0], [1, 1, 0], [0, 0, 1], [1, 0, 1], [0, 1, 1], [1, 1, 1]];
  const cv = new Float32Array(8);
  for (let k = 0; k < nz - 1; k++) for (let j = 0; j < ny - 1; j++) for (let i = 0; i < nx - 1; i++) {
    let mask = 0;
    for (let c = 0; c < 8; c++) { const o = cOff[c]; cv[c] = F[id(i + o[0], j + o[1], k + o[2])]; if (cv[c] < 0) mask |= 1 << c; }
    if (mask === 0 || mask === 255) continue;
    let sx = 0, sy = 0, sz = 0, n = 0;
    for (const [a, b] of E) {
      if ((cv[a] < 0) === (cv[b] < 0)) continue;
      const t = cv[a] / (cv[a] - cv[b]);
      const oa = cOff[a], ob = cOff[b];
      sx += oa[0] + (ob[0] - oa[0]) * t; sy += oa[1] + (ob[1] - oa[1]) * t; sz += oa[2] + (ob[2] - oa[2]) * t; n++;
    }
    vid[id(i, j, k)] = pos.length / 3;
    pos.push(bmin.x + (i + sx / n) * h, bmin.y + (j + sy / n) * h, bmin.z + (k + sz / n) * h);
  }
  const idx = [];
  for (let k = 1; k < nz - 1; k++) for (let j = 1; j < ny - 1; j++) for (let i = 1; i < nx - 1; i++) {
    const a = F[id(i, j, k)] < 0;
    // edges along +x, +y, +z from (i,j,k)
    for (let ax = 0; ax < 3; ax++) {
      const i2 = i + (ax === 0), j2 = j + (ax === 1), k2 = k + (ax === 2);
      if (i2 >= nx || j2 >= ny || k2 >= nz) continue;
      const b = F[id(i2, j2, k2)] < 0;
      if (a === b) continue;
      // the 4 cells sharing this edge
      let q;
      if (ax === 0) q = [id(i, j - 1, k - 1), id(i, j, k - 1), id(i, j, k), id(i, j - 1, k)];
      else if (ax === 1) q = [id(i - 1, j, k - 1), id(i - 1, j, k), id(i, j, k), id(i, j, k - 1)];
      else q = [id(i - 1, j - 1, k), id(i, j - 1, k), id(i, j, k), id(i - 1, j, k)];
      const v = q.map((c) => vid[c]);
      if (v.some((x) => x < 0)) continue;
      if (a) idx.push(v[0], v[1], v[2], v[0], v[2], v[3]); else idx.push(v[0], v[2], v[1], v[0], v[3], v[2]);
    }
  }
  const grid = {
    nx, ny, nz, h, bmin: bmin.clone(), F,
    sample(x, y, z) {
      const fx = clamp((x - bmin.x) / h, 0, nx - 1.001), fy = clamp((y - bmin.y) / h, 0, ny - 1.001), fz = clamp((z - bmin.z) / h, 0, nz - 1.001);
      const i = Math.floor(fx), j = Math.floor(fy), k = Math.floor(fz);
      const tx = fx - i, ty = fy - j, tz = fz - k;
      const g = (a, b, c) => F[id(i + a, j + b, k + c)];
      return lerp(lerp(lerp(g(0, 0, 0), g(1, 0, 0), tx), lerp(g(0, 1, 0), g(1, 1, 0), tx), ty),
        lerp(lerp(g(0, 0, 1), g(1, 0, 1), tx), lerp(g(0, 1, 1), g(1, 1, 1), tx), ty), tz);
    },
  };
  return { positions: new Float32Array(pos), indices: new Uint32Array(idx), grid };
}

// Taubin (λ|μ) smoothing on an indexed triangle mesh — removes voxel terracing without shrinking.
export function taubin(positions, indices, iters = 6, lam = 0.5, mu = -0.53) {
  const n = positions.length / 3;
  const nb = Array.from({ length: n }, () => new Set());
  for (let t = 0; t < indices.length; t += 3) {
    const a = indices[t], b = indices[t + 1], c = indices[t + 2];
    nb[a].add(b); nb[a].add(c); nb[b].add(a); nb[b].add(c); nb[c].add(a); nb[c].add(b);
  }
  const adj = nb.map((s) => [...s]);
  const tmp = new Float32Array(positions.length);
  const pass = (f) => {
    for (let i = 0; i < n; i++) {
      const A = adj[i]; if (!A.length) { tmp[i * 3] = positions[i * 3]; tmp[i * 3 + 1] = positions[i * 3 + 1]; tmp[i * 3 + 2] = positions[i * 3 + 2]; continue; }
      let x = 0, y = 0, z = 0;
      for (const j of A) { x += positions[j * 3]; y += positions[j * 3 + 1]; z += positions[j * 3 + 2]; }
      x /= A.length; y /= A.length; z /= A.length;
      tmp[i * 3] = positions[i * 3] + f * (x - positions[i * 3]);
      tmp[i * 3 + 1] = positions[i * 3 + 1] + f * (y - positions[i * 3 + 1]);
      tmp[i * 3 + 2] = positions[i * 3 + 2] + f * (z - positions[i * 3 + 2]);
    }
    positions.set(tmp);
  };
  for (let k = 0; k < iters; k++) { pass(lam); pass(mu); }
  return adj;
}
