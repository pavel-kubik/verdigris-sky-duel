/*
 * Verdigris campaign - hunger: drain, states (fed / hungry / starving) and their effects.
 * Starvation weakens but never kills: its HP drain stops at a floor (hpFloor x max HP).
 * Other damage (a boar's charge) can still go below the floor. See 001_task_survival.md 5.3.
 * A "dragon" here is any object with { stage, foodXp, hp, hunger }.
 */
(function (root) {
  'use strict';
  const M = typeof module === 'object' && module.exports ? require('./umd.js') : root.VCamp;
  const D = M.need('data'), G = M.need('growth');
  const { clamp } = M.need('math');
  const H = D.hunger;

  function stateOf(hunger) {
    if (hunger <= H.states.starving) return 'starving';
    if (hunger <= H.states.hungry) return 'hungry';
    return 'fed';
  }

  /** Effects of a hunger value on flight and survival. */
  function effects(hunger) {
    const s = stateOf(hunger);
    if (s === 'starving') {
      return { state: s, speedMult: H.starving.speedMult, stRegenMult: H.hungryStRegenMult, canBreath: H.starving.breath,
               carryMax: H.starving.carryMax, hpRegen: 0, hpDrain: H.starving.hpDrain };
    }
    if (s === 'hungry') {
      return { state: s, speedMult: 1, stRegenMult: H.hungryStRegenMult, canBreath: true, carryMax: Infinity, hpRegen: 0, hpDrain: 0 };
    }
    return { state: s, speedMult: 1, stRegenMult: 1, canBreath: true, carryMax: Infinity,
             hpRegen: hunger > H.fedHpRegenAbove ? H.fedHpRegen : 0, hpDrain: 0 };
  }

  /**
   * One hunger step. act: { boosting, breathing, inLair }.
   * Returns the new state name when it changed this step, else null.
   */
  function step(dragon, dt, act) {
    act = act || {};
    if (act.inLair) return null;                                  // resting pauses hunger
    const before = stateOf(dragon.hunger), st = G.statsOf(dragon.stage);
    const rate = (H.drain + (act.boosting ? H.boostDrain : 0) + (act.breathing ? H.breathDrain : 0)) * st.hungerMult;
    dragon.hunger = clamp(dragon.hunger - rate * dt, 0, H.max);
    const e = effects(dragon.hunger);
    if (e.hpRegen > 0) dragon.hp = Math.min(st.hpMax, dragon.hp + e.hpRegen * dt);
    if (e.hpDrain > 0) {
      const floor = H.starving.hpFloor * st.hpMax;
      if (dragon.hp > floor) dragon.hp = Math.max(floor, dragon.hp - e.hpDrain * dt);
    }
    const after = stateOf(dragon.hunger);
    return after !== before ? after : null;
  }

  /** Eating: fills hunger and adds food XP. Returns true when the meal made a stage-up ready. */
  function feed(dragon, food) {
    dragon.hunger = clamp(dragon.hunger + food, 0, H.max);
    return G.addFood(dragon, food);
  }

  M.define('hunger', { stateOf, effects, step, feed });
})(typeof self !== 'undefined' ? self : this);
