// Castle defenders (Phase 3 T05, 003 spec 7): archers on the round towers, the gatehouses and the wall walks (post
// lists), ballistae on the bastions, the gate closes on alarm and opens after the search (never on a dragon in the
// gap), the keep's horn alerts every settlement of the region once per horn.cool, and a low pass along the wall draws
// volleys from the wall walk and a bolt from a bastion.
'use strict';
const { ok, near, core } = require('./harness.js');
const D = core('data'), CA = core('castle'), SE = core('settlement'), DF = core('defenders'), T = core('terrain');
const S = core('state'), F = core('flight');
const { mulberry } = core('math');

const town = SE.build('bend');
const pl = town.places.find(p => p.castle);
ok(!!pl, 'the Bend has a castle place');
const own = town.buildings.filter(b => b.place === pl.id);
const byId = id => town.buildings.find(b => b.id === id);
const eye = D.perception.watch.eye;

/* post lists */
const posts = CA.posts(town, pl);
const kinds = posts.map(s => byId(s.building).type);
ok(kinds.filter(k => k === 'ctower').length === own.filter(b => b.type === 'ctower').length, 'one post per round tower');
ok(kinds.filter(k => k === 'gatehouse').length === D.castle.posts.gatehouse * own.filter(b => b.type === 'gatehouse').length, 'posts on each gatehouse');
const wallPosts = posts.filter(s => byId(s.building).type === 'wall');
ok(wallPosts.length >= 10, 'wall walk posts along the runs: ' + wallPosts.length);
ok(kinds.slice(0, 6).every(k => k !== 'wall'), 'towers and gatehouses fill first');
for (const s of wallPosts) {
  const b = byId(s.building), d = SE.sd(b, s.x, s.z).d;
  ok(d <= 0, 'a wall post stands on its wall run (' + d.toFixed(2) + ')');
  near(s.y, b.pos[1] + D.buildings.wall.walkTop + eye, 1e-6, 'wall post eye over the walk top');
  near(SE.surfaceAt(town, s.x, s.z), b.pos[1] + D.buildings.wall.walkTop, 1e-6, 'a wall post is on the walkable wall top');
}
for (const s of posts) {
  const out = Math.sin(s.yaw) * (s.x - pl.x) + Math.cos(s.yaw) * (s.z - pl.z);
  ok(out > 0, 'a post faces out of the castle');
}
// the first wall posts spread over different runs
const firstRuns = new Set(wallPosts.slice(0, 5).map(s => s.building));
ok(firstRuns.size === 5, 'the first five wall posts are on five different runs');

/* spawn */
const sq = DF.spawn(town, mulberry(3));
const mine = sq.list.filter(d => d.place === pl.id);
const archers = mine.filter(d => d.kind === 'archer'), ballistae = mine.filter(d => d.kind === 'ballista');
ok(archers.length === D.settlements.castle.archers, 'castle archers from the template: ' + archers.length);
const onType = t => archers.filter(d => byId(d.building).type === t).length;
ok(onType('ctower') >= 2 && onType('gatehouse') >= 2 && onType('wall') >= 3, 'archers on towers, gatehouses and wall walks: ' +
  [onType('ctower'), onType('gatehouse'), onType('wall')].join('/'));
ok(new Set(archers.map(d => d.pos.map(v => v.toFixed(1)).join(','))).size === archers.length, 'every archer on its own spot');
ok(new Set(archers.map(d => d.id)).size === archers.length, 'archer ids are unique');
ok(ballistae.length === own.filter(b => b.type === 'bastion').length, 'a ballista on every bastion: ' + ballistae.length);
for (const d of ballistae) {
  const b = byId(d.building);
  ok(b.type === 'bastion', 'ballista on a bastion');
  near(d.pos[1], b.pos[1] + D.buildings.bastion.walkTop + eye, 1e-6, 'ballista stands on the bastion walk top');
}
// more archers than posts: side by side
const many = D.settlements.castle.archers;
D.settlements.castle.archers = posts.length + 3;
const sq2 = DF.spawn(town, mulberry(3));
const a2 = sq2.list.filter(d => d.place === pl.id && d.kind === 'archer');
ok(a2.length === posts.length + 3 && new Set(a2.map(d => d.pos.map(v => v.toFixed(1)).join(','))).size === a2.length, 'extra archers stand beside the others');
D.settlements.castle.archers = many;

/* horn: once per horn.cool, alerts the whole region */
function fresh() {
  const tw = SE.build('bend'), q = DF.spawn(tw, mulberry(7));
  return { tw, q };
}
{
  const { tw, q } = fresh();
  const pos = [pl.x + 150, pl.y + 60, pl.z];
  const others = q.list.filter(d => d.place !== pl.id && d.alive);
  ok(others.length > 0, 'the Bend has defenders outside the castle');
  ok(CA.step(q, { pos, pad: 2 }, 0.1).every(e => e.e !== 'horn:blow'), 'no horn while all is quiet');
  const wa = q.list.find(d => d.place === pl.id && d.kind === 'archer');
  wa.state = 'alert';
  const ev = CA.step(q, { pos, pad: 2 }, 0.1);
  ok(ev.filter(e => e.e === 'horn:blow').length === 1, 'the horn sounds when a castle defender is alert');
  ok(others.every(d => d.state === 'alert'), 'the horn alerts every settlement of the region');
  ok(others.every(d => d.focus && d.focus[0] === pos[0]), 'they all turn toward the dragon');
  ok(ev.some(e => e.e === 'aware:state' && e.place !== pl.id && e.horn), 'aware:state events for the other settlements');
  let blows = 0, t = 0;
  const dt = 0.5;
  while (t < D.castle.horn.cool * 2.5) {
    for (const d of q.list) if (d.alive && d.place === pl.id) d.state = 'alert';
    blows += CA.step(q, { pos, pad: 2 }, dt).filter(e => e.e === 'horn:blow').length;
    t += dt;
  }
  ok(blows === 2, 'over 2.5 x horn.cool of alarm the horn sounds twice more (once per cool): ' + blows);
  // a burned keep has no horn (stone never ruins in game, but the rule holds)
  const { tw: tw2, q: q2 } = fresh();
  tw2.buildings.find(b => b.place === pl.id && b.type === 'keep').ruin = true;
  q2.list.find(d => d.place === pl.id && d.kind === 'archer').state = 'alert';
  ok(CA.step(q2, { pos, pad: 2 }, 0.1).every(e => e.e !== 'horn:blow'), 'no keep, no horn');
  void tw;
}

/* gate: closes on alarm, opens after the search, never on a dragon in the gap */
{
  const { tw, q } = fresh();
  const gate = tw.buildings.find(b => b.place === pl.id && b.type === 'portcullis');
  const gx = (gate.seg[0] + gate.seg[2]) / 2, gz = (gate.seg[1] + gate.seg[3]) / 2;
  const away = [pl.x + 300, pl.y + 80, pl.z];
  ok(CA.gateOpen(tw) && SE.solidAt(tw, gx, gz) == null, 'the gate starts open (no solid in the gap)');
  const ca = q.list.filter(d => d.place === pl.id && d.alive);
  const setAll = st => { for (const d of ca) d.state = st; };
  setAll('alert');
  let ev = [], t = 0;
  while (t < D.castle.gate.close - 0.3) { ev = ev.concat(CA.step(q, { pos: away, pad: 2 }, 0.1)); t += 0.1; }
  ok(ev.some(e => e.e === 'gate:closing') && !tw.gateClosed, 'the portcullis drops over gate.close s');
  ok(tw.gateK > 0.7 && tw.gateK < 1, 'gateK on its way down: ' + tw.gateK.toFixed(2));
  for (let i = 0; i < 10; i++) ev = ev.concat(CA.step(q, { pos: away, pad: 2 }, 0.1));
  ok(tw.gateClosed && ev.some(e => e.e === 'gate:closed'), 'the gate closes on alarm');
  ok(SE.solidAt(tw, gx, gz) != null, 'a closed gate is a solid');
  ok(tw.signal, 'the signal fire burns while the castle is alarmed');
  setAll('search');
  CA.step(q, { pos: away, pad: 2 }, 0.1);
  ok(tw.gateClosed, 'the gate stays shut during the search');
  setAll('idle');
  ev = CA.step(q, { pos: away, pad: 2 }, 0.1);
  ok(!tw.gateClosed && ev.some(e => e.e === 'gate:open'), 'the gate opens after the search');
  ok(SE.solidAt(tw, gx, gz) == null, 'an opening gate is no solid');
  ok(!tw.signal, 'the signal fire goes out');
  for (let i = 0; i < 40; i++) CA.step(q, { pos: away, pad: 2 }, 0.1);
  ok(tw.gateK === 0, 'the grate is fully up again');

  // a dragon in the gap: the gate waits
  const inGap = [gx, gate.pos[1] + 3, gz];
  ok(CA.inGap(tw, inGap, 2), 'inGap: a dragon standing in the gate');
  ok(!CA.inGap(tw, [gx, gate.pos[1] + 40, gz], 2), 'inGap: high over the gate is not in the gap');
  ok(!CA.inGap(tw, away, 2), 'inGap: far away is not in the gap');
  setAll('alert');
  for (let i = 0; i < 60; i++) CA.step(q, { pos: inGap, pad: 2 }, 0.1);
  ok(!tw.gateClosed && (tw.gateK || 0) === 0, 'the gate never closes on a dragon in the gap');
  for (let i = 0; i < 10; i++) CA.step(q, { pos: away, pad: 2 }, 0.1);
  for (let i = 0; i < 5; i++) CA.step(q, { pos: inGap, pad: 2 }, 0.1);   // flies in while it drops: it waits again
  const kHalf = tw.gateK;
  ok(!tw.gateClosed && kHalf > 0 && kHalf < 1, 'half down, it stops while the dragon is under it: ' + kHalf.toFixed(2));
  for (let i = 0; i < 30; i++) CA.step(q, { pos: away, pad: 2 }, 0.1);
  ok(tw.gateClosed, 'and closes once the dragon is out');
  // debug toggle holds until the alarm changes
  CA.openGate(tw);
  for (let i = 0; i < 10; i++) CA.step(q, { pos: away, pad: 2 }, 0.1);
  ok(!tw.gateClosed, 'debug open holds while the alarm lasts');
  setAll('idle'); CA.step(q, { pos: away, pad: 2 }, 0.1); setAll('alert');
  for (let i = 0; i < 40; i++) CA.step(q, { pos: away, pad: 2 }, 0.1);
  ok(tw.gateClosed, 'a new alarm drives the gate again');
}

/* in game: a low pass along the wall draws volleys from the wall walk and a bolt from a bastion */
{
  const cs = S.create({ regionId: 'bend', rng: mulberry(11) });
  cs.dragon.stage = 1; cs.dragon.hp = 99999;
  cs.dragon.pilot = F.newPilot([pl.x, 300, pl.z - 600], 0, 30);
  S.step(cs, {}, 0.016);
  const q = cs.squad, wa = q.list.find(d => d.place === pl.id && d.kind === 'archer' && cs.town.buildings.find(b => b.id === d.building).type === 'wall');
  ok(!!wa, 'a wall walk archer in game');
  // fly slowly along the outside of that wall, 40 out and 18 over the walk, back and forth
  const b = cs.town.buildings.find(x => x.id === wa.building), [nx, nz] = CA.outward(b, pl);
  const ux = (b.seg[2] - b.seg[0]) / b.len, uz = (b.seg[3] - b.seg[1]) / b.len;
  const ev = [];
  let fromWall = 0, bolts = 0, horn = 0, closed = false, woke = false;
  for (let i = 0; i < 900; i++) {
    const s = Math.sin(i * 0.01) * 60, x = wa.pos[0] + nx * 40 + ux * s, z = wa.pos[2] + nz * 40 + uz * s;
    const p = cs.dragon.pilot;
    p.pos = [x, wa.pos[1] + 18, z]; p.vel = [ux * 3, 0, uz * 3]; p.speed = 3; p.mode = 'air';
    for (const e of S.step(cs, {}, 0.05)) {
      ev.push(e);
      if (e.e === 'arrow:fired' && /\.wall\d+\.archer/.test(e.id)) fromWall++;
      if (e.e === 'bolt:fire') bolts++;
      if (e.e === 'horn:blow') { horn++; woke = cs.squad.list.filter(d => d.place !== pl.id && d.alive && !d.hidden).every(d => d.state === 'alert'); }
      if (e.e === 'gate:closed') closed = true;
    }
  }
  ok(fromWall > 0, 'volleys from the wall walk: ' + fromWall + ' arrows');
  ok(bolts > 0, 'a bolt from a bastion: ' + bolts);
  ok(horn === 1, 'the horn sounds once in 45 s of fighting: ' + horn);
  ok(closed && cs.town.gateClosed, 'the gate closed on the alarm');
  const rs = cs.regionStates.bend;
  ok(rs && rs.heat > 0, 'the fight raised the Bend\'s alert heat: ' + (rs && rs.heat.toFixed(2)));
  ok(woke, 'the horn woke the other settlements');
  void T;
}
