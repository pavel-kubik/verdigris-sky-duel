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

// ---- in the game (state.step): incidents, responses, the village platform, catch-up, save ----
const S = core('state'), F = core('flight'), SE = core('settlement'), DF = core('defenders'), SV = core('save');
const { mulberry } = core('math');
function farm(seed) {
  const cs = S.create({ regionId: 'farm', rng: mulberry(seed || 5) });
  cs.dragon.stage = 1; cs.dragon.hp = 9999;
  cs.dragon.pilot = F.newPilot([0, 250, -900], 0, 30);
  S.step(cs, {}, 0.016);
  return cs;
}
const still = (cs, n, dt) => { const ev = []; for (let i = 0; i < n; i++) { const p = cs.dragon.pilot; p.pos = [0, 250, -900]; p.vel = [0, 0, 0]; p.speed = 0; ev.push(...S.step(cs, {}, dt)); } return ev; };

// 6. a burned building raises the heat (state wiring): set a house to burn down
{
  const cs = farm(3);
  const h = cs.town.buildings.find(b => b.type === 'house' && b.place === 'farm.village');
  h.fire = 1; h.hp = 0.01;
  const ev = still(cs, 3, 0.05);
  ok(ev.some(e => e.e === 'building:ruined'), 'the house burned down');
  near(cs.regionStates.farm.heat, A.add.civilBurned, 0.01, 'a burned house adds civilBurned to the Farmlands');
  const t = cs.town.buildings.find(b => b.type === 'tower');
  t.fire = 1; t.hp = 0.01;
  const ev2 = still(cs, 3, 0.05);
  ok(ev2.some(e => e.e === 'alert:level' && e.level === 1 && e.region === 'farm'), 'alert:level 1 with the region');
  ok(cs.regionStates.farm.heat >= A.add.civilBurned + A.add.orderBurned, 'tower = orderBurned (+ its archers killed)');
  ok(AL.towerDown(cs.town), 'a ruined tower speeds the decay');
}

// 7. responses: extra archers at 1, patrols at 2, the village platform with a ballista at 3
{
  const cs = farm(4);
  const count = (pl, kind) => cs.squad.list.filter(d => d.place === pl && d.kind === kind && !d.patrol).length;
  const base = count('farm.village', 'archer');
  ok(base === D.settlements.village.archers, 'village archers at level 0: ' + base);
  ok(!cs.town.buildings.some(b => b.id === 'farm.village.platform1'), 'no village platform at level 0');
  cs.regionStates.farm = { heat: 1.2, lastIncident: cs.stats.played, at: cs.stats.played };
  let ev = still(cs, 1, 0.05);
  ok(count('farm.village', 'archer') === base + 1, 'level 1: one more archer on the village tower');
  ok(count('farm.outpost', 'archer') === D.settlements.outpost.archers + 1, 'and on the outpost');
  ok(count('farm.hamlet', 'archer') === 0, 'a hamlet has no tower: no archers');
  ok(ev.some(e => e.e === 'defenders:reinforced' && e.level === 1), 'defenders:reinforced');
  cs.regionStates.farm.heat = 2.2;
  still(cs, 1, 0.05);
  const pat = cs.squad.list.filter(d => d.patrol);
  ok(pat.length === 2 * A.responses[2].patrols, 'level 2: ' + pat.length + ' patrol archers');
  const p0 = pat[0].pos.slice();
  still(cs, 40, 0.1);
  const moved = Math.hypot(pat[0].pos[0] - p0[0], pat[0].pos[2] - p0[2]);
  ok(moved > A.patrol.speed * 2 && moved < A.patrol.speed * 4.5, 'an idle patrol walks the road: ' + moved.toFixed(1));
  const route = DF.routeOf(cs.town);
  ok(route && route.total > 1000, 'the Farmlands road is the patrol route');
  cs.regionStates.farm.heat = 3.1;
  still(cs, 2, 0.05);                          // frame 1: the town gets the platform, frame 2: the squad mans it
  ok(cs.town.alert3 && cs.town.buildings.some(b => b.id === 'farm.village.platform1'), 'level 3 builds the village platform');
  const vb = cs.squad.list.find(d => d.kind === 'ballista' && d.place === 'farm.village');
  ok(vb && vb.alive, 'a crewed ballista on it');
  ok(count('farm.village', 'archer') === base + 2, 'level 3: two extra archers');
  ok(SE.solidAt(cs.town, ...[vb.pos[0], vb.pos[2]]) != null, 'the platform is a solid');
  cs.regionStates.farm.heat = 1.5;
  still(cs, 2, 0.05);
  ok(!cs.town.alert3 && !cs.squad.list.some(d => d.kind === 'ballista' && d.place === 'farm.village'), 'below level 3 the platform goes');
  ok(!cs.squad.list.some(d => d.patrol), 'below level 2 the patrols go home');
}

// 8. sighted once per settlement and alarm, bell rings add
{
  const cs = farm(6);
  const v = cs.town.places.find(p => p.id === 'farm.village');
  let ev = [];
  for (let i = 0; i < 200; i++) { const p = cs.dragon.pilot; p.pos = [v.x, v.y + 40, v.z + 60]; p.vel = [0, 0, 0]; p.speed = 0; p.mode = 'air'; ev.push(...S.step(cs, {}, 0.05)); }
  const alerts = ev.filter(e => e.e === 'aware:state' && e.state === 'alert').length;
  ok(alerts >= 2, 'several defenders went alert: ' + alerts);
  const h = cs.regionStates.farm.heat, bells = ev.filter(e => e.e === 'bell:ring').length, kills = ev.filter(e => e.e === 'defender:killed').length;
  near(h, A.add.sighted + bells * A.add.bell + kills * A.add.defenderKilled, 1e-6, 'one sighting for the village + ' + bells + ' bell(s)');
}

// 9. catch-up on region load: heat left in the Farmlands decays while the dragon is in the Wildwood
{
  const cs = farm(7);
  cs.regionStates.farm = { heat: 2.5, lastIncident: cs.stats.played, at: cs.stats.played };
  still(cs, 1, 0.05);
  const RG = core('region');
  RG.enter(cs, 'wild', 'farm');
  S.step(cs, {}, 0.05);
  const left = cs.regionStates.farm.heat;
  cs.stats.played += 600;                      // 10 min elsewhere
  RG.enter(cs, 'farm', 'wild');
  S.step(cs, {}, 0.05);
  near(cs.regionStates.farm.heat, left - (600 - A.quiet) * A.decay, 0.01, 'the Farmlands cooled down while away');
}

// 10. save round trip keeps heat and its stamps
{
  const cs = farm(8);
  cs.regionStates.farm = { heat: 2.345, lastIncident: 10, at: cs.stats.played };
  const data = SV.migrate(JSON.parse(JSON.stringify(SV.serialise(cs))));
  ok(data.regions.farm.heat === 2.345 && data.regions.farm.lastIncident === 10, 'saved heat and lastIncident');
  const other = S.create({ regionId: 'ash', rng: mulberry(1) });
  SV.apply(other, data);
  near(other.regionStates.farm.heat, 2.345, 1e-9, 'loaded heat');
  ok(other.regionStates.farm.at === data.regions.farm.at, 'loaded stamp');
}
