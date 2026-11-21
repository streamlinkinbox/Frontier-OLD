# ============================================================================================================================================
#                                                            INSPECTSHADOWS.PY
# ============================================================================================================================================
# 🧩 Retain actual six-path native pixels, lossless Float32 evidence, decompositions, source hashes and measured comparisons.

from pathlib import Path
import argparse
import csv
import hashlib
import json
import platform
import shutil
import subprocess
import zipfile
import zlib

import numpy as Numpy
from PIL import Image, ImageDraw, ImageFont
from InspectCaptures import DecodePfm, EncodeDisplay
from InspectShadowScope import Labels

Root = Path(__file__).resolve().parents[3]
Exhibit = Root / "Exhibits/DistanceClipmap"
Width, Height = 480, 270


# ------------------------------------------------------------------------------------------------------------------------
#                                                  PIXEL / SOURCE CONSTRAINTS
# ------------------------------------------------------------------------------------------------------------------------

def Enforce(Condition, Description):
    if not Condition:
        raise ValueError(Description)


def Digest(Payload):
    return hashlib.sha256(Payload).hexdigest()


def NativeNames():
    Room = [f"Shadow{Mode}{Suffix}" for Mode in range(6)
            for Suffix in ["Direct", "Indirect", "OneBounce", "Combined", "Visibility", "Off"]]
    Room += ["ShadowAnalyticSlice", "ShadowVoxelSlice", "ShadowNormals", "ShadowPrimaryMasks"]
    Vehicle = [f"ShadowVehicle{Pose}{Suffix}" for Pose in range(6) for Suffix in ["Direct", "Indirect", "Combined"]]
    Vehicle += ["ShadowVehicleCacheCleared", "ShadowVehicleCacheRestored", "ShadowVehicleOff"]
    return Room, Vehicle


def SourceLocations():
    Locations = [
        "Experimental/DistanceClipmap/FacetDistance.h", "Experimental/DistanceClipmap/DistanceClipmap.h",
        "Experimental/DistanceClipmap/RadianceScene.h", "Experimental/DistanceClipmap/SobolDirections.h",
        "Experimental/DistanceClipmap/Transport/TransportSnapshot.h",
        "Experimental/DistanceClipmap/Transport/DirectionalRadiance.h",
        "Experimental/DistanceClipmap/Transport/DiffuseProbeLattice.h",
        "Experimental/DistanceClipmap/Transport/TransportCapture.h",
        "Frontier/Engine/Rendering/TriangleVisibilitySpace.h", "Engine/Render/SurfaceRasterization.h",
        "Exhibits/Renderer/Code/VulkanReadback.h", "Exhibits/DistanceClipmap/Code/TransportCompute.h",
        "Experimental/SlateReference/B/Exhibits/IlluminationHost/Archive/ControlVehicleBody.facet",
        "Experimental/SlateReference/B/Exhibits/IlluminationHost/Archive/ControlVehicleRim.facet",
        "Experimental/SlateReference/B/Exhibits/IlluminationHost/Archive/ControlVehicleTyre.facet",
        "Exhibits/DistanceClipmap/Code/InspectCaptures.py", "Exhibits/DistanceClipmap/Code/InspectShadowScope.py",
        "Exhibits/DistanceClipmap/Code/ServeTransport.py", "Exhibits/DistanceClipmap/Code/ValidateTransport.py",
    ]
    Locations += [str(Location.relative_to(Root)).replace("\\", "/")
                  for Location in sorted((Root / "Experimental/DistanceClipmap/Shadows").iterdir()) if Location.is_file()]
    Locations += ["Exhibits/DistanceClipmap/Code/" + Name for Name in [
        "SdfShadowValidation.cpp", "SdfShadowVulkan.cpp", "SphereVehicleValidation.cpp", "InspectShadows.py",
        "ValidateShadows.py", "ServeShadows.py", "ValidateShadowPresentation.cjs"]]
    Locations += ["Exhibits/DistanceClipmap/Shadows.html", "Exhibits/DistanceClipmap/SixRenders.md"]
    return sorted(Locations)


def Display(Name, Pixels, Exposure=1):
    if Name.endswith("Slice"):
        Distance = Pixels[:, :, 0]
        Magnitude = Numpy.clip(Numpy.abs(Distance) / .3, 0, 1)[:, :, None]
        Outside = Numpy.array([.06, .18, .38]) * (1 - Magnitude) + Numpy.array([.62, .83, 1.0]) * Magnitude
        Inside = Numpy.array([1.0, .30, .06]) * (1 - Magnitude) + Numpy.array([.35, .025, .005]) * Magnitude
        return EncodeDisplay(Numpy.where((Distance >= 0)[:, :, None], Outside, Inside), Debug=True)
    Debug = Name.endswith("Visibility") or Name in ["ShadowNormals", "ShadowPrimaryMasks"]
    return EncodeDisplay(Pixels, Exposure=Exposure, Debug=Debug)


def Metrics(A, B, Masks):
    Difference = A.astype(Numpy.float64) - B.astype(Numpy.float64)
    Opaque = (Masks[:, :, 0] == 1) & (Masks[:, :, 2] == 0)
    Floor = Masks[:, :, 1] == 1
    return {"linear_rgb_rmse_all": float(Numpy.sqrt(Numpy.mean(Difference ** 2))),
            "linear_rgb_rmse_opaque_receivers": float(Numpy.sqrt(Numpy.mean(Difference[Opaque] ** 2))),
            "linear_rgb_rmse_floor": float(Numpy.sqrt(Numpy.mean(Difference[Floor] ** 2))),
            "max_absolute_channel": float(Numpy.abs(Difference).max())}


# ------------------------------------------------------------------------------------------------------------------------
#                                                    REAL-PIXEL PRESENTATION
# ------------------------------------------------------------------------------------------------------------------------

def Sheet(Names, Titles, Destination, Heading, Footer, Columns=3):
    Margin, Caption = 12, 34
    Rows = (len(Names) + Columns - 1) // Columns
    Picture = Image.new("RGB", (Columns * (Width + Margin) + Margin, 66 + Rows * (Height + Caption + Margin) + 39), "#0b1017")
    Pen = ImageDraw.Draw(Picture)
    Pen.text((Margin, 12), Heading, font=ImageFont.load_default(size=24), fill="#eff0e8")
    for Index, (Name, Title) in enumerate(zip(Names, Titles)):
        X, Y = Margin + (Index % Columns) * (Width + Margin), 57 + (Index // Columns) * (Height + Caption + Margin)
        Pen.text((X, Y + 6), Title, font=ImageFont.load_default(size=16), fill="#bfdec8")
        Picture.paste(Image.open(Exhibit / "Images" / (Name + ".png")).convert("RGB"), (X, Y + Caption))
    Pen.text((Margin, Picture.height - 31), Footer, font=ImageFont.load_default(size=15), fill="#aeb7c5")
    Picture.save(Exhibit / "Images" / Destination)


def ProfileWidth(Rows, Column):
    Lower, Upper, Previous = -1.0, -1.0, 0.0
    Step = float(Rows[1]["lateral_m"]) - float(Rows[0]["lateral_m"])
    for Index, Row in enumerate(Rows):
        Current = float(Row[Column])
        Lateral = float(Row["lateral_m"])
        if Index == 0:
            Previous = Current
            continue
        Span = max(1e-8, Current - Previous)
        if Lower < 0 and Current >= .1:
            Lower = Lateral - Step * (Current - .1) / Span
        if Upper < 0 and Current >= .9:
            Upper = Lateral - Step * (Current - .9) / Span
        Previous = Current
    return 0.0 if Lower < 0 or Upper < Lower else Upper - Lower


def Proof11Sheet(Comparisons, ProfileLocation):
    Margin, Caption = 8, 22
    Picture = Image.new("RGB", (3 * (Width + Margin) + Margin, 46 + 2 * (Height + Caption + Margin) + 36), "#070b12")
    Pen = ImageDraw.Draw(Picture)
    Header = "PROOF 11: EMISSIVE SPHERE ONLY (NO SUN/AREA/SPOT/IES) - ALL SDF RENDERERS SHOWING SHADOWS + PENUMBRA"
    Pen.text((Margin, 12), Header, font=ImageFont.load_default(size=19), fill="#e8edf4")
    Palette = ["#f08078", "#80dfa8", "#80dfa8", "#ecc978", "#78c8f0", "#b89cf4"]
    for Mode in range(6):
        X = Margin + (Mode % 3) * (Width + Margin)
        Y = 42 + (Mode // 3) * (Height + Caption + Margin)
        Pen.text((X, Y + 3), f"{Mode}. {Labels[Mode].upper()}", font=ImageFont.load_default(size=13), fill=Palette[Mode])
        Picture.paste(Image.open(Exhibit / "Images" / f"Shadow{Mode}Combined.png").convert("RGB"), (X, Y + Caption))
    Rows = [Row for Row in csv.DictReader(ProfileLocation.open()) if float(Row["receiver_distance_m"]) == 3.0]
    PointWidth = ProfileWidth(Rows, "point")
    AnalyticWidth = ProfileWidth(Rows, "analytic")
    VoxelWidth = ProfileWidth(Rows, "voxel")
    CapWidth = ProfileWidth(Rows, "hybrid")
    Umbra = min(float(Row["reference"]) for Row in Rows)
    HybridError = Comparisons["direct_to_finite_96"]["4"]["linear_rgb_rmse_opaque_receivers"]
    GiError = Comparisons["cone_combined_to_matched_two_sites_96"]["linear_rgb_rmse_opaque_receivers"]
    AnalyticError = Comparisons["direct_to_finite_96"]["1"]["linear_rgb_rmse_opaque_receivers"]
    Footer = (f"3M BLOCKER PENUMBRA (10-90%): POINT={PointWidth:.3f}M | ANALYTIC={AnalyticWidth:.3f}M | "
              f"VOXEL={VoxelWidth:.3f}M | CAP={CapWidth:.3f}M | UMBRA={Umbra:.2f} | "
              f"OPAQUE RMSE: HYB={HybridError:.3f} GI={GiError:.3f} AN={AnalyticError:.3f}")
    Pen.text((Margin, Picture.height - 25), Footer, font=ImageFont.load_default(size=13), fill="#b8c2d0")
    Picture.save(Exhibit / "Images/Proof11SixSdfRenderers.png")


def Animate(Names, Destination):
    Pictures = [Image.open(Exhibit / "Images" / (Name + ".png")).convert("RGB") for Name in Names]
    Location = Exhibit / "Images" / (Destination + ".png")
    Pictures[0].save(Location, save_all=True, append_images=Pictures[1:], duration=[500] * 6, loop=0, disposal=0, blend=0)
    Decoded = Image.open(Location)
    Enforce(Decoded.n_frames == 6, "Actual vehicle APNG lost a pose")
    for Index, Picture in enumerate(Pictures):
        Decoded.seek(Index)
        Enforce(Numpy.array_equal(Numpy.asarray(Decoded.convert("RGB")), Numpy.asarray(Picture)), "APNG changed native pixels")
    return {"file": "Images/" + Location.name, "sha256": Digest(Location.read_bytes()), "frames": Names,
            "frame_ms": 500, "native_extent": [Width, Height], "interpolated": False}


def ProfileChart(Location):
    Rows = list(csv.DictReader(Location.open()))
    Picture = Image.new("RGB", (1200, 720), "#0d1420")
    Pen = ImageDraw.Draw(Picture)
    Font, Small = ImageFont.load_default(size=18), ImageFont.load_default(size=14)
    Pen.text((22, 16), "Measured finite-sphere shadow edges / calibration blocker, not the vehicle", font=Font, fill="#e8edf4")
    Colours = {"point": "#c6cbd2", "analytic": "#e6ae6a", "voxel": "#d47d9b", "hybrid": "#66c6b9", "reference": "#8aaeff"}
    for Index, Distance in enumerate([.5, 1.5, 3, 6]):
        Left, Top = 65 + (Index % 2) * 590, 90 + (Index // 2) * 285
        Right, Bottom = Left + 490, Top + 205
        Pen.rectangle((Left, Top, Right, Bottom), outline="#3a465a")
        Pen.text((Left, Top - 26), f"Receiver {Distance:g} m behind blocker / 1024 cap directions each point", font=Small, fill="#dae0ec")
        Selected = [Row for Row in Rows if float(Row["receiver_distance_m"]) == Distance]
        Maximum = 1.0 + Distance * .30
        for Name, Colour in Colours.items():
            Points = [(Left + (float(Row["lateral_m"]) / Maximum) * (Right - Left),
                       Bottom - float(Row[Name]) * (Bottom - Top)) for Row in Selected if float(Row["lateral_m"]) <= Maximum]
            Pen.line(Points, fill=Colour, width=2 if Name != "reference" else 1)
        Pen.text((Left - 23, Top - 5), "1", font=Small, fill="#abb8cb")
        Pen.text((Left - 23, Bottom - 12), "0", font=Small, fill="#abb8cb")
        Pen.text((Left, Bottom + 10), "0", font=Small, fill="#abb8cb")
        Pen.text((Right - 22, Bottom + 10), f"{Maximum:g}", font=Small, fill="#abb8cb")
        Pen.text((Left + 75, Bottom + 10), "Lateral distance from shadow centre (m)", font=Small, fill="#abb8cb")
    for Index, (Name, Colour) in enumerate(Colours.items()):
        Pen.text((65 + Index * 215, 669), Name + (" (finite)" if Name == "reference" else ""), font=Font, fill=Colour)
    Picture.save(Exhibit / "Images/ShadowProfiles.png")


def TimingChart(Methods):
    Picture = Image.new("RGB", (1120, 560), "#0d1420")
    Pen = ImageDraw.Draw(Picture)
    Font, Small = ImageFont.load_default(size=21), ImageFont.load_default(size=16)
    Pen.text((24, 18), "Actual CPU transport times / five alternating rounds, identical inputs", font=Font, fill="#e8edf4")
    Pen.text((24, 51), "480 x 270 | four primary sites | 96 cap samples or paths / pixel | two threads | NOT hardware-GPU timing", font=Small, fill="#aab8cc")
    Maximum = max(Method["median_cpu_ms"] for Method in Methods.values())
    for Index in range(7):
        Method = Methods[str(Index)]
        Y = 105 + Index * 56
        Title = f"{Index}  " + (Labels[Index] if Index < 6 else "SDF direct reference (96 spp, no GI)")
        Pen.text((24, Y + 4), Title, font=Small, fill="#dbe3ee")
        Length = max(1, int(Method["median_cpu_ms"] / Maximum * 420))
        Pen.rectangle((580, Y, 580 + Length, Y + 28), fill="#73c9b5" if Index != 5 else "#96a6d9")
        Pen.text((591 + Length, Y + 3), f"{Method['median_cpu_ms']:.0f} ms", font=Small, fill="#edf1f6")
    Pen.text((24, 514), "Different lighting scope: paths 0/1/2/4 are direct-only; path 3 adds one cone bounce; path 5 reaches four sites.", font=Small, fill="#e3c69b")
    Picture.save(Exhibit / "Images/ShadowTimings.png")


# ------------------------------------------------------------------------------------------------------------------------
#                                                   CAPTURE / REPORT RETENTION
# ------------------------------------------------------------------------------------------------------------------------

def Execute():
    Parser = argparse.ArgumentParser()
    Parser.add_argument("CaptureRoot", type=Path)
    Parser.add_argument("--compiler-label", dest="CompilerLabel")
    Parser.add_argument("--build-directory", dest="BuildDirectory", type=Path, required=True)
    Arguments = Parser.parse_args()
    for Directory in ["Images", "Buffers", "Results"]:
        (Exhibit / Directory).mkdir(exist_ok=True)
    (Exhibit / "Results/ShadowIntegrity.json").write_text(json.dumps({"passed": False,
        "reason": "Regenerated pixels await independent validation", "renderer_accepted": False}, indent=2) + "\n")
    RoomNames, VehicleNames = NativeNames()
    Captures = {Name: DecodePfm(Arguments.CaptureRoot / ("Room" if Name in RoomNames else "Vehicle") / (Name + ".pfm"))
                for Name in RoomNames + VehicleNames}
    Masks = Captures["ShadowPrimaryMasks"]
    Comparisons = {"direct_to_finite_96": {str(Mode): Metrics(Captures[f"Shadow{Mode}Direct"], Captures["Shadow5Direct"], Masks)
                                           for Mode in range(6)}}
    Comparisons["cone_gi_to_matched_one_secondary_site_96"] = Metrics(Captures["Shadow3Indirect"], Captures["Shadow5OneBounce"], Masks)
    Captures["Shadow5TwoSites"] = Captures["Shadow5Direct"] + Captures["Shadow5OneBounce"]
    Comparisons["cone_combined_to_matched_two_sites_96"] = Metrics(Captures["Shadow3Combined"], Captures["Shadow5TwoSites"], Masks)
    Enforce(Numpy.array_equal(Captures["Shadow2Direct"], Captures["Shadow3Direct"]), "Path 3 shadow lighting differs from path 2")
    for Mode in range(6):
        Enforce(Numpy.array_equal(Captures[f"Shadow{Mode}Combined"], Captures[f"Shadow{Mode}Direct"] + Captures[f"Shadow{Mode}Indirect"]), "Direct / GI additivity")
        Enforce(Numpy.count_nonzero(Captures[f"Shadow{Mode}Off"]) == 0, "Sphere-off native radiance is not exactly black")
        if Mode not in [3, 5]: Enforce(Numpy.count_nonzero(Captures[f"Shadow{Mode}Indirect"]) == 0, "A direct-only path acquired hidden GI")
        Captures[f"Shadow{Mode}DirectError"] = Numpy.abs(Captures[f"Shadow{Mode}Direct"] - Captures["Shadow5Direct"])
    Enforce(Numpy.array_equal(Captures["ShadowVehicleCacheRestored"], Captures["ShadowVehicle0Combined"]), "Actual vehicle restore changed pixels")
    Enforce(Numpy.array_equal(Captures["ShadowVehicleCacheCleared"], Captures["ShadowVehicle0Direct"]), "Actual vehicle cache clear did not isolate direct")
    Enforce(Numpy.count_nonzero(Captures["ShadowVehicleOff"]) == 0, "Actual vehicle source-off radiance is not black")
    Checks, UniqueBuffers = [], {}
    for Name, Pixels in Captures.items():
        Signed = Name.endswith("Slice")
        Enforce(Numpy.isfinite(Pixels).all() and (Signed or (Pixels >= 0).all()), "Invalid native Float32 channels: " + Name)
        Exposure = 8 if Name.endswith("DirectError") else 1
        Encoded = Display(Name, Pixels, Exposure)
        Png = Exhibit / "Images" / (Name + ".png")
        Image.fromarray(Encoded).save(Png)
        Payload = Pixels.astype("<f4").tobytes()
        FloatDigest = Digest(Payload)
        Retain = not (Name.startswith("ShadowVehicle") and Name[len("ShadowVehicle"):len("ShadowVehicle") + 1] in "12345")
        Buffer = None
        if Retain:
            if FloatDigest not in UniqueBuffers:
                Location = "Buffers/" + Name + ".f32.zlib"
                (Exhibit / Location).write_bytes(zlib.compress(Payload, 9))
                UniqueBuffers[FloatDigest] = Location
            Buffer = UniqueBuffers[FloatDigest]
        Checks.append({"name": Name, "native_cpp_capture": Name in RoomNames + VehicleNames,
            "extent": [Width, Height], "signed_distance_m": Signed, "exposure": Exposure,
            "minimum": float(Pixels.min()), "maximum": float(Pixels.max()), "mean": float(Pixels.astype(Numpy.float64).mean()),
            "zero_rgb_pixels": int(Numpy.count_nonzero(Numpy.all(Pixels == 0, axis=2))),
            "float32_rgb_sha256": FloatDigest, "float_buffer": Buffer,
            "buffer_sha256": Digest((Exhibit / Buffer).read_bytes()) if Buffer else None,
            "png_sha256": Digest(Png.read_bytes())})
    Sheet([f"Shadow{Mode}Combined" for Mode in range(6)], [f"{Mode}. {Labels[Mode]}" for Mode in range(6)],
          "ShadowSixRenders.png", "Six actual SDF renders / emissive sphere only",
          "Native 480 x 270 each | common exposure 1 | no Sun, sky, ambient or denoising | C++ CPU | finite noisy PT reference")
    Sheet(["Shadow3Direct", "Shadow3Indirect", "Shadow3Combined", "Shadow5Direct", "Shadow5OneBounce", "Shadow5TwoSites"],
          ["3: voxel shadows only (identical to path 2)", "3: reflected-radiance cone GI only", "3: linear direct + cone GI",
           "5: SDF PT direct only, 96 total spp", "5: first indirect bounce only, 96 spp", "5: matched two-scattering-site sum"],
          "ShadowDecomposition.png", "No GI hidden in the shadow comparison", "Common exposure 1 | path 3 is compared to one indirect bounce, not all three PT secondary sites")
    Sheet([f"Shadow{Mode}DirectError" for Mode in range(6)], [f"{Mode}: |direct - finite 96-spp direct| x8" for Mode in range(6)],
          "ShadowDirectErrors.png", "Measured direct-light differences / linear RGB before display", "Absolute RGB difference x8 | finite 96-spp SDF direct is not noise-free ground truth")
    Sheet(["ShadowAnalyticSlice", "ShadowVoxelSlice", "ShadowNormals", "Shadow0Visibility", "Shadow2Visibility", "Shadow5Visibility"],
          ["Analytic signed distance slice, z = 0.30 m", "Voxel signed distance slice, z = 0.30 m", "Shared geometric normals",
           "Point-sample SDF visibility", "Voxel penumbra visibility", "96 cap samples / pixel binary SDF visibility"],
          "ShadowDebug.png", "Distance / visibility diagnostics (not beauty renders)", "Signed slices: blue positive / orange negative, magnitude scaled by 0.30 m | visibility / normals: linear to sRGB")
    Sheet([f"ShadowVehicle{Pose}Combined" for Pose in range(6)], [f"Actual ControlVehicle + moving sphere, pose {Pose}" for Pose in range(6)],
          "ShadowVehicleMotion.png", "Actual 25,068-facet ControlVehicle / six native poses", "Unsigned 80 x 40 x 32 bake + triangle contact refinement | one reflected cone bounce | no analytic-vehicle-SDF claim")
    Animations = {Suffix: Animate([f"ShadowVehicle{Pose}{Suffix}" for Pose in range(6)], "ShadowVehicle" + Suffix + "Motion")
                  for Suffix in ["Direct", "Indirect", "Combined"]}
    Reports = {}
    for Name, Directory in [("ShadowNumeric", "Numeric"), ("ShadowCapture", "Room"), ("ShadowVehicle", "Vehicle"),
                            ("ShadowVulkan", "Vulkan"), ("ShadowBenchmark", "Benchmark")]:
        Reports[Name] = json.loads((Arguments.CaptureRoot / Directory / (Name + ".json")).read_bytes())
        Enforce(Reports[Name]["passed"] is True and Reports[Name]["renderer_accepted"] is False, "Failed or mislabelled runtime report: " + Name)
        (Exhibit / "Results" / (Name + ".json")).write_text(json.dumps(Reports[Name], indent=2) + "\n")
    for Name, Directory in [("ShadowProfiles.csv", "Numeric"), ("ShadowTimings.csv", "Room"),
                            ("ShadowPathDiagnostic.csv", "Vulkan"), ("ShadowBenchmark.csv", "Benchmark")]:
        shutil.copyfile(Arguments.CaptureRoot / Directory / Name, Exhibit / "Results" / Name)
    TimingRows = list(csv.DictReader((Exhibit / "Results/ShadowBenchmark.csv").open()))
    Methods = {}
    for Mode in range(7):
        Rows = [Row for Row in TimingRows if int(Row["selection"]) == Mode]
        Enforce([int(Row["round"]) for Row in Rows] == list(range(-1, 5)), "Missing benchmark round")
        Enforce(len({Row["fnv1a64"] for Row in Rows}) == 1, "Nonidentical benchmark repeats")
        Durations = [float(Row["cpu_ms"]) for Row in Rows if int(Row["round"]) >= 0]
        Methods[str(Mode)] = {"cpu_ms": Durations, "median_cpu_ms": float(Numpy.median(Durations)),
                              "fnv1a64": Rows[0]["fnv1a64"], "scope": Labels[Mode] if Mode < 6 else "SDF direct-only 96-spp reference"}
    ProfileChart(Exhibit / "Results/ShadowProfiles.csv")
    TimingChart(Methods)
    Proof11Sheet(Comparisons, Exhibit / "Results/ShadowProfiles.csv")
    Archive = Exhibit / "Results/ShadowSixRenders.zip"
    with zipfile.ZipFile(Archive, "w", compression=zipfile.ZIP_DEFLATED) as Zip:
        for Mode in range(6):
            Name = f"Shadow{Mode}Combined.png"
            Entry = zipfile.ZipInfo(Name, (1980, 1, 1, 0, 0, 0))
            Zip.writestr(Entry, (Exhibit / "Images" / Name).read_bytes(), compress_type=zipfile.ZIP_DEFLATED)
    Summary = {"passed": True, "new_native_shadow_paths_executed": 6, "renderer_accepted": False,
        "scope": "Actual native C++ CPU renders; bounded Slang/Vulkan parity on SwiftShader CPU, not Windows/editor or physical-GPU acceptance.",
        "labels": Labels, "tested_base_revision": subprocess.check_output(["git", "rev-parse", "HEAD"], cwd=Root, text=True).strip(),
        "working_tree_sources_hashed": True, "platform": platform.platform(), "python": platform.python_version(),
        "compiler": Arguments.CompilerLabel or subprocess.check_output(["c++", "--version"], text=True).splitlines()[0],
        "native_captures": len(RoomNames) + len(VehicleNames), "derived_captures": len(Checks) - len(RoomNames) - len(VehicleNames),
        "unique_lossless_float_buffers": len(UniqueBuffers), "motion_float_payloads_omitted": 15,
        "native_float_captures_retained_or_aliased": sum(Check["native_cpp_capture"] and Check["float_buffer"] is not None for Check in Checks),
        "checks": Checks, "comparisons": Comparisons, "benchmark": {"conditions": Reports["ShadowBenchmark"], "methods": Methods},
        "runtime": Reports, "animations": Animations, "archive_sha256": Digest(Archive.read_bytes()),
        "better_quality_and_faster_production_gate": False,
        "limitations": ["Four shared primary sites x 24 paths = 96 total paths per pixel, not 384.",
                        "Finite SDF hit/segment tolerance and four scattering sites bias the reference; 96 spp remains noisy.",
                        "Path 3 has one reflected cone bounce; compare to PT first bounce, not its full indirect image.",
                        "Voxel penumbra corner/contact errors and cone-filter detail loss remain visible; no filtering hides them.",
                        "Fifteen moving-vehicle Float32 payloads omitted; every native PNG and raw-float digest retained.",
                        "Vehicle companion uses original triangles for contact, not a signed analytic vehicle field.",
                        "Calibration distance levels have a fixed centre and rebuild on change; vehicle clips retain dirty-region relocation.",
                        "No Windows/editor, physical GPU, driving physics, frame pacing or production replacement is verified."],
        "source_sha256": {Location: Digest((Root / Location).read_bytes()) for Location in SourceLocations()},
        "executables_sha256": {Name: Digest((Arguments.BuildDirectory / (Name + (".exe" if platform.system() == "Windows" else ""))).read_bytes())
                               for Name in ["SdfShadowValidation", "SdfShadowVulkan", "SphereVehicleValidation"]}}
    (Exhibit / "Results/ShadowSummary.json").write_text(json.dumps(Summary, indent=2) + "\n")
    print(json.dumps({Key: Summary[Key] for Key in ["passed", "new_native_shadow_paths_executed", "native_captures", "unique_lossless_float_buffers", "motion_float_payloads_omitted", "renderer_accepted"]}))


if __name__ == "__main__":
    Execute()
