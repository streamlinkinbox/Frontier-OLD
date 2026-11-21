<!--==========================================================================================================================================
                                                              TRANSPORT.MD
==========================================================================================================================================-->
<!-- 🧩 Native GI mechanisms, comparisons and explicit failed renderer gates. -->

# Cone and dynamic diffuse probe transport

**The missing experimental GI mechanisms are implemented, not production-accepted.**
This continuation adds reflected-radiance voxel cones, dynamic diffuse irradiance probes and multi-site propagation.
The earlier triangle-cache gather is unchanged and is not relabelled cone GI or DDGI.

[Interactive native comparisons](Gi.html) · [Float32 measurements](Results/GiSummary.json) ·
[verification integrity](Results/GiIntegrity.json) ·
[implementation](../../Experimental/DistanceClipmap/Transport/README.md)

![Measured GI comparison](Images/GiBenchmark.png)

## Scope and rejection

| Concern                | Result / boundary                                                                        |
| ---------------------- | ---------------------------------------------------------------------------------------- |
| Cone radiance          | Actual reflected RGB, six directional opacity/radiance lobes, ordered mips, 16 cones.    |
| Distance consumption   | Baked vehicle → distance clips → cone zero-read culling, not fake constant-sky GI.       |
| Dynamic diffuse probes | Actual triangle hits, RGB cosine convolution, octahedral distance moments/interpolation. |
| Multiple sites         | Fresh Jacobi arrays; positive transport/contraction checks and residual reporting.       |
| Source isolation       | Vehicle emitters / point / finite Sun / rectangle / combined / exact source-off black.   |
| Moving vehicle         | Twelve actual rigid poses; both fields refreshed; no substituted geometry/pixel warps.   |
| GPU execution          | Eight native Slang compute entries; full 480 × 270 **GI** readbacks and propagation.     |
| GPU input boundary     | Geometry hits, direct relight, voxel clipping and primary samples remain CPU inputs.     |
| Visual quality         | **Rejected:** cone energy/detail loss, voxel bias and probe blotches/leakage remain.     |
| Reference              | Finite 128/512 direction triangle integrals; grainy, not certified ground truth.         |
| Materials              | Same geometric-normal two-sided Lambertian diagnostic, not production paint/glass.       |
| Required acceptance    | Better quality **and** faster is not established. No production/editor replacement.      |
| Unrun / unavailable    | Physical user GPU, Windows/MSVC, native viewport, production PBR, real-time pacing.      |

No denoiser, spatial image filter, temporal accumulation, hidden sky/fill, radiance clamp, roulette or
resolution/precision reduction is used. Individual native captures are **480 × 270**, four primary samples,
Float32 RGB. PNG/GIF are display derivatives, not the stored radiometric precision.
The archive retains 106 native PNGs and 58 lossless static/reference/GPU Float32 buffers. All 48 motion PNGs,
raw Float32 hashes and four RGB-lossless APNGs are retained; motion Float32 payloads are reproducible but omitted
from Git to stay within the cumulative artifact budget. Rendering precision, resolution and budgets are unchanged.

The GPU work is not advertised as a GPU scene renderer: the new kernels consume CPU-generated surface inputs.
SwiftShader is a **CPU Vulkan device**. Its execution proves neither discrete-GPU speed nor Windows/editor behavior.
The prior [distance/cache checkpoint](README.md) and its images remain unchanged as historical evidence.

## Executed verification and measurements

| Check                            | Observed result                                                       |
| -------------------------------- | --------------------------------------------------------------------- |
| New Release/native CTests        | 2/2, 83.96 s: CPU transport and executed Vulkan transport.            |
| Separately configured Vulkan-OFF | 1/1, 23.52 s; CPU executable byte-identical to Vulkan-enabled build.  |
| Host ASan/UBSan                  | Both new hosts finish successfully; external driver uninstrumented.   |
| CPU assertions                   | 5,460,839; includes per-voxel finite/range checks, not distinct rays. |
| Tested distance culling          | 45 zero-read culls / 3,142 steps; tested RGB difference exactly zero. |
| Warm/cold motion and source-off  | Warm moving refresh equals cold; source-off and cleared RGB black.    |
| GPU ground-receiver gathers      | Cone max 4.09782e-8, probe max 1.49012e-8 absolute RGB difference.    |
| Full native GPU GI image parity  | Cone max 5.18486e-5, probe max 2.23517e-7; not bit-identical.         |
| Final source-only polish         | Two native + eight SPIR-V products byte-identical after rebuild.      |
| Evidence/layout integrity        | 106 PNGs, 58 float archives, 24 source hashes, all eight entries.     |
| Browser evidence viewer          | 6 sources / 3 depths / 2 GPU / 12 poses; links/mobile/errors pass.    |
| Earlier checkpoint regression    | Original 4/4 CTests and integrity validator pass again.               |

An initial legacy regression rerun omitted `VK_ICD_FILENAMES` and failed instance creation (`-9`).
Supplying the same explicit SwiftShader ICD used by its original reproduction passed all 4/4 again;
[failed environment log](Results/GiLegacyBeforeDriverEnv.txt) and
[corrected regression log](Results/GiLegacyCTest.txt) are retained. This was not hidden as an initial pass.

| GI gather                      | Median CPU time | Linear RGB RMSE to finite 512 | Both required metric gates |
| ------------------------------ | --------------- | ----------------------------- | -------------------------- |
| Triangle cache, 128 directions | 9552.64 ms      | 0.00558667                    | Baseline                   |
| Six-lobe radiance cones        | 8804.89 ms      | 0.01830405                    | **Fail: worse error**      |
| Dynamic diffuse probes         | 110.55 ms       | 0.00870828                    | **Fail: worse error**      |

Cold setup: triangle cache 1398.92 ms; cone including surface cache 1540.92 ms; probes including their current
cone-cache dependency 3266.51 ms. The warm gather table excludes these costs and common primary/direct work.
A faster low-frequency lookup with greater error is not the requested better-quality-and-faster result.

## Transport mathematics and approximations

| Path           | Operation / disclosed approximation                                                            |
| -------------- | ---------------------------------------------------------------------------------------------- |
| Direct cache   | Exact triangle source visibility, 32 extended-source samples, both sides of every facet.       |
| Cone storage   | Three fixed 64³ levels, 0.125 / 0.25 / 0.5 m, six directional RGB + opacity lobes, seven mips. |
| Voxelization   | Clip each triangle to intersected cells; projected-area weighted reflected radiance.           |
| Cone mip       | Front-to-back composition along each look direction, then four-column transverse average.      |
| Cone gather    | 16 cosine-measure sectors; directional and spatial/mip interpolation; finite 24 m / 192 steps. |
| Cone bias      | Explicit 0.125 m normal displacement and 0.25 m initial travel; near-field paths are lost.     |
| SDF assistance | Conservative distance + finite-floor bound culls zero reads on the **same** cone steps.        |
| Probe geometry | 33 × 25 × 7 at 0.5 m; 512 fixed paired Sobol directions, 24 m finite ray range.                |
| Probe angular  | 8² irradiance, 16² distance moments; normalized finite cosine quadrature.                      |
| Probe gather   | Trilinear × wrapped-cosine² × cubed Chebyshev visibility weights, 0.05 m normal bias.          |
| Probe validity | Near-surface rejection and >25% reverse-hit heuristic; not a vehicle solid-sign guarantee.     |
| Domain         | Finite probe/voxel bounds; no ambient fallback outside coverage.                               |

The normalized cosine rule reconstructs a constant radiance as `E/π = L`; its unnormalized quadrature error
is still reported. Probe weighting and coarse opacity remain **biased** approximations. This is not the NVIDIA
DDGI SDK, exact visibility, an Unreal-equivalence claim or reciprocal/flux-conserving physical transport.

Secondary emitter `Le` is excluded because primary/source next-event evaluation already accounts for those paths.
Reflected-direct cache radiance is propagated as `L_next = D + ρ × T(L_previous)` using fresh arrays.
For this positive discrete approximation, weights sum at most one in real arithmetic and `ρ ≤ 0.8`.
The test exercises the infinity-norm contraction with explicit Float32 tolerance. The retained
[emissive](Results/GiEmissiveResiduals.json) and [combined](Results/GiCombinedResiduals.json) residual/tail estimates
refer only to that **discrete fixed point**, not convergence to exact physical GI.
Four-site images use three propagation iterations; they are not labelled converged.

## Lifecycle and actual consumption

- Cache RGB clear → exact black cone GI; restore → identical RGB; direct light/shadows unchanged.
- Disable distance culling → identical tested cone RGB, but nonzero zero-read culls disappear.
  That is consumption and a conservative sampled regression, **not measured SDF acceleration**.
- Clear probe irradiance or GPU resident incoming RGB → exact black probe GI; restore → identical RGB.
- Disable moment visibility → changed positive probe results, proving actual distance-moment consumption.
- Source mask / Sun direction / Sun radius / pose snapshots reject stale queries.
  Moving warm refresh matches a cold reconstruction. Sun change/restoration refreshes without retained light.
- Unchanged inputs perform no field rebuild. Geometry/material edits are rejected until scene/bounds/CDF/bake
  reconstruction. The caller relocates distance clips before a pose refresh; stale clip pose is rejected.
- Relighting/probe refresh is full, not an incremental GPU radiance or engine scene-revision implementation.

The GPU host reuses the existing validation device lifetime. An initial host attempt incorrectly mixed that
explicitly loaded ICD with global Vulkan-loader entry points and crashed before the transport test completed.
The corrected host resolves every device command through the created device. The failure log is retained,
not blamed on shader quality or hidden as a passing run.

## Native images and viewing

![Combined GI and finite references](Images/GiCombinedInspection.png)

![Vehicle-emitter-only GI](Images/GiEmissiveInspection.png)

Each panel above contains an unscaled 480 × 270 native derivative, with labels outside the image.
One/two-secondary-site references have matching path depth for the corresponding one/two-site approximations.
The four-site row has **no matched four-site reference** and is not used for a matched-depth error claim.
The shaded/lit panel is a linear direct + indirect sum, not a display-space blend.

- [All six source selections](Images/GiSourceIsolation.png).
- [Actual cone emitter-GI poses](Images/GiMotionConeAllPoses.png) and
  [probe emitter-GI poses](Images/GiMotionProbeAllPoses.png).
- [GPU native GI readbacks](Images/GiGpuInspection.png).
- [Cone GI GIF](Images/GiMotionCone.gif) and [probe GI GIF](Images/GiMotionProbe.gif).
  These are palette derivatives. RGB animated PNGs and all individual PNG samples are retained;
  static/reference/GPU Float32 buffers are archived.
- `Images/GiPresentation*.png` show only the HTML evidence viewer, **not** the native editor.

## Files actually opened for visual inspection

Opened the retained `GiCombinedInspection`, `GiEmissiveInspection`, `GiSourceIsolation`, `GiGpuInspection`
and `GiBenchmark` PNGs, plus both `GiMotion*AllPoses` sheets (all twelve cone and all twelve probe GI poses),
all three `GiRadianceLevel*` PNGs and `GiOffProbe.png`.
Cone near-field/detail loss and coherent probe blotches are visible; emitter-only motion is very dark, not
accepted as a readable beauty result. The fine radiance slices are mostly empty at the chosen +Z/z=0.55 m slice;
they are directional field diagnostics, not failed/approved beauty renders. Source-off black is intentional.

This is not a claim that all 106 native files were individually opened. Browser UI screenshots/interaction checks
are separate from inspection of renderer captures. Finite references remain visibly grainy.

## Fair CPU comparison

`GiBenchmark.json` retains five alternating three-method rounds after one warm-up per method.
All use the same four primary surface samples, sources, geometric normals, matte materials and 32-sample relight.
The triangle-cache baseline uses 128 secondary directions. Cone/probe estimators use the disclosed spatial fields.
They are **not equal images or equivalent unbiased sample budgets**.

- Gather timing excludes primary intersections, direct lighting, field setup and file encoding for every method.
  Cold surface-cache, cone and extra probe costs are reported separately.
- Current probe setup depends on the cone class for its surface sites, so its full API cold cost includes that
  dependency; it is not silently subtracted as if the implementation had already separated those allocations.
- Native warm-up and every timed repeat are Float32-identical **within each method**.
- Quality is linear RGB RMSE to the new finite 512 reference, with 128→512 delta also retained.
  A faster but more biased or visibly blotchy result does not pass the required acceptance gate.
- Capture CSV timings are production logs, not the isolated matched benchmark. Compilation/checking was not
  run concurrently with the benchmark. No software-device number predicts the user's GPU.

## Reproduce locally

The tested sources are additions on base `502793b4762990342c0d1bfc2fdd69728d20cd01`;
`GiSummary.json` records hashes for the experiment, native host/shader source and evidence scripts.
The [source-only style rebuild](Results/GiStyleParity.json) verifies two native hosts and eight shaders remain
byte-identical to the executed capture/test products. Both sanitizer hosts completed before that token-preserving
source formatting. No algorithm or numeric budget changed afterward.

Prerequisites: CMake ≥3.20, C++20 compiler/threads; optional Vulkan SDK/driver and native Slang.
Python requires NumPy/Pillow; browser checks require Node/Playwright/Chromium with working fonts/runtime libraries.
Tested host: Linux x86-64, GCC 12.2, CMake 3.31.10, Slang 2026.14.1, two vCPUs; strict Float32 / precise `-O0`,
SwiftShader CPU. Python packages: NumPy 2.2.6 / Pillow 11.3.0; Chromium 153.0.8010.0 / Playwright 1.56.1.
No Windows product binary is delivered or claimed verified; no GitHub Actions are authorized.

```bash
Root="$PWD"
Build="$Root/_ClaudeScratch/build/DiffuseTransport"
Archive="$Root/Experimental/SlateReference/B/Exhibits/IlluminationHost/Archive"
Output="$Root/_ClaudeScratch/tmp/GiEvidence"
cmake -S Experimental/DistanceClipmap/Transport -B "$Build" -DCMAKE_BUILD_TYPE=Release
cmake --build "$Build" --config Release --parallel 2
ctest --test-dir "$Build" -C Release --output-on-failure

# Optional native Vulkan configuration; supply your actual SDK/compiler/driver locations.
cmake -S Experimental/DistanceClipmap/Transport -B "$Build" \
  -DFRONTIER_TRANSPORT_VULKAN=ON -DFRONTIER_TRANSPORT_SLANG="$(command -v slangc)" \
  -DFRONTIER_TRANSPORT_DRIVER="$VulkanDriver"
cmake --build "$Build" --config Release --parallel 2
ctest --test-dir "$Build" -C Release --output-on-failure

"$Build/TransportValidation" "$Archive" "$Output" capture
"$Build/TransportValidation" "$Archive" "$Output/Motion" motion
cp "$Output/Motion"/GiMotion*.pfm "$Output/"
cp "$Output/Motion/GiTimings.csv" "$Output/GiMotionTimings.csv"

# Run alone: no parallel renders, builds or driver checks.
"$Build/TransportValidation" "$Archive" "$Output" benchmark
"$Build/TransportValidation" "$Archive" "$Output" validate
"$Build/TransportVulkan" "$Archive" "$Build/Shaders" "$Output" "$VulkanDriver" validate
"$Build/TransportVulkan" "$Archive" "$Build/Shaders" "$Output" "$VulkanDriver" capture

python3 Exhibits/DistanceClipmap/Code/InspectTransport.py "$Output" --build-directory "$Build"
```

Windows multi-configuration generators use `Release/*.exe`; adapt the host shell/path syntax accordingly.
`refresh` repeats only approximate captures while preserving existing references; the retained final run uses `capture`.

Restore pinned Vulkan/Slang dependencies using the earlier
[distance/cache instructions](README.md#reproduce-native-checks-and-evidence).
Provide your actual Vulkan SDK paths when configuring an ordinary SDK rather than that isolated recovery.

Host ASan/UBSan uses `-O1 -g -fsanitize=address,undefined -fno-omit-frame-pointer`, the same strict float/C++20
flags and includes. CPU leak checks are on; external-driver leak checks are off for the Vulkan host.
Shaders and the external driver are not sanitizer-instrumented. Logs are retained under `Results/Gi*`.

```bash
python3 Exhibits/DistanceClipmap/Code/ServeTransport.py --port 4174
# In another terminal with a working local browser/runtime/font configuration:
npm install --prefix _ClaudeScratch/tmp/EvidenceBrowser --save-exact playwright-core@1.56.1
export NODE_PATH="$Root/_ClaudeScratch/tmp/EvidenceBrowser/node_modules"
CHROMIUM_EXECUTABLE="$(command -v chromium)" \
  node Exhibits/DistanceClipmap/Code/ValidateTransportPresentation.cjs http://127.0.0.1:4174/Gi.html
python3 Exhibits/DistanceClipmap/Code/ValidateTransport.py \
  --shader-directory "$Build/Shaders" --compiler "$(command -v slangc)"
```

`ValidateTransport.py` requires the retained CTest and both sanitizer logs. It regenerates and compares all eight
SPIR-V byte streams/reflection, rejects a misaligned-material control, verifies hashes, lossless buffers,
native PNG conversion and source checks. It is an evidence-integrity validator, **not an artifact-free certificate**.
The initial integrity attempt detected its own not-yet-created report link; Inspector now invalidates that report
with a pending result on regeneration, before the independent validator writes success/failure.
Browser checks also reject an HTTP-200 report with `passed: false`, not just a missing report.

## Still required before integration

- Eliminate the rejected cone near-field/voxel/level bias and probe blotches/leaks without hiding them with denoising.
- Establish better quality **and** faster fair total/moving-scene performance; no passing renderer gate is claimed here.
- Move geometry/source/primary work to the complete GPU renderer, with device-local storage and full validation
  coverage.
- Connect production BRDF/material/clearcoat/metal/glass/cloth, editor/physics motion and automatic scene revision
  ownership.
- Verify on the user's physical GPU and Windows, including frame pacing at 60/120 Hz, not just equal prescribed poses.
