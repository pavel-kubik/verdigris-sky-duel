// Breath feedback (T08, Pavel's test): pressing Breath when no fire is possible says why, once per press -
// starving (hunger <= hunger.states.starving, no fire by design) or the fire bar is empty. Same in the air and on the ground.
'use strict';
const { ok, core } = require('./harness.js');
const D = core('data'), T = core('terrain'), F = core('flight'), S = core('state'), HN = core('hunger');
const { mulberry } = core('math');
const dt = 1 / 60;

function fresh() {
  const cs = S.create({ regionId: 'wild', rng: mulberry(9) });
  cs.field.list.length = 0;
  cs.dragon.pilot = F.newPilot([300, T.surfaceAt('wild', 300, 0) + 80, 0], 0.3, 30);
  return cs;
}
const blocked = ev => ev.filter(e => e.e === 'breath:blocked');

// 1. fed: Breath fires, no blocked event
{
  const cs = fresh();
  const ev = S.step(cs, { breath: true }, dt);
  ok(cs.dragon.pilot.breathing && blocked(ev).length === 0, 'fed and rested: fire, no message');
}

// 2. starving: no fire, one message per press (not every frame), fire again once fed above the threshold
{
  const cs = fresh();
  cs.dragon.hunger = 0;
  ok(!HN.effects(0).canBreath, 'starving has no fire (data: hunger.starving.breath)');
  let n = 0, fired = false;
  for (let i = 0; i < 30; i++) { const ev = S.step(cs, { breath: true }, dt); n += blocked(ev).filter(e => e.why === 'starving').length; fired = fired || cs.dragon.pilot.breathing; }
  ok(n === 1 && !fired, 'holding Breath while starving: no fire, one "starving" message');
  S.step(cs, {}, dt);
  ok(blocked(S.step(cs, { breath: true }, dt)).length === 1, 'a new press says it again');
  cs.dragon.hunger = D.hunger.states.starving + 15;                 // DBG "hunger +25" from 0 lands here
  S.step(cs, {}, dt);
  const ev = S.step(cs, { breath: true }, dt);
  ok(cs.dragon.pilot.breathing && blocked(ev).length === 0, 'above the starving line the fire works again');
}

// 3. empty fire bar: "tired" message; on the ground too
{
  const cs = fresh();
  cs.dragon.pilot.st = 3;
  ok(blocked(S.step(cs, { breath: true }, dt))[0].why === 'tired' && !cs.dragon.pilot.breathing, 'empty fire bar: "tired" message');
  const g = fresh();
  g.dragon.pilot = F.newPilot([300, T.surfaceAt('wild', 300, 0) + 6, 0], 0.3, 25);
  S.step(g, { land: true }, dt);
  for (let i = 0; i < 90; i++) S.step(g, {}, dt);
  g.dragon.hunger = 0;
  const ev = S.step(g, { breath: true }, dt);
  ok(g.dragon.pilot.mode === 'ground' && blocked(ev)[0].why === 'starving', 'starving on the ground: same message');
}
