/*
 * Verdigris campaign - settlement renderer (Phase 2 T12).
 * Low-poly buildings from primitives, one vertex-coloured geometry per building type, drawn as one InstancedMesh
 * per type (about 11 draw calls for every building of a region) + one mesh for all livestock pen fences.
 *   VRender.settlements.build(town) -> { group, update(town, dt, opts), dispose(), info }
 *   update(town, dt, { cam, particles, pxScale, lights, time }): re-reads ruins (whole buildings and rubble are separate
 *     instanced meshes), darkens burning buildings as their hp falls (instance colour), and draws the fire (T13):
 *     flame and smoke particles from fixed pools (two Points, one draw call each), smoke from fresh ruins for a while,
 *     and moves the two flicker lights (opts.lights, owned by game.js so the light count never changes) to the burning
 *     buildings nearest the camera (intensity 0 when nothing burns).
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
  COL.char = 0x2a2420; COL.ash = 0x4a4440; COL.ember = 0x7a2e14;
  /** Rubble for every ruin (T13): charred blocks, a fallen beam and a stump of wall on a 5-radius footprint, scaled
   *  to the building's r (palisade pieces: along their length). */
  const RUIN = () => merge([
    [cyl(4.6, 5, 0.5, 9), COL.ash], [box(3, 1.4, 2.2, -1.8, 0.2, 1.2).rotateY(0.3), COL.char], [box(2.2, 2.2, 2, 2.2, 0.2, -1.4).rotateY(-0.4), COL.char],
    [box(0.5, 0.5, 7, 0.4, 0.7, 0).rotateY(0.9).rotateZ(0.12), COL.darkWood], [box(1.6, 3.2, 0.9, -2.6, 0.2, -2.2), COL.darkStone],
    [box(1.2, 0.6, 1.2, 1.2, 0.3, 2.6), COL.ember], [box(0.9, 1.8, 0.9, 3.1, 0.2, 1.8), COL.char],
  ]);

  /* fire and smoke particles: per-particle size and alpha (ShaderMaterial), one Points per pool */
  const tex = (() => {
    if (typeof document === 'undefined') return null;
    const c = document.createElement('canvas'); c.width = c.height = 64;
    const g = c.getContext('2d'), gr = g.createRadialGradient(32, 32, 0, 32, 32, 32);
    gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.4, 'rgba(255,255,255,0.55)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = gr; g.fillRect(0, 0, 64, 64);
    return new THREE.CanvasTexture(c);
  })();
  function pool(n, additive) {
    const pos = new Float32Array(n * 3), col = new Float32Array(n * 3), alpha = new Float32Array(n), size = new Float32Array(n);
    for (let i = 0; i < n; i++) pos[i * 3 + 1] = -9999;
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
    geo.setAttribute('alpha', new THREE.BufferAttribute(alpha, 1));
    geo.setAttribute('size', new THREE.BufferAttribute(size, 1));
    const mat = new THREE.ShaderMaterial({
      uniforms: { map: { value: tex }, scale: { value: 400 } },
      vertexShader: 'attribute float alpha; attribute float size; attribute vec3 color; varying float vA; varying vec3 vC; uniform float scale;' +
        'void main(){ vA = alpha; vC = color; vec4 mv = modelViewMatrix * vec4(position, 1.0); gl_PointSize = size * scale / max(1.0, -mv.z); gl_Position = projectionMatrix * mv; }',
      fragmentShader: 'uniform sampler2D map; varying float vA; varying vec3 vC; void main(){ vec4 t = texture2D(map, gl_PointCoord); gl_FragColor = vec4(vC, t.a * vA); }',
      transparent: true, depthWrite: false, blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
    });
    const pts = new THREE.Points(geo, mat); pts.frustumCulled = false;
    return { n, pos, col, alpha, size, geo, mat, pts, vel: new Float32Array(n * 3), life: new Float32Array(n), max: new Float32Array(n), s0: new Float32Array(n), next: 0, acc: new Map() };
  }
  function spawn(P, x, y, z, vx, vy, vz, life, size) {
    const i = P.next; P.next = (P.next + 1) % P.n;
    P.pos[i * 3] = x; P.pos[i * 3 + 1] = y; P.pos[i * 3 + 2] = z;
    P.vel[i * 3] = vx; P.vel[i * 3 + 1] = vy; P.vel[i * 3 + 2] = vz;
    P.life[i] = life; P.max[i] = life; P.s0[i] = size;
  }
  /** A random point on a building's footprint (palisade: along the piece), at fraction fy of its height. */
  function onBuilding(b, fy, out) {
    if (b.seg) { const k = Math.random(); out[0] = b.seg[0] + (b.seg[2] - b.seg[0]) * k; out[2] = b.seg[1] + (b.seg[3] - b.seg[1]) * k; }
    else { const a = Math.random() * Math.PI * 2, r = Math.sqrt(Math.random()) * b.r * 0.85; out[0] = b.pos[0] + Math.cos(a) * r; out[2] = b.pos[2] + Math.sin(a) * r; }
    out[1] = b.pos[1] + b.h * fy;
    return out;
  }

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
    let drawn = 0, current = null, pens = null, ruinMesh = null, ruinsDrawn = 0;
    const slot = new Map();                                   // building id -> [mesh, instance index] (whole buildings)
    const white = new THREE.Color(1, 1, 1), tint = new THREE.Color();
    const flames = pool(420, true), smoke = pool(260, false);
    group.add(flames.pts); group.add(smoke.pts);
    const smoulder = new Map();                              // ruin id -> seconds of smoke left (fresh ruins)
    const wasRuin = new Set();
    let burning = 0;

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
          m.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(list.length * 3).fill(1), 3);   // T13: char tint (shared material: every mesh needs one)
          group.add(m);
        }
        if (!m) continue;
        let k = 0;
        for (const b of list) {
          if (b.ruin || k >= m.instanceMatrix.count) continue;
          q.setFromAxisAngle(up, b.yaw || 0);
          sc.set(1, 1, b.seg ? b.len + 0.5 : 1);
          pv.set(b.pos[0], b.pos[1] - 0.15, b.pos[2]);       // sunk a little so no gap shows on a slight slope
          slot.set(b.id, [m, k]);
          m.setColorAt(k, charOf(b));
          m.setMatrixAt(k++, m4.compose(pv, q, sc));
        }
        m.count = k; m.instanceMatrix.needsUpdate = true; if (m.instanceColor) m.instanceColor.needsUpdate = true; drawn += k;
      }
      // rubble (T13): one instanced mesh for every ruin of the region
      const all = (t && t.buildings) || [];
      if (!ruinMesh && all.length) {
        ruinMesh = new THREE.InstancedMesh(RUIN(), mat, all.length);
        ruinMesh.name = 'b:ruin'; ruinMesh.frustumCulled = false; group.add(ruinMesh);
        ruinMesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(all.length * 3).fill(1), 3);
      }
      if (ruinMesh) {
        let k = 0;
        for (const b of all) {
          if (!b.ruin) continue;
          q.setFromAxisAngle(up, b.yaw || 0);
          if (b.seg) sc.set(0.3, 0.6, (b.len + 0.5) / 9); else { const f = Math.max(0.45, b.r / 5); sc.set(f, Math.min(1.4, 0.6 + b.h / 20), f); }
          pv.set(b.pos[0], b.pos[1] - 0.1, b.pos[2]);
          ruinMesh.setMatrixAt(k++, m4.compose(pv, q, sc));
        }
        ruinMesh.count = k; ruinMesh.instanceMatrix.needsUpdate = true; ruinsDrawn = k;
      }
      if (!pens && t && t.pens && t.pens.length) {
        const g = penMesh(t.pens);
        if (g) { pens = new THREE.Mesh(g, mat); pens.name = 'pens'; group.add(pens); }
      }
    }
    /** Instance colour: white when whole, darker as a burning building loses hp (charred). */
    function charOf(b) {
      const max = D.buildings[b.type].hp, dmg = max > 0 ? 1 - Math.max(0, b.hp) / max : 0;
      return dmg <= 0 ? white : tint.setRGB(1 - dmg * 0.72, 1 - dmg * 0.78, 1 - dmg * 0.8);
    }
    for (const b of (town && town.buildings) || []) if (b.ruin) wasRuin.add(b.id);
    sync(town);

    const pt = [0, 0, 0];
    function update(t, dt, o) {
      o = o || {};
      if (t !== current) { wasRuin.clear(); smoulder.clear(); for (const b of (t && t.buildings) || []) if (b.ruin) wasRuin.add(b.id); sync(t); }
      let ruins = 0;
      for (const b of (t && t.buildings) || []) if (b.ruin) ruins++;
      if (t && ruins !== ruinsDrawn) sync(t);
      dt = dt || 0;
      const cam = o.cam, mult = o.particles == null ? 1 : o.particles, lights = o.lights || [];
      flames.mat.uniforms.scale.value = smoke.mat.uniforms.scale.value = o.pxScale || 400;
      const hot = [];
      burning = 0;
      for (const b of (t && t.buildings) || []) {
        if (b.ruin) {
          if (!wasRuin.has(b.id)) { wasRuin.add(b.id); smoulder.set(b.id, 25); }
          const sm = smoulder.get(b.id);
          if (sm != null) {
            if (sm <= 0) smoulder.delete(b.id); else { smoulder.set(b.id, sm - dt); emitSmoke(b, dt * 0.5 * mult * (sm / 25), cam); }
          }
          continue;
        }
        wasRuin.delete(b.id);
        if (!(b.fire > 0)) continue;
        burning++;
        const sl = slot.get(b.id);
        if (sl) { sl[0].setColorAt(sl[1], charOf(b)); sl[0].instanceColor.needsUpdate = true; }
        const d = cam ? Math.hypot(cam.x - b.pos[0], cam.z - b.pos[2]) : 0;
        hot.push([d, b]);
        if (d > 600) continue;
        // flames: more for bigger buildings, licking up the walls, densest at the roof
        const size = b.seg ? 1.2 : 1 + b.r * 0.35;
        let a = (flames.acc.get(b.id) || 0) + dt * 26 * size * mult;
        while (a >= 1) {
          a--;
          onBuilding(b, 0.15 + Math.pow(Math.random(), 0.6) * 0.95, pt);
          spawn(flames, pt[0], pt[1], pt[2], (Math.random() - 0.5) * 2, 4 + Math.random() * 5, (Math.random() - 0.5) * 2, 0.5 + Math.random() * 0.6, 2.4 + Math.random() * 2 + b.r * 0.25);
        }
        flames.acc.set(b.id, a);
        emitSmoke(b, dt * mult * size, cam);
      }
      // the two flicker lights go to the burning buildings nearest the camera
      hot.sort((x, y) => x[0] - y[0]);
      const tm = o.time || 0;
      lights.forEach((L, i) => {
        const h = group.visible ? hot[i] : null;
        if (!h) { L.intensity = 0; return; }
        const b = h[1];
        L.position.set(b.pos[0], b.pos[1] + b.h * 0.7 + 2, b.pos[2]);
        L.intensity = 2.2 * (0.8 + 0.2 * Math.sin(tm * 17 + i * 2.1) + 0.12 * Math.sin(tm * 41 + i));
      });
      stepPool(flames, dt, true);
      stepPool(smoke, dt, false);
    }
    function emitSmoke(b, rate, cam) {
      if (cam && Math.hypot(cam.x - b.pos[0], cam.z - b.pos[2]) > 700) return;
      let a = (smoke.acc.get(b.id) || 0) + rate * 5;
      while (a >= 1) {
        a--;
        onBuilding(b, b.ruin ? 0.1 : 0.9, pt);
        spawn(smoke, pt[0], pt[1] + 1, pt[2], 1.2 + Math.random() * 1.2, 3 + Math.random() * 2.5, 0.6 + (Math.random() - 0.5) * 1.2, 4 + Math.random() * 2.5, 3 + b.r * 0.4);
      }
      smoke.acc.set(b.id, a);
    }
    function stepPool(P, dt, fire) {
      for (let i = 0; i < P.n; i++) {
        if (P.life[i] <= 0) continue;
        P.life[i] -= dt;
        const j = i * 3;
        if (P.life[i] <= 0) { P.pos[j + 1] = -9999; P.alpha[i] = 0; continue; }
        P.pos[j] += P.vel[j] * dt; P.pos[j + 1] += P.vel[j + 1] * dt; P.pos[j + 2] += P.vel[j + 2] * dt;
        const age = 1 - P.life[i] / P.max[i];
        if (fire) {                                           // yellow -> orange -> dark red, shrinking
          P.col[j] = 1; P.col[j + 1] = Math.max(0.12, 0.85 - age * 0.9); P.col[j + 2] = Math.max(0, 0.35 - age * 0.9);
          P.alpha[i] = (1 - age) * 0.9; P.size[i] = P.s0[i] * (1 - age * 0.55);
        } else {                                              // dark grey, growing and fading
          const g = 0.16 + age * 0.22; P.col[j] = g; P.col[j + 1] = g * 0.96; P.col[j + 2] = g * 0.92;
          P.alpha[i] = Math.min(1, age * 6) * (1 - age) * 0.55; P.size[i] = P.s0[i] * (1 + age * 2.6);
        }
      }
      P.geo.attributes.position.needsUpdate = true; P.geo.attributes.color.needsUpdate = true;
      P.geo.attributes.alpha.needsUpdate = true; P.geo.attributes.size.needsUpdate = true;
    }

    function dispose() {
      for (const k of Object.keys(meshes)) meshes[k].geometry.dispose();
      if (pens) pens.geometry.dispose();
      if (ruinMesh) ruinMesh.geometry.dispose();
      for (const P of [flames, smoke]) { P.geo.dispose(); P.mat.dispose(); }
      mat.dispose();
      if (group.parent) group.parent.remove(group);
    }

    return { group, update, dispose, get info() { return { buildings: drawn, ruins: ruinsDrawn, burning, types: Object.keys(meshes).length, pens: pens ? 1 : 0 }; } };
  }

  VR.settlements = { build, MODELS };
})(typeof self !== 'undefined' ? self : this);
