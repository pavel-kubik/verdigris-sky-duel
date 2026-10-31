// Save v2 (Phase 2 T22, 002_task_kingdom.md 5.9): a reload restores gold, upgrades, alert, ruins, taken loot,
// discovered places, the clock, a landed dragon (also on a roof) and a dragon inside the cave; v1 saves (phase 1 and
// the phase 2 v1 shape) migrate; corrupt v2 saves are reported like v1 ones; autosave on landing and entering the cave.
'use strict';
const { ok, near, core } = require('./harness.js');
const S = core('state'), SV = core('save'), T = core('terrain'), D = core('data'), F = core('flight'), SE = core('settlement'),
  WK = core('walk'), CK = core('clock'), AL = core('alert'), LR = core('lair');
const { mulberry } = core('math');
const dt = 1 / 60;

function mem() {
  const m = {};
  return { m, getItem: k => (k in m ? m[k] : null), setItem: (k, v) => { m[k] = String(v); }, removeItem: k => { delete m[k]; } };
}
const roundTrip = (cs, seed) => { const st = mem(); ok(SV.store(st, cs), 'stored'); const r = SV.load(st); ok(r.status === 'ok', 'loads ok'); return { back: SV.deserialise(r.data, mulberry(seed || 7)), raw: JSON.parse(st.m[D.saveKey]) }; };

/** A dry spot on open ground in the Farmlands, away from buildings and water. */
function dryGround(cs) {
  const town = S.ensureTown(cs);
  for (let x = -600; x <= 600; x += 37) for (let z = -600; z <= 600; z += 41) {
    if (T.liquidAt('farm', x, z) || SE.solidAt(town, x, z, 20) != null) continue;
    if (T.surfaceSlope('farm', x, z) > 0.2) continue;
    return [x, z];
  }
  throw new Error('no dry ground');
}

// 1. A Drake landed in the Farmlands with gold, upgrades, alert, ruins, taken loot, discovered places and a dusk clock
{
  const cs = S.create({ regionId: 'farm', rng: mulberry(3) });
  const d = cs.dragon;
  Object.assign(d, { stage: 1, foodXp: 1200, hp: 180, hunger: 40 });
  cs.stats.played = 5200;
  const [x, z] = dryGround(cs);
  d.pilot = F.newPilot([x, T.surfaceAt('farm', x, z) + 40, z], 2.0, 30);
  d.pilot.mode = 'ground'; d.pilot.speed = 0;
  d.pilot.pos[1] = WK.standY({ regionId: 'farm', solidAt: S.solids(cs, S.scaleOf(cs)).solidAt }, x, z, S.scaleOf(cs));
  cs.hoard.gold = 320;
  cs.upgrades = ['iron_scales_1', 'prey_sense'];
  cs.discovered = { 'farm.outpost': true, 'farm.village': true };
  cs.regionStates.farm = { heat: 2.4, lastIncident: 5120, at: 5150, ruins: [{ id: 'farm.outpost.tower1', at: 5000 }], lootTaken: [{ id: 'farm.outpost.vault1.strongbox', at: 5100 }] };
  cs.stats.civilBurned = 3; cs.stats.orderBurned = 5; cs.stats.livestockTaken = 2;
  CK.setPhase(cs, 'dusk');
  const { back, raw } = roundTrip(cs, 11);

  ok(raw.version === 2 && raw.world.mode === 'ground' && raw.world.location === 'field', 'v2: mode ground, location field');
  near(raw.world.clock, D.clock.dusk, 1e-4, 'clock saved'); near(raw.world.now, 5200, 0.1, 'now = played');
  ok(raw.hoard.gold === 320 && raw.dragon.upgrades.length === 2, 'gold and upgrades in the save');
  ok(raw.regions.farm.heat === 2.4 && raw.regions.farm.ruins.length === 1 && raw.regions.farm.lootTaken.length === 1 && raw.regions.farm.discovered.length === 2, 'region state in the save');

  ok(back.hoard.gold === 320, 'gold restored');
  ok(back.upgrades.join() === 'iron_scales_1,prey_sense', 'upgrades restored');
  ok(back.discovered['farm.outpost'] && back.discovered['farm.village'] && !back.discovered['farm.hamlet'], 'discovered places restored');
  const rs = back.regionStates.farm;
  ok(rs.ruins[0].id === 'farm.outpost.tower1' && rs.lootTaken[0].id === 'farm.outpost.vault1.strongbox', 'ruins and taken loot restored');
  ok(AL.level(rs) === 2, 'alert level 2 restored (heat 2.4, the 50 s since the last incident are inside quiet)');
  const tower = back.town.buildings.find(b => b.id === 'farm.outpost.tower1');
  ok(tower && tower.ruin, 'the burned tower is a ruin in the rebuilt town');
  ok(back.town.items.find(i => i.id === 'farm.outpost.vault1.strongbox').taken, 'the taken strongbox is not back yet');
  ok(back.stats.civilBurned === 3 && back.stats.orderBurned === 5 && back.stats.livestockTaken === 2, 'raid stats restored');
  near(back.clock.t, D.clock.dusk, 1e-4, 'clock restored'); ok(CK.phase(back.clock.t) === 'dusk' && back.light < 1, 'dusk light restored');

  const p = back.dragon.pilot;
  ok(p.mode === 'ground' && p.speed === 0 && p.tr === null, 'restored standing on the ground');
  near(p.pos[0], x, 0.01, 'x'); near(p.pos[2], z, 0.01, 'z'); near(p.yaw, 2.0, 1e-4, 'yaw');
  near(p.pos[1], T.surfaceAt('farm', x, z) + D.walk.stand * S.scaleOf(back), 0.05, 'standing height over the ground');
  // it walks on and takes off normally after the load
  for (let i = 0; i < 30; i++) S.step(back, { sx: 0, sy: 1 }, dt);
  ok(back.dragon.pilot.mode === 'ground' && Math.hypot(back.dragon.pilot.pos[0] - x, back.dragon.pilot.pos[2] - z) > 0.1, 'walks after the load');
  S.step(back, { sx: 0, sy: 0, land: true }, dt);
  for (let i = 0; i < 300; i++) S.step(back, { sx: 0, sy: 0 }, dt);
  ok(back.dragon.pilot.mode === 'air', 'Fly after the load takes off');
}

// 2. Landing saves as ground, takeoff as air, a ground save over water restores in the air
{
  const cs = S.create({ regionId: 'farm', rng: mulberry(5) });
  const [x, z] = dryGround(cs);
  cs.dragon.pilot = F.newPilot([x, T.surfaceAt('farm', x, z) + 6, z], 0, 30);
  cs.dragon.pilot.mode = 'landing';
  ok(SV.serialise(cs).world.mode === 'ground', 'landing saves as ground');
  cs.dragon.pilot.mode = 'takeoff';
  ok(SV.serialise(cs).world.mode === 'air', 'takeoff saves as air');
  cs.dragon.pilot.mode = 'air';
  ok(SV.serialise(cs).world.mode === 'air', 'air saves as air');

  let wx = null, wz = null;
  for (let x1 = -600; x1 <= 600 && wx == null; x1 += 9) for (let z1 = -600; z1 <= 600; z1 += 9) if (T.liquidAt('farm', x1, z1)) { wx = x1; wz = z1; break; }
  ok(wx != null, 'found water in the Farmlands');
  const o = SV.serialise(cs);
  o.world.pos = [wx, 30, wz]; o.world.mode = 'ground';
  const back = SV.deserialise(JSON.parse(JSON.stringify(o)), mulberry(2));
  ok(back.dragon.pilot.mode === 'air', 'a ground save over water restores in the air');
}

// 3. Standing on a roof: restored on the roof, not inside the building
{
  const cs = S.create({ regionId: 'farm', rng: mulberry(8) });
  const b = cs.town.buildings.find(q => q.type === 'house' && !q.seg);
  const o = SV.serialise(Object.assign(cs, {}));
  o.world.pos = [b.pos[0], b.pos[1] + 30, b.pos[2]]; o.world.mode = 'ground'; o.world.yaw = 0;
  const back = SV.deserialise(JSON.parse(JSON.stringify(o)), mulberry(4));
  const roof = SE.solidAt(back.town, b.pos[0], b.pos[2], D.settlement.pad * S.scaleOf(back));
  ok(roof != null && back.dragon.pilot.mode === 'ground', 'on the roof, on the ground mode');
  near(back.dragon.pilot.pos[1], roof + D.walk.stand * S.scaleOf(back), 0.05, 'standing on the roof');
}

// 4. Inside the cave: location cave, restored on the nest; the mouth is the saved position
{
  const cs = S.create({ regionId: 'ash', rng: mulberry(9) });
  cs.dragon.pilot = F.newPilot(LR.mouthPos('ash').slice(), 0, 30);
  const ev = LR.enter(cs, 'tunnel');
  ok(cs.inLair && ev.some(e => e.e === 'lair:enter'), 'in the cave');
  CK.setPhase(cs, 'night');
  const { back, raw } = roundTrip(cs, 3);
  ok(raw.world.location === 'cave' && raw.world.mode === 'air', 'saved as cave');
  ok(back.inLair && back.station === 'nest' && back.dragon.pilot.mode === 'ground', 'restored in the cave on the nest');
  ok(CK.phase(back.clock.t) === 'night', 'night outside restored');
}

// 5. Migration: a phase 2 v1 save (written before T22) keeps everything; the cave becomes 'cave'
{
  const v1 = {
    version: 1,
    dragon: { growth: 0.4, stage: 1, foodXp: 900, hp: 160, hunger: 55, deaths: 1, upgrades: ['guard_sight', 'nope', 'guard_sight'], loot: { id: 'farm.village.taxhouse1.tithe', kind: 'tithe', region: 'farm' } },
    hoard: { gold: 150, relics: [] }, larder: [{ prey: 'boar', food: 20 }], renown: 0,
    regions: { farm: { discovered: ['farm.village'], heat: 1.5, lastIncident: 3000, at: 3000, ruins: [{ id: 'farm.village.house2', at: 2990 }] }, wild: {}, ash: {} },
    missions: { completed: [], active: null }, story: { act: 1, mother: null },
    world: { region: 'ash', pos: LR.mouthPos('ash'), yaw: 1, st: 80, location: 'lair' },
    flags: { introSeen: true, rested: 2 }, stats: { played: 3100, eaten: 30, food: 900, civilBurned: 1 },
  };
  const st = mem(); st.setItem(D.saveKey, JSON.stringify(v1));
  const r = SV.load(st);
  ok(r.status === 'ok' && r.data.version === 2, 'v1 loads as v2');
  const w = r.data.world;
  ok(w.location === 'cave' && w.mode === 'air' && w.clock === D.clock.start && w.now === 3100, 'v1 -> v2 world defaults (cave, air, morning, now)');
  const back = SV.deserialise(r.data, mulberry(1));
  ok(back.inLair && back.station === 'nest', 'v1 lair save restores in the cave');
  ok(back.hoard.gold === 150 && back.upgrades.join() === 'guard_sight' && back.carriedLoot && back.carriedLoot.kind === 'tithe', 'v1 hoard, upgrades and carried loot kept');
  ok(back.regionStates.farm.heat === 1.5 && back.regionStates.farm.ruins.length === 1 && back.discovered['farm.village'], 'v1 region states kept');
  near(back.clock.t, D.clock.start, 1e-9, 'v1 run starts in the morning');
  ok(back.stats.civilBurned === 1 && back.flags.rested === 2, 'stats and flags kept');
}

// 6. Migration: a phase 1 v1 save (no hoard, no regions) and a v0 save
{
  const p1 = { version: 1, dragon: { stage: 0, foodXp: 120, hp: 90, hunger: 30, deaths: 0 }, larder: [], world: { region: 'wild', pos: [50, 80, -40], yaw: 0.5, location: 'field' }, flags: { introSeen: true }, stats: { played: 600, eaten: 4, food: 120 } };
  const o = SV.migrate(JSON.parse(JSON.stringify(p1)));
  ok(o.version === 2 && o.hoard && o.regions && Array.isArray(o.dragon.upgrades) && o.world.mode === 'air' && o.world.location === 'field', 'phase 1 save migrates with v2 defaults');
  const back = SV.deserialise(o, mulberry(2));
  ok(back.hoard.gold === 0 && back.upgrades.length === 0 && back.region === 'wild' && back.dragon.pilot.mode === 'air', 'gold 0, no upgrades, in the air');
  const v0 = SV.migrate({ stage: 0, xp: 50, hp: 80, hunger: 40, region: 'ash', pos: [0, 90, 0] });
  ok(v0.version === 2 && v0.world.mode === 'air' && v0.world.location === 'field', 'v0 migrates to v2');
}

// 7. Corrupt v2 saves are reported (never thrown) and newer ones too
{
  const cs = S.create({ regionId: 'wild', rng: mulberry(4) });
  cs.dragon.pilot = F.newPilot([0, 90, 0], 0, 30);
  const good = SV.serialise(cs);
  const bad = [
    ['mode', o => { o.world.mode = 'swim'; }], ['location', o => { o.world.location = 'moon'; }],
    ['clock missing', o => { delete o.world.clock; }], ['clock out of range', o => { o.world.clock = 3; }],
    ['clock text', o => { o.world.clock = 'noon'; }], ['now', o => { o.world.now = 'x'; }],
    ['gold', o => { o.hoard.gold = 'lots'; }], ['regions', o => { o.regions = [1]; }], ['dragon', o => { delete o.dragon; }],
    ['hp', o => { o.dragon.hp = null; }],
  ];
  for (const [what, f] of bad) {
    const o = JSON.parse(JSON.stringify(good)); f(o);
    const st = mem(); st.setItem(D.saveKey, JSON.stringify(o));
    const r = SV.load(st);
    ok(r.status === 'corrupt' && typeof r.raw === 'string', 'corrupt v2 (' + what + ') reported as corrupt with the raw text kept');
  }
  const st = mem(); st.setItem(D.saveKey, '{"version":2,"dragon":');
  ok(SV.load(st).status === 'corrupt', 'cut off JSON is corrupt');
  st.setItem(D.saveKey, JSON.stringify(Object.assign({}, good, { version: 3 })));
  ok(SV.load(st).status === 'newer', 'v3 is newer');
}

// 8. Autosave on landing and on entering the cave (both are kept by v2)
{
  const cs = S.create({ regionId: 'farm', rng: mulberry(6) });
  const [x, z] = dryGround(cs);
  cs.dragon.pilot = F.newPilot([x, T.surfaceAt('farm', x, z) + 8, z], 0, 30);
  cs.saveT = 0;
  let saves = [];
  S.step(cs, { sx: 0, sy: 0, land: true }, dt);
  for (let i = 0; i < 600 && cs.dragon.pilot.mode !== 'ground'; i++) saves = saves.concat(S.step(cs, { sx: 0, sy: 0 }, dt).filter(e => e.e === 'save'));
  ok(cs.dragon.pilot.mode === 'ground', 'landed');
  ok(saves.some(e => e.why === 'landed'), 'autosave on landing');

  const ca = S.create({ regionId: 'ash', rng: mulberry(6) });
  const m = LR.mouthPos('ash');
  ca.dragon.pilot = F.newPilot([m[0], m[1], m[2] + 20], Math.PI, 30);
  let inSaves = [];
  for (let i = 0; i < 240 && !ca.inLair; i++) inSaves = inSaves.concat(S.step(ca, { sx: 0, sy: 0, enter: true }, dt).filter(e => e.e === 'save'));
  if (ca.inLair) ok(inSaves.some(e => e.why === 'cave' || e.why === 'region'), 'autosave on entering the cave');
  else { const ev = S.autosave(ca, LR.enter(ca, 'tunnel'), 0); ok(ev.some(e => e.e === 'save' && e.why === 'cave'), 'autosave on entering the cave'); }
}
