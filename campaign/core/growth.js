/*
 * Verdigris campaign - growth: stage, visual scale and stats from cumulative food eaten (food XP).
 * Eating keeps adding XP and the dragon keeps growing visibly within its stage, but the stage itself
 * only changes when resting in the lair (lair.rest calls readyStage). See 001_task_survival.md 5.2.
 * A "dragon" here is any object with { stage, foodXp }.
 */
(function (root) {
  'use strict';
  const M = typeof module === 'object' && module.exports ? require('./umd.js') : root.VCamp;
  const D = M.need('data');
  const { clamp, lerp } = M.need('math');

  const S = D.stages;
  /** First food XP of the stage after index i (for the last stage: one past the cap). */
  const nextFood = i => (i + 1 < S.length ? S[i + 1].foodFrom : D.growthCap.food + 1);
  const nextGrowth = i => (i + 1 < S.length ? S[i + 1].growthFrom : D.growthCap.growth + 0.01);

  /** Progress 0..1 of food XP through stage i (clamped: beyond the next threshold stays 1). */
  function progressIn(i, foodXp) {
    return clamp((foodXp - S[i].foodFrom) / (nextFood(i) - S[i].foodFrom), 0, 1);
  }

  /** The stage food XP qualifies for (regardless of resting). */
  function stageOf(foodXp) {
    let index = 0;
    for (let i = 0; i < S.length; i++) if (foodXp >= S[i].foodFrom) index = i;
    return { index, id: S[index].id, def: S[index], progress: progressIn(index, foodXp) };
  }

  /** Overall growth 0..1 (the save's "growth" field and future stat curves). */
  function growthValue(foodXp) {
    const s = stageOf(foodXp);
    return Math.min(D.growthCap.growth, lerp(s.def.growthFrom, nextGrowth(s.index), s.progress));
  }

  /** Visual scale for a dragon of stage index `stage` with this food XP: grows within the stage, capped at its scaleTo. */
  function scaleOf(foodXp, stage) {
    const s = S[stage];
    return lerp(s.scaleFrom, s.scaleTo, progressIn(stage, foodXp));
  }

  /** Stage index the dragon would reach by resting now (never lower than its current stage). */
  function readyStage(foodXp, stage) {
    return Math.max(stage, stageOf(foodXp).index);
  }

  /** Flight and survival stats of a stage. */
  function statsOf(stage) {
    const s = S[stage];
    return { hpMax: s.hp, turn: s.turn, cruise: s.cruise, boost: s.boost, spot: s.spot, carry: s.carry, hungerMult: s.hungerMult };
  }

  /**
   * Adds food XP (capped). Returns true exactly when this meal made a new stage ready
   * (the "Rest in the lair to grow" moment).
   */
  function addFood(dragon, food) {
    const before = readyStage(dragon.foodXp, dragon.stage);
    dragon.foodXp = Math.min(D.growthCap.food, dragon.foodXp + Math.max(0, food));
    return readyStage(dragon.foodXp, dragon.stage) > before;
  }

  /** Applies a ready stage-up (called by lair.rest). Returns { grew, from, to }. */
  function growUp(dragon) {
    const from = dragon.stage, to = readyStage(dragon.foodXp, dragon.stage);
    dragon.stage = to;
    return { grew: to > from, from, to };
  }

  M.define('growth', { stageOf, growthValue, scaleOf, readyStage, statsOf, addFood, growUp, progressIn });
})(typeof self !== 'undefined' ? self : this);
