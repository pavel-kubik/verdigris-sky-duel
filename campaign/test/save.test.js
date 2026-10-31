// Save (T14): serialise / load round trip restores region, position, stage, XP, hunger, larder; autosave triggers;
// migration from a fake v0; corrupt and newer saves are reported, never thrown; storage errors are swallowed.
'use strict';
const { ok, near, core } = require('./harness.js');
const S = core('state'), SV = core('save'), T = core('terrain'), D = core('data'), F = core('flight'), LR = core('lair'), G = core('growth');
const { mulberry } = core('math');
const dt = 1 / 60;

function mem() {
  const m = {};
  return { m, getItem: k => (k in m ? m[k] : null), setItem: (k, v) => { m[k] = String(v); }, removeItem: k => { delete m[k]; } };
}
const broken = { getItem() { throw new Error('denied'); }, setItem() { throw new Error('quota'); }, removeItem() { throw new Error('denied'); } };

// 1. Mid-flight in Wildwood: store, load into a new state, everything durable comes back
{
  const cs = S.create({ regionId: 'wild', rng: mulberry(4) });
  const d = cs.dragon;
  d.pilot = F.newPilot([120, T.surfaceAt('wild', 120, -340) + 60, -340], 1.2, 30);
  d.pilot.st = 42;
  Object.assign(d, { stage: 1, foodXp: 812.5, hp: 150, hunger: 64.25, deaths: 2 });
  cs.larder.push({ type: 'deer', food: 27.4 }, { type: 'goat', food: 11 });
  cs.flags.introSeen = true; cs.stats = { played: 1240.5, eaten: 17, food: 430 };
  const prey = cs.field.list.find(q => q.type === 'deer'); prey.state = 'carried'; d.carried = prey.id;
  const st = mem();
  ok(SV.store(st, cs), 'store returns true');
  const raw = JSON.parse(st.m[D.saveKey]);
  ok(raw.version === 2 && raw.world.region === 'wild' && raw.world.location === 'field' && raw.world.mode === 'air', 'v2 shape with region, location and mode');
  ok(!('field' in raw) && !('prey' in raw) && !('pilot' in raw.dragon) && raw.world.pos.length === 3, 'no prey, pilot reduced to pos + yaw');
  ok(raw.larder[0].prey === 'deer' && raw.hoard && raw.missions && raw.story && raw.regions.ash, 'larder as {prey, food} + room for later phases');

  const res = SV.load(st);
  ok(res.status === 'ok', 'load ok');
  const back = SV.deserialise(res.data, mulberry(9));
  const b = back.dragon;
  ok(back.region === 'wild' && !back.inLair, 'region and location restored');
  near(b.pilot.pos[0], 120, 0.01, 'x'); near(b.pilot.pos[2], -340, 0.01, 'z');
  near(b.pilot.pos[1], d.pilot.pos[1], 0.01, 'height'); near(b.pilot.yaw, 1.2, 1e-4, 'yaw'); near(b.pilot.st, 42, 0.1, 'stamina');
  ok(b.stage === 1 && b.foodXp === 812.5 && b.hp === 150 && b.hunger === 64.25 && b.deaths === 2, 'stage, XP, HP, hunger, deaths');
  ok(back.larder.length === 2 && back.larder[0].type === 'deer' && Math.abs(back.larder[0].food - 27.4) < 0.01, 'larder restored');
  ok(back.flags.introSeen && back.stats.played === 1240.5 && back.stats.eaten === 17, 'flags and stats');
  ok(b.carried === null && back.field.list.length > 0 && back.field.list.every(q => q.state !== 'carried'), 'carried prey not saved, fresh herds');
  ok(back.field.list.every(q => Math.hypot(q.pos[0] - 120, q.pos[2] + 340) >= D.respawn.minDistFromDragon - 1e-6), 'herds spawn away from the restored dragon');
  // the restored state keeps flying
  for (let i = 0; i < 300; i++) S.step(back, { sx: 0.2 }, dt);
  ok(back.dragon.pilot.pos.every(Number.isFinite) && back.region === 'wild', 'restored state steps fine');
}

// 2. Saved inside the lair: wakes inside the lair; apply() keeps cs and cs.dragon identity
{
  const cs = S.create({ regionId: 'ash', rng: mulberry(2) });
  const m = LR.mouthPos('ash');
  cs.dragon.pilot = F.newPilot(m, 0, 30);
  S.step(cs, {}, dt);
  ok(cs.inLair, 'flew into the lair');
  const data = SV.migrate(JSON.parse(JSON.stringify(SV.serialise(cs))));
  const other = S.create({ regionId: 'wild', rng: mulberry(7) }), dragon = other.dragon, pilot = F.newPilot([0, 100, 0], 0, 30);
  other.dragon.pilot = pilot;
  SV.apply(other, data);
  ok(other.region === 'ash' && other.inLair, 'restored inside the lair');
  ok(other.dragon === dragon && other.dragon.pilot === pilot, 'same dragon and pilot objects (renderer references stay valid)');
  const h = other.dragon.hunger;
  for (let i = 0; i < 120; i++) S.step(other, {}, dt);
  ok(other.dragon.hunger === h, 'paused inside the lair after loading');
  S.lairLeave(other);
  ok(!other.inLair, 'can leave after loading');
}

// 3. A save without a position (blank / new game) leaves the pilot null; the client places it at the spawn
{
  const cs = S.create({ regionId: 'wild', rng: mulberry(3) });
  cs.dragon.pilot = F.newPilot([0, 100, 0], 0, 30);
  cs.dragon.stage = 1; cs.dragon.foodXp = 900; cs.larder.push({ type: 'goat', food: 5 });
  SV.apply(cs, SV.migrate(SV.blank()));
  ok(cs.dragon.pilot === null && cs.region === D.startRegion && !cs.inLair, 'blank: no pilot, start region');
  ok(cs.dragon.stage === 0 && cs.dragon.foodXp === 0 && cs.dragon.hunger === D.hunger.start && cs.larder.length === 0, 'blank: a new hatchling');
}

// 4. Out-of-range values are clamped: position inside the radius and above the ground, unknown region falls back
{
  const o = SV.blank();
  o.world.region = 'wild'; o.world.pos = [5000, -50, 0]; o.dragon.hp = 9999; o.dragon.hunger = 250; o.dragon.foodXp = 1e6;
  o.larder = [{ prey: 'goat', food: 10 }, { prey: 'dragon', food: 10 }, { prey: 'deer', food: -1 }, { prey: 'deer', food: 8 }, { prey: 'boar', food: 9 }, { prey: 'goat', food: 3 }];
  const cs = SV.deserialise(o, mulberry(1)), p = cs.dragon.pilot.pos;
  ok(Math.hypot(p[0], p[2]) <= T.region('wild').radius + 1e-6 && p[1] >= T.surfaceAt('wild', p[0], p[2]) + D.flight.minAlt - 1e-6, 'position clamped into the region');
  ok(cs.dragon.hp === G.statsOf(0).hpMax && cs.dragon.hunger === D.hunger.max && cs.dragon.foodXp === D.growthCap.food, 'HP, hunger, XP clamped');
  ok(cs.larder.length === D.lair.larderSize && cs.larder.every(it => D.prey[it.type] && it.food > 0), 'larder: unknown / empty items dropped, capped at its size');
  const z = SV.blank(); z.world.region = 'nowhere'; z.world.pos = [1, 2, 3]; z.dragon.hp = 0;
  const c2 = SV.deserialise(z, mulberry(1));
  ok(c2.region === D.startRegion && c2.dragon.pilot === null, 'unknown region: start region, spawn position');
  ok(c2.dragon.hp >= 1, 'a save at 0 HP does not die again on load');
}

// 5. Migration hook: a fake v0 (flat, unversioned) save becomes v1
{
  const v0 = { xp: 300, stage: 0, hunger: 55, hp: 70, region: 'wild', pos: [10, 90, 20], yaw: 0.5, larder: [{ type: 'boar', food: 30 }] };
  const o = SV.migrate(v0);
  ok(o.version === 2 && o.dragon.foodXp === 300 && o.world.region === 'wild' && o.larder[0].prey === 'boar', 'v0 migrated through v1 to v2');
  const cs = SV.deserialise(v0, mulberry(5));
  ok(cs.region === 'wild' && cs.dragon.foodXp === 300 && cs.dragon.hunger === 55 && Math.abs(cs.dragon.pilot.pos[0] - 10) < 1e-9 && cs.larder[0].type === 'boar', 'v0 save plays');
  ok(JSON.stringify(SV.migrate(JSON.parse(JSON.stringify(o)))) === JSON.stringify(o), 'v1 migrate is identity');
}

// 6. Corrupt and newer saves: load reports, never throws; the raw text stays for "keep"
{
  const st = mem();
  ok(SV.load(st).status === 'none', 'no save: none');
  for (const [raw, want] of [['{not json', 'corrupt'], ['42', 'corrupt'], ['[]', 'corrupt'], ['{"version":1}', 'corrupt'],
    ['{"version":1,"dragon":{"stage":0,"foodXp":"x","hp":1,"hunger":1}}', 'corrupt'],
    ['{"version":1,"dragon":{"stage":7,"foodXp":1,"hp":1,"hunger":1}}', 'corrupt'],
    ['{"version":1,"dragon":{"stage":0,"foodXp":1,"hp":1,"hunger":1},"world":{"pos":[1,"a",2]}}', 'corrupt'],
    ['{"version":-2}', 'corrupt'], ['{"version":99,"dragon":{}}', 'newer']]) {
    st.m[D.saveKey] = raw;
    const r = SV.load(st);
    ok(r.status === want && r.raw === raw && !r.data, want + ': ' + raw);
  }
  ok(SV.load(broken).status === 'none' && SV.store(broken, S.create({ rng: mulberry(1) })) === false, 'throwing storage: none / false, no exception');
  SV.clear(broken);
  st.m[D.saveKey] = 'x'; SV.clear(st);
  ok(SV.load(st).status === 'none', 'clear removes the save');
}

// 7. Autosave: every save.every s of play, on rest, on region change, on death - each once
{
  const cs = S.create({ regionId: 'ash', rng: mulberry(6) });
  cs.dragon.pilot = F.newPilot([400, 160, -400], 2, 30);
  let saves = [];
  const run = (secs, inp) => { for (let i = 0; i < secs / 0.1; i++) saves.push(...S.step(cs, inp || {}, 0.1).filter(e => e.e === 'save')); };
  run(59.5);
  ok(saves.length === 0, 'no save before 60 s');
  run(1);
  ok(saves.length === 1 && saves[0].why === 'timer', 'timer save at 60 s');
  run(60);
  ok(saves.length === 2, 'next timer save 60 s later');

  saves = [];
  cs.dragon.hp = 0;
  run(0.1);
  ok(saves.length === 1 && saves[0].why === 'death' && cs.inLair, 'save on death (wakes in the lair)');
  const ev = S.lairRest(cs);
  ok(ev.some(e => e.e === 'save' && e.why === 'rest'), 'save on rest');
  S.lairLeave(cs);

  saves = [];
  const ex = T.region('ash').exits[0], mid = (ex.angleFrom + ex.angleTo) / 2, r = T.region('ash').radius - 40;
  const x = Math.sin(mid) * r, z = Math.cos(mid) * r;
  cs.dragon.pilot = F.newPilot([x, T.surfaceAt('ash', x, z) + 50, z], mid, 30);
  run(0.3, { confirm: true });
  ok(cs.region === 'wild' && saves.length === 1 && saves[0].why === 'region', 'save on region change');
  const s2 = mem();
  ok(SV.store(s2, cs) && SV.load(s2).data.world.region === 'wild', 'the region-change save holds the new region');
}

// Story (T104): the hatching scene hands over to the mother; her lesson state survives a reload; old saves have no teacher
{
  const cs = S.create({ regionId: 'ash', rng: mulberry(21) });
  SV.apply(cs, SV.migrate(SV.blank()));
  ok(cs.story && cs.story.act === 1 && cs.story.mother === null, 'blank run: act 1, no mother yet (the hatching scene comes first)');
  LR.hatch(cs);
  cs.story.mother.lesson = 2;
  const st = mem();
  ok(SV.store(st, cs), 'store after hatch');
  const raw = JSON.parse(st.m[D.saveKey]);
  ok(raw.story.act === 1 && raw.story.mother.lesson === 2 && raw.story.mother.at === 'lair', 'story.mother serialised');
  const back = SV.deserialise(SV.load(st).data, mulberry(3));
  ok(back.story.mother && back.story.mother.lesson === 2 && back.story.mother.at === 'lair', 'mother lesson restored');
  const old = JSON.parse(st.m[D.saveKey]); old.story = { act: 1 };
  ok(SV.deserialise(SV.migrate(old), mulberry(3)).story.mother === null, 'a phase 1 save (story without mother) keeps playing without a teacher');
  const v0 = SV.deserialise(SV.migrate({ stage: 0, xp: 10, hp: 30, hunger: 50, region: 'ash', pos: [0, 120, 0] }), mulberry(3));
  ok(v0.story.act === 1 && v0.story.mother === null, 'v0 migration fills the story');
}
