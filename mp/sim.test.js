// Run with: node mp/sim.test.js
'use strict';
const S = require('./sim.js');
const assert = require('assert');

// Seeded RNG so failures are reproducible
function mulberry(a) { return () => { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
const dt = 1 / 60;
let checks = 0;
const ok = (c, m) => { assert.ok(c, m); checks++; };

// 1. Pilot flight stays finite and in bounds under random input
{
  const rng = mulberry(1), p = S.newPilot();
  let inp = { sx: 0, sy: 0, breath: false, boost: false };
  for (let i = 0; i < 60 * 120; i++) {
    if (i % 90 === 0) inp = { sx: rng() * 2 - 1, sy: rng() * 2 - 1, breath: rng() < 0.3, boost: rng() < 0.3 };
    if (i % 200 === 0) S.tryRoll(p, rng() < 0.5 ? -1 : 1);
    if (i % 70 === 0) S.tryBall(p);
    S.stepPilot(p, inp, dt);
    ok(p.pos.every(Number.isFinite) && Number.isFinite(p.yaw), 'pilot state finite');
    ok(Math.hypot(p.pos[0], p.pos[2]) <= S.WORLD_R + 1e-6, 'pilot inside world');
    ok(p.pos[1] >= S.H(p.pos[0], p.pos[2]) + 7.9 && p.pos[1] <= 240, 'pilot altitude bounds');
    ok(p.st >= 0 && p.st <= 100, 'stamina bounds');
  }
}

// 2. Co-op: two dragons breathing fire clear waves; events and snapshots are well formed
{
  const w = S.newWorld(mulberry(7));
  const a = S.addPlayer(w, 1, 'Host'), b = S.addPlayer(w, 2, 'Guest');
  ok(a.color !== b.color, 'players get distinct colors');
  const pilots = { 1: S.newPilot(a.pos), 2: S.newPilot(b.pos) };
  const seen = new Set();
  let maxWave = 0;
  for (let i = 0; i < 60 * 240; i++) {
    for (const id of [1, 2]) {
      const pl = w.players[id], pi = pilots[id];
      // simple bot: steer toward the nearest wyvern and breathe when it is ahead
      let target = null, best = Infinity;
      w.foes.forEach(f => { if (!f.dead) { const d = S.dist(f.pos, pi.pos); if (d < best) { best = d; target = f; } } });
      const inp = { sx: 0, sy: 0, breath: false };
      if (target) {
        const want = Math.atan2(target.pos[0] - pi.pos[0], target.pos[2] - pi.pos[2]);
        inp.sx = S.clamp(-S.wrap(want - pi.yaw) * 2, -1, 1);
        inp.sy = S.clamp((target.pos[1] - pi.pos[1]) / 20, -1, 1);
        inp.breath = best < 45 && Math.abs(S.wrap(want - pi.yaw)) < 0.3;
        if (best < 120 && Math.abs(S.wrap(want - pi.yaw)) < 0.2 && S.tryBall(pi)) {
          S.shoot(w, id, pi.pos.slice(), [target.pos[0] - pi.pos[0], target.pos[1] - pi.pos[1], target.pos[2] - pi.pos[2]]);
        }
      }
      if (pl && pl.down && !pi.down) pi.down = true;
      S.stepPilot(pi, inp, dt);
      S.setPose(w, id, S.poseOf(pi));
    }
    S.stepWorld(w, dt);
    for (const ev of w.ev.splice(0)) {
      seen.add(ev.e);
      if (ev.e === 'spawn') { pilots[ev.pl] = S.newPilot(ev.p); }
      if (ev.e === 'over') S.restart(w);
    }
    maxWave = Math.max(maxWave, w.wave);
    if (i % 120 === 0) {
      const snap = S.snapshot(w);
      const json = JSON.stringify(snap);
      ok(json.length < 4000, 'snapshot stays small (' + json.length + ' bytes)');
      ok(snap.P.length === 2 && snap.F.every(f => f.slice(1, 4).every(Number.isFinite)), 'snapshot entities finite');
    }
  }
  ok(maxWave >= 2, 'bots cleared at least one wave (reached ' + maxWave + ')');
  ['join', 'wave', 'ball', 'pop', 'hit', 'die', 'boom', 'clear'].forEach(e => ok(seen.has(e), 'event seen: ' + e));
  console.log('  co-op run reached wave', maxWave, 'score', w.score, 'events', [...seen].join(','));
}

// 3. Down, respawn and game over
{
  const w = S.newWorld(mulberry(3));
  const p = S.addPlayer(w, 1, 'Solo');
  w.countdown = 0; S.stepWorld(w, dt); // wave 1
  p.sinv = 0;
  for (let k = 0; k < 10; k++) { w.balls.push({ id: 900 + k, o: 0, p: p.pos.slice(), v: [0, 0, 0], life: 1 }); S.stepWorld(w, dt); }
  ok(w.over === true, 'game over when every dragon is down');
  ok(w.ev.some(e => e.e === 'down') && w.ev.some(e => e.e === 'over'), 'down and over events');
  w.ev.length = 0;
  S.restart(w);
  ok(!w.over && w.wave === 0 && !p.down && p.hp === 100, 'restart resets the world');
  ok(w.ev.some(e => e.e === 'spawn'), 'restart respawns players');
}

// 4. Respawn while a teammate keeps flying
{
  const w = S.newWorld(mulberry(5));
  const a = S.addPlayer(w, 1, 'A'); S.addPlayer(w, 2, 'B');
  w.countdown = 0; S.stepWorld(w, dt);
  a.sinv = 0;
  while (!a.down) { w.balls.push({ id: w.nid++, o: 0, p: a.pos.slice(), v: [0, 0, 0], life: 1 }); S.stepWorld(w, dt); }
  ok(!w.over, 'not over while a teammate flies');
  w.foes.length = 0; // keep the teammate safe
  for (let i = 0; i < 60 * 7; i++) S.stepWorld(w, dt);
  ok(!a.down && a.hp === 100, 'downed dragon respawns');
  S.removePlayer(w, 2);
  ok(!w.players[2] && w.ev.some(e => e.e === 'left'), 'player leaves cleanly');
}

// 5. Input validation: junk from a peer is ignored
{
  const w = S.newWorld(mulberry(9));
  S.addPlayer(w, 1, 'A');
  S.setPose(w, 1, { p: [NaN, 1, 2] });
  ok(w.players[1].pos.every(Number.isFinite), 'NaN pose ignored');
  ok(S.shoot(w, 1, [1e6, 0, 0], [0, 0, 1]) === null, 'fireball far from shooter rejected');
  ok(S.shoot(w, 1, 'x', [0, 0, 1]) === null, 'malformed fireball rejected');
}
console.log('sim.test.js: ' + checks + ' checks passed');
