/*============================================================================================================================================
                                                      SPHEREVEHICLEVALIDATION.CPP
============================================================================================================================================*/
// 🧩 Six actual moving ControlVehicle/source poses, unsigned-bake consumption, cold-reset equality and sphere-only cache ablations.

#include "Experimental/DistanceClipmap/Shadows/SphereVehicleScene.h"
#include <filesystem>
#include <iomanip>
#include <sstream>

using namespace Frontier::DistanceClipmapExperiment;

namespace
{

//------------------------------------------------------------------------------------------------------------------------
//                                                     NATIVE IMAGE COMPARISONS
//------------------------------------------------------------------------------------------------------------------------

float Difference(Vector A, Vector B)
{
    const auto Delta = Absolute(A - B);
    return std::max({Delta.X, Delta.Y, Delta.Z});
}

float Difference(const Image& A, const Image& B)
{
    Require(A.size() == B.size(), "Actual vehicle image extent mismatch");
    float Maximum = 0;
    for (unsigned Pixel = 0; Pixel < A.size(); ++Pixel)
        Maximum = std::max(Maximum, Difference(A[Pixel], B[Pixel]));
    return Maximum;
}

void Encode(const std::string& Destination, unsigned Pose, const SdfShadowImages& Pixels)
{
    const auto Prefix = Destination + "/ShadowVehicle" + std::to_string(Pose);
    EncodePfm(Prefix + "Direct.pfm", Pixels.Direct);
    EncodePfm(Prefix + "Indirect.pfm", Pixels.Indirect);
    EncodePfm(Prefix + "Combined.pfm", Pixels.Combined);
}

//------------------------------------------------------------------------------------------------------------------------
//                                               ACTUAL ARCHIVE / BAKED-DISTANCE MOTION
//------------------------------------------------------------------------------------------------------------------------

void Validate(const std::string& ArchiveDirectory, const std::string& Destination)
{
    SphereVehicleScene Scene;
    Scene.Construct(ArchiveDirectory);
    unsigned StaleRejections = 0, ComparedSegments = 0, VisibilityDifferences = 0, MarchSteps = 0, EmptySegments = 0;
    float    DirectCullDifference = 0, ColdImageDifference = 0, RestoreDifference = 0, CacheClearDifference = 0;
    double   ColdClipDifference = 0;
    std::ostringstream Report;
    Report << std::setprecision(12) << "{\n  \"passed\": true,\n  \"poses\": [\n";
    for (unsigned Pose = 0; Pose < 6; ++Pose)
    {
        const float Seconds      = float(Pose) * (4.f / 6);
        Scene.Geometry.Pose      = EvaluateMotion(Seconds);
        const float Angle        = float(Pose) * (2 * π / 6);
        Scene.Sphere.Palette[11] = {-2.8f + .45f * std::sin(Angle), -1.6f + .30f * std::cos(Angle),
                                    2.4f + .15f * std::sin(Angle), .65f};
        if (Pose > 0)
        {
            try
            {
                Scene.RequireFresh();
            }
            catch (const std::runtime_error&)
            {
                ++StaleRejections;
            }
            Require(StaleRejections == Pose, "Actual vehicle or sphere movement accepted stale radiance");
        }
        const auto Begin = std::chrono::steady_clock::now();
        Require(Scene.Refresh(), "Actual vehicle motion failed to refresh distance / radiance");
        const double Setup     = Milliseconds(Begin);
        const auto   Rewritten = Scene.Geometry.Clipmap.Rewritten;
        Require(!Scene.Refresh(), "Stationary actual-vehicle cache needlessly refreshed");
        auto ColdClip = Scene.Geometry.Clipmap;
        ColdClip.Relocate(Scene.Geometry.Pose, Scene.Geometry.Pose.Translation + Vector{0, 0, 1}, true);
        for (unsigned Tier = 0; Tier < 3; ++Tier)
        {
            const auto& Warm = Scene.Geometry.Clipmap.Levels[Tier].Texels;
            const auto& Cold = ColdClip.Levels[Tier].Texels;
            Require(Warm.size() == Cold.size(), "Cold vehicle clip extent changed");
            for (unsigned Texel = 0; Texel < Warm.size(); ++Texel)
            {
                ColdClipDifference = std::max(ColdClipDifference, double(std::abs(Warm[Texel].Raw - Cold[Texel].Raw)));
                ColdClipDifference =
                    std::max(ColdClipDifference, double(std::abs(Warm[Texel].Lower - Cold[Texel].Lower)));
            }
        }
        for (unsigned Index = 0; Index < 1024; ++Index)
        {
            const auto   Pair = Quadrature(Index, 6);
            const Vector Origin{-5 + 10 * Pair[0], -4 + 8 * Pair[1], .002f};
            const auto   Light = Scene.Sphere.Arrival(Origin, Quadrature(Index, 1));
            const bool   Exact =
                Scene.Geometry.CarOccluded(Origin, Light.Direction, Light.Limit, VisibilityEvaluation::Exact);
            unsigned   Steps = 0;
            const bool Hybrid =
                Scene.Geometry.CarOccluded(Origin, Light.Direction, Light.Limit, VisibilityEvaluation::Hybrid, &Steps);
            if (Exact != Hybrid) ++VisibilityDifferences;
            if (!Hybrid && Steps > 0) ++EmptySegments;
            MarchSteps += Steps;
            ++ComparedSegments;
            if (Index < 128)
            {
                const SurfacePoint Surface{true, false, true, 0, 0, Origin, {0, 0, 1}, {0, 0, 1}, 0};
                DirectCullDifference = std::max(
                    DirectCullDifference, Difference(Scene.Direct(Surface, 24, Index, 0, VisibilityEvaluation::Exact),
                                                     Scene.Direct(Surface, 24, Index)));
            }
        }
        Require(ColdClipDifference == 0 && VisibilityDifferences == 0 && DirectCullDifference == 0,
                "Actual baked-distance motion / visibility is inconsistent with cold / triangle controls");
        const auto   CaptureBegin    = std::chrono::steady_clock::now();
        const auto   Pixels          = Scene.Render();
        const double CaptureDuration = Milliseconds(CaptureBegin);
        Encode(Destination, Pose, Pixels);
        // 📝 Independently recreate posed geometry projections, source relighting and every cone mip, then render again.
        Scene.CacheInitialized = false;
        Scene.Refresh(true);
        const auto Fresh = Scene.Render();
        ColdImageDifference =
            std::max({ColdImageDifference, Difference(Pixels.Direct, Fresh.Direct),
                      Difference(Pixels.Indirect, Fresh.Indirect), Difference(Pixels.Combined, Fresh.Combined)});
        Require(ColdImageDifference == 0, "Moving actual-vehicle native image differs from a fresh reset");
        if (Pose == 0)
        {
            const auto Saved = Scene.Reflections.Cones.Radiance;
            std::fill(Scene.Reflections.Cones.Radiance.begin(), Scene.Reflections.Cones.Radiance.end(), Vector{});
            Scene.Reflections.Cones.Inject();
            const auto Cleared = Scene.Render();
            Require(Difference(Cleared.Direct, Pixels.Direct) == 0, "Actual cache clear changed direct lighting");
            CacheClearDifference = Difference(Pixels.Combined, Cleared.Combined);
            Require(CacheClearDifference > 0, "Actual vehicle capture did not consume reflected surface cache");
            for (const auto Rgb : Cleared.Indirect)
                Require(Rgb.X == 0 && Rgb.Y == 0 && Rgb.Z == 0,
                        "Actual vehicle GI survived cleared resident surface RGB");
            EncodePfm(Destination + "/ShadowVehicleCacheCleared.pfm", Cleared.Combined);
            Scene.Reflections.Cones.Radiance = Saved;
            Scene.Reflections.Cones.Inject();
            const auto Restored = Scene.Render();
            RestoreDifference   = Difference(Restored.Combined, Pixels.Combined);
            Require(RestoreDifference == 0, "Actual vehicle restored surface cache is not exact");
            EncodePfm(Destination + "/ShadowVehicleCacheRestored.pfm", Restored.Combined);
        }
        const auto& Translation = Scene.Geometry.Pose.Translation;
        Report << (Pose ? ",\n" : "") << "    {\"pose\": " << Pose << ", \"translation_m\": [" << Translation.X << ", "
               << Translation.Y << ", " << Translation.Z << "], \"rotation_cos_sin\": [" << Scene.Geometry.Pose.Cosine
               << ", " << Scene.Geometry.Pose.Sine << "], \"sphere_center_radius_m\": [" << Scene.Sphere.Palette[11][0]
               << ", " << Scene.Sphere.Palette[11][1] << ", " << Scene.Sphere.Palette[11][2] << ", "
               << Scene.Sphere.LightRadius() << "], \"setup_cpu_ms\": " << Setup
               << ", \"capture_cpu_ms\": " << CaptureDuration << ", \"rewritten_texels\": [" << Rewritten[0] << ", "
               << Rewritten[1] << ", " << Rewritten[2] << "]}";
        std::cout << "Actual ControlVehicle / moving sphere pose " << Pose << " exact against fresh native image"
                  << std::endl;
    }
    Scene.Sphere.SourceEnabled = false;
    try
    {
        Scene.RequireFresh();
    }
    catch (const std::runtime_error&)
    {
        ++StaleRejections;
    }
    Require(StaleRejections == 6, "Actual-vehicle source switch did not reject stale radiance");
    Scene.Refresh();
    const auto Off = Scene.Render();
    for (unsigned Pixel = 0; Pixel < Off.Combined.size(); ++Pixel)
        Require(Off.Combined[Pixel].X == 0 && Off.Combined[Pixel].Y == 0 && Off.Combined[Pixel].Z == 0,
                "Actual vehicle all-sources-off native capture is not black");
    EncodePfm(Destination + "/ShadowVehicleOff.pfm", Off.Combined);
    Require(MarchSteps > 0 && EmptySegments > 0, "Actual vehicle did not exercise baked SDF skipping");
    Report << "\n  ],\n  \"completed\": true,\n  \"renderer_accepted\": false,\n  \"sphere_only\": true,\n"
           << "  \"vehicle_facets\": " << Scene.Geometry.Vehicle.Surfaces.size()
           << ",\n  \"unsigned_bake_extent\": [80, 40, 32],\n  \"analytic_vehicle_sdf\": false,\n"
           << "  \"contact_refinement\": \"original triangles\",\n  \"native_width\": 480,\n  \"native_height\": 270,\n"
           << "  \"stale_rejections\": " << StaleRejections << ",\n  \"visibility_segments\": " << ComparedSegments
           << ",\n  \"visibility_differences\": " << VisibilityDifferences
           << ",\n  \"bake_march_steps\": " << MarchSteps << ",\n  \"empty_marched_segments\": " << EmptySegments
           << ",\n  \"direct_cull_difference\": " << DirectCullDifference
           << ",\n  \"cold_clip_maximum\": " << ColdClipDifference
           << ",\n  \"cold_image_maximum\": " << ColdImageDifference
           << ",\n  \"cache_clear_rgb_difference\": " << CacheClearDifference
           << ",\n  \"cache_restore_difference\": " << RestoreDifference
           << ",\n  \"source_off_black_pixels\": " << Off.Combined.size() << "\n}\n";
    std::ofstream Output(Destination + "/ShadowVehicle.json");
    Output << Report.str();
    Require(bool(Output), "Cannot retain actual vehicle sphere report");
}

} // namespace

//------------------------------------------------------------------------------------------------------------------------
//                                                           ENTRY POINT
//------------------------------------------------------------------------------------------------------------------------

int main(int Count, char** Arguments)
{
    try
    {
        Require(Count == 3, "Usage: SphereVehicleValidation <vehicle-archive-directory> <output-directory>");
        std::filesystem::create_directories(Arguments[2]);
        Validate(Arguments[1], Arguments[2]);
        std::cout << "Sphere-only actual vehicle capture / motion checks completed" << std::endl;
        return 0;
    }
    catch (const std::exception& Error)
    {
        std::cerr << "Sphere vehicle failure: " << Error.what() << '\n';
        return 1;
    }
}
