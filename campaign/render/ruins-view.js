/*
 * Verdigris campaign - burned ruins scenery (Phase 3 T02): the terrain 'ruins' features of a region.
 *   Staromark (the burned royal city): rubble heaps, wall stumps in street blocks and a few standing tower shells;
 *   kind 'castle' (Hradchan, the old castle on the west ridge): a broken curtain wall and towers on a ring.
 * Three InstancedMeshes for the whole region (rubble, walls, towers) - 3 draw calls. Scenery only: no collision
 * (the dragon flies and walks through it like flora); seeded, so it is the same on every visit.
 *   VRender.ruins.build(regionId, { density }) -> { group, count, dispose() } | null (no ruins)
 */
(function (root) {
  'use strict';
  const THREE = root.THREE, C = root.VCamp;
  if (!THREE || !C) return;
  const T = C.need('terrain'), Mth = C.need('math');
  const VR = root.VRender = root.VRender || {};

  const COL = { rubble: [0x4a423b, 0x6b6157], wall: [0x8c8475, 0x5e564c], tower: [0x958c7c, 0x6a6155] };
  const CITY = { blocks: 70, rubble: 160, towers: 5 }, CASTLE = { walls: 18, towers: 4, rubble: 30 };

  function build(id, opts) {
    const list = T.region(id).terrain.features.filter(f => f.type === 'ruins');
    if (!list.length) return null;
    const dens = opts && opts.density != null ? Math.max(0.4, opts.density) : 1;
    const rng = Mth.mulberry(T.region(id).seed * 131 + 7);
    const rubble = [], walls = [], towers = [];
    const ok = (x, z) => T.dryAt(id, x, z) && T.lineDist(id, 'road', x, z) > 6 && !T.deckAt(id, x, z, 4) && T.surfaceSlope(id, x, z) < 0.6;
    for (const f of list) {
      if (f.kind === 'castle') {
        for (let k = 0; k < CASTLE.walls; k++) {                 // a broken ring of curtain wall with gaps
          if (rng() < 0.3) continue;
          const a = k / CASTLE.walls * Math.PI * 2, x = f.x + Math.sin(a) * f.r * 0.7, z = f.z + Math.cos(a) * f.r * 0.7;
          if (ok(x, z)) walls.push([x, z, a + Math.PI / 2, f.r * 0.24, 4 + rng() * 7, 2.2]);
        }
        for (let k = 0; k < CASTLE.towers; k++) {
          const a = k / CASTLE.towers * Math.PI * 2 + 0.4, x = f.x + Math.sin(a) * f.r * 0.7, z = f.z + Math.cos(a) * f.r * 0.7;
          if (ok(x, z)) towers.push([x, z, 4.5, 9 + rng() * 10]);
        }
        towers.push([f.x, f.z, 6, 16]);                          // the old keep, roofless
        for (let k = 0; k < CASTLE.rubble * dens; k++) {
          const a = rng() * Math.PI * 2, r = Math.sqrt(rng()) * f.r * 0.8, x = f.x + Math.sin(a) * r, z = f.z + Math.cos(a) * r;
          if (ok(x, z)) rubble.push([x, z, 1.5 + rng() * 2.5, rng()]);
        }
        continue;
      }
      for (let k = 0; k < CITY.blocks * dens; k++) {             // house walls on a rough street grid
        const gx = Math.round((rng() * 2 - 1) * f.r / 18) * 18, gz = Math.round((rng() * 2 - 1) * f.r / 18) * 18;
        const x = f.x + gx + (rng() - 0.5) * 4, z = f.z + gz + (rng() - 0.5) * 4;
        if (Math.hypot(x - f.x, z - f.z) > f.r * 0.92 || !ok(x, z)) continue;
        walls.push([x, z, (rng() < 0.5 ? 0 : Math.PI / 2) + (rng() - 0.5) * 0.15, 6 + rng() * 8, 2 + rng() * 6, 1.2]);
      }
      for (let k = 0; k < CITY.rubble * dens; k++) {
        const a = rng() * Math.PI * 2, r = Math.sqrt(rng()) * f.r, x = f.x + Math.sin(a) * r, z = f.z + Math.cos(a) * r;
        if (ok(x, z)) rubble.push([x, z, 1.2 + rng() * 3, rng()]);
      }
      for (let k = 0; k < CITY.towers; k++) {                    // church towers and gate towers still standing
        const a = rng() * Math.PI * 2, r = (0.2 + rng() * 0.7) * f.r, x = f.x + Math.sin(a) * r, z = f.z + Math.cos(a) * r;
        if (ok(x, z)) towers.push([x, z, 3 + rng() * 1.5, 12 + rng() * 14]);
      }
    }

    const group = new THREE.Group(); group.name = 'ruins:' + id;
    const mat = new THREE.MeshStandardMaterial({ vertexColors: false, flatShading: true, roughness: 1 });
    const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(), p = new THREE.Vector3(), e = new THREE.Euler();
    const col = new THREE.Color(), colB = new THREE.Color();
    function inst(geo, items, cols, place) {
      const mesh = new THREE.InstancedMesh(geo, mat, Math.max(1, items.length));
      mesh.count = items.length;
      items.forEach((it, i) => {
        place(it);
        m4.compose(p, q.setFromEuler(e), s);
        mesh.setMatrixAt(i, m4);
        mesh.setColorAt(i, col.set(cols[0]).lerp(colB.set(cols[1]), rng()));
      });
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
      group.add(mesh);
      return mesh;
    }
    const rub = inst(new THREE.DodecahedronGeometry(1, 0), rubble, COL.rubble, ([x, z, r, k]) => {
      p.set(x, T.surfaceAt(id, x, z) - r * 0.35, z); e.set(k * 3, k * 7, 0); s.set(r * 1.3, r * 0.55, r);
    });
    // a wall stump: box with its base on the lowest ground under it
    const wl = inst(new THREE.BoxGeometry(1, 1, 1).translate(0, 0.5, 0), walls, COL.wall, ([x, z, yaw, len, h, th]) => {
      p.set(x, T.surfaceAt(id, x, z) - 1, z); e.set(0, yaw, 0); s.set(th, h + 1, len);
    });
    // a tower shell: open cylinder (no top), so it reads as burned out from the air
    const tw = inst(new THREE.CylinderGeometry(1, 1.1, 1, 8, 1, true).translate(0, 0.5, 0), towers, COL.tower, ([x, z, r, h]) => {
      p.set(x, T.surfaceAt(id, x, z) - 1, z); e.set(0, 0, 0); s.set(r, h + 1, r);
    });
    tw.material = new THREE.MeshStandardMaterial({ flatShading: true, roughness: 1, side: THREE.DoubleSide });
    return {
      group, count: { rubble: rubble.length, walls: walls.length, towers: towers.length },
      dispose() {
        for (const m of [rub, wl, tw]) { m.geometry.dispose(); m.material.dispose(); }
        if (group.parent) group.parent.remove(group);
      },
    };
  }

  VR.ruins = { build };
})(typeof self !== 'undefined' ? self : this);
