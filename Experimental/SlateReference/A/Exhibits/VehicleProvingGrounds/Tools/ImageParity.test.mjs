// Guards the two optimisations that must not change the image. These assert the *invariants* the parity depends on, so a
// later edit that quietly breaks one — a cascaded clear, a divergence between the two wavelet paths — fails here.
import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

const Read = (Path) => readFileSync(new URL(`../${Path}`, import.meta.url), "utf8");

test("a reused cascade is loaded, never cleared, so its depth survives the skip", () => {
    const Shadow = Read("Source/ShadowProjection.js");
    // The clear would wipe exactly the depth the skip exists to preserve.
    assert.match(Shadow, /depthLoadOp: this\.Rasterised\[Cascade\] \? "load" : "clear"/);
    // A skipped cascade must not be counted as rasterised-with-this-frame's matrix.
    assert.match(Shadow, /if \(!this\.Dirty\[Cascade\] && this\.Rasterised\[Cascade\]\)/);
});

test("cascade reuse only skips when both inputs are unchanged", () => {
    const Shadow = Read("Source/ShadowProjection.js");
    // Both halves of the decision: the caster set and the snapped light matrix.
    assert.match(Shadow, /this\.CascadeSignature\[Cascade\] !== this\.CasterKey/);
    assert.match(Shadow, /Math\.abs\(LightViewProjection\[Element\] - Anchor\[Element\]\) > Tolerance/);
    // The anchor must advance every frame, or the drift accumulates and the reuse alternates instead of settling.
    assert.match(Shadow, /this\.CascadeAnchor\[Cascade\] = LightViewProjection;/);
});

test("both wavelet paths share one tap function, so they cannot diverge", () => {
    const Shader = Read("Shader/VarianceWavelet.wgsl");
    const Body = Shader.slice(Shader.indexOf("fn AccumulateTap"));
    // Exactly one definition of the weighting arithmetic; the staged and direct paths both call it.
    assert.equal((Shader.match(/fn AccumulateTap/g) || []).length, 1);
    const Calls = (Shader.match(/AccumulateTap\(/g) || []).length;
    assert.equal(Calls, 3, "one definition plus one call from each entry point");
    assert.match(Shader, /fn ConvolveWaveletDirect/);
    assert.match(Shader, /fn ConvolveWavelet\(/);
});

test("the staged tile stays inside the 16 KiB workgroup budget", () => {
    const Shader = Read("Shader/VarianceWavelet.wgsl");
    const Pitch = Number(Shader.match(/const StagedPitch\s*:\s*u32 = (\d+)u/)[1]);
    // TileSample is 32 B: two u32 words and one vec4f, with the flag packed into the guide's spare half.
    const Bytes = Pitch * Pitch * 32;
    assert.ok(Bytes <= 16384, `tile is ${Bytes} B, over the 16384 B limit`);
});

test("the staged path is only dispatched for steps the tile can hold", () => {
    const Integrator = Read("Source/VarianceIntegrator.js");
    const Shader = Read("Shader/VarianceWavelet.wgsl");
    const Limit = Number(Integrator.match(/const StagedStepLimit = (\d+)/)[1]);
    const Maximum = Number(Shader.match(/const MaximumStagedStep\s*:\s*u32 = (\d+)u/)[1]);
    // The JS dispatch decision and the shader's tile size must agree; drifting apart would truncate the kernel.
    assert.equal(Limit, Maximum);
    assert.match(Integrator, /Step\(Iteration\) <= StagedStepLimit/);
});
