/*============================================================================================================================================
                                                          SDFSHADOWVULKAN.CPP
============================================================================================================================================*/
// 🧩 Executed six-entry Slang parity and signed-geometry probes using guarded Vulkan storage and existing explicit device lifetime.

#include "TransportCompute.h"
#include "Experimental/DistanceClipmap/Shadows/SdfShadowCapture.h"
#include <bit>
#include <filesystem>
#include <iomanip>

using namespace Frontier::DistanceClipmapExperiment;

namespace
{

//------------------------------------------------------------------------------------------------------------------------
//                                                    GPU INPUTS / COMPARISONS
//------------------------------------------------------------------------------------------------------------------------

const std::vector<std::string> ShadowEntries = {"PointSdfShadow",     "AnalyticSdfPenumbra", "VoxelSdfPenumbra",
                                                "VoxelSdfConeGi",     "HybridSdfSphereCap",  "ReferenceSdfPaths",
                                                "InspectSdfGeometry", "InspectSdfPath",      "InspectSdfBounce"};

Vector Rgb(ShadowFloat4 Channels)
{
    return {Channels[0], Channels[1], Channels[2]};
}

float Difference(Vector A, Vector B)
{
    const auto Delta = Absolute(A - B);
    return std::max({Delta.X, Delta.Y, Delta.Z});
}

TransportReceiver Encode(const ShadowSurface& Surface, unsigned Pixel)
{
    return {Surface.Position,    Surface.Confirmed ? (Surface.Light ? 2.f : 1.f) : 0.f,
            Surface.Normal,      Surface.Primitive,
            Surface.Reflectance, std::bit_cast<float>(Pixel)};
}

struct GpuMeasurements
{
    std::array<float, 6> Direct{}, Indirect{}, FirstBounce{};
    float                Position = 0, Normal = 0, AnalyticDistance = 0, VoxelDistance = 0, VoxelLower = 0;
    unsigned             ConfirmedDifferences = 0, BlackPixels = 0, SourceChangedPixels = 0;
    float ClearedDistanceDifference = 0, ClearedRadianceMaximum = 0, RestoredDifference = 0, CullDisabledDifference = 0;
    float SourceUpdateError = 0, PathProbeError = 0, BounceProbeError = 0;
    unsigned                             GeometryProbes = 0, ComparedPixels = 0;
    std::map<std::string, std::uint64_t> Digests;
};

//------------------------------------------------------------------------------------------------------------------------
//                                              PER-PATH FLOAT32 DIVERGENCE DIAGNOSIS
//------------------------------------------------------------------------------------------------------------------------

void Diagnose(TransportCompute&       Compute,
              TransportFootprint      Parameters,
              const SdfShadowScene&   Scene,
              const SdfShadowFields&  Fields,
              const SdfShadowCapture& Primary,
              unsigned                Pixel,
              const std::string&      Destination,
              GpuMeasurements&        Measurements)
{
    std::ofstream Log(Destination + "/ShadowPathDiagnostic.csv");
    Log << std::setprecision(12)
        << "section,sample,bounce,direct_difference,indirect_difference,position_difference,normal_difference,"
           "reflectance_difference,cpu_material,gpu_material\n";
    Parameters.Counts[1]    = 96;
    Parameters.Counts[2]    = 1;
    Parameters.Locations[1] = 1;
    std::vector<TransportReceiver> Probes;
    std::vector<ShadowSurface>     Current;
    for (unsigned Sample = 0; Sample < 96; ++Sample)
    {
        const auto& Surface = Primary.Surfaces[Pixel * 4 + Sample / 24];
        auto        Encoded = Encode(Surface, Pixel);
        Encoded.Material    = Sample;
        Probes.push_back(Encoded);
        Current.push_back(Surface);
    }
    Compute.Upload(5, Probes);
    Compute.Dispatch("InspectSdfPath", 96, Parameters);
    const auto* Output = static_cast<const ShadowFloat4*>(Compute.Regions[6].Mapped);
    for (unsigned Sample = 0; Sample < 96; ++Sample)
    {
        const auto  Expected        = SdfShadowCapture::Reference(Scene, Fields, Current[Sample], Sample, Pixel, 4);
        const float DirectError     = Difference(Expected.Direct, Rgb(Output[Sample]));
        const float IndirectError   = Difference(Expected.Indirect, Rgb(Output[96 + Sample]));
        Measurements.PathProbeError = std::max({Measurements.PathProbeError, DirectError, IndirectError});
        Log << "path," << Sample << ",0," << DirectError << ',' << IndirectError << ",0,0,0,0,0\n";
    }
    for (unsigned Site = 0; Site < 3; ++Site)
    {
        Parameters.Range[1] = 2 + Site * 4;
        Probes.clear();
        for (unsigned Sample = 0; Sample < 96; ++Sample)
        {
            auto Encoded     = Encode(Current[Sample], Pixel);
            Encoded.Material = Sample;
            Probes.push_back(Encoded);
        }
        Compute.Upload(5, Probes);
        Compute.Dispatch("InspectSdfBounce", 96, Parameters);
        Output = static_cast<const ShadowFloat4*>(Compute.Regions[6].Mapped);
        for (unsigned Sample = 0; Sample < 96; ++Sample)
        {
            if (!Current[Sample].Confirmed || Current[Sample].Light) continue;
            const auto Direction =
                ShadowCosineDirection(Current[Sample].Normal, Quadrature(Sample, 2 + Site * 4, Pixel));
            const auto     Next     = Scene.Trace(Current[Sample].Position + Current[Sample].Normal * .002f, Direction);
            const unsigned Material = Next.Confirmed && !Next.Light ? Scene.Primitives[Next.Primitive].Material : 0;
            Measurements.BounceProbeError =
                std::max({Measurements.BounceProbeError, Difference(Direction, Rgb(Output[Sample])),
                          Difference(Next.Position, Rgb(Output[96 + Sample])),
                          Difference(Next.Normal, Rgb(Output[192 + Sample])),
                          Difference(Next.Reflectance, Rgb(Output[288 + Sample]))});
            Log << "bounce," << Sample << ',' << Site << ',' << Difference(Direction, Rgb(Output[Sample])) << ",0,"
                << Difference(Next.Position, Rgb(Output[96 + Sample])) << ','
                << Difference(Next.Normal, Rgb(Output[192 + Sample])) << ','
                << Difference(Next.Reflectance, Rgb(Output[288 + Sample])) << ',' << Material << ','
                << Output[96 + Sample][3] << '\n';
            Current[Sample] = Next;
        }
    }
    std::cout << "Retained per-path diagnosis for pixel " << Pixel << std::endl;
}

//------------------------------------------------------------------------------------------------------------------------
//                                                 SIX EXECUTED SHADOW / GI SELECTIONS
//------------------------------------------------------------------------------------------------------------------------

void Validate(RasterValidationDevice& Device,
              const std::string&      ShaderDirectory,
              const std::string&      Destination,
              bool                    FullCapture)
{
    SdfShadowScene  Scene;
    SdfShadowFields Fields;
    Fields.Refresh(Scene);
    SdfShadowCapture Primary;
    Primary.Construct(Scene);
    std::vector<unsigned> Pixels;
    if (FullCapture)
    {
        Pixels.resize(CaptureWidth * CaptureHeight);
        std::iota(Pixels.begin(), Pixels.end(), 0u);
    }
    else
    {
        // 📝 Stratified full-image receivers include the source, near contact, thin rods, grazing walls and far floor.
        for (unsigned Y = 0; Y < 12; ++Y)
            for (unsigned X = 0; X < 24; ++X)
                Pixels.push_back((Y * 22 + 9) * CaptureWidth + X * 20 + 7);
    }
    const unsigned                 PixelCount = unsigned(Pixels.size());
    std::vector<TransportReceiver> Receivers;
    for (unsigned Pixel : Pixels)
        for (unsigned PrimaryIndex = 0; PrimaryIndex < SdfShadowCapture::PrimarySites; ++PrimaryIndex)
            Receivers.push_back(Encode(Primary.Surfaces[Pixel * SdfShadowCapture::PrimarySites + PrimaryIndex], Pixel));
    std::vector<unsigned> Sobol;
    for (const auto& Dimension : SobolDirections)
        Sobol.insert(Sobol.end(), std::begin(Dimension), std::end(Dimension));
    std::vector<ShadowFloat4> Directions;
    for (unsigned Index = 0; Index < 16; ++Index)
    {
        const auto Direction = Fields.Cones.ConeDirections[Index];
        Directions.push_back({Direction.X, Direction.Y, Direction.Z, Fields.Cones.ConeTangents[Index]});
    }
    TransportCompute Compute(Device);
    Compute.Construct({Scene.Primitives.size() * sizeof(ShadowPrimitive), Scene.Palette.size() * sizeof(ShadowFloat4),
                       Fields.Distances.size() * sizeof(float), Fields.Cones.Voxels.size() * sizeof(RadianceOpacity),
                       Sobol.size() * sizeof(unsigned), Receivers.size() * sizeof(TransportReceiver),
                       4 * PixelCount * sizeof(ShadowFloat4), Directions.size() * sizeof(ShadowFloat4)},
                      ShaderDirectory, ShadowEntries);
    Compute.Upload(0, Scene.Primitives);
    Compute.Upload(1, std::vector<ShadowFloat4>(Scene.Palette.begin(), Scene.Palette.end()));
    Compute.Upload(2, Fields.Distances);
    Compute.Upload(3, Fields.Cones.Voxels);
    Compute.Upload(4, Sobol);
    Compute.Upload(5, Receivers);
    Compute.Upload(7, Directions);
    TransportFootprint Parameters;
    Parameters.Counts    = {unsigned(Scene.Primitives.size()), PixelCount, SdfShadowCapture::PrimarySites, 0};
    Parameters.Locations = {0, SdfShadowCapture::PathsPerSite, SdfShadowScene::ScatteringSites, 1};
    GpuMeasurements Measurements;
    Measurements.ComparedPixels = PixelCount;
    std::array<Image, 6> Baseline;
    for (unsigned Mode = 0; Mode < 6; ++Mode)
    {
        Compute.Dispatch(ShadowEntries[Mode], PixelCount, Parameters);
        const auto*     Output = static_cast<const ShadowFloat4*>(Compute.Regions[6].Mapped);
        SdfShadowImages Gpu(PixelCount);
        unsigned        WorstPixel = 0;
        for (unsigned Index = 0; Index < PixelCount; ++Index)
        {
            const unsigned Pixel = Pixels[Index];
            ShadowRadiance Expected;
            Vector         FirstBounce{};
            for (unsigned PrimaryIndex = 0; PrimaryIndex < SdfShadowCapture::PrimarySites; ++PrimaryIndex)
            {
                const auto& Surface = Primary.Surfaces[Pixel * SdfShadowCapture::PrimarySites + PrimaryIndex];
                if (!Surface.Confirmed) continue;
                if (Mode == 5)
                {
                    for (unsigned Path = 0; Path < SdfShadowCapture::PathsPerSite; ++Path)
                    {
                        const auto Radiance = SdfShadowCapture::Reference(
                            Scene, Fields, Surface, PrimaryIndex * SdfShadowCapture::PathsPerSite + Path, Pixel,
                            SdfShadowScene::ScatteringSites, &FirstBounce);
                        Expected.Direct += Radiance.Direct;
                        Expected.Indirect += Radiance.Indirect;
                    }
                }
                else
                {
                    Expected.Direct += Surface.Light
                                           ? Scene.LightRadiance()
                                           : Fields.Direct(Scene, Surface, Mode, SdfShadowCapture::PathsPerSite, Pixel,
                                                           PrimaryIndex * SdfShadowCapture::PathsPerSite);
                    if (Mode == 3) Expected.Indirect += Fields.Indirect(Surface);
                }
            }
            const float Divisor =
                Mode == 5 ? float(SdfShadowCapture::PathsPerPixel) : float(SdfShadowCapture::PrimarySites);
            Expected.Direct      = Expected.Direct / Divisor;
            Expected.Indirect    = Expected.Indirect / Divisor;
            FirstBounce          = Mode == 3 ? Expected.Indirect : FirstBounce / Divisor;
            Gpu.Direct[Index]    = Rgb(Output[Index]);
            Gpu.Indirect[Index]  = Rgb(Output[PixelCount + Index]);
            Gpu.OneBounce[Index] = Rgb(Output[2 * PixelCount + Index]);
            Gpu.Combined[Index]  = Gpu.Direct[Index] + Gpu.Indirect[Index];
            for (unsigned Plane = 0; Plane < 3; ++Plane)
                Require(Output[Plane * PixelCount + Index][3] == 1 &&
                            std::isfinite(Output[Plane * PixelCount + Index][0] +
                                          Output[Plane * PixelCount + Index][1] +
                                          Output[Plane * PixelCount + Index][2]),
                        "Unwritten / nonfinite SDF shader output");
            Measurements.Direct[Mode] =
                std::max(Measurements.Direct[Mode], Difference(Gpu.Direct[Index], Expected.Direct));
            if (Difference(Gpu.Indirect[Index], Expected.Indirect) > Measurements.Indirect[Mode]) WorstPixel = Pixel;
            Measurements.Indirect[Mode] =
                std::max(Measurements.Indirect[Mode], Difference(Gpu.Indirect[Index], Expected.Indirect));
            Measurements.FirstBounce[Mode] =
                std::max(Measurements.FirstBounce[Mode], Difference(Gpu.OneBounce[Index], FirstBounce));
        }
        std::cout << "Executed " << ShadowEntries[Mode] << ": direct " << Measurements.Direct[Mode] << ", indirect "
                  << Measurements.Indirect[Mode] << std::endl;
        if (Mode == 5 && Measurements.Indirect[Mode] >= 8e-4f)
            Diagnose(Compute, Parameters, Scene, Fields, Primary, WorstPixel, Destination, Measurements);
        Require(Measurements.Direct[Mode] < 3e-4f && Measurements.Indirect[Mode] < 8e-4f &&
                    Measurements.FirstBounce[Mode] < 8e-4f,
                "Six-path Float32 CPU / Vulkan parity exceeded declared tolerance");
        Baseline[Mode] = Gpu.Combined;
        if (FullCapture)
        {
            const auto Prefix = Destination + "/ShadowGpu" + std::to_string(Mode);
            EncodePfm(Prefix + "Direct.pfm", Gpu.Direct);
            EncodePfm(Prefix + "Indirect.pfm", Gpu.Indirect);
            EncodePfm(Prefix + "Combined.pfm", Gpu.Combined);
        }
    }
    // 📝 Clear actual resident device inputs; restore and resubmit independently of CPU baseline images.
    auto MaximumOutput = [&]()
    {
        const auto* Output  = static_cast<const ShadowFloat4*>(Compute.Regions[6].Mapped);
        float       Maximum = 0;
        for (unsigned Index = 0; Index < PixelCount; ++Index)
            Maximum = std::max(Maximum, Difference(Rgb(Output[PixelCount + Index]), {}));
        return Maximum;
    };
    std::vector<float> ClearedDistance(Fields.Distances.size(), 1000.f);
    Compute.Upload(2, ClearedDistance);
    Compute.Dispatch(ShadowEntries[2], PixelCount, Parameters);
    const auto* Output = static_cast<const ShadowFloat4*>(Compute.Regions[6].Mapped);
    for (unsigned Index = 0; Index < PixelCount; ++Index)
        Measurements.ClearedDistanceDifference =
            std::max(Measurements.ClearedDistanceDifference, Difference(Rgb(Output[Index]), Baseline[2][Index]));
    Require(Measurements.ClearedDistanceDifference > .001f, "GPU voxel shadows did not consume uploaded signed field");
    std::fill(ClearedDistance.begin(), ClearedDistance.end(), 0.f);
    Compute.Upload(2, ClearedDistance);
    Compute.Dispatch(ShadowEntries[4], PixelCount, Parameters);
    Output = static_cast<const ShadowFloat4*>(Compute.Regions[6].Mapped);
    for (unsigned Index = 0; Index < PixelCount; ++Index)
        Measurements.CullDisabledDifference =
            std::max(Measurements.CullDisabledDifference, Difference(Rgb(Output[Index]), Baseline[4][Index]));
    Require(Measurements.CullDisabledDifference < 1e-6f, "Disabling GPU distance skips changed SDF cap visibility");
    Compute.Upload(2, Fields.Distances);
    auto DarkVoxels = Fields.Cones.Voxels;
    for (auto& Texel : DarkVoxels)
        Texel.Radiance = {};
    Compute.Upload(3, DarkVoxels);
    Compute.Dispatch(ShadowEntries[3], PixelCount, Parameters);
    Measurements.ClearedRadianceMaximum = MaximumOutput();
    Require(Measurements.ClearedRadianceMaximum == 0, "GPU cone GI survived cleared resident RGB");
    Compute.Upload(3, Fields.Cones.Voxels);
    Compute.Dispatch(ShadowEntries[3], PixelCount, Parameters);
    Output = static_cast<const ShadowFloat4*>(Compute.Regions[6].Mapped);
    for (unsigned Index = 0; Index < PixelCount; ++Index)
        Measurements.RestoredDifference =
            std::max(Measurements.RestoredDifference,
                     Difference(Rgb(Output[Index]) + Rgb(Output[PixelCount + Index]), Baseline[3][Index]));
    Require(Measurements.RestoredDifference == 0, "Restored GPU fields differ from the original submission");
    Parameters.Locations[3] = 0;
    Compute.Upload(3, DarkVoxels);
    for (unsigned Mode = 0; Mode < 6; ++Mode)
    {
        Compute.Dispatch(ShadowEntries[Mode], PixelCount, Parameters);
        Output = static_cast<const ShadowFloat4*>(Compute.Regions[6].Mapped);
        for (unsigned Index = 0; Index < 3 * PixelCount; ++Index)
            Require(Output[Index][0] == 0 && Output[Index][1] == 0 && Output[Index][2] == 0,
                    "Sphere-off GPU path is not black");
        Measurements.BlackPixels += PixelCount;
    }
    Parameters.Locations[3] = 1;
    Compute.Upload(3, Fields.Cones.Voxels);
    std::vector<TransportReceiver> Probes;
    for (unsigned Index = 0; Index < PixelCount; ++Index)
    {
        const auto   Pair = Quadrature(Index, 3);
        const Vector Origin{-3 + 6 * Pair[0], -3 + 6 * Pair[1], .37f + .01f * (Index % 280)};
        Probes.push_back({Origin, 1, Normalize(Scene.LightCenter() - Origin), 0, {}, 0});
    }
    Compute.Upload(5, Probes);
    Compute.Dispatch(ShadowEntries[6], PixelCount, Parameters);
    Output = static_cast<const ShadowFloat4*>(Compute.Regions[6].Mapped);
    for (unsigned Index = 0; Index < PixelCount; ++Index)
    {
        const auto& Probe     = Probes[Index];
        const auto  Surface   = Scene.Trace(Probe.Position, Probe.Normal);
        const float Confirmed = Surface.Confirmed ? (Surface.Light ? 2.f : 1.f) : 0.f;
        if (Output[Index][3] != Confirmed) ++Measurements.ConfirmedDifferences;
        Measurements.Position = std::max(Measurements.Position, Difference(Rgb(Output[Index]), Surface.Position));
        Measurements.Normal =
            std::max(Measurements.Normal, Difference(Rgb(Output[PixelCount + Index]), Surface.Normal));
        Measurements.AnalyticDistance =
            std::max(Measurements.AnalyticDistance,
                     std::abs(Output[PixelCount + Index][3] - Scene.Distance(Probe.Position, false).Distance));
        const auto Sample = Fields.Sample(Probe.Position, true);
        Measurements.VoxelDistance =
            std::max(Measurements.VoxelDistance, std::abs(Output[2 * PixelCount + Index][0] - Sample.Raw));
        Measurements.VoxelLower =
            std::max(Measurements.VoxelLower, std::abs(Output[2 * PixelCount + Index][1] - Sample.Lower));
    }
    Measurements.GeometryProbes = PixelCount;
    Require(Measurements.ConfirmedDifferences == 0 && Measurements.Position < 2e-4f && Measurements.Normal < 2e-4f &&
                Measurements.AnalyticDistance < 2e-6f && Measurements.VoxelDistance < 2e-6f &&
                Measurements.VoxelLower < 2e-6f,
            "SDF geometry / signed voxel Vulkan parity failed");
    Diagnose(Compute, Parameters, Scene, Fields, Primary, 36347, Destination, Measurements);
    Require(Measurements.PathProbeError < 2e-5f && Measurements.BounceProbeError < 2e-5f,
            "Per-path / per-bounce SDF precision regression at the previously failing checker receiver");
    Scene.Primitives[4].Position.X += .21f;
    Scene.Palette[11][0] += .17f;
    Fields.Refresh(Scene);
    Primary.Construct(Scene);
    Receivers.clear();
    for (unsigned Pixel : Pixels)
        for (unsigned PrimaryIndex = 0; PrimaryIndex < 4; ++PrimaryIndex)
            Receivers.push_back(Encode(Primary.Surfaces[Pixel * 4 + PrimaryIndex], Pixel));
    Compute.Upload(0, Scene.Primitives);
    Compute.Upload(1, std::vector<ShadowFloat4>(Scene.Palette.begin(), Scene.Palette.end()));
    Compute.Upload(2, Fields.Distances);
    Compute.Upload(3, Fields.Cones.Voxels);
    Compute.Upload(5, Receivers);
    Compute.Dispatch(ShadowEntries[4], PixelCount, Parameters);
    Output = static_cast<const ShadowFloat4*>(Compute.Regions[6].Mapped);
    for (unsigned Index = 0; Index < PixelCount; ++Index)
    {
        Vector         Expected{};
        const unsigned Pixel = Pixels[Index];
        for (unsigned PrimaryIndex = 0; PrimaryIndex < 4; ++PrimaryIndex)
        {
            const auto& Surface = Primary.Surfaces[Pixel * 4 + PrimaryIndex];
            if (!Surface.Confirmed) continue;
            Expected +=
                Surface.Light ? Scene.LightRadiance() : Fields.Direct(Scene, Surface, 4, 24, Pixel, PrimaryIndex * 24);
        }
        Measurements.SourceUpdateError =
            std::max(Measurements.SourceUpdateError, Difference(Expected / 4, Rgb(Output[Index])));
        if (Difference(Rgb(Output[Index]), Baseline[4][Index]) > 1e-6f) ++Measurements.SourceChangedPixels;
    }
    Require(Measurements.SourceChangedPixels > 0 && Measurements.SourceUpdateError < 3e-4f,
            "Refreshed moving SDF primitive / sphere GPU inputs did not match fresh CPU lighting");
    Compute.VerifyGuards();
    std::ofstream Report(Destination + "/ShadowVulkan.json");
    Report << std::setprecision(12) << "{\n  \"passed\": true,\n  \"renderer_accepted\": false,\n  \"device\": \""
           << Device.Properties.deviceName << "\",\n  \"device_type\": " << Device.Properties.deviceType
           << ",\n  \"compared_pixels_each_path\": " << PixelCount
           << ",\n  \"primary_sites\": 4,\n  \"paths_per_pixel_reference\": 96,\n  \"full_capture\": "
           << (FullCapture ? "true" : "false")
           << ",\n  \"guarded_regions\": 8,\n  \"guard_bytes_each\": 64,\n  \"float32_direct_max\": [";
    for (unsigned Index = 0; Index < 6; ++Index)
        Report << (Index ? ", " : "") << Measurements.Direct[Index];
    Report << "],\n  \"float32_indirect_max\": [";
    for (unsigned Index = 0; Index < 6; ++Index)
        Report << (Index ? ", " : "") << Measurements.Indirect[Index];
    Report << "],\n  \"float32_first_bounce_max\": [";
    for (unsigned Index = 0; Index < 6; ++Index)
        Report << (Index ? ", " : "") << Measurements.FirstBounce[Index];
    Report << "],\n  \"source_off_black_pixels\": " << Measurements.BlackPixels
           << ",\n  \"distance_clear_rgb_difference\": " << Measurements.ClearedDistanceDifference
           << ",\n  \"cull_disabled_difference\": " << Measurements.CullDisabledDifference
           << ",\n  \"radiance_clear_maximum\": " << Measurements.ClearedRadianceMaximum
           << ",\n  \"restore_difference\": " << Measurements.RestoredDifference
           << ",\n  \"moving_sdf_source_changed_pixels\": " << Measurements.SourceChangedPixels
           << ",\n  \"moving_sdf_source_max_error\": " << Measurements.SourceUpdateError
           << ",\n  \"regression_pixel\": 36347,\n  \"per_path_probes\": 96"
           << ",\n  \"per_path_max_error\": " << Measurements.PathProbeError
           << ",\n  \"per_bounce_max_error\": " << Measurements.BounceProbeError
           << ",\n  \"geometry_probes\": " << Measurements.GeometryProbes
           << ",\n  \"hit_differences\": " << Measurements.ConfirmedDifferences
           << ",\n  \"position_max\": " << Measurements.Position << ",\n  \"normal_max\": " << Measurements.Normal
           << ",\n  \"analytic_distance_max\": " << Measurements.AnalyticDistance
           << ",\n  \"voxel_distance_max\": " << Measurements.VoxelDistance
           << ",\n  \"voxel_lower_max\": " << Measurements.VoxelLower << ",\n  \"executed_entries_fnv1a64\": {";
    unsigned Sequence = 0;
    for (const auto& Entry : Compute.ExecutedEntries)
        Report << (Sequence++ ? "," : "") << "\n    \"" << Entry << "\": \"" << Compute.ShaderDigests.at(Entry) << '"';
    Report << "\n  }\n}\n";
    Require(bool(Report), "Cannot retain SDF Vulkan report");
}

} // namespace

//------------------------------------------------------------------------------------------------------------------------
//                                                           ENTRY POINT
//------------------------------------------------------------------------------------------------------------------------

int main(int Count, char** Arguments)
{
    try
    {
        Require(Count == 5,
                "Usage: SdfShadowVulkan <shader-directory> <output-directory> <driver-library> <validate|capture>");
        const std::string Operation = Arguments[4];
        Require(Operation == "validate" || Operation == "capture", "Unknown SDF Vulkan operation");
        std::filesystem::create_directories(Arguments[2]);
        RasterValidationDevice Device(Arguments[3], VK_API_VERSION_1_1);
        Validate(Device, Arguments[1], Arguments[2], Operation == "capture");
        std::cout << "Nine SDF shader entries completed with guarded readback" << std::endl;
        return 0;
    }
    catch (const std::exception& Error)
    {
        std::cerr << "SDF Vulkan failure: " << Error.what() << '\n';
        return 1;
    }
}
