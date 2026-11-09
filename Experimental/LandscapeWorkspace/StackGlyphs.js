/*==========================================================================================================================================
                                                              STACKGLYPHS.JS
==========================================================================================================================================*/
// Crisp inline SVG monochrome icons (zero external dependencies).

const GLYPH_SHAPES = {
    mountain: [
        ['path', { d: 'm8 3 4 8 5-5 5 15H2L8 3z' }]
    ],
    ridge: [
        ['path', { d: 'm8 3 4 8 5-5 5 15H2L8 3z' }],
        ['path', { d: 'M4.14 15.08c2.62-1.57 5.24-1.43 7.86.42 2.74 1.94 5.49 2 8.23.19' }]
    ],
    layers: [
        ['path', { d: 'm12.83 2.18a2 2 0 0 0-1.66 0L2.6 6.08a1 1 0 0 0 0 1.83l8.58 3.91a2 2 0 0 0 1.66 0l8.58-3.9a1 1 0 0 0 0-1.83Z' }],
        ['path', { d: 'm2 12 8.58 3.91a2 2 0 0 0 1.66 0L22 12' }],
        ['path', { d: 'm2 17 8.58 3.91a2 2 0 0 0 1.66 0L22 17' }]
    ],
    strata: [
        ['path', { d: 'm12.83 2.18a2 2 0 0 0-1.66 0L2.6 6.08a1 1 0 0 0 0 1.83l8.58 3.91a2 2 0 0 0 1.66 0l8.58-3.9a1 1 0 0 0 0-1.83Z' }],
        ['path', { d: 'm2 12 8.58 3.91a2 2 0 0 0 1.66 0L22 12' }],
        ['path', { d: 'm2 17 8.58 3.91a2 2 0 0 0 1.66 0L22 17' }]
    ],
    stacks: [
        ['rect', { width: '18', height: '18', x: '3', y: '3', rx: '2' }],
        ['path', { d: 'M9 3v18' }],
        ['path', { d: 'M15 3v18' }]
    ],
    cliff: [
        ['polyline', { points: '18 8 22 12 18 16' }],
        ['polyline', { points: '6 8 2 12 6 16' }],
        ['line', { x1: '2', x2: '22', y1: '12', y2: '12' }]
    ],
    cave: [
        ['path', { d: 'M22 17a10 10 0 0 0-20 0' }],
        ['path', { d: 'M6 17a6 6 0 0 1 12 0' }],
        ['path', { d: 'M10 17a2 2 0 0 1 4 0' }]
    ],
    sun: [
        ['circle', { cx: '12', cy: '12', r: '4' }],
        ['path', { d: 'M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41' }]
    ],
    lock: [
        ['rect', { width: '18', height: '11', x: '3', y: '11', rx: '2', ry: '2' }],
        ['path', { d: 'M7 11V7a5 5 0 0 1 10 0v4' }]
    ],
    eye: [
        ['path', { d: 'M2.062 12.348a1 1 0 0 1 0-.696 10.75 10.75 0 0 1 19.876 0 1 1 0 0 1 0 .696 10.75 10.75 0 0 1-19.876 0' }],
        ['circle', { cx: '12', cy: '12', r: '3' }]
    ],
    'eye-off': [
        ['path', { d: 'M10.733 5.076a10.744 10.744 0 0 1 11.205 6.575 1 1 0 0 1 0 .696 10.747 10.747 0 0 1-1.444 2.49' }],
        ['path', { d: 'M14.084 14.158a3 3 0 0 1-4.242-4.242' }],
        ['path', { d: 'M17.479 17.499a10.75 10.75 0 0 1-15.417-5.151 1 1 0 0 1 0-.696 10.75 10.75 0 0 1 4.446-5.143' }],
        ['path', { d: 'm2 2 20 20' }]
    ],
    mask: [
        ['circle', { cx: '12', cy: '12', r: '10' }],
        ['path', { d: 'M12 18a6 6 0 0 0 0-12v12z' }]
    ],
    check: [
        ['path', { d: 'M20 6 9 17l-5-5' }]
    ],
    wind: [
        ['path', { d: 'M12.8 19.6A2 2 0 1 0 14 16H2' }],
        ['path', { d: 'M17.5 8a2.5 2.5 0 1 1 2 4H2' }],
        ['path', { d: 'M9.8 4.4A2 2 0 1 1 11 8H2' }]
    ],
    search: [
        ['circle', { cx: '11', cy: '11', r: '8' }],
        ['path', { d: 'm21 21-4.3-4.3' }]
    ],
    plus: [
        ['path', { d: 'M5 12h14M12 5v14' }]
    ],
    close: [
        ['path', { d: 'M18 6 6 18M6 6l12 12' }]
    ],
    undo: [
        ['path', { d: 'M9 14 4 9l5-5' }],
        ['path', { d: 'M4 9h10.5a5.5 5.5 0 0 1 5.5 5.5a5.5 5.5 0 0 1-5.5 5.5H11' }]
    ],
    redo: [
        ['path', { d: 'm15 14 5-5-5-5' }],
        ['path', { d: 'M20 9H9.5A5.5 5.5 0 0 0 4 14.5A5.5 5.5 0 0 0 9.5 20H13' }]
    ],
    download: [
        ['path', { d: 'M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4' }],
        ['polyline', { points: '7 10 12 15 17 10' }],
        ['line', { x1: '12', x2: '12', y1: '15', y2: '3' }]
    ],
    focus: [
        ['circle', { cx: '12', cy: '12', r: '3' }],
        ['path', { d: 'M3 7V5a2 2 0 0 1 2-2h2M17 3h2a2 2 0 0 1 2 2v2M21 17v2a2 2 0 0 1-2 2h-2M7 21H5a2 2 0 0 1-2-2v-2' }]
    ],
    box: [
        ['path', { d: 'M21 8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16Z' }],
        ['path', { d: 'm3.3 7 8.7 5 8.7-5' }],
        ['path', { d: 'M12 22V12' }]
    ],
    brush: [
        ['path', { d: 'm9.06 11.9 8.07-8.06a2.85 2.85 0 1 1 4.03 4.03l-8.06 8.08' }],
        ['path', { d: 'M7.07 14.94c-1.66 0-3 1.35-3 3.02 0 1.33-2.5 1.52-2 2.02 1.08 1.1 2.49 2.02 4 2.02 2.2 0 4-1.8 4-4.04a3.01 3.01 0 0 0-3-3.02z' }]
    ],
    eraser: [
        ['path', { d: 'm7 21-4.3-4.3c-1-1-1-2.5 0-3.4l9.6-9.6c1-1 2.5-1 3.4 0l5.6 5.6c1 1 1 2.5 0 3.4L13 21' }],
        ['path', { d: 'M22 21H7' }],
        ['path', { d: 'm5 11 9 9' }]
    ],
    select: [
        ['path', { d: 'M5 3a2 2 0 0 0-2 2M19 3a2 2 0 0 1 2 2M21 19a2 2 0 0 1-2 2M5 21a2 2 0 0 1-2-2M9 3h1M9 21h1M14 3h1M14 21h1M3 9v1M21 9v1M3 14v1M21 14v1' }]
    ],
    hand: [
        ['path', { d: 'M18 11V6a2 2 0 0 0-2-2a2 2 0 0 0-2 2' }],
        ['path', { d: 'M14 10V4a2 2 0 0 0-2-2a2 2 0 0 0-2 2v2' }],
        ['path', { d: 'M10 10.5V6a2 2 0 0 0-2-2a2 2 0 0 0-2 2v8' }],
        ['path', { d: 'M18 8a2 2 0 1 1 4 0v6a8 8 0 0 1-8 8h-2c-2.8 0-4.5-.86-5.99-2.34l-3.6-3.6a2 2 0 0 1 2.83-2.82L7 15' }]
    ],
    orbit: [
        ['circle', { cx: '12', cy: '12', r: '3' }],
        ['ellipse', { cx: '12', cy: '12', rx: '10', ry: '4', transform: 'rotate(-28 12 12)' }],
        ['ellipse', { cx: '12', cy: '12', rx: '10', ry: '4', transform: 'rotate(28 12 12)' }]
    ],
    waves: [
        ['path', { d: 'M2 6c.6.5 1.2 1 2.5 1C7 7 7 5 9.5 5c2.6 0 2.4 2 5 2 2.5 0 2.5-2 5-2 1.3 0 1.9.5 2.5 1' }],
        ['path', { d: 'M2 12c.6.5 1.2 1 2.5 1 2.5 0 2.5-2 5-2 2.6 0 2.4 2 5 2 2.5 0 2.5-2 5-2 1.3 0 1.9.5 2.5 1' }],
        ['path', { d: 'M2 18c.6.5 1.2 1 2.5 1 2.5 0 2.5-2 5-2 2.6 0 2.4 2 5 2 2.5 0 2.5-2 5-2 1.3 0 1.9.5 2.5 1' }]
    ],
    'chevron-right': [['path', { d: 'm9 18 6-6-6-6' }]],
    'arrow-right': [['path', { d: 'M5 12h14M12 5l7 7-7 7' }]],
    'arrow-up-right': [['path', { d: 'M7 7h10v10M7 17 17 7' }]],
    'arrow-up': [['path', { d: 'm5 12 7-7 7 7M12 19V5' }]],
    'arrow-down': [['path', { d: 'M12 5v14m7-7-7 7-7-7' }]],
    copy: [
        ['rect', { width: '14', height: '14', x: '8', y: '8', rx: '2', ry: '2' }],
        ['path', { d: 'M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2' }]
    ],
    trash: [
        ['path', { d: 'M3 6h18' }],
        ['path', { d: 'M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6' }],
        ['path', { d: 'M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2' }]
    ],
    reset: [
        ['path', { d: 'M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8' }],
        ['path', { d: 'M3 3v5h5' }]
    ],
    sliders: [
        ['line', { x1: '21', x2: '14', y1: '4', y2: '4' }],
        ['line', { x1: '10', x2: '3', y1: '4', y2: '4' }],
        ['line', { x1: '21', x2: '12', y1: '12', y2: '12' }],
        ['line', { x1: '8', x2: '3', y1: '12', y2: '12' }],
        ['line', { x1: '21', x2: '16', y1: '20', y2: '20' }],
        ['line', { x1: '12', x2: '3', y1: '20', y2: '20' }],
        ['line', { x1: '14', x2: '14', y1: '2', y2: '6' }],
        ['line', { x1: '8', x2: '8', y1: '10', y2: '14' }],
        ['line', { x1: '16', x2: '16', y1: '18', y2: '22' }]
    ]
};

export function StackGlyph(Token) {
    const SVG = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    for (const [Name, Setting] of Object.entries({
        viewBox: '0 0 24 24', width: 18, height: 18, fill: 'none', stroke: 'currentColor',
        'stroke-width': 1.5, 'stroke-linecap': 'round', 'stroke-linejoin': 'round', 'aria-hidden': 'true'
    })) SVG.setAttribute(Name, Setting);
    for (const [Tag, Attributes] of (GLYPH_SHAPES[Token] || GLYPH_SHAPES.mountain)) {
        const Shape = document.createElementNS('http://www.w3.org/2000/svg', Tag);
        for (const [Name, Setting] of Object.entries(Attributes)) Shape.setAttribute(Name, Setting);
        SVG.append(Shape);
    }
    return SVG;
}

export function StackAppearance(Type) {
    if (Type === 'environment') return { Glyph: 'waves', Color: '#b7b7b7' };
    if (Type === 'foundation') return { Glyph: 'layers', Color: '#a0a0a0' };
    if (Type === 'tunnel' || Type === 'arch') return { Glyph: 'cave', Color: '#b7b7b7' };
    if (Type === 'stacks') return { Glyph: 'stacks', Color: '#b7b7b7' };
    if (Type === 'strata') return { Glyph: 'strata', Color: '#b7b7b7' };
    if (Type === 'fault') return { Glyph: 'cliff', Color: '#b7b7b7' };
    if (Type === 'sand-dunes' || Type === 'dunes') return { Glyph: 'wind', Color: '#b7b7b7' };
    return { Glyph: ['ridges', 'ridge-noise', 'fractal-ridges', 'ridged-multifractal'].includes(Type) ? 'ridge' : 'mountain', Color: '#b7b7b7' };
}

export function InitializeGlyphs(Root = document) {
    Root.querySelectorAll('[data-glyph]').forEach(Caption => Caption.replaceChildren(StackGlyph(Caption.dataset.glyph)));
}
