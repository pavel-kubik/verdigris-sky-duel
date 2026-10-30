// Hunting through CampaignState: grab, too-heavy rule, carry, eat in flight, interruptions, starving drop.
'use strict';
const { ok, near, core } = require('./harness.js');
const S = core('state'), PR = core('prey'), T = core('terrain'), D = core('data'), { mulberry } = core('math');
const dt = 1 / 60;

function setup(type, stage, seed) {
  const cs = S.create({ regionId: 'wild', rng: mulberry(seed || 7) });
  const d = cs.dragon;
  d.stage = stage || 0; d.foodXp = stage ? D.stages[stage].foodFrom : 0; d.hp = D.stages[d.stage].hp; d.hunger = 60;
  const target = cs.field.list.find(p => p.type === type);
  S.enterRegion(cs, 'wild');                                        // (fresh field, same seed path)
  const t2 = cs.field.list.find(p => p.type === type) || target;
  d.pilot = core('flight').newPilot([t2.pos[0], t2.pos[1] + 6, t2.pos[2]], 0, 30);
  return { cs, d, prey: t2 };
}
// hover the dragon just above a prey for one step (flight moves it ~0.5 per step, well inside the reach)
const hoverOver = (cs, prey, up, pitch) => { const p = cs.dragon.pilot; p.pos = [prey.pos[0] - 0.3, prey.pos[1] + (up == null ? 6 : up), prey.pos[2] - 0.3]; p.pitch = pitch || 0; };
const stepN = (cs, inp, n, before) => { const ev = []; for (let i = 0; i < n; i++) { if (before) before(); ev.push(...S.step(cs, inp, dt)); } return ev; };

// 1. A hatchling grabs a goat and a deer; the rest of the herd bolts
for (const type of ['goat', 'deer']) {
  const { cs, d, prey } = setup(type, 0);
  hoverOver(cs, prey);
  const ev = S.step(cs, { grab: true }, dt);
  ok(ev.some(e => e.e === 'prey:grabbed' && e.type === type) && d.carried === prey.id && prey.state === 'carried', 'hatchling grabs a ' + type);
  const mates = cs.field.list.filter(q => q.herd === prey.herd && q !== prey);
  ok(mates.every(q => q.state === 'flee'), 'herd mates bolt when one is taken: ' + type);
  ok(cs.hint === 'eat', 'prompt switches to eat');
  // carried prey travels with the dragon
  stepN(cs, {}, 60);
  ok(Math.hypot(prey.pos[0] - d.pilot.pos[0], prey.pos[2] - d.pilot.pos[2]) < 1e-9 && prey.pos[1] < d.pilot.pos[1], 'carried prey hangs under the dragon');
}

// 2. A boar is too heavy for a hatchling (one "too heavy" message per cooldown), a drake can lift it
{
  const { cs, d, prey } = setup('boar', 0);
  const ev = stepN(cs, { grab: true }, 60, () => hoverOver(cs, prey));
  ok(d.carried === null && prey.state !== 'carried', 'hatchling cannot lift a boar');
  ok(ev.filter(e => e.e === 'prey:tooHeavy').length === 1, 'too heavy is reported once per cooldown');
  hoverOver(cs, prey); S.step(cs, {}, dt);
  ok(cs.hint === 'heavy', 'prompt says too heavy');
  const drake = setup('boar', 1);
  hoverOver(drake.cs, drake.prey);
  ok(S.step(drake.cs, { grab: true }, dt).some(e => e.e === 'prey:grabbed' && e.type === 'boar'), 'a drake lifts a boar');
}

// 3. Reach rules: too high, too far, climbing hard -> no grab; the grab prompt shows when in reach
{
  const { cs, d, prey } = setup('goat', 0);
  cs.field.list = [prey];                                           // only the target, so herd mates cannot be in reach
  hoverOver(cs, prey, D.grab.maxAboveGround + D.grab.clawDrop + 3); S.step(cs, { grab: true }, dt);
  ok(d.carried === null, 'too high to grab');
  hoverOver(cs, prey, 6, 0.5); S.step(cs, { grab: true }, dt);
  ok(d.carried === null, 'climbing hard: no grab');
  const p = d.pilot; p.pos = [prey.pos[0] + D.grab.radius * 1.5, prey.pos[1] + 6, prey.pos[2]]; p.pitch = 0; p.yaw = Math.PI / 2;
  S.step(cs, { grab: true }, dt);
  ok(d.carried === null && cs.hint === 'near', 'out of reach but close: prompt says near');
  hoverOver(cs, prey); S.step(cs, {}, dt);
  ok(cs.hint === 'grab', 'in reach: prompt says grab');
}

// 4. Eating takes eat.time of holding X; it feeds hunger and growth and removes the prey
{
  const { cs, d, prey } = setup('deer', 0);
  hoverOver(cs, prey); S.step(cs, { grab: true }, dt);
  const h0 = d.hunger, xp0 = d.foodXp, n = cs.field.list.length;
  const almost = Math.floor((D.eat.time - 0.1) / dt);
  let ev = stepN(cs, { eat: true }, almost);
  ok(!ev.some(e => e.e === 'prey:eaten') && d.carried === prey.id, 'not eaten before eat.time');
  ok(d.pilot.speed <= D.eat.speedCap + 0.5, 'eating slows the dragon to the cap');
  ev = stepN(cs, { eat: true }, 10);
  const eaten = ev.find(e => e.e === 'prey:eaten');
  ok(eaten && eaten.food === D.prey.deer.food, 'eaten after eat.time');
  ok(d.carried === null && cs.field.list.length === n - 1 && !cs.field.list.includes(prey), 'prey removed');
  ok(d.foodXp === xp0 + D.prey.deer.food, 'meal adds food XP');
  ok(d.hunger > h0 + D.prey.deer.food - 3, 'meal fills hunger (minus a few seconds of drain)');
  ok(cs.stats.eaten === 1 && cs.stats.food === D.prey.deer.food, 'run stats count the meal');
}

// 5. Letting go of X restarts the meal
{
  const { cs, d, prey } = setup('goat', 0);
  hoverOver(cs, prey); S.step(cs, { grab: true }, dt);
  stepN(cs, { eat: true }, Math.floor(2 / dt));
  S.step(cs, { eat: false }, dt);
  ok(d.eatT === 0, 'releasing the eat key resets progress');
  const ev = stepN(cs, { eat: true }, Math.floor(1 / dt));
  ok(!ev.some(e => e.e === 'prey:eaten') && d.carried === prey.id, 'a restarted meal needs the full time again');
}

// 6. A boar hit interrupts the meal
{
  const { cs, d } = setup('boar', 0, 33);
  const boar = cs.field.list.find(p => p.type === 'boar');
  const goat = cs.field.list.find(p => p.type === 'goat' || p.type === 'deer');
  goat.state = 'carried'; d.carried = goat.id;                        // already holding a meal
  let cancelled = false, hitAtEatT = -1;
  for (let i = 0; i < 8 / dt && !cancelled; i++) {
    const p = d.pilot; p.pos = [boar.pos[0] + 5, boar.pos[1] + 5, boar.pos[2]]; p.pitch = 0;
    const ev = S.step(cs, { eat: true }, dt);
    if (ev.some(e => e.e === 'boar:hit')) { hitAtEatT = d.eatT; cancelled = ev.some(e => e.e === 'eat:cancel'); }
  }
  ok(cancelled && hitAtEatT === 0, 'a boar hit cancels eating and resets progress');
  ok(d.hp < D.stages[0].hp, 'and it hurts');
}

// 7. A starving drake drops a boar (starving claws hold small prey only); a starving hatchling keeps a goat
{
  const { cs, d, prey } = setup('boar', 1);
  hoverOver(cs, prey); S.step(cs, { grab: true }, dt);
  ok(d.carried === prey.id, 'drake carries a boar');
  d.hunger = D.hunger.states.starving - 1;
  const ev = S.step(cs, {}, dt);
  ok(ev.some(e => e.e === 'prey:dropped' && e.type === 'boar') && d.carried === null, 'starving drake drops the boar');
  ok(prey.state === 'flee' && Math.abs(prey.pos[1] - T.surfaceAt('wild', prey.pos[0], prey.pos[2])) < 1e-9, 'dropped boar lands and runs');
  const h = setup('goat', 0);
  hoverOver(h.cs, h.prey); S.step(h.cs, { grab: true }, dt);
  h.d.hunger = 2;
  ok(!S.step(h.cs, {}, dt).some(e => e.e === 'prey:dropped') && h.d.carried === h.prey.id, 'a starving hatchling keeps a goat');
}

// 8. Eating the meal that crosses the stage threshold reports growth:ready once
{
  const { cs, d, prey } = setup('deer', 0);
  d.foodXp = D.stages[1].foodFrom - 10;
  hoverOver(cs, prey); S.step(cs, { grab: true }, dt);
  const ev = stepN(cs, { eat: true }, Math.ceil(D.eat.time / dt) + 2);
  ok(ev.filter(e => e.e === 'growth:ready').length === 1 && d.stage === 0, 'growth:ready fires; the stage still waits for rest');
}

// 9. Bus mirrors the returned events
{
  const { cs, prey } = setup('goat', 0);
  const seen = [];
  cs.bus.on('prey:grabbed', e => seen.push(e.type));
  hoverOver(cs, prey); S.step(cs, { grab: true }, dt);
  ok(seen.length === 1 && seen[0] === 'goat', 'events go to the bus too');
  near(S.scaleOf(cs), D.stages[0].scaleFrom, 1e-9, 'scale helper');
}

// 10. Swoop: a casual player who flies roughly at prey and just holds G gets it (no precise steering)
{
  const F = core('flight');
  let got = 0, n = 0;
  for (let seed = 1; seed <= 40; seed++) {
    const r = mulberry(seed * 13);
    const cs = S.create({ regionId: 'wild', rng: mulberry(seed) });
    const prey = cs.field.list.find(p => p.type === 'goat' || p.type === 'deer');
    const a = r() * Math.PI * 2, dist = 70 + r() * 15, err = (r() - 0.5) * 1.2;     // heading up to ~35 degrees off
    const x = prey.pos[0] + Math.sin(a) * dist, z = prey.pos[2] + Math.cos(a) * dist;
    cs.dragon.pilot = F.newPilot([x, T.surfaceAt('wild', x, z) + 28, z], a + Math.PI + err, 30);
    let ok1 = false;
    for (let i = 0; i < 60 * 8 && !ok1; i++) { S.step(cs, { grab: true }, dt); if (cs.dragon.carried != null) ok1 = true; }
    n++; if (ok1) got++;
  }
  ok(got / n >= 0.9, 'holding G while heading roughly at prey grabs it: ' + got + '/' + n);
}

// 11. Swoop targets only liftable prey ahead; the prompt offers it before reach
{
  const F = core('flight');
  const { cs, d, prey } = setup('goat', 0);
  cs.field.list = [prey];
  const x = prey.pos[0], z = prey.pos[2] - 60;
  d.pilot = F.newPilot([x, prey.pos[1] + 25, z], 0, 30);            // heading +Z, straight at it
  S.step(cs, {}, dt);
  ok(cs.hint === 'swoop', 'prompt offers a swoop at prey ahead');
  d.pilot = F.newPilot([x, prey.pos[1] + 25, z], Math.PI, 30);      // facing away
  S.step(cs, { grab: true }, dt);
  ok(cs.swoop === null && cs.hint !== 'swoop', 'no swoop at prey behind the dragon');
  const b = setup('boar', 0);
  b.cs.field.list = [b.prey];
  b.d.pilot = F.newPilot([b.prey.pos[0], b.prey.pos[1] + 25, b.prey.pos[2] - 60], 0, 30);
  S.step(b.cs, { grab: true }, dt);
  ok(b.cs.swoop === null, 'a hatchling does not swoop at a boar');
}
