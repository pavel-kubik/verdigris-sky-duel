/*
 * Verdigris campaign - all tunables for Phase 1 (survival MVP).
 * Plain data only (no functions), so it can move to .json files later without code changes.
 * Units: world units (the duel world radius is 430), seconds, food points.
 * See ai_sdlc/001_campaign/001_task_survival.md, section 4.
 */
(function (root) {
  'use strict';
  const M = typeof module === 'object' && module.exports ? require('./umd.js') : root.VCamp;
  const PI = Math.PI;

  const data = {
    version: 1,
    saveKey: 'vsd-campaign',
    // autosave: every `every` s of play, plus on rest, region change and death (core emits a 'save' event)
    save: { every: 60 },

    /* Graphics quality tiers (Phase 2 T02). flora = share of the region's trees, pixelRatio = cap on
       devicePixelRatio, far = fog and chunk view distance multiplier, particles = breath particle rate.
       Touch devices without a stored choice measure fps for `auto.sample` s of play (after `warmup` s)
       and pick low below `auto.low` fps, high at `auto.high` or more, mid in between. ?q=low|mid|high|auto. */
    quality: {
      tiers: {
        low:  { flora: 0.25, pixelRatio: 1,   far: 0.8, particles: 0.5 },
        mid:  { flora: 0.5,  pixelRatio: 1.5, far: 1,   particles: 1 },
        high: { flora: 1,    pixelRatio: 2,   far: 1,   particles: 1 },
      },
      order: ['low', 'mid', 'high'],
      defaultTouch: 'mid', defaultDesktop: 'high',
      auto: { warmup: 2, sample: 10, low: 28, high: 50 },
      storeKey: 'vsd-campaign-quality',
    },

    /* Growth stages. carry = max prey size class (1 small, 2 medium, 3 large, 4 huge).
       Visual scale grows from scaleFrom to scaleTo with food XP inside a stage;
       the stage itself changes only when resting in the lair. */
    stages: [
      { id: 'hatchling', foodFrom: 0, growthFrom: 0.00, scaleFrom: 1.0, scaleTo: 1.5,
        hp: 100, turn: 1.00, cruise: 30, boost: 54, hungerMult: 1.0, spot: 1.0, carry: 1 },
      { id: 'drake', foodFrom: 1000, growthFrom: 0.25, scaleFrom: 1.6, scaleTo: 2.4,
        hp: 220, turn: 0.85, cruise: 32, boost: 56, hungerMult: 1.5, spot: 1.5, carry: 2 },
      // wyrm (foodFrom 2400, growthFrom 0.55) and elder (growthFrom 0.85) arrive in phases 4-5
    ],
    growthCap: { food: 2399, growth: 0.54 },

    hunger: {
      max: 100, start: 80,
      drain: 0.33,            // per second at hungerMult 1 (100 to 0 in about 5 min)
      boostDrain: 0.25,       // extra per second while boosting
      breathDrain: 0.15,      // extra per second while breathing fire
      states: { hungry: 30, starving: 10 },
      fedHpRegenAbove: 80, fedHpRegen: 1.0,
      hungryStRegenMult: 0.5,
      starving: { speedMult: 0.7, breath: false, carryMax: 1, hpDrain: 0.5, hpFloor: 0.25 },
    },

    prey: {
      goat: { size: 1, food: 20, hp: 20, speed: 9, flee: 9, fleeRange: 45, herd: [3, 5], fights: false },
      deer: { size: 1, food: 30, hp: 30, speed: 14, flee: 18, fleeRange: 70, herd: [3, 6], fights: false },
      boar: { size: 2, food: 45, hp: 60, speed: 10, flee: 12, fleeRange: 40, herd: [1, 3], fights: true,
              charge: { range: 14, maxAboveGround: 7, damage: 8, cooldown: 3 } },
      // livestock (Phase 2 T18): kept in the settlements' pens (data.settlements pens), never in region herds; taking one
      // raises the region alert by alert.add.livestock; at alert 3 (livestockInside) they are inside the barn
      sheep: { size: 1, food: 25, hp: 20, speed: 7, flee: 9, fleeRange: 40, herd: [3, 6], fights: false, livestock: true },
      cow:   { size: 2, food: 60, hp: 50, speed: 6, flee: 7, fleeRange: 35, herd: [2, 4], fights: false, livestock: true },
    },
    // A burned prey leaves ceil(food * foodMult / chunkFood) chunks; the roast food is split evenly.
    // cool: heat lost per second outside the fire (0 = a scorched prey keeps its heat until it is roasted)
    roast: { foodMult: 0.5, chunkSize: 1, chunkFood: 11.5, cookTime: 0.9, cool: 0, scatter: 2.5, life: 120 },
    // fire breath reach: a cone from the mouth (range x dragon scale); prey inside it heat up toward cookTime
    breath: { range: 36, cone: 0.42, mouth: 2.8, assist: 0.75, preview: 1.8 },   // assist: the stream bends toward prey this far off the heading;
    // preview: the fire target (orange ring, roast progress) is picked up to range x preview ahead, and kept while it stays there
    // grab reach: horizontal radius x dragon scale, height over the prey's back (+ the claw drop at this scale),
    // and not climbing harder than maxPitch (the floor pull-up rules out a strict dive-only grab)
    grab: { radius: 9, maxAboveGround: 10, maxPitch: 0.25, clawDrop: 1.35, nearFactor: 3.5, heavyCooldown: 3 },
    // swoop: holding grab with liftable prey ahead locks on and steers the dive onto it
    swoop: { range: 90, cone: 0.9, below: 70, steer: 3.2, aimAbove: 6 },
    eat: { time: 2.5, speedCap: 18 },
    respawn: { herdCooldown: 150, minDistFromDragon: 250 },
    preyAi: { fullRange: 600, farTickHz: 4, maxActive: 40 },

    flight: { minAlt: 5, edgeMargin: 60, baseTurn: 1.55 },

    /* Landing and walking (Phase 2 T06, core/walk.js; 002_task_kingdom.md 4.1). Pilot modes: air, landing, ground, takeoff.
       land: allowed within maxAlt of the surface, at maxSpeed or slower (cruise lands, boost does not), on a slope
       (rise / run) under maxSlope, not over water or lava, not on a roof; the touchdown takes `time` s; noise = hearing
       range of the touchdown (perception, T14).
       walk: tank steering (stick up = forward, down = slow back, sides = turn on the spot), Boost = run (runSt
       stamina / s); speeds x (1 + sizeSpeed x (scale - 1)); slopes over land.maxSlope cannot be climbed (the dragon
       slides along them); stepUp x scale = the highest ledge (building solids, T12) it steps onto; stand x scale = body
       height over the surface; accel = speed response per s.
       takeoff: `time` s in which it cannot breathe or grab, costs st stamina, climbs to minAlt + climb over the surface.
       pose (T07, walk.pose -> shared/dragon.js anim): gaitLen x scale = ground covered per walk cycle (feet slip a
       little, so the legs do not blur at run speed), turnGait = cycles per s while turning on the spot, legRate = how fast
       the legs extend / tuck outside the scripted transitions (per s); during landing the legs reach down from legsAt of
       the touchdown and the wings fold from foldAt; during takeoff the legs are tucked by tuckAt. groundCam: chase
       camera on the ground (x scale ^ 0.75: back, height over the dragon, look = how far ahead it looks), blended in
       with the legs. */
    land: { maxAlt: 14, maxSpeed: 36, maxSlope: 0.45, time: 0.8, noise: 60 },
    walk: { speed: 7, run: 13, back: 3, turn: 1.8, stepUp: 1.2, runSt: 12, sizeSpeed: 0.35, stand: 1.6, accel: 6 },
    takeoff: { time: 1.0, st: 15, climb: 10, vulnerable: true },
    pose: { gaitLen: 3, turnGait: 1.4, legRate: 4, legsAt: 0.25, foldAt: 0.55, tuckAt: 0.6 },
    groundCam: { back: 18, height: 6, look: 10 },
    ground: { reach: 6, reachCone: 0.7, eatTime: 2.5, breathPitch: -0.15 },
    // region travel: the exit prompt shows within edgeBand of the radius while heading outward (cos of the angle
    // between heading and the outward direction >= outwardCos) and stays promptHold s after the dragon turns back;
    // a traveller appears entryInset inside the new region's radius, about entryAlt above the ground;
    // inside an exit arc the flight soft boundary narrows to softEdge (120 elsewhere) so the dragon can reach the exit
    travel: { edgeBand: 90, outwardCos: 0.2, promptHold: 3, entryInset: 220, entryAlt: 45, softEdge: 45 },

    // lair: larder slots, 1 food lost per spoilEvery s, the "fly into the cave" prompt within nearRange of the mouth,
    // the Move slot "Enter cave" (touch) within enterRange of the mouth while heading toward it
    lair: { larderSize: 3, spoilEvery: 30, nearRange: 140, enterRange: 80, respawnHp: 0.5, respawnHunger: 40 },

    /* Cave interior (Phase 2 T10, core/cave.js, render/cave-view.js; 002_task_kingdom.md 4.7). A dome hall with a flat
       floor; the dragon walks inside (walk.step) on the circle of radius `bounds` (minus pad x scale) and in the
       tunnel (|x| < tunnel.w / 2, from the hall to z = tunnel.len); walking past tunnel.out leaves the lair.
       stations: [x, z, radius]; in reach within radius + reach x scale ^ 0.5 (the Action slot / E opens it).
       hoard (T19) and altar (T20) stations.
       entry: where flying into the mouth puts the dragon (in the tunnel, facing in); death and hatching wake it
       on the nest. camera: chase distance / height (x scale ^ 0.75), clamped inside the dome and the tunnel
       (pad from the walls). light: the lava channel's point light colour, intensity, distance and flicker. */
    cave: {
      room: { r: 60, h: 28 }, floor: 0, bounds: 54, pad: 3,
      tunnel: { w: 16, h: 14, len: 70, out: 62 },
      stations: {
        nest:   [0, -34, 12],
        larder: [-30, -8, 8],
        exit:   [0, 56, 4],
        hoard:  [30, -8, 10],                 // T19: the coin pile (hoardTiers), its panel shows the gold
        altar:  [0, 8, 5],                    // T20: upgrades for hoard gold (core/upgrades.js)
        // Phase 3: trophy [-40, 20], board [40, 20], mapStone [0, 30]
      },
      hoardTiers: [0, 100, 300, 700, 1500],   // T19: coin pile size steps (tier = steps reached - 1); coins = min(maxCoins, gold / 2)
      maxCoins: 800,
      reach: 8, entry: [0, 40],
      camera: { dist: 18, height: 7, look: 10, pad: 2.5 },
      light: { color: 0xff7a2e, intensity: 2.2, distance: 150, flicker: 0.18 },
    },

    /* Compass and smell (Phase 2 T09, core/nav.js, render/compass.js; 002_task_kingdom.md 4.7).
       nav: at most `markers` markers on the strip, which spans `fov` rad around the heading (markers outside it stick
       to the edges as arrows); a tapped marker shows its name and distance for `tagTime` s.
       smell: range x stage spot ^ 0.5, x hungryMult when hungry or starving, x starveMult more when starving;
       inside `sharp` the scent points exactly at the herd, beyond it the marker drifts up to `blur` rad off at full
       range (smooth, no jitter); scents are re-read every `update` s, the strongest `max` (herd size x closeness) shown.
       T12: a settlement within nav.discover of the dragon whose centre (losEye above the ground) is in line of sight
       (losSteps terrain samples) is discovered for good and gets a compass marker; checked every discoverEvery s. */
    nav: { markers: 7, fov: 2.4, tagTime: 3, discover: 250, discoverEvery: 0.5, losSteps: 12, losEye: 8 },
    smell: { range: 380, hungryMult: 1.4, starveMult: 1.3, sharp: 120, blur: 0.7, update: 0.5, max: 3 },

    /* Perception (Phase 2 T14, core/perception.js; 002_task_kingdom.md 4.4 and 5.3).
       defenders: the sight part of each defender type (sight range, fov = full cone angle in rad); T15 / T16 add the rest.
       Seen value 0..1 = in the cone x in range x line of sight clear; range = sight x stage spot x light x altitude factor,
       falling off linearly over the last `fade` of the range. light: day 1, `dusk`, `night` (T21's clock sets cs.light).
       altitude: the dragon's height over the ground; x1 below `from`, down to `min` at `to` (high flight is hard to see).
       Line of sight: from the viewer's eye to the dragon's centre or `losTop` x scale above it (a big dragon shows over a
       ridge first), `losSteps` samples at least, one every `losSpacing` units, over the terrain and building roofs.
       hearing: noise radii x dragon scale (boost in the air, breath, landing, takeoff, running on the ground).
       Awareness rises by awareRise x seen per s, falls by awareFall per s while unseen; >= suspicious = 'suspicious',
       >= alert = 'alert' (stays alert until it falls under suspicious); a heard noise lifts it to suspicious at once.
       watch: until the defenders of T15 stand on them, every post (tower: archer, platform: ballista) is a watcher with
       an eye `eye` over the roof that sweeps +-`sweep` rad at `sweepRate` around the outward direction (the place's yaw
       for a post in the centre) and turns at `turn` rad/s toward what it saw or heard last. */
    /* Defenders (T15, core/defenders.js; 4.3 and 5.4). hp; peasants walk at `speed` (x defense.stroll when idle), run to
       the bell (one per settlement, ringsBell) and hide; archers stand on the towers (template `archers`, round robin over
       the towers), volley at a dragon they see within `range` and face (defense.aimCone): `aimTime` s of aim, then
       `volley` arrows `gap` s apart, then `cooldown` s; an arrow flies at `speed` (leading the dragon by its velocity,
       gravity compensated) with `spread` noise x speed per axis and hits for `damage` (002 4.3 listed `volley: 3,
       arrows: 3`; built as one `volley` count).
       ballista (T16): `hp` is its crew's (002 4.3 had 80 = the platform, which burns as a building with its own hp 80);
       turns at `turn` rad/s, aims `aimTime` s at the lead point (the aim line), frozen for the last `lock` s, then one
       bolt at `bolt` speed straight (no gravity) for `damage`; hit radius `hit` x scale, `life` s in the air; `reload` s
       until the next aim. Burning the crew (breath, as archers) or the platform stops it.
       defense: eye height of a peasant, idle wander radius around the home and walk factor, collision pad, bell ring
       time and the s before the same bell rings again, archer spacing on a tower, archers / peasants in the breath:
       archers lose `burn` hp/s (peasants panic instead, they do not die); awareness marks show within `markRange`.
       projectiles: pool size (all arrows in the air or stuck), gravity, life in the air, s an arrow stays stuck in the
       ground / a roof, hit radius around the dragon's centre x scale. */
    defenders: {
      peasant:  { hp: 10, speed: 6, sight: 90,  fov: 2.4, flee: true, ringsBell: true },
      archer:   { hp: 18, sight: 130, fov: 1.8, range: 120, volley: 3, gap: 0.18, spread: 0.06,
                  speed: 70, damage: 3, aimTime: 0.6, cooldown: 3 },
      ballista: { hp: 18, sight: 170, fov: 1.2, range: 220, aimTime: 2.0, lock: 0.5, bolt: 160, damage: 35, reload: 8,
                  turn: 0.9, crew: 1, hit: 3, life: 2 },
    },
    defense: { eye: 1.6, wander: 7, stroll: 0.3, pad: 0.6, ringTime: 2, ringCool: 40, towerSpacing: 1.6, aimCone: 0.5, burn: 14, markRange: 120 },
    projectiles: { max: 60, gravity: 30, life: 4, stick: 3, hit: 2.4 },
    perception: {
      awareRise: 1.2, awareFall: 0.25, suspicious: 0.35, alert: 1.0,
      dusk: 0.75, night: 0.45,
      altitude: { from: 80, to: 220, min: 0.5 },
      hearing: { boost: 60, breath: 80, land: 60, takeoff: 90, run: 30 },
      fade: 0.3, losSteps: 8, losSpacing: 12, losTop: 1.5, searchTime: 20,
      watch: { eye: 2, sweep: 0.7, sweepRate: 0.25, turn: 1.5 },
    },

    /* Alert (Phase 2 T17, core/alert.js; 002_task_kingdom.md 4.5 and 5.5). Per region heat 0..maxHeat, level =
       floor(heat) clamped to maxLevel. Incidents add heat (`add`; sighted once per settlement and alarm, a palisade piece
       counts as no incident, livestock and loot come with T18 / T19); `quiet` s after the last incident it decays by
       `decay` per s (x towerDownMult while a watchtower of the region lies in ruins), also while the dragon is elsewhere
       (alert.catchUp on region load, from the play-time stamp `at`). responses: what each level adds (cumulative, a
       higher level overrides the same key): extra archers per tower settlement, patrols = archer pairs walking the roads
       (or between the settlements where a region has no road), the village ballista platform (settlements alert3),
       livestock kept inside (T18), a faster bell (defense.ringTime x bellFast). */
    alert: {
      maxLevel: 3, maxHeat: 3.99,
      add: { sighted: 0.2, bell: 0.5, orderBurned: 0.5, civilBurned: 0.75, livestock: 1.0, defenderKilled: 0.25, loot: 1.0 },
      quiet: 60,
      decay: 0.0035,
      towerDownMult: 2,
      bellFast: 0.5,
      patrol: { speed: 4, gap: 2.5, pause: 4, trim: 80 },   // walk speed, the pair's spacing, s at each end, route ends kept off the region edge
      responses: {
        1: { extraArchers: 1, bellFast: true },
        2: { patrols: 2 },
        3: { villageBallista: true, livestockInside: true, extraArchers: 2 },
      },
    },

    /* Corn fields (Pavel's request 2026-10-31, core/crops.js, render/corn-view.js): fields of crop kind `crop` grow stalks
       `height` tall. The breath on the stalks for `ignite` s sets the field alight (heat cools at `cool` per s); a fire front
       runs out from that spot at `spread` units/s, a `band` wide ring of popping corn that throws popcorn into the air,
       leaving charred stubble that grows back after `regrow` s of play. popcorn: renderer pool, kernels per s per unit of
       front length (`rate`, capped at `maxRate` per field), launch speed up / sideways, gravity, life on the ground (s). */
    /* Loot (Phase 2 T19, core/loot.js, render/loot-view.js; 002_task_kingdom.md 4.6). Buildings with `loot` (taxhouse:
       tithe chest, vault: strongbox) keep one item each on the ground `door` units outside their footprint (the first
       spot `clear` units away from every solid: the building's front, else the side nearest the settlement centre).
       On the ground Grab picks it up (the one claw slot, shared with prey; size like prey vs the stage's carry);
       carrying it multiplies the flight and walk speed by carry.speedMult, carry.breath false = no fire. Entering the
       lair banks its gold into the hoard ('hoard:banked'), dying loses it ('loot:lost'); a taken item comes back
       fire.rebuild s of play after it was taken (regions.<id>.lootTaken). Taking one adds alert.add.loot heat. */
    loot: {
      tithe:     { size: 1, gold: 50,  carry: { speedMult: 0.85, breath: true } },
      strongbox: { size: 2, gold: 150, carry: { speedMult: 0.8,  breath: false } },
      door: 2, clear: 3,
    },

    /* Upgrades (Phase 2 T20, core/upgrades.js; 002_task_kingdom.md 4.6). Bought with hoard gold at the cave altar, once
       each (cs.upgrades = owned ids, saved). Altar order = this order. Effects (upgrades.effects merges the owned ones:
       numbers multiply, flags OR): smellRange x the smell range, smellType names the prey on the compass, preyHighlight
       a ring under prey within smell range; arrowDamage / boltDamage x the hit damage; stRegen x stamina regen, boostSt
       x the boost / run stamina cost, takeoffSt x the takeoff cost; cookRate x the roast speed, burnRate x the building
       fire (heat under the breath and the burn); showCones draws the defenders' sight fans and awareness marks at any range. */
    upgrades: {
      prey_sense:     { cost: 120, effect: { smellRange: 1.6, smellType: true, preyHighlight: true } },
      iron_scales_1:  { cost: 150, effect: { arrowDamage: 0.7, boltDamage: 0.85 } },
      wing_muscles_1: { cost: 200, effect: { stRegen: 1.2, boostSt: 0.85, takeoffSt: 0.7 } },
      hotter_fire_1:  { cost: 250, effect: { cookRate: 1.3, burnRate: 1.3 } },
      guard_sight:    { cost: 300, effect: { showCones: true } },
    },

    /* Day and night (Phase 2 T21, core/clock.js + render/sky.js; 002_task_kingdom.md 4.6). t 0..1, 0 = midnight, 0.5 = noon;
       a full cycle takes dayLength s of play (20 min). A new run starts at `start` (morning). Light ramps up from nightTo to
       2 x dawn - nightTo and down from 2 x dusk - nightFrom to nightFrom (dawn and dusk are the middles: 8 min day, 2 min
       dusk, 8 min night, 2 min dawn). The defenders' sight = perception.night + (1 - perception.night) x light (night
       0.45: about half the day range). The nest's "Sleep until dusk / dawn" moves t forward to dusk / dawn.
       look (render/sky.js): night colours of the sky dome (top, mid, bot), the fog, the hemisphere light (sky, ground)
       and the moon light; dusk tints the horizon and the fog toward `dusk`. Intensities by day come from the scene
       (hemi 0.85, sun 1.3, rim 0.35); by night hemi x hemiNight, the moon at moon intensity, rim x rimNight, so the
       terrain and the stick area stay readable on a phone. sunElev: sun height over the horizon at dawn / noon. */
    clock: {
      dayLength: 1200, start: 0.3, dusk: 0.75, dawn: 0.25, nightFrom: 0.8, nightTo: 0.2,
      look: {
        night: { top: 0x060b18, mid: 0x111b30, bot: 0x223049, fog: 0x172236, hemiSky: 0x6d84b8, hemiGround: 0x1c1a26 },
        dusk: 0xd2683c, moon: { color: 0xa9bce8, intensity: 0.55 }, hemiNight: 0.62, rimNight: 0.7,
        sunElev: [0.05, 0.42], stars: 0.9,
      },
    },

    corn: { crop: 4, height: 3.2, ignite: 0.4, cool: 0.5, spread: 5, band: 6, regrow: 600 },
    popcorn: { pool: 1200, rate: 1.2, maxRate: 160, up: [9, 20], side: 5, gravity: 18, life: 6, size: 1.4 },

    /* Settlements and buildings (Phase 2 T12, core/settlement.js, render/settlement-view.js; 002_task_kingdom.md 4.2).
       buildings: footprint radius r and height h (a vertical cylinder solid: the roof height = ground + h), hp for the
       fire (T13), civil / order for stats (Phase 4 Renown), post = a defender post (T15 / T16), loot = items (T19),
       holds / garrison / bell / calmsAlert for later tasks. palisade = a ring of capsule pieces (piece = length,
       radius of each piece); gate = gap width (units of arc) centred on the template's local +Z.
       settlements: templates, offsets [type, x, z] from the centre, rotated by the site's yaw (+ seeded jitter of up to
       `jitter` units and jitterYaw rad per building); ring: [r, gate] palisade around the centre; pens: [type, x, z,
       count] livestock pens (radius penR + count; the sheep and cows of T18); alert3: buildings added at alert 3 (T17).
       pad: the dragon's collision radius x scale against building solids (walking and flying).
       fire (T13, core/settlement.js burn / rebuild): ignite = s of breath on a building until it catches fire (the heat
       cools at `cool` per s out of the breath); a burning building loses `burn` hp/s on its own, `fan` hp/s more while the
       breath stays on it (a hatchling burns a tower down in about 10 s of breath); each s a burning building sets each
       neighbour (same settlement, footprints within `reach`) alight with chance `spread`; a ruin comes back after
       `rebuild` s of play (not while the dragon stands in its footprint). */
    buildings: {
      house:    { r: 5, h: 7,  hp: 60,  civil: true },
      barn:     { r: 7, h: 9,  hp: 90,  civil: true,  holds: 'livestock' },
      granary:  { r: 5, h: 8,  hp: 70,  civil: true },
      taxhouse: { r: 5, h: 7,  hp: 70,  order: true, loot: ['tithe'] },
      tower:    { r: 3, h: 16, hp: 80,  order: true, post: 'archer', calmsAlert: true },
      bell:     { r: 2, h: 6,  hp: 30,  civil: true, bell: true },
      barracks: { r: 7, h: 8,  hp: 120, order: true, garrison: 2 },
      vault:    { r: 4, h: 6,  hp: 150, order: true, loot: ['strongbox'] },
      palisade: { r: 0, h: 6,  hp: 40,  order: true, wall: true },
      platform: { r: 4, h: 4,  hp: 80,  order: true, post: 'ballista' },
    },
    palisade: { piece: 6, radius: 1, gate: 12 },
    fire: { ignite: 0.8, cool: 0.5, burn: 6, fan: 2.5, spread: 0.15, reach: 8, rebuild: 600 },
    settlement: { jitter: 1, jitterYaw: 0.2, penR: 4, pad: 1.4 },          // penR 4 (T18): room for the animals, drawn larger than life
    settlements: {
      hamlet:   { buildings: [['house', -8, 0], ['house', 8, 4], ['barn', -3, -13], ['bell', 0, 10]],
                  pens: [['sheep', 14, -10, 4]], peasants: 3 },
      village:  { buildings: [['house', -12, 22], ['house', 4, 26], ['house', 24, 24], ['house', -30, 12], ['house', 34, -16],
                              ['house', -8, -30], ['barn', -34, -24], ['granary', 8, -26], ['taxhouse', 2, 6], ['tower', 24, -18],
                              ['bell', -6, -8]],
                  pens: [['sheep', 20, 0, 5], ['cow', -20, -10, 3]], peasants: 6, archers: 2,
                  alert3: { buildings: [['platform', 12, 18]] } },
      outpostS: { buildings: [['tower', 0, 0], ['taxhouse', 7, 7]], ring: [16, 12], archers: 2 },
      outpost:  { buildings: [['tower', -14, 0], ['tower', 14, 0], ['barracks', 0, -10], ['vault', 0, 6],
                              ['platform', -10, 14], ['platform', 10, 14]], ring: [24, 12], archers: 4 },
    },

    regions: {
      ash: {
        nameKey: 'c.region.ash', radius: 1100, seed: 11, ceiling: 320,
        terrain: { amp: 0.9, base: 20, features: [
          { type: 'cone', x: 0, z: 0, r: 260, h: 150, crater: { r: 38, depth: 30 } },
          { type: 'flatten', x: 0, z: 0, r: 1100, toward: 14, from: 700 },
        ] },
        palette: 'ash',
        // cave mouth on the volcano's +Z flank, opening toward the Wildwood exit;
        // the mouth centre sits `above` units over the slope (terrain.lairPos computes it)
        lair: { x: 0, z: 150, above: 7, r: 18, facing: 0 },
        spawn: { x: 0, z: 260, y: 110, yaw: 0 },          // respawn point in front of the cave, facing away (+Z)
        flora: { trees: 60, rocks: 140 },
        herds: [{ type: 'goat', count: 4, ring: [350, 900] }],
        exits: [{ to: 'wild', angleFrom: -0.6, angleTo: 0.6 }],     // radians, 0 = +Z; region edge arc on the +Z side
        entries: { wild: { angle: 0 } },
      },
      wild: {
        nameKey: 'c.region.wild', radius: 1100, seed: 23, ceiling: 280,
        waterLevel: 0.6,                                    // lakes in the hollows (T11: not landable, not walkable)
        terrain: { amp: 1.0, base: 12, features: [
          { type: 'plateau', x: 420, z: -300, r: 40 },      // settlement ground (T11): the hamlet and the small outpost (T12)
          { type: 'plateau', x: -380, z: 520, r: 30 },
        ] },
        palette: 'forest',
        flora: { trees: 1400, rocks: 120 },
        herds: [{ type: 'deer', count: 5, ring: [200, 1000] }, { type: 'boar', count: 3, ring: [300, 1000] },
                { type: 'goat', count: 2, ring: [600, 1000] }],
        settlements: [{ type: 'hamlet', x: 420, z: -300, yaw: 0.4 }, { type: 'outpostS', x: -380, z: 520, yaw: 2.1 }],
        // minStage: a smaller dragon is told it is too small (prompt, no travel); the Farmlands are for a Drake
        exits: [{ to: 'ash', angleFrom: PI - 0.6, angleTo: PI + 0.6 }, { to: 'farm', angleFrom: -0.6, angleTo: 0.6, minStage: 1 }],
        entries: { ash: { angle: PI }, farm: { angle: 0 } },
      },
      /* River Farmlands (Phase 2 T11): open farmland, a river across the middle, a road from the Wildwood side up to
         the village, flat plateaus for the three settlements (T12). river: points, width, depth (+ level, valley);
         road: points, width; plateau: x, z, r (+ edge, y). flora.fields = crop fields placed near roads and the river. */
      farm: {
        nameKey: 'c.region.farm', radius: 1100, seed: 37, ceiling: 300,
        waterLevel: 0,                                      // ponds in the lowest hollows
        terrain: { amp: 0.6, base: 12, features: [
          { type: 'road', points: [[0, -1100], [0, -300], [380, 260], [700, 640]], width: 8 },
          { type: 'river', points: [[-1100, -200], [-300, 0], [200, 150], [1100, 80]], width: 26, depth: 6 },
          { type: 'plateau', x: 380, z: 260, r: 70 }, { type: 'plateau', x: -420, z: -460, r: 50 },
          { type: 'plateau', x: 640, z: -520, r: 90 },
        ] },
        palette: 'farm',
        flora: { trees: 500, rocks: 60, fields: 24 },
        herds: [{ type: 'deer', count: 2, ring: [700, 1000] }],
        settlements: [{ type: 'village', x: 380, z: 260, yaw: 0 }, { type: 'hamlet', x: -420, z: -460, yaw: 1.2 },
                      { type: 'outpost', x: 640, z: -520, yaw: -0.8 }],
        exits: [{ to: 'wild', angleFrom: PI - 0.6, angleTo: PI + 0.6 }],
        entries: { wild: { angle: PI } },
      },
    },
    startRegion: 'ash',

    /* The mother dragon (Phase 2 T05, core/mother.js). She flies ahead toward the lesson's goal, demonstrates
       (show) once the hatchling is within showRange of it, then circles over it (wait) until the hatchling copies her.
       goal: 'self' (fly ahead of the hatchling), 'herd' (nearest prey it can lift), 'heavy' (nearest prey too big
       to lift), 'lair' (the cave mouth); a goal in another region leads to that exit. needPrey: lead to a herd while
       the claws are empty. done: { event: [...] } completes on any of those core events, { follow: s } after s
       seconds within followRange of her, { dive: s } after s seconds pitched below divePitch.
       After the lessons (and between lessons while the dragon is a Drake) she leaves and visits now and then:
       While she shows or waits over a heavy prey (roast lesson) she holds it still: it cannot move or charge
       for `hold` s after each frame she is there (prey.held).
       visit[0] for a hatchling, visit[1] for a Drake (away longer, stays shorter). danger: zones per region she
       never enters (defenders add theirs through ctx.danger from T15 on). */
    mother: {
      scale: 3.1, speed: 70, gain: 1.6, accel: 2.5, minAlt: 10, alt: 22, ahead: 40, side: 22, spawnAhead: 14,
      followRange: 60, divePitch: -0.32, showRange: 110, arrive: 60, loseRange: 320, showTime: 4.5, skim: 4,
      breathStand: 22, breathAlt: 9, circleR: 30, circleAlt: 34, circleRate: 0.45, praiseTime: 3.5,
      exitInset: 130, dangerPad: 40, hold: 0.5, teleport: 650, leaveFade: 5, drakeGap: 90,
      visit: [{ away: 150, stay: 40 }, { away: 420, stay: 25 }],
      lessons: [
        { id: 'fly',   goal: 'self',  done: { follow: 6 } },
        { id: 'dive',  goal: 'herd',  show: 'dive',   done: { dive: 0.8 } },
        { id: 'grab',  goal: 'herd',  show: 'grab',   done: { event: ['prey:grabbed'] } },
        { id: 'eat',   goal: 'self',  needPrey: true, done: { event: ['prey:eaten'] } },
        { id: 'roast', goal: 'heavy', show: 'breath', done: { event: ['prey:roasted'] } },
        { id: 'carry', goal: 'lair',  needPrey: true, done: { event: ['lair:stored', 'lair:full'] } },
        { id: 'rest',  goal: 'lair',  done: { event: ['lair:rest'] } },
      ],
    },

    controls: { grab: 'KeyG', eat: 'KeyX', confirm: 'Enter', land: 'KeyF' },
  };

  M.define('data', data);
})(typeof self !== 'undefined' ? self : this);
