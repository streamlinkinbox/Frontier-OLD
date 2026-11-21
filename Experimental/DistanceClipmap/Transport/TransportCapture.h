/*============================================================================================================================================
                                                          TRANSPORTCAPTURE.H
============================================================================================================================================*/
// 🧩 Shared native 480×270 primary samples and finite diffuse reference integration for matched transport comparisons.

#pragma once
#include "DiffuseProbeLattice.h"

namespace Frontier::DistanceClipmapExperiment
{

//------------------------------------------------------------------------------------------------------------------------
//                                                    FIXED PRIMARY SURFACE SAMPLES
//------------------------------------------------------------------------------------------------------------------------

struct alignas(16) TransportReceiver
{
    Vector   Position{};
    float    Confirmed = 0;
    Vector   Normal{};
    unsigned Material = 0;
    Vector   Reflectance{};
    float    Padding = 0;
};

static_assert(sizeof(TransportReceiver) == 48 && offsetof(TransportReceiver, Material) == 28);

struct alignas(16) TransportSite
{
    TransportReceiver Receiver{};
    Vector            Direct{};
    float             Padding = 0;
};

static_assert(sizeof(TransportSite) == 64 && offsetof(TransportSite, Direct) == 48);

struct PrimarySurfaceCapture
{
    static constexpr unsigned PrimarySamples = 4;
    std::vector<SurfacePoint> Surfaces;

    void Construct(const RadianceScene& Scene)
    {
        Surfaces.resize(CaptureWidth * CaptureHeight * PrimarySamples);
        Parallel(CaptureHeight,
                 [&](unsigned Y)
                 {
                     for (unsigned X = 0; X < CaptureWidth; ++X)
                         for (unsigned Sample = 0; Sample < PrimarySamples; ++Sample)
                         {
                             const auto Offset = Quadrature(Sample, 0);
                             Surfaces[(Y * CaptureWidth + X) * PrimarySamples + Sample] =
                                 Scene.Trace({8.3f, -9.5f, 5.8f}, CameraDirection(X + Offset[0], Y + Offset[1]));
                         }
                 });
    }

    static TransportReceiver Encode(const SurfacePoint& Surface)
    {
        return {Surface.Position,
                Surface.Confirmed ? 1.f : 0.f,
                Surface.Normal,
                Surface.Material,
                EvaluateMaterial(Surface.Material).Reflectance,
                0};
    }

    std::vector<TransportReceiver> Receivers() const
    {
        std::vector<TransportReceiver> Results;
        Results.reserve(Surfaces.size());
        for (const auto& Surface : Surfaces)
            Results.push_back(Encode(Surface));
        return Results;
    }

    template <class Integration> Image Capture(const Integration& Integrate) const
    {
        Image Pixels(CaptureWidth * CaptureHeight);
        Parallel(CaptureHeight,
                 [&](unsigned Y)
                 {
                     for (unsigned X = 0; X < CaptureWidth; ++X)
                     {
                         Vector         Sum{};
                         const unsigned Pixel = Y * CaptureWidth + X;
                         for (unsigned Sample = 0; Sample < PrimarySamples; ++Sample)
                         {
                             const auto& Surface = Surfaces[Pixel * PrimarySamples + Sample];
                             if (Surface.Confirmed) Sum += Integrate(Surface, Pixel);
                         }
                         Pixels[Pixel] = Sum / float(PrimarySamples);
                     }
                 });
        return Pixels;
    }

    Image Direct(const RadianceScene& Scene, unsigned Sources, unsigned Samples) const
    {
        return Capture(
            [&](const SurfacePoint& Surface, unsigned)
            {
                return Scene.Direct(Surface, Sources, VisibilityEvaluation::Hybrid, Samples) +
                       Scene.SelfRadiance(Surface, Sources);
            });
    }
};

//------------------------------------------------------------------------------------------------------------------------
//                                             FINITE SECOND / THIRD-SITE REFERENCE
//------------------------------------------------------------------------------------------------------------------------

inline Vector ReferenceIndirect(const RadianceScene& Scene,
                                const SurfacePoint&  Surface,
                                unsigned             Sources,
                                unsigned             Samples,
                                unsigned             SecondarySites,
                                unsigned             Pixel)
{
    Require(SecondarySites > 0 && SecondarySites <= 2, "Reference Sobol budget supports one or two secondary sites");
    Vector Sum{};
    for (unsigned Sample = 0; Sample < Samples; ++Sample)
    {
        auto   Current    = Surface;
        Vector Throughput = EvaluateMaterial(Current.Material).Reflectance;
        for (unsigned Site = 1; Site <= SecondarySites; ++Site)
        {
            const Vector Direction = CosineDirection(Current.Normal, Quadrature(Sample, Site * 4, Pixel));
            Current                = Scene.Trace(Current.Position + Current.GeometricNormal * 2e-4f, Direction);
            if (!Current.Confirmed) break;
            // 📝 NEE already accounts for direct emitter encounters. Never add Le again at secondary hits.
            Sum += Throughput * Scene.Direct(Current, Sources, VisibilityEvaluation::Exact, 1, Sample, Pixel, Site * 4);
            Throughput = Throughput * EvaluateMaterial(Current.Material).Reflectance;
        }
    }
    return Sum / float(Samples);
}

inline Image AddRadiance(const Image& A, const Image& B)
{
    Require(A.size() == B.size(), "Image extent mismatch");
    Image Sum(A.size());
    for (unsigned Pixel = 0; Pixel < A.size(); ++Pixel)
        Sum[Pixel] = A[Pixel] + B[Pixel];
    return Sum;
}

} // namespace Frontier::DistanceClipmapExperiment
