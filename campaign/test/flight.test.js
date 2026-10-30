// Flight: stays finite and in bounds, feels like the duel at hatchling stats, honours stage and hunger effects.
'use strict';
const { ok, near, core } = require('./harness.js');
const F = core('flight'), T = core('terrain'), D = core('data'), { mulberry } = core('math');
const VSim = require('../../mp/sim.js');

const dt = 1 / 60;
const hatch = D.stages[0], drake = D.stages[1];
const ctxOf = (regionId, stage, extra) => Object.assign({ regionId, stats: { turn: stage.turn, cruise: stage.cruise, boost: stage.boost } }, extra || {});

// 1. Two minutes of random input in every region: finite, inside the radius, above the surface, under the ceiling
for (const regionId of Object.keys(D.regions)) {
  const R = D.regions[regionId], rng = mulberry(regionId.length * 31 + 5);
  const p = F.newPilot([0, 120, 300], 0);
  let inp = { sx: 0, sy: 0, breath: false, boost: false }, lowest = Infinity;
  for (let i = 0; i < 60 * 120; i++) {
    if (i % 80 === 0) inp = { sx: rng() * 2 - 1, sy: rng() * 2 - 1.3, breath: rng() < 0.3, boost: rng() < 0.3 };
    if (i % 230 === 0) F.tryRoll(p, rng() < 0.5 ? -1 : 1);
    F.step(p, inp, dt, ctxOf(regionId, hatch));
    ok(p.pos.every(Number.isFinite) && Number.isFinite(p.yaw) && Number.isFinite(p.speed), 'pilot finite: ' + regionId);
    ok(Math.hypot(p.pos[0], p.pos[2]) <= R.radius + 1e-6, 'inside region: ' + regionId);
    const alt = F.altitude(p, regionId);
    lowest = Math.min(lowest, alt);
    ok(alt >= D.flight.minAlt - 1e-6 && p.pos[1] <= R.ceiling + 1e-9, 'altitude bounds: ' + regionId);
    ok(p.st >= 0 && p.st <= 100, 'stamina bounds');
  }
  ok(lowest < D.flight.minAlt + 3, 'the dragon can skim low over the ground: ' + regionId + ' lowest ' + lowest.toFixed(2));
}

// 2. Same feel as the duel at hatchling stats: identical yaw, pitch and speed response high above flat-ish ground
{
  const a = F.newPilot([0, 200, 0], 0), b = VSim.newPilot([0, 200, 0]);
  const script = [{ sx: 1, sy: 0 }, { sx: -0.5, sy: 0.6 }, { sx: 0, sy: -0.4, boost: true }, { sx: 0.3, sy: 0 }];
  for (let i = 0; i < 60 * 4; i++) {
    const inp = Object.assign({ breath: false, boost: false }, script[Math.floor(i / 60)]);
    F.step(a, inp, dt, ctxOf('wild', hatch));
    VSim.stepPilot(b, inp, dt);
  }
  near(a.yaw, b.yaw, 1e-9, 'yaw matches the duel');
  near(a.pitch, b.pitch, 1e-9, 'pitch matches the duel');
  near(a.speed, b.speed, 1e-9, 'speed matches the duel');
  near(a.st, b.st, 1e-9, 'stamina matches the duel');
}

// 3. Stage stats: a drake turns slower and cruises a little faster
{
  const h = F.newPilot([0, 200, 0], 0), d = F.newPilot([0, 200, 0], 0);
  for (let i = 0; i < 60; i++) { F.step(h, { sx: 1 }, dt, ctxOf('wild', hatch)); F.step(d, { sx: 1 }, dt, ctxOf('wild', drake)); }
  near(Math.abs(d.yaw) / Math.abs(h.yaw), drake.turn / hatch.turn, 1e-6, 'turn rate scales with stage');
  for (let i = 0; i < 60 * 10; i++) { F.step(h, {}, dt, ctxOf('wild', hatch)); F.step(d, {}, dt, ctxOf('wild', drake)); }
  ok(d.speed > h.speed, 'drake cruises faster');
}

// 4. Hunger effects and eating
{
  const starving = { speedMult: 0.7, stRegenMult: 0.5, canBreath: false };
  const p = F.newPilot([0, 200, 0], 0);
  for (let i = 0; i < 60 * 10; i++) F.step(p, { breath: true }, dt, ctxOf('wild', hatch, { effects: starving }));
  near(p.speed, hatch.cruise * 0.7, 0.5, 'starving flies at 70% speed');
  ok(!p.breathing, 'no breath while starving');
  const e = F.newPilot([0, 200, 0], 0);
  for (let i = 0; i < 60 * 10; i++) F.step(e, { boost: true, breath: true }, dt, ctxOf('wild', hatch, { eating: true }));
  ok(e.speed <= D.eat.speedCap + 0.01 && !e.boosting && !e.breathing, 'eating caps speed and blocks boost and breath');
  const s = F.newPilot([0, 200, 0], 0); s.st = 20;
  const n = F.newPilot([0, 200, 0], 0); n.st = 20;
  for (let i = 0; i < 60; i++) { F.step(s, {}, dt, ctxOf('wild', hatch, { effects: starving })); F.step(n, {}, dt, ctxOf('wild', hatch)); }
  near((s.st - 20) / (n.st - 20), 0.5, 1e-6, 'hungry stamina regenerates at half rate');
}

// 5. Soft boundary turns the dragon back before the edge
{
  const R = D.regions.wild;
  const p = F.newPilot([0, 150, R.radius - 140], 0);       // heading straight out (+Z)
  let maxR = 0;
  for (let i = 0; i < 60 * 30; i++) { F.step(p, {}, dt, ctxOf('wild', hatch)); maxR = Math.max(maxR, Math.hypot(p.pos[0], p.pos[2])); }
  ok(maxR <= R.radius + 1e-6, 'never leaves the region');
  ok(Math.hypot(p.pos[0], p.pos[2]) < R.radius - 60, 'turned back toward the centre');
}

// 6. Barrel roll: costs stamina, grants brief invulnerability, cannot chain
{
  const p = F.newPilot([0, 200, 0], 0);
  ok(F.tryRoll(p, 1) && p.st === 90 && p.inv > 0, 'roll costs 10 and makes invulnerable');
  ok(!F.tryRoll(p, -1), 'cannot roll again mid-roll');
  for (let i = 0; i < 60; i++) F.step(p, {}, dt, ctxOf('wild', hatch));
  ok(p.rollT === 0 && p.inv === 0, 'roll and invulnerability end');
}
