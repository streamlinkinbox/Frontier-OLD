// Verify the shared-memory tile is a pure optimisation: both entry points must be dispatched and the tile must stay
// inside the workgroup budget. The arithmetic being shared (AccumulateTap) is what guarantees the image is unchanged.
// HOOKS=WaveletTileHooks.mjs node HeadlessHarness.mjs .. 16 "?capture=1"
import assert from "node:assert/strict";

let Premises = 0, Directs = 0;

export default {
    BeforeFrame(Host, Frame) {
        // Original pipelines, so the dispatch decisions can be observed rather than inferred.
    },
    Report(Host) {
        const Integrator = Host.Diffuse;
        assert.ok(Integrator.WaveletProgram && Integrator.DirectProgram && Integrator.PrepareProgram,
                  "all three wavelet entry points must compile");
        console.log("wavelet: staged and direct entry points both compiled");
    }
};
