/*
 * Verdigris campaign - the aerie outside (Phase 3 T08, 003_task_missions.md 6): a crag of weathered rock with a dark
 * cleft on a ledge, bones on the ledge and a nest of branches just inside, facing data.aeries.<region>.facing.
 * The mouth is where core/aerie.js puts it (site().mouth), so the dragon enters what is drawn.
 * One merged vertex-coloured mesh (1 draw call, about 1k triangles).
 *   VRender.aerie.build(regionId) -> { group, triangles, dispose() } | null (no aerie in that region)
 */
(function (root) {
  'use strict';
  const THREE = root.THREE, C = root.VCamp;
  if (!THREE || !C) return;
  const AE = C.need('aerie');
  const VR = root.VRender = root.VRender || {};

  const COL = { rock: 0x7b7266, rockDark: 0x5a534a, moss: 0x55613f, cleft: 0x0b0806, ledge: 0x6d655a, bone: 0xe2d9c0, twig: 0x5b4126 };

  function merger() {
    const pos = [], col = [], c = new THREE.Color(), m = new THREE.Matrix4(), q = new THREE.Quaternion(), v = new THREE.Vector3();
    function add(geo, x, y, z, yaw, sx, sy, sz, hex, tilt, roll) {
      const g = geo.index ? geo.toNonIndexed() : geo;
      q.setFromEuler(new THREE.Euler(tilt || 0, yaw, roll || 0, 'YXZ'));
      m.compose(new THREE.Vector3(x, y, z), q, new THREE.Vector3(sx, sy, sz));
      const p = g.attributes.position;
      c.set(hex);
      for (let i = 0; i < p.count; i++) {
        v.fromBufferAttribute(p, i).applyMatrix4(m);
        pos.push(v.x, v.y, v.z);
        const shade = 0.86 + 0.14 * Math.sin(i * 2.3 + x * 0.17 + z * 0.11);
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

  function build(regionId) {
    const s = AE.site(regionId);
    if (!s) return null;
    const M = merger(), rock = new THREE.DodecahedronGeometry(1, 0), box = new THREE.BoxGeometry(1, 1, 1), cyl = new THREE.CylinderGeometry(1, 1, 1, 6);
    const tor = new THREE.TorusGeometry(1, 0.35, 5, 10);
    const f = s.facing, dx = s.dir[0], dz = s.dir[1], rx = dz, rz = -dx;     // dir = out of the mouth, r = to its right
    const at = (fwd, side) => [s.mouth[0] + dx * fwd + rx * side, s.mouth[2] + dz * fwd + rz * side];
    const g0 = s.ground, my = s.mouth[1];
    // the crag behind the mouth: big rocks stacked around the cleft, taller at the back
    const rocks = [
      [-10, -13, 9, 13, 10, COL.rock], [-10, 13, 9, 12, 10, COL.rock], [-16, 0, 13, 20, 12, COL.rockDark],
      [-7, -9, 5.5, 8, 6, COL.rock], [-7, 9, 5.5, 9, 6, COL.rock], [-22, -10, 10, 15, 10, COL.rockDark], [-22, 12, 10, 14, 11, COL.rockDark],
      [-6, -16, 6, 5, 6, COL.moss], [-6, 16, 6, 5, 6, COL.moss], [-12, 0, 9, 7, 8, COL.rock],
    ];
    for (const [fw, sd, w, h, d, hex] of rocks) {
      const [x, z] = at(fw, sd);
      M.add(rock, x, g0 + (fw === -12 ? 22 : h * 0.75), z, f + sd * 0.07, w, h, d, hex, 0.1, sd * 0.01);
    }
    // the cleft: a tall dark slot in the front face (two boxes give a pointed arch), set just behind the mouth
    { const [x, z] = at(-2.4, 0); M.add(box, x, my + 4, z, f, 7, 12, 1.2, COL.cleft); M.add(box, x, my + 10.5, z, f, 3.8, 4, 1.2, COL.cleft); }
    // the ledge in front of the mouth and a few stones on it
    { const [x, z] = at(2, 0); M.add(box, x, my - 1.2, z, f, 12, 2.2, 10, COL.ledge); }
    { const [x, z] = at(5, -4); M.add(rock, x, my - 0.2, z, f, 1.2, 0.8, 1.1, COL.rockDark); }
    // bones: a few long pale sticks and a skull-like lump
    for (const [fw, sd, yaw, len] of [[3, 2, 0.5, 3.4], [4, -1.5, -0.9, 2.6], [1.5, 3.5, 1.4, 2.2], [5, 1, 2.2, 1.8]]) {
      const [x, z] = at(fw, sd);
      M.add(cyl, x, my + 0.1, z, f + yaw, 0.18, len, 0.18, COL.bone, Math.PI / 2);
    }
    { const [x, z] = at(4.5, -3); M.add(rock, x, my + 0.3, z, f, 0.7, 0.55, 0.8, COL.bone); }
    // the nest of branches just inside the cleft
    { const [x, z] = at(-1, 0); M.add(tor, x, my + 0.1, z, f, 2.4, 2.4, 1.6, COL.twig, Math.PI / 2); }
    rock.dispose(); box.dispose(); cyl.dispose(); tor.dispose();
    const group = new THREE.Group(); group.name = 'aerie:' + regionId;
    const mesh = new THREE.Mesh(M.geometry(), new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 0.97 }));
    group.add(mesh);
    return {
      group, triangles: M.count,
      dispose() { mesh.geometry.dispose(); mesh.material.dispose(); if (group.parent) group.parent.remove(group); },
    };
  }

  VR.aerie = { build };
})(typeof self !== 'undefined' ? self : this);
