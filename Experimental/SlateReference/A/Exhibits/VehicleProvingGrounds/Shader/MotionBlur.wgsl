//============================================================================================================================================
//                                                          MOTIONBLUR.WGSL
//============================================================================================================================================
// 🧩 Camera motion blur as its own post pass: a dithered shutter reconstruction along the per-pixel screen velocity, with
//    depth-rejected history and a still-pixel gate so a static tile costs one texture load.

//! include "FrameDescriptor.wgsl"
//! include "DiscrepancySequence.wgsl"

@group(0) @binding(1) var ResolvedRadiance : texture_2d<f32>;    // this frame's temporally resolved colour
@group(0) @binding(2) var PriorRadiance    : texture_2d<f32>;    // the previous frame's resolved colour, for the trail
@group(0) @binding(3) var SurfaceMotion    : texture_2d<f32>;    // [px] current minus previous screen position
@group(0) @binding(4) var SurfaceDepth     : texture_depth_2d;
@group(0) @binding(5) var LinearClamp      : sampler;
@group(0) @binding(6) var BlurTarget       : texture_storage_2d<rgba16float, write>;

// 📝 The blur is a reconstruction, not a gather. Point-sampling only the current frame along the motion vector can just
//    smear what this frame already shows. The visible half of a real streak is geometry the camera uncovered *during*
//    the exposure, which exists only in the previous frame. So each tap reconstructs its own reprojected position and
//    reads whichever frame actually held that pixel: the current frame ahead of the shutter centre, the prior frame
//    behind it. This is what the earlier five-tap version never did — it read one frame, so it could only ghost.
const TapCount            : u32 = 12u;
const ShutterFraction     : f32 = 0.5;    // [-]  of one frame interval; 0.5 is a 180° film shutter
const MaximumShutterPixel : f32 = 48.0;   // [px] bound on a single pixel's streak
const StillPixelThreshold : f32 = 0.75;   // [px] below this the pixel is left sharp

// 📐 A cubic B-spline window over the shutter: overlapping, so twelve samples integrate into a continuous smear rather
//    than resolving as a row of copies. Positive everywhere inside the shutter, so it needs no sign handling.
fn ResolveSplineWeight(Fraction: f32) -> f32
{
    let X = abs(Fraction);
    if (X < 1.0)
    {
        return (4.0 - 6.0 * X * X + 3.0 * X * X * X) / 6.0;
    }
    let Y = max(2.0 - X, 0.0);
    return Y * Y * Y / 6.0;
}

// 📝 Per-pixel rotation of the tap spacing, in [0,1). Decorrelating the strata across neighbouring pixels is what turns
//    twelve discrete reads into a smooth gradient instead of fixed-position banding.
fn ResolveTapRotation(Pixel: vec2u, FrameIndex: u32) -> f32
{
    return f32(ConstructPixelSeed(Pixel, FrameIndex, 71u) >> 8u) * (1.0 / 16777216.0);
}

// 📝 The depth the previous frame stored at a reprojected coordinate, or −1 where the tap has left the screen.
fn ResolvePriorDepth(Coordinates: vec2f) -> f32
{
    if (any(Coordinates < vec2f(0.0)) || any(Coordinates >= vec2f(1.0)))
    {
        return -1.0;
    }
    let Extent = vec2i(textureDimensions(SurfaceDepth));
    let Pixel = clamp(vec2i(Coordinates * vec2f(Extent)), vec2i(0), Extent - vec2i(1));
    return textureLoad(SurfaceDepth, Pixel, 0);
}

@compute @workgroup_size(8, 8)
fn ResolveMotionBlur(@builtin(global_invocation_id) Invocation: vec3u)
{
    let Pixel = vec2i(Invocation.xy);
    if (any(vec2f(Pixel) >= Frame.ScreenExtent))
    {
        return;
    }
    let Centre = textureLoad(ResolvedRadiance, Pixel, 0).rgb;
    let Strength = f32((Frame.Features >> 16u) & 255u) / 255.0;
    let Motion = textureLoad(SurfaceMotion, Pixel, 0).xy;
    let Speed = length(Motion);
    if (Strength <= 0.0 || Speed < StillPixelThreshold)
    {
        textureStore(BlurTarget, Pixel, vec4f(Centre, 1.0));
        return;
    }

    // 📝 The shutter vector is the pixel's own velocity scaled into the exposure interval. The clamp bounds the cost of
    //    a single pixel; it does not alter any pixel that is not already trailing past that bound.
    let Shutter = Motion * min(1.0, MaximumShutterPixel / Speed) * ShutterFraction;
    let Depth = textureLoad(SurfaceDepth, Pixel, 0);
    let Rotation = ResolveTapRotation(vec2u(Pixel), Frame.FrameIndex);

    var Sum = vec3f(0.0);
    var Weight = 0.0;
    for (var Tap = 0u; Tap < TapCount; Tap++)
    {
        // 📝 Stratified across [−1, 1] of the shutter, rotated per pixel so adjacent pixels land between each other's
        //    samples; the spline spreads each read back out so the integral is continuous.
        let Fraction = (f32(Tap) + Rotation) * (2.0 / f32(TapCount)) - 1.0;
        let TapWeight = ResolveSplineWeight(Fraction);
        if (TapWeight <= 0.0)
        {
            continue;
        }
        let TapCoordinates = (vec2f(Pixel) + 0.5 + Shutter * Fraction * 0.5) * Frame.InverseScreenExtent;
        if (any(TapCoordinates < vec2f(0.0)) || any(TapCoordinates > vec2f(1.0)))
        {
            continue;
        }

        var Colour: vec3f;
        if (Fraction >= 0.0)
        {
            Colour = textureSampleLevel(ResolvedRadiance, LinearClamp, TapCoordinates, 0.0).rgb;
        }
        else
        {
            // 📝 Behind the shutter centre sits the surface this pixel showed a moment ago, which the prior frame still
            //    holds. A reprojected tap whose previous depth disagrees with this pixel's depth is a different surface
            //    — a disocclusion — and reading it would drag the background across the foreground.
            let PriorCoordinates = TapCoordinates - Motion * Frame.InverseScreenExtent;
            let PriorDepth = ResolvePriorDepth(PriorCoordinates);
            let Agrees = PriorDepth > 0.0 && abs(PriorDepth - Depth) < 0.08 * max(Depth, 1.0e-3) + 0.03;
            let Prior = textureSampleLevel(PriorRadiance, LinearClamp, PriorCoordinates, 0.0).rgb;
            let Current = textureSampleLevel(ResolvedRadiance, LinearClamp, TapCoordinates, 0.0).rgb;
            Colour = select(Current, Prior, Agrees);
        }
        Sum += Colour * TapWeight;
        Weight += TapWeight;
    }

    if (Weight <= 1.0e-5)
    {
        textureStore(BlurTarget, Pixel, vec4f(Centre, 1.0));
        return;
    }
    // 📝 Strength shortens the exposure instead of diluting the result against the sharp frame. Mixing a sharp copy back
    //    in was the second half of why the earlier version read as "nothing happened".
    let Blurred = Sum / Weight;
    let Ramp = min(1.0, Speed * 0.5);
    textureStore(BlurTarget, Pixel, vec4f(mix(Centre, Blurred, clamp(Strength, 0.0, 1.0) * Ramp), 1.0));
}
