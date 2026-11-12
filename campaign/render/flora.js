/*
 * Verdigris campaign - trees and rocks of a region.
 * Trees are a living forest (shared/forest.js rules, shared/forest-view.js models): the dragon knocks them down by
 * flying into them and sets them on fire with its breath; the same forest runs in the deathmatch and the co-op.
 * Seeded from the region, so the forest is the same every visit and in every browser: the full list is always
 * generated and a quality tier draws a prefix of it, so tree number i is the same tree for every player.
 * Trees avoid water, steep ground, the volcano, the region rim and (T11) roads, fields and plateaus. The Ash Wastes
 * keep dead wood around the volcano and (flora.far) a living forest toward the rim.
 *   VRender.flora.build(regionId, { flora, particles }) ->  (flora = share of the region's trees, quality tier; isTouch = 0.5 kept as fallback)
 *     -> { group, forest (VForest), view, count: { trees, rocks }, trees: [[x, z, r]], update(dt, time, camera, viewH), dispose() }
 *   VRender.flora.list(regionId) -> the full seeded tree list [{ x, y, z, r, h, kind, yaw, sc, sy, tint }] (no THREE needed)
 */
(function (root) {
  'use strict';
  const THREE = root.THREE, C = root.VCamp;
  if (!THREE || !C) return;
  const T = C.need('terrain'), Mth = C.need('math');
  const VR = root.VRender = root.VRender || {};
  const VF = root.VForest, FV = root.VForestView;

  /* tree kinds per palette: [VForestView kind, share, scale range] */
  const KINDS = {
    forest: [['conifer', 0.5, [0.8, 1.6]], ['broadleaf', 0.28, [0.8, 1.4]], ['pine', 0.12, [0.9, 1.5]], ['birch', 0.1, [0.9, 1.4]]],
    farm:   [['broadleaf', 0.55, [0.8, 1.3]], ['poplar', 0.3, [0.9, 1.3]], ['birch', 0.15, [0.9, 1.3]]],       // T11: hedgerows and poplars
    bend:   [['broadleaf', 0.5, [0.8, 1.4]], ['poplar', 0.2, [0.9, 1.3]], ['conifer', 0.2, [0.8, 1.4]], ['birch', 0.1, [0.9, 1.3]]],   // Phase 3 T02
    ash:    [['deadwood', 1, [0.7, 1.5]]],
    ashfar: [['conifer', 0.42, [0.8, 1.5]], ['pine', 0.26, [0.9, 1.5]], ['broadleaf', 0.2, [0.8, 1.3]], ['birch', 0.12, [0.9, 1.3]]],
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

  /** Every tree of the region, in a fixed order: near trees first, then (flora.far) the outer forest. */
  const listCache = new Map();
  function list(id) {
    if (listCache.has(id)) return listCache.get(id);
    const R = T.region(id), pal = R.palette, rng = Mth.mulberry(R.seed * 7919 + 3);
    const cone = R.terrain.features.find(f => f.type === 'cone'), far = R.flora.far;
    const treeOk = (x, z) => {
      if (!T.dryAt(id, x, z)) return false;                    // lakes, rivers and their shores
      if (T.plateauAt(id, x, z, 10) || T.fieldAt(id, x, z, 3) || T.lineDist(id, 'road', x, z) < 9) return false;   // settlements, crops, roads (T11)
      if (cone && Math.hypot(x - cone.x, z - cone.z) < cone.r * 0.9) return false;
      if (R.lair && Math.hypot(x - R.lair.x, z - R.lair.z) < 45) return false;
      if (T.ruinsAt(id, x, z) || T.deckAt(id, x, z, 8) || (R.vines && Math.hypot(x - R.vines.x, z - R.vines.z) < R.vines.r)) return false;   // T02
      return T.slopeAt(id, x, z, 3) < 0.5;
    };
    const spots = place(id, rng, R.flora.trees, far ? (x, z) => treeOk(x, z) && Math.hypot(x, z) < far.from + 40 : treeOk).map(p => [p[0], p[1], pal]);
    if (far) {                                                   // a living forest toward the rim, thinning out toward the ash
      const frng = Mth.mulberry(R.seed * 104729 + 17);
      place(id, frng, far.trees, (x, z) => { const d = Math.hypot(x, z); return d > far.from && frng() < Mth.clamp((d - far.from) / (far.full - far.from), 0.08, 1) && treeOk(x, z); })
        .forEach(p => spots.push([p[0], p[1], far.kinds]));
    }
    const out = spots.map(([x, z, kp], i) => {
      const r = Mth.mulberry((R.seed * 7919 + i * 2654435761) >>> 0), kinds = KINDS[kp];
      let pick = r(), k = kinds[kinds.length - 1];
      for (const kk of kinds) { if (pick < kk[1]) { k = kk; break; } pick -= kk[1]; }
      const sc = Mth.range(r, k[2][0], k[2][1]), sy = Mth.range(r, 0.9, 1.15), size = FV ? FV.size(k[0], sc, sy) : { r: 4 * sc, h: 14 * sc * sy };
      return { x, y: T.surfaceAt(id, x, z), z, r: size.r, h: size.h, kind: k[0], yaw: r() * Math.PI * 2, sc, sy, tint: r() };
    });
    listCache.set(id, out);
    return out;
  }

  function build(id, opts) {
    const R = T.region(id), pal = R.palette, rng = Mth.mulberry(R.seed * 7919 + 5);
    const group = new THREE.Group(); group.name = 'flora:' + id;
    const share = opts && opts.flora != null ? opts.flora : opts && opts.isTouch ? 0.5 : 1;
    const full = list(id);
    // a lower tier draws every k-th tree, so the forest thins out evenly and tree i stays tree i
    const names = [], trees = [];
    full.forEach((t, i) => {
      if (share < 1 && Math.floor((i + 1) * share) === Math.floor(i * share)) return;
      let k = names.indexOf(t.kind); if (k < 0) { k = names.length; names.push(t.kind); }
      trees.push(Object.assign({}, t, { kind: k, id: i }));
    });
    const forest = VF.create(trees, opts && opts.rules);
    forest.ids = trees.map(t => t.id);                           // forest index -> region tree number (the same in every browser)
    forest.byId = new Map(trees.map((t, k) => [t.id, k]));
    const view = FV.build(forest, { kinds: names, particles: opts && opts.particles, lights: opts && opts.lights, detail: !(opts && opts.detail === false), groundAt: (x, z) => T.surfaceAt(id, x, z) });
    group.add(view.group);
    const rockOk = (x, z) => !T.liquidAt(id, x, z) && !T.plateauAt(id, x, z, 6) && !T.fieldAt(id, x, z) && T.lineDist(id, 'road', x, z) > 7 && T.slopeAt(id, x, z, 3) < 1.1;
    const rocks = place(id, rng, R.flora.rocks, rockOk);
    const TX = root.VTex && !(opts && opts.detail === false) ? root.VTex : null;

    const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(), p = new THREE.Vector3();
    const col = new THREE.Color(), colB = new THREE.Color();
    const meshes = [], placed = trees.map(t => [t.x, t.z, t.r]);

    if (rocks.length) {
      const rm = new THREE.MeshStandardMaterial({ flatShading: true, roughness: 1 });
      if (TX) TX.detail(rm, { map: 'rock', scale: 5, strength: 0.7, bump: 1.2 });
      const rock = new THREE.InstancedMesh(new THREE.DodecahedronGeometry(1, 1), rm, rocks.length);
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
        const vmat = new THREE.MeshStandardMaterial({ flatShading: true, roughness: 1 });
        if (TX) TX.detail(vmat, { map: 'leaves', scale: 3, strength: 0.7, bump: 1 });
        const vm = new THREE.InstancedMesh(g, vmat, items.length);
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
      group, forest, view, trees: placed, vines, count: { trees: trees.length, rocks: rocks.length },
      update(dt, time, camera, viewH) { view.update(dt, time, camera, viewH); },
      dispose() { view.dispose(); meshes.forEach(m => { m.geometry.dispose(); m.material.dispose(); if (m.dispose) m.dispose(); }); },
    };
  }

  VR.flora = { build, list, KINDS };
})(typeof self !== 'undefined' ? self : this);
