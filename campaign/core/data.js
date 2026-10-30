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
        terrain: { amp: 1.0, base: 12, features: [] },
        palette: 'forest',
        flora: { trees: 1400, rocks: 120 },
        herds: [{ type: 'deer', count: 5, ring: [200, 1000] }, { type: 'boar', count: 3, ring: [300, 1000] },
                { type: 'goat', count: 2, ring: [600, 1000] }],
        exits: [{ to: 'ash', angleFrom: PI - 0.6, angleTo: PI + 0.6 }],
        entries: { ash: { angle: PI } },
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
