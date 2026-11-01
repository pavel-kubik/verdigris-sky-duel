/*
 * Verdigris campaign - instanced trees and rocks for a region.
 * One InstancedMesh per part (trunk, crown, rock), seeded from the region so the forest is the
 * same every visit. Trees avoid water, steep ground, the volcano, the region rim and (T11) roads, fields and plateaus.
 *   VRender.flora.build(regionId, { flora }) ->  (flora = share of the region's trees, quality tier; isTouch = 0.5 kept as fallback)
 *     -> { group, count: { trees, rocks }, trees: [[x, z, r]], dispose() }
 */
(function (root) {
  'use strict';
  const THREE = root.THREE, C = root.VCamp;
  if (!THREE || !C) return;
  const T = C.need('terrain'), Mth = C.need('math');
  const VR = root.VRender = root.VRender || {};

  const KINDS = {
    forest: [
      { id: 'conifer', share: 0.6, trunk: [0.5, 0.9, 4, 0x4a3524], crown: { geo: 'cone', r: 4.2, h: 12, y: 9, col: [0x2c4f2e, 0x3d6a3a] }, scale: [0.8, 1.6] },
      { id: 'broadleaf', share: 0.4, trunk: [0.6, 1.0, 5, 0x5a4029], crown: { geo: 'ico', r: 5.2, h: 0, y: 8.5, col: [0x4f7a3c, 0x6b8f3f] }, scale: [0.8, 1.4] },
    ],
    farm: [   // T11: hedgerow broadleaves and tall poplars along the roads and the river
      { id: 'broadleaf', share: 0.7, trunk: [0.6, 1.0, 5, 0x5a4029], crown: { geo: 'ico', r: 5.0, h: 0, y: 8, col: [0x5f8a3c, 0x7a9a45] }, scale: [0.8, 1.3] },
      { id: 'poplar', share: 0.3, trunk: [0.4, 0.7, 4, 0x5a4632], crown: { geo: 'cone', r: 2.6, h: 15, y: 11, col: [0x4d7a36, 0x63883c] }, scale: [0.9, 1.3] },
    ],
    bend: [   // Phase 3 T02: oak and lime woods on the hills, willows and poplars along the Veltava
      { id: 'broadleaf', share: 0.6, trunk: [0.6, 1.0, 5, 0x55402a], crown: { geo: 'ico', r: 5.2, h: 0, y: 8.5, col: [0x4f7838, 0x6c8c40] }, scale: [0.8, 1.4] },
      { id: 'poplar', share: 0.2, trunk: [0.4, 0.7, 4, 0x5a4632], crown: { geo: 'cone', r: 2.6, h: 15, y: 11, col: [0x4d7a36, 0x63883c] }, scale: [0.9, 1.3] },
      { id: 'conifer', share: 0.2, trunk: [0.5, 0.9, 4, 0x4a3524], crown: { geo: 'cone', r: 4.0, h: 11, y: 8.5, col: [0x2f4f30, 0x3d6038] }, scale: [0.8, 1.4] },
    ],
    ash: [
      { id: 'deadwood', share: 1, trunk: [0.35, 0.8, 7, 0x231c18], crown: null, scale: [0.7, 1.5] },
    ],
  };
  const ROCK_COL = { forest: [0x6a5f50, 0x7b7364], ash: [0x2a2420, 0x3d3530], farm: [0x7a7262, 0x8c8474], bend: [0x8f8a7e, 0xa49e90] };

  function place(id, rng, n, ok) {
    const R = T.region(id), out = [];
    let tries = 0;
    while (out.length < n && tries < n * 30) {
      tries++;
      const a = rng() * Math.PI * 2, r = Math.sqrt(rng()) * (R.radius - 70);
      const x = Math.cos(a) * r, z = Math.sin(a) * r;
      if (ok(x, z)) out.push([x, z]);
    }
    return out;
  }

  function build(id, opts) {
    const R = T.region(id), pal = R.palette, rng = Mth.mulberry(R.seed * 7919 + 3);
    const group = new THREE.Group(); group.name = 'flora:' + id;
    const cone = R.terrain.features.find(f => f.type === 'cone');
    const share = opts && opts.flora != null ? opts.flora : opts && opts.isTouch ? 0.5 : 1;
    const nTrees = Math.round(R.flora.trees * share);
    const treeOk = (x, z) => {
      if (!T.dryAt(id, x, z)) return false;                    // lakes, rivers and their shores
      if (T.plateauAt(id, x, z, 10) || T.fieldAt(id, x, z, 3) || T.lineDist(id, 'road', x, z) < 9) return false;   // settlements, crops, roads (T11)
      if (cone && Math.hypot(x - cone.x, z - cone.z) < cone.r * 0.9) return false;
      if (R.lair && Math.hypot(x - R.lair.x, z - R.lair.z) < 45) return false;
      if (T.ruinsAt(id, x, z) || T.deckAt(id, x, z, 8) || (R.vines && Math.hypot(x - R.vines.x, z - R.vines.z) < R.vines.r)) return false;   // T02
      return T.slopeAt(id, x, z, 3) < 0.5;
    };
    const rockOk = (x, z) => !T.liquidAt(id, x, z) && !T.plateauAt(id, x, z, 6) && !T.fieldAt(id, x, z) && T.lineDist(id, 'road', x, z) > 7 && T.slopeAt(id, x, z, 3) < 1.1;
    const trees = place(id, rng, nTrees, treeOk);
    const rocks = place(id, rng, R.flora.rocks, rockOk);

    const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(), p = new THREE.Vector3(), up = new THREE.Vector3(0, 1, 0);
    const col = new THREE.Color(), colB = new THREE.Color();
    const meshes = [], placed = [];
    const kinds = KINDS[pal];
    let start = 0;
    kinds.forEach((k, ki) => {
      const end = ki === kinds.length - 1 ? trees.length : start + Math.round(trees.length * k.share);
      const list = trees.slice(start, end); start = end;
      if (!list.length) return;
      const [r0, r1, th, tc] = k.trunk;
      const tGeo = new THREE.CylinderGeometry(r0, r1, th, 5); tGeo.translate(0, th / 2, 0);
      const trunk = new THREE.InstancedMesh(tGeo, new THREE.MeshStandardMaterial({ color: tc, flatShading: true, roughness: 1 }), list.length);
      let crown = null;
      if (k.crown) {
        const cg = k.crown.geo === 'cone' ? new THREE.ConeGeometry(k.crown.r, k.crown.h, 7) : new THREE.IcosahedronGeometry(k.crown.r, 0);
        cg.translate(0, k.crown.y, 0);
        crown = new THREE.InstancedMesh(cg, new THREE.MeshStandardMaterial({ flatShading: true, roughness: 1 }), list.length);
      }
      list.forEach(([x, z], i) => {
        const sc = Mth.range(rng, k.scale[0], k.scale[1]);
        p.set(x, T.surfaceAt(id, x, z) - 0.4, z);
        q.setFromAxisAngle(up, rng() * Math.PI * 2);
        s.set(sc, sc * Mth.range(rng, 0.9, 1.15), sc);
        m4.compose(p, q, s);
        trunk.setMatrixAt(i, m4);
        if (crown) {
          crown.setMatrixAt(i, m4);
          col.set(k.crown.col[0]).lerp(colB.set(k.crown.col[1]), rng());
          crown.setColorAt(i, col);
        }
        placed.push([x, z, (k.crown ? k.crown.r : 1) * sc]);
      });
      [trunk, crown].forEach(m => { if (!m) return; m.instanceMatrix.needsUpdate = true; if (m.instanceColor) m.instanceColor.needsUpdate = true; m.frustumCulled = false; group.add(m); meshes.push(m); });
    });

    if (rocks.length) {
      const rock = new THREE.InstancedMesh(new THREE.DodecahedronGeometry(1, 0), new THREE.MeshStandardMaterial({ flatShading: true, roughness: 1 }), rocks.length);
      const rc = ROCK_COL[pal];
      rocks.forEach(([x, z], i) => {
        const sc = Mth.range(rng, 1.2, 4.5);
        p.set(x, T.surfaceAt(id, x, z) + sc * 0.25, z);
        q.setFromEuler(new THREE.Euler(rng() * 3, rng() * 3, rng() * 3));
        s.set(sc * Mth.range(rng, 0.9, 1.6), sc * Mth.range(rng, 0.6, 1), sc);
        m4.compose(p, q, s);
        rock.setMatrixAt(i, m4);
        rock.setColorAt(i, col.set(rc[0]).lerp(colB.set(rc[1]), rng()));
      });
      rock.instanceMatrix.needsUpdate = true; if (rock.instanceColor) rock.instanceColor.needsUpdate = true;
      rock.frustumCulled = false;
      group.add(rock); meshes.push(rock);
    }

    // vineyard rows (T02, region.vines { x, z, r, rows }): low green hedges of vines on the sloping ground, one instanced mesh
    let vines = 0;
    if (R.vines) {
      const V = R.vines, items = [];
      for (let k = -V.rows; k <= V.rows; k++) for (let j = -12; j <= 12; j++) {
        const x = V.x + k * (V.r / V.rows) * 0.9, z = V.z + j * 8;
        if (Math.hypot(x - V.x, z - V.z) > V.r || !T.dryAt(id, x, z) || T.plateauAt(id, x, z, 6) || T.lineDist(id, 'road', x, z) < 6) continue;
        if (T.surfaceSlope(id, x, z) < 0.06 || T.surfaceSlope(id, x, z) > 0.7) continue;
        items.push([x, z]);
      }
      if (items.length) {
        const g = new THREE.BoxGeometry(1.2, 1.6, 7.4); g.translate(0, 0.8, 0);
        const vm = new THREE.InstancedMesh(g, new THREE.MeshStandardMaterial({ flatShading: true, roughness: 1 }), items.length);
        items.forEach(([x, z], i) => {
          p.set(x, T.surfaceAt(id, x, z) - 0.2, z); q.set(0, 0, 0, 1); s.set(1, Mth.range(rng, 0.85, 1.15), 1);
          m4.compose(p, q, s); vm.setMatrixAt(i, m4);
          vm.setColorAt(i, col.set(0x4f6e2c).lerp(colB.set(0x6d8a3a), rng()));
        });
        vm.instanceMatrix.needsUpdate = true; if (vm.instanceColor) vm.instanceColor.needsUpdate = true;
        vm.frustumCulled = false; group.add(vm); meshes.push(vm); vines = items.length;
      }
    }

    return {
      group, trees: placed, vines, count: { trees: trees.length, rocks: rocks.length },
      dispose() { meshes.forEach(m => { m.geometry.dispose(); m.material.dispose(); if (m.dispose) m.dispose(); }); },
    };
  }

  VR.flora = { build };
})(typeof self !== 'undefined' ? self : this);
