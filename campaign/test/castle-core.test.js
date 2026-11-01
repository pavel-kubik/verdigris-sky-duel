// Castle solids (Phase 3 T03, 003 spec 5.2): castle pieces from the wall polygon as settlement buildings in the
// Veltava Bend, solids block walking and flying, wall walks and bastion tops are landable and walkable, keep, spire
// and tower roofs refuse landing ('roof'), the gate gap is open or solid with the portcullis, and the whole castle
// stands on the flat top of the Vyshgard rock.
'use strict';
const { ok, near, core } = require('./harness.js');
const D = core('data'), CA = core('castle'), SE = core('settlement'), T = core('terrain'), W = core('walk'), F = core('flight');
const ST = core('state');

/* layout: walk tops and the gate gap */
const L = CA.layout();
for (const s of L.segments) ok(s.h === D.buildings.wall.h && s.walkTop === D.buildings.wall.walkTop, 'wall run carries h and walkTop');
ok(!!L.gate, 'the layout has a gate gap');
near(L.gate.w, D.castle.gate.w, 1e-9, 'gate gap width from data.castle.gate.w');
ok(L.segments[L.gate.seg].gate, 'gate gap on the gate run');

/* pieces */
const P = CA.pieces();
const def = D.settlements.castle;
const walls = P.filter(p => p.type === 'wall'), port = P.filter(p => p.type === 'portcullis');
ok(port.length === 1 && port[0].gate && port[0].seg, 'one portcullis piece in the gate gap');
near(port[0].len, D.castle.gate.w, 1e-6, 'portcullis spans the gate gap');
ok(walls.length === def.walls.length - 1 + 2, 'a wall run per segment, the gate run split into two stubs: ' + walls.length);
for (const w of walls) near(w.r, D.castle.wallThick / 2, 1e-9, 'wall capsule radius = wallThick / 2');
ok(P.filter(p => !p.seg).length === def.corners.length + def.buildings.length, 'corners and inner buildings are cylinders');

/* in the Bend */
const town = SE.build('bend');
const place = town.places.find(p => p.type === 'castle');
ok(place && place.castle, 'the castle stands in the Veltava Bend');
const site = T.region('bend').settlements.find(s => s.type === 'castle');
const plat = T.region('bend').terrain.features.find(f => f.type === 'plateau' && Math.hypot(f.x - site.x, f.z - site.z) < 1);
ok(!!plat, 'the castle sits on the Vyshgard plateau');
const cb = town.buildings.filter(b => b.place === place.id);
ok(cb.length === P.length, 'every castle piece is a building of the town: ' + cb.length);
const y0 = T.surfaceAt('bend', site.x, site.z);
let worst = 0;
for (const b of cb) {
  const pts = b.seg ? [[b.seg[0], b.seg[1]], [b.seg[2], b.seg[3]], [(b.seg[0] + b.seg[2]) / 2, (b.seg[1] + b.seg[3]) / 2]] : [[b.pos[0], b.pos[2]]];
  if (!b.seg) for (let k = 0; k < 8; k++) pts.push([b.pos[0] + Math.sin(k * Math.PI / 4) * b.r, b.pos[2] + Math.cos(k * Math.PI / 4) * b.r]);
  for (const [x, z] of pts) worst = Math.max(worst, Math.abs(T.surfaceAt('bend', x, z) - y0));
}
ok(worst < 0.8, 'every castle footprint is on the flat top of the rock (max step ' + worst.toFixed(2) + ')');
ok(!T.liquidAt('bend', site.x, site.z), 'the castle is dry');

const byType = t => cb.filter(b => b.type === t);
const midOf = b => [(b.seg[0] + b.seg[2]) / 2, (b.seg[1] + b.seg[3]) / 2];
const longWall = byType('wall').slice().sort((a, b) => b.len - a.len)[0];
const [wx, wz] = midOf(longWall);
const bas = byType('bastion')[0], keep = byType('keep')[0], chapel = byType('chapel')[0], tower = byType('ctower')[0];

/* solids */
ok(SE.solidAt(town, wx, wz) != null, 'a wall run is a solid');
near(SE.solidAt(town, wx, wz), longWall.pos[1] + D.buildings.wall.walkTop, 1e-6, 'standing height on the wall = the walk top');
ok(SE.hit(town, wx, wz, 2) != null, 'a wall run blocks flight and walking (hit)');
near(SE.surfaceAt(town, wx, wz), longWall.pos[1] + D.buildings.wall.walkTop, 1e-6, 'surfaceAt: the wall walk');
near(SE.surfaceAt(town, bas.pos[0], bas.pos[2]), bas.pos[1] + D.buildings.bastion.walkTop, 1e-6, 'surfaceAt: the bastion top');
for (const b of [keep, chapel, tower]) ok(SE.surfaceAt(town, b.pos[0], b.pos[2]) == null, b.type + ' roof is no walk top');

/* landing */
const sol = (scale) => { const pad = D.settlement.pad * (scale || 1);
  return { solidAt: (x, z) => SE.solidAt(town, x, z, pad), walkTop: (x, z) => SE.surfaceAt(town, x, z) }; };
const s1 = sol(1);
function over(x, z, alt, speed) { return F.newPilot([x, (SE.solidAt(town, x, z) || T.surfaceAt('bend', x, z)) + alt, z], 0, speed || 20); }
ok(W.canLand(over(wx, wz, 6), 'bend', s1.solidAt, s1.walkTop).ok, 'the wall walk is landable');
ok(W.canLand(over(bas.pos[0], bas.pos[2], 6), 'bend', s1.solidAt, s1.walkTop).ok, 'a bastion top is landable');
ok(W.canLand(over(wx, wz, D.land.maxAlt + 3), 'bend', s1.solidAt, s1.walkTop).why === 'high', 'too high over the wall walk: high');
for (const b of [keep, chapel, tower]) ok(W.canLand(over(b.pos[0], b.pos[2], 6), 'bend', s1.solidAt, s1.walkTop).why === 'roof', b.type + ' roof refuses landing: roof');
ok(W.canLand(over(wx, wz, 6), 'bend', s1.solidAt).why === 'roof', 'without walk tops a wall is a roof (old callers)');
const yard = [site.x + 10, site.z + 2];
ok(SE.solidAt(town, yard[0], yard[1], D.settlement.pad) == null, 'the courtyard is open ground');
ok(W.canLand(over(yard[0], yard[1], 6), 'bend', s1.solidAt, s1.walkTop).ok, 'the courtyard is landable');

/* walking on the wall walk: land, walk along it, stay on top */
{
  const pad = D.settlement.pad, ctx = { regionId: 'bend', scale: 1, solidAt: (x, z) => SE.solidAt(town, x, z, pad), solidHit: (x, z) => SE.hit(town, x, z, pad) };
  const p = over(wx, wz, 5, 10);
  p.yaw = longWall.yaw;
  W.startLanding(p);
  for (let i = 0; i < 200 && p.mode !== 'ground'; i++) W.blend(p, 1 / 30, ctx);
  ok(p.mode === 'ground', 'landed on the wall walk');
  near(p.pos[1], longWall.pos[1] + D.buildings.wall.walkTop + D.walk.stand, 0.05, 'standing on the walk top');
  const x0 = p.pos[0], z0 = p.pos[2];
  for (let i = 0; i < 60; i++) W.step(p, { sx: 0, sy: 1 }, 1 / 30, ctx);
  ok(Math.hypot(p.pos[0] - x0, p.pos[2] - z0) > 3, 'walks along the wall walk');
  near(p.pos[1], longWall.pos[1] + D.buildings.wall.walkTop + D.walk.stand, 0.05, 'still on the walk top after walking');
}

/* walking into a wall from the courtyard is blocked */
{
  const pad = D.settlement.pad, ctx = { regionId: 'bend', scale: 1, solidAt: (x, z) => SE.solidAt(town, x, z, pad), solidHit: (x, z) => SE.hit(town, x, z, pad) };
  const n = [-(longWall.seg[3] - longWall.seg[1]), longWall.seg[2] - longWall.seg[0]], nl = Math.hypot(n[0], n[1]);
  const c = [site.x, site.z], toC = [c[0] - wx, c[1] - wz], sgn = Math.sign(n[0] * toC[0] + n[1] * toC[1]) || 1;
  const ux = n[0] / nl * sgn, uz = n[1] / nl * sgn;           // from the wall toward the courtyard
  const start = [wx + ux * 10, wz + uz * 10];
  ok(!W.passable(ctx, start[0], start[1], wx, wz, 1), 'a wall cannot be walked into from the courtyard');
}

/* gate */
{
  const pc = town.buildings.find(b => b.place === place.id && b.type === 'portcullis');
  const [gx, gz] = midOf(pc);
  const pad = D.settlement.pad, ctx = { regionId: 'bend', scale: 1, solidAt: (x, z) => SE.solidAt(town, x, z, pad), solidHit: (x, z) => SE.hit(town, x, z, pad) };
  ok(CA.gateOpen(town), 'the gate starts open');
  ok(SE.solidAt(town, gx, gz) == null, 'open gate: no solid in the gap');
  const out = [gx + 6, gz], inn = [gx - 6, gz];                // the gate run is roughly north-south on the east side
  ok(W.passable(ctx, out[0], out[1], gx, gz, 1) && W.passable(ctx, gx, gz, inn[0], inn[1], 1), 'open gate: the gap is walkable');
  CA.closeGate(town);
  ok(!CA.gateOpen(town) && SE.solidAt(town, gx, gz) != null, 'closed gate: the portcullis is a solid');
  ok(!W.passable(ctx, out[0], out[1], gx, gz, 1), 'closed gate: the gap is blocked');
  ok(SE.hit(town, gx, gz, 1) != null, 'closed gate blocks flight');
  CA.openGate(town);
  ok(SE.solidAt(town, gx, gz) == null, 'gate opens again');
}

/* stone pieces do not burn (charring comes with T06) */
{
  const t2 = SE.build('bend');
  const w = t2.buildings.find(b => b.type === 'wall');
  const cone = { origin: [w.pos[0] + 6, w.pos[1] + 6, w.pos[2]], dir: [-0.7, -0.7, 0], range: 20, cone: 0.4 };
  for (let i = 0; i < 300; i++) SE.burn(t2, cone, 1 / 10, { rng: () => 0 });
  ok(!w.ruin && !(w.fire > 0), 'a stone wall never catches fire');
}

/* state wiring: solids() offers the walk tops */
ok(typeof ST.solids === 'function', 'state.solids exists');
