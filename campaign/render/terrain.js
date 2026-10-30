/*
 * Verdigris campaign - region terrain renderer.
 * Meshes core terrain.heightAt on the core GRID in CHUNK-sized pieces, with exactly the triangle
 * split terrain.surfaceAt assumes (diagonal 10-01 per cell), so the simulation collides with what
 * is drawn. Adds water, the volcano's lava and the lair cave mouth, and culls far chunks.
 *   VRender.terrain.build(regionId, { isTouch }) -> { group, fog, update(cameraPos), dispose(), info }
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
  };
  const EXTENT = 1500;                     // build chunks out to here (past the rim, hidden by fog)

  function colourFn(id, pal) {
    const c = new THREE.Color(), a = new THREE.Color(), b = new THREE.Color();
    const R = T.region(id);
    const cone = R.terrain.features.find(f => f.type === 'cone');
    const rimH = cone ? T.heightAt(id, cone.x + cone.crater.r, cone.z) : Infinity;
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
    if (pal.water != null) {
      const water = new THREE.Mesh(new THREE.CircleGeometry(EXTENT, 64), new THREE.MeshStandardMaterial({ color: pal.water, roughness: 0.25, metalness: 0.2, transparent: true, opacity: 0.88 }));
      water.rotation.x = -Math.PI / 2; water.position.y = 0.6; group.add(water);
    }
    const lavaFx = crater(id, group);
    const mouth = R.lair ? lairMouth(id, group) : null;
    const flora = VR.flora ? VR.flora.build(id, { isTouch: !!opts.isTouch }) : null;
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
