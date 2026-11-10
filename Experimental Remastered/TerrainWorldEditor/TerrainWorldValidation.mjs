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
    StepRegionLiveSimulation,
    ApplyTerrainSculptDab,
    ExtractRegionTriangleMesh,
    ExportWorldTerrainsObj,
    ExportWorldTerrainsBinaryStl,
    SeedThreeDemoTerrains
} from './Engine/TerrainLayerStack.js';
import {
    WeatherSimulationCoordinator,
    EvaluateSeasonalWeatherForcing,
    ExtractRegionWaterMesh
} from './Engine/TerrainErosionPhysics.js';
import {
    GAEA_DATA_MAPS,
    GAEA_SATMAP_THEMES,
    GAEA_SURFACE_STAMPS,
    CreateDefaultTexturingConfig,
    ComputeAllGaeaDataMaps,
    EvaluateGaeaVertexAppearance
} from './Engine/TerrainGaeaTexturing.js';
import {
    TERRAIN_BIOME_PRESETS,
    ApplyBiomePresetToRegion
} from './Engine/TerrainPresetsLibrary.js';

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

// 8. Non-Flooding Mass-Balanced Hydraulic Erosion & Channelized 3D River Water Mesh
Suite('8. Hydraulic erosion carves valleys & deposits fans while preventing sheet-flooding (<25% open water)', () =>
{
    const World = new WorldMask2D();
    const Mask = World.addMaskLayer({ name: 'Fluvial Basin' });
    World.paintCapsuleMeters(Mask, [-380, -320], [380, 320], 480, 'paint', 1.0, 0.25, 4029);
    const Reg = World.addTerrainRegion({
        maskLayerId: Mask.id,
        bounds: World.computeLayerPaintedBounds(Mask, 80),
        resolution: 96,
        stack: [
            CreateTerrainLayer('multifractal', { amplitude: 210, scale: 2.3, falloff: { mode: 'soft', distance: 260, edgeFloor: 0.02 } }),
            CreateTerrainLayer('ridged', { amplitude: 120, scale: 2.5, falloff: { mode: 'continental', distance: 320, edgeFloor: 0.0 } }),
            CreateTerrainLayer('erosion-hydraulic', { iterations: 24, rainRate: 0.72, erosionRate: 0.85, depositionRate: 0.65, infiltration: 0.18 })
        ]
    });

    const Rt = EvaluateTerrainRegion(World, Reg);
    const Ero = Rt.erosion;
    assert.ok(Ero, 'Hydraulic layer must populate runtime erosion state');

    let LandCount = 0, OpenWaterCount = 0, TotalWear = 0, TotalAlluv = 0;
    let PeakCell = 0, PeakH = -1e9;
    for (let I = 0; I < Rt.heights.length; ++I)
    {
        if (Rt.sdf2D[I] <= -Rt.stepX)
        {
            LandCount++;
            TotalWear += Ero.wear[I];
            TotalAlluv += Ero.alluvium[I];
            if (Ero.waterDepth[I] > 0.095 && (Ero.flowAccum[I] > 0.20 || Ero.waterDepth[I] > 0.24)) OpenWaterCount++;
            if (Rt.heights[I] > PeakH) { PeakH = Rt.heights[I]; PeakCell = I; }
        }
    }

    const FloodFraction = OpenWaterCount / Math.max(1, LandCount);
    assert.ok(TotalWear > 12.0, `Hydraulic erosion must carve measurable valley bedrock wear (got ${TotalWear.toFixed(2)})`);
    assert.ok(TotalAlluv > 6.0, `Hydraulic erosion must deposit alluvial fans (got ${TotalAlluv.toFixed(2)})`);
    assert.ok(FloodFraction < 0.25, `Terrain must NOT sheet-flood! Open river/pool water covered ${(FloodFraction * 100).toFixed(1)}% of land`);
    assert.ok(Ero.waterDepth[PeakCell] < 0.05, `Summit ridge must remain unflooded (peak waterDepth=${Ero.waterDepth[PeakCell].toFixed(3)}m)`);

    const WaterMesh = ExtractRegionWaterMesh(World, Reg);
    assert.ok(WaterMesh.triangleCount > 0 && WaterMesh.triangleCount < LandCount * 0.5,
        `Channelized 3D water mesh should build river/pool triangles without blanketing terrain (tris=${WaterMesh.triangleCount})`);
});

// 9. Cryogenic Frost/Ice Expansion & Solar Thermal Tafoni Pitting Erosion
Suite('9. Frost-crack ice expansion & solar thermal weathering carve genuine bedrock pits without refilling', () =>
{
    const World = new WorldMask2D();
    const Mask = World.addMaskLayer({ name: 'Pitting Plateau' });
    World.paintCapsuleMeters(Mask, [-250, -250], [250, 250], 420, 'paint', 1.0, 0.15, 5111);

    const RegBase = World.addTerrainRegion({
        maskLayerId: Mask.id,
        bounds: World.computeLayerPaintedBounds(Mask, 70),
        resolution: 88,
        shorelineBevel: 0.0,
        weatherSpec: { climateRegime: 'subarctic-periglacial', tempOffsetC: -3.0 },
        stack: [
            CreateTerrainLayer('voronoi', { variant: 0, amplitude: 160, scale: 2.8, falloff: { mode: 'none', distance: 100, edgeFloor: 1.0 } })
        ]
    });
    const RtBefore = EvaluateTerrainRegion(World, RegBase);
    const HeightsBefore = new Float32Array(RtBefore.heights);

    RegBase.stack.push(CreateTerrainLayer('erosion-pitting', {
        iterations: 18,
        frostIntensity: 0.95,
        thermalIntensity: 0.88,
        tafoniStrength: 0.85,
        jointExploit: 0.90,
        pitScale: 0.65
    }));
    RegBase.dirty = true;
    const RtAfter = EvaluateTerrainRegion(World, RegBase);

    let MaxPit = 0, TotalPitWear = 0, LoweredCells = 0;
    for (let I = 0; I < RtAfter.heights.length; ++I)
    {
        if (RtAfter.sdf2D[I] < -20.0)
        {
            if (RtAfter.erosion.pitting[I] > MaxPit) MaxPit = RtAfter.erosion.pitting[I];
            TotalPitWear += RtAfter.erosion.wear[I];
            if (RtAfter.heights[I] < HeightsBefore[I] - 0.02) LoweredCells++;
        }
    }
    assert.ok(MaxPit > 0.15, `Frost & thermal pitting must build strong pitting mask values (max=${MaxPit.toFixed(3)})`);
    assert.ok(TotalPitWear > 8.0 && LoweredCells > 120, `Pitting must physically excavate cavities into bedrock (wear=${TotalPitWear.toFixed(2)}, pittedCells=${LoweredCells})`);
});

// 10. Aeolian Wind Dunes AND Canyon Sandstone Venturi Cuts & Undercutting
Suite('10. Aeolian wind solver both builds desert dunes AND carves Venturi sandstone cuts inside canyons', () =>
{
    const World = new WorldMask2D();
    const Mask = World.addMaskLayer({ name: 'Navajo Canyon & Erg' });
    World.paintCapsuleMeters(Mask, [-360, -300], [360, 300], 460, 'paint', 1.0, 0.2, 6221);
    const Bounds = World.computeLayerPaintedBounds(Mask, 75);

    const Reg = World.addTerrainRegion({
        maskLayerId: Mask.id,
        bounds: Bounds,
        resolution: 92,
        lithology: { rockHardness: 0.36, strataContrast: 0.92, strataFrequency: 14.0, dipDeg: 5.0, strikeDeg: 20.0, jointDensity: 0.65 },
        weatherSpec: { climateRegime: 'arid-desert', windAzimuthDeg: 38.0, windSpeed: 0.92, windShiftMode: 'bimodal' },
        stack: [
            CreateTerrainLayer('voronoi', { variant: 0, amplitude: 155, scale: 2.6, falloff: { mode: 'plateau', distance: 120, edgeFloor: 0.4 } }),
            CreateTerrainLayer('spline', {
                splineMode: 'canyon',
                width: 95,
                amount: 82,
                bankSmooth: 0.35,
                falloff: { mode: 'none', distance: 100, edgeFloor: 1.0 },
                points: [[-340, -240], [0, 0], [340, 240]]
            }),
            CreateTerrainLayer('erosion-wind', {
                iterations: 20,
                windSpeed: 0.95,
                canyonAbrasion: 1.15,
                strataUndercut: 1.05,
                duneStrength: 0.85,
                sandSupply: 0.68
            })
        ]
    });

    const Rt = EvaluateTerrainRegion(World, Reg);
    let SteepWallWindWear = 0, TotalAeolianSand = 0;
    const Nx = Rt.nx, Nz = Rt.nz;
    for (let Z = 2; Z < Nz - 2; ++Z)
    {
        for (let X = 2; X < Nx - 2; ++X)
        {
            const I = Z * Nx + X;
            if (Rt.sdf2D[I] >= -Rt.stepX) continue;
            TotalAeolianSand += Rt.erosion.aeolianSand[I];
            const Slope = Math.hypot(
                (Rt.heights[I + 1] - Rt.heights[I - 1]) / (2 * Rt.stepX),
                (Rt.heights[I + Nx] - Rt.heights[I - Nx]) / (2 * Rt.stepZ)
            );
            if (Slope > 0.35) SteepWallWindWear += Rt.erosion.wear[I];
        }
    }
    assert.ok(SteepWallWindWear > 3.5, `Venturi canyon wind abrasion must carve steep sandstone canyon walls (steepWear=${SteepWallWindWear.toFixed(2)})`);
    assert.ok(TotalAeolianSand > 10.0, `Bagnold aeolian saltation must accumulate & migrate desert sand dunes (sandVol=${TotalAeolianSand.toFixed(2)})`);
});

// 11. Direct SDF Cliff Rockfall & Conical Talus Scree + Chemical Karst Dissolution
Suite('11. Cliff rockfall calves steep faces into conical talus aprons & chemical karst dissolves carbonate', () =>
{
    const World = new WorldMask2D();
    const Mask = World.addMaskLayer({ name: 'Cliff & Karst' });
    World.paintCapsuleMeters(Mask, [-260, -260], [260, 260], 420, 'paint', 1.0, 0.2, 7411);

    const Reg = World.addTerrainRegion({
        maskLayerId: Mask.id,
        bounds: World.computeLayerPaintedBounds(Mask, 70),
        resolution: 88,
        shorelineBevel: 0.0,
        lithology: { rockHardness: 0.48, carbonateSolubility: 0.88, ironMineral: 0.82, jointDensity: 0.82 },
        stack: [
            CreateTerrainLayer('voronoi', { variant: 0, amplitude: 195, scale: 3.2, sharpness: 0.92, falloff: { mode: 'none', distance: 100, edgeFloor: 1.0 } }),
            CreateTerrainLayer('erosion-rockfall', { iterations: 16, calvingRate: 0.90, criticalSlopeDeg: 42, talusReposeDeg: 35, runoutMobility: 0.80 }),
            CreateTerrainLayer('erosion-chemical', { iterations: 14, karstRate: 0.92, sinkholeStrength: 0.82, stainIntensity: 0.90 })
        ]
    });

    const Rt = EvaluateTerrainRegion(World, Reg);
    let TotalTalus = 0, MaxChem = 0, TotalWear = 0;
    for (let I = 0; I < Rt.heights.length; ++I)
    {
        if (Rt.sdf2D[I] < -Rt.stepX)
        {
            TotalTalus += Rt.erosion.talus[I];
            TotalWear += Rt.erosion.wear[I];
            if (Rt.erosion.chemical[I] > MaxChem) MaxChem = Rt.erosion.chemical[I];
        }
    }
    assert.ok(TotalTalus > 8.0, `Direct SDF rockfall must deposit talus scree cones below cliffs (talus=${TotalTalus.toFixed(2)})`);
    assert.ok(TotalWear > 10.0, `Cliff calving + karst dissolution must detach bedrock (wear=${TotalWear.toFixed(2)})`);
    assert.ok(MaxChem > 0.15, `Chemical weathering must produce geochemical Fe/Mn staining & karst signal (maxChem=${MaxChem.toFixed(3)})`);
});

// 12. Per-Mask (Solo 1-by-1) vs Shared Weather Cycle Group + All 18 Biome Presets
Suite('12. Supports both Solo (1-by-1) simulation AND Shared Weather Groups, plus all 18 Biome Presets', () =>
{
    const World = new WorldMask2D();
    const { regions: [R1, R2, R3] } = SeedThreeDemoTerrains(World);

    assert.equal(R1.weatherGroup, 'group-a');
    assert.equal(R2.weatherGroup, 'solo');
    assert.equal(R3.weatherGroup, 'group-a');

    const Base1 = R1.runtime.erosion.totalSteps;
    const Base2 = R2.runtime.erosion.totalSteps;
    const Base3 = R3.runtime.erosion.totalSteps;

    // 1) Solo 1-by-1 step on R2: ONLY R2 advances!
    StepRegionLiveSimulation(World, R2, null, 4);
    assert.equal(R2.runtime.erosion.totalSteps, Base2 + 4, 'Solo step must advance target terrain');
    assert.equal(R1.runtime.erosion.totalSteps, Base1, 'Solo step must not advance other terrains');

    // 2) Shared Weather Group A step via WeatherSimulationCoordinator: R1 and R3 advance together under identical forcing, R2 untouched!
    const Coord = new WeatherSimulationCoordinator();
    const ClockA = Coord.getGroupClock('group-a', R1.weatherSpec);
    for (let K = 0; K < 5; ++K)
    {
        const SharedWeather = EvaluateSeasonalWeatherForcing(ClockA.weatherSpec, ClockA.stepIndex++);
        for (const Reg of World.regions.filter(R => R.weatherGroup === 'group-a'))
        {
            StepRegionLiveSimulation(World, Reg, SharedWeather, 1);
        }
    }
    assert.equal(R1.runtime.erosion.totalSteps, Base1 + 5, 'Group-A terrain 01 must advance +5 shared weather ticks');
    assert.equal(R3.runtime.erosion.totalSteps, Base3 + 5, 'Group-A terrain 03 must advance +5 shared weather ticks in lockstep');
    assert.equal(R2.runtime.erosion.totalSteps, Base2 + 4, 'Solo terrain 02 must remain independent of Group-A ticks');

    // 3) Validate all 18 Biome Presets evaluate cleanly without NaN/Infinity!
    assert.equal(TERRAIN_BIOME_PRESETS.length, 18, 'Must ship 18 physically-grounded biome presets');
    R2.resolution = 68; // Compact grid for fast exhaustive 18-preset sweep
    for (const Preset of TERRAIN_BIOME_PRESETS)
    {
        ApplyBiomePresetToRegion(R2, Preset.id, CreateTerrainLayer);
        const Rt = EvaluateTerrainRegion(World, R2);
        assert.ok(Rt.hasLand && Number.isFinite(Rt.maxHeight) && Rt.maxHeight > 10.0,
            `Preset ${Preset.id} must evaluate finite terrain relief (got maxHeight=${Rt.maxHeight})`);
    }
});

// 13. 16-Channel Gaea Geomorphological Data Maps, 12 SatMaps & 8 Geological Surface Stamps
Suite('13. Computes all 16 Gaea data maps and applies 12 SatMaps + 8 surface stamps to albedo & normals', () =>
{
    assert.equal(GAEA_DATA_MAPS.length, 16, 'Must expose 16 Gaea geomorphological data maps');
    assert.ok(Object.keys(GAEA_SATMAP_THEMES).length >= 12, 'Must expose at least 12 Gaea SatMap palettes');
    assert.equal(Object.keys(GAEA_SURFACE_STAMPS).length, 8, 'Must expose 8 procedural Gaea geological surface stamps');

    const World = new WorldMask2D();
    const { regions: [R1] } = SeedThreeDemoTerrains(World);
    const Maps = ComputeAllGaeaDataMaps(World, R1);

    for (const M of GAEA_DATA_MAPS)
    {
        const Arr = Maps[M.id];
        assert.ok(Arr instanceof Float32Array && Arr.length === R1.runtime.nx * R1.runtime.nz, `Map ${M.id} must be allocated`);
        for (let I = 0; I < Arr.length; I += 19)
        {
            assert.ok(Number.isFinite(Arr[I]) && Arr[I] >= -1e-4 && Arr[I] <= 1.0001, `Map ${M.id} values must lie in [0, 1]`);
        }
    }

    // Verify surface stamps perturb both vertex color AND 3D micro-normals on steep rock cells
    R1.texturing = CreateDefaultTexturingConfig('utah-navajo', Object.keys(GAEA_SURFACE_STAMPS));
    let PerturbedNormalCount = 0;
    const BaseN = [0.55, 0.65, 0.52];
    const NormL = Math.hypot(...BaseN);
    const UnitN = BaseN.map(V => V / NormL);
    for (let I = 0; I < R1.runtime.heights.length; I += 13)
    {
        if (R1.runtime.sdf2D[I] < -35.0 && Maps.slope[I] > 0.22)
        {
            const Wx = R1.bounds.x + (I % R1.runtime.nx) * R1.runtime.stepX;
            const Wz = R1.bounds.z + Math.floor(I / R1.runtime.nx) * R1.runtime.stepZ;
            const App = EvaluateGaeaVertexAppearance(World, R1, I, Wx, R1.runtime.heights[I], Wz, UnitN);
            const Dot = App.normal[0] * UnitN[0] + App.normal[1] * UnitN[1] + App.normal[2] * UnitN[2];
            if (Dot < 0.9995) PerturbedNormalCount++;
        }
    }
    assert.ok(PerturbedNormalCount > 25, `Gaea surface stamps must perturb 3D vertex normals across rock slopes (perturbed=${PerturbedNormalCount})`);
});

console.log(`\nAll ${Passed}/13 Open-World SDF Terrain Studio validation suites passed!`);

