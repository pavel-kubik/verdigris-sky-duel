/*
 * Verdigris campaign - graphics quality tiers (Phase 2 T02).
 * Pure: picks a tier from the URL (?q=low|mid|high|auto), the stored choice and the device,
 * measures fps for the auto tier on touch and turns a tier into renderer settings.
 *   pick({ param, stored, isTouch }) -> { tier, source: 'url' | 'stored' | 'auto' | 'default', auto }
 *   sampler() -> s ; sample(s, dt) -> tier | null   (null while warming up / measuring; the tier once, then null)
 *   tierFor(fps) -> tier ; settings(tier, dpr, fog) -> { flora, pixelRatio, fogNear, fogFar }
 *   next(tier) -> the next tier in low -> mid -> high -> low (debug cycle)
 * Tunables: data.quality.
 */
(function (root) {
  'use strict';
  const M = typeof module === 'object' && module.exports ? require('./umd.js') : root.VCamp;
  const D = M.need('data');
  const Q = () => D.quality;

  const valid = id => !!(id && Object.prototype.hasOwnProperty.call(Q().tiers, id));

  /** URL beats the stored choice; ?q=auto (or no choice yet on touch) measures fps first. */
  function pick(o) {
    const q = Q(), param = o && o.param, stored = o && o.stored, isTouch = !!(o && o.isTouch);
    if (valid(param)) return { tier: param, source: 'url', auto: false };
    const fallback = isTouch ? q.defaultTouch : q.defaultDesktop;
    if (param === 'auto') return { tier: fallback, source: 'auto', auto: true };
    if (valid(stored)) return { tier: stored, source: 'stored', auto: false };
    if (isTouch) return { tier: fallback, source: 'auto', auto: true };
    return { tier: fallback, source: 'default', auto: false };
  }

  function tierFor(fps) {
    const a = Q().auto;
    if (!(fps >= 0)) return Q().defaultTouch;
    if (fps < a.low) return 'low';
    if (fps >= a.high) return 'high';
    return 'mid';
  }

  function sampler() { return { t: 0, frames: 0, time: 0, done: false, fps: null }; }

  /** Feed every rendered frame's dt; skips `auto.warmup` s, then averages fps over `auto.sample` s. */
  function sample(s, dt) {
    if (s.done || !(dt > 0)) return null;
    const a = Q().auto;
    s.t += dt;
    if (s.t <= a.warmup) return null;
    s.frames++; s.time += dt;
    if (s.time < a.sample) return null;
    s.done = true;
    s.fps = s.frames / s.time;
    return tierFor(s.fps);
  }

  function settings(tier, dpr, fog) {
    const T = Q().tiers[valid(tier) ? tier : Q().defaultDesktop];
    const f = fog || { near: 400, far: 950 };
    return {
      flora: T.flora,
      pixelRatio: Math.max(1, Math.min(dpr || 1, T.pixelRatio)),
      fogNear: f.near * T.far,
      fogFar: f.far * T.far,
      particles: T.particles,
    };
  }

  function next(tier) {
    const o = Q().order, i = o.indexOf(tier);
    return o[(i + 1) % o.length];
  }

  M.define('quality', { valid, pick, tierFor, sampler, sample, settings, next });
})(typeof self !== 'undefined' ? self : this);
