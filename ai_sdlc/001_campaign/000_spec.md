# Campaign Mode - Design Spec

Status: approved concept, 2026-10-28. Source of truth for all campaign phases; phase task files (`001_task_*.md`, ...) refine this spec for implementation.

## 1. Overview

Campaign mode turns the duel game into a growth story: a hatchling dragon hunts to survive, raids the oppressor's castles in timed missions and grows into an elder wyrm. It is a new mode next to duel, co-op and tutorial, reusing the existing flight, breath and combat code.

**Core tension:** bigger means stronger, but also hungrier, slower and easier to spot. A hatchling sneaks and steals; an elder burns fortresses.

### Platform priority: mobile first

The campaign is designed and built **mobile first** (touch phone, portrait and landscape); desktop (keyboard + mouse) stays supported but has lower priority.

- Every action has a touch control. A feature is not done until it is playable end to end on a phone; a keyboard-only action is a bug.
- Every keyboard shortcut has a touch alternative, including debug tools: on touch, `?debug` shows a DBG button that toggles the debug panel, and every debug hotkey is a button in that panel.
- On touch, texts name the on-screen buttons, never keys (separate `...Touch` i18n keys where the wording differs).
- Layout is checked at phone width (390 x 844) first: HUD, prompts and panels must not cover the stick or the action buttons; tap targets at least 36 px.
- Performance budgets are set for a mid phone (see the phase specs).

**Touch action layout (from Phase 2 on).** The right thumb has a fixed set of buttons, so new actions reuse slots instead of adding buttons:

| Slot | Kind | Air | Ground |
| --- | --- | --- | --- |
| Breath | Fixed, hold | Fire | Fire |
| Boost | Fixed, hold | Boost | Run |
| Roll | Fixed, tap | Barrel roll | - (hidden) |
| Action | Context, hold | Grab / swoop, Eat | Pick up, Eat |
| Move | Context, tap | Land, Fly to region, Enter cave | Fly (take off) |

The context slots show the action that applies right now (label and icon change) and hide when nothing applies. Desktop keeps one key per action.

### Core loop

```
        +----------------+          +----------------+
        |  Volcano lair  |  ----->  |      Hunt      |
        | rest, save,    |          | eat prey -     |
        | stage-up,      |          | hunger +       |
        | spend hoard    |          | growth XP      |
        +----------------+          +----------------+
                ^                           |
                |                           v
        +----------------+          +----------------+
        | Kingdom reacts |  <-----  | Timed mission  |
        | alert rises,   |          | 5-10 min raid -|
        | defenses adapt |          | gold, relics   |
        +----------------+          +----------------+
```

Each lap either grows the dragon (food) or its power (hoard), and pushes the region's alert up until the player lies low.

### Design pillars

1. **Growth you can feel** - each stage changes size, handling and play style, not just numbers.
2. **Hunger keeps you moving** - food is the clock of free roam; starving weakens, never kills.
3. **The kingdom fights back** - every raid raises alert and the defenses adapt.
4. **Short, focused missions** - 5-10 minute timed objectives that fit a browser session.
5. **A lair worth returning to** - the hoard pile, trophies and upgrades show progress at a glance.

### Locked decisions

| Topic | Decision |
| --- | --- |
| Tone | Classic fantasy with two sides that each have their own truth. The player plays the dragon and should feel for dragons; a later human campaign makes its players feel for the humans (decided 2026-10-29) |
| Starvation | Dragon gets weak, cannot die of hunger |
| Death penalty | Respawn at the lair, carried loot is lost |
| Story | Light - the hatching scene opens the campaign, act cards, mission briefings. The mother dragon teaches the young dragon through its first two stages (Hatchling, Drake) and is killed by the Order as it grows into a Wyrm (decided 2026-10-29) |
| Mission length | 5-10 minutes, timer runs out = mission fail |
| World structure | Separate regions with loading between them |
| Landing | The dragon lands and walks on the ground (no hopping); takeoff is an explicit action (decided 2026-10-29) |
| Renown | Deferred to Phase 4; Phase 2-3 only count civilian damage and livestock taken in the save (decided 2026-10-29) |
| Hoard | Gold, the hoard pile and the first upgrades arrive in Phase 2 together with the kingdom, so raiding pays off from the start (decided 2026-10-29) |
| Lair interior | A walkable 3D cave from Phase 2, not a menu; later phases add stations to it (decided 2026-10-29) |
| Navigation | Compass strip with the dragon's sense of smell in Phase 2, map screen with fast travel in Phase 3 (decided 2026-10-29) |

## 2. Story

Revised 2026-10-29: the campaign opens with the hatching scene, the mother dragon is there from day 1 and teaches the young dragon through its first two stages, and the Order kills her later. Both dragons and humans have their own truth. Names are working titles.

**Backstory (told in the intro and act cards):** years before the game, the hero's mother - one of the last Verdigris dragons - killed the King. To the humans this was a monster murdering their king and burning his city; the dragon side has its own reason for it (see open question 1). After the King's death the Order of the Iron Lance seized the crown and swore to wipe out the dragons. Since then the Order rules the villages through garrisons, villagers are taught to fear dragons, and stolen dragon relics (eggs, scale-crowns, the Ember Heart) sit in the Order's castles. Dragons are nearly extinct.

**The dragon story (this campaign):** the player is the mother's last egg, hatched in a dormant volcano.
- The campaign opens with the hatching scene: the mother lies curled around the small egg and is there when it cracks.
- From day 1 she teaches the young dragon. This is the campaign's tutorial: she flies ahead, shows a herd, takes the first prey, then lets the hatchling try. Each new skill (landing, smell, the cave, the first raid) comes as one of her lessons.
- She stays through the first two stages, Hatchling and Drake. As a Drake the young dragon hunts and raids more on its own, and she raids the Order with it.
- When it grows into a Wyrm, the mother flies out to hunt and does not come back: the Order brings her down with ballista bolts. The player sees it happen.
- Her death is why the dragon hates people. The rest of the campaign is the young dragon's revenge on the Order, growing into the one dragon the Order cannot kill.

**The human story (a later campaign, after the dragon story is finished):** the same world seen by the humans. They lost a king and a city to a dragon and live in fear of fire from the sky; the Order is cruel but it is the only thing between them and the dragons. The human campaign is designed and built only after the dragon story is complete (roadmap phase 8). The dragon campaign already keeps what the humans will remember: villages burned, livestock taken, people of the Order killed, and these can become the human campaign's starting history.

**Two truths, two sentiments:** whoever plays the dragon should feel for the dragons; whoever plays the humans should feel for the humans. So neither campaign paints the other side as plain evil: the Order commits real cruelty, the mother really killed the King. Each side's texts speak from its own point of view and are never "corrected" by the other.

**Gameplay framing in the dragon campaign:** Order structures, soldiers and war machines are fair targets. Burning civilian homes or stealing village livestock lowers **Renown**. High Renown makes freed villages send food tribute to the lair; low Renown keeps them hostile. (Deferred to Phase 4. Until then the save counts civilian buildings burned and livestock taken, so Renown can start from real history.)

### Acts

| Act | Stage | Story beat | Ends with |
| --- | --- | --- | --- |
| 1 - Awakening | Hatchling | The hatching scene; the mother teaches flying and hunting | The hatchling grows into a Drake |
| 2 - Embers | Drake | With the mother: first raids on Order outposts and supply lines, free the first village | The mother is killed by the Order, as the hero grows into a Wyrm |
| 3 - Wyrmfire | Wyrm | Alone now, out of revenge: storm castles, recover the stolen dragon eggs | Grand Slayer hunts the dragon (lair raid) |
| 4 - Crown of Ash | Elder | Siege of the capital, the Order's war machine | Order falls, free roam continues |

**Delivery:** a short illustrated intro, one text card per act, a 2-4 line briefing per mission and a one-line outcome after it. Two short in-engine scenes with the game's own models: the hatching that opens the campaign (mother beside the egg) and the mother's death at the end of Act 2. No dialogue trees.

**Preview:** the hatching scene (mother, egg, hatchling) is prototyped as a standalone page before it goes into the game.

## 3. Dragon progression

Food makes the dragon grow, hoard makes it powerful: two resources with separate jobs, so hunting and raiding both matter.

| Resource | Source | Spent on | Banked when |
| --- | --- | --- | --- |
| Food (biomass) | Wild prey, fish, tribute, livestock | Hunger + growth XP | Eaten (instant) or stored in the larder |
| Hoard (gold, relics) | Castles, caravans, Order vaults | Upgrades at the lair altar | Delivered to the lair or a regional aerie |

### Growth stages

Growth is one value `growth` from 0 to 1; model scale and all stats are curves over it. Stage thresholds gate missions and regions. Numbers are starting values for tuning.

| Stage | growth | Scale | HP | Turn rate | Hunger drain | Spot range | Carry |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Hatchling | 0.00-0.24 | 1.0x | 100 | 100% | 1.0x | 1.0x | Small (goat, chalice) |
| Drake | 0.25-0.54 | 1.6x | 220 | 85% | 1.5x | 1.5x | Medium (sheep, chest) |
| Wyrm | 0.55-0.84 | 2.5x | 450 | 65% | 2.2x | 2.3x | Large (cattle, knight, egg) |
| Elder | 0.85-1.00 | 4.0x | 900 | 50% | 3.0x | 3.5x | Huge (ballista, statue) |

Stage-up is a moment: it only happens while resting in the lair, with a short growth animation and an act card when it starts a new act.

### Upgrades (bought with hoard)

| Branch | Upgrades | Effect |
| --- | --- | --- |
| Breath | Hotter fire, long cone, fireball volley, frost or acid breath (late) | Damage, range, alternative breath types |
| Body | Iron scales, wing muscles, strong claws | Arrow resistance, stamina and dive speed, carry capacity |
| Senses | Prey sense, guard sight, night vision | Longer and sharper smell with prey types on the compass + prey highlight, shows guard vision cones, darker nights playable |
| Abilities | Roar, tail sweep, silent glide, ground slam | Stun, close defense, stealth approach, area damage (elder only) |

Some upgrades require a stage (ground slam needs Elder) so the tree opens up as the dragon grows.

## 4. Hunger and survival

Hunger never kills the dragon - it strips away its strength until it eats, which makes food a constant small decision without a frustrating death.

### Hunger meter (0-100)

Drains at a base rate times the stage multiplier; hard flight (boost, climbing) and breath use drain extra. Resting in the lair pauses it.

| Hunger | State | Effects |
| --- | --- | --- |
| 100-31 | Fed | No penalty; above 80 HP regenerates |
| 30-11 | Hungry | Stamina regen -50%, HP regen stops, warning pulse on HUD |
| 10-0 | Starving | Max speed -30%, breath disabled, can carry only small loot, slow HP drain down to a floor of 25% max HP |

The HP floor keeps the "weak, not dead" rule: starvation alone never ends a run, but a starving dragon is easy prey for defenders.

### Food sources

| Source | Where | Food | Risk | Notes |
| --- | --- | --- | --- | --- |
| Goat, deer | Ash Wastes, Wildwood | Low-medium | None | Herds flee and scatter into forest |
| Boar, bear | Wildwood | Medium-high | Fights back | Bear can knock a hatchling out of a grab |
| Fish | Rivers, lakes | Low | None | Needs a low dive over water |
| Order supply wagon | Roads | High | Guards, alert +1 | Hero-approved food, counts as a raid |
| Village tribute | Freed villages | High | None | Delivered to the larder over time |
| Village livestock | Farms | High | Alert +1 (Renown down from Phase 4) | Easy but costly |

### Hunting mechanics

- **Grab:** dive and hold the grab key near prey; prey bigger than the carry class cannot be lifted.
- **Eat or carry:** eat in flight (speed capped) or on the ground after landing (vulnerable for 2-3 s), or carry it to the larder.
- **Land and walk:** from Phase 2 the dragon can land on walkable ground, walk, pick up prey and loot in front of it, breathe fire and take off again. Ground time is where steals happen and where mangonels and knights are dangerous.
- **Burned prey** gives 50% food - fire is a quick kill but wasteful.
- **Larder:** stores a few carcasses, capacity grows with lair upgrades; stored food slowly spoils.
- **Prey respawn** per region, with herds moving away from areas the dragon hunts too often.

## 5. Kingdom defenses

Settlements scale from a hamlet with pitchforks to a capital with a dragon-slayer order, and a per-region alert level makes the defenses react to how the player behaves.

### Settlements

| Type | Defenses | Loot | Behavior |
| --- | --- | --- | --- |
| Hamlet | Peasants, alarm bell | Livestock | Bell alerts the nearest village |
| Village | Archers, watchtower, 1 ballista | Grain, small gold | Calls knights if the alarm lasts > 60 s |
| Order outpost | Archers, 2 ballistae, net launcher | Gold, minor relic | Main early mission target |
| Town | Walls, ballistae, mangonels | Treasury | Sends riders after the dragon |
| Castle | All of the above + knights, frost mages | Relics, vault | Mission targets with courtyard and keep |
| Capital | Everything + Grand Slayer | Crown relics | Act 4 only |

### Defender types

| Defender | Threat | Counterplay |
| --- | --- | --- |
| Archer | Chip damage in volleys | Iron scales, fly high, burn towers |
| Ballista | High damage bolt, slow reload | Telegraphed aim line - dodge, then strike during reload |
| Mangonel | Area damage on a landed dragon | Don't stay on the ground |
| Net launcher | Grounds the dragon for 3 s | Tail sweep, roar, approach from behind |
| Frost mage | Slows wings, weakens fire | Close distance fast, acid breath (late) |
| Mounted knight | Chases on the ground, lance hits | Take off, grab and drop (wyrm+) |
| Dragon slayer | Named mini-boss with mirror shield or chain harpoon | Unique pattern per slayer |

### Alert level (per region, 0-5)

Raids and sightings raise alert; it decays by one level after a few in-game hours without incidents. Destroying watchtowers lowers it faster.

| Level | Kingdom response |
| --- | --- |
| 0 | Normal life, few guards |
| 1-2 | More archers, bells manned, road patrols |
| 3 | Ballistae built in villages, livestock moved inside |
| 4 | Hunting parties search near aeries and the lair |
| 5 | A dragon slayer is sent - triggers a lair-defense event |

The rhythm this creates: raid, lie low and hunt in the wilds, raid again.

## 6. Missions

Every mission is a timed run of 5-10 minutes: accept at the lair, fly to the target, complete the objective and deliver the loot to an aerie or the lair before the timer hits zero.

### Mission types

| Type | Example | Tests | Time limit |
| --- | --- | --- | --- |
| Steal | Ember chalice from an outpost chapel | Stealth, landing, escape while carrying | 6-8 min |
| Destroy | Siege workshop building anti-dragon ballistae | Breath damage, dodging | 5-7 min |
| Intercept | Gold caravan crossing the pass | Speed, timing | 5-6 min |
| Hunt | Slayer captain riding toward the lair | Combat, tracking | 6-8 min |
| Rescue | Caged wild dragonling in the royal menagerie | Stealth + carry | 8-10 min |
| Defend | Order hunting party storms the lair | Combat on home ground | 5 min (survive) |
| Boss | Grand Slayer, the war machine | Everything | 10 min |

Missions are gated by growth stage and act. Optional side activities (burn a watchtower, free caged animals, raid a tax cart) have no timer.

### Timer rules

- **Start:** when the dragon leaves the lair region or the aerie with the mission active - flight time to the target is part of the challenge.
- **Display:** always visible; turns amber at 60 s and red at 20 s.
- **Success:** objective done and loot delivered to the lair or a regional aerie before 0. Remaining time gives a bonus (e.g. +1% hoard per 5 s left).
- **Fail on timeout:** objective lost, mission loot vanishes, region alert +1, mission can be retried after resting.
- **Hunger still runs:** stopping to hunt costs mission time - eat before you leave.

### Death and failure

| Event | Result |
| --- | --- |
| Dragon dies | Respawn at the lair; carried loot (relic, gold, prey) is lost; active mission fails |
| Timer runs out | Mission fails; carried mission loot is lost; non-mission gold already carried is kept |
| Starvation | No death - weakness effects only (see Hunger) |
| Banked hoard | Always safe - delivered loot is never lost |

Aeries (small caves, one per region) are where loot is banked and missions end, so the death rule stays fair even far from the volcano.

### Example: steal mission flow

1. Briefing at the lair: "The Order hides the Ember Chalice in the Harrow outpost chapel." Timer 7:00.
2. Fly to the River Farmlands; scout from altitude, guard sight shows vision cones.
3. Approach low along the river or wait for night.
4. Land in the courtyard or break through the chapel roof, grab the chalice.
5. Carrying: speed -20%, no breath. Bells ring, ballistae wake, knights mount.
6. Escape to the Farmlands aerie. Delivered at 1:12 left: success + time bonus.

## 7. World and lair

The world is six regions radiating from the volcano, each a seamless map loaded separately; difficulty and stage requirements grow with distance from the lair.

### Regions

| Region | Content | Unlocked at | Aerie |
| --- | --- | --- | --- |
| Ash Wastes | Volcano lair, goats, lava fields | Start | Lair itself |
| Wildwood | Deer, boar, bears, hamlets, first outpost | Hatchling | Yes |
| River Farmlands | Villages, livestock, fish, first town | Drake | Yes |
| Highland Pass | Fortresses, caravans, bridges | Drake (late) | Yes |
| Royal Lowlands | Castles, slayer headquarters | Wyrm | Yes |
| Capital | Final act | Elder | No - boss arena |

**Transitions:** flying to a region edge shows a short "fly to" prompt; confirming loads the neighbour region with the dragon entering from that edge. The mission timer pauses during loading. A fast-travel option from the lair to any discovered aerie keeps long trips short.

**Region size target:** about 2-3 minutes of straight flight across for a hatchling, so a 5-10 minute mission covers approach, objective and escape.

### Volcano lair

Flying into the cave mouth loads the lair interior: one walkable cave hall lit by lava, sized so even an Elder fits. The dragon walks between stations; walking up to one shows its action in the Action slot and opens a small panel. Leaving through the tunnel puts the dragon back in the air in front of the mouth. Hunger is paused inside, and a dead dragon wakes on the nest.

| Station | Purpose | Phase |
| --- | --- | --- |
| Rest nest | Save, heal, sleep until dusk or dawn, triggers stage-up | 2 |
| Larder | Stored carcasses lie there visibly; eat them | 2 |
| Hoard pile | Grows visibly with banked gold (instanced coins) | 2 |
| Upgrade altar | Spend hoard on upgrades | 2 |
| Exit tunnel | Back outside | 2 |
| Trophy wall | Shows recovered relics and story progress | 3 |
| Mission board | Pick the next mission, shows briefing and time limit | 3 |
| Map stone | Opens the map screen, fast travel to discovered aeries | 3 |
| Lava vents | Hazards that hurt intruders in lair-defense missions | 5 |

### Navigation

Phones have no room for a minimap, so navigation is a thin compass strip at the top of the screen, plus a full map screen from Phase 3.

| Tool | Shows | Phase |
| --- | --- | --- |
| Compass strip | Heading with markers: the lair (always, with distance), region exits (name, greyed out when the dragon is too small), discovered settlements (with the region's alert colour) | 2 |
| Smell | Scent markers on the compass toward nearby herds: fuzzy far away, sharp up close; a hungry dragon smells further. Livestock smell different from wild prey | 2 |
| Prey sense upgrade | Longer smell range, prey type on the marker, prey highlighted in the world | 2 |
| Map screen | Region graph, discovered settlements and aeries, alert per region, fast travel | 3 |

### Day and night

A full cycle lasts about 20 real minutes. At night guards see less far and fewer are awake, but prey hides and is harder to spot. Resting in the lair can skip to dusk or dawn.

## 8. Technical design

Campaign is a separate mode built from small, data-driven systems on top of the existing flight and combat code; all content (regions, prey, defenders, missions, upgrades) lives in data files so balancing and AI-assisted iteration don't touch logic. Concrete file layout, module format and interfaces are defined per phase in the task files (Phase 1: `001_task_survival.md`).

### Systems (all phases)

| System | Responsibility | Depends on |
| --- | --- | --- |
| CampaignState | Single source of truth for progress, emits change events | SaveService |
| GrowthSystem | Maps `growth` to scale and stat curves, stage thresholds | CampaignState |
| HungerSystem | Drain, states, effects on dragon stats | GrowthSystem |
| Locomotion | Flight, landing, walking, takeoff (one pilot, a mode per state) | Terrain, settlements (roofs and walls) |
| PreySystem | Herd spawning, graze / flee / hide AI, grab and eat | Perception |
| Perception | Shared vision cones + hearing for prey and guards | Dragon size, day/night |
| SettlementSystem | Spawns buildings and defenders from region data | AlertSystem |
| DefenderAI | State machines: idle, alert, attack, search | Perception |
| AlertSystem | Per-region alert level, decay, escalation events | CampaignState |
| UpgradeSystem | Owned upgrades and their stat effects | CampaignState |
| WorldClock | Day and night cycle, sleep until dusk or dawn | CampaignState |
| MissionSystem | Accept, timer, objectives, success / fail, rewards | CampaignState, RegionLoader |
| RegionLoader | Load / unload region scenes, edge transitions, aeries | Asset cache |
| LairScene | Walkable cave interior with stations: nest, larder, hoard pile, altar (Phase 2), trophy wall, mission board, map stone (Phase 3) | All of the above |
| Navigation | Compass markers, smell, discovery; map screen from Phase 3 | Regions, settlements, prey |
| SaveService | Versioned save, autosave, migrations | - |

### Save state (target shape, all phases)

Stored in `localStorage` (IndexedDB if it grows), autosaved on rest, mission end and region change. The shape is kept server-friendly for the planned persistent multiplayer.

```json
{
  "version": 1,
  "dragon": { "growth": 0.31, "hp": 180, "hunger": 64, "upgrades": ["iron_scales_1", "prey_sense"] },
  "hoard": { "gold": 1240, "relics": ["ember_chalice"] },
  "larder": [{ "prey": "deer", "food": 30, "storedAt": 5120 }],
  "renown": 12,
  "regions": { "wildwood": { "alert": 1, "aerieFound": true }, "farmlands": { "alert": 3, "aerieFound": false } },
  "missions": { "completed": ["a1_outpost_chalice"], "active": null },
  "story": { "act": 2 },
  "world": { "timeOfDay": 0.72, "location": "lair" }
}
```

### Performance notes

- Heightmap terrain per region, chunked with LOD; fog limits draw distance.
- Instanced meshes for trees, houses, herds and the hoard coins.
- One dragon model scaled by `growth`, not separate assets per stage.
- AI ticks at a lower rate for far entities; off-screen herds are simulated as groups.

## 9. Roadmap

Each phase is a playable increment on its own base branch (`campaign-phase-N`) with one PR per task. Phase 1 is deliberately small to prove that hunting and growth are fun before castles get built. Roadmap revised 2026-10-29: landing moved to the start of Phase 2, hoard, upgrades, the walkable cave interior and the compass with smell moved into Phase 2, map screen in Phase 3, the old Phase 4 split into Highlands and Lowlands, co-op gated on the multiplayer backend.

| Phase | Task file | Scope | Exit criteria |
| --- | --- | --- | --- |
| 1 - Survival MVP | `001_task_survival.md` | Ash Wastes + Wildwood, lair (rest, save, larder), hunger, goat / deer / boar, grab and eat, growth Hatchling to Drake, save v1 | A new player can hunt, starve, recover and reach Drake in about 30 min; save survives reload |
| 2 - Kingdom + hoard | `002_task_kingdom.md` | Foundation first (touch action layout, phone perf baseline, shared dragon model), the hatching scene and the mother as tutor, landing + walking, walkable cave interior (nest, larder, hoard pile, altar), compass strip with smell, then River Farmlands, hamlet + village + outpost (a small outpost in Wildwood), archers + ballista, building fire, Perception, alert 0-3, livestock, gold loot, 5 upgrades incl. prey sense, day / night, save v2 | On a phone a Drake follows the compass to the Farmlands, lands outside the Order outpost, walks in, picks up the strongbox, takes off under archer and ballista fire, carries it into the cave, sees the hoard pile grow and buys an upgrade at the altar; raids raise alert to 3 with visible changes and lying low lowers it |
| 3 - Missions | `003_task_missions.md` | Mission board and trophy wall in the cave, timer, steal + destroy + intercept types, relics and mission carry rules, aeries, map screen + fast travel, freeing a village (Order garrison destroyed: tribute starts), Act 1-2 story cards | Three missions completable in 5-10 min; death and timeout rules work as specified; the map shows discovered places and fast travel works |
| 4 - Highlands | `004_task_highlands.md` | The mother's death scene (end of Act 2), Highland Pass, Wyrm stage + stage visuals, knights, net launchers, caravans, Renown | A Wyrm intercepts a caravan and survives the knights; Renown changes how villages treat the dragon |
| 5 - Lowlands | `005_task_lowlands.md` | Royal Lowlands, frost mages, mangonels, first named slayer, alert 4-5, lair defense inside the cave (lava vents), Act 3 | Act 3 playable end to end |
| 6 - Endgame | `006_task_endgame.md` | Elder stage, Capital, Grand Slayer + war machine bosses, Act 4 | Campaign completable start to finish |
| 7 - Co-op campaign | `007_task_coop.md` | Two dragons, shared lair and hoard, sync on the persistent multiplayer backend | Two players finish a mission together |

| 8 - Human campaign | later | The same world from the humans' side (the King's death, life under dragon fire and the Order), its own hero and missions, starting from the history the dragon campaign saved | Designed only after the dragon story (phases 1-6) is complete |

Phase 7 (co-op) starts only once the persistent multiplayer backend exists; until then every phase keeps the save shape server-friendly. Phase 8 (human campaign) starts only after the dragon story is finished.

## 10. Open questions

- [x] Confirm current renderer, module layout and input handling in the repo - done in Phase 1 task file (Three.js r128, no build step, UMD sim modules tested with Node).
- [x] Keep Renown? Yes, but later: deferred to Phase 4 (decided 2026-10-29).
- [x] Grab controls: hold Grab near prey, with a swoop that steers the dive (Phase 1).
- [x] Landing: real landing with walking, not hopping (decided 2026-10-29, built at the start of Phase 2).
- [ ] Does the mission timer pause during region loading only, or also inside the lair menus?
- [ ] Visual difference between stages: scale only, or extra horns / spines per stage?
- [ ] When does co-op campaign start? Gated on the persistent multiplayer backend (2026-10-29); exact timing still open.
- [x] Story: the mother lives at the start, teaches flying and hunting, is killed by the Order when the hero reaches Drake; the mother once killed the King; human campaign after the dragon story (decided 2026-10-29).
- [ ] Story 1: why did the mother kill the King? Default: the King's hunters took her first clutch of eggs, so both sides lost children and both have their reason.
- [x] Story 2: the mother is in the game from the start of the campaign: the hatching scene and the mother NPC are Phase 2 tasks T04 and T05; her death scene comes with the Wyrm stage in Phase 4 (decided 2026-10-29). Until T04 the phase 1 hatching card stays.
- [ ] Story 3: is the hero the "last" dragon? Default: no - the stolen eggs in Act 3 mean others may live, which gives the late game hope.
