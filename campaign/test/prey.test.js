// Prey: herds spawn on valid ground, graze, scatter from a low dragon (range scales with its size),
// boars charge and only hit a dragon flying below their reach, empty herds respawn away from the dragon.
'use strict';
const { ok, core } = require('./harness.js');
const P = core('prey'), T = core('terrain'), D = core('data'), { mulberry, dist2 } = core('math');
const dt = 1 / 30;
const statsOf = spot => ({ spot });
const sky = (x, z, alt, regionId) => [x, T.surfaceAt(regionId || 'wild', x, z) + alt, z];
const run = (field, dragon, secs, ctx) => { const ev = []; for (let i = 0; i < secs / dt; i++) ev.push(...P.step(field, dragon, dt, ctx)); return ev; };
const farAway = regionId => ({ pos: sky(0, 0, 250, regionId), inv: 0 });   // high above the centre: no threat

// 1. Spawning: herds per region data, all on valid ground, deterministic per seed, capped
for (const regionId of Object.keys(D.regions)) {
  const a = P.spawnRegion(regionId, mulberry(5)), b = P.spawnRegion(regionId, mulberry(5));
  ok(a.list.length > 0 && a.list.length <= D.preyAi.maxActive, 'prey spawned and capped: ' + regionId + ' ' + a.list.length);
  ok(JSON.stringify(a.list.map(p => p.pos)) === JSON.stringify(b.list.map(p => p.pos)), 'deterministic for a seed: ' + regionId);
  const types = new Set(D.regions[regionId].herds.map(h => h.type));
  a.list.forEach(p => {
    ok(types.has(p.type), 'prey type comes from the region herds');
    ok(P.groundOk(regionId, p.pos[0], p.pos[2]) && Math.abs(p.pos[1] - T.surfaceAt(regionId, p.pos[0], p.pos[2])) < 1e-9, 'prey stands on valid ground');
  });
  ok(a.herds.length === D.regions[regionId].herds.reduce((n, h) => n + h.count, 0), 'every herd placed: ' + regionId);
}
{
  const ash = P.spawnRegion('ash', mulberry(9));
  ok(ash.list.every(p => p.type === 'goat'), 'Ash Wastes has only goats');
  const lair = D.regions.ash.lair, cone = D.regions.ash.terrain.features[0];
  ok(ash.list.every(p => Math.hypot(p.pos[0] - cone.x, p.pos[2] - cone.z) > cone.r * 0.95 && Math.hypot(p.pos[0] - lair.x, p.pos[2] - lair.z) > 80), 'no prey on the volcano or at the lair');
}

// 2. Grazing: undisturbed herds stay together on valid ground and raise no events
{
  const field = P.spawnRegion('wild', mulberry(3)), dragon = farAway('wild');
  const ev = run(field, dragon, 120, { stats: statsOf(1), rng: mulberry(4) });
  ok(ev.length === 0, 'no events while grazing undisturbed');
  field.list.forEach(p => {
    const h = field.herds.find(hh => hh.id === p.herd);
    ok(dist2(p.pos, [h.centre[0], 0, h.centre[1]]) < P.HERD_R * 1.6, 'grazing prey stays near its herd');
    ok(p.state === 'graze' && P.groundOk('wild', p.pos[0], p.pos[2]), 'still grazing on valid ground');
  });
  ok(field.list.some(p => p.t > 0), 'prey were updated');
}

// 3. Fleeing: a low pass makes the herd scatter away, once alarmed, then calm down and graze again
{
  const field = P.spawnRegion('wild', mulberry(21));
  const deerHerd = field.herds.find(h => h.type === 'deer'), herd = field.list.filter(p => p.herd === deerHerd.id);
  const c = deerHerd.centre, dragon = { pos: sky(c[0] + 30, c[1], 12), inv: 0 };
  const startD = herd.map(p => dist2(p.pos, dragon.pos));
  const ev = run(field, dragon, 3, { stats: statsOf(1), rng: mulberry(8) });
  ok(ev.filter(e => e.e === 'prey:flee' && e.herd === deerHerd.id).length === 1, 'one alarm per herd');
  ok(herd.every(p => p.state === 'flee'), 'the whole herd flees (panic spreads)');
  ok(herd.every((p, i) => dist2(p.pos, dragon.pos) > startD[i] + 10), 'every deer ran away from the dragon');
  ok(herd.every(p => P.groundOk('wild', p.pos[0], p.pos[2])), 'fleeing stays on valid ground (no water, no cliffs)');
  dragon.pos = sky(c[0] + 600, c[1] + 600, 200);
  run(field, dragon, 12, { stats: statsOf(1), rng: mulberry(8) });
  ok(herd.every(p => p.state === 'graze') && !deerHerd.alarmed, 'calm again once the dragon is gone');
}

// 4. Flee range scales with the dragon's spot factor: a drake scares deer from further away
{
  const deer = D.prey.deer, mk = () => { const f = P.spawnRegion('wild', mulberry(21)); const h = f.herds.find(hh => hh.type === 'deer'); return { f, h }; };
  const between = deer.fleeRange * 1.25;          // outside a hatchling's range, inside a drake's (x1.5)
  for (const [spot, expect] of [[D.stages[0].spot, false], [D.stages[1].spot, true]]) {
    const { f, h } = mk();
    // place the dragon so the nearest deer is exactly `between` away
    const near = f.list.filter(p => p.herd === h.id);
    const dir = [1, 0], far = near.reduce((m, p) => Math.max(m, p.pos[0]), -Infinity);
    const dragon = { pos: sky(far + between, near.find(p => p.pos[0] === far).pos[2], 15), inv: 0 };
    const ev = run(f, dragon, 0.5, { stats: statsOf(spot), rng: mulberry(2) });
    ok(ev.some(e => e.e === 'prey:flee' && e.herd === h.id) === expect, 'spot ' + spot + ' -> flee ' + expect);
    void dir;
  }
}

// 5. A dragon high above is not a threat, even directly overhead
{
  const field = P.spawnRegion('wild', mulberry(21)), h = field.herds.find(hh => hh.type === 'deer');
  const ev = run(field, { pos: sky(h.centre[0], h.centre[1], P.ALARM_ALT + 15), inv: 0 }, 5, { stats: statsOf(1.5), rng: mulberry(2) });
  ok(!ev.some(e => e.e === 'prey:flee'), 'no alarm from a high dragon');
}

// 6. Boars charge a low dragon and hit only when it is within their reach; cooldown spaces the hits; a roll dodges
{
  const charge = D.prey.boar.charge;
  const setup = () => { const f = P.spawnRegion('wild', mulberry(33)); const b = f.list.find(p => p.type === 'boar'); return { f, b }; };
  // a dragon skimming 5 above the boar, hovering just ahead of it
  {
    const { f, b } = setup();
    const dragon = { pos: [b.pos[0] + 6, b.pos[1] + 5, b.pos[2]], inv: 0 };
    let hits = 0, firstHitAt = -1;
    for (let i = 0; i < 12 / dt; i++) {
      dragon.pos[1] = b.pos[1] + 5;                                       // keep it right above the ground near the boar
      const ev = P.step(f, dragon, dt, { stats: statsOf(1), rng: mulberry(1) });
      for (const e of ev) if (e.e === 'boar:hit') { hits++; if (firstHitAt < 0) firstHitAt = i * dt; ok(e.damage === charge.damage, 'boar damage from data'); }
    }
    ok(b.state === 'charge', 'boar charges a low dragon');
    ok(hits >= 2 && hits <= Math.ceil(12 / charge.cooldown) + 1, 'boar hits repeatedly but no faster than its cooldown: ' + hits);
  }
  // the same dragon 12 above the boar: charged at, never hit
  {
    const { f, b } = setup();
    const dragon = { pos: [b.pos[0] + 6, 0, b.pos[2]], inv: 0 };
    let hits = 0;
    for (let i = 0; i < 12 / dt; i++) {
      dragon.pos[1] = b.pos[1] + charge.maxAboveGround + 5;
      for (const e of P.step(f, dragon, dt, { stats: statsOf(1), rng: mulberry(1) })) if (e.e === 'boar:hit') hits++;
    }
    ok(hits === 0, 'a dragon above the boar\'s reach is never hit');
  }
  // invulnerable (barrel roll): the charge misses
  {
    const { f, b } = setup();
    const dragon = { pos: [b.pos[0] + 4, b.pos[1] + 4, b.pos[2]], inv: 1 };
    const ev = run(f, dragon, 2, { stats: statsOf(1), rng: mulberry(1) });
    ok(!ev.some(e => e.e === 'boar:hit') && ev.some(e => e.e === 'boar:miss'), 'a rolling dragon is not hit');
  }
  // goats and deer never fight
  ok(!D.prey.goat.fights && !D.prey.deer.fights, 'only boars fight');
}

// 7. Far animals still move (low tick rate), near ones every step
{
  const field = P.spawnRegion('wild', mulberry(44));
  const dragon = { pos: sky(0, 0, 30), inv: 0 };
  const far = field.list.find(p => dist2(p.pos, dragon.pos) > D.preyAi.fullRange);
  ok(!!far, 'there is a far animal');
  const t0 = far.t;
  run(field, dragon, 5, { stats: statsOf(1), rng: mulberry(4) });
  ok(far.t > t0 + 4.5, 'far animals keep simulating at the low rate');
}

// 8. Emptied herds respawn after the cooldown, away from the dragon
{
  const field = P.spawnRegion('wild', mulberry(55));
  const h = field.herds.find(hh => hh.type === 'deer');
  const dragon = { pos: sky(h.centre[0], h.centre[1], 40), inv: 0 };
  field.list.filter(p => p.herd === h.id).forEach(p => ok(P.remove(field, p.id), 'remove prey'));
  ok(!P.remove(field, -1), 'removing an unknown id is a no-op');
  const ev1 = run(field, dragon, D.respawn.herdCooldown - 2, { stats: statsOf(1), rng: mulberry(6) });
  ok(!ev1.some(e => e.e === 'herd:respawn' && e.herd === h.id) && !field.list.some(p => p.herd === h.id), 'no respawn before the cooldown');
  const ev2 = run(field, dragon, 4, { stats: statsOf(1), rng: mulberry(6) });
  ok(ev2.some(e => e.e === 'herd:respawn' && e.herd === h.id), 'herd respawns after the cooldown');
  const back = field.list.filter(p => p.herd === h.id);
  ok(back.length >= D.prey.deer.herd[0], 'respawned herd has members');
  ok(Math.hypot(h.centre[0] - dragon.pos[0], h.centre[1] - dragon.pos[2]) >= D.respawn.minDistFromDragon, 'respawned away from the dragon');
}

// 9. Ten minutes with a dragon wandering low across Wildwood: finite, on valid ground, bounded count
{
  const field = P.spawnRegion('wild', mulberry(77)), rng = mulberry(78);
  const dragon = { pos: sky(0, 0, 20), inv: 0 };
  let yaw = 0, flees = 0, hits = 0;
  for (let i = 0; i < 600 / dt; i++) {
    if (i % 90 === 0) yaw += (rng() - 0.5) * 2;
    dragon.pos[0] += Math.sin(yaw) * 30 * dt; dragon.pos[2] += Math.cos(yaw) * 30 * dt;
    const r = Math.hypot(dragon.pos[0], dragon.pos[2]);
    if (r > 900) { yaw = Math.atan2(-dragon.pos[0], -dragon.pos[2]); }
    dragon.pos[1] = T.surfaceAt('wild', dragon.pos[0], dragon.pos[2]) + 6 + 30 * (0.5 + 0.5 * Math.sin(i * dt * 0.2));
    for (const e of P.step(field, dragon, dt, { stats: statsOf(1), rng })) { if (e.e === 'prey:flee') flees++; if (e.e === 'boar:hit') hits++; }
    if (i % 300 === 0) {
      ok(field.list.length <= D.preyAi.maxActive, 'prey count bounded');
      field.list.forEach(p => ok(p.pos.every(Number.isFinite) && P.groundOk('wild', p.pos[0], p.pos[2]), 'prey finite and on valid ground'));
    }
  }
  ok(flees > 3, 'herds were scattered during the wander: ' + flees);
  const c = P.census(field);
  ok(c.total === field.list.length, 'census counts every prey');
}
