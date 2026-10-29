// The lair: fly in, store prey in the larder, rest (heal, stage-up only when ready), eat from the larder,
// spoilage, paused hunger inside, leave.
'use strict';
const { ok, near, core } = require('./harness.js');
const S = core('state'), LR = core('lair'), T = core('terrain'), D = core('data'), F = core('flight'), PR = core('prey'), G = core('growth');
const { mulberry, wrap, clamp } = core('math');
const dt = 1 / 60;

function fresh(seed) {
  const cs = S.create({ regionId: 'ash', rng: mulberry(seed || 3) });
  const s = T.region('ash').spawn;
  cs.dragon.pilot = F.newPilot([s.x, Math.max(s.y, T.surfaceAt('ash', s.x, s.z) + 40), s.z], s.yaw, 30);
  return cs;
}
const mouth = LR.mouthPos('ash');
// simple autopilot toward the cave mouth
function homeIn(cs, maxSteps) {
  const ev = [];
  for (let i = 0; i < maxSteps && !cs.inLair; i++) {
    const p = cs.dragon.pilot, dx = mouth[0] - p.pos[0], dz = mouth[2] - p.pos[2], dist = Math.hypot(dx, dz);
    const turn = wrap(Math.atan2(dx, dz) - p.yaw);
    const pitchWant = Math.atan2(mouth[1] - p.pos[1], Math.max(4, dist));
    ev.push(...S.step(cs, { sx: clamp(-turn * 3, -1, 1), sy: clamp((pitchWant - p.pitch) * 3, -1, 1) }, dt));
  }
  return ev;
}

// 1. The mouth exists only in the Ash Wastes, sits above the slope and is reachable by flying in from the spawn
ok(mouth && LR.mouthPos('wild') === null, 'lair only in the Ash Wastes');
ok(mouth[1] > T.surfaceAt('ash', mouth[0], mouth[2]) + D.flight.minAlt, 'mouth centre is above the flight floor');
{
  const cs = fresh();
  ok(!cs.inLair && cs.larder.length === 0, 'a new run starts outside with an empty larder');
  const ev = homeIn(cs, 60 * 40);
  ok(cs.inLair && ev.some(e => e.e === 'lair:enter'), 'flying into the mouth from the spawn enters the lair');
}

// 2. Near the mouth the prompt points at the cave
{
  const cs = fresh();
  const p = cs.dragon.pilot;
  p.pos = [mouth[0], mouth[1] + 40, mouth[2] + 80]; p.yaw = 0;
  S.step(cs, {}, dt);
  ok(cs.hint === 'lair' && !cs.inLair, 'near the cave: "fly in" prompt');
}

// 3. Carried prey goes into the larder (capacity 3, a 4th stays in the claws); inside, hunger and prey are paused
{
  const cs = fresh(5);
  const d = cs.dragon;
  for (let k = 0; k < 4; k++) {
    const g = cs.field.list.find(q => q.state === 'graze' && q.type === 'goat') || cs.field.list[0];
    g.state = 'carried'; d.carried = g.id;
    const ev = LR.enter(cs);
    if (k < 3) ok(ev.some(e => e.e === 'lair:stored') && d.carried === null && !PR.byId(cs.field, g.id), 'prey ' + (k + 1) + ' stored');
    else ok(ev.some(e => e.e === 'lair:full') && d.carried === g.id, 'larder full: the 4th prey stays in the claws');
    cs.inLair = false;
  }
  ok(cs.larder.length === D.lair.larderSize, 'larder holds ' + D.lair.larderSize);
  cs.inLair = true;
  d.hunger = 50;
  const pos = d.pilot.pos.slice(), preyPos = cs.field.list.filter(q => q.state !== 'carried').map(q => q.pos.slice());
  for (let i = 0; i < 60 * 20; i++) S.step(cs, { sx: 1, sy: 1, boost: true, breath: true }, dt);
  ok(d.hunger === 50, 'hunger does not drain inside the lair');
  ok(d.pilot.pos.every((v, i) => v === pos[i]), 'the dragon does not fly while inside');
  ok(cs.field.list.filter(q => q.state !== 'carried').every((q, i) => q.pos.every((v, j) => v === preyPos[i][j])), 'prey are paused while inside');
  near(cs.larder[0].food, 20 - 20 / D.lair.spoilEvery, 1e-6, 'the larder still spoils inside (1 food per ' + D.lair.spoilEvery + ' s)');
}

// 4. Spoilage removes an item at 0 food
{
  const cs = fresh();
  cs.larder.push({ type: 'goat', food: 1 }, { type: 'deer', food: 30 });
  const ev = [];
  for (let i = 0; i < 60 * 31; i++) ev.push(...S.step(cs, {}, dt));
  ok(cs.larder.length === 1 && cs.larder[0].type === 'deer' && ev.some(e => e.e === 'lair:spoiled' && e.type === 'goat'), 'spoiled item removed at 0 food');
}

// 5. Eating from the larder feeds hunger and food XP
{
  const cs = fresh();
  cs.inLair = true; cs.dragon.hunger = 40;
  cs.larder.push({ type: 'deer', food: 27.4 });
  const ev = S.lairEat(cs, 0);
  ok(cs.larder.length === 0 && cs.dragon.hunger === 67 && cs.dragon.foodXp === 27 && ev.some(e => e.e === 'prey:eaten' && e.from === 'larder'), 'eat from the larder: +27 hunger and food XP');
  ok(S.lairEat(cs, 0).length === 0, 'eating an empty slot does nothing');
}

// 6. Rest heals and refills; it stages up only when food XP is ready
{
  const cs = fresh();
  const d = cs.dragon;
  cs.inLair = true; d.hp = 30; d.pilot.st = 10; d.foodXp = D.stages[1].foodFrom - 1;
  let ev = S.lairRest(cs);
  ok(d.hp === D.stages[0].hp && d.pilot.st === 100 && d.stage === 0 && !ev.some(e => e.e === 'stage:up'), 'rest heals, no stage-up below the threshold');
  d.foodXp = D.stages[1].foodFrom; d.hp = 30;
  ev = S.lairRest(cs);
  ok(d.stage === 1 && d.hp === D.stages[1].hp && ev.some(e => e.e === 'stage:up' && e.to === 1), 'rest with XP ready: drake, HP at the drake maximum');
  ev = S.lairRest(cs);
  ok(d.stage === 1 && !ev.some(e => e.e === 'stage:up'), 'a second rest does not grow again');
}

// 7. Eating from the larder can make the stage ready; then rest grows
{
  const cs = fresh();
  cs.inLair = true; cs.dragon.foodXp = D.stages[1].foodFrom - 10;
  cs.larder.push({ type: 'deer', food: 30 });
  const ev = S.lairEat(cs, 0);
  ok(ev.some(e => e.e === 'growth:ready' && e.stage === 1), 'larder meal can make the drake stage ready');
  S.lairRest(cs);
  ok(cs.dragon.stage === 1, 'and resting then grows');
}

// 8. Leave: back in the air at the spawn, facing out, hunger runs again; the mouth is not re-entered at once
{
  const cs = fresh();
  homeIn(cs, 60 * 40);
  ok(cs.inLair, 'inside before leaving');
  const st = cs.dragon.pilot.st;
  const ev = S.lairLeave(cs);
  const p = cs.dragon.pilot, s = T.region('ash').spawn;
  ok(!cs.inLair && ev.some(e => e.e === 'lair:leave'), 'leave');
  ok(Math.hypot(p.pos[0] - s.x, p.pos[2] - s.z) < 1e-9 && p.yaw === s.yaw && p.st === st, 'placed at the spawn, facing away, fire kept');
  const h = cs.dragon.hunger;
  for (let i = 0; i < 60 * 3; i++) S.step(cs, {}, dt);
  ok(!cs.inLair && cs.dragon.hunger < h, 'flying again: hunger drains, not re-entered');
}

// 9. Carrying prey in from Wildwood: carry it through the region exit, then into the larder
{
  const cs = S.create({ regionId: 'wild', rng: mulberry(9) });
  const deer = cs.field.list.find(q => q.type === 'deer');
  cs.dragon.pilot = F.newPilot([0, 100, 0], 0, 30);
  deer.state = 'carried'; cs.dragon.carried = deer.id;
  core('region').enter(cs, 'ash', 'wild');
  const ev = homeIn(cs, 60 * 120);
  ok(cs.inLair && cs.larder.length === 1 && cs.larder[0].type === 'deer' && ev.some(e => e.e === 'lair:stored'), 'deer from Wildwood stored in the larder');
}
