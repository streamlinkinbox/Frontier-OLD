<!--==========================================================================================================================================
                                                                README.MD
==========================================================================================================================================-->
<!-- 🧩 Isolated native distance/radiance prototype ownership, mechanisms, build and explicit rejection boundaries. -->

# Distance clipmap experiment

**Not an engine replacement.** Native numerical/Vulkan checks pass in the retained fixture, but the required
noise-free quality **and** faster CPU rendering gate fails.
No production renderer or editor target links this directory.
[Retained images, measurements and reproduction](../../Exhibits/DistanceClipmap/README.md).

## Ownership and mechanisms

| Source                         | Executed mechanism                                                        |
|--------------------------------|---------------------------------------------------------------------------|
| `FacetDistance.h`              | Actual FCT1 vehicle assembly; production triangle bounds builder reused.   |
| `DistanceClipmap.h`            | Local unsigned bake, conservative intervals, three CPU toroidal clips.    |
| `RadianceScene.h`              | Explicit matte diffuse source/visibility and triangle-ray cache gathers.  |
| `SobolDirections.h`            | First 32 Joe–Kuo dimensions; fixed digital shifts; no denoiser.            |
| `RadianceEvaluation.cpp`       | Numerical checks, 480 × 270 captures, motion, finite paths and benchmark. |
| `DistanceEvaluation.slang`     | Six Vulkan bake/clip/probe/cache compute entries.                         |
| `VulkanDistanceEvaluation.cpp` | Native C++ submissions, barriers, parity, cache ablation and readback.    |
| `CMakeLists.txt`               | Standalone targets only; no root editor CMake changes.                   |

The exhibit's `ConsumptionValidation.cpp` exercises native storage ablations: 21,404 clip texels change when
bake samples are cleared; 2,311/4,096 ray step counts change when clip lower distances are cleared. Clearing
only cache RGB blacks all 64 tested positive GI receivers without altering direct lighting; restoring it
restores exact GI. This proves runtime reads, **not** quality, speed or a complete combined radiance path.

The reused implementation is `Frontier/Engine/Rendering/TriangleVisibilitySpace.h`: its original bounds construction,
Float32 packing and independent double queries. New CPU/Slang Float32 query arithmetic stays experimental; no
production source was copied or replaced. Original archives are reused in place, not duplicated here.

```text
Original vehicle facets → production bounds / packed triangle atlas
       ├─ 80 × 40 × 32 local unsigned distance bake (unchanged under rigid motion)
       └─ original triangle intersections
                         ↓
       three 48³ toroidal clips: 0.125 / 0.25 / 0.5 m, 1 m truncation
                         ↓
       conservative empty-space stride → original triangle interval refinement
```

- The vehicle body is not certified watertight. Closed analytic calibration boxes have signed distance;
  the vehicle has **unsigned** distance. Amber in the debug view means proximity, not inside/outside.
- Inside the local bake, the lower interval uses the 1-Lipschitz weighted corner correction and a
  fixture-scale `2e-5 m` Float32 margin. Outside it, the return is distance to the enclosing box: a lower bound,
  **not** exact distance to the vehicle. No arbitrary-scale formal guarantee is claimed.
- Unknown clip coverage, near-zero lower distance and the 96-step limit fall back to the **original** triangle
  ray interval. They are not declared hits or empty space. Raw local/clip penumbra heuristics remain only
  explicit **rejected negative controls**; do not connect them to engine lighting.
- CPU dirty repair covers newly exposed slabs and both old/new truncated vehicle influence regions.
  It still scans all clip cells to find work. GPU clips currently **refill completely** after motion.
- The cache holds reflected, direct diffuse radiance at both sides of actual facets and a 64² ground lattice
  (`0.25 m` spacing). GI is a triangle-ray gather of this piecewise-constant approximation—not voxel cone GI,
  surface cards, DDGI or multibounce cache propagation. The caller must relight after pose/light changes;
  only source-mask compatibility is guarded. No automatic pose/light revision tracking exists.
- Hybrid direct shadows and cached GI are separate diagnostic selections. A completed combined SDF/cone/cache
  radiance path comparable to Unreal has **not** been demonstrated.

## Standalone build

Prerequisites: CMake ≥ 3.20, C++20 compiler and native threads. CPU-only configuration has no Vulkan dependency.
Commands below use a POSIX host; Windows multi-configuration builds place executables under `Release/` and use `.exe`.

```bash
cmake -S Experimental/DistanceClipmap -B _ClaudeScratch/build/DistanceClipmapStandalone \
  -DCMAKE_BUILD_TYPE=Release
cmake --build _ClaudeScratch/build/DistanceClipmapStandalone --config Release --parallel 2
ctest --test-dir _ClaudeScratch/build/DistanceClipmapStandalone -C Release --output-on-failure
```

For the optional Vulkan targets, provide a Vulkan SDK/loader and native `slangc` on the executable search path:

```bash
cmake -S Experimental/DistanceClipmap -B _ClaudeScratch/build/DistanceClipmapStandalone \
  -DCMAKE_BUILD_TYPE=Release -DFRONTIER_DISTANCE_VULKAN=ON \
  -DFRONTIER_DISTANCE_SLANG="$(command -v slangc)"
cmake --build _ClaudeScratch/build/DistanceClipmapStandalone --config Release --parallel 2
ctest --test-dir _ClaudeScratch/build/DistanceClipmapStandalone -C Release --output-on-failure
```

Tested host: GCC 12.2, CMake 3.31.10, Ninja 1.11.1.4, Slang 2026.14.1, Linux x86-64; SwiftShader CPU device.
Windows/MSVC and physical GPUs remain **unrun**. No Linux product binary is delivered. No Actions run is authorised.
With Vulkan enabled, four CTests cover numeric checks, cache sides, consumption and native Vulkan readbacks.
The retained commands for the pinned local software driver, captures and sanitizers are in the exhibit README.

| Command-line mode | Work                                                              |
|-------------------|-------------------------------------------------------------------|
| `numeric`         | Independent distances, visibility, motion and sampling checks.     |
| `capture`         | Static/source captures and the requested number of moving poses.  |
| `all`             | Numerical checks followed by capture.                             |
| `convergence`     | Finite 512-sample GI/path and outward-only cache negative controls.|
| `benchmark`       | Warm-up and five alternating exact/hybrid pairs; float equality.   |

```text
RadianceEvaluation <vehicle archive directory> <output directory> [samples=32] [motion=12] [mode=all]
VulkanDistanceEvaluation <vehicle archive directory> <compiled shader directory> <output directory>
```

`convergence` and `benchmark` have fixed, disclosed budgets; the general sample argument does not change them.
Keep the benchmark alone: do not compile, render another case or run SwiftShader concurrently.

## Transport and GPU boundaries

| Concern             | Current boundary                                                                |
|---------------------|---------------------------------------------------------------------------------|
| Materials           | Two-sided Lambertian diagnostic. No production paint/metal/glass/cloth parity.    |
| Sources             | Vehicle radiant facets, point, uniform solar cap, non-geometric rectangle.        |
| Rectangle           | Explicit next-event source; not camera-visible geometry, an occluder or a texture.|
| Indirect            | One reflected diffuse bounce; finite quadrature remains grainy.                   |
| Path reference      | Three scattering sites; no throughput cutoff/clamp; finite-depth bias remains.    |
| Surface transport   | Geometric facet normals; no unverified smooth-normal Jacobian substitution.       |
| Precision           | Float32 distances/radiance; uint32 material/indices; no Float16/8-bit distance.     |
| GPU allocation      | Eight separate coherent mapped buffers, fences and explicit dependencies.         |
| GPU radiance scope  | Vehicle-facet cache under one point source; no full image transport.               |
| GPU timing          | Submit/fence/readback wall time on a CPU driver, not a hardware shader timer.       |
| Motion              | Absolute-time prescribed rigid poses; no native driving/physics/cloth integration.|
| 60/120 Hz           | Equal final prescribed pose only; not 60/120 FPS or frame-pacing verification.     |

Native tests check layout assertions, guarded dispatch tails and actual runtime data. The separate
`Exhibits/DistanceClipmap/Code/ValidateFootprints.py` compares all six executed SPIR-V streams with Slang reflection,
including the integer material at byte 12, all member offsets, descriptor slots and 128-byte pushes.
Vulkan validation layers, device-local staging, asynchronous retirement, discrete-GPU profiling and a complete
GPU transport/viewport remain outstanding. `-O0` shader compilation is deliberate: `-O2` could not find `spirv-opt`
in this provisioned toolchain. Do not interpret software-driver timings as a user-GPU prediction.

## Sampling attribution

`SobolDirections.h` was generated from the first 32 dimensions of SciPy 1.15.3's Joe–Kuo direction table:
S. Joe and F. Y. Kuo, *Constructing Sobol Sequences with Better Two-Dimensional Projections*,
SIAM Journal on Scientific Computing 30(5), 2635–2654 (2008), search criterion 6.
[Direction-table source](https://web.maths.unsw.edu.au/~fkuo/sobol/).
SciPy's source and its BSD notice are identified in [SobolNotice.txt](SobolNotice.txt).

The table equals `scipy.stats.qmc.Sobol(d=32, scramble=False, bits=32)._sv` in that pinned version.
The prototype applies its own fixed digital shifts, **not** SciPy's LMS scrambling. Samples use the high 24 bits
so Float32 variates remain in `[0,1)`. Different dimensions are used for sources and path bounces; this does not
eliminate finite-quadrature grain or prove convergence for arbitrary integrands.
