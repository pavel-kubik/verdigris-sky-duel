// Caravan + intercept mission (Phase 3 T15): the tithe wagon follows road 1 of the Bend over Karlsbridge to the castle
// gate, waits while the dragon is elsewhere, stops at 0 hp under the breath and drops its chest (on the deck when on the
// bridge), the chest is mission loot that meets the objective, reaching the gate fails the mission, escorts are archers
// of the squad, everything goes away when the mission ends.
'use strict';
const { ok, near, core } = require('./harness.js');
const S = core('state'), D = core('data'), T = core('terrain'), F = core('flight'), LT = core('loot'), MS = core('missions'),
  CA = core('caravan'), DF = core('defenders'), G = core('growth');
const { mulberry } = core('math');
const dt = 1 / 30;
const IN = { sx: 0, sy: 0, breath: false, boost: false, grab: false, eat: false, confirm: false, enter: false, land: false };
const ofType = (ev, name) => ev.filter(e => e.e === name);

function make(region) {
  const cs = S.create({ regionId: region || 'bend', rng: mulberry(15) });
  cs.story.act = 2;
  Object.assign(cs.dragon, { stage: 1, foodXp: D.stages[1].foodFrom, hp: D.stages[1].hp });
  cs.dragon.pilot = F.newPilot([-900, T.surfaceAt(cs.region, -900, 300) + 200, 300], 0, 20);   // far from the road, high
  S.ensureTown(cs);
  return cs;
}
function running(cs) {
  MS.accept(cs, 'a2_caravan');
  MS.step(cs, dt, []);
  return cs.mission;
}
/** A breath cone from just above and beside the wagon, pointing at it. */
function coneAt(cv) {
  const o = [cv.pos[0] + 6, cv.pos[1] + 8, cv.pos[2]], v = [cv.pos[0] - o[0], cv.pos[1] + 1.6 - o[1], cv.pos[2] - o[2]], l = Math.hypot(...v);
  return { origin: o, dir: v.map(x => x / l), range: 36, cone: D.breath.cone, target: null };
}
function distToRoad(r, x, z) {
  let best = Infinity;
  for (let i = 1; i < r.pts.length; i++) {
    const [ax, az] = r.pts[i - 1], [bx, bz] = r.pts[i], ex = bx - ax, ez = bz - az, l2 = ex * ex + ez * ez;
    const k = Math.max(0, Math.min(1, ((x - ax) * ex + (z - az) * ez) / l2));
    best = Math.min(best, Math.hypot(x - ax - ex * k, z - az - ez * k));
  }
  return best;
}

// 1. data and the route: Hradchan side -> Karlsbridge deck -> east bank -> castle gate, dry all the way
{
  const c = D.caravan.tithe, r = CA.route('tithe');
  ok(D.missions.find(m => m.id === 'a2_caravan').caravan === 'tithe', 'the intercept mission names the tithe caravan');
  ok(c.region === 'bend' && c.escort === 3 && c.chest === 'strongbox' && c.wagonHp > 0, 'tithe caravan data');
  ok(r && r.total > 600, 'road 1 of the Bend: ' + (r && r.total.toFixed(0)));
  ok(Math.hypot(r.pts[0][0] - 645, r.pts[0][1] - 0) < 80, 'starts on the Hradchan side');
  const castle = D.regions.bend.settlements.find(s => s.type === 'castle');
  ok(Math.hypot(r.pts[r.pts.length - 1][0] - castle.x, r.pts[r.pts.length - 1][1] - castle.z) < 80, 'ends at the castle gate');
  let wet = 0, deck = 0, steps = 0;
  for (let s = 0; s <= r.total; s += 4) {
    const a = DF.along(r, s);
    steps++;
    if (T.liquidAt('bend', a.x, a.z) === 'water') wet++;
    if (T.deckAt('bend', a.x, a.z)) deck++;
  }
  ok(wet === 0, 'the wagon never drives through water (' + wet + ' of ' + steps + ' samples wet)');
  ok(deck * 4 > 60, 'it crosses Karlsbridge on the deck (' + deck * 4 + ' units)');
  ok(r.total / c.speed < D.missions.find(m => m.id === 'a2_caravan').time * 0.6, 'the drive is well inside the mission time');
}

// 2. no mission: no caravan; the mission running: it spawns, sets out in its region and follows the road
{
  const cs = make();
  ok(!CA.step(cs, dt).length && !Object.keys(cs.caravans).length, 'no intercept mission: no caravan');
  MS.accept(cs, 'a2_caravan');
  ok(!ofType(CA.step(cs, dt), 'caravan:spawned').length, 'accepted but not started: no caravan yet');
  MS.step(cs, dt, []);
  ok(cs.mission.state === 'running', 'running in the Bend');
  const ev = S.step(cs, IN, dt);
  ok(ofType(ev, 'caravan:spawned').length === 1 && ofType(ev, 'caravan:departed').length === 1, 'spawned and set out');
  const cv = cs.caravans.tithe, r = CA.route('tithe'), s0 = cv.s;
  ok(cv.state === 'moving' && cv.escort.length === 3, 'moving with 3 escorts');
  for (let i = 0; i < 300; i++) S.step(cs, IN, dt);                       // 10 s
  near(cv.s - s0, D.caravan.tithe.speed * 300 * dt, 0.5, 'drives at its speed');
  ok(distToRoad(r, cv.pos[0], cv.pos[2]) < 0.5, 'on the road');
  near(cv.pos[1], T.surfaceAt('bend', cv.pos[0], cv.pos[2]), 1e-6, 'on the ground');
  const esc = cs.squad.list.filter(d => d.escort);
  ok(esc.length === 3 && esc.every(d => d.kind === 'archer' && d.alive), 'the escorts are archers of the squad');
  ok(esc.every(d => Math.hypot(d.pos[0] - cv.pos[0], d.pos[2] - cv.pos[2]) < 10), 'the escorts walk beside the wagon');
  ok(cs.danger.filter(z => esc.some(d => d.pos[0] === z.x && d.pos[2] === z.z)).length === 3, 'each escort is a danger zone (the mother keeps out)');
  const tg = MS.target(cs);
  ok(tg && tg.region === 'bend' && Math.hypot(tg.x - cv.pos[0], tg.z - cv.pos[2]) < 1e-6, 'the gold marker follows the wagon');
  // the breath kills an escort (defender AI)
  const d = esc[0];
  const o = [d.pos[0] + 4, d.pos[1] + 3, d.pos[2]], v = [d.pos[0] - o[0], d.pos[1] - o[1], d.pos[2] - o[2]], l = Math.hypot(...v);
  let killed = false;
  for (let i = 0; i < 300 && !killed; i++) killed = DF.burn(cs.squad, { origin: o, dir: v.map(x => x / l), range: 36, cone: 0.5 }, dt).some(e => e.e === 'defender:killed' && e.id === d.id);
  ok(killed && !d.alive, 'an escort burns like any archer');
}

// 3. the world elsewhere waits: the dragon in the Farmlands -> the wagon does not set out
{
  const cs = make('farm');
  running(cs);
  ok(cs.mission.state === 'running', 'running from the Farmlands (left the lair region)');
  const ev = CA.step(cs, dt);
  ok(ofType(ev, 'caravan:spawned').length === 1 && cs.caravans.tithe.state === 'waiting', 'spawned, waiting at Hradchan');
  const s0 = cs.caravans.tithe.s;
  for (let i = 0; i < 100; i++) CA.step(cs, 0.1);
  ok(cs.caravans.tithe.s === s0 && cs.caravans.tithe.state === 'waiting', 'does not drive while the dragon is in another region');
  ok(MS.target(cs) && MS.target(cs).region === 'bend', 'the marker points to the Bend');
}

// 4. stop it: 0 hp under the breath, the chest on the road, take it -> objective met -> bank -> success
{
  const cs = make();
  running(cs);
  CA.step(cs, dt);
  const cv = cs.caravans.tithe;
  for (let i = 0; i < 200; i++) CA.step(cs, dt);
  let t = 0, stopped = null;
  while (!stopped && t < 30) {
    cs.breath = coneAt(cv);
    const ev = CA.step(cs, dt);
    t += dt;
    stopped = ofType(ev, 'caravan:stopped')[0] || null;
    const mev = MS.step(cs, dt, ev);
    ok(!ofType(mev, 'mission:done').length, 'stopping alone is not the objective');
  }
  cs.breath = null;
  ok(stopped && stopped.caravan === 'tithe' && stopped.mission === 'a2_caravan', 'caravan:stopped');
  near(t, D.caravan.tithe.wagonHp / D.caravan.burn, 0.1, 'stops after wagonHp / burn s of fire');
  ok(cv.state === 'stopped' && cv.hp === 0, 'stopped at 0 hp');
  ok(MS.objective(cs).key === 'c.mission.obj.chest', 'objective line: take the chest');
  const s = cv.s;
  for (let i = 0; i < 60; i++) CA.step(cs, dt);
  ok(cv.s === s, 'a stopped wagon stays');
  const chest = cs.town.items.find(it => it.caravan === 'tithe');
  ok(chest && chest.kind === 'strongbox' && chest.mission === 'a2_caravan' && LT.available(cs.town.items).indexOf(chest) >= 0, 'the chest lies on the ground');
  ok(Math.hypot(chest.pos[0] - cv.pos[0], chest.pos[2] - cv.pos[2]) < 8, 'next to the wagon');
  ok(distToRoad(CA.route('tithe'), chest.pos[0], chest.pos[2]) < 0.5, 'on the road behind it');
  // a rebuilt town keeps the chest
  S.refreshTown(cs); CA.step(cs, dt);
  ok(cs.town.items.indexOf(chest) >= 0, 'still there after a town rebuild');
  cs.town = null; S.ensureTown(cs); CA.step(cs, dt);
  ok(cs.town.items.filter(it => it.caravan === 'tithe').length === 1, 'still there (once) after a region reload');
  // take it
  const ev = LT.take(cs, chest, cs.stats.played);
  ok(ev[0].e === 'loot:taken' && ev[0].mission === 'a2_caravan', 'loot:taken names the mission');
  ok(cs.carriedLoot.mission === 'a2_caravan', 'the chest in the claws is mission loot');
  ok(!((cs.regionStates.bend || {}).lootTaken || []).some(r => r.id === chest.id), 'not kept in lootTaken');
  ok(LT.blocksBreath(cs.carriedLoot), 'a strongbox blocks the fire');
  ok(ofType(MS.step(cs, dt, ev), 'mission:done').length === 1, 'the chest of the stopped wagon meets the objective');
  ok(MS.target(cs) === null && MS.objective(cs).key === 'c.mission.obj.home', 'then: fly home');
  ok(cs.caravans.tithe, 'the caravan stays while the mission is done');
  cs.inAerie = true;
  const bank = LT.bank(cs), done = MS.step(cs, dt, bank);
  ok(ofType(done, 'mission:success').length === 1 && cs.mission === null, 'banked in an aerie: success');
  cs.inAerie = false;
  const gone = CA.step(cs, dt);
  ok(ofType(gone, 'caravan:gone').length === 1 && !cs.caravans.tithe, 'the caravan goes with the mission');
  ok(!cs.town.items.some(it => it.caravan) && !(cs.squad && cs.squad.list.some(d => d.escort)), 'chest and escort removed');
}

// 5. a chest dropped on Karlsbridge stays on the deck
{
  const cs = make();
  running(cs);
  CA.step(cs, dt);
  const cv = cs.caravans.tithe, r = CA.route('tithe');
  let sDeck = null;
  for (let s = 0; s < r.total && sDeck == null; s += 2) { const a = DF.along(r, s), b = DF.along(r, s - D.caravan.chestBack); if (T.deckAt('bend', a.x, a.z) && T.deckAt('bend', b.x, b.z) && T.deckAt('bend', DF.along(r, s + 20).x, DF.along(r, s + 20).z)) sDeck = s + 10; }
  ok(sDeck != null, 'found the bridge on the route');
  cv.s = sDeck; cv.hp = 1;
  CA.step(cs, 0);
  let st = false;
  for (let i = 0; i < 30 && !st; i++) { cs.breath = coneAt(cv); st = ofType(CA.step(cs, dt), 'caravan:stopped').length > 0; }
  cs.breath = null;
  ok(st, 'stopped on the bridge');
  const chest = cv.chest, deck = T.deckAt('bend', chest.pos[0], chest.pos[2]);
  ok(deck, 'the chest is on the deck');
  near(chest.pos[1], deck.y, 1e-6, 'at deck height');
  ok(T.liquidAt('bend', chest.pos[0], chest.pos[2]) !== 'water', 'not in the river');
  ok(chest.pos[1] > T.waterY('bend', chest.pos[0], chest.pos[2]), 'above the water');
}

// 6. reaching the gate fails the mission; the caravan, its escort and chest go away
{
  const cs = make();
  running(cs);
  S.step(cs, IN, dt);
  const cv = cs.caravans.tithe;
  cv.s = cv.end - 1;
  let failed = null, arrived = false;
  for (let i = 0; i < 30 && !failed; i++) {
    const ev = S.step(cs, IN, dt);
    arrived = arrived || ofType(ev, 'caravan:arrived').length > 0;
    failed = ofType(ev, 'mission:failed')[0] || null;
  }
  ok(arrived, 'caravan:arrived at the gate');
  ok(failed && failed.why === 'caravan' && failed.id === 'a2_caravan', 'the mission fails (why caravan)');
  ok(cs.missions.failedAt.a2_caravan != null, 'retry after a rest');
  S.step(cs, IN, dt);
  ok(!cs.caravans.tithe && !cs.squad.list.some(d => d.escort), 'caravan and escort gone after the fail');
}

// 7. timeout with the chest in the claws: it vanishes with the caravan; death fails it too
{
  const cs = make();
  running(cs);
  CA.step(cs, dt);
  const cv = cs.caravans.tithe;
  cv.hp = 0.01;
  cs.breath = coneAt(cv); const ev = CA.step(cs, dt); cs.breath = null;
  MS.step(cs, dt, ev);
  const take = LT.take(cs, cv.chest, cs.stats.played);
  MS.step(cs, dt, take);
  ok(cs.mission.state === 'done', 'done with the chest');
  const drop = LT.drop(cs, cs.dragon.pilot.pos);
  ok(ofType(MS.step(cs, dt, drop), 'mission:undone').length === 1, 'dropping the chest undoes the objective');
  ok(!cv.chest.taken, 'the dropped chest can be taken again');
  MS.step(cs, dt, LT.take(cs, cv.chest, cs.stats.played));
  cs.mission.left = 0.01;
  const f = MS.step(cs, 0.1, []);
  ok(ofType(f, 'mission:failed')[0].why === 'timeout' && ofType(f, 'loot:vanished').length === 1 && cs.carriedLoot === null, 'timeout: the chest vanishes');
  CA.step(cs, dt);
  ok(!cs.caravans.tithe && !cs.town.items.some(it => it.caravan), 'no caravan, no chest after the fail');
  const cs2 = make();
  running(cs2);
  CA.step(cs2, dt);
  ok(ofType(MS.step(cs2, dt, [{ e: 'dragon:died' }]), 'mission:failed')[0].why === 'death', 'death fails it');
  ok(ofType(CA.step(cs2, dt), 'caravan:gone').length === 1, 'and the caravan goes');
}

// 8. timing (kinematic): a Drake arriving at the Bend's Farmlands entry reaches the wagon before the gate, stops it and
//    gets the chest to the Troyvale aerie inside the mission time with the trip from the lair (3 regions) counted
{
  const r = CA.route('tithe'), c = D.caravan.tithe, m = D.missions.find(q => q.id === 'a2_caravan');
  const cruise = G.statsOf(1).cruise, ent = D.regions.bend.entries.farm.angle, R = D.regions.bend.radius - D.travel.entryInset;
  const e = [Math.sin(ent) * R, Math.cos(ent) * R];
  // meet: the earliest t where the dragon (straight line at cruise from the entry) reaches the wagon
  let meet = null;
  for (let t = 0; t <= r.total / c.speed && meet == null; t += 0.5) { const a = DF.along(r, c.speed * t); if (Math.hypot(a.x - e[0], a.z - e[1]) <= cruise * t) meet = { t, a }; }
  ok(meet != null, 'the dragon can reach the wagon before the gate (' + (meet && meet.t) + ' s after entering)');
  const fire = c.wagonHp / D.caravan.burn, grab = 12;                    // land, take, take off
  const ae = D.aeries.bend, home = Math.hypot(meet.a.x - ae.x, meet.a.z - ae.z) / (cruise * D.loot.strongbox.carry.speedMult);
  const lairTrip = 2 * 2 * 1000 / cruise;                                  // Ash -> Wild -> Farm (about 2 region diameters), timer starts after the Ash Wastes
  const total = lairTrip + meet.t + fire + grab + home;
  ok(total < m.time, 'fits the mission time: ' + total.toFixed(0) + ' of ' + m.time + ' s');
  ok(total > 120, 'not trivial: ' + total.toFixed(0) + ' s');
}
