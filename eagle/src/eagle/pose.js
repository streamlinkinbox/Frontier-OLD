import * as THREE from 'three';

// A pose is a plain tree of numbers / Vector3 / Quaternion. Animations write poses; the controller
// blends them (per-field lerp / slerp) and the Eagle applies the result to the skeleton.

export const wing = (o = {}) => ({
  elev: 0, sweep: 0, twist: 0, elbow: 0.6, wrist: 0.5, handTwist: 0, foreTwist: 0, digitFlex: 0,
  spread: 0.6, fpitch: 0, bend: 0.3, alula: 0, flutter: 0, pronate: 0, fluff: 0, droop: 0, armDroop: 0, foldRoll: 0, t: 0, ...o,
});

// Folded wing at rest (perched): humerus back along the flank, forearm forward, hand back — the
// classic Z-fold; primaries stack under the secondaries and their tips lie over the tail.
// (joint angles solved numerically so the elbow/wrist/hand land on measured perched landmarks)
export const WING_FOLD = wing({ elev: -0.058, sweep: -1.40, twist: 1.15, elbow: 2.806, wrist: 3.015, handTwist: 0.2, foreTwist: 0.0, digitFlex: 0.1, droop: 0.08, foldRoll: -1.1, spread: 0, bend: 0, alula: 0 });
// (handTwist + droop roll the folded hand so the primary tips converge and cross over the closed tail)
// Soaring / gliding wing: long, broad, flat "plank" with the primaries spread into slotted fingers.
export const WING_GLIDE = wing({ elev: 0.05, sweep: -0.16, twist: 0.02, elbow: 0.46, wrist: 0.40, digitFlex: 0.05, spread: 1, bend: 0.3 });

export function defaultPose() {
  return {
    pos: new THREE.Vector3(), yaw: 0, pitch: 0, roll: 0, bodyYaw: 0,
    trunkOff: new THREE.Vector3(0, 0.3, 0),
    wingL: { ...WING_FOLD }, wingR: { ...WING_FOLD },
    tail: { pitch: 0, yaw: 0, roll: 0, spread: 0.1, bend: 0, asym: 0, fluff: 0 },
    head: {
      pos: new THREE.Vector3(0, 0.16, 0.25), pitch: 0, yaw: 0, roll: 0, upper: 0, neckYaw: 0, neckRoll: 0, limit: 1.1,
      worldPos: null, worldQ: null, worldW: 0,
    },
    jaw: 0, lidUp: 0, lidLo: 0, nict: 0,
    legL: leg(), legR: leg(),
    fluff: 0, fluffBody: 0, flutter: 0, breath: 0,
  };
}

export function leg(o = {}) {
  return {
    pos: new THREE.Vector3(0.05, -0.2, 0.02), world: null, fwd: null, up: null,
    femurPitch: 0.9, femurSplay: 0.18, toeCurl: 0, toeSpread: 0, footPitch: 0, ...o,
  };
}

export const BIND_POSE = (() => {
  const p = defaultPose();
  p.pitch = 0; p.trunkOff.set(0, 0, 0);
  p.wingL = { ...WING_GLIDE, bend: 0, flutter: 0, fpitch: 0 };
  p.wingR = { ...WING_GLIDE, bend: 0, flutter: 0, fpitch: 0 };
  p.tail.spread = 0.3;
  p.legL = leg({ pos: new THREE.Vector3(0.05, -0.27, 0.03), femurPitch: 0.9 });
  p.legR = leg({ pos: new THREE.Vector3(0.05, -0.27, 0.03), femurPitch: 0.9 });
  return p;
})();

// ---------------------------------------------------------------------------------------------
export function clonePose(p) {
  if (p === null || typeof p !== 'object') return p;
  if (p.isVector3) return p.clone();
  if (p.isQuaternion) return p.clone();
  const o = {};
  for (const k in p) o[k] = clonePose(p[k]);
  return o;
}

// out = lerp(a, b, t) — structure of a is used; null fields take the other side
export function lerpPose(a, b, t, out) {
  if (a === null || a === undefined) return clonePose(b);
  if (b === null || b === undefined) return clonePose(a);
  if (typeof a === 'number') return a + (b - a) * t;
  if (a.isVector3) return (out && out.isVector3 ? out : new THREE.Vector3()).copy(a).lerp(b, t);
  if (a.isQuaternion) return (out && out.isQuaternion ? out : new THREE.Quaternion()).copy(a).slerp(b, t);
  if (typeof a === 'object') {
    const o = out && typeof out === 'object' && !out.isVector3 ? out : {};
    for (const k in a) {
      if (typeof a[k] === 'boolean') { o[k] = t < 0.5 ? a[k] : b[k]; continue; }
      o[k] = lerpPose(a[k], b[k], t, o[k]);
    }
    return o;
  }
  return t < 0.5 ? a : b;
}

// Perched "rest" pose used as the bind pose of the body envelope, contour plumage, head and feet
// (the shape the bird is seen in most; flight stretches the neck from here).
export const PERCH_BIND = (() => {
  const p = defaultPose();
  p.pitch = 0.64; p.trunkOff.set(0, 0.296, 0);
  p.wingL = { ...WING_FOLD }; p.wingR = { ...WING_FOLD };
  p.tail = { pitch: -0.04, yaw: 0, roll: 0, spread: 0.05, bend: 0, asym: 0, fluff: 0 };
  p.head.pos.set(0, 0.098, 0.242);
  // head level in the world (gaze pitch −0.08) → expressed in trunk space
  const qAct = new THREE.Quaternion().setFromEuler(new THREE.Euler(-p.pitch, 0, 0, 'YXZ'));
  const qWant = new THREE.Quaternion().setFromEuler(new THREE.Euler(0.08, 0, 0, 'YXZ'));
  p.head.q = qAct.invert().multiply(qWant);
  for (const s of [0, 1]) {
    const sx = s === 0 ? 1 : -1;
    const L = leg({ femurPitch: 0.9, femurSplay: 0.18 });
    L.world = new THREE.Vector3(sx * 0.072, 0.012, 0.035);
    L.fwd = new THREE.Vector3(Math.sin(sx * 0.1), 0, Math.cos(sx * 0.1));
    L.up = new THREE.Vector3(0, 1, 0);
    if (s === 0) p.legL = L; else p.legR = L;
  }
  return p;
})();
