# Phase 4 - Highlands: Implementation Spec

Status: draft, 2026-11-08 (agent/p004-plan, waiting for Pavel's review). Refines `000_spec.md` for Phase 4. Built on `campaign-phase-4` (branched from the finished `campaign-phase-3`). Task branches are `agent/t3NN-...` (T01 -> `t301`).

Built the way Phase 3 was built (Pavel, 2026-10-31): **visual form first** (the Wyrm and the new region are checked on a phone before the systems that use them), **new regions follow Prague's landscape** on real LiDAR terrain with easy-to-guess fantasy names, and every feature is playable on a touch phone first.

## 1. Goal

The young dragon grows up and loses its mother. A Drake that has eaten enough rests at the nest and wakes as a **Wyrm**: bigger, with new horns and a spine crest, slower to turn and hungrier. The next time it flies out, the mother flies ahead to hunt and the Order brings her down with ballista bolts while the Wyrm watches: Act 2 ends and **Act 3 - Wyrmfire** begins. The Wyrm flies into the **Highland Pass**, a new region on the real terrain south-west of Prague (the Barrandov cliffs over the river, the Prokop gorge, the railway viaducts), where the Order's gold trains cross a viaduct to the cliff fortress **Maidenhold** under the escort of **mounted knights**. Outposts get **net launchers** that pin a dragon to the ground, and a Wyrm can finally **breach stone walls**. **Renown** starts counting: how the dragon treats villages decides whether they send tribute or ring the bell.

The phase starts with the visual block (the Wyrm and its stage looks in a preview page, the Highland Pass terrain; checked by Pavel on a phone), then the new enemies (knights, nets), breaching, Renown, the mother's death scene, and last the Act 3 missions that use all of it.

**Exit criteria**

- On a phone, a Wyrm intercepts a gold train in the Highland Pass, stops it on or near the viaduct, takes the chest and survives the knight escort; it banks the chest in the pass aerie or the lair.
- Renown changes how villages treat the dragon: at low Renown peasants ring the bell from farther and freed villages stop their tribute; at high Renown peasants do not ring the bell at a dragon that does not attack, and freed villages send more food.
- The mother's death scene plays once, the first time a new Wyrm leaves the cave; it can be skipped, the Act 3 card follows, the place where she fell is marked on the map, and she never appears again.
- The four stages read apart on a phone at a glance (not only by size): the Wyrm has a spine crest and more horns than the Drake.
- The Highland Pass reads as the Barrandov cliffs over the Veltava from the air and on the map: the river on the east side, the cliff wall over it, the gorge cutting west, the viaducts across the gorge.
- A net from a net launcher pins a dragon for up to 3 s; Fire burns the net off, tapping Boost shortens it.
- A Wyrm can breach a wall segment of Maidenhold or Vyshgard (breath on stone plus a ram); the breach is a walkable gap until it is rebuilt.
- Two Act 3 missions (intercept the gold train, breach Maidenhold and steal the Scale-Crown) can each be completed in 5-10 minutes by a careful Wyrm.
- A save (v4) survives a reload, and a v3 save migrates without loss.

### In scope

| Area | Phase 4 content |
| --- | --- |
| Growth | Wyrm stage (index 2): stats, stage-up at the nest, carry class 3 (cattle, knight), camera and flight scaled for the bigger body; growth cap moves to the Elder threshold (Elder itself is Phase 6) |
| Stage visuals | Per-stage parts on the shared dragon model: horn count and length, a spine crest from Wyrm, wing span and membrane colour shift, darker scales with age; dragon preview page with a stage switch |
| New region | Highland Pass: real terrain from the same LiDAR tile (section 4.2): the Barrand Cliffs over the Veltava, the Prokop Gorge cutting west, the Hlubowick viaducts across the gorge, the Maidenhold promontory, the Chuchel meadows in the south, Branick on the east bank; entered from the Farmlands (west edge) and the Veltava Bend (south edge); late Drake |
| Settlements | Maidenhold, the Order's cliff fortress (second castle from the kit, no courtyard landing: a chain net over the yard), the toll fort at the viaduct, Chuchel village (freeable), Jinonice hamlet, the Zlichov rock chapel (civil) |
| Knights | Mounted knights: ride out of castle and fortress stables when an alarm lasts, escort gold trains; chase on the ground, lance hits on a landed or low-flying dragon; a Wyrm can grab one and drop it |
| Nets | Net launcher defender on outposts and forts: a net that grounds the dragon for up to 3 s |
| Breaching | Wyrm breath wears stone and a Boost ram hits walls hard; a breached segment is a walkable gap with rubble until rebuilt |
| Caravans | Free-roam gold trains in the pass on a schedule (wagons, knight escort, over the viaduct to Maidenhold); the Order supply wagon (food) from `000_spec.md` section 4 |
| Renown | `core/renown.js`: starts from the saved history (civilians burned, livestock taken, Order burned, villages freed), changes with events, three tiers; villagers, tribute and freeing follow it |
| Freeing | More freeable places: Holeshwick (the Bend) and Chuchel (the pass), with Renown deciding whether tribute comes |
| Story | The mother's death scene (in-engine, skippable, with a preview page first), end of Act 2, Act 3 card, "Where she fell" place, Act 3 briefings and outcomes |
| Missions | Intercept the gold train (Wyrm, Act 3); breach Maidenhold and steal the Scale-Crown (Wyrm, Act 3) |
| Upgrades | Three Wyrm upgrades: Roar (breaks a net, stuns knights and peasants nearby), Iron scales II, Siege horns (ram damage) |
| Save | v4 with renown, the mother's fate, Wyrm stage, breaches, the pass's places and caravan schedule; v3 -> v4 migration |
| UI | Renown on the HUD (small badge) and in the message log, net struggle prompt, Roar in the Action slot, knights and gold trains on the compass, the pass on the map |

### Out of scope (later phases)

Elder stage, ground slam, frost mages, mangonels, named slayers, alert 4-5 and hunting parties, lair defense and lava vents (Phase 5), the stolen dragon eggs and the rest of Act 3 (Phase 5), the Capital, the Grand Slayer and Act 4 (Phase 6), towns with walls (Staromark stays ruins), boats on the river, hunt / rescue / defend / boss mission types, co-op.

## 2. Constraints from the current code

| Fact | Consequence for Phase 4 |
| --- | --- |
| `data.stages` has hatchling and drake; `growthCap: { food: 2399, growth: 0.54 }` stops food XP below the Wyrm threshold (`core/growth.js`) | Add the wyrm stage (`foodFrom 2400, growthFrom 0.55`) and move the cap to `{ food: 4799, growth: 0.84 }` (the Elder threshold, Phase 6); stage-up still only at the nest |
| `shared/dragon.js` builds one model (GREEN / CRIMSON palettes) shared with the duel and co-op (`mp/`) | Stage parts are an option of the builder (`buildDragon({ stage })`); without it the model is unchanged, so `mp/sim.test.js` and the duel look stay as they are (`dragon-model.test.js` checks both) |
| The dragon's camera distance, landing pad and solids test scale with `growth.scaleOf` | A Wyrm (2.5-3.4x) needs the camera pulled back, a wider landing check and a courtyard / wall walk check: the Vyshgard courtyard must still take a Wyrm (test); Maidenhold's yard is refused on purpose (chain net) |
| `data.mother` + `core/mother.js` phases lead / show / praise / away / visit / escort | A new `fallen` state: after the death scene `cs.story.motherFell` is set and `mother.step` does nothing; her visit, lessons and escort never start again |
| `core/story.js` act(cs) -> 1 \| 2 from the stage | Act 3 starts when the death scene ends (not at stage-up), so a Wyrm that has not left the cave yet is still in Act 2 |
| `core/caravan.js` spawns one mission caravan on a road (`data.caravan.tithe`), escort = archers | Generalised: caravan kinds (`tithe`, `gold`, `supply`), free-roam schedule per region, escort kinds (archers or knights); the tithe mission keeps working (`caravan.test.js`) |
| Defenders: peasant, archer, ballista (`core/defenders.js`), posts tied to building types and castle post lists | New types `knight` (mobile, mounted, its own movement on terrain and roads) and `netter` (a post like the ballista: aim, fire a slow net); both use perception and alert like the others |
| `data.alert.maxLevel` 3 and responses 1-3 | Knights join as a response (`knights: true` from level 2 where the region has stables) and as the "village calls knights if the alarm lasts > 60 s" rule of `000_spec.md` section 5; alert 4-5 stays Phase 5 |
| Stone pieces (`stone: true`) never become non-solid; walls and bastions have no wood and never burn (Phase 3 T06) | Stone gets `stoneHp` that only a Wyrm can wear down; at 0 a wall segment becomes `breach` (its middle third non-solid, walk top cut, rubble), bastions and towers stay unbreakable in this phase |
| `stats.civilBurned / orderBurned / livestockTaken` are saved since Phase 2 for future Renown (`core/state.js`, `save.js`), `renown: 0` is a placeholder in the save | Renown starts from these counts on the first load (v3 -> v4) and from then on is its own number |
| `core/freed.js`: `data.freed.places` = ['farm.village'], tribute every 300 s | More places; tribute amount and whether it comes at all follow the Renown tier |
| Regions on real terrain: `terrain.dem` + `water: 'mask'`, baked by `tools/terrain/bake.py` from the committed crop of tile N50E014 | The pass is a second region from the same tile: a new `tools/terrain/regions/pass.json`, a new crop (`crop.py` needs the raw tile, `fetch_sources.py` downloads it from the Git LFS copy in `sources.json`), `campaign/core/dem-pass.js` |
| `bridge` overlay: a deck over the river at the terrain height | New `kind: 'viaduct'`: a deck high over a dry valley (`deckH` above the valley floor) on tall arches, walkable and landable, the road runs on it; caravans follow its deck |
| `data.map.world.pass` [-1, 2.6], `later.pass` { stage: 1 }, `links` [['pass', 'farm']] | The pass becomes a real region (removed from `later`); links pass-farm and pass-bend; the gate is a late Drake (`minGrowth: 0.45`) |
| Touch layout: Breath, Boost, Roll fixed; Action and Move context slots | Roar goes into the Action slot when it applies (netted, or a knight within range and nothing to grab); the net struggle uses Boost taps; no new fixed buttons |
| Save v3 (`core/save.js`, `migrate` chain) | v4 adds `renown`, `story.motherFell`, `regions.<id>.breaches`, `world.caravans`; v3 -> v4 step |
| Headless browser renders at 2-8 fps in software | Visual tasks end with screenshots from fixed views plus a phone check by Pavel (feel checkpoints T02, T03 and T11) |

## 3. File structure

New files (existing ones extended where noted):

```
campaign/
  preview/
    dragon.html         stage preview: the four stages side by side or one at a time, orbit / touch drag + pinch,
                        wing flap, breath, palette, quality tier, triangle readout
    mother-fall.html    standalone preview of the mother's death scene (camera rail, bolts, fall), like the hatching preview
  core/
    dem-pass.js         GENERATED by tools/terrain/bake.py pass (heights, river mask, river line)
    knights.js          mounted knights: spawn from stables, ride, chase, lance, grab / drop, return
    nets.js             net launcher shots, entangle state on the dragon, struggle, burn-off
    breach.js           stone hp on wall segments, breath wear, ram, breach state, rebuild
    renown.js           renown value, start from history, events, tiers, effects lookup
    fall.js             the mother's death scene: trigger, script timeline (pure), Act 3 handover
    (data.js, growth.js, terrain.js, castle.js, settlement.js, defenders.js, caravan.js, alert.js, freed.js, mother.js,
     story.js, missions.js, relics.js, upgrades.js, nav.js, map.js, region.js, state.js, save.js, tips.js extended)
  render/
    knight-view.js      horse + rider + lance, instanced, gallop cycle, dropped knight ragdoll-lite
    net-view.js         flying net (weighted corners), net on the dragon, burning net
    viaduct-view.js     tall stone arches and deck (instanced)
    breach-view.js      rubble heap and broken wall ends at a breach
    fall-scene.js       the in-engine death scene (camera rail over the live region, bolt tracers, her fall)
    (shared/dragon.js: stage parts; castle-view.js: Maidenhold, chain net over the yard; caravan-view.js: gold wagons)
tools/terrain/
  regions/pass.json     region config (crop, projection, river, names)
  sources/pass_dtm.png  committed crop + pass_dtm.json bounds
ai_sdlc/001_campaign/img/
  pass-terrain.png      preview image
campaign/test/
  wyrm.test.js  stages.test.js  pass.test.js  maidenhold.test.js  knights.test.js  nets.test.js  breach.test.js
  renown.test.js  fall.test.js  save4.test.js  goldtrain-bot.js  breach-bot.js  (mission.bot.test.js extended)
```

Script order in `campaign/index.html`: Phase 3 order with `renown` after `alert`, `knights` and `nets` after `defenders`, `breach` after `castle`, `fall` after `mother`, `dem-pass` next to `dem-bend`.

## 4. Data schemas (`core/data.js`)

All numbers are starting values for tuning (T17). `version` becomes 4.

### 4.1 Wyrm and stage visuals

```js
stages: [
  // hatchling, drake as now
  { id: 'wyrm', foodFrom: 2400, growthFrom: 0.55, scaleFrom: 2.5, scaleTo: 3.4,
    hp: 450, turn: 0.65, cruise: 34, boost: 58, hungerMult: 1.4, spot: 2.3, carry: 3,
    breach: true },                                    // only a Wyrm (and later an Elder) wears stone
],
growthCap: { food: 4799, growth: 0.84 },               // the Elder (growthFrom 0.85) comes in Phase 6
stageLook: {                                           // shared/dragon.js buildDragon({ stage })
  hatchling: { horns: 2, hornLen: 0.6, crest: 0,  span: 1.0,  tint: 1.00 },
  drake:     { horns: 2, hornLen: 1.0, crest: 0,  span: 1.05, tint: 0.95 },
  wyrm:      { horns: 4, hornLen: 1.4, crest: 9,  span: 1.12, tint: 0.85, jaw: 'spikes' },
  elder:     { horns: 6, hornLen: 1.8, crest: 14, span: 1.2,  tint: 0.75, jaw: 'spikes', frills: true },  // shown in the preview only
},
camera: { scaleDist: 0.7 },                            // camera distance grows with scale ^ scaleDist
```

`000_spec.md` gives the Wyrm `hungerMult 2.2`; Phase 2 had to cut the Drake from 1.5 to 1.1 so missions stay possible, so the Wyrm starts at 1.4 and T17 tunes it with the mission bots.

### 4.2 Highland Pass (real terrain, south-west of Prague)

The terrain is **real**: the left bank of the Vltava from Zlíchov south to Velká Chuchle, the Barrandov cliffs (Barrandovské skály) falling about 100 m to the river, the Prokop valley (Prokopské údolí) and the Dalejské valley cutting west through limestone, the Hlubočepy railway viaducts ("Prague Semmering") across the gorge, the promontory of Dívčí hrady (an old hillfort, the Maidens' war legend) over the mouth of the gorge, the church on the Zlíchov rock. Same tile as the Bend (N50E014), so no new source licence. Proposed projection around 14.385 E, 50.030 N at 3.6 m per unit, radius 1200, grid 241 x 241 every 10 units, crop 14.32-14.45 E, 49.99-50.07 N; `exag` 2.0 (more than the Bend's 1.6: this is the "highland", and the cliffs must read on a phone). The river is traced like the Bend's (south edge at Chuchle -> north edge at Zlíchov) and runs along the east side of the region.

| Game name (EN) | CS | Real place | Role |
| --- | --- | --- | --- |
| Highland Pass (region) | Horský průsmyk | Barrandov - Prokop valley | region |
| Barrand Cliffs | Barrandské skály | Barrandovské skály | cliff wall over the river, the region's landmark |
| Prokop Gorge | Prokopova soutěska | Prokopské údolí | the pass: a gorge cutting west, the gold road runs through it |
| Hlubowick viaducts | Hlubočínské viadukty | Hlubočepské viadukty | two tall stone viaducts across the gorge; the gold road crosses the big one |
| Maidenhold | Dívčín | Dívčí hrady | the Order's cliff fortress on the promontory over the gorge mouth and the river |
| Zlichov rock chapel | kaple na Zlíchovské skále | kostel sv. Filipa a Jakuba, Zlíchov | civil chapel on a rock at the north edge (burning it costs Renown) |
| Chuchel | Chuchel | Velká Chuchle | village on the meadows in the south (freeable) |
| Jinonice | Jinonice | Jinonice | hamlet at the west end of the gorge, where the gold road enters |
| Branick | Braník | Braník | hamlet on the east bank, across the river |

Region data (coordinates are placeholders until T03 bakes the terrain and picks the real spots; the PR updates them):

```js
regions.pass: {
  nameKey: 'c.region.pass', radius: 1200, seed: 71, ceiling: 380, palette: 'pass',
  minGrowth: 0.45,                                      // late Drake (000_spec.md 7: "Drake (late)")
  terrain: {
    dem: 'demPass', exag: 2.0, offset: 4, water: 'mask',
    features: [
      { type: 'plateau', at: 'maidenhold', r: 90, edge: 20, level: 'top' },
      { type: 'cliff',   at: 'maidenhold', r: 90, face: '<toward the river>', drop: 14, width: 70 },
      { type: 'plateau', at: 'tollfort', r: 30 }, { type: 'plateau', at: 'chuchel', r: 60 },
      { type: 'plateau', at: 'jinonice', r: 34 }, { type: 'plateau', at: 'branick', r: 30 },
      { type: 'road', width: 8, points: '<west edge -> Jinonice -> along the gorge floor -> big viaduct -> Maidenhold gate>' },
      { type: 'road', width: 7, points: '<Maidenhold -> south along the cliff top -> Chuchel>' },
      { type: 'bridge', kind: 'viaduct', at: 'hlubowick1', yaw: '<across the gorge>', len: 150, width: 9, deckH: 30, arches: 9 },
      { type: 'bridge', kind: 'viaduct', at: 'hlubowick2', len: 90,  width: 7, deckH: 22, arches: 6, road: false },
    ],
  },
  flora: { trees: 650, rocks: 160, fields: 8 },
  herds: [{ type: 'deer', count: 2, ring: [500, 1150] }, { type: 'boar', count: 2, ring: [600, 1150] },
          { type: 'goat', count: 2, ring: [300, 900], on: 'steep' }],   // goats on the cliffs
  settlements: [
    { type: 'fortress', at: 'maidenhold', name: 'maidenhold' },
    { type: 'tollfort', at: 'tollfort',   name: 'tollfort' },             // beside the big viaduct, nets + archers
    { type: 'village',  at: 'chuchel',    name: 'chuchel' },
    { type: 'hamlet',   at: 'jinonice',   name: 'jinonice' },
    { type: 'hamlet',   at: 'branick',    name: 'branick' },
    { type: 'chapelRock', at: 'zlichov',  name: 'zlichov' },
  ],
  exits: [{ to: 'farm', angleFrom: '<west arc>' }, { to: 'bend', angleFrom: '<north arc>', minStage: 1 }],
},
regions.farm.exits += [{ to: 'pass', angleFrom: '<west arc>', minStage: 1 }],   // + minGrowth 0.45 from the region
regions.bend.exits += [{ to: 'pass', angleFrom: '<south-west arc>', minStage: 1 }],
aeries.pass = { at: '<a cleft in the Barrand Cliffs>', facing: '<the river>' },
map.world.pass = [-1, 2.6]; map.links += [['pass', 'bend']]; delete map.later.pass,
```

Palette `pass`: limestone white-grey on steep faces (more rock than the Bend: slope threshold lower), dry steppe grass on the cliff tops (the real Barrandov slopes are steppe reserves), dark beech forest in the gorge, meadows at Chuchel, slate blue water.

### 4.3 Maidenhold and the pass settlements

```js
buildings: {
  // Phase 3 castle pieces reused; new:
  netter:    { r: 4, h: 7,  hp: 120, order: true, post: 'netter' },          // a net launcher platform (wood)
  tollhouse: { r: 6, h: 8,  hp: 140, order: true, loot: ['tithe'] },
  chain:     { r: 0, h: 0,  hp: 0, net: true },                              // the chain net over Maidenhold's yard
  rockchapel:{ r: 5, h: 10, hp: 120, civil: true, stone: true, woodHp: 60, spires: 1, spireH: 22 },
},
settlements: {
  fortress: {                                         // Maidenhold: smaller and taller than Vyshgard, cliff on two sides
    walls: '<6-7 corner polygon following the promontory edge>',
    corners: '<bastion, ctower, gatehouse x2, bastion, ctower>',
    buildings: [['keep', ...], ['chapel', ...], ['hall', ...], ['stables', ...], ['netter', ...]],
    yardNet: true,                                    // landing in the yard refused ('net') until a wall segment is breached
    archers: 8, netters: 2, knights: 4, peasants: 0,
  },
  tollfort:  { ring: true, buildings: [['tollhouse', 0, 0], ['ctower', 14, 6], ['netter', -12, 8], ['stables', -6, -14]],
               archers: 3, netters: 1, knights: 2 },
  chapelRock:{ buildings: [['rockchapel', 0, 0]], peasants: 2 },
},
castle: { /* as Phase 3 */ yardNet: { h: 'walkTop + 4', color: 0x3a3a3a } },
```

Stables: Vyshgard's existing stables get `knights: 3`; Maidenhold 4, the toll fort 2. A stable that burns to a ruin sends no more knights until it is rebuilt.

### 4.4 Knights, nets, breaching

```js
defenders: {
  // peasant, archer, ballista as now
  knight: { hp: 45, speed: 16, gallop: 24, turn: 2.2, sight: 160, fov: 2.4, lance: { range: 7, damage: 18, cooldown: 2.5,
            maxAlt: 9 },                               // hits only a landed dragon or one flying lower than maxAlt above the ground
            arrowProof: true, fireDamage: 0.6, size: 3, dropKill: 12,   // size 3: a Wyrm can grab one; dropped from 12+ = dead
            callAfter: 60, max: 8, returnAfter: 40 },   // a settlement alarm lasting callAfter s calls the nearest stables
  netter: { hp: 18, sight: 150, fov: 1.4, range: 95, aimTime: 1.5, speed: 70, reload: 10, crew: 1 },
},
nets: { pin: 3.0, fall: 0.6, burn: 1.0, struggleTap: 0.3, immune: 2.0, speedMult: 0 },
  // pin: s held; fall: x gravity while netted in the air (glides down, no climb); burn: s of Fire to burn it off;
  // struggleTap: s taken off per Boost tap; immune: s without a new net after one ends
breach: { stoneHp: 300, breathRate: 0.25, ram: { minSpeed: 45, damage: 120, selfDamage: 10, cooldown: 3 },
          gap: 0.34, rebuild: 2 },                     // gap = middle third of the segment; rebuild = x fire.rebuild
```

### 4.5 Caravans

```js
caravan: {
  tithe: { /* Phase 3 mission wagon, unchanged */ },
  gold:   { region: 'pass', road: 0, from: 0.0, to: 1.0, speed: 6, wagons: 2, escort: { knight: 3, archer: 2 },
            chest: 'goldchest', wagonHp: 140, every: 600, firstAfter: 120 },   // free roam: one train every `every` s of play
  supply: { region: 'farm', road: 0, speed: 7, wagons: 1, escort: { archer: 2 }, food: 60, every: 420 },  // Order supply wagon: food
},
loot: { goldchest: { size: 3, gold: 300, carry: { speedMult: 0.75, breath: false } } },   // size 3: Wyrm only
```

A free-roam gold train that reaches Maidenhold is just gone (no fail); a stopped one drops its chest; burning or robbing it raises the pass's heat like a raid and gives Renown (Order target).

### 4.6 Renown

```js
renown: {
  min: -100, max: 100,
  start: { civilBurned: -3, livestockTaken: -2, orderBurned: 1, freed: 10, clampTo: [-50, 50] },  // first value from the saved history
  add: { civilBurned: -3, livestockTaken: -2, peasantKilled: -4, orderBurned: 1, knightKilled: 2, defenderKilled: 0.5,
         freed: 10, caravanRobbed: 3, missionSuccess: 5, chapelBurned: -8 },
  tiers: { hostile: -20, friendly: 20 },               // below hostile / above friendly; between = wary
  effects: {
    hostile:  { tribute: 0,   bellSight: 1.3, callAfter: 0.5 },       // no tribute, peasants see and ring from farther, knights come sooner
    wary:     { tribute: 1,   bellSight: 1.0, callAfter: 1.0 },       // as in Phase 3
    friendly: { tribute: 1.5, bellSight: 0.7, calmPeasants: true },   // more food; peasants do not ring at a dragon that has not attacked
  },
},
freed: { places: ['farm.village', 'bend.holeshwick', 'pass.chuchel'] },
```

Wary is today's behaviour, so a player who never cared about Renown keeps Phase 3's game.

### 4.7 The mother's fall, missions, relics, upgrades

```js
fall: {
  trigger: 'firstLeaveAsWyrm',                         // the first time a Wyrm leaves the cave (not at stage-up: the player sees it outside)
  where: { region: 'ash', toward: 'farm' },            // she flies off toward the Farmlands; the scene plays over the live region
  battery: { ballistae: 3, at: '<Ash Wastes / Farmlands edge, behind a ridge>' },
  length: 40, skippable: true, marker: 'motherFell',   // a cairn of scorched bolts where she fell, a map place "Where she fell"
},
story: { acts: [1, 2, 3], cards: ['act1', 'act2', 'act3'], act3: 'fall' },
missions: [
  { id: 'a3_goldtrain', type: 'intercept', act: 3, minStage: 2, region: 'pass', caravan: 'gold', time: 540,
    reward: { gold: 400 } },
  { id: 'a3_crown', type: 'steal', act: 3, minStage: 2, region: 'pass', target: 'pass.maidenhold.keep1',
    relic: 'scale_crown', breach: true, time: 600, reward: { gold: 350 } },   // the yard net means: breach a wall, walk in
],
relics: { scale_crown: { nameKey: 'c.relic.crown', weight: 2, trophy: 2 } },   // trophy niche 2
upgrades: {
  roar:        { cost: 600, minStage: 2, effect: { roar: { range: 40, stun: 3, cooldown: 20, breaksNet: true } } },
  iron_scales2:{ cost: 700, minStage: 2, needs: 'iron_scales', effect: { arrowDamage: 0.7, lanceDamage: 0.75 } },
  siege_horns: { cost: 500, minStage: 2, effect: { ramDamage: 1.5, ramSelf: 0.5 } },
},
```

## 5. System interfaces (`core/`)

### 5.1 `growth` and the Wyrm

- `growth.stageFor(foodXp)` and `scaleOf` work with three stages; `growthCap` keeps food XP under the Elder line.
- Stage-up to Wyrm at the nest plays the existing growth animation; the Act 3 card does **not** come here (it follows the death scene).
- `walk.canLand` and the courtyard checks use the Wyrm's pad; test: a Wyrm can land in the Vyshgard courtyard and on a wall walk, and is refused in Maidenhold's yard with 'net'.
- The camera distance follows `scale ^ camera.scaleDist`; flight turn and carry come from the stage row.

### 5.2 `buildDragon({ stage, palette })` (shared/dragon.js)

- Adds horns (`horns`, `hornLen`), a crest of `crest` spine plates along the neck and back, wing span x `span`, body colours x `tint`, jaw spikes; parts merge into the existing meshes (no extra draw calls per dragon beyond one crest mesh).
- Without `stage` the model is exactly the Phase 3 / duel model (test compares vertex counts).
- The campaign dragon rebuilds its model on stage-up (one rebuild, old geometry disposed).

### 5.3 `knights`

- `knights.call(cs, region, from, why)`: the nearest stables with knights left sends up to `knights` riders toward the alarm (or the caravan they escort). Called by a settlement alarm lasting `callAfter` s (x the Renown tier's `callAfter`), by alert level 2+ where the region has stables, and by caravans (escort).
- `knights.step(cs, dt)`: ride along roads where they can, else across walkable ground (`walk.maxSlope`), around solids; chase the dragon's ground point; lance when in `range` and the dragon is landed or lower than `maxAlt` over the ground; lose interest after `returnAfter` s without sight and ride home.
- Arrows of the Order do not hurt knights; breath does (`fireDamage` x); a Wyrm's grab lifts one (size 3), a drop from `dropKill` or higher kills it ('knight:killed').
- Full AI within 400 units, 4 Hz beyond; at most `max` per region.

### 5.4 `nets`

- `netter` posts aim like a ballista (`aimTime`, telegraphed with a short line) and fire a slow net (projectile with weighted corners); a hit sets `cs.dragon.netted = { t }`.
- Netted: no flight thrust, glide down at `fall` x gravity, no takeoff on the ground, breath still works; Fire for `burn` s (breath on oneself: the net is on the dragon) frees it, each Boost tap takes `struggleTap` s off, Roar (upgrade) frees at once; after the net, `immune` s.
- Touch: Boost is the struggle button, no new button; a pulsing prompt says "Tap Boost to break free - Fire burns the net" (desktop names the keys). With Roar owned, the Action slot shows Roar while netted.

### 5.5 `breach`

- Wall segments (not bastions, towers, gatehouses or the keep) get `stoneHp`. Breath of a dragon with `breach: true` wears it at `breathRate` x the building burn rate; a ram (flying into a wall segment at `minSpeed` or more with Boost) deals `ram.damage` and costs the dragon `selfDamage`.
- At 0 the segment becomes `breached`: the middle `gap` of the capsule is no longer a solid, its walk top is cut, rubble scenery appears ('wall:breached' event, alert heat as `orderBurned` x2). A breached segment of a `yardNet` castle opens the yard to walking in (the net stays: landing in the yard is still refused, walking in through the breach works).
- Rebuild after `breach.rebuild` x `fire.rebuild` of play, blocked while a mission holds it (like the destroy mission's workshop, `missions.holds`).

### 5.6 `caravan` (generalised)

- `caravan.kinds` from data; `caravan.schedule(cs, region, dt)` spawns free-roam trains every `every` s of play once the dragon is in their region (they wait for the dragon like the Phase 3 wagon, so a player can find them).
- Escort entries spawn archers (walking) and knights (riding); the knights use `knights.step` with the wagon as home.
- Stop and chest rules as Phase 3; the supply wagon drops food (a carcass) instead of a chest.

### 5.7 `renown`

- `renown.init(cs)`: on a save without `renown` (v3 migration) compute the start from `stats` and freed places, clamp to `start.clampTo`.
- `renown.on(cs, event)`: maps game events to `add`; emits 'renown:tier' when the tier changes (message + log line).
- `renown.tier(cs)` -> 'hostile' | 'wary' | 'friendly'; `renown.effect(cs, key)` for the other systems (freed tribute, perception bell sight, knights call time, peasant calm).
- Only villages and hamlets react to Renown; Order settlements always fight.

### 5.8 `fall` (the mother's death scene)

- `fall.ready(cs)`: Wyrm, mother alive, leaving the cave (`lair:leave`), not during a mission.
- `fall.timeline(t)` -> pure keyframes (her path, the battery's bolt times and targets, the camera rail, the caption lines) so tests can check order and length; `render/fall-scene.js` plays it over the live Ash Wastes with the game's own models, the world paused, input off except Skip.
- End (or Skip): `cs.story.motherFell = { at, region, x, z }`, the cairn and map place appear, `story.act` becomes 3, the Act 3 card shows, `mother.step` stops for good, autosave.
- Story texts: two or three of her last lines before the scene (she says she will hunt alone today), no line from her after it; the Act 3 card says why the dragon now hates the Order. Both sides keep their own truth (`000_spec.md` section 2): the Order's men at the battery speak one line too.

### 5.9 `save` v4

```json
{
  "version": 4,
  "renown": 14,
  "story": { "act": 3, "seen": ["act1", "act2", "act3"], "motherFell": { "region": "ash", "x": 420, "z": 610 } },
  "regions": { "pass": { "aerieFound": true, "explored": "<base64>", "breaches": ["maidenhold.w3"] },
               "bend": { "freed": ["bend.holeshwick"] } },
  "world": { "caravans": { "pass.gold": 212, "farm.supply": 40 } }
}
```

v3 -> v4: `renown` from `renown.init`, `motherFell` null, no breaches, caravan clocks at `firstAfter`. A saved Wyrm cannot exist in v3 (the cap kept food XP below it), so no stage migration is needed.

## 6. Rendering and UI

| Element | Implementation |
| --- | --- |
| Stage looks | Horns, crest plates, jaw spikes as merged low-poly parts in the shared model; colour tint per stage; the preview page shows all four stages side by side at true scale and one at a time up close |
| Wyrm camera | Pulled back with scale; the HUD and compass unchanged |
| Highland Pass | White limestone faces with darker strata bands on the cliffs (slope-based), steppe grass on top, beech forest in the gorge; two viaducts with tall arches (instanced, under 4 draw calls); the river along the east edge |
| Maidenhold | Castle kit pieces on the promontory; chain net over the yard (one transparent mesh with a chain-link texture drawn in a canvas); night torches as in Phase 3 |
| Knights | Horse + rider + lance + Order red shield, one instanced mesh per part, a 4-frame gallop by vertex offsets; a grabbed knight hangs from the claws; under 4 draw calls for all knights |
| Nets | A net is a 6 x 6 line grid with weighted corners while flying, then draped over the dragon (follows its bounding box); burning: flame pool sprites; a ring around the screen edge while netted |
| Breach | Rubble heap (instanced stones) and two broken wall ends; dust burst on the breaking hit |
| Gold train | Two wagons with iron-bound chests, a gold marker on the compass and a ring on the map while it is on the road |
| Renown | Small badge next to the hoard counter (tier icon: torch for hostile, eye for wary, wheat for friendly), number in the message log panel; a message when the tier changes |
| Death scene | Letterbox bars, captions at the bottom (EN / CS), Skip button top right (36 px+), 30-45 s; afterwards the cairn: a heap of scorched bolts and one green scale |
| Roar | Action slot label "Roar" with an icon when it applies; a ring wave and a camera shake |

## 7. Task breakdown

Each task ends with both test runs passing and the browser check from the agent prompt. Visual tasks also save screenshots from the fixed views named in the row. Sizes: S < 2 h, M 2-5 h, L 5-10 h of AI-assisted work. Tasks with no dependency between them can run in parallel stacks (T01, T02, T03, T06 and T09 have none).

| ID | Task | Depends on | Size | Acceptance |
| --- | --- | --- | --- | --- |
| T01 | Wyrm stage: `data.stages` wyrm row, `growthCap` to the Elder line, stage-up at the nest, carry class 3, camera distance by scale, landing pad and courtyard checks for the bigger body; debug "grow to Wyrm" button | - | M | Tests (`wyrm.test.js`): food XP 2400 qualifies for Wyrm, stage-up only at the nest, a Wyrm can land in the Vyshgard courtyard and on a wall walk, carry 3 lifts a cow, the Phase 1-3 bots still pass; on a phone the Wyrm flies and lands without the camera clipping the terrain |
| T02 | Stage visuals + `campaign/preview/dragon.html`: `buildDragon({ stage })` horns, crest, span, tint, jaw spikes for the four stages (Elder in the preview only); the campaign dragon rebuilds on stage-up | - | M | **Feel checkpoint for Pavel on a phone** (the stages read apart at a glance). Preview at 390 x 844 with no page errors; without `stage` the model is unchanged (vertex count test), duel and co-op unaffected (`mp/sim.test.js`); under 6k triangles for the Wyrm; screenshots: four stages side by side, Wyrm close-up, Wyrm in flight |
| T03 | Highland Pass region from real terrain: `tools/terrain/regions/pass.json`, crop, bake (`dem-pass.js`), preview image, region data of 4.2 with real coordinates, palette `pass`, `viaduct` bridge kind, exits from the Farmlands (west, late Drake) and the Bend, map world entry, aerie in the Barrand Cliffs | - | L | Tests (`pass.test.js`): heights at checked spots match the bake (river level, Barrandov top, gorge floor), the river runs along the east side, viaduct decks are walkable and high over the gorge floor, the cliff face is not walkable, settlement footprints are flat, a Drake below `minGrowth` cannot take the exit. Region under 300 draw calls, loads under 1.5 s on a mid laptop. **Feel checkpoint for Pavel on a phone**: reads as the Barrandov cliffs over the river; screenshots: high view, the cliffs from the river, the big viaduct from the gorge |
| T04 | Maidenhold + pass settlements: `fortress` layout from the castle kit on the promontory, chain net over the yard (landing refused 'net'), toll fort, Chuchel village, Jinonice and Branick hamlets, Zlichov rock chapel; discovery, compass and map icons | T03 | M | Tests (`maidenhold.test.js`): layout on the flat top, yard landing refused with 'net', wall walks landable, every footprint flat; Maidenhold visible from the gorge mouth at 600+ units; screenshots: Maidenhold from the river, from the viaduct, at night |
| T05 | `core/knights.js` + `render/knight-view.js`: stables send knights (alarm over `callAfter`, alert 2 where stables exist), ride roads and walkable ground, chase, lance on a landed or low dragon, arrows do not hurt them, fire does, grab and drop by a Wyrm; Vyshgard stables get knights | T01 | L | Tests (`knights.test.js`): call rule and timing, lance only under `maxAlt`, a burned stable sends none, grab needs carry 3, a drop from 12+ kills, they ride home after `returnAfter`, at most `max`; in game a Drake landing near the Vyshgard gate during a long alarm is charged by knights |
| T06 | `core/nets.js` + `render/net-view.js` + `netter` defender: net launcher posts on the Farmlands and Lethna outposts (and the pass forts once T04 is in), aim line, net flight, pinned state (glide down, no takeoff), Fire burns it, Boost taps shorten it, immunity after | - | M | Tests (`nets.test.js`): pin time, burn time, struggle taps, immunity, no climb while netted; on a phone the prompt names the buttons, a netted dragon can always get free within `pin` s |
| T07 | `core/breach.js` + `render/breach-view.js`: stone hp on wall segments, Wyrm breath wear, Boost ram, breach gap (non-solid middle, walk top cut, rubble), rebuild, mission hold | T01 | M | Tests (`breach.test.js`): a Drake never wears stone, a Wyrm does, a ram under `minSpeed` does nothing, the gap is walkable after the breach and solid again after the rebuild, bastions and towers never breach; in game a Wyrm breaches a Vyshgard wall segment |
| T08 | Caravans generalised: kinds, free-roam schedule, gold train in the pass with knight escort over the big viaduct to Maidenhold, the Farmlands supply wagon (food), gold chest loot (size 3), compass and map markers | T04, T05 | M | Tests (`caravan.test.js` extended): the tithe mission still works, trains spawn on schedule only with the dragon in the region, follow the viaduct deck, stop at 0 hp and drop the chest, a train reaching Maidenhold just ends; the supply wagon drops food |
| T09 | `core/renown.js`: value, start from the saved history, events, tiers, effects lookup; HUD badge, message on a tier change, message log line | - | S | Tests (`renown.test.js`): start from `stats`, event values, clamping, tier changes emit once; at 390 x 844 the badge does not cover the compass or bars |
| T10 | Renown in the world: peasants and bells by tier, tribute by tier, more freeable places (Holeshwick, Chuchel), freed and Renown state on the map | T04, T09 | M | Tests (`freed.test.js` extended): hostile stops tribute, friendly gives x1.5, calm peasants do not ring at a dragon that has not attacked (and do after it burns something), Holeshwick and Chuchel can be freed; in game the difference is visible within one visit |
| T11 | The mother's fall: `campaign/preview/mother-fall.html` first, then `core/fall.js` + `render/fall-scene.js` in the game (first Wyrm leaving the cave, the battery, the fall, Skip), the cairn and map place, mother retired, Act 3 card | T01 | L | **Feel checkpoint for Pavel on a phone** (the scene in the preview page). Tests (`fall.test.js`): plays once, never during a mission, Skip ends it with the same result, `mother.step` does nothing afterwards, act 3 after it; screenshots: three frames of the scene, the cairn |
| T12 | Wyrm upgrades: Roar (Action slot when netted or a knight is near; breaks the net, stuns knights and peasants), Iron scales II, Siege horns; altar shows the Wyrm row locked below Wyrm | T05, T06, T07 | M | Tests (`upgrades.test.js` extended): Roar frees a net and stuns within range, its cooldown, iron scales II lowers arrow and lance damage, siege horns raises ram damage; on a phone Roar shows in the Action slot only when it applies |
| T13 | Intercept mission a3_goldtrain: board entry (Act 3, Wyrm), the mission's own gold train with the knight escort, objective and fail at Maidenhold's gate, briefing; seeded bot `test/goldtrain-bot.js` | T08, T11 | M | Mission bot (seeded) completes it in its time band with 20%+ HP at full hunger on average; on a phone the train is easy to find by the gold marker and the viaduct ambush works |
| T14 | Breach-and-steal mission a3_crown: the Scale-Crown in Maidenhold's keep, the yard net forces a breach, walk in, take it, escape; relic and trophy niche 2; seeded bot `test/breach-bot.js` | T04, T07, T11 | M | Mission bot completes it in its time band; the breach is held while the mission runs; on a phone the full flow from board to the crown on the trophy wall works |
| T15 | Story for Act 3: briefings and outcome lines for both missions, the Order's view in one line each, tips on the trophy wall niche, no more mother lines after the fall; EN + CS | T11, T13, T14 | S | Every new string in EN and CS; the story test covers act 3 cards and that no mother line can play after the fall |
| T16 | Save v4 + migration v3 -> v4: renown, mother's fate and cairn, breaches, caravan clocks, freed places, Wyrm upgrades | T07, T08, T10, T11, T12 | M | Reload restores all of it, also a Wyrm saved in the pass; a v3 save migrates with Renown from its history; corrupt v4 handled like v3; save under 32 KB |
| T17 | Texts and tips (Wyrm, the pass, knights, nets, breach, Renown, Roar; touch wording) + mission bot for both missions in `mission.bot.test.js` + balancing (Wyrm hunger, knights, nets, ram, rewards, caravan times) | T15, T16 | M | Every visible string from `i18n.js` in EN and CS; touch texts name buttons; each mission succeeds within 5-10 min on average with 20%+ HP; Phase 3 missions still pass for a Drake; numbers changed in `data.js` only |
| T18 | README campaign section (Wyrm, the Highland Pass, knights, nets, breaching, Renown, the two missions), controls table, mark Phase 4 done in `000_spec.md` | T17 | S | README lists the new content for phone and desktop |

## 8. Testing

| Level | What | How |
| --- | --- | --- |
| Unit | Wyrm growth and caps, stage looks (vertex counts), the pass terrain and viaducts, Maidenhold layout and yard net, knights, nets, breach, caravan kinds and schedule, Renown, freeing by tier, the fall timeline, upgrades, save v4 | `node campaign/test/run.js`, seeded `mulberry` RNG |
| Simulation | Mission bots for the gold train and the crown (Wyrm), Phase 3 bots for a Drake; invariants (a netted dragon always gets free, knights never inside solids, a breached gap always closes on rebuild, projectiles bounded, Renown inside its range) | `test/mission.bot.test.js` |
| Visual | Stage preview, death scene preview, the pass from high above, Maidenhold by day and night, knights and nets in action at 390 x 844 | Browser check of each visual task; screenshots stay in the scratchpad |
| Regression | Phase 1-3 tests (growth sim, raid bot, three Phase 3 missions); duel and co-op unaffected by the shared model change | both test runs |
| Manual | Phone first: stage looks (T02), the pass (T03), the death scene (T11), knights, nets, breach, each mission, Renown change, reload; then desktop | Checklist in each PR, phone steps first |

## 9. Performance budget

| Metric | Budget |
| --- | --- |
| Frame rate | 30+ fps on a mid phone with a gold train, its knights and the toll fort shooting (mid tier), 50+ fps on a mid laptop |
| Draw calls | the pass under 300 in total; all knights under 4; Maidenhold under 24 |
| Triangles | Wyrm model under 6k; viaducts under 8k |
| Lights | no new real lights (the death scene uses the existing sun and fire lights) |
| Defenders | 45 active max per region (knights count), knights full AI within 400, 4 Hz beyond |
| Region load | the pass under 1.5 s on a mid laptop |
| Save | under 32 KB |
| New JS | under 170 KB unminified for this phase (the baked `dem-pass.js` not counted, like `dem-bend.js`) |

## 10. Risks

| Risk | Mitigation |
| --- | --- |
| The death scene feels cheap or too long | Preview page first (T11) with Pavel's approval; 30-45 s, skippable, the game's own models, captions instead of voice |
| A Wyrm is too big for the regions and the castle courtyards | Courtyard and wall walk tests in T01; camera pulled back with scale; Maidenhold's yard is refused on purpose and the breach is the way in |
| Knights on real terrain get stuck in the gorge or on the cliffs | They prefer roads, use `walk.maxSlope`, and teleport home when stuck longer than 10 s out of the dragon's view |
| Nets feel unfair on a phone | A visible aim line, 3 s at most, two ways out without upgrades (Fire, Boost taps), immunity afterwards |
| Breaching makes castles trivial | Wyrm only, stone hp high, the ram hurts the dragon, only wall segments break, rebuild after twice the fire time |
| Renown punishes players who did not know about it | The start is clamped to -50..50 so old saves land in wary or near it; wary is Phase 3's behaviour; a message explains each tier change |
| The pass terrain does not read on a phone | Height exaggeration 2.0, limestone colour on the cliff faces, Pavel checks the high view in T03 |
| The raw tile download fails in the build sandbox (needed once for `crop.py`) | `sources.json` has the URL and checksums; if the download is blocked, the T03 PR reports it and Pavel commits the crop (`tools/terrain/sources/pass_dtm.png`) from his machine |
| Wyrm hunger makes the long trips to the pass impossible | Pass aerie for banking and resting, hungerMult 1.4 (not 2.2), T17 tunes it with the bots |
| Changing the shared dragon model breaks the duel | Stage parts only with the `stage` option; `mp/sim.test.js` and a vertex count test |

## 11. Open design questions (recommended defaults)

1. Highland Pass terrain: the Barrandov cliffs + Prokop gorge + Hlubočepy viaducts south-west of Prague (default: same tile, the river along the east side, cliffs and viaducts give the "pass"), or the deep Vltava gorge further south (Davle - Štěchovice - Slapy, a true highland canyon, but a new tile N49E014 and farther from the Prague theme)?
2. Names: Barrand Cliffs, Prokop Gorge, Hlubowick viaducts, Maidenhold (Dívčí hrady, the Maidens' war), Chuchel, Jinonice, Branick, Zlichov rock chapel (default), or other names?
3. Where and when does the mother die? Default: the first time a new Wyrm leaves the cave, she flies ahead toward the Farmlands and a hidden Order battery of three ballistae brings her down in front of the player (an in-engine scene over the live Ash Wastes, skippable). Alternative: an interactive version where the player arrives too late.
4. Can the player save her? Default: no, the scene always ends with her death (the story needs it; `000_spec.md` section 2).
5. Stage visuals: scale plus extra horns, a spine crest and darker scales per stage (default; resolves the open question in `000_spec.md` section 10), or scale only?
6. Wyrm hunger: hungerMult 1.4 (default, tuned by the bots) instead of the original 2.2?
7. Breaching: Wyrm breath wears stone slowly and a Boost ram deals a big hit that also hurts the dragon; only wall segments break (default). Or breath only, or ram only?
8. Nets: up to 3 s pinned, Fire burns the net, Boost taps shorten it, Roar (upgrade) breaks it at once (default)?
9. Knights: arrow-proof riders that hit only a landed or low dragon, called by long alarms and escorting gold trains; a Wyrm can grab one and drop it (default)?
10. Renown: three tiers (hostile / wary / friendly), wary = today's behaviour, start from the saved history clamped to -50..50 (default)? Should freed villages turn hostile again at low Renown (default: no tribute, but they stay freed)?
11. Region gate: the pass at late Drake (`minGrowth 0.45`, as `000_spec.md` section 7 says "Drake (late)"), Act 3 missions at Wyrm (default), or the whole pass at Wyrm?
12. Missions: two this phase (gold train intercept, breach-and-steal the Scale-Crown) plus free-roam gold trains (default), or a third (for example burn the net workshop at the toll fort)?
13. Roar on touch: in the Action slot only when it applies (netted, or a knight near and nothing to grab) (default), or its own button?
