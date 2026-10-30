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

  function heightAt(id, x, z) {
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
    const r = Math.hypot(x, z);
    if (r > R.radius - RIM_START) {
      // boundary ridge: rises over RIM_WIDTH to RIM_HEIGHT, with its own rugged noise so the skyline is not flat
      const k = smooth(clamp((r - (R.radius - RIM_START)) / RIM_WIDTH, 0, 1));
      h += k * (RIM_HEIGHT + 40 * Math.sin(x * 0.013 + z * 0.007 + R.seed) * Math.cos(z * 0.011 - x * 0.005));
    }
    return h;
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

  M.define('terrain', { GRID, CHUNK, heightAt, surfaceAt, slopeAt, clampToRegion, lairPos, lavaLevel, region, noise });
})(typeof self !== 'undefined' ? self : this);
