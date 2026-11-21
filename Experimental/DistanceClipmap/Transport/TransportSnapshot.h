/*============================================================================================================================================
                                                          TRANSPORTSNAPSHOT.H
============================================================================================================================================*/
// 🧩 Exact pose/light snapshot comparison and immutable-geometry validation for the isolated diffuse transport experiment.

#pragma once
#include "../RadianceScene.h"
#include <bit>

namespace Frontier::DistanceClipmapExperiment
{

//------------------------------------------------------------------------------------------------------------------------
//                                                     TRANSPORT INPUT SNAPSHOTS
//------------------------------------------------------------------------------------------------------------------------

struct TransportSnapshot
{
    std::array<std::uint32_t, 9> Coordinates{};
    unsigned                     Sources = 0, Samples = 0;
    bool                         operator==(const TransportSnapshot&) const = default;

    static TransportSnapshot Capture(const RadianceScene& Scene, unsigned SourceMask, unsigned QuadratureCount)
    {
        const auto& Pose = Scene.Pose;
        return {{{std::bit_cast<std::uint32_t>(Pose.Translation.X), std::bit_cast<std::uint32_t>(Pose.Translation.Y),
                  std::bit_cast<std::uint32_t>(Pose.Translation.Z), std::bit_cast<std::uint32_t>(Pose.Cosine),
                  std::bit_cast<std::uint32_t>(Pose.Sine), std::bit_cast<std::uint32_t>(Scene.SunDirection.X),
                  std::bit_cast<std::uint32_t>(Scene.SunDirection.Y),
                  std::bit_cast<std::uint32_t>(Scene.SunDirection.Z), std::bit_cast<std::uint32_t>(Scene.SunRadius)}},
                SourceMask,
                QuadratureCount};
    }

    bool SamePose(const TransportSnapshot& Other) const
    {
        return std::equal(Coordinates.begin(), Coordinates.begin() + 5, Other.Coordinates.begin());
    }
};

inline std::uint64_t GeometryFingerprint(const RadianceScene& Scene)
{
    std::uint64_t Digest     = 14695981039346656037ull;
    auto          Accumulate = [&](std::uint32_t Word)
    {
        for (unsigned Byte = 0; Byte < 4; ++Byte)
        {
            Digest ^= (Word >> (8 * Byte)) & 255u;
            Digest *= 1099511628211ull;
        }
    };
    for (const auto* Atlas : {&Scene.Vehicle, &Scene.StaticSurfaces})
    {
        Accumulate(unsigned(Atlas->Surfaces.size()));
        for (const auto& Triangle : Atlas->Surfaces)
        {
            Accumulate(Triangle.Material);
            for (const auto& Corner : Triangle.Corner)
                for (unsigned Axis = 0; Axis < 3; ++Axis)
                    Accumulate(std::bit_cast<std::uint32_t>(Corner[Axis]));
        }
    }
    // 📝 Geometry edits require reconstruction of the source CDF, bounds and bake, not just cache invalidation.
    return Digest;
}

} // namespace Frontier::DistanceClipmapExperiment
