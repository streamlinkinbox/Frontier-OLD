# ============================================================================================================================================
#                                                          VALIDATEFOOTPRINTS.PY
# ============================================================================================================================================
# 🧩 Compare Slang reflection with the native Vulkan footprints and the actual executed SPIR-V byte streams.

from pathlib import Path
import argparse
import copy
import hashlib
import json
import subprocess

Root = Path(__file__).resolve().parents[3]
Entries = ["BakeLocalDistance", "FillClipmap", "EvaluateDistanceProbes", "RelightVehicleCache",
           "GatherVehicleCache", "ClearVehicleCache"]
# Offset, size and scalar encoding must agree with C++ assertions and mapped-buffer allocations.
Footprints = {
    "Enclosures": (0, 48, [("Minimum", 0, 16, "float32"), ("Maximum", 16, 16, "float32"),
                            ("Links", 32, 16, "uint32")]),
    "Facets": (1, 48, [("A", 0, 12, "float32"), ("Material", 12, 4, "uint32"),
                        ("B", 16, 16, "float32"), ("C", 32, 16, "float32")]),
    "LocalDistances": (2, 4, []),
    "ClipDistances": (3, 16, []),
    "Probes": (4, 48, [("OriginLimit", 0, 16, "float32"), ("Direction", 16, 16, "float32"),
                        ("Position", 32, 16, "float32")]),
    "Results": (5, 16, []),
    "Boxes": (6, 32, [("Centre", 0, 16, "float32"), ("HalfExtent", 16, 16, "float32")]),
    "SurfaceRadiance": (7, 16, []),
    "Parameters": (0, 128, [
        ("LocalMinimum", 0, 16, "float32"), ("LocalSpacing", 16, 16, "float32"),
        ("ExtentAndCount", 32, 16, "uint32"), ("PoseCosineSine", 48, 16, "float32"),
        ("Translation", 64, 16, "float32"), ("ClipOrigin0", 80, 16, "int32"),
        ("ClipOrigin1", 96, 16, "int32"), ("ClipOrigin2", 112, 16, "int32"),
    ]),
}


def Enforce(Condition, Description):
    if not Condition:
        raise ValueError(Description)


def ValidateReflection(Reflection, Entry):
    Parameters = {Parameter["name"]: Parameter for Parameter in Reflection["parameters"]}
    Enforce(set(Parameters) == set(Footprints), "Unexpected or missing shader parameter")
    for Name, (Slot, Bytes, Fields) in Footprints.items():
        Parameter = Parameters[Name]
        Category = "pushConstantBuffer" if Name == "Parameters" else "descriptorTableSlot"
        Enforce(Parameter["binding"]["kind"] == Category, f"{Name}: resource category mismatch")
        Enforce(Parameter["binding"]["index"] == Slot, f"{Name}: descriptor offset mismatch")
        Resource = Parameter["type"]
        Footprint = Resource["elementType"] if Name == "Parameters" else Resource["resultType"]
        Uniform = next(Extent for Extent in Footprint["sizes"] if Extent["kind"] == "uniform")
        Enforce(Uniform["value"] == Bytes, f"{Name}: byte extent mismatch")
        ExpectedAlignment = 4 if Name == "LocalDistances" else 16
        Enforce(Uniform["alignment"] == ExpectedAlignment, f"{Name}: alignment mismatch")
        if Fields:
            Members = {Member["name"]: Member for Member in Footprint["fields"]}
            Enforce(set(Members) == {Field[0] for Field in Fields}, f"{Name}: members mismatch")
            for Field, Offset, Extent, Scalar in Fields:
                Member = Members[Field]
                Enforce(Member["binding"]["offset"] == Offset, f"{Name}.{Field}: offset mismatch")
                Enforce(Member["binding"]["size"] == Extent, f"{Name}.{Field}: size mismatch")
                Encoding = Member["type"]
                if Encoding["kind"] == "vector":
                    Encoding = Encoding["elementType"]
                Enforce(Encoding["scalarType"] == Scalar, f"{Name}.{Field}: scalar encoding mismatch")
        else:
            Encoding = Footprint["elementType"] if Footprint["kind"] == "vector" else Footprint
            Enforce(Encoding["scalarType"] == "float32", f"{Name}: Float32 storage required")
    EntryPoint, = Reflection["entryPoints"]
    Enforce(EntryPoint["name"] == Entry, "Entry point mismatch")
    Enforce(EntryPoint["threadGroupSize"] == [64, 1, 1], "Workgroup extent mismatch")


def Execute():
    Parser = argparse.ArgumentParser()
    Parser.add_argument("compiler", type=Path)
    Parser.add_argument("shader_directory", type=Path)
    Parser.add_argument("--work-directory", type=Path, default=Root / "_ClaudeScratch/tmp/DistanceClipmapFootprints")
    Parser.add_argument("--report", type=Path, default=Root / "Exhibits/DistanceClipmap/Results/Footprints.json")
    Arguments = Parser.parse_args()
    Arguments.work_directory.mkdir(parents=True, exist_ok=True)
    Shader = Root / "Experimental/DistanceClipmap/DistanceEvaluation.slang"
    Reports = []
    RejectedControl = False
    for Entry in Entries:
        Binary = Arguments.work_directory / (Entry + ".spv")
        ReflectionPath = Arguments.work_directory / (Entry + ".json")
        subprocess.run([str(Arguments.compiler.resolve()), str(Shader), "-entry", Entry,
                        "-target", "spirv", "-profile", "glsl_450", "-fp-mode", "precise", "-O0",
                        "-reflection-json", str(ReflectionPath), "-o", str(Binary)], check=True)
        Compiled = Binary.read_bytes()
        Executed = (Arguments.shader_directory / (Entry + ".spv")).read_bytes()
        Enforce(Compiled == Executed, f"{Entry}: reflection does not describe the executed byte stream")
        Reflection = json.loads(ReflectionPath.read_bytes())
        ValidateReflection(Reflection, Entry)
        if not RejectedControl:
            Misaligned = copy.deepcopy(Reflection)
            Facets = next(Parameter for Parameter in Misaligned["parameters"] if Parameter["name"] == "Facets")
            Material = next(Member for Member in Facets["type"]["resultType"]["fields"] if Member["name"] == "Material")
            Material["binding"]["offset"] = 16
            try:
                ValidateReflection(Misaligned, Entry)
            except ValueError as Failure:
                Enforce(str(Failure) == "Facets.Material: offset mismatch", "Unrelated negative-control failure")
                RejectedControl = True
            Enforce(RejectedControl, "Misaligned material negative control was accepted")
        Reports.append({"entry": Entry, "executed_spirv_sha256": hashlib.sha256(Executed).hexdigest(),
                        "descriptors": 8, "push_constant_bytes": 128, "workgroup": [64, 1, 1],
                        "reflection_binary_matches_executed": True})
    Arguments.report.parent.mkdir(parents=True, exist_ok=True)
    Arguments.report.write_text(json.dumps({
        "source_sha256": hashlib.sha256(Shader.read_bytes()).hexdigest(),
        "entries": Reports, "footprints": Footprints, "misaligned_material_negative_control_rejected": RejectedControl,
        "scope": "Slang reflection plus native static assertions and runtime readback; not Vulkan validation-layer coverage."
    }, indent=2) + "\n")
    print("Six executed shader byte streams match reflection: eight descriptors, typed integer material, Float32 storage,")
    print("128-byte pushes, member offsets and 64x1x1 workgroups. Misaligned-material negative control rejected.")


if __name__ == "__main__":
    Execute()
