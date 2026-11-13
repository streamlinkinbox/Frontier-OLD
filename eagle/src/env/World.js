import * as THREE from 'three';
import { Sky } from 'three/examples/jsm/objects/Sky.js';
import { Water } from 'three/examples/jsm/objects/Water.js';
import { mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

// Lakeshore habitat — bald eagles hunt from shorelines of large lakes and rivers backed by tall
// conifers (Sitka spruce / western hemlock in the Pacific North-West).
//
//  • Preetham sky, sun 21° high and behind the viewer's right shoulder (the plumage is front-lit).
//  • Shore: a real shingle beach — ~11 000 individually modelled, smooth-shaded, instanced stones
//    (granite, basalt, quartzite, sandstone; most flattened river cobbles) on a coarse sand/grit
//    bed that darkens in a wet band at the waterline. No painted "pebble" decals.
//  • Water: planar-reflection lake (three/examples Water) — reflects the forest, sky and the bird.
//  • Boulder: glacial-erratic granite, flat exfoliation facets cut by planes, lichen crust on top.
//  • Bleached driftwood logs on the strand line.
//  • Forest: conifers made of drooping needle-spray clumps (not long striped cards) with a
//    spherical canopy normal so the crowns light softly; aerial perspective via height-less fog.
//  • Everything is procedural (no downloaded textures).

function hash(x, y) { const s = Math.sin(x * 127.1 + y * 311.7) * 43758.5453; return s - Math.floor(s); }
function vnoise(x, y) {
  const xi = Math.floor(x), yi = Math.floor(y), xf = x - xi, yf = y - yi;
  const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
  const a = hash(xi, yi), b = hash(xi + 1, yi), c = hash(xi, yi + 1), d = hash(xi + 1, yi + 1);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}
export function fbm(x, y, oct = 5) { let s = 0, a = 0.5, f = 1; for (let i = 0; i < oct; i++) { s += a * vnoise(x * f, y * f); f *= 2.03; a *= 0.5; } return s; }
function hash3(x, y, z) { const s = Math.sin(x * 127.1 + y * 311.7 + z * 74.7) * 43758.5453; return s - Math.floor(s); }
function vnoise3(x, y, z) {
  const xi = Math.floor(x), yi = Math.floor(y), zi = Math.floor(z), xf = x - xi, yf = y - yi, zf = z - zi;
  const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf), w = zf * zf * (3 - 2 * zf);
  const L = (a, b, t) => a + (b - a) * t;
  const c = (i, j, k) => hash3(xi + i, yi + j, zi + k);
  return L(L(L(c(0, 0, 0), c(1, 0, 0), u), L(c(0, 1, 0), c(1, 1, 0), u), v), L(L(c(0, 0, 1), c(1, 0, 1), u), L(c(0, 1, 1), c(1, 1, 1), u), v), w);
}
function fbm3(x, y, z, oct = 4) { let s = 0, a = 0.5, f = 1; for (let i = 0; i < oct; i++) { s += a * vnoise3(x * f, y * f, z * f); f *= 2.03; a *= 0.5; } return s; }
const ss = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
const lerp = (a, b, t) => a + (b - a) * t;
function rng(seed) { let s = seed >>> 0; return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296); }

// Lake: an ellipse (z squashed by 1.3) north of the eagle; the waterline is ≈10 m from the origin.
export const LAKE = { center: new THREE.Vector2(0, -45), radius: 45, level: -0.9 };
const SUN = { elev: 21, azim: 62 };

// signed distance-ish to the waterline (m): + on land, − in the water
function shoreDist(x, z) { return Math.hypot(x - LAKE.center.x, (z - LAKE.center.y) * 1.3) - LAKE.radius; }

// Terrain height (metres).
export function terrainHeight(x, z) {
  const dw = shoreDist(x, z);
  const r = Math.hypot(x, z);
  let h;
  if (dw >= 0) {
    // beach rising gently from the water (≈1:14), then a berm and the forest floor / hills
    h = LAKE.level + 0.12 + Math.min(dw, 18) * 0.07 + Math.max(0, dw - 18) * 0.02;
    h += (fbm(x * 0.04, z * 0.04, 3) - 0.5) * 0.9 * ss(6, 30, dw) * ss(4, 14, r);
    h += Math.pow(fbm(x * 0.004 + 3, z * 0.004 + 1, 5), 1.6) * 90 * ss(60, 400, dw);
    h += Math.pow(fbm(x * 0.0011 + 7, z * 0.0011 + 3, 4), 2.2) * 520 * ss(380, 1300, dw);
  } else {
    h = LAKE.level - Math.min(-dw, 10) * 0.32 - Math.max(0, -dw - 10) * 0.05;
  }
  // centimetre-scale relief of the beach (stones are separate meshes)
  h += (vnoise(x * 1.7, z * 1.7) - 0.5) * 0.035 + (vnoise(x * 0.45 + 9, z * 0.45) - 0.5) * 0.06;
  return h;
}

// ------------------------------------------------------------------------------------------------
export class World {
  constructor(scene, renderer) {
    this.scene = scene;
    this.renderer = renderer;
    this.sunDir = new THREE.Vector3();
    this.time = 0;
    scene.fog = new THREE.FogExp2(0xaabdcc, 0.0021);
    this.buildSky();
    this.buildTerrain();
    this.buildStones();
    this.buildBoulder();
    this.buildDriftwood();
    this.buildForest();
    this.buildWater(renderer);
    this.buildLights();
  }

  buildSky() {
    const sky = this.sky = new Sky();
    sky.scale.setScalar(20000);
    const u = sky.material.uniforms;
    u.turbidity.value = 4.0; u.rayleigh.value = 1.15; u.mieCoefficient.value = 0.0045; u.mieDirectionalG.value = 0.84;
    const phi = THREE.MathUtils.degToRad(90 - SUN.elev), theta = THREE.MathUtils.degToRad(SUN.azim);
    this.sunDir.setFromSphericalCoords(1, phi, theta);
    u.sunPosition.value.copy(this.sunDir);
    this.scene.add(sky);
  }

  // ---------------------------------------------------------------- terrain
  buildTerrain() {
    const size = 6000, seg = 420;
    const g = new THREE.PlaneGeometry(size, size, seg, seg);
    g.rotateX(-Math.PI / 2);
    // radial warp: vertices concentrated near the eagle (≈2 cm spacing at the centre … metres far away)
    const p = g.attributes.position;
    for (let i = 0; i < p.count; i++) {
      let x = p.getX(i), z = p.getZ(i);
      const r = Math.hypot(x, z) / (size / 2);
      const k = Math.pow(r, 2.6) / Math.max(r, 1e-6);
      x *= k; z *= k;
      p.setXYZ(i, x, terrainHeight(x, z), z);
    }
    g.computeVertexNormals();
    const mat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.93, metalness: 0 });
    const L = LAKE;
    mat.onBeforeCompile = (sh) => {
      sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 vW; varying vec3 vNw;')
        .replace('#include <worldpos_vertex>', '#include <worldpos_vertex>\nvW = (modelMatrix * vec4(transformed,1.0)).xyz; vNw = normalize(mat3(modelMatrix) * objectNormal);');
      sh.fragmentShader = sh.fragmentShader.replace('#include <common>', `#include <common>
        varying vec3 vW; varying vec3 vNw;
        float h2(vec2 p){ return fract(sin(dot(p, vec2(127.1,311.7))) * 43758.5453); }
        float n2(vec2 p){ vec2 i=floor(p), f=fract(p); vec2 u=f*f*(3.0-2.0*f);
          return mix(mix(h2(i),h2(i+vec2(1,0)),u.x), mix(h2(i+vec2(0,1)),h2(i+vec2(1,1)),u.x), u.y); }
        float fb(vec2 p){ float s=0.0,a=0.5; for(int i=0;i<5;i++){ s+=a*n2(p); p*=2.03; a*=0.5;} return s; }
        vec2 hh2(vec2 p){ p = vec2(dot(p,vec2(127.1,311.7)), dot(p,vec2(269.5,183.3))); return fract(sin(p)*43758.5453); }
        vec3 gran(vec2 x, out vec2 off){ vec2 n=floor(x), f=fract(x); float d1=8.0; vec2 id=vec2(0); off=vec2(0);
          for(int j=-1;j<=1;j++) for(int i=-1;i<=1;i++){ vec2 g=vec2(i,j); vec2 o=0.5+0.4*sin(6.2831*hh2(n+g));
            vec2 r=g+o-f; float d=dot(r,r); if(d<d1){ d1=d; id=n+g; off=-r; } }
          return vec3(sqrt(d1), 0.0, hh2(id).x); }
        float gWet = 0.0; vec3 gN = vec3(0.0);`)
        .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
        normal = normalize(normal + (viewMatrix * vec4(gN, 0.0)).xyz);`)
        .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
        roughnessFactor = mix(roughnessFactor, 0.32, gWet);`)
        .replace('#include <color_fragment>', `#include <color_fragment>
        {
          float slope = 1.0 - clamp(vNw.y, 0.0, 1.0);
          float d = length(vW.xz);
          float dw = length(vec2(vW.x - ${L.center.x.toFixed(1)}, (vW.z - ${L.center.y.toFixed(1)}) * 1.3)) - ${L.radius.toFixed(1)};
          float n = fb(vW.xz * 0.3), nb = fb(vW.xz * 0.018), nm = fb(vW.xz * 2.2);
          // coarse sand / grit: multi-scale grain so it never reads as a flat colour
          float g1 = n2(vW.xz * 210.0), g2 = n2(vW.xz * 63.0), g3 = n2(vW.xz * 17.0);
          float grain = g1 * 0.45 + g2 * 0.35 + g3 * 0.2;
          vec3 grit = mix(vec3(0.115,0.105,0.092), vec3(0.235,0.215,0.185), grain);
          // granules (≈1 cm): Voronoi cells, each a slightly domed grain with its own tint
          vec2 gOff; vec3 gr = gran(vW.xz * 85.0, gOff);
          float isGrain = smoothstep(0.42, 0.3, gr.x) * step(0.35, gr.z);
          vec3 gTint = mix(vec3(0.10,0.095,0.088), vec3(0.30,0.28,0.25), fract(gr.z * 41.3));
          gTint *= mix(vec3(1.0), vec3(1.12,1.0,0.85), step(0.8, fract(gr.z * 17.1)));
          grit = mix(grit * 0.8, gTint, isGrain * 0.85);
          grit *= 0.88 + 0.24 * nm;
          // strand line: dry bleached sand above, darker wet sand below, a thin film at the edge
          vec3 sand = mix(vec3(0.27,0.245,0.20), vec3(0.33,0.30,0.25), grain) * (0.9 + 0.2 * n);
          float beach = 1.0 - smoothstep(6.0, 14.0, dw + n * 3.0);
          vec3 col = mix(grit, sand, beach * 0.55);
          gWet = 1.0 - smoothstep(0.0, 2.2, dw + (nm - 0.5) * 1.2);
          col = mix(col, col * vec3(0.48,0.5,0.52), gWet);
          // grass berm & forest floor away from the water
          vec3 grass = mix(vec3(0.075,0.10,0.04), vec3(0.16,0.15,0.07), n) * (0.75 + 0.35 * g3);
          vec3 forest = mix(vec3(0.03,0.04,0.022), vec3(0.07,0.065,0.04), nb) * (0.8 + 0.3 * g3);
          float landW = smoothstep(16.0, 24.0, d + n * 8.0) * smoothstep(9.0, 16.0, dw + n * 6.0);
          col = mix(col, grass, landW);
          col = mix(col, forest, smoothstep(70.0, 140.0, dw + nb * 60.0));
          vec3 rock = mix(vec3(0.17,0.165,0.16), vec3(0.30,0.29,0.27), g3);
          col = mix(col, rock, smoothstep(0.4, 0.65, slope + n * 0.12));
          col = mix(col, vec3(0.86,0.88,0.92), smoothstep(300.0, 380.0, vW.y + n * 50.0) * (1.0 - smoothstep(0.55, 0.8, slope)));
          // underwater: silt
          col = mix(col, vec3(0.07,0.075,0.06), smoothstep(0.0, -3.0, dw));
          // micro-normal from the grain (only near the camera)
          float near = 1.0 - smoothstep(4.0, 18.0, d);
          vec2 gOff2; vec3 gr2 = gran(vW.xz * 85.0, gOff2);
          float dome = smoothstep(0.45, 0.2, gr2.x) * step(0.35, gr2.z);
          gN = vec3(gOff2.x, 0.0, gOff2.y) * 1.1 * dome * near * (1.0 - landW);
          diffuseColor.rgb = col;
        }`);
    };
    const mesh = this.terrain = new THREE.Mesh(g, mat);
    mesh.receiveShadow = true;
    this.scene.add(mesh);
  }

  // ---------------------------------------------------------------- shingle
  stoneGeometry(detail, seed, flat) {
    let g = new THREE.IcosahedronGeometry(1, detail);
    g.deleteAttribute('normal'); g.deleteAttribute('uv');
    g = mergeVertices(g, 1e-5);
    const p = g.attributes.position, v = new THREE.Vector3();
    const R = rng(seed);
    const o = [R() * 10, R() * 10, R() * 10];
    for (let i = 0; i < p.count; i++) {
      v.fromBufferAttribute(p, i);
      // water-worn: low-frequency lumps only, then flattened (most beach cobbles are discoidal)
      const n = fbm3(v.x * 0.9 + o[0], v.y * 0.9 + o[1], v.z * 0.9 + o[2], 3) - 0.5;
      v.multiplyScalar(1 + n * 0.35);
      v.y *= flat;
      // a flatter underside so it sits in the sand
      if (v.y < 0) v.y *= 0.6;
      p.setXYZ(i, v.x, v.y, v.z);
    }
    g.computeVertexNormals();
    return g;
  }

  buildStones() {
    const mat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.8, metalness: 0 });
    // per-stone surface: speckled granite / fine basalt / quartz veins from object-space noise
    mat.onBeforeCompile = (sh) => {
      sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 vOP; varying float vSeed; varying vec3 vWP;')
        .replace('#include <begin_vertex>', '#include <begin_vertex>\nvOP = position; vSeed = fract(instanceMatrix[3][0] * 13.17 + instanceMatrix[3][2] * 7.31);')
        .replace('#include <worldpos_vertex>', '#include <worldpos_vertex>\nvWP = (modelMatrix * instanceMatrix * vec4(transformed,1.0)).xyz;');
      sh.fragmentShader = sh.fragmentShader.replace('#include <common>', `#include <common>
        varying vec3 vOP; varying float vSeed; varying vec3 vWP;
        float h3(vec3 p){ return fract(sin(dot(p, vec3(127.1,311.7,74.7))) * 43758.5453); }
        float n3(vec3 p){ vec3 i=floor(p), f=fract(p); vec3 u=f*f*(3.0-2.0*f);
          return mix(mix(mix(h3(i),h3(i+vec3(1,0,0)),u.x), mix(h3(i+vec3(0,1,0)),h3(i+vec3(1,1,0)),u.x),u.y),
                     mix(mix(h3(i+vec3(0,0,1)),h3(i+vec3(1,0,1)),u.x), mix(h3(i+vec3(0,1,1)),h3(i+vec3(1,1,1)),u.x),u.y), u.z); }
        float sWet = 0.0; float sRough = 0.8;`)
        .replace('#include <color_fragment>', `#include <color_fragment>
        {
          vec3 q = vOP * 9.0 + vSeed * 31.0;
          float speck = n3(q * 3.0), mott = n3(q * 0.6), vein = abs(n3(q * 0.8 + 5.0) - 0.5);
          vec3 c = diffuseColor.rgb * (0.86 + 0.28 * mott);
          float kind = fract(vSeed * 7.0);
          // grain size is physical (world-scale), not per-stone: ~3 mm crystals
                    float fine = n3(vWP * 260.0), fine2 = n3(vWP * 180.0 + 3.0);
          if (kind < 0.25) { // granite/diorite: biotite + feldspar crystals, low contrast at this scale
            c = mix(c, c * 0.55, smoothstep(0.62, 0.75, fine) * 0.8);
            c = mix(c, c * 1.5 + 0.03, smoothstep(0.7, 0.82, fine2) * 0.5);
          } else if (kind < 0.36) { // thin quartz vein
            c = mix(c, vec3(0.55,0.53,0.5), (1.0 - smoothstep(0.0, 0.025, vein)) * 0.6);
          } else { // fine-grained basalt / greywacke: faint grain only
            c *= 0.92 + 0.16 * fine;
          }
          sRough = 0.72 + 0.2 * mott;
          // wet band at the waterline (and the lower part of every stone holds moisture)
          float dw = length(vec2(vWP.x - ${LAKE.center.x.toFixed(1)}, (vWP.z - ${LAKE.center.y.toFixed(1)}) * 1.3)) - ${LAKE.radius.toFixed(1)};
          sWet = 1.0 - smoothstep(0.0, 2.0, dw);
          c *= mix(1.0, 0.55, sWet);
          diffuseColor.rgb = c;
        }`)
        .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\nroughnessFactor = mix(sRough, 0.2, sWet);');
    };
    this.stoneMat = mat;
    const palette = [
      [0.22, 0.215, 0.20], [0.16, 0.155, 0.15], [0.085, 0.085, 0.085], [0.27, 0.245, 0.215],
      [0.19, 0.16, 0.13], [0.32, 0.31, 0.29], [0.11, 0.105, 0.10], [0.23, 0.19, 0.155], [0.065, 0.065, 0.07],
    ];
    const R = rng(4711);
    // dart throwing with a spatial hash (no stone interpenetration)
    const placed = [], cell = 0.12, grid = new Map();
    const key = (x, z) => `${Math.floor(x / cell)},${Math.floor(z / cell)}`;
    const fits = (x, z, r) => {
      const cx = Math.floor(x / cell), cz = Math.floor(z / cell);
      for (let i = -1; i <= 1; i++) for (let j = -1; j <= 1; j++) {
        const a = grid.get(`${cx + i},${cz + j}`); if (!a) continue;
        for (const s of a) if (Math.hypot(s.x - x, s.z - z) < (s.r + r) * 0.82) return false;
      }
      return true;
    };
    const MAXR = 15;
    for (let tries = 0; tries < 400000 && placed.length < 22000; tries++) {
      const rr = Math.pow(R(), 0.62) * MAXR, a = R() * Math.PI * 2; // denser near the eagle
      const x = Math.cos(a) * rr + 1.2, z = Math.sin(a) * rr;
      const dw = shoreDist(x, z);
      if (dw < -1.5) continue;
      // size distribution: mostly 1–4 cm gravel, some 5–9 cm cobbles, rare 12–16 cm stones
      const u = R();
      let r = u < 0.62 ? 0.011 + R() * 0.017 : u < 0.95 ? 0.028 + R() * 0.035 : 0.065 + R() * 0.055;
      // denser and coarser toward the water (storm beach), sparser up on the berm
      const dens = (1 - ss(12, 22, Math.hypot(x, z))) * lerp(1, 0.75, ss(4, 12, dw));
      if (R() > dens) continue;
      // keep big stones off the walking circle so the feet stand on gravel
      const dc = Math.hypot(x - 2.4, z);
      if (Math.abs(dc - 2.4) < 0.25 || Math.hypot(x, z) < 0.3) r = Math.min(r, 0.016);
      if (!fits(x, z, r)) continue;
      const s = { x, z, r }; placed.push(s);
      const k = key(x, z); if (!grid.has(k)) grid.set(k, []); grid.get(k).push(s);
    }
    // geometry variants: high detail near the eagle, low detail further out
    const variants = [];
    for (let v = 0; v < 4; v++) variants.push({ hi: this.stoneGeometry(3, 100 + v, [0.42, 0.55, 0.36, 0.7][v]), lo: this.stoneGeometry(2, 100 + v, [0.42, 0.55, 0.36, 0.7][v]), list: [] });
    for (const s of placed) variants[Math.floor(R() * 4)].list.push(s);
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), sc = new THREE.Vector3(), pos = new THREE.Vector3(), c = new THREE.Color();
    for (const V of variants) {
      const isHi = (s) => Math.hypot(s.x, s.z) < 6.5 && s.r > 0.022;
      const near = V.list.filter(isHi), far = V.list.filter((s) => !isHi(s));
      for (const [list, geo, shadow] of [[near, V.hi, true], [far, V.lo, true]]) {
        const inst = new THREE.InstancedMesh(geo, mat, list.length);
        list.forEach((s, i) => {
          const y = terrainHeight(s.x, s.z);
          e.set((R() - 0.5) * 0.25, R() * Math.PI * 2, (R() - 0.5) * 0.25);
          q.setFromEuler(e);
          const el = 0.75 + R() * 0.5;
          sc.set(s.r * el, s.r, s.r / el);
          pos.set(s.x, y - s.r * 0.12, s.z);
          m.compose(pos, q, sc); inst.setMatrixAt(i, m);
          const pc = palette[Math.floor(R() * palette.length)], vv = 0.85 + R() * 0.3;
          c.setRGB(pc[0] * vv, pc[1] * vv, pc[2] * vv); inst.setColorAt(i, c);
        });
        inst.castShadow = shadow; inst.receiveShadow = true;
        this.scene.add(inst);
      }
    }
    this.stoneCount = placed.length;
  }

  // ---------------------------------------------------------------- granite boulder
  buildBoulder() {
    let g = new THREE.IcosahedronGeometry(1, 64);
    g.deleteAttribute('normal'); g.deleteAttribute('uv');
    g = mergeVertices(g, 1e-5);
    const p = g.attributes.position, v = new THREE.Vector3();
    const R = rng(77);
    // fracture / exfoliation planes: everything beyond a plane is pushed back onto it (flat facets)
    const planes = [];
    for (let i = 0; i < 16; i++) {
      const n = new THREE.Vector3(R() - 0.5, (R() - 0.35) * 0.9, R() - 0.5).normalize();
      planes.push({ n, d: 0.62 + R() * 0.3 });
    }
    planes.push({ n: new THREE.Vector3(0, -1, 0), d: 0.35 }); // buried base
    const ao = new Float32Array(p.count);
    for (let i = 0; i < p.count; i++) {
      v.fromBufferAttribute(p, i);
      v.multiplyScalar(1 + (fbm3(v.x * 1.3 + 2, v.y * 1.3, v.z * 1.3, 4) - 0.5) * 0.35);
      for (const pl of planes) {
        const k = v.dot(pl.n) - pl.d;
        if (k > 0) v.addScaledVector(pl.n, -k * 0.85); // facets with softened (weathered) edges
      }
      // granular relief and rounded weathering on the facets
      v.multiplyScalar(1 + (fbm3(v.x * 9 + 5, v.y * 9, v.z * 9, 3) - 0.5) * 0.025);
      p.setXYZ(i, v.x * 1.35, v.y * 1.15, v.z * 1.1);
    }
    g.computeVertexNormals();
    // cavity AO from neighbour normal divergence (cheap curvature)
    const nrm = g.attributes.normal, idx = g.index.array, acc = new Float32Array(p.count), cnt = new Float32Array(p.count);
    const a = new THREE.Vector3(), b = new THREE.Vector3(), na = new THREE.Vector3(), nb = new THREE.Vector3();
    for (let t = 0; t < idx.length; t += 3) for (let k = 0; k < 3; k++) {
      const i0 = idx[t + k], i1 = idx[t + (k + 1) % 3];
      a.fromBufferAttribute(p, i0); b.fromBufferAttribute(p, i1); na.fromBufferAttribute(nrm, i0); nb.fromBufferAttribute(nrm, i1);
      const d = b.clone().sub(a); const conc = d.dot(nb.clone().sub(na)) / Math.max(1e-6, d.lengthSq());
      acc[i0] += conc; cnt[i0]++; acc[i1] += conc; cnt[i1]++; // symmetric for both ends
    }
    for (let i = 0; i < p.count; i++) ao[i] = Math.min(1, Math.max(0.35, 1 + (acc[i] / Math.max(1, cnt[i])) * 0.35));
    g.setAttribute('aAO', new THREE.BufferAttribute(ao, 1));
    const mat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.85 });
    mat.onBeforeCompile = (sh) => {
      sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nattribute float aAO; varying vec3 vP; varying vec3 vN2; varying float vAO;')
        .replace('#include <begin_vertex>', '#include <begin_vertex>\nvP = position; vN2 = normal; vAO = aAO;');
      sh.fragmentShader = sh.fragmentShader.replace('#include <common>', `#include <common>
        varying vec3 vP; varying vec3 vN2; varying float vAO;
        float h3(vec3 p){ return fract(sin(dot(p, vec3(127.1,311.7,74.7))) * 43758.5453); }
        float n3(vec3 p){ vec3 i=floor(p), f=fract(p); vec3 u=f*f*(3.0-2.0*f);
          return mix(mix(mix(h3(i),h3(i+vec3(1,0,0)),u.x), mix(h3(i+vec3(0,1,0)),h3(i+vec3(1,1,0)),u.x),u.y),
                     mix(mix(h3(i+vec3(0,0,1)),h3(i+vec3(1,0,1)),u.x), mix(h3(i+vec3(0,1,1)),h3(i+vec3(1,1,1)),u.x),u.y), u.z); }
        float fb3(vec3 p){ float s=0.0,a=0.5; for(int i=0;i<4;i++){ s+=a*n3(p); p*=2.03; a*=0.5;} return s; }`)
        .replace('#include <color_fragment>', `#include <color_fragment>
        {
          // coarse-grained granite: grey matrix, black biotite, pink-white feldspar (mm grains, not spots)
          float grainB = n3(vP * 160.0), grainF = n3(vP * 120.0 + 3.0), m = fb3(vP * 4.0);
          vec3 c = mix(vec3(0.17,0.165,0.16), vec3(0.27,0.255,0.24), m);
          c = mix(c, vec3(0.07,0.07,0.07), smoothstep(0.7, 0.8, grainB) * 0.8);
          c = mix(c, vec3(0.50,0.45,0.42), smoothstep(0.72, 0.82, grainF) * 0.6);
          // weathering: rain streaks down the faces and dark water staining near the ground
          float streak = fb3(vec3(vP.x * 12.0, vP.y * 1.5, vP.z * 12.0));
          c *= 0.85 + 0.25 * streak;
          c *= mix(0.6, 1.0, smoothstep(-0.3, 0.1, vP.y));
          // lichen crust on the upper surfaces: grey-green foliose patches + yellow crustose spots
          float up = vN2.y;
          float lich = smoothstep(0.66, 0.76, fb3(vP * 7.0 + 11.0) + up * 0.15);
          c = mix(c, vec3(0.30,0.31,0.26) * (0.8 + 0.4 * n3(vP * 60.0)), lich * smoothstep(0.2, 0.6, up) * 0.6);
          float yel = smoothstep(0.8, 0.86, fb3(vP * 14.0 + 23.0));
          c = mix(c, vec3(0.55,0.46,0.16), yel * 0.6 * smoothstep(-0.2, 0.4, up));
          diffuseColor.rgb = c * vAO;
        }`)
        .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\nroughnessFactor = 0.78 + 0.18 * n3(vP*40.0);');
    };
    const m = this.boulder = new THREE.Mesh(g, mat);
    m.position.set(-2.3, terrainHeight(-2.3, -2.2) - 0.05, -2.2);
    m.rotation.y = 0.6;
    m.scale.setScalar(0.9);
    m.castShadow = true; m.receiveShadow = true;
    this.scene.add(m);
  }

  // ---------------------------------------------------------------- driftwood
  buildDriftwood() {
    const mat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.9 });
    mat.onBeforeCompile = (sh) => {
      sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying vec2 vUv2; attribute float aLen;  varying float vLen;')
        .replace('#include <begin_vertex>', '#include <begin_vertex>\nvUv2 = uv; vLen = aLen;');
      sh.fragmentShader = sh.fragmentShader.replace('#include <common>', `#include <common>
        varying vec2 vUv2; varying float vLen;
        float h2(vec2 p){ return fract(sin(dot(p, vec2(127.1,311.7))) * 43758.5453); }
        float n2(vec2 p){ vec2 i=floor(p), f=fract(p); vec2 u=f*f*(3.0-2.0*f);
          return mix(mix(h2(i),h2(i+vec2(1,0)),u.x), mix(h2(i+vec2(0,1)),h2(i+vec2(1,1)),u.x), u.y); }
        vec3 dwN = vec3(0.0);`)
        .replace('#include <color_fragment>', `#include <color_fragment>
        {
          // sun-bleached, sand-blasted wood: silver-grey with deep grain grooves running along the log
          vec2 g = vec2(vUv2.x * vLen * 3.0, vUv2.y * 46.0);
          float fib = n2(vec2(g.x * 0.6, g.y)) * 0.6 + n2(vec2(g.x * 2.0, g.y * 2.3)) * 0.4;
          float groove = smoothstep(0.25, 0.05, fib);
          float crack = smoothstep(0.03, 0.0, abs(n2(vec2(g.x * 0.15, g.y * 0.25)) - 0.5)) ;
          vec3 c = mix(vec3(0.46,0.44,0.40), vec3(0.62,0.60,0.56), n2(g * vec2(0.2, 0.5)));
          c *= 1.0 - 0.45 * groove - 0.5 * crack;
          c = mix(c, c * vec3(0.75,0.68,0.58), smoothstep(0.6, 0.9, n2(vec2(g.x * 0.08, vUv2.y * 3.0)))); // tannin stain
          diffuseColor.rgb = c;
        }`);
    };
    const R = rng(909);
    const logs = [
      { p: [3.6, -3.6], yaw: 0.35, len: 4.2, r: 0.17 },
      { p: [-5.5, -5.5], yaw: -0.25, len: 6.0, r: 0.24 },
      { p: [6.5, -6.6], yaw: 1.9, len: 2.6, r: 0.11 },
    ];
    for (const L of logs) {
      const pts = [];
      const N = 7;
      for (let i = 0; i <= N; i++) {
        const t = i / N - 0.5;
        const x = L.p[0] + Math.cos(L.yaw) * t * L.len, z = L.p[1] - Math.sin(L.yaw) * t * L.len;
        const bend = Math.sin(t * 3 + L.len) * 0.12;
        pts.push(new THREE.Vector3(x + Math.sin(L.yaw) * bend, terrainHeight(x, z) + L.r * 0.55, z + Math.cos(L.yaw) * bend));
      }
      const curve = new THREE.CatmullRomCurve3(pts);
      const g = new THREE.TubeGeometry(curve, 90, 1, 28, false);
      // taper, knots, twisted fluting, broken ends
      const pp = g.attributes.position, nn = g.attributes.normal, uv = g.attributes.uv;
      const ctr = new THREE.Vector3(), v = new THREE.Vector3(), n = new THREE.Vector3();
      for (let i = 0; i < pp.count; i++) {
        const u = uv.getX(i), a = uv.getY(i) * Math.PI * 2;
        curve.getPointAt(u, ctr);
        v.fromBufferAttribute(pp, i); n.fromBufferAttribute(nn, i);
        let r = L.r * lerp(1.12, 0.62, u) * (1 + 0.08 * Math.sin(a * 5 + u * 9) + (vnoise(u * 30, a * 2) - 0.5) * 0.12);
        const endS = Math.min(u, 1 - u) * L.len; r *= ss(0, 0.12, endS) * 0.55 + 0.45; // splintered taper at the ends
        v.copy(ctr).addScaledVector(n, r);
        pp.setXYZ(i, v.x, v.y, v.z);
      }
      g.computeVertexNormals();
      g.setAttribute('aLen', new THREE.Float32BufferAttribute(new Float32Array(pp.count).fill(L.len), 1));
      const mesh = new THREE.Mesh(g, mat);
      mesh.castShadow = true; mesh.receiveShadow = true;
      this.scene.add(mesh);
      void R;
    }
  }

  // ---------------------------------------------------------------- forest
  sprayTexture() {
    // A spruce branch-spray seen from 10–100 m: a dense, ragged-edged mass of needles hanging from a
    // drooping twig (dark interior, lighter new growth on the outer tips). Mostly opaque so a crown
    // built from these reads as a solid conifer, not as separate fronds.
    const W = 256, H = 256, c = document.createElement('canvas'); c.width = W; c.height = H;
    const g = c.getContext('2d');
    const R = rng(31);
    g.clearRect(0, 0, W, H);
    g.lineCap = 'round';
    // envelope: a teardrop hanging from the top centre
    const inside = (x, y) => { const v = y / H; const hw = W * 0.48 * Math.sin(Math.PI * Math.min(1, v * 1.05)) ** 0.7; return Math.abs(x - W / 2) < hw * (0.75 + 0.25 * R()); };
    // 1) dark core twigs
    for (let k = 0; k < 2600; k++) {
      const x = R() * W, y = R() * H;
      if (!inside(x, y)) continue;
      const v = y / H, edge = Math.abs(x - W / 2) / (W * 0.48);
      const a = Math.PI / 2 + (x < W / 2 ? 0.6 : -0.6) * (0.4 + R() * 0.8);
      const l = 4 + R() * 7;
      const lum = 22 + R() * 26 + edge * 22 + v * 10;
      g.strokeStyle = `rgb(${(lum * 0.48) | 0},${(lum * 0.86) | 0},${(lum * 0.6) | 0})`;
      g.lineWidth = 1.4 + R();
      g.beginPath(); g.moveTo(x, y); g.lineTo(x + Math.cos(a) * l, y + Math.sin(a) * l); g.stroke();
    }
    // 2) lighter needle tips around the rim (current-year growth)
    for (let k = 0; k < 900; k++) {
      const x = R() * W, y = R() * H;
      if (!inside(x, y)) continue;
      const edge = Math.abs(x - W / 2) / (W * 0.48);
      if (edge < 0.55 && R() < 0.8) continue;
      const a = Math.PI / 2 + (x < W / 2 ? 0.9 : -0.9) * (0.3 + R() * 0.8);
      const l = 3 + R() * 5;
      const lum = 60 + R() * 40;
      g.strokeStyle = `rgb(${(lum * 0.55) | 0},${(lum * 0.9) | 0},${(lum * 0.55) | 0})`;
      g.lineWidth = 1.1;
      g.beginPath(); g.moveTo(x, y); g.lineTo(x + Math.cos(a) * l, y + Math.sin(a) * l); g.stroke();
    }
    // 3) the twig itself
    g.strokeStyle = 'rgb(48,34,24)'; g.lineWidth = 3;
    g.beginPath(); g.moveTo(W / 2, 0); g.quadraticCurveTo(W / 2 + 6, H * 0.5, W / 2 - 4, H * 0.85); g.stroke();
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8;
    return t;
  }

  // unit-height conifer: tapered trunk + clumps of needle sprays on a narrow conical crown
  coniferGeometry({ clumps, cross, seed, grow = 1 }) {
    const pos = [], nrm = [], uv = [], col = [], idx = [];
    const R = rng(seed);
    const vtx = (x, y, z, nx, ny, nz, u, v, c) => { pos.push(x, y, z); nrm.push(nx, ny, nz); uv.push(u, v); col.push(c, c * 1.0, c * 0.98); return pos.length / 3 - 1; };
    const TS = 8;
    for (let j = 0; j <= 1; j++) for (let i = 0; i <= TS; i++) {
      const a = i / TS * Math.PI * 2, y = j ? 0.95 : -0.02, r = j ? 0.002 : 0.014;
      vtx(Math.cos(a) * r, y, Math.sin(a) * r, Math.cos(a), 0, Math.sin(a), 0.5, 0.97, 0.25);
    }
    for (let i = 0; i < TS; i++) idx.push(i, i + TS + 1, i + 1, i + 1, i + TS + 1, i + TS + 2);
    const crownR = (y) => 0.19 * Math.pow(Math.max(0, 1 - y), 0.95) + 0.006;
    const up = new THREE.Vector3(), out = new THREE.Vector3(), side = new THREE.Vector3(), dn = new THREE.Vector3(), cN = new THREE.Vector3();
    for (let k = 0; k < clumps; k++) {
      const y = 0.03 + 0.95 * Math.pow(R(), 0.75);
      const Rc = crownR(y);
      const az = R() * Math.PI * 2;
      const rad = Rc * (0.45 + 0.55 * Math.sqrt(R()));
      const cx = Math.cos(az) * rad, cz = Math.sin(az) * rad;
      const s = grow * (0.026 + 0.026 * (1 - y)) * (0.8 + 0.4 * R()); // ≈0.8–1.6 m sprays on a 30 m tree
      out.set(Math.cos(az), 0, Math.sin(az));
      // the spray hangs from its twig: "down" along the card droops outward and down
      dn.set(Math.cos(az) * 0.55, -0.85, Math.sin(az) * 0.55).normalize();
      for (let cc = 0; cc < cross; cc++) {
        const rot = (R() - 0.5) * 1.2 + cc * Math.PI / 2;
        side.crossVectors(dn, out).normalize().applyAxisAngle(dn, rot);
        const ao = 0.4 + 0.6 * Math.min(1, (rad / Rc) * 0.8 + y * 0.35);
        // canopy normal: from the crown axis (at this height) outward + up → soft volumetric shading
        cN.set(cx, (y - 0.45) * 0.35 + 0.25, cz).normalize();
        const top = new THREE.Vector3(cx, y, cz).addScaledVector(dn, -s * 0.15);
        const i0 = pos.length / 3;
        for (const [a, b] of [[-1, 0], [1, 0], [-1, 1], [1, 1]]) {
          const P = top.clone().addScaledVector(side, a * s * 0.5).addScaledVector(dn, b * s);
          vtx(P.x, P.y, P.z, cN.x, cN.y, cN.z, (a + 1) / 2, 1 - b, ao * (b ? 1.0 : 0.85));
        }
        idx.push(i0, i0 + 2, i0 + 1, i0 + 1, i0 + 2, i0 + 3);
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    g.setIndex(idx);
    void up;
    return g;
  }

  buildForest() {
    const map = this.sprayTexture();
    const mat = new THREE.MeshStandardMaterial({ vertexColors: true, map, roughness: 0.88, side: THREE.DoubleSide, alphaTest: 0.35, alphaToCoverage: true });
    mat.onBeforeCompile = (sh) => {
      // keep foliage coverage at distance (sharpen the mip-averaged alpha) + a little light transmission
      sh.fragmentShader = sh.fragmentShader
        .replace('#include <alphatest_fragment>', 'diffuseColor.a = clamp((diffuseColor.a - 0.35) / max(fwidth(diffuseColor.a), 1e-4) + 0.5, 0.0, 1.0);\n#include <alphatest_fragment>');
    };
    const lods = [
      { geo: this.coniferGeometry({ clumps: 1100, cross: 2, seed: 11 }), max: 320, rMax: 130 },
      // lower LODs keep the same crown coverage with fewer, proportionally larger sprays
      { geo: this.coniferGeometry({ clumps: 420, cross: 1, seed: 12, grow: 2.0 }), max: 2600, rMax: 420 },
      { geo: this.coniferGeometry({ clumps: 120, cross: 1, seed: 13, grow: 3.6 }), max: 9000, rMax: 1e9 },
    ];
    for (const L of lods) { L.inst = new THREE.InstancedMesh(L.geo, mat, L.max); L.n = 0; }
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(), p = new THREE.Vector3(), c = new THREE.Color();
    const R = rng(9);
    for (let tries = 0; tries < 300000 && lods.some((L) => L.n < L.max); tries++) {
      const r = 26 + Math.pow(R(), 0.9) * 1100, a = R() * Math.PI * 2;
      const x = Math.cos(a) * r, z = Math.sin(a) * r;
      const dw = shoreDist(x, z);
      if (dw < 16 + fbm(x * 0.05, z * 0.05, 2) * 14) continue;
      const h = terrainHeight(x, z);
      if (h > 290) continue;
      if (fbm(x * 0.008, z * 0.008, 3) < 0.4 && dw > 60) continue; // clearings / meadows
      const L = lods.find((l) => r < l.rMax);
      if (L.n >= L.max) continue;
      const height = 18 + R() * 26; // Sitka spruce / hemlock stands are 20–50 m tall
      p.set(x, h - 0.3, z);
      q.setFromEuler(new THREE.Euler((R() - 0.5) * 0.04, R() * 6.28, (R() - 0.5) * 0.04));
      s.set(height * (0.85 + 0.3 * R()), height, height * (0.85 + 0.3 * R()));
      m.compose(p, q, s);
      const tint = R();
      if (tint < 0.55) c.setRGB(0.78 + 0.1 * R(), 0.95 + 0.1 * R(), 0.82 + 0.1 * R());
      else if (tint < 0.92) c.setRGB(0.95 + 0.1 * R(), 1.0, 0.75 + 0.1 * R());
      else c.setRGB(0.9, 0.95, 0.78);
      L.inst.setMatrixAt(L.n, m); L.inst.setColorAt(L.n++, c);
    }
    for (const L of lods) { L.inst.count = L.n; L.inst.castShadow = false; L.inst.receiveShadow = true; this.scene.add(L.inst); }
  }
  // ---------------------------------------------------------------- water
  waterNormals() {
    // tileable multi-octave height field → normal map (small wind ripples)
    const S = 512, c = document.createElement('canvas'); c.width = c.height = S;
    const gx = c.getContext('2d'), img = gx.createImageData(S, S);
    const h = new Float32Array(S * S);
    for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
      let v = 0, a = 1, f = 1 / 64;
      for (let o = 0; o < 6; o++) {
        const px = x * f, py = y * f, per = Math.round(S * f);
        const xi = Math.floor(px), yi = Math.floor(py), xf = px - xi, yf = py - yi;
        const hh = (i, j) => hash(((i % per) + per) % per + o * 31, ((j % per) + per) % per + o * 17);
        const u = xf * xf * (3 - 2 * xf), w = yf * yf * (3 - 2 * yf);
        v += a * (hh(xi, yi) * (1 - u) * (1 - w) + hh(xi + 1, yi) * u * (1 - w) + hh(xi, yi + 1) * (1 - u) * w + hh(xi + 1, yi + 1) * u * w);
        a *= 0.55; f *= 2;
      }
      h[y * S + x] = v;
    }
    for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
      const dx = h[y * S + (x + 1) % S] - h[y * S + (x - 1 + S) % S], dy = h[((y + 1) % S) * S + x] - h[((y - 1 + S) % S) * S + x];
      const n = new THREE.Vector3(-dx * 6, -dy * 6, 1).normalize(), o = (y * S + x) * 4;
      img.data[o] = (n.x * 0.5 + 0.5) * 255; img.data[o + 1] = (n.y * 0.5 + 0.5) * 255; img.data[o + 2] = (n.z * 0.5 + 0.5) * 255; img.data[o + 3] = 255;
    }
    gx.putImageData(img, 0, 0);
    const t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping;
    return t;
  }

  buildWater(renderer) {
    const g = new THREE.CircleGeometry(LAKE.radius * 1.6, 128);
    g.scale(1, 1 / 1.3, 1);
    const water = this.water = new Water(g, {
      textureWidth: 1024, textureHeight: 1024,
      waterNormals: this.waterNormals(),
      sunDirection: this.sunDir.clone(),
      sunColor: 0xfff2dc,
      waterColor: 0x0b2229,
      distortionScale: 1.1,
      fog: true,
    });
    water.material.uniforms.size.value = 7.0;
    water.rotation.x = -Math.PI / 2;
    water.position.set(LAKE.center.x, LAKE.level, LAKE.center.y);
    this.scene.add(water);
    void renderer;
  }

  buildLights() {
    const sun = this.sun = new THREE.DirectionalLight(0xfff0d8, 3.3);
    sun.castShadow = true;
    sun.shadow.mapSize.set(4096, 4096);
    const S = 4;
    Object.assign(sun.shadow.camera, { left: -S, right: S, top: S, bottom: -S, near: 1, far: 80 });
    sun.shadow.bias = -0.00012; sun.shadow.normalBias = 0.01; sun.shadow.radius = 1.5;
    this.scene.add(sun, sun.target);
    const hemi = this.hemi = new THREE.HemisphereLight(0xc4d6ee, 0x4a4234, 0.3);
    this.scene.add(hemi);
  }

  // keep the shadow frustum centred on the subject (tight → crisp feather shadows)
  follow(p) {
    this.sun.target.position.copy(p);
    this.sun.position.copy(p).addScaledVector(this.sunDir, 40);
    this.sun.target.updateMatrixWorld();
  }

  update(dt) {
    this.time += dt;
    this.water.material.uniforms.time.value = this.time * 0.6;
  }

  async buildEnvironment(renderer) {
    // IBL: sky + a dark-green/grey ground bounce (forest and shore below the horizon)
    const pmrem = new THREE.PMREMGenerator(renderer);
    const skyScene = new THREE.Scene();
    const sky2 = new Sky(); sky2.scale.setScalar(10000);
    for (const k of Object.keys(this.sky.material.uniforms)) sky2.material.uniforms[k].value = this.sky.material.uniforms[k].value;
    skyScene.add(sky2);
    const gd = new THREE.Mesh(new THREE.CircleGeometry(5000, 32).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: new THREE.Color().setRGB(0.11, 0.11, 0.085) }));
    gd.position.y = -10; skyScene.add(gd);
    const rt = pmrem.fromScene(skyScene, 0, 0.1, 20000, { size: 256, position: new THREE.Vector3(0, 0, 0) });
    this.scene.environment = rt.texture;
    this.scene.environmentIntensity = 0.6;
    pmrem.dispose();
  }
}
