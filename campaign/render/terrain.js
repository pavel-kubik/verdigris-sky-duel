/*
 * Verdigris campaign - region terrain renderer.
 * Meshes core terrain.heightAt on the core GRID in CHUNK-sized pieces, with exactly the triangle
 * split terrain.surfaceAt assumes (diagonal 10-01 per cell), so the simulation collides with what
 * is drawn. Adds water, the volcano's lava and the lair cave mouth, and culls far chunks.
 *   VRender.terrain.build(regionId, { isTouch, flora, far }) -> { group, fog, update(cameraPos), dispose(), info }
 */
(function (root) {
  'use strict';
  const THREE = root.THREE, C = root.VCamp;
  if (!THREE || !C) return;
  const T = C.need('terrain'), D = C.need('data');
  const VR = root.VRender = root.VRender || {};

  const PALETTES = {
    ash: {
      fog: 0x6e5c4c, sky: { top: 0x15202a, mid: 0x4a4a48, bot: 0xc07a4a },
      low: 0x524840, mid: 0x3e3631, high: 0x2a2421, steep: 0x332c28, scorch: 0x5e2c1c, water: null,
    },
    forest: {
      fog: 0x7f8a70, sky: { top: 0x10283a, mid: 0x4f6f72, bot: 0xd09a64 },
      sand: 0xb39f74, low: 0x46683a, mid: 0x2f4f33, high: 0x5a6a48, steep: 0x6e6556, water: 0x2c5c63,
    },
    farm: {   // T11: open, sunny farmland; crops = wheat, young green, ploughed, hay
      fog: 0x9aa98e, sky: { top: 0x1f4a74, mid: 0x7aa0a8, bot: 0xe6bb80 },
      sand: 0xa89670, low: 0x6f9142, mid: 0x55783a, high: 0x7c8a52, steep: 0x7a705c, water: 0x3d7480,
      road: 0x9c8660, roadEdge: 0x7f7a4a, bank: 0x8b7d58, plateau: 0x7b8a4c,
      crops: [[0xc9ad55, 0xb39440], [0x86a845, 0x6f9238], [0x6e5438, 0x5a4430], [0xb0a058, 0x9a8c4a]],
    },
  };
  const EXTENT = 1500;                     // build chunks out to here (past the rim, hidden by fog)

  function colourFn(id, pal) {
    const c = new THREE.Color(), a = new THREE.Color(), b = new THREE.Color();
    const R = T.region(id);
    const cone = R.terrain.features.find(f => f.type === 'cone');
    const rimH = cone ? T.heightAt(id, cone.x + cone.crater.r, cone.z) : Infinity;
    const road = R.terrain.features.find(f => f.type === 'road'), roadW = road ? road.width : 0;
    return (x, z, h, slope, jitter) => {
      if (R.palette === 'ash') {
        const dCone = cone ? Math.hypot(x - cone.x, z - cone.z) : Infinity;
        a.set(pal.low); b.set(pal.mid);
        c.copy(a).lerp(b, (Math.sin(x * 0.021) * Math.cos(z * 0.017) + 1) / 2);
        if (dCone < cone.r) c.lerp(b.set(pal.high), Math.min(1, (1 - dCone / cone.r) * 1.6));
        if (h > rimH - 12 && dCone < cone.crater.r * 1.6) c.lerp(b.set(pal.scorch), 0.7);
        // old lava channels across the plain
        const flow = Math.sin(x * 0.006 + Math.sin(z * 0.011) * 2.2) * Math.sin(z * 0.004 + 1.1);
        if (dCone > cone.r * 0.6 && flow > 0.82) c.lerp(b.set(pal.scorch), Math.min(1, (flow - 0.82) * 7));
        if (slope > 0.7) c.lerp(b.set(pal.steep), Math.min(1, (slope - 0.7) * 2));
      } else if (R.palette === 'farm') {
        a.set(pal.low); b.set(pal.mid);
        c.copy(a).lerp(b, (Math.sin(x * 0.031) * Math.cos(z * 0.027) + 1) / 2);
        if (h > 30) c.lerp(b.set(pal.high), Math.min(1, (h - 30) / 16));
        const fd = T.fieldAt(id, x, z);
        if (fd) {                                                // crop rows along the field
          const cc = pal.crops[fd.f.crop], row = Math.sin(fd.u * fd.f.w * 1.1) > 0 ? 0 : 1;
          c.set(cc[row]);
        }
        if (T.plateauAt(id, x, z)) c.lerp(b.set(pal.plateau), 0.5);
        const rv = T.riverAt(id, x, z);
        if ((rv && h < rv.level + 1.6) || (R.waterLevel != null && h < R.waterLevel + 1.6)) c.set(pal.bank);   // muddy banks, pond shores
        const rd = T.lineDist(id, 'road', x, z), rw = roadW / 2;
        if (rd < rw) c.set(pal.road);
        else if (rd < rw + 3) c.lerp(b.set(pal.roadEdge), 0.6);
        if (slope > 0.6) c.lerp(b.set(pal.steep), Math.min(1, (slope - 0.6) * 2.5));
      } else {
        if (h < 2.2) c.set(pal.sand);
        else {
          a.set(pal.low); b.set(pal.mid);
          c.copy(a).lerp(b, (Math.sin(x * 0.05) * Math.cos(z * 0.04) + 1) / 2);
          if (h > 26) c.lerp(b.set(pal.high), Math.min(1, (h - 26) / 14));
        }
        if (slope > 0.55) c.lerp(b.set(pal.steep), Math.min(1, (slope - 0.55) * 2.5));
      }
      return [c.r * jitter, c.g * jitter, c.b * jitter];
    };
  }

  function buildChunk(id, cx, cz, mat, colour, rng) {
    const n = Math.round(T.CHUNK / T.GRID), g = T.GRID, x0 = cx * T.CHUNK, z0 = cz * T.CHUNK;
    const pos = new Float32Array((n + 1) * (n + 1) * 3), col = new Float32Array(pos.length);
    const hs = new Float32Array((n + 1) * (n + 1));
    for (let j = 0; j <= n; j++) for (let i = 0; i <= n; i++) {
      const k = j * (n + 1) + i, x = x0 + i * g, z = z0 + j * g, h = T.heightAt(id, x, z);
      hs[k] = h; pos[k * 3] = x; pos[k * 3 + 1] = h; pos[k * 3 + 2] = z;
    }
    for (let j = 0; j <= n; j++) for (let i = 0; i <= n; i++) {
      const k = j * (n + 1) + i, x = x0 + i * g, z = z0 + j * g;
      const slope = T.slopeAt(id, x, z, g / 2);
      const rgb = colour(x, z, hs[k], slope, 0.92 + rng() * 0.12);
      col[k * 3] = rgb[0]; col[k * 3 + 1] = rgb[1]; col[k * 3 + 2] = rgb[2];
    }
    // two triangles per cell: (00, 01, 10) and (11, 10, 01) - counter-clockwise seen from above (+Y)
    const idx = new (n * n * 6 > 65535 ? Uint32Array : Uint16Array)(n * n * 6);
    let p = 0;
    for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
      const a = j * (n + 1) + i, b = a + 1, c = a + (n + 1), d = c + 1;   // a=00 b=10 c=01 d=11
      idx[p++] = a; idx[p++] = c; idx[p++] = b;
      idx[p++] = d; idx[p++] = b; idx[p++] = c;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
    geo.setIndex(new THREE.BufferAttribute(idx, 1));
    geo.computeVertexNormals();
    geo.computeBoundingSphere();
    const mesh = new THREE.Mesh(geo, mat);
    mesh.matrixAutoUpdate = false; mesh.updateMatrix();
    mesh.userData.centre = new THREE.Vector3(x0 + T.CHUNK / 2, 0, z0 + T.CHUNK / 2);
    return mesh;
  }

  function lairMouth(id, group) {
    const L = T.region(id).lair, p = T.lairPos(id);
    const g = new THREE.Group();
    g.position.set(p[0], p[1], p[2]);
    g.rotation.y = L.facing;
    // the slope rises behind the mouth (toward the volcano), so tilt the opening back a little
    const tilt = Math.atan(T.slopeAt(id, L.x, L.z)) * 0.5;
    const rock = new THREE.MeshStandardMaterial({ color: 0x2c2522, flatShading: true, roughness: 1 });
    const dark = new THREE.MeshBasicMaterial({ color: 0x0a0605 });
    const hole = new THREE.Mesh(new THREE.CircleGeometry(11, 18), dark);
    hole.scale.set(1, 0.8, 1); hole.position.set(0, 0, -2.5); hole.rotation.x = -tilt; g.add(hole);
    const arch = new THREE.Mesh(new THREE.TorusGeometry(11.5, 3.4, 5, 12, Math.PI), rock);
    arch.scale.set(1, 0.85, 1); arch.position.set(0, -1.5, -2); arch.rotation.x = -tilt; g.add(arch);
    [-1, 1].forEach(s => {
      const boulder = new THREE.Mesh(new THREE.DodecahedronGeometry(4.2, 0), rock);
      boulder.position.set(s * 12.5, -5, 0); boulder.rotation.set(s, s * 2, 0); g.add(boulder);
    });
    const glow = new THREE.PointLight(0xff7a30, 1.4, 70, 2); glow.position.set(0, 0, -8); g.add(glow);
    group.add(g);
    return g;
  }

  function crater(id, group) {
    const f = T.region(id).terrain.features.find(ff => ff.type === 'cone' && ff.crater);
    if (!f) return null;
    const y = T.lavaLevel(id);
    const lava = new THREE.Mesh(new THREE.CircleGeometry(f.crater.r * 0.8, 28), new THREE.MeshBasicMaterial({ color: 0xff6a1e }));
    lava.rotation.x = -Math.PI / 2; lava.position.set(f.x, y, f.z); group.add(lava);
    const crust = new THREE.Mesh(new THREE.RingGeometry(f.crater.r * 0.45, f.crater.r * 0.62, 20, 1), new THREE.MeshBasicMaterial({ color: 0x9a2a10 }));
    crust.rotation.x = -Math.PI / 2; crust.position.set(f.x, y + 0.2, f.z); group.add(crust);
    const light = new THREE.PointLight(0xff6a20, 2.2, 420, 1.6); light.position.set(f.x, y + 30, f.z); group.add(light);
    return { lava, crust, light, y };
  }

  /** River water: a flat ribbon along each river at its level, as wide as the channel (the banks hide its edges). */
  function rivers(id, group, pal) {
    const list = T.region(id).terrain.features.filter(f => f.type === 'river');
    if (!list.length) return;
    const mat = new THREE.MeshStandardMaterial({ color: pal.water, roughness: 0.2, metalness: 0.25, transparent: true, opacity: 0.9 });
    for (const f of list) {
      const y = T.riverLevel(id, f), half = f.width / 2 * 1.4 + 1, P = [];
      // resample the polyline every 10 units so the ribbon bends smoothly at the joints
      for (let i = 0; i + 1 < f.points.length; i++) {
        const a = f.points[i], b = f.points[i + 1], n = Math.max(1, Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) / 10));
        for (let k = 0; k < n; k++) P.push([a[0] + (b[0] - a[0]) * k / n, a[1] + (b[1] - a[1]) * k / n]);
      }
      P.push(f.points[f.points.length - 1]);
      const pos = new Float32Array(P.length * 6), idx = [];
      P.forEach((p, i) => {
        const q0 = P[Math.max(0, i - 1)], q1 = P[Math.min(P.length - 1, i + 1)];
        let dx = q1[0] - q0[0], dz = q1[1] - q0[1];
        const L = Math.hypot(dx, dz) || 1; dx /= L; dz /= L;
        pos.set([p[0] - dz * half, y, p[1] + dx * half, p[0] + dz * half, y, p[1] - dx * half], i * 6);
        if (i) { const a = (i - 1) * 2; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
      });
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
      geo.setIndex(idx); geo.computeVertexNormals();
      // normals must face up whatever the winding: flip if needed
      if (geo.attributes.normal.getY(0) < 0) { const nn = geo.attributes.normal; for (let i = 0; i < nn.count; i++) nn.setXYZ(i, 0, 1, 0); }
      const m = new THREE.Mesh(geo, mat);
      m.material.side = THREE.DoubleSide;
      group.add(m);
    }
  }

  function build(id, opts) {
    opts = opts || {};
    const R = T.region(id), pal = PALETTES[R.palette];
    const group = new THREE.Group(); group.name = 'region:' + id;
    const rng = C.need('math').mulberry(R.seed * 977 + 1);
    const mat = new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 1, metalness: 0 });
    const colour = colourFn(id, pal);
    const chunks = [];
    const nC = Math.ceil(EXTENT / T.CHUNK);
    for (let cz = -nC; cz < nC; cz++) for (let cx = -nC; cx < nC; cx++) {
      const m = buildChunk(id, cx, cz, mat, colour, rng);
      chunks.push(m); group.add(m);
    }
    if (pal.water != null && R.waterLevel != null) {             // lakes and ponds: one plane at the region's water level
      const water = new THREE.Mesh(new THREE.CircleGeometry(EXTENT, 64), new THREE.MeshStandardMaterial({ color: pal.water, roughness: 0.25, metalness: 0.2, transparent: true, opacity: 0.88 }));
      water.rotation.x = -Math.PI / 2; water.position.y = R.waterLevel; group.add(water);
    }
    rivers(id, group, pal);
    const lavaFx = crater(id, group);
    const mouth = R.lair ? lairMouth(id, group) : null;
    const flora = VR.flora ? VR.flora.build(id, { isTouch: !!opts.isTouch, flora: opts.flora }) : null;
    if (flora) group.add(flora.group);

    let visible = chunks.length;
    const far = (opts.far || 950) + T.CHUNK * 0.75;
    function update(camPos, time) {
      visible = 0;
      for (const m of chunks) {
        const c = m.userData.centre;
        m.visible = Math.hypot(c.x - camPos.x, c.z - camPos.z) < far;
        if (m.visible) visible++;
      }
      if (lavaFx && time != null) {
        const k = 0.85 + Math.sin(time * 1.7) * 0.1 + Math.sin(time * 4.3) * 0.05;
        lavaFx.light.intensity = 2.2 * k;
        lavaFx.crust.rotation.z = time * 0.03;
      }
    }
    function dispose() {
      group.traverse(o => {
        if (o.geometry) o.geometry.dispose();
        if (o.material) (Array.isArray(o.material) ? o.material : [o.material]).forEach(m => m.dispose());
      });
      if (flora) flora.dispose();
      if (group.parent) group.parent.remove(group);
    }
    return {
      group, palette: pal, fog: pal.fog, sky: pal.sky, mouth, lava: lavaFx, update, dispose,
      get info() { return { chunks: chunks.length, visible, trees: flora ? flora.count.trees : 0, rocks: flora ? flora.count.rocks : 0 }; },
    };
  }

  VR.terrain = { build, PALETTES };
})(typeof self !== 'undefined' ? self : this);
