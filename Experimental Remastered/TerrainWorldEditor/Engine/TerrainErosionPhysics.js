/*====================================================================================================================================
                                                     TERRAINEROSIONPHYSICS.JS
====================================================================================================================================*/
// 🧩 Physically based multi-process geomorphological erosion, weathering, seasonal climate, and shared weather-group solver

const Clamp = (V, Lo, Hi) => (V < Lo ? Lo : V > Hi ? Hi : V);
const Mix = (A, B, T) => A + (B - A) * T;
const Smoothstep = (E0, E1, X) =>
{
    const Span = Math.max(1e-6, E1 - E0);
    const T = Clamp((X - E0) / Span, 0.0, 1.0);
    return T * T * (3.0 - 2.0 * T);
};

//------------------------------------------------------------------------------------------------------------------------
//                                        DETERMINISTIC SPATIAL HASH & CELLULAR FIELDS
//------------------------------------------------------------------------------------------------------------------------

function Hash2(Ix, Iz, Seed = 4029)
{
    let H = Math.imul(Ix | 0, 374761393) ^ Math.imul(Iz | 0, 668265263) ^ Math.imul(Seed | 0, 1442695041);
    H = Math.imul(H ^ (H >>> 13), 1274126177);
    return ((H ^ (H >>> 16)) >>> 0) / 4294967295.0;
}

function ValueNoise2D(X, Z, Seed = 4029)
{
    const X0 = Math.floor(X), Z0 = Math.floor(Z);
    const Fx = X - X0, Fz = Z - Z0;
    const Ux = Fx * Fx * (3.0 - 2.0 * Fx);
    const Uz = Fz * Fz * (3.0 - 2.0 * Fz);
    const A = Hash2(X0, Z0, Seed);
    const B = Hash2(X0 + 1, Z0, Seed);
    const C = Hash2(X0, Z0 + 1, Seed);
    const D = Hash2(X0 + 1, Z0 + 1, Seed);
    return Mix(Mix(A, B, Ux), Mix(C, D, Ux), Uz);
}

function Fbm2(X, Z, Octaves = 3, Seed = 4029)
{
    let Sum = 0.0, Amp = 0.5, Freq = 1.0, Norm = 0.0;
    for (let I = 0; I < Octaves; ++I)
    {
        Sum += Amp * ValueNoise2D(X * Freq, Z * Freq, Seed + I * 137);
        Norm += Amp;
        Amp *= 0.5;
        Freq *= 2.03;
    }
    return Sum / Math.max(1e-6, Norm);
}

// 📝 Voronoi fracture & alveolar tafoni field: returns { d1, edge, cellHash } for joint networks & honeycomb cavities.
export function VoronoiJoint2D(X, Z, Jitter = 0.82, Seed = 4029)
{
    const Cx = Math.floor(X), Cz = Math.floor(Z);
    const Fx = X - Cx, Fz = Z - Cz;
    let D1 = 8.0, D2 = 8.0, CellId = 0.5;
    for (let Dz = -1; Dz <= 1; ++Dz)
    {
        for (let Dx = -1; Dx <= 1; ++Dx)
        {
            const Nx = Cx + Dx, Nz = Cz + Dz;
            const Rx = (Hash2(Nx, Nz, Seed) - 0.5) * Jitter + 0.5;
            const Rz = (Hash2(Nx, Nz, Seed + 71) - 0.5) * Jitter + 0.5;
            const Dist = Math.hypot(Dx + Rx - Fx, Dz + Rz - Fz);
            if (Dist < D1)
            {
                D2 = D1;
                D1 = Dist;
                CellId = Hash2(Nx, Nz, Seed + 193);
            }
            else if (Dist < D2)
            {
                D2 = Dist;
            }
        }
    }
    return { d1: D1, edge: Clamp(D2 - D1, 0.0, 1.0), cellHash: CellId };
}

//------------------------------------------------------------------------------------------------------------------------
//                                  CLIMATE REGIMES, WIND SHIFT MODES & WEATHER GROUPS
//------------------------------------------------------------------------------------------------------------------------

export const CLIMATE_REGIMES = [
    {
        id: 'alpine-continental',
        label: 'Alpine Continental (Snow + Spring Melt + Storms)',
        meanTempSeaC: 9.5,
        seasonalAmpC: 14.0,
        diurnalAmpC: 10.5,
        lapseRateCPerKm: 6.5,
        annualRainRate: 0.72,
        snowPropensity: 0.88,
        evaporationRate: 0.34,
        infiltrationRate: 0.28,
        windFactor: 0.55
    },
    {
        id: 'temperate-oceanic',
        label: 'Temperate Oceanic / Fjord (Wet Year-Round)',
        meanTempSeaC: 11.5,
        seasonalAmpC: 6.5,
        diurnalAmpC: 6.0,
        lapseRateCPerKm: 6.0,
        annualRainRate: 0.88,
        snowPropensity: 0.32,
        evaporationRate: 0.24,
        infiltrationRate: 0.32,
        windFactor: 0.62
    },
    {
        id: 'arid-desert',
        label: 'Hot Arid Desert & Canyon (Insolation + Aeolian + Flash Flood)',
        meanTempSeaC: 26.0,
        seasonalAmpC: 11.0,
        diurnalAmpC: 21.0,
        lapseRateCPerKm: 7.2,
        annualRainRate: 0.18,
        snowPropensity: 0.02,
        evaporationRate: 0.86,
        infiltrationRate: 0.46,
        windFactor: 0.92
    },
    {
        id: 'subarctic-glacial',
        label: 'Subarctic Glacial Highlands (Ice Cap + Freeze-Thaw + Outwash)',
        meanTempSeaC: 3.2,
        seasonalAmpC: 11.5,
        diurnalAmpC: 7.5,
        lapseRateCPerKm: 6.8,
        annualRainRate: 0.68,
        snowPropensity: 0.96,
        evaporationRate: 0.18,
        infiltrationRate: 0.22,
        windFactor: 0.70
    },
    {
        id: 'mediterranean-karst',
        label: 'Mediterranean / Karst (Winter Rain + Dry Summer + Dissolution)',
        meanTempSeaC: 17.0,
        seasonalAmpC: 9.0,
        diurnalAmpC: 12.5,
        lapseRateCPerKm: 6.2,
        annualRainRate: 0.58,
        snowPropensity: 0.14,
        evaporationRate: 0.56,
        infiltrationRate: 0.42,
        windFactor: 0.50
    },
    {
        id: 'monsoon-tower',
        label: 'Tropical Monsoon & Tower Karst (Intense Rain + Chemical)',
        meanTempSeaC: 24.5,
        seasonalAmpC: 5.0,
        diurnalAmpC: 9.0,
        lapseRateCPerKm: 5.8,
        annualRainRate: 0.96,
        snowPropensity: 0.0,
        evaporationRate: 0.44,
        infiltrationRate: 0.36,
        windFactor: 0.46
    }
];

export const WIND_SHIFT_MODES = [
    ['Fixed Prevailing Wind', 'fixed'],
    ['Variable Wind Rose (Prevailing + Sector Shifts)', 'variable'],
    ['Frontal Weather Shifts (±65° Veer/Back)', 'sectors'],
    ['Full Star-Dune Wind Rose (Multi-Directional)', 'rotate']
];

export const WEATHER_GROUP_OPTIONS = [
    ['Solo (Independent 1-by-1 Weather Clock)', 'solo'],
    ['Weather Group A (Shared Climate & Cycle)', 'group-a'],
    ['Weather Group B (Shared Arid / Trade Wind)', 'group-b'],
    ['Weather Group C (Shared Subarctic Front)', 'group-c'],
    ['World Sync (All Linked Terrains Together)', 'world-sync']
];

export const SEASON_NAMES = ['Winter', 'Spring', 'Summer', 'Autumn'];

export function GetClimateRegime(RegimeId)
{
    return CLIMATE_REGIMES.find(R => R.id === RegimeId) || CLIMATE_REGIMES[0];
}

// 📝 Quota-balanced continuous synoptic wind bearing schedule (no robotic sine-wiper, no instant teleports).
export function EvaluateWindRegimeAzimuthDeg(BaseAzimuthDeg, ShiftMode, StepCount, Seed = 4029)
{
    const Base = Number(BaseAzimuthDeg) || 35.0;
    if (!ShiftMode || ShiftMode === 'fixed') return Base;

    const SpellLen = 14.0;
    const Slot = Math.floor(StepCount / SpellLen);
    const Frac = Smoothstep(0.0, 0.38, (StepCount % SpellLen) / SpellLen);

    const PickOffset = S =>
    {
        const H = Hash2(S * 17 + 3, Seed, Seed + 91);
        if (ShiftMode === 'sectors')
        {
            const Sectors = [-60, -30, 0, 0, 30, 60];
            return Sectors[Math.floor(H * Sectors.length) % Sectors.length];
        }
        if (ShiftMode === 'rotate')
        {
            const Star = [-180, -135, -90, -45, 0, 45, 90, 135];
            return Star[(S * 3 + Math.floor(H * 3)) % Star.length];
        }
        // 'variable': prevailing-weighted rose
        const Weighted = [0, 0, 0, -35, 35, -70, 70, 145];
        return Weighted[Math.floor(H * Weighted.length) % Weighted.length];
    };

    const OffPrev = PickOffset(Math.max(0, Slot - 1));
    const OffCurr = PickOffset(Slot);
    let Delta = OffCurr - OffPrev;
    while (Delta > 180) Delta -= 360;
    while (Delta < -180) Delta += 360;
    return Base + OffPrev + Delta * Frac;
}

// 📝 Evaluates instantaneous meteorological forcing at simulation step `StepIndex` for a given climate configuration.
export function EvaluateSeasonalWeatherForcing(WeatherSpec = {}, StepIndex = 0)
{
    const Regime = GetClimateRegime(WeatherSpec.climateRegime || 'alpine-continental');
    const StepsPerYear = Math.max(16, Number(WeatherSpec.stepsPerYear) || 48);
    const YearPhase = ((StepIndex % StepsPerYear) + StepsPerYear) % StepsPerYear / StepsPerYear; // 0=Winter, 0.25=Spring, 0.5=Summer, 0.75=Autumn
    const SeasonIdx = Math.min(3, Math.floor(YearPhase * 4.0));
    const SeasonName = SEASON_NAMES[SeasonIdx];

    // Cosine seasonal temperature wave: minimum at Winter (0.0), peak at Summer (0.5)
    const ThermalWave = -Math.cos(YearPhase * Math.PI * 2.0);
    const SeaLevelTempC = (WeatherSpec.tempOffsetC ?? 0.0) + Regime.meanTempSeaC + Regime.seasonalAmpC * ThermalWave;

    // Storm pulse modulation (synoptic weather blocks)
    const StormHash = ValueNoise2D(StepIndex * 0.22, (WeatherSpec.seed || 4029) * 0.01, WeatherSpec.seed || 4029);
    const StormPulse = 0.55 + 0.95 * Smoothstep(0.32, 0.88, StormHash);

    const RainScale = (WeatherSpec.rainMultiplier ?? 1.0) * Regime.annualRainRate * StormPulse;
    const ColdFraction = Smoothstep(4.0, -5.5, SeaLevelTempC - 6.0);
    const SpringMeltPulse = Math.exp(-Math.pow((YearPhase - 0.30) / 0.11, 2.0));

    const WindAzimuthDeg = EvaluateWindRegimeAzimuthDeg(
        WeatherSpec.windAzimuthDeg ?? 38.0,
        WeatherSpec.windShiftMode || 'variable',
        StepIndex,
        WeatherSpec.seed || 4029
    );
    const WindSpeed = Clamp((WeatherSpec.windSpeed ?? 0.58) * (0.75 + 0.45 * Regime.windFactor) * (0.82 + 0.36 * StormHash), 0.0, 1.5);

    return {
        stepIndex: StepIndex,
        yearNumber: Math.floor(StepIndex / StepsPerYear) + 1,
        yearPhase: YearPhase,
        seasonIndex: SeasonIdx,
        seasonName: SeasonName,
        seaLevelTempC: SeaLevelTempC,
        diurnalAmpC: Regime.diurnalAmpC * (0.78 + 0.35 * Math.max(0, ThermalWave)),
        lapseRateCPerKm: Regime.lapseRateCPerKm,
        rainRate: RainScale * (1.0 - 0.55 * ColdFraction * Regime.snowPropensity),
        snowRate: RainScale * ColdFraction * Regime.snowPropensity,
        snowMeltPulse: SpringMeltPulse + 0.35 * Math.max(0.0, ThermalWave),
        evaporationRate: Regime.evaporationRate * (0.72 + 0.55 * Math.max(0.0, ThermalWave)),
        infiltrationRate: Regime.infiltrationRate,
        windAzimuthDeg: WindAzimuthDeg,
        windSpeed: WindSpeed
    };
}

//------------------------------------------------------------------------------------------------------------------------
//                                  3D STRATIGRAPHIC COLUMN & LITHOLOGY EVALUATOR
//------------------------------------------------------------------------------------------------------------------------

export function DefaultLithologySpec()
{
    return {
        rockHardness: 0.56,
        strataContrast: 0.72,
        strataFrequency: 9.0,
        dipDeg: 6.0,
        strikeDeg: 18.0,
        jointDensity: 0.58,
        carbonateSolubility: 0.38,
        ironMineral: 0.48
    };
}

export function EvaluateRockLithology3D(Wx, Wy, Wz, Lith = {}, MaxRelief = 240.0, Seed = 4029)
{
    const BaseHard = Clamp(Number(Lith.rockHardness ?? 0.56), 0.08, 0.96);
    const Contrast = Clamp(Number(Lith.strataContrast ?? 0.72), 0.0, 1.0);
    const Freq = Math.max(1.5, Number(Lith.strataFrequency ?? 9.0));
    const DipRad = ((Number(Lith.dipDeg) || 6.0) * Math.PI) / 180.0;
    const StrikeRad = ((Number(Lith.strikeDeg) || 18.0) * Math.PI) / 180.0;

    const DipDirX = -Math.sin(StrikeRad), DipDirZ = Math.cos(StrikeRad);
    const Warp = (Fbm2(Wx * 0.0022, Wz * 0.0022, 2, Seed + 31) - 0.5) * 18.0;
    const StratCoord = Wy + (Wx * DipDirX + Wz * DipDirZ) * Math.tan(DipRad) + Warp;

    const Phase = (StratCoord / Math.max(50.0, MaxRelief)) * Freq;
    const BedIndex = Math.floor(Phase);
    const BedFrac = Phase - BedIndex;
    const BedHash = Hash2(BedIndex, Seed & 255, Seed + 409);

    // Alternating resistant caprock & recessive shale/siltstone/soluble limestone beds
    const CapWave = 0.5 + 0.5 * Math.cos(Phase * Math.PI * 2.0 + BedHash * 2.2);
    const SharpBed = Smoothstep(0.22, 0.78, CapWave);
    const StrataBand = Clamp(Mix(0.5, SharpBed, Contrast), 0.0, 1.0);

    // Conjugate tectonic fracture & joint network
    const JDenVal = Clamp(Number(Lith.jointDensity ?? 0.58), 0.05, 1.0);
    const JScale = Mix(0.012, 0.045, JDenVal);
    const Vor = VoronoiJoint2D(Wx * JScale, Wz * JScale, 0.84, Seed + 701);
    const JointCrack = 1.0 - Smoothstep(0.0, 0.16, Vor.edge); // 1 along polygonal fracture seams

    const Hardness = Clamp(
        Mix(BaseHard * 0.45, Math.min(0.98, BaseHard * 1.38), StrataBand) * (1.0 - 0.42 * JointCrack * JDenVal),
        0.05,
        0.98
    );

    const Solubility = Clamp(Number(Lith.carbonateSolubility ?? 0.38) * (0.45 + 0.85 * (1.0 - StrataBand) + 0.35 * JointCrack), 0.02, 1.4);
    const IronSource = Clamp(Number(Lith.ironMineral ?? 0.48) * (0.35 + 0.65 * BedHash), 0.0, 1.0);

    return {
        hardness: Hardness,
        strataBand: StrataBand,
        bedFrac: BedFrac,
        jointCrack: JointCrack,
        cellHash: Vor.cellHash,
        solubility: Solubility,
        ironSource: IronSource
    };
}

// 📝 Precomputes static 2D Voronoi joint, alveolar pit, doline & bedding-warp fields once per grid so 16-step solvers run ~10x faster!
function EnsureStaticGeologyCache(State, Context, PitScaleOpt = null)
{
    const { nx: Nx, nz: Nz, stepX: StepX, stepZ: StepZ, bounds: B, sdf2D: Sdf2D, lithology: Lith = {} } = Context;
    const Count = Nx * Nz;
    const AvgStep = 0.5 * (StepX + StepZ);
    const JDen = Clamp(Number(Lith.jointDensity ?? 0.58), 0.05, 1.0);
    const DipDeg = Number(Lith.dipDeg ?? 6.0) || 6.0;
    const StrikeDeg = Number(Lith.strikeDeg ?? 18.0) || 18.0;
    const BaseSeed = (State._baseSeed ?? (Context.seed | 0)) || 4029;
    State._baseSeed = BaseSeed;

    const PitScale = PitScaleOpt !== null ? PitScaleOpt : (State._geoCache?.pitScale ?? 0.70);
    const CacheKey = `${Nx}x${Nz}:${B.x.toFixed(0)}:${B.z.toFixed(0)}:${B.width.toFixed(0)}:${JDen.toFixed(2)}:${DipDeg.toFixed(1)}:${StrikeDeg.toFixed(1)}:${PitScale.toFixed(2)}`;
    if (State._geoCache && State._geoCache.key === CacheKey) return State._geoCache;

    const DipRad = (DipDeg * Math.PI) / 180.0;
    const StrikeRad = (StrikeDeg * Math.PI) / 180.0;
    const DipDirX = -Math.sin(StrikeRad), DipDirZ = Math.cos(StrikeRad);
    const TanDip = Math.tan(DipRad);
    const JScale = Mix(0.012, 0.045, JDen);
    const PitFreq = (0.042 / Math.max(0.35, PitScale));

    const DipOffset = new Float32Array(Count);
    const JointCrack = new Float32Array(Count);
    const PitSeam = new Float32Array(Count);
    const PitBowl = new Float32Array(Count);
    const DolineMask = new Float32Array(Count);
    const WindNoise = new Float32Array(Count);

    for (let Z = 0; Z < Nz; ++Z)
    {
        const Wz = B.z + Z * StepZ;
        const Row = Z * Nx;
        for (let X = 0; X < Nx; ++X)
        {
            const I = Row + X;
            if (Sdf2D[I] > AvgStep * 1.2) continue;
            const Wx = B.x + X * StepX;

            const Warp = (Fbm2(Wx * 0.0022, Wz * 0.0022, 2, BaseSeed + 31) - 0.5) * 18.0;
            DipOffset[I] = (Wx * DipDirX + Wz * DipDirZ) * TanDip + Warp;

            const Vor = VoronoiJoint2D(Wx * JScale, Wz * JScale, 0.84, BaseSeed + 701);
            JointCrack[I] = 1.0 - Smoothstep(0.0, 0.16, Vor.edge);

            const VorMacro = VoronoiJoint2D(Wx * PitFreq, Wz * PitFreq, 0.86, BaseSeed + 911);
            const VorMicro = VoronoiJoint2D(Wx * PitFreq * 2.35 + 7.1, Wz * PitFreq * 2.35 - 4.3, 0.88, BaseSeed + 1453);
            PitSeam[I] = Math.pow(1.0 - Smoothstep(0.0, 0.24, VorMacro.edge), 1.35);
            PitBowl[I] = Math.max(0.0, 1.0 - VorMicro.d1 * 1.75) * (VorMicro.cellHash > 0.36 ? 1.0 : 0.22);

            const DolineCell = VoronoiJoint2D(Wx * 0.0085, Wz * 0.0085, 0.78, BaseSeed + 2203);
            DolineMask[I] = (DolineCell.cellHash > 0.62 ? 1.0 : 0.0) * Math.pow(Clamp(1.0 - DolineCell.d1 * 2.1, 0.0, 1.0), 1.6);

            WindNoise[I] = Fbm2(Wx * 0.009, Wz * 0.009, 2, BaseSeed + 55);
        }
    }

    State._geoCache = { key: CacheKey, pitScale: PitScale, dipOffset: DipOffset, jointCrack: JointCrack, pitSeam: PitSeam, pitBowl: PitBowl, dolineMask: DolineMask, windNoise: WindNoise, seed: BaseSeed };
    return State._geoCache;
}

const _RockScratch = { hardness: 0.56, strataBand: 0.5, jointCrack: 0.0, solubility: 0.38, ironSource: 0.48 };
function SampleCachedLithology(Geo, CellIdx, Wy, Lith = {}, MaxRelief = 240.0)
{
    const BaseHard = Clamp(Number(Lith.rockHardness ?? 0.56), 0.08, 0.96);
    const Contrast = Clamp(Number(Lith.strataContrast ?? 0.72), 0.0, 1.0);
    const Freq = Math.max(1.5, Number(Lith.strataFrequency ?? 9.0));
    const JDen = Clamp(Number(Lith.jointDensity ?? 0.58), 0.05, 1.0);

    const StratCoord = Wy + Geo.dipOffset[CellIdx];
    const Phase = (StratCoord / Math.max(50.0, MaxRelief)) * Freq;
    const BedIndex = Math.floor(Phase);
    const BedHash = Hash2(BedIndex, Geo.seed & 255, Geo.seed + 409);

    const CapWave = 0.5 + 0.5 * Math.cos(Phase * Math.PI * 2.0 + BedHash * 2.2);
    const StrataBand = Clamp(Mix(0.5, Smoothstep(0.22, 0.78, CapWave), Contrast), 0.0, 1.0);
    const JCrack = Geo.jointCrack[CellIdx];

    _RockScratch.strataBand = StrataBand;
    _RockScratch.jointCrack = JCrack;
    _RockScratch.hardness = Clamp(
        Mix(BaseHard * 0.45, Math.min(0.98, BaseHard * 1.38), StrataBand) * (1.0 - 0.42 * JCrack * JDen),
        0.05,
        0.98
    );
    _RockScratch.solubility = Clamp(Number(Lith.carbonateSolubility ?? 0.38) * (0.45 + 0.85 * (1.0 - StrataBand) + 0.35 * JCrack), 0.02, 1.4);
    _RockScratch.ironSource = Clamp(Number(Lith.ironMineral ?? 0.48) * (0.35 + 0.65 * BedHash), 0.0, 1.0);
    return _RockScratch;
}

//------------------------------------------------------------------------------------------------------------------------
//                                      EROSION STATE ALLOCATION & RESET
//------------------------------------------------------------------------------------------------------------------------

export function CreateErosionFieldState(Nx, Nz, BaseHeights, SlabBottom)
{
    const Count = Nx * Nz;
    const Bedrock = new Float32Array(BaseHeights);
    return {
        nx: Nx,
        nz: Nz,
        bedrock: Bedrock,
        alluvium: new Float32Array(Count),     // [m] - Fluvial silt/gravel deposit thickness
        talus: new Float32Array(Count),        // [m] - Angular cliff-calved rockfall scree thickness
        aeolianSand: new Float32Array(Count),  // [m] - Wind-blown mobile dune & ripple sand thickness
        snowIce: new Float32Array(Count),      // [m] - Seasonal snowpack & glacial firn depth
        waterDepth: new Float32Array(Count),   // [m] - Mass-balanced open channel / lake water depth
        fluxL: new Float32Array(Count),        // [m^3/s] - Shallow-water virtual pipe outflow West
        fluxR: new Float32Array(Count),        // [m^3/s] - Shallow-water virtual pipe outflow East
        fluxD: new Float32Array(Count),        // [m^3/s] - Shallow-water virtual pipe outflow North
        fluxU: new Float32Array(Count),        // [m^3/s] - Shallow-water virtual pipe outflow South
        sedimentSusp: new Float32Array(Count), // [m] - Suspended sediment column in water
        flowAccum: new Float32Array(Count),    // [0-1] - Cumulative hydrological stream thread intensity
        velocityMag: new Float32Array(Count),  // [m/s] - Hydraulic / Venturi flow speed
        wear: new Float32Array(Count),         // [m] - Cumulative bedrock erosion / detachment depth
        deposit: new Float32Array(Count),      // [m] - Cumulative sediment + talus deposition
        pitting: new Float32Array(Count),      // [0-1] - Frost-crack & thermal insolation tafoni pit density
        chemical: new Float32Array(Count),     // [0-1] - Karst dissolution + Fe/Mn geochemical staining
        wetness: new Float32Array(Count),      // [0-1] - Soil/rock capillary moisture (non-flooding!)
        frostDamage: new Float32Array(Count),  // [0-1] - Accumulated cryogenic/thermal micro-fracture damage
        slabBottom: SlabBottom,
        totalSteps: 0,
        lastWeather: null
    };
}

export function SyncSolidHeightsFromErosion(State, OutHeights)
{
    const N = OutHeights.length;
    const Bed = State.bedrock;
    const Alluv = State.alluvium;
    const Tal = State.talus;
    const Sand = State.aeolianSand;
    const Floor = State.slabBottom;
    for (let I = 0; I < N; ++I)
    {
        const H = Bed[I] + Alluv[I] + Tal[I] + Sand[I];
        OutHeights[I] = H > Floor ? H : Floor;
    }
}

//------------------------------------------------------------------------------------------------------------------------
//                          1. SHALLOW-WATER FLUVIAL HYDRAULICS & NON-FLOODING DRAINAGE SOLVER
//------------------------------------------------------------------------------------------------------------------------

export function StepHydraulicErosion(State, Context, Params = {})
{
    const { nx: Nx, nz: Nz, stepX: StepX, stepZ: StepZ, bounds: B, sdf2D: Sdf2D, seaLevel: SeaLevel, maskWeights: MaskW, lithology: Lith, maxRelief: MaxRelief, seed: Seed } = Context;
    const Count = Nx * Nz;
    const CellArea = StepX * StepZ;
    const AvgStep = 0.5 * (StepX + StepZ);
    const Dt = 0.42;
    const Gravity = 9.81;

    const RainRate = Clamp((Params.rainIntensity ?? 0.68) * (Context.weather?.rainRate ?? 0.72), 0.0, 2.0);
    const ErosionStr = Clamp(Params.erosionStrength ?? 0.72, 0.02, 2.0);
    const SedCap = Clamp(Params.sedimentCapacity ?? 0.78, 0.05, 2.2);
    const DepRate = Clamp(Params.depositionRate ?? 0.58, 0.05, 1.5);
    const EvapRate = Clamp((Params.evaporation ?? 0.36) * (Context.weather?.evaporationRate ?? 0.36), 0.04, 1.2);
    const InfilRate = Clamp((Params.infiltration ?? 0.34) * (Context.weather?.infiltrationRate ?? 0.32), 0.04, 1.0);
    const ChannelSpring = Clamp(Params.headwaterFlow ?? 0.25, 0.0, 1.5);

    const Bed = State.bedrock, Alluv = State.alluvium, Tal = State.talus, Sand = State.aeolianSand;
    const Water = State.waterDepth, Susp = State.sedimentSusp;
    const FL = State.fluxL, FR = State.fluxR, FD = State.fluxD, FU = State.fluxU;
    const FlowAcc = State.flowAccum, VelMag = State.velocityMag, Wear = State.wear, Dep = State.deposit, Wet = State.wetness;

    const Surf = new Float32Array(Count);
    for (let I = 0; I < Count; ++I)
    {
        Surf[I] = Bed[I] + Alluv[I] + Tal[I] + Sand[I];
    }

    // ① Precipitation + Snowmelt input on land cells, STRICT open-ocean sink outside 2D coastline mask!
    const MeltPulse = Context.weather?.snowMeltPulse ?? 0.25;
    for (let Z = 0; Z < Nz; ++Z)
    {
        const Row = Z * Nx;
        const IsEdge = Z === 0 || Z === Nz - 1;
        for (let X = 0; X < Nx; ++X)
        {
            const I = Row + X;
            const D2 = Sdf2D[I];
            // Open boundary: ocean & outside mask drain freely to sea level — NEVER floods!
            if (IsEdge || X === 0 || X === Nx - 1 || D2 >= -AvgStep * 0.35 || Surf[I] <= SeaLevel + 0.12)
            {
                Water[I] = 0.0;
                Susp[I] *= 0.25;
                FL[I] = FR[I] = FD[I] = FU[I] = 0.0;
                if (Surf[I] <= SeaLevel + 1.8 && D2 <= AvgStep) Wet[I] = Math.max(Wet[I], 0.78);
                continue;
            }

            const Mw = MaskW ? MaskW[I] : 1.0;
            if (Mw <= 1e-3) continue;

            // Orographic enhancement: higher peaks intercept slightly more rain
            const RelElev = Clamp((Surf[I] - SeaLevel) / Math.max(60.0, MaxRelief), 0.0, 1.2);
            let AddedWater = RainRate * (0.014 + 0.012 * RelElev) * Dt * Mw;

            // Coupled snowmelt contribution where snowpack exists
            if (State.snowIce[I] > 0.005 && MeltPulse > 0.05)
            {
                const Melted = Math.min(State.snowIce[I], State.snowIce[I] * 0.08 * MeltPulse * Dt);
                State.snowIce[I] -= Melted;
                AddedWater += Melted * 0.42;
            }

            // Headwater spring recharge in high concave valleys
            if (ChannelSpring > 0.02 && RelElev > 0.32 && FlowAcc[I] > 0.22)
            {
                AddedWater += ChannelSpring * 0.012 * FlowAcc[I] * Dt * Mw;
            }

            Water[I] += AddedWater;
            Wet[I] = Clamp(Wet[I] * 0.94 + Math.min(0.45, AddedWater * 14.0), 0.0, 1.0);
        }
    }

    // ② Hydrostatic Virtual-Pipe Outflow Acceleration (Mei et al. shallow-water momentum)
    const PipeScale = (Dt * Gravity * AvgStep) / Math.max(1.0, AvgStep);
    const Damping = 0.88;
    for (let Z = 1; Z < Nz - 1; ++Z)
    {
        const Row = Z * Nx;
        for (let X = 1; X < Nx - 1; ++X)
        {
            const I = Row + X;
            const WHere = Water[I];
            if (WHere <= 1e-4)
            {
                FL[I] = FR[I] = FD[I] = FU[I] = 0.0;
                continue;
            }

            const EtaHere = Surf[I] + WHere;
            const EtaL = Sdf2D[I - 1] >= 0 ? SeaLevel : (Surf[I - 1] + Water[I - 1]);
            const EtaR = Sdf2D[I + 1] >= 0 ? SeaLevel : (Surf[I + 1] + Water[I + 1]);
            const EtaD = Sdf2D[I - Nx] >= 0 ? SeaLevel : (Surf[I - Nx] + Water[I - Nx]);
            const EtaU = Sdf2D[I + Nx] >= 0 ? SeaLevel : (Surf[I + Nx] + Water[I + Nx]);

            let NL = Math.max(0.0, FL[I] * Damping + PipeScale * (EtaHere - EtaL));
            let NR = Math.max(0.0, FR[I] * Damping + PipeScale * (EtaHere - EtaR));
            let ND = Math.max(0.0, FD[I] * Damping + PipeScale * (EtaHere - EtaD));
            let NU = Math.max(0.0, FU[I] * Damping + PipeScale * (EtaHere - EtaU));

            const SumOut = NL + NR + ND + NU;
            if (SumOut > 1e-6)
            {
                const MaxOut = (WHere * CellArea) / Dt;
                const K = Math.min(1.0, MaxOut / (SumOut * 1.001));
                NL *= K; NR *= K; ND *= K; NU *= K;
            }
            FL[I] = NL; FR[I] = NR; FD[I] = ND; FU[I] = NU;
        }
    }

    // ③ Continuity Water Update, Shields Bed Shear Incision, Exner Sediment Advection & Infiltration
    const Geo = EnsureStaticGeologyCache(State, Context);
    const NextSusp = new Float32Array(Count);
    for (let Z = 1; Z < Nz - 1; ++Z)
    {
        const Wz = B.z + Z * StepZ;
        const Row = Z * Nx;
        for (let X = 1; X < Nx - 1; ++X)
        {
            const I = Row + X;
            if (Sdf2D[I] >= -AvgStep * 0.35 || Surf[I] <= SeaLevel + 0.10)
            {
                Water[I] = 0.0;
                continue;
            }

            const Inflow = FR[I - 1] + FL[I + 1] + FU[I - Nx] + FD[I + Nx];
            const Outflow = FL[I] + FR[I] + FD[I] + FU[I];
            const NetVol = Dt * (Inflow - Outflow);
            const WPrev = Water[I];
            let WNew = Math.max(0.0, WPrev + NetVol / CellArea);

            // Depth-averaged discharge & Froude-bounded velocity
            const Qx = 0.5 * (FR[I - 1] - FL[I] + FR[I] - FL[I + 1]) / StepZ;
            const Qz = 0.5 * (FU[I - Nx] - FD[I] + FU[I] - FD[I + Nx]) / StepX;
            const Discharge = Math.hypot(Qx, Qz); // specific discharge q [m^2/s]
            const AvgDepth = Math.max(0.035, 0.5 * (WPrev + WNew));
            const MaxFroudeVel = 1.6 + 3.13 * Math.sqrt(AvgDepth);
            const Speed = Math.min(MaxFroudeVel, Discharge / AvgDepth);
            VelMag[I] = Speed;

            // Update exponential stream-thread accumulation map (Gaea Flow map!)
            const InstantFlow = Clamp( Math.sqrt(Discharge) * 1.45, 0.0, 1.0 );
            FlowAcc[I] = Clamp(Math.max(FlowAcc[I] * 0.965, InstantFlow), 0.0, 1.0);

            // Local surface gradient
            const DzDx = (Surf[I + 1] - Surf[I - 1]) / (2.0 * StepX);
            const DzDz = (Surf[I + Nx] - Surf[I - Nx]) / (2.0 * StepZ);
            const Slope = Math.hypot(DzDx, DzDz);
            const SinSlope = Math.max(0.035, Slope / Math.sqrt(1.0 + Slope * Slope));

            // Semi-Lagrangian upstream suspended-sediment lookup
            let UpS = Susp[I];
            if (Speed > 0.04)
            {
                const Vx = (Qx / Math.max(1e-4, Discharge)) * Speed;
                const Vz = (Qz / Math.max(1e-4, Discharge)) * Speed;
                const Sx = Clamp(X - (Vx * Dt) / StepX, 1.0, Nx - 2.001);
                const Sz = Clamp(Z - (Vz * Dt) / StepZ, 1.0, Nz - 2.001);
                const X0 = Sx | 0, Z0 = Sz | 0;
                const Fx = Sx - X0, Fz = Sz - Z0;
                const I00 = Z0 * Nx + X0;
                UpS = Mix(
                    Mix(Susp[I00], Susp[I00 + 1], Fx),
                    Mix(Susp[I00 + Nx], Susp[I00 + Nx + 1], Fx),
                    Fz
                );
            }

            const Mw = MaskW ? MaskW[I] : 1.0;
            const Rock = SampleCachedLithology(Geo, I, Bed[I], Lith, MaxRelief);
            // Frost/chemical pre-damage weakens bedrock against hydraulic shear!
            const EffHardness = Clamp(Rock.hardness * (1.0 - 0.38 * State.frostDamage[I] - 0.30 * State.chemical[I]), 0.04, 0.98);

            // Transport capacity C_eq (Stream-power / Meyer-Peter-Muller)
            const Capacity = SedCap * Math.pow(Discharge + 0.02 * Speed, 0.85) * SinSlope * 1.65;

            if (Capacity > UpS && Discharge > 0.003 && Mw > 1e-3)
            {
                const Deficit = (Capacity - UpS) * ErosionStr * Mw;
                // Entrain mobile sand & alluvium first, then talus, then incise intact bedrock where τ > τ_crit
                let ScourRem = Math.min(AvgStep * 0.14, Deficit * 0.34 * Dt);
                let Picked = 0.0;

                if (Sand[I] > 0.0)
                {
                    const TakeS = Math.min(Sand[I], ScourRem * 1.25);
                    Sand[I] -= TakeS;
                    Picked += TakeS;
                    ScourRem = Math.max(0.0, ScourRem - TakeS * 0.8);
                }
                if (ScourRem > 0.0 && Alluv[I] > 0.0)
                {
                    const TakeA = Math.min(Alluv[I], ScourRem);
                    Alluv[I] -= TakeA;
                    Picked += TakeA;
                    ScourRem -= TakeA;
                }
                if (ScourRem > 0.0 && Tal[I] > 0.0)
                {
                    const TakeT = Math.min(Tal[I], ScourRem * 0.55);
                    Tal[I] -= TakeT;
                    Picked += TakeT;
                    ScourRem -= TakeT;
                }
                if (ScourRem > 0.0)
                {
                    const ShearProxy = Discharge * (0.12 + SinSlope * 2.4);
                    const CritShear = 0.008 + 0.095 * EffHardness * EffHardness;
                    if (ShearProxy > CritShear)
                    {
                        const MaxBedCut = Math.max(0.0, Bed[I] - (SeaLevel - 1.2));
                        const BedCut = Math.min(MaxBedCut, ScourRem * (0.85 / (0.20 + 2.1 * EffHardness)));
                        Bed[I] -= BedCut;
                        Wear[I] += BedCut;
                        Picked += BedCut;
                    }
                }
                NextSusp[I] = UpS + Picked;
            }
            else if (UpS > Capacity)
            {
                const Drop = (UpS - Capacity) * DepRate * Mw * 0.48;
                Alluv[I] += Drop;
                Dep[I] += Drop;
                NextSusp[I] = Math.max(0.0, UpS - Drop);
            }
            else
            {
                NextSusp[I] = UpS;
            }

            // ④ Green-Ampt Hillslope Infiltration + Evaporation (eliminates sheet-flooding on slopes!)
            const IsChannel = FlowAcc[I] > 0.24 || Slope < 0.045;
            const Infil = InfilRate * (IsChannel ? 0.012 : 0.068) * (1.0 - 0.55 * Wet[I]) * Dt;
            const Evap = EvapRate * (WNew < 0.12 && !IsChannel ? 0.075 : 0.016) * Dt;
            const Lost = Math.min(WNew, Infil + Evap);
            WNew = Math.max(0.0, WNew - Lost);
            if (Infil > 0.0) Wet[I] = Clamp(Wet[I] + Math.min(0.35, Infil * 4.5), 0.0, 1.0);
            if (WNew > 0.08) Wet[I] = Clamp(Math.max(Wet[I], Smoothstep(0.04, 0.22, WNew)), 0.0, 1.0);

            Water[I] = WNew;
        }
    }

    State.sedimentSusp.set(NextSusp);

    // Light wet-alluvium smoothing so floodplains & deltas fan out naturally at 26° repose
    RelaxGranularLayer(Bed, Alluv, Tal, Sand, Sdf2D, Nx, Nz, AvgStep, 0.50, 0.28);
}

//------------------------------------------------------------------------------------------------------------------------
//              2. PITTING SOLVER: CRYOGENIC FROST CRACKING + THERMAL INSOLATION & TAFONI HONEYCOMB (FIXED!)
//------------------------------------------------------------------------------------------------------------------------

export function StepPittingWeathering(State, Context, Params = {})
{
    const { nx: Nx, nz: Nz, stepX: StepX, stepZ: StepZ, bounds: B, sdf2D: Sdf2D, seaLevel: SeaLevel, maskWeights: MaskW, lithology: Lith, maxRelief: MaxRelief, seed: Seed, sunDir: SunDir } = Context;
    const AvgStep = 0.5 * (StepX + StepZ);

    const FrostStrength = Clamp(Params.frostIntensity ?? 0.76, 0.0, 2.0);
    const ThermalStrength = Clamp(Params.thermalIntensity ?? 0.74, 0.0, 2.0);
    const PitScale = Clamp(Params.pitScale ?? 0.70, 0.35, 3.0);
    const JointFocus = Clamp(Params.jointExploit ?? Params.jointSensitivity ?? 0.78, 0.1, 1.5);
    const TafoniStrength = Clamp(Params.tafoniStrength ?? 0.65, 0.0, 1.5);
    const Geo = EnsureStaticGeologyCache(State, Context, PitScale);

    const SeaTempC = Params.meanTempOverrideC ?? (Context.weather?.seaLevelTempC ?? 6.5);
    const DiurnalAmpC = Context.weather?.diurnalAmpC ?? 14.0;
    const LapsePerM = (Context.weather?.lapseRateCPerKm ?? 6.5) * 0.001;
    const Sx = SunDir ? SunDir[0] : 0.55, Sy = SunDir ? SunDir[1] : 0.52, Sz = SunDir ? SunDir[2] : 0.65;

    const Bed = State.bedrock, Alluv = State.alluvium, Tal = State.talus, Sand = State.aeolianSand;
    const Pit = State.pitting, Dmg = State.frostDamage, Wear = State.wear, Wet = State.wetness, Snow = State.snowIce;

    const Count = Nx * Nz;
    const Surf = new Float32Array(Count);
    for (let I = 0; I < Count; ++I) Surf[I] = Bed[I] + Alluv[I] + Tal[I] + Sand[I];

    const ShedTalus = new Float32Array(Count);
    const PitFreq = 0.052 / PitScale;

    for (let Z = 1; Z < Nz - 1; ++Z)
    {
        const Wz = B.z + Z * StepZ;
        const Row = Z * Nx;
        for (let X = 1; X < Nx - 1; ++X)
        {
            const I = Row + X;
            if (Sdf2D[I] >= -AvgStep * 0.25 || Surf[I] <= SeaLevel + 0.5) continue;

            const Mw = MaskW ? MaskW[I] : 1.0;
            if (Mw <= 1e-3) continue;

            // Thick loose regolith shields underlying bedrock from thermal/frost pitting
            const MantleDepth = Alluv[I] + Tal[I] + Sand[I];
            const BedrockExposure = Math.exp(-MantleDepth * 1.45);
            if (BedrockExposure < 0.08) continue;

            const DzDx = (Surf[I + 1] - Surf[I - 1]) / (2.0 * StepX);
            const DzDz = (Surf[I + Nx] - Surf[I - Nx]) / (2.0 * StepZ);
            const Slope = Math.hypot(DzDx, DzDz);
            const InvN = 1.0 / Math.sqrt(DzDx * DzDx + 1.0 + DzDz * DzDz);
            const NxV = -DzDx * InvN, NyV = InvN, NzV = -DzDz * InvN;

            const SunCos = Math.max(0.0, NxV * Sx + NyV * Sy + NzV * Sz);
            const Wx = B.x + X * StepX;

            // ① Local elevation temperature & Walder-Hallet (-8°C .. -3°C) Frost-Cracking Window + 0°C Freeze-Thaw
            const LocalTempC = SeaTempC - Math.max(0.0, Surf[I] - SeaLevel) * LapsePerM + (SunCos - 0.35) * 3.5;
            const SegWindow = Math.exp(-Math.pow((LocalTempC - (-5.2)) / 3.8, 2.0));
            const ZeroCross = Math.exp(-Math.pow(LocalTempC / Math.max(2.5, DiurnalAmpC * 0.48), 2.0));
            const MoistureAvail = Clamp(0.32 + 0.68 * Math.max(Wet[I], Smoothstep(0.0, 0.35, Snow[I])), 0.15, 1.0);
            const CryoDrive = FrostStrength * (0.62 * SegWindow + 0.54 * ZeroCross) * MoistureAvail;

            // ② Thermal Stress / Solar Insolation Fatigue (σ_th = E α ΔT / (1 - ν)) + Alveolar Honeycomb Tafoni
            const SolarShock = Smoothstep(0.18, 0.85, SunCos) * Smoothstep(6.0, 22.0, DiurnalAmpC);
            const SteepLedge = Smoothstep(0.22, 1.15, Slope);
            const ThermalDrive = ThermalStrength * SolarShock * (0.40 + 0.60 * SteepLedge);

            const Rock = SampleCachedLithology(Geo, I, Bed[I], Lith, MaxRelief);

            // Joint clefts widen along Voronoi edges; tafoni cavities hollow out porous cell interiors on steep ledges!
            const JointSeam = Geo.pitSeam[I] * JointFocus;
            const AlveolarBowl = Geo.pitBowl[I] * TafoniStrength * (0.35 + 0.65 * SteepLedge) * (1.15 - Rock.strataBand * 0.65);

            const PitPattern = Clamp(JointSeam * 0.95 + AlveolarBowl * 1.15, 0.0, 1.65);
            const TotalDrive = (CryoDrive + ThermalDrive) * BedrockExposure * Mw;
            if (TotalDrive <= 1e-4) continue;

            Dmg[I] = Clamp(Dmg[I] + TotalDrive * (0.08 + 0.16 * PitPattern) / (0.35 + Rock.hardness), 0.0, 1.0);

            // ③ Direct bedrock pit & joint excavation! Spalled clasts shed to steepest downslope neighbour (NOT refilling the pit!)
            const SpallDepth = Math.min(
                Math.max(0.0, Bed[I] - (SeaLevel + 0.2)),
                TotalDrive * PitPattern * (0.14 + 0.24 * Dmg[I]) * AvgStep * 0.055 / (0.28 + 1.35 * Rock.hardness)
            );
            if (SpallDepth <= 1e-5) continue;

            Bed[I] -= SpallDepth;
            Wear[I] += SpallDepth;
            Pit[I] = Clamp(Pit[I] + SpallDepth * 0.65 + TotalDrive * PitPattern * 0.06, 0.0, 1.0);

            // Route detached spall downslope so cavities stay sharply carved!
            let BestN = I, BestDrop = 0.0;
            const Offs = [-1, 1, -Nx, Nx, -Nx - 1, -Nx + 1, Nx - 1, Nx + 1];
            for (let K = 0; K < 8; ++K)
            {
                const J = I + Offs[K];
                const Drop = Surf[I] - Surf[J];
                if (Drop > BestDrop) { BestDrop = Drop; BestN = J; }
            }
            if (BestN !== I && Sdf2D[BestN] < 0.0)
            {
                // Fine thermal dust deflates away; coarse frost spall feeds downslope talus
                ShedTalus[BestN] += SpallDepth * (CryoDrive > ThermalDrive ? 0.52 : 0.28);
            }
        }
    }

    for (let I = 0; I < Count; ++I)
    {
        if (ShedTalus[I] > 0.0)
        {
            Tal[I] += ShedTalus[I];
            State.deposit[I] += ShedTalus[I];
        }
    }
    RelaxGranularLayer(Bed, Tal, Alluv, Sand, Sdf2D, Nx, Nz, AvgStep, 0.72, 0.34);
}

//------------------------------------------------------------------------------------------------------------------------
//       3. AEOLIAN WIND SOLVER: CANYON VENTURI SANDSTONE CUTS + BAGNOLD DESERT DUNE SALTATION (FIXED!)
//------------------------------------------------------------------------------------------------------------------------

export function StepAeolianWindErosion(State, Context, Params = {})
{
    const { nx: Nx, nz: Nz, stepX: StepX, stepZ: StepZ, bounds: B, sdf2D: Sdf2D, seaLevel: SeaLevel, maskWeights: MaskW, lithology: Lith, maxRelief: MaxRelief, seed: Seed } = Context;
    const Count = Nx * Nz;
    const AvgStep = 0.5 * (StepX + StepZ);

    const AzDeg = Params.useWeatherWind !== false && Context.weather
        ? Context.weather.windAzimuthDeg
        : (Params.windAzimuthDeg ?? 38.0);
    const AzRad = (AzDeg * Math.PI) / 180.0;
    const WindX = Math.cos(AzRad), WindZ = Math.sin(AzRad);
    const PerpX = -WindZ, PerpZ = WindX;

    const WindSpeed = Clamp((Params.windSpeed ?? 0.72) * (Context.weather ? (0.55 + 0.75 * Context.weather.windSpeed) : 1.0), 0.05, 1.8);
    const AbrasionRate = Clamp(Params.canyonAbrasion ?? 0.82, 0.0, 2.2);
    const VenturiBoost = Clamp(Params.strataUndercut ?? Params.venturiChannelling ?? 0.88, 0.0, 2.0);
    const SaltationRate = Clamp(Params.duneStrength ?? Params.duneSaltation ?? 0.74, 0.0, 2.0);
    const SandSupply = Clamp(Params.sandSupply ?? 0.42, 0.0, 1.5);
    const Geo = EnsureStaticGeologyCache(State, Context);

    const Bed = State.bedrock, Alluv = State.alluvium, Tal = State.talus, Sand = State.aeolianSand;
    const Water = State.waterDepth, Snow = State.snowIce, Wear = State.wear, Dep = State.deposit, VelMag = State.velocityMag;

    const Surf = new Float32Array(Count);
    for (let I = 0; I < Count; ++I) Surf[I] = Bed[I] + Alluv[I] + Tal[I] + Sand[I];

    const NextSand = new Float32Array(Sand);
    const SpanReach = Math.max(2, Math.min(6, Math.round(42.0 / AvgStep)));

    for (let Z = 2; Z < Nz - 2; ++Z)
    {
        const Wz = B.z + Z * StepZ;
        const Row = Z * Nx;
        for (let X = 2; X < Nx - 2; ++X)
        {
            const I = Row + X;
            if (Sdf2D[I] >= -AvgStep * 0.35 || Surf[I] <= SeaLevel + 0.35) continue;
            if (Water[I] > 0.06 || Snow[I] > 0.08) continue; // Submerged or snow-buried cells protected from dry wind

            const Mw = MaskW ? MaskW[I] : 1.0;
            if (Mw <= 1e-3) continue;

            const HHere = Surf[I];
            const DzDx = (Surf[I + 1] - Surf[I - 1]) / (2.0 * StepX);
            const DzDz = (Surf[I + Nx] - Surf[I - Nx]) / (2.0 * StepZ);
            const Slope = Math.hypot(DzDx, DzDz);

            // ① Canyon Confinement & Venturi Channelling Detection!
            // Sample lateral terrain elevation across ±SpanReach perpendicular to local canyon/wind corridor:
            // When flanked by higher canyon rims on one or both sides, wind accelerates through the slot (Venturi)
            // instead of falsely shutting off in wind-shadow!
            const Lx1 = Clamp(Math.round(X + PerpX * SpanReach), 1, Nx - 2);
            const Lz1 = Clamp(Math.round(Z + PerpZ * SpanReach), 1, Nz - 2);
            const Lx2 = Clamp(Math.round(X - PerpX * SpanReach), 1, Nx - 2);
            const Lz2 = Clamp(Math.round(Z - PerpZ * SpanReach), 1, Nz - 2);
            const HLeft = Surf[Lz1 * Nx + Lx1];
            const HRight = Surf[Lz2 * Nx + Lx2];
            const WallRiseL = Math.max(0.0, HLeft - HHere);
            const WallRiseR = Math.max(0.0, HRight - HHere);
            const CanyonConfinement = Clamp((Math.min(WallRiseL, WallRiseR) * 1.4 + 0.45 * Math.max(WallRiseL, WallRiseR)) / 45.0, 0.0, 1.5);

            // Deflect wind tangentially along steep canyon walls while boosting Venturi speed
            let LocalWx = WindX, LocalWz = WindZ;
            if (Slope > 0.18)
            {
                const InvS = 1.0 / Slope;
                const GradX = DzDx * InvS, GradZ = DzDz * InvS;
                // Canyon contour tangent aligned with prevailing wind
                let TanX = -GradZ, TanZ = GradX;
                if (TanX * WindX + TanZ * WindZ < 0.0) { TanX = -TanX; TanZ = -TanZ; }
                const Deflect = Smoothstep(0.18, 0.95, Slope) * 0.72;
                LocalWx = Mix(WindX, TanX, Deflect);
                LocalWz = Mix(WindZ, TanZ, Deflect);
                const L = Math.hypot(LocalWx, LocalWz) || 1.0;
                LocalWx /= L; LocalWz /= L;
            }

            // Upwind & downwind heights along deflected streamline
            const Ux = Clamp(Math.round(X - LocalWx * 1.5), 1, Nx - 2);
            const Uz = Clamp(Math.round(Z - LocalWz * 1.5), 1, Nz - 2);
            const Dx = Clamp(Math.round(X + LocalWx * 1.5), 1, Nx - 2);
            const Dz = Clamp(Math.round(Z + LocalWz * 1.5), 1, Nz - 2);
            const IUp = Uz * Nx + Ux;
            const IDn = Dz * Nx + Dx;

            const SlopeAlongWind = (HHere - Surf[IUp]) / (1.5 * AvgStep);
            const LeeDrop = (HHere - Surf[IDn]) / (1.5 * AvgStep);

            // Open-desert lee shadow behind dune crests, OVERRIDDEN inside confined Venturi canyon corridors!
            const OpenLeeWake = Clamp(Smoothstep(0.08, 0.55, -SlopeAlongWind) * (1.0 - 0.85 * Clamp(CanyonConfinement, 0.0, 1.0)), 0.0, 0.85);
            const VenturiSpeed = WindSpeed * (1.0 + VenturiBoost * CanyonConfinement * 1.15) * (1.0 - 0.68 * OpenLeeWake);
            VelMag[I] = Math.max(VelMag[I], VenturiSpeed * 8.5);

            const Wx = B.x + X * StepX;

            // ② Bedrock Cross-Bedded Sandstone Corrasion (Sandblasting Cuts on Canyon Walls, Hoodoos & Yardangs!)
            const SandShield = Math.exp(-Sand[I] * 3.2);
            if (AbrasionRate > 0.01 && SandShield > 0.12 && VenturiSpeed > 0.18)
            {
                const Rock = SampleCachedLithology(Geo, I, Bed[I], Lith, MaxRelief);
                // Cross-bedded sandstone laminae & wind flutes along local streamline
                const AlongCoord = Wx * LocalWx + Wz * LocalWz;
                const CrossBedWave = 0.5 + 0.5 * Math.sin(Bed[I] * 0.34 + AlongCoord * 0.028 + Geo.windNoise[I] * 3.5);
                const FluteChannel = 0.45 + 0.85 * Smoothstep(0.28, 0.82, CrossBedWave) * (1.18 - Rock.strataBand * 0.82);

                // Abrasion peaks on steep canyon walls, windward faces, and basal Venturi saltation curtains!
                const WallExposure = Clamp(
                    0.22 + 1.15 * Smoothstep(0.18, 1.10, Slope) + 0.85 * CanyonConfinement + 0.45 * Math.max(0.0, SlopeAlongWind),
                    0.0,
                    2.4
                );
                const AbrasiveLoad = Clamp(0.32 + 0.68 * SandSupply + Smoothstep(0.0, 0.35, Sand[IUp] + Alluv[IUp]), 0.25, 1.6);

                const CutDepth = Math.min(
                    Math.max(0.0, Bed[I] - (SeaLevel + 0.25)),
                    AbrasionRate * VenturiSpeed * VenturiSpeed * WallExposure * FluteChannel * AbrasiveLoad * SandShield * Mw
                    * AvgStep * 0.022 / (0.20 + 1.85 * Rock.hardness * Rock.hardness)
                );

                if (CutDepth > 1e-5)
                {
                    Bed[I] -= CutDepth;
                    Wear[I] += CutDepth;
                    // Abraded quartz grains advect downwind instead of refilling the carved sandstone cut!
                    if (Sdf2D[IDn] < -AvgStep * 0.4)
                    {
                        NextSand[IDn] += CutDepth * 0.48;
                        Dep[IDn] += CutDepth * 0.48;
                    }
                }
            }

            // ③ Bagnold / Sauermann Desert Sand Saltation & Asymmetric Dune Migration
            if (SaltationRate > 0.01)
            {
                // Aeolian sand source on flat/open desert basins when sandSupply > 0
                if (SandSupply > 0.08 && Slope < 0.32 && CanyonConfinement < 0.45)
                {
                    const RippleWave = 0.5 + 0.5 * Math.sin((Wx * LocalWx + Wz * LocalWz) * 0.055 + Geo.windNoise[I] * 4.2);
                    const SupplyAdd = SandSupply * SaltationRate * 0.0045 * AvgStep * RippleWave * (1.0 - Smoothstep(2.8, 9.5, Sand[I])) * Mw;
                    NextSand[I] += SupplyAdd;
                    Dep[I] += SupplyAdd * 0.5;
                }

                // Excess shear saltation transport from cell I -> downwind cell IDn
                const Shear = VenturiSpeed * (1.0 + 0.35 * Math.max(0.0, SlopeAlongWind));
                const CritSandShear = 0.16;
                if (Shear > CritSandShear && NextSand[I] > 0.001 && Sdf2D[IDn] < -AvgStep * 0.4)
                {
                    const Excess = (Shear * Shear - CritSandShear * CritSandShear);
                    const Hop = Math.min(NextSand[I] * 0.42, Excess * SaltationRate * 0.16 * AvgStep * Mw);
                    // Trap sand strongly in lee separation zones (building sharp slipface crests!)
                    const LeeTrap = Smoothstep(0.05, 0.48, LeeDrop);
                    const Moved = Hop * (1.0 - 0.55 * LeeTrap);
                    NextSand[I] -= Moved;
                    NextSand[IDn] += Moved;
                }
            }
        }
    }

    Sand.set(NextSand);
    // Dry quartz sand relaxes cleanly to the 34° Bagnold slipface angle of repose (tan 34° ≈ 0.6745)
    RelaxGranularLayer(Bed, Sand, Alluv, Tal, Sdf2D, Nx, Nz, AvgStep, 0.6745, 0.42);
}

//------------------------------------------------------------------------------------------------------------------------
//      4. ROCKFALL, CLIFF CALVING & CONICAL TALUS SCREE SOLVER (DIRECTLY IN TERRAIN FIELD — FIXED!)
//------------------------------------------------------------------------------------------------------------------------

export function StepRockfallTalusErosion(State, Context, Params = {})
{
    const { nx: Nx, nz: Nz, stepX: StepX, stepZ: StepZ, bounds: B, sdf2D: Sdf2D, seaLevel: SeaLevel, maskWeights: MaskW, lithology: Lith, maxRelief: MaxRelief, seed: Seed } = Context;
    const Count = Nx * Nz;
    const AvgStep = 0.5 * (StepX + StepZ);

    const CalvingRate = Clamp(Params.calvingRate ?? Params.rockfallIntensity ?? 0.76, 0.02, 2.2);
    const CritCliffDeg = Clamp(Params.criticalSlopeDeg ?? Params.criticalCliffDeg ?? 46.0, 28.0, 76.0);
    const TalusReposeDeg = Clamp(Params.talusReposeDeg ?? 35.5, 26.0, 44.0);
    const CouloirScour = Clamp(Params.runoutMobility ?? Params.couloirScour ?? 0.68, 0.0, 1.5);
    const Geo = EnsureStaticGeologyCache(State, Context);

    const CritSlopeTan = Math.tan((CritCliffDeg * Math.PI) / 180.0);
    const TalusSlopeTan = Math.tan((TalusReposeDeg * Math.PI) / 180.0);

    const Bed = State.bedrock, Alluv = State.alluvium, Tal = State.talus, Sand = State.aeolianSand;
    const Wear = State.wear, Dep = State.deposit, Dmg = State.frostDamage, Pit = State.pitting;

    const Surf = new Float32Array(Count);
    for (let I = 0; I < Count; ++I) Surf[I] = Bed[I] + Alluv[I] + Tal[I] + Sand[I];

    const IncomingRock = new Float32Array(Count);
    const Offsets = [
        [-1, 0, StepX], [1, 0, StepX], [0, -1, StepZ], [0, 1, StepZ],
        [-1, -1, Math.hypot(StepX, StepZ)], [1, -1, Math.hypot(StepX, StepZ)],
        [-1, 1, Math.hypot(StepX, StepZ)], [1, 1, Math.hypot(StepX, StepZ)]
    ];

    // ① Mohr-Coulomb Cliff Wedge Detachment & Kinetic Energy-Line Runout (Heim's Fahrböschung)
    for (let Z = 2; Z < Nz - 2; ++Z)
    {
        const Wz = B.z + Z * StepZ;
        const Row = Z * Nx;
        for (let X = 2; X < Nx - 2; ++X)
        {
            const I = Row + X;
            if (Sdf2D[I] >= -AvgStep * 0.25 || Surf[I] <= SeaLevel + 1.0) continue;

            const Mw = MaskW ? MaskW[I] : 1.0;
            if (Mw <= 1e-3) continue;

            // Steepest descent neighbour from cliff face
            let MaxSlope = 0.0, BestDx = 0, BestDz = 0;
            for (let K = 0; K < 8; ++K)
            {
                const [Ox, Oz, Dist] = Offsets[K];
                const J = (Z + Oz) * Nx + (X + Ox);
                const S = (Surf[I] - Surf[J]) / Dist;
                if (S > MaxSlope) { MaxSlope = S; BestDx = Ox; BestDz = Oz; }
            }

            const Rock = SampleCachedLithology(Geo, I, Bed[I], Lith, MaxRelief);
            // Joint fractures & frost/thermal pitting lower local cliff stability threshold!
            const Weakening = Clamp(0.32 * Rock.jointCrack + 0.34 * Dmg[I] + 0.22 * Pit[I], 0.0, 0.58);
            const LocalCritSlope = CritSlopeTan * (0.65 + 0.65 * Rock.hardness) * (1.0 - Weakening);

            if (MaxSlope <= LocalCritSlope) continue;

            // Joint-bounded wedge failure volume
            const ExcessSlope = MaxSlope - LocalCritSlope;
            const MaxDetach = Math.max(0.0, Bed[I] - (SeaLevel + 0.4)) * 0.35;
            const WedgeM = Math.min(
                MaxDetach,
                ExcessSlope * CalvingRate * (0.16 + 0.26 * Rock.jointCrack) * AvgStep * 0.095 * Mw / (0.35 + Rock.hardness)
            );
            if (WedgeM <= 1e-4) continue;

            Bed[I] -= WedgeM;
            Wear[I] += WedgeM;

            // ② Ballistic / Gravitational Chute Trajectory down steepest couloir until kinetic energy dissipates!
            let Cx = X + BestDx, Cz = Z + BestDz;
            let RockMass = WedgeM * 0.94;
            let KineticHead = ExcessSlope * AvgStep * 1.35;

            for (let Hop = 0; Hop < 18 && RockMass > 1e-4; ++Hop)
            {
                if (Cx <= 1 || Cx >= Nx - 2 || Cz <= 1 || Cz >= Nz - 2) break;
                const CI = Cz * Nx + Cx;
                if (Sdf2D[CI] >= 0.0 || Surf[CI] <= SeaLevel) break; // Splashed into ocean at sea-cliff base

                // Find next steepest step from CI
                let NextS = 0.0, NxOff = 0, NzOff = 0, StepDist = AvgStep;
                for (let K = 0; K < 8; ++K)
                {
                    const [Ox, Oz, Dist] = Offsets[K];
                    const NJ = (Cz + Oz) * Nx + (Cx + Ox);
                    const S = (Surf[CI] - Surf[NJ]) / Dist;
                    if (S > NextS) { NextS = S; NxOff = Ox; NzOff = Oz; StepDist = Dist; }
                }

                // Dynamic friction dissipation (tan φ_dynamic ≈ TalusSlopeTan * 0.92)
                KineticHead += (NextS - TalusSlopeTan * 0.92) * StepDist;

                // High-velocity rockfall scours narrow V-shaped couloirs on steep upper walls!
                if (NextS > TalusSlopeTan * 1.28 && CouloirScour > 0.02)
                {
                    const Scour = Math.min(Math.max(0.0, Bed[CI] - (SeaLevel + 0.5)), RockMass * 0.14 * CouloirScour);
                    Bed[CI] -= Scour;
                    Wear[CI] += Scour;
                    RockMass += Scour * 0.85;
                }

                // Deposit fraction when slope drops near or below talus angle of repose!
                if (NextS <= TalusSlopeTan * 1.05 || KineticHead <= 0.0 || NxOff === 0 && NzOff === 0)
                {
                    const DropFrac = KineticHead <= 0.0 ? 1.0 : 0.58;
                    const Deposited = RockMass * DropFrac;
                    IncomingRock[CI] += Deposited;
                    RockMass -= Deposited;
                    if (KineticHead <= 0.0) break;
                }

                Cx += NxOff;
                Cz += NzOff;
            }
        }
    }

    for (let I = 0; I < Count; ++I)
    {
        if (IncomingRock[I] > 0.0)
        {
            Tal[I] += IncomingRock[I];
            Dep[I] += IncomingRock[I];
        }
    }

    // ③ Multi-pass 8-neighbour granular relaxation builds authentic coalescing 35°–37° conical talus aprons!
    RelaxGranularLayer(Bed, Tal, Alluv, Sand, Sdf2D, Nx, Nz, AvgStep, TalusSlopeTan, 0.44);
    RelaxGranularLayer(Bed, Tal, Alluv, Sand, Sdf2D, Nx, Nz, AvgStep, TalusSlopeTan, 0.44);
}

//------------------------------------------------------------------------------------------------------------------------
//      5. CHEMICAL KARST DISSOLUTION, HALOCLASTY & GEOCHEMICAL STAINING SOLVER
//------------------------------------------------------------------------------------------------------------------------

export function StepChemicalWeathering(State, Context, Params = {})
{
    const { nx: Nx, nz: Nz, stepX: StepX, stepZ: StepZ, bounds: B, sdf2D: Sdf2D, seaLevel: SeaLevel, maskWeights: MaskW, lithology: Lith, maxRelief: MaxRelief, seed: Seed } = Context;
    const Count = Nx * Nz;
    const AvgStep = 0.5 * (StepX + StepZ);

    const DissolutionRate = Clamp(Params.karstRate ?? Params.karstDissolution ?? 0.72, 0.0, 2.0);
    const SinkholeStrength = Clamp(Params.sinkholeStrength ?? Params.sinkholeFocus ?? 0.58, 0.0, 1.5);
    const StainRate = Clamp(Params.stainIntensity ?? Params.mineralStaining ?? 0.74, 0.0, 1.8);
    const HaloclastyRate = Clamp(Params.rillenStrength ?? Params.saltWeathering ?? 0.45, 0.0, 1.5);
    const Geo = EnsureStaticGeologyCache(State, Context);

    const Bed = State.bedrock, Alluv = State.alluvium, Tal = State.talus, Sand = State.aeolianSand;
    const Flow = State.flowAccum, Wet = State.wetness, Chem = State.chemical, Wear = State.wear;

    const Surf = new Float32Array(Count);
    for (let I = 0; I < Count; ++I) Surf[I] = Bed[I] + Alluv[I] + Tal[I] + Sand[I];

    const NextChem = new Float32Array(Chem);

    for (let Z = 1; Z < Nz - 1; ++Z)
    {
        const Wz = B.z + Z * StepZ;
        const Row = Z * Nx;
        for (let X = 1; X < Nx - 1; ++X)
        {
            const I = Row + X;
            if (Sdf2D[I] >= -AvgStep * 0.25 || Surf[I] <= SeaLevel + 0.2) continue;

            const Mw = MaskW ? MaskW[I] : 1.0;
            if (Mw <= 1e-3) continue;

            const Wx = B.x + X * StepX;
            const Rock = SampleCachedLithology(Geo, I, Bed[I], Lith, MaxRelief);
            const Mantle = Alluv[I] + Tal[I] + Sand[I];
            const Exposure = Math.exp(-Mantle * 1.1);

            const DzDx = (Surf[I + 1] - Surf[I - 1]) / (2.0 * StepX);
            const DzDz = (Surf[I + Nx] - Surf[I - Nx]) / (2.0 * StepZ);
            const Slope = Math.hypot(DzDx, DzDz);

            // ① Carbonate Karst Dissolution: rillenkarren solution flutes on slopes + circular doline sinkholes at joint intersections!
            const WaterContact = Clamp(0.28 + 0.72 * Math.max(Wet[I], Flow[I] * 1.25), 0.15, 1.35);
            const DolineBowl = Geo.dolineMask[I] * SinkholeStrength * (1.0 - Smoothstep(0.15, 0.65, Slope));
            const KarrenFlute = (0.5 + 0.5 * Math.sin((Wx * DzDz - Wz * DzDx) * 0.22 / Math.max(0.08, Slope))) * Smoothstep(0.18, 0.85, Slope);

            const DissolveM = Math.min(
                Math.max(0.0, Bed[I] - (SeaLevel + 0.2)),
                DissolutionRate * Rock.solubility * WaterContact * Exposure * (0.32 + 0.95 * Rock.jointCrack + 1.35 * DolineBowl + 0.55 * KarrenFlute)
                * AvgStep * 0.022 * Mw
            );

            // ② Coastal / Arid Pan Salt Haloclasty (granular disaggregation near shore / damp hollows)
            const SaltZone = Smoothstep(38.0, 2.0, Surf[I] - SeaLevel) * Exposure;
            const SaltM = Math.min(
                Math.max(0.0, Bed[I] - (SeaLevel + 0.2)),
                HaloclastyRate * SaltZone * (1.1 - Rock.hardness) * AvgStep * 0.015 * Mw
            );

            const TotalLoss = DissolveM + SaltM;
            if (TotalLoss > 1e-5)
            {
                Bed[I] -= TotalLoss;
                Wear[I] += TotalLoss;
                // Carbonate dissolves into aqueous HCO3- (removed in solution!), leaving only minor terra-rossa clay residue
                Alluv[I] += DissolveM * 0.12 + SaltM * 0.35;
            }

            // ③ Geochemical Fe/Mn Staining & Downslope Seepage Advection (iron-oxide streaks & desert rock varnish)
            const MineralGen = StainRate * (0.035 * Rock.ironSource * WaterContact + 0.028 * Smoothstep(0.25, 0.95, Slope) * Exposure) * Mw;
            let StainVal = Clamp(NextChem[I] + MineralGen + TotalLoss * 0.45, 0.0, 1.0);
            NextChem[I] = StainVal;

            // Route dissolved mineral streak to steepest downhill cell
            let BestJ = I, BestDrop = 0.0;
            const Neigh = [I - 1, I + 1, I - Nx, I + Nx];
            for (let K = 0; K < 4; ++K)
            {
                const Drop = Surf[I] - Surf[Neigh[K]];
                if (Drop > BestDrop) { BestDrop = Drop; BestJ = Neigh[K]; }
            }
            if (BestJ !== I && StainVal > 0.08)
            {
                NextChem[BestJ] = Clamp(NextChem[BestJ] + StainVal * 0.085 * WaterContact, 0.0, 1.0);
            }
        }
    }

    Chem.set(NextChem);
}

//------------------------------------------------------------------------------------------------------------------------
//                          6. COUPLED 4-SEASON CLIMATE & CRYOSPHERE STEPPER
//------------------------------------------------------------------------------------------------------------------------

export function StepSnowpackAndGlacial(State, Context, Params = {})
{
    const { nx: Nx, nz: Nz, stepX: StepX, stepZ: StepZ, sdf2D: Sdf2D, seaLevel: SeaLevel, maskWeights: MaskW, maxRelief: MaxRelief } = Context;
    const AvgStep = 0.5 * (StepX + StepZ);
    const SeaTempC = Context.weather?.seaLevelTempC ?? 4.0;
    const LapsePerM = (Context.weather?.lapseRateCPerKm ?? 6.5) * 0.001;
    const SnowRate = Clamp((Params.snowfallRate ?? 0.65) * (Context.weather?.snowRate ?? 0.45), 0.0, 2.0);
    const GlacierPower = Clamp(Params.glacierStrength ?? 0.55, 0.0, 1.8);

    const Bed = State.bedrock, Alluv = State.alluvium, Tal = State.talus, Sand = State.aeolianSand;
    const Snow = State.snowIce, Wear = State.wear;

    for (let Z = 1; Z < Nz - 1; ++Z)
    {
        const Row = Z * Nx;
        for (let X = 1; X < Nx - 1; ++X)
        {
            const I = Row + X;
            if (Sdf2D[I] >= -AvgStep * 0.3) { Snow[I] = 0.0; continue; }
            const Mw = MaskW ? MaskW[I] : 1.0;
            const SurfH = Bed[I] + Alluv[I] + Tal[I] + Sand[I];
            if (SurfH <= SeaLevel + 1.0) { Snow[I] = 0.0; continue; }

            const LocalTempC = SeaTempC - (SurfH - SeaLevel) * LapsePerM;
            if (LocalTempC < 1.2 && SnowRate > 0.01)
            {
                const ColdW = Smoothstep(1.2, -6.0, LocalTempC);
                Snow[I] = Math.min(18.0, Snow[I] + SnowRate * ColdW * 0.18 * Mw);
            }
            else if (LocalTempC > 1.5 && Snow[I] > 0.0)
            {
                const Melt = Math.min(Snow[I], (LocalTempC - 1.5) * 0.045);
                Snow[I] -= Melt;
                State.waterDepth[I] += Melt * 0.32;
            }

            // Thick alpine ice grinds U-shaped glacial troughs
            if (Snow[I] > 1.4 && GlacierPower > 0.02)
            {
                const DzDx = (Bed[I + 1] - Bed[I - 1]) / (2.0 * StepX);
                const DzDz = (Bed[I + Nx] - Bed[I - Nx]) / (2.0 * StepZ);
                const Slope = Math.hypot(DzDx, DzDz);
                const Grind = Math.min(
                    Math.max(0.0, Bed[I] - (SeaLevel + 0.5)),
                    GlacierPower * (Snow[I] - 1.2) * (0.04 + Slope) * 0.008 * AvgStep * Mw / (1.0 + SurfH / Math.max(80.0, MaxRelief))
                );
                Bed[I] -= Grind;
                Wear[I] += Grind;
                Alluv[I] += Grind * 0.35; // Glacial moraine till
            }
        }
    }
}

export function StepFullSeasonalSuite(State, Context, Params = {})
{
    StepSnowpackAndGlacial(State, Context, Params);
    if ((Params.enableHydraulic ?? true) !== false) StepHydraulicErosion(State, Context, Params);
    if ((Params.enablePitting ?? true) !== false) StepPittingWeathering(State, Context, Params);
    if ((Params.enableWind ?? true) !== false) StepAeolianWindErosion(State, Context, Params);
    if ((Params.enableRockfall ?? true) !== false) StepRockfallTalusErosion(State, Context, Params);
    if ((Params.enableChemical ?? true) !== false) StepChemicalWeathering(State, Context, Params);
}

//------------------------------------------------------------------------------------------------------------------------
//                                  GRANULAR ANGLE-OF-REPOSE RELAXATION HELPER
//------------------------------------------------------------------------------------------------------------------------

function RelaxGranularLayer(Bed, MobileLayer, OtherA, OtherB, Sdf2D, Nx, Nz, AvgStep, MaxSlopeTan, Rate = 0.38)
{
    const Count = Nx * Nz;
    const Delta = new Float32Array(Count);
    const DiagStep = AvgStep * 1.41421356;

    for (let Z = 1; Z < Nz - 1; ++Z)
    {
        const Row = Z * Nx;
        for (let X = 1; X < Nx - 1; ++X)
        {
            const I = Row + X;
            const Avail = MobileLayer[I];
            if (Avail <= 1e-4 || Sdf2D[I] >= 0.0) continue;

            const HHere = Bed[I] + MobileLayer[I] + OtherA[I] + OtherB[I];
            const Neigh = [
                [I - 1, AvgStep], [I + 1, AvgStep], [I - Nx, AvgStep], [I + Nx, AvgStep],
                [I - Nx - 1, DiagStep], [I - Nx + 1, DiagStep], [I + Nx - 1, DiagStep], [I + Nx + 1, DiagStep]
            ];

            let SumExcess = 0.0;
            const ExcessArr = [0, 0, 0, 0, 0, 0, 0, 0];
            for (let K = 0; K < 8; ++K)
            {
                const [J, Dist] = Neigh[K];
                if (Sdf2D[J] >= AvgStep * 0.5) continue;
                const HJ = Bed[J] + MobileLayer[J] + OtherA[J] + OtherB[J];
                const Excess = (HHere - HJ) - MaxSlopeTan * Dist;
                if (Excess > 0.0)
                {
                    ExcessArr[K] = Excess;
                    SumExcess += Excess;
                }
            }

            if (SumExcess > 1e-5)
            {
                const MoveTotal = Math.min(Avail * 0.65, SumExcess * 0.5 * Rate);
                Delta[I] -= MoveTotal;
                for (let K = 0; K < 8; ++K)
                {
                    if (ExcessArr[K] > 0.0)
                    {
                        Delta[Neigh[K][0]] += MoveTotal * (ExcessArr[K] / SumExcess);
                    }
                }
            }
        }
    }

    for (let I = 0; I < Count; ++I)
    {
        MobileLayer[I] = Math.max(0.0, MobileLayer[I] + Delta[I]);
    }
}

//------------------------------------------------------------------------------------------------------------------------
//                       SHARED WEATHER SIMULATION GROUP COORDINATOR (1-BY-1 OR SHARED GROUPS)
//------------------------------------------------------------------------------------------------------------------------

export class WeatherSimulationCoordinator
{
    constructor()
    {
        this.groupClocks = new Map(); // groupId -> { stepIndex, weatherSpec }
        this.isPlaying = false;
        this.simulationMode = 'group'; // 'solo' (1-by-1 active terrain) | 'group' (shared weather group / multi-terrain)
        this.stepsPerFrame = 1;
    }

    getGroupClock(GroupId, FallbackWeather = {})
    {
        const Key = GroupId || 'solo';
        if (!this.groupClocks.has(Key))
        {
            this.groupClocks.set(Key, {
                stepIndex: 0,
                weatherSpec: {
                    climateRegime: FallbackWeather.climateRegime || 'alpine-continental',
                    windAzimuthDeg: FallbackWeather.windAzimuthDeg ?? 38.0,
                    windSpeed: FallbackWeather.windSpeed ?? 0.62,
                    windShiftMode: FallbackWeather.windShiftMode || 'variable',
                    rainMultiplier: FallbackWeather.rainMultiplier ?? 1.0,
                    tempOffsetC: FallbackWeather.tempOffsetC ?? 0.0,
                    stepsPerYear: FallbackWeather.stepsPerYear ?? 48,
                    seed: FallbackWeather.seed ?? 4029
                }
            });
        }
        return this.groupClocks.get(Key);
    }

    resetGroupClock(GroupId)
    {
        const Entry = this.groupClocks.get(GroupId);
        if (Entry) Entry.stepIndex = 0;
    }
}

//------------------------------------------------------------------------------------------------------------------------
//                     3D CHANNELIZED RIVER, TARN & LAGOON WATER MESH EXTRACTOR (ZERO FLOODING!)
//------------------------------------------------------------------------------------------------------------------------

export function ExtractRegionWaterMesh(World, Region)
{
    const Rt = Region?.runtime;
    const Ero = Rt?.erosion;
    if (!Rt || !Rt.hasLand)
    {
        return { positions: new Float32Array(0), normals: new Float32Array(0), aux: new Float32Array(0), indices: new Uint32Array(0), triangleCount: 0 };
    }

    const Nx = Rt.nx, Nz = Rt.nz, StepX = Rt.stepX, StepZ = Rt.stepZ;
    const B = Region.bounds;
    const SeaLevel = World.seaLevel ?? 0.0;
    const Heights = Rt.heights;
    const Sdf2D = Rt.sdf2D;
    const SplineWater = Rt.waterChannel;
    const SimWater = Ero ? Ero.waterDepth : null;
    const FlowAcc = Ero ? Ero.flowAccum : null;
    const VelMag = Ero ? Ero.velocityMag : null;
    const Susp = Ero ? Ero.sedimentSusp : null;

    // Effective open-water column: ONLY genuine channels, rivers, plunge pools, tarns & spline channels!
    // Sub-threshold hillslope films (< 0.075 m without concentrated flow) are strictly excluded so mountains NEVER flood!
    const Count = Nx * Nz;
    const OpenDepth = new Float32Array(Count);
    let ActiveWaterCells = 0;

    for (let Z = 0; Z < Nz; ++Z)
    {
        const Row = Z * Nx;
        for (let X = 0; X < Nx; ++X)
        {
            const I = Row + X;
            if (Sdf2D[I] >= -Math.max(StepX, StepZ) * 0.85 || Heights[I] <= SeaLevel + 0.22) continue;

            const Sw = SplineWater ? SplineWater[I] * 1.45 : 0.0;
            const Hw = SimWater ? SimWater[I] : 0.0;
            const Fl = FlowAcc ? FlowAcc[I] : 0.0;

            // Require either a spline river/lake OR genuine channelized flow / pooled basin depth >= 0.09m
            let Depth = 0.0;
            if (Sw > 0.12)
            {
                Depth = Math.max(Depth, Sw);
            }
            if (Hw > 0.095 && (Fl > 0.20 || Hw > 0.24))
            {
                Depth = Math.max(Depth, Hw);
            }

            if (Depth > 0.06)
            {
                OpenDepth[I] = Depth;
                ActiveWaterCells++;
            }
        }
    }

    if (ActiveWaterCells === 0)
    {
        return { positions: new Float32Array(0), normals: new Float32Array(0), aux: new Float32Array(0), indices: new Uint32Array(0), triangleCount: 0 };
    }

    const VertMap = new Int32Array(Count).fill(-1);
    const PosList = [];
    const NormList = [];
    const AuxList = []; // [depth, speed, foam, sedimentTint]
    const IdxList = [];

    const GetWaterVert = Idx =>
    {
        if (VertMap[Idx] >= 0) return VertMap[Idx];
        const X = Idx % Nx, Z = (Idx / Nx) | 0;
        const Wx = B.x + X * StepX;
        const Wz = B.z + Z * StepZ;
        const D = OpenDepth[Idx];
        // Smooth hydrostatic surface elevation slightly across neighbours to prevent stair-stepped water!
        let SumEta = Heights[Idx] + Math.max(0.12, D * 0.72), WSum = 1.5;
        const Neigh = [Idx - 1, Idx + 1, Idx - Nx, Idx + Nx];
        for (let K = 0; K < 4; ++K)
        {
            const J = Neigh[K];
            if (J >= 0 && J < Count && OpenDepth[J] > 0.02)
            {
                SumEta += Heights[J] + OpenDepth[J] * 0.72;
                WSum += 1.0;
            }
        }
        const Wy = Math.max(Heights[Idx] + (D > 0.04 ? 0.16 : -0.12), SumEta / WSum);

        const Speed = VelMag ? VelMag[Idx] : 0.6;
        const Froude = Speed / Math.sqrt(9.81 * Math.max(0.12, D));
        const Foam = Clamp(Smoothstep(0.55, 1.35, Froude) + (D < 0.16 ? 0.18 : 0.0), 0.0, 1.0);
        const SedTint = Susp ? Clamp(Susp[Idx] * 6.0, 0.0, 1.0) : 0.25;

        const VIdx = PosList.length / 3;
        PosList.push(Wx, Wy, Wz);
        NormList.push(0.0, 1.0, 0.0);
        AuxList.push(D, Speed, Foam, SedTint);
        VertMap[Idx] = VIdx;
        return VIdx;
    };

    for (let Z = 0; Z < Nz - 1; ++Z)
    {
        for (let X = 0; X < Nx - 1; ++X)
        {
            const C00 = Z * Nx + X, C10 = C00 + 1;
            const C01 = (Z + 1) * Nx + X, C11 = C01 + 1;
            const ActiveCount = (OpenDepth[C00] > 0 ? 1 : 0) + (OpenDepth[C10] > 0 ? 1 : 0) +
                                (OpenDepth[C01] > 0 ? 1 : 0) + (OpenDepth[C11] > 0 ? 1 : 0);
            if (ActiveCount < 2) continue;

            const V00 = GetWaterVert(C00), V10 = GetWaterVert(C10);
            const V01 = GetWaterVert(C01), V11 = GetWaterVert(C11);
            IdxList.push(V00, V01, V11, V00, V11, V10);
        }
    }

    // Recompute smooth water surface normals
    const VCount = PosList.length / 3;
    const AccN = new Float32Array(PosList.length);
    for (let T = 0; T < IdxList.length; T += 3)
    {
        const A = IdxList[T] * 3, Bv = IdxList[T + 1] * 3, C = IdxList[T + 2] * 3;
        const Ex1 = PosList[Bv] - PosList[A], Ey1 = PosList[Bv + 1] - PosList[A + 1], Ez1 = PosList[Bv + 2] - PosList[A + 2];
        const Ex2 = PosList[C] - PosList[A], Ey2 = PosList[C + 1] - PosList[A + 1], Ez2 = PosList[C + 2] - PosList[A + 2];
        const NxF = Ey1 * Ez2 - Ez1 * Ey2;
        const NyF = Ez1 * Ex2 - Ex1 * Ez2;
        const NzF = Ex1 * Ey2 - Ey1 * Ex2;
        AccN[A] += NxF; AccN[A + 1] += NyF; AccN[A + 2] += NzF;
        AccN[Bv] += NxF; AccN[Bv + 1] += NyF; AccN[Bv + 2] += NzF;
        AccN[C] += NxF; AccN[C + 1] += NyF; AccN[C + 2] += NzF;
    }
    for (let V = 0; V < VCount; ++V)
    {
        const K = V * 3;
        const L = Math.hypot(AccN[K], AccN[K + 1], AccN[K + 2]) || 1.0;
        NormList[K] = AccN[K] / L;
        NormList[K + 1] = Math.abs(AccN[K + 1] / L);
        NormList[K + 2] = AccN[K + 2] / L;
    }

    return {
        positions: new Float32Array(PosList),
        normals: new Float32Array(NormList),
        aux: new Float32Array(AuxList),
        indices: new Uint32Array(IdxList),
        triangleCount: IdxList.length / 3
    };
}
