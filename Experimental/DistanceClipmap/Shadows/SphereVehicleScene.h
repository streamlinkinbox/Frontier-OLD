/*============================================================================================================================================
                                                         SPHEREVEHICLESCENE.H
============================================================================================================================================*/
// 🧩 Sphere-only lighting of the actual ControlVehicle, retaining unsigned baked-distance skips and explicit triangle contact refinement.

#pragma once
#include "SdfShadowCapture.h"
#include "Experimental/DistanceClipmap/Transport/TransportCapture.h"

namespace Frontier::DistanceClipmapExperiment
{

//------------------------------------------------------------------------------------------------------------------------
//                                         ACTUAL VEHICLE / SPHERE-ONLY RADIANCE CACHE
//------------------------------------------------------------------------------------------------------------------------

class SphereVehicleScene
{
public:
    RadianceScene                Geometry;
    SdfShadowScene               Sphere;
    SdfShadowFields              Reflections;
    bool                         CacheInitialized = false;
    RigidPose                    CachedPose{};
    std::array<ShadowFloat4, 13> CachedPalette{};
    bool                         CachedSourceEnabled = false;
    std::uint64_t                GeometrySignature   = 0;

    void Construct(const std::string& ArchiveDirectory)
    {
        Geometry.Construct(ArchiveDirectory);
        Geometry.LocalDistance.Bake(Geometry.Vehicle);
        GeometrySignature  = GeometryFingerprint(Geometry);
        Sphere.Palette[11] = {-2.8f, -1.6f, 2.4f, .65f};
        Sphere.Palette[12] = {35, 30, 21, 0};
    }

    Vector Direct(const SurfacePoint&  Surface,
                  unsigned             Samples,
                  unsigned             Pixel          = 0,
                  unsigned             SequenceOffset = 0,
                  VisibilityEvaluation Evaluation     = VisibilityEvaluation::Hybrid) const
    {
        if (!Surface.Confirmed || !Sphere.SourceEnabled) return {};
        const Vector Origin   = Surface.Position + Surface.GeometricNormal * .0002f;
        float        Integral = 0;
        for (unsigned Sample = 0; Sample < Samples; ++Sample)
        {
            const auto  Light  = Sphere.Arrival(Origin, Quadrature(Sample + SequenceOffset, 1, Pixel));
            const float Cosine = std::max(0.f, Dot(Surface.Normal, Light.Direction));
            if (Cosine > 0)
                Integral +=
                    Cosine * Light.SolidAngle * Geometry.Visibility(Origin, Light.Direction, Light.Limit, Evaluation);
        }
        return EvaluateMaterial(Surface.Material).Reflectance * Sphere.LightRadiance() * (Integral / (π * Samples));
    }

    bool Fresh() const
    {
        return CacheInitialized && GeometrySignature == GeometryFingerprint(Geometry) &&
               CachedPose.Translation.X == Geometry.Pose.Translation.X &&
               CachedPose.Translation.Y == Geometry.Pose.Translation.Y &&
               CachedPose.Translation.Z == Geometry.Pose.Translation.Z && CachedPose.Cosine == Geometry.Pose.Cosine &&
               CachedPose.Sine == Geometry.Pose.Sine && CachedPalette == Sphere.Palette &&
               CachedSourceEnabled == Sphere.SourceEnabled;
    }

    void RequireFresh() const
    {
        Require(Fresh(), "Refresh actual vehicle / source pose before consuming radiance cones");
    }

    bool Refresh(bool Force = false)
    {
        Require(GeometrySignature == GeometryFingerprint(Geometry),
                "Reconstruct edited vehicle geometry / materials and distance bake");
        if (!Force && Fresh()) return false;
        Geometry.Clipmap.Relocate(Geometry.Pose, Geometry.Pose.Translation + Vector{0, 0, 1}, Force);
        Reflections.Cones.Construct(Geometry);
        Parallel(unsigned(Reflections.Cones.Sites.size()),
                 [&](unsigned Index)
                 {
                     auto& Site                        = Reflections.Cones.Sites[Index];
                     Site.Direct                       = Direct(Site.Surface, 24);
                     Reflections.Cones.Radiance[Index] = Site.Direct;
                 });
        Reflections.Cones.Inject();
        CachedPose          = Geometry.Pose;
        CachedPalette       = Sphere.Palette;
        CachedSourceEnabled = Sphere.SourceEnabled;
        CacheInitialized    = true;
        return true;
    }

    Vector Indirect(const SurfacePoint& Surface) const
    {
        if (!Surface.Confirmed) return {};
        const ShadowSurface Receiver{Surface.Position,   Surface.Normal, EvaluateMaterial(Surface.Material).Reflectance,
                                     Surface.FacetIndex, true,           false};
        return Reflections.Indirect(Receiver);
    }

    //------------------------------------------------------------------------------------------------------------------------
    //                                       NATIVE ACTUAL-ARCHIVE CAPTURE, NOT ANALYTIC SDF
    //------------------------------------------------------------------------------------------------------------------------

    SdfShadowImages Render() const
    {
        RequireFresh();
        SdfShadowImages Result;
        Parallel(CaptureHeight,
                 [&](unsigned Y)
                 {
                     for (unsigned X = 0; X < CaptureWidth; ++X)
                     {
                         const unsigned Pixel = Y * CaptureWidth + X;
                         for (unsigned Primary = 0; Primary < 4; ++Primary)
                         {
                             const auto   Offset = Quadrature(Primary, 0);
                             const Vector Origin{8.3f, -9.5f, 5.8f},
                                 Direction             = CameraDirection(X + Offset[0], Y + Offset[1]);
                             const auto   Surface      = Geometry.Trace(Origin, Direction);
                             const Vector Delta        = Sphere.LightCenter() - Origin;
                             const float  Projection   = Dot(Delta, Direction);
                             const float  Discriminant = Projection * Projection - Dot(Delta, Delta) +
                                                        Sphere.LightRadius() * Sphere.LightRadius();
                             const float LightTravel =
                                 Discriminant >= 0 ? Projection - std::sqrt(Discriminant) : INFINITY;
                             if (LightTravel > 0 && LightTravel < Surface.Travel)
                             {
                                 Result.Direct[Pixel] += Sphere.LightRadiance();
                                 continue;
                             }
                             if (!Surface.Confirmed) continue;
                             Result.Direct[Pixel] += Direct(Surface, 24, Pixel, Primary * 24);
                             Result.Indirect[Pixel] += Indirect(Surface);
                         }
                         Result.Direct[Pixel]    = Result.Direct[Pixel] / 4;
                         Result.Indirect[Pixel]  = Result.Indirect[Pixel] / 4;
                         Result.OneBounce[Pixel] = Result.Indirect[Pixel];
                         Result.Combined[Pixel]  = Result.Direct[Pixel] + Result.Indirect[Pixel];
                     }
                 });
        return Result;
    }
};

} // namespace Frontier::DistanceClipmapExperiment
