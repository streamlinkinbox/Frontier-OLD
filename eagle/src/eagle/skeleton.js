import * as THREE from 'three';
import { BONES, TRUNK, PRIMARIES, N_SECONDARIES, secondaryLength, N_TERTIALS, tertialLength, RECTRICES, deg } from './anatomy.js';

// ------------------------------------------------------------------------------------------------
// Rig: a single skeleton for the whole bird.
//   trunk (spine / pelvis / sternum as one rigid unit — the avian trunk is largely fused)
//   ├─ n0 … n13 cervical vertebrae ── head ── upperBill (prokinetic hinge), jaw, eyelids
//   ├─ tail (pygostyle) ── rectrices r1…r6 (+ mirrored)
//   ├─ LEFT: humerus ── ulna ── hand (carpometacarpus) ── digit (+ alula)   | femur ── tibiotarsus ── tarsometatarsus ── foot ── toes
//   └─ mirror (scale −1 on X) ── RIGHT side, identical hierarchy
// Every flight feather and every covert row feather has its own bone whose local orientation is
// driven by the wing joint angles (feather linkage, see Rig.updateFeathers).
//
// Wing bone frames: +X distal along the bone, +Y dorsal, +Z anterior (leading edge).
//   shoulder:  R = Rz(elevation) · Ry(−sweep) · Rx(twist)      (twist + = pronation / leading edge down)
//   elbow:     Ry(−flex)  — the forearm folds toward the leading edge (propatagium fills the angle)
//   wrist:     Ry(+flex)  — the hand folds back toward the trailing edge
// Leg bone frames: bone extends along −Y.   Toe frames: toe extends along +Z.
// Feather frames: +Z rachis (base → tip), +Y dorsal, −X outer vane, +X inner vane.

const _q = new THREE.Quaternion(), _m = new THREE.Matrix4(), _v = new THREE.Vector3(), _v2 = new THREE.Vector3();
const lerp = (a, b, t) => a + (b - a) * t;
const clamp01 = (x) => Math.min(1, Math.max(0, x));
const ss = (a, b, x) => { const t = clamp01((x - a) / (b - a)); return t * t * (3 - 2 * t); };

// Toes: [name, yaw (deg, + = lateral for the left foot), pitch, phalanx lengths incl. claw]
export const TOES = [
  { name: 'hallux', yaw: 180 - 12, lens: [0.030, 0.043], base: [0.000, 0.0, -0.004], width: 0.0125 },
  { name: 'inner', yaw: -24, lens: [0.026, 0.022, 0.038], base: [-0.006, 0.0, 0.004], width: 0.0120 },
  { name: 'middle', yaw: 2, lens: [0.030, 0.030, 0.031], base: [0.0, 0.0, 0.006], width: 0.0115 },
  { name: 'outer', yaw: 30, lens: [0.022, 0.022, 0.026], base: [0.006, 0.0, 0.003], width: 0.0105 },
];

// ------------------------------------------------------------------------------------------------
// Wing feather layout (left wing, in the frame of the carrying bone).
//   phiS / phiF : in-plane angle (deg) measured from "straight back" (−Z) toward distal (+X), spread / folded
//   foldSrc     : which joint drives the spread↔fold interpolation
function wingLayout() {
  const L = [];
  // primaries p1…p10 — p1–p6 on the carpometacarpus, p7–p10 on the phalanges of the major digit
  PRIMARIES.forEach((P, i) => {
    const onDigit = i >= 6;
    const x = onDigit ? [0.004, 0.026, 0.048, 0.068][i - 6] : 0.004 + i * (0.100 / 5);
    L.push({
      kind: 'primary', i, bone: onDigit ? 'digit' : 'hand', x, z: -0.006, len: P.len, width: P.w * 1.02,
      phiS: 14 + i * 7.2, splay: [0, 0, 1, 2, 3, 5, 8, 11, 15, 20][i], phiF: 88 + i * 0.5,
      foldSrc: 'wrist', rank: 18 + i, twoBone: true, P,
    });
  });
  // secondaries s1 (wrist) … s15 (elbow) on the ulna
  for (let i = 0; i < N_SECONDARIES; i++) {
    const u = i / (N_SECONDARIES - 1);
    L.push({
      kind: 'secondary', i, bone: 'ulna', x: BONES.ulna - 0.008 - u * (BONES.ulna - 0.03), z: -0.007,
      len: secondaryLength(i), width: 0.074, phiS: 8 - 16 * u, phiF: -90 + 3 * u, foldSrc: 'elbow',
      rank: 17 - i, twoBone: true,
    });
  }
  // tertials near the elbow on the distal humerus
  for (let i = 0; i < N_TERTIALS; i++) {
    L.push({
      kind: 'tertial', i, bone: 'humerus', x: BONES.humerus - 0.012 - i * 0.02, z: -0.006, len: tertialLength(i), width: 0.07,
      phiS: -12 - 10 * i, phiF: -96 - 4 * i, foldSrc: 'elbow', rank: 2 - i, twoBone: false,
    });
  }
  // greater secondary coverts (dorsal) — overlie the bases of the secondaries
  for (let i = 0; i < 14; i++) {
    const u = i / 13;
    L.push({
      kind: 'gsc', i, bone: 'ulna', x: BONES.ulna - 0.012 - u * (BONES.ulna - 0.03), z: 0.006, y: 0.009,
      len: 0.152 - 0.014 * u, width: 0.06, phiS: 12 - 18 * u, phiF: -86 + 2 * u, foldSrc: 'elbow', rank: -1, twoBone: false,
    });
  }
  // median coverts (dorsal)
  for (let i = 0; i < 13; i++) {
    const u = i / 12;
    L.push({
      kind: 'msc', i, bone: 'ulna', x: BONES.ulna - 0.02 - u * (BONES.ulna - 0.04), z: 0.022, y: 0.013,
      len: 0.092 - 0.01 * u, width: 0.046, phiS: 18 - 20 * u, phiF: -80 + 2 * u, foldSrc: 'elbow', rank: -2, twoBone: false,
    });
  }
  // greater primary coverts (dorsal)
  for (let i = 0; i < 10; i++) {
    const onDigit = i >= 7;
    L.push({
      kind: 'gpc', i, bone: onDigit ? 'digit' : 'hand', x: onDigit ? [0.01, 0.03, 0.05][i - 7] : 0.004 + i * (0.1 / 6), z: 0.004, y: 0.008,
      len: 0.12 + 0.012 * Math.sin(i / 9 * Math.PI), width: 0.046, phiS: 20 + i * 7.5, splay: i * 0.5, phiF: 86 + i * 0.4,
      foldSrc: 'wrist', rank: -1, twoBone: false,
    });
  }
  // underwing: greater under-secondary coverts and under-primary coverts (ventral)
  for (let i = 0; i < 14; i++) {
    const u = i / 13;
    L.push({
      kind: 'usc', i, bone: 'ulna', x: BONES.ulna - 0.012 - u * (BONES.ulna - 0.03), z: 0.004, y: -0.010,
      len: 0.13 - 0.01 * u, width: 0.055, phiS: 10 - 16 * u, phiF: -88 + 2 * u, foldSrc: 'elbow', rank: 40, twoBone: false, ventral: true,
    });
  }
  for (let i = 0; i < 9; i++) {
    L.push({
      kind: 'upc', i, bone: 'hand', x: 0.004 + i * (0.1 / 8), z: 0.003, y: -0.009,
      len: 0.105, width: 0.04, phiS: 20 + i * 7, phiF: 87, foldSrc: 'wrist', rank: 40, twoBone: false, ventral: true,
    });
  }
  // axillaries / tertial under-coverts on the humerus (ventral)
  for (let i = 0; i < 6; i++) {
    L.push({
      kind: 'axil', i, bone: 'humerus', x: 0.05 + i * 0.028, z: -0.004, y: -0.012,
      len: 0.15 - 0.008 * i, width: 0.055, phiS: -18 + i * 3, phiF: -92, foldSrc: 'elbow', rank: 40, twoBone: false, ventral: true,
    });
  }
  // alula (digit I): 4 feathers
  for (let i = 0; i < 4; i++) {
    L.push({
      kind: 'alula', i, bone: 'alula', x: 0.004 + i * 0.008, z: 0.002, y: 0.004 - i * 0.0015,
      len: [0.105, 0.09, 0.072, 0.055][i], width: 0.03, phiS: 172 - i * 6, phiF: 178, foldSrc: 'wrist', rank: -3, twoBone: false,
    });
  }
  // scapulars — carried by the humerus near the shoulder, cover the wing root on the back
  for (let i = 0; i < 8; i++) {
    L.push({
      kind: 'scap', i, bone: 'humerus', x: 0.012 + i * 0.012, z: 0.004 - i * 0.0015, y: 0.02 + i * 0.001,
      len: 0.10 + i * 0.012, width: 0.05, phiS: -28 - i * 6, phiF: -105 - i * 2, foldSrc: 'elbow', rank: -4, twoBone: false,
    });
  }
  return L;
}

export class Rig {
  constructor() {
    this.root = new THREE.Object3D();
    this.root.name = 'eagle-root';
    this.bones = [];
    this.byName = {};
    const trunk = this.trunk = this.bone('trunk', this.root, [0, 0, 0]);

    // ---- neck (bind: flight carriage — base rises forward then levels out)
    const nv = BONES.neckVertebrae, seg = BONES.neckLength / nv;
    this.neckSeg = seg;
    this.neck = [];
    this.neckRest = [];
    let parent = trunk;
    for (let i = 0; i < nv; i++) {
      const b = this.bone(`n${i}`, parent, i === 0 ? TRUNK.neckBase : [0, 0, seg]);
      const rest = i === 0 ? -0.62 : 0.62 / (nv - 1);
      this.neckRest.push(rest);
      b.rotation.x = rest;
      this.neck.push(b); parent = b;
    }
    this.head = this.bone('head', parent, [0, 0, seg]);
    this.upperBill = this.bone('upperBill', this.head, [0, 0.028, 0.088]); // craniofacial hinge
    this.jaw = this.bone('jaw', this.head, [0, -0.004, 0.036]);             // quadrate–mandible joint
    this.eyes = [];
    const headMirror = new THREE.Object3D(); headMirror.scale.set(-1, 1, 1); this.head.add(headMirror);
    for (let s = 0; s < 2; s++) {
      const par = s === 0 ? this.head : headMirror;
      const tag = s === 0 ? 'L' : 'R';
      const c = [0.0222, 0.0215, 0.0540];
      const eye = this.bone(`eye${tag}`, par, c);
      // eye looks lateral and ~32° forward
      eye.rotation.set(0, 0.99, 0, 'YXZ');
      const up = this.bone(`lidUp${tag}`, eye, [0, 0, 0]);
      const lo = this.bone(`lidLo${tag}`, eye, [0, 0, 0]);
      const ni = this.bone(`nict${tag}`, eye, [0, 0, 0]);
      this.eyes.push({ eye, up, lo, ni });
    }

    // ---- tail
    this.tail = this.bone('tail', trunk, TRUNK.pygostyle);
    const tailMirror = new THREE.Object3D(); tailMirror.scale.set(-1, 1, 1); this.tail.add(tailMirror);
    this.rectrices = [];
    for (let s = 0; s < 2; s++) {
      const par = s === 0 ? this.tail : tailMirror;
      for (let i = 0; i < 6; i++) {
        const b = this.bone(`r${i + 1}${s ? 'R' : 'L'}`, par, [0.003 + i * 0.0068, 0, 0.004 - i * 0.002]);
        const tipB = this.bone(`r${i + 1}${s ? 'R' : 'L'}t`, b, [0, 0, RECTRICES[i] * 0.5]);
        this.rectrices.push({ side: s, i, bone: b, tip: tipB, len: RECTRICES[i] });
      }
    }

    // ---- sides
    const mirror = new THREE.Object3D(); mirror.scale.set(-1, 1, 1); trunk.add(mirror);
    this.mirror = mirror;
    this.sides = [this.buildSide('L', trunk), this.buildSide('R', mirror)];

    this.skeleton = null;
  }

  bone(name, parent, pos) {
    const b = new THREE.Bone();
    b.name = name;
    b.position.fromArray(pos);
    parent.add(b);
    b.userData.index = this.bones.length;
    this.bones.push(b);
    this.byName[name] = b;
    return b;
  }

  buildSide(tag, par) {
    const S = { tag };
    S.humerus = this.bone(`hum${tag}`, par, TRUNK.shoulder);
    S.ulna = this.bone(`uln${tag}`, S.humerus, [BONES.humerus, 0, 0]);
    S.hand = this.bone(`hand${tag}`, S.ulna, [BONES.ulna, 0, 0]);
    S.digit = this.bone(`dig${tag}`, S.hand, [BONES.hand, 0, 0]);
    S.alula = this.bone(`alula${tag}`, S.hand, [0.008, 0.006, 0.012]);
    // feathers
    S.feathers = wingLayout().map((d) => {
      const f = { ...d };
      const carrier = { humerus: S.humerus, ulna: S.ulna, hand: S.hand, digit: S.digit, alula: S.alula }[d.bone];
      f.base = this.bone(`${d.kind}${d.i}${tag}`, carrier, [d.x, d.y || 0, d.z]);
      f.y0 = d.y || 0;
      if (d.twoBone) f.tip = this.bone(`${d.kind}${d.i}${tag}t`, f.base, [0, 0, d.len * 0.5]);
      return f;
    });
    // legs
    S.femur = this.bone(`fem${tag}`, par, TRUNK.hip);
    S.tib = this.bone(`tib${tag}`, S.femur, [0, -BONES.femur, 0]);
    S.tmt = this.bone(`tmt${tag}`, S.tib, [0, -BONES.tibiotarsus, 0]);
    S.foot = this.bone(`foot${tag}`, S.tmt, [0, -BONES.tarsometatarsus, 0]);
    S.toes = TOES.map((T) => {
      const chain = [];
      let p = S.foot;
      const root = this.bone(`${T.name}0${tag}`, p, T.base);
      root.rotation.set(0, T.yaw * deg, 0);
      chain.push(root); p = root;
      for (let k = 1; k < T.lens.length; k++) {
        const b = this.bone(`${T.name}${k}${tag}`, p, [0, 0, T.lens[k - 1]]);
        chain.push(b); p = b;
      }
      return { def: T, chain };
    });
    return S;
  }

  // Calibrate every wing feather's spread / fold angle (phiS, phiF) from target directions in trunk
  // space: in the glide the secondaries stream straight back and the primaries fan out to the
  // wingtip; in the Z-fold everything lies along the flank with the primary tips stacked over the tail.
  calibrate(glideWing, foldWing) {
    const S = this.sides[0];
    const trunkInv = new THREE.Matrix4();
    const rel = new THREE.Matrix4();
    const phiFor = (f, dir) => {
      this.root.updateMatrixWorld(true);
      trunkInv.copy(this.trunk.matrixWorld).invert();
      rel.multiplyMatrices(trunkInv, f.base.parent.matrixWorld);
      const inv = rel.clone().invert();
      const dl = dir.clone().transformDirection(inv);
      return Math.atan2(dl.x, -dl.z) / deg;
    };
    const basePos = (f) => { this.root.updateMatrixWorld(true); trunkInv.copy(this.trunk.matrixWorld).invert(); return f.base.getWorldPosition(new THREE.Vector3()).applyMatrix4(trunkInv); };
    const th = (a) => new THREE.Vector3(Math.sin(a * deg), 0, -Math.cos(a * deg));
    const glideAngle = (f) => {
      const n = { secondary: 14, gsc: 13, msc: 12, usc: 13 }[f.kind];
      const u = n ? f.i / n : 0;
      switch (f.kind) {
        case 'primary': return [12, 18, 25, 32, 40, 49, 58, 68, 79, 90][f.i];
        case 'secondary': return 7 - 11 * u;
        case 'tertial': return [-8, -16, -26][f.i];
        case 'gsc': case 'usc': return 8 - 12 * u;
        case 'msc': return 10 - 12 * u;
        case 'gpc': return 12 + f.i * 8.5;
        case 'upc': return 12 + f.i * 9;
        case 'axil': return -15 + f.i * 2.5;
        case 'alula': return 100 - f.i * 3;
        case 'scap': return -12 - f.i * 4;
      }
      return 0;
    };
    const foldTarget = (f) => {
      switch (f.kind) {
        case 'primary': return new THREE.Vector3(0.024 - 0.0015 * f.i, 0.04 - 0.002 * f.i, -0.44); // tips meet over the tail
        case 'secondary': return new THREE.Vector3(0.085, 0.01, -0.35 + 0.004 * f.i);
        case 'tertial': return new THREE.Vector3(0.065, 0.05, -0.27);
        case 'gsc': case 'msc': return new THREE.Vector3(0.09, 0.005, -0.30);
        case 'gpc': return new THREE.Vector3(0.07, 0.01, -0.30);
        case 'usc': case 'upc': case 'axil': return new THREE.Vector3(0.08, -0.02, -0.30);
        case 'alula': return new THREE.Vector3(0.09, 0.0, -0.20);
        case 'scap': return new THREE.Vector3(0.035, 0.07, -0.22);
      }
      return new THREE.Vector3(0, 0, -1);
    };
    this.setWing(0, glideWing);
    const res = [];
    for (const f of S.feathers) f._phiS = phiFor(f, th(glideAngle(f))) - (f.splay || 0) * (glideWing.spread ?? 1);
    this.setWing(0, foldWing);
    for (const f of S.feathers) f._phiF = phiFor(f, foldTarget(f).sub(basePos(f)).normalize());
    // share with the mirrored right wing (same local angles → symmetric)
    for (const side of this.sides) side.feathers.forEach((f, k) => { f.phiS = S.feathers[k]._phiS; f.phiF = S.feathers[k]._phiF; });
    // unwrap so interpolation takes the short way round
    for (const side of this.sides) for (const f of side.feathers) { while (f.phiF - f.phiS > 180) f.phiF -= 360; while (f.phiF - f.phiS < -180) f.phiF += 360; }
    return S.feathers.map((f) => [f.kind, f.i, +f.phiS.toFixed(1), +f.phiF.toFixed(1)]);
  }

  finalizeBind() {
    this.root.updateMatrixWorld(true);
    this.skeleton = new THREE.Skeleton(this.bones);
    // Skeleton() computes boneInverses from the current world matrices (bind pose).
  }

  // ---------------------------------------------------------------------------------------------
  // Wing: joint angles + feather linkage
  //   w = { elev, sweep, twist, elbow, wrist, handTwist, spread, fpitch, bend, alula, flutter, t }
  setWing(sideIndex, w) {
    const S = this.sides[sideIndex];
    S.humerus.rotation.set(w.twist, -w.sweep, w.elev, 'ZYX');
    S.ulna.rotation.set(w.foreTwist || 0, -w.elbow, -(w.armDroop || 0), 'YXZ');
    // radius–ulna "drawing parallels": the wrist flexes automatically with the elbow
    const wristTotal = w.wrist;
    // droop: + = hand tip below the arm plane (anhedral at the wrist); − = tip up (aerodynamic lag)
    S.hand.rotation.set(w.handTwist || 0, wristTotal, -(w.droop || 0), 'YXZ');
    S.digit.rotation.set(0, (w.digitFlex || 0), 0, 'YXZ');
    // alula: rotates forward/up off the leading edge when deployed
    S.alula.rotation.set(-0.25 * w.alula, 0.5 * w.alula, 0.15 * w.alula, 'YXZ');
    this.updateFeathers(S, w);
  }

  updateFeathers(S, w) {
    // fold fractions from joint angles (0 = spread flight wing, 1 = folded at rest)
    const fe = ss(0.5, 2.7, w.elbow);
    const fw = ss(0.45, 2.9, w.wrist);
    const spread = w.spread;
    const t = w.t || 0;
    const stackDy = lerp(0.0011, 0.0024, Math.max(fe, fw));
    for (const f of S.feathers) {
      const fold = f.foldSrc === 'elbow' ? fe : fw;
      let phi = lerp(f.phiS + (f.splay || 0) * spread, f.phiF, fold);
      let lift = 0, twist = 0, bend = 0;
      if (f.kind === 'primary') {
        const o = f.i / 9; // 0 inner → 1 outer
        // upstroke: primaries supinate and separate ("venetian blind"), more at the outer hand
        twist = -w.fpitch * (0.25 + 0.95 * o * o) + (w.pronate || 0) * 0.2 * o;
        // aerodynamic bending: tips curl upward under load; the emarginated outer primaries most
        bend = w.bend * (0.18 + 0.9 * o * o) * (1 - fold);
        lift = w.bend * 0.05 * o * (1 - fold);
        // high-frequency flutter of the free feather tips
        bend += (w.flutter || 0) * 0.02 * (0.3 + o) * Math.sin(t * (41 + f.i * 3.7) + f.i * 1.3) * (1 - fold);
        // in the folded wing the primaries tilt slightly so their tips lie in a tidy stack
        lift += fold * (0.02 + 0.006 * f.i);
        // folded: the primaries roll about their shafts so the stack lies flat over the closed tail
        // (seen from behind the wingtips read as two dark bands over the white tail, not edge-on blades)
        twist += (w.foldRoll || 0) * fold * (0.35 + 0.65 * o);
      } else if (f.kind === 'secondary') {
        bend = w.bend * 0.18 * (1 - fold) + (w.flutter || 0) * 0.012 * Math.sin(t * (33 + f.i * 2.1) + f.i) * (1 - fold);
        twist = -w.fpitch * 0.12 * (1 - f.i / 14);
        lift = fold * 0.015;
      } else if (f.kind === 'tertial') {
        lift = fold * 0.02;
      } else if (f.kind === 'alula') {
        phi += w.alula * 18;
        lift = -0.35 * w.alula;
      } else if (f.kind === 'scap') {
        // scapulars bridge the gap between wing root and back
        lift = 0.06 + 0.05 * fold;
      } else if (f.ventral) {
        lift = -0.04 - 0.05 * fold;
      } else { // dorsal coverts lie flat on the feathers under them; lift a touch when the wing is loaded
        lift = 0.025 + 0.02 * w.bend * (1 - fold) + (w.fluff || 0) * 0.18;
      }
      if (f.kind === 'gsc' || f.kind === 'msc' || f.kind === 'gpc') lift += (w.flutter || 0) * 0.02 * Math.sin(t * 27 + f.i * 2.3);
      f.base.rotation.set(-lift, Math.PI - phi * deg, twist, 'YXZ');
      if (f.rank !== undefined && f.rank >= 0 && f.rank < 40) f.base.position.y = f.y0 - f.rank * stackDy;
      if (f.tip) f.tip.rotation.set(-bend, 0, 0);
    }
  }

  // Tail: { pitch (+ tip up), yaw (+ tip to the left), roll, spread (0 closed … 1 fully fanned), bend }
  setTail(p) {
    this.tail.rotation.set(p.pitch, -p.yaw, p.roll, 'YXZ');
    const spread = p.spread;
    for (const r of this.rectrices) {
      // fan angle: central pair almost parallel, outer pair up to ~58° from the midline
      const u = r.i / 5;
      // closed: the rectrices stack over the central pair (a folded bald-eagle tail is ≈ 10–12 cm wide);
      // fanning moves the feather bases apart along the pygostyle as well as rotating them out
      const fan = Math.min(1, spread * 1.6);
      r.bone.position.x = 0.003 + r.i * lerp(0.0022, 0.0068, fan);
      const psi = (0.3 + r.i * lerp(0.25, 10.4, spread)) * deg + (p.asym || 0) * (r.side ? -1 : 1) * u * 0.1;
      // outer feathers sit lower (central pair on top) and droop slightly when spread
      const lift = -0.02 - u * 0.03 * spread + (p.fluff || 0) * 0.04;
      const twist = (-0.05 - 0.2 * u) * spread * 0.5; // outer vanes tilt down, like a shallow dish
      r.bone.rotation.set(-lift, Math.PI - psi, twist, 'YXZ');
      r.bone.position.y = -r.i * lerp(0.0028, 0.0016, spread);
      r.tip.rotation.set(-(p.bend || 0) * (0.5 + 0.5 * u), 0, 0);
    }
  }

  // Eyelids: up/lo in [0,1] (1 = closed), nict [0,1]
  setLids(up, lo, nict) {
    for (const e of this.eyes) {
      e.up.rotation.set(up * 0.82, 0, 0);
      e.lo.rotation.set(-lo * 0.78, 0, 0);
      e.ni.rotation.set(0, nict * 1.62, 0);
    }
  }

  setJaw(open) {
    this.jaw.rotation.set(open, 0, 0);
    // cranial prokinesis: the upper bill rotates up ~ 0.2 × gape at the craniofacial hinge
    this.upperBill.rotation.set(-open * 0.2, 0, 0);
  }

  // Aim a bone (bone axis = local `axis`) so it points along world direction `dir`,
  // with its local `upAxis` as close as possible to world `hint`. Works under mirrored parents.
  static aim(bone, dir, hint, axis = 'negY', upAxis = 'z') {
    const parent = bone.parent;
    parent.updateWorldMatrix(true, false);
    _m.copy(parent.matrixWorld).invert();
    const d = _v.copy(dir).transformDirection(_m);
    const h = _v2.copy(hint).transformDirection(_m);
    // transformDirection normalises; reflection is undone because we are in parent-local space
    const a = d.clone();
    let b = h.clone().addScaledVector(a, -h.dot(a)).normalize();
    if (!isFinite(b.x) || b.lengthSq() < 1e-8) b = new THREE.Vector3(0, 0, 1).addScaledVector(a, -a.z).normalize();
    // build basis
    let X, Y, Z;
    if (axis === 'negY' && upAxis === 'z') { Y = a.clone().negate(); Z = b; X = new THREE.Vector3().crossVectors(Y, Z); }
    else if (axis === 'z' && upAxis === 'y') { Z = a; Y = b; X = new THREE.Vector3().crossVectors(Y, Z); }
    else if (axis === 'x' && upAxis === 'y') { X = a; Y = b; Z = new THREE.Vector3().crossVectors(X, Y); }
    _m.makeBasis(X, Y, Z);
    bone.quaternion.setFromRotationMatrix(_m);
    bone.updateMatrixWorld(true);
  }
}
