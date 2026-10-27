/*
 * Verdigris co-op - shared simulation.
 * Pure JavaScript, no Three.js and no DOM, so it runs in the browser (window.VSim)
 * and in Node (require('./sim.js')) for tests.
 *
 * Authority model (peer-to-peer, host-authoritative combat):
 *  - every client flies its own dragon with stepPilot() and reports its pose;
 *  - the host owns the world: wyverns, fireballs, damage, waves, respawns.
 */
(function (root) {
  'use strict';

  const WORLD_R = 430, CEILING = 240;
  const ROLL_TIME = 0.6, RESPAWN_TIME = 6, MAX_PLAYERS = 6;
  const BALL_SPEED = { player: 115, foe: 58 };

  /* ---------- math helpers (vectors are [x, y, z] arrays) ---------- */
  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  const wrap = a => Math.atan2(Math.sin(a), Math.cos(a));
  const r2 = v => Math.round(v * 100) / 100;
  const r3 = v => Math.round(v * 1000) / 1000;
  const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
  function fwd(yaw, pitch) {
    const c = Math.cos(pitch);
    return [Math.sin(yaw) * c, Math.sin(pitch), Math.cos(yaw) * c];
  }
  function norm(v) {
    const l = Math.hypot(v[0], v[1], v[2]) || 1;
    return [v[0] / l, v[1] / l, v[2] / l];
  }
  const finite = v => Array.isArray(v) && v.length === 3 && v.every(Number.isFinite);

  /* ---------- terrain (same function the renderer meshes) ---------- */
  function H(x, z) {
    const r = Math.hypot(x, z);
    let h = 16 * Math.sin(x * 0.011) * Math.cos(z * 0.013) + 9 * Math.sin(x * 0.029 + 1.3) * Math.sin(z * 0.023 + 0.4)
      + 3.5 * Math.sin(x * 0.071 + z * 0.053) + 1.5 * Math.sin(x * 0.17 - z * 0.13);
    h += Math.max(0, r - 380) * 0.45;
    return h + 4;
  }
  function clampWorld(p, minAlt) {
    const r = Math.hypot(p[0], p[2]);
    if (r > WORLD_R) { p[0] *= WORLD_R / r; p[2] *= WORLD_R / r; }
    p[1] = Math.min(CEILING, Math.max(H(p[0], p[2]) + (minAlt == null ? 8 : minAlt), p[1]));
  }

  /* =====================================================================
   * Pilot: one dragon's flight, run by the client that controls it.
   * input: {sx, sy, breath, boost}  sx/sy in -1..1
   * ===================================================================== */
  function newPilot(pos) {
    return {
      pos: pos ? pos.slice() : [0, 90, 0], vel: [0, 0, 0], yaw: 0, pitch: 0, roll: 0, rollX: 0, sx: 0,
      speed: 30, st: 100, ballCd: 0, rollT: 0, rollDir: 1, inv: 0,
      boosting: false, breathing: false, down: false,
    };
  }
  function stepPilot(p, inp, dt) {
    p.ballCd = Math.max(0, p.ballCd - dt);
    p.inv = Math.max(0, p.inv - dt);
    if (p.down) {
      // wounded spiral down to the ground
      p.breathing = p.boosting = false; p.rollT = 0; p.rollX = 0; p.sx = 0;
      p.pitch += (-0.85 - p.pitch) * Math.min(1, dt * 1.5);
      p.yaw = wrap(p.yaw + dt * 1.1);
      p.roll += dt * 2.5;
      const f = fwd(p.yaw, p.pitch);
      for (let k = 0; k < 3; k++) { p.vel[k] = f[k] * p.speed; p.pos[k] += p.vel[k] * dt; }
      const g = H(p.pos[0], p.pos[2]) + 2;
      if (p.pos[1] < g) { p.pos[1] = g; p.speed = 0; p.vel = [0, 0, 0]; }
      clampWorld(p.pos, 2);
      return;
    }
    const sx = clamp(inp.sx || 0, -1, 1), sy = clamp(inp.sy || 0, -1, 1);
    p.sx = sx;
    p.boosting = !!inp.boost && p.st > 2;
    p.breathing = !!inp.breath && p.st > (p.breathing ? 0.5 : 8);
    p.yaw = wrap(p.yaw - sx * 1.55 * dt);
    let tp = sy * 0.75;
    if (p.pos[1] < H(p.pos[0], p.pos[2]) + 14) tp = Math.max(tp, 0.35);
    if (p.pos[1] > CEILING - 10) tp = Math.min(tp, -0.1);
    p.pitch += (tp - p.pitch) * Math.min(1, dt * 3);
    const r = Math.hypot(p.pos[0], p.pos[2]);
    if (r > 400) { // soft boundary: steer back toward the valley
      const d = wrap(Math.atan2(-p.pos[0], -p.pos[2]) - p.yaw);
      p.yaw = wrap(p.yaw + d * Math.min(1, dt * 1.2 * (r - 400) / 30));
    }
    const target = (p.boosting ? 54 : 30) - p.pitch * 8;
    p.speed += (target - p.speed) * Math.min(1, dt * 2.2);
    if (p.boosting) p.st -= 20 * dt;
    if (p.breathing) p.st -= 32 * dt;
    if (!p.boosting && !p.breathing) p.st += 17 * dt;
    p.st = clamp(p.st, 0, 100);
    const f = fwd(p.yaw, p.pitch);
    for (let k = 0; k < 3; k++) { p.vel[k] = f[k] * p.speed; p.pos[k] += p.vel[k] * dt; }
    p.rollX = 0;
    if (p.rollT > 0) {
      const k = 1 - p.rollT / ROLL_TIME;
      p.rollT -= dt;
      p.rollX = p.rollDir * Math.PI * 2 * (k * k * (3 - 2 * k));
      const right = [-Math.cos(p.yaw), 0, Math.sin(p.yaw)];
      p.pos[0] += right[0] * p.rollDir * 34 * dt; p.pos[2] += right[2] * p.rollDir * 34 * dt;
    }
    clampWorld(p.pos);
    p.roll += (sx * 0.65 - p.roll) * Math.min(1, dt * 4);
  }
  function tryRoll(p, dir) {
    if (p.down || p.rollT > 0 || p.st < 10) return false;
    p.st -= 10; p.rollT = ROLL_TIME; p.rollDir = dir < 0 ? -1 : 1; p.inv = 0.65; return true;
  }
  function tryBall(p) {
    if (p.down || p.ballCd > 0 || p.st < 12) return false;
    p.ballCd = 1.0; p.st -= 12; return true;
  }
  /** Compact pose message a client sends to the host. */
  function poseOf(p) {
    return { p: p.pos.map(r2), v: p.vel.map(r2), y: r3(p.yaw), pi: r3(p.pitch), r: r3(p.roll), rx: r3(p.rollX), sx: r2(p.sx), b: p.breathing ? 1 : 0, i: p.inv > 0 ? 1 : 0 };
  }

  /* =====================================================================
   * World: everything the host owns.
   * Events are appended to w.ev; the host drains and broadcasts them.
   * ===================================================================== */
  function newWorld(rng) {
    return { t: 0, wave: 0, score: 0, waveTimer: 0, countdown: 8, foes: [], balls: [], players: {}, nid: 1, ev: [], over: false, rng: rng || Math.random };
  }
  function playerList(w) { return Object.keys(w.players).map(k => w.players[k]); }
  function freeColor(w) {
    const used = new Set(playerList(w).map(p => p.color));
    for (let c = 0; c < MAX_PLAYERS; c++) if (!used.has(c)) return c;
    return 0;
  }
  function addPlayer(w, id, name, color) {
    const base = spawnPoint(w);
    w.players[id] = {
      id, name: String(name || 'Dragon').slice(0, 16), color: color == null ? freeColor(w) : color,
      pos: base, vel: [0, 0, 0], yaw: 0, pitch: 0, roll: 0, rollX: 0, sx: 0,
      br: false, hp: 100, down: false, downT: 0, rollInv: false, sinv: 3, kills: 0,
    };
    w.ev.push({ e: 'join', pl: id, name: w.players[id].name, p: base.map(r2) });
    return w.players[id];
  }
  function removePlayer(w, id) {
    const p = w.players[id];
    if (!p) return;
    delete w.players[id];
    w.ev.push({ e: 'left', pl: id, name: p.name });
  }
  function setPose(w, id, m) {
    const p = w.players[id];
    if (!p || !m || !finite(m.p)) return;
    p.pos = m.p.slice(); p.vel = finite(m.v) ? m.v.slice() : [0, 0, 0];
    p.yaw = +m.y || 0; p.pitch = +m.pi || 0; p.roll = +m.r || 0; p.rollX = +m.rx || 0; p.sx = +m.sx || 0;
    p.br = !!m.b && !p.down; p.rollInv = !!m.i;
  }
  function shoot(w, owner, from, dir) {
    if (!finite(from) || !finite(dir)) return null;
    const isPlayer = owner !== 0;
    if (isPlayer) { const pl = w.players[owner]; if (!pl || pl.down || dist(pl.pos, from) > 25) return null; }
    const d = norm(dir), s = isPlayer ? BALL_SPEED.player : BALL_SPEED.foe;
    const b = { id: w.nid++, o: owner, p: from.slice(), v: [d[0] * s, d[1] * s, d[2] * s], life: isPlayer ? 2.4 : 4 };
    w.balls.push(b);
    w.ev.push({ e: 'ball', id: b.id, o: owner, p: b.p.map(r2), v: b.v.map(r2) });
    return b;
  }
  function spawnPoint(w) {
    const alive = playerList(w).filter(p => !p.down);
    const rng = w.rng;
    if (alive.length) {
      const a = alive[Math.floor(rng() * alive.length)];
      const p = [a.pos[0] + (rng() - 0.5) * 30, Math.max(a.pos[1], 70) + 15, a.pos[2] + (rng() - 0.5) * 30];
      clampWorld(p); return p;
    }
    const p = [(rng() - 0.5) * 40, 95, (rng() - 0.5) * 40]; clampWorld(p); return p;
  }
  function centroid(w) {
    const pl = playerList(w).filter(p => !p.down);
    if (!pl.length) return [0, 90, 0];
    const c = [0, 0, 0];
    pl.forEach(p => { c[0] += p.pos[0]; c[1] += p.pos[1]; c[2] += p.pos[2]; });
    return c.map(v => v / pl.length);
  }
  function spawnWave(w) {
    w.wave++;
    const np = Math.max(1, playerList(w).length), rng = w.rng;
    const n = Math.min(2 + w.wave + (np - 1) * Math.ceil(w.wave / 2 + 1), 14);
    const hp = 90 + w.wave * 15 + (np - 1) * 20;
    const c = centroid(w);
    for (let i = 0; i < n; i++) {
      const a = rng() * Math.PI * 2;
      const pos = [c[0] + Math.cos(a) * 200, 70 + rng() * 60, c[2] + Math.sin(a) * 200];
      clampWorld(pos);
      w.foes.push({
        id: w.nid++, pos, dir: norm([c[0] - pos[0], c[1] - pos[1], c[2] - pos[2]]), hp, max: hp,
        speed: 21 + w.wave * 1.2 + rng() * 4, cd: 2 + rng() * 2, orbit: rng() * Math.PI * 2, orbitR: 30 + rng() * 25,
        alt: (rng() - 0.5) * 30, tg: null, tgT: 0, dead: false, fall: 0, spin: 0, yaw: 0, pitch: 0, roll: 0, mouth: false, flashT: 0,
      });
    }
    w.ev.push({ e: 'wave', n: w.wave, count: n });
  }
  function damageFoe(w, f, amt, by) {
    if (f.dead) return;
    f.hp -= amt;
    if (f.flashT <= 0) { w.ev.push({ e: 'hit', f: f.id }); f.flashT = 0.12; }
    if (f.hp <= 0) {
      f.dead = true; f.fall = 0; f.hp = 0;
      const pts = 100 * w.wave; w.score += pts;
      if (w.players[by]) w.players[by].kills++;
      w.ev.push({ e: 'die', f: f.id, by, pts, p: f.pos.map(r2) });
    }
  }
  function hurtPlayer(w, p, amt) {
    if (p.down || p.rollInv || p.sinv > 0) return;
    p.hp -= amt;
    w.ev.push({ e: 'hurt', pl: p.id, hp: Math.round(Math.max(0, p.hp)) });
    if (p.hp <= 0) {
      p.hp = 0; p.down = true; p.downT = RESPAWN_TIME; p.br = false;
      w.ev.push({ e: 'down', pl: p.id, name: p.name, t: RESPAWN_TIME });
    }
  }
  function respawn(w, p) {
    p.down = false; p.hp = 100; p.sinv = 3;
    p.pos = spawnPoint(w);
    w.ev.push({ e: 'spawn', pl: p.id, p: p.pos.map(r2) });
  }
  function restart(w) {
    w.foes.length = 0; w.balls.length = 0;
    w.wave = 0; w.score = 0; w.waveTimer = 0; w.countdown = 5; w.over = false;
    w.ev.push({ e: 'restart' });
    playerList(w).forEach(p => { p.kills = 0; respawn(w, p); });
  }

  function stepFoes(w, dt) {
    const players = playerList(w), alive = players.filter(p => !p.down);
    for (let i = w.foes.length - 1; i >= 0; i--) {
      const f = w.foes[i];
      f.flashT -= dt;
      if (f.dead) {
        f.fall += dt; f.spin += dt * 4;
        f.pos[1] -= (8 + f.fall * 30) * dt;
        for (let k = 0; k < 3; k++) if (k !== 1) f.pos[k] += f.dir[k] * f.speed * 0.6 * dt;
        f.pitch = -0.6; f.roll = f.spin; f.mouth = true;
        if (f.pos[1] < H(f.pos[0], f.pos[2]) + 1 || f.fall > 4) {
          w.ev.push({ e: 'boom', f: f.id, p: f.pos.map(r2) });
          w.foes.splice(i, 1);
        }
        continue;
      }
      // pick a target: nearest dragon still flying, re-evaluated every few seconds
      f.tgT -= dt;
      let tg = w.players[f.tg];
      if (!tg || tg.down || f.tgT <= 0) {
        tg = null; let best = Infinity;
        alive.forEach(p => { const d = dist(p.pos, f.pos); if (d < best) { best = d; tg = p; } });
        f.tg = tg ? tg.id : null; f.tgT = 3 + w.rng() * 2;
      }
      const anchor = tg ? tg.pos : centroid(w);
      f.orbit += dt * 0.55;
      const want = [anchor[0] + Math.cos(f.orbit) * f.orbitR, anchor[1] + f.alt + Math.sin(f.orbit * 1.7) * 8, anchor[2] + Math.sin(f.orbit) * f.orbitR];
      w.foes.forEach(o => {
        if (o === f || o.dead) return;
        const d = dist(f.pos, o.pos);
        if (d < 14 && d > 0.01) for (let k = 0; k < 3; k++) want[k] += (f.pos[k] - o.pos[k]) / d * (14 - d) * 2;
      });
      const wd = norm([want[0] - f.pos[0], want[1] - f.pos[1], want[2] - f.pos[2]]);
      const t = Math.min(1, dt * 1.4);
      f.dir = norm([f.dir[0] + (wd[0] - f.dir[0]) * t, f.dir[1] + (wd[1] - f.dir[1]) * t, f.dir[2] + (wd[2] - f.dir[2]) * t]);
      for (let k = 0; k < 3; k++) f.pos[k] += f.dir[k] * f.speed * dt;
      clampWorld(f.pos);
      const oldYaw = f.yaw;
      f.yaw = Math.atan2(f.dir[0], f.dir[2]);
      f.pitch = Math.asin(clamp(f.dir[1], -1, 1));
      f.roll += (clamp(-wrap(f.yaw - oldYaw) / dt * 0.6, -0.8, 0.8) - f.roll) * Math.min(1, dt * 3);
      // breathe fireballs at the target
      f.cd -= dt;
      f.mouth = false;
      if (!tg) continue;
      const to = [tg.pos[0] - f.pos[0], tg.pos[1] - f.pos[1], tg.pos[2] - f.pos[2]];
      const d = Math.hypot(to[0], to[1], to[2]) || 1;
      const facing = (to[0] * f.dir[0] + to[1] * f.dir[1] + to[2] * f.dir[2]) / d > Math.cos(0.9);
      f.mouth = f.cd < 0.35 && facing;
      if (f.cd <= 0 && d < 140 && facing) {
        const mouth = [f.pos[0] + f.dir[0] * 3.6, f.pos[1] + f.dir[1] * 3.6 + 0.8, f.pos[2] + f.dir[2] * 3.6];
        const lead = d / BALL_SPEED.foe * 0.7;
        shoot(w, 0, mouth, [tg.pos[0] + tg.vel[0] * lead - mouth[0], tg.pos[1] + tg.vel[1] * lead - mouth[1], tg.pos[2] + tg.vel[2] * lead - mouth[2]]);
        f.cd = Math.max(1.4, 3.6 - w.wave * 0.18) + w.rng() * 1.5;
      }
    }
  }
  function stepBalls(w, dt) {
    for (let i = w.balls.length - 1; i >= 0; i--) {
      const b = w.balls[i];
      b.life -= dt;
      for (let k = 0; k < 3; k++) b.p[k] += b.v[k] * dt;
      let hit = false;
      if (b.o !== 0) {
        for (const f of w.foes) {
          if (!f.dead && dist(f.pos, b.p) < 4.2) { damageFoe(w, f, 40, b.o); hit = true; break; }
        }
        if (hit) w.foes.forEach(f => { if (!f.dead) { const d = dist(f.pos, b.p); if (d < 11 && d >= 4.2) damageFoe(w, f, 14, b.o); } });
      } else {
        for (const p of playerList(w)) {
          if (!p.down && dist(p.pos, b.p) < 3.6 && !p.rollInv && p.sinv <= 0) { hurtPlayer(w, p, 13); hit = true; break; }
        }
      }
      if (b.p[1] < H(b.p[0], b.p[2]) || b.p[1] < 0.6) hit = true;
      if (hit || b.life <= 0) {
        w.ev.push({ e: 'pop', id: b.id, o: b.o, h: hit ? 1 : 0, p: b.p.map(r2) });
        w.balls.splice(i, 1);
      }
    }
  }
  function stepBreath(w, dt) {
    const cosA = Math.cos(16 * Math.PI / 180);
    playerList(w).forEach(p => {
      if (!p.br || p.down) return;
      const f = fwd(p.yaw, p.pitch);
      w.foes.forEach(fo => {
        if (fo.dead) return;
        const d = [fo.pos[0] - p.pos[0], fo.pos[1] - p.pos[1], fo.pos[2] - p.pos[2]];
        const l = Math.hypot(d[0], d[1], d[2]);
        if (l > 0.1 && l < 44 && (d[0] * f[0] + d[1] * f[1] + d[2] * f[2]) / l > cosA) damageFoe(w, fo, 58 * dt, p.id);
      });
    });
  }
  function stepWorld(w, dt) {
    w.t += dt;
    if (w.over) return;
    const players = playerList(w);
    players.forEach(p => {
      p.sinv = Math.max(0, p.sinv - dt);
      if (p.down) { p.downT -= dt; if (p.downT <= 0) respawn(w, p); }
      else p.hp = Math.min(100, p.hp + 1.2 * dt);
    });
    if (w.wave === 0) {
      w.countdown -= dt;
      if (w.countdown <= 0) spawnWave(w);
    } else if (w.foes.length === 0) {
      const before = w.waveTimer;
      w.waveTimer += dt;
      if (before < 0.2 && w.waveTimer >= 0.2) {
        players.forEach(p => { if (!p.down) p.hp = Math.min(100, p.hp + 30); });
        w.ev.push({ e: 'clear', n: w.wave });
      }
      if (w.waveTimer > 3.5) { w.waveTimer = 0; spawnWave(w); }
    }
    stepBreath(w, dt);
    stepFoes(w, dt);
    stepBalls(w, dt);
    if (players.length && players.every(p => p.down) && w.wave > 0) {
      w.over = true;
      w.ev.push({ e: 'over', score: w.score, wave: w.wave });
    }
  }
  /** Compact state broadcast to every client (about 20 times a second). */
  function snapshot(w) {
    return {
      t: r2(w.t), w: w.wave, s: w.score, cd: w.wave === 0 ? Math.ceil(w.countdown) : 0, o: w.over ? 1 : 0,
      P: playerList(w).map(p => [p.id, r2(p.pos[0]), r2(p.pos[1]), r2(p.pos[2]), r3(p.yaw), r3(p.pitch), r3(p.roll), r3(p.rollX), p.br ? 1 : 0, Math.round(p.hp), p.down ? 1 : 0, p.color, p.name, r2(p.sx), p.kills]),
      F: w.foes.map(f => [f.id, r2(f.pos[0]), r2(f.pos[1]), r2(f.pos[2]), r3(f.yaw), r3(f.pitch), r3(f.roll), Math.round(f.hp), f.max, f.dead ? 1 : 0, f.mouth ? 1 : 0]),
    };
  }

  const api = {
    WORLD_R, MAX_PLAYERS, BALL_SPEED, H, fwd, norm, wrap, clamp, dist,
    newPilot, stepPilot, tryRoll, tryBall, poseOf,
    newWorld, addPlayer, removePlayer, setPose, shoot, stepWorld, snapshot, restart, playerList,
  };
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.VSim = api;
})(typeof self !== 'undefined' ? self : this);
