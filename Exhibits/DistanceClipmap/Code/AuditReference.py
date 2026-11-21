# ============================================================================================================================================
#                                                            AUDITREFERENCE.PY
# ============================================================================================================================================
# 🧩 Inspect pinned source and existing vehicle archives; no engine import or workflow execution.

from pathlib import Path
import argparse
import collections
import hashlib
import json
import struct
import subprocess

Root = Path(__file__).resolve().parents[3]
Revision = "c205cb698288ccd90bf909e25e28ce28d48d0dfa"
Repository = "SultanAladin/Frontier-1"

References = {
    "Experimental/ShadowAlgorithmLab/FRONTIER_LIGHTING_PLAN.md": [
        "Remove SDF from Direct Shadows Completely", "6–13 cm", "GTX 1660 est."
    ],
    "Experimental/SdfLightingDemoCpp/RendererEngines.hpp": [
        "bool ptDenoise = true", "bool giBilateral = true", "if (pr.type == PrimType::Triangle) continue",
        "radMip0[idx] = clamp3", "throughput = clamp3", "accum += clamp3", "* 0.32f", "? 1.0f : 0.35f"
    ],
    "Experimental/SdfLightingDemoCpp/README.md": ["Bilateral Denoise"],
    "Experimental/DeterministicPathTracer/README.md": [
        "Deterministic ≠ instant", "Fixed limits are a deterministic bias", "Tested only on SwiftShader",
        "not implemented", "cutoff 0.002", "Denoiser"
    ],
    "Engine/Shaders/GlobalIllumination/SignedDistanceConeIllumination.slang": [
        "float3 SkyRadiance", "Accum          += Uniforms.SkyRadiance", "TraceConeSkyVis"
    ],
    "Engine/Shaders/DirectLighting/ContactClipShadow.slang": [
        "TraceSdfConePenumbra", "? 0.75 : 0.0", "lerp(ClipVis, min(ClipVis + 0.35, SdfVis)"
    ],
    "Engine/DistanceFieldSpace/SignedDistanceVolume.cpp": [
        "3-direction normal-alignment vote", "TraceClosestRay(Ray, false)", "InsideVotes"
    ],
}


def Digest(Payload):
    return hashlib.sha256(Payload).hexdigest()


def InspectTopology(Location):
    Payload = Location.read_bytes()
    Vertices, Facets, Options = struct.unpack_from("<III", Payload, 4)
    Positions = [struct.unpack_from("<3f", Payload, 48 + Vertex * 12) for Vertex in range(Vertices)]
    FacetOffset = 48 + Vertices * 12
    MaterialOffset = FacetOffset + Facets * 12
    Counts = collections.Counter()
    Directions = collections.Counter()
    for Face in range(Facets):
        Indices = struct.unpack_from("<3I", Payload, FacetOffset + Face * 12)
        for Edge in range(3):
            A, B = Positions[Indices[Edge]], Positions[Indices[(Edge + 1) % 3]]
            Counts[tuple(sorted((A, B)))] += 1
            Directions[tuple(sorted((A, B)))] += 1 if A < B else -1
    return {
        "path": str(Location.relative_to(Root)), "sha256": Digest(Payload), "vertices": Vertices,
        "facets": Facets, "corner_normals": bool(Options & 1),
        "material_counts": dict(collections.Counter(struct.unpack_from(f"<{Facets}I", Payload, MaterialOffset))),
        "exact_coordinate_welded_boundary_edges": sum(Count == 1 for Count in Counts.values()),
        "exact_coordinate_welded_nonmanifold_edges": sum(Count > 2 for Count in Counts.values()),
        "two_incident_same_direction_edges": sum(Count == 2 and Directions[Edge] != 0 for Edge, Count in Counts.items()),
        "limitation": "Exact-position incidence only; not a general welding, solidness, intersection or orientation certificate."
    }


def Execute():
    Arguments = argparse.ArgumentParser()
    Arguments.add_argument("--reference-directory", type=Path, default=Root / "_ClaudeScratch/tmp/LightingReference")
    Arguments.add_argument("--download", action="store_true")
    Parsed = Arguments.parse_args()
    Files = list(References)
    Files += [f"Experimental/DeterministicPathTracer/Assets/ControlVehicle{Name}.facet" for Name in ["Body", "Rim", "Tyre"]]
    TreePath = Parsed.reference_directory / "Tree.json"
    if Parsed.download:
        Parsed.reference_directory.mkdir(parents=True, exist_ok=True)
        TreePath.write_bytes(subprocess.check_output([
            "gh", "api", f"repos/{Repository}/git/trees/{Revision}?recursive=1"
        ]))
        for Name in Files:
            Payload = subprocess.check_output([
                "gh", "api", "-H", "Accept: application/vnd.github.raw+json",
                f"repos/{Repository}/contents/{Name}?ref={Revision}"
            ])
            Location = Parsed.reference_directory / Name
            Location.parent.mkdir(parents=True, exist_ok=True)
            Location.write_bytes(Payload)
    Tree = json.loads(TreePath.read_bytes())
    if Tree.get("truncated", True):
        raise RuntimeError("Pinned recursive tree is truncated; directory-presence audit is incomplete")
    Paths = {Entry["path"] for Entry in Tree["tree"]}
    ComparedPages = ["Experimental/ShadowAlgorithmLab/index.html", "Experimental/ClothEditor/index.html",
                     "Experimental/DeterministicPathTracer/index.html"]
    if not set(ComparedPages) <= Paths:
        raise RuntimeError("Expected linked HTML page is absent from the pinned tree")
    Citations = []
    for Name, Needles in References.items():
        Payload = (Parsed.reference_directory / Name).read_bytes()
        Lines = Payload.decode("utf-8").splitlines()
        Matches = []
        for Needle in Needles:
            Found = [{"line": Index + 1, "text": Text.strip()} for Index, Text in enumerate(Lines) if Needle in Text]
            if not Found:
                raise RuntimeError(f"Pinned audit anchor not found: {Name}: {Needle}")
            Matches.append({"anchor": Needle, "occurrences": Found})
        Citations.append({
            "path": Name, "sha256": Digest(Payload), "bytes": len(Payload), "excerpts": Matches,
            "url": f"https://github.com/{Repository}/blob/{Revision}/{Name}"
        })
    Archives = []
    for Name in ["Body", "Rim", "Tyre"]:
        Local = Root / f"Experimental/SlateReference/B/Exhibits/IlluminationHost/Archive/ControlVehicle{Name}.facet"
        Archive = InspectTopology(Local)
        Remote = Parsed.reference_directory / f"Experimental/DeterministicPathTracer/Assets/ControlVehicle{Name}.facet"
        Archive["linked_pathtracer_archive_identical"] = Digest(Remote.read_bytes()) == Archive["sha256"]
        if not Archive["linked_pathtracer_archive_identical"]:
            raise RuntimeError("Vehicle archives differ from the linked branch")
        Archives.append(Archive)
    LocalCitations = []
    for Name, Needles in {
        "Frontier/Engine/Rendering/DistanceField.h": ["Scalar (luminance)", "analytic scene is not a verbatim port"],
        "Frontier/Engine/Rendering/SurfaceCards.cpp": ["FormFactors_.assign", "EffectiveR2"],
        "Frontier/Engine/Rendering/TriangleDistanceVolume.h": ["Unsigned sampled triangle distance", "Refine the original interval"],
    }.items():
        Location = Root / Name
        Payload = Location.read_bytes()
        Lines = Payload.decode().splitlines()
        Excerpts = []
        for Needle in Needles:
            Found = [{"line": Index + 1, "text": Text.strip()} for Index, Text in enumerate(Lines) if Needle in Text]
            if not Found:
                raise RuntimeError(f"Local audit anchor not found: {Name}: {Needle}")
            Excerpts.extend(Found)
        LocalCitations.append({"path": Name, "sha256": Digest(Payload), "excerpts": Excerpts})
    Result = {
        "reference_repository": Repository, "reference_revision": Revision,
        "reference_branch": "arena/39c6910b-frontier-1",
        "working_branch": subprocess.check_output(["git", "branch", "--show-current"], cwd=Root, text=True).strip(),
        "base_revision": "96f31ecaef529d383e195013f5f00d163392f71a",
        "upstream_sources": Citations, "local_sources": LocalCitations, "vehicle_archives": Archives,
        "pinned_tree": {"tree_sha": Tree["sha"], "truncated": Tree["truncated"],
                        "payload_sha256": Digest(TreePath.read_bytes()), "entry_count": len(Tree["tree"]),
                        "compared_html_paths": ComparedPages},
        "directory_presence": {
            "linked_shadow_lab": ComparedPages[0] in Paths,
            "linked_cloth_editor": ComparedPages[1] in Paths,
            "linked_pathtracer_html": ComparedPages[2] in Paths,
            "local_shadow_lab_before_this_work": (Root / "Experimental/ShadowAlgorithmLab").exists(),
            "local_cloth_editor_before_this_work": (Root / "Experimental/ClothEditor").exists(),
            "local_pathtracer_html_before_this_work": (Root / "Experimental/DeterministicPathTracer/index.html").exists(),
            "local_cloth_specimen": (Root / "Experimental/TextureStudio/Assets/draped-cloth.js").exists(),
        },
        "scope": "Bounded source audit, not an executed audit of the entire engine or the linked editor.",
    }
    Destination = Root / "Exhibits/DistanceClipmap/Results/SourceAudit.json"
    Destination.parent.mkdir(parents=True, exist_ok=True)
    Destination.write_text(json.dumps(Result, indent=2, ensure_ascii=False) + "\n")
    print("Pinned source excerpts and three identical vehicle archives retained:", Destination.relative_to(Root))


if __name__ == "__main__":
    Execute()
