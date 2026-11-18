/*
 * Verdigris campaign - the basic blocks of a region as collision shapes (Phase 4 T01, ?debug tools).
 *
 * list(regionId, town) -> [shape]: every solid or walkable block of the region, once, with where its data comes from:
 *   { kind: 'lot' | 'building' | 'deck' | 'plateau', id, src, place, name?, solid, ref,
 *     shape: { type: 'box', x, z, w, d, yaw } | { type: 'cyl', x, z, r } | { type: 'capsule', seg: [x0, z0, x1, z1], r },
 *     y0, y1,            // bottom and top of the solid (y1 = the roof or walk top the dragon meets)
 *     top }              // the walkable top (wall walk, bastion, bridge deck, plateau) or null
 *   lot: a house of Prahold or a village (core/city.js), a box; building: a settlement or castle piece (core/settlement.js),
 *   a cylinder, palisade and wall pieces a capsule (solid: false while burned to a ruin or an open gate); deck: a bridge
 *   (terrain feature); plateau: the flat ground under a settlement (terrain feature, not a solid).
 * sd(s, x, z) -> signed distance to the footprint (< 0 inside), the same maths the collisions use.
 * at(shapes, x, z, pad) -> the shapes whose footprint holds (x, z).
 * pick(regionId, shapes, origin, dir, max) -> nearest hit along a ray: { t, pos, shape } (shape null = the ground) or null.
 * probe(regionId, x, z, town) -> the core queries under a point (surface, height, mesh, deck, liquid, paved, road, ...).
 * card(regionId, s) -> plain lines describing a shape for the object card.
 * Pure: no DOM, no THREE (render/debug-shapes.js draws them).
 */
(function (root) {
  'use strict';
  const M = (typeof module === 'object' && module.exports) ? require('./umd.js') : root.VCamp;
  const D = M.need('data'), T = M.need('terrain'), SE = M.need('settlement'), CI = M.need('city');

  function list(regionId, town) {
    const R = T.region(regionId), out = [];
    const F = R.terrain.features;
    F.forEach((f, i) => {
      if (f.type === 'bridge') {
        const d = T.deckAt(regionId, f.x, f.z);
        const y = d ? d.y : T.surfaceAt(regionId, f.x, f.z);
        out.push({ kind: 'deck', id: 'deck' + i, src: 'region ' + regionId + ' feature ' + i + ' (bridge' + (f.kind ? ' ' + f.kind : '') + ')',
          place: null, name: f.name || null, solid: false, ref: f,
          shape: { type: 'box', x: f.x, z: f.z, w: f.width, d: f.len, yaw: f.yaw }, y0: y - 1.5, y1: y, top: y });
      } else if (f.type === 'plateau') {
        const y = T.heightAt(regionId, f.x, f.z);
        out.push({ kind: 'plateau', id: 'plateau' + i, src: 'region ' + regionId + ' feature ' + i + ' (plateau' + (f.at ? ' at ' + f.at : '') + ')',
          place: f.at || null, name: f.at || null, solid: false, ref: f,
          shape: { type: 'cyl', x: f.x, z: f.z, r: f.r }, y0: y - 0.5, y1: y, top: y });
      }
    });
    if (town) {
      const places = {};
      for (const pl of town.places) places[pl.id] = pl;
      for (const b of town.buildings) {
        const B = D.buildings[b.type] || {}, pl = places[b.place];
        const shape = b.seg ? { type: 'capsule', seg: b.seg.slice(), r: b.r } : { type: 'cyl', x: b.pos[0], z: b.pos[2], r: b.r };
        out.push({ kind: 'building', id: b.id, src: 'settlement ' + b.place + (pl && pl.name ? ' (' + pl.name + ')' : '') + ', ' + b.type + (pl && pl.castle ? ', castle kit' : ''),
          place: b.place, name: b.type, solid: !b.ruin && !(b.gate && !town.gateClosed), ref: b,
          shape, y0: b.pos[1], y1: SE.topOf(b), top: B.walkTop != null ? SE.topOf(b) : null });
      }
    }
    const city = R.city ? CI.build(regionId) : null;
    if (city) for (const l of city.lots) {
      out.push({ kind: 'lot', id: 'lot' + l.id, src: 'city ' + regionId + ' lot ' + l.id + (l.district ? ' district ' + l.district : ' village'),
        place: l.district, name: l.name || l.kind, solid: true, ref: l,
        shape: { type: 'box', x: l.x, z: l.z, w: l.w, d: l.d, yaw: l.yaw }, y0: l.y, y1: l.top, top: null });
    }
    return out;
  }

  /** Signed distance to the footprint (< 0 inside): city lots and buildings by their own module's sd. */
  function sd(s, x, z) {
    if (s.kind === 'lot') return CI.sd(s.ref, x, z).d;
    if (s.kind === 'building') return SE.sd(s.ref, x, z).d;
    const q = s.shape;
    if (q.type === 'cyl') return Math.hypot(x - q.x, z - q.z) - q.r;
    // a deck box: the deck test of terrain.deckAt (u across = w, v along = d)
    const dx = x - q.x, dz = z - q.z, sn = Math.sin(q.yaw), c = Math.cos(q.yaw);
    const v = dx * sn + dz * c, u = dx * c - dz * sn;
    const qu = Math.abs(u) - q.w / 2, qv = Math.abs(v) - q.d / 2;
    return qu > 0 || qv > 0 ? Math.hypot(Math.max(qu, 0), Math.max(qv, 0)) : Math.max(qu, qv);
  }

  /** Centre and bounding radius of a footprint. */
  function bound(s) {
    const q = s.shape;
    if (q.type === 'capsule') return { x: (q.seg[0] + q.seg[2]) / 2, z: (q.seg[1] + q.seg[3]) / 2, r: Math.hypot(q.seg[2] - q.seg[0], q.seg[3] - q.seg[1]) / 2 + q.r };
    if (q.type === 'cyl') return { x: q.x, z: q.z, r: q.r };
    return { x: q.x, z: q.z, r: Math.hypot(q.w, q.d) / 2 };
  }

  function at(shapes, x, z, pad) {
    pad = pad || 0;
    return shapes.filter(s => { const b = bound(s); return Math.hypot(x - b.x, z - b.z) <= b.r + pad + 1 && sd(s, x, z) <= pad; });
  }

  function near(shapes, x, z, r) {
    return shapes.filter(s => { const b = bound(s); return Math.hypot(x - b.x, z - b.z) <= b.r + r; });
  }

  /** Is the point (x, y, z) inside the shape's volume? Solids from y0 to y1; plateaus and decks count as their top slab. */
  function inside(s, x, y, z) {
    return y >= s.y0 - 0.05 && y <= s.y1 + 0.05 && sd(s, x, z) <= 0;
  }

  /**
   * Nearest hit along the ray origin + dir * t (dir normalised, t up to max): the ground (terrain.surfaceAt, decks
   * included) or a shape's volume. Shapes whose bounds the ray does not pass are skipped. Returns { t, pos, shape } or null.
   */
  function pick(regionId, shapes, origin, dir, max) {
    max = max || 1500;
    const [ox, oy, oz] = origin, [dx, dy, dz] = dir;
    // ground: march, then bisect
    let tg = null, prev = 0;
    const STEP = 2;
    for (let t = 0; t <= max; t += STEP) {
      const x = ox + dx * t, y = oy + dy * t, z = oz + dz * t;
      if (Math.hypot(x, z) > T.region(regionId).radius + 50) break;
      if (y <= T.surfaceAt(regionId, x, z)) {
        let a = prev, b = t;
        for (let k = 0; k < 20; k++) { const m = (a + b) / 2; if (oy + dy * m <= T.surfaceAt(regionId, ox + dx * m, oz + dz * m)) b = m; else a = m; }
        tg = b; break;
      }
      prev = t;
    }
    const lim = tg != null ? tg : max;
    // shapes: closest approach in plan, then a fine march over the stretch inside the bound
    const hz = Math.hypot(dx, dz) || 1e-9;
    let best = null;
    for (const s of shapes) {
      if (s.kind === 'plateau') continue;          // ground, found by the ground march
      const b = bound(s);
      const tc = ((b.x - ox) * dx + (b.z - oz) * dz) / (hz * hz);
      const cx = ox + dx * tc, cz = oz + dz * tc;
      const off = Math.hypot(cx - b.x, cz - b.z);
      if (off > b.r + 0.5 && hz > 1e-6) continue;
      const half = hz > 1e-6 ? Math.sqrt(Math.max(0, (b.r + 0.5) ** 2 - off * off)) / hz : lim;
      const t0 = Math.max(0, hz > 1e-6 ? tc - half : 0), t1 = Math.min(lim, best ? best.t : lim, hz > 1e-6 ? tc + half : lim);
      for (let t = t0; t <= t1; t += 0.25) {
        if (inside(s, ox + dx * t, oy + dy * t, oz + dz * t)) { best = { t, shape: s }; break; }
      }
    }
    if (best && (tg == null || best.t <= tg)) return { t: best.t, pos: [ox + dx * best.t, oy + dy * best.t, oz + dz * best.t], shape: best.shape };
    if (tg != null) {
      const pos = [ox + dx * tg, oy + dy * tg, oz + dz * tg];
      const top = at(shapes, pos[0], pos[2]).filter(s => s.kind === 'deck' || s.kind === 'plateau');
      return { t: tg, pos, shape: null, under: top[0] || null };
    }
    return null;
  }

  /** The core queries under (x, z): what a dragon or a hero standing there meets. */
  function probe(regionId, x, z, town) {
    const R = T.region(regionId), deck = T.deckAt(regionId, x, z), pl = T.plateauAt(regionId, x, z);
    const fld = (R.flora && R.flora.fields) ? T.fieldAt(regionId, x, z) : null;
    const zone = T.cityAt(regionId, x, z);
    const roof = town ? SE.solidAt(town, x, z, 0) : null, city = R.city ? CI.solidAt(regionId, x, z, 0) : null;
    const water = T.riverAt(regionId, x, z);
    return {
      surface: T.surfaceAt(regionId, x, z), height: T.heightAt(regionId, x, z), mesh: T.meshAt(regionId, x, z),
      deck: deck ? deck.y : null, water: water ? water.level : null, liquid: !!T.liquidAt(regionId, x, z),
      dry: T.dryAt(regionId, x, z), paved: R.city ? CI.pavedAt(regionId, x, z) : 0,
      road: T.lineDist(regionId, 'road', x, z), plateau: pl ? (pl.at || 'yes') : null, field: fld ? (fld.id != null ? fld.id : 'yes') : null,
      zone: zone ? zone.id || zone.name || 'yes' : null, slope: T.slopeAt(regionId, x, z),
      roof: roof == null ? city : city == null ? roof : Math.max(roof, city),
      walkTop: town ? SE.surfaceAt(town, x, z) : null,
    };
  }

  const PAVED = ['-', 'street', 'square', 'green'];
  /** Text lines for the probe readout. */
  function probeLines(p) {
    const f = v => v == null ? '-' : typeof v === 'number' ? v.toFixed(1) : String(v);
    return ['surface ' + f(p.surface) + '  height ' + f(p.height) + '  mesh ' + f(p.mesh) + '  slope ' + p.slope.toFixed(2),
      'deck ' + f(p.deck) + '  water ' + f(p.water) + (p.liquid ? '  LIQUID' : '') + (p.dry ? '  dry' : '  wet') + '  paved ' + PAVED[p.paved || 0],
      'road ' + (isFinite(p.road) ? p.road.toFixed(1) : '-') + '  plateau ' + f(p.plateau) + '  field ' + f(p.field) + '  zone ' + f(p.zone),
      'roof ' + f(p.roof) + '  walk top ' + f(p.walkTop)];
  }

  function card(regionId, s) {
    const f1 = v => v.toFixed(1), q = s.shape, b = bound(s), g = T.surfaceAt(regionId, b.x, b.z);
    const size = q.type === 'box' ? f1(q.w) + ' x ' + f1(q.d) : q.type === 'cyl' ? 'r ' + f1(q.r) : 'len ' + f1(Math.hypot(q.seg[2] - q.seg[0], q.seg[3] - q.seg[1])) + ' r ' + f1(q.r);
    const L = [s.kind + '  ' + s.id + (s.name ? '  ' + s.name : ''), s.src,
      q.type + ' ' + size + '  h ' + f1(s.y1 - s.y0) + '  at x ' + f1(b.x) + ' z ' + f1(b.z),
      'ground ' + f1(g) + '  bottom ' + f1(s.y0) + '  top ' + f1(s.y1) + (s.top != null ? '  WALK TOP ' + f1(s.top) : '')];
    const r = s.ref;
    if (s.kind === 'building') L.push('hp ' + Math.round(r.hp) + (r.fire > 0 ? '  BURNING' : '') + (r.ruin ? '  RUIN' : '') + (r.char ? '  CHARRED' : '') + (r.gate ? '  gate' : '') + (s.solid ? '  solid' : '  NOT SOLID'));
    if (s.kind === 'lot') L.push(r.style + ' ' + r.kind + '  floors ' + r.floors + (r.corner ? '  corner' : '') + (r.arcade ? '  arcade' : ''));
    L.push(s.kind === 'deck' || s.kind === 'plateau' ? 'collides: ground (walk, land, hero stands on the top)'
      : s.top != null ? 'collides: solid, the dragon and hero can stand on the walk top' : 'collides: solid, pushed out at its side');
    return L;
  }

  M.define('shapes', { list, sd, bound, at, near, inside, pick, probe, probeLines, card });
})(typeof self !== 'undefined' ? self : this);
