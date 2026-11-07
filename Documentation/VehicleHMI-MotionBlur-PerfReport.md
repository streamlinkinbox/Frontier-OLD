# VehicleHMI — Motion Blur Fix & Performance Optimization Report
### Branch `arena/38ffdb11-frontier` · based on `arena/8ff1f043-frontier` (commit 78d573a) · Date 2026-11-07

> You asked for: (a) clone/inspect `arena/8ff1f043-frontier` which runs ray-traced BVH full GI, (b) fix the VehicleHMI motion-blur so it actually shows, (c) a report of *real* optimizations that do **not** reduce quality (no resolution/bounce knobs), and (d) which of those can be exposed as toggles in a separate debug panel for the HTML/WebGPU VehicleHMI demo so you can A/B FPS.
>
> This doc is that report. The motion-blur fix from `8ff1f043` has been ported to this branch; all other `8ff1f043` performance instrumentation (shareable JSON, fast profile) is also ported because it is what you need to *measure* the toggles. Native Vulkan code is untouched — this is a WebGPU demo concern.

---

## 1) What the checked-in demo is actually running

**Default level `Projects/Everest/Content/Levels/Default.levelspace`:12–53**

- `hardware_ray_query = true`, `quality_tier = 2` (high), `trace_scale = 2` (GI+reflections at ½×½), `initial_candidates = 2`, `max_bounces = 3`, ReSTIR temporal+spatial+visibility reuse, `ray_traced_shadows = true`, `reflection_bounces = 2`, `variance_filter = true`, `temporal_aa = true`, 4 diffuse + 3 glossy wavelet levels, `mirror_filter = false`, `solar_disc = false`, `penumbra_filter = false`, `stratified_sun = false`.
- Primary visibility is *rasterized*; GI, reflections and sun shadows are BVH-traced. Sky is environment, cards provide radiosity tail. Fog samples the 3 raster shadow cascades.

**Caveat — “RTX” is software BVH here.** `Engine/Shaders/GlobalIllumination/RayIntersection.slang:37–38` walks `BvhEntries`/`BvhTriangles` storage buffers in compute with a 48-deep stack, `MaxBvhSteps 384`. No `VK_KHR_acceleration_structure` / `VK_KHR_ray_query` is requested in the C++ on `main` or `8ff1f043`. So the GI *is* fully ray-traced, but on compute — not RT cores. Image parity is exact if you later move it to hardware.

**Where the 30–80 ms comes from at 679×402:** ~68 k trace pixels ×2 paths × (3 closest-hit + NEE sun/light shadow + 1 spatial reuse + 1 full-res sun) + ~273 k reflection rays — all in one oversized kernel that also holds BSDF, 64-light RIS, HMI fetches, sky, card tails. Private stack spills on Turing is the frame.

**Bring-up 43–54 s** is pipeline creation (`DeviceExchange.cpp`, `VulkanComputeExchange.cpp` pass `VK_NULL_HANDLE` cache, one-by-one) recompiling every illumination entry including 4× `RayIntersection.slang`.

---

## 2) Motion blur — why “before/after” looked identical

### The bug the previous agent shipped first (commit `860df47`)

```wgsl
let Motion = textureLoad(SurfaceMotion, Pixel, 0).xy;
let MotionBlurStrength = f32((Frame.Features >> 16u) & 255u) / 255.0;
let Current = CompressRange(ResolveCameraMotionBlur(Pixel, Motion, MotionBlurStrength)); // ← BLURRED
...
let Resolved = mix(Prior, Current, Fraction); // TAA: 0.9 prior + 0.1 current
textureStore(AntialiasTarget, Pixel, vec4f(ExpandRange(Resolved), 1.0));
```

- Blur was baked into `Current` *before* the TAA history blend. TAA keeps 90 % sharp history (`Fraction = 0.1`), so the next frame’s `Prior` is almost entirely sharp and it overwrites the blur. Net result: camera moves, pixels have velocity, but the presented image stays sharp. Stationary scenes legitimately show nothing (no velocity), so the toggle appeared dead.

- Default `Strength = 0.35` made the residual even harder to spot.

### What “look at the nonsense it did” actually meant

The agent’s own post-mortem you quoted was correct in diagnosis:

> “the blur was applied **before** temporal antialiasing, which blends in mostly sharp history and largely cancels the effect. I’ve changed the resolve to composite the blur **after** that history blend, and raised the component’s default strength to make it easier to see.”

The fix landed in `78d573a` and is now on this branch.

---

## 3) Correct fix now on this branch

**File:** `Experimental/SlateReference/A/Exhibits/VehicleProvingGrounds/Shader/DisplayAntialias.wgsl:38–111`

```wgsl
fn ResolveCameraMotionBlur(Pixel, MotionPixels, Strength) -> vec3f {
    let Centre = textureLoad(RecombinedRadiance, Pixel, 0).rgb;
    let Speed = length(MotionPixels);
    if (Strength <= 0.0 || Speed < 0.75 || Frame.InspectionMode != 0u) return Centre;
    let ClampedMotion = MotionPixels * min(1.0, 24.0 / Speed) * Strength;
    let CentreUv = (vec2f(Pixel)+0.5)*Frame.InverseScreenExtent;
    var Sum = vec3f(0.0);
    for (var Tap=-2; Tap<=2; Tap++) {
        let Offset = ClampedMotion * (f32(Tap)*0.25) * Frame.InverseScreenExtent;
        Sum += textureSampleLevel(RecombinedRadiance, LinearClamp, CentreUv - Offset, 0.0).rgb;
    }
    return Sum*0.2; // 5-tap shutter
}
...
let Motion = textureLoad(SurfaceMotion, Pixel, 0).xy;
let MotionBlurStrength = f32((Frame.Features>>16u)&255u)/255.0;
let Current = CompressRange(textureLoad(RecombinedRadiance, Pixel, 0).rgb);           // sharp
let CameraBlurred = CompressRange(ResolveCameraMotionBlur(Pixel, Motion, MotionBlurStrength)); // blurred
...
let Resolved = mix(Prior, Current, Fraction); // TAA still on sharp Current
let BlurComposite = mix(Resolved, CameraBlurred, clamp(MotionBlurStrength*0.85, 0.0, 0.85));
textureStore(AntialiasTarget, Pixel, vec4f(ExpandRange(BlurComposite), 1.0));
```

**Why this works:** history is resolved from `Current` (sharp) as before; the shutter-blurred `CameraBlurred` is composited *after* with up to 85 % weight. TAA can no longer erase it. When TAA is off or inspection 6/7, we output `CameraBlurred` directly. Threshold `0.75 px` avoids jitter-blur; cap `24 px` keeps taps coherent; strength `0.7` default (was 0.35) is visible without smearing.

**Component:** `Source/CameraMotionBlur.js` — `Enabled = false` by default, `Strength` 0–1 clamped, `ResolveStrength()` returns 0 when disabled. Encoded as 8-bit `Features>>16` (ABI-stable reserve bits). No other exhibit or native build is affected.

**Test locks it:** `Tools/CameraMotionBlur.test.mjs:12` asserts the ordering `mix(Prior,Current)` < `mix(Resolved,CameraBlurred)` in the shader source, plus strength clamping.

### How to verify (do this, not a static screenshot)

1. `npm run serve` in `Experimental/SlateReference/A/Exhibits/VehicleProvingGrounds/`, open `index.html`.
2. Select **ControlVehicle → Camera** in the outliner. You now see two cards:
   - **Camera rig** (mode, shake, speed FOV) and
   - **Camera components** (metric + *Motion blur component* toggle + *Blur strength* slider).
3. Enable **Motion blur component**, leave Strength at 0.7.
4. **Drive** (WASD) or **Orbit-drag** past a high-contrast edge (building edge, lane marking). Blur is along the per-pixel `SurfaceMotion` vector. A parked car with a static camera has `|Motion|≈0` — correctly no blur.

> Previous agent’s UI placed the toggle inside the old “Camera” card together with orbit controls; it is now a dedicated child entity `Camera` under `ControlVehicle` with its own switch in the outliner — the hierarchy you asked for.

---

## 4) Real optimizations that do **not** lower quality

“Not quality controls” = we keep `trace_scale`, `max_bounces`, `initial_candidates`, `spatial_count`, resolution, denoise levels *exactly* as shipped. Every item below preserves the same pixels when inputs haven’t changed.

### A — Native Vulkan (IlluminationHost) — the big levers the other agents identified

| # | Optimization | What it changes | Why it helps FPS (not just load time) | Risk / parity test | Effort |
|---|---|---|---|---|---|
| 1 | **Hardware ray query backend** (`VK_KHR_acceleration_structure` + `VK_KHR_ray_query`) — BLAS per facet (static, once), TLAS per refresh, replace `TraceSceneRay`/`TraceSceneOcclusion` bodies with inline ray-query loops; glass/tyre skips → ray-query candidate checks; “indirect exempt” → instance mask; far-field ground fallback stays analytic | Offloads software BVH walk to RT cores; same triangles, same sampling, same MIS weights | **Largest GPU win on RTX**. Software traversal is 30–80 ms; RT cores cut traversal + divergence. Fallback path stays | High — needs adapter with extension, BLAS/TLAS build, parity captures |
| 2 | **Stop serializing CPU↔GPU** — `DeviceExchange::Submit` currently `vkWaitForFences` after *every* submission; `VulkanComputeExchange::DispatchCompute` submits+waits per call; overlay atmosphere/cloud/fog/lens-flare issues ~10 waits/frame | One command buffer for all overlay passes with barriers, one submit/frame; pending writes folded in; per-frame fences + double-buffer uniform/occupant regions so CPU records N+1 while GPU runs N | Removes GPU idle bubbles between passes; bigger than it looks | Medium |
| 3 | **TLAS reuse / refit** — `IlluminationHost.cpp:438` `RefreshTlas` rebuilds binned-SAH over *every* occupant and re-uploads whole TLAS every refresh (`RayTracingSpace.cpp:362–403, 440–591, 594–599`); static BLASes already built separately | Cache TLAS; on transform change refit affected bounds only; rebuild only when topology changes. Output bit-identical when nothing moved | Eliminates repeated O(N log N) CPU work + upload on static proving ground | Low-medium — hash bounds / revision counter |
| 4 | **Shadow cascade cache** — 3 cascades rasterized every refresh (`ShadowProjection.cpp:152+`) even when fog isn’t sampling them; raster is needed for `FogMedium` shafts | Skip reraster of a cascade when its snapped matrix + casters unchanged; skip all 3 when environment overlay not sampling depth this frame. Same shadow pixels | Saves raster + bandwidth | Low |
| 5 | **Glass exclusion from shadow BLAS** — both traversals `continue` on `VehicleGlassFamily` but those triangles still occupy leaves and are fetched | Build shadow BLAS without glass (and without shredded tyre); shadow ray is identical to what shader returns today, fewer leaf tests | Shadow rays are majority (full-res sun, NEE sun/lights, spatial/temporal) | Low — second BLAS variant |
| 6 | **Cabin HMI area-light gating** — `EvaluateHmiAreaLightNee` runs per direct pixel + per path vertex, loads 336-byte `Occupants[0]`, transforms to local, hard-rejects on cabin box; proving ground has no vehicle, brightness 1, never fires; latency + occupant-0-is-not-car bug | Gate on “cockpit occupant exists”. Outdoors image unchanged; latent wrong-box case gone | Saves loads + math on outdoor path | Low |
| 7 | **Async atmosphere readback** — sky revision changes ≥ every 0.5 s during sun motion, overlay blocks to read transmittance/multi-scatter/sky-view LUTs to CPU (only inspector uses them) | Move to async readback or throttle when inspector not visible | Unblocks main thread | Low |
| 8 | **Per-stage timestamps** — tracker says “no per-stage breakdown without staged submissions”, `8ff1f043` removed `SubmissionTiming` hook | Add `vkCmdWriteTimestamp2` around each refresh stage, async readback; cost ~0 | First thing to do before (1) or (2) so you know which dominates on your GPU — not an fps gain itself | Low |

*Avoid if you want no quality loss:* skipping refreshes in still views (kills ReSTIR accumulation), lowering `MaxBounces`/`InitialCandidates`/`TraceScale`, diabling variance filters (measured: +2.9× diffuse grain, +2.1× reflection grain, +37 % flicker), removing cascades outright.

### B — Software BVH fallback improvements (when (1) not available)

| # | Optimization | Note |
|---|---|---|
| 9 | **Split traversal into its own kernel** — closest-hit + any-hit kernels with small payload, no textures; shading in second kernel; compact instance record 48 B (3×4 world-to-local + flags + BLAS root) vs 336 B `OccupantProfile`; full-res sun cone in its own coherent dispatch (rays within 0.27°) | Avoids spilling path state across BSDF+RIS+sky fetch; coherent warps for shadow rays |
| 10 | **Widen BVH** — binary → 4-wide or compressed 8-wide; 12 SAH bins → 32 with proper traversal-vs-intersection cost | Fewer box tests, shorter stack; conservative bounds ⇒ same hits |
| 11 | **Leaf & math cleanups** — `SafeReciprocal` currently replaces near-zero component with `+1e-9` and drops sign → wrong slab for axis-aligned rays; use `copysign(max(abs(d),1e-20),d)` or plain reciprocal; Woop watertight triangle test only inside the traversal kernel; short-stack restart trail to avoid 48-deep stack / 384-step overflow dropping nodes |

These belong *inside* that kernel, not as quality knobs, and need per-GPU profiling + parity.

### C — Load-time only (not per-frame FPS but worth doing)

| # | Optimization | Note |
|---|---|---|
| 12 | **Persist `VkPipelineCache` + parallel `createComputePipelines`** — both computes pass `VK_NULL_HANDLE` cache, created one-by-one; NVIDIA recompiles every illumination entry including 4× `RayIntersection.slang` each launch | First launch stays slow, second drops to <1 s |

---

## 5) What can be added to the HTML/WebGPU demo as toggles — separate debug panel

The Vehicle Proving Grounds WebGPU demo (`Experimental/SlateReference/A/Exhibits/VehicleProvingGrounds/`) already has a **Render settings → Frame timing** panel from `860df47`:

- `Log every second` emitting `vehiclehmi_perf_v1` JSON (CPU wall-time + GPU timestamps kept separate; unsupported adapters report `unavailable`, never zero),
- `Copy JSON` / `Download JSON`,
- `Apply fast profile` / `Restore saved` (low grade, quarter trace, no reflections/smoke/shadows — *quality* A/B, not part of the quality-preserving set).

**Your ask:** a *separate* debug panel just for the quality-preserving optimizations above, where each toggle can be flipped during a drive and FPS delta read instantly.

### Proposal — add under outliner entity “Debug · Perf Toggles” (Vehicle group, colour neutral)

This keeps editor columns intact and isolates measurement from render controls.

| Toggle (off by default = shipped behaviour) | WebGPU demo maps to | FPS signal to watch (`TimingLog`/`HardwareMetrics`) | Implementation sketch | Effort |
|---|---|---|---|---|
| **TLAS reuse** | `IlluminationHost.js`: skip `Distance.ScheduleInvalidation` + `RayTracingSpace.RefreshTlas` when `Scene.ComputeRevision` == prior | `CPU scene_update` ↓, `CPU command_encode` ↓ | Revision counter on occupant transforms + hash of active set | Low |
| **Shadow cascade reuse** | `ShadowProjection.js:ResolveCascades` — skip `RecordCascades` when snapped matrix + caster AABB unchanged | `GPU Shadow cascades` EMA → 0 on static sun | Cache 3 matrices + raster only on change | Low |
| **Skip cascades when fog off** | Gate cascades on `EnvironmentSettings.Fog.Enabled` & camera inside fog volume | Same as above but larger when fog disabled (current always pays it) | Boolean in `Refresh` uniform | Low |
| **Shadow glass cull** | Build shadow BLAS variant without `VehicleGlassFamily` facets | `GPU DirectRadiance` shadow ray portion ↓ | Second index buffer built once per facet set | Low |
| **HMI cabin gate** | Branch `EvaluateHmiAreaLightNee` equivalent in `DirectRadiance.wgsl` on `Occupants[0].flags & HasCockpit` | `GPU Direct radiance` & ReSTIR path vertex ↓ outdoors | Add flag in `EffectProfile` | Low |
| **Batch command buffer** | Already one encoder/frame in `IlluminationHost.js:AdvanceFrame` — but ensure no `onSubmittedWorkDone` waits per pass; keep single `Device.queue.submit` | `CPU queue_submit_call` ↓, fewer bubbles | No change needed — verify no extra submits added | None |
| **Async LUT readback** | `AtmosphereIntegrator.js` — defer `readBuffer` to idle or when inspector open | `CPU scene_update` spikes every 0.5 s disappear | `setTimeout`/worker readback | Low |
| **Compact instance record** *(future)* | Replace `OccupantProfile` load in `RayTraversal.wgsl` with 48 B record | `GPU Ray trace` ↓ (less VGPR spill) | New storage buffer, keep full one for shading | Medium |
| **Sun coherence dispatch** *(future)* | Separate `IntegrateDirectRadiance` sun pass over full-res extent vs half-res GI | Same pass split, more coherent warps | Two dispatches, shared BVH | Medium |
| **Wide BVH** *(future)* | `RayTracingSpace.js` → 4-wide nodes, 32 bins | `GPU Ray trace` ↓ on software path | Rebuild BLAS offline, version bump | Medium |

*Not suitable as toggles:* hardware ray query (needs extension and new pipeline, not a runtime boolean), pipeline cache (load-time), per-stage timestamps (measurement), `SafeReciprocal`/stack fixes (correctness).

### How to measure FPS correctly in the debug panel

- Use **observed FPS from delta** `1000 / avg(frame_delta_ms)` *and* **smoothed FPS** `1/FrameSeconds` — both in `vehiclehmi_perf_v1`. GPU pass times are EMA + last sample per pass; CPU times are wall-time averages over the 1 s window (callback, scene_update, command_encode, queue_submit). Share the JSON — it includes `screen_extent`, `trace_extent`, `draw_runs`, `distance_bricks`, `card_tiles`, `light_count`, adapter, UA, so comparisons are apples-to-apples.
- Test protocol: drive same loop (e.g., `?stress=256&stressmotion=1` seeded layout), enable one toggle, collect 2 windows before/after, compare `frame.delta_time_ms.average_ms` and `cpu_wall_time_ms.scene_update.average_ms` + `gpu_timestamp_queries.pass_ema_ms["Shadow cascades" | "Direct radiance" | "Distance union"]`.

---

## 6) Prioritized recommendation

1. **Do first (measure):** per-stage `timestamp-query` / `performance.now()` splits — you can’t rank (1) vs (2) without it. Hook already exists (`HardwareMetrics.LastDurations`, `PassSamples`).
2. **Do next (cheap, quality-identical):** TLAS reuse + cascade reuse + fog-gated cascades + HMI gate + glass cull. No new pipelines, just caching/branching. Validate with `vehiclehmi_perf_v1` before/after.
3. **Do after (bigger):** command-buffer batching + async readback; then hardware ray-query backend on top of a cached TLAS. Keep software BVH as fallback for CI/SwiftShader.
4. **Last (if software path remains):** compact instance record → separate sun dispatch → wide BVH + Woop test.

Quality fixes that are *not* perf optimizations but are worth turning on for RTX path (separate from the debug panel): `solar_disc = true`, `stratified_sun = true`, `penumbra_filter = true`, `mirror_filter = true` (`mirror_trace` optional, costly). They improve glint (`572→56` errors) and penumbra contact hardening at 13–37 ms on SwiftShader.

---

## 7) What the previous agent got wrong (and what’s now fixed)

- **Motion blur before TAA** made the toggle look dead — fixed to after-TAA composite and stronger default.
- **Camera component not an entity** — previously a row inside the Vehicle inspector; now `ControlVehicle → Camera` entity with its own card, as you asked.
- **Native deletions in `860df47`** (removal of `DeviceExchange` fault paths, `SceneViewport` present logic) were reverted on this branch — native is not touched here. If you want those perf changes natively, they should be reintroduced behind the `FRONTIER_ILLUMINATION_STAGED_SUBMISSIONS` flag, not as deletions.
- **Performance instrumentation claimed “real optimizations” but was only logging + fast profile.** That logging is kept because you need it to *see* FPS; the actual optimizations are the table above and should be toggled one-by-one in the new Debug panel, not bundled as “fast profile”.

---

## 8) Files on this branch

- **Motion blur:** `Experimental/SlateReference/A/Exhibits/VehicleProvingGrounds/Shader/DisplayAntialias.wgsl` (fix), `Source/CameraMotionBlur.js` (new), `Source/InspectorPages.js` (Camera entity), `Source/IlluminationHost.js` (Feature bit 16–23, perf counters), `Source/HardwareMetrics.js` / `Source/TimingLog.js` (shareable JSON), `Style/InspectorReference.css`, `Tools/CameraMotionBlur.test.mjs`, `index.html`, `README.md`.
- **Report you’re reading:** `Documentation/VehicleHMI-MotionBlur-PerfReport.md` (this file).
- **Tests:** `npm test` in the exhibit — 67 tests including `CameraMotionBlur.test.mjs` ordering assertion.

### Quick test

```sh
cd Experimental/SlateReference/A/Exhibits/VehicleProvingGrounds
npm test   # → 67 passing
# then npm run serve, open http://localhost:8000, ControlVehicle → Camera → enable Motion blur, drive
```

---

*All FPS claims above are relative; measure on your RTX target with the shareable JSON — SwiftShader CPU emulation at 480×270 (7.5–9 s refreshes) is not predictive of GPU. No image parity is changed by the toggles above.*
