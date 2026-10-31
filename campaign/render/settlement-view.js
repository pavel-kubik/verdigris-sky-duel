/*
 * Verdigris campaign - settlement renderer (Phase 2 T12).
 * Low-poly buildings from primitives, one vertex-coloured geometry per building type, drawn as one InstancedMesh
 * per type (about 11 draw calls for every building of a region) + one mesh for all livestock pen fences.
 *   VRender.settlements.build(town) -> { group, update(town), dispose(), info }
 *   update(town): re-reads ruins (T13 burns them; a ruin is not drawn until the ruin meshes come with T13)
 * Models stand on their origin (the ground), local +Z = the building's yaw direction. Palisade pieces are scaled
 * along Z to their segment length.
 */
(function (root) {
  'use strict';
  const THREE = root.THREE, C = root.VCamp;
  if (!THREE || !C) return;
  const VR = root.VRender = root.VRender || {};
  const D = C.need('data');

  const COL = {
    plaster: 0xd8cfb8, thatch: 0x8f6c3a, wood: 0x6e4f30, darkWood: 0x3e2c1c, barn: 0x8c3a2a, stone: 0x9a958a,
    darkStone: 0x6c6862, slate: 0x4a4e5a, order: 0x7a1e22, gold: 0xc9a24a, bronze: 0xa8783a, iron: 0x3a3a3c, grain: 0xcdb98a,
    log: 0x7a5a3a, logTop: 0x9c7a50,
  };

  /* geometry helpers: each returns a BufferGeometry already placed (translate / rotate) */
  const box = (w, h, d, x, y, z) => new THREE.BoxGeometry(w, h, d).translate(x || 0, (y || 0) + h / 2, z || 0);
  const cyl = (r0, r1, h, n, x, y, z) => new THREE.CylinderGeometry(r0, r1, h, n).translate(x || 0, (y || 0) + h / 2, z || 0);
  const pyr = (r, h, y, n) => new THREE.ConeGeometry(r, h, n || 4).rotateY(Math.PI / (n || 4)).translate(0, y + h / 2, 0);
  const gable = (w, h, d, y) => {                        // a ridge roof: a triangular prism along Z
    const g = new THREE.CylinderGeometry(1, 1, d, 3, 1);
    g.rotateX(-Math.PI / 2);                           // prism axis along Z, the edge at +Z goes up (the ridge)
    g.scale(w / 1.732, h / 1.5, 1);
    return g.translate(0, y + h / 3, 0);
  };

  /** Merges [geometry, colour] parts into one non-indexed geometry with a colour attribute. */
  function merge(parts) {
    const pos = [], nor = [], col = [], c = new THREE.Color();
    for (const [g0, hex] of parts) {
      const g = g0.index ? g0.toNonIndexed() : g0;
      g.computeVertexNormals();
      const p = g.attributes.position.array, n = g.attributes.normal.array;
      c.setHex(hex);
      for (let i = 0; i < p.length; i += 3) { pos.push(p[i], p[i + 1], p[i + 2]); nor.push(n[i], n[i + 1], n[i + 2]); col.push(c.r, c.g, c.b); }
      g.dispose(); if (g !== g0) g0.dispose();
    }
    const out = new THREE.BufferGeometry();
    out.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    out.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
    out.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    out.computeBoundingSphere();
    return out;
  }

  const MODELS = {
    house: () => merge([[box(7.2, 4, 6.4), COL.plaster], [gable(8.2, 3, 7.4, 4), COL.thatch], [box(1.4, 2.4, 0.2, 0, 0, 3.25), COL.darkWood],
                        [box(1, 1, 0.2, 2.2, 1.8, 3.25), COL.darkWood], [box(0.9, 2.2, 0.9, -2.2, 4.4, -1.4), COL.stone]]),
    barn: () => merge([[box(10.4, 5.6, 12), COL.barn], [gable(11.6, 3.4, 13, 5.6), COL.darkWood], [box(4, 4.2, 0.2, 0, 0, 6.05), COL.darkWood],
                       [box(4.2, 0.3, 0.25, 0, 2, 6.1), COL.plaster]]),
    granary: () => merge([[cyl(3.6, 4, 4.8, 8), COL.grain], [pyr(4.9, 3.2, 4.8, 8), COL.thatch], [box(1.2, 2, 0.3, 0, 0.6, 3.9), COL.darkWood],
                          [cyl(0.25, 0.25, 0.8, 4, 0, 7.6, 0), COL.wood]]),
    taxhouse: () => merge([[box(7.2, 4.6, 7.2), COL.stone], [pyr(5.6, 2.4, 4.6), COL.slate], [box(1.6, 2.6, 0.2, 0, 0, 3.65), COL.iron],
                           [box(0.15, 3.4, 0.15, 2.8, 4.6, 3.2), COL.darkWood], [box(1.6, 1.1, 0.05, 2.0, 6.7, 3.2), COL.order],
                           [box(1.2, 0.6, 0.4, -2.2, 0, 3.8), COL.gold]]),
    tower: () => merge([[cyl(2.3, 2.7, 12.6, 8), COL.stone], [cyl(3, 3, 1, 8, 0, 12.6), COL.darkStone], [pyr(3.3, 2.4, 13.6, 8), COL.slate],
                        [box(0.2, 2.6, 0.2, 0, 15.4, 0), COL.darkWood], [box(1.4, 0.9, 0.05, 0.7, 17.0, 0), COL.order],
                        [box(0.8, 1.6, 0.2, 0, 0, 2.6), COL.iron]]),
    bell: () => merge([[box(0.4, 5.4, 0.4, -1.3), COL.wood], [box(0.4, 5.4, 0.4, 1.3), COL.wood], [box(3.4, 0.4, 0.5, 0, 5.2), COL.darkWood],
                       [new THREE.ConeGeometry(0.75, 1.3, 8).translate(0, 4.5, 0), COL.bronze], [pyr(1.9, 0.8, 5.6, 4), COL.thatch]]),
    barracks: () => merge([[box(12, 5, 9), COL.stone], [gable(13, 3, 10, 5), COL.slate], [box(2, 3, 0.2, 0, 0, 4.55), COL.iron],
                           [box(1.8, 1, 0.05, -4, 3.2, 4.6), COL.order], [box(1.8, 1, 0.05, 4, 3.2, 4.6), COL.order]]),
    vault: () => merge([[box(6.6, 4.8, 6.6), COL.darkStone], [box(7.2, 0.6, 7.2, 0, 4.8), COL.stone], [box(2, 2.8, 0.25, 0, 0, 3.35), COL.iron],
                        [box(0.6, 0.6, 0.1, 0, 1.4, 3.5), COL.gold], [box(7, 0.4, 0.3, 0, 2.6, 3.4), COL.iron]]),
    platform: () => merge([[box(7.4, 3.4, 7.4), COL.wood], [box(8, 0.4, 8, 0, 3.4), COL.darkWood],
                           [box(0.5, 0.8, 4.4, 0, 3.8, 0.4), COL.darkWood], [box(4.2, 0.3, 0.4, 0, 4.4, 2.2), COL.darkWood], [box(0.2, 0.2, 3.2, 0, 4.7, 0.8), COL.iron]]),
    palisade: () => merge([[box(1.5, 5.2, 1), COL.log], [box(1.1, 0.8, 1, 0, 5.2), COL.logTop]]),
  };

  /** One fence ring per pen: posts and two rails, merged into one mesh for all pens. */
  function penMesh(pens) {
    const parts = [];
    for (const p of pens) {
      const n = Math.max(8, Math.round(p.r * 1.6));
      for (let i = 0; i < n; i++) {
        const a = i / n * Math.PI * 2, a1 = (i + 1) / n * Math.PI * 2;
        const x = p.pos[0] + Math.sin(a) * p.r, z = p.pos[2] + Math.cos(a) * p.r;
        const x1 = p.pos[0] + Math.sin(a1) * p.r, z1 = p.pos[2] + Math.cos(a1) * p.r;
        const y = p.pos[1], len = Math.hypot(x1 - x, z1 - z), yaw = Math.atan2(x1 - x, z1 - z);
        parts.push([box(0.3, 1.5, 0.3).translate(x, y - 0.1, z), COL.wood]);
        for (const h of [0.6, 1.15]) parts.push([new THREE.BoxGeometry(0.12, 0.14, len).rotateY(yaw).translate((x + x1) / 2, y + h, (z + z1) / 2), COL.logTop]);
      }
    }
    return parts.length ? merge(parts) : null;
  }

  function build(town) {
    const group = new THREE.Group(); group.name = 'settlements';
    const mat = new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 0.92, metalness: 0 });
    const meshes = {}, m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), sc = new THREE.Vector3(), pv = new THREE.Vector3(), up = new THREE.Vector3(0, 1, 0);
    let drawn = 0, current = null, pens = null;

    function sync(t) {
      current = t; drawn = 0;
      const byType = {};
      for (const b of (t && t.buildings) || []) (byType[b.type] = byType[b.type] || []).push(b);
      for (const type of Object.keys(MODELS)) {
        const list = byType[type] || [];
        let m = meshes[type];
        if (!m && list.length) {
          m = meshes[type] = new THREE.InstancedMesh(MODELS[type](), mat, list.length);
          m.name = 'b:' + type; m.frustumCulled = false;     // instances spread over the region: no shared bounds
          group.add(m);
        }
        if (!m) continue;
        let k = 0;
        for (const b of list) {
          if (b.ruin || k >= m.instanceMatrix.count) continue;
          q.setFromAxisAngle(up, b.yaw || 0);
          sc.set(1, 1, b.seg ? b.len + 0.5 : 1);
          pv.set(b.pos[0], b.pos[1] - 0.15, b.pos[2]);       // sunk a little so no gap shows on a slight slope
          m.setMatrixAt(k++, m4.compose(pv, q, sc));
        }
        m.count = k; m.instanceMatrix.needsUpdate = true; drawn += k;
      }
      if (!pens && t && t.pens && t.pens.length) {
        const g = penMesh(t.pens);
        if (g) { pens = new THREE.Mesh(g, mat); pens.name = 'pens'; group.add(pens); }
      }
    }
    sync(town);

    function update(t) {
      if (t !== current) { sync(t); return; }
      let ruins = 0;
      for (const b of (t && t.buildings) || []) if (b.ruin) ruins++;
      if (t && ruins !== (t._ruinsDrawn || 0)) { t._ruinsDrawn = ruins; sync(t); }
    }

    function dispose() {
      for (const k of Object.keys(meshes)) meshes[k].geometry.dispose();
      if (pens) pens.geometry.dispose();
      mat.dispose();
      if (group.parent) group.parent.remove(group);
    }

    return { group, update, dispose, get info() { return { buildings: drawn, types: Object.keys(meshes).length, pens: pens ? 1 : 0 }; } };
  }

  VR.settlements = { build, MODELS };
})(typeof self !== 'undefined' ? self : this);
