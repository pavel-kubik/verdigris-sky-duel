// Landing, walking and takeoff (Phase 2 T06, core/walk.js): canLand reasons, the landing / takeoff blend,
// tank-steered walking that stays on the surface and cannot climb slopes over land.maxSlope,
// and the Land / Fly one-shot through state.step and the Move slot.
'use strict';
const { ok, near, core } = require('./harness.js');
const D = core('data'), T = core('terrain'), F = core('flight'), W = core('walk'), S = core('state'), CT = core('controls');
const { mulberry } = core('math');
const dt = 1 / 60;
const stats = { turn: 1, cruise: 30, boost: 54 };

/** First grid point (scanning outward from the centre) whose slope passes the test. */
function findSpot(region, test, rMin, rMax) {
  for (let r = rMin || 200; r < (rMax || 900); r += 15) {
    for (let a = 0; a < Math.PI * 2; a += 0.1) {
      const x = Math.sin(a) * r, z = Math.cos(a) * r;
      if (!T.liquidAt(region, x, z) && test(T.surfaceSlope(region, x, z))) return [x, z];
    }
  }
  throw new Error('no spot found');
}
const flat = findSpot('wild', s => s < 0.08);
const steep = findSpot('wild', s => s > D.land.maxSlope + 0.1);
function lowPilot(region, xz, alt, speed) {
  const p = F.newPilot([xz[0], T.surfaceAt(region, xz[0], xz[1]) + alt, xz[1]], 0.3, speed);
  return p;
}
function grounded(region, xz, scale) {
  const p = lowPilot(region, xz, 6, 20);
  W.startLanding(p);
  for (let i = 0; i < 200 && p.mode !== 'ground'; i++) W.blend(p, dt, { regionId: region, scale: scale || 1 });
  return p;
}

// 1. canLand: allowed low, slow and flat; each refusal names its reason
{
  ok(F.newPilot([0, 0, 0]).mode === 'air', 'a new pilot is airborne');
  ok(W.canLand(lowPilot('wild', flat, 6, 30), 'wild').ok, 'cruising low over flat ground can land');
  ok(W.canLand(lowPilot('wild', flat, D.land.maxAlt + 2, 30), 'wild').why === 'high', 'too high: high');
  ok(W.canLand(lowPilot('wild', flat, 6, D.land.maxSpeed + 5), 'wild').why === 'fast', 'boosting: fast');
  ok(W.canLand(lowPilot('wild', flat, 6, D.stages[0].cruise), 'wild').ok && D.stages[1].cruise <= D.land.maxSpeed, 'cruise speed of every stage lands');
  ok(D.stages.every(s => s.boost > D.land.maxSpeed), 'boost speed never lands');
  ok(W.canLand(lowPilot('wild', steep, 6, 30), 'wild').why === 'steep', 'steep slope: steep');
  ok(W.canLand(lowPilot('ash', [0, 0], 6, 30), 'ash').why === 'lava', 'over the crater lava: lava');
  ok(W.canLand(lowPilot('wild', flat, 6, 30), 'wild', () => 20).why === 'roof', 'over a building solid: roof');
  D.regions.wild.water = [{ x: flat[0], z: flat[1], r: 30 }];
  ok(W.canLand(lowPilot('wild', flat, 6, 30), 'wild').why === 'water', 'over water: water');
  ok(T.liquidAt('wild', flat[0] + 40, flat[1]) === null, 'water only inside its disc');
  delete D.regions.wild.water;
  const g = grounded('wild', flat);
  ok(W.canLand(g, 'wild').why === 'busy', 'already on the ground: busy');
}

// 2. Landing: eases onto the surface in land.time, then stands still on the ground
{
  for (const scale of [1, 2.4]) {
    const p = lowPilot('wild', flat, 10, 30), ctx = { regionId: 'wild', scale };
    W.startLanding(p);
    ok(p.mode === 'landing' && !p.breathing && !p.boosting, 'landing starts, no fire or boost');
    let res = null, t = 0;
    while (!res && t < 3) { res = W.blend(p, dt, ctx); t += dt; }
    ok(res === 'landed' && p.mode === 'ground', 'landed after the blend (scale ' + scale + ')');
    near(t, D.land.time, 2 * dt, 'touchdown takes land.time');
    near(p.pos[1], T.surfaceAt('wild', p.pos[0], p.pos[2]) + D.walk.stand * scale, 1e-9, 'stands on the surface');
    ok(p.speed === 0 && p.tr === null, 'stopped, transition cleared');
    ok(!F.tryRoll(p, 1), 'no barrel roll on the ground');
  }
}

// 3. Walking stays on the surface and inside the region under random input
{
  const rng = mulberry(5), scale = 1.8, ctx = { regionId: 'wild', scale };
  const p = grounded('wild', flat, scale);
  let off = 0, inside = true, nonFinite = false;
  let inp = { sx: 0, sy: 1, boost: false };
  for (let i = 0; i < 60 * 90; i++) {
    if (i % 90 === 0) inp = { sx: rng() * 2 - 1, sy: rng() * 2 - 0.6, boost: rng() < 0.3 };
    W.step(p, inp, dt, ctx);
    off = Math.max(off, Math.abs(p.pos[1] - (T.surfaceAt('wild', p.pos[0], p.pos[2]) + D.walk.stand * scale)));
    if (Math.hypot(p.pos[0], p.pos[2]) > T.region('wild').radius) inside = false;
    if (!p.pos.every(Number.isFinite)) nonFinite = true;
  }
  ok(off < 1e-9, 'body stays stand x scale over the surface (max off ' + off + ')');
  ok(inside && !nonFinite, 'stays inside the region, finite');
  ok(p.mode === 'ground', 'walking never leaves the ground');
}

// 4. Slopes over maxSlope cannot be climbed: walking up the volcano stops on its flank
{
  const ctx = { regionId: 'ash', scale: 1 };
  const p = grounded('ash', [0, 420]);
  p.yaw = Math.PI;                                             // face the crater (-Z)
  let worst = 0, prev = p.pos.slice();
  for (let i = 0; i < 60 * 120; i++) {
    W.step(p, { sx: 0, sy: 1, boost: false }, dt, ctx);
    const run = Math.hypot(p.pos[0] - prev[0], p.pos[2] - prev[2]);
    if (run > 1e-6) worst = Math.max(worst, (T.surfaceAt('ash', p.pos[0], p.pos[2]) - T.surfaceAt('ash', prev[0], prev[2])) / run);
    prev = p.pos.slice();
  }
  ok(worst <= D.land.maxSlope + 1e-6, 'no step rises more than maxSlope (worst ' + worst.toFixed(3) + ')');
  const d = Math.hypot(p.pos[0], p.pos[2]);
  ok(d > 100, 'never reaches the crater rim (' + d.toFixed(0) + ' from the centre)');
  ok(d < 400, 'but did walk uphill toward it first');
  // downhill is always fine
  p.yaw = 0;
  const before = Math.hypot(p.pos[0], p.pos[2]);
  for (let i = 0; i < 60 * 5; i++) W.step(p, { sx: 0, sy: 1 }, dt, ctx);
  ok(Math.hypot(p.pos[0], p.pos[2]) > before + 20, 'walks back down');
}

// 5. Tank steering: turn on the spot, slow backward, run with Boost (costs stamina)
{
  const ctx = { regionId: 'wild', scale: 1 };
  const p = grounded('wild', flat);
  const x0 = p.pos.slice(), y0 = p.yaw;
  for (let i = 0; i < 60; i++) W.step(p, { sx: 1, sy: 0 }, dt, ctx);
  ok(Math.hypot(p.pos[0] - x0[0], p.pos[2] - x0[2]) < 1e-9, 'sides only: turns on the spot');
  near(Math.abs(Math.atan2(Math.sin(p.yaw - y0), Math.cos(p.yaw - y0))), D.walk.turn, 0.01, 'turns walk.turn rad in 1 s');
  for (let i = 0; i < 120; i++) W.step(p, { sx: 0, sy: 1 }, dt, ctx);
  near(p.speed, D.walk.speed, 0.2, 'walks at walk.speed');
  const st0 = p.st;
  for (let i = 0; i < 120; i++) W.step(p, { sx: 0, sy: 1, boost: true }, dt, ctx);
  near(p.speed, D.walk.run, 0.5, 'runs at walk.run with Boost');
  ok(p.st < st0 - D.walk.runSt * 1.5, 'running costs stamina');
  for (let i = 0; i < 180; i++) W.step(p, { sx: 0, sy: -1 }, dt, ctx);
  near(p.speed, -D.walk.back, 0.2, 'backs off at walk.back');
  const big = grounded('wild', flat, 2.4);
  for (let i = 0; i < 180; i++) W.step(big, { sx: 0, sy: 1 }, dt, { regionId: 'wild', scale: 2.4 });
  near(big.speed, D.walk.speed * (1 + D.walk.sizeSpeed * 1.4), 0.2, 'a bigger dragon walks faster (sizeSpeed)');
  const eat = grounded('wild', flat);
  for (let i = 0; i < 60; i++) W.step(eat, { sx: 0, sy: 1, boost: true }, dt, { regionId: 'wild', scale: 1, eating: true });
  ok(Math.abs(eat.speed) < 1e-6 && !eat.boosting, 'eating on the ground stands still');
}

// 6. Takeoff: costs stamina, ends airborne above minAlt; refused when tired
{
  const ctx = { regionId: 'wild', scale: 2 };
  const p = grounded('wild', flat, 2);
  p.st = 100;
  ok(W.startTakeoff(p, stats).ok && p.mode === 'takeoff', 'takeoff starts');
  near(p.st, 100 - D.takeoff.st, 1e-9, 'takeoff costs takeoff.st stamina');
  let res = null, t = 0;
  while (!res && t < 3) { res = W.blend(p, dt, ctx); t += dt; ok(!p.breathing, 'no fire during takeoff'); }
  ok(res === 'airborne' && p.mode === 'air', 'airborne at the end');
  near(t, D.takeoff.time, 2 * dt, 'takeoff takes takeoff.time');
  ok(F.altitude(p, 'wild') > D.flight.minAlt, 'ends above minAlt (' + F.altitude(p, 'wild').toFixed(1) + ')');
  for (let i = 0; i < 60; i++) F.step(p, { sx: 0, sy: 0 }, dt, { regionId: 'wild', stats });
  ok(F.altitude(p, 'wild') >= D.flight.minAlt - 1e-6 && p.speed > 20, 'flies on normally');
  const tired = grounded('wild', flat);
  tired.st = D.takeoff.st - 1;
  ok(W.startTakeoff(tired, stats).why === 'tired' && tired.mode === 'ground', 'too tired to take off');
  ok(W.startTakeoff(lowPilot('wild', flat, 20, 30), stats).why === 'busy', 'takeoff only from the ground');
}

// 7. Water and solids block walking; a low ledge (stepUp) can be stepped onto
{
  const p = grounded('wild', flat);
  D.regions.wild.water = [{ x: flat[0] + Math.sin(p.yaw) * 25, z: flat[1] + Math.cos(p.yaw) * 25, r: 10 }];
  for (let i = 0; i < 60 * 6; i++) W.step(p, { sx: 0, sy: 1 }, dt, { regionId: 'wild', scale: 1 });
  ok(!T.liquidAt('wild', p.pos[0], p.pos[2]), 'does not walk into water');
  delete D.regions.wild.water;
  const q = grounded('wild', flat), wallAt = q.pos[2] + Math.cos(q.yaw) * 8, dir = Math.sign(Math.cos(q.yaw));
  const wall = (x, z) => ((z - wallAt) * dir > 0 ? T.surfaceAt('wild', x, z) + 30 : null);
  for (let i = 0; i < 60 * 4; i++) W.step(q, { sx: 0, sy: 1 }, dt, { regionId: 'wild', scale: 1, solidAt: wall });
  ok((q.pos[2] - wallAt) * dir <= 1e-6, 'a tall solid blocks walking');
  const r = grounded('wild', flat), ledgeAt = r.pos[2] + Math.cos(r.yaw) * 4;
  const ledge = (x, z) => ((z - ledgeAt) * dir > 0 ? T.surfaceAt('wild', x, z) + 1 : null);
  for (let i = 0; i < 60 * 3; i++) W.step(r, { sx: 0, sy: 1 }, dt, { regionId: 'wild', scale: 1, solidAt: ledge });
  ok(r.pos[1] > T.surfaceAt('wild', r.pos[0], r.pos[2]) + D.walk.stand + 0.5, 'steps up onto a low ledge and stands on it');
}

// 8. inFront: nearest item inside reach and the cone
{
  const p = grounded('wild', flat), f = [Math.sin(p.yaw), Math.cos(p.yaw)], sd = [Math.cos(p.yaw), -Math.sin(p.yaw)];
  const at = (a, b) => ({ pos: [p.pos[0] + f[0] * a + sd[0] * b, 0, p.pos[2] + f[1] * a + sd[1] * b] });
  const near1 = at(3, 0), near2 = at(5, 0.5), behind = at(-3, 0), side = at(0.5, 4), far = at(D.ground.reach + 2, 0);
  ok(W.inFront(p, 1, [near2, near1, behind]) === near1, 'nearest item in front');
  ok(W.inFront(p, 1, [behind, side, far]) === null, 'nothing behind, to the side or out of reach');
  ok(W.inFront(p, 2, [far]) === far, 'reach grows with scale');
}

// 9. state.step: Land / Fly one-shot, events, hints and the Move slot
{
  const cs = S.create({ regionId: 'wild', rng: mulberry(3) });
  cs.field.list.length = 0;                                    // no prey: nothing else asks for the slots
  cs.dragon.pilot = lowPilot('wild', flat, 30, 30);
  let ev = S.step(cs, { sx: 0, sy: 0, land: true }, dt);
  ok(ev.some(e => e.e === 'land:refused' && e.why === 'high'), 'Land while high: refused, says why');
  cs.dragon.pilot = lowPilot('wild', flat, 6, 30);
  S.step(cs, { sx: 0, sy: 0 }, dt);
  ok(cs.landOk && cs.hint === 'land' && CT.slots(cs).move.kind === 'land', 'low and slow: the Move slot offers Land');
  ok(CT.moveInput(CT.slots(cs).move).land === true, 'a Land tap sends land');
  ev = S.step(cs, { sx: 0, sy: 0, land: true }, dt);
  ok(ev.some(e => e.e === 'dragon:landing') && cs.dragon.pilot.mode === 'landing', 'landing starts');
  let landed = false;
  for (let i = 0; i < 90; i++) for (const e of S.step(cs, { sx: 0, sy: 0 }, dt)) if (e.e === 'dragon:landed') landed = e;
  ok(landed && landed.noise === D.land.noise && cs.dragon.pilot.mode === 'ground', 'landed, with touchdown noise');
  const sl = CT.slots(cs);
  ok(sl.move.kind === 'fly' && sl.roll === false && cs.hint === 'walk', 'on the ground: Move slot Fly, no Roll, walk hint');
  for (let i = 0; i < 60; i++) S.step(cs, { sx: 0, sy: 1 }, dt);
  ok(cs.dragon.pilot.speed > 3 && cs.dragon.pilot.mode === 'ground', 'walks with the stick through state.step');
  ev = S.step(cs, { sx: 0, sy: 0, land: true }, dt);
  ok(ev.some(e => e.e === 'dragon:takeoff'), 'Fly takes off');
  let air = false;
  for (let i = 0; i < 90; i++) for (const e of S.step(cs, { sx: 0, sy: 0 }, dt)) if (e.e === 'dragon:airborne') air = true;
  ok(air && cs.dragon.pilot.mode === 'air' && CT.slots(cs).roll, 'airborne again, Roll back');
  // death on the ground wakes in the lair in the air mode
  cs.dragon.pilot = lowPilot('wild', flat, 6, 30);
  S.step(cs, { sx: 0, sy: 0, land: true }, dt);
  for (let i = 0; i < 90; i++) S.step(cs, { sx: 0, sy: 0 }, dt);
  cs.dragon.hp = 0;
  S.step(cs, { sx: 0, sy: 0 }, dt);
  ok(cs.dragon.pilot.mode === 'air' && !cs.dragon.pilot.tr, 'respawn resets the pilot mode');
}
