# Experimental Remastered

Unified **Sun Inspector + Fluid Editor + Vehicle Lab** studio interface across Frontier's interactive authoring workspaces. Shared layout, control, typography, and diagnostic rules are documented in [UI_COMPONENT_GUIDELINES.md](./UI_COMPONENT_GUIDELINES.md).

- **Open-World SDF Terrain Studio (`Experimental Remastered/TerrainWorldEditor/`)** — Infinite sparse-tile 2D world mask with independent toggleable Terrain Bounds Boxes over a 3D animated Ocean, space-efficient Thin-Slab SDF authoring, 3D XYZ Spline Landforms & Overhang Arches, **6 physically-based composable geomorphology solvers** (non-flooding hydraulic stream/fan erosion, cryogenic frost-crack & solar thermal tafoni pitting, Venturi sandstone canyon wind cuts + Bagnold desert dunes, direct SDF cliff rockfall & conical talus scree, carbonate karst dissolution & geochemical staining, and 4-season snowmelt/climate cycles), **Solo (1-by-1) vs Shared Weather Cycle Groups**, **18 Biome Presets**, and **Gaea-style texturing** (12 SatMaps, 8 procedural geological surface stamps with 3D normal perturbation, and 16 live derived data maps with `.PNG` / RGBA splatmap + `.OBJ` / `.STL` triangle export).
- **SDF Sculpt Studio (`Experimental Remastered/SdfSculptEditor/`)** — Real-time WebGL2 hybrid `RGBA16F` 3D volumetric clay sculpting + 24 non-destructive analytical CSG primitives, 10 volumetric sculpting brushes, interactive brush falloff curve editor, 7 studio shading/diagnostic lenses, Dual Surface Nets watertight mesh extraction, and native Frontier `SDF1` `.sdfspace` / `.obj` / `.stl` / `.toml` interchange.

## Quick start

```bash
# Serve Frontier root (Terrain Studio + SDF Sculpt Studio + AppLauncher) on 0.0.0.0:8080
python3 -m http.server 8080 --bind 0.0.0.0

# Run headless physics & SDF validation suites
node "Experimental Remastered/TerrainWorldEditor/TerrainWorldValidation.mjs"
node "Experimental Remastered/SdfSculptEditor/SdfSculptValidation.mjs"
```
