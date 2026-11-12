/*
 * Verdigris campaign - deathmatch rules (campaign/dm/). Pure: no DOM, no THREE; runs in the browser and in Node.
 * Tunables: data.dm. Human dragons only, no AI dragons; food animals (chickens, goats, sheep) wander the arena.
 *
 * Two halves, the same split as the co-op (mp/sim.js):
 *  - pilot: one dragon, stepped by the browser that flies it. Modes:
 *      air      flight (core/flight.js) inside the arena; crashing into a pillar, a building wall, a tree crown or
 *               steeply into the ground starts a fall;
 *      perching settling onto the surface under it (Land), then
 *      perch    sitting on the ground, a roof or a pillar top: turn, breathe, shoot; Fly / climb / boost takes off;
 *      fall     tumbling under gravity, out of control (after a crash or a bump), until it hits a surface: impact
 *               damage, then it sits stunned (perch with stun > 0);
 *      down     dead: falls and lies still until the host respawns it.
 *    step() returns local events: { e: 'crash', kind, dmg } (start of a fall), { e: 'impact', dmg, water } (end of
 *    a fall), { e: 'perch' }, { e: 'takeoff' }. The client reports damage to the host ('c' message).
 *  - world: owned by the host: players (hp, kills, deaths, score), fireballs, breath, bumps, food, respawns, the
 *    match clock and the board. Events go to w.ev; the host drains and broadcasts them with snapshot().
 *
 * Static arena (same in every browser, seeded): rock pillars with flat tops, food homes, spawn points; plus the
 * Wildwood buildings (core/settlement.js, no defenders) and the trees the renderer placed (treeGrid).
 */
(function (root) {
  'use strict';
  const M = typeof module === 'object' && module.exports ? require('./umd.js') : root.VCamp;
  const D = M.need('data'), T = M.need('terrain'), F = M.need('flight'), S = M.need('settlement');
  const VF = typeof module === 'object' && module.exports ? require('../../shared/forest.js') : root.VForest;   // the living forest (shared rules)
  const { clamp, wrap, fwd, norm, mulberry, range } = M.need('math');
  const X = D.dm;
  const MODES = ['air', 'perching', 'perch', 'fall', 'down'];
  const PHASES = ['lobby', 'play', 'over'];
  /** Seat key of a browser's token: who a player is across reconnects and host changes (friendly games, not secure). */
  function keyOf(token) {
    let a = 0x811c9dc5, b = 0x01000193 ^ 0x5bd1e995;
    for (const ch of String(token)) { const c = ch.charCodeAt(0); a = Math.imul(a ^ c, 0x01000193); b = Math.imul(b ^ c, 0x5bd1e995) ^ (b >>> 13); }
    return 'k' + (a >>> 0).toString(36) + (b >>> 0).toString(36);
  }
  const pick = (v, list, d) => (list.indexOf(+v) >= 0 ? +v : d);
  const FOOD_TYPES = Object.keys(X.food.kinds);
  const r2 = v => Math.round(v * 100) / 100, r3 = v => Math.round(v * 1000) / 1000;
  const fin = v => Array.isArray(v) && v.length === 3 && v.every(Number.isFinite);
  const d3 = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);

  /* =====================================================================
   * Arena: pillars, food homes, spawn points (deterministic, cached)
   * ===================================================================== */
  let arenaCache = null;
  function arena() {
    if (arenaCache) return arenaCache;
    const id = X.region, P = X.pillars, rng = mulberry(P.seed), town = S.build(id, null);
    const nearTown = (x, z, pad) => town.places.some(pl => Math.hypot(x - pl.x, z - pl.z) < pl.r + pad);
    const pillars = [];
    for (let tries = 0; pillars.length < P.n && tries < 600; tries++) {
      const a = rng() * Math.PI * 2, r = range(rng, P.ring[0], P.ring[1]), x = Math.cos(a) * r, z = Math.sin(a) * r;
      if (T.liquidAt(id, x, z) || nearTown(x, z, 30)) continue;
      if (pillars.some(p => Math.hypot(p.x - x, p.z - z) < P.gap)) continue;
      const rad = range(rng, P.r[0], P.r[1]), base = T.surfaceAt(id, x, z) - 2;
      pillars.push({ id: pillars.length, x, z, r: rad, base, top: T.surfaceAt(id, x, z) + range(rng, P.h[0], P.h[1]) });
    }
    const FD = X.food, frng = mulberry(FD.seed), homes = [];
    for (let tries = 0; homes.length < FD.n && tries < 2000; tries++) {
      const a = frng() * Math.PI * 2, r = range(frng, 60, X.arena.r - 80), x = Math.cos(a) * r, z = Math.sin(a) * r;
      if (!T.dryAt(id, x, z) || T.surfaceSlope(id, x, z) > 0.45 || nearTown(x, z, 4)) continue;
      if (pillars.some(p => Math.hypot(p.x - x, p.z - z) < p.r + 6)) continue;
      if (homes.some(h => Math.hypot(h[0] - x, h[1] - z) < 50)) continue;
      homes.push([x, z]);
    }
    const spawns = [];
    for (let i = 0; i < X.spawns; i++) {
      const a = i / X.spawns * Math.PI * 2, r = X.arena.r * 0.62, x = Math.cos(a) * r, z = Math.sin(a) * r;
      spawns.push({ pos: [x, Math.max(T.surfaceAt(id, x, z), 0) + X.spawnAlt, z], yaw: Math.atan2(-x, -z) });
    }
    arenaCache = { region: id, town, pillars, homes, spawns };
    return arenaCache;
  }

  /** Trees as a hash grid: list = [[x, z, r]] (render/flora trees); height = ground + r x hK, solid within r x rK. */
  function treeGrid(list) {
    const c = X.trees.cell, cells = new Map();
    for (const [x, z, r] of list || []) {
      const k = Math.floor(x / c) + ',' + Math.floor(z / c);
      if (!cells.has(k)) cells.set(k, []);
      cells.get(k).push({ x, z, r: r * X.trees.rK, top: T.surfaceAt(X.region, x, z) + r * X.trees.hK });
    }
    return { cell: c, cells, n: (list || []).length };
  }

  /** Everything a pilot collides with. forest: the arena's VForest (trees break when hit, the same rule as in the
      campaign and the co-op); without one, trees = a plain [[x, z, r]] list of solid crowns (the old rule, tests). */
  function env(trees, forest) {
    const A = arena();
    return { regionId: A.region, town: A.town, pillars: A.pillars, trees: treeGrid(forest ? null : trees), forest: forest || null };
  }

  function pillarAt(E, x, z, pad) {
    for (const p of E.pillars) if (Math.hypot(x - p.x, z - p.z) < p.r + (pad || 0)) return p;
    return null;
  }
  /** Highest solid top under (x, z): roof or pillar top, else null. */
  function solidTop(E, x, z) {
    let top = S.solidAt(E.town, x, z, 0);
    const p = pillarAt(E, x, z, 0);
    if (p && (top == null || p.top > top)) top = p.top;
    return top;
  }
  /** What a dragon stands on at (x, z): { y, kind: ground | roof | pillar | water }. */
  function surface(E, x, z) {
    const g = T.surfaceAt(E.regionId, x, z), R = T.region(E.regionId);
    let y = g, kind = 'ground';
    if (T.liquidAt(E.regionId, x, z) === 'water') { y = Math.max(g, R.waterLevel != null ? R.waterLevel : g); kind = 'water'; }
    const roof = S.solidAt(E.town, x, z, 0);
    if (roof != null && roof > y) { y = roof; kind = 'roof'; }
    const p = pillarAt(E, x, z, 0);
    if (p && p.top > y) { y = p.top; kind = 'pillar'; }
    return { y, kind };
  }

  /** First obstacle the dragon is inside: { kind, nx, nz } (outward normal) or null; hops onto tops just above. */
  function obstacle(E, p) {
    const pos = p.pos, hop = X.perch.hop, pad = 1.2;
    for (const pl of E.pillars) {
      const dx = pos[0] - pl.x, dz = pos[2] - pl.z, d = Math.hypot(dx, dz);
      if (d >= pl.r + pad || pos[1] >= pl.top + 0.5) continue;
      if (pl.top - pos[1] <= hop) { pos[1] = pl.top + 0.6; continue; }
      const nx = d > 1e-6 ? dx / d : 0, nz = d > 1e-6 ? dz / d : 1;
      return { kind: 'pillar', nx, nz, out: pl.r + pad - d };
    }
    const h = S.hit(E.town, pos[0], pos[2], pad);
    if (h && pos[1] < h.roof + 0.5) {
      if (h.roof - pos[1] <= hop) pos[1] = h.roof + 0.6;
      else return { kind: 'wall', nx: h.nx, nz: h.nz, out: h.depth };
    }
    const G = E.trees, c = G.cell, ci = Math.floor(pos[0] / c), cj = Math.floor(pos[2] / c);
    for (let i = ci - 1; i <= ci + 1; i++) for (let j = cj - 1; j <= cj + 1; j++) {
      const list = G.cells.get(i + ',' + j);
      if (!list) continue;
      for (const t of list) {
        const dx = pos[0] - t.x, dz = pos[2] - t.z, d = Math.hypot(dx, dz);
        if (d < t.r && pos[1] < t.top) return { kind: 'tree', nx: d > 1e-6 ? dx / d : 0, nz: d > 1e-6 ? dz / d : 1, out: 0 };
      }
    }
    return null;
  }

  /* =====================================================================
   * Pilot
   * ===================================================================== */
  function newPilot(pos, yaw) {
    const p = F.newPilot(pos, yaw || 0, X.stats.cruise);
    return Object.assign(p, { mode: 'air', tr: null, stun: 0, spin: 0, ballCd: 0, crashBy: 0, treeCool: 0 });
  }

  function flightCtx(E) {
    const R = T.region(E.regionId);
    return {
      regionId: E.regionId, stats: X.stats, minAlt: X.minAlt,
      softEdge: R.radius - X.arena.r + X.arena.soft,              // flight steers back from arena.r - soft outward
      solidAt: (x, z) => solidTop(E, x, z),                      // roofs and pillar tops are floor for the pull-up
    };
  }

  /** Starts a fall: push [x, y, z] velocity added to the current motion. */
  function startFall(p, push, kind) {
    if (p.mode === 'down') return false;
    const v = p.mode === 'air' ? p.vel.slice() : [0, 0, 0];
    const k = p.mode === 'air' ? 0.35 : 0;                        // keep a little of the flight speed
    p.vel = [v[0] * k + (push ? push[0] : 0), v[1] * k + (push ? push[1] : 0), v[2] * k + (push ? push[2] : 0)];
    p.mode = 'fall'; p.tr = null; p.stun = 0; p.rollT = 0; p.rollX = 0;
    p.boosting = p.breathing = false; p.speed = 0; p.spin = 0; p.fallKind = kind || 'bump';
    return true;
  }

  function crash(p, ob, ev) {
    const B = X.fall.bounce;
    // bounce off: away from the obstacle (or up from the ground)
    const push = ob.kind === 'ground' ? [0, B * 0.6, 0] : [ob.nx * B, 2, ob.nz * B];
    if (ob.out > 0) { p.pos[0] += ob.nx * ob.out; p.pos[2] += ob.nz * ob.out; }
    const vn = p.vel[0] * ob.nx + p.vel[2] * ob.nz;               // drop the into-the-obstacle share of the motion
    if (vn < 0) { p.vel[0] -= vn * ob.nx; p.vel[2] -= vn * ob.nz; }
    if (ob.kind === 'ground' && p.vel[1] < 0) p.vel[1] = 0;
    startFall(p, push, ob.kind);
    ev.push({ e: 'crash', kind: ob.kind, dmg: X.fall.crashDmg });
  }

  /** Can the dragon sit down here? null = yes, else the reason ('high' | 'water' | 'mode'). */
  function perchBlock(p, E) {
    if (p.mode !== 'air') return 'mode';
    const s = surface(E, p.pos[0], p.pos[2]);
    if (s.kind === 'water') return 'water';
    if (p.pos[1] - s.y > X.perch.maxAlt) return 'high';
    return null;
  }
  function tryPerch(p, E) {
    const why = perchBlock(p, E);
    if (why) return why;
    const s = surface(E, p.pos[0], p.pos[2]);
    p.mode = 'perching'; p.tr = { t: 0, dur: X.perch.time, y0: p.pos[1], y1: s.y + X.stand, kind: s.kind };
    p.boosting = false; p.rollT = 0; p.rollX = 0; p.speed = Math.min(p.speed, 4);   // brake: only a short drift
    return null;
  }
  function tryTakeoff(p) {
    if (p.mode !== 'perch' || p.stun > 0) return false;
    p.mode = 'air'; p.tr = null; p.speed = X.perch.takeoffSpeed; p.pitch = X.perch.takeoffPitch; p.pos[1] += 1.5;
    return true;
  }
  function tryBall(p) {
    if ((p.mode !== 'air' && p.mode !== 'perch') || p.stun > 0 || p.ballCd > 0 || p.st < X.ball.st) return false;
    p.ballCd = X.ball.cd; p.st -= X.ball.st;
    return true;
  }
  function tryRoll(p, dir) { return p.mode === 'air' && F.tryRoll(p, dir); }

  /** One step of the browser's own dragon. inp: { sx, sy, breath, boost, takeoff }. Returns local events. */
  function step(p, inp, dt, E) {
    const ev = [];
    inp = inp || {};
    p.ballCd = Math.max(0, p.ballCd - dt);
    p.inv = Math.max(0, p.inv - dt);
    const FL = X.fall;
    if (p.mode === 'air') {
      F.step(p, inp, dt, flightCtx(E));
      const ob = obstacle(E, p);
      if (ob) crash(p, ob, ev);
      else {
        if (E.forest && VF) {                                     // through a tree: it breaks, the dragon is jolted (VForest.RULES.jolt)
          p.treeCool = Math.max(0, (p.treeCool || 0) - dt);
          const hits = VF.hit(E.forest, p.pos, X.trees.body, p.vel), J = E.forest.rules.jolt;
          for (const h of hits) ev.push({ e: 'tree', k: 'f', i: h.i, dx: h.dx, dz: h.dz });
          if (hits.length && p.treeCool <= 0) { p.treeCool = J.cool; p.speed *= J.slow; ev.push({ e: 'crash', kind: 'tree', dmg: J.dmg, soft: true }); }
        }
        const s = surface(E, p.pos[0], p.pos[2]);
        if (p.pos[1] - s.y <= X.minAlt + 0.3 && p.pitch < FL.groundPitch && p.speed > FL.groundSpeed && s.kind !== 'water') crash(p, { kind: 'ground', nx: 0, nz: 0, out: 0 }, ev);
      }
      return ev;
    }
    if (p.mode === 'perching') {
      const tr = p.tr; tr.t += dt;
      const k = clamp(tr.t / tr.dur, 0, 1), e = k * k * (3 - 2 * k);
      p.pos[1] = tr.y0 + (tr.y1 - tr.y0) * e;
      p.pitch += (0 - p.pitch) * Math.min(1, dt * 6); p.roll += (0 - p.roll) * Math.min(1, dt * 6);
      p.speed = Math.max(0, p.speed - 40 * dt);
      const f = fwd(p.yaw, 0);
      p.pos[0] += f[0] * p.speed * dt * (1 - k); p.pos[2] += f[2] * p.speed * dt * (1 - k);
      if (k >= 1) {
        const s = surface(E, p.pos[0], p.pos[2]);
        p.pos[1] = s.y + X.stand; p.mode = 'perch'; p.tr = null; p.speed = 0; p.vel = [0, 0, 0];
        ev.push({ e: 'perch', kind: s.kind });
      }
      p.breathing = false; p.boosting = false;
      return ev;
    }
    if (p.mode === 'perch') {
      p.stun = Math.max(0, p.stun - dt);
      const free = p.stun <= 0;
      const sx = free ? clamp(inp.sx || 0, -1, 1) : 0;
      p.sx = sx; p.yaw = wrap(p.yaw - sx * X.perch.turn * dt);
      p.pitch += (0 - p.pitch) * Math.min(1, dt * 6); p.roll += (0 - p.roll) * Math.min(1, dt * 6); p.rollX = 0;
      p.boosting = false; p.speed = 0; p.vel = [0, 0, 0];
      p.breathing = free && !!inp.breath && p.st > (p.breathing ? 0.5 : 8);
      if (p.breathing) p.st -= 32 * dt;
      else p.st += 17 * X.perch.stRegen * dt;
      p.st = clamp(p.st, 0, 100);
      const s = surface(E, p.pos[0], p.pos[2]);
      p.pos[1] = s.y + X.stand;
      if (free && (inp.takeoff || (inp.sy || 0) > 0.6 || inp.boost)) { tryTakeoff(p); ev.push({ e: 'takeoff' }); }
      return ev;
    }
    // fall and down: gravity, drag, tumble; out of control
    p.breathing = p.boosting = false; p.sx = 0; p.rollX = 0;
    p.vel[1] -= FL.g * dt;
    const dr = Math.max(0, 1 - FL.drag * dt);
    p.vel[0] *= dr; p.vel[2] *= dr;
    for (let k = 0; k < 3; k++) p.pos[k] += p.vel[k] * dt;
    p.spin += dt * (p.mode === 'down' ? FL.spin * 0.4 : FL.spin);
    p.roll = p.spin; p.pitch += (-0.9 - p.pitch) * Math.min(1, dt * 2);
    const hs = Math.hypot(p.vel[0], p.vel[2]);
    if (hs > 0.5) p.yaw = wrap(p.yaw + wrap(Math.atan2(p.vel[0], p.vel[2]) - p.yaw) * Math.min(1, dt * 2));
    // keep out of pillars and walls while tumbling
    for (const pl of E.pillars) {
      const dx = p.pos[0] - pl.x, dz = p.pos[2] - pl.z, d = Math.hypot(dx, dz);
      if (d < pl.r + 1 && p.pos[1] < pl.top - 0.2 && d > 1e-6) { p.pos[0] = pl.x + dx / d * (pl.r + 1); p.pos[2] = pl.z + dz / d * (pl.r + 1); }
    }
    const h = S.hit(E.town, p.pos[0], p.pos[2], 1);
    if (h && p.pos[1] < h.roof - 0.2) { p.pos[0] += h.nx * h.depth; p.pos[2] += h.nz * h.depth; }
    const R = T.region(E.regionId), rr = Math.hypot(p.pos[0], p.pos[2]);
    if (rr > R.radius - 20) { p.pos[0] *= (R.radius - 20) / rr; p.pos[2] *= (R.radius - 20) / rr; }
    const s = surface(E, p.pos[0], p.pos[2]);
    if (p.pos[1] <= s.y + X.stand) {
      const vy = -p.vel[1];
      p.pos[1] = s.y + X.stand;
      p.vel = [0, 0, 0]; p.speed = 0; p.pitch = 0; p.roll = 0; p.spin = 0;
      if (p.mode === 'down') { p.landed = true; return ev; }
      let dmg = Math.min(FL.maxDmg, Math.max(0, (vy - FL.impactFrom) * FL.impactK));
      if (s.kind === 'water') dmg *= 0.5;
      p.mode = 'perch'; p.stun = FL.stun; p.tr = null;
      ev.push({ e: 'impact', dmg: Math.round(dmg), water: s.kind === 'water', kind: s.kind });
    }
    return ev;
  }

  /** Compact pose a client sends to the host (and the host keeps for its own dragon). */
  function poseOf(p) {
    return { p: p.pos.map(r2), v: p.vel.map(r2), y: r3(p.yaw), pi: r3(p.pitch), r: r3(p.roll), rx: r3(p.rollX), sx: r2(p.sx),
      b: p.breathing ? 1 : 0, i: p.inv > 0 ? 1 : 0, m: Math.max(0, MODES.indexOf(p.mode)) };
  }

  /* =====================================================================
   * World (host)
   * ===================================================================== */
  function newWorld(opts) {
    opts = opts || {};
    const phase = PHASES.indexOf(opts.phase) >= 0 ? opts.phase : 'play';   // the client starts rooms in 'lobby'
    const w = {
      t: 0, timeLimit: opts.timeLimit || X.timeLimit, timeLeft: opts.timeLimit || X.timeLimit, fragLimit: opts.fragLimit || X.fragLimit,
      phase, over: phase === 'over', overT: 0, winner: 0, code: opts.code || '', hostId: opts.hostId || 1,
      players: {}, balls: [], food: [], nid: 1, ev: [], rng: opts.rng || Math.random, round: 1,
      trees: {},                                                  // felled / burning trees by tree number (for players who join later)
      ledger: {}, seqN: 1,                                        // ledger: seat key -> stats of players who left
    };
    const A = arena(), FD = X.food;
    A.homes.forEach((h, i) => {
      const type = foodTypeAt(i);
      w.food.push({ id: w.nid++, type, home: h.slice(), x: h[0], z: h[1], yaw: w.rng() * 6.28, speed: 0, goal: null, pause: w.rng() * 3, alive: true, back: 0, t: w.rng() * 10 });
    });
    void FD;
    return w;
  }
  function foodTypeAt(i) {
    // the same mix in every world: cumulative shares over a fixed cycle of 8 places
    const k = (i % 8) / 8;
    let acc = 0;
    for (const t of FOOD_TYPES) { acc += X.food.kinds[t].share; if (k < acc - 1e-9) return t; }
    return FOOD_TYPES[FOOD_TYPES.length - 1];
  }
  function playerList(w) { return Object.keys(w.players).map(k => w.players[k]); }
  function freeColor(w) {
    const used = new Set(playerList(w).map(p => p.color));
    for (let c = 0; c < X.palettes; c++) if (!used.has(c)) return c;
    return playerList(w).length % X.palettes;
  }
  /** Spawn point farthest from the living dragons (ties: the rng). */
  function spawnFor(w, id) {
    const A = arena(), alive = playerList(w).filter(p => p.id !== id && !p.down);
    let best = null, bestD = -1;
    A.spawns.forEach(s => {
      let d = alive.length ? Infinity : w.rng() * 100;
      alive.forEach(p => { d = Math.min(d, Math.hypot(p.pos[0] - s.pos[0], p.pos[2] - s.pos[2])); });
      d += w.rng() * 20;
      if (d > bestD) { bestD = d; best = s; }
    });
    return best;
  }
  /** key: the player's seat key (keyOf(token)); a key seen before gets its stats (and colour, when free) back. */
  function addPlayer(w, id, name, color, key) {
    key = typeof key === 'string' ? key.slice(0, 40) : '';
    if (key) playerList(w).forEach(o => { if (o.key === key) removePlayer(w, o.id); });   // a stale connection of the same seat
    const L = key ? w.ledger[key] : null;
    if (color == null && L && !playerList(w).some(o => o.color === L.color)) color = L.color;
    const s = spawnFor(w, id);
    const pl = {
      id, key, seq: w.seqN++, name: String(name || 'Dragon').slice(0, 16), color: color == null ? freeColor(w) : color,
      pos: s.pos.slice(), vel: [0, 0, 0], yaw: s.yaw, pitch: 0, roll: 0, rollX: 0, sx: 0, mode: 0,
      br: false, hp: X.hp, down: false, downT: 0, rollInv: false, sinv: X.spawnInv,
      kills: L ? L.kills : 0, deaths: L ? L.deaths : 0, score: L ? L.score : 0,
      lastBy: 0, lastAt: -1e9, bumpT: 0, eaten: 0,
    };
    if (L) delete w.ledger[key];
    w.players[id] = pl;
    w.ev.push({ e: 'join', pl: id, name: pl.name, p: pl.pos.map(r2), y: r3(pl.yaw) });
    return pl;
  }
  function removePlayer(w, id) {
    const p = w.players[id];
    if (!p) return;
    delete w.players[id];
    if (p.key) w.ledger[p.key] = { name: p.name, color: p.color, kills: p.kills, deaths: p.deaths, score: p.score };
    w.ev.push({ e: 'left', pl: id, name: p.name });
  }
  function setPose(w, id, m) {
    const p = w.players[id];
    if (!p || !m || !fin(m.p)) return;
    if (p.down) return;                                           // the host decides when a dead dragon comes back
    p.pos = m.p.slice(); p.vel = fin(m.v) ? m.v.slice() : [0, 0, 0];
    p.yaw = +m.y || 0; p.pitch = +m.pi || 0; p.roll = +m.r || 0; p.rollX = +m.rx || 0; p.sx = +m.sx || 0;
    p.mode = clamp(m.m | 0, 0, MODES.length - 1);
    p.br = !!m.b && (p.mode === 0 || p.mode === 2); p.rollInv = !!m.i;
  }
  const modeOf = p => MODES[p.mode] || 'air';

  function shoot(w, owner, from, dir) {
    if (!fin(from) || !fin(dir) || w.over) return null;
    const pl = w.players[owner];
    if (!pl || pl.down || d3(pl.pos, from) > 25) return null;
    const d = norm(dir), s = X.ball.speed;
    const b = { id: w.nid++, o: owner, p: from.slice(), v: [d[0] * s, d[1] * s, d[2] * s], life: X.ball.life };
    w.balls.push(b);
    w.ev.push({ e: 'ball', id: b.id, o: owner, p: b.p.map(r2), v: b.v.map(r2) });
    return b;
  }

  /** Damage to a dragon. by = the attacker's id (0 = none); kind: ball | breath | bump | crash | impact. */
  function damage(w, p, amt, by, kind) {
    if (!p || p.down || w.phase !== 'play' || !(amt > 0)) return false;   // lobby = warm-up: nothing hurts
    if (p.sinv > 0) return false;
    if ((kind === 'ball' || kind === 'breath') && p.rollInv) return false;
    if (by && by !== p.id && w.players[by]) { p.lastBy = by; p.lastAt = w.t; }
    p.hp -= amt;
    w.ev.push({ e: 'hurt', pl: p.id, hp: Math.round(Math.max(0, p.hp)), by: by || 0, k: kind });
    if (p.hp <= 0) kill(w, p, by, kind);
    return true;
  }
  function kill(w, p, by, kind) {
    p.hp = 0; p.down = true; p.downT = X.respawn; p.br = false; p.deaths++;
    let killer = by && by !== p.id && w.players[by] ? by : 0;
    if (!killer && p.lastBy && w.t - p.lastAt <= X.fall.credit && w.players[p.lastBy]) killer = p.lastBy;
    if (killer) { const k = w.players[killer]; k.kills++; k.score++; }
    else p.score--;                                               // crashed with nobody to blame
    w.ev.push({ e: 'kill', pl: p.id, by: killer, k: kind, name: p.name, kn: killer ? w.players[killer].name : '', t: X.respawn });
    p.lastBy = 0;
    if (killer && w.players[killer].score >= w.fragLimit) endMatch(w);
  }
  /** A client's own crash / impact damage ('c' message); attackers get the credit through lastBy. */
  function reportCrash(w, id, dmg, kind) {
    const p = w.players[id];
    if (!p) return false;
    return damage(w, p, clamp(+dmg || 0, 0, X.fall.maxDmg + X.fall.crashDmg), 0, kind === 'impact' ? 'impact' : 'crash');
  }
  /** Tree events from a player's browser: [{ k: 'f' (felled) | 'i' (set alight), i (tree number), dx, dz }]. Recorded and sent on to everyone. */
  function treeEvents(w, id, list) {
    if (!w.players[id] || !Array.isArray(list)) return 0;
    let n = 0;
    for (const t of list.slice(0, 40)) {
      if (!t || !Number.isInteger(t.i) || t.i < 0 || t.i > 99999 || (t.k !== 'f' && t.k !== 'i')) continue;
      const dx = clamp(+t.dx || 0, -1, 1), dz = clamp(+t.dz || 0, -1, 1), rec = w.trees[t.i] || (w.trees[t.i] = [0, 0, 0, 0, 0]);
      if (t.k === 'f') { if (rec[0]) continue; rec[0] = 1; rec[2] = dx; rec[3] = dz; } else { if (rec[1]) continue; rec[1] = 1; }
      rec[4] = w.t;
      w.ev.push(t.k === 'f' ? { e: 'tree', k: 'f', i: t.i, dx: r2(dx), dz: r2(dz) } : { e: 'tree', k: 'i', i: t.i });
      n++;
    }
    return n;
  }
  /** Trees that are down or burnt, for a player who joins: [[i, st, fire, dx, dz]] (grown-back ones are dropped). */
  function forestState(w) {
    const keep = VF ? VF.RULES.regrow : 150, out = [];
    for (const i of Object.keys(w.trees)) {
      const r = w.trees[i];
      if (keep > 0 && w.t - r[4] > keep) { delete w.trees[i]; continue; }
      out.push([+i, r[0], r[1] ? 2 : 0, r[2], r[3]]);
    }
    return out;
  }
  function respawn(w, p) {
    const s = spawnFor(w, p.id);
    p.down = false; p.hp = X.hp; p.sinv = X.spawnInv; p.pos = s.pos.slice(); p.yaw = s.yaw; p.vel = [0, 0, 0]; p.mode = 0;
    p.lastBy = 0;
    w.ev.push({ e: 'spawn', pl: p.id, p: p.pos.map(r2), y: r3(s.yaw) });
  }

  /** The leaderboard: score, then kills, then fewer deaths, then the name. */
  function board(w) {
    return playerList(w).map(p => ({ id: p.id, name: p.name, color: p.color, kills: p.kills, deaths: p.deaths, score: p.score, down: p.down }))
      .sort((a, b) => b.score - a.score || b.kills - a.kills || a.deaths - b.deaths || (a.name < b.name ? -1 : a.name > b.name ? 1 : a.id - b.id));
  }
  function endMatch(w) {
    if (w.over) return;
    const b = board(w);
    const tie = b.length > 1 && b[1].score === b[0].score && b[1].kills === b[0].kills && b[1].deaths === b[0].deaths;
    w.over = true; w.phase = 'over'; w.overT = X.overTime; w.winner = b.length && !tie ? b[0].id : 0;   // 0 = a draw
    w.balls.length = 0;
    w.ev.push({ e: 'over', winner: w.winner, name: w.winner ? b[0].name : '', board: b });
  }
  function resetScores(w) {
    playerList(w).forEach(p => { p.kills = p.deaths = p.score = 0; p.eaten = 0; });
    for (const k in w.ledger) Object.assign(w.ledger[k], { kills: 0, deaths: 0, score: 0 });
  }
  /** After a match: back to the lobby for the next round (scores reset, everyone respawns). */
  function restart(w) {
    w.over = false; w.phase = 'lobby'; w.overT = 0; w.winner = 0; w.timeLeft = w.timeLimit; w.balls.length = 0; w.round++;
    w.trees = {};                                                // the forest stands again (clients reset on 'restart')
    resetScores(w);
    playerList(w).forEach(p => respawn(w, p));
    w.ev.push({ e: 'restart', round: w.round });
  }
  /** Lobby -> match: the host pressed Start. Scores from 0, everyone respawns, the clock runs. */
  function startMatch(w) {
    if (w.phase !== 'lobby') return false;
    w.phase = 'play'; w.over = false; w.winner = 0; w.timeLeft = w.timeLimit; w.balls.length = 0;
    resetScores(w);
    playerList(w).forEach(p => respawn(w, p));
    w.ev.push({ e: 'start', fl: w.fragLimit, tl: w.timeLimit });
    return true;
  }
  /** Host settings, in the lobby only: kills to win and the time limit (from fragChoices / timeChoices). */
  function setSettings(w, o) {
    if (w.phase !== 'lobby' || !o) return false;
    w.fragLimit = pick(o.fragLimit, X.fragChoices, w.fragLimit);
    w.timeLimit = pick(o.timeLimit, X.timeChoices, w.timeLimit);
    w.timeLeft = w.timeLimit;
    return true;
  }

  /* ---------- room record: what every client keeps, so anyone can host the room again ---------- */
  function exportRoom(w) {
    const people = {};
    for (const k in w.ledger) people[k] = Object.assign({}, w.ledger[k]);
    playerList(w).forEach(p => { if (p.key) people[p.key] = { name: p.name, color: p.color, kills: p.kills, deaths: p.deaths, score: p.score }; });
    return { v: 1, code: w.code, round: w.round, phase: w.phase, timeLeft: Math.ceil(w.timeLeft), fragLimit: w.fragLimit, timeLimit: w.timeLimit, people };
  }
  /** A world from a saved / received record (null when it is not one): everyone is in the ledger until they rejoin. */
  function importRoom(rec, opts) {
    opts = opts || {};
    if (!rec || typeof rec !== 'object' || rec.v !== 1 || !rec.people || typeof rec.people !== 'object') return null;
    const timeLimit = pick(rec.timeLimit, X.timeChoices, X.timeLimit);
    const w = newWorld({ phase: PHASES.indexOf(rec.phase) >= 0 ? rec.phase : 'lobby', rng: opts.rng, code: opts.code || String(rec.code || ''),
      fragLimit: pick(rec.fragLimit, X.fragChoices, X.fragLimit), timeLimit });
    w.round = Math.max(1, Math.min(1e6, rec.round | 0));
    w.timeLeft = w.phase === 'play' ? clamp(+rec.timeLeft || 0, 0, timeLimit) : timeLimit;
    if (w.phase === 'play' && w.timeLeft <= 0) w.phase = 'over';
    w.over = w.phase === 'over';
    const n = v => clamp(Math.round(+v || 0), -9999, 9999);
    Object.keys(rec.people).slice(0, 64).forEach(k => {
      const e = rec.people[k];
      if (!/^k[0-9a-z]{2,40}$/.test(k) || !e || typeof e !== 'object') return;
      w.ledger[k] = { name: String(e.name || 'Dragon').slice(0, 16), color: clamp(e.color | 0, 0, X.palettes - 1), kills: Math.max(0, n(e.kills)), deaths: Math.max(0, n(e.deaths)), score: n(e.score) };
    });
    return w;
  }
  /**
   * Merges another copy of this room (a record from a host that stepped down, or a joining player's saved record) into
   * w: a newer round wins outright; in the same round the later phase wins (lobby < play < over), the clock takes the
   * lower time left, and each seat keeps whichever copy has more progress (kills + deaths only grow within a round).
   * Returns false when rec is not a record of this room or is of an older round.
   */
  function mergeRoom(w, rec) {
    const r = importRoom(rec, { code: rec && rec.code });
    if (!r || (w.code && r.code !== w.code) || r.round < w.round) return false;
    const rank = { lobby: 0, play: 1, over: 2 };
    let toOver = false;
    if (r.round > w.round) {
      Object.assign(w, { round: r.round, phase: r.phase === 'over' ? 'play' : r.phase, over: false, timeLeft: r.timeLeft, fragLimit: r.fragLimit, timeLimit: r.timeLimit });
      resetScores(w);
      toOver = r.phase === 'over';
    } else if (rank[r.phase] > rank[w.phase]) {
      if (r.phase === 'over') toOver = true;
      else Object.assign(w, { phase: 'play', timeLeft: r.timeLeft, fragLimit: r.fragLimit, timeLimit: r.timeLimit });
    } else if (r.phase === 'play' && w.phase === 'play') w.timeLeft = Math.min(w.timeLeft, r.timeLeft);
    const prog = e => e.kills + e.deaths;
    for (const k in r.ledger) {
      const e = r.ledger[k], p = playerList(w).find(q => q.key === k), L = w.ledger[k];
      if (p) { if (prog(e) > prog(p)) Object.assign(p, { kills: e.kills, deaths: e.deaths, score: e.score }); }
      else if (!L || prog(e) > prog(L)) w.ledger[k] = Object.assign({}, e, L ? { color: L.color } : {});
    }
    if (toOver || (w.phase === 'play' && playerList(w).some(p => p.score >= w.fragLimit))) { if (w.phase === 'lobby') w.phase = 'play'; endMatch(w); }
    return true;
  }
  /** Who takes over when the host is gone: the guest that joined first (lowest seq). rows: [{ id, seq }]. */
  function successorOf(rows, hostId) {
    let best = null;
    for (const r of rows || []) if (r && r.id !== hostId && (!best || r.seq < best.seq)) best = r;
    return best ? best.id : 0;
  }

  function stepBalls(w, dt) {
    const B = X.ball;
    for (let i = w.balls.length - 1; i >= 0; i--) {
      const b = w.balls[i];
      b.life -= dt;
      for (let k = 0; k < 3; k++) b.p[k] += b.v[k] * dt;
      let hit = false, direct = 0;
      for (const p of playerList(w)) {
        if (p.id === b.o || p.down) continue;
        if (d3(p.pos, b.p) < B.hit && !p.rollInv && p.sinv <= 0) { damage(w, p, B.dmg, b.o, 'ball'); hit = true; direct = p.id; break; }
      }
      const A = arena();
      if (!hit) {
        if (b.p[1] < T.surfaceAt(A.region, b.p[0], b.p[2])) hit = true;
        else {
          const top = solidTop({ town: A.town, pillars: A.pillars }, b.p[0], b.p[2]);
          if (top != null && b.p[1] < top) hit = true;
        }
      }
      if (hit) for (const p of playerList(w)) {
        if (p.id === b.o || p.id === direct || p.down) continue;
        if (d3(p.pos, b.p) < B.splashR) damage(w, p, B.splash, b.o, 'ball');
      }
      if (hit || b.life <= 0) {
        w.ev.push({ e: 'pop', id: b.id, o: b.o, h: hit ? 1 : 0, p: b.p.map(r2) });
        w.balls.splice(i, 1);
      }
    }
  }
  function stepBreath(w, dt) {
    const Bt = X.breath, cosA = Math.cos(Bt.cone * Math.PI / 180), pl = playerList(w);
    pl.forEach(a => {
      if (!a.br || a.down) return;
      const f = fwd(a.yaw, a.pitch);
      pl.forEach(p => {
        if (p === a || p.down) return;
        const d = [p.pos[0] - a.pos[0], p.pos[1] - a.pos[1], p.pos[2] - a.pos[2]], l = Math.hypot(d[0], d[1], d[2]);
        if (l > 0.1 && l < Bt.range && (d[0] * f[0] + d[1] * f[1] + d[2] * f[2]) / l > cosA) damage(w, p, Bt.dps * dt, a.id, 'breath');
      });
    });
  }
  /** Dragon-on-dragon bumps: both fall; the host tells both clients ('bump' with the push for each). */
  function stepBumps(w, dt) {
    const Bp = X.bump, pl = playerList(w);
    pl.forEach(p => { p.bumpT = Math.max(0, p.bumpT - dt); });
    const can = p => !p.down && p.bumpT <= 0 && p.sinv <= 0 && (p.mode === 0 || p.mode === 2);
    for (let i = 0; i < pl.length; i++) for (let j = i + 1; j < pl.length; j++) {
      const a = pl[i], b = pl[j];
      if (!can(a) || !can(b) || (a.mode === 2 && b.mode === 2)) continue;
      const d = d3(a.pos, b.pos);
      if (d >= Bp.r) continue;
      const n = d > 1e-6 ? [(b.pos[0] - a.pos[0]) / d, (b.pos[1] - a.pos[1]) / d, (b.pos[2] - a.pos[2]) / d] : [1, 0, 0];
      a.bumpT = b.bumpT = Bp.cool;
      const pa = [-n[0] * Bp.push, -n[1] * Bp.push * 0.5 + 2, -n[2] * Bp.push], pb = [n[0] * Bp.push, n[1] * Bp.push * 0.5 + 2, n[2] * Bp.push];
      a.mode = b.mode = 3;                                        // falling until the clients report otherwise
      w.ev.push({ e: 'bump', a: a.id, b: b.id, pa: pa.map(r2), pb: pb.map(r2), p: [(a.pos[0] + b.pos[0]) / 2, (a.pos[1] + b.pos[1]) / 2, (a.pos[2] + b.pos[2]) / 2].map(r2) });
      damage(w, a, Bp.dmg, b.id, 'bump');
      damage(w, b, Bp.dmg, a.id, 'bump');
    }
  }
  /** Food animals: wander near home, flee close dragons; eaten by a dragon low over them; back after respawn s. */
  function stepFood(w, dt) {
    const FD = X.food, A = arena(), id = A.region, pl = playerList(w).filter(p => !p.down);
    for (const f of w.food) {
      f.t += dt;
      if (!f.alive) {
        f.back -= dt;
        if (f.back <= 0) {
          f.alive = true; f.x = f.home[0]; f.z = f.home[1]; f.speed = 0; f.goal = null; f.pause = 2;
          w.ev.push({ e: 'food', f: f.id });
        }
        continue;
      }
      const K = FD.kinds[f.type], gy = T.surfaceAt(id, f.x, f.z);
      // eaten?
      let eater = null;
      for (const p of pl) {
        if (Math.hypot(p.pos[0] - f.x, p.pos[2] - f.z) < FD.eatR && p.pos[1] - gy < FD.eatAlt && p.pos[1] - gy > -2) { eater = p; break; }
      }
      if (eater) {
        f.alive = false; f.back = FD.respawn;
        eater.hp = Math.min(X.hp, eater.hp + K.hp); eater.eaten++;
        w.ev.push({ e: 'eat', pl: eater.id, f: f.id, type: f.type, hp: Math.round(eater.hp), gain: K.hp, p: [r2(f.x), r2(gy), r2(f.z)] });
        continue;
      }
      // flee the nearest dragon in range, else wander around home
      let threat = null, td = FD.flee;
      for (const p of pl) {
        const d = Math.hypot(p.pos[0] - f.x, p.pos[2] - f.z);
        if (d < td && p.pos[1] - gy < 30) { td = d; threat = p; }
      }
      let tx = null, tz = null, sp = 0;
      if (threat) {
        const a = Math.atan2(f.x - threat.pos[0], f.z - threat.pos[2]);
        tx = f.x + Math.sin(a) * 10; tz = f.z + Math.cos(a) * 10; sp = K.speed * 1.6;
      } else {
        if (f.pause > 0) f.pause -= dt;
        else if (!f.goal) {
          const a = w.rng() * Math.PI * 2, r = w.rng() * FD.roam;
          f.goal = [f.home[0] + Math.cos(a) * r, f.home[1] + Math.sin(a) * r];
        }
        if (f.goal) {
          tx = f.goal[0]; tz = f.goal[1]; sp = K.speed * 0.45;
          if (Math.hypot(tx - f.x, tz - f.z) < 1) { f.goal = null; f.pause = 1.5 + w.rng() * 4; tx = null; }
        }
      }
      if (tx == null) { f.speed = Math.max(0, f.speed - dt * 6); continue; }
      f.speed += (sp - f.speed) * Math.min(1, dt * 4);
      const want = Math.atan2(tx - f.x, tz - f.z);
      f.yaw = wrap(f.yaw + wrap(want - f.yaw) * Math.min(1, dt * 5));
      const nx = f.x + Math.sin(f.yaw) * f.speed * dt, nz = f.z + Math.cos(f.yaw) * f.speed * dt;
      const away = Math.hypot(nx - f.home[0], nz - f.home[1]);
      const blocked = !T.dryAt(id, nx, nz) || away > FD.roam * 2 || S.solidAt(A.town, nx, nz, 0.5) != null
        || A.pillars.some(pp => Math.hypot(nx - pp.x, nz - pp.z) < pp.r + 1);
      if (blocked) { f.goal = null; f.yaw = wrap(f.yaw + Math.PI * (0.5 + w.rng())); f.speed *= 0.3; continue; }
      f.x = nx; f.z = nz;
    }
  }

  function stepWorld(w, dt) {
    w.t += dt;
    const pl = playerList(w);
    if (w.over) {
      w.overT -= dt;
      pl.forEach(p => { if (p.down) { p.downT -= dt; if (p.downT <= 0) respawn(w, p); } });
      return;
    }
    if (w.phase === 'play') w.timeLeft -= dt;
    pl.forEach(p => {
      p.sinv = Math.max(0, p.sinv - dt);
      if (p.down) { p.downT -= dt; if (p.downT <= 0) respawn(w, p); }
      else p.hp = Math.min(X.hp, p.hp + X.regen * dt);
    });
    stepBreath(w, dt);
    stepBumps(w, dt);
    stepBalls(w, dt);
    stepFood(w, dt);
    if (w.phase === 'play' && w.timeLeft <= 0) { w.timeLeft = 0; endMatch(w); }
  }

  /** Compact state for every client (about 20 times a second). */
  function snapshot(w) {
    return {
      t: r2(w.t), tl: Math.ceil(w.timeLeft), fl: w.fragLimit, tm: w.timeLimit, o: w.over ? 1 : 0, win: w.winner, rd: w.round,
      ph: PHASES.indexOf(w.phase), hid: w.hostId,
      P: playerList(w).map(p => [p.id, r2(p.pos[0]), r2(p.pos[1]), r2(p.pos[2]), r3(p.yaw), r3(p.pitch), r3(p.roll), r3(p.rollX),
        p.br ? 1 : 0, Math.round(p.hp), p.down ? 1 : 0, p.color, p.name, r2(p.sx), p.kills, p.deaths, p.score, p.mode, p.sinv > 0 ? 1 : 0, p.seq]),
      F: w.food.filter(f => f.alive).map(f => [f.id, FOOD_TYPES.indexOf(f.type), r2(f.x), r2(f.z), r3(f.yaw), r2(f.speed)]),
    };
  }

  M.define('dm', {
    MODES, PHASES, FOOD_TYPES, keyOf, treeEvents, forestState, startMatch, setSettings, exportRoom, importRoom, mergeRoom, successorOf, arena, env, treeGrid, surface, solidTop, obstacle, pillarAt,
    newPilot, step, startFall, tryPerch, perchBlock, tryTakeoff, tryBall, tryRoll, poseOf,
    newWorld, addPlayer, removePlayer, setPose, shoot, damage, reportCrash, respawn, board, endMatch, restart,
    stepWorld, snapshot, playerList, modeOf, spawnFor,
  });
})(typeof self !== 'undefined' ? self : this);
