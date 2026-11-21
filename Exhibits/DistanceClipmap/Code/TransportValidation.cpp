/*============================================================================================================================================
                                                        TRANSPORTVALIDATION.CPP
============================================================================================================================================*/
// 🧩 Focused radiance-transport ablations, source-isolated native captures and disclosed CPU timing.

#include "Experimental/DistanceClipmap/Transport/TransportCapture.h"
#include <filesystem>
#include <iomanip>
#include <sstream>

using namespace Frontier::DistanceClipmapExperiment;

namespace
{

//------------------------------------------------------------------------------------------------------------------------
//                                                      NUMERICAL ASSERTIONS
//------------------------------------------------------------------------------------------------------------------------

unsigned Assertions = 0;

void Verify(bool Condition, const std::string& Description)
{
    Require(Condition, Description);
    ++Assertions;
}

float MaximumChannel(Vector Radiance)
{
    return std::max({Radiance.X, Radiance.Y, Radiance.Z});
}

float Difference(Vector A, Vector B)
{
    return MaximumChannel(Absolute(A - B));
}

bool Identical(const std::vector<Vector>& A, const std::vector<Vector>& B)
{
    return A.size() == B.size() && std::memcmp(A.data(), B.data(), A.size() * sizeof(Vector)) == 0;
}

std::vector<SurfacePoint> Receivers()
{
    std::vector<SurfacePoint> Surfaces;
    for (unsigned Index = 0; Index < 128; ++Index)
    {
        const auto Pair = Quadrature(Index, 13);
        Surfaces.push_back(
            {true, false, true, 0, 0, {-5 + 10 * Pair[0], -4 + 8 * Pair[1], 0}, {0, 0, 1}, {0, 0, 1}, 0});
    }
    return Surfaces;
}

void Validate(RadianceScene& Scene, const std::string& Destination)
{
    const auto Begin     = std::chrono::steady_clock::now();
    const auto Composite = Over({{.5f, 0, 0}, .5f}, {{0, 0, 1}, 1});
    Verify(Composite.Opacity == 1 && Composite.Radiance.X == .5f && Composite.Radiance.Z == .5f,
           "Ordered premultiplied-radiance reduction is wrong");
    Facet Calibration{{Vector{0, 0, .25f}, Vector{1, 0, .25f}, Vector{0, 1, .25f}}, {}, 0};
    float AreaSum = 0;
    for (unsigned Y = 0; Y < 4; ++Y)
        for (unsigned X = 0; X < 4; ++X)
            AreaSum += DirectionalRadianceAtlas::ClippedArea(Calibration, {X * .25f, Y * .25f, .125f}, .25f).first;
    Verify(std::abs(AreaSum - .5f) < 1e-6f, "Voxel clipping loses or duplicates triangle area");
    float OctahedralError = 0;
    for (unsigned Index = 0; Index < 4096; ++Index)
    {
        const auto   Pair      = Quadrature(Index, 14);
        const Vector Direction = Normalize({Pair[0] * 2 - 1, Pair[1] * 2 - 1, float(Index % 31) / 15 - 1});
        if (Length(Direction) == 0) continue;
        const auto UV   = EncodeOctahedral(Direction);
        OctahedralError = std::max(OctahedralError, Length(Direction - DecodeOctahedral(UV[0], UV[1])));
        Verify(OctahedralError < 2e-6f, "Octahedral angular coordinate round trip failed");
    }
    for (int Y = -1; Y <= 8; ++Y)
        for (int X = -1; X <= 8; ++X)
        {
            const auto Coordinate = WrapOctahedral(X, Y, 8);
            Verify(Coordinate[0] < 8 && Coordinate[1] < 8, "Octahedral seam footprint out of range");
        }
    DirectionalRadianceAtlas Cones;
    const auto               RefreshBegin = std::chrono::steady_clock::now();
    Verify(Cones.Refresh(Scene, Combined, 32), "Initial directional refresh was skipped");
    const double ConeRefreshMs = Milliseconds(RefreshBegin);
    Verify(!Cones.Refresh(Scene, Combined, 32), "Stationary inputs rebuilt directional transport");
    float MaximumReflectance = 0;
    for (const auto& Site : Cones.Sites)
    {
        const Vector Reflectance = EvaluateMaterial(Site.Surface.Material).Reflectance;
        MaximumReflectance       = std::max(MaximumReflectance, MaximumChannel(Reflectance));
        Verify(Reflectance.X >= 0 && Reflectance.Y >= 0 && Reflectance.Z >= 0 && MaximumChannel(Reflectance) <= .8f,
               "Diffuse contraction assumptions do not hold");
    }
    for (const auto& Voxel : Cones.Voxels)
        Verify(Voxel.Opacity >= 0 && Voxel.Opacity <= 1 && Voxel.Radiance.X >= 0 && Voxel.Radiance.Y >= 0 &&
                   Voxel.Radiance.Z >= 0 && std::isfinite(MaximumChannel(Voxel.Radiance)),
               "Invalid radiance voxel");
    const auto          Surfaces = Receivers();
    std::vector<Vector> Initial, Direct;
    unsigned            Skips = 0, ConeSteps = 0;
    float               DistanceDifference = 0;
    for (const auto& Surface : Surfaces)
    {
        const auto Lit = Cones.Indirect(Scene, Surface, Combined);
        Initial.push_back(Lit);
        Direct.push_back(Scene.Direct(Surface, Combined, VisibilityEvaluation::Exact, 32));
        const auto Unskipped = Cones.Indirect(Scene, Surface, Combined, false);
        DistanceDifference   = std::max(DistanceDifference, Difference(Lit, Unskipped));
        Verify(Difference(Lit, Unskipped) == 0, "Distance culling changed cone radiance");
        (void)Cones.TraceCone(Scene, Surface.Position + Surface.Normal * Cones.NormalDisplacement, Normalize({1, 0, 1}),
                              .2f, true, &ConeSteps, &Skips);
    }
    Verify(Skips > 0, "Distance clipmap is not consumed by cone culling");
    const auto SavedRadiance = Cones.Radiance;
    std::fill(Cones.Radiance.begin(), Cones.Radiance.end(), Vector{});
    Cones.Inject();
    for (unsigned Index = 0; Index < Surfaces.size(); ++Index)
    {
        Verify(MaximumChannel(Cones.Indirect(Scene, Surfaces[Index], Combined)) == 0,
               "Cleared radiance does not black cone GI");
        Verify(Difference(Direct[Index], Scene.Direct(Surfaces[Index], Combined, VisibilityEvaluation::Exact, 32)) == 0,
               "Radiance ablation changes direct shadows");
    }
    Cones.Radiance = SavedRadiance;
    Cones.Inject();
    for (unsigned Index = 0; Index < Surfaces.size(); ++Index)
        Verify(Difference(Initial[Index], Cones.Indirect(Scene, Surfaces[Index], Combined)) == 0,
               "Radiance restoration is not exact");
    const float ConeResidual1 = Cones.Bounce(Scene), ConeResidual2 = Cones.Bounce(Scene);
    Verify(ConeResidual2 <= MaximumReflectance * ConeResidual1 + 2e-6f,
           "Cone transport violates the measured contraction");
    for (unsigned Index = 0; Index < Surfaces.size(); ++Index)
    {
        const auto Indirect = Cones.Indirect(Scene, Surfaces[Index], Combined);
        Verify(Indirect.X >= 0 && Indirect.Y >= 0 && Indirect.Z >= 0 && std::isfinite(MaximumChannel(Indirect)),
               "Invalid cone output");
        Verify(Indirect.X + 1e-6f >= Initial[Index].X && Indirect.Y + 1e-6f >= Initial[Index].Y &&
                   Indirect.Z + 1e-6f >= Initial[Index].Z,
               "Positive cone propagation loses an existing bounce");
    }
    Cones.Initialized = false;
    Cones.Refresh(Scene, Combined, 32);
    DiffuseProbeLattice Probes;
    const auto          ProbeBegin = std::chrono::steady_clock::now();
    Verify(Probes.Refresh(Scene, Cones), "Initial probe refresh was skipped");
    const double ProbeRefreshMs = Milliseconds(ProbeBegin);
    Verify(!Probes.Refresh(Scene, Cones), "Stationary inputs rebuilt probes");
    const unsigned Rejected = unsigned(std::count(Probes.Confidence.begin(), Probes.Confidence.end(), 0.f));
    Verify(Rejected > 0 && Rejected < Probes.ProbeCount, "Probe classification is unexercised");
    std::vector<Vector> ProbeInitial;
    float               MomentDifference = 0;
    for (const auto& Surface : Surfaces)
    {
        ProbeInitial.push_back(Probes.Indirect(Scene, Surface, Combined));
        MomentDifference = std::max(MomentDifference,
                                    Difference(ProbeInitial.back(), Probes.Indirect(Scene, Surface, Combined, false)));
    }
    Verify(MomentDifference > 0, "Probe distance moments are not consumed");
    const auto SavedIrradiance = Probes.Irradiance;
    std::fill(Probes.Irradiance.begin(), Probes.Irradiance.end(), Vector{});
    for (const auto& Surface : Surfaces)
        Verify(MaximumChannel(Probes.Indirect(Scene, Surface, Combined)) == 0, "Cleared probe RGB does not black DDGI");
    Probes.Irradiance = SavedIrradiance;
    for (unsigned Index = 0; Index < Surfaces.size(); ++Index)
        Verify(Difference(ProbeInitial[Index], Probes.Indirect(Scene, Surfaces[Index], Combined)) == 0,
               "Probe restoration is not exact");
    const float ProbeResidual1 = Probes.Bounce(Scene, Cones), ProbeResidual2 = Probes.Bounce(Scene, Cones);
    Verify(ProbeResidual2 <= MaximumReflectance * ProbeResidual1 + 2e-6f,
           "Probe transport violates the measured contraction");
    const auto ConstantAtlas = Probes.Irradiance;
    std::fill(Probes.Irradiance.begin(), Probes.Irradiance.end(), Vector{.25f, .5f, 1});
    const Vector Constant = Probes.IrradianceOverPi({0, 0, 0}, {0, 0, 1}, false);
    Verify(Difference(Constant, {.25f, .5f, 1}) < 2e-6f, "Probe interpolation changes constant radiance");
    Probes.Irradiance        = ConstantAtlas;
    unsigned StaleRejections = 0;
    auto     RejectStale     = [&](unsigned Mask)
    {
        for (bool ProbeSelection : {false, true})
        {
            bool Rejected = false;
            try
            {
                if (ProbeSelection)
                    (void)Probes.Indirect(Scene, Surfaces[0], Mask);
                else
                    (void)Cones.Indirect(Scene, Surfaces[0], Mask);
            }
            catch (const std::runtime_error&)
            {
                Rejected = true;
            }
            Verify(Rejected, "Stale transport query was accepted");
            ++StaleRejections;
        }
    };
    RejectStale(Dark);
    Scene.SunRadius *= 2;
    RejectStale(Combined);
    Scene.SunRadius *= .5f;
    Scene.Pose = EvaluateMotion(.67);
    RejectStale(Combined);
    Scene.Clipmap.Relocate(Scene.Pose, {0, 0, 1});
    Cones.Refresh(Scene, Combined, 32);
    Probes.Refresh(Scene, Cones);
    const auto               MovedRadiance = Cones.Radiance, MovedIrradiance = Probes.Irradiance;
    DirectionalRadianceAtlas Cold;
    Cold.Refresh(Scene, Combined, 32);
    DiffuseProbeLattice ColdProbes;
    ColdProbes.Refresh(Scene, Cold);
    Verify(Identical(MovedRadiance, Cold.Radiance), "Moving relight differs from cold relight");
    Verify(Identical(MovedIrradiance, ColdProbes.Irradiance), "Moving probe refresh differs from cold refresh");
    const auto SavedSun = Scene.SunDirection;
    Scene.SunDirection  = Normalize({.2f, -.6f, 1});
    Verify(Cones.Refresh(Scene, Combined, 32) && Probes.Refresh(Scene, Cones),
           "Sun direction change did not refresh transport");
    Verify(!Identical(MovedIrradiance, Probes.Irradiance), "Changed Sun had no effect on the refreshed probes");
    Scene.SunDirection = SavedSun;
    Cones.Refresh(Scene, Combined, 32);
    Probes.Refresh(Scene, Cones);
    Verify(Identical(MovedRadiance, Cones.Radiance) && Identical(MovedIrradiance, Probes.Irradiance),
           "Sun restoration retained stale light");
    Scene.Vehicle.Surfaces[0].Material ^= 1;
    bool GeometryRejected = false;
    try
    {
        Cones.Refresh(Scene, Combined, 32);
    }
    catch (const std::runtime_error&)
    {
        GeometryRejected = true;
    }
    Scene.Vehicle.Surfaces[0].Material ^= 1;
    Verify(GeometryRejected, "Geometry/material edit was accepted without "
                             "reconstructing scene bounds and source CDF");
    Cones.Refresh(Scene, Dark, 32);
    Probes.Refresh(Scene, Cones);
    Verify(Cones.Bounce(Scene) == 0 && Probes.Bounce(Scene, Cones) == 0,
           "Source-off iterative transport creates energy");
    for (const auto& Surface : Surfaces)
    {
        Verify(MaximumChannel(Cones.Indirect(Scene, Surface, Dark)) == 0, "Source-off cone GI is not exact black");
        Verify(MaximumChannel(Probes.Indirect(Scene, Surface, Dark)) == 0, "Source-off probes are not exact black");
    }
    std::ofstream Report(Destination + "/GiNumeric.json");
    Report << std::setprecision(12) << "{\n  \"passed\": true,\n  \"assertions\": " << Assertions
           << ",\n  \"octahedral_max_direction_error\": " << OctahedralError
           << ",\n  \"clipped_triangle_area\": " << AreaSum << ",\n  \"site_count\": " << Cones.Sites.size()
           << ",\n  \"radiance_voxels\": " << Cones.Voxels.size()
           << ",\n  \"surface_projections\": " << Cones.Taps.size()
           << ",\n  \"maximum_reflectance\": " << MaximumReflectance << ",\n  \"cone_refresh_ms\": " << ConeRefreshMs
           << ",\n  \"probe_refresh_after_surface_cache_ms\": " << ProbeRefreshMs
           << ",\n  \"distance_skips\": " << Skips << ",\n  \"cone_steps\": " << ConeSteps
           << ",\n  \"distance_culling_max_radiance_difference\": " << DistanceDifference
           << ",\n  \"cone_residuals\": [" << ConeResidual1 << ", " << ConeResidual2 << "]"
           << ",\n  \"probe_residuals\": [" << ProbeResidual1 << ", " << ProbeResidual2 << "]"
           << ",\n  \"probe_count\": " << Probes.ProbeCount << ",\n  \"probe_rays\": " << Probes.Rays.size()
           << ",\n  \"rejected_probes\": " << Rejected
           << ",\n  \"raw_cosine_integral_max_error_before_normalization\": " << Probes.MaximumCosineIntegralError
           << ",\n  \"moment_visibility_ablation_max_difference\": " << MomentDifference
           << ",\n  \"stale_query_rejections\": " << StaleRejections
           << ",\n  \"moving_refresh_equals_cold\": true,\n  "
              "\"source_off_exact_black\": true,"
           << "\n  \"milliseconds\": " << Milliseconds(Begin) << "\n}\n";
    Require(bool(Report), "Cannot retain transport report");
    std::cout << "GI NUMERIC PASS assertions=" << Assertions << " distance_skips=" << Skips
              << " rejected_probes=" << Rejected << " ms=" << Milliseconds(Begin) << std::endl;
}

//------------------------------------------------------------------------------------------------------------------------
//                                                  SOURCE-ISOLATED NATIVE
//                                                  CAPTURES
//------------------------------------------------------------------------------------------------------------------------

void Captures(RadianceScene& Scene, const std::string& Destination, bool MotionOnly, bool References = true)
{
    std::ofstream Timings(Destination + "/GiTimings.csv");
    Timings << "capture,milliseconds,notes\n";
    PrimarySurfaceCapture    Primary;
    DirectionalRadianceAtlas Cones;
    DiffuseProbeLattice      Probes;
    auto                     Save = [&](const std::string& Name, const auto& Integrate)
    {
        const auto Begin = std::chrono::steady_clock::now();
        std::cout << "GI CAPTURE " << Name << std::endl;
        auto Pixels = Primary.Capture(Integrate);
        Timings << Name << ',' << Milliseconds(Begin) << ",480x270 Float32 four primary samples no denoiser\n";
        Timings.flush();
        EncodePfm(Destination + "/" + Name + ".pfm", Pixels);
        return Pixels;
    };
    if (!MotionOnly)
    {
        Primary.Construct(Scene);
        for (const auto& Selection : std::vector<std::pair<std::string, unsigned>>{{"Emissive", Emissive},
                                                                                   {"Point", Point},
                                                                                   {"Sun", Sun},
                                                                                   {"Area", Area},
                                                                                   {"Combined", Combined},
                                                                                   {"Off", Dark}})
        {
            const auto Begin = std::chrono::steady_clock::now();
            Cones.Refresh(Scene, Selection.second, 32);
            Probes.Refresh(Scene, Cones);
            Timings << Selection.first << "Refresh," << Milliseconds(Begin)
                    << ",surface relight voxel injection probe trace convolution\n";
            const auto Direct = Primary.Direct(Scene, Selection.second, 32);
            EncodePfm(Destination + "/Gi" + Selection.first + "Direct.pfm", Direct);
            const auto ConeGi  = Save("Gi" + Selection.first + "Cone", [&](const SurfacePoint& Surface, unsigned)
                                      { return Cones.Indirect(Scene, Surface, Selection.second); });
            const auto ProbeGi = Save("Gi" + Selection.first + "Probe", [&](const SurfacePoint& Surface, unsigned)
                                      { return Probes.Indirect(Scene, Surface, Selection.second); });
            EncodePfm(Destination + "/Gi" + Selection.first + "ConeLit.pfm", AddRadiance(Direct, ConeGi));
            EncodePfm(Destination + "/Gi" + Selection.first + "ProbeLit.pfm", AddRadiance(Direct, ProbeGi));
            if (Selection.second == Emissive || Selection.second == Combined)
            {
                if (References)
                    Save("Gi" + Selection.first + "Reference512", [&](const SurfacePoint& Surface, unsigned Pixel)
                         { return ReferenceIndirect(Scene, Surface, Selection.second, 512, 1, Pixel); });
                if (References)
                    Save("Gi" + Selection.first + "Reference128", [&](const SurfacePoint& Surface, unsigned Pixel)
                         { return ReferenceIndirect(Scene, Surface, Selection.second, 128, 1, Pixel); });
                std::vector<float> ConeResiduals, ProbeResiduals;
                for (unsigned Bounce = 0; Bounce < 3; ++Bounce)
                {
                    ConeResiduals.push_back(Cones.Bounce(Scene));
                    ProbeResiduals.push_back(Probes.Bounce(Scene, Cones));
                    if (Bounce == 0)
                    {
                        Save("Gi" + Selection.first + "Cone2", [&](const SurfacePoint& Surface, unsigned)
                             { return Cones.Indirect(Scene, Surface, Selection.second); });
                        Save("Gi" + Selection.first + "Probe2", [&](const SurfacePoint& Surface, unsigned)
                             { return Probes.Indirect(Scene, Surface, Selection.second); });
                    }
                }
                const auto ConeMultiple =
                    Save("Gi" + Selection.first + "Cone4", [&](const SurfacePoint& Surface, unsigned)
                         { return Cones.Indirect(Scene, Surface, Selection.second); });
                const auto ProbeMultiple =
                    Save("Gi" + Selection.first + "Probe4", [&](const SurfacePoint& Surface, unsigned)
                         { return Probes.Indirect(Scene, Surface, Selection.second); });
                EncodePfm(Destination + "/Gi" + Selection.first + "Cone4Lit.pfm", AddRadiance(Direct, ConeMultiple));
                EncodePfm(Destination + "/Gi" + Selection.first + "Probe4Lit.pfm", AddRadiance(Direct, ProbeMultiple));
                if (References)
                    Save("Gi" + Selection.first + "Reference2Sites512", [&](const SurfacePoint& Surface, unsigned Pixel)
                         { return ReferenceIndirect(Scene, Surface, Selection.second, 512, 2, Pixel); });
                std::ofstream Residuals(Destination + "/Gi" + Selection.first + "Residuals.json");
                Residuals << std::setprecision(12) << "{\"cone_residuals\":[";
                for (unsigned Index = 0; Index < 3; ++Index)
                    Residuals << (Index ? "," : "") << ConeResiduals[Index];
                Residuals << "],\"probe_residuals\":[";
                for (unsigned Index = 0; Index < 3; ++Index)
                    Residuals << (Index ? "," : "") << ProbeResiduals[Index];
                Residuals << "],\"contraction_bound\":0.8,\"fixed_point_tail_bound_"
                             "cone_radiance\":"
                          << ConeResiduals.back() / .2f
                          << ",\"fixed_point_tail_bound_probe_radiance\":" << ProbeResiduals.back() / .2f
                          << ",\"scope\":\"Discrete approximate operator only, not "
                             "exact physical GI convergence\"}\n";
            }
        }
        Cones.Refresh(Scene, Combined, 32);
        Probes.Refresh(Scene, Cones);
        for (unsigned Tier = 0; Tier < 3; ++Tier)
        {
            Image Slice(CaptureWidth * CaptureHeight);
            for (unsigned Y = 0; Y < CaptureHeight; ++Y)
                for (unsigned X = 0; X < CaptureWidth; ++X)
                {
                    const Vector P{(float(X) / CaptureWidth - .5f) * 16, (.5f - float(Y) / CaptureHeight) * 9, .55f};
                    const auto   Texel = Cones.SampleMip(Tier, 0, P, {0, 0, -1});
                    const auto&  Grid  = Cones.Grids[Tier];
                    const Vector High  = Grid.Low + Vector{64, 64, 64} * Grid.Spacing;
                    if (P.X >= Grid.Low.X && P.X <= High.X && P.Y >= Grid.Low.Y && P.Y <= High.Y)
                        Slice[Y * CaptureWidth + X] = Texel.Radiance;
                }
            EncodePfm(Destination + "/GiRadianceLevel" + std::to_string(Tier) + ".pfm", Slice);
        }
    }
    else
    {
        for (unsigned Pose = 0; Pose < 12; ++Pose)
        {
            Scene.Pose = EvaluateMotion(double(Pose) / 3);
            Scene.Clipmap.Relocate(Scene.Pose, {0, 0, 1});
            Primary.Construct(Scene);
            Cones.Refresh(Scene, Emissive, 32);
            Probes.Refresh(Scene, Cones);
            std::ostringstream Number;
            Number << std::setw(2) << std::setfill('0') << Pose;
            const auto Direct = Primary.Direct(Scene, Emissive, 32);
            const auto Cone   = Save("GiMotionCone" + Number.str(), [&](const SurfacePoint& Surface, unsigned)
                                     { return Cones.Indirect(Scene, Surface, Emissive); });
            const auto Probe  = Save("GiMotionProbe" + Number.str(), [&](const SurfacePoint& Surface, unsigned)
                                     { return Probes.Indirect(Scene, Surface, Emissive); });
            EncodePfm(Destination + "/GiMotionConeLit" + Number.str() + ".pfm", AddRadiance(Direct, Cone));
            EncodePfm(Destination + "/GiMotionProbeLit" + Number.str() + ".pfm", AddRadiance(Direct, Probe));
        }
    }
}

//------------------------------------------------------------------------------------------------------------------------
//                                                  MATCHED STEADY CPU GI TIMING
//------------------------------------------------------------------------------------------------------------------------

void Benchmark(RadianceScene& Scene, const std::string& Destination)
{
    PrimarySurfaceCapture Primary;
    auto                  Begin = std::chrono::steady_clock::now();
    Primary.Construct(Scene);
    const double PrimaryMs = Milliseconds(Begin);
    Begin                  = std::chrono::steady_clock::now();
    Scene.Relight(Combined, 32);
    const double             TriangleSetup = Milliseconds(Begin);
    DirectionalRadianceAtlas Cones;
    Begin = std::chrono::steady_clock::now();
    Cones.Refresh(Scene, Combined, 32);
    const double        ConeSetup = Milliseconds(Begin);
    DiffuseProbeLattice Probes;
    Begin = std::chrono::steady_clock::now();
    Probes.Refresh(Scene, Cones);
    const double                       ProbeExtra = Milliseconds(Begin);
    const std::array<std::string, 3>   Names{"TriangleCache128", "Cone", "Probe"};
    std::array<std::vector<double>, 3> Timings;
    std::array<Image, 3>               Initial;
    auto                               Capture = [&](unsigned Selection)
    {
        return Primary.Capture(
            [&](const SurfacePoint& Surface, unsigned Pixel)
            {
                if (Selection == 0) return Scene.Indirect(Surface, Combined, 128, true, Pixel);
                if (Selection == 1) return Cones.Indirect(Scene, Surface, Combined);
                return Probes.Indirect(Scene, Surface, Combined);
            });
    };
    for (unsigned Selection = 0; Selection < 3; ++Selection)
    {
        Initial[Selection] = Capture(Selection);
        EncodePfm(Destination + "/GiBenchmark" + Names[Selection] + ".pfm", Initial[Selection]);
    }
    for (unsigned Round = 0; Round < 5; ++Round)
        for (unsigned Order = 0; Order < 3; ++Order)
        {
            const unsigned Selection = Round % 2 ? (Round + 3 - Order) % 3 : (Round + Order) % 3;
            Begin                    = std::chrono::steady_clock::now();
            const auto   Pixels      = Capture(Selection);
            const double Duration    = Milliseconds(Begin);
            Verify(Identical(Pixels, Initial[Selection]), "GI benchmark repeat is not deterministic");
            Timings[Selection].push_back(Duration);
            std::cout << "GI BENCHMARK round=" << Round << " method=" << Names[Selection] << " ms=" << Duration
                      << std::endl;
        }
    std::ofstream Report(Destination + "/GiBenchmark.json");
    Report << std::setprecision(12) << "{\n  \"width\":480,\n  \"height\":270,\n  \"primary_samples\":4,"
           << "\n  \"surface_direct_samples\":32,\n  "
              "\"triangle_cache_directions\":128,\n  \"rounds\":5,"
           << "\n  \"primary_surface_prepass_ms\":" << PrimaryMs << ",\n  \"cold_triangle_cache_ms\":" << TriangleSetup
           << ",\n  \"cold_cone_including_direct_cache_ms\":" << ConeSetup
           << ",\n  \"cold_probe_after_cone_cache_ms\":" << ProbeExtra
           << ",\n  \"cold_probe_including_current_cone_dependency_ms\":" << ConeSetup + ProbeExtra
           << ",\n  \"repeat_float_equal_within_each_method\":true,\n  "
              "\"equal_images_across_methods\":false,\n  \"methods\":{\n";
    for (unsigned Selection = 0; Selection < 3; ++Selection)
    {
        auto Sorted = Timings[Selection];
        std::sort(Sorted.begin(), Sorted.end());
        Report << (Selection ? ",\n" : "") << "    \"" << Names[Selection] << "\":{\"gather_ms\":[";
        for (unsigned Round = 0; Round < 5; ++Round)
            Report << (Round ? "," : "") << Timings[Selection][Round];
        Report << "],\"median_gather_ms\":" << Sorted[2] << "}";
    }
    Report << "\n  },\n  \"scope\":\"GI-only host measurements, shared Float32 "
              "primary samples, same sources/materials;"
              " different biased estimators. Gather excludes "
              "setup/direct/encoding; cold setup reported separately."
              " No denoiser, hardware-GPU, Windows or editor performance "
              "claim.\"\n}\n";
    Require(bool(Report), "Cannot write GI benchmark");
}

} // namespace

//------------------------------------------------------------------------------------------------------------------------
//                                                          COMMAND LINE
//------------------------------------------------------------------------------------------------------------------------

int main(int Count, char** Arguments)
{
    try
    {
        Require(Count == 4, "TransportValidation <vehicle archive directory> "
                            "<output directory> <validate|capture|motion>");
        const std::string Destination = Arguments[2], Selection = Arguments[3];
        std::filesystem::create_directories(Destination);
        RadianceScene Scene;
        Scene.Construct(Arguments[1]);
        Scene.LocalDistance.Bake(Scene.Vehicle);
        Scene.Clipmap.Relocate(Scene.Pose, {0, 0, 1});
        if (Selection == "validate")
            Validate(Scene, Destination);
        else if (Selection == "benchmark")
            Benchmark(Scene, Destination);
        else if (Selection == "capture" || Selection == "motion" || Selection == "refresh")
            Captures(Scene, Destination, Selection == "motion", Selection != "refresh");
        else
            throw std::runtime_error("Unknown transport validation selection");
        return 0;
    }
    catch (const std::exception& Error)
    {
        std::cerr << "GI VALIDATION FAILED: " << Error.what() << std::endl;
        return 1;
    }
}
