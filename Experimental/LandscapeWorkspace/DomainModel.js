/*==========================================================================================================================================
                                                              DOMAINMODEL.JS
==========================================================================================================================================*/
// Authoring domain model (FrontierLandscape/1), per-layer SDF generators, presets, sparse brick export & GPU data packer.

export const VOLUME_RESOLUTIONS = [
    { key: '512x512x256', label: '512 × 512 × 256', nx: 512, nz: 512, ny: 256, vramMiB: 201 },
    { key: '512x512x128', label: '512 × 512 × 128', nx: 512, nz: 512, ny: 128, vramMiB: 101 },
    { key: '768x768x256', label: '768 × 768 × 256', nx: 768, nz: 768, ny: 256, vramMiB: 452 },
    { key: '1024x1024x320', label: '1024 × 1024 × 320', nx: 1024, nz: 1024, ny: 320, vramMiB: 1005 },
];

export const TerrainCategories = {
    fractal: 6, multifractal: 7, 'ridged-multifractal': 8,
    badlands: 9, 'ridge-noise': 10, 'fractal-ridges': 11, 'sand-dunes': 12
};

export const TerrainInfluenceDefaults = {
    Influence: 1, InfluenceRadius: 1.15, InfluenceFalloff: 1, InfluenceX: 0, InfluenceZ: 0
};

export const TerrainGeneratorCodes = {
    fractal: 26, multifractal: 27, 'ridged-multifractal': 28,
    badlands: 29, 'ridge-noise': 30, 'fractal-ridges': 31, 'sand-dunes': 32,
    ridges: 31, dunes: 32, mesa: 33, fault: 34, craters: 35
};

export const LandformCatalogue = [
    { Type: 'ridges', Name: 'Arête ridges', Amount: 48, Scale: 2.2, Sharpness: 0.60, Azimuth: 28, Mode: 'union' },
    { Type: 'mesa', Name: 'Mesa / plateau', Amount: 48, Scale: 2.2, Sharpness: 0.60, Azimuth: 28, Mode: 'union' },
    { Type: 'fault', Name: 'Fault escarpment', Amount: 48, Scale: 2.2, Sharpness: 0.60, Azimuth: 28, Mode: 'union' },
    { Type: 'dunes', Name: 'Aeolian dunes', Amount: 48, Scale: 2.2, Sharpness: 0.60, Azimuth: 28, Mode: 'union' },
    { Type: 'craters', Name: 'Impact crater bowls', Amount: 48, Scale: 2.2, Sharpness: 0.60, Azimuth: 28, Mode: 'subtract' },
    ...Object.keys(TerrainCategories).map(Type => ({
        Type,
        Name: {
            fractal: 'Fractal (fBm)', multifractal: 'Multifractal', 'ridged-multifractal': 'Ridged multifractal',
            badlands: 'Badlands', 'ridge-noise': 'Ridge noise', 'fractal-ridges': 'Fractal ridges', 'sand-dunes': 'Sand dunes'
        }[Type],
        Amount: 140, Scale: 2, Sharpness: 0.5, Azimuth: 0, Mode: 'union'
    })),
    { Type: 'stacks', Name: 'Rock stacks & hoodoos', Amount: 48, Scale: 2.2, Sharpness: 0.42, Azimuth: 35, Mode: 'union' },
    { Type: 'strata', Name: 'Stratigraphic ledges', Amount: 48, Scale: 2.2, Sharpness: 0.60, Azimuth: 28, Mode: 'union' },
    { Type: 'tunnel', Name: 'SDF caves & undercuts', Amount: 24, Scale: 2.3, Sharpness: 0.52, Azimuth: 28, Mode: 'subtract' },
    { Type: 'arch', Name: 'Volumetric arch', Amount: 80, Scale: 1.5, Sharpness: 0.5, Azimuth: 0, Mode: 'union' }
];

export const CombineModes = ['union', 'subtract', 'intersect', 'blend'];
export const MaximumPrimitives = 2048;
export const MaximumSculptSamples = 2048;

const CatalogueByType = new Map(LandformCatalogue.map(E => [E.Type, E]));
const OperationProperties = ['Type', 'Enabled', 'Amount', 'Scale', 'Sharpness', 'Azimuth', 'Mode', 'Blend', 'Seed', ...Object.keys(TerrainInfluenceDefaults)];
let CompilationCache = new WeakMap();

export function InvalidateLandforms() { CompilationCache = new WeakMap(); }

export function CreateLandform(Type) {
    const Entry = CatalogueByType.get(Type);
    if (!Entry) throw Error('Unknown landform');
    return {
        Type, Enabled: true, Amount: Entry.Amount, Scale: Entry.Scale,
        Sharpness: Entry.Sharpness, Azimuth: Entry.Azimuth, Mode: Entry.Mode,
        Blend: 8, Seed: 4029, ...(TerrainGeneratorCodes[Type] !== undefined ? TerrainInfluenceDefaults : {})
    };
}

// ---------- CPU Noise / Influence / Primitive SDF (matches GLSL 1:1) ----------

function Lattice(X, Y, Z, Seed) {
    let Bits = (Math.imul(X, 374761393) ^ Math.imul(Y, 668265263) ^ Math.imul(Z, 2147483647) ^ Seed) >>> 0;
    Bits = Math.imul(Bits ^ (Bits >>> 13), 1274126177) >>> 0;
    return ((Bits ^ (Bits >>> 16)) >>> 0) / 4294967295;
}

export function LatticeNoise(X, Y, Z, Seed) {
    const IX = Math.floor(X), IY = Math.floor(Y), IZ = Math.floor(Z);
    const S = t => t * t * (3 - 2 * t);
    const U = S(X - IX), V = S(Y - IY), W = S(Z - IZ);
    let Sum = 0;
    for (let DZ = 0; DZ < 2; DZ++)
        for (let DY = 0; DY < 2; DY++)
            for (let DX = 0; DX < 2; DX++)
                Sum += Lattice(IX + DX, IY + DY, IZ + DZ, Seed) * (DX ? U : 1 - U) * (DY ? V : 1 - V) * (DZ ? W : 1 - W);
    return Sum;
}

export function TerrainNoise(X, Y, Z, Category, Seed, Roughness) {
    let Sum = 0, Weight = 1, Normalization = 0, Product = 1;
    const Persistence = 0.35 + Roughness * 0.3;
    for (let Octave = 0; Octave < 4; Octave++) {
        const Noise = LatticeNoise(X, Y, Z, (Seed + Octave * 1013) >>> 0);
        const Ridge = 1 - Math.abs(Noise * 2 - 1);
        let Contribution = Noise;
        if (Category === 8 || Category === 9 || Category === 10 || Category === 11) Contribution = Ridge * Ridge;
        if (Category === 9) Contribution = Contribution * Contribution;
        if (Category === 10) return Ridge;
        Sum += Contribution * Weight;
        Normalization += Weight;
        Product *= 1 + (Contribution - 0.5) * Weight;
        X = X * 2.03 + 17.1; Y = Y * 2.03 - 9.2; Z = Z * 2.03 + 5.7;
        Weight *= Persistence;
    }
    if (Category === 7 || Category === 8) return Math.max(0, Math.min(1, (Product - 0.25) / 2.25));
    if (Category === 12) {
        const Warp = LatticeNoise(X * 0.03, Y * 0.03, Z * 0.03, Seed);
        return 0.5 + 0.5 * Math.sin(X * 0.12 + Warp * 2 + Y * 0.035) * (0.65 + 0.35 * Sum / Normalization);
    }
    return Sum / Normalization;
}

export function TerrainGradientBound(Category, Roughness) {
    const Persistence = 0.35 + Roughness * 0.3;
    let Weight = 1, Frequency = 1, Normalization = 0, Gradient = 0, ProductMaximum = 1;
    for (let Octave = 0; Octave < 4; Octave++) {
        Normalization += Weight;
        Gradient += Weight * Frequency * 2.6;
        ProductMaximum *= 1 + 0.5 * Weight;
        Weight *= Persistence;
        Frequency *= 2.03;
    }
    if (Category === 7 || Category === 8) return Gradient * ProductMaximum / 2.25 * (Category === 8 ? 4 : 1);
    if (Category === 10) return 5.2;
    if (Category === 12) return 6;
    return Gradient / Normalization * (Category === 9 ? 8 : Category === 11 ? 4 : 1);
}

export function TerrainProfileGradient(Category, Roughness) {
    const Code = Category - 20;
    return Code === 13 ? 3 * TerrainGradientBound(6, Roughness)
        : Code === 14 ? TerrainGradientBound(6, Roughness) + 1
            : Code === 15 ? 8 : TerrainGradientBound(Code, Roughness);
}

export function RadialWeight(Primitive, X, Z) {
    const Radius = Primitive.Radii[0], Feather = Radius * Primitive.Radii[2];
    const T = Math.max(0, Math.min(1, (Radius - Math.hypot(X - Primitive.Centre[0], Z - Primitive.Centre[2])) / Feather));
    return Primitive.Influence * T * T * (3 - 2 * T);
}

export function CoastWeight(PlanarDistance, Width) {
    if (Width <= 0) return PlanarDistance <= 0 ? 1 : 0;
    const Fraction = Math.max(0, Math.min(1, -PlanarDistance / Width));
    return Fraction * Fraction * (3 - 2 * Fraction);
}

export function TerrainProfile(Primitive, X, Y, Z) {
    const DX = X - Primitive.Centre[0], DZ = Z - Primitive.Centre[2], Frequency = Primitive.Bevel;
    const QX = (DX * Primitive.Cosine + DZ * Primitive.Sine) * Frequency;
    const QY = (Y - Primitive.Centre[1]) * Primitive.VerticalFrequency;
    const QZ = (-DX * Primitive.Sine + DZ * Primitive.Cosine) * Frequency;
    const Code = Primitive.Category - 20;
    if (Code === 15) {
        const Fract = v => v - Math.floor(v);
        const rx = Fract(QX + (Primitive.Phase % 997) * 0.013) - 0.5;
        const rz = Fract(QZ + (Primitive.Phase % 991) * 0.017) - 0.5;
        const T = Math.max(0, 1 - (rx * rx + rz * rz + QY * QY * 0.01) / 0.16);
        return T * T;
    }
    const N = TerrainNoise(QX, QY, QZ, Code > 12 ? 6 : Code, Primitive.Phase, Primitive.Detail);
    if (Code === 13) { const T = Math.max(0, Math.min(1, (N - 0.25) * 2)); return T * T * (3 - 2 * T); }
    if (Code === 14) return 0.5 + 0.3 * Math.sin(QX * 0.5) + 0.2 * N;
    return N;
}

export function SmoothUnion(A, B, Width) {
    if (Width <= 0) return Math.min(A, B);
    const I = Math.max(Width - Math.abs(A - B), 0) / Width;
    return Math.min(A, B) - I * I * Width * 0.25;
}

export function SmoothIntersection(A, B, Width) {
    return -SmoothUnion(-A, -B, Width);
}

export function CombineDistance(Distance, Feature, Mode, Width) {
    if (Mode === 'subtract') return SmoothIntersection(Distance, -Feature, Width);
    if (Mode === 'intersect') return SmoothIntersection(Distance, Feature, Width);
    if (Mode === 'blend') return (Distance + Feature) * 0.5;
    return SmoothUnion(Distance, Feature, Width);
}

export function PrimitiveDistance(Primitive, X, Y, Z) {
    const DX = X - Primitive.Centre[0];
    let DY = Y - Primitive.Centre[1];
    const DZ = Z - Primitive.Centre[2];
    const LocalX = DX * Primitive.Cosine + DZ * Primitive.Sine;
    const LocalZ = -DX * Primitive.Sine + DZ * Primitive.Cosine;
    const [RadiusX, RadiusY, RadiusZ] = Primitive.Radii;
    if (Primitive.Category >= 26) {
        const Bound = 1 + RadiusY * Primitive.Bevel * TerrainProfileGradient(Primitive.Category, Primitive.Detail);
        return (DY - RadiusY * TerrainProfile(Primitive, X, Y, Z)) / Bound;
    }
    if (Primitive.Category >= 6) {
        const Frequency = Primitive.Bevel;
        const Noise = TerrainNoise(LocalX * Frequency, DY * Frequency * 0.2, LocalZ * Frequency, Primitive.Category, Primitive.Phase, Primitive.Detail);
        const Bound = 1 + RadiusY * 0.85 * Frequency * TerrainGradientBound(Primitive.Category, Primitive.Detail);
        return Math.max((DY - RadiusY * (0.15 + 0.85 * Noise)) / Bound, DY - RadiusY);
    }
    const Frequency = 2 / Math.min(RadiusX, RadiusY, RadiusZ);
    const Detail = Primitive.Detail || 0;
    const Phase = Primitive.Phase || 0;
    const First = Math.sin(LocalX * Frequency + Phase) * Math.sin(LocalZ * Frequency - Phase) * Math.sin(DY * Frequency * 0.7 + Phase);
    const Second = Math.sin(LocalX * Frequency * 2 - Phase) * Math.sin(LocalZ * Frequency * 2 + Phase) * Math.sin(DY * Frequency * 1.4);
    DY += Detail * (First + Second * 0.35);
    const Bound = 1 + Detail * Frequency * Math.sqrt(2.49) * 1.7;
    if (Primitive.Category === 0) return (Math.hypot(LocalX / RadiusX, DY / RadiusY, LocalZ / RadiusZ) - 1) * Math.min(RadiusX, RadiusY, RadiusZ) / Bound;
    if (Primitive.Category === 1) {
        const QX = Math.abs(LocalX) - RadiusX, QY = Math.abs(DY) - RadiusY, QZ = Math.abs(LocalZ) - RadiusZ;
        return (Math.hypot(Math.max(QX, 0), Math.max(QY, 0), Math.max(QZ, 0)) + Math.min(Math.max(QX, QY, QZ), 0) - Primitive.Bevel) / Bound;
    }
    if (Primitive.Category === 2) {
        const Radial = Math.hypot(LocalX / RadiusX, LocalZ / RadiusZ);
        const Cone = (Radial + DY / RadiusY - 1) / Math.hypot(1 / Math.min(RadiusX, RadiusZ), 1 / RadiusY);
        return Math.max(Cone, -DY - RadiusY) / Bound;
    }
    if (Primitive.Category === 5) {
        const SlopeX = RadiusY / RadiusX, SlopeZ = RadiusY / RadiusZ;
        return Math.max(
            (Math.abs(LocalX) * SlopeX + DY - RadiusY) / Math.hypot(SlopeX, 1),
            (Math.abs(LocalZ) * SlopeZ + DY - RadiusY) / Math.hypot(SlopeZ, 1),
            -DY - RadiusY
        ) / Bound;
    }
    if (Primitive.Category === 3) return (Math.hypot(Math.hypot(LocalX, DY) - RadiusX, LocalZ) - RadiusZ) / Bound;
    return (Math.hypot(LocalX - Math.max(-RadiusX, Math.min(RadiusX, LocalX)), DY, LocalZ) - RadiusY) / Bound;
}

function SeedSequence(Seed) {
    let Seq = Seed >>> 0;
    return () => {
        Seq = (Math.imul(Seq, 1664525) + 1013904223) >>> 0;
        return Seq / 4294967296;
    };
}

export function CompileRegion(Layer, Region) {
    const Operations = Layer.Landforms?.length ? [...Layer.Landforms, ...(Region.Landforms || [])] : (Region.Landforms || []);
    const Cached = CompilationCache.get(Region);
    if (Cached && Cached.Depth === Layer.Depth && Cached.Edge === (Region.Edge || 0) &&
        Cached.Bounds[0] === Region.X0 && Cached.Bounds[1] === Region.Z0 &&
        Cached.Bounds[2] === Region.X1 && Cached.Bounds[3] === Region.Z1) {
        let Unchanged = Cached.Operations.length === Operations.length;
        for (let i = 0; Unchanged && i < Operations.length; i++)
            for (const P of OperationProperties)
                if (Cached.Operations[i][P] !== Operations[i][P]) { Unchanged = false; break; }
        if (Unchanged) return Cached;
    }
    const Steps = [];
    const SpanX = Region.X1 - Region.X0, SpanZ = Region.Z1 - Region.Z0;
    const CentreX = (Region.X0 + Region.X1) / 2, CentreZ = (Region.Z0 + Region.Z1) / 2;
    const Top = 0;
    let MaximumY = Top, MinimumY = -Layer.Depth;
    let VerticalSlope = 1, FieldBound = 1, EnvelopeSlope = 1, EnvelopeTop = Top, TerrainEnabled = false;

    for (const Operation of Operations) {
        if (!Operation.Enabled) continue;
        const Random = SeedSequence(Operation.Seed);
        const Angle = Operation.Azimuth * Math.PI / 180;
        const Cosine = Math.cos(Angle), Sine = Math.sin(Angle);
        const Primitives = [];
        let FeatureMaximum = -1e8, FeatureMinimum = 1e8, FeatureSlope = 1;
        const Count = Operation.Type === 'tunnel' || Operation.Type === 'arch' || Operation.Type === 'fault'
            ? 1 : Math.min(4, Math.max(1, Math.round(Operation.Scale)));
        const CellX = SpanX / Count, CellZ = SpanZ / Count;
        const Add = (Category, Centre, Radii, Bevel = 0) => {
            const Detail = ['arch', 'tunnel'].includes(Operation.Type) ? 0 : Math.min(...Radii) * (Operation.Type === 'ridges' ? 0.28 : 0.12) * Operation.Sharpness;
            const Phase = (Operation.Seed % 997) * 0.1;
            Primitives.push({ Category, Centre, Radii, Cosine, Sine, Bevel, Detail, Phase, Influence: 1, VerticalFrequency: 1 });
            const Radius = (Category === 3 ? Radii[0] + Radii[2] : Radii[1]) + Bevel + Detail * 1.35;
            FeatureMaximum = Math.max(FeatureMaximum, Centre[1] + Radius);
            FeatureMinimum = Math.min(FeatureMinimum, Centre[1] - Radius);
            const Bound = 1 + Detail * (2 / Math.min(...Radii)) * Math.sqrt(2.49) * 1.7;
            const Slope = Category === 0 ? Math.min(...Radii) / Radii[1] : Category === 2 || Category === 5 ? 1 / Math.hypot(1, Radii[1] / Math.min(Radii[0], Radii[2])) : 1;
            FeatureSlope = Math.min(FeatureSlope, Slope / Bound);
        };
        if (TerrainGeneratorCodes[Operation.Type] !== undefined) {
            TerrainEnabled = true;
            const Settings = { ...TerrainInfluenceDefaults, ...Operation };
            const Category = TerrainGeneratorCodes[Operation.Type];
            const Frequency = Operation.Scale * 3 / Math.min(SpanX, SpanZ);
            const Radius = Math.min(SpanX, SpanZ) * 0.5 * Settings.InfluenceRadius;
            const Primitive = {
                Category,
                Centre: [CentreX + Settings.InfluenceX * SpanX * 0.5, Top, CentreZ + Settings.InfluenceZ * SpanZ * 0.5],
                Radii: [Radius, Operation.Amount, Settings.InfluenceFalloff],
                Cosine, Sine, Bevel: Frequency, Detail: Operation.Sharpness, Phase: Operation.Seed,
                Influence: Settings.Influence
            };
            Primitive.VerticalFrequency = Math.min(Frequency * 0.2, 0.45 / (Operation.Amount * TerrainProfileGradient(Category, Operation.Sharpness)));
            Primitive.FieldBound = 1 + Operation.Amount * Frequency * TerrainProfileGradient(Category, Operation.Sharpness);
            Primitives.push(Primitive);
            FeatureMaximum = Top + Operation.Amount;
            FeatureMinimum = -Layer.Depth;
            const Limit = Operation.Amount + Operation.Blend * 0.25;
            const Gradient = Settings.Influence * (1.5 / (Radius * Settings.InfluenceFalloff) + (Region.Edge > 0 ? 1.5 / Region.Edge : 0));
            if (Settings.Influence > 0) FieldBound = Math.max(FieldBound, 1 + Operation.Amount * Frequency * TerrainProfileGradient(Category, Operation.Sharpness)) + Limit * Gradient;
            EnvelopeSlope += Limit * Gradient;
        } else {
            for (let Z = 0; Z < Count; Z++)
                for (let X = 0; X < Count; X++) {
                    const PositionX = Region.X0 + (X + 0.5 + (Random() - 0.5) * 0.5) * CellX;
                    const PositionZ = Region.Z0 + (Z + 0.5 + (Random() - 0.5) * 0.5) * CellZ;
                    const Height = Operation.Amount * (0.65 + Random() * 0.35);
                    const Radius = Math.min(CellX, CellZ) * (0.3 + Random() * 0.15);
                    if (Operation.Type === 'ridges') {
                        Add(2, [PositionX, Top - Height * 0.15, PositionZ], [Radius * 1.7, Height, Radius * 1.35]);
                        for (let Spur = 0; Spur < 2; Spur++) {
                            const SpurAngle = Random() * Math.PI * 2;
                            Add(2, [PositionX + Math.cos(SpurAngle) * Radius, Top - Height * 0.1, PositionZ + Math.sin(SpurAngle) * Radius * 0.8],
                                [Radius, Height * (0.35 + Random() * 0.3), Radius * 0.85]);
                        }
                    } else if (Operation.Type === 'mesa') Add(1, [PositionX, Top + Height * 0.35, PositionZ], [Radius, Height * 0.55, Radius * 0.8], Height * (1 - Operation.Sharpness) * 0.15);
                    else if (Operation.Type === 'fault') Add(5, [CentreX, Top, CentreZ], [SpanX * 0.65, Height, SpanZ * 0.45]);
                    else if (Operation.Type === 'dunes') Add(0, [PositionX, Top - Height * 0.3, PositionZ], [Radius * 1.65, Height, Radius * 0.65]);
                    else if (Operation.Type === 'craters') Add(0, [PositionX, Top + Height * 0.15, PositionZ], [Radius, Height * 0.65, Radius]);
                    else if (Operation.Type === 'stacks') {
                        Add(1, [PositionX, Top + Height * 0.35, PositionZ], [Radius * 0.3, Height * 0.6, Radius * 0.3], Height * 0.04);
                        Add(0, [PositionX + Height * 0.1, Top + Height * 0.9, PositionZ], [Radius * 0.6, Height * 0.23, Radius * 0.6]);
                    } else if (Operation.Type === 'strata') {
                        for (let Tier = 0; Tier < 4; Tier++)
                            Add(1, [PositionX, Top + Height * (Tier + 0.3) * 0.23, PositionZ],
                                [Radius * (Tier % 2 ? 0.85 : 1.1), Height * 0.12, Radius * (Tier % 2 ? 0.85 : 1.1)], Height * 0.025);
                    } else if (Operation.Type === 'tunnel') {
                        Add(4, [CentreX, Top - Height * 0.2, CentreZ], [Math.hypot(SpanX, SpanZ), Height * 0.5, Height * 0.5]);
                    } else {
                        Add(3, [CentreX, Top + Height * 0.35, CentreZ], [Height * 0.65, Height * 0.65, Height * 0.18]);
                    }
                }
        }
        if (Operation.Mode === 'union' || Operation.Mode === 'blend') {
            VerticalSlope = Math.min(VerticalSlope, FeatureSlope);
            const Expansion = Operation.Mode === 'union' ? Operation.Blend / (4 * VerticalSlope) : 0;
            MaximumY = Math.max(MaximumY, FeatureMaximum) + Expansion;
            MinimumY = Math.min(MinimumY, FeatureMinimum) - Expansion;
        }
        if (TerrainGeneratorCodes[Operation.Type] === undefined && (Operation.Mode === 'union' || Operation.Mode === 'blend'))
            EnvelopeTop = Math.max(EnvelopeTop, FeatureMaximum) + Operation.Blend / (4 * FeatureSlope);
        Steps.push({ Mode: Operation.Mode, Blend: Operation.Blend, Primitives });
    }
    const Result = {
        Depth: Layer.Depth, Edge: Region.Edge || 0, TerrainEnabled, FieldBound, EnvelopeSlope, EnvelopeTop,
        Steps, MaximumY, MinimumY, Bounds: [Region.X0, Region.Z0, Region.X1, Region.Z1],
        Operations: Operations.map(Op => ({ ...Op }))
    };
    CompilationCache.set(Region, Result);
    return Result;
}

export function LayerVerticalBounds(Layer, Region) {
    const Compilation = CompileRegion(Layer, Region);
    let Lower = Compilation.Steps.length ? Compilation.MinimumY - Layer.Depth * 0.1 : -Layer.Depth * 1.1;
    let Upper = Compilation.Steps.length ? Compilation.MaximumY + Layer.Depth * 0.1 : Layer.Depth * 0.1;
    if (Region.SculptStrokes?.length) {
        for (const Stroke of Region.SculptStrokes) {
            if (Stroke.Mode !== 'add') continue;
            for (const P of Stroke.Points) {
                Lower = Math.min(Lower, P[1] - Stroke.Radius * 1.2);
                Upper = Math.max(Upper, P[1] + Stroke.Radius * 1.2);
            }
        }
    }
    return [Lower, Upper];
}

// ---------- Distance Evaluation & Sparse Brick Export ----------

export function CapsuleDistance(X, Z, A, B, Radius) {
    const DX = B[0] - A[0], DZ = B[1] - A[1];
    const T = Math.max(0, Math.min(1, ((X - A[0]) * DX + (Z - A[1]) * DZ) / (DX * DX + DZ * DZ || 1)));
    return Math.hypot(X - A[0] - T * DX, Z - A[1] - T * DZ) - Radius;
}

export function MaskDistance(Layer, X, Z) {
    let Distance = 1e8;
    for (const Stroke of Layer.Strokes) {
        let StrokeDistance = 1e8;
        for (let i = 0; i < Stroke.Points.length; i++)
            StrokeDistance = Math.min(StrokeDistance, CapsuleDistance(X, Z, Stroke.Points[Math.max(0, i - 1)], Stroke.Points[i], Stroke.Radius));
        Distance = Stroke.Erase ? Math.max(Distance, -StrokeDistance) : Math.min(Distance, StrokeDistance);
    }
    return Distance;
}

export function RectangleDistance(Region, X, Z) {
    const DX = Math.abs(X - (Region.X0 + Region.X1) / 2) - (Region.X1 - Region.X0) / 2;
    const DZ = Math.abs(Z - (Region.Z0 + Region.Z1) / 2) - (Region.Z1 - Region.Z0) / 2;
    return Math.hypot(Math.max(DX, 0), Math.max(DZ, 0)) + Math.min(Math.max(DX, DZ), 0);
}

function SculptCapsuleDistance(Point, A, B, Radius) {
    const dx = B[0] - A[0], dy = B[1] - A[1], dz = B[2] - A[2];
    const denom = dx * dx + dy * dy + dz * dz;
    const t = Math.max(0, Math.min(1, ((Point[0] - A[0]) * dx + (Point[1] - A[1]) * dy + (Point[2] - A[2]) * dz) / (denom || 1)));
    return Math.hypot(Point[0] - A[0] - t * dx, Point[1] - A[1] - t * dy, Point[2] - A[2] - t * dz) - Radius;
}

export function EvaluateRegionStack(Layer, Region, Distance, X, Y, Z, PlanarDistance = -1e8, NormalizeEnabled = true) {
    const Compilation = CompileRegion(Layer, Region);
    let Envelope = Compilation.EnvelopeTop;
    if (Compilation.TerrainEnabled) Distance = Y;
    for (const Step of Compilation.Steps) {
        const Terrain = Step.Primitives[0];
        if (Terrain?.Category >= 26) {
            const Weight = RadialWeight(Terrain, X, Z) * CoastWeight(PlanarDistance, Compilation.Edge);
            const Limit = Terrain.Radii[1] + Step.Blend * 0.25;
            if (Weight > 0) {
                const Relief = Terrain.Radii[1] * TerrainProfile(Terrain, X, Y, Z);
                const Feature = Y - Terrain.Centre[1] + (Step.Mode === 'subtract' ? Relief : -Relief);
                const Candidate = Step.Mode === 'subtract' || Step.Mode === 'intersect'
                    ? SmoothIntersection(Distance, Feature, Step.Blend)
                    : Step.Mode === 'blend' ? (Distance + Feature) * 0.5 : SmoothUnion(Distance, Feature, Step.Blend);
                Distance += Weight * Math.max(-Limit, Math.min(Limit, Candidate - Distance));
                Envelope += Limit * Weight;
            }
        } else {
            let Feature = 1e8;
            for (const Primitive of Step.Primitives) Feature = Math.min(Feature, PrimitiveDistance(Primitive, X, Y, Z));
            Distance = CombineDistance(Distance, Feature, Step.Mode, Step.Blend);
        }
    }
    if (Compilation.TerrainEnabled && NormalizeEnabled)
        Distance = Math.max(Distance / Compilation.FieldBound, (Y - Envelope) / Compilation.EnvelopeSlope);
    return Distance;
}

export function VolumeDistance(Layer, X, Y, Z, Boundary = null, NormalizeEnabled = true) {
    if (!Layer.Visible || !Layer.Regions.length) return 1e8;
    const Mask = MaskDistance(Layer, X, Z);
    const Vertical = Math.abs(Y + Layer.Depth * 0.5) - Layer.Depth * 0.5;
    let Distance = 1e8;
    for (const Region of Boundary ? [Boundary] : Layer.Regions) {
        const Edge = Region.Edge || 0;
        const Radius = Math.min(Edge, (Region.X1 - Region.X0) * 0.49, (Region.Z1 - Region.Z0) * 0.49);
        const Rounded = { X0: Region.X0 + Radius, Z0: Region.Z0 + Radius, X1: Region.X1 - Radius, Z1: Region.Z1 - Radius };
        const Clip = RectangleDistance(Rounded, X, Z) - Radius;
        const Planar = Math.max(Mask, Clip);
        let RegionDist = Math.hypot(Math.max(Planar, 0), Math.max(Vertical, 0)) + Math.min(Math.max(Planar, Vertical), 0);
        RegionDist = EvaluateRegionStack(Layer, Region, RegionDist, X, Y, Z, Planar, NormalizeEnabled && !Region.SculptStrokes?.length);
        RegionDist = (CompileRegion(Layer, Region).TerrainEnabled || !CompileRegion(Layer, Region).Steps.length)
            ? Math.max(RegionDist, Planar)
            : SmoothIntersection(RegionDist, Planar, Edge);
        if (Region.SculptStrokes?.length) {
            const Pt = [X, Y, Z];
            for (const S of Region.SculptStrokes) {
                let Brush = 1e8;
                for (let i = 0; i < S.Points.length; i++)
                    Brush = Math.min(Brush, SculptCapsuleDistance(Pt, S.Points[Math.max(0, i - 1)], S.Points[i], S.Radius));
                const Blend = S.Radius * 0.15;
                RegionDist = S.Mode === 'add' ? SmoothUnion(RegionDist, Brush, Blend) : -SmoothUnion(-RegionDist, Brush, Blend);
            }
            RegionDist = Math.max(RegionDist, Planar);
            if (NormalizeEnabled) RegionDist /= Math.max(1, CompileRegion(Layer, Region).FieldBound);
        }
        RegionDist = Math.max(RegionDist, -Y - Layer.Depth);
        Distance = Math.min(Distance, RegionDist);
    }
    if (Layer.Caves && Layer.Regions.length) {
        const R = Layer.Regions[0];
        const Cavity = Math.hypot(X - (R.X0 + R.X1) / 2, Y, Z - (R.Z0 + R.Z1) / 2) - Layer.Depth * 0.65;
        Distance = Math.max(Distance, -Cavity);
    }
    return Distance;
}

export function SegmentCount(Layers) {
    return Layers.reduce((C, L) => C + L.Strokes.reduce((T, S) => T + S.Points.length, 0), 0);
}

export function ValidateRegionStack(Region) {
    if (Region.Edge !== undefined && (!Number.isFinite(Region.Edge) || Region.Edge < 0 || Region.Edge > 300))
        throw Error('Invalid boundary edge width');
    if (Region.Landforms === undefined) return;
    if (!Array.isArray(Region.Landforms) || Region.Landforms.length > 8)
        throw Error('Maximum eight landforms per boundary');
    for (const Op of Region.Landforms) {
        if (!Op || !CatalogueByType.has(Op.Type) || typeof Op.Enabled !== 'boolean' || !CombineModes.includes(Op.Mode))
            throw Error('Invalid landform operation');
    }
}

export function ValidateDocument(Document) {
    if (Document.Format !== 'FrontierLandscape/1' || !Array.isArray(Document.Layers) || !Document.Layers.length || Document.Layers.length > 16)
        throw Error('Unsupported landscape document');
    let PrimCount = 0;
    for (const Layer of Document.Layers) {
        ValidateRegionStack({ Landforms: Layer.Landforms });
        for (const Region of Layer.Regions) {
            ValidateRegionStack(Region);
            if ((Layer.Landforms?.length || 0) + (Region.Landforms?.length || 0) > 8)
                throw Error('Maximum eight combined mask-layer and region operations');
            for (const Step of CompileRegion(Layer, Region).Steps) PrimCount += Step.Primitives.length;
        }
    }
    if (PrimCount > MaximumPrimitives) throw Error(`Maximum ${MaximumPrimitives} compiled primitives per document`);
    if (SegmentCount(Document.Layers) > 512) throw Error('Maximum 512 vector capsule samples per document');
    InvalidateLandforms();
    return Document;
}

export function SampleSparseBricks(Layer, Region, Horizontal = 64, Vertical = 64) {
    const Bricks = [];
    const BrickWidth = 8;
    const [MinY, MaxY] = LayerVerticalBounds(Layer, Region);
    for (let BZ = 0; BZ < Horizontal; BZ += BrickWidth)
        for (let BY = 0; BY < Vertical; BY += BrickWidth)
            for (let BX = 0; BX < Horizontal; BX += BrickWidth) {
                const Samples = [];
                let Occupied = false;
                for (let Z = BZ; Z < Math.min(BZ + BrickWidth, Horizontal); Z++)
                    for (let Y = BY; Y < Math.min(BY + BrickWidth, Vertical); Y++)
                        for (let X = BX; X < Math.min(BX + BrickWidth, Horizontal); X++) {
                            const d = VolumeDistance(
                                Layer,
                                Region.X0 + (X + 0.5) / Horizontal * (Region.X1 - Region.X0),
                                MinY + (Y + 0.5) / Vertical * (MaxY - MinY),
                                Region.Z0 + (Z + 0.5) / Horizontal * (Region.Z1 - Region.Z0),
                                Region
                            );
                            Samples.push(d);
                            if (d < 0) Occupied = true;
                        }
                if (Occupied) Bricks.push({ Origin: [BX, BY, BZ], Samples });
            }
    return {
        Format: 'FrontierSparseSDF/1',
        Dimensions: [Horizontal, Vertical, Horizontal],
        BrickWidth, Region, VerticalBounds: [MinY, MaxY],
        SampleOrder: 'X fastest, then Y, then Z; cell centres; absent bricks are empty',
        Bricks
    };
}

// ---------- GPU Data Packer (Per-Layer SDF Compilation) ----------

export function PackGpuWorld(Layers) {
    const STROKE_CAP = 512;
    const REGION_CAP = 256;
    const PRIM_CAP = 2048;
    const SCULPT_CAP = 2048;

    const strokeData = new Float32Array(STROKE_CAP * 2 * 4);
    const regionData = new Float32Array(REGION_CAP * 4 * 4);
    const primData = new Float32Array(PRIM_CAP * 5 * 4);
    const sculptData = new Float32Array(SCULPT_CAP * 2 * 4);

    let segCursor = 0, regCursor = 0, primCursor = 0, sculptCursor = 0;
    const layerInfos = [];
    const modeMap = { union: 0, subtract: 1, intersect: 2, blend: 3 };

    // ---- Stable world bounds ------------------------------------------------------------------
    // The volume is ONE shared distance field (Unreal-style global SDF), so its box must not
    // depend on which layers happen to be visible. Derive it from every layer that still owns
    // geometry, using the analytic vertical bounds (conservative by construction, so peaks can
    // never be cut flat), then snap outward to a coarse grid so a small edit does not resample
    // the entire field underneath the user's cursor.
    const SnapXZ = 16, SnapY = 8;
    let boxMinX = Infinity, boxMaxX = -Infinity;
    let boxMinY = Infinity, boxMaxY = -Infinity;
    let boxMinZ = Infinity, boxMaxZ = -Infinity;
    for (const L of Layers) {
        if (!L.Regions?.length || !L.Strokes?.length) continue;
        for (const R of L.Regions) {
            const [lowY, highY] = LayerVerticalBounds(L, R);
            boxMinX = Math.min(boxMinX, R.X0); boxMaxX = Math.max(boxMaxX, R.X1);
            boxMinZ = Math.min(boxMinZ, R.Z0); boxMaxZ = Math.max(boxMaxZ, R.Z1);
            boxMinY = Math.min(boxMinY, Math.min(lowY, -L.Depth));
            boxMaxY = Math.max(boxMaxY, highY);
            if (R.SculptStrokes?.length) {
                for (const SS of R.SculptStrokes) {
                    if (SS.Mode === 'remove') continue;
                    for (const pt of SS.Points) boxMaxY = Math.max(boxMaxY, pt[1] + SS.Radius);
                }
            }
        }
    }
    const hasBounds = Number.isFinite(boxMinX) && Number.isFinite(boxMinY) && Number.isFinite(boxMinZ);
    if (!hasBounds) { boxMinX = -320; boxMaxX = 320; boxMinZ = -320; boxMaxZ = 320; boxMinY = -140; boxMaxY = 180; }

    // Horizontal breathing room keeps silhouettes off the volume wall.
    const padXZ = Math.max(40, (boxMaxX - boxMinX) * 0.06, (boxMaxZ - boxMinZ) * 0.06);
    boxMinX -= padXZ; boxMaxX += padXZ;
    boxMinZ -= padXZ; boxMaxZ += padXZ;
    // Vertical margin in world units (never voxel-dependent, so it cannot clip a peak).
    boxMinY = Math.min(boxMinY, -60) - 12;
    boxMaxY = Math.max(boxMaxY, 60) + 16;
    // Snap outward to a coarse grid for stability between edits.
    boxMinX = Math.floor(boxMinX / SnapXZ) * SnapXZ; boxMaxX = Math.ceil(boxMaxX / SnapXZ) * SnapXZ;
    boxMinZ = Math.floor(boxMinZ / SnapXZ) * SnapXZ; boxMaxZ = Math.ceil(boxMaxZ / SnapXZ) * SnapXZ;
    boxMinY = Math.floor(boxMinY / SnapY) * SnapY;  boxMaxY = Math.ceil(boxMaxY / SnapY) * SnapY;

    for (let li = 0; li < Layers.length; li++) {
        const L = Layers[li];
        if (!L.Visible || !L.Regions.length || !L.Strokes.length) continue;

        const segStart = segCursor;
        for (let si = 0; si < L.Strokes.length; si++) {
            const S = L.Strokes[si];
            for (let pi = 0; pi < S.Points.length; pi++) {
                if (segCursor >= STROKE_CAP) break;
                const A = S.Points[Math.max(0, pi - 1)];
                const B = S.Points[pi];
                const idx0 = segCursor * 4;
                const idx1 = (STROKE_CAP + segCursor) * 4;
                strokeData[idx0 + 0] = A[0];
                strokeData[idx0 + 1] = A[1];
                strokeData[idx0 + 2] = B[0];
                strokeData[idx0 + 3] = B[1];
                strokeData[idx1 + 0] = S.Radius;
                strokeData[idx1 + 1] = S.Erase ? 1 : 0;
                strokeData[idx1 + 2] = si;
                strokeData[idx1 + 3] = li;
                segCursor++;
            }
        }
        const segCount = segCursor - segStart;

        const regStart = regCursor;
        let layerMinX = Infinity, layerMaxX = -Infinity;
        let layerMinY = Infinity, layerMaxY = -Infinity;
        let layerMinZ = Infinity, layerMaxZ = -Infinity;

        for (const R of L.Regions) {
            if (regCursor >= REGION_CAP) break;
            const comp = CompileRegion(L, R);
            const [vy0, vy1] = LayerVerticalBounds(L, R);
            layerMinX = Math.min(layerMinX, R.X0);
            layerMaxX = Math.max(layerMaxX, R.X1);
            layerMinZ = Math.min(layerMinZ, R.Z0);
            layerMaxZ = Math.max(layerMaxZ, R.Z1);
            layerMinY = Math.min(layerMinY, vy0);
            layerMaxY = Math.max(layerMaxY, vy1);

            const primStart = primCursor;
            for (const Step of comp.Steps) {
                for (let k = 0; k < Step.Primitives.length; k++) {
                    if (primCursor >= PRIM_CAP) break;
                    const P = Step.Primitives[k];
                    const r0 = primCursor * 4;
                    const r1 = (PRIM_CAP + primCursor) * 4;
                    const r2 = (PRIM_CAP * 2 + primCursor) * 4;
                    const r3 = (PRIM_CAP * 3 + primCursor) * 4;
                    const r4 = (PRIM_CAP * 4 + primCursor) * 4;
                    primData[r0 + 0] = P.Centre[0]; primData[r0 + 1] = P.Centre[1]; primData[r0 + 2] = P.Centre[2]; primData[r0 + 3] = P.Category;
                    primData[r1 + 0] = P.Radii[0];  primData[r1 + 1] = P.Radii[1];  primData[r1 + 2] = P.Radii[2];  primData[r1 + 3] = P.Bevel || 0;
                    primData[r2 + 0] = P.Cosine;    primData[r2 + 1] = P.Sine;      primData[r2 + 2] = modeMap[Step.Mode] || 0; primData[r2 + 3] = Step.Blend || 0;
                    primData[r3 + 0] = (k === Step.Primitives.length - 1) ? 1 : 0;
                    primData[r3 + 1] = P.Detail || 0;
                    primData[r3 + 2] = P.Phase || 0;
                    primData[r3 + 3] = P.Influence !== undefined ? P.Influence : 1;
                    primData[r4 + 0] = P.VerticalFrequency || 1;
                    primCursor++;
                }
            }
            const primCount = primCursor - primStart;

            const sculptStart = sculptCursor;
            if (R.SculptStrokes?.length) {
                for (const SS of R.SculptStrokes) {
                    for (let i = 0; i < SS.Points.length; i++) {
                        if (sculptCursor >= SCULPT_CAP) break;
                        const A = SS.Points[Math.max(0, i - 1)];
                        const B = SS.Points[i];
                        const s0 = sculptCursor * 4;
                        const s1 = (SCULPT_CAP + sculptCursor) * 4;
                        sculptData[s0 + 0] = A[0]; sculptData[s0 + 1] = A[1]; sculptData[s0 + 2] = A[2]; sculptData[s0 + 3] = SS.Radius;
                        sculptData[s1 + 0] = B[0]; sculptData[s1 + 1] = B[1]; sculptData[s1 + 2] = B[2]; sculptData[s1 + 3] = SS.Mode === 'remove' ? 1 : 0;
                        sculptCursor++;
                    }
                }
            }
            const sculptCount = sculptCursor - sculptStart;

            const g0 = regCursor * 4;
            const g1 = (REGION_CAP + regCursor) * 4;
            const g2 = (REGION_CAP * 2 + regCursor) * 4;
            const g3 = (REGION_CAP * 3 + regCursor) * 4;
            regionData[g0 + 0] = R.X0; regionData[g0 + 1] = R.Z0; regionData[g0 + 2] = R.X1; regionData[g0 + 3] = R.Z1;
            regionData[g1 + 0] = R.Edge || 0; regionData[g1 + 1] = L.Depth; regionData[g1 + 2] = comp.TerrainEnabled ? 1 : 0; regionData[g1 + 3] = comp.FieldBound;
            regionData[g2 + 0] = comp.EnvelopeSlope; regionData[g2 + 1] = comp.EnvelopeTop; regionData[g2 + 2] = primStart; regionData[g2 + 3] = primCount;
            regionData[g3 + 0] = sculptStart; regionData[g3 + 1] = sculptCount; regionData[g3 + 2] = L.Caves ? 1 : 0; regionData[g3 + 3] = li;
            regCursor++;
        }

        const regCount = regCursor - regStart;
        if (regCount > 0) {
            // The shared world box is already fixed above; a hidden layer simply stops
            // contributing data while the field's resolution stays identical.
            layerInfos.push({
                layerIdx: li,
                name: L.Name,
                colorHex: L.Color,
                colorRgb: hexToRgb01(L.Color),
                segStart, segCount,
                regStart, regCount,
                caves: L.Caves ? 1 : 0,
                depth: L.Depth,
                bounds: [layerMinX, layerMinY, layerMinZ, layerMaxX, layerMaxY, layerMaxZ]
            });
        }
    }

    // Publish the stable box. Layers that are hidden or empty leave it unchanged, so the
    // global field keeps one resolution no matter what is toggled in the stack.

    return {
        layerInfos,
        worldMin: [boxMinX, boxMinY, boxMinZ],
        worldMax: [boxMaxX, boxMaxY, boxMaxZ],
        strokeData, regionData, primData, sculptData,
        STROKE_CAP, REGION_CAP, PRIM_CAP, SCULPT_CAP
    };
}

export function hexToRgb01(hex) {
    const m = /^#?([0-9a-f]{6})$/i.exec(hex || '#b9a481');
    const v = parseInt(m ? m[1] : 'b9a481', 16);
    return [((v >> 16) & 255) / 255, ((v >> 8) & 255) / 255, (v & 255) / 255];
}

// ---------- Canonical Worlds & Recipes ----------

const Palette = ['#b9a481', '#8e9890', '#b3c5cc', '#b38e76'];

export function CreateLayer(Index) {
    return {
        Name: ['Desert coast', 'Rocky isles', 'Glacial shelf'][Index] || `Mask ${String(Index + 1).padStart(2, '0')}`,
        Color: Palette[Index % Palette.length],
        Visible: true, Depth: 120, Caves: false,
        Resolution: 512, Vertical: 128, DistanceMode: 'metric',
        Landforms: [], Strokes: [], Regions: []
    };
}

export function CreateCoastalWorld() {
    const Layers = [CreateLayer(0), CreateLayer(1), CreateLayer(2)];
    Layers[0].Strokes = [
        { Points: [[-420, 80], [-380, -40], [-280, -100], [-170, -90], [-105, -20], [-130, 75], [-220, 135], [-320, 160]], Radius: 110, Erase: false },
        { Points: [[-350, 30], [-230, 25], [-170, 70]], Radius: 100, Erase: false },
        { Points: [[-180, 10], [-90, 60], [-30, 15], [30, -60]], Radius: 65, Erase: false },
        { Points: [[-180, 200], [-100, 240]], Radius: 55, Erase: false },
        { Points: [[-385, -170], [-370, -110]], Radius: 60, Erase: true }
    ];
    Layers[0].Regions = [{ X0: -560, Z0: -250, X1: 135, Z1: 335, Edge: 65 }];
    Layers[0].Landforms = [
        { ...CreateLandform('ridged-multifractal'), Name: 'Mountain ridges', Amount: 185, Scale: 1.45, InfluenceX: -0.25, InfluenceZ: -0.15, InfluenceRadius: 1.3, InfluenceFalloff: 0.95, Blend: 0, Seed: 4029 },
        { ...CreateLandform('sand-dunes'), Name: 'Coastal dunes', Amount: 48, Scale: 3.7, Azimuth: -20, InfluenceX: 0.35, InfluenceZ: 0.42, InfluenceRadius: 0.68, InfluenceFalloff: 1, Blend: 0, Seed: 8119 }
    ];
    Layers[1].Strokes = [
        { Points: [[230, 0], [285, 25], [300, 100], [240, 165]], Radius: 72, Erase: false },
        { Points: [[350, -115], [395, -85]], Radius: 38, Erase: false },
        { Points: [[150, 295], [210, 320]], Radius: 38, Erase: false }
    ];
    Layers[1].Regions = [{ X0: 65, Z0: -190, X1: 465, Z1: 395, Edge: 48 }];
    Layers[1].Landforms = [{ ...CreateLandform('fractal-ridges'), Amount: 145, Scale: 1.3, InfluenceRadius: 1.6, Blend: 0, Seed: 1771 }];
    Layers[2].Strokes = [{ Points: [[-150, -395], [-65, -440], [30, -405], [115, -430], [180, -380]], Radius: 68, Erase: false }];
    Layers[2].Regions = [{ X0: -250, Z0: -540, X1: 280, Z1: -270, Edge: 55 }];
    Layers[2].Landforms = [{ ...CreateLandform('multifractal'), Amount: 125, Scale: 2.1, InfluenceRadius: 1.4, Blend: 0, Seed: 6032 }];
    return Layers;
}

const Op = (Type, Params) => ({ ...CreateLandform(Type), ...Params });

export const LandformPresets = [
    {
        Token: 'desert-mesas', Name: 'Desert mesas', Category: 'PLATEAU / LEDGES', Color: '#b29b76',
        Description: 'Broad sandstone mesas with alternating ledges and overhanging hoodoo caps.',
        Operations: [Op('mesa', { Amount: 100, Scale: 1.5, Blend: 12 }), Op('strata', { Amount: 55, Scale: 1, Blend: 4 }), Op('stacks', { Amount: 75, Scale: 1.5, Seed: 6741 })]
    },
    {
        Token: 'alpine-ridges', Name: 'Alpine ridges', Category: 'RIDGES / UPLIFT', Color: '#929c91',
        Description: 'A seeded ridge range with subsidiary spurs and an uplifted fault shoulder.',
        Operations: [Op('fault', { Amount: 38, Scale: 1, Azimuth: -20 }), Op('ridges', { Amount: 140, Scale: 2.5, Sharpness: 0.8, Blend: 12 })]
    },
    {
        Token: 'dune-sea', Name: 'Dune sea', Category: 'AEOLIAN / DUNES', Color: '#c6ad76',
        Description: 'Two differently seeded dune populations blended into a sandy mask volume.',
        Operations: [Op('dunes', { Amount: 48, Scale: 3, Azimuth: 35, Sharpness: 0.35, Blend: 15 }), Op('dunes', { Amount: 24, Scale: 2.5, Azimuth: 70, Seed: 9181, Sharpness: 0.3, Blend: 10 })]
    },
    {
        Token: 'basalt-terraces', Name: 'Basalt terraces', Category: 'STRATA / ESCARPMENT', Color: '#7d8e87',
        Description: 'A raised escarpment and stepped beds with a true volumetric undercut.',
        Operations: [Op('fault', { Amount: 105, Azimuth: 40 }), Op('strata', { Amount: 80, Scale: 2, Blend: 3 }), Op('tunnel', { Amount: 40, Azimuth: 28, Blend: 5 })]
    },
    {
        Token: 'impact-basin', Name: 'Impact basin', Category: 'CRATER / EXCAVATION', Color: '#a09689',
        Description: 'A raised plateau excavated by deep crater bowls; subtraction operates on the 3D solid.',
        Operations: [Op('mesa', { Amount: 40, Scale: 1, Blend: 12 }), Op('craters', { Amount: 120, Scale: 1.5, Blend: 8 })]
    },
    {
        Token: 'coastal-arches', Name: 'Coastal arches', Category: 'ARCH / CAVE', Color: '#b7c9d0',
        Description: 'A standing torus sea arch above a clipped island with a cave cut through the foundation.',
        Operations: [Op('arch', { Amount: 140, Scale: 1, Blend: 8 }), Op('tunnel', { Amount: 42, Azimuth: 0, Blend: 6 })]
    }
];

export function CreatePresetSingleWorld(Token) {
    const Preset = LandformPresets.find(P => P.Token === Token);
    if (!Preset) throw Error('Unknown landform preset');
    return [{
        Name: Preset.Name, Color: Preset.Color, Visible: true, Depth: 100, Caves: false,
        Resolution: 512, Vertical: 128, DistanceMode: 'metric',
        Landforms: structuredClone(Preset.Operations),
        Strokes: [{ Points: [[-45, 0], [45, 0]], Radius: 165, Erase: false }],
        Regions: [{ X0: -225, Z0: -210, X1: 225, Z1: 210, Edge: 28 }]
    }];
}

export const TerrainExamples = [
    ['fractal', 'Fractal terrain', '#9aa58c'],
    ['multifractal', 'Multifractal terrain', '#a8a086'],
    ['ridged-multifractal', 'Ridged multifractal', '#929b9d'],
    ['badlands', 'Badlands', '#b29072'],
    ['ridge-noise', 'Ridge noise', '#8a9b85'],
    ['fractal-ridges', 'Fractal ridges', '#929798'],
    ['sand-dunes', 'Sand dunes', '#c6ad76'],
    ['craters', 'Crater field', '#a09689']
];

export function CreateTerrainWorld() {
    return TerrainExamples.map(([Type, Name, Color], Index) => {
        const X = (Index % 4 - 1.5) * 820, Z = (Math.floor(Index / 4) - 0.5) * 820;
        const Operation = { ...CreateLandform(Type), Amount: Type === 'sand-dunes' ? 85 : 180, Scale: Type === 'badlands' ? 3 : 2, Blend: 0 };
        return {
            Name, Color, Visible: true, Depth: 100, Caves: false,
            Resolution: 512, Vertical: 128, DistanceMode: 'metric',
            Landforms: Type === 'craters' ? [{ ...CreateLandform('fractal'), Amount: 90, Blend: 0 }, Operation] : [Operation],
            Strokes: [{ Points: [[X - 60, Z], [X + 60, Z]], Radius: 250, Erase: false }],
            Regions: [{ X0: X - 350, Z0: Z - 320, X1: X + 350, Z1: Z + 320, Edge: 65 }]
        };
    });
}
