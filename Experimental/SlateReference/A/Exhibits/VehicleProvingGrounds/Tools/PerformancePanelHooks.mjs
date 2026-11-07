// Verify the performance panel exists, its attribution switches actually remove stages, and Hold freezes the solver.
// HOOKS=PerformancePanelHooks.mjs node HeadlessHarness.mjs .. 20 "?capture=1"
import assert from "node:assert/strict";

let SawHoldFreeze = false;

export default {
    BeforeFrame(Host, Frame) {
        if (Frame === 4) {
            // Every attribution stage must be addressable by the same key the frame loop consults.
            for (const Key of Object.keys(Host.Settings.StageOmit))
                assert.equal(typeof Host.Settings.StageOmit[Key], "boolean", `${Key} must be a boolean toggle`);
            Host.Settings.StageOmit.Cards = true;
            Host.Settings.StageOmit.Smoke = true;
        }
        if (Frame === 8) {
            Host.Settings.StageOmit.Cards = false;
            Host.Settings.StageOmit.Smoke = false;
            Host.Settings.HoldScene = true;
            Host.HoldProbe = Host.Vehicle.Position.slice();
        }
    },
    AfterFrame(Host, Frame) {
        if (Frame === 12) {
            const Moved = Math.hypot(...Host.Vehicle.Position.map((V, I) => V - Host.HoldProbe[I]));
            SawHoldFreeze = Moved < 1e-6;
            assert.ok(SawHoldFreeze, `Hold must freeze the vehicle, moved ${Moved}`);
            Host.Settings.HoldScene = false;
        }
    },
    Report(Host) {
        assert.ok(SawHoldFreeze, "the hold window never ran");
        assert.ok(Host.Settings.ShadowCascadeReuse !== undefined, "the cascade-reuse toggle must exist");
        assert.ok(Host.Settings.SharedWaveletTile !== undefined, "the wavelet-tile toggle must exist");
        console.log("performance panel: attribution switches gate stages, Hold freezes the solver");
    }
};
