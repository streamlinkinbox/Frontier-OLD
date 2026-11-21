/*============================================================================================================================================
                                                          CONETRANSPORT.SLANG
============================================================================================================================================*/
// 🧩 Directional Float32 voxel injection, ordered mip reduction, finite cone gathering and Jacobi surface relighting.

module ConeTransport;

//------------------------------------------------------------------------------------------------------------------------
//                                                   TYPED BUFFER FOOTPRINTS
//------------------------------------------------------------------------------------------------------------------------

struct Receiver
{
    float3 Position;
    float  Confirmed;
    float3 Normal;
    uint   Material;
    float3 Reflectance;
    float  Padding;
};

struct Site
{
    Receiver Surface;
    float3   Direct;
    float    Padding;
};

struct Projection
{
    uint4  CellFrontBackSigns;
    float3 ProjectedArea;
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

[[vk::binding(0, 0)]] StructuredBuffer<Site>             Sites;
[[vk::binding(1, 0)]] StructuredBuffer<Projection>       Projections;
[[vk::binding(2, 0)]] StructuredBuffer<uint>             CellOffsets;
[[vk::binding(3, 0)]] RWStructuredBuffer<float4>         Voxels;
[[vk::binding(4, 0)]] RWStructuredBuffer<float4>         Radiance;
[[vk::binding(5, 0)]] StructuredBuffer<Receiver>         Receivers;
[[vk::binding(6, 0)]] StructuredBuffer<float4>           Distances;
[[vk::binding(7, 0)]] StructuredBuffer<float4>           Directions;
[[vk::push_constant]] ConstantBuffer<TransportFootprint> Parameters;

static const uint MipOffsets[7] = {0, 1572864, 1769472, 1794048, 1797120, 1797504, 1797552};
static const uint TierTexels    = 1797558;

uint Cube(uint Extent)
{
    return Extent * Extent * Extent;
}

uint Cell(uint3 Coordinate, uint Extent)
{
    return (Coordinate.z * Extent + Coordinate.y) * Extent + Coordinate.x;
}

float4 Over(float4 Front, float4 Back)
{
    return Front + Back * (1 - Front.w);
}

//------------------------------------------------------------------------------------------------------------------------
//                                               DIRECTIONAL SURFACE PROJECTION / MIPS
//------------------------------------------------------------------------------------------------------------------------

[shader("compute")][numthreads(64, 1, 1)] void InjectDirectionalRadiance(uint3 DispatchCoordinate
                                                                         : SV_DispatchThreadID)
{
    const uint Index = DispatchCoordinate.x;
    if (Index >= 3 * Cube(64)) return;
    const uint Tier = Index / Cube(64), Local = Index % Cube(64);
    for (uint Look = 0; Look < 6; ++Look)
    {
        const uint Axis = Look / 2, Negative = Look % 2;
        float3     Accumulator = float3(0);
        float      Area        = 0;
        for (uint Slot = CellOffsets[Index]; Slot < CellOffsets[Index + 1]; ++Slot)
        {
            const Projection Tap            = Projections[Slot];
            const uint       NormalNegative = (Tap.CellFrontBackSigns.w >> Axis) & 1u;
            const uint  SurfaceIndex = NormalNegative != Negative ? Tap.CellFrontBackSigns.y : Tap.CellFrontBackSigns.z;
            const float Weight       = Tap.ProjectedArea[Axis];
            Area += Weight;
            Accumulator += Radiance[Parameters.Locations.x + SurfaceIndex].xyz * Weight;
        }
        const float Opacity = min(1.0, Area);
        Voxels[Tier * TierTexels + Local * 6 + Look] =
            float4(Area > 0 ? Accumulator * (Opacity / Area) : float3(0), Opacity);
    }
}

    [shader("compute")][numthreads(64, 1, 1)] void ReduceDirectionalMip(uint3 DispatchCoordinate
                                                                        : SV_DispatchThreadID)
{
    const uint Index = DispatchCoordinate.x, Mip = Parameters.Counts.w;
    const uint Extent = 64u >> Mip;
    if (Index >= 3 * Cube(Extent)) return;
    const uint  Tier = Index / Cube(Extent), Local = Index % Cube(Extent);
    const uint3 Coordinate = uint3(Local % Extent, (Local / Extent) % Extent, Local / (Extent * Extent));
    for (uint Look = 0; Look < 6; ++Look)
    {
        const uint Axis = Look / 2, Near = Look % 2 != 0 ? 1u : 0u;
        float4     Sum = float4(0);
        for (uint Transverse = 0; Transverse < 4; ++Transverse)
        {
            uint3      A = Coordinate * 2, B = A;
            const uint AxisU = (Axis + 1) % 3, AxisV = (Axis + 2) % 3;
            A[Axis] += Near;
            B[Axis] += 1 - Near;
            A[AxisU] += Transverse % 2;
            B[AxisU] += Transverse % 2;
            A[AxisV] += Transverse / 2;
            B[AxisV] += Transverse / 2;
            Sum += Over(Voxels[Tier * TierTexels + MipOffsets[Mip - 1] + Cell(A, Extent * 2) * 6 + Look],
                        Voxels[Tier * TierTexels + MipOffsets[Mip - 1] + Cell(B, Extent * 2) * 6 + Look]);
        }
        Voxels[Tier * TierTexels + MipOffsets[Mip] + Local * 6 + Look] = Sum * .25;
    }
}

//------------------------------------------------------------------------------------------------------------------------
//                                                    RADIANCE / DISTANCE SAMPLING
//------------------------------------------------------------------------------------------------------------------------

float3 GridLow(uint Tier)
{
    const float Spacing = .125 * float(1u << Tier);
    return float3(-32 * Spacing, -32 * Spacing, 1 - 32 * Spacing);
}

float4 SampleMip(uint   Tier,
                 uint   Mip,
                 float3 Position,
                 float3 Direction)
{
    const uint   Extent  = 64u >> Mip;
    const float  Spacing = .125 * float(1u << (Tier + Mip));
    const float3 Q       = clamp((Position - GridLow(Tier)) / Spacing - .5, float3(0), float3(Extent - 1));
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

uint Wrap(int Coordinate)
{
    return uint((Coordinate % 48 + 48) % 48);
}

uint ClipAddress(int3 Coordinate)
{
    return (Wrap(Coordinate.z) * 48 + Wrap(Coordinate.y)) * 48 + Wrap(Coordinate.x);
}

float SampleDistance(float3 Position)
{
    for (uint Tier = 0; Tier < 3; ++Tier)
    {
        const float  Spacing    = .125 * float(1u << Tier);
        const float3 Q          = Position / Spacing;
        const int3   Coordinate = int3(floor(Q));
        const int3   Origin     = Tier == 0   ? Parameters.ClipOrigin0.xyz
                                  : Tier == 1 ? Parameters.ClipOrigin1.xyz
                                              : Parameters.ClipOrigin2.xyz;
        if (any(Coordinate < Origin) || any(Coordinate + 1 >= Origin + 48)) continue;
        const float3 Fraction = Q - float3(Coordinate);
        float        Lower    = 0;
        for (uint Z = 0; Z < 2; ++Z)
            for (uint Y = 0; Y < 2; ++Y)
                for (uint X = 0; X < 2; ++X)
                {
                    const float Weight = (X != 0 ? Fraction.x : 1 - Fraction.x) *
                                         (Y != 0 ? Fraction.y : 1 - Fraction.y) *
                                         (Z != 0 ? Fraction.z : 1 - Fraction.z);
                    const float Correction = length(float3(X, Y, Z) - Fraction) * Spacing;
                    Lower +=
                        Weight * (Distances[Tier * Cube(48) + ClipAddress(Coordinate + int3(X, Y, Z))].y - Correction);
                }
        return max(0.0, Lower - 2e-5);
    }
    return 0;
}

//------------------------------------------------------------------------------------------------------------------------
//                                                 FINITE CONE TRANSPORT / JACOBI
//------------------------------------------------------------------------------------------------------------------------

float3 TraceCone(float3 Origin, float3 Direction, float Tangent)
{
    float3 Accumulator  = float3(0);
    float  Transmission = 1, Travel = Parameters.Constraints.y;
    for (uint Step = 0; Step < 192 && Travel < 24 && Transmission > 0; ++Step)
    {
        const float3 Position = Origin + Direction * Travel;
        const float  Radius   = max(.0625, Travel * Tangent);
        uint         Tier     = 0;
        for (; Tier < 2; ++Tier)
        {
            const float3 Low = GridLow(Tier), High = Low + .125 * float(1u << Tier) * 64;
            if (all(Position - Radius >= Low) && all(Position + Radius <= High)) break;
        }
        const float  Spacing = .125 * float(1u << Tier);
        const float3 Low = GridLow(Tier), High = Low + Spacing * 64;
        if (any(Position < Low) || any(Position > High)) break;
        const float Lod      = clamp(log2(2 * Radius / Spacing), 0.0, 6.0);
        const uint  Mip      = uint(Lod);
        const float Fraction = Lod - Mip;
        const float Width    = Spacing * exp2(Lod);
        if (Parameters.Locations.w != 0)
        {
            const float Floor =
                length(float3(max(0.0, abs(Position.x) - 8), max(0.0, abs(Position.y) - 8), Position.z));
            const float FilterRadius = 2.598077 * Spacing * float(1u << uint(ceil(Lod)));
            if (min(SampleDistance(Position), Floor) > FilterRadius + 2e-4)
            {
                Travel += Width * .5;
                continue;
            }
        }
        float4 Gather = SampleMip(Tier, Mip, Position, Direction);
        if (Fraction > 0 && Mip < 6)
            Gather = Gather * (1 - Fraction) + SampleMip(Tier, Mip + 1, Position, Direction) * Fraction;
        const float  Segment = Width * .5;
        const float  Opacity = 1 - pow(max(0.0, 1 - Gather.w), Segment / Width);
        const float3 Colour  = Gather.w > 0 ? Gather.xyz * (Opacity / Gather.w) : float3(0);
        Accumulator += Colour * Transmission;
        Transmission *= 1 - Opacity;
        Travel += Segment;
    }
    return Accumulator;
}

float3 IrradianceOverPi(Receiver Surface)
{
    const float3 Tangent =
        normalize(cross(abs(Surface.Normal.z) < .95 ? float3(0, 0, 1) : float3(0, 1, 0), Surface.Normal));
    const float3 Bitangent = cross(Surface.Normal, Tangent);
    float3       Sum       = float3(0);
    for (uint Cone = 0; Cone < 16; ++Cone)
    {
        const float4 Local     = Directions[Cone];
        const float3 Direction = normalize(Tangent * Local.x + Bitangent * Local.y + Surface.Normal * Local.z);
        Sum +=
            TraceCone(Surface.Position + Surface.Normal * Parameters.Constraints.x, Direction, Local.w) * (1.0 / 16.0);
    }
    return Sum;
}

[shader("compute")][numthreads(64, 1, 1)] void GatherConeImage(uint3 DispatchCoordinate
                                                               : SV_DispatchThreadID)
{
    const uint Index = DispatchCoordinate.x;
    if (Index >= Parameters.Counts.y) return;
    float3 Sum = float3(0);
    for (uint Sample = 0; Sample < Parameters.Counts.z; ++Sample)
    {
        const Receiver Surface = Receivers[Index * Parameters.Counts.z + Sample];
        if (Surface.Confirmed > 0) Sum += Surface.Reflectance * IrradianceOverPi(Surface);
    }
    Radiance[Parameters.Locations.z + Index] = float4(Sum / float(Parameters.Counts.z), 1);
}

    [shader("compute")][numthreads(64, 1, 1)] void BounceConeSites(uint3 DispatchCoordinate
                                                                   : SV_DispatchThreadID)
{
    const uint Index = DispatchCoordinate.x;
    if (Index >= Parameters.Counts.x) return;
    const Site Surface = Sites[Index];
    Radiance[Parameters.Locations.y + Index] =
        float4(Surface.Direct + Surface.Surface.Reflectance * IrradianceOverPi(Surface.Surface), 1);
}
