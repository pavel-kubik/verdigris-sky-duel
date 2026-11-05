// Seeded mission bot (Phase 3 T13; T19 adds destroy and intercept and the balancing pass): the steal mission from the
// board to the banked Ember Chalice. A Drake at full hunger accepts a2_chalice in the cave of the Ashen Crags, flies
// through the Wildwood and the Farmlands into the Veltava Bend, lands inside the walls of Vyshgard Castle, takes the
// chalice at the chapel door on foot and escapes - to the lair, or into a found aerie on the way.
// Targets (003_task_missions.md T13 / 1. exit criteria): every seed succeeds before the timer runs out; the mean
// mission (from leaving the cave to the banked chalice) is in the 5-10 min band; the trophy wall shows the chalice.
'use strict';
const { ok } = require('./harness.js');
const MB = require('./mission-bot.js');
const M = require('../core/umd.js');
const S = M.need('state'), D = M.need('data'), F = M.need('flight'), G = M.need('growth'), MS = M.need('missions'),
  RL = M.need('relics'), CA = M.need('castle');
const { mulberry } = M.need('math');

const SEEDS = [1, 2, 3, 4];
const BAND = [5, 10];                     // minutes per mission, mean over SEEDS (lair escape)
const id = 'a2_chalice', md = MS.def(id);

/** A Drake at full hunger in the cave of the Ashen Crags (act 2); found: aerie regions already discovered. */
function drake(seed, found) {
  const cs = S.create({ rng: mulberry(seed) });
  cs.story.act = 2;
  Object.assign(cs.dragon, { stage: 1, foodXp: D.stages[1].foodFrom, hp: D.stages[1].hp, hunger: D.hunger.max });
  cs.dragon.pilot = F.newPilot([0, 200, 0], 0, G.statsOf(1).cruise);
  cs.inLair = true;
  cs.discovered = cs.discovered || {};
  for (const r of found || []) cs.discovered[r + '.aerie'] = true;
  return cs;
}

/** Inside the castle wall polygon (world x, z; the castle's local frame turned by its yaw). */
function inCastle(cs, x, z) {
  const pl = cs.town.places.find(p => p.castle) || {};
  const dx = x - pl.x, dz = z - pl.z, c = Math.cos(pl.yaw || 0), s = Math.sin(pl.yaw || 0);
  return CA.inside(null, dx * c - dz * s, dx * s + dz * c);
}

// 1. lair escape, one run per seed: succeeds in time, the chalice on the trophy wall
{
  const mins = [];
  for (const seed of SEEDS) {
    const cs = drake(seed), log = [];
    const r = MB.fly(cs, id, { seed, profile: 'careful', check: (c, ev) => { for (const e of ev) if (/^mission:/.test(e.e)) log.push(e.e); } });
    const tag = 'seed ' + seed + ' ';
    ok(r.accepted, tag + 'accepted at the board');
    ok(log[0] === 'mission:started' && log.indexOf('mission:done') > 0, tag + 'timer starts out of the cave, chalice taken: ' + log.join(','));
    ok(r.success && r.success.id === id && !r.failed && !r.died, tag + 'mission success: ' + JSON.stringify(r.log.slice(-4)) + ' ' + r.died);
    ok(r.landed && cs.region === 'ash' && cs.inLair, tag + 'banked in the lair');
    if (r.landed) {
      cs.region = 'bend'; S.ensureTown(cs);                 // read the castle of the Bend for the landing check
      ok(inCastle(cs, r.landed[0], r.landed[1]), tag + 'set down inside the castle walls: ' + r.landed.map(v => v.toFixed(0)).join(','));
      cs.region = 'ash'; S.ensureTown(cs);
    }
    ok(RL.has(cs, 'ember_chalice') && RL.wall(cs).some(n => n.id === 'ember_chalice' && n.has), tag + 'the trophy wall shows the chalice');
    ok(cs.missions.completed.indexOf(id) >= 0 && MS.list(cs).find(q => q.id === id).why === 'done', tag + 'completed, off the board');
    ok(r.success && r.success.left > 0 && r.success.gold >= md.reward.gold, tag + 'in time, reward with bonus: ' + (r.success && r.success.gold));
    ok(cs.hoard.gold === (r.success ? r.success.gold : -1), tag + 'reward on the hoard');
    ok(r.hpLeft > 0, tag + 'alive (' + (100 * r.hpLeft / D.stages[1].hp).toFixed(0) + '% HP; T19 balances to 20%)');
    mins.push(r.minutes);
    if (process.env.SIM_VERBOSE) console.log('     steal seed ' + seed + ': ' + r.minutes.toFixed(2) + ' min, ' + (r.success ? r.success.left.toFixed(0) : '-') + ' s left, HP ' + (100 * r.hpLeft / D.stages[1].hp).toFixed(0) + '%');
  }
  const mean = mins.reduce((a, b) => a + b, 0) / mins.length;
  ok(mean >= BAND[0] && mean <= BAND[1], 'steal: mean mission in ' + BAND.join('-') + ' min: ' + mean.toFixed(2) + ' (' + mins.map(m => m.toFixed(1)).join(', ') + ')');
}

// 2. aerie escape: with the Farmlands and Troyvale aeries found the dragon banks in the nearer aerie, faster than the lair
{
  const cs = drake(1, ['farm', 'bend']), seen = [];
  const r = MB.fly(cs, id, { seed: 1, profile: 'careful', escape: 'aerie', check: c => {
    const ob = MS.objective(c);
    if (ob && seen.indexOf(ob.key) < 0) seen.push(ob.key);
  } });
  ok(r.success && !r.failed && cs.inAerie && !cs.inLair, 'aerie escape: success inside an aerie (' + cs.inAerie + ')');
  ok(RL.has(cs, 'ember_chalice') && r.banked && r.banked.e === 'relic:banked', 'aerie escape: the chalice banked at the aerie');
  ok(seen.indexOf('c.mission.obj.steal') >= 0 && seen.indexOf('c.mission.obj.homeAerie') > seen.indexOf('c.mission.obj.steal'), 'objective line: steal, then escape to the aerie here: ' + seen.join(','));
  ok(r.success && r.success.left > 120, 'aerie escape leaves more time: ' + (r.success && r.success.left.toFixed(0)) + ' s');
}

// 3. the objective line names the escape only where a found aerie is
{
  const cs = drake(2);
  cs.inLair = false; cs.region = 'bend'; S.ensureTown(cs);
  MS.accept(cs, id); MS.finish(cs);
  ok(MS.objective(cs).key === 'c.mission.obj.home', 'done, no aerie found here: fly into the lair or an aerie');
  cs.discovered['bend.aerie'] = true;
  const ob = MS.objective(cs);
  ok(ob.key === 'c.mission.obj.homeAerie' && ob.p.region === 'c.region.bend', 'done, Troyvale aerie found: escape there or to the lair');
  cs.region = 'ash';
  ok(MS.objective(cs).key === 'c.mission.obj.home', 'no aerie in the Ash Wastes: the lair');
}
