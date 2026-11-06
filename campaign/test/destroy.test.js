// Destroy mission (Phase 3 T14): the castle siege workshop of Vyshgard. Burning it to a ruin meets the objective, the
// ruin is held (no fire.rebuild) until the mission succeeds or fails, a workshop that is already a ruin at accept is
// rebuilt by the Order first, and the seeded destroy bot (test/destroy-bot.js) flies it from the board to success in
// the 5-10 min band (003_task_missions.md T14).
'use strict';
const { ok, core } = require('./harness.js');
const DB = require('./destroy-bot.js');
const MS = core('missions'), S = core('state'), D = core('data'), F = core('flight'), G = core('growth');
const { mulberry } = core('math');

const id = 'a2_workshop', md = MS.def(id), WS = md.target;
const IN = { sx: 0, sy: 0, breath: false, boost: false, grab: false, eat: false, confirm: false, enter: false, land: false };
const ofType = (ev, name) => ev.filter(e => e.e === name);

/** A Drake flying high over the Bend, far from the castle (nothing shoots, nothing burns). */
function bend(seed) {
  const cs = S.create({ regionId: 'bend', rng: mulberry(seed || 3) });
  Object.assign(cs.dragon, { stage: 1, foodXp: D.stages[1].foodFrom, hp: D.stages[1].hp, hunger: D.hunger.max });
  cs.dragon.pilot = F.newPilot([-600, 400, 600], 0, G.statsOf(1).cruise);
  S.ensureTown(cs);
  return cs;
}
const ws = cs => cs.town.buildings.find(b => b.id === WS);
const run = (cs, s) => { const ev = []; for (let i = 0; i < s * 10; i++) { cs.dragon.pilot.pos[1] = 400; for (const e of S.step(cs, IN, 0.1)) ev.push(e); } return ev; };

// 1. data: the destroy mission names the castle workshop, a wooden building (it becomes a ruin, not a charred shell)
{
  ok(md && md.type === 'destroy' && md.region === 'bend', 'a2_workshop is the destroy mission of the Bend');
  const cs = bend();
  ok(ws(cs) && ws(cs).type === 'workshop' && !D.buildings.workshop.stone, 'target is the castle workshop, wood: ' + WS);
  ok(md.time >= 300 && md.time <= 600, 'mission time ' + md.time + ' s');
}

// 2. objective: the workshop's 'building:ruined' -> done; another building's ruin does not count
{
  const cs = bend();
  MS.accept(cs, id);
  MS.step(cs, 0.1, []);
  ok(cs.mission.state === 'running', 'running outside the lair region');
  MS.step(cs, 0.1, [{ e: 'building:ruined', id: 'bend.castle.gatehouse2' }]);
  ok(cs.mission.state === 'running', 'the gatehouse is not the objective');
  const ev = MS.step(cs, 0.1, [{ e: 'building:ruined', id: WS }]);
  ok(ofType(ev, 'mission:done').length === 1 && cs.mission.state === 'done', 'workshop ruined: done');
  MS.step(cs, 0.1, [{ e: 'loot:dropped' }, { e: 'building:rebuilt', id: WS }]);
  ok(cs.mission.state === 'done', 'a destroy stays done (no loot to lose)');
  ok(MS.target(cs) === null && MS.objective(cs).key === 'c.mission.obj.home', 'done: no target marker, fly home');
}

// 3. the ruin is held: past fire.rebuild it still stands as a ruin while the mission is on, then comes back
{
  const cs = bend();
  MS.accept(cs, id);
  cs.stats.played = 5000;
  const b = ws(cs);
  b.ruin = true; b.ruinAt = 10; b.hp = 0;                           // ruined long ago (older than fire.rebuild)
  cs.regionStates.bend = cs.regionStates.bend || {};
  cs.regionStates.bend.ruins = [{ id: WS, at: 10 }];
  ok(MS.holds(cs, 'bend', WS) && !MS.holds(cs, 'bend', 'bend.castle.keep1') && !MS.holds(cs, 'farm', WS), 'holds: only the target, only its region');
  let ev = run(cs, 3);
  ok(ws(cs).ruin && !ofType(ev, 'building:rebuilt').some(e => e.id === WS), 'held: no rebuild while the mission is on');
  ok(cs.regionStates.bend.ruins.some(r => r.id === WS), 'held: still in the region ruins (saved)');
  MS.fail(cs, 'debug');
  ok(!MS.holds(cs, 'bend', WS), 'mission over: no hold');
  ev = run(cs, 1);
  ok(!ws(cs).ruin && ofType(ev, 'building:rebuilt').some(e => e.id === WS), 'after the mission the workshop is rebuilt (fire.rebuild has passed)');
}

// 4. success also ends the hold
{
  const cs = bend();
  MS.accept(cs, id); MS.step(cs, 0.1, []);
  MS.step(cs, 0.1, [{ e: 'building:ruined', id: WS }]);
  cs.inAerie = 'bend';
  const ev = MS.step(cs, 0.1, []);
  cs.inAerie = null;
  ok(ofType(ev, 'mission:success').length === 1 && !MS.holds(cs, 'bend', WS), 'success ends the hold');
}

// 5. accepted while the workshop is already a ruin: the Order has rebuilt it (else the mission could never be met)
{
  const cs = bend();
  const b = ws(cs);
  b.ruin = true; b.ruinAt = cs.stats.played; b.hp = 0;
  cs.regionStates.bend = { ruins: [{ id: WS, at: cs.stats.played }, { id: 'bend.castle.well1', at: 0 }] };
  const ev = MS.accept(cs, id);
  ok(ofType(ev, 'mission:accepted').length === 1, 'accepted');
  ok(ofType(ev, 'building:rebuilt').some(e => e.id === WS && e.mission === id), 'building:rebuilt for the target');
  ok(!ws(cs).ruin && ws(cs).hp === D.buildings.workshop.hp, 'the loaded workshop stands at full hp');
  ok(!cs.regionStates.bend.ruins.some(r => r.id === WS) && cs.regionStates.bend.ruins.some(r => r.id === 'bend.castle.well1'), 'only the target leaves the region ruins');
  const cs2 = bend();
  cs2.region = 'ash'; cs2.town = null;                              // accepted at the board, the Bend not loaded
  cs2.regionStates.bend = { ruins: [{ id: WS, at: 0 }] };
  ok(ofType(MS.accept(cs2, id), 'building:rebuilt').length === 1 && cs2.regionStates.bend.ruins.length === 0, 'Bend not loaded: cleared from the saved ruins');
  const cs3 = bend();
  ok(ofType(MS.accept(cs3, id), 'building:rebuilt').length === 0, 'standing workshop: nothing to rebuild');
}

// 6. seeded destroy bot: from the board in the cave to success, in the 5-10 min band
{
  const SEEDS = [1, 2, 3, 4, 5, 6], BAND = [5, 10], mins = [];
  for (const seed of SEEDS) {
    const cs = S.create({ rng: mulberry(seed) });
    cs.story.act = 2;
    Object.assign(cs.dragon, { stage: 1, foodXp: D.stages[1].foodFrom, hp: D.stages[1].hp, hunger: D.hunger.max });
    cs.dragon.pilot = F.newPilot([0, 200, 0], 0, G.statsOf(1).cruise);
    cs.inLair = true;
    const log = [];
    let heldRuin = true;
    const r = DB.fly(cs, id, { seed, profile: 'careful', check: (c, ev, bot) => {
      for (const e of ev) if (/^mission:/.test(e.e)) log.push(e.e);
      if (bot.ruined && c.region === 'bend' && !(c.town.buildings.find(q => q.id === WS) || {}).ruin) heldRuin = false;
    } });
    const tag = 'destroy seed ' + seed + ' ';
    ok(r.accepted, tag + 'accepted at the board');
    ok(log[0] === 'mission:started' && log.indexOf('mission:done') > 0, tag + 'started out of the lair region, objective met: ' + log.join(','));
    ok(r.success && r.success.id === id && !r.failed && !r.died, tag + 'success: ' + JSON.stringify(r.log.slice(-3)) + ' ' + (r.failed && r.failed.why) + ' ' + r.died);
    ok(r.ruinedAt != null && heldRuin && !r.rebuiltDuring, tag + 'the workshop stays a ruin until the mission is over');
    ok(cs.inLair && cs.missions.completed.indexOf(id) >= 0 && MS.list(cs).find(q => q.id === id).why === 'done', tag + 'completed in the lair, off the board');
    ok(r.success && cs.hoard.gold === r.success.gold && r.success.gold >= md.reward.gold, tag + 'reward with the time bonus: ' + (r.success && r.success.gold));
    ok(r.hpLeft > 0, tag + 'alive (' + (100 * r.hpLeft / D.stages[1].hp).toFixed(0) + '% HP; T19 balances to 20%)');
    mins.push(r.minutes);
    if (process.env.SIM_VERBOSE) console.log('     destroy seed ' + seed + ': ' + r.minutes.toFixed(2) + ' min, ' + r.passes + ' passes, ' + (r.success ? r.success.left.toFixed(0) : '-') + ' s left, HP ' + (100 * r.hpLeft / D.stages[1].hp).toFixed(0) + '%');
  }
  const mean = mins.reduce((a, b) => a + b, 0) / mins.length;
  ok(mean >= BAND[0] && mean <= BAND[1], 'destroy: mean mission in ' + BAND.join('-') + ' min: ' + mean.toFixed(2) + ' (' + mins.map(m => m.toFixed(1)).join(', ') + ')');
}
