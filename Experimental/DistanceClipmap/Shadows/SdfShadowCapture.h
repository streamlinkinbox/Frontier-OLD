/*============================================================================================================================================
                                                           SDFSHADOWCAPTURE.H
============================================================================================================================================*/
// 🧩 Matched four-site primary quadrature, 96 total SDF paths per pixel and separately retained direct / reflected radiance.

#pragma once
#include "SdfShadowFields.h"

namespace Frontier::DistanceClipmapExperiment
{

//------------------------------------------------------------------------------------------------------------------------
//                                                  MATCHED PRIMARY / PATH BUDGETS
//------------------------------------------------------------------------------------------------------------------------

struct SdfShadowImages
{
    Image Direct, Indirect, OneBounce, Combined;

    explicit SdfShadowImages(unsigned Pixels = CaptureWidth * CaptureHeight)
        : Direct(Pixels), Indirect(Pixels), OneBounce(Pixels), Combined(Pixels)
    {
    }
};

class SdfShadowCapture
{
public:
    static constexpr unsigned  PrimarySites  = 4;
    static constexpr unsigned  PathsPerSite  = 24;
    static constexpr unsigned  PathsPerPixel = PrimarySites * PathsPerSite;
    std::vector<ShadowSurface> Surfaces;

    void Construct(const SdfShadowScene& Scene)
    {
        Surfaces.resize(CaptureWidth * CaptureHeight * PrimarySites);
        Parallel(CaptureHeight,
                 [&](unsigned Y)
                 {
                     for (unsigned X = 0; X < CaptureWidth; ++X)
                         for (unsigned Sample = 0; Sample < PrimarySites; ++Sample)
                         {
                             const auto Offset = Quadrature(Sample, 0);
                             Surfaces[(Y * CaptureWidth + X) * PrimarySites + Sample] =
                                 Scene.Trace(Scene.Color(9), Scene.CameraRay(X + Offset[0], Y + Offset[1]));
                         }
                 });
    }

    static ShadowRadiance Reference(const SdfShadowScene&  Scene,
                                    const SdfShadowFields& Fields,
                                    ShadowSurface          Surface,
                                    unsigned               Sample,
                                    unsigned               Pixel,
                                    unsigned               Sites,
                                    Vector*                FirstBounce = nullptr)
    {
        Require(Sites > 0 && Sites <= 4, "SDF reference supports one through four scattering sites");
        ShadowRadiance Sum;
        Vector         Throughput{1, 1, 1};
        for (unsigned Site = 0; Site < Sites; ++Site)
        {
            if (!Surface.Confirmed) break;
            if (Surface.Light)
            {
                // 📝 Every diffuse site uses NEE over the complete sphere cap. Secondary Le would count it twice.
                if (!Site) Sum.Direct += Scene.LightRadiance();
                break;
            }
            const Vector Arrival = Throughput * Fields.Direct(Scene, Surface, 5, 1, Pixel, Sample, 1 + Site * 4);
            if (Site == 0)
                Sum.Direct += Arrival;
            else
                Sum.Indirect += Arrival;
            if (Site == 1 && FirstBounce) *FirstBounce += Arrival;
            if (Site + 1 == Sites) break;
            const Vector Direction = ShadowCosineDirection(Surface.Normal, Quadrature(Sample, 2 + Site * 4, Pixel));
            Throughput             = Throughput * Surface.Reflectance;
            Surface = Scene.Trace(Surface.Position + Surface.Normal * SdfShadowScene::SurfaceOffset, Direction);
        }
        return Sum;
    }

    SdfShadowImages Render(const SdfShadowScene&  Scene,
                           const SdfShadowFields& Fields,
                           unsigned               Mode,
                           unsigned               Sites          = SdfShadowScene::ScatteringSites,
                           unsigned               Samples        = PathsPerSite,
                           unsigned               SequenceOffset = 0) const
    {
        Require(Mode < 6 && Samples > 0, "Unknown requested SDF shadow path or empty sample budget");
        if (Mode >= 2 && Mode <= 4) Fields.RequireFresh(Scene);
        Require(Surfaces.size() == CaptureWidth * CaptureHeight * PrimarySites, "Construct common SDF primary sites");
        SdfShadowImages Result;
        Parallel(CaptureHeight,
                 [&](unsigned Y)
                 {
                     for (unsigned X = 0; X < CaptureWidth; ++X)
                     {
                         const unsigned Pixel = Y * CaptureWidth + X;
                         for (unsigned Primary = 0; Primary < PrimarySites; ++Primary)
                         {
                             const auto& Surface = Surfaces[Pixel * PrimarySites + Primary];
                             if (!Surface.Confirmed) continue;
                             if (Mode == 5)
                             {
                                 for (unsigned Path = 0; Path < Samples; ++Path)
                                 {
                                     const auto Radiance =
                                         Reference(Scene, Fields, Surface, SequenceOffset + Primary * Samples + Path,
                                                   Pixel, Sites, &Result.OneBounce[Pixel]);
                                     Result.Direct[Pixel] += Radiance.Direct;
                                     Result.Indirect[Pixel] += Radiance.Indirect;
                                 }
                             }
                             else
                             {
                                 Result.Direct[Pixel] += Surface.Light
                                                             ? Scene.LightRadiance()
                                                             : Fields.Direct(Scene, Surface, Mode, Samples, Pixel,
                                                                             SequenceOffset + Primary * Samples);
                                 if (Mode == 3) Result.Indirect[Pixel] += Fields.Indirect(Surface);
                             }
                         }
                         const float Divisor     = Mode == 5 ? float(PrimarySites * Samples) : float(PrimarySites);
                         Result.Direct[Pixel]    = Result.Direct[Pixel] / Divisor;
                         Result.Indirect[Pixel]  = Result.Indirect[Pixel] / Divisor;
                         Result.OneBounce[Pixel] = Result.OneBounce[Pixel] / Divisor;
                         if (Mode == 3) Result.OneBounce[Pixel] = Result.Indirect[Pixel];
                         Result.Combined[Pixel] = Result.Direct[Pixel] + Result.Indirect[Pixel];
                     }
                 });
        return Result;
    }

    Image Visibility(const SdfShadowScene& Scene, const SdfShadowFields& Fields, unsigned Mode) const
    {
        Require(Mode < 6, "Unknown visibility path");
        Image Result(CaptureWidth * CaptureHeight);
        Parallel(CaptureHeight,
                 [&](unsigned Y)
                 {
                     for (unsigned X = 0; X < CaptureWidth; ++X)
                     {
                         const unsigned Pixel = Y * CaptureWidth + X;
                         float          Sum   = 0;
                         for (unsigned Primary = 0; Primary < PrimarySites; ++Primary)
                         {
                             const auto& Surface = Surfaces[Pixel * PrimarySites + Primary];
                             if (!Surface.Confirmed || Surface.Light) continue;
                             const Vector Origin = Surface.Position + Surface.Normal * SdfShadowScene::SurfaceOffset;
                             const Vector Delta  = Scene.LightCenter() - Origin;
                             const float  Limit  = Length(Delta) - Scene.LightRadius() - .002f;
                             if (Mode == 0)
                                 Sum += Scene.BinaryVisibility(Origin, Normalize(Delta), Limit);
                             else if (Mode < 4)
                                 Sum += Fields.ConeVisibility(Scene, Origin, Mode >= 2);
                             else
                             {
                                 float Integrated = 0;
                                 for (unsigned Sample = 0; Sample < PathsPerSite; ++Sample)
                                 {
                                     const auto Arrival =
                                         Scene.Arrival(Origin, Quadrature(Primary * PathsPerSite + Sample, 1, Pixel));
                                     Integrated +=
                                         Mode == 4
                                             ? Fields.HybridVisibility(Scene, Origin, Arrival.Direction, Arrival.Limit)
                                             : Scene.BinaryVisibility(Origin, Arrival.Direction, Arrival.Limit);
                                 }
                                 Sum += Integrated / PathsPerSite;
                             }
                         }
                         const float Mean = Sum / PrimarySites;
                         Result[Pixel]    = {Mean, Mean, Mean};
                     }
                 });
        return Result;
    }
};

} // namespace Frontier::DistanceClipmapExperiment
