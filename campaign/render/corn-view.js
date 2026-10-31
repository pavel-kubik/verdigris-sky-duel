/*
 * Verdigris campaign - corn fields and popcorn (Pavel's request 2026-10-31, core/crops.js).
 *   VRender.corn.build(crops, { density }) -> { group, update(crops, dt, { pxScale, time }), dispose(), info }
 * Stalks: one InstancedMesh of stalks (green, leaves) and one of cobs over every corn field of the region, in rows
 * (`density` < 1 spaces them out on the low quality tier). Per spot (crops.state): corn = full stalk, popping = a hot
 * orange stalk that shakes, burned = a short black stub; cobs vanish once popped. Only fields whose state changed or
 * that burn right now are rewritten.
 * Popcorn: a fixed pool of kernels (one Points, cut-out sprites that write depth): the fire front throws them up
 * (data.popcorn), they fall, land on the ground and lie there for `life` s before they shrink away. A small additive
 * pool of flame sparks rides the front too.
 */
(function (root) {
  'use strict';
  const THREE = root.THREE, C = root.VCamp;
  if (!THREE || !C) return;
  const VR = root.VRender = root.VRender || {};
  const D = C.need('data'), T = C.need('terrain'), CR = C.need('crops');

  const COL = { stalk: new THREE.Color(0x5f8f2e), hot: new THREE.Color(0xff8a2a), stub: new THREE.Color(0x231b14), cob: new THREE.Color(0xe8c24a) };

  function stalkGeo(h) {
    const g = new THREE.CylinderGeometry(0.09, 0.16, h, 4).translate(0, h / 2, 0);
    const leaf = (y, a) => new THREE.PlaneGeometry(1.5, 0.28).translate(0.75, 0, 0).rotateZ(-0.5).rotateY(a).translate(0, y, 0);
    return merge([g, leaf(h * 0.35, 0.3), leaf(h * 0.55, 2.6), leaf(h * 0.75, 4.4)]);
  }
  function merge(list) {                           // non-indexed merge (positions + normals)
    const pos = [], nor = [];
    for (let g of list) {
      g = g.index ? g.toNonIndexed() : g;
      g.computeVertexNormals();
      pos.push(...g.attributes.position.array); nor.push(...g.attributes.normal.array);
    }
    const out = new THREE.BufferGeometry();
    out.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    out.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
    return out;
  }

  const kernelTex = (() => {                       // a puffy popcorn kernel: overlapping cream blobs with a shaded edge
    const c = document.createElement('canvas'); c.width = c.height = 64;
    const g = c.getContext('2d');
    const blobs = [[32, 26, 15], [20, 36, 13], [44, 37, 13], [31, 45, 12], [24, 22, 9], [42, 22, 9]];
    g.fillStyle = '#c9a86a'; for (const [x, y, r] of blobs) { g.beginPath(); g.arc(x, y, r + 2, 0, Math.PI * 2); g.fill(); }
    for (const [x, y, r] of blobs) {
      const gr = g.createRadialGradient(x - r * 0.3, y - r * 0.35, 1, x, y, r);
      gr.addColorStop(0, '#ffffff'); gr.addColorStop(0.7, '#fff3d6'); gr.addColorStop(1, '#ead2a0');
      g.fillStyle = gr; g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.fill();
    }
    g.fillStyle = '#c98a2c'; g.beginPath(); g.arc(30, 47, 4, 0, Math.PI * 2); g.fill();   // the hull bit
    return new THREE.CanvasTexture(c);
  })();
  const glowTex = (() => {
    const c = document.createElement('canvas'); c.width = c.height = 32;
    const g = c.getContext('2d'), gr = g.createRadialGradient(16, 16, 0, 16, 16, 16);
    gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.4, 'rgba(255,255,255,.5)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = gr; g.fillRect(0, 0, 32, 32);
    return new THREE.CanvasTexture(c);
  })();

  function pool(n, cutout) {
    const pos = new Float32Array(n * 3), col = new Float32Array(n * 3), size = new Float32Array(n);
    for (let i = 0; i < n; i++) pos[i * 3 + 1] = -9999;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('color', new THREE.BufferAttribute(col, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('size', new THREE.BufferAttribute(size, 1).setUsage(THREE.DynamicDrawUsage));
    const mat = new THREE.ShaderMaterial({
      uniforms: { map: { value: cutout ? kernelTex : glowTex }, scale: { value: 400 } },
      vertexShader: 'attribute float size; attribute vec3 color; varying vec3 vC; uniform float scale;' +
        'void main(){ vC = color; vec4 mv = modelViewMatrix * vec4(position, 1.0); gl_PointSize = size * scale / max(1.0, -mv.z); gl_Position = projectionMatrix * mv; }',
      fragmentShader: cutout
        ? 'uniform sampler2D map; varying vec3 vC; void main(){ vec4 t = texture2D(map, gl_PointCoord); if (t.a < 0.5) discard; gl_FragColor = vec4(t.rgb * vC, 1.0); }'
        : 'uniform sampler2D map; varying vec3 vC; void main(){ vec4 t = texture2D(map, gl_PointCoord); gl_FragColor = vec4(vC, t.a); }',
      transparent: !cutout, depthWrite: !!cutout, blending: cutout ? THREE.NormalBlending : THREE.AdditiveBlending,
    });
    const pts = new THREE.Points(g, mat);
    pts.frustumCulled = false;
    const P = { pts, pos, col, size, n, next: 0, vel: new Float32Array(n * 3), life: new Float32Array(n), ground: new Float32Array(n), base: new Float32Array(n), live: 0 };
    return P;
  }

  function build(crops, opts) {
    const group = new THREE.Group();
    group.name = 'cornView';
    const H = D.corn.height, density = Math.max(0.3, Math.min(1, (opts && opts.density) || 1));
    const rowGap = 2.2 / Math.sqrt(density), step = 1.8 / Math.sqrt(density);
    const spots = [];                              // per field: { c, from, to } ranges into the instance arrays
    const all = [];                                // { x, y, z, yaw, s }
    for (const c of (crops && crops.list) || []) {
      const f = c.f, s = Math.sin(f.yaw), co = Math.cos(f.yaw), from = all.length;
      for (let u = -f.w / 2 + rowGap / 2; u < f.w / 2; u += rowGap) {
        for (let v = -f.l / 2 + step / 2; v < f.l / 2; v += step) {
          const j = Math.sin(u * 12.9898 + v * 78.233) * 43758.5453, r = j - Math.floor(j);
          const uu = u + (r - 0.5) * 0.5, vv = v + (r - 0.5) * 0.6;
          const x = f.x + uu * co + vv * s, z = f.z - uu * s + vv * co;
          all.push({ x, z, y: T.surfaceAt(crops.region, x, z), yaw: r * 6.283, s: 0.8 + r * 0.4 });
        }
      }
      spots.push({ c, from, to: all.length, key: null });
    }
    const n = Math.max(1, all.length);
    const stalks = new THREE.InstancedMesh(stalkGeo(H), new THREE.MeshLambertMaterial({ side: THREE.DoubleSide }), n);
    const cobs = new THREE.InstancedMesh(new THREE.BoxGeometry(0.34, 0.8, 0.34).translate(0.22, H * 0.62, 0), new THREE.MeshLambertMaterial(), n);
    stalks.count = cobs.count = all.length;
    group.add(stalks, cobs);
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), v3 = new THREE.Vector3(), sc = new THREE.Vector3(), tmp = new THREE.Color();
    const HIDE = new THREE.Matrix4().makeScale(0, 0, 0);
    function put(i, state, time) {
      const a = all[i];
      const shake = state === 'popping' ? Math.sin(time * 40 + i) * 0.12 : 0;
      e.set(shake, a.yaw, shake * 0.7); q.setFromEuler(e);
      const hs = state === 'burned' ? 0.18 : a.s;
      sc.set(a.s, hs, a.s); v3.set(a.x, a.y, a.z);
      m.compose(v3, q, sc);
      stalks.setMatrixAt(i, m);
      tmp.copy(state === 'burned' ? COL.stub : state === 'popping' ? COL.hot : COL.stalk);
      if (state === 'corn') tmp.offsetHSL(0, 0, (a.s - 1) * 0.15);
      stalks.setColorAt(i, tmp);
      if (state === 'corn') { cobs.setMatrixAt(i, m); cobs.setColorAt(i, COL.cob); } else cobs.setMatrixAt(i, HIDE);
    }
    for (let i = 0; i < all.length; i++) put(i, 'corn', 0);

    const PC = D.popcorn;
    const kern = pool(PC.pool, true), spark = pool(Math.round(PC.pool / 3), false);
    group.add(kern.pts, spark.pts);
    const info = { fields: spots.length, stalks: all.length, popcorn: 0, burning: 0 };

    function emit(P, x, y, z, ground, up, side, size, r, g, b, life) {
      const i = P.next; P.next = (P.next + 1) % P.n;
      P.pos[i * 3] = x; P.pos[i * 3 + 1] = y; P.pos[i * 3 + 2] = z;
      const a = Math.random() * 6.283, sp = Math.random() * side;
      P.vel[i * 3] = Math.cos(a) * sp; P.vel[i * 3 + 1] = up; P.vel[i * 3 + 2] = Math.sin(a) * sp;
      P.ground[i] = ground; P.life[i] = life; P.base[i] = size; P.size[i] = size;
      P.col[i * 3] = r; P.col[i * 3 + 1] = g; P.col[i * 3 + 2] = b;
    }

    function stepPool(P, dt, grav, drag, settle) {
      let live = 0;
      for (let i = 0; i < P.n; i++) {
        if (P.life[i] <= 0) continue;
        const k = i * 3;
        if (P.vel[k + 1] !== 0 || P.pos[k + 1] > P.ground[i]) {
          P.vel[k + 1] -= grav * dt;
          P.vel[k] *= 1 - drag * dt; P.vel[k + 2] *= 1 - drag * dt;
          P.pos[k] += P.vel[k] * dt; P.pos[k + 1] += P.vel[k + 1] * dt; P.pos[k + 2] += P.vel[k + 2] * dt;
          if (settle && P.pos[k + 1] <= P.ground[i]) {      // lands: a small bounce, then it lies there
            P.pos[k + 1] = P.ground[i];
            if (P.vel[k + 1] < -6) { P.vel[k + 1] *= -0.3; P.vel[k] *= 0.5; P.vel[k + 2] *= 0.5; } else { P.vel[k] = P.vel[k + 1] = P.vel[k + 2] = 0; }
          }
        }
        P.life[i] -= dt;
        if (settle) P.size[i] = P.base[i] * Math.min(1, P.life[i] / 0.8);
        else P.size[i] = P.base[i] * Math.max(0, P.life[i]) * 2.2;
        if (P.life[i] <= 0) { P.pos[k + 1] = -9999; P.size[i] = 0; } else live++;
      }
      P.live = live;
      P.pts.geometry.attributes.position.needsUpdate = true;
      P.pts.geometry.attributes.size.needsUpdate = true;
      P.pts.geometry.attributes.color.needsUpdate = true;
    }

    function update(cr, dt, o) {
      const time = (o && o.time) || 0;
      if (o && o.pxScale) kern.pts.material.uniforms.scale.value = spark.pts.material.uniforms.scale.value = o.pxScale;
      let dirty = false, burning = 0;
      for (const sp of spots) {
        const c = sp.c, key = c.burnedAt != null ? 'b' : c.burn ? 'r' : 'c';
        if (c.burn) {
          burning++;
          for (let i = sp.from; i < sp.to; i++) put(i, CR.state(c, all[i].x, all[i].z), time);
          dirty = true;
          if (dt > 0) {                                        // popcorn and sparks along the front
            const b = c.burn, want = Math.min(PC.maxRate, PC.rate * 2 * Math.PI * Math.max(1, b.r)) * dt;
            let tries = Math.floor(want) + (Math.random() < want % 1 ? 1 : 0);
            while (tries-- > 0) {
              const a = Math.random() * 6.283, rr = b.r - Math.random() * D.corn.band;
              const x = b.ig[0] + Math.cos(a) * rr, z = b.ig[1] + Math.sin(a) * rr;
              if (!CR.inField(c.f, x, z)) continue;
              const g = T.surfaceAt(cr.region, x, z), w = 0.9 + Math.random() * 0.1;
              emit(kern, x, g + H * (0.4 + Math.random() * 0.5), z, g + 0.25, PC.up[0] + Math.random() * (PC.up[1] - PC.up[0]), PC.side,
                   PC.size * (0.8 + Math.random() * 0.5), w, w * (0.96 + Math.random() * 0.04), w * (0.86 + Math.random() * 0.1), PC.life + Math.random() * 2);
              if (Math.random() < 0.35) emit(spark, x, g + 0.5, z, -1e9, 3 + Math.random() * 4, 1.2, 1.6 + Math.random(), 1, 0.45 + Math.random() * 0.3, 0.1, 0.4 + Math.random() * 0.3);
            }
          }
        } else if (sp.key !== key) {
          for (let i = sp.from; i < sp.to; i++) put(i, key === 'b' ? 'burned' : 'corn', time);
          dirty = true;
        }
        sp.key = key;
      }
      if (dirty) {
        stalks.instanceMatrix.needsUpdate = true; cobs.instanceMatrix.needsUpdate = true;
        if (stalks.instanceColor) stalks.instanceColor.needsUpdate = true;
        if (cobs.instanceColor) cobs.instanceColor.needsUpdate = true;
      }
      if (dt > 0) { stepPool(kern, dt, PC.gravity, 0.6, true); stepPool(spark, dt, -4, 1.5, false); }
      info.popcorn = kern.live; info.burning = burning;
    }

    function dispose() {
      for (const o of [stalks, cobs, kern.pts, spark.pts]) { o.geometry.dispose(); o.material.dispose(); }
    }
    return { group, update, dispose, info, crops };
  }

  VR.corn = { build };
})(typeof self !== 'undefined' ? self : this);
