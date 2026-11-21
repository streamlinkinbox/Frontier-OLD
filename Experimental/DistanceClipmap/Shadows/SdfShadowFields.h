/*============================================================================================================================================
                                                          SDFSHADOWFIELDS.H
============================================================================================================================================*/
// 🧩 Three signed voxel levels, conservative hybrid visibility and reflected-radiance cones for the analytic calibration room.

#pragma once
#include "SdfShadowScene.h"

namespace Frontier::DistanceClipmapExperiment
{

//------------------------------------------------------------------------------------------------------------------------
//                                                 SIGNED DISTANCE CLIP LEVELS
//------------------------------------------------------------------------------------------------------------------------

struct ShadowInterval
{
    float Raw = 0, Lower = 0, Spacing = 0;
    bool  Known = false;
};

class SdfShadowFields
{
public:
    static constexpr unsigned Extent = 64;
    static constexpr unsigned Cells  = Extent * Extent * Extent;
    std::vector<float>        Distances;
    DirectionalRadianceAtlas  Cones;
    std::uint64_t             Signature   = 0;
    bool                      Initialized = false;

    static float Spacing(unsigned Tier)
    {
        return .0625f * float(1u << Tier);
    }

    static Vector Low(unsigned Tier)
    {
        const float Width = 32 * Spacing(Tier);
        return {-Width, -Width, 1 - Width};
    }

    static std::uint64_t Fingerprint(const SdfShadowScene& Scene)
    {
        std::uint64_t Digest     = 14695981039346656037ull;
        auto          Accumulate = [&](const void* Bytes, std::size_t Count)
        {
            const auto* Octets = static_cast<const unsigned char*>(Bytes);
            for (std::size_t Index = 0; Index < Count; ++Index)
            {
                Digest ^= Octets[Index];
                Digest *= 1099511628211ull;
            }
        };
        Accumulate(Scene.Primitives.data(), Scene.Primitives.size() * sizeof(ShadowPrimitive));
        Accumulate(Scene.Palette.data(), Scene.Palette.size() * sizeof(ShadowFloat4));
        const unsigned Enabled = Scene.SourceEnabled;
        Accumulate(&Enabled, sizeof(Enabled));
        return Digest;
    }

    void RequireFresh(const SdfShadowScene& Scene) const
    {
        Require(Initialized && Signature == Fingerprint(Scene),
                "Refresh SDF/radiance after geometry or source changes");
    }

    ShadowInterval Sample(Vector Position, bool Conservative = false) const
    {
        for (unsigned Tier = 0; Tier < 3; ++Tier)
        {
            const float  Width = Spacing(Tier);
            const Vector Q     = (Position - Low(Tier)) / Width;
            if (Q.X < 0 || Q.Y < 0 || Q.Z < 0 || Q.X >= 63 || Q.Y >= 63 || Q.Z >= 63) continue;
            const unsigned X = unsigned(Q.X), Y = unsigned(Q.Y), Z = unsigned(Q.Z);
            const Vector   Fraction = Q - Vector{float(X), float(Y), float(Z)};
            float          Raw = 0, Lower = 0;
            for (unsigned DZ = 0; DZ < 2; ++DZ)
                for (unsigned DY = 0; DY < 2; ++DY)
                    for (unsigned DX = 0; DX < 2; ++DX)
                    {
                        const float Weight = (DX ? Fraction.X : 1 - Fraction.X) * (DY ? Fraction.Y : 1 - Fraction.Y) *
                                             (DZ ? Fraction.Z : 1 - Fraction.Z);
                        const float Signed =
                            Distances[Tier * Cells + DirectionalRadianceAtlas::Cell(X + DX, Y + DY, Z + DZ, 64)];
                        Raw += Weight * Signed;
                        if (Conservative)
                            Lower += Weight * (Signed - Length(Vector{float(DX) - Fraction.X, float(DY) - Fraction.Y,
                                                                      float(DZ) - Fraction.Z}) *
                                                            Width);
                    }
            return {Raw, std::max(0.f, Lower - 2e-5f), Width, true};
        }
        return {};
    }

    float HybridVisibility(const SdfShadowScene& Scene,
                           Vector                Origin,
                           Vector                Direction,
                           float                 Limit,
                           unsigned*             ClipSkips   = nullptr,
                           unsigned*             Refinements = nullptr) const
    {
        float Travel = 0;
        for (unsigned Step = 0; Step < SdfShadowScene::MarchLimit && Travel < Limit; ++Step)
        {
            const Vector Position = Origin + Direction * Travel;
            const auto   Interval = Sample(Position, true);
            if (Interval.Known && Interval.Lower > .004f)
            {
                if (ClipSkips) ++*ClipSkips;
                Travel += Interval.Lower - SdfShadowScene::HitTolerance;
                continue;
            }
            const float Signed = Scene.Distance(Position, false).Distance;
            if (Signed <= SdfShadowScene::HitTolerance + 2e-5f) break;
            Travel += (Signed - SdfShadowScene::HitTolerance) * .95f;
        }
        if (Travel >= Limit) return 1;
        // 📝 The hit tolerance defines a finite geometry bias. Different march sites must not silently change it:
        //    proximity/exhaustion refines the original SDF segment, not an advanced origin or a triangle query.
        if (Refinements) ++*Refinements;
        return Scene.BinaryVisibility(Origin, Direction, Limit);
    }

    float ConeVisibility(const SdfShadowScene& Scene, Vector Origin, bool Voxel) const
    {
        const Vector Delta    = Scene.LightCenter() - Origin;
        const float  Distance = Length(Delta), Radius = Scene.LightRadius();
        const Vector Direction = Delta / Distance;
        const float  Tangent   = Radius / std::sqrt(std::max(1e-8f, Distance * Distance - Radius * Radius));
        const float  Limit     = std::max(0.f, Distance - Radius - SdfShadowScene::SurfaceOffset);
        float        Travel = 0, Visibility = 1;
        for (unsigned Step = 0; Step < SdfShadowScene::MarchLimit && Travel < Limit; ++Step)
        {
            const Vector Position = Origin + Direction * Travel;
            const auto   Interval = Voxel ? Sample(Position) : ShadowInterval{};
            // 📝 Unknown field coverage uses analytic geometry, never a fabricated empty-space value.
            const float Signed = Voxel && Interval.Known ? Interval.Raw : Scene.Distance(Position, false).Distance;
            if (Signed <= SdfShadowScene::HitTolerance) return 0;
            Visibility = std::min(Visibility, std::clamp(Signed / std::max(.001f, Travel * Tangent), 0.f, 1.f));
            Travel += std::max(.002f, Signed * .8f);
        }
        return Travel >= Limit ? Visibility : 0.f;
    }

    Vector Direct(const SdfShadowScene& Scene,
                  const ShadowSurface&  Surface,
                  unsigned              Mode,
                  unsigned              Samples        = 64,
                  unsigned              Pixel          = 0,
                  unsigned              SequenceOffset = 0,
                  unsigned              Dimension      = 1) const
    {
        if (!Scene.SourceEnabled || !Surface.Confirmed || Surface.Light) return {};
        const Vector Origin     = Surface.Position + Surface.Normal * SdfShadowScene::SurfaceOffset;
        float        Visibility = 1;
        if (Mode == 0)
        {
            const Vector Delta    = Scene.LightCenter() - Origin;
            const float  Distance = Length(Delta);
            Visibility = Scene.BinaryVisibility(Origin, Delta / Distance, Distance - Scene.LightRadius() - .002f);
        }
        else if (Mode < 4)
            Visibility = ConeVisibility(Scene, Origin, Mode >= 2);
        float Integral = 0;
        for (unsigned Sample = 0; Sample < Samples; ++Sample)
        {
            const auto  Arrival = Scene.Arrival(Origin, Quadrature(Sample + SequenceOffset, Dimension, Pixel));
            const float Cosine  = std::max(0.f, Dot(Surface.Normal, Arrival.Direction));
            if (Cosine <= 0) continue;
            const float SampleVisibility =
                Mode >= 4 ? (Mode == 4 ? HybridVisibility(Scene, Origin, Arrival.Direction, Arrival.Limit)
                                       : Scene.BinaryVisibility(Origin, Arrival.Direction, Arrival.Limit))
                          : Visibility;
            Integral += Cosine * Arrival.SolidAngle * SampleVisibility;
        }
        return Surface.Reflectance * Scene.LightRadiance() * (Integral / (π * Samples));
    }

    //------------------------------------------------------------------------------------------------------------------------
    //                                        SHARED DIRECTIONAL-RADIANCE ATLAS CONSTRUCTION
    //------------------------------------------------------------------------------------------------------------------------

    void ConstructRadiance(const SdfShadowScene& Scene)
    {
        unsigned Offset = 0;
        for (unsigned Tier = 0; Tier < 3; ++Tier)
        {
            auto& Grid   = Cones.Grids[Tier];
            Grid.Spacing = .125f * float(1u << Tier);
            Grid.Low     = {-32 * Grid.Spacing, -32 * Grid.Spacing, 1 - 32 * Grid.Spacing};
            for (unsigned Mip = 0; Mip < 7; ++Mip)
            {
                Grid.Offsets[Mip] = Offset;
                Offset += DirectionalRadianceAtlas::Cube(64u >> Mip) * 6;
            }
        }
        Cones.Voxels.resize(Offset);
        Cones.Taps.clear();
        Cones.Radiance.clear();
        Cones.CellOffsets.resize(3 * Cells + 1);
        for (unsigned Index = 0; Index < 3 * Cells; ++Index)
        {
            Cones.CellOffsets[Index] = unsigned(Cones.Taps.size());
            const unsigned Tier = Index / Cells, Local = Index % Cells;
            const auto&    Grid = Cones.Grids[Tier];
            const Vector   Position =
                Grid.Low + Vector{float(Local % 64) + .5f, float((Local / 64) % 64) + .5f, float(Local / 4096) + .5f} *
                               Grid.Spacing;
            const auto  Nearest = Scene.Distance(Position, true);
            const float Band    = .866025404f * Grid.Spacing;
            if (std::abs(Nearest.Distance) >= Band) continue;
            auto Surface         = Scene.Surface(Position, Nearest.Primitive);
            Surface.Position     = Position - Surface.Normal * Nearest.Distance;
            Surface              = Scene.Surface(Surface.Position, Nearest.Primitive);
            const unsigned Front = unsigned(Cones.Radiance.size());
            Cones.Radiance.push_back(Direct(Scene, Surface, 2, 64));
            Cones.Radiance.push_back({});
            const auto     N        = Surface.Normal;
            const unsigned Signs    = (N.X < 0 ? 1u : 0u) | (N.Y < 0 ? 2u : 0u) | (N.Z < 0 ? 4u : 0u);
            const float    Coverage = 1 - std::abs(Nearest.Distance) / Band;
            Cones.Taps.push_back({Index, Front, Front + 1, Signs, Absolute(N) * Coverage});
        }
        Cones.CellOffsets.back() = unsigned(Cones.Taps.size());
        Cones.Inject();
        for (unsigned Ring = 0; Ring < 2; ++Ring)
            for (unsigned Sector = 0; Sector < 8; ++Sector)
            {
                const unsigned Index  = Ring * 8 + Sector;
                const float    Radial = (Ring + .5f) / 2, φ = 2 * π * (Sector + .5f * (Ring % 2)) / 8;
                Cones.ConeDirections[Index] = {std::sqrt(Radial) * std::cos(φ), std::sqrt(Radial) * std::sin(φ),
                                               std::sqrt(1 - Radial)};
                Cones.ConeWeights[Index]    = 1.f / 16;
                const float SolidAngle =
                    2 * π * (std::sqrt(1 - float(Ring) / 2) - std::sqrt(1 - float(Ring + 1) / 2)) / 8;
                const float Cosine        = 1 - SolidAngle / (2 * π);
                Cones.ConeTangents[Index] = std::sqrt(1 - Cosine * Cosine) / Cosine;
            }
    }

    bool Refresh(const SdfShadowScene& Scene)
    {
        const auto Desired = Fingerprint(Scene);
        if (Initialized && Desired == Signature) return false;
        Distances.resize(3 * Cells);
        Parallel(3 * 64,
                 [&](unsigned Row)
                 {
                     const unsigned Tier = Row / 64, Z = Row % 64;
                     for (unsigned Y = 0; Y < 64; ++Y)
                         for (unsigned X = 0; X < 64; ++X)
                             Distances[Tier * Cells + DirectionalRadianceAtlas::Cell(X, Y, Z, 64)] =
                                 Scene.Distance(Low(Tier) + Vector{float(X), float(Y), float(Z)} * Spacing(Tier), false)
                                     .Distance;
                 });
        ConstructRadiance(Scene);
        Signature   = Desired;
        Initialized = true;
        return true;
    }

    //------------------------------------------------------------------------------------------------------------------------
    //                                                  REFLECTED-RADIANCE CONES
    //------------------------------------------------------------------------------------------------------------------------

    Vector TraceRadiance(Vector Origin, Vector Direction, float Tangent) const
    {
        float  Travel = .125f, Transmission = 1;
        Vector Sum{};
        for (unsigned Step = 0; Step < 192 && Travel < 24 && Transmission > 0; ++Step)
        {
            const Vector Position = Origin + Direction * Travel;
            const float  Radius   = std::max(.0625f, Travel * Tangent);
            unsigned     Tier     = 0;
            for (; Tier < 2; ++Tier)
            {
                const auto&  Grid = Cones.Grids[Tier];
                const Vector High = Grid.Low + Vector{64, 64, 64} * Grid.Spacing;
                if (Position.X - Radius >= Grid.Low.X && Position.Y - Radius >= Grid.Low.Y &&
                    Position.Z - Radius >= Grid.Low.Z && Position.X + Radius <= High.X &&
                    Position.Y + Radius <= High.Y && Position.Z + Radius <= High.Z)
                    break;
            }
            const auto&  Grid = Cones.Grids[Tier];
            const Vector High = Grid.Low + Vector{64, 64, 64} * Grid.Spacing;
            if (Position.X < Grid.Low.X || Position.Y < Grid.Low.Y || Position.Z < Grid.Low.Z || Position.X > High.X ||
                Position.Y > High.Y || Position.Z > High.Z)
                break;
            const float    Lod      = std::clamp(std::log2(2 * Radius / Grid.Spacing), 0.f, 6.f);
            const unsigned Mip      = unsigned(Lod);
            const float    Fraction = Lod - Mip, Width = Grid.Spacing * std::exp2(Lod);
            auto           Gather = Cones.SampleMip(Tier, Mip, Position, Direction);
            if (Fraction > 0 && Mip < 6)
                Gather = Gather * (1 - Fraction) + Cones.SampleMip(Tier, Mip + 1, Position, Direction) * Fraction;
            const float Opacity = 1 - std::sqrt(std::max(0.f, 1 - Gather.Opacity));
            if (Gather.Opacity > 0) Sum += Gather.Radiance * (Transmission * Opacity / Gather.Opacity);
            Transmission *= 1 - Opacity;
            Travel += Width * .5f;
        }
        return Sum;
    }

    Vector Indirect(const ShadowSurface& Surface) const
    {
        if (!Surface.Confirmed || Surface.Light) return {};
        Vector Tangent{}, Bitangent{};
        ConstructBasis(Surface.Normal, Tangent, Bitangent);
        Vector Sum{};
        for (unsigned Index = 0; Index < 16; ++Index)
        {
            const auto   Local     = Cones.ConeDirections[Index];
            const Vector Direction = Normalize(Tangent * Local.X + Bitangent * Local.Y + Surface.Normal * Local.Z);
            Sum += TraceRadiance(Surface.Position + Surface.Normal * .16f, Direction, Cones.ConeTangents[Index]) *
                   (1.f / 16);
        }
        return Surface.Reflectance * Sum;
    }
};

} // namespace Frontier::DistanceClipmapExperiment
