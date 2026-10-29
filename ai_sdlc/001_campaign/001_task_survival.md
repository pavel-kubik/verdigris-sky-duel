# Phase 1 - Survival MVP: Implementation Spec

Status: ready for implementation, 2026-10-28. Branch: `campaign-phase-1`. Parent spec: [`000_spec.md`](000_spec.md).

## 1. Goal

Ship a playable campaign slice at `/campaign/`: a hatchling dragon hatches in a volcano lair, hunts goats, deer and boar across two regions (Ash Wastes, Wildwood), manages hunger, grows visibly and becomes a Drake after resting in the lair. Progress survives a page reload.

**Exit criteria (from the roadmap):** a new player can hunt, starve, recover and reach Drake in about 30 minutes; save survives reload.

### In scope

| Area | Phase 1 content |
| --- | --- |
| Regions | Ash Wastes (volcano lair), Wildwood; edge transition between them |
| Dragon | Hatchling and Drake stages, continuous visual growth, stats from stage table |
| Survival | Hunger meter with Fed / Hungry / Starving, HP floor, HP regen when fed |
| Prey | Goat, deer, boar; graze / flee AI; boar fights back |
| Hunting | Grab, carry, eat in flight, burn to roast, roast chunks at 50% food |
| Lair | Enter cave, rest (save, heal, stage-up), larder (store and eat), leave |
| Death | Respawn at lair, carried prey lost |
| Save | `localStorage`, schema v1, autosave + migrations hook |
| UI | HUD (vitality, fire, hunger, stage, carry), prompts, lair panel, EN + CS texts |

### Out of scope (later phases)

Settlements, defenders, alert, Renown, missions and timer, hoard and upgrades, aeries, day / night, Wyrm and Elder stages, fish, landing on the ground, co-op. Data shapes below leave room for them but no code paths are built.

## 2. Constraints from the current codebase

| Fact | Consequence for Phase 1 |
| --- | --- |
| No build step; Three.js r128 from cdnjs; plain `<script>` tags | Campaign is plain ES2017 scripts, no bundler, no ES modules |
| Solo game is one inline script in `index.html` (~920 lines) | Do not grow it; campaign lives in its own page like `/mp/` |
| `mp/sim.js` is a pure UMD module (browser `window.VSim`, Node `require`) tested by `node mp/sim.test.js` | All campaign logic follows the same pattern: pure core modules + Node tests, rendering kept separate |
| `makeDragon()` exists twice (`index.html`, `mp/game.js`) | Extract a third copy into `shared/dragon.js` for campaign only; dedupe solo and co-op later (not in this phase) |
| Flight: `stepPilot()` with hard-coded `WORLD_R = 430`, terrain `H()`, min altitude 8 | Campaign gets its own parametrised `flight.js` (copied from `stepPilot`, not shared), so duel and co-op stay untouched |
| Texts in `i18n.js`, EN + CS, `data-i18n` attributes | All new strings go there under the `c.` prefix |
| `sw.js` precaches a fixed `SHELL` list, bump `VERSION` on list change | Add campaign files, bump `vsd-v1` to `vsd-v2` |
| `localStorage` keys are prefixed `vsd-` | Campaign save key `vsd-campaign` |

**Data files are JS, not JSON.** The parent spec says JSON; Phase 1 uses JSON-shaped object literals in `campaign/core/data.js` instead, because a no-build page and Node tests both load them synchronously with no fetch, and the offline cache needs no extra entries. Contents stay plain data (no functions) so a later switch to `.json` is mechanical.

## 3. File structure

```
campaign/
  index.html            page shell: canvas, HUD markup, panels, script tags
  game.js               Three.js glue: scene, input, main loop, HUD updates, panels
  render/
    terrain.js          chunked region terrain mesh, water, fog, volcano, lava glow
    flora.js            instanced trees and rocks from region data
    prey-view.js        prey meshes (instanced per type), carry attachment, roast colouring
  core/                 pure logic, no DOM, no THREE - runs in browser and Node
    umd.js              tiny module helper (define / require for both environments)
    math.js             vector + RNG helpers (array vectors, as in mp/sim.js)
    events.js           minimal event emitter
    data.js             all tunables: stages, hunger, prey types, regions, controls
    terrain.js          heightAt / surfaceAt(regionId, x, z), pure, used by flight, prey and renderer
    growth.js           stage + stat curves from cumulative food
    hunger.js           drain, states, effects
    flight.js           parametrised dragon flight (from mp/sim.js stepPilot)
    prey.js             herd spawning, prey AI, grab / carry / eat / cook
    region.js           region bounds, edge transitions, spawn points
    lair.js             cave trigger, rest, larder, respawn
    state.js            CampaignState: one object + step(dt, input) orchestration
    save.js             serialise / deserialise / migrate, storage adapter
  test/
    run.js              runs every *.test.js: `node campaign/test/run.js`
    growth.test.js
    hunger.test.js
    flight.test.js
    prey.test.js
    region.test.js
    lair.test.js
    save.test.js
    sim.test.js         long seeded run of the whole state machine
shared/
  dragon.js             makeDragon(palette) extracted from index.html (window.VDragon)
```

Changes to existing files: `index.html` (one link on the home screen), `i18n.js` (new keys), `sw.js` (SHELL + VERSION), `README.md` (campaign section).

### Module pattern (`core/umd.js`)

Every core file registers itself under a name and pulls dependencies through the same helper, so it works with `<script>` tags and with Node `require`:

```js
// core/hunger.js
(function (root) {
  'use strict';
  const M = typeof module === 'object' && module.exports ? require('./umd.js') : root.VCamp;
  const D = M.need('data');
  /* ... */
  M.define('hunger', { step, stateOf, effects });
})(typeof self !== 'undefined' ? self : this);
```

`umd.js` keeps a registry on `window.VCamp` in the browser and on `module.exports` in Node; `need(name)` returns the registered module (in Node it `require`s `./<name>.js` first). Script tags in `index.html` load core files in dependency order: `umd, math, events, data, terrain, growth, hunger, flight, prey, region, lair, state, save`.

## 4. Data schemas (`core/data.js`)

All numbers are starting values for tuning. Units: world units (the duel world radius is 430), seconds, food points.

### 4.1 Stages

```js
stages: [
  { id: 'hatchling', foodFrom: 0,   growthFrom: 0.00, scaleFrom: 1.0, scaleTo: 1.5,
    hp: 100, turn: 1.00, cruise: 30, boost: 54, hungerMult: 1.0, spot: 1.0, carry: 1 },
  { id: 'drake',     foodFrom: 600, growthFrom: 0.25, scaleFrom: 1.6, scaleTo: 2.4,
    hp: 220, turn: 0.85, cruise: 32, boost: 56, hungerMult: 1.5, spot: 1.5, carry: 2 },
  // wyrm (foodFrom 2400, growthFrom 0.55) and elder are Phase 4-5; Phase 1 caps food XP at 2399
],
growthCap: { food: 2399 },
```

- `carry`: max prey size class the dragon can lift (1 = small, 2 = medium, 3 = large, 4 = huge).
- `turn` multiplies the yaw rate (base 1.55 rad/s from `stepPilot`).
- Visual scale grows continuously from `scaleFrom` toward `scaleTo` as food XP rises within the stage, so growth is felt between stage-ups. Note the drake starts at 1.6 to make the stage-up jump visible.

### 4.2 Hunger

```js
hunger: {
  max: 100, start: 80,
  drain: 0.28,            // per second at hungerMult 1 (100 to 0 in about 6 min)
  boostDrain: 0.25,       // extra per second while boosting
  breathDrain: 0.15,      // extra per second while breathing fire
  states: { hungry: 30, starving: 10 },
  fedHpRegenAbove: 80, fedHpRegen: 1.0,      // HP per second
  hungryStRegenMult: 0.5,
  starving: { speedMult: 0.7, breath: false, carryMax: 1, hpDrain: 0.5, hpFloor: 0.25 },
},
```

### 4.3 Prey

```js
prey: {
  goat: { size: 1, food: 20, hp: 20, speed: 9,  flee: 9,  fleeRange: 45, herd: [3, 5], fights: false },
  deer: { size: 1, food: 30, hp: 30, speed: 14, flee: 18, fleeRange: 70, herd: [3, 6], fights: false },
  boar: { size: 2, food: 45, hp: 60, speed: 10, flee: 12, fleeRange: 40, herd: [1, 3], fights: true,
          charge: { range: 14, maxAboveGround: 7, damage: 8, cooldown: 3 } },
},
roast: { foodMult: 0.5, chunkSize: 1, chunkFood: 11.5, cookTime: 1.2, cool: 0.5, life: 120 },   // n = ceil(food * foodMult / chunkFood) chunks, food split evenly
breath: { range: 30, cone: 0.42, mouth: 2.8 },   // cone from the mouth, range x dragon scale
grab: { radius: 6, maxAboveGround: 8, maxPitch: -0.12, key: 'KeyG' },
eat:  { time: 2.5, speedCap: 18, key: 'KeyX' },
respawn: { herdCooldown: 90, minDistFromDragon: 250 },
```

- `fleeRange` is multiplied by the dragon's stage `spot`: a bigger dragon scares prey from further away.
- A burned prey (cooked by breath for `cookTime` seconds of exposure) dies and leaves roast chunks. Chunks are size 1, so a hatchling can feed on a boar by burning it.

### 4.4 Regions

```js
regions: {
  ash: {
    nameKey: 'c.region.ash', radius: 1100, seed: 11, ceiling: 320,
    terrain: { amp: 1.4, base: 2, features: [
      { type: 'cone', x: 0, z: 0, r: 260, h: 150, crater: { r: 38, depth: 30 } },
      { type: 'flatten', x: 0, z: 0, r: 1100, toward: 6, from: 700 },
    ] },
    palette: 'ash',
    lair: { x: 0, z: 150, y: 70, r: 18 },          // cave mouth on the volcano's south flank
    spawn: { x: 0, z: 260, y: 110, yaw: Math.PI },  // respawn point in front of the cave
    flora: { trees: 60, rocks: 140 },
    herds: [{ type: 'goat', count: 4, ring: [350, 900] }],
    exits: [{ to: 'wild', angleFrom: -0.6, angleTo: 0.6 }],   // radians around +Z axis, north arc
  },
  wild: {
    nameKey: 'c.region.wild', radius: 1100, seed: 23, ceiling: 280,
    terrain: { amp: 1.0, base: 4, features: [] },
    palette: 'forest',
    flora: { trees: 1400, rocks: 120 },
    herds: [{ type: 'deer', count: 5, ring: [200, 1000] }, { type: 'boar', count: 3, ring: [300, 1000] },
            { type: 'goat', count: 2, ring: [600, 1000] }],
    exits: [{ to: 'ash', angleFrom: Math.PI - 0.6, angleTo: Math.PI + 0.6 }],
    entries: { ash: { angle: Math.PI } },
  },
},
```

`angleFrom` / `angleTo` are wrapped with `wrap()` before comparison. A region without a matching exit for the dragon's heading keeps the existing soft boundary (steer back toward the centre).

## 5. System interfaces (`core/`)

Vectors are `[x, y, z]` arrays, as in `mp/sim.js`. All functions are pure or mutate only the object passed in. `rng` is a seeded function returning [0, 1), injected for testability.

### 5.1 `terrain`

```js
heightAt(regionId, x, z) -> number        // deterministic; the renderer samples it on the mesh grid
surfaceAt(regionId, x, z) -> number       // the drawn surface: heightAt on GRID corners, same triangle split as the mesh
clampToRegion(regionId, pos, minAlt)      // keeps pos inside radius and >= surface + minAlt (mutates)
slopeAt, lairPos, lavaLevel, GRID (7.5), CHUNK (300)
```

Base noise is the duel `H()` formula with the region `seed` as phase offset, scaled by `terrain.amp`, plus features. All collision and placement uses `surfaceAt`, not `heightAt`: the duel noise has detail finer than the 7.5-unit mesh grid (up to about 3.5 units of difference), so only the interpolated surface matches what the player sees. `cone` adds a smooth volcano with a crater; `flatten` lerps toward height `toward` beyond `from`.

### 5.2 `growth`

```js
stageOf(foodXp) -> { index, id, def, progress }   // progress 0..1 within the stage
growthValue(foodXp) -> 0..1                        // for the save and future curves
scaleOf(foodXp, stageIndex) -> number              // continuous, capped at the stage's scaleTo
readyStage(foodXp, currentStageIndex) -> index     // stage the dragon WOULD reach on rest
statsOf(stageIndex, hungerState) -> { hpMax, turn, cruise, boost, spot, carry, hungerMult, canBreath }
addFood(cs, food)                                  // food XP += food, capped at growthCap.food
```

Rule: `cs.dragon.stage` changes only in `lair.rest()`. Eating keeps adding XP and visual scale up to the current stage's `scaleTo`; a toast says "Rest in the lair to grow" once XP crosses the next `foodFrom`.

### 5.3 `hunger`

```js
stateOf(hunger) -> 'fed' | 'hungry' | 'starving'
step(cs, dt, { boosting, breathing, inLair })   // drains, applies HP regen / drain + floor, emits 'hunger:state' on change
effects(state) -> { speedMult, stRegenMult, canBreath, carryMax, hpRegen, hpDrain }
feed(cs, food)                                  // hunger = min(max, hunger + food); also calls growth.addFood
```

HP floor: starvation drain never takes HP below `hpFloor * hpMax`. Other damage (boar) can.

### 5.4 `flight`

```js
newPilot(pos, yaw) -> pilot      // same fields as mp/sim.js newPilot + carry, eatT
step(pilot, input, dt, ctx)      // input {sx, sy, breath, boost}; ctx {regionId, stats, effects, minAlt, eating}
tryRoll(pilot, dir)
```

Copied from `stepPilot` with these changes: world radius, ceiling and ground from `ctx.regionId`; yaw rate `1.55 * stats.turn`; target speed from `stats.cruise` / `stats.boost` times `effects.speedMult`, capped at `eat.speedCap` while eating; breath allowed only if `effects.canBreath`; stamina regen times `effects.stRegenMult`; minimum altitude 5 (duel uses 8) so low passes over prey work. No `down` spiral: death is handled by `state`.

### 5.5 `prey`

```js
spawnRegion(regionId, rng, avoid?) -> field   // { regionId, herds, list, nextId }: herds from region data on valid ground
step(field, dragon, dt, ctx) -> events[]      // dragon {pos, inv}, ctx {stats, rng}; AI, charge damage, herd respawn
remove(field, preyId); census(field)          // eaten / stored prey; counts per state for the debug panel
tryGrab(field, dragon, stats, effects) -> prey|null
cook(field, breathCone, dt) -> events[]          // exposure accumulates; at cookTime the prey dies and becomes chunks
drop(prey, pos)                                 // releases a carried prey (death, larder)
```

Prey object:

```js
{ id, type, herd, pos: [x, y, z], yaw, state: 'graze' | 'flee' | 'charge' | 'carried' | 'roast',
  hp, cook: 0, food, size, cd: 0, t: 0 }
```

AI states:

| State | Behaviour | Exit |
| --- | --- | --- |
| graze | Wander slowly around herd centre, random pauses | Dragon within `fleeRange * stats.spot` and below 60 above ground -> flee (boar: charge if it `fights` and dragon is low) |
| flee | Run away from the dragon at `flee` speed, herd scatters (each picks a spread angle) | Dragon further than 1.6 x range for 4 s -> graze |
| charge | Boar runs at the dragon's ground projection; hit if within `charge.range` and dragon less than `maxAboveGround` above ground: damage, then `cooldown` | Dragon climbs above 30 -> flee |
| carried | Position follows the dragon's claws | Eaten, dropped, stored |
| roast | Static chunk on the ground, size 1, its share of the roast food | Grabbed |

Grab succeeds when: grab key held, prey within `grab.radius * scale` horizontally, dragon less than `grab.maxAboveGround + grab.clawDrop * scale` above the prey, `pitch <= grab.maxPitch` (0.25: not climbing hard - a strict dive-only rule fights the pull-up at the altitude floor), `prey.size <= min(stats.carry, effects.carryMax)`, nothing already carried. Taking one animal sends the rest of its herd fleeing. Orchestration lives in `core/state.js` from T09 on: `state.step` runs flight, hunger, prey, grab and eat in that order; a boar hit ends eating for that frame and resets progress. A failed grab on an oversized prey shows a "Too heavy" tip once.

A field (not a bare list) keeps herd bookkeeping, which respawning needs. Herds respawn `respawn.herdCooldown` seconds after being emptied, at least `minDistFromDragon` away. Only prey within 600 of the dragon run full AI each frame; the rest tick at 4 Hz.

### 5.6 `region`

```js
exitAt(regionId, pos, yaw) -> exit|null   // dragon within 60 of the radius, heading outward, inside an exit arc
enter(cs, toRegionId, fromRegionId)       // sets cs.region, places the dragon at the entry edge facing inward, respawns prey
```

Flow: `exitAt` non-null shows the prompt "Fly to Wildwood - press Enter" (touch: a button). `state.step` keeps the offer for `travel.promptHold` seconds after the dragon turns back, and on `confirm` calls `region.enter` itself (so travel is testable in Node); `game.js` reacts to `region:enter` by disposing the region scene and building the new one behind a short fade (autosave arrives in T14). Without confirmation the soft boundary turns the dragon back as usual.

Implementation notes (T11):
- Inside an exit arc the flight soft boundary narrows from 120 to `travel.softEdge` (45); with the full 120 band the steer-back turns a cruising dragon around before it reaches the exit band (`travel.edgeBand`, 90).
- A carried prey travels with the dragon into the new region (re-homed into the new field without a herd), so Wildwood prey can be brought to the lair larder in T12.
- Entry: `travel.entryInset` (220) inside the new radius on the `entries[from]` angle, facing the centre, at about the same height above ground (clamped around `travel.entryAlt`); new herds spawn at least `respawn.minDistFromDragon` away.

### 5.7 `lair`

```js
inMouth(cs) -> boolean                   // dragon inside the lair sphere (ash region only)
enter(cs)                                // stores a carried prey into the larder if room, sets cs.inLair, emits 'lair:enter'
rest(cs) -> { grew: boolean, from, to }  // HP to max, stamina to max, stage-up if readyStage > stage, autosave
eatFromLarder(cs, index)                 // hunger.feed with the stored item's current food
leave(cs)                                // places the dragon at region.spawn, cs.inLair = false
respawn(cs)                              // after death: carried prey lost, HP 50% of max, hunger max(hunger, 40), at the lair
spoil(cs, dt)                            // larder items lose 1 food per 30 s, removed at 0
```

Larder capacity: 3 items. While `cs.inLair` the simulation is paused except `spoil` (hunger does not drain).

Implementation notes (T12):
- Flying into the mouth sphere (`lair.r`, x0.8 of the dragon scale once it is above 1.25) enters the lair at once, no confirm; a carried prey goes into the larder, or stays in the claws with a "Larder full" note.
- Near the mouth (`lair.nearRange`, 140) and heading toward it the prompt says "Fly into the cave to rest" (carrying: "... to store it - or hold X / Eat").
- The panel (Rest, larder list with Eat buttons, stage progress, vitals, Leave) works by tap and by mouse / Tab + Enter, so it needs no extra hotkeys. `state.lairRest / lairEat / lairLeave` are the panel actions.
- Spoilage is continuous (food is a float, shown rounded) and runs inside and outside the lair. Rest does not pass time. `respawn` is left to T13 and the autosave on rest to T14.
- Debug: `L` / "to lair" puts the dragon in the mouth (replaces the old rest stand-in).

Implementation notes (T13):
- `state.step` kills at `hp <= 0` (a boar's charge can now take the last HP; starvation still stops at its floor). `lair.respawn(cs, cause)` emits `dragon:died { cause, region, lost }`, then `region:enter { respawn: true }` when the dragon died outside the lair region (a fresh Ash Wastes prey field), then `lair:enter { respawn: true }`.
- The dragon wakes INSIDE the lair (`cs.inLair = true`, pilot parked at the mouth): the lair panel opens with a "You fell - you wake in the lair" card naming the lost prey. HP is `respawnHp` (50%) of max, hunger `max(hunger, respawnHunger)`; stage, food XP, stamina and the larder are kept; `dragon.deaths` counts deaths. Rest heals fully as usual, Leave puts the dragon at the spawn.
- Debug: `Z` / "die" sets HP to 0 (`K` / "-20 HP" can also kill now).

### 5.8 `state` (CampaignState)

```js
create(rng, saved?) -> cs
step(cs, input, dt) -> events[]   // orchestrates: flight -> hunger -> prey (AI, cook, grab) -> eat -> lair -> region -> death
```

```js
cs = {
  version: 1,
  region: 'ash',
  dragon: { pilot, stage: 0, foodXp: 0, hp: 100, hunger: 80, carried: null, eatT: 0, deaths: 0 },
  larder: [ { type: 'deer', food: 30 } ],
  prey: [ /* runtime only, never saved */ ],
  inLair: true,
  flags: { introSeen: false, readyToastShown: false },
  stats: { played: 0, eaten: 0, food: 0 },           // seconds, count, food points
  ev: [],                                            // events produced this step
  bus,                                               // events.js emitter, runtime only
}
```

Input from `game.js`: `{ sx, sy, breath, boost, grab, eat, confirm, roll }` (booleans except `sx`, `sy` in -1..1).

Eating: `eat` held while carrying a prey runs `eatT` up to `eat.time`; releasing resets it. On completion `hunger.feed(prey.food)` and the prey is removed. Eating is cancelled by taking damage.

Death: `hp <= 0` -> event `dragon:died`, carried prey removed, `lair.respawn(cs)`, a short "You wake in the lair" card.

Events emitted (`cs.ev` + bus): `hunger:state`, `prey:flee`, `prey:grabbed`, `prey:tooHeavy`, `prey:eaten`, `prey:roasted`, `boar:hit`, `growth:ready`, `stage:up`, `lair:enter`, `lair:stored`, `region:exit`, `region:enter`, `dragon:died`, `save`.

### 5.9 `save`

```js
serialise(cs) -> object            // only durable fields (no prey, pilot reduced to pos + yaw)
deserialise(obj, rng) -> cs        // runs migrate() first
migrate(obj) -> obj                // version switch; v1 is identity, future versions chain
load(storage) / store(storage, cs) // storage = localStorage or an in-memory stub in tests; try/catch like store() in index.html
```

Saved v1 shape (subset of the parent spec's target shape, with Phase 1 fields):

```json
{
  "version": 1,
  "dragon": { "growth": 0.18, "stage": 0, "foodXp": 430, "hp": 100, "hunger": 64, "upgrades": [] },
  "hoard": { "gold": 0, "relics": [] },
  "larder": [{ "prey": "deer", "food": 27 }],
  "renown": 0,
  "regions": { "ash": {}, "wild": {} },
  "missions": { "completed": [], "active": null },
  "story": { "act": 1 },
  "world": { "region": "wild", "pos": [120, 80, -340], "yaw": 1.2, "location": "field" },
  "flags": { "introSeen": true },
  "stats": { "played": 1240, "eaten": 17, "food": 430 }
}
```

Key: `vsd-campaign`. Autosave on: rest, region change, every 60 s of play, `visibilitychange` to hidden. A corrupt or newer-than-known save opens a "Start new / keep" choice instead of crashing.

Implementation notes (T14):
- Core decides WHEN to save: `state.step` (and `lairRest`) emit `{ e: 'save', why }` on rest, region change, death and every `save.every` (60) s of play; `game.js` writes it to `localStorage`, also on `visibilitychange` to hidden, `pagehide` and Menu. Death is an extra trigger, so a reload cannot bring back the prey lost in the fall.
- `save.apply(cs, obj)` writes a save INTO the existing state (same `cs`, `cs.dragon` and pilot objects, which the renderer holds); `deserialise` is `apply` on a new state. Values are clamped (position into the region and above the ground, HP 1..max, hunger, XP cap, larder size); a missing / non-finite core field or an unknown stage is `corrupt`.
- Not saved: the prey field (fresh herds spawn away from the restored dragon) and the carried prey (a reload drops it). Saved extras: `dragon.deaths`, `world.st` (fire), `flags.rested`.
- v0 (the migration test fixture) is a flat unversioned shape `{ xp, stage, hunger, hp, region, pos, yaw, larder }`.
- Intro: with a save, "Continue" (shows stage, region, food) and "New hatchling" (press twice). An unreadable save shows "Start new" (deletes it) or "Keep it" (plays with saving off, the old save untouched).
- Debug: `V` / "save" saves now, `U` / "wipe save" deletes the save and reloads.

## 6. Rendering and UI (`game.js`, `render/`)

| Element | Implementation |
| --- | --- |
| Terrain | Region split into 300 x 300 chunks, 40 x 40 segments each, vertex colours from palette; chunks beyond 950 from the camera hidden; `scene.fog` near 400, far 950 |
| Volcano | Part of the terrain function; crater lava = emissive disc + slow particle smoke; cave mouth = dark arch mesh at `lair` with an orange point light |
| Flora | `InstancedMesh` per kind (conifer, broadleaf, rock), positions from seeded RNG, skipped on steep slopes and inside the cone |
| Prey | Low-poly primitives like the tutorial chicken; one `InstancedMesh` per type, matrices updated each frame; roast colour lerp reuses the chicken RAW / GOLDEN / ROAST colours |
| Dragon | `VDragon.makeDragon(GREEN)`, `root.scale.setScalar(scaleOf(...))`; chase camera distance scales with dragon scale |
| Breath | Same particle system as solo (copied into `game.js`); cone also passed to `prey.cook` |
| HUD | Existing vitality and fire bars + new hunger bar (amber when hungry, pulsing red when starving), stage label with growth progress ring, carry icon, eat progress ring, region name toast |
| Prompts | Bottom-centre prompt line: "Hold G to grab", "Hold X to eat", "Too heavy", "Fly to Wildwood - Enter", "Rest in the lair to grow" |
| Lair panel | DOM panel like `#pause`: Rest, larder list with Eat buttons, current stage and next stage threshold, Leave |
| Intro | First start only: the hatching scene (`render/hatch-scene.js`, about 20 s, Skip button / Esc: the mother curled around the small egg, cracks, the hatchling climbs out), then the 3-line hatching card, then the lair panel. Moved here from phase 2 T04 on Pavel's request (2026-10-29) |
| Touch (first priority, see `000_spec.md` 1) | Existing stick + buttons, plus Grab and Eat buttons; region prompt is a tappable button; every keyboard action, debug hotkeys included, has a touch control (`?debug`: DBG button toggles the panel, one button per debug action) |
| Home link | `index.html` intro gets "Campaign (alpha)" next to the co-op link, `href="campaign/"` |

Controls added: `G` grab (hold), `X` eat (hold), `Enter` confirm prompt, `Esc` pause (existing). `G`, `X` and `Enter` are free in the current key map.

## 7. Task breakdown

Each task ends with its tests passing (`node campaign/test/run.js` and `node mp/sim.test.js`) and is one commit. Sizes: S < 2 h, M 2-5 h, L 5-10 h of AI-assisted work.

| ID | Task | Depends on | Size | Acceptance |
| --- | --- | --- | --- | --- |
| T01 | Scaffold `/campaign/` page: `index.html`, empty `game.js`, Three.js scene with sky and fog, link from home screen, `sw.js` SHELL + `vsd-v2`, first `c.*` i18n keys | - | S | Page loads offline after one online visit; EN / CS switch works; duel and co-op unchanged |
| T02 | `shared/dragon.js`: extract `makeDragon` from `index.html` as `window.VDragon`; campaign renders the dragon in a test pose | T01 | S | Dragon renders identically to solo preview; solo page untouched |
| T03 | `core/umd.js`, `math.js`, `events.js`, `data.js` + `test/run.js` | - | S | `node campaign/test/run.js` runs and reports 0 tests ok |
| T04 | `core/terrain.js` + `render/terrain.js` + `render/flora.js` for both regions, volcano, cave mouth | T01, T03 | L | Both regions render at 50+ fps on a mid laptop; `surfaceAt` matches the mesh exactly (raycast check); deterministic for a seed |
| T05 | `core/flight.js` + input wiring + chase camera; dragon flies in Ash Wastes | T02, T04 | M | Flight test: 2 min random input stays finite, in bounds, above ground + 5; feel matches duel at hatchling stats |
| T06 | `core/growth.js` + tests; dragon scale driven by `foodXp` | T03 | S | Unit tests for stage thresholds, scale caps, `readyStage`; debug key `?debug` adds 100 food |
| T07 | `core/hunger.js` + tests + hunger bar + effects applied to flight | T05, T06 | M | Tests: drain rates per stage, state boundaries, HP floor never crossed by starvation, regen above 80 |
| T08 | `core/prey.js` spawn + AI (graze, flee, charge) + `render/prey-view.js` | T04, T05 | L | Herds graze and scatter when the dragon passes low; boar charges and hits only when the dragon is below 7; tests for flee range scaling with `spot` |
| T09 | Grab, carry, eat in flight, "too heavy" rule | T07, T08 | M | Hatchling can grab goat and deer, not boar; eating 2.5 s feeds hunger and food XP; damage cancels eating |
| T10 | Breath cooking: prey exposure, roast chunks at 50% food | T09 | M | Burned boar yields 2 chunks totalling 22.5 food, burned deer 2 chunks totalling 15; chunks grabbable by a hatchling |
| T11 | `core/region.js`: exits, prompt, region swap with disposal, entry placement, prey respawn | T04, T08 | M | Ash to Wildwood and back with no leaked geometry (renderer.info stable after 5 round trips) |
| T12 | `core/lair.js` + lair panel: enter, store, rest, stage-up, eat from larder, leave, spoil | T09, T11 | M | Rest heals and stages up only when XP is ready; larder holds 3, spoils; hunger paused inside |
| T13 | Death and respawn at the lair, carried prey lost | T12 | S | Test: death while carrying drops the prey, respawns with HP 50%, hunger at least 40 |
| T14 | `core/save.js` + autosave triggers + load on start + corrupt-save handling | T12 | M | Reload mid-flight restores region, position, stage, XP, hunger, larder; migration hook tested with a fake v0 |
| T15 | Intro card, prompts, toasts, touch Grab / Eat buttons, all EN + CS texts | T09-T14 | M | Every new visible string comes from `i18n.js`; touch play is possible end to end on a phone |
| T16 | `test/sim.test.js` long seeded run + balancing pass against the 30 min target | T14 | M | Scripted bot reaches Drake in 25-35 simulated min; numbers adjusted in `data.js` only |
| T17 | README campaign section, controls table update, mark Phase 1 done in `000_spec.md` | T16 | S | README describes `/campaign/` and the test command |

Suggested order: T01, T03 (parallel), T02, T04, T05, T06, T07, T08, T09, T10, T11, T12, T13, T14, T15, T16, T17.

## 8. Testing

| Level | What | How |
| --- | --- | --- |
| Unit | growth, hunger, prey rules, region exits, lair, save | `node campaign/test/run.js`, same `ok()` style as `mp/sim.test.js`, seeded `mulberry` RNG |
| Simulation | 30 simulated minutes with a scripted hunter bot: finite state, invariants (hunger 0-100, HP floor under starvation, prey count bounded, stage only changes on rest) | `test/sim.test.js` |
| Regression | Duel and co-op unaffected | `node mp/sim.test.js` + manual play of solo and tutorial |
| Manual | Playthrough from new save to Drake on desktop and on a phone, offline reload | Checklist in the PR description |

## 9. Performance budget

| Metric | Budget |
| --- | --- |
| Frame rate | 50+ fps on a mid laptop at 1080p, 30+ fps on a mid phone |
| Draw calls | under 250 in Wildwood |
| Active prey | 40 max per region, full AI only within 600 of the dragon |
| Region swap | under 1.5 s on a mid laptop |
| New JS | under 120 KB unminified for `campaign/` + `shared/` |

## 10. Risks

| Risk | Mitigation |
| --- | --- |
| Flight model cannot land, so ground eating from the parent spec is not possible | Phase 1 eats in flight with a speed cap; landing is evaluated in Phase 2 when defenders make ground time risky |
| Grabbing at minimum altitude feels fiddly | Generous grab radius scaled by dragon size, min altitude 5 instead of 8, prompt shows when a grab is possible |
| 1400 trees hurt phones | Instancing + chunk culling; `flora.trees` halved when `isTouch` |
| Region size 1100 radius is smaller than the parent spec's 2-3 min target | Radius lives in `data.js`; tune during T16 once frame rate is measured |
| Copying `makeDragon` and `stepPilot` a third time | Accepted for Phase 1 to keep duel and co-op untouched; dedupe task planned before Phase 2 |

## 11. Decisions taken for Phase 1 (to confirm)

- Grab is **hold G near prey while diving** (parent spec option A), not auto-grab.
- Eating happens **in flight** with a 2.5 s hold, not on the ground.
- Region radius **1100**, tuned in T16.
- Data in **`core/data.js`** (JS object literals) instead of JSON files.
- Campaign is a **separate page** `/campaign/`, like co-op.
