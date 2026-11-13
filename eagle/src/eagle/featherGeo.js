import * as THREE from 'three';

// Feather-local frame: +Z along the rachis (base → tip), +Y dorsal (upper surface), −X outer vane, +X inner vane.
// A vane point is described by s ∈ [−1, 1] (−1 outer edge, 0 rachis, +1 inner edge) and t ∈ [0, 1].

const ss = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

// Rounded tip: fraction of half-width remaining at t for a tip region of length `tl` (as t-fraction)
const tip = (t, tl, sharp = 0.5) => {
  if (t <= 1 - tl) return 1;
  const q = (t - (1 - tl)) / tl; // 0..1
  return Math.pow(Math.max(0, 1 - q ** (2 - sharp)), 0.5 + sharp * 0.3);
};

export const PROFILE = {
  primary: (P) => {
    const tl = P.notch > 0 ? 0.09 : 0.14;
    const outerFrac = P.outerFrac ?? 0.34;
    return {
      inner: (t) => ss(0.0, 0.07, t) * (0.72 + 0.28 * ss(0.0, 0.4, t)) * (P.notch > 0 ? 1 - 0.42 * ss(1 - P.notch - 0.035, 1 - P.notch + 0.02, t) : 1) * tip(t, tl, 0.3) * (1 - outerFrac),
      outer: (t) => ss(0.0, 0.05, t) * (P.emarg > 0 ? 1 - 0.40 * ss(1 - P.emarg - 0.04, 1 - P.emarg + 0.02, t) : 1) * tip(t, tl * 1.2, 0.35) * outerFrac,
    };
  },
  secondary: () => ({
    inner: (t) => ss(0.0, 0.07, t) * (0.8 + 0.2 * ss(0, 0.35, t)) * tip(t, 0.12, 0.1) * 0.56,
    outer: (t) => ss(0.0, 0.05, t) * tip(t, 0.1, 0.1) * 0.44,
  }),
  rectrix: (asym) => ({ // asym 0 central (symmetric) … 1 outermost
    inner: (t) => ss(0.0, 0.08, t) * (0.85 + 0.15 * ss(0, 0.5, t)) * tip(t, 0.16, 0.05) * (0.5 + 0.14 * asym),
    outer: (t) => ss(0.0, 0.06, t) * tip(t, 0.18, 0.05) * (0.5 - 0.14 * asym),
  }),
  covert: (asym = 0) => ({
    inner: (t) => ss(0.0, 0.14, t) * tip(t, 0.34, 0.05) * (0.5 + 0.1 * asym),
    outer: (t) => ss(0.0, 0.12, t) * tip(t, 0.36, 0.05) * (0.5 - 0.1 * asym),
  }),
  tertial: () => ({
    inner: (t) => ss(0.0, 0.08, t) * tip(t, 0.2, 0.05) * 0.54,
    outer: (t) => ss(0.0, 0.06, t) * tip(t, 0.22, 0.05) * 0.46,
  }),
};

/**
 * Build a pennaceous feather as an indexed grid in feather-local space.
 * opts: { len, width (full max vane width), profile {inner(t), outer(t)}, nt, nx, t0 (vane start),
 *         curveX (in-plane curvature toward inner vane, fraction of len at the tip),
 *         curveY (dorsal bow: + tip up), camber (vane edges droop, fraction of width), twist (rad, along length) }
 * returns { pos: Float32Array, uv, t: per-vertex along coordinate, s: per-vertex across, index: array }
 */
export function buildVane(opts) {
  const { len, width, profile, nt = 24, nx = 3, t0 = 0.0, curveX = 0, curveY = 0, camber = 0.08, twist = 0, quill = 0.1 } = opts;
  const cols = nx * 2 + 1;
  const rows = nt + 1;
  const pos = new Float32Array(rows * cols * 3);
  const uv = new Float32Array(rows * cols * 2);
  const tt = new Float32Array(rows * cols);
  const sArr = new Float32Array(rows * cols);
  let k = 0;
  for (let j = 0; j < rows; j++) {
    // concentrate rows near the tip (notches, rounded tip) and near the base
    const a = j / nt;
    const t = t0 + (1 - t0) * (a < 0.5 ? a : a); // uniform (tip detail handled by nt)
    const z = t * len;
    const xr = curveX * len * t * t;
    const yr = curveY * len * t * t;
    const wi = Math.max(profile.inner(t) * width, 0.0006);
    const wo = Math.max(profile.outer(t) * width, 0.0006);
    const tw = twist * t;
    const ct = Math.cos(tw), st = Math.sin(tw);
    for (let c = 0; c < cols; c++) {
      const s = (c - nx) / nx; // −1..1
      let x = s < 0 ? s * wo : s * wi;
      // vanes curve down away from the rachis (ventral concavity)
      let y = -camber * width * s * s * (0.4 + 0.6 * ss(0, 0.3, t));
      // quill region: vane is absent → collapse to rachis width
      if (t < quill) { const q = t / quill; x *= q * q; }
      const X = xr + x * ct - y * st;
      const Y = yr + x * st + y * ct;
      pos[k * 3] = X; pos[k * 3 + 1] = Y; pos[k * 3 + 2] = z;
      uv[k * 2] = 0.5 + s * 0.5; uv[k * 2 + 1] = t;
      tt[k] = t; sArr[k] = s;
      k++;
    }
  }
  const index = [];
  for (let j = 0; j < nt; j++) for (let c = 0; c < cols - 1; c++) {
    const a = j * cols + c, b = a + 1, d = a + cols, e = d + 1;
    index.push(a, d, b, b, d, e);
  }
  return { pos, uv, t: tt, s: sArr, index, count: rows * cols };
}

// Curved card for body contour feathers (rounded outline comes from the alpha texture).
export function buildContourCard({ len, width, lift = 0.18, droop = 0.35, nt = 4, nx = 2, drape = null }) {
  const cols = nx * 2 + 1, rows = nt + 1;
  const pos = new Float32Array(rows * cols * 3), uv = new Float32Array(rows * cols * 2);
  const tt = new Float32Array(rows * cols), sArr = new Float32Array(rows * cols);
  let k = 0;
  for (let j = 0; j < rows; j++) {
    const t = j / nt;
    for (let c = 0; c < cols; c++) {
      const s = (c - nx) / nx;
      const x = s * width * 0.5;
      // rises from the skin at `lift`, then curves back toward the body (feathers lie on the body)
      const y = len * (lift * t - droop * lift * t * t) - Math.abs(s) ** 2 * width * 0.12 + (drape ? drape(t) : 0);
      pos[k * 3] = x; pos[k * 3 + 1] = y; pos[k * 3 + 2] = t * len;
      uv[k * 2] = 0.5 + s * 0.5; uv[k * 2 + 1] = t; tt[k] = t; sArr[k] = s;
      k++;
    }
  }
  const index = [];
  for (let j = 0; j < nt; j++) for (let c = 0; c < cols - 1; c++) {
    const a = j * cols + c, b = a + 1, d = a + cols, e = d + 1;
    index.push(a, d, b, b, d, e);
  }
  return { pos, uv, t: tt, s: sArr, index, count: rows * cols };
}

// ------------------------------------------------------------------------------------------------
// Accumulates skinned geometry. Each vertex carries up to 4 bone influences.
export class SkinBuilder {
  constructor() {
    this.pos = []; this.nrm = []; this.uv = []; this.col = []; this.si = []; this.sw = []; this.idx = [];
    this.aT = []; this.aRand = []; this.aKind = [];
    this.n = 0;
  }
  /**
   * Add a feather grid transformed into bind space.
   *  geo       : from buildVane / buildContourCard (feather-local)
   *  matrix    : Matrix4 feather-local → bind (world) space
   *  bones     : function (t, s) → [[boneIndex, weight], ...]  (≤4)
   *  color     : THREE.Color or function (t, s) → Color
   *  mirrored  : true if matrix has negative determinant (flip winding)
   */
  addGrid(geo, matrix, bones, color, { mirrored = false, rand = Math.random(), kind = 0 } = {}) {
    const base = this.n;
    const v = new THREE.Vector3();
    const nm = new THREE.Matrix3().getNormalMatrix(matrix);
    // compute local normals from the grid
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(geo.pos, 3));
    g.setIndex(geo.index);
    g.computeVertexNormals();
    const ln = g.attributes.normal.array;
    const n = new THREE.Vector3();
    const cc = new THREE.Color();
    for (let i = 0; i < geo.count; i++) {
      v.set(geo.pos[i * 3], geo.pos[i * 3 + 1], geo.pos[i * 3 + 2]).applyMatrix4(matrix);
      this.pos.push(v.x, v.y, v.z);
      n.set(ln[i * 3], ln[i * 3 + 1], ln[i * 3 + 2]).applyMatrix3(nm).normalize();
      this.nrm.push(n.x, n.y, n.z);
      this.uv.push(geo.uv[i * 2], geo.uv[i * 2 + 1]);
      const c = typeof color === 'function' ? color(geo.t[i], geo.s[i], cc) : color;
      this.col.push(c.r, c.g, c.b);
      const bw = bones(geo.t[i], geo.s[i]);
      let tot = 0; for (const b of bw) tot += b[1];
      for (let q = 0; q < 4; q++) {
        const b = bw[q];
        this.si.push(b ? b[0] : 0); this.sw.push(b ? b[1] / tot : 0);
      }
      this.aT.push(geo.t[i]); this.aRand.push(rand); this.aKind.push(kind);
    }
    for (let i = 0; i < geo.index.length; i += 3) {
      const a = geo.index[i] + base, b = geo.index[i + 1] + base, c = geo.index[i + 2] + base;
      if (mirrored) this.idx.push(a, c, b); else this.idx.push(a, b, c);
    }
    this.n += geo.count;
    g.dispose();
  }
  build() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.nrm, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 3));
    g.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(this.si, 4));
    g.setAttribute('skinWeight', new THREE.Float32BufferAttribute(this.sw, 4));
    g.setAttribute('aT', new THREE.Float32BufferAttribute(this.aT, 1));
    g.setAttribute('aRand', new THREE.Float32BufferAttribute(this.aRand, 1));
    g.setAttribute('aKind', new THREE.Float32BufferAttribute(this.aKind, 1));
    g.setIndex(this.n > 65535 ? new THREE.Uint32BufferAttribute(this.idx, 1) : new THREE.Uint16BufferAttribute(this.idx, 1));
    g.computeBoundingSphere();
    return g;
  }
}
