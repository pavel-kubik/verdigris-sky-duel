# Phase 3 - Castle, Map + Missions: Implementation Spec

Status: draft, 2026-10-31. Refines `000_spec.md` for Phase 3. Built on `campaign-phase-3` (branched from the finished `campaign-phase-2`). Task branches are `agent/t2NN-...` (T01 -> `t201`).

Revised by Pavel, 2026-10-31:
- **Visual form comes first.** The phase opens with the first Order castle as a showpiece, before the mission systems.
- **The castle gets its own land.** A new region, the **Vltava Bend** (working title), is built on the landscape of Prague with the iconic shape of the Vltava: the river comes from the south past a rock, runs north through the old city, turns east under a plateau, loops around a peninsula and turns back west and north. The castle stands on the rock in the south, where Vyšehrad stands: **Vyšehrad Castle** (working title).
- **New regions follow Prague's landscape.** The Vltava Bend is the first; the river runs through the later ones too.
- The map screen stays in this phase and becomes a drawn, explorable map, not only a region graph.

## 1. Goal

The dragon gets a new land to fly over, a real enemy stronghold to raid, a map to find its way around the world and its first timed missions. A Drake flies from the Farmlands into the Vltava Bend, follows the river north and sees Vyšehrad Castle on its rock above the water. It flies over the walls under archer and ballista fire, burns wooden roofs, steals the Ember Chalice from the twin-spired chapel against the clock and banks it in an aerie. The cave gets the mission board, the trophy wall and the map stone.

The phase starts with the castle block (castle look in a preview page, the new region, the castle in it, its defenders and fire; checked by Pavel on a phone), then the map and aeries, then missions, story cards and the freed village.

**Exit criteria**

- On a phone, the Vltava Bend reads as Prague's river from above: on the map and from high flight, the river shape (south run, bend under the plateau, loop around the peninsula, turn back north-west) is recognisable, with its islands, hills and a stone bridge.
- Vyšehrad Castle reads as a castle on its rock from at least 600 units away (rock cliff over the river, walls and bastions, towers, keep, twin spires, banners) and is the strongest image of the region by day and by night (torches, lit windows).
- A Drake lands in the castle courtyard or on a wall walk, walks between the buildings, and the castle fights back (archers on towers and walls, ballistae on bastions, the gate closes on alarm); wooden roofs burn, stone stays standing but charred.
- The map screen shows the world with discovered regions, settlements, castles, aeries, the lair and the dragon; unexplored ground stays fogged until the dragon has flown over it.
- Fast travel from the map stone in the cave to a discovered aerie and back works.
- Three missions (steal, destroy, intercept) can each be completed in 5-10 minutes; death and timeout rules work as specified in `000_spec.md` section 6.
- Destroying the Order garrison of the Farmlands village frees it: its Order flag falls and it sends food tribute to the larder.
- Act 1 and Act 2 cards, mission briefings and outcomes appear in EN and CS.
- A save (v3) survives a reload, and a v2 save migrates without loss.

### In scope

| Area | Phase 3 content |
| --- | --- |
| New region | Vltava Bend: terrain built on Prague's landscape (section 4.2): the Vltava with its islands, the Vyšehrad rock, the Petřín and Hradčany ridge on the west bank, the Letná plateau over the bend, the Vítkov ridge in the east, the Holešovice peninsula inside the loop, the Troja slopes in the north; a stone bridge with gate towers; the old royal city as burned ruins; entered from the Farmlands, gated at Drake |
| Settlements | Vyšehrad Castle (rock, south), Order outpost on the Letná plateau, village on the Holešovice peninsula, hamlet at Troja, Order watch tower on Petřín |
| Castle | Vyšehrad Castle: rock spur with a cliff over the river, curtain walls with bastions following the rock edge, gatehouse, towers, keep, twin-spired chapel, round rotunda, great hall, siege workshop, stables, well; banners |
| Castle look | Modular castle kit (`render/castle-kit.js`), standalone preview page first, LOD (full model near, silhouette far), torches and lit windows at night, smoke from chimneys, waving banners, charred stone after fire |
| Castle play | Solids for walls, towers and buildings; landing allowed in the courtyard and on wall walks; archers on towers and wall walks, ballistae on bastions, gate closes on alarm, castle horn alerts the region |
| Map | Map screen with a drawn world view (regions around the volcano) and a region view (top-down terrain image with rivers, roads, fields, places); fog of war from exploration; markers for lair, aeries, settlements, castle, mission target, dragon |
| Aeries | One small cliff cave per region outside the Ash Wastes (Wildwood, Farmlands, Vltava Bend): discover, bank loot, end missions, rest |
| Fast travel | Map stone station in the cave; from the lair to a discovered aerie and from an aerie to the lair |
| Missions | `core/missions.js`: catalogue in data, accept at the board, timer, objectives, success / fail, time bonus, retry after rest |
| Mission types | Steal (Ember Chalice from the castle chapel), destroy (castle siege workshop), intercept (tithe wagon crossing the stone bridge to the castle) |
| Relics | Relic items with mission carry rules (speed -20%, no breath), lost on death or timeout, shown on the trophy wall |
| Cave stations | Mission board, trophy wall, map stone |
| Freed village | Destroying the Farmlands village's Order garrison (tax house, tower and its archers) frees it; food tribute to the larder |
| Story | Act 1 and Act 2 cards, mission briefings (2-4 lines) and one-line outcomes; the mother flies with the Drake on its first castle raid |
| Save | v3 with missions, relics, aeries, freed villages, explored map cells, castle state; v2 -> v3 migration |
| UI | Mission timer (amber at 60 s, red at 20 s), mission target on the compass and the map, map button, EN + CS texts |

### Out of scope (later phases)

Renown (Phase 4; tribute in this phase depends only on the village being freed), knights, nets, frost mages, mangonels (Phases 4-5), breaching stone walls (Phase 4, Wyrm), hunt / rescue / defend / boss missions, alert 4-5, slayers, lair defense, the mother's death scene (Phase 4), the Highland Pass, towns (the Old Town stays ruins in this phase), more castles (the later castles reuse the kit), boats on the river.

## 2. Constraints from the current code

| Fact | Consequence for Phase 3 |
| --- | --- |
| Regions are discs of `radius` 1100 with features road, river, plateau over seeded noise (`core/terrain.js`) | The Vltava Bend has radius 1200 and new features: `hill` (raised area with a flank), `ridge` (hill along a polyline), `cliff` (a hill with one steep side facing a direction), `island` (dry ground inside a river channel), `bridge` (dry deck across a river), `ruins` (flattened ground for rubble scenery). Base noise stays low (`amp` 0.4) so the river shape reads |
| `river` is one polyline with width, depth and a flat valley floor of 34 | The Vltava is a polyline with `width` 40 and a wide `valley` (80) so the old-city lowland, the embankments and the peninsula are flat; islands sit inside its channel |
| Exits are arcs on the region edge with `minStage` | The Farmlands get a second exit on their +Z side to the Vltava Bend (`minStage: 1`); the Bend's entry from the Farmlands is on its south edge, so the dragon arrives along the river with Vyšehrad ahead |
| Settlements are templates of single round buildings plus an optional round palisade (`data.settlements`, `settlement.build`) | The castle is a settlement type with a `walls` polygon (wall segments between towers and bastions) and a gate, not a `ring`; segments become capsule solids like palisade pieces, but taller and with a walkable top |
| `settlement.solidAt` gives one roof height; landing on a roof is refused with 'roof' | Buildings get a `walkTop` flag: a wall walk and the courtyard are landable and walkable, keep, spire and tower roofs stay refused. The wall top is a solid the dragon can stand on (`walk.step` already takes ground from `ctx.surface`) |
| Settlements sit on `plateau` features that level the ground | The castle sits on the `cliff` feature of the Vyšehrad rock, which has a flat top for all footprints and a steep side to the river |
| Buildings render as one vertex-coloured `InstancedMesh` per type (about 11 draw calls) | The castle kit follows the same pattern: one geometry per piece type, instanced; the whole castle stays under 24 draw calls on the high tier |
| Fire turns a building into rubble (`ruins`) | Castle stone pieces have `stone: true`: fire burns their wooden parts (roof, hoardings) and leaves a charred stone shell that is still a solid; archers on a burned-out tower die as before |
| Defender posts are tied to building types (`tower` = archer, `platform` = ballista) | Castle towers and wall segments get post lists (`posts`), so several archers stand on one wall; bastions carry a ballista |
| The bell alerts one settlement; `alert.js` keeps heat per region | The castle horn is a bell with `range` covering the whole region: every settlement of the Vltava Bend goes to alert when it sounds |
| `nav.markers` gives compass markers; discovery is per settlement (`cs.discovered`) | The map reads the same discovered set, plus explored cells (`cs.explored`, a coarse grid per region); the castle and aeries are discoverable places |
| The cave has reserved positions: trophy [-40, 20], board [40, 20], mapStone [0, 30] (`data.cave.stations` comment) | The three new stations use them; station panels and the Action slot work as in Phase 2 |
| Loot (`core/loot.js`): one carried item in the claws, banked on lair enter, lost on death | Relics are loot kinds with `mission: true`; banking also happens at an aerie; timeout loses mission loot only |
| Region change = full scene swap (`region.enter`) | Fast travel is a region change with a fade and a fixed entry point (the aerie mouth or the lair mouth) |
| Save v2 (`core/save.js`, `migrate` chain) | v3 adds `missions`, `hoard.relics`, `regions.<id>.aerieFound`, `regions.<id>.freed`, `regions.<id>.explored`, `story.act`, `story.seen`; v2 -> v3 step |
| The headless check renders at 2-8 fps in software | Visual tasks end with screenshots from fixed camera views (listed per task) plus a phone check by Pavel (feel checkpoints T01, T02 and T06) |

## 3. File structure

New files (existing ones extended where noted):

```
campaign/
  preview/
    castle.html         standalone castle preview: orbit / touch drag + pinch, day / night, quality tier, LOD toggle
  core/
    castle.js           castle layout from data: wall polygon -> segments, bastions, gate, inner buildings, walk tops, posts
    map.js              explored grid, map model (regions, places, markers), fast travel rules
    aerie.js            aerie sites, discovery, enter / leave, bank, rest
    missions.js         catalogue, accept, timer, objectives, success / fail, rewards, retry
    relics.js           relic catalogue, carry rules, trophy wall data
    caravan.js          wagon + escort moving along a road, stop, loot drop
    story.js            act cards, briefings, outcomes, seen flags
    (data.js, terrain.js, settlement.js, defenders.js, alert.js, loot.js, cave.js, nav.js, region.js, state.js,
     save.js, tips.js extended)
  render/
    castle-kit.js       castle piece geometries (wall segment, bastion, round tower, square tower, gatehouse, portcullis,
                        keep, twin-spire chapel, rotunda, hall, workshop, stables, well, hoardings, banners, torches)
    castle-view.js      instanced castle in the region, LOD, night lights, banner wave, chimney smoke, char
    bridge-view.js      stone bridge with arches and gate towers
    ruins-view.js       burned old city: instanced rubble, wall stumps, a few standing towers
    map-view.js         map screen: world view, region view (terrain image), fog, markers, pan / zoom
    aerie-view.js       aerie cliff mouth outside, small cave inside
    caravan-view.js     wagon, oxen, escort
    mission-hud.js      timer, objective line, target marker hand-off to compass and map
    story-card.js       act cards and mission briefing / outcome cards
  test/
    bend.test.js  castle.test.js  map.test.js  aerie.test.js  missions.test.js  relics.test.js  caravan.test.js
    freed.test.js  story.test.js  save3.test.js  mission.bot.test.js
```

Script order in `campaign/index.html`: Phase 2 order with `castle` after `settlement`, `relics` after `loot`, `caravan` after `defenders`, `aerie, map, missions, story` after `nav`.

## 4. Data schemas (`core/data.js`)

All numbers are starting values for tuning. `version` becomes 3.

### 4.1 Castle

The castle layout is an original design with nods to Vyšehrad: a rock spur with a cliff on the river side, walls with pointed bastions following the rock edge, a gatehouse on the land side (east), a twin-spired chapel as the landmark (the steal mission target), a small round rotunda.

```js
buildings: {
  // existing types stay; castle pieces:
  wall:      { r: 0, h: 11, hp: 400, order: true, wall: true, stone: true, walkTop: 9.5, posts: 'archer' },
  bastion:   { r: 8, h: 12, hp: 360, order: true, stone: true, walkTop: 11, post: 'ballista' },  // pointed, ballista on top
  ctower:    { r: 6, h: 20, hp: 300, order: true, stone: true, post: 'archer', calmsAlert: true },
  gatehouse: { r: 8, h: 16, hp: 360, order: true, stone: true, gate: true, posts: 'archer' },
  keep:      { r: 11, h: 30, hp: 500, order: true, stone: true, garrison: 4, horn: true },
  chapel:    { r: 8, h: 14, hp: 160, order: true, stone: true, spires: 2, spireH: 38, loot: ['relic'] },
  rotunda:   { r: 4, h: 9, hp: 120, civil: true, stone: true },
  hall:      { r: 9, h: 11, hp: 200, order: true, loot: ['strongbox'] },
  workshop:  { r: 8, h: 8, hp: 140, order: true, target: 'workshop' },
  stables:   { r: 7, h: 6, hp: 100, order: true },
  well:      { r: 2, h: 2, hp: 0 },
},
castle: {
  wallThick: 3, walkWidth: 2.4, crenel: 1.2,        // wall walk: landable top band of a wall segment
  gate: { w: 10, close: 2.5 },                      // portcullis drops in `close` s on alarm, opens after the search
  horn: { range: 'region', cool: 60 },              // the keep's horn alerts every settlement of the region
  char: { tint: 0.35 },                             // stone colour multiplier after its wooden parts burned
  lod: { near: 280, far: 1000 },                    // full model inside `near`, silhouette mesh up to `far` (fog beyond)
  lights: { torches: 16, windows: true },           // night: emissive torch sprites + window emissive, no extra real lights
},
settlements: {
  castle: {                                         // local frame: +X = east (land side), the cliff on local -X (west, the river)
    walls: [[-60, -30], [-20, -42], [30, -38], [70, -14], [72, 14], [30, 38], [-20, 42], [-62, 26]],
    corners: ['bastion', 'ctower', 'bastion', 'gatehouse', 'gatehouse', 'bastion', 'ctower', 'bastion'],  // gate gap between 4 and 5
    buildings: [['keep', -36, 0], ['chapel', 8, 12], ['rotunda', 40, -22], ['hall', 10, -18], ['workshop', 48, 20],
                ['stables', -14, 26], ['well', 26, 0]],
    archers: 10, peasants: 4,
  },
},
```

### 4.2 Vltava Bend (Prague landscape)

Coordinates come from real Prague: lon / lat projected around 14.4325 E, 50.0905 N at 3.6 m per unit, +Z = north, +X = east, rounded to 5. Heights are game heights (exaggerated about 1.3x so the hills read from the air). If the compass in the game shows east on -X, mirror every x (one sign flip in data) so the river is not drawn mirrored; `bend.test.js` checks the bend turns east.

| Landmark | Real place | At (x, z) | Feature |
| --- | --- | --- | --- |
| River | Vltava from Podolí to Troja | polyline below | `river`, width 40, depth 8, valley 80 |
| Castle rock | Vyšehrad | -260, -805 | `cliff` r 85, h 34, steep side west (toward the river) |
| West ridge | Petřín and Hradčany | [-745, -330] -> [-745, -230] -> [-645, 0] -> [-600, 120] | `ridge` width 160, h 48 |
| Plateau over the bend | Letná | -190, 230 | `cliff` r 150, h 30, steep side south (toward the river) |
| East ridge | Vítkov | [200, -40] -> [345, -45] -> [520, -20] | `ridge` width 110, h 36 |
| North slopes | Troja | -290, 960 | `hill` r 220, h 44, flank 160 |
| Old city lowland | Old Town and New Town | -230, -200 | `ruins` r 150 (flat, rubble scenery) |
| Peninsula | Holešovice | 250, 450 | flat in the loop (valley floor) |
| Islands | Střelecký, Kampa, Štvanice, Císařský | [-445, -280] r 22; [-470, -150] r 18; [90, 215] r 20; [-345, 695] r 40 | `island` |
| Stone bridge | Charles Bridge | across the river at -415, -125, yaw 0 (east-west), len 70 | `bridge` with gate towers at both ends |

```js
regions.bend: {
  nameKey: 'c.region.bend', radius: 1200, seed: 53, ceiling: 320, waterLevel: 0, palette: 'bend',
  terrain: { amp: 0.4, base: 14, features: [
    { type: 'river', width: 40, depth: 8, valley: 80, points: [[-375, -1300], [-375, -1125], [-355, -790], [-395, -540],
      [-425, -295], [-415, -125], [-345, 0], [-230, 95], [-70, 95], [90, 185], [310, 310], [585, 415], [745, 540],
      [585, 650], [250, 710], [-50, 755], [-290, 820], [-545, 1005], [-640, 1120]] },
    { type: 'island', x: -445, z: -280, r: 22 }, { type: 'island', x: -470, z: -150, r: 18 },
    { type: 'island', x: 90, z: 215, r: 20 }, { type: 'island', x: -345, z: 695, r: 40 },
    { type: 'cliff', x: -260, z: -805, r: 85, h: 34, face: -PI / 2, flank: 60 },                 // Vyšehrad rock
    { type: 'ridge', points: [[-745, -330], [-745, -230], [-645, 0], [-600, 120]], width: 160, h: 48 },
    { type: 'cliff', x: -190, z: 230, r: 150, h: 30, face: PI, flank: 120 },                     // Letná
    { type: 'ridge', points: [[200, -40], [345, -45], [520, -20]], width: 110, h: 36 },            // Vítkov
    { type: 'hill', x: -290, z: 960, r: 220, h: 44, flank: 160 },                                 // Troja
    { type: 'ruins', x: -230, z: -200, r: 150 },                                                  // the burned royal city
    { type: 'road', width: 8, points: [[-375, -1200], [-300, -1000], [-200, -860]] },            // south entry -> castle gate
    { type: 'road', width: 7, points: [[-640, 40], [-470, -125], [-360, -125], [-260, -300], [-230, -600], [-200, -860]] },
    { type: 'road', width: 7, points: [[-260, -300], [-120, 0], [100, 300], [250, 450]] },       // to the peninsula village
    { type: 'bridge', x: -415, z: -125, yaw: 0, len: 70, width: 10, towers: true },
  ] },
  flora: { trees: 700, rocks: 90, fields: 14, vines: 'troja' },
  herds: [{ type: 'deer', count: 2, ring: [600, 1150] }, { type: 'boar', count: 1, ring: [700, 1150] }],
  settlements: [
    { type: 'castle',  x: -240, z: -805, yaw: 0, name: 'vysehrad' },
    { type: 'outpost', x: -190, z: 260, yaw: PI, name: 'letna' },
    { type: 'village', x: 250, z: 470, yaw: 0.6, name: 'holesovice' },
    { type: 'hamlet',  x: -230, z: 930, yaw: 2.2, name: 'troja' },
    { type: 'outpostS', x: -745, z: -230, yaw: 1.4, name: 'petrin' },                            // watch tower on the ridge
  ],
  exits: [{ to: 'farm', angleFrom: PI - 0.5, angleTo: PI + 0.5 }],
  entries: { farm: { angle: PI + 0.3 } },                                                         // arrive over the river, south
},
regions.farm.exits += [{ to: 'bend', angleFrom: -0.5, angleTo: 0.5, minStage: 1 }],
regions.farm.entries.bend = { angle: 0 },
```

Palette `bend`: greener river meadows, limestone grey on the cliffs, vineyard rows on the Troja slopes, dark charred ground in the ruins, slate blue water.

### 4.3 Map and exploration

```js
map: {
  cell: 50,                     // explored grid cell size; a region of radius 1200 has 48 x 48 cells
  reveal: 160,                  // cells within this distance of the dragon (x stage spot ^ 0.5) become explored
  revealAlt: 1.5,               // x this range when flying above `ceiling` * 0.6
  image: 256,                   // region view terrain image resolution (px), drawn once per region and cached
  world: { ash: [0, 0], wild: [0, 1], farm: [0, 2], bend: [0, 3], pass: [-1, 2.6], low: [1, 3.6], capital: [0, 4.4] },
  zoom: [1, 4],
},
```

### 4.4 Aeries

```js
aeries: {
  wild: { x: -620, z: -480, facing: 1.9 },
  farm: { x: 720, z: 560, facing: -2.4 },
  bend: { x: -120, z: 1010, facing: PI },          // a cleft in the Troja rocks, facing the river
  discover: 200, enterRange: 40, room: { r: 22, h: 14 },
},
```

### 4.5 Missions and relics

```js
missions: [
  { id: 'a2_chalice',  type: 'steal',     act: 2, minStage: 1, region: 'bend', target: 'bend.castle.chapel1',
    relic: 'ember_chalice', time: 480, reward: { gold: 250 } },
  { id: 'a2_workshop', type: 'destroy',   act: 2, minStage: 1, region: 'bend', target: 'bend.castle.workshop1',
    time: 420, reward: { gold: 200 } },
  { id: 'a2_caravan',  type: 'intercept', act: 2, minStage: 1, region: 'bend', caravan: 'tithe', time: 390,
    reward: { gold: 300 } },
],
mission: { bonusPer: 5, bonus: 0.01, warn: 60, danger: 20, retryAfter: 'rest', alertOnFail: 1 },
relics: {
  ember_chalice: { nameKey: 'c.relic.chalice', weight: 1, trophy: [-40, 20, 0] },
},
loot: { relic: { carry: { speed: 0.8, breath: false }, mission: true } },
caravan: {
  // road 1 of the Bend: from the Hradčany side across the stone bridge, along the east bank to the castle gate
  tithe: { region: 'bend', road: 1, from: 0.0, to: 1.0, speed: 7, wagons: 1, escort: 3, chest: 'strongbox', wagonHp: 120 },
},
tribute: { every: 300, food: 40, max: 3 },          // a freed village leaves food in the larder every `every` s of play
story: { acts: [1, 2], cards: ['act1', 'act2'], firstRaidMother: true },
```

Mission times are longer than in the first draft because the Bend is one region further from the lair (the timer starts when the dragon leaves the lair region or an aerie); T19 tunes them.

## 5. System interfaces (`core/`)

### 5.1 Terrain features (`terrain`)

- `hill { x, z, r, h, flank }`: flat top of radius `r` at `h` over the base, smooth flank of width `flank`.
- `ridge { points, width, h }`: a hill along a polyline (height falls off with the distance to the line).
- `cliff { x, z, r, h, face, flank }`: a hill whose side facing `face` (radians, 0 = +Z) is steep (over `walk.maxSlope`, not walkable) and whose other sides have a `flank`.
- `island { x, z, r }`: dry ground above `waterLevel` inside a river channel.
- `bridge { x, z, yaw, len, width, towers }`: a dry, walkable and landable deck over the river; `liquidAt` is false on it; the renderer draws arches and gate towers.
- `ruins { x, z, r }`: flattens the ground (like a plateau at the local height) and marks the area for rubble scenery (`terrain.ruinsAt`).
- Features apply in this order: road, river, island, hill / ridge / cliff, plateau / ruins, bridge.

### 5.2 `castle`

- `castle.layout(site)` -> `{ segments: [{ a, b, h, walkTop }], corners: [...], gate: { a, b }, buildings: [...] }` from the polygon (pure, tested).
- `settlement.build` calls it for a site with `walls`; segments become solids (capsules of `wallThick`), corners and buildings are cylinders; the gate gap is open unless `gateClosed`.
- `settlement.surfaceAt(town, x, z)` returns a walkable top (wall walk band, bastion top, gatehouse top) or `null`; `walk.canLand` and `walk.step` use it before the terrain.
- `castle.closeGate(town)` / `openGate(town)`: driven by the castle's alarm and search end; a closed gate is a solid.

### 5.3 `map`

- `map.step(cs, dt)`: marks cells explored around the dragon (reveal radius x stage factor x altitude factor), at most 4 Hz.
- `map.model(cs)` -> `{ regions: [{ id, known, locked, alert }], places: [{ id, kind, x, z, discovered, alert, freed }], dragon, target }` for the renderer (pure, tested).
- `map.canTravel(cs, from, to)` -> `{ ok, why }`: only from the lair map stone or an aerie, only to a discovered aerie or the lair, not with a mission active and not with mission loot in the claws.
- `map.travel(cs, to)`: region change to the aerie or lair mouth (fade), emits `travel:done`.

### 5.4 `aerie`

- `aerie.discover(cs)`: within `discover` and in line of sight (same check as settlements) -> `aerie:found`.
- Flying into an aerie mouth: banks carried loot (as the lair does), completes a mission whose objective is done, offers Rest (save, heal, no stage-up; stage-up stays at the nest), Fast travel to the lair, Leave. The aerie interior is a small cave scene reusing `cave.js` with its own room data.

### 5.5 `missions` and `relics`

- States: `offered` -> `accepted` (at the board) -> `running` (timer starts when the dragon leaves the lair region or an aerie with the mission accepted) -> `done` (objective met) -> `success` (delivered to the lair or an aerie before 0) or `failed` (timeout, death).
- `missions.step(cs, dt)`: timer, objective checks through events (`loot:taken` of the relic, `building:ruined` of the target, `caravan:stopped` + chest taken), fail on 0 or `dragon:died`; the timer pauses during region loading and does not run inside the lair or an aerie.
- Rewards: gold + `bonus` per `bonusPer` s left; relics go to `hoard.relics` and the trophy wall. Fail: mission loot vanishes, region heat + `alertOnFail`, retry after the next rest.
- `relics.carry(cs)` applies `loot.relic.carry` while a relic is in the claws.

### 5.6 `caravan`

- Spawned when the intercept mission starts: wagon(s) move along road `road` of the region from `from` to `to` (fractions of the polyline) with escort archers walking beside them; `caravan.step` moves, the escort uses the defender AI.
- Burning the wagon's oxen or the wagon to 0 hp stops it and drops the chest (`strongbox`) next to it; a chest dropped on the bridge stays on the deck; reaching `to` (the castle gate) ends the mission as failed.

### 5.7 Freed village

- A settlement with `order` buildings is freed when every `order` building is a ruin and its archers are dead at the same time: `settlement:freed`, saved in `regions.<id>.freed`; an Order flag mesh falls; freed buildings are not rebuilt as Order buildings, no archers spawn there, peasants stop ringing the bell at the dragon.
- Tribute: while freed, every `tribute.every` s of play a carcass (`tribute.food`) appears in the larder, at most `tribute.max` waiting.

### 5.8 `story`

- `story.act(cs)`: Act 1 until Drake, Act 2 from Drake (Act 3 starts in Phase 4). Shows an act card once (`story.seen`).
- Briefing card on accepting a mission, outcome line on success or fail; the mother flies with the Drake on its first castle mission (`firstRaidMother`), keeps out of the danger zones and leaves when the mission ends. Her first flight into the Bend comes with one line about the burned city below ("This was the King's city.").

### 5.9 `save` v3

```json
{
  "version": 3,
  "hoard": { "gold": 1240, "relics": ["ember_chalice"] },
  "missions": { "completed": ["a2_chalice"], "active": null, "failedAt": {} },
  "regions": { "bend": { "aerieFound": true, "explored": "<base64 bitset>", "gate": "open" },
               "farm": { "freed": ["farm.village"] } },
  "story": { "act": 2, "seen": ["act1", "act2", "brief.a2_chalice"] }
}
```

v2 -> v3: empty missions, no relics, nothing explored except the cells around discovered places, `story.act` from the stage.

## 6. Rendering and UI

| Element | Implementation |
| --- | --- |
| Castle kit | Low-poly pieces from primitives, vertex colours (limestone walls, darker plinth, slate and lead roofs, timber hoardings, dark green-grey spires, Order red banners with a gold lance), crenellations as merged boxes, arrow slits as dark inset quads, a weathering gradient in vertex colour (darker at the base, moss near the ground). One geometry per piece type, instanced |
| Castle rock | The `cliff` side gets its own rock colour band (limestone grey with darker strata), so the rock reads as a cliff from the river |
| Castle LOD | Inside `lod.near` the full kit; out to `lod.far` one merged silhouette mesh (under 2k triangles, the twin spires kept) so the castle on its rock shows across the region; fog beyond |
| Night | Torches as additive sprites on the walls and gate (no real lights), window quads with emissive colour that only show at dusk and night; the keep and the chapel are the brightest points of the Bend at night |
| Life | Banners wave (vertex shader offset in the banner geometry, one uniform), chimney smoke from the hall (shared smoke pool), a slow flag on the keep; after alarm a red signal fire on the keep top |
| Fire and char | Wooden roofs and hoardings burn with the Phase 2 flame pool; a burned stone piece swaps its instance colour to `char.tint` and loses its roof part (separate instanced roof mesh, hidden when burned) |
| River | Water plane per river segment (as in the Farmlands), wider; embankment stones along the old city stretch; islands with trees |
| Stone bridge | 14 low arches, a deck with a parapet, a gate tower at each end (instanced pieces; under 4 draw calls) |
| Ruins | The burned royal city: instanced rubble heaps, wall stumps and a few standing tower shells on charred ground (3 draw calls), seen from the air as a dark patch on the east bank; on the west ridge a ruined old castle silhouette over Hradčany |
| Map screen | Full screen panel: world view (painted region shapes around the volcano, names, locks with the stage needed, alert colour) and region view (the terrain image from heights + palette with rivers, roads, fields; settlements, castle, aeries, lair as icons; dragon arrow; mission target ring); fog = dark parchment over unexplored cells; pinch to zoom, drag to pan; tap an icon for its name; Close button. Opened by a map button next to pause (touch) or Tab (desktop) |
| Map stone | Station panel with the map in travel mode: discovered aeries and the lair are tappable with "Fly there" |
| Mission board | Wooden board with parchment notes in the cave; panel lists missions (locked ones greyed with the reason), briefing, time limit, reward, Accept |
| Trophy wall | Rock wall with niches; each recovered relic sits in its niche with a glow; panel names it and its story line |
| Mission HUD | Timer under the compass, centred, 28 px; amber at 60 s, red and pulsing at 20 s; one objective line; mission target marker on the compass in gold |
| Story cards | Act cards: full screen panel drawn with the game's own render (Act 2: Vyšehrad over the river at dusk) with 2-4 lines and Continue; briefings as a bottom sheet over the board panel |
| Aerie | Outside: a dark cleft in a cliff with a ledge and bones; inside: a small round cave with a nest of branches |

## 7. Task breakdown

Each task ends with both test runs passing and the browser check from the agent prompt. Visual tasks also save screenshots from the fixed views named in the row. Sizes: S < 2 h, M 2-5 h, L 5-10 h of AI-assisted work.

| ID | Task | Depends on | Size | Acceptance |
| --- | --- | --- | --- | --- |
| T01 | Castle kit + preview page: `render/castle-kit.js` (all pieces of section 6) and `campaign/preview/castle.html` showing Vyšehrad Castle from `data.settlements.castle` on a stand-in rock with a cliff side, orbit camera (touch drag, pinch), day / dusk / night switch, quality tier switch, LOD switch, draw call and triangle readout | - | L | **Feel checkpoint for Pavel on a phone** (the look is approved before the castle goes into the game). Preview runs at 390 x 844 with no page errors; full castle under 24 draw calls, under 70k triangles on high, 35k on low; silhouette under 2k; screenshots: from the river below the cliff, the gate, three-quarter from above, courtyard, night |
| T02 | Vltava Bend region: terrain features `hill`, `ridge`, `cliff`, `island`, `bridge`, `ruins` (section 5.1), the region data of 4.2, palette `bend`, water, embankments, stone bridge mesh, ruins scenery, Troja vineyards; Farmlands exit to the Bend (Drake) | - | L | Tests (`bend.test.js`): the river turns east after the bridge and loops back west (shape check on the polyline and on `liquidAt` samples), islands and the bridge deck are dry, the Vyšehrad and Letná cliff sides are not walkable, the castle and settlement footprints are flat, a hatchling is too small for the exit. Region loads under 1.5 s on a mid laptop, under 300 draw calls; **feel checkpoint for Pavel on a phone**: the river shape reads as Prague from high flight; screenshots: high view of the whole bend, the bridge, the Vyšehrad rock from the river |
| T03 | `core/castle.js` + castle settlement type: wall polygon, bastions, gate, walk tops, solids; landing in the courtyard and on wall walks | T01, T02 | L | Tests: layout from the polygon, solids block walking and flying, wall walk and bastion top landable, keep and spire roofs refused ('roof'), gate gap walkable when open and solid when closed; every castle footprint is on the flat top of the rock |
| T04 | Castle and settlements in the Bend: `render/castle-view.js` with LOD, night torches and windows, banners, chimney smoke; the Letná outpost, Holešovice village, Troja hamlet and Petřín watch tower; discovery with a castle icon on the compass | T03 | M | Region still under 300 draw calls; the castle is visible from the Farmlands entry over the river at 600+ units; no geometry leak after 5 round trips; screenshots: arriving from the south along the river, from the bridge, night over the walls |
| T05 | Castle defenders: archers on towers, wall walks and the gatehouse (post lists), ballistae on the bastions, gate closes on alarm and opens after the search, the keep's horn alerts every settlement of the region, signal fire | T04 | M | Tests: post placement on walls, horn alerts the whole region once per `horn.cool`, gate state follows the alarm, the gate never closes on a dragon in the gap; in game a low pass along the wall draws volleys from the wall walk and a bolt from a bastion |
| T06 | Castle fire and char: wooden roofs, hoardings, workshop, stables burn and become ruins; stone pieces lose their roof part and turn charred but stay solid; archers on a burned-out tower die; rebuild after `fire.rebuild` | T05 | M | Tests: a stone piece never becomes a non-solid ruin, char state saved with ruins, rebuild restores colour and roof. **Feel checkpoint for Pavel on a phone**: a Drake raids the castle, burns roofs, survives the defenders and the castle still looks like a castle afterwards |
| T07 | `core/map.js` exploration grid + `render/map-view.js` map screen (world view, region view with the terrain image, fog, icons, dragon arrow, pan / zoom); map button on touch, Tab on desktop | T04 | L | Tests: cells explored around the dragon scale with stage and altitude, model lists only discovered places, locked regions report their stage; on a phone the map opens and closes, pinch and drag work, icons are at least 36 px to tap, the map never shows an undiscovered place, the Bend's river shape is recognisable on the map; terrain image drawn once per region (under 150 ms on a mid laptop) |
| T08 | `core/aerie.js` + `render/aerie-view.js`: aeries in Wildwood, the Farmlands and the Bend, discovery, enter, bank loot, Rest (save, heal), Leave; aeries on the compass and the map | T07 | M | Tests: banking at an aerie, death after banking keeps the gold, rest saves; on a phone a Drake finds the Troja aerie, flies in, banks a strongbox and leaves |
| T09 | Map stone station in the cave + fast travel: lair <-> discovered aeries, fade and region swap, blocked with an active mission or mission loot (says why) | T08 | S | Tests: `canTravel` rules; on a phone the map stone opens the map in travel mode and "Fly there" lands the dragon in front of the aerie; travel back to the lair from the aerie |
| T10 | `core/missions.js`: catalogue, states, timer start / pause rules, objective events, success / fail, time bonus, retry after rest; debug buttons to accept, finish and fail a mission | T08 | M | Tests: timer starts on leaving the lair region or an aerie, pauses during loading and inside, timeout fails and loses mission loot only, death fails, bonus math, retry needs a rest, region heat +1 on fail |
| T11 | Mission board station + briefing panel + mission HUD (timer, objective line, gold target marker on the compass and the map) | T10 | M | On a phone: walk to the board, read a briefing, accept, the timer appears when leaving the cave, turns amber at 60 s and red at 20 s; at 390 x 844 the timer does not cover the compass, bars or buttons |
| T12 | `core/relics.js` + trophy wall station: relic loot kind with carry rules, lost on death or timeout, banked relic shown in its niche | T10 | S | Tests: speed x0.8 and no breath while carrying a relic; relic lost on death; trophy wall shows the banked chalice |
| T13 | Steal mission: Ember Chalice in the twin-spired chapel; pick up inside the chapel door area after landing in the courtyard; escape to the Troja aerie or the lair | T06, T11, T12 | M | Mission bot (seeded) completes it in its time band on average; on a phone the full flow from board to banked chalice works and the trophy wall shows it |
| T14 | Destroy mission: the castle siege workshop; burning it to a ruin is the objective, then fly to an aerie or the lair | T06, T11 | S | Mission bot completes it in its time band; the workshop stays a ruin until the mission is over even if `fire.rebuild` passes |
| T15 | `core/caravan.js` + `render/caravan-view.js` + intercept mission: a tithe wagon with oxen and 3 escort archers drives from the Hradčany side across the stone bridge and along the east bank to the castle gate; stop it, take the chest, bank it | T11 | M | Tests: wagon follows the road and the bridge deck, stops at 0 hp, drops the chest, reaching the gate fails the mission; mission bot completes it in its time band; on a phone the wagon is easy to find with the gold compass marker |
| T16 | Freed village + tribute (Farmlands village): freeing rule, falling Order flag, no Order rebuild or archers, peasants calm, food tribute in the larder; freed state on the map | T10 | M | Tests: freed only when all Order buildings are ruins and the archers dead; tribute every `tribute.every` s up to `max`; freed state survives a reload |
| T17 | `core/story.js` + `render/story-card.js`: Act 1 and Act 2 cards, briefings and outcome lines for the three missions, the mother on the first castle mission and her line over the burned city, EN + CS | T13, T14, T15 | M | Each card shows once; Skip / Continue work on a phone; the mother joins the first castle mission and stays out of the danger zones (test) |
| T18 | Save v3 + migration v2 -> v3: missions, relics, aeries, freed villages, explored cells (bitset), castle gate and char state, story | T16, T17 | M | Reload restores all of it, also a dragon saved in the Bend; a v2 save migrates; corrupt v3 handled like v2; the save stays under 32 KB with every region fully explored |
| T19 | Texts and tips (castle, the Bend, map, aeries, fast travel, mission board, timer, relics, freed village; touch wording pass) + `test/mission.bot.test.js` mission bot for the three missions + balancing pass (mission times, castle defender numbers, rewards) | T18 | M | Every new visible string from `i18n.js` in EN and CS; touch texts name buttons; seeded bot: each mission succeeds within 5-10 min on average, with at least 20% HP left at full hunger start; numbers changed in `data.js` only |
| T20 | README campaign section update (the Bend, castle, map, aeries, missions), controls table, mark Phase 3 done in `000_spec.md` | T19 | S | README lists the Vltava Bend, the castle, the map, fast travel, the mission board and the three missions for phone and desktop |

## 8. Testing

| Level | What | How |
| --- | --- | --- |
| Unit | new terrain features and the Bend's shape, castle layout and solids, walk tops, gate, map exploration and model, fast travel rules, aeries, missions (timer, states, rewards), relics, caravan, freed village, tribute, story, save v3 | `node campaign/test/run.js`, seeded `mulberry` RNG |
| Simulation | Mission bot for steal, destroy and intercept; invariants (timer never negative, mission loot never banked after a fail, dragon never inside a castle solid, projectiles bounded) | `test/mission.bot.test.js` |
| Visual | Fixed camera screenshots of the castle (preview and in game) by day and night, the Bend from high above, the map screen at 390 x 844 | Browser check of each visual task; screenshots stay in the scratchpad |
| Regression | Phase 1 and 2 tests (growth sim, raid bot) still pass; duel and co-op unaffected | both test runs |
| Manual | Phone first: castle look (T01), the Bend (T02), castle raid (T06), map, aerie, fast travel, each mission, freed village, reload; then desktop | Checklist in each PR, phone steps first |

## 9. Performance budget

| Metric | Budget |
| --- | --- |
| Frame rate | 30+ fps on a mid phone at the castle under fire (mid tier), 50+ fps on a mid laptop |
| Draw calls | castle under 24 (high), the Bend under 300 in total |
| Triangles | castle under 70k high / 35k low; silhouette under 2k |
| Lights | no new real lights: torches and windows are emissive; the 2 fire lights of Phase 2 stay the limit |
| Defenders | 45 active max in the Bend (the castle has about 14), full AI within 400, 4 Hz beyond |
| Region load | the Bend under 1.5 s on a mid laptop |
| Map | terrain image built once per region and cached; map screen open = region scene paused, 60 fps on a phone |
| Save | under 32 KB |
| New JS | under 190 KB unminified for this phase |

## 10. Risks

| Risk | Mitigation |
| --- | --- |
| The castle looks like grey boxes | Preview page first (T01) with Pavel's approval before anything builds on it; silhouette rules (tall keep, twin spires, varied tower heights, roofs, banners, the cliff), weathering in vertex colour, night lights |
| The river shape does not read as Prague | Coordinates from real lon / lat (4.2), low base noise, a wide flat valley; Pavel checks the high view and the map in T02 / T07; a mirrored map is caught by `bend.test.js` |
| A castle plus a bigger region cost too much on a phone | Instanced kit, LOD silhouette, no real lights, quality tiers; draw call and triangle readout in the preview and the DBG panel; ruins and bridge as instanced pieces |
| Walking on walls and landing in a small courtyard feel fiddly | Wide wall walks (landable band), courtyard sized for a Drake; Pavel checks in T06 |
| A closed gate traps a dragon inside | The courtyard is open to the sky: takeoff always works; the gate never closes on the dragon (it waits while the dragon is in the gap) |
| The map shows too much and kills exploration | Fog of war from real flight; only discovered places; no prey on the map |
| Fast travel makes missions trivial | No fast travel with a mission active or mission loot carried |
| The Bend is far from the lair, so missions run out of time | Timer starts on leaving the lair region or an aerie; the Troja aerie lets missions end close to the castle; times tuned in T19 |
| The intercept wagon is hard to find on a phone | Gold mission marker on the compass and the map ring; the route is the visible road and the bridge |
| Save grows with explored cells | Bitset per region (48 x 48 bits = 288 bytes, base64) |

## 11. Open design questions (recommended defaults)

1. Names: region "Vltava Bend" and castle "Vyšehrad Castle", or fantasy names for both in the game (Prague only as the model)? Default: keep the real names, the Czech version reads naturally.
2. The burned old city: the King's city that the mother burned years ago (ruins in this phase, ties into the backstory), with a ruined old royal castle on the Hradčany ridge (default)? Or a living Order town (towns are a later phase)?
3. The Capital (Phase 6): the Hradčany ridge rebuilt by the Order as its seat, in a later region further along the Vltava (default), or a separate place?
4. Can the dragon break stone walls? Default: not in Phase 3: wood burns, stone chars; breaching comes with the Wyrm in Phase 4.
5. Landing inside the castle: courtyard, wall walks and bastion tops landable, keep, spire and tower roofs not (default)?
6. Map outside the cave: open anywhere (read only), fast travel only at the map stone or an aerie (default)?
7. Fast travel during a mission: not allowed (default), or allowed with a time cost?
8. Mission timer inside the lair or an aerie: does not run (default; resolves the open question in `000_spec.md` section 10)?
9. The mother on the first castle raid: she flies along and comments, but does not fight (default)?
10. Map style: parchment-style drawn map (default) or a clean top-down satellite view?
