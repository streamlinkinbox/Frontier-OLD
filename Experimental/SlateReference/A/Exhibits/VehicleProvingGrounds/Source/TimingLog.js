//============================================================================================================================================
//                                                               TIMINGLOG.JS
//============================================================================================================================================
// 🧩 Shareable performance record: CPU wall time and GPU timestamp time stay explicitly separate.

function Summarise(Values = [])
{
    const Samples = Values.filter(Number.isFinite).map(Number).sort((Left, Right) => Left - Right);
    if (Samples.length === 0)
        return { samples: 0, average_ms: null, p95_ms: null, max_ms: null };
    const Average = Samples.reduce((Total, Value) => Total + Value, 0.0) / Samples.length;
    return {
        samples: Samples.length,
        average_ms: Number(Average.toFixed(3)),
        p95_ms: Number(Samples[Math.min(Samples.length - 1, Math.ceil(Samples.length * 0.95) - 1)].toFixed(3)),
        max_ms: Number(Samples[Samples.length - 1].toFixed(3))
    };
}

function FiniteOrNull(Value)
{
    return Number.isFinite(Value) ? Number(Value) : null;
}

export function ComposeTimingLog(Snapshot)
{
    const PassNames = Snapshot.PassNames || [];
    const MetricsAvailable = !!Snapshot.MetricsEnabled;
    const Durations = Snapshot.Durations || {};
    const LastDurations = Snapshot.LastDurations || {};
    const PassSamples = Snapshot.PassSamples || {};
    const CpuSamples = Snapshot.CpuSamples || {};
    const GpuPassEma = {};
    const GpuPassLast = {};
    const GpuPassSampleCounts = {};
    for (const Name of PassNames)
    {
        const HasSample = MetricsAvailable && (PassSamples[Name] || 0) > 0;
        GpuPassEma[Name] = HasSample ? FiniteOrNull(Durations[Name]) : null;
        GpuPassLast[Name] = HasSample ? FiniteOrNull(LastDurations[Name]) : null;
        GpuPassSampleCounts[Name] = MetricsAvailable ? (PassSamples[Name] || 0) : 0;
    }

    const FrameDelta = Summarise(CpuSamples.frame_delta_ms || []);
    const Cpu = {
        callback: Summarise(CpuSamples.callback_cpu_ms || []),
        scene_update: Summarise(CpuSamples.scene_update_cpu_ms || []),
        command_encode: Summarise(CpuSamples.command_encode_cpu_ms || []),
        queue_submit_call: Summarise(CpuSamples.queue_submit_cpu_ms || [])
    };
    const FrameRate = Snapshot.FrameSeconds > 0.0 ? 1.0 / Snapshot.FrameSeconds : null;
    const Record = {
        schema: "vehiclehmi_perf_v1",
        captured_at_utc: Snapshot.CapturedAt || new Date().toISOString(),
        capture_window_seconds: FiniteOrNull(Snapshot.WindowSeconds),
        frame: {
            smoothed_fps: FrameRate === null ? null : Number(FrameRate.toFixed(2)),
            observed_fps_from_delta: FrameDelta.average_ms > 0.0 ? Number((1000.0 / FrameDelta.average_ms).toFixed(2)) : null,
            one_percent_low_fps: Snapshot.LowRate === "–" || Snapshot.LowRate === undefined ? null : Number(Snapshot.LowRate),
            delta_time_ms: FrameDelta
        },
        cpu_wall_time_ms: Cpu,
        gpu_timestamp_queries: {
            status: MetricsAvailable ? "available" : "unavailable",
            note: MetricsAvailable
                ? "Per-pass GPU timings are asynchronous timestamp-query measurements; *_ema_ms is smoothed, *_last_ms is the latest sample."
                : "This adapter/browser did not expose timestamp queries; GPU pass time is unavailable, not zero.",
            pass_ema_ms: GpuPassEma,
            pass_last_ms: GpuPassLast,
            pass_sample_count: GpuPassSampleCounts
        },
        workload: {
            quality_grade: Snapshot.GradeName || null,
            screen_extent_px: Snapshot.ScreenExtent || null,
            trace_extent_px: Snapshot.TraceExtent || null,
            trace_scale: Snapshot.TraceScaleUsed ?? null,
            frame_index: Snapshot.FrameIndex ?? null,
            light_count: Snapshot.LightCount ?? null,
            clustered_light_overflow: Snapshot.ClusterOverflow ?? null,
            active_stress_objects: Snapshot.ActiveStressObjects ?? null,
            moving_stress_objects: Snapshot.MovingStressObjects ?? null,
            draw_runs: Snapshot.DrawRuns ?? null,
            distance_bricks_this_frame: Snapshot.DistanceBricks ?? null,
            card_tiles_scheduled: Snapshot.CardTiles ?? null
        },
        render_settings: Snapshot.Settings || {},
        runtime: {
            user_agent: Snapshot.UserAgent || null,
            webgpu_adapter: Snapshot.AdapterInfo || null,
            capture_enabled: !!Snapshot.CaptureEnabled
        }
    };
    return JSON.stringify(Record, null, 2);
}

export { Summarise as SummariseTimingSamples };
