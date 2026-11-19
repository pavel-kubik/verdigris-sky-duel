// Maidenhold and the pass settlements (Phase 4 T06, 004_task_highlands.md 4.3): the Order's cliff fortress from the
// castle kit on the promontory with a chain net over its yard (landing refused 'net'), the toll fort by the big viaduct,
// Chuchel village, the Jinonice and Branick hamlets and the Zlichov rock chapel on the T05 plateaus; discovery, compass
// and map entries.
'use strict';
const { ok, core } = require('./harness.js');
const T = core('terrain'), D = core('data'), SE = core('settlement'), CA = core('castle'), W = core('walk'), S = core('state');
const F = core('flight'), NV = core('nav'), MP = core('map'), DF = core('defenders'), SH = core('shapes');
const { mulberry } = core('math');
require('../core/dem-pass.js');
const fs = require('fs'), path = require('path');
const src = fs.readFileSync(path.join(__dirname, '..', '..', 'i18n.js'), 'utf8');
const enAt = src.indexOf('\n    en: {'), csAt = src.indexOf('\n    cs: {');
const keysIn = text => new Set([...text.matchAll(/'([a-zA-Z0-9_.]+)':/g)].map(m => m[1]));
const EN = keysIn(src.slice(enAt, csAt)), CS = keysIn(src.slice(csAt));
const I18N = { en: k => EN.has(k), cs: k => CS.has(k) };
const id = 'pass', town = SE.build(id), byName = {};
for (const pl of town.places) byName[pl.name] = pl;

// 1. the six places, named, at their plateaus
const want = { maidenhold: 'fortress', tollfort: 'tollfort', chuchel: 'village', jinonice: 'hamlet', branick: 'hamlet', zlichov: 'chapelRock' };
for (const n in want) ok(byName[n] && byName[n].type === want[n], n + ' is a ' + want[n]);
ok(town.places.length === 6, 'the pass has six settlements');
const mh = byName.maidenhold;
ok(mh.castle === true && mh.id === 'pass.fortress', 'Maidenhold is a castle place (castle kit, gate, horn, posts)');
for (const pl of town.places) {
  const f = D.regions[id].terrain.features.find(o => o.type === 'plateau' && Math.hypot(o.x - pl.x, o.z - pl.z) < 1);
  ok(f && pl.r <= f.r, pl.name + ' fits on its plateau (r ' + pl.r.toFixed(0) + ' <= ' + (f && f.r) + ')');
}

// 2. every footprint is flat (sampled round its edge, wall runs along their length)
let steep = 0, n = 0;
for (const b of town.buildings) {
  const pts = b.seg ? [0, 0.25, 0.5, 0.75, 1].map(k => [b.seg[0] + (b.seg[2] - b.seg[0]) * k, b.seg[1] + (b.seg[3] - b.seg[1]) * k]) : [[b.pos[0], b.pos[2]]];
  const r = Math.max(1, b.r);
  for (const [x, z] of pts) for (let a = 0; a < 8; a++) {
    n++;
    if (Math.abs(T.surfaceAt(id, x + Math.sin(a) * r, z + Math.cos(a) * r) - b.pos[1]) > 0.6) steep++;
  }
}
ok(steep === 0, 'every footprint is flat (' + n + ' samples, ' + steep + ' off by more than 0.6)');

// 3. Maidenhold's layout: inner buildings clear of the walls and corners, inside the walls; smaller than Vyshgard
const tpl = D.settlements.fortress, L = CA.layout(tpl), pcs = CA.pieces(tpl);
const walls = pcs.filter(p => p.seg || !p.inner), inner = pcs.filter(p => p.inner);
const segD = (p, x, z) => {
  if (!p.seg) return Math.hypot(x - p.x, z - p.z) - p.r;
  const [x0, z0, x1, z1] = p.seg, vx = x1 - x0, vz = z1 - z0, k = Math.max(0, Math.min(1, ((x - x0) * vx + (z - z0) * vz) / (vx * vx + vz * vz)));
  return Math.hypot(x - x0 - vx * k, z - z0 - vz * k) - p.r;
};
for (const b of inner) {
  ok(CA.inside(tpl, b.x, b.z), b.type + ' stands inside the walls');
  const gap = Math.min(...walls.map(w => segD(w, b.x, b.z))) - b.r;
  ok(gap > 1, b.type + ' is clear of the walls (gap ' + gap.toFixed(1) + ')');
}
for (let i = 0; i < inner.length; i++) for (let j = i + 1; j < inner.length; j++) {
  const a = inner[i], b = inner[j];
  ok(Math.hypot(a.x - b.x, a.z - b.z) > a.r + b.r + 1, a.type + ' and ' + b.type + ' do not overlap');
}
ok(L.gate && L.gate.w >= D.castle.gate.w, 'Maidenhold has a gate gap between its gatehouses');
ok(L.radius < CA.layout(D.settlements.castle).radius, 'Maidenhold is smaller than Vyshgard');
ok(tpl.corners.length === tpl.walls.length && tpl.walls.length >= 6 && tpl.walls.length <= 7, '6-7 corner polygon');
ok(inner.filter(b => b.type === 'netter').length === tpl.netters && inner.some(b => b.type === 'stables') && inner.some(b => b.type === 'keep'), 'keep, stables and the net launchers inside');
// the gate faces the gold road (local +X = world +X with yaw 0), the cliff face east (-X)
const gx = mh.x + (L.gate.a[0] + L.gate.b[0]) / 2, gz = mh.z + (L.gate.a[1] + L.gate.b[1]) / 2;
const road = D.regions[id].terrain.features.filter(f => f.type === 'road').map(f => f.points[f.points.length - 1]);
ok(road.some(([x, z]) => Math.hypot(x - gx, z - gz) < 80), 'the gold road ends at Maidenhold\'s gate');

// 4. the chain net: landing in the yard refused 'net', wall walks landable, outside the walls unaffected
const pad = D.settlement.pad, sol = { at: (x, z) => SE.solidAt(town, x, z, pad), top: (x, z) => SE.surfaceAt(town, x, z), net: (x, z) => SE.netAt(town, x, z) };
const land = (x, z, up, t) => {
  const tw = t || town, g = T.surfaceAt(id, x, z), top = SE.surfaceAt(tw, x, z);
  const p = { mode: 'air', pos: [x, (top != null ? top : g) + up, z], speed: 2 };
  return W.canLand(p, id, (a, b) => SE.solidAt(tw, a, b, pad), (a, b) => SE.surfaceAt(tw, a, b), (a, b) => SE.netAt(tw, a, b));
};
const yard = [[mh.x, mh.z], [mh.x + 30, mh.z + 18], [mh.x - 2, mh.z - 26]];
for (const [x, z] of yard) {
  ok(sol.at(x, z) == null, 'yard spot (' + (x - mh.x) + ', ' + (z - mh.z) + ') is open ground');
  ok(land(x, z, 2).why === 'net', 'landing in Maidenhold\'s yard is refused with \'net\'');
  ok(Math.abs(SE.netAt(town, x, z) - (mh.y + D.buildings.wall.walkTop + D.castle.yardNet.up)) < 1e-6, 'the net hangs over the wall walk');
}
const runs = town.buildings.filter(b => b.place === mh.id && b.type === 'wall' && b.len > 10);
ok(runs.length >= 4, 'Maidenhold has wall runs');
for (const b of runs) {
  const x = (b.seg[0] + b.seg[2]) / 2, z = (b.seg[1] + b.seg[3]) / 2, c = land(x, z, 1);
  ok(c.ok && c.top != null, 'the wall walk of ' + b.id + ' is landable');
}
const bast = town.buildings.find(b => b.place === mh.id && b.type === 'bastion');
ok(land(bast.pos[0], bast.pos[2], 1).ok, 'a bastion top is landable');
ok(SE.netAt(town, mh.x + 90, mh.z) == null && SE.netAt(town, mh.x - 75, mh.z) == null, 'no net outside the walls');
const outside = [mh.x + 75, mh.z - 10];
ok(land(outside[0], outside[1], 2).why !== 'net', 'outside the gate the net does not refuse landing');
const down = SE.build(id); down.places.find(p => p.id === mh.id).netDown = true;
ok(SE.netAt(down, mh.x, mh.z) == null && land(mh.x, mh.z, 2, down).ok, 'with the net down (a breach, T09) the yard is landable');
ok(W.canLand({ mode: 'air', pos: [mh.x, T.surfaceAt(id, mh.x, mh.z) + 2, mh.z], speed: 2 }, id).ok, 'canLand without netAt (old callers) is unchanged');
// Vyshgard's courtyard has no net
const bend = SE.build('bend'), vy = bend.places.find(p => p.name === 'vyshgard');
ok(SE.netAt(bend, vy.x, vy.z) == null && !D.settlements.castle.yardNet, 'Vyshgard\'s yard has no net');
// the state's solids carry netAt (the Move slot and the landing prompt use it)
const cs = S.create({ regionId: 'ash', rng: mulberry(3) });
S.enterRegion(cs, id);
const ss = S.solids(cs, 1);
ok(typeof ss.netAt === 'function' && ss.netAt(mh.x, mh.z) != null, 'state.solids offers netAt in the pass');

// 5. the toll fort: palisade ring with the gate toward the big viaduct (north, +Z), toll house, tower, netter, stables
const tf = byName.tollfort, tfb = town.buildings.filter(b => b.place === tf.id);
ok(['tollhouse', 'tower', 'netter', 'stables'].every(t => tfb.some(b => b.type === t)), 'toll fort buildings');
const pal = tfb.filter(b => b.type === 'palisade');
ok(pal.length > 8, 'toll fort palisade ring');
ok(!pal.some(b => b.pos[2] - tf.z > 18 && Math.abs(b.pos[0] - tf.x) < 4), 'the gate gap faces the viaduct (north)');
const via = D.regions[id].terrain.features.find(f => f.type === 'bridge' && f.len === 150);
ok(Math.hypot(via.x - tf.x, via.z - tf.z) < 150, 'the toll fort stands beside the big viaduct');

// 6. new building types: data, i18n EN + CS
for (const t of ['netter', 'tollhouse', 'rockchapel']) {
  ok(D.buildings[t] && D.buildings[t].hp > 0, t + ' building data');
  ok(I18N.en('c.building.' + t) && I18N.cs('c.building.' + t), t + ' has EN and CS names');
}
ok(D.buildings.rockchapel.civil && D.buildings.rockchapel.stone, 'the rock chapel is civil stone (burns its roof, chars)');
for (const n in want) ok(I18N.en('c.placeName.' + n) && I18N.cs('c.placeName.' + n), n + ' has EN and CS names');
for (const t of ['fortress', 'tollfort', 'chapelRock']) ok(I18N.en('c.place.' + t) && I18N.cs('c.place.' + t), 'c.place.' + t + ' EN + CS');
ok(I18N.en('c.land.net') && I18N.cs('c.land.net'), 'the net refusal has EN and CS text');

// 7. Maidenhold reads from far: line of sight over the terrain and the castle LOD not off at 600+ units
const ty = mh.y + D.buildings.keep.h;
const sees = (x, z, eye) => {
  const y0 = T.surfaceAt(id, x, z) + eye;
  for (let i = 1; i < 120; i++) {
    const k = i / 120, px = x + (mh.x - x) * k, pz = z + (mh.z - z) * k;
    if (T.surfaceAt(id, px, pz) > y0 + (ty - y0) * k) return false;
  }
  return true;
};
for (const [x, z, what] of [[500, 30, 'up the gorge'], [-400, -250, 'from the river south of the gorge mouth']]) {
  const d = Math.hypot(x - mh.x, z - mh.z);
  ok(d >= 600 && sees(x, z, 20) && CA.lodFor(d, 'off') !== 'off', 'Maidenhold is visible ' + what + ' at ' + d.toFixed(0) + ' units');
}

// 8. discovery, compass and map: Maidenhold as a castle, the rest as settlements, with their own names
cs.dragon.pilot = F.newPilot([mh.x + 150, mh.y + 60, mh.z], 0, 10);
const ev = NV.discover(cs);
ok(ev.some(e => e.id === mh.id && e.castle && e.key === 'c.placeName.maidenhold'), 'flying near Maidenhold discovers it (castle, own name)');
cs.dragon.pilot.pos = [tf.x, tf.y + 40, tf.z + 80];
ok(NV.discover(cs).some(e => e.id === tf.id && e.key === 'c.placeName.tollfort'), 'the toll fort is discovered');
const mk = NV.markers(cs);
ok(mk.some(m => m.kind === 'castle' && m.key === 'place:' + mh.id), 'Maidenhold on the compass as a castle');
const model = MP.model(cs, id);
ok(model.places.some(p => p.id === mh.id && p.kind === 'castle' && p.key === 'c.placeName.maidenhold'), 'Maidenhold on the map as a castle');
ok(model.places.some(p => p.id === tf.id && p.kind === 'settlement'), 'the toll fort on the map');

// 9. defenders: Maidenhold's archers on its castle posts, the toll fort's on its tower; no peasants in the fortress
const sq = DF.spawn(town, mulberry(9));
const arch = pl => sq.list.filter(d => d.place === pl.id && d.kind === 'archer').length;
ok(arch(mh) === tpl.archers, 'Maidenhold mans ' + tpl.archers + ' archers');
ok(arch(tf) === D.settlements.tollfort.archers, 'the toll fort mans its archers');
ok(!sq.list.some(d => d.place === mh.id && d.kind === 'peasant'), 'no peasants in Maidenhold');
ok(sq.list.filter(d => d.place === byName.zlichov.id && d.kind === 'peasant').length === 2, 'two peasants at the rock chapel');

// 10. T01 debug shapes list every new piece once
const shp = SH.list(id, town);
for (const b of town.buildings) ok(shp.filter(s => s.id === b.id).length === 1, 'shape for ' + b.id);
