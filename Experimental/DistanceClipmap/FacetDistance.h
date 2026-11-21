/*============================================================================================================================================
                                                              FACETDISTANCE.H
============================================================================================================================================*/
// 🧩 Local ControlVehicle facets, production-built triangle bounds and deterministic floating-point intersections.

#pragma once

#include "Frontier/Engine/Rendering/TriangleVisibilitySpace.h"

#include <algorithm>
#include <array>
#include <atomic>
#include <cmath>
#include <cstdint>
#include <cstring>
#include <fstream>
#include <functional>
#include <numeric>
#include <stdexcept>
#include <string>
#include <thread>
#include <vector>

namespace Frontier::DistanceClipmapExperiment
{

//------------------------------------------------------------------------------------------------------------------------
//                                                       SPATIAL ARITHMETIC
//------------------------------------------------------------------------------------------------------------------------

constexpr float π = 3.14159265358979323846f;

struct Vector
{
    float X = 0, Y = 0, Z = 0;
    float operator[](unsigned Axis) const
    {
        return Axis == 0 ? X : Axis == 1 ? Y : Z;
    }
};

inline Vector operator+(Vector A, Vector B)
{
    return {A.X + B.X, A.Y + B.Y, A.Z + B.Z};
}
inline Vector operator-(Vector A, Vector B)
{
    return {A.X - B.X, A.Y - B.Y, A.Z - B.Z};
}
inline Vector operator-(Vector A)
{
    return {-A.X, -A.Y, -A.Z};
}
inline Vector operator*(Vector A, float Scale)
{
    return {A.X * Scale, A.Y * Scale, A.Z * Scale};
}
inline Vector operator*(float Scale, Vector A)
{
    return A * Scale;
}
inline Vector operator*(Vector A, Vector B)
{
    return {A.X * B.X, A.Y * B.Y, A.Z * B.Z};
}
inline Vector operator/(Vector A, float Scale)
{
    return A * (1 / Scale);
}
inline Vector& operator+=(Vector& A, Vector B)
{
    A = A + B;
    return A;
}
inline float Dot(Vector A, Vector B)
{
    return A.X * B.X + A.Y * B.Y + A.Z * B.Z;
}
inline Vector Cross(Vector A, Vector B)
{
    return {A.Y * B.Z - A.Z * B.Y, A.Z * B.X - A.X * B.Z, A.X * B.Y - A.Y * B.X};
}
inline float Length(Vector A)
{
    return std::sqrt(Dot(A, A));
}
inline Vector Normalize(Vector A)
{
    const float Magnitude = Length(A);
    return Magnitude > 0 ? A / Magnitude : Vector{};
}
inline Vector Minimum(Vector A, Vector B)
{
    return {std::min(A.X, B.X), std::min(A.Y, B.Y), std::min(A.Z, B.Z)};
}
inline Vector Maximum(Vector A, Vector B)
{
    return {std::max(A.X, B.X), std::max(A.Y, B.Y), std::max(A.Z, B.Z)};
}
inline Vector Absolute(Vector A)
{
    return {std::abs(A.X), std::abs(A.Y), std::abs(A.Z)};
}
inline float Luminance(Vector A)
{
    return Dot(A, {.2126f, .7152f, .0722f});
}
inline SpatialVector Expand(Vector A)
{
    return {A.X, A.Y, A.Z};
}
inline Vector Reduce(SpatialVector A)
{
    return {float(A.X), float(A.Y), float(A.Z)};
}
inline void Require(bool Condition, const std::string& Description)
{
    if (!Condition) throw std::runtime_error(Description);
}

inline void Parallel(unsigned Count, const std::function<void(unsigned)>& Evaluate)
{
    std::atomic<unsigned>    Cursor{0};
    const unsigned           Threads = std::min(2u, std::max(1u, std::thread::hardware_concurrency()));
    std::vector<std::thread> Pending;
    for (unsigned Thread = 0; Thread < Threads; ++Thread)
        Pending.emplace_back(
            [&]()
            {
                for (;;)
                {
                    const unsigned Index = Cursor.fetch_add(1, std::memory_order_relaxed);
                    if (Index >= Count) break;
                    Evaluate(Index);
                }
            });
    for (auto& Execution : Pending)
        Execution.join();
}

struct RigidPose
{
    Vector Translation{};
    float  Cosine = 1, Sine = 0;
    Vector Rotate(Vector P) const
    {
        return {Cosine * P.X - Sine * P.Y, Sine * P.X + Cosine * P.Y, P.Z};
    }
    Vector Unrotate(Vector P) const
    {
        return {Cosine * P.X + Sine * P.Y, -Sine * P.X + Cosine * P.Y, P.Z};
    }
    Vector ToWorld(Vector P) const
    {
        return Rotate(P) + Translation;
    }
    Vector ToLocal(Vector P) const
    {
        return Unrotate(P - Translation);
    }
};

inline RigidPose EvaluateMotion(double Seconds)
{
    const double Phase = 2 * double(π) * Seconds / 4;
    const float  Angle = float(.18 * std::sin(Phase));
    return {{float(.9 * std::sin(Phase)), float(.22 * (1 - std::cos(Phase))), 0}, std::cos(Angle), std::sin(Angle)};
}

struct Facet
{
    std::array<Vector, 3> Corner{}, Normal{};
    unsigned              Material = 0;
};

struct Strike
{
    float    Travel = INFINITY, U = 0, V = 0;
    unsigned FacetIndex = UINT32_MAX;
    bool     Confirmed() const
    {
        return FacetIndex != UINT32_MAX;
    }
};

//------------------------------------------------------------------------------------------------------------------------
//                                              PRODUCTION BOUNDS / FLOAT32 QUERIES
//------------------------------------------------------------------------------------------------------------------------

// 📝 The production builder and outward-rounded GPU footprint are reused unchanged. Query arithmetic below also
//    executes in DistanceEvaluation.slang; the production double-precision query remains the independent test oracle.
class FacetAtlas
{
public:
    TriangleVisibilitySpace             Geometry;
    TriangleVisibilitySpace::FloatAtlas Packed;
    std::vector<Facet>                  Surfaces;
    Vector                              Low{}, High{};

    void Construct(std::vector<Facet> Triangles)
    {
        Require(!Triangles.empty(), "Empty facet atlas");
        Surfaces = std::move(Triangles);
        std::vector<std::array<SpatialVector, 3>> Positions;
        for (const auto& Triangle : Surfaces)
            Positions.push_back({Expand(Triangle.Corner[0]), Expand(Triangle.Corner[1]), Expand(Triangle.Corner[2])});
        Geometry.Build(std::move(Positions));
        Packed                = Geometry.PackFloat32();
        const auto& Enclosure = Packed.Enclosures[0];
        Low                   = {Enclosure.Minimum[0], Enclosure.Minimum[1], Enclosure.Minimum[2]};
        High                  = {Enclosure.Maximum[0], Enclosure.Maximum[1], Enclosure.Maximum[2]};
    }

    static bool IntersectEnclosure(Vector Origin,
                                   Vector Direction,
                                   Vector Low,
                                   Vector High,
                                   float  MinimumTravel,
                                   float  MaximumTravel,
                                   float& Near)
    {
        Near      = MinimumTravel;
        float Far = MaximumTravel;
        for (unsigned Axis = 0; Axis < 3; ++Axis)
        {
            if (Direction[Axis] == 0)
            {
                if (Origin[Axis] < Low[Axis] || Origin[Axis] > High[Axis]) return false;
            }
            else
            {
                float A = (Low[Axis] - Origin[Axis]) / Direction[Axis];
                float B = (High[Axis] - Origin[Axis]) / Direction[Axis];
                if (A > B) std::swap(A, B);
                Near = std::max(Near, A);
                Far  = std::min(Far, B);
            }
        }
        return Near <= Far;
    }

    bool IntersectRegion(unsigned Index, Vector Origin, Vector Direction, float Limit, float& Near) const
    {
        const auto& Region = Packed.Enclosures[Index];
        return IntersectEnclosure(Origin,
                                  Direction,
                                  {Region.Minimum[0], Region.Minimum[1], Region.Minimum[2]},
                                  {Region.Maximum[0], Region.Maximum[1], Region.Maximum[2]},
                                  0,
                                  Limit,
                                  Near);
    }

    Strike Trace(Vector Origin, Vector Direction, float Limit, bool Any = false) const
    {
        Strike                   Result;
        std::array<unsigned, 64> Pending{};
        unsigned                 Count = 1;
        while (Count)
        {
            const auto& Region = Packed.Enclosures[Pending[--Count]];
            float       Near   = 0;
            if (!IntersectEnclosure(Origin,
                                    Direction,
                                    {Region.Minimum[0], Region.Minimum[1], Region.Minimum[2]},
                                    {Region.Maximum[0], Region.Maximum[1], Region.Maximum[2]},
                                    0,
                                    Limit,
                                    Near))
                continue;
            if (!Region.Links[2])
            {
                float      LowerNear = 0, UpperNear = 0;
                const bool LowerHit = IntersectRegion(Region.Links[0], Origin, Direction, Limit, LowerNear);
                const bool UpperHit = IntersectRegion(Region.Links[1], Origin, Direction, Limit, UpperNear);
                if (LowerHit && UpperHit)
                {
                    Pending[Count++] = Region.Links[LowerNear < UpperNear ? 1 : 0];
                    Pending[Count++] = Region.Links[LowerNear < UpperNear ? 0 : 1];
                }
                else if (LowerHit)
                    Pending[Count++] = Region.Links[0];
                else if (UpperHit)
                    Pending[Count++] = Region.Links[1];
                continue;
            }
            for (unsigned Slot = Region.Links[0]; Slot < Region.Links[0] + Region.Links[1]; ++Slot)
            {
                const auto&  Triangle = Packed.Corners[Slot];
                const Vector A{Triangle.A[0], Triangle.A[1], Triangle.A[2]};
                const Vector B{Triangle.B[0], Triangle.B[1], Triangle.B[2]};
                const Vector C{Triangle.C[0], Triangle.C[1], Triangle.C[2]};
                const Vector EdgeAB = B - A, EdgeAC = C - A;
                const Vector Perpendicular = Cross(Direction, EdgeAC);
                const float  Determinant   = Dot(EdgeAB, Perpendicular);
                if (std::abs(Determinant) < 1e-12f) continue;
                const float  Reciprocal   = 1 / Determinant;
                const Vector Displacement = Origin - A;
                const float  U            = Dot(Displacement, Perpendicular) * Reciprocal;
                if (U < 0 || U > 1) continue;
                const Vector SecondCross = Cross(Displacement, EdgeAB);
                const float  V           = Dot(Direction, SecondCross) * Reciprocal;
                if (V < 0 || U + V > 1) continue;
                const float Travel = Dot(EdgeAC, SecondCross) * Reciprocal;
                if (Travel > 1e-5f && Travel < Limit)
                {
                    Result = {Travel, U, V, Packed.OriginalFacets[Slot]};
                    if (Any) return Result;
                    Limit = Travel;
                }
            }
        }
        return Result;
    }

    static float TriangleDistanceSquared(Vector P, Vector A, Vector B, Vector C)
    {
        const Vector EdgeAB = B - A, EdgeAC = C - A, Difference = P - A;
        const Vector Perpendicular = Cross(EdgeAB, EdgeAC);
        const float  NormalSquared = Dot(Perpendicular, Perpendicular);
        if (NormalSquared > 1e-22f && Dot(Cross(EdgeAB, Difference), Perpendicular) >= 0 &&
            Dot(Cross(C - B, P - B), Perpendicular) >= 0 && Dot(Cross(A - C, P - C), Perpendicular) >= 0)
        {
            const float Height = Dot(Difference, Perpendicular);
            return Height * Height / NormalSquared;
        }
        float        Squared   = INFINITY;
        const Vector Corners[] = {A, B, C};
        for (unsigned Edge = 0; Edge < 3; ++Edge)
        {
            const Vector Direction   = Corners[(Edge + 1) % 3] - Corners[Edge];
            const Vector Offset      = P - Corners[Edge];
            const float  Denominator = Dot(Direction, Direction);
            const float  Fraction    = Denominator > 0 ? std::clamp(Dot(Offset, Direction) / Denominator, 0.f, 1.f) : 0;
            const Vector Separation  = Offset - Direction * Fraction;
            Squared                  = std::min(Squared, Dot(Separation, Separation));
        }
        return Squared;
    }

    float RegionDistanceSquared(unsigned Index, Vector P) const
    {
        const auto&  Region     = Packed.Enclosures[Index];
        const Vector Separation = Maximum(Maximum(Vector{Region.Minimum[0], Region.Minimum[1], Region.Minimum[2]} - P,
                                                  P - Vector{Region.Maximum[0], Region.Maximum[1], Region.Maximum[2]}),
                                          {});
        return Dot(Separation, Separation);
    }

    float Nearest(Vector P) const
    {
        float                    BestSquared = INFINITY;
        std::array<unsigned, 64> Pending{};
        unsigned                 Count = 1;
        while (Count)
        {
            const unsigned Index = Pending[--Count];
            if (RegionDistanceSquared(Index, P) > BestSquared) continue;
            const auto& Region = Packed.Enclosures[Index];
            if (!Region.Links[2])
            {
                const float Lower = RegionDistanceSquared(Region.Links[0], P);
                const float Upper = RegionDistanceSquared(Region.Links[1], P);
                if (std::max(Lower, Upper) < BestSquared) Pending[Count++] = Region.Links[Lower < Upper ? 1 : 0];
                if (std::min(Lower, Upper) < BestSquared) Pending[Count++] = Region.Links[Lower < Upper ? 0 : 1];
                continue;
            }
            for (unsigned Slot = Region.Links[0]; Slot < Region.Links[0] + Region.Links[1]; ++Slot)
            {
                const auto& Triangle = Packed.Corners[Slot];
                BestSquared          = std::min(BestSquared,
                                       TriangleDistanceSquared(P,
                                                                        {Triangle.A[0], Triangle.A[1], Triangle.A[2]},
                                                                        {Triangle.B[0], Triangle.B[1], Triangle.B[2]},
                                                                        {Triangle.C[0], Triangle.C[1], Triangle.C[2]}));
            }
        }
        return std::sqrt(BestSquared);
    }
};

//------------------------------------------------------------------------------------------------------------------------
//                                                  AUTHORED FCT1 GEOMETRY
//------------------------------------------------------------------------------------------------------------------------

struct FacetArchive
{
    std::vector<Vector>                  Positions;
    std::vector<std::array<unsigned, 3>> Indices;
    std::vector<unsigned>                Materials;
    std::vector<std::array<Vector, 3>>   Normals;
};

inline FacetArchive DecodeArchive(const std::string& Path)
{
    std::ifstream Input(Path, std::ios::binary | std::ios::ate);
    Require(bool(Input), "Cannot open " + Path);
    const auto Length = Input.tellg();
    Require(Length >= 48 && Length < 32 * 1024 * 1024, "Invalid FCT1 extent");
    std::vector<char> Bytes(static_cast<std::size_t>(Length));
    Input.seekg(0);
    Require(bool(Input.read(Bytes.data(), Length)), "FCT1 read failed");
    Require(std::memcmp(Bytes.data(), "FCT1", 4) == 0, "Invalid FCT1 signature");
    auto Integer = [&](std::size_t Offset)
    {
        unsigned Number = 0;
        for (unsigned Byte = 0; Byte < 4; ++Byte)
            Number |= unsigned(static_cast<unsigned char>(Bytes[Offset + Byte])) << (Byte * 8);
        return Number;
    };
    auto Scalar = [&](std::size_t Offset)
    {
        const unsigned Bits   = Integer(Offset);
        float          Number = 0;
        std::memcpy(&Number, &Bits, 4);
        Require(std::isfinite(Number), "Nonfinite FCT1 position or normal");
        return Number;
    };
    const unsigned    Vertices = Integer(4), Facets = Integer(8), Options = Integer(12);
    const std::size_t Expected = 48ull + Vertices * 12ull + Facets * 16ull + ((Options & 1) ? Facets * 36ull : 0);
    Require(Options <= 1 && Expected == Bytes.size(), "FCT1 length/options mismatch");
    FacetArchive Archive;
    for (unsigned Vertex = 0; Vertex < Vertices; ++Vertex)
        Archive.Positions.push_back({Scalar(48 + Vertex * 12), Scalar(52 + Vertex * 12), Scalar(56 + Vertex * 12)});
    std::size_t Offset = 48 + Vertices * 12;
    for (unsigned Face = 0; Face < Facets; ++Face)
    {
        const std::array<unsigned, 3> Corners{Integer(Offset), Integer(Offset + 4), Integer(Offset + 8)};
        Require(*std::max_element(Corners.begin(), Corners.end()) < Vertices, "FCT1 corner out of range");
        Archive.Indices.push_back(Corners);
        Offset += 12;
    }
    for (unsigned Face = 0; Face < Facets; ++Face, Offset += 4)
        Archive.Materials.push_back(Integer(Offset));
    Archive.Normals.resize(Facets);
    if (Options & 1)
    {
        for (auto& Normals : Archive.Normals)
            for (auto& Normal : Normals)
            {
                Normal = Normalize({Scalar(Offset), Scalar(Offset + 4), Scalar(Offset + 8)});
                Offset += 12;
            }
    }
    else
    {
        std::vector<Vector>                Perpendiculars;
        std::vector<std::vector<unsigned>> Incidence(Vertices);
        for (unsigned Face = 0; Face < Facets; ++Face)
        {
            const auto Corners = Archive.Indices[Face];
            Perpendiculars.push_back(Cross(Archive.Positions[Corners[1]] - Archive.Positions[Corners[0]],
                                           Archive.Positions[Corners[2]] - Archive.Positions[Corners[0]]));
            for (auto Vertex : Corners)
                Incidence[Vertex].push_back(Face);
        }
        for (unsigned Face = 0; Face < Facets; ++Face)
            for (unsigned Corner = 0; Corner < 3; ++Corner)
            {
                Vector Sum{};
                for (unsigned Adjacent : Incidence[Archive.Indices[Face][Corner]])
                    if (Dot(Normalize(Perpendiculars[Adjacent]), Normalize(Perpendiculars[Face])) >=
                        std::cos(38 * π / 180))
                        Sum += Perpendiculars[Adjacent];
                Archive.Normals[Face][Corner] = Normalize(Sum);
            }
    }
    return Archive;
}

inline std::vector<Facet> AssembleVehicle(const std::string& Root)
{
    const auto         Body = DecodeArchive(Root + "/ControlVehicleBody.facet");
    const auto         Rim  = DecodeArchive(Root + "/ControlVehicleRim.facet");
    const auto         Tyre = DecodeArchive(Root + "/ControlVehicleTyre.facet");
    std::vector<Facet> Surfaces;
    auto               Append = [&](const FacetArchive& Archive, Vector Mount, bool Mirrored, float Scale)
    {
        for (unsigned Face = 0; Face < Archive.Indices.size(); ++Face)
        {
            Facet Triangle;
            Triangle.Material = Archive.Materials[Face];
            for (unsigned Corner = 0; Corner < 3; ++Corner)
            {
                const unsigned SourceCorner = Mirrored && Corner ? 3 - Corner : Corner;
                Vector         Position     = Archive.Positions[Archive.Indices[Face][SourceCorner]] * Scale;
                Vector         Normal       = Archive.Normals[Face][SourceCorner];
                if (Mirrored)
                {
                    Position.Y = -Position.Y;
                    Normal.Y   = -Normal.Y;
                }
                Triangle.Corner[Corner] = Position + Mount + Vector{0, 0, .53f - .11285f};
                Triangle.Normal[Corner] = Normal;
            }
            Surfaces.push_back(Triangle);
        }
    };
    Append(Body, {}, false, 1);
    for (Vector Mount : {Vector{1.7274f, 1.0475f, .0914f},
                         Vector{1.7274f, -1.0475f, .0914f},
                         Vector{-1.6686f, 1.0475f, .0914f},
                         Vector{-1.6686f, -1.0475f, .0914f}})
    {
        Append(Tyre, Mount, Mount.Y < 0, 1);
        Append(Rim, Mount, Mount.Y < 0, .34460f / .344818f);
    }
    Require(Surfaces.size() == 25068, "ControlVehicle archive facet count changed");
    return Surfaces;
}

} // namespace Frontier::DistanceClipmapExperiment
