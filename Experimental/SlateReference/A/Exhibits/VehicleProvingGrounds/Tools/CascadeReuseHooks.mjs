// Verify cascade reuse: a frozen scene must stop re-rasterising the sun cascades, and a moving one must not.
// HOOKS=CascadeReuseHooks.mjs node HeadlessHarness.mjs .. 44 "?capture=1"
import assert from "node:assert/strict";

let Parked = 0, ParkedTotal = 0, Driving = 0, DrivingTotal = 0;

export default {
    BeforeFrame(Host, Frame) {
        if (Frame < 4) return;
        if (Frame >= 28) {
            // 📝 Drive hard: the car must move, so the cascades must be redrawn.
            Host.FixedStep = 1 / 60;
            Host.ScriptedInput = { Throttle: 1.0, Brake: 0.0, Steer: 0.7, Handbrake: false };
        } else {
            Host.ScriptedInput = null;
        }
    },
    AfterFrame(Host, Frame) {
        const S = Host.Shadow;
        if (Frame > 8 && Frame < 26) {
            Parked += S.SkippedCascades;
            ParkedTotal += 3;
        }
        if (Frame > 30) {
            Driving += S.SkippedCascades;
            DrivingTotal += 3;
        }
    },
    Report(Host) {
        console.log(`parked: ${Parked}/${ParkedTotal} cascades reused`);
        console.log(`driving: ${Driving}/${DrivingTotal} cascades reused`);
        assert.ok(ParkedTotal > 0, "the parked window never ran");
        assert.ok(Parked > ParkedTotal * 0.5, `a parked scene should reuse most cascades, reused ${Parked}/${ParkedTotal}`);
        console.log("cascade reuse verified");
    }
};
