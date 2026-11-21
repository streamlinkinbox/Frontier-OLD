/*============================================================================================================================================
                                                         DIFFUSEPROBELATTICE.H
============================================================================================================================================*/
// 🧩 Dynamic diffuse irradiance probes with octahedral convolution, distance moments, visibility weighting and Jacobi bounces.

#pragma once
#include "DirectionalRadiance.h"
#include <type_traits>

namespace Frontier::DistanceClipmapExperiment
{

//------------------------------------------------------------------------------------------------------------------------
//                                                OCTAHEDRAL ANGULAR COORDINATES
//------------------------------------------------------------------------------------------------------------------------

inline float NonzeroSign(float Coordinate)
{
    return Coordinate < 0 ? -1.f : 1.f;
}

inline Vector DecodeOctahedral(float U, float V)
{
    Vector Direction{U, V, 1 - std::abs(U) - std::abs(V)};
    if (Direction.Z < 0)
    {
        Direction.X = (1 - std::abs(V)) * NonzeroSign(U);
        Direction.Y = (1 - std::abs(U)) * NonzeroSign(V);
    }
    return Normalize(Direction);
}

inline std::array<float, 2> EncodeOctahedral(Vector Direction)
{
    Direction = Direction / (std::abs(Direction.X) + std::abs(Direction.Y) + std::abs(Direction.Z));
    if (Direction.Z >= 0) return {Direction.X, Direction.Y};
    return {(1 - std::abs(Direction.Y)) * NonzeroSign(Direction.X),
            (1 - std::abs(Direction.X)) * NonzeroSign(Direction.Y)};
}

inline std::array<unsigned, 2> WrapOctahedral(int X, int Y, unsigned Extent)
{
    // 📝 Reflect the bilinear footprint through octahedron edge identifications, including all four corners.
    if (X < 0)
    {
        X = -X - 1;
        Y = int(Extent) - 1 - Y;
    }
    if (X >= int(Extent))
    {
        X = 2 * int(Extent) - 1 - X;
        Y = int(Extent) - 1 - Y;
    }
    if (Y < 0)
    {
        Y = -Y - 1;
        X = int(Extent) - 1 - X;
    }
    if (Y >= int(Extent))
    {
        Y = 2 * int(Extent) - 1 - Y;
        X = int(Extent) - 1 - X;
    }
    return {unsigned(X), unsigned(Y)};
}

struct ProbeDistanceMoments
{
    float Mean = 0, SquaredMean = 0;
};

struct alignas(16) DiffuseProbeRay
{
    Vector   Direction{};
    float    Distance = 24;
    Vector   Position{};
    unsigned SurfaceIndex = UINT32_MAX;
    Vector   Normal{};
    unsigned Material = 0;
};

static_assert(sizeof(DiffuseProbeRay) == 48);

//------------------------------------------------------------------------------------------------------------------------
//                                               PROBE GEOMETRY / ANGULAR CONVOLUTION
//------------------------------------------------------------------------------------------------------------------------

class DiffuseProbeLattice
{
public:
    static constexpr unsigned                IrradianceExtent = 8, MomentExtent = 16, RayCount = 512;
    static constexpr float                   MaximumTravel = 24, Spacing = .5f, NormalDisplacement = .05f;
    static constexpr std::array<unsigned, 3> Extent{33, 25, 7};
    static constexpr unsigned                ProbeCount = Extent[0] * Extent[1] * Extent[2];
    Vector                                   Low{-8, -6, .12f};
    TransportSnapshot                        Snapshot{};
    bool                                     Initialized  = false;
    unsigned                                 RefreshCount = 0;
    std::vector<DiffuseProbeRay>             Rays;
    std::vector<float>                       Confidence;
    std::vector<Vector>                      AngularDirections, Incoming, Irradiance;
    std::vector<ProbeDistanceMoments>        Moments;
    std::vector<float>                       IrradianceWeights, MomentWeights;
    float                                    MaximumCosineIntegralError = 0;

    static unsigned Address(unsigned X, unsigned Y, unsigned Z)
    {
        return (Z * Extent[1] + Y) * Extent[0] + X;
    }

    Vector Position(unsigned Index) const
    {
        return Low + Vector{float(Index % Extent[0]), float((Index / Extent[0]) % Extent[1]),
                            float(Index / (Extent[0] * Extent[1]))} *
                         Spacing;
    }

    static unsigned SurfaceAddress(const DirectionalRadianceAtlas& Cache, const SurfacePoint& Surface)
    {
        if (Surface.Vehicle) return Surface.FacetIndex + (Surface.RadiantFacing ? 0 : Cache.VehicleFaces);
        if (!Surface.Ground)
            return 2 * Cache.VehicleFaces + Surface.FacetIndex + (Surface.RadiantFacing ? 0 : Cache.StaticFaces);
        const unsigned X = std::min(63u, unsigned(std::max(0.f, (Surface.Position.X + 8) * 4)));
        const unsigned Y = std::min(63u, unsigned(std::max(0.f, (Surface.Position.Y + 8) * 4)));
        return Cache.GroundOffset() + Y * 64 + X + (Surface.RadiantFacing ? 0 : 4096);
    }

    void ConstructWeights()
    {
        AngularDirections.resize(RayCount);
        for (unsigned Index = 0; Index < RayCount / 2; ++Index)
        {
            const auto  Pair = Quadrature(Index, 12);
            const float Z = 1 - 2 * Pair[0], Radius = std::sqrt(std::max(0.f, 1 - Z * Z));
            const float φ                    = 2 * π * Pair[1];
            AngularDirections[2 * Index]     = {Radius * std::cos(φ), Radius * std::sin(φ), Z};
            AngularDirections[2 * Index + 1] = -AngularDirections[2 * Index];
        }
        for (bool Distance : {false, true})
        {
            const unsigned Size    = Distance ? MomentExtent : IrradianceExtent;
            auto&          Weights = Distance ? MomentWeights : IrradianceWeights;
            Weights.resize(Size * Size * RayCount);
            for (unsigned Texel = 0; Texel < Size * Size; ++Texel)
            {
                const Vector Direction = DecodeOctahedral(2 * (float(Texel % Size) + .5f) / Size - 1,
                                                          2 * (float(Texel / Size) + .5f) / Size - 1);
                float        Sum       = 0;
                for (unsigned Ray = 0; Ray < RayCount; ++Ray)
                {
                    const float Cosine              = std::max(0.f, Dot(Direction, AngularDirections[Ray]));
                    const float Weight              = Distance ? std::pow(Cosine, 32.f) : Cosine;
                    Weights[Texel * RayCount + Ray] = Weight;
                    Sum += Weight;
                }
                Require(Sum > 0, "Empty probe angular quadrature");
                if (!Distance)
                    MaximumCosineIntegralError = std::max(MaximumCosineIntegralError, std::abs(4 * Sum / RayCount - 1));
                // 📝 Normalize the discrete cosine rule so a constant radiance gives E/π = L exactly.
                //    This bounds the numerical transport; it does not remove angular discretization error.
                for (unsigned Ray = 0; Ray < RayCount; ++Ray)
                    Weights[Texel * RayCount + Ray] /= Sum;
            }
        }
    }

    void TraceGeometry(const RadianceScene& Scene, const DirectionalRadianceAtlas& Cache)
    {
        if (AngularDirections.empty()) ConstructWeights();
        Rays.resize(ProbeCount * RayCount);
        Confidence.assign(ProbeCount, 1);
        Parallel(ProbeCount,
                 [&](unsigned Probe)
                 {
                     const Vector Origin   = Position(Probe);
                     bool         Rejected = false;
                     for (const auto& Box : Scene.Boxes)
                         Rejected |= SignedBoxDistance(Origin, Box) < .075f;
                     Rejected |= Scene.Vehicle.Nearest(Scene.Pose.ToLocal(Origin)) < .075f;
                     unsigned ReverseCount = 0;
                     for (unsigned Ray = 0; Ray < RayCount; ++Ray)
                     {
                         const Vector Direction   = AngularDirections[Ray];
                         const auto   Surface     = Scene.Trace(Origin, Direction, MaximumTravel);
                         auto&        Destination = Rays[Probe * RayCount + Ray];
                         Destination              = {};
                         Destination.Direction    = Direction;
                         if (!Surface.Confirmed) continue;
                         ReverseCount += !Surface.RadiantFacing;
                         Destination.Distance     = Surface.Travel;
                         Destination.Position     = Surface.Position;
                         Destination.Normal       = Surface.Normal;
                         Destination.Material     = Surface.Material;
                         Destination.SurfaceIndex = SurfaceAddress(Cache, Surface);
                     }
                     // 📝 Back-face ratio is an explicit probe classification heuristic, not a solid-sign certificate for the car.
                     Rejected |= ReverseCount > RayCount / 4;
                     Confidence[Probe] = Rejected ? 0.f : 1.f;
                 });
        Moments.resize(ProbeCount * MomentExtent * MomentExtent);
        Parallel(ProbeCount,
                 [&](unsigned Probe)
                 {
                     for (unsigned Texel = 0; Texel < MomentExtent * MomentExtent; ++Texel)
                     {
                         ProbeDistanceMoments Sum{};
                         for (unsigned Ray = 0; Ray < RayCount; ++Ray)
                         {
                             const float Distance = Rays[Probe * RayCount + Ray].Distance;
                             const float Weight   = MomentWeights[Texel * RayCount + Ray];
                             Sum.Mean += Weight * Distance;
                             Sum.SquaredMean += Weight * Distance * Distance;
                         }
                         Moments[Probe * MomentExtent * MomentExtent + Texel] = Sum;
                     }
                 });
    }

    void Convolve()
    {
        Irradiance.resize(ProbeCount * IrradianceExtent * IrradianceExtent);
        Parallel(ProbeCount,
                 [&](unsigned Probe)
                 {
                     for (unsigned Texel = 0; Texel < IrradianceExtent * IrradianceExtent; ++Texel)
                     {
                         Vector Sum{};
                         for (unsigned Ray = 0; Ray < RayCount; ++Ray)
                             Sum += Incoming[Probe * RayCount + Ray] * IrradianceWeights[Texel * RayCount + Ray];
                         Irradiance[Probe * IrradianceExtent * IrradianceExtent + Texel] = Sum;
                     }
                 });
    }

    bool Refresh(const RadianceScene& Scene, const DirectionalRadianceAtlas& Cache)
    {
        Cache.RequireFresh(Scene, Cache.Snapshot.Sources);
        const auto Desired = Cache.Snapshot;
        if (Initialized && Snapshot == Desired) return false;
        if (!Initialized || !Snapshot.SamePose(Desired)) TraceGeometry(Scene, Cache);
        Incoming.resize(Rays.size());
        for (unsigned Index = 0; Index < Rays.size(); ++Index)
            Incoming[Index] =
                Rays[Index].SurfaceIndex == UINT32_MAX ? Vector{} : Cache.Sites[Rays[Index].SurfaceIndex].Direct;
        Convolve();
        Snapshot    = Desired;
        Initialized = true;
        ++RefreshCount;
        return true;
    }

    void RequireFresh(const RadianceScene& Scene, unsigned SourceMask) const
    {
        Require(Initialized && Snapshot == TransportSnapshot::Capture(Scene, SourceMask, Snapshot.Samples),
                "Stale diffuse probes: refresh after pose or light change");
    }

    //------------------------------------------------------------------------------------------------------------------------
    //                                               VISIBILITY-WEIGHTED PROBE INTERPOLATION
    //------------------------------------------------------------------------------------------------------------------------

    template <class TexelType>
    static TexelType SampleOctahedral(const std::vector<TexelType>& Atlas,
                                      unsigned                      Probe,
                                      unsigned                      Size,
                                      Vector                        Direction)
    {
        const auto  UV = EncodeOctahedral(Direction);
        const float X = (UV[0] * .5f + .5f) * Size - .5f, Y = (UV[1] * .5f + .5f) * Size - .5f;
        const int   IX = int(std::floor(X)), IY = int(std::floor(Y));
        const float FX = X - IX, FY = Y - IY;
        TexelType   Sum{};
        for (unsigned DY = 0; DY < 2; ++DY)
            for (unsigned DX = 0; DX < 2; ++DX)
            {
                const auto  Coordinate = WrapOctahedral(IX + int(DX), IY + int(DY), Size);
                const float Weight     = (DX ? FX : 1 - FX) * (DY ? FY : 1 - FY);
                const auto& Texel      = Atlas[Probe * Size * Size + Coordinate[1] * Size + Coordinate[0]];
                if constexpr (std::is_same_v<TexelType, Vector>)
                    Sum += Texel * Weight;
                else
                {
                    Sum.Mean += Texel.Mean * Weight;
                    Sum.SquaredMean += Texel.SquaredMean * Weight;
                }
            }
        return Sum;
    }

    Vector IrradianceOverPi(Vector Position, Vector Normal, bool MomentVisibility = true) const
    {
        const Vector            Biased = Position + Normal * NormalDisplacement;
        const Vector            Q      = (Biased - Low) / Spacing;
        std::array<unsigned, 3> First{};
        std::array<float, 3>    Fraction{};
        for (unsigned Axis = 0; Axis < 3; ++Axis)
        {
            if (Q[Axis] < -1 || Q[Axis] > Extent[Axis]) return {};
            const float Coordinate = std::clamp(Q[Axis], 0.f, float(Extent[Axis] - 1));
            First[Axis]            = std::min(unsigned(Coordinate), Extent[Axis] - 2);
            Fraction[Axis]         = Coordinate - First[Axis];
        }
        Vector Sum{};
        float  Total = 0;
        for (unsigned Z = 0; Z < 2; ++Z)
            for (unsigned Y = 0; Y < 2; ++Y)
                for (unsigned X = 0; X < 2; ++X)
                {
                    const unsigned Probe     = Address(First[0] + X, First[1] + Y, First[2] + Z);
                    const Vector   Delta     = this->Position(Probe) - Biased;
                    const float    Distance  = Length(Delta);
                    const Vector   Direction = Distance > 1e-6f ? Delta / Distance : Normal;
                    float          Weight = (X ? Fraction[0] : 1 - Fraction[0]) * (Y ? Fraction[1] : 1 - Fraction[1]) *
                                   (Z ? Fraction[2] : 1 - Fraction[2]) * Confidence[Probe];
                    const float NormalWeight = std::max(0.f, (1 + Dot(Normal, Direction)) * .5f);
                    Weight *= NormalWeight * NormalWeight;
                    if (MomentVisibility)
                    {
                        const auto  Sample     = SampleOctahedral(Moments, Probe, MomentExtent, -Direction);
                        const float Variance   = std::max(0.f, Sample.SquaredMean - Sample.Mean * Sample.Mean);
                        const float Beyond     = std::max(0.f, Distance - Sample.Mean);
                        const float Visibility = Beyond == 0 ? 1.f : Variance / (Variance + Beyond * Beyond);
                        Weight *= Visibility * Visibility * Visibility;
                    }
                    if (Weight <= 0) continue;
                    Sum += SampleOctahedral(Irradiance, Probe, IrradianceExtent, Normal) * Weight;
                    Total += Weight;
                }
        return Total > 0 ? Sum / Total : Vector{};
    }

    Vector Indirect(const RadianceScene& Scene,
                    const SurfacePoint&  Surface,
                    unsigned             SourceMask,
                    bool                 MomentVisibility = true) const
    {
        RequireFresh(Scene, SourceMask);
        return EvaluateMaterial(Surface.Material).Reflectance *
               IrradianceOverPi(Surface.Position, Surface.Normal, MomentVisibility);
    }

    float Bounce(const RadianceScene& Scene, const DirectionalRadianceAtlas& Cache)
    {
        RequireFresh(Scene, Cache.Snapshot.Sources);
        std::vector<Vector> Next(Incoming.size());
        Parallel(unsigned(Rays.size()),
                 [&](unsigned Index)
                 {
                     const auto& Ray = Rays[Index];
                     if (Ray.SurfaceIndex == UINT32_MAX) return;
                     Next[Index] =
                         Cache.Sites[Ray.SurfaceIndex].Direct +
                         EvaluateMaterial(Ray.Material).Reflectance * IrradianceOverPi(Ray.Position, Ray.Normal);
                 });
        float Residual = 0;
        for (unsigned Index = 0; Index < Incoming.size(); ++Index)
            Residual =
                std::max({Residual, std::abs(Next[Index].X - Incoming[Index].X),
                          std::abs(Next[Index].Y - Incoming[Index].Y), std::abs(Next[Index].Z - Incoming[Index].Z)});
        Incoming.swap(Next);
        Convolve();
        return Residual;
    }
};

} // namespace Frontier::DistanceClipmapExperiment
