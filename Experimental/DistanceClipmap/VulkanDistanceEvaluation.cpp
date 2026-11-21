/*============================================================================================================================================
                                                       VULKANDISTANCEEVALUATION.CPP
============================================================================================================================================*/
// 🧩 C++ Vulkan submission and readback acceptance for GPU distance baking, clipmaps, shadows and a resident vehicle cache.

#include "RadianceScene.h"
#include <vulkan/vulkan.h>
#include <filesystem>
#include <iomanip>
#include <iostream>
#include <map>

using namespace Frontier::DistanceClipmapExperiment;

namespace
{
//------------------------------------------------------------------------------------------------------------------------
//                                                  NATIVE VULKAN RESOURCE LIFETIMES
//------------------------------------------------------------------------------------------------------------------------

void Confirm(VkResult Result, const char* Operation)
{
    if (Result != VK_SUCCESS) throw std::runtime_error(std::string(Operation) + " failed: " + std::to_string(Result));
}

struct DeviceBuffer
{
    VkBuffer       Storage    = VK_NULL_HANDLE;
    VkDeviceMemory Allocation = VK_NULL_HANDLE;
    void*          Mapped     = nullptr;
    std::size_t    Bytes      = 0;
};

struct alignas(16) FacetFootprint
{
    std::array<float, 3> A{};
    std::uint32_t        Material = 0;
    std::array<float, 4> B{}, C{};
};
static_assert(sizeof(FacetFootprint) == 48 && alignof(FacetFootprint) == 16);
static_assert(offsetof(FacetFootprint, Material) == 12 && offsetof(FacetFootprint, B) == 16 &&
              offsetof(FacetFootprint, C) == 32);

struct alignas(16) ProbeFootprint
{
    std::array<float, 4> OriginLimit{}, Direction{}, Position{};
};
struct alignas(16) BoxFootprint
{
    std::array<float, 4> Centre{}, HalfExtent{};
};
struct alignas(16) DistanceFootprint
{
    std::array<float, 4>    LocalMinimum{}, LocalSpacing{};
    std::array<unsigned, 4> ExtentAndCount{};
    std::array<float, 4>    PoseCosineSine{}, Translation{};
    std::array<int, 4>      ClipOrigin0{}, ClipOrigin1{}, ClipOrigin2{};
};
static_assert(sizeof(float) == 4 && sizeof(std::uint32_t) == 4 && std::numeric_limits<float>::is_iec559);
static_assert(sizeof(Frontier::TriangleVisibilitySpace::FloatEnclosure) == 48);
static_assert(offsetof(Frontier::TriangleVisibilitySpace::FloatEnclosure, Minimum) == 0);
static_assert(offsetof(Frontier::TriangleVisibilitySpace::FloatEnclosure, Maximum) == 16);
static_assert(offsetof(Frontier::TriangleVisibilitySpace::FloatEnclosure, Links) == 32);
static_assert(sizeof(ProbeFootprint) == 48 && alignof(ProbeFootprint) == 16);
static_assert(offsetof(ProbeFootprint, OriginLimit) == 0 && offsetof(ProbeFootprint, Direction) == 16 &&
              offsetof(ProbeFootprint, Position) == 32);
static_assert(sizeof(BoxFootprint) == 32 && alignof(BoxFootprint) == 16 && offsetof(BoxFootprint, HalfExtent) == 16);
static_assert(sizeof(ClipTexel) == 16 && offsetof(ClipTexel, Lower) == 4 && offsetof(ClipTexel, SignedStatic) == 8 &&
              offsetof(ClipTexel, Occupancy) == 12);
static_assert(sizeof(DistanceFootprint) == 128 && alignof(DistanceFootprint) == 16);
static_assert(offsetof(DistanceFootprint, LocalMinimum) == 0 && offsetof(DistanceFootprint, LocalSpacing) == 16);
static_assert(offsetof(DistanceFootprint, ExtentAndCount) == 32 && offsetof(DistanceFootprint, PoseCosineSine) == 48);
static_assert(offsetof(DistanceFootprint, Translation) == 64 && offsetof(DistanceFootprint, ClipOrigin0) == 80);
static_assert(offsetof(DistanceFootprint, ClipOrigin1) == 96 && offsetof(DistanceFootprint, ClipOrigin2) == 112);

class VulkanCompute
{
public:
    VkInstance                        Instance = VK_NULL_HANDLE;
    VkPhysicalDevice                  Physical = VK_NULL_HANDLE;
    VkDevice                          Device   = VK_NULL_HANDLE;
    VkQueue                           Queue    = VK_NULL_HANDLE;
    VkPhysicalDeviceProperties        Properties{};
    unsigned                          QueueFamily      = 0;
    VkDescriptorSetLayout             DescriptorLayout = VK_NULL_HANDLE;
    VkDescriptorPool                  DescriptorPool   = VK_NULL_HANDLE;
    VkDescriptorSet                   Descriptors      = VK_NULL_HANDLE;
    VkPipelineLayout                  PipelineLayout   = VK_NULL_HANDLE;
    VkCommandPool                     CommandPool      = VK_NULL_HANDLE;
    VkCommandBuffer                   Commands         = VK_NULL_HANDLE;
    VkFence                           Completion       = VK_NULL_HANDLE;
    std::array<DeviceBuffer, 8>       Buffers{};
    std::map<std::string, VkPipeline> Pipelines;

    ~VulkanCompute()
    {
        if (Device) vkDeviceWaitIdle(Device);
        if (Completion) vkDestroyFence(Device, Completion, nullptr);
        if (CommandPool) vkDestroyCommandPool(Device, CommandPool, nullptr);
        for (auto& Entry : Pipelines)
            if (Entry.second) vkDestroyPipeline(Device, Entry.second, nullptr);
        if (PipelineLayout) vkDestroyPipelineLayout(Device, PipelineLayout, nullptr);
        if (DescriptorPool) vkDestroyDescriptorPool(Device, DescriptorPool, nullptr);
        if (DescriptorLayout) vkDestroyDescriptorSetLayout(Device, DescriptorLayout, nullptr);
        for (auto& Region : Buffers)
        {
            if (Region.Mapped) vkUnmapMemory(Device, Region.Allocation);
            if (Region.Storage) vkDestroyBuffer(Device, Region.Storage, nullptr);
            if (Region.Allocation) vkFreeMemory(Device, Region.Allocation, nullptr);
        }
        if (Device) vkDestroyDevice(Device, nullptr);
        if (Instance) vkDestroyInstance(Instance, nullptr);
    }

    void Initialize()
    {
        VkApplicationInfo Application{VK_STRUCTURE_TYPE_APPLICATION_INFO};
        Application.pApplicationName = "Frontier isolated distance clipmap acceptance";
        Application.apiVersion       = VK_API_VERSION_1_1;
        VkInstanceCreateInfo InstanceDescription{VK_STRUCTURE_TYPE_INSTANCE_CREATE_INFO};
        InstanceDescription.pApplicationInfo = &Application;
        Confirm(vkCreateInstance(&InstanceDescription, nullptr, &Instance), "vkCreateInstance");
        unsigned DeviceCount = 0;
        Confirm(vkEnumeratePhysicalDevices(Instance, &DeviceCount, nullptr), "vkEnumeratePhysicalDevices count");
        Require(DeviceCount > 0, "No Vulkan device");
        std::vector<VkPhysicalDevice> PhysicalDevices(DeviceCount);
        Confirm(vkEnumeratePhysicalDevices(Instance, &DeviceCount, PhysicalDevices.data()),
                "vkEnumeratePhysicalDevices");
        Physical = PhysicalDevices[0];
        vkGetPhysicalDeviceProperties(Physical, &Properties);
        Require(Properties.limits.maxPerStageDescriptorStorageBuffers >= 8,
                "GPU requires eight compute storage buffers");
        Require(Properties.limits.maxPushConstantsSize >= sizeof(DistanceFootprint),
                "128-byte push constant support required");
        unsigned FamilyCount = 0;
        vkGetPhysicalDeviceQueueFamilyProperties(Physical, &FamilyCount, nullptr);
        std::vector<VkQueueFamilyProperties> Families(FamilyCount);
        vkGetPhysicalDeviceQueueFamilyProperties(Physical, &FamilyCount, Families.data());
        bool Located = false;
        for (unsigned Index = 0; Index < FamilyCount; ++Index)
            if (Families[Index].queueCount && (Families[Index].queueFlags & VK_QUEUE_COMPUTE_BIT))
            {
                QueueFamily = Index;
                Located     = true;
                break;
            }
        Require(Located, "No compute queue");
        const float             Priority = 1;
        VkDeviceQueueCreateInfo QueueDescription{VK_STRUCTURE_TYPE_DEVICE_QUEUE_CREATE_INFO};
        QueueDescription.queueFamilyIndex = QueueFamily;
        QueueDescription.queueCount       = 1;
        QueueDescription.pQueuePriorities = &Priority;
        VkDeviceCreateInfo DeviceDescription{VK_STRUCTURE_TYPE_DEVICE_CREATE_INFO};
        DeviceDescription.queueCreateInfoCount = 1;
        DeviceDescription.pQueueCreateInfos    = &QueueDescription;
        Confirm(vkCreateDevice(Physical, &DeviceDescription, nullptr, &Device), "vkCreateDevice");
        vkGetDeviceQueue(Device, QueueFamily, 0, &Queue);
        std::cout << "VULKAN device=" << Properties.deviceName << " type=" << Properties.deviceType << std::endl;
    }

    void Allocate(unsigned Index, std::size_t Bytes)
    {
        auto& Region = Buffers[Index];
        Region.Bytes = Bytes;
        Require(Bytes > 0 && Bytes <= Properties.limits.maxStorageBufferRange, "Storage buffer extent rejected");
        VkBufferCreateInfo Description{VK_STRUCTURE_TYPE_BUFFER_CREATE_INFO};
        Description.size  = Bytes;
        Description.usage = VK_BUFFER_USAGE_STORAGE_BUFFER_BIT;
        Confirm(vkCreateBuffer(Device, &Description, nullptr, &Region.Storage), "vkCreateBuffer");
        VkMemoryRequirements Requirements{};
        vkGetBufferMemoryRequirements(Device, Region.Storage, &Requirements);
        VkPhysicalDeviceMemoryProperties Memory{};
        vkGetPhysicalDeviceMemoryProperties(Physical, &Memory);
        const auto Required    = VK_MEMORY_PROPERTY_HOST_VISIBLE_BIT | VK_MEMORY_PROPERTY_HOST_COHERENT_BIT;
        unsigned   MemoryIndex = Memory.memoryTypeCount;
        for (unsigned IndexType = 0; IndexType < Memory.memoryTypeCount; ++IndexType)
            if ((Requirements.memoryTypeBits & (1u << IndexType)) &&
                (Memory.memoryTypes[IndexType].propertyFlags & Required) == Required)
            {
                MemoryIndex = IndexType;
                break;
            }
        Require(MemoryIndex < Memory.memoryTypeCount,
                "Fixture requires coherent mapped memory; a device-local staging path is not implemented");
        VkMemoryAllocateInfo Allocation{VK_STRUCTURE_TYPE_MEMORY_ALLOCATE_INFO};
        Allocation.allocationSize  = Requirements.size;
        Allocation.memoryTypeIndex = MemoryIndex;
        Confirm(vkAllocateMemory(Device, &Allocation, nullptr, &Region.Allocation), "vkAllocateMemory");
        Confirm(vkBindBufferMemory(Device, Region.Storage, Region.Allocation, 0), "vkBindBufferMemory");
        Confirm(vkMapMemory(Device, Region.Allocation, 0, Bytes, 0, &Region.Mapped), "vkMapMemory");
        std::memset(Region.Mapped, 0, Bytes);
    }

    void ConstructPipelines(const std::string& Directory)
    {
        std::array<VkDescriptorSetLayoutBinding, 8> Slots{};
        for (unsigned Index = 0; Index < Slots.size(); ++Index)
            Slots[Index] = {Index, VK_DESCRIPTOR_TYPE_STORAGE_BUFFER, 1, VK_SHADER_STAGE_COMPUTE_BIT, nullptr};
        VkDescriptorSetLayoutCreateInfo DescriptorDescription{VK_STRUCTURE_TYPE_DESCRIPTOR_SET_LAYOUT_CREATE_INFO};
        DescriptorDescription.bindingCount = unsigned(Slots.size());
        DescriptorDescription.pBindings    = Slots.data();
        Confirm(vkCreateDescriptorSetLayout(Device, &DescriptorDescription, nullptr, &DescriptorLayout),
                "vkCreateDescriptorSetLayout");
        VkPushConstantRange        Range{VK_SHADER_STAGE_COMPUTE_BIT, 0, sizeof(DistanceFootprint)};
        VkPipelineLayoutCreateInfo PipelineDescription{VK_STRUCTURE_TYPE_PIPELINE_LAYOUT_CREATE_INFO};
        PipelineDescription.setLayoutCount         = 1;
        PipelineDescription.pSetLayouts            = &DescriptorLayout;
        PipelineDescription.pushConstantRangeCount = 1;
        PipelineDescription.pPushConstantRanges    = &Range;
        Confirm(vkCreatePipelineLayout(Device, &PipelineDescription, nullptr, &PipelineLayout),
                "vkCreatePipelineLayout");
        VkDescriptorPoolSize       Capacity{VK_DESCRIPTOR_TYPE_STORAGE_BUFFER, 8};
        VkDescriptorPoolCreateInfo PoolDescription{VK_STRUCTURE_TYPE_DESCRIPTOR_POOL_CREATE_INFO};
        PoolDescription.maxSets       = 1;
        PoolDescription.poolSizeCount = 1;
        PoolDescription.pPoolSizes    = &Capacity;
        Confirm(vkCreateDescriptorPool(Device, &PoolDescription, nullptr, &DescriptorPool), "vkCreateDescriptorPool");
        VkDescriptorSetAllocateInfo DescriptorAllocation{VK_STRUCTURE_TYPE_DESCRIPTOR_SET_ALLOCATE_INFO};
        DescriptorAllocation.descriptorPool     = DescriptorPool;
        DescriptorAllocation.descriptorSetCount = 1;
        DescriptorAllocation.pSetLayouts        = &DescriptorLayout;
        Confirm(vkAllocateDescriptorSets(Device, &DescriptorAllocation, &Descriptors), "vkAllocateDescriptorSets");
        std::array<VkDescriptorBufferInfo, 8> Regions{};
        std::array<VkWriteDescriptorSet, 8>   Writes{};
        for (unsigned Index = 0; Index < Buffers.size(); ++Index)
        {
            Regions[Index]                = {Buffers[Index].Storage, 0, Buffers[Index].Bytes};
            Writes[Index].sType           = VK_STRUCTURE_TYPE_WRITE_DESCRIPTOR_SET;
            Writes[Index].dstSet          = Descriptors;
            Writes[Index].dstBinding      = Index;
            Writes[Index].descriptorCount = 1;
            Writes[Index].descriptorType  = VK_DESCRIPTOR_TYPE_STORAGE_BUFFER;
            Writes[Index].pBufferInfo     = &Regions[Index];
        }
        vkUpdateDescriptorSets(Device, unsigned(Writes.size()), Writes.data(), 0, nullptr);
        for (const std::string Name : {"BakeLocalDistance",
                                       "FillClipmap",
                                       "EvaluateDistanceProbes",
                                       "RelightVehicleCache",
                                       "GatherVehicleCache",
                                       "ClearVehicleCache"})
        {
            std::ifstream Input(Directory + "/" + Name + ".spv", std::ios::binary | std::ios::ate);
            Require(bool(Input), "Missing shader " + Name);
            const auto Bytes = Input.tellg();
            Require(Bytes > 0 && Bytes % 4 == 0, "Invalid SPIR-V extent");
            std::vector<unsigned> Words(std::size_t(Bytes) / 4);
            Input.seekg(0);
            Require(bool(Input.read(reinterpret_cast<char*>(Words.data()), Bytes)), "SPIR-V read failed");
            VkShaderModuleCreateInfo ShaderDescription{VK_STRUCTURE_TYPE_SHADER_MODULE_CREATE_INFO};
            ShaderDescription.codeSize = std::size_t(Bytes);
            ShaderDescription.pCode    = Words.data();
            VkShaderModule Shader      = VK_NULL_HANDLE;
            Confirm(vkCreateShaderModule(Device, &ShaderDescription, nullptr, &Shader), "vkCreateShaderModule");
            VkComputePipelineCreateInfo Description{VK_STRUCTURE_TYPE_COMPUTE_PIPELINE_CREATE_INFO};
            Description.layout       = PipelineLayout;
            Description.stage.sType  = VK_STRUCTURE_TYPE_PIPELINE_SHADER_STAGE_CREATE_INFO;
            Description.stage.stage  = VK_SHADER_STAGE_COMPUTE_BIT;
            Description.stage.module = Shader;
            Description.stage.pName  = "main";
            VkPipeline Pipeline      = VK_NULL_HANDLE;
            const auto Status = vkCreateComputePipelines(Device, VK_NULL_HANDLE, 1, &Description, nullptr, &Pipeline);
            vkDestroyShaderModule(Device, Shader, nullptr);
            Confirm(Status, "vkCreateComputePipelines");
            Pipelines[Name] = Pipeline;
        }
        VkCommandPoolCreateInfo CommandDescription{VK_STRUCTURE_TYPE_COMMAND_POOL_CREATE_INFO};
        CommandDescription.flags            = VK_COMMAND_POOL_CREATE_RESET_COMMAND_BUFFER_BIT;
        CommandDescription.queueFamilyIndex = QueueFamily;
        Confirm(vkCreateCommandPool(Device, &CommandDescription, nullptr, &CommandPool), "vkCreateCommandPool");
        VkCommandBufferAllocateInfo CommandAllocation{VK_STRUCTURE_TYPE_COMMAND_BUFFER_ALLOCATE_INFO};
        CommandAllocation.commandPool        = CommandPool;
        CommandAllocation.level              = VK_COMMAND_BUFFER_LEVEL_PRIMARY;
        CommandAllocation.commandBufferCount = 1;
        Confirm(vkAllocateCommandBuffers(Device, &CommandAllocation, &Commands), "vkAllocateCommandBuffers");
        VkFenceCreateInfo FenceDescription{VK_STRUCTURE_TYPE_FENCE_CREATE_INFO};
        Confirm(vkCreateFence(Device, &FenceDescription, nullptr, &Completion), "vkCreateFence");
    }

    double Execute(const DistanceFootprint& Parameters, const std::vector<std::pair<std::string, unsigned>>& Sequence)
    {
        const auto               Begin = std::chrono::steady_clock::now();
        VkCommandBufferBeginInfo BeginDescription{VK_STRUCTURE_TYPE_COMMAND_BUFFER_BEGIN_INFO};
        BeginDescription.flags = VK_COMMAND_BUFFER_USAGE_ONE_TIME_SUBMIT_BIT;
        Confirm(vkBeginCommandBuffer(Commands, &BeginDescription), "vkBeginCommandBuffer");
        VkMemoryBarrier Upload{VK_STRUCTURE_TYPE_MEMORY_BARRIER};
        Upload.srcAccessMask = VK_ACCESS_HOST_WRITE_BIT;
        Upload.dstAccessMask = VK_ACCESS_SHADER_READ_BIT | VK_ACCESS_SHADER_WRITE_BIT;
        vkCmdPipelineBarrier(Commands,
                             VK_PIPELINE_STAGE_HOST_BIT,
                             VK_PIPELINE_STAGE_COMPUTE_SHADER_BIT,
                             0,
                             1,
                             &Upload,
                             0,
                             nullptr,
                             0,
                             nullptr);
        vkCmdBindDescriptorSets(
            Commands, VK_PIPELINE_BIND_POINT_COMPUTE, PipelineLayout, 0, 1, &Descriptors, 0, nullptr);
        vkCmdPushConstants(Commands, PipelineLayout, VK_SHADER_STAGE_COMPUTE_BIT, 0, sizeof(Parameters), &Parameters);
        for (const auto& Entry : Sequence)
        {
            Require(Entry.second > 0 && (Entry.second + 63) / 64 <= Properties.limits.maxComputeWorkGroupCount[0],
                    "Dispatch extent rejected");
            vkCmdBindPipeline(Commands, VK_PIPELINE_BIND_POINT_COMPUTE, Pipelines.at(Entry.first));
            vkCmdDispatch(Commands, (Entry.second + 63) / 64, 1, 1);
            VkMemoryBarrier Dependency{VK_STRUCTURE_TYPE_MEMORY_BARRIER};
            Dependency.srcAccessMask = VK_ACCESS_SHADER_WRITE_BIT;
            Dependency.dstAccessMask = VK_ACCESS_SHADER_READ_BIT | VK_ACCESS_SHADER_WRITE_BIT;
            vkCmdPipelineBarrier(Commands,
                                 VK_PIPELINE_STAGE_COMPUTE_SHADER_BIT,
                                 VK_PIPELINE_STAGE_COMPUTE_SHADER_BIT,
                                 0,
                                 1,
                                 &Dependency,
                                 0,
                                 nullptr,
                                 0,
                                 nullptr);
        }
        VkMemoryBarrier Readback{VK_STRUCTURE_TYPE_MEMORY_BARRIER};
        Readback.srcAccessMask = VK_ACCESS_SHADER_WRITE_BIT;
        Readback.dstAccessMask = VK_ACCESS_HOST_READ_BIT;
        vkCmdPipelineBarrier(Commands,
                             VK_PIPELINE_STAGE_COMPUTE_SHADER_BIT,
                             VK_PIPELINE_STAGE_HOST_BIT,
                             0,
                             1,
                             &Readback,
                             0,
                             nullptr,
                             0,
                             nullptr);
        Confirm(vkEndCommandBuffer(Commands), "vkEndCommandBuffer");
        VkSubmitInfo Submission{VK_STRUCTURE_TYPE_SUBMIT_INFO};
        Submission.commandBufferCount = 1;
        Submission.pCommandBuffers    = &Commands;
        Confirm(vkQueueSubmit(Queue, 1, &Submission, Completion), "vkQueueSubmit");
        Confirm(vkWaitForFences(Device, 1, &Completion, VK_TRUE, 120'000'000'000ull), "vkWaitForFences (120 s)");
        Confirm(vkResetFences(Device, 1, &Completion), "vkResetFences");
        Confirm(vkResetCommandBuffer(Commands, 0), "vkResetCommandBuffer");
        return Milliseconds(Begin);
    }
};

//------------------------------------------------------------------------------------------------------------------------
//                                                   DEVICE / HOST PARITY ACCEPTANCE
//------------------------------------------------------------------------------------------------------------------------

DistanceFootprint ParametersFor(const RadianceScene& Scene, unsigned ProbeCount)
{
    DistanceFootprint Parameters;
    Parameters.LocalMinimum = {
        Scene.LocalDistance.Low.X, Scene.LocalDistance.Low.Y, Scene.LocalDistance.Low.Z, float(Scene.Boxes.size())};
    Parameters.LocalSpacing = {
        Scene.LocalDistance.Spacing.X, Scene.LocalDistance.Spacing.Y, Scene.LocalDistance.Spacing.Z, 0};
    Parameters.ExtentAndCount = {80, 40, 32, ProbeCount};
    Parameters.PoseCosineSine = {Scene.Pose.Cosine, Scene.Pose.Sine, float(Scene.Vehicle.Surfaces.size()), 0};
    Parameters.Translation    = {Scene.Pose.Translation.X, Scene.Pose.Translation.Y, Scene.Pose.Translation.Z, 0};
    auto Origin               = [](const auto& Coordinates)
    { return std::array<int, 4>{Coordinates[0], Coordinates[1], Coordinates[2], 0}; };
    Parameters.ClipOrigin0 = Origin(Scene.Clipmap.Levels[0].Origin);
    Parameters.ClipOrigin1 = Origin(Scene.Clipmap.Levels[1].Origin);
    Parameters.ClipOrigin2 = Origin(Scene.Clipmap.Levels[2].Origin);
    return Parameters;
}

Vector PointRadianceAtFace(const RadianceScene& Scene, unsigned Face, bool ReverseSide)
{
    auto Surface = Scene.FacetCentre(Scene.Vehicle.Surfaces[Face], true, Face);
    if (ReverseSide)
    {
        Surface.Normal          = -Surface.Normal;
        Surface.GeometricNormal = -Surface.GeometricNormal;
    }
    return Scene.Direct(Surface, Point, VisibilityEvaluation::Exact, 1);
}

Vector PointRadianceAlongRay(const RadianceScene& Scene, Vector Origin, Vector Direction)
{
    const Vector LocalDirection = Scene.Pose.Unrotate(Direction);
    const auto   Hit            = Scene.Vehicle.Trace(Scene.Pose.ToLocal(Origin), LocalDirection, 20);
    if (!Hit.Confirmed()) return {};
    const auto& Triangle = Scene.Vehicle.Surfaces[Hit.FacetIndex];
    const bool  ReverseSide =
        Dot(Cross(Triangle.Corner[1] - Triangle.Corner[0], Triangle.Corner[2] - Triangle.Corner[0]), LocalDirection) >
        0;
    return PointRadianceAtFace(Scene, Hit.FacetIndex, ReverseSide);
}

void ValidateDevice(const std::string& ArchiveRoot, const std::string& Shaders, const std::string& Destination)
{
    RadianceScene Scene;
    Scene.Construct(ArchiveRoot);
    Scene.LocalDistance.Bake(Scene.Vehicle);
    Scene.Clipmap.Relocate({}, {0, 0, 1});
    VulkanCompute Device;
    Device.Initialize();
    constexpr unsigned ProbeCount = 4099, Guard = 64, CellCount = 3 * 48 * 48 * 48;
    const unsigned     FacetCount = unsigned(Scene.Vehicle.Surfaces.size());
    const auto&        Packed     = Scene.Vehicle.Packed;
    Device.Allocate(0, Packed.Enclosures.size() * sizeof(Packed.Enclosures[0]));
    Device.Allocate(1, Packed.Corners.size() * sizeof(FacetFootprint));
    Device.Allocate(2, (Scene.LocalDistance.Samples.size() + Guard) * sizeof(float));
    Device.Allocate(3, (CellCount + Guard) * sizeof(ClipTexel));
    Device.Allocate(4, (ProbeCount + Guard) * sizeof(ProbeFootprint));
    Device.Allocate(5, (ProbeCount + Guard) * sizeof(std::array<float, 4>));
    Device.Allocate(6, Scene.Boxes.size() * sizeof(BoxFootprint));
    Device.Allocate(7, (FacetCount * 2 + Guard) * sizeof(std::array<float, 4>));
    std::memcpy(Device.Buffers[0].Mapped, Packed.Enclosures.data(), Device.Buffers[0].Bytes);
    std::vector<FacetFootprint> Corners(Packed.Corners.size());
    for (unsigned Slot = 0; Slot < Corners.size(); ++Slot)
    {
        const auto& PackedTriangle = Packed.Corners[Slot];
        Corners[Slot].A            = {PackedTriangle.A[0], PackedTriangle.A[1], PackedTriangle.A[2]};
        Corners[Slot].Material     = Scene.Vehicle.Surfaces[Packed.OriginalFacets[Slot]].Material;
        Corners[Slot].B            = PackedTriangle.B;
        Corners[Slot].C            = PackedTriangle.C;
    }
    std::memcpy(Device.Buffers[1].Mapped, Corners.data(), Device.Buffers[1].Bytes);
    auto* Boxes = static_cast<BoxFootprint*>(Device.Buffers[6].Mapped);
    for (unsigned Index = 0; Index < Scene.Boxes.size(); ++Index)
    {
        const auto& Box = Scene.Boxes[Index];
        Boxes[Index]    = {{Box.Centre.X, Box.Centre.Y, Box.Centre.Z, 0},
                           {Box.HalfExtent.X, Box.HalfExtent.Y, Box.HalfExtent.Z, 0}};
    }
    auto* Probes = static_cast<ProbeFootprint*>(Device.Buffers[4].Mapped);
    for (unsigned Index = 0; Index < ProbeCount; ++Index)
    {
        const auto   A = Quadrature(Index, 0), B = Quadrature(Index, 1), C = Quadrature(Index, 2);
        const Vector Origin{A[0] * 12 - 6, A[1] * 9 - 4.5f, .001f + B[0] * 3};
        const Vector Direction = Normalize(Vector{B[1] * 6 - 3, C[0] * 2 - 1, C[1] * 1.5f + .1f} - Origin);
        const Vector P{B[0] * 12 - 6, B[1] * 9 - 4.5f, C[0] * 3};
        Probes[Index] = {
            {Origin.X, Origin.Y, Origin.Z, 20}, {Direction.X, Direction.Y, Direction.Z, 0}, {P.X, P.Y, P.Z, 0}};
    }
    for (unsigned BufferIndex : {2u, 3u, 5u, 7u})
    {
        auto* Scalars = static_cast<float*>(Device.Buffers[BufferIndex].Mapped);
        std::fill(Scalars, Scalars + Device.Buffers[BufferIndex].Bytes / sizeof(float), -99123.f);
    }
    Device.ConstructPipelines(Shaders);
    const auto         Parameters = ParametersFor(Scene, ProbeCount);
    const double       ColdMs     = Device.Execute(Parameters,
                                                   {{"BakeLocalDistance", 80 * 40 * 32 + 1},
                                                    {"FillClipmap", CellCount + 1},
                                                    {"RelightVehicleCache", FacetCount * 2},
                                                    {"EvaluateDistanceProbes", ProbeCount}});
    const auto*        Local      = static_cast<const float*>(Device.Buffers[2].Mapped);
    const auto*        Clip       = static_cast<const ClipTexel*>(Device.Buffers[3].Mapped);
    const auto*        Output     = static_cast<const std::array<float, 4>*>(Device.Buffers[5].Mapped);
    const auto*        Cache      = static_cast<const std::array<float, 4>*>(Device.Buffers[7].Mapped);
    double             LocalError = 0, ClipError = 0, ProbeError = 0, CacheError = 0;
    unsigned           Mismatches = 0, LitCacheSites = 0, PositiveGather = 0;
    std::vector<float> OriginalBake(Local, Local + Scene.LocalDistance.Samples.size());
    for (unsigned Index = 0; Index < Scene.LocalDistance.Samples.size(); ++Index)
    {
        Require(std::isfinite(Local[Index]), "Nonfinite device distance bake");
        LocalError = std::max(LocalError, std::abs(double(Local[Index]) - Scene.LocalDistance.Samples[Index]));
    }
    Require(LocalError < 5e-5, "Device local bake differs from native float reference");
    for (unsigned Index = 0; Index < CellCount; ++Index)
    {
        const auto& Expected = Scene.Clipmap.Levels[Index / (48 * 48 * 48)].Texels[Index % (48 * 48 * 48)];
        Require(std::isfinite(Clip[Index].Raw) && std::isfinite(Clip[Index].Lower) &&
                    std::isfinite(Clip[Index].SignedStatic) && std::isfinite(Clip[Index].Occupancy),
                "Nonfinite clipmap texel");
        ClipError = std::max({ClipError,
                              std::abs(double(Clip[Index].Raw) - Expected.Raw),
                              std::abs(double(Clip[Index].Lower) - Expected.Lower),
                              std::abs(double(Clip[Index].SignedStatic) - Expected.SignedStatic),
                              std::abs(double(Clip[Index].Occupancy) - Expected.Occupancy)});
    }
    Require(ClipError < 5e-5, "Device clipmap differs from native float reference");
    for (unsigned Index = 0; Index < ProbeCount; ++Index)
    {
        const auto&  Probe = Probes[Index];
        const Vector Origin{Probe.OriginLimit[0], Probe.OriginLimit[1], Probe.OriginLimit[2]};
        const Vector Direction{Probe.Direction[0], Probe.Direction[1], Probe.Direction[2]};
        const Vector P{Probe.Position[0], Probe.Position[1], Probe.Position[2]};
        const bool   Expected = Scene.CarOccluded(Origin, Direction, 20, VisibilityEvaluation::Exact);
        for (float Channel : Output[Index])
            Require(std::isfinite(Channel), "Nonfinite GPU distance probe");
        Mismatches += bool(Output[Index][0]) != Expected;
        ProbeError = std::max({ProbeError,
                               std::abs(double(Output[Index][1]) - Scene.LocalDistance.Sample(P).Raw),
                               std::abs(double(Output[Index][2]) - Scene.Clipmap.Sample(P).Lower)});
    }
    Require(Mismatches == 0 && ProbeError < 1e-4, "Device hybrid probe mismatch");
    for (unsigned Slot = 0; Slot < FacetCount * 2; ++Slot)
    {
        const unsigned Face     = Packed.OriginalFacets[Slot % FacetCount];
        const auto     Expected = PointRadianceAtFace(Scene, Face, Slot >= FacetCount);
        for (unsigned Channel = 0; Channel < 3; ++Channel)
        {
            Require(std::isfinite(Cache[Slot][Channel]), "Nonfinite GPU surface-cache radiance");
            CacheError = std::max(CacheError, std::abs(double(Cache[Slot][Channel]) - Expected[Channel]));
        }
        LitCacheSites += Cache[Slot][0] + Cache[Slot][1] + Cache[Slot][2] > 0;
    }
    Require(CacheError < 1e-4 && LitCacheSites > 100, "GPU surface cache does not match point-source radiometry");
    std::filesystem::create_directories(Destination);
    std::vector<unsigned> PackedSlot(FacetCount);
    for (unsigned Slot = 0; Slot < FacetCount; ++Slot)
        PackedSlot[Packed.OriginalFacets[Slot]] = Slot;
    Image CacheInspection(CaptureWidth * CaptureHeight);
    for (unsigned Y = 0; Y < CaptureHeight; ++Y)
        for (unsigned X = 0; X < CaptureWidth; ++X)
        {
            const auto Surface = Scene.Trace({8.3f, -9.5f, 5.8f}, CameraDirection(X + .5f, Y + .5f));
            if (!Surface.Confirmed || !Surface.Vehicle) continue;
            const auto Radiance = Cache[PackedSlot[Surface.FacetIndex] + (Surface.RadiantFacing ? 0 : FacetCount)];
            CacheInspection[Y * CaptureWidth + X] = {Radiance[0], Radiance[1], Radiance[2]};
        }
    EncodePfm(Destination + "/GpuPointSurfaceCache.pfm", CacheInspection);
    for (unsigned Tier = 0; Tier < 3; ++Tier)
    {
        Image       Slice(CaptureWidth * CaptureHeight);
        const auto& Grid = Scene.Clipmap.Levels[Tier];
        for (unsigned Y = 0; Y < CaptureHeight; ++Y)
            for (unsigned X = 0; X < CaptureWidth; ++X)
            {
                const Vector P{(float(X) / CaptureWidth - .5f) * 13, (.5f - float(Y) / CaptureHeight) * 7.3125f, .55f};
                const int    WX = int(std::floor(P.X / Grid.Spacing)), WY = int(std::floor(P.Y / Grid.Spacing)),
                          WZ = int(std::floor(P.Z / Grid.Spacing));
                if (!DistanceClipmap::Contains(Grid.Origin, WX, WY, WZ)) continue;
                const auto Texel  = Clip[Tier * 48 * 48 * 48 + DistanceClipmap::Address(WX, WY, WZ)];
                Vector     Colour = Vector{.08f, .4f, .65f} * (.12f + .88f * std::clamp(Texel.Raw, 0.f, 1.f));
                if (Texel.Raw < .06f) Colour = {1, .6f, .1f};
                if (Texel.SignedStatic < 0) Colour = {.7f, .04f, .03f};
                Slice[Y * CaptureWidth + X] = Colour;
            }
        EncodePfm(Destination + "/GpuDistanceLevel" + std::to_string(Tier) + ".pfm", Slice);
    }
    Device.Execute(Parameters, {{"GatherVehicleCache", ProbeCount}});
    for (unsigned Index = 0; Index < ProbeCount; ++Index)
    {
        const auto& Probe    = Probes[Index];
        const auto  Expected = PointRadianceAlongRay(Scene,
                                                     {Probe.OriginLimit[0], Probe.OriginLimit[1], Probe.OriginLimit[2]},
                                                     {Probe.Direction[0], Probe.Direction[1], Probe.Direction[2]});
        for (unsigned Channel = 0; Channel < 3; ++Channel)
            Require(std::abs(Output[Index][Channel] - Expected[Channel]) < 1e-4,
                    "GPU gather does not consume the matching resident cache");
        PositiveGather += Output[Index][0] + Output[Index][1] + Output[Index][2] > 0;
    }
    Require(PositiveGather > 100, "GPU resident cache gather has no positive observations");
    Device.Execute(Parameters, {{"ClearVehicleCache", FacetCount * 2}, {"GatherVehicleCache", ProbeCount}});
    for (unsigned Index = 0; Index < ProbeCount; ++Index)
        Require(Output[Index][0] == 0 && Output[Index][1] == 0 && Output[Index][2] == 0,
                "Cleared GPU cache still contributes radiance");
    unsigned MovingMismatches = 0;
    double   MovementMs       = 0;
    for (unsigned PoseIndex = 1; PoseIndex <= 3; ++PoseIndex)
    {
        Scene.Pose = EvaluateMotion(PoseIndex * .61);
        Scene.Clipmap.Relocate(Scene.Pose, {-.17f * PoseIndex, .21f * PoseIndex, 1});
        MovementMs += Device.Execute(ParametersFor(Scene, ProbeCount),
                                     {{"FillClipmap", CellCount + 1}, {"EvaluateDistanceProbes", ProbeCount}});
        for (unsigned Index = 0; Index < ProbeCount; ++Index)
        {
            const auto& Probe    = Probes[Index];
            const bool  Expected = Scene.CarOccluded({Probe.OriginLimit[0], Probe.OriginLimit[1], Probe.OriginLimit[2]},
                                                     {Probe.Direction[0], Probe.Direction[1], Probe.Direction[2]},
                                                    20,
                                                    VisibilityEvaluation::Exact);
            MovingMismatches += bool(Output[Index][0]) != Expected;
        }
        Device.Execute(ParametersFor(Scene, ProbeCount),
                       {{"RelightVehicleCache", FacetCount * 2}, {"GatherVehicleCache", ProbeCount}});
        for (unsigned Slot = 0; Slot < FacetCount * 2; ++Slot)
        {
            const unsigned Face     = Packed.OriginalFacets[Slot % FacetCount];
            const auto     Expected = PointRadianceAtFace(Scene, Face, Slot >= FacetCount);
            for (unsigned Channel = 0; Channel < 3; ++Channel)
            {
                Require(std::isfinite(Cache[Slot][Channel]), "Nonfinite moved GPU surface-cache radiance");
                CacheError = std::max(CacheError, std::abs(double(Cache[Slot][Channel]) - Expected[Channel]));
            }
        }
        Require(CacheError < 1e-4, "Moved GPU surface cache differs from fresh relighting");
        for (unsigned Index = 0; Index < ProbeCount; ++Index)
        {
            const auto& Probe = Probes[Index];
            const auto  Expected =
                PointRadianceAlongRay(Scene,
                                      {Probe.OriginLimit[0], Probe.OriginLimit[1], Probe.OriginLimit[2]},
                                      {Probe.Direction[0], Probe.Direction[1], Probe.Direction[2]});
            for (unsigned Channel = 0; Channel < 3; ++Channel)
                Require(std::abs(Output[Index][Channel] - Expected[Channel]) < 1e-4,
                        "Moved GPU cache gather differs from fresh native radiometry");
        }
    }
    Require(MovingMismatches == 0, "Moved GPU hybrid visibility differs from exact local-space triangles");
    Require(std::memcmp(OriginalBake.data(), Local, OriginalBake.size() * sizeof(float)) == 0,
            "Rigid movement modified the baked local distance volume");
    for (unsigned Index = 0; Index < Guard; ++Index)
    {
        Require(Local[80 * 40 * 32 + Index] == -99123.f, "Local bake tail overwrite");
        const auto& ClipTail = Clip[CellCount + Index];
        Require(ClipTail.Raw == -99123.f && ClipTail.Lower == -99123.f && ClipTail.SignedStatic == -99123.f &&
                    ClipTail.Occupancy == -99123.f,
                "Clipmap tail overwrite");
        for (unsigned Channel = 0; Channel < 4; ++Channel)
        {
            Require(Output[ProbeCount + Index][Channel] == -99123.f, "Padded probe lane overwrite");
            Require(Cache[FacetCount * 2 + Index][Channel] == -99123.f, "Cache tail overwrite");
        }
    }
    std::filesystem::create_directories(Destination);
    std::ofstream Report(Destination + "/Vulkan.json");
    Report << std::setprecision(12) << "{\n  \"device\": \"" << Device.Properties.deviceName
           << "\",\n  \"device_type\": " << Device.Properties.deviceType << ",\n  \"physical_gpu_tested\": "
           << (Device.Properties.deviceType == VK_PHYSICAL_DEVICE_TYPE_CPU ? "false" : "true")
           << ",\n  \"local_samples\": 102400,\n  \"clipmap_samples\": " << CellCount
           << ",\n  \"probe_count_per_pose\": " << ProbeCount
           << ",\n  \"poses\": 4,\n  \"local_max_error_m\": " << LocalError
           << ",\n  \"clip_max_error_m\": " << ClipError << ",\n  \"probe_max_error_m\": " << ProbeError
           << ",\n  \"static_visibility_mismatches\": " << Mismatches
           << ",\n  \"moving_visibility_mismatches\": " << MovingMismatches
           << ",\n  \"cache_max_radiance_error\": " << CacheError << ",\n  \"lit_gpu_cache_sites\": " << LitCacheSites
           << ",\n  \"positive_gpu_cache_gathers\": " << PositiveGather
           << ",\n  \"cache_clear_ablation_exact_black\": true,\n  \"bake_unchanged_after_motion\": true,\n  "
              "\"padded_lanes_unchanged\": true,"
           << "\n  \"cold_submit_fence_readback_ms\": " << ColdMs
           << ",\n  \"three_moving_submit_fence_readback_ms\": " << MovementMs
           << ",\n  \"gpu_clipmap_dirty_region_implemented\": false,\n  \"full_image_rendered_on_gpu\": false,\n  "
              "\"gpu_cache_light_scope\": \"one point source, vehicle facets only\","
           << "\n  \"memory_policy\": \"coherent mapped validation buffers, not an optimized discrete-GPU allocation "
              "strategy\"\n}\n";
    std::cout << "VULKAN ACCEPTED local_error=" << LocalError << " clip_error=" << ClipError
              << " cache_error=" << CacheError << " positive_gathers=" << PositiveGather
              << " visibility_mismatches=" << Mismatches + MovingMismatches << std::endl;
}
} // namespace

int main(int ArgumentCount, char** Arguments)
{
    try
    {
        Require(ArgumentCount == 4,
                "Usage: VulkanDistanceEvaluation <archive directory> <SPIR-V directory> <output directory>");
        ValidateDevice(Arguments[1], Arguments[2], Arguments[3]);
        return 0;
    }
    catch (const std::exception& Error)
    {
        std::cerr << "FAILED: " << Error.what() << std::endl;
        return 1;
    }
}
