// Mission board, HUD and target marker (Phase 3 T11): board station in the cave and its controls slot, accept / drop
// through caveAct, timer levels at warn / danger, objective lines, gold target on the compass (in the target region
// and through the exit on the way there) and on the map, nothing once the objective is done.
'use strict';
const { ok, core } = require('./harness.js');
const MS = core('missions'), S = core('state'), D = core('data'), CV = core('cave'), CT = core('controls'), NV = core('nav'), MP = core('map'), SE = core('settlement'), LR = core('lair');
const F = core('flight');
const { mulberry, wrap, clamp } = core('math');

function makeCs(regionId, stage) {
  const cs = S.create({ regionId: regionId || 'ash', rng: mulberry(11) });
  cs.dragon.stage = stage == null ? 1 : stage;
  cs.dragon.hp = 100;
  cs.dragon.pilot = cs.dragon.pilot || F.newPilot([0, 120, 0], 0, 20);
  return cs;
}
const ofType = (ev, name) => ev.filter(e => e.e === name);

// 1. the board station: in the hall, clear of the other stations, the Action slot names it
{
  const B = D.cave.stations.board;
  ok(Array.isArray(B) && B.length === 3, 'board station in data.cave.stations');
  ok(Math.hypot(B[0], B[1]) + B[2] < D.cave.bounds, 'board inside the hall');
  for (const id in D.cave.stations) if (id !== 'board') {
    const s = D.cave.stations[id];
    ok(Math.hypot(s[0] - B[0], s[1] - B[1]) > s[2] + B[2] + D.cave.reach, 'board reach clear of ' + id);
  }
  const cs = makeCs('ash', 0), dt = 1 / 60;
  cs.dragon.pilot = F.newPilot(LR.mouthPos('ash').slice(), Math.PI, 30);
  LR.enter(cs);
  const t0 = cs.stats.played;
  for (let i = 0; i < 20 / dt && cs.station !== 'board' && cs.inLair; i++) {
    const p = cs.dragon.pilot, turn = wrap(Math.atan2(B[0] - p.pos[0], B[1] - p.pos[2]) - p.yaw);
    S.step(cs, { sx: clamp(-turn * 3, -1, 1), sy: Math.abs(turn) < 0.5 ? 1 : 0 }, dt);
  }
  ok(cs.station === 'board' && CV.stationAt(cs) === 'board', 'walked from the tunnel to the board');
  ok(cs.stats.played - t0 < 12, 'tunnel to board in under 12 s at hatchling speed: ' + (cs.stats.played - t0).toFixed(1) + ' s');
  ok(CT.slots(cs).action === 'board', 'the Action slot opens the board');
}

// 2. accept and drop through caveAct (the board panel buttons)
{
  const cs = makeCs('ash');
  cs.inLair = true;
  ok(ofType(S.caveAct(cs, 'board', 'a2_workshop'), 'mission:accepted').length === 1 && cs.mission.state === 'accepted', 'Accept on the board');
  ok(MS.list(cs).every(r => r.why === 'busy'), 'board shows the others busy');
  ok(ofType(S.caveAct(cs, 'board', null), 'mission:cancelled').length === 1 && cs.mission === null, 'Drop mission before the clock runs');
  const hatch = makeCs('ash', 0); hatch.inLair = true;
  ok(ofType(S.caveAct(hatch, 'board', 'a2_chalice'), 'mission:refused')[0].why === 'stage', 'a hatchling is refused (stage)');
  cs.inLair = false;
  ok(S.caveAct(cs, 'board', 'a2_workshop').length === 0, 'no board outside the cave');
}

// 3. timer levels for the HUD: ok, warn at mission.warn, danger at mission.danger
{
  const cs = makeCs('ash');
  MS.accept(cs, 'a2_workshop');
  ok(MS.timerState(cs).level === 'ok' && !MS.timerState(cs).running, 'accepted: ok, not running yet');
  cs.region = 'farm';
  MS.step(cs, 1, []);
  ok(MS.timerState(cs).running, 'running outside the lair region');
  cs.mission.left = D.mission.warn + 0.5; ok(MS.timerState(cs).level === 'ok', 'above warn: ok');
  cs.mission.left = D.mission.warn; ok(MS.timerState(cs).level === 'warn', 'at 60 s: amber');
  cs.mission.left = D.mission.danger; ok(MS.timerState(cs).level === 'danger', 'at 20 s: red');
  ok(D.mission.warn === 60 && D.mission.danger === 20, 'warn 60 s, danger 20 s');
}

// 4. objective line keys
{
  const cs = makeCs('ash');
  ok(MS.objective(cs) === null, 'no mission: no line');
  for (const m of D.missions) {
    cs.mission = null; MS.accept(cs, m.id);
    const ob = MS.objective(cs);
    ok(ob.key === 'c.mission.obj.' + m.type && ob.p.region === 'c.region.bend', 'objective line for ' + m.type);
  }
  MS.finish(cs);
  ok(MS.objective(cs).key === 'c.mission.obj.home', 'done: fly home');
}

// 5. target: the building of the mission in the Bend; compass marker (gold, first) here and through the exit elsewhere
{
  const bend = SE.build('bend');
  const cs = makeCs('bend');
  ok(MS.target(cs) === null, 'no mission: no target');
  MS.accept(cs, 'a2_chalice');
  const tg = MS.target(cs), chapel = bend.buildings.find(b => b.id === 'bend.castle.chapel1');
  ok(chapel && tg && tg.region === 'bend' && Math.abs(tg.x - chapel.pos[0]) < 1e-9 && Math.abs(tg.z - chapel.pos[2]) < 1e-9, 'steal target = the chapel');
  cs.mission = null; MS.accept(cs, 'a2_workshop');
  const ws = bend.buildings.find(b => b.id === 'bend.castle.workshop1');
  ok(ws && Math.abs(MS.target(cs).x - ws.pos[0]) < 1e-9, 'destroy target = the workshop');
  ok(MS.target(cs).r === Math.max(D.mission.ring.min, ws.r + D.mission.ring.pad), 'world ring around the workshop: its r + pad');
  ok(tg.r >= D.mission.ring.min && tg.r > chapel.r, 'chapel ring encloses the chapel');
  let mk = NV.markers(cs);
  ok(mk[0].kind === 'mission' && mk[0].label.key === 'c.nav.mission', 'compass: mission marker first, in the target region');
  const p = cs.dragon.pilot;
  ok(Math.abs(mk[0].dist - Math.hypot(ws.pos[0] - p.pos[0], ws.pos[2] - p.pos[2])) < 1e-6, 'marker distance to the workshop');
  ok(mk.length <= D.nav.markers, 'marker cap kept');
  const far = makeCs('ash');
  MS.accept(far, 'a2_workshop');
  mk = NV.markers(far);
  const m0 = mk.find(m => m.kind === 'mission');
  ok(m0 && m0.label.key === 'c.nav.missionVia' && m0.via === 'wild', 'from the Ash Wastes: through Wildwood');
  far.inLair = true;
  ok(!NV.markers(far).some(m => m.kind === 'mission'), 'no marker inside the cave');
  far.inLair = false;
  MS.finish(far);
  ok(MS.target(far) === null && !NV.markers(far).some(m => m.kind === 'mission'), 'objective done: the gold marker goes (fly home)');
  // intercept: no target until the caravan exists (T15)
  const ic = makeCs('bend'); MS.accept(ic, 'a2_caravan');
  ok(MS.target(ic) === null, 'intercept: no target before T15 caravan');
  ic.caravans = { tithe: { region: 'bend', pos: [10, 0, 20] } };
  ok(MS.target(ic).x === 10 && MS.target(ic).z === 20, 'intercept: the wagon position');
}

// 6. map model: target ring in the target region only, the world view marks that region
{
  const cs = makeCs('bend');
  ok(MP.model(cs, 'bend').target === null, 'no mission: no ring');
  MS.accept(cs, 'a2_chalice');
  const mb = MP.model(cs, 'bend');
  ok(mb.target && mb.target.id === 'a2_chalice', 'target ring on the Bend map');
  ok(mb.regions.find(r => r.id === 'bend').mission === true, 'world view marks the Bend');
  ok(MP.model(cs, 'farm').target === null, 'no ring on other region maps');
}

// 7. texts: every mission has a name and a briefing in EN and CS
{
  const src = require('fs').readFileSync(require('path').join(__dirname, '../../i18n.js'), 'utf8');
  for (const m of D.missions) for (const k of ['c.mission.' + m.id, 'c.brief.' + m.id, 'c.mission.obj.' + m.type]) {
    ok((src.match(new RegExp("'" + k.replace(/\./g, '\\.') + "':", 'g')) || []).length === 2, 'EN + CS: ' + k);
  }
}
