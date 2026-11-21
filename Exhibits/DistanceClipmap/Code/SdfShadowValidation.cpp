/*============================================================================================================================================
                                                        SDFSHADOWVALIDATION.CPP
============================================================================================================================================*/
// 🧩 Native six-path SDF captures, independently calibrated sphere radiometry and observable distance / radiance consumption.

#include "Experimental/DistanceClipmap/Shadows/SdfShadowCapture.h"
#include <filesystem>
#include <iomanip>

using namespace Frontier::DistanceClipmapExperiment;

namespace
{

//------------------------------------------------------------------------------------------------------------------------
//                                                     NUMERIC COMPARISONS
//------------------------------------------------------------------------------------------------------------------------

float ChannelDifference(Vector A, Vector B)
{
    const auto Difference = Absolute(A - B);
    return std::max({Difference.X, Difference.Y, Difference.Z});
}

float ImageDifference(const Image& A, const Image& B)
{
    Require(A.size() == B.size(), "Different image extents");
    float Maximum = 0;
    for (unsigned Pixel = 0; Pixel < A.size(); ++Pixel)
        Maximum = std::max(Maximum, ChannelDifference(A[Pixel], B[Pixel]));
    return Maximum;
}

bool Black(const Image& Pixels)
{
    for (const auto& Rgb : Pixels)
        if (Rgb.X != 0 || Rgb.Y != 0 || Rgb.Z != 0) return false;
    return true;
}

void Encode(const std::string& Directory, const std::string& Prefix, const SdfShadowImages& Images)
{
    EncodePfm(Directory + "/" + Prefix + "Direct.pfm", Images.Direct);
    EncodePfm(Directory + "/" + Prefix + "Indirect.pfm", Images.Indirect);
    EncodePfm(Directory + "/" + Prefix + "OneBounce.pfm", Images.OneBounce);
    EncodePfm(Directory + "/" + Prefix + "Combined.pfm", Images.Combined);
}

struct NumericMeasurements
{
    unsigned             Assertions = 0, CapSegments = 0, HybridSegments = 0, HybridDifferences = 0;
    float                NormalError = 0, RadiometryRelativeError = 0, LowerExcess = 0;
    float                ClearedDistanceDifference = 0, RestoredDistanceDifference = 0;
    float                ClearedRadianceMaximum = 0, RestoredRadianceDifference = 0;
    float                FreshDistanceDifference = 0, FreshRadianceDifference = 0;
    unsigned             StaleRejections        = 0;
    float                AzimuthError           = 0;
    unsigned             ThinGrazingFarSegments = 0;
    unsigned             HybridClipSkips = 0, HybridRefinements = 0;
    std::array<float, 4> ReferencePenumbraWidths{};
};

void ValidateProfiles(const std::string& Directory, NumericMeasurements& Measurements)
{
    SdfShadowScene Scene;
    Scene.Primitives  = {{{0, 0, 1.5f}, 0, {.02f, .50f, 1.5f}, 7}};
    Scene.Palette[11] = {-3, 0, 2.4f, .43f};
    SdfShadowFields Fields;
    Fields.Refresh(Scene);
    std::ofstream Profiles(Directory + "/ShadowProfiles.csv");
    Profiles << "receiver_distance_m,lateral_m,point,analytic,voxel,hybrid,reference\n" << std::setprecision(12);
    const std::array<float, 4> Distances{.5f, 1.5f, 3, 6};
    for (unsigned Receiver = 0; Receiver < 4; ++Receiver)
    {
        float LowerCrossing = -1, UpperCrossing = -1, Previous = 0;
        for (unsigned Lateral = 0; Lateral <= 384; ++Lateral)
        {
            const float  Y = float(Lateral) * (4.5f / 384);
            const Vector Origin{Distances[Receiver], Y, .002f};
            const Vector Delta    = Scene.LightCenter() - Origin;
            const float  Limit    = Length(Delta) - Scene.LightRadius() - .002f;
            const float  Point    = Scene.BinaryVisibility(Origin, Normalize(Delta), Limit);
            const float  Analytic = Fields.ConeVisibility(Scene, Origin, false);
            const float  Voxel    = Fields.ConeVisibility(Scene, Origin, true);
            float        Hybrid = 0, Reference = 0;
            for (unsigned Sample = 0; Sample < 1024; ++Sample)
            {
                const auto Light = Scene.Arrival(Origin, Quadrature(Sample, 1));
                Hybrid += Fields.HybridVisibility(Scene, Origin, Light.Direction, Light.Limit);
                Reference += Scene.BinaryVisibility(Origin, Light.Direction, Light.Limit);
            }
            Hybrid /= 1024;
            Reference /= 1024;
            ++Measurements.Assertions;
            Require(Hybrid == Reference, "SDF cap profile changed under conservative voxel skipping");
            auto Crossing = [&](float Fraction)
            { return Y - (4.5f / 384) * (Reference - Fraction) / std::max(1e-8f, Reference - Previous); };
            if (LowerCrossing < 0 && Reference >= .1f) LowerCrossing = Crossing(.1f);
            if (UpperCrossing < 0 && Reference >= .9f) UpperCrossing = Crossing(.9f);
            Previous = Reference;
            Profiles << Distances[Receiver] << ',' << Y << ',' << Point << ',' << Analytic << ',' << Voxel << ','
                     << Hybrid << ',' << Reference << '\n';
        }
        ++Measurements.Assertions;
        Require(LowerCrossing >= 0 && UpperCrossing > LowerCrossing,
                "Finite-source profile lacks resolved 10–90 percent edge");
        Measurements.ReferencePenumbraWidths[Receiver] = UpperCrossing - LowerCrossing;
        if (Receiver > 0)
        {
            ++Measurements.Assertions;
            Require(Measurements.ReferencePenumbraWidths[Receiver] > Measurements.ReferencePenumbraWidths[Receiver - 1],
                    "Finite spherical-source penumbra did not widen with receiver separation");
        }
    }
    Require(bool(Profiles), "Cannot retain native SDF shadow profiles");
    Scene.Primitives[0].Extent = {.0025f, .02f, 1.5f};
    for (unsigned Index = 0; Index < 64; ++Index)
        for (int Side : {-1, 1})
            for (unsigned Outside = 0; Outside < 2; ++Outside)
            {
                const float  Distance = .125f + float(Index) * (24.f / 64);
                const float  Y        = float(Side) * (.02f * (1 + Distance / 3) + (Outside ? .02f : -.02f));
                const Vector Origin{Distance, Y, .002f}, Delta = Scene.LightCenter() - Origin;
                const float  Limit      = Length(Delta) - Scene.LightRadius() - .002f;
                const Vector Direction  = Normalize(Delta);
                float        Near       = 0;
                const bool   Intersects = FacetAtlas::IntersectEnclosure(Origin, Direction, {-.0025f, -.02f, 0},
                                                                         {.0025f, .02f, 3}, 0, Limit, Near);
                const bool   Sdf        = Scene.BinaryVisibility(Origin, Direction, Limit) == 0;
                ++Measurements.Assertions;
                ++Measurements.ThinGrazingFarSegments;
                Require(Sdf == Intersects,
                        "5 mm contact / grazing / far shadow disagrees with independent slab intersection");
            }
}

NumericMeasurements Validate(SdfShadowScene& Scene, SdfShadowFields& Fields, const std::string& Directory)
{
    NumericMeasurements Measurements;
    auto                Assert = [&](bool Condition, const std::string& Description)
    {
        ++Measurements.Assertions;
        Require(Condition, Description);
    };
    for (unsigned Index = 0; Index <= 16384; ++Index)
    {
        const float θ    = 2 * π * float(Index) / 16384;
        const auto  Pair = ShadowAzimuth(θ);
        Measurements.AzimuthError =
            std::max({Measurements.AzimuthError, std::abs(Pair[0] - std::cos(θ)), std::abs(Pair[1] - std::sin(θ))});
    }
    Assert(Measurements.AzimuthError < 3e-7f, "Shared azimuth polynomial exceeds independent host trig tolerance");
    const ShadowPrimitive Sphere{{1, 2, 3}, 1, {.7f, 0, 0}, 0};
    const ShadowPrimitive Cylinder{{0, 0, 0}, 2, {.4f, 0, 1.2f}, 0};
    const ShadowPrimitive Torus{{0, 0, 0}, 3, {.7f, .2f, 0}, 0};
    Assert(std::abs(PrimitiveDistance(Sphere, {1, 2, 3}) + .7f) < 1e-6f, "Sphere interior sign");
    Assert(std::abs(PrimitiveDistance(Cylinder, {0, 0, 0}) + .4f) < 1e-6f, "Cylinder interior sign");
    Assert(std::abs(PrimitiveDistance(Cylinder, {0, 0, 1.5f}) - .3f) < 1e-6f, "Cylinder cap");
    Assert(std::abs(PrimitiveDistance(Torus, {.7f, 0, 0}) + .2f) < 1e-6f, "Torus tube sign");
    Assert(std::abs(PrimitiveDistance(Torus, {0, 0, 0}) - .5f) < 1e-6f, "Torus hole sign");
    for (const auto& Primitive : Scene.Primitives)
        for (unsigned Index = 0; Index < 64; ++Index)
        {
            const auto      Pair           = Quadrature(Index, 7);
            const Vector    Direction      = Normalize({2 * Pair[0] - 1, 2 * Pair[1] - 1, .37f});
            const Vector    Position       = Primitive.Position + Direction * 1.73f;
            constexpr float DifferenceStep = .0005f;
            const Vector    Gradient{PrimitiveDistance(Primitive, Position + Vector{DifferenceStep, 0, 0}) -
                                      PrimitiveDistance(Primitive, Position - Vector{DifferenceStep, 0, 0}),
                                  PrimitiveDistance(Primitive, Position + Vector{0, DifferenceStep, 0}) -
                                      PrimitiveDistance(Primitive, Position - Vector{0, DifferenceStep, 0}),
                                  PrimitiveDistance(Primitive, Position + Vector{0, 0, DifferenceStep}) -
                                      PrimitiveDistance(Primitive, Position - Vector{0, 0, DifferenceStep})};
            Measurements.NormalError = std::max(
                Measurements.NormalError, ChannelDifference(Normalize(Gradient), PrimitiveNormal(Primitive, Position)));
        }
    Assert(Measurements.NormalError < .002f, "Analytic geometric normals disagree with independent finite differences");
    SdfShadowScene Empty;
    Empty.Primitives.clear();
    const Vector  Origin = Empty.LightCenter() + Vector{0, 0, 4};
    ShadowSurface Receiver{Origin, {0, 0, -1}, {.7f, .6f, .5f}, 0, true, false};
    const auto    Integral = Fields.Direct(Empty, Receiver, 5, 65536);
    const float   Distance = Length(Empty.LightCenter() - (Origin + Receiver.Normal * SdfShadowScene::SurfaceOffset));
    const auto    Expected = Receiver.Reflectance * Empty.LightRadiance() *
                          (Empty.LightRadius() * Empty.LightRadius() / (Distance * Distance));
    Measurements.RadiometryRelativeError = ChannelDifference(Integral, Expected) / Expected.X;
    Assert(Measurements.RadiometryRelativeError < .0002f,
           "Uniform sphere irradiance disagrees with analytic projected solid angle");
    for (unsigned Index = 0; Index < 8192; ++Index)
    {
        const auto   Pair = Quadrature(Index, 5);
        const Vector Position{-3.5f + 7 * Pair[0], -3.4f + 6.6f * Pair[1], .002f + .001f * float(Index % 2500)};
        const auto   Sample      = Fields.Sample(Position, true);
        const float  Exact       = std::max(0.f, Scene.Distance(Position, false).Distance);
        Measurements.LowerExcess = std::max(Measurements.LowerExcess, Sample.Lower - Exact);
        Assert(!Sample.Known || Sample.Lower <= Exact + 3e-5f, "Signed clipmap lower bound exceeds analytic distance");
        if (Scene.Distance(Position, true).Distance < .002f) continue;
        const auto   Arrival  = Scene.Arrival(Position, Quadrature(Index, 1));
        const Vector Endpoint = Position + Arrival.Direction * (Arrival.Limit + SdfShadowScene::SurfaceOffset);
        Assert(std::abs(Length(Endpoint - Scene.LightCenter()) - Scene.LightRadius()) < .0003f,
               "Spherical-cap direction or finite segment does not reach emitter surface");
        ++Measurements.CapSegments;
        const float Binary = Scene.BinaryVisibility(Position, Arrival.Direction, Arrival.Limit);
        const float Hybrid = Fields.HybridVisibility(Scene, Position, Arrival.Direction, Arrival.Limit,
                                                     &Measurements.HybridClipSkips, &Measurements.HybridRefinements);
        ++Measurements.HybridSegments;
        if (Binary != Hybrid) ++Measurements.HybridDifferences;
    }
    Assert(Measurements.HybridDifferences == 0, "Conservative clip skipping changed SDF binary visibility");
    Assert(Measurements.HybridClipSkips > 0 && Measurements.HybridRefinements > 0,
           "Hybrid did not exercise both voxel skips and SDF refinement");
    const auto                 SavedDistance = Fields.Distances;
    std::vector<ShadowSurface> Receivers;
    for (unsigned Index = 0; Index < 256; ++Index)
    {
        const auto Pair = Quadrature(Index, 3);
        Receivers.push_back(Scene.Surface({-3 + 6 * Pair[0], -3 + 6 * Pair[1], 0}, 0));
    }
    Image Baseline, CullDisabled;
    for (const auto& Surface : Receivers)
    {
        Baseline.push_back(Fields.Direct(Scene, Surface, 2, 16));
        CullDisabled.push_back(Fields.Direct(Scene, Surface, 4, 16));
    }
    std::fill(Fields.Distances.begin(), Fields.Distances.end(), 1000.f);
    for (unsigned Index = 0; Index < Receivers.size(); ++Index)
        Measurements.ClearedDistanceDifference =
            std::max(Measurements.ClearedDistanceDifference,
                     ChannelDifference(Baseline[Index], Fields.Direct(Scene, Receivers[Index], 2, 16)));
    Assert(Measurements.ClearedDistanceDifference > .001f, "Voxel penumbra did not consume resident signed distances");
    std::fill(Fields.Distances.begin(), Fields.Distances.end(), 0.f);
    for (unsigned Index = 0; Index < Receivers.size(); ++Index)
        Assert(ChannelDifference(CullDisabled[Index], Fields.Direct(Scene, Receivers[Index], 4, 16)) < 1e-6f,
               "Disabling conservative skips changed cap visibility");
    Fields.Distances = SavedDistance;
    Image RestoredDistance;
    for (const auto& Surface : Receivers)
        RestoredDistance.push_back(Fields.Direct(Scene, Surface, 2, 16));
    Measurements.RestoredDistanceDifference = ImageDifference(Baseline, RestoredDistance);
    Assert(Measurements.RestoredDistanceDifference == 0, "Signed-distance restore is not exact");
    const auto SavedRadiance = Fields.Cones.Radiance;
    Image      Reflected;
    for (const auto& Surface : Receivers)
        Reflected.push_back(Fields.Indirect(Surface));
    std::fill(Fields.Cones.Radiance.begin(), Fields.Cones.Radiance.end(), Vector{});
    Fields.Cones.Inject();
    for (const auto& Surface : Receivers)
    {
        const auto Rgb                      = Fields.Indirect(Surface);
        Measurements.ClearedRadianceMaximum = std::max(Measurements.ClearedRadianceMaximum, ChannelDifference(Rgb, {}));
    }
    Assert(Measurements.ClearedRadianceMaximum == 0, "Cleared reflected surface radiance did not black cone GI");
    Assert(!Black(Reflected), "Reflected-radiance baseline is black");
    Fields.Cones.Radiance = SavedRadiance;
    Fields.Cones.Inject();
    for (unsigned Index = 0; Index < Receivers.size(); ++Index)
        Measurements.RestoredRadianceDifference =
            std::max(Measurements.RestoredRadianceDifference,
                     ChannelDifference(Reflected[Index], Fields.Indirect(Receivers[Index])));
    Assert(Measurements.RestoredRadianceDifference == 0, "Reflected-radiance restore is not exact");
    Scene.Primitives[4].Position.X += .21f;
    Scene.Palette[11][0] += .13f;
    try
    {
        Fields.RequireFresh(Scene);
    }
    catch (const std::runtime_error&)
    {
        ++Measurements.StaleRejections;
    }
    Assert(Measurements.StaleRejections == 1, "Motion did not reject stale SDF / radiance");
    Assert(Fields.Refresh(Scene), "Motion failed to refresh SDF / reflected radiance");
    SdfShadowFields Cold;
    Assert(Cold.Refresh(Scene), "Fresh moved scene did not initialize");
    for (unsigned Index = 0; Index < Fields.Distances.size(); ++Index)
        Measurements.FreshDistanceDifference =
            std::max(Measurements.FreshDistanceDifference, std::abs(Fields.Distances[Index] - Cold.Distances[Index]));
    for (unsigned Index = 0; Index < Fields.Cones.Voxels.size(); ++Index)
        Measurements.FreshRadianceDifference =
            std::max(Measurements.FreshRadianceDifference,
                     ChannelDifference(Fields.Cones.Voxels[Index].Radiance, Cold.Cones.Voxels[Index].Radiance));
    Assert(Measurements.FreshDistanceDifference == 0 && Measurements.FreshRadianceDifference == 0,
           "Warm moving refresh differs from independent cold construction");
    Assert(!Fields.Refresh(Scene), "Unchanged SDF scene unnecessarily refreshed");
    Scene = SdfShadowScene{};
    Fields.Refresh(Scene);
    ValidateProfiles(Directory, Measurements);
    return Measurements;
}

void WriteNumeric(const std::string& Directory, const NumericMeasurements& Measurements, double Duration)
{
    std::ofstream Report(Directory + "/ShadowNumeric.json");
    Report << std::setprecision(12) << "{\n  \"passed\": true,\n  \"renderer_accepted\": false,\n"
           << "  \"assertions\": " << Measurements.Assertions
           << ",\n  \"azimuth_independent_max_error\": " << Measurements.AzimuthError
           << ",\n  \"thin_grazing_far_segments\": " << Measurements.ThinGrazingFarSegments
           << ",\n  \"penumbra_receiver_distances_m\": [0.5, 1.5, 3, 6]"
           << ",\n  \"penumbra_10_90_widths_m\": [" << Measurements.ReferencePenumbraWidths[0] << ", "
           << Measurements.ReferencePenumbraWidths[1] << ", " << Measurements.ReferencePenumbraWidths[2] << ", "
           << Measurements.ReferencePenumbraWidths[3] << "]"
           << ",\n  \"sphere_cap_segments\": " << Measurements.CapSegments
           << ",\n  \"normal_max_error\": " << Measurements.NormalError
           << ",\n  \"sphere_irradiance_relative_error\": " << Measurements.RadiometryRelativeError
           << ",\n  \"hybrid_segments\": " << Measurements.HybridSegments
           << ",\n  \"hybrid_visibility_differences\": " << Measurements.HybridDifferences
           << ",\n  \"hybrid_clip_skips\": " << Measurements.HybridClipSkips
           << ",\n  \"hybrid_sdf_refinements\": " << Measurements.HybridRefinements
           << ",\n  \"distance_lower_excess\": " << Measurements.LowerExcess
           << ",\n  \"distance_clear_rgb_difference\": " << Measurements.ClearedDistanceDifference
           << ",\n  \"distance_restore_rgb_difference\": " << Measurements.RestoredDistanceDifference
           << ",\n  \"radiance_clear_maximum\": " << Measurements.ClearedRadianceMaximum
           << ",\n  \"radiance_restore_difference\": " << Measurements.RestoredRadianceDifference
           << ",\n  \"motion_stale_rejections\": " << Measurements.StaleRejections
           << ",\n  \"motion_cold_distance_difference\": " << Measurements.FreshDistanceDifference
           << ",\n  \"motion_cold_radiance_difference\": " << Measurements.FreshRadianceDifference
           << ",\n  \"cpu_ms_including_setup\": " << Duration << "\n}\n";
    Require(bool(Report), "Cannot retain SDF numeric report");
}

//------------------------------------------------------------------------------------------------------------------------
//                                                 REPEATED MATCHED-INPUT CPU TIMING
//------------------------------------------------------------------------------------------------------------------------

std::uint64_t ImageDigest(const Image& Pixels)
{
    std::uint64_t Digest = 14695981039346656037ull;
    const auto*   Octets = reinterpret_cast<const unsigned char*>(Pixels.data());
    for (std::size_t Index = 0; Index < Pixels.size() * sizeof(Vector); ++Index)
    {
        Digest ^= Octets[Index];
        Digest *= 1099511628211ull;
    }
    return Digest;
}

void Benchmark(const std::string&     Directory,
               const SdfShadowScene&  Scene,
               const SdfShadowFields& Fields,
               double                 ColdConstructionDuration)
{
    SdfShadowCapture Primary;
    const auto       PrimaryBegin = std::chrono::steady_clock::now();
    Primary.Construct(Scene);
    const double                 PrimaryDuration = Milliseconds(PrimaryBegin);
    std::array<std::uint64_t, 7> Digests{};
    std::ofstream                Timings(Directory + "/ShadowBenchmark.csv");
    Timings << "selection,round,cpu_ms,fnv1a64\n" << std::setprecision(12);
    for (int Round = -1; Round < 5; ++Round)
        for (unsigned Sequence = 0; Sequence < 7; ++Sequence)
        {
            const unsigned Mode     = Round >= 0 && Round % 2 ? 6 - Sequence : Sequence;
            const auto     Begin    = std::chrono::steady_clock::now();
            const auto     Pixels   = Primary.Render(Scene, Fields, Mode == 6 ? 5 : Mode, Mode == 6 ? 1 : 4);
            const double   Duration = Milliseconds(Begin);
            const auto     Digest   = ImageDigest(Pixels.Combined);
            if (Round == -1) Digests[Mode] = Digest;
            Require(Digests[Mode] == Digest, "Repeated SDF transport changed native Float32 output");
            Timings << Mode << ',' << Round << ',' << Duration << ',' << Digest << '\n';
            Timings.flush();
            std::cout << "SDF CPU benchmark " << Round << " / " << Mode << " : " << Duration << " ms" << std::endl;
        }
    std::ofstream Report(Directory + "/ShadowBenchmark.json");
    Report << std::setprecision(12) << "{\n  \"passed\": true,\n  \"rounds\": 5,\n  \"warmup_rounds\": 1,\n"
           << "  \"threads\": 2,\n  \"width\": 480,\n  \"height\": 270,\n  \"primary_sites\": 4,\n"
           << "  \"cap_samples_each_primary\": 24,\n  \"reference_paths_total_pixel\": 96,\n"
           << "  \"selection6\": \"SDF reference direct only, one scattering site, 96 paths total per pixel\",\n"
           << "  \"alternating_order\": true,\n  \"bit_identical_repeats\": true,\n  \"primary_cpu_ms\": "
           << PrimaryDuration << ",\n  \"cold_distance_and_radiance_cpu_ms\": " << ColdConstructionDuration
           << ",\n  \"timed_region\": \"transport image allocation and integration; excludes primary tracing, "
              "field/cache construction, hashing and file encoding\",\n"
           << "  \"hardware_gpu_timing\": false,\n  \"renderer_accepted\": false\n}\n";
    Require(bool(Timings) && bool(Report), "Cannot retain repeated SDF benchmark");
}

//------------------------------------------------------------------------------------------------------------------------
//                                                    NATIVE FLOAT32 CAPTURES
//------------------------------------------------------------------------------------------------------------------------

void Render(const std::string& Directory, SdfShadowScene& Scene, SdfShadowFields& Fields, bool Preview)
{
    SdfShadowCapture Primary;
    Primary.Construct(Scene);
    std::ofstream Timings(Directory + "/ShadowTimings.csv");
    Timings << "operation,cpu_ms\n" << std::setprecision(12);
    for (unsigned Mode = 0; Mode < 6; ++Mode)
    {
        if (Preview && Mode != 1) continue;
        const auto Begin  = std::chrono::steady_clock::now();
        const auto Pixels = Primary.Render(Scene, Fields, Mode);
        Timings << "path" << Mode << ',' << Milliseconds(Begin) << '\n';
        Timings.flush();
        Encode(Directory, "Shadow" + std::to_string(Mode), Pixels);
        std::cout << "Rendered path " << Mode << std::endl;
        if (!Preview)
            EncodePfm(Directory + "/Shadow" + std::to_string(Mode) + "Visibility.pfm",
                      Primary.Visibility(Scene, Fields, Mode));
    }
    if (Preview) return;
    Image Analytic(CaptureWidth * CaptureHeight), Voxel(Analytic.size()), Normals(Analytic.size()),
        Masks(Analytic.size());
    for (unsigned Y = 0; Y < CaptureHeight; ++Y)
        for (unsigned X = 0; X < CaptureWidth; ++X)
        {
            const unsigned Pixel = Y * CaptureWidth + X;
            const Vector   Position{-4 + (X + .5f) * 8 / CaptureWidth, -3.5f + (Y + .5f) * 7 / CaptureHeight, .30f};
            const float    Signed = Scene.Distance(Position, false).Distance;
            const auto     Sample = Fields.Sample(Position);
            Analytic[Pixel]       = {Signed, Signed, Signed};
            Voxel[Pixel]          = {Sample.Raw, Sample.Raw, Sample.Raw};
            for (unsigned SampleIndex = 0; SampleIndex < SdfShadowCapture::PrimarySites; ++SampleIndex)
            {
                const auto& Surface = Primary.Surfaces[Pixel * SdfShadowCapture::PrimarySites + SampleIndex];
                if (Surface.Confirmed)
                {
                    Normals[Pixel] += (Surface.Normal * .5f + Vector{.5f, .5f, .5f}) * .25f;
                    Masks[Pixel] += Vector{1, Surface.Primitive == 0 ? 1.f : 0.f, Surface.Light ? 1.f : 0.f} * .25f;
                }
            }
        }
    EncodePfm(Directory + "/ShadowAnalyticSlice.pfm", Analytic);
    EncodePfm(Directory + "/ShadowVoxelSlice.pfm", Voxel);
    EncodePfm(Directory + "/ShadowNormals.pfm", Normals);
    EncodePfm(Directory + "/ShadowPrimaryMasks.pfm", Masks);
    const auto SourceSignature = SdfShadowFields::Fingerprint(Scene);
    Scene.SourceEnabled        = false;
    Fields.Refresh(Scene);
    for (unsigned Mode = 0; Mode < 6; ++Mode)
    {
        const auto Pixels = Primary.Render(Scene, Fields, Mode);
        Require(Black(Pixels.Direct) && Black(Pixels.Indirect) && Black(Pixels.Combined),
                "Sphere-off SDF capture is not exactly black");
        EncodePfm(Directory + "/Shadow" + std::to_string(Mode) + "Off.pfm", Pixels.Combined);
    }
    std::ofstream Report(Directory + "/ShadowCapture.json");
    Report << std::setprecision(12) << "{\n  \"passed\": true,\n  \"paths_rendered\": [0, 1, 2, 3, 4, 5],\n"
           << "  \"width\": 480,\n  \"height\": 270,\n  \"native_captures\": 40,\n  \"primary_sites\": 4,\n"
           << "  \"paths_per_primary_site_reference\": 24,\n  \"paths_total_per_pixel_reference\": 96,\n"
           << "  \"nee_samples_each_path_site\": 1,\n  \"max_scattering_sites_reference\": 4,\n"
           << "  \"sphere_center_radius_m\": [" << Scene.Palette[11][0] << ", " << Scene.Palette[11][1] << ", "
           << Scene.Palette[11][2] << ", " << Scene.Palette[11][3] << "],\n  \"sphere_radiance_rgb\": ["
           << Scene.Palette[12][0] << ", " << Scene.Palette[12][1] << ", " << Scene.Palette[12][2]
           << "],\n  \"other_sources\": 0,\n  \"source_off_black_pixels\": " << 6 * CaptureWidth * CaptureHeight
           << ",\n  \"shadow_step_limit\": 256,\n  \"hit_tolerance_m\": 0.0004,\n  \"surface_offset_m\": 0.002,\n"
           << "  \"shadow_grid_extent\": [64, 64, 64],\n  \"shadow_cell_widths_m\": [0.0625, 0.125, 0.25],\n"
           << "  \"radiance_cell_widths_m\": [0.125, 0.25, 0.5],\n  \"radiance_mips_each_level\": 7,\n"
           << "  \"radiance_cones\": 16,\n  \"cone_normal_offset_m\": 0.16,\n  \"cone_initial_travel_m\": 0.125,\n"
           << "  \"scene_input_fnv1a64\": \"" << SourceSignature << "\",\n  \"float32_transport\": true,\n"
           << "  \"native_cpp_cpu_captures\": true,\n  \"renderer_accepted\": false\n}\n";
    Require(bool(Report), "Cannot retain six-path SDF capture report");
    std::cout << "Six complete source-off captures are exactly black" << std::endl;
}

} // namespace

//------------------------------------------------------------------------------------------------------------------------
//                                                           ENTRY POINT
//------------------------------------------------------------------------------------------------------------------------

int main(int Count, char** Arguments)
{
    try
    {
        Require(Count == 3, "Usage: SdfShadowValidation <output-directory> <validate|render|preview|benchmark>");
        const std::string Directory = Arguments[1], Operation = Arguments[2];
        Require(Operation == "validate" || Operation == "render" || Operation == "preview" || Operation == "benchmark",
                "Unknown SDF shadow operation");
        std::filesystem::create_directories(Directory);
        const auto      Begin = std::chrono::steady_clock::now();
        SdfShadowScene  Scene;
        SdfShadowFields Fields;
        Fields.Refresh(Scene);
        std::cout << "Constructed " << Fields.Distances.size() << " signed voxels and " << Fields.Cones.Radiance.size()
                  << " reflected sites" << std::endl;
        if (Operation == "validate")
        {
            const auto Measurements = Validate(Scene, Fields, Directory);
            WriteNumeric(Directory, Measurements, Milliseconds(Begin));
        }
        else if (Operation == "benchmark")
            Benchmark(Directory, Scene, Fields, Milliseconds(Begin));
        else
            Render(Directory, Scene, Fields, Operation == "preview");
        std::cout << "SDF shadow " << Operation << " completed" << std::endl;
        return 0;
    }
    catch (const std::exception& Error)
    {
        std::cerr << "SDF shadow failure: " << Error.what() << '\n';
        return 1;
    }
}
