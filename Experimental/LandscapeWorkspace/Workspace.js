/*==========================================================================================================================================
                                                              WORKSPACE.JS
==========================================================================================================================================*/
// Authoring controller connecting 2D vector masks, per-layer 3D SDF stacks, live GPU 3D sculpt, and analytic water plane.

import {
    VOLUME_RESOLUTIONS, CreateLayer, CreateCoastalWorld, CreatePresetSingleWorld, CreateTerrainWorld,
    LayerVerticalBounds, SegmentCount, ValidateDocument, SampleSparseBricks, InvalidateLandforms
} from './DomainModel.js';
import { CreateSdfVolumeEngine } from './SdfVolumeEngine.js';
import { InitializeLayerStackPanel } from './LayerStackPanel.js';
import { StackGlyph, InitializeGlyphs } from './StackGlyphs.js';

const Find = sel => document.querySelector(sel);
const Paint = Find('#Paint');
const Volume = Find('#Volume');
const Ink = Paint.getContext('2d');

let Layers = CreateCoastalWorld();
let SculptOps = [];
let Active = 0;
let SelectedLayers = new Set([0]);
let Workspace = 'landscape';
let InspectorSection = 'shape';
let Tool2D = 'paint';
let Tool3D = 'orbit'; // 'orbit' | 'pan' | 'sculpt'
let SculptMode = 'add'; // 'add' | 'remove' | 'smooth' | 'flatten'
let Projection = { X: -60, Z: -40, Scale: 0.55 };
let Selection = null;
let Gesture = null;
let BrushPosition = null;
let SpaceDown = false;
let DraggedMask = -1;
let History = [];
let Future = [];
let SaveTimer = null;

const Camera = { Yaw: 0.58, Pitch: 0.44, Orbit: 920, Target: [-70, 28, -20] };
const Keys = new Set();
let OceanTime = 18.0;
let LastFrameTime = performance.now();
let FpsFrames = 0, FpsAccum = 0;

const Layer = () => Layers[Active];
const Report = msg => { Find('#Status').textContent = msg; };
const DocumentObj = () => ({ Format: 'FrontierLandscape/1', Layers });

// Restore valid local storage if present
try {
    const stored = localStorage.getItem('FrontierLandscapeV2');
    if (stored) {
        const parsed = JSON.parse(stored);
        ValidateDocument(parsed);
        Layers = parsed.Layers;
    }
} catch {}

// Initialize rebuilt WebGL 2 3D SDF Engine
let Engine = null;
try {
    Engine = CreateSdfVolumeEngine(Volume, {
        onBuildProgress(frac, nx, nz, ny) {
            const badge = Find('#BuildBadge');
            badge.hidden = false;
            badge.textContent = `Baking 3D SDF ${nx}×${nz}×${ny} · ${Math.round(frac * 100)}%`;
        },
        onBuildComplete(nx, nz, ny) {
            Find('#BuildBadge').hidden = true;
            Find('#FieldBadge').textContent = `3D SDF · ${nx}×${nz}×${ny}`;
            Find('#RenderReadout').textContent = `WebGL2 · ${nx}×${nz}×${ny} · No LOD`;
            UpdateBoundsReadout();
        }
    });
    Find('#DriverReadout').textContent = `WebGL 2 · ${Engine.GPU_RENDERER || 'GPU 3D SDF'}`;
} catch (err) {
    Report(`WebGL 2 Init Error: ${err.message}`);
}

function CaptureSnapshot() {
    return JSON.stringify({
        Layers, SculptOps, Active,
        SelectedMasks: [...SelectedLayers],
        StackSelection: Panel.RetrieveSelection()
    });
}

function RestoreSnapshot(json) {
    const snap = JSON.parse(json);
    ReplaceLayers(snap.Layers);
    SculptOps = snap.SculptOps || [];
    Active = Math.max(0, Math.min(snap.Active || 0, Layers.length - 1));
    SelectedLayers = new Set((snap.SelectedMasks || [0]).filter(i => i < Layers.length));
    if (!SelectedLayers.size) SelectedLayers.add(Active);
    Panel.RestoreSelection(snap.StackSelection);
}

function Remember() {
    History.push(CaptureSnapshot());
    if (History.length > 50) History.shift();
    Future = [];
}

function ReplaceLayers(next) {
    Layers = next;
    Active = Math.max(0, Math.min(Active, Layers.length - 1));
    SelectedLayers = new Set([...SelectedLayers].filter(i => i < Layers.length));
    if (!SelectedLayers.size) SelectedLayers.add(Active);
}

function ScheduleSave() {
    Find('#SaveStatus').textContent = 'Saving…';
    clearTimeout(SaveTimer);
    SaveTimer = setTimeout(() => {
        try {
            localStorage.setItem('FrontierLandscapeV2', JSON.stringify(DocumentObj()));
            Find('#SaveStatus').textContent = 'Saved locally';
        } catch {
            Find('#SaveStatus').textContent = 'Not saved';
        }
    }, 300);
}

function UpdateBoundsReadout() {
    const res = Engine ? Engine.getResolution() : { nx: 512, nz: 512, ny: 256 };
    const b = Engine?.getWorldBounds();
    if (!b) return;
    const dx = ((b.max[0] - b.min[0]) / res.nx).toFixed(2);
    const dy = ((b.max[1] - b.min[1]) / res.ny).toFixed(2);
    const dz = ((b.max[2] - b.min[2]) / res.nz).toFixed(2);
    Find('#VolumeBoundsRead').textContent =
        `World box: ${(b.max[0] - b.min[0]).toFixed(0)} × ${(b.max[1] - b.min[1]).toFixed(0)} × ${(b.max[2] - b.min[2]).toFixed(0)} m · Voxel spacing: ${dx} × ${dy} × ${dz} m (single unified 3D volume, zero LOD).`;
}

function Rebuild3DSdf() {
    if (!Engine) return;
    Engine.uploadWorldData(Layers, SculptOps);
}

function Changed(geometryChanged = true) {
    if (geometryChanged) {
        InvalidateLandforms();
        Rebuild3DSdf();
    }
    Refresh();
    Draw2D();
    ScheduleSave();
}

// ---------- Mask Outliner & Inspector ----------

function PaintStroke(ctx, stroke, color) {
    ctx.globalCompositeOperation = stroke.Erase ? 'destination-out' : 'source-over';
    ctx.fillStyle = color;
    ctx.strokeStyle = color;
    ctx.lineWidth = stroke.Radius * 2;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.beginPath();
    ctx.moveTo(...stroke.Points[0]);
    for (const pt of stroke.Points) ctx.lineTo(...pt);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(...stroke.Points[0], stroke.Radius, 0, Math.PI * 2);
    ctx.fill();
}

function MaskThumbnail(entry) {
    const canvas = document.createElement('canvas');
    canvas.width = 96; canvas.height = 88;
    if (!entry.Strokes.length) return canvas;
    const xs = entry.Strokes.flatMap(s => s.Points.flatMap(p => [p[0] - s.Radius, p[0] + s.Radius]));
    const zs = entry.Strokes.flatMap(s => s.Points.flatMap(p => [p[1] - s.Radius, p[1] + s.Radius]));
    const minX = Math.min(...xs), maxX = Math.max(...xs), minZ = Math.min(...zs), maxZ = Math.max(...zs);
    const scale = Math.min(80 / Math.max(1, maxX - minX), 72 / Math.max(1, maxZ - minZ));
    const ctx = canvas.getContext('2d');
    ctx.setTransform(scale, 0, 0, scale, 48 - (minX + maxX) * 0.5 * scale, 44 - (minZ + maxZ) * 0.5 * scale);
    for (const s of entry.Strokes) PaintStroke(ctx, s, entry.Color);
    return canvas;
}

function SelectMask(index, additive = false) {
    Active = index;
    if (!additive) SelectedLayers = new Set([index]);
    else if (SelectedLayers.has(index)) { if (SelectedLayers.size > 1) SelectedLayers.delete(index); }
    else SelectedLayers.add(index);
    Selection = null;
    Panel.CloseMenu();
    Refresh();
    Draw2D();
    Report(`${Layer().Name} selected · ${SelectedLayers.size} mask${SelectedLayers.size === 1 ? '' : 's'}.`);
}

function ReorderMasks(from, to) {
    if (from < 0 || to < 0 || to >= Layers.length || from === to) return;
    Remember();
    const [moved] = Layers.splice(from, 1);
    Layers.splice(to, 0, moved);
    Active = to;
    SelectedLayers = new Set([to]);
    Panel.ResetSelection();
    Changed();
    Report(`${moved.Name} moved to layer slot ${to + 1}.`);
}

function RenderMasks() {
    Find('#Layers').replaceChildren();
    Layers.forEach((entry, index) => {
        const row = document.createElement('div');
        row.className = `mask-row ${index === Active ? 'selected' : ''} ${SelectedLayers.has(index) ? 'batch-selected' : ''} ${entry.Visible ? '' : 'muted'}`;
        row.dataset.maskIndex = index;
        row.tabIndex = 0;
        row.draggable = true;
        const thumb = document.createElement('span');
        thumb.className = 'mask-thumbnail';
        thumb.append(MaskThumbnail(entry));
        const copy = document.createElement('span');
        copy.className = 'mask-copy';
        const title = document.createElement('strong'), detail = document.createElement('small');
        title.textContent = entry.Name;
        detail.textContent = `${entry.Regions.length} region${entry.Regions.length === 1 ? '' : 's'} · ${(entry.Landforms || []).length} SDF ops`;
        copy.append(title, detail);

        const eye = document.createElement('button');
        eye.className = 'icon-button';
        eye.title = `Toggle ${entry.Name}`;
        eye.append(StackGlyph(entry.Visible ? 'eye' : 'eye-off'));
        eye.onclick = e => { e.stopPropagation(); Remember(); entry.Visible = !entry.Visible; Changed(); };
        row.append(thumb, copy, eye);

        if (SelectedLayers.size > 1 && SelectedLayers.has(index)) {
            const mark = document.createElement('span');
            mark.className = 'batch-mark';
            row.append(mark);
        }
        row.ondragstart = e => { DraggedMask = index; e.dataTransfer.effectAllowed = 'move'; };
        row.ondragover = e => { if (DraggedMask >= 0 && DraggedMask !== index) { e.preventDefault(); row.classList.add('drop-target'); } };
        row.ondragleave = () => row.classList.remove('drop-target');
        row.ondrop = e => { if (DraggedMask >= 0) { e.preventDefault(); const f = DraggedMask; DraggedMask = -1; ReorderMasks(f, index); } };
        row.ondragend = () => { DraggedMask = -1; document.querySelectorAll('.drop-target').forEach(el => el.classList.remove('drop-target')); };
        row.onclick = e => SelectMask(index, e.ctrlKey || e.metaKey);
        Find('#Layers').append(row);
    });
    Find('#MaskLayerCount').textContent = Layers.length;
    Find('#DuplicateMask').disabled = Layers.length >= 16;
    Find('#DeleteMask').disabled = Layers.length <= 1;
}

function RenderRegions() {
    Find('#MaskName').value = Layer().Name;
    Find('#MaskColour').value = Layer().Color;
    Find('#RegionCount').textContent = Layer().Regions.length;
    Find('#RegionList').replaceChildren();
    Layer().Regions.forEach((r, i) => {
        const row = document.createElement('div');
        row.className = `region-row ${i === Panel.RetrieveBoundary() ? 'selected' : ''}`;
        const cap = document.createElement('button');
        cap.textContent = `Region ${String(i + 1).padStart(2, '0')}`;
        const det = document.createElement('small');
        det.textContent = `${Math.round(r.X1 - r.X0)} × ${Math.round(r.Z1 - r.Z0)} m`;
        cap.append(det);
        cap.onclick = () => Panel.SelectBoundary(i);
        const rem = document.createElement('button');
        rem.className = 'icon-button';
        rem.append(StackGlyph('close'));
        rem.onclick = () => { Remember(); Layer().Regions.splice(i, 1); Panel.ResetBoundary(); Changed(); };
        row.append(cap, rem);
        Find('#RegionList').append(row);
    });
    const region = Layer().Regions[Panel.RetrieveBoundary()];
    Find('#EdgeWidth').disabled = !region;
    Find('#EdgeWidth').value = region?.Edge || 0;
    Find('#EdgeRead').textContent = `${region?.Edge || 0} m`;
    Find('#Depth').value = Layer().Depth;
    Find('#DepthRead').textContent = `${Layer().Depth} m`;
    Find('#Caves').checked = !!Layer().Caves;
    Find('#PreviewBake').disabled = !region;

    const w = region?.Edge || 0;
    Find('#CoastProfile').innerHTML = `<svg viewBox="0 0 220 65"><path d="M8 49H212" stroke="#666" stroke-width=".6"/><path d="M15 49 ${w > 0 ? 'C55 49 58 18 130 18' : 'L55 49 55 18 130 18'} H210" stroke="#b7c4c4" stroke-width="1.2" fill="none"/><text x="148" y="60" fill="#717171" font-size="7" font-family="DM Sans">SEA LEVEL · 0 m</text></svg>`;
    UpdateBoundsReadout();
}

function Refresh() {
    RenderMasks();
    RenderRegions();
    Panel.Render();
    Find('#HistoryUndo').disabled = !History.length;
    Find('#HistoryRedo').disabled = !Future.length;
    Find('#StrokeCount').textContent = `${SegmentCount(Layers)} / 512 vector samples`;
    Find('#SelectionPrompt').hidden = !Selection || Workspace !== 'mask';
    document.querySelectorAll('input[type="range"]').forEach(inp => {
        inp.style.setProperty('--progress', `${(inp.value - inp.min) / (inp.max - inp.min) * 100}%`);
    });
}

// ---------- 2D Vector Mask Editor ----------

function World2D(e) {
    const b = Paint.getBoundingClientRect();
    return [
        (e.clientX - b.left - b.width / 2) / Projection.Scale + Projection.X,
        (e.clientY - b.top - b.height / 2) / Projection.Scale + Projection.Z
    ];
}

function Draw2D() {
    if (Workspace !== 'mask') return;
    const ratio = Math.min(devicePixelRatio, 2), w = Paint.clientWidth, h = Paint.clientHeight;
    Paint.width = Math.max(1, Math.floor(w * ratio));
    Paint.height = Math.max(1, Math.floor(h * ratio));
    Ink.setTransform(ratio, 0, 0, ratio, 0, 0);
    Ink.fillStyle = '#181e20';
    Ink.fillRect(0, 0, w, h);

    const grid = 100 * Math.pow(10, Math.floor(Math.log10(1 / Projection.Scale)));
    const left = Projection.X - w / 2 / Projection.Scale, top = Projection.Z - h / 2 / Projection.Scale;
    Ink.strokeStyle = '#283032'; Ink.lineWidth = 0.7;
    Ink.beginPath();
    for (let x = Math.floor(left / grid) * grid; x < left + w / Projection.Scale; x += grid) {
        const px = (x - Projection.X) * Projection.Scale + w / 2;
        Ink.moveTo(px, 0); Ink.lineTo(px, h);
    }
    for (let z = Math.floor(top / grid) * grid; z < top + h / Projection.Scale; z += grid) {
        const py = (z - Projection.Z) * Projection.Scale + h / 2;
        Ink.moveTo(0, py); Ink.lineTo(w, py);
    }
    Ink.stroke();

    const surf = document.createElement('canvas');
    surf.width = Paint.width; surf.height = Paint.height;
    const brush = surf.getContext('2d');
    for (const entry of Layers) {
        if (!entry.Visible) continue;
        brush.setTransform(1, 0, 0, 1, 0, 0);
        brush.clearRect(0, 0, surf.width, surf.height);
        brush.setTransform(ratio * Projection.Scale, 0, 0, ratio * Projection.Scale,
            ratio * (w / 2 - Projection.X * Projection.Scale), ratio * (h / 2 - Projection.Z * Projection.Scale));
        for (const s of entry.Strokes) PaintStroke(brush, s, entry.Color);
        Ink.globalAlpha = entry === Layer() ? 0.85 : 0.38;
        Ink.drawImage(surf, 0, 0, w, h);
    }
    Ink.globalAlpha = 1;
    Ink.setTransform(ratio * Projection.Scale, 0, 0, ratio * Projection.Scale,
        ratio * (w / 2 - Projection.X * Projection.Scale), ratio * (h / 2 - Projection.Z * Projection.Scale));

    Layers.forEach((entry, idx) => {
        if (!entry.Visible) return;
        entry.Regions.forEach((reg, ri) => {
            Ink.strokeStyle = idx === Active ? '#c4d2d3' : '#5e7175';
            Ink.lineWidth = 1 / Projection.Scale;
            Ink.setLineDash([5 / Projection.Scale, 5 / Projection.Scale]);
            Ink.strokeRect(reg.X0, reg.Z0, reg.X1 - reg.X0, reg.Z1 - reg.Z0);
            Ink.fillStyle = idx === Active ? '#a8b8ba' : '#60777b';
            Ink.font = `${9 / Projection.Scale}px "DM Sans", sans-serif`;
            Ink.fillText(`${entry.Name.toUpperCase()} / R${ri + 1}`, reg.X0, reg.Z0 - 10 / Projection.Scale);
        });
    });
    if (Selection) {
        Ink.setLineDash([]);
        Ink.strokeStyle = '#d5e2e3'; Ink.fillStyle = '#cddfe414';
        Ink.fillRect(Selection.X0, Selection.Z0, Selection.X1 - Selection.X0, Selection.Z1 - Selection.Z0);
        Ink.strokeRect(Selection.X0, Selection.Z0, Selection.X1 - Selection.X0, Selection.Z1 - Selection.Z0);
    }
    Ink.setLineDash([]);
    if (BrushPosition && ['paint', 'erase'].includes(Tool2D)) {
        Ink.lineWidth = 1 / Projection.Scale;
        Ink.strokeStyle = Tool2D === 'erase' ? '#f3c2bbaa' : '#dde5e7bb';
        Ink.beginPath();
        Ink.arc(...BrushPosition, Number(Find('#Radius').value), 0, Math.PI * 2);
        Ink.stroke();
    }
    Find('#ScaleRead').textContent = `${Math.round(70 / Projection.Scale)} m`;
}

// ---------- Tools & Workspace Switching ----------

function SelectTool2D(next) {
    Tool2D = next;
    document.querySelectorAll('[data-tool]').forEach(el => el.classList.toggle('active', el.dataset.tool === next));
    Paint.style.cursor = next === 'pan' ? 'grab' : next === 'select' ? 'crosshair' : 'none';
    Draw2D();
}

function SelectTool3D(next) {
    Tool3D = next;
    Find('#OrbitCamera').classList.toggle('active', next === 'orbit');
    Find('#PanCamera').classList.toggle('active', next === 'pan');
    Find('#SculptTool').classList.toggle('active', next === 'sculpt');
    Find('#SculptTool').setAttribute('aria-pressed', String(next === 'sculpt'));
    Find('#SculptToggleBtn').textContent = next === 'sculpt' ? 'Exit 3D Sculpting (Esc)' : 'Enable 3D Sculpting (B)';
    Find('#SculptToggleBtn').classList.toggle('primary-button', next === 'sculpt');
    Find('#SculptToggleBtn').classList.toggle('border-button', next !== 'sculpt');
    Volume.style.cursor = next === 'pan' ? 'grab' : next === 'sculpt' ? 'crosshair' : 'default';
    if (next !== 'sculpt') Engine?.clearSculptCursor();
    if (next === 'sculpt') ActivateInspector('shape');
}

function ActivateInspector(section) {
    InspectorSection = section;
    document.querySelectorAll('[data-inspector]').forEach(c => c.classList.toggle('active', c.dataset.inspector === section));
    Find('#ShapeInspector').hidden = section !== 'shape';
    Find('#RegionInspector').hidden = section !== 'region';
    Find('#OceanPanel').hidden = section !== 'ocean';
}

function SwitchWorkspace(next) {
    Workspace = next;
    Panel.CloseMenu();
    Keys.clear();
    Paint.hidden = next !== 'mask';
    Volume.hidden = next === 'mask';
    Find('#TerrainStackPanel').hidden = next === 'mask';
    Find('#MaskInstructions').hidden = next !== 'mask';
    Find('#BrushPanel').hidden = next !== 'mask';
    Find('#SculptPanel').hidden = next === 'mask';
    Find('#LandformPanel').hidden = next === 'mask';
    Find('#PaintTools').hidden = next !== 'mask';
    Find('#LandscapeTools').hidden = next === 'mask';
    Find('#CameraNavigation').hidden = next === 'mask';
    Find('#MaskTab').classList.toggle('active', next === 'mask');
    Find('#LandscapeTab').classList.toggle('active', next === 'landscape');
    Find('#ViewTitle').textContent = next === 'mask' ? 'Mask editor' : 'Landscape 3D';
    Find('#ViewSubtitle').textContent = next === 'mask' ? 'Top orthographic vector masks' : 'Sphere-traced R16F 3D SDF · No LOD';
    Find('#ViewportGlyph').replaceChildren(StackGlyph(next === 'mask' ? 'mask' : 'mountain'));
    Find('#ModeLabel').textContent = next === 'mask' ? 'TOP ORTHOGRAPHIC' : 'PERSPECTIVE';
    if (next === 'mask') {
        Engine?.suspend();
        if (InspectorSection === 'ocean') ActivateInspector('shape');
    } else {
        Engine?.resume();
    }
    Refresh();
    Draw2D();
}

function Fit(activeOnly = false) {
    const sources = activeOnly ? [Layer()] : Layers.filter(e => e.Visible);
    const regions = sources.flatMap(e => e.Regions);
    if (!regions.length) {
        Projection = { X: 0, Z: 0, Scale: 0.6 };
        Camera.Target = [0, 12, 0]; Camera.Orbit = 650;
        Draw2D();
        return;
    }
    const x0 = Math.min(...regions.map(r => r.X0)), x1 = Math.max(...regions.map(r => r.X1));
    const z0 = Math.min(...regions.map(r => r.Z0)), z1 = Math.max(...regions.map(r => r.Z1));
    const w = Find('#Viewport').clientWidth, h = Find('#Viewport').clientHeight;
    Projection = {
        X: (x0 + x1) / 2, Z: (z0 + z1) / 2,
        Scale: Math.max(0.001, Math.min((w - 130) / Math.max(1, x1 - x0), (h - 150) / Math.max(1, z1 - z0)))
    };
    const top = Math.max(20, ...sources.flatMap(e => e.Regions.map(r => LayerVerticalBounds(e, r)[1])));
    Camera.Target = [Projection.X, top * 0.14, Projection.Z];
    Camera.Orbit = Math.max(180, Math.max(x1 - x0, z1 - z0) * 1.12);
    Draw2D();
}

// ---------- Pointer Handling: 2D Mask & 3D Viewport ----------

Paint.onpointerdown = e => {
    if (e.button > 2) return;
    Paint.setPointerCapture(e.pointerId);
    const pt = World2D(e), mode = SpaceDown || e.button === 1 || e.button === 2 ? 'pan' : Tool2D;
    Gesture = { Mode: mode, Point: pt, Client: [e.clientX, e.clientY] };
    if (mode === 'paint' || mode === 'erase') {
        if (SegmentCount(Layers) >= 512) { Gesture = null; Report('Maximum 512 vector samples.'); return; }
        Remember();
        Layer().Strokes.push({ Points: [pt], Radius: Number(Find('#Radius').value), Erase: mode === 'erase' });
    }
    if (mode === 'select') Selection = { X0: pt[0], Z0: pt[1], X1: pt[0], Z1: pt[1] };
    e.preventDefault();
    Draw2D();
};

Paint.onpointermove = e => {
    const pt = World2D(e);
    BrushPosition = pt;
    Find('#Coordinates').textContent = `X ${Math.round(pt[0])} · Z ${Math.round(pt[1])}`;
    if (Gesture?.Mode === 'pan') {
        Projection.X -= (e.clientX - Gesture.Client[0]) / Projection.Scale;
        Projection.Z -= (e.clientY - Gesture.Client[1]) / Projection.Scale;
        Gesture.Client = [e.clientX, e.clientY];
    } else if (Gesture?.Mode === 'select') {
        Selection = {
            X0: Math.min(pt[0], Gesture.Point[0]), Z0: Math.min(pt[1], Gesture.Point[1]),
            X1: Math.max(pt[0], Gesture.Point[0]), Z1: Math.max(pt[1], Gesture.Point[1])
        };
    } else if (Gesture) {
        const stroke = Layer().Strokes.at(-1), prev = stroke.Points.at(-1);
        if (Math.hypot(pt[0] - prev[0], pt[1] - prev[1]) > Math.max(1, stroke.Radius * 0.12) && SegmentCount(Layers) < 512) {
            stroke.Points.push(pt);
        }
    }
    Draw2D();
};

function Finish2D() {
    if (!Gesture || Workspace !== 'mask') return;
    const authored = ['paint', 'erase'].includes(Gesture.Mode);
    if (Selection && (Selection.X1 - Selection.X0 < 2 || Selection.Z1 - Selection.Z0 < 2)) Selection = null;
    Gesture = null;
    SelectTool2D(Tool2D);
    if (authored) Changed();
    else { Refresh(); Draw2D(); }
}
Paint.onpointerup = Finish2D;
Paint.onpointercancel = Finish2D;
Paint.onpointerleave = () => { BrushPosition = null; Draw2D(); };
Paint.oncontextmenu = e => e.preventDefault();
Paint.addEventListener('wheel', e => {
    e.preventDefault();
    const before = World2D(e);
    Projection.Scale = Math.max(0.001, Math.min(100, Projection.Scale * Math.exp(-e.deltaY * 0.001)));
    const after = World2D(e);
    Projection.X += before[0] - after[0];
    Projection.Z += before[1] - after[1];
    BrushPosition = after;
    Draw2D();
}, { passive: false });

// 3D Camera Eye helper
function GetEye() {
    const cp = Math.cos(Camera.Pitch), sp = Math.sin(Camera.Pitch);
    const sy = Math.sin(Camera.Yaw), cy = Math.cos(Camera.Yaw);
    return [
        Camera.Target[0] + Camera.Orbit * cp * sy,
        Camera.Target[1] + Camera.Orbit * sp,
        Camera.Target[2] + Camera.Orbit * cp * cy
    ];
}

function NdcFromEvent(e) {
    const b = Volume.getBoundingClientRect();
    return [
        ((e.clientX - b.left) / b.width) * 2 - 1,
        1 - ((e.clientY - b.top) / b.height) * 2
    ];
}

let activeSculptStroke = null;

Volume.onpointerdown = e => {
    Volume.setPointerCapture(e.pointerId);
    const navOverride = e.altKey || e.shiftKey || SpaceDown || e.button === 1 || e.button === 2 || Tool3D === 'pan';

    if (!navOverride && e.button === 0 && Tool3D === 'sculpt' && Engine && !Engine.isBuilding()) {
        const [nx, ny] = NdcFromEvent(e);
        const pick = Engine.raycastSurfaceAt(nx, ny, GetEye());
        if (pick?.hit) {
            const radius = Number(Find('#SculptRadius').value);
            const strength = Number(Find('#SculptStrength').value);
            Remember();
            activeSculptStroke = {
                Mode: SculptMode,
                LayerIndex: Active,
                Radius: radius,
                Strength: strength,
                Anchor: [...pick.pos],
                Normal: [...pick.normal],
                Points: [[...pick.pos]],
                LastHit: [...pick.pos]
            };
            Engine.applySculptSegment(
                pick.pos, pick.pos, radius, strength, SculptMode, Active,
                activeSculptStroke.Anchor, activeSculptStroke.Normal
            );
            Engine.setSculptCursor(pick.pos[0], pick.pos[1], pick.pos[2], radius);
            Gesture = { Mode: 'sculpt' };
            e.preventDefault();
            return;
        }
    }

    Gesture = {
        Mode: navOverride || Tool3D === 'pan' ? 'pan3d' : 'orbit',
        Client: [e.clientX, e.clientY]
    };
    e.preventDefault();
};

Volume.onpointermove = e => {
    if (!Gesture) {
        if (Tool3D === 'sculpt' && Engine && !Engine.isBuilding()) {
            const [nx, ny] = NdcFromEvent(e);
            const pick = Engine.raycastSurfaceAt(nx, ny, GetEye());
            if (pick?.hit) {
                Engine.setSculptCursor(pick.pos[0], pick.pos[1], pick.pos[2], Number(Find('#SculptRadius').value));
                Find('#Coordinates').textContent = `SDF HIT X ${pick.pos[0].toFixed(1)} · Y ${pick.pos[1].toFixed(1)} · Z ${pick.pos[2].toFixed(1)}`;
            } else {
                Engine.clearSculptCursor();
            }
        }
        return;
    }

    if (Gesture.Mode === 'sculpt' && activeSculptStroke && Engine) {
        const [nx, ny] = NdcFromEvent(e);
        const pick = Engine.raycastSurfaceAt(nx, ny, GetEye());
        if (pick?.hit) {
            const prev = activeSculptStroke.LastHit;
            const d = Math.hypot(pick.pos[0] - prev[0], pick.pos[1] - prev[1], pick.pos[2] - prev[2]);
            if (d > Math.max(0.4, activeSculptStroke.Radius * 0.14)) {
                Engine.applySculptSegment(
                    prev, pick.pos, activeSculptStroke.Radius, activeSculptStroke.Strength,
                    activeSculptStroke.Mode, activeSculptStroke.LayerIndex,
                    activeSculptStroke.Anchor, activeSculptStroke.Normal
                );
                activeSculptStroke.Points.push([...pick.pos]);
                activeSculptStroke.LastHit = [...pick.pos];
            }
            Engine.setSculptCursor(pick.pos[0], pick.pos[1], pick.pos[2], activeSculptStroke.Radius);
        }
        return;
    }

    const dx = e.clientX - Gesture.Client[0], dy = e.clientY - Gesture.Client[1];
    if (Gesture.Mode === 'pan3d') {
        Camera.Target[0] -= (dx * Math.cos(Camera.Yaw) + dy * Math.sin(Camera.Yaw)) * Camera.Orbit * 0.0011;
        Camera.Target[2] += (dx * Math.sin(Camera.Yaw) - dy * Math.cos(Camera.Yaw)) * Camera.Orbit * 0.0011;
    } else {
        Camera.Yaw -= dx * 0.0065;
        Camera.Pitch = Math.max(-1.48, Math.min(1.48, Camera.Pitch + dy * 0.0055));
    }
    Gesture.Client = [e.clientX, e.clientY];
};

function Finish3D() {
    if (Gesture?.Mode === 'sculpt' && activeSculptStroke) {
        const op = activeSculptStroke;
        activeSculptStroke = null;
        if (op.Mode === 'add' || op.Mode === 'remove') {
            const rIdx = Math.min(Panel.RetrieveBoundary(), Math.max(0, Layer().Regions.length - 1));
            const reg = Layer().Regions[rIdx];
            if (reg) {
                reg.SculptStrokes ||= [];
                reg.SculptStrokes.push({
                    Mode: op.Mode, Radius: op.Radius, Strength: op.Strength, Points: op.Points
                });
            }
        }
        SculptOps.push(op);
        ScheduleSave();
        Report(`Applied 3D ${op.Mode} stroke (${op.Points.length} samples) to ${Layer().Name}. Ctrl+Z undoes.`);
    }
    Gesture = null;
}
Volume.onpointerup = Finish3D;
Volume.onpointercancel = Finish3D;
Volume.onmouseleave = () => Engine?.clearSculptCursor();
Volume.oncontextmenu = e => e.preventDefault();
Volume.addEventListener('wheel', e => {
    e.preventDefault();
    Camera.Orbit = Math.max(12, Math.min(4500, Camera.Orbit * Math.exp(e.deltaY * 0.001)));
}, { passive: false });

// ---------- Wiring UI Controls ----------

const Panel = InitializeLayerStackPanel({
    RetrieveLayers: () => Layers,
    RetrieveActive: () => Active,
    RetrieveSelected: () => SelectedLayers,
    RetrieveWorkspace: () => Workspace,
    RetrieveInspector: () => InspectorSection,
    ReplaceLayers, Remember, Changed, Refresh, Report, ActivateInspector
});

InitializeGlyphs();

function ApplyResolutionChoice(val) {
    const spec = VOLUME_RESOLUTIONS.find(r => r.key === val);
    if (!spec || !Engine) return;
    Find('#VolumeResSelect').value = val;
    Find('#VolumeResMirror').value = val;
    try {
        Engine.setResolution(spec.nx, spec.ny, spec.nz);
        Rebuild3DSdf();
        Report(`3D SDF volume reallocated to ${spec.label} (${spec.vramMiB} MiB, no LOD).`);
    } catch (err) {
        const cur = Engine.getResolution();
        const curKey = `${cur.nx}x${cur.nz}x${cur.ny}`;
        Find('#VolumeResSelect').value = curKey;
        Find('#VolumeResMirror').value = curKey;
        Report(`Resolution switch failed: ${err.message}`);
    }
}
Find('#VolumeResSelect').onchange = e => ApplyResolutionChoice(e.target.value);
Find('#VolumeResMirror').onchange = e => ApplyResolutionChoice(e.target.value);

Find('#WorldPreset').onchange = e => {
    const v = e.target.value;
    Remember();
    SculptOps = [];
    if (v === 'coastal') Layers = CreateCoastalWorld();
    else if (v === 'examples') Layers = CreateTerrainWorld();
    else Layers = CreatePresetSingleWorld(v);
    Active = 0; SelectedLayers = new Set([0]);
    Panel.ResetSelection();
    Changed();
    Fit(false);
    Report(`Loaded ${Find('#WorldPreset').selectedOptions[0].textContent}.`);
};

Find('#MaskTab').onclick = () => SwitchWorkspace('mask');
Find('#LandscapeTab').onclick = Find('#Build').onclick = () => SwitchWorkspace('landscape');
Find('#EditMask').onclick = () => { SwitchWorkspace('mask'); ActivateInspector('shape'); Refresh(); };
Find('#FocusMask').onclick = () => Fit(true);
Find('#Fit').onclick = () => Fit(false);

Find('#OrbitCamera').onclick = () => SelectTool3D('orbit');
Find('#PanCamera').onclick = () => SelectTool3D('pan');
Find('#SculptTool').onclick = () => SelectTool3D(Tool3D === 'sculpt' ? 'orbit' : 'sculpt');
Find('#SculptToggleBtn').onclick = () => SelectTool3D(Tool3D === 'sculpt' ? 'orbit' : 'sculpt');

document.querySelectorAll('[data-sculpt-mode]').forEach(btn => {
    btn.onclick = () => {
        SculptMode = btn.dataset.sculptMode;
        document.querySelectorAll('[data-sculpt-mode]').forEach(b => b.classList.toggle('active', b === btn));
        if (Tool3D !== 'sculpt') SelectTool3D('sculpt');
    };
});

Find('#SculptRadius').oninput = e => { Find('#SculptRadiusRead').textContent = `${Number(e.target.value).toFixed(1)} m`; };
Find('#SculptStrength').oninput = e => { Find('#SculptStrengthRead').textContent = `${Math.round(Number(e.target.value) * 100)}%`; };

document.querySelectorAll('[data-tool]').forEach(c => c.onclick = () => SelectTool2D(c.dataset.tool));
document.querySelectorAll('[data-inspector]').forEach(c => c.onclick = () => { ActivateInspector(c.dataset.inspector); Panel.Render(); });
Find('#Environment').onclick = () => { ActivateInspector('ocean'); Panel.Render(); };

Find('#Ocean').onchange = () => Find('#ViewportOcean').classList.toggle('active', Find('#Ocean').checked);
Find('#ViewportOcean').onclick = () => {
    Find('#Ocean').checked = !Find('#Ocean').checked;
    Find('#Ocean').dispatchEvent(new Event('change'));
};

function SyncOceanReadouts() {
    Find('#SwellRead').textContent = Number(Find('#SwellSlider').value).toFixed(2);
    Find('#ClarityRead').textContent = Number(Find('#ClaritySlider').value).toFixed(2);
    Find('#FoamRead').textContent = Number(Find('#FoamSlider').value).toFixed(2);
    Find('#SunRead').textContent = `${Find('#SunSlider').value}°`;
}
['#SwellSlider', '#ClaritySlider', '#FoamSlider', '#SunSlider'].forEach(sel => {
    Find(sel).addEventListener('input', SyncOceanReadouts);
});
SyncOceanReadouts();

// Layer & region mutations
Find('#KeepRegion').onclick = () => {
    if (!Selection) return;
    if (Layer().Regions.length >= 16) { Report('Maximum 16 regions per mask.'); return; }
    Remember();
    Layer().Regions.push({ ...Selection, Edge: 60 });
    Selection = null;
    Panel.SelectBoundary(Layer().Regions.length - 1);
    Changed();
    Report('Region added to mask.');
};
Find('#CancelSelection').onclick = () => { Selection = null; Refresh(); Draw2D(); };
Find('#AddLayer').onclick = () => {
    if (Layers.length >= 16) { Report('Maximum 16 layers.'); return; }
    Remember();
    Layers.push(CreateLayer(Layers.length));
    Active = Layers.length - 1; SelectedLayers = new Set([Active]);
    Changed();
    SwitchWorkspace('mask'); Fit(true);
    Report('New layer added. Paint mask strokes and box-select region bounds.');
};
Find('#DuplicateMask').onclick = () => {
    Remember();
    const copy = structuredClone(Layer());
    copy.Name = `${copy.Name.slice(0, 88)} copy`;
    Layers.push(copy);
    Active = Layers.length - 1; SelectedLayers = new Set([Active]);
    Panel.ResetSelection();
    Changed();
};
Find('#DeleteMask').onclick = () => {
    if (Layers.length <= 1) return;
    Remember();
    Layers.splice(Active, 1);
    Active = Math.min(Active, Layers.length - 1);
    SelectedLayers = new Set([Active]);
    Panel.ResetSelection();
    Changed();
};
Find('#MaskName').onchange = e => Panel.Modify(() => { Layer().Name = e.target.value.trim() || Layer().Name; }, false);
Find('#MaskColour').onchange = e => Panel.Modify(() => { Layer().Color = e.target.value; });
Find('#Depth').oninput = e => { Find('#DepthRead').textContent = `${e.target.value} m`; };
Find('#Depth').onchange = e => Panel.Modify(() => { Layer().Depth = Number(e.target.value); });
Find('#EdgeWidth').oninput = e => { Find('#EdgeRead').textContent = `${e.target.value} m`; };
Find('#EdgeWidth').onchange = e => Panel.Modify(() => {
    const r = Layer().Regions[Panel.RetrieveBoundary()];
    if (r) r.Edge = Number(e.target.value);
});
Find('#Caves').onchange = e => Panel.Modify(() => { Layer().Caves = e.target.checked; });
Find('#Radius').oninput = e => { Find('#RadiusRead').textContent = e.target.value; Draw2D(); };

// Undo / Redo / Open / Save / Sparse Export
Find('#HistoryUndo').onclick = () => {
    if (!History.length) return;
    Future.push(CaptureSnapshot());
    RestoreSnapshot(History.pop());
    Selection = null;
    Changed();
    Report('Undone.');
};
Find('#HistoryRedo').onclick = () => {
    if (!Future.length) return;
    History.push(CaptureSnapshot());
    RestoreSnapshot(Future.pop());
    Selection = null;
    Changed();
    Report('Redone.');
};

function DownloadJson(filename, data) {
    const url = URL.createObjectURL(new Blob([JSON.stringify(data)], { type: 'application/json' }));
    const a = document.createElement('a');
    a.href = url; a.download = filename; a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
}
Find('#Export').onclick = () => DownloadJson('LandscapeStudio.frontier.json', DocumentObj());
Find('#Import').onclick = () => Find('#File').click();
Find('#File').onchange = async e => {
    try {
        const f = e.target.files[0]; if (!f) return;
        const imported = ValidateDocument(JSON.parse(await f.text()));
        Remember();
        Layers = imported.Layers;
        SculptOps = [];
        Active = 0; SelectedLayers = new Set([0]);
        Panel.ResetSelection();
        Changed(); Fit(false);
        Report('Loaded FrontierLandscape/1 document.');
    } catch (err) { Report(`Open failed: ${err.message}`); }
    e.target.value = '';
};

Find('#PreviewBake').onclick = () => {
    const r = Layer().Regions[Panel.RetrieveBoundary()];
    if (!r) return;
    const res = SampleSparseBricks(Layer(), r, 64, 64);
    DownloadJson('Landscape.sparse64.json', res);
    Report(`Exported ${res.Bricks.length} occupied 8³ SDF bricks.`);
};

function ConfirmDialog(heading, msg, action) {
    const dlg = Find('#DocumentReplacement');
    Find('#ReplacementHeading').textContent = heading;
    Find('#ReplacementMessage').textContent = msg;
    Find('#ConfirmReplacement').textContent = action;
    dlg.returnValue = '';
    return new Promise(res => {
        dlg.addEventListener('close', () => res(dlg.returnValue === 'replace'), { once: true });
        dlg.showModal();
    });
}
Find('#LoadTerrainExamples').onclick = async () => {
    if (!await ConfirmDialog('Load 8 applied terrain examples?', 'Undo restores your current project.', 'Load examples')) return;
    Remember();
    Layers = CreateTerrainWorld(); SculptOps = [];
    Active = 0; SelectedLayers = new Set([0]);
    Find('#WorldPreset').value = 'examples';
    Changed(); SwitchWorkspace('landscape'); Fit(true);
};
Find('#Empty').onclick = async () => {
    if (!await ConfirmDialog('Start an empty world?', 'Undo restores your current project.', 'New world')) return;
    Remember();
    Layers = [CreateLayer(0)]; SculptOps = [];
    Active = 0; SelectedLayers = new Set([0]);
    Changed(); SwitchWorkspace('mask'); Fit(false);
};

// Keyboard Shortcuts
window.addEventListener('keydown', e => {
    if (Find('#DocumentReplacement').open) return;
    if (e.target.closest('input:not([type="checkbox"]),select,textarea')) return;
    if (e.code === 'Space') { SpaceDown = true; e.preventDefault(); }
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        Find(e.shiftKey ? '#HistoryRedo' : '#HistoryUndo').click();
        return;
    }
    if (e.key === '1') SwitchWorkspace('mask');
    if (e.key === '2') SwitchWorkspace('landscape');
    if (e.shiftKey && e.code === 'KeyA' && Workspace === 'landscape') { e.preventDefault(); Panel.OpenMenu(); return; }
    if (Workspace === 'mask') {
        const m = { b: 'paint', e: 'erase', r: 'select', h: 'pan' };
        if (m[e.key.toLowerCase()]) SelectTool2D(m[e.key.toLowerCase()]);
    } else {
        if (e.key.toLowerCase() === 'b') SelectTool3D(Tool3D === 'sculpt' ? 'orbit' : 'sculpt');
        if (e.key.toLowerCase() === 'h') SelectTool3D('pan');
        if (e.key === 'Escape') SelectTool3D('orbit');
    }
    if (e.key.toLowerCase() === 'f') Fit(!e.shiftKey);
    Keys.add(e.code);
});
window.addEventListener('keyup', e => { if (e.code === 'Space') SpaceDown = false; Keys.delete(e.code); });
window.addEventListener('blur', () => { SpaceDown = false; Keys.clear(); });

new ResizeObserver(() => Draw2D()).observe(Find('#Viewport'));

// ---------- Main Loop ----------

function Frame(nowMs) {
    const dt = Math.min(0.05, Math.max(0.001, (nowMs - LastFrameTime) * 0.001));
    LastFrameTime = nowMs;

    FpsAccum += dt; FpsFrames++;
    if (FpsAccum >= 0.5) {
        const res = Engine ? Engine.getResolution() : { nx: 512, nz: 512, ny: 256 };
        if (!Engine?.isBuilding()) {
            Find('#RenderReadout').textContent = `WebGL2 · ${res.nx}×${res.nz}×${res.ny} · ${Math.round(FpsFrames / FpsAccum)} FPS`;
        }
        FpsAccum = 0; FpsFrames = 0;
    }

    if (Workspace === 'landscape') {
        if (Find('#AnimateOcean').checked) OceanTime += dt;
        if (Find('#KeyboardCamera').checked && Keys.size > 0 && !document.activeElement?.closest('input:not([type="checkbox"]),select')) {
            const speed = Math.max(5, Math.min(2000, Number(Find('#CameraSpeed').value) || 180)) *
                          (Keys.has('ShiftLeft') || Keys.has('ShiftRight') ? 2.5 : 1.0) * dt;
            const fwd = [-Math.sin(Camera.Yaw), 0, -Math.cos(Camera.Yaw)];
            const right = [Math.cos(Camera.Yaw), 0, -Math.sin(Camera.Yaw)];
            if (Keys.has('KeyW')) { Camera.Target[0] += fwd[0] * speed; Camera.Target[2] += fwd[2] * speed; }
            if (Keys.has('KeyS')) { Camera.Target[0] -= fwd[0] * speed; Camera.Target[2] -= fwd[2] * speed; }
            if (Keys.has('KeyD')) { Camera.Target[0] += right[0] * speed; Camera.Target[2] += right[2] * speed; }
            if (Keys.has('KeyA')) { Camera.Target[0] -= right[0] * speed; Camera.Target[2] -= right[2] * speed; }
            if (Keys.has('KeyQ') || Keys.has('KeyE')) Camera.Target[1] += (Keys.has('KeyQ') ? 1 : -1) * speed;
        }
        Find('#CameraPosition').textContent = `TARGET X ${Camera.Target[0].toFixed(0)} · Y ${Camera.Target[1].toFixed(0)} · Z ${Camera.Target[2].toFixed(0)}`;
        Find('#ScaleRead').textContent = `${Camera.Orbit >= 120 ? Math.round(Camera.Orbit / 120) * 10 : (Camera.Orbit / 12).toFixed(1)} m`;

        Engine?.render({
            camera: Camera,
            timeSec: OceanTime,
            waveScale: Number(Find('#SwellSlider').value),
            clarity: Number(Find('#ClaritySlider').value),
            foamGain: Number(Find('#FoamSlider').value),
            sunDeg: Number(Find('#SunSlider').value),
            oceanOn: Find('#Ocean').checked
        });
    }
    requestAnimationFrame(Frame);
}

// ---------- Startup ----------
Refresh();
SelectTool2D('paint');
SelectTool3D('orbit');
ActivateInspector('shape');
Fit(false);
Rebuild3DSdf();
SwitchWorkspace('landscape');
requestAnimationFrame(Frame);
