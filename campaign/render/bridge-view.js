/*
 * Verdigris campaign - bridges over a region's river (Phase 3 T02): the terrain 'bridge' features.
 * The deck height and footprint come from core terrain.deckAt, so the dragon walks and lands on what is drawn.
 *   stone (Karlsbridge): a deck with parapets on low arches (piers + arch rings), a gate tower at each end;
 *   wood: a plank deck with rails on piles.
 * Everything of one region is merged into one vertex-coloured mesh (1 draw call).
 *   VRender.bridges.build(regionId) -> { group, count, dispose() } | null (no bridges)
 */
(function (root) {
  'use strict';
  const THREE = root.THREE, C = root.VCamp;
  if (!THREE || !C) return;
  const T = C.need('terrain');
  const VR = root.VRender = root.VRender || {};

  const COL = { stone: 0xb3a990, stoneDark: 0x8a816c, pier: 0x9c927a, roof: 0x4c4f58, wood: 0x6e5236, woodDark: 0x4e3a26 };
  const ARCHES = 14, PARAPET = 1.1, TOWER = { w: 12, h: 18, roof: 7 };

  /** Collects transformed, coloured primitives and merges them into one non-indexed geometry. */
  function merger() {
    const pos = [], col = [], c = new THREE.Color(), m = new THREE.Matrix4(), q = new THREE.Quaternion(), v = new THREE.Vector3();
    function add(geo, x, y, z, yaw, sx, sy, sz, hex, tiltX) {
      const g = geo.index ? geo.toNonIndexed() : geo;
      q.setFromEuler(new THREE.Euler(tiltX || 0, yaw, 0, 'YXZ'));
      m.compose(new THREE.Vector3(x, y, z), q, new THREE.Vector3(sx, sy, sz));
      const p = g.attributes.position;
      c.set(hex);
      for (let i = 0; i < p.count; i++) {
        v.fromBufferAttribute(p, i).applyMatrix4(m);
        pos.push(v.x, v.y, v.z);
        const shade = 0.92 + 0.08 * Math.sin(i * 1.7 + x * 0.3);
        col.push(c.r * shade, c.g * shade, c.b * shade);
      }
      if (g !== geo) g.dispose();
    }
    function geometry() {
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
      geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
      geo.computeVertexNormals(); geo.computeBoundingSphere();
      return geo;
    }
    return { add, geometry, get count() { return pos.length / 9; } };
  }

  function stone(id, f, y, M, box, cyl, cone) {
    const s = Math.sin(f.yaw), c = Math.cos(f.yaw), at = v => [f.x + s * v, f.z + c * v];
    // deck and parapets
    M.add(box, f.x, y - 0.9, f.z, f.yaw, f.width, 1.8, f.len, COL.stone);
    for (const side of [-1, 1]) {
      const ox = c * side * (f.width / 2 - 0.4), oz = -s * side * (f.width / 2 - 0.4);
      M.add(box, f.x + ox, y + PARAPET / 2, f.z + oz, f.yaw, 0.8, PARAPET, f.len, COL.stoneDark);
    }
    // piers between the arches, down to the river bed; the arch rings under the deck
    const span = f.len / ARCHES;
    for (let k = 0; k <= ARCHES; k++) {
      const v = -f.len / 2 + k * span, [x, z] = at(v), bed = T.meshAt(id, x, z) - 1;
      const h = y - 1.8 - bed;
      if (h > 0.5) M.add(box, x, bed + h / 2, z, f.yaw, f.width * 0.9, h, span * 0.28, COL.pier);
      if (k < ARCHES) {
        const [ax, az] = at(v + span / 2);
        M.add(cyl, ax, y - 1.8 - span * 0.18, az, f.yaw + Math.PI / 2, span * 0.36, f.width * 0.86, span * 0.36, COL.stoneDark, Math.PI / 2);
      }
    }
    // gate towers on the two ends
    if (f.towers) for (const e of [-1, 1]) {
      const [x, z] = at(e * (f.len / 2 + TOWER.w * 0.35)), g = T.meshAt(id, x, z);
      const base = Math.min(g, y) - 1, h = y + TOWER.h - base;
      for (const side of [-1, 1]) {                              // two legs with the gateway between them
        const ox = c * side * (f.width / 2 + 1), oz = -s * side * (f.width / 2 + 1);
        M.add(box, x + ox, base + h / 2, z + oz, f.yaw, 3.2, h, TOWER.w * 0.7, COL.stone);
      }
      M.add(box, x, y + TOWER.h * 0.62, z, f.yaw, f.width + 5.4, TOWER.h * 0.76, TOWER.w * 0.7, COL.stone);
      M.add(cone, x, y + TOWER.h + TOWER.roof / 2, z, f.yaw + Math.PI / 4, (f.width + 5.4) * 0.75, TOWER.roof, TOWER.w * 0.55, COL.roof);
    }
  }

  function wood(id, f, y, M, box, cyl) {
    const s = Math.sin(f.yaw), c = Math.cos(f.yaw), at = v => [f.x + s * v, f.z + c * v];
    M.add(box, f.x, y - 0.4, f.z, f.yaw, f.width, 0.8, f.len, COL.wood);
    for (const side of [-1, 1]) {
      const ox = c * side * (f.width / 2 - 0.2), oz = -s * side * (f.width / 2 - 0.2);
      M.add(box, f.x + ox, y + 0.9, f.z + oz, f.yaw, 0.3, 0.3, f.len, COL.woodDark);
    }
    const n = Math.max(3, Math.round(f.len / 7));
    for (let k = 0; k <= n; k++) {
      const v = -f.len / 2 + k * f.len / n;
      for (const side of [-1, 1]) {
        const [x0, z0] = at(v), x = x0 + c * side * f.width * 0.42, z = z0 - s * side * f.width * 0.42;
        const bed = T.meshAt(id, x, z) - 1, h = y + 1 - bed;
        M.add(cyl, x, bed + h / 2, z, 0, 0.45, h, 0.45, COL.woodDark);
      }
    }
  }

  function build(id) {
    const list = T.region(id).terrain.features.filter(f => f.type === 'bridge');
    if (!list.length) return null;
    const box = new THREE.BoxGeometry(1, 1, 1), cyl = new THREE.CylinderGeometry(1, 1, 1, 8, 1), cone = new THREE.ConeGeometry(1, 1, 4, 1);
    const M = merger();
    for (const f of list) {
      const y = T.deckAt(id, f.x, f.z).y;
      if (f.kind === 'wood') wood(id, f, y, M, box, cyl); else stone(id, f, y, M, box, cyl, cone);
    }
    box.dispose(); cyl.dispose(); cone.dispose();
    const group = new THREE.Group(); group.name = 'bridges:' + id;
    const mesh = new THREE.Mesh(M.geometry(), new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 0.95 }));
    group.add(mesh);
    return {
      group, count: list.length, triangles: M.count,
      dispose() { mesh.geometry.dispose(); mesh.material.dispose(); if (group.parent) group.parent.remove(group); },
    };
  }

  VR.bridges = { build };
})(typeof self !== 'undefined' ? self : this);
