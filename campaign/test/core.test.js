// Core plumbing: module registry, math helpers, event bus.
'use strict';
const { ok, near, core } = require('./harness.js');
const umd = require('../core/umd.js');

// Registry: need() loads on demand in Node and returns the same instance every time
{
  const m1 = core('math'), m2 = umd.need('math');
  ok(m1 === m2, 'need returns the registered module');
  let threw = false;
  try { umd.need('does-not-exist'); } catch (_) { threw = true; }
  ok(threw, 'need throws for an unknown module');
}

// Math helpers
{
  const m = core('math');
  near(m.clamp(5, 0, 3), 3); near(m.clamp(-1, 0, 3), 0); near(m.lerp(2, 4, 0.25), 2.5);
  near(m.wrap(Math.PI * 3), Math.PI, 1e-9, 'wrap 3pi');
  near(m.wrap(-Math.PI * 2.5), -Math.PI / 2, 1e-9, 'wrap -2.5pi');
  near(m.dist([0, 0, 0], [3, 4, 0]), 5); near(m.dist2([0, 9, 0], [3, -9, 4]), 5);
  const f = m.fwd(0, 0); near(f[2], 1, 1e-12, 'yaw 0 faces +Z');
  near(Math.hypot(...m.norm([3, 4, 12])), 1, 1e-12, 'norm length');
  ok(m.finite([1, 2, 3]) && !m.finite([1, NaN, 3]) && !m.finite([1, 2]), 'finite');
  // seeded RNG is deterministic and in range
  const a = m.mulberry(42), b = m.mulberry(42);
  for (let i = 0; i < 1000; i++) { const x = a(); ok(x === b() && x >= 0 && x < 1, 'rng deterministic and in [0,1)'); }
  const r = m.mulberry(7);
  for (let i = 0; i < 200; i++) { const k = m.int(r, 3, 5); ok(k >= 3 && k <= 5 && Number.isInteger(k), 'int in range'); }
}

// Event bus
{
  const bus = core('events').createBus();
  const got = [];
  const off = bus.on('prey:eaten', p => got.push(p.food));
  bus.on('*', (type) => got.push(type));
  bus.on('prey:eaten', () => { throw new Error('listener failure must not escape'); });
  const err = console.error; console.error = () => {};
  bus.emit('prey:eaten', { food: 30 });
  off();
  bus.emit('prey:eaten', { food: 20 });
  console.error = err;
  ok(got[0] === 30 && got[1] === 'prey:eaten' && got[2] === 'prey:eaten' && got.length === 3, 'bus delivers, unsubscribes, survives throwing listeners');
}
