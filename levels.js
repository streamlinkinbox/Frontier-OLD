/* ============================================================================
   FRONTIER · LEVEL ROSTER
   ----------------------------------------------------------------------------
   One entry per level. To add a level:
     1. drop its folder next to `biolab/` (e.g. `saltflats/index.html`)
     2. add an entry below with status:'playable' and its `href`
     3. optional: `thumb` relative to the repo root, `bestKey` for saved times
   Levels with status:'planned' render as locked slots — the roster is also the
   roadmap, so /index.html is the single place the game grows from.
   ========================================================================== */
window.FRONTIER_LEVELS = [
  {
    id: 'biolab',
    code: 'C',
    name: 'Overgrown Bio-Lab',
    sub: 'Carnivorous Jungle Canopy',
    status: 'playable',
    href: 'biolab/index.html',
    thumb: 'biolab/docs/thumb.png',   // clean HUD-free still
    accent: '#37e08b',
    tagline: 'The lab grew teeth.',
    blurb: 'Race the Pack Runner down a dead-straight service causeway the jungle has reclaimed. ' +
           'Snapper jaws, vine grabbers, spore vents, chemical slicks, blast doors — and flowers ' +
           'that look harmless until one bites.',
    hazards: ['SNAPPER JAW', 'MIMIC BLOOM', 'VINE GRABBER', 'SPORE PUFFER', 'SAP POOL', 'CHEM SLICK', 'BLAST DOOR', 'MOTHER MAW'],
    facts: [
      ['TRACK', '1.44 km · point-to-point'],
      ['ZONES', '6'],
      ['VEHICLE', 'Pack Runner (auto-drive)'],
      ['CONTROLS', 'steer · boost · brake · cut'],
    ],
    bestKey: 'frontier_biolab_best',   // localStorage key written by the level
    medals: { gold: 80, silver: 105 }, // seconds
    version: 'GREYBOX v2',
  },
  {
    id: 'slot-d',
    code: 'D',
    name: 'Open Slot',
    sub: 'Next level — unassigned',
    status: 'planned',
    accent: '#1f5eff',
    tagline: 'The causeway continues.',
    blurb: 'Reserved card. Build a level in its own folder, add one entry to levels.js, and it ' +
           'appears here automatically — same roster, same HUD, same scoring.',
    facts: [['STATUS', 'not built'], ['SETUP', 'folder + 1 manifest entry']],
  },
  {
    id: 'slot-e',
    code: 'E',
    name: 'Open Slot',
    sub: 'Future level — unassigned',
    status: 'planned',
    accent: '#1f5eff',
    tagline: 'Plenty of jungle left.',
    blurb: 'Another reserved card. Slots are unlimited — the hub lays them out in a grid and ' +
           'keeps the newest playable level first.',
    facts: [['STATUS', 'not built']],
  },
];
