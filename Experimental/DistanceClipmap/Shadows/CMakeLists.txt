# ============================================================================================================================================
#                                                           CMAKELISTS.TXT
# ============================================================================================================================================
# 🧩 Isolated six-path SDF rendering and optional Slang/Vulkan validation; no production/editor targets are changed.

cmake_minimum_required(VERSION 3.20)
project(FrontierSdfShadowExperiment LANGUAGES CXX)

get_filename_component(FrontierDirectory "${CMAKE_CURRENT_SOURCE_DIR}/../../.." ABSOLUTE)
find_package(Threads REQUIRED)
add_executable(SdfShadowValidation "${FrontierDirectory}/Exhibits/DistanceClipmap/Code/SdfShadowValidation.cpp")
target_compile_features(SdfShadowValidation PRIVATE cxx_std_20)
target_include_directories(SdfShadowValidation PRIVATE "${FrontierDirectory}" "${FrontierDirectory}/Frontier")
target_link_libraries(SdfShadowValidation PRIVATE Threads::Threads)
if(MSVC)
    target_compile_options(SdfShadowValidation PRIVATE /W4 /utf-8 /fp:strict)
else()
    target_compile_options(SdfShadowValidation PRIVATE -Wall -Wextra -Wpedantic -Werror -fno-fast-math -ffp-contract=off)
endif()
include(CTest)
add_test(NAME SixSdfShadowNumeric COMMAND SdfShadowValidation "${CMAKE_CURRENT_BINARY_DIR}/Numeric" validate)

add_executable(SphereVehicleValidation "${FrontierDirectory}/Exhibits/DistanceClipmap/Code/SphereVehicleValidation.cpp")
target_compile_features(SphereVehicleValidation PRIVATE cxx_std_20)
target_include_directories(SphereVehicleValidation PRIVATE "${FrontierDirectory}" "${FrontierDirectory}/Frontier")
target_link_libraries(SphereVehicleValidation PRIVATE Threads::Threads)
if(MSVC)
    target_compile_options(SphereVehicleValidation PRIVATE /W4 /utf-8 /fp:strict)
else()
    target_compile_options(SphereVehicleValidation PRIVATE -Wall -Wextra -Wpedantic -Werror -fno-fast-math -ffp-contract=off)
endif()

# ------------------------------------------------------------------------------------------------------------------------
#                                                   OPTIONAL SLANG / VULKAN EXECUTION
# ------------------------------------------------------------------------------------------------------------------------

option(FRONTIER_SHADOW_VULKAN "Build six-path Slang/Vulkan validation" OFF)
if(FRONTIER_SHADOW_VULKAN)
    find_package(Vulkan REQUIRED)
    find_program(FRONTIER_SHADOW_SLANG slangc REQUIRED)
    set(FRONTIER_SHADOW_DRIVER "" CACHE FILEPATH "Explicit Vulkan driver library used by the validation device")
    add_executable(SdfShadowVulkan "${FrontierDirectory}/Exhibits/DistanceClipmap/Code/SdfShadowVulkan.cpp")
    target_compile_features(SdfShadowVulkan PRIVATE cxx_std_20)
    target_include_directories(SdfShadowVulkan PRIVATE "${FrontierDirectory}" "${FrontierDirectory}/Frontier")
    target_link_libraries(SdfShadowVulkan PRIVATE Vulkan::Vulkan Threads::Threads ${CMAKE_DL_LIBS})
    if(MSVC)
        target_compile_options(SdfShadowVulkan PRIVATE /W4 /utf-8 /fp:strict)
    else()
        target_compile_options(SdfShadowVulkan PRIVATE -Wall -Wextra -Wpedantic -Werror -Wno-missing-field-initializers
            -fno-fast-math -ffp-contract=off)
    endif()
    set(ShaderOutputs)
    foreach(Entry PointSdfShadow AnalyticSdfPenumbra VoxelSdfPenumbra VoxelSdfConeGi
                  HybridSdfSphereCap ReferenceSdfPaths InspectSdfGeometry InspectSdfPath InspectSdfBounce)
        set(Output "${CMAKE_CURRENT_BINARY_DIR}/Shaders/${Entry}.spv")
        add_custom_command(OUTPUT "${Output}" "${Output}.json"
            COMMAND "${CMAKE_COMMAND}" -E make_directory "${CMAKE_CURRENT_BINARY_DIR}/Shaders"
            COMMAND "${FRONTIER_SHADOW_SLANG}" "${CMAKE_CURRENT_SOURCE_DIR}/SdfShadows.slang" -entry "${Entry}"
                -target spirv -profile glsl_450 -fp-mode precise -O0 -o "${Output}" -reflection-json "${Output}.json"
            DEPENDS "SdfShadows.slang" VERBATIM)
        list(APPEND ShaderOutputs "${Output}" "${Output}.json")
    endforeach()
    add_custom_target(SdfShadowShaders ALL DEPENDS ${ShaderOutputs})
    add_dependencies(SdfShadowVulkan SdfShadowShaders)
    if(FRONTIER_SHADOW_DRIVER)
        add_test(NAME SixSdfShadowVulkan COMMAND SdfShadowVulkan "${CMAKE_CURRENT_BINARY_DIR}/Shaders"
            "${CMAKE_CURRENT_BINARY_DIR}/Vulkan" "${FRONTIER_SHADOW_DRIVER}" validate)
    endif()
endif()
