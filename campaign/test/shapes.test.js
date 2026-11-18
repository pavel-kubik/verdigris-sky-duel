// Phase 4 T01: the region's basic blocks as one shape list (core/shapes.js) - every lot, settlement piece and deck once,
// the shapes agree with the collision queries at sampled points, the ray pick finds the nearest object, the ground probe
// returns the core queries, and the debug overlay is only built with ?debug.
'use strict';
const fs = require('fs');
const path = require('path');
const { ok, near, core } = require('./harness.js');
const D = core('data'), T = core('terrain'), SE = core('settlement'), CI = core('city'), SH = core('shapes'), CA = core('castle');

const EPS = 1e-6;
for (const id of Object.keys(D.regions)) {
  const R = D.regions[id];
  const town = SE.build(id, {});
  const L = SH.list(id, town);
  const ids = new Set(L.map(s => s.kind + ':' + s.id));
  ok(ids.size === L.length, id + ': every shape once (' + L.length + ')');

  // every lot, settlement piece and deck appears once
  const city = R.city ? CI.build(id) : null;
  const lots = L.filter(s => s.kind === 'lot'), bs = L.filter(s => s.kind === 'building'), decks = L.filter(s => s.kind === 'deck');
  ok(lots.length === (city ? city.lots.length : 0), id + ': every city lot listed (' + lots.length + ')');
  ok(new Set(lots.map(s => s.ref)).size === lots.length, id + ': no lot twice');
  ok(bs.length === town.buildings.length && new Set(bs.map(s => s.ref)).size === bs.length, id + ': every settlement piece once (' + bs.length + ')');
  ok(decks.length === R.terrain.features.filter(f => f.type === 'bridge').length, id + ': every bridge deck once');
  ok(L.every(s => s.src && s.src.length > 4), id + ': every shape names its data source');

  // sampled points inside and outside each solid agree with solidAt / hit
  const solids = L.filter(s => s.solid && (s.kind === 'lot' || s.kind === 'building'));
  const roofAt = (x, z) => { const a = SE.solidAt(town, x, z, 0), b = city ? CI.solidAt(id, x, z, 0) : null; return a == null ? b : b == null ? a : Math.max(a, b); };
  let checked = 0, bad = 0, firstBad = '';
  const step = Math.max(1, Math.floor(solids.length / 400));
  for (let k = 0; k < solids.length; k += step) {
    const s = solids[k], b = SH.bound(s);
    const pts = [[b.x, b.z]];
    if (s.shape.type === 'capsule') pts.push([s.shape.seg[0], s.shape.seg[1]], [s.shape.seg[2], s.shape.seg[3]]);
    for (let a = 0; a < 8; a++) pts.push([b.x + Math.sin(a * Math.PI / 4) * (b.r + 1.5), b.z + Math.cos(a * Math.PI / 4) * (b.r + 1.5)]);
    for (const [x, z] of pts) {
      const want = SH.at(L, x, z).filter(o => o.solid && (o.kind === 'lot' || o.kind === 'building')).reduce((m, o) => m == null || o.y1 > m ? o.y1 : m, null);
      const got = roofAt(x, z);
      checked++;
      if ((want == null) !== (got == null) || (want != null && Math.abs(want - got) > EPS)) { bad++; if (!firstBad) firstBad = s.id + ' at ' + x.toFixed(1) + ',' + z.toFixed(1) + ' want ' + want + ' got ' + got; }
      const pad = 2, hs = SE.hit(town, x, z, pad), hl = city ? CI.hit(id, x, z, pad) : null;
      const wantHit = SH.at(L, x, z, pad).some(o => o.solid && (o.kind === 'lot' || o.kind === 'building'));
      if (wantHit !== !!(hs || hl)) { bad++; if (!firstBad) firstBad = 'hit ' + s.id + ' at ' + x.toFixed(1) + ',' + z.toFixed(1); }
    }
  }
  ok(checked > 0 || !solids.length, id + ': sampled ' + checked + ' points');
  ok(bad === 0, id + ': the shapes agree with solidAt / hit at every sampled point (' + bad + ' off; ' + firstBad + ')');

  // decks agree with deckAt (inside: same height; just outside: none)
  for (const s of decks) {
    const q = s.shape, d = T.deckAt(id, q.x, q.z);
    ok(d && Math.abs(d.y - s.top) < EPS, id + ' ' + s.id + ': deck height = deckAt');
    const ax = Math.cos(q.yaw), az = -Math.sin(q.yaw);          // across the deck
    ok(!T.deckAt(id, q.x + ax * (q.w / 2 + 1), q.z + az * (q.w / 2 + 1)) || SH.at(decks, q.x + ax * (q.w / 2 + 1), q.z + az * (q.w / 2 + 1)).length > 0, id + ' ' + s.id + ': no deck beside it');
    ok(SH.sd(s, q.x + ax * (q.w / 2 + 1), q.z + az * (q.w / 2 + 1)) > 0, id + ' ' + s.id + ': the point beside the deck is outside its shape');
  }

  // walk tops: the shapes with a top agree with settlement.surfaceAt
  for (const s of bs.filter(o => o.top != null && o.solid).slice(0, 40)) {
    const b = SH.bound(s), x = s.shape.type === 'capsule' ? b.x : s.shape.x, z = s.shape.type === 'capsule' ? b.z : s.shape.z;
    const st = SE.surfaceAt(town, x, z);
    const higher = SH.at(L, x, z).some(o => o.solid && o !== s && o.y1 > s.y1 + EPS);
    if (!higher) near(st, s.top, EPS, id + ' ' + s.id + ': walk top = surfaceAt');
  }

  // the probe returns the core queries
  for (const [x, z] of [[0, 0], [123, -77], [-300, 210]]) {
    const p = SH.probe(id, x, z, town);
    near(p.surface, T.surfaceAt(id, x, z), EPS, id + ' probe surface');
    near(p.height, T.heightAt(id, x, z), EPS, id + ' probe height');
    near(p.mesh, T.meshAt(id, x, z), EPS, id + ' probe mesh');
    const d = T.deckAt(id, x, z);
    ok((p.deck == null) === !d, id + ' probe deck');
    ok(p.paved === (R.city ? CI.pavedAt(id, x, z) : 0), id + ' probe paved');
    ok(p.road === T.lineDist(id, 'road', x, z), id + ' probe road distance');
    ok(p.roof === roofAt(x, z), id + ' probe roof');
    ok(SH.probeLines(p).length === 4, id + ' probe lines');
  }
}

// the pick: straight down onto a settlement piece finds it (or a taller one over the same spot); toward two lots the nearer
{
  const id = 'bend', town = SE.build(id, {}), L = SH.list(id, town);
  const b = L.find(s => s.kind === 'building' && s.solid && s.shape.type === 'cyl');
  const h = SH.pick(id, L, [b.shape.x, b.y1 + 50, b.shape.z], [0, -1, 0]);
  ok(h && h.shape && SH.sd(h.shape, b.shape.x, b.shape.z) <= 0 && h.shape.y1 >= b.y1 - 1e-6, 'pick: straight down hits the building (' + (h && h.shape && h.shape.id) + ')');
  near(h.t, 50 + b.y1 - h.shape.y1, 0.3, 'pick: at its roof');
  ok(SH.card(id, h.shape).length >= 5, 'card lines for a picked building');

  const lots = L.filter(s => s.kind === 'lot');
  const a = lots[10], la = SH.bound(a);
  const y = (a.y0 + a.y1) / 2, from = [la.x - 60, y, la.z], dir = [1, 0, 0];
  const hit = SH.pick(id, L, from, dir, 120);
  ok(hit, 'pick: a level ray toward a lot hits something');
  if (hit && hit.shape) {
    // nothing nearer along the ray: sample before the hit
    let nearer = false;
    for (let t = 0; t < hit.t - 0.3; t += 0.25) if (L.some(s => s.kind !== 'plateau' && SH.inside(s, from[0] + t, y, from[2]))) { nearer = true; break; }
    ok(!nearer, 'pick: nothing nearer than the picked object (' + hit.shape.id + ' at ' + hit.t.toFixed(2) + ')');
  }
  const sky = SH.pick(id, L, [0, 300, 0], [0, 1, 0], 200);
  ok(sky === null, 'pick: a ray into the sky finds nothing');
  const g = SH.pick(id, L, [500, 200, 500], [0, -1, 0]);
  ok(g && (g.shape || Math.abs(g.pos[1] - T.surfaceAt(id, 500, 500)) < 0.05), 'pick: straight down ends on the ground (or a block)');
}

// the castle gate: the portcullis is a shape, solid only while closed
{
  const id = Object.keys(D.regions).find(r => (D.regions[r].settlements || []).some(s => D.settlements[s.type] && D.settlements[s.type].walls));
  if (id) {
    const town = SE.build(id, {});
    const gate = town.buildings.find(b => b.gate);
    ok(gate, 'the castle has a gate piece');
    town.gateClosed = false;
    ok(!SH.list(id, town).find(s => s.ref === gate).solid, 'open gate: not solid');
    town.gateClosed = true;
    ok(SH.list(id, town).find(s => s.ref === gate).solid, 'closed gate: solid');
  }
}

// without ?debug nothing is built: game.js creates the overlay only behind the debug flag
{
  const src = fs.readFileSync(path.join(__dirname, '..', 'game.js'), 'utf8');
  const calls = src.split('\n').filter(l => /debugShapesFrame\(|debugPick\(/.test(l) && !/function debug(ShapesFrame|Pick)/.test(l) && !/__vcamp/.test(l));
  ok(calls.length >= 2 && calls.every(l => /if \(debug( && dbgPick)?[ )]/.test(l)), 'the shape overlay and the pick run only under ?debug (' + calls.length + ' calls)');
  ok(/const SH = debug \? C\.need\('shapes'\) : null/.test(src), 'core/shapes is only used with ?debug');
  const idx = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
  ok(/core\/shapes\.js/.test(idx) && /render\/debug-shapes\.js/.test(idx), 'index.html loads shapes and debug-shapes');
  const sw = fs.readFileSync(path.join(__dirname, '..', '..', 'sw.js'), 'utf8');
  ok(/campaign\/core\/shapes\.js/.test(sw) && /campaign\/render\/debug-shapes\.js/.test(sw), 'sw.js caches the new files');
}
