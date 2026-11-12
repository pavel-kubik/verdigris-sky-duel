/*
 * Verdigris Sky Duel - forest renderer for shared/forest.js (VForest): the same trees in the campaign, the co-op and
 * the deathmatch. Needs THREE (r128); shared/textures.js (VTex) gives bark and foliage their texture and the wind.
 *
 * One InstancedMesh per tree kind and part (trunk with its branches, crown), so a whole forest is a handful of draw
 * calls. Trees sway in the wind; a felled tree topples along the dragon's flight and lies on the ground with a splash
 * of leaves and splinters; a burning tree carries flames, embers and smoke, its crown chars and falls away and a black
 * snag is left; grown-back trees rise again.
 *
 *   VForestView.KINDS          tree models: conifer, broadleaf, poplar, deadwood, pine, birch (params below)
 *   VForestView.build(F, opts) -> { group, update(dt, time, camera, viewHeightPx), dispose(), info }
 *     F     a VForest forest; every tree: kind (index into opts.kinds), yaw, sc (scale), sy (height factor), tint
 *     opts  { kinds: [kind names or defs], particles: 0..1, lights: 0 | 1, groundAt(x, z), detail: false = no textures }
 *   VForestView.size(kind, sc, sy) -> { r, h }  crown radius and height of a tree of that kind (for VForest.create)
 *   VForestView.pool(n, additive) -> a particle pool (flames 0, embers 1, smoke 2, debris 3, thrown lava 4); the volcano uses it too
 */
(function (root) {
  'use strict';
  const THREE = root.THREE, VF = root.VForest;
  if (!THREE || !VF) return;
  const TAU = Math.PI * 2;

  /* trunk: [r top, r base, height, colour]; crown: shape, radius r, height h, centre y, colours [dark, light] */
  const KINDS = {
    conifer:   { trunk: [0.3, 0.75, 6, 0x4a3524], crown: { geo: 'tiers', r: 4.2, h: 12, y: 9, col: [0x24452a, 0x3d6a3a] }, tex: 'needles', texScale: 5 },
    pine:      { trunk: [0.35, 0.7, 9, 0x6a4a34], crown: { geo: 'tiers', r: 4.6, h: 7, y: 10.5, col: [0x2a4a2c, 0x4a7040], tiers: 3 }, tex: 'needles', texScale: 5 },
    broadleaf: { trunk: [0.55, 1.0, 6, 0x5a4029], crown: { geo: 'blobs', r: 5.2, h: 0, y: 8.5, col: [0x3f6a30, 0x6b8f3f] }, tex: 'leaves', texScale: 6 },
    birch:     { trunk: [0.3, 0.5, 7, 0xd8d4c4], crown: { geo: 'blobs', r: 3.8, h: 0, y: 8.5, col: [0x5f8a34, 0x9aa83e], tall: 1.25 }, tex: 'leaves', texScale: 5 },
    poplar:    { trunk: [0.35, 0.7, 5, 0x5a4632], crown: { geo: 'column', r: 2.6, h: 15, y: 11, col: [0x40682f, 0x63883c] }, tex: 'leaves', texScale: 5 },
    deadwood:  { trunk: [0.3, 0.8, 7.5, 0x2a221d], crown: null, tex: null },
  };
  const hash = VF.hash;

  /* ---------- small geometry builder (positions, smooth normals, vertex colours) ---------- */
  function Geo() { this.p = []; this.n = []; this.c = []; this.i = []; }
  Geo.prototype = {
    v(x, y, z, nx, ny, nz, col) { const l = Math.hypot(nx, ny, nz) || 1; this.p.push(x, y, z); this.n.push(nx / l, ny / l, nz / l); this.c.push(col[0], col[1], col[2]); return this.p.length / 3 - 1; },
    /** Tapered limb from a to b (radii ra, rb), n sides. */
    limb(a, b, ra, rb, n, col, colB) {
      let tx = b[0] - a[0], ty = b[1] - a[1], tz = b[2] - a[2]; const L = Math.hypot(tx, ty, tz) || 1; tx /= L; ty /= L; tz /= L;
      let rx = 0, ry = 1, rz = 0; if (Math.abs(ty) > 0.9) { rx = 1; ry = 0; }
      let ux = ry * tz - rz * ty, uy = rz * tx - rx * tz, uz = rx * ty - ry * tx; const ul = Math.hypot(ux, uy, uz) || 1; ux /= ul; uy /= ul; uz /= ul;
      const vx = ty * uz - tz * uy, vy = tz * ux - tx * uz, vz = tx * uy - ty * ux, r0 = [], r1 = [];
      for (let j = 0; j <= n; j++) {
        const an = j / n * TAU, ca = Math.cos(an), sa = Math.sin(an), nx = ux * ca + vx * sa, ny = uy * ca + vy * sa, nz = uz * ca + vz * sa;
        r0.push(this.v(a[0] + nx * ra, a[1] + ny * ra, a[2] + nz * ra, nx, ny, nz, col));
        r1.push(this.v(b[0] + nx * rb, b[1] + ny * rb, b[2] + nz * rb, nx, ny, nz, colB || col));
      }
      for (let j = 0; j < n; j++) this.i.push(r0[j], r0[j + 1], r1[j], r0[j + 1], r1[j + 1], r1[j]);
      if (rb > 0.05) { const c = this.v(b[0], b[1], b[2], tx, ty, tz, colB || col); for (let j = 0; j < n; j++) this.i.push(r1[j], r1[j + 1], c); }
    },
    /** A lumpy ball of foliage: radii r, centre c; shade(ny) -> colour. */
    blob(c, r, seed, shade, nu, nv, lump) {
      nu = nu || 8; nv = nv || 5; const rows = [], K = lump == null ? 0.22 : lump;
      for (let j = 0; j <= nv; j++) {
        const ph = j / nv * Math.PI, y = Math.cos(ph), sr = Math.sin(ph), row = [];
        for (let i = 0; i <= nu; i++) {
          const ii = i % nu, th = ii / nu * TAU, lx = Math.cos(th) * sr, lz = Math.sin(th) * sr;
          const d = j === 0 || j === nv ? 1 : 1 + (hash(seed * 31 + ii, j) - 0.5) * 2 * K;
          row.push(this.v(c[0] + lx * r[0] * d, c[1] + y * r[1] * d, c[2] + lz * r[2] * d, lx / r[0], y / r[1], lz / r[2], shade(y, hash(seed * 17 + ii, j + 40))));
        }
        rows.push(row);
      }
      for (let j = 0; j < nv; j++) for (let i = 0; i < nu; i++) this.i.push(rows[j][i], rows[j][i + 1], rows[j + 1][i], rows[j][i + 1], rows[j + 1][i + 1], rows[j + 1][i]);
    },
    /** One whorl of conifer boughs: a cone skirt from the apex (0, y1, 0) down to a jagged rim of radius r at y0. */
    tier(y0, y1, r, rTop, n, seed, colIn, colOut) {
      const top = [], rim = [], slope = (r - rTop) / (y1 - y0);
      for (let j = 0; j <= n; j++) {
        const jj = j % n, an = jj / n * TAU + seed, ca = Math.cos(an), sa = Math.sin(an);
        const jag = jj % 2 ? 0.74 + hash(seed * 13 + jj, 2) * 0.1 : 1 + hash(seed * 13 + jj, 3) * 0.1, lift = jj % 2 ? (y1 - y0) * 0.18 : 0;
        top.push(this.v(ca * rTop, y1, sa * rTop, ca, slope, sa, colIn));
        rim.push(this.v(ca * r * jag, y0 + lift, sa * r * jag, ca, slope, sa, colOut));
      }
      const c = this.v(0, y0 + (y1 - y0) * 0.3, 0, 0, -1, 0, colIn.map(x => x * 0.55));
      for (let j = 0; j < n; j++) { this.i.push(rim[j], top[j], rim[j + 1], rim[j + 1], top[j], top[j + 1]); this.i.push(rim[j + 1], c, rim[j]); }   // skirt + dark underside
    },
    build() {
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(this.p, 3));
      g.setAttribute('normal', new THREE.Float32BufferAttribute(this.n, 3));
      g.setAttribute('color', new THREE.Float32BufferAttribute(this.c, 3));
      g.setIndex(this.i); g.computeBoundingSphere();
      return g;
    },
  };
  const rgb = hex => [((hex >> 16) & 255) / 255, ((hex >> 8) & 255) / 255, (hex & 255) / 255];
  const mixc = (a, b, k) => [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k, a[2] + (b[2] - a[2]) * k];

  function trunkGeo(K) {
    const g = new Geo(), [r0, r1, h, hex] = K.trunk, col = rgb(hex), dark = col.map(x => x * 0.7);
    g.limb([0, -0.8, 0], [0, h * 0.5, 0], r1 * 1.25, (r0 + r1) / 2, 7, dark, col);                    // flared root
    g.limb([0, h * 0.5, 0], [0, h, 0], (r0 + r1) / 2, r0, 7, col, col);
    const C = K.crown;
    if (!C) {                                                    // dead wood: bare, broken branches
      [[0.55, 0.9, 0.5, 3.4], [0.72, 3.0, 0.62, 2.8], [0.86, 4.9, 0.38, 2.0], [0.4, 5.6, 0.75, 1.6]].forEach(([k, a, tilt, len]) => {
        const y = h * k, dx = Math.cos(a), dz = Math.sin(a);
        g.limb([0, y, 0], [dx * len * Math.cos(tilt), y + len * Math.sin(tilt), dz * len * Math.cos(tilt)], r0 * 0.9, 0.06, 5, col, dark);
        g.limb([dx * len * 0.55 * Math.cos(tilt), y + len * 0.55 * Math.sin(tilt), dz * len * 0.55 * Math.cos(tilt)],
          [dx * len * 0.7 * Math.cos(tilt) - dz * len * 0.3, y + len * 0.95 * Math.sin(tilt), dz * len * 0.7 * Math.cos(tilt) + dx * len * 0.3], r0 * 0.4, 0.04, 4, col, dark);
      });
      g.limb([0, h, 0], [0.3, h + 1.2, 0.2], r0, 0.05, 5, col, dark);
    } else if (C.geo === 'tiers') {                              // the leader up through the boughs (shows when the needles burn off)
      g.limb([0, h, 0], [0, C.y + C.h * 0.5 - 0.6, 0], r0, 0.07, 5, col, dark);
      for (let k = 0; k < 6; k++) { const a = k * 2.4, y = h * 0.8 + k * C.h * 0.11, len = C.r * (0.6 - k * 0.07); g.limb([0, y, 0], [Math.cos(a) * len, y - 0.3, Math.sin(a) * len], r0 * 0.4, 0.04, 4, col, dark); }
    } else {                                                     // boughs reaching into the canopy
      const top = C.geo === 'column' ? C.y + C.h * 0.3 : C.y + C.r * 0.3;
      g.limb([0, h, 0], [0.2, top, 0.1], r0, 0.08, 5, col, dark);
      for (let k = 0; k < 4; k++) { const a = k * 1.7 + 0.4, len = C.r * 0.62, y = h * (0.75 + k * 0.08); g.limb([0, y, 0], [Math.cos(a) * len, y + len * (C.geo === 'column' ? 1.4 : 0.75), Math.sin(a) * len], r0 * 0.6, 0.05, 5, col, dark); }
    }
    return g.build();
  }
  function crownGeo(K) {
    const C = K.crown, g = new Geo();
    if (C.geo === 'tiers') {
      const n = C.tiers || 4, y0 = C.y - C.h / 2, y1 = C.y + C.h / 2;
      for (let j = 0; j < n; j++) {
        const k = j / n, r = C.r * (1 - k * 0.72), yb = y0 + (y1 - y0) * k * 0.86, yt = j === n - 1 ? y1 : yb + (y1 - y0) * (0.5 - k * 0.1);
        g.tier(yb, yt, r, j === n - 1 ? 0.02 : r * 0.16, 9, j * 0.7 + 0.3, [0.5, 0.5, 0.5], [1, 1, 1]);
      }
    } else if (C.geo === 'column') {
      const sh = (y, n) => { const k = 0.62 + 0.38 * (y * 0.5 + 0.5) + (n - 0.5) * 0.16; return [k, k, k]; };
      g.blob([0, C.y - C.h * 0.12, 0], [C.r, C.h * 0.42, C.r], 3, sh, 8, 7, 0.14);
      g.blob([C.r * 0.2, C.y + C.h * 0.24, -C.r * 0.1], [C.r * 0.66, C.h * 0.3, C.r * 0.66], 5, sh, 7, 5, 0.14);
    } else {
      const sh = (y, n) => { const k = 0.56 + 0.44 * (y * 0.5 + 0.5) + (n - 0.5) * 0.2; return [k, k, k]; }, t = C.tall || 1, r = C.r;
      g.blob([0, C.y + r * 0.12 * t, 0], [r * 0.78, r * 0.74 * t, r * 0.78], 1, sh, 9, 6);
      g.blob([r * 0.52, C.y - r * 0.18, r * 0.18], [r * 0.56, r * 0.5 * t, r * 0.56], 2, sh, 8, 5);
      g.blob([-r * 0.44, C.y - r * 0.1, r * 0.36], [r * 0.54, r * 0.5 * t, r * 0.52], 3, sh, 8, 5);
      g.blob([-r * 0.12, C.y - r * 0.14, -r * 0.52], [r * 0.56, r * 0.48 * t, r * 0.54], 4, sh, 8, 5);
    }
    return g.build();
  }
  /** Crown radius and height of a tree of this kind at scale sc (height x sy). */
  function size(kind, sc, sy) {
    const K = typeof kind === 'string' ? KINDS[kind] : kind, C = K.crown;
    const top = C ? (C.geo === 'blobs' ? C.y + C.r * 0.9 * (C.tall || 1) : C.y + C.h / 2) : K.trunk[2] + 1;
    return { r: (C ? C.r : 1.1) * sc, h: top * sc * (sy || 1) };
  }

  /* ---------- particles: additive flames and embers, alpha-blended smoke, leaves and splinters ---------- */
  const P_VERT = 'attribute vec3 pcolor;attribute float alpha;attribute float size;uniform float uScale;varying vec3 vC;varying float vA;void main(){vC=pcolor;vA=alpha;vec4 mv=modelViewMatrix*vec4(position,1.);gl_PointSize=size*uScale/max(-mv.z,.1);gl_Position=projectionMatrix*mv;}';
  function pool(n, additive) {
    const pos = new Float32Array(n * 3), col = new Float32Array(n * 3), al = new Float32Array(n), sz = new Float32Array(n);
    const vel = new Float32Array(n * 3), life = new Float32Array(n), max = new Float32Array(n), s0 = new Float32Array(n), kind = new Uint8Array(n), base = new Float32Array(n * 3);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute('pcolor', new THREE.BufferAttribute(col, 3).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute('alpha', new THREE.BufferAttribute(al, 1).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute('size', new THREE.BufferAttribute(sz, 1).setUsage(THREE.DynamicDrawUsage));
    const mat = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending, uniforms: { uScale: { value: 500 } },
      vertexShader: P_VERT,
      fragmentShader: additive
        ? 'varying vec3 vC;varying float vA;void main(){float d=length(gl_PointCoord-.5);if(d>.5)discard;float a=smoothstep(.5,.05,d)*vA;gl_FragColor=vec4(vC*a,a);}'
        : 'varying vec3 vC;varying float vA;void main(){float d=length(gl_PointCoord-.5);if(d>.5)discard;gl_FragColor=vec4(vC,smoothstep(.5,.15,d)*vA);}',
    });
    const points = new THREE.Points(geo, mat); points.frustumCulled = false;
    const P = { n: 0, cap: n, points, mat, geo,
      spawn(x, y, z, vx, vy, vz, lf, size, k, r, g, b) {
        if (P.n >= n) return;
        const i = P.n++, o = i * 3;
        pos[o] = x; pos[o + 1] = y; pos[o + 2] = z; vel[o] = vx; vel[o + 1] = vy; vel[o + 2] = vz;
        life[i] = max[i] = lf; s0[i] = size; kind[i] = k; base[o] = r == null ? 1 : r; base[o + 1] = g == null ? 1 : g; base[o + 2] = b == null ? 1 : b;
      },
      step(dt) {
        for (let i = 0; i < P.n; i++) {
          life[i] -= dt;
          if (life[i] <= 0) {
            const l = --P.n;
            if (i !== l) { for (let q = 0; q < 3; q++) { pos[i * 3 + q] = pos[l * 3 + q]; vel[i * 3 + q] = vel[l * 3 + q]; base[i * 3 + q] = base[l * 3 + q]; } life[i] = life[l]; max[i] = max[l]; s0[i] = s0[l]; kind[i] = kind[l]; }
            i--; continue;
          }
          const o = i * 3, k = kind[i], tt = life[i] / max[i];
          if (k === 0) { vel[o + 1] += 5 * dt; vel[o] *= 1 - dt; vel[o + 2] *= 1 - dt; }                 // flame: rises, narrows
          else if (k === 1) { vel[o + 1] -= 4 * dt; vel[o] += (Math.random() - 0.5) * 8 * dt; }       // ember: drifts down
          else if (k === 2) { vel[o] *= 1 - dt * 0.6; vel[o + 2] *= 1 - dt * 0.6; vel[o] += 1.2 * dt; }  // smoke: leans downwind
          else if (k === 4) vel[o + 1] -= 26 * dt;                                                          // lava: thrown, falls back
          else { vel[o + 1] -= 12 * dt; vel[o] *= 1 - dt * 1.5; vel[o + 2] *= 1 - dt * 1.5; }             // debris: falls
          pos[o] += vel[o] * dt; pos[o + 1] += vel[o + 1] * dt; pos[o + 2] += vel[o + 2] * dt;
          if (k === 0) { sz[i] = s0[i] * (0.5 + tt * 0.9); al[i] = Math.min(1, tt * 2.2) * 0.8; col[o] = 1; col[o + 1] = 0.2 + 0.72 * tt * tt; col[o + 2] = 0.04 + 0.4 * tt * tt * tt; }
          else if (k === 1) { sz[i] = s0[i]; al[i] = Math.min(1, tt * 3); col[o] = 1; col[o + 1] = 0.5 + 0.4 * tt; col[o + 2] = 0.2 * tt; }
          else if (k === 2) { sz[i] = s0[i] * (1 + (1 - tt) * 2.4); al[i] = Math.sin(Math.PI * Math.min(1, (1 - tt) * 1.4 + 0.08)) * 0.3; col[o] = base[o]; col[o + 1] = base[o + 1]; col[o + 2] = base[o + 2]; }
          else if (k === 4) { sz[i] = s0[i] * (0.55 + 0.45 * tt); al[i] = Math.min(1, tt * 5); col[o] = 1; col[o + 1] = 0.16 + 0.7 * tt * tt; col[o + 2] = 0.02 + 0.3 * tt * tt * tt; }
          else { sz[i] = s0[i]; al[i] = Math.min(1, tt * 3); col[o] = base[o]; col[o + 1] = base[o + 1]; col[o + 2] = base[o + 2]; }
        }
        geo.setDrawRange(0, P.n);
        geo.attributes.position.needsUpdate = geo.attributes.pcolor.needsUpdate = geo.attributes.alpha.needsUpdate = geo.attributes.size.needsUpdate = true;
      },
    };
    return P;
  }

  function build(F, opts) {
    opts = opts || {};
    const TX = root.VTex && opts.detail !== false ? root.VTex : null;
    const kinds = (opts.kinds || ['conifer', 'broadleaf']).map(k => (typeof k === 'string' ? KINDS[k] : k));
    const group = new THREE.Group(); group.name = 'forest';
    const fxK = opts.particles == null ? 1 : opts.particles;
    const fire = pool(Math.round(2600 * Math.max(0.3, fxK)), true), haze = pool(Math.round(600 * Math.max(0.3, fxK)), false);
    haze.points.renderOrder = 2; fire.points.renderOrder = 3;
    group.add(haze.points); group.add(fire.points);
    const light = opts.lights === 0 ? null : new THREE.PointLight(0xff7a2a, 0, 110, 2);
    if (light) group.add(light);

    /* one trunk and one crown InstancedMesh per kind */
    const byKind = kinds.map(() => []), slot = new Int32Array(F.list.length);
    F.list.forEach(t => { const k = Math.min(kinds.length - 1, t.kind | 0); slot[t.i] = byKind[k].length; byKind[k].push(t.i); });
    const meshes = [], parts = kinds.map((K, ki) => {
      const n = byKind[ki].length;
      if (!n) return null;
      const tm = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1, metalness: 0 });
      if (TX) TX.detail(tm, { map: K.crown ? 'bark' : 'soot', scale: 2.2, strength: 0.7, bump: 1, local: true });
      const trunk = new THREE.InstancedMesh(trunkGeo(K), tm, n);
      let crown = null;
      if (K.crown) {
        const cm = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95, metalness: 0 });
        if (TX) { TX.detail(cm, { map: K.tex || 'leaves', scale: K.texScale || 5, strength: 0.7, bump: 1, local: true }); TX.wind(cm, { amp: K.crown.geo === 'blobs' ? 0.012 : 0.016, from: K.trunk[2] * 0.6 }); }
        crown = new THREE.InstancedMesh(crownGeo(K), cm, n);
      }
      [trunk, crown].forEach(m => { if (!m) return; m.frustumCulled = false; group.add(m); meshes.push(m); });
      return { trunk, crown, K };
    });

    const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), qy = new THREE.Quaternion(), p = new THREE.Vector3(), s = new THREE.Vector3(), up = new THREE.Vector3(0, 1, 0), ax = new THREE.Vector3();
    const col = new THREE.Color(), cA = new THREE.Color(), cB = new THREE.Color(), CHAR = new THREE.Color(0x14100e), EMBER = new THREE.Color(0xb5461a), WHITE = new THREE.Color(0xffffff), ZERO = new THREE.Vector3(0, 0, 0);
    const active = new Set();                                    // trees whose look changes over time (falling, burning, growing)
    const lie = new Float32Array(F.list.length).fill(-1);        // resting angle of a felled tree (from the ground under its top)

    function fallAngle(t) {
      if (t.st !== 1) return 0;
      if (lie[t.i] < 0) {
        let a = Math.PI / 2 - 0.05;
        if (opts.groundAt) { const L = t.h * 0.8, gy = opts.groundAt(t.x + t.dx * L, t.z + t.dz * L); a = Math.PI / 2 - Math.atan2(gy - t.y + 0.6, L); }
        lie[t.i] = Math.max(0.9, Math.min(2.0, a));
      }
      const A = lie[t.i], k = Math.min(1, t.ft / 1.25);
      return A * k * k * (0.6 + 0.4 * k) - (t.ft > 1.25 ? 0.07 * Math.exp(-(t.ft - 1.25) * 5) * Math.abs(Math.sin((t.ft - 1.25) * 10)) : 0);
    }
    /** Writes tree t's matrices and colours from its state. Returns true while it keeps changing. */
    function draw(t) {
      const ki = Math.min(kinds.length - 1, t.kind | 0), P = parts[ki], i = slot[t.i], K = P.K;
      let grow = 1, busy = false;
      if (t.grown && F.t - t.grown < F.rules.growTime) { const k = (F.t - t.grown) / F.rules.growTime; grow = 0.02 + 0.98 * k * k * (3 - 2 * k); busy = true; }
      const ang = fallAngle(t);
      if (t.st === 1 && t.ft < 2.2) busy = true;
      qy.setFromAxisAngle(up, t.yaw);
      if (ang > 0) { ax.set(t.dz, 0, -t.dx); q.setFromAxisAngle(ax, ang).multiply(qy); } else q.copy(qy);
      p.set(t.x, t.y - 0.3 * t.sc, t.z);
      s.set(t.sc * grow, t.sc * t.sy * grow, t.sc * grow);
      P.trunk.setMatrixAt(i, m4.compose(p, q, s));
      let burn = 0;                                              // 0 green .. 1 burnt out
      if (t.fire === 1) { burn = Math.min(1, t.bt / t.burnFor); busy = true; } else if (t.fire === 2) burn = 1;
      P.trunk.setColorAt(i, col.copy(WHITE).lerp(CHAR, Math.min(1, burn * 1.6)));
      if (P.crown) {
        const gone = burn < 0.55 ? 1 : Math.max(0, 1 - (burn - 0.55) / 0.4);      // the crown burns away
        if (gone <= 0) P.crown.setMatrixAt(i, m4.compose(p, q, ZERO));
        else { s.multiplyScalar(0.25 + 0.75 * gone); P.crown.setMatrixAt(i, m4.compose(p, q, s)); }
        cA.set(K.crown.col[0]).lerp(cB.set(K.crown.col[1]), t.tint);
        if (burn > 0) { const glow = Math.sin(Math.min(1, burn * 2.2) * Math.PI); cA.lerp(CHAR, Math.min(1, burn * 1.9)).lerp(EMBER, glow * 0.45); }
        P.crown.setColorAt(i, cA);
      }
      return busy;
    }
    F.list.forEach(t => { draw(t); });
    const flush = () => meshes.forEach(m => { m.instanceMatrix.needsUpdate = true; if (m.instanceColor) m.instanceColor.needsUpdate = true; });
    flush();

    function burst(t) {                                          // leaves and splinters where a tree breaks
      const K = parts[Math.min(kinds.length - 1, t.kind | 0)].K, leaf = K.crown ? rgb(K.crown.col[1]) : [0.2, 0.17, 0.14], wood = rgb(K.trunk[3]);
      const n = Math.round((K.crown ? 34 : 14) * Math.max(0.4, fxK));
      for (let k = 0; k < n; k++) {
        const a = Math.random() * TAU, r = Math.random() * t.r * 0.8, y = t.y + t.h * (0.35 + Math.random() * 0.6), lf = k % 3 !== 0 && K.crown;
        const c = lf ? leaf : wood, j = 0.75 + Math.random() * 0.5;
        haze.spawn(t.x + Math.cos(a) * r, y, t.z + Math.sin(a) * r, Math.cos(a) * 5 + t.dx * 9, 2 + Math.random() * 6, Math.sin(a) * 5 + t.dz * 9, 0.9 + Math.random() * 0.9, lf ? 0.55 : 0.4, 3, c[0] * j, c[1] * j, c[2] * j);
      }
      for (let k = 0; k < 8; k++) haze.spawn(t.x + (Math.random() - 0.5) * 2, t.y + 0.6, t.z + (Math.random() - 0.5) * 2, (Math.random() - 0.5) * 6, 1 + Math.random() * 2, (Math.random() - 0.5) * 6, 1.1, 2.4, 2, 0.5, 0.45, 0.38);
    }

    let acc = 0, seen = 0;
    const cam = new THREE.Vector3();
    function update(dt, time, camera, viewH) {
      // state changes since the last frame
      if (F.changed.length) {
        for (const i of F.changed) { const t = F.list[i]; if (t.st === 1 && t.ft < 0.05 && !active.has(i)) burst(t); if (t.st === 0) lie[i] = -1; active.add(i); }
        F.changed.length = 0;
      }
      let dirty = false;
      for (const i of active) { if (!draw(F.list[i])) active.delete(i); dirty = true; }
      if (dirty) flush();
      // flames, embers and smoke on the burning trees near the camera
      if (camera) { cam.copy(camera.position); const k = viewH ? viewH / (2 * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2))) : 500; fire.mat.uniforms.uScale.value = haze.mat.uniforms.uScale.value = k; }
      let best = null, bestD = 1e9;
      const nB = F.burning.size;
      if (nB) {
        acc += dt; seen = 0;
        const share = Math.min(1, 26 / nB) * fxK;
        for (const i of F.burning) {
          const t = F.list[i], d = Math.hypot(t.x - cam.x, t.z - cam.z);
          if (d < bestD) { bestD = d; best = t; }
          if (d > 520) continue;
          seen++;
          const heatK = Math.sin(Math.min(1, t.bt / t.burnFor) * Math.PI) * 0.7 + 0.3, rate = (d < 240 ? 46 : 18) * share * heatK;
          let n = rate * dt; n = Math.floor(n) + (Math.random() < n - Math.floor(n) ? 1 : 0);
          for (let k = 0; k < n; k++) {
            let x, y, z;
            if (t.st === 1 && t.ft > 0.8) { const L = Math.random() * t.h * 0.85; x = t.x + t.dx * L + (Math.random() - 0.5) * t.r * 0.8; z = t.z + t.dz * L + (Math.random() - 0.5) * t.r * 0.8; y = t.y + 0.5 + Math.random() * 1.5; }
            else { const a = Math.random() * TAU, r = Math.sqrt(Math.random()) * t.r * 0.7, hh = 0.25 + Math.random() * 0.7; x = t.x + Math.cos(a) * r * (1.2 - hh); z = t.z + Math.sin(a) * r * (1.2 - hh); y = t.y + t.h * hh; }
            fire.spawn(x, y, z, (Math.random() - 0.5) * 2, 3 + Math.random() * 5, (Math.random() - 0.5) * 2, 0.5 + Math.random() * 0.7, Math.max(2.6, t.r * (0.9 + Math.random() * 0.8)), 0);
            if (Math.random() < 0.06) fire.spawn(x, y + 1, z, (Math.random() - 0.5) * 6, 5 + Math.random() * 7, (Math.random() - 0.5) * 6, 1.2 + Math.random() * 1.4, 0.35, 1);
            if (Math.random() < 0.09) { const g = 0.14 + Math.random() * 0.14; haze.spawn(x, y + t.r * 0.5, z, (Math.random() - 0.5) * 1.5, 5 + Math.random() * 4, (Math.random() - 0.5) * 1.5, 2.6 + Math.random() * 2.4, t.r * 0.9, 2, g, g * 0.95, g * 0.9); }
          }
        }
      }
      if (light) {
        if (best && bestD < 420) { light.position.set(best.x, best.y + best.h * 0.6, best.z); light.intensity = 1.7 * (0.8 + 0.2 * Math.sin(time * 13) + 0.1 * Math.sin(time * 29)); }
        else light.intensity = 0;
      }
      fire.step(dt); haze.step(dt);
    }
    function dispose() {
      meshes.forEach(m => { m.geometry.dispose(); m.material.dispose(); if (m.dispose) m.dispose(); });
      [fire, haze].forEach(P => { P.geo.dispose(); P.mat.dispose(); });
      if (group.parent) group.parent.remove(group);
    }
    return { group, update, dispose, forest: F, get info() { return { trees: F.list.length, burning: F.burning.size, particles: fire.n + haze.n, calls: meshes.length + 2 }; } };
  }

  root.VForestView = { build, KINDS, size, pool };
})(typeof self !== 'undefined' ? self : this);
