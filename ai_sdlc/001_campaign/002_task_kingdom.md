# Phase 2 - Kingdom + Hoard: Implementation Spec

Status: draft for review, 2026-10-29. Refines `000_spec.md` for Phase 2. Built on `campaign-phase-2` (branched from the finished `campaign-phase-1`). Task branches are `agent/t1NN-...` (T01 -> `t101`).

## 1. Goal

The dragon meets the kingdom. It can land and walk, find its way by compass and smell, raid Order settlements for gold, bank the gold in its walkable cave lair, buy its first upgrades and watch the region react: more archers, bells, patrols, a ballista built in the village and livestock moved inside. Lying low in the wilds calms the region down again.

The phase starts with a foundation block (touch action layout, phone performance baseline, shared dragon model, landing and walking), followed by the compass and the cave interior, because every later task in this phase depends on them.

**Exit criteria**

- On a phone, a Drake follows the compass to the River Farmlands, lands outside the Order outpost, walks in, picks up the strongbox, takes off under archer and ballista fire, carries it into the cave, watches the hoard pile grow and buys an upgrade at the altar.
- A new campaign opens with the hatching scene, and a new player learns to fly, hunt, eat and rest by following the mother dragon.
- A hungry dragon finds food by smell: the compass leads it to a herd it cannot see yet.
- A hatchling can raid the small Wildwood outpost for a tithe chest the same way (no ballista there).
- Repeated raids raise the region's alert to 3 with visible changes; about 5 minutes of quiet (hunting elsewhere or sleeping) lowers it by one level.
- Day and night change how far defenders see.
- A save (v2) survives a reload, and a phase 1 save (v1) migrates without loss.

### In scope

| Area | Phase 2 content |
| --- | --- |
| Foundation | Touch action layout (fixed + context slots, `000_spec.md` section 1), phone perf readout and quality tiers, `shared/dragon.js` used by solo and co-op too, legs and walk cycle |
| Locomotion | Land on walkable ground, walk (tank steering), run, turn on the spot, take off; collisions with buildings for walking and flying |
| Ground actions | Pick up prey and loot in front of the dragon, eat on the ground, breath on the ground |
| Cave interior | Walkable lava-lit cave hall replacing the lair panel: stations nest (rest, sleep), larder (stored carcasses visible), hoard pile, altar, exit tunnel; respawn on the nest |
| Navigation | Compass strip (lair, region exits, discovered settlements), smell markers toward herds, discovery of settlements |
| Regions | River Farmlands (new, gated at Drake, from Wildwood), a hamlet and a small Order outpost added to Wildwood |
| Settlements | Hamlet, village, Order outpost (small and full), built from building templates in data |
| Buildings | House, barn, granary, tax house, watchtower, bell post, barracks, palisade, ballista platform; burnable, ruins, rebuilt later |
| Defenders | Peasant (flees, rings the bell), archer (volleys), ballista (telegraphed bolt, crew) |
| Perception | Vision cones with line of sight, light, dragon size and altitude; hearing; awareness per defender |
| Alert | Per region, heat 0-4 shown as level 0-3, rises on incidents, decays when quiet (also while the dragon is elsewhere) |
| Livestock | Sheep and cows in pens and barns; taking them raises alert |
| Hoard | Tithe chest and strongbox as carried loot, banked on entering the lair, lost on death; 3D hoard pile of instanced coins in the cave |
| Upgrades | Altar station in the cave with 5 upgrades: prey sense, iron scales, wing muscles, hotter fire, guard sight |
| Day / night | 20 min cycle, lighting, perception factor, "Sleep until dusk / dawn" in the lair |
| Save | v2 with hoard, upgrades, region states, clock and ground pose; v1 -> v2 migration |
| Story | Hatching scene at the start of the campaign; the mother dragon flies with the hatchling and teaches it (lessons in data), through the Hatchling and Drake stages |
| UI | Alert indicator, awareness marks over defenders, aim line warning, loot in claws icon, EN + CS texts |

### Out of scope (later phases)

Renown and tribute (Renown in Phase 4, tribute when a village is freed in Phase 3), missions and the timer, relics, aeries and fast travel, the map screen, the trophy wall, mission board and map stone stations (Phase 3), story cards, knights, mages, net launchers, mangonels, slayers, alert 4-5, lair defense and lava vents (Phase 5), towns and castles, fish, Wyrm stage and the mother's death scene (Phase 4).

## 2. Constraints from the current code

| Fact | Consequence for Phase 2 |
| --- | --- |
| `core/flight.js` assumes the dragon is always airborne (`clampToRegion` with `minAlt`, floor pull-up) | Ground movement goes in a new `core/walk.js`; `pilot.mode` decides which one `state.step` runs. Flight code changes only for the landing approach |
| `shared/dragon.js` has tucked legs only and an `anim(time, dt, o)` for flight | Add leg joints and a walk / idle / land / takeoff pose to `anim`; the flight pose stays the same for the duel |
| `makeDragon` still exists in `index.html` and `mp/game.js` (phase 1 risk) | T03 switches solo and co-op to `shared/dragon.js` before the model gets legs, so all modes share one model |
| Touch buttons are fixed in `#btns` (Grab, Eat, Roll, Boost, Breath) plus a separate travel button | T01 moves to 3 fixed + 2 context slots; travel and cave entry move into the Move slot |
| Lair is a DOM panel over the outside view (`lair.js` enter / rest / eat / leave, `state.lairRest / lairEat / lairLeave`) | T10 replaces it with a walkable cave scene; the panel actions stay as the logic behind station panels, so `lair.test.js` keeps working |
| `walk.step` would read `terrain.surfaceAt` | `walk.step` takes the ground from `ctx.surface(x, z)` and solids from `ctx.solidAt`, so the same code walks in regions and in the cave |
| The HUD top row holds bars, region name and pause | The compass strip goes under it, full width minus the pause button, 28 px high on phones |
| Prey are a field per region (`core/prey.js`), never saved | Livestock are prey types with a `pen` / `barn` home; settlements and region alert are saved per region |
| `terrain.surfaceAt` is the only ground | Buildings add solids: `settlement.solidAt(x, z)` gives a roof height that flight and walking respect |
| Save v1 (`core/save.js`) has `regions: {}` and `hoard`, `upgrades` placeholders | v2 fills them; `migrate` gets a v1 -> v2 step |
| `isTouch` halves trees; no fps measurement yet | T02 adds a perf readout and quality tiers before the farm region adds load |

## 3. File structure

New files (existing ones extended where noted):

```
campaign/
  core/
    walk.js             ground movement, landing / takeoff transitions, walkable checks
    settlement.js       building templates -> placed buildings, solids, fire state, ruins, rebuild
    perception.js       sight (cone, range, light, LOS), hearing, awareness meter
    defenders.js        peasants, archers, ballistae: state machines, projectiles
    alert.js            per-region heat, levels, decay, responses
    loot.js             tithe chest / strongbox items, carry, bank, lose
    upgrades.js         upgrade catalogue, buy, effects
    clock.js            time of day, light factor, sleep to dusk / dawn
    cave.js             lair interior: floor, bounds, stations, enter / leave, station actions
    nav.js              compass markers, smell (scent markers), discovery
    (data.js, prey.js, flight.js, state.js, lair.js, region.js, save.js, terrain.js extended)
  render/
    settlement-view.js  instanced buildings, fire and smoke, ruins
    defender-view.js    defenders, arrows, bolts, aim lines, awareness marks
    sky.js              day / night lighting, sun, fog colour
    cave-view.js        cave hall mesh, lava light, nest, larder carcasses, hoard coins, altar, tunnel
    compass.js          HUD compass strip (canvas), marker icons
  test/
    walk.test.js  settlement.test.js  perception.test.js  defenders.test.js
    alert.test.js  loot.test.js  upgrades.test.js  clock.test.js  cave.test.js  nav.test.js  save2.test.js  raid.test.js
shared/
  dragon.js             legs, walk cycle; used by index.html and mp/game.js too (T03)
```

Script order in `campaign/index.html`: `umd, math, events, data, terrain, clock, growth, hunger, upgrades, settlement, flight, walk, perception, prey, defenders, alert, loot, region, lair, cave, nav, state, save`.

## 4. Data schemas (`core/data.js`)

All numbers are starting values for tuning. `version` becomes 2.

### 4.1 Locomotion

```js
land:  { maxAlt: 14, maxSpeed: 26, maxSlope: 0.45, time: 0.8, noise: 60 },   // alt above surface, slope = rise / run
walk:  { speed: 7, run: 13, back: 3, turn: 1.8, stepUp: 1.2, runSt: 12, sizeSpeed: 0.35 },  // speed x (1 + sizeSpeed x (scale - 1))
takeoff: { time: 1.0, st: 15, climb: 10, vulnerable: true },
ground: { reach: 6, reachCone: 0.7, eatTime: 2.5, breathPitch: -0.15 },        // reach x scale, in front of the head
```

- Landing is allowed when the dragon is within `land.maxAlt` of the surface, slower than `land.maxSpeed`, over ground with slope under `maxSlope`, not over water and not over a building solid.
- Walking turns on the spot (tank steering): stick up / W = forward, down / S = slow back, sides / A D = turn. Boost = run (costs stamina).
- Takeoff takes `takeoff.time` (1 s) during which the dragon cannot breathe or grab; a hit during takeoff does not cancel it.

### 4.2 Settlements and buildings

```js
buildings: {
  house:     { r: 5,  h: 7,  hp: 60,  civil: true },
  barn:      { r: 7,  h: 9,  hp: 90,  civil: true,  holds: 'livestock' },
  granary:   { r: 5,  h: 8,  hp: 70,  civil: true },
  taxhouse:  { r: 5,  h: 7,  hp: 70,  order: true, loot: ['tithe'] },
  tower:     { r: 3,  h: 16, hp: 80,  order: true, post: 'archer', calmsAlert: true },
  bell:      { r: 2,  h: 6,  hp: 30,  civil: true, bell: true },
  barracks:  { r: 7,  h: 8,  hp: 120, order: true, garrison: 2 },
  vault:     { r: 4,  h: 6,  hp: 150, order: true, loot: ['strongbox'] },
  palisade:  { r: 0,  h: 6,  hp: 40,  order: true, wall: true },               // polyline segments, len per piece
  platform:  { r: 4,  h: 4,  hp: 80,  order: true, post: 'ballista' },
},
fire: { ignite: 0.8, burn: 6, spread: 0.15, rebuild: 600 },   // s of breath to ignite, hp/s while burning, chance/s to a neighbour, s until rebuilt
settlements: {                                    // templates: offsets from the settlement centre, rotated by its yaw
  hamlet:  { buildings: [['house', -8, 0], ['house', 8, 4], ['barn', 0, -12], ['bell', 0, 10]], pens: [['sheep', 14, -10, 4]], peasants: 3 },
  village: { buildings: [/* 6 houses, barn, granary, taxhouse, tower, bell */], pens: [['sheep', 20, 0, 5], ['cow', -20, -10, 3]], peasants: 6, archers: 2,
             alert3: { platform: [12, 18] } },    // ballista platform built at alert 3
  outpostS: { buildings: [['tower', 0, 0], ['taxhouse', 6, 6], ['palisade', /* ring r 16 */]], archers: 2 },
  outpost:  { buildings: [['tower', -14, 0], ['tower', 14, 0], ['barracks', 0, -10], ['vault', 0, 6],
                          ['platform', -10, 14], ['platform', 10, 14], ['palisade', /* ring r 24 with gate */]], archers: 4 },
},
```

- `civil` buildings count toward `stats.civilBurned` (future Renown); `order` ones toward `stats.orderBurned`.
- Solids: a building is a vertical cylinder `r` x `h` (palisade: capsules along its segments). `solidAt(x, z)` returns the roof height or `null`.

### 4.3 Defenders

```js
defenders: {
  peasant: { hp: 10, speed: 6, sight: 90, fov: 2.4, flee: true, ringsBell: true },
  archer:  { hp: 18, sight: 130, fov: 1.8, range: 120, volley: 3, arrows: 3, spread: 0.06,
             speed: 70, damage: 3, aimTime: 0.6, cooldown: 3 },
  ballista:{ hp: 80, sight: 170, fov: 1.2, range: 220, aimTime: 2.0, bolt: 160, damage: 35, reload: 8,
             turn: 0.9, crew: 1 },
},
projectiles: { max: 60, gravity: 30 },
```

- Archers lead the target by its velocity with `spread` noise; arrows are cheap pooled projectiles.
- The ballista aims for `aimTime` with a visible aim line (the warning), then fires straight at where it aimed. Dodging = changing course during the aim. Without crew (archers burned) it stops working.

### 4.4 Perception

```js
perception: {
  awareRise: 1.2, awareFall: 0.25,          // per second, scaled by how clearly the dragon is seen
  suspicious: 0.35, alert: 1.0,             // awareness thresholds
  night: 0.45, dusk: 0.75,                  // sight range multiplier by light
  altitude: { from: 80, to: 220, min: 0.5 },// high flight is harder to see: x1 below `from`, down to `min` at `to`
  hearing: { boost: 60, breath: 80, land: 60, takeoff: 90, run: 30 },   // radii x dragon scale
  losSteps: 8,                              // terrain samples on the line of sight
  searchTime: 20,
},
```

Seen value (0..1) = in cone x in range (`sight` x `stage.spot` x light x altitude factor) x LOS clear, falling off linearly over the last 30% of range. Awareness rises by `awareRise x seen x dt`, falls by `awareFall x dt` when unseen.

### 4.5 Alert

```js
alert: {
  maxLevel: 3, maxHeat: 3.99,
  add: { sighted: 0.2, bell: 0.5, orderBurned: 0.5, civilBurned: 0.75, livestock: 1.0, defenderKilled: 0.25, loot: 1.0 },
  quiet: 60,                                // s without incidents before decay starts
  decay: 0.0035,                            // heat per s once quiet (about 1 level per 5 min)
  towerDownMult: 2,                         // decay faster while a watchtower lies in ruins
  responses: {
    1: { extraArchers: 1, bellFast: true },
    2: { patrols: 2 },                       // archer pairs walking the roads
    3: { villageBallista: true, livestockInside: true, extraArchers: 2 },
  },
},
```

Level = `floor(heat)`, clamped to `maxLevel`. Regions the dragon is not in decay from timestamps when they are loaded again.

### 4.6 Livestock, loot, upgrades, clock

```js
prey: { /* goat, deer, boar as in Phase 1 */
  sheep: { size: 1, food: 25, hp: 20, speed: 7, flee: 9, fleeRange: 40, herd: [3, 6], fights: false, livestock: true },
  cow:   { size: 2, food: 60, hp: 50, speed: 6, flee: 7, fleeRange: 35, herd: [2, 4], fights: false, livestock: true },
},
loot: {
  tithe:     { size: 1, gold: 50,  carry: { speedMult: 0.85, breath: true } },
  strongbox: { size: 2, gold: 150, carry: { speedMult: 0.8,  breath: false } },
},
upgrades: {
  prey_sense:     { cost: 120, effect: { smellRange: 1.6, smellType: true, preyHighlight: true } },
  iron_scales_1:  { cost: 150, effect: { arrowDamage: 0.7, boltDamage: 0.85 } },
  wing_muscles_1: { cost: 200, effect: { stRegen: 1.2, boostSt: 0.85, takeoffSt: 0.7 } },
  hotter_fire_1:  { cost: 250, effect: { cookRate: 1.3, burnRate: 1.3 } },
  guard_sight:    { cost: 300, effect: { showCones: true } },
},
clock: { dayLength: 1200, start: 0.3, dusk: 0.75, dawn: 0.25, nightFrom: 0.8, nightTo: 0.2 },  // 0 = midnight
```

- Loot and prey share the one claw slot. Carrying loot applies `carry.speedMult` and may block breath.
- Prey sense is the cheapest upgrade, so the first tithe chest buys better hunting.
- Iron scales applies to arrows and bolts; guard sight draws defender vision cones and awareness marks at any distance (without it, marks show only within 120).

### 4.7 Cave interior and navigation

```js
cave: {
  room: { r: 60, h: 28 },                   // dome hall; fits an Elder (scale 4) with room to turn
  floor: 0, bounds: 54,                     // flat floor, walkable circle
  stations: {                               // [x, z, radius] in the hall, the tunnel leads out at +Z
    nest:   [0, -34, 12],
    larder: [-30, -8, 8],
    hoard:  [30, -8, 10],
    altar:  [0, 8, 5],
    exit:   [0, 50, 8],
    // Phase 3: trophy [-40, 20], board [40, 20], mapStone [0, 30]; Phase 5: vents
  },
  reach: 8,                                 // + station radius, x dragon scale ^ 0.5
  camera: { dist: 12, height: 6, maxDist: 'room' },   // the camera never leaves the dome
  hoardTiers: [0, 100, 300, 700, 1500],     // coin pile size steps; coins = min(800, gold / 2) instances
},
nav: {
  discover: 250,                            // a settlement within this range (and seen) is discovered for good
  markers: 7, fov: 2.4,                     // max markers on the strip, the strip's angular width (rad)
  tagTime: 3,                               // T09: s a tapped marker's name stays
},
smell: {
  range: 380,                               // x stage spot ^ 0.5; x hungryMult when hungry, x 1.3 more when starving
  hungryMult: 1.4,
  sharp: 120,                               // inside this the marker points exactly at the herd
  blur: 0.7,                                // angular noise (rad) at full range, shrinks to 0 at `sharp`
  update: 0.5,                              // s between scent updates (markers drift, they do not jitter)
  max: 3,                                   // strongest scents shown
  starveMult: 1.3,                          // T09: the 'x 1.3 more when starving' above
},
```

- Scent strength = herd size x (1 - distance / range); the strongest `smell.max` herds get markers. Livestock use a different icon.
- The compass strip shows markers within `nav.fov` of the heading; markers behind the dragon stick to the strip's edges as arrows.

### 4.8 Regions

```js
regions: {
  wild: { /* Phase 1 */ exits: [{ to: 'ash', ... }, { to: 'farm', angleFrom: -0.6, angleTo: 0.6, minStage: 1 }],
          settlements: [{ type: 'hamlet', x: 420, z: -300, yaw: 0.4 }, { type: 'outpostS', x: -380, z: 520, yaw: 2.1 }] },
  farm: {
    nameKey: 'c.region.farm', radius: 1100, seed: 37, ceiling: 300, palette: 'farm', waterLevel: 0,
    terrain: { amp: 0.6, base: 12, features: [   // base 8 -> 12 in T11
      { type: 'river', points: [[-1100, -200], [-300, 0], [200, 150], [1100, 80]], width: 26, depth: 6 },
      { type: 'road',  points: [[0, -1100], [0, -300], [380, 260], [700, 640]], width: 8 },
      { type: 'plateau', x: 380, z: 260, r: 70 }, { type: 'plateau', x: -420, z: -460, r: 50 },
      { type: 'plateau', x: 640, z: -520, r: 90 },
    ] },
    flora: { trees: 500, rocks: 60, fields: 24 },
    herds: [{ type: 'deer', count: 2, ring: [700, 1000] }],
    settlements: [{ type: 'village', x: 380, z: 260, yaw: 0 }, { type: 'hamlet', x: -420, z: -460, yaw: 1.2 },
                  { type: 'outpost', x: 640, z: -520, yaw: -0.8 }],
    exits: [{ to: 'wild', angleFrom: PI - 0.6, angleTo: PI + 0.6 }],
    entries: { wild: { angle: PI } },
  },
},
```

- `minStage` on an exit: a smaller dragon gets the prompt "Too small for the Farmlands - grow into a Drake" instead of the travel action.
- Terrain features `river` (carves a channel and a water plane), `road` (slight flatten, used by patrols) and `plateau` (flat ground for a settlement) are new in `core/terrain.js`; water is not walkable and not landable.

## 5. System interfaces (`core/`)

Same rules as Phase 1: array vectors, pure functions or mutation of the object passed in, injected `rng`.

### 5.1 `walk` and pilot modes

```js
pilot.mode: 'air' | 'landing' | 'ground' | 'takeoff'
canLand(p, regionId, solids) -> { ok, why? }    // why: 'high' | 'fast' | 'steep' | 'water' | 'roof'
startLanding(p) ; startTakeoff(p, stats, eff)   // timed transitions (land.time, takeoff.time)
step(p, input, dt, ctx) -> p                    // ground: tank steering, run, slope limit, building collisions, stays on surface
inFront(p, scale, items) -> item | null         // nearest item inside ground.reach x scale and reachCone
```

`state.step` runs `flight.step` for `air`, `walk.step` for `ground` and a scripted blend for `landing` / `takeoff` (position eases to the surface, pitch and legs animate). Landing and takeoff make noise (`perception.hearing`).

### 5.2 `settlement`

```js
build(regionId, regionState) -> town         // { buildings: [{ id, type, pos, yaw, r, h, hp, fire, ruin, ruinAt }], pens, posts }
solidAt(town, x, z) -> roofHeight | null
burn(town, breathCone, dt, mult) -> events[] // ignite, burning damage, spread, 'building:burning', 'building:ruined'
rebuild(town, now) -> events[]               // ruins older than fire.rebuild come back
```

Buildings come from settlement templates placed at `settlements[i]` with seeded jitter. Flight and walking treat `solidAt` as extra ground (flight floor, walk blocked when the roof is higher than `walk.stepUp`).

### 5.3 `perception`

```js
seen(viewer, dragon, ctx) -> 0..1          // viewer { pos, yaw, sight, fov }, ctx { regionId, spot, light, scale }
heard(viewer, noises) -> boolean           // noises: [{ pos, r }] this frame
stepAwareness(def, seen, heard, dt) -> 'idle' | 'suspicious' | 'alert'
```

Line of sight samples `surfaceAt` and `solidAt` at `losSteps` points. The same module can later replace the prey flee check.

### 5.4 `defenders`

```js
spawn(town, alertLevel, rng) -> squad       // peasants, archers on posts and walls, ballistae on platforms, patrols
step(squad, dragon, dt, ctx) -> events[]     // AI, projectiles, hits; ctx { regionId, light, spot, scale, upgrades, rng }
burn(squad, breathCone, dt) -> events[]      // defenders caught in the cone die (peasants flee instead)
```

States: `idle` (posted or wandering) -> `suspicious` (look toward the noise) -> `alert` (archers volley, ballista aims; peasants run to the bell or flee) -> `search` (last seen position, `searchTime`) -> `idle`. Events: `bell:ring`, `arrow:hit`, `bolt:aim`, `bolt:fire`, `bolt:hit`, `defender:killed`.

### 5.5 `alert`

```js
add(rs, kind, now) -> events[]          // rs = region state; 'alert:level' on change
step(rs, dt, now, ctx) -> events[]      // decay after `quiet`, faster with a ruined tower
catchUp(rs, now)                        // offline decay on region load
responses(level) -> { extraArchers, patrols, villageBallista, livestockInside, bellFast }
```

### 5.6 `loot`, `upgrades`, `clock`

```js
loot.place(town) -> items ; loot.bank(cs) -> gold   // bank on lair enter; death drops (loses) the carried item
upgrades.buy(cs, id) -> { ok, why? } ; upgrades.effects(cs) -> merged multipliers
clock.step(cs, dt) ; clock.light(t) -> 0..1 ; clock.sleepTo(cs, 'dusk' | 'dawn')
```

`upgrades.effects` is read by flight, walk, hunger, prey (cook rate), settlement (burn rate) and defenders (damage).

### 5.7 `cave` and `nav`

```js
cave.enter(cs) -> events[]          // after lair.enter: cs.location = 'cave', pilot in mode 'ground' at the tunnel, facing in
cave.stationAt(cs) -> id | null     // station within reach (the Action slot label)
cave.act(cs, id, arg) -> events[]   // nest: rest | sleep dusk / dawn; larder: eat item; altar: buy; exit: leave
cave.leave(cs) -> events[]          // lair.leave: back in the air in front of the mouth
nav.markers(cs) -> [{ kind, bearing, dist, label, dim? }]   // kind: lair | exit | settlement | scent | scentLivestock
nav.step(cs, dt, rng) -> events[]   // smell update, discovery ('place:discovered')
```

Inside the cave, `state.step` runs `walk.step` with the cave floor and station solids, plus `lair.spoil`; hunger, prey, defenders and alert of the outside region are paused (region alert decays by timestamp as usual). The cave is a separate scene: entering hides the region scene, which stays loaded for a fast exit.

### 5.8 `state` and `lair` changes

- Input gains `land` (one-shot, the Move slot or F). Grab on the ground means pick up in front.
- `cs` gains `town`, `squad`, `items`, `regionStates`, `clock`, `hoard`, `upgrades`, `carriedLoot`.
- Order in `state.step`: clock -> locomotion -> hunger -> prey -> settlement fire -> defenders -> alert -> grab / pick up -> eat -> lair -> region -> death.
- `cs` also gains `location: 'field' | 'cave'` (replaces the plain `inLair` flag; `inLair` stays as a getter for Phase 1 code) and `nav` (scent markers, discovered places).
- `lair.enter` banks carried loot (`hoard:banked`); `lair.respawn` loses it (`loot:lost`) and wakes the dragon on the nest. The old lair panel becomes station panels: nest (Rest, Sleep until dusk / dawn, stage progress), larder (items with Eat), altar (upgrades with cost, effect, Buy).

### 5.9 `save` v2

```json
{
  "version": 2,
  "dragon": { "stage": 1, "foodXp": 820, "hp": 200, "hunger": 60, "upgrades": ["iron_scales_1"] },
  "hoard": { "gold": 320, "relics": [] },
  "regions": { "farm": { "discovered": ["farm.outpost", "farm.village"], "heat": 2.4, "lastIncident": 5120, "ruins": [{ "id": "farm.outpost.tower1", "at": 5000 }], "lootTaken": [{ "id": "farm.outpost.vault", "at": 5100 }] } },
  "world": { "region": "farm", "pos": [600, 12, -480], "yaw": 2.0, "mode": "ground", "location": "field", "clock": 0.62, "now": 5200 },
  "stats": { "played": 5200, "eaten": 40, "food": 820, "civilBurned": 3, "orderBurned": 5, "livestockTaken": 2 }
}
```

`now` is the game clock in seconds used for decay and rebuild timestamps. `migrate` v1 -> v2 fills defaults (gold 0, no upgrades, mode `air`, clock `clock.start`). A save in mode `ground` or `landing` restores on the ground; `takeoff` restores in the air; `location: 'cave'` restores inside the cave at the nest.

## 6. Rendering and UI

| Element | Implementation |
| --- | --- |
| Touch layout | 3 fixed buttons (Breath, Boost, Roll) + Action (hold) + Move (tap) context slots; labels from i18n, icon + text; Roll hidden on the ground. Slot logic in `core/controls.js` (`slots(cs)`); the Action kind is latched at the press (a grab hold that catches a prey does not start eating). Move offers "Enter cave" within `lair.enterRange` (80) of the mouth while heading toward it (built in T01) |
| Dragon on the ground | Legs extend on landing, 4-leg walk cycle tied to ground speed, wings folded, body pitch follows the slope; ground camera lower (height 6 x scale) and closer |
| Buildings | `InstancedMesh` per building type and per state (whole, ruin); fire = shared particle pool + flicker light for the nearest 2 fires; smoke columns |
| Defenders | Low-poly figures, one `InstancedMesh` per type; arrows as instanced thin boxes; bolts as a mesh; ballista aim line as a red fading line; awareness `?` (amber) / `!` (red) sprites |
| Alert | Small banner pips under the region name (0-3), pulse on change, toast "The Farmlands are on alert" |
| Cave | One dome mesh with rock vertex colours, a lava channel (emissive + 1 point light, flicker), nest of bones and ash, larder slab with stored carcasses (prey meshes), hoard pile = `InstancedMesh` of coins in `hoardTiers` heaps, altar stone with glowing runes for affordable upgrades, tunnel glow at the exit; station rings on the floor when in reach |
| Station panels | Small bottom sheet on phones (does not cover the stick), side panel on desktop; opened by the Action slot or E |
| Compass | Canvas strip under the top HUD row: heading ticks, N mark, markers as icons (lair, exit, settlement in alert colour, scent puffs), distance for the lair and the selected marker; tap a marker to show its name |
| Day / night | `render/sky.js` lerps sun direction, ambient, fog and sky colours; night keeps enough ambient to read the stick area and terrain on a phone |
| Fields and river | Vertex colour patches for fields, a water plane per river segment |

## 7. Task breakdown

Each task ends with both test runs passing and the browser check from the agent prompt. Sizes: S < 2 h, M 2-5 h, L 5-10 h of AI-assisted work.

| ID | Task | Depends on | Size | Acceptance |
| --- | --- | --- | --- | --- |
| T01 | Touch action layout: Breath, Boost, Roll fixed; Action (hold) and Move (tap) context slots; travel and cave prompts move to Move; desktop unchanged | - | M | At 390 x 844 portrait and 844 x 390 landscape no HUD element covers the stick or buttons; all phase 1 actions still playable on a phone; tap targets at least 44 px for the context slots |
| T02 | Perf readout and quality tiers: fps, draw calls, triangles in the debug panel; `?q=low|mid|high`, auto tier from the first 10 s of fps on touch | - | S | Readout visible on touch via DBG; low tier halves flora and shadow cost; tier saved in `localStorage`. Built (T02): the game has no shadow maps, so instead of shadow cost the low tier caps the pixel ratio at 1, pulls fog and chunk view distance in to 80% and halves breath particles; tiers in `data.quality`, logic in `core/quality.js`; debug button / key G cycles the tier (moved to key Y in T08: G is Grab) |
| T03 | Solo and co-op use `shared/dragon.js`; remove the two inline copies of `makeDragon` | - | S | Duel, tutorial and co-op render and animate the same as before (screenshots side by side); `node mp/sim.test.js` passes |
| T04 | Hatching scene (**already built in phase 1 T15, PR #9**; here only: the card line "your mother is out hunting" goes, and the scene hands over to the mother NPC of T05): the campaign opens with the in-engine scene from the preview (mother curled around the small egg, heartbeat, cracks, burst, hatchling climbs out, mother nuzzles it); `render/hatch-scene.js` with the game's models, captions EN + CS, Skip button (touch) / Esc; replaces the phase 1 hatching card and ends with the hatchling and the mother in the lair | T03 | M | New hatchling plays the scene once (about 20 s) and lands in the lair; Skip works on a phone; Continue never plays it; no page errors at 390 x 844. Built (T04): the hatching card stays as the scene's last frame (its button is the explicit start), with the mother present in its text; `lair.hatch` sets `cs.story.mother = { lesson: 0, at: 'lair' }` and emits `mother:handover`, which T05's `core/mother.js` picks up; `story.mother` is saved, a phase 1 save has none (no teacher) |
| T05 | `core/mother.js` + mother NPC: flies with the hatchling, leads it to a herd, shows a dive and a grab, waits for the player to copy, praises and moves on; lessons are rows in `data.js` (fly, dive, grab, eat, roast a heavy prey, carry to the lair, rest); she keeps out of defender range and cannot die in this phase; while the dragon is a Drake she leaves it alone more often | T04 | L | Tests: lesson order and completion rules; she never enters perception range of defenders. On a phone a new player follows her lessons from the first flight to the first meal and the first rest without reading the old hunting tip. Built (T05): lessons in `data.mother.lessons` with `goal` (self, herd, heavy, lair; a goal in another region leads to that exit) and `done` (event list, or seconds of following / diving); she shows the dive, the grab and the roast once near the goal, then circles over it; her caption replaces the hunting tip; 'keeps out of defender range' = danger zones (`data.regions[id].danger` plus `ctx.danger`, which the defenders of T15 will fill); after the last lesson (and between lessons while the dragon is a Drake) she leaves and visits now and then (`mother.visit`, a Drake longer away); debug button / key M completes the current lesson. After Pavel's first test: an arrow at the screen edge points to her while she is out of view, she holds the boar still during the roast lesson (`mother.hold`, `prey.held`), and roasting is faster with memory: `roast.cookTime` 1.2 -> 0.9 s, `roast.cool` 0.5 -> 0 (the heat never fades until the prey is roasted; the last warm prey stays the fire target with its progress bar even out of view, and the mother holds that one), `breath.range` 30 -> 36 (a scripted pass that never roasted the boar in 2 min now roasts it in about 8 s); an orange ring marks the fire target and the prompt shows the roast progress |
| T06 | `core/walk.js` + pilot modes, `canLand`, landing / takeoff transitions, terrain-only collisions (buildings come in T10), tests | - | L | Tests: landing refused when high, fast, steep or over water; walking stays on the surface, cannot climb slopes over `maxSlope`; takeoff ends airborne above `minAlt`. Built (T06): `land.maxSpeed` 26 -> 36, because flight never drops below about 28 at cruise (only a hard pull-up slows it), so 26 would force a flare on every landing; now cruise speed lands and boost does not. Lava in the crater is refused too (why `lava`, `terrain.liquidAt`; water discs `region.water` for T11). Blocked uphill moves slide along the slope's contour; `walk.stand` (1.6 x scale) is the body height over the ground and `walk.accel` the speed response. The Move slot Land / Fly and the F key are already in (shown when `cs.landOk`, so T07 is left with legs, walk cycle, ground camera and the land / takeoff animation); Roll hides off the air; on the ground the wings hold still, no swoop, grab or region travel until T08 |
| T07 | Legs and walk cycle in `shared/dragon.js`, ground camera, land / takeoff animation, Move slot Land / Fly + F key | T03, T06 | M | On a phone: Land appears near the ground, the dragon lands, walks with the stick, runs with Boost, takes off with Fly; duel flight pose unchanged. Built (T07): the Move slot Land / Fly and the F key were already wired in T06; T07 adds hip / knee / foot joints in `shared/dragon.js` (all 0 = the old tucked pose, so flight is unchanged to the vertex), a 2-bone IK standing pose with a trot cycle, folded wings on the ground, a wing flare while landing and legs tucking during takeoff; the pose state is `walk.pose` (pure, tested) with `data.pose`, the ground camera is `data.groundCam` (back 18, height 6, x scale ^ 0.75), blended in with the legs |
| T08 | Ground actions: pick up prey in front, eat on the ground (vulnerable, cancelled by damage), breath along the ground | T07 | M | Hatchling lands next to a goat, picks it up, eats it on the ground; a boar charge cancels the meal; breath cooks prey from the ground. Built (T08): Grab on the ground takes the nearest liftable prey or roast chunk in front (`walk.inFront`, `prey.inFront`), the green ring marks it and the prompt names it; a too heavy one in front says so; the prey is held in the jaws (`state.jawPos`, drawn at the mouth anchor) and moves to the claws after takeoff; Eat on the ground takes `ground.eatTime` and stands still, a boar's hit cancels it (same as in the air); the fire aims `ground.breathPitch` below the slope pitch. A goat flees a landed dragon, so the hatchling catches it by running (Boost, 13 vs 9) or roasts it first; debug button / key I puts the nearest goat in front, held still for 4 s, and the quality hotkey moved from G to Y. After Pavel's first test (fire 'stopped working' after a ground roast: he was starving, which blocks fire by design, and nothing said so): pressing Breath with no fire possible emits `breath:blocked` (`starving` or `tired`, once per press) and the prompt says why; the Breath button dims while starving |
| T09 | `core/nav.js` + `render/compass.js`: compass strip with lair and exit markers, smell markers toward herds (wild and livestock icons), tap to name a marker | T01 | M | Tests: scent bearing is exact inside `smell.sharp`, blurred and stable (no jitter) far out, range grows when hungry; on a phone the strip leads to the lair and to a herd out of sight; strip does not overlap the bars or the pause button at 390 x 844. Built (T09): `nav.markers` gives world bearings (the strip subtracts the heading; N = +Z, the Wildwood side of the Ash Wastes); outside the lair region the lair marker points at the exit on the way home ('Your lair (through Ash Wastes)', `nav.routeExit`) and replaces that exit's own marker; the blur is a stored per-herd offset from a slow drift (no rng), so a marker moves at most about 0.04 rad per update and the strip also eases it; starving smells x `smell.starveMult` (1.3) on top of `hungryMult`; a tapped marker shows its name and distance for `nav.tagTime` s; settlements and discovery (`nav.discover`, `place:discovered`) come with T12, when there are settlements to discover. The strip sits at 112 px under the top row (the bars are 93 px high), the mother's caption and the touch tip moved down to 148 px; debug button / key O (smell test) puts the dragon 340 away from the nearest herd, facing away |
| T10 | `core/cave.js` + `render/cave-view.js`: cave hall scene, walk inside, stations nest (Rest), larder (Eat, carcasses visible) and exit; station panels replace the lair panel; respawn on the nest | T07, T08 | L | Flying into the mouth loads the cave in under 0.5 s; the dragon walks to the nest and rests, eats from the larder, leaves through the tunnel; dying wakes it on the nest; `lair.test.js` passes; an Elder-sized dragon (debug scale 4) fits and the camera never clips through the dome. Built (T10): `cs.inLair` stays the flag (Phase 1 code and tests read it) and `cs.location` is a getter on it ('cave' / 'field'); `lair.enter(cs, at)` calls `cave.place` (tunnel, facing in; the nest after death, hatching and a save inside), `cave.act` lives in `state.caveAct` for the panels (nest: rest, larder: eat, exit: leave); walking past `tunnel.out` also leaves. Walls are a clamp to the floor circle and the tunnel band (the dragon slides along them) instead of station solids. Hoard and altar stations wait for T19 / T20; the exit station sits at [0, 56, 4] (not [0, 50, 8]) so the Action slot does not offer Leave the moment the dragon arrives at `entry` [0, 40]. Station panels: the Action slot (tap, shows the station name) or E / Enter opens the nest or larder panel (side panel on desktop, a sheet above the stick and buttons on phones, between them in landscape), walking away closes it; the mother's caption hides while a panel is open. Camera `cave.camera`: dist 18, height 7, look 10 (x scale ^ 0.75; 12 / 6 felt cramped on a phone), pulled in by bisection to stay `pad` inside the dome and tunnel. Region scene stays loaded, hidden; outdoor lights go to intensity 0 (no shader recompile). A save inside keeps `location: 'lair'` (v1 shape, the rename to 'cave' comes with save v2 in T22) with the mouth as the position. Debug button / key B: Elder size (scale 4) on / off |
| T11 | River Farmlands terrain: river, roads, plateaus, fields, palette; exit from Wildwood with `minStage`; Wildwood settlement plateaus | T06 | L | Region loads in under 1.5 s on a mid laptop; water not landable; hatchling sees the "Too small" prompt, Drake travels; no geometry leak after 5 round trips. Built (T11): `terrain.base` 8 -> 12 (at 8 about 9% of the region was below the water and all three plateaus sat in hollows); features in `core/terrain.js` apply in the order road, river, plateau on top of the base noise: a road levels its cross section toward its centre line height and becomes a causeway over pond hollows, a river gets a channel (`width / 2 x 1.4`, bed `depth` below its `level` = base - 1) inside a flat valley floor (`level + 2`, 34 wide), a plateau sits at the mean ground height over its rim (at least waterLevel + 3); `region.waterLevel` (Wildwood 0.6, Farmlands 0) makes lakes and ponds water for landing, walking, prey and trees (`terrain.liquidAt`, `terrain.dryAt`), so Wildwood lakes are no longer landable; fields are `terrain.fields(id)` (seeded, near the road and the river, off water, roads and plateaus) painted as crop rows; `region.settlements` sites are in data now (each on a plateau, test), the buildings come with T12; a dragon below an exit's `minStage` gets `cs.exitSmall` and `region:tooSmall` (prompt on phone and desktop, no Move slot); debug button / key C makes the dragon a Drake, key T cycles through the region's exits |
| T12 | `core/settlement.js` + `render/settlement-view.js`: templates, placement, solids for flight and walking; discovered settlements on the compass | T09, T11 | L | All 5 settlements render; the dragon cannot walk or fly through buildings; tests for `solidAt`, placement determinism and discovery; a settlement shows on the compass after it was first seen. Built (T12): `cs.town` = `settlement.build(region)` (rebuilt on region change, `state.ensureTown`); settlement ids `<region>.<type>`, building ids `<settlement>.<type><n>` (as in the save example); templates in `data.settlements` with offsets nudged so no footprints overlap (hamlet barn [-3, -13], watch post taxhouse [7, 7]; the village layout is new: 6 houses, barn, granary, taxhouse, tower, bell around a sheep and a cow pen, room kept for the alert 3 platform); both outposts got a gate (12 wide, at the template's local +Z) so a dragon can walk in; pens are fence rings (`settlement.penR` + count), livestock come with T18. Solids: buildings are cylinders, palisade pieces capsules; the dragon collides with its body pad (`settlement.pad` x scale): walking slides along walls (the blocked move is pushed back out of the wall), flight counts a roof as ground for the pull-up, hops onto a wall top less than 3 under it and is otherwise pushed out along the wall; landing on a roof (or right next to a wall) is refused with 'roof'; ruins are no solids. Discovery: within `nav.discover` and the centre (`losEye` over the ground) in line of sight over the terrain (`losSteps` samples), checked every `discoverEvery` s; `place:discovered` shows a toast, the marker is a house icon named by type (Hamlet, Village, Order watch post, Order outpost); discovered ids are saved in v1's `regions.<id>.discovered` already. Renderer: one vertex-coloured InstancedMesh per building type (11 draw calls at most) + one mesh for all pen fences. Debug button / key 1 ('to town') flies to the next settlement of the region |
| T13 | Building fire: ignite, burn, spread, ruins, rebuild timer; `stats.civilBurned` / `orderBurned` | T12 | M | A tower burns down in about 10 s of breath at hatchling stats; fire spreads only to neighbours; ruins come back after `fire.rebuild`. Built (T13): `fire` got `cool` 0.5 (heat lost per s out of the breath), `fan` 2.5 (extra hp/s while the breath stays on a burning building) and `reach` 8 (neighbours = same settlement, footprints at most 8 apart; at 6 most village houses had none): ignite 0.8 s, then 80 / (6 + 2.5) = about 9.4 s more under the breath, 10.2 s in all (a hatchling's fire bar lasts about 3 s, so in bursts; a lit building burns on by itself at `burn`). The cone reaches a building over 60% of the prey cone's width and stops in the ground (`settlement.inFire`). `now` = `stats.played`; ruins live in `cs.regionStates[region].ruins` [{ id, at }] and are saved already in the v1 save as `regions.<id>.ruins` (the v2 shape), with `stats.civilBurned` / `orderBurned`; a ruin does not rebuild while the dragon stands in its footprint. Renderer: whole buildings darken as they lose hp (instance colour), one instanced rubble mesh for all ruins, flame and smoke particle pools (2 draw calls), fresh ruins smoke for 25 s, 2 flicker lights owned by game.js (always in the scene, intensity 0 when nothing burns). Debug button / key 2 sets the nearest building alight, button / key 3 rebuilds every ruin of the region |
| T14 | `core/perception.js`: cones, range factors, LOS, hearing, awareness, tests | T12 | M | Tests: hidden behind a hill = not seen; night and altitude shorten range; landing near a guard is heard |
| T15 | Peasants and archers: posts, AI states, bell, volleys, pooled arrows, burning defenders; awareness marks | T13, T14 | L | Archers on the outpost tower volley at a low dragon and stop when it climbs out of range; peasants run to the bell; at most 60 projectiles |
| T16 | Ballista: aim line, bolt, reload, crew, burnable platform | T15 | M | The aim line shows 2 s before each bolt; changing course dodges it; burning the crew or the platform stops it |
| T17 | `core/alert.js` + responses: extra archers, patrols on roads, village ballista at level 3, livestock inside; HUD pips; offline decay | T15, T16 | L | Tests: incidents raise heat as in data, decay after `quiet`, faster with a ruined tower, catch-up on region load; in game level 3 builds the village platform |
| T18 | Livestock: sheep and cows in pens and barns, alert on taking them, barn burn releases them | T17 | S | Taking a sheep raises heat by 1; at level 3 pens are empty and the barn holds the herd |
| T19 | `core/loot.js` + hoard: tithe chests and strongboxes, carry penalties, bank on lair enter, lose on death; hoard pile station in the cave | T08, T10, T12 | M | Drake carries a strongbox at 80% speed without breath; entering the lair adds 150 gold and the coin pile grows a tier; dying with it loses it and the vault refills after `fire.rebuild` |
| T20 | `core/upgrades.js` + altar station: 5 upgrades, effects wired, prey sense on the compass and in the world, guard sight cones | T19 | M | Buying iron scales cuts arrow damage by 30% (test); prey sense lengthens smell and names the prey; guard sight shows cones; gold cannot go negative |
| T21 | `core/clock.js` + `render/sky.js`: cycle, lighting, perception factor, Sleep until dusk / dawn at the nest | T10, T14 | M | Night halves archer sight (test); a full cycle takes 20 min; night is readable on a phone screenshot |
| T22 | Save v2 + migration v1 -> v2: hoard, upgrades, region states, discovered places, clock, ground pose, cave location | T17, T19, T20, T21 | M | Reload restores gold, upgrades, alert, ruins, discovered places, a landed dragon and a dragon inside the cave; a phase 1 save migrates; corrupt v2 handled like v1 |
| T23 | Texts and tips: landing, smell and compass, cave stations, raiding, alert and altar tips, EN + CS, touch wording pass, intro note for the Farmlands | T22 | M | Every new visible string from `i18n.js`; touch texts name buttons; all Phase 2 flows playable on a phone end to end |
| T24 | `test/raid.test.js` scripted raid bot + balancing pass | T22 | M | Seeded bot: Drake raids the outpost and banks a strongbox in 6-12 simulated min with at least 20% HP left at full hunger; alert reaches 3 after 3 raids and drops a level after 5 quiet min; numbers changed in `data.js` only |
| T25 | README campaign section update, controls table, mark Phase 2 done in `000_spec.md` | T24 | S | README lists landing, the compass and smell, the cave, raiding, alert and the altar for phone and desktop |

Suggested order: T01 to T25 in number order. T04 and T05 (hatching scene and the mother, added with the story revision of 2026-10-29) come early so every later feature can add its lesson as one data row. T07 (walking) and T10 (cave) are the two feel checkpoints: Pavel validates them on a phone before later tasks build on them.

## 8. Testing

| Level | What | How |
| --- | --- | --- |
| Unit | walk, cave, nav (smell, discovery), settlement, perception, defenders, alert, loot, upgrades, clock, save v2 | `node campaign/test/run.js`, seeded `mulberry` RNG |
| Simulation | Raid bot: fly to the outpost, land, take the strongbox, escape, bank; invariants (projectiles bounded, gold never negative, heat 0..maxHeat, dragon never inside a solid) | `test/raid.test.js` |
| Regression | Phase 1 tests and the 30 min growth sim still pass; duel and co-op unaffected | both test runs + T03 screenshots |
| Manual | Phone first: land, walk, follow a scent, raid, carry into the cave, bank, buy at the altar, night raid, reload inside the cave; then desktop | Checklist in each PR, phone steps first |

## 9. Performance budget

| Metric | Budget |
| --- | --- |
| Frame rate | 30+ fps on a mid phone in the Farmlands at the outpost under fire, 50+ fps on a mid laptop |
| Draw calls | under 300 in the Farmlands |
| Defenders | 30 active max per region, full AI within 400 of the dragon, 4 Hz beyond |
| Projectiles | 60 max, pooled |
| Fire lights | 2 dynamic lights max; other fires are particles only |
| Cave | 60+ fps on a mid phone (one hall, region scene hidden), at most 800 coin instances, enter / leave under 0.5 s |
| New JS | under 150 KB unminified for this phase |

## 10. Risks

| Risk | Mitigation |
| --- | --- |
| Walking a 2.4x scale drake feels stiff on a phone | Tank steering with generous turn rate, ground camera tuned in T07; Pavel validates T07 before the kingdom tasks build on it |
| Camera in an enclosed cave clips through walls or loses the dragon | Camera distance clamped to the dome radius, lower and closer than outside; tested with an Elder-sized debug dragon in T10 |
| Walking between stations is slower than tapping a menu | Hall kept small, stations within a few seconds' walk; the nest is in front of the tunnel path; Action slot works from the station ring, not only when touching |
| Smell markers make hunting too easy | Blur far away, only the strongest 3 scents, no type without prey sense; tuned in T24 |
| Archer chip damage plus hunger makes raids frustrating | Iron scales, balancing in T24 against the HP target, arrows dodgeable at speed |
| Too many buttons on a phone | Context slots only (section 6); no new fixed button in this phase |
| 5 settlements + fire particles hurt phones | Quality tiers from T02, instancing, 2 dynamic lights, far AI at 4 Hz |
| T03 touches duel and co-op code | Screenshot comparison and the mp tests; no behaviour changes beyond swapping the model source |
| Region state grows the save | Store only ruins, taken loot and heat with timestamps; rebuilt entries are pruned |

## 11. Open design questions (recommended defaults)

- Loot in the claws (one slot shared with prey) or a separate gold pouch? Default: claws, so a raid forces a choice between food and gold.
- Farmlands gated until Drake? Default: yes; hatchlings raid the small Wildwood outpost.
- Burning civilian buildings: only alert for now, Renown later? Default: yes, counted in `stats` for Phase 4.
- Walking steering on touch: tank (up = forward, sides = turn) or stick direction relative to the camera? Default: tank, it fits the chase camera.
- Cave entry: flying into the mouth cuts straight to the dragon standing in the tunnel inside (default), or a short landing and walk-in animation? Default: the cut, it is faster on a phone.
- Smell: livestock smell too, with its own icon? Default: yes, it makes the farm tempting and raising alert a real choice.
- Compass at the top (default) or a small round radar in a corner? Default: the strip; a round radar would compete with the stick and buttons for corner space.
- Destroyed buildings and taken loot come back after 10 min of game time? Default: yes (`fire.rebuild`, 600 s).
