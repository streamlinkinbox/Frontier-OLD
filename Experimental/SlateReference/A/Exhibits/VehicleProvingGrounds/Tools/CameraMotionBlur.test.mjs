import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { CameraMotionBlur } from "../Source/CameraMotionBlur.js";

test("camera motion blur is opt-in and resolves a bounded camera-owned strength", () => {
    const Component = new CameraMotionBlur();
    assert.equal(Component.Enabled, false);
    assert.equal(Component.Strength, 0.7);
    assert.equal(Component.ResolveStrength(), 0);
    Component.Enabled = true;
    Component.Strength = 0.6;
    assert.equal(Component.ResolveStrength(), 0.6);
    Component.Strength = 2;
    assert.equal(Component.ResolveStrength(), 1);
    Component.Enabled = false;
    assert.equal(Component.ResolveStrength(), 0);
});

test("camera motion blur clamps invalid and negative component strengths safely", () => {
    const Component = new CameraMotionBlur({ Enabled: true, Strength: -2 });
    assert.equal(Component.ResolveStrength(), 0);
    Component.Strength = Number.NaN;
    assert.equal(Component.ResolveStrength(), 0);
});

test("the antialiasing no longer blurs: motion blur is its own post pass", () => {
    // 📝 The earlier implementation mixed a five-tap gather into the TAA result. That cannot work: inside the resolve the
    //    90 % history weight erases it, and mixing a sharp copy back in dilutes it. The component is now a separate pass,
    //    so the resolve must be free of any blur arithmetic at all.
    const Shader = readFileSync(new URL("../Shader/DisplayAntialias.wgsl", import.meta.url), "utf8");
    assert.doesNotMatch(Shader, /ResolveCameraMotionBlur/);
    assert.doesNotMatch(Shader, /BlurComposite/);
    assert.match(Shader, /textureStore\(AntialiasTarget, Pixel, vec4f\(ExpandRange\(Resolved\), 1\.0\)\)/);
});

test("the motion-blur pass reads two frames, so it can reconstruct a shutter rather than smear one frame", () => {
    const Shader = readFileSync(new URL("../Shader/MotionBlur.wgsl", import.meta.url), "utf8");
    // Both the current and the prior resolve must be sampled: a single-frame gather is what made the old version ghost.
    assert.match(Shader, /textureSampleLevel\(ResolvedRadiance/);
    assert.match(Shader, /textureSampleLevel\(PriorRadiance/);
    // Enough taps and an overlapping window, so twelve samples integrate instead of resolving as copies.
    assert.match(Shader, /TapCount\s*:\s*u32 = 1[2-6]u/);
    assert.match(Shader, /fn ResolveSplineWeight/);
    // Depth rejection, so a disocclusion cannot drag the background across the foreground.
    assert.match(Shader, /ResolvePriorDepth/);
});

test("the pass is gated on the component and on the final image only", () => {
    const Host = readFileSync(new URL("../Source/IlluminationHost.js", import.meta.url), "utf8");
    assert.match(Host, /AssignBlur\(this\.Settings\.Inspection === 0 && this\.CameraEntity\.Components\.MotionBlur\.Enabled/);
    const Display = readFileSync(new URL("../Source/DisplayProjection.js", import.meta.url), "utf8");
    assert.match(Display, /this\.BlurEnabled/);
    // The downstream exposure must read the blurred target, not the sharp resolve, on the frames it runs.
    assert.match(Display, /BlurExposureGroups/);
});
