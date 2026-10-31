/*
 * Verdigris campaign - time of day (Phase 2 T21, 002_task_kingdom.md 4.6 and 5.6).
 * cs.clock = { t } with t in 0..1 (0 = midnight, 0.5 = noon); a full cycle lasts data.clock.dayLength s of play.
 *   create(t?) -> { t }                  t defaults to clock.start
 *   light(t) -> 0..1                     1 by day, 0 at night; smooth ramps nightTo -> 2 x dawn - nightTo (dawn in the middle)
 *                                        and 2 x dusk - nightFrom -> nightFrom (dusk in the middle)
 *   sight(t) -> perception.night..1      the defenders' sight multiplier (cs.light, read by perception.range)
 *   phase(t) -> 'day' | 'dusk' | 'night' | 'dawn'
 *   step(cs, dt) -> events               advances the clock, sets cs.light; 'clock:phase' { phase, from } on a change
 *   sleepTo(cs, 'dusk' | 'dawn') -> { to, skipped, events }   forward to the next dusk / dawn (the nest), skipped in s
 *   setPhase(cs, phase)                  jump to the middle of a phase (debug)
 *   hours(t) -> 'HH:MM'                  for the nest panel and the debug panel
 * Pure: no DOM, no THREE.
 */
(function (root) {
  'use strict';
  const M = typeof module === 'object' && module.exports ? require('./umd.js') : root.VCamp;
  const D = M.need('data');

  const frac = x => x - Math.floor(x);
  const smooth = x => (x <= 0 ? 0 : x >= 1 ? 1 : x * x * (3 - 2 * x));

  function create(t) { return { t: frac(t == null ? D.clock.start : t) }; }

  /** Ramp edges: [nightTo, dayFrom] rises, [dayTo, nightFrom] falls. */
  function edges() {
    const C = D.clock;
    return { nightTo: C.nightTo, dayFrom: 2 * C.dawn - C.nightTo, dayTo: 2 * C.dusk - C.nightFrom, nightFrom: C.nightFrom };
  }

  function light(t) {
    const E = edges(); t = frac(t);
    if (t < E.nightTo || t >= E.nightFrom) return 0;
    if (t < E.dayFrom) return smooth((t - E.nightTo) / (E.dayFrom - E.nightTo));
    if (t < E.dayTo) return 1;
    return 1 - smooth((t - E.dayTo) / (E.nightFrom - E.dayTo));
  }

  function sight(t) {
    const n = D.perception.night;
    return n + (1 - n) * light(t);
  }

  function phase(t) {
    const E = edges(); t = frac(t);
    if (t < E.nightTo || t >= E.nightFrom) return 'night';
    if (t < E.dayFrom) return 'dawn';
    if (t < E.dayTo) return 'day';
    return 'dusk';
  }

  function step(cs, dt) {
    if (!cs.clock) cs.clock = create();
    const from = phase(cs.clock.t);
    cs.clock.t = frac(cs.clock.t + (dt || 0) / D.clock.dayLength);
    cs.light = sight(cs.clock.t);
    const to = phase(cs.clock.t);
    return to === from ? [] : [{ e: 'clock:phase', phase: to, from }];
  }

  function sleepTo(cs, to) {
    if (!cs.clock) cs.clock = create();
    const target = to === 'dawn' ? D.clock.dawn : D.clock.dusk, t0 = cs.clock.t;
    let d = frac(target - t0);
    if (d < 1e-6) d = 1;                                         // already there: sleep a whole cycle round
    cs.clock.t = frac(t0 + d);
    cs.light = sight(cs.clock.t);
    const skipped = d * D.clock.dayLength;
    return { to, skipped, events: [{ e: 'clock:slept', to, skipped, from: phase(t0), phase: phase(cs.clock.t) }] };
  }

  const MIDDLE = { night: 0, dawn: null, day: 0.5, dusk: null };
  function setPhase(cs, ph) {
    if (!cs.clock) cs.clock = create();
    const E = edges();
    const t = ph === 'dawn' ? D.clock.dawn : ph === 'dusk' ? D.clock.dusk : ph === 'day' ? (E.dayFrom + E.dayTo) / 2 : MIDDLE.night;
    cs.clock.t = frac(t);
    cs.light = sight(cs.clock.t);
    return cs.clock.t;
  }

  function hours(t) {
    const m = Math.floor(frac(t) * 24 * 60 + 1e-6);
    return String(Math.floor(m / 60)).padStart(2, '0') + ':' + String(m % 60).padStart(2, '0');
  }

  M.define('clock', { create, light, sight, phase, step, sleepTo, setPhase, hours, edges, PHASES: ['day', 'dusk', 'night', 'dawn'] });
})(typeof window !== 'undefined' ? window : globalThis);
