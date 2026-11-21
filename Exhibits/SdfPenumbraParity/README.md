# 🧩 `Exhibits/SdfPenumbraParity/` — PROOF 11 penumbra and GI parity oracle

Headless parity oracle for the six PROOF 11 emissive-sphere SDF renderers (point-sample, analytic cone
penumbra, voxel clipmap penumbra, voxel penumbra + cone GI, Sobol spherical cap, 96-spp Monte Carlo path
reference). It re-implements every mode over **one shared penumbra law and one shared occlusion predicate**,
measures each mode against the Monte Carlo reference, and replicates the legacy formulae of
`unassignedinbox/Frontier` branch `arena/ad7fa01c-frontier` to reproduce the mismatch observed on the
delivered proof sheet.

## Run

```sh
g++ -std=c++17 -O2 -march=native -pthread -o /tmp/SdfPenumbraParityCapture \
    Exhibits/SdfPenumbraParity/Code/SdfPenumbraParityCapture.cpp
/tmp/SdfPenumbraParityCapture Exhibits/SdfPenumbraParity          # sheet + report + gates
python3 Exhibits/SdfPenumbraParity/Code/PngRepack.py \
    Exhibits/SdfPenumbraParity/Images/Proof11ParitySheet.png      # level-9 repack, decode-identical
```

Prerequisites: none beyond a C++17 host compiler and two cores (~35 s wall). Tested 2026-11-21 on this
branch, `g++` 12-class host, Linux x86-64. Optional probes: `… probe [passes]`, `… store`, `… taps`.

## Measured parity (this revision)

| Mode | Penumbra width [m] | Umbra min | Tonemapped RMSE vs reference |
|---|---:|---:|---|
| 0 point-sample | 0.000 | 0.000 | 0.0152 (vs direct-only PT) |
| 1 analytic cone | 0.759 | 0.000 | 0.0092 (vs direct-only PT) |
| 2 voxel clipmap | 0.754 | 0.000 | 0.0093 (vs direct-only PT) |
| 3 voxel + cone GI | 0.754 | 0.000 | 0.0338 (vs full PT) |
| 4 Sobol cap (24) | 0.699 | 0.000 | 0.0336 (vs full PT) |
| 5 MC PT ref 96 spp | 0.729 | 0.000 | — |

Legacy replication of the `arena/ad7fa01c-frontier` formulae on the same canonical scene:
analytic **0.684 m** vs voxel **0.588 m** — the same split the previous session's own report printed
(0.684 / 0.583), while the sheet the user received printed 1.148 / 0.733 and the report's PT column claimed
0.724. Three different answers for one physical width: the legacy modes each carry their own penumbra law,
and the sheet footer, the validation transect and the report do not share one measurement.

## Why the delivered PROOF 11 sheet cannot match (audit of `arena/ad7fa01c-frontier`)

| # | Defect | Location (branch `arena/ad7fa01c-frontier`) |
|---|---|---|
| 1 | Per-mode penumbra law: analytic uses `ConeR = max(0.008, t·tanα)` with `smoothstep(-1,1)`, voxel uses `ConeR = max(0.014, t·tanα·0.86)` — the ×0.86 and the differing floors make the voxel width structurally narrower than the analytic one | `Engine/GeometricRaster/DirectLighting/SdfEmissivePenumbraSequence.cpp`, mode 1 vs modes 2/3 march loops |
| 2 | Per-mode march envelopes: start 0.03 vs 0.04 m, step clamp 0.015–0.12 vs 0.020–0.14, soft-min k 0.08 vs 0.10 — three more independent biases between "identical" physics | same file, same loops |
| 3 | A third penumbra law in the tier path: `VoxMid = max(0.052, ConeR·0.62)`, `VoxHlf = max(0.028, ConeR·0.42)` remap, so engine shadows disagree with the showcase too | `EvaluateWorldDirectionalSdfShadow`, voxel branch |
| 4 | Horizon renormalisation bias: below-horizon cap samples are skipped with `continue` yet the divisor stays the full sample count in one path and the horizon-valid count in another | `EvaluateWorldDirectionalSdfShadow` and `EvaluateEmissiveSphereVisibilityMode` |
| 5 | Inconsistent estimator budgets for one quantity: the "96 SPP" reference draws 96 cap samples in the tier path but 64 in the showcase path; mode 4 draws 16 there and 24 in its direct integrator | same file, cap-quadrature sections |
| 6 | Cone-aim "Lift" heuristic tilts the shadow cone toward the receiver normal, breaking reciprocity between modes and between transect directions | `EvaluateEmissiveSphereVisibilityMode`, `ConeDirL` |
| 7 | The Monte Carlo reference clamps every emissive contribution at 3.5, biasing the very oracle the gates compare against | `EvaluateSdfMonteCarloPathTracePixel`, `std::min(3.5f, …)` |
| 8 | Gates that cannot see the defect: validation asserts only `width > 0.45/0.40/0.45 m` and umbra ≤ 0.02/0.03 — no cross-mode agreement check — and the tonemapped RMSE gate reported identical 0.042 for three different renderers | `Exhibits/SdfEmissivePenumbraValidation.cpp`, gate block |
| 9 | Cone-GI taps march with a cascade-dependent contact threshold and no grazing rejection, so taps re-hit the origin plane and print seams and blobs into every GI panel | `Clipmap.EvaluateVoxelConeGi` path, same sequence file |

The corrected harness removes defects 1–7 and 9 by construction: one occlusion predicate (sub-millimetre
sphere march over the casting field), one penumbra law (`ρ = min_t d(t)/(t·tanα)` mapped through the exact
occluded-disc area fraction, so the 5–95 % width equals the geometric disc penumbra span), one stratified
cap quadrature for every sample budget, an unclamped MIS path-tracer reference whose indirect depth
(direct + two bounces) is mirrored exactly by the radiosity store (injection + one exchange pass), and
cone taps with a uniform contact threshold plus front-facing-contact rejection.

## Gates

`Results/ParityReport.txt` records the gate ledger; the capture exits non-zero on any failure:
point width zero; analytic, voxel and cap widths within 10/10/15 % of the reference width; umbra ≤ 0.02;
mode 1/2 panels within 0.020/0.025 tonemapped RMSE of the direct-only reference; mode 3/4 panels within
0.035/0.045 of the full reference. All pass at this revision.

## Limitations and follow-ups

- Lambert-only BSDF: the showcase isolates transport parity (shadows, penumbrae, GI); specular lobes are
  deliberately excluded so every mode shares one BSDF. A mirror/GGX reflection scene is the natural next
  probe for the reflection complaints against `Experimental/DeterministicPathTracer`.
- Voxel radiosity at 0.042/0.090 m cells leaves visible blotches on the back wall in modes 3–4; they sit
  inside the 0.035 RMSE gate but a finer fine-cascade would shrink them.
- The replication covers the PROOF 11 sequence only; the native Vulkan port of the deterministic path
  tracer was not re-derived here, only its HTML/Slang source inspected.
