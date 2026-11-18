/*
 * Verdigris campaign - towns and villages as lots of buildings (Prahold and the villages of every region).
 * A region's `city` (data.regions[id].city) lists districts (parts of a town, each with its street plan and its mix of
 * building styles) and villages (a green with houses round it, or a street of houses). From that this module lays
 * out, deterministically from the region seed:
 *   streets (polylines with a width), squares (circles or long rectangles), landmarks (churches, the cathedral, the
 *   town hall, towers, palaces at fixed real places) and lots: one building each, standing on the ground of its plot,
 *   its front (local +Z, turned by yaw) toward the street or the square it faces.
 * The renderer (render/city-view.js with render/house-kit.js) draws exactly these lots; flight, walking and landing
 * collide with the same boxes (solidAt / hit), so what you see is what you hit.
 *
 *   build(regionId) -> city | null   (cached)
 *       city: { region, lots: [lot], streets: [{ pts: [[x, z]], w, main }], squares: [sq], districts, villages, info }
 *       lot: { id, x, z, y, rise, yaw, w, d, floors, style, kind, seed, corner, arcade, h, top, district }
 *            y = the lowest ground under the footprint, rise = highest - lowest, h = wall top above y, top = roof top
 *            (absolute). kind: house | church | cathedral | domechurch | townhall | tower | gatetower | palace | chapel |
 *            cottage | barn | shed; style: gothic | renaissance | baroque | classic | timber | cottage | log | farm | barn
 *       sq: { kind: 'circle' | 'rect', x, z, r | (len, wid, yaw), green: bool, name }
 *   solidAt(regionId, x, z, pad?) -> roof top | null      the highest lot whose footprint (+ pad) covers (x, z)
 *   hit(regionId, x, z, pad?) -> { roof, nx, nz, depth } | null   the lot the point is deepest inside (push out by depth)
 *   placeAt(regionId, x, z) -> district | village | null  the part of town (x, z) lies in (name key for the compass)
 *   pavedAt(regionId, x, z) -> 0 | 1 street | 2 square | 3 green   ground use of a cell (2 units)
 *   lotsNear(regionId, x, z, r) -> lot[]
 * Pure: no DOM, no THREE.
 */
(function (root) {
  'use strict';
  const M = typeof module === 'object' && module.exports ? require('./umd.js') : root.VCamp;
  const D = M.need('data'), T = M.need('terrain');
  const { mulberry, clamp } = M.need('math');

  const CELL = 2;                 // raster cell (units)
  const HASH = 24;                // spatial hash cell for collisions (units)
  const STOREY = 3;               // one storey (units), as render/house-kit.js draws it
  const FRONT_BAND = 3;           // front strip of a lot the street raster may reach into (slanted streets)
  const cache = new Map();

  const KIND_SIZE = {             // default footprint [w, d] and storeys of landmarks
    church: [14, 30, 3], cathedral: [26, 70, 6], domechurch: [26, 34, 4], townhall: [18, 22, 4], tower: [9, 9, 8],
    gatetower: [12, 12, 7], palace: [60, 18, 3], chapel: [7, 11, 1], cottage: [8, 10, 1], barn: [10, 14, 1], shed: [6, 7, 1],
  };
  /** Roof / spire height of a lot above its wall top (an estimate the renderer stays under; for collisions). */
  function roofOf(kind, w, d, floors) {
    if (kind === 'cathedral') return 34;
    if (kind === 'tower' || kind === 'gatetower') return Math.max(w, d) * 1.2;
    if (kind === 'church') return 18;
    if (kind === 'domechurch') return 22;
    if (kind === 'townhall') return 26;
    return Math.min(w, d) * 0.55;
  }

  function pick(weights, r) {
    let sum = 0;
    for (const k in weights) sum += weights[k];
    let x = r * sum;
    for (const k in weights) { x -= weights[k]; if (x <= 0) return k; }
    return Object.keys(weights)[0];
  }
  const rng0 = seed => mulberry(seed >>> 0);
  const hashSeed = (a, b) => (Math.imul(a ^ 0x9e3779b9, 0x85ebca6b) ^ Math.imul(b + 0x632be5ab, 0xc2b2ae35)) >>> 0;

  /* ---------- the raster: what each 2-unit cell of the region is used for ---------- */
  const FREE = 0, STREET = 1, SQUARE = 2, GREEN = 3, BUILT = 4;
  function Raster(radius) {
    this.n = Math.ceil(2 * radius / CELL) + 1; this.o = radius; this.a = new Uint8Array(this.n * this.n);
  }
  Raster.prototype.idx = function (x, z) {
    const i = Math.floor((x + this.o) / CELL), j = Math.floor((z + this.o) / CELL);
    return i < 0 || j < 0 || i >= this.n || j >= this.n ? -1 : j * this.n + i;
  };
  Raster.prototype.get = function (x, z) { const i = this.idx(x, z); return i < 0 ? 255 : this.a[i]; };
  Raster.prototype.set = function (x, z, v, only) { const i = this.idx(x, z); if (i >= 0 && (only == null || this.a[i] === only)) this.a[i] = v; };
  /** Marks cells within w / 2 of a polyline. */
  Raster.prototype.line = function (pts, w, v) {
    for (let k = 0; k + 1 < pts.length; k++) {
      const [ax, az] = pts[k], [bx, bz] = pts[k + 1], L = Math.hypot(bx - ax, bz - az), n = Math.max(1, Math.ceil(L / 1));
      for (let s = 0; s <= n; s++) {
        const x = ax + (bx - ax) * s / n, z = az + (bz - az) * s / n;
        for (let dz = -w / 2; dz <= w / 2; dz += CELL * 0.7) for (let dx = -w / 2; dx <= w / 2; dx += CELL * 0.7) {
          if (dx * dx + dz * dz <= w * w / 4) this.set(x + dx, z + dz, v, FREE);
        }
      }
    }
  };

  /** Corners and edge points of a footprint (local w along X, d along Z, front = +Z turned by yaw). */
  function footprint(x, z, yaw, w, d, step) {
    const c = Math.cos(yaw), s = Math.sin(yaw), out = [];
    const nu = Math.max(1, Math.ceil(w / step)), nv = Math.max(1, Math.ceil(d / step));
    for (let i = 0; i <= nu; i++) for (let j = 0; j <= nv; j++) {
      const u = -w / 2 + w * i / nu, v = -d / 2 + d * j / nv;
      out.push([x + u * c + v * s, z - u * s + v * c]);
    }
    return out;
  }

  /* ---------- ground checks ---------- */
  const why = {};
  let phase = '';
  const no = k => { why[phase + k] = (why[phase + k] || 0) + 1; return null; };
  function groundOk(id, R, pts, maxRise, opt) {
    let lo = Infinity, hi = -Infinity;
    for (const [x, z] of pts) {
      if (R.origin ? !T.inZone(id, x, z, 15) || T.edgeDist(id, x, z) < 150 : Math.hypot(x, z) > R.radius - 150) return no('rim');
      if (T.liquidAt(id, x, z) || !T.dryAt(id, x, z) || T.deckAt(id, x, z, 4)) return no('wet');
      if (T.lineDist(id, 'road', x, z) < (opt.roadPad || 6.5)) return no('road');
      if (T.lineDist(id, 'river', x, z) < 22) return no('river');
      if (!opt.onPlateau && T.plateauAt(id, x, z, 14)) return no('plateau');
      if (T.fieldAt(id, x, z, 2)) return no('field');
      if (T.lavaAt && T.lavaAt(id, x, z) > 0) return no('lava');
      const h = T.surfaceAt(id, x, z);
      lo = Math.min(lo, h); hi = Math.max(hi, h);
      if (hi - lo > maxRise) return no('rise');
    }
    return { y: lo, rise: hi - lo };
  }
  function nearKeepout(id, R, x, z) {
    if (R.lair && Math.hypot(x - R.lair.x, z - R.lair.z) < 70) return true;
    const ae = D.aeries && D.aeries[id];
    if (ae && Math.hypot(x - ae.x, z - ae.z) < 60) return true;
    for (const s of R.settlements || []) if (Math.hypot(x - s.x, z - s.z) < (s.type === 'castle' ? 150 : 70)) return true;
    if (R.vines && Math.hypot(x - R.vines.x, z - R.vines.z) < R.vines.r) return true;
    return false;
  }

  /* ---------- street plans ---------- */
  /** Street lines of a district: two families of (warped) parallel lines across its circle. */
  function streetsOf(id, R, dist, rnd) {
    const out = [], P = dist.plan || 'organic', bl = dist.block || [34, 46], warp = P === 'organic' ? (dist.warp != null ? dist.warp : 9) : P === 'suburb' ? 5 : 0;
    for (let fam = 0; fam < 2; fam++) {
      const th = (dist.orient || 0) + fam * Math.PI / 2;
      const ux = Math.sin(th), uz = Math.cos(th), vx = uz, vz = -ux;             // u along the street, v across
      let o = -dist.r + bl[fam] * (0.4 + rnd() * 0.3);
      while (o < dist.r) {
        const tilt = P === 'grid' ? 0 : (rnd() - 0.5) * (P === 'organic' ? 0.32 : 0.16);
        const ph = rnd() * 6.28, f = 0.012 + rnd() * 0.02;
        const cu = Math.sin(th + tilt), cw = Math.cos(th + tilt);
        let cur = [];
        const flush = () => { if (cur.length >= 4) out.push({ pts: cur, w: dist.street || 6, main: false, district: dist.id }); cur = []; };
        for (let t = -dist.r * 1.05; t <= dist.r * 1.05; t += 4) {
          const lat = warp * Math.sin(t * f + ph) + warp * 0.4 * Math.sin(t * f * 2.7 + ph * 1.3);
          const x = dist.x + vx * o + cu * t + vx * lat, z = dist.z + vz * o + cw * t + vz * lat;
          const inside = Math.hypot(x - dist.x, z - dist.z) < dist.r && T.dryAt(id, x, z) && !T.liquidAt(id, x, z) && !nearKeepout(id, R, x, z);
          if (inside) cur.push([x, z]); else flush();
        }
        flush();
        o += bl[fam] * (P === 'grid' ? 1 : 0.8 + rnd() * 0.45);
        if (P === 'organic' && rnd() < 0.18) o += bl[fam] * 0.6;                   // an odd longer block
      }
    }
    return out;
  }

  /* ---------- lots ---------- */
  function makeLot(city, o) {
    const floors = o.floors || 1, kind = o.kind || 'house';
    const h = floors * STOREY + o.rise + 0.4;
    const lot = { id: city.lots.length, x: o.x, z: o.z, y: o.y, rise: o.rise, yaw: o.yaw, w: o.w, d: o.d, floors, style: o.style, kind,
      seed: o.seed >>> 0, corner: !!o.corner, arcade: !!o.arcade, district: o.district || null, h, top: o.y + h + roofOf(kind, o.w, o.d, floors) };
    if (o.name) lot.name = o.name;
    city.lots.push(lot);
    return lot;
  }
  /* Lots against lots: exact box overlap (separating axes) through a hash of the lots placed so far, so a row of
     houses can stand wall to wall; the raster only keeps them off streets, squares and greens. */
  function boxAxes(l) { const c = Math.cos(l.yaw), s = Math.sin(l.yaw); return [[c, -s], [s, c]]; }
  function overlaps(a, b, gap) {
    for (const [ax, az] of boxAxes(a).concat(boxAxes(b))) {
      const pa = proj(a, ax, az), pb = proj(b, ax, az);
      if (pa[1] + gap <= pb[0] || pb[1] + gap <= pa[0]) return false;
    }
    return true;
  }
  function proj(l, ax, az) {
    const c = Math.cos(l.yaw), s = Math.sin(l.yaw), ux = c, uz = -s, vx = s, vz = c;
    const m = l.x * ax + l.z * az, r = Math.abs(ux * ax + uz * az) * l.w / 2 + Math.abs(vx * ax + vz * az) * l.d / 2;
    return [m - r, m + r];
  }
  const BH = 32;
  function boxHit(city, o) {
    const rr = Math.hypot(o.w, o.d) / 2 + 1;
    for (let i = Math.floor((o.x - rr) / BH); i <= Math.floor((o.x + rr) / BH); i++)
      for (let j = Math.floor((o.z - rr) / BH); j <= Math.floor((o.z + rr) / BH); j++) {
        for (const l of city.boxes.get(i * 4096 + j) || []) if (overlaps(o, l, 0.1)) return true;
      }
    return false;
  }
  function addBox(city, l) {
    const rr = Math.hypot(l.w, l.d) / 2;
    for (let i = Math.floor((l.x - rr) / BH); i <= Math.floor((l.x + rr) / BH); i++)
      for (let j = Math.floor((l.z - rr) / BH); j <= Math.floor((l.z + rr) / BH); j++) {
        const k = i * 4096 + j; let a = city.boxes.get(k); if (!a) city.boxes.set(k, a = []); a.push(l);
      }
  }
  /** Tries a lot at (x, z, yaw); on success marks it and returns it. The raster test leaves out a front band (the
      pavement: street cells reach into it on slanted streets) and a thin rim, as the raster is coarser than a wall. */
  function tryLot(city, id, R, ras, o, inside) {
    const c = Math.cos(o.yaw), sn = Math.sin(o.yaw), back = 1.1;
    const tw = Math.max(1, o.w - 1.6), td = Math.max(1, o.d - FRONT_BAND - back);
    const tx = o.x - (FRONT_BAND - back) / 2 * sn, tz = o.z - (FRONT_BAND - back) / 2 * c;
    for (const [x, z] of footprint(tx, tz, o.yaw, tw, td, 1.4)) {
      const v = ras.get(x, z);
      if (v !== FREE && v !== BUILT) return no('taken' + v);
    }
    if (inside) for (const [x, z] of footprint(o.x, o.z, o.yaw, o.w, o.d, Math.max(o.w, o.d))) if (!inside(x, z)) return no('outside');
    if (boxHit(city, o)) return no('lot');
    const corners = footprint(o.x, o.z, o.yaw, o.w, o.d, Math.max(o.w, o.d));
    corners.push([o.x, o.z]);
    const g = groundOk(id, R, corners, o.maxRise || 4.5, o);
    if (!g) return null;
    for (const [x, z] of footprint(o.x, o.z, o.yaw, o.w, o.d, 1.2)) ras.set(x, z, BUILT, FREE);
    const lot = makeLot(city, Object.assign({}, o, g));
    addBox(city, lot);
    return lot;
  }

  /** Lots along both sides of a polyline, fronts toward it. */
  function lineLots(city, id, R, ras, line, dist, rnd, inside) {
    const pts = line.pts;
    for (const side of [-1, 1]) {
      let k = 0, s = rnd() * 3;
      while (k + 1 < pts.length) {
        const [ax, az] = pts[k], [bx, bz] = pts[k + 1], L = Math.hypot(bx - ax, bz - az);
        if (s > L) { s -= L; k++; continue; }
        const tx = (bx - ax) / L, tz = (bz - az) / L, nx = tz * side, nz = -tx * side;
        const w = dist.front[0] + rnd() * (dist.front[1] - dist.front[0]), d = dist.depth[0] + rnd() * (dist.depth[1] - dist.depth[0]);
        const st = styleFor(dist, rnd), back = (dist.setback || 0) * rnd();
        const at = (ww, dd) => {
          const off = line.w / 2 + dd / 2 + 1.6 + back;            // a strip of pavement in front
          const px = ax + tx * s + nx * off, pz = az + tz * s + nz * off;
          return { x: px + tx * ww / 2, z: pz + tz * ww / 2, yaw: Math.atan2(-nx, -nz), w: ww, d: dd, district: dist.id, style: st.style, kind: st.kind,
            floors: floorsFor(dist, st, rnd), seed: (rnd() * 4294967296) >>> 0, maxRise: dist.maxRise };
        };
        let lot = null;
        if (rnd() < (dist.density == null ? 1 : dist.density)) {
          // a shallower or narrower house where the full plot runs into the next street or a neighbour (crooked blocks)
          for (const [kw, kd] of [[1, 1], [1, 0.72], [0.75, 0.6]]) {
            if (d * kd < 6 || w * kw < 5) break;
            lot = tryLot(city, id, R, ras, at(w * kw, d * kd), inside);
            if (lot) break;
          }
        }
        if (lot) {
          lot.corner = cornerOf(ras, lot);
          s += lot.w + 0.12 + (dist.gap ? rnd() * dist.gap : 0);
          if (dist.yards && rnd() < dist.yards) backBarn(city, id, R, ras, lot, rnd, inside);
        } else s += 1.2;
      }
    }
  }
  /** A barn or shed behind a village house, same yaw. */
  function backBarn(city, id, R, ras, lot, rnd, inside) {
    const back = lot.d / 2 + 5 + rnd() * 3, c = Math.cos(lot.yaw), s = Math.sin(lot.yaw);
    const big = rnd() < 0.6, w = big ? 9 + rnd() * 4 : 5 + rnd() * 2, d = big ? 6 + rnd() * 3 : 4 + rnd() * 2;
    const lu = (rnd() - 0.5) * 4;
    tryLot(city, id, R, ras, { x: lot.x + lu * c - back * s, z: lot.z - lu * s - back * c, yaw: lot.yaw + (rnd() < 0.5 ? 0 : Math.PI / 2), w, d,
      kind: big ? 'barn' : 'shed', style: 'barn', floors: 1, seed: (rnd() * 4294967296) >>> 0, district: lot.district, maxRise: 3 }, inside);
  }
  function cornerOf(ras, lot) {
    const c = Math.cos(lot.yaw), s = Math.sin(lot.yaw);
    for (const side of [-1, 1]) {
      const u = side * (lot.w / 2 + 3.2), x = lot.x + u * c, z = lot.z - u * s;
      if (ras.get(x, z) === STREET || ras.get(x, z) === SQUARE) return true;
    }
    return false;
  }
  function styleFor(dist, rnd) {
    const style = pick(dist.styles || { baroque: 1 }, rnd());
    const kind = style === 'cottage' || style === 'log' ? 'cottage' : style === 'farm' ? 'house' : 'house';
    return { style, kind };
  }
  function floorsFor(dist, st, rnd) {
    const f = dist.floors || [2, 4];
    let n = f[0] + Math.floor(rnd() * (f[1] - f[0] + 1));
    if (st.style === 'cottage' || st.style === 'log') n = 1;
    if (st.style === 'gothic') n = Math.max(n, 3);
    return n;
  }

  /** Houses facing a square: round its edge (circle) or along its long sides (rect). */
  function squareLots(city, id, R, ras, sq, dist, rnd, inside) {
    phase = 'sq:';
    if (sq.kind === 'circle') {
      const per = 2 * Math.PI * sq.r;
      let a = rnd() * 6.28;
      for (let s = 0; s < per;) {
        const w = dist.front[0] + rnd() * (dist.front[1] - dist.front[0]), d = dist.depth[0] + rnd() * (dist.depth[1] - dist.depth[0]);
        const rr = sq.r + d / 2 + 1.2, aa = a + (s + w / 2) / sq.r;
        const st = styleFor(dist, rnd);
        const o = { x: sq.x + Math.sin(aa) * rr, z: sq.z + Math.cos(aa) * rr, yaw: aa + Math.PI, w, d, district: dist.id, style: st.style, kind: st.kind,
          floors: floorsFor(dist, st, rnd), seed: (rnd() * 4294967296) >>> 0, arcade: !!sq.arcade, maxRise: dist.maxRise };
        const lot = tryLot(city, id, R, ras, o, inside);
        s += lot ? w + 0.2 : 2;
        if (lot && dist.yards && rnd() < dist.yards) backBarn(city, id, R, ras, lot, rnd, inside);
      }
      return;
    }
    const c = Math.cos(sq.yaw), s0 = Math.sin(sq.yaw);
    for (const side of [-1, 1]) {
      const pts = [];
      for (let t = -sq.len / 2; t <= sq.len / 2; t += 4) {
        const u = side * (sq.wid / 2);
        pts.push([sq.x + u * c + t * s0, sq.z - u * s0 + t * c]);
      }
      // the line's half width is 0 here: lots start right at the square's edge
      lineLots(city, id, R, ras, { pts: side > 0 ? pts : pts.slice().reverse(), w: 0.4 }, Object.assign({}, dist, { density: 1 }), rnd, inside);
    }
  }

  function markSquare(ras, sq) {
    const v = sq.green ? GREEN : SQUARE;
    if (sq.kind === 'circle') {
      for (let z = -sq.r; z <= sq.r; z += CELL * 0.7) for (let x = -sq.r; x <= sq.r; x += CELL * 0.7) if (x * x + z * z <= sq.r * sq.r) ras.set(sq.x + x, sq.z + z, v);
      return;
    }
    const c = Math.cos(sq.yaw), s = Math.sin(sq.yaw);
    for (let t = -sq.len / 2; t <= sq.len / 2; t += CELL * 0.7) for (let u = -sq.wid / 2; u <= sq.wid / 2; u += CELL * 0.7) ras.set(sq.x + u * c + t * s, sq.z - u * s + t * c, v);
  }

  /** A landmark at its fixed place (data), levelled on its plot; the raster under it is taken whatever was there. */
  function landmark(city, id, R, ras, L, distId) {
    const size = KIND_SIZE[L.kind] || [10, 12, 2];
    const w = L.w || size[0], d = L.d || size[1];
    const pts = footprint(L.x, L.z, L.yaw || 0, w, d, Math.max(w, d) / 3);
    let lo = Infinity, hi = -Infinity;
    for (const [x, z] of pts) { const h = T.surfaceAt(id, x, z); lo = Math.min(lo, h); hi = Math.max(hi, h); }
    for (const [x, z] of footprint(L.x, L.z, L.yaw || 0, w + 1, d + 1, 1.2)) ras.set(x, z, BUILT);
    return addLandmark(city, { x: L.x, z: L.z, yaw: L.yaw || 0, w, d, y: lo, rise: hi - lo, floors: L.floors || size[2], kind: L.kind,
      style: L.style || (L.kind === 'cathedral' || L.kind === 'tower' || L.kind === 'gatetower' ? 'gothic' : 'baroque'),
      seed: hashSeed(R.seed, city.lots.length * 7919 + 13), district: distId, name: L.name });
  }

  function addLandmark(city, o) { const l = makeLot(city, o); addBox(city, Object.assign({}, l, { w: l.w + 2, d: l.d + 2 })); return l; }

  /* ---------- villages: a round green (okrouhlice) or a street village ---------- */
  function village(city, id, R, ras, V, rnd) {
    const dist = Object.assign({ id: V.id, front: [7, 10], depth: [8, 11], floors: [1, 2], styles: { cottage: 3, log: 2, farm: 2, timber: 1, baroque: 0.6 },
      yards: 0.65, maxRise: 3.5, gap: 2.5 }, V);
    const inside = (x, z) => Math.hypot(x - V.x, z - V.z) < V.r;
    if ((V.plan || 'round') === 'round') {
      const g = { kind: 'circle', x: V.x, z: V.z, r: V.r * 0.42, green: true, name: V.id };
      city.squares.push(g); markSquare(ras, g);
      landmark(city, id, R, ras, { kind: V.church ? 'church' : 'chapel', x: V.x + (rnd() - 0.5) * 4, z: V.z + (rnd() - 0.5) * 4, yaw: rnd() * 6.28, style: 'baroque' }, V.id);
      squareLots(city, id, R, ras, g, dist, rnd, inside);
      const road = { pts: [], w: 5, main: false, district: V.id };
      const a = V.road != null ? V.road : rnd() * 6.28;
      for (let t = g.r; t <= V.r * 1.6; t += 4) road.pts.push([V.x + Math.sin(a) * t, V.z + Math.cos(a) * t]);
      city.streets.push(road); ras.line(road.pts, road.w, STREET);
      lineLots(city, id, R, ras, road, Object.assign({}, dist, { density: 0.7 }), rnd, (x, z) => Math.hypot(x - V.x, z - V.z) < V.r * 1.6);
      return;
    }
    const a = V.yaw || 0, road = { pts: [], w: 6, main: true, district: V.id };
    for (let t = -V.r; t <= V.r; t += 4) road.pts.push([V.x + Math.sin(a) * t, V.z + Math.cos(a) * t]);
    city.streets.push(road); ras.line(road.pts, road.w, STREET);
    landmark(city, id, R, ras, { kind: V.church ? 'church' : 'chapel', x: V.x + Math.cos(a) * 14, z: V.z - Math.sin(a) * 14, yaw: a + Math.PI / 2, style: 'baroque' }, V.id);
    lineLots(city, id, R, ras, road, dist, rnd, (x, z) => Math.hypot(x - V.x, z - V.z) < V.r + 20);
  }

  /* ---------- build ---------- */
  function build(id) {
    if (cache.has(id)) return cache.get(id);
    const R = T.region(id), C = R.city;
    if (!C) { cache.set(id, null); return null; }
    const ras = new Raster(R.radius), rnd = rng0(hashSeed(R.seed, 4241));
    const city = { region: id, lots: [], streets: [], squares: [], districts: C.districts || [], villages: C.villages || [], ras, boxes: new Map() };
    const inDist = dd => (x, z) => {
      if (Math.hypot(x - dd.x, z - dd.z) > dd.r) return false;
      for (const o of city.districts) { if (o === dd) break; if (Math.hypot(x - o.x, z - o.z) < o.r * 0.92) return false; }   // earlier districts win
      return true;
    };
    for (const dd of city.districts) {
      dd.front = dd.front || [6, 10]; dd.depth = dd.depth || [9, 13];
      for (const sq of dd.squares || []) { const s = Object.assign({ kind: sq.len ? 'rect' : 'circle' }, sq); city.squares.push(s); markSquare(ras, s); s.district = dd.id; }
    }
    for (const dd of city.districts) for (const L of dd.landmarks || []) landmark(city, id, R, ras, L, dd.id);
    const lines = [];
    for (const dd of city.districts) for (const st of streetsOf(id, R, dd, rnd)) { lines.push([dd, st]); city.streets.push(st); ras.line(st.pts, st.w, STREET); }
    for (const dd of city.districts) for (const sq of city.squares) if (sq.district === dd.id && !sq.green) squareLots(city, id, R, ras, sq, dd, rnd, inDist(dd));
    phase = '';
    for (const [dd, st] of lines) lineLots(city, id, R, ras, st, dd, rnd, inDist(dd));
    for (const V of city.villages) village(city, id, R, ras, V, rng0(hashSeed(R.seed, V.x * 31 + V.z)));
    // spatial hash for collisions
    const hash = new Map();
    for (const lot of city.lots) {
      const rr = Math.hypot(lot.w, lot.d) / 2 + 2;
      for (let i = Math.floor((lot.x - rr) / HASH); i <= Math.floor((lot.x + rr) / HASH); i++)
        for (let j = Math.floor((lot.z - rr) / HASH); j <= Math.floor((lot.z + rr) / HASH); j++) {
          const k = i * 4096 + j;
          let a = hash.get(k); if (!a) hash.set(k, a = []); a.push(lot);
        }
    }
    city.hash = hash;
    const kinds = {};
    for (const l of city.lots) kinds[l.kind] = (kinds[l.kind] || 0) + 1;
    const styles = {};
    for (const l of city.lots) styles[l.style] = (styles[l.style] || 0) + 1;
    city.info = { lots: city.lots.length, streets: city.streets.length, squares: city.squares.length, kinds, styles };
    cache.set(id, city);
    return city;
  }

  /** Signed distance from (x, z) to a lot's footprint box (< 0 inside) and the outward normal of the nearest side. */
  function sd(lot, x, z) {
    const c = Math.cos(lot.yaw), s = Math.sin(lot.yaw), dx = x - lot.x, dz = z - lot.z;
    const u = dx * c - dz * s, v = dx * s + dz * c, hu = lot.w / 2, hv = lot.d / 2;
    const qu = Math.abs(u) - hu, qv = Math.abs(v) - hv;
    let d, nu = 0, nv = 0;
    if (qu > 0 || qv > 0) { const ou = Math.max(qu, 0), ov = Math.max(qv, 0); d = Math.hypot(ou, ov); nu = ou * Math.sign(u); nv = ov * Math.sign(v); const l = Math.hypot(nu, nv) || 1; nu /= l; nv /= l; }
    else if (qu > qv) { d = qu; nu = Math.sign(u) || 1; } else { d = qv; nv = Math.sign(v) || 1; }
    return { d, nx: nu * c + nv * s, nz: -nu * s + nv * c };
  }
  function near(id, x, z) {
    const city = build(id);
    if (!city) return null;
    return city.hash.get(Math.floor(x / HASH) * 4096 + Math.floor(z / HASH)) || null;
  }
  function solidAt(id, x, z, pad) {
    const list = near(id, x, z);
    if (!list) return null;
    pad = pad || 0;
    let top = null;
    for (const lot of list) if (sd(lot, x, z).d <= pad && (top == null || lot.top > top)) top = lot.top;
    return top;
  }
  function hit(id, x, z, pad) {
    const list = near(id, x, z);
    if (!list) return null;
    pad = pad || 0;
    let best = null;
    for (const lot of list) {
      const s = sd(lot, x, z), depth = pad - s.d;
      if (depth >= 0 && (!best || depth > best.depth)) best = { lot, roof: lot.top, nx: s.nx, nz: s.nz, depth };
    }
    return best;
  }
  function lotsNear(id, x, z, r) {
    const city = build(id);
    return city ? city.lots.filter(l => Math.hypot(l.x - x, l.z - z) < r) : [];
  }
  function placeAt(id, x, z) {
    const R = T.region(id), C = R.city;
    if (!C) return null;
    for (const dd of C.districts || []) if (Math.hypot(x - dd.x, z - dd.z) < dd.r) return dd;
    for (const v of C.villages || []) if (Math.hypot(x - v.x, z - v.z) < v.r) return v;
    return null;
  }
  function pavedAt(id, x, z) {
    const city = build(id);
    if (!city) return 0;
    const v = city.ras.get(x, z);
    return v === STREET ? 1 : v === SQUARE ? 2 : v === GREEN ? 3 : 0;
  }

  M.define('city', { why, build, solidAt, hit, sd, placeAt, pavedAt, lotsNear, STOREY, KIND_SIZE });
})(typeof self !== 'undefined' ? self : this);
