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

    /* Growth stages. carry = max prey size class (1 small, 2 medium, 3 large, 4 huge).
       Visual scale grows from scaleFrom to scaleTo with food XP inside a stage;
       the stage itself changes only when resting in the lair. */
    stages: [
      { id: 'hatchling', foodFrom: 0, growthFrom: 0.00, scaleFrom: 1.0, scaleTo: 1.5,
        hp: 100, turn: 1.00, cruise: 30, boost: 54, hungerMult: 1.0, spot: 1.0, carry: 1 },
      { id: 'drake', foodFrom: 600, growthFrom: 0.25, scaleFrom: 1.6, scaleTo: 2.4,
        hp: 220, turn: 0.85, cruise: 32, boost: 56, hungerMult: 1.5, spot: 1.5, carry: 2 },
      // wyrm (foodFrom 2400, growthFrom 0.55) and elder (growthFrom 0.85) arrive in phases 4-5
    ],
    growthCap: { food: 2399, growth: 0.54 },

    hunger: {
      max: 100, start: 80,
      drain: 0.28,            // per second at hungerMult 1 (100 to 0 in about 6 min)
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
    roast: { foodMult: 0.5, chunkSize: 1, chunkFood: 11, cookTime: 1.2 },
    grab: { radius: 6, maxAboveGround: 8, maxPitch: -0.12 },
    eat: { time: 2.5, speedCap: 18 },
    respawn: { herdCooldown: 90, minDistFromDragon: 250 },
    preyAi: { fullRange: 600, farTickHz: 4, maxActive: 40 },

    flight: { minAlt: 5, edgeMargin: 60, baseTurn: 1.55 },

    lair: { larderSize: 3, spoilEvery: 30, respawnHp: 0.5, respawnHunger: 40 },

    regions: {
      ash: {
        nameKey: 'c.region.ash', radius: 1100, seed: 11, ceiling: 320,
        terrain: { amp: 1.4, base: 2, features: [
          { type: 'cone', x: 0, z: 0, r: 260, h: 150, crater: { r: 38, depth: 30 } },
          { type: 'flatten', x: 0, z: 0, r: 1100, toward: 6, from: 700 },
        ] },
        palette: 'ash',
        lair: { x: 0, z: 150, y: 70, r: 18 },            // cave mouth on the volcano's south flank
        spawn: { x: 0, z: 260, y: 110, yaw: 0 },          // respawn point in front of the cave, facing away (+Z)
        flora: { trees: 60, rocks: 140 },
        herds: [{ type: 'goat', count: 4, ring: [350, 900] }],
        exits: [{ to: 'wild', angleFrom: -0.6, angleTo: 0.6 }],     // radians around +Z (north arc)
        entries: { wild: { angle: 0 } },
      },
      wild: {
        nameKey: 'c.region.wild', radius: 1100, seed: 23, ceiling: 280,
        terrain: { amp: 1.0, base: 4, features: [] },
        palette: 'forest',
        flora: { trees: 1400, rocks: 120 },
        herds: [{ type: 'deer', count: 5, ring: [200, 1000] }, { type: 'boar', count: 3, ring: [300, 1000] },
                { type: 'goat', count: 2, ring: [600, 1000] }],
        exits: [{ to: 'ash', angleFrom: PI - 0.6, angleTo: PI + 0.6 }],
        entries: { ash: { angle: PI } },
      },
    },
    startRegion: 'ash',

    controls: { grab: 'KeyG', eat: 'KeyX', confirm: 'Enter' },
  };

  M.define('data', data);
})(typeof self !== 'undefined' ? self : this);
