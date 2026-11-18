/*
 * Verdigris campaign - region terrain as a pure height function.
 * The renderer meshes exactly this function, and flight, prey and the lair query it,
 * so what the player sees and what the simulation collides with stay the same.
 *
 * Height = base noise (the duel's H() formula, phase-shifted by the region seed, scaled by amp)
 *        + features (volcano cone with crater, flatten)
 *        + a rugged boundary ridge just beyond the region edge.
 *
 * One world (zones): a region with `origin` [x, z] is a zone of one continuous world (data.world): Mount Rip, the
 * Wildwood, the River Farmlands and the Veltava Bend are squares of half size `radius` side by side, north to south.
 * Every function still takes a region id and local x, z (the zone's frame, centred on its origin), but the ground is
 * one world function: the real terrain of the whole kingdom (core/dem-world.js, Rip to Prague, tools/terrain/world.py)
 * with the finer Bend and Rip models blended in over their zones, every zone's overlays (cone, plateaus, cliffs, roads,
 * bridges) where they lie, the Vltava from the Bend down to the east edge (a channel with a falling level), the road
 * network between the villages (core/roads.js) and a boundary ridge round the outside of the world only. So two zones
 * agree exactly along their shared edge, and a zone's mesh, collisions and its neighbour's meet without a seam.
 * A region without `origin` (the deathmatch arena) is a world of its own, as before.
 */
(function (root) {
  'use strict';
  const M = typeof module === 'object' && module.exports ? require('./umd.js') : root.VCamp;
  const D = M.need('data');
  const { clamp } = M.need('math');

  const RIM_START = 50, RIM_WIDTH = 320, RIM_HEIGHT = 150;
  /** Mesh grid: the renderer builds chunks of CHUNK x CHUNK units with GRID-unit cells. */
  const GRID = 7.5, CHUNK = 300;

  function region(id) {
    const r = D.regions[id] || (D.arenas && D.arenas[id]);
    if (!r) throw new Error('VCamp terrain: unknown region "' + id + '"');
    if (r.origin && wriver === null) worldRiver();               // a zone: its bridges sit on the world's river first
    return r;
  }

  const smooth = t => t * t * (3 - 2 * t);

  /* ---------- one world: zones, frames, the world terrain model ---------- */
  const W = () => D.world;
  let zoneList = null;
  /** Ids of the zones of the world (regions with an origin), south to north. */
  function zones() {
    if (!zoneList) zoneList = Object.keys(D.regions).filter(id => D.regions[id].origin).sort((a, b) => D.regions[a].origin[1] - D.regions[b].origin[1]);
    return zoneList;
  }
  const isZone = id => !!region(id).origin;
  function origin(id) { const o = region(id).origin; return o || [0, 0]; }
  function toWorld(id, x, z) { const o = origin(id); return [x + o[0], z + o[1]]; }
  function toLocal(id, X, Z) { const o = origin(id); return [X - o[0], Z - o[1]]; }
  /** Max-norm inset of world point (X, Z) inside zone id (> 0 inside, < 0 outside). */
  function inset(id, X, Z) { const R = region(id), o = R.origin; return R.radius - Math.max(Math.abs(X - o[0]), Math.abs(Z - o[1])); }
  /** The zone whose square holds world point (X, Z) (the one it is deepest in), or null outside the world. */
  function zoneAt(X, Z) {
    let best = null, bi = -Infinity;
    for (const id of zones()) { const k = inset(id, X, Z); if (k >= 0 && k > bi) { bi = k; best = id; } }
    return best;
  }
  /** Is local (x, z) of region id inside its own square (zones) or circle (a lone region), `pad` from the edge? */
  function inZone(id, x, z, pad) {
    const R = region(id); pad = pad || 0;
    return R.origin ? Math.max(Math.abs(x), Math.abs(z)) <= R.radius - pad : Math.hypot(x, z) <= R.radius - pad;
  }
  let rect = null;
  /** The world's bounding rectangle (the zones form one column, so it is the world). */
  function worldRect() {
    if (rect) return rect;
    rect = { x0: Infinity, x1: -Infinity, z0: Infinity, z1: -Infinity };
    for (const id of zones()) {
      const R = region(id), [ox, oz] = R.origin;
      rect.x0 = Math.min(rect.x0, ox - R.radius); rect.x1 = Math.max(rect.x1, ox + R.radius);
      rect.z0 = Math.min(rect.z0, oz - R.radius); rect.z1 = Math.max(rect.z1, oz + R.radius);
    }
    return rect;
  }
  /** Distance from local (x, z) of region id to the world's edge (> 0 inside); a lone region: to its rim circle. */
  function edgeDist(id, x, z) {
    const R = region(id);
    if (!R.origin) return R.radius - Math.hypot(x, z);
    const [X, Z] = toWorld(id, x, z), r = worldRect();
    return Math.min(X - r.x0, r.x1 - X, Z - r.z0, r.z1 - Z);
  }
  /** Zones whose square, grown by pad, holds world point (X, Z) (their overlays can reach it). */
  function zonesNear(X, Z, pad) {
    const out = [];
    for (const id of zones()) if (inset(id, X, Z) > -pad) out.push(id);
    return out;
  }

  /* The world model (core/dem-world.js): metres on a grid in world units, converted to game units as the zones do:
     (metres - world.base) / 3.6 x exag + offset, exag and offset blending from the Bend's to Rip's values between
     world.blend[0] and blend[1] (north), times sqrt(3.6 / the warp's metres per unit there), so the squeezed middle of
     the valley does not turn into cliffs. */
  let wg = null;
  function worldGrid() {
    if (wg) return wg;
    const B = demModule('demWorld'), hb = b64(B.h), n = B.nx * B.nz, h = new Float32Array(n);
    for (let i = 0; i < n; i++) h[i] = B.base + hb[i] * B.step;
    wg = { B, h, nx: B.nx, nz: B.nz, cell: B.cell, x0: B.x0, z0: B.z0 };
    return wg;
  }
  function worldMetres(X, Z) {
    const g = worldGrid();
    const fx = clamp((X - g.x0) / g.cell, 0, g.nx - 1.0001), fz = clamp((Z - g.z0) / g.cell, 0, g.nz - 1.0001);
    const ix = Math.floor(fx), iz = Math.floor(fz), u = fx - ix, v = fz - iz, i = iz * g.nx + ix, h = g.h;
    return (h[i] * (1 - u) + h[i + 1] * u) * (1 - v) + (h[i + g.nx] * (1 - u) + h[i + g.nx + 1] * u) * v;
  }
  /** Metres per unit of the warp at world Z (1 = the zones' own 3.6). */
  function warpScale(Z) {
    const g = worldGrid(), sc = g.B.scale, k = clamp((Z - g.z0) / (g.cell * 5), 0, sc.length - 1.0001), i = Math.floor(k);
    return sc[i] + (sc[i + 1] - sc[i]) * (k - i);
  }
  function toUnits(m, Z) {
    const w = W(), k = smooth(clamp((Z - w.blend[0]) / (w.blend[1] - w.blend[0]), 0, 1));
    const exag = w.exag[0] + (w.exag[1] - w.exag[0]) * k, off = w.offset[0] + (w.offset[1] - w.offset[0]) * k;
    return (m - w.base) / worldGrid().B.metresPerUnit * exag * Math.sqrt(worldGrid().B.metresPerUnit / warpScale(Z)) + off;
  }
  /** Weight 0..1 of a zone's own terrain model at world (X, Z): 1 inside, fading to 0 over world.band at its edge. */
  function demWeight(id, X, Z) { return smooth(clamp(inset(id, X, Z) / W().band, 0, 1)); }
  const detailW = (X, Z) => DETAIL * (0.6 * Math.sin(X * 0.071 + Z * 0.053 + 7) + 0.4 * Math.sin(X * 0.17 - Z * 0.13 + 11.9));
  /** The real ground of the world before any overlay: the world model, the zones' own models blended in, detail. */
  function worldBase(X, Z) {
    let h = toUnits(worldMetres(X, Z), Z);
    for (const id of zones()) {
      const R = D.regions[id];
      if (!R.terrain.dem) continue;
      const w = demWeight(id, X, Z);
      if (w <= 0) continue;
      const o = R.origin;
      h += (demBase(id, R, X - o[0], Z - o[1], true) - h) * w;
    }
    return h + detailW(X, Z);
  }
  /** worldBase + the volcano cones of the zones (Mount Rip's crater). */
  function worldGround(X, Z) {
    let h = worldBase(X, Z);
    for (const id of zonesNear(X, Z, 0)) {
      const R = D.regions[id], o = R.origin;
      for (const f of R.terrain.features) if (f.type === 'cone') h += cone(f, Math.hypot(X - o[0] - f.x, Z - o[1] - f.z))[0];
    }
    return h;
  }

  function noise(x, z, seed) {
    const sx = seed * 1.37, sz = seed * 2.11;
    return 16 * Math.sin(x * 0.011 + sx) * Math.cos(z * 0.013 + sz)
      + 9 * Math.sin(x * 0.029 + 1.3 + sx * 0.7) * Math.sin(z * 0.023 + 0.4 + sz * 0.5)
      + 3.5 * Math.sin(x * 0.071 + z * 0.053 + sx)
      + 1.5 * Math.sin(x * 0.17 - z * 0.13 + sz);
  }

  /** Volcano profile: concave flanks, a raised rim and a bowl-shaped crater. Returns [height, weight]. */
  function cone(f, d) {
    if (d >= f.r) return [0, 0];
    const flank = dd => f.h * Math.pow(1 - dd / f.r, 1.6);
    const w = 1 - d / f.r;                       // 1 at the centre, 0 at the foot
    if (!f.crater || d >= f.crater.r) return [flank(d), w];
    const rim = flank(f.crater.r), k = d / f.crater.r;
    return [rim - f.crater.depth * smooth(1 - k), w];          // flat floor, no kink at the rim
  }

  /** Nearest point on a polyline: { d, x, z } (distance and the closest point on the centre line). */
  function nearestOn(points, x, z) {
    let bd = Infinity, bx = 0, bz = 0;
    for (let i = 0; i + 1 < points.length; i++) {
      const ax = points[i][0], az = points[i][1], dx = points[i + 1][0] - ax, dz = points[i + 1][1] - az;
      const L2 = dx * dx + dz * dz;
      const k = L2 > 0 ? clamp(((x - ax) * dx + (z - az) * dz) / L2, 0, 1) : 0;
      const px = ax + dx * k, pz = az + dz * k, d = Math.hypot(x - px, z - pz);
      if (d < bd) { bd = d; bx = px; bz = pz; }
    }
    return { d: bd, x: bx, z: bz };
  }

  /* Feature defaults (T11). river: water at `level` (default terrain.base - 1), channel out to width / 2 x CHANNEL,
     a flat valley floor at level + BANK_UP out to `valley` beyond it; road: levelled across toward the height of its
     centre line over width / 2 + ROAD_EDGE; plateau: flat at its mean ground height over its rim (at least waterLevel + 3) out to r,
     blended over `edge`. */
  const CHANNEL = 1.4, BANK_UP = 2, VALLEY = 34, ROAD_EDGE = 5, ROAD_K = 0.85, PLATEAU_EDGE = 32;
  const riverLevel = (R, f) => (f.level != null ? f.level : R.terrain.base - 1);

  /*
   * Baked real terrain (Phase 3 T02): a region with terrain.dem = '<module>' (e.g. 'demBend', core/dem-bend.js from
   * tools/terrain/bake.py) takes its base heights from that grid instead of the noise:
   *   height = (metres above dem.base) / dem.metresPerUnit x terrain.exag + terrain.offset, plus detail noise of DETAIL.
   * terrain.water = 'mask': the river is the baked water bitset, not a polyline channel. Its level falls downstream:
   * along dem.river (the centre line in flow direction) the level is the lowest wet ground near each sample, kept
   * falling and smoothed; every grid point takes the level of its nearest centre line point. The ground under wet
   * cells is carved CARVE below the surface, dry cells near the river are kept at least LEVEE above it, so the shore
   * line is the terrain meeting the flat water mesh (render/terrain.js) at waterY = level + WATER_UP.
   */
  const DETAIL = 0.6, CARVE = 3.2, LEVEE = 1.4, WATER_UP = 0.3, NEAR_RIVER = 260;
  const demCache = new Map();
  function demModule(name) {
    if (M.mods[name]) return M.mods[name];
    if (typeof module === 'object' && module.exports) {             // Node: 'demBend' lives in dem-bend.js
      require('./' + name.replace(/[A-Z]/g, c => '-' + c.toLowerCase()) + '.js');
    }
    return M.need(name);
  }
  function b64(s) {
    if (typeof Buffer !== 'undefined') return new Uint8Array(Buffer.from(s, 'base64'));
    const bin = atob(s), out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  }
  /** Decoded grid of a region with terrain.dem: { n, cell, radius, h (units, before detail), wet (0 / 1), lvl (units), near } */
  function demGrid(id) {
    let g = demCache.get(id);
    if (g) return g;
    const T = region(id).terrain, B = demModule(T.dem), n = B.size, hb = b64(B.h), wb = b64(B.water);
    const k = (T.exag != null ? T.exag : 1) / B.metresPerUnit, off = T.offset || 0;
    const h = new Float32Array(n * n), wet = new Float32Array(n * n), lvl = new Float32Array(n * n), near = new Uint8Array(n * n);
    for (let i = 0; i < n * n; i++) { h[i] = hb[i] * k + off; wet[i] = (wb[i >> 3] >> (7 - (i & 7))) & 1; }
    const at = (x, z) => {
      const ix = clamp(Math.round((x + B.radius) / B.cell), 0, n - 1), iz = clamp(Math.round((z + B.radius) / B.cell), 0, n - 1);
      return iz * n + ix;
    };
    if (!B.river || !B.river.length) {                              // a dry region (Mount Rip): no river level to trace
      for (let iz = 0; iz < n; iz++) for (let ix = 0; ix < n; ix++) lvl[iz * n + ix] = -1e4;
      g = { n, cell: B.cell, radius: B.radius, h, wet, lvl, near, line: [], lineLevel: [], src: B };
      demCache.set(id, g);
      return g;
    }
    // river level along the centre line: samples every STEP units, lowest wet ground within SEARCH, falling, smoothed
    const STEP = 20, SEARCH = 60, line = [];
    for (let i = 0; i + 1 < B.river.length; i++) {
      const a = B.river[i], b = B.river[i + 1], m = Math.max(1, Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) / STEP));
      for (let j = 0; j < m; j++) line.push([a[0] + (b[0] - a[0]) * j / m, a[1] + (b[1] - a[1]) * j / m]);
    }
    line.push(B.river[B.river.length - 1]);
    let lv = line.map(([x, z]) => {
      let lo = Infinity;
      for (let dz = -SEARCH; dz <= SEARCH; dz += B.cell) for (let dx = -SEARCH; dx <= SEARCH; dx += B.cell) {
        const i = at(x + dx, z + dz);
        if (wet[i] && h[i] < lo) lo = h[i];
      }
      return lo;
    });
    let last = lv.find(v => v < Infinity);
    lv = lv.map(v => (last = Math.min(last, v < Infinity ? v : last)));                    // never rises downstream
    for (let pass = 0; pass < 4; pass++) lv = lv.map((v, i) => (lv[Math.max(0, i - 1)] + 2 * v + lv[Math.min(lv.length - 1, i + 1)]) / 4);
    for (let iz = 0; iz < n; iz++) for (let ix = 0; ix < n; ix++) {
      const x = -B.radius + ix * B.cell, z = -B.radius + iz * B.cell;
      let bd = Infinity, bi = 0;
      for (let i = 0; i < line.length; i++) { const d = (line[i][0] - x) ** 2 + (line[i][1] - z) ** 2; if (d < bd) { bd = d; bi = i; } }
      lvl[iz * n + ix] = lv[bi]; near[iz * n + ix] = Math.sqrt(bd) < NEAR_RIVER ? 1 : 0;
    }
    g = { n, cell: B.cell, radius: B.radius, h, wet, lvl, near, line, lineLevel: lv, src: B };
    demCache.set(id, g);
    return g;
  }
  /** Bilinear sample of one grid array at (x, z), clamped to the grid. */
  function sample(g, arr, x, z) {
    const fx = clamp((x + g.radius) / g.cell, 0, g.n - 1.0001), fz = clamp((z + g.radius) / g.cell, 0, g.n - 1.0001);
    const ix = Math.floor(fx), iz = Math.floor(fz), u = fx - ix, v = fz - iz, i = iz * g.n + ix;
    return (arr[i] * (1 - u) + arr[i + 1] * u) * (1 - v) + (arr[i + g.n] * (1 - u) + arr[i + g.n + 1] * u) * v;
  }
  /** Raw baked height (units) at (x, z), bilinear, without detail noise or the river carve. */
  function demHeight(id, x, z) { return sample(demGrid(id), demGrid(id).h, x, z); }
  /** Water mask (0..1, bilinear) of a 'mask' region; > 0.5 = river. */
  function maskAt(id, x, z) { return sample(demGrid(id), demGrid(id).wet, x, z); }
  /** Water surface height of a 'mask' region's river near (x, z) (it steps down gently downstream). */
  function waterY(id, x, z) { return sample(demGrid(id), demGrid(id).lvl, x, z) + WATER_UP; }
  const detail = (x, z, seed) => DETAIL * (0.6 * Math.sin(x * 0.071 + z * 0.053 + seed) + 0.4 * Math.sin(x * 0.17 - z * 0.13 + seed * 1.7));
  /** Real-terrain base: baked height + detail, carved under the river, kept above the water on the dry shore. */
  function demBase(id, R, x, z, noDetail) {
    const g = demGrid(id);
    let h = sample(g, g.h, x, z) + (noDetail ? 0 : detail(x, z, R.seed));
    if (R.terrain.water !== 'mask' || sample(g, g.near, x, z) <= 0) return h;
    const m = sample(g, g.wet, x, z), top = sample(g, g.lvl, x, z) + WATER_UP;
    if (m >= 0.5) return Math.min(h, top - CARVE * smooth(clamp((m - 0.5) / 0.35, 0, 1)));
    return Math.max(h, top + LEVEE * smooth(clamp((0.5 - m) / 0.3, 0, 1)));
  }

  /* Overlays on real terrain (T02): cliff { x, z, r, face, drop (, width) } lowers the ground just outside the rim on the
     `face` side (0 = +Z), fading out over `width`, so the rock face reads as a cliff: by `drop`, or over a river mask
     down to the shore (LEVEE above the water, at most 3 x drop); ruins { x, z, r } only
     marks scenery (ruinsAt); bridge { x, z, yaw, len, width } is a dry deck (deckAt) over the river at bank height. */
  const CLIFF_W = 34, CLIFF_SPREAD = 1.25, DECK_UP = 1.5;
  function cliffDrop(f, x, z) {
    const d = Math.hypot(x - f.x, z - f.z), w = f.width || CLIFF_W;
    if (d <= f.r || d >= f.r + w) return 0;
    const a = Math.cos(Math.atan2(x - f.x, z - f.z) - f.face);
    if (a <= Math.cos(CLIFF_SPREAD)) return 0;
    const ang = smooth(clamp((a - Math.cos(CLIFF_SPREAD)) / (1 - Math.cos(CLIFF_SPREAD)) * 1.6, 0, 1));
    const inner = smooth(clamp((d - f.r) / 3, 0, 1)), outer = 1 - smooth(clamp((d - f.r - 6) / (w - 6), 0, 1));
    return ang * inner * outer;                  // weight 0..1
  }

  /** Noise, volcano cones and the flatten ring: the ground before roads, rivers and plateaus. */
  function baseHeight(id, x, z) {
    const R = region(id), T = R.terrain;
    if (R.origin) return worldGround(x + R.origin[0], z + R.origin[1]);   // a zone: the one world ground
    if (T.dem) {                                 // real terrain; a cone with a crater (Mount Rip) digs its crater into it
      let h = demBase(id, R, x, z);
      for (const f of T.features) if (f.type === 'cone') h += cone(f, Math.hypot(x - f.x, z - f.z))[0];
      return h;
    }
    let n = noise(x, z, R.seed) * T.amp;
    let add = 0;
    for (const f of T.features) {
      if (f.type !== 'cone') continue;
      const [h, w] = cone(f, Math.hypot(x - f.x, z - f.z));
      add += h;
      n *= 1 - 0.85 * w;                         // keep the volcano's flanks smooth
    }
    let h = T.base + n + add;
    for (const f of T.features) {
      if (f.type !== 'flatten') continue;
      const d = Math.hypot(x - f.x, z - f.z);
      if (d > f.from) h += (f.toward - h) * smooth(clamp((d - f.from) / (f.r - f.from), 0, 1)) * 0.85;
    }
    return h;
  }

  const plateauY = new Map();                  // 'region:index' -> flat height of that plateau
  function plateauHeight(id, R, f, i) {
    const key = id + ':' + i;
    let y = plateauY.get(key);
    if (y == null) {
      // the mean ground over the plateau's rim, so it sits level with its surroundings, but never at the water
      let sum = baseHeight(id, f.x, f.z);
      for (let k = 0; k < 12; k++) sum += baseHeight(id, f.x + Math.sin(k * Math.PI / 6) * f.r, f.z + Math.cos(k * Math.PI / 6) * f.r);
      y = f.y != null ? f.y : Math.max(sum / 13, (R.waterLevel != null ? R.waterLevel : -Infinity) + 3);
      if (R.origin && f.y == null) {             // never at the river either (the world's Vltava)
        const [X, Z] = toWorld(id, f.x, f.z), q = worldRiverNear(X, Z, f.r + 60);
        if (q) y = Math.max(y, q.level + 3);
      }
      if (f.level === 'top') {                   // T02: a rock top (Vyshgard) - level with its highest ground, not its foot
        y = baseHeight(id, f.x, f.z);
        for (let k = 0; k < 12; k++) y = Math.max(y, baseHeight(id, f.x + Math.sin(k * Math.PI / 6) * f.r * 0.5, f.z + Math.cos(k * Math.PI / 6) * f.r * 0.5));
      }
      plateauY.set(key, y);
    }
    return y;
  }

  /* ---------- the world's river and roads (zones) ---------- */
  /* The Vltava below the Bend (dem-world river: [x, z, metres]): a channel of world.river.width with a flat valley floor,
     its level falling downstream; its first points join the Bend's own river level. Segments are bucketed on a grid
     (LINE_CELL) so a height sample only looks at the few segments near it. */
  const LINE_CELL = 100;
  function lineIndex(polys, reach) {
    const cells = new Map(), segs = [];
    polys.forEach((pts, pi) => {
      for (let i = 0; i + 1 < pts.length; i++) {
        const a = pts[i], b = pts[i + 1], si = segs.length;
        segs.push({ p: pi, i, ax: a[0], az: a[1], dx: b[0] - a[0], dz: b[1] - a[1] });
        const x0 = Math.floor((Math.min(a[0], b[0]) - reach) / LINE_CELL), x1 = Math.floor((Math.max(a[0], b[0]) + reach) / LINE_CELL);
        const z0 = Math.floor((Math.min(a[1], b[1]) - reach) / LINE_CELL), z1 = Math.floor((Math.max(a[1], b[1]) + reach) / LINE_CELL);
        for (let cz = z0; cz <= z1; cz++) for (let cx = x0; cx <= x1; cx++) {
          const k = cx * 100003 + cz;
          let l = cells.get(k); if (!l) cells.set(k, l = []);
          l.push(si);
        }
      }
    });
    return { cells, segs, reach };
  }
  /** Nearest indexed segment to (X, Z) within the index reach: { d, x, z, p (polyline), i (segment), k (0..1) } or null. */
  function lineNear(ix, X, Z) {
    const l = ix.cells.get(Math.floor(X / LINE_CELL) * 100003 + Math.floor(Z / LINE_CELL));
    if (!l) return null;
    let best = null;
    for (const si of l) {
      const s = ix.segs[si], L2 = s.dx * s.dx + s.dz * s.dz;
      const k = L2 > 0 ? clamp(((X - s.ax) * s.dx + (Z - s.az) * s.dz) / L2, 0, 1) : 0;
      const px = s.ax + s.dx * k, pz = s.az + s.dz * k, d = Math.hypot(X - px, Z - pz);
      if (!best || d < best.d) best = { d, x: px, z: pz, p: s.p, i: s.i, k };
    }
    return best;
  }
  let wriver = null;
  /** The world river: { pts [[X, Z]], level [units], width, depth, valley, ix } (null without a world). */
  function worldRiver() {
    if (wriver !== null) return wriver;
    if (!zones().length || !D.world || !D.world.river) return (wriver = false);
    wriver = false;                                // while building (the Bend's level reads its region): no river yet
    const B = worldGrid().B, RV = D.world.river, pts = B.river.map(p => [p[0], p[1]]);
    const level = B.river.map(p => toUnits(p[2], p[1]) + RV.up);
    const mz = zones().find(id => region(id).terrain.water === 'mask');
    if (mz) {                                     // join the masked zone's river (the Bend): its last stretch leads in
      const g = demGrid(mz), o = region(mz).origin, tail = g.line.slice(-RV.lead);
      const lead = tail.map(p => [p[0] + o[0], p[1] + o[1]]), ll = tail.map(p => waterY(mz, p[0], p[1]));
      const d0 = ll[ll.length - 1] - level[0];
      let run = 0;
      for (let i = 0; i < pts.length; i++) {
        if (i) run += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
        level[i] += d0 * (1 - smooth(clamp(run / RV.join, 0, 1)));
      }
      pts.unshift(...lead); level.unshift(...ll);
      for (let i = 1; i < level.length; i++) level[i] = Math.min(level[i], level[i - 1]);   // never rises downstream
    }
    const out = RV.width / 2 * CHANNEL;
    wriver = { pts, level, width: RV.width, depth: RV.depth, valley: RV.valley, out, ix: lineIndex([pts], out + RV.valley + 2) };
    // bridges over it (zone features with snap: 'river'): moved onto the nearest point of the centre line, across it
    for (const id of zones()) {
      const R = D.regions[id], o = R.origin;
      for (const f of R.terrain.features) {
        if (f.type !== 'bridge' || f.snap !== 'river' || f.snapped) continue;
        const q = nearestOn(pts, f.x + o[0], f.z + o[1]);
        let i = 0, bd = Infinity;
        for (let k = 0; k + 1 < pts.length; k++) { const d = nearestOn([pts[k], pts[k + 1]], q.x, q.z).d; if (d < bd) { bd = d; i = k; } }
        const along = Math.atan2(pts[i + 1][0] - pts[i][0], pts[i + 1][1] - pts[i][1]);
        f.x = q.x - o[0]; f.z = q.z - o[1]; f.yaw = along + Math.PI / 2; f.len = (out + 8) * 2; f.snapped = true;
      }
    }
    return wriver;
  }
  /** Nearest point of the world river within `reach` (the index reach at most): { d, x, z, level } or null. */
  function worldRiverNear(X, Z, reach) {
    const rv = worldRiver();
    if (!rv) return null;
    const q = lineNear(rv.ix, X, Z);
    if (!q || q.d > (reach == null ? Infinity : reach)) return null;
    q.level = rv.level[q.i] + (rv.level[q.i + 1] - rv.level[q.i]) * q.k;
    return q;
  }
  /** Weight 0..1 of the world river at (X, Z): 0 where a masked zone (the Bend) draws its own river. */
  function riverWeight(X, Z) {
    for (const id of zones()) {
      const R = D.regions[id];
      if (R.terrain.water !== 'mask' || inset(id, X, Z) < -40) continue;
      const x = X - R.origin[0], z = Z - R.origin[1];
      if (maskAt(id, x, z) > 0.3) return 0;
      if (inset(id, X, Z) > 0) for (const [ex, ez] of [[45, 0], [-45, 0], [0, 45], [0, -45]]) if (maskAt(id, x + ex, z + ez) > 0.3) return 0;   // its shore too
    }
    return 1;
  }
  let wroads = null;
  /** The road network between the villages (core/roads.js), indexed: { list, ix } (empty without a world). */
  function worldRoads() {
    if (wroads) return wroads;
    if (!zones().length || !D.world || !D.world.roads) return (wroads = { list: [], ix: lineIndex([], 0) });
    wroads = { list: [], ix: lineIndex([], 0) };               // while the network is being built: no roads yet
    const list = M.need('roads').network().roads;
    wroads = { list, ix: lineIndex(list.map(r => r.pts), D.world.roads.width / 2 + ROAD_EDGE + 1) };
    return wroads;
  }

  /** The world ground with the river shaped in: its channel and the flat valley floor beside it. */
  function riverShaped(X, Z) {
    let h = worldGround(X, Z);
    const rv = worldRiver();
    if (!rv) return h;
    const q = worldRiverNear(X, Z, rv.out + rv.valley), w = q ? riverWeight(X, Z) : 0;
    if (!q || w <= 0) return h;
    const floor = q.level + BANK_UP;
    const t = q.d >= rv.out ? h + (floor - h) * smooth(1 - (q.d - rv.out) / rv.valley)          // flat valley floor
      : (q.level - rv.depth) + (rv.depth + BANK_UP) * smooth(q.d / rv.out);                     // the channel
    return h + (t - h) * w;
  }

  /** The ground of world point (X, Z) with every overlay: the river, roads, plateaus, cliffs, the boundary ridge. */
  function worldHeight(X, Z) {
    let h = riverShaped(X, Z);
    const near = zonesNear(X, Z, 260);
    // roads: the zones' own (the Bend's) and the world's network, levelled across toward their centre line
    for (const id of near) {
      const R = D.regions[id], o = R.origin;
      for (const f of R.terrain.features) {
        if (f.type !== 'road') continue;
        const half = f.width / 2, q = nearestOn(f.points, X - o[0], Z - o[1]);
        if (q.d >= half + ROAD_EDGE) continue;
        const e = smooth(1 - clamp((q.d - half) / ROAD_EDGE, 0, 1));
        h += (riverShaped(q.x + o[0], q.z + o[1]) - h) * ROAD_K * e;
      }
    }
    const rq = lineNear(worldRoads().ix, X, Z), half = D.world.roads.width / 2;
    if (rq && rq.d < half + ROAD_EDGE) {
      const e = smooth(1 - clamp((rq.d - half) / ROAD_EDGE, 0, 1));
      h += (riverShaped(rq.x, rq.z) - h) * ROAD_K * e;
    }
    for (const id of near) {
      const R = D.regions[id], F = R.terrain.features, o = R.origin, x = X - o[0], z = Z - o[1];
      for (let i = 0; i < F.length; i++) {
        const f = F[i];
        if (f.type !== 'plateau') continue;
        const edge = f.edge != null ? f.edge : PLATEAU_EDGE, d = Math.hypot(x - f.x, z - f.z);
        if (d >= f.r + edge) continue;
        const y = plateauHeight(id, R, f, i);
        h = d <= f.r ? y : h + (y - h) * smooth(1 - (d - f.r) / edge);
      }
      for (let i = 0; i < F.length; i++) {
        if (F[i].type !== 'cliff') continue;
        const w = cliffDrop(F[i], x, z);
        if (w <= 0) continue;
        const target = R.terrain.water === 'mask' ? Math.max(waterY(id, x, z) + LEVEE, h - F[i].drop * 3) : h - F[i].drop;
        if (target < h) h += (target - h) * w;
      }
    }
    const r = worldRect(), d = Math.min(X - r.x0, r.x1 - X, Z - r.z0, r.z1 - Z);
    if (d < RIM_START) {
      const k = smooth(clamp((RIM_START - d) / RIM_WIDTH, 0, 1));
      h += k * (RIM_HEIGHT + 40 * Math.sin(X * 0.013 + Z * 0.007 + 3) * Math.cos(Z * 0.011 - X * 0.005));
    }
    return h;
  }

  function heightAt(id, x, z) {
    const R = region(id), F = R.terrain.features;
    if (R.origin) return worldHeight(x + R.origin[0], z + R.origin[1]);
    let h = baseHeight(id, x, z);
    for (let i = 0; i < F.length; i++) {
      const f = F[i];
      if (f.type === 'road') {
        const half = f.width / 2, q = nearestOn(f.points, x, z);
        if (q.d >= half + ROAD_EDGE) continue;
        const e = smooth(1 - clamp((q.d - half) / ROAD_EDGE, 0, 1));
        h += (baseHeight(id, q.x, q.z) - h) * ROAD_K * e;
        const dam = R.waterLevel != null ? R.waterLevel + 2.5 : -Infinity;            // a causeway over pond hollows
        if (h < dam) h += (dam - h) * e;
      }
    }
    for (let i = 0; i < F.length; i++) {
      const f = F[i];
      if (f.type !== 'river') continue;
      const out = f.width / 2 * CHANNEL, valley = f.valley != null ? f.valley : VALLEY;
      const q = nearestOn(f.points, x, z);
      if (q.d >= out + valley) continue;
      const lv = riverLevel(R, f), floor = lv + BANK_UP;
      if (q.d >= out) h += (floor - h) * smooth(1 - (q.d - out) / valley);       // flat valley floor
      else h = (lv - f.depth) + (f.depth + BANK_UP) * smooth(q.d / out);        // the channel, bank top = valley floor
    }
    for (let i = 0; i < F.length; i++) {
      const f = F[i];
      if (f.type !== 'plateau') continue;
      const edge = f.edge != null ? f.edge : PLATEAU_EDGE, d = Math.hypot(x - f.x, z - f.z);
      if (d >= f.r + edge) continue;
      const y = plateauHeight(id, R, f, i);
      h = d <= f.r ? y : h + (y - h) * smooth(1 - (d - f.r) / edge);
    }
    for (let i = 0; i < F.length; i++) {
      if (F[i].type !== 'cliff') continue;
      const w = cliffDrop(F[i], x, z);
      if (w <= 0) continue;
      // over a river (mask) the face drops down to the shore, LEVEE above the water, never below it; elsewhere by drop
      const target = R.terrain.water === 'mask' ? Math.max(waterY(id, x, z) + LEVEE, h - F[i].drop * 3) : h - F[i].drop;
      if (target < h) h += (target - h) * w;
    }
    const r = Math.hypot(x, z);
    if (r > R.radius - RIM_START) {
      // boundary ridge: rises over RIM_WIDTH to RIM_HEIGHT, with its own rugged noise so the skyline is not flat
      const k = smooth(clamp((r - (R.radius - RIM_START)) / RIM_WIDTH, 0, 1));
      h += k * (RIM_HEIGHT + 40 * Math.sin(x * 0.013 + z * 0.007 + R.seed) * Math.cos(z * 0.011 - x * 0.005));
    }
    return h;
  }

  /** Distance from (x, z) to the nearest centre line of a feature type ('road' | 'river'), Infinity if none (in a zone:
      the world's roads and river count too, as far as their index reaches - farther is Infinity). */
  function lineDist(id, type, x, z) {
    const R = region(id);
    let d = Infinity;
    for (const f of R.terrain.features) if (f.type === type) d = Math.min(d, nearestOn(f.points, x, z).d);
    if (R.origin) {
      const X = x + R.origin[0], Z = z + R.origin[1];
      if (type === 'road') { const q = lineNear(worldRoads().ix, X, Z); if (q) d = Math.min(d, q.d); }
      else if (type === 'river') { const q = worldRiverNear(X, Z); if (q && riverWeight(X, Z) > 0.5) d = Math.min(d, q.d); }
    }
    return d;
  }

  /** The river whose channel holds (x, z): { f, level } or null. */
  function riverAt(id, x, z) {
    const R = region(id);
    if (R.origin) {
      const X = x + R.origin[0], Z = z + R.origin[1];
      for (const mz of zones()) {                  // a masked zone's own river (the Bend's Vltava)
        const M2 = D.regions[mz];
        if (M2.terrain.water !== 'mask' || inset(mz, X, Z) < -40) continue;
        const lx = X - M2.origin[0], lz = Z - M2.origin[1];
        if (maskAt(mz, lx, lz) > 0.5 && !deckAt(id, x, z)) return { f: null, level: waterY(mz, lx, lz) };
      }
      const rv = worldRiver();
      if (rv && riverWeight(X, Z) > 0.5) {
        const q = worldRiverNear(X, Z, rv.out);
        if (q && !deckAt(id, x, z)) return { f: rv, level: q.level, world: true };
      }
      for (const f of R.terrain.features) {
        if (f.type !== 'river') continue;
        if (nearestOn(f.points, x, z).d < f.width / 2 * CHANNEL) return { f, level: riverLevel(R, f) };
      }
      return null;
    }
    if (R.terrain.water === 'mask') return maskAt(id, x, z) > 0.5 && !deckAt(id, x, z) ? { f: null, level: waterY(id, x, z) } : null;
    for (const f of R.terrain.features) {
      if (f.type !== 'river') continue;
      if (nearestOn(f.points, x, z).d < f.width / 2 * CHANNEL) return { f, level: riverLevel(R, f) };
    }
    return null;
  }

  /** The plateau (settlement ground) under (x, z), or null. */
  function plateauAt(id, x, z, pad) {
    for (const f of region(id).terrain.features) if (f.type === 'plateau' && Math.hypot(x - f.x, z - f.z) < f.r + (pad || 0)) return f;
    return null;
  }

  /** The ruins overlay (burned city scenery) under (x, z), or null. */
  function ruinsAt(id, x, z, pad) {
    for (const f of region(id).terrain.features) if (f.type === 'ruins' && Math.hypot(x - f.x, z - f.z) < f.r + (pad || 0)) return f;
    return null;
  }

  /** The town district or village circle (region.city, core/city.js lays out its streets and houses) under (x, z), or null. */
  function cityAt(id, x, z, pad) {
    const C = region(id).city;
    if (!C) return null;
    pad = pad || 0;
    for (const d of C.districts || []) if (Math.hypot(x - d.x, z - d.z) < d.r + pad) return d;
    for (const v of C.villages || []) if (Math.hypot(x - v.x, z - v.z) < v.r * 1.3 + pad) return v;
    return null;
  }

  /** Bridge deck at (x, z): { f, y, u, v } (u across in -0.5..0.5, v along in -0.5..0.5) or null. The deck lies at the
      higher bank's ground + DECK_UP, level from end to end. */
  const deckY = new Map();
  function bridgeY(id, f, i) {
    const key = id + ':' + i;
    let y = deckY.get(key);
    if (y == null) {
      const sx = Math.sin(f.yaw) * f.len / 2, sz = Math.cos(f.yaw) * f.len / 2;
      y = Math.max(heightAt(id, f.x - sx, f.z - sz), heightAt(id, f.x + sx, f.z + sz)) + DECK_UP;
      deckY.set(key, y);
    }
    return y;
  }
  function deckAt(id, x, z, pad) {
    const F = region(id).terrain.features;
    pad = pad || 0;
    for (let i = 0; i < F.length; i++) {
      const f = F[i];
      if (f.type !== 'bridge') continue;
      const dx = x - f.x, dz = z - f.z, s = Math.sin(f.yaw), c = Math.cos(f.yaw);
      const v = dx * s + dz * c, u = dx * c - dz * s;
      if (Math.abs(u) < f.width / 2 + pad && Math.abs(v) < f.len / 2 + pad) return { f, y: bridgeY(id, f, i), u: u / f.width, v: v / f.len };
    }
    return null;
  }

  /**
   * Height of the drawn surface: heightAt sampled on the GRID corners and interpolated over the same
   * two triangles per cell the renderer uses (split along the cell's 10-01 diagonal).
   * Collision and placement use this, so nothing floats above or sinks into the visible mesh.
   */
  function meshAt(id, x, z) {
    const i = Math.floor(x / GRID), j = Math.floor(z / GRID);
    const x0 = i * GRID, z0 = j * GRID, u = (x - x0) / GRID, v = (z - z0) / GRID;
    if (u + v <= 1) {
      const h00 = heightAt(id, x0, z0);
      return h00 + (heightAt(id, x0 + GRID, z0) - h00) * u + (heightAt(id, x0, z0 + GRID) - h00) * v;
    }
    const h11 = heightAt(id, x0 + GRID, z0 + GRID);
    return h11 + (heightAt(id, x0, z0 + GRID) - h11) * (1 - u) + (heightAt(id, x0 + GRID, z0) - h11) * (1 - v);
  }
  /** As meshAt, but a bridge deck (T02) is ground too: walk, land and collide on it (render/bridge-view.js draws it). */
  function surfaceAt(id, x, z) {
    const h = meshAt(id, x, z);
    if (!hasBridges(id)) return h;
    const b = deckAt(id, x, z);
    return b ? Math.max(h, b.y) : h;
  }
  const bridgeFlag = new Map();
  function hasBridges(id) {
    let b = bridgeFlag.get(id);
    if (b == null) { b = region(id).terrain.features.some(f => f.type === 'bridge'); bridgeFlag.set(id, b); }
    return b;
  }

  /** Approximate slope (rise per unit) from central differences. */
  function slopeAt(id, x, z, e) {
    e = e || 2;
    const dx = heightAt(id, x + e, z) - heightAt(id, x - e, z);
    const dz = heightAt(id, x, z + e) - heightAt(id, x, z - e);
    return Math.hypot(dx, dz) / (2 * e);
  }

  /** Keeps pos inside the region radius (a zone: inside the world) and between ground + minAlt and the ceiling (mutates pos). */
  function clampToRegion(id, pos, minAlt) {
    const R = region(id);
    if (R.origin) {
      const r = worldRect(), o = R.origin;
      pos[0] = clamp(pos[0], r.x0 - o[0], r.x1 - o[0]); pos[2] = clamp(pos[2], r.z0 - o[1], r.z1 - o[1]);
    } else {
      const r = Math.hypot(pos[0], pos[2]);
      if (r > R.radius) { pos[0] *= R.radius / r; pos[2] *= R.radius / r; }
    }
    const g = surfaceAt(id, pos[0], pos[2]) + (minAlt == null ? D.flight.minAlt : minAlt);
    pos[1] = Math.min(R.ceiling, Math.max(g, pos[1]));
    return pos;
  }

  /** Centre of the lair cave mouth, or null for regions without a lair. */
  function lairPos(id) {
    const L = region(id).lair;
    if (!L) return null;
    return [L.x, surfaceAt(id, L.x, L.z) + L.above, L.z];
  }

  /* Lava streams down a volcano: features { type: 'lava', a (direction, 0 = +Z), len, w: [width at the rim, at the
     foot], ph } on a region with a crater. A stream leaves the crater at its rim, wanders a little on its way down,
     widens into a pool near its end and stops. lavaAt is 1 on the centre line and falls to 0 over LAVA_HALO stream
     half-widths (the glowing ground beside it); above LAVA_IN the point is in the lava itself. */
  const flowCache = new Map(), LAVA_HALO = 2.2, LAVA_IN = 1 - 1 / LAVA_HALO;
  function lavaFlows(id) {
    let L = flowCache.get(id);
    if (L) return L;
    const R = region(id), c = R.terrain.features.find(ff => ff.type === 'cone' && ff.crater);
    L = c ? R.terrain.features.filter(ff => ff.type === 'lava').map(f => ({ f, cone: c, r0: c.crater.r * 0.85, r1: c.crater.r * 0.85 + f.len })) : [];
    flowCache.set(id, L);
    return L;
  }
  function flowAngle(s, r) { const d = r - s.r0; return s.f.a + 0.15 * Math.sin(d * 0.017 + s.f.ph) + 0.05 * Math.sin(d * 0.06 + s.f.ph * 2.3); }
  /** Full width of stream s at radius r from the crater centre (0 outside its length). */
  function flowWidth(s, r) {
    if (r < s.r0 || r > s.r1) return 0;
    const k = (r - s.r0) / (s.r1 - s.r0);
    return (s.f.w[0] + (s.f.w[1] - s.f.w[0]) * smooth(k)) * (1 + 0.9 * smooth(clamp((k - 0.68) / 0.2, 0, 1))) * (1 - smooth(clamp((k - 0.9) / 0.1, 0, 1)));
  }
  function lavaAt(id, x, z) {
    const L = lavaFlows(id);
    if (!L.length) return 0;
    const c = L[0].cone, dx = x - c.x, dz = z - c.z, r = Math.hypot(dx, dz);
    let best = 0;
    for (const s of L) {
      const w = flowWidth(s, r);
      if (w <= 0) continue;
      let da = Math.atan2(dx, dz) - flowAngle(s, r);
      da = Math.abs(da - Math.round(da / (2 * Math.PI)) * 2 * Math.PI);
      const k = 1 - da * r / (w * 0.5 * LAVA_HALO);
      if (k > best) best = k;
    }
    return best;
  }

  /** Lava surface height in the crater, or null. */
  function lavaLevel(id) {
    const f = region(id).terrain.features.find(ff => ff.type === 'cone' && ff.crater);
    if (!f) return null;
    return surfaceAt(id, f.x, f.z) + 3;
  }

  /**
   * Liquid at (x, z): 'lava' in a crater below the lava level, 'water' inside a region water disc
   * (region.water: [{ x, z, r }]), in a river channel below its level (T11) or below the region's waterLevel
   * (lakes, Wildwood), else null. Not landable, not walkable.
   */
  function liquidAt(id, x, z) {
    const R = region(id);
    if (R.origin) {
      const X = x + R.origin[0], Z = z + R.origin[1], zid = zoneAt(X, Z) || id;
      if (zid !== id) { const [lx, lz] = toLocal(zid, X, Z), l = liquidAt(zid, lx, lz); return l; }
      for (const f of R.terrain.features) {
        if (f.type === 'cone' && f.crater && Math.hypot(x - f.x, z - f.z) < f.crater.r && surfaceAt(id, x, z) < lavaLevel(id)) return 'lava';
      }
      if (lavaAt(id, x, z) > LAVA_IN) return 'lava';
      for (const w of R.water || []) if (Math.hypot(x - w.x, z - w.z) < w.r) return 'water';
      const rv = riverAt(id, x, z);
      if (rv && (!rv.world || surfaceAt(id, x, z) < rv.level)) return 'water';
      return null;
    }
    for (const f of R.terrain.features) {
      if (f.type !== 'cone' || !f.crater) continue;
      if (Math.hypot(x - f.x, z - f.z) < f.crater.r && surfaceAt(id, x, z) < lavaLevel(id)) return 'lava';
    }
    if (lavaAt(id, x, z) > LAVA_IN) return 'lava';                 // a stream down the flank
    for (const w of R.water || []) if (Math.hypot(x - w.x, z - w.z) < w.r) return 'water';
    const rv = riverAt(id, x, z);
    if (rv && (R.terrain.water === 'mask' || surfaceAt(id, x, z) < rv.level)) return 'water';   // riverAt is null on a deck
    if (R.waterLevel != null && surfaceAt(id, x, z) < R.waterLevel) return 'water';
    return null;
  }

  /** Dry ground for animals and trees: no liquid and at least SHORE above the water it borders. */
  const SHORE = 1.6;
  function dryAt(id, x, z) {
    const R = region(id), h = surfaceAt(id, x, z);
    if (R.origin) {
      if (hasBridges(id) && deckAt(id, x, z)) return true;
      for (const w of R.water || []) if (Math.hypot(x - w.x, z - w.z) < w.r) return false;
      const X = x + R.origin[0], Z = z + R.origin[1];
      for (const mz of zones()) {
        const M2 = D.regions[mz];
        if (M2.terrain.water !== 'mask' || inset(mz, X, Z) < -40) continue;
        const lx = X - M2.origin[0], lz = Z - M2.origin[1];
        if (maskAt(mz, lx, lz) >= 0.3 || h < waterY(mz, lx, lz) + SHORE * 0.5) return false;
      }
      const rv = worldRiver(), q = rv && worldRiverNear(X, Z, rv.out + rv.valley);
      if (q && riverWeight(X, Z) > 0.5 && (q.d < rv.out || h < q.level + SHORE)) return false;
      return true;
    }
    if (R.waterLevel != null && h < R.waterLevel + SHORE) return false;
    if (R.terrain.water === 'mask') {
      if (deckAt(id, x, z)) return true;
      return maskAt(id, x, z) < 0.3 && h >= waterY(id, x, z) + SHORE * 0.5;
    }
    const rv = riverAt(id, x, z);
    if (rv && h < rv.level + SHORE) return false;
    for (const w of R.water || []) if (Math.hypot(x - w.x, z - w.z) < w.r) return false;
    return true;
  }

  /** Slope (rise / run) of the drawn surface, from central differences over half a grid cell. */
  function surfaceSlope(id, x, z) {
    const e = GRID / 2;
    const dx = surfaceAt(id, x + e, z) - surfaceAt(id, x - e, z), dz = surfaceAt(id, x, z + e) - surfaceAt(id, x, z - e);
    return Math.hypot(dx, dz) / (2 * e);
  }

  /*
   * Fields (T11): flat rectangles of crops, placed once per region from its seed near roads and rivers.
   * region.flora.fields = how many; each { x, z, yaw, w, l, crop } (w across, l along yaw, crop 0..3).
   * The renderer paints them into the vertex colours and trees keep off them; later tasks put pens beside them.
   */
  const FIELD = { w: [34, 56], l: [50, 90], gap: 8, slope: 0.25, edgePad: 160, roadPad: 6, riverPad: 8, plateauPad: 18, tries: 120 };
  const fieldCache = new Map();
  function fields(id) {
    if (fieldCache.has(id)) return fieldCache.get(id);
    const R = region(id), n = (R.flora && R.flora.fields) || 0, out = [];
    const lines = R.terrain.features.filter(f => f.type === 'road' || f.type === 'river');
    if (R.origin && n) {                         // a zone: along the world's roads and the river where they cross it
      const o = R.origin, polys = worldRoads().list.map(r => r.pts), rv = worldRiver();
      if (rv) polys.push(rv.pts);
      for (const pts of polys) {
        const loc = pts.map(p => [p[0] - o[0], p[1] - o[1]]).filter(p => Math.max(Math.abs(p[0]), Math.abs(p[1])) < R.radius);
        if (loc.length >= 2) lines.push({ type: 'road', points: loc });
      }
    }
    let seed = (R.seed * 2654435761) >>> 0;
    const rnd = () => { seed = (seed + 0x6D2B79F5) >>> 0; let t = seed; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
    const corners = (c) => {
      const s = Math.sin(c.yaw), co = Math.cos(c.yaw), pts = [[c.x, c.z]];
      for (const [u, v] of [[-1, -1], [1, -1], [1, 1], [-1, 1], [0, -1], [0, 1], [-1, 0], [1, 0]]) {
        const a = u * c.w / 2, b = v * c.l / 2;
        pts.push([c.x + a * co + b * s, c.z - a * s + b * co]);
      }
      return pts;
    };
    const ok = (c) => {
      const rr = Math.hypot(c.w, c.l) / 2;
      if (R.origin ? (!inZone(id, c.x, c.z, rr + 30) || edgeDist(id, c.x, c.z) < FIELD.edgePad) : Math.hypot(c.x, c.z) > R.radius - FIELD.edgePad) return false;
      for (const o of out) if (Math.hypot(o.x - c.x, o.z - c.z) < rr + Math.hypot(o.w, o.l) / 2 * 0.8 + FIELD.gap) return false;
      for (const [x, z] of corners(c)) {
        if (!dryAt(id, x, z) || plateauAt(id, x, z, FIELD.plateauPad) || cityAt(id, x, z, 10)) return false;
        if (lineDist(id, 'road', x, z) < FIELD.roadPad + 4) return false;
        for (const f of R.terrain.features) if (f.type === 'river' && nearestOn(f.points, x, z).d < f.width / 2 * CHANNEL + FIELD.riverPad) return false;
        if (R.origin && worldRiver() && lineDist(id, 'river', x, z) < worldRiver().out + FIELD.riverPad) return false;
        if (R.origin && cityNear(id, x, z, 10)) return false;
        if (slopeAt(id, x, z, 4) > FIELD.slope) return false;
      }
      return true;
    };
    for (let k = 0; k < n * FIELD.tries && out.length < n && lines.length; k++) {
      const f = lines[Math.floor(rnd() * lines.length)], i = Math.floor(rnd() * (f.points.length - 1));
      const a = f.points[i], b = f.points[i + 1], t = rnd(), px = a[0] + (b[0] - a[0]) * t, pz = a[1] + (b[1] - a[1]) * t;
      const along = Math.atan2(b[0] - a[0], b[1] - a[1]), side = rnd() < 0.5 ? -1 : 1, off = 30 + rnd() * 260;
      const c = {
        x: px + Math.cos(along) * off * side, z: pz - Math.sin(along) * off * side,
        yaw: along + (rnd() < 0.5 ? 0 : Math.PI / 2) + (rnd() - 0.5) * 0.3,
        w: FIELD.w[0] + rnd() * (FIELD.w[1] - FIELD.w[0]), l: FIELD.l[0] + rnd() * (FIELD.l[1] - FIELD.l[0]), crop: Math.floor(rnd() * 5),   // 0 wheat, 1 young green, 2 ploughed, 3 hay, 4 corn (core/crops.js: burns and pops)
      };
      if (ok(c)) out.push(c);
    }
    fieldCache.set(id, out);
    return out;
  }

  /** The field at (x, z): { f, u, v } (u across in -0.5..0.5, v along) or null. */
  function fieldAt(id, x, z, pad) {
    pad = pad || 0;
    for (const f of fields(id)) {
      const dx = x - f.x, dz = z - f.z, s = Math.sin(f.yaw), c = Math.cos(f.yaw);
      const u = dx * c - dz * s, v = dx * s + dz * c;
      if (Math.abs(u) < f.w / 2 + pad && Math.abs(v) < f.l / 2 + pad) return { f, u: u / f.w, v: v / f.l };
    }
    return null;
  }

  /** A town or village circle of any zone near world-frame point (x, z) of zone id (fields keep off the neighbours' too). */
  function cityNear(id, x, z, pad) {
    const [X, Z] = toWorld(id, x, z);
    for (const zid of zonesNear(X, Z, 300)) { const [lx, lz] = toLocal(zid, X, Z); if (cityAt(zid, lx, lz, pad)) return true; }
    return false;
  }

  M.define('terrain', { zones, origin, toWorld, toLocal, zoneAt, inZone, worldRect, edgeDist, zonesNear, worldMetres, worldGround, worldHeight, worldRiver, worldRiverNear, riverWeight, worldRoads, warpScale, toUnits, isZone, cityNear,
    GRID, CHUNK, demHeight, demGrid, maskAt, waterY, ruinsAt, cityAt, deckAt, meshAt, heightAt, baseHeight, nearestOn, lineDist, riverAt, plateauAt, dryAt, fields, fieldAt, riverLevel: (id, f) => riverLevel(region(id), f), lavaFlows, flowAngle, flowWidth, lavaAt, LAVA_IN, surfaceAt, slopeAt, surfaceSlope, liquidAt, clampToRegion, lairPos, lavaLevel, region, noise });
})(typeof self !== 'undefined' ? self : this);
