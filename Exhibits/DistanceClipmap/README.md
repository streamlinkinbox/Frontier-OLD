<!--==========================================================================================================================================
                                                                README.MD
==========================================================================================================================================-->
<!-- 🧩 Retained native vehicle-distance/radiance evidence, failed acceptance gates and exact reproduction commands. -->

# Distance clipmap / radiance evidence

**Checkpoint scope:** this report describes commit `502793b` and its original images/tests.
The subsequent [cone / dynamic-probe transport continuation](Transport.md) has separate implementation,
measurements and [interactive GI comparisons](Gi.html). Do not read the historical missing-feature list below
as a description of that later experiment; neither checkpoint is production-accepted.

**The complete replacement is not delivered.** The equal-image CPU hybrid is **3.56% slower** than triangle-only,
raw voxel shadows fail visibly, and isolated GI remains grainy. Nothing is integrated into the production renderer.
These are verified numerical experiments and retained failures, not Unreal equivalence or real-time acceptance.

[Interactive evidence](index.html) · [actual visual inspection](Inspection.md) ·
[native mechanisms and build](../../Experimental/DistanceClipmap/README.md).

![Actual raw-control and triangle-refined shadows, not generated illustrations](Images/ShadowComparison.png)

## Executed results — 2026-11-18

| Verification                         | Observed result                                                 |
|--------------------------------------|-----------------------------------------------------------------|
| Standalone Release / CTest            | **4/4 pass**: numeric, cache sides, consumption, native Vulkan.  |
| CPU-only configuration               | Separately configured/built without Vulkan; **3/3 CTests pass**.|
| Native arithmetic                    | 27,246 assertions; 0/8,192 hybrid visibility differences.        |
| Float32 / independent double nearest | Maximum `7.53087388006e-8 m` over 300 queries.                    |
| Distance lower intervals             | No excess in 4,096 tested local/clip queries.                    |
| CPU incremental clips                | Four moves byte-equal cold rebuilds; stationary zero rewrites.   |
| Cache-side regression                | 4,550 reverse-side failures before; zero after / 25,068 facets.   |
| Native data-flow ablations            | Bake changes clips; clips affect marching; cache affects GI.     |
| Vulkan parity                        | Local/clip/probe error zero; 0/16,396 visibility disagreements.  |
| Vulkan point-light cache              | Max RGB error `1.49011611938e-7`; 1,976 positive gathers.          |
| GPU cache consumption                | Clearing cache RGB makes gathered RGB exactly zero.             |
| Shader layouts                       | Six executed SPIR-V streams match typed reflection/offsets.     |
| ASan + UBSan                         | All four host programs exit zero; no reported errors.           |
| Native image checks                  | 82 × 480 × 270 finite/nonnegative captures; repeats exact.       |
| All-source-off controls              | Direct and direct + cached GI exactly zero in Float32.           |
| Matched CPU speed                    | `5133.988 → 5316.622 ms`: **FAIL, 3.56% more time.**              |
| Noise-free / realistic appearance    | **FAIL:** visible GI grain, cache bias, matte-only model.        |
| Physical GPU / Windows / editor      | **Not run.** No 60/120 FPS or frame-pacing verification.          |

All numerical claims are bounded-fixture results. Vulkan executes on **SwiftShader CPU device type 4**,
not a physical GPU. The cache-side defect was reproduced in this new prototype, not established in the linked engine.

### Actual runtime consumption

`Results/Consumption.json` adds ablations with fixed sources, geometry and resolution:

```text
Clear local bake samples   → 21,404 clip texels change after refill
Clear clip Lower channels  → 2,311 / 4,096 query step counts change
                             triangle-refined visibility stays equal
Clear only cache RGB       → all 64 positive GI receivers become exactly black
                             direct unchanged; restore RGB → original GI bit-for-bit
```

This verifies reads along `bake → clips → marcher` and `cache → diffuse gather`. It does **not** demonstrate a
completed combined SDF/cone/cache GI renderer, DDGI, automatic pose/light revision tracking, quality or speed.
CPU clips repair dirty regions but still scan every cell; GPU clips refill fully. Moving captures explicitly relight.

### Fair CPU timing

![Measured matched CPU times](Images/Benchmark.png)

Five alternating pairs follow a warm-up, without concurrent experiment builds/renders. Identical camera, geometry,
480 × 270 resolution, four primary samples, 32 samples per extended source and bit-identical Float32 images.
Timing includes primary tracing, visibility and direct shading; excludes bake, relight and encoding.
The shared two-vCPU host and CPU model are recorded in `Results/Manifest.json`. No GPU timing is inferred.
Other capture timings, more samples or cache/reference comparisons are **not** accepted equal-quality speedups.

## What the images establish

| Evidence                            | Interpretation                                                    |
|-------------------------------------|-------------------------------------------------------------------|
| `Images/ShadowComparison.png`        | Raw heuristics fail; hybrid equals the finite triangle reference. |
| `Images/SourceIsolation.png`         | Emissive, point, Sun, rectangle, combined; direct and GI.          |
| `Images/CacheInspection.png`         | Outward-only control, corrected cache, finite reference; grain.   |
| `Images/DistanceInspection.png`      | Actual unsigned bake, clip coverage and GPU-buffer slices.        |
| `Images/PathInspection.png`          | Finite 128/512 spp diffuse paths and geometric normals.           |
| `Images/GpuPointSurfaceCache.png`    | GPU cache projected onto CPU-traced vehicle hits, not GPU image.  |
| `Images/MotionAllPoses.png`          | All twelve freshly rendered combined-direct rigid poses.         |
| `Images/NightMotionAllPoses.png`     | All twelve emission-only direct + cached-GI poses; visible grain. |
| `Images/DistanceMotionAllPoses.png`  | Corresponding moving CPU clip slices, not warped images.          |

![Actual twelve-pose movement; GIF is a palette derivative](Images/VehicleMotion.gif)

Lossless RGB APNGs: [combined direct](Images/VehicleMotion.png),
[emission-only](Images/EmissiveMotion.png), [distance](Images/DistanceMotion.png).
Each decoded APNG pose equals its individual RGB PNG; GIF is palette-quantized and not a precision measurement.
Playback is a four-second, twelve-pose loop, **not measured rendering FPS**. Motion is prescribed, not driving/Jolt.

The cache-side logic is fixed, but **full-image quality improvement is not established**:
- Corrected and outward-only emission-only 512-GI Float32 images are identical in this camera.
- Combined cached-GI RMSE against the finite uncached reference is `0.00431884 → 0.00432028`: slightly worse.
- That reference itself has finite quadrature error. Neither deterministic samples nor passing logic tests
  makes the images converged, noise-free or photorealistic. [Exact comparisons](Results/Comparisons.json).

## Bounded rendering-path audit

| Concern                    | Explicit configuration / unresolved boundary                           |
|----------------------------|------------------------------------------------------------------------|
| Vehicle                    | Linked archives byte-identical; 25,068 actual body/wheel facets.       |
| Topology                   | Body has 104 boundary / 98 nonmanifold exact-coordinate edges.          |
| Distance sign              | Unsigned vehicle; signed closed analytic boxes. No solid certificate. |
| Distance precision         | Float32, 80 × 40 × 32 bake; three 48³ clips at .125/.25/.5 m.            |
| Conservative intervals     | Lipschitz corner correction + fixture-scale `2e-5 m` margin.           |
| Unknown/near/step limit     | Refine original triangle interval; never declare an SDF hit.          |
| Outside local bake         | Enclosing-box distance is a lower bound, not exact vehicle distance.   |
| Surface transport          | Geometric-normal, two-sided Lambertian override; original material IDs.|
| Production materials       | Paint/metal/glass/textures/cloth **not evaluated**.                    |
| Surface cache              | Both facet sides + 64² floor lattice, .25 m spacing; approximation.    |
| Indirect                   | One reflected diffuse bounce, triangle gathers; no cone GI or DDGI.   |
| Path integration           | Three scattering sites, 128/512 spp; finite-depth/sample error.        |
| Sources                    | Vehicle radiant facets, point, uniform solar cap, rectangle.          |
| Point / Sun                | `[70,56,42]` intensity / `[3.2,3,2.6]` normal irradiance, .00465 rad.   |
| Rectangle                  | 3 × 2 m, `[9,9.5,11]` radiance; next-event only, not visible geometry.  |
| Lamp fidelity              | Actual radiant facets; no photometric/IES/headlight optics parity.    |
| Environment                | Sky/environment/fill zero; RGB units are not real-light calibration.  |
| Sampling                   | 32D Joe–Kuo Sobol; distinct source/bounce dimensions, fixed shifts.    |
| Static budgets             | Direct 32 × 4 primary; GI 128/512 × 4 primary, full 480 × 270.          |
| Night motion budget        | 64 GI × 1 primary; explicitly not an equal-quality static comparison. |
| Filtering / clamping       | No denoiser, history, radiance clamp or throughput cutoff.             |
| Display                    | Reinhard then exact sRGB; GI-only exposure ×8, other radiance ×1.     |
| Native buffers             | Linear HDR Float32; no FP16 or 8-bit distance/radiance reduction.       |
| GPU layout                 | Eight SSBOs, typed uint material at byte 12, 128-byte pushes.          |
| GPU memory / dependencies  | Coherent mapped allocations, fences, host/compute/readback barriers.  |
| GPU resource acceptance    | Guarded tails/layout/readbacks tested; no validation-layer coverage.  |
| GPU missing work           | Full transport/image path, device-local staging, dirty clips, timing.|
| Motion / 60–120 Hz          | Equal prescribed pose at equal time only; no engine pacing claim.     |

Radiometric mechanisms inspected in the new code:
- Point response is `ρ/π × I/r² × max(n·ω,0) × visibility`.
- Uniform solar-cap integration includes cosine and `2/(1+cosθ)` normalization; cap first moment is tested.
- Rectangle and vehicle-facet samples include both cosines, inverse-square distance and reciprocal area PDF.
- Cosine-proposed diffuse GI cancels `cos/π` against its PDF. Cache entries hold **reflected** radiance;
  first-secondary self-radiance is excluded because direct emitter sampling already counts that arrival.
- Actual facet normals avoid an unverified smooth-normal Jacobian substitution. Rigid local/world transforms
  and reflected wheel winding are explicit; arbitrary deformations/scales are not validated.
- Offset-origin shadow segments, one-sided lamp radiance, degenerate GPU normals, side-aware caches and typed
  material storage were corrected during the experiment. Only the side-cache defect has a retained failing
  regression; no before/after visual improvement is invented for the other corrections.

`Results/SourceAudit.json` pins upstream `c205cb698288ccd90bf909e25e28ce28d48d0dfa` with excerpts/hashes,
directory presence and archive topology. The linked plan rejects coarse SDF direct shadows; the inspected cone
shader integrates constant sky visibility, not emissive cache transport. The C++ demo has default denoisers,
clamps and skipped triangle GI construction. **This is not execution/audit of every engine/editor route.**
The raw controls here are newly authored experiments, not screenshots of that upstream baseline.

## Reproduce native checks and evidence

Host tested: GCC 12.2, CMake 3.31.10, Ninja 1.11.1.4, Slang 2026.14.1, Linux x86-64, two experiment threads.
Windows/MSVC and physical GPUs are unrun; no Linux product binary is delivered. No Actions were triggered.
Downloaded dependencies/build outputs remain ignored.

```bash
python3 Exhibits/LightCompute/Code/Prepare.py
python3 -m pip install --target _ClaudeScratch/tmp/BuildPackages cmake==3.31.10 ninja==1.11.1.4
python3 -m pip install --target _ClaudeScratch/tmp/PythonPackages numpy==2.2.6 Pillow==11.3.0 scipy==1.15.3

Root="$PWD"
Cmake="$Root/_ClaudeScratch/tmp/BuildPackages/cmake/data/bin/cmake"
Ctest="$Root/_ClaudeScratch/tmp/BuildPackages/cmake/data/bin/ctest"
Build="$Root/_ClaudeScratch/build/DistanceClipmapCmake"
Vulkan="$Root/ExternalPackages/VulkanCompute"
"$Cmake" -S Experimental/DistanceClipmap -B "$Build" -G Ninja -DCMAKE_BUILD_TYPE=Release \
  -DCMAKE_MAKE_PROGRAM="$Root/_ClaudeScratch/tmp/BuildPackages/bin/ninja" \
  -DFRONTIER_DISTANCE_VULKAN=ON -DFRONTIER_DISTANCE_SLANG="$Vulkan/Slang/slangtorch/bin/slangc" \
  -DVulkan_INCLUDE_DIR="$Vulkan/Vulkan-Headers-1.4.321/include" \
  -DVulkan_LIBRARY="$Vulkan/SwiftShader/libvulkan.so.1"
"$Cmake" --build "$Build" --parallel 2
export VK_ICD_FILENAMES="$Vulkan/SwiftShader/vk_swiftshader_icd.json"
"$Ctest" --test-dir "$Build" --output-on-failure
python3 Exhibits/DistanceClipmap/Code/ValidateFootprints.py \
  "$Vulkan/Slang/slangtorch/bin/slangc" "$Build/Shaders"
```

Release uses strict Float32, no fast math or FMA contraction. Slang uses `-fp-mode precise -O0`;
`-O2` was blocked by missing `spirv-opt`. Software-driver wall times do not predict physical-GPU timing.

Run sequentially; the 480 × 270 suite takes minutes, not real time:

```bash
Archive="Experimental/SlateReference/B/Exhibits/IlluminationHost/Archive"
Capture="_ClaudeScratch/tmp/DistanceClipmapEvidence"
"$Build/RadianceEvaluation" "$Archive" "$Capture" 32 12 all
"$Build/RadianceEvaluation" "$Archive" "$Capture" 32 0 convergence
# Benchmark alone, after all other renders/builds finish:
"$Build/RadianceEvaluation" "$Archive" "$Capture" 32 0 benchmark
"$Build/VulkanDistanceEvaluation" "$Archive" "$Build/Shaders" "$Capture"
cp "$Build/Consumption/Consumption.json" "$Capture/Consumption.json"
PYTHONPATH="$Root/_ClaudeScratch/tmp/PythonPackages" \
  python3 Exhibits/DistanceClipmap/Code/InspectCaptures.py "$Capture"
# Optional pinned audit; uses the already-configured GitHub CLI:
python3 Exhibits/DistanceClipmap/Code/AuditReference.py --download
```

ASan/UBSan flags: `-O1 -g -fsanitize=address,undefined -fno-omit-frame-pointer`, plus the same strict float,
C++20, pthread and include flags. Numeric and consumption use `ASAN_OPTIONS=detect_leaks=1`;
Vulkan host uses `detect_leaks=0` for the uninstrumented external driver. Logs/reports are retained in `Results/`.
Sanitizers do not instrument shader execution. The local formatting configuration changes whitespace only;
all four native executables and six SPIR-V products rebuilt **byte-identically** (`Results/FormattingParity.json`).

### HTML viewer verification

Serve only the exhibit, not the repository or scratch directory:

```bash
python3 -m http.server 4173 --bind 0.0.0.0 --directory Exhibits/DistanceClipmap
```

With Node, a local headless Chromium executable and its fonts/runtime dependencies installed:

```bash
npm install --prefix _ClaudeScratch/tmp/EvidenceBrowser --save-exact playwright-core@1.56.1
export NODE_PATH="$Root/_ClaudeScratch/tmp/EvidenceBrowser/node_modules"
export CHROMIUM_EXECUTABLE="/path/to/chromium"
node Exhibits/DistanceClipmap/Code/ValidatePresentation.cjs http://127.0.0.1:4173/
python3 Exhibits/DistanceClipmap/Code/ValidateEvidence.py --shader-directory "$Build/Shaders"
```

The browser test exercises three shadow selections, five source selections, twelve matched pose selections,
play/pause, reduced motion, desktop/mobile layout, local links and a missing-report negative control.
The initial packaged-browser launch failed on missing font/runtime configuration; corrected local Fontconfig
and library paths passed. That was an environment repair, not a renderer fix. `Results/BrowserDiagnosis.txt`
retains the failure; `Presentation.json` records the tested Chromium version/hash and final result.

## Retained evidence interpretation

- `Manifest.json`: base `96f31ecaef529d383e195013f5f00d163392f71a` plus SHA-256-identified sources on
  `arena/f2d37e4b-frontier`. This avoids a self-referential final commit hash; the delivery message gives it.
- `Numeric`, `Vulkan`, `Consumption`, `Footprints`, `CacheSideBefore/After`, `CaptureChecks`: bounded native results.
- `Benchmark`, `Comparisons`, `PixelChecks`: measured timing, linear errors and every capture's statistics/hashes.
- `Ctest.txt`, `*Sanitizers*.txt/json`, `*Run.txt`: retained execution logs/reports, not planned checks.
- `Presentation.json` / `Integrity.json`: viewer interaction and retained-file consistency, not artifact acceptance.
- `Buffers/*.f32.zlib`: static radiance comparisons, top-down little-endian Float32 RGB, `[270,480,3]`.
  Decode with `numpy.frombuffer(zlib.decompress(payload), '<f4').reshape(270,480,3)`.
- `Images/*.png`: display derivatives. Debug palettes intentionally include full-scale channels; HDR above one
  is not clipping. Pixel statistics do not replace manual visual acceptance.
- `Images/Presentation*.png`: actual HTML-viewer screenshots, **not** native editor captures.
- `Inspection.md`: exactly what was opened and rejected; not an automated artifact-free certificate.

Full production PBR/glass, converged GI without denoisers, voxel-cone GI/DDGI, complete GPU transport, broad
geometry/light/camera coverage, physical-GPU speed, editor/Windows execution and 60/120 FPS remain incomplete.
The failure is deliberately not hidden behind a completed-plan label or a production feature toggle.
