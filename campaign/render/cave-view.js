/*
 * Verdigris campaign - the cave hall (Phase 2 T10, core/cave.js; 002_task_kingdom.md section 6).
 * One dome mesh with rock vertex colours (open where the tunnel leaves), a flat basalt floor, a lava channel along
 * the back wall (emissive ribbon + one flickering point light), the nest (ash ring + bones), the larder slab with the
 * stored carcasses (the prey models, lying on their side), the exit tunnel with daylight at its end, and a ring on
 * the floor under the station in reach. Hoard and altar arrive with T19 / T20.
 *   VRender.cave.build() -> { group, update(cs, time), dispose() }     group starts hidden; game.js shows it inside
 */
(function (root) {
  'use strict';
  const THREE = root.THREE, C = root.VCamp;
  if (!THREE || !C) return;
  const VR = root.VRender = root.VRender || {};
  const D = C.need('data'), K = D.cave, MT = C.need('math');

  function rockColour(rnd, y, h) {
    const k = 0.55 + 0.45 * rnd(), warm = Math.max(0, 1 - y / (h * 0.45));     // lower rock catches the lava glow
    return new THREE.Color(0.17 * k + 0.16 * warm, 0.13 * k + 0.06 * warm, 0.11 * k + 0.03 * warm);
  }

  /** Dome: a hemisphere scaled to r x h, noisy, inside faces, with the tunnel opening cut out. */
  function dome(rnd) {
    const r = K.room.r, h = K.room.h, hw = K.tunnel.w / 2, th = K.tunnel.h;
    const g = new THREE.SphereGeometry(1, 44, 16, 0, Math.PI * 2, 0, Math.PI / 2).toNonIndexed();
    const pos = g.attributes.position, keep = [], cols = [], v = new THREE.Vector3();
    const jitter = new Map();
    const jit = (x, y, z) => {                                           // same offset for shared corners (no cracks)
      const key = Math.round(x * 1000) + ',' + Math.round(y * 1000) + ',' + Math.round(z * 1000);
      if (!jitter.has(key)) jitter.set(key, y > 0.98 ? 1 : 0.9 + 0.2 * rnd());
      return jitter.get(key);
    };
    for (let i = 0; i < pos.count; i += 3) {
      const tri = [];
      let cx = 0, cy = 0, cz = 0;
      for (let k = 0; k < 3; k++) {
        v.fromBufferAttribute(pos, i + k);
        const j = v.y > 0.02 ? jit(v.x, v.y, v.z) : 1;
        const p = [v.x * r * j, v.y * h * (0.95 + 0.05 * j), v.z * r * j];
        tri.push(p); cx += p[0] / 3; cy += p[1] / 3; cz += p[2] / 3;
      }
      if (cz > 0 && Math.abs(cx) < hw + 1 && cy < th + 1) continue;        // the tunnel mouth
      const c = rockColour(rnd, cy, h);
      for (const p of tri) { keep.push(p[0], p[1] + K.floor, p[2]); cols.push(c.r, c.g, c.b); }
    }
    g.dispose();
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(keep, 3));
    geo.setAttribute('color', new THREE.Float32BufferAttribute(cols, 3));
    geo.computeVertexNormals();
    return new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 1, side: THREE.BackSide }));
  }

  function floorMesh(rnd) {
    const g = new THREE.CircleGeometry(K.room.r + 2, 48, 0, Math.PI * 2).toNonIndexed();
    g.rotateX(-Math.PI / 2);
    const n = g.attributes.position.count, cols = [];
    for (let i = 0; i < n; i += 3) {
      const k = 0.7 + 0.3 * rnd(), c = new THREE.Color(0.2 * k, 0.15 * k, 0.12 * k);
      for (let j = 0; j < 3; j++) cols.push(c.r, c.g, c.b);
    }
    g.setAttribute('color', new THREE.Float32BufferAttribute(cols, 3));
    const m = new THREE.Mesh(g, new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 1 }));
    m.position.y = K.floor;
    return m;
  }

  /** Tunnel: floor, two walls and a ceiling from the hall out to the daylight at its end. */
  function tunnel() {
    const grp = new THREE.Group(), w = K.tunnel.w, h = K.tunnel.h, z0 = 40, z1 = K.tunnel.len + 30, len = z1 - z0;
    const rock = new THREE.MeshStandardMaterial({ color: 0x2e241e, flatShading: true, roughness: 1, side: THREE.DoubleSide });
    const add = (geo, x, y, z, rx, ry) => { const m = new THREE.Mesh(geo, rock); m.position.set(x, K.floor + y, z); m.rotation.set(rx || 0, ry || 0, 0); grp.add(m); };
    add(new THREE.PlaneGeometry(w + 2, len), 0, 0.02, z0 + len / 2, -Math.PI / 2);
    add(new THREE.PlaneGeometry(len, h + 2), -w / 2, h / 2, z0 + len / 2, 0, Math.PI / 2);
    add(new THREE.PlaneGeometry(len, h + 2), w / 2, h / 2, z0 + len / 2, 0, -Math.PI / 2);
    add(new THREE.PlaneGeometry(w + 2, len), 0, h, z0 + len / 2, Math.PI / 2);
    const day = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ color: 0xffd9a0, fog: false }));
    day.position.set(0, K.floor + h / 2, z1); day.rotation.y = Math.PI;
    grp.add(day);
    return grp;
  }

  /** Lava channel: an emissive ribbon on an arc along the back wall (behind the nest). */
  function lava() {
    const R = K.bounds - 1, a0 = Math.PI * 0.62, a1 = Math.PI * 1.38, n = 28, wd = 3.2, pts = [], idx = [];
    for (let i = 0; i <= n; i++) {
      const a = a0 + (a1 - a0) * i / n, wob = Math.sin(i * 1.7) * 1.2;
      for (const s of [-1, 1]) { const rr = R + wob + s * wd / 2; pts.push(Math.sin(a) * rr, K.floor + 0.08, Math.cos(a) * rr); }
      if (i < n) { const b = i * 2; idx.push(b, b + 2, b + 1, b + 1, b + 2, b + 3); }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3)); g.setIndex(idx); g.computeVertexNormals();
    return new THREE.Mesh(g, new THREE.MeshBasicMaterial({ color: 0xff6a1a, side: THREE.DoubleSide, fog: false }));
  }

  /** Nest: a low ring of ash with bones scattered in and around it (one instanced mesh). */
  function nest(rnd) {
    const grp = new THREE.Group(), s = K.stations.nest;
    const ash = new THREE.Mesh(new THREE.TorusGeometry(s[2] * 0.6, s[2] * 0.2, 6, 18), new THREE.MeshStandardMaterial({ color: 0x4a4440, flatShading: true, roughness: 1 }));
    ash.rotation.x = -Math.PI / 2; ash.scale.z = 0.45; ash.position.set(s[0], K.floor + 0.4, s[1]);
    const bed = new THREE.Mesh(new THREE.CircleGeometry(s[2] * 0.62, 18), new THREE.MeshStandardMaterial({ color: 0x5c5048, roughness: 1 }));
    bed.rotation.x = -Math.PI / 2; bed.position.set(s[0], K.floor + 0.05, s[1]);
    grp.add(ash, bed);
    const N = 18, bone = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.22, 0.28, 3, 5), new THREE.MeshStandardMaterial({ color: 0xe6dcc4, flatShading: true, roughness: 0.8 }), N);
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), p = new THREE.Vector3(), one = new THREE.Vector3(1, 1, 1);
    for (let i = 0; i < N; i++) {
      const a = rnd() * Math.PI * 2, rr = s[2] * (0.45 + 0.55 * rnd());
      p.set(s[0] + Math.sin(a) * rr, K.floor + 0.6 + rnd() * 0.4, s[1] + Math.cos(a) * rr);
      q.setFromEuler(e.set(Math.PI / 2 + (rnd() - 0.5) * 0.6, rnd() * Math.PI, 0));
      bone.setMatrixAt(i, m.compose(p, q, one.set(1, 0.6 + rnd() * 0.8, 1)));
    }
    grp.add(bone);
    return grp;
  }

  /** Hanging rock: stalactites from the dome (one instanced mesh). */
  function stalactites(rnd) {
    const N = 40, g = new THREE.ConeGeometry(1, 1, 5); g.rotateX(Math.PI); g.translate(0, -0.5, 0);
    const mesh = new THREE.InstancedMesh(g, new THREE.MeshStandardMaterial({ color: 0x3a2e26, flatShading: true, roughness: 1 }), N);
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), p = new THREE.Vector3(), sc = new THREE.Vector3();
    for (let i = 0; i < N; i++) {
      const a = rnd() * Math.PI * 2, rr = Math.sqrt(rnd()) * K.room.r * 0.85;
      const top = K.floor + K.room.h * Math.sqrt(Math.max(0, 1 - (rr * rr) / (K.room.r * K.room.r))) * 0.95;
      const len = 2 + rnd() * 5, wd = 0.6 + rnd() * 0.9;
      p.set(Math.sin(a) * rr, top + 0.5, Math.cos(a) * rr);
      mesh.setMatrixAt(i, m.compose(p, q, sc.set(wd, len, wd)));
    }
    return mesh;
  }

  function build() {
    const rnd = MT.mulberry(4711);
    const group = new THREE.Group(); group.name = 'cave'; group.visible = false;
    group.add(dome(rnd), floorMesh(rnd), tunnel(), lava(), nest(rnd), stalactites(rnd));
    // larder slab with the stored carcasses (prey models on their side)
    const L = K.stations.larder;
    const slab = new THREE.Mesh(new THREE.BoxGeometry(L[2] * 1.7, 1.4, L[2] * 1.1), new THREE.MeshStandardMaterial({ color: 0x55483e, flatShading: true, roughness: 1 }));
    slab.position.set(L[0], K.floor + 0.7, L[1]); slab.rotation.y = 0.3;
    group.add(slab);
    const carc = VR.prey.build(), carcHold = new THREE.Group();
    carcHold.position.set(L[0], K.floor + 1.4 + 0.55, L[1]); carcHold.rotation.set(0, 0.3, Math.PI / 2);   // lying on the side: local x = up
    carcHold.add(carc.group); group.add(carcHold);
    const larderField = { list: [] };
    // lights: one flickering point light over the lava, a warm fill so a phone screen reads the hall
    const LT = K.light;
    const glow = new THREE.PointLight(LT.color, LT.intensity, LT.distance, 1.4);
    glow.position.set(0, K.floor + 9, -K.bounds + 6);
    const fill = new THREE.HemisphereLight(0xa8744c, 0x3a2416, 0.95);
    const tunnelLight = new THREE.PointLight(0xffd2a0, 0.9, 60, 1.5);
    tunnelLight.position.set(0, K.floor + K.tunnel.h * 0.6, K.tunnel.len);
    group.add(glow, fill, tunnelLight);
    // station ring (the one in reach)
    const ringMat = new THREE.MeshBasicMaterial({ color: 0x62c48a, transparent: true, opacity: 0.6, depthWrite: false, side: THREE.DoubleSide, fog: false });
    const ring = new THREE.Mesh(new THREE.RingGeometry(0.9, 1, 40), ringMat);
    ring.rotation.x = -Math.PI / 2; ring.visible = false; group.add(ring);

    function update(cs, time) {
      glow.intensity = LT.intensity * (1 - LT.flicker * 0.5 + LT.flicker * 0.5 * (Math.sin(time * 7.3) * 0.6 + Math.sin(time * 13.1 + 1) * 0.4));
      const st = cs && cs.inLair ? cs.station : null, s = st && K.stations[st];
      ring.visible = !!s;
      if (s) {
        ring.position.set(s[0], K.floor + 0.12, s[1]);
        ring.scale.setScalar(s[2] + 1.5 + 0.25 * Math.sin(time * 4));
        ringMat.color.set(st === 'exit' ? 0xffd2a0 : 0x62c48a);
      }
      // carcasses: one per stored item, side by side across the slab (carcHold local: x = world up, y = across, z = along)
      const items = cs ? cs.larder : [];
      larderField.list.length = 0;
      items.forEach((it, i) => larderField.list.push({ id: 900 + i, type: it.type, state: 'graze', speed: 0, t: 0, cook: 0, yaw: 0,
        pos: [0, (i - (items.length - 1) / 2) * L[2] * 0.45, 0] }));
      carc.update(larderField, time);
    }
    function dispose() {
      group.traverse(o => { if (o.geometry) o.geometry.dispose(); if (o.material) o.material.dispose(); });
      if (group.parent) group.parent.remove(group);
    }
    return { group, update, dispose };
  }

  VR.cave = { build };
})(typeof self !== 'undefined' ? self : this);
