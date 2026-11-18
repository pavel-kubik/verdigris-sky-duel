// Region edges in the one world: exits are whole sides, flying over a shared edge moves the dragon into the next region
// where it is (no teleport, no prompt), walls where the dragon may not go (the world's edge, a region it is too small
// for), entry placement for jumps, prey respawn, carried prey, round trips.
'use strict';
const { ok, near, core } = require('./harness.js');
const RG = core('region'), S = core('state'), T = core('terrain'), D = core('data'), F = core('flight'), PR = core('prey');
const { mulberry, wrap } = core('math');
const dt = 1 / 60;
const at = (id, x, z, up) => [x, T.surfaceAt(id, x, z) + (up || 40), z];

// 1. arcs: inArc still handles arcs across the +-PI seam; a side's bearing is 0 (north) or PI (south)
ok(RG.inArc(Math.PI - 0.1, Math.PI - 0.6, Math.PI + 0.6) && RG.inArc(-Math.PI + 0.1, Math.PI - 0.6, Math.PI + 0.6), 'arc across the seam');
ok(!RG.inArc(0, Math.PI - 0.6, Math.PI + 0.6) && RG.inArc(0.5, -0.6, 0.6) && !RG.inArc(0.7, -0.6, 0.6), 'arc bounds');
near(RG.arcMid({ to: 'ash', side: 'n' }), 0, 1e-12, 'north side bearing');
near(RG.arcMid({ to: 'wild', side: 's' }), Math.PI, 1e-12, 'south side bearing');

// 2. exitAt: only near an exit side, heading outward
{
  const R = T.region('ash').radius, near0 = at('ash', 0, -(R - 30)), far0 = at('ash', 0, -(R - 300)), side = at('ash', R - 30, 0);
  const e = RG.exitAt('ash', near0, Math.PI);
  ok(e && e.to === 'wild', 'ash south edge heading out: the Wildwood');
  ok(RG.exitAt('ash', near0, 0) === null, 'heading inward: no exit');
  ok(RG.exitAt('ash', far0, Math.PI) === null, 'far from the edge: no exit');
  ok(RG.exitAt('ash', side, Math.PI / 2) === null, 'the west edge is the world edge: no exit');
  ok(RG.exitAt('ash', at('ash', 0, R - 30), 0) === null, 'north of Mount Rip: the world edge');
  const w = RG.exitAt('wild', at('wild', 300, T.region('wild').radius - 30), 0.3);
  ok(w && w.to === 'ash', 'wild north edge heading out: Mount Rip');
}

// 3. bound: the world's edges and a region too big for the dragon are walls, a shared edge is not
{
  const R = T.region('wild').radius;
  const b0 = RG.bound('wild', [0, 50, -(R - 10)], 0), b1 = RG.bound('wild', [0, 50, -(R - 10)], 1);
  ok(b0.d < 20 && b0.nz > 0.99, 'a hatchling meets a wall at the Farmlands edge (turned north)');
  ok(b1.d > 200, 'a Drake does not: the Farmlands go on');
  const bw = RG.bound('wild', [R - 15, 50, 0], 1);
  ok(bw.d < 20 && bw.nx < -0.99, 'the west edge of the world is a wall (turned east)');
  const bn = RG.bound('ash', [0, 50, R - 15], 1);
  ok(bn.d < 20 && bn.nz < -0.99, 'north of Mount Rip is the world edge');
}

// 4. entry placement (jumps): inside the edge facing the other region, above ground, facing inward
for (const [to, from] of [['wild', 'ash'], ['ash', 'wild'], ['farm', 'bend'], ['bend', 'farm']]) {
  const e = RG.entryPoint(to, from), R = T.region(to);
  ok(T.inZone(to, e.pos[0], e.pos[2], D.travel.edgeBand), to + ': entry is inside the edge band');
  ok(e.pos[1] > T.surfaceAt(to, e.pos[0], e.pos[2]) + D.flight.minAlt && e.pos[1] < R.ceiling, to + ': entry altitude in range');
  const north = D.regions[from].origin[1] > R.origin[1];
  ok((e.pos[2] > 0) === north && Math.abs(e.pos[0]) < 1, to + ': entry on the side toward ' + from);
  ok(RG.exitAt(to, e.pos, e.yaw) === null, to + ': no exit at the entry');
}

// 5. flying over a shared edge: the same place in the next region's frame, a fresh prey field, the carried prey kept
{
  const cs = S.create({ regionId: 'ash', rng: mulberry(9) });
  const d = cs.dragon, R = T.region('ash');
  const goat = cs.field.list.find(p => p.type === 'goat');
  goat.state = 'carried'; d.carried = goat.id;
  d.pilot = F.newPilot(at('ash', 120, -(R.radius - 3), 60), Math.PI, 30);
  d.pilot.st = 42;
  const oldField = cs.field, [X0, Z0] = T.toWorld('ash', d.pilot.pos[0], d.pilot.pos[2]);
  let ev = [];
  for (let i = 0; i < 30 && cs.region === 'ash'; i++) ev = ev.concat(S.step(cs, {}, dt));
  ok(ev.some(e => e.e === 'region:enter' && e.region === 'wild' && e.from === 'ash' && e.seamless), 'region:enter (seamless)');
  ok(cs.region === 'wild' && cs.field !== oldField && cs.field.regionId === 'wild', 'switched to the Wildwood field');
  const [X1, Z1] = T.toWorld('wild', d.pilot.pos[0], d.pilot.pos[2]);
  ok(Math.hypot(X1 - X0, Z1 - Z0) < 20 && d.pilot.pos[2] > R.radius - 30, 'the dragon is where it was, at the Wildwood north edge');
  near(d.pilot.st, 42, 2, 'fire carries over');
  const live = cs.field.list.filter(p => p.state !== 'carried');
  ok(live.every(p => Math.hypot(p.pos[0] - d.pilot.pos[0], p.pos[2] - d.pilot.pos[2]) >= D.respawn.minDistFromDragon * 0.8), 'new herds spawn away from the dragon');
  const c = S.carriedPrey(cs);
  ok(c && c.type === 'goat' && c.state === 'carried', 'carried goat comes along');
  ok(cs.field.list.filter(p => p.id === c.id).length === 1, 'carried prey id unique in the new field');
  let eaten = false;
  for (let i = 0; i < Math.ceil(D.eat.time / dt) + 2 && !eaten; i++) eaten = S.step(cs, { eat: true }, dt).some(x => x.e === 'prey:eaten');
  ok(eaten && d.carried === null, 'carried prey eaten after the crossing');
  // the height is the same on both sides of the edge (one ground)
  for (let x = -1000; x <= 1000; x += 100) near(T.heightAt('ash', x, -R.radius), T.heightAt('wild', x, T.region('wild').radius), 1e-6, 'the edge at x ' + x + ' joins');
}

// 6. ten crossings north and south: state stays finite, inside the world, prey count bounded
{
  const cs = S.create({ regionId: 'ash', rng: mulberry(21) });
  const d = cs.dragon;
  cs.dragon.stage = 1;
  d.pilot = F.newPilot(at('ash', 0, -900, 60), Math.PI, 30);
  let trips = 0, tm = 0, want = 'wild';
  while (trips < 10 && tm < 900) {
    const out = T.region(cs.region).origin[1] > T.region(want).origin[1] ? Math.PI : 0;
    const turn = wrap(out - d.pilot.yaw);
    const ev = S.step(cs, { sx: Math.max(-1, Math.min(1, -turn * 2)), boost: true }, dt);
    if (ev.some(e => e.e === 'region:enter')) { trips++; want = cs.region === 'wild' ? 'ash' : 'wild'; }
    tm += dt;
    ok(Number.isFinite(d.pilot.pos[0] + d.pilot.pos[1] + d.pilot.pos[2]) && T.edgeDist(cs.region, d.pilot.pos[0], d.pilot.pos[2]) >= -1e-6, 'finite, in the world');
    const stock = (cs.town.pens || []).reduce((n, pn) => n + pn.count, 0);       // T18: penned livestock come on top
    ok(cs.field.list.filter(p => !p.pen).length <= D.preyAi.maxActive && cs.field.list.length <= D.preyAi.maxActive + stock, 'prey count bounded');
  }
  ok(trips === 10, '5 round trips flown (' + trips + ' crossings, ' + Math.round(tm) + ' s)');
  ok(cs.region === 'ash', 'back home in Ash Wastes');
}

// 7. unknown region throws
{
  const cs = S.create({ regionId: 'ash', rng: mulberry(1) });
  let threw = false;
  try { RG.enter(cs, 'nowhere', 'ash'); } catch (_) { threw = true; }
  ok(threw && cs.region === 'ash', 'unknown region rejected, state untouched');
}

// 8. debug region jump: enter works between any regions (Ash Wastes -> Farmlands and back)
{
  const cs = S.create({ regionId: 'ash', rng: mulberry(3) });
  cs.dragon.pilot = F.newPilot(at('ash', 0, -900, 60), Math.PI, 30);
  for (const [to, from] of [['farm', 'ash'], ['ash', 'farm'], ['wild', 'ash'], ['farm', 'wild']]) {
    const ev = RG.enter(cs, to, from), p = cs.dragon.pilot, R = T.region(to);
    ok(ev[0].e === 'region:enter' && cs.region === to && cs.field, 'jump ' + from + ' -> ' + to);
    ok(Number.isFinite(p.pos[1]) && p.pos[1] > T.surfaceAt(to, p.pos[0], p.pos[2]) && p.pos[1] < R.ceiling && T.inZone(to, p.pos[0], p.pos[2]), 'placed in the air inside ' + to);
  }
}
