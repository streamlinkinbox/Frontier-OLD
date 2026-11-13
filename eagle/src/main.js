import * as THREE from 'three';
import { World, terrainHeight, LAKE } from './env/World.js';
import { Eagle } from './eagle/Eagle.js';
import { Animator } from './eagle/Animator.js';
import { Post } from './post/Post.js';
import { featherUniforms } from './eagle/materials.js';

const $ = (id) => document.getElementById(id);
const params = new URLSearchParams(location.search);
window.addEventListener('error', (e) => { $('err').textContent = String(e.message || e); });
window.addEventListener('unhandledrejection', (e) => { $('err').textContent = String(e.reason && e.reason.stack || e.reason); });
const setLoad = (p, msg) => { $('loadbar').style.width = `${Math.round(p * 100)}%`; if (msg) $('loadmsg').textContent = msg; };
const tick = () => new Promise((r) => requestAnimationFrame(() => setTimeout(r, 0)));

const ACTIONS = [
  { id: 'idle', key: '1', nm: 'Idle', ds: 'Breathing, saccades, blinks, rouse' },
  { id: 'walk', key: '2', nm: 'Walk', ds: 'Rocking gait on the shore (toggle)' },
  { id: 'screech', key: '3', nm: 'Peal call', ds: 'Head thrown back, chatter' },
  { id: 'headturn', key: '4', nm: 'Head turn', ds: '≈170° over the shoulder' },
  { id: 'flap', key: '5', nm: 'Flap', ds: '2.8 Hz flapping flight' },
  { id: 'glide', key: '6', nm: 'Glide', ds: 'Circling glide, fingered tips' },
];

function buildHud() {
  const hud = $('hud');
  hud.innerHTML = `
    <div class="panel title"><div class="k">FRONTIER · CREATURE LAB</div><h1>Bald Eagle</h1><div class="s">Haliaeetus leucocephalus · adult female · 2.05 m span</div></div>
    <div class="panel settings">
      <div class="row">Time <div class="seg" id="speed"><button data-v="1" class="on">1×</button><button data-v="0.5">½×</button><button data-v="0.25">¼×</button><button data-v="0.1">⅒×</button></div></div>
      <div class="row">Camera <div class="seg" id="camsel"><button data-v="orbit" class="on">Orbit</button><button data-v="side">Side</button><button data-v="front">Front</button><button data-v="close">Head</button></div></div>
    </div>
    <div class="stats" id="stats"></div>
    <div class="toast" id="toast"></div>
    <div class="panel help"><b>Controls</b><br><kbd>1</kbd>–<kbd>6</kbd> animations · <kbd>S</kbd> slow motion<br>Drag to orbit · wheel to zoom · <kbd>H</kbd> hide HUD</div>
    <div class="actions">${ACTIONS.map((a) => `<button class="act" data-id="${a.id}"><span class="kb">${a.key}</span><span class="nm">${a.nm}</span><span class="ds">${a.ds}</span></button>`).join('')}</div>`;
  if (params.has('nohud')) hud.classList.add('hidden');
}

async function main() {
  const renderer = new THREE.WebGLRenderer({ antialias: false, powerPreference: 'high-performance', preserveDrawingBuffer: params.has('manual') });
  renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 1.5));
  renderer.setSize(innerWidth, innerHeight);
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.toneMapping = THREE.NeutralToneMapping;
  renderer.toneMappingExposure = 1.0;
  document.body.prepend(renderer.domElement);
  const fadeEl = document.createElement('div'); fadeEl.id = 'fade'; fadeEl.style.transition = 'none'; document.body.appendChild(fadeEl);
  const scene = new THREE.Scene();
  scene.fog = new THREE.FogExp2(0xa9bccf, 0.00055);
  const camera = new THREE.PerspectiveCamera(35, innerWidth / innerHeight, 0.02, 30000);

  setLoad(0.05, 'Building lakeshore…'); await tick();
  const world = new World(scene, renderer);
  await world.buildEnvironment(renderer);
  setLoad(0.4, 'Growing plumage…'); await tick();
  const eagle = new Eagle({ quality: params.get('q') || 'high', clay: params.has('clay') });
  scene.add(eagle.object);
  // plumage gets a stronger share of sky light than the terrain (dark feathers otherwise read as black)
  for (const m of eagle.skyLitMaterials) if (m) { m.envMap = scene.environment; m.envMapIntensity = 1.0; m.needsUpdate = true; }
  const anim = new Animator(eagle, { ground: terrainHeight, lake: LAKE });
  const post = new Post(renderer, scene, camera, { samples: 4, bloom: false });
  post.finish.uniforms.uGrain.value = 0.018; post.finish.uniforms.uVignette.value = 0.22;
  const resize = () => { renderer.setSize(innerWidth, innerHeight); camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix(); post.setSize(innerWidth, innerHeight, renderer.getPixelRatio()); };
  addEventListener('resize', resize); resize();

  if (params.get('mode') === 'flap' || params.get('mode') === 'glide') { anim.airStyle = params.get('mode'); anim.mode = 'air'; anim.a.flapW = anim.airStyle === 'flap' ? 1 : 0; }

  // ------------------------------------------------------------------ camera
  const target = new THREE.Vector3(), camTarget = new THREE.Vector3();
  const cam = { dist: 2.3, elev: 0.14, azim: 0.75, preset: 'orbit' };
  let freeze = false, camInit = false;
  const airCam = { dist: 3.6, elev: 0.3, azim: 2.4 };
  function placeCam(dt) {
    eagle.trunkWorld(target);
    if (freeze) return;
    const air = anim.mode === 'air';
    let dist = air ? airCam.dist * cam.dist / 2.3 : cam.dist, elev = air ? airCam.elev + (cam.elev - 0.14) : cam.elev, azim = air ? airCam.azim + (cam.azim - 0.75) : cam.azim;
    if (cam.preset === 'side') { azim = Math.PI / 2; elev = 0.05; }
    if (cam.preset === 'front') { azim = 0.0; elev = air ? 0.05 : 0.08; }
    if (cam.preset === 'close') { dist = air ? 1.8 : 0.9; azim = 0.9; elev = 0.12; }
    // the air camera is attached to the heading (it follows the eagle round its circle)
    const base = air ? anim.pose.yaw : 0;
    const a = azim + base;
    const look = cam.preset === 'close' ? eagle.headWorld(new THREE.Vector3()) : target;
    if (!camInit || dt === 0) { camTarget.copy(look); camInit = true; } else camTarget.lerp(look, 1 - Math.exp(-(air ? 30 : 8) * dt));
    camera.position.set(camTarget.x + Math.sin(a) * Math.cos(elev) * dist, camTarget.y + Math.sin(elev) * dist, camTarget.z + Math.cos(a) * Math.cos(elev) * dist);
    const gy = terrainHeight(camera.position.x, camera.position.z) + 0.08;
    if (camera.position.y < gy) camera.position.y = gy;
    camera.lookAt(camTarget);
  }
  let drag = null;
  renderer.domElement.addEventListener('pointerdown', (e) => { drag = [e.clientX, e.clientY]; });
  addEventListener('pointerup', () => { drag = null; });
  addEventListener('pointermove', (e) => { if (!drag) return; if (cam.preset !== 'orbit') setPreset('orbit'); cam.azim -= (e.clientX - drag[0]) * 0.006; cam.elev = Math.max(-1.2, Math.min(1.4, cam.elev + (e.clientY - drag[1]) * 0.005)); drag = [e.clientX, e.clientY]; });
  addEventListener('wheel', (e) => { cam.dist = Math.max(0.35, Math.min(20, cam.dist * (1 + e.deltaY * 0.001))); }, { passive: true });

  // ------------------------------------------------------------------ HUD
  buildHud();
  const toast = (msg) => { const el = $('toast'); el.textContent = msg; el.classList.add('show'); clearTimeout(toast.t); toast.t = setTimeout(() => el.classList.remove('show'), 1400); };
  const setSpeed = (v) => { anim.speedScale = v; for (const b of $('speed').children) b.classList.toggle('on', +b.dataset.v === v); };
  function setPreset(v) { cam.preset = v; for (const b of $('camsel').children) b.classList.toggle('on', b.dataset.v === v); }
  $('speed').addEventListener('click', (e) => { const v = e.target.dataset && e.target.dataset.v; if (v) setSpeed(+v); });
  $('camsel').addEventListener('click', (e) => { const v = e.target.dataset && e.target.dataset.v; if (v) setPreset(v); });
  const fire = (id) => { anim.trigger(id); toast(ACTIONS.find((a) => a.id === id).nm); };
  document.querySelector('.actions').addEventListener('click', (e) => { const b = e.target.closest('.act'); if (b) fire(b.dataset.id); });
  addEventListener('keydown', (e) => {
    const a = ACTIONS.find((x) => x.key === e.key); if (a) fire(a.id);
    if (e.key === 's' || e.key === 'S') { const seq = [1, 0.5, 0.25, 0.1]; setSpeed(seq[(seq.indexOf(anim.speedScale) + 1) % seq.length]); }
    if (e.key === 'h' || e.key === 'H') $('hud').classList.toggle('hidden');
  });
  function refreshHud(fps) {
    const lab = anim.label;
    for (const b of document.querySelectorAll('.act')) {
      const id = b.dataset.id;
      const on = (id === 'walk' && anim.mode === 'ground' && anim.walking) || (id === 'idle' && lab === 'Idle') || (id === 'screech' && lab === 'Peal call') || (id === 'headturn' && lab === 'Head turn') || (id === 'flap' && anim.mode === 'air' && anim.airStyle === 'flap') || (id === 'glide' && anim.mode === 'air' && anim.airStyle === 'glide');
      b.classList.toggle('on', on);
    }
    const extra = anim.mode === 'air' ? ` · ${(anim.a.speed * 3.6).toFixed(0)} km/h · bank ${(Math.abs(anim.a.bank) * 57.3).toFixed(0)}°` : '';
    $('stats').textContent = `${lab.toUpperCase()}${extra} · ${eagle.stats.bones} bones · ${(eagle.stats.triangles / 1000).toFixed(0)}k tris · ${fps.toFixed(0)} fps${anim.speedScale !== 1 ? ` · ${anim.speedScale}× time` : ''}`;
  }

  // ------------------------------------------------------------------ frame
  let t = 0, fpsAcc = 0, fpsN = 0, fps = 60, hudT = 0;
  function frame(dt) {
    t += dt;
    featherUniforms.uTime.value = anim.time;
    const pose = anim.update(dt);
    eagle.applyPose(pose);
    world.update(dt);
    placeCam(dt);
    world.follow(target);
    fadeEl.style.opacity = anim.fade.v.toFixed(3);
    post.render(dt, t);
    fpsAcc += dt; fpsN++; hudT += dt;
    if (hudT > 0.25) { fps = fpsN / fpsAcc; fpsAcc = 0; fpsN = 0; hudT = 0; refreshHud(fps); }
  }
  window.__game = {
    THREE, eagle, anim, camera, world, cam, scene, renderer, terrainHeight,
    setFreeze: (v) => { freeze = v; },
    // advance the simulation deterministically (probes): n steps of dt without rendering, then one render
    step: (n = 1, dt = 1 / 60, draw = true) => { for (let i = 0; i < n; i++) { const p = anim.update(dt); if (i === n - 1 || !draw) eagle.applyPose(p); } if (draw) { featherUniforms.uTime.value = anim.time; placeCam(0); world.follow(target); fadeEl.style.opacity = anim.fade.v.toFixed(3); post.render(dt, t += dt); } return anim.label; },
    render: () => { frame(1 / 60); return true; },
    renderOnly: () => { post.render(0, t); return true; },
    setPreset,
    ready: true,
  };
  $('loading').classList.add('done'); if (params.has('manual')) $('loading').style.display = 'none';
  if (!params.has('manual')) { const clock = new THREE.Clock(); const loop = () => { frame(Math.min(0.05, clock.getDelta())); requestAnimationFrame(loop); }; loop(); }
  else frame(0);
}
main().catch((e) => { console.error(e); $('err').textContent = String(e && e.stack || e); });
