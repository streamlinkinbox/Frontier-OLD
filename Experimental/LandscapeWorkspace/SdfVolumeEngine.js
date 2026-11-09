/*==========================================================================================================================================
                                                             SDFVOLUMEENGINE.JS
==========================================================================================================================================*/
// One global TEXTURE_3D SDF (R16F + R8, zero LOD) shared by every layer, sphere-traced and sculpted
// in place, composited with a clean analytic sea plane. Resolution and world bounds belong to the
// single field: hiding a layer removes its contribution, it never resamples the volume.

import { PackGpuWorld } from './DomainModel.js';

export function CreateSdfVolumeEngine(canvas, callbacks = {}) {
    const gl = canvas.getContext('webgl2', {
        alpha: false,
        antialias: true,
        powerPreference: 'high-performance',
        preserveDrawingBuffer: false
    });
    if (!gl) throw new Error('WebGL 2 is required for 3D SDF Landscape Studio');

    const extFloat = gl.getExtension('EXT_color_buffer_float');
    const extHalf = gl.getExtension('EXT_color_buffer_half_float');
    if (!extFloat && !extHalf) throw new Error('EXT_color_buffer_float / half_float is required');
    gl.getExtension('OES_texture_float_linear');
    gl.getExtension('OES_texture_half_float_linear');

    const MAX_3D_SIZE = gl.getParameter(gl.MAX_3D_TEXTURE_SIZE) || 256;
    const GPU_RENDERER = (() => {
        const dbg = gl.getExtension('WEBGL_debug_renderer_info');
        return dbg ? gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER);
    })();

    // ---------- Shader Helpers ----------
    function compileShader(type, src) {
        const sh = gl.createShader(type);
        gl.shaderSource(sh, src);
        gl.compileShader(sh);
        if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
            const log = gl.getShaderInfoLog(sh) || 'Shader compile failed';
            gl.deleteShader(sh);
            throw new Error(log);
        }
        return sh;
    }

    function linkProgram(vsSrc, fsSrc) {
        const vs = compileShader(gl.VERTEX_SHADER, vsSrc);
        const fs = compileShader(gl.FRAGMENT_SHADER, fsSrc);
        const prog = gl.createProgram();
        gl.attachShader(prog, vs);
        gl.attachShader(prog, fs);
        gl.linkProgram(prog);
        gl.deleteShader(vs);
        gl.deleteShader(fs);
        if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
            const log = gl.getProgramInfoLog(prog) || 'Program link failed';
            gl.deleteProgram(prog);
            throw new Error(log);
        }
        return prog;
    }

    // ---------- Shared GLSL Modules ----------
    const GLSL_NOISE_AND_SKY = `
      float hash21(vec2 p) {
        p = fract(p * vec2(123.34, 456.21));
        p += dot(p, p + 45.32);
        return fract(p.x * p.y);
      }
      float noise2(vec2 p) {
        vec2 i = floor(p), f = fract(p);
        vec2 u = f * f * (3.0 - 2.0 * f);
        return mix(mix(hash21(i), hash21(i + vec2(1, 0)), u.x),
                   mix(hash21(i + vec2(0, 1)), hash21(i + vec2(1, 1)), u.x), u.y);
      }
      float fbm2(vec2 p) {
        float v = 0.0, a = 0.5;
        mat2 m = mat2(0.8, 0.6, -0.6, 0.8);
        for (int i = 0; i < 4; ++i) { v += a * noise2(p); p = m * p * 2.03 + 17.1; a *= 0.5; }
        return v;
      }
      float hash31(vec3 p) {
        p = fract(p * vec3(443.8975, 397.2973, 491.1871));
        p += dot(p, p.yxz + 19.19);
        return fract((p.x + p.y) * p.z);
      }
      float noise3(vec3 p) {
        vec3 i = floor(p), f = fract(p);
        vec3 u = f * f * (3.0 - 2.0 * f);
        return mix(
          mix(mix(hash31(i), hash31(i + vec3(1,0,0)), u.x),
              mix(hash31(i + vec3(0,1,0)), hash31(i + vec3(1,1,0)), u.x), u.y),
          mix(mix(hash31(i + vec3(0,0,1)), hash31(i + vec3(1,0,1)), u.x),
              mix(hash31(i + vec3(0,1,1)), hash31(i + vec3(1,1,1)), u.x), u.y),
          u.z);
      }
      float fbm3(vec3 p) {
        float v = 0.0, a = 0.5;
        for (int i = 0; i < 3; ++i) { v += a * noise3(p); p = p * 2.07 + 7.3; a *= 0.5; }
        return v;
      }
      vec3 evaluateSky(vec3 dir, vec3 sunDir, float timeSec) {
        vec3 d = normalize(dir);
        float y = max(d.y, 0.0);
        float sunElev = clamp(sunDir.y, -0.1, 1.0);
        vec3 zenith = mix(vec3(0.05, 0.11, 0.24), vec3(0.07, 0.26, 0.56), smoothstep(0.0, 0.55, sunElev));
        vec3 horizon = mix(vec3(0.64, 0.42, 0.28), vec3(0.45, 0.68, 0.84), smoothstep(0.02, 0.45, sunElev));
        vec3 sky = mix(horizon, zenith, pow(y, 0.48));
        float mu = max(dot(d, normalize(sunDir)), 0.0);
        vec3 mieCol = mix(vec3(1.0, 0.48, 0.20), vec3(1.0, 0.92, 0.78), smoothstep(0.05, 0.45, sunElev));
        sky += mieCol * (0.28 * pow(mu, 10.0) + 1.8 * pow(mu, 180.0));
        sky += vec3(1.0, 0.97, 0.90) * 14.0 * smoothstep(0.99935, 0.99985, mu);
        if (d.y > 0.02) {
          vec2 clUv = d.xz / (d.y + 0.18) * 1.45 + vec2(timeSec * 0.008, timeSec * 0.004);
          float cl = smoothstep(0.54, 0.84, fbm2(clUv * 1.55));
          float fade = smoothstep(0.02, 0.28, d.y);
          vec3 clCol = mix(vec3(0.64, 0.70, 0.80), vec3(1.02, 0.99, 0.94), 0.35 + 0.65 * pow(mu, 2.0));
          sky = mix(sky, clCol, cl * fade * 0.32);
        }
        if (d.y < 0.0) {
          sky = mix(horizon * 0.42, vec3(0.015, 0.07, 0.13), clamp(-d.y * 4.0, 0.0, 1.0));
        }
        return sky;
      }`;

    const GLSL_SDF_EVAL = `
      uniform sampler2D uStrokeTex;
      uniform sampler2D uRegionTex;
      uniform sampler2D uPrimTex;
      uniform sampler2D uSculptTex;

      float Lattice(ivec3 P, uint Seed) {
        uint B = uint(P.x) * 374761393u ^ uint(P.y) * 668265263u ^ uint(P.z) * 2147483647u ^ Seed;
        B = (B ^ (B >> 13u)) * 1274126177u;
        return float(B ^ (B >> 16u)) / 4294967295.0;
      }
      float LatticeNoise(vec3 P, uint Seed) {
        ivec3 I = ivec3(floor(P));
        vec3 U = fract(P);
        U = U * U * (3.0 - 2.0 * U);
        float S = 0.0;
        for (int Z = 0; Z < 2; ++Z)
          for (int Y = 0; Y < 2; ++Y)
            for (int X = 0; X < 2; ++X)
              S += Lattice(I + ivec3(X, Y, Z), Seed) *
                   (X == 1 ? U.x : 1.0 - U.x) *
                   (Y == 1 ? U.y : 1.0 - U.y) *
                   (Z == 1 ? U.z : 1.0 - U.z);
        return S;
      }
      float TerrainNoise(vec3 P, int Category, uint Seed, float Roughness) {
        float Sum = 0.0, Weight = 1.0, Normalization = 0.0, Product = 1.0;
        float Persistence = 0.35 + Roughness * 0.3;
        for (int O = 0; O < 4; ++O) {
          float N = LatticeNoise(P, Seed + uint(O) * 1013u);
          float R = 1.0 - abs(N * 2.0 - 1.0);
          float C = N;
          if (Category == 8 || Category == 9 || Category == 10 || Category == 11) C = R * R;
          if (Category == 9) C *= C;
          if (Category == 10) return R;
          Sum += C * Weight;
          Normalization += Weight;
          Product *= 1.0 + (C - 0.5) * Weight;
          P = P * 2.03 + vec3(17.1, -9.2, 5.7);
          Weight *= Persistence;
        }
        if (Category == 7 || Category == 8) return clamp((Product - 0.25) / 2.25, 0.0, 1.0);
        if (Category == 12) {
          float Warp = LatticeNoise(P * 0.03, Seed);
          return 0.5 + 0.5 * sin(P.x * 0.12 + Warp * 2.0 + P.y * 0.035) * (0.65 + 0.35 * Sum / Normalization);
        }
        return Sum / Normalization;
      }
      float TerrainProfile(vec3 Q, float Frequency, float VerticalFrequency, int Category, uint Seed, float Roughness) {
        Q *= vec3(Frequency, VerticalFrequency, Frequency);
        int Code = Category - 20;
        if (Code == 15) {
          vec2 R = fract(Q.xz + vec2(float(Seed % 997u) * 0.013, float(Seed % 991u) * 0.017)) - 0.5;
          float T = max(0.0, 1.0 - (dot(R, R) + Q.y * Q.y * 0.01) / 0.16);
          return T * T;
        }
        float N = TerrainNoise(Q, Code > 12 ? 6 : Code, Seed, Roughness);
        if (Code == 13) { float T = clamp((N - 0.25) * 2.0, 0.0, 1.0); return T * T * (3.0 - 2.0 * T); }
        if (Code == 14) return 0.5 + 0.3 * sin(Q.x * 0.5) + 0.2 * N;
        return N;
      }
      float SmoothUnion(float A, float B, float K) {
        if (K <= 0.0) return min(A, B);
        float H = max(K - abs(A - B), 0.0) / K;
        return min(A, B) - H * H * K * 0.25;
      }
      float SmoothIntersection(float A, float B, float K) { return -SmoothUnion(-A, -B, K); }
      float CombineDistance(float D, float F, int Mode, float K) {
        if (Mode == 1) return SmoothIntersection(D, -F, K);
        if (Mode == 2) return SmoothIntersection(D, F, K);
        if (Mode == 3) return (D + F) * 0.5;
        return SmoothUnion(D, F, K);
      }
      float RadialWeight(vec3 P, vec4 A, vec4 B, vec4 E) {
        float T = clamp((B.x - length(P.xz - A.xz)) / (B.x * B.z), 0.0, 1.0);
        return E.w * T * T * (3.0 - 2.0 * T);
      }
      float CoastWeight(float Planar, float Width) {
        if (Width <= 0.0) return Planar <= 0.0 ? 1.0 : 0.0;
        float Fr = clamp(-Planar / Width, 0.0, 1.0);
        return Fr * Fr * (3.0 - 2.0 * Fr);
      }
      float PrimitiveDistance(vec3 P, int Index) {
        vec4 A = texelFetch(uPrimTex, ivec2(Index, 0), 0);
        vec4 B = texelFetch(uPrimTex, ivec2(Index, 1), 0);
        vec4 C = texelFetch(uPrimTex, ivec2(Index, 2), 0);
        vec4 E = texelFetch(uPrimTex, ivec2(Index, 3), 0);
        vec3 Q = P - A.xyz;
        Q.xz = vec2(Q.x * C.x + Q.z * C.y, -Q.x * C.y + Q.z * C.x);
        int Cat = int(A.w + 0.5);
        if (Cat >= 26) {
          float vf = texelFetch(uPrimTex, ivec2(Index, 4), 0).x;
          return (Q.y - B.y * TerrainProfile(Q, B.w, vf, Cat, uint(E.z), E.y));
        }
        float Freq = 2.0 / max(min(B.x, min(B.y, B.z)), 0.001);
        float First = sin(Q.x * Freq + E.z) * sin(Q.z * Freq - E.z) * sin(Q.y * Freq * 0.7 + E.z);
        float Second = sin(Q.x * Freq * 2.0 - E.z) * sin(Q.z * Freq * 2.0 + E.z) * sin(Q.y * Freq * 1.4);
        Q.y += E.y * (First + Second * 0.35);
        float Bound = 1.0 + E.y * Freq * sqrt(2.49) * 1.7;
        if (Cat == 0) return (length(Q / B.xyz) - 1.0) * min(B.x, min(B.y, B.z)) / Bound;
        if (Cat == 1) {
          vec3 R = abs(Q) - B.xyz;
          return (length(max(R, 0.0)) + min(max(R.x, max(R.y, R.z)), 0.0) - B.w) / Bound;
        }
        if (Cat == 2) {
          float Rad = length(Q.xz / B.xz);
          float Cone = (Rad + Q.y / B.y - 1.0) / length(vec2(1.0 / min(B.x, B.z), 1.0 / B.y));
          return max(Cone, -Q.y - B.y) / Bound;
        }
        if (Cat == 5) {
          float SX = B.y / B.x, SZ = B.y / B.z;
          return max(max((abs(Q.x) * SX + Q.y - B.y) / length(vec2(SX, 1.0)),
                         (abs(Q.z) * SZ + Q.y - B.y) / length(vec2(SZ, 1.0))), -Q.y - B.y) / Bound;
        }
        if (Cat == 3) return (length(vec2(length(Q.xy) - B.x, Q.z)) - B.z) / Bound;
        return (length(Q - vec3(clamp(Q.x, -B.x, B.x), 0.0, 0.0)) - B.y) / Bound;
      }
      float Capsule2D(vec2 P, vec2 A, vec2 B, float R) {
        vec2 AB = B - A;
        float t = clamp(dot(P - A, AB) / max(dot(AB, AB), 1e-6), 0.0, 1.0);
        return length(P - A - AB * t) - R;
      }
      float Capsule3D(vec3 P, vec3 A, vec3 B, float R) {
        vec3 AB = B - A;
        float t = clamp(dot(P - A, AB) / max(dot(AB, AB), 1e-6), 0.0, 1.0);
        return length(P - A - AB * t) - R;
      }
      float RectDist2D(vec2 P, vec2 BMin, vec2 BMax) {
        vec2 center = 0.5 * (BMin + BMax);
        vec2 halfE = 0.5 * (BMax - BMin);
        vec2 d = abs(P - center) - halfE;
        return length(max(d, 0.0)) + min(max(d.x, d.y), 0.0);
      }
      float EvalMaskDistance(vec2 xz, int segStart, int segCount) {
        float dist = 1e8;
        float strokeDist = 1e8;
        float prevId = -1.0;
        float prevErase = 0.0;
        for (int i = 0; i < 512; ++i) {
          if (i >= segCount) break;
          int idx = segStart + i;
          vec4 ab = texelFetch(uStrokeTex, ivec2(idx, 0), 0);
          vec4 meta = texelFetch(uStrokeTex, ivec2(idx, 1), 0);
          float d = Capsule2D(xz, ab.xy, ab.zw, meta.x);
          if (prevId < -0.5) {
            prevId = meta.z;
            prevErase = meta.y;
            strokeDist = d;
          } else if (abs(meta.z - prevId) > 0.25) {
            dist = (prevErase > 0.5) ? max(dist, -strokeDist) : min(dist, strokeDist);
            prevId = meta.z;
            prevErase = meta.y;
            strokeDist = d;
          } else {
            strokeDist = min(strokeDist, d);
          }
        }
        if (prevId > -0.5) {
          dist = (prevErase > 0.5) ? max(dist, -strokeDist) : min(dist, strokeDist);
        }
        return dist;
      }
      float EvalLayerSDF(vec3 P, int segStart, int segCount, int regStart, int regCount) {
        float maskD = EvalMaskDistance(P.xz, segStart, segCount);
        float layerDist = 1e8;
        for (int ri = 0; ri < 16; ++ri) {
          if (ri >= regCount) break;
          int rIdx = regStart + ri;
          vec4 r0 = texelFetch(uRegionTex, ivec2(rIdx, 0), 0);
          vec4 r1 = texelFetch(uRegionTex, ivec2(rIdx, 1), 0);
          vec4 r2 = texelFetch(uRegionTex, ivec2(rIdx, 2), 0);
          vec4 r3 = texelFetch(uRegionTex, ivec2(rIdx, 3), 0);
          float edge = r1.x;
          float depth = r1.y;
          bool terrainEn = r1.z > 0.5;
          float fieldBound = max(1.0, r1.w);
          float envSlope = max(1.0, r2.x);
          float envTop = r2.y;
          int primStart = int(r2.z + 0.5);
          int primCount = int(r2.w + 0.5);
          int sculptStart = int(r3.x + 0.5);
          int sculptCount = int(r3.y + 0.5);
          bool caves = r3.z > 0.5;

          float rad = min(edge, min((r0.z - r0.x) * 0.49, (r0.w - r0.y) * 0.49));
          float clipD = RectDist2D(P.xz, r0.xy + rad, r0.zw - rad) - rad;
          float planar = max(maskD, clipD);
          float vert = abs(P.y + depth * 0.5) - depth * 0.5;
          float regD = length(max(vec2(planar, vert), 0.0)) + min(max(planar, vert), 0.0);

          float D = terrainEn ? P.y : regD;
          float Envelope = envTop;
          float Feature = 1e8;
          for (int pi = 0; pi < 512; ++pi) {
            if (pi >= primCount) break;
            int pIdx = primStart + pi;
            vec4 A = texelFetch(uPrimTex, ivec2(pIdx, 0), 0);
            vec4 B = texelFetch(uPrimTex, ivec2(pIdx, 1), 0);
            vec4 C = texelFetch(uPrimTex, ivec2(pIdx, 2), 0);
            vec4 E = texelFetch(uPrimTex, ivec2(pIdx, 3), 0);
            int Cat = int(A.w + 0.5);
            if (Cat >= 26) {
              float W = RadialWeight(P, A, B, E) * CoastWeight(planar, edge);
              float Limit = B.y + C.w * 0.25;
              if (W > 0.0) {
                vec3 Q = P - A.xyz;
                Q.xz = vec2(Q.x * C.x + Q.z * C.y, -Q.x * C.y + Q.z * C.x);
                float vf = texelFetch(uPrimTex, ivec2(pIdx, 4), 0).x;
                float H = B.y * TerrainProfile(Q, B.w, vf, Cat, uint(E.z), E.y);
                float F = P.y - A.y + (int(C.z + 0.5) == 1 ? H : -H);
                float Cand = (int(C.z + 0.5) == 1 || int(C.z + 0.5) == 2)
                  ? SmoothIntersection(D, F, C.w)
                  : (int(C.z + 0.5) == 3 ? (D + F) * 0.5 : SmoothUnion(D, F, C.w));
                D += W * clamp(Cand - D, -Limit, Limit);
                Envelope += Limit * W;
              }
              continue;
            }
            Feature = min(Feature, PrimitiveDistance(P, pIdx));
            if (E.x > 0.5) {
              D = CombineDistance(D, Feature, int(C.z + 0.5), C.w);
              Feature = 1e8;
            }
          }
          if (terrainEn && sculptCount == 0) {
            D = max(D / fieldBound, (P.y - Envelope) / envSlope);
          }
          // Shore shaping. A bare max(D, planar) leaves a vertical cookie-cutter wall at the
          // mask boundary and a razor crease where the two fields cross, which trilinear
          // reconstruction turns into a sawtooth comb. Lean the cut inward with height,
          // widen it just below sea level for a sandy shelf, and round the crossing.
          float cutPlanar = planar * 0.96 + clamp(P.y, 0.0, 150.0) * 0.30;
          float shelfPlanar = (P.y < 0.0)
            ? cutPlanar * 0.92 + clamp(P.y, -34.0, 0.0) * 0.40
            : cutPlanar;
          float shoreK = max(6.0, edge * 0.32);
          D = SmoothIntersection(D, shelfPlanar, shoreK);
          for (int si = 0; si < 512; ++si) {
            if (si >= sculptCount) break;
            int sIdx = sculptStart + si;
            vec4 s0 = texelFetch(uSculptTex, ivec2(sIdx, 0), 0);
            vec4 s1 = texelFetch(uSculptTex, ivec2(sIdx, 1), 0);
            float br = Capsule3D(P, s0.xyz, s1.xyz, s0.w);
            float bl = s0.w * 0.22;
            D = (s1.w > 0.5) ? -SmoothUnion(-D, br, bl) : SmoothUnion(D, br, bl);
          }
          if (sculptCount > 0) {
            D = SmoothIntersection(D, shelfPlanar, max(6.0, edge * 0.32));
            if (terrainEn) D /= fieldBound;
          }
          D = max(D, -P.y - depth);
          if (caves && ri == 0) {
            vec2 rc = 0.5 * (r0.xy + r0.zw);
            float cav = length(P - vec3(rc.x, 0.0, rc.y)) - depth * 0.65;
            D = max(D, -cav);
          }
          layerDist = min(layerDist, D);
        }
        return layerDist;
      }`;

    const QUAD_VS = `#version 300 es
      precision highp float;
      layout(location = 0) in vec2 aPos;
      out vec2 vUv;
      void main() {
        vUv = aPos * 0.5 + 0.5;
        gl_Position = vec4(aPos, 0.0, 1.0);
      }`;

    // Pass A: Build / Combine one Layer's True 3D SDF into Slice Y
    const BUILD_LAYER_SLICE_FS = `#version 300 es
      precision highp float;
      in vec2 vUv;
      uniform sampler2D uPrevSdf;
      uniform sampler2D uPrevMat;
      uniform int uHasPrev;
      uniform int uLayerIdx;
      uniform int uSegStart;
      uniform int uSegCount;
      uniform int uRegStart;
      uniform int uRegCount;
      uniform vec3 uBoxMin;
      uniform vec3 uBoxMax;
      uniform float uSliceWorldY;
      uniform vec3 uLayerBBoxMin3;
      uniform vec3 uLayerBBoxMax3;
      layout(location = 0) out float outSdf;
      layout(location = 1) out float outMat;
      ${GLSL_SDF_EVAL}
      void main() {
        float prevSdf = (uHasPrev == 1) ? texture(uPrevSdf, vUv).r : 1200.0;
        float prevMat = (uHasPrev == 1) ? texture(uPrevMat, vUv).r : 1.0;
        vec3 P = vec3(
          mix(uBoxMin.x, uBoxMax.x, vUv.x),
          uSliceWorldY,
          mix(uBoxMin.z, uBoxMax.z, vUv.y)
        );
        vec3 boxGap = max(max(uLayerBBoxMin3 - P, P - uLayerBBoxMax3), vec3(0.0));
        if (dot(boxGap, boxGap) > 0.0) {
          // Shrink slightly: an over-estimated air distance lets the marcher step past thin ridges.
          float safeBoxD = max(length(boxGap) * 0.90, 0.75);
          if (safeBoxD < prevSdf) {
            outSdf = safeBoxD;
            outMat = float(uLayerIdx) / 255.0;
          } else {
            outSdf = prevSdf;
            outMat = prevMat;
          }
          return;
        }
        float d = EvalLayerSDF(P, uSegStart, uSegCount, uRegStart, uRegCount);
        d = clamp(d, -1200.0, 1200.0);
        if (d < prevSdf) {
          outSdf = d;
          outMat = float(uLayerIdx) / 255.0;
        } else {
          outSdf = prevSdf;
          outMat = prevMat;
        }
      }`;

    // Pass B: Rolling 3-Slice GPU 3D Sculpting (Clay, Carve, Smooth, Flatten)
    const SCULPT_SLICE_FS = `#version 300 es
      precision highp float;
      in vec2 vUv;
      uniform sampler2D uPrevSdf;
      uniform sampler2D uCurSdf;
      uniform sampler2D uNextSdf;
      uniform sampler2D uCurMat;
      uniform vec3 uBoxMin;
      uniform vec3 uBoxMax;
      uniform vec3 uInvDim;
      uniform float uSliceWorldY;
      uniform vec3 uSegA;
      uniform vec3 uSegB;
      uniform float uRadius;
      uniform float uStrength;
      uniform int uMode;
      uniform int uLayerIdx;
      uniform vec3 uFlatAnchor;
      uniform vec3 uFlatNormal;
      layout(location = 0) out float outSdf;
      layout(location = 1) out float outMat;

      float capDist3(vec3 p, vec3 a, vec3 b, float r) {
        vec3 ab = b - a;
        float t = clamp(dot(p - a, ab) / max(dot(ab, ab), 1e-6), 0.0, 1.0);
        return length(p - a - ab * t) - r;
      }
      float smin(float a, float b, float k) {
        float h = max(k - abs(a - b), 0.0) / max(k, 1e-4);
        return min(a, b) - h * h * k * 0.25;
      }
      void main() {
        float curD = texture(uCurSdf, vUv).r;
        float curM = texture(uCurMat, vUv).r;
        vec3 P = vec3(
          mix(uBoxMin.x, uBoxMax.x, vUv.x),
          uSliceWorldY,
          mix(uBoxMin.z, uBoxMax.z, vUv.y)
        );
        float rawB = capDist3(P, uSegA, uSegB, uRadius);
        if (rawB > uRadius * 0.45) {
          outSdf = curD;
          outMat = curM;
          return;
        }
        float outD = curD;
        float outM = curM;
        float k = max(1.0, uRadius * 0.22);

        if (uMode == 0) {
          float fall = 1.0 - smoothstep(0.0, uRadius, rawB + uRadius);
          float toolD = rawB + uRadius * (1.0 - uStrength) * 0.55;
          outD = smin(curD, toolD, k);
          if (outD < curD - 0.02 && fall > 0.15) outM = float(uLayerIdx) / 255.0;
        } else if (uMode == 1) {
          float toolD = rawB + uRadius * (1.0 - uStrength) * 0.55;
          outD = -smin(-curD, toolD, k);
        } else if (uMode == 2) {
          float w = clamp(1.0 - (rawB + uRadius) / uRadius, 0.0, 1.0);
          float avg = (
            curD +
            texture(uPrevSdf, vUv).r +
            texture(uNextSdf, vUv).r +
            texture(uCurSdf, clamp(vUv + vec2(uInvDim.x, 0.0), 0.0, 1.0)).r +
            texture(uCurSdf, clamp(vUv - vec2(uInvDim.x, 0.0), 0.0, 1.0)).r +
            texture(uCurSdf, clamp(vUv + vec2(0.0, uInvDim.y), 0.0, 1.0)).r +
            texture(uCurSdf, clamp(vUv - vec2(0.0, uInvDim.y), 0.0, 1.0)).r
          ) / 7.0;
          outD = mix(curD, avg, w * uStrength * 0.65);
        } else {
          float w = clamp(1.0 - (rawB + uRadius) / uRadius, 0.0, 1.0);
          float planeD = dot(P - uFlatAnchor, uFlatNormal);
          outD = mix(curD, planeD, w * uStrength * 0.55);
        }
        outSdf = clamp(outD, -1200.0, 1200.0);
        outMat = outM;
      }`;

    // Pass C: Sky (HDR Linear)
    const SKY_VS = `#version 300 es
      precision highp float;
      layout(location = 0) in vec2 aPos;
      out vec2 vUv;
      void main() { vUv = aPos * 0.5 + 0.5; gl_Position = vec4(aPos, 0.0, 1.0); }`;

    const SKY_FS = `#version 300 es
      precision highp float;
      in vec2 vUv;
      uniform mat4 uInvViewProj;
      uniform vec3 uCamPos;
      uniform vec3 uSunDir;
      uniform float uTime;
      out vec4 outColor;
      ${GLSL_NOISE_AND_SKY}
      void main() {
        vec4 farW = uInvViewProj * vec4(vUv * 2.0 - 1.0, 1.0, 1.0);
        vec3 rayDir = normalize(farW.xyz / farW.w - uCamPos);
        outColor = vec4(evaluateSky(rayDir, uSunDir, uTime), 1.0);
      }`;

    // Pass D: Full-Resolution 3D SDF Sphere-Tracer (No LOD, Exact gl_FragDepth, Geological Lighting + Shadows + AO)
    const SDF_RAYMARCH_FS = `#version 300 es
      precision highp float;
      in vec2 vUv;
      uniform highp sampler3D uSdfVol;
      uniform highp sampler3D uMatVol;
      uniform mat4 uInvViewProj;
      uniform mat4 uViewProj;
      uniform vec3 uCamPos;
      uniform vec3 uSunDir;
      uniform vec3 uBoxMin;
      uniform vec3 uBoxMax;
      uniform vec3 uLayerColors[16];
      uniform float uMinStep;
      uniform float uSurfaceEps;
      uniform float uPixelCone;
      uniform float uNormalEps;
      uniform float uTime;
      uniform int uOceanOn;
      uniform vec4 uSculptCursor;
      out vec4 outColor;
      ${GLSL_NOISE_AND_SKY}

      vec3 worldToUvw(vec3 p) {
        vec3 s = uBoxMax - uBoxMin;
        return vec3((p.x - uBoxMin.x) / s.x, (p.z - uBoxMin.z) / s.z, (p.y - uBoxMin.y) / s.y);
      }

      float sampleSdf(vec3 p) {
        return texture(uSdfVol, clamp(worldToUvw(p), vec3(0.0005), vec3(0.9995))).r;
      }

      vec3 calcNormal(vec3 p, float eps) {
        const vec2 k = vec2(1.0, -1.0);
        return normalize(
          k.xyy * sampleSdf(p + k.xyy * eps) +
          k.yyx * sampleSdf(p + k.yyx * eps) +
          k.yxy * sampleSdf(p + k.yxy * eps) +
          k.xxx * sampleSdf(p + k.xxx * eps)
        );
      }

      // Sphere-traced soft shadow. The start offset must clear the trilinear shell of the
      // hit point, otherwise ridge crests self-shadow into speckles.
      float calcSoftShadow(vec3 ro, vec3 rd) {
        float res = 1.0;
        float t = max(uNormalEps * 6.0, 3.0);
        for (int i = 0; i < 26; ++i) {
          vec3 p = ro + rd * t;
          if (any(lessThan(p, uBoxMin)) || any(greaterThan(p, uBoxMax))) break;
          float h = sampleSdf(p);
          if (h < uNormalEps * 2.2) return 0.34;
          res = min(res, 8.0 * h / t);
          t += clamp(h * 0.9, 1.4, 26.0);
          if (t > 320.0) break;
        }
        return clamp(res, 0.34, 1.0);
      }

      float calcAO(vec3 p, vec3 n) {
        float occ = 0.0, w = 1.0;
        for (int i = 1; i <= 4; ++i) {
          float dist = float(i) * float(i) * 1.3;
          float d = sampleSdf(p + n * dist);
          occ += max(0.0, dist - d) * w;
          w *= 0.5;
        }
        return clamp(1.0 - 0.085 * occ, 0.42, 1.0);
      }

      void main() {
        vec4 nearW = uInvViewProj * vec4(vUv * 2.0 - 1.0, -1.0, 1.0);
        vec4 farW  = uInvViewProj * vec4(vUv * 2.0 - 1.0,  1.0, 1.0);
        vec3 p0 = nearW.xyz / nearW.w;
        vec3 p1 = farW.xyz / farW.w;
        vec3 ro = uCamPos;
        vec3 rd = normalize(p1 - p0);

        vec3 safeRd = vec3(
          abs(rd.x) < 1e-6 ? (rd.x < 0.0 ? -1e-6 : 1e-6) : rd.x,
          abs(rd.y) < 1e-6 ? (rd.y < 0.0 ? -1e-6 : 1e-6) : rd.y,
          abs(rd.z) < 1e-6 ? (rd.z < 0.0 ? -1e-6 : 1e-6) : rd.z
        );
        vec3 invRd = 1.0 / safeRd;
        vec3 t0 = (uBoxMin - ro) * invRd;
        vec3 t1 = (uBoxMax - ro) * invRd;
        vec3 tSmall = min(t0, t1);
        vec3 tBig   = max(t0, t1);
        float tMin = max(max(tSmall.x, tSmall.y), max(tSmall.z, 0.10));
        float tMax = min(min(tBig.x, tBig.y), tBig.z);
        if (tMax <= tMin) discard;

        float t = tMin;
        float tPrev = tMin;
        bool hit = false;
        for (int i = 0; i < 640; ++i) {
          vec3 p = ro + rd * t;
          float d = sampleSdf(p);
          if (d <= 0.0) {
            hit = true;
            break;
          }
          tPrev = t;
          // Conservative sphere-trace step, clamped by the pixel cone so a grazing ray
          // cannot tunnel through a silhouette while empty space still marches quickly.
          float maxStep = max(uMinStep * 3.0, t * uPixelCone * 3.0);
          t += clamp(d * 0.62, uMinStep, maxStep);
          if (t > tMax) break;
        }
        if (!hit) discard;

        float a = tPrev, b = t;
        for (int j = 0; j < 10; ++j) {
          float m = 0.5 * (a + b);
          if (sampleSdf(ro + rd * m) <= 0.0) b = m;
          else a = m;
        }
        float tHit = 0.5 * (a + b);
        vec3 hitPos = ro + rd * tHit;

        vec4 clipPos = uViewProj * vec4(hitPos, 1.0);
        if (clipPos.w <= 0.001) discard;
        float fragDepth = clamp((clipPos.z / clipPos.w) * 0.5 + 0.5, 0.0001, 0.99990);
        gl_FragDepth = fragDepth;

        vec3 N = calcNormal(hitPos, uNormalEps);
        vec3 uvwIn = clamp(worldToUvw(hitPos - N * (uNormalEps * 0.9)), vec3(0.001), vec3(0.999));
        int rawMat = int(floor(texture(uMatVol, uvwIn).r * 255.0 + 0.5));
        int matIdx = (rawMat >= 16) ? 0 : clamp(rawMat, 0, 15);
        vec3 layerCol = uLayerColors[matIdx];

        // Wide, soft sediment banding. Kept low-contrast because a hard sin() band
        // on a terrain this tall reads as contour stair-stepping.
        float slope = clamp(N.y, 0.0, 1.0);

        // Detail LOD: procedural micro-texture finer than a pixel aliases into a woven
        // moire on tall cliff walls, so fade it out with distance and with steepness.
        float detailFade = 1.0 - smoothstep(140.0, 760.0, tHit);
        float detail = detailFade * mix(0.35, 1.0, slope);

        float strataWarp = fbm3(hitPos * 0.022) * 16.0;
        float strata = 0.5 + 0.5 * sin((hitPos.y + strataWarp) * 0.115);
        strata = smoothstep(0.12, 0.88, strata);
        float micro = mix(0.5, fbm3(hitPos * 0.35), detail);

        vec3 nBump = vec3(
          fbm3(hitPos * 0.09 + vec3(0.2, 0.0, 0.0)) - fbm3(hitPos * 0.09),
          0.0,
          fbm3(hitPos * 0.09 + vec3(0.0, 0.0, 0.2)) - fbm3(hitPos * 0.09)
        );
        // Only perturb gently-sloping ground; near-vertical faces keep a clean normal.
        vec3 Nw = normalize(N - nBump * mix(11.0, 1.4, slope) * detail);

        // Sediment bands belong on cliff faces only. Across a shallow beach the same
        // sin() is just a contour map of height and reads as corrugation.
        float strataMix = mix(0.5, strata, detailFade) * smoothstep(0.30, 0.70, slope);
        vec3 cliffCol = layerCol * mix(0.80, 0.97, strataMix * 0.30 + micro * 0.26);
        vec3 ledgeCol = mix(layerCol * 0.96, vec3(0.66, 0.58, 0.44), 0.30) * (0.90 + 0.10 * micro);
        vec3 albedo = mix(cliffCol, ledgeCol, smoothstep(0.42, 0.88, slope));

        float snowBand = smoothstep(150.0, 235.0, hitPos.y + micro * 22.0) * smoothstep(0.62, 0.90, slope) * detailFade;
        albedo = mix(albedo, vec3(0.84, 0.88, 0.93), snowBand * 0.42);

        float wetness = 1.0;
        if (uOceanOn == 1) {
          wetness = smoothstep(-0.2, 1.6, hitPos.y);
          albedo *= mix(0.45, 1.0, wetness);
        }

        vec3 V = normalize(uCamPos - hitPos);
        float shadow = calcSoftShadow(hitPos + Nw * (uNormalEps * 4.0), uSunDir);
        float ao = calcAO(hitPos, Nw);

        float NdotL = max(dot(Nw, uSunDir), 0.0);
        vec3 sunCol = mix(vec3(1.0, 0.62, 0.36), vec3(1.06, 0.99, 0.88), smoothstep(0.06, 0.48, uSunDir.y));
        // Hemispheric sky fill: bright sky above, warm sand/water bounce below.
        vec3 skyFill = evaluateSky(vec3(Nw.x, abs(Nw.y) * 0.9 + 0.12, Nw.z), uSunDir, uTime) * 0.40;
        float hemi = 0.5 + 0.5 * Nw.y;
        vec3 groundBounce = mix(vec3(0.10, 0.12, 0.14), vec3(0.30, 0.24, 0.17), 1.0 - hemi) * 0.70;
        vec3 ambient = (skyFill * hemi + groundBounce) * ao;

        vec3 H = normalize(uSunDir + V);
        float specPow = mix(96.0, 22.0, wetness);
        float specGain = mix(0.13, 0.03, wetness);
        float spec = pow(max(dot(Nw, H), 0.0), specPow) * specGain * shadow;

        vec3 lit = albedo * (ambient + sunCol * (NdotL * shadow * 0.90)) + sunCol * spec;
        // Faint aerial blue lift in deep shade so silhouettes never read as flat black.
        lit += vec3(0.016, 0.026, 0.040) * ao;

        if (uSculptCursor.w > 0.05) {
          float distRing = abs(length(hitPos - uSculptCursor.xyz) - uSculptCursor.w);
          float ringW = max(0.35, uSculptCursor.w * 0.045);
          float ring = 1.0 - smoothstep(0.0, ringW, distRing);
          float fillDisc = (1.0 - smoothstep(uSculptCursor.w * 0.9, uSculptCursor.w, length(hitPos - uSculptCursor.xyz))) * 0.14;
          lit = mix(lit, vec3(0.32, 0.88, 0.98), clamp(ring * 0.85 + fillDisc, 0.0, 0.9));
        }

        float fog = 1.0 - exp(-tHit * 0.00028);
        vec3 fogCol = evaluateSky(rd, uSunDir, uTime);
        lit = mix(lit, fogCol, fog * 0.55);
        outColor = vec4(lit, 1.0);
      }`;

    // Pass E: Async 1x1 3D Cursor Raycast Pick (WorldXYZ + Normal)
    const SDF_PICK_FS = `#version 300 es
      precision highp float;
      in vec2 vUv;
      uniform highp sampler3D uSdfVol;
      uniform vec3 uCamPos;
      uniform vec3 uRayDir;
      uniform vec3 uBoxMin;
      uniform vec3 uBoxMax;
      uniform float uMinStep;
      uniform float uSurfaceEps;
      uniform float uPixelCone;
      uniform float uNormalEps;
      layout(location = 0) out vec4 outPos;
      layout(location = 1) out vec4 outNorm;

      vec3 worldToUvw(vec3 p) {
        vec3 s = uBoxMax - uBoxMin;
        return vec3((p.x - uBoxMin.x) / s.x, (p.z - uBoxMin.z) / s.z, (p.y - uBoxMin.y) / s.y);
      }
      float sampleSdf(vec3 p) {
        return texture(uSdfVol, clamp(worldToUvw(p), vec3(0.0005), vec3(0.9995))).r;
      }
      vec3 calcNormal(vec3 p, float eps) {
        const vec2 k = vec2(1.0, -1.0);
        return normalize(
          k.xyy * sampleSdf(p + k.xyy * eps) +
          k.yyx * sampleSdf(p + k.yyx * eps) +
          k.yxy * sampleSdf(p + k.yxy * eps) +
          k.xxx * sampleSdf(p + k.xxx * eps)
        );
      }
      void main() {
        vec3 ro = uCamPos;
        vec3 rd = normalize(uRayDir);
        vec3 safeRd = vec3(
          abs(rd.x) < 1e-6 ? (rd.x < 0.0 ? -1e-6 : 1e-6) : rd.x,
          abs(rd.y) < 1e-6 ? (rd.y < 0.0 ? -1e-6 : 1e-6) : rd.y,
          abs(rd.z) < 1e-6 ? (rd.z < 0.0 ? -1e-6 : 1e-6) : rd.z
        );
        vec3 invRd = 1.0 / safeRd;
        vec3 t0 = (uBoxMin - ro) * invRd;
        vec3 t1 = (uBoxMax - ro) * invRd;
        float tMin = max(max(min(t0.x,t1.x), min(t0.y,t1.y)), max(min(t0.z,t1.z), 0.10));
        float tMax = min(min(max(t0.x,t1.x), max(t0.y,t1.y)), max(t0.z,t1.z));
        if (tMax <= tMin) { outPos = vec4(0.0); outNorm = vec4(0,1,0,0); return; }

        float t = tMin, tPrev = tMin;
        bool hit = false;
        for (int i = 0; i < 640; ++i) {
          float d = sampleSdf(ro + rd * t);
          if (d <= 0.0) { hit = true; break; }
          tPrev = t;
          t += clamp(d * 0.62, uMinStep, max(uMinStep * 3.0, t * uPixelCone * 3.0));
          if (t > tMax) break;
        }
        if (!hit) { outPos = vec4(0.0); outNorm = vec4(0,1,0,0); return; }
        float a = tPrev, b = t;
        for (int j = 0; j < 10; ++j) {
          float m = 0.5 * (a + b);
          if (sampleSdf(ro + rd * m) <= 0.0) b = m; else a = m;
        }
        vec3 hp = ro + rd * (0.5 * (a + b));
        vec3 n = calcNormal(hp, uNormalEps);
        outPos = vec4(hp, 1.0);
        outNorm = vec4(n, 1.0);
      }`;

    // Pass F: Single Unified Full-Screen Analytic Water Plane Composite + ACES Tone-Map (Zero seams, zero square cutouts!)
    const OCEAN_COMPOSITE_FS = `#version 300 es
      precision highp float;
      in vec2 vUv;
      uniform sampler2D uSceneColor;
      uniform sampler2D uSceneDepth;
      uniform mat4 uInvViewProj;
      uniform vec3 uCamPos;
      uniform vec3 uSunDir;
      uniform float uTime;
      uniform int uOceanOn;
      uniform float uWaveScale;
      uniform float uClarity;
      uniform float uFoamGain;
      uniform float uVoxelSize;
      out vec4 outColor;
      ${GLSL_NOISE_AND_SKY}

      // Layered directional ripples evaluated through a mid-point normal so each
      // screen pixel gets one continuous slope field -> no seams, no tiling, no popping.
      vec3 rippleNormal(vec2 xz, float t, float amp, float distFade) {
        vec2 d1 = vec2( 0.92,  0.39), d2 = vec2(-0.42,  0.91);
        vec2 d3 = vec2( 0.60, -0.80), d4 = vec2(-0.86, -0.51);
        float p1 = dot(d1, xz) * 0.031 + t * 0.85;
        float p2 = dot(d2, xz) * 0.053 + t * 1.28 + 1.4;
        float p3 = dot(d3, xz) * 0.089 + t * 1.95 + 2.8;
        float p4 = dot(d4, xz) * 0.152 + t * 2.70 + 0.7;
        float fade = distFade;
        vec2 slope =
          d1 * cos(p1) * 0.0155 * amp +
          d2 * cos(p2) * 0.0118 * amp +
          d3 * cos(p3) * 0.0082 * amp * fade +
          d4 * cos(p4) * 0.0049 * amp * fade;
        // Broad long-period swell for horizon structure
        vec2 ds = vec2(0.26, 0.97);
        slope += ds * cos(dot(ds, xz) * 0.0086 + t * 0.42) * 0.021 * amp;
        return normalize(vec3(-slope.x, 1.0, -slope.y));
      }

      void main() {
        vec3 hdr = texture(uSceneColor, vUv).rgb;
        float depth01 = texture(uSceneDepth, vUv).r;

        vec4 farW = uInvViewProj * vec4(vUv * 2.0 - 1.0, 1.0, 1.0);
        vec3 rd = normalize(farW.xyz / farW.w - uCamPos);

        // Cleared depth is exactly 1.0; anything quantised below it is real geometry,
        // so distant ridges are never mistaken for open sky.
        bool hasTerrain = depth01 < 0.9999999;
        vec3 terrainPos = uCamPos + rd * 6000.0;
        float tTerrain = 6000.0;
        if (hasTerrain) {
          vec4 worldP = uInvViewProj * vec4(vUv * 2.0 - 1.0, depth01 * 2.0 - 1.0, 1.0);
          terrainPos = worldP.xyz / worldP.w;
          tTerrain = length(terrainPos - uCamPos);
        }

        if (uOceanOn == 1) {
          if (uCamPos.y > 0.0 && rd.y < -0.0002) {
            // Exact analytic sea plane at Y = 0 (infinite, so it always meets the horizon cleanly)
            float tWater = -uCamPos.y / rd.y;
            if (tWater > 0.05 && tWater < 26000.0 && (!hasTerrain || tWater < tTerrain)) {
              vec3 wp = uCamPos + rd * tWater;
              float distFade = 1.0 / (1.0 + tWater * 0.0032);
              vec3 N = rippleNormal(wp.xz, uTime, uWaveScale, distFade);
              vec3 V = -rd;
              float NdotV = max(dot(N, V), 0.0015);

              // Depth the ray travelled through water before it hit terrain
              float rayDepth = hasTerrain ? max(0.0, tTerrain - tWater) : 900.0;
              float vertDepth = hasTerrain ? max(0.0, -terrainPos.y) : 900.0;

              // Refraction: shift the terrain lookup along the wave slope
              vec3 refrBg = hdr;
              if (hasTerrain && rayDepth > 0.05) {
                vec2 refrUv = clamp(vUv + N.xz * clamp(rayDepth * 0.0022, 0.0, 0.010), vec2(0.002), vec2(0.998));
                if (texture(uSceneDepth, refrUv).r < 0.9999999) refrBg = texture(uSceneColor, refrUv).rgb;
              }

              // Beer-Lambert absorption: turquoise shallows -> clear deep blue
              float clarity = clamp(uClarity, 0.0, 1.0);
              float turb = mix(2.2, 0.55, clarity);
              vec3 absorb = vec3(0.52, 0.17, 0.105) * turb;
              vec3 trans = exp(-absorb * rayDepth);
              vec3 shallowTint = vec3(0.075, 0.40, 0.42) * (0.48 + 0.52 * max(uSunDir.y, 0.10));
              vec3 deepBody = vec3(0.010, 0.062, 0.125) * (0.42 + 0.58 * max(uSunDir.y, 0.10));
              vec3 waterBody = mix(deepBody, shallowTint, exp(-vertDepth * 0.10));
              vec3 underwater = mix(waterBody, refrBg, trans);

              // Fresnel sky reflection
              float fresnel = 0.02 + 0.98 * pow(1.0 - NdotV, 5.0);
              vec3 R = reflect(-V, N);
              R.y = max(R.y, 0.012);
              vec3 skyRefl = evaluateSky(R, uSunDir, uTime);

              // Tight sun glitter
              vec3 H = normalize(uSunDir + V);
              float NdotH = max(dot(N, H), 0.0);
              float a2 = 0.0016;
              float dd = (NdotH * NdotH) * (a2 - 1.0) + 1.0;
              float ggx = a2 / (3.14159265 * dd * dd + 1e-5);
              vec3 sunCol = mix(vec3(1.0, 0.56, 0.28), vec3(1.0, 0.95, 0.86), smoothstep(0.06, 0.45, uSunDir.y));
              vec3 sunSpec = sunCol * ggx * 0.055 * mix(0.25, 1.0, fresnel);

              // Surf is only drawn where we look down onto the shallow shelf: at grazing
              // angles a 1 m band is sub-pixel and would alias into a dotted rim.
              float grazing = smoothstep(0.06, 0.42, -rd.y);
              float shoreBand = smoothstep(1.5, 0.15, vertDepth) * grazing;
              float foamNoise = fbm2(wp.xz * 0.42 + vec2(uTime * 0.09, -uTime * 0.07));
              float foamBroken = smoothstep(0.38, 0.78, foamNoise);
              float foamFade = (1.0 - smoothstep(90.0, 300.0, tWater)) * smoothstep(0.30, 1.6, vertDepth);
              float foam = clamp(shoreBand * uFoamGain * foamBroken * foamFade * 0.40, 0.0, 0.34);
              // Pale turquoise surf halo hugs the beach, always underneath the foam
              vec3 surfHalo = vec3(0.34, 0.74, 0.74) * (0.40 + 0.60 * max(uSunDir.y, 0.12));

              vec3 waterCol = mix(underwater, skyRefl, fresnel) + sunSpec;
              waterCol = mix(waterCol, surfHalo, shoreBand * 0.20 * foamFade);
              vec3 foamLit = vec3(0.92, 0.96, 0.99) * (0.52 + 0.78 * max(dot(N, uSunDir), 0.08));
              waterCol = mix(waterCol, foamLit, foam);

              float fog = 1.0 - exp(-tWater * 0.00026);
              waterCol = mix(waterCol, evaluateSky(rd, uSunDir, uTime), fog * 0.60);

              // Feather the very last 12 cm of vertical depth so the coastline has no confetti edge
              // Feather by depth measured in VOXELS, not metres: below one voxel the water
              // column is thinner than the field can represent, and shading it produces a
              // stair-stepped comb along every shoreline.
              float featherMeters = max(uVoxelSize * 2.4, 0.5);
              float edgeAlpha = hasTerrain ? smoothstep(0.0, featherMeters, vertDepth) : 1.0;
              hdr = mix(hdr, waterCol, edgeAlpha);
            }
          } else if (uCamPos.y <= 0.0) {
            float dist = hasTerrain ? tTerrain : 260.0;
            hdr = mix(vec3(0.014, 0.105, 0.150), hdr, exp(-dist * 0.011));
          }
        }

        // ACES filmic tone map + sRGB transfer
        vec3 col = (hdr * (2.51 * hdr + 0.03)) / (hdr * (2.43 * hdr + 0.59) + 0.14);
        col = pow(clamp(col, 0.0, 1.0), vec3(1.0 / 2.2));
        outColor = vec4(col, 1.0);
      }`;

    // ---------- Compile Programs ----------
    const buildLayerSliceProg = linkProgram(QUAD_VS, BUILD_LAYER_SLICE_FS);
    const sculptSliceProg = linkProgram(QUAD_VS, SCULPT_SLICE_FS);
    const skyProg = linkProgram(SKY_VS, SKY_FS);
    const sdfRaymarchProg = linkProgram(QUAD_VS, SDF_RAYMARCH_FS);
    const sdfPickProg = linkProgram(QUAD_VS, SDF_PICK_FS);
    const oceanCompositeProg = linkProgram(QUAD_VS, OCEAN_COMPOSITE_FS);

    // ---------- Fullscreen Quad VAO ----------
    const quadVao = gl.createVertexArray();
    const quadVbo = gl.createBuffer();
    gl.bindVertexArray(quadVao);
    gl.bindBuffer(gl.ARRAY_BUFFER, quadVbo);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    gl.bindVertexArray(null);

    // ---------- DataTextures for SDF Compiler ----------
    function makeFloatDataTex(w, h) {
        const tex = gl.createTexture();
        gl.bindTexture(gl.TEXTURE_2D, tex);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA32F, w, h, 0, gl.RGBA, gl.FLOAT, null);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
        return tex;
    }
    const strokeTex = makeFloatDataTex(512, 2);
    const regionTex = makeFloatDataTex(256, 4);
    const primTex = makeFloatDataTex(2048, 5);
    const sculptTex = makeFloatDataTex(2048, 2);

    // ---------- 3D SDF & Material Volumes (Single Resolution, No LOD, >=512x512x128) ----------
    let volNX = 512, volNZ = 512, volNY = 256;
    let sdfTex = gl.createTexture();
    let matTex = gl.createTexture();
    let accumSdf = [gl.createTexture(), gl.createTexture()];
    let accumMat = [gl.createTexture(), gl.createTexture()];
    let rollSdf = [gl.createTexture(), gl.createTexture(), gl.createTexture()];
    let rollMat = [gl.createTexture(), gl.createTexture(), gl.createTexture()];
    let accumFbo = [gl.createFramebuffer(), gl.createFramebuffer()];
    let volSliceFbo = gl.createFramebuffer();
    let readSliceFbo = gl.createFramebuffer();

    function config2DSlice(tex, intFmt, w, h, fmt, type) {
        gl.bindTexture(gl.TEXTURE_2D, tex);
        gl.texImage2D(gl.TEXTURE_2D, 0, intFmt, w, h, 0, fmt, type, null);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    }

    function allocateVolume(nx, ny, nz) {
        if (nx > MAX_3D_SIZE || nz > MAX_3D_SIZE || ny > MAX_3D_SIZE) {
            throw new Error(`GPU MAX_3D_TEXTURE_SIZE (${MAX_3D_SIZE}) exceeded for ${nx}×${nz}×${ny}`);
        }
        while (gl.getError() !== gl.NO_ERROR) {}

        gl.bindTexture(gl.TEXTURE_3D, sdfTex);
        gl.texImage3D(gl.TEXTURE_3D, 0, gl.R16F, nx, nz, ny, 0, gl.RED, gl.HALF_FLOAT, null);
        if (gl.getError() !== gl.NO_ERROR) throw new Error(`GPU memory allocation failed at ${nx}×${nz}×${ny} R16F`);
        gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_WRAP_R, gl.CLAMP_TO_EDGE);

        gl.bindTexture(gl.TEXTURE_3D, matTex);
        gl.texImage3D(gl.TEXTURE_3D, 0, gl.R8, nx, nz, ny, 0, gl.RED, gl.UNSIGNED_BYTE, null);
        if (gl.getError() !== gl.NO_ERROR) throw new Error(`GPU memory allocation failed at ${nx}×${nz}×${ny} R8`);
        gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
        gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
        gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_WRAP_R, gl.CLAMP_TO_EDGE);

        for (let i = 0; i < 2; ++i) {
            config2DSlice(accumSdf[i], gl.R16F, nx, nz, gl.RED, gl.HALF_FLOAT);
            config2DSlice(accumMat[i], gl.R8, nx, nz, gl.RED, gl.UNSIGNED_BYTE);
            gl.bindFramebuffer(gl.FRAMEBUFFER, accumFbo[i]);
            gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, accumSdf[i], 0);
            gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT1, gl.TEXTURE_2D, accumMat[i], 0);
            gl.drawBuffers([gl.COLOR_ATTACHMENT0, gl.COLOR_ATTACHMENT1]);
            if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) {
                throw new Error('Slice accumulation MRT FBO incomplete');
            }
        }
        for (let i = 0; i < 3; ++i) {
            config2DSlice(rollSdf[i], gl.R16F, nx, nz, gl.RED, gl.HALF_FLOAT);
            config2DSlice(rollMat[i], gl.R8, nx, nz, gl.RED, gl.UNSIGNED_BYTE);
        }
        gl.bindFramebuffer(gl.FRAMEBUFFER, volSliceFbo);
        gl.framebufferTextureLayer(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, sdfTex, 0, 0);
        gl.framebufferTextureLayer(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT1, matTex, 0, 0);
        gl.drawBuffers([gl.COLOR_ATTACHMENT0, gl.COLOR_ATTACHMENT1]);
        if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) {
            throw new Error('TEXTURE_3D layer MRT FBO incomplete');
        }
        gl.bindFramebuffer(gl.FRAMEBUFFER, null);

        volNX = nx; volNY = ny; volNZ = nz;
    }

    // ---------- Underwater + Depth Targets ----------
    let underwaterColorTex = gl.createTexture(), underwaterDepthTex = gl.createTexture(), underwaterFbo = gl.createFramebuffer();
    let targetW = 0, targetH = 0;

    function ensureSceneTargets(w, h) {
        if (targetW === w && targetH === h) return;
        targetW = w; targetH = h;
        gl.bindTexture(gl.TEXTURE_2D, underwaterColorTex);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA16F, w, h, 0, gl.RGBA, gl.HALF_FLOAT, null);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

        gl.bindTexture(gl.TEXTURE_2D, underwaterDepthTex);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.DEPTH_COMPONENT24, w, h, 0, gl.DEPTH_COMPONENT, gl.UNSIGNED_INT, null);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

        gl.bindFramebuffer(gl.FRAMEBUFFER, underwaterFbo);
        gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, underwaterColorTex, 0);
        gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.TEXTURE_2D, underwaterDepthTex, 0);
        gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    }

    // Async 1x1 Pick FBO
    const pickPosTex = makeFloatDataTex(1, 1);
    const pickNormTex = makeFloatDataTex(1, 1);
    const pickFbo = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, pickFbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, pickPosTex, 0);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT1, gl.TEXTURE_2D, pickNormTex, 0);
    gl.drawBuffers([gl.COLOR_ATTACHMENT0, gl.COLOR_ATTACHMENT1]);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);

    // ---------- Math Utilities ----------
    function sub3(a, b) { return [a[0] - b[0], a[1] - b[1], a[2] - b[2]]; }
    function cross3(a, b) { return [a[1]*b[2]-a[2]*b[1], a[2]*b[0]-a[0]*b[2], a[0]*b[1]-a[1]*b[0]]; }
    function dot3(a, b) { return a[0]*b[0] + a[1]*b[1] + a[2]*b[2]; }
    function norm3(v) { const l = Math.hypot(v[0], v[1], v[2]) || 1; return [v[0]/l, v[1]/l, v[2]/l]; }
    function perspective(fovRad, aspect, nearZ, farZ) {
        const f = 1.0 / Math.tan(fovRad * 0.5), nf = 1.0 / (nearZ - farZ);
        return new Float32Array([f/aspect,0,0,0, 0,f,0,0, 0,0,(farZ+nearZ)*nf,-1, 0,0,2*farZ*nearZ*nf,0]);
    }
    function lookAt(eye, target) {
        const z = norm3(sub3(eye, target));
        const x = norm3(cross3([0, 1, 0], z));
        const y = cross3(z, x);
        return new Float32Array([
            x[0], y[0], z[0], 0,
            x[1], y[1], z[1], 0,
            x[2], y[2], z[2], 0,
            -dot3(x, eye), -dot3(y, eye), -dot3(z, eye), 1
        ]);
    }
    function mat4Mul(a, b) {
        const o = new Float32Array(16);
        for (let col = 0; col < 4; ++col)
            for (let row = 0; row < 4; ++row)
                o[col*4+row] = a[row]*b[col*4] + a[4+row]*b[col*4+1] + a[8+row]*b[col*4+2] + a[12+row]*b[col*4+3];
        return o;
    }
    function mat4Inverse(m) {
        const inv = new Float32Array(16);
        inv[0] = m[5]*m[10]*m[15] - m[5]*m[11]*m[14] - m[9]*m[6]*m[15] + m[9]*m[7]*m[14] + m[13]*m[6]*m[11] - m[13]*m[7]*m[10];
        inv[4] = -m[4]*m[10]*m[15] + m[4]*m[11]*m[14] + m[8]*m[6]*m[15] - m[8]*m[7]*m[14] - m[12]*m[6]*m[11] + m[12]*m[7]*m[10];
        inv[8] = m[4]*m[9]*m[15] - m[4]*m[11]*m[13] - m[8]*m[5]*m[15] + m[8]*m[7]*m[13] + m[12]*m[5]*m[11] - m[12]*m[7]*m[9];
        inv[12] = -m[4]*m[9]*m[14] + m[4]*m[10]*m[13] + m[8]*m[5]*m[14] - m[8]*m[6]*m[13] - m[12]*m[5]*m[10] + m[12]*m[6]*m[9];
        inv[1] = -m[1]*m[10]*m[15] + m[1]*m[11]*m[14] + m[9]*m[2]*m[15] - m[9]*m[3]*m[14] - m[13]*m[2]*m[11] + m[13]*m[3]*m[10];
        inv[5] = m[0]*m[10]*m[15] - m[0]*m[11]*m[14] - m[8]*m[2]*m[15] + m[8]*m[3]*m[14] + m[12]*m[2]*m[11] - m[12]*m[3]*m[10];
        inv[9] = -m[0]*m[9]*m[15] + m[0]*m[11]*m[13] + m[8]*m[1]*m[15] - m[8]*m[3]*m[13] - m[12]*m[1]*m[11] + m[12]*m[3]*m[9];
        inv[13] = m[0]*m[9]*m[14] - m[0]*m[10]*m[13] - m[8]*m[1]*m[14] + m[8]*m[2]*m[13] + m[12]*m[1]*m[10] - m[12]*m[2]*m[9];
        inv[2] = m[1]*m[6]*m[15] - m[1]*m[7]*m[14] - m[5]*m[2]*m[15] + m[5]*m[3]*m[14] + m[13]*m[2]*m[7] - m[13]*m[3]*m[6];
        inv[6] = -m[0]*m[6]*m[15] + m[0]*m[7]*m[14] + m[4]*m[2]*m[15] - m[4]*m[3]*m[14] - m[12]*m[2]*m[7] + m[12]*m[3]*m[6];
        inv[10] = m[0]*m[5]*m[15] - m[0]*m[7]*m[13] - m[4]*m[1]*m[15] + m[4]*m[3]*m[13] + m[12]*m[1]*m[7] - m[12]*m[3]*m[5];
        inv[14] = -m[0]*m[5]*m[14] + m[0]*m[6]*m[13] + m[4]*m[1]*m[14] - m[4]*m[2]*m[13] - m[12]*m[1]*m[6] + m[12]*m[2]*m[5];
        inv[3] = -m[1]*m[6]*m[11] + m[1]*m[7]*m[10] + m[5]*m[2]*m[11] - m[5]*m[3]*m[10] - m[9]*m[2]*m[7] + m[9]*m[3]*m[6];
        inv[7] = m[0]*m[6]*m[11] - m[0]*m[7]*m[10] - m[4]*m[2]*m[11] + m[4]*m[3]*m[10] + m[8]*m[2]*m[7] - m[8]*m[3]*m[6];
        inv[11] = -m[0]*m[5]*m[11] + m[0]*m[7]*m[9] + m[4]*m[1]*m[11] - m[4]*m[3]*m[9] - m[8]*m[1]*m[7] + m[8]*m[3]*m[5];
        inv[15] = m[0]*m[5]*m[10] - m[0]*m[6]*m[9] - m[4]*m[1]*m[10] + m[4]*m[2]*m[9] + m[8]*m[1]*m[6] - m[8]*m[2]*m[5];
        const det = m[0]*inv[0] + m[1]*inv[4] + m[2]*inv[8] + m[3]*inv[12];
        if (Math.abs(det) < 1e-8) return new Float32Array([1,0,0,0, 0,1,0,0, 0,0,1,0, 0,0,0,1]);
        const s = 1.0 / det;
        for (let i = 0; i < 16; ++i) inv[i] *= s;
        return inv;
    }

    // ---------- Engine State ----------
    let DEFAULT_NY = 256;
    try {
        allocateVolume(512, DEFAULT_NY, 512);
    } catch (err) {
        // Tight-VRAM fallback: half the vertical slices rather than failing to start
        DEFAULT_NY = 128;
        allocateVolume(512, DEFAULT_NY, 512);
    }

    let packedWorld = null;
    let layerColorsFlat = new Float32Array(16 * 3);
    let buildSliceCursor = 0;
    let building = false;
    let hasInitialBuild = false;
    let sculptReplayQueue = [];
    let sculptCursorUniform = [0, 0, 0, -1];
    let latestInvVP = new Float32Array(16);
    let suspended = false;

    function uploadWorldData(layers, extraSculptOps = []) {
        packedWorld = PackGpuWorld(layers);
        sculptReplayQueue = extraSculptOps.slice();

        layerColorsFlat.fill(0.65);
        for (let i = 0; i < layers.length && i < 16; ++i) {
            const hex = layers[i].Color || '#b9a481';
            const m = /^#?([0-9a-f]{6})$/i.exec(hex);
            const v = parseInt(m ? m[1] : 'b9a481', 16);
            layerColorsFlat[i * 3 + 0] = Math.pow(((v >> 16) & 255) / 255, 1.4);
            layerColorsFlat[i * 3 + 1] = Math.pow(((v >> 8) & 255) / 255, 1.4);
            layerColorsFlat[i * 3 + 2] = Math.pow((v & 255) / 255, 1.4);
        }

        const uploadTex = (tex, w, h, data) => {
            gl.bindTexture(gl.TEXTURE_2D, tex);
            gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, w, h, gl.RGBA, gl.FLOAT, data);
        };
        uploadTex(strokeTex, packedWorld.STROKE_CAP, 2, packedWorld.strokeData);
        uploadTex(regionTex, packedWorld.REGION_CAP, 4, packedWorld.regionData);
        uploadTex(primTex, packedWorld.PRIM_CAP, 5, packedWorld.primData);
        uploadTex(sculptTex, packedWorld.SCULPT_CAP, 2, packedWorld.sculptData);

        buildSliceCursor = 0;
        building = true;
        callbacks.onBuildProgress?.(0, volNX, volNZ, volNY);

        gl.disable(gl.DEPTH_TEST);
        for (let y = 0; y < volNY; ++y) {
            gl.bindFramebuffer(gl.FRAMEBUFFER, volSliceFbo);
            gl.framebufferTextureLayer(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, sdfTex, 0, y);
            gl.framebufferTextureLayer(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT1, matTex, 0, y);
            gl.clearBufferfv(gl.COLOR, 0, new Float32Array([250.0, 0, 0, 1]));
            gl.clearBufferfv(gl.COLOR, 1, new Float32Array([1.0, 0, 0, 1]));
        }
        gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    }

    function bakeSlicesStep(budgetMs = 16) {
        if (!building || !packedWorld) return;
        const tStart = performance.now();
        const infos = packedWorld.layerInfos;
        const [minX, minY, minZ] = packedWorld.worldMin;
        const [maxX, maxY, maxZ] = packedWorld.worldMax;

        gl.disable(gl.DEPTH_TEST);
        gl.bindVertexArray(quadVao);
        gl.viewport(0, 0, volNX, volNZ);
        gl.useProgram(buildLayerSliceProg);

        gl.activeTexture(gl.TEXTURE2); gl.bindTexture(gl.TEXTURE_2D, strokeTex);
        gl.uniform1i(gl.getUniformLocation(buildLayerSliceProg, 'uStrokeTex'), 2);
        gl.activeTexture(gl.TEXTURE3); gl.bindTexture(gl.TEXTURE_2D, regionTex);
        gl.uniform1i(gl.getUniformLocation(buildLayerSliceProg, 'uRegionTex'), 3);
        gl.activeTexture(gl.TEXTURE4); gl.bindTexture(gl.TEXTURE_2D, primTex);
        gl.uniform1i(gl.getUniformLocation(buildLayerSliceProg, 'uPrimTex'), 4);
        gl.activeTexture(gl.TEXTURE5); gl.bindTexture(gl.TEXTURE_2D, sculptTex);
        gl.uniform1i(gl.getUniformLocation(buildLayerSliceProg, 'uSculptTex'), 5);
        gl.uniform3f(gl.getUniformLocation(buildLayerSliceProg, 'uBoxMin'), minX, minY, minZ);
        gl.uniform3f(gl.getUniformLocation(buildLayerSliceProg, 'uBoxMax'), maxX, maxY, maxZ);

        while (buildSliceCursor < volNY) {
            const yIdx = buildSliceCursor++;
            const sliceY = minY + ((yIdx + 0.5) / volNY) * (maxY - minY);

            if (infos.length === 0) {
                gl.bindFramebuffer(gl.FRAMEBUFFER, volSliceFbo);
                gl.framebufferTextureLayer(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, sdfTex, 0, yIdx);
                gl.framebufferTextureLayer(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT1, matTex, 0, yIdx);
                const airDist = Math.max(12.0, sliceY - maxY + 28.0);
                gl.clearBufferfv(gl.COLOR, 0, new Float32Array([airDist, 0, 0, 1]));
                gl.clearBufferfv(gl.COLOR, 1, new Float32Array([1.0, 0, 0, 1]));
            } else {
                let ping = 0;
                for (let li = 0; li < infos.length; ++li) {
                    const info = infos[li];
                    const isLast = (li === infos.length - 1);
                    if (isLast) {
                        gl.bindFramebuffer(gl.FRAMEBUFFER, volSliceFbo);
                        gl.framebufferTextureLayer(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, sdfTex, 0, yIdx);
                        gl.framebufferTextureLayer(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT1, matTex, 0, yIdx);
                    } else {
                        gl.bindFramebuffer(gl.FRAMEBUFFER, accumFbo[ping]);
                    }

                    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, accumSdf[1 - ping]);
                    gl.uniform1i(gl.getUniformLocation(buildLayerSliceProg, 'uPrevSdf'), 0);
                    gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, accumMat[1 - ping]);
                    gl.uniform1i(gl.getUniformLocation(buildLayerSliceProg, 'uPrevMat'), 1);

                    gl.uniform1i(gl.getUniformLocation(buildLayerSliceProg, 'uHasPrev'), li > 0 ? 1 : 0);
                    gl.uniform1i(gl.getUniformLocation(buildLayerSliceProg, 'uLayerIdx'), info.layerIdx);
                    gl.uniform1i(gl.getUniformLocation(buildLayerSliceProg, 'uSegStart'), info.segStart);
                    gl.uniform1i(gl.getUniformLocation(buildLayerSliceProg, 'uSegCount'), info.segCount);
                    gl.uniform1i(gl.getUniformLocation(buildLayerSliceProg, 'uRegStart'), info.regStart);
                    gl.uniform1i(gl.getUniformLocation(buildLayerSliceProg, 'uRegCount'), info.regCount);
                    gl.uniform1f(gl.getUniformLocation(buildLayerSliceProg, 'uSliceWorldY'), sliceY);
                    gl.uniform3f(gl.getUniformLocation(buildLayerSliceProg, 'uLayerBBoxMin3'), info.bounds[0] - 22.0, info.bounds[1] - 6.0, info.bounds[2] - 22.0);
                    gl.uniform3f(gl.getUniformLocation(buildLayerSliceProg, 'uLayerBBoxMax3'), info.bounds[3] + 22.0, info.bounds[4] + 10.0, info.bounds[5] + 22.0);
                    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);

                    ping = 1 - ping;
                }
            }

            if (buildSliceCursor % 8 === 0 && performance.now() - tStart >= budgetMs) {
                break;
            }
        }
        gl.bindFramebuffer(gl.FRAMEBUFFER, null);

        const frac = buildSliceCursor / volNY;
        callbacks.onBuildProgress?.(frac, volNX, volNZ, volNY);

        if (buildSliceCursor >= volNY) {
            building = false;
            hasInitialBuild = true;
            if (sculptReplayQueue.length > 0) {
                const ops = sculptReplayQueue.slice();
                sculptReplayQueue = [];
                for (const op of ops) {
                    for (let i = 0; i < op.Points.length; ++i) {
                        const a = op.Points[Math.max(0, i - 1)];
                        const b = op.Points[i];
                        applySculptSegment(a, b, op.Radius, op.Strength, op.Mode, op.LayerIndex, op.Anchor || a, op.Normal || [0, 1, 0]);
                    }
                }
            }
            callbacks.onBuildComplete?.(volNX, volNZ, volNY);
        }
    }

    function blitSdfSliceTo(ySlice, dstSdfTex, dstMatTex, sx0, sz0, sx1, sz1) {
        gl.bindFramebuffer(gl.READ_FRAMEBUFFER, readSliceFbo);
        gl.framebufferTextureLayer(gl.READ_FRAMEBUFFER, gl.COLOR_ATTACHMENT0, sdfTex, 0, ySlice);
        gl.readBuffer(gl.COLOR_ATTACHMENT0);
        gl.bindTexture(gl.TEXTURE_2D, dstSdfTex);
        gl.copyTexSubImage2D(gl.TEXTURE_2D, 0, sx0, sz0, sx0, sz0, sx1 - sx0 + 1, sz1 - sz0 + 1);

        if (dstMatTex) {
            gl.framebufferTextureLayer(gl.READ_FRAMEBUFFER, gl.COLOR_ATTACHMENT0, matTex, 0, ySlice);
            gl.readBuffer(gl.COLOR_ATTACHMENT0);
            gl.bindTexture(gl.TEXTURE_2D, dstMatTex);
            gl.copyTexSubImage2D(gl.TEXTURE_2D, 0, sx0, sz0, sx0, sz0, sx1 - sx0 + 1, sz1 - sz0 + 1);
        }
        gl.bindFramebuffer(gl.READ_FRAMEBUFFER, null);
    }

    function applySculptSegment(segA, segB, radius, strength, modeName, layerIdx, flatAnchor = segA, flatNormal = [0, 1, 0]) {
        if (!packedWorld || building) return;
        const [minX, minY, minZ] = packedWorld.worldMin;
        const [maxX, maxY, maxZ] = packedWorld.worldMax;
        const spanX = (maxX - minX) || 1, spanY = (maxY - minY) || 1, spanZ = (maxZ - minZ) || 1;

        const pad = radius * 1.55 + Math.max(spanX / volNX, spanZ / volNZ) * 2.0;
        const bx0 = Math.min(segA[0], segB[0]) - pad, bx1 = Math.max(segA[0], segB[0]) + pad;
        const by0 = Math.min(segA[1], segB[1]) - pad, by1 = Math.max(segA[1], segB[1]) + pad;
        const bz0 = Math.min(segA[2], segB[2]) - pad, bz1 = Math.max(segA[2], segB[2]) + pad;

        const ix0 = Math.max(0, Math.floor(((bx0 - minX) / spanX) * volNX));
        const ix1 = Math.min(volNX - 1, Math.ceil(((bx1 - minX) / spanX) * volNX));
        const iz0 = Math.max(0, Math.floor(((bz0 - minZ) / spanZ) * volNZ));
        const iz1 = Math.min(volNZ - 1, Math.ceil(((bz1 - minZ) / spanZ) * volNZ));
        const iy0 = Math.max(0, Math.floor(((by0 - minY) / spanY) * volNY));
        const iy1 = Math.min(volNY - 1, Math.ceil(((by1 - minY) / spanY) * volNY));
        if (ix0 > ix1 || iz0 > iz1 || iy0 > iy1) return;

        const sx0 = Math.max(0, ix0 - 1), sx1 = Math.min(volNX - 1, ix1 + 1);
        const sz0 = Math.max(0, iz0 - 1), sz1 = Math.min(volNZ - 1, iz1 + 1);

        let slotPrev = 0, slotCur = 1, slotNext = 2;
        blitSdfSliceTo(Math.max(0, iy0 - 1), rollSdf[slotPrev], null, sx0, sz0, sx1, sz1);
        blitSdfSliceTo(iy0, rollSdf[slotCur], rollMat[slotCur], sx0, sz0, sx1, sz1);

        const modeCode = modeName === 'remove' ? 1 : modeName === 'smooth' ? 2 : modeName === 'flatten' ? 3 : 0;

        gl.disable(gl.DEPTH_TEST);
        gl.enable(gl.SCISSOR_TEST);
        gl.scissor(ix0, iz0, ix1 - ix0 + 1, iz1 - iz0 + 1);
        gl.viewport(0, 0, volNX, volNZ);
        gl.bindVertexArray(quadVao);
        gl.useProgram(sculptSliceProg);
        gl.uniform3f(gl.getUniformLocation(sculptSliceProg, 'uBoxMin'), minX, minY, minZ);
        gl.uniform3f(gl.getUniformLocation(sculptSliceProg, 'uBoxMax'), maxX, maxY, maxZ);
        gl.uniform3f(gl.getUniformLocation(sculptSliceProg, 'uInvDim'), 1.0 / volNX, 1.0 / volNZ, 1.0 / volNY);
        gl.uniform3fv(gl.getUniformLocation(sculptSliceProg, 'uSegA'), segA);
        gl.uniform3fv(gl.getUniformLocation(sculptSliceProg, 'uSegB'), segB);
        gl.uniform1f(gl.getUniformLocation(sculptSliceProg, 'uRadius'), radius);
        gl.uniform1f(gl.getUniformLocation(sculptSliceProg, 'uStrength'), strength);
        gl.uniform1i(gl.getUniformLocation(sculptSliceProg, 'uMode'), modeCode);
        gl.uniform1i(gl.getUniformLocation(sculptSliceProg, 'uLayerIdx'), layerIdx);
        gl.uniform3fv(gl.getUniformLocation(sculptSliceProg, 'uFlatAnchor'), flatAnchor);
        gl.uniform3fv(gl.getUniformLocation(sculptSliceProg, 'uFlatNormal'), flatNormal);

        for (let y = iy0; y <= iy1; ++y) {
            blitSdfSliceTo(Math.min(volNY - 1, y + 1), rollSdf[slotNext], rollMat[slotNext], sx0, sz0, sx1, sz1);

            const sliceY = minY + ((y + 0.5) / volNY) * spanY;
            gl.bindFramebuffer(gl.FRAMEBUFFER, volSliceFbo);
            gl.framebufferTextureLayer(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, sdfTex, 0, y);
            gl.framebufferTextureLayer(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT1, matTex, 0, y);

            gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, rollSdf[slotPrev]);
            gl.uniform1i(gl.getUniformLocation(sculptSliceProg, 'uPrevSdf'), 0);
            gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, rollSdf[slotCur]);
            gl.uniform1i(gl.getUniformLocation(sculptSliceProg, 'uCurSdf'), 1);
            gl.activeTexture(gl.TEXTURE2); gl.bindTexture(gl.TEXTURE_2D, rollSdf[slotNext]);
            gl.uniform1i(gl.getUniformLocation(sculptSliceProg, 'uNextSdf'), 2);
            gl.activeTexture(gl.TEXTURE3); gl.bindTexture(gl.TEXTURE_2D, rollMat[slotCur]);
            gl.uniform1i(gl.getUniformLocation(sculptSliceProg, 'uCurMat'), 3);
            gl.uniform1f(gl.getUniformLocation(sculptSliceProg, 'uSliceWorldY'), sliceY);
            gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);

            const tmp = slotPrev; slotPrev = slotCur; slotCur = slotNext; slotNext = tmp;
        }
        gl.disable(gl.SCISSOR_TEST);
        gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    }

    function raycastSurfaceAt(ndcX, ndcY, eye) {
        if (!packedWorld || !hasInitialBuild) return null;
        const inv = latestInvVP;
        const unproj = (z) => {
            const w = ndcX * inv[3] + ndcY * inv[7] + z * inv[11] + inv[15];
            return [
                (ndcX * inv[0] + ndcY * inv[4] + z * inv[8] + inv[12]) / w,
                (ndcX * inv[1] + ndcY * inv[5] + z * inv[9] + inv[13]) / w,
                (ndcX * inv[2] + ndcY * inv[6] + z * inv[10] + inv[14]) / w
            ];
        };
        const farP = unproj(1.0);
        const rayDir = norm3([farP[0] - eye[0], farP[1] - eye[1], farP[2] - eye[2]]);
        const span = [
            packedWorld.worldMax[0] - packedWorld.worldMin[0],
            packedWorld.worldMax[1] - packedWorld.worldMin[1],
            packedWorld.worldMax[2] - packedWorld.worldMin[2]
        ];
        const vox = Math.max(span[0] / volNX, span[1] / volNY, span[2] / volNZ);

        gl.disable(gl.DEPTH_TEST);
        gl.bindVertexArray(quadVao);
        gl.viewport(0, 0, 1, 1);
        gl.bindFramebuffer(gl.FRAMEBUFFER, pickFbo);
        gl.useProgram(sdfPickProg);
        gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_3D, sdfTex);
        gl.uniform1i(gl.getUniformLocation(sdfPickProg, 'uSdfVol'), 0);
        gl.uniform3fv(gl.getUniformLocation(sdfPickProg, 'uCamPos'), eye);
        gl.uniform3fv(gl.getUniformLocation(sdfPickProg, 'uRayDir'), rayDir);
        gl.uniform3fv(gl.getUniformLocation(sdfPickProg, 'uBoxMin'), packedWorld.worldMin);
        gl.uniform3fv(gl.getUniformLocation(sdfPickProg, 'uBoxMax'), packedWorld.worldMax);
        gl.uniform1f(gl.getUniformLocation(sdfPickProg, 'uMinStep'), vox * 0.16);
        gl.uniform1f(gl.getUniformLocation(sdfPickProg, 'uSurfaceEps'), vox * 0.55);
        gl.uniform1f(gl.getUniformLocation(sdfPickProg, 'uPixelCone'), 1.7 / Math.max(2, canvas.height));
        gl.uniform1f(gl.getUniformLocation(sdfPickProg, 'uNormalEps'), vox * 0.45);
        gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);

        const posBuf = new Float32Array(4);
        const normBuf = new Float32Array(4);
        gl.readBuffer(gl.COLOR_ATTACHMENT0);
        gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.FLOAT, posBuf);
        gl.readBuffer(gl.COLOR_ATTACHMENT1);
        gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.FLOAT, normBuf);
        gl.bindFramebuffer(gl.FRAMEBUFFER, null);

        if (posBuf[3] < 0.5) return null;
        return {
            hit: true,
            pos: [posBuf[0], posBuf[1], posBuf[2]],
            normal: norm3([normBuf[0], normBuf[1], normBuf[2]])
        };
    }

    function render(opts) {
        if (suspended) return;
        const {
            camera, timeSec, waveScale, clarity, foamGain, sunDeg, oceanOn
        } = opts;

        bakeSlicesStep(16);

        const dpr = Math.min(window.devicePixelRatio || 1, 2);
        const w = Math.max(2, Math.floor(canvas.clientWidth * dpr));
        const h = Math.max(2, Math.floor(canvas.clientHeight * dpr));
        if (canvas.width !== w || canvas.height !== h) {
            canvas.width = w;
            canvas.height = h;
        }
        ensureSceneTargets(w, h);

        const cp = Math.cos(camera.Pitch), sp = Math.sin(camera.Pitch);
        const sy = Math.sin(camera.Yaw), cy = Math.cos(camera.Yaw);
        const eye = [
            camera.Target[0] + camera.Orbit * cp * sy,
            camera.Target[1] + camera.Orbit * sp,
            camera.Target[2] + camera.Orbit * cp * cy
        ];
        const nearZ = 0.25, farZ = 8000.0;
        const proj = perspective(45 * Math.PI / 180, w / h, nearZ, farZ);
        const view = lookAt(eye, camera.Target);
        const viewProj = mat4Mul(proj, view);
        latestInvVP = mat4Inverse(viewProj);

        const sunRad = sunDeg * Math.PI / 180.0;
        // Keep the sun broadly in front of the default three-quarter view so the
        // camera-facing slopes are lit rather than silhouetted.
        const sunDir = norm3([0.52 * Math.cos(sunRad), Math.sin(sunRad), 0.78 * Math.cos(sunRad)]);

        // PASS 1: HDR Sky + Full-Resolution 3D SDF Sphere-Trace into underwaterFbo
        gl.bindFramebuffer(gl.FRAMEBUFFER, underwaterFbo);
        gl.viewport(0, 0, w, h);
        gl.enable(gl.DEPTH_TEST);
        gl.depthMask(true);            // glClear honours the depth write mask in GLES
        gl.clearColor(0, 0, 0, 1);
        gl.clearDepth(1.0);
        gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);

        gl.disable(gl.DEPTH_TEST);
        gl.depthMask(false);
        gl.useProgram(skyProg);
        gl.uniformMatrix4fv(gl.getUniformLocation(skyProg, 'uInvViewProj'), false, latestInvVP);
        gl.uniform3fv(gl.getUniformLocation(skyProg, 'uCamPos'), eye);
        gl.uniform3fv(gl.getUniformLocation(skyProg, 'uSunDir'), sunDir);
        gl.uniform1f(gl.getUniformLocation(skyProg, 'uTime'), timeSec);
        gl.bindVertexArray(quadVao);
        gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);

        if (packedWorld) {
            const span = [
                packedWorld.worldMax[0] - packedWorld.worldMin[0],
                packedWorld.worldMax[1] - packedWorld.worldMin[1],
                packedWorld.worldMax[2] - packedWorld.worldMin[2]
            ];
            const vox = Math.max(span[0] / volNX, span[1] / volNY, span[2] / volNZ);

            gl.enable(gl.DEPTH_TEST);
            gl.depthFunc(gl.ALWAYS);
            gl.depthMask(true);
            gl.useProgram(sdfRaymarchProg);
            gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_3D, sdfTex);
            gl.uniform1i(gl.getUniformLocation(sdfRaymarchProg, 'uSdfVol'), 0);
            gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_3D, matTex);
            gl.uniform1i(gl.getUniformLocation(sdfRaymarchProg, 'uMatVol'), 1);
            gl.uniformMatrix4fv(gl.getUniformLocation(sdfRaymarchProg, 'uInvViewProj'), false, latestInvVP);
            gl.uniformMatrix4fv(gl.getUniformLocation(sdfRaymarchProg, 'uViewProj'), false, viewProj);
            gl.uniform3fv(gl.getUniformLocation(sdfRaymarchProg, 'uCamPos'), eye);
            gl.uniform3fv(gl.getUniformLocation(sdfRaymarchProg, 'uSunDir'), sunDir);
            gl.uniform3fv(gl.getUniformLocation(sdfRaymarchProg, 'uBoxMin'), packedWorld.worldMin);
            gl.uniform3fv(gl.getUniformLocation(sdfRaymarchProg, 'uBoxMax'), packedWorld.worldMax);
            gl.uniform3fv(gl.getUniformLocation(sdfRaymarchProg, 'uLayerColors[0]'), layerColorsFlat);
            gl.uniform1f(gl.getUniformLocation(sdfRaymarchProg, 'uMinStep'), vox * 0.16);
            gl.uniform1f(gl.getUniformLocation(sdfRaymarchProg, 'uSurfaceEps'), vox * 0.55);
            // One screen pixel expressed in world units at distance t (45deg vertical FOV).
            gl.uniform1f(gl.getUniformLocation(sdfRaymarchProg, 'uPixelCone'), 1.7 / h);
            gl.uniform1f(gl.getUniformLocation(sdfRaymarchProg, 'uNormalEps'), vox * 0.55);
            gl.uniform1f(gl.getUniformLocation(sdfRaymarchProg, 'uTime'), timeSec);
            gl.uniform1i(gl.getUniformLocation(sdfRaymarchProg, 'uOceanOn'), oceanOn ? 1 : 0);
            gl.uniform4fv(gl.getUniformLocation(sdfRaymarchProg, 'uSculptCursor'), sculptCursorUniform);
            gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
        }

        // PASS 2: Unified Analytic Ocean Plane Composite + ACES Tone-Map onto Default Backbuffer
        gl.bindFramebuffer(gl.FRAMEBUFFER, null);
        gl.viewport(0, 0, w, h);
        gl.disable(gl.DEPTH_TEST);
        gl.depthMask(false);
        gl.disable(gl.BLEND);
        gl.useProgram(oceanCompositeProg);
        gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, underwaterColorTex);
        gl.uniform1i(gl.getUniformLocation(oceanCompositeProg, 'uSceneColor'), 0);
        gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, underwaterDepthTex);
        gl.uniform1i(gl.getUniformLocation(oceanCompositeProg, 'uSceneDepth'), 1);
        gl.uniformMatrix4fv(gl.getUniformLocation(oceanCompositeProg, 'uInvViewProj'), false, latestInvVP);
        gl.uniform3fv(gl.getUniformLocation(oceanCompositeProg, 'uCamPos'), eye);
        gl.uniform3fv(gl.getUniformLocation(oceanCompositeProg, 'uSunDir'), sunDir);
        gl.uniform1f(gl.getUniformLocation(oceanCompositeProg, 'uTime'), timeSec);
        gl.uniform1i(gl.getUniformLocation(oceanCompositeProg, 'uOceanOn'), oceanOn ? 1 : 0);
        gl.uniform1f(gl.getUniformLocation(oceanCompositeProg, 'uWaveScale'), waveScale);
        gl.uniform1f(gl.getUniformLocation(oceanCompositeProg, 'uClarity'), clarity);
        gl.uniform1f(gl.getUniformLocation(oceanCompositeProg, 'uFoamGain'), foamGain);
        const voxelSize = packedWorld
            ? Math.max(
                (packedWorld.worldMax[0] - packedWorld.worldMin[0]) / volNX,
                (packedWorld.worldMax[2] - packedWorld.worldMin[2]) / volNZ)
            : 2.0;
        gl.uniform1f(gl.getUniformLocation(oceanCompositeProg, 'uVoxelSize'), voxelSize);
        gl.bindVertexArray(quadVao);
        gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
        gl.bindVertexArray(null);
    }

    return {
        GPU_RENDERER,
        MAX_3D_SIZE,
        DEFAULT_NY,
        setResolution(nx, ny, nz) {
            if (nx === volNX && ny === volNY && nz === volNZ) return true;
            const prev = [volNX, volNY, volNZ];
            try {
                allocateVolume(nx, ny, nz);
                return true;
            } catch (err) {
                try { allocateVolume(prev[0], prev[1], prev[2]); } catch {}
                throw err;
            }
        },
        getResolution() { return { nx: volNX, ny: volNY, nz: volNZ }; },
        uploadWorldData,
        applySculptSegment,
        raycastSurfaceAt,
        setSculptCursor(x, y, z, r) { sculptCursorUniform = [x, y, z, r]; },
        clearSculptCursor() { sculptCursorUniform = [0, 0, 0, -1]; },
        getWorldBounds() {
            if (!packedWorld) return null;
            const [ax, ay, az] = packedWorld.worldMin, [bx, by, bz] = packedWorld.worldMax;
            const { nx, ny, nz } = { nx: volNX, ny: volNY, nz: volNZ };
            return {
                min: packedWorld.worldMin, max: packedWorld.worldMax,
                // Flat, order-independent signature: if this string changes, the global field was resampled.
                signature: `${ax.toFixed(2)},${ay.toFixed(2)},${az.toFixed(2)}|${bx.toFixed(2)},${by.toFixed(2)},${bz.toFixed(2)}|${nx}x${ny}x${nz}`,
                voxel: [(bx - ax) / nx, (by - ay) / ny, (bz - az) / nz],
                visibleLayers: packedWorld.layerInfos.length
            };
        },
        isBuilding() { return building; },
        suspend() { suspended = true; },
        resume() { suspended = false; },
        render
    };
}
