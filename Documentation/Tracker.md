# Project Tracker

Single progress and violation tracker. Detailed evidence belongs in Exhibits, not competing progress reports.

## EngineUpdate status

| ID  | Finding or task                        | Status      | Next action                            |
|-----|----------------------------------------|-------------|----------------------------------------|
| 001 | Checkout differs from source baseline  | Partial     | UI imported; rest deliberately absent. |
| 002 | Root agent rules used obsolete workflow| Implemented | Keep entry instructions consistent.    |
| 003 | Prototypes live in Documentation       | Open        | Inventory paths and launcher links.    |
| 004 | Inherited Internal tree remains        | Open        | Audit ownership before further ports.  |
| 005 | Old maps/backlog conflict              | Partial     | Historical pointers added; reconcile.  |
| 006 | Windows binary and GPU checks         | Partial     | Cross-built; Windows runtime pending.  |
| 007 | Four skills retained at old paths      | Intentional | Preserve until approved relocation.    |
| 008 | UI foundations and SVGs ported         | CPU checked | Windows integration still unverified.  |
| 009 | Six ImGui patches                     | Checked     | Applied, verified, reverted/reapplied. |
| 010 | Shared activation lifecycle           | CPU checked | Integrate into further scene classes.  |
| 011 | Scene renderer                        | Excluded    | Blank new Render directory by request.|
| 012 | Imported naming/formatting violations | Open        | Audit imported APIs before renaming.   |
| 013 | Source/artwork permissions            | Open        | Owner review before redistribution.   |
| 014 | Control Centre and quick panel        | CPU checked | Windows interaction validation next.  |
| 015 | Open fonts and catalogue              | Checked     | Four families, 30 faces, OFL retained. |
| 016 | Appearance persistence                | Checked     | Reload and invalid-save checks passed.|

## Verification

`Exhibits/ControlCentre/README.md` contains current commands, results, evidence, and limitations.
All six local tests passed in Debug and with address/undefined-behaviour sanitizers.
All 151 SVG symbols remain ready. Native Control Centre images are CPU raster output, not Windows GPU captures.
Windows x64 cross-compilation succeeded using Zig 0.13.0 / Clang 18.1.6 obtained through PyPI.
The unsigned Windows executable is packaged with fonts, SVGs, licences, and integrity metadata under ignored Binaries.
Native MSVC and Windows runtime/GPU execution are still unavailable. No Linux product binary is delivered.
No GitHub Actions are authorised.

## Known rule findings

The port preserves existing APIs for this bounded batch; it is not a clean naming/formatting certification.
Examples requiring repair: `VectorGlyphRecord`, short local names, comment vocabulary,
namespace brace layout, header banners, and non-approved decorative glyphs in inherited source comments.
The earlier official Windows example is now GLFW-hosted; its original display-adapter provenance remains explicit.
The four mandatory skill documents have not been weakened or edited to waive these findings.

## Scope history

The earlier documentation-only validation script was removed when that phase was clarified.
Subsequent user instructions authorise source porting, local validation code, proof images, and commit/push.
No full baseline replacement or inherited C++ relocation has occurred.

The selected theme/control configuration APIs now use `Configure...` rather than the banned `Assign...` verbs.
The new appearance files use Allman braces, flat namespace indentation, and descriptive file headers.

## Drawer and content correction

- Replaced the floating settings window with the reference top-edge trapezoidal drawer and inherited spring motion.
- Actual upward mouse swipe closes the sheet; added flick, axis lock, resize, focus-loss, and scaled-geometry tests.
- Renamed ContentDirectory and moved shared content into EngineContent/Icons and EngineContent/FontArchives.
- Native discovery reads metadata from TOML; Unicode file loading and corrupt-face rejection are exercised.
- GLFW 3.4 is pinned under ExternalPackages and used by the Windows host. toml++ remains the C++ format dependency.
- CLAUDE.md records Vulkan/Slang primacy, GLFW window ownership, content conventions, and TOML runtime formats.
- Windows runtime/GPU checks remain pending; no Actions are authorised.

#### Native Float32 vector surface map recovery (2026-10-19)

- Pattern scope remains approximately 68%; Stamp and full Pattern parity remain deferred/open.
- Added `VectorSurfaceCompute` with a typed `rgba32f` Vulkan storage image; the runtime derives format from SPIR-V,
  requires storage/sampling/linear-filter/transfer capabilities, and refuses unsupported devices rather than downgrading.
  Existing vector coverage and selection remain RGBA8.
- Compiles ordered layer/channel contributions from editable source, including visibility and layer masks. Separate
  RGBA32F maps cover colour, height, normal, roughness, metalness, opacity and occlusion. Contribution alpha is a
  separate mask; disabling a channel produces a neutral map and zero contribution. Layer-specific golden-thread
  metalness remains isolated from fabric metalness.
- Shared PFM encoding preserves IEEE Float32 bits, emits little-endian bottom-first `PF`/`Pf`, and does not clamp,
  gamma-transform or renormalize samples. The ZIP contains 14 actual GPU-readback fixture files, 32x32 each; it is
  not a document export. `Exhibits/TextureStudio/NativeSurfaceEvidence.html` presents the actual capture and GIF library.
- Seven real Vulkan channel dispatch/readback assertions pass strict and ASan/UBSan builds on SwiftShader. A cache-path
  regression now verifies 512x512 retired-slot submission and reuse of equivalent programs; it caught and fixed a reset
  that discarded the selected surface program before dispatch. The regression verifies authored gold/fabric separation,
  default neutral normals, finite Float32 samples, masks,
  PFM byte layout and strict/sanitized byte identity. Shader compiles with Slang WASM 2026.19 and reflects 24-byte
  surface push constants plus `Rgba32f` image storage.
- Native Texture Workspace now exposes the Pattern editor with persistent TOML, Vulkan coverage/selection, and a distinct
  dockspace. `PatternWorkspaceValidation` passes 606 checks on SwiftShader; its capture/result artifact is linked in the
  native evidence HTML. This runner did not execute a Windows desktop session.
- Float32-to-PBR bridge progress: 95%. `VectorSurfaceMaterialBridge` compiles five channels from a Pattern document,
  records their Float32 dispatches and image-to-host readbacks in one caller-owned submission, and exposes maps only after the
  caller's completion serial retires. No queue wait is inserted. Equivalent documents preserve the map cache; changed channel
  programs reconfigure and regenerate it. Five pyramids upload as RGBA32F authoring textures to the existing PBR shader.
- The native Texture Workspace host now routes its 512x512 Pattern document through that bridge on the shared Vulkan
  submission. Retired maps replace the selected material's live-preview channels; the material view shows the result without
  persisting source changes. The Windows x64 host cross-links, and packaging verifies all 13 surface/vector SPIR-V entries;
  native Windows GPU execution/capture remains a release gate.
- `MaterialRasterizationValidation` passes 224 checks on SwiftShader using 512x512 Float32 authoring maps and 128x128 PBR
  evidence captures. It exercises a single-submit five-map transaction, rejects premature retrieval, verifies
  unchanged/changed document caching, uploads actual GPU output, and compares the PBR centre capture with an independent
  scattering reference. The integrated bridge tests separate fabric and gold-thread layers: changing fabric Roughness to
  0.61 leaves gold Roughness at 0.18 and gold Metalness at 1.0 in the Float32 maps; reducing fabric SurfaceRelief from
  0.8 to 0.35 changes its derived tangent normals and PBR capture while keeping the gold-thread normal response unchanged.
  The three-frame C++ Vulkan GIF and provenance were regenerated from this 512x512-map run and remain embedded in
  `Exhibits/TextureStudio/NativeSurfaceEvidence.html`.
- `MaterialAtlasValidation` confirms changed Float32 authoring maps invalidate and repaint the same PBR preview selection,
  and that stale preview readiness is hidden until the replacement submission retires.
- Native Pattern channel enable toggles and strength controls are active for selected shapes; multi-selection applies each
  edit to every selected shape, and the document history preserves channel toggle Undo/Redo. Strength accepts 0–1 for
  ordinary channels and 0–4 for Normal; stitch/weave Height and Normal strengths cannot be reduced to zero. `PatternWorkspaceValidation`
  passes 626 checks, including selected-shape roughness-strength and surface-relief edits that leave the unselected layer unchanged
  and reach compiled GPU contributions. `VectorSurfaceValidation` confirms a GPU roughness disable removes only the fabric contribution
  while preserving the independent golden-thread roughness response.
- Native layers now persist a `surface_structure` classification (`freeform`, `stitch`, or `weave`). Selecting stitch/weave
  in the Pattern inspector enables and locks both Height and Normal channel toggles; document validation rejects missing,
  disabled, or zero-strength required contributions. TOML round-trip and invalid-weave rejection are covered in the native
  workspace validation, which passes on SwiftShader. This is explicit layer metadata and enforcement; automatic stitch/weave
  geometry generation and Windows interactive capture remain outside this phase.
- Native TOML now maps the web textile keys directly: `stitch_role` values `holes`, `thread`, and `highlight` resolve to
  NeedleEntry, StitchThread, and UpperThreadPass; `weave_role = "yarn"` resolves to WeaveYarn. The Pattern inspector can
  author these classifications, and validation enforces their parent stitch/weave structure and required channels. TOML
  compatibility exercises all four mappings; full Pattern JSON geometry import is still open.
- `VectorSurfaceValidation` runs the weave-classified fabric through all seven actual RGBA32F Vulkan channel dispatches,
  rejects disabled Height before compilation, verifies a per-layer Roughness strength of 0.23, and scales fabric relief by
  0.5 in GPU readback while preserving separate gold-thread height and normal response. `PatternWorkspaceValidation` confirms the inspector edit reaches the compiled
  contribution program. Both SwiftShader CTests pass; native Windows interactive preview capture remains open.
- Native evidence gallery now includes a three-frame C++ Vulkan PBR GIF: baseline, actual GPU-authored Float32 fabric/gold
  maps, and revised fabric relief/roughness with the gold response isolated. The linked JSON records source, executable and frame hashes; the fixture is SwiftShader, not a
  Windows desktop session.
- Still open: execute and capture the interactive Pattern 1:1-to-material-preview workflow on the native Windows host,
  including a per-shape channel edit; convert web Pattern JSON geometry and construction into native vector instructions;
  calibrate SurfaceRelief against measured height units and profile performance.
  Stamp remains deferred. The persistent/scene-level Apply action stays disabled until integrated native GPU submission and
  capture pass.
  GIF display is 8-bit evidence only; numerical Float32 checks are authoritative. No pixel stream is used.
- Reproduce: install pinned UI dependencies via `python Automation/PrepareUI.py`; compile the surface shader with
  `node Automation/CompileVectorSurface.mjs <Slang-WASM-JS> <shader-directory>`; run
  `python Exhibits/TextureStudio/Code/VerifyVectorSurface.py --driver <Vulkan-driver> --shader <VectorSurfaceCompute.spv> --destination <scratch>`.

#### Session rebuild on `arena/db2f9953-frontier` (2026-10-20)

- Restored pinned UI deps + fonts in a fresh sandbox, configured with `-DFRONTIER_HOST_VERIFICATION=ON`,
  built all host targets (GCC 12.2, Debug) and ran the full CPU suite: **21/21 CTests passed** (~70 s).
- Repaired four stale validation harnesses (no production-code changes): font inventory 4/30 → 5/35
  (`ControlCentreValidation`), per-domain icon rasterization (`InterfaceValidation`, Texture/Fluid symbols are
  denied to the Editor domain by design), canvas hover before preview F/arrow keys plus a non-vacuous F check
  (`MaterialPreviewConfigurationValidation`), and the full `###`-suffixed dockspace window name plus a null guard
  (`DockingValidation`, previously a null-`ImGuiWindow` SEGV). Docking also passes under ASan/UBSan.
- New `Exhibits/index.html` hub embeds the recorded HTML/native captures, per-workspace port status vs the Alloy
  reference (`Experimental/TextureStudio`), and this rebuild log; served from `Exhibits/` for preview.
- Still blocked in sandbox: SwiftShader/Vulkan readbacks (no `slangc`/driver), Windows link/run, Alloy `npm`
  verification. Carried UI defects (Project Browser 1:1, zoom FPS, layer cards, toggles, dropdown reuse,
  slider/ramp/gradient editors, rotation math, drag latency) remain queued after this rebuild.


## Windows preview 39483329514 (2026-10-20, branch arena/db2f9953-frontier)
- Commits: ba9b105 (settle-gated Pattern Float32 bridge, preview clip rects, dark-slate default stroke) + 42c9e54 (CI trigger for this branch).
- CI run 39483329514: Windows + Publish jobs success; Release unsigned preview at frontier-windows-39483329514.
- Linux host verification on ba9b105: full ctest 21/21 green; VectorSelectionValidation rotation/resize 1431/1431 pass (CPU).
- Confirmed open shader gap: PreviewPbrSurface samples albedo only; height/normal have no bindings (next round).

## Windows preview round 2 (branch arena/db2f9953-frontier, commits ba9b105..2fd6ea4)
- ba9b105: settle-gated Pattern Float32 bridge (drag perf), preview clip rects, dark-slate default stroke.
- 6b13015: parked material drafts across selection, full-bleed cover-fit preview + title scrim, exposure card, auto-size layer cards.
- 2fd6ea4: draped cloth preview shape, six-seamless-preset Pattern gallery, redesigned close dialogs.
- Linux host verification: full ctest 22/22 green (incl. 638 pattern-preset checks, cloth fold assertions).

## Windows preview round 3 (branch arena/db2f9953-frontier, commit e8755ee)
- Gesture-gated Pattern bridge (no regen while a gesture/pen stroke is in flight).
- Single-axis orbit rewrite (yaw about world-up, sway-tested old-fail/new-pass).
- Styled tooltip cards everywhere in Material; Open Library dialog restyled.
- TOML-backed preset gallery (six shipped .vector.toml files, built-in fallback).
- Apply-to-material gating with persistent snapshot per material.
- Linux host verification: full ctest 22/22 green (669 preset checks).

## Windows preview round 4, batch 1 (branch arena/db2f9953-frontier, unreleased)
- Pattern gallery preset thumbnails: CPU-drawn ImDrawList vector previews replaying each preset's
  instructions with VectorCoverage.slang corner/rotation conventions; click-to-open + hover tooltip.
- Project Browser Details rail: full projectspace metadata (identity/template/format/version, content
  roots, level/catalogue/pin counts, startup level, workspace theme/accent/font/scale) + Open button.
- Editor activation: opening a project launches EditorWorkspace (proven WindowsUI pattern ported into
  WindowsFrontier) with a top bar (back, project name/stats, Control centre / Theme / Settings buttons
  driving the ControlCentre drawer), a Viewport summary tab, and return-to-browser teardown.
- Materials: procedural detail textures (Automation/GenerateSurfaceDetailTextures.py) wired into five
  presets — tour/practice golf-ball dimple normal+ORM (TextureMask 6, 4x repeat), three solar-module
  cell/busbar albedo+ORM+normal sets (TextureMask 7, 2x repeat, shared ORM/normal).
- Correction to the round-2 note: the material preview already renders through MaterialSurface with full
  texture bindings (normal/height included) whenever a material residence exists; PreviewPbrSurface is
  only the albedo-only fallback. Golf/solar relief was a data gap, not a shader gap — no shader port needed.
- Height remains pattern-authored (AuthoringMaps[2] via Apply-to-material); .material files have no height slot.
- Linux host verification: full ctest 22/22 green (Docking close-all updated for the Viewport tab;
  MaterialLibraryValidation now compiles all five texture-wired presets incl. PNG decode).
- Still open: rotation-axis mapping vs user expectation, asset-browser HTML 1:1 (HTML file not in repo),
  remaining surface-detail ports (orange-peel, scratches, weaves need shader/UBO targets), zoom-FPS check.

## Windows preview round 4, batch 2: orbit fix (branch arena/db2f9953-frontier, unreleased)
- User report: yaw spins fine, but vertical drags roll "as if on Z" and the pivot feels off-centre.
- Root cause: orbit composed yaw-after-pitch (Ry*Rx), so pitch increments rotated about the yawed local
  X axis (a view-axis roll at 90 yaw) and yaw leaned the object up-axis sideways by sin(yaw)*sin(pitch).
- Fix: LookAt-style orbit (Blender/three.js convention) — yaw about screen-vertical world-up through the
  pivot, pitch about the fixed screen-right axis. Pure-yaw and pure-pitch poses are bit-identical to
  before, so the approved feels are untouched; only combined yaw+pitch changes.
- Correction to the round-3 sway test: zero-ellipse turntable yaw is incompatible with a screen-vertical
  object up-axis (proven: fixed front height + vertical up forces no yaw). Replaced with three
  old-fail/new-pass assertions: up-axis never leans, pitched tips never roll, pitched yaw traces the
  standard screen ellipse; plus a pivot-exactness guard across all five shapes.
- Linux host verification: full ctest 22/22 green; old matrix fails the new lean/roll/ellipse assertions.

## Windows preview round 4, batch 3: Alloy preset parity (branch arena/db2f9953-frontier, unreleased)
- User rejection: the six native-invented presets (and their gallery) did not match the Alloy Studio
  HTML. "Alloy Studio" is the web TextureStudio itself (schema alloy.pattern.v1); source of truth is
  Experimental/TextureStudio/src (PatternEditor.jsx gallery, patternDocument.js catalog of 103 families).
- Converter upgrades (Automation/ConvertWebPattern.mjs): per-copy instructions stay lean when they fit
  the 128-instruction budget, else tile-wrapped copies concatenate into one tile-space contour range
  (identical union under the same fill rule); minimal adjacent same-paint merging rescues the 65-layer
  Graduated lattice; half-drop/single-axis tiling accepted as documented straight-XY equivalents (baked
  tile pixel-identical, neighbour arrangement differs); miter/bevel joins and butt/square caps substitute
  round; anisotropic strokes use the larger axis; non-sized flowers import. All 178 family x palette
  variants convert (was 143 OK / 35 fail); deviations attach to each conversion for the sidecar.
- GPU/host budget raise: cubic segments 4,000 -> 32,768 (128 KB -> 1 MB storage buffer; shader needs no
  change since segments are an indexed buffer), vector source 600 KB -> 4 MB (codec, gallery loader,
  workspace save/load, import validation). Instruction cap stays 128 (shader stack array). Catalog peak
  is 18,954 segments (weaves); 25,600 is the editing-API maximum, so the 32,768 boundary is pinned by a
  struct-level coverage-validation test instead of the join fixture.
- Batch export (Automation/ExportPatternLibrary.mjs): 103 families / 178 palette TOMLs (37 MB) +
  Library.toml sidecar (families, 8 collection groups, 4 palettes, per-palette files, 24 deviation
  notes) under EngineContent/PatternArchives/TextureStudio/starters/. Serialized floats round to 7
  decimals (float32-parse within 1 ulp, invisible). The six invented TOMLs are deleted; the C++ fallback
  builders remain only for a missing preset directory.
- Gallery ported 1:1 from PatternEditor.jsx: kicker, two collection shortcuts, collection dropdown,
  search (name/group/description/study), conditional print-palette dropdown, heritage note, result
  count, two-column cards (76px cover-fit previews, wrapped names, description tooltips, selected
  ring), 24/page paging, trailing notes. Decoding is lazy per page (96-entry FIFO cache). Two
  documented deviations: DM Sans has no arrow glyphs, so paging/shortcut arrows render as ASCII
  < >; "Generate a layout" generator section is deferred (self-contained follow-up, not presets).
- Card tessellation: paint-order layer walk resolving Over/boolean composition; cubics flatten,
  RDP-simplify (closed-loop farthest-point split) and ear-clip to triangles once per preset; strokes
  replay as single polylines; fills submit batched with off-thumb culling. Fixed two real bugs found
  by headless harnesses: RDP collapsed closed loops (degenerate chord), and 16-bit ImDrawIdx overflowed
  past 64K verts per window draw list — 32-bit indices are now a PUBLIC compile definition on
  FrontierImGui (tracked; the vendored imconfig.h is untouched because CI recovers imgui fresh).
- Validation: PatternLibraryPresetValidation is Library.toml-driven (pins 103/178, decodes and
  coverage-validates every file, 1954 checks); new PatternLibraryGalleryValidation pins collection
  counts (30/16/10/10/10/10/10/7) and search counts, tessellates all 178 variants into finite geometry
  (830K triangles); headless card-render harness draws all 103 cards with draw-list invariants intact.
- Linux host verification: full ctest 23/23 green; converter node --test 7/7; ASan/UBSan clean on
  decode, tessellation and card rendering.
- Still open: rotation-axis follow-up already shipped in batch 2; asset-browser HTML 1:1 (HTML file
  still not in repo); "Generate a layout" section; remaining surface-detail ports; zoom-FPS check.

## Slate layer-stack port (2026-10-21, Slate arena/4006465a-slate cb8dcf0 onto db2f9953@34537e1)

- HTML first: `Experimental/TextureStudio` gains the Alloy material workspace (MaterialPanel PBR layer
  stack with per-channel sources, MaterialSpecification authoring document, FieldSpecification coded
  generators, FieldProjection Float32 atlas, editable camouflage palettes); catalogue 127 -> 131.
  Verified by production build and 7/7 Node model checks; Playwright specs ported but not run
  (browser download blocked in the sandbox).
- C++ port: coded fields in MaterialProceduralBaking (double-precision JS parity, 8 new ops on
  Albedo/Normal, palette text params), `Engine/ContentInterchange/MaterialAuthoring` document model with
  strict normalize, `[Authoring]` TOML round trip in SurfaceMaterial, pool text edits
  (ConfigureProceduralText), panel palette colour editors, deterministic catalogue export of the four
  camouflage presets with coded Albedo channels. Evidence: `Exhibits/TextureStudio/Results/LayerStackPort/`.
- Linux host verification: full ctest 26/26 green (new MaterialAuthoringValidation pins JS goldens,
  normalize rejection, link/designer projection, TOML stability, catalogue camouflage bakes).
- Boundaries still open: coded fields bake no ORM channel; woodland fabric weave relief is not yet
  composited under the camouflage field; Float32 field atlas stays HTML-only (native path is the CPU
  baker); panel renders strata rather than the full HTML authoring sheet; Windows runtime unverified.

## Inherited tree reclamation (2026-10-22, branch arena/1b8b280c-frontier)

- Reclaimed the inherited engine code trees from this branch (`Internal/`, `Executables/`,
  `Applications/`, `memory/`, `PaintingSurface.bat`; 736 files). Complete trees remain on `master`
  and in history; nothing in the current build referenced them (verified by configuration census
  and a full host build + test run).
- Retained the inherited design documents under `Documentation/Plans/References/InheritedEngine/`
  (170 files: `Prototypes/`, `Research/`, root-level plan/reference notes, and the notes that lived
  inside the reclaimed trees). `Documentation/FolderStructure.md` records the review outcome.

## Orbit staging and LED radiance correction (2026-10-22, branch arena/158c63c8-frontier)

- Specimen-group pitch (0.18 rad, baked into ball+pedestal) removed: pedestal lathe is level
  (rim height spread .34 -> ring-exact), Pivot/Radius re-measured. Preview key light, sky up and
  studio softboxes are world-locked through the orbit (identity at the default pose).
- LED radiance sampled through the first stratum's UV transform instead of raw coordinates.
- MaterialPreviewConfigurationValidation pins ring level + rigid light/up carry; shaders compile
  via the pinned Slang toolchain; host suite 26/26.

## Environment archives and layered inspector (2026-10-22, branch arena/7aa23edd-frontier)

- Baked five neutral equirect studio environments (`EnvironmentBake`) into
  `EngineContent/EnvironmentArchives/`; the shader samples them as a world-frame texture array
  (set 0 binding 3), replacing the tinted analytic presets and the analytic softbox integral.
  Key light + strength are derived per archive at scan time; equirect PNG drops import by rescan.
- Viewport: environment dropdown is now a card with CPU sphere previews, Exposure and Light
  intensity; the standalone exposure card is removed.
- Inspector: recipe controls categorized per stratum under LAYER headers (groups preserved as
  cards), uncovered stratum scalars editable per layer (incl. Thickness), profile-less generic
  editors on all layers. Host suite 26/26 (645,546 preview-config checks incl. card gestures);
  Windows GPU confirmation pending the user's hardware test.
- Still deferred: sand op binding, thin-film, glass depth, camouflage/ballistic underlays.

## Environment-switch freeze correction (2026-10-22, branch arena/71dc0cca-frontier)

- Windows test log: `PreviewConfiguration[2]` (now the environment layer) was still pinned to
  zero by `ValidateMaterialScattering`, so every non-default environment threw inside
  `ConfigurePreview`/`ConfigureSelection` and the viewport froze on its last good frame.
  Contract now bounds the layer slot; pinned by CPU checks (645,550).
- Light intensity missed the smoothed-camera discrete copy (applied only on settle snap); fixed.
- Environment sampling at mip 2 (firefly stipple), strength target 0.3 -> 0.2, key weight
  0.4 -> 0.32 (tonemap flooding), catalogue cap 24 -> 8 (pyramid layer contract). Suite 26/26.

## Fuzz/sheen BRDF and inspector card layout (2026-10-22, branch arena/b36a0fa5-frontier)

- Fabrics (velvet, wool, denim, cotton, silk, satin, …) and the leather/paper/foliage recipes that
  already carried `sheen`/`sheenRoughness`/`sheenColor` sliders were missing the grazing-angle rim
  lobe the HTML reference renders; native output looked flat. Added a Charlie-distribution +
  Ashikhmin-visibility sheen term (glTF `KHR_materials_sheen`-style), identical math in CPU
  `ScatteringSequence.h` and GPU `ScatteringEvaluation.slang`, additive on the opaque stratum only.
- ABI: `ScatteringStratum` gained `Sheen`/`SheenFinish` float4s (64 -> 96 bytes); cascaded through
  `PreviewScattering` (672 -> 928) and `MaterialScattering` (1504 -> 1760), every offset re-asserted
  in `SurfaceMaterial.h` and the GPU-reflection parity guard in `Automation/CompileSurfaceShaders.mjs`
  (this guard caught a stale hardcoded size before it could ship, the exact failure mode PR #7's
  dormant-contract freeze taught us to watch for).
- `SheenColor`/`SheenIntensity`/`SheenRoughness` are now live TOML keys, wired end to end: the colour
  swatch and the recipe sliders both write through `MaterialLibrary::ConfigureStratumColour` /
  `ConfigureStratumCoefficient`. The "Sheen colour" swatch is data-driven — any recipe profile that
  exposes a `sheen` control gets it, not a hardcoded per-material list.
  37 shipped `.material` files seeded with their HTML-authored default sheen values (fabrics, leather,
  paper, foliage) so the lobe is visible without hand-tuning. `MaterialLibraryValidation` gained a
  coefficient/colour/compile round-trip check for the new fields.
- Inspector cards: added an 8*Scale inset so cards no longer sit flush against the panel edge and
  scrollbar; fixed the per-card row count (profiled Finish cards no longer pad in 3 phantom rows,
  unprofiled Finish cards now count their real 6 generic sliders) so a card's background no longer
  under/overshoots its own controls; every card (not just the first per layer) now carries a small
  "LAYER N" tag so grouping stays legible while scrolling past several cards in the same layer.
  Host suite 26/26.
- Deferred, unchanged: sand op binding, thin-film, glass transmission depth, camouflage/ballistic
  coded-field underlays.

## Save-dialog modal chrome (2026-10-22, branch arena/8c806870-frontier)

- The "Unsaved material", "Open material library" and "Material destination" (create/duplicate)
  dialogs in TextureWorkspace, plus Pattern's "Unsaved pattern" close prompt, inherited the docked
  workspace's zeroed `WindowRounding`/`WindowPadding` and rendered as flush, square-cornered boxes
  with text crowding the edges.
- Added a local `MaterialModalScope`/`PatternModalScope` RAII helper per panel (mirrors the existing
  `MaterialTooltipScope` and the Editor's `ConfirmationDialogue` convention already used elsewhere)
  that scopes 20x18 padding, 10px rounding and a faint 1px border to just these popups, restored
  before the surrounding workspace's zeroed style resumes. No layout/behaviour change otherwise.
  Host suite 26/26.

## Fork merge: c7egoist/Frontier arena/ec6ca01d-frontier (2026-10-23, branch arena/c8d99312-frontier)

- Merged `c7egoist/Frontier@arena/ec6ca01d-frontier` as-is, same handling as the earlier
  `c7egoist`/other-session fork merge (PR #8): its unique commits beyond the shared `5a8c1b8`
  ancestor are a standalone-engine GGX material response port and an atmospheric-environment MIS
  integration, plus the `Exhibits/CompleteRenderer`, `EnvironmentPipeline`, `IlluminationChain` and
  `IndirectIllumination` reference exhibits and the `Frontier/Engine/Rendering/*` portable renderer
  tree they build on. Each exhibit carries its own standalone `CMakeLists.txt` and is not wired into
  the root build (same as the prior fork's `Frontier/`, `VisualProof/`, `Docs/` overlay) — merge was
  clean with no conflicts, since this branch's commits since the shared ancestor don't touch the
  files this session's sheen/inspector/dialog work changed.
- Verified: full root build + `ctest` 26/26, confirming the merge is inert for the shipped build.

## Pattern layer stack visual parity + selection-bounds regression coverage (2026-10-23, branch arena/649fea90-frontier)

- HTML Pattern Studio's layer rows (`PatternEditor.jsx`) now reuse the Texture workspace's
  `tp-layer-row` chrome verbatim: a drag handle, a per-layer preview thumbnail (new
  `PatternLayerThumbnail.jsx`, rendering the layer's own vector contour sized to just that shape's
  own bounds via `patternSizedPath`, falling back to the shape-kind glyph for kinds with no
  contour), the name/kind/opacity meta line, then eye/lock icon buttons — same classNames, same
  look, as requested, instead of the retired bespoke `se-layer-row` styling. Retired the now-dead
  `se-layer-row`/`se-layer-name`/`se-layer-toggle` CSS across `shapeEditor.css`, `studioTheme.css`
  and `artworkAuthoring.css`; added narrow overrides so the legacy `.pe-layers button > span` 12px
  swatch sizing doesn't clobber the ported thumbnail/kind-icon/name slots.
- Investigated the reported native (C++) Pattern Studio selection-hitbox issue ("highlight spans the
  whole canvas instead of hugging the selected shape"). Traced `QueryVectorSelectionExtent` /
  `QueryVectorAuthoringSelectionBounds` (`VectorAuthoringSelectionEditing.cpp`) and the pen tool's
  `EncodePath` (`CubicPathEditing.cpp`): both already compute tight, shape-local bounds for a single
  selected primitive or hand-drawn/library cubic-contour path in every scenario exercised, including
  a tile-normalized library-path simulation. Found and fixed a real gap instead: `VectorSelectionValidation.cpp`
  (1431+ assertions covering this exact selection-bounds/resize/reorder surface) existed but was
  never wired into CMake/ctest, so it never ran in CI. Added it as a real ctest target and added two
  new regression checks pinning a hand-drawn motif and a tile-normalized imported path to their own
  tight bounds, not the full 512 canvas. Host suite 27/27 (up from 26). If the on-canvas symptom
  still reproduces after this, it is most likely the multi-select case (selecting an entire
  array-placed group, whose true combined bounds legitimately span the tile) rather than a bounds
  bug — flagged for the user to confirm against the next preview.
- Ported the same layer-row preview into the native Pattern panel. `ConstructLayers()`'s row no
  longer draws a static placeholder swatch: it now renders that layer's own shape, cropped to its
  own tight extent (new `EncodePatternLayerThumbnailSvg`/`RasterizePatternLayerThumbnail` in
  `PatternThumbnailRaster.h/.cpp`, sharing the existing per-instruction SVG emitter with the gallery
  encoder so the two never drift). A second, smaller GPU atlas (`PatternWorkspacePanel::LayerAtlasTile`
  = 64px, 12×12 grid) carries every row's thumbnail for the open document and rebakes only when the
  document's edit revision moves; `WindowsTextureStudio.cpp` wires it up exactly like the existing
  library gallery atlas (`PatternLayerAtlas`/`PatternLayerAtlasDescriptor`, stage/upload/confirm/
  finalize, `Pattern->QueryLayerThumbnailAtlas`). Before the atlas is baked (or if no host wires it,
  e.g. in a headless/test build) the row falls back to a CPU vector replay of just that one layer via
  the existing `TessellatePresetDocument` tessellator, and only falls back further to a bare outline
  if that layer has no renderable geometry at all. `PatternThumbnailAtlasValidation` gained two new
  headless test blocks (single-layer thumbnail crop + the open-document layer atlas revision/bake
  contract) — 58 checks, up from 45, no new exhibit/CMake target needed. Host suite stays 27/27.
  The Vulkan wiring in
  `WindowsTextureStudio.cpp` is Windows-only and cannot compile-check in this Linux sandbox (same
  constraint as the rest of that file); it is a line-for-line structural mirror of the already-shipped
  `PatternAtlas` plumbing, reviewed by hand, and will be confirmed by the next Windows CI build.
- Pattern library motifs: the composable procedural modifier stack the user asked for (their own
  worked example — Diamond weave as one ring array/inset, mirrored top/bottom, then aligned to the
  tile edges) now exists in both HTML and C++, proven against the "Diamond weave"/"Diamond Weave"
  starter in each:
  - HTML: new `Experimental/TextureStudio/src/patternProcedural.js` exports three pure, reusable
    operations over a plain layer array — `arrayInset(layerFactory, kind, base, {count, sizeStep,
    stepX, stepY, colors, roles})` (repeats/shrinks one base layer, optionally role-tagging each
    copy), `mirrorMotif(motif, {axis, through})` (reflects x/y about a line, negating rotation) and
    `alignToEdges(motif, anchors)` (translates a motif cluster to tile-relative anchors, optionally
    recolouring by the `role` tag an anchor's `recolor` map names). `patternDocument.js`'s "Diamond
    weave" starter branch now calls these three operations instead of three nested hand-written
    loops; verified bit-for-bit identical output against the old flat implementation (same 16 diamond
    layers, same coordinates/colours, via a direct comparison script) before and after the rewrite.
    `validatePattern()`'s field-by-field layer rebuild already drops unknown properties, so the
    generation-only `role`/`proceduralRole` tag never reaches the saved/exported document.
  - C++: three analogous free functions added to `Engine/ContentInterchange/PatternLibraryPresets.h`
    — `ConstructInsetMotif` (runs the existing, already-shipped `GenerateVectorAuthoringArray` engine
    against a throwaway scratch document and harvests the instructions as a plain list, so Array/Inset
    reuses one tested placement engine rather than a new shrink loop), `MirrorVectorAuthoringMotif`
    (reflects a plain instruction list about an axis) and `AlignVectorAuthoringMotifToEdges`
    (translates copies to anchors, recolouring instructions that match a sentinel accent colour). A
    new 7th library preset, "Diamond Weave" (`ConstructPatternLibraryPreset(6)`,
    `QueryPatternLibraryPresetCount()` now 7), is built from exactly these three calls: one 4-ring
    inset array (242/189/136/83, matching the HTML sizes), mirrored across the tile's vertical
    midline, then aligned to the left/right edge quarters with two different accent colours.
    `PatternLibraryPresetValidation` gained a dedicated structural check (ring count, inset sizes,
    per-edge accent count) plus the count-change assertion bump to 7 — now 2065 checks, all existing
    index-0..5 preset checks untouched. Full build + `ctest` → 27/27 PASSED.
  - Still open: this pattern (one base shape + array/inset + mirror + align-to-edge) has only been
    applied to the Diamond weave/Diamond Weave starter so far, as the proof of the approach — the rest
    of the ~7,874-line, 9-module HTML pattern library and the remaining C++ presets have not yet been
    converted. Scoped but not started; large enough to warrant explicit user sign-off before an
    unattended full-library pass (risk of silently regressing 100+ shipped pattern designs without
    per-pattern visual verification).

## GPU mesh baking (Vulkan compute, GTX + RTX) (2026-10-26, branch arena/4014756b-frontier)

- The Baking Workspace's 27 mesh maps (previously CPU-only in `Engine/ContentInterchange/BakeMesh.cpp`)
  now have a GPU route behind an inspector "Bake device" choice (CPU default; GPU appears when the
  host supplies a device name and also unlocks 2048/4096 resolutions). One Vulkan compute path serves
  GTX and RTX — GTX has no RT cores/`VK_KHR_ray_query`, and the bake needs closest-point bevel queries
  that are compute work anyway; CUDA/OptiX and an RTX ray-query fast path were considered and deferred.
- New `Engine/ContentInterchange/BakeField.h/.cpp` flattens a bake request (std430 triangle/BVH slots,
  pre-interpolated per-texel surfaces, a field-need mask) and re-implements the per-texel evaluation
  statement-for-statement as the CPU reference twin. `BakeFieldValidation` compares it against
  `RunMeshBake` over all 27 maps × 4 scenarios (Teapot/Cube 256², two-part DirectX/dust 128²,
  query-free 128²): **bit-exact — 100% identical texels, 0 LSB worst channel difference**, with
  guards (≤2 LSB, ≥99.99% within 1) for cross-platform float noise. Evidence retained in
  `Exhibits/TextureStudio/Results/GpuBakeField/` (checks JSON + Teapot legacy/field/difference
  PNGs; difference frames are black). The field route is also faster on CPU (Teapot 256² ≈2.9s → ≈2.0s)
  thanks to index-order bbox UV coverage instead of a per-texel full-triangle scan.
- `Engine/Render/Shader/BakeFieldEvaluation.slang` mirrors the twin in compute (64-wide workgroups,
  manual normalize, identical tolerances/traversal order); compiled to `BakeFieldCompute.spv` via
  slangc or the pinned Slang WASM route (`Automation/CompileBakeField.mjs`, which asserts the
  48-byte push-constant ABI from reflection) and installed beside the other surface archives
  (`Automation/BakeRasterization.cmake`). `Engine/Render/BakeRasterization.h/.cpp` is the
  borrowed-device host in the `VectorCoverageRasterization` idiom: staged device-local BVH,
  262,144-texel banded submission (TDR budget), serial field harvest, and refusal-as-data — any
  failure becomes a `BakeGpuOutcome` the panel turns into a same-settings CPU re-bake, named in the
  completion line. The panel (`UI/TextureStudio/BakingWorkspacePanel.*`) gained device hooks only —
  no Vulkan in the panel; `TextureStudioApplication.cpp` owns the unit behind a fault latch.
- Verified in this sandbox (host-verification CMake/Ninja, null GLFW backends): `BakeFieldValidation`
  and the full `TextureStudio` (`TextureWorkspace`) targets build and link, the shader compiles, and
  the CTest passes. Windows CI gained the `BakeFieldValidation` target/test; it only triggers on
  push to `Eksa`/`arena/db2f9953-frontier`, so this branch has no CI run.
- **Not yet proven:** any GTX/RTX execution — the sandbox has no GPU or Vulkan ICD, so the shader has
  been compiled but never run. First hardware run needs the user's Windows machine: pick "GPU" in
  the Baking inspector; GPU fields may differ from CPU by a few LSB (FMA/libm), which the validation
  thresholds anticipate. Also noted while packaging: `Automation/BuildTextureStudioWindows.py`'s
  hardcoded shader count was already stale (10 surface → now 14) and its render source list predates
  the vector-coverage units; the count is corrected to 18 and `BakeRasterization` added, but that
  zig cross-build remains unexercised here. An RTX ray-query fast path can layer on the same field
  layout later without changing the panel or encoder.

## Baking Workspace UI parity pass against Alloy Studio (2026-10-26, branch arena/4014756b-frontier)

- Audited `UI/TextureStudio/BakingWorkspacePanel.cpp` section-by-section against the Alloy original
  (`Experimental/TextureStudio/src/BakingStudio.jsx`, `baking/MeshMapGrid.jsx`, `studioTheme.css`) using
  Material/Pattern/Stamp as the native reference ports, and fixed the concrete divergences found (UI only):
  dock columns now use the reference 278/820/338-of-1436 grid and a 32px status inset; the assets dock
  gained its missing `.bk-asset-scroll` region so the 27-tile grid scrolls instead of running under the
  pinned footer; pane/section headings and card object-counts are right-aligned on their baselines as the
  CSS flex rows specify; mesh stats regained the Box glyph and locale-grouped counts; import buttons carry
  the Upload glyph; target rows show the bare grouped triangle count at the right edge.
- Restored behaviour the port had dropped: after a bake, tiles show the active set's real map thumbnails
  (`object-fit: contain` on `#080a08`, culled to visible rows) instead of permanent gradient swatches; the
  Map inspector card regained its per-map parameter fields (bevel radius/strength/samples, dust axis/falloff,
  wireframe line width, mask strength — now also covered by settings undo/stale detection and recipe save);
  the 2D preview selectors are fed by baked results only, disabled when empty, and fall back to the active
  set's first map like the web original; the 2D stage respects texel alpha over its checkerboard.
- Locked the workspace like the original while a bake runs (`locked = busy`): recipe actions, mode switch
  (which also forces the 3D view for Material patch/Volume SDF again), presets/tiles, every inspector
  field, and settings undo/redo. The Bake action now only appears in Mesh-maps mode and reads
  "Baking mesh maps…" while busy; no Cancel button was faked (there is no native cancellation channel yet).
  The stale Bake-contract paragraph (it claimed only six maps were implemented) now matches the original's
  copy, the status bar is the 32px dot/ellipsis strip, and errors surface as the top-centre amber toast.
- Verified in this sandbox: `TextureStudio` and `BakingWorkspacePanelConstructionValidation` rebuild and
  link, and the construction validation passes. Still open (unchanged, not UI): mesh import, recipe loading
  (no native file picker), Material patch / Volume SDF native panels, bake cancellation, and any
  GTX/RTX or Windows visual confirmation.

## Texture Paint Workspace native port (2026-10-27, branch arena/4014756b-frontier)

- New `UI/TextureStudio/TexturePaintWorkspacePanel.h/.cpp`: the Alloy `TexturePaintStudio.jsx` composition
  copied 1:1 onto the shared native surfaces (PanelDockspace, VectorAuthoringControlSurface, GlyphSpace,
  the Material/Baking orbit camera) — 43px header with the five-workspace switcher, Layers dock (LEFT,
  278/1436), Teapot viewport dock (CENTER), Inspector/History dock (RIGHT, 338/1436), content-browser
  strip and 31px status bar. The long-disabled "Texture" pills in Material/Pattern/Stamp/Baking are now
  live (`ActivateTexture` wired both ways in `TextureStudioApplication.cpp`, layout persisted as
  `texture_studio_texture_layout`, project JSON/draft in the library directory).
- The layer document is real local state, modelled on `textureDocument.js`/`useTextureDocument.js`:
  Alloy's default three layers (Surface detail/Surface finish/Base material), max 64, add/duplicate/
  delete/reorder/folder-assignment/ungroup, masks (fill/paint/colour/gradient), the 15 canonical channel
  targets (Height auto-enabled by Normal), inherited visibility/locking, collapsed-folder hiding,
  81-entry snapshot history (80 undo steps, delayed commits) and `alloy.texture.v1` JSON save/autosave.
- The viewport reuses the Baking workspace's CPU rasterizer pattern over the same built-in Teapot
  (`BakeMesh.h`): smoothed orbit/pan/zoom, Lit/Wireframe, ground grid, UDIM part targeting (Body/Lid/
  Handle/Spout → 1001–1004 derived from real chart ids), an authoring-UDIM UV view plus read-only Source
  UV0, and digital Paint/Erase/Fill + mask region editing evaluated per-triangle as a preview composite.
- Scope stated plainly (also in the panel header): this is NOT Alloy's WebGL surface compositor. No GPU
  paint slices, no baked/exported PBR maps, no decal/stamp projection engine, no material-snapshot
  shading; content-browser assignment stores an asset link (Alloy's own behaviour), channel sources are
  configuration only, and unported actions (Stamp/Transform placement, project file picker) stay disabled
  or say so in the status line instead of faking results.
- Verified in this sandbox: `TextureStudio` and `TexturePaintWorkspacePanelConstructionValidation` build
  and link; the new validation (default document/history/topology) passes, as do the Baking/Stamp
  construction validations. Full CTest: 46/48 — the two failures are the pre-existing
  `DockCycleRecoveryValidation`/`FrameFaultRecoveryValidation` ImGui fault-injection exhibits
  (FrontierInterface-only, untouched here, aborting on ImGui asserts in this sandbox build config).
  Sandbox has no GPU/display: Windows visual confirmation still pending.

## Texture Paint fixes from first Windows test (2026-10-27, branch arena/4014756b-frontier)

- User-tested `8c01cf4` on Windows: workspace runs, three issue classes fixed here.
  (1) Dear ImGui "SetCursorScreenPos() to extend window/parent boundaries" errors (Layer stack window +
  list child, Inspector card): every terminal cursor jump in the docks now submits a zero-size Dummy
  anchor (layer list, pane footer, Digital-painting card, history rows, browser grid, viewport footer,
  and all new channel-panel rows), so scroll/auto-resize boundaries include the reserved extents.
  (2) Viewport: removed the two radial-gradient discs (clear flat field, as requested) and framed the
  teapot closer (3.1x bounding sphere vs the material capture rig's 5.8/1.35, matching Alloy's Texture
  scene; Baking keeps its own framing).
  (3) Inspector parity audit against `TextureLayerInspector.jsx` / `ChannelPropertyPanel.jsx` /
  `textureStudio.css` / `paintChannelModel.js`: field rows are now label-left + 128px select-right
  (`.tp-field-row`), sliders are Alloy's label+value-capsule row over a 24px pill track (`.tp-amount`),
  card notes are 8px with the top rule (`.tp-card-note`), warm accent corrected to `#a79171`, mask card
  gained its reset button, Alloy's White/Black + "Uniform/Inverted fill" preview wording, the
  "Paint overlay · n records / Clear painted mask overlay" block, "Selected colour" + per-UDIM-part
  effective-coverage swatches (native `ColourMaskPreview`), and "Remove layer mask". Layer thumbnails
  now follow `LayerThumbnail` (material swatch / paint checker + recorded dabs / kind icon) in rows,
  identity and source summary; mask identity icon is 32px with effective fill + colour dot.
- Channel targets rebuilt as Alloy's `ChannelPropertyPanel`: heading with count badge + picker toggle,
  removable channel chips, Clear all, grouped picker rows, then one folded card per enabled channel
  (Alloy's six default-folded channels) with source-mode pills (Value/Texture/Generator/Gradient —
  Gradient Base-color-only), per-channel value/colour defaults and ranges from `paintChannelModel.js`,
  generator choice + its real parameter sliders, "Value swatch · Not composited", and the Normal
  Height-derived note. Settings persist in the document/history/JSON as sparse `channelSettings`.
  Honest scope unchanged: these are stored authoring targets — texture import, source canvas, material-
  studio generator and gradient point editing say "not native yet"; nothing composites PBR maps.
- Verified in this sandbox: `TextureStudio` + TexturePaint/Baking/Stamp construction validations build
  and pass. Windows visual re-check pending (user).

## Phase 1: ProjectGenerator, .levelspace, Composable Simulation Inspectors, DiagramControls, and Projects/Everest (2026-10-31, branch arena/5f492703-frontier)

- Updated `CLAUDE.md`, `EngineDocs/AgenticInstuctions/SKILL-Naming.md`, `Documentation/FolderStructure.md`, and
  `Documentation/Plans/Ongoing/ProjectEverestMasterPlan.md` with mandatory banned vocabulary, `*space` container
  extensions (`.projectspace`, `.levelspace`, `.worldspace`), and strict Engine/Project separation.
- Implemented `Engine/ContentInterchange/ProjectGenerator.{h,cpp}` and integrated into `ProjectBrowserPanel::CreateProject`
  so creating any project via the Project Browser auto-generates `Source/<Identifier>Application.{h,cpp}`,
  `Source/Main.cpp`, `CMakeLists.txt`, and `Content/Levels/Default.levelspace`.
- Built composable simulation configurations in `Frontier/Engine/Scene/EngineConfigurations.h` (`SpatialConfiguration`,
  `PhysicsConfiguration` with `MassConfiguration` + mass/kinetic/momentum helpers, `ThermalConfiguration` with
  Stefan-Boltzmann radiative flux + sensible heat helpers, `ChemicalConfiguration` with Arrhenius reaction kinetics,
  `SurfaceOpticsConfiguration`) and dynamic `.levelspace` scene world (`Frontier/Engine/Scene/SceneWorld.{h,cpp}`).
- Upgraded `InspectorRuntime` for multi-inspector composition (`BindInspector` + `AttachInspector`), implemented
  reusable domain-agnostic `DiagramControls`, standalone `<Domain>Editor` classes (`FractureEditor`, `FluidPlumeEditor`,
  `ParticleEditor`, `PolygonClusterEditor`), and modular `NativeInspectors` (`VehicleInspector` deferred to Phase 4).
- Built generic `Projects/Everest/` (`Everest.projectspace`, `Content/Levels/Default.levelspace`,
  `Source/EverestApplication.{h,cpp}`, `Source/EverestSimulationRecords.{h,cpp}`, `Source/EverestWorkspace.{h,cpp}`).
- Verified 58/58 root CTests (including `ProjectBrowserValidation`, `EverestShippingValidation` with `FRONTIER_EDITOR=0`,
  and `EverestInterfaceValidation` with 6 visually inspected 1920x1080 PNG exhibits) plus standalone
  `SceneDirectoryValidation`.

## Phase 2 & Phase 2.1: PlanetaryAtmosphere, Non-Tiled 3D Cloud Shadows & 6-Body 2K Lunar Vulkan 1.3 Stack (2026-10-31, branch arena/5f492703-frontier)

- Reorganized and refined all 5 environment and celestial rendering systems across `Frontier/Engine/DeviceExchange/`,
  `Frontier/Engine/GeometricRaster/`, `Frontier/Engine/PlanetaryAtmosphere/`, and `Frontier/Engine/Shaders/` (12 Slang
  files -> 11 SPIR-V 1.3 compute programs) aligned with `SultanAladin/Frontier-` domain naming, UTF-8 mathematical
  symbols (`SKILL-formatting.md` §4), zero UI Editor modifications, and zero banned-vocabulary occurrences (`Model`,
  `Cache`, `Widget`, `Kit`, `Footprint`, `Shared`, `DedicatedStudio`, `Specialty`, `Actor`, `Beacon`, and no gratuitous
  `Buffer` identifiers):
  1. **Physical Atmosphere & Twilight (`AtmosphereScattering` + `SkyProjection`)**: Dirty-gated `RGBA16F` 2D-array LUT
     bakes (`256x64xR` transmittance, `32x32xR` multi-scattering, `192x108xR` sky-view) plus 6-point Gauss-Legendre
     coupled sun/sky/twilight evaluator (`2.80153%` max relative error vs FP64 continuum oracle, `< 2.85%` target).
  2. **Celestial Ephemeris & 6-Body Real 2K Lunar Dome (`AstronomicalEphemeris` + `PlanetaryProjection`)**: Meeus Ch. 47
     lunar/solar ephemeris, finite-pixel limb-darkened multi-sun discs, all **6 real `2048x1024` sRGB lunar surface maps**
     (`Luna`, `Ember`, `Glacier`, `Sulfur`, `Shroud`, `Shard` in `EngineContent/EnvironmentArchives/CelestialMaps/`)
     with Lommel-Seeliger phase, limb darkening, atmospheric glow, and earthshine, ringed and atmospheric 3D planets,
     and 41,359 octahedral cell-indexed Hipparcos stars (`Hipparcos8.csv`) with Kolmogorov scintillation and Milky Way.
  3. **Non-Tiled 3D Volumetric Clouds & Cloud Shadows (`CloudSpace` + `VolumetricClouds` + `CloudShadowProjection`)**:
     Magnitude-invariant `uint32` bit-mix 3D value + Worley synthesis with C² quintic fade (`6t^5 - 15t^4 + 10t^3`),
     per-octave 3D rotation matrices (`CloudOctaveRotation1`, `CloudOctaveRotation2`) eliminating grid periodicity,
     6 tropospheric height profiles (`Stratus`, `Stratocumulus`, `Cumulus`, `Cumulonimbus`, `Altostratus`, `Cirrus`),
     in-cloud Beers-Powder solar shadow marching, `256x256xR` `CloudShadowProjection` LUTs, and crisp analytic foreground
     receiver cloud shadows across ground, surfaces, and volumetric fog.
  4. **Optical Lens Flare (`OpticalLensFlare`)**: `1x1`-per-source GPU `EvaluateFlareVisibility` integrating 64
     limb-darkened solar disc rays against reversed-Z depth (`VisibilityProjection`), portal aperture bounds, volumetric
     cloud transmittance, and dielectric glass tint — driving 8-element polygonal chromatic ghosts, antipode spectral
     halo, warm + blue anamorphic streaks, and N-blade diffraction starburst.
  5. **Coupled Volumetric Fog (`FogSpace`)**: Analytic closed-form exponential height fog + planet-curved aerial
     perspective + 3D noise-modulated froxel fog boxes scattering cloud-shadowed sun shafts, photometric IES luminaires,
     lightning channels, and thermal radiant facets.
- **Multi-Realm & Portal Routing (`PlanetaryRealmEnsemble` + `PlanetarySubmissionSequence`)**: Arbitrary simultaneous
  realms, planets, suns, moons, cloud layers, and fog volumes with `PortalAperture` cross-realm ray routing.
- **Verified:** **59/59** root CTests passing (including `EnvironmentRealmValidation` on SwiftShader Vulkan 1.3),
  standalone `EnvironmentPipelineValidation` (`73/73`) and `CompleteRendererValidation` (`18/18`) passing, `6/6` real 2K
  moon maps verified by `PrepareMoonAlbedo.py`, and **7** visually inspected Vulkan 1.3 PNG exhibits in
  `Exhibits/EnvironmentRealm/Images/` (`Exhibits/EnvironmentRealm/README.md`).

## Phase 3A: AtmosphereProjection, Lunar Haze, ForceField Vortex/Gust/Dust Coupling, Compile-Time Project Content Staging, Cluster-DAG & Editor-Only DiagnosticRaster (2026-10-31, branch arena/5f492703-frontier)

- **AtmosphereProjection & Lunar Atmospheric Haze:**
  - Renamed `SkyProjection` to `AtmosphereProjection` (`AtmosphereProjection.{h,cpp}` + `AtmosphereProjection.slang`,
    `BakeAtmosphereProjectionLut.spv`).
  - Added physical optical-chord lunar limb & external atmospheric corona haze (`M4` packing in `PlanetaryEnsemble.cpp` +
    `PlanetaryProjection.{cpp,slang}`) across atmospheric moons (`Ember`, `Glacier`, `Sulfur`, `Shroud`) while keeping
    airless bodies (`Luna`, `Shard`) crisp.
- **Unified 3D `ForceFieldSpace` (`Frontier/Engine/PhysicalDynamics/ForceField.{h,cpp}` + `ForceField.slang`):**
  - Upgraded `WindField` into triggerable `ForceFieldSpace` supporting curved-spine Burgers-Rott tornado vortices
    (`TriggerTornado`), bow-echo gust fronts (`TriggerGustFront`), and radial microbursts (`TriggerMicroburst`).
  - Coupled GPU force sources (`R16`, `R17`, and `kForceSourceStride = 4` records) across `CloudSynthesis.slang`,
    `VolumetricClouds.slang` (tight sub-cloud tornado funnel ray-march + rotating mesocyclone wall cloud), and
    `FogSpace.slang` (jittered froxel integration of swirling ochre tornado debris skirts & haboob outflow dust surges),
    plus CPU semi-implicit Euler + quadratic drag ballistic solver for `Rain`, `Snow`, `Hail`, `FineDust`, and
    `CoarseSand` (`StepBallisticParticle`).
- **Declarative Compile-Time `EngineContent/` -> `<Project>/Content/` Staging:**
  - Added `[engine.content_imports].entries` parsing & security validation (`ProjectSpaceCodec.{h,cpp}`),
    `Automation/StageProjectContent.{py,cmake}` (`frontier_stage_project_content`), and standalone `<Project>/Content/`
    runtime discovery (`ContentDirectory.cpp`, `ProjectContent.{h,cpp}`, `PlanetaryProjection.cpp`, `ProjectGenerator.cpp`).
  - Verified standalone execution in `/tmp` with zero `EngineContent/` present via `ProjectContentStagingValidation`.
- **Glass-Aware QEM `ClusterHierarchy`, 3-Tier Material Virtualization, `ControlVehicle` & Editor-Only `DiagnosticRaster`:**
  - Implemented `ProceduralShapes`, binary `FCT1` `.facet` loader (`ControlVehicle{Body,Rim,Tyre}.facet`, `25,128`
    triangles), crack-free locked-border QEM `FacetTierBuild` + `QuadricTierBuild`, dual-interface Snell + curvature
    optical error magnification (`3.78299x` on curved automotive glazing), `64 KB` page residency budgets, two-phase
    Hi-Z with interior survival behind glass (`OpaqueBehindGlassSurvived = 66`), and 3-tier Material LOD virtualization
    (`FullStrata = 64 B`, `FilteredToksvig = 24 B`, `CompactProxy = 16 B`).
  - Re-skinned `Experimental/AtmosphereEditor/` (`6a83f8e`) and added `ThemeCardPalette.h` bound strictly to
    `ThemeStructure` tokens (`QueryAccentColor()`) with zero hardcoded green.
  - Built `DiagnosticRaster.{h,cpp,slang}` (`9` inspection modes with procedural sky/ground dome, anti-aliased
    barycentric wireframe, and 2-layer glass peel) strictly guarded under Editor/Development profiles and verified
    symbol-free in Shipping (`DiagnosticShippingExclusionCheck` + `EverestShippingValidation`).
- **Verified:** **61/61** CTests passing 100% (`ProjectContentStagingValidation`, `ClusterDiagnosticValidation` + 4
  `ControlVehicle` PNG exhibits, and `EnvironmentRealmValidation` + 8 showcase PNGs including
  `TornadoSupercellAndDustVortex.png`). Phase 3B (GTX-first ReSTIR + SDF + software CWBVH renderer) queued next.

## ReSTIR Removal: Lighting Restarts from Scratch (2026-11-01, branch arena/88b72faa-frontier)

Base: `SultanAladin/Frontier` `arena/5f492703-frontier` at `2d55bd2f`, synced without `.github/workflows`.

- **Removed, Stage 3B renderer:** `Frontier/Engine/Rendering/{SpatiotemporalIllumination,SurfaceScatteringAtlas}`,
  `Frontier/Engine/Shaders/{SpatiotemporalIllumination,SurfaceScatteringEvaluation}.slang`, its four kernels
  (`TracePrimarySurface`, `SampleDirectReservoirs`, `ReuseSpatialReservoirs`, `FilterSpatiotemporalAtrous`), and
  `Exhibits/SpatiotemporalIllumination/` (validation, README, three captures).
- **Removed, editor ReSTIR controls:** `RenderPipelineConfiguration::{RestirTemporalHistory,RestirSpatialNeighbors}`,
  the `ReSTIR M-Cap` slider, and `ReSTIR` in the RTX tier captions and `EverestWorkspace` tier pill. Evidence:
  `Exhibits/EverestInterface/Images/07-EverestRenderPipelineInspector.png`; captures 02-06 re-taken.
- **Retained:** `.sdfspace` SDF (`VolumeDistanceArchive`, `VolumeDistanceSampling.slang`), software SAH BVH
  (`BoundingVolumeAtlas`; `BoundingVolumeSearch.slang` now has no kernel consumer), `PreviewRaster` with all five
  `PreviewShadowMode`s, `ForceField`, and the GeometryProcessing restructure.
- **Moved:** `BakeSdfSpaceTool.cpp` and the CPU `.sdfspace`/BVH checks (new `GeometryProcessingValidation`) to
  `Exhibits/ClusterDiagnostic/Code/`.
- **Closed (see next section):** the older exhibit-only CPU ReSTIR reference was removed once the owner delegated the
  decision. No performance claim is made; the cause of the reported 10 FPS remains unmeasured.
- **Verification:** GCC 12.2, Slang 2026.14.1, SwiftShader Vulkan 1.3. The other 56 root CTests have no changed inputs
  and were not re-run. Windows/MSVC builds were not run.

| Check (Linux host verification)              | Before `2d55bd2` | After                 |
|----------------------------------------------|------------------|-----------------------|
| Environment Slang kernels                    | 19, 12 warnings  | 15, 0 warnings        |
| Affected root CTests                         | 7/7 passed       | 7/7 passed            |
| Root CTest registrations                     | 63               | 63                    |
| Retained preview/environment PNGs vs renders | n/a              | 15/15 pixel-identical |

## VehicleHMI ReSTIR GI — 1:1 C++/Vulkan/Slang port (2026-11-01, branch arena/88b72faa-frontier)

Source of truth: SultanAladin/Frontier `arena/e9bd7db5-frontier` at `6afb6f00`, `Experimental/VehicleHmiPrototype/`.

- **Added:** `Frontier/Engine/DeviceExchange/DeviceExchange` (Vulkan 1.3 raster + compute with WebGPU ordering),
  `Frontier/Engine/Rendering/GlobalIllumination/*` (17 host modules ported statement for statement), 51 Slang units in
  `Frontier/Engine/Shaders/GlobalIllumination/` (29 entries), `Automation/GlobalIlluminationRendering.cmake`,
  `Frontier/Projects/Project-VehicleHmiDemo/Contract/TranslateShaders.py` (first-pass translator, hand-corrected output).
- **Evidence:** `Exhibits/RestirGiParity/` — capture hooks for the original demo (Node + Dawn + SwiftShader), the
  `RestirGiParityValidation` C++ tool, images and logs. Deterministic stages are bit-identical; the presented image
  matches 99.93–99.98 % of 8-bit values across runs (two runs of the demo itself: 99.94 %). The residual variance is a
  card-radiosity race inside the original, ported unchanged.
- **Removed (owner: "u can decide what and what not to remove"):** the non-1:1 CPU illumination chain
  `Frontier/Engine/Rendering/{ReservoirSampling,IlluminationUnits,ReferenceRenderer,CompleteFrameUnits,
  VarianceFiltering,DiscrepancySequence,DistanceField,SurfaceCards}` and `Exhibits/{IlluminationChain,CompleteRenderer,
  IndirectIllumination}`. Retained: `SubmissionOrder`, `BarrierDerivation`, `TransientTargetAtlas`, `EnvironmentUnits`,
  `.sdfspace`/`BoundingVolumeAtlas`/`PreviewRaster` (editor preview path, not the illumination port).
- **Naming:** demo identifiers barred by `SKILL-Naming.md` were renamed (table in
  `Documentation/Plans/Ongoing/IlluminationPort.md`); behaviour is unchanged.
- **Verification:** GCC 12.2, Slang 2026.14.1, SwiftShader 5.0.0. Full root build and 63/63 root CTests pass; the
  parity tool needs a reference capture and is not a CTest. Windows/MSVC and hardware GPUs were not run.
- **Open:** present the port in the Everest/editor viewport; port `LightingSystem` and `EncodeEnvironment` host
  encoders (taken from the capture today); the effect systems listed in the exhibit README are not ported.


## Live Scene Viewport + PlanetaryAtmosphere environment (2026-11-01, branch arena/88b72faa-frontier)

Owner's request: hook the ported ReSTIR GI into the editor viewport; add clouds, fog, lens flare, sun, moon, stars and
planets; recreate the VehicleHMI scene without cars, physics or UI. The environment comes from PlanetaryAtmosphere,
the 5ec53579 line already in the tree; the owner chose it over porting the demo's own clouds and flare.

- **Added — engine:**
  - `Frontier/Engine/DeviceExchange/VulkanDeviceAccess.h`, plus `DeviceExchange::AttachDevice` / `QueryDeviceAccess` /
    `WrapTexture` / `AwaitIdle` and `VulkanComputeExchange::AttachDevice`, so the exchanges can borrow the editor's device.
  - `VulkanPresentation` `SceneRendering` (a Vulkan 1.3 device with the port's features) and `QueryDeviceAccess`.
  - `Rendering/GlobalIllumination/EnvironmentEncoding` (1:1: `EncodeEnvironment`, `CelestialSolver`, `CelestialAtlas`
    roster) and `Rendering/GlobalIllumination/LuminaireRegister` (1:1: `LightingSystem.Update` + `BuildClusterGrid`).
  - `IlluminationHost` changes: the demo's sky path and light-change relighting, `RefreshInterlude`, `OmitVehicle`, lamp
    placements from the scene.
  - `Rendering/SceneViewport/{SceneViewport,EnvironmentOverlay}` and `Shaders/GlobalIllumination/EnvironmentVisibility.slang`.
  - `PlanetarySubmissionSequence::EnsureViewportTargets` / `ExecuteOverVisibility` / `HdrTarget`.
  - CMake library `FrontierSceneViewport`.
- **Added — project, editor and content:**
  - `Projects/Everest/Source/EverestSceneViewport` (level records → viewport).
  - `EverestWorkspace`: live Scene Viewport with orbit/pan/dolly/fly; the schematic is kept as the fallback.
  - `WindowsFrontier.cpp`: `SceneRendering`, the bridge and the ImGui texture.
  - `EngineContent/EnvironmentArchives/ProvingGround` (the demo's scene and idle profiles, provenance file), imported by
    `Everest.projectspace`.
- **Owner's naming and layout review (same day):**
  - `Frontier/Engine/Illumination/` → `Frontier/Engine/Rendering/GlobalIllumination/` (the port, namespace
    `Frontier::GlobalIllumination`) + `Frontier/Engine/Rendering/SceneViewport/` (viewport and environment overlay);
    `Shaders/Illumination/` → `Shaders/GlobalIllumination/`; `Automation/GlobalIlluminationRendering.cmake`.
  - `AdoptedDevice` → `VulkanDeviceAccess` (`Adopt` → `AttachDevice`, `AdoptTexture` → `WrapTexture`); `LuminaireTable`
    → `LuminaireRegister`; `ClusteredLightTable` → `ClusteredLightRegister`; `EnvironmentComposition` →
    `EnvironmentOverlay`; every `compose`/`composite` identifier and comment in the port, the viewport and
    PlanetaryAtmosphere renamed (`CompositeFlareAperture` → `BlendFlareAperture`); `Kind`, `State`, `Value`, `Frame`
    identifiers in the new code renamed. Table in `Documentation/Plans/Ongoing/IlluminationPort.md`.
- **Added — stored SPIR-V:** `EngineContent/ShaderArchives/{GlobalIllumination,Environment}` (31 + 15 archives,
  `ShaderCompilation.json`), `Automation/StoreShaderArchives.py`, CTest `StoredShaderArchiveValidation`. Editor builds
  without the pinned slangc (MSVC on Windows) copy them beside `Frontier.exe`; the port's units compile only with the
  pinned compiler unless `FRONTIER_GLOBAL_ILLUMINATION_SLANGC` names another.
- **Added — distribution:** `Automation/PackageEditorPreviewWindows.py` and `Exhibits/SceneViewport/WindowsPreviewReadme.md`.
  Delivered: `FrontierSceneViewport-Windows-x64.zip` (25 MiB, material archives omitted, commit `21a0ccb4`, SHA-256
  `4a9c1a7f…36d0`) to the owner's Google Drive. A GitHub prerelease was attempted, but this host cannot reach
  `uploads.github.com`, so no release exists.
- **Evidence:** `Exhibits/SceneViewport/`:
  - day, low-sun, dusk-fog and night images, plus the Everest workspace with the live viewport (CPU-rasterized
    interface, GPU image read back);
  - `SceneViewportValidation` 0 failing checks, rendered from the stored archives;
  - `RestirGiParityValidation … live` 150 checks, 0 failures after the renaming. The environment block and the luminaire
    register are native and byte-identical over 12 refreshes; the presented image matches 99.98 % (84.4 dB).
- **Verification:**
  - GCC 12.2 host build; 64/64 CTests.
  - SwiftShader 5.0.0 for every image.
  - Windows: `Frontier.exe` cross-compiled and linked with the pinned Zig 0.13.0 (`x86_64-windows-gnu`,
    `Automation/WindowsToolchain.cmake`), configured without slangc so the stored archives are used. Never launched.
  - No hardware GPU run; MSVC not run.
- **Open:**
  - The environment does not relight the illumination (cloud shadows and environment moonlight do not reach the scene).
  - The `Moons` phase field is unused (phase follows geometry).
  - Viewport submissions are synchronous.
  - The demo's own clouds, flare passes, weather and vehicle systems remain unported.

## Windows start-up fix, stored Surface shaders, GitHub-built downloads (2026-11-02, branch arena/88b72faa-frontier)

- **Reported:** the `21a0ccb4` download stopped at start-up: "Severe application failure: Missing or malformed browser
  shader archive." The Project Browser loads `EngineContent/ShaderArchives/Surface/Browser{Preview,Drafting}{Vertex,Fragment}.spv`.
  That set was compiled only when a `slangc` was on `PATH`. The cross-build had none, so the package had no `Surface`
  folder. The packager checked only the two Scene Viewport sets, and the README's "no Slang compiler needed" was wrong
  for MSVC builds without the Vulkan SDK.
- **Fixed:**
  - `EngineContent/ShaderArchives/Surface`: all 18 entries a build compiles into that folder (7 raster sources, vertex and fragment,
    vector coverage/selection/surface, bake field), compiled with `slang-loader@0.0.7` (Slang 2026.19 WASM) and stored by
    `Automation/StoreShaderArchives.py --sets Surface`. The editor's `EngineContent` copy carries it beside `Frontier.exe`.
  - `StoreShaderArchives.py`: `Surface` set, WASM compiler recorded from the build's manifest, `--compare` (sets whose
    compiled SPIR-V must equal the stored copy). CTest `StoredShaderArchiveValidation` now verifies all three sets and
    compares each set the build compiled with the compiler that stored it.
  - CTest `BrowserPreviewStartupValidation` (`Exhibits/Renderer/Code`): the browser's start-up rendering from the stored set.
  - `PackageEditorPreviewWindows.py` checks every entry of every stored set and the files `Frontier.exe` opens before
    the first click.
  - `BrowserPreviewRendering`: the start-up error names the missing file.
- **Added:**
  - `Frontier.exe <project>.projectspace` opens the project directly; a missing path stays in the browser.
  - The journal records the Scene Viewport's first 12 statuses and every new target (capped at 32).
  - `Automation/Workflows/EditorPreviewWindows.yml` + `Automation/LaunchEditorPreviewWindows.ps1`: Zig cross-build and
    package, MSVC build as the README describes, the package launched on a Windows runner with a CPU Vulkan driver
    (Project Browser, then Everest's Scene Viewport, with screenshots), and a pre-release `editor-preview-<sha>`.
    Inactive until copied to `.github/workflows/`: the push of that path was refused ("refusing to allow a GitHub App to
    create or update workflow … without `workflows` permission"), and this host cannot reach `uploads.github.com`.
- **Verification (Linux host, fresh sandbox):**
  - `BrowserPreviewStartupValidation` on SwiftShader: four browser archives, 4 pipelines, 4 thumbnails, 2,916 colours
    read back.
  - `StoredShaderArchiveValidation` passes. A from-scratch recompile reproduced all 31 + 15 + 18 stored archives byte
    for byte.
  - Zig cross-build of `Frontier.exe` with no Slang compiler configured: `EngineContent/ShaderArchives/Surface` lands
    beside it.
- **Delivered:** `FrontierSceneViewport-Windows-x64-e4b9baf4.zip` (22.1 MiB, material archives omitted, revision
  `e4b9baf4`, SHA-256 `a3b5d646…f968`, `Frontier.exe` SHA-256 `1cee57b8…11ac`) to the owner's Google Drive. The
  extracted zip passed `BrowserPreviewStartupValidation` against its own `Surface` folder, and the exe imports only Windows
  system DLLs and the UCRT. No GitHub release: the workflow could not be pushed (see Added), and asset uploads need
  `uploads.github.com`.
- **Not run:** the Windows launch and the MSVC build (both wait for the workflow to be activated); no hardware GPU.
- **Proposed next (owner to choose):** make the environment light the scene. Either PlanetaryAtmosphere feeds the port's
  existing sky, sun, moon and cloud-shadow inputs (`DirectRadiance` bindings 11–13, `CelestialSky`/`SampleSkyRadiance`,
  reflections), keeping the GI algorithms 1:1; or the demo's own sky, clouds, cloud shadows, fog and flare return 1:1
  and replace the overlay.

## AMD device-loss fix, environment lighting the scene (Option A), planet records (2026-11-02, branch arena/88b72faa-frontier)

- **Reported:** on the owner's RX 9060 XT the `e4b9baf4` download failed 2.7 s after Everest opened ("staged write
  submission failed", then `VK_ERROR_DEVICE_LOST`). The owner then chose Option A: PlanetaryAtmosphere lights the scene.
  Solar bodies means the sun, moons and planets, and the stars stay in.
- **Device loss, fixed in `8d50414`:**
  - *Cause.* `DeviceExchange::FlushWrites` recorded a flush's staged writes as unordered buffer copies.
    `ConstructRegionFrom` stages a zero fill and then the contents into the same buffer, and the zero fill could land
    last. The zeroed distance-volume hierarchy made `TransferDistance` loop forever, and Windows reset the GPU after 2 s.
  - *Fix.* An overlapping write now waits for the earlier one. Synchronization validation (Khronos layer built from
    source) found 4 write-after-write hazards before the fix and none after: SwiftShader over the bring-up and 8
    refreshes, lavapipe over the bring-up.
  - *Hardening.* Checked fence waits; the `VkResult` and the labelled submission in every failure; range checks on
    queue writes, copies and reads; unwritten bindings reported; `robustImageAccess`; a device probe; the bring-up
    journalled step by step; the first two refreshes submitted per step.
- **Option A, `09d5fa3`:** the GI algorithms stay 1:1, and the environment feeds the inputs they already read.
  - *Sun.* The key light is the sun through the environment's air (`AdjustLight`).
  - *Night.* Luna lights the night at the `Moons` phase and albedo, together with Ember.
  - *Sky.* `ProjectEnvironmentSky` writes the environment's sky into the port's sky view, which cards, ReSTIR GI and
    reflections sample.
  - *Clouds.* `ProjectCloudShadow` writes the environment's cloud shadow map into the port's idle projected cloud
    shadows.
  - *Fog.* The fog's sun shafts are shadowed by the port's sun cascades (`IntegrateFogSpace` bindings 6/7).
  - *Demo inputs.* `SceneViewportConfiguration::EnvironmentLighting = false` restores the demo's own inputs.
  - *Archives.* New stored SPIR-V: `EnvironmentLighting` ×2 and `IntegrateFogSpace`. GlobalIllumination now holds 33
    entries and Environment 15.
- **Planets as records:** the `Planet` type has an inspector and a glyph. `Default.levelspace` has
  `rec_planet_{venus,jupiter,mars,saturn}` under `Atmosphere` (26 records). The viewport draws the planets from these
  entries. The sun, moons and stars were already entries.
- **Verification (Linux host, SwiftShader):**
  - `SceneViewportValidation`, low, 480 × 270, 12 refreshes, from the stored archives: 18 checks, 0 failing.
    - Daylight key light (10.86, 8.53, 6.20); sky zenith (0.165, 0.400, 1.220); clouds shade 39.6 % of the map.
    - The low sun's red/blue rises from 1.75 to 5.20.
    - The night key light is Luna (0.064, 0.064, 0.067).
    - Fog shafts: 0.767 / 0.771 unshadowed / 0.767.
  - The earlier high-tier pass (320 × 180, 2 refreshes) under synchronization validation: 0 failing checks, 0 layer
    messages.
  - spirv-val (Vulkan 1.3) passes on the three new archives.
  - `StoredShaderArchiveValidation`, `BrowserPreviewStartupValidation`, `EverestInterfaceValidation` (26/27 records, four
    planets), `EverestShippingValidation` (26 records; planets survive the `.levelspace` round trip),
    `ProjectSpaceValidation`, `InterfaceValidation`, `EnvironmentRealmValidation` and `ProjectContentStagingValidation`
    pass.
- **Delivered:** Windows x64 downloads (Zig 0.13.0 cross-builds) on the owner's Google Drive.
  - `8d504144` (the device-loss fix alone): `FrontierSceneViewport-Windows-x64-8d504144.zip`, Drive id
    `1eKLpqBk6cZIAu8DnyCe2VVT0EatfVvWF`, SHA-256 `a6a53f20ba0842cb6790aaeb77575b095b107296e963b8f335b0f7a46cf896cb`.
  - `9b8d83df` (Option A and the planets, with this exhibit's documentation):
    `FrontierSceneViewport-Windows-x64-9b8d83df.zip`, 22.2 MiB, Drive id `1BLxO9tPIOWwBtRIrPy7G8-rUily5tne6`, SHA-256
    `5a0a7226b4d76a9782a45187e168de8ffd1765d5ed9cce20c6793a3ff438d6ee`.
  - The package records revision `9b8d83df` with no uncommitted changes; its shader sets are Surface 18,
    GlobalIllumination 33 and Environment 15. The executable is PE32+ x64 and imports only Windows system DLLs and the
    UCRT. The upload matches the local file in size and MD5.
- **Not run:**
  - no hardware GPU, no Windows launch;
  - the parity capture was not re-run, because its reference capture is not in this sandbox. The new hooks are not
    called without an environment, so its 150 checks still hold for the demo inputs;
  - the workspace capture image predates Option A;
  - pipelining (Option A step 6) is future work.

## The Windows download on GitHub; workspace capture after Option A (2026-11-02, branch arena/88b72faa-frontier)

- **Asked:** "commit to arena/88b72faa-frontier", and why the agent kept saying it could not commit to GitHub.
- **Commits work.** Every change of this work is pushed to `arena/88b72faa-frontier`; `main` changes only when the
  owner merges. GitHub refuses two narrower things:
  - a push that adds a workflow file. Tried again: `refusing to allow a GitHub App to create or update workflow
    .github/workflows/EditorPreviewWindows.yml without workflows permission`. The rejected commit never reached the
    remote and was dropped locally;
  - release assets, which upload through `uploads.github.com`. This sandbox cannot reach that host
    (`SSL_ERROR_SYSCALL`).
- **Delivered on GitHub:** `Binaries/FrontierSceneViewport-Windows-x64.zip` and its `.zip.sha256`, committed in
  `f0fed15`: 22.2 MiB, SHA-256 `09584aa5486945c0855f25c03995ce15e27897386e5699ecea5afc260ff36591`.
  - It is the Zig 0.13.0 cross-build of `24ef36a1`: the code of the `9b8d83df` download plus documentation, with no
    uncommitted changes.
  - Shader sets: Surface 18, GlobalIllumination 33 and Environment 15. `Frontier.exe` is PE32+ x64 and imports only
    Windows system DLLs and the UCRT.
  - The file on GitHub matches the local file: git blob `32357bfa60608debfbf0f71cf6e0cd835e9eef92`, 23,237,717 bytes.
  - `.gitignore` keeps every other package local. Once the owner places the workflow, each push is published as a
    pre-release and the branch stops carrying packages.
- **Workspace capture after Option A:** `Exhibits/SceneViewport/Images/EverestLiveSceneViewport.png` re-taken from
  `24ef36a1` (SwiftShader, `high`, 1028 × 482, 12 refreshes, 11 min 25 s, exit 0; bring-up 114.5 s). The Outliner lists
  the four planet entries (26 records). The shadows take the environment's blue sky as their fill: the blue/red ratio
  of the pixel means rises from 1.10 to 2.08 in the ground shadow, from 0.96 to 1.36 on the tower's shaded side, and
  from 1.21 to 1.46 in the sky's zenith band.
- **Held back:**
  - pipelining (Option A step 6) waits until the device-loss fix has run on the RX 9060 XT, because it changes the same
    synchronization;
  - the moon phase. The drawn disc follows the sun–moon geometry, while the `Moons` record's phase sets Luna's light.
    For the record to drive the disc, either the moon shader gets a phase input or Luna's position follows from the
    phase. The owner decides.

## Unreal-style viewport camera; first slice of the VehicleHMI demo UI (2026-11-02, branch arena/88b72faa-frontier)

- **Reported:** the `24ef36a1` download works on the owner's RX 9060 XT. Asked for: the viewport camera as Unreal Engine's
  WASD camera (A and D were inverted); then a proper UI, porting the VehicleHMI demo's UI 1:1, with
  SultanAladin/Frontier `e7a0aaf2` as the helper (its `Frontier/Projects/Project-VehicleHmiDemo/Contract` UI inventory
  and the demo `index.html`).
- **Camera:** `SceneViewportOrbit` → `SceneViewportFlight` + `IntegrateSceneViewportFlight`
  (`Projects/Everest/Source/EverestWorkspace.{h,cpp}`).
  - *Cause of the inversion.* The orbit camera's right vector was `Up × Forward`; the renderer's screen right is
    `Forward × Up` (`ConstructViewTransform`).
  - *Bindings and constants* are Unreal Engine 5's editor defaults (Epic's viewport-controls page; `MouseSensitivty` 0.2,
    `CameraSpeed` 4 of 8 with the 0.03125 … 32 table, acceleration 20000 cm/s² with damping 10, Shift boost 2, drags
    `× CameraSpeed`, wheel `GetCameraSpeed(5) × 32` cm, Z/C field of view with recoil).
  - *Pointer:* `EverestWorkspace::ConstrainPointer`, set by `WindowsFrontier.cpp`, hides and locks the pointer to the
    window that shows the viewport during a camera drag (`GLFW_CURSOR_DISABLED`, raw motion); GLFW returns it.
  - *Keys:* the viewport owns the wheel and, while dragging, the flight keys (`SetItemKeyOwner`), so keyboard
    navigation (`NavEnableKeyboard`) does not move on the arrows.
  - `SceneViewportFlightValidation` (new CTest, 19 checks, 0 failing): directions are read from the renderer's view
    basis; D/A are screen right/left at 5 headings × 4 elevations.
- **Download (camera):** `Binaries/FrontierSceneViewport-Windows-x64.zip` from `8c34e1b3` (Zig 0.13.0, no uncommitted
  changes, Surface 18 / GlobalIllumination 33 / Environment 15), 22.2 MiB, SHA-256
  `c31128c87517a88cad776a56bb9ba308cf27b8cd64b6009f37541b7fbc3b9353`; its `README.md` lists the Unreal controls.
- **Interface, first slice of the 1:1 VehicleHMI demo UI** (`Exhibits/SceneViewport/InterfacePortInventory.md`):
  - *Reference.* The demo at `6afb6f00` ran headless on SwiftShader (Chromium from npm `@sparticuz/chromium` 153.0.0,
    puppeteer-core 23.11.1, `quality=low&scale=0.5&stresspool=0&capture=1&omit=Cabin`; editor ready after 50 s). The shell,
    every region's HTML and one Inspector page per Outliner entry (45) were captured (`Tools/CaptureDemoInterface.js`).
  - *Ported:* the viewport column (tab "Viewport" and the scene pill, viewport bar with scene heading, LIVE pill,
    Particles, Chase/Free segmented switch, the 15 inspection views and the five round buttons; readout; distance-slice
    frame and legend; overlay notice; bring-up card; failure panel) and the status strip.
    `Frontier/Engine/Interface/ViewportChromeControls.{h,cpp}` carries `FrontierEditor.css` metrics and colours and draws
    the demo's Lucide glyphs from their SVG paths. `EverestWorkspace` lays out and wires the controls.
  - *Wired to the port:* the select writes `RenderPipeline.InspectionModeIndex`, now named after the demo's 15 views, which
    `ViewportRendering::Inspection` passes to `RefreshToggles::Inspection`. The distance slice sets HMI word bit 0, which
    `DisplayPresent` draws. The readout uses `SceneViewport::QueryStatistics`: screen and trace extents, bounces, TLAS
    instances and entries, BLAS triangles. Particles opens the level's `Particles` record in `ParticleEditor`.
  - *Inactive, stated in their tooltips:* Chase, Respawn and Reassemble (no vehicle, no breakable props).
  - *Label contract:* `Exhibits/SceneViewport/Results/UiLabels.tsv`. Of 138 labels, 13 were ported this turn and 28
    earlier (25 GPU labels found verbatim in the GI port); 1 removal is proposed and 96 are pending.
- **Verification (Linux host, SwiftShader):**
  - workspace capture: 12 refreshes in 11 min 10 s, with the readout and the distance slice on. The TLAS line reads 504
    instances (1007 entries) and 20,878 BLAS triangles; the demo reads 509 (1017) and the same triangles, the
    difference being its car. A thirteenth refresh with the record set to "Normals" shows the port's normals view
    (`Images/EverestLiveSceneViewport-Normals.png`);
  - CTests: `SceneViewportFlightValidation` (19/0), `InterfaceValidation`, `EverestInterfaceValidation`,
    `EverestShippingValidation`, `ProjectSpaceValidation`, `EnvironmentRealmValidation`, `ProjectContentStagingValidation`,
    `DockingValidation`, `WorkspaceLayoutValidation` and `StoredShaderArchiveValidation` pass.
- **Not run:** no hardware GPU and no Windows session; the pointer lock, the keys and clicks through the bar were not
  exercised interactively.
- **Download (interface + camera):** `Binaries/FrontierSceneViewport-Windows-x64.zip` from `6b9235a2` (Zig 0.13.0, no
  uncommitted changes, Surface 18 / GlobalIllumination 33 / Environment 15), 22.2 MiB, SHA-256
  `0aad940fe6314b5a5d977437150c5572c2a7e35a321464a1e387222903000c26`.

## The demo's Sun Inspector page, 1:1 (2026-11-02, branch arena/88b72faa-frontier)

- **Asked for:** option A, the environment Inspector pages 1:1 (Sun, Clouds, Atmosphere, Moons, Stars, Fog, Wind, Lens
  flare); the web-only label "Could not load the app runtime." may go (approved).
- **Done this turn: the Sun page and the controls its family shares**
  (`Exhibits/SceneViewport/InterfacePortInventory.md`):
  - *Controls:* `Frontier/Engine/Interface/ObservatoryControls.{h,cpp}`, from `CloudInspector.css`, `SunInspector.css`,
    `NativeEnvironment.css` and `SliderControl.css`, with the narrow-column cascade (the Inspector is under the sheets'
    520 px container breakpoint). The canvas `Pen` draws the demo's diagrams in their logical coordinates.
  - *Page:* `Frontier/Engine/Interface/SolarObservatory.cpp`, `SunInspectorDashboard.js` 1:1 on `SolarConfiguration`
    with four panes, every control live. A Frontier card keeps the native ray-shadow and light-shaft switches.
  - *Runtime:* `RecordInspector::QueryOccupiesColumn` (the page lays out the whole column), `QuerySectionCount` /
    `ConfigureSection`, `InspectorRuntime::RequestSelection` ("Open Lens Flare ↗"), the interface scale, and the
    registered solar placement solver.
  - *Native fields:* `SolarConfiguration` gains the demo Sun keys: disc, aureole, colour source, tint, day clock,
    date, place. They are saved with the level; `ResolveSky` maps them; `Everest::AdvanceSolarDay` is the demo's
    `AdvanceCelestial`, and `Everest::SolveSolarPlacement` answers the page with the GI port's `SolveCelestial`.
  - *Text sizes:* CSS em sizes are now converted to stb_truetype pixel heights (DM Sans 1.302, JetBrains Mono 1.32),
    in the new controls and in the viewport chrome, whose text drew about 23 % small.
  - *Label contract:* 47 of 138 ported, 1 removal approved by the owner (2026-11-02), 90 pending.
- **Verification (Linux host):** the full host build is warning-free in the new files; `EverestInterfaceValidation`
  writes one capture per Sun section (`Exhibits/SceneViewport/Images/SunPage-*.png`) and shows the demo's own ephemeris
  figures at the defaults (rise 05:31, set 18:12, 12.7 h); `InterfaceValidation`, `EverestShippingValidation`,
  `ProjectSpaceValidation`, `EnvironmentRealmValidation`, `ProjectContentStagingValidation`,
  `SceneViewportFlightValidation`, `DockingValidation`, `WorkspaceLayoutValidation` and `StoredShaderArchiveValidation`
  pass.
- **Not run:** no hardware GPU and no Windows session; the page's controls were exercised offscreen only.
- **Next:** Atmosphere and Clouds on the same controls; then Stars and Moons (`ci-` family), Height and Atmospheric
  fog (`fg-`), Wind and Lens optics, each with its own controls.
- **Download (Sun page):** `Binaries/FrontierSceneViewport-Windows-x64.zip` from `dc93d268` (Zig 0.13.0, no
  uncommitted changes, Surface 18 / GlobalIllumination 33 / Environment 15), 22.2 MiB, SHA-256
  `0c3453599e65b14ecda52e55bb74b926af39965bc9bd4f598b2986d15188ab25`.

## TAA with the overlay, the sun behind clouds, UI fixes, the Atmosphere page (2026-11-02, arena/88b72faa-frontier)

- **Requested:** report on the antialiasing (edge shimmer with TAA on); the sun drew in front of clouds; no visible
  panel scrollbars (wheel scrolling with eased overscroll); remove the top toolbar strip and keep only the notch; Log
  Stream fixes (no entries per second, round buttons, filters in their own row, no overlapping expanded cards, square
  rows, several rows expanded at once); port the environment Inspector pages (Atmosphere first). Jolt physics is the
  next phase.
- **Delivered:**
  - `d5981a3` the PlanetaryAtmosphere overlay is drawn before the demo's TAA and antialiased with the refresh
    (`Exhibits/SceneViewport/README.md`, *Temporal antialiasing*): silhouette shimmer with TAA on −54 % on SwiftShader.
  - `654216b` Log Stream rework, wheel-only panels (`DockPanelSpecification::WheelScrollOnly`), the top toolbar
    removed: Projects and Save level on the Control Centre's Quick Controls, Ctrl+S saves.
  - `5f6d596` clouds hide the sun disc (`ResolveSolarDiscTransmittance`) and are lit from behind (a g 0.9 silver
    lining lobe); `SolarOcclusionValidation` (CTest): disc behind a dense cloud 1.61 → 1.03 × the cloud, a cloud beside
    the sun 1.89 → 2.58 × the same cloud with the sun behind the camera.
  - `9de54d4`, `e7c5544` the demo's Atmosphere page (four tabs, all instruments) with native fields for its keys; scale
    heights, ground albedo, horizon glow and air mass are live in the viewport; sky tint, sky brightness, white line,
    civil-only, multiple scattering, LUT samples and the GPU previews are disabled with a tooltip (pending).
- **Verification (Linux host, SwiftShader):** `EverestInterfaceValidation` (with Quick Controls and the four Atmosphere
  tabs captured), `EnvironmentRealmValidation`, `SolarOcclusionValidation`, `ForceFieldTriggerValidation`,
  `ClusterDiagnosticValidation`, `ControlCentreValidation`, `DockingValidation`, `WorkspaceLayoutValidation`,
  `InterfaceValidation`, `EverestShippingValidation`, `StoredShaderArchiveValidation` pass; the Log Stream proof passes
  72 checks.
- **Not run:** no hardware GPU and no Windows session.
- **Next:** Moons, Stars, Height fog, Atmospheric fog, Clouds, Wind, Lens flare, Local cloud and fog, Lightning;
  then Jolt.
- **Download:** `Binaries/FrontierSceneViewport-Windows-x64.zip` from `e7c55447` (Zig 0.13.0, no uncommitted changes,
  Surface 18 / GlobalIllumination 33 / Environment 15), 22.3 MiB, SHA-256
  `e8081a26463e68f57d7e75c71134324e5422723c363cc471e4e0f94c6fe2d57f`.


## Remaining VehicleHMI environment controls (2026-11-02, arena/8b705b7d-frontier)

- **Source:** continued from `streamlinkinbox/Frontier` branch `arena/88b72faa-frontier`, tip `a1771e9b`.
  Demo source pinned to `SultanAladin/Frontier` revision `6afb6f00b5f25c45f7cda92c7da65b64845768f3`.
- **Implemented in C++:** Clouds/global-local, Wind, Height Fog, a separately selectable Atmospheric Fog record,
  local fog, Lightning, Stars, four Moon authoring slots, and Lens Flare. Preserved the Sun/Atmosphere pages.
  Added native controls, catalogue/surface/optical/density references, configuration persistence, and HDR PFM export.
  The default Everest level has 29 records. Renderer-only features remain disabled or explicitly reference-only;
  no new scene-renderer implementation is included.
- **Verified:** Linux Debug build; `EnvironmentInspectorValidation` **319 assertions, zero failures**;
  `EverestInterfaceValidation` and `EverestShippingValidation`; 114 numerical cases from actual pinned JS;
  37 native inspector PNGs, 32 production-workspace environment captures, and 28 original-demo browser captures.
  Tests include TOML/disk round trips, malformed content, input/revisions, context retirement and async destruction.
- **Windows package:** Release x64 cross-build with Zig 0.13.0 succeeds. ZIP integrity and all 901 manifest hashes
  verified, including the exact executable, aerial record and SLAT catalogue. Stored shaders remain 18/33/15.
  `Binaries/FrontierSceneViewport-Windows-x64.zip`, 23,781,967 bytes; SHA-256
  `a89cd05cdac3d28e55ed5e4b9783a24b71bb663a94511e3b7d633cd8e57e75df`.
  Built from the imported tip plus working-tree edits; `Package.json` states that explicitly.
- **Still pending:** exhaustive 1:1 visual acceptance across tabs and widths; Windows interaction and hardware GPU
  validation. Captures are genuine C++ draw output, not a pixel-parity certificate. Package is unsigned and not
  antivirus-scanned. Renderer extensions and Jolt were not undertaken.
- **Evidence/reproduction:** [EnvironmentInspectors](../Exhibits/EnvironmentInspectors/README.md), including native
  images, source/native comparisons, source/image manifests, and the retained verification report.


## Functional baking, atmospheric fields and local media (2026-11-02, arena/8b705b7d-frontier)

- **Requested:** publish the existing Windows ZIP and preserve the UI work first; then real baking and baked-result
  inspection, Force Field/Wind separation and world vectors, local cloud/fog rendering, wind/noise/shape verification,
  and adjustable march samples/resolution. This explicitly extends the earlier UI-only renderer boundary for these areas.
- **Preserved before new code:** `e4c9e57b607dbc73d44967e3fe5f2a698865dff1` pushed to the session branch; direct GitHub
  binary URL supplied. The pre-existing untracked file `-` was not included or modified.
- **Additional reference:** `streamlinkinbox/Frontier`, `arena/08e7de48-frontier`, pinned
  `7bc60250e153a9b7d70c9740744723fde19fae22`. Its C++ height-fog/cloud equations and retained local-fog prototype inspected.
- **Reproduced before renderer edits:** `LocalMediaValidation --baseline`, real native Vulkan on SwiftShader.
  Fog wind reversal produces zero image difference; zero velocity still drifts (mean RGB difference 0.00092608).
  Heterogeneity already changes radiance (0.000686922). The GPU fog shader uses a hard-coded drift vector.
  Atmosphere's Bake button ignores its return, and viewport snapshots omit the local cloud/fog records.
- **Implemented and verified:** native local cloud/fog collection and rendering; integrated receiver displacement;
  field-driven wind, four bounded shapes, falloff, heterogeneity, self-shadowing, real ray-sample budgets and reduced
  cloud trace resolution. Added Force Field parent/inspector and world-space velocity vectors; Wind stays separate.
  Atmosphere Bake now dispatches real GPU tables, exposes readbacks and their input settings, freezes/rebakes the
  selected snapshot, and saves baked coefficients with the level. Added explicit local-medium creation registrations.
- **Acceptance:** native Vulkan local-media exhibit passes; reversal affects fog/clouds, zero velocity is stationary,
  64 samples converge better than 32 against 128, and 25% cloud resolution dispatches 64 × 40 for a 256 × 160 view.
  Real Everest/GPU baking/receiver/vector integration: **78 checks passed**. Native inspector interaction regression:
  **327 assertions, zero failures**. Editor and Shipping regressions pass (30-record default level, 33 page captures).
  Solar occlusion, all existing force triggers, camera flight and stored shader archive regressions pass.
- **Windows:** Release x64 cross-build succeeds; interactive Windows/hardware-GPU validation remains unrun.
  Baking persists coefficients and regenerates GPU textures on reload; it is not an offline cubemap export.
  Vectors are labelled X-ray velocities in m/s, not Newton forces. No vegetation consumer or new per-source authoring
  interfaces are claimed. Artistic shadow controls that remain unsupported stay disabled.
- **Evidence:** [LocalMedia](../Exhibits/LocalMedia/README.md), with baseline failures, repaired native captures,
  editor screenshots, source/image manifests and reproduction commands. No GitHub Actions were run.

- **Published build:** `Binaries/FrontierSceneViewport-Windows-x64.zip`, built from clean source
  `c6816fae35461e6b0776aab035a5ffbe1fc64bf4`; 23,819,540 bytes. ZIP integrity, all 901 file hashes, the exact
  executable, current environment shaders and the 30-record level (Wind below Force Field) verified.
  SHA-256 `9dd54698cfc9137c8ab1805274fd8e7a08e31d9df9a69bafbf825da99c9aee97`. Windows execution, signing and antivirus checks remain unrun.


## Celestial parameters and workspace simplification (2026-11-02, arena/8b705b7d-frontier)

- **Requested:** live Moon/planet parameters; separate interactive planet instruments and previews; remove unused
  Outliner demonstrations, branding and scene notch; remove distance-slice/reassemble/particle-launch chrome;
  fullscreen V, selected-target orbit/chase, axis and space cameras; independent panel headers/footers.
- **Implemented and verified:** four Moon slots now feed the native atlas, phase/orientation/size/
  brightness/glow and primary moonlight; planets use authoring descriptors shared with native surface previews.
  Venus, Jupiter, Mars and Saturn have different interactive instruments. Find in sky / Place in view actions added.
  Camera dropdown, fullscreen viewport and local panel footers replace the prior placeholder/combined chrome.
  Distance-slice shader, UI path and present descriptor dependency removed. Unrendered default demonstrations moved
  to an explicit exhibit fixture; 20 persisted settings/scene records, 15 scene entries shown in Outliner.
- **Acceptance:** 102 native celestial GPU checks; 95 real workspace/camera checks; 337 inspector assertions, all
  passing. Local media, solar occlusion, existing force triggers, camera flight, editor and Shipping regressions pass.
  Space-view ray coordinates now use float32 visibility storage; 150 km camera positions remain finite.
  Genuine native captures show all four planets, lunar parameter changes, fullscreen, panel footers and space flight.
- **Windows:** Release x64 cross-build passes. Interactive Windows/hardware-GPU validation remains unrun; final archive
  metadata is retained beside the exhibit. No GitHub Actions were run.
- **Evidence:** `Exhibits/CelestialWorkspace/`; fixed-axis views are perspective views; Space is wide-range flight,
  not a new solar-system dynamics simulation. Renderer settings remain available from Control Centre Quick Controls.

- **Published Windows package:** built from clean source `c6e31f68e250d4dfa8f6205b12fdb98acc8c46d6`;
  `Binaries/FrontierSceneViewport-Windows-x64.zip`, 23,828,892 bytes. All 901 file hashes,
  exact executable, current Environment/GlobalIllumination shaders and cleaned 20-record level verified.
  SHA-256 `9bd6b57e03af13cfdb946e125e98db380a75ca2a0b446013d8ef84231e4d1db8`. Windows interactive execution/signing/antivirus checks remain unrun.

## Virtualized geometry report and the fast preview question (2026-11-02, arena/88b72faa-frontier)

- **Requested:** compare the Nanite-like feature of the VehicleHMI demo, `5ec53579` and this branch ("cluster
  refinement"), say which is better and whether it can be improved, report first; explain how to enable the "Fast
  Blinn" render with the simple sky.
- **Branch:** `arena/88b72faa-frontier` fast-forwarded to the owner's `arena/8b705b7d-frontier` `650e631` (six commits,
  no divergence).
- **Findings:** the demo's `VirtualizedGeometry` (`6afb6f0`) is the only complete pipeline: build, GPU cut and cull,
  two-phase Hi-Z, visibility raster, resolve, streaming and debug views. `5ec53579`'s `ClusterNesting` and
  `VisibilityCull` are byte-identical in this branch and carry no simplified levels. The branch's C++
  `ScreenSpaceClusterRefinement` / `QuadricTierBuild` / `FacetTierBuild` (from `2d55bd2`) is a CPU-only partial port
  used only by `Exhibits/ClusterDiagnostic`. Render settings' Buffer index 6 and 10–14 read an inspection target that
  nothing writes.
- **Measured** (`Exhibits/VirtualizedGeometry/`, same corpus for both builders): the demo's per-cluster errors give a
  crack-free cut at all 48 thresholds, the C++ errors double-cover at 30. The demo keeps authored creases and UV seams
  while simplifying (vessel 2976 → 92); the C++ build drops authored creases after the leaf tier and pins seams
  (→ 236). Terrain at 4096 triangles: 0.06 % vs 1.03 % Hausdorff. The C++ build is 7–14× faster, and its coarse
  terrain is better (2.4 % vs 9.3 %). The demo's 22 unit tests pass under Node.js 22.
- **Recommendation:** port the demo 1:1 in six steps (build, CPU runtime, GPU, inspection views, streaming, parity
  exhibit), then measured improvements (indirect-count draws, import-time build, tighter error, terrain needles,
  class borders). Owner decisions are listed in `Documentation/Plans/Ongoing/VirtualizedGeometry.md` §5.3.
- **Fast Blinn:** no such switch exists in this branch, `5ec53579` or the demo. `BlinnRenderer` (CPU) lives in
  egoistm1inbox `9ce908bc` and is only called by a validation suite; `PreviewRaster` (gradient sky, GGX) runs only in
  `Exhibits/ClusterDiagnostic`. Proposed as a small Editor/Development-only viewport renderer.

## Virtualized geometry port, improvements I1–I5, analytic illumination (2026-11-02, arena/88b72faa-frontier)

- **Requested:** the demo's virtualized geometry ported 1:1 into a `VirtualizedGeometry` folder, then the five
  improvements each measured before and after, and the fast Blinn preview under a technical name. No controls yet.
- **Port** (`Frontier/Engine/Rendering/VirtualizedGeometry/`, `Shaders/VirtualizedGeometry/`): builder, CPU runtime,
  visibility resolve, GPU host and 6 Slang units. Parity: 10 surfaces bit-exact (`NestingParityValidation`), the
  demo's 22 tests (`VirtualizedGeometryValidation`), and the takeover in the editor's viewport with every page resident
  after 4 refreshes and a mean difference of 0.013–0.017 against the lossless clusters. Buffer index 10–14 show real
  cluster data.
- **Improvements:** I1 6452 → 10 indirect calls and 0.631 → 0.003 ms recording per refresh, same clusters drawn. I2
  builds at import, a 1.25 MB `.nestingspace` loaded in 2.9 ms. I3's claimed error equals the measured one at the
  coarsest tier (demo 9–15×). I4 takes the cliff's coarsest needles 217 → 0 (9.38 → 1.43 %); I5 takes the glass
  sphere's coarsest level 20.8 → 3.06 %.
- **AnalyticIllumination** (`Frontier/Engine/Rendering/AnalyticIllumination/`): sun shadow map, Lambert and
  Blinn-Phong, hemisphere fill and gradient sky from the level's Sun. On SwiftShader it refreshes in 0.065 s against
  the GI's 9.534 s. Selected by the levelspace key `analytic_illumination`, Editor/Development only.
- **Findings** (`Documentation/Plans/Ongoing/VirtualizedGeometry.md` §8): the refined archive holds 1613 records
  against the demo nesting's 650, because adjacency-only grouping keeps about 142 disconnected props apart. The demo's
  cull uses a single-level Hi-Z. The `drawIndirectCount` path is unexercised on SwiftShader, which lacks it.
- **Commits:** `7b06560 af1e898 c2afd72 3970b6a 8dddb3c d39bf03 c7d7f8c 1d5f1d7` and this documentation commit.
- **Published Windows package:** built from clean source `fac38ac`; `Binaries/FrontierSceneViewport-Windows-x64.zip`,
  24,432,620 bytes, 921 files, five shader sets verified (AnalyticIllumination and VirtualizedGeometry included),
  `ProvingGround.nestingspace` staged. SHA-256 `bf58bb9ad500d5abaefc03eac16c786b835fe691d3ed1b8a1d678300e766f17c`.
  Unsigned and never launched on Windows here.

## Ray-traced reflections and sun shadows: sources, options, measurements (2026-11-02, arena/88b72faa-frontier)

- **Requested:** find where the RTX reflections' fireflies come from, why the reflection blur ruins them, and why the
  ray-traced sun shadows' edges are noisy while GTX's are clean; test options without hurting performance and report.
- **Sources found:** the sun counted twice (highlight toward the shadow ray's jittered direction with a 393,000 GGX
  peak, plus the solar disc at 2,500× in reflection rays, clamped at 200). The filters-off grain comes from both
  signals (diffuse ×2.9, specular ×2.1). The blur is a half-resolution trace, three à-trous iterations with
  receiver-only edge stops, and surface-motion reprojection. The shadows: one jittered ray per pixel and refresh,
  averaged only by TAA; GTX uses raster cascades with 3×3 PCF, not the distance field.
- **Options** (`RefreshToggles::Refinements`, levelspace keys `solar_disc`, `stratified_sun`, `penumbra_filter`,
  `mirror_filter`, `mirror_trace`, all off = the demo; direct radiance bit-identical to the demo's shader with mask 0).
- **Measured** (`Exhibits/RayTracedLighting/`, converged references): SolarDisc cuts the sun glint's visible errors
  572 → 56 for free. PenumbraFilter (half radius) cuts visible shadow errors 928 → 615 and 903 → 673 and flicker by
  30 % for 34–37 ms. MirrorFilter takes 41 % off the pane's error for 13 ms. MirrorTrace halves it for 561 ms. The
  cascades are the least accurate.
- **Found:** with indirect GI off, the RTX reflections vanish (the glossy filter's guide comes from the ReSTIR step);
  not fixed, reported.
- **New engine parts:** `PenumbraResolve.slang`, the `TraverseMirrorReflection` entry,
  `DeviceExchange::SubmissionTiming`, `SceneViewport::ToggleAdjustment`, the `Refinements` word (refresh scalar 112,
  formerly unused).
- **Published Windows package:** built from `c384f66`; `Binaries/FrontierSceneViewport-Windows-x64.zip`, 24,495,031
  bytes, 923 files, SHA-256 `0fa5f5f909ae823836c3089d4576028c09d97a21078ae9b2a9c51068492d453a`. The refinements are
  off in the shipped level (levelspace keys above). Unsigned and never launched on Windows here.

## Render settings inspector prototype; star twinkle (2026-11-03, arena/88b72faa-frontier)

- **Requested:** the stars must twinkle and follow their controls. The RTX reflections trace at half resolution, so the
  resolution and rays per pixel need controls. Before the C++ UI, an HTML version of the Render settings: every render
  setting of the VehicleHMI demo as one outliner component with one inspector, after the dashboard reference image and
  the Frontier Editor's Sun, Moon, material and fracture inspectors.
- **Prototype:** `Experimental/RenderSettingsInspector/`. One Render settings component replaces five records
  (Diagnostics, Geometry clusters, BVH & distance field, Surface cache). Its inspector has renderer tabs (RTX, GTX,
  Analytic), a GPU-time card (estimated; measured in C++), viewport scale, trace resolution (Full / Half / Quarter),
  paths per pixel and the quality grade, then GI, reflections, sun and shadows with the measured refinements, denoising
  by wavelet levels, exposure, geometry, the distance-field cascades, the fifteen debug views, refresh timing and the
  levelspace entry. Colours are the C++ `InspectorPalette`; the faces are DM Sans and JetBrains Mono. Awaiting the
  owner's approval before the C++ step.
- **Debug views captured** from the C++ viewport (`Exhibits/SceneViewport/Images/Inspection/`, `InspectionViewCapture`).
  View 6 (BVH / distance field) is black: the demo's `InspectionMarch` was never ported. Views 10 and 11 show the
  demo's own "no virtualized geometry" diagnosis until virtualized geometry is on; with it on
  (`Inspection-10..14-Virtualized.jpg`) they show the ground's cluster IDs and its deferred resolve.
- **Also found:** `BloomIntensity`, `AcesFilmicTonemap`, `ScreenSpaceReflections` and `InspectionDistanceMode` have no
  reader in the renderer, and the viewport forwards only part of the settings today.
- **Stars:** the overlaid sky's twinkle was too weak to see (±5.5 % at the zenith by default). The port's own night sky
  took only the star switch from the Stars record. Now one equation serves the sky, its CPU twin and the Stars page
  chart. Twinkle depth is the zenith's peak swing, deepened toward the horizon, and a CPU twinkle clock follows the
  rate. The port's night sky takes every star field from the record. On screen (`StarScintillationCapture`, 223 stars,
  antialiased) the default's brightness variation rose from 4.0 % to 23.9 %; depth 0.10 gives 7.5 % and depth 1.00
  gives 70.5 % (10.2 % before), against 1.2 % with the twinkle off.
- **Validated:** `CelestialRenderValidation`, `LocalMediaValidation` and `EnvironmentRealmValidation` pass after the
  twinkle change (SwiftShader, 406 s); the shader archives verify with 0 failures.
- **Windows binary:** `Binaries/FrontierSceneViewport-Windows-x64.zip` rebuilt at `48a8380` with the twinkle (Zig 0.13.0
  cross-toolchain, material archives omitted): 24,495,349 bytes, 923 files, SHA-256
  `58f2eed74ccd9429d81eecced6cd0d9601d022551a897804f293a43e92fb9d53`. Against the `c384f66` package only `Frontier.exe`,
  the twinkle shader `RasterizePlanetaryProjection.spv`, its compilation manifest and `Package.json` differ.
- **Commits:** `419441d f780988 2b0cf13 ab96e56 9955237 0c59f28 4573642 1c6eda4 48a8380` and this binary commit.

## Render settings inspector in C++; analytic illumination as a debug view; reflections with GI off (2026-11-03)

- **Requested:** add the approved Render settings inspector to the C++ editor; add the fast analytic renderer as a debug
  view; fix the RTX reflections that vanish with indirect GI off. Whether the four measured RTX options should be on by
  default is still open: they stay off (the demo), and the page applies them with one action.
- **One component, one page:** the `RenderPipeline` record "Render settings" heads the Outliner under Rendering and
  cannot be removed. Its page (`Interface/Inspectors/RenderSettingsInspector`, nine sections under
  `RenderSettings/`, one file each) has the renderer tabs, a measured timing card with its chart, the readouts, and the
  sections Sampling, Lighting, Reflections, Shadows, Denoise, Exposure, Geometry, Views and Timing. Two reusable
  controls were added, `ChoiceRow` and `ChoiceList`, and `MetricTiles` can light no tile.
- **Every setting reaches the renderer:** `RenderPipelineConfiguration` carries the demo's toggles, host settings and
  both variance filters (levelspace keys as the prototype proposed). `ViewportRendering` forwards them. Trace
  resolution and viewport scale rebuild the screen targets. Defaults equal the demo, so the capture tools render as
  before.
- **Absorbed:** the Diagnostics, DistanceField, SurfaceCards and PolygonClusters records, their pages and the mock
  `PolygonClusterEditor` are gone; none of their values reached the renderer. Older levels load without them. Bloom,
  filmic-tonemap, screen-space-reflection and probe-range keys had no reader and are ignored.
- **Analytic illumination as a debug view:** view 15 in Render settings › Debug views and in the new debug-view select
  on the viewport bar. The status line and readout name it.
- **Reflections with indirect GI off:** the glossy filter's guide came only from the ReSTIR temporal step. The new
  guide-only entry `ReservoirTemporal` `ProjectResamplingGuide` runs when the resampling does not (the resampling's
  SPIR-V is byte-identical). Before and after: `Exhibits/SceneViewport/Images/ReflectionsIndirectOff.jpg`.
- **View 6 ported:** the demo's `InspectionMarch` (`InspectionMarch.slang`, `DisplayProjection::RecordInspection`).
  It reads the BVH on RTX and the distance-field cascades on GTX (`Images/Inspection/Inspection-06*.jpg`).
- **Timing is measured:** each refresh's wall time from first submission to fence. The page shows the latest,
  smoothed, median and slowest of the last 96; there is no per-stage breakdown without staged submissions.
- **Not ported (no renderer switch):** GPU cluster culling on/off, triangles per leaf, the cluster bounds overlay,
  freezing the field and the slice inset.
- **Validated (SwiftShader host):** 19 ctest validations pass. Interface and level loading: ControlCentre, ProjectSpace,
  Interface, EverestInterface, EverestShipping, ProjectContentStaging. Workspace: CelestialWorkspace (16 Outliner rows,
  exactly one Render settings), SceneMedia, EnvironmentInspector. Rendering: CelestialRender, LocalMedia,
  EnvironmentRealm, SolarOcclusion, ForceFieldTrigger, ClusterDiagnostic, NestingParity, VirtualizedGeometry,
  SceneViewportFlight, StoredShaderArchive. The record counts the level tests assert dropped by the four absorbed
  records (20 to 16, 30 to 26). On SwiftShader a global-illumination refresh of the workspace takes about 55 s and an
  analytic one 0.2 s (`Exhibits/SceneViewport/Images/RenderSettings/`).
- **Windows binary:** `Binaries/FrontierSceneViewport-Windows-x64.zip` rebuilt at `c6210cb` (Zig 0.13.0, material
  archives omitted): 24,564,458 bytes, 925 files, SHA-256
  `d6858397990f8a0dee980a6032a57823bcb2d9ef0d314e8e4143d55ff82cda19`. Against the `df045f1` package: the two new
  SPIR-V entries, the shader manifest, `Frontier.exe`, `Package.json` and `Default.levelspace`.
- **Commits:** `a051e6a 5c7c625 19bb3be 21f1b5a b5d2f3a 3143712 6640104 c6210cb` and this binary commit.

## Scene objects with the Project Zero object inspector and a Blender-style modifier stack (2026-11-03)

- **Requested:** the four measured RTX options stay off ("leave it"). Add the scene's other objects, give them the
  Project Zero editor's object inspector, and make each repeated set one array with a modifier stack like Blender's.
- **Source of the inspector:** SultanAladin/Frontier- `Experimental/ProjectZeroEditor` (branch
  `arena/10e50e56-frontier`, `0c2214c9`), the geometry page of `Inspectors.jsx` with `TransformPanel`, the quick
  controls, the compact `MaterialPanel` and `FracturePanel`; it was captured in headless Chromium for reference.
- **Scene objects:** 37 `Geometry` records in `Projects/Everest/Content/Levels/Default.levelspace`, in eight Outliner
  groups, cover all 504 static occupants of the scene archive once (the vehicle, the fragment and stress pools and the
  ground tiles stay out). Repeated sets are one object each: 26 objects carry 32 Array modifiers (five stack two or
  three) whose stacks reproduce the demo's placements (radial rings, stacked arrays for the moose and parking cones,
  turned crates); multi-shape fixtures (street lamps, tunnel, control tower) are one object with parts.
- **Inspector:** `Interface/Inspectors/GeometryInspector` with one class per card in `Inspectors/Geometry/` (transform,
  quick controls, modifier stack, material, fracture). New reusable controls: `RecordHeading`, `TransformTable`,
  `QuickTiles`, `ModifierPanel`, `ChannelRows`, `CardTitleRow`, `NotesField`; a Project Zero theme
  (`ControlTheme::ResolveGeometry`) and 13 glyphs. Selecting an object makes it the camera's subject.
- **Renderer:** `Scene/GeometryLayout` evaluates the transform and the modifier stack; `EverestSceneGeometry` binds the
  records by occupant name and resolves placements; `GlobalIllumination/OccupantRelocation` (beyond the demo) applies
  them: profiles with one refresh of motion, draw runs and card tiles on visibility changes, distance-field
  invalidation over old and new bounds, priority card relighting, lamps that follow (and switch off with) their heads.
  The default level keeps the archive's transforms bit for bit.
- **Validated:** `SceneGeometryValidation` (new ctest, 13 checks, no device): binding and coverage, exact default
  placements, count, step, move, radial turn, hide, an Array beyond the archive, the level file round trip, the
  placement algebra. `SceneGeometryCapture` renders the workspace, six inspector pages and the viewport before and
  after four edits through the records (`Exhibits/SceneViewport/Images/Geometry/`): the tower moved 9 m and turned
  30°, the burnout tyre wall re-laid as Array 8 at 1.6 m, the tunnel Array 8 → 4 and the street lamps hidden change
  16.3 % of the global-illumination viewport's pixels (mean |Δ| 9.3 levels), 15.0 % with the analytic illumination.
- **All 20 ctest validations pass** (SwiftShader host): the 19 of the previous entry plus `SceneGeometryValidation`.
  The level tests now count 53 records (16 + 37) and CelestialWorkspace 53 Outliner rows.
- **Limits:** copies are limited to the archive's occupants per object; Dynamic, Cast shadows, GI and Physics are
  authored flags (no per-object renderer switch yet, physics later); materials are read-only (shared families);
  geometry objects are not added or removed in the editor.
- **Windows binary:** `Binaries/FrontierSceneViewport-Windows-x64.zip` rebuilt at `b822b26` (Zig 0.13.0, material
  archives omitted): 24,618,034 bytes, 925 files, SHA-256
  `e26511b8abde5e17e81aeed4ca2a527102243dc2ff465c4759be030d98ce46dd`. Against the `c22acd8` package: `Frontier.exe`,
  `Package.json`, `Default.levelspace` (53 records, 37 of them `Geometry`) and `README.md` (a Scene objects section).
- **Commits:** `0ef104c 0ae82b1 99c0f6c 16163aa 9b9be69 b822b26` and this binary commit.

## Adding, moving and removing scene objects; engine shapes with baked distance fields (2026-11-03)

- **Requested:** fix the limits of the previous entry; port the Project Zero editor's tools (its Construct menu for
  primitives); move, add and delete objects; engine shapes as `.toml` files in the content folder with their distance
  fields baked. Fracture stays a no-op and the physics (Jolt) is not added yet.
- **Engine shapes:** `EngineContent/ShapeArchives/{Cube,Sphere,Cylinder,Cone,Torus,Plane}.toml` (primitive, size,
  tessellation, surface, card density) with baked `.sdfspace` volumes (exact distance, winding-number sign, 3.125 cm
  voxels). `Engine/Geometry/ShapeArchive` reads and tessellates them; `ShapeArchiveBake` bakes them and its `check`
  (ctest `ShapeArchiveBakeValidation`) compares a fresh bake within the float16 rounding.
- **Renderer:** the stress-test pool becomes a reserve of 512 occupants that copies and constructed objects take (a
  reserve occupant takes its template's facet set, cards, BLAS root and profile); the shapes join as facet sets with
  their volumes in the distance atlas. Per-object Dynamic, Cast shadows (`ShadowExempt`) and GI (`IndirectExempt`)
  reach the shadow runs, shadow rays, analytic solar depth, distance union and traced rays. Objects get material blocks
  of their own (96 after the family table). The distance union bounds a scaled copy's distance (Gershgorin), exact
  for uniform scale. The occupant profile now carries a block override unchanged (it was dropped as negative).
- **Editor:** the Construct dialog (`Interface/ConstructPanel`, Ctrl+A or the Outliner's +); the Outliner row menu
  (Rename with inline editing, Hide / Show, Fracture as a no-op, Duplicate, Remove) and the keys F2, Ctrl+D and Del;
  picking in the viewport; W / E / R transform handles (`Interface/Controls/PlacementGizmo`, Ctrl snaps, Esc
  undoes); editable material channels (copy on write into the object's block); the quick controls' captions and the
  modifier stack's reserve figures.
- **Validated:** `SceneGeometryValidation` 25 checks (12 new: the six baked shapes, the reserve with exact default
  placements, an Array past the archive's copies, a constructed cube, a duplicate, the switches, a material block and
  its profile word, removal, exhaustion and return, the distance scale bound). `SceneGeometryCapture` renders the
  edits (tower moved, turned and shadowless, tyre wall re-laid, tunnel 8 → 12 with 4 from the reserve, lamps hidden,
  jump ramp removed, tower duplicated, a red 3 m cube, a sphere and a torus constructed): 17.1 % of the RTX
  global-illumination viewport changes, 17.4 % on the GTX distance-field path and 16.4 % with the analytic
  illumination. The capture also renders the Construct dialog and the cube's move handles.
- **Virtualized geometry checked:** with it on, the edits render alike (17.4 %). The check found that a change of the
  draw runs rebuilt the takeover and its two-pages-per-refresh streaming left the ground garbled for several refreshes
  (30.4 % changed after two); every page now streams in the refresh after a run-time rebuild (beyond the demo).
- **All 21 ctest validations pass** (SwiftShader host): the 20 of the previous entry plus `ShapeArchiveBakeValidation`.
  The eight that link the inspector passed again after the polish below.
- **Limits:** Fracture is a menu entry without an action and Physics an authored flag (Jolt later), as asked. The
  reserve holds 512 occupants and the material blocks number 96. Picking meets the parts' bounding boxes, not their
  triangles. There is no undo stack: Esc cancels a drag, and a removal stands until the level is reopened unsaved
  (Ctrl+S saves). The speed on a GPU is not measured here (SwiftShader only).
- **Material card polish (after the first package):** the channel list now names a colour the way the colour control
  under it does (the demo's channel^(1/2.2); the base colour read `#CE3F38` above and `#CD4138` below). Reflectance's
  note names the shaders' specular level, the dielectric F0 (0.04 is 4 %); it said 0.5. The captions read for a family
  no other object uses and name an engine shape's surface; the Fracture card has a note for engine shapes. The eight
  inspector pages were captured again.
- **Windows binary:** `Binaries/FrontierSceneViewport-Windows-x64.zip` rebuilt at `563c18b` (Zig 0.13.0 with Clang
  18.1.6, material archives omitted): 24,856,394 bytes, 937 files, SHA-256
  `62b438b263d8fc40cdf18f649de34c471556257bde4060c2c33b9376ee99d997`. Against the `b822b26` package: the twelve
  `EngineContent/ShapeArchives` files (six `.toml`, six `.sdfspace`), `Frontier.exe`, `Package.json`, `README.md`, nine
  global-illumination shaders, one analytic shader and three shader manifests, each identical to the stored archives.
  It replaces the package committed in `42386e7` (built at `28e7e41`, before the polish).
- **Commits:** `92569e2 35cb1fc ca2cdd6 a2c33e6 62e765d 796c95d 28e7e41 42386e7 563c18b` and this binary commit.

## SolidArc integrated (SolidArc only); GPU picking (2026-11-03)

- **Requested:** integrate SolidArc from Slate `arena/4f335fa8-slate`, merging only SolidArc and none of the rest; it
  reuses Frontier's interface components (sliders, toggles, controls, docking). Replace the bounding-box picking with
  GPU picking.
- **SolidArc:** Slate's `SolidArcOnly.patch`, prepared for this branch at `e72d319`, applied with a three-way merge:
  498 paths (484 new, 14 changed), identical to Slate's package except the merged `FolderStructure.md` and this file.
  The CAD document, interface, viewport, browser connection and shaders live in `UI/SolidArc/`, the geometry kernel
  in `Engine/GeometryProcessing/`, the executable in `Experimental/SolidArc/Native/` (`SolidArcWorkspace`, CMake
  option `FRONTIER_BUILD_SOLIDARC`, on by default), the checks in `Exhibits/SolidArc/` and
  `Exhibits/GeometryProcessing/`, the icons in `EngineContent/Icons/SolidArc/`. It reuses `ControlKit`,
  `PanelDockspace`, `VectorAuthoringControls`, `PanelChrome`, `IconPresentation` and the new
  `FrontierAuthoringControls` library. The Project Browser opens `.solidarc` documents in it (*Open in SolidArc*,
  thumbnails, live previews). Slate's framework, applications, vehicles and binaries are not included. The CAD code
  keeps its 484 inherited names (`SolidArcFrame.cpp` and the like), as Slate's package does. New dependency: volk
  (pinned in `UIDependencies.json`).
- **SolidArc test fixes:** `SolidArcDocumentValidation` looked for the icons relative to the working directory, and
  ctest runs it from the build folder (0 icons found); the build now names the folder (`SOLIDARC_ICON_FOLDER`).
  `SolidArcBrowserValidation` read the build's Surface shaders, which a build without a Slang compiler does not have;
  it now reads the stored set there, as the editor does.
- **GPU picking:** a click sends a serial and the stage point with the next viewport request. Before the refresh,
  the viewport rasterises the scene's draw runs again from the last image's camera into a 9 × 9 occupant target
  about the clicked pixel (`PickProjection`, `PickRaster.slang`, reverse depth). The occupant's Geometry record is
  selected; where the pixel shows the sky or nothing a record owns, the nearest record within 4 px is selected. The
  bounding-box code is removed. Measured on SwiftShader (`SceneViewportPickValidation`, 10 checks): 1,507 of 1,507
  decided pixels in three views equal a CPU triangle cast (5 of 1,512 lie on outlines or coplanar overlaps); bounding
  boxes named another record at 0.6 % of the views' pixels and took a click in a torus's hole; a pick costs 9–14 ms
  on SwiftShader. `SceneGeometryValidation` has 27 checks (2 new).
- **Validated (SwiftShader host):** all 82 ctest validations outside the SolidArc walkthroughs pass, the new
  `SceneViewportPickValidation` and the five SolidArc suites among them: `SolidArcDocumentValidation` (all rows
  green, 151 s), `SolidArcViewportValidation` (31.5 s), `SolidArcBrowserValidation` (15 of 15, including the hand-off
  to the workspace process), `FrontierSolidArcBrowserIntegrationValidation` and `SolidArcCurveWorkflowValidation`.
- **SolidArc walkthroughs** (`ctest -R Walkthrough`: 51 scripts that drive the real interface through
  `SolidArcCapture`; not part of Slate's evidence): 40 pass on SwiftShader (the full run took 2,303 s). Twelve scripts
  were brought up to date without changing any of their checks. The Drawing options panel, shown by default while a
  drawing tool is active, covered viewport points that eleven of them click, so they hide it first
  (`click @DrawingOptions`). The orientation-cube check clicked the top face at 12° of elevation, where the perspective
  cube hides it, so `WorkspaceWalkthrough` orbits up first. The picture the Fill walkthrough places as an image plane
  was missing from Slate's package; a capture of the empty workspace stands in
  (`Exhibits/SolidArc/Images/HtmlReference/EmptyWorkspace.png`), and its crop and opacity clicks name the authoring
  sliders' tracks. Eleven still fail where SolidArc's behaviour changed after they were written, and they are left
  as they are: Delete refuses without a selected component (Shortcut, Delete); *Snap to curves* is on by default
  (AltSlide, CurveFlow, Snapping); the knife's insert library differs (Knife); a second line joins the first sketch
  (LinkedConstraints, RevolveSweep); a loft lift snaps to 0.8 rather than 0.7 (Gizmo); a bevel reaches 1.003 rather
  than staying under 1 (BevelReach); a cut leaves one body rather than two (NurbsBlend). The SolidArc interface code
  and every Frontier file it uses are unchanged from Slate's package and its base `e72d319`, so these failures are
  Slate's own.
- **Windows binary:** `Binaries/FrontierSceneViewport-Windows-x64.zip`, 31,236,290 bytes, 1,075 files, SHA-256
  `dabc0d31b7b1fe0c4473d29635c3d8b238d6717be35093e40b9a121d32a7424f`, packaged at `c6acc97` (Frontier.exe built at
  `b5a350e`). Against the `7eef1a7` package (937 files) it adds `SolidArcWorkspace.exe` (9,260,544 bytes) with
  `SolidArcWorkspace.toml`, the curve sample and the volk notice, the 66 SolidArc icons (in `EngineContent/` and in
  the project's staged copy) and the two `PickRaster` SPIR-V files (Global Illumination set 37 → 39). The first
  SolidArc Windows build stopped at `SolidArcWorkspace.rc`: the Zig cross-toolchain has no resource compiler, so the
  version resource is now compiled with MSVC only, as Frontier's own is (`b5a350e`). The package README describes
  GPU picking and how to open SolidArc.
- **Limits:** Slate never compiled or ran SolidArc on Windows, and it is not run on Windows here either (the package
  is cross-built). The pick's cost on a GPU is not measured here.
- **Commits:** `4a6b6b7 877aa3c 2731a28 ed14b22 9149cd6 b5a350e c25e20f c6acc97` and the commit with this entry.

## Each file opens in its own application; SolidArc opens a bare path (2026-11-03)

- **Requested:** SolidArc (modelling), the Texture Workspace (texturing and baking) and the game engine are all
  reached through the Frontier Project Browser; the owner chose "New dialog + open by file type". Opening a
  `.solidarc` through Windows *Open with* → `SolidArcWorkspace.exe` always showed an empty document unless it was
  started from a `.bat` file: fix that, and make it load through the Project Browser. The browser need not open the
  Texture Workspace for now, but add it for completeness.
- **Why the document was empty:** SolidArcWorkspace read only `--options`, `--open`, `--curves` and `--specimen`.
  Windows starts the program chosen in *Open with* (or associated with the extension, or given a file dropped on its
  icon) as `SolidArcWorkspace.exe "<file>"`, so the path arrived as a bare word and was ignored; the `.bat` file
  passed `--open`. `ResolveSolidArcLaunch` (`UI/SolidArc/Interface/SolidArcLaunch.h`) now takes the first bare word
  as the document. An explicit `--open` wins, and switches are never taken as the document. A document that cannot
  be read now says why in the status line (`Open refused: …`) instead of looking like an empty one.
- **New dialog:** the library's first card is **New** (game project, SolidArc model or texture library). A segmented
  choice switches the dialog's title, fields, Browse and button:
  - **Game project:** Blank Project as before; the new project then opens in the editor at once.
  - **SolidArc model:** an empty `.solidarc` written by SolidArc's own codec (`CreateSolidArcBrowserDocument`). It is
    attached to the library and opened in SolidArcWorkspace. An existing file is never replaced.
  - **Texture library:** the folder, created when missing, opens in `TextureWorkspace.exe --library <folder>`.

  `ProjectBrowserPanel::CreateDocument(BrowserCreation, Destination, Name)` is the same path for the checks. Browse
  uses a Save dialog for a model and a folder picker with *Make New Folder* for a library.
- **Open by file type:** the Windows open dialog offered only `.projectspace`, images and Markdown, so SolidArc models
  could not be picked in the browser. It now lists `.solidarc` too, with a filter per type and *All files*.
  `Frontier.exe <model>.solidarc`, or a model dropped on `Frontier.exe`, hands the model to SolidArcWorkspace without
  opening a window. The reader's *Open in Frontier* / *Open in SolidArc* already started the right program.
- **Empty models** preview as the reference stage with "0 bodies · 0 faces · 0 steps" and say "has no bodies yet",
  instead of "This SolidArc document could not be read: The document holds no solid bodies".
- **Dialog height:** the New dialog and the launch dialog were twice as tall as their content, because the extent
  item followed the last button. They now end below their buttons.
- **Texture Workspace:** it starts with an empty library when the preset archives are not installed (the ZIP leaves
  them out). Before, it stopped at start-up, iterating over the missing preset folder. The packager ships
  `TextureWorkspace.exe` beside `Frontier.exe` (`--texture-executable` overrides) and records it in `Package.json`.
- **Validated (host):** `ProjectBrowserValidation` (the New dialog's hand-offs with stand-in programs, 775 drawn
  states); `FrontierSolidArcBrowserIntegrationValidation` (32 checks, 17 new: SolidArc's real codec writes and reads
  the new model, and the workspace command line); `SolidArcBrowserValidation` (18 of 18 on SwiftShader, 3 new: New ›
  SolidArc model creates and previews the model, and the started workspace process opens it);
  `EverestInterfaceValidation`; `WindowsPackageValidation.py` (13 tests, 4 new). The captures are
  `Exhibits/ProjectBrowser/Images/New*.png`.
- **Windows binary:** `Binaries/FrontierSceneViewport-Windows-x64.zip`, 34,655,562 bytes, 1,076 files, SHA-256
  `35ee83e50b40d64d12a4d0518ec0ef3217a7c23f488a6b81746e384276d22f07`, built and packaged at `76e05ee`. Against the
  `56cf38d` package it adds `TextureWorkspace.exe` (7,670,272 bytes); the material presets stay out (96 MB).
- **Limits:** not run on Windows here. There is no installer, so `.solidarc` files are associated through *Open with
  → Always use this app*. TextureWorkspace reads `--library` from the narrow command line, so a library path with
  characters outside the Windows code page may not open.
- **Commits:** `76e05ee` and the commit with this entry.

## Force Field and Particle editor prototypes (2026-11-03)

- **Requested:** integrate the Force Field and Particle editors before the vehicle step, as HTML prototypes first,
  opened on a server. The Particle editor keeps its engine and preset library but gets the Render settings outliner
  and inspector design. The Force Field editor is redone: the Force Field is the master component and Wind its
  guest; the eos vector field is reused and extended to 100 m – 100 km; localized forces (attraction, repulsion and
  more) sit under it; both editors use the same visualization.
- **Source:** the two editors are in eos `arena/24b8f4ad-frontier` (`549c477`), not `arena/923866fc` (which holds the
  Fracture, Light and Photometric editors only).
- **Force Field editor** (`Experimental/ForceFieldEditor/`): outliner (Force Field → Wind → forces by contribution),
  Map and Oblique views with range pills, minimap of the 100 km extent, timeline with trigger lanes, Log Stream, and
  three inspector pages. Sixteen force types: the native `ForceSourceKind` flow set plus the eos Current, the eos
  accelerate fields and the drag volume, in the eos Flow / Accelerate / Damp taxonomy with reach, falloff, time
  windows and acts-on channels. The Wind is the native `PlanetaryWindProfile` opened with `Default.levelspace`'s
  record. Proposed: four field cascades (2 m – 1 km cells, 256 m – 131 km), a mesoscale variation, `ForceSource`
  records nested under `rec_force_field`.
- **Field visualization** (`Experimental/ForceFieldVisualization/`): one renderer, Map / Oblique / Camera; the eos
  colour stops and arrows; world-snapped power-of-two sampling with a level-of-detail filter; tracers, scale bar,
  legend, cascade overlay, minimap.
- **Particle editor** (`Experimental/ParticleEditor/`): the eos engine files unchanged (provenance and hashes in its
  README), eos `frame()` ported with Frontier names, a new outliner, inspector and 52-preset library sheet. The field
  overlay reads the GPU wind lattice back (73 728 B every 150 ms) and ports `fieldAccel`, so it shows what the
  particles feel; the eos 3D lattice arrows are off by default.
- **Shared controls:** `InspectorControls.js` gained refresher scopes, logarithmic m / km sliders, `TimeSeries`
  units, vector, colour, select, text, chip, action, plot and dial rows; the editors' chrome moved into
  `RenderSettingsInspector.css`. Render settings renders as before.
- **Validated:** `ForceFieldValidation.mjs` 33 of 33 (the Wind matches the native step sample at 400 points within
  1e-9 m/s; existing levelspace keys checked against `SceneWorld.cpp`); eos `CheckForceFields.mjs` 91 of 91;
  `PrototypeCaptures.mjs` 11 of 11 on headless Chromium with SwiftShader WebGPU, including the overlay's lattice
  copy equal to the engine's probe texel. Evidence: `Exhibits/ForceFieldEditor/`.
- **Rename candidates for the C++ step:** the native `VortexColumn` and `SphericalImpulseShell` (barred words
  *Vortex*, *Shell*) and the eos engine's `kind`, `system` and `emit` names.
- **Limits:** browser prototypes, not the C++ editor; captured on SwiftShader, not in a Windows browser. The C++
  integration follows the owner's review.
- **Commits:** `1ef6ea8`, `06a58e0`, `02b9af3` and the commit with this entry.

## Force Field editor in C++ (2026-11-04)

- **Requested:** after the prototypes, bring the Force Field and Particle editors into the C++ editor; both come
  before the vehicle step. This entry covers the Force Field editor, phases A to D of
  `Documentation/Plans/Ongoing/ForceFieldParticleIntegration.md`. The Particle editor is phase E.
- **Engine (A):** `ForceSourceCatalogue` ports the approved `ForceFieldCatalogue.js` line for line: 16 force types
  (9 flows, 6 accelerations, 1 damping), activation (Always, Window, Trigger), moving centres, reach masks with
  falloff, the radial profile, the cascade budget and the Beaufort scale. `ForceFieldSpace` runs the authored forces
  on the Force Field's timeline clock and reads any contribution (flow m/s, accelerate m/s², damp 1/s, one force
  alone) with detail by cell span from 100 m to 100 km, the mesoscale variation and divergence-free eddies.
  `ForceSourceKind` became `ForceSourceCategory` (TornadoColumn, GustFront, Microburst, GustPuff, VehicleWake,
  ThermalUpdraft, JetCorridor, BlastWave), so the barred *Vortex* and *Shell* are gone. `ForceSource` records sit
  under the Force Field with a snake_case levelspace codec; `Default.levelspace` holds the prototype's 14 forces.
- **Field view (B):** `Interface/ForceFieldVisualization/` is the slice renderer both editors use: Map, Oblique and
  Camera projections, an asynchronous lattice of at most 48,000 samples on world-snapped power-of-two cells, the
  turbo legend with a 98th-percentile scale, the eos arrows, tracers, source outlines, the cascade overlay and a
  72² minimap of the 100 km extent. The viewport bar's Scene · Field switch shows it, with one timeline lane per
  force. Over the scene it follows the viewport camera.
- **Pages and links (C):**
  - Force Field page: the peak in view with its history, forces by contribution and cost, quick switches, and View,
    Range, Forces, Receivers, Timeline, Vectors, Budget.
  - Wind page: the speed at 10 m now and over the last 12 s, compass, shear and veer, and Flow, Gusts, Altitude,
    Eddies (a wind-only vorticity preview), Mesoscale.
  - Force page: the radial profile, and Strength, Reach, Timing, Receivers.
  - The Outliner lists the forces under the Force Field. The Construct dialog has a Forces group with the 16 types; a
    new force lands in the middle of the Field view while it shows, otherwise where the camera looks.
  - Workspace actions (`select:`, `add-force`, `field-view:`, `field-span:`, `fire:`) connect the pages to the
    workspace. The Log Stream records the view switches, the contribution shown and each firing.
- **Validated (Linux host, SwiftShader):**

  | Check | Result |
  |---|---|
  | `ForceFieldCatalogueValidation` against the prototype | ✔️ 23 of 23; 1,781 samples, worst error 0 at 1e-9 |
  | `ForceFieldWorkspaceCapture` | ✔️ 22 captures and the Workspace stage, 535 s |
  | `EnvironmentInspectorValidation` | ✔️ |
  | The eight regression tests (`Exhibits/ForceFieldEditor/README.md`) | ✔️ 8 of 8 |

  `CelestialWorkspaceValidation` now expects 67 Outliner records: the 14 forces are listed.
- **Evidence:** `Exhibits/ForceFieldEditor/README.md` and nine `Images/Editor*.jpg`. The 6 km map samples 11,400
  cells of 32 m in 6.5 ms; the 100 km map 12,276 cells of 512 m in 7.4 ms; the oblique tornado 29,070 cells of 8 m
  in 18.2 ms (timeline at 18.25 s).
- **Windows binary:** `Binaries/FrontierSceneViewport-Windows-x64.zip`, 34,781,189 bytes, SHA-256
  `56d1a3fd154a3d2f0d1cd8452fcc02c492eaf94e1520244d8191389131e6f900`. Built with Zig 0.13.0 for x86_64-windows-gnu
  (`Automation/WindowsToolchain.cmake`) on the Linux host from the `fc32e34` sources. It was packaged at `fc78edc`,
  whose later commits change no compiled source. It holds `Frontier.exe`, `SolidArcWorkspace.exe`,
  `TextureWorkspace.exe` and the five shader sets, without the material archives. It is unsigned, not virus-scanned
  and not started on Windows.
- **Limits:** not run on Windows here. The GPU cloud synthesis still takes only triggered forces, so authored forces
  do not change the sky. The cascades are budgeted and drawn; the GPU lattice comes with the particles (phase E). The
  page's history fills only while the Field view shows.
- **Commits:** `2691cd8`, `440c481`, `f6f0deb`, `ddff77f`, `abe5ffa`, `dad9016`, `163cea1`, `de76fa4`, `fc32e34`,
  `3b0df56` (this entry) and the commit with the binary.

## Particle editor in C++ (2026-11-04)

- **Requested:** the second half of bringing the approved prototypes into the C++ editor before vehicles: the
  Particle editor, phase E of `Documentation/Plans/Ongoing/ForceFieldParticleIntegration.md`.
- **Engine (E1–E3):** the eos engine (`549c477`) in C++, Vulkan and Slang, its behaviour unchanged.
  - `EngineContent/ParticleArchives/ParticleLibrary.toml` holds the same 52 presets in 14 groups, exported from
    `presets.js`.
  - `PhysicalDynamics/ParticleDynamics/` holds the scene, the library decoder, the 12-type force taxonomy, the uniform
    packing and the lightning.
  - `Rendering/ParticleSimulation/ParticleSimulationSequence` runs the stores, the wind lattice, the simulation, the
    rasterizations, the light fibres and the lensing. `Shaders/ParticleSimulation/` holds 6 Slang files: 30 entries,
    stored as the sixth shader set.
- **Editor (E4):** a Particles record's *Particle Editor* button opens it as a modal window over the workspace.
  - **Outliner:** the Force Field (master), the Wind (guest), the forces, Lightning and the effects, each with its
    eye.
  - **Viewport:** the engine's image with the HUD, the probe and the minimap. The Force Field editor's visualization
    lies over it: flow read back from the GPU lattice, acceleration from `fieldAccel`, damping from the taxonomy.
  - **Inspector:** Force Field, Wind, force, Lightning and effect pages in the Render settings controls.
  - **Library sheet:** search and group chips. Below it, the Log Stream.
  - The host registers the engine with `InspectorRuntime`: `EverestParticleViewport`, on the editor's Vulkan device.
    While the editor is open, the workspace's keys (Delete, Ctrl+D, V …) leave the scene alone.
- **Validated (Linux host, SwiftShader):**

  | Check | Result |
  |---|---|
  | `ParticleLibraryValidation` against the prototype | ✔️ 343 of 343; 3,008 effect uniforms exact |
  | Stored Slang archives (`StoreShaderArchives.py --verify`) | ✔️ 30 archives, 0 failures |
  | `ParticleSimulationCapture` | ✔️ 15 of 15; default scene 2,270 of 6,248 alive (prototype 2,241) |
  | `ParticleEditorCapture` | ✔️ 8 of 8 with open and close checks, 107 s |
  | Regression set (12 tests, below) | ✔️ 12 of 12 |

  The regression set: the eight of the Force Field entry, plus `ParticleLibraryValidation`,
  `SceneGeometryValidation`, `SceneMediaValidation` and `SceneViewportPickValidation`. `SceneMediaValidation` had
  failed since phase A: it now expects the default level's 67 records, and its wind check switches off the authored
  forces and the mesoscale variation, so it reads the wind alone.
- **Evidence:** `Exhibits/ParticleEditor/README.md`, 8 `Images/Editor*.jpg` and 15 `Images/Engine*.jpg`.
- **Windows binary:** `Binaries/FrontierSceneViewport-Windows-x64.zip`, 35,011,471 bytes, SHA-256
  `5e6b1919cdfd4aa487450d1e01df78ece38881c9bb56d0ac3a7b1e34097426c8`. It replaces the Force Field entry's zip.
  - Built with Zig 0.13.0 for x86_64-windows-gnu on the Linux host from the `d0b150c` sources, and packaged at
    `b8968c2`, which changes only documents.
  - It holds `Frontier.exe`, `SolidArcWorkspace.exe`, `TextureWorkspace.exe` and the six shader sets (with
    ParticleSimulation), without the material archives.
  - It is unsigned, not virus-scanned and not started on Windows.
- **Limits:**
  - The particle scene lives for the editor session; it is not yet stored in the level.
  - The level's Force Field record is not yet a source for the particle lattice.
  - The drag volume and the current have no GPU path, as in the prototype; the thunder sound is not ported.
  - Not run on Windows here.
- **Commits:** `fc78edc`, `315eec9`, `24f4a26`, `1c88331`, `420724a`, `4fd9014`, `cdabf6c`, `bbdfe2d`, `d0b150c`,
  `b8968c2` and the commit with this entry and the binary.

## Extensions and Spaces, Jolt physics, networking scaffold (2026-11-04)

- **Request (20th):**
  - Use ParticleSpace instead of "particle scene", and add `Frontier/Extensions/<Name>/` bridges with their rule in
    CLAUDE.md.
  - Reuse one renderer, gizmo and texture bridge across SolidArc, the Frontier editor and the Texture Workspace.
  - Set up Jolt now and scaffold networking, with Epic later.
  - Finish the remaining Particle and Force Field work.
- **Plan:** `Documentation/Plans/Ongoing/ExtensionsAndSpaces.md` (steps 1–8 ✔️).
- **Spaces:**
  - `ParticleScene` → `ParticleSpace` and `SceneWorld` → `WorldSpace`; CLAUDE.md holds the Space table.
  - GizmoSpace, PhysicsSpace and NetworkingSpace are new.
- **Extensions:**
  - `Interface/` (ViewportTexture, GizmoSpace, GizmoRasterization).
  - `Rendering/` (from EverestSceneViewport and EverestSceneGeometry).
  - `Particle/` (from EverestParticleViewport).
  - `Physics/` (JoltExtension, PhysicsSpace, PhysicsExtension).
  - `Networking/` (NetworkingSpace, NetworkingExtension).
- **Gizmo:** the Frontier editor now draws and picks SolidArc's gizmo, through GizmoSpace and GizmoRasterization. It
  gains plane and screen moves. SolidArc keeps its GPU program, fed from the same triangles.
- **Particle space:** a Particles record keeps `<level>.<record>.particlespace` beside the level.
  - The editor attaches the file, shows `UNSAVED`, and saves on Close and with the level.
  - The Inspector shows the space's figures; the six unused sliders are gone.
  - Level wind: the level's Force Field, sampled at an anchor, joins the lattice.
  - The drag volume and the current have a GPU path.
  - Authored tornado columns raise funnels in the GPU clouds.
  - The Force Field page history fills at all times.
  - A modal editor keeps the workspace keys, and the FPS badge hides under it.
- **Physics:**
  - JoltPhysics v5.6.0 is pinned in `Automation/UIDependencies.json` (commit `e77f1755`, sha256 `1f32328f…`) and built
    through `Jolt/Jolt.cmake`, cross-platform deterministic with an SSE4.2 baseline.
  - Simulate (Alt+S, the viewport bar's Play) makes Geometry records shown once with Physics on fall and collide;
    stopping restores them.
- **Networking:** a loopback transport and record replication as level TOML. `EOSExtension`/`EpicAdapter` are documented
  for later.
- **Tests:** 15/15 ctest in 1100 s (Linux host, Debug, SwiftShader).
  - The regression set: CelestialWorkspace, SceneMedia, EnvironmentInspector, ForceFieldCatalogue, ParticleLibrary
    (344/344, eos parity), EverestInterface, SceneGeometry, SceneViewportPick, EverestShipping, EnvironmentRealm,
    ForceFieldTrigger and SceneViewportFlight.
  - New: PhysicsSpaceValidation 15/15, ParticleSpaceValidation 146/146, NetworkingSpaceValidation 17/17.
- **Evidence:**
  - `Exhibits/Physics/Images/PhysicsSpaceFalling.png`.
  - `Exhibits/SceneViewport/Images/GizmoSpaceFrontier.jpg`.
  - `Exhibits/Physics`, `Exhibits/Networking` and `Exhibits/ParticleEditor` (READMEs and ledgers).
- **Windows binary:** `Binaries/FrontierSceneViewport-Windows-x64.zip`, 35,690,260 bytes, SHA-256
  `f3f1358a43a3e0031c36bd4def28a82c8f7415575b7ab60ce8b57e6495f0d22a`. It replaces the Particle editor entry's zip.
  - Built with Zig 0.13.0 for x86_64-windows-gnu on the Linux host, with Jolt built through `Jolt/Jolt.cmake`;
    packaged at `e697a53`.
  - It holds `Frontier.exe`, `SolidArcWorkspace.exe`, `TextureWorkspace.exe`, the six shader sets and
    `Notices/JoltPhysics-LICENSE.txt`.
  - It is unsigned, not virus-scanned and not started on Windows.
- **Sandbox reset:** four commits made while GitHub was unreachable were lost when the sandbox was replaced. They were
  replayed from the session record and pushed: `84b9f69` onward.
- **Limits:**
  - Objects with several copies are held during Simulate (one transform per record).
  - Bodies are boxes over the resolved bounds.
  - The thunder sound is not ported: the engine has no audio output yet.
  - The Vulkan device and window host are still separate for SolidArc (planned).
  - Not run on Windows here.
- **Commits:** `84b9f69`, `bf9ea53`, `19846a8`, `4967491`, `83f036c`, `e697a53` and the commit with this entry and the
  binary.

## SolidArc source integration against e72d319

| Scope | Status | Evidence / remaining work |
|---|---|---|
| CAD source and browser connection | Locally verified | Exhibits/SolidArc/README.md and source-session evidence |
| Existing Slate CAD fixes | Locally verified | 506 native checks; 300 rendered expectations |
| New browser connection | Locally verified | 17 CPU checks; 15 Vulkan checks, including workspace process hand-off |
| CAD regression | Locally verified | 869 green rows, no red |
| Windows companion selection | Locally verified | 9 synthetic-PE packaging tests; not a Windows runtime test |
| Windows host/runtime and product distribution | Not verified | Build and execute on Windows; preserve signing/AV policy |
| Remote Frontier merge | Done | Merged into `arena/88b72faa-frontier` in `4a6b6b7` (SolidArc only); see above |
| T-spline/CAD Form work | On hold | No implementation included |

### SolidArc curve workflow revision — 2026-11-02

| Change | Verification |
|---|---|
| Pointer split of native 3D curves | Exact knot split; real hover/click; original shape and one-step undo |
| Live surface-distance editing | Linked target alone hydrates settings; field release applies; visible atomic refusals |
| Three primary dock panels | Existing PanelDockspace; real tab drag, archived layout validation and reopening/reset |
| Texture Workspace control reuse | Existing authoring surface and PanelChrome compiled once for both workspaces |
| Guides and browser opening | Native guide plus Exhibits/SolidArc/CurveRebuildingGuide.md; existing browser hand-off retained |
| Windows runtime / destination merge | Still pending; source checks are not a product binary or completed merge |

## Vehicle physics on Jolt: Project Drive, three carcasses, inspectors, captures (2026-11-04)

- **Requested (21st):** Jolt with vehicle physics, tested so the slip and tyre dynamics are correct, the missing
  pieces completed (supercharger, tyre pressure, tyre temperature and the rest), three tyre soft-body models on the
  vehicle shown deforming while the car runs, the vehicle inspector, a register of every world object, an adapter
  that brings every object into Jolt, and a physics thread with sub-steps. Plan:
  `Documentation/Plans/Ongoing/VehiclePhysics.md`, steps 1–10, all done.
- **Solver:** Project Drive (`SultanAladin/Frontier-` `3f14808`) renamed to the naming rules in
  `Engine/PhysicalDynamics/Vehicle/`; `RunProjectDriveIdentity.sh` prints bit-identical numbers (126/126 PASS, the
  169,380-number force/slip/drivetrain trace identical). Two source findings fixed behind switches (off keeps
  Project Drive exactly): the load factor applies above Fz0 only, and combined slip uses MF6.1 G functions.
- **Missing pieces:** twin-screw supercharger with bypass, parasitic drag and charge-air temperature; enclosed-gas
  tyre pressure following deformation and temperature; three-capacity tyre thermal model with a cold-grip window;
  wear; fuel mass in binary64; coolant/oil temperatures; traction control; Ackermann steering.
- **Carcasses:** one seam in the contact step, three load-carrying formulations — Spring (radial spring on the
  contact fan), XPBD (84-particle lattice with enclosed gas volume), 3D FEM (Hex8 Neo-Hookean + prestress +
  Coulomb tangential shear). Calibrated to the spring at the 15 mm / 110 kPa operating point (0.95 / 0.96 of its
  load); the car settles at 12.3 / 12.8 / 13.8 mm; 0.09 / 0.69 / 0.20 ms per vehicle step.
- **Thread, adapter, register:** `PhysicsThread` at fixed 240 Hz with input mailbox and published snapshot;
  `PhysicsAdapter`/`JoltAdapter` with coupled `CollisionSteps`/`SolverSubsteps`; `WorldRegister` surveys every
  record (vehicle, moving, fixed, held, fracture-as-static-bounds, tyre, none) and writes
  `<Level>.WorldRegister.md` beside the level on save.
- **Viewport and editor:** body and wheels follow the physics through occupant relocation (occupants 0–4);
  `VehicleVisual.slang` deforms the tyres (analytic path for Spring, 32 × 5 nodal field for XPBD/FEM); driving
  input and chase camera; `VehicleInspector` (9 tabs, curve authoring, four-corner pit bay, live telemetry) and
  `TyreInspector`; Vehicle/Tyre in the Outliner and construct catalogue; `fit-tyres` action; AnalyticIllumination
  SPIR-V archives rebuilt (`StoreShaderArchives.py --verify` 6/6).
- **Validated (Linux host, Release, SwiftShader):**

  | Check | Result |
  |---|---|
  | `RunProjectDriveIdentity.sh` | ✔️ 126/126 PASS, 169,380 trace numbers identical |
  | `VehicleDynamicsValidation` | ✔️ 45/45: Pacejka, MF6.1, launch/braking/cornering, powertrain, thread, register |
  | `TyreCarcassValidation` | ✔️ 17/17: all three carcasses, gas law, shear, the car on each |
  | `VehicleWorkspaceCapture` | ✔️ 5 workspace screenshots, 4 Inspector sections, 32 + 48 animation frames |
  | Viewport/interface regression | ✔️ SceneGeometry, SceneViewportPick, SceneViewportFlight, EverestInterface, ForceFieldCatalogue, EverestShipping, StoredShaderArchive |
  | Naming/format audit | ✔️ branch diff rescanned; `DrawProgressBar`→`RasterizeProgressBar`, `ComposeColumnMajor`→`AssembleColumnMajor`, `TrialDeflection`→`EstimatedDeflection`, `PeakNodeMm`→`PeakFieldMm`, `SpatialItem`→`SpatialRecord`, `Frame`→`Step` |

- **Evidence:** `Exhibits/VehiclePhysics/README.md`, `VehicleRunningProvingGround.gif` (32 frames),
  `TyreDeformationAllThree.gif` (16 synchronized frames), `Results/` (screenshots, `TyreCarcassComparison.png`,
  `VehicleDynamics.txt`, `TyreCarcass.txt`, curve/trace CSVs),
  `Projects/Everest/Content/Levels/ProvingGroundVehicle.levelspace` (+ `.WorldRegister.md`) and
  `Default.WorldRegister.md` (`Default.levelspace` untouched).
- **Windows cross-build:** `FrontierVehicleDynamics`, `FrontierPhysicsExtension`, `EverestProjectRuntime`,
  `EverestProjectEditor`, `TyreCarcassValidation`, `VehicleDynamicsValidation`, `VehicleWorkspaceCapture`
  cross-compile to x86_64-windows-gnu with Zig 0.13.0 (`Automation/WindowsToolchain.cmake`), 604/604 build steps;
  not launched on Windows here.
- **Limits:**
  - No electric motor/battery, aquaplaning, GPU tyre solvers, or per-triangle static colliders yet.
  - Fractured objects stay static bounds until the fracture work.
  - Capture GIFs are SwiftShader renders, not Windows GPU captures.
- **Commits:** the commit with this entry.

#### Networking / collision / portal workstreams (2026-11-04, branch `arena/c8d71a98-frontier`)

- **Scope (owner answers 2026-11-04):** (1) merge Project-Networking providers into Frontier behind
  `NetworkTransport`, Quick Actions toggle named "Networking" (Enabled/Disabled), one PR at the end;
  (2) polygon-accurate colliders replacing box approximations, collision-debug visibility toggle, drivable ramp;
  (3) full portal system (recursive faces, split in/out rendering, object scaling, partial physics,
  far-side transparency) on a format-agnostic polygon-surface base (no format readers yet).
- **Naming mapping (SKILL-Naming):** `Object`/`Actor`/`Mesh` are banned; the "base class" is the existing
  `RecordEntry` + modular configurations with a new `PolygonSurfaceReader` intake interface and a
  `SurfaceFormatRegistry` keyed by extension. "Quick Actions" is the Control Centre Quick Controls grid
  (`ControlCentreQuickAction`, configured per workspace in e.g. `EverestWorkspace.cpp`).
- **Phase A (provider networking):** engine owns `ReplicationCodec` (FP1 wire form, unchanged),
  `EosAdapter` (real EOS P2P relay), `PhotonAdapter` (Photon events + receive queue), `NetworkingSession`
  (owns Space + transport, `Enabled` toggle, per-frame `Advance`); Project-Networking transports become shims
  over the adapters; Everest ticks the session and hosts the Quick Actions toggle.
- **Deviation:** the post-commit sync rule (`SultanAladin/Frontier arena/11f31835-frontier`) conflicts with
  Arena session-branch discipline; all work stays on `arena/c8d71a98-frontier` until the final PR.
- **Evidence:** `Exhibits/Networking/` (this entry's validation ledger).

## SDF penumbra and GI parity oracle (2026-11-21, branch `arena/fd42105b-frontier-old`)

- **Scope:** audit of the PROOF 11 emissive-sphere sheet delivered from `unassignedinbox/Frontier`
  branch `arena/ad7fa01c-frontier` (user report: modes do not match when tested), plus a headless parity
  oracle that re-implements all six renderers over one shared penumbra law, one occlusion predicate, an
  unclamped MIS path-tracer reference and a depth-matched voxel cone-radiosity store.
- **Findings:** nine concrete defects (per-mode cone scale ×0.86 and per-mode march envelopes, a third
  penumbra law in the tier path, horizon-renormalisation bias, inconsistent sample budgets for one
  quantity, cone-aim lift, a reference clamped at 3.5, gates with no cross-mode agreement check, cascade
  seam and self-hit in cone taps). Legacy replication reproduces the committed report's own split
  (0.684 m analytic vs 0.588 m voxel) on the canonical scene.
- **Result:** corrected widths 0.759 / 0.754 / 0.699 m against a 0.729 m reference (all within gate),
  tonemapped RMSE 0.0092 / 0.0093 vs direct-only PT and 0.0338 / 0.0336 vs full PT; all gates pass.
- **Evidence:** `Exhibits/SdfPenumbraParity/` (capture source, repack tool, proof sheet, parity report).
- **Reflection parity oracle (2026-11-21, branch `arena/fd42105b-frontier-old`):** second oracle in
  `Exhibits/SdfPenumbraParity/` (`Code/ReflectionParityCapture.cpp`) replicating the GGX VNDF lobe, delta
  mirror lobe, recorded ray pdf and power-heuristic MIS of
  `Experimental/DeterministicPathTracer` (`arena/ad7fa01c-frontier` @ `e4966e4`) and tying them to closed-form
  radiometry: Heitz VNDF identification (ring norm 1.00000, KS ≤ 0.0023), white-furnace continuation weight
  (deviation ≤ 4e-5), uniform-enclosure energy balance (0.12 % lobe-only, 0.27 % with next-event MIS, mirror
  exact), recorded-pdf consistency (two estimators 0.14 % apart) and image parity vs a converged reference
  (RMSE 0.0140). **All gates pass — the reflection transport itself is sound**; the reflection complaint is
  redirected to the roughness→α mapping, the reflection ray geometry source and the denoise/upsample path,
  which this oracle does not exercise. Evidence: `Exhibits/SdfPenumbraParity/Images/ReflectionParitySheet.png`,
  `Results/ReflectionParityReport.txt`.
