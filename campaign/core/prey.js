/*
 * Verdigris campaign - prey: herds, grazing, fleeing and boars that fight back.
 * Pure simulation; the renderer reads prey positions and states. See 001_task_survival.md 5.5.
 *
 * A region's prey live in a "field": { regionId, herds, list, nextId }.
 *   spawnRegion(regionId, rng, avoid?) -> field
 *   step(field, dragon, dt, ctx) -> events[]   dragon: { pos, inv }, ctx: { stats, rng }
 *   remove(field, preyId)                        (eaten, stored; used by T09)
 *   reach / swoopTarget / tryGrab / release / byId  grab and carry (T09)
 *   breathCone / cook                               fire: prey cook into roast chunks (T10)
 */
(function (root) {
  'use strict';
  const M = typeof module === 'object' && module.exports ? require('./umd.js') : root.VCamp;
  const D = M.need('data'), T = M.need('terrain');
  const { wrap, range, int, dist2 } = M.need('math');

  const HERD_R = 22;            // grazing spread around the herd centre
  const ALARM_ALT = 60;         // a dragon higher than this above the ground is not a threat
  const CALM_TIME = 4;          // seconds out of range before a fleeing animal grazes again
  const SPREAD_PANIC = 35;      // herd mates this close panic together
  const CHARGE_ALT = 25;        // boars charge a dragon flying lower than this
  const EDGE = 90;              // prey keep this far inside the region radius

  /** Valid ground for an animal: dry, not too steep, inside the region, off the volcano and away from the lair. */
  function groundOk(regionId, x, z) {
    const R = T.region(regionId);
    if (Math.hypot(x, z) > R.radius - EDGE) return false;
    if (T.surfaceAt(regionId, x, z) < 2.2) return false;
    if (T.slopeAt(regionId, x, z, 3) > 0.6) return false;
    for (const f of R.terrain.features) if (f.type === 'cone' && Math.hypot(x - f.x, z - f.z) < f.r * 0.95) return false;
    if (R.lair && Math.hypot(x - R.lair.x, z - R.lair.z) < 80) return false;
    return true;
  }

  function findCentre(regionId, rng, ring, avoid, minDist) {
    for (let k = 0; k < 400; k++) {
      const a = rng() * Math.PI * 2, r = range(rng, ring[0], ring[1]);
      const x = Math.cos(a) * r, z = Math.sin(a) * r;
      if (!groundOk(regionId, x, z)) continue;
      if (avoid && Math.hypot(x - avoid[0], z - avoid[2]) < minDist) continue;
      return [x, z];
    }
    return null;
  }

  function makePrey(field, herd, type, x, z, rng) {
    const def = D.prey[type];
    return {
      id: field.nextId++, type, herd: herd.id, pos: [x, T.surfaceAt(field.regionId, x, z), z],
      yaw: rng() * Math.PI * 2, state: 'graze', hp: def.hp, cook: 0, food: def.food, size: def.size,
      cd: 0, t: rng() * 10, speed: 0, goal: null, pause: range(rng, 0, 3), calm: 0, scatter: range(rng, -0.7, 0.7), acc: 0,
    };
  }

  function fillHerd(field, herd, rng, avoid) {
    const def = D.prey[herd.type];
    const n = int(rng, def.herd[0], def.herd[1]);
    for (let i = 0; i < n && field.list.length < D.preyAi.maxActive; i++) {
      for (let k = 0; k < 30; k++) {
        const a = rng() * Math.PI * 2, r = rng() * HERD_R * 0.6;
        const x = herd.centre[0] + Math.cos(a) * r, z = herd.centre[1] + Math.sin(a) * r;
        if (!groundOk(field.regionId, x, z)) continue;
        if (avoid && Math.hypot(x - avoid[0], z - avoid[2]) < D.respawn.minDistFromDragon * 0.5) continue;
        field.list.push(makePrey(field, herd, herd.type, x, z, rng));
        break;
      }
    }
    herd.emptyT = 0;
  }

  function spawnRegion(regionId, rng, avoid) {
    const R = T.region(regionId);
    const field = { regionId, herds: [], list: [], nextId: 1, t: 0 };
    let hid = 1;
    for (const h of R.herds) {
      for (let c = 0; c < h.count; c++) {
        const centre = findCentre(regionId, rng, h.ring, avoid, D.respawn.minDistFromDragon);
        if (!centre) continue;
        const herd = { id: hid++, type: h.type, ring: h.ring, centre, emptyT: 0, alarmed: false };
        field.herds.push(herd);
        fillHerd(field, herd, rng, avoid);
      }
    }
    return field;
  }

  /** Moves an animal along its heading, sliding around water, cliffs and the edge. Returns false if boxed in. */
  function moveOn(regionId, p, heading, speed, dt) {
    const step = speed * dt;
    for (const off of [0, 0.5, -0.5, 1.0, -1.0, 1.6, -1.6]) {
      const h = heading + off, x = p.pos[0] + Math.sin(h) * step, z = p.pos[2] + Math.cos(h) * step;
      if (!groundOk(regionId, x, z)) continue;
      p.pos[0] = x; p.pos[2] = z; p.pos[1] = T.surfaceAt(regionId, x, z);
      const d = wrap(h - p.yaw); p.yaw = wrap(p.yaw + d * Math.min(1, dt * 8));
      p.speed = speed;
      return true;
    }
    p.speed = 0;
    return false;
  }

  function threat(field, p, dragon, stats) {
    const def = D.prey[p.type];
    const alt = dragon.pos[1] - T.surfaceAt(field.regionId, dragon.pos[0], dragon.pos[2]);
    const d = dist2(p.pos, dragon.pos);
    return { d, alt, range: def.fleeRange * stats.spot, low: alt < ALARM_ALT };
  }

  function stepOne(field, p, dragon, dt, ctx, ev) {
    const def = D.prey[p.type], rng = ctx.rng, herd = field.herds.find(h => h.id === p.herd);
    p.t += dt; p.cd = Math.max(0, p.cd - dt);
    if (p.held > 0) { p.held -= dt; p.speed = 0; if (p.state === 'charge') p.state = 'flee'; return; }   // the mother holds it still (T05)
    const th = threat(field, p, dragon, ctx.stats);
    const inRange = th.low && th.d < th.range;
    const away = Math.atan2(p.pos[0] - dragon.pos[0], p.pos[2] - dragon.pos[2]);

    if (p.state === 'graze') {
      if (inRange) {
        p.state = def.fights && th.alt < CHARGE_ALT ? 'charge' : 'flee'; p.calm = 0;
        if (herd && !herd.alarmed) { herd.alarmed = true; ev.push({ e: 'prey:flee', herd: herd.id, type: p.type }); }
        // panic spreads through the herd
        for (const q of field.list) if (q !== p && q.herd === p.herd && q.state === 'graze' && dist2(q.pos, p.pos) < SPREAD_PANIC) { q.state = def.fights && th.alt < CHARGE_ALT ? 'charge' : 'flee'; q.calm = 0; }
        return;
      }
      if (p.pause > 0) { p.pause -= dt; p.speed = 0; return; }
      if (!p.goal || dist2([p.goal[0], 0, p.goal[1]], p.pos) < 1.5) {
        const c = herd ? herd.centre : [p.pos[0], p.pos[2]];
        const a = rng() * Math.PI * 2, r = rng() * HERD_R;
        p.goal = [c[0] + Math.cos(a) * r, c[1] + Math.sin(a) * r];
        p.pause = range(rng, 1, 4);
        return;
      }
      const h = Math.atan2(p.goal[0] - p.pos[0], p.goal[1] - p.pos[2]);
      if (!moveOn(field.regionId, p, h, def.speed * 0.25, dt)) p.goal = null;
      return;
    }

    if (p.state === 'flee') {
      if (def.fights && inRange && th.alt < CHARGE_ALT) { p.state = 'charge'; return; }
      if ((!inRange && th.d > th.range * 1.6) || !th.low) p.calm += dt; else p.calm = 0;
      if (p.calm > CALM_TIME) { settle(field, p, herd, rng); return; }
      if (!moveOn(field.regionId, p, away + p.scatter, def.flee, dt)) p.scatter = -p.scatter;
      return;
    }

    if (p.state === 'charge') {
      if (th.alt > CHARGE_ALT + 5) { p.state = 'flee'; p.calm = 0; return; }
      if (th.d > th.range * 1.6) { p.calm += dt; if (p.calm > CALM_TIME) { settle(field, p, herd, rng); return; } } else p.calm = 0;
      const ch = def.charge;
      const above = dragon.pos[1] - p.pos[1];                  // the dragon's height over the boar
      if (th.d < ch.range && above < ch.maxAboveGround && p.cd === 0) {
        p.cd = ch.cooldown;
        if (!(dragon.inv > 0)) ev.push({ e: 'boar:hit', id: p.id, damage: ch.damage });
        else ev.push({ e: 'boar:miss', id: p.id });
      }
      const toward = Math.atan2(dragon.pos[0] - p.pos[0], dragon.pos[2] - p.pos[2]);
      // after a hit, peel away briefly before turning for another run
      moveOn(field.regionId, p, p.cd > ch.cooldown * 0.6 ? away : toward, def.flee * 1.1, dt);
    }
  }

  function settle(field, p, herd, rng) {
    p.state = 'graze'; p.calm = 0; p.goal = null; p.pause = range(rng, 1, 3);
    if (herd) {
      const mates = field.list.filter(q => q.herd === herd.id);
      if (mates.every(q => q.state === 'graze')) {
        herd.alarmed = false;
        // the herd regroups where its members ended up
        herd.centre = [mates.reduce((a, q) => a + q.pos[0], 0) / mates.length, mates.reduce((a, q) => a + q.pos[2], 0) / mates.length];
      }
    }
  }

  const ACTIVE = { graze: 1, flee: 1, charge: 1 };

  function step(field, dragon, dt, ctx) {
    const ev = [], far = D.preyAi.fullRange, farDt = 1 / D.preyAi.farTickHz;
    field.t += dt;
    for (let i = field.list.length - 1; i >= 0; i--) {             // uneaten roast goes cold and is gone
      const p = field.list[i];
      if (p.state === 'roast' && (p.t += dt) > D.roast.life) { field.list.splice(i, 1); ev.push({ e: 'roast:gone', id: p.id }); }
    }
    for (const p of field.list) {
      if (!ACTIVE[p.state]) continue;
      if (dist2(p.pos, dragon.pos) > far) {            // far animals tick at a low rate
        p.acc += dt;
        if (p.acc < farDt) continue;
        stepOne(field, p, dragon, p.acc, ctx, ev); p.acc = 0;
      } else {
        if (p.acc) { stepOne(field, p, dragon, p.acc, ctx, ev); p.acc = 0; }
        stepOne(field, p, dragon, dt, ctx, ev);
      }
    }
    // empty herds come back after a while, away from the dragon
    for (const h of field.herds) {
      if (field.list.some(p => p.herd === h.id)) continue;
      h.emptyT += dt;
      if (h.emptyT < D.respawn.herdCooldown) continue;
      const c = findCentre(field.regionId, ctx.rng, h.ring, dragon.pos, D.respawn.minDistFromDragon);
      if (!c) continue;
      h.centre = c; h.alarmed = false;
      fillHerd(field, h, ctx.rng, dragon.pos);
      ev.push({ e: 'herd:respawn', herd: h.id, type: h.type });
    }
    return ev;
  }

  /* ---------- grab and carry (T09) ---------- */
  const GRABBABLE = { graze: 1, flee: 1, charge: 1, roast: 1 };

  /**
   * What the dragon's claws can reach right now.
   * dragon: { pos, pitch }, scale: the dragon's visual scale (bigger dragons reach further and lower).
   * Returns { best, heavy, near }: closest liftable prey in reach, closest prey in reach that is too heavy,
   * and whether liftable / too-heavy prey is close below (near / nearHeavy) for the prompt.
   */
  function reach(field, dragon, stats, effects, scale) {
    const G = D.grab, s = Math.max(1, scale || 1);
    const radius = G.radius * s, maxUp = G.maxAboveGround + G.clawDrop * s;
    const limit = Math.min(stats.carry, effects && effects.carryMax != null ? effects.carryMax : Infinity);
    const pitchOk = dragon.pitch == null || dragon.pitch <= G.maxPitch;
    let best = null, bd = Infinity, heavy = null, hd = Infinity, near = false, nearHeavy = false;
    for (const p of field.list) {
      if (!GRABBABLE[p.state]) continue;
      const d = dist2(p.pos, dragon.pos), up = dragon.pos[1] - p.pos[1];
      if (d < radius * G.nearFactor && up < 40) { if (p.size <= limit) near = true; else nearHeavy = true; }
      if (d > radius || up > maxUp || up < -2 || !pitchOk) continue;
      if (p.size <= limit) { if (d < bd) { bd = d; best = p; } }
      else if (d < hd) { hd = d; heavy = p; }
    }
    return { best, heavy, near, nearHeavy };
  }

  /**
   * Swoop target: the liftable prey the dragon is heading for - ahead within swoop.cone (radians off the
   * heading), within swoop.range x scale horizontally and below the dragon. Returns the best by angle and distance.
   */
  function swoopTarget(field, dragon, stats, effects, scale) {
    const S = D.swoop, s = Math.max(1, scale || 1);
    const limit = Math.min(stats.carry, effects && effects.carryMax != null ? effects.carryMax : Infinity);
    let best = null, score = Infinity;
    for (const p of field.list) {
      if (!GRABBABLE[p.state] || p.size > limit) continue;
      const dx = p.pos[0] - dragon.pos[0], dz = p.pos[2] - dragon.pos[2], d = Math.hypot(dx, dz);
      const up = dragon.pos[1] - p.pos[1];
      if (d > S.range * s || up < -3 || up > S.below) continue;
      const off = Math.abs(wrap(Math.atan2(dx, dz) - dragon.yaw));
      if (d > D.grab.radius * s && off > S.cone) continue;          // must be ahead unless already right below
      const sc = d * (1 + off * 1.5);
      if (sc < score) { score = sc; best = p; }
    }
    return best;
  }

  /** Lifts the best prey in reach. Returns { prey } on success, { heavy } if only too-heavy prey was in reach, else {}. */
  function tryGrab(field, dragon, stats, effects, scale) {
    const r = reach(field, dragon, stats, effects, scale);
    if (!r.best) return r.heavy ? { heavy: r.heavy } : {};
    const p = r.best;
    p.state = 'carried'; p.speed = 0; p.goal = null; p.calm = 0;
    // the rest of the herd bolts
    for (const q of field.list) if (q !== p && q.herd === p.herd && (q.state === 'graze')) { q.state = 'flee'; q.calm = 0; }
    return { prey: p };
  }

  /** Lets a carried prey go (dropped alive): it lands below the dragon and runs. */
  function release(field, p, pos) {
    let x = pos[0], z = pos[2];
    if (!groundOk(field.regionId, x, z)) { const h = field.herds.find(hh => hh.id === p.herd); if (h) { x = h.centre[0]; z = h.centre[1]; } }
    p.pos = [x, T.surfaceAt(field.regionId, x, z), z];
    p.state = 'flee'; p.calm = 0;
  }

  /* ---------- fire (T10) ---------- */
  /**
   * The prey the breath is aimed at (T05 feedback): inside the assist angle and within range x preview of the mouth.
   * The previous target is kept while it stays a candidate (no flicker between herd mates); otherwise a prey that is
   * already heating up wins, then the nearest. Returns { id, inRange, cook (0..1) } or null.
   */
  function fireTarget(field, pilot, scale, prevId) {
    const B = D.breath, s = Math.max(1, scale || 1), c = Math.cos(pilot.pitch);
    const dir = [Math.sin(pilot.yaw) * c, Math.sin(pilot.pitch), Math.cos(pilot.yaw) * c];
    const o = [pilot.pos[0] + dir[0] * B.mouth * s, pilot.pos[1] + dir[1] * B.mouth * s, pilot.pos[2] + dir[2] * B.mouth * s];
    const range = B.range * s, ca = Math.cos(B.assist);
    let best = null, bs = Infinity, keep = null;
    for (const p of field.list) {
      if (!ACTIVE[p.state]) continue;
      const v = [p.pos[0] - o[0], p.pos[1] + 0.8 - o[1], p.pos[2] - o[2]], d = Math.hypot(v[0], v[1], v[2]);
      if (d > range * B.preview || d < 1e-6) continue;
      if ((v[0] * dir[0] + v[1] * dir[1] + v[2] * dir[2]) / d < ca) continue;
      const hit = { p, d };
      if (p.id === prevId) keep = hit;
      const score = d - (p.cook > 0 ? range : 0);
      if (score < bs) { bs = score; best = hit; }
    }
    const h = keep || best;
    return h ? { id: h.p.id, inRange: h.d <= range, cook: Math.min(1, (h.p.cook || 0) / D.roast.cookTime) } : null;
  }

  /** The breath cone of a pilot: origin at the mouth, along the heading, scaled with the dragon.
   *  With a field the stream bends toward a prey inside the assist angle and range: preferId (the fire target) first. */
  function breathCone(pilot, scale, field, preferId) {
    const B = D.breath, s = Math.max(1, scale || 1), c = Math.cos(pilot.pitch);
    let dir = [Math.sin(pilot.yaw) * c, Math.sin(pilot.pitch), Math.cos(pilot.yaw) * c];
    const o = [pilot.pos[0] + dir[0] * B.mouth * s, pilot.pos[1] + dir[1] * B.mouth * s, pilot.pos[2] + dir[2] * B.mouth * s];
    const cone = { origin: o, dir, range: B.range * s, cone: B.cone, target: null };
    if (field) {
      // aim assist: bend the stream toward the closest live prey within the assist cone (as the duel's breath aim)
      let best = null, bd = Infinity;
      const ca = Math.cos(B.assist);
      for (const p of field.list) {
        if (!ACTIVE[p.state]) continue;
        const v = [p.pos[0] - o[0], p.pos[1] + 0.8 - o[1], p.pos[2] - o[2]], d = Math.hypot(v[0], v[1], v[2]);
        if (d > cone.range || d < 1e-6) continue;
        if ((v[0] * dir[0] + v[1] * dir[1] + v[2] * dir[2]) / d < ca) continue;
        if (d < bd) { bd = d; best = { p, v, d }; }
      }
      if (preferId != null) {
        const q = byId(field, preferId);
        if (q && ACTIVE[q.state]) {
          const v = [q.pos[0] - o[0], q.pos[1] + 0.8 - o[1], q.pos[2] - o[2]], d = Math.hypot(v[0], v[1], v[2]);
          if (d <= cone.range && d > 1e-6 && (v[0] * dir[0] + v[1] * dir[1] + v[2] * dir[2]) / d >= ca) best = { p: q, v, d };
        }
      }
      if (best) { dir = [best.v[0] / best.d, best.v[1] / best.d, best.v[2] / best.d]; cone.dir = dir; cone.target = best.p.id; }
    }
    return cone;
  }

  function inCone(cone, p) {
    const v = [p.pos[0] - cone.origin[0], p.pos[1] + 0.8 - cone.origin[1], p.pos[2] - cone.origin[2]];
    const d = Math.hypot(v[0], v[1], v[2]);
    if (d > cone.range || d < 1e-6) return d < 2;                    // touching the mouth counts
    const cosA = (v[0] * cone.dir[0] + v[1] * cone.dir[1] + v[2] * cone.dir[2]) / d;
    return cosA >= Math.cos(cone.cone);
  }

  /**
   * One step of fire: prey inside the cone heat up, the rest cool down. A prey reaching roast.cookTime
   * becomes roast chunks (size 1, food x roast.foodMult split evenly) where it fell; its herd bolts.
   * cone: from breathCone, or null when not breathing. Returns events.
   */
  function cook(field, cone, dt, rng) {
    const R = D.roast, ev = [], born = [];
    for (let i = field.list.length - 1; i >= 0; i--) {
      const p = field.list[i];
      if (!ACTIVE[p.state]) continue;
      if (cone && inCone(cone, p)) {
        p.cook += dt; p.heat = 0.35;
        if (p.state === 'graze') { p.state = 'flee'; p.calm = 0; }  // a scorched animal bolts
        if (p.cook >= R.cookTime) {
          field.list.splice(i, 1);
          const total = p.food * R.foodMult, n = Math.max(1, Math.ceil(total / R.chunkFood));
          for (let k = 0; k < n; k++) {
            const a = (k / n) * Math.PI * 2 + rng() * 0.6, r = n > 1 ? R.scatter : 0;
            let x = p.pos[0] + Math.cos(a) * r, z = p.pos[2] + Math.sin(a) * r;
            if (!groundOk(field.regionId, x, z)) { x = p.pos[0]; z = p.pos[2]; }
            born.push({ id: field.nextId++, type: 'roast', from: p.type, herd: p.herd, pos: [x, T.surfaceAt(field.regionId, x, z), z],
                        yaw: rng() * Math.PI * 2, state: 'roast', hp: 0, cook: R.cookTime, food: total / n, size: R.chunkSize,
                        cd: 0, t: 0, speed: 0, goal: null, pause: 0, calm: 0, scatter: 0, acc: 0 });
          }
          for (const q of field.list) if (q.herd === p.herd && q.state === 'graze') { q.state = 'flee'; q.calm = 0; }
          ev.push({ e: 'prey:roasted', type: p.type, chunks: n, food: total, pos: p.pos.slice() });
        }
      } else if (p.cook > 0) {
        p.cook = Math.max(0, p.cook - R.cool * dt);
        p.heat = Math.max(0, (p.heat || 0) - dt);
      }
    }
    field.list.push(...born);
    return ev;
  }

  function byId(field, id) { return field.list.find(p => p.id === id) || null; }

  function remove(field, id) {
    const i = field.list.findIndex(p => p.id === id);
    if (i >= 0) field.list.splice(i, 1);
    return i >= 0;
  }

  /** Counts by state, for the debug panel. */
  function census(field) {
    const c = { total: field.list.length };
    for (const p of field.list) c[p.state] = (c[p.state] || 0) + 1;
    return c;
  }

  M.define('prey', { spawnRegion, step, remove, census, groundOk, reach, swoopTarget, tryGrab, release, byId, fireTarget, breathCone, inCone, cook, HERD_R, ALARM_ALT, CHARGE_ALT });
})(typeof self !== 'undefined' ? self : this);
