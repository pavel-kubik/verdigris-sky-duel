// Shared test helpers for campaign/test/*.test.js (same style as mp/sim.test.js).
'use strict';
const assert = require('assert');

const counter = { checks: 0 };
function ok(cond, msg) { assert.ok(cond, msg); counter.checks++; }
function near(a, b, eps, msg) { ok(Math.abs(a - b) <= (eps == null ? 1e-9 : eps), (msg || 'near') + ': ' + a + ' vs ' + b); }

module.exports = { ok, near, counter, core: name => require('../core/umd.js').need(name) };
