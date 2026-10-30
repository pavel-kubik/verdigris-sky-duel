// Fire: the breath cone cooks prey into roast chunks at half food, chunks are liftable by a hatchling,
// heat cools off outside the fire, scorched animals bolt, uneaten roast disappears.
'use strict';
const { ok, near, core } = require('./harness.js');
const S = core('state'), PR = core('prey'), F = core('flight'), T = core('terrain'), D = core('data'), { mulberry } = core('math');
const dt = 1 / 60, R = D.roast;

// a dragon 14 units behind and 5 above a prey, facing it and pitched down at it: the prey is in the cone
function aimAt(prey, back, up) {
  const x = prey.pos[0], z = prey.pos[2] - (back || 14), y = prey.pos[1] + 0.8 + (up || 5);
  const pilot = F.newPilot([x, y, z], 0, 30);
  pilot.pitch = -Math.atan2(up || 5, back || 14);
  return pilot;
}
function field1(type, seed) {
  const f = PR.spawnRegion('wild', mulberry(seed || 3));
  const p = f.list.find(q => q.type === type);
  return { f, p };
}
const burn = (f, pilot, secs, rng) => { const ev = []; for (let i = 0; i < secs / dt; i++) ev.push(...PR.cook(f, PR.breathCone(pilot, 1), dt, rng || mulberry(1))); return ev; };

// 1. Chunk counts and food: half the prey's food, split evenly in ceil(half / chunkFood) chunks
for (const [type, chunks] of [['boar', 2], ['deer', 2], ['goat', 1]]) {
  const { f, p } = field1(type);
  f.list = [p];                                                     // only the target (herd mates would roast too)
  const pilot = aimAt(p);
  ok(PR.inCone(PR.breathCone(pilot, 1), p), 'aimed prey is in the cone: ' + type);
  const n0 = f.list.length;
  const ev = burn(f, pilot, R.cookTime + 0.1);
  const roasted = ev.find(e => e.e === 'prey:roasted');
  ok(roasted && roasted.type === type && roasted.chunks === chunks, type + ' roasts into ' + chunks + ' chunk(s)');
  const made = f.list.filter(q => q.state === 'roast' && q.from === type);
  ok(made.length === chunks && f.list.length === n0 - 1 + chunks && !f.list.includes(p), 'prey replaced by its chunks: ' + type);
  near(made.reduce((a, q) => a + q.food, 0), D.prey[type].food * R.foodMult, 1e-9, 'chunks total half the food: ' + type);
  ok(made.every(q => q.size === R.chunkSize && P_ok(q)), 'chunks are small and on valid ground: ' + type);
}
function P_ok(q) { return PR.groundOk('wild', q.pos[0], q.pos[2]) && Math.abs(q.pos[1] - T.surfaceAt('wild', q.pos[0], q.pos[2])) < 1e-9; }

// 2. Not cooked before cookTime; heat cools off out of the fire; prey outside the cone is untouched
{
  const { f, p } = field1('deer');
  const pilot = aimAt(p);
  burn(f, pilot, R.cookTime * 0.6);
  ok(p.state !== 'roast' && f.list.includes(p) && p.cook > 0, 'half-cooked prey is still alive');
  ok(p.state === 'flee', 'a scorched animal bolts');
  const c = p.cook;
  for (let i = 0; i < 1 / dt; i++) PR.cook(f, null, dt, mulberry(1));
  near(p.cook, Math.max(0, c - R.cool), 1e-6, 'heat cools at roast.cool per second');
  const g = field1('goat');
  const away = aimAt(g.p); away.yaw = Math.PI;                       // facing away
  burn(g.f, away, 3);
  ok(g.p.cook === 0 && g.p.state !== 'roast', 'prey behind the dragon is not cooked');
  const far = aimAt(g.p, D.breath.range + 10, 5);
  burn(g.f, far, 3);
  ok(g.p.cook === 0, 'prey beyond breath range is not cooked');
}

// 3. Roasting sends the rest of the herd running
{
  const { f, p } = field1('deer');
  const mates = f.list.filter(q => q.herd === p.herd && q !== p);
  burn(f, aimAt(p, 6, 3), R.cookTime + 0.1);                        // close and low: hits just this one or a few
  ok(mates.filter(q => f.list.includes(q)).every(q => q.state !== 'graze'), 'surviving herd mates bolt');
}

// 4. Through the game state: a hatchling burns a boar it cannot lift, then grabs and eats a chunk
{
  const cs = S.create({ regionId: 'wild', rng: mulberry(9) });
  const boar = cs.field.list.find(q => q.type === 'boar');
  cs.field.list = [boar];
  cs.dragon.pilot = aimAt(boar, 12, 5);
  let roasted = null;
  for (let i = 0; i < 3 / dt && !roasted; i++) {
    const p = cs.dragon.pilot;
    const pp = aimAt(boar, 12, 5);                                    // hold the aim while it runs
    p.pos = pp.pos; p.pitch = pp.pitch; p.yaw = pp.yaw;
    roasted = S.step(cs, { breath: true }, dt).find(e => e.e === 'prey:roasted') || roasted;
  }
  ok(roasted && roasted.type === 'boar', 'state.step roasts a boar with the breath');
  const chunk = cs.field.list.find(q => q.state === 'roast');
  const p = cs.dragon.pilot;
  p.pos = [chunk.pos[0] - 0.3, chunk.pos[1] + 6, chunk.pos[2] - 0.3]; p.pitch = 0; p.breathing = false;
  S.step(cs, { grab: true }, dt);
  ok(cs.dragon.carried === chunk.id, 'a hatchling lifts a boar chunk');
  const xp0 = cs.dragon.foodXp;
  let eaten = null;
  for (let i = 0; i < (D.eat.time + 0.2) / dt && !eaten; i++) eaten = S.step(cs, { eat: true }, dt).find(e => e.e === 'prey:eaten') || eaten;
  ok(eaten && eaten.type === 'roast', 'roast chunk eaten');
  near(cs.dragon.foodXp - xp0, D.prey.boar.food * R.foodMult / 2, 1e-9, 'a chunk gives its share of the roast');
}

// 5. Uneaten roast goes cold and disappears after roast.life; its herd can then respawn
{
  const { f, p } = field1('goat');
  burn(f, aimAt(p), R.cookTime + 0.1);
  const chunk = f.list.find(q => q.state === 'roast');
  const dragon = { pos: [chunk.pos[0], chunk.pos[1] + 300, chunk.pos[2]], inv: 0 };
  let gone = false;
  for (let i = 0; i < (R.life + 1) / (1 / 10); i++) for (const e of PR.step(f, dragon, 1 / 10, { stats: { spot: 1 }, rng: mulberry(2) })) if (e.e === 'roast:gone' && e.id === chunk.id) gone = true;
  ok(gone && !f.list.includes(chunk), 'roast disappears after its lifetime');
}

// 6. Breath aim assist: flying level 9 above and 20 short of a deer (outside the plain cone) still roasts it
{
  const { f, p } = field1('deer');
  f.list = [p];
  const pilot = F.newPilot([p.pos[0], p.pos[1] + 0.8 + 9, p.pos[2] - 20], 0, 30);     // pitch 0
  const plain = PR.breathCone(pilot, 1);
  ok(!PR.inCone(plain, p), 'level flight: the deer is below the plain cone');
  const aimed = PR.breathCone(pilot, 1, f);
  ok(aimed.target === p.id && PR.inCone(aimed, p), 'assist bends the stream onto it');
  let roasted = false;
  for (let i = 0; i < (R.cookTime + 0.1) / dt; i++) if (PR.cook(f, PR.breathCone(pilot, 1, f), dt, mulberry(1)).some(e => e.e === 'prey:roasted')) roasted = true;
  ok(roasted, 'assisted breath roasts it');
  const side = F.newPilot([p.pos[0] - 25, p.pos[1] + 9, p.pos[2]], 0, 30);          // prey 90 degrees to the side
  ok(PR.breathCone(side, 1, PR.spawnRegion('wild', mulberry(3))).target !== p.id, 'no assist toward prey far off the heading');
}

// 7. Fire target (T05 feedback): picked up ahead (range x preview), kept while valid, the stream bends onto it,
//    progress = cook / cookTime; state.step keeps cs.fire current
{
  const { f, p } = field1('boar', 5);
  const B = D.breath;
  const q = Object.assign({}, p, { id: 9001, pos: [p.pos[0] + 6, p.pos[1], p.pos[2] + 4], cook: 0 });   // a second boar, a bit further
  f.list = [p, q];
  const far = F.newPilot([p.pos[0], p.pos[1] + 6, p.pos[2] - B.range * 1.5], 0, 30);
  const t0 = PR.fireTarget(f, far, 1, null);
  ok(t0 && t0.id === p.id && !t0.inRange, 'ahead but beyond the fire reach: target shown, not in range');
  ok(PR.fireTarget(f, F.newPilot([p.pos[0], p.pos[1] + 6, p.pos[2] - B.range * B.preview - 10], 0, 30), 1, null) === null, 'beyond the preview distance: no target');
  const near = F.newPilot([p.pos[0], p.pos[1] + 6, p.pos[2] - 15], 0, 30);
  ok(PR.fireTarget(f, near, 1, q.id).id === q.id, 'the previous target is kept while it stays a candidate');
  const cone = PR.breathCone(near, 1, f, q.id);
  ok(cone.target === q.id && PR.inCone(cone, q), 'the stream bends onto the preferred target, not the nearest');
  q.cook = R.cookTime / 2;
  ok(Math.abs(PR.fireTarget(f, near, 1, null).cook - 0.5) < 1e-9 && PR.fireTarget(f, near, 1, null).id === q.id, 'a prey that is heating up wins; progress 0.5');
  ok(PR.fireTarget(f, F.newPilot([p.pos[0] - 40, p.pos[1] + 6, p.pos[2]], 0, 30), 1, null) === null, 'prey off to the side is not a target');
}
{
  const cs = S.create({ regionId: 'wild', rng: mulberry(4) });
  const p = cs.field.list.find(q => q.type === 'boar');
  cs.field.list = [p]; p.held = 99;                             // keep it still for the test
  cs.dragon.pilot = aimAt(p, 16, 6);
  let maxCook = 0, roasted = false;
  for (let i = 0; i < 3 / dt && !roasted; i++) {
    const pl = cs.dragon.pilot; pl.pos = aimAt(p, 16, 6).pos; pl.yaw = 0; pl.vel = [0, 0, 0];
    const ev = S.step(cs, { sx: 0, sy: 0, breath: true }, dt);
    if (cs.fire) maxCook = Math.max(maxCook, cs.fire.cook);
    if (ev.some(e => e.e === 'prey:roasted')) roasted = true;
  }
  ok(maxCook > 0.5 && roasted, 'state.step: cs.fire progress rises while breathing until the boar roasts');
  ok(cs.fire === null || cs.fire.id !== p.id, 'a roasted prey is no longer the fire target');
}
