/*============================================================================================================================================
                                                          TRANSPORTCOMPUTE.H
============================================================================================================================================*/
// 🧩 Guarded Vulkan storage and explicit host/compute/readback dependencies using the existing device lifetime.

#pragma once
// 📝 The reused exhibit header also defines three raster-only file functions;
// this compute host does not call them.
#if defined(__GNUC__)
#pragma GCC diagnostic push
#pragma GCC diagnostic ignored "-Wunused-function"
#endif
#include "Exhibits/Renderer/Code/VulkanReadback.h"
#if defined(__GNUC__)
#pragma GCC diagnostic pop
#endif
#include "Experimental/DistanceClipmap/Transport/TransportCapture.h"
#include <map>
#include <set>

namespace Frontier::DistanceClipmapExperiment
{
namespace
{

//------------------------------------------------------------------------------------------------------------------------
//                                                   GUARDED COMPUTE RESIDENCE
//------------------------------------------------------------------------------------------------------------------------

struct alignas(16) TransportFootprint
{
    std::array<unsigned, 4> Counts{}, Locations{};
    std::array<int, 4>      ClipOrigin0{}, ClipOrigin1{}, ClipOrigin2{};
    std::array<float, 4>    Constraints{};
    std::array<unsigned, 4> Range{};
    std::array<float, 4>    Reserved{};
};

static_assert(sizeof(TransportFootprint) == 128 && offsetof(TransportFootprint, Locations) == 16 &&
              offsetof(TransportFootprint, ClipOrigin0) == 32 && offsetof(TransportFootprint, Constraints) == 80 &&
              offsetof(TransportFootprint, Range) == 96 && offsetof(TransportFootprint, Reserved) == 112);

struct ComputeRegion
{
    VkBuffer       Storage    = VK_NULL_HANDLE;
    VkDeviceMemory Allocation = VK_NULL_HANDLE;
    void*          Mapped     = nullptr;
    std::size_t    Bytes      = 0;
};

class TransportCompute
{
public:
    RasterValidationDevice&              Residence;
    std::array<ComputeRegion, 8>         Regions{};
    VkDescriptorSetLayout                DescriptorLayout = VK_NULL_HANDLE;
    VkDescriptorPool                     DescriptorPool   = VK_NULL_HANDLE;
    VkDescriptorSet                      Descriptors      = VK_NULL_HANDLE;
    VkPipelineLayout                     PipelineLayout   = VK_NULL_HANDLE;
    std::map<std::string, VkPipeline>    Pipelines;
    std::map<std::string, std::uint64_t> ShaderDigests;
    std::set<std::string>                ExecutedEntries;
    static constexpr std::size_t         GuardBytes   = 64;
    static constexpr unsigned char       GuardPattern = 0xa5;

    // 📝 Resolve commands through the explicitly loaded ICD device, never through the global loader's dispatch table.
    // clang-format off
#define TRANSPORT_DEVICE_FUNCTIONS(Function) \
    Function(AllocateDescriptorSets) \
    Function(AllocateMemory) \
    Function(BeginCommandBuffer) \
    Function(BindBufferMemory) \
    Function(CmdBindDescriptorSets) \
    Function(CmdBindPipeline) \
    Function(CmdDispatch) \
    Function(CmdPipelineBarrier) \
    Function(CmdPushConstants) \
    Function(CreateBuffer) \
    Function(CreateComputePipelines) \
    Function(CreateDescriptorPool) \
    Function(CreateDescriptorSetLayout) \
    Function(CreatePipelineLayout) \
    Function(CreateShaderModule) \
    Function(DestroyBuffer) \
    Function(DestroyDescriptorPool) \
    Function(DestroyDescriptorSetLayout) \
    Function(DestroyPipeline) \
    Function(DestroyPipelineLayout) \
    Function(DestroyShaderModule) \
    Function(DeviceWaitIdle) \
    Function(EndCommandBuffer) \
    Function(FreeMemory) \
    Function(GetBufferMemoryRequirements) \
    Function(MapMemory) \
    Function(QueueSubmit) \
    Function(ResetCommandPool) \
    Function(ResetFences) \
    Function(UnmapMemory) \
    Function(UpdateDescriptorSets) \
    Function(WaitForFences)
    // clang-format on
#define TRANSPORT_DEVICE_POINTER(Name) PFN_vk##Name Name = nullptr;
    TRANSPORT_DEVICE_FUNCTIONS(TRANSPORT_DEVICE_POINTER)
#undef TRANSPORT_DEVICE_POINTER

    explicit TransportCompute(RasterValidationDevice& Device) : Residence(Device)
    {
#define TRANSPORT_DEVICE_LOAD(Name)                                                                                    \
    Name = reinterpret_cast<PFN_vk##Name>(Residence.ResolveDevice(Residence.Device, "vk" #Name));                      \
    Require(Name != nullptr, "Missing device entry vk" #Name);
        TRANSPORT_DEVICE_FUNCTIONS(TRANSPORT_DEVICE_LOAD)
#undef TRANSPORT_DEVICE_LOAD
#undef TRANSPORT_DEVICE_FUNCTIONS
    }

    ~TransportCompute()
    {
        (void)DeviceWaitIdle(Residence.Device);
        for (const auto& Entry : Pipelines)
            DestroyPipeline(Residence.Device, Entry.second, nullptr);
        if (PipelineLayout) DestroyPipelineLayout(Residence.Device, PipelineLayout, nullptr);
        if (DescriptorPool) DestroyDescriptorPool(Residence.Device, DescriptorPool, nullptr);
        if (DescriptorLayout) DestroyDescriptorSetLayout(Residence.Device, DescriptorLayout, nullptr);
        for (auto& Region : Regions)
        {
            if (Region.Mapped) UnmapMemory(Residence.Device, Region.Allocation);
            if (Region.Storage) DestroyBuffer(Residence.Device, Region.Storage, nullptr);
            if (Region.Allocation) FreeMemory(Residence.Device, Region.Allocation, nullptr);
        }
    }

    void Construct(const std::array<std::size_t, 8>& Bytes,
                   const std::string&                Directory,
                   const std::vector<std::string>&   Entries)
    {
        Require(Residence.Properties.limits.maxPerStageDescriptorStorageBuffers >= 8 &&
                    Residence.Properties.limits.maxPushConstantsSize >= 128,
                "Eight SSBOs / 128-byte pushes required");
        for (unsigned Index = 0; Index < Regions.size(); ++Index)
        {
            auto& Region = Regions[Index];
            Region.Bytes = Bytes[Index];
            Require(Region.Bytes > 0 && Region.Bytes + GuardBytes <= Residence.Properties.limits.maxStorageBufferRange,
                    "Transport buffer exceeds Vulkan storage limit");
            VkBufferCreateInfo Creation{VK_STRUCTURE_TYPE_BUFFER_CREATE_INFO};
            Creation.size  = Region.Bytes + GuardBytes;
            Creation.usage = VK_BUFFER_USAGE_STORAGE_BUFFER_BIT;
            ConfirmVulkanResult(CreateBuffer(Residence.Device, &Creation, nullptr, &Region.Storage));
            VkMemoryRequirements Requirements{};
            GetBufferMemoryRequirements(Residence.Device, Region.Storage, &Requirements);
            unsigned Type = Residence.Memory.memoryTypeCount;
            for (unsigned Candidate = 0; Candidate < Residence.Memory.memoryTypeCount; ++Candidate)
                if ((Requirements.memoryTypeBits & (1u << Candidate)) &&
                    (Residence.Memory.memoryTypes[Candidate].propertyFlags &
                     (VK_MEMORY_PROPERTY_HOST_VISIBLE_BIT | VK_MEMORY_PROPERTY_HOST_COHERENT_BIT)) ==
                        (VK_MEMORY_PROPERTY_HOST_VISIBLE_BIT | VK_MEMORY_PROPERTY_HOST_COHERENT_BIT))
                {
                    Type = Candidate;
                    break;
                }
            Require(Type < Residence.Memory.memoryTypeCount,
                    "Coherent mapped memory unavailable; staging is not implemented");
            VkMemoryAllocateInfo Allocation{VK_STRUCTURE_TYPE_MEMORY_ALLOCATE_INFO};
            Allocation.allocationSize  = Requirements.size;
            Allocation.memoryTypeIndex = Type;
            ConfirmVulkanResult(AllocateMemory(Residence.Device, &Allocation, nullptr, &Region.Allocation));
            ConfirmVulkanResult(BindBufferMemory(Residence.Device, Region.Storage, Region.Allocation, 0));
            ConfirmVulkanResult(MapMemory(Residence.Device, Region.Allocation, 0, Creation.size, 0, &Region.Mapped));
            std::memset(Region.Mapped, 0, Region.Bytes);
            std::memset(static_cast<unsigned char*>(Region.Mapped) + Region.Bytes, GuardPattern, GuardBytes);
        }
        std::array<VkDescriptorSetLayoutBinding, 8> Slots{};
        for (unsigned Index = 0; Index < Slots.size(); ++Index)
            Slots[Index] = {Index, VK_DESCRIPTOR_TYPE_STORAGE_BUFFER, 1, VK_SHADER_STAGE_COMPUTE_BIT, nullptr};
        VkDescriptorSetLayoutCreateInfo Layout{VK_STRUCTURE_TYPE_DESCRIPTOR_SET_LAYOUT_CREATE_INFO};
        Layout.bindingCount = unsigned(Slots.size());
        Layout.pBindings    = Slots.data();
        ConfirmVulkanResult(CreateDescriptorSetLayout(Residence.Device, &Layout, nullptr, &DescriptorLayout));
        VkPushConstantRange        Push{VK_SHADER_STAGE_COMPUTE_BIT, 0, sizeof(TransportFootprint)};
        VkPipelineLayoutCreateInfo Pipeline{VK_STRUCTURE_TYPE_PIPELINE_LAYOUT_CREATE_INFO};
        Pipeline.setLayoutCount         = 1;
        Pipeline.pSetLayouts            = &DescriptorLayout;
        Pipeline.pushConstantRangeCount = 1;
        Pipeline.pPushConstantRanges    = &Push;
        ConfirmVulkanResult(CreatePipelineLayout(Residence.Device, &Pipeline, nullptr, &PipelineLayout));
        VkDescriptorPoolSize       Capacity{VK_DESCRIPTOR_TYPE_STORAGE_BUFFER, 8};
        VkDescriptorPoolCreateInfo Pool{VK_STRUCTURE_TYPE_DESCRIPTOR_POOL_CREATE_INFO};
        Pool.maxSets       = 1;
        Pool.poolSizeCount = 1;
        Pool.pPoolSizes    = &Capacity;
        ConfirmVulkanResult(CreateDescriptorPool(Residence.Device, &Pool, nullptr, &DescriptorPool));
        VkDescriptorSetAllocateInfo Selection{VK_STRUCTURE_TYPE_DESCRIPTOR_SET_ALLOCATE_INFO};
        Selection.descriptorPool     = DescriptorPool;
        Selection.descriptorSetCount = 1;
        Selection.pSetLayouts        = &DescriptorLayout;
        ConfirmVulkanResult(AllocateDescriptorSets(Residence.Device, &Selection, &Descriptors));
        std::array<VkDescriptorBufferInfo, 8> Spans{};
        std::array<VkWriteDescriptorSet, 8>   Writes{};
        for (unsigned Index = 0; Index < Slots.size(); ++Index)
        {
            Spans[Index]                  = {Regions[Index].Storage, 0, Regions[Index].Bytes + GuardBytes};
            Writes[Index]                 = {VK_STRUCTURE_TYPE_WRITE_DESCRIPTOR_SET};
            Writes[Index].dstSet          = Descriptors;
            Writes[Index].dstBinding      = Index;
            Writes[Index].descriptorCount = 1;
            Writes[Index].descriptorType  = VK_DESCRIPTOR_TYPE_STORAGE_BUFFER;
            Writes[Index].pBufferInfo     = &Spans[Index];
        }
        UpdateDescriptorSets(Residence.Device, unsigned(Writes.size()), Writes.data(), 0, nullptr);
        for (const auto& Entry : Entries)
        {
            std::ifstream Input(Directory + "/" + Entry + ".spv", std::ios::binary | std::ios::ate);
            Require(bool(Input), "Missing transport SPIR-V " + Entry);
            const auto Extent = Input.tellg();
            Require(Extent > 0 && Extent % 4 == 0, "Invalid transport SPIR-V extent");
            std::vector<std::uint32_t> Words(std::size_t(Extent) / 4);
            Input.seekg(0);
            Require(bool(Input.read(reinterpret_cast<char*>(Words.data()), Extent)), "Cannot read transport SPIR-V");
            std::uint64_t Digest = 14695981039346656037ull;
            for (std::size_t Byte = 0; Byte < Words.size() * 4; ++Byte)
            {
                Digest ^= reinterpret_cast<const unsigned char*>(Words.data())[Byte];
                Digest *= 1099511628211ull;
            }
            ShaderDigests[Entry] = Digest;
            VkShaderModuleCreateInfo Shader{VK_STRUCTURE_TYPE_SHADER_MODULE_CREATE_INFO};
            Shader.codeSize        = Words.size() * 4;
            Shader.pCode           = Words.data();
            VkShaderModule Program = VK_NULL_HANDLE;
            ConfirmVulkanResult(CreateShaderModule(Residence.Device, &Shader, nullptr, &Program));
            VkComputePipelineCreateInfo Compute{VK_STRUCTURE_TYPE_COMPUTE_PIPELINE_CREATE_INFO};
            Compute.layout        = PipelineLayout;
            Compute.stage         = {VK_STRUCTURE_TYPE_PIPELINE_SHADER_STAGE_CREATE_INFO};
            Compute.stage.stage   = VK_SHADER_STAGE_COMPUTE_BIT;
            Compute.stage.module  = Program;
            Compute.stage.pName   = "main";
            VkPipeline Executable = VK_NULL_HANDLE;
            const auto Result =
                CreateComputePipelines(Residence.Device, VK_NULL_HANDLE, 1, &Compute, nullptr, &Executable);
            DestroyShaderModule(Residence.Device, Program, nullptr);
            ConfirmVulkanResult(Result);
            Pipelines[Entry] = Executable;
        }
    }

    template <class Footprint>
    void Upload(unsigned Slot, const std::vector<Footprint>& Payload, std::size_t ByteOffset = 0)
    {
        Require(ByteOffset + Payload.size() * sizeof(Footprint) <= Regions[Slot].Bytes,
                "Transport upload exceeds allocation");
        std::memcpy(static_cast<unsigned char*>(Regions[Slot].Mapped) + ByteOffset, Payload.data(),
                    Payload.size() * sizeof(Footprint));
    }

    void Dispatch(const std::string& Entry, unsigned Count, const TransportFootprint& Parameters)
    {
        Require(Count > 0 && (Count + 63) / 64 <= Residence.Properties.limits.maxComputeWorkGroupCount[0],
                "Invalid dispatch range");
        ConfirmVulkanResult(ResetCommandPool(Residence.Device, Residence.Pool, 0));
        ConfirmVulkanResult(ResetFences(Residence.Device, 1, &Residence.Completion));
        VkCommandBufferBeginInfo Begin{VK_STRUCTURE_TYPE_COMMAND_BUFFER_BEGIN_INFO};
        Begin.flags = VK_COMMAND_BUFFER_USAGE_ONE_TIME_SUBMIT_BIT;
        ConfirmVulkanResult(BeginCommandBuffer(Residence.Commands, &Begin));
        VkMemoryBarrier Dependency{VK_STRUCTURE_TYPE_MEMORY_BARRIER};
        Dependency.srcAccessMask = VK_ACCESS_HOST_WRITE_BIT | VK_ACCESS_SHADER_WRITE_BIT;
        Dependency.dstAccessMask = VK_ACCESS_SHADER_READ_BIT | VK_ACCESS_SHADER_WRITE_BIT;
        CmdPipelineBarrier(Residence.Commands, VK_PIPELINE_STAGE_HOST_BIT | VK_PIPELINE_STAGE_COMPUTE_SHADER_BIT,
                           VK_PIPELINE_STAGE_COMPUTE_SHADER_BIT, 0, 1, &Dependency, 0, nullptr, 0, nullptr);
        CmdBindDescriptorSets(Residence.Commands, VK_PIPELINE_BIND_POINT_COMPUTE, PipelineLayout, 0, 1, &Descriptors, 0,
                              nullptr);
        CmdPushConstants(Residence.Commands, PipelineLayout, VK_SHADER_STAGE_COMPUTE_BIT, 0, sizeof(Parameters),
                         &Parameters);
        CmdBindPipeline(Residence.Commands, VK_PIPELINE_BIND_POINT_COMPUTE, Pipelines.at(Entry));
        CmdDispatch(Residence.Commands, (Count + 63) / 64, 1, 1);
        Dependency.srcAccessMask = VK_ACCESS_SHADER_WRITE_BIT;
        Dependency.dstAccessMask = VK_ACCESS_HOST_READ_BIT;
        CmdPipelineBarrier(Residence.Commands, VK_PIPELINE_STAGE_COMPUTE_SHADER_BIT, VK_PIPELINE_STAGE_HOST_BIT, 0, 1,
                           &Dependency, 0, nullptr, 0, nullptr);
        ConfirmVulkanResult(EndCommandBuffer(Residence.Commands));
        VkSubmitInfo Submission{VK_STRUCTURE_TYPE_SUBMIT_INFO};
        Submission.commandBufferCount = 1;
        Submission.pCommandBuffers    = &Residence.Commands;
        ConfirmVulkanResult(QueueSubmit(Residence.Queue, 1, &Submission, Residence.Completion));
        ConfirmVulkanResult(WaitForFences(Residence.Device, 1, &Residence.Completion, VK_TRUE, UINT64_MAX));
        ExecutedEntries.insert(Entry);
    }

    void VerifyGuards() const
    {
        for (const auto& Region : Regions)
            for (unsigned Byte = 0; Byte < GuardBytes; ++Byte)
                Require(static_cast<const unsigned char*>(Region.Mapped)[Region.Bytes + Byte] == GuardPattern,
                        "Shader modified a guarded storage tail");
    }
};

} // namespace
} // namespace Frontier::DistanceClipmapExperiment
