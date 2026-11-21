/*============================================================================================================================================
                                                SDFPENUMBRAPARITYCAPTURE.CPP
====================================================================================================================================*/
// 🧩 Headless parity oracle for the six PROOF 11 emissive-sphere SDF renderers: one shared penumbra law, a voxel clipmap with iterated cone radiosity, an unbiased Monte Carlo reference, and a legacy-formula replication that reproduces the measured width mismatch

//------------------------------------------------------------------------------------------------------------------------
//                                                            INCLUDES
//------------------------------------------------------------------------------------------------------------------------

#include <algorithm>
#include <array>
#include <cctype>
#include <cmath>
#include <cstdint>
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <filesystem>
#include <string>
#include <thread>
#include <vector>

//------------------------------------------------------------------------------------------------------------------------
//                                                            CONSTANTS
//------------------------------------------------------------------------------------------------------------------------

namespace
{

constexpr float    π              = 3.14159265358979323846f;  // [rad] circle constant
constexpr float    τ              = 6.28318530717958646720f;  // [rad] full turn
constexpr uint32_t PanelWidthPx   = 480u;                     // [px] one proof panel width
constexpr uint32_t PanelHeightPx  = 270u;                     // [px] one proof panel height
constexpr uint32_t ReferenceSpp   = 96u;                      // [-]  Monte Carlo reference samples per pixel
constexpr uint32_t CapLobeSpp     = 24u;                      // [-]  spherical-cap quadrature samples of mode 4
constexpr float    MarchEpsilon   = 2.0e-4f;                  // [m]  occluder contact threshold of exact shadow rays
constexpr float    SurfaceEps     = 6.0e-4f;                  // [m]  primary ray contact threshold
constexpr uint32_t BakeDirections = 24u;                      // [-]  hemisphere directions of one radiosity exchange
constexpr uint32_t ConeGiDirs     = 24u;                      // [-]  cone directions of one pixel irradiance tap
constexpr uint32_t BakePasses     = 1u;                       // [-]  radiosity exchange iterations after injection: store depth b1+b2, exactly the indirect depth the 3-vertex reference carries

//------------------------------------------------------------------------------------------------------------------------
//                                                    VECTOR ALGEBRA
//------------------------------------------------------------------------------------------------------------------------

struct Axis3D
{
    float X = 0.0f, Y = 0.0f, Z = 0.0f;                      // [m] cartesian triple

    Axis3D operator+(const Axis3D& R) const { return { X + R.X, Y + R.Y, Z + R.Z }; }
    Axis3D operator-(const Axis3D& R) const { return { X - R.X, Y - R.Y, Z - R.Z }; }
    Axis3D operator*(float S)         const { return { X * S, Y * S, Z * S }; }
};

float Dot(const Axis3D& A, const Axis3D& B) { return A.X * B.X + A.Y * B.Y + A.Z * B.Z; }
Axis3D Cross(const Axis3D& A, const Axis3D& B)
{
    return { A.Y * B.Z - A.Z * B.Y, A.Z * B.X - A.X * B.Z, A.X * B.Y - A.Y * B.X };
}
float Length(const Axis3D& A) { return std::sqrt(Dot(A, A)); }
Axis3D Normalize(const Axis3D& A)
{
    const float L = Length(A);
    return (L > 1.0e-8f) ? A * (1.0f / L) : Axis3D { 0.0f, 1.0f, 0.0f };
}

struct LinearRGB
{
    float R = 0.0f, G = 0.0f, B = 0.0f;                      // [-] linear radiance triple
    LinearRGB operator+(const LinearRGB& O) const { return { R + O.R, G + O.G, B + O.B }; }
    LinearRGB operator-(const LinearRGB& O) const { return { R - O.R, G - O.G, B - O.B }; }
    LinearRGB operator*(float S) const { return { R * S, G * S, B * S }; }
    LinearRGB& operator+=(const LinearRGB& O) { R += O.R; G += O.G; B += O.B; return *this; }
};

// 📝 Avalanche-style 32-bit finaliser; decorrelates pixel indices into quadrature seeds
uint32_t AvalancheKey32(uint32_t V)
{
    V ^= V >> 16; V *= 0x7FEB352Du; V ^= V >> 15; V *= 0x846CA68Bu; V ^= V >> 16;
    return V;
}

// 📝 Stratified (0,2)-style pair: axis 0 stratum = (Index + jitter)/Strata, axis 1 = jittered radical inverse,
//    per-stream salts keep next-event and continuation events independent while every stratum is covered once
Axis3D EvaluateStratifiedPair(uint32_t Index, uint32_t Strata, uint32_t Stream, uint32_t Key)
{
    uint32_t H1 = Key ^ (Stream * 0x9E3779B9u);
    H1 ^= H1 >> 16; H1 *= 0x85EBCA6Bu; H1 ^= H1 >> 13; H1 *= 0xC2B2AE35u; H1 ^= H1 >> 16;
    uint32_t H2 = (Key + 0x6D2B79F5u) ^ (Stream * 0x85EBCA6Bu);
    H2 ^= H2 >> 16; H2 *= 0xC2B2AE35u; H2 ^= H2 >> 13; H2 *= 0x85EBCA6Bu; H2 ^= H2 >> 16;
    const float J1 = static_cast<float>(static_cast<double>(H1) / 4294967296.0);   // [0-1] stratum jitter axis 0
    const float J2 = static_cast<float>(static_cast<double>(H2) / 4294967296.0);   // [0-1] stratum jitter axis 1
    uint32_t N = Index ^ (Stream * 0x51ED270Bu);
    N ^= N >> 16; N *= 0x7FEB352Du; N ^= N >> 15;                                  // [-] stream decorrelation
    uint32_t R = 0u;
    for (uint32_t B = 0u; B < 32u; ++B) { R = (R << 1) | (N & 1u); N >>= 1; }
    const float Rad = static_cast<float>(static_cast<double>(R) / 4294967296.0);   // [0-1] radical inverse axis 1
    return { (static_cast<float>(Index) + J1) / static_cast<float>(std::max(1u, Strata)),
             std::fmod(Rad + J2, 1.0f), 0.0f };
}

float SmoothHermite01(float Edge0, float Edge1, float t)
{
    const float U = std::clamp((t - Edge0) / (Edge1 - Edge0), 0.0f, 1.0f);
    return U * U * (3.0f - 2.0f * U);
}

// 📝 Quadratic polynomial soft minimum, the standard SDF blending smin
float SoftMinimum(float A, float B, float k)
{
    const float H = std::clamp(0.5f + 0.5f * (B - A) / k, 0.0f, 1.0f);
    return B + (A - B) * H - k * H * (1.0f - H);
}

//------------------------------------------------------------------------------------------------------------------------
//                                                    SCENE STORAGE
//------------------------------------------------------------------------------------------------------------------------

struct LuminaireSphere
{
    Axis3D    Center   { -1.38f, 0.48f, 1.02f };             // [m]  sole emissive orb centre
    float     Radius   = 0.40f;                              // [m]  orb radius
    LinearRGB Radiance { 19.5f, 17.2f, 13.8f };              // [-]  emitted radiance
};

struct SlabPrimitive
{
    Axis3D   Center {};                                      // [m]  slab centre
    Axis3D   Half   {};                                      // [m]  slab half extents
    uint32_t Slot   = 0u;                                    // [idx] material slot
    bool     Casts  = false;                                 // [-]  participates in shadow occlusion
};

struct CylinderPrimitive
{
    Axis3D   Base   {};                                      // [m]  axis base on floor
    float    Height = 0.0f;                                  // [m]  axis length along +Z
    float    Radius = 0.0f;                                  // [m]  lateral radius
    uint32_t Slot   = 0u;                                    // [idx] material slot
};

struct TorusPrimitive
{
    Axis3D   Center {};                                      // [m]  ring centre
    float    Major  = 0.0f;                                  // [m]  ring radius
    float    Minor  = 0.0f;                                  // [m]  tube radius
    uint32_t Slot   = 0u;                                    // [idx] material slot
};

struct SpherePrimitive
{
    Axis3D   Center {};                                      // [m]  sphere centre
    float    Radius = 0.0f;                                  // [m]  sphere radius
    uint32_t Slot   = 0u;                                    // [idx] material slot
};

struct SurfaceMaterial
{
    LinearRGB Albedo    { 0.5f, 0.5f, 0.5f };                // [-]  Lambert reflectance
    bool      Checker   = false;                             // [-]  floor checkerboard flag
};

struct ShowcaseScene
{
    std::array<SurfaceMaterial, 9> Materials {};             // [idx] Lambert slots 0..8
    std::vector<SlabPrimitive>     Slabs     {};             // [idx] room shells plus casting pedestal
    std::vector<CylinderPrimitive> Cylinders {};             // [idx] casting column
    std::vector<SpherePrimitive>   Spheres   {};             // [idx] casting grey sphere
    std::vector<TorusPrimitive>    Tori      {};             // [idx] casting bronze torus
    LuminaireSphere                Luminaire {};             // [-]  sole light source
};

void BuildCanonicalEmissiveSphereScene(ShowcaseScene& OutScene)
{
    OutScene.Materials[0] = { { 0.66f, 0.63f, 0.56f }, true  };   // checker floor light tile
    OutScene.Materials[1] = { { 0.72f, 0.70f, 0.65f }, false };   // back wall
    OutScene.Materials[2] = { { 0.78f, 0.22f, 0.10f }, false };   // crimson left wall
    OutScene.Materials[3] = { { 0.14f, 0.46f, 0.24f }, false };   // green right wall
    OutScene.Materials[4] = { { 0.44f, 0.44f, 0.44f }, false };   // ceiling
    OutScene.Materials[5] = { { 0.74f, 0.71f, 0.66f }, false };   // stone column and pedestal
    OutScene.Materials[6] = { { 0.64f, 0.43f, 0.22f }, false };   // bronze torus
    OutScene.Materials[7] = { { 1.00f, 0.98f, 0.94f }, false };   // orb surface
    OutScene.Materials[8] = { { 0.65f, 0.65f, 0.67f }, false };   // matte grey sphere

    OutScene.Slabs = {
        { {  0.00f,  0.20f, -0.10f }, { 2.80f, 2.65f, 0.10f }, 0u, false },
        { {  0.00f,  2.72f,  1.60f }, { 2.80f, 0.10f, 1.70f }, 1u, false },
        { { -2.74f,  0.20f,  1.60f }, { 0.10f, 2.65f, 1.70f }, 2u, false },
        { {  2.74f,  0.20f,  1.60f }, { 0.10f, 2.65f, 1.70f }, 3u, false },
        { {  0.00f,  0.20f,  3.26f }, { 2.80f, 2.65f, 0.10f }, 4u, false },
        { { -0.12f, -0.38f,  0.36f }, { 0.19f, 0.19f, 0.36f }, 5u, true  },
    };
    OutScene.Cylinders = { { { -0.50f, 0.36f, 0.0f }, 1.68f, 0.155f, 5u } };
    OutScene.Tori      = { { { -0.12f, -0.38f, 0.90f }, 0.29f, 0.105f, 6u } };
    OutScene.Spheres   = { { {  0.52f,  0.56f, 0.52f }, 0.52f, 8u } };
    OutScene.Luminaire = { { -1.38f, 0.48f, 1.02f }, 0.40f, { 19.5f, 17.2f, 13.8f } };
}

LinearRGB EvaluateAlbedoAt(const ShowcaseScene& Scene, uint32_t Slot, const Axis3D& P)
{
    if (Slot == 0u)
    {
        const float Scale = 0.58f;                           // [m] checker tile edge
        const int Px = static_cast<int>(std::floor(P.X / Scale));
        const int Py = static_cast<int>(std::floor(P.Y / Scale));
        return ((Px + Py) & 1) ? LinearRGB { 0.38f, 0.36f, 0.33f } : Scene.Materials[0].Albedo;
    }
    return Scene.Materials[std::min<size_t>(Slot, Scene.Materials.size() - 1)].Albedo;
}

//------------------------------------------------------------------------------------------------------------------------
//                                                DISTANCE FIELD EVALUATION
//------------------------------------------------------------------------------------------------------------------------

float SlabDistance(const Axis3D& P, const SlabPrimitive& S)
{
    const Axis3D Q { std::fabs(P.X - S.Center.X) - S.Half.X,
                     std::fabs(P.Y - S.Center.Y) - S.Half.Y,
                     std::fabs(P.Z - S.Center.Z) - S.Half.Z };
    const Axis3D Out { std::max(Q.X, 0.0f), std::max(Q.Y, 0.0f), std::max(Q.Z, 0.0f) };
    return Length(Out) + std::min(std::max({ Q.X, Q.Y, Q.Z }), 0.0f);
}

float CylinderDistance(const Axis3D& P, const CylinderPrimitive& C)
{
    const float Rho   = std::hypot(P.X - C.Base.X, P.Y - C.Base.Y) - C.Radius;   // [m] lateral offset
    const float Axial = std::fabs(P.Z - C.Base.Z - C.Height * 0.5f) - C.Height * 0.5f;
    const Axis3D Out { std::max(Rho, 0.0f), 0.0f, std::max(Axial, 0.0f) };
    return Length(Out) + std::min(std::max(Rho, Axial), 0.0f);
}

float TorusDistance(const Axis3D& P, const TorusPrimitive& T)
{
    const float Rho = std::hypot(P.X - T.Center.X, P.Y - T.Center.Y) - T.Major;  // [m] ring-plane offset
    return std::hypot(Rho, P.Z - T.Center.Z) - T.Minor;
}

float SphereDistance(const Axis3D& P, const SpherePrimitive& S)
{
    return Length(P - S.Center) - S.Radius;
}

//  Casting occluders only (pedestal, column, torus, grey sphere): the shadow predicate ignores room shells by construction
float EvaluateOccluderDistance(const ShowcaseScene& Scene, const Axis3D& P)
{
    float D = SlabDistance(P, Scene.Slabs[5]);
    D = std::min(D, CylinderDistance(P, Scene.Cylinders[0]));
    D = std::min(D, TorusDistance(P, Scene.Tori[0]));
    D = std::min(D, SphereDistance(P, Scene.Spheres[0]));
    return D;
}

float EvaluateSceneDistance(const ShowcaseScene& Scene, const Axis3D& P, uint32_t& OutSlot)
{
    float D = SlabDistance(P, Scene.Slabs[0]);
    uint32_t Slot = Scene.Slabs[0].Slot;
    for (size_t I = 1u; I < Scene.Slabs.size(); ++I)
    {
        const float C = SlabDistance(P, Scene.Slabs[I]);
        if (C < D) { D = C; Slot = Scene.Slabs[I].Slot; }
    }
    const float Cyl = CylinderDistance(P, Scene.Cylinders[0]);
    if (Cyl < D) { D = Cyl; Slot = Scene.Cylinders[0].Slot; }
    const float Tor = TorusDistance(P, Scene.Tori[0]);
    if (Tor < D) { D = Tor; Slot = Scene.Tori[0].Slot; }
    const float Sph = SphereDistance(P, Scene.Spheres[0]);
    if (Sph < D) { D = Sph; Slot = Scene.Spheres[0].Slot; }
    const float Orb = SphereDistance(P, { Scene.Luminaire.Center, Scene.Luminaire.Radius, 7u });
    if (Orb < D) { D = Orb; Slot = 7u; }
    OutSlot = Slot;
    return D;
}

Axis3D EvaluateSceneNormal(const ShowcaseScene& Scene, const Axis3D& P)
{
    const float E = 1.0e-3f;                                 // [m] gradient step
    uint32_t Unused = 0u;
    return Normalize({ EvaluateSceneDistance(Scene, P + Axis3D { E, 0, 0 }, Unused) - EvaluateSceneDistance(Scene, P - Axis3D { E, 0, 0 }, Unused),
                       EvaluateSceneDistance(Scene, P + Axis3D { 0, E, 0 }, Unused) - EvaluateSceneDistance(Scene, P - Axis3D { 0, E, 0 }, Unused),
                       EvaluateSceneDistance(Scene, P + Axis3D { 0, 0, E }, Unused) - EvaluateSceneDistance(Scene, P - Axis3D { 0, 0, E }, Unused) });
}

bool TraceSceneRay(const ShowcaseScene& Scene, const Axis3D& Origin, const Axis3D& Dir, float MaxT,
                   Axis3D& OutPos, Axis3D& OutNormal, uint32_t& OutSlot)
{
    float T = 0.01f;                                         // [m] ray parameter
    for (uint32_t S = 0u; S < 160u && T < MaxT; ++S)
    {
        const Axis3D P = Origin + Dir * T;
        uint32_t Slot = 0u;
        const float D = EvaluateSceneDistance(Scene, P, Slot);
        if (D < SurfaceEps)
        {
            OutPos = P; OutNormal = EvaluateSceneNormal(Scene, P); OutSlot = Slot;
            return true;
        }
        T += std::max(SurfaceEps, D * 0.92f);
    }
    return false;
}

// 📝 Exact occlusion predicate: sphere-march the casting field with a sub-millimetre contact test, no thickness fudge
bool TraceOccluderBlocked(const ShowcaseScene& Scene, const Axis3D& Origin, const Axis3D& Dir, float MinT, float MaxT)
{
    float T = MinT;                                          // [m] ray parameter
    for (uint32_t S = 0u; S < 128u && T < MaxT; ++S)
    {
        const float D = EvaluateOccluderDistance(Scene, Origin + Dir * T);
        if (D < MarchEpsilon) { return true; }
        T += std::max(MarchEpsilon, D * 0.90f);
    }
    return false;
}

//------------------------------------------------------------------------------------------------------------------------
//                                              VOXEL CLIPMAP AND RADIOSITY STORE
//------------------------------------------------------------------------------------------------------------------------

struct ClipmapCascade
{
    Axis3D                 BoundsMin {};                     // [m]  cascade corner
    float                  Cell      = 0.0f;                 // [m]  cubic cell edge
    uint32_t               Dim       = 0u;                   // [idx] cells per axis
    std::vector<float>     Distance  {};                    // [m]  casting-field signed distance, trilinear source
    std::vector<LinearRGB> Radiosity {};                    // [-]  outgoing surface radiosity of surface cells
    std::vector<LinearRGB> Albedo    {};                    // [-]  surface albedo of surface cells
    std::vector<Axis3D>    Normal    {};                    // [-]  surface normal of surface cells
    std::vector<uint8_t>   Surface   {};                    // [-]  1 where the scene surface crosses the cell
    std::vector<uint8_t>   SlotStore {};                    // [idx] material slot of each surface cell
    std::vector<LinearRGB> Injected  {};                    // [-]  direct-injection radiosity, kept across exchanges
    std::vector<size_t>    SurfaceList {};                  // [idx] compact surface cell indices

    static float MixScalar(float A, float B, float t) { return A + (B - A) * t; }

    float SampleDistance(const Axis3D& P) const
    {
        const Axis3D G { (P.X - BoundsMin.X) / Cell - 0.5f,
                         (P.Y - BoundsMin.Y) / Cell - 0.5f,
                         (P.Z - BoundsMin.Z) / Cell - 0.5f };
        const int X0 = static_cast<int>(std::floor(G.X));
        const int Y0 = static_cast<int>(std::floor(G.Y));
        const int Z0 = static_cast<int>(std::floor(G.Z));
        const float Fx = G.X - std::floor(G.X), Fy = G.Y - std::floor(G.Y), Fz = G.Z - std::floor(G.Z);
        const int Dm = static_cast<int>(Dim);
        auto At = [&](int X, int Y, int Z)
        {
            X = std::clamp(X, 0, Dm - 1); Y = std::clamp(Y, 0, Dm - 1); Z = std::clamp(Z, 0, Dm - 1);
            return Distance[static_cast<size_t>((Z * Dm + Y) * Dm + X)];
        };
        return MixScalar(MixScalar(MixScalar(At(X0, Y0, Z0), At(X0 + 1, Y0, Z0), Fx),
                                   MixScalar(At(X0, Y0 + 1, Z0), At(X0 + 1, Y0 + 1, Z0), Fx), Fy),
                         MixScalar(MixScalar(At(X0, Y0, Z0 + 1), At(X0 + 1, Y0, Z0 + 1), Fx),
                                   MixScalar(At(X0, Y0 + 1, Z0 + 1), At(X0 + 1, Y0 + 1, Z0 + 1), Fx), Fy), Fz);
    }

    LinearRGB SampleRadiosity(const Axis3D& P) const
    {
        // 📝 Surface-weighted trilinear tap: only cells the scene surface crosses carry radiosity, so the
        //    interpolation never dilutes the store with empty neighbours inside slabs or behind walls
        const Axis3D G { (P.X - BoundsMin.X) / Cell - 0.5f,
                         (P.Y - BoundsMin.Y) / Cell - 0.5f,
                         (P.Z - BoundsMin.Z) / Cell - 0.5f };
        const int X0 = static_cast<int>(std::floor(G.X));
        const int Y0 = static_cast<int>(std::floor(G.Y));
        const int Z0 = static_cast<int>(std::floor(G.Z));
        const float Fx = G.X - std::floor(G.X), Fy = G.Y - std::floor(G.Y), Fz = G.Z - std::floor(G.Z);
        const int Dm = static_cast<int>(Dim);
        LinearRGB Acc {};
        float WSum = 0.0f;
        for (int dZ = 0; dZ < 2; ++dZ)
        for (int dY = 0; dY < 2; ++dY)
        for (int dX = 0; dX < 2; ++dX)
        {
            const int X = std::clamp(X0 + dX, 0, Dm - 1);
            const int Y = std::clamp(Y0 + dY, 0, Dm - 1);
            const int Z = std::clamp(Z0 + dZ, 0, Dm - 1);
            const size_t I = static_cast<size_t>((Z * Dm + Y) * Dm + X);
            if (Surface[I] == 0u) { continue; }
            const float W = (dX ? Fx : 1.0f - Fx) * (dY ? Fy : 1.0f - Fy) * (dZ ? Fz : 1.0f - Fz);
            Acc += Radiosity[I] * W;
            WSum += W;
        }
        return (WSum > 1.0e-5f) ? Acc * (1.0f / WSum) : LinearRGB {};
    }

    Axis3D CellCenter(size_t Index) const
    {
        const uint32_t Z = static_cast<uint32_t>(Index / (static_cast<size_t>(Dim) * Dim));
        const uint32_t Y = static_cast<uint32_t>((Index / Dim) % Dim);
        const uint32_t X = static_cast<uint32_t>(Index % Dim);
        return { BoundsMin.X + (static_cast<float>(X) + 0.5f) * Cell,
                 BoundsMin.Y + (static_cast<float>(Y) + 0.5f) * Cell,
                 BoundsMin.Z + (static_cast<float>(Z) + 0.5f) * Cell };
    }
};

struct ClipmapHierarchy
{
    ClipmapCascade Fine   {};                                // [-] near-field cascade around the occluders
    ClipmapCascade Coarse {};                                // [-] room-wide cascade including the shells

    void Allocate(const Axis3D& FineMin, float FineCell, uint32_t FineDim,
                  const Axis3D& CoarseMin, float CoarseCell, uint32_t CoarseDim)
    {
        Fine.BoundsMin = FineMin; Fine.Cell = FineCell; Fine.Dim = FineDim;
        Coarse.BoundsMin = CoarseMin; Coarse.Cell = CoarseCell; Coarse.Dim = CoarseDim;
        for (auto* C : { &Fine, &Coarse })
        {
            const size_t N = static_cast<size_t>(C->Dim) * C->Dim * C->Dim;
            C->Distance.assign(N, 1.0f);
            C->Radiosity.assign(N, LinearRGB {});
            C->Albedo.assign(N, LinearRGB {});
            C->Normal.assign(N, Axis3D { 0, 0, 1 });
            C->Surface.assign(N, 0u);
            C->SlotStore.assign(N, 0u);
            C->Injected.assign(N, LinearRGB {});
        }
    }

    bool InsideFine(const Axis3D& P, float Margin) const
    {
        const Axis3D Max { Fine.BoundsMin.X + Fine.Cell * static_cast<float>(Fine.Dim),
                           Fine.BoundsMin.Y + Fine.Cell * static_cast<float>(Fine.Dim),
                           Fine.BoundsMin.Z + Fine.Cell * static_cast<float>(Fine.Dim) };
        return P.X > Fine.BoundsMin.X + Margin && P.X < Max.X - Margin &&
               P.Y > Fine.BoundsMin.Y + Margin && P.Y < Max.Y - Margin &&
               P.Z > Fine.BoundsMin.Z + Margin && P.Z < Max.Z - Margin;
    }

    float SampleDistance(const Axis3D& P) const
    {
        return InsideFine(P, Fine.Cell) ? Fine.SampleDistance(P) : Coarse.SampleDistance(P);
    }

    LinearRGB SampleRadiosity(const Axis3D& P) const
    {
        return InsideFine(P, 0.0f) ? Fine.SampleRadiosity(P) : Coarse.SampleRadiosity(P);
    }

    float CellAt(const Axis3D& P) const
    {
        return InsideFine(P, Fine.Cell) ? Fine.Cell : Coarse.Cell;
    }
};

//------------------------------------------------------------------------------------------------------------------------
//                                          SHARED PENUMBRA LAW AND VISIBILITY ORACLES
//------------------------------------------------------------------------------------------------------------------------

struct LuminaireAngles
{
    Axis3D Dir        {};                                    // [-]  unit direction toward orb centre
    float  TanAlpha   = 0.0f;                                // [-]  tangent of the orb angular radius
    float  CosThetaMax = 1.0f;                               // [-]  cosine of the orb angular radius
    float  SolidAngle = 0.0f;                                // [sr] cap solid angle of the orb
    float  EndT       = 0.0f;                                // [m]  march stop just short of the orb surface
};

LuminaireAngles EvaluateLuminaireAngles(const ShowcaseScene& Scene, const Axis3D& P)
{
    LuminaireAngles A {};
    const Axis3D ToS = Scene.Luminaire.Center - P;
    const float Dist = Length(ToS);
    A.Dir = ToS * (1.0f / std::max(Dist, 1.0e-4f));
    const float SinAlpha = std::clamp(Scene.Luminaire.Radius / std::max(Dist, 1.0e-4f), 1.0e-4f, 0.9995f);
    A.CosThetaMax = std::sqrt(std::max(0.0f, 1.0f - SinAlpha * SinAlpha));
    A.TanAlpha = SinAlpha / A.CosThetaMax;
    A.SolidAngle = τ * (1.0f - A.CosThetaMax);
    A.EndT = std::max(0.02f, Dist - Scene.Luminaire.Radius - 0.015f);
    return A;
}

// 📝 The single penumbra law of every deterministic mode: ρ = min_t d(t)/(t·tanα), clamped to [-1,1] and mapped
//    through the exact occluded-disc area fraction, so 5..95 % width equals the geometric disc penumbra span
float EvaluateConePenumbraVisibility(const ShowcaseScene& Scene, const ClipmapHierarchy& Clipmap,
                                     const Axis3D& P, const Axis3D& N, const LuminaireAngles& A, bool UseVoxel)
{
    if (Dot(N, A.Dir) <= 1.0e-4f) { return 0.0f; }
    const Axis3D Origin = P + N * 8.0e-3f;                   // [m] shading offset off the receiver
    float ρ = 2.0f;                                          // [-] running minimum clearance ratio
    float t = 0.03f;                                         // [m] march parameter toward the orb
    for (uint32_t S = 0u; S < 112u && t < A.EndT; ++S)
    {
        const float d = UseVoxel ? Clipmap.SampleDistance(Origin + A.Dir * t)
                                 : EvaluateOccluderDistance(Scene, Origin + A.Dir * t);
        ρ = std::min(ρ, std::clamp(d / (t * A.TanAlpha), -1.0f, 1.0f));
        if (ρ <= -1.0f) { return 0.0f; }
        t += std::clamp(std::fabs(d) * 0.90f, 0.015f, 0.12f);
    }
    const float C = std::clamp(-ρ, -1.0f, 1.0f);             // [-] chord across the apparent orb disc
    return (std::acos(C) - C * std::sqrt(std::max(0.0f, 1.0f - C * C))) / π;
}

float EvaluatePointVisibility(const ShowcaseScene& Scene, const Axis3D& P, const Axis3D& N, const LuminaireAngles& A)
{
    if (Dot(N, A.Dir) <= 0.0f) { return 0.0f; }
    return TraceOccluderBlocked(Scene, P + N * 6.0e-3f, A.Dir, 0.012f, A.EndT) ? 0.0f : 1.0f;
}

// 📝 Cosine-weighted spherical-cap quadrature: unbiased estimator of the visible projected solid angle fraction
float EvaluateCapQuadratureVisibility(const ShowcaseScene& Scene, const Axis3D& P, const Axis3D& N,
                                      const LuminaireAngles& A, uint32_t Samples, uint32_t Key)
{
    if (Dot(N, A.Dir) <= 1.0e-4f) { return 0.0f; }
    const Axis3D TanU = Normalize(Cross(std::fabs(A.Dir.Z) < 0.9f ? Axis3D { 0, 0, 1 } : Axis3D { 1, 0, 0 }, A.Dir));
    const Axis3D BitV = Cross(A.Dir, TanU);
    const Axis3D Origin = P + N * 5.0e-3f;                   // [m] shading offset off the receiver
    float VisSum = 0.0f, WtSum = 0.0f;                       // [-] cosine-weighted visibility accumulators
    for (uint32_t S = 0u; S < Samples; ++S)
    {
        const Axis3D U = EvaluateStratifiedPair(S, Samples, 0u, Key);
        const float CosTheta = 1.0f - U.X * (1.0f - A.CosThetaMax);
        const float SinTheta = std::sqrt(std::max(0.0f, 1.0f - CosTheta * CosTheta));
        const float φ = τ * U.Y;
        const Axis3D Wi = Normalize(TanU * (SinTheta * std::cos(φ)) + BitV * (SinTheta * std::sin(φ)) + A.Dir * CosTheta);
        const float CosN = Dot(N, Wi);
        WtSum += CosN;
        if (!TraceOccluderBlocked(Scene, Origin, Wi, 0.01f, A.EndT)) { VisSum += CosN; }
    }
    return (WtSum > 1.0e-6f) ? (VisSum / WtSum) : 0.0f;
}

// 📝 Cosine-weighted cap quadrature returning the direct irradiance integral itself (mode 4 estimator)
LinearRGB EvaluateCapQuadratureIrradiance(const ShowcaseScene& Scene, const Axis3D& P, const Axis3D& N,
                                          const LuminaireAngles& A, uint32_t Samples, uint32_t Key)
{
    if (Dot(N, A.Dir) <= 1.0e-4f) { return {}; }
    const Axis3D TanU = Normalize(Cross(std::fabs(A.Dir.Z) < 0.9f ? Axis3D { 0, 0, 1 } : Axis3D { 1, 0, 0 }, A.Dir));
    const Axis3D BitV = Cross(A.Dir, TanU);
    const Axis3D Origin = P + N * 5.0e-3f;                   // [m] shading offset off the receiver
    LinearRGB Accum {};
    for (uint32_t S = 0u; S < Samples; ++S)
    {
        const Axis3D U = EvaluateStratifiedPair(S, Samples, 1u, Key);
        const float CosTheta = 1.0f - U.X * (1.0f - A.CosThetaMax);
        const float SinTheta = std::sqrt(std::max(0.0f, 1.0f - CosTheta * CosTheta));
        const float φ = τ * U.Y;
        const Axis3D Wi = Normalize(TanU * (SinTheta * std::cos(φ)) + BitV * (SinTheta * std::sin(φ)) + A.Dir * CosTheta);
        const float CosN = Dot(N, Wi);
        if (CosN <= 0.0f) { continue; }
        if (!TraceOccluderBlocked(Scene, Origin, Wi, 0.01f, A.EndT))
        {
            Accum += Scene.Luminaire.Radiance * (CosN * (A.SolidAngle / static_cast<float>(Samples)));
        }
    }
    return Accum;
}

//------------------------------------------------------------------------------------------------------------------------
//                            LEGACY PENUMBRA FORMULAE (replication of arena/ad7fa01c-frontier)
//------------------------------------------------------------------------------------------------------------------------

// 📝 Byte-faithful replication of SdfEmissivePenumbraSequence.cpp mode 1 (analytic) and modes 2/3 (voxel):
//    per-mode cone scale (×0.86 voxel), per-mode march envelopes and smoothstep(-1,1) instead of the disc fraction
float EvaluateLegacyConePenumbra(const ShowcaseScene& Scene, const ClipmapHierarchy& Clipmap,
                                 const Axis3D& P, const Axis3D& N, const LuminaireAngles& A, bool UseVoxel)
{
    if (Dot(N, A.Dir) <= 1.0e-4f) { return 0.0f; }
    const float TanCone = Scene.Luminaire.Radius /
                          std::max(Scene.Luminaire.Radius + 0.04f, Length(Scene.Luminaire.Center - P));
    const Axis3D Origin = P + N * (UseVoxel ? 1.0e-2f : 8.0e-3f);
    float MinRatio = 2.0f;
    float Travel = UseVoxel ? 0.04f : 0.03f;
    for (uint32_t S = 0u; S < 112u && Travel < A.EndT; ++S)
    {
        const Axis3D SP = Origin + A.Dir * Travel;
        const float d = UseVoxel ? Clipmap.SampleDistance(SP) : EvaluateOccluderDistance(Scene, SP);
        const float ConeR = UseVoxel ? std::max(0.014f, Travel * TanCone * 0.86f)
                                     : std::max(0.008f, Travel * TanCone);
        const float Ratio = std::clamp(d / ConeR, -1.25f, 1.25f);
        MinRatio = SoftMinimum(MinRatio, Ratio, UseVoxel ? 0.10f : 0.08f);
        if (MinRatio <= -1.02f) { return 0.0f; }
        Travel += UseVoxel ? std::clamp(std::fabs(d) * 0.45f, 0.020f, 0.14f)
                           : std::clamp(std::fabs(d) * 0.45f, 0.015f, 0.12f);
    }
    return SmoothHermite01(-1.0f, 1.0f, MinRatio);
}

//------------------------------------------------------------------------------------------------------------------------
//                                                CLIPMAP BAKE AND CONE RADIOSITY
//------------------------------------------------------------------------------------------------------------------------

void BakeClipmapDistances(const ShowcaseScene& Scene, ClipmapHierarchy& Clipmap)
{
    for (auto* C : { &Clipmap.Fine, &Clipmap.Coarse })
    {
        const size_t N = static_cast<size_t>(C->Dim) * C->Dim * C->Dim;
        for (size_t I = 0u; I < N; ++I)
        {
            const Axis3D P = C->CellCenter(I);
            C->Distance[I] = EvaluateOccluderDistance(Scene, P);   // casting field only: shells must not shadow
        }
    }
}

void BakeSurfaceCells(const ShowcaseScene& Scene, ClipmapHierarchy& Clipmap)
{
    for (auto* C : { &Clipmap.Fine, &Clipmap.Coarse })
    {
        const size_t N = static_cast<size_t>(C->Dim) * C->Dim * C->Dim;
        for (size_t I = 0u; I < N; ++I)
        {
            const Axis3D P = C->CellCenter(I);
            uint32_t Slot = 0u;
            const float d = EvaluateSceneDistance(Scene, P, Slot);
            if (std::fabs(d) < 1.2f * C->Cell)
            {
                C->Surface[I] = 1u;
                C->SlotStore[I] = static_cast<uint8_t>(Slot);
                C->Normal[I] = EvaluateSceneNormal(Scene, P);
                C->Albedo[I] = (Slot == 7u) ? LinearRGB {} : EvaluateAlbedoAt(Scene, Slot, P);
                C->SurfaceList.push_back(I);
            }
        }
    }
}

// 📝 Direct injection: cosine-weighted cap quadrature at every surface cell, converted to outgoing radiosity.
//    Orb cells stay black in the store: the cone taps must carry reflected flux only, never the direct source
void BakeDirectInjection(const ShowcaseScene& Scene, ClipmapHierarchy& Clipmap)
{
    for (auto* C : { &Clipmap.Fine, &Clipmap.Coarse })
    {
        for (const size_t I : C->SurfaceList)
        {
            if (C->SlotStore[I] == 7u) { continue; }
            const Axis3D P = C->CellCenter(I);
            const Axis3D Nrm = C->Normal[I];
            const LuminaireAngles A = EvaluateLuminaireAngles(Scene, P);
            const LinearRGB E = EvaluateCapQuadratureIrradiance(Scene, P, Nrm, A, 48u, AvalancheKey32(static_cast<uint32_t>(I)));
            const LinearRGB ρ = C->Albedo[I];
            C->Injected[I] = { ρ.R * E.R / π, ρ.G * E.G / π, ρ.B * E.B / π };
            C->Radiosity[I] = C->Injected[I];
        }
    }
}

// 📝 Hemisphere exchange over fixed golden-spiral cosine directions; marches the analytic scene field so shells,
//    which the casting clipmap deliberately excludes, still contribute their stored radiosity
LinearRGB TraceRadiosityTap(const ShowcaseScene& Scene, const ClipmapHierarchy& Clipmap,
                            const Axis3D& Origin, const Axis3D& Dir)
{
    // 📝 One uniform contact threshold across both cascades: a position-dependent threshold would jump at the
    //    cascade boundary and print a seam into every radiosity exchange and cone tap
    const float HitT = 0.6f * Clipmap.Coarse.Cell;           // [m] contact band of the cone march
    float t = 0.05f;                                         // [m] cone march parameter
    for (uint32_t S = 0u; S < 128u && t < 7.0f; ++S)
    {
        const Axis3D P = Origin + Dir * t;
        uint32_t Slot = 0u;
        const float d = EvaluateSceneDistance(Scene, P, Slot);
        const float Cell = Clipmap.CellAt(P);
        if (d < HitT)
        {
            // 📝 Grazing contacts re-hit the origin plane itself; only front-facing contacts carry flux,
            //    so a shallow dot product steps past the surface instead of tapping the emitter's own radiosity
            if (Dot(EvaluateSceneNormal(Scene, P), Dir) > -0.2f) { t += 0.7f * Cell; continue; }
            return Clipmap.SampleRadiosity(P);
        }
        t += std::max(0.35f * Cell, std::min(d * 0.85f, 0.25f));
    }
    return {};
}

void ExchangeRadiosityPass(const ShowcaseScene& Scene, ClipmapHierarchy& Clipmap)
{
    const float Golden = 2.39996322972865332f;               // [rad] golden angle of the spiral
    for (auto* C : { &Clipmap.Fine, &Clipmap.Coarse })
    {
        std::vector<LinearRGB> Next(C->Radiosity);
        for (const size_t I : C->SurfaceList)
        {
            const Axis3D P = C->CellCenter(I);
            const Axis3D Nrm = C->Normal[I];
            const Axis3D TanU = Normalize(Cross(std::fabs(Nrm.Z) < 0.9f ? Axis3D { 0, 0, 1 } : Axis3D { 1, 0, 0 }, Nrm));
            const Axis3D BitV = Cross(Nrm, TanU);
            LinearRGB E {};
            for (uint32_t k = 0u; k < BakeDirections; ++k)
            {
                const float CosTheta = 1.0f - (static_cast<float>(k) + 0.5f) / static_cast<float>(BakeDirections);
                const float SinTheta = std::sqrt(std::max(0.0f, 1.0f - CosTheta * CosTheta));
                const float φ = Golden * static_cast<float>(k);
                const Axis3D Dir = Normalize(TanU * (SinTheta * std::cos(φ)) + BitV * (SinTheta * std::sin(φ)) + Nrm * CosTheta);
                const LinearRGB B = TraceRadiosityTap(Scene, Clipmap, P + Nrm * 0.02f, Dir);
                E += B * (CosTheta * (τ / static_cast<float>(BakeDirections)));
            }
            const LinearRGB ρ = C->Albedo[I];
            Next[I] = C->Injected[I] + LinearRGB { ρ.R * E.R / π, ρ.G * E.G / π, ρ.B * E.B / π };
        }
        C->Radiosity.swap(Next);
    }
}

LinearRGB EvaluateConeGlobalIrradiance(const ShowcaseScene& Scene, const ClipmapHierarchy& Clipmap,
                                       const Axis3D& P, const Axis3D& N)
{
    const float Golden = 2.39996322972865332f;               // [rad] golden angle of the spiral
    const Axis3D TanU = Normalize(Cross(std::fabs(N.Z) < 0.9f ? Axis3D { 0, 0, 1 } : Axis3D { 1, 0, 0 }, N));
    const Axis3D BitV = Cross(N, TanU);
    LinearRGB E {};
    for (uint32_t k = 0u; k < ConeGiDirs; ++k)
    {
        const float CosTheta = 1.0f - (static_cast<float>(k) + 0.5f) / static_cast<float>(ConeGiDirs);
        const float SinTheta = std::sqrt(std::max(0.0f, 1.0f - CosTheta * CosTheta));
        const float φ = Golden * static_cast<float>(k);
        const Axis3D Dir = Normalize(TanU * (SinTheta * std::cos(φ)) + BitV * (SinTheta * std::sin(φ)) + N * CosTheta);
        const LinearRGB B = TraceRadiosityTap(Scene, Clipmap, P + N * 0.02f, Dir);
        E += B * (CosTheta * (τ / static_cast<float>(ConeGiDirs)));
    }
    return E;
}

//------------------------------------------------------------------------------------------------------------------------
//                                                    MODE RENDERERS
//------------------------------------------------------------------------------------------------------------------------

enum class PenumbraMode : uint32_t
{
    PointSample      = 0u,
    AnalyticCone     = 1u,
    VoxelClipmap     = 2u,
    VoxelConeGi      = 3u,
    HybridCap        = 4u,
    MonteCarloRef    = 5u,
};

struct VisibilityOracle
{
    float Width    = 0.0f;                                   // [m] 5..95 % transect span
    float UmbraMin = 1.0f;                                   // [-] minimum visibility on the transect
};

float EvaluateModeVisibility(PenumbraMode Mode, const ShowcaseScene& Scene, const ClipmapHierarchy& Clipmap,
                             const Axis3D& P, const Axis3D& N, uint32_t Key)
{
    const LuminaireAngles A = EvaluateLuminaireAngles(Scene, P);
    switch (Mode)
    {
        case PenumbraMode::PointSample:   return EvaluatePointVisibility(Scene, P, N, A);
        case PenumbraMode::AnalyticCone:  return EvaluateConePenumbraVisibility(Scene, Clipmap, P, N, A, false);
        case PenumbraMode::VoxelClipmap:
        case PenumbraMode::VoxelConeGi:   return EvaluateConePenumbraVisibility(Scene, Clipmap, P, N, A, true);
        case PenumbraMode::HybridCap:     return EvaluateCapQuadratureVisibility(Scene, P, N, A, CapLobeSpp, Key);
        case PenumbraMode::MonteCarloRef: return EvaluateCapQuadratureVisibility(Scene, P, N, A, ReferenceSpp, Key);
    }
    return 0.0f;
}

uint32_t SlotOfPosition(const ShowcaseScene& Scene, const Axis3D& P);

// 📝 Unbiased Lambert path tracer: cap-quadrature next-event estimate with power-heuristic MIS against cosine
//    continuation, three bounces, no clamps and no Russian roulette
LinearRGB EvaluateMonteCarloPixel(const ShowcaseScene& Scene, const Axis3D& P, const Axis3D& N,
                                  const Axis3D& View, uint32_t Key, uint32_t Spp, bool DirectOnly)
{
    LinearRGB Total {};
    for (uint32_t S = 0u; S < Spp; ++S)
    {
        Axis3D CurP = P, CurN = N;
        LinearRGB Throughput { 1.0f, 1.0f, 1.0f };
        LinearRGB SampleRad {};
        for (uint32_t Bounce = 0u; Bounce < (DirectOnly ? 1u : 3u); ++Bounce)
        {
            const LuminaireAngles A = EvaluateLuminaireAngles(Scene, CurP);
            const LinearRGB ρ = EvaluateAlbedoAt(Scene, SlotOfPosition(Scene, CurP), CurP);
            // ① next-event estimate toward the orb, light pdf 1/Ω, MIS power heuristic against cosine pdf
            if (Dot(CurN, A.Dir) > 1.0e-4f)
            {
            const Axis3D U = EvaluateStratifiedPair(S, Spp, Bounce * 2u + 0u, Key);
                const Axis3D TanU = Normalize(Cross(std::fabs(A.Dir.Z) < 0.9f ? Axis3D { 0, 0, 1 } : Axis3D { 1, 0, 0 }, A.Dir));
                const Axis3D BitV = Cross(A.Dir, TanU);
                const float CosTheta = 1.0f - U.X * (1.0f - A.CosThetaMax);
                const float SinTheta = std::sqrt(std::max(0.0f, 1.0f - CosTheta * CosTheta));
                const float φ = τ * U.Y;
                const Axis3D Wi = Normalize(TanU * (SinTheta * std::cos(φ)) + BitV * (SinTheta * std::sin(φ)) + A.Dir * CosTheta);
                const float CosN = Dot(CurN, Wi);
                if (CosN > 0.0f)
                {
                    const float pLight = 1.0f / A.SolidAngle;
                    const float pBsdf  = CosN / π;
                    const float wLight = (pLight * pLight) / (pLight * pLight + pBsdf * pBsdf);
                    if (!TraceOccluderBlocked(Scene, CurP + CurN * 5.0e-3f, Wi, 0.01f, A.EndT))
                    {
                        const float Weight = CosN * A.SolidAngle * wLight / π;
                        SampleRad += LinearRGB { Throughput.R * ρ.R * Scene.Luminaire.Radiance.R * Weight,
                                                 Throughput.G * ρ.G * Scene.Luminaire.Radiance.G * Weight,
                                                 Throughput.B * ρ.B * Scene.Luminaire.Radiance.B * Weight };
                    }
                }
            }
            if (DirectOnly) { break; }
            // ② cosine continuation; emissive hit carries the power-heuristic BSDF weight, no clamp
            const Axis3D TanC = Normalize(Cross(std::fabs(CurN.Z) < 0.9f ? Axis3D { 0, 0, 1 } : Axis3D { 1, 0, 0 }, CurN));
            const Axis3D BitC = Cross(CurN, TanC);
            const Axis3D Uc = EvaluateStratifiedPair(S, Spp, Bounce * 2u + 1u, Key);
            const float CosTheta = std::sqrt(std::max(0.0f, Uc.X));
            const float SinTheta = std::sqrt(std::max(0.0f, 1.0f - CosTheta * CosTheta));
            const float φ = τ * Uc.Y;
            const Axis3D Wo = Normalize(TanC * (SinTheta * std::cos(φ)) + BitC * (SinTheta * std::sin(φ)) + CurN * CosTheta);
            Axis3D HitP {}, HitN {};
            uint32_t HitSlot = 0u;
            if (!TraceSceneRay(Scene, CurP + CurN * 6.0e-3f, Wo, 16.0f, HitP, HitN, HitSlot)) { break; }
            const float DistOrb = Length(Scene.Luminaire.Center - HitP);
            if (DistOrb <= Scene.Luminaire.Radius + 1.0e-3f)
            {
                const LuminaireAngles Av = EvaluateLuminaireAngles(Scene, CurP);
                const float pBsdf = CosTheta / π;
                const float pLight = 1.0f / Av.SolidAngle;
                const float wBsdf = (pBsdf * pBsdf) / (pBsdf * pBsdf + pLight * pLight);
                SampleRad += LinearRGB { Throughput.R * ρ.R * Scene.Luminaire.Radiance.R * wBsdf,
                                         Throughput.G * ρ.G * Scene.Luminaire.Radiance.G * wBsdf,
                                         Throughput.B * ρ.B * Scene.Luminaire.Radiance.B * wBsdf };
                break;
            }
            Throughput = { Throughput.R * ρ.R, Throughput.G * ρ.G, Throughput.B * ρ.B };
            CurP = HitP; CurN = HitN;
        }
        Total += SampleRad;
        (void)View;
    }
    return Total * (1.0f / static_cast<float>(std::max(1u, Spp)));
}

uint32_t SlotOfPosition(const ShowcaseScene& Scene, const Axis3D& P)
{
    uint32_t Slot = 0u;
    EvaluateSceneDistance(Scene, P, Slot);
    return Slot;
}

LinearRGB ShadeMode(PenumbraMode Mode, const ShowcaseScene& Scene, const ClipmapHierarchy& Clipmap,
                    const Axis3D& P, const Axis3D& N, const Axis3D& View, uint32_t Key)
{
    const LinearRGB ρ = EvaluateAlbedoAt(Scene, SlotOfPosition(Scene, P), P);
    if (Mode == PenumbraMode::MonteCarloRef)
    {
        return EvaluateMonteCarloPixel(Scene, P, N, View, Key, ReferenceSpp, false);
    }
    const LuminaireAngles A = EvaluateLuminaireAngles(Scene, P);
    LinearRGB Hdr {};
    if (Mode == PenumbraMode::HybridCap)
    {
        const LinearRGB E = EvaluateCapQuadratureIrradiance(Scene, P, N, A, CapLobeSpp, Key);
        Hdr = { ρ.R * E.R / π, ρ.G * E.G / π, ρ.B * E.B / π };
    }
    else
    {
        const float V = EvaluateModeVisibility(Mode, Scene, Clipmap, P, N, Key);
        const float CosN = std::max(0.0f, Dot(N, A.Dir));
        const float Sin2 = 1.0f - A.CosThetaMax * A.CosThetaMax;
        const float E = π * Sin2 * CosN * V;                 // [W/m2] exact unoccluded sphere irradiance scaled by V
        Hdr = { ρ.R * E * Scene.Luminaire.Radiance.R / π,
                ρ.G * E * Scene.Luminaire.Radiance.G / π,
                ρ.B * E * Scene.Luminaire.Radiance.B / π };
    }
    if (Mode == PenumbraMode::VoxelConeGi || Mode == PenumbraMode::HybridCap)
    {
        const LinearRGB E = EvaluateConeGlobalIrradiance(Scene, Clipmap, P, N);
        Hdr += LinearRGB { ρ.R * E.R / π, ρ.G * E.G / π, ρ.B * E.B / π };
    }
    return Hdr;
}

//------------------------------------------------------------------------------------------------------------------------
//                                                    TRANSECT PROBE
//------------------------------------------------------------------------------------------------------------------------

VisibilityOracle MeasureFloorTransect(PenumbraMode Mode, const ShowcaseScene& Scene, const ClipmapHierarchy& Clipmap)
{
    //  Scan the floor transect at X = 2.25 m behind the grey sphere, from umbra centre Y = 0.64 m out to Y = 2.45 m
    constexpr uint32_t Samples = 360u;
    constexpr float ScanX = 2.25f, YBegin = 0.64f, YEnd = 2.45f;
    const Axis3D N { 0.0f, 0.0f, 1.0f };
    VisibilityOracle Oracle {};
    float YAt05 = -99.0f, YAt95 = -99.0f;
    for (uint32_t I = 0u; I <= Samples; ++I)
    {
        const float Y = YBegin + (YEnd - YBegin) * (static_cast<float>(I) / static_cast<float>(Samples));
        const float V = EvaluateModeVisibility(Mode, Scene, Clipmap, { ScanX, Y, 0.002f }, N, AvalancheKey32(I + 911u));
        Oracle.UmbraMin = std::min(Oracle.UmbraMin, V);
        if (YAt05 < -50.0f && V >= 0.05f) { YAt05 = Y; }
        if (YAt05 > -50.0f && YAt95 < -50.0f && V >= 0.95f) { YAt95 = Y; }
    }
    const float Step = (YEnd - YBegin) / static_cast<float>(Samples);
    const float Span = (YAt05 > -50.0f && YAt95 >= YAt05) ? (YAt95 - YAt05) : 0.0f;
    Oracle.Width = (Mode == PenumbraMode::PointSample && Span <= Step * 1.5f) ? 0.0f : Span;
    return Oracle;
}

//------------------------------------------------------------------------------------------------------------------------
//                                                    DISPLAY TRANSFER
//------------------------------------------------------------------------------------------------------------------------

float ToneMapChannel(float V)
{
    const float X = std::max(0.0f, V * 0.96f * 0.95f);       // [-] exposure then filmic contraction
    return std::clamp((X * (2.51f * X + 0.03f)) / (X * (2.43f * X + 0.59f) + 0.14f), 0.0f, 1.0f);
}

} // namespace

//------------------------------------------------------------------------------------------------------------------------
//                                                    PNG EMISSION
//------------------------------------------------------------------------------------------------------------------------

namespace
{

struct RasterCanvas
{
    uint32_t Width = 0u, Height = 0u;                        // [px] canvas extent
    std::vector<uint8_t> Pixels {};                         // [idx] row-major RGB triplets

    void Allocate(uint32_t W, uint32_t H)
    {
        Width = W; Height = H;
        Pixels.assign(static_cast<size_t>(W) * H * 3u, 0u);
    }
    void Set(uint32_t X, uint32_t Y, uint8_t R, uint8_t G, uint8_t B)
    {
        if (X >= Width || Y >= Height) { return; }
        const size_t O = (static_cast<size_t>(Y) * Width + X) * 3u;
        Pixels[O] = R; Pixels[O + 1] = G; Pixels[O + 2] = B;
    }
};

uint32_t Crc32Of(const uint8_t* Bytes, size_t Count)
{
    static uint32_t Table[256];
    static bool Ready = false;
    if (!Ready)
    {
        for (uint32_t I = 0u; I < 256u; ++I)
        {
            uint32_t C = I;
            for (uint32_t K = 0u; K < 8u; ++K) { C = (C & 1u) ? (0xEDB88320u ^ (C >> 1)) : (C >> 1); }
            Table[I] = C;
        }
        Ready = true;
    }
    uint32_t C = 0xFFFFFFFFu;
    for (size_t I = 0u; I < Count; ++I) { C = Table[(C ^ Bytes[I]) & 0xFFu] ^ (C >> 8); }
    return C ^ 0xFFFFFFFFu;
}

bool WritePngFile(const RasterCanvas& Canvas, const std::filesystem::path& Path)
{
    std::vector<uint8_t> Raw;
    Raw.reserve(static_cast<size_t>(Canvas.Height) * (static_cast<size_t>(Canvas.Width) * 3u + 1u));
    for (uint32_t Y = 0u; Y < Canvas.Height; ++Y)
    {
        Raw.push_back(0u);
        Raw.insert(Raw.end(), Canvas.Pixels.begin() + static_cast<ptrdiff_t>(static_cast<size_t>(Y) * Canvas.Width * 3u),
                   Canvas.Pixels.begin() + static_cast<ptrdiff_t>(static_cast<size_t>(Y + 1) * Canvas.Width * 3u));
    }
    std::vector<uint8_t> Zlib { 0x78u, 0x01u };
    size_t At = 0u;
    while (At < Raw.size())
    {
        const size_t Chunk = std::min<size_t>(65535u, Raw.size() - At);
        const bool Last = (At + Chunk >= Raw.size());
        Zlib.push_back(Last ? 0x01u : 0x00u);
        Zlib.push_back(static_cast<uint8_t>(Chunk & 0xFFu));
        Zlib.push_back(static_cast<uint8_t>((Chunk >> 8) & 0xFFu));
        Zlib.push_back(static_cast<uint8_t>(~Chunk & 0xFFu));
        Zlib.push_back(static_cast<uint8_t>((~Chunk >> 8) & 0xFFu));
        Zlib.insert(Zlib.end(), Raw.begin() + static_cast<ptrdiff_t>(At), Raw.begin() + static_cast<ptrdiff_t>(At + Chunk));
        At += Chunk;
    }
    uint32_t A = 1u, B = 0u;
    for (const uint8_t Byte : Raw) { A = (A + Byte) % 65521u; B = (B + A) % 65521u; }
    const uint32_t Adler = (B << 16) | A;
    Zlib.push_back(static_cast<uint8_t>(Adler >> 24)); Zlib.push_back(static_cast<uint8_t>((Adler >> 16) & 0xFFu));
    Zlib.push_back(static_cast<uint8_t>((Adler >> 8) & 0xFFu)); Zlib.push_back(static_cast<uint8_t>(Adler & 0xFFu));

    auto Be32 = [](uint32_t V) { return std::vector<uint8_t> { static_cast<uint8_t>(V >> 24), static_cast<uint8_t>((V >> 16) & 0xFFu), static_cast<uint8_t>((V >> 8) & 0xFFu), static_cast<uint8_t>(V & 0xFFu) }; };
    std::vector<uint8_t> Out { 0x89u, 'P', 'N', 'G', '\r', '\n', 0x1Au, '\n' };
    auto PushChunk = [&](const char* Type, const std::vector<uint8_t>& Body)
    {
        std::vector<uint8_t> Len = Be32(static_cast<uint32_t>(Body.size()));
        Out.insert(Out.end(), Len.begin(), Len.end());
        Out.insert(Out.end(), Type, Type + 4);
        Out.insert(Out.end(), Body.begin(), Body.end());
        std::vector<uint8_t> CrcInput { static_cast<uint8_t>(Type[0]), static_cast<uint8_t>(Type[1]), static_cast<uint8_t>(Type[2]), static_cast<uint8_t>(Type[3]) };
        CrcInput.insert(CrcInput.end(), Body.begin(), Body.end());
        const uint32_t Crc = Crc32Of(CrcInput.data(), CrcInput.size());
        std::vector<uint8_t> CrcBytes = Be32(Crc);
        Out.insert(Out.end(), CrcBytes.begin(), CrcBytes.end());
    };
    std::vector<uint8_t> Ihdr = Be32(Canvas.Width);
    const std::vector<uint8_t> HeightBytes = Be32(Canvas.Height);
    Ihdr.insert(Ihdr.end(), HeightBytes.begin(), HeightBytes.end());
    Ihdr.insert(Ihdr.end(), { 8u, 2u, 0u, 0u, 0u });
    PushChunk("IHDR", Ihdr);
    PushChunk("IDAT", Zlib);
    PushChunk("IEND", {});
    std::FILE* F = std::fopen(Path.string().c_str(), "wb");
    if (!F) { return false; }
    std::fwrite(Out.data(), 1u, Out.size(), F);
    std::fclose(F);
    return true;
}

//------------------------------------------------------------------------------------------------------------------------
//                                                    GLYPH RASTER
//------------------------------------------------------------------------------------------------------------------------

constexpr uint8_t GlyphRows[45][7] =
{
    { 0x0E,0x11,0x11,0x1F,0x11,0x11,0x11 }, // A
    { 0x1E,0x11,0x11,0x1E,0x11,0x11,0x1E }, // B
    { 0x0E,0x11,0x10,0x10,0x10,0x11,0x0E }, // C
    { 0x1E,0x11,0x11,0x11,0x11,0x11,0x1E }, // D
    { 0x1F,0x10,0x10,0x1E,0x10,0x10,0x1F }, // E
    { 0x1F,0x10,0x10,0x1E,0x10,0x10,0x10 }, // F
    { 0x0E,0x11,0x10,0x17,0x11,0x11,0x0F }, // G
    { 0x11,0x11,0x11,0x1F,0x11,0x11,0x11 }, // H
    { 0x0E,0x04,0x04,0x04,0x04,0x04,0x0E }, // I
    { 0x07,0x02,0x02,0x02,0x02,0x12,0x0C }, // J
    { 0x11,0x12,0x14,0x18,0x14,0x12,0x11 }, // K
    { 0x10,0x10,0x10,0x10,0x10,0x10,0x1F }, // L
    { 0x11,0x1B,0x15,0x15,0x11,0x11,0x11 }, // M
    { 0x11,0x19,0x15,0x13,0x11,0x11,0x11 }, // N
    { 0x0E,0x11,0x11,0x11,0x11,0x11,0x0E }, // O
    { 0x1E,0x11,0x11,0x1E,0x10,0x10,0x10 }, // P
    { 0x0E,0x11,0x11,0x11,0x15,0x12,0x0D }, // Q
    { 0x1E,0x11,0x11,0x1E,0x14,0x12,0x11 }, // R
    { 0x0F,0x10,0x10,0x0E,0x01,0x01,0x1E }, // S
    { 0x1F,0x04,0x04,0x04,0x04,0x04,0x04 }, // T
    { 0x11,0x11,0x11,0x11,0x11,0x11,0x0E }, // U
    { 0x11,0x11,0x11,0x11,0x11,0x0A,0x04 }, // V
    { 0x11,0x11,0x11,0x15,0x15,0x1B,0x11 }, // W
    { 0x11,0x11,0x0A,0x04,0x0A,0x11,0x11 }, // X
    { 0x11,0x11,0x0A,0x04,0x04,0x04,0x04 }, // Y
    { 0x1F,0x01,0x02,0x04,0x08,0x10,0x1F }, // Z
    { 0x0E,0x11,0x13,0x15,0x19,0x11,0x0E }, // 0
    { 0x04,0x0C,0x04,0x04,0x04,0x04,0x0E }, // 1
    { 0x0E,0x11,0x01,0x02,0x04,0x08,0x1F }, // 2
    { 0x1F,0x02,0x04,0x02,0x01,0x11,0x0E }, // 3
    { 0x02,0x06,0x0A,0x12,0x1F,0x02,0x02 }, // 4
    { 0x1F,0x10,0x1E,0x01,0x01,0x11,0x0E }, // 5
    { 0x06,0x08,0x10,0x1E,0x11,0x11,0x0E }, // 6
    { 0x1F,0x01,0x02,0x04,0x08,0x08,0x08 }, // 7
    { 0x0E,0x11,0x11,0x0E,0x11,0x11,0x0E }, // 8
    { 0x0E,0x11,0x11,0x0F,0x01,0x02,0x0C }, // 9
    { 0x00,0x04,0x04,0x00,0x04,0x04,0x00 }, // :
    { 0x00,0x00,0x00,0x00,0x00,0x0C,0x0C }, // .
    { 0x00,0x00,0x1F,0x00,0x1F,0x00,0x00 }, // =
    { 0x01,0x01,0x02,0x04,0x08,0x10,0x10 }, // /
    { 0x00,0x00,0x00,0x1F,0x00,0x00,0x00 }, // -
    { 0x18,0x19,0x02,0x04,0x08,0x13,0x03 }, // %
    { 0x00,0x04,0x04,0x1F,0x04,0x04,0x00 }, // +
    { 0x08,0x09,0x0A,0x0C,0x0A,0x09,0x08 }, // >
};

int GlyphIndex(char C)
{
    if (C >= 'A' && C <= 'Z') { return C - 'A'; }
    if (C >= '0' && C <= '9') { return 26 + C - '0'; }
    switch (C)
    {
        case ':': return 36; case '.': return 37; case '=': return 38; case '/': return 39;
        case '-': return 40; case '%': return 41; case '+': return 42; case '>': return 43;
        default:  return -1;
    }
}

void DrawText(RasterCanvas& Canvas, int X, int Y, const std::string& Text, uint8_t R, uint8_t G, uint8_t B)
{
    int Cursor = X;
    for (const char C : Text)
    {
        const int I = GlyphIndex(static_cast<char>(std::toupper(static_cast<unsigned char>(C))));
        if (I >= 0)
        {
            for (int Row = 0; Row < 7; ++Row)
            {
                for (int Col = 0; Col < 5; ++Col)
                {
                    if (GlyphRows[I][Row] & (1 << (4 - Col))) { Canvas.Set(Cursor + Col, Y + Row, R, G, B); }
                }
            }
        }
        Cursor += 6;
    }
}

} // namespace

//------------------------------------------------------------------------------------------------------------------------
//                                                            MAIN
//------------------------------------------------------------------------------------------------------------------------

int main(int Argc, char** Argv)
{
    const std::filesystem::path Root = (Argc > 1) ? std::filesystem::path(Argv[1])
                                                  : std::filesystem::path("Exhibits/SdfPenumbraParity");
    std::filesystem::create_directories(Root / "Images");
    std::filesystem::create_directories(Root / "Results");

    ShowcaseScene Scene {};
    BuildCanonicalEmissiveSphereScene(Scene);

    ClipmapHierarchy Clipmap {};
    Clipmap.Allocate({ -1.00f, -0.80f, -0.02f }, 0.042f, 64u,
                     { -2.70f, -0.20f, -0.05f }, 0.090f, 64u);

    std::printf("[stage] baking clipmap distances\n");
    BakeClipmapDistances(Scene, Clipmap);
    std::printf("[stage] tagging surface cells\n");
    BakeSurfaceCells(Scene, Clipmap);
    std::printf("[stage] injecting direct radiosity (%zu fine, %zu coarse surface cells)\n",
                Clipmap.Fine.SurfaceList.size(), Clipmap.Coarse.SurfaceList.size());
    BakeDirectInjection(Scene, Clipmap);
    const uint32_t PassCount = (Argc > 3) ? static_cast<uint32_t>(std::atoi(Argv[3])) : BakePasses;
    for (uint32_t Pass = 0u; Pass < PassCount; ++Pass)
    {
        std::printf("[stage] radiosity exchange pass %u\n", Pass + 1u);
        ExchangeRadiosityPass(Scene, Clipmap);
    }

    //--------------------------------------------------------------------------------------------------------------------
    // 1. TRANSECT PARITY: corrected law versus legacy formulae versus the Monte Carlo oracle
    //--------------------------------------------------------------------------------------------------------------------
    std::printf("[stage] transect probes\n");
    std::array<VisibilityOracle, 6> Oracle {};
    for (uint32_t M = 0u; M < 6u; ++M)
    {
        Oracle[M] = MeasureFloorTransect(static_cast<PenumbraMode>(M), Scene, Clipmap);
    }
    struct LegacyProbe { float Analytic = 0.0f, Voxel = 0.0f; };
    LegacyProbe Legacy {};
    {
        constexpr uint32_t Samples = 360u;
        constexpr float ScanX = 2.25f, YBegin = 0.64f, YEnd = 2.45f;
        const Axis3D N { 0.0f, 0.0f, 1.0f };
        float W[2] = { 0.0f, 0.0f };
        for (int Variant = 0; Variant < 2; ++Variant)
        {
            float Y05 = -99.0f, Y95 = -99.0f;
            for (uint32_t I = 0u; I <= Samples; ++I)
            {
                const float Y = YBegin + (YEnd - YBegin) * (static_cast<float>(I) / static_cast<float>(Samples));
                const Axis3D P { ScanX, Y, 0.002f };
                const LuminaireAngles A = EvaluateLuminaireAngles(Scene, P);
                const float V = EvaluateLegacyConePenumbra(Scene, Clipmap, P, N, A, Variant == 1);
                if (Y05 < -50.0f && V >= 0.05f) { Y05 = Y; }
                if (Y05 > -50.0f && Y95 < -50.0f && V >= 0.95f) { Y95 = Y; }
            }
            W[Variant] = (Y05 > -50.0f && Y95 >= Y05) ? (Y95 - Y05) : 0.0f;
        }
        Legacy.Analytic = W[0]; Legacy.Voxel = W[1];
    }

    //--------------------------------------------------------------------------------------------------------------------
    // 1b. OPTIONAL PROBE: cone-radiosity irradiance versus reference indirect split at hand-picked receivers
    //--------------------------------------------------------------------------------------------------------------------
    if (Argc > 2 && std::string(Argv[2]) == "taps")
    {
        const Axis3D P { -2.63f, 1.00f, 1.20f };
        const Axis3D Nrm = EvaluateSceneNormal(Scene, P);
        const float Golden = 2.39996322972865332f;
        const Axis3D TanU = Normalize(Cross(std::fabs(Nrm.Z) < 0.9f ? Axis3D { 0, 0, 1 } : Axis3D { 1, 0, 0 }, Nrm));
        const Axis3D BitV = Cross(Nrm, TanU);
        for (uint32_t k = 0u; k < ConeGiDirs; ++k)
        {
            const float CosTheta = 1.0f - (static_cast<float>(k) + 0.5f) / static_cast<float>(ConeGiDirs);
            const float SinTheta = std::sqrt(std::max(0.0f, 1.0f - CosTheta * CosTheta));
            const float φ = Golden * static_cast<float>(k);
            const Axis3D Dir = Normalize(TanU * (SinTheta * std::cos(φ)) + BitV * (SinTheta * std::sin(φ)) + Nrm * CosTheta);
            float t = 0.05f; Axis3D HitP {}; bool Hit = false;
            for (uint32_t S = 0u; S < 96u && t < 7.0f; ++S)
            {
                const Axis3D Q = P + Nrm * 0.02f + Dir * t;
                uint32_t Slot = 0u;
                const float d = EvaluateSceneDistance(Scene, Q, Slot);
                const float Cell = Clipmap.CellAt(Q);
                if (d < 0.6f * Cell) { HitP = Q; Hit = true; break; }
                t += std::max(0.35f * Cell, std::min(d * 0.85f, 0.25f));
            }
            if (!Hit) { std::printf("tap k=%u cos=%.3f miss\n", k, CosTheta); continue; }
            const LinearRGB B = Clipmap.SampleRadiosity(HitP);
            const Axis3D HN = EvaluateSceneNormal(Scene, HitP);
            const uint32_t HSlot = SlotOfPosition(Scene, HitP);
            const LinearRGB ρh = EvaluateAlbedoAt(Scene, HSlot, HitP);
            const LinearRGB Full = EvaluateMonteCarloPixel(Scene, HitP, HN, HN, 777u, ReferenceSpp, false);
            const LinearRGB DirO = EvaluateMonteCarloPixel(Scene, HitP, HN, HN, 777u, ReferenceSpp, true);
            std::printf("tap k=%u cos=%.3f hit (%.2f, %.2f, %.2f) slot=%u storeB=(%.3f, %.3f, %.3f) trueB=(%.3f, %.3f, %.3f)\n",
                        k, CosTheta, HitP.X, HitP.Y, HitP.Z, HSlot, B.R, B.G, B.B,
                        (Full.R - DirO.R) * π / std::max(ρh.R, 1e-3f), (Full.G - DirO.G) * π / std::max(ρh.G, 1e-3f), (Full.B - DirO.B) * π / std::max(ρh.B, 1e-3f));
        }
        return 0;
    }
    if (Argc > 2 && std::string(Argv[2]) == "store")
    {
        for (const auto* C : { &Clipmap.Fine, &Clipmap.Coarse })
        {
            float MaxB = 0.0f; size_t MaxI = 0; double Sum = 0.0;
            for (const size_t I : C->SurfaceList)
            {
                const float B = C->Radiosity[I].R;
                Sum += B;
                if (B > MaxB) { MaxB = B; MaxI = I; }
            }
            const Axis3D Mp = C->CellCenter(MaxI);
            std::printf("store cascade cell=%.3f surfaceCells=%zu meanB=%.4f maxB=%.4f at (%.2f, %.2f, %.2f) slot=%u\n",
                        C->Cell, C->SurfaceList.size(), Sum / static_cast<double>(std::max<size_t>(1, C->SurfaceList.size())),
                        MaxB, Mp.X, Mp.Y, Mp.Z, C->SlotStore[MaxI]);
        }
        const Axis3D P { 0.90f, 1.20f, 0.002f };
        const Axis3D Nrm { 0, 0, 1 };
        const float Golden = 2.39996322972865332f;
        const Axis3D TanU = Normalize(Cross(Axis3D { 1, 0, 0 }, Nrm));
        const Axis3D BitV = Cross(Nrm, TanU);
        for (uint32_t k = 0u; k < ConeGiDirs; ++k)
        {
            const float CosTheta = 1.0f - (static_cast<float>(k) + 0.5f) / static_cast<float>(ConeGiDirs);
            const float SinTheta = std::sqrt(std::max(0.0f, 1.0f - CosTheta * CosTheta));
            const float φ = Golden * static_cast<float>(k);
            const Axis3D Dir = Normalize(TanU * (SinTheta * std::cos(φ)) + BitV * (SinTheta * std::sin(φ)) + Nrm * CosTheta);
            const LinearRGB B = TraceRadiosityTap(Scene, Clipmap, P + Nrm * 0.02f, Dir);
            std::printf("tap k=%u cos=%.3f B=(%.3f, %.3f, %.3f)\n", k, CosTheta, B.R, B.G, B.B);
        }
        return 0;
    }
    if (Argc > 2 && std::string(Argv[2]) == "probe")
    {
        const Axis3D Probes[6] = { { 0.90f, 1.20f, 0.002f }, { 2.25f, 0.90f, 0.002f }, { -1.50f, 1.60f, 0.002f },
                                   { 0.00f, 2.61f, 1.40f },  { -2.63f, 1.00f, 1.20f },  { -0.50f, 0.20f, 1.69f } };
        for (const Axis3D& P : Probes)
        {
            const Axis3D Nrm = EvaluateSceneNormal(Scene, P);
            const uint32_t Slot = SlotOfPosition(Scene, P);
            const LinearRGB ρ = EvaluateAlbedoAt(Scene, Slot, P);
            const LinearRGB Cone = EvaluateConeGlobalIrradiance(Scene, Clipmap, P, Nrm);
            const LinearRGB Full = EvaluateMonteCarloPixel(Scene, P, Nrm, Nrm, 4242u, ReferenceSpp, false);
            const LinearRGB Dir  = EvaluateMonteCarloPixel(Scene, P, Nrm, Nrm, 4242u, ReferenceSpp, true);
            std::printf("probe (%.2f, %.2f, %.2f) cone GI irrad (%.3f, %.3f, %.3f) vs PT indirect x pi/rho (%.3f, %.3f, %.3f)\n",
                        P.X, P.Y, P.Z,
                        Cone.R, Cone.G, Cone.B,
                        (Full.R - Dir.R) * π / std::max(ρ.R, 1e-3f), (Full.G - Dir.G) * π / std::max(ρ.G, 1e-3f), (Full.B - Dir.B) * π / std::max(ρ.B, 1e-3f));
        }
        return 0;
    }

    //--------------------------------------------------------------------------------------------------------------------
    // 2. PANEL RENDER: six modes at 480x270 plus the direct-only Monte Carlo split for the no-GI gates
    //--------------------------------------------------------------------------------------------------------------------
    std::printf("[stage] rendering six panels at %ux%u\n", PanelWidthPx, PanelHeightPx);
    const Axis3D Eye    { -0.10f, -3.55f, 1.48f };           // [m] camera eye
    const Axis3D Target { -0.04f,  0.42f, 0.96f };           // [m] camera aim
    const float  FovRad = 0.78f;                             // [rad] vertical field of view
    const Axis3D Fwd = Normalize(Target - Eye);
    const Axis3D Right = Normalize(Cross(Fwd, Axis3D { 0, 0, 1 }));
    const Axis3D Up = Cross(Right, Fwd);
    const float TanHalf = std::tan(0.5f * FovRad);
    const float Aspect = static_cast<float>(PanelWidthPx) / static_cast<float>(PanelHeightPx);

    std::array<std::vector<LinearRGB>, 6> Panels {};
    std::vector<LinearRGB> DirectOnlyRef {};
    for (auto& P : Panels) { P.assign(static_cast<size_t>(PanelWidthPx) * PanelHeightPx, LinearRGB {}); }
    DirectOnlyRef.assign(static_cast<size_t>(PanelWidthPx) * PanelHeightPx, LinearRGB {});

    const auto RenderBand = [&](uint32_t ModeIndex, uint32_t Y0, uint32_t Y1)
    {
        const PenumbraMode Mode = static_cast<PenumbraMode>(ModeIndex);
        for (uint32_t PY = Y0; PY < Y1; ++PY)
        {
            const float NdcY = 1.0f - 2.0f * ((static_cast<float>(PY) + 0.5f) / static_cast<float>(PanelHeightPx));
            for (uint32_t PX = 0u; PX < PanelWidthPx; ++PX)
            {
                const float NdcX = 2.0f * ((static_cast<float>(PX) + 0.5f) / static_cast<float>(PanelWidthPx)) - 1.0f;
                const Axis3D Dir = Normalize(Fwd + Right * (NdcX * Aspect * TanHalf) + Up * (NdcY * TanHalf));
                Axis3D HitP {}, HitN {};
                uint32_t Slot = 0u;
                const size_t Off = static_cast<size_t>(PY) * PanelWidthPx + PX;
                const uint32_t Key = AvalancheKey32(PX * 1973u + PY * 9277u + 0x68BC21EBu);
                if (!TraceSceneRay(Scene, Eye, Dir, 16.0f, HitP, HitN, Slot))
                {
                    Panels[ModeIndex][Off] = { 0.002f, 0.002f, 0.003f };
                    continue;
                }
                if (Slot == 7u)
                {
                    Panels[ModeIndex][Off] = Scene.Luminaire.Radiance;
                    continue;
                }
                const Axis3D View = Dir * -1.0f;
                Panels[ModeIndex][Off] = ShadeMode(Mode, Scene, Clipmap, HitP, HitN, View, Key);
            }
        }
    };

    for (uint32_t M = 0u; M < 6u; ++M)
    {
        std::printf("[stage] panel %u\n", M);
        std::thread Lower(RenderBand, M, 0u, PanelHeightPx / 2u);
        RenderBand(M, PanelHeightPx / 2u, PanelHeightPx);
        Lower.join();
    }
    {
        std::printf("[stage] direct-only Monte Carlo split\n");
        const auto DirectBand = [&](uint32_t Y0, uint32_t Y1)
        {
            for (uint32_t PY = Y0; PY < Y1; ++PY)
            {
                const float NdcY = 1.0f - 2.0f * ((static_cast<float>(PY) + 0.5f) / static_cast<float>(PanelHeightPx));
                for (uint32_t PX = 0u; PX < PanelWidthPx; ++PX)
                {
                    const float NdcX = 2.0f * ((static_cast<float>(PX) + 0.5f) / static_cast<float>(PanelWidthPx)) - 1.0f;
                    const Axis3D Dir = Normalize(Fwd + Right * (NdcX * Aspect * TanHalf) + Up * (NdcY * TanHalf));
                    Axis3D HitP {}, HitN {};
                    uint32_t Slot = 0u;
                    const size_t Off = static_cast<size_t>(PY) * PanelWidthPx + PX;
                    const uint32_t Key = AvalancheKey32(PX * 1973u + PY * 9277u + 0x68BC21EBu);
                    if (!TraceSceneRay(Scene, Eye, Dir, 16.0f, HitP, HitN, Slot)) { DirectOnlyRef[Off] = { 0.002f, 0.002f, 0.003f }; continue; }
                    if (Slot == 7u) { DirectOnlyRef[Off] = Scene.Luminaire.Radiance; continue; }
                    DirectOnlyRef[Off] = EvaluateMonteCarloPixel(Scene, HitP, HitN, Dir * -1.0f, Key, ReferenceSpp, true);
                }
            }
        };
        std::thread Lower(DirectBand, 0u, PanelHeightPx / 2u);
        DirectBand(PanelHeightPx / 2u, PanelHeightPx);
        Lower.join();
    }

    //--------------------------------------------------------------------------------------------------------------------
    // 3. PARITY METRICS
    //--------------------------------------------------------------------------------------------------------------------
    auto RmseAgainst = [&](const std::vector<LinearRGB>& Candidate, const std::vector<LinearRGB>& Reference)
    {
        double Sum = 0.0; size_t Count = 0;
        for (size_t I = 0u; I < Candidate.size(); ++I)
        {
            const LinearRGB& R = Reference[I];
            if (std::max({ R.R, R.G, R.B }) > 4.0f) { continue; }   // orb pixels excluded, same rule as the legacy harness
            const LinearRGB& C = Candidate[I];
            const double DR = ToneMapChannel(C.R) - ToneMapChannel(R.R);
            const double DG = ToneMapChannel(C.G) - ToneMapChannel(R.G);
            const double DB = ToneMapChannel(C.B) - ToneMapChannel(R.B);
            Sum += (DR * DR + DG * DG + DB * DB) / 3.0;
            ++Count;
        }
        return std::sqrt(Sum / static_cast<double>(std::max<size_t>(Count, 1u)));
    };
    const double Rmse1 = RmseAgainst(Panels[1], DirectOnlyRef);
    const double Rmse2 = RmseAgainst(Panels[2], DirectOnlyRef);
    const double Rmse0 = RmseAgainst(Panels[0], DirectOnlyRef);
    const double Rmse3 = RmseAgainst(Panels[3], Panels[5]);
    const double Rmse4 = RmseAgainst(Panels[4], Panels[5]);

    const float RefWidth = Oracle[5].Width;
    std::string GateLog;
    bool AllPass = true;
    auto Gate = [&](bool Ok, const std::string& Label)
    {
        GateLog += (Ok ? "[PASS] " : "[FAIL] ") + Label + "\n";
        std::printf("%s %s\n", Ok ? "[PASS]" : "[FAIL]", Label.c_str());
        AllPass = AllPass && Ok;
    };
    Gate(Oracle[0].Width == 0.0f, "point-sample mode keeps zero penumbra width");
    Gate(std::fabs(Oracle[1].Width - RefWidth) <= 0.10f * RefWidth, "analytic cone width within 10% of Monte Carlo width");
    Gate(std::fabs(Oracle[2].Width - RefWidth) <= 0.10f * RefWidth, "voxel clipmap width within 10% of Monte Carlo width");
    Gate(std::fabs(Oracle[4].Width - RefWidth) <= 0.15f * RefWidth, "spherical-cap width within 15% of Monte Carlo width");
    Gate(Oracle[1].UmbraMin <= 0.02f && Oracle[2].UmbraMin <= 0.02f, "deep umbra retained by both deterministic modes");
    Gate(Rmse1 <= 0.020, "analytic cone panel within 0.020 tonemapped RMSE of direct-only Monte Carlo");
    Gate(Rmse2 <= 0.025, "voxel clipmap panel within 0.025 tonemapped RMSE of direct-only Monte Carlo");
    Gate(Rmse3 <= 0.035, "cone-radiosity panel within 0.035 tonemapped RMSE of full Monte Carlo");
    Gate(Rmse4 <= 0.045, "spherical-cap panel within 0.045 tonemapped RMSE of full Monte Carlo");
    std::printf("[INFO] legacy replication split analytic-vs-voxel = %.3f m (corrected split = %.3f m)\n",
                std::fabs(Legacy.Analytic - Legacy.Voxel), std::fabs(Oracle[1].Width - Oracle[2].Width));

    //--------------------------------------------------------------------------------------------------------------------
    // 4. PROOF SHEET
    //--------------------------------------------------------------------------------------------------------------------
    constexpr uint32_t LabelBandPx = 14u, HeaderBandPx = 24u, FooterBandPx = 26u;
    const uint32_t SheetW = PanelWidthPx * 3u;
    const uint32_t SheetH = HeaderBandPx + 2u * (LabelBandPx + PanelHeightPx) + FooterBandPx;
    RasterCanvas Sheet {};
    Sheet.Allocate(SheetW, SheetH);
    DrawText(Sheet, 6, 8, "PROOF 11 PARITY: EMISSIVE SPHERE ONLY - SHARED PENUMBRA LAW + CONE RADIOSITY VS MC PT REF (96 SPP)", 255, 255, 255);
    static const char* Labels[6] = {
        "0. POINT-SAMPLE SDF (NO PENUMBRA)",
        "1. ANALYTIC SDF CONE PENUMBRA",
        "2. VOXEL SDF CLIPMAP PENUMBRA",
        "3. VOXEL SDF PENUMBRA + CONE GI",
        "4. HYBRID SDF + SOBOL SPHERICAL CAP",
        "5. SDF MONTE CARLO PT REF (96 SPP)",
    };
    for (uint32_t M = 0u; M < 6u; ++M)
    {
        const uint32_t Col = M % 3u, Row = M / 3u;
        const uint32_t X0 = Col * PanelWidthPx;
        const uint32_t Y0 = HeaderBandPx + Row * (LabelBandPx + PanelHeightPx);
        DrawText(Sheet, static_cast<int>(X0) + 4, static_cast<int>(Y0) + 4, Labels[M], 102, 255, 153);
        for (uint32_t PY = 0u; PY < PanelHeightPx; ++PY)
        {
            for (uint32_t PX = 0u; PX < PanelWidthPx; ++PX)
            {
                const LinearRGB& C = Panels[M][static_cast<size_t>(PY) * PanelWidthPx + PX];
                Sheet.Set(X0 + PX, Y0 + LabelBandPx + PY,
                          static_cast<uint8_t>(ToneMapChannel(C.R) * 255.0f),
                          static_cast<uint8_t>(ToneMapChannel(C.G) * 255.0f),
                          static_cast<uint8_t>(ToneMapChannel(C.B) * 255.0f));
            }
        }
    }
    char Footer1[256], Footer2[256];
    std::snprintf(Footer1, sizeof(Footer1),
                  "PENUMBRA WIDTH M: POINT=0.000 AN=%.3f VOX=%.3f HYB=%.3f PT=%.3f | LEGACY AN=%.3f VOX=%.3f",
                  Oracle[1].Width, Oracle[2].Width, Oracle[4].Width, RefWidth, Legacy.Analytic, Legacy.Voxel);
    std::snprintf(Footer2, sizeof(Footer2),
                  "RMSE VS PT: M1=%.4f M2=%.4f (DIRECT PT) M3=%.4f M4=%.4f | UMBRA %.2f/%.2f | GATES %s",
                  Rmse1, Rmse2, Rmse3, Rmse4, Oracle[1].UmbraMin, Oracle[2].UmbraMin, AllPass ? "PASS" : "FAIL");
    const uint32_t FY = SheetH - FooterBandPx + 4u;
    DrawText(Sheet, 6, static_cast<int>(FY), Footer1, 255, 255, 255);
    DrawText(Sheet, 6, static_cast<int>(FY) + 10, Footer2, 255, 255, 255);
    WritePngFile(Sheet, Root / "Images" / "Proof11ParitySheet.png");

    //--------------------------------------------------------------------------------------------------------------------
    // 5. PARITY REPORT
    //--------------------------------------------------------------------------------------------------------------------
    std::string Report;
    Report += "SDF penumbra parity capture - PROOF 11 emissive-sphere showcase\n";
    Report += "scene: canonical orb (-1.38, 0.48, 1.02) r=0.40 radiance (19.5, 17.2, 13.8); column, pedestal, torus, grey sphere; cornell shells\n";
    Report += "camera: eye (-0.10, -3.55, 1.48) target (-0.04, 0.42, 0.96) vfov 0.78 rad; panels 480x270; reference 96 spp\n";
    Report += "clipmap: fine 64^3 @ 0.042 m + coarse 64^3 @ 0.090 m; casting-field distances; 1 radiosity exchange pass\n\n";
    Report += "mode | penumbra width [m] | umbra min | tonemapped RMSE vs reference\n";
    const char* Names[6] = { "0 point-sample", "1 analytic cone", "2 voxel clipmap", "3 voxel + cone GI", "4 sobol cap", "5 MC PT ref" };
    const double Rmses[6] = { Rmse0, Rmse1, Rmse2, Rmse3, Rmse4, 0.0 };
    for (uint32_t M = 0u; M < 6u; ++M)
    {
        char Line[192];
        std::snprintf(Line, sizeof(Line), "%-16s | %18.3f | %9.3f | %.4f (%s)\n", Names[M], Oracle[M].Width,
                      Oracle[M].UmbraMin, Rmses[M], M <= 2 ? "vs direct-only PT" : "vs full PT");
        Report += Line;
    }
    char Line[256];
    std::snprintf(Line, sizeof(Line), "\nlegacy replication (arena/ad7fa01c-frontier formulae): analytic %.3f m vs voxel %.3f m (split %.3f m)\n",
                  Legacy.Analytic, Legacy.Voxel, std::fabs(Legacy.Analytic - Legacy.Voxel));
    Report += Line;
    Report += "\ngates:\n" + GateLog;
    Report += "\nverdict: " + std::string(AllPass ? "all parity gates pass" : "parity gates FAILED") + "\n";
    std::FILE* F = std::fopen((Root / "Results" / "ParityReport.txt").string().c_str(), "wb");
    if (F) { std::fwrite(Report.data(), 1u, Report.size(), F); std::fclose(F); }
    std::printf("%s", Report.c_str());
    return AllPass ? 0 : 2;
}
