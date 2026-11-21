/*============================================================================================================================================
                                                           SDFSHADOWSCENE.H
============================================================================================================================================*/
// 🧩 Closed analytic primitives, geometric normals and a single finite emissive sphere for six genuine SDF rendering paths.

#pragma once
#include "Experimental/DistanceClipmap/Transport/DirectionalRadiance.h"

namespace Frontier::DistanceClipmapExperiment
{

//------------------------------------------------------------------------------------------------------------------------
//                                                  ANALYTIC SCENE FOOTPRINTS
//------------------------------------------------------------------------------------------------------------------------

using ShadowFloat4 = std::array<float, 4>;

struct alignas(16) ShadowPrimitive
{
    Vector   Position{};
    unsigned Shape = 0;
    Vector   Extent{};
    unsigned Material = 0;
};

static_assert(sizeof(ShadowPrimitive) == 32 && offsetof(ShadowPrimitive, Shape) == 12 &&
              offsetof(ShadowPrimitive, Material) == 28);

struct ShadowDistance
{
    float    Distance  = 1000;
    unsigned Primitive = UINT32_MAX;
};

struct ShadowSurface
{
    Vector   Position{}, Normal{}, Reflectance{};
    unsigned Primitive = UINT32_MAX;
    bool     Confirmed = false, Light = false;
};

struct ShadowRadiance
{
    Vector Direct{}, Indirect{};
};

struct SphereArrival
{
    Vector Direction{};
    float  Limit      = 0;
    float  SolidAngle = 0;
};

//------------------------------------------------------------------------------------------------------------------------
//                                             IDENTICAL FLOAT32 AZIMUTH QUADRATURE
//------------------------------------------------------------------------------------------------------------------------

inline std::array<float, 2> ShadowAzimuth(float θ)
{
    // 📝 Device sin/cos approximations displaced a secondary path across a discontinuous checker boundary.
    //    Quarter-turn reduction and the same polynomial on both devices keep sampling errors independently testable.
    const unsigned Quadrant = unsigned(θ * (2.f / π) + .5f);
    const float    Reduced = θ - float(Quadrant) * (.5f * π), Squared = Reduced * Reduced;
    const float    Sine =
        Reduced *
        (1 + Squared * (-1.f / 6 +
                        Squared * (1.f / 120 +
                                   Squared * (-1.f / 5040 + Squared * (1.f / 362880 + Squared * (-1.f / 39916800))))));
    const float Cosine =
        1 + Squared *
                (-1.f / 2 +
                 Squared * (1.f / 24 + Squared * (-1.f / 720 +
                                                  Squared * (1.f / 40320 + Squared * (-1.f / 3628800 +
                                                                                      Squared * (1.f / 479001600))))));
    switch (Quadrant % 4)
    {
    case 0:
        return {Cosine, Sine};
    case 1:
        return {-Sine, Cosine};
    case 2:
        return {-Cosine, -Sine};
    default:
        return {Sine, -Cosine};
    }
}

inline Vector ShadowCosineDirection(Vector Normal, std::array<float, 2> Pair)
{
    Vector Tangent{}, Bitangent{};
    ConstructBasis(Normal, Tangent, Bitangent);
    const float Radius  = std::sqrt(Pair[0]);
    const auto  Azimuth = ShadowAzimuth(2 * π * Pair[1]);
    return Normalize(Tangent * (Radius * Azimuth[0]) + Bitangent * (Radius * Azimuth[1]) +
                     Normal * std::sqrt(1 - Pair[0]));
}

//------------------------------------------------------------------------------------------------------------------------
//                                             SIGNED PRIMITIVE DISTANCE AND NORMALS
//------------------------------------------------------------------------------------------------------------------------

inline float ShadowSign(float Coordinate)
{
    return Coordinate < 0 ? -1.f : 1.f;
}

inline float PrimitiveDistance(const ShadowPrimitive& Primitive, Vector Position)
{
    const Vector Local = Position - Primitive.Position;
    if (Primitive.Shape == 1) return Length(Local) - Primitive.Extent.X;
    if (Primitive.Shape == 2)
    {
        const float Radial   = std::sqrt(Local.X * Local.X + Local.Y * Local.Y) - Primitive.Extent.X;
        const float Vertical = std::abs(Local.Z) - Primitive.Extent.Z;
        return std::sqrt(std::max(Radial, 0.f) * std::max(Radial, 0.f) +
                         std::max(Vertical, 0.f) * std::max(Vertical, 0.f)) +
               std::min(std::max(Radial, Vertical), 0.f);
    }
    if (Primitive.Shape == 3)
    {
        const float Radial = std::sqrt(Local.X * Local.X + Local.Y * Local.Y) - Primitive.Extent.X;
        return std::sqrt(Radial * Radial + Local.Z * Local.Z) - Primitive.Extent.Y;
    }
    return SignedBoxDistance(Position, {Primitive.Position, Primitive.Extent, Primitive.Material});
}

inline Vector PrimitiveNormal(const ShadowPrimitive& Primitive, Vector Position)
{
    const Vector Local = Position - Primitive.Position;
    if (Primitive.Shape == 1) return Normalize(Local);
    if (Primitive.Shape == 2 || Primitive.Shape == 3)
    {
        const float  Radius = std::sqrt(Local.X * Local.X + Local.Y * Local.Y);
        const Vector Radial{Local.X / std::max(Radius, 1e-8f), Local.Y / std::max(Radius, 1e-8f), 0};
        if (Primitive.Shape == 3) return Normalize(Radial * (Radius - Primitive.Extent.X) + Vector{0, 0, Local.Z});
        const float X = Radius - Primitive.Extent.X, Y = std::abs(Local.Z) - Primitive.Extent.Z;
        if (X > 0 && Y > 0) return Normalize(Radial * X + Vector{0, 0, Y * ShadowSign(Local.Z)});
        return X > Y ? Radial : Vector{0, 0, ShadowSign(Local.Z)};
    }
    const Vector Q       = Absolute(Local) - Primitive.Extent;
    const Vector Outside = Maximum(Q, {});
    if (Length(Outside) > 1e-8f)
        return Normalize(Outside * Vector{ShadowSign(Local.X), ShadowSign(Local.Y), ShadowSign(Local.Z)});
    if (Q.X > Q.Y && Q.X > Q.Z) return {ShadowSign(Local.X), 0, 0};
    if (Q.Y > Q.Z) return {0, ShadowSign(Local.Y), 0};
    return {0, 0, ShadowSign(Local.Z)};
}

//------------------------------------------------------------------------------------------------------------------------
//                                                   EMISSIVE-SPHERE ROOM
//------------------------------------------------------------------------------------------------------------------------

class SdfShadowScene
{
public:
    static constexpr float       HitTolerance    = .0004f;
    static constexpr float       SurfaceOffset   = .002f;
    static constexpr unsigned    MarchLimit      = 256;
    static constexpr unsigned    ScatteringSites = 4;
    std::vector<ShadowPrimitive> Primitives;
    std::array<ShadowFloat4, 13> Palette{};
    bool                         SourceEnabled = true;

    SdfShadowScene()
    {
        Palette    = {{{.68f, .64f, .53f, 0},
                       {.65f, .055f, .035f, 0},
                       {.055f, .40f, .11f, 0},
                       {.58f, .53f, .43f, 0},
                       {.70f, .68f, .59f, 0},
                       {.44f, .29f, .075f, 0},
                       {.34f, .33f, .30f, 0},
                       {.23f, .18f, .11f, 0},
                       {},
                       {0, -6.6f, 2.35f, .32f},
                       {0, .7f, 1.0f, 0},
                       {-2.45f, 1.6f, .72f, .43f},
                       {35, 30, 21, 0}}};
        Primitives = {
            {{0, -.25f, -.12f}, 0, {3.85f, 3.8f, .12f}, 0},    {{-3.85f, -.2f, 1.65f}, 0, {.10f, 3.8f, 1.65f}, 1},
            {{3.85f, -.2f, 1.65f}, 0, {.10f, 3.8f, 1.65f}, 2}, {{0, 3.5f, 1.65f}, 0, {3.95f, .10f, 1.65f}, 3},
            {{-1.05f, .9f, .96f}, 2, {.17f, 0, .96f}, 4},      {{-.52f, -.18f, .99f}, 3, {.42f, .115f, 0}, 5},
            {{.78f, .95f, .77f}, 1, {.77f, 0, 0}, 6},          {{.15f, -.85f, .48f}, 0, {.10f, .11f, .48f}, 7},
            {{2.65f, -.85f, .48f}, 0, {.10f, .11f, .48f}, 7},  {{1.40f, -.85f, .97f}, 0, {1.38f, .12f, .11f}, 7},
            {{2.65f, .65f, .48f}, 0, {.10f, .11f, .48f}, 7},   {{1.40f, .65f, .97f}, 0, {1.38f, .12f, .11f}, 7},
        };
    }

    Vector Color(unsigned Index) const
    {
        const auto& Channels = Palette[Index];
        return {Channels[0], Channels[1], Channels[2]};
    }

    Vector LightCenter() const
    {
        return Color(11);
    }

    float LightRadius() const
    {
        return Palette[11][3];
    }

    Vector LightRadiance() const
    {
        return SourceEnabled ? Color(12) : Vector{};
    }

    ShadowDistance Distance(Vector Position, bool IncludeLight) const
    {
        ShadowDistance Result;
        for (unsigned Index = 0; Index < Primitives.size(); ++Index)
        {
            const float Signed = PrimitiveDistance(Primitives[Index], Position);
            if (Signed < Result.Distance) Result = {Signed, Index};
        }
        if (IncludeLight)
        {
            const float Signed = Length(Position - LightCenter()) - LightRadius();
            if (Signed < Result.Distance) Result = {Signed, unsigned(Primitives.size())};
        }
        return Result;
    }

    ShadowSurface Surface(Vector Position, unsigned Primitive) const
    {
        ShadowSurface Result;
        Result.Confirmed = true;
        Result.Position  = Position;
        Result.Primitive = Primitive;
        Result.Light     = Primitive == Primitives.size();
        if (Result.Light)
        {
            Result.Normal = Normalize(Position - LightCenter());
            return Result;
        }
        Result.Normal           = PrimitiveNormal(Primitives[Primitive], Position);
        const unsigned Material = Primitives[Primitive].Material;
        Result.Reflectance      = Color(Material);
        if (Material == 0)
        {
            const int Checker  = int(std::floor(Position.X * 2)) + int(std::floor(Position.Y * 2));
            Result.Reflectance = Result.Reflectance * (Checker % 2 == 0 ? 1.f : .52f);
        }
        return Result;
    }

    ShadowSurface Trace(Vector Origin, Vector Direction) const
    {
        float Travel = 0;
        for (unsigned Step = 0; Step < MarchLimit && Travel < 40; ++Step)
        {
            const Vector Position = Origin + Direction * Travel;
            const auto   Nearest  = Distance(Position, true);
            if (Nearest.Distance <= HitTolerance) return Surface(Position, Nearest.Primitive);
            Travel += Nearest.Distance * .95f;
        }
        return {};
    }

    float BinaryVisibility(Vector Origin, Vector Direction, float Limit) const
    {
        float Travel = 0;
        for (unsigned Step = 0; Step < MarchLimit && Travel < Limit; ++Step)
        {
            const float Signed = Distance(Origin + Direction * Travel, false).Distance;
            if (Signed <= HitTolerance) return 0;
            Travel += Signed * .95f;
        }
        // 📝 Exhaustion is conservatively blocked, not silently declared an empty segment.
        return Travel >= Limit ? 1.f : 0.f;
    }

    SphereArrival Arrival(Vector Origin, std::array<float, 2> Pair) const
    {
        const Vector Delta   = LightCenter() - Origin;
        const float  Squared = Dot(Delta, Delta), Radius = LightRadius();
        const float  Ratio  = std::min(.999999f, Radius * Radius / Squared);
        const float  Cosine = std::sqrt(1 - Ratio), OneMinusCosine = Ratio / (1 + Cosine);
        const Vector Axis = Delta / std::sqrt(Squared);
        Vector       Tangent{}, Bitangent{};
        ConstructBasis(Axis, Tangent, Bitangent);
        const float  LocalCosine = 1 - OneMinusCosine * Pair[0];
        const float  Sine        = std::sqrt(std::max(0.f, (1 - LocalCosine) * (1 + LocalCosine)));
        const auto   Azimuth     = ShadowAzimuth(2 * π * Pair[1]);
        const Vector Direction = Normalize(Axis * LocalCosine + (Tangent * Azimuth[0] + Bitangent * Azimuth[1]) * Sine);
        const float  Projection = Dot(Delta, Direction);
        const float  Root       = std::sqrt(std::max(0.f, Projection * Projection - Squared + Radius * Radius));
        return {Direction, std::max(0.f, Projection - Root - SurfaceOffset), 2 * π * OneMinusCosine};
    }

    Vector CameraRay(float X, float Y, unsigned Width = 480, unsigned Height = 270) const
    {
        const Vector Forward = Normalize(Color(10) - Color(9));
        const Vector Right   = Normalize(Cross(Forward, {0, 0, 1}));
        const Vector Up      = Cross(Right, Forward);
        const float  Aspect = float(Width) / Height, Projection = Palette[9][3];
        return Normalize(Forward + Right * ((2 * X / Width - 1) * Projection * Aspect) +
                         Up * ((1 - 2 * Y / Height) * Projection));
    }
};

} // namespace Frontier::DistanceClipmapExperiment
