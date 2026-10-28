/*
 * Verdigris campaign - math helpers. Vectors are [x, y, z] arrays, as in mp/sim.js.
 */
(function (root) {
  'use strict';
  const M = typeof module === 'object' && module.exports ? require('./umd.js') : root.VCamp;

  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  const lerp = (a, b, t) => a + (b - a) * t;
  /** Wraps an angle to -PI..PI. */
  const wrap = a => Math.atan2(Math.sin(a), Math.cos(a));
  const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
  /** Horizontal (x, z) distance. */
  const dist2 = (a, b) => Math.hypot(a[0] - b[0], a[2] - b[2]);
  const finite = v => Array.isArray(v) && v.length === 3 && v.every(Number.isFinite);

  /** Forward vector for a yaw / pitch pair (yaw 0 faces +Z). */
  function fwd(yaw, pitch) {
    const c = Math.cos(pitch);
    return [Math.sin(yaw) * c, Math.sin(pitch), Math.cos(yaw) * c];
  }
  function norm(v) {
    const l = Math.hypot(v[0], v[1], v[2]) || 1;
    return [v[0] / l, v[1] / l, v[2] / l];
  }

  /** Seeded RNG (mulberry32): returns a function giving numbers in [0, 1). */
  function mulberry(seed) {
    let a = seed | 0;
    return () => {
      a = a + 0x6D2B79F5 | 0;
      let t = Math.imul(a ^ a >>> 15, 1 | a);
      t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
      return ((t ^ t >>> 14) >>> 0) / 4294967296;
    };
  }
  const range = (rng, a, b) => a + (b - a) * rng();
  const int = (rng, a, b) => a + Math.floor(rng() * (b - a + 1));

  M.define('math', { clamp, lerp, wrap, dist, dist2, finite, fwd, norm, mulberry, range, int });
})(typeof self !== 'undefined' ? self : this);
