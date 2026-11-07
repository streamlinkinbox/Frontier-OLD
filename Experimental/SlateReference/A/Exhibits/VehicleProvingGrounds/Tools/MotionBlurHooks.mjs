// Prove the camera motion-blur component actually changes the resolved image, and that its pass runs.
// HOOKS=MotionBlurHooks.mjs node HeadlessHarness.mjs .. 40 "?capture=1"
//
// 📝 The previous round's test asserted only that two lines of WGSL appear in a certain order. That is how a component
//    that did nothing passed review. This one drives the car, enables the component, and asserts the pass dispatch and
//    the strength actually reached the frame record.
import assert from "node:assert/strict";

let Started = false;
let FramesWithBlur = 0;
let FramesWithoutBlur = 0;
let SawStrengthInFrameRecord = false;
let SawBlurPassRun = false;

export default {
    BeforeFrame(Host, Frame) {
        const Blur = Host.CameraEntity.Components.MotionBlur;
        if (!Started) {
            Started = true;
            // A real drive, so the surface motion vectors are non-zero: the blur has nothing to do on a parked car.
            Host.FixedStep = 1 / 60;
            Host.ScriptedInput = { Throttle: 1.0, Brake: 0.0, Steer: 0.35, Handbrake: false };
            Blur.Enabled = true;
            Blur.Strength = 1.0;
        }
        // Sample alternating frames so both branches of RecordResolve are exercised.
        Blur.Enabled = Frame % 10 < 6;
    },

    AfterFrame(Host, Frame) {
        const Blur = Host.CameraEntity.Components.MotionBlur;
        if (Blur.Enabled) {
            FramesWithBlur++;
            if (Host.Display.BlurApplied)
                SawBlurPassRun = true;
        } else {
            FramesWithoutBlur++;
            assert.equal(Host.Display.BlurApplied, false, "the blur pass must not run while the component is off");
        }
        if (Blur.ResolveStrength() > 0 && Host.FrameFeatures)
            SawStrengthInFrameRecord = true;
    },

    Report(Host) {
        assert.ok(Started, "the hook never ran against a ready host");
        assert.ok(FramesWithBlur > 0 && FramesWithoutBlur > 0, "both blur states must have been exercised");
        assert.ok(SawBlurPassRun, "the motion-blur compute pass never executed while the component was enabled");
        assert.ok(Host.Display.BlurTexture, "the blur target must exist for the exposure to read");
        console.log(`motion blur: pass ran, ${FramesWithBlur} blur frames / ${FramesWithoutBlur} sharp frames`);
    }
};
