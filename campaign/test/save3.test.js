// Save v3 (Phase 3 T18, 003_task_missions.md 5.9): the running mission (with the relic or the caravan chest in the
// claws, and the caravan where it was), relics, found aeries, freed villages, explored map cells (base64 bitset), the
// castle gate and charred stone, the story act and seen cards survive a reload, also of a dragon saved in the Bend;
// a v2 save migrates (aerie moved, explored cells seeded around discovered places, act from the stage); corrupt v3
// saves are reported like v2 ones; a fully explored world stays under 32 KB.
'use strict';
const { ok, near, core } = require('./harness.js');
const S = core('state'), SV = core('save'), D = core('data'), T = core('terrain'), F = core('flight'), MS = core('missions'),
  RL = core('relics'), LT = core('loot'), MP = core('map'), CA = core('caravan'), CS = core('castle'), AE = core('aerie');
const { mulberry } = core('math');
const dt = 1 / 30;

function mem() {
  const m = {};
  return { m, getItem: k => (k in m ? m[k] : null), setItem: (k, v) => { m[k] = String(v); }, removeItem: k => { delete m[k]; } };
}
const roundTrip = (cs, seed) => {
  const st = mem(); ok(SV.store(st, cs), 'stored');
  const r = SV.load(st); ok(r.status === 'ok', 'loads ok');
  return { back: SV.deserialise(r.data, mulberry(seed || 7)), raw: JSON.parse(st.m[D.saveKey]), text: st.m[D.saveKey] };
};
function make(at) {
  const cs = S.create({ regionId: 'bend', rng: mulberry(21) });
  Object.assign(cs.dragon, { stage: 1, foodXp: D.stages[1].foodFrom, hp: D.stages[1].hp });
  const [x, z] = at || [-900, 300];
  cs.dragon.pilot = F.newPilot([x, T.surfaceAt('bend', x, z) + 200, z], 0.7, 20);
  S.ensureTown(cs);
  RL.sync(cs);
  return cs;
}

// 1. A Drake in the Bend carrying the Ember Chalice on a running steal mission, with every v3 block filled
{
  const cs = make();
  MS.accept(cs, 'a2_chalice'); MS.step(cs, dt, []);
  ok(cs.mission.state === 'running', 'the steal mission runs in the Bend');
  cs.mission.left = 222.4;
  RL.sync(cs);
  LT.take(cs, cs.town.items.find(it => it.kind === 'relic'), cs.stats.played);
  for (const e of MS.step(cs, dt, [{ e: 'loot:taken', kind: 'relic', relic: 'ember_chalice' }])) void e;
  const stateBefore = cs.mission.state;
  cs.hoard.relics = [];
  cs.discovered['bend.aerie'] = true; cs.discovered['bend.castle'] = true; cs.discovered['farm.aerie'] = true;
  cs.regionStates.farm = { freed: ['farm.village'] };
  cs.regionStates.bend = { ruins: [{ id: 'bend.castle.tower2', at: 10, char: true }] };
  MP.reveal(cs, 'bend', 0, 0, 400); MP.reveal(cs, 'wild', 100, -50, 200);
  const exBend = cs.explored.bend.slice(), exWild = cs.explored.wild.slice();
  CS.closeGate(cs.town);
  cs.story.seen = ['act1', 'act2', 'brief.a2_chalice'];
  const { back, raw } = roundTrip(cs, 9);

  ok(raw.version === 3 && D.version === 3, 'saved as v3');
  ok(raw.missions.active && raw.missions.active.id === 'a2_chalice' && raw.missions.active.state === stateBefore, 'missions.active in the save');
  near(raw.missions.active.left, 222.4 - (stateBefore === 'running' ? dt : 0), 0.15, 'time left saved');
  ok(raw.dragon.loot && raw.dragon.loot.relic === 'ember_chalice' && raw.dragon.loot.mission === 'a2_chalice', 'the chalice in the claws is saved with its mission');
  ok(raw.regions.bend.aerieFound === true && raw.regions.farm.aerieFound === true && raw.regions.bend.discovered.indexOf('bend.aerie') < 0, 'aerieFound, not in discovered');
  ok(typeof raw.regions.bend.explored === 'string' && /^[A-Za-z0-9+/=]+$/.test(raw.regions.bend.explored), 'explored is a base64 string');
  ok(!raw.regions.ash || !raw.regions.ash.explored, 'unexplored regions have no bitset');
  ok(raw.regions.bend.gate === 'closed', 'castle gate saved');
  ok(raw.regions.farm.freed[0] === 'farm.village', 'freed village saved');
  ok(raw.story.act === 2 && raw.story.seen.join() === 'act1,act2,brief.a2_chalice', 'story act and seen saved');

  ok(back.region === 'bend' && back.dragon.pilot && Math.abs(back.dragon.pilot.pos[0] + 900) < 1, 'the dragon comes back in the Bend where it was');
  ok(back.mission && back.mission.id === 'a2_chalice' && back.mission.state === stateBefore, 'the running mission is restored');
  near(back.mission.left, raw.missions.active.left, 1e-6, 'with its time left');
  ok(RL.carrying(back) === 'ember_chalice', 'the chalice is back in the claws');
  ok(AE.found(back, 'bend') && AE.found(back, 'farm') && !AE.found(back, 'wild'), 'found aeries restored');
  ok(back.explored.bend.join() === exBend.join() && back.explored.wild.join() === exWild.join(), 'explored bitsets restored exactly');
  ok(MP.explored(back, 'bend', 0, 0) && !MP.explored(back, 'bend', 900, 900), 'explored cells answer the map');
  ok(back.regionStates.farm.freed[0] === 'farm.village', 'freed village restored');
  ok(back.regionStates.bend.ruins[0].char === true, 'charred castle stone restored');
  const town = S.ensureTown(back);
  ok(town.gateClosed === true && !CS.gateOpen(town), 'the castle gate is closed again after the reload');
  ok(!back.regionStates.bend.gate, 'the saved gate is used once (the town keeps it from then on)');
  ok(back.story.act === 2 && back.story.seen.length === 3, 'story restored');
  // the gate opens again once the (fresh, calm) garrison runs its step
  const sq = core('defenders').spawn(town, mulberry(5), {});
  for (let i = 0; i < 400; i++) CS.step(sq, { pos: [5000, 0, 5000], pad: 1, inside: false }, 1 / 10);
  ok(!town.gateClosed && (town.gateK || 0) === 0, 'a calm garrison opens the restored gate');
  // the timer keeps running and the mission can still succeed: bank in the Bend aerie
  const ev = MS.step(back, 1, []);
  ok(back.mission.left < raw.missions.active.left || back.mission.state === 'done', 'the timer runs on after the reload');
  void ev;
}

// 2. An accepted (not yet started) mission and a completed one; a mission that is completed is never restored as active
{
  const cs = make();
  cs.missions.completed = ['a2_workshop'];
  MS.accept(cs, 'a2_chalice');
  const { back, raw } = roundTrip(cs);
  ok(raw.missions.active.state === 'accepted' && back.mission.state === 'accepted', 'accepted mission restored');
  ok(back.missions.completed.join() === 'a2_workshop', 'completed list restored');
  const forged = JSON.parse(JSON.stringify(raw)); forged.missions.active.id = 'a2_workshop';
  const c2 = make(); SV.apply(c2, SV.migrate(forged));
  ok(!c2.mission, 'a completed mission is not restored as active');
  const f2 = JSON.parse(JSON.stringify(raw)); f2.missions.active.id = 'no_such';
  const c3 = make(); SV.apply(c3, SV.migrate(f2));
  ok(!c3.mission, 'an unknown mission id is dropped');
  const f3 = JSON.parse(JSON.stringify(raw)); f3.missions.active.left = 99999;
  const c4 = make(); SV.apply(c4, SV.migrate(f3));
  ok(c4.mission.left === D.missions.find(m => m.id === 'a2_chalice').time, 'time left is clamped to the mission time');
  const none = make();
  ok(SV.serialise(none).missions.active === null, 'no mission -> active null');
}

// 3. Intercept: the caravan goes on where it was; a stopped caravan has its chest on the road, a taken chest is in the claws
{
  const cs = make();
  MS.accept(cs, 'a2_caravan'); MS.step(cs, dt, []);
  CA.step(cs, dt);
  const cv = cs.caravans.tithe;
  ok(cv, 'caravan spawned');
  cv.s += 300; cv.hp = cv.hpMax * 0.4; cv.state = 'moving';
  const { back, raw } = roundTrip(cs);
  ok(raw.missions.active.caravan && near(raw.missions.active.caravan.s, cv.s, 0.1, 'caravan progress saved') !== false, 'caravan block saved');
  ok(!back.caravans.tithe, 'the caravan is not there before its step');
  CA.step(back, dt);
  const cb = back.caravans.tithe;
  ok(cb && Math.abs(cb.s - cv.s) < 0.2 && Math.abs(cb.hp - cv.hp) < 0.02, 'the caravan goes on from the saved spot with its hp');

  // stopped, chest taken into the claws (mission done)
  cv.hp = 0; cv.state = 'stopped';
  const ch = { id: 'caravan.tithe.chest', kind: D.caravan.tithe.chest, mission: 'a2_caravan', caravan: 'tithe', gold: D.loot[D.caravan.tithe.chest].gold, size: D.loot[D.caravan.tithe.chest].size, taken: false };
  cv.chest = ch;
  LT.take(cs, ch, cs.stats.played);
  for (const e of MS.step(cs, dt, [{ e: 'loot:taken', kind: ch.kind, id: ch.id, mission: 'a2_caravan' }])) void e;
  const r2 = roundTrip(cs);
  ok(r2.raw.dragon.loot && r2.raw.dragon.loot.mission === 'a2_caravan', 'the chest in the claws is saved with the mission');
  ok(r2.back.carriedLoot && r2.back.carriedLoot.id === 'caravan.tithe.chest' && r2.back.carriedLoot.gold > 0, 'the chest is back in the claws');
  CA.step(r2.back, dt);
  const c2 = r2.back.caravans.tithe;
  ok(c2 && c2.state === 'stopped' && c2.chest && c2.chest.taken, 'the stopped wagon is back with its chest taken');

  // stopped, chest still on the road
  const c3s = make();
  MS.accept(c3s, 'a2_caravan'); MS.step(c3s, dt, []); CA.step(c3s, dt);
  Object.assign(c3s.caravans.tithe, { s: c3s.caravans.tithe.s + 500, hp: 0, state: 'stopped' });
  const r3 = roundTrip(c3s);
  CA.step(r3.back, dt);
  const c3 = r3.back.caravans.tithe;
  ok(c3.state === 'stopped' && c3.chest && !c3.chest.taken && c3.chest.pos.every(Number.isFinite), 'a stopped wagon drops its chest on the road again');
}

// 4. A v2 save migrates: aerie out of discovered, cells explored around discovered places, act from the stage
{
  const cs = make();
  cs.discovered = { 'bend.castle': true, 'farm.village': true, 'farm.aerie': true };
  cs.regionStates.farm = { freed: ['farm.village'] };
  const v3 = SV.serialise(cs);
  const v2 = JSON.parse(JSON.stringify(v3));
  v2.version = 2;
  v2.regions.farm.discovered = ['farm.aerie', 'farm.village'];
  delete v2.regions.farm.aerieFound;
  for (const id of Object.keys(v2.regions)) { delete v2.regions[id].explored; delete v2.regions[id].gate; }
  v2.missions = { completed: ['a2_workshop'], active: null, failedAt: { a2_chalice: 1 } };
  v2.story = { act: 1, mother: null, seen: ['act1'], raid: null };
  const st = mem(); st.setItem(D.saveKey, JSON.stringify(v2));
  const r = SV.load(st);
  ok(r.status === 'ok' && r.data.version === 3, 'v2 loads as v3');
  ok(r.data.regions.farm.aerieFound === true && r.data.regions.farm.discovered.join() === 'farm.village', 'the found aerie moves to aerieFound');
  ok(r.data.story.act === 2, 'story.act from the stage (a Drake is in Act 2)');
  ok(r.data.missions.active === null && r.data.missions.completed[0] === 'a2_workshop', 'missions kept, none active');
  const back = SV.deserialise(r.data, mulberry(3));
  ok(AE.found(back, 'farm'), 'the aerie is still found');
  const vil = MP.model(back, 'farm').places.find(p => p.id === 'farm.village');
  ok(vil && MP.explored(back, 'farm', vil.x, vil.z), 'cells around a discovered village are explored');
  const castle = MP.model(back, 'bend').places.find(p => p.kind === 'castle');
  ok(castle && MP.explored(back, 'bend', castle.x, castle.z), 'cells around the discovered castle are explored');
  ok(MP.fraction(back, 'farm') < 0.5, 'but not the whole region');
  ok(back.missions.failedAt.a2_chalice === 1 && back.regionStates.farm.freed[0] === 'farm.village', 'retry rule and freed village survive');
  // a hatchling's v2 save stays in Act 1
  const h = JSON.parse(JSON.stringify(v2)); h.dragon.stage = 0;
  ok(SV.migrate(h).story.act === 1, 'a hatchling migrates in Act 1');
  // v2 with a relic in the claws: dropped (v2 never saved its mission)
  const rl = JSON.parse(JSON.stringify(v2)); rl.dragon.loot = { id: 'bend.castle.chapel1.relic', kind: 'relic', region: 'bend' };
  const c5 = make(); SV.apply(c5, SV.migrate(rl));
  ok(!c5.carriedLoot, 'a relic in a v2 save is not restored');
}

// 5. Corrupt v3 saves are reported like v2 ones
{
  const good = SV.serialise(make());
  const bad = [
    ['missions missing', o => { delete o.missions; }],
    ['missions.active not an object', o => { o.missions.active = 'x'; }],
    ['missions.active.left NaN', o => { o.missions.active = { id: 'a2_chalice', state: 'running', left: 'x' }; }],
    ['story missing', o => { delete o.story; }],
    ['explored not a string', o => { o.regions.bend.explored = [1, 2]; }],
    ['dragon missing', o => { delete o.dragon; }],
    ['world.mode bad', o => { o.world.mode = 'swim'; }],
  ];
  for (const [what, f] of bad) {
    const o = JSON.parse(JSON.stringify(good)); f(o);
    const st = mem(); st.setItem(D.saveKey, JSON.stringify(o));
    const r = SV.load(st);
    ok(r.status === 'corrupt' && typeof r.raw === 'string', 'corrupt v3 (' + what + ') reported as corrupt');
  }
  // a broken bitset is not fatal: that region starts unexplored
  const o = JSON.parse(JSON.stringify(good)); o.regions.bend.explored = 'AAAA';
  const st = mem(); st.setItem(D.saveKey, JSON.stringify(o));
  const r = SV.load(st);
  ok(r.status === 'ok', 'a bitset of the wrong length still loads');
  const back = SV.deserialise(r.data, mulberry(4));
  ok(!back.explored.bend || back.explored.bend.every(w => w === 0), 'and that region starts unexplored');
}

// 6. Every region fully explored, every place found: the save stays under 32 KB; the bitset round-trips all ones
{
  const cs = make();
  for (const id of Object.keys(D.regions)) {
    let b;
    try { b = MP.bits(cs, id); } catch (_) { continue; }
    for (let i = 0; i < b.length; i++) b[i] = 0xffffffff;
    cs.discovered[id + '.aerie'] = true;
  }
  const { back, text } = roundTrip(cs);
  ok(text.length < 32 * 1024, 'save under 32 KB with every region explored (' + text.length + ' bytes)');
  for (const id of Object.keys(cs.explored)) ok(back.explored[id] && back.explored[id].every(w => w === 0xffffffff), 'all ones restored in ' + id);
}
