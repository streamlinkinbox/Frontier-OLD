/*====================================================================================================================================
                                                     TERRAINGAEATEXTURING.JS
====================================================================================================================================*/
// 🧩 Gaea-inspired 16-channel geomorphological data-map extractor, multi-stop SatMap synthesizers, geological stamps & splat exporters

import { EvaluateRockLithology3D, VoronoiJoint2D } from './TerrainErosionPhysics.js';

const Clamp = (V, Lo, Hi) => (V < Lo ? Lo : V > Hi ? Hi : V);
const Mix = (A, B, T) => A + (B - A) * T;
const Mix3 = (A, B, T) => [Mix(A[0], B[0], T), Mix(A[1], B[1], T), Mix(A[2], B[2], T)];
const Smoothstep = (E0, E1, X) =>
{
    const Span = Math.max(1e-6, E1 - E0);
    const T = Clamp((X - E0) / Span, 0.0, 1.0);
    return T * T * (3.0 - 2.0 * T);
};

function Hash2(Ix, Iz, Seed = 4029)
{
    let H = Math.imul(Ix | 0, 374761393) ^ Math.imul(Iz | 0, 668265263) ^ Math.imul(Seed | 0, 1442695041);
    H = Math.imul(H ^ (H >>> 13), 1274126177);
    return ((H ^ (H >>> 16)) >>> 0) / 4294967295.0;
}

function ValueNoise2(X, Z, Seed = 4029)
{
    const X0 = Math.floor(X), Z0 = Math.floor(Z);
    const Fx = X - X0, Fz = Z - Z0;
    const Ux = Fx * Fx * (3.0 - 2.0 * Fx);
    const Uz = Fz * Fz * (3.0 - 2.0 * Fz);
    return Mix(
        Mix(Hash2(X0, Z0, Seed), Hash2(X0 + 1, Z0, Seed), Ux),
        Mix(Hash2(X0, Z0 + 1, Seed), Hash2(X0 + 1, Z0 + 1, Seed), Ux),
        Uz
    );
}

function MicroFbm(X, Z, Seed = 4029)
{
    return 0.58 * ValueNoise2(X, Z, Seed) +
           0.28 * ValueNoise2(X * 2.13, Z * 2.13, Seed + 79) +
           0.14 * ValueNoise2(X * 4.41, Z * 4.41, Seed + 191);
}

//------------------------------------------------------------------------------------------------------------------------
//                                  16 GAEA-STYLE GEOMORPHOLOGICAL & TOPOGRAPHIC DATA MAPS
//------------------------------------------------------------------------------------------------------------------------

export const GAEA_DATA_MAPS = [
    { id: 'height',     label: 'Height',           category: 'Topography', ramp: 'elev',    desc: 'Normalized terrain elevation above sea level' },
    { id: 'slope',      label: 'Slope',            category: 'Topography', ramp: 'heat',    desc: 'Surface gradient angle (0° flat → 90° vertical cliff)' },
    { id: 'curvature',  label: 'Curvature',        category: 'Topography', ramp: 'diverg',  desc: 'Convex arête ridges (>0.5) vs concave hollows (<0.5)' },
    { id: 'protrusion', label: 'Protrusion',       category: 'Topography', ramp: 'amber',   desc: 'High-pass rock outcrop prominence above local mean' },
    { id: 'ao',         label: 'Occlusion (AO)',   category: 'Topography', ramp: 'mono',    desc: '8-direction horizon-scan terrain cavity ambient occlusion' },
    { id: 'insolation', label: 'Sun Insolation',   category: 'Topography', ramp: 'solar',   desc: 'Directional solar aspect & thermal heating exposure' },
    { id: 'flow',       label: 'Flow Network',     category: 'Hydrology',  ramp: 'cyan',    desc: 'Cumulative hydrological stream & thalweg threads' },
    { id: 'wear',       label: 'Bedrock Wear',     category: 'Erosion',    ramp: 'crimson', desc: 'Cumulative hydraulic, aeolian & rockfall bedrock scour' },
    { id: 'deposit',    label: 'Alluvial Deposit', category: 'Erosion',    ramp: 'ochre',   desc: 'Fluvial fans, floodplain silt & braided delta bars' },
    { id: 'talus',      label: 'Talus & Scree',    category: 'Erosion',    ramp: 'amber',   desc: 'Cliff-calved rockfall cones & 35° angular scree aprons' },
    { id: 'sand',       label: 'Aeolian Sand',     category: 'Erosion',    ramp: 'gold',    desc: 'Wind-migrating dunes, lee drifts & saltation sheets' },
    { id: 'pitting',    label: 'Pitting & Cracks', category: 'Weathering', ramp: 'violet',  desc: 'Cryogenic frost-crack & thermal tafoni pit density' },
    { id: 'chemical',   label: 'Karst & Varnish',  category: 'Weathering', ramp: 'rust',    desc: 'Karst dissolution, Fe-oxide rust streaks & Mn varnish' },
    { id: 'strata',     label: '3D Stratigraphy',  category: 'Geology',    ramp: 'strata',  desc: 'Tilted 3D sedimentary/volcanic rock beds & hardness' },
    { id: 'snow',       label: 'Snow & Glacier',   category: 'Cryosphere', ramp: 'ice',     desc: 'Seasonal orographic snowpack & alpine firn mask' },
    { id: 'wetness',    label: 'Shore & Wetness',  category: 'Hydrology',  ramp: 'teal',    desc: 'Coastal surf zone, channel water & capillary seepage' }
];

//------------------------------------------------------------------------------------------------------------------------
//                                  12 CURATED MULTI-STOP GAEA SATMAP BIOME PALETTES
//------------------------------------------------------------------------------------------------------------------------

// 📝 All colors are calibrated linear-space RGB values designed for ACES filmic studio rendering (rich, natural, non-blinding).
export const GAEA_SATMAP_THEMES = {
    'alpine-granite': {
        id: 'alpine-granite',
        label: 'Alpine Granite & Subalpine Turf',
        subtitle: 'Silver batholith granite, krummholz pine, scree cones & snow',
        rockRamp: [[0.09, 0.095, 0.105], [0.15, 0.155, 0.165], [0.23, 0.235, 0.245], [0.33, 0.335, 0.35]],
        soilRamp: [[0.055, 0.105, 0.052], [0.095, 0.145, 0.072], [0.165, 0.162, 0.105], [0.22, 0.205, 0.16]],
        talusCol: [0.165, 0.160, 0.155],
        sandCol:  [0.25, 0.225, 0.175],
        chemCol:  [0.22, 0.115, 0.065],
        shoreCol: [0.21, 0.195, 0.155],
        snowCol:  [0.54, 0.57, 0.62],
        vegStrength: 0.78
    },
    'utah-navajo': {
        id: 'utah-navajo',
        label: 'Utah Navajo & Kayenta Sandstone',
        subtitle: 'Terracotta slickrock, buff cross-beds, Mn desert varnish & ochre fans',
        rockRamp: [[0.18, 0.065, 0.038], [0.31, 0.118, 0.062], [0.42, 0.195, 0.102], [0.48, 0.315, 0.185]],
        soilRamp: [[0.22, 0.115, 0.068], [0.29, 0.165, 0.095], [0.36, 0.225, 0.132], [0.41, 0.285, 0.178]],
        talusCol: [0.25, 0.108, 0.062],
        sandCol:  [0.44, 0.245, 0.125],
        chemCol:  [0.065, 0.045, 0.042], // Dark Mn/Fe desert rock varnish streaks!
        shoreCol: [0.35, 0.235, 0.145],
        snowCol:  [0.52, 0.50, 0.48],
        vegStrength: 0.16
    },
    'icelandic-basalt': {
        id: 'icelandic-basalt',
        label: 'Icelandic Glacial Basalt & Moss',
        subtitle: 'Charcoal columnar basalt, rhyolite bands, neon subarctic moss & black sandur',
        rockRamp: [[0.038, 0.042, 0.048], [0.072, 0.078, 0.086], [0.135, 0.125, 0.112], [0.24, 0.185, 0.135]],
        soilRamp: [[0.035, 0.038, 0.042], [0.075, 0.145, 0.052], [0.135, 0.215, 0.068], [0.185, 0.175, 0.105]],
        talusCol: [0.052, 0.055, 0.062],
        sandCol:  [0.036, 0.038, 0.044], // Volcanic black-sand sandur!
        chemCol:  [0.26, 0.125, 0.055],  // Palagonite / geothermal iron oxidation
        shoreCol: [0.042, 0.045, 0.050],
        snowCol:  [0.55, 0.59, 0.65],
        vegStrength: 0.86
    },
    'himalayan-gneiss': {
        id: 'himalayan-gneiss',
        label: 'Himalayan Dark Gneiss & Glacier',
        subtitle: 'Banded dark gneiss, leucogranite sills, grey moraine & glacial blue firn',
        rockRamp: [[0.052, 0.056, 0.066], [0.098, 0.104, 0.118], [0.185, 0.192, 0.205], [0.34, 0.345, 0.36]],
        soilRamp: [[0.085, 0.095, 0.082], [0.125, 0.128, 0.118], [0.165, 0.168, 0.162], [0.24, 0.248, 0.26]],
        talusCol: [0.115, 0.120, 0.130],
        sandCol:  [0.18, 0.185, 0.19],
        chemCol:  [0.19, 0.12, 0.08],
        shoreCol: [0.15, 0.155, 0.16],
        snowCol:  [0.56, 0.61, 0.68],
        vegStrength: 0.18
    },
    'grand-canyon': {
        id: 'grand-canyon',
        label: 'Grand Canyon Stratigraphic Column',
        subtitle: 'Vishnu dark schist gorge, Redwall cliff, Supai redbeds & Kaibab cream rim',
        rockRamp: [[0.065, 0.058, 0.062], [0.28, 0.088, 0.055], [0.36, 0.155, 0.085], [0.46, 0.385, 0.265]],
        soilRamp: [[0.20, 0.11, 0.072], [0.28, 0.145, 0.088], [0.34, 0.205, 0.125], [0.42, 0.335, 0.225]],
        talusCol: [0.24, 0.115, 0.072],
        sandCol:  [0.36, 0.245, 0.155],
        chemCol:  [0.085, 0.052, 0.045],
        shoreCol: [0.30, 0.21, 0.135],
        snowCol:  [0.52, 0.51, 0.49],
        vegStrength: 0.22
    },
    'studlagil-columnar': {
        id: 'studlagil-columnar',
        label: 'Stuðlagil Columnar Basalt & Rust',
        subtitle: 'Blue-slate hexagonal basalt columns, orange iron-oxide waterlines & emerald crown',
        rockRamp: [[0.048, 0.058, 0.072], [0.082, 0.096, 0.115], [0.135, 0.148, 0.165], [0.195, 0.205, 0.218]],
        soilRamp: [[0.065, 0.128, 0.055], [0.105, 0.185, 0.068], [0.145, 0.205, 0.082], [0.175, 0.185, 0.125]],
        talusCol: [0.068, 0.076, 0.088],
        sandCol:  [0.055, 0.062, 0.070],
        chemCol:  [0.34, 0.145, 0.048], // Vivid oxidized rust on wet lower basalt columns!
        shoreCol: [0.26, 0.135, 0.058],
        snowCol:  [0.54, 0.58, 0.64],
        vegStrength: 0.72
    },
    'namib-erg': {
        id: 'namib-erg',
        label: 'Namib Apricot Erg & Calcrete Pan',
        subtitle: 'Iron-oxide apricot mega-dunes, bleached white clay pan & dark dolerite ridges',
        rockRamp: [[0.078, 0.068, 0.065], [0.145, 0.118, 0.102], [0.245, 0.165, 0.122], [0.32, 0.225, 0.165]],
        soilRamp: [[0.42, 0.385, 0.325], [0.38, 0.265, 0.175], [0.42, 0.215, 0.105], [0.46, 0.235, 0.115]],
        talusCol: [0.125, 0.102, 0.092],
        sandCol:  [0.47, 0.218, 0.098],
        chemCol:  [0.45, 0.42, 0.36], // Evaporite calcrete / salt pan crust
        shoreCol: [0.43, 0.36, 0.26],
        snowCol:  [0.55, 0.53, 0.50],
        vegStrength: 0.04
    },
    'sahara-varnish': {
        id: 'sahara-varnish',
        label: 'Sahara Golden Erg & Tassili Crags',
        subtitle: 'Warm golden quartz star-dunes & manganese-varnished sandstone inselbergs',
        rockRamp: [[0.072, 0.058, 0.052], [0.165, 0.122, 0.088], [0.285, 0.205, 0.135], [0.38, 0.285, 0.185]],
        soilRamp: [[0.34, 0.245, 0.145], [0.42, 0.305, 0.172], [0.48, 0.355, 0.198], [0.52, 0.395, 0.225]],
        talusCol: [0.145, 0.108, 0.082],
        sandCol:  [0.50, 0.365, 0.195],
        chemCol:  [0.058, 0.046, 0.044],
        shoreCol: [0.42, 0.325, 0.195],
        snowCol:  [0.54, 0.52, 0.48],
        vegStrength: 0.08
    },
    'karst-limestone': {
        id: 'karst-limestone',
        label: 'Karst Limestone & Terra Rossa',
        subtitle: 'Silver-cream fluted carbonate towers, red terra-rossa clay & lush dolines',
        rockRamp: [[0.18, 0.182, 0.175], [0.28, 0.282, 0.270], [0.38, 0.378, 0.358], [0.47, 0.465, 0.440]],
        soilRamp: [[0.058, 0.135, 0.055], [0.088, 0.168, 0.068], [0.245, 0.112, 0.068], [0.30, 0.145, 0.088]],
        talusCol: [0.31, 0.305, 0.288],
        sandCol:  [0.36, 0.34, 0.29],
        chemCol:  [0.29, 0.105, 0.058], // Red terra-rossa residual clay in karst grikes!
        shoreCol: [0.38, 0.365, 0.315],
        snowCol:  [0.55, 0.57, 0.60],
        vegStrength: 0.82
    },
    'badlands-painted': {
        id: 'badlands-painted',
        label: 'Painted Badlands Bentonite Clay',
        subtitle: 'Banded rose, ochre, ash-grey & mauve mudstone beds with pale silt outwash',
        rockRamp: [[0.24, 0.195, 0.175], [0.34, 0.148, 0.125], [0.39, 0.275, 0.155], [0.31, 0.295, 0.285]],
        soilRamp: [[0.32, 0.285, 0.245], [0.36, 0.255, 0.185], [0.38, 0.215, 0.158], [0.34, 0.305, 0.268]],
        talusCol: [0.29, 0.195, 0.158],
        sandCol:  [0.39, 0.315, 0.225],
        chemCol:  [0.36, 0.135, 0.105],
        shoreCol: [0.35, 0.305, 0.255],
        snowCol:  [0.52, 0.51, 0.50],
        vegStrength: 0.12
    },
    'caldera-tropical': {
        id: 'caldera-tropical',
        label: 'Volcanic Atoll & Emerald Canopy',
        subtitle: 'Dark olivine basalt cliffs, dense tropical ridge jungle & white coral sand',
        rockRamp: [[0.052, 0.055, 0.058], [0.092, 0.095, 0.092], [0.148, 0.142, 0.128], [0.215, 0.198, 0.175]],
        soilRamp: [[0.042, 0.115, 0.048], [0.068, 0.165, 0.062], [0.105, 0.205, 0.078], [0.155, 0.215, 0.095]],
        talusCol: [0.078, 0.076, 0.074],
        sandCol:  [0.44, 0.415, 0.345],
        chemCol:  [0.22, 0.125, 0.068],
        shoreCol: [0.46, 0.435, 0.365], // Bright coral lagoon sandbar!
        snowCol:  [0.54, 0.56, 0.58],
        vegStrength: 0.92
    },
    'lunar-regolith': {
        id: 'lunar-regolith',
        label: 'Lunar Mare & Anorthosite Regolith',
        subtitle: 'Dark ilmenite mare basalt floor, grey breccia slopes & bright crater ejecta',
        rockRamp: [[0.075, 0.078, 0.084], [0.135, 0.138, 0.144], [0.225, 0.228, 0.235], [0.34, 0.345, 0.352]],
        soilRamp: [[0.068, 0.070, 0.075], [0.115, 0.118, 0.122], [0.185, 0.188, 0.194], [0.28, 0.284, 0.290]],
        talusCol: [0.21, 0.214, 0.22],
        sandCol:  [0.14, 0.143, 0.148],
        chemCol:  [0.09, 0.092, 0.10],
        shoreCol: [0.11, 0.112, 0.118],
        snowCol:  [0.42, 0.425, 0.435],
        vegStrength: 0.0
    }
};

//------------------------------------------------------------------------------------------------------------------------
//                                8 PROCEDURAL GAEA-STYLE GEOLOGICAL SURFACE STAMPS
//------------------------------------------------------------------------------------------------------------------------

export const GAEA_SURFACE_STAMPS = {
    'sandstone-cuts': {
        id: 'sandstone-cuts',
        label: 'Cross-Bedded Sandstone Cuts & Flutes',
        defaultMask: 'slope',
        maskMin: 0.22,
        maskMax: 1.0,
        scale: 1.4,
        strength: 0.72,
        bumpStrength: 0.65,
        tint: [0.36, 0.16, 0.09]
    },
    'basalt-columns': {
        id: 'basalt-columns',
        label: 'Hexagonal Columnar Basalt Jointing',
        defaultMask: 'slope',
        maskMin: 0.28,
        maskMax: 1.0,
        scale: 1.8,
        strength: 0.78,
        bumpStrength: 0.75,
        tint: [0.055, 0.062, 0.074]
    },
    'tectonic-cracks': {
        id: 'tectonic-cracks',
        label: 'Conjugate Tectonic Fracture Cracks',
        defaultMask: 'protrusion',
        maskMin: 0.30,
        maskMax: 1.0,
        scale: 1.2,
        strength: 0.68,
        bumpStrength: 0.62,
        tint: [0.045, 0.042, 0.040]
    },
    'tafoni-pits': {
        id: 'tafoni-pits',
        label: 'Tafoni Honeycomb & Frost Pits',
        defaultMask: 'pitting',
        maskMin: 0.08,
        maskMax: 0.95,
        scale: 2.1,
        strength: 0.76,
        bumpStrength: 0.70,
        tint: [0.075, 0.062, 0.054]
    },
    'talus-clasts': {
        id: 'talus-clasts',
        label: 'Angular Talus Scree & Boulder Clasts',
        defaultMask: 'talus',
        maskMin: 0.05,
        maskMax: 0.85,
        scale: 2.4,
        strength: 0.74,
        bumpStrength: 0.68,
        tint: [0.16, 0.152, 0.145]
    },
    'aeolian-ripples': {
        id: 'aeolian-ripples',
        label: 'Asymmetric Wind-Blown Sand Ripples',
        defaultMask: 'sand',
        maskMin: 0.04,
        maskMax: 0.90,
        scale: 2.6,
        strength: 0.70,
        bumpStrength: 0.58,
        tint: [0.46, 0.31, 0.16]
    },
    'karst-karren': {
        id: 'karst-karren',
        label: 'Karst Rillenkarren Solution Flutes',
        defaultMask: 'chemical',
        maskMin: 0.08,
        maskMax: 0.95,
        scale: 1.9,
        strength: 0.72,
        bumpStrength: 0.64,
        tint: [0.34, 0.335, 0.315]
    },
    'alluvial-cobbles': {
        id: 'alluvial-cobbles',
        label: 'Braided River Gravel & Silt Bars',
        defaultMask: 'deposit',
        maskMin: 0.06,
        maskMax: 0.90,
        scale: 2.2,
        strength: 0.64,
        bumpStrength: 0.48,
        tint: [0.22, 0.205, 0.185]
    }
};

export function CreateDefaultTexturingConfig(SatMapId = 'alpine-granite', StampIds = ['tectonic-cracks', 'talus-clasts'])
{
    return {
        satMapId: SatMapId,
        macroVariation: 0.68,
        strataVisibility: 0.64,
        aoDarkening: 0.52,
        mossLine: 0.55,
        snowLineBoost: 0.0,
        activeMapPreview: 'none', // 'none' or one of the 16 GAEA_DATA_MAPS ids
        stamps: StampIds.map((Id, K) => CreateStampLayer(Id, { seed: 4029 + K * 313 }))
    };
}

export function CreateStampLayer(StampType = 'sandstone-cuts', Overrides = {})
{
    const Spec = GAEA_SURFACE_STAMPS[StampType] || GAEA_SURFACE_STAMPS['sandstone-cuts'];
    return {
        id: Overrides.id || `stamp-${Math.random().toString(36).slice(2, 8)}`,
        enabled: Overrides.enabled !== false,
        stampType: Spec.id,
        name: Overrides.name || Spec.label,
        maskMap: Overrides.maskMap || Spec.defaultMask,
        maskMin: Overrides.maskMin ?? Spec.maskMin,
        maskMax: Overrides.maskMax ?? Spec.maskMax,
        invertMask: !!Overrides.invertMask,
        scale: Overrides.scale ?? Spec.scale,
        strength: Overrides.strength ?? Spec.strength,
        bumpStrength: Overrides.bumpStrength ?? Spec.bumpStrength,
        seed: Overrides.seed ?? 4029
    };
}

//------------------------------------------------------------------------------------------------------------------------
//                           COMPUTE ALL 16 GAEA DATA MAPS FOR A TERRAIN REGION
//------------------------------------------------------------------------------------------------------------------------

export function ComputeAllGaeaDataMaps(World, Region, SunDir = [0.55, 0.55, 0.62])
{
    const Rt = Region?.runtime;
    if (!Rt) return null;

    const Nx = Rt.nx, Nz = Rt.nz, StepX = Rt.stepX, StepZ = Rt.stepZ;
    const Count = Nx * Nz;
    const Heights = Rt.heights;
    const Sdf2D = Rt.sdf2D;
    const SeaLevel = World.seaLevel ?? 0.0;
    const MaxRel = Math.max(30.0, (Rt.maxHeight ?? 180.0) - SeaLevel);
    const Ero = Rt.erosion;
    const Lith = Region.lithology || {};
    const B = Region.bounds;

    const Maps = {
        height:     new Float32Array(Count),
        slope:      new Float32Array(Count),
        curvature:  new Float32Array(Count),
        protrusion: new Float32Array(Count),
        ao:         new Float32Array(Count),
        insolation: new Float32Array(Count),
        flow:       new Float32Array(Count),
        wear:       new Float32Array(Count),
        deposit:    new Float32Array(Count),
        talus:      new Float32Array(Count),
        sand:       new Float32Array(Count),
        pitting:    new Float32Array(Count),
        chemical:   new Float32Array(Count),
        strata:     new Float32Array(Count),
        snow:       new Float32Array(Count),
        wetness:    new Float32Array(Count)
    };

    const Sx = SunDir[0], Sy = SunDir[1], Sz = SunDir[2];
    const AvgStep = 0.5 * (StepX + StepZ);
    const AoDirs = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, 1], [1, -1], [-1, -1]];

    for (let Z = 0; Z < Nz; ++Z)
    {
        const Wz = B.z + Z * StepZ;
        const Row = Z * Nx;
        for (let X = 0; X < Nx; ++X)
        {
            const I = Row + X;
            if (Sdf2D[I] > AvgStep * 1.4)
            {
                Maps.ao[I] = 1.0;
                Maps.curvature[I] = 0.5;
                continue;
            }

            const H = Heights[I];
            Maps.height[I] = Clamp((H - SeaLevel) / MaxRel, 0.0, 1.0);

            const Xm = Math.max(0, X - 1), Xp = Math.min(Nx - 1, X + 1);
            const Zm = Math.max(0, Z - 1), Zp = Math.min(Nz - 1, Z + 1);
            const HL = Heights[Row + Xm], HR = Heights[Row + Xp];
            const HD = Heights[Zm * Nx + X], HU = Heights[Zp * Nx + X];

            const DzDx = (HR - HL) / Math.max(1e-3, (Xp - Xm) * StepX);
            const DzDz = (HU - HD) / Math.max(1e-3, (Zp - Zm) * StepZ);
            const SlopeTan = Math.hypot(DzDx, DzDz);
            const SlopeDeg = (Math.atan(SlopeTan) * 180.0) / Math.PI;
            Maps.slope[I] = Clamp(SlopeDeg / 78.0, 0.0, 1.0);

            // Laplacian Curvature: > 0.5 convex ridge, < 0.5 concave valley/hollow
            const Avg4 = 0.25 * (HL + HR + HD + HU);
            Maps.curvature[I] = Clamp(0.5 + ((H - Avg4) / AvgStep) * 1.45, 0.0, 1.0);

            // Wider-radius Outcrop Protrusion (r = 3 cells)
            const Xm3 = Math.max(0, X - 3), Xp3 = Math.min(Nx - 1, X + 3);
            const Zm3 = Math.max(0, Z - 3), Zp3 = Math.min(Nz - 1, Z + 3);
            const MeanWide = 0.25 * (Heights[Row + Xm3] + Heights[Row + Xp3] + Heights[Zm3 * Nx + X] + Heights[Zp3 * Nx + X]);
            Maps.protrusion[I] = Clamp(((H - MeanWide) / (AvgStep * 2.2)) * 0.85 + 0.18, 0.0, 1.0);

            // 8-Azimuth Horizon-Scan Terrain Cavity Ambient Occlusion
            let OcclSum = 0.0;
            for (let D = 0; D < 8; ++D)
            {
                const [Ox, Oz] = AoDirs[D];
                const DistScale = (Ox !== 0 && Oz !== 0 ? 1.4142 : 1.0) * AvgStep;
                let MaxHorizTan = 0.0;
                for (let R = 1; R <= 4; ++R)
                {
                    const SxI = Clamp(X + Ox * R * 2, 0, Nx - 1);
                    const SzI = Clamp(Z + Oz * R * 2, 0, Nz - 1);
                    const Rise = Heights[SzI * Nx + SxI] - H;
                    if (Rise > 0.0)
                    {
                        const TanH = Rise / (R * 2 * DistScale);
                        if (TanH > MaxHorizTan) MaxHorizTan = TanH;
                    }
                }
                OcclSum += 1.0 / Math.sqrt(1.0 + MaxHorizTan * MaxHorizTan * 1.35);
            }
            Maps.ao[I] = Clamp(OcclSum / 8.0, 0.0, 1.0);

            // Directional Solar Insolation
            const InvN = 1.0 / Math.sqrt(DzDx * DzDx + 1.0 + DzDz * DzDz);
            const DotSun = (-DzDx * InvN) * Sx + InvN * Sy + (-DzDz * InvN) * Sz;
            Maps.insolation[I] = Clamp(DotSun * 0.85 + 0.18, 0.0, 1.0);

            // 3D Stratigraphy Band Map (reuses precomputed static geology cache when available!)
            let StrataBand = 0.5, JointCrack = 0.0, IronSrc = 0.5;
            if (Ero && Ero._geoCache)
            {
                const Geo = Ero._geoCache;
                const Freq = Math.max(1.5, Number(Lith.strataFrequency ?? 9.0));
                const Contrast = Clamp(Number(Lith.strataContrast ?? 0.72), 0.0, 1.0);
                const Phase = ((Ero.bedrock[I] + Geo.dipOffset[I]) / MaxRel) * Freq;
                const BedIdx = Math.floor(Phase);
                const BedHash = Hash2(BedIdx, Geo.seed & 255, Geo.seed + 409);
                StrataBand = Clamp(Mix(0.5, Smoothstep(0.22, 0.78, 0.5 + 0.5 * Math.cos(Phase * Math.PI * 2.0 + BedHash * 2.2)), Contrast), 0.0, 1.0);
                JointCrack = Geo.jointCrack[I];
                IronSrc = Clamp(Number(Lith.ironMineral ?? 0.48) * (0.35 + 0.65 * BedHash), 0.0, 1.0);
            }
            else
            {
                const Wx = B.x + X * StepX;
                const Rock = EvaluateRockLithology3D(Wx, Ero ? Ero.bedrock[I] : H, Wz, Lith, MaxRel, Region.seed || 4029);
                StrataBand = Rock.strataBand;
                JointCrack = Rock.jointCrack;
                IronSrc = Rock.ironSource;
            }
            Maps.strata[I] = StrataBand;

            // Erosion / Hydrology / Weathering Maps (graceful geometric proxy fallback before simulation steps!)
            const SplineWater = Rt.waterChannel ? Rt.waterChannel[I] : 0.0;
            if (Ero && Ero.totalSteps > 0)
            {
                Maps.flow[I]     = Clamp(Math.max(Ero.flowAccum[I], SplineWater), 0.0, 1.0);
                Maps.wear[I]     = Clamp(Smoothstep(0.0, 3.8, Ero.wear[I]), 0.0, 1.0);
                Maps.deposit[I]  = Clamp(Smoothstep(0.0, 2.6, Ero.alluvium[I]), 0.0, 1.0);
                Maps.talus[I]    = Clamp(Smoothstep(0.0, 3.2, Ero.talus[I]), 0.0, 1.0);
                Maps.sand[I]     = Clamp(Smoothstep(0.0, 3.5, Ero.aeolianSand[I]), 0.0, 1.0);
                Maps.pitting[I]  = Clamp(Ero.pitting[I], 0.0, 1.0);
                Maps.chemical[I] = Clamp(Ero.chemical[I], 0.0, 1.0);
                Maps.snow[I]     = Clamp(Smoothstep(0.02, 1.6, Ero.snowIce[I]), 0.0, 1.0);
                const ShoreWet   = Smoothstep(5.5, -0.5, H - SeaLevel);
                Maps.wetness[I]  = Clamp(Math.max(ShoreWet, Ero.wetness[I], SplineWater), 0.0, 1.0);
            }
            else
            {
                // Clean analytical diagnostic preview even at step 0
                const Concave = Clamp((0.5 - Maps.curvature[I]) * 2.2, 0.0, 1.0);
                Maps.flow[I]     = Clamp(Math.max(SplineWater, Concave * (1.0 - Maps.height[I] * 0.5) * 0.55), 0.0, 1.0);
                Maps.wear[I]     = Clamp(Maps.slope[I] * Maps.protrusion[I], 0.0, 1.0);
                Maps.deposit[I]  = Clamp((1.0 - Maps.slope[I]) * Concave * 0.65, 0.0, 1.0);
                Maps.talus[I]    = Clamp(Smoothstep(0.32, 0.62, Maps.slope[I]) * Concave, 0.0, 1.0);
                Maps.sand[I]     = Clamp((1.0 - Smoothstep(0.05, 0.38, Maps.slope[I])) * (1.0 - Maps.height[I]) * 0.45, 0.0, 1.0);
                Maps.pitting[I]  = Clamp(JointCrack * Maps.slope[I], 0.0, 1.0);
                Maps.chemical[I] = Clamp(IronSrc * Concave * 0.6, 0.0, 1.0);
                Maps.snow[I]     = 0.0;
                Maps.wetness[I]  = Clamp(Math.max(SplineWater, Smoothstep(5.5, -0.5, H - SeaLevel)), 0.0, 1.0);
            }
        }
    }

    Rt.gaeaMaps = Maps;
    return Maps;
}

//------------------------------------------------------------------------------------------------------------------------
//                      SATMAP RAMP SAMPLING + PROCEDURAL STAMP ALBEDO & NORMAL PERTURBATION
//------------------------------------------------------------------------------------------------------------------------

function SampleRamp4(Ramp, T)
{
    const U = Clamp(T, 0.0, 1.0) * 3.0;
    const I = Math.min(2, U | 0);
    return Mix3(Ramp[I], Ramp[I + 1], U - I);
}

function EvaluateProceduralStampPattern(Stamp, Wx, Wy, Wz)
{
    const S = Math.max(0.2, Number(Stamp.scale) || 1.5);
    const Seed = Stamp.seed || 4029;
    const Type = Stamp.stampType;

    if (Type === 'sandstone-cuts')
    {
        // Cross-bedded Navajo/Wingate sandstone laminae + horizontal wind-flute grooves
        const Warp = (ValueNoise2(Wx * 0.015 * S, Wz * 0.015 * S, Seed) - 0.5) * 4.2;
        const Lamina = 0.5 + 0.5 * Math.sin((Wy * 0.85 * S + Wx * 0.055 * S + Warp) * 2.4);
        const CrossSet = 0.5 + 0.5 * Math.sin((Wy * 0.42 * S - Wz * 0.08 * S - Warp * 0.6) * 3.1);
        return Smoothstep(0.18, 0.86, 0.68 * Lamina + 0.32 * CrossSet);
    }
    if (Type === 'basalt-columns')
    {
        // Crisp hexagonal Voronoi colonnade seams + horizontal entablature tiers
        const Vor = VoronoiJoint2D(Wx * 0.065 * S, Wz * 0.065 * S, 0.62, Seed + 17);
        const Seam = Smoothstep(0.02, 0.18, Vor.edge);
        const Tier = 0.82 + 0.18 * Math.sin(Wy * 0.55 * S + Vor.cellHash * 3.14);
        return Seam * Tier;
    }
    if (Type === 'tectonic-cracks')
    {
        const V1 = VoronoiJoint2D(Wx * 0.032 * S, Wz * 0.032 * S, 0.88, Seed + 43);
        const V2 = VoronoiJoint2D(Wx * 0.078 * S + 4.2, Wz * 0.078 * S - 3.1, 0.85, Seed + 109);
        const Crack1 = 1.0 - Smoothstep(0.0, 0.11, V1.edge);
        const Crack2 = (1.0 - Smoothstep(0.0, 0.09, V2.edge)) * 0.55;
        return 1.0 - Clamp(Crack1 + Crack2, 0.0, 1.0);
    }
    if (Type === 'tafoni-pits')
    {
        const Vor = VoronoiJoint2D((Wx + Wy * 0.45) * 0.085 * S, (Wz + Wy * 0.45) * 0.085 * S, 0.90, Seed + 211);
        const Cavity = Vor.cellHash > 0.32 ? Smoothstep(0.18, 0.58, Vor.d1) : 0.88;
        return Cavity;
    }
    if (Type === 'talus-clasts')
    {
        const Vor = VoronoiJoint2D(Wx * 0.11 * S, Wz * 0.11 * S, 0.95, Seed + 307);
        return Clamp((1.0 - Vor.d1 * 1.15) * (0.55 + 0.45 * Vor.cellHash), 0.0, 1.0);
    }
    if (Type === 'aeolian-ripples')
    {
        const Warp = (ValueNoise2(Wx * 0.02 * S, Wz * 0.02 * S, Seed + 83) - 0.5) * 2.5;
        const Phase = (((Wx * 0.78 + Wz * 0.62) * 0.14 * S + Warp) % 1.0 + 1.0) % 1.0;
        // Asymmetric wind ripple: gentle windward stoss (0..0.74), crisp leeward slipface (0.74..1.0)
        return Phase < 0.74 ? (Phase / 0.74) : (1.0 - (Phase - 0.74) / 0.26);
    }
    if (Type === 'karst-karren')
    {
        const Flute = 0.5 + 0.5 * Math.sin((Wx * 0.19 * S + (ValueNoise2(Wx * 0.03, Wz * 0.03, Seed) - 0.5) * 3.0) * 2.2);
        const Grike = VoronoiJoint2D(Wx * 0.045 * S, Wz * 0.045 * S, 0.76, Seed + 401);
        return Smoothstep(0.04, 0.18, Grike.edge) * (0.55 + 0.45 * Flute);
    }
    // 'alluvial-cobbles'
    const Bar = 0.5 + 0.5 * Math.sin((Wx * 0.045 + Wz * 0.038) * S + MicroFbm(Wx * 0.02, Wz * 0.02, Seed) * 5.0);
    const Cobble = ValueNoise2(Wx * 0.18 * S, Wz * 0.18 * S, Seed + 509);
    return 0.65 * Bar + 0.35 * Cobble;
}

export function EvaluateGaeaVertexAppearance(World, Region, CellIdx, Wx, Wy, Wz, BaseNormal)
{
    const Rt = Region.runtime;
    const Maps = Rt?.gaeaMaps;
    if (!Maps) return { color: [0.18, 0.18, 0.17], normal: BaseNormal, aux0: 0.5, aux1: 0.2 };

    const Cfg = Region.texturing || CreateDefaultTexturingConfig();
    const Theme = GAEA_SATMAP_THEMES[Cfg.satMapId] || GAEA_SATMAP_THEMES['alpine-granite'];

    // If user selected a specific Gaea Data Map for live 3D inspection, output its crisp diagnostic palette!
    if (Cfg.activeMapPreview && Cfg.activeMapPreview !== 'none' && Maps[Cfg.activeMapPreview])
    {
        const MapSpec = GAEA_DATA_MAPS.find(M => M.id === Cfg.activeMapPreview);
        const Col = ColorizeGaeaScalar(Maps[Cfg.activeMapPreview][CellIdx], MapSpec?.ramp || 'heat', true);
        return { color: Col, normal: BaseNormal, aux0: Maps[Cfg.activeMapPreview][CellIdx], aux1: Maps.wetness[CellIdx] };
    }

    if (Wy <= Rt.slabBottom + 0.42)
    {
        return { color: [0.058, 0.064, 0.072], normal: BaseNormal, aux0: 0.0, aux1: 0.0 };
    }

    const HNorm   = Maps.height[CellIdx];
    const Slope   = Maps.slope[CellIdx];
    const Curv    = Maps.curvature[CellIdx];
    const Prot    = Maps.protrusion[CellIdx];
    const Ao      = Maps.ao[CellIdx];
    const Flow    = Maps.flow[CellIdx];
    const Deposit = Maps.deposit[CellIdx];
    const Talus   = Maps.talus[CellIdx];
    const Sand    = Maps.sand[CellIdx];
    const Pit     = Maps.pitting[CellIdx];
    const Chem    = Maps.chemical[CellIdx];
    const Strata  = Maps.strata[CellIdx];
    const Snow    = Maps.snow[CellIdx];
    const Wet     = Maps.wetness[CellIdx];

    // ① Gaea TextureBase + SatMap multi-frequency indexing (zero plastic flat ramps!)
    const Grain = (MicroFbm(Wx * 0.018, Wz * 0.018, Region.seed || 4029) - 0.5) * (Cfg.macroVariation ?? 0.68) * 0.42;
    const StrataIdx = Mix(HNorm, Strata, Clamp(Cfg.strataVisibility ?? 0.64, 0.0, 1.0));
    const RockLookup = Clamp(0.48 * StrataIdx + 0.28 * Prot + 0.24 * (Curv - 0.5) + Grain, 0.0, 1.0);
    const SoilLookup = Clamp(0.54 * HNorm - 0.22 * Flow + 0.24 * (1.0 - Curv) + Grain * 0.85, 0.0, 1.0);

    const RockCol = SampleRamp4(Theme.rockRamp, RockLookup);
    const SoilCol = SampleRamp4(Theme.soilRamp, SoilLookup);

    // Bedrock exposure grows on steep slopes, high protrusion ridges, and scoured wear zones
    const VegFactor = Clamp((Cfg.mossLine ?? 0.55) * Theme.vegStrength, 0.0, 1.2);
    const SoilCover = Clamp((1.0 - Smoothstep(0.24, 0.52, Slope)) * (0.35 + 0.65 * VegFactor + 0.55 * Deposit) * (1.0 - 0.45 * Prot), 0.0, 1.0);
    let Albedo = Mix3(RockCol, SoilCol, SoilCover);

    // ② Layer geomorphological material deposits: Alluvium, Talus Scree, Aeolian Sand, Chemical Varnish, Shore & Snow!
    if (Deposit > 0.03)
    {
        Albedo = Mix3(Albedo, SampleRamp4(Theme.soilRamp, Clamp(0.75 + Grain * 0.4, 0.0, 1.0)), Clamp(Deposit * 0.78, 0.0, 0.88));
    }
    if (Talus > 0.03)
    {
        const ClastVar = 0.82 + 0.36 * ValueNoise2(Wx * 0.09, Wz * 0.09, 771);
        Albedo = Mix3(Albedo, [Theme.talusCol[0] * ClastVar, Theme.talusCol[1] * ClastVar, Theme.talusCol[2] * ClastVar], Clamp(Talus * 0.88, 0.0, 0.94));
    }
    if (Sand > 0.02)
    {
        const RippleShade = 0.90 + 0.20 * Math.sin((Wx * 0.75 + Wz * 0.66) * 0.18);
        Albedo = Mix3(Albedo, [Theme.sandCol[0] * RippleShade, Theme.sandCol[1] * RippleShade, Theme.sandCol[2] * RippleShade], Clamp(Smoothstep(0.02, 0.36, Sand), 0.0, 0.97));
    }
    if (Chem > 0.04)
    {
        Albedo = Mix3(Albedo, Theme.chemCol, Clamp(Chem * 0.68, 0.0, 0.82));
    }
    if (Pit > 0.05)
    {
        // Darken frost/tafoni fracture cavities slightly for sculptural micro-contrast
        Albedo = Mix3(Albedo, [Albedo[0] * 0.52, Albedo[1] * 0.50, Albedo[2] * 0.48], Clamp(Pit * 0.55, 0.0, 0.65));
    }

    // Coastal beach / littoral rock band near sea level
    const RelH = Wy - (World.seaLevel ?? 0.0);
    if (RelH < 4.8 && Slope < 0.36 && Rt.sdf2D[CellIdx] > -42.0)
    {
        const BeachW = (1.0 - Smoothstep(0.8, 4.8, RelH)) * (1.0 - Smoothstep(0.18, 0.36, Slope));
        Albedo = Mix3(Albedo, Theme.shoreCol, Clamp(BeachW * 0.82, 0.0, 0.9));
    }

    // ③ Composable Procedural Geological Surface Stamps (Albedo + Micro-Normal Relief!)
    let NxP = BaseNormal[0], NyP = BaseNormal[1], NzP = BaseNormal[2];
    if (Array.isArray(Cfg.stamps))
    {
        for (const Stamp of Cfg.stamps)
        {
            if (!Stamp || Stamp.enabled === false) continue;
            const SrcArr = Maps[Stamp.maskMap] || Maps.slope;
            let MVal = SrcArr[CellIdx];
            if (Stamp.invertMask) MVal = 1.0 - MVal;
            const MaskW = Smoothstep(Stamp.maskMin ?? 0.1, Stamp.maskMax ?? 0.9, MVal) * Clamp(Stamp.strength ?? 0.7, 0.0, 1.0);
            if (MaskW <= 0.01) continue;

            const SVal = EvaluateProceduralStampPattern(Stamp, Wx, Wy, Wz);
            const Spec = GAEA_SURFACE_STAMPS[Stamp.stampType] || GAEA_SURFACE_STAMPS['sandstone-cuts'];

            // Modulate Albedo with crisp lithological stamp contrast
            const ContrastMul = Mix(0.68, 1.24, SVal);
            const StampedCol = Mix3(
                [Albedo[0] * ContrastMul, Albedo[1] * ContrastMul, Albedo[2] * ContrastMul],
                Spec.tint,
                (1.0 - SVal) * 0.34
            );
            Albedo = Mix3(Albedo, StampedCol, MaskW * 0.82);

            // Finite-difference micro-normal bump for crisp raking-sun rock detail!
            const BumpAmt = (Stamp.bumpStrength ?? 0.6) * MaskW * 0.38;
            if (BumpAmt > 0.01)
            {
                const Eps = 1.35;
                const Sx1 = EvaluateProceduralStampPattern(Stamp, Wx + Eps, Wy, Wz);
                const Sz1 = EvaluateProceduralStampPattern(Stamp, Wx, Wy, Wz + Eps);
                NxP -= ((Sx1 - SVal) / Eps) * BumpAmt;
                NzP -= ((Sz1 - SVal) / Eps) * BumpAmt;
            }
        }
    }

    // Orographic / Seasonal Snowpack & Glacier Ice Crown
    const AutoSnow = (Cfg.snowLineBoost ?? 0.0) > 0.01
        ? Smoothstep(1.0 - Cfg.snowLineBoost, 1.02 - Cfg.snowLineBoost * 0.5, HNorm) * (1.0 - Smoothstep(0.52, 0.82, Slope))
        : 0.0;
    const SnowMask = Clamp(Math.max(Snow, AutoSnow), 0.0, 1.0);
    if (SnowMask > 0.02)
    {
        Albedo = Mix3(Albedo, Theme.snowCol, SnowMask);
    }

    // Horizon Cavity Ambient Occlusion bake
    const AoMul = Mix(1.0, 0.48 + 0.52 * Ao, Clamp(Cfg.aoDarkening ?? 0.52, 0.0, 1.0));
    Albedo[0] *= AoMul;
    Albedo[1] *= AoMul;
    Albedo[2] *= AoMul;

    const NL = Math.hypot(NxP, NyP, NzP) || 1.0;
    return {
        color: Albedo,
        normal: [NxP / NL, NyP / NL, NzP / NL],
        aux0: Rt.falloffMap ? Rt.falloffMap[CellIdx] : 1.0,
        aux1: Clamp(Wet * (1.0 - SnowMask), 0.0, 1.0) // Passed to TERRAIN_FS for damp specular rock darkening!
    };
}

//------------------------------------------------------------------------------------------------------------------------
//                           GAEA DIAGNOSTIC COLORIZER & FULL PNG / SPLATMAP EXPORTERS
//------------------------------------------------------------------------------------------------------------------------

export function ColorizeGaeaScalar(T, Ramp = 'heat', LinearOut = false)
{
    const V = Clamp(T, 0.0, 1.0);
    let C;
    if (Ramp === 'mono')
    {
        C = [V, V, V];
    }
    else if (Ramp === 'cyan')
    {
        C = V < 0.5 ? Mix3([0.05, 0.08, 0.14], [0.08, 0.48, 0.72], V * 2.0) : Mix3([0.08, 0.48, 0.72], [0.78, 0.96, 1.0], (V - 0.5) * 2.0);
    }
    else if (Ramp === 'crimson')
    {
        C = V < 0.5 ? Mix3([0.07, 0.06, 0.09], [0.68, 0.14, 0.18], V * 2.0) : Mix3([0.68, 0.14, 0.18], [1.0, 0.78, 0.36], (V - 0.5) * 2.0);
    }
    else if (Ramp === 'ochre' || Ramp === 'amber' || Ramp === 'gold')
    {
        C = V < 0.5 ? Mix3([0.08, 0.07, 0.06], [0.62, 0.38, 0.12], V * 2.0) : Mix3([0.62, 0.38, 0.12], [0.98, 0.86, 0.52], (V - 0.5) * 2.0);
    }
    else if (Ramp === 'violet')
    {
        C = V < 0.5 ? Mix3([0.07, 0.06, 0.11], [0.48, 0.22, 0.74], V * 2.0) : Mix3([0.48, 0.22, 0.74], [0.96, 0.74, 1.0], (V - 0.5) * 2.0);
    }
    else if (Ramp === 'rust')
    {
        C = V < 0.5 ? Mix3([0.08, 0.07, 0.07], [0.58, 0.20, 0.08], V * 2.0) : Mix3([0.58, 0.20, 0.08], [0.95, 0.62, 0.24], (V - 0.5) * 2.0);
    }
    else if (Ramp === 'ice')
    {
        C = V < 0.5 ? Mix3([0.06, 0.09, 0.14], [0.34, 0.64, 0.88], V * 2.0) : Mix3([0.34, 0.64, 0.88], [0.96, 0.98, 1.0], (V - 0.5) * 2.0);
    }
    else if (Ramp === 'teal')
    {
        C = V < 0.5 ? Mix3([0.06, 0.08, 0.10], [0.08, 0.54, 0.48], V * 2.0) : Mix3([0.08, 0.54, 0.48], [0.68, 0.96, 0.86], (V - 0.5) * 2.0);
    }
    else if (Ramp === 'diverg')
    {
        C = V < 0.5 ? Mix3([0.14, 0.46, 0.82], [0.16, 0.17, 0.19], V * 2.0) : Mix3([0.16, 0.17, 0.19], [0.94, 0.56, 0.18], (V - 0.5) * 2.0);
    }
    else
    {
        // Turbo / Elevation / Solar diagnostic ramp
        if (V < 0.33) C = Mix3([0.08, 0.22, 0.48], [0.14, 0.58, 0.38], V / 0.33);
        else if (V < 0.68) C = Mix3([0.14, 0.58, 0.38], [0.84, 0.62, 0.16], (V - 0.33) / 0.35);
        else C = Mix3([0.84, 0.62, 0.16], [0.92, 0.24, 0.16], (V - 0.68) / 0.32);
    }

    if (LinearOut)
    {
        return [Math.pow(C[0], 2.0) * 0.72, Math.pow(C[1], 2.0) * 0.72, Math.pow(C[2], 2.0) * 0.72];
    }
    return C;
}

export function RenderGaeaMapToCanvas(Region, MapId, Colorize = true, TargetCanvas = null)
{
    const Rt = Region?.runtime;
    const Maps = Rt?.gaeaMaps;
    if (!Rt || !Maps || !Maps[MapId]) return null;

    const Nx = Rt.nx, Nz = Rt.nz;
    const Cvs = TargetCanvas || document.createElement('canvas');
    Cvs.width = Nx;
    Cvs.height = Nz;
    const Ctx = Cvs.getContext('2d');
    const Img = Ctx.createImageData(Nx, Nz);
    const Pix = Img.data;
    const Src = Maps[MapId];
    const Sdf = Rt.sdf2D;
    const Spec = GAEA_DATA_MAPS.find(M => M.id === MapId);

    for (let I = 0; I < Nx * Nz; ++I)
    {
        const P = I * 4;
        if (Sdf[I] > Rt.stepX * 0.8)
        {
            Pix[P] = 10; Pix[P + 1] = 14; Pix[P + 2] = 20; Pix[P + 3] = 255;
            continue;
        }
        const Val = Clamp(Src[I], 0.0, 1.0);
        if (Colorize)
        {
            const C = ColorizeGaeaScalar(Val, Spec?.ramp || 'heat', false);
            Pix[P]     = Math.round(C[0] * 255);
            Pix[P + 1] = Math.round(C[1] * 255);
            Pix[P + 2] = Math.round(C[2] * 255);
        }
        else
        {
            const G = Math.round(Val * 255);
            Pix[P] = G; Pix[P + 1] = G; Pix[P + 2] = G;
        }
        Pix[P + 3] = 255;
    }
    Ctx.putImageData(Img, 0, 0);
    return Cvs;
}

export function RenderAlbedoAndNormalCanvases(World, Region)
{
    const Rt = Region?.runtime;
    if (!Rt || !Rt.gaeaMaps) return null;
    const Nx = Rt.nx, Nz = Rt.nz, StepX = Rt.stepX, StepZ = Rt.stepZ;
    const B = Region.bounds;
    const H = Rt.heights;

    const AlbedoCvs = document.createElement('canvas');
    AlbedoCvs.width = Nx; AlbedoCvs.height = Nz;
    const NormalCvs = document.createElement('canvas');
    NormalCvs.width = Nx; NormalCvs.height = Nz;
    const SplatACvs = document.createElement('canvas');
    SplatACvs.width = Nx; SplatACvs.height = Nz;
    const SplatBCvs = document.createElement('canvas');
    SplatBCvs.width = Nx; SplatBCvs.height = Nz;

    const ACtx = AlbedoCvs.getContext('2d'), NCtx = NormalCvs.getContext('2d');
    const S1Ctx = SplatACvs.getContext('2d'), S2Ctx = SplatBCvs.getContext('2d');
    const AImg = ACtx.createImageData(Nx, Nz), NImg = NCtx.createImageData(Nx, Nz);
    const S1Img = S1Ctx.createImageData(Nx, Nz), S2Img = S2Ctx.createImageData(Nx, Nz);

    const SavedPreview = Region.texturing?.activeMapPreview;
    if (Region.texturing) Region.texturing.activeMapPreview = 'none';

    const Maps = Rt.gaeaMaps;
    for (let Z = 0; Z < Nz; ++Z)
    {
        const Wz = B.z + Z * StepZ;
        const Row = Z * Nx;
        for (let X = 0; X < Nx; ++X)
        {
            const I = Row + X;
            const P = I * 4;
            if (Rt.sdf2D[I] > StepX * 0.8)
            {
                AImg.data[P] = 12; AImg.data[P + 1] = 18; AImg.data[P + 2] = 26; AImg.data[P + 3] = 255;
                NImg.data[P] = 128; NImg.data[P + 1] = 128; NImg.data[P + 2] = 255; NImg.data[P + 3] = 255;
                S1Img.data[P + 3] = 255; S2Img.data[P + 3] = 255;
                continue;
            }

            const Xm = Math.max(0, X - 1), Xp = Math.min(Nx - 1, X + 1);
            const Zm = Math.max(0, Z - 1), Zp = Math.min(Nz - 1, Z + 1);
            const Dx = (H[Row + Xp] - H[Row + Xm]) / Math.max(1e-3, (Xp - Xm) * StepX);
            const Dz = (H[Zp * Nx + X] - H[Zm * Nx + X]) / Math.max(1e-3, (Zp - Zm) * StepZ);
            const InvL = 1.0 / Math.sqrt(Dx * Dx + 1.0 + Dz * Dz);
            const BaseN = [-Dx * InvL, InvL, -Dz * InvL];

            const App = EvaluateGaeaVertexAppearance(World, Region, I, B.x + X * StepX, H[I], Wz, BaseN);
            // Convert linear albedo to sRGB for PNG export
            AImg.data[P]     = Math.round(Clamp(Math.pow(App.color[0] * 1.45, 1 / 2.2), 0, 1) * 255);
            AImg.data[P + 1] = Math.round(Clamp(Math.pow(App.color[1] * 1.45, 1 / 2.2), 0, 1) * 255);
            AImg.data[P + 2] = Math.round(Clamp(Math.pow(App.color[2] * 1.45, 1 / 2.2), 0, 1) * 255);
            AImg.data[P + 3] = 255;

            NImg.data[P]     = Math.round((App.normal[0] * 0.5 + 0.5) * 255);
            NImg.data[P + 1] = Math.round((App.normal[2] * 0.5 + 0.5) * 255);
            NImg.data[P + 2] = Math.round((App.normal[1] * 0.5 + 0.5) * 255);
            NImg.data[P + 3] = 255;

            // SplatA: R=Bedrock, G=Deposit, B=Talus, A=Sand (normalized weights)
            const Dep = Maps.deposit[I], Tal = Maps.talus[I], Snd = Maps.sand[I];
            const BedW = Clamp(1.0 - Dep - Tal - Snd, 0.0, 1.0);
            S1Img.data[P]     = Math.round(BedW * 255);
            S1Img.data[P + 1] = Math.round(Dep * 255);
            S1Img.data[P + 2] = Math.round(Tal * 255);
            S1Img.data[P + 3] = Math.round(Clamp(0.25 + 0.75 * Snd, 0.0, 1.0) * 255);

            // SplatB: R=Flow, G=Wear, B=Snow, A=Wetness
            S2Img.data[P]     = Math.round(Maps.flow[I] * 255);
            S2Img.data[P + 1] = Math.round(Maps.wear[I] * 255);
            S2Img.data[P + 2] = Math.round(Maps.snow[I] * 255);
            S2Img.data[P + 3] = Math.round(Clamp(0.35 + 0.65 * Maps.wetness[I], 0.0, 1.0) * 255);
        }
    }

    if (Region.texturing) Region.texturing.activeMapPreview = SavedPreview;
    ACtx.putImageData(AImg, 0, 0);
    NCtx.putImageData(NImg, 0, 0);
    S1Ctx.putImageData(S1Img, 0, 0);
    S2Ctx.putImageData(S2Img, 0, 0);

    return { albedo: AlbedoCvs, normal: NormalCvs, splatA: SplatACvs, splatB: SplatBCvs };
}
