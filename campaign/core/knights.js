/*
 * Verdigris campaign - mounted knights of the Order (Phase 4 T07, 004_task_highlands.md 4.4 and 5.3).
 *   cs.knights = { region, list: [k], alarm: { place: s }, called: { place: true }, lost: { stable: n }, carried, acc, kills }
 *       k = { id, stable, place, home [x, z], pos [x, groundY, z] (hooves), yaw, hp, alive, state, why, goal [x, z],
 *             seen, lost, cool, speed, stuck, burnT, stunT, vy, dropH, phase, far }
 *       state: 'ride' (to the alarm) | 'chase' (sees the dragon) | 'return' (home, then back in the stable) |
 *              'stun' (dropped from low) | 'carried' (in a Wyrm's claws) | 'fall' (dropped)
 *   ensure(cs) -> kn                 per region; a region change empties the field (the riders stay home)
 *   stables(town) -> [b]             buildings whose type has `knights` (data.buildings), not a ruin or charred
 *   left(cs, b) -> n                 riders the stable can still send (its knights - out riding - lost this visit)
 *   call(cs, from [x, z], why, place?) -> events[]   the nearest stable with riders left sends up to its `knights`
 *                                    toward from (capped by knight.max live riders per region); 'knights:called'
 *   step(cs, dt, { callMult, scale, spot }) -> events[]
 *       call rule: a settlement alarm (any defender of the place alert or searching) lasting knight.callAfter s
 *       (x callMult, Renown later) calls once per alarm; at alert level >= 2 (alert.responses .knights) any alarm calls
 *       at once; ride along the road where it helps (both ends near it and far apart), else across ground whose slope
 *       walk.passable allows, around building solids; chase the dragon's ground point while seen (perception.seen from
 *       the saddle); lance when within lance.range (+ the body) and the dragon is landed or its body lower than
 *       lance.maxAlt over the ground ('knight:lance' { id, damage, pos }); lose interest after returnAfter s unseen and
 *       ride home ('knight:home' when back: the rider is in the stable again); stuck for ai.stuck s far from the dragon:
 *       back home at once. Full AI within ai.near of the dragon, ai.farHz beyond. The breath burns them (defense.burn x
 *       fireDamage, 'knight:killed' cause 'fire'); arrows never hurt them (hurt(.., 'arrow') = 0).
 *   reach(cs, p, limit, scale) -> { best, heavy }    a knight under the claws (grab.radius / maxAboveGround like prey)
 *   grab(cs, k) / drop(cs, p) -> events[]   'knight:grabbed'; 'knight:dropped' { h }: it falls, from dropKill or
 *       higher it dies ('knight:killed' cause 'fall'), lower it is stunned for ai.stun s
 *   hurt(k, amount, cause) -> damage taken (0 for 'arrow' when arrowProof)
 * Pure: no DOM, no THREE.
 */
(function (root) {
  'use strict';
  const M = typeof module === 'object' && module.exports ? require('./umd.js') : root.VCamp;
  const D = M.need('data'), T = M.need('terrain'), SE = M.need('settlement'), PC = M.need('perception'), WK = M.need('walk');
  const { wrap, clamp } = M.need('math');
  const K = () => D.defenders.knight;
  const OUT = b => !b || b.ruin || b.char;
  const EYE = 2.8;                                       // the rider's eye over the hooves

  function ensure(cs) {
    const rid = cs.region;
    if (!cs.knights || cs.knights.region !== rid || cs.knights.town !== cs.town) {
      const same = cs.knights && cs.knights.region === rid;
      cs.knights = { region: rid, town: cs.town, list: same ? cs.knights.list : [], alarm: {}, called: {}, lost: same ? cs.knights.lost : {},
                     carried: same ? cs.knights.carried : null, acc: 0, kills: same ? cs.knights.kills : 0, seq: same ? cs.knights.seq : 0 };
    }
    return cs.knights;
  }

  function stables(town) {
    return ((town && town.buildings) || []).filter(b => D.buildings[b.type] && D.buildings[b.type].knights > 0 && !OUT(b));
  }

  function left(cs, b) {
    const kn = ensure(cs), out = kn.list.filter(k => k.alive && k.stable === b.id).length;
    return Math.max(0, D.buildings[b.type].knights - out - (kn.lost[b.id] || 0));
  }

  const live = kn => kn.list.filter(k => k.alive).length;

  function call(cs, from, why, place) {
    const kn = ensure(cs), out = [], town = cs.town;
    let best = null, bd = Infinity;
    for (const b of stables(town)) {
      if (left(cs, b) <= 0) continue;
      const d = Math.hypot(b.pos[0] - from[0], b.pos[2] - from[1]);
      if (d < bd) { bd = d; best = b; }
    }
    if (!best) return out;
    const n = Math.min(left(cs, best), Math.max(0, K().max - live(kn)));
    if (n <= 0) return out;
    for (let i = 0; i < n; i++) {
      const a = (i - (n - 1) / 2) * 0.7, yaw = Math.atan2(from[0] - best.pos[0], from[1] - best.pos[2]);
      const r = best.r + 3, x = best.pos[0] + Math.sin(yaw + a) * r, z = best.pos[2] + Math.cos(yaw + a) * r;
      kn.seq = (kn.seq || 0) + 1;
      kn.list.push({ id: best.id + '.knight' + kn.seq, stable: best.id, place: best.place, home: [x, z], pos: [x, T.surfaceAt(cs.region, x, z), z],
        yaw, hp: K().hp, alive: true, state: 'ride', why, goal: from.slice(), seen: 0, lost: 0, cool: 0, speed: 0, stuck: 0,
        burnT: 0, stunT: 0, vy: 0, dropH: 0, phase: (kn.seq * 1.7) % (Math.PI * 2), far: false });
    }
    out.push({ e: 'knights:called', stable: best.id, place: place || best.place, n, why, pos: best.pos.slice() });
    return out;
  }

  function hurt(k, amount, cause) {
    if (!k || !k.alive) return 0;
    if (cause === 'arrow' && K().arrowProof) return 0;
    const dmg = cause === 'fire' ? amount * K().fireDamage : amount;
    k.hp -= dmg;
    return dmg;
  }

  function kill(kn, k, cause, out) {
    if (!k.alive) return;
    k.alive = false; k.state = 'dead';
    if (kn.carried === k.id) kn.carried = null;
    kn.lost[k.stable] = (kn.lost[k.stable] || 0) + 1;
    kn.kills = (kn.kills || 0) + 1;
    out.push({ e: 'knight:killed', id: k.id, cause, pos: k.pos.slice(), place: k.place });
  }

  /** Nearest point index s on a route (defenders.routeOf), for road following. */
  function project(route, x, z) {
    let bs = 0, bd = Infinity;
    for (let i = 1; i < route.pts.length; i++) {
      const a = route.pts[i - 1], b = route.pts[i], sx = b[0] - a[0], sz = b[1] - a[1], l2 = sx * sx + sz * sz || 1;
      const t = clamp(((x - a[0]) * sx + (z - a[1]) * sz) / l2, 0, 1), px = a[0] + sx * t, pz = a[1] + sz * t;
      const d = Math.hypot(px - x, pz - z);
      if (d < bd) { bd = d; bs = route.len[i - 1] + Math.sqrt(l2) * t; }
    }
    return { s: bs, d: bd };
  }

  /** The castle of the town in world space (cached on kn): polygon of its wall runs around the centre, gate mid and
   *  outward normal. null without a castle. */
  function castleOf(kn) {
    if (kn.castle !== undefined) return kn.castle;
    const town = kn.town, pl = town && town.places.find(q => q.castle);
    const g = pl && town.buildings.find(b => b.type === 'portcullis' && b.place === pl.id);
    if (!pl || !g) return (kn.castle = null);
    const pts = [];
    for (const b of town.buildings) if (b.place === pl.id && b.seg && (b.type === 'wall' || b.type === 'portcullis')) pts.push([b.seg[0], b.seg[1]], [b.seg[2], b.seg[3]]);
    pts.sort((a, b) => Math.atan2(a[0] - pl.x, a[1] - pl.z) - Math.atan2(b[0] - pl.x, b[1] - pl.z));
    const mx = (g.seg[0] + g.seg[2]) / 2, mz = (g.seg[1] + g.seg[3]) / 2, l = Math.hypot(mx - pl.x, mz - pl.z) || 1;
    return (kn.castle = { poly: pts, mid: [mx, mz], n: [(mx - pl.x) / l, (mz - pl.z) / l] });
  }
  function inPoly(poly, x, z) {
    let inn = false;
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      const [xi, zi] = poly[i], [xj, zj] = poly[j];
      if ((zi > z) !== (zj > z) && x < (xj - xi) * (z - zi) / (zj - zi) + xi) inn = !inn;
    }
    return inn;
  }
  /** Through the castle gate when the rider and its goal are on different sides of the wall. */
  function gateWay(kn, k, goal) {
    const C = castleOf(kn);
    if (!C) return null;
    const kin = inPoly(C.poly, k.pos[0], k.pos[2]), gin = inPoly(C.poly, goal[0], goal[1]);
    if (kin === gin) return null;
    const rx = k.pos[0] - C.mid[0], rz = k.pos[2] - C.mid[1], along = rx * C.n[0] + rz * C.n[1], side = Math.abs(rx * -C.n[1] + rz * C.n[0]);
    const A = K().ai, sgn = kin ? -1 : 1;                 // the side of the gate the rider is on
    if (along * sgn > A.gateIn * 0.5 && side > 3) return [C.mid[0] + C.n[0] * A.gateIn * sgn, C.mid[1] + C.n[1] * A.gateIn * sgn];   // line up first
    return [C.mid[0] - C.n[0] * A.gateIn * 1.4 * sgn, C.mid[1] - C.n[1] * A.gateIn * 1.4 * sgn];                                       // then through
  }

  /** Where to steer for goal: through the castle gate if the wall is between, else along the road when the rider and the goal are both near it and far apart along it. */
  function waypoint(kn, k, goal) {
    const DF = M.need('defenders'), A = K().ai, gw = gateWay(kn, k, goal);
    if (gw) return gw;
    if (kn.route === undefined) kn.route = kn.town ? DF.routeOf(kn.town) : null;
    const route = kn.route;
    if (!route) return goal;
    const a = project(route, k.pos[0], k.pos[2]), b = project(route, goal[0], goal[1]);
    if (a.d > A.roadNear || b.d > A.roadNear * 1.5 || Math.abs(b.s - a.s) < A.roadMin) return goal;
    const at = DF.along(route, a.s + Math.sign(b.s - a.s) * A.roadLook);
    return [at.x, at.z];
  }

  /** One move step toward (gx, gz) at speed; slope, water and building solids block, a blocked rider tries to the side. */
  function move(cs, k, gx, gz, speed, dt) {
    const dx = gx - k.pos[0], dz = gz - k.pos[2], dist = Math.hypot(dx, dz);
    const want = Math.atan2(dx, dz), dy = wrap(want - k.yaw), mx = K().turn * dt;
    k.yaw = wrap(k.yaw + clamp(dy, -mx, mx));
    k.speed = dist < 0.5 ? 0 : speed * (1 - 0.6 * Math.min(1, Math.abs(dy) / Math.PI));
    if (k.speed <= 0) return;
    k.stuck += dt;                                       // cleared below when the rider really moves
    const s = Math.min(dist, k.speed * dt), ctx = { regionId: cs.region };
    for (const off of [0, 0.5, -0.5, 1.0, -1.0, 1.6, -1.6]) {
      const y = k.yaw + off;
      let nx = k.pos[0] + Math.sin(y) * s, nz = k.pos[2] + Math.cos(y) * s;
      if (!WK.passable(ctx, k.pos[0], k.pos[2], nx, nz, 1)) continue;
      const h = cs.town ? SE.hit(cs.town, nx, nz, K().ai.pad) : null;
      if (h && h.b.type !== 'portcullis') {           // the gate is raised for the Order's riders
        nx += h.nx * h.depth; nz += h.nz * h.depth;
        const h2 = SE.hit(cs.town, nx, nz, 0);
        if (h2 && h2.b.type !== 'portcullis') continue;
      }
      if (Math.hypot(nx - k.pos[0], nz - k.pos[2]) > 0.3 * s) k.stuck = 0;
      k.pos[0] = nx; k.pos[2] = nz; k.pos[1] = T.surfaceAt(cs.region, nx, nz);
      if (off) k.yaw = wrap(k.yaw + off * 0.3);
      return;
    }
    k.speed = 0;                                         // boxed in: stands (the stuck rule sends it home)
  }

  function alarms(cs, kn, dt, callMult, out) {
    const AL = M.need('alert'), sq = cs.squad, town = cs.town;
    if (!sq || !town || !stables(town).length) return;
    const lv = AL.level((cs.regionStates || {})[cs.region] || {}), fast = !!AL.responses(lv).knights;
    const on = {};
    for (const d of sq.list) if (d.alive && (d.state === 'alert' || d.state === 'search') && !d.escort) on[d.place] = true;
    for (const pl of town.places) {
      if (!on[pl.id]) { delete kn.alarm[pl.id]; delete kn.called[pl.id]; continue; }
      kn.alarm[pl.id] = (kn.alarm[pl.id] || 0) + dt;
      if (kn.called[pl.id]) continue;
      if (fast || kn.alarm[pl.id] >= K().callAfter * (callMult || 1)) {
        kn.called[pl.id] = true;
        const p = cs.dragon.pilot, at = p && !cs.inLair ? [p.pos[0], p.pos[2]] : [pl.x, pl.z];
        for (const e of call(cs, at, fast ? 'level' : 'alarm', pl.id)) out.push(e);
      }
    }
  }

  function sees(cs, k, p, ctx) {
    const v = { pos: [k.pos[0], k.pos[1] + EYE, k.pos[2]], yaw: k.yaw, sight: K().sight, fov: k.state === 'chase' ? Math.PI * 2 : K().fov };
    return PC.seen(v, { pos: p.pos }, ctx) > 0;
  }

  function knight(cs, kn, k, p, dt, ctx, out) {
    const V = K(), A = V.ai, scale = ctx.scale || 1, inside = cs.inLair || !p || cs.form === 'human';
    k.cool = Math.max(0, k.cool - dt);
    k.burnT = Math.max(0, k.burnT - dt);
    if (k.state === 'carried') return;
    if (k.state === 'fall') {
      k.vy -= D.projectiles.gravity * dt;
      k.pos[1] += k.vy * dt;
      const g = T.surfaceAt(cs.region, k.pos[0], k.pos[2]);
      if (k.pos[1] <= g) {
        k.pos[1] = g;
        if (k.dropH >= V.dropKill) kill(kn, k, 'fall', out);
        else { k.state = 'stun'; k.stunT = A.stun; out.push({ e: 'knight:stunned', id: k.id }); }
      }
      return;
    }
    if (k.state === 'stun') { k.speed = 0; if ((k.stunT -= dt) <= 0) { k.state = 'ride'; k.goal = p ? [p.pos[0], p.pos[2]] : k.home.slice(); } return; }
    const see = !inside && sees(cs, k, p, ctx);
    if (see) { k.goal = [p.pos[0], p.pos[2]]; k.lost = 0; if (k.state !== 'chase') k.state = 'chase'; }
    else if (k.state === 'chase' || k.state === 'ride') {
      k.lost += dt;
      if (k.state === 'chase' && k.lost > 2) k.state = 'ride';   // rides on to where it last saw the dragon
      if (k.lost >= V.returnAfter) { k.state = 'return'; k.stuck = 0; }
    }
    if (k.state === 'return') {
      const dh = Math.hypot(k.home[0] - k.pos[0], k.home[1] - k.pos[2]);
      if (dh < 4) { k.alive = false; k.state = 'home'; out.push({ e: 'knight:home', id: k.id, stable: k.stable }); return; }
      const w = waypoint(kn, k, k.home);
      move(cs, k, w[0], w[1], V.speed, dt);
    } else {
      const ld = Math.hypot(k.goal[0] - k.pos[0], k.goal[1] - k.pos[2]);
      const reachR = V.lance.range + 2 * scale;
      if (k.state === 'chase' && ld < reachR * 0.6) { k.speed = 0; k.yaw = wrap(k.yaw + clamp(wrap(Math.atan2(k.goal[0] - k.pos[0], k.goal[1] - k.pos[2]) - k.yaw), -V.turn * dt, V.turn * dt)); }
      else if (k.state === 'ride' && ld < A.arrive) k.speed = 0;   // at the alarm: looks around until it sees the dragon or gives up
      else { const w = waypoint(kn, k, k.goal); move(cs, k, w[0], w[1], V.gallop, dt); }
      // the lance: a landed dragon or one flying low enough over the ground
      if (see && k.cool <= 0 && p) {
        const dd = Math.hypot(p.pos[0] - k.pos[0], p.pos[2] - k.pos[2]);
        if (dd <= reachR && low(cs, p, scale)) {
          k.cool = V.lance.cooldown;
          out.push({ e: 'knight:lance', id: k.id, damage: V.lance.damage, pos: [k.pos[0], k.pos[1] + EYE, k.pos[2]] });
        }
      }
    }
    // stuck: trying to ride but not moving for ai.stuck s while far from the dragon -> home at once
    const goal = k.state === 'return' ? k.home : k.goal, gd = Math.hypot(goal[0] - k.pos[0], goal[1] - k.pos[2]);
    const far = !p || Math.hypot(p.pos[0] - k.pos[0], p.pos[2] - k.pos[2]) > A.unseen;
    if (k.stuck > A.stuck && far && gd > A.arrive) {
      k.alive = false; k.state = 'home';
      out.push({ e: 'knight:home', id: k.id, stable: k.stable, stuck: true });
    }
  }

  /** The dragon is in lance reach height: landed, or its body lower than lance.maxAlt over the ground. */
  function low(cs, p, scale) {
    if (p.mode && p.mode !== 'air' && p.mode !== 'takeoff') return true;
    const alt = p.pos[1] - T.surfaceAt(cs.region, p.pos[0], p.pos[2]) - D.walk.stand * (scale || 1);
    return alt < K().lance.maxAlt;
  }

  function burn(cs, kn, dt, out) {
    const cone = cs.breath;
    if (!cone) return;
    const DF = M.need('defenders');
    for (const k of kn.list) {
      if (!k.alive || k.state === 'carried') continue;
      if (!DF.inCone(cone, [k.pos[0], k.pos[1] + EYE * 0.6, k.pos[2]], cs.region)) continue;
      k.burnT = 0.35;
      hurt(k, D.defense.burn * dt, 'fire');
      if (k.hp <= 0) kill(kn, k, 'fire', out);
    }
  }

  function step(cs, dt, o) {
    const out = [], kn = ensure(cs), p = cs.dragon && cs.dragon.pilot, A = K().ai;
    o = o || {};
    if (!cs.inLair) alarms(cs, kn, dt, o.callMult, out);
    const inside = cs.inLair || !p || cs.form === 'human';
    if (!inside) burn(cs, kn, dt, out);
    // a carried knight hangs under the claws; it is let go when the dragon lands or goes into the cave
    const held = kn.carried ? kn.list.find(k => k.id === kn.carried && k.alive) : null;
    if (kn.carried && !held) kn.carried = null;
    if (held) {
      if (cs.inLair || !p || p.mode !== 'air') for (const e of drop(cs, p)) out.push(e);
      else { held.pos = [p.pos[0], p.pos[1] - D.grab.clawDrop * (o.scale || 1) - EYE, p.pos[2]]; held.yaw = p.yaw; }
    }
    const ctx = { regionId: cs.region, spot: o.spot || 1, light: cs.light == null ? 'day' : cs.light, scale: o.scale || 1, town: cs.town };
    kn.acc += dt;
    const farStep = kn.acc >= 1 / A.farHz;
    for (const k of kn.list) {
      if (!k.alive) continue;
      k.far = !!p && Math.hypot(p.pos[0] - k.pos[0], p.pos[2] - k.pos[2]) > A.near;
      if (k.far && k.state !== 'fall' && k.state !== 'carried') { if (farStep) knight(cs, kn, k, p, kn.acc, ctx, out); continue; }
      knight(cs, kn, k, p, dt, ctx, out);
    }
    if (farStep) kn.acc = 0;
    kn.list = kn.list.filter(k => k.alive);
    // riders keep apart (ai.space): a pair too close is pushed apart, never into a solid
    const R = kn.list.filter(k => k.state !== 'carried' && k.state !== 'fall');
    for (let i = 0; i < R.length; i++) for (let j = i + 1; j < R.length; j++) {
      const a = R[i], b = R[j], dx = b.pos[0] - a.pos[0], dz = b.pos[2] - a.pos[2], d = Math.hypot(dx, dz);
      if (d >= A.space) continue;
      const ux = d > 1e-6 ? dx / d : Math.sin(i + j), uz = d > 1e-6 ? dz / d : Math.cos(i + j), push = Math.min(A.space - d, 4 * dt) / 2;
      for (const [k, sg] of [[a, -1], [b, 1]]) {
        const nx = k.pos[0] + ux * push * sg, nz = k.pos[2] + uz * push * sg;
        if (cs.town && SE.hit(cs.town, nx, nz, A.pad)) continue;
        if (!WK.passable({ regionId: cs.region }, k.pos[0], k.pos[2], nx, nz, 1)) continue;
        k.pos[0] = nx; k.pos[2] = nz; k.pos[1] = T.surfaceAt(cs.region, nx, nz);
      }
    }
    return out;
  }

  function reach(cs, p, limit, scale) {
    const kn = cs.knights, G = D.grab, s = Math.max(1, scale || 1);
    const out = { best: null, heavy: null };
    if (!kn || !p || kn.carried) return out;
    const radius = G.radius * s, maxUp = G.maxAboveGround + G.clawDrop * s;
    let bd = Infinity;
    for (const k of kn.list) {
      if (!k.alive || k.state === 'carried' || k.state === 'fall') continue;
      const d = Math.hypot(k.pos[0] - p.pos[0], k.pos[2] - p.pos[2]), up = p.pos[1] - (k.pos[1] + EYE);
      if (d > radius || up > maxUp || up < -2) continue;
      if (K().size > limit) { out.heavy = k; continue; }
      if (d < bd) { bd = d; out.best = k; }
    }
    return out;
  }

  function grab(cs, k) {
    const kn = ensure(cs);
    k.state = 'carried'; k.speed = 0; kn.carried = k.id;
    return [{ e: 'knight:grabbed', id: k.id }];
  }

  function drop(cs, p) {
    const kn = ensure(cs), k = kn.carried ? kn.list.find(q => q.id === kn.carried) : null;
    kn.carried = null;
    if (!k || !k.alive) return [];
    const g = T.surfaceAt(cs.region, k.pos[0], k.pos[2]);
    k.dropH = Math.max(0, k.pos[1] - g);
    k.state = 'fall'; k.vy = 0; k.lost = 0; k.stuck = 0;
    if (p) k.goal = [p.pos[0], p.pos[2]];
    return [{ e: 'knight:dropped', id: k.id, h: k.dropH }];
  }

  M.define('knights', { ensure, stables, left, call, step, reach, grab, drop, hurt, low, EYE });
})(typeof self !== 'undefined' ? self : this);
