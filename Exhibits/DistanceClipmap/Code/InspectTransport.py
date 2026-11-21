# ============================================================================================================================================
#                                                            INSPECTTRANSPORT.PY
# ============================================================================================================================================
# 🧩 Derive source-isolation comparisons, lossless archives, motion and measurements from native GI captures.

from pathlib import Path
import argparse
import datetime
import hashlib
import json
import shutil
import subprocess
import zlib

import numpy as Numpy
from PIL import Image, ImageDraw, ImageFont
from InspectCaptures import DecodePfm, EncodeDisplay, ContactSheet, Animate

Root = Path(__file__).resolve().parents[3]
Exhibit = Root / "Exhibits/DistanceClipmap"
Sources = ["Emissive", "Point", "Sun", "Area", "Combined", "Off"]


def Digest(Payload):
    return hashlib.sha256(Payload).hexdigest()


def Error(A, B):
    Delta = A.astype(Numpy.float64) - B.astype(Numpy.float64)
    return {"linear_rgb_rmse": float(Numpy.sqrt(Numpy.mean(Delta ** 2))),
            "max_channel_difference": float(Numpy.abs(Delta).max())}


def ExpectedNames():
    Names = ["Gi" + Source + Suffix for Source in Sources
             for Suffix in ["Direct", "Cone", "Probe", "ConeLit", "ProbeLit"]]
    Names += ["Gi" + Source + Suffix for Source in ["Emissive", "Combined"]
              for Suffix in ["Reference512", "Reference128", "Cone2", "Probe2", "Cone4", "Probe4",
                             "Cone4Lit", "Probe4Lit", "Reference2Sites512", "GpuCone", "GpuProbe"]]
    Names += [f"GiRadianceLevel{Index}" for Index in range(3)]
    Names += [f"GiMotion{Method}{Lit}{Index:02d}" for Method in ["Cone", "Probe"]
              for Lit in ["", "Lit"] for Index in range(12)]
    Names += ["GiBenchmark" + Method for Method in ["TriangleCache128", "Cone", "Probe"]]
    return Names


def BenchmarkChart(Summary):
    Picture = Image.new("RGB", (1100, 420), "#111a24")
    Pen = ImageDraw.Draw(Picture)
    Heading, Caption = ImageFont.load_default(size=22), ImageFont.load_default(size=16)
    Pen.text((22, 18), "GI comparison: speed does not remove bias", font=Heading, fill="#f1f4fa")
    Pen.text((22, 52), "480 x 270 | 4 primary | Float32 | five alternating rounds | no denoiser", font=Caption, fill="#a8b4c7")
    Methods = Summary["benchmark"]["methods"]
    Maximum = max(Entry["median_gather_ms"] for Entry in Methods.values())
    for Index, Name in enumerate(["TriangleCache128", "Cone", "Probe"]):
        Entry = Methods[Name]
        Y = 103 + Index * 74
        Pen.text((22, Y), Name, font=Caption, fill="#eef3f8")
        Length = max(1, round(400 * Entry["median_gather_ms"] / Maximum))
        Pen.rectangle((228, Y, 228 + Length, Y + 25), fill=["#95a9c9", "#e8a58c", "#89ccbf"][Index])
        Pen.text((240 + Length, Y + 1), f'{Entry["median_gather_ms"]:.1f} ms', font=Caption, fill="#eef3f8")
        Pen.text((815, Y), f'RMSE {Entry["linear_rgb_rmse"]:.6f}', font=Caption, fill="#eef3f8")
    Pen.text((22, 339), "RMSE is against finite 512-sample triangle GI, not ground truth. Separate cold costs in JSON.", font=Caption, fill="#a8b4c7")
    Pen.text((22, 373), "REJECTED: cone energy/detail loss; probe blotches/leaks; matte materials; no user-GPU timing.", font=Caption, fill="#f2a49c")
    Picture.save(Exhibit / "Images/GiBenchmark.png")


def Execute():
    Parser = argparse.ArgumentParser()
    Parser.add_argument("capture_directory", type=Path)
    Parser.add_argument("--build-directory", type=Path, required=True)
    Arguments = Parser.parse_args()
    InputDirectory, Build = Arguments.capture_directory, Arguments.build_directory
    Names = ExpectedNames()
    Captures = {Name: DecodePfm(InputDirectory / (Name + ".pfm")) for Name in Names}
    Checks = []
    for Name, Pixels in Captures.items():
        if not Numpy.isfinite(Pixels).all() or (Pixels < 0).any():
            raise AssertionError("Nonfinite or negative GI capture: " + Name)
        ExpectedBlack = Name.startswith("GiOff")
        if bool(Numpy.count_nonzero(Pixels)) == ExpectedBlack:
            raise AssertionError("Unexpected black/nonblack GI capture: " + Name)
        Exposure = 1 if "Lit" in Name or Name.endswith("Direct") else 8
        Encoded = EncodeDisplay(Pixels, Exposure)
        Output = Exhibit / "Images" / (Name + ".png")
        Image.fromarray(Encoded).save(Output)
        if not Numpy.array_equal(Numpy.asarray(Image.open(Output)), Encoded):
            raise AssertionError("PNG did not preserve encoded RGB: " + Name)
        Payload = Pixels.astype("<f4").tobytes()
        Buffer = Exhibit / "Buffers" / (Name + ".f32.zlib")
        RetainFloat = not Name.startswith("GiMotion")
        if RetainFloat:
            Buffer.write_bytes(zlib.compress(Payload, 9))
            if zlib.decompress(Buffer.read_bytes()) != Payload:
                raise AssertionError("Float32 archival loss: " + Name)
        elif Buffer.is_file():
            # Motion keeps raw-float hashes plus lossless display frames, following the earlier exhibit's Git budget.
            Buffer.unlink()
        Checks.append({"name": Name, "width": 480, "height": 270, "channels": 3,
                       "exposure": Exposure, "nonfinite": 0, "negative": 0,
                       "mean_linear": float(Pixels.mean()), "maximum_linear": float(Pixels.max()),
                       "encoded_white_rgb_pixels": int(Numpy.count_nonzero(Numpy.all(Encoded == 255, axis=2))),
                       "float32_rgb_sha256": Digest(Payload), "png_sha256": Digest(Output.read_bytes()),
                       "float_buffer_retained": RetainFloat,
                       "compressed_float_sha256": Digest(Buffer.read_bytes()) if RetainFloat else None})
    Additivity = {}
    for Method in ["Direct", "Cone", "Probe"]:
        Summed = sum((Captures["Gi" + Source + Method].astype(Numpy.float64) for Source in Sources[:4]))
        Maximum = float(Numpy.abs(Summed - Captures["GiCombined" + Method]).max())
        if Maximum > 2e-5:
            raise AssertionError("Source additivity failed: " + Method)
        Additivity[Method] = Maximum
    Comparisons = {}
    for Source in ["Emissive", "Combined"]:
        Reference = Captures["Gi" + Source + "Reference512"]
        Comparisons[Source] = {
            Method: Error(Captures["Gi" + Source + Method], Reference) for Method in ["Cone", "Probe"]}
        Comparisons[Source]["finite_128_to_512_delta_not_ground_truth_error"] = Error(Captures["Gi" + Source + "Reference128"], Reference)
        for Method in ["Cone", "Probe"]:
            Previous = Captures["Gi" + Source + Method]
            for Bounce in [2, 4]:
                Current = Captures[f"Gi{Source}{Method}{Bounce}"]
                if float((Current - Previous).min()) < -2e-6:
                    raise AssertionError("Positive multi-bounce propagation lost energy")
                Previous = Current
            Comparisons[Source][Method + "2_vs_finite_two_secondary_sites"] = Error(
                Captures[f"Gi{Source}{Method}2"], Captures[f"Gi{Source}Reference2Sites512"])
            GpuDifference = Error(Captures[f"Gi{Source}Gpu{Method}"], Captures[f"Gi{Source}{Method}"])
            if GpuDifference["max_channel_difference"] > 2e-4:
                raise AssertionError("Full native GPU GI image parity failed")
            Comparisons[Source][Method + "_gpu_vs_cpu"] = GpuDifference
    Benchmark = json.loads((InputDirectory / "GiBenchmark.json").read_text())
    for Method, Entry in Benchmark["methods"].items():
        Entry.update(Error(Captures["GiBenchmark" + Method], Captures["GiCombinedReference512"]))
        if len(Entry["gather_ms"]) != 5 or Numpy.median(Entry["gather_ms"]) != Entry["median_gather_ms"]:
            raise AssertionError("Incorrect five-round timing median")
    Baseline = Benchmark["methods"]["TriangleCache128"]
    MetricGates = {Method: Entry["median_gather_ms"] < Baseline["median_gather_ms"] and
                  Entry["linear_rgb_rmse"] < Baseline["linear_rgb_rmse"]
                  for Method, Entry in Benchmark["methods"].items() if Method != "TriangleCache128"}
    Numeric = json.loads((InputDirectory / "GiNumeric.json").read_text())
    Gpu = json.loads((InputDirectory / "GiVulkan.json").read_text())
    GpuCapture = json.loads((InputDirectory / "GiVulkanCapture.json").read_text())
    if not Numeric["passed"] or not Gpu["passed"] or not GpuCapture["passed"]:
        raise AssertionError("Transport runtime report failed")
    Summary = {
        "passed": True,
        "generated_utc": datetime.datetime.now(datetime.timezone.utc).isoformat(),
        "base_revision": subprocess.check_output(["git", "rev-parse", "HEAD"], cwd=Root, text=True).strip(),
        "native_captures": len(Names), "lossless_float_buffers": sum(Check["float_buffer_retained"] for Check in Checks),
        "motion_storage": "All 48 motion PNGs, raw Float32 hashes and four RGB-lossless APNGs retained; motion Float32 payloads remain reproducible, not archived in Git. No render precision/budget change.",
        "source_additivity_max_channel_error": Additivity,
        "comparisons": Comparisons, "benchmark": Benchmark, "numeric": Numeric,
        "gpu_numeric": Gpu, "gpu_capture": GpuCapture,
        "combined_rmse_and_steady_gather_speed_gates": MetricGates,
        "renderer_accepted": False,
        "visual_rejections": ["Cone GI loses near-field energy/detail and has voxel/level bias.",
                              "Probe GI still exhibits spatial blotches and visibility leakage.",
                              "Finite reference remains grainy; no exact/noise-free ground truth is available.",
                              "Diagnostic Lambertian materials are not the production car materials."],
        "gpu_boundary": "GI injection/convolution/gather/bounces execute in Slang. Geometry intersections, source relighting and primary surface samples are CPU inputs. Not a full GPU renderer.",
        "mapping": "Top-down little-endian Float32 RGB; linear exposure (GI x8, direct/lit x1), Reinhard x/(1+x), IEC sRGB. No denoiser/history/radiance clamp.",
        "checks": Checks,
    }
    SheetNames, Titles = [], []
    for Source in Sources:
        for Method in ["Direct", "Cone", "Probe"]:
            SheetNames.append("Gi" + Source + Method)
            Titles.append(Source + " - " + Method + (" x1" if Method == "Direct" else " GI x8"))
    ContactSheet(SheetNames, Titles, Exhibit / "Images/GiSourceIsolation.png")
    for Source in ["Emissive", "Combined"]:
        SheetNames = [f"Gi{Source}{Suffix}" for Suffix in ["Cone", "Probe", "Reference512", "Cone2", "Probe2", "Reference2Sites512", "Cone4", "Probe4", "Probe4Lit"]]
        Titles = ["Cone 1 - GI x8", "Probe 1 - GI x8", "Finite triangle 512 - 1 secondary site x8",
                  "Cone 2 - GI x8", "Probe 2 - GI x8", "Finite triangle 512 - 2 secondary sites x8",
                  "Cone 4 - GI x8", "Probe 4 - GI x8", "Direct + probe 4 - x1"]
        ContactSheet(SheetNames, Titles, Exhibit / f"Images/Gi{Source}Inspection.png")
    Summary["animations"] = {}
    for Method in ["Cone", "Probe"]:
        for Lit in ["", "Lit"]:
            Entries = [f"GiMotion{Method}{Lit}{Index:02d}" for Index in range(12)]
            Name = f"GiMotion{Method}{Lit}"
            Summary["animations"][Name] = Animate(Entries, Name)
            Summary["animations"][Name].update({
                "apng_sha256": Digest((Exhibit / "Images" / (Name + ".png")).read_bytes()),
                "gif_sha256": Digest((Exhibit / "Images" / (Name + ".gif")).read_bytes())})
        Entries = [f"GiMotion{Method}{Index:02d}" for Index in range(12)]
        ContactSheet(Entries, [f"{Method} emitter GI x8 - pose {Index:02d}, t={Index/3:.3f}s" for Index in range(12)],
                     Exhibit / f"Images/GiMotion{Method}AllPoses.png")
    ContactSheet(["GiEmissiveGpuCone", "GiEmissiveGpuProbe", "GiCombinedGpuCone", "GiCombinedGpuProbe"],
                 ["Vulkan cone emitter GI x8", "Vulkan probe emitter GI x8", "Vulkan cone combined GI x8", "Vulkan probe combined GI x8"],
                 Exhibit / "Images/GiGpuInspection.png", Columns=2)
    BenchmarkChart(Summary)
    for Name in ["GiNumeric.json", "GiVulkan.json", "GiVulkanCapture.json", "GiBenchmark.json", "GiTimings.csv",
                 "GiMotionTimings.csv", "GiEmissiveResiduals.json", "GiCombinedResiduals.json"]:
        shutil.copy2(InputDirectory / Name, Exhibit / "Results" / Name)
    Summary["source_sha256"] = {}
    Paths = list((Root / "Experimental/DistanceClipmap/Transport").glob("*"))
    Paths += [Root / "Experimental/DistanceClipmap" / Name for Name in ["RadianceScene.h", "FacetDistance.h", "DistanceClipmap.h", "SobolDirections.h"]]
    Paths += [Path(__file__), Exhibit / "Gi.html", Exhibit / "Transport.md", Exhibit / "Code/InspectCaptures.py"]
    Paths += [Exhibit / "Code" / Name for Name in ["TransportValidation.cpp", "TransportVulkan.cpp", "TransportCompute.h",
                                                   "ValidateTransport.py", "ValidateTransportPresentation.cjs", "ServeTransport.py"]]
    Paths += [Root / "Exhibits/Renderer/Code/VulkanReadback.h",
              Root / "Frontier/Engine/Rendering/TriangleVisibilitySpace.h"]
    for Pathname in Paths:
        if Pathname.is_file(): Summary["source_sha256"][str(Pathname.relative_to(Root))] = Digest(Pathname.read_bytes())
    Summary["native_products_sha256"] = {}
    for Name in ["TransportValidation", "TransportVulkan"]:
        Executable = Build / Name
        if not Executable.is_file(): Executable = Build / (Name + ".exe")
        Summary["native_products_sha256"][Executable.name] = Digest(Executable.read_bytes())
    (Exhibit / "Results/GiSummary.json").write_text(json.dumps(Summary, indent=2) + "\n")
    (Exhibit / "Results/GiIntegrity.json").write_text(json.dumps({
        "passed": False, "status": "Evidence regenerated; awaiting ValidateTransport.py", "renderer_accepted": False}, indent=2) + "\n")
    print(json.dumps({"native_captures": len(Names), "float_buffers": Summary["lossless_float_buffers"], "source_additivity": Additivity,
                      "metric_gates": MetricGates, "renderer_accepted": False}))


if __name__ == "__main__":
    try:
        Execute()
    except Exception as Failure:
        (Exhibit / "Results/GiSummary.json").write_text(json.dumps({"passed": False, "failure": str(Failure), "renderer_accepted": False}, indent=2) + "\n")
        raise
