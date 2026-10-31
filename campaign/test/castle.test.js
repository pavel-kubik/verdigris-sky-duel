// Castle (Phase 3 T01): castle data, layout from the wall polygon (corners, wall runs, gate gap, inner buildings),
// and static checks on the castle kit and the preview page. The kit's draw call and triangle budgets are checked
// in the browser (preview readout).
'use strict';
const fs = require('fs');
const path = require('path');
const { ok, near, core } = require('./harness.js');
const D = core('data'), CA = core('castle');
const root = path.join(__dirname, '..', '..');
const read = f => fs.readFileSync(path.join(root, f), 'utf8');

/* data */
const def = D.settlements.castle, B = D.buildings;
ok(def.walls.length === def.corners.length && def.walls.length >= 6, 'one corner piece per wall point');
for (const t of def.corners) ok(B[t] && B[t].stone, 'corner piece ' + t + ' is a stone building');
for (const [t] of def.buildings) ok(!!B[t], 'castle building type ' + t + ' exists');
ok(B.wall.wall && B.wall.walkTop < B.wall.h && B.bastion.walkTop <= B.bastion.h, 'walk tops below the piece tops');
ok(B.chapel.spireH > B.keep.h && B.chapel.spires === 2, 'twin spires are the tallest point');
ok(D.castle.lod.near < D.castle.lod.far && D.castle.lights.torches > 0, 'lod and lights tunables');

/* layout */
const L = CA.layout();
ok(L.corners.length === def.walls.length && L.segments.length === def.walls.length, 'a wall run between every two corners');
const gates = L.segments.filter(s => s.gate);
ok(gates.length === 1, 'exactly one gate run');
ok(def.corners[gates[0].from] === 'gatehouse' && def.corners[gates[0].to] === 'gatehouse', 'the gate run is between the two gatehouses');
ok(gates[0].len > D.castle.gate.w, 'the gate gap fits between the gatehouses: ' + gates[0].len.toFixed(1));
const mid = (s) => [(s.a[0] + s.b[0]) / 2, (s.a[1] + s.b[1]) / 2];
ok(mid(gates[0])[0] > 50, 'the gate is on the land side (+X, east)');
for (const s of L.segments) {
  ok(s.len > 5, 'wall run ' + s.from + '-' + s.to + ' is longer than its corners: ' + s.len.toFixed(1));
  near(Math.hypot(Math.sin(s.yaw), Math.cos(s.yaw)), 1, 1e-9, 'yaw is a direction');
  const dx = s.b[0] - s.a[0], dz = s.b[1] - s.a[1];
  near(Math.atan2(dx, dz), s.yaw, 1e-9, 'yaw points along the run');
  // outer face = local +X = (cos yaw, -sin yaw): points away from the centre
  const [mx, mz] = mid(s), ox = Math.cos(s.yaw), oz = -Math.sin(s.yaw);
  ok((mx - L.centre[0]) * ox + (mz - L.centre[1]) * oz > 0, 'outer face of run ' + s.from + ' faces outward');
}
for (const c of L.corners) {
  const ox = Math.sin(c.yaw), oz = Math.cos(c.yaw);
  ok((c.x - L.centre[0]) * ox + (c.z - L.centre[1]) * oz > 0, c.type + ' at ' + c.x + ',' + c.z + ' points outward');
}
for (const b of L.buildings) {
  ok(CA.inside(null, b.x, b.z), b.type + ' stands inside the walls');
  for (const s of L.segments) {          // footprint clear of the wall runs
    const dx = s.b[0] - s.a[0], dz = s.b[1] - s.a[1], k = Math.max(0, Math.min(1, ((b.x - s.a[0]) * dx + (b.z - s.a[1]) * dz) / (dx * dx + dz * dz)));
    const d = Math.hypot(b.x - s.a[0] - dx * k, b.z - s.a[1] - dz * k);
    ok(d > b.r + D.castle.wallThick / 2 - 0.5, b.type + ' clear of wall run ' + s.from + ': ' + d.toFixed(1));
  }
}
for (let i = 0; i < L.buildings.length; i++) for (let j = i + 1; j < L.buildings.length; j++) {
  const a = L.buildings[i], b = L.buildings[j];
  ok(Math.hypot(a.x - b.x, a.z - b.z) > (a.r + b.r) * 0.85, a.type + ' and ' + b.type + ' do not overlap');
}
ok(!CA.inside(null, 200, 0) && CA.inside(null, 0, 0), 'inside test');
ok(L.radius > 60 && L.radius < 100, 'castle radius ' + L.radius.toFixed(1));

/* kit + preview page (static) */
const kit = read('campaign/render/castle-kit.js'), page = read('campaign/preview/castle.html'), pjs = read('campaign/preview/castle.js');
for (const t of new Set([...def.corners, ...def.buildings.map(b => b[0]), 'wall', 'gate'])) ok(new RegExp('out\\.' + t + ' = ').test(kit), 'kit has a model for ' + t);
ok(!/gl_InstanceID/.test(kit), 'banner shader runs on WebGL1 (no gl_InstanceID)');
const order = ['three.min.js', '../../i18n.js', '../core/umd.js', '../core/data.js', '../core/castle.js', '../render/castle-kit.js', "'castle.js'"];
for (let i = 1; i < order.length; i++) ok(page.indexOf(order[i - 1]) < page.indexOf(order[i]), 'preview loads ' + order[i - 1] + ' before ' + order[i]);
ok(/\?v=/.test(page), 'preview scripts carry the page ?v=');
const gameBuild = /const BUILD = '([^']+)'/.exec(read('campaign/game.js'))[1], pvBuild = /const BUILD = '([^']+)'/.exec(pjs)[1];
ok(gameBuild === pvBuild, 'preview BUILD matches game BUILD: ' + pvBuild + ' / ' + gameBuild);
const sw = read('sw.js');
for (const f of ['campaign/core/castle.js', 'campaign/render/castle-kit.js']) ok(sw.includes("'" + f + "'"), 'sw.js caches ' + f);
const i18n = read('i18n.js');
for (const k of (pjs.match(/'c\.pv\.[A-Za-z]+'/g) || [])) ok(i18n.split(k + ':').length === 3, 'EN and CS text for ' + k);
