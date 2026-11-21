# ============================================================================================================================================
#                                                          INSPECTSHADOWSCOPE.PY
# ============================================================================================================================================
# 🧩 Verify the requested six labels, user-image provenance and pinned reuse excerpts; never a shadow runtime certificate.

from pathlib import Path
import argparse
import copy
import hashlib
import json
import re
import struct
import subprocess

Root = Path(__file__).resolve().parents[3]
Exhibit = Root / "Exhibits/DistanceClipmap"
Revision = "4cab9133ef01022019f0bf4c71b9b328791306bd"
ImageLocation = "Images/RequestedShadowAlgorithms.png"
ImageDigest = "6e03fa4704ed6cdc34a83b5057a12ddcc7ec91b92883ba0f3c0473062f74837f"
Labels = [
    "Point-sample SDF (no penumbra)",
    "Analytic SDF cone penumbra",
    "3D voxel SDF clipmap penumbra",
    "3D voxel SDF penumbra + cone GI",
    "Hybrid SDF + Sobol spherical cap",
    "SDF Monte Carlo PT ref (96 spp)",
]
Categories = ["hard-shadow baseline", "analytic-field penumbra", "voxel-field penumbra",
              "combined shadow and GI", "finite-source sampled visibility", "finite path-traced reference"]
Anchors = {
    "Experimental/DistanceClipmap/RadianceScene.h": [
        "enum class VisibilityEvaluation", "ClipPenumbra  = 3",
        "return Vehicle.Trace(LocalOrigin, LocalDirection, Limit, true).Confirmed();",
        "LocalDistance.Sample(Pose.ToLocal(P)).Raw", "CapDirection(SunDirection, SunRadius, Pair)",
        "inline Image CapturePath", "const auto Surface = Scene.Trace(Origin, Direction);",
    ],
    "Experimental/DistanceClipmap/Transport/DirectionalRadiance.h": [
        "class DirectionalRadianceAtlas",
        "Scene.Direct(Sites[Index].Surface, SourceMask, VisibilityEvaluation::Exact, Samples);",
    ],
}


# ------------------------------------------------------------------------------------------------------------------------
#                                            REQUEST AND PROVENANCE CONSTRAINTS
# ------------------------------------------------------------------------------------------------------------------------

def Enforce(Condition, Description):
    if not Condition:
        raise ValueError(Description)


def Digest(Payload):
    return hashlib.sha256(Payload).hexdigest()


def ValidateSelections(Selections):
    Enforce([Selection["id"] for Selection in Selections] == list(range(6)), "Requested IDs must be exactly 0 through 5")
    Enforce([Selection["label"] for Selection in Selections] == Labels, "A requested image label was substituted")
    Enforce(all(Selection["implementation_accepted"] is False for Selection in Selections),
            "This scope audit cannot accept a renderer implementation")


def ValidateImage(Payload):
    Enforce(Digest(Payload) == ImageDigest, "User-provided reference bytes changed")
    Enforce(Payload[:8] == b"\x89PNG\r\n\x1a\n" and struct.unpack(">II", Payload[16:24]) == (1232, 648),
            "User-image format or extent changed")


def Rejected(Evaluation):
    try:
        Evaluation()
    except ValueError:
        return True
    return False


# ------------------------------------------------------------------------------------------------------------------------
#                                                   PINNED SOURCE AUDIT
# ------------------------------------------------------------------------------------------------------------------------

def Execute():
    Parser = argparse.ArgumentParser(description="Scope/reference/source consistency only; zero new shadow paths executed.")
    Parser.add_argument("--check", dest="VerifyOnly", action="store_true", help="Verify retained reports without regenerating them")
    Arguments = Parser.parse_args()
    ImageBytes = (Exhibit / ImageLocation).read_bytes()
    ValidateImage(ImageBytes)
    Selections = [{"id": Index, "label": Label, "category": Categories[Index],
                   "implementation_accepted": False} for Index, Label in enumerate(Labels)]
    ValidateSelections(Selections)
    WrongIds, WrongLabel = copy.deepcopy(Selections), copy.deepcopy(Selections)
    WrongIds[5]["id"] = 4
    WrongLabel[0]["label"] = "Exact triangle visibility"
    Enforce(Rejected(lambda: ValidateSelections(WrongIds)), "Duplicate-ID control was accepted")
    Enforce(Rejected(lambda: ValidateSelections(WrongLabel)), "Triangle-for-SDF substitution control was accepted")
    Enforce(Rejected(lambda: ValidateImage(ImageBytes[:-1] + bytes([ImageBytes[-1] ^ 1]))),
            "Changed-reference control was accepted")
    Sources = []
    for Location, Needles in Anchors.items():
        Payload = (Root / Location).read_bytes()
        Lines = Payload.decode("utf-8").splitlines()
        Excerpts = []
        for Needle in Needles:
            Matches = [{"line": Index + 1, "text": Line.strip()} for Index, Line in enumerate(Lines) if Needle in Line]
            Enforce(bool(Matches), "Pinned source anchor absent: " + Location + ": " + Needle)
            Excerpts.append({"anchor": Needle, "matches": Matches})
        Sources.append({"path": Location, "sha256": Digest(Payload), "excerpts": Excerpts})
    Document = Exhibit / "ShadowPaths.md"
    Text = Document.read_text()
    for Label in Labels:
        Enforce(Label in Text, "Requested caption missing from comparison contract: " + Label)
    Generated = {"Results/ShadowScope.json", "Results/ShadowScopeChecks.json"}
    for Link in re.findall(r"\]\(([^)]+)\)", Text):
        if "://" in Link:
            continue
        Location = Link.split("#", 1)[0]
        Enforce(not Location or (Exhibit / Location).is_file() or (not Arguments.VerifyOnly and Location in Generated),
                "Missing local document reference: " + Link)
    for Number, Line in enumerate(Text.splitlines(), 1):
        Enforce(Line == Line.rstrip() and "\t" not in Line, "Document whitespace at line " + str(Number))
        Enforce(len(Line) <= 120 or "====" in Line, "Document line width at line " + str(Number))
    Scope = {"audited_revision": Revision, "request_source": "User-supplied image; labels transcribed, not runtime output",
             "reference_image": {"path": ImageLocation, "sha256": ImageDigest, "width": 1232, "height": 648,
                                 "bytes": len(ImageBytes), "generated_by_this_checkout": False},
             "requested_paths": Selections, "reference_paths_per_pixel": 96, "pinned_sources": Sources,
             "contract_sha256": Digest(Document.read_bytes()), "generator_sha256": Digest(Path(__file__).read_bytes()),
             "new_native_shadow_paths_executed": 0, "renderer_accepted": False}
    Checks = {"passed": True, "requested_paths": 6, "image_ids": list(range(6)), "user_image_bytes_verified": True,
              "pinned_sources": len(Sources), "negative_controls_rejected": 3, "document_links_verified": True,
              "new_native_shadow_paths_executed": 0, "renderer_accepted": False,
              "scope": "Request/reference/source consistency only; not compilation, shadow execution, image quality or performance."}
    (Exhibit / "Results").mkdir(exist_ok=True)
    for Name, Report in [("ShadowScope.json", Scope), ("ShadowScopeChecks.json", Checks)]:
        Destination = Exhibit / "Results" / Name
        if Arguments.VerifyOnly:
            Enforce(json.loads(Destination.read_bytes()) == Report, "Retained scope report differs: " + Name)
        else:
            Destination.write_text(json.dumps(Report, indent=2) + "\n")
    print(json.dumps(Checks))


if __name__ == "__main__":
    Execute()
