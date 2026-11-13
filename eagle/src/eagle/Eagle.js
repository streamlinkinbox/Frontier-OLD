import * as THREE from 'three';
import { Rig } from './skeleton.js';
import { buildWingPlumage, buildTailPlumage, buildWingSkin } from './plumage.js';
import { buildBodyLoft, buildContourFeathers } from './body.js';
import { buildHead } from './head.js';
import { buildLegs } from './legs.js';
import { createMaterials, featherUniforms } from './materials.js';
import { createCoatMaterial } from './coat.js';
import { BONES, TRUNK } from './anatomy.js';
import { defaultPose, BIND_POSE, WING_GLIDE, WING_FOLD } from './pose.js';

const _v = new THREE.Vector3(), _v2 = new THREE.Vector3(), _v3 = new THREE.Vector3();
const _q = new THREE.Quaternion(), _q2 = new THREE.Quaternion(), _e = new THREE.Euler();
const _m = new THREE.Matrix4();
const clamp = (x, a, b) => Math.min(b, Math.max(a, x));
const lerp = (a, b, t) => a + (b - a) * t;

// ------------------------------------------------------------------------------------------------
// Neck: 14 vertebrae; the pitch is distributed with three basis curves (base, middle, top) and the
// yaw mostly in the upper neck (raptors turn the head with the cranial cervicals). A Gauss–Newton
// solve finds the base/mid pitch and a lateral S-bend so the atlas reaches the requested position;
// the head joint then supplies the remaining orientation (clamped).
class NeckSolver {
  constructor(rig) {
    this.rig = rig;
    const n = rig.neck.length;
    const gauss = (i, c, w) => Math.exp(-(((i - c) / w) ** 2));
    const norm = (arr) => { const s = arr.reduce((a, b) => a + b, 0); return arr.map((x) => x / s); };
    const I = [...Array(n).keys()];
    this.wA = norm(I.map((i) => gauss(i, 1.5, 2.6)));
    this.wB = norm(I.map((i) => gauss(i, 6.5, 2.6)));
    this.wC = norm(I.map((i) => gauss(i, 11.5, 2.4)));
    this.wY = norm(I.map((i) => 0.25 + gauss(i, 10, 3.5)));
    this.wE = I.map((i) => Math.sin((i / (n - 1)) * Math.PI * 2) * 0.12);
    this.p = [0, 0, 0]; // A, B, E (warm start)
    this.rest = rig.neckRest;
    this.seg = rig.neckSeg;
    this.base = new THREE.Vector3().fromArray(TRUNK.neckBase);
    this.q = [...Array(n)].map(() => new THREE.Quaternion());
  }
  rot(i, A, B, C, Y, E, R, out) {
    const pitch = this.rest[i] + A * this.wA[i] + B * this.wB[i] + C * this.wC[i];
    const yaw = Y * this.wY[i] + E * this.wE[i];
    _e.set(pitch, yaw, R * this.wY[i], 'YXZ');
    return out.setFromEuler(_e);
  }
  fk(A, B, C, Y, E, R, outPos, outQ) {
    const q = outQ.identity();
    const p = outPos.copy(this.base);
    for (let i = 0; i < this.rest.length; i++) {
      q.multiply(this.rot(i, A, B, C, Y, E, R, _q2));
      p.add(_v3.set(0, 0, this.seg).applyQuaternion(q));
    }
    return p;
  }
  /**
   * target: trunk-space atlas position; C: upper-neck pitch; Y: neck yaw; R: roll
   * headQ: desired head orientation (trunk space). Applies rotations to the bones.
   */
  solve(target, C, Y, R, headQ, headLimit = 1.0) {
    let [A, B, E] = this.p;
    const P = new THREE.Vector3(), Qt = new THREE.Quaternion(), P2 = new THREE.Vector3(), Q2 = new THREE.Quaternion();
    const J = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
    for (let it = 0; it < 4; it++) {
      this.fk(A, B, C, Y, E, R, P, Qt);
      const err = [target.x - P.x, target.y - P.y, target.z - P.z];
      if (Math.hypot(...err) < 2e-4) break;
      const h = 1e-3;
      const params = [A, B, E];
      for (let k = 0; k < 3; k++) {
        const pp = params.slice(); pp[k] += h;
        this.fk(pp[0], pp[1], C, Y, pp[2], R, P2, Q2);
        J[0][k] = (P2.x - P.x) / h; J[1][k] = (P2.y - P.y) / h; J[2][k] = (P2.z - P.z) / h;
      }
      // damped least squares: (JᵀJ + λI) Δ = Jᵀ e
      const lam = 0.002;
      const JT = (r, c) => J[c][r];
      const Mx = [[0, 0, 0], [0, 0, 0], [0, 0, 0]], bv = [0, 0, 0];
      for (let r = 0; r < 3; r++) {
        for (let c = 0; c < 3; c++) { let s = 0; for (let k = 0; k < 3; k++) s += JT(r, k) * J[k][c]; Mx[r][c] = s + (r === c ? lam : 0); }
        let s = 0; for (let k = 0; k < 3; k++) s += JT(r, k) * err[k]; bv[r] = s;
      }
      const d = solve3(Mx, bv);
      A = clamp(A + clamp(d[0], -0.5, 0.5), -2.2, 2.2);
      B = clamp(B + clamp(d[1], -0.5, 0.5), -2.6, 2.6);
      E = clamp(E + clamp(d[2], -0.5, 0.5), -3, 3);
    }
    this.p = [A, B, E];
    const neck = this.rig.neck;
    for (let i = 0; i < neck.length; i++) this.rot(i, A, B, C, Y, E, R, neck[i].quaternion);
    // head: remaining rotation relative to the top vertebra
    this.fk(A, B, C, Y, E, R, P, Qt);
    const local = Qt.clone().invert().multiply(headQ);
    // limit the atlanto-occipital rotation
    const ang = 2 * Math.acos(clamp(Math.abs(local.w), 0, 1));
    if (ang > headLimit) local.slerp(new THREE.Quaternion(), 1 - headLimit / ang);
    this.rig.head.quaternion.copy(local);
    return P;
  }
}
function solve3(M, b) {
  const [a, bb, c] = M[0], [d, e, f] = M[1], [g, h, i] = M[2];
  const det = a * (e * i - f * h) - bb * (d * i - f * g) + c * (d * h - e * g);
  if (Math.abs(det) < 1e-12) return [0, 0, 0];
  const inv = [
    [(e * i - f * h), -(bb * i - c * h), (bb * f - c * e)],
    [-(d * i - f * g), (a * i - c * g), -(a * f - c * d)],
    [(d * h - e * g), -(a * h - bb * g), (a * e - bb * d)],
  ];
  return [0, 1, 2].map((r) => (inv[r][0] * b[0] + inv[r][1] * b[1] + inv[r][2] * b[2]) / det);
}

// ------------------------------------------------------------------------------------------------
export class Eagle {
  constructor({ quality = 'high' } = {}) {
    const rig = this.rig = new Rig();
    this.object = rig.root;
    this.materials = createMaterials();
    this.neckSolver = new NeckSolver(rig);
    this.calibration = rig.calibrate(WING_GLIDE, WING_FOLD);
    BIND_POSE.head.pos.copy(this.neckSolver.fk(0, 0, 0, 0, 0, 0, new THREE.Vector3(), new THREE.Quaternion()));
    // --- bind pose (gliding wing, relaxed legs) → build every mesh in this pose
    this.applyPose(BIND_POSE, { bind: true });
    rig.finalizeBind();
    this.meshes = [];
    const M = this.materials;
    const add = (geo, mat, name, { shadow = true, order = 0 } = {}) => {
      const mesh = new THREE.SkinnedMesh(geo, mat);
      mesh.name = name;
      mesh.bind(rig.skeleton, new THREE.Matrix4());
      mesh.frustumCulled = false;
      mesh.castShadow = shadow; mesh.receiveShadow = true;
      mesh.renderOrder = order;
      rig.root.add(mesh);
      this.meshes.push(mesh);
      return mesh;
    };
    const density = quality === 'low' ? 0.6 : quality === 'ultra' ? 1.35 : 1;
    const loft = buildBodyLoft(rig);
    M.coat = createCoatMaterial();
    add(loft.geometry, M.coat, 'body-coat');
    void buildContourFeathers; void density;
    const wings = buildWingPlumage(rig);
    add(wings.flight, M.flight, 'flight-feathers');
    add(wings.covert, M.covert, 'wing-coverts');
    const wskin = buildWingSkin(rig);
    add(wskin.skin, M.coatWing = createCoatMaterial({ brown: 0x4a3524, brownEdge: 0x765840 }), 'wing-coverts-coat');
    const tail = buildTailPlumage(rig);
    add(tail.flight, M.tail, 'rectrices');
    add(tail.covert, M.tailCovert, 'tail-coverts');
    const head = this.head = buildHead(rig);
    add(head.skull, M.coat, 'head-coat');
    add(head.headFeathers, M.contour, 'head-feathers');
    add(head.upperBill, M.beak, 'upper-bill');
    add(head.lowerBill, M.beak, 'lower-bill');
    add(head.tongue, M.mouth, 'tongue', { shadow: false });
    add(head.mouth, M.mouth, 'mouth', { shadow: false });
    add(head.eyes, M.eye, 'eyes', { shadow: false });
    add(head.lids, M.lid, 'lids');
    add(head.nict, M.nict, 'nictitating', { shadow: false, order: 2 });
    const legs = buildLegs(rig);
    add(legs.skin, M.foot, 'feet');
    add(legs.talons, M.talon, 'talons');
    add(legs.shank, M.coat, 'trousers');
    add(legs.feathers, M.contour, 'trouser-feathers');
    // plumage is lit by the sky as well as the sun (dark brown feathers would otherwise read as black)
    this.skyLitMaterials = [M.flight, M.covert, M.coat, M.coatWing, M.contour, M.tail, M.tailCovert];
    this.pose = defaultPose();
    this.stats = { bones: rig.bones.length, triangles: this.meshes.reduce((s, m) => s + m.geometry.index.count / 3, 0) };
  }

  // Legs: 3-segment IK. femur keeps a bird-like forward-down attitude, tibiotarsus + tarsometatarsus
  // solve the reversed "ankle" (intertarsal joint points backward).
  solveLeg(side, footWorld, fwdWorld, upWorld, femurPitch, femurSplay, toeCurl, toeSpread) {
    const S = this.rig.sides[side];
    const sgn = side === 0 ? 1 : -1;
    S.femur.parent.updateWorldMatrix(true, false);
    const H = S.femur.getWorldPosition(new THREE.Vector3());
    const trunkM = this.rig.trunk.matrixWorld;
    const tUp = new THREE.Vector3(0, 1, 0).transformDirection(trunkM);
    const tFwd = new THREE.Vector3(0, 0, 1).transformDirection(trunkM);
    const tLeft = new THREE.Vector3(1, 0, 0).transformDirection(trunkM);
    // femur direction: forward/down in the trunk frame, splayed laterally
    const dF = tUp.clone().multiplyScalar(-Math.cos(femurPitch)).addScaledVector(tFwd, Math.sin(femurPitch)).addScaledVector(tLeft, sgn * femurSplay).normalize();
    let K = H.clone().addScaledVector(dF, BONES.femur);
    const Lt = BONES.tibiotarsus, Lm = BONES.tarsometatarsus;
    const F = footWorld.clone();
    let d = F.clone().sub(K);
    let dist = d.length();
    const maxR = (Lt + Lm) * 0.995, minR = Math.abs(Lt - Lm) * 1.05 + 0.02;
    if (dist > maxR) { F.copy(K).addScaledVector(d.normalize(), maxR); d = F.clone().sub(K); dist = maxR; }
    if (dist < minR) { F.copy(K).addScaledVector(d.normalize(), minR); d = F.clone().sub(K); dist = minR; }
    const dn = d.clone().normalize();
    // bend direction: intertarsal joint goes backward (−forward), orthogonal to the K→F line
    const back = fwdWorld.clone().negate();
    const bend = back.addScaledVector(dn, -back.dot(dn)).normalize();
    const a = (Lt * Lt - Lm * Lm + dist * dist) / (2 * dist);
    const h = Math.sqrt(Math.max(0, Lt * Lt - a * a));
    const J = K.clone().addScaledVector(dn, a).addScaledVector(bend, h);
    const hint = fwdWorld;
    Rig.aim(S.femur, K.clone().sub(H).normalize(), hint);
    Rig.aim(S.tib, J.clone().sub(K).normalize(), hint);
    Rig.aim(S.tmt, F.clone().sub(J).normalize(), hint);
    // foot frame: y = ground normal, z = forward (toes)
    const fz = fwdWorld.clone().addScaledVector(upWorld, -fwdWorld.dot(upWorld)).normalize();
    Rig.aim(S.foot, fz, upWorld, 'z', 'y');
    // toes
    for (let t = 0; t < S.toes.length; t++) {
      const toe = S.toes[t];
      const hallux = toe.def.name === 'hallux';
      const yaw0 = toe.def.yaw * Math.PI / 180;
      const spread = hallux ? 0 : (toe.def.name === 'inner' ? -1 : toe.def.name === 'outer' ? 1 : 0) * toeSpread;
      toe.chain[0].rotation.set(0.04 + toeCurl * 0.35, yaw0 + spread, 0, 'YXZ');
      for (let k = 1; k < toe.chain.length; k++) {
        const claw = k === toe.chain.length - 1;
        toe.chain[k].rotation.set(toeCurl * (claw ? 1.1 : 0.85) + (claw ? 0.1 : 0.02), 0, 0);
      }
    }
    return F;
  }

  /** Apply a full pose (see pose.js). */
  applyPose(P, { bind = false } = {}) {
    const rig = this.rig;
    const root = rig.root;
    if (!bind) {
      root.position.copy(P.pos);
      _e.set(0, P.yaw, 0, 'YXZ');
      root.quaternion.setFromEuler(_e);
    } else { root.position.set(0, 0, 0); root.quaternion.identity(); }
    // trunk: pitch (+ nose up), roll (+ left wing up) in the heading frame, plus a local offset (bob)
    rig.trunk.position.copy(P.trunkOff);
    _e.set(-P.pitch, P.bodyYaw || 0, -P.roll, 'YXZ');
    rig.trunk.quaternion.setFromEuler(_e);
    rig.setWing(0, P.wingL);
    rig.setWing(1, P.wingR);
    rig.setTail(P.tail);
    rig.setJaw(P.jaw);
    rig.setLids(P.lidUp, P.lidLo, P.nict);
    root.updateMatrixWorld(true);
    // neck + head
    {
      const tgt = _v.copy(P.head.pos);
      if (P.head.worldPos && !bind) {
        // stabilised head: the requested position is in world space → convert to trunk space
        _m.copy(rig.trunk.matrixWorld).invert();
        tgt.copy(P.head.worldPos).applyMatrix4(_m).lerp(P.head.pos, 1 - P.head.worldW);
      }
      let hq = P.head.q && !bind ? _q.copy(P.head.q) : _q.setFromEuler(_e.set(-P.head.pitch, P.head.yaw, P.head.roll, 'YXZ'));
      if (P.head.worldQ && !bind && P.head.worldW > 0) {
        // world-stabilised gaze: convert to trunk space
        const tq = rig.trunk.getWorldQuaternion(new THREE.Quaternion());
        const wq = tq.invert().multiply(P.head.worldQ);
        hq = _q.clone().slerp(wq, P.head.worldW);
      }
      this.neckSolver.solve(tgt, P.head.upper, P.head.neckYaw, P.head.neckRoll, hq, P.head.limit || 1.1);
    }
    root.updateMatrixWorld(true);
    // legs
    for (let s = 0; s < 2; s++) {
      const L = s === 0 ? P.legL : P.legR;
      let foot, fwd, up;
      if (L.world && !bind) { foot = L.world; fwd = L.fwd; up = L.up; }
      else {
        // trunk-space foot target (flight tuck / bind)
        foot = _v2.copy(L.pos); if (s === 1) foot.x = -foot.x;
        foot = foot.clone().applyMatrix4(rig.trunk.matrixWorld);
        fwd = new THREE.Vector3(0, 0, 1).transformDirection(rig.trunk.matrixWorld);
        up = new THREE.Vector3(0, 1, 0).transformDirection(rig.trunk.matrixWorld);
        if (L.footPitch) up.applyAxisAngle(new THREE.Vector3(1, 0, 0).transformDirection(rig.trunk.matrixWorld), L.footPitch), fwd.applyAxisAngle(new THREE.Vector3(1, 0, 0).transformDirection(rig.trunk.matrixWorld), L.footPitch);
      }
      this.solveLeg(s, foot, fwd, up, L.femurPitch, L.femurSplay, L.toeCurl, L.toeSpread);
    }
    root.updateMatrixWorld(true);
    // feather shader state
    featherUniforms.uFluff.value = P.fluff;
    featherUniforms.uFluffBody.value = P.fluffBody;
    featherUniforms.uFlutter.value = P.flutter;
    featherUniforms.uBreath.value = P.breath;
  }

  // world positions of useful landmarks
  headWorld(out = new THREE.Vector3()) { return out.set(0, 0.02, 0.06).applyMatrix4(this.rig.head.matrixWorld); }
  billTipWorld(out = new THREE.Vector3()) { return out.set(0, -0.02, 0.145).applyMatrix4(this.rig.head.matrixWorld); }
  trunkWorld(out = new THREE.Vector3()) { return out.setFromMatrixPosition(this.rig.trunk.matrixWorld); }
}
