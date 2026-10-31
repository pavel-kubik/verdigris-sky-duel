/*
 * Verdigris campaign - defenders: peasants and archers (Phase 2 T15, 002_task_kingdom.md 4.3 and 5.4).
 *   spawn(town, rng) -> squad      squad = { town, list: [def], arrows: [], t, rung: { place: s }, kills }
 *       archers: the template's `archers` of each settlement, spread over its towers (round robin), on the tower top;
 *       the archers of a ruined tower are not there (they come back when it is rebuilt);
 *       peasants: the template's `peasants`, each with a home building (houses first) to wander around;
 *       ballista platforms: a watcher on each (kind 'ballista', aims and fires with T16).
 *       def = { id, kind, place, building, post, home, pos (eye), base, yaw, sight, fov, hp, alive, aware, state,
 *               focus, seen, heard, search, phase, aim, cool, shots, gap, target, hidden, hideT, ring, burnT }
 *   step(cs, ev, dt, { scale, spot, inside }) -> events[]   perception (core/perception.js) for every live defender,
 *       states idle -> suspicious -> alert -> search (last seen spot, perception.searchTime) -> idle; archers volley
 *       at a dragon they see within `range` and turn to it; peasants run to the bell of their settlement (one rings it),
 *       then hide in the building furthest from the dragon until searchTime has passed; arrows fly (pooled, max
 *       projectiles.max, gravity) and hit the dragon (damage x upgrades later), stick in the ground or roofs.
 *       Events: 'aware:state' { id, kind, state, from }, 'arrow:fired', 'arrow:hit' { damage, pos }, 'bell:ring'
 *       { place, pos }, 'defender:killed' { id, kind, place, cause: 'fire' | 'fall' }, 'defender:back' (rebuilt tower).
 *   burn(squad, cone, dt) -> events[]   the breath cone: archers in it burn (defenders.burn hp/s, 'defender:killed'),
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

  function spawn(town, rng) {
    rng = rng || Math.random;
    const list = [], E = D.defense;
    if (!town) return { town, list, arrows: [], t: 0, rung: {}, kills: 0 };
    for (const pl of town.places) {
      const tpl = D.settlements[pl.type] || {}, own = town.buildings.filter(b => b.place === pl.id);
      const towers = own.filter(b => D.buildings[b.type].post === 'archer');
      const nA = tpl.archers || 0;
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
    return { town, list, arrows: [], t: 0, rung: {}, kills: 0, rng };
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
    d.alive = false; d.hidden = false; d.seen = 0; d.heard = null; d.target = null; d.state = 'idle'; d.aware = 0; d.shots = 0; d.aim = 0;
    sq.kills++;
    out.push({ e: 'defender:killed', id: d.id, kind: d.kind, place: d.place, cause, pos: d.pos.slice() });
  }

  function burn(sq, cone, dt) {
    const out = [];
    if (!sq || !cone) return out;
    const E = D.defense, rid = sq.town && sq.town.region;
    for (const d of sq.list) {
      if (!d.alive || d.hidden || d.kind === 'ballista') continue;
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

  function fire(sq, d, p, out) {
    const A = D.defenders.archer, P = D.projectiles, rng = sq.rng || Math.random;
    if (sq.arrows.length >= P.max) {                   // the pool is full: drop the oldest stuck arrow, else hold fire
      const i = sq.arrows.findIndex(a => a.stuck > 0);
      if (i < 0) return;
      sq.arrows.splice(i, 1);
    }
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
      if (target) {
        const s = [a.pos[0] - a.prev[0], a.pos[1] - a.prev[1], a.pos[2] - a.prev[2]], l2 = s[0] * s[0] + s[1] * s[1] + s[2] * s[2] || 1;
        let k = ((target[0] - a.prev[0]) * s[0] + (target[1] - a.prev[1]) * s[1] + (target[2] - a.prev[2]) * s[2]) / l2;
        k = clamp(k, 0, 1);
        const cx = a.prev[0] + s[0] * k - target[0], cy = a.prev[1] + s[1] * k - target[1], cz = a.prev[2] + s[2] * k - target[2];
        if (cx * cx + cy * cy + cz * cz <= hitR * hitR) {
          out.push({ e: 'arrow:hit', damage: D.defenders.archer.damage, pos: a.pos.slice(), from: a.from });
          sq.arrows.splice(i, 1);
          continue;
        }
      }
      const ground = T.surfaceAt(rid, a.pos[0], a.pos[2]), roof = sq.town ? SE.solidAt(sq.town, a.pos[0], a.pos[2], 0) : null;
      const floor = roof != null && roof > ground && a.prev[1] >= roof - 0.5 ? roof : ground;
      if (a.pos[1] <= floor) { a.pos[1] = floor + 0.2; a.stuck = P.stick; continue; }
      if (a.t > P.life) sq.arrows.splice(i, 1);
    }
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
        if (d.ring >= E.ringTime) {
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
    if (d.kind !== 'archer') return;                    // the ballista watches only until T16
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
    const out = [], town = cs.town, W = D.perception.watch, P = D.perception;
    if (!cs.squad || cs.squad.town !== town) cs.squad = spawn(town, cs.rng);
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
        const dy = wrap(want - d.yaw), mx = W.turn * dt;
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
      if (d.kind === 'peasant') peasant(sq, d, cs, dt, out); else archer(sq, d, cs, dt, out);
    }
    stepArrows(sq, cs, dt, scale, out);
    cs.danger = zones(sq);
    return out;
  }

  /** One zone per settlement with live archers: its centre, radius = the furthest archer's reach (T16 adds the ballista). */
  function zones(sq) {
    const by = {}, out = [], town = sq && sq.town;
    for (const d of (sq && sq.list) || []) {
      if (!d.alive || d.kind !== 'archer') continue;
      const pl = town && town.places.find(p => p.id === d.place), cx = pl ? pl.x : d.pos[0], cz = pl ? pl.z : d.pos[2];
      const r = Math.hypot(d.pos[0] - cx, d.pos[2] - cz) + D.defenders.archer.range;
      if (!by[d.place] || by[d.place].r < r) by[d.place] = { x: cx, z: cz, r };
    }
    for (const k in by) out.push(by[k]);
    return out;
  }

  function calm(sq) {
    for (const d of (sq && sq.list) || []) {
      const b = d.post && sq.town ? byId(sq.town, d.building) : null;
      Object.assign(d, { aware: 0, state: 'idle', focus: null, search: 0, panic: false, hidden: false, rang: false, ringer: false, shots: 0, aim: 0, cool: 0 });
      if (!(b && b.ruin)) { d.alive = true; d.down = false; d.hp = D.defenders[d.kind].hp; }
    }
    if (sq) { sq.arrows.length = 0; sq.rung = {}; }
    return sq;
  }

  M.define('defenders', { spawn, step, burn, zones, calm, aimArrow, inCone });
})(typeof self !== 'undefined' ? self : this);
