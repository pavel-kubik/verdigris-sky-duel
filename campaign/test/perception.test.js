// Perception (Phase 2 T14): sight cone, range factors (light, altitude, stage spot), line of sight over hills and
// buildings, hearing (landing near a guard), awareness meter, the town's watching posts in state.step.
'use strict';
const { ok, near, core } = require('./harness.js');
const PC = core('perception'), D = core('data'), T = core('terrain'), SE = core('settlement'), S = core('state'), F = core('flight');
const { mulberry } = core('math');
const P = D.perception;

const viewer = (o) => Object.assign({ pos: [0, 0, 0], yaw: 0, sight: 130, fov: 1.8 }, o);

// 1. cone: in front seen, behind and outside the half angle not, fov >= 2 PI all round
{
  const v = viewer();
  near(PC.seen(v, { pos: [0, 0, 40], alt: 0 }), 1, 1e-9, 'straight ahead and close = fully seen');
  ok(PC.seen(v, { pos: [0, 0, -40], alt: 0 }) === 0, 'behind = not seen');
  const a = 0.9 + 0.05;    // just outside fov / 2 = 0.9
  ok(PC.seen(v, { pos: [40 * Math.sin(a), 0, 40 * Math.cos(a)], alt: 0 }) === 0, 'just outside the cone = not seen');
  const b = 0.9 - 0.05;
  ok(PC.seen(v, { pos: [40 * Math.sin(b), 0, 40 * Math.cos(b)], alt: 0 }) > 0.99, 'just inside the cone = seen');
  ok(PC.seen(viewer({ fov: 7 }), { pos: [0, 0, -40], alt: 0 }) > 0.99, 'fov >= 2 PI sees all round');
}

// 2. range: linear fade over the last 30%, nothing beyond; a Drake (spot 1.5) is seen further
{
  const v = viewer(), r = 130;
  near(PC.seen(v, { pos: [0, 0, r * 0.7], alt: 0 }), 1, 1e-9, 'full at 70% of the range');
  near(PC.seen(v, { pos: [0, 0, r * 0.85], alt: 0 }), 0.5, 1e-9, 'half at 85%');
  ok(PC.seen(v, { pos: [0, 0, r + 1], alt: 0 }) === 0, 'beyond the range = 0');
  ok(PC.seen(v, { pos: [0, 0, r + 1], alt: 0 }, { spot: D.stages[1].spot }) > 0, 'a Drake is seen beyond a hatchling\'s range');
  near(PC.range(v, { spot: 1.5 }), 195, 1e-9, 'range x spot');
}

// 3. night and dusk shorten the range
{
  const v = viewer();
  near(PC.range(v, { light: 'night' }), 130 * P.night, 1e-9, 'night range');
  near(PC.range(v, { light: 'dusk' }), 130 * P.dusk, 1e-9, 'dusk range');
  near(PC.range(v, { light: 0.6 }), 78, 1e-9, 'a numeric light factor');
  const at = { pos: [0, 0, 80], alt: 0 };
  ok(PC.seen(v, at) === 1, 'seen at 80 by day');
  ok(PC.seen(v, at, { light: 'night' }) === 0, 'not seen at 80 by night (range 58)');
  ok(PC.seen(v, at, { light: 'dusk' }) > 0 && PC.seen(v, at, { light: 'dusk' }) < 1, 'dusk: at the edge of sight');
}

// 4. altitude: x1 below `from`, down to `min` at `to`
{
  near(PC.altFactor(10), 1, 1e-9, 'low flight: full range');
  near(PC.altFactor(P.altitude.from), 1, 1e-9, 'at `from`: full');
  near(PC.altFactor(P.altitude.to), P.altitude.min, 1e-9, 'at `to`: min');
  near(PC.altFactor(1000), P.altitude.min, 1e-9, 'above `to`: min');
  near(PC.altFactor((P.altitude.from + P.altitude.to) / 2), (1 + P.altitude.min) / 2, 1e-9, 'halfway');
  const v = viewer({ fov: 7, sight: 300 });
  // same distance 200, once low (alt 20) and once high (alt 200)
  ok(PC.seen(v, { pos: [0, 0, 200], alt: 20 }) > 0, 'low flight at 200 is seen (range 300)');
  ok(PC.seen(v, { pos: [0, 0, 200], alt: 210 }) === 0, 'high flight at 200 is not (range about 160)');
}

// 5. line of sight: hidden behind the volcano = not seen; above its rim = seen
{
  const id = 'ash', g = (x, z, up) => [x, T.surfaceAt(id, x, z) + up, z];
  const v = viewer({ pos: g(-320, 0, 4), yaw: Math.PI / 2, sight: 2000, fov: 1.2 });
  const low = g(320, 0, 6), high = [320, 420, 0];
  ok(!PC.los(id, v.pos, low), 'the cone blocks the line to a low dragon on the far side');
  ok(PC.seen(v, { pos: low }, { regionId: id }) === 0, 'hidden behind the hill = not seen');
  ok(PC.seen(v, { pos: high }, { regionId: id }) > 0, 'high over the far side = seen');
  ok(PC.seen(v, { pos: g(-200, 0, 6) }, { regionId: id }) > 0, 'on the open slope on this side = seen');
}

// 6. buildings block the line of sight too (the post's own building does not)
{
  const id = 'wild', town = SE.build(id), tw = town.buildings.find(b => b.type === 'tower');
  const [x, y0, z] = tw.pos, gy = (px, pz) => T.surfaceAt(id, px, pz);
  const a = [x - 12, gy(x - 12, z) + 2, z], b = [x + 12, gy(x + 12, z) + 2, z];
  const v = viewer({ pos: a, yaw: Math.PI / 2, fov: 1.2 });
  ok(!PC.los(id, a, b, town), 'the tower is between them');
  ok(PC.seen(v, { pos: b, alt: 2 }, { regionId: id, town, scale: 1 }) === 0, 'behind the tower = not seen');
  ok(PC.seen(v, { pos: [b[0], y0 + tw.h * 3, b[2]], alt: 40 }, { regionId: id, town }) > 0, 'over the tower = seen');
  const eye = [x, y0 + tw.h + 2, z];
  ok(PC.los(id, eye, b, town, tw.id), 'the post on the tower looks over its own roof');
}

// 7. hearing: landing near a guard is heard, far away not; a Drake is louder
{
  const v = viewer({ pos: [0, 10, 0] });
  const pilot = { pos: [40, 10, 0], mode: 'landing', boosting: false, breathing: false };
  const ns = PC.noisesOf(pilot, [{ e: 'dragon:landing' }], 1);
  ok(ns.length === 1 && ns[0].kind === 'land' && ns[0].r === P.hearing.land, 'landing makes a land noise');
  ok(PC.heard(v, ns), 'landing 40 from a guard is heard');
  ok(!PC.heard(v, PC.noisesOf(Object.assign({}, pilot, { pos: [100, 10, 0] }), [{ e: 'dragon:landing' }], 1)), 'landing 100 away is not');
  ok(PC.heard(v, PC.noisesOf(Object.assign({}, pilot, { pos: [100, 10, 0] }), [{ e: 'dragon:landing' }], 2)), 'a scale 2 dragon landing 100 away is');
  ok(PC.heard(viewer({ fov: 0.1, yaw: Math.PI }), ns), 'hearing needs no cone');
  ok(!PC.heard(v, PC.noisesOf({ pos: [40, 10, 0], mode: 'air' }, [], 1)), 'quiet cruise makes no noise');
  const kinds = (p, ev) => PC.noisesOf(p, ev, 1).map(n => n.kind).sort().join(',');
  ok(kinds({ pos: [0, 0, 0], mode: 'air', boosting: true, breathing: true }, []) === 'boost,breath', 'boost + breath in the air');
  ok(kinds({ pos: [0, 0, 0], mode: 'ground', boosting: true }, []) === 'run', 'running on the ground');
  ok(kinds({ pos: [0, 0, 0], mode: 'takeoff' }, [{ e: 'dragon:takeoff' }]) === 'takeoff', 'takeoff');
  ok(kinds({ pos: [0, 0, 0], mode: 'ground' }, [{ e: 'dragon:landing' }, { e: 'dragon:landed' }]) === 'land', 'one land noise per frame');
}

// 8. awareness: rises with seen, thresholds, falls unseen, hearing = suspicious at once, alert holds down to suspicious
{
  const d = {};
  ok(PC.stepAwareness(d, 0, null, 1) === 'idle' && d.aware === 0, 'nothing: idle');
  PC.stepAwareness(d, 1, null, 0.2);
  near(d.aware, P.awareRise * 0.2, 1e-9, 'rises by awareRise x seen x dt');
  ok(d.state === 'idle', 'still idle under the threshold');
  PC.stepAwareness(d, 1, null, 0.1);
  ok(d.state === 'suspicious', 'suspicious past ' + P.suspicious);
  for (let i = 0; i < 10; i++) PC.stepAwareness(d, 1, null, 0.1);
  ok(d.state === 'alert' && d.aware === P.alert, 'alert at full awareness (clamped)');
  PC.stepAwareness(d, 0, null, 2);
  ok(d.state === 'alert', 'stays alert while awareness is above suspicious');
  for (let i = 0; i < 12; i++) PC.stepAwareness(d, 0, null, 0.25);
  ok(d.state === 'idle' && d.aware < P.suspicious, 'unseen for a while: back to idle');
  const e = {};
  ok(PC.stepAwareness(e, 0, { kind: 'land' }, 0.016) === 'suspicious', 'a heard noise makes it suspicious at once');
  const half = {};
  for (let i = 0; i < 10; i++) PC.stepAwareness(half, 0.25, null, 0.1);
  near(half.aware, 0.3, 1e-9, 'a faint sighting (0.25) rises 4 times slower');
}

// 9. state.step: the small Wildwood outpost's tower post notices a dragon flying low in front of it
{
  const cs = S.create({ regionId: 'wild', rng: mulberry(3) });
  const town = S.ensureTown(cs), tw = town.buildings.find(b => b.type === 'tower');
  cs.dragon.pilot = F.newPilot([0, 120, 0], 0, 30);
  S.step(cs, {}, 0.016);
  ok(cs.watch && cs.watch.list.length === 1 && cs.watch.list[0].kind === 'archer', 'one watcher on the tower');
  const w = cs.watch.list[0];
  const at = [w.pos[0] + Math.sin(w.base) * 60, 0, w.pos[2] + Math.cos(w.base) * 60];
  at[1] = T.surfaceAt('wild', at[0], at[2]) + 25;
  const pilot = F.newPilot(at, w.base + Math.PI, 0);
  cs.dragon.pilot = pilot;
  const states = [];
  cs.bus.on('aware:state', e => states.push(e.state));
  for (let i = 0; i < 120; i++) { pilot.pos = at.slice(); pilot.speed = 0; S.step(cs, {}, 0.05); }
  ok(states[0] === 'suspicious' && states.includes('alert'), 'idle -> suspicious -> alert: ' + states.join(','));
  ok(w.state === 'alert' && w.seen > 0, 'alert and seeing the dragon');
  // into the cave: nobody sees it, awareness falls back
  cs.inLair = true;
  for (let i = 0; i < 100; i++) S.step(cs, {}, 0.1);
  ok(w.state === 'idle', 'in the cave the post calms down');
  cs.inLair = false;
  // night: the same spot at 120 out is beyond sight
  const far = [w.pos[0] + Math.sin(w.base) * 120, 0, w.pos[2] + Math.cos(w.base) * 120];
  far[1] = T.surfaceAt('wild', far[0], far[2]) + 25;
  cs.light = 'night';
  for (let i = 0; i < 60; i++) { pilot.pos = far.slice(); pilot.speed = 0; S.step(cs, {}, 0.05); }
  ok(w.seen === 0 && w.state === 'idle', 'at night the post does not see the dragon 120 out');
  // a ruined tower has no watcher eyes
  tw.ruin = true;
  cs.light = null;
  for (let i = 0; i < 20; i++) { pilot.pos = at.slice(); S.step(cs, {}, 0.05); }
  ok(w.state === 'idle' && w.seen === 0, 'a ruined tower watches nothing');
}
