/*============================================================================================================================================
                                                          RADIANCEEVALUATION.CPP
============================================================================================================================================*/
// 🧩 Reproducible 480×270 CPU captures and independent clipmap, source, movement and surface-cache acceptance checks.

#include "RadianceScene.h"
#include <filesystem>
#include <iomanip>
#include <sstream>

using namespace Frontier::DistanceClipmapExperiment;

//------------------------------------------------------------------------------------------------------------------------
//                                                      NUMERICAL ACCEPTANCE
//------------------------------------------------------------------------------------------------------------------------

namespace
{
unsigned Assertions = 0;
void     Verify(bool Condition, const std::string& Description)
{
    Require(Condition, Description);
    ++Assertions;
}

Vector SequencePosition(unsigned Index, Vector Low, Vector High)
{
    const auto   XY = Quadrature(Index, 0), ZW = Quadrature(Index, 1);
    const Vector Fraction{XY[0], XY[1], ZW[0]};
    return Low + (High - Low) * Fraction;
}

void Validate(RadianceScene& Scene, const std::string& Destination)
{
    static_assert(sizeof(Vector) == 12);
    static_assert(sizeof(Frontier::TriangleVisibilitySpace::FloatEnclosure) == 48);
    static_assert(sizeof(Frontier::TriangleVisibilitySpace::FloatFacet) == 48);
    double     MaximumDistanceError = 0, MaximumLowerExcess = 0, MaximumClipExcess = 0;
    unsigned   VisibilityDisagreements = 0;
    const auto Begin                   = std::chrono::steady_clock::now();
    for (unsigned Index = 0; Index < 300; ++Index)
    {
        const Vector P                 = SequencePosition(Index, Scene.LocalDistance.Low, Scene.LocalDistance.High);
        const double ReferenceDistance = Scene.Vehicle.Geometry.Nearest(Expand(P)).Distance;
        const float  FloatDistance     = Scene.Vehicle.Nearest(P);
        MaximumDistanceError = std::max(MaximumDistanceError, std::abs(double(FloatDistance) - ReferenceDistance));
        Verify(std::abs(double(FloatDistance) - ReferenceDistance) < 2e-4,
               "Float32 nearest facet differs from production double query");
    }
    for (unsigned Index = 0; Index < 4096; ++Index)
    {
        const Vector P     = SequencePosition(Index, {-7, -6, -.5f}, {7, 6, 4});
        const double Exact = Scene.Vehicle.Geometry.Nearest(Expand(P)).Distance;
        const auto   Local = Scene.LocalDistance.Sample(P);
        MaximumLowerExcess = std::max(MaximumLowerExcess, double(Local.Lower) - Exact);
        Verify(Local.Lower <= Exact + 2e-6, "Local distance oversteps exact geometry");
        double SceneDistance = Exact;
        for (const auto& Box : Scene.Boxes)
            SceneDistance = std::min(SceneDistance, double(std::abs(SignedBoxDistance(P, Box))));
        const auto Clip   = Scene.Clipmap.Sample(P);
        MaximumClipExcess = std::max(MaximumClipExcess, double(Clip.Lower) - SceneDistance);
        Verify(Clip.Lower <= SceneDistance + 2e-6, "Clipmap lower distance oversteps exact geometry");
    }
    for (unsigned Index = 0; Index < 8192; ++Index)
    {
        const Vector Origin    = SequencePosition(Index, {-7, -5, .001f}, {7, 5, 4});
        const auto   Pair      = Quadrature(Index, 3);
        const Vector Direction = CosineDirection({0, 0, 1}, Pair);
        const auto   FloatHit  = Scene.Vehicle.Trace(Origin, Direction, 20);
        const auto   DoubleHit = Scene.Vehicle.Geometry.Trace(Expand(Origin), Expand(Direction), 1e-5, 20);
        Verify(FloatHit.Confirmed() == DoubleHit.Hit, "Float32 / double ray visibility differs");
        if (FloatHit.Confirmed())
            Verify(std::abs(FloatHit.Travel - DoubleHit.Travel) < 2e-4, "Float32 / double strike distance differs");
        const bool Exact  = Scene.CarOccluded(Origin, Direction, 20, VisibilityEvaluation::Exact);
        const bool Hybrid = Scene.CarOccluded(Origin, Direction, 20, VisibilityEvaluation::Hybrid);
        VisibilityDisagreements += Exact != Hybrid;
        Verify(Exact == Hybrid, "Hybrid visibility disagrees with exact triangles");
    }
    for (unsigned Index = 0; Index < 1000; ++Index)
    {
        const Vector       P = SequencePosition(Index, {-7, -6, 0}, {7, 6, 3});
        const SurfacePoint Receiver{true, false, true, 0, 0, P, {0, 0, 1}, {0, 0, 1}, 0};
        Vector             Sum{};
        for (unsigned Source : {unsigned(Emissive), unsigned(Point), unsigned(Sun), unsigned(Area)})
            Sum += Scene.Direct(Receiver, Source, VisibilityEvaluation::Exact, 16);
        const Vector All = Scene.Direct(Receiver, Combined, VisibilityEvaluation::Exact, 16);
        Verify(Length(Sum - All) < 1e-5, "Radiometric source additivity failed");
        Verify(Length(Scene.Direct(Receiver, Dark, VisibilityEvaluation::Exact, 16)) == 0,
               "Source-off direct radiance is nonzero");
    }
    const auto Stationary = Scene.Clipmap;
    Scene.Clipmap.Relocate(Scene.Pose, {0, 0, 1});
    Verify(std::accumulate(Scene.Clipmap.Rewritten.begin(), Scene.Clipmap.Rewritten.end(), 0u) == 0,
           "Stationary clipmap rewrites voxels");
    std::vector<unsigned> DirtyCounts;
    for (unsigned Index = 1; Index <= 4; ++Index)
    {
        Scene.Pose = EvaluateMotion(Index * .61);
        const Vector Focus{-.17f * Index, .21f * Index, 1};
        Scene.Clipmap.Relocate(Scene.Pose, Focus);
        DirtyCounts.push_back(std::accumulate(Scene.Clipmap.Rewritten.begin(), Scene.Clipmap.Rewritten.end(), 0u));
        auto Cold = Scene.Clipmap;
        Cold.Relocate(Scene.Pose, Focus, true);
        for (unsigned Tier = 0; Tier < DistanceClipmap::LevelCount; ++Tier)
            Verify(std::memcmp(Cold.Levels[Tier].Texels.data(),
                               Scene.Clipmap.Levels[Tier].Texels.data(),
                               Cold.Levels[Tier].Texels.size() * sizeof(ClipTexel)) == 0,
                   "Dirty-region / cold clipmap mismatch (stale vehicle or torus addressing)");
    }
    Scene.Pose     = {};
    Scene.Clipmap  = Stationary;
    double Clock60 = 0, Clock120 = 0;
    for (unsigned Tick = 0; Tick < 180; ++Tick)
        Clock60 += 1. / 60;
    for (unsigned Tick = 0; Tick < 360; ++Tick)
        Clock120 += 1. / 120;
    const auto Pose60 = EvaluateMotion(Clock60), Pose120 = EvaluateMotion(Clock120);
    Verify(Length(Pose60.Translation - Pose120.Translation) < 1e-6 && std::abs(Pose60.Cosine - Pose120.Cosine) < 1e-6,
           "Prescribed pose depends on display tick rate");
    const ClosedBox Calibration{{0, 0, 0}, {1, 1, 1}, 0};
    Verify(SignedBoxDistance({0, 0, 0}, Calibration) == -1, "Closed-box SDF interior sign incorrect");
    Verify(SignedBoxDistance({2, 0, 0}, Calibration) == 1, "Closed-box SDF exterior sign incorrect");
    double MeanCosine = 0;
    for (unsigned Sample = 0; Sample < 65536; ++Sample)
        MeanCosine += Dot(CapDirection({0, 0, 1}, .4f, Quadrature(Sample, 1)), {0, 0, 1});
    MeanCosine /= 65536;
    Verify(std::abs(MeanCosine - (1 + std::cos(.4)) / 2) < 2e-6, "Spherical cap is not uniform in solid angle");
    double Product = 0;
    for (unsigned Sample = 0; Sample < 65536; ++Sample)
    {
        const auto A = Quadrature(Sample, 4), B = Quadrature(Sample, 7);
        Product += double(A[0]) * A[1] * B[0] * B[1];
    }
    Product /= 65536;
    Verify(std::abs(Product - 1. / 16) < 1e-5, "Independent four-dimensional path quadrature moment failed");
    std::ofstream Report(Destination + "/Numeric.json");
    Report << std::setprecision(12) << "{\n  \"assertions\": " << Assertions
           << ",\n  \"vehicle_facets\": " << Scene.Vehicle.Surfaces.size()
           << ",\n  \"local_samples\": " << Scene.LocalDistance.Samples.size()
           << ",\n  \"nearest_float_double_max_m\": " << MaximumDistanceError
           << ",\n  \"local_lower_max_excess_m\": " << MaximumLowerExcess
           << ",\n  \"clip_lower_max_excess_m\": " << MaximumClipExcess
           << ",\n  \"hybrid_visibility_disagreements\": " << VisibilityDisagreements
           << ",\n  \"tested_hybrid_rays\": 8192,"
           << "\n  \"cap_mean_cosine\": " << MeanCosine
           << ",\n  \"cap_expected_mean_cosine\": " << (1 + std::cos(.4)) / 2
           << ",\n  \"four_dimensional_moment\": " << Product
           << ",\n  \"four_dimensional_expected\": 0.0625,\n  \"dirty_voxels\": [";
    for (unsigned Index = 0; Index < DirtyCounts.size(); ++Index)
        Report << (Index ? ", " : "") << DirtyCounts[Index];
    Report << "],\n  \"cold_voxels\": " << 3 * 48 * 48 * 48 << ",\n  \"numeric_ms\": " << Milliseconds(Begin)
           << "\n}\n";
    std::cout << "NUMERIC assertions=" << Assertions << " nearest_max_m=" << MaximumDistanceError
              << " visibility_disagreements=" << VisibilityDisagreements << " ms=" << Milliseconds(Begin) << std::endl;
}

//------------------------------------------------------------------------------------------------------------------------
//                                                       DEBUG / RADIANCE CAPTURES
//------------------------------------------------------------------------------------------------------------------------

Image DistanceSlice(const RadianceScene& Scene, unsigned Display)
{
    Image Pixels(CaptureWidth * CaptureHeight);
    for (unsigned Y = 0; Y < CaptureHeight; ++Y)
        for (unsigned X = 0; X < CaptureWidth; ++X)
        {
            const Vector P{(float(X) / CaptureWidth - .5f) * 13, (.5f - float(Y) / CaptureHeight) * 7.3125f, .55f};
            Vector       Colour{};
            if (Display < 3)
            {
                const auto& Grid = Scene.Clipmap.Levels[Display];
                const int   WX = int(std::floor(P.X / Grid.Spacing)), WY = int(std::floor(P.Y / Grid.Spacing)),
                          WZ = int(std::floor(P.Z / Grid.Spacing));
                if (DistanceClipmap::Contains(Grid.Origin, WX, WY, WZ))
                {
                    const auto  Texel     = Grid.Texels[DistanceClipmap::Address(WX, WY, WZ)];
                    const float Intensity = std::clamp(Texel.Raw, 0.f, 1.f);
                    Colour                = Vector{.08f, .4f, .65f} * (.12f + .88f * Intensity);
                    if (Texel.Raw < .06f) Colour = {1, .6f, .1f};
                    if (Texel.SignedStatic < 0) Colour = {.7f, .04f, .03f};
                    const float Contour = std::abs(std::sin(Texel.Raw * 60));
                    if (Contour < .1f) Colour = Colour * .6f;
                }
            }
            else if (Display == 3)
            {
                const auto  Distance = Scene.LocalDistance.Sample(Scene.Pose.ToLocal(P));
                const float D        = std::clamp(Distance.Raw, 0.f, 1.f);
                Colour               = Vector{.12f, .6f, .9f} * (.1f + .9f * D);
                if (D < .045f) Colour = {1, .65f, .08f};
            }
            else if (Display == 4)
            {
                unsigned Tier = 0;
                (void)Scene.Clipmap.Sample(P, &Tier);
                const Vector Colours[] = {{.08f, .6f, .4f}, {.15f, .35f, .9f}, {.85f, .25f, .1f}, {0, 0, 0}};
                Colour                 = Colours[Tier < 3 ? Tier : 3];
            }
            else
            {
                float Signed = 10;
                for (const auto& Box : Scene.Boxes)
                    Signed = std::min(Signed, SignedBoxDistance(P, Box));
                Colour = Signed < 0 ? Vector{.8f, .03f, .02f} : Vector{.06f, .3f, .8f} * std::min(1.f, Signed);
            }
            Pixels[Y * CaptureWidth + X] = Colour;
        }
    return Pixels;
}

void Captures(RadianceScene& Scene, const std::string& Destination, unsigned Samples, unsigned MotionCount)
{
    std::ofstream Timings(Destination + "/Timings.csv");
    Timings << "capture,milliseconds,direct_samples,indirect_samples,primary_samples,notes\n";
    auto Save = [&](const std::string& Name, const CaptureConfiguration& Specification)
    {
        std::cout << "CAPTURE " << Name << std::endl;
        const auto   Begin    = std::chrono::steady_clock::now();
        Image        Pixels   = Capture(Scene, Specification);
        const double Duration = Milliseconds(Begin);
        EncodePfm(Destination + "/" + Name + ".pfm", Pixels);
        Timings << Name << ',' << Duration << ',' << Specification.DirectSamples << ',' << Specification.IndirectSamples
                << ',' << Specification.PrimarySamples << ",CPU full-resolution no denoiser\n";
        Timings.flush();
        std::cout << "CAPTURED " << Name << " ms=" << Duration << std::endl;
        return Pixels;
    };
    CaptureConfiguration Configuration;
    Configuration.DirectSamples = Samples;
    const auto Exact            = Save("CombinedDirect", Configuration);
    Configuration.Visibility    = VisibilityEvaluation::Hybrid;
    const auto Hybrid           = Save("HybridDirect", Configuration);
    Verify(std::memcmp(Exact.data(), Hybrid.data(), Exact.size() * sizeof(Vector)) == 0,
           "Full-frame hybrid/exact radiance differs");
    Configuration.Visibility = VisibilityEvaluation::LocalPenumbra;
    Save("LocalVoxelPenumbra", Configuration);
    Configuration.Visibility = VisibilityEvaluation::ClipPenumbra;
    Save("ClipmapPenumbra", Configuration);
    Configuration.Visibility = VisibilityEvaluation::Exact;
    const auto Repeat        = Save("CombinedRepeat", Configuration);
    Verify(std::memcmp(Exact.data(), Repeat.data(), Exact.size() * sizeof(Vector)) == 0,
           "Parallel full-frame deterministic repeat differs");
    Configuration.Sources = Dark;
    const auto Black      = Save("SourcesOff", Configuration);
    Verify(std::all_of(Black.begin(), Black.end(), [](Vector P) { return P.X == 0 && P.Y == 0 && P.Z == 0; }),
           "All-sources-off image is not exactly black");
    Configuration.Sources = Combined;
    Configuration.Normals = true;
    Save("FacetNormals", Configuration);
    Configuration.Normals = false;
    for (unsigned Display = 0; Display < 6; ++Display)
        EncodePfm(Destination + "/DistanceDebug" + std::to_string(Display) + ".pfm", DistanceSlice(Scene, Display));
    for (const auto& Selection : std::vector<std::pair<std::string, unsigned>>{
             {"Emissive", Emissive}, {"Point", Point}, {"Sun", Sun}, {"Area", Area}, {"Combined", Combined}})
    {
        Configuration               = {};
        Configuration.DirectSamples = Samples;
        Configuration.Sources       = Selection.second;
        Save(Selection.first + "OnlyDirect", Configuration);
        const auto RelightBegin = std::chrono::steady_clock::now();
        Scene.Relight(Selection.second, Samples * 2);
        Timings << Selection.first << "CacheRelight," << Milliseconds(RelightBegin) << ',' << Samples * 2
                << ",0,0,all cache sites relit\n";
        Configuration.CacheView = true;
        Save(Selection.first + "SurfaceCache", Configuration);
        Configuration.CacheView       = false;
        Configuration.IndirectOnly    = true;
        Configuration.IndirectSamples = Samples * 4;
        Configuration.Cache           = true;
        Save(Selection.first + "CachedGi", Configuration);
        Configuration.Cache = false;
        Save(Selection.first + "ReferenceGi", Configuration);
    }
    std::cout << "CAPTURE PathTrace" << std::endl;
    const auto PathBegin = std::chrono::steady_clock::now();
    EncodePfm(Destination + "/PathTrace.pfm", CapturePath(Scene, Combined, Samples * 4, 3));
    Timings << "PathTrace," << Milliseconds(PathBegin) << ",1,2," << Samples * 4
            << ",finite 3-scattering diffuse NEE path quadrature\n";
    Configuration                 = {};
    Configuration.Sources         = Emissive;
    Configuration.DirectSamples   = Samples;
    Configuration.IndirectSamples = Samples * 2;
    Configuration.PrimarySamples  = 1;
    Configuration.Cache           = true;
    for (unsigned Index = 0; Index < MotionCount; ++Index)
    {
        Scene.Pose = EvaluateMotion(4. * Index / MotionCount);
        Scene.Clipmap.Relocate(Scene.Pose, {0, 0, 1});
        Scene.Relight(Emissive, Samples * 2);
        std::ostringstream Name;
        Name << "Motion" << std::setw(2) << std::setfill('0') << Index;
        Save(Name.str(), Configuration);
        CaptureConfiguration LitConfiguration;
        LitConfiguration.DirectSamples = Samples;
        LitConfiguration.Visibility    = VisibilityEvaluation::Hybrid;
        Save("MotionLit" + Name.str().substr(6), LitConfiguration);
        EncodePfm(Destination + "/" + Name.str() + "Distance.pfm", DistanceSlice(Scene, 1));
    }
    Scene.Pose = {};
    Scene.Clipmap.Relocate(Scene.Pose, {0, 0, 1});
    Scene.Relight(Dark, 1);
    Configuration                 = {};
    Configuration.Sources         = Dark;
    Configuration.Cache           = true;
    Configuration.IndirectSamples = 8;
    const auto DarkGi             = Save("SourcesOffIncludingGi", Configuration);
    Verify(std::all_of(DarkGi.begin(), DarkGi.end(), [](Vector P) { return P.X == 0 && P.Y == 0 && P.Z == 0; }),
           "Source-off surface cache invents GI");
    std::ofstream Report(Destination + "/CaptureChecks.json");
    Report << "{\n  \"hybrid_exact_float_image_equal\": true,\n  \"repeated_float_image_equal\": true,\n  "
              "\"sources_off_exact_black\": true,"
           << "\n  \"motion_images\": " << MotionCount
           << ",\n  \"width\": 480,\n  \"height\": 270,\n  \"denoisers\": false,\n  \"radiance_clamps\": false,"
           << "\n  \"scattering_model\": \"Lambertian diagnostic only; vehicle glass and metal are not production "
              "materials\"\n}\n";
}

void Convergence(RadianceScene& Scene, const std::string& Destination)
{
    std::ofstream Timings(Destination + "/ConvergenceTimings.csv");
    Timings << "capture,milliseconds,indirect_or_path_samples\n";
    for (unsigned Source : {unsigned(Emissive), unsigned(Combined)})
    {
        const std::string Prefix = Source == Emissive ? "Emissive" : "Combined";
        Scene.Relight(Source, 256);
        CaptureConfiguration Configuration;
        Configuration.Sources         = Source;
        Configuration.IndirectOnly    = true;
        Configuration.IndirectSamples = 512;
        for (bool Cached : {false, true})
        {
            Configuration.Cache    = Cached;
            const std::string Name = Prefix + (Cached ? "Cached" : "Reference") + "Gi512";
            std::cout << "CONVERGENCE " << Name << std::endl;
            const auto Begin = std::chrono::steady_clock::now();
            EncodePfm(Destination + "/" + Name + ".pfm", Capture(Scene, Configuration));
            Timings << Name << ',' << Milliseconds(Begin) << ",512\n";
            Timings.flush();
        }
        const auto VehicleCache = Scene.VehicleCache, StaticCache = Scene.StaticCache;
        std::copy(Scene.VehicleCache.begin(),
                  Scene.VehicleCache.begin() + Scene.Vehicle.Surfaces.size(),
                  Scene.VehicleCache.begin() + Scene.Vehicle.Surfaces.size());
        std::copy(Scene.StaticCache.begin(),
                  Scene.StaticCache.begin() + Scene.StaticSurfaces.Surfaces.size(),
                  Scene.StaticCache.begin() + Scene.StaticSurfaces.Surfaces.size());
        Configuration.Cache     = true;
        const auto BeginControl = std::chrono::steady_clock::now();
        EncodePfm(Destination + "/" + Prefix + "OutwardOnlyGi512.pfm", Capture(Scene, Configuration));
        Timings << Prefix << "OutwardOnlyGi512," << Milliseconds(BeginControl) << ",512\n";
        Scene.VehicleCache = VehicleCache;
        Scene.StaticCache  = StaticCache;
    }
    const auto Begin = std::chrono::steady_clock::now();
    std::cout << "CONVERGENCE PathTrace512" << std::endl;
    EncodePfm(Destination + "/PathTrace512.pfm", CapturePath(Scene, Combined, 512, 3));
    Timings << "PathTrace512," << Milliseconds(Begin) << ",512\n";
}

void Benchmark(RadianceScene& Scene, const std::string& Destination)
{
    CaptureConfiguration Configuration;
    Configuration.DirectSamples                  = 32;
    Configuration.PrimarySamples                 = 4;
    const auto                         Reference = Capture(Scene, Configuration);
    std::array<std::vector<double>, 2> Measurements;
    for (unsigned Repeat = 0; Repeat < 5; ++Repeat)
        for (unsigned Position = 0; Position < 2; ++Position)
        {
            const unsigned Mode      = (Repeat + Position) % 2;
            Configuration.Visibility = Mode ? VisibilityEvaluation::Hybrid : VisibilityEvaluation::Exact;
            const auto   Begin       = std::chrono::steady_clock::now();
            const auto   Pixels      = Capture(Scene, Configuration);
            const double Duration    = Milliseconds(Begin);
            Verify(std::memcmp(Pixels.data(), Reference.data(), Pixels.size() * sizeof(Vector)) == 0,
                   "Matched benchmark image differs");
            Measurements[Mode].push_back(Duration);
            std::cout << "BENCHMARK mode=" << Mode << " repeat=" << Repeat << " ms=" << Duration << std::endl;
        }
    std::ofstream Report(Destination + "/Benchmark.json");
    Report << std::setprecision(12)
           << "{\n  \"width\":480,\"height\":270,\"primary_samples\":4,\"samples_per_extended_source\":32,"
           << "\n  \"repetitions_per_mode\":5,\"alternating_order\":true,\"same_float_images\":true,\n  \"exact_ms\":[";
    for (unsigned Index = 0; Index < 5; ++Index)
        Report << (Index ? "," : "") << Measurements[0][Index];
    Report << "],\n  \"hybrid_ms\":[";
    for (unsigned Index = 0; Index < 5; ++Index)
        Report << (Index ? "," : "") << Measurements[1][Index];
    auto Exact = Measurements[0], Hybrid = Measurements[1];
    std::sort(Exact.begin(), Exact.end());
    std::sort(Hybrid.begin(), Hybrid.end());
    Report
        << "],\n  \"exact_median_ms\":" << Exact[2] << ",\n  \"hybrid_median_ms\":" << Hybrid[2]
        << ",\n  \"exact_over_hybrid_speed_ratio\":" << Exact[2] / Hybrid[2]
        << ",\n  \"speed_gate_passed\":" << (Hybrid[2] <= Exact[2] ? "true" : "false")
        << ",\n  \"includes\":\"CPU primary tracing, visibility and shading; excludes bake, relight, image encoding\","
        << "\n  \"scope\":\"one fixture on a shared two-vCPU host; not a GPU or frame-pacing benchmark\"\n}\n";
}
} // namespace

//------------------------------------------------------------------------------------------------------------------------
//                                                              MAIN
//------------------------------------------------------------------------------------------------------------------------

int main(int ArgumentCount, char** Arguments)
{
    try
    {
        Require(ArgumentCount >= 3,
                "Usage: RadianceEvaluation <archive directory> <output directory> [samples=32] [motion=12] "
                "[numeric|capture|convergence|benchmark|all]");
        const std::string Destination = Arguments[2];
        std::filesystem::create_directories(Destination);
        const unsigned    Samples   = ArgumentCount > 3 ? unsigned(std::stoul(Arguments[3])) : 32;
        const unsigned    Motion    = ArgumentCount > 4 ? unsigned(std::stoul(Arguments[4])) : 12;
        const std::string Selection = ArgumentCount > 5 ? Arguments[5] : "all";
        Require(Samples > 0 && Samples <= 4096 && Motion <= 120, "Capture budget outside declared limits");
        RadianceScene Scene;
        Scene.Construct(Arguments[1]);
        auto Begin = std::chrono::steady_clock::now();
        Scene.LocalDistance.Bake(Scene.Vehicle);
        const double BakeMs = Milliseconds(Begin);
        Begin               = std::chrono::steady_clock::now();
        Scene.Clipmap.Relocate({}, {0, 0, 1});
        const double ClipMs = Milliseconds(Begin);
        std::cout << "BAKED facets=" << Scene.Vehicle.Surfaces.size()
                  << " samples=" << Scene.LocalDistance.Samples.size() << " bake_ms=" << BakeMs << " clip_ms=" << ClipMs
                  << std::endl;
        std::ofstream Construction(Destination + "/Construction.json");
        Construction << "{\"local_bake_ms\":" << BakeMs << ",\"cold_clipmap_ms\":" << ClipMs
                     << ",\"local_extent\":[80,40,32],\"local_spacing_m\":[" << Scene.LocalDistance.Spacing.X << ','
                     << Scene.LocalDistance.Spacing.Y << ',' << Scene.LocalDistance.Spacing.Z
                     << "],\"clipmap_extent\":[48,48,48],"
                     << "\"clipmap_spacing_m\":[0.125,0.25,0.5],\"clipmap_bytes\":"
                     << 3 * 48 * 48 * 48 * sizeof(ClipTexel)
                     << ",\"vehicle_distance_signed\":false,\"closed_calibration_distance_signed\":true}\n";
        Require(Selection == "all" || Selection == "numeric" || Selection == "capture" || Selection == "convergence" ||
                    Selection == "benchmark",
                "Unknown operation");
        if (Selection == "numeric" || Selection == "all") Validate(Scene, Destination);
        if (Selection == "capture" || Selection == "all") Captures(Scene, Destination, Samples, Motion);
        if (Selection == "convergence") Convergence(Scene, Destination);
        if (Selection == "benchmark") Benchmark(Scene, Destination);
        std::cout << "COMPLETED CPU diagnostic only; no production renderer or real-time acceptance" << std::endl;
        return 0;
    }
    catch (const std::exception& Error)
    {
        std::cerr << "FAILED: " << Error.what() << std::endl;
        return 1;
    }
}
