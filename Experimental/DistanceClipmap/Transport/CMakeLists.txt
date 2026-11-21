# ============================================================================================================================================
#                                                           CMAKELISTS.TXT
# ============================================================================================================================================
# 🧩 Independent CPU and optional Slang/Vulkan transport validation; production/editor targets remain unchanged.

cmake_minimum_required(VERSION 3.20)
project(FrontierDiffuseTransportExperiment LANGUAGES CXX)

# Independent continuation: no production/editor target or earlier evidence target is modified.
get_filename_component(FrontierDirectory "${CMAKE_CURRENT_SOURCE_DIR}/../../.." ABSOLUTE)
find_package(Threads REQUIRED)
option(FRONTIER_TRANSPORT_VULKAN "Build Slang/Vulkan diffuse-transport validation" OFF)

# ------------------------------------------------------------------------------------------------------------------------
#                                                   CPU TRANSPORT VALIDATION
# ------------------------------------------------------------------------------------------------------------------------

add_executable(TransportValidation "${FrontierDirectory}/Exhibits/DistanceClipmap/Code/TransportValidation.cpp")
target_compile_features(TransportValidation PRIVATE cxx_std_20)
target_include_directories(TransportValidation PRIVATE "${FrontierDirectory}" "${FrontierDirectory}/Frontier")
target_link_libraries(TransportValidation PRIVATE Threads::Threads)
if(MSVC)
    target_compile_options(TransportValidation PRIVATE /W4 /utf-8 /fp:strict)
else()
    target_compile_options(TransportValidation PRIVATE -Wall -Wextra -Wpedantic -Werror -fno-fast-math -ffp-contract=off)
endif()
include(CTest)
set(VehicleArchiveDirectory "${FrontierDirectory}/Experimental/SlateReference/B/Exhibits/IlluminationHost/Archive")
add_test(NAME DiffuseTransportNumeric COMMAND TransportValidation "${VehicleArchiveDirectory}"
    "${CMAKE_CURRENT_BINARY_DIR}/Numeric" validate)

# ------------------------------------------------------------------------------------------------------------------------
#                                                 OPTIONAL GPU TRANSPORT VALIDATION
# ------------------------------------------------------------------------------------------------------------------------

if(FRONTIER_TRANSPORT_VULKAN)
    find_package(Vulkan REQUIRED)
    find_program(FRONTIER_TRANSPORT_SLANG slangc REQUIRED)
    set(FRONTIER_TRANSPORT_DRIVER "" CACHE FILEPATH "Explicit Vulkan driver library used by the validation device")
    add_executable(TransportVulkan "${FrontierDirectory}/Exhibits/DistanceClipmap/Code/TransportVulkan.cpp")
    target_compile_features(TransportVulkan PRIVATE cxx_std_20)
    target_include_directories(TransportVulkan PRIVATE "${FrontierDirectory}" "${FrontierDirectory}/Frontier")
    target_link_libraries(TransportVulkan PRIVATE Vulkan::Vulkan Threads::Threads ${CMAKE_DL_LIBS})
    if(MSVC)
        target_compile_options(TransportVulkan PRIVATE /W4 /utf-8 /fp:strict)
    else()
        target_compile_options(TransportVulkan PRIVATE -Wall -Wextra -Wpedantic -Werror -Wno-missing-field-initializers
            -fno-fast-math -ffp-contract=off)
    endif()
    set(ShaderOutputs)
    foreach(Entry InjectDirectionalRadiance ReduceDirectionalMip GatherConeImage BounceConeSites
                  ConvolveProbeIrradiance ConvolveProbeMoments GatherProbeImage BounceProbeRays)
        if(Entry MATCHES "^(Convolve|GatherProbe|BounceProbe)")
            set(Source ProbeTransport.slang)
        else()
            set(Source ConeTransport.slang)
        endif()
        set(Output "${CMAKE_CURRENT_BINARY_DIR}/Shaders/${Entry}.spv")
        add_custom_command(OUTPUT "${Output}" "${Output}.json"
            COMMAND "${CMAKE_COMMAND}" -E make_directory "${CMAKE_CURRENT_BINARY_DIR}/Shaders"
            COMMAND "${FRONTIER_TRANSPORT_SLANG}" "${CMAKE_CURRENT_SOURCE_DIR}/${Source}" -entry "${Entry}"
                -target spirv -profile glsl_450 -fp-mode precise -O0 -o "${Output}" -reflection-json "${Output}.json"
            DEPENDS "${Source}" VERBATIM)
        list(APPEND ShaderOutputs "${Output}" "${Output}.json")
    endforeach()
    add_custom_target(DiffuseTransportShaders ALL DEPENDS ${ShaderOutputs})
    add_dependencies(TransportVulkan DiffuseTransportShaders)
    if(FRONTIER_TRANSPORT_DRIVER)
        add_test(NAME DiffuseTransportVulkan COMMAND TransportVulkan "${VehicleArchiveDirectory}"
            "${CMAKE_CURRENT_BINARY_DIR}/Shaders" "${CMAKE_CURRENT_BINARY_DIR}/Vulkan" "${FRONTIER_TRANSPORT_DRIVER}" validate)
    endif()
endif()
