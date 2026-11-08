# Frontier

## Level select

Open **`/`** (repo root) for the level-select hub. Each level is its own folder with its own
`index.html`; the hub is driven by **`levels.js`**, a plain manifest:

```js
{ id:'biolab', code:'C', name:'Overgrown Bio-Lab', status:'playable',
  href:'biolab/index.html', thumb:'biolab/docs/thumb.png', bestKey:'frontier_biolab_best' }
```

* `status:'playable'` → card is clickable, shows the saved best time + medal, and gets keyboard
  shortcuts (press `1`–`9` to jump straight in).
* `status:'planned'` → renders as a locked "reserved slot" card, so the roster doubles as a roadmap.
* Cards read the level's best time straight from `localStorage` (via `bestKey`), so adding a level
  needs no changes to the hub's code.
* Every level's pause and results screens link back to `../index.html` (`Esc` on the brief, `L` anywhere).

**To add a level:** create a folder next to `biolab/`, add one entry to `levels.js`, done.

## Playable levels

### 🌿 Level C — Overgrown Bio-Lab / Carnivorous Jungle Canopy (`biolab/`)

A playable 3D greybox ("shadow-box") level. Race the Pack Runner 1.44 km down a dead-straight
service causeway the jungle has reclaimed — Snapper Jaws bite your lane, **disguised blooms**
that look like harmless garden flowers snap at you instead, Vine Grabbers snare you dead (mash
to cut free, or burn through on boost), Spore Puffers choke the engine, Sap Pools glue you down,
**chemical slicks** kill your steering, Bramble Walls, cycling Blast Doors and **collapsed
islands that fork the road** block your way, and the Mother Maw sweeps the Heart Chamber with
living tentacles.

**Simplified pack-driving controls** — auto-drive is always on; you just:
`◀ ▶`/`A D` steer · `W` boost · `S` brake · `SPACE` cutter pulse · touch supported.

**Run it** (no build step, Three.js is vendored):

```bash
python3 -m http.server 8000
# open http://localhost:8000/  →  level select  →  Play Level C
```

Opening `biolab/index.html` directly still works; the brief screen's **LEVEL SELECT** chip
takes you back to the hub.

Full design breakdown — zone pacing, hazard specs, tuning notes and playtest questions — in
[`biolab/LEVEL_DESIGN.md`](biolab/LEVEL_DESIGN.md).
