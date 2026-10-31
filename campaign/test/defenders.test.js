// Defenders (Phase 2 T15): spawn on the posts, archer volleys at a low dragon (and none out of range), arrow lead,
// hits and damage, the projectile cap, peasants running to the bell and hiding, burning archers, a burned tower.
'use strict';
const { ok, near, core } = require('./harness.js');
const DF = core('defenders'), D = core('data'), T = core('terrain'), SE = core('settlement'), S = core('state'), F = core('flight');
const { mulberry } = core('math');
const A = D.defenders.archer;

function farm(seed) {
  const cs = S.create({ regionId: 'farm', rng: mulberry(seed || 5) });
  cs.dragon.stage = 1; cs.dragon.hp = 9999;
  cs.dragon.pilot = F.newPilot([0, 200, -900], 0, 30);
  S.step(cs, {}, 0.016);
  return cs;
}
/** Hold the dragon still at pos (no flight drift) for n steps of dt; returns the events. */
function hold(cs, pos, n, dt, each) {
  const ev = [];
  for (let i = 0; i < n; i++) {
    const p = cs.dragon.pilot;
    p.pos = pos.slice(); p.speed = 0; p.vel = [0, 0, 0]; p.mode = 'air';
    for (const e of S.step(cs, {}, dt || 0.05)) ev.push(e);
    if (each) each(i);
  }
  return ev;
}
const inFront = (d, dist, alt) => {
  const x = d.pos[0] + Math.sin(d.base) * dist, z = d.pos[2] + Math.cos(d.base) * dist;
  return [x, T.surfaceAt('farm', x, z) + alt, z];
};

// 1. spawn: archers on the towers (template counts), a watcher per platform, peasants with homes
{
  const town = SE.build('farm'), sq = DF.spawn(town, mulberry(1));
  const of = (place, kind) => sq.list.filter(d => d.place === place && d.kind === kind);
  ok(of('farm.outpost', 'archer').length === 4, 'outpost: 4 archers');
  const towers = new Set(of('farm.outpost', 'archer').map(d => d.building));
  ok(towers.size === 2, 'spread over both towers');
  ok(of('farm.outpost', 'ballista').length === 2, 'a watcher on each ballista platform');
  ok(of('farm.village', 'archer').length === 2 && of('farm.village', 'peasant').length === 6, 'village: 2 archers, 6 peasants');
  ok(of('farm.hamlet', 'peasant').length === 3 && of('farm.hamlet', 'archer').length === 0, 'hamlet: 3 peasants, no archers');
  for (const d of of('farm.outpost', 'archer')) {
    const b = town.buildings.find(x => x.id === d.building);
    near(d.pos[1], b.pos[1] + b.h + D.perception.watch.eye, 1e-9, 'archer eye on the tower top');
    ok(Math.hypot(d.pos[0] - b.pos[0], d.pos[2] - b.pos[2]) < b.r, 'archer stands on its tower');
  }
  const ids = new Set(sq.list.map(d => d.id));
  ok(ids.size === sq.list.length, 'unique defender ids');
  const wild = DF.spawn(SE.build('wild'), mulberry(1));
  ok(wild.list.filter(d => d.kind === 'archer').length === 2, 'Wildwood: 2 archers on the small outpost');
  const rs = { ruins: [{ id: 'wild.outpostS.tower1', at: 0 }] };
  ok(DF.spawn(SE.build('wild', rs), mulberry(1)).list.filter(d => d.kind === 'archer' && d.alive).length === 0, 'a ruined tower has no archers');
}

// 2. aimArrow leads a moving target (no gravity: meets it exactly), gravity adds the drop back
{
  const from = [0, 0, 0], q = [0, 0, 70], vel = [20, 0, 0];
  const a = DF.aimArrow(from, q, vel, 70, 0);
  const at = [a.v[0] * a.t, a.v[1] * a.t, a.v[2] * a.t], meet = [q[0] + vel[0] * a.t, 0, q[2]];
  ok(Math.hypot(at[0] - meet[0], at[2] - meet[2]) < 0.5, 'arrow meets the moving target: ' + at.map(v => v.toFixed(2)));
  const g = DF.aimArrow(from, [0, 0, 70], [0, 0, 0], 70, 30);
  near(g.v[1], 0.5 * 30 * g.t, 1e-9, 'gravity compensation = 0.5 g t');
}

// 3. archers on the outpost tower volley at a low dragon, the arrows hit; no volley once it climbs out of range
{
  const cs = farm(7);
  const arch = cs.squad.list.filter(d => d.kind === 'archer' && d.place === 'farm.outpost');
  const d = arch[0], at = inFront(d, 60, 20);
  let fired = 0, hits = 0, dmg = 0;
  cs.bus.on('arrow:fired', () => fired++);
  cs.bus.on('arrow:hit', e => { hits++; dmg += e.damage; });
  const hp0 = cs.dragon.hp;
  hold(cs, at, 200, 0.05);
  ok(d.state === 'alert', 'the archer is alert');
  ok(fired >= A.volley * 2, 'volleys fired: ' + fired);
  ok(hits > 0 && hits <= fired, 'arrows hit the hovering dragon: ' + hits + ' of ' + fired);
  near(cs.dragon.hp, hp0 - dmg, 1e-9, 'each hit costs archer.damage HP');
  ok(cs.squad.arrows.length <= D.projectiles.max, 'pool bounded');
  // climb: 60 out and 150 up is beyond range (and the altitude makes it hard to see)
  const high = inFront(d, 60, 160);
  hold(cs, high, 40, 0.05);
  const before = fired;
  hold(cs, high, 200, 0.05);
  ok(fired === before, 'no arrows at a dragon out of range (' + (fired - before) + ')');
  ok(arch.every(a => a.target === null), 'nobody aims');
}

// 4. arrows: a moving dragon is led; at most projectiles.max in the pool even with many archers
{
  const cs = farm(9);
  const d = cs.squad.list.find(x => x.kind === 'archer' && x.place === 'farm.outpost');
  const at = inFront(d, 70, 18);
  let hits = 0;
  cs.bus.on('arrow:hit', () => hits++);
  // fly across the tower's front at 20 (sideways), pass after pass: the lead keeps hitting
  const side = [Math.cos(d.base), 0, -Math.sin(d.base)];
  let fired = 0;
  cs.bus.on('arrow:fired', () => fired++);
  for (let pass = 0; pass < 4; pass++) {
    const p = cs.dragon.pilot;
    Object.assign(p, { pos: [at[0] - side[0] * 60, at[1], at[2] - side[2] * 60], yaw: Math.atan2(side[0], side[2]), pitch: 0, speed: 30, mode: 'air' });
    for (let i = 0; i < 80; i++) { p.pos[1] = at[1]; p.pitch = 0; S.step(cs, {}, 0.05); }   // real flight: p.vel is the true velocity
  }
  ok(hits > 0 && hits >= fired * 0.2, 'a crossing dragon is hit (led): ' + hits + ' of ' + fired);
  const sq = DF.spawn(SE.build('farm'), mulberry(2));
  const fake = { dragon: { pilot: F.newPilot(at, 0, 0) }, town: sq.town, region: 'farm', squad: sq, inLair: false, rng: mulberry(4) };
  fake.dragon.pilot.inv = 99;                          // rolling: arrows pass
  for (const x of sq.list) if (x.kind === 'archer') { x.cool = 0; }
  for (let i = 0; i < 2000; i++) {
    for (const x of sq.list) if (x.kind === 'archer') { x.state = 'alert'; x.aware = 1; x.seen = 1; x.cool = 0; x.shots = 3; x.gap = 0; x.yaw = Math.atan2(at[0] - x.pos[0], at[2] - x.pos[2]); }
    DF.step(fake, [], 0.02, { scale: 1, spot: 1 });
    ok(sq.arrows.length <= D.projectiles.max, 'never over ' + D.projectiles.max + ' arrows');
  }
}

// 5. peasants: alert ones run to the bell, one rings it ('bell:ring' alerts the settlement), then they hide
{
  const cs = farm(11);
  const town = cs.town, vp = town.places.find(p => p.id === 'farm.village');
  const bell = town.buildings.find(b => b.place === vp.id && b.type === 'bell');
  const peas = cs.squad.list.filter(d => d.kind === 'peasant' && d.place === vp.id);
  const x = vp.x + 40, z = vp.z + 40, pos = [x, T.surfaceAt('farm', x, z) + 14, z];
  const rings = [];
  cs.bus.on('bell:ring', e => rings.push(e));
  for (const d of peas) { d.aware = 1; d.state = 'alert'; d.focus = pos.slice(); }
  let near0 = Infinity;
  hold(cs, pos, 400, 0.05, () => { for (const d of peas) near0 = Math.min(near0, Math.hypot(d.pos[0] - bell.pos[0], d.pos[2] - bell.pos[2])); });
  ok(near0 < bell.r + 2, 'a peasant reached the bell');
  ok(rings.length === 1 && rings[0].place === vp.id, 'the bell rang once: ' + rings.length);
  const archers = cs.squad.list.filter(d => d.kind === 'archer' && d.place === vp.id);
  ok(archers.every(a => a.state === 'alert' || a.state === 'search'), 'the bell alerts the village archers');
  ok(peas.filter(d => d.hidden).length >= 4, 'peasants hide: ' + peas.filter(d => d.hidden).length + ' of ' + peas.length);
  for (const d of peas) ok(!SE.hit(town, d.pos[0], d.pos[2], 0) || d.hidden, 'no peasant stands inside a wall');
  // after searchTime they come out
  cs.dragon.pilot.pos = [0, 200, -900];
  hold(cs, [0, 200, -900], Math.ceil((D.perception.searchTime + 5) / 0.1), 0.1);
  ok(peas.every(d => !d.hidden), 'they come out after the search time');
}

// 6. the breath: archers in the cone burn and die, peasants panic but live
{
  const town = SE.build('farm'), sq = DF.spawn(town, mulberry(3));
  const d = sq.list.find(x => x.kind === 'archer'), pe = sq.list.find(x => x.kind === 'peasant');
  const cone = o => ({ origin: [o.pos[0], o.pos[1] + 0.8, o.pos[2] - 10], dir: [0, 0, 1], range: 30, cone: 0.3 });
  let ev = [], n = 0;
  for (; n < 100 && d.alive; n++) ev = ev.concat(DF.burn(sq, cone(d), 0.05));
  ok(!d.alive && ev.some(e => e.e === 'defender:killed' && e.id === d.id && e.cause === 'fire'), 'archer burned');
  near(n * 0.05, A.hp / D.defense.burn, 0.051, 'burns in hp / defense.burn s');
  for (let i = 0; i < 100; i++) DF.burn(sq, cone(pe), 0.05);
  ok(pe.alive && pe.state === 'alert' && pe.panic, 'peasant panics, alive');
  ok(DF.zones(sq).length === 1, 'a danger zone where archers still stand (the outpost)');
}

// 7. a tower burned down: its archers fall; rebuilt: new archers stand on it
{
  const cs = farm(13);
  const tw = cs.town.buildings.find(b => b.place === 'farm.outpost' && b.type === 'tower');
  const on = cs.squad.list.filter(d => d.building === tw.id);
  const killed = [], back = [];
  cs.bus.on('defender:killed', e => killed.push(e));
  cs.bus.on('defender:back', e => back.push(e));
  tw.ruin = true; tw.ruinAt = cs.stats.played;
  hold(cs, [0, 200, -900], 2);
  ok(on.length === 2 && on.every(d => !d.alive) && killed.filter(e => e.cause === 'fall').length === 2, 'both archers fell');
  tw.ruin = false;
  hold(cs, [0, 200, -900], 2);
  ok(on.every(d => d.alive) && back.length === 2, 'rebuilt tower: archers back');
}

// 8. in the cave nobody shoots; the danger zones reach the mother (cs.danger)
{
  const cs = farm(15);
  const d = cs.squad.list.find(x => x.kind === 'archer' && x.place === 'farm.outpost');
  hold(cs, inFront(d, 50, 15), 60);
  ok(Array.isArray(cs.danger) && cs.danger.some(z => Math.hypot(z.x - d.pos[0], z.z - d.pos[2]) + A.range <= z.r + 1e-9), 'cs.danger has the outpost');
  cs.inLair = true;
  let fired = 0;
  cs.bus.on('arrow:fired', () => fired++);
  for (let i = 0; i < 100; i++) S.step(cs, {}, 0.05);
  ok(fired === 0, 'no arrows at a dragon in the cave');
  cs.inLair = false;
  DF.calm(cs.squad);
  ok(cs.squad.list.every(x => x.state === 'idle' && x.aware === 0) && cs.squad.arrows.length === 0, 'calm: everybody idle, no arrows');
}

// 9. arrows kill a weak dragon: cause 'arrows', wakes in the lair
{
  const cs = farm(17);
  cs.dragon.hp = 4;
  const d = cs.squad.list.find(x => x.kind === 'archer' && x.place === 'farm.outpost');
  let died = null;
  cs.bus.on('dragon:died', e => { died = e; });
  const at = inFront(d, 50, 15);
  for (let i = 0; i < 300 && !died; i++) { const p = cs.dragon.pilot; p.pos = at.slice(); p.speed = 0; p.vel = [0, 0, 0]; S.step(cs, {}, 0.05); }
  ok(died && died.cause === 'arrows', 'died of arrows');
  ok(cs.inLair, 'woke in the lair');
}
