# Phase 3 - Castle, Map + Missions: Implementation Spec

Status: draft, 2026-10-31. Refines `000_spec.md` for Phase 3. Built on `campaign-phase-3` (branched from the finished `campaign-phase-2`). Task branches are `agent/t2NN-...` (T01 -> `t201`).

Revised by Pavel, 2026-10-31: **visual form comes first**. The phase opens with the first Order castle (Harrowmere Castle in the River Farmlands) as a showpiece, before the mission systems. The map screen stays in this phase and becomes a drawn, explorable map, not only a region graph.

## 1. Goal

The dragon gets a real enemy stronghold to look at and to raid, a map to find its way around the world and its first timed missions. A Drake sees Harrowmere Castle on its hill from far across the Farmlands, flies over its walls under archer and ballista fire, burns its wooden roofs, steals the Ember Chalice from its chapel against the clock and banks it in an aerie. The cave gets the mission board, the trophy wall and the map stone.

The phase starts with the castle block (look first, checked by Pavel on a phone), then the map and aeries, then missions, story cards and the freed village.

**Exit criteria**

- On a phone, Harrowmere Castle reads as a castle from at least 600 units away (silhouette with walls, towers, keep, banners) and is the strongest image of the Farmlands, by day and by night (torches, lit windows).
- A Drake lands in the castle courtyard or on a wall walk, walks between the buildings, and the castle fights back (archers on towers and walls, ballistae on the corner towers, the gate closes on alarm); wooden roofs burn, stone stays standing but charred.
- The map screen shows the world with discovered regions, settlements, the castle, aeries, the lair and the dragon; unexplored ground stays fogged until the dragon has flown over it.
- Fast travel from the map stone in the cave to a discovered aerie and back works.
- Three missions (steal, destroy, intercept) can each be completed in 5-10 minutes; death and timeout rules work as specified in `000_spec.md` section 6.
- Destroying the Order garrison of the Farmlands village frees it: its Order flag falls and it sends food tribute to the larder.
- Act 1 and Act 2 cards, mission briefings and outcomes appear in EN and CS.
- A save (v3) survives a reload, and a v2 save migrates without loss.

### In scope

| Area | Phase 3 content |
| --- | --- |
| Castle | Harrowmere Castle in the River Farmlands: castle hill, curtain walls with crenellations and wall walks, 4 corner towers, gatehouse with portcullis, keep, chapel, great hall, siege workshop, stables, well; banners; a road with a stone bridge over the river to the gate |
| Castle look | Modular castle kit (`render/castle-kit.js`), standalone preview page first, LOD (full model near, silhouette far), torches and lit windows at night, smoke from chimneys, waving banners, charred stone after fire |
| Castle play | Solids for walls, towers and buildings; landing allowed in the courtyard and on wall walks; archers on towers and wall walks, ballistae on corner towers, gate closes on alarm, castle horn alerts the region |
| Map | Map screen with a drawn world view (regions around the volcano) and a region view (top-down terrain image with rivers, roads, fields, places); fog of war from exploration; markers for lair, aeries, settlements, castle, mission target, dragon |
| Aeries | One small cliff cave per region outside the Ash Wastes (Wildwood, Farmlands): discover, bank loot, end missions, rest |
| Fast travel | Map stone station in the cave; from the lair to a discovered aerie and from an aerie to the lair |
| Missions | `core/missions.js`: catalogue in data, accept at the board, timer, objectives, success / fail, time bonus, retry after rest |
| Mission types | Steal (Ember Chalice from the castle chapel), destroy (castle siege workshop), intercept (tithe caravan on the Farmlands road) |
| Relics | Relic items with mission carry rules (speed -20%, no breath), lost on death or timeout, shown on the trophy wall |
| Cave stations | Mission board, trophy wall, map stone |
| Freed village | Destroying the village's Order garrison (tax house, tower and its archers) frees it; food tribute to the larder |
| Story | Act 1 and Act 2 cards, mission briefings (2-4 lines) and one-line outcomes; the mother flies with the Drake on its first castle raid |
| Save | v3 with missions, relics, aeries, freed villages, explored map cells, castle state; v2 -> v3 migration |
| UI | Mission timer (amber at 60 s, red at 20 s), mission target on the compass and the map, map button, EN + CS texts |

### Out of scope (later phases)

Renown (Phase 4; tribute in this phase depends only on the village being freed), knights, nets, frost mages, mangonels (Phases 4-5), breaching stone walls (Phase 4, Wyrm), hunt / rescue / defend / boss missions, alert 4-5, slayers, lair defense, the mother's death scene (Phase 4), the Highland Pass, towns, more castles (the Royal Lowlands castles reuse the kit in Phase 5).

## 2. Constraints from the current code

| Fact | Consequence for Phase 3 |
| --- | --- |
| Settlements are templates of single round buildings plus an optional round palisade (`data.settlements`, `settlement.build`) | The castle is a settlement type with a `walls` polygon (wall segments between towers) and a gate, not a `ring`; segments become capsule solids like palisade pieces, but taller and with a walkable top |
| `settlement.solidAt` gives one roof height; landing on a roof is refused with 'roof' | Buildings get a `walkTop` flag: a wall walk and the courtyard are landable and walkable, keep and tower roofs stay refused. The wall top is a solid the dragon can stand on (`walk.step` already takes ground from `ctx.surface`) |
| Buildings render as one vertex-coloured `InstancedMesh` per type (about 11 draw calls) | The castle kit follows the same pattern: one geometry per piece type, instanced; the whole castle stays under 20 draw calls on the high tier |
| Fire turns a building into rubble (`ruins`) | Castle stone pieces have `stone: true`: fire burns their wooden parts (roof, hoardings) and leaves a charred stone shell that is still a solid; archers on a burned-out tower die as before |
| Defender posts are tied to building types (`tower` = archer, `platform` = ballista) | Castle towers and wall segments get post lists (`posts: [{ kind, at }]`), so several archers stand on one wall; the corner towers carry a ballista on top |
| The bell alerts one settlement; `alert.js` keeps heat per region | The castle horn is a bell with `range` covering the whole region: all settlements of the Farmlands go to alert when it sounds |
| Farmlands terrain features are road, river, plateau | A new `hill` feature (raised plateau with sloped flanks and an optional ramp along the road) holds the castle; a `bridge` feature on the road makes a dry deck over the river (the T11 ford limitation goes away) |
| `nav.markers` gives compass markers; discovery is per settlement (`cs.discovered`) | The map reads the same discovered set, plus explored cells (`cs.explored`, a coarse grid per region); the castle and aeries are discoverable places |
| The cave has reserved positions: trophy [-40, 20], board [40, 20], mapStone [0, 30] (`data.cave.stations` comment) | The three new stations use them; station panels and the Action slot work as in Phase 2 |
| Loot (`core/loot.js`): one carried item in the claws, banked on lair enter, lost on death | Relics are loot kinds with `mission: true`; banking also happens at an aerie; timeout loses mission loot only |
| Region change = full scene swap (`region.enter`) | Fast travel is a region change with a fade and a fixed entry point (the aerie mouth or the lair mouth) |
| Save v2 (`core/save.js`, `migrate` chain) | v3 adds `missions`, `hoard.relics`, `regions.<id>.aerieFound`, `regions.<id>.freed`, `regions.<id>.explored`, `story.act`, `story.seen`; v2 -> v3 step |
| The headless check renders at 2-8 fps in software | Visual tasks end with screenshots from fixed camera views (listed per task) plus a phone check by Pavel (feel checkpoints T01 and T05) |

## 3. File structure

New files (existing ones extended where noted):

```
campaign/
  preview/
    castle.html         standalone castle preview: orbit / touch drag + pinch, day / night, quality tier, LOD toggle
  core/
    castle.js           castle layout from data: wall polygon -> segments, gate, towers, inner buildings, walk tops, posts
    map.js              explored grid, map model (regions, places, markers), fast travel rules
    aerie.js            aerie sites, discovery, enter / leave, bank, rest
    missions.js         catalogue, accept, timer, objectives, success / fail, rewards, retry
    relics.js           relic catalogue, carry rules, trophy wall data
    caravan.js          wagon + escort moving along a road, stop, loot drop
    story.js            act cards, briefings, outcomes, seen flags
    (data.js, terrain.js, settlement.js, defenders.js, alert.js, loot.js, cave.js, nav.js, region.js, state.js,
     save.js, tips.js extended)
  render/
    castle-kit.js       castle piece geometries (wall segment, wall corner, round tower, square tower, gatehouse,
                        portcullis, keep, chapel, hall, workshop, stables, well, hoardings, banners, torches)
    castle-view.js      instanced castle in the region, LOD, night lights, banner wave, chimney smoke, char
    map-view.js         map screen: world view, region view (terrain image), fog, markers, pan / zoom
    aerie-view.js       aerie cliff mouth outside, small cave inside
    caravan-view.js     wagon, oxen, escort
    mission-hud.js      timer, objective line, target marker hand-off to compass and map
    story-card.js       act cards and mission briefing / outcome cards
  test/
    castle.test.js  map.test.js  aerie.test.js  missions.test.js  relics.test.js  caravan.test.js
    freed.test.js  story.test.js  save3.test.js  mission.bot.test.js
```

Script order in `campaign/index.html`: Phase 2 order with `castle` after `settlement`, `relics` after `loot`, `caravan` after `defenders`, `aerie, map, missions, story` after `nav`.

## 4. Data schemas (`core/data.js`)

All numbers are starting values for tuning. `version` becomes 3.

### 4.1 Castle

```js
buildings: {
  // existing types stay; castle pieces:
  wall:      { r: 0, h: 11, hp: 400, order: true, wall: true, stone: true, walkTop: 9.5, posts: 'archer' },
  ctower:    { r: 6, h: 20, hp: 300, order: true, stone: true, post: 'archer', calmsAlert: true },
  btower:    { r: 7, h: 22, hp: 320, order: true, stone: true, post: 'ballista' },      // corner tower with a ballista
  gatehouse: { r: 8, h: 16, hp: 360, order: true, stone: true, gate: true, posts: 'archer' },
  keep:      { r: 11, h: 30, hp: 500, order: true, stone: true, garrison: 4, horn: true },
  chapel:    { r: 7, h: 14, hp: 160, order: true, stone: true, loot: ['relic'] },
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
  lod: { near: 260, far: 900 },                     // full model inside `near`, silhouette mesh up to `far` (fog beyond)
  lights: { torches: 12, windows: true },           // night: emissive torch sprites + window emissive, no extra real lights
},
settlements: {
  castle: {
    walls: [[-34, -28], [34, -28], [38, 26], [8, 34], [-8, 34], [-38, 26]],   // polygon, local, gate gap between the last two
    corners: ['btower', 'ctower', 'btower', 'gatehouse', 'gatehouse', 'ctower'],
    buildings: [['keep', 0, -10], ['chapel', -20, 6], ['hall', 18, 4], ['workshop', 22, -16], ['stables', -22, -16], ['well', 0, 14]],
    archers: 8, peasants: 4,
  },
},
regions.farm.terrain.features += [
  { type: 'hill', x: -480, z: 380, r: 70, h: 24, flank: 50 },                           // castle hill
  { type: 'road', points: [[0, -300], [-250, 15], [-430, 300], [-470, 340]], width: 7 }, // branch road to the gate
  { type: 'bridge', at: [-250, 15], len: 40, width: 9 },                                // dry deck over the river
],
regions.farm.settlements += [{ type: 'castle', x: -480, z: 380, yaw: 2.6, name: 'harrowmere' }],
```

### 4.2 Map and exploration

```js
map: {
  cell: 50,                     // explored grid cell size; a region of radius 1100 has 44 x 44 cells
  reveal: 160,                  // cells within this distance of the dragon (x stage spot ^ 0.5) become explored
  revealAlt: 1.5,               // x this range when flying above `ceiling` * 0.6
  image: 256,                   // region view terrain image resolution (px), drawn once per region and cached
  world: { ash: [0, 0], wild: [0, 1], farm: [0.9, 1.7], pass: [-0.9, 1.7], low: [0, 2.6], capital: [0, 3.4] }, // world view layout
  zoom: [1, 4],
},
```

### 4.3 Aeries

```js
aeries: {
  wild: { x: -620, z: -480, facing: 1.9 },
  farm: { x: 720, z: 560, facing: -2.4 },
  discover: 200, enterRange: 40, room: { r: 22, h: 14 },
},
```

### 4.4 Missions and relics

```js
missions: [
  { id: 'a2_chalice',  type: 'steal',     act: 2, minStage: 1, region: 'farm', target: 'farm.castle.chapel1',
    relic: 'ember_chalice', time: 420, reward: { gold: 250 } },
  { id: 'a2_workshop', type: 'destroy',   act: 2, minStage: 1, region: 'farm', target: 'farm.castle.workshop1',
    time: 360, reward: { gold: 200 } },
  { id: 'a2_caravan',  type: 'intercept', act: 2, minStage: 1, region: 'farm', caravan: 'tithe', time: 330,
    reward: { gold: 300 } },
],
mission: { bonusPer: 5, bonus: 0.01, warn: 60, danger: 20, retryAfter: 'rest', alertOnFail: 1 },
relics: {
  ember_chalice: { nameKey: 'c.relic.chalice', weight: 1, trophy: [-40, 20, 0] },
},
loot: { relic: { carry: { speed: 0.8, breath: false }, mission: true } },
caravan: {
  tithe: { road: 0, from: 0.05, to: 0.75, speed: 7, wagons: 1, escort: 3, chest: 'strongbox', wagonHp: 120 },
},
tribute: { every: 300, food: 40, max: 3 },          // a freed village leaves food in the larder every `every` s of play
story: { acts: [1, 2], cards: ['act1', 'act2'], firstRaidMother: true },
```

## 5. System interfaces (`core/`)

### 5.1 `castle`

- `castle.layout(site)` -> `{ segments: [{ a, b, h, walkTop }], corners: [...], gate: { a, b }, buildings: [...] }` from the polygon (pure, tested).
- `settlement.build` calls it for a site with `walls`; segments become solids (capsules of `wallThick`), corners and buildings are cylinders; the gate gap is open unless `gateClosed`.
- `settlement.surfaceAt(town, x, z)` returns a walkable top (wall walk band, gatehouse top) or `null`; `walk.canLand` and `walk.step` use it before the terrain.
- `castle.closeGate(town)` / `openGate(town)`: driven by the castle's alarm and search end; a closed gate is a solid.

### 5.2 `map`

- `map.step(cs, dt)`: marks cells explored around the dragon (reveal radius x stage factor x altitude factor), at most 4 Hz.
- `map.model(cs)` -> `{ regions: [{ id, known, locked, alert }], places: [{ id, kind, x, z, discovered, alert, freed }], dragon, target }` for the renderer (pure, tested).
- `map.canTravel(cs, from, to)` -> `{ ok, why }`: only from the lair map stone or an aerie, only to a discovered aerie or the lair, not with a mission active and not with mission loot in the claws.
- `map.travel(cs, to)`: region change to the aerie or lair mouth (fade), emits `travel:done`.

### 5.3 `aerie`

- `aerie.discover(cs)`: within `discover` and in line of sight (same check as settlements) -> `aerie:found`.
- Flying into an aerie mouth: banks carried loot (as the lair does), completes a mission whose objective is done, offers Rest (save, heal, no stage-up; stage-up stays at the nest), Fast travel to the lair, Leave. The aerie interior is a small cave scene reusing `cave.js` with its own room data.

### 5.4 `missions` and `relics`

- States: `offered` -> `accepted` (at the board) -> `running` (timer starts when the dragon leaves the lair region or an aerie with the mission accepted) -> `done` (objective met) -> `success` (delivered to the lair or an aerie before 0) or `failed` (timeout, death).
- `missions.step(cs, dt)`: timer, objective checks through events (`loot:taken` of the relic, `building:ruined` of the target, `caravan:stopped` + chest taken), fail on 0 or `dragon:died`; the timer pauses during region loading and does not run inside the lair or an aerie (open question 3).
- Rewards: gold + `bonus` per `bonusPer` s left; relics go to `hoard.relics` and the trophy wall. Fail: mission loot vanishes, region heat + `alertOnFail`, retry after the next rest.
- `relics.carry(cs)` applies `loot.relic.carry` while a relic is in the claws.

### 5.5 `caravan`

- Spawned when the intercept mission starts: wagon(s) move along road `road` from `from` to `to` (fractions of the polyline) with escort archers walking beside them; `caravan.step` moves, the escort uses the defender AI.
- Burning the wagon's oxen or the wagon to 0 hp stops it and drops the chest (`strongbox`) next to it; reaching `to` ends the mission as failed.

### 5.6 Freed village

- A settlement with `order` buildings is freed when every `order` building is a ruin and its archers are dead at the same time: `settlement:freed`, saved in `regions.<id>.freed`; an Order flag mesh falls; freed buildings are not rebuilt as Order buildings, no archers spawn there, peasants stop ringing the bell at the dragon.
- Tribute: while freed, every `tribute.every` s of play a carcass (`tribute.food`) appears in the larder, at most `tribute.max` waiting.

### 5.7 `story`

- `story.act(cs)`: Act 1 until Drake, Act 2 from Drake (Act 3 starts in Phase 4). Shows an act card once (`story.seen`).
- Briefing card on accepting a mission, outcome line on success or fail; the mother flies with the Drake on its first castle mission (`firstRaidMother`), keeps out of the danger zones and leaves when the mission ends.

### 5.8 `save` v3

```json
{
  "version": 3,
  "hoard": { "gold": 1240, "relics": ["ember_chalice"] },
  "missions": { "completed": ["a2_chalice"], "active": null, "failedAt": {} },
  "regions": { "farm": { "aerieFound": true, "freed": ["farm.village"], "explored": "<base64 bitset>", "gate": "open" } },
  "story": { "act": 2, "seen": ["act1", "act2", "brief.a2_chalice"] }
}
```

v2 -> v3: empty missions, no relics, nothing explored except the cells around discovered places, `story.act` from the stage.

## 6. Rendering and UI

| Element | Implementation |
| --- | --- |
| Castle kit | Low-poly pieces from primitives, vertex colours (limestone walls, darker plinth, slate and lead roofs, timber hoardings, Order red banners with a gold lance), crenellations as merged boxes, arrow slits as dark inset quads, a weathering gradient in vertex colour (darker at the base, moss green near the ground). One geometry per piece type, instanced |
| Castle LOD | Inside `lod.near` the full kit; out to `lod.far` one merged silhouette mesh (under 2k triangles) so the castle on its hill shows across the region; fog beyond |
| Night | Torches as additive sprites on the walls and gate (no real lights), window quads with emissive colour that only show at dusk and night; the keep is the brightest point of the Farmlands at night |
| Life | Banners wave (vertex shader offset in the banner geometry, one uniform), chimney smoke from the hall (shared smoke pool), a slow flag on the keep; after alarm a red signal fire on the keep top |
| Fire and char | Wooden roofs and hoardings burn with the Phase 2 flame pool; a burned stone piece swaps its instance colour to `char.tint` and loses its roof part (separate instanced roof mesh, hidden when burned) |
| Bridge and road | Stone bridge mesh (3 arches) on the `bridge` feature; the branch road painted like the main road |
| Map screen | Full screen panel: world view (painted region shapes around the volcano, names, locks with the stage needed, alert colour) and region view (the terrain image from heights + palette with rivers, roads, fields; settlements, castle, aeries, lair as icons; dragon arrow; mission target ring); fog = dark parchment over unexplored cells; pinch to zoom, drag to pan; tap an icon for its name; Close button. Opened by a map button next to pause (touch) or Tab (desktop; M stays the mother's debug key) |
| Map stone | Station panel with the map in travel mode: discovered aeries and the lair are tappable with "Fly there" |
| Mission board | Wooden board with parchment notes in the cave; panel lists missions (locked ones greyed with the reason), briefing, time limit, reward, Accept |
| Trophy wall | Rock wall with niches; each recovered relic sits in its niche with a glow; panel names it and its story line |
| Mission HUD | Timer under the compass, centred, 28 px; amber at 60 s, red and pulsing at 20 s; one objective line; mission target marker on the compass in gold |
| Story cards | Act cards: full screen illustration-style panel (drawn with the game's own render of the castle / lair) with 2-4 lines and Continue; briefings as a bottom sheet over the board panel |
| Aerie | Outside: a dark cleft in a cliff with a ledge and bones; inside: a small round cave with a nest of branches |

## 7. Task breakdown

Each task ends with both test runs passing and the browser check from the agent prompt. Visual tasks also save screenshots from the fixed views named in the row. Sizes: S < 2 h, M 2-5 h, L 5-10 h of AI-assisted work.

| ID | Task | Depends on | Size | Acceptance |
| --- | --- | --- | --- | --- |
| T01 | Castle kit + preview page: `render/castle-kit.js` (all pieces of section 6) and `campaign/preview/castle.html` showing Harrowmere from `data.settlements.castle` with orbit camera (touch drag, pinch), day / dusk / night switch, quality tier switch, LOD switch, draw call and triangle readout | - | L | **Feel checkpoint for Pavel on a phone** (the look is approved before the castle goes into the game). Preview runs at 390 x 844 with no page errors; full castle under 20 draw calls and under 60k triangles on high, 30k on low; silhouette under 2k; screenshots: front at the gate, three-quarter from above, courtyard, night |
| T02 | `core/castle.js` + terrain `hill`, `bridge` features + branch road; castle settlement type with wall polygon, gate, walk tops, solids; landing in the courtyard and on wall walks | T01 | L | Tests: layout from the polygon, solids block walking and flying, wall walk landable, keep roof refused ('roof'), gate gap walkable when open and solid when closed, bridge deck dry (landing allowed, not water). The castle hill keeps every footprint flat |
| T03 | Castle in the Farmlands: `render/castle-view.js` with LOD, night torches and windows, banners, chimney smoke, stone bridge; castle discovery with its own compass icon; visible from the Wildwood exit | T02 | M | Region load stays under 1.5 s on a mid laptop; Farmlands under 300 draw calls; the castle is visible from the Farmlands entry at 600+ units; no geometry leak after 5 round trips; screenshots: from the entry, from the bridge, night over the walls |
| T04 | Castle defenders: archers on towers, wall walks and the gatehouse (post lists), ballistae on the corner towers, gate closes on alarm and opens after the search, the keep's horn alerts every settlement of the region, signal fire | T03 | M | Tests: post placement on walls, horn alerts the whole region once per `horn.cool`, gate state follows the alarm; in game a low pass along the wall draws volleys from the wall walk and a ballista bolt from a corner tower |
| T05 | Castle fire and char: wooden roofs, hoardings, workshop, stables burn and become ruins; stone pieces lose their roof part and turn charred but stay solid; archers on a burned-out tower die; rebuild after `fire.rebuild` | T04 | M | Tests: a stone piece never becomes a non-solid ruin, char state saved with ruins, rebuild restores colour and roof. **Feel checkpoint for Pavel on a phone**: a Drake raids the castle, burns roofs, survives the defenders and the castle still looks like a castle afterwards |
| T06 | `core/map.js` exploration grid + `render/map-view.js` map screen (world view, region view with the terrain image, fog, icons, dragon arrow, pan / zoom); map button on touch, Tab on desktop | T03 | L | Tests: cells explored around the dragon scale with stage and altitude, model lists only discovered places, locked regions report their stage; on a phone the map opens and closes, pinch and drag work, icons are at least 36 px to tap, the map never shows an undiscovered place; terrain image drawn once per region (under 150 ms on a mid laptop) |
| T07 | `core/aerie.js` + `render/aerie-view.js`: aeries in Wildwood and the Farmlands, discovery, enter, bank loot, Rest (save, heal), Leave; aeries on the compass and the map | T06 | M | Tests: banking at an aerie, death after banking keeps the gold, rest saves; on a phone a Drake finds the Farmlands aerie, flies in, banks a strongbox and leaves |
| T08 | Map stone station in the cave + fast travel: lair <-> discovered aeries, fade and region swap, blocked with an active mission or mission loot (says why) | T07 | S | Tests: `canTravel` rules; on a phone the map stone opens the map in travel mode and "Fly there" lands the dragon in front of the aerie; travel back to the lair from the aerie |
| T09 | `core/missions.js`: catalogue, states, timer start / pause rules, objective events, success / fail, time bonus, retry after rest; debug buttons to accept, finish and fail a mission | T07 | M | Tests: timer starts on leaving the lair region or an aerie, pauses during loading and inside, timeout fails and loses mission loot only, death fails, bonus math, retry needs a rest, region heat +1 on fail |
| T10 | Mission board station + briefing panel + mission HUD (timer, objective line, gold target marker on the compass and the map) | T09 | M | On a phone: walk to the board, read a briefing, accept, the timer appears when leaving the cave, turns amber at 60 s and red at 20 s; at 390 x 844 the timer does not cover the compass, bars or buttons |
| T11 | `core/relics.js` + trophy wall station: relic loot kind with carry rules, lost on death or timeout, banked relic shown in its niche | T09 | S | Tests: speed x0.8 and no breath while carrying a relic; relic lost on death; trophy wall shows the banked chalice |
| T12 | Steal mission: Ember Chalice in the castle chapel; pick up inside the chapel door area after landing in the courtyard; escape to an aerie or the lair | T05, T10, T11 | M | Mission bot (seeded) completes it in 5-10 simulated min on average; on a phone the full flow from board to banked chalice works and the trophy wall shows it |
| T13 | Destroy mission: the castle siege workshop; burning it to a ruin is the objective, then fly to an aerie or the lair | T05, T10 | S | Mission bot completes it in 5-7 simulated min; the workshop stays a ruin until the mission is over even if `fire.rebuild` passes |
| T14 | `core/caravan.js` + `render/caravan-view.js` + intercept mission: a tithe wagon with oxen and 3 escort archers drives from the Wildwood side of the road to the castle; stop it, take the chest, bank it | T10 | M | Tests: wagon follows the road, stops at 0 hp, drops the chest, reaching the castle fails the mission; mission bot completes it in 5-6 simulated min; on a phone the wagon is easy to find with the gold compass marker |
| T15 | Freed village + tribute: freeing rule, falling Order flag, no Order rebuild or archers, peasants calm, food tribute in the larder; freed state on the map | T09 | M | Tests: freed only when all Order buildings are ruins and the archers dead; tribute every `tribute.every` s up to `max`; freed state survives a reload |
| T16 | `core/story.js` + `render/story-card.js`: Act 1 and Act 2 cards, briefings and outcome lines for the three missions, the mother on the first castle mission, EN + CS | T12, T13, T14 | M | Each card shows once; Skip / Continue work on a phone; the mother joins the first castle mission and stays out of the danger zones (test) |
| T17 | Save v3 + migration v2 -> v3: missions, relics, aeries, freed villages, explored cells (bitset), castle gate and char state, story | T15, T16 | M | Reload restores all of it; a v2 save migrates; corrupt v3 handled like v2; the save stays under 32 KB with the Farmlands fully explored |
| T18 | Texts and tips: castle, map, aeries, fast travel, mission board, timer, relics, freed village; touch wording pass | T17 | S | Every new visible string from `i18n.js` in EN and CS; touch texts name buttons; every Phase 3 flow playable on a phone end to end |
| T19 | `test/mission.bot.test.js` mission bot for the three missions + balancing pass (mission times, castle defender numbers, rewards) | T17 | M | Seeded bot: each mission succeeds in its time band on average, with at least 20% HP left at full hunger start; numbers changed in `data.js` only |
| T20 | README campaign section update (castle, map, aeries, missions), controls table, mark Phase 3 done in `000_spec.md` | T19 | S | README lists the castle, the map, fast travel, the mission board and the three missions for phone and desktop |

## 8. Testing

| Level | What | How |
| --- | --- | --- |
| Unit | castle layout and solids, walk tops, gate, map exploration and model, fast travel rules, aeries, missions (timer, states, rewards), relics, caravan, freed village, tribute, story, save v3 | `node campaign/test/run.js`, seeded `mulberry` RNG |
| Simulation | Mission bot for steal, destroy and intercept; invariants (timer never negative, mission loot never banked after a fail, dragon never inside a castle solid, projectiles bounded) | `test/mission.bot.test.js` |
| Visual | Fixed camera screenshots of the castle (preview and in game) by day and night, the map screen at 390 x 844 | Browser check of each visual task; screenshots stay in the scratchpad |
| Regression | Phase 1 and 2 tests (growth sim, raid bot) still pass; duel and co-op unaffected | both test runs |
| Manual | Phone first: castle look (T01, T05 checkpoints), map, aerie, fast travel, each mission, freed village, reload; then desktop | Checklist in each PR, phone steps first |

## 9. Performance budget

| Metric | Budget |
| --- | --- |
| Frame rate | 30+ fps on a mid phone at the castle under fire (mid tier), 50+ fps on a mid laptop |
| Draw calls | castle under 20 (high), Farmlands under 300 in total |
| Triangles | castle under 60k high / 30k low; silhouette under 2k |
| Lights | no new real lights: torches and windows are emissive; the 2 fire lights of Phase 2 stay the limit |
| Defenders | 40 active max in the Farmlands (castle adds about 12), full AI within 400, 4 Hz beyond |
| Map | terrain image built once per region and cached; map screen open = region scene paused, 60 fps on a phone |
| Save | under 32 KB |
| New JS | under 170 KB unminified for this phase |

## 10. Risks

| Risk | Mitigation |
| --- | --- |
| The castle looks like grey boxes | Preview page first (T01) with Pavel's approval before anything builds on it; silhouette rules (tall keep, varied tower heights, roofs, banners), weathering in vertex colour, night lights |
| A castle on a phone costs too much | Instanced kit, LOD silhouette, no real lights, quality tiers; draw call and triangle readout in the preview and DBG panel |
| Walking on walls and landing in a small courtyard feel fiddly | Wide wall walks (landable band), courtyard sized for a Drake; Pavel checks in T05 |
| A closed gate traps a dragon inside | The courtyard is open to the sky: takeoff always works; the gate never closes on the dragon (it waits while the dragon is in the gap) |
| The map shows too much and kills exploration | Fog of war from real flight; only discovered places; no prey on the map |
| Fast travel makes missions trivial | No fast travel with a mission active or mission loot carried |
| The intercept wagon is hard to find on a phone | Gold mission marker on the compass and the map ring; the caravan route is the visible road |
| Missions stacked on raids make the Farmlands too hot | Missions use the castle; alert from fails +1 only; balancing in T19 |
| Save grows with explored cells | Bitset per region (44 x 44 bits = 242 bytes, base64) |

## 11. Open design questions (recommended defaults)

1. Castle site: in the River Farmlands on a hill west of the river (default), or a region of its own? Default: Farmlands, so a Drake can reach it and Act 2 has its target.
2. Castle name: Harrowmere Castle (working title)?
3. Can the dragon break stone walls? Default: not in Phase 3: wood burns, stone chars; breaching comes with the Wyrm in Phase 4.
4. Landing inside the castle: courtyard and wall walks landable, keep and tower roofs not (default)?
5. Map outside the cave: the map can be opened anywhere (read only), fast travel only at the map stone or an aerie (default)?
6. Fast travel during a mission: not allowed (default), or allowed with a time cost?
7. Mission timer inside the lair or an aerie: does not run (default; resolves the open question in `000_spec.md` section 10)?
8. The mother on the first castle raid: she flies along and comments, but does not fight (default)?
9. Map style: parchment-style drawn map (default) or a clean satellite-like top view?
