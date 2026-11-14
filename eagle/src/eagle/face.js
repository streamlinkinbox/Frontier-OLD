import * as THREE from 'three';

// ------------------------------------------------------------------------------------------------
// Bill, eyes and lids of the bald eagle, modelled in head-local space (origin at the occipital
// condyle, +z toward the bill, +y up; the head bone carries a 1.1 scale).
//
// Bill profile digitised from side-profile photographs of adult bald eagles (scaled to the head):
//   culmen: long, deep and laterally compressed, strongly decurved into a sharp hook;
//   tomium: straight under the lores, with a shallow festoon (the "tooth" bulge) before the hook;
//   cere: smooth, the same chrome-yellow, with an oval nostril; the fleshy gape runs back under the eye.
// ------------------------------------------------------------------------------------------------

const lerp = (a, b, t) => a + (b - a) * t;
const clamp01 = (x) => Math.min(1, Math.max(0, x));
const ss = (a, b, x) => { const t = clamp01((x - a) / (b - a)); return t * t * (3 - 2 * t); };

// arc-length parametrised 2-D polyline in (z, y)
function polyline(pts) {
  const L = [0];
  for (let i = 1; i < pts.length; i++) L.push(L[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]));
  const tot = L[L.length - 1];
  const cr = new THREE.CatmullRomCurve3(pts.map(([z, y]) => new THREE.Vector3(0, y, z)), false, 'centripetal');
  return (u) => { const p = cr.getPointAt(clamp01(u)); return [p.z, p.y]; };
}

const CULMEN = polyline([[0.079, 0.0318], [0.090, 0.0336], [0.100, 0.0339], [0.110, 0.0323], [0.119, 0.0286], [0.1268, 0.0222], [0.1318, 0.0128], [0.1340, 0.0022], [0.1333, -0.0080], [0.1303, -0.0170], [0.1259, -0.0238], [0.1215, -0.0286]]);
const TOMIUM = polyline([[0.050, -0.0032], [0.066, -0.0058], [0.080, -0.0092], [0.093, -0.0121], [0.103, -0.0134], [0.1105, -0.0137], [0.1163, -0.0162], [0.1198, -0.0205], [0.1215, -0.0250], [0.1215, -0.0286]]);
// half-width of the upper mandible along its length (widest at the gape, compressed toward the hook)
const WIDTH = (u) => lerp(0.0128, 0.0012, Math.pow(u, 1.15)) * (1 + 0.12 * ss(0.0, 0.08, 0.08 - u));
// lower mandible: top = lower tomium (just inside the upper), bottom = gonys
const LTOP = polyline([[0.051, -0.0045], [0.070, -0.0079], [0.089, -0.0113], [0.104, -0.0131], [0.1155, -0.0158], [0.1185, -0.0182]]);
const LBOT = polyline([[0.049, -0.0175], [0.070, -0.0195], [0.089, -0.0203], [0.104, -0.0201], [0.1145, -0.0192], [0.1185, -0.0182]]);

// SkinnedMesh-ready geometry accumulator for rigid parts (each vertex has one bone)
class Part {
  constructor() { this.p = []; this.n = []; this.uv = []; this.c = []; this.r = []; this.loc = []; this.si = []; this.sw = []; this.i = []; }
  get count() { return this.p.length / 3; }
  vert(local, M, bone, col, rough, uv = [0, 0]) {
    const w = local.clone().applyMatrix4(M);
    this.p.push(w.x, w.y, w.z); this.loc.push(local.x, local.y, local.z);
    this.c.push(col.r, col.g, col.b); this.r.push(rough); this.uv.push(uv[0], uv[1]);
    this.si.push(bone, 0, 0, 0); this.sw.push(1, 0, 0, 0);
    return this.count - 1;
  }
  grid(rows, cols, base, flip = false, wrap = false) {
    const C = wrap ? cols : cols - 1;
    for (let j = 0; j < rows - 1; j++) for (let k = 0; k < C; k++) {
      const k2 = (k + 1) % cols;
      const a = base + j * cols + k, b = base + j * cols + k2, c = base + (j + 1) * cols + k, d = base + (j + 1) * cols + k2;
      if (!flip) this.i.push(a, c, b, b, c, d); else this.i.push(a, b, c, b, d, c);
    }
  }
  build() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.p, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.c, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
    g.setAttribute('aRough', new THREE.Float32BufferAttribute(this.r, 1));
    g.setAttribute('aLocal', new THREE.Float32BufferAttribute(this.loc, 3));
    g.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(this.si, 4));
    g.setAttribute('skinWeight', new THREE.Float32BufferAttribute(this.sw, 4));
    g.setIndex(this.i);
    g.computeVertexNormals();
    return g;
  }
}

const BILL = new THREE.Color(0xeab42e);     // deep chrome yellow (slightly orange toward the base)
const BILL_TIP = new THREE.Color(0xf1dca6); // worn, paler ivory-yellow hook
const CERE = new THREE.Color(0xf0c444);
const MOUTH = new THREE.Color(0x9a7f86);
const MOUTH_DARK = new THREE.Color(0x4b3a3d);

export function buildBill(rig) {
  rig.root.updateMatrixWorld(true);
  const M = rig.head.matrixWorld;
  const up = rig.upperBill.userData.index, lo = rig.jaw.userData.index;
  const out = new Part();
  const NU = 56, NS = 26; // along / around (left tomium → culmen → right tomium)
  const thick = 0.0016;
  const col = (u, inner) => {
    if (inner) return MOUTH.clone().lerp(MOUTH_DARK, 0.3 * (1 - u));
    const c = CERE.clone().lerp(BILL, ss(0.1, 0.24, u));
    return c.lerp(BILL_TIP, ss(0.55, 1.0, u) * 0.85);
  };
  // ---- upper mandible: outer shell + palate, joined along the tomium
  const sec = (u, s, inner) => {
    // s ∈ [−1, 1]: −1 left tomium, 0 culmen, +1 right tomium
    const [cz, cy] = CULMEN(u), [tz, ty] = TOMIUM(u);
    const a = Math.abs(s);
    const W = WIDTH(u);
    // section: rounded culmen ridge, flat slightly bulging sides, a little flare at the cutting edge
    const lat = Math.sin(Math.min(1, a / 0.42) * Math.PI / 2) * (1 + 0.06 * Math.sin(Math.PI * a)) + 0.05 * ss(0.8, 1, a);
    const down = a < 0.42 ? 0.42 * (1 - Math.cos(a / 0.42 * Math.PI / 2)) * 0.55 : 0.231 + (a - 0.42) / 0.58 * 0.769;
    let x = Math.sign(s) * W * lat, z = lerp(cz, tz, down), y = lerp(cy, ty, down);
    if (inner) {
      // palate: offset inward and upward; a median ridge
      const k = 1 - Math.min(1, thick / Math.max(1e-4, W));
      x *= k * 0.9; const lift = thick * 1.6 * (1 - 0.6 * a) * (1 - u * 0.6); z -= lift * 0.3; y += lift * (a < 0.98 ? 1 : 0);
      if (u > 0.97) { x *= 0.5; }
    }
    return new THREE.Vector3(x, y, z);
  };
  const baseO = out.count;
  for (let j = 0; j <= NU; j++) {
    const u = Math.pow(j / NU, 0.85);
    for (let k = 0; k <= NS; k++) { const s = -1 + 2 * k / NS; out.vert(sec(u, s, false), M, up, col(u, false), lerp(0.34, 0.26, u), [k / NS, u]); }
  }
  out.grid(NU + 1, NS + 1, baseO, false);
  const baseI = out.count;
  for (let j = 0; j <= NU; j++) {
    const u = Math.pow(j / NU, 0.85);
    for (let k = 0; k <= NS; k++) { const s = -1 + 2 * k / NS; out.vert(sec(u, s * 0.985, true), M, up, col(u, true), 0.5, [k / NS, u]); }
  }
  out.grid(NU + 1, NS + 1, baseI, true);
  // ---- lower mandible: outer surface (left top edge → under → right top edge) + mouth floor
  const lsec = (u, s, inner) => {
    const [tz, ty] = LTOP(u), [bz, by] = LBOT(u);
    const a = Math.abs(s);
    const W = WIDTH(u * 0.88) * 0.86 * (1 - 0.7 * ss(0.8, 1, u));
    const lat = Math.sin(Math.min(1, (1 - a) / 0.5) * Math.PI / 2);
    const down = a > 0.5 ? (1 - a) / 0.5 * 0.75 : 0.75 + (0.5 - a) / 0.5 * 0.25;
    let x = Math.sign(s) * W * (0.25 + 0.75 * lat), z = lerp(tz, bz, down), y = lerp(ty, by, down);
    if (inner) { x *= 0.82; y = lerp(ty, by, 0.3) + 0.001; z = lerp(tz, bz, 0.3); }
    return new THREE.Vector3(x, y, z);
  };
  const baseL = out.count;
  for (let j = 0; j <= 30; j++) {
    const u = j / 30;
    for (let k = 0; k <= 16; k++) { const s = -1 + 2 * k / 16 + (k === 8 ? 1e-4 : 0); out.vert(lsec(u, s, false), M, lo, col(u * 0.9, false), 0.34, [k / 16, u]); }
  }
  out.grid(31, 17, baseL, true);
  const baseF = out.count;
  for (let j = 0; j <= 30; j++) {
    const u = j / 30;
    for (let k = 0; k <= 8; k++) { const s = -1 + 2 * k / 8; out.vert(lsec(u, s, true), M, lo, col(u, true), 0.45, [k / 8, u]); }
  }
  out.grid(31, 9, baseF, false);
  // ---- tongue: a fleshy wedge on the mouth floor
  const baseT = out.count;
  const TONGUE = new THREE.Color(0xb08a8c);
  for (let j = 0; j <= 12; j++) {
    const u = j / 12;
    const [tz, ty] = LTOP(lerp(0.05, 0.7, u)), [bz, by] = LBOT(lerp(0.05, 0.7, u));
    for (let k = 0; k <= 8; k++) {
      const a = k / 8 * Math.PI;
      const w = 0.0062 * (1 - 0.65 * u * u), hgt = 0.0028 * (1 - 0.5 * u);
      const p = new THREE.Vector3(Math.cos(a) * w, lerp(ty, by, 0.3) + 0.0012 + Math.sin(a) * hgt, lerp(tz, bz, 0.3) - 0.002);
      out.vert(p, M, lo, TONGUE, 0.42, [k / 8, u]);
    }
  }
  out.grid(13, 9, baseT, true);
  return out.build();
}

// ------------------------------------------------------------------------------------------------
// Eyes: eyeball (iris texture on the gaze pole), dark lid rims, upper/lower lids, nictitating membrane
export function buildEyes(rig, eyeR = 0.0105) {
  rig.root.updateMatrixWorld(true);
  const ball = new Part(), lids = new Part(), nict = new Part();
  const W = new THREE.Color(0xffffff);
  // adult female: narrow bare yellow orbital ring, lid margin only slightly darker (no black eyeliner)
  const LID = new THREE.Color(0xd9bd62);
  const RIM = new THREE.Color(0x9c8240);
  const open = 0.72; // polar half-angle of the lid opening (rad)
  for (const E of rig.eyes) {
    const flip = E.eye.matrixWorld.determinant() < 0;
    // eyeball: pole along +z (gaze); v = 1 at the pole
    const Me = E.eye.matrixWorld, bi = E.eye.userData.index;
    const NT = 40, NP = 48, b0 = ball.count;
    for (let j = 0; j <= NT; j++) {
      const th = (j / NT) * Math.PI * 0.75; // only the front 135° (the rest is inside the head)
      for (let k = 0; k <= NP; k++) {
        const ph = (k / NP) * Math.PI * 2;
        // the cornea bulges a little in front of the iris plane
        const r = eyeR * (1 + 0.07 * Math.pow(Math.max(0, Math.cos(th * 2.2)), 2) * (th < 0.72 ? 1 : 0));
        const p = new THREE.Vector3(Math.sin(th) * Math.cos(ph) * r, Math.sin(th) * Math.sin(ph) * r, Math.cos(th) * r);
        p.z -= 0.0015; // seated a little deeper in the orbit
        ball.vert(p, Me, bi, W, 0.1, [k / NP, 1 - th / Math.PI]);
      }
    }
    ball.grid(NT + 1, NP + 1, b0, flip);
    // lids: spherical shells just outside the eye, upper (y > 0) and lower (y < 0) halves; they rotate
    // about the eye's x axis to blink. The rim (lid margin) is a dark band.
    for (const [bone, upper] of [[E.up, true], [E.lo, false]]) {
      const Ml = bone.matrixWorld, li = bone.userData.index;
      const NA = 28, NR = 10, l0 = lids.count;
      for (let k = 0; k <= NA; k++) {
        const ph = (upper ? 0 : Math.PI) + (k / NA) * Math.PI;
        for (let j = 0; j <= NR; j++) {
          const t = j / NR;
          const th = lerp(open - 0.03, 1.75, Math.pow(t, 2.2));
          const r = eyeR * (1.03 + 0.035 * t) + (j === 0 ? 0.0002 : 0.0004);
          const p = new THREE.Vector3(Math.sin(th) * Math.cos(ph) * r, Math.sin(th) * Math.sin(ph) * r, Math.cos(th) * r - 0.0015);
          const c = j === 0 ? RIM : j === 1 ? RIM.clone().lerp(LID, 0.5) : LID;
          lids.vert(p, Ml, li, c, 0.6);
        }
      }
      lids.grid(NA + 1, NR + 1, l0, !flip);
    }
    // nictitating membrane: a translucent sheet hinged at the front (nasal) corner
    {
      const Mn = E.ni.matrixWorld, ni = E.ni.userData.index, n0 = nict.count;
      for (let k = 0; k <= 16; k++) {
        const ph = -Math.PI / 2 + (k / 16) * Math.PI;
        for (let j = 0; j <= 12; j++) {
          const th = (j / 12) * (open + 0.1);
          const r = eyeR * 1.035;
          // folded into the front corner (−x side of the gaze frame is toward the bill)
          const p = new THREE.Vector3(Math.sin(th) * Math.cos(ph) * r, Math.sin(th) * Math.sin(ph) * r, Math.cos(th) * r);
          p.z -= 0.0015;
          p.applyAxisAngle(new THREE.Vector3(0, 1, 0), -1.62); // parked in the nasal corner; the bone sweeps it across
          nict.vert(p, Mn, ni, new THREE.Color(0xdfe6ea), 0.15);
        }
      }
      nict.grid(17, 13, n0, !flip);
    }
  }
  return { ball: ball.build(), lids: lids.build(), nict: nict.build() };
}
