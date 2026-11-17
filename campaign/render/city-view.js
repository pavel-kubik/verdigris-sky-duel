/*
 * Verdigris campaign - Prahold and the villages on screen: the lots of core/city.js drawn by render/house-kit.js,
 * cobbled streets and squares draped over the terrain, village greens, and townsfolk walking the streets
 * (shared/human.js crowd, a few draw calls for all of them).
 *   VRender.cityView.build(regionId, { tier, crowd }) -> view | null (a region without a town)
 *     view.group                     add to the scene
 *     view.update(camPos, dt, night) LOD of the houses, the crowd walking near the camera, lit windows at night
 *     view.info()                    { lots, streets, people, calls, tris }
 *     view.dispose()
 */
(function (root) {
  'use strict';
  const THREE = root.THREE, C = root.VCamp;
  if (!THREE || !C) return;
  const VR = root.VRender = root.VRender || {};
  const T = C.need('terrain'), CI = C.need('city');
  const { mulberry } = C.need('math');

  const COL = { cobble: 0x8a8070, cobble2: 0x7a7266, square: 0x9c907c, green: 0x5f7d3a, kerb: 0x6b6458 };
  const LIFT = 0.14;

  /** One ribbon geometry for every street: quads along each polyline, every vertex on the ground. */
  function streetGeometry(id, streets) {
    const pos = [], col = [], idx = [], c = new THREE.Color(), c2 = new THREE.Color();
    for (const st of streets) {
      const pts = densify(st.pts, 3);
      if (pts.length < 2) continue;
      const base = pos.length / 3, w = st.w / 2 + 0.6;
      c.setHex(st.main ? COL.cobble2 : COL.cobble);
      for (let i = 0; i < pts.length; i++) {
        const a = pts[Math.max(0, i - 1)], b = pts[Math.min(pts.length - 1, i + 1)];
        let tx = b[0] - a[0], tz = b[1] - a[1]; const l = Math.hypot(tx, tz) || 1; tx /= l; tz /= l;
        for (const s of [-1, 1]) {
          const x = pts[i][0] + tz * w * s, z = pts[i][1] - tx * w * s;
          pos.push(x, T.surfaceAt(id, x, z) + LIFT, z);
          c2.copy(c).multiplyScalar(0.92 + 0.08 * Math.sin(i * 1.7 + s));
          col.push(c2.r, c2.g, c2.b);
        }
        if (i) { const k = base + (i - 1) * 2; idx.push(k, k + 2, k + 1, k + 1, k + 2, k + 3); }
      }
    }
    return mesh(pos, col, idx);
  }
  function densify(pts, step) {
    const out = [];
    for (let i = 0; i + 1 < pts.length; i++) {
      const [ax, az] = pts[i], [bx, bz] = pts[i + 1], n = Math.max(1, Math.ceil(Math.hypot(bx - ax, bz - az) / step));
      for (let k = 0; k < n; k++) out.push([ax + (bx - ax) * k / n, az + (bz - az) * k / n]);
    }
    if (pts.length) out.push(pts[pts.length - 1]);
    return out;
  }
  /** Squares and greens: a grid of small cells draped on the ground (discs or long rectangles). */
  function squareGeometry(id, squares) {
    const pos = [], col = [], idx = [], c = new THREE.Color();
    for (const sq of squares) {
      c.setHex(sq.green ? COL.green : COL.square);
      const S = 3, inside = sq.kind === 'circle' ? (u, v) => u * u + v * v <= (sq.r + 1.5) * (sq.r + 1.5)
        : (u, v) => Math.abs(u) <= sq.wid / 2 + 1 && Math.abs(v) <= sq.len / 2 + 1;
      const ext = sq.kind === 'circle' ? sq.r + 1.5 : Math.max(sq.wid, sq.len) / 2 + 1;
      const cs = Math.cos(sq.yaw || 0), sn = Math.sin(sq.yaw || 0);
      const n = Math.ceil(ext / S), grid = new Map();
      const vid = (i, j) => {
        const k = i * 1000 + j;
        if (grid.has(k)) return grid.get(k);
        const u = i * S, v = j * S, x = sq.x + u * cs + v * sn, z = sq.z - u * sn + v * cs;
        pos.push(x, T.surfaceAt(id, x, z) + LIFT + 0.02, z);
        const k2 = 0.94 + 0.06 * Math.sin(i * 2.1 + j * 1.3);
        col.push(c.r * k2, c.g * k2, c.b * k2);
        grid.set(k, pos.length / 3 - 1);
        return pos.length / 3 - 1;
      };
      for (let i = -n; i < n; i++) for (let j = -n; j < n; j++) {
        if (!inside((i + 0.5) * S, (j + 0.5) * S)) continue;
        const a = vid(i, j), b = vid(i + 1, j), d = vid(i, j + 1), e = vid(i + 1, j + 1);
        idx.push(a, d, b, b, d, e);
      }
    }
    return mesh(pos, col, idx);
  }
  function mesh(pos, col, idx) {
    if (!pos.length) return null;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    g.setIndex(idx);
    g.computeVertexNormals();
    g.computeBoundingSphere();
    return g;
  }

  function build(id, opts) {
    const city = CI.build(id);
    if (!city || !city.lots.length) return null;
    opts = opts || {};
    const tier = opts.tier || 'high';
    const group = new THREE.Group(); group.name = 'city:' + id;
    const ground = new THREE.MeshLambertMaterial({ vertexColors: true, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
    if (root.VTex && tier !== 'low') root.VTex.detail(ground, { map: 'cobble', scale: 4, strength: 0.55 });
    const parts = [];
    const sg = streetGeometry(id, city.streets), qg = squareGeometry(id, city.squares);
    for (const g of [sg, qg]) if (g) { const m = new THREE.Mesh(g, ground); m.receiveShadow = false; m.matrixAutoUpdate = false; group.add(m); parts.push(m); }
    const kit = VR.houseKit ? VR.houseKit.build(city.lots, { tier }) : null;
    if (kit) group.add(kit.group);

    // townsfolk on the streets of the districts (not the village greens): each walks to and fro along a street
    const streets = city.streets.filter(s => s.pts.length >= 6 && (city.districts || []).some(d => d.id === s.district));
    const nPeople = streets.length && root.VHuman && opts.crowd !== false ? (tier === 'low' ? 14 : tier === 'mid' ? 30 : 48) : 0;
    let crowd = null;
    const folk = [];
    const rnd = mulberry(4711 + id.length);
    if (nPeople) {
      crowd = root.VHuman.crowd(nPeople, { kinds: ['citizen', 'guard'], seed: 77, guardShare: 0.12 });
      group.add(crowd.group);
      for (let i = 0; i < nPeople; i++) folk.push({ st: null, s: 0, dir: 1, speed: 1.1 + rnd() * 0.8, side: (rnd() - 0.5) * 2, len: 0, pause: 0 });
    }
    const lenOf = st => { if (st.len == null) { let L = 0; for (let i = 0; i + 1 < st.pts.length; i++) L += Math.hypot(st.pts[i + 1][0] - st.pts[i][0], st.pts[i + 1][1] - st.pts[i][1]); st.len = L; } return st.len; };
    function at(st, s) {
      let k = 0, left = s;
      while (k + 1 < st.pts.length) {
        const a = st.pts[k], b = st.pts[k + 1], L = Math.hypot(b[0] - a[0], b[1] - a[1]);
        if (left <= L) return [a[0] + (b[0] - a[0]) * left / L, a[1] + (b[1] - a[1]) * left / L, Math.atan2(b[0] - a[0], b[1] - a[1])];
        left -= L; k++;
      }
      const a = st.pts[st.pts.length - 2], b = st.pts[st.pts.length - 1];
      return [b[0], b[1], Math.atan2(b[0] - a[0], b[1] - a[1])];
    }
    /** Puts walker f on a street near the camera (people far away are moved where they can be seen). */
    function place(f, cx, cz) {
      const near = streets.filter(s => Math.hypot(s.pts[0][0] - cx, s.pts[0][1] - cz) < 260 || Math.hypot(s.pts[s.pts.length - 1][0] - cx, s.pts[s.pts.length - 1][1] - cz) < 260);
      const list = near.length ? near : streets;
      f.st = list[Math.floor(rnd() * list.length)];
      f.len = lenOf(f.st); f.s = rnd() * f.len; f.dir = rnd() < 0.5 ? -1 : 1;
    }
    let lastNight = -1;
    function update(cam, dt, night) {
      if (kit) kit.update(cam);
      if (kit && night != null && Math.abs(night - lastNight) > 0.02) { kit.setNight(night); lastNight = night; }
      if (!crowd) return;
      for (let i = 0; i < folk.length; i++) {
        const f = folk[i];
        if (!f.st) place(f, cam.x, cam.z);
        if (f.pause > 0) f.pause -= dt; else f.s += f.dir * f.speed * dt;
        if (f.s < 0 || f.s > f.len) { f.dir = -f.dir; f.s = Math.max(0, Math.min(f.len, f.s)); f.pause = rnd() * 3; }
        const p = at(f.st, f.s), yaw = f.dir > 0 ? p[2] : p[2] + Math.PI;
        const off = (f.st.w / 2 - 0.2) * f.side, x = p[0] + Math.cos(p[2]) * off, z = p[1] - Math.sin(p[2]) * off;
        if (Math.hypot(x - cam.x, z - cam.z) > 420) { f.st = null; continue; }
        crowd.set(i, x, T.surfaceAt(id, x, z) + 0.05, z, yaw, f.pause > 0 ? 0 : f.speed);
      }
      crowd.update(dt);
    }
    function info() {
      const k = kit ? kit.info() : { calls: 0, tris: 0 };
      return { lots: city.lots.length, streets: city.streets.length, people: folk.length, calls: (k.calls || 0) + parts.length + (crowd ? crowd.drawCalls || 0 : 0), tris: k.tris || 0 };
    }
    function dispose() {
      if (group.parent) group.parent.remove(group);
      for (const m of parts) m.geometry.dispose();
      ground.dispose();
      if (kit) kit.dispose();
      if (crowd) crowd.dispose();
    }
    return { group, update, info, dispose, city };
  }

  VR.cityView = { build };
})(typeof self !== 'undefined' ? self : this);
