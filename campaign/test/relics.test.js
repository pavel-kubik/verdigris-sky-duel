// Relics and the trophy wall (Phase 3 T12): the Ember Chalice lies at the chapel door only while its mission is on,
// carry rules (speed x0.8, no breath), objective event, lost on death or timeout (back at the door), banked into
// hoard.relics in the lair or an aerie, the trophy wall shows it, the cave station and the save keep it.
'use strict';
const { ok, near, core } = require('./harness.js');
const S = core('state'), D = core('data'), T = core('terrain'), F = core('flight'), LT = core('loot'), RL = core('relics'), MS = core('missions'),
  LR = core('lair'), CV = core('cave'), CT = core('controls'), SV = core('save'), HN = core('hunger'), WK = core('walk');
const { mulberry } = core('math');
const dt = 1 / 30;
const ofType = (ev, name) => ev.filter(e => e.e === name);

function make(stage) {
  const cs = S.create({ regionId: 'bend', rng: mulberry(11) });
  cs.story.act = 2;
  const st = stage == null ? 1 : stage;
  Object.assign(cs.dragon, { stage: st, foodXp: D.stages[st].foodFrom, hp: D.stages[st].hp });
  cs.dragon.pilot = F.newPilot([0, T.surfaceAt('bend', 0, 0) + 150, 0], 0, 20);
  S.ensureTown(cs);
  RL.sync(cs);
  return cs;
}
const relicItem = cs => cs.town.items.find(it => it.kind === 'relic');

// 1. data: loot kind, catalogue, trophy station
{
  const K = D.loot.relic;
  ok(K && K.mission === true && K.gold === 0, 'relic loot kind: mission loot, no gold');
  near(K.carry.speedMult, 0.8, 1e-9, 'relic slows to x0.8');
  ok(K.carry.breath === false, 'no breath with a relic');
  ok(D.relics.ember_chalice && D.relics.ember_chalice.niche < D.trophy.niches, 'Ember Chalice has a niche on the wall');
  ok(RL.missionOf('ember_chalice').id === 'a2_chalice', 'the chalice is the prize of a2_chalice');
  const st = D.cave.stations.trophy;
  ok(st && CV.walkable(st[0], st[1], 1), 'trophy station on the cave floor');
  for (const id in D.cave.stations) if (id !== 'trophy') {
    const o = D.cave.stations[id];
    ok(Math.hypot(o[0] - st[0], o[1] - st[1]) > o[2] + st[2], 'trophy wall clear of ' + id);
  }
}

// 2. the chalice at the chapel door: hidden without its mission, there while it is on
{
  const cs = make();
  const it = relicItem(cs);
  ok(it && it.building === 'bend.castle.chapel1' && it.relic === 'ember_chalice', 'one relic item at the chapel');
  ok(cs.town.items.filter(q => q.kind === 'relic').length === 1, 'only one relic in the Bend');
  ok(it.hidden && LT.available(cs.town.items).indexOf(it) < 0, 'no mission: not there');
  const pl = cs.town.places.find(p => p.id === 'bend.castle');
  ok(Math.hypot(it.pos[0] - pl.x, it.pos[2] - pl.z) < 60, 'lies inside the castle');
  MS.accept(cs, 'a2_workshop');
  RL.sync(cs);
  ok(it.hidden, 'another mission: still not there');
  MS.cancel(cs);
  MS.accept(cs, 'a2_chalice');
  RL.sync(cs);
  ok(!it.hidden && LT.available(cs.town.items).indexOf(it) >= 0, 'its mission accepted: at the door');
  ok(!RL.wanted(make(), 'ember_chalice'), 'wanted only with the mission on');
}

// 3. take it: carry rules and the steal objective
{
  const cs = make();
  MS.accept(cs, 'a2_chalice');
  MS.step(cs, 1, []);
  ok(cs.mission.state === 'running', 'running in the Bend');
  RL.sync(cs);
  const ev = LT.take(cs, relicItem(cs), cs.stats.played);
  ok(ev[0].e === 'loot:taken' && ev[0].relic === 'ember_chalice' && ev[0].kind === 'relic', 'loot:taken names the relic');
  ok(RL.carrying(cs) === 'ember_chalice' && cs.carriedLoot.mission === 'a2_chalice', 'in the claws');
  ok(!(cs.regionStates.bend && (cs.regionStates.bend.lootTaken || []).some(r => r.id === relicItem(cs).id)), 'mission loot is not kept in lootTaken');
  const eff = LT.effects(HN.effects(50), cs.carriedLoot);
  near(eff.speedMult, HN.effects(50).speedMult * 0.8, 1e-9, 'speed x0.8 while carrying');
  ok(eff.canBreath === false && LT.blocksBreath(cs.carriedLoot), 'no breath while carrying');
  near(RL.carry(cs).speedMult, 0.8, 1e-9, 'relics.carry gives the rule');
  ok(ofType(MS.step(cs, 1, ev), 'mission:done').length === 1, 'taking the chalice meets the steal objective');
  RL.sync(cs);
  ok(relicItem(cs).hidden, 'the carried relic is not also at the door');
  S.refreshTown(cs); RL.sync(cs);
  ok(relicItem(cs).hidden, 'still hidden after a town rebuild');
  cs.town = null; S.ensureTown(cs); RL.sync(cs);
  ok(relicItem(cs).hidden && !LT.available(cs.town.items).some(q => q.kind === 'relic'), 'still hidden after a region reload');
}

// 4. full game step: walk up, Grab, and the speed / breath rules in state.step
{
  const cs = make();
  S.step(cs, {}, dt);
  MS.accept(cs, 'a2_chalice');
  S.step(cs, {}, dt);
  for (const d of (cs.squad && cs.squad.list) || []) d.alive = false;
  cs.dragon.hp = 1e6;
  const it = relicItem(cs), b = cs.town.buildings.find(q => q.id === it.building), sc = S.scaleOf(cs);
  let dx = it.pos[0] - b.pos[0], dz = it.pos[2] - b.pos[2];
  const l = Math.hypot(dx, dz); dx /= l; dz /= l;
  const f = 1.5 + D.settlement.pad * sc, x = it.pos[0] + dx * f, z = it.pos[2] + dz * f;
  Object.assign(cs.dragon.pilot, { pos: [x, T.surfaceAt('bend', x, z) + D.walk.stand * sc, z], vel: [0, 0, 0], yaw: Math.atan2(-dx, -dz), pitch: 0, roll: 0, rollX: 0,
    speed: 0, mode: 'ground', tr: null, boosting: false, breathing: false });
  const ev = [];
  for (let i = 0; i < 10; i++) ev.push(...S.step(cs, { sx: 0, sy: 0, grab: true }, dt));
  ok(RL.carrying(cs) === 'ember_chalice', 'Grab on the ground picks up the chalice');
  ok(ofType(ev, 'mission:done').length === 1, 'state.step: objective met');
  for (let i = 0; i < 10; i++) S.step(cs, { sx: 0, sy: 0, breath: true }, dt);
  ok(!cs.dragon.pilot.breathing, 'no fire while holding the relic');
}

// 5. lost on death: back at the door, the mission fails, so it is hidden again; retry shows it again
{
  const cs = make();
  MS.accept(cs, 'a2_chalice'); MS.step(cs, 1, []); RL.sync(cs);
  const it = relicItem(cs);
  const tk = LT.take(cs, it, cs.stats.played); MS.step(cs, 1, tk);
  const ev = LR.respawn(cs, 'wounds');
  ok(ofType(ev, 'loot:lost')[0].relic === 'ember_chalice' && !cs.carriedLoot, 'death loses the relic');
  ok(ofType(MS.step(cs, 1, ev), 'mission:failed')[0].why === 'death', 'the mission fails on death');
  ok(!RL.has(cs, 'ember_chalice'), 'not in the hoard');
  cs.region = 'bend'; cs.inLair = false; cs.town = null; S.ensureTown(cs); RL.sync(cs);
  ok(relicItem(cs).hidden, 'no mission: not at the door');
  cs.flags.rested = (cs.flags.rested || 0) + 1;
  MS.accept(cs, 'a2_chalice'); RL.sync(cs);
  const it2 = relicItem(cs);
  ok(!it2.hidden && !it2.taken && it2.pos.join() === it2.home.join(), 'retry: back at the chapel door');
}

// 6. the same town object: refill puts a lost relic back at the door at once
{
  const cs = make();
  MS.accept(cs, 'a2_chalice'); MS.step(cs, 1, []); RL.sync(cs);
  const it = relicItem(cs);
  LT.take(cs, it, cs.stats.played);
  LT.lose(cs);
  ok(it.taken, 'lost: still marked taken');
  const back = LT.refill(cs.town, cs.regionStates.bend, cs.stats.played + 1, null);
  ok(back.some(e => e.e === 'loot:back' && e.kind === 'relic') && !it.taken, 'refill: back at the door right away');
  LT.take(cs, it, cs.stats.played);
  ok(LT.refill(cs.town, cs.regionStates.bend, cs.stats.played + 1e6, it.id).length === 0, 'never back while in the claws');
}

// 7. lost on timeout: vanishes, back at the door; carried loot of another kind is not touched by the relic rules
{
  const cs = make();
  MS.accept(cs, 'a2_chalice'); MS.step(cs, 1, []); RL.sync(cs);
  MS.step(cs, 1, LT.take(cs, relicItem(cs), cs.stats.played));
  cs.mission.left = 0.5;
  const ev = MS.step(cs, 1, []);
  ok(ofType(ev, 'loot:vanished')[0].kind === 'relic' && !cs.carriedLoot, 'timeout: the relic vanishes');
  ok(ofType(ev, 'mission:failed')[0].why === 'timeout', 'mission failed (timeout)');
  LT.refill(cs.town, cs.regionStates.bend, cs.stats.played, null);
  ok(!relicItem(cs).taken, 'back at the door for the retry');
}

// 8. banked in the lair: hoard.relics, mission success, trophy wall; the chalice never lies at the door again
{
  const cs = make();
  MS.accept(cs, 'a2_chalice'); MS.step(cs, 1, []); RL.sync(cs);
  MS.step(cs, 1, LT.take(cs, relicItem(cs), cs.stats.played));
  const g0 = cs.hoard.gold;
  const ev = LR.enter(cs);
  const rb = ofType(ev, 'relic:banked')[0];
  ok(rb && rb.relic === 'ember_chalice', 'entering the lair banks the relic');
  ok(!ofType(ev, 'hoard:banked').length && cs.hoard.gold === g0, 'no gold for the relic itself');
  ok(RL.has(cs, 'ember_chalice') && !cs.carriedLoot, 'in hoard.relics');
  const s = ofType(MS.step(cs, 1, ev), 'mission:success')[0];
  ok(s && s.gold >= 250 && cs.hoard.gold === g0 + s.gold, 'mission success pays the reward');
  ok(cs.hoard.relics.filter(r => r === 'ember_chalice').length === 1, 'the relic is in the hoard once');
  const w = RL.wall(cs);
  ok(w.length === D.trophy.niches, 'one wall entry per niche');
  ok(w.find(n => n.id === 'ember_chalice').has && w.filter(n => n.has).length === 1, 'the trophy wall shows the banked chalice');
  ok(!RL.wall(make()).some(n => n.has), 'a new dragon: empty niches');
  cs.inLair = false; RL.sync(cs);
  ok(relicItem(cs).hidden, 'owned: not at the door any more');
  ok(!MS.list(cs).find(r => r.id === 'a2_chalice').ok, 'mission won');
}

// 9. banked at an aerie the same way (LT.bank)
{
  const cs = make();
  MS.accept(cs, 'a2_chalice'); MS.step(cs, 1, []); RL.sync(cs);
  MS.step(cs, 1, LT.take(cs, relicItem(cs), cs.stats.played));
  cs.inAerie = 'bend';
  const ev = LT.bank(cs);
  ok(ev[0].e === 'relic:banked' && RL.has(cs, 'ember_chalice'), 'aerie bank keeps the relic');
  ok(ofType(MS.step(cs, 1, ev), 'mission:success').length === 1, 'and wins the mission');
}

// 10. the cave station: in reach, Action slot, act does nothing
{
  const cs = make();
  LR.enter(cs);
  const st = D.cave.stations.trophy, p = cs.dragon.pilot;
  p.pos = [st[0] + 2, p.pos[1], st[1]];
  CV.step(cs, { sx: 0, sy: 0 }, dt);
  ok(cs.station === 'trophy', 'trophy wall in reach');
  ok(CT.slots(cs).action === 'trophy' && CT.isStation('trophy'), 'Action slot opens the trophy wall');
  ok(S.caveAct(cs, 'trophy').length === 0, 'the panel only shows');
}

// 11. save: banked relics survive, a relic in the claws goes back to its door (the mission is saved only in v3)
{
  const cs = make();
  cs.hoard.relics = ['ember_chalice', 'no_such_relic'];
  const o = SV.serialise(cs);
  ok(o.hoard.relics.join() === 'ember_chalice', 'saved: known relics');
  const back = make(); SV.apply(back, JSON.parse(JSON.stringify(o)));
  ok(RL.has(back, 'ember_chalice'), 'restored: the chalice in the hoard');
  const c2 = make();
  MS.accept(c2, 'a2_chalice'); MS.step(c2, 1, []); RL.sync(c2);
  LT.take(c2, relicItem(c2), c2.stats.played);
  const o2 = SV.serialise(c2);
  ok(o2.dragon.loot === null, 'a carried relic is not saved in the claws');
  const forged = JSON.parse(JSON.stringify(o2));
  forged.dragon.loot = { id: 'bend.castle.chapel1.relic', kind: 'relic', region: 'bend' };
  const c3 = make(); SV.apply(c3, forged);
  ok(!c3.carriedLoot, 'a relic in the claws of a save is dropped on load');
}

void WK;
