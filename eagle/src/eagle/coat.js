import * as THREE from 'three';
import { COLORS } from './anatomy.js';

// ------------------------------------------------------------------------------------------------
// Feather coat shader.
//
// Body, neck, head and "trouser" plumage of a real eagle is a closed, overlapping coat: thousands of
// contour feathers lie flat, each one's tip covering the base of the feathers behind it, so the eye
// reads a soft, finely scalloped surface (not individual plates).  Modelling every contour feather as
// a card gives exactly the blocky, painted look we want to avoid, so the coat is rendered on the
// feathered-surface mesh itself:
//
//   aCoat  (vec2) – coordinates on a feather lattice, in units of one feather row:
//                   x = around the body, y = along the feather tract (feathers point toward −y)
//   aWhite (float) – white-plumage field (hood / tail coverts); thresholded per feather so the
//                   brown/white boundary is ragged at feather level, as in real birds
//   aLance (float) – feather shape: 0 = broad rounded body feather … 1 = lanceolate hackle (nape/neck)
//   aBare  (float) – 1 = unfeathered skin (lid margin, lores): shows the vertex colour instead
//
// For every fragment the shader finds the topmost feather (the most anterior row whose vane reaches
// the point), then shades it: per-feather tone, barbs angled away from the rachis, a lighter rachis,
// frayed edges, the contact shadow cast by the overlying feather's edge, and a height field (each
// feather is convex and lifts toward its tip) that is turned into a normal with a cotangent frame.
// Detail fades smoothly to the averaged coat colour when a feather spans less than ~2 pixels.
// ------------------------------------------------------------------------------------------------

export const coatUniforms = {
  uCoatFluff: { value: 0 }, // raised contour feathers → stronger scallop relief
};

const C = (hex) => new THREE.Color(hex).convertSRGBToLinear();

const GLSL_COMMON = /* glsl */`
  varying vec2 vCoat; varying float vWhite; varying float vLance; varying float vBare;
  uniform float uCoatFluff;
  uniform vec3 uBrown, uBrownEdge, uWhite, uWhiteShade, uDown;
  float cH1(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
  vec2 cH2(vec2 p){ return fract(sin(vec2(dot(p, vec2(127.1, 311.7)), dot(p, vec2(269.5, 183.3)))) * 43758.5453); }

  // Topmost feather at lattice point q.
  // out: L = feather-local (across −1..1 normalised to the vane half-width, along 0 base … 1 tip),
  //      e = inside distance to the vane edge, id = feather hash, sh = outside distance to the edge of
  //      the feather lying on top (contact shadow), h = height (relief)
  void coatEval(vec2 q, float lance, out vec2 L, out float e, out float id, out float sh, out float h, out vec2 dA) {
    float W = mix(0.72, 0.6, lance);
    float Lf = mix(2.15, 2.7, lance);
    float i0 = floor(q.y);
    L = vec2(0.0); e = -1.0; id = 0.0; sh = 9.0; h = -0.2; dA = vec2(0.0);
    for (int di = 3; di >= 0; di--) {
      float i = i0 + float(di);
      float off = mod(i, 2.0) * 0.5;
      float jc = floor(q.x - off + 0.5);
      float bestE = -1.0; vec2 bestL = vec2(0.0); float bestId = 0.0; float bestLen = 1.0; vec2 bestA = vec2(0.0);
      for (int dj = -1; dj <= 1; dj++) {
        float j = jc + float(dj);
        vec2 cid = vec2(j, i);
        vec2 r = cH2(cid);
        vec2 A = vec2(j + off + (r.x - 0.5) * 0.28, i + 0.5 + (r.y - 0.5) * 0.3);
        float len = Lf * (0.9 + 0.2 * cH1(cid + 7.0));
        float u = (A.y - q.y) / len;              // 0 at the feather base … 1 at its tip
        if (u < -0.05 || u > 1.0) continue;
        // slight lean of the rachis (feathers are not perfectly aligned)
        float lean = (cH1(cid + 2.0) - 0.5) * 0.25;
        float x = (q.x - A.x - lean * u * len) / W;
        // vane outline: rounded (body) or pointed (lanceolate) tip, narrow base
        float tipU = clamp((u - 0.42) / 0.58, 0.0, 1.0);
        float prof = pow(max(0.0, 1.0 - pow(tipU, mix(2.2, 1.25, lance))), mix(0.5, 0.75, lance)) * smoothstep(-0.05, 0.3, u);
        // frayed edge: barb ends at slightly different lengths
        float ang = atan(x, (u - 0.42) * 2.0);
        prof *= 1.0 - 0.07 * cH1(cid + floor(ang * 9.0 + 40.0)) * smoothstep(0.5, 0.9, u);
        float ee = prof - abs(x);
        if (ee > bestE) { bestE = ee; bestL = vec2(x / max(prof, 1e-3), u); bestId = cH1(cid + 3.1); bestLen = len; bestA = A - vec2(0.0, 0.55 * len) - q; }
      }
      if (bestE > 0.0) {
        L = bestL; e = bestE; id = bestId; dA = bestA;
        // relief: convex across the vane, lifting toward the tip; edges sit on the feather below
        h = 0.11 * L.y * (0.8 + 0.4 * id) - 0.07 * L.x * L.x + 0.05 * smoothstep(0.0, 0.12, e) + float(di) * 0.0;
        return;
      }
      sh = min(sh, -bestE);
    }
  }
`;

export function createCoatMaterial({ brown = 0x45311f, brownEdge = 0x6a4e33, white = COLORS.white, whiteShade = 0xb9b2a6, down = 0x1a130e } = {}) {
  const mat = new THREE.MeshPhysicalMaterial({
    vertexColors: true, roughness: 0.74, metalness: 0,
    sheen: 0.35, sheenRoughness: 0.6, sheenColor: new THREE.Color(0x9a8468),
  });
  mat.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, coatUniforms, {
      uBrown: { value: C(brown) }, uBrownEdge: { value: C(brownEdge) }, uWhite: { value: C(white) },
      uWhiteShade: { value: C(whiteShade) }, uDown: { value: C(down) },
    });
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', `#include <common>
        attribute vec2 aCoat; attribute float aWhite; attribute float aLance; attribute float aBare;
        varying vec2 vCoat; varying float vWhite; varying float vLance; varying float vBare;`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        vCoat = aCoat; vWhite = aWhite; vLance = aLance; vBare = aBare;`);
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>
        ${GLSL_COMMON}
        vec3 gCoatN = vec3(0.0, 0.0, 1.0); float gCoatFade = 1.0; float gCoatRough = 0.74;`)
      .replace('#include <color_fragment>', `#include <color_fragment>
        {
          vec2 q = vCoat;
          float fw = length(fwidth(q));
          float detail = 1.0 - smoothstep(0.32, 0.85, fw);   // feather ≥ ~2 px → full detail
          float isW = smoothstep(0.35, 0.65, vWhite);
          vec3 avg = mix(uBrown * 1.02, uWhite * 0.9, isW);  // coat colour seen from afar
          vec3 col = avg;
          if (detail > 0.0) {
            vec2 L; float e, id, shd, h; vec2 dA;
            coatEval(q, vLance, L, e, id, shd, h, dA);
            // white field at the feather's centre (not at this pixel) → whole feathers are white or brown
            vec2 qx = dFdx(q), qy = dFdy(q);
            float det = qx.x * qy.y - qx.y * qy.x;
            vec2 gW = abs(det) > 1e-12 ? vec2(qy.y * dFdx(vWhite) - qx.y * dFdy(vWhite), -qy.x * dFdx(vWhite) + qx.x * dFdy(vWhite)) / det : vec2(0.0);
            float wAt = vWhite + dot(gW, dA);
            vec3 c;
            if (e < 0.0) { c = uDown; h = -0.2; }
            else {
              float wf = step(0.5, wAt + (id - 0.5) * 0.3);   // per-feather white/brown decision
              vec3 base = mix(uBrown * (0.86 + 0.28 * id), uWhite * (0.93 + 0.07 * id), wf);
              // brown feathers: slightly paler, warmer fringe; white feathers: faint cream tips
              float edge = 1.0 - smoothstep(0.0, 0.16, e);
              base = mix(base, mix(uBrownEdge, uWhite * 0.97, wf), edge * mix(0.45, 0.25, wf) * smoothstep(0.55, 0.95, L.y));
              // barbs leave the rachis angled toward the tip
              float bf = (L.y * 26.0 - abs(L.x) * 9.0);
              float barbAA = 1.0 - smoothstep(0.08, 0.25, fw);
              float barbs = 1.0 + (sin(bf * 6.2832) * 0.5) * mix(0.10, 0.05, wf) * barbAA;
              // rachis
              float rach = (1.0 - smoothstep(0.035, 0.07, abs(L.x))) * (1.0 - smoothstep(0.6, 1.0, L.y));
              base *= barbs;
              base = mix(base, base * mix(1.35, 0.94, wf) + mix(0.012, 0.0, wf), rach * 0.7 * barbAA);
              // contact shadow under the edge of the feather lying on top + darker, downy base
              float occ = mix(mix(0.5, 0.8, wf), 1.0, smoothstep(0.0, 0.22, shd));
              occ *= mix(mix(0.72, 0.9, wf), 1.0, smoothstep(0.2, 0.75, L.y));
              base = mix(base, base * mix(vec3(1.0), uWhiteShade / uWhite, wf), (1.0 - occ) * 0.0);
              c = base * occ;
            }
            col = mix(avg, c, detail);
            // relief gradient by finite differences (in lattice units)
            vec2 L2, d2; float e2, id2, s2, hx, hy;
            float eps = 0.04;
            coatEval(q + vec2(eps, 0.0), vLance, L2, e2, id2, s2, hx, d2);
            coatEval(q + vec2(0.0, eps), vLance, L2, e2, id2, s2, hy, d2);
            vec2 g = vec2(hx - h, hy - h) / eps;
            g = clamp(g, vec2(-3.0), vec2(3.0)) * (0.55 + 0.6 * uCoatFluff) * mix(1.0, 0.6, isW);
            gCoatN = normalize(vec3(-g, 1.0));
            gCoatFade = detail;
          }
          diffuseColor.rgb = mix(col, diffuseColor.rgb, vBare);
          gCoatFade *= (1.0 - vBare);
        }`)
      .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
        if (gCoatFade > 0.0) {
          vec3 posV = -vViewPosition;
          vec3 dp1 = dFdx(posV), dp2 = dFdy(posV);
          vec2 du1 = dFdx(vCoat), du2 = dFdy(vCoat);
          vec3 dp2perp = cross(dp2, normal), dp1perp = cross(normal, dp1);
          vec3 T = dp2perp * du1.x + dp1perp * du2.x;
          vec3 B = dp2perp * du1.y + dp1perp * du2.y;
          float inv = inversesqrt(max(dot(T, T), dot(B, B)) + 1e-30);
          vec3 n2 = normalize(T * inv * gCoatN.x + B * inv * gCoatN.y + normal * gCoatN.z);
          normal = normalize(mix(normal, n2, gCoatFade));
        }`);
  };
  mat.customProgramCacheKey = () => 'coat-v1';
  return mat;
}

// ------------------------------------------------------------------------------------------------
// CPU helper: lattice coordinates for a (rings × around) grid.
//   P[k][a]   : THREE.Vector3 positions, a = 0 … AROUND (a = AROUND duplicates a = 0)
//   fs(k, a)  : feather row spacing (m) at that vertex
//   topA      : index of the dorsal midline (x = 0 there; x is mirrored left/right so the seam
//               where +x meets −x lies on the opposite, ventral side)
//   flow      : +1 if feathers point toward decreasing k, −1 toward increasing k
// returns Float32Array (2 per vertex), row-major [k][a]
export function latticeCoords(P, fs, topA, flow = 1) {
  const K = P.length, A = P[0].length - 1;
  const out = new Float32Array(K * (A + 1) * 2);
  // y: integrate along the tract using the ring-average spacing
  const y = new Float32Array(K);
  for (let k = 1; k < K; k++) {
    let ds = 0, f = 0;
    for (let a = 0; a < A; a++) { ds += P[k][a].distanceTo(P[k - 1][a]); f += 0.5 * (fs(k, a) + fs(k - 1, a)); }
    y[k] = y[k - 1] + (ds / A) / (f / A);
  }
  for (let k = 0; k < K; k++) {
    // x: integrate around the ring both ways from the dorsal midline
    const x = new Float32Array(A + 1);
    const half = A / 2;
    for (let s = 1; s <= half; s++) {
      const a1 = (topA + s) % A, a0 = (topA + s - 1) % A;
      x[a1] = x[a0] + P[k][a1].distanceTo(P[k][a0]) / (0.5 * (fs(k, a1) + fs(k, a0)));
    }
    for (let s = 1; s < half; s++) {
      const a1 = (topA - s + A) % A, a0 = (topA - s + 1 + A) % A;
      x[a1] = x[a0] - P[k][a1].distanceTo(P[k][a0]) / (0.5 * (fs(k, a1) + fs(k, a0)));
    }
    x[A] = x[0];
    for (let a = 0; a <= A; a++) {
      const i = (k * (A + 1) + a) * 2;
      out[i] = x[a]; out[i + 1] = flow * y[k];
    }
  }
  return out;
}
