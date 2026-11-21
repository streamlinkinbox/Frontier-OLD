# ============================================================================================================================================
#                                                           CMAKELISTS.TXT
# ============================================================================================================================================
# 🧩 Isolated distance-clipmap validation targets; none is linked into the editor or production renderer.

cmake_minimum_required(VERSION 3.20)
project(FrontierDistanceClipmapExperiment LANGUAGES CXX)

get_filename_component(FrontierDirectory "${CMAKE_CURRENT_SOURCE_DIR}/../.." ABSOLUTE)
find_package(Threads REQUIRED)
option(FRONTIER_DISTANCE_VULKAN "Build native Vulkan distance/cache validation" OFF)

add_executable(RadianceEvaluation RadianceEvaluation.cpp)
target_compile_features(RadianceEvaluation PRIVATE cxx_std_20)
target_include_directories(RadianceEvaluation PRIVATE "${FrontierDirectory}" "${FrontierDirectory}/Frontier")
target_link_libraries(RadianceEvaluation PRIVATE Threads::Threads)
if(MSVC)
    target_compile_options(RadianceEvaluation PRIVATE /W4 /utf-8 /fp:strict)
else()
    target_compile_options(RadianceEvaluation PRIVATE -Wall -Wextra -Wpedantic -Werror -fno-fast-math -ffp-contract=off)
endif()

include(CTest)
set(VehicleArchiveDirectory "${FrontierDirectory}/Experimental/SlateReference/B/Exhibits/IlluminationHost/Archive")
add_test(NAME DistanceClipmapNumeric COMMAND RadianceEvaluation "${VehicleArchiveDirectory}" "${CMAKE_CURRENT_BINARY_DIR}/Numeric" 32 0 numeric)
add_executable(CacheSideValidation "${FrontierDirectory}/Exhibits/DistanceClipmap/Code/CacheSideValidation.cpp")
target_compile_features(CacheSideValidation PRIVATE cxx_std_20)
target_include_directories(CacheSideValidation PRIVATE "${FrontierDirectory}" "${FrontierDirectory}/Frontier")
target_link_libraries(CacheSideValidation PRIVATE Threads::Threads)
if(MSVC)
    target_compile_options(CacheSideValidation PRIVATE /W4 /utf-8 /fp:strict)
else()
    target_compile_options(CacheSideValidation PRIVATE -Wall -Wextra -Wpedantic -Werror -fno-fast-math -ffp-contract=off)
endif()
add_test(NAME DistanceClipmapCacheSides COMMAND CacheSideValidation "${VehicleArchiveDirectory}")

add_executable(ConsumptionValidation "${FrontierDirectory}/Exhibits/DistanceClipmap/Code/ConsumptionValidation.cpp")
target_compile_features(ConsumptionValidation PRIVATE cxx_std_20)
target_include_directories(ConsumptionValidation PRIVATE "${FrontierDirectory}" "${FrontierDirectory}/Frontier")
target_link_libraries(ConsumptionValidation PRIVATE Threads::Threads)
if(MSVC)
    target_compile_options(ConsumptionValidation PRIVATE /W4 /utf-8 /fp:strict)
else()
    target_compile_options(ConsumptionValidation PRIVATE -Wall -Wextra -Wpedantic -Werror -fno-fast-math -ffp-contract=off)
endif()
add_test(NAME DistanceClipmapConsumption COMMAND ConsumptionValidation "${VehicleArchiveDirectory}"
    "${CMAKE_CURRENT_BINARY_DIR}/Consumption/Consumption.json")

if(FRONTIER_DISTANCE_VULKAN)
    find_package(Vulkan REQUIRED)
    find_program(FRONTIER_DISTANCE_SLANG slangc REQUIRED)
    add_executable(VulkanDistanceEvaluation VulkanDistanceEvaluation.cpp)
    target_compile_features(VulkanDistanceEvaluation PRIVATE cxx_std_20)
    target_include_directories(VulkanDistanceEvaluation PRIVATE "${FrontierDirectory}" "${FrontierDirectory}/Frontier")
    target_link_libraries(VulkanDistanceEvaluation PRIVATE Vulkan::Vulkan Threads::Threads)
    if(MSVC)
        target_compile_options(VulkanDistanceEvaluation PRIVATE /W4 /utf-8 /fp:strict)
    else()
        target_compile_options(VulkanDistanceEvaluation PRIVATE -Wall -Wextra -Wpedantic -Werror -Wno-missing-field-initializers -fno-fast-math -ffp-contract=off)
    endif()
    set(ShaderOutputs)
    foreach(Entry BakeLocalDistance FillClipmap EvaluateDistanceProbes RelightVehicleCache GatherVehicleCache ClearVehicleCache)
        set(Output "${CMAKE_CURRENT_BINARY_DIR}/Shaders/${Entry}.spv")
        add_custom_command(OUTPUT "${Output}"
            COMMAND "${CMAKE_COMMAND}" -E make_directory "${CMAKE_CURRENT_BINARY_DIR}/Shaders"
            COMMAND "${FRONTIER_DISTANCE_SLANG}" "${CMAKE_CURRENT_SOURCE_DIR}/DistanceEvaluation.slang"
                -entry "${Entry}" -target spirv -profile glsl_450 -fp-mode precise -O0 -o "${Output}"
            DEPENDS DistanceEvaluation.slang VERBATIM)
        list(APPEND ShaderOutputs "${Output}")
    endforeach()
    add_custom_target(DistanceClipmapShaders ALL DEPENDS ${ShaderOutputs})
    add_dependencies(VulkanDistanceEvaluation DistanceClipmapShaders)
    add_test(NAME DistanceClipmapVulkan COMMAND VulkanDistanceEvaluation "${VehicleArchiveDirectory}"
        "${CMAKE_CURRENT_BINARY_DIR}/Shaders" "${CMAKE_CURRENT_BINARY_DIR}/Vulkan")
endif()
