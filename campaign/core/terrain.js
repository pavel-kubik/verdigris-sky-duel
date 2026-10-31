/*
 * Verdigris campaign - region terrain as a pure height function.
 * The renderer meshes exactly this function, and flight, prey and the lair query it,
 * so what the player sees and what the simulation collides with stay the same.
 *
 * Height = base noise (the duel's H() formula, phase-shifted by the region seed, scaled by amp)
 *        + features (volcano cone with crater, flatten)
 *        + a rugged boundary ridge just beyond the region edge.
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
    const r = D.regions[id];
    if (!r) throw new Error('VCamp terrain: unknown region "' + id + '"');
    return r;
  }

  const smooth = t => t * t * (3 - 2 * t);

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

  /** Noise, volcano cones and the flatten ring: the ground before roads, rivers and plateaus. */
  function baseHeight(id, x, z) {
    const R = region(id), T = R.terrain;
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
      plateauY.set(key, y);
    }
    return y;
  }

  function heightAt(id, x, z) {
    const R = region(id), F = R.terrain.features;
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
    const r = Math.hypot(x, z);
    if (r > R.radius - RIM_START) {
      // boundary ridge: rises over RIM_WIDTH to RIM_HEIGHT, with its own rugged noise so the skyline is not flat
      const k = smooth(clamp((r - (R.radius - RIM_START)) / RIM_WIDTH, 0, 1));
      h += k * (RIM_HEIGHT + 40 * Math.sin(x * 0.013 + z * 0.007 + R.seed) * Math.cos(z * 0.011 - x * 0.005));
    }
    return h;
  }

  /** Distance from (x, z) to the nearest centre line of a feature type ('road' | 'river'), Infinity if none. */
  function lineDist(id, type, x, z) {
    let d = Infinity;
    for (const f of region(id).terrain.features) if (f.type === type) d = Math.min(d, nearestOn(f.points, x, z).d);
    return d;
  }

  /** The river whose channel holds (x, z): { f, level } or null. */
  function riverAt(id, x, z) {
    const R = region(id);
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

  /**
   * Height of the drawn surface: heightAt sampled on the GRID corners and interpolated over the same
   * two triangles per cell the renderer uses (split along the cell's 10-01 diagonal).
   * Collision and placement use this, so nothing floats above or sinks into the visible mesh.
   */
  function surfaceAt(id, x, z) {
    const i = Math.floor(x / GRID), j = Math.floor(z / GRID);
    const x0 = i * GRID, z0 = j * GRID, u = (x - x0) / GRID, v = (z - z0) / GRID;
    if (u + v <= 1) {
      const h00 = heightAt(id, x0, z0);
      return h00 + (heightAt(id, x0 + GRID, z0) - h00) * u + (heightAt(id, x0, z0 + GRID) - h00) * v;
    }
    const h11 = heightAt(id, x0 + GRID, z0 + GRID);
    return h11 + (heightAt(id, x0, z0 + GRID) - h11) * (1 - u) + (heightAt(id, x0 + GRID, z0) - h11) * (1 - v);
  }

  /** Approximate slope (rise per unit) from central differences. */
  function slopeAt(id, x, z, e) {
    e = e || 2;
    const dx = heightAt(id, x + e, z) - heightAt(id, x - e, z);
    const dz = heightAt(id, x, z + e) - heightAt(id, x, z - e);
    return Math.hypot(dx, dz) / (2 * e);
  }

  /** Keeps pos inside the region radius and between ground + minAlt and the ceiling (mutates pos). */
  function clampToRegion(id, pos, minAlt) {
    const R = region(id);
    const r = Math.hypot(pos[0], pos[2]);
    if (r > R.radius) { pos[0] *= R.radius / r; pos[2] *= R.radius / r; }
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
    for (const f of R.terrain.features) {
      if (f.type !== 'cone' || !f.crater) continue;
      if (Math.hypot(x - f.x, z - f.z) < f.crater.r && surfaceAt(id, x, z) < lavaLevel(id)) return 'lava';
    }
    for (const w of R.water || []) if (Math.hypot(x - w.x, z - w.z) < w.r) return 'water';
    const rv = riverAt(id, x, z);
    if (rv && surfaceAt(id, x, z) < rv.level) return 'water';
    if (R.waterLevel != null && surfaceAt(id, x, z) < R.waterLevel) return 'water';
    return null;
  }

  /** Dry ground for animals and trees: no liquid and at least SHORE above the water it borders. */
  const SHORE = 1.6;
  function dryAt(id, x, z) {
    const R = region(id), h = surfaceAt(id, x, z);
    if (R.waterLevel != null && h < R.waterLevel + SHORE) return false;
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
      if (Math.hypot(c.x, c.z) > R.radius - FIELD.edgePad) return false;
      for (const o of out) if (Math.hypot(o.x - c.x, o.z - c.z) < rr + Math.hypot(o.w, o.l) / 2 * 0.8 + FIELD.gap) return false;
      for (const [x, z] of corners(c)) {
        if (!dryAt(id, x, z) || plateauAt(id, x, z, FIELD.plateauPad)) return false;
        if (lineDist(id, 'road', x, z) < FIELD.roadPad + 4) return false;
        for (const f of R.terrain.features) if (f.type === 'river' && nearestOn(f.points, x, z).d < f.width / 2 * CHANNEL + FIELD.riverPad) return false;
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

  M.define('terrain', { GRID, CHUNK, heightAt, baseHeight, nearestOn, lineDist, riverAt, plateauAt, dryAt, fields, fieldAt, riverLevel: (id, f) => riverLevel(region(id), f), surfaceAt, slopeAt, surfaceSlope, liquidAt, clampToRegion, lairPos, lavaLevel, region, noise });
})(typeof self !== 'undefined' ? self : this);
