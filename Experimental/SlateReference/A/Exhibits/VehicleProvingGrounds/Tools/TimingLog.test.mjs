import assert from "node:assert/strict";
import test from "node:test";
import { ComposeTimingLog, SummariseTimingSamples } from "../Source/TimingLog.js";

test("timing log is a shareable versioned JSON record with separate CPU and GPU sections", () => {
    const Log = ComposeTimingLog({
        CapturedAt: "2026-11-07T12:00:00.000Z",
        WindowSeconds: 1.0,
        GradeName: "high",
        ScreenExtent: [1600, 900],
        TraceExtent: [800, 450],
        TraceScaleUsed: 2,
        FrameIndex: 240,
        FrameSeconds: 1 / 60,
        LowRate: "48",
        CpuSamples: {
            frame_delta_ms: [16, 20, 18],
            callback_cpu_ms: [3, 5, 4],
            scene_update_cpu_ms: [1, 2, 1.5],
            command_encode_cpu_ms: [1, 2, 1],
            queue_submit_cpu_ms: [0.2, 0.3, 0.25]
        },
        MetricsEnabled: true,
        PassNames: ["Surface", "Resolve", "Smoke"],
        Durations: { Surface: 4.25, Resolve: 1.2, Smoke: 0 },
        LastDurations: { Surface: 4.6, Resolve: 1.0, Smoke: 0 },
        PassSamples: { Surface: 21, Resolve: 21, Smoke: 0 },
        Settings: { Reflection: true },
        LightCount: 8
    });
    const Record = JSON.parse(Log);
    assert.equal(Record.schema, "vehiclehmi_perf_v1");
    assert.equal(Record.captured_at_utc, "2026-11-07T12:00:00.000Z");
    assert.equal(Record.frame.delta_time_ms.samples, 3);
    assert.equal(Record.cpu_wall_time_ms.command_encode.average_ms, 1.333);
    assert.equal(Record.gpu_timestamp_queries.status, "available");
    assert.equal(Record.gpu_timestamp_queries.pass_ema_ms.Surface, 4.25);
    assert.equal(Record.gpu_timestamp_queries.pass_last_ms.Resolve, 1);
    assert.equal(Record.gpu_timestamp_queries.pass_ema_ms.Smoke, null);
    assert.equal(Record.gpu_timestamp_queries.pass_sample_count.Smoke, 0);
    assert.equal(Record.render_settings.Reflection, true);
});

test("unavailable GPU timestamps are represented as unavailable and null, never zero-cost passes", () => {
    const Record = JSON.parse(ComposeTimingLog({
        MetricsEnabled: false,
        PassNames: ["Surface"],
        Durations: { Surface: 0 },
        PassSamples: { Surface: 0 }
    }));
    assert.equal(Record.gpu_timestamp_queries.status, "unavailable");
    assert.equal(Record.gpu_timestamp_queries.pass_ema_ms.Surface, null);
    assert.equal(Record.gpu_timestamp_queries.pass_last_ms.Surface, null);
    assert.equal(Record.cpu_wall_time_ms.callback.samples, 0);
    assert.equal(Record.cpu_wall_time_ms.callback.average_ms, null);
});

test("sample summaries report stable average, percentile, maximum and sample count", () => {
    assert.deepEqual(SummariseTimingSamples([4, 1, 3, 2]), {
        samples: 4,
        average_ms: 2.5,
        p95_ms: 4,
        max_ms: 4
    });
    assert.deepEqual(SummariseTimingSamples([]), {
        samples: 0,
        average_ms: null,
        p95_ms: null,
        max_ms: null
    });
});
