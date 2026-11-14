import * as THREE from 'three';
import { featherTextures, scaleTextures, noiseTexture } from './textures.js';
import { COLORS } from './anatomy.js';

// Shared uniforms (one eagle per scene)
export const featherUniforms = {
  uTime: { value: 0 },
  uFluff: { value: 0 },      // raised head/neck hackles (agitation, screech)
  uFluffBody: { value: 0 },  // body plumage fluffing (rousing, cold)
  uFlutter: { value: 0 },    // airflow flutter (0 perched … 1 fast flight)
  uBreath: { value: 0 },     // breathing expansion (−1 … 1)
  uFold: { value: 0 },       // wing fold fraction (folded flight feathers: undersides lie against the body, in its shadow)
  uNormBlend: { value: 0.72 }, // contour plumage shades as one soft surface (feather vanes lie on the skin)
};

function patchFeather(mat, { fluff = false, backTint = [1.1, 1.08, 1.05], sheen = 0.18 } = {}) {
  mat.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, featherUniforms);
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', `#include <common>
        uniform float uTime, uFluff, uFluffBody, uFlutter, uBreath, uNormBlend;
        attribute float aT; attribute float aRand;
        ${fluff ? 'attribute vec3 aBaseNormal; attribute float aLen; attribute float aMask;' : ''}
        varying float vT;`)
      .replace('#include <beginnormal_vertex>', `#include <beginnormal_vertex>
        ${fluff ? `
        // Overlapping contour feathers form a continuous, softly scalloped coat: the lighting normal is
        // mostly the body-surface normal under the feather, with the card's own normal adding the scallop.
        objectNormal = normalize(mix(objectNormal, aBaseNormal, uNormBlend * (1.0 - 0.35 * aT)));` : ''}`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        vT = aT;
        ${fluff ? `
        // erect the feather about its base: displacement grows along the feather
        float raise = uFluff * aMask + uFluffBody * (1.0 - aMask) * 0.8 + 0.12 * uBreath * (1.0 - aMask);
        float fl = sin(uTime * (17.0 + aRand * 13.0) + aRand * 40.0 + position.x * 60.0 + position.z * 45.0);
        transformed += aBaseNormal * aT * aLen * (0.42 * raise + 0.045 * uFlutter * fl * aT);
        ` : ''}`);
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>
        uniform float uFold;
        varying float vT;`)
      .replace('#include <color_fragment>', `#include <color_fragment>
        // ventral surfaces of flight feathers are paler/greyer; strong forward scattering at grazing angles.
        // In the closed wing the undersides face the flank, in its shadow → occluded instead of pale.
        if (!gl_FrontFacing) diffuseColor.rgb *= mix(vec3(${backTint.map((v) => v.toFixed(3)).join(',')}), vec3(0.45), uFold);`)
      .replace('#include <lights_fragment_end>', `#include <lights_fragment_end>
        {
          // thin keratin barbules: soft sheen at grazing view angles
          float fres = pow(1.0 - saturate(abs(dot(normal, normalize(vViewPosition)))), 4.0);
          reflectedLight.indirectSpecular += fres * ${sheen.toFixed(3)} * diffuseColor.rgb * 0.8 + fres * ${(sheen * 0.08).toFixed(4)};
        }`);
  };
  mat.customProgramCacheKey = () => `feather-${fluff}-${sheen}-${backTint.join('_')}`;
  return mat;
}

export function createMaterials() {
  const T = featherTextures();
  const S = scaleTextures();
  const noise = noiseTexture(256, 5, 1);
  noise.repeat.set(6, 1);
  for (const t of [T.flight.map, T.covert.map, T.contour.map, S.map]) t.colorSpace = THREE.NoColorSpace;

  const mk = (tex, opts = {}) => new THREE.MeshStandardMaterial({
    vertexColors: true, map: tex.map, normalMap: tex.normalMap, normalScale: new THREE.Vector2(0.35, 0.35),
    side: THREE.DoubleSide, alphaTest: 0.5, alphaToCoverage: true, roughness: 0.72, metalness: 0, ...opts,
  });
  const M = {};
  M.flight = patchFeather(mk(T.flight, { roughness: 0.78 }), { backTint: [1.7, 1.68, 1.66], sheen: 0.1 });
  // rectrices / tail coverts: white vanes; the underside is the same white, not brightened (was glassy)
  M.tail = patchFeather(mk(T.flight, { roughness: 0.74 }), { backTint: [0.96, 0.95, 0.93], sheen: 0.08 });
  M.tailCovert = patchFeather(mk(T.covert, { roughness: 0.8 }), { backTint: [0.95, 0.94, 0.92], sheen: 0.06 });
  M.covert = patchFeather(mk(T.covert, { roughness: 0.8 }), { backTint: [1.3, 1.27, 1.24], sheen: 0.08 });
  M.contour = patchFeather(mk(T.contour, { roughness: 0.78 }), { fluff: true, backTint: [0.8, 0.78, 0.76], sheen: 0.14 });
  M.body = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95, metalness: 0 });
  M.skull = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9 });

  // Bill: glossy keratin with fine longitudinal grain; cere slightly waxy (roughness from vertex attribute)
  M.beak = new THREE.MeshPhysicalMaterial({ vertexColors: true, roughness: 0.42, metalness: 0, clearcoat: 0.12, clearcoatRoughness: 0.4, bumpMap: noise, bumpScale: 0.35, sheen: 0 });
  M.beak.onBeforeCompile = (sh) => {
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nattribute float aRough; varying float vRough;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvRough = aRough;');
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nvarying float vRough;')
      .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\nroughnessFactor = vRough + 0.1;');
  };
  M.beak.customProgramCacheKey = () => 'beak';
  M.mouth = new THREE.MeshPhysicalMaterial({ vertexColors: true, roughness: 0.38, clearcoat: 0.6, clearcoatRoughness: 0.2, side: THREE.DoubleSide });

  // Eye: pale lemon iris with radial fibres and a dark limbal ring; wet clear cornea
  M.eye = new THREE.MeshPhysicalMaterial({ map: irisTexture(), roughness: 0.35, clearcoat: 1, clearcoatRoughness: 0.02, ior: 1.376, specularIntensity: 0.9 });
  M.lid = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.8, side: THREE.DoubleSide });
  M.nict = new THREE.MeshPhysicalMaterial({ color: 0xd8e0e6, roughness: 0.15, transparent: true, opacity: 0.62, side: THREE.DoubleSide, depthWrite: false, clearcoat: 1 });

  // Feet: yellow, reticulate scales, rough papillae on the pads (fish-gripping spicules)
  M.foot = new THREE.MeshStandardMaterial({ vertexColors: true, map: S.map, normalMap: S.normalMap, normalScale: new THREE.Vector2(1.1, 1.1), roughness: 0.62 });
  S.map.repeat.set(2, 6); S.normalMap.repeat.set(2, 6);
  M.talon = new THREE.MeshPhysicalMaterial({ vertexColors: true, roughness: 0.28, clearcoat: 0.8, clearcoatRoughness: 0.15 });
  M.shank = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95 });
  M.wingSkin = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95, side: THREE.DoubleSide });
  return M;
}

function irisTexture() {
  const W = 512, H = 512;
  const c = document.createElement('canvas'); c.width = W; c.height = H;
  const g = c.getContext('2d');
  // SphereGeometry UV: v = 1 at the gaze pole after rotating the pole to +Z; u around.
  // Draw in (u, v) space: rows near the top (v → 1) are the pupil, then iris, limbus, sclera.
  const img = g.createImageData(W, H);
  let seed = 3;
  const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
  const fib = new Float32Array(W);
  for (let i = 0; i < W; i++) fib[i] = rnd();
  const sm = new Float32Array(W);
  for (let i = 0; i < W; i++) { let s = 0; for (let k = -3; k <= 3; k++) s += fib[(i + k + W) % W]; sm[i] = s / 7; }
  const iris = [1.0, 0.97, 0.8], irisDeep = [0.96, 0.89, 0.62]; // pale cream-yellow adult iris
  for (let y = 0; y < H; y++) {
    const v = 1 - y / (H - 1); // canvas top = v 1
    const th = (1 - v) * 180;  // degrees from the gaze pole
    for (let x = 0; x < W; x++) {
      const o = (y * W + x) * 4;
      let r, gg, b;
      if (th < 15.5) { r = gg = b = 0.01; }
      else if (th < 41) {
        const q = (th - 15.5) / 25.5;
        const f = 0.75 + 0.5 * (sm[x] - 0.5) + 0.25 * (fib[(x * 3) % W] - 0.5) * (1 - q);
        const m = Math.min(1, Math.max(0, q * 1.2));
        r = (iris[0] * m + irisDeep[0] * (1 - m)) * f; gg = (iris[1] * m + irisDeep[1] * (1 - m)) * f; b = (iris[2] * m + irisDeep[2] * (1 - m)) * f;
        // pupillary ruff and limbal ring
        if (th < 17) { r *= 0.45; gg *= 0.4; b *= 0.35; }
        if (th > 38.5) { const k = (th - 38.5) / 2.5; r *= 1 - 0.3 * k; gg *= 1 - 0.32 * k; b *= 1 - 0.35 * k; }
      } else { r = 0.22; gg = 0.2; b = 0.16; }
      img.data[o] = Math.min(255, r * 255); img.data[o + 1] = Math.min(255, gg * 255); img.data[o + 2] = Math.min(255, b * 255); img.data[o + 3] = 255;
    }
  }
  g.putImageData(img, 0, 0);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8;
  return t;
}
