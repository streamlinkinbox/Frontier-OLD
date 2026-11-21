# ============================================================================================================================================
#                                                            VALIDATETRANSPORT.PY
# ============================================================================================================================================
# 🧩 Verify GI pixels, source hashes, executed SPIR-V layouts, runtime reports and disclosed failed gates.

from pathlib import Path
import argparse
import copy
import hashlib
import json
import re
import subprocess
import zlib

import numpy as Numpy
from PIL import Image
from InspectCaptures import EncodeDisplay
from InspectTransport import ExpectedNames

Root = Path(__file__).resolve().parents[3]
Exhibit = Root / "Exhibits/DistanceClipmap"
ConeEntries = ["InjectDirectionalRadiance", "ReduceDirectionalMip", "GatherConeImage", "BounceConeSites"]
ProbeEntries = ["ConvolveProbeIrradiance", "ConvolveProbeMoments", "GatherProbeImage", "BounceProbeRays"]
ReceiverFields = {"Position": (0, 12, "float32"), "Confirmed": (12, 4, "float32"),
                  "Normal": (16, 12, "float32"), "Material": (28, 4, "uint32"),
                  "Reflectance": (32, 12, "float32"), "Padding": (44, 4, "float32")}
PushFields = {Name: (Index * 16, 16, Scalar) for Index, (Name, Scalar) in enumerate([
    ("Counts", "uint32"), ("Locations", "uint32"), ("ClipOrigin0", "int32"), ("ClipOrigin1", "int32"),
    ("ClipOrigin2", "int32"), ("Constraints", "float32"), ("Range", "uint32"), ("Reserved", "float32")])}


def Enforce(Condition, Description):
    if not Condition:
        raise ValueError(Description)


def Digest(Payload):
    return hashlib.sha256(Payload).hexdigest()


def Fnv(Payload):
    Result = 14695981039346656037
    for Byte in Payload:
        Result = ((Result ^ Byte) * 1099511628211) & ((1 << 64) - 1)
    return str(Result)


def Leaves(Footprint, Offset=0, Prefix=""):
    Result = {}
    for Field in Footprint["fields"]:
        Name, Encoding, Address = Prefix + Field["name"], Field["type"], Offset + Field["binding"]["offset"]
        if Encoding["kind"] == "struct":
            Result.update(Leaves(Encoding, Address, Name + "."))
        else:
            if Encoding["kind"] == "vector": Encoding = Encoding["elementType"]
            Result[Name] = (Address, Field["binding"]["size"], Encoding["scalarType"])
    return Result


def ValidateLayout(Reflection, Entry):
    SiteFields = {"Surface." + Name: Entry for Name, Entry in ReceiverFields.items()}
    SiteFields.update({"Direct": (48, 12, "float32"), "Padding": (60, 4, "float32")})
    ConeSchema = {"Sites": (64, SiteFields),
                  "Projections": (32, {"CellFrontBackSigns": (0, 16, "uint32"),
                                        "ProjectedArea": (16, 12, "float32"), "Padding": (28, 4, "float32")}),
                  "CellOffsets": (4, "uint32"), "Voxels": (16, "float32"), "Radiance": (16, "float32"),
                  "Receivers": (48, ReceiverFields), "Distances": (16, "float32"), "Directions": (16, "float32")}
    ProbeSchema = {"Rays": (32, {"Position": (0, 12, "float32"), "SurfaceIndex": (12, 4, "uint32"),
                                  "Normal": (16, 12, "float32"), "Material": (28, 4, "uint32")}),
                   "Direct": (16, "float32"), "IrradianceWeights": (4, "float32"), "MomentWeights": (4, "float32"),
                   "Atlas": (16, "float32"), "Receivers": (48, ReceiverFields), "Confidence": (4, "float32"),
                   "Radiance": (16, "float32")}
    Schema = ConeSchema if Entry in ConeEntries else ProbeSchema
    Schema = dict(Schema, Parameters=(128, PushFields))
    Parameters = {Parameter["name"]: Parameter for Parameter in Reflection["parameters"]}
    Enforce(set(Parameters) == set(Schema), Entry + ": unexpected descriptors")
    for Slot, (Name, (Bytes, Fields)) in enumerate(Schema.items()):
        Parameter = Parameters[Name]
        Push = Name == "Parameters"
        Enforce(Parameter["binding"]["kind"] == ("pushConstantBuffer" if Push else "descriptorTableSlot"), Name + ": resource category")
        Enforce(Parameter["binding"]["index"] == (0 if Push else Slot), Name + ": descriptor slot")
        Footprint = Parameter["type"]["elementType" if Push else "resultType"]
        Uniform = next(Extent for Extent in Footprint["sizes"] if Extent["kind"] == "uniform")
        Enforce(Uniform["value"] == Bytes and Uniform["alignment"] == (4 if Bytes == 4 else 16), Name + ": footprint/stride")
        if isinstance(Fields, dict):
            Enforce(Leaves(Footprint) == Fields, Name + ": member offsets or scalar encoding")
        else:
            Encoding = Footprint["elementType"] if Footprint["kind"] == "vector" else Footprint
            Enforce(Encoding["scalarType"] == Fields, Name + ": precision")
    Point, = Reflection["entryPoints"]
    Enforce(Point["name"] == Entry and Point["threadGroupSize"] == [64, 1, 1], "Compute workgroup contract")


def Execute():
    Parser = argparse.ArgumentParser()
    Parser.add_argument("--shader-directory", type=Path, required=True)
    Parser.add_argument("--compiler", type=Path, required=True)
    Parser.add_argument("--work-directory", type=Path, default=Root / "_ClaudeScratch/tmp/GiFootprints")
    Arguments = Parser.parse_args()
    Summary = json.loads((Exhibit / "Results/GiSummary.json").read_text())
    Enforce(Summary["passed"] is True and Summary["renderer_accepted"] is False,
            "Inspection failed or rejected artifacts were relabelled accepted")
    Enforce(set(Check["name"] for Check in Summary["checks"]) == set(ExpectedNames()), "Native capture list mismatch")
    for Check in Summary["checks"]:
        Name = Check["name"]
        Png = Exhibit / "Images" / (Name + ".png")
        Enforce(Digest(Png.read_bytes()) == Check["png_sha256"] and Image.open(Png).size == (480, 270), Name + ": PNG mismatch")
        if not Check["float_buffer_retained"]:
            Enforce(Name.startswith("GiMotion") and Check["compressed_float_sha256"] is None,
                    "Only disclosed motion Float32 payloads may be omitted")
            continue
        Compressed = (Exhibit / "Buffers" / (Name + ".f32.zlib")).read_bytes()
        Payload = zlib.decompress(Compressed)
        Enforce(len(Payload) == 480 * 270 * 12, "Native Float32 extent changed")
        Enforce(Digest(Payload) == Check["float32_rgb_sha256"] and Digest(Png.read_bytes()) == Check["png_sha256"] and
                Digest(Compressed) == Check["compressed_float_sha256"], Name + ": evidence hash mismatch")
        Pixels = Numpy.frombuffer(Payload, dtype="<f4").reshape(270, 480, 3)
        Enforce(Numpy.isfinite(Pixels).all() and (Pixels >= 0).all(), Name + ": invalid radiance")
        Enforce(Numpy.array_equal(Numpy.asarray(Image.open(Png)), EncodeDisplay(Pixels, Check["exposure"])),
                Name + ": display does not derive from retained radiance")
    Enforce(Summary["lossless_float_buffers"] == sum(Check["float_buffer_retained"] for Check in Summary["checks"]),
            "Float32 retention count mismatch")
    for Name, Animation in Summary["animations"].items():
        Apng, Gif = Exhibit / "Images" / (Name + ".png"), Exhibit / "Images" / (Name + ".gif")
        Enforce(Digest(Apng.read_bytes()) == Animation["apng_sha256"] and Digest(Gif.read_bytes()) == Animation["gif_sha256"],
                "Animation hash mismatch: " + Name)
        Decoded = Image.open(Apng)
        Enforce(Decoded.n_frames == 12 and Image.open(Gif).n_frames == 12, "Animation lost actual poses")
        for Index in range(12):
            Decoded.seek(Index)
            Expected = Image.open(Exhibit / "Images" / (Name + f"{Index:02d}.png")).convert("RGB")
            Enforce(Numpy.array_equal(Numpy.asarray(Decoded.convert("RGB")), Numpy.asarray(Expected)),
                    "APNG differs from actual rendered pose")
    def FloatCapture(Name):
        return Numpy.frombuffer(zlib.decompress((Exhibit / "Buffers" / (Name + ".f32.zlib")).read_bytes()), dtype="<f4").astype(Numpy.float64)
    Reference = FloatCapture("GiCombinedReference512")
    Baseline = Summary["benchmark"]["methods"]["TriangleCache128"]
    for Method, Entry in Summary["benchmark"]["methods"].items():
        Rmse = float(Numpy.sqrt(Numpy.mean((FloatCapture("GiBenchmark" + Method) - Reference) ** 2)))
        Enforce(abs(Rmse - Entry["linear_rgb_rmse"]) < 1e-14 and
                Numpy.median(Entry["gather_ms"]) == Entry["median_gather_ms"], "Timing or RMSE arithmetic mismatch")
        if Method != "TriangleCache128":
            Gate = Entry["median_gather_ms"] < Baseline["median_gather_ms"] and Rmse < Baseline["linear_rgb_rmse"]
            Enforce(Gate == Summary["combined_rmse_and_steady_gather_speed_gates"][Method], "Quality/speed gate arithmetic mismatch")
    for Location, Expected in Summary["source_sha256"].items():
        Enforce(Digest((Root / Location).read_bytes()) == Expected, "Source changed after evidence: " + Location)
    Enforce(Summary["numeric"]["passed"] and Summary["gpu_numeric"]["passed"] and Summary["gpu_capture"]["passed"], "Runtime report failed")
    Enforce(Summary["numeric"]["source_off_exact_black"] and Summary["numeric"]["moving_refresh_equals_cold"], "Transport ablations missing")
    Enforce(Summary["numeric"]["distance_skips"] > 0 and Summary["numeric"]["distance_culling_max_radiance_difference"] == 0,
            "Distance consumption/equality regression")
    Arguments.work_directory.mkdir(parents=True, exist_ok=True)
    Footprints = []
    NegativeRejected = False
    for Entry in ConeEntries + ProbeEntries:
        Source = Root / "Experimental/DistanceClipmap/Transport" / ("ConeTransport.slang" if Entry in ConeEntries else "ProbeTransport.slang")
        Compiled, Reflected = Arguments.work_directory / (Entry + ".spv"), Arguments.work_directory / (Entry + ".json")
        subprocess.run([str(Arguments.compiler.resolve()), str(Source), "-entry", Entry, "-target", "spirv", "-profile", "glsl_450",
                        "-fp-mode", "precise", "-O0", "-o", str(Compiled), "-reflection-json", str(Reflected)], check=True)
        Executed = (Arguments.shader_directory / (Entry + ".spv")).read_bytes()
        Enforce(Compiled.read_bytes() == Executed, Entry + ": reflection compilation differs from executed shader")
        Enforce(Fnv(Executed) == Summary["gpu_numeric"]["executed_spirv_fnv1a64"][Entry], Entry + ": executed-byte identity mismatch")
        Reflection = json.loads(Reflected.read_bytes())
        ValidateLayout(Reflection, Entry)
        if not NegativeRejected:
            Control = copy.deepcopy(Reflection)
            Receiver = next(Parameter for Parameter in Control["parameters"] if Parameter["name"] == "Receivers")
            Material = next(Field for Field in Receiver["type"]["resultType"]["fields"] if Field["name"] == "Material")
            Material["binding"]["offset"] = 32
            try:
                ValidateLayout(Control, Entry)
            except ValueError as Failure:
                Enforce(str(Failure) == "Receivers: member offsets or scalar encoding", "Unrelated footprint rejection")
                NegativeRejected = True
            Enforce(NegativeRejected, "Misaligned material was accepted")
        Footprints.append({"entry": Entry, "executed_spirv_sha256": Digest(Executed), "ssbos": 8,
                           "push_bytes": 128, "threads": [64, 1, 1], "reflection_matches_executed": True})
    Links = re.findall(r'(?:src|href)=["\']([^"\']+)', (Exhibit / "Gi.html").read_text())
    for Link in Links:
        if Link.startswith("#") or ":" in Link: continue
        Enforce((Exhibit / Link).is_file(), "Missing GI viewer reference: " + Link)
    CTest = (Exhibit / "Results/GiCTest.txt").read_text()
    Enforce("100% tests passed, 0 tests failed out of 2" in CTest, "New CTests did not pass 2/2")
    for Name in ["GiSanitizersCpu.txt", "GiSanitizersVulkan.txt"]:
        Log = (Exhibit / "Results" / Name).read_text()
        Enforce(("GI NUMERIC PASS" if Name.endswith("Cpu.txt") else "GI VULKAN PASS") in Log,
                "Sanitizer host did not finish: " + Name)
        Enforce("runtime error:" not in Log and "ERROR: AddressSanitizer" not in Log, "Sanitizer finding: " + Name)
    Integrity = {"passed": True, "native_captures": Summary["native_captures"], "float_buffers": Summary["lossless_float_buffers"],
                 "source_hashes": len(Summary["source_sha256"]), "new_ctests": 2, "host_sanitizers": 2,
                 "footprints": Footprints, "misaligned_material_control_rejected": NegativeRejected,
                 "combined_quality_and_speed_gates": Summary["combined_rmse_and_steady_gather_speed_gates"],
                 "renderer_accepted": False,
                 "scope": "Evidence/layout/runtime integrity only; not visual acceptance, exact physical transport, hardware GPU or editor verification."}
    (Exhibit / "Results/GiIntegrity.json").write_text(json.dumps(Integrity, indent=2) + "\n")
    print(json.dumps({Key: Value for Key, Value in Integrity.items() if Key != "footprints"}))


if __name__ == "__main__":
    try:
        Execute()
    except Exception as Failure:
        (Exhibit / "Results/GiIntegrity.json").write_text(json.dumps({"passed": False, "failure": str(Failure), "renderer_accepted": False}, indent=2) + "\n")
        raise
