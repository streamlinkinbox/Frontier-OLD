/*============================================================================================================================================
                                                          PROBETRANSPORT.SLANG
============================================================================================================================================*/
// 🧩 GPU probe cosine convolution, distance moments, octahedral irradiance interpolation and bounded diffuse bounces.

module ProbeTransport;

//------------------------------------------------------------------------------------------------------------------------
//                                                        TYPED GPU FOOTPRINTS
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

struct ProbeRay
{
    float3 Position;
    uint   SurfaceIndex;
    float3 Normal;
    uint   Material;
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

[[vk::binding(0, 0)]] StructuredBuffer<ProbeRay>         Rays;
[[vk::binding(1, 0)]] StructuredBuffer<float4>           Direct;
[[vk::binding(2, 0)]] StructuredBuffer<float>            IrradianceWeights;
[[vk::binding(3, 0)]] StructuredBuffer<float>            MomentWeights;
[[vk::binding(4, 0)]] RWStructuredBuffer<float4>         Atlas;
[[vk::binding(5, 0)]] StructuredBuffer<Receiver>         Receivers;
[[vk::binding(6, 0)]] StructuredBuffer<float>            Confidence;
[[vk::binding(7, 0)]] RWStructuredBuffer<float4>         Radiance;
[[vk::push_constant]] ConstantBuffer<TransportFootprint> Parameters;

static const uint IrradianceExtent = 8, MomentExtent = 16;
#define Extent (Parameters.Range.xyz)
#define ProbeCount (Parameters.Range.x * Parameters.Range.y * Parameters.Range.z)
#define RayCount (Parameters.Counts.w)
#define Low (Parameters.Constraints.xyz)
#define Spacing (Parameters.Constraints.w)
#define MomentOffset (ProbeCount * 64)

//------------------------------------------------------------------------------------------------------------------------
//                                                  PROBE ANGULAR CONVOLUTION
//------------------------------------------------------------------------------------------------------------------------

[shader("compute")][numthreads(64, 1, 1)] void ConvolveProbeIrradiance(uint3 DispatchCoordinate
                                                                       : SV_DispatchThreadID)
{
    const uint Index = DispatchCoordinate.x;
    if (Index >= ProbeCount * 64) return;
    const uint Probe = Index / 64, Texel = Index % 64;
    float3     Sum = float3(0);
    for (uint Ray = 0; Ray < RayCount; ++Ray)
        Sum +=
            Radiance[Parameters.Locations.x + Probe * RayCount + Ray].xyz * IrradianceWeights[Texel * RayCount + Ray];
    Atlas[Index] = float4(Sum, 1);
}

    [shader("compute")][numthreads(64, 1, 1)] void ConvolveProbeMoments(uint3 DispatchCoordinate
                                                                        : SV_DispatchThreadID)
{
    const uint Index = DispatchCoordinate.x;
    if (Index >= ProbeCount * 256) return;
    const uint Probe = Index / 256, Texel = Index % 256;
    float      Mean = 0, SquaredMean = 0;
    for (uint Ray = 0; Ray < RayCount; ++Ray)
    {
        const float Distance = Confidence[ProbeCount + Probe * RayCount + Ray],
                    Weight   = MomentWeights[Texel * RayCount + Ray];
        Mean += Weight * Distance;
        SquaredMean += Weight * Distance * Distance;
    }
    Atlas[MomentOffset + Index] = float4(Mean, SquaredMean, 0, 0);
}

//------------------------------------------------------------------------------------------------------------------------
//                                               OCTAHEDRAL LOOKUPS / MOMENT VISIBILITY
//------------------------------------------------------------------------------------------------------------------------

float SignNonzero(float Coordinate)
{
    return Coordinate < 0 ? -1.0 : 1.0;
}

float2 EncodeOctahedral(float3 Direction)
{
    Direction /= abs(Direction.x) + abs(Direction.y) + abs(Direction.z);
    if (Direction.z >= 0) return Direction.xy;
    return float2((1 - abs(Direction.y)) * SignNonzero(Direction.x), (1 - abs(Direction.x)) * SignNonzero(Direction.y));
}

uint2 WrapOctahedral(int X, int Y, uint Size)
{
    if (X < 0)
    {
        X = -X - 1;
        Y = int(Size) - 1 - Y;
    }
    if (X >= int(Size))
    {
        X = 2 * int(Size) - 1 - X;
        Y = int(Size) - 1 - Y;
    }
    if (Y < 0)
    {
        Y = -Y - 1;
        X = int(Size) - 1 - X;
    }
    if (Y >= int(Size))
    {
        Y = 2 * int(Size) - 1 - Y;
        X = int(Size) - 1 - X;
    }
    return uint2(X, Y);
}

float4 SampleOctahedral(uint   Probe,
                        uint   Size,
                        uint   Offset,
                        float3 Direction)
{
    const float2 UV       = EncodeOctahedral(Direction);
    const float2 Q        = (UV * .5 + .5) * Size - .5;
    const int2   First    = int2(floor(Q));
    const float2 Fraction = Q - float2(First);
    float4       Sum      = float4(0);
    for (uint Y = 0; Y < 2; ++Y)
        for (uint X = 0; X < 2; ++X)
        {
            const uint2 Coordinate = WrapOctahedral(First.x + int(X), First.y + int(Y), Size);
            const float Weight     = (X != 0 ? Fraction.x : 1 - Fraction.x) * (Y != 0 ? Fraction.y : 1 - Fraction.y);
            Sum += Atlas[Offset + Probe * Size * Size + Coordinate.y * Size + Coordinate.x] * Weight;
        }
    return Sum;
}

float3 ProbePosition(uint Index)
{
    return Low + float3(Index % Extent.x, (Index / Extent.x) % Extent.y, Index / (Extent.x * Extent.y)) * Spacing;
}

float3 IrradianceOverPi(float3 Position, float3 Normal)
{
    const float3 Biased = Position + Normal * .05;
    const float3 Q      = (Biased - Low) / Spacing;
    if (any(Q < -1) || any(Q > float3(Extent))) return float3(0);
    const float3 Coordinate = clamp(Q, float3(0), float3(Extent - 1));
    const uint3  First      = min(uint3(Coordinate), Extent - 2);
    const float3 Fraction   = Coordinate - float3(First);
    float3       Sum        = float3(0);
    float        Total      = 0;
    for (uint Z = 0; Z < 2; ++Z)
        for (uint Y = 0; Y < 2; ++Y)
            for (uint X = 0; X < 2; ++X)
            {
                const uint3  Cell      = First + uint3(X, Y, Z);
                const uint   Probe     = (Cell.z * Extent.y + Cell.y) * Extent.x + Cell.x;
                const float3 Delta     = ProbePosition(Probe) - Biased;
                const float  Distance  = length(Delta);
                const float3 Direction = Distance > 1e-6 ? Delta / Distance : Normal;
                float        Weight = (X != 0 ? Fraction.x : 1 - Fraction.x) * (Y != 0 ? Fraction.y : 1 - Fraction.y) *
                               (Z != 0 ? Fraction.z : 1 - Fraction.z) * Confidence[Probe];
                const float NormalWeight = max(0.0, (1 + dot(Normal, Direction)) * .5);
                Weight *= NormalWeight * NormalWeight;
                if (Parameters.Locations.w != 0)
                {
                    const float2 Sample     = SampleOctahedral(Probe, MomentExtent, MomentOffset, -Direction).xy;
                    const float  Variance   = max(0.0, Sample.y - Sample.x * Sample.x);
                    const float  Beyond     = max(0.0, Distance - Sample.x);
                    const float  Visibility = Beyond == 0 ? 1.0 : Variance / (Variance + Beyond * Beyond);
                    Weight *= Visibility * Visibility * Visibility;
                }
                if (Weight <= 0) continue;
                Sum += SampleOctahedral(Probe, IrradianceExtent, 0, Normal).xyz * Weight;
                Total += Weight;
            }
    return Total > 0 ? Sum / Total : float3(0);
}

float3 Reflectance(uint Material)
{
    switch (Material)
    {
    case 0:
        return float3(.42, .41, .39);
    case 6:
        return float3(.045, .25, .12);
    case 7:
        return float3(.035, .05, .065);
    case 8:
        return float3(.12, .13, .14);
    case 9:
        return float3(.03741);
    case 10:
        return float3(.06, .22, .62);
    case 11:
        return float3(.30, .075, .025);
    case 12:
    case 13:
    case 14:
        return float3(.8);
    case 16:
        return float3(.72, .05, .04);
    case 17:
        return float3(.05, .52, .16);
    default:
        return float3(.65, .65, .63);
    }
}

//------------------------------------------------------------------------------------------------------------------------
//                                                  GPU IMAGE / JACOBI GATHERING
//------------------------------------------------------------------------------------------------------------------------

[shader("compute")][numthreads(64, 1, 1)] void GatherProbeImage(uint3 DispatchCoordinate
                                                                : SV_DispatchThreadID)
{
    const uint Index = DispatchCoordinate.x;
    if (Index >= Parameters.Counts.y) return;
    float3 Sum = float3(0);
    for (uint Sample = 0; Sample < Parameters.Counts.z; ++Sample)
    {
        const Receiver Surface = Receivers[Index * Parameters.Counts.z + Sample];
        if (Surface.Confirmed > 0) Sum += Surface.Reflectance * IrradianceOverPi(Surface.Position, Surface.Normal);
    }
    Radiance[Parameters.Locations.z + Index] = float4(Sum / float(Parameters.Counts.z), 1);
}

    [shader("compute")][numthreads(64, 1, 1)] void BounceProbeRays(uint3 DispatchCoordinate
                                                                   : SV_DispatchThreadID)
{
    const uint Index = DispatchCoordinate.x;
    if (Index >= ProbeCount * RayCount) return;
    const ProbeRay Ray = Rays[Index];
    float3         Sum = float3(0);
    if (Ray.SurfaceIndex != 0xffffffff)
        Sum = Direct[Index].xyz + Reflectance(Ray.Material) * IrradianceOverPi(Ray.Position, Ray.Normal);
    Radiance[Parameters.Locations.y + Index] = float4(Sum, 1);
}
