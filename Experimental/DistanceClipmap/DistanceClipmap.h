/*============================================================================================================================================
                                                            DISTANCECLIPMAP.H
============================================================================================================================================*/
// 🧩 Baked local facet distances and truncated toroidal distance intervals with rigid-motion dirty-region repair.

#pragma once
#include "FacetDistance.h"

namespace Frontier::DistanceClipmapExperiment
{

//------------------------------------------------------------------------------------------------------------------------
//                                                   ANALYTIC CLOSED PRIMITIVES
//------------------------------------------------------------------------------------------------------------------------

struct ClosedBox
{
    Vector   Centre{}, HalfExtent{};
    unsigned Material = 0;
};

inline float SignedBoxDistance(Vector P, const ClosedBox& Box)
{
    const Vector Q = Absolute(P - Box.Centre) - Box.HalfExtent;
    return Length(Maximum(Q, {})) + std::min(std::max({Q.X, Q.Y, Q.Z}), 0.f);
}

struct DistanceInterval
{
    float Raw = 0, Lower = 0;
};

inline float EnclosureDistance(Vector P, Vector Low, Vector High)
{
    return Length(Maximum(Maximum(Low - P, P - High), {}));
}

//------------------------------------------------------------------------------------------------------------------------
//                                                       LOCAL DISTANCE BAKE
//------------------------------------------------------------------------------------------------------------------------

class BakedFacetDistance
{
public:
    Vector                  Low{}, High{}, Spacing{};
    std::array<unsigned, 3> Extent{80, 40, 32};
    std::vector<float>      Samples;

    std::size_t Address(unsigned X, unsigned Y, unsigned Z) const
    {
        return (std::size_t(Z) * Extent[1] + Y) * Extent[0] + X;
    }

    void Bake(const FacetAtlas& Atlas)
    {
        Low     = Atlas.Low - Vector{.15f, .15f, .15f};
        High    = Atlas.High + Vector{.15f, .15f, .15f};
        Spacing = {
            (High.X - Low.X) / (Extent[0] - 1), (High.Y - Low.Y) / (Extent[1] - 1), (High.Z - Low.Z) / (Extent[2] - 1)};
        Samples.resize(std::size_t(Extent[0]) * Extent[1] * Extent[2]);
        Parallel(Extent[2],
                 [&](unsigned Z)
                 {
                     for (unsigned Y = 0; Y < Extent[1]; ++Y)
                         for (unsigned X = 0; X < Extent[0]; ++X)
                             Samples[Address(X, Y, Z)] =
                                 Atlas.Nearest(Low + Vector{X * Spacing.X, Y * Spacing.Y, Z * Spacing.Z});
                 });
    }

    DistanceInterval Sample(Vector P) const
    {
        const float Outside = EnclosureDistance(P, Low, High);
        if (Outside > 0) return {Outside, Outside};
        const Vector Coordinate{(P.X - Low.X) / Spacing.X, (P.Y - Low.Y) / Spacing.Y, (P.Z - Low.Z) / Spacing.Z};
        std::array<unsigned, 3> Cell{};
        Vector                  Fraction{};
        float*                  Fractions[] = {&Fraction.X, &Fraction.Y, &Fraction.Z};
        for (unsigned Axis = 0; Axis < 3; ++Axis)
        {
            const float Clamped = std::clamp(Coordinate[Axis], 0.f, float(Extent[Axis] - 1));
            Cell[Axis]          = std::min(unsigned(Clamped), Extent[Axis] - 2);
            *Fractions[Axis]    = Clamped - Cell[Axis];
        }
        float Raw = 0, Correction = 0;
        for (unsigned Z = 0; Z < 2; ++Z)
            for (unsigned Y = 0; Y < 2; ++Y)
                for (unsigned X = 0; X < 2; ++X)
                {
                    const float Weight = (X ? Fraction.X : 1 - Fraction.X) * (Y ? Fraction.Y : 1 - Fraction.Y) *
                                         (Z ? Fraction.Z : 1 - Fraction.Z);
                    Raw += Weight * Samples[Address(Cell[0] + X, Cell[1] + Y, Cell[2] + Z)];
                    Correction += Weight * Length(Vector{(X - Fraction.X) * Spacing.X,
                                                         (Y - Fraction.Y) * Spacing.Y,
                                                         (Z - Fraction.Z) * Spacing.Z});
                }
        // 📝 For a 1-Lipschitz unsigned distance, d(P) >= Σ w_c [d(c) - |P-c|]. FP32 margin is fixture-scale,
        //    validated against the independent production double queries; this is not an arbitrary-scale formal bound.
        return {Raw, std::max(0.f, Raw - Correction - 2e-5f)};
    }
};

//------------------------------------------------------------------------------------------------------------------------
//                                                 TOROIDAL CLIPMAP ADDRESSING
//------------------------------------------------------------------------------------------------------------------------

struct alignas(16) ClipTexel
{
    float Raw = 1, Lower = 1, SignedStatic = 1, Occupancy = 0;
};
static_assert(sizeof(ClipTexel) == 16);

class DistanceClipmap
{
public:
    static constexpr unsigned Resolution = 48;
    static constexpr unsigned LevelCount = 3;
    static constexpr float    Truncation = 1.f;
    struct Level
    {
        std::array<int, 3>     Origin{};
        float                  Spacing     = 0;
        bool                   Initialized = false;
        std::vector<ClipTexel> Texels;
    };
    std::array<Level, LevelCount>    Levels;
    const BakedFacetDistance*        Local = nullptr;
    std::vector<ClosedBox>           ClosedSurfaces;
    RigidPose                        PreviousPose{};
    bool                             PreviousInitialized = false;
    std::array<unsigned, LevelCount> Rewritten{};

    static unsigned Wrap(int Coordinate)
    {
        const int Remainder = Coordinate % int(Resolution);
        return unsigned(Remainder < 0 ? Remainder + int(Resolution) : Remainder);
    }
    static std::size_t Address(int X, int Y, int Z)
    {
        return (std::size_t(Wrap(Z)) * Resolution + Wrap(Y)) * Resolution + Wrap(X);
    }
    static bool Contains(const std::array<int, 3>& Origin, int X, int Y, int Z)
    {
        return X >= Origin[0] && Y >= Origin[1] && Z >= Origin[2] && X < Origin[0] + int(Resolution) &&
               Y < Origin[1] + int(Resolution) && Z < Origin[2] + int(Resolution);
    }
    bool Influenced(Vector P, const RigidPose& Pose) const
    {
        return EnclosureDistance(Pose.ToLocal(P), Local->Low, Local->High) <= Truncation + .001f;
    }
    ClipTexel Evaluate(Vector P, const RigidPose& Pose) const
    {
        const auto Distance = Local->Sample(Pose.ToLocal(P));
        ClipTexel  Result{std::min(Truncation, Distance.Raw), std::min(Truncation, Distance.Lower), Truncation, 0};
        for (const auto& Box : ClosedSurfaces)
        {
            const float Signed  = SignedBoxDistance(P, Box);
            Result.SignedStatic = std::min(Result.SignedStatic, Signed);
            Result.Raw          = std::min(Result.Raw, std::abs(Signed));
            Result.Lower        = std::min(Result.Lower, std::max(0.f, std::abs(Signed) - 2e-5f));
        }
        Result.Occupancy = Result.Raw < .08f ? 1.f : 0.f;
        return Result;
    }

    void Relocate(const RigidPose& Pose, Vector Focus, bool Force = false)
    {
        Require(Local && !Local->Samples.empty(), "Clipmap requires a completed local bake");
        const bool Moved = !PreviousInitialized || Pose.Translation.X != PreviousPose.Translation.X ||
                           Pose.Translation.Y != PreviousPose.Translation.Y ||
                           Pose.Translation.Z != PreviousPose.Translation.Z || Pose.Cosine != PreviousPose.Cosine ||
                           Pose.Sine != PreviousPose.Sine;
        for (unsigned Tier = 0; Tier < LevelCount; ++Tier)
        {
            auto& Grid   = Levels[Tier];
            Grid.Spacing = .125f * float(1u << Tier);
            const std::array<int, 3> NewOrigin{int(std::floor(Focus.X / Grid.Spacing)) - int(Resolution / 2),
                                               int(std::floor(Focus.Y / Grid.Spacing)) - int(Resolution / 2),
                                               int(std::floor(Focus.Z / Grid.Spacing)) - int(Resolution / 2)};
            const auto               OldOrigin = Grid.Origin;
            if (Grid.Texels.empty()) Grid.Texels.resize(std::size_t(Resolution) * Resolution * Resolution);
            unsigned RewrittenCount = 0;
            for (unsigned Z = 0; Z < Resolution; ++Z)
                for (unsigned Y = 0; Y < Resolution; ++Y)
                    for (unsigned X = 0; X < Resolution; ++X)
                    {
                        const int    WX = NewOrigin[0] + int(X), WY = NewOrigin[1] + int(Y), WZ = NewOrigin[2] + int(Z);
                        const Vector P{WX * Grid.Spacing, WY * Grid.Spacing, WZ * Grid.Spacing};
                        if (Force || !Grid.Initialized || !Contains(OldOrigin, WX, WY, WZ) ||
                            (Moved && (Influenced(P, Pose) || Influenced(P, PreviousPose))))
                        {
                            Grid.Texels[Address(WX, WY, WZ)] = Evaluate(P, Pose);
                            ++RewrittenCount;
                        }
                    }
            Rewritten[Tier]  = RewrittenCount;
            Grid.Origin      = NewOrigin;
            Grid.Initialized = true;
        }
        PreviousPose        = Pose;
        PreviousInitialized = true;
    }

    DistanceInterval Sample(Vector P, unsigned* SelectedTier = nullptr) const
    {
        for (unsigned Tier = 0; Tier < LevelCount; ++Tier)
        {
            const auto&  Grid = Levels[Tier];
            const Vector Q    = P / Grid.Spacing;
            const int    X = int(std::floor(Q.X)), Y = int(std::floor(Q.Y)), Z = int(std::floor(Q.Z));
            if (!Contains(Grid.Origin, X, Y, Z) || !Contains(Grid.Origin, X + 1, Y + 1, Z + 1)) continue;
            if (SelectedTier) *SelectedTier = Tier;
            const Vector Fraction{Q.X - X, Q.Y - Y, Q.Z - Z};
            float        Raw = 0, Lower = 0;
            for (unsigned DZ = 0; DZ < 2; ++DZ)
                for (unsigned DY = 0; DY < 2; ++DY)
                    for (unsigned DX = 0; DX < 2; ++DX)
                    {
                        const auto& Texel  = Grid.Texels[Address(X + int(DX), Y + int(DY), Z + int(DZ))];
                        const float Weight = (DX ? Fraction.X : 1 - Fraction.X) * (DY ? Fraction.Y : 1 - Fraction.Y) *
                                             (DZ ? Fraction.Z : 1 - Fraction.Z);
                        const float Correction =
                            Length(Vector{float(DX) - Fraction.X, float(DY) - Fraction.Y, float(DZ) - Fraction.Z}) *
                            Grid.Spacing;
                        Raw += Weight * Texel.Raw;
                        Lower += Weight * (Texel.Lower - Correction);
                    }
            return {Raw, std::max(0.f, Lower - 2e-5f)};
        }
        // 📝 Unknown coverage must trigger exact refinement, never be interpreted as empty space.
        if (SelectedTier) *SelectedTier = UINT32_MAX;
        return {0, 0};
    }
};

} // namespace Frontier::DistanceClipmapExperiment
