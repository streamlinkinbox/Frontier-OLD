import * as THREE from 'three';
import { featherUniforms } from './materials.js';

// ------------------------------------------------------------------------------------------------
// Plumage shading for the groomed contour feathers and the envelope undercoat.
//  • albedo = per-feather colour, blended toward the fringe colour at the vane margin (atlas G) and
//    modulated by the barb shading (atlas R); coverage from atlas A with alpha-to-coverage (MSAA)
//  • lighting normal = mostly the body-surface normal under the feather (soft, continuous plumage)
//    with the card normal and the barb normal map adding the feather-level relief
//  • occlusion: field AO at the feather root × depth in the coat (feather bases are buried)
//  • sky light is partly desaturated for plumage: white feathers in shade read cool-grey, not blue
//  • thin keratin: soft forward-scatter / sheen at grazing angles; backlit white feathers glow a little
// ------------------------------------------------------------------------------------------------

export const plumageUniforms = {
  uSkyDesat: { value: 0.55 },
  uNormBlend: { value: 0.6 },
};

export function createPlumageMaterial(atlas, { undercoat = false } = {}) {
  const m = new THREE.MeshStandardMaterial({
    vertexColors: true, roughness: 0.78, metalness: 0,
    side: undercoat ? THREE.FrontSide : THREE.DoubleSide,
  });
  if (!undercoat) {
    m.map = atlas.map; m.normalMap = atlas.normalMap; m.normalScale = new THREE.Vector2(0.55, 0.55);
    m.alphaTest = 0.45; m.alphaToCoverage = true;
  }
  m.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, featherUniforms, plumageUniforms);
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', `#include <common>
        uniform float uTime, uFluff, uFluffBody, uFlutter, uBreath, uNormBlend;
        attribute float aAO;
        varying float vOcc;
        ${undercoat ? '' : `attribute vec3 aBaseNormal; attribute vec3 aTip; attribute float aT, aRand, aLen, aMask;
        varying vec3 vTip; varying float vT;`}`)
      .replace('#include <beginnormal_vertex>', `#include <beginnormal_vertex>
        ${undercoat ? '' : 'objectNormal = normalize(mix(objectNormal, aBaseNormal, uNormBlend));'}`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        ${undercoat ? 'vOcc = aAO;' : `
        vTip = aTip; vT = aT;
        vOcc = aAO * mix(0.6, 1.0, smoothstep(0.0, 0.75, aT));
        // raised hackles / fluffed body plumage: the feather pivots up about its root
        float raise = uFluff * aMask + uFluffBody * (1.0 - aMask) * 0.7 + 0.1 * uBreath * (1.0 - aMask);
        float fl = sin(uTime * (17.0 + aRand * 13.0) + aRand * 40.0 + position.x * 60.0 + position.z * 45.0);
        transformed += aBaseNormal * aT * aLen * (0.38 * raise + 0.04 * uFlutter * fl * aT);`}`);
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>
        uniform float uSkyDesat;
        varying float vOcc;
        ${undercoat ? '' : 'varying vec3 vTip; varying float vT;'}`)
      .replace('#include <map_fragment>', undercoat ? '' : `
        vec4 fx = texture2D(map, vMapUv);
        // margin → fringe colour, barb shading, slightly greyer downy base
        vec3 alb = mix(diffuseColor.rgb, vTip, fx.g);
        alb *= mix(0.55, 1.0, fx.r) ;
        alb = mix(alb, alb * vec3(0.78, 0.76, 0.74), fx.b * 0.6);
        diffuseColor.rgb = alb;
        diffuseColor.a = fx.a;`)
      .replace('#include <color_fragment>', undercoat ? '#include <color_fragment>' : `#include <color_fragment>`)
      .replace('#include <normal_fragment_begin>', THREE.ShaderChunk.normal_fragment_begin.replace('normal *= faceDirection;', ''))
      .replace('#include <lights_fragment_maps>', `#include <lights_fragment_maps>
        {
          float l = dot(iblIrradiance, vec3(0.2126, 0.7152, 0.0722));
          iblIrradiance = mix(iblIrradiance, vec3(l), uSkyDesat) * vOcc;
          irradiance *= vOcc;
        }`)
      .replace('#include <lights_fragment_end>', `#include <lights_fragment_end>
        {
          // thin keratin barbs: soft sheen at grazing angles (stronger on the pale vanes)
          float nv = saturate(abs(dot(normal, normalize(vViewPosition))));
          float fres = pow(1.0 - nv, 4.0);
          reflectedLight.indirectSpecular += fres * 0.12 * (diffuseColor.rgb + 0.04) * vOcc;
        }`);
  };
  m.customProgramCacheKey = () => `plumage-${undercoat}`;
  return m;
}
