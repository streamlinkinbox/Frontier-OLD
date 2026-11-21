<!--==========================================================================================================================================
                                                              INSPECTION.MD
==========================================================================================================================================-->
<!-- 🧩 Manual observations of the actual retained captures, separated from numerical checks and renderer acceptance. -->

# Manual capture inspection — 2026-11-18

**Visual acceptance: FAIL.** I actually opened the files listed below with the image-reading tool.
These are native C++ diagnostic captures or clearly labelled derivatives, not generated illustrations.
Opening a contact sheet means inspecting its displayed panels; it does **not** mean every source image was
opened separately, examined at arbitrary magnification, or certified free of artifacts.

## Images actually opened

All paths below are relative to this exhibit. Contact-sheet panels preserve the 480 × 270 source pixels;
the viewing interface may scale the sheet. The individual radiance entries were also opened separately.

| Opened file                         | What I observed                                                       |
|-------------------------------------|-----------------------------------------------------------------------|
| `Images/ShadowComparison.png`        | Local streaking/self-shadow artifacts; clipmap contact/thin-detail loss.|
| `Images/CacheInspection.png`         | Dense indirect grain in both cache and finite reference; no acceptance.|
| `Images/PathInspection.png`          | 128/512 spp finite paths and actual facet normals; matte diagnostic.    |
| `Images/MotionInspection.png`        | Six displayed rigid poses; vehicle position/yaw and shadows change.     |
| `Images/DistanceInspection.png`      | Coarse CPU/GPU clip slices, local unsigned bake, coverage and box sign. |
| `Images/SourceIsolation.png`         | All five source selections; direct/indirect/cache panels really differ.|
| `Images/GpuPointSurfaceCache.png`    | Facet-centre radiance projected on the vehicle; black elsewhere by intent.|
| `Images/Benchmark.png`               | Retained measured chart explicitly shows the slower hybrid median.     |
| `Images/HybridDirect.png`            | Triangle-refined contact/louver shadows; faceted, aliased matte scene.   |
| `Images/EmissiveCachedGi512.png`      | Visible grain across floor/walls, even at 512 gather samples.            |
| `Images/CombinedReferenceGi512.png`  | Obvious indirect grain and colour transfer; not converged ground truth. |
| `Images/PathTrace512.png`            | Residual sampled variation, especially near occlusion; not photorealism.|
| `Images/MotionAllPoses.png`          | All twelve lit poses, not just an animated crop of one render.          |
| `Images/NightMotionAllPoses.png`     | All twelve night poses; moving illumination, grain/bright isolated samples.|
| `Images/DistanceMotionAllPoses.png`  | All twelve corresponding coarse moving proximity slices.               |
| `Images/EmissiveSurfaceCache.png`    | Obvious facet/floor blocks in raw cache radiance; expected approximation.|
| `Images/SourcesOffIncludingGi.png`   | Entirely black, as required by the source-off control.                  |
| `Images/VehicleMotion.gif`           | Opened palette animation file; all source poses inspected in the sheet. |
| `Images/Presentation.png`            | Actual desktop HTML viewer; failed acceptance/timing displayed clearly. |
| `Images/PresentationMobile.png`      | Actual mobile HTML viewer; rejection notice fits without horizontal spill.|

Historical `_ClaudeScratch/tmp/DistanceClipmapRun/InitialInspection.png` was also opened earlier. It exposed the
original raw-shadow/GI failures; it is **not** substituted for the refreshed evidence above.

## Rejection findings

| Requirement                     | Observation / decision                                                     |
|---------------------------------|----------------------------------------------------------------------------|
| Raw voxel SDF penumbrae           | Reject: severe local streaking and incorrect clipmap contact/detail.       |
| Hybrid direct visibility         | Float images equal the matched triangle reference; bounded parity only.   |
| No noisy/splotchy GI              | Fail: visible finite-sample grain in isolated GI, including 512 samples.    |
| Corrected cache improves images   | Not established: emission-only control/correction images are identical.   |
| Combined cache quality           | RMSE `0.00431884 → 0.00432028` against finite reference: slightly worse.    |
| Complete path tracer             | Not delivered: three diffuse scattering sites, finite samples/depth bias. |
| Realistic production appearance  | Fail: explicit matte override, no production paint/glass/metal evaluation.|
| Actual vehicle motion            | Yes, actual archive geometry at twelve prescribed poses; no controls/Jolt.|
| Moving distance field            | Visible in all twelve slices; coarse appearance is not watertight signing.|
| Faster matched CPU rendering     | Fail: `5133.988 → 5316.622 ms`, **3.56% slower**, five alternating pairs.    |
| Full GPU image / hardware speed   | Not tested: software Vulkan readbacks, no complete GPU radiance renderer. |
| Production integration           | Not performed: quality and speed gates do not justify replacement.        |

The front white band is retained self-radiant vehicle geometry under the explicit diagnostic material mapping,
not evidence of realistic headlight optics. Dark backgrounds/geometry in source-isolated views are intentional;
this fixture has no sky or hidden fill. The source-off buffer is expected to be completely black.

## What the automated checks do not establish

- Finite, nonnegative pixels and exact source-off black do not detect every acne/leak/banding/firefly defect.
- HDR radiance above one is valid. Reinhard followed by sRGB is a **display** mapping, not an energy clamp.
- GI-only exposure is explicitly ×8; direct/path images use ×1. Do not compare their apparent brightness as
  though the display exposures were equal. Float error measurements use the untouched linear buffers.
- Correct side selection at facet centres fixes a logical prototype defect, not facet/ground cache bias.
- Lossless APNG pose equality verifies encoding; it does not validate real-time rendering or smooth driving.
- The screenshots/readbacks are not a Windows editor session, a photograph, a physical-GPU capture or an
  Unreal implementation comparison. No image here is accepted as the requested finished renderer.

See [retained measurements and reproduction](README.md), [pixel checks](Results/PixelChecks.json),
[linear comparisons](Results/Comparisons.json) and [runtime ablations](Results/Consumption.json).
