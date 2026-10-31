// Loot and the hoard (Phase 2 T19): tithe chests and strongboxes in front of their buildings, picked up on the ground,
// carry penalties (speed, no fire with a strongbox), banked on entering the lair, lost on death, back after fire.rebuild.
'use strict';
const { ok, near, core } = require('./harness.js');
const S = core('state'), D = core('data'), T = core('terrain'), F = core('flight'), LT = core('loot'), SE = core('settlement'), LR = core('lair'),
  SV = core('save'), CT = core('controls'), CV = core('cave'), PR = core('prey'), HN = core('hunger');
const { mulberry } = core('math');
const dt = 1 / 30;

function make(region, stage, seed) {
  const cs = S.create({ regionId: region, rng: mulberry(seed || 7) });
  cs.story.act = 2;                                            // no mother in the way
  if (stage) Object.assign(cs.dragon, { stage, foodXp: D.stages[stage].foodFrom, hp: D.stages[stage].hp });
  cs.dragon.pilot = F.newPilot([0, T.surfaceAt(region, 0, 0) + 150, 0], 0, 20);
  S.step(cs, {}, dt);
  return cs;
}
const quiet = cs => { if (cs.squad) for (const d of cs.squad.list) d.alive = false; cs.dragon.hp = 1e6; };   // no arrows in these tests
const itemOf = (cs, kind) => cs.town.items.find(it => it.kind === kind);
/** A ground pilot standing in front of the item, facing it, on the side away from its building. */
function standAt(cs, it) {
  const b = cs.town.buildings.find(q => q.id === it.building), sc = S.scaleOf(cs);
  let dx = it.pos[0] - b.pos[0], dz = it.pos[2] - b.pos[2];
  const l = Math.hypot(dx, dz); dx /= l; dz /= l;
  const f = 1.5 + D.settlement.pad * sc, x = it.pos[0] + dx * f, z = it.pos[2] + dz * f;
  const p = cs.dragon.pilot;
  Object.assign(p, { pos: [x, T.surfaceAt(cs.region, x, z) + D.walk.stand * sc, z], vel: [0, 0, 0], yaw: Math.atan2(-dx, -dz), pitch: 0, roll: 0, rollX: 0,
    speed: 0, mode: 'ground', tr: null, boosting: false, breathing: false });
}
const run = (cs, inp, secs, onEv) => { for (let t = 0; t < secs - 1e-9; t += dt) for (const e of S.step(cs, Object.assign({ sx: 0, sy: 0 }, inp), dt)) if (onEv) onEv(e); };

// 1. data as in 002 4.6
{
  ok(D.loot.tithe.size === 1 && D.loot.tithe.gold === 50 && D.loot.tithe.carry.speedMult === 0.85 && D.loot.tithe.carry.breath === true, 'tithe chest: size 1, 50 gold, x0.85, fire ok');
  ok(D.loot.strongbox.size === 2 && D.loot.strongbox.gold === 150 && D.loot.strongbox.carry.speedMult === 0.8 && D.loot.strongbox.carry.breath === false, 'strongbox: size 2, 150 gold, x0.8, no fire');
  ok(D.cave.stations.hoard[0] === 30 && D.cave.stations.hoard[1] === -8, 'hoard station at [30, -8]');
  ok(D.alert.add.loot === 1, 'taking loot adds 1 heat');
}

// 2. placement: one item per loot building, off every solid, on the ground, inside the palisade, the same every build
{
  const want = { wild: { tithe: 1, strongbox: 0 }, farm: { tithe: 1, strongbox: 1 }, ash: { tithe: 0, strongbox: 0 } };
  for (const region of Object.keys(want)) {
    const town = SE.build(region, null), items = LT.place(town, null, 0);
    for (const k of ['tithe', 'strongbox']) ok(items.filter(i => i.kind === k).length === want[region][k], region + ': ' + want[region][k] + ' ' + k);
    for (const it of items) {
      ok(town.buildings.every(o => SE.sd(o, it.pos[0], it.pos[2]).d >= (o.id === it.building ? D.loot.door - 1e-6 : D.loot.clear - 1e-6)), it.id + ' is clear of every solid');
      near(it.pos[1], T.surfaceAt(region, it.pos[0], it.pos[2]), 1e-9, it.id + ' lies on the ground');
      ok(!T.liquidAt(region, it.pos[0], it.pos[2]), it.id + ' not in water');
      const pl = town.places.find(p => p.id === it.place), ring = D.settlements[pl.type].ring;
      if (ring) ok(Math.hypot(it.pos[0] - pl.x, it.pos[2] - pl.z) < ring[0] - 2, it.id + ' inside the palisade');
      ok(!it.taken && it.id === it.building + '.' + it.kind, it.id + ' id = building + kind, not taken');
    }
    const again = LT.place(SE.build(region, null), null, 0);
    ok(JSON.stringify(again.map(i => i.pos)) === JSON.stringify(items.map(i => i.pos)), region + ': placement is deterministic');
  }
}

// 3. a Drake picks up the strongbox on the ground: the claws hold it, heat +1, the item is gone from the ground
{
  const cs = make('farm', 1); quiet(cs);
  const box = itemOf(cs, 'strongbox');
  standAt(cs, box);
  S.step(cs, {}, dt);
  ok(cs.hint === 'lootGrab' && cs.lootTarget === box.id, 'strongbox in front: lootGrab hint, it is the loot target');
  ok(CT.slots(cs).action === 'grab', 'the Action slot offers Grab');
  const heat0 = (cs.regionStates.farm && cs.regionStates.farm.heat) || 0;
  let got = null;
  run(cs, { grab: true }, dt, e => { if (e.e === 'loot:taken') got = e; });
  ok(got && got.kind === 'strongbox' && got.gold === 150, 'loot:taken strongbox 150');
  ok(cs.carriedLoot && cs.carriedLoot.id === box.id && box.taken, 'in the claws, taken from the ground');
  near(cs.regionStates.farm.heat - heat0, 1, 0.05, 'heat +1');
  ok(cs.regionStates.farm.lootTaken.some(r => r.id === box.id), 'remembered in lootTaken');
  ok(cs.hint === 'lootCarry' && CT.slots(cs).action === null, 'carry hint, no Action while loaded');
  // no prey into the same claws
  const g = Object.assign({}, cs.field.list[0], { id: cs.field.nextId++, type: 'goat', herd: -1, state: 'graze', size: 1, food: 20, hp: 20, cook: 0, pause: 99, held: 9 });
  const p = cs.dragon.pilot;
  g.pos = [p.pos[0] + Math.sin(p.yaw) * 3, p.pos[1] - 2, p.pos[2] + Math.cos(p.yaw) * 3];
  cs.field.list.push(g);
  run(cs, { grab: true }, 0.3);
  ok(cs.dragon.carried == null && g.state !== 'carried', 'a goat in front is not picked up while carrying loot');
}

// 4. carry penalties: x0.8 walking and flying with a strongbox, no fire (breath:blocked loot); a tithe chest keeps the fire
{
  const walkSpeed = loot => {
    const cs = make('farm', 1); quiet(cs);
    const it = itemOf(cs, 'strongbox'); standAt(cs, it);
    cs.dragon.pilot.yaw += Math.PI;                              // walk away from the vault
    if (loot) LT.take(cs, it, 0);
    run(cs, { sy: 1 }, 2);
    return cs.dragon.pilot.speed;
  };
  near(walkSpeed(true) / walkSpeed(false), 0.8, 0.02, 'walking with a strongbox: x0.8');
  const flySpeed = kind => {
    const cs = make('farm', 1); quiet(cs);
    if (kind) LT.take(cs, itemOf(cs, kind), 0);
    const p = cs.dragon.pilot; p.pos = [0, T.surfaceAt('farm', 0, 0) + 120, 0]; p.pitch = 0;
    run(cs, {}, 12);
    return p.speed;
  };
  const base = flySpeed(null);
  near(flySpeed('strongbox') / base, 0.8, 0.03, 'flying with a strongbox: x0.8 cruise');
  near(flySpeed('tithe') / base, 0.85, 0.03, 'flying with a tithe chest: x0.85 cruise');
  const fire = kind => {
    const cs = make('farm', 1); quiet(cs);
    LT.take(cs, itemOf(cs, kind), 0);
    let why = null;
    run(cs, { breath: true }, 0.5, e => { if (e.e === 'breath:blocked') why = e.why; });
    return { breathing: cs.dragon.pilot.breathing, why };
  };
  const sb = fire('strongbox'), tc = fire('tithe');
  ok(!sb.breathing && sb.why === 'loot', 'strongbox: no fire, breath:blocked why loot');
  ok(tc.breathing && tc.why == null, 'tithe chest: the fire still works');
  ok(LT.blocksBreath({ kind: 'strongbox' }) && !LT.blocksBreath({ kind: 'tithe' }) && !LT.blocksBreath(null), 'blocksBreath');
}

// 5. a hatchling cannot lift a strongbox but takes a tithe chest (Wildwood small outpost)
{
  const cs = make('farm', 0); quiet(cs);
  const box = itemOf(cs, 'strongbox'); standAt(cs, box);
  let heavy = null;
  run(cs, { grab: true }, dt, e => { if (e.e === 'loot:tooHeavy') heavy = e; });
  ok(heavy && heavy.kind === 'strongbox' && !cs.carriedLoot && cs.hint === 'lootHeavy', 'hatchling: strongbox too heavy (lootHeavy hint)');
  const w = make('wild', 0); quiet(w);
  const tc = itemOf(w, 'tithe'); standAt(w, tc);
  run(w, { grab: true }, dt);
  ok(w.carriedLoot && w.carriedLoot.kind === 'tithe', 'hatchling picks up the Wildwood tithe chest');
}

// 6. banking: entering the lair adds the gold and the coin pile grows a tier; loot crosses regions in the claws
{
  const cs = make('farm', 1); quiet(cs);
  LT.take(cs, itemOf(cs, 'strongbox'), cs.stats.played);
  cs.enteredRegion = null;
  S.enterRegion(cs, 'wild', [0, 200, 0], 0); S.enterRegion(cs, 'ash', [0, 200, 400], 0);
  ok(cs.carriedLoot && cs.carriedLoot.kind === 'strongbox' && cs.carriedLoot.region === 'farm', 'the strongbox stays in the claws across regions');
  ok(LT.tier(cs.hoard.gold) === 0, 'tier 0 with no gold');
  const ev = LR.enter(cs);
  const b = ev.find(e => e.e === 'hoard:banked');
  ok(b && b.gold === 150 && b.total === 150 && cs.hoard.gold === 150, 'lair.enter banks 150 gold');
  ok(b.from === 0 && b.tier === 1, 'the coin pile grows a tier (0 -> 1)');
  ok(!cs.carriedLoot && cs.stats.lootBanked === 1, 'claws empty, stats.lootBanked');
  ok(LT.tier(99) === 0 && LT.tier(100) === 1 && LT.tier(320) === 2 && LT.tier(700) === 3 && LT.tier(5000) === 4, 'tiers 0 / 100 / 300 / 700 / 1500');
  ok(LT.coins(0) === 0 && LT.coins(150) === 75 && LT.coins(1e6) === D.cave.maxCoins, 'coins = min(800, gold / 2)');
  // the hoard station in the cave
  const p = cs.dragon.pilot, h = D.cave.stations.hoard;
  p.pos[0] = h[0] - h[2] - 2; p.pos[2] = h[1];
  ok(CV.stationAt(cs) === 'hoard', 'the hoard station is in reach next to the pile');
  S.step(cs, {}, dt);
  ok(CT.slots(cs).action === 'hoard' && CT.isStation('hoard'), 'the Action slot opens the hoard panel');
  ok(CV.act(cs, 'hoard').length === 0 && cs.hoard.gold === 150, 'hoard act changes nothing');
}

// 7. death loses it; the vault refills fire.rebuild s after it was taken (not while it is still carried)
{
  const cs = make('farm', 1); quiet(cs);
  const box = itemOf(cs, 'strongbox');
  LT.take(cs, box, cs.stats.played);
  const t0 = cs.stats.played;
  cs.stats.played = t0 + D.fire.rebuild + 5;
  run(cs, {}, dt);
  ok(box.taken, 'not back while it is still in the claws');
  cs.stats.played = t0 + 10;
  cs.dragon.hp = 0;
  const ev = []; run(cs, {}, dt, e => ev.push(e));
  const died = ev.find(e => e.e === 'dragon:died'), lost = ev.find(e => e.e === 'loot:lost');
  ok(died && died.lostLoot === 'strongbox' && lost && lost.kind === 'strongbox' && !cs.carriedLoot, 'death: loot:lost, the claws are empty');
  ok(cs.hoard.gold === 0, 'nothing banked');
  // back in the Farmlands: still taken until fire.rebuild after taking it
  S.enterRegion(cs, 'farm', [0, 200, 0], 0); cs.inLair = false; quiet(cs);
  run(cs, {}, dt);
  ok(itemOf(cs, 'strongbox').taken, 'the vault is still empty');
  cs.stats.played = t0 + D.fire.rebuild + 1;
  let back = null;
  run(cs, {}, dt, e => { if (e.e === 'loot:back') back = e; });
  ok(back && back.kind === 'strongbox' && !itemOf(cs, 'strongbox').taken, 'loot:back: the vault refills after fire.rebuild');
  ok(!(cs.regionStates.farm.lootTaken || []).length, 'lootTaken pruned');
}

// 8. starving claws drop a strongbox where the dragon is; it lies there and can be picked up again
{
  const cs = make('farm', 1); quiet(cs);
  const box = itemOf(cs, 'strongbox'); standAt(cs, box);
  run(cs, { grab: true }, dt);
  ok(cs.carriedLoot, 'carrying');
  cs.dragon.hunger = 5;
  let drop = null;
  run(cs, {}, dt, e => { if (e.e === 'loot:dropped') drop = e; });
  ok(drop && !cs.carriedLoot && !box.taken, 'starving: the strongbox drops');
  ok(!(cs.regionStates.farm.lootTaken || []).some(r => r.id === box.id), 'a dropped item is no longer taken');
  near(Math.hypot(box.pos[0] - cs.dragon.pilot.pos[0], box.pos[2] - cs.dragon.pilot.pos[2]), 0, 1, 'it lies under the dragon');
}

// 9. save: gold, taken loot and loot in the claws survive a reload; a bad gold value never goes negative
{
  const cs = make('farm', 1); quiet(cs);
  cs.hoard.gold = 320;
  LT.take(cs, itemOf(cs, 'tithe'), cs.stats.played);
  const o = JSON.parse(JSON.stringify(SV.serialise(cs)));
  ok(o.hoard.gold === 320 && o.dragon.loot.kind === 'tithe' && o.regions.farm.lootTaken.length === 1, 'serialised: hoard, carried loot, lootTaken');
  const back = SV.deserialise(o, mulberry(3));
  ok(back.hoard.gold === 320 && back.carriedLoot && back.carriedLoot.kind === 'tithe' && back.carriedLoot.gold === 50, 'restored gold and loot in the claws');
  S.step(back, {}, dt);
  ok(back.town.items.find(i => i.kind === 'tithe').taken, 'the taxhouse is still empty after the reload');
  o.hoard.gold = -50; o.dragon.loot = { id: 'x', kind: 'crown', region: 'farm' };
  const bad = SV.deserialise(o, mulberry(3));
  ok(bad.hoard.gold === 0 && bad.carriedLoot === null, 'negative gold -> 0, unknown loot kind dropped');
  const blank = SV.deserialise(SV.blank(), mulberry(3));
  ok(blank.hoard.gold === 0 && blank.carriedLoot === null, 'a new run has no gold');
}

// 10. effects helper
{
  const e = LT.effects(HN.effects(80), { kind: 'strongbox' });
  ok(e.speedMult === 0.8 && e.canBreath === false, 'effects: x0.8, no fire');
  const s = LT.effects(HN.effects(5), { kind: 'tithe' });
  near(s.speedMult, D.hunger.starving.speedMult * 0.85, 1e-9, 'stacks with starving');
  ok(LT.effects(HN.effects(80), null).speedMult === 1, 'no loot: unchanged');
}
