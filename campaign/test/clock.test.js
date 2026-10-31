// Day and night (Phase 2 T21): a 20 min cycle, light and phases, the defenders' sight at night (about half), the clock in
// state.step (also in the cave), Sleep until dusk / dawn at the nest.
'use strict';
const { ok, near, core } = require('./harness.js');
const CK = core('clock'), D = core('data'), S = core('state'), F = core('flight'), T = core('terrain'), PC = core('perception'), LR = core('lair'), CV = core('cave');
const { mulberry } = core('math');

// 1. Cycle length and phases
{
  ok(D.clock.dayLength === 1200, 'a full cycle takes 20 min');
  const cs = { clock: CK.create(0.5) };
  let phases = [], last = CK.phase(cs.clock.t);
  for (let i = 0; i < 1200; i++) for (const e of CK.step(cs, 1)) { phases.push(e.phase); ok(e.from === last, 'from = the last phase'); last = e.phase; }
  near(cs.clock.t, 0.5, 1e-6, 'back at noon after 1200 s');
  ok(phases.join(',') === 'dusk,night,dawn,day', 'day -> dusk -> night -> dawn -> day: ' + phases.join(','));
  ok(CK.create().t === D.clock.start && CK.phase(D.clock.start) === 'day', 'a new run starts by day');
  ok(CK.light(0.5) === 1 && CK.light(0) === 0, 'noon is bright, midnight dark');
  near(CK.light(D.clock.dusk), 0.5, 1e-9, 'dusk is half light');
  near(CK.light(D.clock.dawn), 0.5, 1e-9, 'dawn is half light');
  for (let t = 0; t < 1; t += 0.001) {
    const a = CK.light(t), b = CK.light(t + 0.001);
    ok(a >= 0 && a <= 1 && Math.abs(a - b) < 0.05, 'light is smooth at ' + t.toFixed(3));
  }
  // minutes of each phase
  const mins = { day: 0, dusk: 0, night: 0, dawn: 0 };
  for (let s = 0; s < 1200; s++) mins[CK.phase(s / 1200)] += 1 / 60;
  near(mins.day, 8, 0.05, '8 min of day'); near(mins.night, 8, 0.05, '8 min of night');
  near(mins.dusk, 2, 0.05, '2 min of dusk'); near(mins.dawn, 2, 0.05, '2 min of dawn');
  ok(CK.hours(0.5) === '12:00' && CK.hours(0.75) === '18:00' && CK.hours(0) === '00:00', 'hours');
}

// 2. Night halves archer sight (acceptance), dusk in between
{
  const archer = { sight: D.defenders.archer.sight };
  const day = PC.range(archer, { light: CK.sight(0.5) }), night = PC.range(archer, { light: CK.sight(0) }), dusk = PC.range(archer, { light: CK.sight(D.clock.dusk) });
  near(day, D.defenders.archer.sight, 1e-9, 'full range by day');
  ok(night <= day * 0.5 && night >= day * 0.4, 'night halves archer sight: ' + night + ' of ' + day);
  ok(dusk > night && dusk < day, 'dusk in between: ' + dusk);
  near(CK.sight(0), D.perception.night, 1e-9, 'night factor = perception.night');
}

// 3. In state.step: cs.light follows the clock, the clock runs in the cave too, 'clock:phase' on the bus
{
  const cs = S.create({ regionId: 'wild', rng: mulberry(5) });
  cs.dragon.pilot = F.newPilot([0, T.surfaceAt('wild', 0, 0) + 150, 0], 0, 30);
  ok(cs.clock && cs.clock.t === D.clock.start, 'a run has a clock');
  S.step(cs, {}, 0.1);
  near(cs.light, 1, 1e-9, 'morning: the defenders see as far as by day');
  const seen = [];
  cs.bus.on('clock:phase', e => seen.push(e.phase));
  CK.setPhase(cs, 'day');
  cs.clock.t = D.clock.nightFrom - 0.5 / D.clock.dayLength;
  S.step(cs, {}, 1);
  ok(seen.includes('night') && CK.phase(cs.clock.t) === 'night', 'night falls in a step');
  near(cs.light, D.perception.night, 1e-9, 'cs.light = the night factor');
  const t0 = cs.clock.t;
  LR.enter(cs); ok(cs.inLair, 'in the cave');
  for (let i = 0; i < 30; i++) S.step(cs, {}, 1);
  near(cs.clock.t, t0 + 30 / D.clock.dayLength, 1e-9, 'the clock runs in the cave');
}

// 4. Sleep until dusk / dawn at the nest: rest + clock forward, autosave, never backward
{
  const cs = S.create({ regionId: 'ash', rng: mulberry(9) });
  cs.dragon.pilot = F.newPilot([0, 200, 0], 0, 30);
  LR.enter(cs);
  cs.dragon.hp = 3; cs.clock.t = 0.4;
  let ev = S.caveAct(cs, 'nest', 'dusk');
  near(cs.clock.t, D.clock.dusk, 1e-9, 'woke at dusk');
  ok(cs.dragon.hp > 3, 'sleeping also rests (HP)');
  const sl = ev.find(e => e.e === 'clock:slept');
  ok(sl && sl.to === 'dusk' && Math.abs(sl.skipped - (D.clock.dusk - 0.4) * D.clock.dayLength) < 1e-6, 'clock:slept with the skipped seconds');
  ok(ev.some(e => e.e === 'lair:rest') && ev.some(e => e.e === 'save'), 'rest + autosave');
  ev = S.caveAct(cs, 'nest', 'dawn');
  near(cs.clock.t, D.clock.dawn, 1e-9, 'dusk -> sleep until dawn: through the night');
  near(ev.find(e => e.e === 'clock:slept').skipped, 0.5 * D.clock.dayLength, 1e-6, '10 min skipped');
  ev = S.caveAct(cs, 'nest', 'dawn');
  near(ev.find(e => e.e === 'clock:slept').skipped, D.clock.dayLength, 1e-6, 'already at dawn: the next dawn');
  const t1 = cs.clock.t;
  ev = S.caveAct(cs, 'nest');
  ok(cs.clock.t === t1 && !ev.some(e => e.e === 'clock:slept'), 'plain Rest leaves the clock');
  near(cs.light, CK.sight(cs.clock.t), 1e-9, 'cs.light updated on waking');
  ok(CV.act(cs, 'nest').some(e => e.e === 'lair:rest'), 'cave.act nest still rests');
}

// 5. Debug phase jumps land in their phase
for (const ph of CK.PHASES) {
  const cs = { clock: CK.create() };
  CK.setPhase(cs, ph);
  ok(CK.phase(cs.clock.t) === ph, 'setPhase ' + ph);
}
