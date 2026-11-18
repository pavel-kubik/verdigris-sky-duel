/*
 * Verdigris campaign - debug overlay of the basic blocks (Phase 4 T01, ?debug only).
 *   VRender.debugShapes.build() -> { group, update(ctx), pickShow(hit, origin), dispose(), info }
 *   update({ regionId, shapes, x, z, radius, raster, probe }): the shapes of core/shapes.js within radius of (x, z) as coloured
 *     wireframes (one LineSegments): city lots cyan, settlement and castle pieces orange (grey while not solid: a ruin or an
 *     open gate), walk tops green, bridge decks yellow, plateaus violet; the street / square / road / water raster as
 *     points on the ground (one Points); the ground probe as a vertical line under the dragon or hero.
 *   pickShow(hit, origin): the pick ray (white) and the picked shape again in red, or a cross on the ground.
 * At most three draw calls; geometry is rebuilt only when update is called (the game does it every 0.5 s).
 */
(function (root) {
  'use strict';
  const THREE = root.THREE, C = root.VCamp;
  if (!THREE || !C) return;
  const VR = root.VRender = root.VRender || {};
  const T = C.need('terrain'), SH = C.need('shapes');
  const COL = { lot: [0.35, 0.9, 1], building: [1, 0.6, 0.25], off: [0.55, 0.55, 0.55], top: [0.4, 1, 0.45], deck: [1, 0.9, 0.3], plateau: [0.75, 0.5, 1], pick: [1, 0.2, 0.2], probe: [1, 1, 1] };
  const RAS = { street: [0.85, 0.85, 0.85], square: [1, 1, 1], green: [0.4, 0.85, 0.4], road: [0.75, 0.5, 0.25], water: [0.25, 0.55, 1] };
  const SEG = 16;

  /** Plan outline of a footprint as a closed list of [x, z]. */
  function outline(s) {
    const q = s.shape;
    if (q.type === 'box') {
      const c = Math.cos(q.yaw), sn = Math.sin(q.yaw), hu = q.w / 2, hv = q.d / 2;
      // local u (across) and v (along) as in city.sd / terrain.deckAt: x = u c + v s, z = -u s + v c
      return [[-hu, -hv], [hu, -hv], [hu, hv], [-hu, hv]].map(([u, v]) => [q.x + u * c + v * sn, q.z - u * sn + v * c]);
    }
    if (q.type === 'cyl') {
      const out = [];
      for (let i = 0; i < SEG; i++) { const a = i / SEG * Math.PI * 2; out.push([q.x + Math.sin(a) * q.r, q.z + Math.cos(a) * q.r]); }
      return out;
    }
    const [x0, z0, x1, z1] = q.seg, yaw = Math.atan2(x1 - x0, z1 - z0), out = [];
    for (let i = 0; i <= SEG / 2; i++) { const a = yaw + Math.PI / 2 + i / (SEG / 2) * Math.PI; out.push([x0 + Math.sin(a) * q.r, z0 + Math.cos(a) * q.r]); }
    for (let i = 0; i <= SEG / 2; i++) { const a = yaw - Math.PI / 2 + i / (SEG / 2) * Math.PI; out.push([x1 + Math.sin(a) * q.r, z1 + Math.cos(a) * q.r]); }
    return out;
  }

  function wire(pos, col, s, c) {
    const ring = outline(s), n = ring.length;
    const push = (a, ya, b, yb, k) => { pos.push(a[0], ya, a[1], b[0], yb, b[1]); col.push(...k, ...k); };
    const flat = s.kind === 'plateau' || s.kind === 'deck';
    for (let i = 0; i < n; i++) {
      const a = ring[i], b = ring[(i + 1) % n];
      push(a, s.y1 + 0.05, b, s.y1 + 0.05, s.top != null && !flat ? COL.top : c);
      if (!flat) push(a, s.y0, b, s.y0, c);
    }
    if (!flat) { const st = Math.max(1, Math.floor(n / 4)); for (let i = 0; i < n; i += st) push(ring[i], s.y0, ring[i], s.y1, c); }
  }

  function build() {
    const group = new THREE.Group();
    group.name = 'debugShapes';
    const lineMat = new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.9, depthTest: true });
    const pickMat = new THREE.LineBasicMaterial({ vertexColors: true, depthTest: false, transparent: true });
    const ptMat = new THREE.PointsMaterial({ size: 1.6, vertexColors: true, sizeAttenuation: true, transparent: true, opacity: 0.8 });
    const lines = new THREE.LineSegments(new THREE.BufferGeometry(), lineMat);
    const points = new THREE.Points(new THREE.BufferGeometry(), ptMat);
    const pickLines = new THREE.LineSegments(new THREE.BufferGeometry(), pickMat);
    lines.frustumCulled = points.frustumCulled = pickLines.frustumCulled = false;
    pickLines.renderOrder = 10;
    group.add(lines, points, pickLines);
    const info = { shapes: 0, points: 0, drawn: 0 };

    function setGeo(obj, pos, col) {
      obj.geometry.dispose();
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
      g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
      obj.geometry = g;
    }

    function update(ctx) {
      const { regionId, shapes, x, z } = ctx, radius = ctx.radius || 160;
      const pos = [], col = [];
      const near = SH.near(shapes, x, z, radius);
      for (const s of near) wire(pos, col, s, s.kind === 'building' ? (s.solid ? COL.building : COL.off) : COL[s.kind]);
      if (ctx.probe) { const p = ctx.probe; pos.push(p.x, p.y, p.z, p.x, p.ground, p.z); col.push(...COL.probe, ...COL.probe); }
      setGeo(lines, pos, col);
      info.shapes = near.length;
      // raster: streets, squares, greens (city), roads and water, every 4 units around the point
      const pp = [], pc = [], RR = ctx.raster || 100, CI = C.need('city'), R = T.region(regionId), STEP = 4;
      const roads = R.terrain.features.filter(f => f.type === 'road');
      for (let gx = Math.floor((x - RR) / STEP) * STEP; gx <= x + RR; gx += STEP)
        for (let gz = Math.floor((z - RR) / STEP) * STEP; gz <= z + RR; gz += STEP) {
          if (Math.hypot(gx - x, gz - z) > RR) continue;
          let k = null;
          const pv = R.city ? CI.pavedAt(regionId, gx, gz) : 0;
          if (pv === 1) k = RAS.street; else if (pv === 2) k = RAS.square; else if (pv === 3) k = RAS.green;
          else if (T.riverAt(regionId, gx, gz) || T.liquidAt(regionId, gx, gz)) k = RAS.water;
          else for (const f of roads) if (T.nearestOn(f.points, gx, gz).d < f.width / 2) { k = RAS.road; break; }
          if (!k) continue;
          pp.push(gx, T.surfaceAt(regionId, gx, gz) + 0.3, gz); pc.push(...k);
        }
      setGeo(points, pp, pc);
      info.points = pp.length / 3;
      info.drawn = 2 + (pickLines.geometry.attributes.position ? 1 : 0);
    }

    function pickShow(hit, origin) {
      const pos = [], col = [];
      if (hit) {
        if (origin) { pos.push(...origin, ...hit.pos); col.push(1, 1, 1, ...COL.pick); }
        if (hit.shape) wire(pos, col, hit.shape, COL.pick);
        const [px, py, pz] = hit.pos, k = 1.5;
        pos.push(px - k, py, pz, px + k, py, pz, px, py, pz - k, px, py, pz + k, px, py, pz, px, py + 3, pz);
        col.push(...COL.pick, ...COL.pick, ...COL.pick, ...COL.pick, ...COL.pick, ...COL.pick);
      }
      setGeo(pickLines, pos, col);
    }

    function dispose() {
      for (const o of [lines, points, pickLines]) o.geometry.dispose();
      lineMat.dispose(); pickMat.dispose(); ptMat.dispose();
      if (group.parent) group.parent.remove(group);
    }
    return { group, update, pickShow, dispose, info };
  }

  VR.debugShapes = { build };
})(typeof self !== 'undefined' ? self : this);
