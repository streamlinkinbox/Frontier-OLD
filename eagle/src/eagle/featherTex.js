import * as THREE from 'three';

// ------------------------------------------------------------------------------------------------
// Procedural contour-feather atlas (4 × 4 cells, 256 px each).
// Every cell is one feather drawn from its structure, not painted:
//   • vane outline per feather type (lanceolate head/hackle, ovate body contour, broad covert, loose fluff)
//   • rachis tapering from the calamus to the tip
//   • barbs leaving the rachis at ~40° toward the tip; their density gives fine striations, and each barb
//     ends at its own length → the finely notched margin of a real vane
//   • random vane splits (gaps between barbs) near the margin, as on worn feathers
//   • plumulaceous (downy) base: loose, semi-transparent wisps
// Channels: R = shade (barb striation, rachis, base), G = margin (0 inside → 1 at the vane edge),
//           B = downy base mask, A = coverage. A matching tangent-space normal map is derived from
//           the barb relief + the vane's cross curvature.
// Row layout:  row 0 head (lanceolate small) ×4,  row 1 hackle (long lanceolate) ×4,
//              row 2 contour (ovate) ×4,          row 3: covert ×2, fluff ×2
// ------------------------------------------------------------------------------------------------

export const ATLAS = { cells: 4, size: 1024 };
export const FTYPE = { head: 0, hackle: 1, contour: 2, covert: 3, fluff: 4 };
// cell index for (type, variant)
export function cellFor(type, variant) {
  if (type === FTYPE.head) return [variant % 4, 0];
  if (type === FTYPE.hackle) return [variant % 4, 1];
  if (type === FTYPE.contour) return [variant % 4, 2];
  if (type === FTYPE.covert) return [variant % 2, 3];
  return [2 + (variant % 2), 3];
}

function rng(seed) { let s = seed >>> 0; return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296); }
const clamp01 = (x) => Math.min(1, Math.max(0, x));
const ss = (a, b, x) => { const t = clamp01((x - a) / (b - a)); return t * t * (3 - 2 * t); };

// outline half-width (0..1 of the cell half-width) along t ∈ [0,1]
const OUTLINE = {
  // narrow, pointed (white head feathers)
  [FTYPE.head]: (t) => ss(0.0, 0.25, t) * 0.62 * Math.pow(Math.max(0, 1 - Math.pow(Math.max(0, (t - 0.45) / 0.55), 1.6)), 0.75) + 0.08 * ss(0, 0.2, t) * (1 - t),
  // long lanceolate hackle with a drawn-out point
  [FTYPE.hackle]: (t) => ss(0.0, 0.3, t) * 0.55 * Math.pow(Math.max(0, 1 - Math.pow(Math.max(0, (t - 0.35) / 0.65), 1.35)), 0.7),
  // ovate contour feather, rounded tip
  [FTYPE.contour]: (t) => ss(0.0, 0.32, t) * 0.92 * Math.sqrt(Math.max(0, 1 - Math.pow(Math.max(0, (t - 0.42) / 0.58), 2.2))),
  // broad covert, very rounded tip
  [FTYPE.covert]: (t) => ss(0.0, 0.22, t) * 0.96 * Math.sqrt(Math.max(0, 1 - Math.pow(Math.max(0, (t - 0.5) / 0.5), 2.6))),
  // loose fluffy feather (trousers, flanks): wide, ragged
  [FTYPE.fluff]: (t) => ss(0.0, 0.35, t) * 0.9 * Math.sqrt(Math.max(0, 1 - Math.pow(Math.max(0, (t - 0.4) / 0.6), 1.8))),
};
const PARAMS = {
  [FTYPE.head]: { barbs: 70, angle: 0.95, down: 0.32, split: 0.25, jag: 0.10, fray: 0.25 },
  [FTYPE.hackle]: { barbs: 110, angle: 1.05, down: 0.28, split: 0.35, jag: 0.12, fray: 0.3 },
  [FTYPE.contour]: { barbs: 120, angle: 0.8, down: 0.36, split: 0.18, jag: 0.06, fray: 0.12 },
  [FTYPE.covert]: { barbs: 140, angle: 0.75, down: 0.22, split: 0.12, jag: 0.035, fray: 0.06 },
  [FTYPE.fluff]: { barbs: 70, angle: 1.0, down: 0.6, split: 0.5, jag: 0.25, fray: 0.6 },
};

export function buildFeatherAtlas() {
  const N = ATLAS.size, C = N / ATLAS.cells;
  const data = new Uint8Array(N * N * 4);
  const height = new Float32Array(N * N);
  const cells = [];
  for (let t = 0; t < 4; t++) for (let v = 0; v < 4; v++) cells.push([t, v]);
  // [type, variant] per cell
  const layout = [];
  for (let v = 0; v < 4; v++) layout.push([FTYPE.head, v, v, 0]);
  for (let v = 0; v < 4; v++) layout.push([FTYPE.hackle, v, v, 1]);
  for (let v = 0; v < 4; v++) layout.push([FTYPE.contour, v, v, 2]);
  layout.push([FTYPE.covert, 0, 0, 3], [FTYPE.covert, 1, 1, 3], [FTYPE.fluff, 0, 2, 3], [FTYPE.fluff, 1, 3, 3]);
  for (const [type, variant, cx, cy] of layout) {
    const R = rng(1000 + type * 37 + variant * 101);
    const P = PARAMS[type], W = OUTLINE[type];
    const nb = Math.round(P.barbs * (0.9 + 0.2 * R()));
    // per-barb randomness: length (notched margin), splits, shade
    const NB = nb * 2 + 8;
    const jag = new Float32Array(NB), shade = new Float32Array(NB), splitL = new Uint8Array(NB), splitR = new Uint8Array(NB);
    for (let i = 0; i < NB; i++) { jag[i] = R(); shade[i] = R(); }
    for (let i = 0; i < NB; i++) {
      if (R() < P.split * 0.08) { const w = 1 + Math.floor(R() * 2); for (let k = 0; k < w; k++) splitL[(i + k) % NB] = 1; }
      if (R() < P.split * 0.08) { const w = 1 + Math.floor(R() * 2); for (let k = 0; k < w; k++) splitR[(i + k) % NB] = 1; }
    }
    const curveBias = (R() - 0.5) * 0.12; // slightly curved rachis
    for (let py = 0; py < C; py++) {
      const t = 1 - (py + 0.5) / C; // canvas top = tip (v = 1)
      for (let px = 0; px < C; px++) {
        const s0 = ((px + 0.5) / C) * 2 - 1;
        const rx = curveBias * t * t; // rachis offset
        const s = s0 - rx;
        const a = Math.abs(s);
        const side = s < 0 ? 0 : 1;
        const w = W(t);
        // barb coordinate: barbs leave the rachis toward the tip; the origin along the rachis of the
        // barb through this pixel is t − a·k
        const k = P.angle * 0.55;
        const tb = t - a * k;
        const bf = tb * nb;
        const bi = ((Math.floor(bf) % nb) + nb) % nb + side * nb;
        const bfrac = bf - Math.floor(bf);
        // margin: each barb ends at its own length
        const wEdge = w * (1 - P.jag * jag[bi] * (0.5 + 0.5 * t));
        let alpha = 0, shadeV = 0, margin = 0, downy = 0, hgt = 0;
        const rach = 0.035 * (1 - 0.8 * t) + 0.006;
        if (w > 0.002 && a < wEdge) {
          const e = a / Math.max(1e-4, wEdge); // 0 rachis → 1 margin
          margin = ss(0.55, 1.0, e);
          // vane split: barbs separate near the margin
          const split = (side ? splitR[bi] : splitL[bi]) && e > 0.35 && t > P.down;
          // barb relief: thin dark gaps between barbs; gaps open near the margin (fray)
          const gap = Math.abs(bfrac - 0.5) * 2; // 0 centre of barb → 1 gap
          const fray = P.fray * ss(0.6, 1.0, e) + (t < P.down ? 0.5 : 0);
          const open = ss(1 - 0.25 - fray * 0.5, 1.0, gap);
          alpha = split ? 0 : 1 - open * (0.35 + 0.6 * fray);
          // downy base: loose, see-through wisps
          if (t < P.down) {
            downy = 1 - ss(P.down * 0.6, P.down, t);
            const wisp = 0.5 + 0.5 * Math.sin(bf * 6.283 + Math.sin(a * 40 + t * 30) * 2.0);
            alpha *= 1 - downy * (0.7 - 0.5 * wisp);
          }
          // edge softness
          alpha *= ss(1.0, 0.86, e) * 0.6 + 0.4;
          shadeV = 0.82 + 0.18 * (1 - gap) - 0.08 * shade[bi] + 0.05 * ss(0.3, 1, t);
          hgt = (1 - gap) * 0.6 + (1 - e * e) * 0.6;
          if (a < rach) { shadeV = 0.9 + 0.1 * t; alpha = 1; hgt = 1.3; margin = 0; downy = 0; }
        } else if (a < rach && t < 0.98 && t > 0.0) {
          // calamus / rachis beyond the vane
          alpha = 1; shadeV = 0.85; hgt = 1.2;
        }
        const X = cx * C + px, Y = cy * C + py;
        const o = (Y * N + X) * 4;
        data[o] = Math.round(clamp01(shadeV) * 255);
        data[o + 1] = Math.round(margin * 255);
        data[o + 2] = Math.round(downy * 255);
        data[o + 3] = Math.round(clamp01(alpha) * 255);
        height[Y * N + X] = hgt * (alpha > 0.4 ? 1 : 0.3);
      }
    }
  }
  // normal map from the relief
  const nrm = new Uint8Array(N * N * 4);
  const H = (x, y) => height[Math.min(N - 1, Math.max(0, y)) * N + Math.min(N - 1, Math.max(0, x))];
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    const dx = (H(x + 1, y) - H(x - 1, y)) * 1.6, dy = (H(x, y + 1) - H(x, y - 1)) * 1.6;
    // cross curvature of the vane (convex dorsal surface): tilt the normal outward across the cell
    const s = ((x % C) + 0.5) / C * 2 - 1;
    let nx = -dx + s * 0.45, ny = -dy, nz = 1;
    const l = Math.hypot(nx, ny, nz); nx /= l; ny /= l; nz /= l;
    const o = (y * N + x) * 4;
    nrm[o] = Math.round((nx * 0.5 + 0.5) * 255); nrm[o + 1] = Math.round((ny * 0.5 + 0.5) * 255); nrm[o + 2] = Math.round((nz * 0.5 + 0.5) * 255); nrm[o + 3] = 255;
  }
  const mk = (arr) => {
    const t = new THREE.DataTexture(arr, N, N, THREE.RGBAFormat);
    t.flipY = false; // row 0 = canvas top
    t.generateMipmaps = true; t.minFilter = THREE.LinearMipmapLinearFilter; t.magFilter = THREE.LinearFilter;
    t.anisotropy = 8; t.colorSpace = THREE.NoColorSpace; t.needsUpdate = true;
    return t;
  };
  return { map: mk(data), normalMap: mk(nrm) };
}

// UV rect of a cell; v runs base (0) → tip (1)
export function cellUV(type, variant) {
  const [cx, cy] = cellFor(type, variant);
  const c = 1 / ATLAS.cells;
  // DataTexture with flipY=false: texture row 0 (v = 0) is data row 0 = canvas top = the tip.
  // → v_tex = cy*c + (1 − t)·c
  return { u0: cx * c, v0: cy * c, c };
}
