/*
 * Verdigris campaign - corn fields that burn and pop (Pavel's request, 2026-10-31).
 * Fields come from terrain.fields (T11); crop kind data.corn.crop is corn: tall stalks in rows.
 *   ids(regionId) -> [{ id, f }]               the region's corn fields, id '<region>.corn<n>' (n = index in terrain.fields)
 *   build(regionId, rs?) -> crops               { region, list: [{ id, f, heat, burn: null | { ig: [x, z], r, max }, burnedAt }] }
 *                                               rs.corn [{ id, at }] marks fields burned at play time `at`
 *   inField(f, x, z, pad?) -> bool              (x, z) inside field f (+ pad)
 *   hot(c, cone, regionId) -> [x, z] | null     where the breath stream reaches the stalks of corn field c (null: it does not)
 *   step(crops, cone, dt, now) -> events[]      breath on a field heats it (`ignite` s: 'corn:burning' at that spot); a fire
 *                                               front runs out from there at `spread` units/s (burn.r) until it has crossed
 *                                               the field ('corn:burned', burnedAt = now); burned fields grow back after
 *                                               `regrow` s ('corn:regrown'). Popcorn is drawn where the front is.
 *   state(c, x, z) -> 'corn' | 'popping' | 'burned'   one spot of a field (the renderer's stalks)
 * Pure: no DOM, no THREE.
 */
(function (root) {
  'use strict';
  const M = typeof module === 'object' && module.exports ? require('./umd.js') : root.VCamp;
  const D = M.need('data'), T = M.need('terrain');

  function ids(regionId) {
    const out = [];
    T.fields(regionId).forEach((f, i) => { if (f.crop === D.corn.crop) out.push({ id: regionId + '.corn' + i, f }); });
    return out;
  }

  function maxDist(f, x, z) {                      // farthest field corner from (x, z): the front has crossed it all
    const s = Math.sin(f.yaw), c = Math.cos(f.yaw);
    let m = 0;
    for (const [u, v] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
      const a = u * f.w / 2, b = v * f.l / 2;
      m = Math.max(m, Math.hypot(f.x + a * c + b * s - x, f.z - a * s + b * c - z));
    }
    return m;
  }

  function build(regionId, rs) {
    const burned = {};
    for (const r of (rs && rs.corn) || []) if (r && r.id) burned[r.id] = r.at || 0;
    return { region: regionId, list: ids(regionId).map(({ id, f }) => ({ id, f, heat: 0, burn: null, burnedAt: id in burned ? burned[id] : null })) };
  }

  function inField(f, x, z, pad) {
    pad = pad || 0;
    const dx = x - f.x, dz = z - f.z, s = Math.sin(f.yaw), c = Math.cos(f.yaw);
    return Math.abs(dx * c - dz * s) < f.w / 2 + pad && Math.abs(dx * s + dz * c) < f.l / 2 + pad;
  }

  function hot(c, cone, regionId) {
    if (!cone || c.burnedAt != null) return null;
    const f = c.f, o = cone.origin, d = cone.dir;
    if (Math.hypot(f.x - o[0], f.z - o[2]) > cone.range + Math.hypot(f.w, f.l) / 2) return null;
    const n = Math.max(4, Math.ceil(cone.range / 2)), tan = Math.tan(cone.cone) * 0.6, top = D.corn.height;
    for (let i = 1; i <= n; i++) {
      const t = cone.range * i / n, x = o[0] + d[0] * t, y = o[1] + d[1] * t, z = o[2] + d[2] * t;
      const g = T.surfaceAt(regionId, x, z);
      if (y < g - 1) return null;                 // the stream ends in the ground (before reaching the field)
      if (y - (1 + t * tan) > g + top) continue;  // still above the stalks
      if (inField(f, x, z)) return [x, z];
    }
    return null;
  }

  function step(crops, cone, dt, now) {
    const ev = [], C = D.corn;
    if (!crops) return ev;
    for (const c of crops.list) {
      if (c.burnedAt != null) {
        if (now - c.burnedAt >= C.regrow) { c.burnedAt = null; c.heat = 0; ev.push({ e: 'corn:regrown', id: c.id }); }
        continue;
      }
      if (c.burn) {
        c.burn.r += C.spread * dt;
        if (c.burn.r >= c.burn.max) {
          c.burn = null; c.heat = 0; c.burnedAt = now;
          ev.push({ e: 'corn:burned', id: c.id, at: now });
        }
        continue;
      }
      const at = hot(c, cone, crops.region);
      if (at) {
        c.heat += dt;
        if (c.heat >= C.ignite) {
          c.burn = { ig: at, r: 2, max: maxDist(c.f, at[0], at[1]) + C.band };
          ev.push({ e: 'corn:burning', id: c.id, pos: [at[0], T.surfaceAt(crops.region, at[0], at[1]), at[1]] });
        }
      } else if (c.heat > 0) c.heat = Math.max(0, c.heat - C.cool * dt);
    }
    return ev;
  }

  function state(c, x, z) {
    if (c.burnedAt != null) return 'burned';
    if (!c.burn) return 'corn';
    const d = Math.hypot(x - c.burn.ig[0], z - c.burn.ig[1]);
    return d < c.burn.r - D.corn.band ? 'burned' : d < c.burn.r ? 'popping' : 'corn';
  }

  M.define('crops', { ids, build, inField, hot, step, state });
})(typeof self !== 'undefined' ? self : this);
