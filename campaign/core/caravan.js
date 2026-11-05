/*
 * Verdigris campaign - caravans: the intercept mission's tithe wagon (Phase 3 T15, 003_task_missions.md 4.5, 5.6).
 * A wagon pulled by oxen drives along a road of its region (data.caravan.<id>.road = index of the region's 'road'
 * features, from .. to = fractions of that polyline) with escort archers walking beside it (defender AI: they are
 * archers in cs.squad with d.escort, they see, hear, volley and burn like the others).
 *   route(id) -> { pts, len, total } | null     the road polyline of caravan id (cached)
 *   spawn(cs, id, missionId) -> cv              cs.caravans[id] = cv (state 'waiting' until the dragon is in its region)
 *   step(cs, dt, opts?) -> events[]             once per frame after the dragon moved and before the defenders:
 *     - an intercept mission running or done -> its caravan exists ('caravan:spawned'); no such mission -> removed
 *       with its escort and chest ('caravan:gone')
 *     - the world outside the loaded region waits: the wagon only drives while the dragon is in its region and outside
 *       the lair / an aerie; the first such frame it sets out ('caravan:departed')
 *     - the breath cone on the wagon or the oxen costs data.caravan.burn hp / s (x opts.burn, the burnRate upgrade);
 *       at 0 hp it stops ('caravan:stopped' { caravan, mission, pos }) and drops its chest on the road behind it
 *       (a chest dropped on a bridge stays on the deck: terrain.surfaceAt includes decks)
 *     - reaching `to` (the castle gate): 'caravan:arrived' { caravan, mission } (missions.step fails the mission)
 *     - escorts walk to their slot beside the wagon while idle or suspicious (faster to catch up), stand and turn to
 *       what they noticed otherwise; the chest item is kept in cs.town.items (a rebuilt town gets it back)
 *   remove(cs, id) -> events[]
 *   wagonPoints(cv) -> [[x, y, z]]               where the breath can hit (wagon body, oxen)
 *   info(cs) -> { id, state, hp, hpMax, s, end, pos, alive } | null   debug line and the HUD
 * cv = { id, mission, region, s, end, speed, hp, hpMax, state: 'waiting' | 'moving' | 'stopped' | 'arrived', pos, yaw,
 *        burnT, walk, escort: [defender], chest: loot item | null }
 * The chest is a loot item { id: 'caravan.<id>.chest', kind (data.caravan.<id>.chest), mission, caravan, ... }: loot.take
 * emits 'loot:taken' with `mission`, it is never written to lootTaken (mission loot) and vanishes on a mission fail.
 * Not saved (the running mission is saved with v3, T18). Pure: no DOM, no THREE.
 */
(function (root) {
  'use strict';
  const M = typeof module === 'object' && module.exports ? require('./umd.js') : root.VCamp;
  const D = M.need('data'), T = M.need('terrain');
  const DF = () => M.need('defenders'), MS = () => M.need('missions');
  const { wrap, clamp } = M.need('math');
  const C = () => D.caravan;

  const routes = {};
  function route(id) {
    if (id in routes) return routes[id];
    const c = C()[id], R = c && T.region(c.region);
    const road = R ? ((R.terrain && R.terrain.features) || []).filter(f => f.type === 'road')[c.road || 0] : null;
    if (!road) return (routes[id] = null);
    const pts = road.points.map(q => [q[0], q[1]]), len = [0];
    for (let i = 1; i < pts.length; i++) len.push(len[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]));
    return (routes[id] = { pts, len, total: len[len.length - 1] });
  }

  /** x, y (ground), z and heading at distance s along the caravan's road. */
  function at(cv, s) {
    const a = DF().along(route(cv.id), s);
    return { x: a.x, z: a.z, y: T.surfaceAt(cv.region, a.x, a.z), yaw: a.yaw };
  }
  /** A point `fwd` ahead and `side` to the right of the wagon (yaw 0 = +Z, right = -X like defenders.spawn). */
  const off = (cv, fwd, side) => {
    const s = Math.sin(cv.yaw), c = Math.cos(cv.yaw);
    return [cv.pos[0] + s * fwd + c * side, cv.pos[2] + c * fwd - s * side];
  };

  function place(cv) {
    const p = at(cv, cv.s);
    cv.pos = [p.x, p.y, p.z]; cv.yaw = p.yaw;
  }

  function spawn(cs, id, missionId) {
    const c = C()[id], r = route(id);
    if (!c || !r) return null;
    const cv = { id, mission: missionId || null, region: c.region, s: c.from * r.total, end: c.to * r.total, speed: c.speed,
                 hp: c.wagonHp, hpMax: c.wagonHp, state: 'waiting', pos: [0, 0, 0], yaw: 0, burnT: 0, walk: 0, escort: [], chest: null };
    place(cv);
    const S = C().slots;
    for (let i = 0; i < (c.escort || 0); i++) {
      const sl = S[i % S.length], [x, z] = off(cv, sl[1], sl[0]);
      cv.escort.push(DF().mk('archer', 'caravan.' + id + '.escort' + (i + 1), 'caravan.' + id,
        [x, T.surfaceAt(cv.region, x, z) + D.defense.eye, z], cv.yaw, { escort: { caravan: id, side: sl[0], fwd: sl[1] } }));
    }
    cs.caravans = cs.caravans || {};
    cs.caravans[id] = cv;
    return cv;
  }

  function remove(cs, id) {
    const cv = cs.caravans && cs.caravans[id];
    if (!cv) return [];
    delete cs.caravans[id];
    if (cs.squad) cs.squad.list = cs.squad.list.filter(d => !(d.escort && d.escort.caravan === id));
    if (cs.town && cs.town.items) cs.town.items = cs.town.items.filter(it => it.caravan !== id);
    return [{ e: 'caravan:gone', caravan: id, mission: cv.mission }];
  }

  function wagonPoints(cv) {
    const [ox, oz] = off(cv, C().oxen, 0);
    return [[cv.pos[0], cv.pos[1] + 1.6, cv.pos[2]], [ox, T.surfaceAt(cv.region, ox, oz) + 1.2, oz]];
  }

  function dropChest(cv) {
    const c = C()[cv.id], K = D.loot[c.chest];
    const p = at(cv, Math.max(0, cv.s - C().chestBack));          // on the road behind the wagon: a deck keeps it dry
    const home = [p.x, p.y, p.z];
    cv.chest = { id: 'caravan.' + cv.id + '.chest', kind: c.chest, building: null, place: 'caravan.' + cv.id, size: K.size, gold: K.gold,
                 r: 1, home, pos: home.slice(), taken: false, mission: cv.mission, caravan: cv.id };
    return cv.chest;
  }

  /** Escort archers: to their slot while idle / suspicious (catch-up speed when far behind), else stand and turn. */
  function escortStep(cv, dt) {
    const W = D.perception.watch, sp = cv.speed * C().catchUp;
    for (const d of cv.escort) {
      d.walk = 0;
      if (!d.alive) continue;
      if (d.state === 'alert' || d.state === 'search') {
        if (d.focus) { const dy = wrap(Math.atan2(d.focus[0] - d.pos[0], d.focus[2] - d.pos[2]) - d.yaw), mx = W.turn * dt; d.yaw = wrap(d.yaw + clamp(dy, -mx, mx)); }
        continue;
      }
      const [x, z] = off(cv, d.escort.fwd, d.escort.side), dx = x - d.pos[0], dz = z - d.pos[2], l = Math.hypot(dx, dz);
      if (l > 0.05) {
        const k = Math.min(1, sp * dt / l);
        d.pos[0] += dx * k; d.pos[2] += dz * k;
        d.walk = Math.min(sp, l / Math.max(dt, 1e-3));
      }
      d.pos[1] = T.surfaceAt(cv.region, d.pos[0], d.pos[2]) + D.defense.eye;
      d.yaw = l > 1.5 ? Math.atan2(dx, dz) : cv.state === 'moving' ? cv.yaw : wrap(d.yaw);
      if (d.state === 'suspicious' && d.focus) d.yaw = Math.atan2(d.focus[0] - d.pos[0], d.focus[2] - d.pos[2]);
    }
  }

  /** Escorts into the squad of this region, the chest into the town's items (both may have been rebuilt). */
  function attach(cs, cv) {
    const sq = cs.squad;
    if (sq && sq.town === cs.town) for (const d of cv.escort) if (sq.list.indexOf(d) < 0) sq.list.push(d);
    if (cv.chest && cs.town) {
      cs.town.items = cs.town.items || [];
      if (cs.town.items.indexOf(cv.chest) < 0) cs.town.items = cs.town.items.filter(it => it.id !== cv.chest.id).concat([cv.chest]);
    }
  }

  function wanted(cs) {
    const a = MS().active(cs), m = a && MS().def(a.id);
    return m && m.type === 'intercept' && (a.state === 'running' || a.state === 'done') ? m : null;
  }

  function step(cs, dt, opts) {
    const out = [], m = wanted(cs);
    cs.caravans = cs.caravans || {};
    for (const id of Object.keys(cs.caravans)) if (!m || m.caravan !== id) out.push(...remove(cs, id));
    if (m && !cs.caravans[m.caravan] && spawn(cs, m.caravan, m.id)) out.push({ e: 'caravan:spawned', caravan: m.caravan, mission: m.id });
    const mult = (opts && opts.burn) || 1;
    for (const id of Object.keys(cs.caravans)) {
      const cv = cs.caravans[id];
      if (cs.region !== cv.region || cs.inLair || cs.inAerie || !cs.dragon.pilot) continue;   // the world elsewhere waits
      cv.burnT = Math.max(0, cv.burnT - dt);
      if (cv.state === 'waiting') { cv.state = 'moving'; out.push({ e: 'caravan:departed', caravan: id, mission: cv.mission }); }
      if (cv.state === 'moving' && cs.breath && wagonPoints(cv).some(q => DF().inCone(cs.breath, q, cv.region))) {
        cv.hp = Math.max(0, cv.hp - C().burn * mult * dt);
        cv.burnT = 0.35;
        if (cv.hp <= 0) {
          cv.state = 'stopped';
          dropChest(cv);
          out.push({ e: 'caravan:stopped', caravan: id, mission: cv.mission, pos: cv.pos.slice() });
        }
      }
      if (cv.state === 'moving') {
        cv.s = Math.min(cv.end, cv.s + cv.speed * dt);
        place(cv);
        cv.walk = cv.speed;
        if (cv.s >= cv.end) { cv.state = 'arrived'; cv.walk = 0; out.push({ e: 'caravan:arrived', caravan: id, mission: cv.mission }); }
      } else cv.walk = 0;
      escortStep(cv, dt);
      attach(cs, cv);
    }
    return out;
  }

  function info(cs) {
    const ids = Object.keys(cs.caravans || {});
    if (!ids.length) return null;
    const cv = cs.caravans[ids[0]];
    return { id: cv.id, state: cv.state, hp: cv.hp, hpMax: cv.hpMax, s: cv.s, end: cv.end, pos: cv.pos, alive: cv.escort.filter(d => d.alive).length, escort: cv.escort.length };
  }

  M.define('caravan', { route, spawn, step, remove, wagonPoints, info, at });
})(typeof self !== 'undefined' ? self : this);
