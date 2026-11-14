import * as THREE from 'three';
import { defaultPose, wing, WING_FOLD, WING_GLIDE, leg } from './pose.js';
import { FLAP_HZ } from './anatomy.js';

// ------------------------------------------------------------------------------------------------
// Procedural animation controller for the Bald Eagle.
//
// Every behaviour is built from published observations of Haliaeetus / large accipitrids:
//  • Flapping (Harel et al. 2021 PNAS, golden eagle; flight-kinematics literature): ≈2.8 Hz, the
//    downstroke (≈55 % of the cycle) is made with the wing fully extended and pronated, primaries
//    pressed together and bent up under load; in the upstroke the elbow and wrist flex, the hand
//    sweeps back and the primaries separate/rotate ("venetian blind"). The inner wing moves little,
//    the outer wing a lot, the hand lags the arm aerodynamically. The body rises and falls with the
//    lift (lowest at mid-downstroke) while the head is held still in space.
//  • Gliding / soaring: long flat "plank" wings, fingered primaries, hand slightly drooped in glides,
//    continuous small gust responses corrected with differential wing twist and the tail.
//  • Walking (Birds of the World): "awkward, rocking gait of alternating steps"; great strides with a
//    rolling motion of the body and a shuffling of the wings for balance; head a bit low, body more
//    horizontal than when perched. Toes curl in the swing and spread before touchdown.
//  • Peal call: the head is thrown back until the bill points skyward, 3–4 introductory notes, then a
//    rapid descending series (chatter); hackles raised.
//  • Head: 14 cervical vertebrae, ≈180° rotation each way; like other birds the eagle moves its head in
//    fast saccades separated by fixations, often with a nictitating-membrane blink during the saccade.
// ------------------------------------------------------------------------------------------------

const TAU = Math.PI * 2;
const clamp = (x, a, b) => Math.min(b, Math.max(a, x));
const lerp = (a, b, t) => a + (b - a) * t;
const ss = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
const smoother = (t) => { t = clamp(t, 0, 1); return t * t * t * (t * (t * 6 - 15) + 10); };
const bump = (t, a, b) => (t <= a || t >= b ? 0 : Math.sin(Math.PI * (t - a) / (b - a)));
const wrapPi = (a) => Math.atan2(Math.sin(a), Math.cos(a));
function rng(seed) { let s = seed >>> 0; return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296); }
// damped approach (frame-rate independent)
const approach = (cur, tgt, rate, dt) => cur + (tgt - cur) * (1 - Math.exp(-rate * dt));

// Periodic cubic Hermite spline (Catmull-Rom tangents) through [phase, value] keys; first key at 0.
function periodic(keys) {
  const n = keys.length;
  const T = (j) => keys[((j % n) + n) % n][0] + Math.floor(j / n);
  const V = (j) => keys[((j % n) + n) % n][1];
  return (ph) => {
    ph -= Math.floor(ph);
    let i = 0;
    for (let k = 0; k < n; k++) if (keys[k][0] <= ph) i = k;
    const t0 = T(i - 1), t1 = T(i), t2 = T(i + 1), t3 = T(i + 2);
    const v0 = V(i - 1), v1 = V(i), v2 = V(i + 1), v3 = V(i + 2);
    const h = t2 - t1, s = (ph - t1) / h;
    const m1 = ((v2 - v0) / (t2 - t0)) * h, m2 = ((v3 - v1) / (t3 - t1)) * h;
    const s2 = s * s, s3 = s2 * s;
    return (2 * s3 - 3 * s2 + 1) * v1 + (s3 - 2 * s2 + s) * m1 + (-2 * s3 + 3 * s2) * v2 + (s3 - s2) * m2;
  };
}

// Wing stroke (phase 0 = top of the upstroke / start of the downstroke; downstroke ends at 0.55).
const DOWN = 0.55;
const K = (arr) => periodic(arr);
const STROKE = {
  elev: K([[0, 0.86], [0.14, 0.55], [0.28, 0.04], [0.42, -0.42], [0.55, -0.6], [0.68, -0.36], [0.82, 0.28], [0.93, 0.72]]),
  sweep: K([[0, -0.08], [0.14, 0.04], [0.28, 0.12], [0.42, 0.13], [0.55, 0.05], [0.68, -0.18], [0.82, -0.3], [0.93, -0.2]]),
  elbow: K([[0, 0.55], [0.14, 0.40], [0.28, 0.36], [0.42, 0.40], [0.55, 0.62], [0.68, 1.05], [0.82, 1.0], [0.93, 0.78]]),
  wrist: K([[0, 0.55], [0.14, 0.36], [0.28, 0.30], [0.42, 0.36], [0.55, 0.70], [0.68, 1.25], [0.82, 1.15], [0.93, 0.80]]),
  twist: K([[0, 0.02], [0.14, 0.14], [0.28, 0.19], [0.42, 0.13], [0.55, 0.0], [0.68, -0.22], [0.82, -0.2], [0.93, -0.08]]),
  fpitch: K([[0, 0.3], [0.14, 0.0], [0.28, -0.05], [0.42, 0.0], [0.55, 0.25], [0.68, 0.8], [0.82, 0.85], [0.93, 0.6]]),
  spread: K([[0, 0.8], [0.14, 0.62], [0.28, 0.55], [0.42, 0.58], [0.55, 0.7], [0.68, 0.84], [0.82, 0.88], [0.93, 0.85]]), // primaries part on the upstroke, but stay a coherent hand
  bend: K([[0, -0.05], [0.14, 0.45], [0.28, 0.75], [0.42, 0.55], [0.55, 0.1], [0.68, -0.12], [0.82, -0.1], [0.93, -0.08]]),
};
const GLIDE = { ...WING_GLIDE, droop: 0.06, bend: 0.32 };
const WING_KEYS = ['elev', 'sweep', 'twist', 'elbow', 'wrist', 'handTwist', 'foreTwist', 'digitFlex', 'spread', 'fpitch', 'bend', 'alula', 'flutter', 'pronate', 'fluff', 'droop', 'armDroop', 'foldRoll'];
const lerpWing = (a, b, t, o = {}) => { for (const k of WING_KEYS) o[k] = lerp(a[k] || 0, b[k] || 0, t); return o; };

// Walk
const WALK = { freq: 1.2, duty: 0.6, stride: 0.24, lift: 0.075, halfWidth: 0.072, footZ: 0.035, radius: 2.4 };
// Flight path: a wide circle over the lake
const FLIGHT = { radius: 29, alt: 62, flapSpeed: 11, glideSpeed: 12 }; // circle stays over open water

export class Animator {
  constructor(eagle, { ground, lake }) {
    this.eagle = eagle;
    this.groundH = ground;
    this.lake = lake;
    this.R = rng(20260928);
    this.pose = defaultPose();
    this.time = 0;
    this.mode = 'ground';           // 'ground' | 'air'
    this.airStyle = 'flap';         // 'flap' | 'glide'
    this.walking = false;
    this.action = null;             // { name, t, dur, dir }
    this.queued = null;
    this.speedScale = 1;
    // ground locomotion state
    const g0 = ground(0, 0);
    this.g = { pos: new THREE.Vector3(0, g0, 0), yaw: 0, walkW: 0, phase: 0, speed: 0 };
    this.feet = [0, 1].map((s) => ({ side: s, planted: new THREE.Vector3(), fwd: new THREE.Vector3(0, 0, 1), swing: false, s: 0, from: new THREE.Vector3(), to: new THREE.Vector3(), curl: 0 }));
    this.resetFeet();
    // flight state
    const yaw0 = 0.4;
    this.a = { yaw: yaw0, pos: new THREE.Vector3(), phase: 0, flapW: 1, bank: 0, speed: FLIGHT.flapSpeed, gustRoll: 0, gustRollV: 0, tuck: 0, tuckT: 6 };
    this.placeOnCircle();
    // gaze / blinks / idle behaviours
    this.gaze = { yaw: 0, pitch: -0.08, roll: 0, fy: 0, fp: -0.08, fr: 0, ty: 0, tp: -0.08, tr: 0, t0: 0, dur: 0.2, next: 1.2, active: false };
    this.blink = { nict: 0, nictT: -1, lid: 0, lidT: -1, next: 3 };
    this.idle = { shift: 0, shiftT: -9, nextShift: 7, retuck: -9, nextRetuck: 14, rouse: -9, nextRouse: 26, tailFlick: -9, nextFlick: 9, breathPh: 0 };
    this.fade = { v: 0, target: 0, pending: null };
    // stats for probes
    this.stats = { footSlip: 0 };
  }

  // ------------------------------------------------------------------ public API
  setMode(mode, style) {
    if (mode === 'air' && style) this.airStyle = style;
    if (mode === this.mode) return;
    // cross-cut through a short fade (the eagle is moved between the shore and the sky)
    this.fade.target = 1;
    this.fade.pending = mode;
  }
  trigger(name) {
    if (name === 'flap' || name === 'glide') { this.setMode('air', name); this.airStyle = name; return; }
    if (this.mode === 'air') { this.setMode('ground'); this.queued = name === 'idle' || name === 'walk' ? { name } : { name }; return; }
    if (name === 'walk') { this.walking = !this.walking; if (this.walking) this.action = null; return; }
    if (name === 'idle') { this.walking = false; this.action = null; return; }
    if (name === 'screech' || name === 'headturn') {
      if (this.walking || this.g.walkW > 0.1 || this.feet.some((f) => f.swing)) { this.walking = false; this.queued = { name }; return; }
      this.startAction(name);
    }
  }
  startAction(name) {
    const dur = name === 'screech' ? 4.2 : 3.6;
    this.headTurnDir = name === 'headturn' ? -(this.headTurnDir || -1) : this.headTurnDir;
    this.action = { name, t: 0, dur, dir: this.headTurnDir || 1 };
  }
  get label() {
    if (this.mode === 'air') return this.airStyle === 'flap' ? 'Flapping flight' : 'Gliding';
    if (this.action) return this.action.name === 'screech' ? 'Peal call' : 'Head turn';
    return this.walking ? 'Walking' : 'Idle';
  }

  resetFeet() {
    for (const f of this.feet) {
      this.neutralFoot(f.side, 0, f.planted, f.fwd);
      f.swing = false; f.curl = 0;
    }
  }
  neutralFoot(side, ahead, out, fwdOut) {
    const g = this.g, sx = side === 0 ? 1 : -1;
    const c = Math.cos(g.yaw), s = Math.sin(g.yaw);
    const lx = sx * WALK.halfWidth, lz = WALK.footZ + ahead;
    out.set(g.pos.x + c * lx + s * lz, 0, g.pos.z - s * lx + c * lz);
    out.y = this.groundH(out.x, out.z) + 0.012;
    if (fwdOut) { const toe = sx * 0.1; fwdOut.set(Math.sin(g.yaw + toe), 0, Math.cos(g.yaw + toe)); }
    return out;
  }
  placeOnCircle() {
    const a = this.a, L = this.lake;
    const cx = Math.cos(a.yaw), sx = -Math.sin(a.yaw);
    a.pos.set(L.center.x - FLIGHT.radius * cx, L.level + FLIGHT.alt, L.center.y - FLIGHT.radius * sx);
  }

  // ------------------------------------------------------------------ update
  update(dtReal) {
    const dt = Math.min(0.05, dtReal) * this.speedScale;
    this.time += dt;
    // fade / mode switch
    const F = this.fade;
    F.v = approach(F.v, F.target, 14, dtReal);
    if (F.target === 1 && F.v > 0.97 && F.pending) {
      this.mode = F.pending; F.pending = null; F.target = 0;
      if (this.mode === 'ground') { this.action = null; this.walking = false; this.g.walkW = 0; this.resetFeet(); if (this.queued) { const q = this.queued; this.queued = null; if (q.name === 'walk') this.walking = true; else if (q.name !== 'idle') this.startAction(q.name); } }
      else { this.a.flapW = this.airStyle === 'flap' ? 1 : 0; }
    }
    const P = this.pose;
    if (this.mode === 'ground') this.updateGround(dt, P); else this.updateAir(dt, P);
    this.updateBlinks(dt, P);
    return P;
  }

  // ---------------------------------------------------------------- gaze (saccades + fixations)
  // limits: {yaw, pitchLo, pitchHi, every:[min,max]}
  updateGaze(dt, lim, override) {
    const G = this.gaze, R = this.R, now = this.time;
    if (override) {
      // an action drives the head directly; keep the saccade state in sync so it resumes smoothly
      G.yaw = override.yaw; G.pitch = override.pitch; G.roll = override.roll;
      G.fy = G.ty = G.yaw; G.fp = G.tp = G.pitch; G.fr = G.tr = G.roll; G.active = false; G.next = now + 0.8 + R();
      return G;
    }
    if (!G.active && now >= G.next) {
      // new fixation target: mostly small re-fixations, sometimes a large look-around
      const big = R() < 0.3;
      G.fy = G.yaw; G.fp = G.pitch; G.fr = G.roll;
      G.ty = clamp(big ? (R() - 0.5) * 2 * lim.yaw : G.yaw * 0.4 + (R() - 0.5) * lim.yaw * 0.7, -lim.yaw, lim.yaw);
      G.tp = lerp(lim.pitchLo, lim.pitchHi, R() * R() * 0.6 + R() * 0.4);
      G.tr = (R() - 0.5) * 0.18 + (R() < 0.12 ? (R() < 0.5 ? -1 : 1) * 0.35 : 0); // occasional head cock
      const amp = Math.hypot(G.ty - G.fy, G.tp - G.fp);
      G.t0 = now; G.dur = 0.07 + 0.09 * amp; G.active = true;
      if (amp > 0.5 && R() < 0.45) this.nictBlink();
    }
    if (G.active) {
      const u = clamp((now - G.t0) / G.dur, 0, 1);
      // saccade profile: fast, slight overshoot then settle
      const e = u < 1 ? smoother(u) + 0.06 * Math.sin(Math.PI * u) * u : 1;
      G.yaw = lerp(G.fy, G.ty, e); G.pitch = lerp(G.fp, G.tp, e); G.roll = lerp(G.fr, G.tr, e);
      if (u >= 1) { G.active = false; G.next = now + lim.every[0] + R() * (lim.every[1] - lim.every[0]); }
    } else {
      // fixation: the head is held almost perfectly still (tiny physiological drift)
      G.yaw += Math.sin(now * 1.7) * 0.0006; G.pitch += Math.sin(now * 2.3 + 1) * 0.0004;
    }
    return G;
  }
  nictBlink() { if (this.blink.nictT < 0) this.blink.nictT = 0; }
  updateBlinks(dt, P) {
    const B = this.blink, R = this.R;
    if (this.time > B.next) { if (R() < 0.8) this.nictBlink(); else if (B.lidT < 0) B.lidT = 0; B.next = this.time + 3 + R() * 6; }
    // nictitating membrane sweeps across and back in ≈0.22 s
    if (B.nictT >= 0) { B.nictT += dt; B.nict = bump(B.nictT, 0, 0.22) ** 0.7; if (B.nictT > 0.22) { B.nictT = -1; B.nict = 0; } }
    // full blink: mainly the lower lid rises (birds), upper lid drops a little; ≈0.3 s
    if (B.lidT >= 0) { B.lidT += dt; B.lid = bump(B.lidT, 0, 0.32) ** 0.6; if (B.lidT > 0.32) { B.lidT = -1; B.lid = 0; } }
    P.nict = B.nict; P.lidLo = Math.max(P.lidLo, B.lid); P.lidUp = Math.max(P.lidUp, B.lid * 0.45);
  }

  // ---------------------------------------------------------------- head placement
  // atlas: trunk-space target (in the *mean*, un-oscillated trunk frame); gaze in the heading frame.
  // stab: 0 = head rides with the body, 1 = fully stabilised against the trunk's oscillations.
  setHead(P, atlas, gaze, stab, mean, extra = {}) {
    const H = P.head;
    // head orientation wanted in the heading (root) frame
    const qWant = new THREE.Quaternion().setFromEuler(new THREE.Euler(-gaze.pitch, gaze.yaw, gaze.roll, 'YXZ'));
    const qAct = new THREE.Quaternion().setFromEuler(new THREE.Euler(-P.pitch, P.bodyYaw || 0, -P.roll, 'YXZ'));
    const qMean = new THREE.Quaternion().setFromEuler(new THREE.Euler(-mean.pitch, mean.bodyYaw || 0, -mean.roll, 'YXZ'));
    const qA = qAct.clone().invert().multiply(qWant);
    const qM = qMean.clone().invert().multiply(qWant);
    H.q = qM.slerp(qA, stab);
    // position: atlas defined in the mean trunk frame → actual trunk frame
    const pm = atlas.clone().applyQuaternion(qMean).add(mean.off);
    const pa = pm.sub(P.trunkOff).applyQuaternion(qAct.clone().invert());
    H.pos.copy(atlas).lerp(pa, stab);
    // large head turns are shared by the cervical column (twist of the upper neck, yaw lower down);
    // the atlanto-occipital joint does the rest (limited)
    const yawRel = wrapPi(gaze.yaw - (P.bodyYaw || 0));
    H.neckYaw = yawRel * (extra.neckYawK ?? 0.35);
    H.neckRoll = yawRel * (extra.neckRollK ?? 0.4);
    H.upper = extra.upper ?? 0;
    H.limit = extra.limit ?? 1.15;
  }

  // ---------------------------------------------------------------- ground (idle / walk / actions)
  updateGround(dt, P) {
    const g = this.g, R = this.R, I = this.idle, t = this.time;
    // queued action once the feet have settled
    if (this.queued && !this.walking && g.walkW < 0.05 && !this.feet.some((f) => f.swing)) { const q = this.queued; this.queued = null; if (q.name === 'walk') this.walking = true; else if (q.name !== 'idle') this.startAction(q.name); }
    g.walkW = approach(g.walkW, this.walking ? 1 : 0, 2.2, dt);
    const W = g.walkW;
    // ---- locomotion: speed follows the stride so the stance feet never slide
    const freq = WALK.freq;
    const moving = W > 0.02 || this.feet.some((f) => f.swing);
    if (moving) g.phase += freq * dt;
    const strideLen = WALK.stride * W;
    g.speed = strideLen * freq;
    const yawRate = g.speed / WALK.radius;
    g.yaw += yawRate * dt;
    g.pos.x += Math.sin(g.yaw) * g.speed * dt;
    g.pos.z += Math.cos(g.yaw) * g.speed * dt;
    g.pos.y = this.groundH(g.pos.x, g.pos.z);

    // ---- feet (left phase 0, right 0.5); stance while local phase < duty
    const swingDur = (1 - WALK.duty) / freq;
    for (const f of this.feet) {
      const lp = (g.phase + (f.side === 0 ? 0 : 0.5)) % 1;
      const inSwing = moving && lp >= WALK.duty;
      if (inSwing && !f.swing) {
        // lift-off: aim for the neutral position half a stride ahead of where the hip will be at touchdown
        const ahead = g.speed * (swingDur + WALK.duty / freq * 0.5);
        const need = this.neutralFoot(f.side, ahead, new THREE.Vector3());
        if (W < 0.03 && need.distanceTo(f.planted) < 0.02) { /* already neutral: skip the step */ }
        else { f.swing = true; f.from.copy(f.planted); f.to.copy(need); f.fwd0 = f.fwd.clone(); f.fwd1 = new THREE.Vector3(); this.neutralFoot(f.side, 0, new THREE.Vector3(), f.fwd1); }
      }
      if (f.swing) {
        const u = clamp((lp - WALK.duty) / (1 - WALK.duty), 0, 1);
        const done = !inSwing || u >= 0.999;
        const e = smoother(u);
        f.planted.lerpVectors(f.from, f.to, e);
        f.planted.y = lerp(f.from.y, f.to.y, e) + WALK.lift * Math.sin(Math.PI * Math.min(1, u * 1.08)) ** 1.2 * Math.max(0.35, W);
        f.fwd.copy(f.fwd0).lerp(f.fwd1, e).normalize();
        // toes clench as the foot leaves the ground and open again just before touchdown
        f.curl = ss(0, 0.25, u) * (1 - ss(0.62, 0.92, u)) * 0.85;
        f.u = u;
        if (done) { f.swing = false; f.planted.copy(f.to); f.curl = 0; }
      } else { f.u = 0; }
    }

    // ---- idle behaviours (suppressed while walking or during actions)
    const calm = (1 - W) * (this.action ? 0 : 1);
    if (t > I.nextShift) { I.shiftT = t; I.shiftDir = R() < 0.5 ? -1 : 1; I.nextShift = t + 7 + R() * 8; }
    if (t > I.nextRetuck) { I.retuck = t; I.nextRetuck = t + 12 + R() * 12; }
    if (t > I.nextFlick) { I.tailFlick = t; I.nextFlick = t + 6 + R() * 9; }
    if (t > I.nextRouse && calm > 0.9) { I.rouse = t; I.nextRouse = t + 28 + R() * 25; }
    const shift = bump(t - I.shiftT, 0, 3.2) * (I.shiftDir || 1) * calm;
    const retuck = bump(t - I.retuck, 0, 0.9) * calm;
    const flick = bump(t - I.tailFlick, 0, 0.35) * calm;
    const rt = t - I.rouse;
    const rouse = rt > 0 && rt < 2.6 ? 1 : 0;
    const rouseFluff = rouse * ss(0, 0.5, rt) * (1 - ss(1.7, 2.6, rt));
    const shake = rouse * bump(rt, 0.45, 1.55); // body shake envelope

    // breathing ≈ 0.33 Hz at rest, faster after walking / calling
    I.breathPh += dt * TAU * lerp(0.33, 0.55, Math.max(W, this.action && this.action.name === 'screech' ? 0.6 : 0));
    const breath = Math.sin(I.breathPh);

    // ---- gait-locked body motion
    const gp = g.phase * TAU;
    const midL = WALK.duty * 0.5 * TAU;               // left mid-stance
    const cL = Math.cos(gp - midL);                    // +1 at left mid-stance, −1 at right mid-stance
    // "awkward, rocking gait": the heavy trunk rolls well over each stance leg (lagging the foot
    // contact a little), shifts its weight sideways, yaws with the striding leg, rises at mid-stance
    // and surges forward after each push-off.
    const cLr = Math.cos(gp - midL - 0.35);
    const walkRoll = -0.17 * cLr * W;
    const walkShift = 0.036 * cL * W;
    const walkYaw = 0.12 * Math.sin(gp - midL) * W;
    const walkBob = 0.016 * Math.cos(2 * (gp - midL)) * W;
    const walkSurge = 0.012 * Math.sin(2 * (gp - midL) - 0.8) * W;

    // ---- trunk
    P.pos.copy(g.pos); P.yaw = g.yaw;
    const basePitch = lerp(0.9, 0.58, W);             // upright perch → body inclined ~40° while walking (eagles stay fairly upright)
    const baseY = lerp(0.296, 0.28, W); // perched: knees well flexed so the trousers hang to the tarsus
    const meanOff = new THREE.Vector3(0, baseY + 0.0012 * breath, 0.0);
    P.trunkOff.set(walkShift + 0.012 * shift + shake * 0.004 * Math.sin(t * TAU * 5.5), baseY + walkBob + 0.0012 * breath - 0.004 * rouseFluff, walkSurge);
    P.pitch = basePitch + 0.006 * breath + 0.045 * W * Math.cos(2 * (gp - midL) + 0.6);
    P.roll = walkRoll + 0.035 * shift + shake * 0.09 * Math.sin(t * TAU * 5.5);
    P.bodyYaw = walkYaw + shake * 0.06 * Math.sin(t * TAU * 5.5 + 1.2);
    const mean = { off: meanOff, pitch: basePitch + 0.006 * breath, roll: 0.035 * shift, bodyYaw: 0 };

    // ---- wings: folded; balance shuffles while walking, re-tuck, rouse
    const wl = { ...WING_FOLD }, wr = { ...WING_FOLD };
    // balance: while walking the folded wings are held loosely away from the flanks (wrists dropped)
    // and the wing on the rising side is lifted as the body rolls — lagging the roll (inertia)
    const cLw = Math.cos(gp - midL - 0.9);
    const shuffleL = W * (0.13 * Math.max(0, -cLw) + 0.06);
    const shuffleR = W * (0.13 * Math.max(0, cLw) + 0.06);
    for (const [w, sh] of [[wl, shuffleL], [wr, shuffleR]]) {
      w.elev += sh + 0.1 * retuck + 0.08 * rouseFluff;
      w.droop += 0.12 * W;
      w.elbow -= 0.1 * W + 0.25 * sh;
      w.sweep += 0.35 * sh + 0.12 * retuck;
      w.elbow -= 0.12 * retuck + 0.12 * rouseFluff;
      w.wrist -= 0.1 * retuck + 0.1 * rouseFluff;
      w.fluff = rouseFluff;
      w.t = t;
    }
    P.wingL = wl; P.wingR = wr;

    // ---- tail: breathing bob, counter-roll while walking, occasional flick/fan
    P.tail.pitch = -0.04 + 0.03 * breath - 0.09 * Math.cos(2 * (gp - midL) - 0.5) * W + 0.12 * flick;
    P.tail.roll = -walkRoll * 0.9;
    P.tail.yaw = -walkYaw * 1.3 - 0.08 * Math.sin(gp - midL - 0.7) * W + shake * 0.12 * Math.sin(t * TAU * 5.5 + 2.1);
    P.tail.spread = 0.05 + 0.25 * flick + 0.1 * rouseFluff;
    P.tail.fluff = rouseFluff;

    // ---- legs
    const legs = [];
    for (const f of this.feet) {
      const up = new THREE.Vector3(0, 1, 0);
      let fwd = f.fwd.clone();
      if (f.swing) {
        // the foot hangs toes-down in the swing (flexed at the ankle), flattening for touchdown
        const side = new THREE.Vector3().crossVectors(up, fwd).normalize();
        const tilt = -0.75 * Math.sin(Math.PI * Math.min(1, (f.u || 0) * 1.1)) * Math.max(0.4, W);
        up.applyAxisAngle(side, tilt); fwd.applyAxisAngle(side, tilt);
      }
      legs.push(leg({ world: f.planted.clone(), fwd, up, femurPitch: lerp(0.9, 1.05, W), femurSplay: 0.18, toeCurl: f.curl + 0.04 * Math.sin(t * 0.7 + f.side), toeSpread: (1 - f.curl) * 0.08 }));
    }
    P.legL = legs[0]; P.legR = legs[1];

    // ---- head / neck / bill: gaze + actions
    let atlas = new THREE.Vector3(0, lerp(0.098, 0.128, W), lerp(0.242, 0.236, W)); // walking: neck raised, head carried high above the shoulders
    let gazeOverride = null, extra = {};
    P.jaw = 0; P.lidUp = 0; P.lidLo = 0; P.fluff = 0.06 * shift * 0 + rouseFluff * 0.8; P.fluffBody = rouseFluff; P.breath = breath * (1 - W * 0.5);
    P.flutter = 0;
    let stab = lerp(0.35, 0.9, W); // raptors do not head-bob: the head is held steady in space while walking
    if (rouse) { gazeOverride = { yaw: shake * 0.3 * Math.sin(t * TAU * 6), pitch: -0.1, roll: shake * 0.35 * Math.sin(t * TAU * 6 + 0.5) }; stab = 0.2; }
    if (this.action) {
      const A = this.action; A.t += dt;
      const r = A.name === 'screech' ? this.screech(A, P, atlas) : this.headTurn(A, P, atlas);
      gazeOverride = r.gaze; extra = r.extra || {}; stab = r.stab ?? stab;
      if (A.t >= A.dur) { this.action = null; }
    }
    const G = this.updateGaze(dt, { yaw: lerp(1.1, 0.5, W), pitchLo: lerp(-0.45, -0.5, W), pitchHi: lerp(0.35, -0.05, W), every: [0.5, 3.2] }, gazeOverride);
    // walking: the head is carried a little low, looking at the ground ahead
    const gaze = { yaw: G.yaw + g.speed / WALK.radius * 0.3, pitch: G.pitch - 0.05 * W, roll: G.roll };
    this.setHead(P, atlas, gaze, stab, mean, extra);
  }

  // Peal call: wind-up, head thrown back (bill to the sky), 3 intro notes + rapid descending trill.
  screech(A, P, atlas) {
    const t = A.t;
    const wind = bump(t, 0.0, 0.62);                                 // small forward dip before the throw
    const back = ss(0.32, 0.72, t) * (1 - ss(3.05, 3.6, t));        // head thrown back and held
    const settle = bump(t, 3.3, 4.0);
    // notes: jaw opens on each note (intro notes ~0.28 s apart, then a ~9 Hz stutter that fades)
    let jaw = 0, note = 0;
    for (const n0 of [0.78, 1.08, 1.38]) { const b = bump(t, n0, n0 + 0.2); jaw = Math.max(jaw, 0.4 * b); note = Math.max(note, b); }
    if (t > 1.62 && t < 3.0) {
      const k = (t - 1.62) / 1.38;
      const osc = Math.max(0, Math.sin((t - 1.62) * TAU * 9.0));
      jaw = Math.max(jaw, (0.2 + 0.14 * osc) * (1 - 0.5 * k) * ss(1.62, 1.7, t) * (1 - ss(2.85, 3.0, t)));
      note = Math.max(note, osc * (1 - 0.6 * k));
    }
    P.jaw = jaw;
    // hackles and throat: head & neck feathers raised, body pulses with each note
    P.fluff = 0.55 * ss(0.2, 0.8, t) * (1 - ss(3.4, 4.2, t));
    P.breath += 0.8 * note;
    P.pitch += 0.02 * back + 0.012 * note - 0.03 * wind;
    P.trunkOff.y -= 0.008 * wind - 0.004 * back;
    P.tail.pitch -= 0.07 * note + 0.05 * back;
    P.tail.spread += 0.08 * back;
    // slight wrist lift (wings loosen) during the call
    P.wingL.elev += 0.05 * back; P.wingR.elev += 0.05 * back;
    P.wingL.wrist -= 0.08 * back; P.wingR.wrist -= 0.08 * back;
    // head: from forward dip to thrown back (world pitch ≈ +115° → bill past vertical), vibrating with the notes
    atlas.set(0, lerp(0.098, 0.17, back) - 0.012 * wind, lerp(0.242, 0.15, back) + 0.02 * wind);
    const pitch = lerp(-0.08, 1.68, back) - 0.35 * wind + 0.04 * note - 0.12 * settle; // bill to the sky (≈95°)
    return {
      gaze: { yaw: 0.05 * Math.sin(t * 1.3), pitch, roll: 0.03 * Math.sin(t * TAU * 9) * note },
      extra: { upper: -0.95 * back, limit: lerp(1.15, 1.9, back) },
      stab: 0.15,
    };
  }

  // Look over the shoulder (≈170°) with saccades, a head cock to look up, then back.
  headTurn(A, P, atlas) {
    const t = A.t, d = A.dir;
    // saccade key-poses: [time, yaw, pitch, roll]
    const keys = [[0, 0, -0.08, 0], [0.08, 0, -0.08, 0], [0.3, 1.25, -0.02, 0.05], [0.95, 1.3, -0.02, 0.05], [1.2, 2.95, 0.05, 0.12], [1.85, 2.98, 0.05, 0.14], [2.05, 2.9, 0.3, 0.42], [2.6, 2.9, 0.3, 0.42], [2.85, 1.0, -0.02, 0.05], [3.2, 0, -0.08, 0]];
    let k = 0; while (k < keys.length - 2 && keys[k + 1][0] <= t) k++;
    const a = keys[k], b = keys[k + 1];
    const u = clamp((t - a[0]) / (b[0] - a[0]), 0, 1);
    const e = smoother(u) + 0.05 * Math.sin(Math.PI * u) * u;
    const yaw = lerp(a[1], b[1], e) * d, pitch = lerp(a[2], b[2], e), roll = lerp(a[3], b[3], e) * d;
    if (Math.abs(t - 0.1) < 0.02 || Math.abs(t - 1.0) < 0.02) this.nictBlink();
    // body turns a little toward the look and shifts weight
    const turn = ss(0.1, 1.2, t) * (1 - ss(2.6, 3.4, t));
    P.bodyYaw += 0.12 * d * turn;
    P.roll += 0.03 * d * turn;
    P.tail.yaw -= 0.08 * d * turn;
    // the atlas swings round toward the shoulder and rises
    const ay = yaw * 0.28;
    // raptors swivel the head almost in place on the twisting cervical column: small lateral shift only
    atlas.set(Math.sin(ay) * 0.035, 0.098 + 0.02 * turn, 0.242 * lerp(1, 0.86, turn));
    return { gaze: { yaw, pitch, roll }, extra: { neckYawK: 0.3, neckRollK: 0.45 }, stab: 0.3 };
  }

  // ---------------------------------------------------------------- air (flap / glide)
  updateAir(dt, P) {
    const a = this.a, R = this.R, t = this.time;
    a.flapW = approach(a.flapW, this.airStyle === 'flap' ? 1 : 0, 1.6, dt);
    const Wf = a.flapW;
    const freq = FLAP_HZ;
    if (Wf > 0.01) a.phase += freq * dt; else a.phase = 0.28; // glide holds the mid-downstroke phase
    const ph = a.phase % 1;
    // speed & circling path
    a.speed = approach(a.speed, lerp(FLIGHT.glideSpeed, FLIGHT.flapSpeed, Wf), 0.8, dt);
    const omega = a.speed / FLIGHT.radius;
    a.yaw += omega * dt;
    a.pos.x += Math.sin(a.yaw) * a.speed * dt;
    a.pos.z += Math.cos(a.yaw) * a.speed * dt;
    // correct drift back onto the circle (numerical)
    const L = this.lake;
    const cx = L.center.x - FLIGHT.radius * Math.cos(a.yaw), cz = L.center.y + FLIGHT.radius * Math.sin(a.yaw);
    a.pos.x = approach(a.pos.x, cx, 0.5, dt); a.pos.z = approach(a.pos.z, cz, 0.5, dt);
    // coordinated turn: bank angle from v²/(r g); turning left → left wing down (roll −)
    const bankTarget = -Math.atan(a.speed * a.speed / (FLIGHT.radius * 9.81));
    a.bank = approach(a.bank, bankTarget, 1.5, dt);
    // turbulence: a damped roll disturbance, corrected by differential twist + tail
    const gust = (Math.sin(t * 0.73) * 0.6 + Math.sin(t * 1.91 + 1) * 0.3 + Math.sin(t * 3.7 + 2) * 0.1);
    a.gustRollV += (gust * 0.35 - a.gustRoll * 6 - a.gustRollV * 3.2) * dt;
    a.gustRoll += a.gustRollV * dt;
    // occasional glide "tuck": wrists flexed briefly to speed up / cross a sink
    if (t > a.tuckT) { a.tuck = t; a.tuckT = t + 7 + R() * 8; }
    const tuck = bump(t - a.tuck, 0, 1.8) * (1 - Wf);

    // --- body: lift oscillation (lowest at mid-downstroke), surge, pitch
    const lowest = 0.28;
    const bob = -0.013 * Math.cos(TAU * (ph - lowest)) * Wf;
    const surge = 0.006 * Math.sin(TAU * (ph - lowest)) * Wf;
    const pitchOsc = 0.022 * Math.sin(TAU * (ph - 0.1)) * Wf;
    const altWobble = 0.25 * Math.sin(t * 0.21) + 0.12 * Math.sin(t * 0.5 + 1);
    P.pos.set(a.pos.x, a.pos.y + altWobble, a.pos.z); P.yaw = a.yaw;
    const basePitch = lerp(0.035, 0.085, Wf);
    P.pitch = basePitch + pitchOsc + 0.01 * Math.sin(t * 0.9);
    // eagles flap mainly in straight flight and circle on set wings: the flapping bird holds a shallow bank
    const bankVis = a.bank * lerp(1, 0.35, Wf);
    P.roll = bankVis + a.gustRoll * (1 - 0.5 * Wf);
    P.bodyYaw = 0;
    P.trunkOff.set(0, bob, surge);
    const mean = { off: new THREE.Vector3(0, 0, 0), pitch: basePitch, roll: bankVis + a.gustRoll * (1 - 0.5 * Wf), bodyYaw: 0 };

    // --- wings
    const flapWing = (side) => {
      const f = {};
      for (const k in STROKE) f[k] = STROKE[k](ph);
      // hand lags the arm: tip up while the arm sweeps down, trailing down in the upstroke
      const dE = (STROKE.elev(ph + 0.004) - STROKE.elev(ph - 0.004)) / 0.008;
      f.droop = 0.045 * dE;
      f.handTwist = 0; f.foreTwist = 0; f.digitFlex = 0.05; f.alula = 0.08; f.pronate = 0; f.armDroop = 0;
      f.flutter = 0.25;
      return f;
    };
    const gl = { ...GLIDE };
    const glideWing = (side) => {
      const s = side === 0 ? 1 : -1;
      const w = { ...gl };
      const n1 = Math.sin(t * (1.13 + 0.07 * side) + side * 2.1) * 0.6 + Math.sin(t * 2.71 + side) * 0.4;
      const n2 = Math.sin(t * 3.9 + side * 1.7) * 0.5 + Math.sin(t * 6.3 + side * 0.4) * 0.5;
      w.elev += 0.022 * n1 - 0.01;
      w.bend += 0.08 * n1 + 0.04 * n2;
      w.droop += 0.02 * n2;
      // roll correction: pronate the rising wing, supinate the sinking one (aileron-like), + turn
      w.twist += s * (a.gustRoll * 0.35 + a.gustRollV * 0.06) + 0.01 * n2;
      w.fpitch = 0.03 * n2;
      w.elbow += 0.35 * tuck; w.wrist += 0.45 * tuck; w.sweep -= 0.12 * tuck; w.spread = 1 - 0.35 * tuck;
      w.flutter = 0.7;
      return w;
    };
    const WL = lerpWing(glideWing(0), flapWing(0), Wf), WR = lerpWing(glideWing(1), flapWing(1), Wf);
    WL.t = t; WR.t = t + 0.37;
    P.wingL = WL; P.wingR = WR;

    // --- tail: fanned while circling, steering with roll corrections, passive pitch with the stroke
    P.tail.spread = lerp(0.38, 0.2, Wf) - 0.15 * tuck;
    P.tail.pitch = -0.02 + 0.035 * Math.cos(TAU * (ph - 0.4)) * Wf + 0.02 * Math.sin(t * 0.8);
    P.tail.roll = -a.gustRoll * 1.2 - 0.15 * (a.bank - bankTarget);
    P.tail.yaw = 0.04 * Math.sin(t * 0.57) + a.gustRollV * 0.05;
    P.tail.bend = 0.05 * Wf * Math.sin(TAU * (ph - 0.3));
    P.tail.fluff = 0;

    // --- legs tucked: feet clenched under the tail coverts
    // (tarsi pressed against the belly, feet clenched against the under-tail coverts)
    P.legL = leg({ pos: new THREE.Vector3(0.036, -0.052, -0.175), femurPitch: 2.0, femurSplay: 0.08, toeCurl: 1, footPitch: 0.9 });
    P.legR = leg({ pos: new THREE.Vector3(0.036, -0.052, -0.175), femurPitch: 2.0, femurSplay: 0.08, toeCurl: 1, footPitch: 0.9 });

    // --- head: stabilised in space; scanning the water below with saccades
    P.jaw = 0; P.lidUp = 0; P.lidLo = 0; P.fluff = 0; P.fluffBody = 0; P.breath = Math.sin(t * TAU * 0.7) * 0.4;
    P.flutter = lerp(0.8, 0.55, Wf);
    const G = this.updateGaze(dt, { yaw: 0.55, pitchLo: -0.55, pitchHi: 0.0, every: [0.6, 2.8] }, null);
    // look into the turn a little, and down at the water
    const gaze = { yaw: G.yaw * lerp(1, 0.6, Wf) + 0.12, pitch: G.pitch * lerp(1, 0.6, Wf) - 0.05, roll: G.roll * 0.5 }; // gaze is world-levelled (birds hold the head level in a bank)
    const atlas = new THREE.Vector3(0, 0.108, 0.328);
    this.setHead(P, atlas, gaze, 0.95, mean, { neckYawK: 0.4, neckRollK: 0.2 });
  }
}
