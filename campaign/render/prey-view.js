/*
 * Verdigris campaign - prey renderer.
 * Low-poly goats, deer, boars, sheep and cows (T18) built from primitives, drawn with one InstancedMesh per body part
 * per type (about 15 draw calls for every animal in a region). Legs swing with the animal's speed.
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
  const leg = (r, h) => { const g = new THREE.CylinderGeometry(r * 0.8, r, h, 5); g.translate(0, -h / 2, 0); return g; };   // pivot at the hip
  const horn = (r, h) => { const g = new THREE.ConeGeometry(r, h, 4); g.translate(0, h / 2, 0); return g; };

  /* part: geo, colour (or [a, b] for per-animal variation), places: list of [x, y, z, rx, ry, rz], legs: swing these */
  const MODELS = {
    goat: { parts: [
      { geo: box(0.7, 0.75, 1.5), col: [0xe8e2d4, 0x8f8578], places: [[0, 1.05, 0, 0, 0, 0]] },
      { geo: box(0.42, 0.45, 0.62), col: [0xe8e2d4, 0x8f8578], places: [[0, 1.55, 0.88, 0.35, 0, 0]] },
      { geo: leg(0.09, 0.72), col: 0x4a4238, legs: true, places: [[0.22, 0.72, 0.55], [-0.22, 0.72, 0.55], [0.22, 0.72, -0.55], [-0.22, 0.72, -0.55]] },
      { geo: horn(0.06, 0.5), col: 0xcfc4a8, places: [[0.12, 1.75, 0.78, -0.9, 0, 0.25], [-0.12, 1.75, 0.78, -0.9, 0, -0.25]] },
    ] },
    deer: { parts: [
      { geo: box(0.75, 0.85, 1.9), col: [0x9a6b3c, 0x7a5230], places: [[0, 1.45, 0, 0, 0, 0]] },
      { geo: box(0.3, 0.8, 0.32), col: [0x9a6b3c, 0x7a5230], places: [[0, 2.0, 0.85, -0.45, 0, 0]] },
      { geo: box(0.36, 0.38, 0.7), col: [0x8a5e34, 0x6e4a2a], places: [[0, 2.42, 1.15, 0.2, 0, 0]] },
      { geo: leg(0.08, 1.05), col: 0x5a3e24, legs: true, places: [[0.24, 1.05, 0.7], [-0.24, 1.05, 0.7], [0.24, 1.05, -0.7], [-0.24, 1.05, -0.7]] },
      { geo: horn(0.05, 0.8), col: 0xd8ccb0, places: [[0.14, 2.6, 1.05, -0.5, 0, 0.5], [-0.14, 2.6, 1.05, -0.5, 0, -0.5]] },
    ] },
    boar: { parts: [
      { geo: box(0.95, 0.95, 1.8), col: [0x4a3a30, 0x3a2c24], places: [[0, 0.95, 0, 0, 0, 0]] },
      { geo: box(0.7, 0.6, 0.7), col: [0x3e3028, 0x30241e], places: [[0, 0.95, 1.15, 0.15, 0, 0]] },
      { geo: box(0.32, 0.3, 0.3), col: 0x6a4a40, places: [[0, 0.82, 1.6, 0, 0, 0]] },
      { geo: horn(0.05, 0.35), col: 0xf0e8d8, places: [[0.2, 0.75, 1.55, -0.6, 0, 0.5], [-0.2, 0.75, 1.55, -0.6, 0, -0.5]] },
      { geo: box(0.12, 0.55, 0.9), col: 0x2a201a, places: [[0, 1.5, -0.1, 0, 0, 0]] },   // bristly ridge
      { geo: leg(0.11, 0.55), col: 0x2a201a, legs: true, places: [[0.3, 0.55, 0.6], [-0.3, 0.55, 0.6], [0.3, 0.55, -0.6], [-0.3, 0.55, -0.6]] },
    ] },
    sheep: { parts: [                                                    // T18 livestock: woolly body, dark face
      { geo: new THREE.DodecahedronGeometry(0.62, 0), col: [0xf2ede0, 0xd8d0bc], places: [[0, 1.0, 0, 0, 0, 0], [0, 1.02, -0.45, 0.4, 0.3, 0], [0, 1.0, 0.42, 0.2, 0.8, 0]] },
      { geo: box(0.36, 0.4, 0.5), col: 0x2e2a26, places: [[0, 1.22, 0.92, 0.3, 0, 0]] },
      { geo: box(0.22, 0.1, 0.16), col: 0x2e2a26, places: [[0.24, 1.32, 0.8, 0, 0, -0.4], [-0.24, 1.32, 0.8, 0, 0, 0.4]] },
      { geo: leg(0.08, 0.62), col: 0x2e2a26, legs: true, places: [[0.22, 0.62, 0.45], [-0.22, 0.62, 0.45], [0.22, 0.62, -0.45], [-0.22, 0.62, -0.45]] },
    ] },
    cow: { parts: [
      { geo: box(1.05, 1.0, 2.1), col: [0xf0ebe0, 0x7a4a2e], places: [[0, 1.45, 0, 0, 0, 0]] },
      { geo: box(0.7, 0.4, 0.9), col: 0x2a2420, places: [[0.38, 1.7, 0.2, 0, 0, 0], [-0.4, 1.35, -0.55, 0, 0, 0]] },   // patches
      { geo: box(0.5, 0.55, 0.65), col: [0xf0ebe0, 0x7a4a2e], places: [[0, 1.75, 1.3, 0.25, 0, 0]] },
      { geo: box(0.42, 0.3, 0.2), col: 0xd89a8a, places: [[0, 1.55, 1.66, 0.25, 0, 0]] },
      { geo: horn(0.05, 0.3), col: 0xe8dcc0, places: [[0.22, 2.05, 1.2, 0, 0, -0.9], [-0.22, 2.05, 1.2, 0, 0, 0.9]] },
      { geo: leg(0.12, 0.95), col: 0x3a302a, legs: true, places: [[0.32, 0.95, 0.75], [-0.32, 0.95, 0.75], [0.32, 0.95, -0.75], [-0.32, 0.95, -0.75]] },
    ] },
    roast: { parts: [
      { geo: new THREE.DodecahedronGeometry(0.55, 0), col: [0x8a4a1e, 0x6a3416], places: [[0, 0.45, 0, 0.3, 0, 0.2]] },
      { geo: new THREE.CylinderGeometry(0.09, 0.12, 0.9, 5), col: 0xeee4cc, places: [[0.55, 0.42, 0.1, 0, 0, 1.25]] },
      { geo: new THREE.SphereGeometry(0.14, 6, 4), col: 0xeee4cc, places: [[1.0, 0.42, 0.1, 0, 0, 0]] },
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
        const mesh = new THREE.InstancedMesh(pt.geo, new THREE.MeshStandardMaterial({ flatShading: true, roughness: 0.9, color: Array.isArray(pt.col) ? 0xffffff : pt.col }), CAP * pt.places.length);
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
