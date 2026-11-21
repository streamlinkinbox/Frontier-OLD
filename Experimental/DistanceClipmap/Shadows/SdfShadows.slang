/*============================================================================================================================================
                                                            SDFSHADOWS.SLANG
============================================================================================================================================*/
// 🧩 Signed primitive tracing, voxel penumbrae, radiance cones, Sobol sphere-cap visibility and finite 96-path SDF reference.

module SdfShadows;

//------------------------------------------------------------------------------------------------------------------------
//                                                  TYPED FLOAT32 GPU FOOTPRINTS
//------------------------------------------------------------------------------------------------------------------------

struct Primitive
{
    float3 Position;
    uint   Shape;
    float3 Extent;
    uint   Material;
};

struct Receiver
{
    float3 Position;
    float  Confirmed;
    float3 Normal;
    uint   Material;
    float3 Reflectance;
    float  Padding;
};

struct TransportFootprint
{
    uint4  Counts;
    uint4  Locations;
    int4   ClipOrigin0;
    int4   ClipOrigin1;
    int4   ClipOrigin2;
    float4 Constraints;
    uint4  Range;
    float4 Reserved;
};

struct Arrival
{
    float3 Direction;
    float  Limit;
    float  SolidAngle;
};

[[vk::binding(0, 0)]] StructuredBuffer<Primitive>        Primitives;
[[vk::binding(1, 0)]] StructuredBuffer<float4>           Palette;
[[vk::binding(2, 0)]] StructuredBuffer<float>            Distances;
[[vk::binding(3, 0)]] StructuredBuffer<float4>           Voxels;
[[vk::binding(4, 0)]] StructuredBuffer<uint>             Sobol;
[[vk::binding(5, 0)]] StructuredBuffer<Receiver>         Receivers;
[[vk::binding(6, 0)]] RWStructuredBuffer<float4>         Results;
[[vk::binding(7, 0)]] StructuredBuffer<float4>           Directions;
[[vk::push_constant]] ConstantBuffer<TransportFootprint> Parameters;

static const uint MipOffsets[7] = {0, 1572864, 1769472, 1794048, 1797120, 1797504, 1797552};
static const uint TierTexels    = 1797558;

uint Cell(uint3 Coordinate, uint Extent)
{
    return (Coordinate.z * Extent + Coordinate.y) * Extent + Coordinate.x;
}

float3 Unit(float3 Direction)
{
    const float Magnitude = sqrt(dot(Direction, Direction));
    return Magnitude > 0 ? Direction * (1 / Magnitude) : float3(0);
}

float Polarity(float Coordinate)
{
    return Coordinate < 0 ? -1.0 : 1.0;
}

void ConstructBasis(float3 Normal, out float3 Tangent, out float3 Bitangent)
{
    Tangent   = Unit(cross(abs(Normal.z) < .95 ? float3(0, 0, 1) : float3(0, 1, 0), Normal));
    Bitangent = cross(Normal, Tangent);
}

uint Avalanche(uint Bits)
{
    Bits ^= Bits >> 16;
    Bits *= 0x7feb352du;
    Bits ^= Bits >> 15;
    Bits *= 0x846ca68bu;
    return Bits ^ (Bits >> 16);
}

float2 Quadrature(uint Index, uint Pair, uint Pixel)
{
    const uint Key   = Avalanche(Pair * 0x9e3779b9u + 0x85ebca6bu) ^ Avalanche(Pixel);
    uint       First = Avalanche(Key ^ 0xa511e9b3u), Second = Avalanche(Key ^ 0x63d83595u);
    uint       Gray = Index ^ (Index >> 1), Digit = 0;
    while (Gray != 0)
    {
        if ((Gray & 1) != 0)
        {
            First ^= Sobol[Pair * 64 + Digit];
            Second ^= Sobol[Pair * 64 + 32 + Digit];
        }
        Gray >>= 1;
        ++Digit;
    }
    return float2(First >> 8, Second >> 8) * (1.0 / 16777216.0);
}

float2 AzimuthPair(float Angle)
{
    const uint  Quadrant = uint(Angle * (2.0 / 3.141592653589793) + .5);
    const float Reduced = Angle - float(Quadrant) * 1.5707963267948966, Squared = Reduced * Reduced;
    const float Sine =
        Reduced *
        (1 + Squared * (-1.0 / 6 +
                        Squared * (1.0 / 120 +
                                   Squared * (-1.0 / 5040 + Squared * (1.0 / 362880 + Squared * (-1.0 / 39916800))))));
    const float Cosine =
        1 + Squared *
                (-1.0 / 2 +
                 Squared * (1.0 / 24 + Squared * (-1.0 / 720 +
                                                  Squared * (1.0 / 40320 + Squared * (-1.0 / 3628800 +
                                                                                      Squared * (1.0 / 479001600))))));
    switch (Quadrant % 4)
    {
    case 0:
        return float2(Cosine, Sine);
    case 1:
        return float2(-Sine, Cosine);
    case 2:
        return float2(-Cosine, -Sine);
    default:
        return float2(Sine, -Cosine);
    }
}

float3 CosineDirection(float3 Normal, float2 Pair)
{
    float3 Tangent, Bitangent;
    ConstructBasis(Normal, Tangent, Bitangent);
    const float  Radius  = sqrt(Pair.x);
    const float2 Azimuth = AzimuthPair(6.283185307179586 * Pair.y);
    return Unit(Tangent * (Radius * Azimuth.x) + Bitangent * (Radius * Azimuth.y) + Normal * sqrt(1 - Pair.x));
}

//------------------------------------------------------------------------------------------------------------------------
//                                                SIGNED GEOMETRY / GEOMETRIC NORMALS
//------------------------------------------------------------------------------------------------------------------------

float PrimitiveDistance(Primitive Surface, float3 Position)
{
    const float3 Local = Position - Surface.Position;
    if (Surface.Shape == 1) return sqrt(dot(Local, Local)) - Surface.Extent.x;
    if (Surface.Shape == 2)
    {
        const float Radial   = sqrt(Local.x * Local.x + Local.y * Local.y) - Surface.Extent.x;
        const float Vertical = abs(Local.z) - Surface.Extent.z;
        return sqrt(max(Radial, 0.0) * max(Radial, 0.0) + max(Vertical, 0.0) * max(Vertical, 0.0)) +
               min(max(Radial, Vertical), 0.0);
    }
    if (Surface.Shape == 3)
    {
        const float Radial = sqrt(Local.x * Local.x + Local.y * Local.y) - Surface.Extent.x;
        return sqrt(Radial * Radial + Local.z * Local.z) - Surface.Extent.y;
    }
    const float3 Q = abs(Local) - Surface.Extent, Outside = max(Q, float3(0));
    return sqrt(dot(Outside, Outside)) + min(max(max(Q.x, Q.y), Q.z), 0.0);
}

float3 PrimitiveNormal(Primitive Surface, float3 Position)
{
    const float3 Local = Position - Surface.Position;
    if (Surface.Shape == 1) return Unit(Local);
    if (Surface.Shape == 2 || Surface.Shape == 3)
    {
        const float  Radius = sqrt(Local.x * Local.x + Local.y * Local.y);
        const float3 Radial = float3(Local.x / max(Radius, 1e-8), Local.y / max(Radius, 1e-8), 0);
        if (Surface.Shape == 3) return Unit(Radial * (Radius - Surface.Extent.x) + float3(0, 0, Local.z));
        const float X = Radius - Surface.Extent.x, Y = abs(Local.z) - Surface.Extent.z;
        if (X > 0 && Y > 0) return Unit(Radial * X + float3(0, 0, Y * Polarity(Local.z)));
        return X > Y ? Radial : float3(0, 0, Polarity(Local.z));
    }
    const float3 Q = abs(Local) - Surface.Extent, Outside = max(Q, float3(0));
    if (sqrt(dot(Outside, Outside)) > 1e-8)
        return Unit(Outside * float3(Polarity(Local.x), Polarity(Local.y), Polarity(Local.z)));
    if (Q.x > Q.y && Q.x > Q.z) return float3(Polarity(Local.x), 0, 0);
    if (Q.y > Q.z) return float3(0, Polarity(Local.y), 0);
    return float3(0, 0, Polarity(Local.z));
}

float SceneDistance(float3 Position, bool IncludeLight, out uint Nearest)
{
    float Distance = 1000;
    Nearest        = 0xffffffffu;
    for (uint Index = 0; Index < Parameters.Counts.x; ++Index)
    {
        const float Signed = PrimitiveDistance(Primitives[Index], Position);
        if (Signed < Distance)
        {
            Distance = Signed;
            Nearest  = Index;
        }
    }
    if (IncludeLight)
    {
        const float3 Delta  = Position - Palette[11].xyz;
        const float  Signed = sqrt(dot(Delta, Delta)) - Palette[11].w;
        if (Signed < Distance)
        {
            Distance = Signed;
            Nearest  = Parameters.Counts.x;
        }
    }
    return Distance;
}

Receiver SurfaceAt(float3 Position, uint Nearest)
{
    Receiver Surface  = (Receiver)0;
    Surface.Position  = Position;
    Surface.Confirmed = Nearest == Parameters.Counts.x ? 2 : 1;
    if (Surface.Confirmed == 2)
    {
        Surface.Normal = Unit(Position - Palette[11].xyz);
        return Surface;
    }
    const Primitive Geometry = Primitives[Nearest];
    Surface.Normal           = PrimitiveNormal(Geometry, Position);
    Surface.Material         = Geometry.Material;
    Surface.Reflectance      = Palette[Geometry.Material].xyz;
    if (Geometry.Material == 0)
    {
        const int Checker = int(floor(Position.x * 2)) + int(floor(Position.y * 2));
        Surface.Reflectance *= Checker % 2 == 0 ? 1.0 : .52;
    }
    return Surface;
}

Receiver TraceSdf(float3 Origin, float3 Direction)
{
    float Travel = 0;
    for (uint Step = 0; Step < 256 && Travel < 40; ++Step)
    {
        const float3 Position = Origin + Direction * Travel;
        uint         Nearest;
        const float  Signed = SceneDistance(Position, true, Nearest);
        if (Signed <= .0004) return SurfaceAt(Position, Nearest);
        Travel += Signed * .95;
    }
    return (Receiver)0;
}

float BinaryVisibility(float3 Origin, float3 Direction, float Limit)
{
    float Travel = 0;
    for (uint Step = 0; Step < 256 && Travel < Limit; ++Step)
    {
        uint        Nearest;
        const float Signed = SceneDistance(Origin + Direction * Travel, false, Nearest);
        if (Signed <= .0004) return 0;
        Travel += Signed * .95;
    }
    return Travel >= Limit ? 1.0 : 0.0;
}

//------------------------------------------------------------------------------------------------------------------------
//                                                SIGNED VOXEL CLIPMAP VISIBILITY
//------------------------------------------------------------------------------------------------------------------------

float3 DistanceLow(uint Tier)
{
    const float Width = 2 * float(1u << Tier);
    return float3(-Width, -Width, 1 - Width);
}

float4 SampleDistance(float3 Position, bool Conservative)
{
    for (uint Tier = 0; Tier < 3; ++Tier)
    {
        const float  Width = .0625 * float(1u << Tier);
        const float3 Q     = (Position - DistanceLow(Tier)) / Width;
        if (any(Q < 0) || any(Q >= 63)) continue;
        const uint3  Coordinate = uint3(Q);
        const float3 Fraction   = Q - float3(Coordinate);
        float        Raw = 0, Lower = 0;
        for (uint Z = 0; Z < 2; ++Z)
            for (uint Y = 0; Y < 2; ++Y)
                for (uint X = 0; X < 2; ++X)
                {
                    const float Weight = (X != 0 ? Fraction.x : 1 - Fraction.x) *
                                         (Y != 0 ? Fraction.y : 1 - Fraction.y) *
                                         (Z != 0 ? Fraction.z : 1 - Fraction.z);
                    const float Signed = Distances[Tier * 262144 + Cell(Coordinate + uint3(X, Y, Z), 64)];
                    Raw += Weight * Signed;
                    if (Conservative) Lower += Weight * (Signed - length(float3(X, Y, Z) - Fraction) * Width);
                }
        return float4(Raw, max(0.0, Lower - 2e-5), Width, 1);
    }
    return float4(0);
}

float HybridVisibility(float3 Origin, float3 Direction, float Limit)
{
    float Travel = 0;
    for (uint Step = 0; Step < 256 && Travel < Limit; ++Step)
    {
        const float3 Position = Origin + Direction * Travel;
        const float4 Interval = SampleDistance(Position, true);
        if (Interval.w > 0 && Interval.y > .004)
        {
            Travel += Interval.y - .0004;
            continue;
        }
        uint        Nearest;
        const float Signed = SceneDistance(Position, false, Nearest);
        if (Signed <= .00042) break;
        Travel += (Signed - .0004) * .95;
    }
    if (Travel >= Limit) return 1;
    return BinaryVisibility(Origin, Direction, Limit);
}

float ConeVisibility(float3 Origin, bool Voxel)
{
    const float3 Delta    = Palette[11].xyz - Origin;
    const float  Distance = length(Delta), Radius = Palette[11].w;
    const float3 Direction = Delta * (1 / Distance);
    const float  Tangent   = Radius / sqrt(max(1e-8, Distance * Distance - Radius * Radius));
    const float  Limit     = max(0.0, Distance - Radius - .002);
    float        Travel = 0, Visibility = 1;
    for (uint Step = 0; Step < 256 && Travel < Limit; ++Step)
    {
        const float3 Position = Origin + Direction * Travel;
        const float4 Interval = Voxel ? SampleDistance(Position, false) : float4(0);
        uint         Nearest;
        const float  Signed = Voxel && Interval.w > 0 ? Interval.x : SceneDistance(Position, false, Nearest);
        if (Signed <= .0004) return 0;
        Visibility = min(Visibility, clamp(Signed / max(.001, Travel * Tangent), 0.0, 1.0));
        Travel += max(.002, Signed * .8);
    }
    return Travel >= Limit ? Visibility : 0.0;
}

//------------------------------------------------------------------------------------------------------------------------
//                                              FINITE-SPHERE RADIOMETRY / CAP PDF
//------------------------------------------------------------------------------------------------------------------------

Arrival SphereArrival(float3 Origin, float2 Pair)
{
    const float3 Delta   = Palette[11].xyz - Origin;
    const float  Squared = dot(Delta, Delta), Radius = Palette[11].w;
    const float  Ratio  = min(.999999, Radius * Radius / Squared);
    const float  Cosine = sqrt(1 - Ratio), OneMinusCosine = Ratio / (1 + Cosine);
    const float3 Axis = Delta * (1 / sqrt(Squared));
    float3       Tangent, Bitangent;
    ConstructBasis(Axis, Tangent, Bitangent);
    const float  LocalCosine = 1 - OneMinusCosine * Pair.x;
    const float  Sine        = sqrt(max(0.0, (1 - LocalCosine) * (1 + LocalCosine)));
    const float2 Azimuth     = AzimuthPair(6.283185307179586 * Pair.y);
    Arrival      Result;
    Result.Direction       = Unit(Axis * LocalCosine + (Tangent * Azimuth.x + Bitangent * Azimuth.y) * Sine);
    const float Projection = dot(Delta, Result.Direction);
    const float Root       = sqrt(max(0.0, Projection * Projection - Squared + Radius * Radius));
    Result.Limit           = max(0.0, Projection - Root - .002);
    Result.SolidAngle      = 6.283185307179586 * OneMinusCosine;
    return Result;
}

float3 Direct(Receiver Surface, uint Mode, uint Samples, uint Pixel, uint SequenceOffset, uint Dimension)
{
    if (Parameters.Locations.w == 0 || Surface.Confirmed == 0 || Surface.Confirmed == 2) return float3(0);
    const float3 Origin     = Surface.Position + Surface.Normal * .002;
    float        Visibility = 1;
    if (Mode == 0)
    {
        const float3 Delta    = Palette[11].xyz - Origin;
        const float  Distance = length(Delta);
        Visibility            = BinaryVisibility(Origin, Delta * (1 / Distance), Distance - Palette[11].w - .002);
    }
    else if (Mode < 4)
        Visibility = ConeVisibility(Origin, Mode >= 2);
    float Integral = 0;
    for (uint Sample = 0; Sample < Samples; ++Sample)
    {
        const Arrival Light  = SphereArrival(Origin, Quadrature(Sample + SequenceOffset, Dimension, Pixel));
        const float   Cosine = max(0.0, dot(Surface.Normal, Light.Direction));
        if (Cosine <= 0) continue;
        const float SampleVisibility = Mode >= 4 ? (Mode == 4 ? HybridVisibility(Origin, Light.Direction, Light.Limit)
                                                              : BinaryVisibility(Origin, Light.Direction, Light.Limit))
                                                 : Visibility;
        Integral += Cosine * Light.SolidAngle * SampleVisibility;
    }
    return Surface.Reflectance * Palette[12].xyz * (Integral / (3.141592653589793 * Samples));
}

//------------------------------------------------------------------------------------------------------------------------
//                                                  REFLECTED-RADIANCE CONE GATHER
//------------------------------------------------------------------------------------------------------------------------

float3 RadianceLow(uint Tier)
{
    const float Width = 4 * float(1u << Tier);
    return float3(-Width, -Width, 1 - Width);
}

float4 SampleMip(uint Tier, uint Mip, float3 Position, float3 Direction)
{
    const uint   Extent  = 64u >> Mip;
    const float  Spacing = .125 * float(1u << (Tier + Mip));
    const float3 Q       = clamp((Position - RadianceLow(Tier)) / Spacing - .5, float3(0), float3(Extent - 1));
    const uint3  First = uint3(Q), Second = min(First + 1, Extent - 1);
    const float3 Fraction = Q - float3(First), AbsoluteDirection = abs(Direction);
    const float3 Weights = AbsoluteDirection / (AbsoluteDirection.x + AbsoluteDirection.y + AbsoluteDirection.z);
    const uint3  Looks   = uint3(Direction.x < 0 ? 1u : 0u, Direction.y < 0 ? 3u : 2u, Direction.z < 0 ? 5u : 4u);
    float4       Sum     = float4(0);
    for (uint Z = 0; Z < 2; ++Z)
        for (uint Y = 0; Y < 2; ++Y)
            for (uint X = 0; X < 2; ++X)
            {
                const float Weight = (X != 0 ? Fraction.x : 1 - Fraction.x) * (Y != 0 ? Fraction.y : 1 - Fraction.y) *
                                     (Z != 0 ? Fraction.z : 1 - Fraction.z);
                const uint3 Coordinate =
                    uint3(X != 0 ? Second.x : First.x, Y != 0 ? Second.y : First.y, Z != 0 ? Second.z : First.z);
                const uint Address = Tier * TierTexels + MipOffsets[Mip] + Cell(Coordinate, Extent) * 6;
                for (uint Axis = 0; Axis < 3; ++Axis)
                    Sum += Voxels[Address + Looks[Axis]] * (Weight * Weights[Axis]);
            }
    return Sum;
}

float3 TraceRadiance(float3 Origin, float3 Direction, float Tangent)
{
    float  Travel = .125, Transmission = 1;
    float3 Sum = float3(0);
    for (uint Step = 0; Step < 192 && Travel < 24 && Transmission > 0; ++Step)
    {
        const float3 Position = Origin + Direction * Travel;
        const float  Radius   = max(.0625, Travel * Tangent);
        uint         Tier     = 0;
        for (; Tier < 2; ++Tier)
        {
            const float3 Low = RadianceLow(Tier), High = Low + 8 * float(1u << Tier);
            if (all(Position - Radius >= Low) && all(Position + Radius <= High)) break;
        }
        const float  Spacing = .125 * float(1u << Tier);
        const float3 Low = RadianceLow(Tier), High = Low + Spacing * 64;
        if (any(Position < Low) || any(Position > High)) break;
        const float Lod      = clamp(log2(2 * Radius / Spacing), 0.0, 6.0);
        const uint  Mip      = uint(Lod);
        const float Fraction = Lod - Mip, Width = Spacing * exp2(Lod);
        float4      Gather = SampleMip(Tier, Mip, Position, Direction);
        if (Fraction > 0 && Mip < 6)
            Gather = Gather * (1 - Fraction) + SampleMip(Tier, Mip + 1, Position, Direction) * Fraction;
        const float Opacity = 1 - sqrt(max(0.0, 1 - Gather.w));
        if (Gather.w > 0) Sum += Gather.xyz * (Transmission * Opacity / Gather.w);
        Transmission *= 1 - Opacity;
        Travel += Width * .5;
    }
    return Sum;
}

float3 Indirect(Receiver Surface)
{
    if (Surface.Confirmed == 0 || Surface.Confirmed == 2) return float3(0);
    float3 Tangent, Bitangent;
    ConstructBasis(Surface.Normal, Tangent, Bitangent);
    float3 Sum = float3(0);
    for (uint Index = 0; Index < 16; ++Index)
    {
        const float4 Local     = Directions[Index];
        const float3 Direction = Unit(Tangent * Local.x + Bitangent * Local.y + Surface.Normal * Local.z);
        Sum += TraceRadiance(Surface.Position + Surface.Normal * .16, Direction, Local.w) * (1.0 / 16.0);
    }
    return Surface.Reflectance * Sum;
}

//------------------------------------------------------------------------------------------------------------------------
//                                               SIX EXECUTABLE RENDERING SELECTIONS
//------------------------------------------------------------------------------------------------------------------------

void IntegratePath(
    Receiver Initial, uint Sample, uint Pixel, out float3 DirectSum, out float3 IndirectSum, out float3 FirstBounce)
{
    DirectSum           = float3(0);
    IndirectSum         = float3(0);
    FirstBounce         = float3(0);
    Receiver Surface    = Initial;
    float3   Throughput = float3(1);
    for (uint Site = 0; Site < Parameters.Locations.z; ++Site)
    {
        if (Surface.Confirmed == 0) break;
        if (Surface.Confirmed == 2)
        {
            if (Site == 0 && Parameters.Locations.w != 0) DirectSum += Palette[12].xyz;
            break;
        }
        const float3 Radiance = Throughput * Direct(Surface, 5, 1, Pixel, Sample, 1 + Site * 4);
        if (Site == 0)
            DirectSum += Radiance;
        else
            IndirectSum += Radiance;
        if (Site == 1) FirstBounce += Radiance;
        if (Site + 1 == Parameters.Locations.z) break;
        const float3 Direction = CosineDirection(Surface.Normal, Quadrature(Sample, 2 + Site * 4, Pixel));
        Throughput *= Surface.Reflectance;
        Surface = TraceSdf(Surface.Position + Surface.Normal * .002, Direction);
    }
}

void RenderPixel(uint Index, uint Mode)
{
    if (Index >= Parameters.Counts.y) return;
    float3     DirectSum = float3(0), IndirectSum = float3(0), FirstBounce = float3(0);
    const uint PrimarySites = Parameters.Counts.z, Samples = Parameters.Locations.y;
    const uint Pixel = asuint(Receivers[Index * PrimarySites].Padding);
    for (uint Primary = 0; Primary < PrimarySites; ++Primary)
    {
        const Receiver Initial = Receivers[Index * PrimarySites + Primary];
        if (Initial.Confirmed == 0) continue;
        if (Mode != 5)
        {
            DirectSum += Initial.Confirmed == 2 ? (Parameters.Locations.w != 0 ? Palette[12].xyz : float3(0))
                                                : Direct(Initial, Mode, Samples, Pixel, Primary * Samples, 1);
            if (Mode == 3) IndirectSum += Indirect(Initial);
            continue;
        }
        for (uint Path = 0; Path < Samples; ++Path)
        {
            const uint Sample = Primary * Samples + Path;
            float3     DirectPath, IndirectPath, FirstPath;
            IntegratePath(Initial, Sample, Pixel, DirectPath, IndirectPath, FirstPath);
            DirectSum += DirectPath;
            IndirectSum += IndirectPath;
            FirstBounce += FirstPath;
        }
    }
    const float Divisor                      = Mode == 5 ? float(PrimarySites * Samples) : float(PrimarySites);
    Results[Index]                           = float4(DirectSum / Divisor, 1);
    Results[Parameters.Counts.y + Index]     = float4(IndirectSum / Divisor, 1);
    Results[2 * Parameters.Counts.y + Index] = float4((Mode == 3 ? IndirectSum : FirstBounce) / Divisor, 1);
}

[shader("compute")][numthreads(64, 1, 1)] void PointSdfShadow(uint3 Coordinate
                                                              : SV_DispatchThreadID) { RenderPixel(Coordinate.x, 0); }

    [shader("compute")][numthreads(64, 1, 1)] void AnalyticSdfPenumbra(uint3 Coordinate
                                                                       : SV_DispatchThreadID)
{
    RenderPixel(Coordinate.x, 1);
}

[shader("compute")][numthreads(64, 1, 1)] void VoxelSdfPenumbra(uint3 Coordinate
                                                                : SV_DispatchThreadID) { RenderPixel(Coordinate.x, 2); }

    [shader("compute")][numthreads(64, 1, 1)] void VoxelSdfConeGi(uint3 Coordinate
                                                                  : SV_DispatchThreadID)
{
    RenderPixel(Coordinate.x, 3);
}

[shader("compute")][numthreads(64, 1, 1)] void HybridSdfSphereCap(uint3 Coordinate
                                                                  : SV_DispatchThreadID)
{ RenderPixel(Coordinate.x, 4); }

    [shader("compute")][numthreads(64, 1, 1)] void ReferenceSdfPaths(uint3 Coordinate
                                                                     : SV_DispatchThreadID)
{
    RenderPixel(Coordinate.x, 5);
}

[shader("compute")][numthreads(64, 1, 1)] void InspectSdfGeometry(uint3 Coordinate
                                                                  : SV_DispatchThreadID)
{
    const uint Index = Coordinate.x;
    if (Index >= Parameters.Counts.y) return;
    const Receiver Probe   = Receivers[Index];
    const Receiver Surface = TraceSdf(Probe.Position, Probe.Normal);
    uint           Nearest;
    const float    Signed                    = SceneDistance(Probe.Position, false, Nearest);
    Results[Index]                           = float4(Surface.Position, Surface.Confirmed);
    Results[Parameters.Counts.y + Index]     = float4(Surface.Normal, Signed);
    Results[2 * Parameters.Counts.y + Index] = SampleDistance(Probe.Position, true);
}

    [shader("compute")][numthreads(64, 1, 1)] void InspectSdfPath(uint3 Coordinate
                                                                  : SV_DispatchThreadID)
{
    const uint Index = Coordinate.x;
    if (Index >= Parameters.Counts.y) return;
    const Receiver Surface = Receivers[Index];
    float3         DirectSum, IndirectSum, FirstBounce;
    IntegratePath(Surface, Surface.Material, asuint(Surface.Padding), DirectSum, IndirectSum, FirstBounce);
    Results[Index]                           = float4(DirectSum, 1);
    Results[Parameters.Counts.y + Index]     = float4(IndirectSum, 1);
    Results[2 * Parameters.Counts.y + Index] = float4(FirstBounce, 1);
}

[shader("compute")][numthreads(64, 1, 1)] void InspectSdfBounce(uint3 Coordinate
                                                                : SV_DispatchThreadID)
{
    const uint Index = Coordinate.x;
    if (Index >= Parameters.Counts.y) return;
    const Receiver Initial = Receivers[Index];
    const float3   Direction =
        CosineDirection(Initial.Normal, Quadrature(Initial.Material, Parameters.Range.y, asuint(Initial.Padding)));
    const Receiver Surface                   = TraceSdf(Initial.Position + Initial.Normal * .002, Direction);
    Results[Index]                           = float4(Direction, Surface.Confirmed);
    Results[Parameters.Counts.y + Index]     = float4(Surface.Position, Surface.Material);
    Results[2 * Parameters.Counts.y + Index] = float4(Surface.Normal, 1);
    Results[3 * Parameters.Counts.y + Index] = float4(Surface.Reflectance, 1);
}
