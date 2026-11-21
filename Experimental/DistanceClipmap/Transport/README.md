<!--==========================================================================================================================================
                                                                README.MD
==========================================================================================================================================-->
<!-- 🧩 Isolated cone/probe mechanisms, mathematical bounds and GPU execution boundaries. -->

# Diffuse radiance transport experiment

This continuation implements **actual reflected-radiance cone transport, dynamic diffuse probes and iterative
bounces**. It does not rename the earlier triangle-ray surface-cache gather.
It remains isolated: **no production/editor source or target depends on this directory**.
[Retained evidence and reproduction](../../../Exhibits/DistanceClipmap/Transport.md) ·
[interactive comparisons](../../../Exhibits/DistanceClipmap/Gi.html).

## Mechanisms

| File                    | Mechanism                                                                                  |
| ----------------------- | ------------------------------------------------------------------------------------------ |
| `TransportSnapshot.h`   | Bitwise pose/light snapshots; immutable geometry fingerprint; stale-query rejection.       |
| `DirectionalRadiance.h` | Triangle clipping, six directional RGB/opacity lobes, ordered mips, sixteen diffuse cones. |
| `DiffuseProbeLattice.h` | Probe intersections, octahedral irradiance/distance moments, interpolation and iteration.  |
| `TransportCapture.h`    | Shared four-sample native primary surfaces and finite triangle reference integration.      |
| `ConeTransport.slang`   | GPU injection, ordered mip reduction, cone image gather and surface Jacobi propagation.    |
| `ProbeTransport.slang`  | GPU convolution, distance moments, probe image gather and incoming-radiance propagation.   |
| `CMakeLists.txt`        | Independent CPU / optional Vulkan validation targets; no root CMake changes.               |

The existing `RadianceScene.h` supplies the real ControlVehicle facets, exact triangle visibility,
source integration and matte material evaluation. The production triangle-bounds implementation is reused
through `FacetDistance.h`; no duplicate geometry or third-party renderer is imported.

```text
actual facets + finite point/Sun/rectangle/vehicle-emitter lighting
                      ↓ exact source visibility / two-sided Lambertian relight
               reflected-direct surface radiance D
                      ├─ clipped projected areas → six RGB/opacity voxel lobes
                      │                          → front-to-back mip reduction
baked unsigned        │                          → finite diffuse cones → indirect RGB
vehicle distance →    │
three distance clips ─┘ zero-contribution texture-read culling
                      │
                      └─ actual probe-ray hits → octahedral cosine convolution
                                               + directional distance moments
                                               → visibility-weighted probe interpolation

multiple sites: L_next = D + reflectance × T(L_previous), fresh Jacobi arrays
```

## Explicit approximations

- **Not exact geometry transport.** Each field approximates radiance in space and direction. Visibility remains
  voxel opacity or probe-moment weighting after the original CPU intersections used during construction.
- Cones: three fixed 64³ radiance levels at `0.125 / 0.25 / 0.5 m`, six directional lobes, seven mip extents,
  sixteen equal-cosine-measure hemisphere sectors. Ordered reduction averages four transverse columns after
  front-to-back composition. It is not isotropic RGB mip averaging or a constant-sky visibility integral.
- Cone sampling blends mip extents and directional lobes. Projected surface areas saturate geometric opacity;
  this is not a certified watertight voxelization. Overlapping/opposing surfaces in one voxel can mix radiance.
  Origin normal displacement `0.125 m`, initial travel `0.25 m`, maximum `192` steps / `24 m` intentionally
  introduce near-field, finite-domain and finite-step bias. Level transitions and thin surfaces remain problematic.
- Distance culling includes the finite ground rectangle as well as the baked/clip distance lower interval.
  Its `1.5√3 × ceil-mip-width` filter-support bound only skips **zero-contribution reads** on the same cone
  step sequence. It does not increase the march stride, certify a surface hit or establish acceleration.
- Probes: `33 × 25 × 7 = 5,775`, `0.5 m` spacing, `512` fixed antipodally paired Sobol directions each;
  `8²` octahedral irradiance and `16²` distance-moment texels. Cosine-rule weights are normalized so a constant
  radiance reconstructs constant `E/π`; the report retains the unnormalized finite-quadrature error.
- Probe interpolation uses trilinear, wrapped-cosine-squared and cubed Chebyshev moment weights. These are
  explicit **biased visibility heuristics**, not exact occlusion. Normal displacement is `0.05 m`.
  Outside finite coverage there is no invented ambient fallback. Surface-near and high-backface-ratio probes
  are rejected; the backface ratio is not a solid-sign certificate for the nonmanifold vehicle.
- No temporal hysteresis, denoiser, radiance clamp, roulette, hidden sky/fill or learned reconstruction is used.
  Pose changes fully rebuild radiance/probe storage; incremental radiance updates are not implemented.

## Iteration and lifecycle

The positive discrete gather weights are convex combinations or front-to-back weights with sum at most one
in real arithmetic. Diagnostic RGB reflectances are at most `0.8`; consequently the approximate recurrence
has an infinity-norm contraction bound of `0.8`. Numerical tests allow explicitly small Float32 error.
Residuals and a conservative `last residual / (1 − 0.8)` discrete fixed-point tail estimate are retained.
**This is not reciprocity, physical flux conservation, convergence to exact GI or a noise-free image certificate.**

`Refresh` detects source mask, direct quadrature budget, rigid pose, Sun direction and Sun radius changes.
Queries reject stale inputs instead of retaining old radiance. Light-only refresh resets the iterative field;
pose refresh rebuilds projections/probe intersections. Geometry/material edits are rejected until the caller
reconstructs the scene bounds, source distribution and distance bake. Fixed coefficients are not an editable material
API.

Call `Scene.Clipmap.Relocate` for a new pose **before** refreshing radiance; the API checks that prerequisite.
This is cache lifecycle validation, not an integrated engine scene-revision/animation implementation.

## GPU boundary

Eight Slang entries execute the radiance operations, including Jacobi propagation and full native GI images.
CPU inputs still include triangle intersections, direct source relighting, voxel surface-clipping projections,
probe angular weights and primary surface samples. It is **not a full GPU scene renderer**.
GPU probe intersections omit an unused direction and store Float32 distance separately; no precision is reduced.

Each submission has explicit host/compute/readback dependencies, a fence and guarded storage tails.
The existing exhibit device lifetime is reused; device commands are resolved through that explicitly loaded
Vulkan driver, never mixed with the global loader's dispatch table. Eight storage buffers and 128-byte pushes
are reflected and compared against actual executed SPIR-V. Device-local staging and validation-layer coverage
remain unimplemented. SwiftShader CPU execution does not verify user-GPU speed, Windows, the editor or real-time pacing.

## Build

```bash
cmake -S Experimental/DistanceClipmap/Transport -B _ClaudeScratch/build/DiffuseTransport \
  -DCMAKE_BUILD_TYPE=Release
cmake --build _ClaudeScratch/build/DiffuseTransport --config Release --parallel 2
ctest --test-dir _ClaudeScratch/build/DiffuseTransport -C Release --output-on-failure
```

Optional Vulkan configuration additionally requires `FRONTIER_TRANSPORT_VULKAN=ON`, a Vulkan SDK/loader,
`FRONTIER_TRANSPORT_SLANG` pointing to native `slangc`, and `FRONTIER_TRANSPORT_DRIVER` pointing to the
explicit driver library. The second CTest is registered only when that driver path is supplied.
See the exhibit for complete tested commands and raw results. Windows/MSVC and physical GPUs are unrun;
no Linux binary is packaged as a Windows deliverable. No Actions run is authorized.
