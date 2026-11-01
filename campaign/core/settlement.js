/*
 * Verdigris campaign - settlements and buildings (Phase 2 T12, 002_task_kingdom.md 4.2 and 5.2).
 *   build(regionId, regionState?) -> town   the region's settlements from data.settlements templates, placed at
 *                                           data.regions[id].settlements with a seeded jitter (same town every time)
 *       town: { region, places: [{ id, type, x, z, yaw, y, r }], buildings: [{ id, place, type, pos, yaw, r, h, hp,
 *               fire, ruin, ruinAt, seg? }], pens: [{ id, place, type, pos, r, count }], posts: [{ kind, building, pos }] }
 *       palisade pieces carry seg [x0, z0, x1, z1] (a capsule of data.palisade.radius); everything else is a cylinder.
 *       regionState (T13 / T22): { ruins: [{ id, at }] } marks those buildings as ruins; { heat } (T17): the template's
 *       alert3 buildings (the village ballista platform) stand only at alert 3 (town.alert3 = true).
 *   solidAt(town, x, z, pad?) -> roofHeight | null   the highest roof whose footprint (+ pad) covers (x, z)
 *   hit(town, x, z, pad?) -> { b, roof, nx, nz, depth } | null   the solid the point is deepest inside: push out along
 *                                           (nx, nz) by depth to stand clear of it (flight and walk collisions)
 *   near(town, x, z, range) -> place | null nearest settlement within range of its centre
 *   burn(town, cone, dt, { mult, rng, now }) -> events[]   T13: the breath cone heats the buildings it reaches
 *                                           (b.heat, `fire.ignite` s to catch fire: 'building:burning'); a burning one
 *                                           (b.fire = s burning) loses hp (`fire.burn`, + `fire.fan` under the breath, x
 *                                           mult), sets neighbours (b.nb, footprints within `fire.reach`) alight with
 *                                           chance `fire.spread` per s, and at 0 hp becomes a ruin ('building:ruined',
 *                                           ruinAt = now). cone: prey.breathCone or null (not breathing).
 *   rebuild(town, now, blocked?) -> events[]   ruins older than `fire.rebuild` s stand again ('building:rebuilt'),
 *                                           unless blocked(b) (the dragon stands in the footprint)
 *   inFire(b, cone) -> bool                 the cone reaches building b (samples along the stream)
 * T03 castle (a template with `walls`, core/castle.js): its pieces (corners, wall runs as capsules, the portcullis,
 *   inner buildings) are buildings like the others. A piece type with walkTop (wall walk, bastion top) is a solid with a
 *   walkable top at pos.y + walkTop; the portcullis (gate: true) is a solid only while town.gateClosed. Stone pieces
 *   (stone: true) do not burn yet (charring comes in T06).
 *   surfaceAt(town, x, z, pad?) -> height | null   the walkable top under (x, z) when it is the highest solid there
 * A ruin is no solid (rubble only). Pure: no DOM, no THREE.
 */
(function (root) {
  'use strict';
  const M = typeof module === 'object' && module.exports ? require('./umd.js') : root.VCamp;
  const D = M.need('data'), T = M.need('terrain');
  const { mulberry, wrap } = M.need('math');

  const cache = new Map();                       // regionId -> layout (positions only; build() copies the mutable state)

  /** Settlement ids: '<region>.<type>', with a number when a region has two of a type. */
  function placeIds(regionId, sites) {
    const n = {};
    for (const s of sites) n[s.type] = (n[s.type] || 0) + 1;
    const k = {};
    return sites.map(s => regionId + '.' + s.type + (n[s.type] > 1 ? (k[s.type] = (k[s.type] || 0) + 1) : ''));
  }

  function rot(x, z, yaw) {                      // local offset -> world offset (local +Z = the site's yaw direction)
    const c = Math.cos(yaw), s = Math.sin(yaw);
    return [x * c + z * s, -x * s + z * c];
  }

  function layout(regionId) {
    if (cache.has(regionId)) return cache.get(regionId);
    const R = T.region(regionId), sites = R.settlements || [], ids = placeIds(regionId, sites), S = D.settlement;
    const out = { places: [], buildings: [], pens: [] };
    sites.forEach((site, si) => {
      const tpl = D.settlements[site.type];
      if (!tpl) throw new Error('unknown settlement type ' + site.type);
      const id = ids[si], rng = mulberry((R.seed || 1) * 7919 + si * 104729 + 17);
      const y = T.surfaceAt(regionId, site.x, site.z);
      const place = { id, type: site.type, x: site.x, z: site.z, yaw: site.yaw || 0, y, r: 0 };
      if (site.name) place.name = site.name;                        // T04: named places (the Bend) for the compass and toasts
      const count = {};
      const add = (type, lx, lz, extra) => {
        count[type] = (count[type] || 0) + 1;
        const B = D.buildings[type];
        const [ox, oz] = rot(lx, lz, place.yaw), x = site.x + ox, z = site.z + oz;
        const b = Object.assign({ id: id + '.' + type + count[type], place: id, type, pos: [x, T.surfaceAt(regionId, x, z), z],
                                  yaw: place.yaw, r: B.r, h: B.h }, extra || {});
        out.buildings.push(b);
        place.r = Math.max(place.r, Math.hypot(lx, lz) + Math.max(B.r, D.palisade.radius));
        return b;
      };
      for (const [type, lx, lz] of tpl.buildings) {
        const a = rng() * Math.PI * 2, j = tpl.walls ? 0 : S.jitter * rng();   // T03: castle pieces sit exactly where the kit draws them
        const b = add(type, lx + Math.cos(a) * j, lz + Math.sin(a) * j);
        if (tpl.walls) b.yaw = wrap(b.yaw + Math.PI / 2);                       // castle.layout: inner buildings face the gate (+X)
        else b.yaw = wrap(b.yaw + (rng() * 2 - 1) * S.jitterYaw);
      }
      for (const [type, lx, lz] of (tpl.alert3 && tpl.alert3.buildings) || []) {   // T17: built at alert 3 only (build drops them below)
        const b = add(type, lx, lz, { alert3: true });
        b.yaw = wrap(b.yaw + (rng() * 2 - 1) * S.jitterYaw);
      }
      if (tpl.walls) {                           // T03: castle pieces from core/castle.js (local frame = the site frame)
        const CA = M.need('castle');
        for (const pc of CA.pieces(tpl)) {
          if (pc.inner) continue;                // inner buildings come from tpl.buildings above (with the jitter)
          if (!pc.seg) { add(pc.type, pc.x, pc.z); continue; }
          const p0 = rot(pc.seg[0], pc.seg[1], place.yaw), p1 = rot(pc.seg[2], pc.seg[3], place.yaw);
          const b = add(pc.type, pc.x, pc.z, pc.gate ? { gate: true } : null);
          b.seg = [site.x + p0[0], site.z + p0[1], site.x + p1[0], site.z + p1[1]];
          b.r = pc.r; b.len = pc.len; b.yaw = Math.atan2(p1[0] - p0[0], p1[1] - p0[1]);
          place.r = Math.max(place.r, Math.hypot(pc.seg[0], pc.seg[1]) + pc.r, Math.hypot(pc.seg[2], pc.seg[3]) + pc.r);
        }
        place.castle = true;
      }
      if (tpl.ring) {                            // palisade: pieces round the centre, a gate gap at local +Z
        const [r, gate] = tpl.ring, P = D.palisade, n = Math.max(6, Math.ceil(2 * Math.PI * r / P.piece)), half = gate / 2 / r;
        for (let i = 0; i < n; i++) {
          const a0 = i / n * Math.PI * 2, a1 = (i + 1) / n * Math.PI * 2, am = (a0 + a1) / 2;
          if (Math.abs(wrap(am)) < half + Math.PI / n * 0.5) continue;   // the gate (angle 0 = local +Z)
          const p0 = rot(Math.sin(a0) * r, Math.cos(a0) * r, place.yaw), p1 = rot(Math.sin(a1) * r, Math.cos(a1) * r, place.yaw);
          const b = add('palisade', Math.sin(am) * r, Math.cos(am) * r);
          b.seg = [site.x + p0[0], site.z + p0[1], site.x + p1[0], site.z + p1[1]];
          b.r = P.radius; b.len = Math.hypot(p1[0] - p0[0], p1[1] - p0[1]); b.yaw = Math.atan2(p1[0] - p0[0], p1[1] - p0[1]);
        }
      }
      (tpl.pens || []).forEach(([type, lx, lz, cnt], k) => {
        const [ox, oz] = rot(lx, lz, place.yaw), x = site.x + ox, z = site.z + oz, pr = S.penR + cnt;
        out.pens.push({ id: id + '.pen' + (k + 1), place: id, type, pos: [x, T.surfaceAt(regionId, x, z), z], r: pr, count: cnt });
        place.r = Math.max(place.r, Math.hypot(lx, lz) + pr);
      });
      out.places.push(place);
    });
    out.buildings.forEach((b, i) => {             // T13: fire neighbours, same settlement, footprints within fire.reach
      b.nb = [];
      out.buildings.forEach((o, j) => { if (j !== i && o.place === b.place && gap(b, o) <= D.fire.reach) b.nb.push(j); });
    });
    cache.set(regionId, out);
    return out;
  }

  /** T17: the region's alert level reaches a level whose response has villageBallista (data.alert.responses). */
  function alert3On(rs) {
    const A = D.alert, h = rs && typeof rs.heat === 'number' ? rs.heat : 0, lv = Math.min(A.maxLevel, Math.floor(h));
    for (let i = 1; i <= lv; i++) if (A.responses[i] && A.responses[i].villageBallista) return true;
    return false;
  }

  function build(regionId, rs) {
    const L = layout(regionId);
    const ruins = {};
    for (const r of (rs && rs.ruins) || []) if (r && r.id) ruins[r.id] = r.at || 0;
    const on = alert3On(rs), keep = L.buildings.map(b => !b.alert3 || on), map = [];
    let n = 0;
    keep.forEach((k, i) => { map[i] = k ? n++ : -1; });
    const buildings = L.buildings.filter((b, i) => keep[i]).map(b => Object.assign({}, b, {
      pos: b.pos.slice(), hp: D.buildings[b.type].hp, heat: 0, fire: 0, ruin: b.id in ruins, ruinAt: b.id in ruins ? ruins[b.id] : null,
      nb: (b.nb || []).filter(j => keep[j]).map(j => map[j]),
    }));
    const posts = [];
    for (const b of buildings) {
      const post = D.buildings[b.type].post;
      if (post) posts.push({ kind: post, building: b.id, pos: [b.pos[0], b.pos[1] + b.h, b.pos[2]] });
    }
    return {
      region: regionId, alert3: on,
      places: L.places.map(p => Object.assign({}, p)),
      buildings, posts,
      pens: L.pens.map(p => Object.assign({}, p, { pos: p.pos.slice() })),
    };
  }

  /** Distance from (x, z) to building b's footprint edge (negative inside) and the outward normal. */
  function sd(b, x, z) {
    if (b.seg) {
      const [x0, z0, x1, z1] = b.seg, vx = x1 - x0, vz = z1 - z0, l2 = vx * vx + vz * vz || 1;
      let k = ((x - x0) * vx + (z - z0) * vz) / l2;
      k = k < 0 ? 0 : k > 1 ? 1 : k;
      const dx = x - (x0 + vx * k), dz = z - (z0 + vz * k), d = Math.hypot(dx, dz);
      return d > 1e-9 ? { d: d - b.r, nx: dx / d, nz: dz / d } : { d: -b.r, nx: -vz / Math.sqrt(l2), nz: vx / Math.sqrt(l2) };
    }
    const dx = x - b.pos[0], dz = z - b.pos[2], d = Math.hypot(dx, dz);
    return d > 1e-9 ? { d: d - b.r, nx: dx / d, nz: dz / d } : { d: -b.r, nx: 0, nz: 1 };
  }

  /** Buildings of settlements whose bounds (+ pad) reach (x, z). */
  function* candidates(town, x, z, pad) {
    if (!town) return;
    for (const pl of town.places) {
      if (Math.hypot(x - pl.x, z - pl.z) > pl.r + pad + 2) continue;
      for (const b of town.buildings) if (b.place === pl.id && !b.ruin && !(b.gate && !town.gateClosed)) yield b;
    }
  }

  function solidAt(town, x, z, pad) {
    pad = pad || 0;
    let roof = null;
    for (const b of candidates(town, x, z, pad)) {
      if (sd(b, x, z).d > pad) continue;
      const top = topOf(b);
      if (roof == null || top > roof) roof = top;
    }
    return roof;
  }

  /** The height a dragon meets on top of b: the walk top for wall walks and bastions (T03), else the roof. */
  function topOf(b) {
    const wt = D.buildings[b.type].walkTop;
    return b.pos[1] + (wt != null ? wt : b.h);
  }

  /** T03: the walkable top under (x, z) (a wall walk or bastion top) when it is the highest solid there, else null. */
  function surfaceAt(town, x, z, pad) {
    pad = pad || 0;
    let roof = null, walk = false;
    for (const b of candidates(town, x, z, pad)) {
      if (sd(b, x, z).d > pad) continue;
      const top = topOf(b);
      if (roof == null || top > roof + 1e-6) { roof = top; walk = D.buildings[b.type].walkTop != null; }
      else if (Math.abs(top - roof) <= 1e-6 && D.buildings[b.type].walkTop != null) walk = true;
    }
    return walk ? roof : null;
  }

  function hit(town, x, z, pad) {
    pad = pad || 0;
    let best = null;
    for (const b of candidates(town, x, z, pad)) {
      const s = sd(b, x, z), depth = pad - s.d;
      if (depth < 0) continue;
      if (!best || depth > best.depth) best = { b, roof: topOf(b), nx: s.nx, nz: s.nz, depth };
    }
    return best;
  }

  /** Gap between two footprints (0 when they touch or overlap): palisade pieces by their segment ends. */
  function gap(a, b) {
    const pts = o => (o.seg ? [[o.seg[0], o.seg[1]], [o.seg[2], o.seg[3]], [(o.seg[0] + o.seg[2]) / 2, (o.seg[1] + o.seg[3]) / 2]] : [[o.pos[0], o.pos[2]]]);
    let g = Infinity;
    for (const [x, z] of pts(a)) g = Math.min(g, sd(b, x, z).d - a.r);
    for (const [x, z] of pts(b)) g = Math.min(g, sd(a, x, z).d - b.r);
    return Math.max(0, g);
  }

  /** Does the breath cone reach building b? Samples along the stream (every ~2 units), the fire widening with distance
   *  (radius = t x tan(cone) x fire.width), up to the first terrain hit. */
  function inFire(b, cone, regionId) {
    if (!cone || b.ruin) return false;
    const o = cone.origin, d = cone.dir, n = Math.max(4, Math.ceil(cone.range / 2)), tan = Math.tan(cone.cone) * WIDTH;
    for (let i = 0; i <= n; i++) {
      const t = cone.range * i / n, x = o[0] + d[0] * t, y = o[1] + d[1] * t, z = o[2] + d[2] * t;
      if (regionId && i > 0 && y < T.surfaceAt(regionId, x, z) - 1) return false;   // the stream ends in the ground
      const rad = 1 + t * tan;
      if (y < b.pos[1] - rad || y > b.pos[1] + b.h + rad * 0.5) continue;
      if (sd(b, x, z).d <= rad) return true;
    }
    return false;
  }
  const WIDTH = 0.6;                             // the fire reaches buildings over 60% of the prey cone's width

  function ignite(b, ev, spread) {
    b.fire = 1e-3; b.heat = 0;
    ev.push({ e: 'building:burning', id: b.id, type: b.type, place: b.place, pos: b.pos.slice(), spread: !!spread });
  }

  function burn(town, cone, dt, opts) {
    const ev = [];
    if (!town) return ev;
    const F = D.fire, mult = (opts && opts.mult) || 1, rng = (opts && opts.rng) || Math.random, now = (opts && opts.now) || 0;
    const near = {};
    if (cone) for (const pl of town.places) near[pl.id] = Math.hypot(pl.x - cone.origin[0], pl.z - cone.origin[2]) <= cone.range + pl.r + 4;
    const lit = [];
    for (const b of town.buildings) {
      if (b.ruin || D.buildings[b.type].stone) continue;   // T03: stone castle pieces do not burn (charring: T06)
      const hot = !!near[b.place] && inFire(b, cone, town.region);
      if (b.fire > 0) {
        b.fire += dt;
        b.hp -= (F.burn + (hot ? F.fan : 0)) * mult * dt;
        if (b.hp <= 0) {
          const B = D.buildings[b.type];
          b.hp = 0; b.fire = 0; b.heat = 0; b.ruin = true; b.ruinAt = now;
          ev.push({ e: 'building:ruined', id: b.id, type: b.type, place: b.place, pos: b.pos.slice(), civil: !!B.civil, order: !!B.order, at: now });
        } else lit.push(b);
      } else if (hot) {
        b.heat += dt * mult;
        if (b.heat >= F.ignite) ignite(b, ev, false);
      } else if (b.heat > 0) b.heat = Math.max(0, b.heat - F.cool * dt);
    }
    const p = 1 - Math.exp(-F.spread * dt);      // chance per neighbour this frame
    for (const b of lit) for (const j of b.nb || []) {
      const o = town.buildings[j];
      if (o && !o.ruin && !(o.fire > 0) && !D.buildings[o.type].stone && rng() < p) ignite(o, ev, true);
    }
    return ev;
  }

  function rebuild(town, now, blocked) {
    const ev = [];
    for (const b of (town && town.buildings) || []) {
      if (!b.ruin || now - (b.ruinAt || 0) < D.fire.rebuild) continue;
      if (blocked && blocked(b)) continue;
      b.ruin = false; b.ruinAt = null; b.hp = D.buildings[b.type].hp; b.fire = 0; b.heat = 0;
      ev.push({ e: 'building:rebuilt', id: b.id, type: b.type, place: b.place });
    }
    return ev;
  }

  function near(town, x, z, range) {
    let best = null, bd = range;
    for (const pl of (town && town.places) || []) {
      const d = Math.hypot(x - pl.x, z - pl.z);
      if (d <= bd) { bd = d; best = pl; }
    }
    return best;
  }

  M.define('settlement', { build, alert3On, solidAt, surfaceAt, topOf, hit, near, layout, placeIds, burn, rebuild, inFire, sd });
})(typeof self !== 'undefined' ? self : this);
