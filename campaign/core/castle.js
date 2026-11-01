/*
 * Verdigris campaign - castle layout (Phase 3 T01; solids, walk tops, gate and posts come in T03).
 * Pure: no DOM, no THREE.
 *   castle.layout(def?) -> { corners, segments, buildings, centre, radius }
 *     def = data.settlements.castle (default). Local frame: +X = east, +Z = north, origin = the castle centre.
 *     corners[i]  = { type, x, z, yaw, r }        the piece at walls[i]; yaw points outward (away from the centroid)
 *     segments[i] = { a: [x, z], b: [x, z], len, yaw, gate, from, to }   wall runs between the corner pieces,
 *                   shortened by each corner's radius; yaw = direction a -> b (atan2(dx, dz)); gate = the gate gap
 *                   (between two gatehouses) - a gate segment is the portcullis gap of data.castle.gate.w plus wall
 *                   stubs on each side
 *     buildings[] = { type, x, z, yaw, r, h }     inner buildings, facing the gate side (+X)
 */
(function (root) {
  'use strict';
  const M = typeof module === 'object' && module.exports ? require('./umd.js') : root.VCamp;
  const D = M.need('data');

  function layout(def) {
    def = def || D.settlements.castle;
    const W = def.walls, n = W.length;
    let cx = 0, cz = 0;
    for (const [x, z] of W) { cx += x / n; cz += z / n; }
    const corners = W.map(([x, z], i) => {
      const type = def.corners[i], B = D.buildings[type];
      return { type, x, z, yaw: Math.atan2(x - cx, z - cz), r: B.r };
    });
    const segments = [];
    for (let i = 0; i < n; i++) {
      const c0 = corners[i], c1 = corners[(i + 1) % n];
      const dx = c1.x - c0.x, dz = c1.z - c0.z, L = Math.hypot(dx, dz), ux = dx / L, uz = dz / L;
      const a = [c0.x + ux * c0.r * 0.8, c0.z + uz * c0.r * 0.8], b = [c1.x - ux * c1.r * 0.8, c1.z - uz * c1.r * 0.8];
      const gate = !!(D.buildings[c0.type].gate && D.buildings[c1.type].gate);
      segments.push({ a, b, len: Math.hypot(b[0] - a[0], b[1] - a[1]), yaw: Math.atan2(ux, uz), gate, from: i, to: (i + 1) % n });
    }
    const buildings = def.buildings.map(([type, x, z]) => {
      const B = D.buildings[type];
      return { type, x, z, yaw: Math.PI / 2, r: B.r, h: B.h };
    });
    let radius = 0;
    for (const c of corners) radius = Math.max(radius, Math.hypot(c.x - cx, c.z - cz) + c.r);
    return { corners, segments, buildings, centre: [cx, cz], radius };
  }

  /** Inside test for the wall polygon (local frame). */
  function inside(def, x, z) {
    const W = (def || D.settlements.castle).walls;
    let inn = false;
    for (let i = 0, j = W.length - 1; i < W.length; j = i++) {
      const [xi, zi] = W[i], [xj, zj] = W[j];
      if ((zi > z) !== (zj > z) && x < (xj - xi) * (z - zi) / (zj - zi) + xi) inn = !inn;
    }
    return inn;
  }

  M.define('castle', { layout, inside });
})(typeof window !== 'undefined' ? window : globalThis);
