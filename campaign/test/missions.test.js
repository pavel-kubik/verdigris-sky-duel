// Missions (Phase 3 T10): board list rules, accept, timer start / pause rules, objectives, success with the time bonus,
// timeout and death fail, mission loot lost only, region heat + 1 on fail, retry after a rest, save round trip.
'use strict';
const { ok, near, core } = require('./harness.js');
const MS = core('missions'), S = core('state'), D = core('data'), F = core('flight'), LR = core('lair'), AE = core('aerie'), SV = core('save');
const { mulberry } = core('math');

const IN = { sx: 0, sy: 0, breath: false, boost: false, grab: false, eat: false, confirm: false, enter: false, land: false };
function makeCs(regionId, stage) {
  const cs = S.create({ regionId: regionId || 'bend', rng: mulberry(7) });
  cs.dragon.stage = stage == null ? 1 : stage;
  cs.dragon.hp = 100;
  return cs;
}
const ofType = (ev, name) => ev.filter(e => e.e === name);

// 1. catalogue: three missions, act 2, region bend, data shape
{
  ok(D.missions.length === 3, 'three missions');
  ok(['steal', 'destroy', 'intercept'].every(t => D.missions.some(m => m.type === t)), 'steal, destroy, intercept');
  ok(D.missions.every(m => m.region === 'bend' && m.time > 0 && m.reward.gold > 0), 'region, time, reward');
  ok(MS.def('a2_chalice').relic === 'ember_chalice' && MS.def('nope') === null, 'def');
}

// 2. board list: stage lock, busy, done
{
  const cs = makeCs('ash', 0);
  ok(MS.list(cs).every(r => !r.ok && r.why === 'stage'), 'a hatchling sees every mission locked (stage)');
  ok(ofType(MS.accept(cs, 'a2_chalice'), 'mission:refused')[0].why === 'stage', 'accept refused: stage');
  ok(ofType(MS.accept(cs, 'a2_chalice', { force: true }), 'mission:accepted').length === 1, 'debug force accepts');
  cs.dragon.stage = 1;
  ok(MS.list(cs).every(r => r.why === 'busy'), 'one mission at a time');
  ok(ofType(MS.accept(cs, 'a2_workshop'), 'mission:refused')[0].why === 'busy', 'second accept refused: busy');
  ok(ofType(MS.cancel(cs), 'mission:cancelled').length === 1 && cs.mission === null, 'cancel before the timer runs');
  cs.missions.failedAt.a2_caravan = 0;
  ok(ofType(MS.accept(cs, 'a2_caravan', { force: true }), 'mission:refused')[0].why === 'retry', 'debug force skips only the stage lock');
  delete cs.missions.failedAt.a2_caravan;
  cs.missions.completed.push('a2_workshop');
  ok(MS.list(cs).find(r => r.id === 'a2_workshop').why === 'done', 'completed: done');
  ok(MS.list(cs).find(r => r.id === 'a2_chalice').ok, 'others open');
}

// 3. timer start: not inside the lair, not in the lair region; starts on leaving the lair region
{
  const cs = makeCs('ash');
  cs.inLair = true;
  MS.accept(cs, 'a2_workshop');
  MS.step(cs, 10, []);
  ok(cs.mission.state === 'accepted' && cs.mission.left === 420, 'inside the lair: not running');
  cs.inLair = false;
  MS.step(cs, 10, []);
  ok(cs.mission.state === 'accepted' && cs.mission.left === 420, 'outside but still in the lair region: not running');
  cs.region = 'wild';
  const ev = MS.step(cs, 1, []);
  ok(ofType(ev, 'mission:started').length === 1 && cs.mission.state === 'running', 'leaving the lair region starts it');
  near(cs.mission.left, 419, 1e-9, 'timer runs from the start frame');
  MS.step(cs, 5, [{ e: 'region:enter', region: 'farm' }]);
  near(cs.mission.left, 419, 1e-9, 'no time passes in a region swap frame (loading)');
  cs.loading = true; MS.step(cs, 5, []); cs.loading = false;
  near(cs.mission.left, 419, 1e-9, 'paused while loading');
  cs.inLair = true; MS.step(cs, 30, []); cs.inLair = false;
  near(cs.mission.left, 419, 1e-9, 'paused inside the lair');
  cs.inAerie = 'farm'; MS.step(cs, 30, []); cs.inAerie = null;
  near(cs.mission.left, 419, 1e-9, 'paused inside an aerie');
  MS.step(cs, 19, []);
  near(cs.mission.left, 400, 1e-9, 'runs again outside');
}

// 4. timer start from an aerie, even in the lair region's neighbourhood rules
{
  const cs = makeCs('bend');
  cs.inAerie = 'bend';
  MS.accept(cs, 'a2_workshop');
  MS.step(cs, 10, []);
  ok(cs.mission.state === 'accepted', 'inside the aerie: not running');
  cs.inAerie = null;
  ok(ofType(MS.step(cs, 1, []), 'mission:started').length === 1, 'leaving the aerie starts it');
}

// 5. timer HUD levels: ok, warn at 60 s, danger at 20 s
{
  const cs = makeCs('bend');
  MS.accept(cs, 'a2_workshop');
  MS.step(cs, 1, []);
  ok(MS.timerState(cs).level === 'ok' && MS.timerState(cs).running, 'timer ok');
  cs.mission.left = 60; ok(MS.timerState(cs).level === 'warn', 'amber at 60 s');
  cs.mission.left = 20; ok(MS.timerState(cs).level === 'danger', 'red at 20 s');
  cs.mission = null; ok(MS.timerState(cs) === null, 'no mission: no timer');
}

// 6. destroy objective + success with the time bonus in the lair
{
  const cs = makeCs('bend');
  MS.accept(cs, 'a2_workshop');
  MS.step(cs, 1, []);
  MS.step(cs, 1, [{ e: 'building:ruined', id: 'bend.castle.stables1' }]);
  ok(cs.mission.state === 'running', 'another building: no objective');
  ok(ofType(MS.step(cs, 1, [{ e: 'building:ruined', id: 'bend.castle.workshop1' }]), 'mission:done').length === 1, 'target ruined: done');
  cs.mission.left = 100;                                          // 20 steps of 5 s -> +20 %
  const gold0 = cs.hoard.gold;
  cs.inLair = true;
  const ev = MS.step(cs, 1, []), s = ofType(ev, 'mission:success')[0];
  ok(!!s, 'done + back in the lair: success');
  ok(s.base === 200 && s.gold === 240 && s.bonus === 40, 'bonus math: 200 x (1 + 0.01 x 20) = 240');
  ok(cs.hoard.gold === gold0 + 240, 'reward into the hoard');
  ok(cs.missions.completed.indexOf('a2_workshop') >= 0 && cs.mission === null, 'completed');
  near(MS.reward(MS.def('a2_workshop'), 4.9).gold, 200, 0, 'under 5 s left: no bonus');
  near(MS.reward(MS.def('a2_caravan'), 390).gold, 534, 0, '390 s left: 300 x 1.78');
}

// 7. steal objective: the relic taken, lost again -> running, banked at an aerie -> success with the relic on the hoard
{
  const cs = makeCs('bend');
  MS.accept(cs, 'a2_chalice');
  MS.step(cs, 1, []);
  MS.step(cs, 1, [{ e: 'loot:taken', kind: 'strongbox', id: 'x' }]);
  ok(cs.mission.state === 'running', 'a strongbox is not the relic');
  MS.step(cs, 1, [{ e: 'loot:taken', kind: 'relic', relic: 'ember_chalice', id: 'bend.castle.chapel1.relic' }]);
  ok(cs.mission.state === 'done', 'chalice taken: done');
  ok(ofType(MS.step(cs, 1, [{ e: 'loot:dropped', kind: 'relic' }]), 'mission:undone').length === 1 && cs.mission.state === 'running', 'dropped: running again');
  MS.step(cs, 1, [{ e: 'loot:taken', kind: 'ember_chalice' }]);
  cs.inAerie = 'bend';
  const s = ofType(MS.step(cs, 1, []), 'mission:success')[0];
  ok(!!s && cs.hoard.relics.indexOf('ember_chalice') >= 0, 'success at an aerie, relic on the hoard');
}

// 8. intercept objective: the chest counts only after the caravan stopped
{
  const cs = makeCs('bend');
  MS.accept(cs, 'a2_caravan');
  MS.step(cs, 1, []);
  MS.step(cs, 1, [{ e: 'loot:taken', mission: 'a2_caravan' }]);
  ok(cs.mission.state === 'running', 'chest before the stop: no objective');
  MS.step(cs, 1, [{ e: 'caravan:stopped', caravan: 'tithe' }, { e: 'loot:taken', mission: 'a2_caravan' }]);
  ok(cs.mission.state === 'done', 'stopped + chest taken: done');
}

// 9. timeout: fails, mission loot vanishes, other loot stays; heat + 1 in the mission region; retry after a rest
{
  const cs = makeCs('bend');
  MS.accept(cs, 'a2_chalice');
  MS.step(cs, 1, []);
  cs.carriedLoot = { id: 'bend.village.tax.chest', kind: 'chest', gold: 40, size: 1, region: 'bend' };
  const heat0 = (cs.regionStates.bend && cs.regionStates.bend.heat) || 0;
  let ev = MS.step(cs, 1000, []);
  const f = ofType(ev, 'mission:failed')[0];
  ok(!!f && f.why === 'timeout' && f.left === 0, 'timeout fails');
  ok(cs.carriedLoot && cs.carriedLoot.kind === 'chest', 'ordinary loot is kept on a fail');
  near(cs.regionStates.bend.heat, heat0 + D.mission.alertOnFail, 1e-9, 'region heat + alertOnFail');
  ok(ev.filter(e => e.e === 'alert:level').every(e => e.region === 'bend') && ev.some(e => e.e === 'alert:level'), 'alert:level names the region');
  ok(MS.list(cs).find(r => r.id === 'a2_chalice').why === 'retry', 'retry needs a rest');
  ok(ofType(MS.accept(cs, 'a2_chalice'), 'mission:refused')[0].why === 'retry', 'accept refused until a rest');
  ok(MS.list(cs).find(r => r.id === 'a2_workshop').ok, 'other missions stay open');
  cs.dragon.pilot = cs.dragon.pilot || F.newPilot([0, 50, 0], 0, 20);
  cs.inLair = true; LR.rest(cs);
  ok(MS.list(cs).find(r => r.id === 'a2_chalice').ok, 'after a rest it can be retried');

  const cs2 = makeCs('bend');
  MS.accept(cs2, 'a2_chalice'); MS.step(cs2, 1, []);
  cs2.carriedLoot = { id: 'bend.castle.chapel1.relic', kind: 'relic', relic: 'ember_chalice', mission: true, gold: 0, size: 1, region: 'bend' };
  ev = MS.step(cs2, 1000, []);
  ok(ofType(ev, 'loot:vanished').length === 1 && cs2.carriedLoot === null, 'mission loot vanishes on timeout');
  ok(!cs2.hoard.relics.length, 'no relic banked after a fail');
}

// 10. through state.step: death fails the running mission; the lair respawn does not count as delivery
{
  const cs = makeCs('bend');
  cs.dragon.pilot = F.newPilot([0, 120, 0], 0, 20);
  S.missionAct(cs, 'accept', 'a2_workshop');
  S.step(cs, IN, 0.1);
  ok(cs.mission && cs.mission.state === 'running', 'state.step starts the timer in the Bend');
  S.missionAct(cs, 'finish');
  ok(cs.mission.state === 'done', 'debug finish');
  cs.dragon.hp = 0;
  const ev = S.step(cs, IN, 0.1);
  ok(ofType(ev, 'dragon:died').length === 1, 'died');
  const f = ofType(ev, 'mission:failed')[0];
  ok(!!f && f.why === 'death', 'death fails even with the objective done');
  ok(!ofType(ev, 'mission:success').length && cs.missions.completed.length === 0, 'no success from the respawn in the lair');
  ok(ev.some(e => e.e === 'save'), 'a fail autosaves');
}

// 11. state.step: the timer does not run inside an aerie (world paused branch)
{
  const cs = makeCs('bend');
  cs.dragon.pilot = F.newPilot([0, 120, 0], 0, 20);
  S.missionAct(cs, 'accept', 'a2_workshop');
  S.step(cs, IN, 1);
  const left = cs.mission.left;
  cs.inAerie = 'bend';
  S.step(cs, IN, 5);
  near(cs.mission.left, left, 1e-9, 'aerie: timer paused');
  S.missionAct(cs, 'finish');
  const ev = S.step(cs, IN, 0.1);
  ok(ofType(ev, 'mission:success').length === 1, 'finished + in the aerie: success');
  S.missionAct(cs, 'accept', 'a2_chalice');
  ok(ofType(S.missionAct(cs, 'fail'), 'mission:failed')[0].why === 'debug', 'debug fail');
}

// 12. save: completed and retry marks survive a round trip; the map refuses travel with a mission on
{
  const cs = makeCs('bend');
  cs.dragon.pilot = F.newPilot([0, 120, 0], 0, 20);
  cs.missions.completed = ['a2_workshop'];
  cs.missions.failedAt = { a2_chalice: 2 };
  const back = SV.deserialise(JSON.parse(JSON.stringify(SV.serialise(cs))), mulberry(3));
  ok(back.missions.completed.join() === 'a2_workshop', 'completed restored');
  ok(back.missions.failedAt.a2_chalice === 2, 'retry mark restored');
  MS.accept(back, 'a2_caravan');
  const MP = core('map');
  back.inAerie = 'bend';
  ok(MP.canTravel(back, null, 'lair').why === 'mission', 'fast travel refused with a mission on');
}
