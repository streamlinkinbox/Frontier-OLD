<!--==========================================================================================================================================
                                                                README.MD
==========================================================================================================================================-->
<!-- 🧩 Isolated analytic/voxel SDF shadows, reflected-radiance cones and an emissive-sphere SDF path reference. -->

# Six SDF rendering paths

Actual native images, executed checks, limits and reproduction live in
[the retained render exhibit](../../../Exhibits/DistanceClipmap/SixRenders.md).
This is an experimental C++/Slang continuation, **not the production/editor renderer**.

| Source                 | Mechanism                                                         |
| ---------------------- | ----------------------------------------------------------------- |
| `SdfShadowScene.h`     | Closed signed primitives, analytic normals, camera, sphere PDF.   |
| `SdfShadowFields.h`    | Three signed voxel levels, hybrid SDF visibility, radiance cones. |
| `SdfShadowCapture.h`   | Four matched primary sites, decomposition, 96 total SDF paths.    |
| `SphereVehicleScene.h` | Actual archive/bake companion; triangle-refined vehicle contact.  |
| `SdfShadows.slang`     | Six shadow/GI selections and three executed geometry/path probes. |
| `CMakeLists.txt`       | Independent native/optional Vulkan verification targets.          |

Reuses the existing distance/transport implementation and production triangle bounds for the actual vehicle;
no engine source or prior rejected method is copied, replaced or relabelled.

```bash
cmake -S Experimental/DistanceClipmap/Shadows -B _ClaudeScratch/build/SdfShadows -DCMAKE_BUILD_TYPE=Release
cmake --build _ClaudeScratch/build/SdfShadows --config Release
ctest --test-dir _ClaudeScratch/build/SdfShadows --output-on-failure
_ClaudeScratch/build/SdfShadows/SdfShadowValidation _ClaudeScratch/tmp/SdfCaptures render
```

`validate`, `preview`, `render` and `benchmark` are distinct operations. `preview` executes path 1 only and is
never a six-render result. `render` writes native Float32 PFM images for all six, visibility/signed-field debug,
direct/GI decomposition and independently refreshed sphere-off captures. Construct primary sites again after
geometry/material/camera changes. The benchmark excludes that construction and records cold field costs separately.

The retained exhibit documents optional Slang/Vulkan configuration, explicit-driver handling, tail guards,
reflection/negative controls, source fingerprints, sanitizer scope, signed/unsigned boundaries and motion.
All tested GPU work is SwiftShader CPU device 4; Windows, physical GPU, editor and real-time acceptance are open.
