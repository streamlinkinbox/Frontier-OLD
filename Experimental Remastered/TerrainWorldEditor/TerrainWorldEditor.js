/*==========================================================================================================================================
                                                      TERRAINWORLDEDITOR.JS
==========================================================================================================================================*/
// Main Studio Controller for Frontier SDF Terrain Studio (styled 1:1 with 3D Clay Studio):
// - Infinite Sparse-Tile 2D World Mask + Independent Toggleable Terrain Bounds Boxes
// - Calibrated Non-Blinding Dark-Studio 3D Ocean & Landscape Renderer (ACES Tonemapped)
// - First-Class 3D Spline Landforms + Interactive 3D XYZ (Up/Down Y-Axis) Transform Gizmo
// - Space-Efficient Thin-Slab SDF Architecture + Composable Layer Stack + Per-Layer Boundary Falloffs

import { WorldMask2D } from './Engine/WorldMask2D.js';
import {
    BOUNDARY_FALLOFF_MODES,
    COMBINE_MODES,
    LAYER_TYPE_META,
    IsErosionLayerType,
    CreateTerrainLayer,
    EvaluateTerrainRegion,
    StepRegionLiveSimulation,
    ResetRegionLiveSimulation,
    ExportWorldTerrainsObj,
    ExportWorldTerrainsBinaryStl,
    SeedThreeDemoTerrains,
    Clamp
} from './Engine/TerrainLayerStack.js';
import {
    CLIMATE_REGIMES,
    WIND_SHIFT_MODES,
    WEATHER_GROUP_OPTIONS,
    WeatherSimulationCoordinator,
    EvaluateSeasonalWeatherForcing
} from './Engine/TerrainErosionPhysics.js';
import {
    GAEA_DATA_MAPS,
    GAEA_SATMAP_THEMES,
    GAEA_SURFACE_STAMPS,
    CreateDefaultTexturingConfig,
    CreateStampLayer,
    ComputeAllGaeaDataMaps,
    RenderGaeaMapToCanvas,
    RenderAlbedoAndNormalCanvases
} from './Engine/TerrainGaeaTexturing.js';
import {
    TERRAIN_BIOME_PRESETS,
    ApplyBiomePresetToRegion
} from './Engine/TerrainPresetsLibrary.js';
import { WorldMap2DCanvas } from './Engine/WorldMap2DCanvas.js';
import { TerrainOceanViewport } from './Engine/TerrainOceanViewport.js';
import {
    ConstructGlyph,
    MakeEl,
    MakePropertyGroup,
    MakeSliderPillRow,
    MakeSelectRow,
    MakeBoundaryFalloffGraph
} from './StudioControls.js';

const MASK_PALETTE = ['#58b982', '#5ac8fa', '#a3d977', '#e8c27a', '#f0935b', '#d6a2e8'];

const SPLINE_MODES = [
    ['3D Elevation Ramp (Cut & Fill — Gizmo Y ↕)', 'grade'],
    ['3D SDF Rock Bridge / Overhang Arch', 'arch3d'],
    ['Mountain Crest Uplift (+Height)', 'ridge'],
    ['River Valley (3D Graded Channel)', 'river'],
    ['Canyon Gorge (Deep Carve)', 'canyon'],
    ['Hydrostatic Lake Basin', 'lake']
];

class TerrainWorldStudioApp
{
    constructor()
    {
        this.world = new WorldMask2D();
        SeedThreeDemoTerrains(this.world);

        this.workspaceMode = 'split'; // '2d' | '3d' | 'split'
        this.inspectorTab = 'layers'; // 'layers' | 'spline' | 'slab' | 'stage'
        this.outlinerFilter = 'all';  // 'all' | 'terrains' | 'splines' | 'masks'
        this.outlinerSearch = '';

        this.activeRegionId = this.world.regions[0]?.id || null;
        this.selectedRegionIds = new Set(this.activeRegionId ? [this.activeRegionId] : []);
        // Select the Spline layer by default on Terrain 01 so the 3D Gizmo is immediately visible & ready!
        const InitReg = this.world.regions[0];
        const InitSpline = InitReg?.stack.find(L => L.type === 'spline');
        this.activeLayerId = InitSpline?.id || InitReg?.stack[0]?.id || null;

        this.undoStack = [];
        this.redoStack = [];
        this._evalTimer = null;

        // Live Weather & Erosion Coordinator (supports Solo 1-by-1 OR Shared Weather Group sync!)
        this.weatherCoordinator = new WeatherSimulationCoordinator();
        this.simPlaying = false;
        this.simTargetScope = 'group'; // 'group' | 'solo' | 'all'

        // 1. Initialize Infinite 2D World Mask Canvas
        this.map2D = new WorldMap2DCanvas(document.getElementById('Canvas2D'), this.world, {
            onCursorMove: (Wx, Wz) =>
            {
                const El = document.getElementById('Hud2DCoords');
                if (El) El.textContent = `${(Wx / 1000).toFixed(2)}, ${(Wz / 1000).toFixed(2)} km`;
            },
            onBeforeMaskEdit: () => this.pushUndoSnapshot(),
            onMaskLivePaint: () => this._scheduleDirtyRegionsEvaluation(),
            onMaskStrokeFinished: () =>
            {
                this._evaluateDirtyRegionsNow();
                this.refreshChrome();
            },
            onRegionSelectionChanged: (PrimaryId, SelectedArr) =>
            {
                this._setRegionSelection(PrimaryId, SelectedArr);
            },
            onRegionBoundsEdited: (Region, Finished) =>
            {
                if (Finished)
                {
                    EvaluateTerrainRegion(this.world, Region, this.activeLayerId);
                    Region.meshDirty = true;
                    this.map2D.invalidateRegionPreview(Region.id);
                    this.refreshChrome();
                    this.rebuildInspector();
                }
                else
                {
                    this._scheduleDirtyRegionsEvaluation();
                }
            },
            onCreateRegionFromBox: Bounds =>
            {
                this.pushUndoSnapshot();
                this._createNewRegionWithBounds(Bounds);
            },
            onDoubleClickRegion: Region =>
            {
                this._setRegionSelection(Region.id, [Region.id]);
                if (this.workspaceMode === '2d') this.setWorkspaceMode('split');
                this.view3D.frameRegion(Region);
            },
            onLayerStackChanged: (_Region, LayerId) =>
            {
                this.activeLayerId = LayerId;
                this.view3D.activeSplineLayerId = LayerId;
                this.refreshChrome();
                this.rebuildInspector();
            },
            onSplineEdited: (Region, Layer, Finished, KnotIdx) =>
            {
                this.activeLayerId = Layer.id;
                this.view3D.activeSplineLayerId = Layer.id;
                if (Number.isInteger(KnotIdx)) this.view3D.selectedKnotIndex = KnotIdx;
                EvaluateTerrainRegion(this.world, Region, this.activeLayerId);
                Region.meshDirty = true;
                this.map2D.invalidateRegionPreview(Region.id);
                if (Finished)
                {
                    this.refreshChrome();
                    this.rebuildInspector();
                }
            }
        });

        // 2. Initialize Calibrated Dark-Studio 3D Ocean + Spline Gizmo Viewport
        this.view3D = new TerrainOceanViewport(
            document.getElementById('Canvas3D'),
            document.getElementById('Overlay3D'),
            this.world,
            {
                onPickRegionIn3D: (Region, MultiToggle) =>
                {
                    const NextSet = new Set(this.selectedRegionIds);
                    if (MultiToggle)
                    {
                        if (NextSet.has(Region.id) && NextSet.size > 1) NextSet.delete(Region.id);
                        else NextSet.add(Region.id);
                    }
                    else
                    {
                        NextSet.clear();
                        NextSet.add(Region.id);
                    }
                    const Primary = NextSet.has(Region.id) ? Region.id : Array.from(NextSet)[0];
                    this._setRegionSelection(Primary, Array.from(NextSet));
                },
                onSplineKnotSelected: (_Region, Layer, KnotIndex) =>
                {
                    this.activeLayerId = Layer.id;
                    this.view3D.activeSplineLayerId = Layer.id;
                    this.view3D.selectedKnotIndex = KnotIndex;
                    this.inspectorTab = 'spline';
                    this._syncInspectorTabButtons();
                    this.refreshChrome();
                    this.rebuildInspector();
                },
                onBeforeSplineGizmoEdit: () => this.pushUndoSnapshot(),
                onSplineGizmoLive: (Region, Layer) =>
                {
                    this.activeLayerId = Layer.id;
                    EvaluateTerrainRegion(this.world, Region, this.activeLayerId);
                    Region.meshDirty = true;
                    this.map2D.invalidateRegionPreview(Region.id);
                    this.map2D.requestRedraw();
                    // Live-update Y slider readout if open!
                    if (this._activeKnotYSlider)
                    {
                        const K = Layer.points[this.view3D.selectedKnotIndex];
                        if (K && Number.isFinite(K[2])) this._activeKnotYSlider.SetValue(K[2]);
                    }
                },
                onSplineGizmoFinished: (Region, Layer) =>
                {
                    EvaluateTerrainRegion(this.world, Region, Layer.id);
                    Region.meshDirty = true;
                    this.map2D.invalidateRegionPreview(Region.id);
                    this.refreshChrome();
                    this.rebuildInspector();
                },
                onSplineKnotAdded3D: (Region, Layer, KnotIdx) =>
                {
                    this.activeLayerId = Layer.id;
                    this.view3D.activeSplineLayerId = Layer.id;
                    this.view3D.selectedKnotIndex = KnotIdx;
                    EvaluateTerrainRegion(this.world, Region, Layer.id);
                    Region.meshDirty = true;
                    this.map2D.invalidateRegionPreview(Region.id);
                    this.inspectorTab = 'spline';
                    this._syncInspectorTabButtons();
                    this.refreshChrome();
                    this.rebuildInspector();
                },
                onBeforeSculpt3D: () => this.pushUndoSnapshot(),
                onSculptLive3D: Region =>
                {
                    if (Region.dirty) EvaluateTerrainRegion(this.world, Region, this.activeLayerId);
                    this.map2D.invalidateRegionPreview(Region.id);
                },
                onSculptStrokeFinished3D: Region =>
                {
                    EvaluateTerrainRegion(this.world, Region, this.activeLayerId);
                    Region.meshDirty = true;
                    this.map2D.invalidateRegionPreview(Region.id);
                    this.refreshChrome();
                    this.rebuildInspector();
                }
            }
        );

        if (InitSpline) this.view3D.activeSplineLayerId = InitSpline.id;

        this._mountStaticGlyphs();
        this._buildViewportToolRails();
        this._buildQuickAddLibrary();
        this._buildPresetStrip();
        this._bindHeaderAndTransport();
        this.refreshChrome();
        this.rebuildInspector();

        requestAnimationFrame(() =>
        {
            this.map2D.frameAllRegions();
            this.view3D.frameVisibleWorld();
            this.refreshChrome();
        });

        this._startMainLoop();
    }

    /*======================================================================================================================================
                                                STATIC GLYPHS, TOOL RAILS & QUICK LIBRARY
    ======================================================================================================================================*/
    _mountStaticGlyphs()
    {
        const Mount = (Id, Glyph) =>
        {
            const El = document.getElementById(Id);
            if (El) { El.innerHTML = ''; El.appendChild(ConstructGlyph(Glyph)); }
        };
        Mount('undo-btn', 'Reset');
        Mount('redo-btn', 'Redo');
        Mount('compact-outliner', 'Layers');
        Mount('add-button', 'Plus');
        Mount('stat-active-icon', 'Mountain');
        Mount('stat-spline-icon', 'Spline');
        Mount('search-icon-slot', 'Search');
        Mount('viewport-title-icon', 'Planet');
        Mount('toggle-gizmo-btn', 'Gizmo');
        Mount('toggle-bounds-btn', 'Scan');
        Mount('toggle-contours-btn', 'Activity');
        Mount('focus-btn', 'Focus');
        Mount('maximize-btn', 'Maximize');
        Mount('object-symbol', 'Mountain');
        Mount('sim-play-icon', 'Play');
    }

    _buildViewportToolRails()
    {
        // 2D World Mask & Bounds Floating Left Tool Rail
        const Rail2D = document.getElementById('Tools2DRail');
        Rail2D.innerHTML = '';
        this.btns2D = new Map();
        const Spec2D = [
            ['brush',   'Brush',   'Brush 2D Landmass (B)', 'B'],
            ['erase',   'Eraser',  'Erase Bay / Fjord (E)', 'E'],
            ['polygon', 'Polygon', 'Polygon Continent (P)', 'P'],
            ['sep'],
            ['bounds',  'Scan',    'Draw New Terrain Bounds Box (R)', 'R'],
            ['select',  'Move',    'Select / Move / 8-Handle Resize Bounds (V)', 'V'],
            ['spline',  'Spline',  'Edit Spline Knots in 2D Map (S)', 'S']
        ];
        for (const Item of Spec2D)
        {
            if (Item[0] === 'sep') { Rail2D.appendChild(MakeEl('div', 'tool-rail-sep')); continue; }
            const [Id, Glyph, Tip, Key] = Item;
            const Btn = MakeEl('button', 'tool-rail-btn' + (this.map2D.tool === Id ? ' active' : ''));
            Btn.type = 'button';
            Btn.title = Tip;
            Btn.append(ConstructGlyph(Glyph), MakeEl('small', '', Key));
            Btn.addEventListener('click', () => this.select2DTool(Id));
            this.btns2D.set(Id, Btn);
            Rail2D.appendChild(Btn);
        }

        // 3D Landscape, Spline Gizmo & Sculpt Floating Left Tool Rail
        const Rail3D = document.getElementById('Tools3DRail');
        Rail3D.innerHTML = '';
        this.btns3D = new Map();
        const Spec3D = [
            ['spline',     'Gizmo',     'Spline + 3D XYZ (Up/Down Y ↕) Gizmo', 'G'],
            ['spline-add', 'Plus',      'Click 3D Terrain to Place Spline Knots (K)', 'K'],
            ['navigate',   'Move',      'Orbit & Select Terrains', 'N'],
            ['sep'],
            ['raise',      'ArrowUp',   '3D SDF Raise Terrain Brush', ''],
            ['lower',      'ArrowDown', '3D SDF Carve / Lower Brush', ''],
            ['smooth',     'Sliders',   '3D SDF Smooth Relief Brush', ''],
            ['flatten',    'Layers',    '3D SDF Terrace / Flatten Brush', ''],
            ['overhang',   'Arch',      '3D SDF Volumetric Overhang / Sea Arch', '']
        ];
        for (const Item of Spec3D)
        {
            if (Item[0] === 'sep') { Rail3D.appendChild(MakeEl('div', 'tool-rail-sep')); continue; }
            const [Id, Glyph, Tip, Key] = Item;
            const Btn = MakeEl('button', 'tool-rail-btn' + (this.view3D.tool3D === Id ? ' active' : ''));
            Btn.type = 'button';
            Btn.title = Tip;
            Btn.append(ConstructGlyph(Glyph), Key ? MakeEl('small', '', Key) : null);
            Btn.addEventListener('click', () => this.select3DTool(Id));
            this.btns3D.set(Id, Btn);
            Rail3D.appendChild(Btn);
        }
    }

    _buildQuickAddLibrary()
    {
        const List = document.getElementById('quick-add-list');
        List.innerHTML = '';

        const QuickItems = [
            {
                title: '+ 4-Season Climate Erosion',
                desc: 'Coupled snowmelt, fluvial, frost, wind, talus & karst cycle',
                glyph: 'Snowflake',
                badge: 'SEASONAL',
                cls: 'featured-erosion',
                action: () => this.addProceduralLayer('erosion-seasonal')
            },
            {
                title: '+ Hydraulic & Stream Erosion',
                desc: 'Mass-balanced non-flooding rivers, gorges & alluvial fans',
                glyph: 'Droplet',
                badge: 'FLUVIAL',
                cls: 'featured-erosion',
                action: () => this.addProceduralLayer('erosion-hydraulic')
            },
            {
                title: '+ Frost & Thermal Pitting',
                desc: 'Cryogenic ice-wedge spalling + solar tafoni honeycomb pits',
                glyph: 'Crack',
                badge: 'PITTING',
                cls: 'featured-erosion',
                action: () => this.addProceduralLayer('erosion-pitting')
            },
            {
                title: '+ Wind Dunes & Canyon Cuts',
                desc: 'Venturi sandstone wall cuts & undercutting + desert dunes',
                glyph: 'Wind',
                badge: 'AEOLIAN',
                cls: 'featured-erosion',
                action: () => this.addProceduralLayer('erosion-wind')
            },
            {
                title: '+ Cliff Rockfall & Talus',
                desc: 'Direct SDF cliff wedge calving & 35° conical scree aprons',
                glyph: 'Landslide',
                badge: 'ROCKFALL',
                cls: 'featured-erosion',
                action: () => this.addProceduralLayer('erosion-rockfall')
            },
            {
                title: '+ Chemical Karst & Varnish',
                desc: 'Carbonate doline sinkholes, rillenkarren & Fe/Mn staining',
                glyph: 'Flask',
                badge: 'CHEMICAL',
                cls: 'featured-erosion',
                action: () => this.addProceduralLayer('erosion-chemical')
            },
            {
                title: '+ 3D Graded Spline (Gizmo)',
                desc: 'Ramp, ridge, road or pass — drag Green Y ↕ arrow up/down',
                glyph: 'Gizmo',
                badge: '3D GIZMO',
                cls: 'featured-spline',
                action: () => this.addNew3DSplineLayer('grade', '3D Graded Spline Ramp')
            },
            {
                title: '+ 3D Rock Arch Bridge Spline',
                desc: 'True 3D overhanging rock arch swept along 3D knots',
                glyph: 'Arch',
                badge: '3D SDF',
                cls: '',
                action: () => this.addNew3DSplineLayer('arch3d', '3D Rock Arch Bridge')
            },
            {
                title: '+ River / Canyon Spline',
                desc: 'Carve 3D graded river valley or gorge channel',
                glyph: 'Spline',
                badge: 'SPLINE',
                cls: '',
                action: () => this.addNew3DSplineLayer('river', '3D River Valley Spline')
            },
            {
                title: '+ Hybrid Multifractal',
                desc: 'Alluvial valleys + craggy continental peaks',
                glyph: 'Mountain',
                badge: 'FRACTAL',
                cls: '',
                action: () => this.addProceduralLayer('multifractal')
            },
            {
                title: '+ Ridged Mountain Spine',
                desc: 'Sharp tectonic arête crests & directional chains',
                glyph: 'Activity',
                badge: 'RIDGE',
                cls: '',
                action: () => this.addProceduralLayer('ridged')
            },
            {
                title: '+ Voronoi Cliff Mesa',
                desc: 'Stepped basalt blocks, craters, or fracture ridges',
                glyph: 'Boxes',
                badge: 'CELLULAR',
                cls: '',
                action: () => this.addProceduralLayer('voronoi')
            },
            {
                title: '+ Stratigraphic Terraces',
                desc: 'Geological dipping benches & canyon strata',
                glyph: 'Layers',
                badge: 'STRATA',
                cls: '',
                action: () => this.addProceduralLayer('terrace')
            }
        ];

        for (const Item of QuickItems)
        {
            const Btn = MakeEl('button', 'quick-add-card' + (Item.cls ? ` ${Item.cls}` : ''));
            Btn.type = 'button';
            const Icon = MakeEl('span', 'quick-add-icon', ConstructGlyph(Item.glyph));
            const Copy = MakeEl('span', 'quick-add-copy', [
                MakeEl('strong', '', Item.title),
                MakeEl('small', '', Item.desc)
            ]);
            const Badge = MakeEl('span', 'preset-badge', Item.badge);
            Btn.append(Icon, Copy, Badge);
            Btn.addEventListener('click', Item.action);
            List.appendChild(Btn);
        }
    }

    _buildPresetStrip()
    {
        const Strip = document.getElementById('preset-strip');
        if (!Strip) return;
        Strip.innerHTML = '';

        const CoreChips = [
            ['All 3 Demo Terrains', () => { this.view3D.viewScope = 'all'; document.getElementById('scope-select').value = 'all'; this.view3D.frameVisibleWorld(); this.refreshChrome(); }],
            ['Solo 01 · Alpine (Group A)', () => this._focusSingleRegion(0)],
            ['Solo 02 · Basalt Cliffs (Solo)', () => this._focusSingleRegion(1)],
            ['Solo 03 · Utah Canyon (Group A)', () => this._focusSingleRegion(2)]
        ];

        for (let I = 0; I < CoreChips.length; ++I)
        {
            const [Label, Fn] = CoreChips[I];
            const Chip = MakeEl('button', 'history-chip' + (I === 0 ? ' current' : ''), Label);
            Chip.type = 'button';
            Chip.addEventListener('click', () =>
            {
                for (const C of Strip.querySelectorAll('.history-chip')) C.classList.remove('current');
                Chip.classList.add('current');
                Fn();
            });
            Strip.appendChild(Chip);
        }

        // All 18 Physically-Grounded Biome + Erosion + SatMap + Stamp Presets!
        for (const Preset of TERRAIN_BIOME_PRESETS)
        {
            const Chip = MakeEl('button', 'history-chip', `Preset · ${Preset.name}`);
            Chip.type = 'button';
            Chip.title = `${Preset.category}: ${Preset.summary}`;
            Chip.dataset.presetId = Preset.id;
            Chip.addEventListener('click', () =>
            {
                for (const C of Strip.querySelectorAll('.history-chip')) C.classList.remove('current');
                Chip.classList.add('current');
                this.applyPresetToActiveRegion(Preset.id);
            });
            Strip.appendChild(Chip);
        }
    }

    applyPresetToActiveRegion(PresetId)
    {
        const Reg = this.getActiveRegion();
        if (!Reg) return;
        this.pushUndoSnapshot();
        ApplyBiomePresetToRegion(Reg, PresetId, CreateTerrainLayer);
        EvaluateTerrainRegion(this.world, Reg);
        Reg.meshDirty = true;
        this.activeLayerId = Reg.stack[Reg.stack.length - 1]?.id || null;
        const Sp = Reg.stack.find(L => L.type === 'spline');
        this.view3D.activeSplineLayerId = Sp?.id || null;
        this.map2D.invalidateRegionPreview(Reg.id);
        this.map2D.requestRedraw();
        this.refreshChrome();
        this.rebuildInspector();
    }

    _focusSingleRegion(Index)
    {
        const Reg = this.world.regions[Index];
        if (!Reg) return;
        Reg.enabled = true;
        this._setRegionSelection(Reg.id, [Reg.id]);
        this.view3D.viewScope = 'solo';
        const Sel = document.getElementById('scope-select');
        if (Sel) Sel.value = 'solo';
        this.map2D.frameBounds(Reg.bounds, 1.32);
        this.view3D.frameRegion(Reg);
        this.refreshChrome();
    }

    /*======================================================================================================================================
                                       FIRST-CLASS 3D SPLINE LAYER CREATION & GIZMO ACTIVATION
    ======================================================================================================================================*/
    addNew3DSplineLayer(SplineMode = 'grade', CustomName = '3D Graded Spline Landform')
    {
        const Reg = this.getActiveRegion();
        if (!Reg) return;
        this.pushUndoSnapshot();

        const B = Reg.bounds;
        const SampleH = (Wx, Wz) => this.view3D.sampleTerrainSurfaceY(Reg, Wx, Wz);

        const P0x = Math.round(B.x + B.width * 0.28), P0z = Math.round(B.z + B.depth * 0.34);
        const P1x = Math.round(B.x + B.width * 0.50), P1z = Math.round(B.z + B.depth * 0.50);
        const P2x = Math.round(B.x + B.width * 0.72), P2z = Math.round(B.z + B.depth * 0.66);

        // Give the middle knot a clear initial +42m uplift so the 3D spline & Y-Gizmo effect is immediately dramatic!
        const MidBoost = SplineMode === 'arch3d' ? 68.0 : (SplineMode === 'canyon' || SplineMode === 'river' ? -18.0 : 42.0);
        const NewSpline = CreateTerrainLayer('spline', {
            name: CustomName,
            splineMode: SplineMode,
            width: SplineMode === 'arch3d' ? 64.0 : 110.0,
            amount: SplineMode === 'arch3d' ? 28.0 : 34.0,
            bankSmooth: 0.62,
            meander: SplineMode === 'river' ? 0.22 : 0.08,
            falloff: { mode: 'none', distance: 120.0, edgeFloor: 1.0 },
            points: [
                [P0x, P0z, Math.round((SampleH(P0x, P0z) + 6.0) * 10) / 10],
                [P1x, P1z, Math.round((SampleH(P1x, P1z) + MidBoost) * 10) / 10],
                [P2x, P2z, Math.round((SampleH(P2x, P2z) + 6.0) * 10) / 10]
            ]
        });

        Reg.stack.push(NewSpline);
        this.activeLayerId = NewSpline.id;
        this.view3D.activeSplineLayerId = NewSpline.id;
        this.view3D.selectedKnotIndex = 1; // Select middle knot so user can drag Green Y ↕ arrow immediately!
        this.view3D.showGizmo = true;
        this.select3DTool('spline');

        if (this.workspaceMode === '2d') this.setWorkspaceMode('split');

        EvaluateTerrainRegion(this.world, Reg, NewSpline.id);
        Reg.meshDirty = true;
        this.map2D.invalidateRegionPreview(Reg.id);

        this.inspectorTab = 'spline';
        this._syncInspectorTabButtons();
        this.refreshChrome();
        this.rebuildInspector();
    }

    addProceduralLayer(Type)
    {
        const Reg = this.getActiveRegion();
        if (!Reg) return;
        this.pushUndoSnapshot();
        const Lyr = CreateTerrainLayer(Type, {
            seed: Math.floor(1000 + Math.random() * 89000),
            falloff: { mode: Type === 'voronoi' ? 'none' : 'soft', distance: 280.0, edgeFloor: 0.0 }
        });
        Reg.stack.push(Lyr);
        this.activeLayerId = Lyr.id;
        EvaluateTerrainRegion(this.world, Reg, Lyr.id);
        Reg.meshDirty = true;
        this.map2D.invalidateRegionPreview(Reg.id);
        this.inspectorTab = 'layers';
        this._syncInspectorTabButtons();
        this.refreshChrome();
        this.rebuildInspector();
    }

    /*======================================================================================================================================
                                                SNAPSHOT UNDO / REDO & STATE HELPERS
    ======================================================================================================================================*/
    pushUndoSnapshot()
    {
        try
        {
            const Snap = JSON.stringify(this.world.toJSON());
            if (this.undoStack.length > 0 && this.undoStack[this.undoStack.length - 1] === Snap) return;
            this.undoStack.push(Snap);
            if (this.undoStack.length > 24) this.undoStack.shift();
            this.redoStack.length = 0;
        }
        catch (_) { /* ignore */ }
    }

    undo()
    {
        if (!this.undoStack.length) return;
        this.redoStack.push(JSON.stringify(this.world.toJSON()));
        this._restoreWorldData(JSON.parse(this.undoStack.pop()));
    }

    redo()
    {
        if (!this.redoStack.length) return;
        this.undoStack.push(JSON.stringify(this.world.toJSON()));
        this._restoreWorldData(JSON.parse(this.redoStack.pop()));
    }

    _restoreWorldData(JsonObj)
    {
        this.world.loadFromJSON(JsonObj);
        for (const R of this.world.regions)
        {
            EvaluateTerrainRegion(this.world, R, this.activeLayerId);
            R.meshDirty = true;
        }
        const First = this.world.regions[0];
        this.activeRegionId = First?.id || null;
        this.selectedRegionIds = new Set(this.activeRegionId ? [this.activeRegionId] : []);
        const Sp = First?.stack.find(L => L.type === 'spline');
        this.activeLayerId = Sp?.id || First?.stack[0]?.id || null;
        this.view3D.activeSplineLayerId = Sp?.id || null;
        this.map2D.activeMaskLayerId = this.world.maskLayers[0]?.id || null;
        this.map2D.activeRegionId = this.activeRegionId;
        this.map2D.selectedRegionIds = new Set(this.selectedRegionIds);
        this.view3D.activeRegionId = this.activeRegionId;
        this.view3D.selectedRegionIds = new Set(this.selectedRegionIds);
        this.map2D.invalidateMaskCache();
        this._syncOceanUI();
        this.refreshChrome();
        this.rebuildInspector();
    }

    getActiveRegion()
    {
        return this.world.getRegion(this.activeRegionId) || this.world.regions[0] || null;
    }

    _scheduleDirtyRegionsEvaluation()
    {
        if (this._evalTimer) return;
        this._evalTimer = setTimeout(() =>
        {
            this._evalTimer = null;
            this._evaluateDirtyRegionsNow();
        }, 38);
    }

    _evaluateDirtyRegionsNow()
    {
        for (const R of this.world.regions)
        {
            if (R.dirty)
            {
                EvaluateTerrainRegion(this.world, R, R.id === this.activeRegionId ? this.activeLayerId : null);
                R.meshDirty = true;
                this.map2D.invalidateRegionPreview(R.id);
            }
        }
        this.map2D.requestRedraw();
    }

    _setRegionSelection(PrimaryId, SelectedIdsArray)
    {
        this.activeRegionId = PrimaryId;
        this.selectedRegionIds = new Set(SelectedIdsArray);
        this.map2D.activeRegionId = PrimaryId;
        this.map2D.selectedRegionIds = new Set(SelectedIdsArray);
        this.view3D.activeRegionId = PrimaryId;
        this.view3D.selectedRegionIds = new Set(SelectedIdsArray);

        const Reg = this.getActiveRegion();
        if (Reg)
        {
            if (Reg.maskLayerId) this.map2D.activeMaskLayerId = Reg.maskLayerId;
            if (!Reg.stack.some(L => L.id === this.activeLayerId))
            {
                const Sp = Reg.stack.find(L => L.type === 'spline');
                this.activeLayerId = Sp?.id || Reg.stack[Reg.stack.length - 1]?.id || null;
            }
            const ActiveSp = Reg.stack.find(L => L.id === this.activeLayerId && L.type === 'spline')
                          || Reg.stack.find(L => L.type === 'spline');
            this.view3D.activeSplineLayerId = ActiveSp?.id || null;
        }
        this.map2D.requestRedraw();
        this.refreshChrome();
        this.rebuildInspector();
    }

    _createNewRegionWithBounds(Bounds)
    {
        const Idx = this.world.regions.length + 1;
        const ActiveMask = this.world.getMaskLayer(this.map2D.activeMaskLayerId);
        const NewReg = this.world.addTerrainRegion({
            name: `Terrain ${String(Idx).padStart(2, '0')} · Custom`,
            maskLayerId: ActiveMask ? ActiveMask.id : null,
            color: MASK_PALETTE[(Idx - 1) % MASK_PALETTE.length],
            bounds: Bounds,
            resolution: 136,
            baseElevation: 3.0,
            slabThickness: 6.5,
            shorelineBevel: 18.0,
            stack: [
                CreateTerrainLayer('multifractal', {
                    name: 'Base Multifractal Landform',
                    amplitude: 165.0,
                    scale: 2.3,
                    falloff: { mode: 'soft', distance: Math.min(Bounds.width, Bounds.depth) * 0.24, edgeFloor: 0.02 }
                })
            ]
        });
        EvaluateTerrainRegion(this.world, NewReg);
        NewReg.meshDirty = true;
        this._setRegionSelection(NewReg.id, [NewReg.id]);
    }

    /*======================================================================================================================================
                                          WORKSPACE MODES, TOOLS & HEADER BINDINGS
    ======================================================================================================================================*/
    setWorkspaceMode(Mode)
    {
        this.workspaceMode = Mode;
        const Grid = document.getElementById('StageGrid');
        Grid.classList.remove('mode-2d', 'mode-3d', 'mode-split');
        Grid.classList.add(`mode-${Mode}`);

        for (const Btn of document.querySelectorAll('.top-nav .nav-button[data-ws]'))
        {
            Btn.classList.toggle('active', Btn.dataset.ws === Mode);
        }
        requestAnimationFrame(() => this.map2D.requestRedraw());
    }

    select2DTool(ToolId)
    {
        this.map2D.tool = ToolId;
        for (const [K, B] of this.btns2D.entries()) B.classList.toggle('active', K === ToolId);
        const Names = { brush: 'Brush Land', erase: 'Erase Bay', polygon: 'Polygon Continent', bounds: 'Draw Bounds Box', select: 'Resize Bounds', spline: '2D Spline Knots' };
        const Lbl = document.getElementById('hud-2d-tool');
        if (Lbl) Lbl.textContent = Names[ToolId] || ToolId;
        this.map2D.requestRedraw();
    }

    select3DTool(ToolId)
    {
        this.view3D.tool3D = ToolId;
        for (const [K, B] of this.btns3D.entries()) B.classList.toggle('active', K === ToolId);
        document.getElementById('pill-place-knot')?.classList.toggle('active', ToolId === 'spline-add');
        const Names = {
            spline: 'Spline + 3D Gizmo (Drag Y ↕)',
            'spline-add': '+ Click Terrain to Place Knot',
            navigate: 'Orbit & Select',
            raise: '3D Sculpt · Raise',
            lower: '3D Sculpt · Carve',
            smooth: '3D Sculpt · Smooth',
            flatten: '3D Sculpt · Terrace',
            overhang: '3D Sculpt · Arch'
        };
        const Lbl = document.getElementById('hud-3d-tool');
        if (Lbl) Lbl.textContent = Names[ToolId] || ToolId;
    }

    _syncOceanUI()
    {
        const On = this.world.oceanVisible !== false;
        const Btn = document.getElementById('toggle-ocean-btn');
        if (Btn)
        {
            Btn.classList.toggle('active', On);
            Btn.textContent = On ? 'Ocean ON' : 'Ocean OFF (Slab)';
        }
    }

    _syncInspectorTabButtons()
    {
        for (const Btn of document.querySelectorAll('#inspector-tabs button'))
        {
            Btn.classList.toggle('active', Btn.dataset.itab === this.inspectorTab);
        }
    }

    _bindHeaderAndTransport()
    {
        // Workspace switcher
        for (const Btn of document.querySelectorAll('.top-nav .nav-button[data-ws]'))
        {
            Btn.addEventListener('click', () => this.setWorkspaceMode(Btn.dataset.ws));
        }

        // Inspector tabs
        for (const Btn of document.querySelectorAll('#inspector-tabs button'))
        {
            Btn.addEventListener('click', () =>
            {
                this.inspectorTab = Btn.dataset.itab;
                this._syncInspectorTabButtons();
                this.rebuildInspector();
            });
        }

        // Outliner search & category filters
        document.getElementById('scene-search')?.addEventListener('input', E =>
        {
            this.outlinerSearch = E.target.value.trim().toLowerCase();
            this.refreshChrome();
        });
        for (const Btn of document.querySelectorAll('#scene-filters button'))
        {
            Btn.addEventListener('click', () =>
            {
                this.outlinerFilter = Btn.dataset.filter;
                for (const B of document.querySelectorAll('#scene-filters button')) B.classList.toggle('active', B === Btn);
                this.refreshChrome();
            });
        }

        document.getElementById('compact-outliner')?.addEventListener('click', E =>
        {
            document.getElementById('left-panel')?.classList.toggle('compact');
            E.currentTarget.classList.toggle('active');
        });

        // One-Click Add 3D Spline buttons (Outliner '+', Stage Bar '+ Add Spline', Transport '+ New 3D Spline')
        document.getElementById('add-button')?.addEventListener('click', () => this.addNew3DSplineLayer('grade', '3D Graded Spline Ramp'));
        document.getElementById('pill-add-spline')?.addEventListener('click', () => this.addNew3DSplineLayer('grade', '3D Graded Spline Ramp'));
        document.getElementById('dock-new-spline-btn')?.addEventListener('click', () => this.addNew3DSplineLayer('grade', '3D Graded Spline Ramp'));

        document.getElementById('pill-place-knot')?.addEventListener('click', () =>
        {
            if (this.workspaceMode === '2d') this.setWorkspaceMode('split');
            this.select3DTool(this.view3D.tool3D === 'spline-add' ? 'spline' : 'spline-add');
        });

        document.getElementById('new-scene-btn')?.addEventListener('click', () =>
        {
            if (this.workspaceMode === '3d') this.setWorkspaceMode('split');
            this.select2DTool('bounds');
        });

        // Viewport top bar selects & toggles
        document.getElementById('scope-select')?.addEventListener('change', E =>
        {
            this.view3D.viewScope = E.target.value;
            this.refreshChrome();
        });
        document.getElementById('lens-select')?.addEventListener('change', E =>
        {
            this.view3D.lensMode = Number(E.target.value);
        });
        document.getElementById('toggle-rivers-btn')?.addEventListener('click', E =>
        {
            this.view3D.showRivers = !this.view3D.showRivers;
            E.currentTarget.classList.toggle('active', this.view3D.showRivers);
            E.currentTarget.textContent = this.view3D.showRivers ? 'Rivers ON' : 'Rivers OFF';
            this.rebuildInspector();
        });
        document.getElementById('toggle-ocean-btn')?.addEventListener('click', () =>
        {
            this.world.oceanVisible = !this.world.oceanVisible;
            this._syncOceanUI();
            this.rebuildInspector();
        });

        // Live Weather & Erosion Transport Controls (Solo 1-by-1 vs Shared Weather Group!)
        document.getElementById('sim-play-btn')?.addEventListener('click', () => this.toggleSimulationPlaying());
        document.getElementById('sim-step1-btn')?.addEventListener('click', () => this.stepWeatherSimulation(1, true));
        document.getElementById('sim-step15-btn')?.addEventListener('click', () => this.stepWeatherSimulation(15, true));
        document.getElementById('sim-reset-btn')?.addEventListener('click', () => this.resetSimulationForTarget());
        document.getElementById('sim-target-select')?.addEventListener('change', E =>
        {
            this.simTargetScope = E.target.value;
            this._syncSimWeatherReadout();
        });
        document.getElementById('toggle-gizmo-btn')?.addEventListener('click', E =>
        {
            this.view3D.showGizmo = !this.view3D.showGizmo;
            E.currentTarget.classList.toggle('active', this.view3D.showGizmo);
            this.rebuildInspector();
        });
        document.getElementById('toggle-bounds-btn')?.addEventListener('click', E =>
        {
            this.view3D.showBounds3D = !this.view3D.showBounds3D;
            E.currentTarget.classList.toggle('active', this.view3D.showBounds3D);
            this.rebuildInspector();
        });
        document.getElementById('toggle-contours-btn')?.addEventListener('click', E =>
        {
            this.view3D.showContours = !this.view3D.showContours;
            E.currentTarget.classList.toggle('active', this.view3D.showContours);
            this.rebuildInspector();
        });
        document.getElementById('focus-btn')?.addEventListener('click', () =>
        {
            this.map2D.frameAllRegions();
            this.view3D.frameVisibleWorld();
        });
        document.getElementById('maximize-btn')?.addEventListener('click', E =>
        {
            document.getElementById('studio-workspace')?.classList.toggle('maximized');
            E.currentTarget.classList.toggle('active');
            requestAnimationFrame(() => this.map2D.requestRedraw());
        });

        // Object heading name & enabled switch
        document.getElementById('object-name')?.addEventListener('change', E =>
        {
            const Reg = this.getActiveRegion();
            if (Reg && E.target.value.trim())
            {
                Reg.name = E.target.value.trim();
                this.map2D.requestRedraw();
                this.refreshChrome();
            }
        });
        document.getElementById('object-enabled')?.addEventListener('change', E =>
        {
            const Reg = this.getActiveRegion();
            if (Reg)
            {
                Reg.enabled = E.target.checked;
                this.map2D.requestRedraw();
                this.refreshChrome();
            }
        });

        // Reset 3 Demo Terrains
        document.getElementById('reset-demo-btn')?.addEventListener('click', () =>
        {
            this.pushUndoSnapshot();
            SeedThreeDemoTerrains(this.world);
            for (const R of this.world.regions) R.meshDirty = true;
            this.map2D.activeMaskLayerId = this.world.maskLayers[0]?.id || null;
            this._setRegionSelection(this.world.regions[0].id, [this.world.regions[0].id]);
            this.map2D.invalidateMaskCache();
            this._syncOceanUI();
            this.map2D.frameAllRegions();
            this.view3D.frameVisibleWorld();
        });

        // Lower Transport Sliders (Brush/Spline Width, Exposure, Sky Atmosphere, Fit Bounds, Save JSON)
        const RadRange = document.getElementById('dock-radius-range');
        const RadVal = document.getElementById('dock-radius-val');
        const SyncRadFill = V =>
        {
            RadRange.style.setProperty('--fill', `${(((V - 20) / 580) * 100).toFixed(1)}%`);
            RadVal.textContent = `${Math.round(V)} m`;
        };
        SyncRadFill(120);
        RadRange?.addEventListener('input', () =>
        {
            const V = parseFloat(RadRange.value);
            SyncRadFill(V);
            this.map2D.brushRadiusM = V;
            this.view3D.sculptRadiusM = V;
            this.map2D.requestRedraw();
        });

        const ExpRange = document.getElementById('dock-exposure-range');
        const ExpVal = document.getElementById('dock-exposure-val');
        const SyncExpFill = V =>
        {
            ExpRange.style.setProperty('--fill', `${(((V - 0.35) / 1.30) * 100).toFixed(1)}%`);
            ExpVal.textContent = V.toFixed(2);
        };
        SyncExpFill(this.view3D.exposure);
        ExpRange?.addEventListener('input', () =>
        {
            const V = parseFloat(ExpRange.value);
            SyncExpFill(V);
            this.view3D.exposure = V;
        });

        document.getElementById('dock-atmos-select')?.addEventListener('change', E =>
        {
            this.view3D.atmosphereMode = Number(E.target.value);
        });

        document.getElementById('dock-fit-mask-btn')?.addEventListener('click', () =>
        {
            const Reg = this.getActiveRegion();
            const Mask = Reg?.maskLayerId ? this.world.getMaskLayer(Reg.maskLayerId) : this.world.getMaskLayer(this.map2D.activeMaskLayerId);
            if (!Reg || !Mask) return;
            const Fitted = this.world.computeLayerPaintedBounds(Mask, 90.0);
            if (Fitted)
            {
                this.pushUndoSnapshot();
                Reg.bounds = Fitted;
                EvaluateTerrainRegion(this.world, Reg, this.activeLayerId);
                Reg.meshDirty = true;
                this.map2D.invalidateRegionPreview(Reg.id);
                this.refreshChrome();
                this.rebuildInspector();
            }
        });

        // Undo / Redo / Save / Load / Export
        document.getElementById('undo-btn')?.addEventListener('click', () => this.undo());
        document.getElementById('redo-btn')?.addEventListener('click', () => this.redo());
        document.getElementById('dock-save-json-btn')?.addEventListener('click', () =>
        {
            const Text = JSON.stringify(this.world.toJSON(), null, 2);
            this._triggerDownload(new Blob([Text], { type: 'application/json' }), 'frontier-terrain-world.json');
        });

        const FileInput = document.getElementById('FileLoadJson');
        document.getElementById('import-btn')?.addEventListener('click', () => FileInput?.click());
        FileInput?.addEventListener('change', async () =>
        {
            const F = FileInput.files?.[0];
            if (!F) return;
            try
            {
                const Parsed = JSON.parse(await F.text());
                this.pushUndoSnapshot();
                this._restoreWorldData(Parsed);
                this.map2D.frameAllRegions();
                this.view3D.frameVisibleWorld();
            }
            catch (Err) { console.error(Err); }
            FileInput.value = '';
        });

        document.getElementById('export-button')?.addEventListener('click', () => this._exportObj());

        // Keyboard Shortcuts
        window.addEventListener('keydown', E =>
        {
            if (E.target && (E.target.tagName === 'INPUT' || E.target.tagName === 'TEXTAREA' || E.target.tagName === 'SELECT')) return;
            if (E.code === 'Space') this.map2D.spaceDown = true;

            if ((E.ctrlKey || E.metaKey) && E.key.toLowerCase() === 'z')
            {
                E.preventDefault();
                if (E.shiftKey) this.redo(); else this.undo();
                return;
            }
            if ((E.ctrlKey || E.metaKey) && E.key.toLowerCase() === 'y')
            {
                E.preventDefault();
                this.redo();
                return;
            }

            const K = E.key.toLowerCase();
            if (E.key === '1') this.setWorkspaceMode('2d');
            else if (E.key === '2') this.setWorkspaceMode('3d');
            else if (E.key === '3') this.setWorkspaceMode('split');
            else if (E.key === 'Tab')
            {
                E.preventDefault();
                document.getElementById('maximize-btn')?.click();
            }
            else if (K === 'g') this.select3DTool('spline');
            else if (K === 'k') this.select3DTool('spline-add');
            else if (K === 'n') this.select3DTool('navigate');
            else if (K === 'b') this.select2DTool('brush');
            else if (K === 'e') this.select2DTool('erase');
            else if (K === 'p') this.select2DTool('polygon');
            else if (K === 'r') this.select2DTool('bounds');
            else if (K === 'v') this.select2DTool('select');
            else if (K === 's' && !E.ctrlKey) this.select2DTool('spline');
            else if (K === 'w') document.getElementById('toggle-ocean-btn')?.click();
            else if (K === 'f') document.getElementById('focus-btn')?.click();
            else if (E.key === 'Delete' || E.key === 'Backspace')
            {
                // Delete selected 3D Spline Knot if > 2 knots remain
                const Ctx = this.view3D.getActiveSplineContext();
                if (Ctx && Ctx.layer.points.length > 2)
                {
                    this.pushUndoSnapshot();
                    Ctx.layer.points.splice(this.view3D.selectedKnotIndex, 1);
                    this.view3D.selectedKnotIndex = Math.max(0, this.view3D.selectedKnotIndex - 1);
                    EvaluateTerrainRegion(this.world, Ctx.region, Ctx.layer.id);
                    Ctx.region.meshDirty = true;
                    this.map2D.invalidateRegionPreview(Ctx.region.id);
                    this.rebuildInspector();
                }
            }
            else if (E.key === 'Enter' && this.map2D.tool === 'polygon')
            {
                this.map2D.commitPolygonDraft(E.shiftKey);
            }
            else if (E.key === 'Escape' && this.map2D.polygonDraft.length > 0)
            {
                this.map2D.polygonDraft = [];
                this.map2D.requestRedraw();
            }
        });
        window.addEventListener('keyup', E => { if (E.code === 'Space') this.map2D.spaceDown = false; });
    }

    _exportObj()
    {
        const Targets = this.view3D.getVisibleRegions();
        const { text } = ExportWorldTerrainsObj(this.world, Targets.length ? Targets : this.world.regions);
        this._triggerDownload(new Blob([text], { type: 'text/plain' }), 'frontier-sdf-terrains.obj');
    }

    _exportStl()
    {
        const Targets = this.view3D.getVisibleRegions();
        const { bytes } = ExportWorldTerrainsBinaryStl(this.world, Targets.length ? Targets : this.world.regions);
        this._triggerDownload(new Blob([bytes], { type: 'application/octet-stream' }), 'frontier-sdf-terrains.stl');
    }

    _triggerDownload(BlobObj, Filename)
    {
        const Url = URL.createObjectURL(BlobObj);
        const A = document.createElement('a');
        A.href = Url;
        A.download = Filename;
        document.body.appendChild(A);
        A.click();
        A.remove();
        setTimeout(() => URL.revokeObjectURL(Url), 2500);
    }

    /*======================================================================================================================================
                                       TRAPEZOIDAL TABS, OUTLINER TREE & TELEMETRY REFRESH
    ======================================================================================================================================*/
    refreshChrome()
    {
        const Reg = this.getActiveRegion();

        // 1. Slanted Trapezoidal Region Tabs in Header
        const TabsEl = document.getElementById('region-tabs');
        if (TabsEl)
        {
            TabsEl.innerHTML = '';
            for (const R of this.world.regions)
            {
                const Tab = MakeEl('button', 'document-tab' + (R.id === this.activeRegionId ? ' active' : ''));
                Tab.type = 'button';
                Tab.appendChild(MakeEl('span', 'document-label', R.name));
                Tab.addEventListener('click', E =>
                {
                    const Multi = E.shiftKey || E.ctrlKey || E.metaKey;
                    const Next = new Set(this.selectedRegionIds);
                    if (Multi)
                    {
                        if (Next.has(R.id) && Next.size > 1) Next.delete(R.id);
                        else Next.add(R.id);
                    }
                    else { Next.clear(); Next.add(R.id); }
                    this._setRegionSelection(R.id, Array.from(Next));
                });
                TabsEl.appendChild(Tab);
            }
        }

        // 2. Census Stats & Subtitle
        const OnCount = this.world.regions.filter(R => R.enabled).length;
        const TotalLayers = this.world.regions.reduce((Acc, R) => Acc + R.stack.length, 0);
        const TilesCount = this.world.totalAllocatedTiles();
        document.getElementById('stat-terrains-on').textContent = String(OnCount);
        document.getElementById('stat-layers-total').textContent = String(TotalLayers);
        document.getElementById('outliner-subtitle').textContent = `${this.world.regions.length} Terrains · ${TilesCount} Sparse Tiles`;

        // 3. Outliner Tree (Terrains + Nested Layer/Spline Stack + 2D Masks)
        const Outliner = document.getElementById('OutlinerContent');
        Outliner.innerHTML = '';
        const Q = this.outlinerSearch;

        if (this.outlinerFilter !== 'masks')
        {
            const Group = MakeEl('div', 'tree-group');
            Group.appendChild(MakeEl('div', 'tree-group-title', [
                ConstructGlyph('Scan'),
                MakeEl('span', '', 'Terrain Bounds & Layer Stacks'),
                MakeEl('span', 'group-count', String(this.world.regions.length))
            ]));

            for (const R of this.world.regions)
            {
                const MatchReg = !Q || R.name.toLowerCase().includes(Q);
                if (this.outlinerFilter !== 'splines' && MatchReg)
                {
                    const IsPrim = R.id === this.activeRegionId;
                    const IsMulti = this.selectedRegionIds.has(R.id);
                    const Row = MakeEl('div', 'tree-row' + (IsPrim ? ' selected' : '') + (IsMulti ? ' multi-selected' : '') + (!R.enabled ? ' is-off' : ''));
                    Row.style.setProperty('--row-accent', '#eff4cf');

                    const SelBtn = MakeEl('button', 'row-select');
                    SelBtn.type = 'button';
                    const GlyphSpan = MakeEl('span', 'row-glyph', ConstructGlyph('Mountain'));
                    GlyphSpan.style.color = R.color || '#e8c27a';
                    const B = R.bounds;
                    const WGrp = R.weatherGroup && R.weatherGroup !== 'solo' ? ` · ⇄ ${R.weatherGroup.replace('group-', 'GRP-').toUpperCase()}` : ' · SOLO';
                    const Copy = MakeEl('span', 'row-copy', [
                        MakeEl('div', 'row-name', R.name),
                        MakeEl('div', 'row-meta', `${(B.width / 1000).toFixed(2)}×${(B.depth / 1000).toFixed(2)} km · ${R.stack.length} layers${WGrp}`)
                    ]);
                    SelBtn.append(GlyphSpan, Copy);
                    SelBtn.addEventListener('click', E =>
                    {
                        const Multi = E.shiftKey || E.ctrlKey || E.metaKey;
                        const Next = new Set(this.selectedRegionIds);
                        if (Multi) { if (Next.has(R.id) && Next.size > 1) Next.delete(R.id); else Next.add(R.id); }
                        else { Next.clear(); Next.add(R.id); }
                        this._setRegionSelection(R.id, Array.from(Next));
                    });

                    const End = MakeEl('div', 'row-end-actions');
                    const Eye = MakeEl('button', 'row-mini-btn' + (R.enabled ? ' eye-on' : ''), ConstructGlyph(R.enabled ? 'Eye' : 'EyeOff'));
                    Eye.type = 'button';
                    Eye.title = 'Toggle Terrain Bounds ON / OFF';
                    Eye.addEventListener('click', E =>
                    {
                        E.stopPropagation();
                        R.enabled = !R.enabled;
                        this.map2D.requestRedraw();
                        this.refreshChrome();
                    });
                    const Foc = MakeEl('button', 'row-mini-btn', ConstructGlyph('Focus'));
                    Foc.type = 'button';
                    Foc.title = 'Frame Terrain in 2D & 3D';
                    Foc.addEventListener('click', E =>
                    {
                        E.stopPropagation();
                        this._setRegionSelection(R.id, [R.id]);
                        this.map2D.frameBounds(R.bounds, 1.32);
                        this.view3D.frameRegion(R);
                    });
                    End.append(Eye, Foc);
                    Row.append(SelBtn, End);
                    Group.appendChild(Row);
                }

                // Show nested layers for active region (or all matching layers when filtering by 'splines' or 'erosion')
                if ((R.id === this.activeRegionId && this.outlinerFilter === 'all') || this.outlinerFilter === 'splines' || this.outlinerFilter === 'erosion')
                {
                    for (let I = R.stack.length - 1; I >= 0; --I)
                    {
                        const Lyr = R.stack[I];
                        if (this.outlinerFilter === 'splines' && Lyr.type !== 'spline') continue;
                        if (this.outlinerFilter === 'erosion' && !IsErosionLayerType(Lyr.type)) continue;
                        if (Q && !Lyr.name.toLowerCase().includes(Q)) continue;

                        const IsSelLyr = R.id === this.activeRegionId && Lyr.id === this.activeLayerId;
                        const LRow = MakeEl('div', 'tree-row child-layer' + (IsSelLyr ? ' selected' : '') + (!Lyr.enabled ? ' is-off' : ''));
                        const Meta = LAYER_TYPE_META[Lyr.type] || LAYER_TYPE_META.multifractal;
                        LRow.style.setProperty('--row-accent', Lyr.type === 'spline' ? '#eff4cf' : Meta.accent);

                        const LSel = MakeEl('button', 'row-select');
                        LSel.type = 'button';
                        const LGlyph = MakeEl('span', 'row-glyph', ConstructGlyph(Meta.glyph || 'Layers'));
                        const FallTag = Lyr.type === 'spline'
                            ? `${Lyr.points?.length || 0} 3D knots · ${Lyr.splineMode}`
                            : IsErosionLayerType(Lyr.type)
                                ? `${Meta.badge} · ${Lyr.iterations ?? 12} iters`
                                : (Lyr.falloff?.mode === 'none' ? 'Falloff: NONE (Cliff)' : `Falloff: ${Lyr.falloff?.mode} (${Math.round(Lyr.falloff?.distance || 260)}m)`);
                        LSel.append(LGlyph, MakeEl('span', 'row-copy', [
                            MakeEl('div', 'row-name', Lyr.name),
                            MakeEl('div', 'row-meta', FallTag)
                        ]));
                        LSel.addEventListener('click', () =>
                        {
                            this.activeRegionId = R.id;
                            this.activeLayerId = Lyr.id;
                            if (Lyr.type === 'spline')
                            {
                                this.view3D.activeSplineLayerId = Lyr.id;
                                this.inspectorTab = 'spline';
                            }
                            else
                            {
                                this.inspectorTab = 'layers';
                            }
                            this._syncInspectorTabButtons();
                            EvaluateTerrainRegion(this.world, R, Lyr.id);
                            R.meshDirty = true;
                            this.refreshChrome();
                            this.rebuildInspector();
                        });

                        const LEnd = MakeEl('div', 'row-end-actions');
                        const LEye = MakeEl('button', 'row-mini-btn' + (Lyr.enabled ? ' eye-on' : ''), ConstructGlyph(Lyr.enabled ? 'Eye' : 'EyeOff'));
                        LEye.type = 'button';
                        LEye.addEventListener('click', E =>
                        {
                            E.stopPropagation();
                            Lyr.enabled = !Lyr.enabled;
                            EvaluateTerrainRegion(this.world, R, this.activeLayerId);
                            R.meshDirty = true;
                            this.map2D.invalidateRegionPreview(R.id);
                            this.refreshChrome();
                            this.rebuildInspector();
                        });
                        const LDel = MakeEl('button', 'row-mini-btn', ConstructGlyph('Trash'));
                        LDel.type = 'button';
                        LDel.addEventListener('click', E =>
                        {
                            E.stopPropagation();
                            this.pushUndoSnapshot();
                            R.stack.splice(I, 1);
                            if (this.activeLayerId === Lyr.id) this.activeLayerId = R.stack[R.stack.length - 1]?.id || null;
                            EvaluateTerrainRegion(this.world, R, this.activeLayerId);
                            R.meshDirty = true;
                            this.map2D.invalidateRegionPreview(R.id);
                            this.refreshChrome();
                            this.rebuildInspector();
                        });
                        LEnd.append(LEye, LDel);
                        LRow.append(LSel, LEnd);
                        Group.appendChild(LRow);
                    }
                }
            }
            Outliner.appendChild(Group);
        }

        // 2D Mask Layers Group
        if (this.outlinerFilter === 'all' || this.outlinerFilter === 'masks')
        {
            const MGroup = MakeEl('div', 'tree-group');
            MGroup.appendChild(MakeEl('div', 'tree-group-title', [
                ConstructGlyph('Map'),
                MakeEl('span', '', 'Infinite 2D Mask Layers'),
                MakeEl('span', 'group-count', String(this.world.maskLayers.length))
            ]));
            for (const M of this.world.maskLayers)
            {
                if (Q && !M.name.toLowerCase().includes(Q)) continue;
                const IsAct = M.id === this.map2D.activeMaskLayerId;
                const MRow = MakeEl('div', 'tree-row' + (IsAct ? ' selected' : '') + (!M.visible ? ' is-off' : ''));
                MRow.style.setProperty('--row-accent', M.color);

                const MSel = MakeEl('button', 'row-select');
                MSel.type = 'button';
                const MGlyph = MakeEl('span', 'row-glyph', ConstructGlyph('Map'));
                MGlyph.style.color = M.color;
                MSel.append(MGlyph, MakeEl('span', 'row-copy', [
                    MakeEl('div', 'row-name', M.name),
                    MakeEl('div', 'row-meta', `${M.tiles.size} sparse 1×1 km tiles`)
                ]));
                MSel.addEventListener('click', () =>
                {
                    this.map2D.activeMaskLayerId = M.id;
                    this.refreshChrome();
                });

                const MEnd = MakeEl('div', 'row-end-actions');
                const MEye = MakeEl('button', 'row-mini-btn' + (M.visible ? ' eye-on' : ''), ConstructGlyph(M.visible ? 'Eye' : 'EyeOff'));
                MEye.type = 'button';
                MEye.addEventListener('click', E =>
                {
                    E.stopPropagation();
                    M.visible = !M.visible;
                    this.world.markRegionsDirtyInRect(-1e7, -1e7, 1e7, 1e7, null);
                    this._evaluateDirtyRegionsNow();
                    this.map2D.requestRedraw();
                    this.refreshChrome();
                });
                MEnd.appendChild(MEye);
                MRow.append(MSel, MEnd);
                MGroup.appendChild(MRow);
            }
            Outliner.appendChild(MGroup);
        }

        // 4. Sync Right Object Header & Footer Status
        if (Reg)
        {
            document.getElementById('inspector-crumb').textContent = `Inspector / ${Reg.name}`;
            const NameInp = document.getElementById('object-name');
            if (NameInp && document.activeElement !== NameInp) NameInp.value = Reg.name;
            document.getElementById('object-type').textContent = `THIN-SLAB SDF · ${Reg.resolution} CELLS · ${Reg.stack.length} LAYERS`;
            document.getElementById('object-enabled').checked = Reg.enabled;

            const Floor = ((this.world.seaLevel ?? 0) - Reg.slabThickness).toFixed(1);
            const Peak = Math.round(Reg.runtime?.maxHeight ?? 0);
            document.getElementById('hud-slab-floor').textContent = `${Floor} m`;
            document.getElementById('status-main').textContent = this.selectedRegionIds.size > 1
                ? `${Reg.name} (+${this.selectedRegionIds.size - 1} multi-selected)`
                : Reg.name;
            document.getElementById('status-slab').textContent = `Thin SDF Base: ${Floor} m → +${Peak} m (Zero Deep-Ocean Waste)`;
        }

        const VisCount = this.view3D.getVisibleRegions().length;
        document.getElementById('hud-3d-scope').textContent = `${VisCount} TERRAIN${VisCount === 1 ? '' : 'S'}`;
        document.getElementById('status-tiles').textContent = `Sparse 2D Tiles: ${TilesCount} (${(this.world.totalAllocatedBytes() / 1024).toFixed(0)} KB)`;
        this._syncSimWeatherReadout();
    }

    /*======================================================================================================================================
                              LIVE WEATHER & EROSION SIMULATION COORDINATOR (SOLO 1-BY-1 vs SHARED GROUP)
    ======================================================================================================================================*/
    toggleSimulationPlaying()
    {
        this.simPlaying = !this.simPlaying;
        const Btn = document.getElementById('sim-play-btn');
        const Icon = document.getElementById('sim-play-icon');
        const Lbl = document.getElementById('sim-play-label');
        if (Btn) Btn.classList.toggle('running', this.simPlaying);
        if (Icon) { Icon.innerHTML = ''; Icon.appendChild(ConstructGlyph(this.simPlaying ? 'Pause' : 'Play')); }
        if (Lbl) Lbl.textContent = this.simPlaying ? 'Simulating' : 'Simulate';
    }

    _getSimulationTargetRegions()
    {
        const Active = this.getActiveRegion();
        if (!Active) return [];
        if (this.simTargetScope === 'solo' || (this.simTargetScope === 'group' && (!Active.weatherGroup || Active.weatherGroup === 'solo')))
        {
            return [Active];
        }
        if (this.simTargetScope === 'all' || Active.weatherGroup === 'world-sync')
        {
            return this.world.regions.filter(R => R.enabled);
        }
        const GroupId = Active.weatherGroup;
        return this.world.regions.filter(R => R.enabled && R.weatherGroup === GroupId);
    }

    stepWeatherSimulation(Steps = 1, RebuildUI = false)
    {
        const Targets = this._getSimulationTargetRegions();
        if (!Targets.length) return;

        const Active = this.getActiveRegion();
        const IsSharedGroup = this.simTargetScope !== 'solo' && Active && Active.weatherGroup && Active.weatherGroup !== 'solo';

        for (let S = 0; S < Steps; ++S)
        {
            if (IsSharedGroup)
            {
                // Advance the shared group meteorological clock ONCE and broadcast the EXACT same weather forcing to every linked terrain!
                const Clock = this.weatherCoordinator.getGroupClock(Active.weatherGroup, Active.weatherSpec || {});
                Clock.weatherSpec = { ...(Active.weatherSpec || Clock.weatherSpec) };
                const SharedForcing = EvaluateSeasonalWeatherForcing(Clock.weatherSpec, Clock.stepIndex);
                Clock.stepIndex += 1;

                for (const Reg of Targets)
                {
                    StepRegionLiveSimulation(this.world, Reg, SharedForcing, 1);
                    this.map2D.invalidateRegionPreview(Reg.id);
                }
            }
            else
            {
                // Independent 1-by-1 per-mask weather clock!
                for (const Reg of Targets)
                {
                    StepRegionLiveSimulation(this.world, Reg, null, 1);
                    this.map2D.invalidateRegionPreview(Reg.id);
                }
            }
        }

        this.map2D.requestRedraw();
        this._syncSimWeatherReadout();
        if (RebuildUI)
        {
            this.refreshChrome();
            this.rebuildInspector();
        }
    }

    resetSimulationForTarget()
    {
        if (this.simPlaying) this.toggleSimulationPlaying();
        const Targets = this._getSimulationTargetRegions();
        const Active = this.getActiveRegion();
        if (Active?.weatherGroup) this.weatherCoordinator.resetGroupClock(Active.weatherGroup);
        for (const Reg of Targets)
        {
            ResetRegionLiveSimulation(this.world, Reg);
            this.map2D.invalidateRegionPreview(Reg.id);
        }
        this.map2D.requestRedraw();
        this.refreshChrome();
        this.rebuildInspector();
    }

    _syncSimWeatherReadout()
    {
        const Pill = document.getElementById('sim-weather-pill');
        const Reg = this.getActiveRegion();
        if (!Pill || !Reg) return;

        const Steps = Reg.runtime?.erosion?.totalSteps || 0;
        const Forcing = EvaluateSeasonalWeatherForcing(Reg.weatherSpec || {}, Steps);
        const Grp = (this.simTargetScope === 'solo' || !Reg.weatherGroup || Reg.weatherGroup === 'solo')
            ? 'SOLO'
            : (this.simTargetScope === 'all' ? 'ALL' : Reg.weatherGroup.replace('group-', 'GRP-').replace('world-sync', 'WORLD').toUpperCase());
        const WindDeg = Math.round(((Forcing.windAzimuthDeg ?? 35) % 360 + 360) % 360);
        Pill.textContent = `${Grp} · ${Forcing.seasonName} · ${WindDeg}° · ${Steps}st`;
    }

    /*======================================================================================================================================
                              RIGHT CONTEXTUAL INSPECTOR (KPI TRIO + 5 TABS MATCHING 3D CLAY STUDIO)
    ======================================================================================================================================*/
    rebuildInspector()
    {
        const Content = document.getElementById('InspectorContent');
        Content.innerHTML = '';
        this._activeKnotYSlider = null;

        const Region = this.getActiveRegion();
        if (!Region) return;

        // Top KPI Trio (#eff4cf highlight card just like 3D Clay Studio!)
        const PeakM = Math.round(Region.runtime?.maxHeight ?? 0);
        const AreaKm = (Region.runtime?.landAreaKm2 ?? 0).toFixed(2);
        const SimSteps = Region.runtime?.erosion?.totalSteps ?? 0;
        const WGrpTag = Region.weatherGroup && Region.weatherGroup !== 'solo'
            ? Region.weatherGroup.replace('group-', 'Group ').toUpperCase()
            : 'Solo Clock';
        const Trio = MakeEl('div', 'kpi-trio', [
            MakeEl('div', 'kpi-card highlight', [
                MakeEl('span', 'kpi-label', 'Peak Relief'),
                MakeEl('strong', 'kpi-val', `+${PeakM} m`),
                MakeEl('span', 'kpi-sub', `${AreaKm} km² landmass`)
            ]),
            MakeEl('div', 'kpi-card', [
                MakeEl('span', 'kpi-label', 'Erosion & Weather'),
                MakeEl('strong', 'kpi-val', `${SimSteps} st`),
                MakeEl('span', 'kpi-sub', WGrpTag)
            ]),
            MakeEl('div', 'kpi-card', [
                MakeEl('span', 'kpi-label', 'Gaea & Stack'),
                MakeEl('strong', 'kpi-val', `${Region.stack.length} L`),
                MakeEl('span', 'kpi-sub', `16 maps · ${Region.texturing?.stamps?.length || 0} stamps`)
            ])
        ]);
        Content.appendChild(Trio);

        // 4 Quick-Control Feature Tiles
        const Switches = MakeEl('div', 'property-switches');
        const MakeTile = (Label, Glyph, IsOn, OnClick) =>
        {
            const B = MakeEl('button', 'property-switch' + (IsOn ? '' : ' is-off'));
            B.type = 'button';
            B.append(
                MakeEl('span', 'switch-icon', ConstructGlyph(Glyph)),
                MakeEl('span', 'switch-name', Label),
                MakeEl('span', 'switch-state', IsOn ? 'ON' : 'OFF')
            );
            B.addEventListener('click', OnClick);
            return B;
        };
        Switches.append(
            MakeTile('Rivers', 'Droplet', this.view3D.showRivers !== false, () => document.getElementById('toggle-rivers-btn')?.click()),
            MakeTile('Ocean', 'Water', this.world.oceanVisible !== false, () => document.getElementById('toggle-ocean-btn')?.click()),
            MakeTile('3D Gizmo', 'Gizmo', this.view3D.showGizmo, () => document.getElementById('toggle-gizmo-btn')?.click()),
            MakeTile('Contours', 'Activity', this.view3D.showContours, () => document.getElementById('toggle-contours-btn')?.click())
        );
        Content.appendChild(Switches);

        if (this.inspectorTab === 'weather')
        {
            this._buildWeatherAndGeologyTab(Content, Region);
        }
        else if (this.inspectorTab === 'gaea')
        {
            this._buildGaeaTexturingTab(Content, Region);
        }
        else if (this.inspectorTab === 'spline')
        {
            this._buildSplineInspectorTab(Content, Region);
        }
        else if (this.inspectorTab === 'slab' || this.inspectorTab === 'stage')
        {
            this._buildThinSlabInspectorTab(Content, Region);
            this._buildStageAndExportTab(Content, Region);
        }
        else
        {
            this._buildLayersAndFalloffTab(Content, Region);
        }
    }

    /*--------------------------------------------------------------------------------------------------------------------------------------
                                              TAB 1: LAYERS & PER-LAYER BOUNDARY FALLOFF
    --------------------------------------------------------------------------------------------------------------------------------------*/
    _buildLayersAndFalloffTab(Content, Region)
    {
        const ActiveLayer = Region.stack.find(L => L.id === this.activeLayerId) || Region.stack[Region.stack.length - 1];

        // Quick Add Bar at top of Layers tab (Landforms + Composable Physics Erosion Layers!)
        const StackGroup = MakePropertyGroup('Composable Layer & Erosion Stack', 'Layers', `${Region.stack.length} LAYERS`, true,
            'Stack base landforms, splines, and physically-based erosion processes in any bottom-to-top order.');
        const BtnRow = MakeEl('div', 'studio-btn-row');
        const BtnAddSp = MakeEl('button', 'button export-button', '+ 3D Spline');
        BtnAddSp.type = 'button';
        BtnAddSp.addEventListener('click', () => this.addNew3DSplineLayer('grade', '3D Graded Spline Ramp'));

        const BtnAddFrac = MakeEl('button', 'button', '+ Multifractal');
        BtnAddFrac.type = 'button';
        BtnAddFrac.addEventListener('click', () => this.addProceduralLayer('multifractal'));

        const BtnAddVor = MakeEl('button', 'button', '+ Voronoi Cliff');
        BtnAddVor.type = 'button';
        BtnAddVor.addEventListener('click', () => this.addProceduralLayer('voronoi'));
        BtnRow.append(BtnAddSp, BtnAddFrac, BtnAddVor);

        const EroRow1 = MakeEl('div', 'studio-btn-row');
        for (const [Lbl, Typ] of [['+ Seasonal', 'erosion-seasonal'], ['+ Hydraulic', 'erosion-hydraulic'], ['+ Pitting', 'erosion-pitting']])
        {
            const B = MakeEl('button', 'button', Lbl);
            B.type = 'button';
            B.addEventListener('click', () => this.addProceduralLayer(Typ));
            EroRow1.appendChild(B);
        }
        const EroRow2 = MakeEl('div', 'studio-btn-row');
        for (const [Lbl, Typ] of [['+ Wind Cuts', 'erosion-wind'], ['+ Rockfall', 'erosion-rockfall'], ['+ Chemical', 'erosion-chemical']])
        {
            const B = MakeEl('button', 'button', Lbl);
            B.type = 'button';
            B.addEventListener('click', () => this.addProceduralLayer(Typ));
            EroRow2.appendChild(B);
        }

        StackGroup.Body.append(BtnRow, EroRow1, EroRow2);
        Content.appendChild(StackGroup.Group);

        if (!ActiveLayer) return;

        // Per-Layer Boundary Falloff Card
        const FallGroup = MakePropertyGroup('Boundary Falloff (Edge → Center)', 'Sliders', ActiveLayer.falloff.mode.toUpperCase(), true,
            'Control whether landforms fade softly near the 2D mask coastline or hold 100% strength right to sheer sea cliffs.');

        FallGroup.Body.appendChild(MakeSelectRow('Falloff Profile Mode', BOUNDARY_FALLOFF_MODES, ActiveLayer.falloff.mode, Val =>
        {
            this.pushUndoSnapshot();
            ActiveLayer.falloff.mode = Val;
            EvaluateTerrainRegion(this.world, Region, ActiveLayer.id);
            Region.meshDirty = true;
            this.map2D.invalidateRegionPreview(Region.id);
            this.refreshChrome();
            this.rebuildInspector();
        }));

        const CurveGraph = MakeBoundaryFalloffGraph(
            ActiveLayer.falloff,
            () => { Region.dirty = true; this._scheduleDirtyRegionsEvaluation(); },
            () => this._evaluateDirtyRegionsNow()
        );
        FallGroup.Body.appendChild(CurveGraph);

        if (ActiveLayer.falloff.mode !== 'none')
        {
            FallGroup.Body.appendChild(MakeSliderPillRow('Inland Ramp Distance', 15, 1100, 5, ActiveLayer.falloff.distance, 0, 'm', V =>
            {
                ActiveLayer.falloff.distance = V;
                CurveGraph.Redraw();
                Region.dirty = true;
                this._scheduleDirtyRegionsEvaluation();
            }, () => this.refreshChrome()));

            FallGroup.Body.appendChild(MakeSliderPillRow('Coastline Edge Floor', 0.0, 1.0, 0.01, ActiveLayer.falloff.edgeFloor, 2, 'w', V =>
            {
                ActiveLayer.falloff.edgeFloor = V;
                CurveGraph.Redraw();
                Region.dirty = true;
                this._scheduleDirtyRegionsEvaluation();
            }));
        }
        Content.appendChild(FallGroup.Group);

        // Selected Generator Parameters Card
        const TriggerLive = () => { Region.dirty = true; this._scheduleDirtyRegionsEvaluation(); };
        const TriggerCommit = () => { this._evaluateDirtyRegionsNow(); this.refreshChrome(); };

        const GenGroup = MakePropertyGroup(ActiveLayer.name, 'Mountain', ActiveLayer.type.toUpperCase(), true);
        GenGroup.Body.appendChild(MakeSliderPillRow('Layer Blend Opacity', 0.0, 1.0, 0.01, ActiveLayer.opacity ?? 1.0, 2, 'w', V => { ActiveLayer.opacity = V; TriggerLive(); }, TriggerCommit));

        if (!['terrace', 'spline', 'sculpt'].includes(ActiveLayer.type) && !IsErosionLayerType(ActiveLayer.type))
        {
            GenGroup.Body.appendChild(MakeSelectRow('Combine Mode', COMBINE_MODES, ActiveLayer.combine || 'add', Val =>
            {
                this.pushUndoSnapshot();
                ActiveLayer.combine = Val;
                TriggerLive();
                TriggerCommit();
            }));
        }

        if (ActiveLayer.type === 'multifractal')
        {
            GenGroup.Body.appendChild(MakeSliderPillRow('Elevation Amplitude', 10, 460, 2, ActiveLayer.amplitude, 0, 'm', V => { ActiveLayer.amplitude = V; TriggerLive(); }, TriggerCommit));
            GenGroup.Body.appendChild(MakeSliderPillRow('Feature Frequency', 0.4, 8.0, 0.05, ActiveLayer.scale, 2, '×', V => { ActiveLayer.scale = V; TriggerLive(); }, TriggerCommit));
            GenGroup.Body.appendChild(MakeSliderPillRow('Fractal Octaves', 2, 8, 1, ActiveLayer.octaves, 0, 'oct', V => { ActiveLayer.octaves = V; TriggerLive(); }, TriggerCommit));
            GenGroup.Body.appendChild(MakeSliderPillRow('Detail Roughness', 0.25, 0.78, 0.01, ActiveLayer.gain, 2, 'g', V => { ActiveLayer.gain = V; TriggerLive(); }, TriggerCommit));
            GenGroup.Body.appendChild(MakeSliderPillRow('Tectonic Warp', 0.0, 1.2, 0.02, ActiveLayer.warp, 2, 'w', V => { ActiveLayer.warp = V; TriggerLive(); }, TriggerCommit));
        }
        else if (ActiveLayer.type === 'ridged')
        {
            GenGroup.Body.appendChild(MakeSliderPillRow('Ridge Relief Height', 10, 420, 2, ActiveLayer.amplitude, 0, 'm', V => { ActiveLayer.amplitude = V; TriggerLive(); }, TriggerCommit));
            GenGroup.Body.appendChild(MakeSliderPillRow('Chain Frequency', 0.4, 8.0, 0.05, ActiveLayer.scale, 2, '×', V => { ActiveLayer.scale = V; TriggerLive(); }, TriggerCommit));
            GenGroup.Body.appendChild(MakeSliderPillRow('Crest Sharpness', 0.05, 1.0, 0.01, ActiveLayer.sharpness, 2, 's', V => { ActiveLayer.sharpness = V; TriggerLive(); }, TriggerCommit));
            GenGroup.Body.appendChild(MakeSliderPillRow('Strike Azimuth', 0, 180, 1, ActiveLayer.azimuth, 0, '°', V => { ActiveLayer.azimuth = V; TriggerLive(); }, TriggerCommit));
        }
        else if (ActiveLayer.type === 'voronoi')
        {
            GenGroup.Body.appendChild(MakeSelectRow('Cellular Morphology', [
                ['Stepped Mesa / Basalt Blocks', 0],
                ['Polygonal Fracture Ridges (F2−F1)', 1],
                ['Caldera & Crater Bowls', 2],
                ['Pillow Domes (1−F1)', 3]
            ], ActiveLayer.variant | 0, Val => { ActiveLayer.variant = Number(Val); TriggerLive(); TriggerCommit(); }));
            GenGroup.Body.appendChild(MakeSliderPillRow('Mesa / Block Height', 10, 380, 2, ActiveLayer.amplitude, 0, 'm', V => { ActiveLayer.amplitude = V; TriggerLive(); }, TriggerCommit));
            GenGroup.Body.appendChild(MakeSliderPillRow('Cell Density', 0.5, 9.0, 0.05, ActiveLayer.scale, 2, '×', V => { ActiveLayer.scale = V; TriggerLive(); }, TriggerCommit));
            GenGroup.Body.appendChild(MakeSliderPillRow('Rim Cliff Sharpness', 0.05, 1.0, 0.02, ActiveLayer.sharpness, 2, 's', V => { ActiveLayer.sharpness = V; TriggerLive(); }, TriggerCommit));
        }
        else if (ActiveLayer.type === 'billow')
        {
            GenGroup.Body.appendChild(MakeSliderPillRow('Hill / Dune Amplitude', 5, 260, 2, ActiveLayer.amplitude, 0, 'm', V => { ActiveLayer.amplitude = V; TriggerLive(); }, TriggerCommit));
            GenGroup.Body.appendChild(MakeSliderPillRow('Fold Frequency', 0.5, 9.0, 0.05, ActiveLayer.scale, 2, '×', V => { ActiveLayer.scale = V; TriggerLive(); }, TriggerCommit));
            GenGroup.Body.appendChild(MakeSliderPillRow('Directional Dune Mix', 0.0, 1.0, 0.02, ActiveLayer.duneMix, 2, 'w', V => { ActiveLayer.duneMix = V; TriggerLive(); }, TriggerCommit));
        }
        else if (ActiveLayer.type === 'terrace')
        {
            GenGroup.Body.appendChild(MakeSliderPillRow('Stratigraphic Beds', 2, 24, 1, ActiveLayer.bedCount, 0, 'bed', V => { ActiveLayer.bedCount = V; TriggerLive(); }, TriggerCommit));
            GenGroup.Body.appendChild(MakeSliderPillRow('Bench Flatness', 0.1, 0.98, 0.01, ActiveLayer.strength, 2, 'w', V => { ActiveLayer.strength = V; TriggerLive(); }, TriggerCommit));
            GenGroup.Body.appendChild(MakeSliderPillRow('Bedding Dip Angle', 0, 25, 0.5, ActiveLayer.dipDeg, 1, '°', V => { ActiveLayer.dipDeg = V; TriggerLive(); }, TriggerCommit));
        }
        else if (ActiveLayer.type === 'spline')
        {
            const JumpBtn = MakeEl('button', 'button export-button', 'Open 3D Spline & Gizmo Controls ↗');
            JumpBtn.type = 'button';
            JumpBtn.style.width = '100%';
            JumpBtn.style.justifyContent = 'center';
            JumpBtn.addEventListener('click', () =>
            {
                this.inspectorTab = 'spline';
                this._syncInspectorTabButtons();
                this.rebuildInspector();
            });
            GenGroup.Body.appendChild(JumpBtn);
        }
        else if (ActiveLayer.type === 'erosion-hydraulic')
        {
            GenGroup.Body.appendChild(MakeSliderPillRow('Solver Iterations', 1, 80, 1, ActiveLayer.iterations ?? 18, 0, 'it', V => { ActiveLayer.iterations = V; TriggerLive(); }, TriggerCommit));
            GenGroup.Body.appendChild(MakeSliderPillRow('Rainfall Intensity', 0.05, 1.5, 0.02, ActiveLayer.rainRate ?? 0.58, 2, '×', V => { ActiveLayer.rainRate = V; TriggerLive(); }, TriggerCommit));
            GenGroup.Body.appendChild(MakeSliderPillRow('Stream Shear Incision', 0.05, 1.8, 0.02, ActiveLayer.erosionRate ?? 0.68, 2, '×', V => { ActiveLayer.erosionRate = V; TriggerLive(); }, TriggerCommit));
            GenGroup.Body.appendChild(MakeSliderPillRow('Alluvial Fan Deposition', 0.05, 1.5, 0.02, ActiveLayer.depositionRate ?? 0.54, 2, '×', V => { ActiveLayer.depositionRate = V; TriggerLive(); }, TriggerCommit));
            GenGroup.Body.appendChild(MakeSliderPillRow('Slope Infiltration (Anti-Flood)', 0.02, 0.85, 0.02, ActiveLayer.infiltration ?? 0.14, 2, 'w', V => { ActiveLayer.infiltration = V; TriggerLive(); }, TriggerCommit));
            GenGroup.Body.appendChild(MakeSliderPillRow('Evaporation Rate', 0.02, 0.85, 0.02, ActiveLayer.evaporation ?? 0.24, 2, 'w', V => { ActiveLayer.evaporation = V; TriggerLive(); }, TriggerCommit));
        }
        else if (ActiveLayer.type === 'erosion-pitting')
        {
            GenGroup.Body.appendChild(MakeSliderPillRow('Solver Iterations', 1, 60, 1, ActiveLayer.iterations ?? 12, 0, 'it', V => { ActiveLayer.iterations = V; TriggerLive(); }, TriggerCommit));
            GenGroup.Body.appendChild(MakeSliderPillRow('Frost-Crack Ice Expansion', 0.0, 1.8, 0.02, ActiveLayer.frostIntensity ?? 0.68, 2, '×', V => { ActiveLayer.frostIntensity = V; TriggerLive(); }, TriggerCommit));
            GenGroup.Body.appendChild(MakeSliderPillRow('Solar Thermal Fatigue', 0.0, 1.8, 0.02, ActiveLayer.thermalIntensity ?? 0.56, 2, '×', V => { ActiveLayer.thermalIntensity = V; TriggerLive(); }, TriggerCommit));
            GenGroup.Body.appendChild(MakeSliderPillRow('Tafoni Honeycomb Cavities', 0.0, 1.5, 0.02, ActiveLayer.tafoniStrength ?? 0.45, 2, '×', V => { ActiveLayer.tafoniStrength = V; TriggerLive(); }, TriggerCommit));
            GenGroup.Body.appendChild(MakeSliderPillRow('Joint Seam Exploitation', 0.1, 1.5, 0.02, ActiveLayer.jointExploit ?? 0.72, 2, '×', V => { ActiveLayer.jointExploit = V; TriggerLive(); }, TriggerCommit));
            GenGroup.Body.appendChild(MakeSliderPillRow('Pit & Fracture Scale', 0.35, 2.4, 0.05, ActiveLayer.pitScale ?? 0.70, 2, '×', V => { ActiveLayer.pitScale = V; TriggerLive(); }, TriggerCommit));
        }
        else if (ActiveLayer.type === 'erosion-wind')
        {
            GenGroup.Body.appendChild(MakeSliderPillRow('Solver Iterations', 1, 60, 1, ActiveLayer.iterations ?? 14, 0, 'it', V => { ActiveLayer.iterations = V; TriggerLive(); }, TriggerCommit));
            GenGroup.Body.appendChild(MakeSliderPillRow('Wind Velocity', 0.05, 1.8, 0.02, ActiveLayer.windSpeed ?? 0.72, 2, '×', V => { ActiveLayer.windSpeed = V; TriggerLive(); }, TriggerCommit));
            GenGroup.Body.appendChild(MakeSliderPillRow('Canyon Sandstone Cuts', 0.0, 2.0, 0.02, ActiveLayer.canyonAbrasion ?? 0.76, 2, '×', V => { ActiveLayer.canyonAbrasion = V; TriggerLive(); }, TriggerCommit));
            GenGroup.Body.appendChild(MakeSliderPillRow('Venturi Strata Undercut', 0.0, 1.8, 0.02, ActiveLayer.strataUndercut ?? 0.78, 2, '×', V => { ActiveLayer.strataUndercut = V; TriggerLive(); }, TriggerCommit));
            GenGroup.Body.appendChild(MakeSliderPillRow('Bagnold Dune Saltation', 0.0, 1.8, 0.02, ActiveLayer.duneStrength ?? 0.66, 2, '×', V => { ActiveLayer.duneStrength = V; TriggerLive(); }, TriggerCommit));
            GenGroup.Body.appendChild(MakeSliderPillRow('Aeolian Sand Supply', 0.0, 1.5, 0.02, ActiveLayer.sandSupply ?? 0.52, 2, '×', V => { ActiveLayer.sandSupply = V; TriggerLive(); }, TriggerCommit));
            GenGroup.Body.appendChild(MakeSliderPillRow('Local Wind Azimuth', 0, 360, 1, ActiveLayer.windAzimuthDeg ?? 35, 0, '°', V => { ActiveLayer.windAzimuthDeg = V; ActiveLayer.useWeatherWind = false; TriggerLive(); }, TriggerCommit));
        }
        else if (ActiveLayer.type === 'erosion-rockfall')
        {
            GenGroup.Body.appendChild(MakeSliderPillRow('Solver Iterations', 1, 50, 1, ActiveLayer.iterations ?? 12, 0, 'it', V => { ActiveLayer.iterations = V; TriggerLive(); }, TriggerCommit));
            GenGroup.Body.appendChild(MakeSliderPillRow('Cliff Calving Intensity', 0.05, 2.0, 0.02, ActiveLayer.calvingRate ?? 0.66, 2, '×', V => { ActiveLayer.calvingRate = V; TriggerLive(); }, TriggerCommit));
            GenGroup.Body.appendChild(MakeSliderPillRow('Critical Cliff Angle', 30, 74, 1, ActiveLayer.criticalSlopeDeg ?? 51, 0, '°', V => { ActiveLayer.criticalSlopeDeg = V; TriggerLive(); }, TriggerCommit));
            GenGroup.Body.appendChild(MakeSliderPillRow('Talus Scree Repose Angle', 26, 43, 0.5, ActiveLayer.talusReposeDeg ?? 35, 1, '°', V => { ActiveLayer.talusReposeDeg = V; TriggerLive(); }, TriggerCommit));
            GenGroup.Body.appendChild(MakeSliderPillRow('Kinetic Runout Mobility', 0.1, 1.5, 0.02, ActiveLayer.runoutMobility ?? 0.68, 2, '×', V => { ActiveLayer.runoutMobility = V; TriggerLive(); }, TriggerCommit));
        }
        else if (ActiveLayer.type === 'erosion-chemical')
        {
            GenGroup.Body.appendChild(MakeSliderPillRow('Solver Iterations', 1, 50, 1, ActiveLayer.iterations ?? 10, 0, 'it', V => { ActiveLayer.iterations = V; TriggerLive(); }, TriggerCommit));
            GenGroup.Body.appendChild(MakeSliderPillRow('Karst Carbonate Dissolution', 0.0, 1.8, 0.02, ActiveLayer.karstRate ?? 0.64, 2, '×', V => { ActiveLayer.karstRate = V; TriggerLive(); }, TriggerCommit));
            GenGroup.Body.appendChild(MakeSliderPillRow('Doline Sinkhole Focus', 0.0, 1.5, 0.02, ActiveLayer.sinkholeStrength ?? 0.54, 2, '×', V => { ActiveLayer.sinkholeStrength = V; TriggerLive(); }, TriggerCommit));
            GenGroup.Body.appendChild(MakeSliderPillRow('Rillenkarren & Salt Haloclasty', 0.0, 1.5, 0.02, ActiveLayer.rillenStrength ?? 0.56, 2, '×', V => { ActiveLayer.rillenStrength = V; TriggerLive(); }, TriggerCommit));
            GenGroup.Body.appendChild(MakeSliderPillRow('Fe/Mn Varnish & Seep Stain', 0.0, 1.8, 0.02, ActiveLayer.stainIntensity ?? 0.68, 2, '×', V => { ActiveLayer.stainIntensity = V; TriggerLive(); }, TriggerCommit));
        }
        else if (ActiveLayer.type === 'erosion-seasonal')
        {
            GenGroup.Body.appendChild(MakeSliderPillRow('Seasonal Steps', 1, 80, 1, ActiveLayer.iterations ?? 20, 0, 'st', V => { ActiveLayer.iterations = V; TriggerLive(); }, TriggerCommit));
            GenGroup.Body.appendChild(MakeSliderPillRow('Fluvial & Snowmelt Runoff', 0.0, 1.6, 0.02, ActiveLayer.hydraulicStrength ?? 0.72, 2, '×', V => { ActiveLayer.hydraulicStrength = V; TriggerLive(); }, TriggerCommit));
            GenGroup.Body.appendChild(MakeSliderPillRow('Winter Frost-Crack Pitting', 0.0, 1.6, 0.02, ActiveLayer.frostStrength ?? 0.68, 2, '×', V => { ActiveLayer.frostStrength = V; TriggerLive(); }, TriggerCommit));
            GenGroup.Body.appendChild(MakeSliderPillRow('Summer Insolation Fatigue', 0.0, 1.6, 0.02, ActiveLayer.thermalStrength ?? 0.45, 2, '×', V => { ActiveLayer.thermalStrength = V; TriggerLive(); }, TriggerCommit));
            GenGroup.Body.appendChild(MakeSliderPillRow('Aeolian Wind & Cuts', 0.0, 1.6, 0.02, ActiveLayer.windStrength ?? 0.52, 2, '×', V => { ActiveLayer.windStrength = V; TriggerLive(); }, TriggerCommit));
            GenGroup.Body.appendChild(MakeSliderPillRow('Cliff Rockfall & Talus', 0.0, 1.6, 0.02, ActiveLayer.rockfallStrength ?? 0.65, 2, '×', V => { ActiveLayer.rockfallStrength = V; TriggerLive(); }, TriggerCommit));
            GenGroup.Body.appendChild(MakeSliderPillRow('Chemical Karst & Stain', 0.0, 1.6, 0.02, ActiveLayer.chemicalStrength ?? 0.36, 2, '×', V => { ActiveLayer.chemicalStrength = V; TriggerLive(); }, TriggerCommit));
            GenGroup.Body.appendChild(MakeSliderPillRow('Snowpack & Cirque Glacial', 0.0, 1.6, 0.02, ActiveLayer.snowStrength ?? 0.62, 2, '×', V => { ActiveLayer.snowStrength = V; TriggerLive(); }, TriggerCommit));
        }

        // Stack Order & Seed Row
        const LyrIdx = Region.stack.indexOf(ActiveLayer);
        const OrderRow = MakeEl('div', 'studio-btn-row');
        const BtnUp = MakeEl('button', 'button', 'Move Up ↑');
        BtnUp.type = 'button';
        BtnUp.disabled = LyrIdx < 0 || LyrIdx >= Region.stack.length - 1;
        BtnUp.addEventListener('click', () =>
        {
            if (LyrIdx >= Region.stack.length - 1) return;
            this.pushUndoSnapshot();
            const Tmp = Region.stack[LyrIdx + 1];
            Region.stack[LyrIdx + 1] = ActiveLayer;
            Region.stack[LyrIdx] = Tmp;
            TriggerLive(); TriggerCommit(); this.rebuildInspector();
        });
        const BtnDn = MakeEl('button', 'button', 'Move Down ↓');
        BtnDn.type = 'button';
        BtnDn.disabled = LyrIdx <= 0;
        BtnDn.addEventListener('click', () =>
        {
            if (LyrIdx <= 0) return;
            this.pushUndoSnapshot();
            const Tmp = Region.stack[LyrIdx - 1];
            Region.stack[LyrIdx - 1] = ActiveLayer;
            Region.stack[LyrIdx] = Tmp;
            TriggerLive(); TriggerCommit(); this.rebuildInspector();
        });
        OrderRow.append(BtnUp, BtnDn);

        if (['multifractal', 'ridged', 'voronoi', 'billow'].includes(ActiveLayer.type) || IsErosionLayerType(ActiveLayer.type))
        {
            const SeedBtn = MakeEl('button', 'button', `Seed #${ActiveLayer.seed}`);
            SeedBtn.type = 'button';
            SeedBtn.addEventListener('click', () =>
            {
                this.pushUndoSnapshot();
                ActiveLayer.seed = Math.floor(1000 + Math.random() * 89000);
                TriggerLive(); TriggerCommit(); this.rebuildInspector();
            });
            OrderRow.appendChild(SeedBtn);
        }
        GenGroup.Body.appendChild(OrderRow);

        Content.appendChild(GenGroup.Group);
    }

    /*--------------------------------------------------------------------------------------------------------------------------------------
                       TAB 2: BIOME PRESETS, SHARED WEATHER CYCLE GROUPS & 3D DIPPING LITHOLOGY
    --------------------------------------------------------------------------------------------------------------------------------------*/
    _buildWeatherAndGeologyTab(Content, Region)
    {
        // 1. 18 Biome + Physics + SatMap Presets Card
        const PresetGroup = MakePropertyGroup('Biome & Erosion Preset Library', 'Sparkles', '18 PRESETS', true,
            'Apply a physically calibrated landform + erosion + lithology + Gaea SatMap & Stamp suite to this terrain mask.');
        const PresetOpts = [['Custom Stack Configuration', '__custom__']];
        for (const P of TERRAIN_BIOME_PRESETS) PresetOpts.push([`${P.category.split(' ')[0]} · ${P.name}`, P.id]);
        PresetGroup.Body.appendChild(MakeSelectRow('Active Biome Preset', PresetOpts, Region.presetId || '__custom__', Val =>
        {
            if (Val !== '__custom__') this.applyPresetToActiveRegion(Val);
        }));
        Content.appendChild(PresetGroup.Group);

        // 2. Per-Mask (1-by-1) vs Shared Weather Cycle Group Card
        const WGrpId = Region.weatherGroup || 'solo';
        const LinkedPeers = WGrpId === 'solo'
            ? [Region]
            : (WGrpId === 'world-sync'
                ? this.world.regions.filter(R => R.enabled)
                : this.world.regions.filter(R => R.weatherGroup === WGrpId));

        const LinkGroup = MakePropertyGroup('Per-Mask vs Shared Weather Cycle', 'Link', WGrpId.toUpperCase(), true,
            'Run this terrain on an independent 1-by-1 weather clock (Solo), or link multiple terrain masks into the same Shared Weather Group so they experience identical seasonal storms & wind shifts together.');

        LinkGroup.Body.appendChild(MakeSelectRow('Weather Link Channel', WEATHER_GROUP_OPTIONS, WGrpId, Val =>
        {
            this.pushUndoSnapshot();
            Region.weatherGroup = Val;
            this.map2D.requestRedraw();
            this.refreshChrome();
            this.rebuildInspector();
        }));

        const PeerWrap = MakeEl('div', 'weather-group-peers');
        for (const Peer of LinkedPeers)
        {
            const Chip = MakeEl('button', 'peer-chip' + (WGrpId === 'solo' ? ' solo' : ''),
                `${WGrpId === 'solo' ? '● Solo:' : '⇄ Linked:'} ${Peer.name}`);
            Chip.type = 'button';
            Chip.addEventListener('click', () => this._setRegionSelection(Peer.id, [Peer.id]));
            PeerWrap.appendChild(Chip);
        }
        LinkGroup.Body.appendChild(PeerWrap);

        const SimBtns = MakeEl('div', 'studio-btn-row');
        const BtnSolo10 = MakeEl('button', 'button', 'Step Solo (+10)');
        BtnSolo10.type = 'button';
        BtnSolo10.title = 'Advance ONLY this terrain mask by +10 steps (1-by-1)';
        BtnSolo10.addEventListener('click', () =>
        {
            const Prev = this.simTargetScope;
            this.simTargetScope = 'solo';
            this.stepWeatherSimulation(10, true);
            this.simTargetScope = Prev;
        });

        const BtnGrp10 = MakeEl('button', 'button export-button', WGrpId === 'solo' ? 'Step Active (+15)' : `Step ${WGrpId.toUpperCase()} (+15)`);
        BtnGrp10.type = 'button';
        BtnGrp10.title = 'Advance all terrains linked in this Shared Weather Group synchronously';
        BtnGrp10.addEventListener('click', () =>
        {
            const Prev = this.simTargetScope;
            this.simTargetScope = 'group';
            this.stepWeatherSimulation(15, true);
            this.simTargetScope = Prev;
        });
        SimBtns.append(BtnSolo10, BtnGrp10);
        LinkGroup.Body.appendChild(SimBtns);
        Content.appendChild(LinkGroup.Group);

        // 3. Climate Regime & Synoptic Wind Schedule Card
        if (!Region.weatherSpec) Region.weatherSpec = { climateRegime: 'alpine-continental', windAzimuthDeg: 35, windSpeed: 0.65, windShiftMode: 'variable', rainMultiplier: 1.0, tempOffsetC: 0.0, stepsPerYear: 48 };
        const Ws = Region.weatherSpec;
        const TriggerWeather = () => { Region.dirty = true; this._scheduleDirtyRegionsEvaluation(); this._syncSimWeatherReadout(); };
        const CommitWeather = () => { this._evaluateDirtyRegionsNow(); this.refreshChrome(); };

        const ClimGroup = MakePropertyGroup('Seasonal Climate & Wind Regime', 'Snowflake', Ws.climateRegime.toUpperCase(), true);
        ClimGroup.Body.appendChild(MakeSelectRow(
            'Climate Regime',
            CLIMATE_REGIMES.map(C => [C.label, C.id]),
            Ws.climateRegime || 'alpine-continental',
            Val => { Ws.climateRegime = Val; TriggerWeather(); CommitWeather(); this.rebuildInspector(); }
        ));
        ClimGroup.Body.appendChild(MakeSelectRow('Synoptic Wind Schedule', WIND_SHIFT_MODES, Ws.windShiftMode || 'variable', Val =>
        {
            Ws.windShiftMode = Val; TriggerWeather(); CommitWeather();
        }));
        ClimGroup.Body.appendChild(MakeSliderPillRow('Prevailing Wind Bearing', 0, 360, 1, Ws.windAzimuthDeg ?? 35, 0, '°', V => { Ws.windAzimuthDeg = V; TriggerWeather(); }, CommitWeather));
        ClimGroup.Body.appendChild(MakeSliderPillRow('Mean Wind Velocity', 0.05, 1.6, 0.02, Ws.windSpeed ?? 0.65, 2, '×', V => { Ws.windSpeed = V; TriggerWeather(); }, CommitWeather));
        ClimGroup.Body.appendChild(MakeSliderPillRow('Annual Precipitation', 0.1, 2.2, 0.05, Ws.rainMultiplier ?? 1.0, 2, '×', V => { Ws.rainMultiplier = V; TriggerWeather(); }, CommitWeather));
        ClimGroup.Body.appendChild(MakeSliderPillRow('Temperature Offset', -14, 16, 0.5, Ws.tempOffsetC ?? 0.0, 1, '°C', V => { Ws.tempOffsetC = V; TriggerWeather(); }, CommitWeather));
        Content.appendChild(ClimGroup.Group);

        // 4. 3D Dipping Lithology & Fracture Network Card
        if (!Region.lithology) Region.lithology = { rockHardness: 0.56, strataContrast: 0.72, strataFrequency: 9.0, dipDeg: 6.0, strikeDeg: 18.0, jointDensity: 0.58, carbonateSolubility: 0.38, ironMineral: 0.48 };
        const Lith = Region.lithology;
        const LithGroup = MakePropertyGroup('3D Dipping Lithology & Joints', 'Crack', 'BEDROCK', true,
            'Governs differential caprock undercutting, canyon wall cuts, conjugate joint pitting, and karst solubility.');
        LithGroup.Body.appendChild(MakeSliderPillRow('Bedrock Hardness', 0.08, 0.96, 0.02, Lith.rockHardness ?? 0.56, 2, 'h', V => { Lith.rockHardness = V; TriggerWeather(); }, CommitWeather));
        LithGroup.Body.appendChild(MakeSliderPillRow('Caprock Strata Contrast', 0.0, 1.0, 0.02, Lith.strataContrast ?? 0.72, 2, 'w', V => { Lith.strataContrast = V; TriggerWeather(); }, CommitWeather));
        LithGroup.Body.appendChild(MakeSliderPillRow('Stratigraphic Bed Count', 2, 24, 0.5, Lith.strataFrequency ?? 9.0, 1, 'bed', V => { Lith.strataFrequency = V; TriggerWeather(); }, CommitWeather));
        LithGroup.Body.appendChild(MakeSliderPillRow('3D Bedding Dip Angle', 0, 35, 0.5, Lith.dipDeg ?? 6.0, 1, '°', V => { Lith.dipDeg = V; TriggerWeather(); }, CommitWeather));
        LithGroup.Body.appendChild(MakeSliderPillRow('Bedding Strike Azimuth', 0, 180, 1, Lith.strikeDeg ?? 18, 0, '°', V => { Lith.strikeDeg = V; TriggerWeather(); }, CommitWeather));
        LithGroup.Body.appendChild(MakeSliderPillRow('Tectonic Joint Density', 0.05, 1.0, 0.02, Lith.jointDensity ?? 0.58, 2, 'w', V => { Lith.jointDensity = V; TriggerWeather(); }, CommitWeather));
        LithGroup.Body.appendChild(MakeSliderPillRow('Karst Carbonate Solubility', 0.02, 1.2, 0.02, Lith.carbonateSolubility ?? 0.38, 2, 'w', V => { Lith.carbonateSolubility = V; TriggerWeather(); }, CommitWeather));
        LithGroup.Body.appendChild(MakeSliderPillRow('Fe / Mn Oxide Mineral', 0.0, 1.0, 0.02, Lith.ironMineral ?? 0.48, 2, 'w', V => { Lith.ironMineral = V; TriggerWeather(); }, CommitWeather));
        Content.appendChild(LithGroup.Group);
    }

    /*--------------------------------------------------------------------------------------------------------------------------------------
                         TAB 3: GAEA SATMAPS, GEOLOGICAL SURFACE STAMPS & 16-CHANNEL DATA MAP GALLERY
    --------------------------------------------------------------------------------------------------------------------------------------*/
    _buildGaeaTexturingTab(Content, Region)
    {
        if (!Region.texturing) Region.texturing = CreateDefaultTexturingConfig('alpine-granite', ['tectonic-cracks', 'talus-clasts']);
        const Tex = Region.texturing;
        if (!Region.runtime?.gaeaMaps) ComputeAllGaeaDataMaps(this.world, Region);

        const RefreshTex = () =>
        {
            Region.meshDirty = true;
            this.map2D.invalidateRegionPreview(Region.id);
            this.map2D.requestRedraw();
        };

        // 1. 16-Channel Gaea Geomorphological Data Map Live Gallery
        const ActivePreview = Tex.activeMapPreview || 'none';
        const MapGroup = MakePropertyGroup('16 Gaea Geomorphological Data Maps', 'Palette', ActivePreview === 'none' ? 'SATMAP PBR' : ActivePreview.toUpperCase(), true,
            'Click any derived map below to inspect it live in 3D & 2D (click again or click Composite to return to full SatMap + Stamp texturing).');

        const ResetMapBtn = MakeEl('button', 'button' + (ActivePreview === 'none' ? ' export-button' : ''), 'Show Full Gaea SatMap + Stamps Composite');
        ResetMapBtn.type = 'button';
        ResetMapBtn.style.width = '100%';
        ResetMapBtn.style.justifyContent = 'center';
        ResetMapBtn.addEventListener('click', () =>
        {
            Tex.activeMapPreview = 'none';
            RefreshTex();
            this.rebuildInspector();
        });
        MapGroup.Body.appendChild(ResetMapBtn);

        const MapGrid = MakeEl('div', 'gaea-map-grid');
        for (const M of GAEA_DATA_MAPS)
        {
            const IsAct = ActivePreview === M.id;
            const Card = MakeEl('button', 'gaea-map-card' + (IsAct ? ' active' : ''));
            Card.type = 'button';
            Card.title = `${M.label} — ${M.desc}`;
            const Thumb = document.createElement('canvas');
            Thumb.className = 'gaea-map-thumb';
            RenderGaeaMapToCanvas(Region, M.id, true, Thumb);
            Card.append(Thumb, MakeEl('span', '', M.shortLabel || M.label));
            Card.addEventListener('click', () =>
            {
                Tex.activeMapPreview = (Tex.activeMapPreview === M.id) ? 'none' : M.id;
                RefreshTex();
                this.rebuildInspector();
            });
            MapGrid.appendChild(Card);
        }
        MapGroup.Body.appendChild(MapGrid);

        // PNG & RGBA Splatmap Exporters!
        const ExpRow = MakeEl('div', 'studio-btn-row');
        const BtnMapPng = MakeEl('button', 'button', ActivePreview === 'none' ? 'Export Height .PNG' : `Export ${ActivePreview} .PNG`);
        BtnMapPng.type = 'button';
        BtnMapPng.addEventListener('click', () =>
        {
            const TargetMap = ActivePreview === 'none' ? 'height' : ActivePreview;
            const Cvs = RenderGaeaMapToCanvas(Region, TargetMap, ActivePreview !== 'none');
            if (Cvs) Cvs.toBlob(B => B && this._triggerDownload(B, `${Region.id}-${TargetMap}.png`));
        });

        const BtnAlbedoPng = MakeEl('button', 'button export-button', 'Export Albedo+Normal .PNG');
        BtnAlbedoPng.type = 'button';
        BtnAlbedoPng.addEventListener('click', () =>
        {
            const Out = RenderAlbedoAndNormalCanvases(this.world, Region);
            if (!Out) return;
            Out.albedo.toBlob(B => B && this._triggerDownload(B, `${Region.id}-albedo.png`));
            setTimeout(() => Out.normal.toBlob(B => B && this._triggerDownload(B, `${Region.id}-normal.png`)), 180);
        });

        const BtnSplatPng = MakeEl('button', 'button', 'Export Splatmaps .PNG');
        BtnSplatPng.type = 'button';
        BtnSplatPng.addEventListener('click', () =>
        {
            const Out = RenderAlbedoAndNormalCanvases(this.world, Region);
            if (!Out) return;
            Out.splatA.toBlob(B => B && this._triggerDownload(B, `${Region.id}-splatA-bed-dep-tal-sand.png`));
            setTimeout(() => Out.splatB.toBlob(B => B && this._triggerDownload(B, `${Region.id}-splatB-flow-pit-chem-snow.png`)), 180);
        });
        ExpRow.append(BtnMapPng, BtnAlbedoPng, BtnSplatPng);
        MapGroup.Body.appendChild(ExpRow);
        Content.appendChild(MapGroup.Group);

        // 2. 12 Gaea SatMap Palette Themes Card
        const SatGroup = MakePropertyGroup('Gaea SatMap Color Ramps', 'Palette', (Tex.satMapId || 'alpine-granite').toUpperCase(), true);
        const SatGrid = MakeEl('div', 'satmap-grid');
        for (const Theme of Object.values(GAEA_SATMAP_THEMES))
        {
            const Card = MakeEl('button', 'satmap-card' + (Tex.satMapId === Theme.id ? ' active' : ''));
            Card.type = 'button';
            const Swatch = MakeEl('div', 'satmap-swatch');
            const Stops = Theme.rockRamp.map((C, Idx) =>
            {
                const R = Math.min(255, Math.round(Math.pow(C[0] * 1.6, 1 / 2.2) * 255));
                const G = Math.min(255, Math.round(Math.pow(C[1] * 1.6, 1 / 2.2) * 255));
                const B = Math.min(255, Math.round(Math.pow(C[2] * 1.6, 1 / 2.2) * 255));
                return `rgb(${R},${G},${B}) ${Math.round((Idx / Math.max(1, Theme.rockRamp.length - 1)) * 100)}%`;
            }).join(', ');
            Swatch.style.background = `linear-gradient(90deg, ${Stops})`;
            Card.append(Swatch, MakeEl('strong', '', Theme.label));
            Card.addEventListener('click', () =>
            {
                Tex.satMapId = Theme.id;
                Tex.activeMapPreview = 'none';
                RefreshTex();
                this.rebuildInspector();
            });
            SatGrid.appendChild(Card);
        }
        SatGroup.Body.appendChild(SatGrid);

        SatGroup.Body.appendChild(MakeSliderPillRow('Strata Band Contrast', 0.0, 1.0, 0.02, Tex.strataVisibility ?? 0.64, 2, 'w', V => { Tex.strataVisibility = V; RefreshTex(); }));
        SatGroup.Body.appendChild(MakeSliderPillRow('Cavity AO Darkening', 0.0, 1.0, 0.02, Tex.aoDarkening ?? 0.52, 2, 'w', V => { Tex.aoDarkening = V; RefreshTex(); }));
        SatGroup.Body.appendChild(MakeSliderPillRow('Valley Moss / Riparian', 0.0, 1.0, 0.02, Tex.mossLine ?? 0.55, 2, 'w', V => { Tex.mossLine = V; RefreshTex(); }));
        SatGroup.Body.appendChild(MakeSliderPillRow('Snowline Altitude Boost', -0.4, 0.8, 0.02, Tex.snowLineBoost ?? 0.0, 2, 'w', V => { Tex.snowLineBoost = V; RefreshTex(); }));
        Content.appendChild(SatGroup.Group);

        // 3. Geological Surface Stamps Stack (Albedo + Micro-Normal Perturbation!)
        if (!Array.isArray(Tex.stamps)) Tex.stamps = [];
        const StampGroup = MakePropertyGroup('Geological Surface Stamps', 'Stamp', `${Tex.stamps.length} STAMPS`, true,
            'Procedural Gaea surface detail stamps masked by slope, strata, talus, sand, or flow — perturbs both albedo & 3D micro-normals.');

        const AddStampRow = MakeEl('div', 'studio-btn-row');
        const StampSelect = MakeEl('select', 'studio-select');
        for (const St of Object.values(GAEA_SURFACE_STAMPS))
        {
            const Opt = document.createElement('option');
            Opt.value = St.id;
            Opt.textContent = `+ ${St.label}`;
            StampSelect.appendChild(Opt);
        }
        const BtnAddStamp = MakeEl('button', 'button export-button', 'Add Stamp');
        BtnAddStamp.type = 'button';
        BtnAddStamp.style.flex = '0 0 auto';
        BtnAddStamp.addEventListener('click', () =>
        {
            this.pushUndoSnapshot();
            Tex.stamps.push(CreateStampLayer(StampSelect.value, { seed: Math.floor(1000 + Math.random() * 89000) }));
            RefreshTex();
            this.rebuildInspector();
        });
        AddStampRow.append(StampSelect, BtnAddStamp);
        StampGroup.Body.appendChild(AddStampRow);

        Tex.stamps.forEach((St, Idx) =>
        {
            const Card = MakeEl('div', 'stamp-card');
            const Head = MakeEl('div', 'stamp-header');
            const ToggleBtn = MakeEl('button', 'row-mini-btn' + (St.enabled !== false ? ' eye-on' : ''), ConstructGlyph(St.enabled !== false ? 'Eye' : 'EyeOff'));
            ToggleBtn.type = 'button';
            ToggleBtn.addEventListener('click', () => { St.enabled = St.enabled === false; RefreshTex(); this.rebuildInspector(); });

            const DelBtn = MakeEl('button', 'row-mini-btn', ConstructGlyph('Trash'));
            DelBtn.type = 'button';
            DelBtn.addEventListener('click', () => { Tex.stamps.splice(Idx, 1); RefreshTex(); this.rebuildInspector(); });

            Head.append(ToggleBtn, MakeEl('strong', '', St.name), DelBtn);
            Card.appendChild(Head);

            Card.appendChild(MakeSelectRow('Mask Driver Map', GAEA_DATA_MAPS.map(M => [M.label, M.id]), St.maskMap || 'slope', Val => { St.maskMap = Val; RefreshTex(); }));
            Card.appendChild(MakeSliderPillRow('Detail Frequency', 0.3, 4.5, 0.05, St.scale ?? 1.0, 2, '×', V => { St.scale = V; RefreshTex(); }));
            Card.appendChild(MakeSliderPillRow('Albedo Strength', 0.0, 1.4, 0.02, St.strength ?? 0.72, 2, 'w', V => { St.strength = V; RefreshTex(); }));
            Card.appendChild(MakeSliderPillRow('3D Normal Bump', 0.0, 1.4, 0.02, St.bumpStrength ?? 0.65, 2, 'n', V => { St.bumpStrength = V; RefreshTex(); }));
            StampGroup.Body.appendChild(Card);
        });
        Content.appendChild(StampGroup.Group);
    }

    /*--------------------------------------------------------------------------------------------------------------------------------------
                                     TAB 2: DEDICATED 3D SPLINE & XYZ UP/DOWN GIZMO AUTHORING TAB
    --------------------------------------------------------------------------------------------------------------------------------------*/
    _buildSplineInspectorTab(Content, Region)
    {
        const CreateCard = MakePropertyGroup('Create 3D Spline Landforms', 'Spline', '3D GIZMO', true,
            'Add a 3D Spline Layer, click any numbered knot in 3D, and drag the Green Y ↕ Gizmo arrow UP or DOWN (or Shift+Click terrain to add knots).');

        const AddBtns = MakeEl('div', 'studio-btn-row');
        const B1 = MakeEl('button', 'button export-button', '+ Graded Ramp / Ridge');
        B1.type = 'button';
        B1.addEventListener('click', () => this.addNew3DSplineLayer('grade', '3D Graded Spline Ramp'));

        const B2 = MakeEl('button', 'button', '+ 3D Rock Arch Bridge');
        B2.type = 'button';
        B2.addEventListener('click', () => this.addNew3DSplineLayer('arch3d', '3D Rock Arch Bridge'));

        const B3 = MakeEl('button', 'button', '+ Place Knots on Terrain (K)');
        B3.type = 'button';
        B3.addEventListener('click', () =>
        {
            if (this.workspaceMode === '2d') this.setWorkspaceMode('split');
            this.select3DTool('spline-add');
        });
        AddBtns.append(B1, B2);
        CreateCard.Body.append(AddBtns);
        const PlaceWrap = MakeEl('div', 'studio-btn-row', B3);
        CreateCard.Body.appendChild(PlaceWrap);
        Content.appendChild(CreateCard.Group);

        // Find active spline layer on Region
        let SplineLayer = Region.stack.find(L => L.id === this.activeLayerId && L.type === 'spline')
                       || Region.stack.find(L => L.id === this.view3D.activeSplineLayerId && L.type === 'spline')
                       || Region.stack.find(L => L.type === 'spline');

        if (!SplineLayer) return;
        this.view3D.activeSplineLayerId = SplineLayer.id;
        this.activeLayerId = SplineLayer.id;

        const TriggerSpline = () =>
        {
            EvaluateTerrainRegion(this.world, Region, SplineLayer.id);
            Region.meshDirty = true;
            this.map2D.invalidateRegionPreview(Region.id);
            this.map2D.requestRedraw();
        };

        // Selected Knot 3D XYZ (Up/Down Y) Gizmo Inspector Card
        const KnotCount = SplineLayer.points.length;
        const KIdx = Clamp(this.view3D.selectedKnotIndex | 0, 0, Math.max(0, KnotCount - 1));
        this.view3D.selectedKnotIndex = KIdx;
        const Knot = SplineLayer.points[KIdx];

        if (Knot)
        {
            const KnotGroup = MakePropertyGroup(`Selected Knot #${KIdx + 1} · 3D Gizmo`, 'Gizmo', `OF ${KnotCount}`, true,
                'Drag the Green Y ↕ arrow in the 3D viewport or scrub Elevation Y below to move this spline point up/down.');

            // Y Elevation (Up / Down) SliderPill!
            const CurY = Number.isFinite(Knot[2]) ? Knot[2] : this.view3D.sampleTerrainSurfaceY(Region, Knot[0], Knot[1]);
            const YRow = MakeSliderPillRow('Knot Elevation Y (Up / Down ↕)', -60, 520, 0.5, CurY, 1, 'm', V =>
            {
                Knot[2] = V;
                TriggerSpline();
            }, () => this.rebuildInspector());
            this._activeKnotYSlider = YRow;
            KnotGroup.Body.appendChild(YRow);

            const B = Region.bounds;
            KnotGroup.Body.appendChild(MakeSliderPillRow('Knot World X (East / West)', B.x - 400, B.x + B.width + 400, 1, Knot[0], 0, 'm', V =>
            {
                Knot[0] = Math.round(V);
                TriggerSpline();
            }, () => this.rebuildInspector()));

            KnotGroup.Body.appendChild(MakeSliderPillRow('Knot World Z (North / South)', B.z - 400, B.z + B.depth + 400, 1, Knot[1], 0, 'm', V =>
            {
                Knot[1] = Math.round(V);
                TriggerSpline();
            }, () => this.rebuildInspector()));

            const KnotActions = MakeEl('div', 'studio-btn-row');
            const BtnSnapGround = MakeEl('button', 'button', 'Snap Y to Terrain');
            BtnSnapGround.type = 'button';
            BtnSnapGround.addEventListener('click', () =>
            {
                this.pushUndoSnapshot();
                Knot[2] = Math.round(this.view3D.sampleTerrainSurfaceY(Region, Knot[0], Knot[1]) * 10) / 10;
                TriggerSpline();
                this.rebuildInspector();
            });

            const BtnRaise25 = MakeEl('button', 'button', 'Y +25 m ↑');
            BtnRaise25.type = 'button';
            BtnRaise25.addEventListener('click', () =>
            {
                this.pushUndoSnapshot();
                Knot[2] = Math.round(((Knot[2] ?? 20) + 25) * 10) / 10;
                TriggerSpline();
                this.rebuildInspector();
            });

            const BtnLower25 = MakeEl('button', 'button', 'Y −25 m ↓');
            BtnLower25.type = 'button';
            BtnLower25.addEventListener('click', () =>
            {
                this.pushUndoSnapshot();
                Knot[2] = Math.round(((Knot[2] ?? 20) - 25) * 10) / 10;
                TriggerSpline();
                this.rebuildInspector();
            });

            const BtnDelKnot = MakeEl('button', 'button', 'Delete Knot');
            BtnDelKnot.type = 'button';
            BtnDelKnot.disabled = KnotCount <= 2;
            BtnDelKnot.addEventListener('click', () =>
            {
                if (SplineLayer.points.length <= 2) return;
                this.pushUndoSnapshot();
                SplineLayer.points.splice(KIdx, 1);
                this.view3D.selectedKnotIndex = Math.max(0, KIdx - 1);
                TriggerSpline();
                this.rebuildInspector();
            });

            KnotActions.append(BtnRaise25, BtnLower25, BtnSnapGround, BtnDelKnot);
            KnotGroup.Body.appendChild(KnotActions);

            // Clickable list of all knots on this spline
            const KList = MakeEl('div', 'knot-list');
            SplineLayer.points.forEach((Pt, Idx) =>
            {
                const Row = MakeEl('div', 'knot-chip-row' + (Idx === KIdx ? ' active' : ''));
                const Wy = Number.isFinite(Pt[2]) ? Pt[2] : 0;
                Row.append(
                    MakeEl('span', 'knot-badge', String(Idx + 1)),
                    MakeEl('span', 'knot-coords', `X ${Pt[0]} m · Z ${Pt[1]} m`),
                    MakeEl('span', 'knot-elev-pill', `Y ${Wy >= 0 ? '+' : ''}${Wy.toFixed(1)} m`)
                );
                Row.addEventListener('click', () =>
                {
                    this.view3D.selectedKnotIndex = Idx;
                    this.select3DTool('spline');
                    this.rebuildInspector();
                });
                KList.appendChild(Row);
            });
            KnotGroup.Body.appendChild(KList);
            Content.appendChild(KnotGroup.Group);
        }

        // Spline Corridor Profile Card
        const ProfGroup = MakePropertyGroup(`${SplineLayer.name} · Profile`, 'Sliders', SplineLayer.splineMode.toUpperCase(), true);
        ProfGroup.Body.appendChild(MakeSelectRow('Spline Landform Mode', SPLINE_MODES, SplineLayer.splineMode || 'grade', Val =>
        {
            this.pushUndoSnapshot();
            SplineLayer.splineMode = Val;
            TriggerSpline();
            this.refreshChrome();
            this.rebuildInspector();
        }));
        ProfGroup.Body.appendChild(MakeSliderPillRow('Corridor Width', 16, 380, 2, SplineLayer.width, 0, 'm', V => { SplineLayer.width = V; TriggerSpline(); }));
        ProfGroup.Body.appendChild(MakeSliderPillRow(
            SplineLayer.splineMode === 'arch3d' ? 'Arch Tube Thickness' : 'Height / Carve Depth',
            4, 220, 2, SplineLayer.amount, 0, 'm', V => { SplineLayer.amount = V; TriggerSpline(); }
        ));
        ProfGroup.Body.appendChild(MakeSliderPillRow('Bank Smoothness', 0.05, 1.0, 0.02, SplineLayer.bankSmooth, 2, 'w', V => { SplineLayer.bankSmooth = V; TriggerSpline(); }));
        ProfGroup.Body.appendChild(MakeSliderPillRow('Natural Meander', 0.0, 0.8, 0.02, SplineLayer.meander, 2, 'w', V => { SplineLayer.meander = V; TriggerSpline(); }));
        Content.appendChild(ProfGroup.Group);
    }

    /*--------------------------------------------------------------------------------------------------------------------------------------
                                          TAB 3: THIN-SLAB SDF ARCHITECTURE SETTINGS
    --------------------------------------------------------------------------------------------------------------------------------------*/
    _buildThinSlabInspectorTab(Content, Region)
    {
        const SlabGroup = MakePropertyGroup('Thin-Slab SDF Geometry', 'Boxes', 'SPACE-EFFICIENT', true,
            '2D masks initialize as a thin flat wafer near sea level and build upward — zero SDF space or triangles wasted deep under the ocean.');

        const MaskOpts = [['All Visible 2D Masks (Union)', '__all__']];
        for (const M of this.world.maskLayers) MaskOpts.push([M.name, M.id]);
        SlabGroup.Body.appendChild(MakeSelectRow('Linked 2D Mask Source', MaskOpts, Region.maskLayerId || '__all__', Val =>
        {
            this.pushUndoSnapshot();
            Region.maskLayerId = Val === '__all__' ? null : Val;
            EvaluateTerrainRegion(this.world, Region, this.activeLayerId);
            Region.meshDirty = true;
            this.map2D.invalidateRegionPreview(Region.id);
            this.refreshChrome();
        }));

        SlabGroup.Body.appendChild(MakeSliderPillRow('SDF Grid Resolution', 64, 224, 8, Region.resolution, 0, 'res', V =>
        {
            Region.resolution = V;
            Region.dirty = true;
            this._scheduleDirtyRegionsEvaluation();
        }, () => { this._evaluateDirtyRegionsNow(); this.refreshChrome(); }));

        SlabGroup.Body.appendChild(MakeSliderPillRow('Base Flat Surface Elev', -2.0, 35.0, 0.5, Region.baseElevation, 1, 'm', V =>
        {
            Region.baseElevation = V;
            Region.dirty = true;
            this._scheduleDirtyRegionsEvaluation();
        }));

        SlabGroup.Body.appendChild(MakeSliderPillRow('Thin Underside Wafer', 2.0, 22.0, 0.5, Region.slabThickness, 1, 'm', V =>
        {
            Region.slabThickness = V;
            Region.dirty = true;
            this._scheduleDirtyRegionsEvaluation();
        }, () => this.refreshChrome()));

        SlabGroup.Body.appendChild(MakeSliderPillRow('Shoreline Bevel (0 = Cliff)', 0.0, 65.0, 1.0, Region.shorelineBevel, 0, 'm', V =>
        {
            Region.shorelineBevel = V;
            Region.dirty = true;
            this._scheduleDirtyRegionsEvaluation();
        }));

        Content.appendChild(SlabGroup.Group);
    }

    /*--------------------------------------------------------------------------------------------------------------------------------------
                                      TAB 4: STAGE LIGHTING, OCEAN & TRIANGLE MESH EXPORT
    --------------------------------------------------------------------------------------------------------------------------------------*/
    _buildStageAndExportTab(Content, _Region)
    {
        const LightGroup = MakePropertyGroup('Stage Exposure & Ocean', 'Sun', 'ACES FILMIC', true,
            'Calibrated non-blinding dark-studio lighting with ACES filmic tonemapping.');

        LightGroup.Body.appendChild(MakeSelectRow('Sky & Atmosphere Theme', [
            ['Obsidian Studio (Default Dark)', 0],
            ['Warm Coastal Dusk', 1],
            ['Soft Twilight Daylight', 2]
        ], this.view3D.atmosphereMode, Val =>
        {
            this.view3D.atmosphereMode = Number(Val);
            const DockSel = document.getElementById('dock-atmos-select');
            if (DockSel) DockSel.value = String(Val);
        }));

        LightGroup.Body.appendChild(MakeSliderPillRow('Scene Exposure', 0.35, 1.65, 0.02, this.view3D.exposure, 2, 'ev', V =>
        {
            this.view3D.exposure = V;
            const ExpRange = document.getElementById('dock-exposure-range');
            const ExpVal = document.getElementById('dock-exposure-val');
            if (ExpRange) { ExpRange.value = String(V); ExpRange.style.setProperty('--fill', `${(((V - 0.35) / 1.30) * 100).toFixed(1)}%`); }
            if (ExpVal) ExpVal.textContent = V.toFixed(2);
        }));

        LightGroup.Body.appendChild(MakeSliderPillRow('World Sea Level', -35, 55, 0.5, this.world.seaLevel, 1, 'm', V =>
        {
            this.world.seaLevel = V;
            for (const R of this.world.regions) R.dirty = true;
            this._scheduleDirtyRegionsEvaluation();
        }));

        LightGroup.Body.appendChild(MakeSliderPillRow('Ocean Wave Height', 0.0, 4.5, 0.05, this.view3D.waveAmplitude, 2, 'm', V => { this.view3D.waveAmplitude = V; }));
        LightGroup.Body.appendChild(MakeSliderPillRow('Sun Azimuth', 0, 360, 1, this.view3D.sunAzimuthDeg, 0, '°', V => { this.view3D.sunAzimuthDeg = V; }));
        LightGroup.Body.appendChild(MakeSliderPillRow('Sun Elevation', 6, 85, 1, this.view3D.sunElevationDeg, 0, '°', V => { this.view3D.sunElevationDeg = V; }));
        Content.appendChild(LightGroup.Group);

        const ExpGroup = MakePropertyGroup('Triangle Mesh & World Export', 'Download', '.OBJ / .STL', true,
            'Converts visible Thin-Slab SDF terrains (including 3D overhang arches & underside wafer) into watertight triangles.');
        const ExpBtns = MakeEl('div', 'studio-btn-row');
        const BtnObj = MakeEl('button', 'button export-button', 'Export .OBJ Triangles');
        BtnObj.type = 'button';
        BtnObj.addEventListener('click', () => this._exportObj());

        const BtnStl = MakeEl('button', 'button', 'Export Binary .STL');
        BtnStl.type = 'button';
        BtnStl.addEventListener('click', () => this._exportStl());

        ExpBtns.append(BtnObj, BtnStl);
        ExpGroup.Body.appendChild(ExpBtns);
        Content.appendChild(ExpGroup.Group);
    }

    /*======================================================================================================================================
                                                      MAIN RENDER LOOP & TELEMETRY
    ======================================================================================================================================*/
    _startMainLoop()
    {
        let Frames = 0;
        let LastFpsT = performance.now();
        let LastSimT = performance.now();
        const EnginePill = document.getElementById('engine-pill-text');
        const HudTris = document.getElementById('hud-tris-count');
        const StatMesh = document.getElementById('status-mesh');

        const Tick = Now =>
        {
            if (this.simPlaying && Now - LastSimT >= 85)
            {
                LastSimT = Now;
                this.stepWeatherSimulation(1, false);
            }

            if (this.workspaceMode !== '3d') this.map2D.render();
            if (this.workspaceMode !== '2d') this.view3D.render(this.activeLayerId);

            Frames++;
            if (Now - LastFpsT >= 500)
            {
                const Fps = Math.round((Frames * 1000) / (Now - LastFpsT));
                Frames = 0;
                LastFpsT = Now;
                const Tris = this.view3D.totalVisibleTriangles;
                const Verts = this.view3D.totalVisibleVertices;
                if (EnginePill) EnginePill.textContent = `${this.simPlaying ? 'SIM LIVE' : 'THIN-SLAB'} · ${Fps} FPS`;
                if (HudTris) HudTris.textContent = `${(Tris / 1000).toFixed(1)}k`;
                if (StatMesh) StatMesh.textContent = `Triangles: ${Tris.toLocaleString()} · Vertices: ${Verts.toLocaleString()}`;
            }
            requestAnimationFrame(Tick);
        };
        requestAnimationFrame(Tick);
    }
}

window.TerrainStudio = new TerrainWorldStudioApp();
