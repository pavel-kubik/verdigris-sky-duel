// Quality tiers (T102): tier choice from URL / stored / device, the touch fps auto tier and the settings per tier.
'use strict';
const { ok, near, core } = require('./harness.js');
const Q = core('quality'), D = core('data');

// 1. Choice: URL beats stored, stored beats device default, touch without a choice measures
{
  ok(Q.pick({ param: 'low', stored: 'high', isTouch: true }).tier === 'low', 'url wins');
  ok(Q.pick({ param: 'low' }).source === 'url', 'url source');
  const s = Q.pick({ stored: 'low', isTouch: false });
  ok(s.tier === 'low' && s.source === 'stored' && !s.auto, 'stored choice used');
  const t = Q.pick({ isTouch: true });
  ok(t.auto && t.tier === D.quality.defaultTouch && t.source === 'auto', 'touch without a choice: auto, starts at the touch default');
  const d = Q.pick({ isTouch: false });
  ok(!d.auto && d.tier === 'high' && d.source === 'default', 'desktop default high, no measuring');
  const a = Q.pick({ param: 'auto', stored: 'high', isTouch: false });
  ok(a.auto && a.tier === 'high', '?q=auto measures even with a stored tier');
  ok(!Q.pick({ param: 'ultra', stored: 'bogus', isTouch: true }).tier.includes('ultra'), 'unknown values ignored');
  ok(Q.pick({ param: 'ultra', stored: 'mid' }).tier === 'mid', 'unknown url value falls back to stored');
  ok(!Q.valid('toString') && !Q.valid('__proto__'), 'no prototype keys as tiers');
}

// 2. fps -> tier thresholds
{
  const a = D.quality.auto;
  ok(Q.tierFor(a.low - 1) === 'low', 'slow -> low');
  ok(Q.tierFor(a.low) === 'mid', 'at the low threshold -> mid');
  ok(Q.tierFor(a.high - 0.1) === 'mid', 'just under high -> mid');
  ok(Q.tierFor(a.high) === 'high', 'fast -> high');
}

// 3. Sampler: warm-up skipped, one decision after `sample` s, then silent
{
  const a = D.quality.auto, s = Q.sampler();
  let got = null, n = 0;
  // 2 s of a hitch at 5 fps (warm-up, ignored), then steady 20 fps
  for (let t = 0; t < a.warmup; t += 0.2) { ok(Q.sample(s, 0.2) === null, 'warm-up gives no tier'); }
  while (got === null && n < 10000) { got = Q.sample(s, 1 / 20); n++; }
  ok(got === 'low', '20 fps -> low');
  near(s.fps, 20, 0.5, 'measured fps');
  near(n / 20, a.sample, 0.2, 'decided after the sample window');
  ok(Q.sample(s, 1 / 20) === null && s.done, 'decides only once');
  const f = Q.sampler(); let g = null;
  while (g === null) g = Q.sample(f, 1 / 60);
  ok(g === 'high', '60 fps -> high');
  const z = Q.sampler();
  ok(Q.sample(z, 0) === null && z.t === 0, 'paused frames (dt 0) do not count');
}

// 4. Settings: low halves flora against mid and caps the pixel ratio; fog follows `far`
{
  const fog = { near: 400, far: 950 };
  const lo = Q.settings('low', 3, fog), mid = Q.settings('mid', 3, fog), hi = Q.settings('high', 3, fog);
  near(lo.flora, mid.flora / 2, 1e-9, 'low halves the flora of mid');
  ok(hi.flora === 1 && mid.flora === 0.5, 'high = full forest, mid = the old touch half');
  ok(lo.pixelRatio === 1 && mid.pixelRatio === 1.5 && hi.pixelRatio === 2, 'pixel ratio caps');
  ok(Q.settings('high', 1, fog).pixelRatio === 1, 'never above the device ratio');
  ok(lo.fogFar < mid.fogFar && mid.fogFar === 950, 'low pulls the fog in');
  ok(lo.particles < mid.particles, 'low thins the breath particles');
  ok(Q.settings('nope', 2, fog).flora === 1, 'unknown tier -> desktop default');
}

// 5. Debug cycle
{
  ok(Q.next('low') === 'mid' && Q.next('mid') === 'high' && Q.next('high') === 'low', 'cycle low -> mid -> high -> low');
}
