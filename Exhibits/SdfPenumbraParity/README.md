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

- Lambert-only BSDF: this capture isolates shadow and penumbra transport parity; the specular lobes are
  covered by the companion reflection oracle described below.
- Voxel radiosity at 0.042/0.090 m cells leaves visible blotches on the back wall in modes 3–4; they sit
  inside the 0.035 RMSE gate but a finer fine-cascade would shrink them.
- The replication covers the PROOF 11 sequence only; the native Vulkan port of the deterministic path
  tracer was not re-derived here, only its HTML/Slang source inspected.

============================================================================================================
## 🧩 Reflection parity oracle — `Code/ReflectionParityCapture.cpp`

Second oracle in this exhibit, aimed at the reflection complaints against
`Experimental/DeterministicPathTracer`. It replicates the GGX visible-normal-distribution (VNDF) lobe, the
delta mirror lobe, the recorded ray pdf and the power-heuristic MIS bookkeeping of
`RadianceIntegration.wgsl` / `WavefrontIntegration.wgsl` (branch `arena/ad7fa01c-frontier`, commit `e4966e4`)
and ties them to closed-form radiance transport rather than to another renderer.

### Run

```sh
g++ -std=c++17 -O2 -march=native -pthread -o /tmp/ReflectionParityCapture \
    Exhibits/SdfPenumbraParity/Code/ReflectionParityCapture.cpp
/tmp/ReflectionParityCapture Exhibits/SdfPenumbraParity      # sheet + report + gates (~95 s, 2 cores)
REFL_GATES_ONLY=1 /tmp/ReflectionParityCapture <any dir>     # gates without the panel render
python3 Exhibits/SdfPenumbraParity/Code/PngRepack.py \
    Exhibits/SdfPenumbraParity/Images/ReflectionParitySheet.png
```

### What is verified, and against what

| Gate | Reference | Result at this revision |
|---|---|---|
| The visible-normal draw is Heitz's VNDF | Analytic ring integral of `D(m)·G1(cosθo)·t/cosθo` over `t = ωo·m`, which must equal one by Smith's projected-area identity; KS distance of the sampled `t` cumulative; sampled vs analytic `E[t]` | ring norm 1.00000, KS ≤ 0.0023, `E[t]` equal to 5 decimals at 5 `(cosθo, α)` probes |
| The continuation weight `F·G2/G1` is unbiased | Exact hemispherical integral of `f·cosθi` (the directional albedo) in microfacet space | deviation ≤ 4e-5 relative at every probe |
| Whole-transport energy balance | Uniform emitting enclosure: enclosure radiance 1.000, glossy object `ρ·A(cosθo)`, mirror `ρ`, all closed form | mean relative error 0.12 % (lobe sampling) and 0.27 % (next-event + MIS); mirror exact |
| Recorded ray pdf consistency | The same furnace rendered twice, once by lobe sampling alone and once with next-event estimation balanced by the power heuristic through the recorded pdf | the two estimators agree to 0.14 % on the glossy object |
| Image-level parity | Replica transport at 512 spp against the same transport converged at 2048 spp | tonemapped RMSE 0.0140, mean linear deviation 0.0076; per-material ratios 0.9992–1.0005 |

All five gates pass; `Results/ReflectionParityReport.txt` is the ledger and
`Images/ReflectionParitySheet.png` shows the replica panel, the converged reference, the furnace relative-error
map (black is zero error) and the amplified difference.

### The one identity that matters

The Heitz visible-normal draw has density `p(m) = D(m)·G1(cosθo)·|ωo·m|/cosθo`; because the masking term is
evaluated on the *outgoing* direction it is constant over the draw, and the reflection Jacobian
`|dωi/dm| = 4|ωo·m|` cancels the `|ωo·m|` factor. The sampled direction density is therefore exactly
`D·G1(cosθo)/(4 cosθo)`, which is what `PushReflectionLobe` records, and the matching throughput weight
`f·cosθi/p` collapses to `F·G2/G1`, which is what it ships. Both halves are asserted numerically above.

### Audit outcome (negative result, stated plainly)

The reflection transport of `Experimental/DeterministicPathTracer` — sampler, recorded pdf, continuation
weight, delta mirror lobe and MIS bookkeeping — is **not** the source of the reflection complaint: every one
of the five gates passes against closed-form radiometry. An earlier iteration of this oracle flagged the
recorded pdf as inconsistent with the sampler; that conclusion was wrong and is retracted here — it came from
using the unmasked `D·χ⁺` kernel and a left-handed tangent frame in the oracle's own comparison, both of which
the analytic ring-norm gate now rules out by construction. The reflection complaint must therefore be pursued
in the surrounding pipeline: how roughness is mapped to α, which geometry the reflection rays are traced
against (the SDF/clipmap proxy versus the BVH), and the denoise/upsample path that consumes the result. Those
three are not exercised by this oracle and remain open.
