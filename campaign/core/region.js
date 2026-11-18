/*
 * Verdigris campaign - region edges and the way between regions.
 * One world (core/terrain.js zones): the regions are squares side by side; a region's exits are its open sides
 * ({ to, side: 'n' | 's', minStage? }). There is no travel prompt: flying (or walking) over the shared edge moves the
 * dragon into the next region at once (cross: the same place in the new region's frame, nothing teleports). A side
 * whose region needs a bigger dragon (minStage) is a wall for a smaller one: the flight steers back from it (bound)
 * and a prompt says it is too small (exitAt while heading for it). The world's outer sides are a soft wall too.
 *   exitAt(regionId, pos, yaw) -> exit | null   near an exit side (within travel.edgeBand), heading outward
 *   arcAt(regionId, pos) -> exit | null         the exit on the side the dragon is nearest to
 *   arcMid(e) -> bearing of an exit's side (0 = north, PI = south); exitPoint(regionId, e, inset?) -> [x, z] the pass over it
 *   bound(regionId, pos, stage) -> { d, nx, nz } distance to the nearest wall the dragon may not pass (world edge or a
 *                                                region it is too small for) and the inward direction from it
 *   crossAt(regionId, pos) -> regionId | null    the region the dragon has moved into (past its own square), or null
 *   cross(cs, toId) -> events[]                  moves cs into toId keeping the dragon where it is (a new frame),
 *                                                a fresh prey field (the carried prey comes along); region:enter
 *   entryPoint(toId, fromId, alt) -> { pos, yaw } inside toId's edge facing fromId, `entryInset` in, facing inward
 *   enter(cs, toId, fromId) -> events[]          jumps cs to the new region at its entry point (debug, tests, saves)
 * A region without an origin (the deathmatch arena) has no exits: a circle with a soft rim.
 * Angles are measured around +Y with 0 = +Z (the same convention as yaw). See 001_task_survival.md 4.4 and 5.6.
 */
(function (root) {
  'use strict';
  const M = typeof module === 'object' && module.exports ? require('./umd.js') : root.VCamp;
  const D = M.need('data'), T = M.need('terrain'), PR = M.need('prey');
  const { wrap, clamp } = M.need('math');

  const SIDE = { n: 0, s: Math.PI };
  /** True if angle a lies on the arc from..to (both wrapped, arc taken counter-clockwise from `from`). */
  function inArc(a, from, to) {
    const span = wrap(to - from) < 0 ? wrap(to - from) + Math.PI * 2 : wrap(to - from);
    let k = wrap(a - from);
    if (k < 0) k += Math.PI * 2;
    return k <= span;
  }

  /** Bearing of an exit's side. */
  function arcMid(e) { return SIDE[e.side] != null ? SIDE[e.side] : 0; }
  /** The way over an exit's edge: [x, z] on the edge (inset inside it) at the exit's `x` (the natural pass, e.g. where the
      Vltava crosses; 0 = the middle). Guides (the compass, the mother, the test pilots) aim here. */
  function exitPoint(regionId, e, inset) {
    const R = T.region(regionId), r = R.radius - (inset || 0);
    if (!R.origin) { const a = arcMid(e); return [Math.sin(a) * r, Math.cos(a) * r]; }
    return [e.x || 0, e.side === 's' ? -r : r];
  }

  /** The exit on the side (north or south) the dragon is nearest to, or null. */
  function arcAt(regionId, pos) {
    const R = T.region(regionId);
    if (!R.exits || !R.origin) return null;
    const side = pos[2] >= 0 ? 'n' : 's';
    if (Math.abs(pos[2]) < Math.abs(pos[0])) return null;        // nearer the west or east edge
    return R.exits.find(e => e.side === side) || null;
  }

  function exitAt(regionId, pos, yaw) {
    const R = T.region(regionId), G = D.travel;
    if (!R.exits || !R.exits.length || !R.origin) return null;
    const e = arcAt(regionId, pos);
    if (!e || R.radius - Math.abs(pos[2]) > G.edgeBand) return null;
    if (Math.cos(wrap(yaw - arcMid(e))) < G.outwardCos) return null;   // heading outward
    return e;
  }

  /** Kept for callers of the old edge arcs: the soft edge is the same everywhere now. */
  function softEdgeAt(regionId, pos, fallback) { return fallback; }

  /** The z range (world) the dragon may fly in from regionId at this stage: the regions reachable over open exits. */
  function reach(regionId, stage) {
    const R = T.region(regionId);
    let lo = R.origin[1] - R.radius, hi = R.origin[1] + R.radius;
    for (const side of ['n', 's']) {
      let id = regionId;
      for (let k = 0; k < 20; k++) {
        const e = (T.region(id).exits || []).find(x => x.side === side);
        if (!e || (e.minStage != null && stage != null && stage < e.minStage) || !D.regions[e.to]) break;
        id = e.to;
        const Q = T.region(id);
        if (side === 'n') hi = Q.origin[1] + Q.radius; else lo = Q.origin[1] - Q.radius;
      }
    }
    return [lo, hi];
  }

  function bound(regionId, pos, stage) {
    const R = T.region(regionId);
    if (!R.origin) {
      const r = Math.hypot(pos[0], pos[2]) || 1e-6;
      return { d: R.radius - r, nx: -pos[0] / r, nz: -pos[2] / r };
    }
    const [X, Z] = T.toWorld(regionId, pos[0], pos[2]), w = T.worldRect(), [lo, hi] = reach(regionId, stage);
    const c = [[X - w.x0, -1, 0], [w.x1 - X, 1, 0], [Z - lo, 0, -1], [hi - Z, 0, 1]];   // (distance, outward x, outward z)
    let best = c[0];
    for (const q of c) if (q[0] < best[0]) best = q;
    return { d: best[0], nx: -best[1], nz: -best[2] };
  }

  function crossAt(regionId, pos) {
    const R = T.region(regionId);
    if (!R.origin || T.inZone(regionId, pos[0], pos[2])) return null;
    const [X, Z] = T.toWorld(regionId, pos[0], pos[2]), id = T.zoneAt(X, Z);
    return id && id !== regionId ? id : null;
  }

  /** Re-homes the prey in the claws into the new field (no herd) at pos. */
  function rehome(cs, carried, pos) {
    const d = cs.dragon;
    d.carried = null; d.eatT = 0;
    if (!carried) return;
    carried.id = cs.field.nextId++; carried.herd = 0;
    carried.pos = pos.slice();
    cs.field.list.push(carried);
    d.carried = carried.id;
  }

  function cross(cs, toId) {
    const from = cs.region, d = cs.dragon, p = d.pilot;
    const carried = d.carried == null || !cs.field ? null : PR.byId(cs.field, d.carried);
    const a = T.origin(from), b = T.origin(toId), dx = a[0] - b[0], dz = a[1] - b[1];
    if (p) { p.pos[0] += dx; p.pos[2] += dz; }
    if (cs.mom && cs.mom.pos) { cs.mom.pos[0] += dx; cs.mom.pos[2] += dz; }      // the mother flies on beside it
    cs.region = toId; cs.inAerie = null;
    cs.field = PR.spawnRegion(toId, cs.rng, p ? p.pos : null);
    rehome(cs, carried, p ? p.pos : [0, 0, 0]);
    cs.exit = null; cs.exitT = 0; cs.swoop = null; cs.target = null; cs.fireMem = null;
    return [{ e: 'region:enter', region: toId, from, seamless: true, shift: [dx, dz] }];
  }

  /** Entry placement: on the side of toId facing fromId, `inset` inside its edge, `alt` above the ground, facing inward. */
  function entryPoint(toId, fromId, alt) {
    const R = T.region(toId), G = D.travel;
    let a = 0;
    if (R.origin && fromId && D.regions[fromId] && D.regions[fromId].origin) a = D.regions[fromId].origin[1] >= R.origin[1] ? 0 : Math.PI;
    else { const e = (R.exits || []).find(x => x.to === fromId); if (e) a = arcMid(e); }
    const r = R.radius - G.entryInset;
    const x = Math.sin(a) * r, z = Math.cos(a) * r;
    const ground = T.surfaceAt(toId, x, z);
    const y = clamp(ground + (alt == null ? G.entryAlt : clamp(alt, G.entryAlt * 0.5, G.entryAlt * 2)), ground + D.flight.minAlt, R.ceiling - 15);
    return { pos: [x, y, z], yaw: wrap(a + Math.PI) };
  }

  /**
   * Jumps cs into region toId at its entry point. The pilot keeps its speed and fire; a carried prey travels along
   * (re-homed into the new field without a herd). Returns events (region:enter).
   */
  function enter(cs, toId, fromId) {
    T.region(toId);                                              // throws on an unknown id
    const d = cs.dragon, p = d.pilot;
    const carried = d.carried == null || !cs.field ? null : PR.byId(cs.field, d.carried);
    const alt = p ? p.pos[1] - T.surfaceAt(cs.region, p.pos[0], p.pos[2]) : null;
    const at = entryPoint(toId, fromId, alt);
    cs.region = toId; cs.inAerie = null;                         // Phase 3 T08
    cs.field = PR.spawnRegion(toId, cs.rng, at.pos);
    rehome(cs, carried, at.pos);
    if (p) {
      p.pos = at.pos; p.yaw = at.yaw; p.pitch = 0; p.roll = 0; p.rollT = 0; p.rollX = 0;
      p.vel = [0, 0, 0];
    }
    cs.exit = null; cs.exitT = 0; cs.exitSmall = null; cs.exitSmallT = 0; cs.swoop = null; cs.target = null; cs.breath = null; cs.fire = null; cs.fireMem = null;
    return [{ e: 'region:enter', region: toId, from: fromId }];
  }

  M.define('region', { exitAt, arcAt, arcMid, exitPoint, softEdgeAt, bound, crossAt, cross, entryPoint, enter, inArc });
})(typeof self !== 'undefined' ? self : this);
