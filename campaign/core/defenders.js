/*
 * Verdigris campaign - defenders: peasants and archers (Phase 2 T15, 002_task_kingdom.md 4.3 and 5.4).
 *   spawn(town, rng) -> squad      squad = { town, list: [def], arrows: [], t, rung: { place: s }, kills }
 *       archers: the template's `archers` of each settlement, spread over its towers (round robin), on the tower top;
 *       the archers of a ruined tower are not there (they come back when it is rebuilt);
 *       peasants: the template's `peasants`, each with a home building (houses first) to wander around;
 *       ballista platforms: a ballista with its crew on each (kind 'ballista', T16); hp = the crew's, the platform
 *       burns as a building (its hp in data.buildings); a ruined platform has no ballista until it is rebuilt.
 *       def = { id, kind, place, building, post, home, pos (eye), base, yaw, sight, fov, hp, alive, aware, state,
 *               focus, seen, heard, search, phase, aim, cool, shots, gap, target, hidden, hideT, ring, burnT }
 *   step(cs, ev, dt, { scale, spot, inside }) -> events[]   perception (core/perception.js) for every live defender,
 *       states idle -> suspicious -> alert -> search (last seen spot, perception.searchTime) -> idle; archers volley
 *       at a dragon they see within `range` and turn to it; peasants run to the bell of their settlement (one rings it),
 *       then hide in the building furthest from the dragon until searchTime has passed; arrows fly (pooled, max
 *       projectiles.max, gravity) and hit the dragon (damage x upgrades later), stick in the ground or roofs;
 *       a ballista (T16) turns slowly (`turn`), aims for `aimTime` (d.aimAt = the lead point, shown as the aim line),
 *       the last `lock` s of it the point is frozen, then one bolt flies straight at it (`bolt` speed, no gravity),
 *       `reload` s until the next aim; a dragon that changes course during the lock is missed.
 *       Events: 'aware:state' { id, kind, state, from }, 'arrow:fired', 'arrow:hit' { damage, pos }, 'bell:ring'
 *       { place, pos }, 'defender:killed' { id, kind, place, cause: 'fire' | 'fall' }, 'defender:back' (rebuilt tower),
 *       'bolt:aim' { id, pos, at } (aim starts), 'bolt:fire' { id }, 'bolt:hit' { damage, pos, from }.
 *   burn(squad, cone, dt) -> events[]   the breath cone: archers and ballista crews in it burn (defense.burn hp/s,
 *       'defender:killed'),
 *       peasants in it panic (alert at once, they flee) - they do not die
 *   zones(squad) -> [{ x, z, r }]  per settlement with live archers: where they can shoot (the mother keeps out)
 *   calm(squad) -> squad           debug: everybody forgets the dragon, the dead stand again
 * The squad also serves as cs.watch (the T14 debug view and the 'to post' debug jump read cs.watch.list).
 * Pure: no DOM, no THREE.
 */
(function (root) {
  'use strict';
  const M = typeof module === 'object' && module.exports ? require('./umd.js') : root.VCamp;
  const D = M.need('data'), T = M.need('terrain'), SE = M.need('settlement'), PC = M.need('perception');
  const { wrap, clamp } = M.need('math');
  const TAU = Math.PI * 2;
  const SHELTER = { house: 1, barn: 1, granary: 1, taxhouse: 1, barracks: 1 };

  function baseYaw(b, pl) {
    const dx = b.pos[0] - (pl ? pl.x : b.pos[0]), dz = b.pos[2] - (pl ? pl.z : b.pos[2]);
    return Math.hypot(dx, dz) > 2 ? Math.atan2(dx, dz) : (pl ? pl.yaw : 0);
  }

  function mk(kind, id, place, pos, base, extra) {
    const V = D.defenders[kind];
    return Object.assign({
      id, kind, place, building: null, post: false, home: pos.slice(), pos: pos.slice(), base, yaw: base,
      sight: V.sight, fov: V.fov, hp: V.hp, alive: true, aware: 0, state: 'idle', focus: null, seen: 0, heard: null,
      search: 0, phase: (pos[0] * 0.013 + pos[2] * 0.007) % TAU, aim: 0, cool: 0, shots: 0, gap: 0, target: null,
      hidden: false, hideT: 0, ring: 0, burnT: 0, walk: 0,
    }, extra || {});
  }

  /** Eye height of a defender standing on b (a post building) or on the ground. */
  const topOf = b => b.pos[1] + b.h + D.perception.watch.eye;

  const NO_RESP = { extraArchers: 0, patrols: 0, bellFast: false };

  /** T17: the patrol route of a region: its road (terrain feature 'road', ends trimmed by patrol.trim), else a line
   *  through its settlement centres; null with fewer than 2 points. */
  function routeOf(town) {
    if (!town) return null;
    const R = T.region(town.region), road = ((R.terrain && R.terrain.features) || []).find(f => f.type === 'road');
    let pts = road ? road.points.map(q => [q[0], q[1]]) : town.places.map(pl => [pl.x, pl.z]);
    const lim = (R.radius || 1000) - D.alert.patrol.trim;
    pts = pts.map(([x, z]) => { const l = Math.hypot(x, z); return l > lim ? [x / l * lim, z / l * lim] : [x, z]; });
    if (pts.length < 2) return null;
    const len = [0];
    for (let i = 1; i < pts.length; i++) len.push(len[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]));
    return { pts, len, total: len[len.length - 1] };
  }
  /** Point and heading at distance s along a route. */
  function along(route, s) {
    s = clamp(s, 0, route.total);
    let i = 1;
    while (i < route.pts.length - 1 && route.len[i] < s) i++;
    const a = route.pts[i - 1], b = route.pts[i], seg = route.len[i] - route.len[i - 1] || 1, k = (s - route.len[i - 1]) / seg;
    return { x: a[0] + (b[0] - a[0]) * k, z: a[1] + (b[1] - a[1]) * k, yaw: Math.atan2(b[0] - a[0], b[1] - a[1]) };
  }

  /** opts (T17): { resp: alert.responses(level), old: the squad before (defenders with the same id keep their state) } */
  function spawn(town, rng, opts) {
    rng = rng || Math.random;
    const list = [], E = D.defense, resp = (opts && opts.resp) || NO_RESP;
    if (!town) return { town, list, arrows: [], bolts: [], t: 0, rung: {}, kills: 0, resp, alarmed: {} };
    for (const pl of town.places) {
      const tpl = D.settlements[pl.type] || {}, own = town.buildings.filter(b => b.place === pl.id);
      const towers = own.filter(b => D.buildings[b.type].post === 'archer');
      const nA = (tpl.archers || 0) + (tpl.archers ? resp.extraArchers || 0 : 0);   // T17: alert sends more archers up
      for (let i = 0; i < nA && towers.length; i++) {
        const b = towers[i % towers.length], k = Math.floor(i / towers.length), base = baseYaw(b, pl);
        const nOn = Math.floor(nA / towers.length) + (i % towers.length < nA % towers.length ? 1 : 0);
        const side = (k - (nOn - 1) / 2) * E.towerSpacing;   // side by side, across the outward direction
        const pos = [b.pos[0] + Math.cos(base) * side, topOf(b), b.pos[2] - Math.sin(base) * side];
        const d = mk('archer', b.id + '.archer' + (k + 1), pl.id, pos, base, { building: b.id, post: true });
        if (b.ruin) { d.alive = false; d.down = true; }
        list.push(d);
      }
      for (const b of own.filter(x => D.buildings[x.type].post === 'ballista')) {
        const pos = [b.pos[0], topOf(b), b.pos[2]];
        const d = mk('ballista', b.id + '.ballista', pl.id, pos, baseYaw(b, pl), { building: b.id, post: true });
        if (b.ruin) { d.alive = false; d.down = true; }
        list.push(d);
      }
      const homes = own.filter(b => b.type === 'house').concat(own.filter(b => SHELTER[b.type] && b.type !== 'house'));
      for (let i = 0; i < (tpl.peasants || 0); i++) {
        const hb = homes.length ? homes[i % homes.length] : null, a = rng() * TAU;
        const hx = hb ? hb.pos[0] + Math.sin(a) * (hb.r + 2) : pl.x + Math.sin(a) * 6;
        const hz = hb ? hb.pos[2] + Math.cos(a) * (hb.r + 2) : pl.z + Math.cos(a) * 6;
        const pos = [hx, T.surfaceAt(town.region, hx, hz) + E.eye, hz];
        list.push(mk('peasant', pl.id + '.peasant' + (i + 1), pl.id, pos, a, { homeB: hb ? hb.id : null, wanderT: rng() * 3 }));
      }
    }
    // T17 patrols: archer pairs walking the road (alert 2+), spread along it, every other pair heading the other way
    const route = resp.patrols ? routeOf(town) : null, PT = D.alert.patrol;
    for (let i = 0; route && i < resp.patrols; i++) {
      const s0 = route.total * (i + 0.5) / resp.patrols, dir = i % 2 ? -1 : 1;
      for (let k = 0; k < 2; k++) {
        const at = along(route, s0), side = (k - 0.5) * PT.gap, yaw = dir > 0 ? at.yaw : wrap(at.yaw + Math.PI);
        const x = at.x + Math.cos(at.yaw) * side, z = at.z - Math.sin(at.yaw) * side;
        const pl = SE.near(town, x, z, Infinity);
        list.push(mk('archer', town.region + '.patrol' + (i + 1) + '.' + (k + 1), pl ? pl.id : town.region, [x, T.surfaceAt(town.region, x, z) + E.eye, z], yaw,
          { patrol: { s: s0, dir, side, pause: 0 } }));
      }
    }
    const old = opts && opts.old;
    if (old && old.town && old.town.region === town.region) {          // same region (alert level or town change): keep minds
      const was = new Map(old.list.map(d => [d.id, d]));
      for (const d of list) {
        const o = was.get(d.id);
        if (!o) continue;
        const keepPos = !d.post && !d.patrol ? { pos: o.pos.slice(), yaw: o.yaw } : d.patrol ? { pos: o.pos.slice(), yaw: o.yaw, patrol: Object.assign({}, o.patrol) } : { yaw: o.yaw };
        Object.assign(d, { alive: o.alive, down: o.down, hp: o.hp, aware: o.aware, state: o.state, focus: o.focus, search: o.search,
          cool: o.cool, hidden: o.hidden, hideT: o.hideT, shelter: o.shelter, panic: o.panic, rang: o.rang, wTo: o.wTo, wanderT: o.wanderT }, keepPos);
      }
    }
    return { town, list, arrows: old ? old.arrows : [], bolts: old ? old.bolts || [] : [], t: old ? old.t : 0, rung: old ? old.rung : {},
             kills: old ? old.kills : 0, rng, resp, route, alarmed: old ? old.alarmed || {} : {} };
  }

  /** T17: a patrol archer walks its route while idle (ping-pong, a pause at each end); otherwise stands and turns to
   *  what it noticed. */
  function patrolStep(sq, d, dt) {
    const PT = D.alert.patrol, W = D.perception.watch, pa = d.patrol, route = sq.route;
    d.walk = 0;
    if (d.state !== 'idle') {
      if (d.focus) { const dy = wrap(Math.atan2(d.focus[0] - d.pos[0], d.focus[2] - d.pos[2]) - d.yaw), mx = W.turn * dt; d.yaw = wrap(d.yaw + clamp(dy, -mx, mx)); }
      return;
    }
    if (!route) return;
    if (pa.pause > 0) { pa.pause -= dt; return; }
    pa.s += pa.dir * PT.speed * dt;
    if (pa.s <= 0 || pa.s >= route.total) { pa.s = clamp(pa.s, 0, route.total); pa.dir = -pa.dir; pa.pause = PT.pause; }
    const at = along(route, pa.s), x = at.x + Math.cos(at.yaw) * pa.side, z = at.z - Math.sin(at.yaw) * pa.side;
    d.pos[0] = x; d.pos[2] = z; d.pos[1] = T.surfaceAt(sq.town.region, x, z) + D.defense.eye;
    d.yaw = pa.dir > 0 ? at.yaw : wrap(at.yaw + Math.PI);
    d.walk = PT.speed;
  }

  function byId(town, id) { return id ? town.buildings.find(b => b.id === id) : null; }

  /** Point-in-cone test (prey.inCone without the prey offset); the stream stops in the ground. */
  function inCone(cone, p, regionId) {
    const v = [p[0] - cone.origin[0], p[1] - 0.8 - cone.origin[1], p[2] - cone.origin[2]], d = Math.hypot(v[0], v[1], v[2]);
    if (d > cone.range || d < 1e-6) return d < 2;
    if ((v[0] * cone.dir[0] + v[1] * cone.dir[1] + v[2] * cone.dir[2]) / d < Math.cos(cone.cone)) return false;
    return !regionId || PC.los(regionId, cone.origin, p, null);
  }

  function kill(sq, d, cause, out) {
    if (!d.alive) return;
    d.alive = false; d.hidden = false; d.seen = 0; d.heard = null; d.target = null; d.state = 'idle'; d.aware = 0; d.shots = 0; d.aim = 0; d.aimAt = null;
    sq.kills++;
    out.push({ e: 'defender:killed', id: d.id, kind: d.kind, place: d.place, cause, pos: d.pos.slice() });
  }

  function burn(sq, cone, dt) {
    const out = [];
    if (!sq || !cone) return out;
    const E = D.defense, rid = sq.town && sq.town.region;
    for (const d of sq.list) {
      if (!d.alive || d.hidden) continue;
      if (!inCone(cone, d.pos, rid)) continue;
      d.burnT = 0.35;
      if (d.kind === 'peasant') {                       // peasants panic and run, they do not burn (5.4)
        d.aware = D.perception.alert; d.state = 'alert'; d.focus = cone.origin.slice(); d.panic = true;
        continue;
      }
      d.hp -= E.burn * dt;
      if (d.hp <= 0) kill(sq, d, 'fire', out);
    }
    return out;
  }

  /** Where the arrow must go to meet a target moving at vel (two lead iterations, gravity compensated). */
  function aimArrow(from, q, vel, speed, g) {
    let ax = q[0], ay = q[1], az = q[2], tt = 0;
    for (let i = 0; i < 3; i++) {
      tt = Math.hypot(ax - from[0], ay - from[1], az - from[2]) / speed;
      ax = q[0] + vel[0] * tt; ay = q[1] + vel[1] * tt; az = q[2] + vel[2] * tt;
    }
    const dx = ax - from[0], dy = ay - from[1], dz = az - from[2], l = Math.hypot(dx, dy, dz) || 1;
    return { v: [dx / l * speed, dy / l * speed + 0.5 * g * tt, dz / l * speed], t: tt };
  }

  /** Arrows and bolts share the pool (projectiles.max): when it is full, drop the oldest stuck one; false = hold fire. */
  function room(sq) {
    const P = D.projectiles, bolts = sq.bolts || (sq.bolts = []);
    if (sq.arrows.length + bolts.length < P.max) return true;
    let i = sq.arrows.findIndex(a => a.stuck > 0);
    if (i >= 0) { sq.arrows.splice(i, 1); return true; }
    i = bolts.findIndex(a => a.stuck > 0);
    if (i >= 0) { bolts.splice(i, 1); return true; }
    return false;
  }

  /** Squared distance from c to the segment a -> b. */
  function segDist2(a, b, c) {
    const s = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], l2 = s[0] * s[0] + s[1] * s[1] + s[2] * s[2] || 1;
    const k = clamp(((c[0] - a[0]) * s[0] + (c[1] - a[1]) * s[1] + (c[2] - a[2]) * s[2]) / l2, 0, 1);
    const x = a[0] + s[0] * k - c[0], y = a[1] + s[1] * k - c[1], z = a[2] + s[2] * k - c[2];
    return x * x + y * y + z * z;
  }

  /** A projectile reached the ground or a roof: stick there (the renderer keeps its last direction). */
  function landed(sq, a, rid) {
    const ground = T.surfaceAt(rid, a.pos[0], a.pos[2]), roof = sq.town ? SE.solidAt(sq.town, a.pos[0], a.pos[2], 0) : null;
    const floor = roof != null && roof > ground && a.prev[1] >= roof - 0.5 ? roof : ground;
    if (a.pos[1] > floor) return false;
    const l = Math.hypot(a.vel[0], a.vel[1], a.vel[2]) || 1;
    a.dir = [a.vel[0] / l, a.vel[1] / l, a.vel[2] / l];
    a.pos[1] = floor + 0.2; a.stuck = D.projectiles.stick;
    return true;
  }

  function fire(sq, d, p, out) {
    const A = D.defenders.archer, P = D.projectiles, rng = sq.rng || Math.random;
    if (!room(sq)) return;
    const q = [p.pos[0], p.pos[1], p.pos[2]], a = aimArrow(d.pos, q, p.vel || [0, 0, 0], A.speed, P.gravity);
    const n = A.spread * A.speed;
    const v = [a.v[0] + (rng() * 2 - 1) * n, a.v[1] + (rng() * 2 - 1) * n, a.v[2] + (rng() * 2 - 1) * n];
    sq.arrows.push({ pos: d.pos.slice(), prev: d.pos.slice(), vel: v, t: 0, stuck: 0, from: d.id });
    out.push({ e: 'arrow:fired', id: d.id });
  }

  /** Arrows: gravity, hit test against the dragon (segment vs body sphere), stick in the ground or a roof. */
  function stepArrows(sq, cs, dt, scale, out) {
    const P = D.projectiles, p = cs.dragon.pilot, rid = sq.town ? sq.town.region : cs.region;
    const hitR = P.hit * Math.max(1, scale || 1), target = !cs.inLair && p && !(p.inv > 0) ? p.pos : null;
    for (let i = sq.arrows.length - 1; i >= 0; i--) {
      const a = sq.arrows[i];
      if (a.stuck > 0) { if ((a.stuck -= dt) <= 0) sq.arrows.splice(i, 1); continue; }
      a.prev = a.pos.slice();
      a.vel[1] -= P.gravity * dt;
      for (let k = 0; k < 3; k++) a.pos[k] += a.vel[k] * dt;
      a.t += dt;
      if (target && segDist2(a.prev, a.pos, target) <= hitR * hitR) {
        out.push({ e: 'arrow:hit', damage: D.defenders.archer.damage, pos: a.pos.slice(), from: a.from });
        sq.arrows.splice(i, 1);
        continue;
      }
      if (landed(sq, a, rid)) continue;
      if (a.t > P.life) sq.arrows.splice(i, 1);
    }
    // bolts (T16): straight, no gravity; a bigger hit radius; stick like arrows
    const B = D.defenders.ballista, bolts = sq.bolts || (sq.bolts = []), boltR = B.hit * Math.max(1, scale || 1);
    for (let i = bolts.length - 1; i >= 0; i--) {
      const a = bolts[i];
      if (a.stuck > 0) { if ((a.stuck -= dt) <= 0) bolts.splice(i, 1); continue; }
      a.prev = a.pos.slice();
      for (let k = 0; k < 3; k++) a.pos[k] += a.vel[k] * dt;
      a.t += dt;
      if (target && segDist2(a.prev, a.pos, target) <= boltR * boltR) {
        out.push({ e: 'bolt:hit', damage: B.damage, pos: a.pos.slice(), from: a.from });
        bolts.splice(i, 1);
        continue;
      }
      if (landed(sq, a, rid)) continue;
      if (a.t > B.life) bolts.splice(i, 1);
    }
  }

  /** Ballista (T16): aim `aimTime` at the lead point (frozen for the last `lock` s), one straight bolt, `reload` s. */
  function ballista(sq, d, cs, dt, out) {
    const B = D.defenders.ballista, p = cs.dragon.pilot;
    const dist = p ? Math.hypot(p.pos[0] - d.pos[0], p.pos[1] - d.pos[1], p.pos[2] - d.pos[2]) : Infinity;
    const facing = p ? Math.abs(wrap(Math.atan2(p.pos[0] - d.pos[0], p.pos[2] - d.pos[2]) - d.yaw)) < D.defense.aimCone : false;
    const can = d.state === 'alert' && d.seen > 0 && dist <= B.range && facing && !cs.inLair;
    const locked = d.aim > 0 && d.aim >= B.aimTime - B.lock;
    if (!locked) {
      if (!can || d.cool > 0) { d.aim = 0; d.aimAt = null; d.target = null; return; }
      const v = p.vel || [0, 0, 0], rem = Math.max(0, B.aimTime - d.aim);   // where it will be when the bolt leaves ...
      const a = aimArrow(d.pos, [p.pos[0] + v[0] * rem, p.pos[1] + v[1] * rem, p.pos[2] + v[2] * rem], v, B.bolt, 0);   // ... and meets it
      d.aimAt = [d.pos[0] + a.v[0] * a.t, d.pos[1] + a.v[1] * a.t, d.pos[2] + a.v[2] * a.t];   // the lead point
      if (d.aim === 0) out.push({ e: 'bolt:aim', id: d.id, pos: d.pos.slice(), at: d.aimAt.slice() });
    }
    d.target = d.aimAt;
    d.aim += dt;
    if (d.aim < B.aimTime) return;
    d.aim = 0; d.cool = B.reload;
    const at = d.aimAt; d.aimAt = null; d.target = null;
    if (!at || !room(sq)) return;
    const dx = at[0] - d.pos[0], dy = at[1] - d.pos[1], dz = at[2] - d.pos[2], l = Math.hypot(dx, dy, dz) || 1;
    sq.bolts.push({ pos: d.pos.slice(), prev: d.pos.slice(), vel: [dx / l * B.bolt, dy / l * B.bolt, dz / l * B.bolt], t: 0, stuck: 0, from: d.id });
    out.push({ e: 'bolt:fire', id: d.id, pos: d.pos.slice() });
  }

  /** Move a peasant on the ground toward (x, z); true when within `near` of it. Slides around building solids. */
  function walkTo(sq, d, x, z, speed, dt, near) {
    const dx = x - d.pos[0], dz = z - d.pos[2], l = Math.hypot(dx, dz);
    if (l <= near) { d.walk = 0; return true; }
    const s = Math.min(l, speed * dt);
    let nx = d.pos[0] + dx / l * s, nz = d.pos[2] + dz / l * s;
    const h = sq.town ? SE.hit(sq.town, nx, nz, D.defense.pad) : null;
    if (h && h.b.id !== d.goalB) {                      // push out of the wall and slide along it
      const sg = Math.sign(dx * -h.nz + dz * h.nx) || 1;
      nx += h.nx * h.depth - h.nz * s * 0.5 * sg; nz += h.nz * h.depth + h.nx * s * 0.5 * sg;
    }
    d.pos[0] = nx; d.pos[2] = nz;
    d.pos[1] = T.surfaceAt(sq.town ? sq.town.region : 'wild', nx, nz) + D.defense.eye;
    d.yaw = Math.atan2(dx, dz);
    d.walk = speed;
    return false;
  }

  function peasant(sq, d, cs, dt, out) {
    const E = D.defense, V = D.defenders.peasant, town = sq.town, p = cs.dragon.pilot, rng = sq.rng || Math.random;
    d.walk = 0;
    if (d.hidden) {
      const b = byId(town, d.shelter);
      if (!b || b.ruin) { d.hidden = false; d.shelter = null; d.goalB = null; }   // the shelter burned: out and run again
      else {
        if ((d.hideT -= dt) <= 0) { d.hidden = false; d.shelter = null; d.goalB = null; d.panic = false; d.rang = false; d.aware = 0; d.state = 'idle'; d.search = 0; }
        return;
      }
    }
    if (d.state === 'idle' && !d.panic) {               // wander around home
      d.wanderT -= dt;
      if (!d.wTo || d.wanderT <= 0) {
        const a = rng() * TAU, r = rng() * E.wander;
        d.wTo = [d.home[0] + Math.sin(a) * r, d.home[2] + Math.cos(a) * r]; d.wanderT = 3 + rng() * 4;
      }
      walkTo(sq, d, d.wTo[0], d.wTo[1], V.speed * E.stroll, dt, 0.5);
      return;
    }
    if (d.state === 'suspicious' && !d.panic) {         // stop and stare
      if (d.focus) d.yaw = Math.atan2(d.focus[0] - d.pos[0], d.focus[2] - d.pos[2]);
      return;
    }
    // alert / search / panic: ring the bell (one peasant per settlement), then hide
    const bell = town.buildings.find(b => b.place === d.place && D.buildings[b.type].bell && !b.ruin);
    const rung = (sq.rung[d.place] || 0) > 0, ringer = sq.list.find(o => o.ringer && o.place === d.place && o.alive && o !== d);
    if (V.ringsBell && bell && !rung && !d.rang && (!ringer || d.ringer)) {
      d.ringer = true; d.goalB = bell.id;
      if (d.ring > 0 || walkTo(sq, d, bell.pos[0], bell.pos[2], V.speed, dt, bell.r + 1.6)) {
        d.ring += dt;
        if (d.ring >= E.ringTime * (sq.resp && sq.resp.bellFast ? D.alert.bellFast : 1)) {   // T17: alert 1+ rings faster
          d.ring = 0; d.rang = true; d.ringer = false; d.goalB = null;
          sq.rung[d.place] = E.ringCool;
          out.push({ e: 'bell:ring', place: d.place, pos: bell.pos.slice(), id: d.id });
          for (const o of sq.list) if (o.alive && o.place === d.place) {
            o.aware = D.perception.alert; if (o.state !== 'alert') { out.push({ e: 'aware:state', id: o.id, kind: o.kind, state: 'alert', from: o.state }); o.state = 'alert'; }
            o.search = 0; if (p && !cs.inLair) o.focus = p.pos.slice();
          }
        }
      }
      return;
    }
    d.ringer = false;
    // shelter: the standing building of the settlement furthest from the dragon
    let sh = byId(town, d.shelter);
    if (!sh || sh.ruin) {
      const from = d.focus || (p ? p.pos : d.pos);
      let best = null, bd = -1;
      for (const b of town.buildings) {
        if (b.place !== d.place || b.ruin || !SHELTER[b.type]) continue;
        const k = Math.hypot(b.pos[0] - from[0], b.pos[2] - from[2]) - 0.5 * Math.hypot(b.pos[0] - d.pos[0], b.pos[2] - d.pos[2]);
        if (k > bd) { bd = k; best = b; }
      }
      sh = best; d.shelter = best ? best.id : null;
    }
    if (!sh) {                                          // nowhere to hide: run away from the dragon
      const from = d.focus || d.pos, a = Math.atan2(d.pos[0] - from[0], d.pos[2] - from[2]);
      walkTo(sq, d, d.pos[0] + Math.sin(a) * 10, d.pos[2] + Math.cos(a) * 10, V.speed, dt, 0.1);
      return;
    }
    d.goalB = sh.id;
    if (walkTo(sq, d, sh.pos[0], sh.pos[2], V.speed, dt, sh.r + 1.2)) { d.hidden = true; d.hideT = D.perception.searchTime; d.seen = 0; }
  }

  function archer(sq, d, cs, dt, out) {
    const A = D.defenders[d.kind], p = cs.dragon.pilot;
    d.cool = Math.max(0, d.cool - dt);
    if (d.kind === 'ballista') { ballista(sq, d, cs, dt, out); return; }
    const dist = p ? Math.hypot(p.pos[0] - d.pos[0], p.pos[1] - d.pos[1], p.pos[2] - d.pos[2]) : Infinity;
    const facing = p ? Math.abs(wrap(Math.atan2(p.pos[0] - d.pos[0], p.pos[2] - d.pos[2]) - d.yaw)) < D.defense.aimCone : false;
    const can = d.state === 'alert' && d.seen > 0 && dist <= A.range && facing && !cs.inLair;
    d.target = can ? p.pos.slice() : null;
    if (!can) { d.aim = 0; d.shots = 0; return; }
    if (d.shots > 0) {
      d.gap -= dt;
      if (d.gap <= 0) { fire(sq, d, p, out); d.shots--; d.gap = A.gap; }
      return;
    }
    if (d.cool > 0) return;
    d.aim += dt;
    if (d.aim >= A.aimTime) { d.aim = 0; d.shots = A.volley; d.gap = 0; d.cool = A.cooldown; }
  }

  function step(cs, ev, dt, o) {
    const out = [], town = cs.town, W = D.perception.watch, P = D.perception, AL = M.need('alert');
    const rs = cs.regionStates && cs.regionStates[cs.region], lv = AL.level(rs);
    if (cs.squad && cs.squad.town === town && cs.squad.level == null && lv === 0) cs.squad.level = 0;   // spawned outside step at level 0
    if (!cs.squad || cs.squad.town !== town || cs.squad.level !== lv) {   // T17: the alert level changes the squad
      const old = cs.squad;
      cs.squad = spawn(town, cs.rng, { resp: AL.responses(lv), old });
      cs.squad.level = lv;
      if (old && old.town && town && old.town.region === town.region && old.level != null && lv > old.level) out.push({ e: 'defenders:reinforced', level: lv, from: old.level });
    }
    const sq = cs.squad, p = cs.dragon.pilot;
    cs.watch = sq;                                      // T14's debug view and 'to post' read cs.watch.list
    sq.t += dt;
    for (const k in sq.rung) sq.rung[k] = Math.max(0, sq.rung[k] - dt);
    const scale = (o && o.scale) || 1, inside = cs.inLair || !p;
    if (!inside) for (const e of burn(sq, cs.breath, dt)) out.push(e);
    const noises = inside ? [] : PC.noisesOf(p, ev, scale);
    const ctx = { regionId: cs.region, spot: (o && o.spot) || 1, light: cs.light == null ? 'day' : cs.light, scale, town };
    for (const d of sq.list) {
      d.burnT = Math.max(0, d.burnT - dt);
      const b = d.post ? byId(town, d.building) : null;
      if (d.post && b) {
        if (b.ruin) { if (d.alive) kill(sq, d, 'fall', out); d.down = true; continue; }
        if (!d.alive && d.down) {                       // the tower stands again: new archers on it
          Object.assign(d, { alive: true, down: false, hp: D.defenders[d.kind].hp, aware: 0, state: 'idle', focus: null, search: 0 });
          out.push({ e: 'defender:back', id: d.id, kind: d.kind, place: d.place });
        }
      }
      if (!d.alive) continue;
      if (d.hidden) { d.seen = 0; d.heard = null; peasant(sq, d, cs, dt, out); continue; }
      // look: posts sweep or turn toward what they noticed; peasants turn while standing
      if (d.post) {
        const want = d.focus && d.state !== 'idle' ? Math.atan2(d.focus[0] - d.pos[0], d.focus[2] - d.pos[2])
          : d.base + W.sweep * Math.sin(sq.t * W.sweepRate + d.phase);
        const dy = wrap(want - d.yaw), mx = (d.kind === 'ballista' ? D.defenders.ballista.turn : W.turn) * dt;
        d.yaw = wrap(d.yaw + clamp(dy, -mx, mx));
      }
      d.seen = inside ? 0 : PC.seen(d, { pos: p.pos }, ctx);
      d.heard = PC.heard(d, noises);
      if (d.seen > 0) d.focus = p.pos.slice();
      else if (d.heard) d.focus = d.heard.pos.slice();
      const was = d.state;
      let now = PC.stepAwareness(d, d.seen, d.heard, dt);
      if (now === 'alert') d.search = 0;
      else if (was === 'alert' || (was === 'search' && d.search > 0)) {
        if (was === 'alert') d.search = P.searchTime;
        d.search -= dt;
        if (d.search > 0) now = 'search';
      }
      if (d.panic && now === 'idle') now = 'search';
      d.state = now;
      if (now === 'idle') d.focus = null;
      if (now !== was) out.push({ e: 'aware:state', id: d.id, kind: d.kind, state: now, from: was });
      if (d.patrol) patrolStep(sq, d, dt);
      if (d.kind === 'peasant') peasant(sq, d, cs, dt, out); else archer(sq, d, cs, dt, out);
    }
    stepArrows(sq, cs, dt, scale, out);
    cs.danger = zones(sq);
    return out;
  }

  /** One zone per settlement with live archers or ballistae: its centre, radius = the furthest shooter's reach. */
  function zones(sq) {
    const by = {}, out = [], town = sq && sq.town;
    for (const d of (sq && sq.list) || []) {
      if (!d.alive || (d.kind !== 'archer' && d.kind !== 'ballista')) continue;
      if (d.patrol) { out.push({ x: d.pos[0], z: d.pos[2], r: D.defenders.archer.range }); continue; }   // T17: a zone per patrol archer
      const pl = town && town.places.find(p => p.id === d.place), cx = pl ? pl.x : d.pos[0], cz = pl ? pl.z : d.pos[2];
      const r = Math.hypot(d.pos[0] - cx, d.pos[2] - cz) + D.defenders[d.kind].range;
      if (!by[d.place] || by[d.place].r < r) by[d.place] = { x: cx, z: cz, r };
    }
    for (const k in by) out.push(by[k]);
    return out;
  }

  function calm(sq) {
    for (const d of (sq && sq.list) || []) {
      const b = d.post && sq.town ? byId(sq.town, d.building) : null;
      Object.assign(d, { aware: 0, state: 'idle', focus: null, search: 0, panic: false, hidden: false, rang: false, ringer: false, shots: 0, aim: 0, cool: 0, aimAt: null, target: null });
      if (!(b && b.ruin)) { d.alive = true; d.down = false; d.hp = D.defenders[d.kind].hp; }
    }
    if (sq) { sq.arrows.length = 0; sq.bolts = []; sq.rung = {}; }
    return sq;
  }

  M.define('defenders', { spawn, routeOf, along, step, burn, zones, calm, aimArrow, inCone, segDist2 });
})(typeof self !== 'undefined' ? self : this);
