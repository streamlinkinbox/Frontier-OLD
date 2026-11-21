/*============================================================================================================================================
                                                         CONSUMPTIONVALIDATION.CPP
============================================================================================================================================*/
// 🧩 Native ablations that distinguish allocated distance/radiance storage from actual reads by its experimental consumers.

#include "Experimental/DistanceClipmap/RadianceScene.h"

#include <filesystem>
#include <iomanip>
#include <iostream>

using namespace Frontier::DistanceClipmapExperiment;

namespace
{

//------------------------------------------------------------------------------------------------------------------------
//                                                     MATCHED VISIBILITY QUERIES
//------------------------------------------------------------------------------------------------------------------------

struct RayFootprint
{
    Vector Origin{};
    Vector Direction{};
};

struct ClipConsumption
{
    unsigned OriginalSteps  = 0;
    unsigned ClearedSteps   = 0;
    unsigned AlteredQueries = 0;
};

RayFootprint EvaluateRay(unsigned Index)
{
    const auto   FirstPair  = Quadrature(Index, 0);
    const auto   SecondPair = Quadrature(Index, 1);
    const auto   ThirdPair  = Quadrature(Index, 2);
    const Vector Origin{FirstPair[0] * 12 - 6, FirstPair[1] * 9 - 4.5f, .001f + SecondPair[0] * 3};
    const Vector Target{SecondPair[1] * 6 - 3, ThirdPair[0] * 2 - 1, ThirdPair[1] * 1.5f + .1f};
    return {Origin, Normalize(Target - Origin)};
}

ClipConsumption ValidateClipConsumption(RadianceScene& Scene)
{
    constexpr unsigned               QueryCount = 4096;
    std::array<unsigned, QueryCount> OriginalSteps{};
    std::array<bool, QueryCount>     OriginalVisibility{};
    const auto                       RetainedClips = Scene.Clipmap;
    ClipConsumption                  Measurements;

    for (unsigned Index = 0; Index < QueryCount; ++Index)
    {
        const auto Ray = EvaluateRay(Index);
        OriginalVisibility[Index] =
            Scene.CarOccluded(Ray.Origin, Ray.Direction, 20, VisibilityEvaluation::Hybrid, &OriginalSteps[Index]);
        const bool TriangleVisibility = Scene.CarOccluded(Ray.Origin, Ray.Direction, 20, VisibilityEvaluation::Exact);
        Require(OriginalVisibility[Index] == TriangleVisibility, "Original consumption query differs from triangles");
        Measurements.OriginalSteps += OriginalSteps[Index];
    }

    // 📝 The marcher reads Lower, not Raw. Zero is conservative but disables positive empty-space strides.
    for (auto& Grid : Scene.Clipmap.Levels)
        for (auto& Texel : Grid.Texels)
            Texel.Lower = 0;

    for (unsigned Index = 0; Index < QueryCount; ++Index)
    {
        const auto Ray      = EvaluateRay(Index);
        unsigned   Steps    = 0;
        const bool Occluded = Scene.CarOccluded(Ray.Origin, Ray.Direction, 20, VisibilityEvaluation::Hybrid, &Steps);
        Require(Occluded == OriginalVisibility[Index],
                "Clearing clip lower distances changes triangle-refined visibility");
        Measurements.ClearedSteps += Steps;
        Measurements.AlteredQueries += Steps != OriginalSteps[Index];
    }

    Scene.Clipmap = RetainedClips;
    Require(Measurements.AlteredQueries > 0, "Clip lower-distance ablation did not reach the marcher");
    Require(Measurements.OriginalSteps > Measurements.ClearedSteps, "No positive distance strides were observed");
    return Measurements;
}

unsigned ValidateBakeConsumption(RadianceScene& Scene)
{
    const auto RetainedSamples = Scene.LocalDistance.Samples;
    const auto RetainedClips   = Scene.Clipmap;
    std::fill(Scene.LocalDistance.Samples.begin(), Scene.LocalDistance.Samples.end(), 0.f);
    Scene.Clipmap.Relocate(Scene.Pose, {0, 0, 1}, true);

    unsigned AlteredTexels = 0;
    for (unsigned Tier = 0; Tier < DistanceClipmap::LevelCount; ++Tier)
    {
        const auto& Original = RetainedClips.Levels[Tier].Texels;
        const auto& Cleared  = Scene.Clipmap.Levels[Tier].Texels;
        for (unsigned Index = 0; Index < Original.size(); ++Index)
            AlteredTexels += Original[Index].Raw != Cleared[Index].Raw || Original[Index].Lower != Cleared[Index].Lower;
    }

    Scene.LocalDistance.Samples = RetainedSamples;
    Scene.Clipmap               = RetainedClips;
    Require(AlteredTexels > 0, "Local bake ablation did not affect clip construction");
    return AlteredTexels;
}

//------------------------------------------------------------------------------------------------------------------------
//                                                      RADIANCE CACHE ABLATION
//------------------------------------------------------------------------------------------------------------------------

struct RadianceConsumption
{
    unsigned PositiveReceivers = 0;
    Vector   ReflectedSum{};
};

SurfacePoint EvaluateReceiver(unsigned Index)
{
    const Vector Position{(float(Index % 8) - 3.5f) * .8f, (float(Index / 8) - 3.5f) * .6f, 0};
    return {true, false, true, 0, 0, Position, {0, 0, 1}, {0, 0, 1}, 0};
}

RadianceConsumption ValidateRadianceConsumption(RadianceScene& Scene)
{
    constexpr unsigned                ReceiverCount = 64;
    constexpr unsigned                GatherSamples = 128;
    std::array<Vector, ReceiverCount> OriginalGi{}, OriginalDirect{};
    Scene.Relight(Point, 1);
    const auto          RetainedVehicle = Scene.VehicleCache;
    const auto          RetainedStatic  = Scene.StaticCache;
    const auto          RetainedGround  = Scene.GroundCache;
    RadianceConsumption Measurements;

    for (unsigned Index = 0; Index < ReceiverCount; ++Index)
    {
        const auto Receiver   = EvaluateReceiver(Index);
        OriginalGi[Index]     = Scene.Indirect(Receiver, Point, GatherSamples, true, Index);
        OriginalDirect[Index] = Scene.Direct(Receiver, Point, VisibilityEvaluation::Exact, 1);
        Measurements.PositiveReceivers += Luminance(OriginalGi[Index]) > 0;
        Measurements.ReflectedSum += OriginalGi[Index];
    }
    Require(Measurements.PositiveReceivers > 0, "Cache consumption fixture has no reflected radiance");

    // 📝 Sources, geometry and masks stay fixed. Only stored reflected radiance is removed.
    std::fill(Scene.VehicleCache.begin(), Scene.VehicleCache.end(), Vector{});
    std::fill(Scene.StaticCache.begin(), Scene.StaticCache.end(), Vector{});
    std::fill(Scene.GroundCache.begin(), Scene.GroundCache.end(), Vector{});
    for (unsigned Index = 0; Index < ReceiverCount; ++Index)
    {
        const auto Receiver = EvaluateReceiver(Index);
        const auto Cleared  = Scene.Indirect(Receiver, Point, GatherSamples, true, Index);
        const auto Direct   = Scene.Direct(Receiver, Point, VisibilityEvaluation::Exact, 1);
        Require(Cleared.X == 0 && Cleared.Y == 0 && Cleared.Z == 0, "Cleared CPU radiance cache still supplies GI");
        Require(std::memcmp(&Direct, &OriginalDirect[Index], sizeof(Vector)) == 0,
                "Cache ablation changed direct lighting");
    }

    Scene.VehicleCache = RetainedVehicle;
    Scene.StaticCache  = RetainedStatic;
    Scene.GroundCache  = RetainedGround;
    for (unsigned Index = 0; Index < ReceiverCount; ++Index)
    {
        const auto Restored = Scene.Indirect(EvaluateReceiver(Index), Point, GatherSamples, true, Index);
        Require(std::memcmp(&Restored, &OriginalGi[Index], sizeof(Vector)) == 0,
                "Restored CPU cache did not restore exact GI");
    }

    bool SourceMismatchRejected = false;
    try
    {
        Scene.Indirect(EvaluateReceiver(0), Sun, 1, true, 0);
    }
    catch (const std::runtime_error& Failure)
    {
        Require(std::string(Failure.what()) == "Stale source selection in surface cache",
                "Unrelated source-mask rejection");
        SourceMismatchRejected = true;
    }
    Require(SourceMismatchRejected, "Mismatched source mask was allowed to read a stale cache");
    return Measurements;
}

} // namespace

//------------------------------------------------------------------------------------------------------------------------
//                                                               MAIN
//------------------------------------------------------------------------------------------------------------------------

int main(int ArgumentCount, char** Arguments)
{
    try
    {
        Require(ArgumentCount == 3, "Usage: ConsumptionValidation <vehicle archive directory> <report path>");
        RadianceScene Scene;
        Scene.Construct(Arguments[1]);
        Scene.LocalDistance.Bake(Scene.Vehicle);
        Scene.Clipmap.Relocate({}, {0, 0, 1});
        const unsigned AlteredTexels     = ValidateBakeConsumption(Scene);
        const auto     ClipMeasurements  = ValidateClipConsumption(Scene);
        const auto     CacheMeasurements = ValidateRadianceConsumption(Scene);

        const std::filesystem::path Destination = Arguments[2];
        if (!Destination.parent_path().empty()) std::filesystem::create_directories(Destination.parent_path());
        std::ofstream Report(Destination);
        Require(bool(Report), "Cannot create consumption report");
        Report
            << std::setprecision(12) << "{\n  \"local_bake_ablation_altered_clip_texels\": " << AlteredTexels
            << ",\n  \"visibility_queries\": 4096,\n  \"original_distance_steps\": " << ClipMeasurements.OriginalSteps
            << ",\n  \"cleared_lower_distance_steps\": " << ClipMeasurements.ClearedSteps
            << ",\n  \"queries_with_altered_step_count\": " << ClipMeasurements.AlteredQueries
            << ",\n  \"both_visibility_selections_equal_triangles\": true,"
            << "\n  \"cache_receivers\": 64,\n  \"gather_samples_per_receiver\": 128,"
            << "\n  \"positive_cache_receivers\": " << CacheMeasurements.PositiveReceivers
            << ",\n  \"original_reflected_rgb_sum\": [" << CacheMeasurements.ReflectedSum.X << ", "
            << CacheMeasurements.ReflectedSum.Y << ", " << CacheMeasurements.ReflectedSum.Z << "],"
            << "\n  \"cleared_cache_indirect_exact_black\": true,\n  \"direct_unchanged_during_cache_ablation\": true,"
            << "\n  \"restored_cache_indirect_bit_equal\": true,\n  \"mismatched_source_mask_rejected\": true,"
            << "\n  \"scope\": \"Native CPU data-flow ablations; not image quality, speed, cone GI, DDGI or automatic "
               "pose/light revision tracking.\"\n}\n";
        Report.close();
        Require(bool(Report), "Consumption report write failed");
        std::cout << "CONSUMPTION bake_changed_texels=" << AlteredTexels
                  << " clip_changed_queries=" << ClipMeasurements.AlteredQueries
                  << " positive_cache_receivers=" << CacheMeasurements.PositiveReceivers
                  << "; visibility unchanged, cleared GI black, restored GI exact\n";
        return 0;
    }
    catch (const std::exception& Failure)
    {
        std::cerr << "FAILED: " << Failure.what() << '\n';
        return 1;
    }
}
