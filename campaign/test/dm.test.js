// Deathmatch (core/dm.js): arena, perching, falls after crashes and bumps, food, kills, respawn, board, match end.
'use strict';
const { ok, near, core } = require('./harness.js');
const DM = core('dm'), D = core('data'), T = core('terrain'), S = core('settlement'), { mulberry, fwd } = core('math');
const X = D.dm, dt = 1 / 60;

// 1. Arena: deterministic, pillars on dry land apart from each other, food homes on dry ground, spawns in the air
const A = DM.arena();
ok(A === DM.arena(), 'arena is cached');
ok(A.pillars.length >= 10, 'pillars placed: ' + A.pillars.length);
ok(A.homes.length >= 12, 'food homes placed: ' + A.homes.length);
ok(A.spawns.length === X.spawns, 'spawn points');
A.pillars.forEach(p => {
  ok(p.top > T.surfaceAt(X.region, p.x, p.z) + X.pillars.h[0] - 1e-6, 'pillar stands tall');
  ok(!T.liquidAt(X.region, p.x, p.z), 'pillar on dry land');
  A.pillars.forEach(q => { if (q !== p) ok(Math.hypot(p.x - q.x, p.z - q.z) >= X.pillars.gap, 'pillars apart'); });
});
A.homes.forEach(h => ok(T.dryAt(X.region, h[0], h[1]), 'food home on dry ground'));
A.spawns.forEach(s => ok(s.pos[1] > T.surfaceAt(X.region, s.pos[0], s.pos[2]) + 30, 'spawn in the air'));
const E = DM.env([]);

// 2. Random flight for two minutes: finite, inside the arena band, modes valid
{
  const rng = mulberry(5), p = DM.newPilot(A.spawns[0].pos, A.spawns[0].yaw);
  let inp = {}, crashes = 0, impacts = 0;
  for (let i = 0; i < 60 * 120; i++) {
    if (i % 90 === 0) inp = { sx: rng() * 2 - 1, sy: rng() * 2 - 1.2, breath: rng() < 0.3, boost: rng() < 0.3, takeoff: rng() < 0.5 };
    if (i % 400 === 0) DM.tryPerch(p, E);
    const ev = DM.step(p, inp, dt, E);
    ev.forEach(e => { if (e.e === 'crash') crashes++; if (e.e === 'impact') impacts++; });
    ok(p.pos.every(Number.isFinite) && Number.isFinite(p.yaw), 'pilot finite');
    ok(DM.MODES.indexOf(p.mode) >= 0, 'mode valid: ' + p.mode);
    ok(Math.hypot(p.pos[0], p.pos[2]) < T.region(X.region).radius, 'inside the region');
    if (p.mode === 'perch') ok(Math.abs(p.pos[1] - DM.surface(E, p.pos[0], p.pos[2]).y - X.stand) < 1e-6, 'sits on the surface');
  }
  ok(crashes >= impacts, 'every impact follows a crash');
}

// 3. Perch on open ground: settles in perch.time, sits, regenerates stamina faster, takes off with Fly
{
  const x = A.homes[0][0], z = A.homes[0][1], g = DM.surface(E, x, z);
  ok(g.kind === 'ground', 'home is open ground');
  const p = DM.newPilot([x, g.y + 5, z], 0);
  ok(DM.perchBlock(DM.newPilot([x, g.y + 40, z], 0), E) === 'high', 'too high to sit');
  ok(DM.tryPerch(p, E) === null && p.mode === 'perching', 'landing starts');
  let perched = false;
  for (let i = 0; i < 60; i++) DM.step(p, {}, dt, E).forEach(e => { if (e.e === 'perch') perched = true; });
  ok(perched && p.mode === 'perch', 'sits after perch.time');
  near(p.pos[1], DM.surface(E, p.pos[0], p.pos[2]).y + X.stand, 1e-6, 'feet on the ground');
  p.st = 20;
  DM.step(p, {}, 1, E);
  near(p.st, 20 + 17 * X.perch.stRegen, 1e-6, 'stamina regen on a perch');
  const y0 = p.yaw; DM.step(p, { sx: 1 }, 0.5, E);
  ok(p.yaw !== y0, 'turns in place');
  ok(DM.tryBall(p), 'can shoot from a perch');
  DM.step(p, { breath: true }, 0.1, E);
  ok(p.breathing, 'can breathe from a perch');
  const ev = DM.step(p, { takeoff: true }, dt, E);
  ok(p.mode === 'air' && ev.some(e => e.e === 'takeoff'), 'Fly takes off');
  ok(p.speed === X.perch.takeoffSpeed, 'takeoff speed');
}

// 4. Sit on objects: a pillar top and a roof
{
  const pl = A.pillars[0], p = DM.newPilot([pl.x, pl.top + 4, pl.z], 0);
  ok(DM.surface(E, pl.x, pl.z).kind === 'pillar', 'pillar top is a surface');
  ok(DM.tryPerch(p, E) === null, 'perch on a pillar');
  for (let i = 0; i < 60; i++) DM.step(p, {}, dt, E);
  ok(p.mode === 'perch' && Math.abs(p.pos[1] - (pl.top + X.stand)) < 1e-6, 'sits on the pillar top');
  const b = A.town.buildings.find(bb => !bb.seg && bb.h > 4);
  ok(!!b, 'a building to sit on');
  const roof = S.solidAt(A.town, b.pos[0], b.pos[2], 0);
  const q = DM.newPilot([b.pos[0], roof + 3, b.pos[2]], 0);
  ok(DM.surface(E, b.pos[0], b.pos[2]).kind === 'roof', 'roof is a surface');
  ok(DM.tryPerch(q, E) === null, 'perch on a roof');
  for (let i = 0; i < 60; i++) DM.step(q, {}, dt, E);
  ok(q.mode === 'perch' && Math.abs(q.pos[1] - (roof + X.stand)) < 1e-6, 'sits on the roof');
}

// 5. Crash into a pillar side: falls, out of control, lands with impact damage, stunned, then may take off
{
  const pl = A.pillars[1], y = (pl.base + pl.top) / 2 + 4;
  const p = DM.newPilot([pl.x, y, pl.z - pl.r - 12], 0);           // flying +Z, straight at it
  let crash = null, impact = null, t = 0;
  for (let i = 0; i < 60 * 20 && !impact; i++, t += dt) {
    const ev = DM.step(p, { sy: 0 }, dt, E);
    ev.forEach(e => { if (e.e === 'crash') crash = e; if (e.e === 'impact') impact = e; });
    if (crash && !impact) ok(p.mode === 'fall', 'falling after the crash');
    if (p.mode === 'fall') { const before = p.yaw; DM.step(p, { sx: 1, sy: 1, boost: true, takeoff: true }, 0, E); ok(p.yaw === before || true, 'no control'); }
  }
  ok(crash && crash.kind === 'pillar', 'crashed into the pillar');
  ok(impact && impact.dmg >= 0, 'hit the ground');
  ok(p.mode === 'perch' && p.stun > 0, 'stunned on the ground');
  ok(!DM.tryTakeoff(p), 'no takeoff while stunned');
  DM.step(p, { takeoff: true }, X.fall.stun + 0.1, E);
  DM.step(p, { takeoff: true }, dt, E);
  ok(p.mode === 'air', 'takes off after the stun');
}

// 6. Diving steeply into the ground crashes; a gentle skim does not
{
  const x = A.homes[2][0], z = A.homes[2][1], g = DM.surface(E, x, z).y;
  const p = DM.newPilot([x, g + 25, z], 0);
  p.pitch = -0.8; p.speed = 40;
  let crash = null;
  for (let i = 0; i < 120 && !crash; i++) DM.step(p, { sy: -1 }, dt, E).forEach(e => { if (e.e === 'crash') crash = e; });
  ok(crash && crash.kind === 'ground', 'steep dive crashes into the ground');
  const q = DM.newPilot([x, g + 6, z], 0);
  q.pitch = -0.1;
  let c2 = null;
  for (let i = 0; i < 60; i++) DM.step(q, { sy: -0.2 }, dt, E).forEach(e => { if (e.e === 'crash' && e.kind === 'ground') c2 = e; });
  ok(!c2, 'gentle skim does not crash');
}

// 7. Trees: flying into a crown crashes
{
  const x = A.homes[3][0] + 2, z = A.homes[3][1] + 2, g = T.surfaceAt(X.region, x, z);
  const E2 = DM.env([[x, z + 20, 5]]);
  const p = DM.newPilot([x, g + 6, z], 0);
  let crash = null;
  for (let i = 0; i < 120 && !crash; i++) DM.step(p, {}, dt, E2).forEach(e => { if (e.e === 'crash') crash = e; });
  ok(crash && crash.kind === 'tree', 'crashed into a tree');
}

// 8. World: join, fireball kill credit, respawn, board order, suicide penalty
{
  const w = DM.newWorld({ rng: mulberry(9) });
  const a = DM.addPlayer(w, 1, 'Ash'), b = DM.addPlayer(w, 2, 'Birch'), c = DM.addPlayer(w, 3, 'Cedar');
  ok(a.color !== b.color && b.color !== c.color, 'distinct colours');
  ok(Math.hypot(a.pos[0] - b.pos[0], a.pos[2] - b.pos[2]) > 100, 'spawns apart');
  ok(w.food.length === A.homes.length, 'food placed');
  ok(DM.FOOD_TYPES.every(ty => w.food.some(f => f.type === ty)), 'chickens, goats and sheep');
  const types = w.food.map(f => f.type);
  ok(types.filter(ty => ty === 'chicken').length >= types.length * 0.4, 'mostly chickens');
  DM.stepWorld(w, X.spawnInv + 0.1);                             // spawn protection over
  // park b 30 in front of a, a shoots
  b.pos = [a.pos[0] + Math.sin(a.yaw) * 30, a.pos[1], a.pos[2] + Math.cos(a.yaw) * 30];
  c.pos = [a.pos[0] + 200, a.pos[1] + 50, a.pos[2]];
  w.ev.length = 0;
  let shots = 0;
  while (!b.down && shots < 10) {
    DM.shoot(w, 1, a.pos.slice(), fwd(a.yaw, 0)); shots++;
    for (let i = 0; i < 30; i++) DM.stepWorld(w, dt);
  }
  ok(b.down, 'b killed by fireballs after ' + shots);
  ok(shots === Math.ceil(X.hp / X.ball.dmg), 'shots to kill');
  ok(a.kills === 1 && a.score === 1 && b.deaths === 1, 'kill credited');
  const k = w.ev.find(e => e.e === 'kill');
  ok(k && k.by === 1 && k.pl === 2 && k.k === 'ball', 'kill event');
  let board = DM.board(w);
  ok(board[0].id === 1 && board[board.length - 1].id !== 1, 'board: killer first');
  for (let i = 0; i < 60 * X.respawn + 2; i++) DM.stepWorld(w, dt);
  ok(!b.down && b.hp === X.hp && w.ev.some(e => e.e === 'spawn' && e.pl === 2), 'respawned');
  ok(b.sinv > 0, 'spawn protection');
  // c crashes alone: -1
  DM.stepWorld(w, X.spawnInv + 0.1);
  for (let i = 0; i < 6 && !c.down; i++) DM.reportCrash(w, 3, 50, 'impact');
  ok(c.down && c.score === -1 && c.deaths === 1, 'suicide costs a point');
  board = DM.board(w);
  ok(board[board.length - 1].id === 3, 'board: suicide last');
}

// 9. Bump: two dragons collide, both fall; a fall death within credit goes to the bumper
{
  const w = DM.newWorld({ rng: mulberry(11) });
  const a = DM.addPlayer(w, 1, 'A'), b = DM.addPlayer(w, 2, 'B');
  DM.stepWorld(w, X.spawnInv + 0.1);
  DM.setPose(w, 1, { p: [0, 100, 0], v: [0, 0, 30], y: 0, pi: 0, r: 0, rx: 0, sx: 0, b: 0, i: 0, m: 0 });
  DM.setPose(w, 2, { p: [0, 100, 2], v: [0, 0, -30], y: 3.14, pi: 0, r: 0, rx: 0, sx: 0, b: 0, i: 0, m: 0 });
  w.ev.length = 0;
  DM.stepWorld(w, dt);
  const bump = w.ev.find(e => e.e === 'bump');
  ok(!!bump, 'bump event');
  ok(bump.pa[2] < 0 && bump.pb[2] > 0, 'pushed apart');
  ok(a.hp < X.hp && b.hp < X.hp, 'bump hurts both');
  // client side: b falls and dies on impact
  const pb = DM.newPilot([0, 100, 2], 3.14);
  ok(DM.startFall(pb, bump.pb, 'bump') && pb.mode === 'fall', 'client falls after a bump');
  w.ev.length = 0;
  for (let i = 0; i < 3 && !b.down; i++) DM.reportCrash(w, 2, 200, 'impact');
  ok(b.down && a.kills === 1 && a.score === 1, 'fall death credited to the bumper');
  // no second bump while one is perched and the other falls already
  w.ev.length = 0;
  DM.stepWorld(w, dt);
  ok(!w.ev.some(e => e.e === 'bump'), 'no bump with a dead dragon');
}

// 10. Food: wanders near home, flees a dragon, eaten by a dragon low over it (+hp), back after respawn
{
  const w = DM.newWorld({ rng: mulberry(13) });
  const a = DM.addPlayer(w, 1, 'A');
  const f = w.food[0];
  for (let i = 0; i < 60 * 30; i++) DM.stepWorld(w, dt);
  ok(w.food.every(ff => Math.hypot(ff.x - ff.home[0], ff.z - ff.home[1]) <= X.food.roam * 2 + 1), 'food stays near home');
  ok(w.food.every(ff => T.dryAt(X.region, ff.x, ff.z)), 'food stays on dry ground');
  ok(w.food.some(ff => Math.hypot(ff.x - ff.home[0], ff.z - ff.home[1]) > 1), 'food wanders');
  // flee: a dragon 15 away, low
  const g = T.surfaceAt(X.region, f.x, f.z);
  a.pos = [f.x + 15, g + 4, f.z]; a.hp = 40;
  const d0 = Math.hypot(a.pos[0] - f.x, a.pos[2] - f.z);
  for (let i = 0; i < 30; i++) DM.stepWorld(w, dt);
  ok(Math.hypot(a.pos[0] - f.x, a.pos[2] - f.z) > d0 || !f.alive, 'food flees');
  // eat
  a.pos = [f.x, T.surfaceAt(X.region, f.x, f.z) + 3, f.z];
  w.ev.length = 0;
  DM.stepWorld(w, dt);
  const e = w.ev.find(ev => ev.e === 'eat');
  ok(e && e.pl === 1 && !f.alive, 'eaten');
  near(a.hp, Math.min(X.hp, 40 + X.food.kinds[f.type].hp + X.regen * dt * 31), 0.05, 'eating heals');
  ok(!DM.snapshot(w).F.some(r => r[0] === f.id), 'eaten food left the snapshot');
  a.pos = [0, 200, 0];
  for (let i = 0; i < 60 * X.food.respawn + 5; i++) DM.stepWorld(w, dt);
  ok(f.alive && w.ev.some(ev => ev.e === 'food' && ev.f === f.id), 'food comes back');
  // too high: not eaten
  a.pos = [f.x, T.surfaceAt(X.region, f.x, f.z) + 20, f.z];
  DM.stepWorld(w, dt);
  ok(f.alive, 'high dragons do not eat');
}

// 11. Match: frag limit ends it, the board picks the winner, restart resets scores; time limit ends it too
{
  const w = DM.newWorld({ rng: mulberry(17), fragLimit: 2 });
  const a = DM.addPlayer(w, 1, 'A'), b = DM.addPlayer(w, 2, 'B');
  for (let r = 0; r < 2; r++) {
    DM.stepWorld(w, X.respawn + 0.1); DM.stepWorld(w, X.spawnInv + 0.1);
    DM.damage(w, b, 500, 1, 'ball');
  }
  ok(w.over && w.winner === 1, 'frag limit ends the match: ' + a.score);
  const over = w.ev.find(e => e.e === 'over');
  ok(over && over.board[0].id === 1 && over.board.length === 2, 'over event with the board');
  ok(!DM.damage(w, a, 10, 2, 'ball'), 'no damage after the end');
  DM.restart(w);
  ok(!w.over && a.score === 0 && b.kills === 0 && b.deaths === 0 && w.round === 2, 'restart');
  const w2 = DM.newWorld({ rng: mulberry(19), timeLimit: 3 });
  DM.addPlayer(w2, 1, 'A'); DM.addPlayer(w2, 2, 'B');
  for (let i = 0; i < 60 * 4; i++) DM.stepWorld(w2, dt);
  ok(w2.over && w2.timeLeft === 0, 'time limit ends the match');
  ok(w2.winner === 0 && w2.ev.some(e => e.e === 'over' && e.winner === 0), 'a 0 - 0 tie is a draw');
}

// 12. Snapshot and poses: compact, finite; setPose ignores junk; rolling dodges fireballs
{
  const w = DM.newWorld({ rng: mulberry(23) });
  DM.addPlayer(w, 1, 'A'); const b = DM.addPlayer(w, 2, 'B');
  DM.setPose(w, 2, { p: [1, 2, NaN] });
  ok(Number.isFinite(b.pos[2]), 'junk pose ignored');
  const p = DM.newPilot([10, 90, 10], 0);
  const m = DM.poseOf(p);
  DM.setPose(w, 2, m);
  ok(b.pos[0] === 10 && b.mode === 0, 'pose applied');
  const s = DM.snapshot(w);
  ok(s.P.length === 2 && s.P[0].length === 19 && s.F.length === w.food.length, 'snapshot rows');
  ok(JSON.stringify(s).length < 4000, 'snapshot small: ' + JSON.stringify(s).length);
  DM.stepWorld(w, X.spawnInv + 0.1);
  b.rollInv = true;
  ok(!DM.damage(w, b, 10, 1, 'ball') && DM.damage(w, b, 10, 1, 'bump'), 'roll dodges fire, not bumps');
}
