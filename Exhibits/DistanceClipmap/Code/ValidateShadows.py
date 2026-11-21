# ============================================================================================================================================
#                                                            VALIDATESHADOWS.PY
# ============================================================================================================================================
# 🧩 Independently verify native pixels, budget / decomposition arithmetic, repeated timing, executed shader layouts and a failing trig control.

from pathlib import Path
import argparse
import copy
import csv
import json
import os
import re
import shutil
import subprocess
import zipfile
import zlib

import numpy as Numpy
from PIL import Image
from InspectShadows import Digest, Display, Enforce, Metrics, NativeNames, SourceLocations
from InspectShadowScope import Labels
from ValidateTransport import Fnv, Leaves, PushFields, ReceiverFields

Root = Path(__file__).resolve().parents[3]
Exhibit = Root / "Exhibits/DistanceClipmap"
Entries = ["PointSdfShadow", "AnalyticSdfPenumbra", "VoxelSdfPenumbra", "VoxelSdfConeGi", "HybridSdfSphereCap",
           "ReferenceSdfPaths", "InspectSdfGeometry", "InspectSdfPath", "InspectSdfBounce"]


# ------------------------------------------------------------------------------------------------------------------------
#                                                  SHADER FOOTPRINT CONSTRAINTS
# ------------------------------------------------------------------------------------------------------------------------

def ValidateLayout(Reflection, Entry):
    PrimitiveFields = {"Position": (0, 12, "float32"), "Shape": (12, 4, "uint32"),
                       "Extent": (16, 12, "float32"), "Material": (28, 4, "uint32")}
    Schema = {"Primitives": (32, PrimitiveFields), "Palette": (16, "float32"), "Distances": (4, "float32"),
              "Voxels": (16, "float32"), "Sobol": (4, "uint32"), "Receivers": (48, ReceiverFields),
              "Results": (16, "float32"), "Directions": (16, "float32"), "Parameters": (128, PushFields)}
    Parameters = {Parameter["name"]: Parameter for Parameter in Reflection["parameters"]}
    Enforce(set(Parameters) == set(Schema), "Unexpected six-path shader descriptors")
    for Slot, (Name, (Bytes, Fields)) in enumerate(Schema.items()):
        Parameter, Push = Parameters[Name], Name == "Parameters"
        Enforce(Parameter["binding"]["kind"] == ("pushConstantBuffer" if Push else "descriptorTableSlot"), Name + ": resource category")
        Enforce(Parameter["binding"]["index"] == (0 if Push else Slot), Name + ": descriptor index")
        Footprint = Parameter["type"]["elementType" if Push else "resultType"]
        Uniform = next(Extent for Extent in Footprint["sizes"] if Extent["kind"] == "uniform")
        Enforce(Uniform["value"] == Bytes and Uniform["alignment"] == (4 if Bytes == 4 else 16), Name + ": stride/alignment")
        if isinstance(Fields, dict):
            Enforce(Leaves(Footprint) == Fields, Name + ": member offsets or scalar precision")
        else:
            Encoding = Footprint["elementType"] if Footprint["kind"] == "vector" else Footprint
            Enforce(Encoding["scalarType"] == Fields, Name + ": scalar precision")
    Point, = Reflection["entryPoints"]
    Enforce(Point["name"] == Entry and Point["threadGroupSize"] == [64, 1, 1], "SDF workgroup contract")


def Compile(Compiler, Source, Entry, Directory):
    Program, Reflection = Directory / (Entry + ".spv"), Directory / (Entry + ".json")
    subprocess.run([str(Compiler), str(Source), "-entry", Entry, "-target", "spirv", "-profile", "glsl_450",
                    "-fp-mode", "precise", "-O0", "-o", str(Program), "-reflection-json", str(Reflection)], check=True)
    return Program, json.loads(Reflection.read_bytes())


def BuiltinControl(Arguments, Source):
    Directory = Arguments.WorkDirectory / "BuiltinAzimuth"
    Directory.mkdir(parents=True, exist_ok=True)
    Text = Source.read_text(encoding="utf-8")
    Start = Text.index("float2 AzimuthPair(float Angle)")
    Opening = Text.index("{", Start)
    Depth, Closing = 1, Opening + 1
    while Depth:
        if Text[Closing] == "{": Depth += 1
        if Text[Closing] == "}": Depth -= 1
        Closing += 1
    Modified = Text[:Opening + 1] + "\n    return float2(cos(Angle), sin(Angle));\n" + Text[Closing - 1:]
    Altered = Directory / "BuiltinAzimuth.slang"
    Altered.write_text(Modified, encoding="utf-8")
    for Entry in Entries:
        Compile(Arguments.Compiler, Altered, Entry, Directory)
    Output = Directory / "Readback"
    Output.mkdir(exist_ok=True)
    if (Output / "ShadowVulkan.json").exists(): (Output / "ShadowVulkan.json").unlink()
    Result = subprocess.run([str(Arguments.BuildDirectory / ("SdfShadowVulkan.exe" if os.name == "nt" else "SdfShadowVulkan")),
                             str(Directory), str(Output), str(Arguments.Driver), "validate"], text=True, capture_output=True)
    Log = Result.stdout + Result.stderr
    (Exhibit / "Results/ShadowBuiltinAzimuthControl.txt").write_text(Log)
    Enforce(Result.returncode == 1 and "Float32 CPU / Vulkan parity exceeded declared tolerance" in Log,
            "Builtin-azimuth control did not fail the unchanged Float32 parity gate")
    Enforce(not (Output / "ShadowVulkan.json").exists(), "Rejected trig control wrote a passing runtime report")
    if (Output / "ShadowPathDiagnostic.csv").exists():
        shutil.copyfile(Output / "ShadowPathDiagnostic.csv", Exhibit / "Results/ShadowBuiltinAzimuthControl.csv")
    return {"rejected": True, "expected_exit": 1, "observed_exit": Result.returncode,
            "modified_function": "AzimuthPair only: device builtin sin/cos instead of shared polynomial",
            "modified_source_sha256": Digest(Altered.read_bytes()), "log_sha256": Digest(Log.encode()),
            "gate_relaxed": False}


# ------------------------------------------------------------------------------------------------------------------------
#                                                 NATIVE FLOAT32 / PIXEL INTEGRITY
# ------------------------------------------------------------------------------------------------------------------------

def Execute():
    Parser = argparse.ArgumentParser()
    Parser.add_argument("--build-directory", dest="BuildDirectory", type=Path, required=True)
    Parser.add_argument("--compiler", dest="Compiler", type=Path, required=True)
    Parser.add_argument("--driver", dest="Driver", type=Path, required=True)
    Parser.add_argument("--work-directory", dest="WorkDirectory", type=Path, default=Root / "_ClaudeScratch/tmp/ShadowFootprints")
    Arguments = Parser.parse_args()
    for Name in ["BuildDirectory", "Compiler", "Driver", "WorkDirectory"]:
        setattr(Arguments, Name, getattr(Arguments, Name).resolve())
    Arguments.WorkDirectory.mkdir(parents=True, exist_ok=True)
    Summary = json.loads((Exhibit / "Results/ShadowSummary.json").read_bytes())
    Enforce(Summary["passed"] is True and Summary["new_native_shadow_paths_executed"] == 6 and
            Summary["renderer_accepted"] is False, "Incomplete captures or production acceptance was fabricated")
    Enforce(Summary["labels"] == Labels, "Requested path labels changed")
    Enforce(Summary["better_quality_and_faster_production_gate"] is False, "Rejected renderer was relabelled accepted")
    RoomNames, VehicleNames = NativeNames()
    Expected = set(RoomNames + VehicleNames + ["Shadow5TwoSites"] + [f"Shadow{Mode}DirectError" for Mode in range(6)])
    Enforce(set(Check["name"] for Check in Summary["checks"]) == Expected, "Capture selection mismatch")
    FloatPixels, UniqueBuffers, Omitted = {}, set(), 0
    for Check in Summary["checks"]:
        Name = Check["name"]
        Png = Exhibit / "Images" / (Name + ".png")
        Enforce(Digest(Png.read_bytes()) == Check["png_sha256"] and Image.open(Png).size == (480, 270), Name + ": PNG changed")
        Buffer = Check["float_buffer"]
        if Buffer is None:
            Enforce(Name in [f"ShadowVehicle{Pose}{Suffix}" for Pose in range(1, 6) for Suffix in ["Direct", "Indirect", "Combined"]],
                    "Undisclosed Float32 omission")
            Enforce(Check["buffer_sha256"] is None and re.fullmatch(r"[0-9a-f]{64}", Check["float32_rgb_sha256"]), "Missing motion float digest")
            Omitted += 1
            continue
        Enforce(Buffer.startswith("Buffers/Shadow") and ".." not in Buffer and Buffer.endswith(".f32.zlib"), "Invalid buffer path")
        Compressed = (Exhibit / Buffer).read_bytes()
        Payload = zlib.decompress(Compressed)
        Enforce(len(Payload) == 480 * 270 * 12 and Digest(Payload) == Check["float32_rgb_sha256"] and
                Digest(Compressed) == Check["buffer_sha256"], Name + ": Float32 mismatch")
        Pixels = Numpy.frombuffer(Payload, dtype="<f4").reshape(270, 480, 3)
        Enforce(Numpy.isfinite(Pixels).all() and (Check["signed_distance_m"] or (Pixels >= 0).all()), Name + ": invalid channels")
        Enforce(Numpy.array_equal(Display(Name, Pixels, Check["exposure"]), Numpy.asarray(Image.open(Png))), Name + ": display differs from actual radiance")
        Enforce(float(Pixels.min()) == Check["minimum"] and float(Pixels.max()) == Check["maximum"], Name + ": pixel extrema changed")
        UniqueBuffers.add(Buffer)
        FloatPixels[Name] = Pixels
    Enforce(len(UniqueBuffers) == Summary["unique_lossless_float_buffers"] and Omitted == Summary["motion_float_payloads_omitted"] == 15,
            "Evidence retention arithmetic mismatch")
    for Mode in range(6):
        Enforce(Numpy.array_equal(FloatPixels[f"Shadow{Mode}Combined"], FloatPixels[f"Shadow{Mode}Direct"] + FloatPixels[f"Shadow{Mode}Indirect"]), "Nonlinear direct / indirect sum")
        Enforce(Numpy.count_nonzero(FloatPixels[f"Shadow{Mode}Off"]) == 0, "Source-off nonzero")
        if Mode not in [3, 5]: Enforce(Numpy.count_nonzero(FloatPixels[f"Shadow{Mode}Indirect"]) == 0, "Hidden GI in direct-only path")
        Measured = Metrics(FloatPixels[f"Shadow{Mode}Direct"], FloatPixels["Shadow5Direct"], FloatPixels["ShadowPrimaryMasks"])
        Enforce(Measured == Summary["comparisons"]["direct_to_finite_96"][str(Mode)], "Direct RMSE arithmetic changed")
        Enforce(Numpy.array_equal(FloatPixels[f"Shadow{Mode}DirectError"], Numpy.abs(FloatPixels[f"Shadow{Mode}Direct"] - FloatPixels["Shadow5Direct"])), "Incorrect direct difference")
    Enforce(Numpy.array_equal(FloatPixels["Shadow2Direct"], FloatPixels["Shadow3Direct"]), "Path 3 changed path 2 shadows")
    Enforce(Numpy.array_equal(FloatPixels["Shadow5TwoSites"], FloatPixels["Shadow5Direct"] + FloatPixels["Shadow5OneBounce"]), "Matched-depth reference mismatch")
    Enforce(Metrics(FloatPixels["Shadow3Indirect"], FloatPixels["Shadow5OneBounce"], FloatPixels["ShadowPrimaryMasks"]) ==
            Summary["comparisons"]["cone_gi_to_matched_one_secondary_site_96"], "GI RMSE was compared against a different depth")
    Enforce(Metrics(FloatPixels["Shadow3Combined"], FloatPixels["Shadow5TwoSites"], FloatPixels["ShadowPrimaryMasks"]) ==
            Summary["comparisons"]["cone_combined_to_matched_two_sites_96"], "Matched combined RMSE arithmetic")
    Enforce(Numpy.array_equal(FloatPixels["ShadowVehicleCacheCleared"], FloatPixels["ShadowVehicle0Direct"]) and
            Numpy.array_equal(FloatPixels["ShadowVehicleCacheRestored"], FloatPixels["ShadowVehicle0Combined"]) and
            Numpy.count_nonzero(FloatPixels["ShadowVehicleOff"]) == 0, "Actual vehicle clear / restore / off pixels changed")
    for Animation in Summary["animations"].values():
        Location = Exhibit / Animation["file"]
        Enforce(Digest(Location.read_bytes()) == Animation["sha256"], "Motion APNG digest mismatch")
        Decoded = Image.open(Location)
        Enforce(Decoded.n_frames == 6, "Missing actual vehicle pose")
        for Index, Name in enumerate(Animation["frames"]):
            Decoded.seek(Index)
            Enforce(Numpy.array_equal(Numpy.asarray(Decoded.convert("RGB")), Numpy.asarray(Image.open(Exhibit / "Images" / (Name + ".png")))),
                    "Motion APNG substituted / interpolated pixels")
    Archive = Exhibit / "Results/ShadowSixRenders.zip"
    Enforce(Digest(Archive.read_bytes()) == Summary["archive_sha256"], "Download archive changed")
    with zipfile.ZipFile(Archive) as Zip:
        Enforce(Zip.namelist() == [f"Shadow{Mode}Combined.png" for Mode in range(6)], "Archive lost a requested render")
        for Name in Zip.namelist(): Enforce(Zip.read(Name) == (Exhibit / "Images" / Name).read_bytes(), "Archived render is different")

    # --------------------------------------------------------------------------------------------------------------------
    #                                              RUNTIME / TIMING / SOURCE IDENTITY
    # --------------------------------------------------------------------------------------------------------------------

    for Name, Report in Summary["runtime"].items():
        Enforce(Report == json.loads((Exhibit / "Results" / (Name + ".json")).read_bytes()) and Report["passed"] is True and
                Report["renderer_accepted"] is False, "Failed or changed runtime report: " + Name)
    Capture, Numeric = Summary["runtime"]["ShadowCapture"], Summary["runtime"]["ShadowNumeric"]
    Enforce(Capture["paths_rendered"] == list(range(6)) and Capture["native_captures"] == 40 and
            Capture["primary_sites"] * Capture["paths_per_primary_site_reference"] == Capture["paths_total_per_pixel_reference"] == 96,
            "96 spp became 96 secondary samples per each primary site")
    Enforce(Capture["source_off_black_pixels"] == 6 * 480 * 270 and Capture["other_sources"] == 0, "Missing sphere-only/off isolation")
    Enforce(Numeric["hybrid_visibility_differences"] == 0 and Numeric["hybrid_clip_skips"] > 0 and
            Numeric["hybrid_sdf_refinements"] > 0 and Numeric["thin_grazing_far_segments"] == 256, "Unexecuted SDF visibility controls")
    Enforce(Numeric["distance_clear_rgb_difference"] > 0 and Numeric["distance_restore_rgb_difference"] == 0 and
            Numeric["radiance_clear_maximum"] == 0 and Numeric["radiance_restore_difference"] == 0, "Distance / GI consumption regression")
    Profiles = list(csv.DictReader((Exhibit / "Results/ShadowProfiles.csv").open()))
    Enforce(len(Profiles) == 4 * 385 and all(Row["hybrid"] == Row["reference"] for Row in Profiles), "Finite penumbra profiles differ under SDF skips")
    Widths = Numeric["penumbra_10_90_widths_m"]
    Enforce(all(0 < Left < Right for Left, Right in zip(Widths, Widths[1:])), "Penumbra width did not increase")
    Vehicle = Summary["runtime"]["ShadowVehicle"]
    Enforce(len(Vehicle["poses"]) == 6 and Vehicle["vehicle_facets"] == 25068 and Vehicle["analytic_vehicle_sdf"] is False and
            Vehicle["contact_refinement"] == "original triangles" and Vehicle["stale_rejections"] == 6 and
            Vehicle["cold_image_maximum"] == Vehicle["cold_clip_maximum"] == Vehicle["visibility_differences"] == 0 and
            Vehicle["bake_march_steps"] > 0 and Vehicle["empty_marched_segments"] > 0 and
            Vehicle["source_off_black_pixels"] == 480 * 270, "Actual moving vehicle / bake / reset evidence failed")
    Rows = list(csv.DictReader((Exhibit / "Results/ShadowBenchmark.csv").open()))
    for Round in range(-1, 5):
        Order = [int(Row["selection"]) for Row in Rows if int(Row["round"]) == Round]
        Enforce(Order == (list(range(6, -1, -1)) if Round >= 0 and Round % 2 else list(range(7))), "Benchmark order is not alternating")
    for Mode in range(7):
        Selected = [Row for Row in Rows if int(Row["selection"]) == Mode]
        Timings = [float(Row["cpu_ms"]) for Row in Selected if int(Row["round"]) >= 0]
        Method = Summary["benchmark"]["methods"][str(Mode)]
        Name = f"Shadow{Mode}Combined" if Mode < 6 else "Shadow5Direct"
        Enforce(Timings == Method["cpu_ms"] and float(Numpy.median(Timings)) == Method["median_cpu_ms"], "Median timing arithmetic")
        Enforce({Row["fnv1a64"] for Row in Selected} == {Method["fnv1a64"]} == {Fnv(FloatPixels[Name].tobytes())}, "Benchmark was not repeat-identical to retained image")
    Enforce(set(Summary["source_sha256"]) == set(SourceLocations()), "Source identity list changed")
    for Location, ExpectedDigest in Summary["source_sha256"].items():
        Enforce(Digest((Root / Location).read_bytes()) == ExpectedDigest, "Source changed after captures: " + Location)
    for Name, ExpectedDigest in Summary["executables_sha256"].items():
        Suffix = ".exe" if os.name == "nt" else ""
        Enforce(Digest((Arguments.BuildDirectory / (Name + Suffix)).read_bytes()) == ExpectedDigest, "Executed native host changed")
    for Name, Marker in [("ShadowSanitizersCpu.txt", "SDF shadow validate completed"),
                         ("ShadowSanitizersVulkan.txt", "Nine SDF shader entries completed")]:
        Log = (Exhibit / "Results" / Name).read_text(encoding="utf-8")
        Enforce(Marker in Log and "ERROR: AddressSanitizer" not in Log and "runtime error:" not in Log, "Sanitizer run incomplete / failed")
    CTestLog = (Exhibit / "Results/ShadowCTest.txt").read_text(encoding="utf-8")
    Enforce("100% tests passed, 0 tests failed out of 2" in CTestLog or "100% tests passed out of 2" in CTestLog,
            "Current CTests did not pass 2/2")

    # --------------------------------------------------------------------------------------------------------------------
    #                                           EXACT EXECUTED-SPIRV REFLECTION / CONTROLS
    # --------------------------------------------------------------------------------------------------------------------

    Gpu = Summary["runtime"]["ShadowVulkan"]
    Enforce(set(Gpu["executed_entries_fnv1a64"]) == set(Entries) and Gpu["guarded_regions"] == 8 and
            Gpu["guard_bytes_each"] == 64 and Gpu["source_off_black_pixels"] == 6 * Gpu["compared_pixels_each_path"] and
            Gpu["distance_clear_rgb_difference"] > 0 and Gpu["cull_disabled_difference"] < 1e-6 and
            Gpu["restore_difference"] == Gpu["radiance_clear_maximum"] == 0 and
            Gpu["moving_sdf_source_changed_pixels"] > 0, "Missing GPU execution / field ablations")
    Source = Root / "Experimental/DistanceClipmap/Shadows/SdfShadows.slang"
    Footprints, MisalignedRejected = [], False
    for Entry in Entries:
        Program, Reflection = Compile(Arguments.Compiler, Source, Entry, Arguments.WorkDirectory)
        Executed = (Arguments.BuildDirectory / "Shaders" / (Entry + ".spv")).read_bytes()
        Enforce(Program.read_bytes() == Executed and Fnv(Executed) == Gpu["executed_entries_fnv1a64"][Entry], "Reflected shader differs from executed bytes")
        ValidateLayout(Reflection, Entry)
        if not MisalignedRejected:
            Control = copy.deepcopy(Reflection)
            Primitive = next(Parameter for Parameter in Control["parameters"] if Parameter["name"] == "Primitives")
            Shape = next(Field for Field in Primitive["type"]["resultType"]["fields"] if Field["name"] == "Shape")
            Shape["binding"]["offset"] = 16
            try:
                ValidateLayout(Control, Entry)
            except ValueError as Failure:
                Enforce(str(Failure) == "Primitives: member offsets or scalar precision", "Unrelated layout rejection")
                MisalignedRejected = True
            Enforce(MisalignedRejected, "Misaligned SDF primitive was accepted")
        Footprints.append({"entry": Entry, "executed_spirv_sha256": Digest(Executed), "ssbos": 8, "push_bytes": 128,
                           "reflection_matches_executed": True})
    Control = BuiltinControl(Arguments, Source)
    Integrity = {"passed": True, "new_native_shadow_paths_executed": 6, "native_captures": Summary["native_captures"],
                 "unique_float_buffers": len(UniqueBuffers), "motion_float_payloads_omitted": Omitted,
                 "source_hashes": len(Summary["source_sha256"]), "new_ctests": 2, "host_sanitizer_runs": 2,
                 "footprints": Footprints, "misaligned_primitive_control_rejected": MisalignedRejected,
                 "builtin_azimuth_control": Control, "renderer_accepted": False,
                 "scope": "Native render / evidence / bounded software Vulkan integrity, not production quality, hardware GPU or Windows/editor acceptance."}
    (Exhibit / "Results/ShadowIntegrity.json").write_text(json.dumps(Integrity, indent=2) + "\n")
    print(json.dumps({Key: Entry for Key, Entry in Integrity.items() if Key not in ["footprints", "builtin_azimuth_control"]}))


if __name__ == "__main__":
    try:
        Execute()
    except Exception as Failure:
        (Exhibit / "Results/ShadowIntegrity.json").write_text(json.dumps({"passed": False, "failure": str(Failure), "renderer_accepted": False}, indent=2) + "\n")
        raise
