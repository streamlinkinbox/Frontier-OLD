# Experimental Remastered

Unified **Sun Inspector + Fluid Editor + Vehicle Lab** studio interface across Frontier's interactive authoring workspaces. Shared layout, control, typography, and diagnostic rules are documented in [UI_COMPONENT_GUIDELINES.md](./UI_COMPONENT_GUIDELINES.md).

- **SDF Sculpt Studio (`Experimental Remastered/SdfSculptEditor/`)** — Real-time WebGL2 hybrid `RGBA16F` 3D volumetric clay sculpting + 24 non-destructive analytical CSG primitives, 10 volumetric sculpting brushes, interactive brush falloff curve editor, 7 studio shading/diagnostic lenses, Dual Surface Nets watertight mesh extraction, and native Frontier `SDF1` `.sdfspace` / `.obj` / `.stl` / `.toml` interchange.

## Quick start

```bash
# SDF Sculpt Studio (port 8087, bound to 0.0.0.0)
python3 "Experimental Remastered/SdfSculptEditor/Serve.py"
```
