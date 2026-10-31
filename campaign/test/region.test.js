// Region edges and travel: exit arcs, outward heading, entry placement, prey respawn, carried prey, round trips.
'use strict';
const { ok, near, core } = require('./harness.js');
const RG = core('region'), S = core('state'), T = core('terrain'), D = core('data'), F = core('flight'), PR = core('prey');
const { mulberry, wrap } = core('math');
const dt = 1 / 60;
const at = (id, a, inset, up) => {
  const r = T.region(id).radius - inset, x = Math.sin(a) * r, z = Math.cos(a) * r;
  return [x, T.surfaceAt(id, x, z) + (up || 40), z];
};

// 1. inArc handles arcs across the +-PI seam
ok(RG.inArc(Math.PI - 0.1, Math.PI - 0.6, Math.PI + 0.6) && RG.inArc(-Math.PI + 0.1, Math.PI - 0.6, Math.PI + 0.6), 'arc across the seam');
ok(!RG.inArc(0, Math.PI - 0.6, Math.PI + 0.6) && RG.inArc(0.5, -0.6, 0.6) && !RG.inArc(0.7, -0.6, 0.6), 'arc bounds');

near(RG.arcMid({ angleFrom: -0.6, angleTo: 0.6 }), 0, 1e-12, 'arc middle');
near(Math.abs(RG.arcMid({ angleFrom: Math.PI - 0.6, angleTo: Math.PI + 0.6 })), Math.PI, 1e-9, 'arc middle across the seam');

// 2. exitAt: only near the edge, inside an exit arc, heading outward
{
  const near0 = at('ash', 0, 30), far0 = at('ash', 0, 300), side = at('ash', Math.PI / 2, 30);
  const e = RG.exitAt('ash', near0, 0);
  ok(e && e.to === 'wild', 'ash north edge heading out offers Wildwood');
  ok(RG.exitAt('ash', near0, Math.PI) === null, 'heading inward: no exit');
  ok(RG.exitAt('ash', far0, 0) === null, 'far from the edge: no exit');
  ok(RG.exitAt('ash', side, Math.PI / 2) === null, 'edge outside the exit arc: no exit');
  const w = RG.exitAt('wild', at('wild', Math.PI, 30), Math.PI);
  ok(w && w.to === 'ash', 'wild south edge heading out offers Ash Wastes');
  ok(RG.exitAt('wild', at('wild', Math.PI + 0.5, 20), Math.PI + 0.5) && RG.exitAt('wild', at('wild', -Math.PI + 0.5, 20), -Math.PI + 0.5), 'wild exit arc spans the seam');
}

// 3. entry placement: inside the radius, away from the soft edge and exit band, above ground, facing the centre
for (const [to, from] of [['wild', 'ash'], ['ash', 'wild']]) {
  const e = RG.entryPoint(to, from), R = T.region(to);
  const r = Math.hypot(e.pos[0], e.pos[2]);
  ok(r < R.radius - F.SOFT_EDGE - 50 && r < R.radius - D.travel.edgeBand, to + ': entry is inside the soft edge');
  ok(e.pos[1] > T.surfaceAt(to, e.pos[0], e.pos[2]) + D.flight.minAlt && e.pos[1] < R.ceiling, to + ': entry altitude in range');
  const inward = Math.atan2(-e.pos[0], -e.pos[2]);
  ok(Math.abs(wrap(e.yaw - inward)) < 1e-9, to + ': entry faces the centre');
  ok(RG.exitAt(to, e.pos, e.yaw) === null, to + ': no exit offered at the entry');
}
{
  // arriving from Ash lands on Wildwood's Ash-facing (south) edge, and back
  const w = RG.entryPoint('wild', 'ash'), a = RG.entryPoint('ash', 'wild');
  ok(w.pos[2] < -500 && Math.abs(w.pos[0]) < 1, 'Wildwood entry is on its south edge');
  ok(a.pos[2] > 500 && Math.abs(a.pos[0]) < 1, 'Ash entry is on its north edge (beside the exit)');
}

// 4. flying straight at the exit raises the offer; it lingers after turning back, then expires
{
  const cs = S.create({ regionId: 'ash', rng: mulberry(3) });
  cs.dragon.pilot = F.newPilot(at('ash', 0, 300, 60), 0, 30);
  const d = cs.dragon;
  d.pilot = F.newPilot(at('ash', 0.1, 260, 60), 0.1, 30);
  let ev = [], t = 0;
  while (!cs.exit && t < 20) { ev.push(...S.step(cs, {}, dt)); t += dt; }
  ok(cs.exit && cs.exit.to === 'wild', 'cruising north reaches the Wildwood exit (' + t.toFixed(1) + ' s)');
  ok(ev.filter(e => e.e === 'region:exit').length === 1, 'region:exit raised once');
  ok(cs.region === 'ash', 'no travel without confirm');
  // the soft boundary turns the dragon back; the offer stays for promptHold, then goes
  let left = 0;
  while (cs.exit && left < 30) { S.step(cs, {}, dt); left += dt; }
  ok(!cs.exit && left > D.travel.promptHold * 0.9, 'offer expires after the dragon turns back (' + left.toFixed(1) + ' s)');
  ok(Math.hypot(d.pilot.pos[0], d.pilot.pos[2]) < T.region('ash').radius, 'still inside Ash Wastes');
}

// 5. confirm travels: new region, entry placement, fresh prey field away from the dragon, carried prey kept
{
  const cs = S.create({ regionId: 'ash', rng: mulberry(9) });
  const d = cs.dragon;
  const goat = cs.field.list.find(p => p.type === 'goat');
  goat.state = 'carried'; d.carried = goat.id;
  d.pilot = F.newPilot(at('ash', 0, 30, 50), 0, 30);
  d.pilot.st = 42;
  const oldField = cs.field;
  const ev = S.step(cs, { confirm: true }, dt);
  ok(ev.some(e => e.e === 'region:exit') && ev.some(e => e.e === 'region:enter' && e.region === 'wild' && e.from === 'ash'), 'exit + enter events');
  ok(cs.region === 'wild' && cs.field !== oldField && cs.field.regionId === 'wild', 'switched to the Wildwood field');
  ok(cs.exit === null, 'offer cleared after travel');
  const e = RG.entryPoint('wild', 'ash');
  ok(Math.hypot(d.pilot.pos[0] - e.pos[0], d.pilot.pos[2] - e.pos[2]) < 2, 'dragon at the Wildwood entry');
  near(d.pilot.st, 42, 1, 'fire carries over');
  const types = new Set(cs.field.list.map(p => p.type));
  ok(types.has('deer') && types.has('boar'), 'Wildwood prey spawned');
  const live = cs.field.list.filter(p => p.state !== 'carried');
  ok(live.every(p => Math.hypot(p.pos[0] - d.pilot.pos[0], p.pos[2] - d.pilot.pos[2]) >= D.respawn.minDistFromDragon * 0.8), 'new herds spawn away from the dragon');
  const c = S.carriedPrey(cs);
  ok(c && c.type === 'goat' && c.state === 'carried', 'carried goat comes along');
  ok(cs.field.list.filter(p => p.id === c.id).length === 1, 'carried prey id unique in the new field');
  // it still eats normally
  let eaten = false;
  for (let i = 0; i < Math.ceil(D.eat.time / dt) + 2 && !eaten; i++) eaten = S.step(cs, { eat: true }, dt).some(x => x.e === 'prey:eaten');
  ok(eaten && d.carried === null, 'carried prey eaten after the trip');
}

// 6. five round trips: state stays finite, prey count bounded, regions alternate
{
  const cs = S.create({ regionId: 'ash', rng: mulberry(21) });
  const d = cs.dragon;
  d.pilot = F.newPilot(at('ash', 0, 200, 60), 0, 30);
  let trips = 0, tm = 0;
  while (trips < 10 && tm < 600) {
    const R = T.region(cs.region), out = cs.region === 'ash' ? 0 : Math.PI;
    // steer toward the exit side, confirm when offered
    const turn = wrap(out - d.pilot.yaw);
    const ev = S.step(cs, { sx: Math.max(-1, Math.min(1, -turn * 2)), confirm: !!cs.exit }, dt);
    if (ev.some(e => e.e === 'region:enter')) trips++;
    tm += dt;
    ok(Number.isFinite(d.pilot.pos[0] + d.pilot.pos[1] + d.pilot.pos[2]) && Math.hypot(d.pilot.pos[0], d.pilot.pos[2]) <= R.radius + 1e-6, 'finite, in bounds');
    ok(cs.field.list.length <= D.preyAi.maxActive, 'prey count bounded');
  }
  ok(trips === 10, '5 round trips flown (' + trips + ' crossings, ' + Math.round(tm) + ' s)');
  ok(cs.region === 'ash', 'back home in Ash Wastes');
}

// 7. unknown region throws, no exits in a region without exits
{
  const cs = S.create({ regionId: 'ash', rng: mulberry(1) });
  let threw = false;
  try { RG.enter(cs, 'nowhere', 'ash'); } catch (_) { threw = true; }
  ok(threw && cs.region === 'ash', 'unknown region rejected, state untouched');
}

// 8. debug region jump: enter works between regions without a shared exit (Ash Wastes -> Farmlands and back)
{
  const cs = S.create({ regionId: 'ash', rng: mulberry(3) });
  cs.dragon.pilot = F.newPilot(at('ash', 0, 300, 60), 0, 30);
  for (const [to, from] of [['farm', 'ash'], ['ash', 'farm'], ['wild', 'ash'], ['farm', 'wild']]) {
    const ev = RG.enter(cs, to, from), p = cs.dragon.pilot, R = T.region(to);
    ok(ev[0].e === 'region:enter' && cs.region === to && cs.field, 'jump ' + from + ' -> ' + to);
    ok(Number.isFinite(p.pos[1]) && p.pos[1] > T.surfaceAt(to, p.pos[0], p.pos[2]) && p.pos[1] < R.ceiling && Math.hypot(p.pos[0], p.pos[2]) < R.radius, 'placed in the air inside ' + to);
  }
}
