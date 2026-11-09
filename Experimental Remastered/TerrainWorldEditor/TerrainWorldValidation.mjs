/*==========================================================================================================================================
                                                     TERRAINWORLDVALIDATION.MJS
==========================================================================================================================================*/
// Comprehensive Headless Validation Suite for Frontier Open-World SDF Terrain Studio

import assert from 'node:assert/strict';
import { WorldMask2D, ComputeRegionMaskSdf2D } from './Engine/WorldMask2D.js';
import {
    EvaluateBoundaryFalloff,
    CreateTerrainLayer,
    EvaluateTerrainRegion,
    ApplyTerrainSculptDab,
    ExtractRegionTriangleMesh,
    ExportWorldTerrainsObj,
    ExportWorldTerrainsBinaryStl,
    SeedThreeDemoTerrains
} from './Engine/TerrainLayerStack.js';

let Passed = 0;
function Suite(Name, Fn)
{
    Fn();
    Passed++;
    console.log(`  [PASS] ${Name}`);
}

console.log('Running Frontier Open-World SDF Terrain Studio Validation...\n');

// 1. Infinite Sparse 2D Mask Allocation & Negative/Distant Coordinate Painting
Suite('1. Infinite sparse 2D world mask allocates tiles on demand across arbitrary kilometer coordinates', () =>
{
    const World = new WorldMask2D();
    const Mask = World.addMaskLayer({ name: 'Infinite Test' });
    assert.equal(World.totalAllocatedTiles(), 0, 'Fresh mask should allocate 0 tiles');

    // Paint at (-14.5 km, +28.2 km) — far outside any fixed canvas!
    World.paintCapsuleMeters(Mask, [-14500, 28200], [-14100, 28450], 180, 'paint', 1.0, 0.0, 101);
    assert.ok(World.totalAllocatedTiles() > 0 && World.totalAllocatedTiles() <= 4, 'Only touched 1x1 km tiles should be allocated');
    assert.ok(World.sampleCoverageMeters(-14300, 28320, Mask.id) > 0.95, 'Painted distant coordinate should have full land coverage');
    assert.equal(World.sampleCoverageMeters(5000, -5000, Mask.id), 0.0, 'Unpainted distant ocean should return 0 without allocating tiles');

    // Erasing back to 0 prunes empty tiles automatically
    World.paintCapsuleMeters(Mask, [-14600, 28100], [-14000, 28550], 350, 'erase', 1.0, 0.0, 101);
    assert.equal(World.totalAllocatedTiles(), 0, 'Erased empty sparse tiles should be pruned automatically');
});

// 2. Exact O(N) Meijster 2D Euclidean Signed Distance Transform
Suite('2. Meijster 2D Euclidean Signed Distance Field computes exact metric inland/offshore distances', () =>
{
    const World = new WorldMask2D();
    const Mask = World.addMaskLayer({ name: 'Circle Island' });
    World.paintCapsuleMeters(Mask, [0, 0], [0, 0], 300, 'paint', 1.0, 0.0, 42);
    const Region = World.addTerrainRegion({
        maskLayerId: Mask.id,
        bounds: { x: -500, z: -500, width: 1000, depth: 1000 },
        resolution: 101
    });
    const { sdf2D, hasLand } = ComputeRegionMaskSdf2D(World, Region, 101, 101);
    assert.equal(hasLand, true);

    const CenterIdx = 50 * 101 + 50; // (0, 0) -> ~300m inland -> sdf2D ~ -300
    const CornerIdx = 0;             // (-500, -500) -> ~707 - 300 = +407m in ocean
    assert.ok(sdf2D[CenterIdx] < -270 && sdf2D[CenterIdx] > -330, `Expected ~-300m at island center, got ${sdf2D[CenterIdx]}`);
    assert.ok(sdf2D[CornerIdx] > 370 && sdf2D[CornerIdx] < 440, `Expected ~+407m at ocean corner, got ${sdf2D[CornerIdx]}`);
});

// 3. Per-Layer Boundary Falloff Modes: Soft Edge -> Strong Center vs None (Full Cliff)
Suite('3. Per-Layer Boundary Falloff supports Soft Edge -> Strong Center AND None (Full Cliff Edge)', () =>
{
    const SoftSpec = { mode: 'soft', distance: 300, edgeFloor: 0.0 };
    assert.equal(EvaluateBoundaryFalloff(0, 500, SoftSpec), 0.0, 'Soft falloff at coastline (0m) should have 0 influence');
    const MidW = EvaluateBoundaryFalloff(150, 500, SoftSpec);
    assert.ok(Math.abs(MidW - 0.5) < 0.02, `Soft falloff halfway inland should be ~0.5, got ${MidW}`);
    assert.equal(EvaluateBoundaryFalloff(350, 500, SoftSpec), 1.0, 'Soft falloff deep inland should reach 1.0');

    const CliffSpec = { mode: 'none', distance: 300, edgeFloor: 0.0 };
    assert.equal(EvaluateBoundaryFalloff(0, 0, CliffSpec), 1.0, 'None (Cliff) falloff must deliver 100% full strength right at 0m coastline edge');
    assert.equal(EvaluateBoundaryFalloff(200, 200, CliffSpec), 1.0);

    const RimSpec = { mode: 'rim', distance: 300, edgeFloor: 0.0 };
    const RimPeak = EvaluateBoundaryFalloff(90, 500, RimSpec);
    const RimCenter = EvaluateBoundaryFalloff(300, 500, RimSpec);
    assert.ok(RimPeak > RimCenter, 'Coastal Rim Ring falloff should peak near coastal rim and relax toward center basin');
});

// 4. 3 Pre-Built Demonstration Masks & Independent Toggleable Terrain Bounds Regions
Suite('4. Ships with 3 distinct Demo Masks & independent toggleable Terrain Bounds Regions', () =>
{
    const World = new WorldMask2D();
    const { masks, regions } = SeedThreeDemoTerrains(World);
    assert.equal(masks.length, 3, 'Must create 3 Demo 2D Mask Layers');
    assert.equal(regions.length, 3, 'Must create 3 independent Demo Terrain Bounds Regions');

    for (const R of regions)
    {
        assert.equal(R.enabled, true);
        assert.ok(R.runtime && R.runtime.hasLand, `${R.name} must evaluate valid land inside its 2D mask`);
        assert.ok(R.runtime.maxHeight > 80, `${R.name} must build substantial 3D mountain/cliff relief above sea level`);
    }

    // Verify Demo Terrain 2 ("Basalt Sea Cliffs") uses Falloff = 'none' for sheer coastal cliffs!
    const CliffRegion = regions[1];
    assert.equal(CliffRegion.stack[0].falloff.mode, 'none', 'Demo Terrain 02 should showcase None (Full Cliff) falloff');

    // Verify toggling a Terrain Bounds Box OFF works independently without affecting the others
    CliffRegion.enabled = false;
    const EnabledList = World.regions.filter(R => R.enabled);
    assert.equal(EnabledList.length, 2, 'Toggling one Terrain Bounds Box OFF leaves the other 2 active');
    CliffRegion.enabled = true;
});

// 5. Thin-Slab SDF Space Efficiency & Triangle Mesh Conversion
Suite('5. Thin-Slab SDF wastes zero deep-ocean space and extracts clean culled triangle meshes (.OBJ & .STL)', () =>
{
    const World = new WorldMask2D();
    SeedThreeDemoTerrains(World);
    const R1 = World.regions[0];
    const Mesh = ExtractRegionTriangleMesh(World, R1, { includeUnderside: true });

    assert.ok(Mesh.triangleCount > 2000, 'Terrain should generate rich top + thin-underside triangle mesh');
    const FullGridCells = (R1.runtime.nx - 1) * (R1.runtime.nz - 1);
    // If empty ocean cells weren't culled, top + bottom alone would exceed 4 * FullGridCells!
    assert.ok(Mesh.triangleCount < FullGridCells * 3.4, 'Empty ocean cells outside 2D mask must be culled from triangle output');

    // Verify NO vertex ever wastes vertical SDF space below slabBottom (-6.5m)!
    let MinY = Infinity, MaxY = -Infinity;
    for (let I = 1; I < Mesh.positions.length; I += 3)
    {
        if (Mesh.positions[I] < MinY) MinY = Mesh.positions[I];
        if (Mesh.positions[I] > MaxY) MaxY = Mesh.positions[I];
    }
    assert.ok(Math.abs(MinY - (-R1.slabThickness)) < 0.05, `Thin-slab underside should sit cleanly at -${R1.slabThickness}m, got ${MinY}`);
    assert.ok(MaxY > 120.0, `Top terrain relief should build upward above sea level, got ${MaxY}`);

    // Verify multi-terrain .OBJ & binary .STL exports
    const Obj = ExportWorldTerrainsObj(World, World.regions);
    assert.ok(Obj.triangleCount > 6000 && Obj.text.includes('o Terrain_01'));
    const Stl = ExportWorldTerrainsBinaryStl(World, [R1]);
    assert.equal(Stl.bytes.byteLength, 84 + Stl.triangleCount * 50, 'Binary STL byte length must match 84 + 50 * triCount');
});

// 6. Real-time SDF Sculpting, 3D Overhang Arches & JSON Round-Trip Serialization
Suite('6. Supports real-time SDF sculpting, 3D overhang arches, spline landforms, and JSON round-trip', () =>
{
    const World = new WorldMask2D();
    SeedThreeDemoTerrains(World);
    const R = World.regions[0];
    const Rt0 = R.runtime;

    // Find the highest peak cell inside Region 01 and sculpt directly on it
    let PeakIdx = 0, BeforePeak = -1e9;
    for (let I = 0; I < Rt0.heights.length; ++I)
    {
        if (Rt0.sdf2D[I] < -40.0 && Rt0.heights[I] > BeforePeak)
        {
            BeforePeak = Rt0.heights[I];
            PeakIdx = I;
        }
    }
    const Px = R.bounds.x + (PeakIdx % Rt0.nx) * Rt0.stepX;
    const Pz = R.bounds.z + Math.floor(PeakIdx / Rt0.nx) * Rt0.stepZ;

    ApplyTerrainSculptDab(World, R, [Px, BeforePeak, Pz], 'raise', { radius: 220, strength: 0.95 });
    EvaluateTerrainRegion(World, R);
    assert.ok(R.runtime.heights[PeakIdx] > BeforePeak + 25.0, '3D Raise sculpt brush should elevate terrain SDF at brush target');
    assert.ok(R.runtime.maxHeight > BeforePeak + 25.0, '3D Raise sculpt on peak should elevate region maxHeight');

    ApplyTerrainSculptDab(World, R, [Px, 65, Pz], 'overhang', { radius: 90, strength: 0.8 });
    assert.equal(R.sdf3DOps.length, 1, '3D Overhang tool should append analytical 3D SDF arch/overhang op');

    // JSON round-trip
    const Saved = JSON.stringify(World.toJSON());
    const Restored = new WorldMask2D();
    Restored.loadFromJSON(JSON.parse(Saved));
    assert.equal(Restored.maskLayers.length, 3);
    assert.equal(Restored.regions.length, 3);
    assert.equal(Restored.totalAllocatedTiles(), World.totalAllocatedTiles());
});

// 7. 3D Spline Knot Up/Down Y-Axis Gizmo Elevation Grading & 3D Rock Arch Bridge Meshing
Suite('7. Moving 3D Spline Knots UP and DOWN on Y-axis shapes terrain elevation & builds 3D SDF Arch Bridges', () =>
{
    const World = new WorldMask2D();
    SeedThreeDemoTerrains(World);
    const R = World.regions[0];
    const RtBase = EvaluateTerrainRegion(World, R);

    // Pick an interior land cell on Region 01
    let TargetIdx = 0, BaseH = 0;
    for (let I = 0; I < RtBase.heights.length; ++I)
    {
        if (RtBase.sdf2D[I] < -140.0)
        {
            TargetIdx = I;
            BaseH = RtBase.heights[I];
            break;
        }
    }
    const Kx = Math.round(R.bounds.x + (TargetIdx % RtBase.nx) * RtBase.stepX);
    const Kz = Math.round(R.bounds.z + Math.floor(TargetIdx / RtBase.nx) * RtBase.stepZ);

    const GradedSpline = CreateTerrainLayer('spline', {
        name: '3D Gizmo Ramp Test',
        splineMode: 'grade',
        width: 140.0,
        bankSmooth: 0.65,
        meander: 0.0,
        falloff: { mode: 'none', distance: 100, edgeFloor: 1.0 },
        points: [
            [Kx - 120, Kz, BaseH],
            [Kx, Kz, BaseH + 95.0], // Dragged UP +95m on Y Gizmo!
            [Kx + 120, Kz, BaseH]
        ]
    });
    R.stack.push(GradedSpline);
    EvaluateTerrainRegion(World, R);
    const RaisedH = R.runtime.heights[TargetIdx];
    assert.ok(RaisedH > BaseH + 45.0, `Moving spline knot UP on Y-axis must raise terrain (before=${BaseH.toFixed(1)}, after=${RaisedH.toFixed(1)})`);

    // Now move the same knot DOWN below BaseH on Y Gizmo!
    GradedSpline.points[1][2] = Math.max(2.0, BaseH - 55.0);
    EvaluateTerrainRegion(World, R);
    const LoweredH = R.runtime.heights[TargetIdx];
    assert.ok(LoweredH < BaseH - 18.0, `Moving spline knot DOWN on Y-axis must carve terrain down (before=${BaseH.toFixed(1)}, after=${LoweredH.toFixed(1)})`);

    // Switch spline to 'arch3d' (True 3D Rock Arch Bridge) and verify 3D tube triangles are emitted
    const TrisBeforeArch = ExtractRegionTriangleMesh(World, R).triangleCount;
    GradedSpline.splineMode = 'arch3d';
    GradedSpline.points[1][2] = BaseH + 80.0;
    R.dirty = true;
    const MeshWithArch = ExtractRegionTriangleMesh(World, R);
    assert.ok(MeshWithArch.triangleCount > TrisBeforeArch + 200, '3D Rock Arch Bridge spline mode must generate true 3D overhang tube triangles');
});

console.log(`\nAll ${Passed}/7 Open-World SDF Terrain Studio validation suites passed!`);
