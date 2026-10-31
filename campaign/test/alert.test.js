// Alert (Phase 2 T17): incidents raise heat as in data, decay after `quiet`, faster with a ruined tower, catch-up on
// region load, cumulative responses.
'use strict';
const { ok, near, core } = require('./harness.js');
const AL = core('alert'), D = core('data');
const A = D.alert;

// 1. incidents add heat as in data.alert.add; level = floor(heat), clamped; 'alert:level' on change
{
  const rs = {};
  ok(AL.level(rs) === 0, 'a fresh region is at level 0');
  let ev = AL.add(rs, 'sighted', 10);
  near(rs.heat, A.add.sighted, 1e-9, 'sighted adds alert.add.sighted');
  ok(ev.length === 0, 'no level change below 1');
  ev = AL.add(rs, 'civilBurned', 11);
  near(rs.heat, A.add.sighted + A.add.civilBurned, 1e-9, 'a burned house adds civilBurned');
  ok(ev.length === 0, 'still level 0 at 0.95');
  ev = AL.add(rs, 'bell', 11);
  ok(ev.length === 1 && ev[0].e === 'alert:level' && ev[0].level === 1 && ev[0].from === 0 && ev[0].kind === 'bell', 'level 1 event');
  ok(rs.lastIncident === 11, 'lastIncident stamped');
  for (let i = 0; i < 10; i++) AL.add(rs, 'loot', 12);
  near(rs.heat, A.maxHeat, 1e-9, 'heat clamps to maxHeat');
  ok(AL.level(rs) === A.maxLevel, 'level clamps to maxLevel');
  ok(AL.add(rs, 'nonsense', 13).length === 0, 'unknown kinds add nothing');
}

// 2. decay only after `quiet` s, at alert.decay per s; about one level per 5 minutes
{
  const rs = { heat: 2.5 };
  AL.add(rs, 'bell', 0);                     // 3.0, level 3
  ok(AL.level(rs) === 3, 'bell to level 3');
  let t = 0;
  for (; t < A.quiet - 1; t += 1) AL.step(rs, 1, t + 1);
  near(rs.heat, 3.0, 1e-9, 'no decay inside the quiet time');
  let ev = [];
  for (; t < A.quiet + 10; t += 1) ev = ev.concat(AL.step(rs, 1, t + 1));
  ok(rs.heat < 3.0 && rs.heat > 2.9, 'decays after quiet');
  ok(ev.some(e => e.e === 'alert:level' && e.level === 2 && e.from === 3), 'drops to level 2 as soon as heat < 3');
  const perLevel = 1 / A.decay;
  ok(perLevel > 240 && perLevel < 330, 'about 5 min per level (' + perLevel.toFixed(0) + ' s)');
  const r2 = { heat: 1.5, lastIncident: 0, at: 100 };
  AL.step(r2, 10, 110);
  near(r2.heat, 1.5 - 10 * A.decay, 1e-9, '10 s of decay');
  AL.add(r2, 'sighted', 110);
  const h = r2.heat;
  AL.step(r2, 10, 120);
  near(r2.heat, h, 1e-9, 'a new incident restarts the quiet time');
}

// 3. faster with a ruined watchtower
{
  const a = { heat: 2, lastIncident: 0, at: 100 }, b = { heat: 2, lastIncident: 0, at: 100 };
  AL.step(a, 50, 150);
  AL.step(b, 50, 150, { towerDown: true });
  near(2 - b.heat, (2 - a.heat) * A.towerDownMult, 1e-9, 'towerDownMult x decay');
  ok(AL.towerDown({ ruins: [{ id: 'farm.village.tower1', at: 3 }] }), 'a ruined tower id counts');
  ok(!AL.towerDown({ ruins: [{ id: 'farm.village.house2', at: 3 }] }), 'a ruined house does not');
  ok(AL.towerDown({ buildings: [{ type: 'tower', ruin: true }] }) && !AL.towerDown({ buildings: [{ type: 'tower', ruin: false }] }), 'town form');
}

// 4. catch-up on region load: the same decay over the missed gap, quiet counted from the last incident
{
  const live = { heat: 3.2, lastIncident: 1000, at: 1000 }, off = { heat: 3.2, lastIncident: 1000, at: 1000 };
  for (let t = 1000; t < 1600; t += 0.5) AL.step(live, 0.5, t + 0.5);
  const ev = AL.catchUp(off, 1600);
  near(off.heat, live.heat, 1e-6, 'catch-up = stepping through the gap');
  near(off.heat, 3.2 - (600 - A.quiet) * A.decay, 1e-6, 'catch-up amount');
  ok(ev.length === 1 && ev[0].level === 1 && ev[0].from === 3, 'catch-up reports the level change once');
  const z = { heat: 0.4, lastIncident: 0, at: 0 };
  AL.catchUp(z, 1e6);
  ok(z.heat === 0, 'heat never goes below 0');
  const fresh = {};
  ok(AL.catchUp(fresh, 50).length === 0 && fresh.at === 50, 'a region without heat just takes the stamp');
}

// 5. responses are cumulative, higher levels override
{
  const r0 = AL.responses(0), r1 = AL.responses(1), r2 = AL.responses(2), r3 = AL.responses(3);
  ok(r0.extraArchers === 0 && r0.patrols === 0 && !r0.villageBallista && !r0.bellFast, 'level 0: nothing');
  ok(r1.extraArchers === 1 && r1.bellFast && r1.patrols === 0, 'level 1: an extra archer, faster bell');
  ok(r2.extraArchers === 1 && r2.patrols === 2 && r2.bellFast, 'level 2 keeps level 1 and adds patrols');
  ok(r3.extraArchers === 2 && r3.patrols === 2 && r3.villageBallista && r3.livestockInside, 'level 3: everything');
}
