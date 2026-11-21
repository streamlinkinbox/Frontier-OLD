/*============================================================================================================================================
                                                        DIRECTIONALRADIANCE.H
============================================================================================================================================*/
// 🧩 Directional Float32 radiance voxels, ordered opacity mip reduction and bounded iterative diffuse cone transport.

#pragma once
#include "TransportSnapshot.h"

namespace Frontier::DistanceClipmapExperiment
{

//------------------------------------------------------------------------------------------------------------------------
//                                                  DIRECTIONAL RADIANCE FOOTPRINTS
//------------------------------------------------------------------------------------------------------------------------

struct alignas(16) RadianceOpacity
{
    Vector Radiance{};
    float  Opacity = 0;
};

inline RadianceOpacity operator+(RadianceOpacity A, RadianceOpacity B)
{
    return {A.Radiance + B.Radiance, A.Opacity + B.Opacity};
}

inline RadianceOpacity operator*(RadianceOpacity A, float Weight)
{
    return {A.Radiance * Weight, A.Opacity * Weight};
}

inline RadianceOpacity Over(RadianceOpacity Front, RadianceOpacity Back)
{
    return {Front.Radiance + Back.Radiance * (1 - Front.Opacity), Front.Opacity + Back.Opacity * (1 - Front.Opacity)};
}

struct alignas(16) SurfaceProjection
{
    unsigned Cell = 0, Front = 0, Back = 0, Signs = 0;
    Vector   ProjectedArea{};
    float    Padding = 0;
};

struct DiffuseSite
{
    SurfacePoint Surface{};
    Vector       Direct{};
};

struct RadianceLevel
{
    Vector                  Low{};
    float                   Spacing = 0;
    std::array<unsigned, 7> Offsets{};
};

//------------------------------------------------------------------------------------------------------------------------
//                                                  VOXEL PROJECTION / CONE TRANSPORT
//------------------------------------------------------------------------------------------------------------------------

class DirectionalRadianceAtlas
{
public:
    static constexpr unsigned      Resolution         = 64;
    static constexpr float         MaximumReflectance = .8f;
    std::array<RadianceLevel, 3>   Grids;
    std::vector<DiffuseSite>       Sites;
    std::vector<Vector>            Radiance;
    std::vector<SurfaceProjection> Taps;
    std::vector<unsigned>          CellOffsets;
    std::vector<RadianceOpacity>   Voxels;
    unsigned                       VehicleFaces = 0, StaticFaces = 0;
    TransportSnapshot              Snapshot{};
    std::uint64_t                  GeometrySignature = 0;
    unsigned                       RefreshCount      = 0;
    bool                           Initialized       = false;
    std::array<Vector, 16>         ConeDirections{};
    std::array<float, 16>          ConeWeights{}, ConeTangents{};
    unsigned                       ConeCount = 16;

    // 📝 The finite cone transport is a spatial/angular approximation, not exact path integration.
    //    The 0.125 m normal displacement / 0.25 m initial travel exclude self voxels but lose near-field paths.
    static constexpr float NormalDisplacement = .125f, InitialTravel = .25f;

    static unsigned Cube(unsigned Extent)
    {
        return Extent * Extent * Extent;
    }

    static unsigned Cell(unsigned X,
                         unsigned Y,
                         unsigned Z,
                         unsigned Extent)
    {
        return (Z * Extent + Y) * Extent + X;
    }

    unsigned GroundOffset() const
    {
        return 2 * (VehicleFaces + StaticFaces);
    }

    static std::vector<Vector> ClipPolygon(std::vector<Vector> Polygon,
                                           unsigned            Axis,
                                           float               Boundary,
                                           bool                Greater)
    {
        std::vector<Vector> Output;
        if (Polygon.empty()) return Output;
        Vector Previous         = Polygon.back();
        float  PreviousDistance = (Previous[Axis] - Boundary) * (Greater ? 1.f : -1.f);
        for (Vector Position : Polygon)
        {
            const float Distance = (Position[Axis] - Boundary) * (Greater ? 1.f : -1.f);
            if ((Distance >= 0) != (PreviousDistance >= 0))
                Output.push_back(Previous + (Position - Previous) * (PreviousDistance / (PreviousDistance - Distance)));
            if (Distance >= 0) Output.push_back(Position);
            Previous         = Position;
            PreviousDistance = Distance;
        }
        return Output;
    }

    static std::pair<float, Vector> ClippedArea(const Facet& Triangle, Vector Low, float Spacing)
    {
        std::vector<Vector> Polygon(Triangle.Corner.begin(), Triangle.Corner.end());
        for (unsigned Axis = 0; Axis < 3; ++Axis)
        {
            Polygon = ClipPolygon(std::move(Polygon), Axis, Low[Axis], true);
            Polygon = ClipPolygon(std::move(Polygon), Axis, Low[Axis] + Spacing, false);
        }
        if (Polygon.size() < 3) return {};
        float  Area = 0;
        Vector Centroid{};
        for (unsigned Index = 1; Index + 1 < Polygon.size(); ++Index)
        {
            const float Piece = .5f * Length(Cross(Polygon[Index] - Polygon[0], Polygon[Index + 1] - Polygon[0]));
            Area += Piece;
            Centroid += (Polygon[0] + Polygon[Index] + Polygon[Index + 1]) * (Piece / 3);
        }
        return {Area, Area > 0 ? Centroid / Area : Vector{}};
    }

    void AppendTriangle(const Facet& Triangle,
                        unsigned     Front,
                        unsigned     Back,
                        bool         Ground)
    {
        const Vector N =
            Normalize(Cross(Triangle.Corner[1] - Triangle.Corner[0], Triangle.Corner[2] - Triangle.Corner[0]));
        const Vector Low  = Minimum(Minimum(Triangle.Corner[0], Triangle.Corner[1]), Triangle.Corner[2]);
        const Vector High = Maximum(Maximum(Triangle.Corner[0], Triangle.Corner[1]), Triangle.Corner[2]);
        for (unsigned Tier = 0; Tier < 3; ++Tier)
        {
            const auto&        Grid = Grids[Tier];
            std::array<int, 3> First{}, Last{};
            bool               Outside = false;
            for (unsigned Axis = 0; Axis < 3; ++Axis)
            {
                First[Axis] = std::max(0, int(std::floor((Low[Axis] - Grid.Low[Axis]) / Grid.Spacing)));
                Last[Axis]  = std::min(63, int(std::floor((High[Axis] - Grid.Low[Axis]) / Grid.Spacing)));
                Outside |= First[Axis] > Last[Axis];
            }
            if (Outside) continue;
            for (int Z = First[2]; Z <= Last[2]; ++Z)
                for (int Y = First[1]; Y <= Last[1]; ++Y)
                    for (int X = First[0]; X <= Last[0]; ++X)
                    {
                        const auto [Area, Centroid] = ClippedArea(
                            Triangle, Grid.Low + Vector{float(X), float(Y), float(Z)} * Grid.Spacing, Grid.Spacing);
                        if (Area < 1e-12f) continue;
                        unsigned SurfaceFront = Front, SurfaceBack = Back;
                        if (Ground)
                        {
                            const unsigned GX = std::min(63u, unsigned(std::max(0.f, (Centroid.X + 8) * 4)));
                            const unsigned GY = std::min(63u, unsigned(std::max(0.f, (Centroid.Y + 8) * 4)));
                            SurfaceFront      = GroundOffset() + GY * 64 + GX;
                            SurfaceBack       = SurfaceFront + 4096;
                        }
                        const unsigned Signs = (N.X < 0 ? 1u : 0u) | (N.Y < 0 ? 2u : 0u) | (N.Z < 0 ? 4u : 0u);
                        Taps.push_back({Tier * Cube(64) + Cell(unsigned(X), unsigned(Y), unsigned(Z), 64), SurfaceFront,
                                        SurfaceBack, Signs, Absolute(N) * (Area / (Grid.Spacing * Grid.Spacing))});
                    }
        }
    }

    void Construct(const RadianceScene& Scene)
    {
        GeometrySignature = GeometryFingerprint(Scene);
        VehicleFaces      = unsigned(Scene.Vehicle.Surfaces.size());
        StaticFaces       = unsigned(Scene.StaticSurfaces.Surfaces.size());
        Sites.clear();
        Taps.clear();
        Voxels.clear();
        unsigned Offset = 0;
        for (unsigned Tier = 0; Tier < 3; ++Tier)
        {
            auto& Grid   = Grids[Tier];
            Grid.Spacing = .125f * float(1u << Tier);
            Grid.Low     = {-32 * Grid.Spacing, -32 * Grid.Spacing, 1 - 32 * Grid.Spacing};
            for (unsigned Mip = 0; Mip < 7; ++Mip)
            {
                Grid.Offsets[Mip] = Offset;
                Offset += Cube(64u >> Mip) * 6;
            }
        }
        Voxels.resize(Offset);
        Sites.resize(GroundOffset() + 8192);
        for (unsigned Face = 0; Face < VehicleFaces; ++Face)
        {
            auto Surface                       = Scene.FacetCentre(Scene.Vehicle.Surfaces[Face], true, Face);
            Sites[Face].Surface                = Surface;
            Surface.Normal                     = -Surface.Normal;
            Surface.GeometricNormal            = -Surface.GeometricNormal;
            Surface.RadiantFacing              = false;
            Sites[Face + VehicleFaces].Surface = Surface;
            Facet Triangle                     = Scene.Vehicle.Surfaces[Face];
            for (auto& Corner : Triangle.Corner)
                Corner = Scene.Pose.ToWorld(Corner);
            AppendTriangle(Triangle, Face, Face + VehicleFaces, false);
        }
        for (unsigned Face = 0; Face < StaticFaces; ++Face)
        {
            auto Surface = Scene.FacetCentre(Scene.StaticSurfaces.Surfaces[Face], false, Face);
            Sites[2 * VehicleFaces + Face].Surface               = Surface;
            Surface.Normal                                       = -Surface.Normal;
            Surface.GeometricNormal                              = -Surface.GeometricNormal;
            Surface.RadiantFacing                                = false;
            Sites[2 * VehicleFaces + StaticFaces + Face].Surface = Surface;
            AppendTriangle(Scene.StaticSurfaces.Surfaces[Face], 2 * VehicleFaces + Face,
                           2 * VehicleFaces + StaticFaces + Face, false);
        }
        for (unsigned Index = 0; Index < 8192; ++Index)
        {
            const Vector Position{-8 + (float(Index % 64) + .5f) * .25f, -8 + (float((Index % 4096) / 64) + .5f) * .25f,
                                  0};
            const Vector Normal                   = Index < 4096 ? Vector{0, 0, 1} : Vector{0, 0, -1};
            Sites[GroundOffset() + Index].Surface = {true,     false,  true,   0, 0,
                                                     Position, Normal, Normal, 0, Index < 4096};
        }
        Facet GroundA{{Vector{-8, -8, 0}, Vector{8, -8, 0}, Vector{8, 8, 0}}, {}, 0};
        Facet GroundB{{Vector{-8, -8, 0}, Vector{8, 8, 0}, Vector{-8, 8, 0}}, {}, 0};
        AppendTriangle(GroundA, 0, 0, true);
        AppendTriangle(GroundB, 0, 0, true);
        std::stable_sort(Taps.begin(), Taps.end(), [](const SurfaceProjection& First, const SurfaceProjection& Second)
                         { return First.Cell < Second.Cell; });
        CellOffsets.assign(3 * Cube(64) + 1, 0);
        for (const auto& Tap : Taps)
            ++CellOffsets[Tap.Cell + 1];
        std::partial_sum(CellOffsets.begin(), CellOffsets.end(), CellOffsets.begin());
        Radiance.resize(Sites.size());
        for (unsigned Ring = 0; Ring < 2; ++Ring)
            for (unsigned Sector = 0; Sector < 8; ++Sector)
            {
                const unsigned Index  = Ring * 8 + Sector;
                const float    Radial = (Ring + .5f) / 2, Azimuth = 2 * π * (Sector + .5f * (Ring % 2)) / 8;
                ConeDirections[Index] = {std::sqrt(Radial) * std::cos(Azimuth), std::sqrt(Radial) * std::sin(Azimuth),
                                         std::sqrt(1 - Radial)};
                ConeWeights[Index]    = 1.f / 16;
                const float SolidAngle =
                    2 * π * (std::sqrt(1 - float(Ring) / 2) - std::sqrt(1 - float(Ring + 1) / 2)) / 8;
                const float Cosine  = 1 - SolidAngle / (2 * π);
                ConeTangents[Index] = std::sqrt(1 - Cosine * Cosine) / Cosine;
            }
    }

    bool Refresh(const RadianceScene& Scene, unsigned SourceMask, unsigned Samples)
    {
        Require(Samples > 0, "Surface relighting needs positive quadrature count");
        Require((SourceMask & ~unsigned(Combined)) == 0, "Unknown light selection");
        const auto& ClipPose = Scene.Clipmap.PreviousPose;
        Require(Scene.Clipmap.PreviousInitialized && ClipPose.Translation.X == Scene.Pose.Translation.X &&
                    ClipPose.Translation.Y == Scene.Pose.Translation.Y &&
                    ClipPose.Translation.Z == Scene.Pose.Translation.Z && ClipPose.Cosine == Scene.Pose.Cosine &&
                    ClipPose.Sine == Scene.Pose.Sine,
                "Relocate the distance clipmap before refreshing moving radiance");
        const auto Desired = TransportSnapshot::Capture(Scene, SourceMask, Samples);
        Require(!Initialized || GeometrySignature == GeometryFingerprint(Scene),
                "Geometry was edited; reconstruct the radiance scene and distance bake first");
        if (Initialized && Snapshot == Desired) return false;
        const bool Moved = !Initialized || !Snapshot.SamePose(Desired);
        if (Moved) Construct(Scene);
        Relight(Scene, SourceMask, Samples);
        Snapshot    = Desired;
        Initialized = true;
        ++RefreshCount;
        return true;
    }

    void RequireFresh(const RadianceScene& Scene, unsigned SourceMask) const
    {
        Require(Initialized && Snapshot == TransportSnapshot::Capture(Scene, SourceMask, Snapshot.Samples),
                "Stale directional radiance: refresh after pose or light change");
    }

    void Relight(const RadianceScene& Scene, unsigned SourceMask, unsigned Samples)
    {
        Parallel(unsigned(Sites.size()),
                 [&](unsigned Index)
                 {
                     Sites[Index].Direct =
                         Scene.Direct(Sites[Index].Surface, SourceMask, VisibilityEvaluation::Exact, Samples);
                     Radiance[Index] = Sites[Index].Direct;
                 });
        Inject();
    }

    void Inject()
    {
        Parallel(3 * Cube(64),
                 [&](unsigned Index)
                 {
                     const unsigned Tier = Index / Cube(64), Local = Index % Cube(64);
                     for (unsigned Look = 0; Look < 6; ++Look)
                     {
                         const unsigned Axis = Look / 2, Negative = Look % 2;
                         Vector         Accumulator{};
                         float          Area = 0;
                         for (unsigned Slot = CellOffsets[Index]; Slot < CellOffsets[Index + 1]; ++Slot)
                         {
                             const auto&    Tap            = Taps[Slot];
                             const unsigned NormalNegative = (Tap.Signs >> Axis) & 1u;
                             const unsigned Site           = NormalNegative != Negative ? Tap.Front : Tap.Back;
                             const float    Weight         = Tap.ProjectedArea[Axis];
                             Area += Weight;
                             Accumulator += Radiance[Site] * Weight;
                         }
                         const float Opacity                               = std::min(1.f, Area);
                         Voxels[Grids[Tier].Offsets[0] + Local * 6 + Look] = {
                             Area > 0 ? Accumulator * (Opacity / Area) : Vector{}, Opacity};
                     }
                 });
        for (unsigned Mip = 1; Mip < 7; ++Mip)
        {
            const unsigned Extent = 64u >> Mip;
            Parallel(3 * Cube(Extent),
                     [&](unsigned Index)
                     {
                         const unsigned Tier = Index / Cube(Extent), Local = Index % Cube(Extent);
                         const unsigned X = Local % Extent, Y = (Local / Extent) % Extent,
                                        Z = Local / (Extent * Extent);
                         for (unsigned Look = 0; Look < 6; ++Look)
                         {
                             const unsigned  Axis = Look / 2, Near = Look % 2 ? 1u : 0u;
                             RadianceOpacity Sum{};
                             for (unsigned Transverse = 0; Transverse < 4; ++Transverse)
                             {
                                 std::array<unsigned, 3> A{X * 2, Y * 2, Z * 2}, B = A;
                                 const unsigned          AxisU = (Axis + 1) % 3, AxisV = (Axis + 2) % 3;
                                 A[Axis] += Near;
                                 B[Axis] += 1 - Near;
                                 A[AxisU] += Transverse % 2;
                                 B[AxisU] += Transverse % 2;
                                 A[AxisV] += Transverse / 2;
                                 B[AxisV] += Transverse / 2;
                                 Sum = Sum + Over(Voxels[Grids[Tier].Offsets[Mip - 1] +
                                                         Cell(A[0], A[1], A[2], Extent * 2) * 6 + Look],
                                                  Voxels[Grids[Tier].Offsets[Mip - 1] +
                                                         Cell(B[0], B[1], B[2], Extent * 2) * 6 + Look]);
                             }
                             Voxels[Grids[Tier].Offsets[Mip] + Local * 6 + Look] = Sum * .25f;
                         }
                     });
        }
    }

    RadianceOpacity SampleMip(unsigned Tier,
                              unsigned Mip,
                              Vector   Position,
                              Vector   Direction) const
    {
        const auto&             Grid    = Grids[Tier];
        const unsigned          Extent  = 64u >> Mip;
        const float             Spacing = Grid.Spacing * float(1u << Mip);
        const Vector            Q       = (Position - Grid.Low) / Spacing - Vector{.5f, .5f, .5f};
        std::array<unsigned, 3> First{}, Second{};
        std::array<float, 3>    Fractions{};
        for (unsigned Axis = 0; Axis < 3; ++Axis)
        {
            const float Coordinate = std::clamp(Q[Axis], 0.f, float(Extent - 1));
            First[Axis]            = unsigned(Coordinate);
            Second[Axis]           = std::min(First[Axis] + 1, Extent - 1);
            Fractions[Axis]        = Coordinate - First[Axis];
        }
        const Vector                  AbsoluteDirection = Absolute(Direction);
        const float                   Sum     = AbsoluteDirection.X + AbsoluteDirection.Y + AbsoluteDirection.Z;
        const Vector                  Weights = AbsoluteDirection / Sum;
        const std::array<unsigned, 3> Looks{Direction.X < 0 ? 1u : 0u, Direction.Y < 0 ? 3u : 2u,
                                            Direction.Z < 0 ? 5u : 4u};
        RadianceOpacity Result{};
        for (unsigned Z = 0; Z < 2; ++Z)
            for (unsigned Y = 0; Y < 2; ++Y)
                for (unsigned X = 0; X < 2; ++X)
                {
                    const float Weight = (X ? Fractions[0] : 1 - Fractions[0]) * (Y ? Fractions[1] : 1 - Fractions[1]) *
                                         (Z ? Fractions[2] : 1 - Fractions[2]);
                    const unsigned Address =
                        Grid.Offsets[Mip] +
                        Cell(X ? Second[0] : First[0], Y ? Second[1] : First[1], Z ? Second[2] : First[2], Extent) * 6;
                    for (unsigned Axis = 0; Axis < 3; ++Axis)
                        Result = Result + Voxels[Address + Looks[Axis]] * (Weight * Weights[Axis]);
                }
        return Result;
    }

    Vector TraceCone(const RadianceScene& Scene,
                     Vector               Origin,
                     Vector               Direction,
                     float                Tangent,
                     bool                 DistanceEnabled = true,
                     unsigned*            Iterations      = nullptr,
                     unsigned*            DistanceSkips   = nullptr) const
    {
        Vector Accumulator{};
        float  Transmission = 1, Travel = InitialTravel;
        for (unsigned Step = 0; Step < 192 && Travel < 24 && Transmission > 0; ++Step)
        {
            if (Iterations) ++*Iterations;
            const Vector Position = Origin + Direction * Travel;
            const float  Radius   = std::max(.0625f, Travel * Tangent);
            unsigned     Tier     = 0;
            for (; Tier < 2; ++Tier)
            {
                const auto&  Grid = Grids[Tier];
                const Vector High = Grid.Low + Vector{64, 64, 64} * Grid.Spacing;
                if (Position.X - Radius >= Grid.Low.X && Position.Y - Radius >= Grid.Low.Y &&
                    Position.Z - Radius >= Grid.Low.Z && Position.X + Radius <= High.X &&
                    Position.Y + Radius <= High.Y && Position.Z + Radius <= High.Z)
                    break;
            }
            const auto&  Grid = Grids[Tier];
            const Vector High = Grid.Low + Vector{64, 64, 64} * Grid.Spacing;
            if (Position.X < Grid.Low.X || Position.Y < Grid.Low.Y || Position.Z < Grid.Low.Z || Position.X > High.X ||
                Position.Y > High.Y || Position.Z > High.Z)
                break;
            const float    Lod      = std::clamp(std::log2(2 * Radius / Grid.Spacing), 0.f, 6.f);
            const unsigned Mip      = unsigned(Lod);
            const float    Fraction = Lod - Mip;
            const float    Width    = Grid.Spacing * std::exp2(Lod);
            if (DistanceEnabled)
            {
                const float Lower        = Scene.Clipmap.Sample(Position).Lower;
                const float Floor        = Length(Vector{std::max(0.f, std::abs(Position.X) - 8),
                                                  std::max(0.f, std::abs(Position.Y) - 8), Position.Z});
                const float FilterRadius = 2.598077f * Grid.Spacing * float(1u << unsigned(std::ceil(Lod)));
                if (std::min(Lower, Floor) > FilterRadius + 2e-4f)
                {
                    if (DistanceSkips) ++*DistanceSkips;
                    Travel += Width * .5f;
                    continue;
                }
            }
            RadianceOpacity Gather = SampleMip(Tier, Mip, Position, Direction);
            if (Fraction > 0 && Mip < 6)
                Gather = Gather * (1 - Fraction) + SampleMip(Tier, Mip + 1, Position, Direction) * Fraction;
            const float  Length  = Width * .5f;
            const float  Opacity = 1 - std::pow(std::max(0.f, 1 - Gather.Opacity), Length / Width);
            const Vector Colour  = Gather.Opacity > 0 ? Gather.Radiance * (Opacity / Gather.Opacity) : Vector{};
            Accumulator += Colour * Transmission;
            Transmission *= 1 - Opacity;
            Travel += Length;
        }
        return Accumulator;
    }

    Vector Indirect(const RadianceScene& Scene,
                    const SurfacePoint&  Surface,
                    unsigned             SourceMask,
                    bool                 DistanceEnabled = true) const
    {
        RequireFresh(Scene, SourceMask);
        return EvaluateMaterial(Surface.Material).Reflectance * IrradianceOverPi(Scene, Surface, DistanceEnabled);
    }

    Vector IrradianceOverPi(const RadianceScene& Scene, const SurfacePoint& Surface, bool DistanceEnabled = true) const
    {
        Vector Tangent{}, Bitangent{};
        ConstructBasis(Surface.Normal, Tangent, Bitangent);
        Vector Sum{};
        for (unsigned Cone = 0; Cone < ConeCount; ++Cone)
        {
            const Vector Local     = ConeDirections[Cone];
            const Vector Direction = Normalize(Tangent * Local.X + Bitangent * Local.Y + Surface.Normal * Local.Z);
            Sum += TraceCone(Scene, Surface.Position + Surface.GeometricNormal * NormalDisplacement, Direction,
                             ConeTangents[Cone], DistanceEnabled) *
                   ConeWeights[Cone];
        }
        return Sum;
    }

    float Bounce(const RadianceScene& Scene)
    {
        RequireFresh(Scene, Snapshot.Sources);
        std::vector<Vector> Next(Radiance.size());
        float               Residual = 0;
        Parallel(unsigned(Sites.size()),
                 [&](unsigned Index)
                 {
                     Next[Index] = Sites[Index].Direct + EvaluateMaterial(Sites[Index].Surface.Material).Reflectance *
                                                             IrradianceOverPi(Scene, Sites[Index].Surface);
                 });
        for (unsigned Index = 0; Index < Radiance.size(); ++Index)
            Residual =
                std::max({Residual, std::abs(Next[Index].X - Radiance[Index].X),
                          std::abs(Next[Index].Y - Radiance[Index].Y), std::abs(Next[Index].Z - Radiance[Index].Z)});
        Radiance.swap(Next);
        Inject();
        return Residual;
    }
};
} // namespace Frontier::DistanceClipmapExperiment

static_assert(sizeof(Frontier::DistanceClipmapExperiment::RadianceOpacity) == 16);
static_assert(sizeof(Frontier::DistanceClipmapExperiment::SurfaceProjection) == 32);
