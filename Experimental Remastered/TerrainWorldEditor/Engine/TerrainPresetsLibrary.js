/*====================================================================================================================================
                                                     TERRAINPRESETSLIBRARY.JS
====================================================================================================================================*/
// 🧩 Complete geological, physically-based erosion, climate & Gaea SatMap/Stamp preset library for Open-World 2D Masks

import { CreateDefaultTexturingConfig } from './TerrainGaeaTexturing.js';

export const TERRAIN_BIOME_PRESETS = [
    {
        id: 'icelandic-highlands',
        name: 'Icelandic Glacial Highlands',
        category: 'Alpine & Glacial',
        subtitle: 'Columnar basalt, rhyolite bands, subarctic moss, frost pitting & black-sand sandur',
        shorelineBevel: 18.0,
        baseElevation: 3.0,
        maxRelief: 255.0,
        climateRegime: 'subarctic-glacial',
        windAzimuthDeg: 35.0,
        windSpeed: 0.62,
        windShiftMode: 'variable',
        lithology: { rockHardness: 0.58, strataContrast: 0.80, strataFrequency: 10.5, dipDeg: 7.5, strikeDeg: 18.0, jointDensity: 0.64, carbonateSolubility: 0.18, ironMineral: 0.66 },
        texturing: CreateDefaultTexturingConfig('icelandic-basalt', ['basalt-columns', 'tafoni-pits', 'alluvial-cobbles']),
        buildLayers: (CreateLayer, Bounds) => [
            CreateLayer('multifractal', { name: 'Icelandic Basalt Massif', amplitude: 175, scale: 2.2, octaves: 6, gain: 0.54, warp: 0.36, falloff: { mode: 'soft', distance: 310, edgeFloor: 0.05 } }),
            CreateLayer('ridged', { name: 'Rhyolite Thrust Ridges', amplitude: 95, scale: 2.7, sharpness: 0.72, azimuth: 32, falloff: { mode: 'continental', distance: 360, edgeFloor: 0.0 } }),
            CreateLayer('terrace', { name: 'Flood-Basalt Traps', bedCount: 10, strength: 0.74, dipDeg: 6.5, strikeDeg: 18, falloff: { mode: 'none', distance: 120, edgeFloor: 1.0 } }),
            CreateLayer('erosion-seasonal', { name: 'Subarctic Glacial & Melt Cycle', iterations: 16, rainIntensity: 0.78, snowfallRate: 0.86, glacierStrength: 0.72, frostIntensity: 0.84, rockfallIntensity: 0.58 })
        ]
    },
    {
        id: 'himalayan-karakoram',
        name: 'Himalayan Snow Mountains',
        category: 'Alpine & Glacial',
        subtitle: 'Asymmetric arête massif, frost-shattered peaks, rockfall couloirs & glacier trough',
        shorelineBevel: 24.0,
        baseElevation: 4.0,
        maxRelief: 320.0,
        climateRegime: 'alpine-continental',
        windAzimuthDeg: -25.0,
        windSpeed: 0.68,
        windShiftMode: 'variable',
        lithology: { rockHardness: 0.72, strataContrast: 0.66, strataFrequency: 8.5, dipDeg: 22.0, strikeDeg: -14.0, jointDensity: 0.62, carbonateSolubility: 0.14, ironMineral: 0.35 },
        texturing: (() => { const T = CreateDefaultTexturingConfig('himalayan-gneiss', ['tectonic-cracks', 'talus-clasts']); T.snowLineBoost = 0.42; return T; })(),
        buildLayers: (CreateLayer) => [
            CreateLayer('ridged', { name: 'Karakoram Monarch Arêtes', amplitude: 245, scale: 2.05, octaves: 6, sharpness: 0.84, azimuth: 28, falloff: { mode: 'continental', distance: 380, edgeFloor: 0.02 } }),
            CreateLayer('multifractal', { name: 'Gneiss Shoulder Buttresses', amplitude: 110, scale: 2.8, octaves: 5, gain: 0.56, warp: 0.40, falloff: { mode: 'soft', distance: 290, edgeFloor: 0.0 } }),
            CreateLayer('erosion-pitting', { name: 'High-Altitude Frost Shattering', iterations: 10, frostIntensity: 0.94, thermalIntensity: 0.48, jointSensitivity: 0.88 }),
            CreateLayer('erosion-rockfall', { name: 'Couloir Rockfall & Scree Cones', iterations: 10, rockfallIntensity: 0.86, criticalCliffDeg: 43, talusReposeDeg: 36 }),
            CreateLayer('erosion-seasonal', { name: 'Glacial Snow & Meltwater', iterations: 12, snowfallRate: 0.95, glacierStrength: 0.88, rainIntensity: 0.62 })
        ]
    },
    {
        id: 'layered-plateau',
        name: 'Stratified Canyon Plateau',
        category: 'Canyons & Sandstone',
        subtitle: 'Utah Navajo sandstone caprocks, Venturi canyon wind cuts, tafoni pits & flash gorges',
        shorelineBevel: 4.0,
        baseElevation: 6.0,
        maxRelief: 245.0,
        climateRegime: 'arid-desert',
        windAzimuthDeg: 40.0,
        windSpeed: 0.82,
        windShiftMode: 'sectors',
        lithology: { rockHardness: 0.48, strataContrast: 0.92, strataFrequency: 10.0, dipDeg: 5.0, strikeDeg: 14.0, jointDensity: 0.66, carbonateSolubility: 0.28, ironMineral: 0.74 },
        texturing: CreateDefaultTexturingConfig('utah-navajo', ['sandstone-cuts', 'tafoni-pits', 'talus-clasts']),
        buildLayers: (CreateLayer, B) => [
            CreateLayer('voronoi', { name: 'Sandstone Mesa Caprocks', variant: 0, amplitude: 168, scale: 2.5, sharpness: 0.84, falloff: { mode: 'plateau', distance: 120, edgeFloor: 0.35 } }),
            CreateLayer('terrace', { name: 'Kayenta-Wingate Benches', bedCount: 11, strength: 0.86, dipDeg: 4.5, strikeDeg: 14, falloff: { mode: 'none', distance: 100, edgeFloor: 1.0 } }),
            CreateLayer('spline', {
                name: 'Slot Canyon Trunk', splineMode: 'canyon', width: 96, amount: 78, bankSmooth: 0.36, meander: 0.24,
                falloff: { mode: 'none', distance: 100, edgeFloor: 1.0 },
                points: [[Math.round(B.x + B.width * 0.22), Math.round(B.z + B.depth * 0.26)], [Math.round(B.x + B.width * 0.52), Math.round(B.z + B.depth * 0.50)], [Math.round(B.x + B.width * 0.80), Math.round(B.z + B.depth * 0.72)]]
            }),
            CreateLayer('erosion-wind', { name: 'Canyon Venturi Sandstone Cuts', iterations: 16, windSpeed: 0.88, canyonAbrasion: 1.15, venturiChannelling: 1.25, duneSaltation: 0.48, sandSupply: 0.28 }),
            CreateLayer('erosion-pitting', { name: 'Solar Insolation & Tafoni Pits', iterations: 10, frostIntensity: 0.25, thermalIntensity: 0.96, tafoniStrength: 0.92 }),
            CreateLayer('erosion-hydraulic', { name: 'Desert Flash-Flood Incision', iterations: 10, rainIntensity: 0.52, erosionStrength: 0.84, evaporation: 0.68 })
        ]
    },
    {
        id: 'grand-canyon',
        name: 'Grand Canyon Gorge',
        category: 'Canyons & Sandstone',
        subtitle: 'Vishnu inner gorge, Redwall-Supai cliff benches, river channel & talus aprons',
        shorelineBevel: 6.0,
        baseElevation: 8.0,
        maxRelief: 280.0,
        climateRegime: 'arid-desert',
        windAzimuthDeg: 36.0,
        windSpeed: 0.64,
        windShiftMode: 'variable',
        lithology: { rockHardness: 0.64, strataContrast: 0.95, strataFrequency: 13.0, dipDeg: 3.0, strikeDeg: 10.0, jointDensity: 0.62, carbonateSolubility: 0.42, ironMineral: 0.78 },
        texturing: CreateDefaultTexturingConfig('grand-canyon', ['sandstone-cuts', 'tectonic-cracks', 'talus-clasts']),
        buildLayers: (CreateLayer, B) => [
            CreateLayer('multifractal', { name: 'Kaibab Plateau Uplift', amplitude: 198, scale: 1.9, octaves: 6, gain: 0.50, falloff: { mode: 'plateau', distance: 140, edgeFloor: 0.45 } }),
            CreateLayer('terrace', { name: 'Redwall-Supai Cliff Strata', bedCount: 14, strength: 0.88, dipDeg: 3.0, strikeDeg: 10.0, falloff: { mode: 'none', distance: 100, edgeFloor: 1.0 } }),
            CreateLayer('spline', {
                name: 'Colorado Inner Gorge River', splineMode: 'river', width: 132, amount: 95, bankSmooth: 0.45, meander: 0.32,
                falloff: { mode: 'none', distance: 100, edgeFloor: 1.0 },
                points: [[Math.round(B.x + B.width * 0.16), Math.round(B.z + B.depth * 0.32)], [Math.round(B.x + B.width * 0.48), Math.round(B.z + B.depth * 0.56)], [Math.round(B.x + B.width * 0.84), Math.round(B.z + B.depth * 0.44)]]
            }),
            CreateLayer('erosion-hydraulic', { name: 'Side-Canyon Tributary Incision', iterations: 16, rainIntensity: 0.74, erosionStrength: 0.88, sedimentCapacity: 0.86 }),
            CreateLayer('erosion-wind', { name: 'Gorge Venturi Sandstone Fluting', iterations: 12, windSpeed: 0.76, canyonAbrasion: 0.95, venturiChannelling: 1.15, sandSupply: 0.18 }),
            CreateLayer('erosion-rockfall', { name: 'Redwall Cliff Talus Cones', iterations: 10, rockfallIntensity: 0.82, criticalCliffDeg: 45, talusReposeDeg: 35.5 })
        ]
    },
    {
        id: 'studlagil-basalt',
        name: 'Stuðlagil Basalt Canyon',
        category: 'Canyons & Sandstone',
        subtitle: 'Sheer hexagonal basalt colonnades, oxidized rust waterline & turquoise river',
        shorelineBevel: 0.0,
        baseElevation: 8.0,
        maxRelief: 225.0,
        climateRegime: 'subarctic-glacial',
        windAzimuthDeg: -24.0,
        windSpeed: 0.52,
        windShiftMode: 'variable',
        lithology: { rockHardness: 0.76, strataContrast: 0.86, strataFrequency: 11.0, dipDeg: 2.5, strikeDeg: -8.0, jointDensity: 0.78, carbonateSolubility: 0.12, ironMineral: 0.86 },
        texturing: CreateDefaultTexturingConfig('studlagil-columnar', ['basalt-columns', 'tectonic-cracks', 'talus-clasts']),
        buildLayers: (CreateLayer, B) => [
            CreateLayer('voronoi', { name: 'Columnar Basalt Tableland', variant: 0, amplitude: 152, scale: 3.1, sharpness: 0.88, falloff: { mode: 'none', distance: 120, edgeFloor: 1.0 } }),
            CreateLayer('terrace', { name: 'Hexagonal Entablature Tiers', bedCount: 9, strength: 0.84, dipDeg: 2.5, strikeDeg: -8.0, falloff: { mode: 'none', distance: 100, edgeFloor: 1.0 } }),
            CreateLayer('spline', {
                name: 'Jökla Glacial Gorge', splineMode: 'river', width: 98, amount: 72, bankSmooth: 0.32, meander: 0.22,
                falloff: { mode: 'none', distance: 100, edgeFloor: 1.0 },
                points: [[Math.round(B.x + B.width * 0.20), Math.round(B.z + B.depth * 0.24)], [Math.round(B.x + B.width * 0.52), Math.round(B.z + B.depth * 0.50)], [Math.round(B.x + B.width * 0.80), Math.round(B.z + B.depth * 0.76)]]
            }),
            CreateLayer('erosion-pitting', { name: 'Columnar Joint Freeze-Thaw', iterations: 10, frostIntensity: 0.82, thermalIntensity: 0.35, jointSensitivity: 0.95 }),
            CreateLayer('erosion-chemical', { name: 'Basalt Iron-Oxide Waterline Stain', iterations: 10, karstDissolution: 0.18, mineralStaining: 0.94 }),
            CreateLayer('erosion-hydraulic', { name: 'Glacial Meltwater Channel', iterations: 12, rainIntensity: 0.72, headwaterFlow: 0.65 })
        ]
    },
    {
        id: 'fjadrargljufur-palagonite',
        name: 'Fjaðrárgljúfur Canyon',
        category: 'Canyons & Sandstone',
        subtitle: 'Serpentine palagonite tuff gorge, emerald moss buttresses & clear meltwater',
        shorelineBevel: 12.0,
        baseElevation: 4.5,
        maxRelief: 210.0,
        climateRegime: 'temperate-oceanic',
        windAzimuthDeg: -30.0,
        windSpeed: 0.54,
        windShiftMode: 'variable',
        lithology: { rockHardness: 0.50, strataContrast: 0.76, strataFrequency: 10.0, dipDeg: 5.0, strikeDeg: 16.0, jointDensity: 0.68, carbonateSolubility: 0.26, ironMineral: 0.62 },
        texturing: CreateDefaultTexturingConfig('icelandic-basalt', ['tectonic-cracks', 'tafoni-pits', 'alluvial-cobbles']),
        buildLayers: (CreateLayer, B) => [
            CreateLayer('multifractal', { name: 'Palagonite Heathland', amplitude: 148, scale: 2.4, octaves: 6, gain: 0.52, falloff: { mode: 'soft', distance: 220, edgeFloor: 0.08 } }),
            CreateLayer('spline', {
                name: 'Serpentine Fjaðrá Gorge', splineMode: 'river', width: 108, amount: 76, bankSmooth: 0.38, meander: 0.48,
                falloff: { mode: 'none', distance: 100, edgeFloor: 1.0 },
                points: [[Math.round(B.x + B.width * 0.22), Math.round(B.z + B.depth * 0.22)], [Math.round(B.x + B.width * 0.45), Math.round(B.z + B.depth * 0.54)], [Math.round(B.x + B.width * 0.78), Math.round(B.z + B.depth * 0.76)]]
            }),
            CreateLayer('erosion-hydraulic', { name: 'Spur-and-Gully Meltwater Scour', iterations: 16, rainIntensity: 0.84, erosionStrength: 0.82 }),
            CreateLayer('erosion-rockfall', { name: 'Tuff Buttress Calving', iterations: 8, rockfallIntensity: 0.68, criticalCliffDeg: 44 })
        ]
    },
    {
        id: 'namib-erg-dunes',
        name: 'Namib Sand Sea & Wind',
        category: 'Desert & Aeolian',
        subtitle: '34° slipface apricot mega-dunes, sandblasted inselbergs & calcrete pan',
        shorelineBevel: 28.0,
        baseElevation: 2.5,
        maxRelief: 195.0,
        climateRegime: 'arid-desert',
        windAzimuthDeg: 42.0,
        windSpeed: 0.96,
        windShiftMode: 'sectors',
        lithology: { rockHardness: 0.62, strataContrast: 0.64, strataFrequency: 7.5, dipDeg: 6.0, strikeDeg: 28.0, jointDensity: 0.52, carbonateSolubility: 0.20, ironMineral: 0.82 },
        texturing: CreateDefaultTexturingConfig('namib-erg', ['aeolian-ripples', 'sandstone-cuts']),
        buildLayers: (CreateLayer) => [
            CreateLayer('billow', { name: 'Transverse Barchanoid Erg', amplitude: 118, scale: 3.2, octaves: 5, duneMix: 0.84, azimuth: 42, falloff: { mode: 'soft', distance: 260, edgeFloor: 0.04 } }),
            CreateLayer('voronoi', { name: 'Dolerite Inselberg Outcrops', variant: 3, amplitude: 68, scale: 2.1, sharpness: 0.72, combine: 'max', falloff: { mode: 'continental', distance: 340, edgeFloor: 0.0 } }),
            CreateLayer('erosion-wind', { name: 'Bagnold Saltation & 34° Slipfaces', iterations: 20, windSpeed: 0.98, duneSaltation: 1.15, sandSupply: 0.88, canyonAbrasion: 0.64 })
        ]
    },
    {
        id: 'sahara-tassili-erg',
        name: 'Sahara Grand Erg & Star Dunes',
        category: 'Desert & Aeolian',
        subtitle: 'Multi-armed rotating wind-rose star dunes & manganese-varnished Tassili crags',
        shorelineBevel: 26.0,
        baseElevation: 3.0,
        maxRelief: 210.0,
        climateRegime: 'arid-desert',
        windAzimuthDeg: 55.0,
        windSpeed: 0.92,
        windShiftMode: 'rotate',
        lithology: { rockHardness: 0.56, strataContrast: 0.82, strataFrequency: 9.0, dipDeg: 5.0, strikeDeg: 20.0, jointDensity: 0.64, carbonateSolubility: 0.16, ironMineral: 0.76 },
        texturing: CreateDefaultTexturingConfig('sahara-varnish', ['aeolian-ripples', 'sandstone-cuts', 'tafoni-pits']),
        buildLayers: (CreateLayer) => [
            CreateLayer('billow', { name: 'Saharan Star-Dune Sea', amplitude: 126, scale: 2.8, octaves: 5, duneMix: 0.76, azimuth: 55, falloff: { mode: 'soft', distance: 250, edgeFloor: 0.04 } }),
            CreateLayer('ridged', { name: 'Tassili Sandstone Spires', amplitude: 92, scale: 3.4, sharpness: 0.82, azimuth: 18, combine: 'max', falloff: { mode: 'continental', distance: 360, edgeFloor: 0.0 } }),
            CreateLayer('erosion-wind', { name: 'Star-Rose Aeolian Saltation & Cuts', iterations: 18, windSpeed: 0.94, duneSaltation: 1.05, sandSupply: 0.76, canyonAbrasion: 0.82 }),
            CreateLayer('erosion-chemical', { name: 'Manganese Desert Rock Varnish', iterations: 8, karstDissolution: 0.12, mineralStaining: 0.88 })
        ]
    },
    {
        id: 'rugged-desert-crags',
        name: 'Wadi Rum Sandstone Crags & Cuts',
        category: 'Desert & Aeolian',
        subtitle: 'Joint-fissured sandstone monoliths, canyon wind cuts, tafoni & climbing dunes',
        shorelineBevel: 10.0,
        baseElevation: 5.0,
        maxRelief: 250.0,
        climateRegime: 'arid-desert',
        windAzimuthDeg: 32.0,
        windSpeed: 0.90,
        windShiftMode: 'sectors',
        lithology: { rockHardness: 0.50, strataContrast: 0.90, strataFrequency: 11.0, dipDeg: 4.0, strikeDeg: -12.0, jointDensity: 0.78, carbonateSolubility: 0.24, ironMineral: 0.72 },
        texturing: CreateDefaultTexturingConfig('utah-navajo', ['sandstone-cuts', 'tafoni-pits', 'aeolian-ripples']),
        buildLayers: (CreateLayer) => [
            CreateLayer('voronoi', { name: 'Joint-Bounded Sandstone Massifs', variant: 0, amplitude: 185, scale: 2.6, sharpness: 0.86, falloff: { mode: 'soft', distance: 180, edgeFloor: 0.12 } }),
            CreateLayer('terrace', { name: 'Cross-Bedded Sandstone Strata', bedCount: 12, strength: 0.80, dipDeg: 4.0, falloff: { mode: 'none', distance: 100, edgeFloor: 1.0 } }),
            CreateLayer('erosion-wind', { name: 'Venturi Corridor Sandstone Cuts', iterations: 18, windSpeed: 0.96, canyonAbrasion: 1.25, venturiChannelling: 1.35, duneSaltation: 0.78, sandSupply: 0.48 }),
            CreateLayer('erosion-pitting', { name: 'Insolation Cracking & Honeycomb Tafoni', iterations: 12, frostIntensity: 0.18, thermalIntensity: 1.05, tafoniStrength: 0.95 }),
            CreateLayer('erosion-rockfall', { name: 'Cliff-Toe Scree & Talus Aprons', iterations: 8, rockfallIntensity: 0.72 })
        ]
    },
    {
        id: 'yardang-wind-corridor',
        name: 'Aeolian Yardang Wind Corridor',
        category: 'Desert & Aeolian',
        subtitle: 'Streamlined wind-carved sandstone yardang fins, basal undercuts & sand tails',
        shorelineBevel: 16.0,
        baseElevation: 4.0,
        maxRelief: 185.0,
        climateRegime: 'arid-desert',
        windAzimuthDeg: 30.0,
        windSpeed: 1.0,
        windShiftMode: 'fixed',
        lithology: { rockHardness: 0.38, strataContrast: 0.92, strataFrequency: 12.0, dipDeg: 2.0, strikeDeg: 30.0, jointDensity: 0.72, carbonateSolubility: 0.22, ironMineral: 0.65 },
        texturing: CreateDefaultTexturingConfig('badlands-painted', ['sandstone-cuts', 'aeolian-ripples', 'tafoni-pits']),
        buildLayers: (CreateLayer) => [
            CreateLayer('ridged', { name: 'Parallel Yardang Mudstone Ridges', amplitude: 132, scale: 3.8, sharpness: 0.78, azimuth: 30, falloff: { mode: 'soft', distance: 220, edgeFloor: 0.05 } }),
            CreateLayer('terrace', { name: 'Horizontal Lacustrine Cap-Beds', bedCount: 10, strength: 0.84, dipDeg: 1.5, falloff: { mode: 'none', distance: 100, edgeFloor: 1.0 } }),
            CreateLayer('erosion-wind', { name: 'Unidirectional Corrasion & Sand Tails', iterations: 22, windAzimuthDeg: 30, useWeatherWind: false, windSpeed: 1.05, canyonAbrasion: 1.35, venturiChannelling: 1.30, duneSaltation: 0.82, sandSupply: 0.44 })
        ]
    },
    {
        id: 'desert-oasis-erg',
        name: 'Desert Dunes & Artesian Oasis',
        category: 'Desert & Aeolian',
        subtitle: 'Golden slipface dunes encircling a crystal non-flooding artesian oasis lagoon',
        shorelineBevel: 24.0,
        baseElevation: 3.5,
        maxRelief: 175.0,
        climateRegime: 'arid-desert',
        windAzimuthDeg: 48.0,
        windSpeed: 0.84,
        windShiftMode: 'variable',
        lithology: { rockHardness: 0.52, strataContrast: 0.65, strataFrequency: 8.0, dipDeg: 3.0, strikeDeg: 15.0, jointDensity: 0.48, carbonateSolubility: 0.35, ironMineral: 0.55 },
        texturing: CreateDefaultTexturingConfig('sahara-varnish', ['aeolian-ripples', 'alluvial-cobbles']),
        buildLayers: (CreateLayer, B) => [
            CreateLayer('billow', { name: 'Golden Erg Dune Ring', amplitude: 108, scale: 2.9, octaves: 5, duneMix: 0.80, azimuth: 48, falloff: { mode: 'rim', distance: 240, edgeFloor: 0.06 } }),
            CreateLayer('spline', {
                name: 'Artesian Oasis Basin', splineMode: 'lake', width: 185, amount: 34, bankSmooth: 0.72,
                falloff: { mode: 'none', distance: 100, edgeFloor: 1.0 },
                points: [[Math.round(B.x + B.width * 0.44), Math.round(B.z + B.depth * 0.48)], [Math.round(B.x + B.width * 0.56), Math.round(B.z + B.depth * 0.52)]]
            }),
            CreateLayer('erosion-wind', { name: 'Erg Slipface Saltation', iterations: 14, windSpeed: 0.86, duneSaltation: 0.96, sandSupply: 0.65, canyonAbrasion: 0.32 })
        ]
    },
    {
        id: 'alpine-divide',
        name: 'Tectonic Alpine Divide',
        category: 'Alpine & Glacial',
        subtitle: 'High folded thrust ridge with snow-dusted summits, valleys & alluvial fans',
        shorelineBevel: 20.0,
        baseElevation: 3.5,
        maxRelief: 275.0,
        climateRegime: 'alpine-continental',
        windAzimuthDeg: 18.0,
        windSpeed: 0.56,
        windShiftMode: 'variable',
        lithology: { rockHardness: 0.60, strataContrast: 0.62, strataFrequency: 8.0, dipDeg: 18.0, strikeDeg: 22.0, jointDensity: 0.58, carbonateSolubility: 0.22, ironMineral: 0.44 },
        texturing: (() => { const T = CreateDefaultTexturingConfig('alpine-granite', ['tectonic-cracks', 'talus-clasts', 'alluvial-cobbles']); T.snowLineBoost = 0.28; return T; })(),
        buildLayers: (CreateLayer) => [
            CreateLayer('multifractal', { name: 'Continental Uplift Base', amplitude: 185, scale: 2.0, octaves: 6, gain: 0.54, warp: 0.34, falloff: { mode: 'soft', distance: 320, edgeFloor: 0.04 } }),
            CreateLayer('ridged', { name: 'Folded Thrust Divide', amplitude: 138, scale: 2.35, sharpness: 0.76, azimuth: 36, falloff: { mode: 'continental', distance: 380, edgeFloor: 0.0 } }),
            CreateLayer('erosion-seasonal', { name: '4-Season Alpine Erosion', iterations: 16, rainIntensity: 0.76, snowfallRate: 0.68, frostIntensity: 0.78, rockfallIntensity: 0.72 })
        ]
    },
    {
        id: 'fault-escarpment',
        name: 'Tilted Fault Escarpment',
        category: 'Canyons & Sandstone',
        subtitle: 'Steep uplifted fault block shedding Mohr-Coulomb rockfall scree & gravel fans',
        shorelineBevel: 8.0,
        baseElevation: 5.0,
        maxRelief: 245.0,
        climateRegime: 'mediterranean-karst',
        windAzimuthDeg: 55.0,
        windSpeed: 0.52,
        windShiftMode: 'variable',
        lithology: { rockHardness: 0.50, strataContrast: 0.80, strataFrequency: 9.0, dipDeg: 15.0, strikeDeg: 32.0, jointDensity: 0.74, carbonateSolubility: 0.34, ironMineral: 0.58 },
        texturing: CreateDefaultTexturingConfig('utah-navajo', ['tectonic-cracks', 'talus-clasts', 'alluvial-cobbles']),
        buildLayers: (CreateLayer) => [
            CreateLayer('ridged', { name: 'Normal-Fault Escarpment Front', amplitude: 195, scale: 1.75, sharpness: 0.82, azimuth: 32, falloff: { mode: 'plateau', distance: 150, edgeFloor: 0.25 } }),
            CreateLayer('terrace', { name: 'Tilted Hanging-Wall Beds', bedCount: 9, strength: 0.78, dipDeg: 15.0, strikeDeg: 32.0, falloff: { mode: 'none', distance: 100, edgeFloor: 1.0 } }),
            CreateLayer('erosion-rockfall', { name: 'Heavy Scarp Calving & Talus Aprons', iterations: 16, rockfallIntensity: 0.96, criticalCliffDeg: 40, talusReposeDeg: 35.5, couloirScour: 0.84 }),
            CreateLayer('erosion-hydraulic', { name: 'Bajadas & Braided Alluvial Fans', iterations: 12, rainIntensity: 0.68, depositionRate: 0.78 })
        ]
    },
    {
        id: 'volcanic-caldera',
        name: 'Volcanic Caldera & Atoll Rim',
        category: 'Volcanic, Karst & Coastal',
        subtitle: 'Breached volcanic crater ring, canyon outlet, lush olivine ridges & coral shore',
        shorelineBevel: 22.0,
        baseElevation: 2.5,
        maxRelief: 230.0,
        climateRegime: 'temperate-oceanic',
        windAzimuthDeg: 20.0,
        windSpeed: 0.55,
        windShiftMode: 'variable',
        lithology: { rockHardness: 0.54, strataContrast: 0.58, strataFrequency: 9.5, dipDeg: 5.0, strikeDeg: 0.0, jointDensity: 0.55, carbonateSolubility: 0.16, ironMineral: 0.60 },
        texturing: CreateDefaultTexturingConfig('caldera-tropical', ['basalt-columns', 'alluvial-cobbles']),
        buildLayers: (CreateLayer, B) => [
            CreateLayer('multifractal', { name: 'Stratocone Rim Ring', amplitude: 175, scale: 2.35, octaves: 6, gain: 0.54, falloff: { mode: 'rim', distance: 270, edgeFloor: 0.05 } }),
            CreateLayer('spline', {
                name: 'Caldera Breach Gorge', splineMode: 'canyon', width: 92, amount: 68, bankSmooth: 0.42,
                falloff: { mode: 'none', distance: 100, edgeFloor: 1.0 },
                points: [[Math.round(B.x + B.width * 0.18), Math.round(B.z + B.depth * 0.72)], [Math.round(B.x + B.width * 0.46), Math.round(B.z + B.depth * 0.52)]]
            }),
            CreateLayer('erosion-hydraulic', { name: 'Radial Barranco Gullies', iterations: 16, rainIntensity: 0.86, erosionStrength: 0.78 })
        ]
    },
    {
        id: 'badlands-domes',
        name: 'Painted Badlands & Rill Hoodoos',
        category: 'Canyons & Sandstone',
        subtitle: 'Soft banded bentonite clay sculpted by dense rill networks, wind & salt haloclasty',
        shorelineBevel: 14.0,
        baseElevation: 3.5,
        maxRelief: 185.0,
        climateRegime: 'arid-desert',
        windAzimuthDeg: 62.0,
        windSpeed: 0.84,
        windShiftMode: 'variable',
        lithology: { rockHardness: 0.26, strataContrast: 0.94, strataFrequency: 14.0, dipDeg: 2.5, strikeDeg: 12.0, jointDensity: 0.70, carbonateSolubility: 0.46, ironMineral: 0.78 },
        texturing: CreateDefaultTexturingConfig('badlands-painted', ['sandstone-cuts', 'tafoni-pits', 'alluvial-cobbles']),
        buildLayers: (CreateLayer) => [
            CreateLayer('multifractal', { name: 'Bentonite Mudstone Domes', amplitude: 142, scale: 3.1, octaves: 6, gain: 0.58, warp: 0.28, falloff: { mode: 'soft', distance: 210, edgeFloor: 0.06 } }),
            CreateLayer('terrace', { name: 'Painted Clay Micro-Beds', bedCount: 16, strength: 0.72, dipDeg: 2.5, falloff: { mode: 'none', distance: 100, edgeFloor: 1.0 } }),
            CreateLayer('erosion-hydraulic', { name: 'Dense Badlands Rill Dissection', iterations: 18, rainIntensity: 0.72, erosionStrength: 1.08, sedimentCapacity: 0.92 }),
            CreateLayer('erosion-wind', { name: 'Hoodoo Basal Wind Undercut', iterations: 12, windSpeed: 0.84, canyonAbrasion: 1.05, sandSupply: 0.30 })
        ]
    },
    {
        id: 'karst-tower-highlands',
        name: 'Karst Limestone Towers & Dolines',
        category: 'Volcanic, Karst & Coastal',
        subtitle: 'Chemical carbonate dissolution towers, circular sinkholes, rillenkarren & terra rossa',
        shorelineBevel: 12.0,
        baseElevation: 4.0,
        maxRelief: 235.0,
        climateRegime: 'monsoon-tower',
        windAzimuthDeg: 25.0,
        windSpeed: 0.44,
        windShiftMode: 'variable',
        lithology: { rockHardness: 0.52, strataContrast: 0.74, strataFrequency: 9.0, dipDeg: 4.0, strikeDeg: 8.0, jointDensity: 0.82, carbonateSolubility: 1.15, ironMineral: 0.68 },
        texturing: CreateDefaultTexturingConfig('karst-limestone', ['karst-karren', 'tectonic-cracks', 'tafoni-pits']),
        buildLayers: (CreateLayer) => [
            CreateLayer('voronoi', { name: 'Fenglin Carbonate Tower Cones', variant: 3, amplitude: 178, scale: 3.4, sharpness: 0.86, falloff: { mode: 'soft', distance: 200, edgeFloor: 0.08 } }),
            CreateLayer('erosion-chemical', { name: 'Karst Sinkholes & Rillenkarren', iterations: 20, karstDissolution: 1.25, sinkholeFocus: 0.95, mineralStaining: 0.86, saltWeathering: 0.35 }),
            CreateLayer('erosion-hydraulic', { name: 'Subtropical Polje Drainage', iterations: 12, rainIntensity: 0.88, infiltration: 0.55 })
        ]
    },
    {
        id: 'coastal-massif',
        name: 'Fjord & Coastal Massif',
        category: 'Volcanic, Karst & Coastal',
        subtitle: 'Steep coastal peaks feeding river deltas into ocean fjords with sea cliffs',
        shorelineBevel: 6.0,
        baseElevation: 4.5,
        maxRelief: 245.0,
        climateRegime: 'temperate-oceanic',
        windAzimuthDeg: -40.0,
        windSpeed: 0.58,
        windShiftMode: 'variable',
        lithology: { rockHardness: 0.58, strataContrast: 0.68, strataFrequency: 8.5, dipDeg: 11.0, strikeDeg: -16.0, jointDensity: 0.60, carbonateSolubility: 0.24, ironMineral: 0.52 },
        texturing: CreateDefaultTexturingConfig('icelandic-basalt', ['tectonic-cracks', 'talus-clasts', 'alluvial-cobbles']),
        buildLayers: (CreateLayer) => [
            CreateLayer('ridged', { name: 'Coastal Fjord Headlands', amplitude: 192, scale: 2.3, sharpness: 0.76, azimuth: -28, falloff: { mode: 'soft', distance: 165, edgeFloor: 0.18 } }),
            CreateLayer('erosion-hydraulic', { name: 'Fjord River Deltas', iterations: 16, rainIntensity: 0.86, depositionRate: 0.74 }),
            CreateLayer('erosion-rockfall', { name: 'Sea-Cliff Scree Aprons', iterations: 10, rockfallIntensity: 0.72 })
        ]
    },
    {
        id: 'glacial-lake-watershed',
        name: 'Glacial Tarn & River Watershed',
        category: 'Alpine & Glacial',
        subtitle: 'High cirque snowfield feeding an alpine tarn & clear non-flooding river cascade',
        shorelineBevel: 20.0,
        baseElevation: 4.0,
        maxRelief: 255.0,
        climateRegime: 'alpine-continental',
        windAzimuthDeg: 22.0,
        windSpeed: 0.52,
        windShiftMode: 'variable',
        lithology: { rockHardness: 0.64, strataContrast: 0.66, strataFrequency: 8.5, dipDeg: 12.0, strikeDeg: 14.0, jointDensity: 0.58, carbonateSolubility: 0.20, ironMineral: 0.42 },
        texturing: (() => { const T = CreateDefaultTexturingConfig('alpine-granite', ['tectonic-cracks', 'talus-clasts', 'alluvial-cobbles']); T.snowLineBoost = 0.30; return T; })(),
        buildLayers: (CreateLayer, B) => [
            CreateLayer('multifractal', { name: 'Glacial Cirque Amphitheatre', amplitude: 195, scale: 2.0, octaves: 6, gain: 0.54, falloff: { mode: 'continental', distance: 310, edgeFloor: 0.04 } }),
            CreateLayer('spline', {
                name: 'Alpine Tarn & Outlet River', splineMode: 'river', width: 125, amount: 52, bankSmooth: 0.62, meander: 0.26,
                falloff: { mode: 'none', distance: 100, edgeFloor: 1.0 },
                points: [[Math.round(B.x + B.width * 0.28), Math.round(B.z + B.depth * 0.30)], [Math.round(B.x + B.width * 0.52), Math.round(B.z + B.depth * 0.52)], [Math.round(B.x + B.width * 0.82), Math.round(B.z + B.depth * 0.70)]]
            }),
            CreateLayer('erosion-seasonal', { name: 'Cirque Snowmelt & Watershed', iterations: 16, rainIntensity: 0.78, snowfallRate: 0.80, headwaterFlow: 0.72, frostIntensity: 0.76, rockfallIntensity: 0.66 })
        ]
    }
];

export function ApplyBiomePresetToRegion(Region, PresetId, CreateTerrainLayerFn)
{
    const Preset = TERRAIN_BIOME_PRESETS.find(P => P.id === PresetId);
    if (!Region || !Preset) return false;

    Region.presetId = Preset.id;
    Region.shorelineBevel = Preset.shorelineBevel;
    Region.baseElevation = Preset.baseElevation;
    Region.maxRelief = Preset.maxRelief;
    Region.lithology = { ...Preset.lithology };
    Region.weatherSpec = {
        climateRegime: Preset.climateRegime,
        windAzimuthDeg: Preset.windAzimuthDeg,
        windSpeed: Preset.windSpeed,
        windShiftMode: Preset.windShiftMode,
        rainMultiplier: 1.0,
        tempOffsetC: 0.0,
        stepsPerYear: 48,
        seed: Region.seed || 4029
    };
    Region.texturing = JSON.parse(JSON.stringify(Preset.texturing));
    Region.stack = Preset.buildLayers(CreateTerrainLayerFn, Region.bounds);
    Region.liveSimState = null;
    Region.dirty = true;
    Region.meshDirty = true;
    return true;
}
