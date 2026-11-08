// Freed village + tribute (Phase 3 T16, 003_task_missions.md 5.7): the Farmlands village is freed only when every
// Order building of it is burned out and its archers are dead at the same time; freed it stays: no Order rebuild,
// no archers, no alert-3 platform, calm peasants (no bell); food tribute in the larder every tribute.every s up to
// tribute.max; the freed state and the tribute survive a reload; the map shows it.
'use strict';
const { ok, near, core } = require('./harness.js');
const S = core('state'), D = core('data'), F = core('flight'), SE = core('settlement'), DF = core('defenders'), SV = core('save'),
  FR = core('freed'), MP = core('map'), LR = core('lair');
const { mulberry } = core('math');
const ID = 'farm.village';

function farm(seed) {
  const cs = S.create({ regionId: 'farm', rng: mulberry(seed || 5) });
  cs.dragon.stage = 1; cs.dragon.hp = 9999;
  cs.dragon.pilot = F.newPilot([0, 250, -900], 0, 30);
  S.step(cs, {}, 0.016);
  return cs;
}
const still = (cs, n, dt) => { const ev = []; for (let i = 0; i < n; i++) { const p = cs.dragon.pilot; p.pos = [0, 250, -900]; p.vel = [0, 0, 0]; p.speed = 0; ev.push(...S.step(cs, {}, dt)); } return ev; };
const burnDown = (cs, b) => { b.fire = 1; b.hp = 0.01; };
const archers = cs => cs.squad.list.filter(d => d.place === ID && d.kind !== 'peasant' && !d.patrol);
const freedEv = ev => ev.filter(e => e.e === 'settlement:freed');
function mem() {
  const m = {};
  return { m, getItem: k => (k in m ? m[k] : null), setItem: (k, v) => { m[k] = String(v); }, removeItem: k => { delete m[k]; } };
}

// 1. data
{
  ok(FR.freeable(ID), 'the Farmlands village can be freed');
  ok(!FR.freeable('farm.hamlet') && !FR.freeable('farm.outpost'), 'the hamlet and the outpost cannot');
  ok(D.tribute.every === 300 && D.tribute.food === 40 && D.tribute.max === 3, 'tribute numbers of the spec (5.7)');
  ok(D.prey[D.tribute.prey], 'tribute carcass is a known prey type');
  const cs = farm(1);
  const own = FR.orderOf(cs.town, ID).map(b => b.type).sort();
  ok(own.join() === 'taxhouse,tower', 'Order buildings of the village: tax house and tower (' + own + ')');
}

// 2. the rule: freed only when all Order buildings are ruins and the archers are dead
{
  const cs = farm(2);
  const tax = cs.town.buildings.find(b => b.place === ID && b.type === 'taxhouse');
  const tower = cs.town.buildings.find(b => b.place === ID && b.type === 'tower');
  ok(!FR.ready(cs.town, cs.squad, ID), 'not ready while everything stands');
  burnDown(cs, tax);
  let ev = still(cs, 3, 0.05);
  ok(tax.ruin && !freedEv(ev).length && !FR.isFreed(cs, ID), 'tax house down, tower standing: not freed');
  // archers dead but the tower standing: still not freed
  for (const d of archers(cs)) d.alive = false;
  ok(!FR.ready(cs.town, cs.squad, ID), 'archers dead, tower standing: not ready');
  for (const d of archers(cs)) d.alive = true;
  // tower down: its archers fall with it -> freed
  burnDown(cs, tower);
  ev = still(cs, 3, 0.05);
  ok(tower.ruin, 'tower burned down');
  ok(archers(cs).every(d => !d.alive), 'the tower archers fell');
  const fe = freedEv(ev);
  ok(fe.length === 1 && fe[0].place === ID && fe[0].region === 'farm', 'settlement:freed once');
  ok(FR.isFreed(cs, ID) && cs.regionStates.farm.freed.indexOf(ID) >= 0, 'saved in regionStates.farm.freed');
  ok(cs.town.places.find(p => p.id === ID).freed, 'place marked freed');
  ok(ev.some(e => e.e === 'save' && e.why === 'freed'), 'freeing autosaves');
  ev = still(cs, 3, 0.05);
  ok(!freedEv(ev).length, 'freed only once');
}

// 2b. a ballista platform standing at alert 3 must burn too; an archer alive somewhere else of the village blocks it
{
  const cs = farm(3);
  cs.regionStates.farm = { heat: 3.2, lastIncident: cs.stats.played, at: cs.stats.played };
  still(cs, 2, 0.05);
  const plat = cs.town.buildings.find(b => b.place === ID && b.type === 'platform');
  ok(plat, 'alert 3: village platform stands');
  for (const b of FR.orderOf(cs.town, ID)) if (b !== plat) burnDown(cs, b);
  let ev = still(cs, 3, 0.05);
  ok(!FR.isFreed(cs, ID) && !freedEv(ev).length, 'platform standing: not freed');
  burnDown(cs, plat);
  ev = still(cs, 3, 0.05);
  ok(FR.isFreed(cs, ID), 'platform down too: freed');
  // a live archer of the village blocks the rule (pure check)
  const town = SE.build('farm', { ruins: FR.orderOf(cs.town, ID).map(b => ({ id: b.id, at: 0 })) });
  const sq = { town, list: [{ place: ID, kind: 'archer', alive: true }] };
  ok(!FR.ready(town, sq, ID), 'a live archer of the village: not ready');
  sq.list[0].alive = false;
  ok(FR.ready(town, sq, ID), 'dead: ready');
  ok(!FR.ready(town, null, ID), 'no squad yet: not ready');
}

// 3. freed for good: no Order rebuild, no archers, no platform, calm peasants
{
  const cs = farm(4);
  FR.freeDebug(cs);
  ok(FR.isFreed(cs, ID), 'debug frees the village');
  cs.stats.played += D.fire.rebuild + 10;
  const ev = still(cs, 2, 0.05);
  ok(FR.orderOf(cs.town, ID).every(b => b.ruin), 'Order buildings stay ruins after fire.rebuild');
  ok(!ev.some(e => e.e === 'building:rebuilt' && e.place === ID && D.buildings[e.type].order), 'no Order rebuild event');
  // a civil building of the freed village still rebuilds
  const h = cs.town.buildings.find(b => b.place === ID && b.type === 'house');
  burnDown(cs, h); still(cs, 3, 0.05);
  ok(h.ruin, 'a house burned');
  cs.stats.played += D.fire.rebuild + 10;
  still(cs, 2, 0.05);
  ok(!h.ruin, 'the house is rebuilt (only the Order stays away)');
  // alert 3: the squad respawns - no archers and no platform at the freed village, the outpost still gets its archers
  cs.regionStates.farm.heat = 3.2; cs.regionStates.farm.lastIncident = cs.stats.played; cs.regionStates.farm.at = cs.stats.played;
  still(cs, 2, 0.05);
  ok(cs.town.alert3, 'alert 3 on');
  ok(!cs.town.buildings.some(b => b.place === ID && b.type === 'platform'), 'no platform at the freed village');
  ok(archers(cs).length === 0, 'no archers spawn at the freed village');
  ok(cs.squad.list.some(d => d.place === 'farm.outpost' && d.kind === 'archer' && d.alive), 'the outpost still has archers');
  // peasants of the village stay calm with the dragon right above them
  const pl = cs.town.places.find(p => p.id === ID);
  const ev2 = [];
  for (let i = 0; i < 120; i++) {
    const p = cs.dragon.pilot; p.pos = [pl.x, pl.y + 25, pl.z]; p.vel = [0, 0, 0]; p.speed = 0;
    ev2.push(...S.step(cs, {}, 0.05));
  }
  const pe = cs.squad.list.filter(d => d.place === ID && d.kind === 'peasant');
  ok(pe.length === D.settlements.village.peasants, 'the peasants are still there');
  ok(pe.every(d => d.state === 'idle'), 'they stay idle under the dragon');
  ok(!ev2.some(e => e.e === 'bell:ring' && e.place === ID), 'no bell rings at the freed village');
}

// 4. tribute: every tribute.every s, at most tribute.max waiting, never past the larder size, also in the cave
{
  const cs = farm(5);
  const R = D.tribute;
  let ev = FR.tribute(cs, R.every * 2);
  ok(!ev.length && cs.larder.length === 0, 'no tribute before any village is freed');
  FR.freeDebug(cs);
  cs.larder.length = 0; cs.tributeT = 0;
  ev = FR.tribute(cs, R.every - 1);
  ok(!ev.length, 'nothing before tribute.every');
  ev = FR.tribute(cs, 1.5);
  ok(ev.length === 1 && ev[0].e === 'tribute:arrived' && ev[0].food === R.food, 'tribute:arrived at tribute.every');
  ok(cs.larder.length === 1 && cs.larder[0].tribute && cs.larder[0].food === R.food && cs.larder[0].type === R.prey, 'a tribute carcass in the larder');
  near(cs.tributeT, 0.5, 1e-9, 'the timer keeps the remainder');
  // max waiting
  const lim = Math.min(R.max, D.lair.larderSize);
  for (let i = 0; i < 10; i++) FR.tribute(cs, R.every);
  ok(cs.larder.filter(it => it.tribute).length === lim, 'at most ' + lim + ' tribute carcasses waiting');
  ok(cs.larder.length <= D.lair.larderSize, 'never past the larder size');
  ok(cs.tributeT === R.every, 'a full larder holds the next one ready');
  // eat one: the next arrives on the next frame
  cs.inLair = true;
  LR.eatFromLarder(cs, 0);
  ev = FR.tribute(cs, 0.01);
  ok(ev.length === 1 && cs.larder.filter(it => it.tribute).length === lim, 'room again: the waiting tribute arrives at once');
  // state.step runs it in the cave too
  cs.larder.length = 0; cs.tributeT = R.every - 0.05;
  const all = [];
  for (let i = 0; i < 4; i++) all.push(...S.step(cs, {}, 0.05));
  ok(all.some(e => e.e === 'tribute:arrived'), 'tribute arrives while in the cave (state.step)');
  // spoils like any larder item
  cs.larder.length = 0; cs.larder.push({ type: R.prey, food: 1, tribute: true });
  LR.spoil(cs, D.lair.spoilEvery * 1.01);
  ok(cs.larder.length === 0, 'tribute spoils like any larder item');
}

// 5. reload: freed state, tribute carcasses and the timer
{
  const cs = farm(6);
  FR.freeDebug(cs);
  cs.larder.length = 0; cs.larder.push({ type: D.tribute.prey, food: 33, tribute: true }, { type: 'deer', food: 10 });
  cs.tributeT = 123;
  const st = mem();
  ok(SV.store(st, cs), 'stored');
  const raw = JSON.parse(st.m[D.saveKey]);
  ok(Array.isArray(raw.regions.farm.freed) && raw.regions.farm.freed[0] === ID, 'save has regions.farm.freed');
  const r = SV.load(st);
  ok(r.status === 'ok', 'loads');
  const back = SV.deserialise(r.data, mulberry(9));
  ok(FR.isFreed(back, ID), 'freed after the reload');
  ok(back.larder.length === 2 && back.larder[0].tribute && !back.larder[1].tribute, 'tribute mark kept on its carcass only');
  near(back.tributeT, 123, 0.1, 'tribute timer restored');
  back.dragon.pilot = back.dragon.pilot || F.newPilot([0, 250, -900], 0, 30);
  S.ensureTown(back);
  ok(back.town.places.find(p => p.id === ID).freed, 'the rebuilt town marks the place freed');
  ok(FR.orderOf(back.town, ID).every(b => b.ruin), 'its Order buildings load as ruins');
  // a freed id that is not freeable or of another region is dropped
  raw.regions.farm.freed = [ID, 'farm.hamlet', 'wild.x', 7];
  const back2 = SV.deserialise(raw, mulberry(9));
  ok(back2.regionStates.farm.freed.join() === ID, 'only freeable ids of the region load');
  // a save without freed / tribute (older v2) loads as not freed
  delete raw.regions.farm.freed; delete raw.world.tribute; raw.larder = [{ prey: 'deer', food: 5 }];
  const back3 = SV.deserialise(raw, mulberry(9));
  ok(!FR.isFreed(back3, ID) && back3.tributeT === 0 && !back3.larder[0].tribute, 'an older save: nothing freed, no tribute');
}

// 6. map model
{
  const cs = farm(7);
  cs.discovered[ID] = true;
  let m = MP.model(cs, 'farm');
  ok(m.places.find(p => p.id === ID).freed === false, 'map: not freed');
  FR.freeDebug(cs);
  m = MP.model(cs, 'farm');
  ok(m.places.find(p => p.id === ID).freed === true, 'map: freed');
}

// 7. debug in a region without a freeable place
{
  const cs = S.create({ regionId: 'wild', rng: mulberry(8) });
  cs.dragon.pilot = F.newPilot([0, 250, 0], 0, 30);
  S.step(cs, {}, 0.016);
  const ev = FR.freeDebug(cs);
  ok(ev.length === 1 && ev[0].e === 'freed:none', 'nothing to free in Wildwood');
}
