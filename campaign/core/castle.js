/*
 * Verdigris campaign - castle layout (Phase 3 T01) and castle solids (T03, 003 spec 5.2).
 * Pure: no DOM, no THREE.
 *   castle.layout(def?) -> { corners, segments, buildings, centre, radius, gate }
 *     def = data.settlements.castle (default). Local frame: +X = east, +Z = north, origin = the castle centre.
 *     corners[i]  = { type, x, z, yaw, r }        the piece at walls[i]; yaw points outward (away from the centroid)
 *     segments[i] = { a: [x, z], b: [x, z], len, yaw, gate, from, to }   wall runs between the corner pieces,
 *                   shortened by each corner's radius; yaw = direction a -> b (atan2(dx, dz)); gate = the gate gap
 *                   (between two gatehouses) - a gate segment is the portcullis gap of data.castle.gate.w plus wall
 *                   stubs on each side
 *     buildings[] = { type, x, z, yaw, r, h }     inner buildings, facing the gate side (+X)
 *     segments also carry h and walkTop (data.buildings.wall); gate = { a, b, w, seg } the portcullis gap (local frame)
 *   castle.pieces(def?) -> [{ type, x, z, r, h, seg?, gate?, inner? }]   T03: the solids of the castle in its local frame:
 *     corner pieces and inner buildings (cylinders), wall runs (seg [x0, z0, x1, z1], capsules of wallThick / 2;
 *     the gate run becomes two stubs and a 'portcullis' piece with gate: true, solid only while the gate is closed)
 *   castle.closeGate(town) / openGate(town)    T03: town.gateClosed (the portcullis is a solid while it is set)
 *   castle.gateOpen(town) -> bool
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
      segments.push({ a, b, len: Math.hypot(b[0] - a[0], b[1] - a[1]), yaw: Math.atan2(ux, uz), gate, from: i, to: (i + 1) % n,
                      h: D.buildings.wall.h, walkTop: D.buildings.wall.walkTop });
    }
    let gateGap = null;
    segments.forEach((s, i) => {
      if (!s.gate) return;
      const w = Math.min(D.castle.gate.w, s.len), mx = (s.a[0] + s.b[0]) / 2, mz = (s.a[1] + s.b[1]) / 2;
      const ux = (s.b[0] - s.a[0]) / s.len, uz = (s.b[1] - s.a[1]) / s.len;
      gateGap = { a: [mx - ux * w / 2, mz - uz * w / 2], b: [mx + ux * w / 2, mz + uz * w / 2], w, seg: i };
    });
    const buildings = def.buildings.map(([type, x, z]) => {
      const B = D.buildings[type];
      return { type, x, z, yaw: Math.PI / 2, r: B.r, h: B.h };
    });
    let radius = 0;
    for (const c of corners) radius = Math.max(radius, Math.hypot(c.x - cx, c.z - cz) + c.r);
    return { corners, segments, buildings, centre: [cx, cz], radius, gate: gateGap };
  }

  /** T03: solid pieces in the local frame (see the header). */
  function pieces(def) {
    const L = layout(def), out = [], C = D.castle, wr = C.wallThick / 2, Wb = D.buildings.wall;
    for (const c of L.corners) out.push({ type: c.type, x: c.x, z: c.z, r: c.r, h: D.buildings[c.type].h });
    const run = (type, a, b, extra) => {
      const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
      if (len < 0.5) return;
      out.push(Object.assign({ type, x: (a[0] + b[0]) / 2, z: (a[1] + b[1]) / 2, r: wr, h: D.buildings[type].h,
                               seg: [a[0], a[1], b[0], b[1]], len }, extra || {}));
    };
    L.segments.forEach((s, i) => {
      if (L.gate && L.gate.seg === i) {
        run('wall', s.a, L.gate.a);
        run('portcullis', L.gate.a, L.gate.b, { gate: true });
        run('wall', L.gate.b, s.b);
      } else run('wall', s.a, s.b);
    });
    for (const b of L.buildings) out.push({ type: b.type, x: b.x, z: b.z, r: b.r, h: b.h, inner: true });
    return out;
  }

  function closeGate(town) { if (town) town.gateClosed = true; return town; }
  function openGate(town) { if (town) town.gateClosed = false; return town; }
  const gateOpen = town => !(town && town.gateClosed);

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

  M.define('castle', { layout, inside, pieces, closeGate, openGate, gateOpen });
})(typeof window !== 'undefined' ? window : globalThis);
