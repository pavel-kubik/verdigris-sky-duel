/*
 * Verdigris campaign - region edges and travel between regions.
 *   exitAt(regionId, pos, yaw) -> exit | null   dragon near the edge, heading outward, inside an exit arc
 *   softEdgeAt(regionId, pos, fallback)          flight soft-boundary width: narrower inside an exit arc
 *   entryPoint(toId, fromId, alt) -> { pos, yaw } where a dragon coming from fromId appears in toId
 *   enter(cs, toId, fromId) -> events[]          swaps cs to the new region: places the dragon at the entry edge
 *                                                facing inward, spawns a fresh prey field, keeps the carried prey
 * Angles are measured around +Y with 0 = +Z (the same convention as yaw). See 001_task_survival.md 4.4 and 5.6.
 */
(function (root) {
  'use strict';
  const M = typeof module === 'object' && module.exports ? require('./umd.js') : root.VCamp;
  const D = M.need('data'), T = M.need('terrain'), PR = M.need('prey');
  const { wrap, clamp } = M.need('math');

  /** True if angle a lies on the arc from..to (both wrapped, arc taken counter-clockwise from `from`). */
  function inArc(a, from, to) {
    const span = wrap(to - from) < 0 ? wrap(to - from) + Math.PI * 2 : wrap(to - from);
    let k = wrap(a - from);
    if (k < 0) k += Math.PI * 2;
    return k <= span;
  }

  function exitAt(regionId, pos, yaw) {
    const R = T.region(regionId), G = D.travel;
    if (!R.exits || !R.exits.length) return null;
    const r = Math.hypot(pos[0], pos[2]);
    if (r < R.radius - G.edgeBand || r < 1) return null;
    const a = Math.atan2(pos[0], pos[2]);
    // heading outward: the horizontal heading points away from the centre
    if (Math.cos(wrap(yaw - a)) < G.outwardCos) return null;
    return arcAt(regionId, pos);
  }

  /** Bearing of the middle of an exit arc. */
  function arcMid(e) {
    let span = e.angleTo - e.angleFrom;
    span = ((span % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2);
    return wrap(e.angleFrom + span / 2);
  }

  /** The exit whose arc contains the dragon's bearing from the centre (any heading, any distance), or null. */
  function arcAt(regionId, pos) {
    const R = T.region(regionId);
    if (!R.exits) return null;
    const a = Math.atan2(pos[0], pos[2]);
    for (const e of R.exits) if (inArc(a, e.angleFrom, e.angleTo)) return e;
    return null;
  }

  /** Width of the flight soft boundary here: narrower in front of an exit, so the dragon can reach it. */
  function softEdgeAt(regionId, pos, fallback) {
    return arcAt(regionId, pos) ? D.travel.softEdge : fallback;
  }

  /** Entry placement: on the entry angle, `inset` inside the radius, `alt` above the ground, facing the centre. */
  function entryPoint(toId, fromId, alt) {
    const R = T.region(toId), G = D.travel;
    const en = R.entries && R.entries[fromId];
    const a = en ? en.angle : 0;
    const r = R.radius - G.entryInset;
    const x = Math.sin(a) * r, z = Math.cos(a) * r;
    const ground = T.surfaceAt(toId, x, z);
    const y = clamp(ground + (alt == null ? G.entryAlt : clamp(alt, G.entryAlt * 0.5, G.entryAlt * 2)), ground + D.flight.minAlt, R.ceiling - 15);
    return { pos: [x, y, z], yaw: wrap(a + Math.PI) };
  }

  /**
   * Moves cs into region toId. The pilot keeps its speed and fire; a carried prey travels along
   * (re-homed into the new field without a herd). Returns events (region:enter).
   */
  function enter(cs, toId, fromId) {
    T.region(toId);                                              // throws on an unknown id
    const d = cs.dragon, p = d.pilot;
    const carried = d.carried == null || !cs.field ? null : PR.byId(cs.field, d.carried);
    const alt = p ? p.pos[1] - T.surfaceAt(cs.region, p.pos[0], p.pos[2]) : null;
    const at = entryPoint(toId, fromId, alt);
    cs.region = toId;
    cs.field = PR.spawnRegion(toId, cs.rng, at.pos);
    d.carried = null; d.eatT = 0;
    if (carried) {
      carried.id = cs.field.nextId++; carried.herd = 0;
      carried.pos = at.pos.slice();
      cs.field.list.push(carried);
      d.carried = carried.id;
    }
    if (p) {
      p.pos = at.pos; p.yaw = at.yaw; p.pitch = 0; p.roll = 0; p.rollT = 0; p.rollX = 0;
      p.vel = [0, 0, 0];
    }
    cs.exit = null; cs.exitT = 0; cs.swoop = null; cs.target = null; cs.breath = null; cs.fire = null;
    return [{ e: 'region:enter', region: toId, from: fromId }];
  }

  M.define('region', { exitAt, arcAt, arcMid, softEdgeAt, entryPoint, enter, inArc });
})(typeof self !== 'undefined' ? self : this);
