/*============================================================================================================================================
                                                          TRANSPORTVULKAN.CPP
============================================================================================================================================*/
// 🧩 Cone/probe GPU parity, Jacobi bounces and native GI readbacks; not a full GPU scene renderer.

#include "TransportCompute.h"
#include <iomanip>

using namespace Frontier::DistanceClipmapExperiment;

namespace
{
using Float4 = std::array<float, 4>;

//------------------------------------------------------------------------------------------------------------------------
//                                               CPU / GPU PARITY MEASUREMENTS
//------------------------------------------------------------------------------------------------------------------------

float Difference(Vector A, Vector B)
{
    const auto Delta = Absolute(A - B);
    return std::max({Delta.X, Delta.Y, Delta.Z});
}

Vector Rgb(Float4 Channels)
{
    return {Channels[0], Channels[1], Channels[2]};
}

struct ParityMeasurements
{
    float                                ConeField = 0, ConeOpacity = 0, ConeGather = 0, ConeBounce = 0;
    float                                ProbeIrradiance = 0, ProbeMoments = 0, ProbeGather = 0, ProbeBounce = 0;
    unsigned                             GuardedRegions = 0, ReceiverCount = 0;
    std::map<std::string, std::uint64_t> ShaderDigests;
};

std::vector<TransportSite> EncodeSites(const DirectionalRadianceAtlas& Field)
{
    std::vector<TransportSite> Sites;
    for (const auto& Site : Field.Sites)
        Sites.push_back({PrimarySurfaceCapture::Encode(Site.Surface), Site.Direct, 0});
    return Sites;
}

std::vector<Float4> EncodeRadiance(const std::vector<Vector>& Radiance)
{
    std::vector<Float4> Results;
    for (const auto& Rgb : Radiance)
        Results.push_back({Rgb.X, Rgb.Y, Rgb.Z, 1});
    return Results;
}

void ConeEvaluation(RasterValidationDevice&               Device,
                    RadianceScene&                        Scene,
                    DirectionalRadianceAtlas&             Field,
                    const std::vector<TransportReceiver>& Receivers,
                    unsigned                              PrimarySamples,
                    const std::string&                    ShaderDirectory,
                    const std::string&                    Destination,
                    const std::string&                    Prefix,
                    ParityMeasurements&                   Measurements,
                    bool                                  ImageCapture)
{
    const unsigned   SiteCount = unsigned(Field.Sites.size()), PixelCount = unsigned(Receivers.size()) / PrimarySamples;
    const unsigned   ResultOffset = 2 * SiteCount;
    TransportCompute Compute(Device);
    Compute.Construct({SiteCount * sizeof(TransportSite), Field.Taps.size() * sizeof(SurfaceProjection),
                       Field.CellOffsets.size() * sizeof(unsigned), Field.Voxels.size() * sizeof(RadianceOpacity),
                       (ResultOffset + PixelCount) * sizeof(Float4), Receivers.size() * sizeof(TransportReceiver),
                       3 * 48 * 48 * 48 * sizeof(ClipTexel), 16 * sizeof(Float4)},
                      ShaderDirectory,
                      {"InjectDirectionalRadiance", "ReduceDirectionalMip", "GatherConeImage", "BounceConeSites"});
    Compute.Upload(0, EncodeSites(Field));
    Compute.Upload(1, Field.Taps);
    Compute.Upload(2, Field.CellOffsets);
    Compute.Upload(4, EncodeRadiance(Field.Radiance));
    Compute.Upload(5, Receivers);
    for (unsigned Tier = 0; Tier < 3; ++Tier)
        Compute.Upload(6, Scene.Clipmap.Levels[Tier].Texels, Tier * 48 * 48 * 48 * sizeof(ClipTexel));
    std::vector<Float4> Directions;
    for (unsigned Cone = 0; Cone < 16; ++Cone)
        Directions.push_back({Field.ConeDirections[Cone].X, Field.ConeDirections[Cone].Y, Field.ConeDirections[Cone].Z,
                              Field.ConeTangents[Cone]});
    Compute.Upload(7, Directions);
    TransportFootprint Parameters;
    Parameters.Counts      = {SiteCount, PixelCount, PrimarySamples, 0};
    Parameters.Locations   = {0, SiteCount, ResultOffset, 1};
    Parameters.Constraints = {Field.NormalDisplacement, Field.InitialTravel, 24, 0};
    for (unsigned Tier = 0; Tier < 3; ++Tier)
    {
        auto& Origin = Tier == 0 ? Parameters.ClipOrigin0 : Tier == 1 ? Parameters.ClipOrigin1 : Parameters.ClipOrigin2;
        for (unsigned Axis = 0; Axis < 3; ++Axis)
            Origin[Axis] = Scene.Clipmap.Levels[Tier].Origin[Axis];
    }
    auto Inject = [&]()
    {
        Compute.Dispatch("InjectDirectionalRadiance", 3 * 64 * 64 * 64, Parameters);
        for (unsigned Mip = 1; Mip < 7; ++Mip)
        {
            Parameters.Counts[3] = Mip;
            Compute.Dispatch("ReduceDirectionalMip", 3 * DirectionalRadianceAtlas::Cube(64u >> Mip), Parameters);
        }
    };
    Inject();
    const auto* GpuVoxels = static_cast<const Float4*>(Compute.Regions[3].Mapped);
    for (unsigned Index = 0; Index < Field.Voxels.size(); ++Index)
    {
        Measurements.ConeField =
            std::max(Measurements.ConeField, Difference(Rgb(GpuVoxels[Index]), Field.Voxels[Index].Radiance));
        Measurements.ConeOpacity =
            std::max(Measurements.ConeOpacity, std::abs(GpuVoxels[Index][3] - Field.Voxels[Index].Opacity));
    }
    Require(Measurements.ConeField < 2e-5f && Measurements.ConeOpacity < 2e-6f, "GPU directional voxel parity failed");
    auto Gather = [&]()
    {
        Compute.Dispatch("GatherConeImage", PixelCount, Parameters);
        const auto* Output = static_cast<const Float4*>(Compute.Regions[4].Mapped) + ResultOffset;
        Image       Pixels(PixelCount);
        for (unsigned Pixel = 0; Pixel < PixelCount; ++Pixel)
        {
            Pixels[Pixel] = Rgb(Output[Pixel]);
            Require(Output[Pixel][3] == 1 && std::isfinite(Pixels[Pixel].X + Pixels[Pixel].Y + Pixels[Pixel].Z),
                    "GPU cone output was unwritten or nonfinite");
            Vector Expected{};
            for (unsigned Sample = 0; Sample < PrimarySamples; ++Sample)
            {
                const auto& Receiver = Receivers[Pixel * PrimarySamples + Sample];
                if (Receiver.Confirmed > 0)
                {
                    SurfacePoint Surface;
                    Surface.Position = Receiver.Position;
                    Surface.Normal = Surface.GeometricNormal = Receiver.Normal;
                    Surface.Material                         = Receiver.Material;
                    Expected += Field.Indirect(Scene, Surface, Field.Snapshot.Sources);
                }
            }
            Measurements.ConeGather =
                std::max(Measurements.ConeGather, Difference(Pixels[Pixel], Expected / float(PrimarySamples)));
        }
        Require(Measurements.ConeGather < 2e-4f, "GPU cone gather parity failed");
        return Pixels;
    };
    const auto Pixels = Gather();
    if (ImageCapture)
        EncodePfm(Destination + "/" + Prefix + "GpuCone.pfm", Pixels);
    else
    {
        Compute.Dispatch("BounceConeSites", SiteCount, Parameters);
        (void)Field.Bounce(Scene);
        const auto* Output = static_cast<const Float4*>(Compute.Regions[4].Mapped) + SiteCount;
        for (unsigned Index = 0; Index < SiteCount; ++Index)
            Measurements.ConeBounce =
                std::max(Measurements.ConeBounce, Difference(Rgb(Output[Index]), Field.Radiance[Index]));
        Require(Measurements.ConeBounce < 2e-4f, "GPU cone Jacobi propagation parity failed");
        Parameters.Locations[0] = SiteCount;
        Inject();
        (void)Gather();
        // 📝 Clear RGB in the resident device inputs, not the CPU image. Opacity
        // remains unchanged.
        std::vector<Float4> Black(SiteCount);
        Compute.Upload(4, Black, SiteCount * sizeof(Float4));
        Inject();
        Compute.Dispatch("GatherConeImage", PixelCount, Parameters);
        const auto* Dark = static_cast<const Float4*>(Compute.Regions[4].Mapped) + ResultOffset;
        for (unsigned Pixel = 0; Pixel < PixelCount; ++Pixel)
            Require(Dark[Pixel][0] == 0 && Dark[Pixel][1] == 0 && Dark[Pixel][2] == 0,
                    "Cleared GPU surface RGB did not black cone GI");
    }
    Compute.VerifyGuards();
    Measurements.GuardedRegions += 8;
    for (const auto& Entry : Compute.ExecutedEntries)
        Measurements.ShaderDigests[Entry] = Compute.ShaderDigests.at(Entry);
}

void ProbeEvaluation(RasterValidationDevice&               Device,
                     RadianceScene&                        Scene,
                     const DirectionalRadianceAtlas&       Cache,
                     DiffuseProbeLattice&                  Field,
                     const std::vector<TransportReceiver>& Receivers,
                     unsigned                              PrimarySamples,
                     const std::string&                    ShaderDirectory,
                     const std::string&                    Destination,
                     const std::string&                    Prefix,
                     ParityMeasurements&                   Measurements,
                     bool                                  ImageCapture)
{
    const unsigned RayCount = unsigned(Field.Rays.size()), PixelCount = unsigned(Receivers.size()) / PrimarySamples;
    const unsigned ResultOffset = 2 * RayCount, MomentOffset = Field.ProbeCount * 64;

    struct alignas(16) ProbeIntersection
    {
        Vector   Position{};
        unsigned SurfaceIndex = UINT32_MAX;
        Vector   Normal{};
        unsigned Material = 0;
    };

    static_assert(sizeof(ProbeIntersection) == 32 && offsetof(ProbeIntersection, Material) == 28);
    std::vector<ProbeIntersection> Intersections;
    std::vector<float>             ConfidenceAndDistance = Field.Confidence;
    for (const auto& Ray : Field.Rays)
    {
        Intersections.push_back({Ray.Position, Ray.SurfaceIndex, Ray.Normal, Ray.Material});
        ConfidenceAndDistance.push_back(Ray.Distance);
    }
    TransportCompute Compute(Device);
    Compute.Construct({Intersections.size() * sizeof(ProbeIntersection), RayCount * sizeof(Float4),
                       Field.IrradianceWeights.size() * sizeof(float), Field.MomentWeights.size() * sizeof(float),
                       Field.ProbeCount * (64 + 256) * sizeof(Float4), Receivers.size() * sizeof(TransportReceiver),
                       ConfidenceAndDistance.size() * sizeof(float), (ResultOffset + PixelCount) * sizeof(Float4)},
                      ShaderDirectory,
                      {"ConvolveProbeIrradiance", "ConvolveProbeMoments", "GatherProbeImage", "BounceProbeRays"});
    Compute.Upload(0, Intersections);
    Compute.Upload(1, EncodeRadiance(Field.Incoming));
    Compute.Upload(2, Field.IrradianceWeights);
    Compute.Upload(3, Field.MomentWeights);
    Compute.Upload(5, Receivers);
    Compute.Upload(6, ConfidenceAndDistance);
    Compute.Upload(7, EncodeRadiance(Field.Incoming));
    TransportFootprint Parameters;
    Parameters.Counts      = {RayCount, PixelCount, PrimarySamples, Field.RayCount};
    Parameters.Range       = {Field.Extent[0], Field.Extent[1], Field.Extent[2], 0};
    Parameters.Constraints = {Field.Low.X, Field.Low.Y, Field.Low.Z, Field.Spacing};
    Parameters.Locations   = {0, RayCount, ResultOffset, 1};
    Compute.Dispatch("ConvolveProbeMoments", Field.ProbeCount * 256, Parameters);
    Compute.Dispatch("ConvolveProbeIrradiance", Field.ProbeCount * 64, Parameters);
    const auto* GpuAtlas = static_cast<const Float4*>(Compute.Regions[4].Mapped);
    for (unsigned Index = 0; Index < Field.Irradiance.size(); ++Index)
        Measurements.ProbeIrradiance =
            std::max(Measurements.ProbeIrradiance, Difference(Rgb(GpuAtlas[Index]), Field.Irradiance[Index]));
    for (unsigned Index = 0; Index < Field.Moments.size(); ++Index)
    {
        Measurements.ProbeMoments = std::max(
            {Measurements.ProbeMoments, std::abs(GpuAtlas[MomentOffset + Index][0] - Field.Moments[Index].Mean),
             std::abs(GpuAtlas[MomentOffset + Index][1] - Field.Moments[Index].SquaredMean)});
    }
    Require(Measurements.ProbeIrradiance < 2e-5f && Measurements.ProbeMoments < 2e-4f, "GPU probe atlas parity failed");
    auto Gather = [&]()
    {
        Compute.Dispatch("GatherProbeImage", PixelCount, Parameters);
        const auto* Output = static_cast<const Float4*>(Compute.Regions[7].Mapped) + ResultOffset;
        Image       Pixels(PixelCount);
        for (unsigned Pixel = 0; Pixel < PixelCount; ++Pixel)
        {
            Pixels[Pixel] = Rgb(Output[Pixel]);
            Require(Output[Pixel][3] == 1 && std::isfinite(Pixels[Pixel].X + Pixels[Pixel].Y + Pixels[Pixel].Z),
                    "GPU probe output was unwritten or nonfinite");
            Vector Expected{};
            for (unsigned Sample = 0; Sample < PrimarySamples; ++Sample)
            {
                const auto& Receiver = Receivers[Pixel * PrimarySamples + Sample];
                if (Receiver.Confirmed > 0)
                    Expected += Receiver.Reflectance * Field.IrradianceOverPi(Receiver.Position, Receiver.Normal);
            }
            Measurements.ProbeGather =
                std::max(Measurements.ProbeGather, Difference(Pixels[Pixel], Expected / float(PrimarySamples)));
        }
        Require(Measurements.ProbeGather < 2e-4f, "GPU probe gather parity failed");
        return Pixels;
    };
    const auto Pixels = Gather();
    if (ImageCapture)
        EncodePfm(Destination + "/" + Prefix + "GpuProbe.pfm", Pixels);
    else
    {
        Compute.Dispatch("BounceProbeRays", RayCount, Parameters);
        (void)Field.Bounce(Scene, Cache);
        const auto* Output = static_cast<const Float4*>(Compute.Regions[7].Mapped) + RayCount;
        for (unsigned Index = 0; Index < RayCount; ++Index)
            Measurements.ProbeBounce =
                std::max(Measurements.ProbeBounce, Difference(Rgb(Output[Index]), Field.Incoming[Index]));
        Require(Measurements.ProbeBounce < 2e-4f, "GPU probe Jacobi propagation parity failed");
        Parameters.Locations[0] = RayCount;
        Compute.Dispatch("ConvolveProbeIrradiance", Field.ProbeCount * 64, Parameters);
        (void)Gather();
        std::vector<Float4> Black(RayCount);
        Compute.Upload(7, Black, RayCount * sizeof(Float4));
        Compute.Dispatch("ConvolveProbeIrradiance", Field.ProbeCount * 64, Parameters);
        Compute.Dispatch("GatherProbeImage", PixelCount, Parameters);
        const auto* Dark = static_cast<const Float4*>(Compute.Regions[7].Mapped) + ResultOffset;
        for (unsigned Pixel = 0; Pixel < PixelCount; ++Pixel)
            Require(Dark[Pixel][0] == 0 && Dark[Pixel][1] == 0 && Dark[Pixel][2] == 0,
                    "Cleared GPU probe arrivals did not black DDGI");
    }
    Compute.VerifyGuards();
    Measurements.GuardedRegions += 8;
    for (const auto& Entry : Compute.ExecutedEntries)
        Measurements.ShaderDigests[Entry] = Compute.ShaderDigests.at(Entry);
}

} // namespace

//------------------------------------------------------------------------------------------------------------------------
//                                                         NATIVE SUBMISSION
//------------------------------------------------------------------------------------------------------------------------

int main(int Count, char** Arguments)
{
    try
    {
        Require(Count == 6, "TransportVulkan <archive directory> <shader directory> <output "
                            "directory> <Vulkan driver> <validate|capture>");
        const std::string ShaderDirectory = Arguments[2], Destination = Arguments[3], Selection = Arguments[5];
        Require(Selection == "capture" || Selection == "validate", "Unknown GPU transport selection");
        const bool ImageCapture = Selection == "capture";
        std::filesystem::create_directories(Destination);
        RadianceScene Scene;
        Scene.Construct(Arguments[1]);
        Scene.LocalDistance.Bake(Scene.Vehicle);
        Scene.Clipmap.Relocate(Scene.Pose, {0, 0, 1});
        RasterValidationDevice Device(Arguments[4], VK_API_VERSION_1_1);
        std::cout << "GI VULKAN device=" << Device.Properties.deviceName << " type=" << Device.Properties.deviceType
                  << std::endl;
        std::vector<TransportReceiver> Receivers;
        unsigned                       PrimarySamples = 1;
        if (ImageCapture)
        {
            PrimarySurfaceCapture Primary;
            Primary.Construct(Scene);
            Receivers      = Primary.Receivers();
            PrimarySamples = Primary.PrimarySamples;
        }
        else
            for (unsigned Index = 0; Index < 131; ++Index)
            {
                const auto Pair = Quadrature(Index, 13);
                Receivers.push_back({{-5 + Pair[0] * 10, -4 + Pair[1] * 8, 0}, 1, {0, 0, 1}, 0, {.42f, .41f, .39f}, 0});
            }
        ParityMeasurements Measurements;
        Measurements.ReceiverCount = unsigned(Receivers.size());
        for (unsigned Source :
             (ImageCapture ? std::vector<unsigned>{Emissive, Combined} : std::vector<unsigned>{Combined, Dark}))
        {
            DirectionalRadianceAtlas Cones;
            Cones.Refresh(Scene, Source, 32);
            DiffuseProbeLattice Probes;
            Probes.Refresh(Scene, Cones);
            const std::string Prefix = Source == Emissive ? "GiEmissive" : Source == Combined ? "GiCombined" : "GiOff";
            std::cout << "GI VULKAN " << Prefix << " cones" << std::endl;
            ConeEvaluation(Device, Scene, Cones, Receivers, PrimarySamples, ShaderDirectory, Destination, Prefix,
                           Measurements, ImageCapture);
            std::cout << "GI VULKAN " << Prefix << " probes" << std::endl;
            ProbeEvaluation(Device, Scene, Cones, Probes, Receivers, PrimarySamples, ShaderDirectory, Destination,
                            Prefix, Measurements, ImageCapture);
        }
        std::ofstream Report(Destination + (ImageCapture ? "/GiVulkanCapture.json" : "/GiVulkan.json"));
        Report << std::setprecision(12) << "{\n  \"passed\":true,\n  \"device\":\"" << Device.Properties.deviceName
               << "\",\n  \"device_type\":" << Device.Properties.deviceType
               << ",\n  \"receivers\":" << Measurements.ReceiverCount << ",\n  \"primary_samples\":" << PrimarySamples
               << ",\n  \"cone_field_max_error\":" << Measurements.ConeField
               << ",\n  \"cone_opacity_max_error\":" << Measurements.ConeOpacity
               << ",\n  \"cone_gather_max_error\":" << Measurements.ConeGather
               << ",\n  \"cone_bounce_max_error\":" << Measurements.ConeBounce
               << ",\n  \"probe_irradiance_max_error\":" << Measurements.ProbeIrradiance
               << ",\n  \"probe_moments_max_error\":" << Measurements.ProbeMoments
               << ",\n  \"probe_gather_max_error\":" << Measurements.ProbeGather
               << ",\n  \"probe_bounce_max_error\":" << Measurements.ProbeBounce
               << ",\n  \"guarded_regions\":" << Measurements.GuardedRegions
               << ",\n  \"geometry_and_direct_sources_on_cpu\":true,\n  "
                  "\"gpu_scene_renderer\":false,\n  \"executed_spirv_fnv1a64\": {";
        unsigned Index = 0;
        for (const auto& Digest : Measurements.ShaderDigests)
            Report << (Index++ ? "," : "") << "\n    \"" << Digest.first << "\":\"" << Digest.second << "\"";
        Report << "\n  }\n}\n";
        Require(bool(Report), "Cannot retain GPU transport report");
        std::cout << "GI VULKAN PASS cone_max=" << Measurements.ConeGather << " probe_max=" << Measurements.ProbeGather
                  << std::endl;
        return 0;
    }
    catch (const std::exception& Error)
    {
        std::cerr << "GI VULKAN FAILED: " << Error.what() << std::endl;
        return 1;
    }
}
