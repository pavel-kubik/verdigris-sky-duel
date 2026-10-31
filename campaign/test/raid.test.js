// Scripted raids (Phase 2 T24, test/raid-bot.js): a Drake leaves the cave, flies through the Wildwood into the River
// Farmlands, lands by the outpost vault, takes the strongbox on foot, flies home and banks it.
// Balance targets (002_task_kingdom.md T24, measured for the "careful" pilot):
//   one raid from a full stomach banks the strongbox in RAID_MIN simulated minutes with at least 20% HP left;
//   back-to-back raids lift the Farmlands alert one level per raid, to 3 after 3 raids;
//   5 quiet minutes (in the cave) lower it by a level.
// Invariants on every step: projectiles bounded, gold never negative, heat in 0..maxHeat, the dragon never inside a
// building, pilot finite, HP and hunger in range.
'use strict';
const { ok } = require('./harness.js');
const R = require('./raid-bot.js');
const M = require('../core/umd.js');
const S = M.need('state'), D = M.need('data'), F = M.need('flight'), AL = M.need('alert'), G = M.need('growth');
const { mulberry, finite } = M.need('math');

const SEEDS = [1, 2, 3, 4, 5, 6];
const RAID_MIN = [4.5, 12];              // minutes per raid, careful pilot (any seed)
const RAID_MEAN = [5, 12];               // mean over SEEDS
const HP_LEFT = 0.2;                     // of hpMax when the strongbox is banked

/** A Drake at full hunger in the cave of the Ashen Crags, no mother around (act 2). */
function drake(seed) {
  const cs = S.create({ rng: mulberry(seed) });
  cs.story.act = 2;
  Object.assign(cs.dragon, { stage: 1, foodXp: D.stages[1].foodFrom, hp: D.stages[1].hp, hunger: D.hunger.max });
  cs.dragon.pilot = F.newPilot([0, 200, 0], 0, G.statsOf(1).cruise);
  cs.inLair = true;
  return cs;
}

/** check() for R.raid: invariants on every step; the first few failures are kept (ok() runs once per raid). */
function watcher() {
  const w = { bad: [], steps: 0, maxProj: 0, peak: {} };
  w.check = cs => {
    w.steps++;
    const d = cs.dragon, p = d.pilot, fail = m => { if (w.bad.length < 5) w.bad.push(m + ' @' + w.steps); };
    if (!finite(p.pos) || !Number.isFinite(p.speed)) fail('pilot not finite');
    if (!(d.hp >= 0 && d.hp <= G.statsOf(d.stage).hpMax)) fail('hp out of range ' + d.hp);
    if (!(d.hunger >= 0 && d.hunger <= D.hunger.max)) fail('hunger out of range ' + d.hunger);
    if (!(cs.hoard.gold >= 0)) fail('gold negative ' + cs.hoard.gold);
    for (const id in cs.regionStates) {
      const h = cs.regionStates[id].heat;
      if (h != null && !(h >= 0 && h <= D.alert.maxHeat)) fail('heat out of range ' + id + ' ' + h);
      if (h != null) w.peak[id] = Math.max(w.peak[id] || 0, h);
    }
    if (cs.squad) {
      const n = cs.squad.arrows.length + (cs.squad.bolts || []).length;
      w.maxProj = Math.max(w.maxProj, n);
      if (n > D.projectiles.max) fail('projectiles ' + n);
    }
    if (R.insideSolid(cs)) fail('inside a building at ' + p.pos.map(v => v.toFixed(1)).join(','));
  };
  return w;
}

// 1. one raid per seed (careful pilot): banks the outpost strongbox in time, with HP to spare
{
  const mins = [];
  for (const seed of SEEDS) {
    const cs = drake(seed), w = watcher();
    const r = R.raid(cs, { seed, profile: 'careful', check: w.check });
    ok(r.banked && r.banked.kind === 'strongbox' && r.gold === D.loot.strongbox.gold, 'seed ' + seed + ' banks the strongbox: ' + JSON.stringify(r.log.slice(-4)));
    ok(cs.hoard.gold === D.loot.strongbox.gold && cs.inLair, 'seed ' + seed + ' 150 gold on the hoard, in the cave');
    ok(!r.died, 'seed ' + seed + ' survives: ' + r.died);
    ok(r.minutes >= RAID_MIN[0] && r.minutes <= RAID_MIN[1], 'seed ' + seed + ' raid time in ' + RAID_MIN.join('-') + ' min: ' + r.minutes.toFixed(2));
    ok(r.hpLeft >= HP_LEFT * D.stages[1].hp, 'seed ' + seed + ' at least 20% HP left: ' + (100 * r.hpLeft / D.stages[1].hp).toFixed(0) + '%');
    ok(r.stats.arrowHits > 0, 'seed ' + seed + ' the archers did shoot (' + r.stats.arrowHits + ' hits, ' + r.stats.boltHits + ' bolts)');
    ok(w.bad.length === 0, 'seed ' + seed + ' invariants: ' + w.bad.join('; '));
    ok(Math.floor(w.peak.farm) === 1, 'seed ' + seed + ' one raid = alert 1 in the Farmlands: ' + w.peak.farm.toFixed(2));
    mins.push(r.minutes);
    if (process.env.SIM_VERBOSE) console.log('     raid seed ' + seed + ': ' + r.minutes.toFixed(2) + ' min, HP ' + (100 * r.hpLeft / 220).toFixed(0) + '%, ' + r.stats.arrowHits + ' arrows, ' + r.stats.boltHits + ' bolts, ' + r.stats.meals + ' meals, hunger ' + cs.dragon.hunger.toFixed(0));
  }
  const mean = mins.reduce((a, b) => a + b, 0) / mins.length;
  ok(mean >= RAID_MEAN[0] && mean <= RAID_MEAN[1], 'mean raid time in ' + RAID_MEAN.join('-') + ' min: ' + mean.toFixed(2) + ' (' + mins.map(m => m.toFixed(1)).join(', ') + ')');
}

// 2. the expert pilot (knows the way, no fumbles) is faster and also banks: a lower bound for a raid
{
  const cs = drake(1), w = watcher();
  const r = R.raid(cs, { seed: 1, profile: 'expert', check: w.check });
  ok(r.banked && w.bad.length === 0, 'expert banks the strongbox, invariants hold: ' + w.bad.join('; '));
  ok(r.minutes >= 3.5, 'even an expert raid takes 3.5+ min: ' + r.minutes.toFixed(2));
}

// 3. three raids back to back: alert 1, 2, 3 in the Farmlands (strongbox, then the tithe chest while the strongbox
//    is not back yet, then the strongbox again); 5 quiet minutes in the cave lower it by a level
for (const seed of [1, 2, 3]) {
  const cs = drake(seed), levels = [], kinds = [];
  let bad = [];
  for (let i = 0; i < 3; i++) {
    const w = watcher();
    const r = R.raid(cs, { seed: seed * 10 + i, profile: 'careful', check: w.check });
    bad = bad.concat(w.bad);
    levels.push(Math.floor(w.peak.farm || 0));
    kinds.push(r.stats.taken);
    S.lairRest(cs);                                            // heal at the nest between raids (hunger is not refilled)
  }
  ok(bad.length === 0, 'seed ' + seed + ' invariants over 3 raids: ' + bad.join('; '));
  ok(levels[0] === 1 && levels[1] >= 2 && levels[2] === 3, 'seed ' + seed + ' alert per raid 1, 2, 3: ' + levels.join(', ') + ' (' + kinds.join(', ') + ')');
  ok(kinds.every(k => k), 'seed ' + seed + ' every raid took loot');
  ok(cs.hoard.gold > 0, 'seed ' + seed + ' gold banked over the raids: ' + cs.hoard.gold);
  // 5 quiet minutes: wait in the cave, then the Farmlands catch up on the decay they missed (as on the next visit)
  if (!cs.inLair) continue;
  const rs = cs.regionStates.farm, before = AL.level(rs);
  for (let t = 0; t < 300; t += 1) S.step(cs, {}, 1);
  AL.catchUp(rs, cs.stats.played, {});
  ok(before === 3 && AL.level(rs) === 2, 'seed ' + seed + ' 5 quiet min lower alert 3 to 2: ' + before + ' -> ' + AL.level(rs) + ' (heat ' + rs.heat.toFixed(2) + ')');
}

// 4. the quiet rule on its own: from the top of level 3, one level is gone within quiet + 1 / decay s, about 5 min
{
  const A = D.alert, perLevel = A.quiet + 1 / A.decay;
  ok(perLevel >= 240 && perLevel <= 360, 'quiet + one level of decay is about 5 min: ' + perLevel.toFixed(0) + ' s');
  const rs = { heat: 3.2, lastIncident: 0, at: 0 };
  AL.catchUp(rs, 300, {});
  ok(AL.level(rs) === 2, 'a raid\'s 3.2 heat is level 2 after 5 quiet min: ' + rs.heat.toFixed(2));
}
