# ============================================================================================================================================
#                                                           VALIDATEEVIDENCE.PY
# ============================================================================================================================================
# 🧩 Verify retained source/capture integrity and report consistency; do not certify visual quality or speed acceptance.

from pathlib import Path
from html.parser import HTMLParser
import argparse
import hashlib
import json
import math
import re
import statistics
import zlib

Root = Path(__file__).resolve().parents[3]
Exhibit = Root / "Exhibits/DistanceClipmap"
Results = Exhibit / "Results"


def ComputeDigest(Payload):
    return hashlib.sha256(Payload).hexdigest()


def Require(Condition, Description):
    if not Condition:
        raise ValueError(Description)


def RetrieveReport(Name):
    return json.loads((Results / (Name + ".json")).read_bytes())


class MarkupReferences(HTMLParser):
    def __init__(self):
        super().__init__()
        self.Identifiers = []
        self.Locations = []

    def handle_starttag(self, tag, attrs):
        Attributes = dict(attrs)
        if "id" in Attributes:
            self.Identifiers.append(Attributes["id"])
        for Attribute in ["href", "src"]:
            if Attribute in Attributes:
                self.Locations.append(Attributes[Attribute])


def ValidateLocation(Location, Directory, Identifiers=None):
    if re.match(r"^https?://", Location):
        return
    if Location.startswith("#"):
        if Identifiers is not None:
            Require(Location[1:] in Identifiers, "Missing HTML anchor: " + Location)
        return
    Destination = (Directory / Location.split("#", 1)[0]).resolve()
    Require(Destination.is_relative_to(Root), "Evidence link escapes the repository: " + Location)
    Require(Destination.exists(), "Missing evidence link: " + str(Destination))


def Execute():
    Parser = argparse.ArgumentParser()
    Parser.add_argument("--shader-directory", type=Path)
    Arguments = Parser.parse_args()
    Manifest = RetrieveReport("Manifest")
    for Name, Expected in Manifest["source_hashes"].items():
        Require(ComputeDigest((Root / Name).read_bytes()) == Expected, "Source drift: " + Name)

    Pixels = RetrieveReport("PixelChecks")
    Require(len(Pixels["captures"]) == 82, "Unexpected retained native capture count")
    Buffers = {}
    for Capture in Pixels["captures"]:
        Name = Capture["name"]
        Require([Capture["width"], Capture["height"]] == [480, 270], "Changed native capture resolution: " + Name)
        Require(Capture["nan_channels"] + Capture["inf_channels"] + Capture["negative_channels"] == 0,
                "Invalid native capture statistics: " + Name)
        Png = (Exhibit / "Images" / (Name + ".png")).read_bytes()
        Require(ComputeDigest(Png) == Capture["png_sha256"], "Retained PNG drift: " + Name)
        if Capture["float_buffer_retained"]:
            Payload = zlib.decompress((Exhibit / "Buffers" / (Name + ".f32.zlib")).read_bytes())
            Require(len(Payload) == 480 * 270 * 12, "Changed Float32 extent: " + Name)
            Require(ComputeDigest(Payload) == Capture["float32_top_down_rgb_sha256"], "Float32 buffer drift: " + Name)
            Buffers[Name] = Payload
    Require(Buffers["CombinedDirect"] == Buffers["HybridDirect"] == Buffers["CombinedRepeat"],
            "Matched or repeated Float32 images differ")
    for Name in ["SourcesOff", "SourcesOffIncludingGi"]:
        Require(not any(Buffers[Name]), "Source-off Float32 buffer is not exactly zero: " + Name)
    for Animation in Pixels["animations"].values():
        Require(Animation["apng_rgb_equal_to_individual_pngs"] and not Animation["interpolated"],
                "Animation encoding report does not preserve native poses")

    Benchmark = RetrieveReport("Benchmark")
    Require(Benchmark["same_float_images"] and Benchmark["alternating_order"], "Unmatched timing comparison")
    Require(Benchmark["repetitions_per_mode"] == len(Benchmark["exact_ms"]) == len(Benchmark["hybrid_ms"]) == 5,
            "Benchmark repeat count mismatch")
    for Selection in ["exact", "hybrid"]:
        Require(math.isclose(statistics.median(Benchmark[Selection + "_ms"]), Benchmark[Selection + "_median_ms"],
                             rel_tol=1e-10), "Benchmark median mismatch: " + Selection)
    ExpectedGate = Benchmark["hybrid_median_ms"] <= Benchmark["exact_median_ms"]
    Require(Benchmark["speed_gate_passed"] == ExpectedGate, "Benchmark acceptance contradicts its measurements")
    Require(math.isclose(Benchmark["exact_over_hybrid_speed_ratio"],
                         Benchmark["exact_median_ms"] / Benchmark["hybrid_median_ms"], rel_tol=1e-10),
            "Incorrect reported speed ratio")

    Footprints = RetrieveReport("Footprints")
    Require(Footprints["source_sha256"] == ComputeDigest(
        (Root / "Experimental/DistanceClipmap/DistanceEvaluation.slang").read_bytes()), "Shader reflection source drift")
    Require(len(Footprints["entries"]) == 6 and Footprints["misaligned_material_negative_control_rejected"],
            "Incomplete shader footprint coverage")
    if Arguments.shader_directory:
        for Entry in Footprints["entries"]:
            Binary = (Arguments.shader_directory / (Entry["entry"] + ".spv")).read_bytes()
            Require(ComputeDigest(Binary) == Entry["executed_spirv_sha256"], "Executed shader drift: " + Entry["entry"])
    for Archive in RetrieveReport("SourceAudit")["vehicle_archives"]:
        Require(Archive["linked_pathtracer_archive_identical"], "Reference vehicle identity failed")
        Require(ComputeDigest((Root / Archive["path"]).read_bytes()) == Archive["sha256"], "Vehicle archive drift")

    Consumption = RetrieveReport("Consumption")
    Require(Consumption["local_bake_ablation_altered_clip_texels"] > 0, "No bake-to-clip consumption")
    Require(Consumption["queries_with_altered_step_count"] > 0, "No clip-to-marcher consumption")
    for Property in ["both_visibility_selections_equal_triangles", "cleared_cache_indirect_exact_black",
                     "direct_unchanged_during_cache_ablation", "restored_cache_indirect_bit_equal",
                     "mismatched_source_mask_rejected"]:
        Require(Consumption[Property], "Consumption check failed: " + Property)

    Markup = MarkupReferences()
    Markup.feed((Exhibit / "index.html").read_text())
    Require(len(Markup.Identifiers) == len(set(Markup.Identifiers)), "Duplicate HTML identifiers")
    for Location in Markup.Locations:
        ValidateLocation(Location, Exhibit, Markup.Identifiers)
    Documents = [Exhibit / "README.md", Exhibit / "Inspection.md", Root / "Experimental/DistanceClipmap/README.md"]
    for Document in Documents:
        for Location in re.findall(r"!?\[[^\]]*\]\(([^)]+)\)", Document.read_text()):
            ValidateLocation(Location, Document.parent)

    Presentation = RetrieveReport("Presentation")
    Require(Presentation["passed"], "Evidence viewer interaction validation failed")
    Require(Presentation["html_sha256"] == ComputeDigest((Exhibit / "index.html").read_bytes()), "HTML changed after browser validation")
    Require(Presentation["test_source_sha256"] == ComputeDigest((Exhibit / "Code/ValidatePresentation.cjs").read_bytes()),
            "Browser validation code changed after execution")
    Ctest = (Results / "Ctest.txt").read_text()
    Require("100% tests passed, 0 tests failed out of 4" in Ctest, "Current four-test CTest result missing")
    for Name in ["NativeSanitizers", "VulkanHostSanitizers", "ConsumptionSanitizers", "CacheSideSanitizers"]:
        Log = (Results / (Name + ".txt")).read_text()
        Require("AddressSanitizer:" not in Log and "runtime error:" not in Log and "LeakSanitizer:" not in Log,
                "Sanitizer diagnostic in " + Name)
        Require(bool(Log.strip()), "Empty sanitizer log: " + Name)
    Require(RetrieveReport("SanitizersNumeric")["assertions"] == RetrieveReport("Numeric")["assertions"],
            "Sanitized numerical coverage differs")
    Require(RetrieveReport("SanitizersConsumption") == Consumption, "Sanitized consumption result differs")
    Require(json.loads((Results / "CacheSideSanitizers.txt").read_text()) == RetrieveReport("CacheSideAfter"),
            "Sanitized cache-side result differs")
    Require("100% tests passed, 0 tests failed out of 3" in (Results / "CpuOnlyCtest.txt").read_text(),
            "CPU-only three-test configuration result missing")

    Report = {
        "passed": True, "native_captures": len(Pixels["captures"]), "lossless_float_buffers": len(Buffers),
        "source_hashes_verified": len(Manifest["source_hashes"]),
        "executed_spirv_verified": bool(Arguments.shader_directory),
        "html_references_verified": len(Markup.Locations), "native_ctests_passed": 4,
        "shader_footprints": 6, "matched_cpu_speed_gate_passed": ExpectedGate,
        "renderer_accepted": False,
        "scope": "Integrity, measurement arithmetic, report consistency and viewer links only; not an artifact or full-renderer certificate."
    }
    (Results / "Integrity.json").write_text(json.dumps(Report, indent=2) + "\n")
    print(json.dumps(Report, indent=2))


if __name__ == "__main__":
    try:
        Execute()
    except Exception as Failure:
        (Results / "Integrity.json").write_text(json.dumps({"passed": False, "failure": str(Failure)}, indent=2) + "\n")
        raise
