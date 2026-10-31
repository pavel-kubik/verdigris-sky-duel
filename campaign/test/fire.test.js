// Building fire (Phase 2 T13): ignite, burn, spread to neighbours, ruins, rebuild, stats, region state and save.
'use strict';
const { ok, near } = require('./harness.js');
const SE = require('./harness.js').core('settlement');
const { core } = require('./harness.js');
const D = core('data'), T = core('terrain'), S = core('state'), PR = core('prey'), G = core('growth'), SV = core('save');
const { mulberry } = core('math');
const dt = 1 / 60;
const FI = D.fire;

/** A hatchling-sized breath cone from `back` units in front of building b (on the given local side), aimed at its middle. */
function coneAt(b, back, side) {
  const a = side || 0, x = b.pos[0] + Math.sin(a) * (b.r + back), z = b.pos[2] + Math.cos(a) * (b.r + back);
  const y = b.pos[1] + b.h * 0.5 + 2, tx = b.pos[0], ty = b.pos[1] + b.h * 0.5, tz = b.pos[2];
  const yaw = Math.atan2(tx - x, tz - z), pitch = Math.atan2(ty - y, Math.hypot(tx - x, tz - z));
  return PR.breathCone({ pos: [x, y, z], yaw, pitch }, G.scaleOf(0, 0), null);
}

// 1. a tower burns down in about 10 s of breath at hatchling stats
{
  const town = SE.build('farm'), tw = town.buildings.find(b => b.id === 'farm.outpost.tower1');
  const cone = coneAt(tw, 12, Math.PI);
  ok(SE.inFire(tw, cone, 'farm'), 'the cone reaches the tower');
  let t = 0, lit = null, ruined = null;
  while (t < 30 && !ruined) {
    t += dt;
    for (const e of SE.burn(town, cone, dt, { rng: () => 1, now: t })) {
      if (e.e === 'building:burning' && e.id === tw.id) lit = t;
      if (e.e === 'building:ruined' && e.id === tw.id) ruined = t;
    }
  }
  near(lit, FI.ignite, 2 * dt, 'the tower catches fire after fire.ignite s of breath');
  ok(ruined > 8.5 && ruined < 12, 'the tower burns down in about 10 s of breath (' + ruined.toFixed(2) + ' s)');
  ok(tw.ruin && tw.ruinAt === ruined && tw.fire === 0, 'it is a ruin from that moment');
  ok(SE.solidAt(town, tw.pos[0], tw.pos[2]) == null, 'a ruin is no solid: the dragon can land in the rubble');
}

// 2. a short breath does not ignite; the heat cools away; a burning building burns on without the breath
{
  const town = SE.build('farm'), h = town.buildings.find(b => b.id === 'farm.village.house1'), cone = coneAt(h, 10, 0);
  ok(SE.inFire(h, cone, 'farm'), 'the cone reaches the house');
  let ev = [];
  for (let t = 0; t < FI.ignite * 0.6; t += dt) ev = ev.concat(SE.burn(town, cone, dt, { rng: () => 1 }));
  ok(!ev.some(e => e.e === 'building:burning') && h.heat > 0 && !(h.fire > 0), 'half the ignite time: hot, not burning');
  for (let t = 0; t < 10; t += dt) SE.burn(town, null, dt, { rng: () => 1 });
  ok(h.heat === 0, 'out of the breath the heat cools away (fire.cool)');
  for (let t = 0; t < FI.ignite + 0.1; t += dt) SE.burn(town, cone, dt, { rng: () => 1 });
  ok(h.fire > 0, 'a full fire.ignite of breath sets it alight');
  const hp0 = h.hp;
  for (let t = 0; t < 2; t += dt) SE.burn(town, null, dt, { rng: () => 1 });
  near(hp0 - h.hp, FI.burn * 2, 0.2, 'without the breath it burns at fire.burn hp/s');
  const hp1 = h.hp;
  for (let t = 0; t < 1; t += dt) SE.burn(town, cone, dt, { rng: () => 1 });
  near(hp1 - h.hp, FI.burn + FI.fan, 0.2, 'under the breath it burns at fire.burn + fire.fan hp/s');
  const hp2 = h.hp;
  for (let t = 0; t < 1; t += dt) SE.burn(town, null, dt, { rng: () => 1, mult: 1.3 });
  near(hp2 - h.hp, FI.burn * 1.3, 0.2, 'mult (hotter fire upgrade, T20) scales the burn');
}

// 3. the cone misses what it does not point at, and a hill in between stops it
{
  const town = SE.build('farm'), h = town.buildings.find(b => b.id === 'farm.village.house1');
  const away = coneAt(h, 10, 0); away.dir = away.dir.map(v => -v);
  ok(!SE.inFire(h, away, 'farm'), 'breath pointing away does not reach');
  const far = coneAt(h, D.breath.range * 1.5, 0);
  ok(!SE.inFire(h, far, 'farm'), 'out of breath range does not reach');
  const down = coneAt(h, 10, 0); down.dir = [0, -1, 0];
  ok(!SE.inFire(h, down, 'farm'), 'breath into the ground in front does not reach');
  ok(!SE.inFire(Object.assign({}, h, { ruin: true }), coneAt(h, 10, 0), 'farm'), 'a ruin does not burn again');
}

// 4. fire spreads only to neighbours (same settlement, within fire.reach), never across settlements
let spreadAll = 0;
for (const [seed, startId] of [[1, 'farm.village.house1'], [2, 'farm.hamlet.house1'], [3, 'farm.outpost.vault1'], [4, 'farm.outpost.platform1'], [5, 'farm.hamlet.barn1']]) {
  const town = SE.build('farm'), rng = mulberry(seed * 977);
  const first = town.buildings.find(b => b.id === startId), home = first.place;
  first.fire = 1e-3;
  let bad = 0, spread = 0, t = 0;
  while (t < 120) {
    t += dt;
    const before = new Set(town.buildings.filter(b => b.fire > 0 || b.ruinAt === t).map(b => town.buildings.indexOf(b)));
    for (const e of SE.burn(town, null, dt, { rng, now: t })) {
      if (e.e !== 'building:burning') continue;
      spread++;
      const j = town.buildings.findIndex(b => b.id === e.id);
      if (!e.spread || ![...before].some(i => town.buildings[i].nb.includes(j))) bad++;
      if (town.buildings[j].place !== home) bad++;
    }
  }
  spreadAll += spread;
  ok(bad === 0, startId + ': every spread ignition came from a burning neighbour in ' + home + ' (' + spread + ' spread)');
  ok(town.buildings.filter(b => b.place !== home).every(b => !b.ruin && !(b.fire > 0)), startId + ': other settlements untouched');
  ok(town.buildings.every(b => !(b.fire > 0)), startId + ': every fire burns out within 2 min');
}
ok(spreadAll > 0, 'fire does spread to neighbours (' + spreadAll + ' ignitions over 5 runs)');
{
  const town = SE.build('farm');
  for (const b of town.buildings) for (const j of b.nb) {
    const o = town.buildings[j];
    ok(o.place === b.place && o !== b, b.id + ' -> ' + o.id + ': neighbours share the settlement');
  }
  const tw = town.buildings.find(b => b.id === 'farm.outpost.tower1'), tw2 = town.buildings.find(b => b.id === 'farm.outpost.tower2');
  ok(!tw.nb.includes(town.buildings.indexOf(tw2)), 'the two outpost towers (28 apart) are no neighbours');
  const pal = town.buildings.filter(b => b.place === 'farm.outpost' && b.type === 'palisade');
  ok(pal.every(b => b.nb.some(j => town.buildings[j].type === 'palisade')), 'palisade pieces neighbour the next pieces');
}

// 5. rebuild after fire.rebuild, not while the dragon stands in the footprint
{
  const town = SE.build('farm'), tw = town.buildings.find(b => b.id === 'farm.outpost.tower1');
  tw.ruin = true; tw.ruinAt = 100; tw.hp = 0;
  ok(SE.rebuild(town, 100 + FI.rebuild - 1).length === 0 && tw.ruin, 'still a ruin before fire.rebuild');
  ok(SE.rebuild(town, 100 + FI.rebuild, () => true).length === 0 && tw.ruin, 'blocked (dragon inside): waits');
  const ev = SE.rebuild(town, 100 + FI.rebuild);
  ok(ev.length === 1 && ev[0].e === 'building:rebuilt' && ev[0].id === tw.id, 'building:rebuilt after fire.rebuild');
  ok(!tw.ruin && tw.hp === D.buildings.tower.hp && SE.solidAt(town, tw.pos[0], tw.pos[2]) != null, 'whole again, full hp, a solid');
}

// 6. state: a landed hatchling breathes on a house -> ruin, stats, region state, save round trip, rebuild later
{
  const cs = S.create({ regionId: 'farm', rng: mulberry(7) });
  const town = S.ensureTown(cs), h = town.buildings.find(b => b.id === 'farm.village.house1');
  const p = cs.dragon.pilot = require('./harness.js').core('flight').newPilot([0, 0, 0], 0, 20);
  const back = h.r + 9, x = h.pos[0], z = h.pos[2] - back;
  p.pos = [x, T.surfaceAt('farm', x, z) + D.walk.stand * G.scaleOf(0, 0), z]; p.yaw = 0; p.pitch = 0.15; p.mode = 'ground'; p.speed = 0; p.vel = [0, 0, 0];
  cs.field.list.length = 0;                                     // no prey to bend the stream
  const evs = [];
  for (let t = 0; t < 30 && !h.ruin; t += dt) {
    p.st = 100; cs.dragon.hunger = 20;                          // keep the fire bar and the belly full for the test
    for (const e of S.step(cs, { breath: true, sx: 0, sy: 0 }, dt)) evs.push(e);
  }
  ok(evs.some(e => e.e === 'building:burning' && e.id === h.id), 'state: the breath sets the house alight');
  ok(h.ruin, 'state: the house burns down');
  ok(cs.stats.civilBurned >= 1 && cs.stats.orderBurned === 0, 'stats.civilBurned counts a house (' + cs.stats.civilBurned + ')');
  ok(cs.regionStates.farm.ruins.some(r => r.id === h.id && r.at === h.ruinAt), 'region state keeps the ruin with its time');
  const raw = JSON.parse(JSON.stringify(SV.serialise(cs)));
  ok(raw.regions.farm.ruins.some(r => r.id === h.id), 'saved: regions.farm.ruins');
  ok(raw.stats.civilBurned === cs.stats.civilBurned, 'saved: stats.civilBurned');
  const back2 = SV.deserialise(raw, mulberry(3));
  const h2 = S.ensureTown(back2).buildings.find(b => b.id === h.id);
  ok(h2.ruin && back2.stats.civilBurned === cs.stats.civilBurned, 'loaded: the house is still a ruin, stats kept');
  // leaving and coming back keeps the ruin; after fire.rebuild of play it stands again and the region state forgets it
  cs.region = 'wild'; S.ensureTown(cs); cs.region = 'farm';
  ok(S.ensureTown(cs).buildings.find(b => b.id === h.id).ruin, 'region change and back: still a ruin');
  cs.stats.played = h.ruinAt + FI.rebuild + 1;
  p.pos = [x, p.pos[1], z - 30];
  const ev2 = S.step(cs, {}, dt);
  ok(ev2.some(e => e.e === 'building:rebuilt' && e.id === h.id), 'state: rebuilt after fire.rebuild s of play');
  ok(!cs.regionStates.farm.ruins.some(r => r.id === h.id), 'region state prunes the rebuilt house');
  const v1 = SV.blank(); v1.regions = { farm: { ruins: [{ id: 'farm.hamlet.barn1', at: 5 }, { id: 'wild.hamlet.barn1', at: 5 }, { id: 3 }] } };
  const cs3 = SV.deserialise(v1, mulberry(1));
  ok(cs3.regionStates.farm.ruins.length === 1 && cs3.stats.civilBurned === 0, 'load filters bad ruin entries; old saves have no burn stats -> 0');
}
