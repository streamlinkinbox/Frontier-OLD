# ============================================================================================================================================
#                                                            INSPECTCAPTURES.PY
# ============================================================================================================================================
# 🧩 Retain actual native images, lossless float evidence, checks, comparisons and non-interpolated animations.

from pathlib import Path
import argparse
import datetime
import hashlib
import json
import os
import platform
import subprocess
import zlib

import numpy as Numpy
from PIL import Image, ImageDraw, ImageFont

Root = Path(__file__).resolve().parents[3]
Exhibit = Root / "Exhibits/DistanceClipmap"
Width, Height = 480, 270
Sources = ["Emissive", "Point", "Sun", "Area", "Combined"]


def Digest(Payload):
    return hashlib.sha256(Payload).hexdigest()


def DecodePfm(Location):
    with Location.open("rb") as Stream:
        if Stream.readline() != b"PF\n":
            raise ValueError(f"Not RGB PFM: {Location}")
        Extent = tuple(map(int, Stream.readline().split()))
        Scale = float(Stream.readline())
        Payload = Stream.read()
    if Extent != (Width, Height) or Scale != -1 or len(Payload) != Width * Height * 12:
        raise ValueError(f"PFM extent/format mismatch: {Location}")
    return Numpy.frombuffer(Payload, dtype="<f4").reshape(Height, Width, 3)[::-1].copy()


def EncodeDisplay(Pixels, Exposure=1.0, Debug=False):
    Linear = Pixels.astype(Numpy.float64) * Exposure
    Mapped = Numpy.clip(Linear, 0, 1) if Debug else Linear / (1 + Linear)
    Encoded = Numpy.where(Mapped <= 0.0031308, 12.92 * Mapped, 1.055 * Numpy.maximum(Mapped, 0) ** (1 / 2.4) - 0.055)
    return Numpy.rint(Numpy.clip(Encoded, 0, 1) * 255).astype(Numpy.uint8)


def ErrorMetrics(A, B, Mask):
    Difference = A.astype(Numpy.float64) - B.astype(Numpy.float64)
    return {
        "linear_rgb_rmse_full_image": float(Numpy.sqrt(Numpy.mean(Difference ** 2))),
        "linear_rgb_rmse_visible_geometry": float(Numpy.sqrt(Numpy.mean(Difference[Mask] ** 2))),
        "max_absolute_channel_difference": float(Numpy.abs(Difference).max()),
        "changed_rgb_pixels": int(Numpy.count_nonzero(Numpy.any(Difference != 0, axis=2))),
    }


def ContactSheet(Names, Titles, Location, Columns=3):
    Rows = (len(Names) + Columns - 1) // Columns
    Sheet = Image.new("RGB", (Width * Columns, (Height + 28) * Rows), "#11151b")
    Pen = ImageDraw.Draw(Sheet)
    for Index, (Name, Title) in enumerate(zip(Names, Titles)):
        X, Y = (Index % Columns) * Width, (Index // Columns) * (Height + 28)
        Picture = Image.open(Exhibit / "Images" / (Name + ".png")).convert("RGB")
        Sheet.paste(Picture, (X, Y + 28))
        Pen.text((X + 9, Y + 8), Title, fill="#ebedf2")
    Sheet.save(Location)


def Animate(Names, Name):
    Pictures = [Image.open(Exhibit / "Images" / (Entry + ".png")).convert("RGB") for Entry in Names]
    Durations = [330, 330, 340] * 4
    Apng = Exhibit / "Images" / (Name + ".png")
    Pictures[0].save(Apng, save_all=True, append_images=Pictures[1:], duration=Durations, loop=0, disposal=0, blend=0)
    Decoded = Image.open(Apng)
    if Decoded.n_frames != len(Pictures):
        raise AssertionError("APNG lost poses")
    for Index, Expected in enumerate(Pictures):
        Decoded.seek(Index)
        if not Numpy.array_equal(Numpy.asarray(Decoded.convert("RGB")), Numpy.asarray(Expected)):
            raise AssertionError("APNG altered the corresponding RGB PNG")
    # GIF is an explicitly labelled 8-bit palette derivative, not a precision or noise measurement.
    Pictures[0].save(Exhibit / "Images" / (Name + ".gif"), save_all=True, append_images=Pictures[1:],
                     duration=Durations, loop=0, disposal=2, optimize=False)
    return {"poses": len(Pictures), "loop_ms": sum(Durations), "extent": [Width, Height],
            "interpolated": False, "apng_rgb_equal_to_individual_pngs": True, "gif_palette_loss_expected": True}


def BenchmarkChart(Measurements):
    Picture = Image.new("RGB", (960, 320), "#101722")
    Pen = ImageDraw.Draw(Picture)
    Heading = ImageFont.load_default(size=22)
    Caption = ImageFont.load_default(size=16)
    Pen.text((24, 19), "Matched CPU direct lighting: equal pixels, measured time", font=Heading, fill="#edf0f7")
    Pen.text((24, 53), "480 x 270 | four primary / 32 extended-source samples | five alternating pairs", font=Caption, fill="#9da9bd")
    Maximum = max(Measurements["exact_ms"] + Measurements["hybrid_ms"]) * 1.1
    for Index, (Title, Median, Colour) in enumerate([
        ("Triangle only", Measurements["exact_median_ms"], "#70dfd1"),
        ("Hybrid distance + triangles", Measurements["hybrid_median_ms"], "#ff9b98"),
    ]):
        Y = 103 + Index * 72
        Pen.text((24, Y), Title, font=Caption, fill="#edf0f7")
        Length = int(530 * Median / Maximum)
        Pen.rectangle((280, Y, 280 + Length, Y + 30), fill=Colour)
        Pen.text((290 + Length, Y + 4), f"{Median:.1f} ms", font=Caption, fill="#edf0f7")
    Slower = (Measurements["hybrid_median_ms"] / Measurements["exact_median_ms"] - 1) * 100
    Pen.text((24, 255), f"{Slower:+.2f}% hybrid median time; every compared Float32 RGB image is identical.", font=Caption, fill="#ff9b98")
    Pen.text((24, 282), "Shared two-vCPU host; excludes bake/encoding. Not a GPU or full-renderer benchmark.", font=Caption, fill="#9da9bd")
    Picture.save(Exhibit / "Images/Benchmark.png")


def Execute():
    Parser = argparse.ArgumentParser()
    Parser.add_argument("capture_directory", type=Path)
    Arguments = Parser.parse_args()
    InputDirectory = Arguments.capture_directory
    for Name in ["Images", "Results", "Buffers"]:
        (Exhibit / Name).mkdir(parents=True, exist_ok=True)
    Required = ["CombinedDirect", "HybridDirect", "CombinedRepeat", "LocalVoxelPenumbra", "ClipmapPenumbra", "FacetNormals",
                "SourcesOff", "SourcesOffIncludingGi", "PathTrace", "PathTrace512", "GpuPointSurfaceCache"]
    Required += [f"DistanceDebug{Index}" for Index in range(6)]
    Required += [f"GpuDistanceLevel{Index}" for Index in range(3)]
    Required += [Source + Suffix for Source in Sources for Suffix in ["OnlyDirect", "SurfaceCache", "CachedGi", "ReferenceGi"]]
    Required += [Source + Suffix for Source in ["Emissive", "Combined"] for Suffix in ["ReferenceGi512", "CachedGi512", "OutwardOnlyGi512"]]
    Required += [f"{Prefix}{Index:02d}{Suffix}" for Index in range(12)
                 for Prefix, Suffix in [("Motion", ""), ("MotionLit", ""), ("Motion", "Distance")]]
    Captures = {Name: DecodePfm(InputDirectory / (Name + ".pfm")) for Name in Required}
    PixelChecks = []
    for Name, Pixels in Captures.items():
        if not Numpy.isfinite(Pixels).all() or (Pixels < 0).any():
            raise AssertionError(f"Nonfinite or negative native radiance: {Name}")
        if Name not in ["SourcesOff", "SourcesOffIncludingGi"] and not Numpy.count_nonzero(Pixels):
            raise AssertionError(f"Unexpected entirely black capture: {Name}")
        Debug = "Distance" in Name or Name == "FacetNormals"
        Exposure = 8.0 if "Gi" in Name else 1.0
        Display = EncodeDisplay(Pixels, Exposure, Debug)
        Destination = Exhibit / "Images" / (Name + ".png")
        Image.fromarray(Display).save(Destination)
        if not Numpy.array_equal(Numpy.asarray(Image.open(Destination)), Display):
            raise AssertionError("PNG round-trip changed RGB")
        Payload = Pixels.astype("<f4").tobytes()
        RetainFloat = not (Name.startswith("Motion") or Debug or Name == "GpuPointSurfaceCache")
        if RetainFloat:
            (Exhibit / "Buffers" / (Name + ".f32.zlib")).write_bytes(zlib.compress(Payload, 9))
        PixelChecks.append({
            "name": Name, "width": Width, "height": Height, "nan_channels": 0, "inf_channels": 0,
            "negative_channels": 0, "maximum_linear": float(Pixels.max()), "mean_linear": float(Pixels.mean()),
            "zero_rgb_pixels": int(Numpy.count_nonzero(Numpy.all(Pixels == 0, axis=2))),
            "hdr_channels_above_one": int(Numpy.count_nonzero(Pixels > 1)),
            "encoded_white_rgb_pixels": int(Numpy.count_nonzero(Numpy.all(Display == 255, axis=2))),
            "encoded_saturated_channels": int(Numpy.count_nonzero(Display == 255)),
            "float32_top_down_rgb_sha256": Digest(Payload), "float_buffer_retained": RetainFloat,
            "png_sha256": Digest(Destination.read_bytes()), "display_exposure": Exposure,
            "display_mapping": "linear debug colour then IEC sRGB" if Debug else "scene-linear exposure; Reinhard x/(1+x); IEC sRGB",
        })
    for Name in ["SourcesOff", "SourcesOffIncludingGi"]:
        if Numpy.count_nonzero(Captures[Name]):
            raise AssertionError("Source-off native radiance is not exactly zero")
    if not Numpy.array_equal(Captures["CombinedDirect"], Captures["HybridDirect"]):
        raise AssertionError("Exact/hybrid full-float images differ")
    if not Numpy.array_equal(Captures["CombinedDirect"], Captures["CombinedRepeat"]):
        raise AssertionError("Full-float repeated rendering differs")
    Mask = Numpy.any(Captures["FacetNormals"] != 0, axis=2)
    Comparisons = {
        "reference_scope": "Finite-budget triangle/diffuse numerical reference, not a photograph, real-life truth or a production renderer.",
        "raw_local_vs_triangle": ErrorMetrics(Captures["LocalVoxelPenumbra"], Captures["CombinedDirect"], Mask),
        "raw_clipmap_vs_triangle": ErrorMetrics(Captures["ClipmapPenumbra"], Captures["CombinedDirect"], Mask),
        "hybrid_vs_triangle": ErrorMetrics(Captures["HybridDirect"], Captures["CombinedDirect"], Mask),
        "path_128_to_512_delta_not_ground_truth_error": ErrorMetrics(Captures["PathTrace"], Captures["PathTrace512"], Mask),
    }
    for Source in ["Emissive", "Combined"]:
        Reference = Captures[Source + "ReferenceGi512"]
        Comparisons[Source + "_cache_corrected_vs_finite_512"] = ErrorMetrics(Captures[Source + "CachedGi512"], Reference, Mask)
        Comparisons[Source + "_outward_only_vs_finite_512"] = ErrorMetrics(Captures[Source + "OutwardOnlyGi512"], Reference, Mask)
        Comparisons[Source + "_corrected_vs_outward_only"] = ErrorMetrics(Captures[Source + "CachedGi512"], Captures[Source + "OutwardOnlyGi512"], Mask)
        Comparisons[Source + "_reference_128_to_512_delta"] = ErrorMetrics(Captures[Source + "ReferenceGi"], Reference, Mask)
    Difference = Numpy.abs(Captures["LocalVoxelPenumbra"] - Captures["CombinedDirect"])
    Image.fromarray(EncodeDisplay(Difference, 8)).save(Exhibit / "Images/LocalShadowDifference.png")
    Difference = Numpy.abs(Captures["ClipmapPenumbra"] - Captures["CombinedDirect"])
    Image.fromarray(EncodeDisplay(Difference, 8)).save(Exhibit / "Images/ClipmapShadowDifference.png")
    Image.fromarray(EncodeDisplay(Captures["CombinedDirect"] + Captures["CombinedReferenceGi512"])).save(Exhibit / "Images/CombinedWithGi.png")
    ContactSheet(["LocalVoxelPenumbra", "ClipmapPenumbra", "HybridDirect", "LocalShadowDifference", "ClipmapShadowDifference", "CombinedDirect"],
                 ["Raw local voxel control - REJECTED", "Raw clipmap control - REJECTED", "Hybrid: triangle-refined contact",
                  "Local / triangle absolute difference x8", "Clipmap / triangle absolute difference x8", "Triangle-only matched reference"],
                 Exhibit / "Images/ShadowComparison.png")
    ContactSheet(["EmissiveOnlyDirect", "EmissiveReferenceGi512", "EmissiveCachedGi512", "CombinedOnlyDirect", "CombinedReferenceGi512", "CombinedWithGi"],
                 ["Vehicle emitters only - direct", "Vehicle emitters only - indirect x8", "Vehicle emitters only - cached indirect x8",
                  "All four sources - direct", "All four sources - indirect x8", "Linear direct + finite indirect sum"],
                 Exhibit / "Images/SourceComparison.png")
    Animations = {
        "VehicleMotion": Animate([f"MotionLit{Index:02d}" for Index in range(12)], "VehicleMotion"),
        "EmissiveMotion": Animate([f"Motion{Index:02d}" for Index in range(12)], "EmissiveMotion"),
        "DistanceMotion": Animate([f"Motion{Index:02d}Distance" for Index in range(12)], "DistanceMotion"),
    }
    ContactSheet([f"MotionLit{Index:02d}" for Index in [0, 2, 4, 6, 8, 10]],
                 [f"Actual pose {Index:02d} - absolute t={Index/3:.3f}s" for Index in [0, 2, 4, 6, 8, 10]],
                 Exhibit / "Images/MotionInspection.png")
    IsolationNames, IsolationTitles = [], []
    for Source in Sources:
        Budget = "512" if Source in ["Emissive", "Combined"] else ""
        IsolationNames += [Source + "OnlyDirect", Source + "ReferenceGi" + Budget, Source + "CachedGi" + Budget]
        IsolationTitles += [Source + " only - direct", Source + " only - finite reference GI x8", Source + " only - cached GI x8"]
    ContactSheet(IsolationNames, IsolationTitles, Exhibit / "Images/SourceIsolation.png")
    ContactSheet([f"DistanceDebug{Index}" for Index in range(6)] + [f"GpuDistanceLevel{Index}" for Index in range(3)],
                 ["CPU clip level 0", "CPU clip level 1", "CPU clip level 2", "Local vehicle unsigned bake", "Clip level coverage", "Closed-box signed field",
                  "Vulkan clip level 0 readback", "Vulkan clip level 1 readback", "Vulkan clip level 2 readback"],
                 Exhibit / "Images/DistanceInspection.png")
    ContactSheet([Source + Suffix + "Gi512" for Source in ["Emissive", "Combined"] for Suffix in ["OutwardOnly", "Cached", "Reference"]],
                 [Source + " - " + Suffix + " indirect x8" for Source in ["Emissive", "Combined"] for Suffix in ["outward-only control", "correct two-sided cache", "finite triangle reference"]],
                 Exhibit / "Images/CacheInspection.png")
    ContactSheet(["PathTrace", "PathTrace512", "FacetNormals"],
                 ["Finite path: 128 spp", "Finite path: 512 spp", "Actual geometric facet normals"],
                 Exhibit / "Images/PathInspection.png")
    for Prefix, Suffix, Name in [("MotionLit", "", "MotionAllPoses"), ("Motion", "", "NightMotionAllPoses"), ("Motion", "Distance", "DistanceMotionAllPoses")]:
        ContactSheet([f"{Prefix}{Index:02d}{Suffix}" for Index in range(12)],
                     [f"Pose {Index:02d}, t={Index/3:.3f}s - " + ("distance" if Suffix else "lit" if Prefix == "MotionLit" else "emissive-only") for Index in range(12)],
                     Exhibit / f"Images/{Name}.png")
    for Name in ["Numeric.json", "Construction.json", "Vulkan.json", "CaptureChecks.json", "Benchmark.json", "Consumption.json",
                 "Timings.csv", "ConvergenceTimings.csv"]:
        Source = InputDirectory / Name
        Payload = Source.read_bytes()
        if Source.suffix == ".json":
            json.loads(Payload)
        (Exhibit / "Results" / Name).write_bytes(Payload)
    BenchmarkChart(json.loads((InputDirectory / "Benchmark.json").read_bytes()))
    (Exhibit / "Results/PixelChecks.json").write_text(json.dumps({"captures": PixelChecks, "animations": Animations}, indent=2) + "\n")
    (Exhibit / "Results/Comparisons.json").write_text(json.dumps(Comparisons, indent=2) + "\n")
    Manifest = {
        "created_utc": datetime.datetime.now(datetime.timezone.utc).isoformat(),
        "source_base_revision": subprocess.check_output(["git", "rev-parse", "HEAD"], cwd=Root, text=True).strip(),
        "working_branch": subprocess.check_output(["git", "branch", "--show-current"], cwd=Root, text=True).strip(),
        "source_revision_definition": "Base revision plus SHA-256-identified experimental/exhibit sources in this delivery; no engine code changed.",
        "compiler": subprocess.check_output(["c++", "--version"], text=True).splitlines()[0],
        "platform": platform.platform(), "machine": platform.machine(), "host_vcpus": os.cpu_count(),
        "experiment_threads": min(2, os.cpu_count() or 1),
        "host_cpu_model": next((Line.split(":", 1)[1].strip() for Line in Path("/proc/cpuinfo").read_text().splitlines()
                                if Line.startswith("model name")), "not reported") if Path("/proc/cpuinfo").exists() else platform.processor(),
        "cpu_compile_flags": "-std=c++20 -O3 -fno-fast-math -ffp-contract=off -pthread",
        "shader_compile_flags": "Slang 2026.14.1 -target spirv -profile glsl_450 -fp-mode precise -O0",
        "images": "CPU C++ diagnostic radiance; GPU-labelled distance/cache views are actual Vulkan buffer readbacks, coloured/projected on CPU.",
        "source_selection": "Emissive=1 point=2 uniform solar cap=4 rectangle=8 combined=15; sky/environment/fill=0.",
        "source_physics": "Vehicle lamp radiances retained; point intensity [70,56,42], Sun normal irradiance [3.2,3,2.6], theta=0.00465 rad; rectangle 3x2 m radiance [9,9.5,11]. Relative radiometric RGB units, not calibrated real lights.",
        "vehicle_material_override": "Explicit two-sided matte Lambertian diagnostic, no production paint, metal, refraction, textures or cloth model.",
        "path_limits": "Three scattering sites; deterministic Joe-Kuo 32-dimensional Sobol; no denoiser, radiance clamp, throughput cutoff or roulette. Finite-depth and finite-quadrature error remain.",
        "approximation_notice": "Piecewise-constant facet/0.25m floor radiance cache; raw voxel controls are rejected approximations; local vehicle distance is unsigned, closed calibration boxes signed.",
        "visual_quality_gate": "NOT ACCEPTED: residual grain/structured finite-sample error, diffuse-only model and cache bias. See Inspection.md for actual manual observations.",
        "not_tested": ["physical GPU", "Windows/MSVC runtime", "editor integration", "60/120 FPS", "swapchain/VSync", "full renderer", "DDGI", "voxel cone radiance GI"],
        "source_hashes": {},
    }
    for Directory in [Root / "Experimental/DistanceClipmap", Exhibit / "Code"]:
        for Location in sorted(Directory.rglob("*")):
            if Location.is_file() and "__pycache__" not in Location.parts:
                Manifest["source_hashes"][str(Location.relative_to(Root))] = Digest(Location.read_bytes())
    (Exhibit / "Results/Manifest.json").write_text(json.dumps(Manifest, indent=2) + "\n")
    print(f"Retained {len(Captures)} actual 480x270 captures; full-float hybrid/repeat equality, finite pixels, black controls and three APNG sequences verified.")
    print(json.dumps(Comparisons, indent=2))


if __name__ == "__main__":
    Execute()
