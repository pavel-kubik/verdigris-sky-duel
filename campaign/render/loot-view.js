/*
 * Verdigris campaign - loot in the world (Phase 2 T19, core/loot.js; 002_task_kingdom.md section 6).
 * Tithe chests (wood, gold bands) and strongboxes (dark iron, rivet band) lying in front of their buildings, each with
 * a slow gold ring on the ground so they read from the air; the loot item Grab would pick up gets a bright pulsing
 * ring; the carried one hangs under the claws in the air and sits in the jaws on the ground. Drawn larger than life
 * (VIS), as the prey are. One mesh per item (a region has at most a few), 2 shared geometries per kind.
 *   VRender.loot.build() -> { group, update(cs, carry, time), dispose() }
 *   carry: { pos: Vector3 (claw or mouth anchor), yaw, jaws } or null
 */
(function (root) {
  'use strict';
  const THREE = root.THREE, C = root.VCamp;
  if (!THREE || !C) return;
  const VR = root.VRender = root.VRender || {};
  const D = C.need('data');
  const VIS = 1.6;

  function chest(kind) {
    const g = new THREE.Group(), strong = kind === 'strongbox';
    const w = strong ? 1.8 : 1.4, h = strong ? 1.15 : 0.9, dpt = strong ? 1.25 : 0.95;
    const body = new THREE.MeshStandardMaterial({ color: strong ? 0x3b3f45 : 0x7a4a24, flatShading: true, roughness: strong ? 0.5 : 0.9, metalness: strong ? 0.6 : 0 });
    const band = new THREE.MeshStandardMaterial({ color: strong ? 0x8a8f96 : 0xd9a63a, flatShading: true, roughness: 0.4, metalness: 0.7, emissive: strong ? 0x000000 : 0x3a2600 });
    const box = new THREE.Mesh(new THREE.BoxGeometry(w, h, dpt), body); box.position.y = h / 2; g.add(box);
    const lid = new THREE.Mesh(new THREE.CylinderGeometry(dpt / 2, dpt / 2, w, 8, 1, false, 0, Math.PI), body);
    lid.rotation.z = Math.PI / 2; lid.rotation.y = Math.PI / 2; lid.position.y = h; g.add(lid);
    for (const x of strong ? [-w * 0.32, 0, w * 0.32] : [-w * 0.3, w * 0.3]) {
      const b = new THREE.Mesh(new THREE.BoxGeometry(0.14, h + dpt * 0.5 + 0.04, dpt + 0.06), band); b.position.set(x, (h + dpt * 0.5) / 2, 0); g.add(b);
    }
    const lock = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.34, 0.1), band); lock.position.set(0, h * 0.8, dpt / 2 + 0.05); g.add(lock);
    if (!strong) {                                                    // a few coins spilling over the rim
      const coin = new THREE.MeshStandardMaterial({ color: 0xf2c14e, emissive: 0x5a3c00, roughness: 0.3, metalness: 0.8 });
      for (let i = 0; i < 4; i++) { const c = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.16, 0.05, 8), coin); c.position.set(-0.4 + i * 0.27, h + dpt * 0.48, 0.1 * (i % 2)); c.rotation.x = 0.4 * (i - 1.5); g.add(c); }
    }
    g.scale.setScalar(VIS);
    return g;
  }

  function build() {
    const group = new THREE.Group(); group.name = 'loot';
    const shown = new Map();                                          // item id -> { mesh, ring }
    const ringGeo = new THREE.RingGeometry(1.7, 2.1, 32);
    const ringMat = new THREE.MeshBasicMaterial({ color: 0xf2c14e, transparent: true, opacity: 0.45, depthWrite: false, side: THREE.DoubleSide, fog: false });
    const hotMat = new THREE.MeshBasicMaterial({ color: 0xffe08a, transparent: true, opacity: 0.9, depthWrite: false, side: THREE.DoubleSide, fog: false });
    const carried = { tithe: chest('tithe'), strongbox: chest('strongbox') };
    for (const k in carried) { carried[k].visible = false; group.add(carried[k]); }

    function entry(it) {
      let s = shown.get(it.id);
      if (!s) {
        const mesh = chest(it.kind), ring = new THREE.Mesh(ringGeo, ringMat);
        ring.rotation.x = -Math.PI / 2;
        group.add(mesh, ring);
        s = { mesh, ring };
        shown.set(it.id, s);
      }
      return s;
    }

    function update(cs, carry, time) {
      const items = cs && !cs.inLair && cs.town && cs.town.items ? cs.town.items : [];
      const live = new Set();
      for (const it of items) {
        const s = entry(it);
        live.add(it.id);
        const on = !it.taken;
        s.mesh.visible = s.ring.visible = on;
        if (!on) continue;
        s.mesh.position.set(it.pos[0], it.pos[1], it.pos[2]);
        s.mesh.rotation.y = Math.atan2(it.pos[0] - it.home[0], it.pos[2] - it.home[2]) || 0;
        const hot = cs.lootTarget === it.id;
        s.ring.material = hot ? hotMat : ringMat;
        s.ring.position.set(it.pos[0], it.pos[1] + 0.15, it.pos[2]);
        s.ring.scale.setScalar(VIS * (hot ? 1.15 + 0.12 * Math.sin(time * 8) : 1 + 0.08 * Math.sin(time * 2 + it.pos[0])));
      }
      for (const [id, s] of shown) if (!live.has(id)) { group.remove(s.mesh, s.ring); s.mesh.traverse(o => { if (o.geometry) o.geometry.dispose(); if (o.material) o.material.dispose(); }); shown.delete(id); }
      const L = cs && cs.carriedLoot;
      for (const k in carried) {
        const m = carried[k], on = !!(L && L.kind === k && carry && !cs.inLair);
        m.visible = on;
        if (!on) continue;
        m.position.copy(carry.pos);
        if (!carry.jaws) m.position.y -= 1.2 * VIS;                  // hangs under the claws
        else m.position.y -= 0.5 * VIS;
        m.rotation.set(0, carry.yaw, 0);
      }
    }
    function dispose() {
      group.traverse(o => { if (o.geometry) o.geometry.dispose(); if (o.material) o.material.dispose(); });
      if (group.parent) group.parent.remove(group);
    }
    return { group, update, dispose };
  }

  VR.loot = { build, VIS };
})(typeof self !== 'undefined' ? self : this);
