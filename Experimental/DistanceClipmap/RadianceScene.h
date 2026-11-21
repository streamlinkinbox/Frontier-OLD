/*============================================================================================================================================
                                                             RADIANCESCENE.H
============================================================================================================================================*/
// 🧩 Diffuse-only diagnostic transport with source isolation, actual emissive vehicle facets and an observable surface cache.

#pragma once
#include "DistanceClipmap.h"
#include "SobolDirections.h"
#include <chrono>
#include <iostream>

namespace Frontier::DistanceClipmapExperiment
{

//------------------------------------------------------------------------------------------------------------------------
//                                                     FIXED SOBOL QUADRATURE
//------------------------------------------------------------------------------------------------------------------------

inline std::uint32_t Avalanche(std::uint32_t Bits)
{
    Bits ^= Bits >> 16;
    Bits *= 0x7feb352du;
    Bits ^= Bits >> 15;
    Bits *= 0x846ca68bu;
    return Bits ^ (Bits >> 16);
}

inline std::array<float, 2> Quadrature(unsigned Index, unsigned Pair, unsigned Pixel = 0)
{
    Require(Pair < 16, "Sobol dimension budget exceeded");
    const unsigned Key   = Avalanche(Pair * 0x9e3779b9u + 0x85ebca6bu) ^ Avalanche(Pixel);
    unsigned       First = Avalanche(Key ^ 0xa511e9b3u), Second = Avalanche(Key ^ 0x63d83595u);
    unsigned       Gray = Index ^ (Index >> 1), Digit = 0;
    while (Gray)
    {
        if (Gray & 1)
        {
            First ^= SobolDirections[Pair * 2][Digit];
            Second ^= SobolDirections[Pair * 2 + 1][Digit];
        }
        Gray >>= 1;
        ++Digit;
    }
    // 📝 Every integration variable has a different Joe–Kuo direction dimension. Reusing a digitally shifted
    //    two-dimensional net for every bounce would produce correlated, nonconvergent path quadrature.
    return {float(First >> 8) * (1.f / 16777216.f), float(Second >> 8) * (1.f / 16777216.f)};
}

inline void ConstructBasis(Vector N, Vector& Tangent, Vector& Bitangent)
{
    Tangent   = Normalize(Cross(std::abs(N.Z) < .95f ? Vector{0, 0, 1} : Vector{0, 1, 0}, N));
    Bitangent = Cross(N, Tangent);
}

inline Vector CosineDirection(Vector N, std::array<float, 2> Sample)
{
    Vector Tangent{}, Bitangent{};
    ConstructBasis(N, Tangent, Bitangent);
    const float Radius = std::sqrt(Sample[0]), φ = 2 * π * Sample[1];
    return Normalize(Tangent * (Radius * std::cos(φ)) + Bitangent * (Radius * std::sin(φ)) +
                     N * std::sqrt(1 - Sample[0]));
}

inline Vector CapDirection(Vector Axis, float AngularRadius, std::array<float, 2> Sample)
{
    Vector Tangent{}, Bitangent{};
    ConstructBasis(Axis, Tangent, Bitangent);
    // 📝 2 sin²(θ/2) avoids catastrophic cancellation at the physical solar radius in FP32.
    const float OneMinusCosine = 2 * std::pow(std::sin(.5f * AngularRadius), 2.f) * Sample[0];
    const float Cosine         = 1 - OneMinusCosine;
    const float Sine           = std::sqrt(OneMinusCosine * (2 - OneMinusCosine));
    const float φ              = 2 * π * Sample[1];
    return Normalize(Axis * Cosine + (Tangent * std::cos(φ) + Bitangent * std::sin(φ)) * Sine);
}

//------------------------------------------------------------------------------------------------------------------------
//                                                      DIAGNOSTIC MATERIALS
//------------------------------------------------------------------------------------------------------------------------

struct DiffuseMaterial
{
    Vector Reflectance{}, SelfRadiance{};
};

inline DiffuseMaterial EvaluateMaterial(unsigned Material)
{
    // 📝 Geometry and lamp radiances are retained; vehicle lobes are deliberately replaced by matte coefficients.
    //    This bounded Lambertian experiment is NOT the production clearcoat/metal/glass material renderer.
    switch (Material)
    {
    case 0:
        return {{.42f, .41f, .39f}, {}};
    case 6:
        return {{.045f, .25f, .12f}, {}};
    case 7:
        return {{.035f, .05f, .065f}, {}};
    case 8:
        return {{.12f, .13f, .14f}, {}};
    case 9:
        return {{.03741f, .03741f, .03741f}, {}};
    case 10:
        return {{.06f, .22f, .62f}, {0, .03327756f, .12f}};
    case 11:
        return {{.30f, .075f, .025f}, {}};
    case 12:
        return {{.8f, .8f, .8f}, {}};
    case 13:
        return {{.8f, .8f, .8f}, {48.699997f, 48.699997f, 48.699997f}};
    case 14:
        return {{.8f, .8f, .8f}, {6.5f, 0, 6.5f * .016442f}};
    case 16:
        return {{.72f, .05f, .04f}, {}};
    case 17:
        return {{.05f, .52f, .16f}, {}};
    default:
        return {{.65f, .65f, .63f}, {}};
    }
}

enum class VisibilityEvaluation : unsigned
{
    Exact         = 0,
    Hybrid        = 1,
    LocalPenumbra = 2,
    ClipPenumbra  = 3
};
enum LightSelection : unsigned
{
    Dark     = 0,
    Emissive = 1,
    Point    = 2,
    Sun      = 4,
    Area     = 8,
    Combined = 15
};

struct SurfacePoint
{
    bool     Confirmed = false, Vehicle = false, Ground = false;
    unsigned FacetIndex = UINT32_MAX, Material = 0;
    Vector   Position{}, Normal{}, GeometricNormal{};
    float    Travel        = INFINITY;
    bool     RadiantFacing = true;
};

struct RadiantFacet
{
    unsigned FacetIndex = 0;
    double   Cumulative = 0, Area = 0, Weight = 0;
};

inline void AppendFacet(std::vector<Facet>& Surfaces, Vector A, Vector B, Vector C, unsigned Material)
{
    const Vector N = Normalize(Cross(B - A, C - A));
    Surfaces.push_back({{A, B, C}, {N, N, N}, Material});
}

inline void AppendBox(std::vector<Facet>& Surfaces, const ClosedBox& Box)
{
    for (unsigned Axis = 0; Axis < 3; ++Axis)
        for (int Sign : {-1, 1})
        {
            const unsigned       AxisU = (Axis + 1) % 3, AxisV = (Axis + 2) % 3;
            std::array<float, 3> Centre{Box.Centre.X, Box.Centre.Y, Box.Centre.Z};
            std::array<float, 3> Half{Box.HalfExtent.X, Box.HalfExtent.Y, Box.HalfExtent.Z};
            Centre[Axis] += Sign * Half[Axis];
            const unsigned CountU = unsigned(std::max(1.f, std::ceil(2 * Half[AxisU] / .4f)));
            const unsigned CountV = unsigned(std::max(1.f, std::ceil(2 * Half[AxisV] / .4f)));
            for (unsigned V = 0; V < CountV; ++V)
                for (unsigned U = 0; U < CountU; ++U)
                {
                    auto Position = [&](unsigned DU, unsigned DV)
                    {
                        auto P = Centre;
                        P[AxisU] += (-1 + 2 * float(U + DU) / CountU) * Half[AxisU];
                        P[AxisV] += (-1 + 2 * float(V + DV) / CountV) * Half[AxisV];
                        return Vector{P[0], P[1], P[2]};
                    };
                    Vector A = Position(0, 0), B = Position(1, 0), C = Position(1, 1), D = Position(0, 1);
                    if (Sign < 0) std::swap(B, D);
                    AppendFacet(Surfaces, A, B, C, Box.Material);
                    AppendFacet(Surfaces, A, C, D, Box.Material);
                }
        }
}

//------------------------------------------------------------------------------------------------------------------------
//                                                SCENE / EXACT AND HYBRID VISIBILITY
//------------------------------------------------------------------------------------------------------------------------

class RadianceScene
{
public:
    FacetAtlas                Vehicle, StaticSurfaces;
    BakedFacetDistance        LocalDistance;
    DistanceClipmap           Clipmap;
    RigidPose                 Pose{};
    std::vector<ClosedBox>    Boxes;
    std::vector<RadiantFacet> RadiantFacets;
    double                    RadiantWeight = 0;
    Vector                    SunDirection  = Normalize({-.5f, -.35f, 1.f});
    float                     SunRadius     = .00465f;
    static constexpr unsigned GroundExtent  = 64;
    std::vector<Vector>       VehicleCache, StaticCache, GroundCache;
    unsigned                  CachedSources = 0;

    void Construct(const std::string& ArchiveRoot)
    {
        Vehicle.Construct(AssembleVehicle(ArchiveRoot));
        Boxes = {{{0, 4.2f, 1.5f}, {6, .08f, 1.5f}, 18}, {{-5.8f, .2f, 1.5f}, {.08f, 4, 1.5f}, 16}};
        // 📝 Closed 2 cm calibration louvers are deliberately finer than the 6–10 cm vehicle bake.
        for (unsigned Louver = 0; Louver < 4; ++Louver)
            Boxes.push_back({{3.7f + .22f * Louver, 2.6f, .7f}, {.01f, .5f, .7f}, 18});
        std::vector<Facet> StaticFacets;
        for (const auto& Box : Boxes)
            AppendBox(StaticFacets, Box);
        StaticSurfaces.Construct(std::move(StaticFacets));
        for (unsigned Face = 0; Face < Vehicle.Surfaces.size(); ++Face)
        {
            const auto& Triangle   = Vehicle.Surfaces[Face];
            const auto  Material   = EvaluateMaterial(Triangle.Material);
            const float Brightness = Luminance(Material.SelfRadiance);
            if (Brightness <= 0) continue;
            const double SurfaceArea =
                .5 * Length(Cross(Triangle.Corner[1] - Triangle.Corner[0], Triangle.Corner[2] - Triangle.Corner[0]));
            const double Weight = SurfaceArea * Brightness;
            RadiantWeight += Weight;
            RadiantFacets.push_back({Face, RadiantWeight, SurfaceArea, Weight});
        }
        Clipmap.Local          = &LocalDistance;
        Clipmap.ClosedSurfaces = Boxes;
    }

    SurfacePoint Trace(Vector Origin, Vector Direction, float Limit = 100.f) const
    {
        SurfacePoint Result;
        const auto   CarHit = Vehicle.Trace(Pose.ToLocal(Origin), Pose.Unrotate(Direction), Limit);
        if (CarHit.Confirmed())
        {
            Result.Confirmed       = true;
            Result.Vehicle         = true;
            Result.FacetIndex      = CarHit.FacetIndex;
            Result.Travel          = CarHit.Travel;
            const auto& Triangle   = Vehicle.Surfaces[CarHit.FacetIndex];
            Result.Material        = Triangle.Material;
            Result.Normal          = Pose.Rotate(Normalize(Triangle.Normal[0] * (1 - CarHit.U - CarHit.V) +
                                                  Triangle.Normal[1] * CarHit.U + Triangle.Normal[2] * CarHit.V));
            Result.GeometricNormal = Pose.Rotate(
                Normalize(Cross(Triangle.Corner[1] - Triangle.Corner[0], Triangle.Corner[2] - Triangle.Corner[0])));
            Limit = CarHit.Travel;
        }
        const auto StaticHit = StaticSurfaces.Trace(Origin, Direction, Limit);
        if (StaticHit.Confirmed())
        {
            Result.Confirmed     = true;
            Result.Vehicle       = false;
            Result.FacetIndex    = StaticHit.FacetIndex;
            Result.Travel        = StaticHit.Travel;
            const auto& Triangle = StaticSurfaces.Surfaces[StaticHit.FacetIndex];
            Result.Material      = Triangle.Material;
            Result.Normal = Result.GeometricNormal = Triangle.Normal[0];
            Limit                                  = StaticHit.Travel;
        }
        if (Direction.Z != 0)
        {
            const float  Travel = -Origin.Z / Direction.Z;
            const Vector P      = Origin + Direction * Travel;
            if (Travel > 1e-5f && Travel < Limit && std::abs(P.X) <= 8 && std::abs(P.Y) <= 8)
            {
                Result = {true, false, true, 0, 0, P, {0, 0, 1}, {0, 0, 1}, Travel};
            }
        }
        if (!Result.Confirmed) return Result;
        Result.Position      = Origin + Direction * Result.Travel;
        Result.RadiantFacing = Dot(Result.GeometricNormal, Direction) < 0;
        if (Dot(Result.GeometricNormal, Direction) > 0) Result.GeometricNormal = -Result.GeometricNormal;
        // 📝 Transport uses actual facet normals, not smooth shading-normal perturbations. This keeps the bounded
        //    two-sided Lambertian experiment reciprocal without an unverified shading-normal Jacobian correction.
        Result.Normal = Result.GeometricNormal;
        return Result;
    }

    bool CarOccluded(Vector               Origin,
                     Vector               Direction,
                     float                Limit,
                     VisibilityEvaluation Evaluation,
                     unsigned*            Steps = nullptr) const
    {
        if (Evaluation == VisibilityEvaluation::Exact)
            return Vehicle.Trace(Pose.ToLocal(Origin), Pose.Unrotate(Direction), Limit, true).Confirmed();
        const Vector LocalOrigin = Pose.ToLocal(Origin), LocalDirection = Pose.Unrotate(Direction);
        float        Near = 0;
        if (!FacetAtlas::IntersectEnclosure(LocalOrigin, LocalDirection, Vehicle.Low, Vehicle.High, 0, Limit, Near))
            return false;
        float Travel = Near;
        for (unsigned Step = 0; Step < 96; ++Step)
        {
            if (Steps) ++*Steps;
            const auto Interval = Clipmap.Sample(Origin + Direction * Travel);
            if (Interval.Lower < 1e-4f) break;
            Travel += Interval.Lower;
            if (Travel > Limit) return false;
            const Vector P = LocalOrigin + LocalDirection * Travel;
            if (P.X < Vehicle.Low.X - 1e-4f || P.X > Vehicle.High.X + 1e-4f || P.Y < Vehicle.Low.Y - 1e-4f ||
                P.Y > Vehicle.High.Y + 1e-4f || P.Z < Vehicle.Low.Z - 1e-4f || P.Z > Vehicle.High.Z + 1e-4f)
                return false;
        }
        // 📝 Coarse proximity, missing coverage and iteration exhaustion are not intersections. Refine the original
        //    interval, not an advanced biased origin. The bake may only prove emptiness; triangles decide contact.
        return Vehicle.Trace(LocalOrigin, LocalDirection, Limit, true).Confirmed();
    }

    float Penumbra(Vector Origin, Vector Direction, float Limit, float AngularRadius, bool Global) const
    {
        const float Voxel =
            Global ? .125f : std::max({LocalDistance.Spacing.X, LocalDistance.Spacing.Y, LocalDistance.Spacing.Z});
        float Travel = Voxel, Visibility = 1;
        for (unsigned Step = 0; Step < 96 && Travel < Limit; ++Step)
        {
            const Vector P        = Origin + Direction * Travel;
            float        Distance = Global ? Clipmap.Sample(P).Raw : LocalDistance.Sample(Pose.ToLocal(P)).Raw;
            if (Global)
            {
                unsigned Tier = 0;
                (void)Clipmap.Sample(P, &Tier);
                if (Tier == UINT32_MAX) break;
            }
            else
                for (const auto& Box : Boxes)
                    Distance = std::min(Distance, std::abs(SignedBoxDistance(P, Box)));
            if (Distance < .008f) return 0;
            Visibility = std::min(Visibility, std::clamp(Distance / std::max(.001f, Travel * AngularRadius), 0.f, 1.f));
            Travel += std::max(Voxel * .25f, Distance * .9f);
        }
        return Visibility;
    }

    float Visibility(Vector               Origin,
                     Vector               Direction,
                     float                Limit,
                     VisibilityEvaluation Evaluation,
                     float                AngularRadius = .00465f) const
    {
        if (Evaluation == VisibilityEvaluation::LocalPenumbra || Evaluation == VisibilityEvaluation::ClipPenumbra)
            return Penumbra(Origin, Direction, Limit, AngularRadius, Evaluation == VisibilityEvaluation::ClipPenumbra);
        if (StaticSurfaces.Trace(Origin, Direction, Limit, true).Confirmed()) return 0;
        if (Direction.Z < 0)
        {
            const float  Travel = -Origin.Z / Direction.Z;
            const Vector P      = Origin + Direction * Travel;
            if (Travel > 1e-5f && Travel < Limit && std::abs(P.X) < 8 && std::abs(P.Y) < 8) return 0;
        }
        return CarOccluded(Origin, Direction, Limit, Evaluation) ? 0.f : 1.f;
    }

    //------------------------------------------------------------------------------------------------------------------------
    //                                                 RADIOMETRIC SOURCE INTEGRATION
    //------------------------------------------------------------------------------------------------------------------------

    float TargetVisibility(Vector Origin, Vector Target, VisibilityEvaluation Evaluation, float AngularRadius) const
    {
        const Vector Segment = Target - Origin;
        const float  Travel  = Length(Segment);
        return Travel > 4e-4f ? Visibility(Origin, Segment / Travel, Travel - 2e-4f, Evaluation, AngularRadius) : 0;
    }

    Vector Direct(const SurfacePoint&  Surface,
                  unsigned             Sources,
                  VisibilityEvaluation Evaluation,
                  unsigned             Samples,
                  unsigned             SequenceOffset  = 0,
                  unsigned             Pixel           = 0,
                  unsigned             DimensionOffset = 0) const
    {
        if (!Sources) return {};
        Vector       Irradiance{};
        const Vector Origin = Surface.Position + Surface.GeometricNormal * 2e-4f;
        if (Sources & LightSelection::Point)
        {
            const Vector Delta   = Vector{1.5f, -3.2f, 3.6f} - Surface.Position;
            const float  Squared = Dot(Delta, Delta), Travel = std::sqrt(Squared);
            const Vector Direction = Delta / Travel;
            const float  Cosine    = std::max(0.f, Dot(Surface.Normal, Direction));
            if (Cosine > 0)
                Irradiance += Vector{70, 56, 42} *
                              (Cosine / Squared * TargetVisibility(Origin, {1.5f, -3.2f, 3.6f}, Evaluation, 0));
        }
        Vector Integrated{};
        for (unsigned Sample = 0; Sample < Samples; ++Sample)
        {
            const unsigned Index = Sample + SequenceOffset;
            if (Sources & LightSelection::Sun)
            {
                const auto   Pair      = Quadrature(Index, 1 + DimensionOffset, Pixel);
                const Vector Direction = CapDirection(SunDirection, SunRadius, Pair);
                const float  Cosine    = std::max(0.f, Dot(Surface.Normal, Direction));
                // 📝 Uniform-radiance cap: L_sun Ω / E_normal = 2/(1+cos θ). This includes the cosine exactly;
                //    simply averaging visibility and using the centre cosine is not the same integral.
                const float Normalization = 2 / (1 + std::cos(SunRadius));
                if (Cosine > 0)
                    Integrated += Vector{3.2f, 3.0f, 2.6f} *
                                  (Normalization * Cosine * Visibility(Origin, Direction, 40, Evaluation, SunRadius));
            }
            if (Sources & LightSelection::Area)
            {
                const auto   Pair = Quadrature(Index, 2 + DimensionOffset, Pixel);
                const Vector Target{(Pair[0] * 2 - 1) * 1.5f, -.8f + (Pair[1] * 2 - 1) * 1.0f, 4.5f};
                const Vector Delta   = Target - Surface.Position;
                const float  Squared = Dot(Delta, Delta), Travel = std::sqrt(Squared);
                const Vector Direction = Delta / Travel;
                const float  Geometry =
                    std::max(0.f, Dot(Surface.Normal, Direction)) * std::max(0.f, Direction.Z) / Squared;
                if (Geometry > 0)
                    Integrated +=
                        Vector{9, 9.5f, 11} * (6 * Geometry * TargetVisibility(Origin, Target, Evaluation, .3f));
            }
            if ((Sources & LightSelection::Emissive) && !RadiantFacets.empty())
            {
                const auto   Pair      = Quadrature(Index, 3 + DimensionOffset, Pixel);
                const double Selection = double(Pair[0]) * RadiantWeight;
                auto         Selected  = std::lower_bound(RadiantFacets.begin(),
                                                 RadiantFacets.end(),
                                                 Selection,
                                                 [](const RadiantFacet& A, double Coordinate)
                                                 { return A.Cumulative < Coordinate; });
                if (Selected == RadiantFacets.end()) --Selected;
                const float  LocalU = float((Selection - (Selected->Cumulative - Selected->Weight)) / Selected->Weight);
                const float  Root   = std::sqrt(std::clamp(LocalU, 0.f, 1.f));
                const auto&  Triangle = Vehicle.Surfaces[Selected->FacetIndex];
                const Vector Target =
                    Pose.ToWorld(Triangle.Corner[0] * (1 - Root) + Triangle.Corner[1] * (Root * (1 - Pair[1])) +
                                 Triangle.Corner[2] * (Root * Pair[1]));
                const Vector EmitterNormal = Pose.Rotate(
                    Normalize(Cross(Triangle.Corner[1] - Triangle.Corner[0], Triangle.Corner[2] - Triangle.Corner[0])));
                const Vector Delta   = Target - Surface.Position;
                const float  Squared = Dot(Delta, Delta), Travel = std::sqrt(Squared);
                if (Travel > .001f)
                {
                    const Vector Direction     = Delta / Travel;
                    const float  Cosine        = std::max(0.f, Dot(Surface.Normal, Direction));
                    const float  EmitterCosine = std::max(0.f, Dot(EmitterNormal, -Direction));
                    const float  ReciprocalPdf = float(RadiantWeight * Selected->Area / Selected->Weight);
                    if (Cosine > 0 && EmitterCosine > 0)
                        Integrated += EvaluateMaterial(Triangle.Material).SelfRadiance *
                                      (Cosine * EmitterCosine / Squared * ReciprocalPdf *
                                       TargetVisibility(Origin, Target, Evaluation, .03f));
                }
            }
        }
        Irradiance += Integrated / float(Samples);
        return EvaluateMaterial(Surface.Material).Reflectance * Irradiance / π;
    }

    Vector SelfRadiance(const SurfacePoint& Surface, unsigned Sources) const
    {
        if (!(Sources & LightSelection::Emissive) || !Surface.Vehicle || !Surface.RadiantFacing) return {};
        return EvaluateMaterial(Surface.Material).SelfRadiance;
    }

    //------------------------------------------------------------------------------------------------------------------------
    //                                                RELIT FACET / GROUND SURFACE CACHE
    //------------------------------------------------------------------------------------------------------------------------

    SurfacePoint FacetCentre(const Facet& Triangle, bool Car, unsigned Index) const
    {
        Vector P = (Triangle.Corner[0] + Triangle.Corner[1] + Triangle.Corner[2]) / 3;
        Vector N = Normalize(Cross(Triangle.Corner[1] - Triangle.Corner[0], Triangle.Corner[2] - Triangle.Corner[0]));
        if (Car)
        {
            P = Pose.ToWorld(P);
            N = Pose.Rotate(N);
        }
        return {true, Car, false, Index, Triangle.Material, P, N, N, 0};
    }

    void Relight(unsigned Sources, unsigned Samples)
    {
        VehicleCache.resize(Vehicle.Surfaces.size() * 2);
        StaticCache.resize(StaticSurfaces.Surfaces.size() * 2);
        GroundCache.resize(GroundExtent * GroundExtent);
        Parallel(unsigned(VehicleCache.size() + StaticCache.size() + GroundCache.size()),
                 [&](unsigned Index)
                 {
                     if (Index < VehicleCache.size())
                     {
                         const unsigned Face   = Index % unsigned(Vehicle.Surfaces.size());
                         auto           Centre = FacetCentre(Vehicle.Surfaces[Face], true, Face);
                         if (Index >= Vehicle.Surfaces.size())
                         {
                             Centre.Normal          = -Centre.Normal;
                             Centre.GeometricNormal = -Centre.GeometricNormal;
                         }
                         VehicleCache[Index] = Direct(Centre, Sources, VisibilityEvaluation::Exact, Samples);
                         return;
                     }
                     Index -= unsigned(VehicleCache.size());
                     if (Index < StaticCache.size())
                     {
                         const unsigned Face   = Index % unsigned(StaticSurfaces.Surfaces.size());
                         auto           Centre = FacetCentre(StaticSurfaces.Surfaces[Face], false, Face);
                         if (Index >= StaticSurfaces.Surfaces.size())
                         {
                             Centre.Normal          = -Centre.Normal;
                             Centre.GeometricNormal = -Centre.GeometricNormal;
                         }
                         StaticCache[Index] = Direct(Centre, Sources, VisibilityEvaluation::Exact, Samples);
                         return;
                     }
                     Index -= unsigned(StaticCache.size());
                     const unsigned X = Index % GroundExtent, Y = Index / GroundExtent;
                     const Vector P{-8 + (X + .5f) * (16.f / GroundExtent), -8 + (Y + .5f) * (16.f / GroundExtent), 0};
                     GroundCache[Index] = Direct({true, false, true, 0, 0, P, {0, 0, 1}, {0, 0, 1}, 0},
                                                 Sources,
                                                 VisibilityEvaluation::Exact,
                                                 Samples);
                 });
        CachedSources = Sources;
    }

    Vector CachedRadiance(const SurfacePoint& Surface) const
    {
        if (Surface.Vehicle)
            return VehicleCache[Surface.FacetIndex + (Surface.RadiantFacing ? 0 : Vehicle.Surfaces.size())];
        if (!Surface.Ground)
            return StaticCache[Surface.FacetIndex + (Surface.RadiantFacing ? 0 : StaticSurfaces.Surfaces.size())];
        const unsigned X =
            std::min(GroundExtent - 1, unsigned(std::max(0.f, (Surface.Position.X + 8) * GroundExtent / 16)));
        const unsigned Y =
            std::min(GroundExtent - 1, unsigned(std::max(0.f, (Surface.Position.Y + 8) * GroundExtent / 16)));
        return GroundCache[Y * GroundExtent + X];
    }

    Vector Indirect(const SurfacePoint& Surface, unsigned Sources, unsigned Samples, bool Cache, unsigned Pixel) const
    {
        if (Cache) Require(CachedSources == Sources, "Stale source selection in surface cache");
        Vector Incoming{};
        for (unsigned Sample = 0; Sample < Samples; ++Sample)
        {
            const Vector Direction = CosineDirection(Surface.Normal, Quadrature(Sample, 4, Pixel));
            if (Dot(Direction, Surface.GeometricNormal) <= 0) continue;
            const auto Secondary = Trace(Surface.Position + Surface.GeometricNormal * 2e-4f, Direction);
            if (!Secondary.Confirmed) continue;
            // 📝 Le at the first secondary encounter is intentionally excluded: primary emitter NEE already includes
            //    these paths. The cache contains reflected radiance only, so it cannot invent a second light source.
            Incoming += Cache ? CachedRadiance(Secondary)
                              : Direct(Secondary, Sources, VisibilityEvaluation::Exact, 1, Sample, Pixel, 4);
        }
        return EvaluateMaterial(Surface.Material).Reflectance * Incoming / float(Samples);
    }
};

//------------------------------------------------------------------------------------------------------------------------
//                                                   FULL-RESOLUTION CPU CAPTURES
//------------------------------------------------------------------------------------------------------------------------

constexpr unsigned CaptureWidth = 480, CaptureHeight = 270;
using Image = std::vector<Vector>;

inline Vector CameraDirection(float X, float Y)
{
    const Vector Eye{8.3f, -9.5f, 5.8f}, Target{.0f, .3f, .65f};
    const Vector Forward = Normalize(Target - Eye), Right = Normalize(Cross(Forward, {0, 0, 1})),
                 Up     = Cross(Right, Forward);
    const float HalfFov = std::tan(42.f * π / 360);
    const float Aspect  = float(CaptureWidth) / CaptureHeight;
    return Normalize(Forward + Right * ((2 * X / CaptureWidth - 1) * HalfFov * Aspect) +
                     Up * ((1 - 2 * Y / CaptureHeight) * HalfFov));
}

struct CaptureConfiguration
{
    unsigned             Sources       = LightSelection::Combined;
    VisibilityEvaluation Visibility    = VisibilityEvaluation::Exact;
    unsigned             DirectSamples = 64, IndirectSamples = 0, PrimarySamples = 4;
    bool                 Cache = false, IndirectOnly = false, CacheView = false, Normals = false;
};

inline Image Capture(const RadianceScene& Scene, const CaptureConfiguration& Configuration)
{
    Image Pixels(CaptureWidth * CaptureHeight);
    Parallel(CaptureHeight,
             [&](unsigned Y)
             {
                 for (unsigned X = 0; X < CaptureWidth; ++X)
                 {
                     Vector Radiance{};
                     for (unsigned Subpixel = 0; Subpixel < Configuration.PrimarySamples; ++Subpixel)
                     {
                         const auto Offset = Quadrature(Subpixel, 0);
                         const auto Surface =
                             Scene.Trace({8.3f, -9.5f, 5.8f}, CameraDirection(X + Offset[0], Y + Offset[1]));
                         if (!Surface.Confirmed) continue;
                         if (Configuration.Normals)
                         {
                             Radiance += Surface.Normal * .5f + Vector{.5f, .5f, .5f};
                             continue;
                         }
                         if (Configuration.CacheView)
                         {
                             Radiance += Scene.CachedRadiance(Surface);
                             continue;
                         }
                         if (!Configuration.IndirectOnly)
                             Radiance += Scene.Direct(Surface,
                                                      Configuration.Sources,
                                                      Configuration.Visibility,
                                                      Configuration.DirectSamples,
                                                      0,
                                                      0) +
                                         Scene.SelfRadiance(Surface, Configuration.Sources);
                         if (Configuration.IndirectSamples)
                             Radiance += Scene.Indirect(Surface,
                                                        Configuration.Sources,
                                                        Configuration.IndirectSamples,
                                                        Configuration.Cache,
                                                        Y * CaptureWidth + X);
                     }
                     Pixels[Y * CaptureWidth + X] = Radiance / float(Configuration.PrimarySamples);
                 }
             });
    return Pixels;
}

inline Image CapturePath(const RadianceScene& Scene, unsigned Sources, unsigned Samples, unsigned ScatteringCount)
{
    Image Pixels(CaptureWidth * CaptureHeight);
    Parallel(CaptureHeight,
             [&](unsigned Y)
             {
                 for (unsigned X = 0; X < CaptureWidth; ++X)
                 {
                     Vector         Radiance{};
                     const unsigned Pixel = Y * CaptureWidth + X;
                     for (unsigned Sample = 0; Sample < Samples; ++Sample)
                     {
                         const auto Offset = Quadrature(Sample, 0);
                         Vector Origin{8.3f, -9.5f, 5.8f}, Direction = CameraDirection(X + Offset[0], Y + Offset[1]);
                         Vector Throughput{1, 1, 1};
                         for (unsigned Bounce = 0; Bounce < ScatteringCount; ++Bounce)
                         {
                             const auto Surface = Scene.Trace(Origin, Direction);
                             if (!Surface.Confirmed) break;
                             if (!Bounce) Radiance += Throughput * Scene.SelfRadiance(Surface, Sources);
                             Radiance +=
                                 Throughput *
                                 Scene.Direct(
                                     Surface, Sources, VisibilityEvaluation::Exact, 1, Sample, Pixel, Bounce * 4);
                             Direction = CosineDirection(Surface.Normal, Quadrature(Sample, 4 + Bounce * 4, Pixel));
                             if (Dot(Direction, Surface.GeometricNormal) <= 0) break;
                             Throughput = Throughput * EvaluateMaterial(Surface.Material).Reflectance;
                             Origin     = Surface.Position + Surface.GeometricNormal * 2e-4f;
                         }
                     }
                     Pixels[Pixel] = Radiance / float(Samples);
                 }
             });
    return Pixels;
}

inline void EncodePfm(const std::string& Path, const Image& Pixels)
{
    std::ofstream Output(Path, std::ios::binary);
    Require(bool(Output), "Cannot write PFM " + Path);
    Output << "PF\n" << CaptureWidth << ' ' << CaptureHeight << "\n-1.0\n";
    for (unsigned Row = CaptureHeight; Row-- > 0;)
        Output.write(reinterpret_cast<const char*>(Pixels.data() + Row * CaptureWidth), CaptureWidth * sizeof(Vector));
    Require(bool(Output), "PFM write failed " + Path);
}

inline double Milliseconds(std::chrono::steady_clock::time_point Begin)
{
    return std::chrono::duration<double, std::milli>(std::chrono::steady_clock::now() - Begin).count();
}

} // namespace Frontier::DistanceClipmapExperiment
