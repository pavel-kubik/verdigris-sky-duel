# Phase 2 - Kingdom + Hoard: Implementation Spec

Status: draft for review, 2026-10-29. Refines `000_spec.md` for Phase 2. Built on `campaign-phase-2` (branched from the finished `campaign-phase-1`). Task branches are `agent/t1NN-...` (T01 -> `t101`).

## 1. Goal

The dragon meets the kingdom. It can land and walk, raid Order settlements for gold, bank the gold in the lair, buy its first upgrades and watch the region react: more archers, bells, patrols, a ballista built in the village and livestock moved inside. Lying low in the wilds calms the region down again.

The phase starts with a short foundation block (touch action layout, phone performance baseline, shared dragon model, landing and walking), because every later task in this phase depends on it.

**Exit criteria**

- On a phone, a Drake flies to the River Farmlands, lands outside the Order outpost, walks in, picks up the strongbox, takes off under archer and ballista fire, banks the gold in the lair and buys an upgrade.
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
| Regions | River Farmlands (new, gated at Drake, from Wildwood), a hamlet and a small Order outpost added to Wildwood |
| Settlements | Hamlet, village, Order outpost (small and full), built from building templates in data |
| Buildings | House, barn, granary, tax house, watchtower, bell post, barracks, palisade, ballista platform; burnable, ruins, rebuilt later |
| Defenders | Peasant (flees, rings the bell), archer (volleys), ballista (telegraphed bolt, crew) |
| Perception | Vision cones with line of sight, light, dragon size and altitude; hearing; awareness per defender |
| Alert | Per region, heat 0-4 shown as level 0-3, rises on incidents, decays when quiet (also while the dragon is elsewhere) |
| Livestock | Sheep and cows in pens and barns; taking them raises alert |
| Hoard | Tithe chest and strongbox as carried loot, banked on entering the lair, lost on death; hoard pile in the lair panel |
| Upgrades | Altar in the lair panel with 4 upgrades: iron scales, wing muscles, hotter fire, guard sight |
| Day / night | 20 min cycle, lighting, perception factor, "Sleep until dusk / dawn" in the lair |
| Save | v2 with hoard, upgrades, region states, clock and ground pose; v1 -> v2 migration |
| UI | Alert indicator, awareness marks over defenders, aim line warning, loot in claws icon, EN + CS texts |

### Out of scope (later phases)

Renown and tribute (Renown in Phase 4, tribute when a village is freed in Phase 3), missions and the timer, relics, aeries and fast travel, story cards, knights, mages, net launchers, mangonels, slayers, alert 4-5, lair defense, towns and castles, fish, Wyrm stage, a 3D lair scene.

## 2. Constraints from the current code

| Fact | Consequence for Phase 2 |
| --- | --- |
| `core/flight.js` assumes the dragon is always airborne (`clampToRegion` with `minAlt`, floor pull-up) | Ground movement goes in a new `core/walk.js`; `pilot.mode` decides which one `state.step` runs. Flight code changes only for the landing approach |
| `shared/dragon.js` has tucked legs only and an `anim(time, dt, o)` for flight | Add leg joints and a walk / idle / land / takeoff pose to `anim`; the flight pose stays the same for the duel |
| `makeDragon` still exists in `index.html` and `mp/game.js` (phase 1 risk) | T03 switches solo and co-op to `shared/dragon.js` before the model gets legs, so all modes share one model |
| Touch buttons are fixed in `#btns` (Grab, Eat, Roll, Boost, Breath) plus a separate travel button | T01 moves to 3 fixed + 2 context slots; travel and cave entry move into the Move slot |
| Lair is a DOM panel, not a 3D scene | Hoard pile and altar are panel sections; a 3D lair is out of scope |
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
    (data.js, prey.js, flight.js, state.js, lair.js, region.js, save.js, terrain.js extended)
  render/
    settlement-view.js  instanced buildings, fire and smoke, ruins
    defender-view.js    defenders, arrows, bolts, aim lines, awareness marks
    sky.js              day / night lighting, sun, fog colour
  test/
    walk.test.js  settlement.test.js  perception.test.js  defenders.test.js
    alert.test.js  loot.test.js  upgrades.test.js  clock.test.js  save2.test.js  raid.test.js
shared/
  dragon.js             legs, walk cycle; used by index.html and mp/game.js too (T03)
```

Script order in `campaign/index.html`: `umd, math, events, data, terrain, clock, growth, hunger, upgrades, settlement, flight, walk, perception, prey, defenders, alert, loot, region, lair, state, save`.

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
  iron_scales_1:  { cost: 150, effect: { arrowDamage: 0.7, boltDamage: 0.85 } },
  wing_muscles_1: { cost: 200, effect: { stRegen: 1.2, boostSt: 0.85, takeoffSt: 0.7 } },
  hotter_fire_1:  { cost: 250, effect: { cookRate: 1.3, burnRate: 1.3 } },
  guard_sight:    { cost: 300, effect: { showCones: true } },
},
clock: { dayLength: 1200, start: 0.3, dusk: 0.75, dawn: 0.25, nightFrom: 0.8, nightTo: 0.2 },  // 0 = midnight
```

- Loot and prey share the one claw slot. Carrying loot applies `carry.speedMult` and may block breath.
- Iron scales applies to arrows and bolts; guard sight draws defender vision cones and awareness marks at any distance (without it, marks show only within 120).

### 4.7 Regions

```js
regions: {
  wild: { /* Phase 1 */ exits: [{ to: 'ash', ... }, { to: 'farm', angleFrom: -0.6, angleTo: 0.6, minStage: 1 }],
          settlements: [{ type: 'hamlet', x: 420, z: -300, yaw: 0.4 }, { type: 'outpostS', x: -380, z: 520, yaw: 2.1 }] },
  farm: {
    nameKey: 'c.region.farm', radius: 1100, seed: 37, ceiling: 300, palette: 'farm',
    terrain: { amp: 0.6, base: 8, features: [
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

### 5.7 `state` and `lair` changes

- Input gains `land` (one-shot, the Move slot or F). Grab on the ground means pick up in front.
- `cs` gains `town`, `squad`, `items`, `regionStates`, `clock`, `hoard`, `upgrades`, `carriedLoot`.
- Order in `state.step`: clock -> locomotion -> hunger -> prey -> settlement fire -> defenders -> alert -> grab / pick up -> eat -> lair -> region -> death.
- `lair.enter` banks carried loot (`hoard:banked`); `lair.respawn` loses it (`loot:lost`). The panel gains a hoard section (gold, pile picture in 5 tiers) and the altar (upgrade list with Buy buttons) and the Sleep until dusk / dawn buttons.

### 5.8 `save` v2

```json
{
  "version": 2,
  "dragon": { "stage": 1, "foodXp": 820, "hp": 200, "hunger": 60, "upgrades": ["iron_scales_1"] },
  "hoard": { "gold": 320, "relics": [] },
  "regions": { "farm": { "heat": 2.4, "lastIncident": 5120, "ruins": [{ "id": "farm.outpost.tower1", "at": 5000 }], "lootTaken": [{ "id": "farm.outpost.vault", "at": 5100 }] } },
  "world": { "region": "farm", "pos": [600, 12, -480], "yaw": 2.0, "mode": "ground", "clock": 0.62, "now": 5200 },
  "stats": { "played": 5200, "eaten": 40, "food": 820, "civilBurned": 3, "orderBurned": 5, "livestockTaken": 2 }
}
```

`now` is the game clock in seconds used for decay and rebuild timestamps. `migrate` v1 -> v2 fills defaults (gold 0, no upgrades, mode `air`, clock `clock.start`). A save in mode `ground` or `landing` restores on the ground; `takeoff` restores in the air.

## 6. Rendering and UI

| Element | Implementation |
| --- | --- |
| Touch layout | 3 fixed buttons (Breath, Boost, Roll) + Action (hold) + Move (tap) context slots; labels from i18n, icon + text; Roll hidden on the ground |
| Dragon on the ground | Legs extend on landing, 4-leg walk cycle tied to ground speed, wings folded, body pitch follows the slope; ground camera lower (height 6 x scale) and closer |
| Buildings | `InstancedMesh` per building type and per state (whole, ruin); fire = shared particle pool + flicker light for the nearest 2 fires; smoke columns |
| Defenders | Low-poly figures, one `InstancedMesh` per type; arrows as instanced thin boxes; bolts as a mesh; ballista aim line as a red fading line; awareness `?` (amber) / `!` (red) sprites |
| Alert | Small banner pips under the region name (0-3), pulse on change, toast "The Farmlands are on alert" |
| Hoard | Lair panel section: gold number + a pile picture in 5 tiers (inline SVG), altar list with cost, effect, Buy |
| Day / night | `render/sky.js` lerps sun direction, ambient, fog and sky colours; night keeps enough ambient to read the stick area and terrain on a phone |
| Fields and river | Vertex colour patches for fields, a water plane per river segment |

## 7. Task breakdown

Each task ends with both test runs passing and the browser check from the agent prompt. Sizes: S < 2 h, M 2-5 h, L 5-10 h of AI-assisted work.

| ID | Task | Depends on | Size | Acceptance |
| --- | --- | --- | --- | --- |
| T01 | Touch action layout: Breath, Boost, Roll fixed; Action (hold) and Move (tap) context slots; travel and cave prompts move to Move; desktop unchanged | - | M | At 390 x 844 portrait and 844 x 390 landscape no HUD element covers the stick or buttons; all phase 1 actions still playable on a phone; tap targets at least 44 px for the context slots |
| T02 | Perf readout and quality tiers: fps, draw calls, triangles in the debug panel; `?q=low|mid|high`, auto tier from the first 10 s of fps on touch | - | S | Readout visible on touch via DBG; low tier halves flora and shadow cost; tier saved in `localStorage` |
| T03 | Solo and co-op use `shared/dragon.js`; remove the two inline copies of `makeDragon` | - | S | Duel, tutorial and co-op render and animate the same as before (screenshots side by side); `node mp/sim.test.js` passes |
| T04 | `core/walk.js` + pilot modes, `canLand`, landing / takeoff transitions, terrain-only collisions (buildings come in T08), tests | - | L | Tests: landing refused when high, fast, steep or over water; walking stays on the surface, cannot climb slopes over `maxSlope`; takeoff ends airborne above `minAlt` |
| T05 | Legs and walk cycle in `shared/dragon.js`, ground camera, land / takeoff animation, Move slot Land / Fly + F key | T03, T04 | M | On a phone: Land appears near the ground, the dragon lands, walks with the stick, runs with Boost, takes off with Fly; duel flight pose unchanged |
| T06 | Ground actions: pick up prey in front, eat on the ground (vulnerable, cancelled by damage), breath along the ground | T05 | M | Hatchling lands next to a goat, picks it up, eats it on the ground; a boar charge cancels the meal; breath cooks prey from the ground |
| T07 | River Farmlands terrain: river, roads, plateaus, fields, palette; exit from Wildwood with `minStage`; Wildwood settlement plateaus | T04 | L | Region loads in under 1.5 s on a mid laptop; water not landable; hatchling sees the "Too small" prompt, Drake travels; no geometry leak after 5 round trips |
| T08 | `core/settlement.js` + `render/settlement-view.js`: templates, placement, solids for flight and walking | T07 | L | All 5 settlements render; the dragon cannot walk or fly through buildings; tests for `solidAt` and placement determinism |
| T09 | Building fire: ignite, burn, spread, ruins, rebuild timer; `stats.civilBurned` / `orderBurned` | T08 | M | A tower burns down in about 10 s of breath at hatchling stats; fire spreads only to neighbours; ruins come back after `fire.rebuild` |
| T10 | `core/perception.js`: cones, range factors, LOS, hearing, awareness, tests | T08 | M | Tests: hidden behind a hill = not seen; night and altitude shorten range; landing near a guard is heard |
| T11 | Peasants and archers: posts, AI states, bell, volleys, pooled arrows, burning defenders; awareness marks | T09, T10 | L | Archers on the outpost tower volley at a low dragon and stop when it climbs out of range; peasants run to the bell; at most 60 projectiles |
| T12 | Ballista: aim line, bolt, reload, crew, burnable platform | T11 | M | The aim line shows 2 s before each bolt; changing course dodges it; burning the crew or the platform stops it |
| T13 | `core/alert.js` + responses: extra archers, patrols on roads, village ballista at level 3, livestock inside; HUD pips; offline decay | T11, T12 | L | Tests: incidents raise heat as in data, decay after `quiet`, faster with a ruined tower, catch-up on region load; in game level 3 builds the village platform |
| T14 | Livestock: sheep and cows in pens and barns, alert on taking them, barn burn releases them | T13 | S | Taking a sheep raises heat by 1; at level 3 pens are empty and the barn holds the herd |
| T15 | `core/loot.js` + hoard: tithe chests and strongboxes, carry penalties, bank on lair enter, lose on death; hoard section in the lair panel | T06, T08 | M | Drake carries a strongbox at 80% speed without breath; entering the lair adds 150 gold; dying with it loses it and the vault refills after `fire.rebuild` |
| T16 | `core/upgrades.js` + altar: 4 upgrades, effects wired, guard sight cones | T15 | M | Buying iron scales cuts arrow damage by 30% (test); guard sight shows cones; gold cannot go negative |
| T17 | `core/clock.js` + `render/sky.js`: cycle, lighting, perception factor, Sleep until dusk / dawn | T10 | M | Night halves archer sight (test); a full cycle takes 20 min; night is readable on a phone screenshot |
| T18 | Save v2 + migration v1 -> v2: hoard, upgrades, region states, clock, ground pose | T13, T15, T16, T17 | M | Reload restores gold, upgrades, alert, ruins and a landed dragon; a phase 1 save migrates; corrupt v2 handled like v1 |
| T19 | Texts and tips: landing, raiding, alert and altar tips, EN + CS, touch wording pass, intro note for the Farmlands | T18 | M | Every new visible string from `i18n.js`; touch texts name buttons; all Phase 2 flows playable on a phone end to end |
| T20 | `test/raid.test.js` scripted raid bot + balancing pass | T18 | M | Seeded bot: Drake raids the outpost and banks a strongbox in 6-12 simulated min with at least 20% HP left at full hunger; alert reaches 3 after 3 raids and drops a level after 5 quiet min; numbers changed in `data.js` only |
| T21 | README campaign section update, controls table, mark Phase 2 done in `000_spec.md` | T20 | S | README lists landing, raiding, alert and the altar for phone and desktop |

Suggested order: T01, T02, T03, T04, T05, T06, T07, T08, T09, T10, T11, T12, T13, T14, T15, T16, T17, T18, T19, T20, T21.

## 8. Testing

| Level | What | How |
| --- | --- | --- |
| Unit | walk, settlement, perception, defenders, alert, loot, upgrades, clock, save v2 | `node campaign/test/run.js`, seeded `mulberry` RNG |
| Simulation | Raid bot: fly to the outpost, land, take the strongbox, escape, bank; invariants (projectiles bounded, gold never negative, heat 0..maxHeat, dragon never inside a solid) | `test/raid.test.js` |
| Regression | Phase 1 tests and the 30 min growth sim still pass; duel and co-op unaffected | both test runs + T03 screenshots |
| Manual | Phone first: land, walk, raid, bank, buy, night raid, reload; then desktop | Checklist in each PR, phone steps first |

## 9. Performance budget

| Metric | Budget |
| --- | --- |
| Frame rate | 30+ fps on a mid phone in the Farmlands at the outpost under fire, 50+ fps on a mid laptop |
| Draw calls | under 300 in the Farmlands |
| Defenders | 30 active max per region, full AI within 400 of the dragon, 4 Hz beyond |
| Projectiles | 60 max, pooled |
| Fire lights | 2 dynamic lights max; other fires are particles only |
| New JS | under 150 KB unminified for this phase |

## 10. Risks

| Risk | Mitigation |
| --- | --- |
| Walking a 2.4x scale drake feels stiff on a phone | Tank steering with generous turn rate, ground camera tuned in T05; Pavel validates T05 before the kingdom tasks build on it |
| Archer chip damage plus hunger makes raids frustrating | Iron scales, balancing in T20 against the HP target, arrows dodgeable at speed |
| Too many buttons on a phone | Context slots only (section 6); no new fixed button in this phase |
| 5 settlements + fire particles hurt phones | Quality tiers from T02, instancing, 2 dynamic lights, far AI at 4 Hz |
| T03 touches duel and co-op code | Screenshot comparison and the mp tests; no behaviour changes beyond swapping the model source |
| Region state grows the save | Store only ruins, taken loot and heat with timestamps; rebuilt entries are pruned |

## 11. Open design questions (recommended defaults)

- Loot in the claws (one slot shared with prey) or a separate gold pouch? Default: claws, so a raid forces a choice between food and gold.
- Farmlands gated until Drake? Default: yes; hatchlings raid the small Wildwood outpost.
- Burning civilian buildings: only alert for now, Renown later? Default: yes, counted in `stats` for Phase 4.
- Walking steering on touch: tank (up = forward, sides = turn) or stick direction relative to the camera? Default: tank, it fits the chase camera.
- Hoard pile: panel picture now, 3D lair scene later? Default: panel picture.
- Destroyed buildings and taken loot come back after 10 min of game time? Default: yes (`fire.rebuild`, 600 s).
