/*
 * Verdigris campaign - region alert (Phase 2 T17, 002_task_kingdom.md 4.5 and 5.5).
 *   rs = a region state (cs.regionStates[id]): { heat, lastIncident, at } (+ ruins, corn ...), times = stats.played s
 *   level(rs) -> 0..maxLevel          floor(heat), clamped
 *   add(rs, kind, now, amount?) -> events[]   heat += alert.add[kind] (or amount), clamped to maxHeat; lastIncident = now;
 *                                     'alert:level' { level, from, kind } when the level changes
 *   step(rs, dt, now, { towerDown }) -> events[]   once `quiet` s have passed since the last incident the heat decays by
 *                                     `decay` per s (x towerDownMult while a watchtower lies in ruins); rs.at = now
 *   catchUp(rs, now, { towerDown }) -> events[]   the decay a region missed since rs.at (the dragon was elsewhere or in a
 *                                     save): the same rule as step over the gap, in one go
 *   responses(level) -> { extraArchers, patrols, villageBallista, livestockInside, bellFast }   cumulative over levels
 *   towerDown(rs | town) -> bool      a building with calmsAlert (watchtower) of the region lies in ruins
 * Pure: no DOM, no THREE.
 */
(function (root) {
  'use strict';
  const M = typeof module === 'object' && module.exports ? require('./umd.js') : root.VCamp;
  const D = M.need('data');

  const A = () => D.alert;
  const num = v => typeof v === 'number' && isFinite(v);

  function level(rs) {
    const h = rs && num(rs.heat) ? rs.heat : 0;
    return Math.max(0, Math.min(A().maxLevel, Math.floor(h)));
  }

  function setHeat(rs, h, kind) {
    const from = level(rs);
    rs.heat = Math.max(0, Math.min(A().maxHeat, h));
    const to = level(rs);
    return to !== from ? [{ e: 'alert:level', level: to, from, kind: kind || null }] : [];
  }

  function add(rs, kind, now, amount) {
    if (!rs) return [];
    const k = amount != null ? amount : A().add[kind];
    if (!num(k) || k <= 0) return [];
    rs.lastIncident = now;
    if (!num(rs.at)) rs.at = now;
    return setHeat(rs, (num(rs.heat) ? rs.heat : 0) + k, kind);
  }

  /** Heat lost between t0 and t1 under the quiet rule (decay starts lastIncident + quiet). */
  function decayed(rs, t0, t1, ctx) {
    const start = Math.max(t0, (num(rs.lastIncident) ? rs.lastIncident : -Infinity) + A().quiet);
    const s = t1 - start;
    if (!(s > 0)) return 0;
    return s * A().decay * (ctx && ctx.towerDown ? A().towerDownMult : 1);
  }

  function step(rs, dt, now, ctx) {
    if (!rs) return [];
    const t0 = num(rs.at) ? rs.at : now - dt;
    rs.at = now;
    if (!(rs.heat > 0)) return [];
    const loss = decayed(rs, Math.min(t0, now), now, ctx);
    return loss > 0 ? setHeat(rs, rs.heat - loss, 'decay') : [];
  }

  function catchUp(rs, now, ctx) {
    if (!rs) return [];
    const t0 = num(rs.at) ? rs.at : now;
    rs.at = now;
    if (!(rs.heat > 0) || !(now > t0)) return [];
    return setHeat(rs, rs.heat - decayed(rs, t0, now, ctx), 'decay');
  }

  function responses(lv) {
    const out = { extraArchers: 0, patrols: 0, villageBallista: false, livestockInside: false, bellFast: false };
    for (let i = 1; i <= lv; i++) Object.assign(out, A().responses[i] || {});
    return out;
  }

  /** A watchtower (building type with calmsAlert) lies in ruins: from a town (b.ruin) or a region state (rs.ruins ids). */
  function towerDown(x) {
    if (!x) return false;
    if (Array.isArray(x.buildings)) return x.buildings.some(b => (b.ruin || b.char) && D.buildings[b.type] && D.buildings[b.type].calmsAlert);
    return (x.ruins || []).some(r => {
      const m = /\.([a-z]+)\d+$/.exec(r && r.id || '');
      return !!(m && D.buildings[m[1]] && D.buildings[m[1]].calmsAlert);
    });
  }

  M.define('alert', { level, add, step, catchUp, responses, towerDown });
})(typeof self !== 'undefined' ? self : this);
