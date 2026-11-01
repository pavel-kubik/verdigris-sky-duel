// Fast travel (Phase 3 T09): the map stone station in the cave, map.canTravel rules (only from the lair or an aerie,
// only to the lair or a found aerie, never during a mission or with mission loot), map.travel / state.travel region
// swap (fresh prey field, carried prey along, town of the new region), arrival in front of the aerie or the lair,
// travel back to the lair, save after travel.
'use strict';
const { ok, near, core } = require('./harness.js');
const MP = core('map'), S = core('state'), D = core('data'), AE = core('aerie'), LR = core('lair'), CV = core('cave'), CT = core('controls'), T = core('terrain'), F = core('flight'), SV = core('save');
const { mulberry } = core('math');

function makeCs(stage) {
  const cs = S.create({ regionId: LR.home(), rng: mulberry(9) });
  cs.dragon.stage = stage == null ? 1 : stage;
  cs.dragon.hp = 100;
  const sp = T.region(LR.home()).spawn;
  cs.dragon.pilot = F.newPilot([sp.x, sp.y, sp.z], sp.yaw, 20);
  return cs;
}
const findAll = cs => { for (const id of ['wild', 'farm', 'bend']) cs.discovered[id + '.aerie'] = true; };
function inLair(cs) { LR.enter(cs, 'tunnel'); return cs; }
function enterAerie(cs, id) {
  S.enterRegion(cs, id);
  const s = AE.site(id);
  cs.discovered[s.id] = true;
  cs.dragon.pilot = F.newPilot(s.mouth.slice(), s.facing + Math.PI, 10);
  AE.enter(cs);
  return s;
}

// 1. the map stone is a cave station off the entry line, offered by the Action slot
{
  const cs = inLair(makeCs());
  ok(!!D.cave.stations.mapStone, 'mapStone station in data');
  ok(cs.station !== 'mapStone', 'arriving in the tunnel is not at the map stone: ' + cs.station);
  const ms = D.cave.stations.mapStone, p = cs.dragon.pilot;
  p.pos[0] = ms[0] + 2; p.pos[2] = ms[1] + 2;
  ok(CV.stationAt(cs) === 'mapStone', 'standing at the map stone: ' + CV.stationAt(cs));
  cs.station = CV.stationAt(cs);
  ok(CT.slots(cs).action === 'mapStone' && CT.isStation('mapStone'), 'Action slot offers the map stone');
  ok(CV.walkable(ms[0], ms[1] + ms[2] + 2, 1), 'map stone stands on the walkable floor');
}

// 2. destinations: the lair always, aeries only once found
{
  const cs = makeCs();
  ok(MP.destinations(cs).map(d => d.id).join() === 'lair', 'only the lair before any aerie is found');
  cs.discovered['farm.aerie'] = true;
  const ds = MP.destinations(cs);
  ok(ds.length === 2 && ds[1].id === 'farm.aerie' && ds[1].region === 'farm' && ds[1].kind === 'aerie', 'found aerie listed: ' + JSON.stringify(ds));
  findAll(cs);
  ok(MP.destinations(cs).length === 4, 'lair + 3 aeries');
}

// 3. canTravel rules
{
  const cs = makeCs();
  findAll(cs);
  ok(MP.here(cs) === null, 'flying: not at a station');
  ok(MP.canTravel(cs, null, 'wild.aerie').why === 'station', 'not from the open air');
  inLair(cs);
  ok(MP.here(cs) === 'lair', 'in the lair: here = lair');
  ok(MP.canTravel(cs, 'lair', 'wild.aerie').ok, 'lair -> found aerie ok');
  ok(MP.canTravel(cs, 'bend.aerie', 'wild.aerie').why === 'station', 'from must be where the dragon is');
  ok(MP.canTravel(cs, 'lair', 'lair').why === 'here', 'not to where it is');
  ok(MP.canTravel(cs, 'lair', 'castle').why === 'unknown', 'not to an unknown place');
  const fresh = inLair(makeCs());
  ok(MP.canTravel(fresh, 'lair', 'wild.aerie').why === 'unknown', 'not to an aerie not found yet');
  for (const st of ['accepted', 'running', 'done']) {
    cs.mission = { id: 'm', state: st };
    ok(MP.canTravel(cs, 'lair', 'wild.aerie').why === 'mission', 'blocked with a mission ' + st);
  }
  for (const st of ['offered', 'success', 'failed']) {
    cs.mission = { id: 'm', state: st };
    ok(MP.canTravel(cs, 'lair', 'wild.aerie').ok, 'not blocked with a mission ' + st);
  }
  cs.mission = null;
  cs.carriedLoot = { id: 'x', kind: 'relic', gold: 0, size: 1, region: 'bend' };
  ok(MP.canTravel(cs, 'lair', 'wild.aerie').why === 'missionLoot', 'blocked with a relic in the claws');
  cs.carriedLoot = { id: 'y', kind: 'chest', gold: 50, size: 1, region: 'bend', mission: 'm' };
  ok(MP.canTravel(cs, 'lair', 'wild.aerie').why === 'missionLoot', 'blocked with mission loot');
  cs.carriedLoot = null;
  const ev = MP.travel(Object.assign(cs, { mission: { state: 'running' } }), 'wild.aerie');
  ok(ev.length === 1 && ev[0].e === 'travel:refused' && ev[0].why === 'mission' && cs.inLair && cs.region === LR.home(), 'refused travel changes nothing');
}

// 4. lair -> aerie: region swap, in the air in front of the cleft facing out, new prey field and town, save
{
  const cs = makeCs();
  findAll(cs);
  inLair(cs);
  const oldField = cs.field;
  const ev = S.travel(cs, 'bend.aerie');
  const s = AE.site('bend'), p = cs.dragon.pilot;
  ok(ev.some(e => e.e === 'region:enter' && e.region === 'bend' && e.travel), 'region:enter (travel)');
  ok(ev.some(e => e.e === 'travel:done' && e.from === 'lair' && e.to === 'bend.aerie' && e.region === 'bend'), 'travel:done');
  ok(ev.some(e => e.e === 'save'), 'autosave after travel');
  ok(cs.region === 'bend' && !cs.inLair && !cs.inAerie && cs.station === null, 'out in the Bend, not inside');
  ok(cs.field !== oldField && cs.field.list.length > 0, 'fresh prey field');
  ok(cs.town && cs.town.region === 'bend', 'Bend town built');
  ok(p.mode !== 'ground' && p.speed > 0, 'flying on arrival');
  near(p.yaw, s.facing, 1e-9, 'facing out of the cleft');
  const d = Math.hypot(p.pos[0] - s.mouth[0], p.pos[2] - s.mouth[2]);
  ok(d > 10 && d < 60, 'in front of the aerie: ' + d.toFixed(1));
  ok(p.pos[1] > T.surfaceAt('bend', p.pos[0], p.pos[2]), 'above the ground');
  ok(Math.cos(Math.atan2(p.pos[0] - s.mouth[0], p.pos[2] - s.mouth[2]) - s.facing) > 0.9, 'on the open side of the cleft');
  ok(!AE.near(cs), 'the Enter aerie prompt does not show while flying away');
  // some flight frames run without errors
  for (let i = 0; i < 20; i++) S.step(cs, { sx: 0, sy: 0 }, 0.05);
  ok(cs.region === 'bend' && cs.dragon.hp > 0, 'flies on in the Bend');
}

// 5. aerie -> lair, and aerie -> aerie; carried prey comes along
{
  const cs = makeCs();
  findAll(cs);
  enterAerie(cs, 'farm');
  ok(MP.here(cs) === 'farm.aerie', 'inside the aerie: here = farm.aerie');
  const prey = cs.field.list[0];
  cs.dragon.carried = prey.id;
  const type = prey.type;
  let ev = S.travel(cs, 'wild.aerie');
  ok(ev.some(e => e.e === 'travel:done' && e.from === 'farm.aerie') && cs.region === 'wild' && !cs.inAerie, 'aerie -> aerie');
  const c = cs.dragon.carried == null ? null : cs.field.list.find(q => q.id === cs.dragon.carried);
  ok(!!c && c.type === type, 'carried prey travels along');
  enterAerie(cs, 'wild');
  ev = S.travel(cs, 'lair');
  const home = LR.home(), sp = T.region(home).spawn, p = cs.dragon.pilot;
  ok(ev.some(e => e.e === 'region:enter' && e.region === home) && ev.some(e => e.e === 'travel:done' && e.to === 'lair'), 'aerie -> lair');
  ok(cs.region === home && !cs.inLair && !cs.inAerie, 'outside the lair, in the home region');
  near(p.pos[0], sp.x, 1e-6, 'at the lair spawn x'); near(p.pos[2], sp.z, 1e-6, 'at the lair spawn z');
  ok(!ev.some(e => e.e === 'lair:leave' || e.e === 'aerie:leave'), 'no leave events (travel:done instead)');
  // and back: fly into the cave, travel again
  inLair(cs);
  ok(MP.canTravel(cs, 'lair', 'farm.aerie').ok, 'travel again from the lair');
}

// 6. the stage is kept, HP and hunger untouched; the save after travel restores the new region
{
  const cs = makeCs(1);
  findAll(cs);
  inLair(cs);
  cs.dragon.hp = 55; cs.dragon.hunger = 40;
  S.travel(cs, 'wild.aerie');
  ok(cs.dragon.stage === 1 && cs.dragon.hp === 55 && cs.dragon.hunger === 40, 'stage, hp, hunger unchanged');
  const o = SV.serialise(cs), back = SV.deserialise(JSON.parse(JSON.stringify(o)), mulberry(3));
  ok(back && back.region === 'wild' && !back.inLair, 'save after travel restores the region: ' + (back && back.region));
  ok(back && back.discovered['bend.aerie'] && back.discovered['farm.aerie'], 'found aeries survive the save');
}
