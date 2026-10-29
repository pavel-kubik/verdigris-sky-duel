// Long seeded runs (T16): a scripted hunter bot (test/bot.js) plays from a fresh hatchling to Drake.
// Balance target (001_task_survival.md 7, T16): the novice bot reaches Drake in 25-35 simulated minutes on average.
// Invariants checked every step: finite state, hunger 0-100, starvation never kills (HP floor), prey count bounded,
// the stage only changes when resting in the lair.
'use strict';
const { ok } = require('./harness.js');
const B = require('./bot.js');
const M = require('../core/umd.js');
const D = M.need('data'), T = M.need('terrain'), HN = M.need('hunger'), G = M.need('growth');
const { finite } = M.need('math');

const NOVICE_SEEDS = [1, 2, 3, 4, 5, 6];
const TARGET = [25, 35];                 // mean minutes to Drake for the novice bot
const SINGLE = [15, 45];                 // any single novice seed
const PREY_MAX = D.preyAi.maxActive + 12; // live animals are capped at maxActive; roast chunks come on top for a while

/** check() for B.run: invariants on every step; bad counts failures (ok() is called once per run, not per step). */
function watcher() {
  const w = { bad: [], steps: 0, lastStage: 0, maxPrey: 0, minHpStarving: Infinity };
  w.check = (cs, ev) => {
    w.steps++;
    const d = cs.dragon, p = d.pilot, st = G.statsOf(d.stage);
    const fail = msg => { if (w.bad.length < 5) w.bad.push(msg + ' @' + w.steps); };
    if (!finite(p.pos) || !Number.isFinite(p.speed) || !Number.isFinite(p.yaw)) fail('pilot not finite');
    if (!(d.hunger >= 0 && d.hunger <= D.hunger.max)) fail('hunger out of range ' + d.hunger);
    if (!(d.hp >= 0 && d.hp <= st.hpMax)) fail('hp out of range ' + d.hp);
    if (!(d.foodXp >= 0 && d.foodXp <= D.growthCap.food)) fail('food XP out of range');
    if (Math.hypot(p.pos[0], p.pos[2]) > T.region(cs.region).radius + 1) fail('outside the region');
    if (cs.field.list.length > PREY_MAX) fail('too many prey ' + cs.field.list.length);
    w.maxPrey = Math.max(w.maxPrey, cs.field.list.length);
    if (HN.stateOf(d.hunger) === 'starving' && !ev.some(e => e.e === 'boar:hit')) w.minHpStarving = Math.min(w.minHpStarving, d.hp);
    if (ev.some(e => e.e === 'dragon:died' && e.cause !== 'boar')) fail('died of ' + ev.find(e => e.e === 'dragon:died').cause);
    if (d.stage !== w.lastStage) {
      if (!ev.some(e => e.e === 'lair:rest')) fail('stage changed outside a rest');
      w.lastStage = d.stage;
    }
  };
  return w;
}

// 1. Novice bot (sight-limited search, reaction delay, botched swoops): Drake in 25-35 min on average
{
  const mins = [];
  for (const seed of NOVICE_SEEDS) {
    const w = watcher();
    const r = B.run({ seed, profile: 'novice', maxMin: 60, check: w.check });
    ok(r.grew, 'novice seed ' + seed + ' reaches Drake within 60 min');
    ok(w.bad.length === 0, 'novice seed ' + seed + ' invariants: ' + w.bad.join('; '));
    ok(r.minutes >= SINGLE[0] && r.minutes <= SINGLE[1], 'novice seed ' + seed + ' time in ' + SINGLE.join('-') + ': ' + r.minutes.toFixed(1));
    ok(r.cs.dragon.stage === 1 && r.cs.inLair, 'grows in the lair');
    ok(r.stats.meals > 20 && r.stats.food >= D.stages[1].foodFrom, 'grew by eating: ' + r.stats.meals + ' meals');
    mins.push(r.minutes);
  }
  const mean = mins.reduce((a, b) => a + b, 0) / mins.length;
  ok(mean >= TARGET[0] && mean <= TARGET[1], 'novice mean time to Drake in ' + TARGET.join('-') + ' min: ' + mean.toFixed(1) +
     ' (' + mins.map(m => m.toFixed(1)).join(', ') + ')');
  if (process.env.SIM_VERBOSE) console.log('     novice minutes to Drake: ' + mins.map(m => m.toFixed(1)).join(', ') + ', mean ' + mean.toFixed(1));
}

// 2. Expert bot (sees every animal, perfect swoops): a lower bound, growth still takes a while
{
  const w = watcher();
  const r = B.run({ seed: 1, profile: 'expert', maxMin: 40, check: w.check });
  ok(r.grew && w.bad.length === 0, 'expert reaches Drake with the invariants holding: ' + w.bad.join('; '));
  ok(r.minutes >= 8, 'even a perfect hunter needs 8+ min: ' + r.minutes.toFixed(1));
}

// 3. Starve and recover: idle until starving, HP sinks to the floor and no further, then hunting brings it back
{
  const w = watcher();
  const floor = D.hunger.starving.hpFloor * D.stages[0].hp;
  const r = B.run({ seed: 4, profile: 'novice', maxMin: 60, idleUntil: 0, check: w.check });
  ok(r.stats.wokeAt > 3, 'hunger runs out after a few idle minutes: ' + (r.stats.wokeAt || 0).toFixed(1));
  ok(r.stats.starvingS > 30, 'spent time starving: ' + r.stats.starvingS.toFixed(0) + ' s');
  ok(w.minHpStarving >= floor - 1e-9, 'starving HP never below the floor: ' + w.minHpStarving.toFixed(1));
  ok(r.stats.deaths === 0 || w.bad.length === 0, 'no death from hunger');
  ok(r.grew && w.bad.length === 0, 'recovers from starving and still reaches Drake: ' + r.minutes.toFixed(1) + ' min; ' + w.bad.join('; '));
}

