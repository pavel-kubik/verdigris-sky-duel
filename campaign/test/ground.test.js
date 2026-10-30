// Ground actions (Phase 2 T08): pick up the prey or roast in front, eat on the ground (stands still, a boar's
// hit cancels it), breath along the ground cooks prey, and a held prey stays in the jaws through the takeoff.
'use strict';
const { ok, core } = require('./harness.js');
const D = core('data'), T = core('terrain'), F = core('flight'), W = core('walk'), S = core('state'), CT = core('controls'), PR = core('prey');
const { mulberry } = core('math');
const dt = 1 / 60;

function findFlat(region) {
  for (let r = 200; r < 900; r += 15) for (let a = 0; a < Math.PI * 2; a += 0.1) {
    const x = Math.sin(a) * r, z = Math.cos(a) * r;
    if (!T.liquidAt(region, x, z) && T.surfaceSlope(region, x, z) < 0.08 && T.surfaceSlope(region, x + Math.sin(0.3) * 15, z + Math.cos(0.3) * 15) < 0.12) return [x, z];
  }
  throw new Error('no flat spot');
}
const flat = findFlat('wild');

/** A campaign standing on flat ground in Wildwood (yaw 0.3), with an empty field. */
function onGround(seed) {
  const cs = S.create({ regionId: 'wild', rng: mulberry(seed || 5) });
  const tpl = cs.field.list[0];
  cs.field.list.length = 0;
  cs.dragon.pilot = F.newPilot([flat[0], T.surfaceAt('wild', flat[0], flat[1]) + 6, flat[1]], 0.3, 25);
  S.step(cs, { sx: 0, sy: 0, land: true }, dt);
  for (let i = 0; i < 90; i++) S.step(cs, { sx: 0, sy: 0 }, dt);
  cs.tpl = tpl;
  return cs;
}
/** Puts a prey of a type at (ahead, side) metres from the dragon, along its heading. */
function put(cs, type, ahead, side, extra) {
  const p = cs.dragon.pilot, def = D.prey[type];
  const x = p.pos[0] + Math.sin(p.yaw) * ahead + Math.cos(p.yaw) * (side || 0), z = p.pos[2] + Math.cos(p.yaw) * ahead - Math.sin(p.yaw) * (side || 0);
  const q = Object.assign({}, cs.tpl, { id: cs.field.nextId++, type, herd: -1, pos: [x, T.surfaceAt('wild', x, z), z], state: 'graze', hp: def.hp,
    food: def.food, size: def.size, cook: 0, cd: 0, t: 0, speed: 0, goal: null, pause: 99, calm: 0, held: 0 }, extra || {});
  cs.field.list.push(q);
  return q;
}
const hold = (cs, inp, secs, onEv) => { for (let t = 0; t < secs; t += dt) for (const e of S.step(cs, Object.assign({ sx: 0, sy: 0 }, inp), dt)) if (onEv) onEv(e); };

// 1. pick up: Grab takes the goat in front, held in the jaws in front of the head
{
  const cs = onGround();
  ok(cs.dragon.pilot.mode === 'ground', 'landed for the ground tests');
  const g = put(cs, 'goat', 3.5, 0);
  S.step(cs, { sx: 0, sy: 0 }, dt);
  ok(cs.hint === 'grab' && cs.target === g.id, 'a goat in front: grab hint, it is the target');
  ok(CT.slots(cs).action === 'grab', 'the Action slot offers Grab on the ground');
  let got = null;
  hold(cs, { grab: true }, dt, e => { if (e.e === 'prey:grabbed') got = e; });
  ok(got && got.ground && got.id === g.id && cs.dragon.carried === g.id && g.state === 'carried', 'Grab picks it up');
  const p = cs.dragon.pilot, ahead = (g.pos[0] - p.pos[0]) * Math.sin(p.yaw) + (g.pos[2] - p.pos[2]) * Math.cos(p.yaw);
  ok(ahead > 1 && g.pos[1] > T.surfaceAt('wild', g.pos[0], g.pos[2]) - 0.01, 'held in the jaws: in front of the dragon, above the ground');
  ok(cs.hint === 'eat' && CT.slots(cs).action === 'eat', 'carrying on the ground: Eat');

  // 2. eat on the ground: ground.eatTime of holding Eat, standing still
  ok(S.eatTime(cs) === D.ground.eatTime, 'meal time on the ground is ground.eatTime');
  const h0 = cs.dragon.hunger;
  let eaten = null, maxSpeed = 0;
  for (let t = 0; t < D.ground.eatTime + 0.2 && !eaten; t += dt) {
    for (const e of S.step(cs, { sx: 0, sy: 1, boost: true, eat: true }, dt)) if (e.e === 'prey:eaten') eaten = e;
    maxSpeed = Math.max(maxSpeed, Math.abs(cs.dragon.pilot.speed));
  }
  ok(eaten && eaten.type === 'goat' && cs.dragon.carried == null && (cs.dragon.hunger > h0 || h0 >= D.hunger.max), 'the goat is eaten on the ground (belly fuller)');
  ok(maxSpeed < 0.5, 'eating stands still even with the stick up and Boost');
  ok(!PR.byId(cs.field, g.id), 'the eaten goat is gone');
}

// 3. nothing behind or beside the head, out of reach; a too heavy boar in front says so
{
  const cs = onGround();
  put(cs, 'goat', -4, 0); put(cs, 'goat', 0.5, 5); put(cs, 'goat', D.ground.reach + 3, 0);
  S.step(cs, { sx: 0, sy: 0 }, dt);
  ok(cs.hint === 'walk' && cs.target == null && CT.slots(cs).action == null, 'no pick up behind, to the side or out of reach');
  let got = false;
  hold(cs, { grab: true }, 0.2, e => { if (e.e === 'prey:grabbed') got = true; });
  ok(!got && cs.dragon.carried == null, 'Grab with nothing in front picks up nothing');

  const cs2 = onGround();
  put(cs2, 'boar', 3, 0, { state: 'flee', calm: 0 });
  S.step(cs2, { sx: 0, sy: 0 }, dt);
  ok(cs2.hint === 'heavy' && CT.slots(cs2).action == null, 'a boar in front of a hatchling: too heavy hint');
  let heavy = 0;
  hold(cs2, { grab: true }, 0.1, e => { if (e.e === 'prey:tooHeavy') heavy++; });
  ok(heavy === 1 && cs2.dragon.carried == null, 'Grab on it: one "too heavy" event, nothing lifted');
}

// 4. vulnerable: a boar's charge cancels a meal on the ground
{
  const cs = onGround();
  const g = put(cs, 'goat', 3, 0);
  hold(cs, { grab: true }, dt);
  ok(cs.dragon.carried === g.id, 'goat held');
  hold(cs, { eat: true }, 1.0);
  ok(cs.dragon.eatT > 0.9, 'meal under way');
  put(cs, 'boar', 6, 0, { state: 'charge', cd: 0 });
  let cancel = false, hit = false, eaten = false;
  hold(cs, { eat: true }, 0.4, e => { if (e.e === 'eat:cancel') cancel = true; if (e.e === 'boar:hit') hit = true; if (e.e === 'prey:eaten') eaten = true; });
  ok(hit && cancel && !eaten, 'the charge hits and cancels the meal');
  ok(cs.dragon.carried === g.id && cs.dragon.hp < D.stages[0].hp, 'the goat is still held, the dragon is hurt');
}

// 5. breath along the ground cooks a prey in front; the roast is picked up from the ground
{
  const cs = onGround();
  const b = put(cs, 'boar', 14, 0, { state: 'flee', held: 99 });      // held still (as the mother does) so the test is exact
  const p = cs.dragon.pilot;
  S.step(cs, { sx: 0, sy: 0, breath: true }, dt);
  ok(cs.breath && cs.breath.dir[1] < 0, 'on the ground the fire aims down along the ground');
  let roasted = null;
  for (let t = 0; t < 3 && !roasted; t += dt) for (const e of S.step(cs, { sx: 0, sy: 0, breath: true }, dt)) if (e.e === 'prey:roasted') roasted = e;
  ok(roasted && roasted.type === 'boar' && !PR.byId(cs.field, b.id), 'the boar is roasted from the ground');
  for (let t = 0; t < 2; t += dt) S.step(cs, { sx: 0, sy: 0 }, dt);   // let the stamina come back
  let got = null;
  for (let t = 0; t < 6 && !got; t += dt) {
    const ch = cs.field.list.filter(q => q.state === 'roast')
      .sort((a, c) => Math.hypot(a.pos[0] - p.pos[0], a.pos[2] - p.pos[2]) - Math.hypot(c.pos[0] - p.pos[0], c.pos[2] - p.pos[2]))[0];
    const want = Math.atan2(ch.pos[0] - p.pos[0], ch.pos[2] - p.pos[2]), off = ((want - p.yaw + 3 * Math.PI) % (2 * Math.PI)) - Math.PI;
    const inp = { sx: Math.max(-1, Math.min(1, -off * 3)), sy: Math.abs(off) < 0.3 ? 0.6 : 0, grab: cs.hint === 'grab' };
    for (const e of S.step(cs, inp, dt)) if (e.e === 'prey:grabbed') got = e;
  }
  ok(got && got.type === 'roast', 'walking to a roast chunk and Grab picks it up');

  // 6. the held prey stays in the jaws through the takeoff and hangs from the claws in the air
  hold(cs, { land: true }, dt);
  hold(cs, {}, D.takeoff.time + 0.2);
  const q = PR.byId(cs.field, cs.dragon.carried);
  ok(cs.dragon.pilot.mode === 'air' && q && q.pos[1] < cs.dragon.pilot.pos[1] - 1, 'airborne with the roast under the claws');
  ok(S.eatTime(cs) === D.eat.time, 'meal time in the air is eat.time again');
}
