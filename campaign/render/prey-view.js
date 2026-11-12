/*
 * Verdigris campaign - prey renderer.
 * Goats, deer, boars, sheep, cows (T18) and hens modelled from rounded parts with fur, fleece, hide and feather
 * textures (shared/textures.js), drawn with one InstancedMesh per body part
 * per type (a draw call per part of every kind that is in view). Legs swing with the animal's speed.
 *   VRender.prey.build() -> { group, update(field, time, carry?), dispose() }
 *   carry: { id, pos: Vector3, yaw, pitch } draws that prey hanging from the claw anchor instead of on the ground
 *   update(field, time, carry, { sense: { x, z, range } }): T20 prey sense - an amber ring under every loose animal
 *   within range of (x, z), larger and fainter far out, drawn over the terrain (one more draw call)
 */
(function (root) {
  'use strict';
  const THREE = root.THREE, C = root.VCamp;
  if (!THREE || !C) return;
  const VR = root.VRender = root.VRender || {};
  const VIS = 2.2;                       // drawn larger than life so prey read from the air

  const box = (w, h, d) => new THREE.BoxGeometry(w, h, d);
  const ell = (rx, ry, rz, n) => new THREE.SphereGeometry(1, n || 10, Math.max(5, (n || 10) - 3)).scale(rx, ry, rz);   // rounded body part
  const leg = (r, h) => {                                        // pivot at the hip: thigh, slim shank, hoof
    const g = new THREE.CylinderGeometry(r * 1.2, r * 0.6, h, 6, 3); g.translate(0, -h / 2, 0);
    const p = g.attributes.position;
    for (let i = 0; i < p.count; i++) { const y = p.getY(i); if (y < -h * 0.85) { p.setX(i, p.getX(i) * 1.5); p.setZ(i, p.getZ(i) * 1.5 + r * 0.25); } }
    g.computeVertexNormals();
    return g;
  };
  const horn = (r, h) => { const g = new THREE.ConeGeometry(r, h, 5); g.translate(0, h / 2, 0); return g; };
  const ear = (w, l) => { const g = new THREE.ConeGeometry(w, l, 4); g.scale(1, 1, 0.35); g.translate(0, l / 2, 0); return g; };
  const EYE = 0x14100c;

  /* part: geo, colour (or [a, b] for per-animal variation), places: list of [x, y, z, rx, ry, rz], legs: swing these,
     tex: detail texture (shared/textures.js) */
  const MODELS = {
    goat: { parts: [
      { geo: ell(0.37, 0.4, 0.8), col: [0xe8e2d4, 0x8f8578], tex: 'fur', places: [[0, 1.05, 0, 0, 0, 0]] },
      { geo: ell(0.2, 0.36, 0.22), col: [0xe8e2d4, 0x8f8578], tex: 'fur', places: [[0, 1.4, 0.7, 0.75, 0, 0]] },                 // neck
      { geo: ell(0.17, 0.19, 0.27), col: [0xe8e2d4, 0x8f8578], tex: 'fur', places: [[0, 1.68, 0.92, 0.35, 0, 0], [0, 1.6, 1.12, 0.5, 0, 0]] },   // head, muzzle
      { geo: horn(0.05, 0.22), col: [0xd8d2c4, 0x7f7568], places: [[0, 1.47, 1.12, Math.PI, 0, 0], [0, 1.15, -0.78, -2.2, 0, 0]] },   // beard, tail
      { geo: leg(0.085, 0.72), col: 0x4a4238, tex: 'fur', legs: true, places: [[0.2, 0.72, 0.5], [-0.2, 0.72, 0.5], [0.2, 0.72, -0.5], [-0.2, 0.72, -0.5]] },
      { geo: horn(0.055, 0.5), col: 0xcfc4a8, tex: 'horn', places: [[0.1, 1.8, 0.82, -0.9, 0, 0.25], [-0.1, 1.8, 0.82, -0.9, 0, -0.25]] },
      { geo: ear(0.07, 0.2), col: [0xd8cfc0, 0x7a7064], places: [[0.17, 1.74, 0.82, 0, 0, -1.3], [-0.17, 1.74, 0.82, 0, 0, 1.3]] },
      { geo: ell(0.03, 0.03, 0.03, 6), col: EYE, places: [[0.14, 1.74, 1.02], [-0.14, 1.74, 1.02]] },
    ] },
    deer: { parts: [
      { geo: ell(0.4, 0.45, 0.98), col: [0x9a6b3c, 0x7a5230], tex: 'fur', places: [[0, 1.45, 0, 0, 0, 0]] },
      { geo: ell(0.3, 0.26, 0.5), col: [0xe6dcc6, 0xcdbf9f], tex: 'fur', places: [[0, 1.2, -0.05, 0, 0, 0]] },                   // pale belly
      { geo: ell(0.17, 0.5, 0.2), col: [0x9a6b3c, 0x7a5230], tex: 'fur', places: [[0, 1.98, 0.84, 0.5, 0, 0]] },
      { geo: ell(0.16, 0.18, 0.3), col: [0x8a5e34, 0x6e4a2a], tex: 'fur', places: [[0, 2.42, 1.12, 0.2, 0, 0], [0, 2.36, 1.36, 0.3, 0, 0]] },
      { geo: leg(0.075, 1.05), col: 0x5a3e24, tex: 'fur', legs: true, places: [[0.22, 1.05, 0.64], [-0.22, 1.05, 0.64], [0.22, 1.05, -0.64], [-0.22, 1.05, -0.64]] },
      { geo: horn(0.04, 0.75), col: 0xd8ccb0, tex: 'horn', places: [[0.12, 2.56, 1.0, -0.45, 0, 0.5], [-0.12, 2.56, 1.0, -0.45, 0, -0.5]] },
      { geo: horn(0.03, 0.36), col: 0xd8ccb0, places: [[0.3, 2.9, 0.88, 0.7, 0, 0.2], [-0.3, 2.9, 0.88, 0.7, 0, -0.2], [0.2, 2.72, 0.95, 0.9, 0, 0.6], [-0.2, 2.72, 0.95, 0.9, 0, -0.6]] },   // tines
      { geo: ear(0.08, 0.26), col: [0x8a5e34, 0x6e4a2a], places: [[0.2, 2.52, 0.98, 0, 0, -1.1], [-0.2, 2.52, 0.98, 0, 0, 1.1]] },
      { geo: ell(0.07, 0.1, 0.06, 6), col: 0xf2ece0, places: [[0, 1.62, -0.98, 0.4, 0, 0]] },                                    // white scut
      { geo: ell(0.03, 0.03, 0.03, 6), col: EYE, places: [[0.13, 2.47, 1.2], [-0.13, 2.47, 1.2], [0, 2.34, 1.63]] },
    ] },
    boar: { parts: [
      { geo: ell(0.5, 0.52, 0.95), col: [0x4a3a30, 0x3a2c24], tex: 'fur', places: [[0, 0.98, 0, 0, 0, 0]] },
      { geo: ell(0.4, 0.44, 0.5), col: [0x443428, 0x34261e], tex: 'fur', places: [[0, 1.08, 0.72, 0.1, 0, 0]] },                 // shoulders
      { geo: ell(0.3, 0.3, 0.42), col: [0x3e3028, 0x30241e], tex: 'fur', places: [[0, 0.95, 1.22, 0.2, 0, 0]] },
      { geo: new THREE.CylinderGeometry(0.11, 0.16, 0.34, 8).rotateX(Math.PI / 2), col: 0x6a4a40, places: [[0, 0.84, 1.66, 0.15, 0, 0]] },   // snout
      { geo: horn(0.045, 0.34), col: 0xf0e8d8, tex: 'horn', places: [[0.17, 0.74, 1.56, -0.5, 0, 0.6], [-0.17, 0.74, 1.56, -0.5, 0, -0.6]] },
      { geo: new THREE.ConeGeometry(0.1, 0.34, 4).scale(0.5, 1, 1), col: 0x2a201a, places: [[0, 1.56, 0.7, -0.3], [0, 1.6, 0.4, -0.3], [0, 1.58, 0.1, -0.3], [0, 1.52, -0.2, -0.3], [0, 1.44, -0.5, -0.3]] },   // bristly ridge
      { geo: leg(0.11, 0.55), col: 0x2a201a, tex: 'fur', legs: true, places: [[0.28, 0.55, 0.6], [-0.28, 0.55, 0.6], [0.28, 0.55, -0.6], [-0.28, 0.55, -0.6]] },
      { geo: ear(0.1, 0.2), col: 0x2e221c, places: [[0.22, 1.3, 1.1, 0.2, 0, -0.5], [-0.22, 1.3, 1.1, 0.2, 0, 0.5]] },
      { geo: ell(0.03, 0.03, 0.03, 6), col: 0xd04030, places: [[0.2, 1.08, 1.5], [-0.2, 1.08, 1.5]] },
    ] },
    sheep: { parts: [                                                    // T18 livestock: woolly body, dark face
      { geo: ell(0.58, 0.55, 0.85, 12), col: [0xf2ede0, 0xd8d0bc], tex: 'wool', places: [[0, 1.02, 0, 0, 0, 0]] },
      { geo: ell(0.34, 0.32, 0.36), col: [0xf2ede0, 0xd8d0bc], tex: 'wool', places: [[0, 1.28, 0.62, 0, 0, 0], [0, 1.1, -0.72, 0, 0, 0]] },
      { geo: ell(0.17, 0.2, 0.27), col: 0x2e2a26, tex: 'fur', places: [[0, 1.22, 0.98, 0.35, 0, 0]] },
      { geo: ear(0.07, 0.22), col: 0x2e2a26, places: [[0.2, 1.32, 0.84, 0, 0, -1.5], [-0.2, 1.32, 0.84, 0, 0, 1.5]] },
      { geo: leg(0.075, 0.62), col: 0x2e2a26, legs: true, places: [[0.22, 0.62, 0.42], [-0.22, 0.62, 0.42], [0.22, 0.62, -0.42], [-0.22, 0.62, -0.42]] },
      { geo: ell(0.028, 0.028, 0.028, 6), col: 0xe8e0c8, places: [[0.12, 1.3, 1.1], [-0.12, 1.3, 1.1]] },
    ] },
    cow: { parts: [
      { geo: ell(0.56, 0.56, 1.1, 12), col: [0xf0ebe0, 0x7a4a2e], tex: 'hide', places: [[0, 1.45, 0, 0, 0, 0]] },
      { geo: ell(0.36, 0.3, 0.46), col: 0x2a2420, tex: 'hide', places: [[0.3, 1.66, 0.25, 0, 0, 0], [-0.32, 1.42, -0.5, 0, 0, 0], [0.1, 1.86, -0.55, 0, 0, 0]] },   // patches
      { geo: ell(0.26, 0.4, 0.3), col: [0xf0ebe0, 0x7a4a2e], tex: 'hide', places: [[0, 1.66, 1.0, 0.9, 0, 0]] },
      { geo: ell(0.25, 0.27, 0.36), col: [0xf0ebe0, 0x7a4a2e], tex: 'hide', places: [[0, 1.78, 1.32, 0.3, 0, 0]] },
      { geo: ell(0.2, 0.16, 0.14), col: 0xd89a8a, places: [[0, 1.62, 1.64, 0.3, 0, 0], [0, 0.98, -0.4, 0, 0, 0]] },             // muzzle, udder
      { geo: horn(0.05, 0.32), col: 0xe8dcc0, tex: 'horn', places: [[0.2, 2.02, 1.2, 0.2, 0, -0.9], [-0.2, 2.02, 1.2, 0.2, 0, 0.9]] },
      { geo: ear(0.09, 0.26), col: [0xe0d8c8, 0x6a4028], places: [[0.26, 1.9, 1.14, 0, 0, -1.5], [-0.26, 1.9, 1.14, 0, 0, 1.5]] },
      { geo: leg(0.12, 0.95), col: 0x3a302a, legs: true, places: [[0.3, 0.95, 0.72], [-0.3, 0.95, 0.72], [0.3, 0.95, -0.72], [-0.3, 0.95, -0.72]] },
      { geo: new THREE.CylinderGeometry(0.03, 0.045, 0.9, 5).translate(0, -0.45, 0), col: 0x3a302a, places: [[0, 1.7, -1.06, 0.15, 0, 0]] },   // tail
      { geo: ell(0.035, 0.035, 0.035, 6), col: EYE, places: [[0.2, 1.88, 1.46], [-0.2, 1.88, 1.46]] },
    ] },
    chicken: { parts: [                                                  // deathmatch food (core/dm.js): white or brown hens
      { geo: ell(0.27, 0.26, 0.38), col: [0xf4efe4, 0xa8652e], tex: 'feathers', places: [[0, 0.55, 0, -0.15, 0, 0]] },
      { geo: new THREE.ConeGeometry(0.2, 0.42, 6).scale(0.35, 1, 1), col: [0xe8e2d4, 0x6e3e1c], tex: 'feathers', places: [[0, 0.8, -0.36, -0.7, 0, 0]] },   // tail fan
      { geo: ell(0.1, 0.2, 0.26), col: [0xece6d8, 0x8f5424], tex: 'feathers', places: [[0.25, 0.56, -0.02, 0, 0, 0], [-0.25, 0.56, -0.02, 0, 0, 0]] },    // wings
      { geo: ell(0.14, 0.17, 0.15), col: [0xf4efe4, 0xa8652e], tex: 'feathers', places: [[0, 0.88, 0.28, 0, 0, 0]] },
      { geo: box(0.05, 0.12, 0.18), col: 0xd23a2a, places: [[0, 1.06, 0.28, 0, 0, 0], [0, 0.74, 0.4, 0, 0, 0]] },   // comb, wattle
      { geo: new THREE.ConeGeometry(0.05, 0.14, 4), col: 0xe8b23a, places: [[0, 0.87, 0.46, Math.PI / 2, 0, 0]] },
      { geo: leg(0.03, 0.32), col: 0xe8a23a, legs: true, places: [[0.1, 0.32, 0], [-0.1, 0.32, 0]] },
      { geo: ell(0.022, 0.022, 0.022, 6), col: EYE, places: [[0.1, 0.92, 0.36], [-0.1, 0.92, 0.36]] },
    ] },
    roast: { parts: [
      { geo: ell(0.55, 0.42, 0.5), col: [0x8a4a1e, 0x6a3416], tex: 'hide', places: [[0, 0.45, 0, 0.3, 0, 0.2]] },
      { geo: new THREE.CylinderGeometry(0.09, 0.12, 0.9, 6), col: 0xeee4cc, places: [[0.55, 0.42, 0.1, 0, 0, 1.25]] },
      { geo: new THREE.SphereGeometry(0.14, 8, 6), col: 0xeee4cc, places: [[1.0, 0.42, 0.1, 0, 0, 0]] },
    ] },
  };
  const CAP = 48;                        // instances per type (core caps a region at preyAi.maxActive)
  const DRAWN = { graze: 1, flee: 1, charge: 1, carried: 1, roast: 1 };
  const COOK_TIME = C.need('data').roast.cookTime, SCORCH = new THREE.Color(0x4a1e0c);

  function build() {
    const group = new THREE.Group(); group.name = 'prey';
    const kinds = {};
    for (const type of Object.keys(MODELS)) {
      const parts = MODELS[type].parts.map(pt => {
        const pm = new THREE.MeshStandardMaterial({ roughness: 0.9, color: Array.isArray(pt.col) ? 0xffffff : pt.col });
        if (pt.tex && root.VTex) root.VTex.detail(pm, { map: pt.tex, scale: pt.tex === 'wool' ? 0.7 : 0.9, strength: pt.tex === 'wool' ? 0.5 : 0.38, bump: pt.tex === 'wool' ? 0.9 : 0.5, local: true });
        const mesh = new THREE.InstancedMesh(pt.geo, pm, CAP * pt.places.length);
        // r128 sizes the instance colour buffer from mesh.count on the first setColorAt, so create it
        // for every instance before count drops to the number of animals actually drawn
        if (Array.isArray(pt.col)) { const c0 = new THREE.Color(pt.col[0]); for (let k = 0; k < mesh.count; k++) mesh.setColorAt(k, c0); }
        mesh.count = 0; mesh.frustumCulled = false;
        const locals = pt.places.map(([x, y, z, rx, ry, rz]) => new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(rx || 0, ry || 0, rz || 0)), new THREE.Vector3(1, 1, 1)));
        group.add(mesh);
        return { pt, mesh, locals };
      });
      kinds[type] = parts;
    }
    const base = new THREE.Matrix4(), m = new THREE.Matrix4(), swing = new THREE.Matrix4(), tmp = new THREE.Matrix4();
    const q = new THREE.Quaternion(), up = new THREE.Vector3(0, 1, 0), pos = new THREE.Vector3(), sc = new THREE.Vector3(VIS, VIS, VIS);
    const colA = new THREE.Color(), colB = new THREE.Color(), eul = new THREE.Euler();
    // T20 prey sense rings (one InstancedMesh, flat on the ground, seen through hills and trees)
    const SENSE_CAP = 160;
    const senseMat = new THREE.MeshBasicMaterial({ color: 0xe0a040, transparent: true, opacity: 0.55, depthWrite: false, depthTest: false, side: THREE.DoubleSide, fog: false });
    const senseGeo = new THREE.RingGeometry(1.15, 1.45, 24); senseGeo.rotateX(-Math.PI / 2);
    const sense = new THREE.InstancedMesh(senseGeo, senseMat, SENSE_CAP);
    sense.count = 0; sense.frustumCulled = false; sense.renderOrder = 4; group.add(sense);
    const sm = new THREE.Matrix4(), sq = new THREE.Quaternion(), sv = new THREE.Vector3(), ss = new THREE.Vector3();

    function senseRings(field, time, S) {
      let n = 0;
      if (S) for (const p of field.list) {
        if (n >= SENSE_CAP) break;
        if (p.state !== 'graze' && p.state !== 'flee' && p.state !== 'charge') continue;
        const d = Math.hypot(p.pos[0] - S.x, p.pos[2] - S.z);
        if (d > S.range) continue;
        const k = VIS * (p.size > 1 ? 1.3 : 1) * (1 + d / 120) * (1 + 0.06 * Math.sin(time * 3 + p.id));
        sense.setMatrixAt(n++, sm.compose(sv.set(p.pos[0], p.pos[1] + 0.3, p.pos[2]), sq, ss.set(k, 1, k)));
      }
      sense.count = n; sense.instanceMatrix.needsUpdate = true;
    }

    function update(field, time, carry, opts) {
      senseRings(field, time, opts && opts.sense);
      const counts = {};
      for (const type in kinds) counts[type] = 0;
      for (const p of field.list) {
        if (!DRAWN[p.state] || !kinds[p.type]) continue;
        const i = counts[p.type]++;
        if (i >= CAP) continue;
        let gait = Math.min(1, p.speed / 6) * 0.7, ph = p.t * (4 + p.speed * 0.9);
        if (p.state === 'carried' && carry && carry.id === p.id) {
          // hang the animal below the claws: back up, legs kicking, tilted with the dragon's pitch;
          // on the ground (T08) it is held across the jaws (body centre a little below the mouth)
          pos.set(carry.pos.x, carry.pos.y - (carry.jaws ? 2.1 : 1.9) * VIS * 0.55, carry.pos.z);
          q.setFromEuler(eul.set(carry.jaws ? 0 : -carry.pitch, carry.yaw + (carry.jaws ? Math.PI / 2 : 0), 0, 'YXZ'));
          gait = carry.jaws ? 0.4 : 0.9; ph = time * (carry.jaws ? 8 : 14);
        } else {
          pos.set(p.pos[0], p.pos[1], p.pos[2]);
          q.setFromAxisAngle(up, p.yaw);
        }
        base.compose(pos, q, sc);
        const shade = ((p.id * 2654435761) >>> 0) / 4294967296;        // stable per-animal variation
        for (const part of kinds[p.type]) {
          part.locals.forEach((L, k) => {
            if (part.pt.legs) {
              const a = Math.sin(ph + (k === 0 || k === 3 ? 0 : Math.PI)) * gait;   // diagonal pairs move together
              swing.makeRotationX(a);
              m.multiplyMatrices(base, tmp.multiplyMatrices(L, swing));
            } else m.multiplyMatrices(base, L);
            part.mesh.setMatrixAt(i * part.locals.length + k, m);
            if (Array.isArray(part.pt.col)) {
              colA.set(part.pt.col[0]).lerp(colB.set(part.pt.col[1]), shade);
              if (p.cook > 0 && p.state !== 'roast') colA.lerp(SCORCH, Math.min(1, p.cook / COOK_TIME) * 0.85);   // scorching as it heats
              part.mesh.setColorAt(i * part.locals.length + k, colA);
            }
          });
        }
      }
      for (const type in kinds) for (const part of kinds[type]) {
        part.mesh.count = Math.min(CAP, counts[type]) * part.locals.length;
        part.mesh.instanceMatrix.needsUpdate = true;
        if (part.mesh.instanceColor) part.mesh.instanceColor.needsUpdate = true;
      }
    }
    function dispose() {
      sense.geometry.dispose(); senseMat.dispose();
      for (const type in kinds) for (const part of kinds[type]) { part.mesh.geometry.dispose(); part.mesh.material.dispose(); if (part.mesh.dispose) part.mesh.dispose(); }
      if (group.parent) group.parent.remove(group);
    }
    return { group, update, dispose };
  }

  VR.prey = { build, VIS };
})(typeof self !== 'undefined' ? self : this);
