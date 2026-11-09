/*==========================================================================================================================================
                                                            LAYERSTACKPANEL.JS
==========================================================================================================================================*/
// Generator stack list, generator catalogue modal, radial influence radar, and landform property inspector.

import { StackGlyph, StackAppearance } from './StackGlyphs.js';
import {
    LandformCatalogue, CreateLandform, TerrainGeneratorCodes, TerrainInfluenceDefaults,
    InvalidateLandforms, ValidateDocument
} from './DomainModel.js';

const VolumeTypes = new Set(['tunnel', 'arch', 'craters', 'stacks', 'strata']);

const GeneratorDescriptions = {
    'ridges': 'Sharp mountain spines & subsidiary spurs',
    'mesa': 'Flat-topped sandstone plateaus',
    'fault': 'Uplifted escarpment & dip slope',
    'dunes': 'Wind-swept asymmetric aeolian crests',
    'craters': 'Excavated circular impact basins',
    'fractal': 'Continuous volumetric fBm terrain',
    'multifractal': 'Heterogeneous eroded alpine terrain',
    'ridged-multifractal': 'Sharp tectonic crest networks',
    'badlands': 'Deeply gullied terrace canyons',
    'ridge-noise': 'Single-octave continuous ridge web',
    'fractal-ridges': 'Multi-scale rocky spur ridges',
    'sand-dunes': 'Flow-warped undulating sand ridges',
    'stacks': 'Overhanging hoodoos & coastal stacks',
    'strata': 'Stepped sedimentary rock ledges',
    'tunnel': 'Subsurface caves & eroded sea tunnels',
    'arch': 'Standing volumetric stone sea arch'
};

function ProfileSVG(Type) {
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', '0 0 46 28');
    const paths = {
        ridges: 'M2 24 L13 7 L20 15 L31 4 L44 24',
        mesa: 'M2 24 L9 24 L13 8 L33 8 L37 24 L44 24',
        fault: 'M2 24 L16 6 L19 11 L44 22',
        dunes: 'M2 24 Q14 9 23 19 T44 20',
        craters: 'M2 14 L13 14 Q23 26 33 14 L44 14',
        tunnel: 'M2 24 L8 8 L38 8 L44 24 M15 24 Q23 11 31 24',
        arch: 'M4 24 Q12 4 23 4 T42 24 M15 24 Q23 11 31 24',
        stacks: 'M4 24 L11 24 L13 10 L9 6 L20 6 L16 10 L18 24 L27 24 L29 14 L25 9 L36 9 L32 14 L34 24 L42 24',
        strata: 'M2 24 L8 24 L8 18 L15 18 L15 12 L22 12 L22 6 L34 6 L34 15 L40 15 L40 24 L44 24'
    };
    const p = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    p.setAttribute('d', paths[Type] || 'M2 22 Q11 6 19 15 T36 10 L44 22');
    svg.append(p);
    return svg;
}

export function InitializeLayerStackPanel(API) {
    const Find = Selector => document.querySelector(Selector);
    const BoundarySelection = new Map();
    const ScopeSelection = new Map();
    const OperationSelection = new Map();
    let Category = 'landform';
    let Dragged = null;
    let BatchAddition = false;
    let MenuInitiator = '#AddGenerator';

    const RetrieveLayer = () => API.RetrieveLayers()[API.RetrieveActive()];
    const RetrieveBoundary = () => Math.min(BoundarySelection.get(API.RetrieveActive()) || 0, Math.max(0, RetrieveLayer().Regions.length - 1));
    const RetrieveScope = () => {
        const S = ScopeSelection.get(API.RetrieveActive()) ?? -1;
        return S >= RetrieveLayer().Regions.length ? -1 : S;
    };
    const ScopeToken = () => `${API.RetrieveActive()}:${RetrieveScope()}`;
    const RetrieveOwner = () => RetrieveScope() < 0 ? RetrieveLayer() : RetrieveLayer().Regions[RetrieveScope()];
    const RetrieveOperations = () => RetrieveOwner().Landforms || [];
    const RetrieveOperation = () => Math.min(OperationSelection.get(ScopeToken()) ?? RetrieveOperations().length - 1, RetrieveOperations().length - 1);
    const OperationTitle = Operation => Operation.Name || LandformCatalogue.find(E => E.Type === Operation.Type)?.Name || Operation.Type;
    const ScopeCaption = () => `${RetrieveLayer().Name}${RetrieveScope() < 0 ? ' · Entire mask' : ` · Region ${RetrieveScope() + 1}`}`;

    function Caption(tag, className = '', text = '') {
        const el = document.createElement(tag);
        if (className) el.className = className;
        if (text) el.textContent = text;
        return el;
    }

    function ActionButton(label, title, glyph, onClick, cls = 'icon-button') {
        const btn = Caption('button', cls);
        btn.title = title;
        btn.setAttribute('aria-label', title);
        if (glyph) btn.append(StackGlyph(glyph));
        if (label) btn.append(document.createTextNode(label));
        btn.onclick = onClick;
        return btn;
    }

    function Modify(Mutation, GeometryChanged = true) {
        const Original = structuredClone(API.RetrieveLayers());
        try {
            Mutation();
            ValidateDocument({ Format: 'FrontierLandscape/1', Layers: API.RetrieveLayers() });
        } catch (Failure) {
            API.ReplaceLayers(Original);
            InvalidateLandforms();
            API.Report(Failure.message);
            API.Refresh();
            return false;
        }
        const Edited = structuredClone(API.RetrieveLayers());
        if (JSON.stringify(Original) === JSON.stringify(Edited)) return true;
        API.ReplaceLayers(Original);
        API.Remember();
        API.ReplaceLayers(Edited);
        API.Changed(GeometryChanged);
        return true;
    }

    function SelectOperation(Index) {
        OperationSelection.set(ScopeToken(), Index);
        API.ActivateInspector('shape');
        API.Refresh();
    }

    function ModifyOperation(Index, Property, Setting) {
        return Modify(() => { RetrieveOwner().Landforms[Index][Property] = Setting; });
    }

    function Reorder(From, To) {
        if (To < 0 || To >= RetrieveOperations().length) return;
        if (Modify(() => {
            const Operations = RetrieveOwner().Landforms;
            const [Op] = Operations.splice(From, 1);
            Operations.splice(To, 0, Op);
        })) SelectOperation(To);
    }

    function AddGenerator(Type, Batch = false) {
        const Targets = Batch ? [...API.RetrieveSelected()].map(Index => API.RetrieveLayers()[Index]) : [RetrieveOwner()];
        if (!Targets.length) return;
        const Applied = Modify(() => {
            for (const Target of Targets) {
                Target.Landforms ||= [];
                Target.Landforms.push({ ...CreateLandform(Type), Blend: 8, Seed: 4029 + Target.Landforms.length * 149 });
            }
        });
        if (!Applied) return;
        if (Batch) ScopeSelection.set(API.RetrieveActive(), -1);
        CloseMenu();
        SelectOperation(RetrieveOperations().length - 1);
        API.Report(`${LandformCatalogue.find(E => E.Type === Type).Name} added to ${Batch ? `${Targets.length} selected masks` : ScopeCaption()}.`);
    }

    function RenderRows() {
        const Container = Find('#LandformRows');
        Container.replaceChildren();
        const Operations = RetrieveOperations();
        const Query = Find('#LayerSearch').value.trim().toLowerCase();
        Find('#OperationCount').textContent = Operations.length;
        Find('#StackOwner').textContent = RetrieveLayer().Name;
        Find('#StackOwnerColour').style.background = RetrieveLayer().Color;
        Find('#BatchLandform').hidden = API.RetrieveSelected().size < 2;
        Find('#BatchLandform').textContent = `Add to ${API.RetrieveSelected().size} selected masks…`;
        const Scope = Find('#StackScope');
        Scope.replaceChildren(new Option('Entire mask', '-1'));
        RetrieveLayer().Regions.forEach((_, Index) => Scope.add(new Option(`Region ${String(Index + 1).padStart(2, '0')} only`, String(Index))));
        Scope.value = String(RetrieveScope());

        for (let Index = Operations.length - 1; Index >= -1; Index--) {
            const Op = Operations[Index];
            const Title = Op ? OperationTitle(Op) : RetrieveScope() < 0 ? 'Sea-level foundation' : 'Inherited mask stack';
            if (Query && !`${Title} ${Op?.Type || ''}`.toLowerCase().includes(Query)) continue;
            const Row = Caption('div', `landform-row ${Index === RetrieveOperation() ? 'selected' : ''} ${Op && !Op.Enabled ? 'muted' : ''} ${Op ? '' : 'foundation'}`);
            Row.tabIndex = 0;
            Row.dataset.operationIndex = Index;
            Row.setAttribute('role', 'option');
            Row.setAttribute('aria-selected', String(Index === RetrieveOperation()));
            const Icon = Caption('span', 'landform-icon');
            Icon.append(StackGlyph(Op ? StackAppearance(Op.Type).Glyph : 'layers'));
            const Copy = Caption('span', 'landform-copy');
            Copy.append(
                Caption('strong', '', Title),
                Caption('small', '', Op ? `${Index + 1} / ${Op.Mode === 'union' ? 'Union' : Op.Mode} · ${Op.Amount} m relief` : RetrieveScope() < 0 ? 'Y = 0 m · base SDF slab' : `${(RetrieveLayer().Landforms || []).length} ops · evaluated first`)
            );
            Row.append(Icon, Copy);
            if (Op) {
                const Eye = ActionButton('', Op.Enabled ? 'Mute generator' : 'Enable generator', Op.Enabled ? 'eye' : 'eye-off', e => {
                    e.stopPropagation();
                    ModifyOperation(Index, 'Enabled', !Op.Enabled);
                });
                Row.append(Eye);
                Row.draggable = true;
                Row.ondragstart = e => {
                    Dragged = { Token: ScopeToken(), Index };
                    e.dataTransfer.setData('text/plain', String(Index));
                    e.dataTransfer.effectAllowed = 'move';
                    Row.classList.add('dragging');
                };
                Row.ondragover = e => {
                    if (Dragged?.Token !== ScopeToken()) return;
                    e.preventDefault();
                    Row.classList.add('drop-target');
                };
                Row.ondragleave = () => Row.classList.remove('drop-target');
                Row.ondrop = e => {
                    e.preventDefault();
                    if (Dragged?.Token === ScopeToken()) Reorder(Dragged.Index, Index);
                    Dragged = null;
                };
                Row.ondragend = () => {
                    Dragged = null;
                    document.querySelectorAll('.dragging,.drop-target').forEach(el => el.classList.remove('dragging', 'drop-target'));
                };
            } else {
                Row.append(StackGlyph('lock'));
            }
            Row.onclick = () => SelectOperation(Index);
            Container.append(Row);
        }
        if (!Operations.length && !Query) Container.prepend(Caption('p', 'empty-stack', 'Flat SDF foundation at sea level. Add a generator to add cliffs, arches, or ridges.'));
    }

    function RenderChoices() {
        const Query = Find('#GeneratorSearch').value.trim().toLowerCase();
        const Container = Find('#GeneratorChoices');
        Container.replaceChildren();
        for (const Entry of LandformCatalogue) {
            if (!GeneratorDescriptions[Entry.Type]) continue;
            if (VolumeTypes.has(Entry.Type) !== (Category === 'volume')) continue;
            if (Query && !`${Entry.Name} ${GeneratorDescriptions[Entry.Type]}`.toLowerCase().includes(Query)) continue;
            const Choice = ActionButton('', `Apply ${Entry.Name}`, '', () => AddGenerator(Entry.Type, BatchAddition), 'generator-choice');
            Choice.dataset.generator = Entry.Type;
            const Preview = Caption('span', 'generator-profile');
            Preview.append(ProfileSVG(Entry.Type));
            const Copy = Caption('span', 'generator-choice-copy');
            Copy.append(Caption('strong', '', Entry.Name), Caption('small', '', GeneratorDescriptions[Entry.Type]));
            Choice.append(Preview, Copy, StackGlyph('plus'));
            Container.append(Choice);
        }
        if (!Container.children.length) Container.append(Caption('p', 'empty-stack', 'No matching generators.'));
    }

    function OpenMenu(Batch = false) {
        BatchAddition = Batch === true;
        MenuInitiator = BatchAddition ? '#BatchLandform' : '#AddGenerator';
        Find('#GeneratorTarget').textContent = BatchAddition ? `${API.RetrieveSelected().size} selected masks` : ScopeCaption();
        Find('#GeneratorMenuCaption').textContent = BatchAddition ? 'ADD TO SELECTED STACKS' : 'ADD TO ACTIVE STACK';
        Find('#GeneratorMenu').hidden = false;
        Find(MenuInitiator).setAttribute('aria-expanded', 'true');
        RenderChoices();
        Find('#GeneratorSearch').focus();
    }

    function CloseMenu() {
        Find('#GeneratorMenu').hidden = true;
        Find('#AddGenerator').setAttribute('aria-expanded', 'false');
        Find('#BatchLandform').setAttribute('aria-expanded', 'false');
    }

    function NumericControl(Container, Index, Op, Property, Label, Min, Max, Step = 1, Units = '') {
        const Group = Caption('div', 'control-group');
        const Heading = Caption('label', 'field-caption', Label);
        const Readout = Caption('output', '', `${Op[Property]}${Units}`);
        const Input = Caption('input');
        Input.type = 'range'; Input.min = Min; Input.max = Max; Input.step = Step; Input.value = Op[Property];
        Input.style.setProperty('--progress', `${(Op[Property] - Min) / (Max - Min) * 100}%`);
        Heading.append(Readout);
        Input.oninput = () => {
            Readout.textContent = `${Input.value}${Units}`;
            Input.style.setProperty('--progress', `${(Input.value - Min) / (Max - Min) * 100}%`);
        };
        Input.onchange = () => ModifyOperation(Index, Property, Number(Input.value));
        Group.append(Heading, Input);
        Container.append(Group);
    }

    function InfluencePreview(Op, Index) {
        const Settings = { ...TerrainInfluenceDefaults, ...Op };
        const SVG = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        SVG.setAttribute('viewBox', '0 0 220 140');
        SVG.classList.add('influence-preview');
        const X = 110 + Settings.InfluenceX * 82, Z = 70 + Settings.InfluenceZ * 52;
        const Radius = Settings.InfluenceRadius * 54;
        SVG.innerHTML = `<defs><radialGradient id="InfluenceGrad"><stop offset="${Math.max(0, (1 - Settings.InfluenceFalloff) * 100)}%" stop-color="#c8c8c8" stop-opacity="${Settings.Influence * 0.35}"/><stop offset="100%" stop-color="#c8c8c8" stop-opacity="0"/></radialGradient></defs>
            <path class="guide" d="M0 35H220M0 70H220M0 105H220M55 0V140M110 0V140M165 0V140"/>
            <rect x="28" y="18" width="164" height="104" fill="none" stroke="#606060" stroke-width=".5" stroke-dasharray="3 3"/>
            <circle cx="${X}" cy="${Z}" r="${Radius}" fill="url(#InfluenceGrad)"/>
            <circle class="contour" opacity=".22" cx="${X}" cy="${Z}" r="${Radius}"/>
            <circle class="contour" opacity=".32" cx="${X}" cy="${Z}" r="${Radius * 0.62}"/>
            <path stroke="#bdbdbd" stroke-width=".6" d="M${X - 7} ${Z}h14M${X} ${Z - 7}v14"/>
            <circle class="centre" cx="${X}" cy="${Z}" r="2.8"/><text x="33" y="116">MASK REGION</text>`;
        let Centre = null;
        SVG.onpointerdown = e => { SVG.setPointerCapture(e.pointerId); SVG.onpointermove(e); };
        SVG.onpointermove = e => {
            if (!SVG.hasPointerCapture(e.pointerId)) return;
            const b = SVG.getBoundingClientRect();
            Centre = [
                Math.max(-1, Math.min(1, ((e.clientX - b.left) / b.width * 220 - 110) / 82)),
                Math.max(-1, Math.min(1, ((e.clientY - b.top) / b.height * 140 - 70) / 52))
            ];
            SVG.querySelector('.centre').setAttribute('cx', 110 + Centre[0] * 82);
            SVG.querySelector('.centre').setAttribute('cy', 70 + Centre[1] * 52);
        };
        SVG.onpointerup = () => {
            if (!Centre) return;
            Modify(() => {
                RetrieveOwner().Landforms[Index].InfluenceX = Math.round(Centre[0] * 100) / 100;
                RetrieveOwner().Landforms[Index].InfluenceZ = Math.round(Centre[1] * 100) / 100;
            });
        };
        return SVG;
    }

    function RenderInspector() {
        const Index = RetrieveOperation(), Op = RetrieveOperations()[Index];
        const MaskWorkspace = API.RetrieveWorkspace() === 'mask';
        const Ocean = API.RetrieveInspector() === 'ocean';
        const Type = Ocean ? 'environment' : MaskWorkspace ? 'mask' : Op?.Type || 'foundation';

        Find('#LayerTitle').textContent = RetrieveLayer().Name;
        Find('#ActiveMaskColour').style.background = RetrieveLayer().Color;
        Find('#StackIdentityGlyph').replaceChildren(StackGlyph(MaskWorkspace ? 'mask' : StackAppearance(Type).Glyph));
        Find('#InspectorEyebrow').textContent = Ocean ? 'WORLD ENVIRONMENT' : MaskWorkspace ? 'VECTOR MASK' : Op ? 'SDF TERRAIN GENERATOR' : 'SEA-LEVEL FOUNDATION';
        Find('#OperationName').value = Ocean ? 'Open water' : MaskWorkspace ? RetrieveLayer().Name : Op ? OperationTitle(Op) : 'Flat foundation';
        Find('#OperationName').disabled = Ocean || (!MaskWorkspace && !Op);
        Find('#OperationName').onchange = e => {
            const Name = e.target.value.trim();
            if (!Name) { API.Refresh(); return; }
            if (MaskWorkspace) Modify(() => { RetrieveLayer().Name = Name; });
            else ModifyOperation(Index, 'Name', Name);
        };
        Find('#OperationSubtitle').textContent = Ocean
            ? 'Seamless analytic water plane at sea level Y = 0'
            : MaskWorkspace
                ? `${RetrieveLayer().Strokes.length} vector strokes · resolution independent`
                : RetrieveScope() < 0 ? 'Evaluated into per-layer 3D SDF' : `Region ${RetrieveScope() + 1} scoped SDF`;
        Find('#InspectorScope').textContent = Ocean ? 'World environment' : MaskWorkspace ? 'Active mask' : 'Active SDF layer';

        const Container = Find('#OperationInspector');
        Container.replaceChildren();
        if (!Op) {
            const Card = Caption('section', 'property-card');
            Card.append(Caption('h3', '', RetrieveScope() < 0 ? 'Flat SDF foundation' : 'Region-scoped modifiers'));
            const Metric = Caption('div', 'metric', '0');
            Metric.append(Caption('small', '', 'm'));
            Card.append(Metric, Caption('p', 'card-note', 'Sea-level SDF base slab. Add a generator to build cliffs, arches, mesas, or ridges.'));
            Card.append(ActionButton('Add generator', 'Add terrain generator', 'plus', () => OpenMenu(false), 'border-button full-width'));
            Container.append(Card);
            return;
        }

        const Card = Caption('section', 'property-card');
        const Heading = Caption('h3', '', 'Relief & character');
        Heading.prepend(StackGlyph(StackAppearance(Op.Type).Glyph));
        const Enabled = Caption('label', 'switch');
        const Toggle = Caption('input');
        Toggle.type = 'checkbox'; Toggle.checked = Op.Enabled;
        Toggle.onchange = () => ModifyOperation(Index, 'Enabled', Toggle.checked);
        Enabled.append(Toggle, Caption('span'));
        Heading.append(Enabled);

        const Metric = Caption('div', 'metric');
        const Amp = Caption('input');
        Amp.type = 'number'; Amp.min = 1; Amp.max = 500; Amp.value = Op.Amount;
        Amp.onchange = () => ModifyOperation(Index, 'Amount', Number(Amp.value));
        Metric.append(Amp, Caption('small', '', 'm'));
        Card.append(Heading, Metric, Caption('p', 'muted', 'Relief above sea level'));

        NumericControl(Card, Index, Op, 'Amount', 'Amplitude', 1, 500, 1, ' m');
        NumericControl(Card, Index, Op, 'Scale', 'Frequency', 0.5, 5, 0.05);
        NumericControl(Card, Index, Op, 'Sharpness', 'Roughness', 0, 1, 0.01);
        NumericControl(Card, Index, Op, 'Azimuth', 'Azimuth', -180, 180, 1, '°');
        Container.append(Card);

        if (TerrainGeneratorCodes[Op.Type] !== undefined) {
            const InfCard = Caption('section', 'property-card');
            InfCard.append(Caption('h3', '', 'Spatial influence'), InfluencePreview(Op, Index));
            const Cap = Caption('p', 'influence-caption', 'Radial falloff');
            Cap.append(Caption('span', '', 'Drag to position'));
            InfCard.append(Cap);
            const Settings = { ...TerrainInfluenceDefaults, ...Op };
            NumericControl(InfCard, Index, Settings, 'Influence', 'Strength', 0, 1, 0.01);
            NumericControl(InfCard, Index, Settings, 'InfluenceRadius', 'Radius', 0.05, 2, 0.01);
            NumericControl(InfCard, Index, Settings, 'InfluenceFalloff', 'Falloff', 0.05, 1, 0.01);
            NumericControl(InfCard, Index, Settings, 'InfluenceX', 'Centre X', -1, 1, 0.01);
            NumericControl(InfCard, Index, Settings, 'InfluenceZ', 'Centre Z', -1, 1, 0.01);
            Container.append(InfCard);
        }

        const Comb = Caption('section', 'property-card');
        Comb.append(Caption('h3', '', 'CSG stack combination'));
        const CombRow = Caption('label', 'field-row', 'Combine');
        const Mode = Caption('select');
        for (const [Token, Text] of [['union', 'Maximum · union'], ['subtract', 'Carve · subtract'], ['intersect', 'Minimum · intersect'], ['blend', 'Average · blend']])
            Mode.add(new Option(Text, Token));
        Mode.value = Op.Mode;
        Mode.onchange = () => ModifyOperation(Index, 'Mode', Mode.value);
        CombRow.append(Mode);
        Comb.append(CombRow);
        NumericControl(Comb, Index, Op, 'Blend', 'Smooth CSG width', 0, 100, 1, ' m');

        const SeedRow = Caption('label', 'field-row', 'Seed');
        const Seed = Caption('input');
        Seed.type = 'number'; Seed.min = 0; Seed.max = 1000000; Seed.value = Op.Seed;
        Seed.onchange = () => ModifyOperation(Index, 'Seed', Number(Seed.value));
        SeedRow.append(Seed, ActionButton('', 'Randomize seed', 'reset', () => ModifyOperation(Index, 'Seed', (Op.Seed + 7919) % 1000001)));
        Comb.append(SeedRow);

        const Actions = Caption('div', 'operation-actions');
        const Up = ActionButton('', 'Move up', 'arrow-up', () => Reorder(Index, Index + 1));
        const Down = ActionButton('', 'Move down', 'arrow-down', () => Reorder(Index, Index - 1));
        Up.disabled = Index === RetrieveOperations().length - 1;
        Down.disabled = Index === 0;
        const Dup = ActionButton('Duplicate', 'Duplicate generator', 'copy', () => {
            if (Modify(() => {
                const copy = structuredClone(RetrieveOwner().Landforms[Index]);
                copy.Name = `${OperationTitle(copy).slice(0, 88)} copy`;
                RetrieveOwner().Landforms.splice(Index + 1, 0, copy);
            })) SelectOperation(Index + 1);
        }, 'quiet-button');
        const Del = ActionButton('Delete', 'Delete generator', 'trash', () => {
            if (Modify(() => RetrieveOwner().Landforms.splice(Index, 1))) SelectOperation(Math.max(-1, Index - 1));
        }, 'quiet-button danger');
        Actions.append(Up, Down, Dup, Del);
        Comb.append(Actions);
        Container.append(Comb);
    }

    Find('#AddGenerator').onclick = () => OpenMenu(false);
    Find('#CloseGeneratorMenu').onclick = () => { CloseMenu(); Find(MenuInitiator).focus(); };
    Find('#LayerSearch').oninput = RenderRows;
    Find('#GeneratorSearch').oninput = RenderChoices;
    Find('#BatchLandform').onclick = () => OpenMenu(true);
    Find('#StackScope').onchange = e => { ScopeSelection.set(API.RetrieveActive(), Number(e.target.value)); API.Refresh(); };
    document.querySelectorAll('[data-generator-category]').forEach(btn => {
        btn.onclick = () => {
            Category = btn.dataset.generatorCategory;
            document.querySelectorAll('[data-generator-category]').forEach(b => b.classList.toggle('active', b === btn));
            RenderChoices();
        };
    });

    return {
        Render() { RenderRows(); RenderInspector(); },
        Modify,
        OpenMenu,
        CloseMenu,
        RetrieveSelection: () => ({ boundary: RetrieveBoundary(), scope: RetrieveScope() }),
        RestoreSelection: s => { if (s) { BoundarySelection.set(API.RetrieveActive(), s.boundary || 0); ScopeSelection.set(API.RetrieveActive(), s.scope ?? -1); } },
        RetrieveBoundary,
        SelectBoundary: idx => { BoundarySelection.set(API.RetrieveActive(), idx); API.Refresh(); },
        ResetBoundary: () => BoundarySelection.set(API.RetrieveActive(), 0),
        ResetSelection: () => OperationSelection.clear()
    };
}
