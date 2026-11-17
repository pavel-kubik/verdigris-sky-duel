/*
 * Verdigris campaign - house kit: procedural historic Central-European (Prague / Bohemian) buildings for whole cities
 * and villages (about 1500-2500 buildings on a mid-range phone).
 *   VRender.houseKit.build(lots, opts) -> kit
 *     lots: [{ x, z, y, rise, yaw, w, d, floors, style, kind, seed, corner?, arcade? }] (see campaign/core/city.js)
 *       y = the lowest ground under the footprint, rise = max - min ground; the ground floor stands at y + rise on a
 *       stone plinth reaching down to y - 0.5. Local +Z = the street front = world (sin yaw, cos yaw).
 *     opts: { tier: 'low'|'mid'|'high' (default 'high'), chunk: 160, near: 420, far: 1400,
 *             buildPerUpdate: 2 (near chunks built per update call), eager: false (build every near chunk now) }
 *     kit.group                 add to the scene
 *     kit.update(camPos)        per chunk: full model within near, far LOD (boxes + roof prisms) beyond, hidden past
 *                               far; 12 % hysteresis on both switches. Full models are built lazily, nearest first.
 *     kit.setNight(k)           0 day .. 1 night: windows glow (random per window, from the facade atlas mask)
 *     kit.info()                { buildings, chunks, calls, tris } of what is shown
 *     kit.dispose()
 *   VRender.houseKit.model(lot, tier) -> [THREE.BufferGeometry] one building in its local frame (x = z = 0 at the
 *     footprint centre, y = 0 at lot.y); tier 'far' gives the far LOD. For previews and tests.
 *   VRender.houseKit.styles, .kinds
 * Rendering: every chunk is ONE merged indexed mesh (near) or one (far), all sharing one material: vertex colours
 * (plaster, roof, stone hues per building) x a 1024 px facade atlas (8 x 8 cells: windows, doors, shops, sgraffito,
 * fachwerk, logs, planks, roof tiles, slates, shingles, thatch, copper, clock, rose window...). Each face carries the
 * atlas cell (attribute hkc) and repeat coordinates (uv, one unit = one bay x one storey), so windows line up with
 * storeys; a mask texture says which texels take the vertex colour (G) and which glow at night (R). Stone and wood
 * get VTex.detail triplanar relief on mid / high. Without a DOM (Node) geometry builds the same, without textures.
 */
(function (root) {
  'use strict';
  const THREE = root.THREE;
  if (!THREE) return;
  const VR = root.VRender = root.VRender || {};

  const STYLES = ['gothic', 'renaissance', 'baroque', 'classic', 'timber', 'cottage', 'log', 'farm', 'barn'];
  const KINDS = ['house', 'church', 'cathedral', 'domechurch', 'townhall', 'tower', 'gatetower', 'palace', 'chapel', 'cottage', 'barn', 'shed'];

  /* ---------- random ---------- */
  function rng(seed) {
    let a = (seed >>> 0) || 0x2545f491;
    const f = () => {
      a = (a + 0x6D2B79F5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
    f.range = (lo, hi) => lo + (hi - lo) * f();
    f.int = (lo, hi) => lo + Math.floor(f() * (hi - lo + 1));
    f.pick = arr => arr[Math.floor(f() * arr.length) % arr.length];
    f.chance = p => f() < p;
    return f;
  }
  const clamp = (x, a, b) => (x < a ? a : x > b ? b : x);
  const hx = h => [((h >> 16) & 255) / 255, ((h >> 8) & 255) / 255, (h & 255) / 255];
  /** A colour with a little per-building variation (brightness and a slight hue drift). */
  function jit(hex, r, amt) {
    const c = hx(hex), k = 1 + (r() - 0.5) * 2 * amt;
    return c.map(v => clamp(v * k * (1 + (r() - 0.5) * amt * 0.6), 0, 1));
  }
  const mul = (c, k) => [clamp(c[0] * k, 0, 1), clamp(c[1] * k, 0, 1), clamp(c[2] * k, 0, 1)];

  /* ---------- palettes ---------- */
  const PAL = {
    gothic: [0xd8c7a0, 0xcdb38a, 0xe2d6b8, 0xbfae8e, 0xd9c39a, 0xc8b7a0, 0xe6dcc6, 0xd2b68c, 0xb9a991],
    renaissance: [0xe8e2d4, 0xddd5c3, 0xefe8d8, 0xd6cdb8, 0xe4d9bf, 0xdcd0b4],
    baroque: [0xe8b8b0, 0xe3c27a, 0xbcd0a8, 0xefe2c0, 0xb8cbe0, 0xf1ede4, 0xe9a98c, 0xecd27a, 0xcdbcd6, 0xf0cfa0, 0xd8e0c0, 0xe7c9b9],
    classic: [0xeedd9a, 0xe8d7a6, 0xcfcac0, 0xd8d4cb, 0xefebe2, 0xe2c896, 0xdcd6c4, 0xe9e0b8],
    timber: [0xefe9da, 0xe6dcc4, 0xf1ece0, 0xe9e0c8, 0xdfd8c4],
    cottage: [0xf2efe8, 0xebe6da, 0xefe2b8, 0xd8e2ea, 0xf3ede0, 0xe9e4d4],
    log: [0x8a6440, 0x7a5838, 0x6e5034, 0x8c6a48, 0x7d5e42],
    wood: [0x7a5a3a, 0x6a5040, 0x8a7058, 0x5e4a38, 0x7d6a58, 0x6e5a48],
    stone: [0xc9bea8, 0xbdb39d, 0xd3cab4, 0xb5ab98, 0xc4b89c],
    darkStone: [0x7b7266, 0x857a6a, 0x6f685e, 0x8c8272],
    church: [0xe6dcc6, 0xeee6d2, 0xdcd2bc, 0xf1e9d6],
    tile: [0xb04a2c, 0xa5452c, 0x9a3e2a, 0xb85a36, 0xa9502e, 0x8e4a34, 0xc0603a, 0x9b4b30, 0xb3542f],
    brownTile: [0x7a3f2a, 0x6b4434, 0x8a4a30, 0x744030, 0x6a3a28],
    slate: [0x4e5260, 0x5a5a62, 0x4a4c55, 0x585e68],
    shingle: [0x6b5a48, 0x7a6450, 0x5e5046, 0x857058],
    thatch: [0x9a7b4a, 0x8f7246, 0xa48552, 0x86693e],
    copper: [0x5c9a82, 0x6aa58c, 0x4f8a74, 0x67a088],
  };
  const GOLD = hx(0xc9a24a), DARK = hx(0x3a3632), WOODD = hx(0x4a3524), WHITE = hx(0xf3efe6);

  /* ---------- facade atlas: 8 x 8 cells ---------- */
  const C = {
    plaster: 0, stone: 1, tile: 2, slate: 3, shingle: 4, thatch: 5, copper: 6, planks: 7,
    gUp: 8, gUp2: 9, gDoor: 10, gShop: 11, gWin: 12, log: 13, logWin: 14, barnDoor: 15,
    rUp: 16, rSgr: 17, rDoor: 18, rWin: 19, rUp2: 20, clock: 21, rose: 22, lancet: 23,
    bUp: 24, bUp2: 25, bUp3: 26, bDoor: 27, bShop: 28, bWin: 29, bChurch: 30, oculus: 31,
    cUp: 32, cUp2: 33, cDoor: 34, cWin: 35, cShop: 36, attic: 37, belfry: 38, gate: 39,
    tUp: 40, tBrace: 41, tDoor: 42, tWin: 43, kWin: 44, kDoor: 45, kPlain: 46, farmGate: 47,
    shop2: 48, back: 49, side: 50, pWin: 51, pDoor: 52, chDoor: 53, towerWin: 54, gUp3: 55, tracery: 56, boards: 57,
    tUp2: 58, logDoor: 59, rUp3: 60, rSgr2: 61, bUp4: 62, cUp3: 63,
  };
  const PAD = 3 / 128;                   // sampled part of a cell: [PAD, 1 - PAD]

  /* atlas cells on stone masonry: their wall texels get the world-space VTex ashlar (crisp at any wall size) */
  const STONECELL = new Set([1, 23, 56, 54, 38, 39, 53]);
  /* ---------- geometry builder: flat-shaded indexed polygons with colour, atlas cell, repeat uv, detail kind ---------- */
  function Builder(tier) {
    this.P = []; this.N = []; this.C = []; this.U = []; this.H = []; this.K = []; this.I = []; this.n = 0;
    this.T = [0, 0, 0, 1, 0]; this.S = [];
    this.tier = tier; this.low = tier === 'low'; this.hi = tier === 'high';
  }
  const BP = Builder.prototype;
  /** Enter a sub-frame: origin (dx, dy, dz) and extra yaw, in the current frame. */
  BP.push = function (dx, dy, dz, yaw) {
    const T = this.T, c = T[3], s = T[4], cy = Math.cos(yaw || 0), sy = Math.sin(yaw || 0);
    this.S.push(T);
    this.T = [T[0] + dx * c + dz * s, T[1] + dy, T[2] - dx * s + dz * c, c * cy - s * sy, s * cy + c * sy];
  };
  BP.pop = function () { this.T = this.S.pop(); };
  /** A planar convex polygon. uv: [[u, v]...] or { su, sv, ou, ov } (planar: u horizontal along the face, v up the
   *  face, in units of su / sv). hint: the wanted normal direction (the polygon is flipped to face it). */
  BP.face = function (pts, col, cell, k, uv, hint) {
    let n = pts.length;
    if (n > 3) {                                           // drop repeated points (collapsed ridges)
      const q = [];
      for (let i = 0; i < n; i++) { const a = pts[i], b = pts[(i + 1) % n]; if (Math.abs(a[0] - b[0]) + Math.abs(a[1] - b[1]) + Math.abs(a[2] - b[2]) > 1e-5) q.push(i); }
      if (q.length < n) { pts = q.map(i => pts[i]); if (Array.isArray(uv)) uv = q.map(i => uv[i]); n = pts.length; }
    }
    if (n < 3) return;
    let nx = 0, ny = 0, nz = 0;
    for (let i = 0; i < n; i++) {
      const a = pts[i], b = pts[(i + 1) % n];
      nx += (a[1] - b[1]) * (a[2] + b[2]); ny += (a[2] - b[2]) * (a[0] + b[0]); nz += (a[0] - b[0]) * (a[1] + b[1]);
    }
    const L = Math.hypot(nx, ny, nz);
    if (L < 1e-6) return;
    nx /= L; ny /= L; nz /= L;
    let uvs = Array.isArray(uv) ? uv : null;
    if (hint && nx * hint[0] + ny * hint[1] + nz * hint[2] < 0) {
      pts = pts.slice().reverse(); if (uvs) uvs = uvs.slice().reverse(); nx = -nx; ny = -ny; nz = -nz;
    }
    if (!uvs) {
      const o = uv || {}, su = o.su || 3, sv = o.sv || 3, ou = o.ou || 0, ov = o.ov || 0;
      let ux = nz, uz = -nx;
      const ul = Math.hypot(ux, uz);
      if (ul < 1e-4) { ux = 1; uz = 0; } else { ux /= ul; uz /= ul; }
      const vx = ny * uz, vy = nz * ux - nx * uz, vz = -ny * ux;
      uvs = pts.map(p => [(p[0] * ux + p[2] * uz) / su + ou, (p[0] * vx + p[1] * vy + p[2] * vz) / sv + ov]);
    }
    const T = this.T, c = T[3], s = T[4], wnx = nx * c + nz * s, wnz = -nx * s + nz * c;
    if (k === 4 && STONECELL.has(cell)) k = 0;
    const base = this.n, hcx = cell & 7, hcy = 7 - (cell >> 3), many = Array.isArray(col[0]);
    for (let i = 0; i < n; i++) {
      const p = pts[i], cc = many ? col[i] : col;
      this.P.push(T[0] + p[0] * c + p[2] * s, T[1] + p[1], T[2] - p[0] * s + p[2] * c);
      this.N.push(wnx, ny, wnz); this.C.push(cc[0], cc[1], cc[2]); this.U.push(uvs[i][0], uvs[i][1]); this.H.push(hcx, hcy); this.K.push(k);
    }
    for (let i = 1; i < n - 1; i++) this.I.push(base, base + i, base + i + 1);
    this.n += n;
  };
  BP.tris = function () { return this.I.length / 3; };
  /** BufferGeometry with compact attributes (normals int8, colours uint8). */
  BP.geometry = function () {
    const g = new THREE.BufferGeometry(), n = this.n;
    const pos = new Float32Array(this.P), nor = new Int8Array(n * 3), col = new Uint8Array(n * 3), hc = new Uint8Array(this.H), kk = new Uint8Array(this.K);
    for (let i = 0; i < n * 3; i++) { nor[i] = Math.round(clamp(this.N[i], -1, 1) * 127); col[i] = Math.round(clamp(this.C[i], 0, 1) * 255); }
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('normal', new THREE.BufferAttribute(nor, 3, true));
    g.setAttribute('color', new THREE.BufferAttribute(col, 3, true));
    g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(this.U), 2));
    g.setAttribute('hkc', new THREE.BufferAttribute(hc, 2));
    g.setAttribute('vtk', new THREE.BufferAttribute(kk, 1));
    const idx = n < 65536 ? new Uint16Array(this.I) : new Uint32Array(this.I);
    g.setIndex(new THREE.BufferAttribute(idx, 1));
    g.computeBoundingSphere();
    g.userData = g.userData || {};
    g.userData.tris = this.I.length / 3;
    return g;
  };

  /* detail kinds (VTex.detail): 0 stone, 1 roof, 2 wood, 3 thatch, 4 plain (atlas only) */
  const KS = 0, KW = 2, KP = 4;

  /* ---------- primitives (current frame of G) ---------- */
  /** Vertical wall quad from (x0, z0) to (x1, z1) (outside on the right: (dz, -dx) rotated), explicit uv rectangle. */
  function wall(G, x0, z0, x1, z1, y0, y1, col, cell, u0, u1, v0, v1, k) {
    G.face([[x0, y0, z0], [x1, y0, z1], [x1, y1, z1], [x0, y1, z0]], col, cell, k == null ? KP : k, [[u0, v0], [u1, v0], [u1, v1], [u0, v1]]);
  }
  /** Axis-aligned box. faces: any of 'f' (+z) 'b' (-z) 'r' (+x) 'l' (-x) 't' (top) 'd' (down). */
  function box(G, x0, x1, y0, y1, z0, z1, col, cell, k, faces, uvo) {
    faces = faces || 'fbrlt'; uvo = uvo || { su: 2.5, sv: 2.5 };
    const K = k == null ? KP : k;
    if (faces.indexOf('f') >= 0) G.face([[x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1]], col, cell, K, uvo, [0, 0, 1]);
    if (faces.indexOf('b') >= 0) G.face([[x1, y0, z0], [x0, y0, z0], [x0, y1, z0], [x1, y1, z0]], col, cell, K, uvo, [0, 0, -1]);
    if (faces.indexOf('r') >= 0) G.face([[x1, y0, z1], [x1, y0, z0], [x1, y1, z0], [x1, y1, z1]], col, cell, K, uvo, [1, 0, 0]);
    if (faces.indexOf('l') >= 0) G.face([[x0, y0, z0], [x0, y0, z1], [x0, y1, z1], [x0, y1, z0]], col, cell, K, uvo, [-1, 0, 0]);
    if (faces.indexOf('t') >= 0) G.face([[x0, y1, z1], [x1, y1, z1], [x1, y1, z0], [x0, y1, z0]], col, cell, K, uvo, [0, 1, 0]);
    if (faces.indexOf('d') >= 0) G.face([[x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1]], col, cell, K, uvo, [0, -1, 0]);
  }
  /** n-sided prism sides around (cx, cz); uv: u = one cell per side (or su), v = (y - y0) / sv. */
  function prism(G, cx, cz, r0, r1, y0, y1, n, col, cell, k, rot, sv, top) {
    rot = rot || 0; sv = sv || 3;
    for (let i = 0; i < n; i++) {
      const a0 = rot + i / n * Math.PI * 2, a1 = rot + (i + 1) / n * Math.PI * 2;
      const p = [[cx + Math.sin(a0) * r0, y0, cz + Math.cos(a0) * r0], [cx + Math.sin(a1) * r0, y0, cz + Math.cos(a1) * r0],
        [cx + Math.sin(a1) * r1, y1, cz + Math.cos(a1) * r1], [cx + Math.sin(a0) * r1, y1, cz + Math.cos(a0) * r1]];
      const am = (a0 + a1) / 2;
      G.face(p, col, cell, k, [[i, 0], [i + 1, 0], [i + 1, (y1 - y0) / sv], [i, (y1 - y0) / sv]], [Math.sin(am), 0, Math.cos(am)]);
    }
    if (top) {
      const pts = [];
      for (let i = 0; i < n; i++) { const a = rot + i / n * Math.PI * 2; pts.push([cx + Math.sin(a) * r1, y1, cz + Math.cos(a) * r1]); }
      G.face(pts, col, cell, k, { su: 2, sv: 2 }, [0, 1, 0]);
    }
  }
  /** Cone / pyramid: n sides, base radius r at y0, apex at y0 + h. */
  function cone(G, cx, cz, r, y0, h, n, col, cell, k, rot) {
    rot = rot == null ? Math.PI / n : rot;
    for (let i = 0; i < n; i++) {
      const a0 = rot + i / n * Math.PI * 2, a1 = rot + (i + 1) / n * Math.PI * 2, am = (a0 + a1) / 2;
      G.face([[cx + Math.sin(a0) * r, y0, cz + Math.cos(a0) * r], [cx + Math.sin(a1) * r, y0, cz + Math.cos(a1) * r], [cx, y0 + h, cz]],
        col, cell, k, { su: 3, sv: 3, ou: i * 0.37 }, [Math.sin(am), r / Math.max(0.1, h), Math.cos(am)]);
    }
  }
  /** Surface of revolution: prof = [[r, y], ...] bottom to top. */
  function lathe(G, cx, cz, prof, n, col, cell, k, rot) {
    rot = rot == null ? Math.PI / n : rot;
    for (let j = 0; j < prof.length - 1; j++) {
      const [r0, y0] = prof[j], [r1, y1] = prof[j + 1];
      for (let i = 0; i < n; i++) {
        const a0 = rot + i / n * Math.PI * 2, a1 = rot + (i + 1) / n * Math.PI * 2, am = (a0 + a1) / 2;
        const out = [Math.sin(am) * (y1 - y0), r0 - r1, Math.cos(am) * (y1 - y0)];
        G.face([[cx + Math.sin(a0) * r0, y0, cz + Math.cos(a0) * r0], [cx + Math.sin(a1) * r0, y0, cz + Math.cos(a1) * r0],
          [cx + Math.sin(a1) * r1, y1, cz + Math.cos(a1) * r1], [cx + Math.sin(a0) * r1, y1, cz + Math.cos(a0) * r1]],
          col, cell, k, { su: 2.5, sv: 2.5 }, out);
      }
    }
  }
  /** A gold cross / finial on a point. */
  function finial(G, x, y, z, s, cross) {
    box(G, x - 0.07 * s, x + 0.07 * s, y, y + 1.6 * s, z - 0.07 * s, z + 0.07 * s, GOLD, C.plaster, KP, 'fbrlt');
    if (cross && !G.low) box(G, x - 0.45 * s, x + 0.45 * s, y + 1.0 * s, y + 1.15 * s, z - 0.06 * s, z + 0.06 * s, GOLD, C.plaster, KP, 'fbt');
  }
  /** Stone plinth around a W x D footprint from y0 to y1 (sides only). */
  function plinth(G, W, D, y0, y1, col, m) {
    m = m == null ? 0.07 : m;
    box(G, -W / 2 - m, W / 2 + m, y0, y1, -D / 2 - m, D / 2 + m, col, C.stone, KS, 'fbrl', { su: 2.6, sv: 2.6 });
  }

  /* ---------- roofs (in a roof frame: slopes face +-X, the ridge runs along Z) ---------- */
  /** Saddle roof with per-end type. o: { a, b (half sizes at the wall line), y0 (eave height at the wall line), h,
   *  oe (eave overhang), endF / endB: { t: 'gable' | 'hip' | 'half', or (rake overhang), f (half-hip cut) },
   *  col, cell, wallCol, wallCell, walls (end walls, default true), uvo (wall uv) } */
  function saddle(G, o) {
    const a = o.a, b = o.b, y0 = o.y0, h = o.h, oe = o.oe || 0, s = h / a;
    const A = a + oe, Y = y0 - oe * s, HH = h + oe * s, top = y0 + h;
    const col = o.col, cell = o.cell, rk = 4, E = {};
    for (const [sg, e] of [[1, o.endF || { t: 'gable' }], [-1, o.endB || { t: 'gable' }]]) {
      if (e.t === 'hip') { const c = A * (e.k || 1); E[sg] = { t: 'hip', ze: sg * (b + oe), zr: sg * Math.max(0, b + oe - c), mid: null }; }
      else if (e.t === 'half') {
        const f = e.f || 0.62, or = e.or == null ? oe : e.or, xc = A * (1 - f), yc = Y + f * HH;
        E[sg] = { t: 'half', ze: sg * (b + or), zr: sg * Math.max(0, b + or - xc * 1.1), mid: [xc, yc], f };
      } else { const or = e.or || 0; E[sg] = { t: 'gable', ze: sg * (b + or), zr: sg * (b + or), mid: null, or }; }
    }
    if (E[1].zr < E[-1].zr) { E[1].zr = E[-1].zr = (E[1].zr + E[-1].zr) / 2; }
    const F = E[1], Bk = E[-1];
    for (const sx of [1, -1]) {
      const pts = [[sx * A, Y, Bk.ze], [sx * A, Y, F.ze]];
      if (F.mid) pts.push([sx * F.mid[0], F.mid[1], F.ze]);
      pts.push([0, top, F.zr], [0, top, Bk.zr]);
      if (Bk.mid) pts.push([sx * Bk.mid[0], Bk.mid[1], Bk.ze]);
      G.face(pts, col, cell, rk, { su: 3, sv: 3, ou: o.ou || 0 }, [sx, 1, 0]);
      if (!G.low) G.face([[sx * A, Y - 0.2, Bk.ze], [sx * A, Y - 0.2, F.ze], [sx * A, Y, F.ze], [sx * A, Y, Bk.ze]], mul(col, 0.7), cell, rk, { su: 3, sv: 3 }, [sx, 0, 0]);
      if (G.hi && oe > 0.05) G.face([[sx * A, Y, Bk.ze], [sx * A, Y, F.ze], [sx * a, y0, F.ze], [sx * a, y0, Bk.ze]], mul(col, 0.45), C.plaster, KP, { su: 3, sv: 3 }, [0, -1, 0]);
    }
    if (!G.low && F.zr - Bk.zr > 0.3) for (const sx of [1, -1]) {   // ridge tiles
      G.face([[sx * 0.2, top - 0.2 * s, Bk.zr], [sx * 0.2, top - 0.2 * s, F.zr], [0, top + 0.12, F.zr], [0, top + 0.12, Bk.zr]], mul(col, 0.82), cell, rk, { su: 3, sv: 3 }, [sx, 1, 0]);
    }
    for (const sg of [1, -1]) {
      const e = E[sg];
      if (e.t === 'hip') G.face([[A, Y, e.ze], [-A, Y, e.ze], [0, top, e.zr]], col, cell, rk, { su: 3, sv: 3 }, [0, 1, sg]);
      else if (e.t === 'half') G.face([[e.mid[0], e.mid[1], e.ze], [-e.mid[0], e.mid[1], e.ze], [0, top, e.zr]], col, cell, rk, { su: 3, sv: 3 }, [0, 1, sg]);
      if (o.walls === false) continue;
      const wz = sg * b, wc = o.wallCol || col, wcell = o.wallCell == null ? C.plaster : o.wallCell, wk = o.wallK == null ? KP : o.wallK;
      if (e.t === 'gable') G.face([[-a, y0, wz], [a, y0, wz], [0, top, wz]], wc, wcell, wk, o.uvo, [0, 0, sg]);
      else if (e.t === 'half') { const yc = e.mid[1], xw = a * (1 - (yc - y0) / h); G.face([[-a, y0, wz], [a, y0, wz], [xw, yc, wz], [-xw, yc, wz]], wc, wcell, wk, o.uvo, [0, 0, sg]); }
      if (e.t === 'gable' && e.or > 0.05 && !G.low) {
        for (const sx of [1, -1]) G.face([[sx * A, Y - 0.18, e.ze], [0, top - 0.18, e.ze], [0, top, e.ze], [sx * A, Y, e.ze]], mul(col, 0.7), cell, rk, { su: 3, sv: 3 }, [0, 0, sg]);
        if (G.hi) for (const sx of [1, -1]) G.face([[sx * A, Y, e.ze], [0, top, e.ze], [0, top, wz], [sx * A, Y, wz]], mul(col, 0.45), C.plaster, KP, { su: 3, sv: 3 }, [0, -1, 0]);
      }
    }
    return { top, zr0: Bk.zr, zr1: F.zr, plane: { xe: a, ye: y0, k: a / h } };
  }
  /** Hipped roof with an optional steep lower part (mansard). o: { a, b, y0, h1 (lower part height, 0 = plain hip),
   *  d1 (lower part inset), h (upper part height), oe, col, cell } */
  function hipRoof(G, o) {
    const a = o.a, b = o.b, y0 = o.y0, oe = o.oe || 0, col = o.col, cell = o.cell, rk = 4;
    const h1 = o.h1 || 0, d1 = h1 > 0 ? o.d1 : 0;
    let A = a + oe, Bz = b + oe, Y = y0;
    const A2 = a - d1, B2 = b - d1, Y1 = y0 + h1, h2 = o.h;
    if (h1 > 0) {
      Y = y0 - oe * h1 / d1;
      const ring0 = [[A, Y, Bz], [-A, Y, Bz], [-A, Y, -Bz], [A, Y, -Bz]], ring1 = [[A2, Y1, B2], [-A2, Y1, B2], [-A2, Y1, -B2], [A2, Y1, -B2]];
      const hints = [[0, 0.5, 1], [-1, 0.5, 0], [0, 0.5, -1], [1, 0.5, 0]];
      for (let i = 0; i < 4; i++) {
        const j = (i + 1) % 4;
        G.face([ring0[i], ring0[j], ring1[j], ring1[i]], col, cell, rk, { su: 3, sv: 3, ou: o.ou || 0 }, hints[i]);
        if (!G.low) G.face([[ring0[i][0], Y - 0.2, ring0[i][2]], [ring0[j][0], Y - 0.2, ring0[j][2]], ring0[j], ring0[i]], mul(col, 0.7), cell, rk, { su: 3, sv: 3 }, [hints[i][0], 0, hints[i][2]]);
      }
      A = A2; Bz = B2; Y = Y1;
    } else {
      const s = h2 / a; Y = y0 - oe * s;
    }
    const top = Y1 + h2;
    const alongZ = Bz >= A, L = alongZ ? Math.max(0, Bz - A) : Math.max(0, A - Bz), uv = { su: 3, sv: 3, ou: o.ou || 0 };
    if (alongZ) {
      G.face([[A, Y, -Bz], [A, Y, Bz], [0, top, L], [0, top, -L]], col, cell, rk, uv, [1, 0.6, 0]);
      G.face([[-A, Y, Bz], [-A, Y, -Bz], [0, top, -L], [0, top, L]], col, cell, rk, uv, [-1, 0.6, 0]);
      G.face([[A, Y, Bz], [-A, Y, Bz], [0, top, L]], col, cell, rk, uv, [0, 0.6, 1]);
      G.face([[-A, Y, -Bz], [A, Y, -Bz], [0, top, -L]], col, cell, rk, uv, [0, 0.6, -1]);
    } else {
      G.face([[A, Y, -Bz], [A, Y, Bz], [L, top, 0]], col, cell, rk, uv, [1, 0.6, 0]);
      G.face([[-A, Y, Bz], [-A, Y, -Bz], [-L, top, 0]], col, cell, rk, uv, [-1, 0.6, 0]);
      G.face([[A, Y, Bz], [-A, Y, Bz], [-L, top, 0], [L, top, 0]], col, cell, rk, uv, [0, 0.6, 1]);
      G.face([[-A, Y, -Bz], [A, Y, -Bz], [L, top, 0], [-L, top, 0]], col, cell, rk, uv, [0, 0.6, -1]);
    }
    if (h1 === 0 && !G.low) {
      const ring = [[A, Y, Bz], [-A, Y, Bz], [-A, Y, -Bz], [A, Y, -Bz]], hints = [[0, 0, 1], [-1, 0, 0], [0, 0, -1], [1, 0, 0]];
      for (let i = 0; i < 4; i++) { const j = (i + 1) % 4; G.face([[ring[i][0], Y - 0.2, ring[i][2]], [ring[j][0], Y - 0.2, ring[j][2]], ring[j], ring[i]], mul(col, 0.7), cell, rk, { su: 3, sv: 3 }, hints[i]); }
    }
    return { top, alongZ, L, Y1, A2, B2, plane: h1 > 0 ? { xe: a, ye: y0, k: d1 / h1 } : { xe: a, ye: y0, k: a / h2 } };
  }
  /** Gambrel (row mansard with gable ends): lower steep part to (am, y0 + h1), upper part to the ridge. */
  function gambrel(G, o) {
    const a = o.a, b = o.b, y0 = o.y0, h1 = o.h1, h2 = o.h2, am = o.am, oe = o.oe || 0, col = o.col, cell = o.cell, rk = 4;
    const k1 = (a - am) / h1, A = a + oe, Y = y0 - oe / k1, top = y0 + h1 + h2;
    for (const sx of [1, -1]) {
      G.face([[sx * A, Y, -b], [sx * A, Y, b], [sx * am, y0 + h1, b], [sx * am, y0 + h1, -b]], col, cell, rk, { su: 3, sv: 3, ou: o.ou || 0 }, [sx, 0.4, 0]);
      G.face([[sx * am, y0 + h1, -b], [sx * am, y0 + h1, b], [0, top, b], [0, top, -b]], col, cell, rk, { su: 3, sv: 3, ou: o.ou || 0 }, [sx * 0.4, 1, 0]);
      if (!G.low) G.face([[sx * A, Y - 0.2, -b], [sx * A, Y - 0.2, b], [sx * A, Y, b], [sx * A, Y, -b]], mul(col, 0.7), cell, rk, { su: 3, sv: 3 }, [sx, 0, 0]);
    }
    if (o.walls !== false) for (const sg of [1, -1]) {
      G.face([[-a, y0, sg * b], [a, y0, sg * b], [am, y0 + h1, sg * b], [0, top, sg * b], [-am, y0 + h1, sg * b]], o.wallCol, o.wallCell || C.plaster, KP, o.uvo, [0, 0, sg]);
    }
    return { top, zr0: -b, zr1: b, plane: { xe: a, ye: y0, k: k1 } };
  }
  /** Dormer on the +X slope of a roof frame. pl: slope plane x(y) = xe - (y - ye) * k. xf: front plane (default on
   *  the slope at yb). Front window wall (unless noFront), cheeks, a small gable roof running back into the slope. */
  function dormer(G, pl, zc, wd, yb, hd, hr, o) {
    const X = y => pl.xe - (y - pl.ye) * pl.k;
    const xf = o.xf != null ? o.xf : X(yb), yt = yb + hd, xb = X(yt), xr = X(yt + hr);
    if (xr < -0.2) return false;
    const z0 = zc - wd / 2, z1 = zc + wd / 2, wc = o.wallCol, rc = o.roofCol, uo = o.uo || 0;
    if (!o.noFront) G.face([[xf, yb, z1], [xf, yb, z0], [xf, yt, z0], [xf, yt, z1]], wc, o.winCell, KP, [[uo, 0], [uo + 1, 0], [uo + 1, 1], [uo, 1]], [1, 0, 0]);
    for (const [z, sg] of [[z0, -1], [z1, 1]]) {
      const xb0 = Math.min(xf, X(yb));
      G.face([[xf, yb, z], [xb0, yb, z], [xb, yt, z], [xf, yt, z]], wc, C.plaster, KP, { su: 2.5, sv: 2.5 }, [0, 0, sg]);
    }
    const ov = 0.22, w2 = wd / 2 + 0.16;
    for (const sg of [1, -1]) {
      G.face([[xf + ov, yt - 0.08, zc + sg * w2], [xb, yt - 0.08, zc + sg * w2], [xr, yt + hr, zc], [xf + ov, yt + hr, zc]], rc, o.roofCell, 4, { su: 3, sv: 3 }, [0, 1, sg]);
    }
    if (o.gable !== false) G.face([[xf, yt, z1], [xf, yt, z0], [xf, yt + hr, zc]], o.gableCol || wc, C.plaster, KP, { su: 2.5, sv: 2.5 }, [1, 0, 0]);
    return true;
  }
  /** Chimney: a stack through the roof with a cap. */
  function chimney(G, x, z, yb, yt, col, wide) {
    const w = wide ? 0.5 : 0.32, d = 0.32;
    box(G, x - w, x + w, yb, yt, z - d, z + d, col, C.stone, KS, 'fbrlt', { su: 1.2, sv: 1.2 });
    if (!G.low) box(G, x - w - 0.08, x + w + 0.08, yt, yt + 0.16, z - d - 0.08, z + d + 0.08, mul(col, 0.8), C.stone, KS, G.hi ? 'fbrlt' : 't');
  }

  /* ---------- profile walls (gables and parapets) in the building frame, facing +Z ---------- */
  /** prof: half profile [[x, y], ...] (x >= 0 from the axis, y non-decreasing). Front at z = zf, back at zf - t. */
  function profileWall(G, prof, zf, t, col, cell, uvo, opt) {
    opt = opt || {};
    const zb = zf - t, K = opt.k == null ? KP : opt.k;
    for (let i = 0; i < prof.length - 1; i++) {
      const [x0, y0] = prof[i], [x1, y1] = prof[i + 1];
      if (y1 - y0 > 1e-4) {
        G.face([[-x0, y0, zf], [x0, y0, zf], [x1, y1, zf], [-x1, y1, zf]], col, cell, K, uvo, [0, 0, 1]);
        if (opt.back !== false) G.face([[x0, y0, zb], [-x0, y0, zb], [-x1, y1, zb], [x1, y1, zb]], col, cell, K, uvo, [0, 0, -1]);
      }
      if (opt.edges !== false) {
        const dx = x1 - x0, dy = y1 - y0;
        if (Math.abs(dx) + Math.abs(dy) < 1e-4) continue;
        const ec = opt.edgeCol || col;
        G.face([[x0, y0, zf], [x1, y1, zf], [x1, y1, zb], [x0, y0, zb]], ec, cell, K, { su: 2.5, sv: 2.5 }, [dy, -dx, 0]);
        G.face([[-x0, y0, zf], [-x1, y1, zf], [-x1, y1, zb], [-x0, y0, zb]], ec, cell, K, { su: 2.5, sv: 2.5 }, [-dy, -dx, 0]);
      }
    }
    const last = prof[prof.length - 1];
    if (last[0] > 1e-3 && opt.edges !== false) G.face([[-last[0], last[1], zf], [last[0], last[1], zf], [last[0], last[1], zb], [-last[0], last[1], zb]], opt.edgeCol || col, cell, K, { su: 2.5, sv: 2.5 }, [0, 1, 0]);
    for (const bm of opt.bumps || []) bump(G, bm, zf, zb, col, cell, uvo, opt, K);
  }
  /** A half-disc (or pointed) crest from x0 to x1 standing on y, r high, with thickness. */
  function bump(G, bm, zf, zb, col, cell, uvo, opt, K) {
    const m = G.low ? 2 : G.hi ? 6 : 4, pts = [];
    const cx = (bm.x0 + bm.x1) / 2, hw = (bm.x1 - bm.x0) / 2;
    for (let j = 0; j <= m; j++) {
      const th = Math.PI * j / m;
      pts.push([cx - Math.cos(th) * hw, bm.y + Math.sin(th) * bm.r]);
    }
    const mirror = bm.mirror !== false && Math.abs(cx) > 1e-3;
    for (const sx of mirror ? [1, -1] : [1]) {
      const P = pts.map(p => [p[0] * sx, p[1]]);
      G.face(P.map(p => [p[0], p[1], zf]), col, cell, K, uvo, [0, 0, 1]);
      if (opt.back !== false) G.face(P.map(p => [p[0], p[1], zb]), col, cell, K, uvo, [0, 0, -1]);
      if (opt.edges !== false) for (let j = 0; j < m; j++) {
        const a = P[j], b = P[j + 1], mx = (a[0] + b[0]) / 2 - cx * sx, my = (a[1] + b[1]) / 2 - bm.y;
        G.face([[a[0], a[1], zf], [b[0], b[1], zf], [b[0], b[1], zb], [a[0], a[1], zb]], opt.edgeCol || col, cell, K, { su: 2.5, sv: 2.5 }, [mx, my, 0]);
      }
    }
  }
  /** Half-width of a profile at height y (for fitting gable windows). */
  function profX(prof, y) {
    for (let i = 0; i < prof.length - 1; i++) {
      const [x0, y0] = prof[i], [x1, y1] = prof[i + 1];
      if (y1 > y0 && y >= y0 && y <= y1) return x0 + (x1 - x0) * (y - y0) / (y1 - y0);
    }
    return 0;
  }
  /* gable profiles: a = half width, y0 = base, h = roof height (the profile covers the roof triangle) */
  function profStepped(a, y0, h, n, e) {
    const p = [[a, y0]], pin = Math.max(0.35, a * 0.12);
    for (let i = 0; i < n; i++) {
      const xi = a - i * (a - pin) / n, xn = a - (i + 1) * (a - pin) / n;
      const yt = y0 + h * (1 - xn / a) + e;
      p.push([xi, yt], [xn, yt]);
    }
    p.push([pin, y0 + h + e + 0.6]);
    return p;
  }
  function profVolute(a, y0, h) {
    const p = [[a, y0], [a, y0 + 0.25], [a + 0.18, y0 + 0.25], [a + 0.18, y0 + 0.5], [a * 0.96, y0 + 0.5]];
    const bell = (t, c, w) => Math.exp(-((t - c) * (t - c)) / (w * w));
    for (let i = 1; i <= 7; i++) {
      const t = 0.05 + i * 0.1, x = a * (1 - t) + a * (0.05 + 0.2 * bell(t, 0.2, 0.09) + 0.13 * bell(t, 0.52, 0.08));
      p.push([Math.min(x, a * 0.96), y0 + t * h]);
    }
    const yc = y0 + 0.77 * h, xc = a * 0.27 + 0.35;
    p.push([xc, yc], [xc + 0.22, yc], [xc + 0.22, yc + 0.3], [xc, yc + 0.3]);
    for (let j = 1; j <= 3; j++) { const th = j / 4 * Math.PI / 2; p.push([xc * Math.cos(th), yc + 0.3 + Math.sin(th) * h * 0.2]); }
    p.push([0, yc + 0.3 + h * 0.2]);
    return p;
  }
  function profTriangle(a, y0, h, e) { return [[a + e, y0], [a + e, y0 + 0.3], [0, y0 + h + e * 0.8]]; }

  /* ---------- style tables ---------- */
  const SHOPS = { gothic: [C.gShop, C.shop2], renaissance: [C.shop2, C.rWin], baroque: [C.bShop, C.shop2], classic: [C.cShop, C.shop2], timber: [C.shop2, C.tWin] };

  function roofMat(r, kind) {
    if (kind === 'slate') return { col: jit(r.pick(PAL.slate), r, 0.07), cell: C.slate };
    if (kind === 'brown') return { col: jit(r.pick(PAL.brownTile), r, 0.08), cell: C.tile };
    if (kind === 'shingle') return { col: jit(r.pick(PAL.shingle), r, 0.08), cell: C.shingle };
    if (kind === 'thatch') return { col: jit(r.pick(PAL.thatch), r, 0.08), cell: C.thatch };
    if (kind === 'copper') return { col: jit(r.pick(PAL.copper), r, 0.06), cell: C.copper };
    return { col: jit(r.pick(PAL.tile), r, 0.09), cell: C.tile };
  }

  /* ---------- the town house ---------- */
  function townhouse(G, lot, r, far) {
    const st = { gothic: 1, renaissance: 1, baroque: 1, classic: 1, timber: 1 }[lot.style] ? lot.style : 'baroque';
    const W = Math.max(3, lot.w || 8), D = Math.max(4, lot.d || 12), F = clamp(Math.round(lot.floors || 2), 1, 6), g0 = Math.max(0, lot.rise || 0);
    const bayT = { gothic: [2.2, 2.7], renaissance: [2.5, 3.0], baroque: [2.5, 3.0], classic: [2.7, 3.2], timber: [2.2, 2.7] }[st];
    const nb = Math.max(1, Math.round(W / r.range(bayT[0], bayT[1]))), bw = W / nb;
    const gh = r.range(3.5, 4.1), uh = r.range(2.95, 3.3);
    const H = g0 + gh + (F - 1) * uh;
    let wc = jit(r.pick(PAL[st]), r, 0.05);
    const stoneCol = jit(r.pick(PAL.stone), r, 0.06);
    let roof, orient, gable = 'plain', rtype = 'saddle', pitch, endB = 'gable', endF = 'gable', attic = null;
    let up, up2, door, gwin, side = C.plaster, back = C.back, gcell = C.plaster, attWin = C.attic;
    const shopP = lot.arcade ? 0.7 : 0.45;
    if (st === 'gothic') {
      roof = roofMat(r, r.pick(['brown', 'brown', 'slate', 'tile']));
      orient = r.chance(0.8) ? 'front' : 'side';
      gable = orient === 'front' ? r.pick(['plain', 'stepped', 'stepped', 'plain', 'stepped']) : 'plain';
      pitch = r.range(54, 62); endB = r.pick(['gable', 'hip', 'gable']);
      if (orient === 'side') { rtype = 'saddle'; endF = endB = r.pick(['gable', 'half']); }
      up = r.pick([C.gUp, C.gUp2, C.gUp3, C.gUp]); up2 = up; door = C.gDoor; gwin = C.gWin;
      if (up === C.gUp3) wc = stoneCol;
    } else if (st === 'renaissance') {
      roof = roofMat(r, r.pick(['tile', 'tile', 'slate', 'brown']));
      orient = r() < 0.55 ? 'attic' : 'front';
      gable = orient === 'front' ? 'renstep' : 'plain';
      pitch = r.range(50, 58);
      const env = r.chance(0.35);
      up = env ? C.rUp3 : r.pick([C.rUp, C.rUp2]); up2 = up; side = env ? C.rSgr2 : C.rSgr; gcell = side;
      door = C.rDoor; gwin = C.rWin;
      if (orient === 'attic') attic = { ph: r.range(1.6, 2.6), crest: r.pick(['lunette', 'lunette', 'swallow', 'step']) };
    } else if (st === 'baroque') {
      roof = roofMat(r, r.chance(0.08) ? 'copper' : 'tile');
      orient = r.chance(0.42) ? 'front' : 'side';
      gable = orient === 'front' ? 'volute' : 'plain';
      pitch = r.range(46, 56);
      if (orient === 'side') { rtype = r.pick(['gambrel', 'gambrel', 'saddle', 'saddle', 'saddle']); endF = endB = r.pick(['gable', 'half', 'gable']); pitch = r.range(40, 50); }
      up = r.pick([C.bUp, C.bUp2, C.bUp3, C.bUp4]); up2 = r.pick([C.bUp3, C.bUp2, up]); door = C.bDoor; gwin = C.bWin; attWin = r.pick([C.oculus, C.attic]);
    } else if (st === 'classic') {
      roof = roofMat(r, r.pick(['tile', 'tile', 'slate']));
      orient = 'side'; rtype = r.pick(['hip', 'hip', 'saddle', 'gambrel']); pitch = r.range(34, 44);
      up = r.pick([C.cUp, C.cUp3]); up2 = r.pick([C.cUp2, up]); door = C.cDoor; gwin = C.cWin;
    } else {                                                 // timber
      roof = roofMat(r, r.pick(['tile', 'brown', 'brown', 'shingle']));
      orient = r.chance(0.65) ? 'front' : 'side';
      pitch = r.range(50, 60);
      endF = r.chance(0.3) ? 'half' : 'gable'; endB = r.pick(['gable', 'hip', 'half']);
      if (orient === 'side') endF = endB = r.pick(['gable', 'half']);
      up = r.pick([C.tUp, C.tUp2]); up2 = up; side = C.tBrace; gcell = C.tBrace; door = C.tDoor; gwin = C.tWin; back = up;
    }
    const uo = r.int(0, 15), shop = SHOPS[st];
    const jet = st === 'timber' && F > 1 ? r.range(0.35, 0.55) : 0;
    const arc = !!lot.arcade && F >= 2;
    const ad = arc ? r.range(2.3, 2.9) : 0;
    const zf = D / 2, zu = zf + jet;                         // ground and upper front planes
    const zg = zf - ad;
    // roof geometry parameters
    const aR = orient === 'front' ? W / 2 : (D + jet) / 2;
    let hR = Math.min(aR * Math.tan(pitch * Math.PI / 180), orient === 'front' ? 9 : 7.2);
    if (orient === 'attic') hR = Math.min(1.6, D * 0.12);
    const out = { H, hR, W, D };
    const roofCol = roof.col, roofCell = roof.cell;

    /* ---- far LOD: one box with the facade cell, one roof prism ---- */
    if (far) {
      wall(G, -W / 2, zf, W / 2, zf, -0.5, H, wc, up, uo, uo + nb, -0.3, (H - g0) / uh, KP);
      wall(G, W / 2, zf, W / 2, -D / 2, -0.5, H, wc, side, 0, D / 3, 0, H / 3, KP);
      wall(G, W / 2, -D / 2, -W / 2, -D / 2, -0.5, H, wc, back, uo, uo + nb, -0.3, (H - g0) / uh, KP);
      wall(G, -W / 2, -D / 2, -W / 2, zf, -0.5, H, wc, side, 0, D / 3, 0, H / 3, KP);
      if (orient === 'attic') {
        const ph = attic.ph;
        wall(G, -W / 2, zf, W / 2, zf, H, H + ph, wc, side, 0, W / 3, 0, ph / 3, KP);
        G.face([[-W / 2, H + ph * 0.8, zf], [W / 2, H + ph * 0.8, zf], [W / 2, H + ph * 0.8, -D / 2], [-W / 2, H + ph * 0.8, -D / 2]], roofCol, roofCell, 4, { su: 3, sv: 3 }, [0, 1, 0]);
      } else if (orient === 'front') {
        G.push(0, 0, jet / 2, 0);
        saddle(G, { a: W / 2, b: (D + jet) / 2, y0: H, h: hR, col: roofCol, cell: roofCell, wallCol: wc, wallCell: gcell, endB: { t: endB === 'hip' ? 'hip' : 'gable' } });
        G.pop();
      } else {
        G.push(0, 0, jet / 2, -Math.PI / 2);
        if (rtype === 'hip') hipRoof(G, { a: aR, b: W / 2, y0: H, h: hR, col: roofCol, cell: roofCell });
        else saddle(G, { a: aR, b: W / 2, y0: H, h: hR, col: roofCol, cell: roofCell, wallCol: wc, wallCell: gcell });
        G.pop();
      }
      return out;
    }

    /* ---- plinth ---- */
    plinth(G, W, D, -0.5, g0 + 0.25, stoneCol);

    /* ---- ground floor front: one quad per bay (door, shops, windows) ---- */
    const doorBay = nb === 1 ? 0 : nb % 2 ? (nb - 1) / 2 : r.int(0, nb - 1);
    const ground = [];
    for (let i = 0; i < nb; i++) ground.push(i === doorBay ? door : r.chance(shopP) ? r.pick(shop) : gwin);
    const gcol = st === 'gothic' && r.chance(0.3) ? mul(wc, 0.9) : wc;
    for (let i = 0; i < nb; i++) {
      const x0 = -W / 2 + i * bw;
      wall(G, x0, zg, x0 + bw, zg, g0, g0 + gh, gcol, ground[i], uo + i, uo + i + 1, 0, 1);
    }
    /* ---- upper floors ---- */
    if (F > 1) {
      if (up2 !== up && F > 2) {
        wall(G, -W / 2, zu, W / 2, zu, g0 + gh, g0 + gh + uh, wc, up2, uo, uo + nb, 0, 1);
        wall(G, -W / 2, zu, W / 2, zu, g0 + gh + uh, H, wc, up, uo, uo + nb, 1, F - 1);
      } else wall(G, -W / 2, zu, W / 2, zu, g0 + gh, H, wc, up2, uo, uo + nb, 0, F - 1);
    }
    /* ---- sides and back ---- */
    for (const sx of [1, -1]) {
      const x = sx * W / 2;
      const zs = sx > 0 ? [zg, -D / 2] : [-D / 2, zg], zs2 = sx > 0 ? [zu, -D / 2] : [-D / 2, zu];
      const su = side === C.plaster ? 3 : bw;
      if (jet > 0 || arc) {
        wall(G, x, zs[0], x, zs[1], g0, g0 + gh, wc, side === C.tBrace ? C.plaster : side, zs[0] / su, zs[1] / su, 0, 1);
        if (F > 1) wall(G, x, zs2[0], x, zs2[1], g0 + gh, H, wc, side, zs2[0] / su, zs2[1] / su, 0, F - 1);
      } else wall(G, x, zs[0], x, zs[1], g0, H, wc, side === C.tBrace ? C.plaster : side, zs[0] / su, zs[1] / su, 0, (H - g0) / uh);
    }
    const nbb = Math.max(1, Math.round(W / 2.7));
    wall(G, W / 2, -D / 2, -W / 2, -D / 2, g0, H, wc, back, uo, uo + nbb, -0.25, (H - g0) / uh - 0.25);
    /* ---- jetty underside ---- */
    if (jet > 0) G.face([[-W / 2, g0 + gh, zf], [W / 2, g0 + gh, zf], [W / 2, g0 + gh, zu], [-W / 2, g0 + gh, zu]], WOODD, C.planks, KW, { su: 2, sv: 2 }, [0, -1, 0]);
    if (jet > 0 && !G.low) box(G, -W / 2, W / 2, g0 + gh - 0.28, g0 + gh, zf, zf + 0.22, WOODD, C.planks, KW, 'fd');

    /* ---- arcade: pillars, arches, vault ---- */
    if (arc) {
      const pw = 0.75, yT = g0 + gh, ys = g0 + gh * 0.5, ya = g0 + gh - 0.45, m = G.low ? 2 : G.hi ? 6 : 4;
      const pc = mul(wc, 0.97);
      const xs = [];
      for (let i = 0; i <= nb; i++) xs.push(-W / 2 + i * bw);
      for (let i = 0; i <= nb; i++) {
        const x0 = i === 0 ? xs[0] : i === nb ? xs[nb] - pw : xs[i] - pw / 2, x1 = x0 + pw;
        box(G, x0, x1, g0, yT, zf - pw, zf, pc, C.plaster, KP, i === 0 ? 'fbr' : i === nb ? 'fbl' : 'fbrl');
      }
      for (let i = 0; i < nb; i++) {
        const xl = i === 0 ? xs[0] + pw : xs[i] + pw / 2, xr = i === nb - 1 ? xs[nb] - pw : xs[i + 1] - pw / 2;
        const xc = (xl + xr) / 2, hw = (xr - xl) / 2, P = [];
        for (let j = 0; j <= m; j++) { const th = Math.PI * j / m; P.push([xc - Math.cos(th) * hw, ys + (ya - ys) * Math.sin(th)]); }
        for (let j = 0; j < m; j++) {
          const a = P[j], b = P[j + 1];
          G.face([[a[0], a[1], zf], [b[0], b[1], zf], [b[0], yT, zf], [a[0], yT, zf]], pc, C.plaster, KP, { su: bw, sv: uh, ou: uo }, [0, 0, 1]);
          G.face([[a[0], a[1], zf], [b[0], b[1], zf], [b[0], b[1], zf - pw], [a[0], a[1], zf - pw]], mul(pc, 0.8), C.plaster, KP, { su: 2, sv: 2 }, [xc - (a[0] + b[0]) / 2, ys - (a[1] + b[1]) / 2, 0]);
        }
      }
      G.face([[-W / 2, yT, zg], [W / 2, yT, zg], [W / 2, yT, zf - pw], [-W / 2, yT, zf - pw]], mul(wc, 0.62), C.plaster, KP, { su: 3, sv: 3 }, [0, -1, 0]);
      G.face([[-W / 2, g0 + 0.25, zg], [W / 2, g0 + 0.25, zg], [W / 2, g0 + 0.25, zf], [-W / 2, g0 + 0.25, zf]], mul(stoneCol, 0.85), C.stone, KS, { su: 2, sv: 2 }, [0, 1, 0]);
    }

    /* ---- horizontal mouldings ---- */
    const corn = st === 'gothic' ? 0.15 : st === 'timber' ? 0.12 : 0.32, trim = st === 'baroque' || st === 'classic' ? mul(wc, 1.08) : mul(wc, 0.94);
    if (orient !== 'front' || st !== 'gothic') {
      box(G, -W / 2, W / 2, H - 0.38, H, zu, zu + corn, trim, C.plaster, KP, G.hi ? 'ftdlr' : 'ftd');
      if (G.hi && (st === 'classic' || st === 'baroque')) box(G, -W / 2, W / 2, H - 0.62, H - 0.38, zu, zu + corn * 0.5, trim, C.plaster, KP, 'fd');
    }
    if (st !== 'timber' && F > 1 && !arc && (st !== 'gothic' || r.chance(0.5))) box(G, -W / 2, W / 2, g0 + gh - 0.2, g0 + gh, zf, zf + 0.12, trim, C.plaster, KP, 'ftd');
    if ((st === 'renaissance' || st === 'classic') && !G.low) for (let f = 2; f < F; f++) box(G, -W / 2, W / 2, g0 + gh + (f - 1) * uh - 0.12, g0 + gh + (f - 1) * uh, zu, zu + 0.1, trim, C.plaster, KP, 'ft');
    /* pilasters (baroque, classic) */
    if ((st === 'baroque' || st === 'classic') && F > 1 && r.chance(0.55)) {
      const pc = r.chance(0.5) ? WHITE : mul(wc, 1.1), xsP = [-W / 2, W / 2 - 0.5];
      if (nb >= 4 && r.chance(0.5)) { const k = Math.floor(nb / 2) - (nb % 2 ? 0 : 1); xsP.push(-W / 2 + k * bw + (nb % 2 ? 0 : bw) - 0.25, W / 2 - k * bw - (nb % 2 ? 0 : bw) - 0.25); }
      for (const x of xsP) box(G, x, x + 0.5, g0 + gh, H - 0.38, zu, zu + 0.14, pc, C.plaster, KP, 'frl');
    }

    /* ---- roof ---- */
    const chims = r.chance(0.15) ? 0 : r.chance(0.6) ? 1 : 2;
    const chimCol = r.chance(0.5) ? mul(wc, 0.92) : jit(0x9a5a44, r, 0.08);
    if (orient === 'front') {
      const parapet = gable === 'stepped' || gable === 'volute' || gable === 'renstep';
      const t = 0.35, zFront = zu;
      G.push(0, 0, jet / 2 - (parapet ? t / 2 : 0), 0);
      const R = saddle(G, { a: W / 2, b: (D + jet) / 2 - (parapet ? t / 2 : 0), y0: H, h: hR, oe: 0, col: roofCol, cell: roofCell, wallCol: wc, wallCell: gcell,
        uvo: { su: bw, sv: uh, ou: uo }, endF: parapet ? { t: 'gable', or: 0 } : endF === 'half' ? { t: 'half', or: 0.3, f: 0.66 } : { t: 'gable', or: 0.28 },
        endB: endB === 'hip' ? { t: 'hip' } : endB === 'half' ? { t: 'half', or: 0.25 } : { t: 'gable', or: 0.15 }, walls: true });
      G.pop();
      if (parapet) {
        let prof, bumps = [];
        if (gable === 'stepped') prof = profStepped(W / 2, H, hR, nb >= 3 ? 4 : 3, 0.45);
        else if (gable === 'renstep') {
          prof = profStepped(W / 2, H, hR, 3, 0.5);
          for (let i = 1; i < prof.length - 2; i += 2) bumps.push({ x0: prof[i + 1][0], x1: prof[i][0], y: prof[i][1], r: Math.min(0.9, (prof[i][0] - prof[i + 1][0]) * 0.7) });
          const top = prof[prof.length - 1];
          bumps.push({ x0: -top[0] - 0.3, x1: top[0] + 0.3, y: top[1], r: 0.9, mirror: false });
        } else prof = profVolute(W / 2, H, hR);
        const gc = gable === 'volute' ? wc : wc;
        profileWall(G, prof, zFront, t, gc, gcell, { su: bw, sv: uh, ou: uo }, { back: !G.low, edges: !G.low, bumps, edgeCol: mul(gc, 0.92) });
        // gable windows
        const rows = G.low ? 1 : 2;
        for (let j = 0; j < rows; j++) {
          const y = H + 0.6 + j * uh * 0.92, wh = 1.3;
          for (let i = 0; i < nb; i++) {
            const xc = -W / 2 + (i + 0.5) * bw, ww = 0.9;
            if (Math.abs(xc) + ww / 2 + 0.3 > profX(prof, y + wh) - 0.05 || Math.abs(xc) + ww / 2 + 0.3 > W / 2 * (1 - (y + wh - H) / hR)) continue;
            wall(G, xc - ww / 2, zFront + 0.03, xc + ww / 2, zFront + 0.03, y, y + wh, wc, attWin, uo + i, uo + i + 1, 4 + j, 5 + j);
          }
        }
        if (gable === 'volute' && !G.low) {
          const yo = H + hR * 0.62;
          wall(G, -0.55, zFront + 0.03, 0.55, zFront + 0.03, yo, yo + 1.1, wc, C.oculus, uo, uo + 1, 7, 8);
          for (const sx of [1, -1]) cone(G, sx * (W / 2 - 0.15), zFront - t / 2, 0.28, H + 0.5, 1.2, 4, WHITE, C.plaster, KP);
        }
      } else {
        // plain gable: windows on the gable triangle, a small cornice at its base
        const hasCorn = st !== 'gothic' || r.chance(0.5);
        if (hasCorn && !G.low) box(G, -W / 2, W / 2, H - 0.2, H, zu, zu + 0.16, trim, C.plaster, KP, 'ftd');
        const rows = G.low ? 1 : 2;
        for (let j = 0; j < rows; j++) {
          const y = H + 0.5 + j * uh * 0.9, wh = 1.25;
          for (let i = 0; i < nb; i++) {
            const xc = -W / 2 + (i + 0.5) * bw, ww = 0.85;
            const lim = endF === 'half' ? H + hR * 0.6 : H + hR;
            if (y + wh > lim - 0.5 || Math.abs(xc) + ww / 2 + 0.25 > W / 2 * (1 - (y + wh - H) / hR)) continue;
            wall(G, xc - ww / 2, zu + 0.03, xc + ww / 2, zu + 0.03, y, y + wh, wc, attWin, uo + i, uo + i + 1, 4 + j, 5 + j);
          }
        }
      }
      // chimneys on the ridge (or just beside it)
      for (let c = 0; c < chims; c++) {
        const z = r.range(R.zr0 + 1, R.zr1 - 1) + jet / 2, x = r.range(-0.3, 0.3) * W / 2, yb = H + hR * (1 - Math.abs(x) / (W / 2)) - 0.8;
        if (R.zr1 - R.zr0 > 2.5) chimney(G, x, z, yb, H + hR + r.range(0.6, 1.3), chimCol, r.chance(0.3));
      }
      // dormers on the long slopes of deep front-gable houses (rare)
      const sideD = r.chance(st === 'baroque' ? 0.4 : 0.15), sdx = r(), sdz = r();
      if (!G.low && D > 11 && sideD) {
        const sx = sdx < 0.5 ? 1 : -1;
        G.push(0, 0, 0, sx > 0 ? 0 : Math.PI);
        dormer(G, { xe: W / 2, ye: H, k: (W / 2) / hR }, (sdz - 0.5) * D / 2 * sx, 1.1, H + 0.6, 1.4, 0.7, { wallCol: wc, roofCol, roofCell, winCell: C.attic, uo });
        G.pop();
      }
    } else if (orient === 'side') {
      G.push(0, 0, jet / 2, -Math.PI / 2);                   // roof frame: +X = the street side, z = -x of the house
      const aS = (D + jet) / 2;
      let R;
      const ends = t => (t === 'half' ? { t: 'half', or: 0, f: 0.68 } : { t: 'gable', or: 0 });
      if (rtype === 'gambrel') {
        const am = aS * r.range(0.55, 0.68), h1 = Math.min(hR * 0.75, 4.8), h2 = Math.min(aS * 0.38, 3.2);
        R = gambrel(G, { a: aS, b: W / 2, y0: H, h1, h2, am, oe: 0.35, col: roofCol, cell: roofCell, wallCol: wc, wallCell: gcell, uvo: { su: 3, sv: 3 } });
        hR = h1 + h2;
      } else if (rtype === 'hip') {
        R = hipRoof(G, { a: aS, b: W / 2, y0: H, h: hR, oe: 0.35, col: roofCol, cell: roofCell });
        R.zr0 = -R.L; R.zr1 = R.L;
      } else R = saddle(G, { a: aS, b: W / 2, y0: H, h: hR, oe: 0.38, col: roofCol, cell: roofCell, wallCol: wc, wallCell: gcell, uvo: { su: 3, sv: 3 }, endF: ends(endF), endB: ends(endB) });
      out.hR = hR;
      // dormers and a wall dormer (Zwerchhaus / pediment) on the street slope
      const ndMax = st === 'gothic' ? 1 : st === 'timber' ? 1 : 3;
      let nd = r.int(0, Math.min(ndMax, Math.max(1, nb - 1)));
      const wdr = r(), wallD = !G.low && nb >= 3 && nb % 2 === 1 && wdr < ({ classic: 0.6, baroque: 0.35, timber: 0.3 }[st] || 0);
      const dormerPos = [0, 1, 2, 3].map(() => [r.int(0, nb - 1), r.int(0, nb - 1), r.int(0, nb - 1)]), dormerWin = r.chance(0.5), backD = r.chance(0.5), backZ = r.range(-W / 4, W / 4);
      if (G.low) nd = 0;
      const mid = (nb - 1) / 2;
      if (wallD) {
        const wbays = nb >= 5 && st === 'classic' ? 3 : 1, wd = wbays * bw - 0.2, hd = st === 'classic' ? 0.3 : uh * 0.9;
        const hr = st === 'classic' ? Math.min(2.4, wd * 0.32) : uh * 0.45 + 0.6;
        const ok = dormer(G, { xe: aS, ye: H, k: R.plane.k }, 0, wd, H, hd, hr, { xf: aS, noFront: true, gable: false, wallCol: wc, roofCol, roofCell, winCell: up, uo });
        if (ok) {
          G.pop();
          // front of the wall dormer in the house frame
          const x0 = -wd / 2, x1 = wd / 2;
          if (hd > 0.5) wall(G, x0, zu, x1, zu, H, H + hd, wc, up, uo + mid - (wbays - 1) / 2 + 0.1, uo + mid + (wbays + 1) / 2 - 0.1, F - 0.02, F + 0.88);
          if (st === 'classic') {
            profileWall(G, profTriangle(wd / 2, H + hd, hr, 0.15), zu + 0.12, 0.3, trim, C.plaster, { su: 3, sv: 3 }, { back: false });
            if (!G.low) wall(G, -0.5, zu + 0.15, 0.5, zu + 0.15, H + hd + 0.3, H + hd + 1.3, wc, C.oculus, uo, uo + 1, 6, 7);
          } else {
            const pv = profVolute(wd / 2, H + hd, hr);
            profileWall(G, pv, zu + 0.02, 0.3, wc, C.plaster, { su: 3, sv: 3 }, { back: false, edgeCol: mul(wc, 0.92) });
          }
          G.push(0, 0, jet / 2, -Math.PI / 2);
        }
      }
      const used = new Set(wallD ? [mid] : []);
      for (let d = 0; d < nd; d++) {
        const cand = dormerPos[d];
        let bi = cand[0], tries = 0;
        while ((used.has(bi) || used.has(bi - 1) || used.has(bi + 1)) && tries < 2) bi = cand[++tries];
        if (used.has(bi)) continue;
        used.add(bi);
        const xc = -W / 2 + (bi + 0.5) * bw;
        dormer(G, R.plane, -xc, Math.min(1.3, bw * 0.55), H + 0.55, 1.35, 0.75, { wallCol: wc, roofCol, roofCell, winCell: st === 'baroque' && dormerWin ? C.oculus : C.attic, uo: uo + bi });
      }
      if (G.hi && backD) {                                    // a dormer on the back
        G.push(0, 0, 0, Math.PI);
        dormer(G, R.plane, backZ, 1.2, H + 0.55, 1.3, 0.7, { wallCol: wc, roofCol, roofCell, winCell: C.attic, uo });
        G.pop();
      }
      for (let c = 0; c < chims; c++) {
        const z = r.range(-W / 2 + 0.8, W / 2 - 0.8), x = r.range(-0.6, 0.6);
        const zz = rtype === 'hip' ? clamp(z, R.zr0, R.zr1) : z;
        chimney(G, x, zz, H + hR - 1.2, H + hR + r.range(0.6, 1.2), chimCol, r.chance(0.3));
      }
      G.pop();
    } else {                                                   // attic parapet hiding a low roof (renaissance)
      hipRoof(G, { a: W / 2 - 0.1, b: D / 2 - 0.1, y0: H, h: hR, oe: 0, col: roofCol, cell: roofCell });
      const ph = attic.ph, t = 0.3, yb = H + ph * 0.55;
      box(G, -W / 2, W / 2, H - 0.35, H, zf, zf + 0.3, trim, C.plaster, KP, 'ftdlr');
      box(G, -W / 2, W / 2, H, yb, zf - t, zf, wc, side, KP, 'fbtlr', { su: bw, sv: uh, ou: uo });
      const n = Math.max(2, nb + (r.chance(0.5) ? 1 : 0)), cw = W / n, bumps = [];
      for (let i = 0; i < n; i++) {
        const x0 = -W / 2 + i * cw + cw * 0.08, x1 = x0 + cw * 0.84;
        if (attic.crest === 'lunette') bumps.push({ x0, x1, y: yb, r: ph * 0.45, mirror: false });
        else if (attic.crest === 'swallow') {
          const xm = (x0 + x1) / 2;
          for (const [a, b] of [[x0, xm - cw * 0.08], [xm + cw * 0.08, x1]]) box(G, a, b, yb, yb + ph * 0.45, zf - t, zf, wc, side, KP, 'fbtlr', { su: bw, sv: uh, ou: uo });
        } else box(G, x0 + cw * 0.15, x1 - cw * 0.15, yb, yb + ph * 0.45, zf - t, zf, wc, side, KP, 'fbtlr', { su: bw, sv: uh, ou: uo });
      }
      if (bumps.length) for (const bm of bumps) bump(G, bm, zf, zf - t, wc, side, { su: bw, sv: uh, ou: uo }, { back: !G.low, edges: true, edgeCol: mul(wc, 0.9) }, KP);
      if (!G.low) for (let i = 0; i <= n; i++) cone(G, -W / 2 + i * cw, zf - t / 2, 0.22, yb, ph * 0.6, 4, mul(wc, 0.9), C.plaster, KP);
      for (let c = 0; c < chims; c++) chimney(G, r.range(-W / 3, W / 3), r.range(-D / 3, 0), H, H + hR + r.range(0.8, 1.6), chimCol, false);
    }

    /* ---- corner oriel ---- */
    if (lot.corner && F >= 2 && st !== 'timber' && r.chance(0.8)) {
      const sx = r.chance(0.5) ? 1 : -1, cx = sx * (W / 2 - 0.25), cz = zu - 0.25, ro = 1.15, y1 = g0 + gh + 0.35, yt = H + 0.4;
      const n = G.low ? 6 : 8, oc = st === 'gothic' ? stoneCol : mul(wc, 1.03);
      prism(G, cx, cz, ro, ro, y1, yt, n, oc, C.attic, KP, Math.PI / n, uh);
      G.face(Array.from({ length: n }, (_, i) => { const a = Math.PI / n + i / n * Math.PI * 2; return [cx + Math.sin(a) * ro, y1, cz + Math.cos(a) * ro]; }), mul(oc, 0.8), C.plaster, KP, { su: 2, sv: 2 }, [0, -1, 0]);
      // corbel: an inverted cone below
      for (let i = 0; i < n; i++) {
        const a0 = Math.PI / n + i / n * Math.PI * 2, a1 = Math.PI / n + (i + 1) / n * Math.PI * 2, am = (a0 + a1) / 2;
        G.face([[cx, y1 - 1.3, cz], [cx + Math.sin(a1) * ro, y1, cz + Math.cos(a1) * ro], [cx + Math.sin(a0) * ro, y1, cz + Math.cos(a0) * ro]], mul(oc, 0.85), C.stone, KS, { su: 2, sv: 2 }, [Math.sin(am), -1, Math.cos(am)]);
      }
      const rcol = r.chance(0.5) ? jit(r.pick(PAL.copper), r, 0.05) : roofCol, rcell = rcol === roofCol ? roofCell : C.copper;
      if (st === 'baroque' && !G.low) lathe(G, cx, cz, [[ro * 1.08, yt], [ro * 1.2, yt + 0.5], [ro * 0.9, yt + 1.2], [0.3, yt + 1.9], [0.12, yt + 2.3], [0, yt + 2.9]], n, rcol, rcell, 4);
      else cone(G, cx, cz, ro * 1.12, yt, st === 'gothic' ? 4.2 : 3.0, n, rcol, rcell, 4);
    }
    /* ---- shop sign ---- */
    const signP = r(), signC = r(), signK = r();
    if (!G.low && ground.some(c => c === C.shop2 || c === C.gShop || c === C.bShop || c === C.cShop) && signP < 0.5) {
      const x = -W / 2 + (doorBay + (doorBay < nb - 1 ? 1 : 0)) * bw + (doorBay < nb - 1 ? 0 : -0.3), y = g0 + gh - 0.95;
      box(G, x - 0.04, x + 0.04, y + 0.62, y + 0.7, zf, zf + 1.0, DARK, C.plaster, KP, 'trl');
      box(G, x - 0.04, x + 0.04, y, y + 0.6, zf + 0.25, zf + 0.95, signC < 0.5 ? GOLD : hx([0x7a2a22, 0x2f4a3a, 0x2a3a5a][Math.floor(signK * 3)]), C.plaster, KP, 'rlfbt');
    }
    return out;
  }

  /* ---------- village cottage (and the log house) ---------- */
  function cottage(G, lot, r, far, log) {
    const W = Math.max(4, lot.w || 7), D = Math.max(5, lot.d || 10), g0 = Math.max(0, lot.rise || 0), F = clamp(Math.round(lot.floors || 1), 1, 2);
    const wh = r.range(2.6, 3.0), H = g0 + 0.2 + wh * F;
    const wc = log ? jit(r.pick(PAL.log), r, 0.06) : jit(r.pick(PAL.cottage), r, 0.04);
    const roof = roofMat(r, log ? r.pick(['shingle', 'shingle', 'thatch']) : r.pick(['thatch', 'shingle', 'tile', 'tile', 'thatch', 'brown']));
    const front = r.chance(0.78);                              // gable to the street (the Bohemian village rule)
    const pitch = roof.cell === C.thatch ? r.range(50, 56) : r.range(44, 52);
    const endF = r.chance(0.35) ? 'half' : 'gable', endB = r.pick(['gable', 'half', 'hip']);
    const boardsGable = r.chance(log ? 0.9 : 0.6), boardCol = jit(r.pick(PAL.wood), r, 0.08);
    const uo = r.int(0, 15), stoneCol = jit(r.pick(PAL.stone), r, 0.07);
    const winC = log ? C.logWin : C.kWin, plainC = log ? C.log : C.kPlain, doorC = log ? C.logDoor : C.kDoor, wk = KP;
    const aR = front ? W / 2 : D / 2, hR = aR * Math.tan(pitch * Math.PI / 180);
    if (far) {
      wall(G, -W / 2, D / 2, W / 2, D / 2, -0.5, H, wc, winC, uo, uo + 2, -0.2, F, wk);
      wall(G, W / 2, D / 2, W / 2, -D / 2, -0.5, H, wc, winC, uo, uo + 3, -0.2, F, wk);
      wall(G, W / 2, -D / 2, -W / 2, -D / 2, -0.5, H, wc, plainC, 0, 2, -0.2, F, wk);
      wall(G, -W / 2, -D / 2, -W / 2, D / 2, -0.5, H, wc, winC, uo, uo + 3, -0.2, F, wk);
      G.push(0, 0, 0, front ? 0 : -Math.PI / 2);
      saddle(G, { a: aR, b: front ? D / 2 : W / 2, y0: H, h: hR, oe: 0.4, col: roof.col, cell: roof.cell, wallCol: boardsGable ? boardCol : wc, wallCell: boardsGable ? C.boards : C.plaster });
      G.pop();
      return { H, hR };
    }
    plinth(G, W, D, -0.5, g0 + 0.35, stoneCol, 0.05);
    const wy0 = g0 + 0.2;
    // front: the gable end (front) or the long side with the door (side)
    const nbF = front ? (W > 7.5 ? 3 : 2) : Math.max(3, Math.round(W / 2.6)), bwF = W / nbF;
    const doorF = front ? -1 : r.int(0, nbF - 1);
    for (let i = 0; i < nbF; i++) wall(G, -W / 2 + i * bwF, D / 2, -W / 2 + (i + 1) * bwF, D / 2, wy0, wy0 + wh, wc, i === doorF ? doorC : winC, uo + i, uo + i + 1, 0, 1, wk);
    // sides: the door on the long side (when the gable faces the street)
    const nbS = Math.max(2, Math.round(D / 2.8)), bwS = D / nbS, doorS = front ? r.int(1, nbS - 1) : -1, dsx = r.chance(0.5) ? 1 : -1;
    for (const sx of [1, -1]) for (let i = 0; i < nbS; i++) {
      const z0 = sx > 0 ? D / 2 - i * bwS : -D / 2 + i * bwS, z1 = z0 - sx * bwS;
      const cell = sx === dsx && i === doorS ? doorC : (sx === dsx || i % 2 === 0) ? winC : plainC;
      wall(G, sx * W / 2, z0, sx * W / 2, z1, wy0, wy0 + wh, wc, cell, uo + i, uo + i + 1, 0, 1, wk);
    }
    wall(G, W / 2, -D / 2, -W / 2, -D / 2, wy0, wy0 + wh, wc, plainC, 0, W / 2.6, 0, 1, wk);
    if (F > 1) {                                                // an upper storey (rare): plain bands with windows
      wall(G, -W / 2, D / 2, W / 2, D / 2, wy0 + wh, H, wc, winC, uo, uo + nbF, 0, 1, wk);
      wall(G, W / 2, D / 2, W / 2, -D / 2, wy0 + wh, H, wc, winC, uo, uo + nbS, 0, 1, wk);
      wall(G, W / 2, -D / 2, -W / 2, -D / 2, wy0 + wh, H, wc, plainC, 0, 2, 0, 1, wk);
      wall(G, -W / 2, -D / 2, -W / 2, D / 2, wy0 + wh, H, wc, winC, uo, uo + nbS, 0, 1, wk);
    }
    if (log && !G.low) for (const sx of [1, -1]) for (const sz of [1, -1]) box(G, sx * W / 2 - 0.18, sx * W / 2 + 0.18, wy0, H, sz * D / 2 - 0.18, sz * D / 2 + 0.18, mul(wc, 1.1), C.log, KW, 'fbrl', { su: 2, sv: 1 });
    // roof and gables
    G.push(0, 0, 0, front ? 0 : -Math.PI / 2);
    const a = front ? W / 2 : D / 2, b = front ? D / 2 : W / 2;
    const gc = boardsGable ? boardCol : wc, gcell = boardsGable ? C.boards : (log ? C.log : C.plaster);
    const R = saddle(G, { a, b, y0: H, h: hR, oe: 0.45, col: roof.col, cell: roof.cell, wallCol: gc, wallCell: gcell, wallK: KP, uvo: { su: 2.5, sv: 2.5 },
      endF: endF === 'half' ? { t: 'half', or: 0.4, f: 0.62 } : { t: 'gable', or: 0.4 }, endB: endB === 'hip' ? { t: 'hip' } : endB === 'half' ? { t: 'half', or: 0.4 } : { t: 'gable', or: 0.4 } });
    // a gable window and the chimney
    if (endF === 'gable' || !G.low) {
      const y = H + 0.6;
      if (H + hR * (endF === 'half' ? 0.6 : 1) > y + 1.6) wall(G, -0.45, b + 0.04, 0.45, b + 0.04, y, y + 1.0, gc, C.attic, uo, uo + 1, 3, 4);
    }
    if (!G.low && boardsGable) box(G, -a, a, H - 0.1, H + 0.15, b - 0.05, b + 0.12, mul(boardCol, 0.8), C.planks, KW, 'ftd');
    const cz = r.range(R.zr0 + 0.8, R.zr1 - 0.8);
    if (R.zr1 - R.zr0 > 2) chimney(G, r.range(-0.3, 0.3), cz, H + hR - 1, H + hR + r.range(0.5, 1.0), mul(log ? hx(0xd8d2c4) : wc, 0.95), false);
    G.pop();
    return { H, hR };
  }

  /* ---------- barn / shed ---------- */
  function barn(G, lot, r, far, small) {
    const W = Math.max(3, lot.w || 10), D = Math.max(3, lot.d || 8), g0 = Math.max(0, lot.rise || 0);
    const H = g0 + (small ? r.range(2.2, 2.7) : r.range(3.6, 4.8));
    const wc = jit(r.pick(PAL.wood), r, 0.08), stoneCol = jit(r.pick(PAL.stone), r, 0.07);
    const roof = roofMat(r, r.pick(['shingle', 'thatch', 'tile', 'brown', 'shingle']));
    const along = W >= D;                                     // ridge along the longer side
    const a = along ? D / 2 : W / 2, b = along ? W / 2 : D / 2, pitch = r.range(40, 50), hR = a * Math.tan(pitch * Math.PI / 180);
    const shed = small && r.chance(0.5), half = !small && r.chance(0.35), uo = r.int(0, 15);
    const stoneBase = !small && r.chance(0.5) ? r.range(0.8, 1.6) : 0.3;
    if (far) {
      for (const [x0, z0, x1, z1] of [[-W / 2, D / 2, W / 2, D / 2], [W / 2, D / 2, W / 2, -D / 2], [W / 2, -D / 2, -W / 2, -D / 2], [-W / 2, -D / 2, -W / 2, D / 2]])
        wall(G, x0, z0, x1, z1, -0.5, H, wc, C.planks, 0, Math.hypot(x1 - x0, z1 - z0) / 2.5, 0, H / 2.5, KP);
      G.push(0, 0, 0, along ? -Math.PI / 2 : 0);
      saddle(G, { a, b, y0: H, h: shed ? hR * 0.4 : hR, col: roof.col, cell: roof.cell, wallCol: wc, wallCell: C.planks, wallK: KP });
      G.pop();
      return { H };
    }
    plinth(G, W, D, -0.5, g0 + stoneBase, stoneCol, 0.04);
    const walls = [[-W / 2, D / 2, W / 2, D / 2], [W / 2, D / 2, W / 2, -D / 2], [W / 2, -D / 2, -W / 2, -D / 2], [-W / 2, -D / 2, -W / 2, D / 2]];
    for (const [x0, z0, x1, z1] of walls) wall(G, x0, z0, x1, z1, g0 + stoneBase, H, wc, C.planks, 0, Math.hypot(x1 - x0, z1 - z0) / 2.5, 0, (H - g0) / 2.5, KP);
    const dw = Math.min(small ? 1.6 : 4, W * 0.5), dh = Math.min(small ? 2.0 : 3.6, H - g0 - 0.3);
    wall(G, -dw / 2, D / 2 + 0.04, dw / 2, D / 2 + 0.04, g0 + 0.05, g0 + dh, wc, C.barnDoor, uo, uo + 1, 0, 1, KP);
    if (!G.low && !small) for (const sx of [1, -1]) for (const sz of [1, -1]) box(G, sx * W / 2 - 0.14, sx * W / 2 + 0.14, g0, H, sz * D / 2 - 0.14, sz * D / 2 + 0.14, mul(wc, 0.7), C.planks, KW, 'fbrl', { su: 1, sv: 2 });
    if (shed) {                                               // lean-to: one slope from the front down to the back
      const yF = H + hR * 0.4, o = 0.4;
      G.face([[-W / 2 - o, yF + 0.1, D / 2 + o], [W / 2 + o, yF + 0.1, D / 2 + o], [W / 2 + o, H - 0.1, -D / 2 - o], [-W / 2 - o, H - 0.1, -D / 2 - o]], roof.col, roof.cell, 4, { su: 3, sv: 3 }, [0, 1, 0]);
      for (const sx of [1, -1]) G.face([[sx * W / 2, H, D / 2], [sx * W / 2, yF, D / 2], [sx * W / 2, H, -D / 2]], wc, C.planks, KP, { su: 2.5, sv: 2.5 }, [sx, 0, 0]);
      box(G, -W / 2, W / 2, H, yF, D / 2 - 0.01, D / 2, wc, C.planks, KP, 'f');
    } else {
      G.push(0, 0, 0, along ? -Math.PI / 2 : 0);
      saddle(G, { a, b, y0: H, h: hR, oe: 0.4, col: roof.col, cell: roof.cell, wallCol: wc, wallCell: C.planks, wallK: KP, uvo: { su: 2.5, sv: 2.5 },
        endF: half ? { t: 'half', or: 0.35 } : { t: 'gable', or: 0.35 }, endB: half ? { t: 'half', or: 0.35 } : { t: 'gable', or: 0.35 } });
      G.pop();
    }
    return { H };
  }

  /* ---------- farmstead (statek): house, barn across the back, gate wall, side shed ---------- */
  function farm(G, lot, r, far) {
    const W = Math.max(14, lot.w || 20), D = Math.max(14, lot.d || 22), g0 = Math.max(0, lot.rise || 0);
    const hw = clamp(W * 0.38, 6.5, 9), hd = D * r.range(0.55, 0.68), bd = clamp(D * 0.3, 6, 9);
    const log = r.chance(0.25), seedR = () => (r() * 4294967296) >>> 0;
    const sub = (x, z, yaw, l, fn) => { G.push(x, 0, z, yaw); fn(Object.assign({ rise: g0, y: 0 }, l)); G.pop(); };
    sub(-W / 2 + hw / 2, D / 2 - hd / 2, 0, { w: hw, d: hd, floors: 1 }, l => cottage(G, l, rng(seedR()), far, log));
    sub(0, -D / 2 + bd / 2, 0, { w: W, d: bd }, l => barn(G, l, rng(seedR()), far, false));
    const shedOn = r.chance(0.6), sw = 4.2;
    const zA = -D / 2 + bd + 0.6, zB = D / 2 - 1.2;
    if (shedOn && zB - zA > 3) sub(W / 2 - sw / 2, (zA + zB) / 2, -Math.PI / 2, { w: zB - zA, d: sw }, l => barn(G, l, rng(seedR()), far, true));
    // gate wall along the front, from the house to the right edge
    const x0 = -W / 2 + hw, x1 = W / 2, wh = g0 + 2.6, wcol = jit(r.pick(PAL.cottage), r, 0.04), z = D / 2 - 0.25;
    box(G, x0, x1, -0.5, wh, z - 0.25, z + 0.25, wcol, C.plaster, KP, far ? 'fbr' : 'fbrt', { su: 3, sv: 3 });
    if (far) return;
    const gw = Math.min(3.6, (x1 - x0) * 0.5), gx = x0 + (x1 - x0) * r.range(0.35, 0.6);
    wall(G, gx - gw / 2, z + 0.27, gx + gw / 2, z + 0.27, g0, g0 + 2.4, wcol, C.farmGate, 0, 1, 0, 1, KP);
    const rc = roofMat(r, 'tile');
    G.push((x0 + x1) / 2, 0, z, -Math.PI / 2);
    saddle(G, { a: 0.4, b: (x1 - x0) / 2, y0: wh, h: 0.45, oe: 0.1, col: rc.col, cell: rc.cell, walls: false });
    G.pop();
  }

  /* ---------- landmarks ---------- */
  function spire(G, x, z, r0, y, h, n, col, cell, cross) {
    cone(G, x, z, r0, y, h, n, col, cell, 4);
    finial(G, x, y + h - 0.2, z, Math.max(0.6, r0 * 0.25), cross);
  }
  const ONION = [[1, 0], [1.02, 0.07], [1.28, 0.24], [1.2, 0.4], [0.72, 0.56], [0.3, 0.66], [0.26, 0.72], [0.46, 0.8], [0.42, 0.88], [0.14, 0.95], [0.08, 1.04], [0, 1.12]];
  const HELMET = [[1, 0], [1.06, 0.1], [0.94, 0.28], [0.6, 0.42], [0.38, 0.52], [0.44, 0.6], [0.4, 0.68], [0.2, 0.74], [0.2, 0.86], [0.08, 0.95], [0, 1.04]];
  function crown(G, kind, x, z, R, y, Hc, n, col, cell) {
    if (kind === 'spire') { spire(G, x, z, R * 1.08, y, Hc, G.low ? 4 : 8, col, cell, true); return; }
    if (kind === 'pyramid') { cone(G, x, z, R * 1.12, y, Hc, 4, col, cell, 4, Math.PI / 4); finial(G, x, y + Hc - 0.2, z, 0.8, true); return; }
    const prof = (kind === 'onion' ? ONION : HELMET).map(([r, t]) => [r * R, y + t * Hc]);
    if (G.low) { cone(G, x, z, R, y, Hc, 6, col, cell, 4); } else lathe(G, x, z, prof, n, col, cell, 4);
    finial(G, x, y + Hc * (kind === 'onion' ? 1.12 : 1.04) - 0.2, z, 0.8, true);
  }
  /** Square tower walls from y0 to y1 with a window cell per storey of sv. */
  function towerBody(G, x, z, s, y0, y1, col, cell, sv, uo) {
    const h = s / 2, n = Math.max(1, Math.round(s / 3));
    wall(G, x - h, z + h, x + h, z + h, y0, y1, col, cell, uo, uo + n, 0, (y1 - y0) / sv);
    wall(G, x + h, z + h, x + h, z - h, y0, y1, col, cell, uo + 3, uo + 3 + n, 0, (y1 - y0) / sv);
    wall(G, x + h, z - h, x - h, z - h, y0, y1, col, cell, uo + 6, uo + 6 + n, 0, (y1 - y0) / sv);
    wall(G, x - h, z - h, x - h, z + h, y0, y1, col, cell, uo + 9, uo + 9 + n, 0, (y1 - y0) / sv);
  }
  function ring(G, x, z, s, y, hgt, o, col) { box(G, x - s / 2 - o, x + s / 2 + o, y, y + hgt, z - s / 2 - o, z + s / 2 + o, col, C.stone, KS, G.low ? 'fbrlt' : 'fbrltd'); }
  function clockFaces(G, x, z, s, y, cs, sides, col) {
    const h = s / 2 + 0.05, WHITE = col || hx(0xe2ddd3);
    for (const sd of sides) {
      if (sd === 'f') wall(G, x - cs / 2, z + h, x + cs / 2, z + h, y, y + cs, WHITE, C.clock, 0, 1, 0, 1);
      if (sd === 'r') wall(G, x + h, z + cs / 2, x + h, z - cs / 2, y, y + cs, WHITE, C.clock, 0, 1, 0, 1);
      if (sd === 'l') wall(G, x - h, z - cs / 2, x - h, z + cs / 2, y, y + cs, WHITE, C.clock, 0, 1, 0, 1);
      if (sd === 'b') wall(G, x + cs / 2, z - h, x - cs / 2, z - h, y, y + cs, WHITE, C.clock, 0, 1, 0, 1);
    }
  }
  function turrets(G, x, z, s, y, h, roofCol, roofCell, wallCol, spH) {
    const n = G.low ? 4 : 8, rr = Math.max(0.55, s * 0.09);
    for (const sx of [1, -1]) for (const sz of [1, -1]) {
      const cx = x + sx * (s / 2), cz = z + sz * (s / 2);
      prism(G, cx, cz, rr, rr, y, y + h, n, wallCol, C.stone, KS, Math.PI / n, 3);
      cone(G, cx, cz, rr * 1.25, y + h, spH, n, roofCol, roofCell, 4);
    }
  }
  /** Apse: half polygon behind (−Z) a nave end at z0. */
  function apse(G, z0, rad, y0, y1, n, wc, cell, roofCol, roofCell, uo, k) {
    const pts = [];
    for (let i = 0; i <= n; i++) { const a = -Math.PI / 2 + Math.PI * i / n; pts.push([Math.sin(a) * rad, z0 - Math.cos(a) * rad]); }
    for (let i = 0; i < n; i++) wall(G, pts[i + 1][0], pts[i + 1][1], pts[i][0], pts[i][1], y0, y1, wc, cell, uo + i, uo + i + 1, 0, 1, k);
    const hh = rad * 0.95;
    for (let i = 0; i < n; i++) {
      const a = pts[i], b = pts[i + 1], am = -Math.PI / 2 + Math.PI * (i + 0.5) / n;
      G.face([[b[0] * 1.08, y1 - 0.1, z0 + (b[1] - z0) * 1.08], [a[0] * 1.08, y1 - 0.1, z0 + (a[1] - z0) * 1.08], [0, y1 + hh, z0]], roofCol, roofCell, 4, { su: 3, sv: 3 }, [Math.sin(am), 0.8, -Math.cos(am)]);
    }
  }

  function church(G, lot, r, far, small) {
    const W = Math.max(8, lot.w || 14), D = Math.max(12, lot.d || 30), g0 = Math.max(0, lot.rise || 0), uo = r.int(0, 15);
    const baroque = lot.style === 'baroque' || (lot.style !== 'gothic' && r.chance(0.5));
    const wc = jit(r.pick(baroque ? PAL.church.concat([0xefe2c0, 0xe8d6b0]) : PAL.church.concat(PAL.stone)), r, 0.04);
    const stoneCol = jit(r.pick(PAL.stone), r, 0.06);
    const roof = roofMat(r, baroque ? r.pick(['tile', 'tile', 'slate']) : r.pick(['slate', 'tile', 'brown']));
    const crownK = small ? 'spire' : baroque ? r.pick(['onion', 'helmet', 'onion']) : r.pick(['spire', 'spire', 'pyramid']);
    const crownCol = crownK === 'spire' && r.chance(0.5) ? roof : roofMat(r, crownK === 'pyramid' ? 'slate' : 'copper');
    const nw = small ? W : W * 0.82, hn = g0 + (small ? r.range(5.5, 7) : r.range(10, 13.5));
    const tw = small ? 0 : clamp(W * 0.42, 4.5, 8), ar = nw * 0.45;
    const zb = -D / 2 + ar, zfN = D / 2 - tw * 0.6, len = zfN - zb, zc = (zfN + zb) / 2;
    const ht = hn + (small ? 0 : r.range(12, 18) + (lot.floors || 2) * 1.2);
    const pitch = baroque ? r.range(40, 46) : r.range(50, 56), hR = nw / 2 * Math.tan(pitch * Math.PI / 180);
    const winC = baroque ? C.bChurch : C.lancet;
    const nbS = Math.max(2, Math.round(len / 4.2));
    if (far) {
      box(G, -nw / 2, nw / 2, -0.5, hn, zb - ar * 0.6, zfN, wc, winC, KP, 'fbrl', { su: len / nbS, sv: hn - g0 });
      G.push(0, 0, zc - ar * 0.3, 0);
      saddle(G, { a: nw / 2, b: len / 2 + ar * 0.3, y0: hn, h: hR, col: roof.col, cell: roof.cell, wallCol: wc });
      G.pop();
      if (small) { cone(G, 0, zfN - 1.5, 0.9, hn + hR - 0.5, 4.5, 4, crownCol.col, crownCol.cell, 4); return; }
      box(G, -tw / 2, tw / 2, -0.5, ht, D / 2 - tw, D / 2, wc, C.towerWin, KP, 'fbrl', { su: tw / 2, sv: 4 });
      cone(G, 0, D / 2 - tw / 2, tw * 0.62, ht, crownK === 'spire' ? tw * 2.4 : tw * 1.4, 4, crownCol.col, crownCol.cell, 4, Math.PI / 4);
      return;
    }
    plinth(G, nw, len, -0.5, g0 + 0.4, stoneCol);
    G.push(0, 0, zc, 0);
    // nave walls with tall windows
    for (const sx of [1, -1]) {
      const x = sx * nw / 2;
      wall(G, x, sx * len / 2, x, -sx * len / 2, g0, hn, wc, winC, uo, uo + nbS, 0, 1);
    }
    const R = saddle(G, { a: nw / 2, b: len / 2, y0: hn, h: hR, oe: 0.45, col: roof.col, cell: roof.cell, wallCol: wc, uvo: { su: 3, sv: 3 },
      endF: { t: 'gable', or: 0.3 }, endB: { t: 'gable', or: 0.3 } });
    void R;
    wall(G, nw / 2, -len / 2, -nw / 2, -len / 2, g0, hn, wc, C.plaster, 0, nw / 3, 0, 3);
    wall(G, -nw / 2, len / 2, nw / 2, len / 2, g0, hn, wc, C.plaster, 0, nw / 3, 0, 3);
    // buttresses (gothic)
    if (!baroque && !G.low) for (let i = 0; i <= nbS; i++) {
      const z = -len / 2 + i * len / nbS;
      for (const sx of [1, -1]) {
        const x0 = sx > 0 ? nw / 2 : -nw / 2 - 0.9, x1 = x0 + 0.9;
        box(G, x0, x1, g0, hn - 1.8, z - 0.4, z + 0.4, stoneCol, C.stone, KS, sx > 0 ? 'fbr' : 'fbl');
        G.face([[sx * (nw / 2 + 0.9), hn - 1.8, z + 0.4], [sx * (nw / 2 + 0.9), hn - 1.8, z - 0.4], [sx * nw / 2, hn - 0.4, z - 0.4], [sx * nw / 2, hn - 0.4, z + 0.4]], stoneCol, C.stone, KS, { su: 2, sv: 2 }, [sx, 1, 0]);
      }
    }
    if (baroque && !G.low) for (const sx of [1, -1]) box(G, -nw / 2 - 0.05, nw / 2 + 0.05, hn - 0.45, hn, -len / 2, len / 2, mul(wc, 1.06), C.plaster, KP, sx > 0 ? 'r' : 'l');
    G.pop();
    apse(G, zb, ar, g0, hn - (small ? 0 : 0.6), G.low ? 3 : 5, wc, winC, roof.col, roof.cell, uo, KP);
    if (small) {
      // ridge turret over the front
      const zt = zfN - 1.6, yt = hn + hR - 0.6, n = G.low ? 4 : 8;
      prism(G, 0, zt, 0.75, 0.75, yt, yt + 2.2, n, wc, C.belfry, KP, Math.PI / n, 2.2);
      crown(G, crownK, 0, zt, 0.8, yt + 2.2, 3.6, n, crownCol.col, crownCol.cell);
      wall(G, -0.9, D / 2 + 0.03 - tw * 0.6, 0.9, D / 2 + 0.03 - tw * 0.6, g0, g0 + 3.2, wc, C.chDoor, uo, uo + 1, 0, 1);
      wall(G, -0.6, D / 2 + 0.03 - tw * 0.6, 0.6, D / 2 + 0.03 - tw * 0.6, g0 + 3.6, g0 + 4.8, wc, C.oculus, uo, uo + 1, 1, 2);
      return;
    }
    // west tower
    const tz = D / 2 - tw / 2;
    plinth(G, tw, tw, -0.5, g0 + 0.5, stoneCol);
    towerBody(G, 0, tz, tw, g0, ht - 4.5, wc, baroque ? C.plaster : C.towerWin, 4.5, uo);
    towerBody(G, 0, tz, tw, ht - 4.5, ht, wc, C.belfry, 4.5, uo);
    for (const y of [hn, ht - 4.5]) ring(G, 0, tz, tw, y - 0.3, 0.3, 0.12, mul(wc, 0.94));
    ring(G, 0, tz, tw, ht, 0.45, 0.25, mul(wc, 0.94));
    wall(G, -1.3, D / 2 + 0.03, 1.3, D / 2 + 0.03, g0, g0 + 4.4, wc, C.chDoor, uo, uo + 1, 0, 1);
    wall(G, -0.9, D / 2 + 0.03, 0.9, D / 2 + 0.03, g0 + 5.6, g0 + 7.4, wc, baroque ? C.oculus : C.rose, uo, uo + 1, 1, 2);
    if (r.chance(0.5)) clockFaces(G, 0, tz, tw, ht - 7.6, Math.min(2.4, tw * 0.45), ['f', 'r', 'l'], wc);
    const crH = crownK === 'spire' ? tw * r.range(2.2, 3.0) : crownK === 'pyramid' ? tw * 1.5 : tw * r.range(1.2, 1.5);
    crown(G, crownK, 0, tz, crownK === 'spire' ? tw * 0.58 : tw * 0.48, ht + 0.45, crH, G.hi ? 8 : 6, crownCol.col, crownCol.cell);
    if (crownK === 'spire' && !G.low) for (const sx of [1, -1]) for (const sz of [1, -1]) cone(G, sx * tw * 0.42, tz + sz * tw * 0.42, 0.35, ht + 0.45, 2.6, 4, crownCol.col, crownCol.cell, 4);
  }

  function cathedral(G, lot, r, far) {
    const W = Math.max(20, lot.w || 32), D = Math.max(36, lot.d || 70), g0 = Math.max(0, lot.rise || 0), uo = r.int(0, 15);
    const wc = jit(r.pick(PAL.stone.concat([0xb8ae9a, 0xa9a08e])), r, 0.05), dark = mul(wc, 0.86);
    const roof = roofMat(r, r.pick(['slate', 'slate', 'copper', 'tile']));
    const spireM = roofMat(r, r.chance(0.6) ? 'slate' : 'copper');
    const twin = r.chance(0.7);
    const nw = W * 0.42, aw = (W - nw) / 2, hn = g0 + r.range(22, 28), ha = g0 + hn * 0.42;
    const tws = twin ? W * 0.3 : nw * 1.1, ht = hn + (twin ? r.range(12, 18) : r.range(26, 32));
    const rad = nw / 2, zb = -D / 2 + rad + 2, zf = D / 2 - tws * 0.55, len = zf - zb, zc = (zf + zb) / 2;
    const hR = nw / 2 * Math.tan(56 * Math.PI / 180), nb = Math.max(4, Math.round(len / 6)), bl = len / nb;
    const spH = twin ? tws * r.range(2.6, 3.2) : tws * 1.6;
    const towerX = twin ? [-(W / 2 - tws / 2), W / 2 - tws / 2] : [0];
    if (far) {
      box(G, -W / 2, W / 2, -0.5, ha, zb, zf, wc, C.lancet, KP, 'fbrl', { su: bl, sv: ha - g0 });
      box(G, -nw / 2, nw / 2, ha, hn, zb, zf, wc, C.lancet, KP, 'fbrl', { su: bl, sv: hn - ha });
      G.push(0, 0, zc - rad / 2, 0);
      saddle(G, { a: nw / 2, b: len / 2 + rad / 2, y0: hn, h: hR, col: roof.col, cell: roof.cell, wallCol: wc });
      G.pop();
      for (const tx of towerX) {
        box(G, tx - tws / 2, tx + tws / 2, -0.5, ht, D / 2 - tws, D / 2, wc, C.towerWin, KP, 'fbrl', { su: 3, sv: 6 });
        cone(G, tx, D / 2 - tws / 2, tws * 0.6, ht, spH, 4, spireM.col, spireM.cell, 4, Math.PI / 4);
      }
      return;
    }
    plinth(G, W, len, -0.5, g0 + 0.5, mul(wc, 0.85));
    G.push(0, 0, zc, 0);
    // aisles: outer walls with lancets, lean-to roofs
    for (const sx of [1, -1]) {
      const x = sx * W / 2;
      wall(G, x, sx * len / 2, x, -sx * len / 2, g0, ha, wc, C.lancet, uo, uo + nb, 0, 1);
      G.face([[sx * (W / 2 + 0.3), ha - 0.2, -len / 2], [sx * (W / 2 + 0.3), ha - 0.2, len / 2], [sx * nw / 2, ha + 3.2, len / 2], [sx * nw / 2, ha + 3.2, -len / 2]], roof.col, roof.cell, 4, { su: 3, sv: 3 }, [sx, 1, 0]);
      wall(G, sx * nw / 2, sx * len / 2, sx * nw / 2, -sx * len / 2, ha + 3, hn, wc, C.tracery, uo, uo + nb, 0, 1);
      for (const sz of [1, -1]) G.face([[sx * W / 2, g0, sz * len / 2], [sx * nw / 2, g0, sz * len / 2], [sx * nw / 2, ha + 3.2, sz * len / 2], [sx * W / 2, ha - 0.2, sz * len / 2]], wc, C.stone, KP, { su: 3, sv: 3 }, [0, 0, sz]);
    }
    saddle(G, { a: nw / 2, b: len / 2, y0: hn, h: hR, oe: 0.4, col: roof.col, cell: roof.cell, wallCol: wc, endF: { t: 'gable', or: 0.2 }, endB: { t: 'gable', or: 0.2 }, uvo: { su: 3, sv: 3 } });
    wall(G, -nw / 2, len / 2, nw / 2, len / 2, ha, hn, wc, C.stone, 0, nw / 3, 0, 3);
    // flying buttresses with pinnacles
    const step = G.low ? 2 : 1;
    for (let i = 0; i <= nb; i += step) {
      const z = -len / 2 + i * bl;
      for (const sx of [1, -1]) {
        const x0 = sx * W / 2, x1 = sx * (W / 2 + 1.3), ytop = ha + 6;
        box(G, Math.min(x0, x1), Math.max(x0, x1), g0, ytop, z - 0.55, z + 0.55, dark, C.stone, KS, sx > 0 ? 'fbrt' : 'fblt');
        cone(G, (x0 + x1) / 2, z, 0.62, ytop, 3.6, 4, dark, C.stone, KS, Math.PI / 4);
        if (G.low) continue;
        const ax = sx * (W / 2 + 0.6), bx = sx * nw / 2, ay = ytop - 1.2, by = hn - 2.5, t = 0.28;
        G.face([[ax, ay, z - t], [ax, ay, z + t], [bx, by, z + t], [bx, by, z - t]], dark, C.stone, KS, { su: 2, sv: 2 }, [sx * (by - ay), Math.abs(bx - ax), 0]);
        G.face([[ax, ay - 0.6, z - t], [ax, ay - 0.6, z + t], [bx, by - 0.6, z + t], [bx, by - 0.6, z - t]], mul(dark, 0.8), C.stone, KS, { su: 2, sv: 2 }, [0, -1, 0]);
        for (const sz of [1, -1]) G.face([[ax, ay - 0.6, z + sz * t], [bx, by - 0.6, z + sz * t], [bx, by, z + sz * t], [ax, ay, z + sz * t]], dark, C.stone, KS, { su: 2, sv: 2 }, [0, 0, sz]);
      }
    }
    // crossing flèche
    if (!G.low) {
      const n = 8, yb = hn + hR - 1;
      prism(G, 0, -len * 0.1, 1.3, 1.1, yb, yb + 3, n, dark, C.belfry, KP, Math.PI / n, 3);
      spire(G, 0, -len * 0.1, 1.5, yb + 3, 10, n, spireM.col, spireM.cell, true);
    }
    G.pop();
    // choir apse with pinnacles
    apse(G, zb, rad, g0, hn - 1, G.low ? 3 : 5, wc, C.lancet, roof.col, roof.cell, uo, KP);
    if (!G.low) for (let i = 0; i <= 5; i++) { const a = -Math.PI / 2 + Math.PI * i / 5; cone(G, Math.sin(a) * (rad + 0.6), zb - Math.cos(a) * (rad + 0.6), 0.5, hn - 3, 5, 4, dark, C.stone, KS, Math.PI / 4); }
    // west front: towers, rose window, portal, gable
    const zw = D / 2, wx = twin ? W / 2 - tws : nw / 2;
    for (const tx of towerX) {
      const tz = D / 2 - tws / 2;
      plinth(G, tws, tws, -0.5, g0 + 0.6, mul(wc, 0.85));
      G.push(tx, 0, tz, 0);
      towerBody(G, 0, 0, tws, g0, ht, wc, C.towerWin, 6, uo);
      for (const y of [ha, hn, ht - 0.4]) ring(G, 0, 0, tws, y, 0.4, 0.2, dark);
      if (twin) {
        spire(G, 0, 0, tws * 0.5, ht, spH, G.low ? 4 : 8, spireM.col, spireM.cell, true);
        if (!G.low) for (const sx of [1, -1]) for (const sz of [1, -1]) {
          spire(G, sx * tws * 0.42, sz * tws * 0.42, tws * 0.12, ht, spH * 0.38, 4, spireM.col, spireM.cell, false);
          if (G.hi) cone(G, sx * tws * 0.24, sz * tws * 0.24, tws * 0.09, ht + spH * 0.12, spH * 0.28, 4, spireM.col, spireM.cell, 4, Math.PI / 4);
        }
      } else {
        const g = G.low ? 6 : 8;
        prism(G, 0, 0, tws * 0.5, tws * 0.46, ht + 0.4, ht + 6, g, wc, C.belfry, KP, Math.PI / g, 6);
        crown(G, 'helmet', 0, 0, tws * 0.5, ht + 6, spH, G.hi ? 10 : 8, spireM.col, spireM.cell);
        clockFaces(G, 0, 0, tws, ht - 6, tws * 0.38, ['f', 'r', 'l', 'b'], wc);
      }
      G.pop();
    }
    if (twin) {
      wall(G, -wx, zw - tws * 0.25, wx, zw - tws * 0.25, g0, hn, wc, C.stone, 0, wx * 2 / 3, 0, (hn - g0) / 3);
      const prof = profTriangle(wx, hn, hR * (wx / (nw / 2)) * 0.9, 0.2);
      profileWall(G, prof, zw - tws * 0.25, 0.6, wc, C.stone, { su: 3, sv: 3 }, { back: !G.low, edgeCol: dark });
      if (!G.low) cone(G, 0, zw - tws * 0.25 - 0.3, 0.3, prof[2][1] - 0.2, 2.4, 4, dark, C.stone, KS);
    }
    const rs = Math.min(nw * 0.62, wx * 1.4), zr = (twin ? zw - tws * 0.25 : zw) + 0.04;
    wall(G, -rs / 2, zr, rs / 2, zr, hn * 0.52, hn * 0.52 + rs, wc, C.rose, uo, uo + 1, 0, 1);
    wall(G, -2.2, zr, 2.2, zr, g0, g0 + 7, wc, C.chDoor, uo, uo + 1, 0, 1);
  }

  function domechurch(G, lot, r, far) {
    const W = Math.max(16, lot.w || 26), D = Math.max(24, lot.d || 40), g0 = Math.max(0, lot.rise || 0), uo = r.int(0, 15);
    const wc = jit(r.pick([0xe8c8b8, 0xefe2c0, 0xe9d8b4, 0xf1ede4, 0xe5c4a8]), r, 0.04), trim = WHITE;
    const roof = roofMat(r, r.pick(['tile', 'copper', 'tile'])), cu = roofMat(r, 'copper');
    const nw = W * 0.62, hn = g0 + r.range(13, 16), zf = D / 2, zc = -D * 0.08, nz0 = zc + nw * 0.5;
    const R0 = nw * 0.46, drumH = r.range(4.5, 6.5), domeH = R0 * 1.25;
    const tw = clamp(W * 0.24, 5, 7.5), tx = W / 2 - tw / 2, tz = zc - nw * 0.5 - tw / 2 - 1, ht = hn + r.range(18, 24);
    const hR = nw / 2 * Math.tan(38 * Math.PI / 180);
    if (far) {
      box(G, -nw / 2, nw / 2, -0.5, hn, -D / 2, zf, wc, C.bChurch, KP, 'fbrl', { su: 4, sv: hn - g0 });
      box(G, -W / 2, W / 2, -0.5, hn, zc - nw / 2, zc + nw / 2, wc, C.bChurch, KP, 'rl', { su: 4, sv: hn - g0 });
      prism(G, 0, zc, R0, R0, hn, hn + drumH, 6, wc, C.bChurch, KP, 0, drumH);
      cone(G, 0, zc, R0 * 1.02, hn + drumH, domeH, 6, cu.col, cu.cell, 4);
      G.face([[-W / 2, hn, zf], [W / 2, hn, zf], [W / 2, hn, -D / 2], [-W / 2, hn, -D / 2]], roof.col, roof.cell, 4, { su: 3, sv: 3 }, [0, 1, 0]);
      box(G, tx - tw / 2, tx + tw / 2, -0.5, ht, tz - tw / 2, tz + tw / 2, wc, C.towerWin, KP, 'fbrl', { su: 3, sv: 4 });
      cone(G, tx, tz, tw * 0.55, ht, tw * 1.3, 4, cu.col, cu.cell, 4, Math.PI / 4);
      return;
    }
    plinth(G, nw, D, -0.5, g0 + 0.5, jit(r.pick(PAL.stone), r, 0.05));
    plinth(G, W, nw, -0.5, g0 + 0.5, jit(r.pick(PAL.stone), r, 0.05));
    // front nave (z from nz0 to zf) and choir (behind the crossing)
    for (const [z0, z1] of [[nz0, zf], [-D / 2, zc - nw / 2]]) {
      const L = z1 - z0, zm = (z0 + z1) / 2, nbS = Math.max(1, Math.round(L / 4.5));
      G.push(0, 0, zm, 0);
      for (const sx of [1, -1]) wall(G, sx * nw / 2, sx * L / 2, sx * nw / 2, -sx * L / 2, g0, hn, wc, C.bChurch, uo, uo + nbS, 0, 1);
      saddle(G, { a: nw / 2, b: L / 2, y0: hn, h: hR, oe: 0.4, col: roof.col, cell: roof.cell, wallCol: wc, walls: z1 !== zf, endF: { t: 'gable', or: 0 }, endB: z1 === zf ? { t: 'gable', or: 0 } : { t: 'hip' } });
      if (z1 !== zf) wall(G, nw / 2, -L / 2, -nw / 2, -L / 2, g0, hn, wc, C.bChurch, uo, uo + 2, 0, 1);
      if (!G.low) for (const sx of [1, -1]) box(G, -nw / 2 - 0.05, nw / 2 + 0.05, hn - 0.5, hn, -L / 2, L / 2, trim, C.plaster, KP, sx > 0 ? 'r' : 'l');
      G.pop();
    }
    // transept (crossing arms), ridge along X
    G.push(0, 0, zc, -Math.PI / 2);
    for (const sx of [1, -1]) wall(G, sx * nw / 2, sx * W / 2, sx * nw / 2, -sx * W / 2, g0, hn, wc, C.bChurch, uo, uo + 4, 0, 1);
    saddle(G, { a: nw / 2, b: W / 2, y0: hn, h: hR, oe: 0.4, col: roof.col, cell: roof.cell, wallCol: wc, endF: { t: 'gable', or: 0.2 }, endB: { t: 'gable', or: 0.2 }, uvo: { su: 3, sv: 3 } });
    G.pop();
    for (const sx of [1, -1]) wall(G, sx * W / 2, zc + sx * nw / 2, sx * W / 2, zc - sx * nw / 2, g0, hn, wc, C.bChurch, uo, uo + 3, 0, 1);
    // west front: two storeys of pilasters, a volute gable
    wall(G, -nw / 2, zf, nw / 2, zf, g0, hn, wc, C.plaster, 0, nw / 3, 0, (hn - g0) / 3);
    const prof = profVolute(nw / 2, hn, hR * 1.15);
    profileWall(G, prof, zf + 0.02, 0.45, wc, C.plaster, { su: 3, sv: 3 }, { back: !G.low, edgeCol: mul(wc, 0.94) });
    for (let i = 0; i < 6; i++) { const x = -nw / 2 + (i + 0.5) * nw / 6 - 0.3; box(G, x, x + 0.6, g0, hn - 0.5, zf, zf + 0.35, trim, C.plaster, KP, 'frl'); }
    box(G, -nw / 2 - 0.1, nw / 2 + 0.1, hn - 0.5, hn, zf, zf + 0.5, trim, C.plaster, KP, 'ftdlr');
    box(G, -nw / 2, nw / 2, g0 + (hn - g0) * 0.48, g0 + (hn - g0) * 0.48 + 0.4, zf, zf + 0.42, trim, C.plaster, KP, 'ftd');
    wall(G, -1.8, zf + 0.04, 1.8, zf + 0.04, g0, g0 + 5.6, wc, C.pDoor, uo, uo + 1, 0, 1);
    for (const x of [-nw * 0.3, nw * 0.3]) wall(G, x - 1, zf + 0.04, x + 1, zf + 0.04, g0 + (hn - g0) * 0.55, g0 + (hn - g0) * 0.55 + 4.2, wc, C.bChurch, uo + 2, uo + 3, 0, 1);
    wall(G, -1, zf + 0.04, 1, zf + 0.04, hn + hR * 0.35, hn + hR * 0.35 + 2, wc, C.oculus, uo, uo + 1, 3, 4);
    // drum + dome + lantern
    const n = G.low ? 8 : G.hi ? 16 : 12;
    prism(G, 0, zc, R0, R0, hn - 1, hn + drumH, n, wc, C.bChurch, KP, Math.PI / n, drumH + 1);
    if (!G.low) prism(G, 0, zc, R0 + 0.3, R0 + 0.3, hn + drumH - 0.5, hn + drumH, n, trim, C.plaster, KP, Math.PI / n, 1);
    const dome = [];
    for (let i = 0; i <= (G.low ? 3 : 6); i++) { const a = i / (G.low ? 3 : 6) * Math.PI / 2 * 0.92; dome.push([R0 * 1.02 * Math.cos(a), hn + drumH + Math.sin(a) * domeH]); }
    const topR = dome[dome.length - 1][0], topY = dome[dome.length - 1][1];
    lathe(G, 0, zc, dome, n, cu.col, cu.cell, 4);
    prism(G, 0, zc, Math.max(1, topR), Math.max(1, topR), topY, topY + 2.8, G.low ? 6 : 8, wc, C.belfry, KP, 0, 2.8);
    crown(G, 'onion', 0, zc, Math.max(1, topR) * 1.05, topY + 2.8, 3.2, G.low ? 6 : 8, cu.col, cu.cell);
    // bell tower beside the dome
    plinth(G, tw, tw, -0.5, g0 + 0.5, jit(r.pick(PAL.stone), r, 0.05));
    G.push(tx, 0, tz, 0);
    towerBody(G, 0, 0, tw, g0, ht - 5, wc, C.bChurch, (ht - 5 - g0) / 3, uo);
    towerBody(G, 0, 0, tw, ht - 5, ht, wc, C.belfry, 5, uo);
    for (const y of [hn - 0.5, ht - 5.3]) ring(G, 0, 0, tw, y, 0.4, 0.15, trim);
    ring(G, 0, 0, tw, ht, 0.5, 0.3, trim);
    clockFaces(G, 0, 0, tw, ht - 8.5, tw * 0.42, ['f', 'r', 'l', 'b'], wc);
    crown(G, r.pick(['helmet', 'onion']), 0, 0, tw * 0.5, ht + 0.5, tw * 1.5, G.hi ? 8 : 6, cu.col, cu.cell);
    G.pop();
  }

  function townhall(G, lot, r, far) {
    const W = Math.max(10, lot.w || 22), D = Math.max(10, lot.d || 16), g0 = Math.max(0, lot.rise || 0);
    const style = lot.style === 'renaissance' || lot.style === 'gothic' ? lot.style : r.pick(['gothic', 'renaissance']);
    const ts = clamp(Math.min(W, D) * 0.42, 5.5, 8), sx = r.chance(0.5) ? 1 : -1;
    const bodyW = W - ts + 0.4;
    G.push(-sx * (ts - 0.4) / 2, 0, 0, 0);
    const body = townhouse(G, Object.assign({}, lot, { w: bodyW, style, floors: Math.max(3, lot.floors || 3), corner: false }), rng((lot.seed ^ 0x51ed27) >>> 0), far);
    G.pop();
    const tx = sx * (W / 2 - ts / 2), tz = D / 2 - ts / 2 + 0.5, ht = body.H + r.range(16, 24);
    const wc = jit(r.pick(PAL.stone.concat(PAL.darkStone)), r, 0.05), roof = roofMat(r, r.pick(['slate', 'slate', 'brown'])), uo = r.int(0, 15);
    if (far) {
      box(G, tx - ts / 2, tx + ts / 2, -0.5, ht, tz - ts / 2, tz + ts / 2, wc, C.towerWin, KP, 'fbrl', { su: 3, sv: 4 });
      cone(G, tx, tz, ts * 0.7, ht, ts * 1.6, 4, roof.col, roof.cell, 4, Math.PI / 4);
      return;
    }
    plinth(G, ts, ts, -0.5, g0 + 0.5, mul(wc, 0.9));
    G.push(tx, 0, tz, 0);
    towerBody(G, 0, 0, ts, g0, ht, wc, C.towerWin, 4.5, uo);
    for (const y of [body.H, ht - 3.2]) ring(G, 0, 0, ts, y - 0.3, 0.3, 0.15, mul(wc, 0.9));
    clockFaces(G, 0, 0, ts, ht - 8.5, ts * 0.55, ['f', 'r', 'l'], wc);
    // gallery: a projecting walkway with a railing
    const gy = ht - 3.2, go = 0.7;
    ring(G, 0, 0, ts, gy, 0.35, go, mul(wc, 0.85));
    if (!G.low) for (const [x0, x1, z0, z1] of [[-ts / 2 - go, ts / 2 + go, ts / 2 + go - 0.12, ts / 2 + go], [-ts / 2 - go, ts / 2 + go, -ts / 2 - go, -ts / 2 - go + 0.12], [ts / 2 + go - 0.12, ts / 2 + go, -ts / 2 - go, ts / 2 + go], [-ts / 2 - go, -ts / 2 - go + 0.12, -ts / 2 - go, ts / 2 + go]])
      box(G, x0, x1, gy + 0.35, gy + 1.3, z0, z1, DARK, C.plaster, KP, 'fbrlt');
    ring(G, 0, 0, ts, ht, 0.4, 0.2, mul(wc, 0.9));
    cone(G, 0, 0, ts * 0.72, ht + 0.4, ts * 1.7, 4, roof.col, roof.cell, 4, Math.PI / 4);
    finial(G, 0, ht + 0.4 + ts * 1.7 - 0.2, 0, 0.9, false);
    turrets(G, 0, 0, ts, ht - 0.6, 2.4, roof.col, roof.cell, wc, 3.2);
    G.pop();
  }

  function tower(G, lot, r, far, gate) {
    const W = Math.max(6, lot.w || 10), D = Math.max(6, lot.d || 10), g0 = Math.max(0, lot.rise || 0), uo = r.int(0, 15);
    const sx = Math.min(W, 16), sz = Math.min(D, 16);
    const ht = g0 + r.range(24, 32) + clamp((lot.floors || 3) - 3, 0, 4) * 2.5;
    const wc = jit(r.pick(r.chance(0.5) ? PAL.darkStone : PAL.stone), r, 0.05), dark = mul(wc, 0.86);
    const roof = roofMat(r, r.pick(['slate', 'slate', 'brown'])), gallery = gate ? r.chance(0.6) : r.chance(0.3);
    const rh = Math.min(sx, sz) * r.range(1.3, 1.9), turr = r.chance(0.8);
    if (far) {
      box(G, -sx / 2, sx / 2, -0.5, ht, -sz / 2, sz / 2, wc, C.towerWin, KP, 'fbrl', { su: 3, sv: 5 });
      G.push(0, 0, 0, sx > sz ? -Math.PI / 2 : 0);
      hipRoof(G, { a: Math.min(sx, sz) / 2, b: Math.max(sx, sz) / 2, y0: ht, h: rh, col: roof.col, cell: roof.cell });
      G.pop();
      return;
    }
    plinth(G, sx, sz, -0.5, g0 + 0.7, dark);
    const h = [sx / 2, sz / 2];
    const nbx = Math.max(1, Math.round(sx / 3.2)), nbz = Math.max(1, Math.round(sz / 3.2)), sv = 5;
    wall(G, -h[0], h[1], h[0], h[1], g0, ht, wc, C.towerWin, uo, uo + nbx, 0, (ht - g0) / sv);
    wall(G, h[0], h[1], h[0], -h[1], g0, ht, wc, C.towerWin, uo + 4, uo + 4 + nbz, 0, (ht - g0) / sv);
    wall(G, h[0], -h[1], -h[0], -h[1], g0, ht, wc, C.towerWin, uo + 8, uo + 8 + nbx, 0, (ht - g0) / sv);
    wall(G, -h[0], -h[1], -h[0], h[1], g0, ht, wc, C.towerWin, uo + 12, uo + 12 + nbz, 0, (ht - g0) / sv);
    for (const y of [g0 + (ht - g0) * 0.34, g0 + (ht - g0) * 0.67]) box(G, -h[0] - 0.15, h[0] + 0.15, y, y + 0.35, -h[1] - 0.15, h[1] + 0.15, dark, C.stone, KS, 'fbrltd');
    if (gate) {
      const gw = Math.min(5, sx * 0.48), gh = Math.min(7.5, (ht - g0) * 0.3);
      wall(G, -gw / 2, h[1] + 0.04, gw / 2, h[1] + 0.04, g0, g0 + gh, wc, C.gate, 0, 1, 0, 1);
      wall(G, gw / 2, -h[1] - 0.04, -gw / 2, -h[1] - 0.04, g0, g0 + gh, wc, C.gate, 0, 1, 0, 1);
    } else wall(G, -1.1, h[1] + 0.04, 1.1, h[1] + 0.04, g0, g0 + 3.6, wc, C.chDoor, uo, uo + 1, 0, 1);
    if (gate && !G.low) clockFaces(G, 0, 0, sx, g0 + (ht - g0) * 0.5, Math.min(3, sx * 0.3), ['f'], wc);
    // parapet / gallery ring at the top, then the steep roof
    if (gallery) {
      const go = 0.8;
      box(G, -h[0] - go, h[0] + go, ht - 0.4, ht, -h[1] - go, h[1] + go, dark, C.stone, KS, 'fbrltd');
      if (!G.low) for (const [x0, x1, z0, z1] of [[-h[0] - go, h[0] + go, h[1] + go - 0.15, h[1] + go], [-h[0] - go, h[0] + go, -h[1] - go, -h[1] - go + 0.15], [h[0] + go - 0.15, h[0] + go, -h[1] - go, h[1] + go], [-h[0] - go, -h[0] - go + 0.15, -h[1] - go, h[1] + go]])
        box(G, x0, x1, ht, ht + 1.0, z0, z1, wc, C.stone, KS, 'fbrlt');
    } else box(G, -h[0] - 0.3, h[0] + 0.3, ht - 0.6, ht, -h[1] - 0.3, h[1] + 0.3, dark, C.stone, KS, 'fbrltd');
    G.push(0, 0, 0, sx > sz ? -Math.PI / 2 : 0);
    const R = hipRoof(G, { a: Math.min(sx, sz) / 2, b: Math.max(sx, sz) / 2, y0: ht, h: rh, oe: 0.3, col: roof.col, cell: roof.cell });
    if (!G.low) for (const yaw of [0, Math.PI]) { G.push(0, 0, 0, yaw); dormer(G, R.plane, 0, 1.1, ht + 1.2, 1.4, 0.8, { wallCol: wc, roofCol: roof.col, roofCell: roof.cell, winCell: C.attic, uo }); G.pop(); }
    G.pop();
    finial(G, 0, ht + rh + 0.1, 0, 1, false);
    if (turr) {
      const n = G.low ? 4 : 8, rr = Math.max(0.7, Math.min(sx, sz) * 0.1);
      for (const ax of [1, -1]) for (const az of [1, -1]) {
        const cx = ax * h[0], cz = az * h[1];
        prism(G, cx, cz, rr, rr, ht - 2.2, ht + 1.6, n, wc, C.towerWin, KP, Math.PI / n, 3);
        for (let i = 0; i < n && !G.low; i++) {
          const a0 = Math.PI / n + i / n * Math.PI * 2, a1 = a0 + Math.PI * 2 / n, am = (a0 + a1) / 2;
          G.face([[cx, ht - 3.3, cz], [cx + Math.sin(a1) * rr, ht - 2.2, cz + Math.cos(a1) * rr], [cx + Math.sin(a0) * rr, ht - 2.2, cz + Math.cos(a0) * rr]], dark, C.stone, KS, { su: 2, sv: 2 }, [Math.sin(am), -1, Math.cos(am)]);
        }
        spire(G, cx, cz, rr * 1.2, ht + 1.6, rh * 0.6, n, roof.col, roof.cell, false);
      }
    }
  }

  function palace(G, lot, r, far) {
    const W = Math.max(16, lot.w || 44), D = Math.max(10, lot.d || 15), g0 = Math.max(0, lot.rise || 0), F = clamp(Math.round(lot.floors || 3), 2, 5);
    const st = lot.style === 'renaissance' || lot.style === 'classic' ? lot.style : 'baroque';
    const nb = Math.max(5, Math.round(W / 3.3)) | 1, bw = W / nb, gh = r.range(4.2, 4.8), uh = r.range(3.6, 4.0), H = g0 + gh + (F - 1) * uh;
    const wc = jit(r.pick(st === 'renaissance' ? PAL.renaissance : st === 'classic' ? PAL.classic : PAL.baroque), r, 0.04), trim = st === 'renaissance' ? mul(wc, 0.92) : WHITE;
    const roof = roofMat(r, st === 'classic' ? r.pick(['slate', 'tile']) : r.pick(['tile', 'tile', 'slate', 'copper']));
    const up = st === 'renaissance' ? C.rUp : st === 'classic' ? C.cUp : r.pick([C.bUp, C.bUp2]);
    const nob = st === 'renaissance' ? C.rUp2 : C.pWin, gw = st === 'renaissance' ? C.rWin : st === 'classic' ? C.cWin : C.bWin;
    const nr = nb >= 13 ? 5 : 3, rw = nr * bw, rp = 0.7, uo = r.int(0, 15);
    const mansard = st !== 'renaissance' && r.chance(0.55), attic = st === 'renaissance';
    const hR = attic ? 1.6 : mansard ? 0 : Math.min(D / 2 * Math.tan(38 * Math.PI / 180), 6);
    const side = st === 'renaissance' ? C.rSgr : C.plaster;
    if (far) {
      wall(G, -W / 2, D / 2, W / 2, D / 2, -0.5, H, wc, up, uo, uo + nb, -0.3, (H - g0) / uh, KP);
      wall(G, W / 2, D / 2, W / 2, -D / 2, -0.5, H, wc, up, uo, uo + D / bw, -0.3, (H - g0) / uh, KP);
      wall(G, W / 2, -D / 2, -W / 2, -D / 2, -0.5, H, wc, up, uo, uo + nb, -0.3, (H - g0) / uh, KP);
      wall(G, -W / 2, -D / 2, -W / 2, D / 2, -0.5, H, wc, up, uo, uo + D / bw, -0.3, (H - g0) / uh, KP);
      G.push(0, 0, 0, -Math.PI / 2);
      hipRoof(G, { a: D / 2, b: W / 2, y0: H, h: mansard ? 5 : hR, col: roof.col, cell: roof.cell });
      G.pop();
      return;
    }
    plinth(G, W, D, -0.5, g0 + 0.5, jit(r.pick(PAL.stone), r, 0.05));
    // facades: front and back with ground floor bays, piano nobile and upper floors; ends with windows
    const mid = (nb - 1) / 2;
    for (const [sg, zz] of [[1, D / 2], [-1, -D / 2]]) {
      for (let i = 0; i < nb; i++) {
        const x0 = sg * (-W / 2 + i * bw), x1 = sg * (-W / 2 + (i + 1) * bw);
        const inR = Math.abs(i - mid) <= (nr - 1) / 2;
        if (sg > 0 && inR) continue;                        // the risalit has its own front
        wall(G, x0, zz, x1, zz, g0, g0 + gh, wc, sg > 0 && i === mid ? C.pDoor : gw, uo + i, uo + i + 1, 0, 1);
      }
      const segs = sg > 0 ? [[-W / 2, -rw / 2], [rw / 2, W / 2]] : [[-W / 2, W / 2]];
      for (const [a, b] of segs) {
        const x0 = sg * a, x1 = sg * b, u0 = uo + (a + W / 2) / bw, u1 = uo + (b + W / 2) / bw;
        wall(G, x0, zz, x1, zz, g0 + gh, g0 + gh + uh, wc, nob, u0, u1, 0, 1);
        if (F > 2) wall(G, x0, zz, x1, zz, g0 + gh + uh, H, wc, up, u0, u1, 1, F - 1);
      }
    }
    const nbs = Math.max(2, Math.round(D / bw));
    for (const sx of [1, -1]) {
      wall(G, sx * W / 2, sx * D / 2, sx * W / 2, -sx * D / 2, g0, g0 + gh, wc, gw, uo, uo + nbs, 0, 1);
      wall(G, sx * W / 2, sx * D / 2, sx * W / 2, -sx * D / 2, g0 + gh, H, wc, up, uo, uo + nbs, 0, F - 1);
    }
    // central risalit
    const zr = D / 2 + rp;
    for (let i = 0; i < nr; i++) {
      const x0 = -rw / 2 + i * bw, bi = mid - (nr - 1) / 2 + i;
      wall(G, x0, zr, x0 + bw, zr, g0, g0 + gh, wc, bi === mid ? C.pDoor : gw, uo + bi, uo + bi + 1, 0, 1);
    }
    wall(G, -rw / 2, zr, rw / 2, zr, g0 + gh, g0 + gh + uh, wc, nob, uo + mid - (nr - 1) / 2, uo + mid + (nr + 1) / 2, 0, 1);
    if (F > 2) wall(G, -rw / 2, zr, rw / 2, zr, g0 + gh + uh, H, wc, up, uo + mid - (nr - 1) / 2, uo + mid + (nr + 1) / 2, 1, F - 1);
    for (const sx of [1, -1]) wall(G, sx * rw / 2, sx > 0 ? zr : D / 2, sx * rw / 2, sx > 0 ? D / 2 : zr, g0, H, wc, C.plaster, 0, rp / 3, 0, (H - g0) / 3);
    if (st !== 'renaissance') for (let i = 0; i <= nr; i += (nr > 3 ? 1 : 1)) { const x = -rw / 2 + i * bw - 0.3; box(G, x, x + 0.6, g0 + gh, H - 0.5, zr, zr + 0.18, trim, C.plaster, KP, 'frl'); }
    // cornices, string course
    box(G, -W / 2 - 0.05, W / 2 + 0.05, H - 0.5, H, -D / 2 - 0.35, D / 2 + 0.35, trim, C.plaster, KP, G.low ? 'fbrl' : 'fbrltd');
    box(G, -rw / 2 - 0.1, rw / 2 + 0.1, H - 0.5, H, D / 2, zr + 0.35, trim, C.plaster, KP, 'frlt');
    box(G, -W / 2, W / 2, g0 + gh - 0.3, g0 + gh, D / 2, D / 2 + 0.15, trim, C.plaster, KP, 'ftd');
    // roof
    G.push(0, 0, 0, -Math.PI / 2);
    let R;
    if (attic) R = hipRoof(G, { a: D / 2 - 0.1, b: W / 2 - 0.1, y0: H, h: hR, col: roof.col, cell: roof.cell });
    else if (mansard) R = hipRoof(G, { a: D / 2, b: W / 2, y0: H, h1: 3.6, d1: 1.5, h: Math.min(2.6, D * 0.18), oe: 0.4, col: roof.col, cell: roof.cell });
    else R = hipRoof(G, { a: D / 2, b: W / 2, y0: H, h: hR, oe: 0.45, col: roof.col, cell: roof.cell });
    if (!attic && !G.low) {
      for (const yaw of [0, Math.PI]) {
        G.push(0, 0, 0, yaw);
        for (let i = 1; i < nb - 1; i += 2) {
          const xc = -W / 2 + (i + 0.5) * bw;
          if (yaw === 0 && Math.abs(i - mid) <= (nr - 1) / 2) continue;
          dormer(G, R.plane, -xc, 1.25, H + 0.5, mansard ? 1.8 : 1.4, 0.75, { wallCol: wc, roofCol: roof.col, roofCell: roof.cell, winCell: st === 'baroque' ? C.oculus : C.attic, uo: uo + i, gableCol: trim });
        }
        G.pop();
      }
    }
    const top = attic ? H + hR : R.top;
    for (let c = 0; c < (G.low ? 2 : 4); c++) chimney(G, r.range(-1, 1), (c + 0.5) / (G.low ? 2 : 4) * W * 0.8 - W * 0.4, top - 1.5, top + 1, mul(wc, 0.92), true);
    // the risalit roof: a gable running into the main roof
    if (!attic) dormer(G, R.plane, 0, rw, H, 0.1, Math.min(4, rw * 0.32), { xf: zr, noFront: true, gable: false, wallCol: wc, roofCol: roof.col, roofCell: roof.cell, winCell: up });
    G.pop();
    if (attic) {
      const ph = 2.2, t = 0.35;
      for (const [zz, sg] of [[D / 2, 1], [-D / 2, -1]]) {
        G.push(0, 0, zz, sg > 0 ? 0 : Math.PI);
        box(G, -W / 2, W / 2, H, H + ph * 0.5, -t, 0, wc, side, KP, 'fbt', { su: bw, sv: uh, ou: uo });
        const n = Math.round(W / 4.2), cw = W / n;
        for (let i = 0; i < n; i++) bump(G, { x0: -W / 2 + i * cw + 0.25, x1: -W / 2 + (i + 1) * cw - 0.25, y: H + ph * 0.5, r: ph * 0.55, mirror: false }, 0, -t, wc, side, { su: bw, sv: uh, ou: uo }, { back: !G.low, edges: !G.low, edgeCol: mul(wc, 0.9) }, KP);
        G.pop();
      }
      G.push(0, 0, zr, 0);
      box(G, -rw / 2, rw / 2, H, H + ph * 0.5, -t, 0, wc, side, KP, 'fbtlr', { su: bw, sv: uh, ou: uo });
      G.pop();
    } else {
      const ph = Math.min(4, rw * 0.32);
      if (st === 'classic' || r.chance(0.5)) profileWall(G, profTriangle(rw / 2, H, ph, 0.25), zr + 0.3, 0.4, trim, C.plaster, { su: 3, sv: 3 }, { back: false });
      else profileWall(G, profVolute(rw / 2, H, ph * 1.2), zr, 0.4, wc, C.plaster, { su: 3, sv: 3 }, { back: false, edgeCol: trim });
      wall(G, -0.7, zr + 0.36, 0.7, zr + 0.36, H + 0.5, H + 1.9, wc, C.oculus, uo, uo + 1, 6, 7);
    }
  }

  /* ---------- dispatch ---------- */
  function emit(G, lot, far) {
    const r = rng(((lot.seed >>> 0) ^ 0x9e3779b9) >>> 0), kind = lot.kind || 'house', st = lot.style;
    switch (kind) {
      case 'church': return church(G, lot, r, far, false);
      case 'chapel': return church(G, lot, r, far, true);
      case 'cathedral': return cathedral(G, lot, r, far);
      case 'domechurch': return domechurch(G, lot, r, far);
      case 'townhall': return townhall(G, lot, r, far);
      case 'tower': return tower(G, lot, r, far, false);
      case 'gatetower': return tower(G, lot, r, far, true);
      case 'palace': return palace(G, lot, r, far);
      case 'cottage': return cottage(G, lot, r, far, st === 'log');
      case 'barn': return barn(G, lot, r, far, false);
      case 'shed': return barn(G, lot, r, far, true);
      default:
        if (st === 'cottage' || st === 'log') return cottage(G, lot, r, far, st === 'log');
        if (st === 'farm') return farm(G, lot, r, far);
        if (st === 'barn') return barn(G, lot, r, far, false);
        return townhouse(G, lot, r, far);
    }
  }

  /** One building in its local frame (y = 0 at lot.y). tier: 'low' | 'mid' | 'high' | 'far'. */
  function model(lot, tier) {
    const far = tier === 'far', G = new Builder(far ? 'low' : (tier || 'high'));
    G.T = [0, 0, 0, 1, 0];
    emit(G, lot, far);
    return [G.geometry()];
  }

  /* ---------- the facade atlas (canvas): albedo + mask (R glow, G tint) ---------- */
  const hasDom = typeof document !== 'undefined' && !!document.createElement;
  const atlasCache = {};
  function atlas(size) {
    if (!hasDom) return null;
    if (atlasCache[size]) return atlasCache[size];
    const cv = document.createElement('canvas'), mk = document.createElement('canvas');
    cv.width = cv.height = mk.width = mk.height = size;
    const a = cv.getContext('2d'), m = mk.getContext('2d');
    if (!a || !m) return null;
    paintAtlas(a, m, size);
    const mkTex = c => {
      const t = new THREE.CanvasTexture(c);
      t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
      t.anisotropy = 4;
      return t;
    };
    atlasCache[size] = { map: mkTex(cv), mask: mkTex(mk), canvas: cv, maskCanvas: mk };
    return atlasCache[size];
  }

  const TN = '#00ff00', NN = '#000000', GL = '#ff0000', TH = '#008800';
  function paintAtlas(a, m, size) {
    const cs = size / 8, pad = cs * PAD;
    const D = {
      rect(x, y, w, h, al, mk) { a.fillStyle = al; a.fillRect(x, y, w, h); m.fillStyle = mk; m.fillRect(x, y, w, h); },
      path(fn, al, mk) { a.beginPath(); fn(a); a.fillStyle = al; a.fill(); m.beginPath(); fn(m); m.fillStyle = mk; m.fill(); },
      line(x0, y0, x1, y1, w, al, mk) { for (const [c, s] of [[a, al], [m, mk]]) { c.beginPath(); c.moveTo(x0, y0); c.lineTo(x1, y1); c.lineWidth = w; c.strokeStyle = s; c.stroke(); } },
      circ(x, y, rr, al, mk) { D.path(c => c.arc(x, y, rr, 0, Math.PI * 2), al, mk); },
      ring(x, y, rr, w, al, mk) { for (const [c, s] of [[a, al], [m, mk]]) { c.beginPath(); c.arc(x, y, rr, 0, Math.PI * 2); c.lineWidth = w; c.strokeStyle = s; c.stroke(); } },
    };
    for (let i = 0; i < 64; i++) {
      const fn = PAINT[i];
      if (!fn) continue;
      const cx = (i & 7) * cs, cy = (i >> 3) * cs;
      for (const c of [a, m]) {
        c.save(); c.beginPath(); c.rect(cx, cy, cs, cs); c.clip();
        c.translate(cx + pad, cy + pad); c.scale((cs - 2 * pad) / 100, (cs - 2 * pad) / 100);
        c.lineCap = 'butt'; c.lineJoin = 'miter';
      }
      fn(D, rng(7001 + i * 131));
      a.restore(); m.restore();
    }
    // stucco grain on tinted texels: blotchy value noise per cell
    const img = a.getImageData(0, 0, size, size), mi = m.getImageData(0, 0, size, size), p = img.data, q = mi.data;
    const R = rng(99), N = 16, grid = new Float32Array(N * N * 64).map(() => R());
    const inner = cs - 2 * pad;
    for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
      const o = (y * size + x) * 4;
      if (q[o + 1] < 60) continue;
      const ci = (y / cs | 0) * 8 + (x / cs | 0), lx = ((x % cs) - pad) / inner * 8, ly = ((y % cs) - pad) / inner * 8;
      const xi = Math.floor(lx), yi = Math.floor(ly), fx = lx - xi, fy = ly - yi;
      const g = (ix, iy) => grid[ci * N * N + (((iy % 8) + 8) % 8) * N + (((ix % 8) + 8) % 8)];
      const v = g(xi, yi) * (1 - fx) * (1 - fy) + g(xi + 1, yi) * fx * (1 - fy) + g(xi, yi + 1) * (1 - fx) * fy + g(xi + 1, yi + 1) * fx * fy;
      const k = 0.93 + 0.1 * v + (R() - 0.5) * 0.04;
      p[o] = clamp(p[o] * k, 0, 255); p[o + 1] = clamp(p[o + 1] * k, 0, 255); p[o + 2] = clamp(p[o + 2] * k, 0, 255);
    }
    a.putImageData(img, 0, 0);
  }

  /* -- painting helpers: one cell = 100 x 100 (one bay x one storey), y down -- */
  const PL = '#f1ede6', GLASS = '#26303b', GLASS2 = '#3c4b5a', WFR = '#f4f1ea', SFR = '#cdbf9e', DW = '#4e3423';
  function bg(D, al, mk) { D.rect(-12, -12, 124, 124, al || PL, mk || TN); }
  function shape(c, x, y, w, h, arch) {
    if (arch === 'round') { const rr = w / 2; c.moveTo(x, y + h); c.lineTo(x, y + rr); c.arc(x + rr, y + rr, rr, Math.PI, 0); c.lineTo(x + w, y + h); c.closePath(); }
    else if (arch === 'pointed') { const ah = w * 0.8; c.moveTo(x, y + h); c.lineTo(x, y + ah); c.quadraticCurveTo(x, y + ah * 0.15, x + w / 2, y); c.quadraticCurveTo(x + w, y + ah * 0.15, x + w, y + ah); c.lineTo(x + w, y + h); c.closePath(); }
    else if (arch === 'seg') { const ah = w * 0.18; c.moveTo(x, y + h); c.lineTo(x, y + ah); c.quadraticCurveTo(x + w / 2, y - ah * 0.9, x + w, y + ah); c.lineTo(x + w, y + h); c.closePath(); }
    else c.rect(x, y, w, h);
  }
  /** A window: frame, glass (glows at night), mullions, sill, cap. */
  function win(D, x, y, w, h, o) {
    o = o || {};
    const fw = o.fw == null ? 4 : o.fw, fr = o.fr || WFR, fm = o.fm || NN;
    if (o.shut) { D.rect(x - w * 0.55 - fw, y - fw * 0.5, w * 0.55, h + fw, o.shut, NN); D.rect(x + w + fw, y - fw * 0.5, w * 0.55, h + fw, o.shut, NN);
      for (const sx of [x - w * 0.55 - fw, x + w + fw]) for (let k = 1; k < 5; k++) D.rect(sx + 1, y + k * h / 5, w * 0.55 - 2, 1, 'rgba(0,0,0,0.25)', NN); }
    if (o.cap === 'tri') D.path(c => { c.moveTo(x - fw - 5, y - fw - 3); c.lineTo(x + w / 2, y - fw - 3 - w * 0.36); c.lineTo(x + w + fw + 5, y - fw - 3); c.closePath(); }, fr, fm);
    else if (o.cap === 'seg') D.path(c => { c.moveTo(x - fw - 5, y - fw - 2); c.quadraticCurveTo(x + w / 2, y - fw - 3 - w * 0.5, x + w + fw + 5, y - fw - 2); c.lineTo(x + w + fw + 5, y - fw + 1); c.lineTo(x - fw - 5, y - fw + 1); c.closePath(); }, fr, fm);
    else if (o.cap === 'cornice') D.rect(x - fw - 4, y - fw - 6, w + 2 * fw + 8, 5, fr, fm);
    if (o.cap === 'tri' && o.inner) D.path(c => { c.moveTo(x - fw + 1, y - fw - 5.5); c.lineTo(x + w / 2, y - fw - 3 - w * 0.36 + 4); c.lineTo(x + w + fw - 1, y - fw - 5.5); c.closePath(); }, o.inner, TN);
    if (fw > 0) D.path(c => shape(c, x - fw, y - fw, w + 2 * fw, h + 2 * fw, o.arch), fr, fm);
    if (o.ears) { D.rect(x - fw - 3, y - fw, 3, 7, fr, fm); D.rect(x + w + fw, y - fw, 3, 7, fr, fm); }
    D.path(c => shape(c, x, y, w, h, o.arch), o.glass || GLASS, o.glow || GL);
    D.path(c => { c.moveTo(x, y + h * 0.55); c.lineTo(x, y + (o.arch ? w * 0.5 : 0)); c.lineTo(x + w * 0.55, y + (o.arch ? w * 0.5 : 0)); c.closePath(); }, o.glass2 || GLASS2, o.glow || GL);
    const mc = o.mc || fr, mw = o.mw || 2.4;
    if (o.mull === 'cross' || o.mull == null) { D.rect(x + w / 2 - mw / 2, y + (o.arch ? w * 0.3 : 0), mw, h - (o.arch ? w * 0.3 : 0), mc, NN); D.rect(x, y + h * (o.arch ? 0.45 : 0.36), w, mw, mc, NN); }
    else if (o.mull === 'grid') { for (const k of [1, 2]) D.rect(x, y + h * k / 3, w, mw * 0.8, mc, NN); D.rect(x + w / 2 - mw / 2, y, mw, h, mc, NN); }
    else if (o.mull === 'bars') { for (let k = 1; k < 4; k++) D.rect(x + w * k / 4 - 0.8, y, 1.6, h, '#2a2622', NN); for (let k = 1; k < 4; k++) D.rect(x, y + h * k / 4 - 0.8, w, 1.6, '#2a2622', NN); }
    else if (o.mull === 'lead') { for (let k = 1; k < 6; k++) D.rect(x, y + h * k / 6, w, 1, '#1c1a18', NN); for (let k = 1; k < 3; k++) D.rect(x + w * k / 3, y + w * 0.3, 1, h - w * 0.3, '#1c1a18', NN); }
    if (o.sill !== false) D.rect(x - fw - 2.5, y + h + fw - 0.5, w + 2 * fw + 5, 3.5, o.sillC || fr, fm);
  }
  function door(D, x, y, w, h, o) {
    o = o || {};
    const fw = o.fw == null ? 5 : o.fw;
    if (fw > 0) D.path(c => shape(c, x - fw, y - fw, w + 2 * fw, h + fw + 12, o.arch), o.fr || SFR, o.fm || NN);
    D.path(c => shape(c, x, y, w, h + 12, o.arch), o.wood || '#5b3a22', NN);
    for (let k = 1; k < 4; k++) D.rect(x + w * k / 4 - 0.6, y + (o.arch ? w * 0.4 : 0), 1.2, h + 12, 'rgba(0,0,0,0.3)', NN);
    if (o.split) D.rect(x + w / 2 - 1, y + (o.arch ? w * 0.3 : 0), 2, h + 12, 'rgba(0,0,0,0.45)', NN);
    if (o.transom) D.path(c => shape(c, x + 3, y + 2, w - 6, Math.min(16, h * 0.2), o.arch), GLASS, GL);
    D.rect(x + w * 0.7, y + h * 0.55, 3, 3, '#c9a24a', NN);
  }
  function sgrDiamond(D) {
    bg(D, '#3b3936', NN);
    const bh = 12.5, bwid = 25;
    for (let row = -1; row < 9; row++) for (let k = -1; k < 6; k++) {
      const x = k * bwid + (row % 2 ? bwid / 2 : 0), y = row * bh, cx = x + bwid / 2, cy = y + bh / 2, g = 1.2;
      const tri = (pts, al, mk) => D.path(c => { c.moveTo(pts[0][0], pts[0][1]); for (const p of pts.slice(1)) c.lineTo(p[0], p[1]); c.closePath(); }, al, mk);
      tri([[x + g, y + g], [x + bwid - g, y + g], [cx, cy]], '#fbfaf6', TN);
      tri([[x + g, y + g], [cx, cy], [x + g, y + bh - g]], '#d9d6cf', TN);
      tri([[x + bwid - g, y + g], [x + bwid - g, y + bh - g], [cx, cy]], '#a9a69f', TN);
      tri([[x + g, y + bh - g], [cx, cy], [x + bwid - g, y + bh - g]], '#7d7a74', TH);
    }
  }
  function sgrEnvelope(D) {
    bg(D, '#f2efe8', TN);
    const bh = 12.5, bwid = 20;
    for (let row = -1; row < 9; row++) for (let k = -1; k < 7; k++) {
      const x = k * bwid + (row % 2 ? bwid / 2 : 0), y = row * bh;
      D.line(x, y, x + bwid, y + bh, 1.4, '#3a3835', NN); D.line(x + bwid, y, x, y + bh, 1.4, '#3a3835', NN);
      D.rect(x, y, bwid, 1.3, '#3a3835', NN); D.rect(x, y, 1.3, bh, '#3a3835', NN);
    }
  }
  function ashlar(D, rows, al) {
    bg(D, al || '#e2ddd3', TN);
    const rh = 100 / rows;
    for (let i = 0; i <= rows; i++) {
      D.rect(-12, i * rh - 0.8, 124, 1.6, '#9a9488', TH);
      const n = 2 + (i % 2), off = (i % 2) * 18;
      for (let k = 0; k <= n; k++) D.rect(off + k * 100 / n - 0.8, i * rh, 1.6, rh, '#9a9488', TH);
    }
  }
  function logs(D, r) {
    bg(D, '#d8d2c4', NN);
    for (let i = -1; i < 9; i++) {
      const y = i * 12.5;
      for (let k = 0; k < 6; k++) { const v = 0.95 - k * 0.07; const g = Math.round(220 * v); D.rect(-12, y + 1.2 + k * 1.75, 124, 1.9, 'rgb(' + g + ',' + g + ',' + g + ')', TN); }
      for (let k = 0; k < 4; k++) D.rect(r() * 100, y + 3 + r() * 6, 8 + r() * 20, 0.8, 'rgba(60,40,20,0.35)', TN);
    }
  }
  function boards(D, r, w) {
    bg(D, '#3a3a3a', TN);
    w = w || 12.5;
    for (let x = -12; x < 112; x += w) { const g = Math.round(150 + r() * 70); D.rect(x + 0.9, -12, w - 1.8, 124, 'rgb(' + g + ',' + g + ',' + g + ')', TN);
      for (let k = 0; k < 3; k++) D.rect(x + 2 + r() * (w - 5), r() * 100, 0.8, 10 + r() * 30, 'rgba(0,0,0,0.18)', TN); }
  }
  function rustic(D, al) { bg(D, al || PL, TN); for (let i = 1; i < 8; i++) D.rect(-12, i * 12.5 - 0.7, 124, 1.4, '#bdb7ab', TN); }
  function beams(D, posts, braces) {
    const B = '#4b3324';
    D.rect(-12, -2, 124, 7, B, NN); D.rect(-12, 93, 124, 9, B, NN);
    for (const x of posts) D.rect(x - 3.2, -2, 6.4, 104, B, NN);
    for (const [x0, y0, x1, y1] of braces) D.line(x0, y0, x1, y1, 5.5, B, NN);
  }

  const PAINT = [];
  PAINT[C.plaster] = D => bg(D);
  PAINT[C.stone] = D => bg(D, '#e2ddd3');
  PAINT[C.tile] = (D, r) => {
    bg(D, '#5a5a5a', TN);
    for (let row = 8; row >= -1; row--) {
      const y = row * 12.5, off = (row % 2) * 3.125;
      for (let k = -1; k < 17; k++) {
        const x = k * 6.25 + off, g = Math.round(175 + r() * 60);
        D.path(c => { c.moveTo(x + 0.4, y - 4); c.lineTo(x + 0.4, y + 9); c.quadraticCurveTo(x + 3.1, y + 13.5, x + 5.85, y + 9); c.lineTo(x + 5.85, y - 4); c.closePath(); }, 'rgb(' + g + ',' + Math.round(g * 0.97) + ',' + Math.round(g * 0.95) + ')', TN);
        D.rect(x + 0.4, y - 4, 5.45, 4.5, 'rgba(0,0,0,0.22)', TN);
      }
    }
  };
  PAINT[C.slate] = (D, r) => {
    bg(D, '#4a4a4a', TN);
    for (let row = 10; row >= -1; row--) {
      const y = row * 10, off = (row % 2) * 6.25;
      for (let k = -1; k < 9; k++) { const x = k * 12.5 + off, g = Math.round(150 + r() * 70);
        D.path(c => { c.moveTo(x + 0.6, y - 3); c.lineTo(x + 0.6, y + 6); c.lineTo(x + 6.25, y + 11); c.lineTo(x + 11.9, y + 6); c.lineTo(x + 11.9, y - 3); c.closePath(); }, 'rgb(' + g + ',' + g + ',' + g + ')', TN); }
    }
  };
  PAINT[C.shingle] = (D, r) => {
    bg(D, '#3c3c3c', TN);
    for (let row = 12; row >= -1; row--) { let x = -12 + r() * 4; const y = row * 8.33;
      while (x < 112) { const w = 4 + r() * 5, g = Math.round(140 + r() * 80); D.rect(x + 0.5, y - 2, w - 1, 9.6, 'rgb(' + g + ',' + g + ',' + g + ')', TN); D.rect(x + 0.5, y - 2, w - 1, 2.2, 'rgba(0,0,0,0.25)', TN); x += w; } }
  };
  PAINT[C.thatch] = (D, r) => {
    bg(D, '#8a8a8a', TN);
    for (let i = 0; i < 900; i++) { const x = r() * 124 - 12, y = r() * 124 - 12, g = Math.round(110 + r() * 120); D.line(x, y, x + (r() - 0.5) * 3, y + 6 + r() * 12, 0.9, 'rgb(' + g + ',' + g + ',' + g + ')', TN); }
    for (let k = 0; k < 3; k++) D.rect(-12, k * 33.3 + 30, 124, 3.3, 'rgba(0,0,0,0.25)', TN);
  };
  PAINT[C.copper] = (D, r) => {
    bg(D, '#a3a3a3', TN);
    for (let x = 0; x <= 100; x += 12.5) D.rect(x - 0.8, -12, 1.6, 124, '#d6d6d6', TN);
    for (let row = 0; row < 4; row++) for (let x = 0; x < 100; x += 12.5) D.rect(x + (row % 2) * 6, row * 25 + 12, 12.5, 0.9, '#8a8a8a', TN);
    for (let i = 0; i < 40; i++) D.rect(r() * 100, r() * 100, 0.8, 8 + r() * 20, 'rgba(255,255,255,0.12)', TN);
  };
  PAINT[C.planks] = (D, r) => boards(D, r, 12.5);
  PAINT[C.gUp] = D => { bg(D); win(D, 32, 20, 36, 56, { arch: 'pointed', fr: SFR, fw: 5, mull: 'cross' }); };
  PAINT[C.gUp2] = D => { bg(D); for (const x of [17, 57]) win(D, x, 28, 26, 42, { fr: SFR, fw: 4, mull: 'bars', cap: 'cornice' }); };
  PAINT[C.gUp3] = D => { ashlar(D, 5, '#e6e0d4'); win(D, 30, 22, 40, 50, { fr: '#d9cfb4', fw: 4, mull: 'cross', mw: 4 }); };
  PAINT[C.gDoor] = D => { bg(D); door(D, 27, 22, 46, 78, { arch: 'pointed', fw: 7 }); };
  PAINT[C.gShop] = D => { bg(D); D.path(c => shape(c, 9, 20, 82, 92, 'seg'), SFR, NN); D.path(c => shape(c, 15, 26, 70, 80, 'seg'), '#4a3424', NN); win(D, 19, 30, 62, 40, { fw: 0, mull: 'grid', mc: '#4a3424', sill: false }); D.rect(19, 74, 62, 26, '#5b3a22', NN); };
  PAINT[C.gWin] = D => { bg(D); win(D, 33, 30, 34, 36, { fr: SFR, fw: 5, mull: 'bars' }); };
  PAINT[C.log] = (D, r) => logs(D, r);
  PAINT[C.logWin] = (D, r) => { logs(D, r); win(D, 31, 26, 38, 38, { fr: '#ece6d6', fw: 4, mull: 'cross' }); };
  PAINT[C.logDoor] = (D, r) => { logs(D, r); door(D, 33, 18, 34, 82, { fw: 4, fr: '#6b4a2c', wood: '#5b3a22' }); };
  PAINT[C.barnDoor] = (D, r) => { boards(D, r, 10); D.rect(6, 6, 88, 100, '#5d4a38', NN); for (let x = 6; x < 94; x += 8.8) D.rect(x, 6, 0.9, 100, '#3a2c20', NN); D.line(8, 94, 92, 10, 5, '#4a3a2a', NN); D.rect(6, 6, 88, 5, '#4a3a2a', NN); D.rect(6, 48, 88, 5, '#4a3a2a', NN); D.rect(49, 6, 2, 100, '#2a2018', NN); };
  PAINT[C.rUp] = D => { sgrDiamond(D); win(D, 30, 22, 40, 52, { fr: '#efeae0', fw: 5, mull: 'cross', cap: 'tri', inner: '#3b3936' }); };
  PAINT[C.rSgr] = D => sgrDiamond(D);
  PAINT[C.rSgr2] = D => sgrEnvelope(D);
  PAINT[C.rUp3] = D => { sgrEnvelope(D); win(D, 31, 22, 38, 52, { fr: '#e9e3d6', fw: 6, mull: 'cross', cap: 'cornice' }); D.rect(26, 80, 48, 6, '#3a3835', NN); };
  PAINT[C.rDoor] = D => { sgrDiamond(D); D.rect(18, 14, 64, 100, '#d8d0bf', NN); for (let k = 0; k < 7; k++) D.rect(18, 14 + k * 13, 64, 1.4, '#8f877a', NN); door(D, 30, 30, 40, 70, { arch: 'round', fw: 0, wood: '#4e3322', split: true }); };
  PAINT[C.rWin] = D => { sgrDiamond(D); win(D, 30, 28, 40, 40, { fr: '#efeae0', fw: 5, mull: 'bars' }); };
  PAINT[C.rUp2] = D => { sgrDiamond(D); D.rect(-12, 0, 124, 13, '#f1ede6', TN); for (let k = 0; k < 4; k++) D.path(c => c.arc(k * 25 + 12.5, 13, 9, Math.PI, 0), '#3b3936', NN); win(D, 32, 26, 36, 50, { fr: '#efeae0', fw: 5, mull: 'cross', cap: 'cornice' }); };
  PAINT[C.clock] = D => {
    bg(D, '#e2ddd3');
    D.circ(50, 50, 47, '#c9a24a', NN); D.circ(50, 50, 43, '#23304e', '#550000'); D.circ(50, 50, 30, '#c7b07a', '#330000'); D.circ(50, 50, 22, '#1d2a44', '#220000');
    for (let k = 0; k < 12; k++) { const t = k / 12 * Math.PI * 2; D.line(50 + Math.sin(t) * 33, 50 - Math.cos(t) * 33, 50 + Math.sin(t) * 41, 50 - Math.cos(t) * 41, k % 3 ? 2 : 4, '#e3c46a', NN); }
    D.line(50, 50, 50 + 16, 50 - 22, 3.5, '#e3c46a', NN); D.line(50, 50, 50 - 26, 50 + 6, 2.5, '#e3c46a', NN); D.circ(50, 50, 4, '#e3c46a', NN);
  };
  PAINT[C.rose] = D => {
    bg(D);
    D.circ(50, 50, 48, SFR, NN); D.circ(50, 50, 42, '#2b3a6e', GL);
    for (let k = 0; k < 12; k++) { const t = k / 12 * Math.PI * 2; D.circ(50 + Math.sin(t) * 28, 50 - Math.cos(t) * 28, 9, k % 2 ? '#7a2a3a' : '#2f4a7a', GL); D.line(50, 50, 50 + Math.sin(t) * 44, 50 - Math.cos(t) * 44, 2.6, SFR, NN); }
    D.ring(50, 50, 18, 3, SFR, NN); D.ring(50, 50, 42, 3, SFR, NN); D.circ(50, 50, 8, '#b08a3a', GL);
  };
  const lancet = (D, x, w, top, h) => {
    win(D, x, top, w, h, { arch: 'pointed', fr: SFR, fw: 4, mull: 'none', glass: '#2c3858', glass2: '#3d4f78', sill: false });
    D.rect(x + w / 2 - 1.2, top + w * 0.5, 2.4, h - w * 0.5, SFR, NN);
    for (let k = 1; k < 6; k++) D.rect(x, top + w * 0.6 + k * (h - w * 0.6) / 6, w, 1.2, '#1c1a18', NN);
    D.ring(x + w / 2, top + w * 0.42, w * 0.18, 2, SFR, NN);
  };
  PAINT[C.lancet] = D => { bg(D, '#e4dfd5'); lancet(D, 30, 40, 8, 84); };
  PAINT[C.tracery] = D => { bg(D, '#e4dfd5'); D.path(c => shape(c, 14, 6, 72, 92, 'pointed'), SFR, NN); lancet(D, 20, 26, 26, 70); lancet(D, 54, 26, 26, 70); D.circ(50, 18, 9, '#2c3858', GL); D.ring(50, 18, 9, 2.4, SFR, NN); };
  PAINT[C.bUp] = D => { bg(D); D.rect(30, 80, 40, 12, '#f6f3ec', NN); win(D, 32, 22, 36, 52, { fr: '#f6f3ec', fw: 5, ears: true, cap: 'cornice', mull: 'cross' }); D.rect(47, 13, 6, 6, '#f6f3ec', NN); };
  PAINT[C.bUp2] = D => { bg(D); D.rect(-12, -12, 17, 124, '#f6f3ec', NN); D.rect(95, -12, 17, 124, '#f6f3ec', NN); win(D, 33, 24, 34, 52, { fr: '#f6f3ec', fw: 5, cap: 'seg', mull: 'cross' }); };
  PAINT[C.bUp3] = D => { bg(D); win(D, 32, 26, 36, 50, { fr: '#f6f3ec', fw: 5, cap: 'tri', mull: 'cross', inner: PL }); D.path(c => c.ellipse(50, 88, 12, 4, 0, 0, Math.PI * 2), '#f6f3ec', NN); };
  PAINT[C.bUp4] = D => { bg(D); D.path(c => shape(c, 26, 14, 48, 74, 'seg'), '#f6f3ec', NN); win(D, 32, 22, 36, 54, { fr: '#e9e4d8', fw: 2, arch: 'seg', mull: 'cross' }); D.rect(40, 6, 20, 6, '#f6f3ec', NN); };
  PAINT[C.bDoor] = D => { rustic(D); D.rect(18, 8, 64, 8, '#f6f3ec', NN); D.rect(19, 16, 9, 100, '#f6f3ec', NN); D.rect(72, 16, 9, 100, '#f6f3ec', NN); door(D, 31, 24, 38, 76, { arch: 'round', fw: 0, wood: '#4e3322', split: true, transom: true }); D.path(c => { c.moveTo(16, 8); c.quadraticCurveTo(50, -10, 84, 8); c.closePath(); }, '#f6f3ec', NN); };
  PAINT[C.bShop] = D => { rustic(D); win(D, 18, 26, 64, 52, { arch: 'round', fr: '#f6f3ec', fw: 5, mull: 'grid', sill: false }); D.rect(18, 78, 64, 22, '#4a3424', NN); D.rect(22, 8, 56, 9, '#2f4a3a', NN); D.rect(30, 11.5, 40, 2, '#c9a24a', NN); };
  PAINT[C.bWin] = D => { rustic(D); win(D, 32, 28, 36, 44, { fr: '#f6f3ec', fw: 5, mull: 'bars', ears: true }); };
  PAINT[C.bChurch] = D => { bg(D); win(D, 30, 12, 40, 76, { arch: 'round', fr: '#f6f3ec', fw: 6, mull: 'lead', glass: '#3a4654', glass2: '#566474' }); };
  PAINT[C.oculus] = D => { bg(D); D.circ(50, 50, 38, '#f6f3ec', NN); D.circ(50, 50, 30, GLASS, GL); D.rect(48.8, 20, 2.4, 60, '#f6f3ec', NN); D.rect(20, 48.8, 60, 2.4, '#f6f3ec', NN); };
  PAINT[C.cUp] = D => { bg(D); win(D, 32, 26, 36, 50, { fr: '#f2efe6', fw: 4, cap: 'cornice', mull: 'cross' }); };
  PAINT[C.cUp2] = D => { bg(D); win(D, 32, 26, 36, 50, { fr: '#f2efe6', fw: 4, cap: 'tri', mull: 'cross', inner: PL }); for (let k = 0; k < 6; k++) D.rect(30 + k * 7.5, 82, 3, 10, '#f2efe6', NN); D.rect(28, 92, 44, 3, '#f2efe6', NN); };
  PAINT[C.cUp3] = D => { bg(D); D.rect(-12, 4, 124, 3, '#e6e1d6', TN); win(D, 33, 24, 34, 54, { fr: '#ebe7dc', fw: 3, mull: 'grid' }); };
  PAINT[C.cDoor] = D => { rustic(D); door(D, 32, 24, 36, 76, { fr: '#e8e4da', fw: 5, wood: '#5a4636', split: true, transom: true }); };
  PAINT[C.cWin] = D => { rustic(D); win(D, 31, 24, 38, 50, { arch: 'round', fr: '#ece8de', fw: 4, mull: 'cross' }); };
  PAINT[C.cShop] = D => { rustic(D); D.rect(12, 18, 76, 90, '#3e4a3c', NN); win(D, 18, 30, 64, 46, { fw: 0, mull: 'grid', mc: '#3e4a3c', sill: false }); D.rect(16, 20, 68, 7, '#2a3428', NN); D.rect(28, 22.5, 44, 2, '#c9a24a', NN); };
  PAINT[C.attic] = D => { bg(D); win(D, 24, 16, 52, 64, { fr: WFR, fw: 6, mull: 'cross' }); };
  PAINT[C.belfry] = D => { bg(D, '#e2ddd3'); D.path(c => shape(c, 22, 10, 56, 92, 'round'), SFR, NN); D.path(c => shape(c, 27, 15, 46, 85, 'round'), '#1d1a17', '#300000'); for (let k = 0; k < 8; k++) D.rect(27, 40 + k * 7, 46, 2.4, '#5a4a3a', NN); };
  PAINT[C.towerWin] = D => { bg(D, '#e2ddd3'); win(D, 40, 26, 20, 40, { arch: 'pointed', fr: SFR, fw: 4, mull: 'none' }); };
  PAINT[C.gate] = D => { bg(D, '#e2ddd3'); D.path(c => shape(c, 10, 8, 80, 100, 'pointed'), '#c9bfa7', NN); for (let k = 0; k <= 10; k++) { const t = Math.PI + k / 10 * Math.PI; D.line(50 + Math.cos(t) * 30, 40 + Math.sin(t) * 30, 50 + Math.cos(t) * 40, 40 + Math.sin(t) * 40, 1.4, '#8f877a', NN); } D.path(c => shape(c, 18, 16, 64, 100, 'pointed'), '#141210', NN); };
  PAINT[C.tUp] = D => { bg(D); beams(D, [0, 100, 27, 73], [[3, 93, 27, 64], [97, 93, 73, 64], [27, 30, 3, 5], [73, 30, 97, 5]]); win(D, 33, 26, 34, 44, { fr: '#efe9da', fw: 3, mull: 'cross' }); };
  PAINT[C.tUp2] = D => { bg(D); beams(D, [0, 100, 30, 70], [[0, 50, 30, 93], [100, 50, 70, 93], [0, 50, 30, 5], [100, 50, 70, 5]]); D.rect(30, 66, 40, 5, '#4b3324', NN); win(D, 35, 24, 30, 38, { fr: '#efe9da', fw: 3, mull: 'cross' }); };
  PAINT[C.tBrace] = D => { bg(D); beams(D, [0, 50, 100], [[3, 93, 47, 5], [3, 5, 47, 93], [53, 93, 97, 5], [53, 5, 97, 93]]); D.rect(-12, 47, 124, 5, '#4b3324', NN); };
  PAINT[C.tDoor] = D => { bg(D); D.rect(-12, 88, 124, 24, '#d4cdbd', TN); door(D, 32, 26, 36, 74, { fr: SFR, fw: 5 }); };
  PAINT[C.tWin] = D => { bg(D); D.rect(-12, 88, 124, 24, '#d4cdbd', TN); win(D, 30, 28, 40, 40, { fr: '#6b4a30', fw: 4, mull: 'cross' }); };
  PAINT[C.kWin] = D => { bg(D); D.rect(-12, 86, 124, 26, '#8a96a2', NN); D.rect(-12, 84, 124, 2.2, '#5f7a94', NN); D.path(c => c.rect(25, 24, 50, 52), '#6f8eaa', NN); win(D, 31, 30, 38, 40, { fr: '#f2efe8', fw: 3, mull: 'cross', sill: false }); };
  PAINT[C.kDoor] = D => { bg(D); D.rect(-12, 86, 124, 26, '#8a96a2', NN); D.rect(-12, 84, 124, 2.2, '#5f7a94', NN); door(D, 33, 22, 34, 78, { fr: '#6f8eaa', fw: 4, wood: '#6b4a2c' }); };
  PAINT[C.kPlain] = D => { bg(D); D.rect(-12, 86, 124, 26, '#8a96a2', NN); D.rect(-12, 84, 124, 2.2, '#5f7a94', NN); };
  PAINT[C.farmGate] = D => { bg(D); D.path(c => shape(c, 6, 6, 88, 100, 'seg'), '#f4f1ea', NN); D.path(c => shape(c, 11, 11, 78, 100, 'seg'), '#6a4a2e', NN); for (let x = 11; x < 89; x += 7.8) D.rect(x, 14, 0.9, 90, '#3e2c1c', NN); D.rect(49, 11, 2, 100, '#2a1e14', NN); D.line(14, 92, 46, 30, 3.5, '#4a3424', NN); D.line(86, 92, 54, 30, 3.5, '#4a3424', NN); };
  PAINT[C.shop2] = D => { bg(D); D.rect(10, 16, 80, 96, '#3d2f22', NN); win(D, 16, 30, 68, 44, { fw: 0, mull: 'grid', mc: '#3d2f22', sill: false }); D.rect(14, 18, 72, 8, '#2a2016', NN); for (let k = 0; k < 6; k++) D.rect(24 + k * 9, 20.5, 5, 3, '#c9a24a', NN); D.rect(16, 80, 68, 20, '#4a3828', NN); };
  PAINT[C.back] = D => { bg(D); win(D, 34, 26, 32, 42, { fr: '#e9e5dc', fw: 3, mull: 'cross' }); };
  PAINT[C.side] = D => { bg(D); win(D, 40, 32, 20, 28, { fr: '#e9e5dc', fw: 3, mull: 'cross' }); };
  PAINT[C.pWin] = D => { bg(D); win(D, 31, 14, 38, 64, { fr: '#f6f3ec', fw: 5, cap: 'tri', mull: 'grid', ears: true, inner: PL, sill: false }); D.rect(26, 82, 48, 4, '#f6f3ec', NN); for (let k = 0; k < 7; k++) D.rect(28 + k * 6.6, 86, 3, 9, '#f6f3ec', NN); D.rect(26, 94, 48, 4, '#f6f3ec', NN); };
  PAINT[C.pDoor] = D => { rustic(D); D.rect(12, 0, 76, 10, '#f6f3ec', NN); D.rect(12, 10, 10, 100, '#f6f3ec', NN); D.rect(78, 10, 10, 100, '#f6f3ec', NN); door(D, 26, 18, 48, 82, { arch: 'round', fw: 4, fr: '#e6e1d6', wood: '#4a3020', split: true, transom: true }); };
  PAINT[C.chDoor] = D => { bg(D, '#e2ddd3'); for (const [k, col] of [[0, '#c9bfa7'], [5, '#b5aa92'], [10, '#a69b84']]) D.path(c => shape(c, 12 + k, 8 + k, 76 - 2 * k, 100, 'pointed'), col, NN); door(D, 30, 34, 40, 66, { arch: 'pointed', fw: 0, wood: '#4e3322', split: true }); };
  PAINT[C.boards] = (D, r) => { boards(D, r, 10); for (let k = 0; k < 5; k++) D.line(0, 20 + k * 18, 100, 20 + k * 18, 1.8, 'rgba(0,0,0,0.35)', TN); D.path(c => { c.moveTo(50, 8); c.lineTo(60, 18); c.lineTo(50, 28); c.lineTo(40, 18); c.closePath(); }, '#e8e2d2', NN); };

  /* ---------- material: atlas x vertex colour, glowing windows, VTex detail on stone and wood ---------- */
  function makeMaterial(tier) {
    const tex = atlas(tier === 'low' ? 512 : 1024);
    const std = tier === 'high';
    const mat = std ? new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.92, metalness: 0 }) : new THREE.MeshLambertMaterial({ vertexColors: true });
    const U = { hkMask: { value: tex ? tex.mask : null }, hkNight: { value: [0, 0.55] } };
    mat.userData.hk = U;
    if (!tex) return mat;
    mat.map = tex.map;
    if (root.VTex && tier !== 'low') root.VTex.detail(mat, { map: 'stone', kinds: ['roof', 'wood', 'thatch'], scale: 4, strength: 0.5, bump: 0.8 });
    mat.extensions = Object.assign({}, mat.extensions || {}, { derivatives: true, shaderTextureLOD: true });
    const prev = mat.onBeforeCompile, prevKey = mat.customProgramCacheKey ? mat.customProgramCacheKey() : '';
    const pd = PAD.toFixed(5), sc = (1 - 2 * PAD).toFixed(5), maxG = (8 / (tier === 'low' ? 512 : 1024)).toFixed(6);
    mat.onBeforeCompile = function (sh, r) {
      if (prev) prev.call(this, sh, r);
      Object.assign(sh.uniforms, U);
      sh.vertexShader = 'attribute vec2 hkc;\nvarying vec2 vHkc;\n' + sh.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\n vHkc = hkc;');
      sh.fragmentShader = [
        'uniform sampler2D hkMask;', 'uniform vec2 hkNight;', 'varying vec2 vHkc;',
        '#if __VERSION__ >= 300', '#define HKT(s, p, dx, dy) textureGrad(s, p, dx, dy)',
        '#elif defined(GL_EXT_shader_texture_lod)', '#define HKT(s, p, dx, dy) texture2DGradEXT(s, p, dx, dy)',
        '#else', '#define HKT(s, p, dx, dy) texture2D(s, p)', '#endif',
        'float hkHash(vec2 p) { p = mod(p, 289.0); return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }',
      ].join('\n') + '\n' + sh.fragmentShader
        .replace('#include <map_fragment>', [
          'float hkGlow = 0.0, hkDet = 1.0;',
          '#ifdef USE_MAP',
          '{',
          '  vec2 hkF = fract(vUv);',
          '  vec2 hkA = (floor(vHkc + 0.5) + ' + pd + ' + hkF * ' + sc + ') * 0.125;',
          '  vec2 hkDx = dFdx(vUv) * ' + (0.125 * (1 - 2 * PAD)).toFixed(6) + ', hkDy = dFdy(vUv) * ' + (0.125 * (1 - 2 * PAD)).toFixed(6) + ';',
          '  float hkL = max(length(hkDx), length(hkDy));',
          '  if (hkL > ' + maxG + ') { hkDx *= ' + maxG + ' / hkL; hkDy *= ' + maxG + ' / hkL; }',
          '  vec4 hkT = HKT(map, hkA, hkDx, hkDy);',
          '  vec4 hkM = HKT(hkMask, hkA, hkDx, hkDy);',
          '  diffuseColor.rgb *= mix(hkT.rgb, hkT.rgb * vColor, hkM.g);',
          '  hkDet = hkM.g;',
          '  vec2 hkCell = floor(vUv) + floor(vHkc + 0.5) * vec2(17.0, 31.0);',
          '  float hkR = hkHash(hkCell);',
          '  hkGlow = hkM.r * step(hkR, hkNight.y) * (0.55 + 0.45 * hkHash(hkCell + 3.7));',
          '}',
          '#else',
          '  diffuseColor.rgb *= vColor;',
          '#endif',
        ].join('\n'))
        .replace('#include <color_fragment>', '')
        .replace('vtC * 2.0, vtP.y )', 'vtC * 2.0, vtP.y * hkDet )')
        .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\n totalEmissiveRadiance += hkGlow * hkNight.x * vec3(1.0, 0.68, 0.32);');
    };
    mat.customProgramCacheKey = () => prevKey + '|hk';
    mat.needsUpdate = true;
    return mat;
  }

  /* ---------- the kit: chunks, LOD, lazy building ---------- */
  function build(lots, opts) {
    opts = opts || {};
    const tier = opts.tier || 'high', CH = opts.chunk || 160, NEAR = opts.near || 420, FAR = opts.far || 1400, HY = 0.12;
    const perUpdate = opts.buildPerUpdate || 2;
    const group = new THREE.Group();
    group.name = 'houseKit';
    const mat = makeMaterial(tier);
    const map = new Map();
    for (const lot of lots || []) {
      const cx = Math.floor(lot.x / CH), cz = Math.floor(lot.z / CH), key = cx + ',' + cz;
      let c = map.get(key);
      if (!c) { c = { cx, cz, ox: (cx + 0.5) * CH, oz: (cz + 0.5) * CH, lots: [], state: 'far', near: null, far: null, x0: 1e9, x1: -1e9, z0: 1e9, z1: -1e9, y0: 1e9, y1: -1e9 }; map.set(key, c); }
      c.lots.push(lot);
      const rr = Math.hypot(lot.w || 8, lot.d || 12) / 2 + 2;
      c.x0 = Math.min(c.x0, lot.x - rr); c.x1 = Math.max(c.x1, lot.x + rr); c.z0 = Math.min(c.z0, lot.z - rr); c.z1 = Math.max(c.z1, lot.z + rr);
      c.y0 = Math.min(c.y0, (lot.y || 0) - 1); c.y1 = Math.max(c.y1, (lot.y || 0) + (lot.rise || 0) + 30);
    }
    const chunks = [...map.values()];
    function mesh(c, far) {
      const G = new Builder(far ? 'low' : tier);
      for (const lot of c.lots) {
        G.T = [lot.x - c.ox, lot.y || 0, lot.z - c.oz, Math.cos(lot.yaw || 0), Math.sin(lot.yaw || 0)];
        emit(G, lot, far);
      }
      const geo = G.geometry(), m = new THREE.Mesh(geo, mat);
      m.position.set(c.ox, 0, c.oz);
      m.matrixAutoUpdate = false; if (m.updateMatrix) m.updateMatrix();
      m.userData.tris = geo.userData.tris;
      group.add(m);
      return m;
    }
    for (const c of chunks) { c.far = mesh(c, true); c.far.visible = false; }
    function dist(c, p) {
      const dx = Math.max(c.x0 - p.x, 0, p.x - c.x1), dz = Math.max(c.z0 - p.z, 0, p.z - c.z1), dy = Math.max(c.y0 - p.y, 0, p.y - c.y1);
      return Math.hypot(dx, dy, dz);
    }
    function buildNear(c) { c.near = mesh(c, false); }
    function show(c) {
      const nearOk = c.state === 'near' && c.near;
      if (c.near) c.near.visible = !!nearOk;
      c.far.visible = c.state === 'far' || (c.state === 'near' && !c.near);
    }
    function update(cam) {
      if (!cam) return;
      const want = [];
      for (const c of chunks) {
        const d = dist(c, cam);
        c.dist = d;
        if (c.state === 'near') { if (d > NEAR * (1 + HY)) c.state = d > FAR * (1 + HY) ? 'hidden' : 'far'; }
        else if (c.state === 'far') { if (d < NEAR) c.state = 'near'; else if (d > FAR * (1 + HY)) c.state = 'hidden'; }
        else if (d < FAR) c.state = d < NEAR ? 'near' : 'far';
        if (c.state === 'near' && !c.near) want.push(c);
        if (c.state === 'hidden' && c.near && d > FAR * 1.5) { group.remove(c.near); c.near.geometry.dispose(); c.near = null; }
      }
      want.sort((a, b) => a.dist - b.dist);
      for (let i = 0; i < Math.min(perUpdate, want.length); i++) buildNear(want[i]);
      for (const c of chunks) show(c);
    }
    function buildAll() { for (const c of chunks) if (!c.near) buildNear(c); }
    if (opts.eager) buildAll();
    function setNight(k) { mat.userData.hk.hkNight.value[0] = clamp(k, 0, 1) * 1.15; }
    function info() {
      let calls = 0, tris = 0;
      for (const c of chunks) for (const m of [c.near, c.far]) if (m && m.visible) { calls++; tris += m.userData.tris; }
      return { buildings: (lots || []).length, chunks: chunks.length, calls, tris };
    }
    function dispose() {
      if (group.parent) group.parent.remove(group);
      for (const c of chunks) for (const m of [c.near, c.far]) if (m) m.geometry.dispose();
      mat.dispose();
    }
    return { group, update, setNight, info, dispose, chunks, material: mat, buildAll };
  }

  VR.houseKit = { build, model, styles: STYLES.slice(), kinds: KINDS.slice(), atlas, CELL: C, rng };
})(typeof window !== 'undefined' ? window : globalThis);
