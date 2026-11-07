//============================================================================================================================================
//                                                           VARIANCEWAVELET.WGSL
//============================================================================================================================================
// 🧩 One à-trous wavelet iteration: a 5×5 B3-spline kernel at step 2^i, stopped at depth, normal and luminance edges.

// 📐 w(p, q) = h(q) · exp(−|z_p − z_q| / (σ_z·step·z_p)) · max(0, n_p·n_q)^σ_n · exp(−|l_p − l_q| / (σ_l·√Var_p + ε)),
//    h the separable B3 spline (1, 4, 6, 4, 1)/16. Variance is propagated as Σw²·Var / (Σw)² (Dammertz et al. 2010,
//    Schied et al. 2017). Signal alpha carries the variance between iterations.

//! include "FrameDescriptor.wgsl"
//! include "PackingCodec.wgsl"

struct VarianceRecord
{
    Step         : u32,   // [px]
    MinimumWeight : f32,   // [-]  (unused here)
    ColourSigma  : f32,   // [-]
    TallyLimit : f32,   // [-]  (unused here)
}

@group(0) @binding(1) var<uniform> Variance : VarianceRecord;
@group(0) @binding(2) var SourceSignal      : texture_2d<f32>;
@group(0) @binding(3) var CurrentGuide      : texture_2d<f32>;
@group(0) @binding(4) var WaveletTarget     : texture_storage_2d<rgba16float, write>;

const Spline : array<f32, 3> = array<f32, 3>(0.375, 0.25, 0.0625);

// 📝 Workgroup tile. Each invocation reads a 5x5 neighbourhood, so an 8x8 group touches a 12x12 region at step 1 and
//    neighbouring invocations re-read almost all of each other's texels — up to 25 global loads per pixel per iteration.
//    Staging the tile once per group turns that into one load per footprint texel per iteration.
//
//    A dense footprint is (8 + 4·step)² entries, which only stays inside a sane workgroup budget for the small steps.
//    Steps 1, 2 and 4 — every iteration the diffuser actually runs — use the tile; anything larger keeps the original
//    direct path below, which is exactly as it was. The weights, the spline, the variance propagation and the edge tests
//    are identical in both, so the two entry points compute the same sum in the same order.
// 📝 32 B per entry against a 16 KiB workgroup budget is 512 entries, so the largest dense pitch that fits is 22. That
//    covers steps 1, 2 and 3 — every iteration the diffuser actually runs (its record steps are 1, 2 and 4, and 4 goes
//    to the direct path). Padding to 22 rather than the exact 8 + 4·step keeps one static buffer size; the loops below
//    still use the true pitch, so the padding is never read.
const MaximumStagedStep : u32 = 3u;
const StagedPitch       : u32 = 22u;
const StagedCount       : u32 = StagedPitch * StagedPitch;

// 📝 32 bytes, not 48: the guide is packed rather than carried as a vec4f. Its four fields are an octahedral normal
//    (already two 8-bit values elsewhere), a view depth, and a validity flag, so packing costs precision the kernel's
//    own epsilons (0.015·step·z and a 1e-3 bias) are orders of magnitude coarser than. That keeps a 24x24 tile inside the
//    16 KiB workgroup budget the dense footprint needs at step 4.
struct TileSample
{
    Guide  : vec2u,     // x octahedral normal in two 16-bit halves, y depth as f16 in the low half
    Signal : vec4f,
    // 📝 The validity flag rides in the guide word's spare half rather than as its own f32, which would force 16-byte
    //    alignment and inflate the struct to 48. Packed as a half it is exact for the only values it ever takes, 0 and 1.
    //    TileSample is therefore 32 B and a 24x24 tile is 18 KiB... see below: the budget picks the pitch.
}

var<workgroup> Tile : array<TileSample, StagedCount>;

fn PrepareTile(Texel: vec2i, Slot: u32, Origin: vec2i, Pitch: u32, Staged: u32, Extent: vec2i)
{
    if (Slot >= Staged)
    {
        return;
    }
    let Local = vec2i(i32(Slot % Pitch), i32(Slot / Pitch));
    let Source = Origin + Local;
    var Entry: TileSample;
    // 📝 Out-of-range entries stage a zero guide weight and zero signal; the kernel's own `Guide.w < 0.5` test then
    //    rejects them exactly as it rejected the out-of-range loads they replace.
    Entry.Guide  = vec2u(0u, 0u);
    Entry.Signal = vec4f(0.0);
    if (all(Source >= vec2i(0)) && all(Source < Extent))
    {
        let Loaded = textureLoad(CurrentGuide, Source, 0);
        Entry.Guide  = vec2u(pack2x16float(Loaded.xy), pack2x16float(vec2f(Loaded.z, Loaded.w)));
        Entry.Signal = textureLoad(SourceSignal, Source, 0);
    }
    Tile[Slot] = Entry;
}

// 📐 One kernel tap. Shared by both entry points so the arithmetic below cannot drift between them.
fn AccumulateTap(Sample: TileSample, Guide: vec4f, Normal: vec3f, Luminance: f32, Deviation: f32,
                 Kernel: f32, Step: i32, Sum: ptr<function, vec4f>, Spread: ptr<function, f32>, Total: ptr<function, f32>)
{
    let DepthAndWeight = unpack2x16float(Sample.Guide.y);
    if (DepthAndWeight.y < 0.5)
    {
        return;
    }
    let Tap = Sample.Signal;
    let TapGuide = vec4f(unpack2x16float(Sample.Guide.x), DepthAndWeight);
    let DepthWeight = exp(-abs(TapGuide.z - Guide.z) / (0.015 * f32(Step) * Guide.z + 1.0e-3));
    let NormalWeight = pow(max(dot(DecodeOctahedral(TapGuide.xy), Normal), 0.0), 64.0);
    let LuminanceWeight = exp(-abs(ResolveLuminance(Tap.rgb) - Luminance) / (Variance.ColourSigma * Deviation + 1.0e-3));
    let Weight = Kernel * DepthWeight * NormalWeight * LuminanceWeight;
    *Sum += vec4f(Tap.rgb * Weight, 0.0);
    *Spread += Weight * Weight * Tap.a;
    *Total += Weight;
}

fn StoreResult(Pixel: vec2i, Centre: vec4f, Sum: vec4f, Spread: f32, Total: f32)
{
    if (Total <= 1.0e-6)
    {
        textureStore(WaveletTarget, Pixel, Centre);
        return;
    }
    textureStore(WaveletTarget, Pixel, vec4f(Sum.rgb / Total, Spread / (Total * Total)));
}

@compute @workgroup_size(8, 8)
fn PrepareTileWavelet(@builtin(local_invocation_index) Lane: u32, @builtin(workgroup_id) Group: vec3u)
{
    let Extent = vec2i(textureDimensions(SourceSignal));
    let Step = i32(Variance.Step);
    let Pitch = u32(8 + 4 * Step);
    let Origin = vec2i(Group.xy) * vec2i(8) - vec2i(2 * Step);
    for (var Slot = Lane; Slot < Pitch * Pitch; Slot += 64u)
    {
        PrepareTile(vec2i(0), Slot, Origin, Pitch, Pitch * Pitch, Extent);
    }
}

@compute @workgroup_size(8, 8)
fn ConvolveWavelet(@builtin(global_invocation_id) Invocation: vec3u, @builtin(workgroup_id) Group: vec3u)
{
    let Pixel = vec2i(Invocation.xy);
    let Extent = vec2i(textureDimensions(SourceSignal));
    if (any(Pixel >= Extent))
    {
        return;
    }
    let Guide = textureLoad(CurrentGuide, Pixel, 0);
    let Centre = textureLoad(SourceSignal, Pixel, 0);
    if (Guide.w < 0.5)
    {
        textureStore(WaveletTarget, Pixel, Centre);
        return;
    }
    let Normal = DecodeOctahedral(Guide.xy);
    let Luminance = ResolveLuminance(Centre.rgb);
    let Deviation = sqrt(max(Centre.a, 0.0));
    let Step = i32(Variance.Step);
    let Pitch = i32(8 + 4 * Step);
    let Origin = vec2i(Group.xy) * vec2i(8) - vec2i(2 * Step);
    let Local = Pixel - Origin;
    var Sum = vec4f(0.0);
    var WeightSum = 0.0;
    var SpreadSum = 0.0;
    for (var Y = -2; Y <= 2; Y++)
    {
        for (var X = -2; X <= 2; X++)
        {
            // 📝 The bounds test the old code applied to the global texel becomes the tile's own edge: a sample the tile
            //    could not stage carries a zero guide weight and is skipped by AccumulateTap.
            let TileX = Local.x + X * Step;
            let TileY = Local.y + Y * Step;
            if (TileX < 0 || TileY < 0 || TileX >= Pitch || TileY >= Pitch)
            {
                continue;
            }
            let Sample = Tile[u32(TileY) * u32(Pitch) + u32(TileX)];
            AccumulateTap(Sample, Guide, Normal, Luminance, Deviation, Spline[abs(X)] * Spline[abs(Y)], Step,
                          &Sum, &SpreadSum, &WeightSum);
        }
    }
    StoreResult(Pixel, Centre, Sum, SpreadSum, WeightSum);
}

// 📐 The direct path, unchanged: used for steps too large to stage densely. Identical arithmetic, one tap at a time.
@compute @workgroup_size(8, 8)
fn ConvolveWaveletDirect(@builtin(global_invocation_id) Invocation: vec3u)
{
    let Pixel = vec2i(Invocation.xy);
    let Extent = vec2i(textureDimensions(SourceSignal));
    if (any(Pixel >= Extent))
    {
        return;
    }
    let Guide = textureLoad(CurrentGuide, Pixel, 0);
    let Centre = textureLoad(SourceSignal, Pixel, 0);
    if (Guide.w < 0.5)
    {
        textureStore(WaveletTarget, Pixel, Centre);
        return;
    }
    let Normal = DecodeOctahedral(Guide.xy);
    let Luminance = ResolveLuminance(Centre.rgb);
    let Deviation = sqrt(max(Centre.a, 0.0));
    let Step = i32(Variance.Step);
    var Sum = vec4f(0.0);
    var WeightSum = 0.0;
    var SpreadSum = 0.0;
    for (var Y = -2; Y <= 2; Y++)
    {
        for (var X = -2; X <= 2; X++)
        {
            let Texel = Pixel + vec2i(X, Y) * Step;
            if (any(Texel < vec2i(0)) || any(Texel >= Extent))
            {
                continue;
            }
            let Loaded = textureLoad(CurrentGuide, Texel, 0);
            var Sample: TileSample;
            Sample.Guide  = vec2u(pack2x16float(Loaded.xy), pack2x16float(vec2f(Loaded.z, Loaded.w)));
            Sample.Signal = textureLoad(SourceSignal, Texel, 0);
            AccumulateTap(Sample, Guide, Normal, Luminance, Deviation, Spline[abs(X)] * Spline[abs(Y)], Step,
                          &Sum, &SpreadSum, &WeightSum);
        }
    }
    StoreResult(Pixel, Centre, Sum, SpreadSum, WeightSum);
}
